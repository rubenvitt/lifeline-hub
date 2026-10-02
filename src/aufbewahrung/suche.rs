//! Pseudonyme Personensuche im Archiv (LFH-751, Spec `aufbewahrung-loeschersuchen`,
//! „Pseudonyme Personensuche“).
//!
//! Wer ein Löschersuchen bearbeitet, kennt den Namen oder die Rufnummer der antragstellenden
//! Person; die Archivakte zeigt beides bewusst nicht. Die Suche liest deshalb als einzige Stelle
//! des Archivs **Scrub-Spalten** (Namen und Kontakte der vier Personenarten), gleicht sie in Rust
//! ab und liefert nur pseudonyme Treffer zurück: Art, Kennung, Erfassungszeitpunkt, Status, Stand
//! eines Antrags. Sie schreibt nichts und loggt den Suchtext nicht.
//!
//! **Nur ganze Wörter:** jedes Wort des Suchtexts muss als ganzes Wort im Namen stehen, sonst
//! wäre die Suche ein Orakel für Namensanfänge. Eine Rufnummer trifft, wenn der Suchtext
//! mindestens [`MIN_ZIFFERN`] Ziffern hat und sie gleich den Ziffern eines Kontaktfelds sind.
//! Herleitung: `openspec/changes/lfh-751-sofort-schwaerzung-auf-antrag/design.md`, D6.

use super::antrag::{AntragStand, AntragZielArt};
use crate::einsatz::schwaerzung_person::PersonenArt;
use crate::error::AppError;
use crate::person::PersonStatus;
use serde::Serialize;
use sqlx::SqlitePool;
use utoipa::ToSchema;

/// Mindestlänge des Suchtexts nach dem Trimmen (darunter 400).
pub const MIN_SUCHTEXT: usize = 3;
/// Mindestzahl Ziffern für einen Treffer über die Rufnummer.
pub const MIN_ZIFFERN: usize = 6;

/// Ein Treffer der Personensuche — ohne Name, Kontakt oder Freitext.
#[derive(Debug, Clone, PartialEq, Serialize, ToSchema)]
pub struct PersonTrefferAnzeige {
    pub art: PersonenArt,
    pub id: i64,
    /// `R-042`, `EK-17`, `IT-5`, `MK-3` — dieselbe Kennung bestätigt den Antrag.
    pub kennung: String,
    /// Erfassung bzw. Eingang (UTC, DB-Format).
    pub erfasst_at: String,
    /// Status der Person (nur bei Betroffenen).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub person_status: Option<PersonStatus>,
    /// Stand eines offenen oder vollzogenen Antrags für diese Person.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub antrag: Option<AntragStand>,
}

/// Wörter eines Textes in Vergleichsform: Kleinschreibung, Umlaute ausgeschrieben, `ß` → `ss`,
/// jedes Zeichen außer Buchstaben und Ziffern trennt.
pub fn woerter(text: &str) -> Vec<String> {
    let mut normal = String::with_capacity(text.len());
    for c in text.chars().flat_map(char::to_lowercase) {
        match c {
            'ä' => normal.push_str("ae"),
            'ö' => normal.push_str("oe"),
            'ü' => normal.push_str("ue"),
            'ß' => normal.push_str("ss"),
            c if c.is_alphanumeric() => normal.push(c),
            _ => normal.push(' '),
        }
    }
    normal.split_whitespace().map(str::to_string).collect()
}

/// Nur die Ziffern eines Textes.
pub fn ziffern(text: &str) -> String {
    text.chars().filter(char::is_ascii_digit).collect()
}

/// Ob `suchtext` eine Person mit diesen Namens- und Kontaktfeldern trifft (siehe Moduldoku).
pub fn trifft(suchtext: &str, namen: &[Option<&str>], kontakte: &[Option<&str>]) -> bool {
    let gesucht = woerter(suchtext);
    if gesucht.is_empty() {
        return false;
    }
    let vorhanden: std::collections::HashSet<String> =
        namen.iter().flatten().flat_map(|n| woerter(n)).collect();
    if gesucht.iter().all(|w| vorhanden.contains(w)) {
        return true;
    }
    let z = ziffern(suchtext);
    z.len() >= MIN_ZIFFERN && kontakte.iter().flatten().any(|k| ziffern(k) == z)
}

/// Stand des maßgeblichen Antrags je Ziel (offen vor vollzogen; zurückgenommene zählen nicht).
async fn antraege(
    pool: &SqlitePool,
    einsatz_id: i64,
) -> Result<std::collections::HashMap<(String, i64), AntragStand>, AppError> {
    let zeilen: Vec<(String, i64, Option<String>)> = sqlx::query_as(
        "SELECT ziel_art, ziel_id, vollzogen_at FROM schwaerzung_antrag \
         WHERE einsatz_id = ? AND ziel_id IS NOT NULL AND zurueckgenommen_at IS NULL",
    )
    .bind(einsatz_id)
    .fetch_all(pool)
    .await?;
    let mut aus = std::collections::HashMap::new();
    for (art, id, vollzogen) in zeilen {
        let stand = if vollzogen.is_some() {
            AntragStand::Vollzogen
        } else {
            AntragStand::Offen
        };
        aus.entry((art, id))
            .and_modify(|s| {
                if stand == AntragStand::Offen {
                    *s = stand
                }
            })
            .or_insert(stand);
    }
    Ok(aus)
}

/// Sucht im Einsatz `einsatz_id` nach `suchtext` über alle vier Personenarten. Liest nur.
/// Der Aufrufer prüft Archivzugriff, Zustand und Mindestlänge.
pub async fn personensuche(
    pool: &SqlitePool,
    einsatz_id: i64,
    suchtext: &str,
) -> Result<Vec<PersonTrefferAnzeige>, AppError> {
    let antraege = antraege(pool, einsatz_id).await?;
    let stand = |art: PersonenArt, id: i64| {
        antraege
            .get(&(AntragZielArt::von_person(art).as_str().to_string(), id))
            .copied()
    };
    let mut treffer = Vec::new();

    type BetroffenerZeile = (
        i64,
        i64,
        Option<String>,
        Option<String>,
        Option<String>,
        String,
        String,
    );
    let betroffene: Vec<BetroffenerZeile> = sqlx::query_as(
        "SELECT id, registrier_nr, vorname, name, melder_kontakt, erfasst_at, status \
         FROM einsatz_person WHERE einsatz_id = ? ORDER BY registrier_nr",
    )
    .bind(einsatz_id)
    .fetch_all(pool)
    .await?;
    for (id, nr, vorname, name, kontakt, erfasst_at, status) in betroffene {
        if trifft(
            suchtext,
            &[vorname.as_deref(), name.as_deref()],
            &[kontakt.as_deref()],
        ) {
            let art = PersonenArt::Betroffene;
            treffer.push(PersonTrefferAnzeige {
                art,
                id,
                kennung: art.kennung(id, Some(nr)),
                erfasst_at,
                person_status: PersonStatus::parse(&status),
                antrag: stand(art, id),
            });
        }
    }

    let kraefte: Vec<(i64, String, String)> = sqlx::query_as(
        "SELECT id, snap_name, disponiert_at FROM einsatz_personal \
         WHERE einsatz_id = ? AND personal_id IS NULL ORDER BY id",
    )
    .bind(einsatz_id)
    .fetch_all(pool)
    .await?;
    for (id, name, disponiert_at) in kraefte {
        if trifft(suchtext, &[Some(&name)], &[]) {
            let art = PersonenArt::ExterneKraft;
            treffer.push(PersonTrefferAnzeige {
                art,
                id,
                kennung: art.kennung(id, None),
                erfasst_at: disponiert_at,
                person_status: None,
                antrag: stand(art, id),
            });
        }
    }

    for (art, sql) in [
        (
            PersonenArt::InfotelefonAnruf,
            "SELECT id, anrufer_name, rueckruf, eingang_at FROM infotelefon_anruf \
             WHERE einsatz_id = ? ORDER BY id",
        ),
        (
            PersonenArt::Medienkontakt,
            "SELECT id, kontakt_name, kontakt_erreichbarkeit, eingang_at FROM medienkontakt \
             WHERE einsatz_id = ? ORDER BY id",
        ),
    ] {
        let zeilen: Vec<(i64, Option<String>, Option<String>, String)> =
            sqlx::query_as(sql).bind(einsatz_id).fetch_all(pool).await?;
        for (id, name, kontakt, eingang_at) in zeilen {
            if trifft(suchtext, &[name.as_deref()], &[kontakt.as_deref()]) {
                treffer.push(PersonTrefferAnzeige {
                    art,
                    id,
                    kennung: art.kennung(id, None),
                    erfasst_at: eingang_at,
                    person_status: None,
                    antrag: stand(art, id),
                });
            }
        }
    }
    Ok(treffer)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::einsatz::schwaerzung_person::testdaten;

    #[test]
    fn ganze_woerter_in_beliebiger_reihenfolge_mit_umlauten() {
        let namen = [Some("Jürgen"), Some("Groß-Müller")];
        assert!(trifft("groß müller jürgen", &namen, &[]));
        assert!(trifft("Juergen Gross", &namen, &[]));
        assert!(trifft("  MUELLER, jürgen ", &namen, &[]));
        assert!(!trifft("Mül", &namen, &[]), "kein Teilwort-Treffer");
        assert!(
            !trifft("Jürgen Meier", &namen, &[]),
            "jedes Wort muss treffen"
        );
        assert!(!trifft("   ", &namen, &[]));
    }

    #[test]
    fn rufnummer_ueber_ziffern() {
        let k = [Some("0171 234-5678")];
        assert!(trifft("01712345678", &[], &k));
        assert!(trifft("(0171) 2345678", &[], &k));
        assert!(!trifft("2345678", &[], &k), "nur ganze Nummer");
        assert!(
            !trifft("12345", &[], &[Some("12345")]),
            "unter 6 Ziffern kein Treffer"
        );
    }

    #[tokio::test]
    async fn treffer_sind_pseudonym() {
        let pool = crate::db::test_pool().await;
        let b = testdaten::anlegen(&pool).await;
        sqlx::query("UPDATE einsatz_person SET vorname = 'Erika' WHERE id = ?")
            .bind(b.p2)
            .execute(&pool)
            .await
            .unwrap();
        let t = personensuche(&pool, b.e1, "mustermann erika")
            .await
            .unwrap();
        assert_eq!(t.len(), 1);
        assert_eq!(t[0].art, PersonenArt::Betroffene);
        assert_eq!(t[0].kennung, "R-002");
        assert_eq!(t[0].person_status, Some(PersonStatus::Betroffen));
        let json = serde_json::to_string(&t).unwrap();
        assert!(
            !json.contains("Erika") && !json.contains("Mustermann"),
            "{json}"
        );

        let t = personensuche(&pool, b.e1, "01511112223").await.unwrap();
        assert_eq!(
            t.iter().map(|x| x.kennung.clone()).collect::<Vec<_>>(),
            vec![format!("IT-{}", b.anruf1)]
        );
        let t = personensuche(&pool, b.e1, "Externer Hans").await.unwrap();
        assert_eq!(t[0].kennung, format!("EK-{}", b.k1));
        let t = personensuche(&pool, b.e1, "Maria Beispiel").await.unwrap();
        assert_eq!(t[0].art, PersonenArt::Medienkontakt);
        // Stammkräfte und andere Einsätze werden nicht gefunden.
        assert!(personensuche(&pool, b.e1, "Stamm-Dora")
            .await
            .unwrap()
            .is_empty());
        assert!(personensuche(&pool, b.e1, "Meier")
            .await
            .unwrap()
            .is_empty());
    }

    #[tokio::test]
    async fn geschwaerzte_person_wird_nicht_gefunden_antragsstand_wird_gezeigt() {
        let pool = crate::db::test_pool().await;
        let b = testdaten::anlegen(&pool).await;
        let t0 = crate::zeit::parse_utc("2026-10-02 08:00:00").unwrap();
        let a = super::super::antrag::stellen(
            &pool,
            b.e1,
            b.admin,
            b.org_id,
            super::super::antrag::AntragZiel::Person(PersonenArt::Betroffene, b.p1),
            "AZ",
            "R-001",
            t0,
        )
        .await
        .unwrap();
        let t = personensuche(&pool, b.e1, "Yilmaz").await.unwrap();
        assert_eq!(t[0].antrag, Some(AntragStand::Offen));
        super::super::antrag::vollziehen(&pool, a, t0 + chrono::Duration::hours(24))
            .await
            .unwrap();
        assert!(personensuche(&pool, b.e1, "Yilmaz")
            .await
            .unwrap()
            .is_empty());
    }
}
