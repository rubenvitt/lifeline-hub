//! Vorgabe je Funktion am Einsatz (LLH-1421, Entwurf `/mnt/project-files/llh-1421/design.md`,
//! D1–D4; Spec `benachrichtigungen`, „Vorgabe je Funktion am Einsatz“).
//!
//! Die Einsatzleitung legt je Einsatz fest, für welche Führungsfunktion (und für Mitglieder ohne
//! Funktion) eine Art der Stufe Eingang still ist. Gespeichert wird dünn
//! (`benachrichtigung_vorgabe`): für eine Art, die jemand gesetzt hat, eine Zeile je Funktion;
//! fehlt sie, gilt [`BenachrichtigungArt::vorgabe_still`]. Einstellbar sind nur Arten nach
//! [`BenachrichtigungArt::vorgabe_einstellbar`]; Art und Funktion prüft Rust, nicht die DB.
//!
//! Gelesen wird die Vorgabe allein in [`super::aufloesung::empfaenger`] (lauter gewinnt) und von
//! der Sektion „Benachrichtigungen“ der Einsatz-Einstellungen.

use super::{BenachrichtigungArt, BenachrichtigungStufe};
use crate::error::AppError;
use crate::fuehrung::{Fuehrungsfunktion, Labelkarte};
use crate::wire_enum::wire_enum;
use serde::Serialize;
use sqlx::SqlitePool;
use std::collections::{BTreeMap, BTreeSet};
use utoipa::ToSchema;

wire_enum! {
    /// Eine Spalte der Vorgabe (design.md D1): die Führungsfunktionen des Katalogs
    /// ([`Fuehrungsfunktion`], gleiche Wire-Werte) und `ohne` für Mitglieder ohne Funktion. Die
    /// Einsatzrolle ist keine Spalte: sie regelt Rechte, nicht Zuständigkeit.
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, ToSchema)]
    pub enum VorgabeFunktion {
        El => "el",
        S1 => "s1",
        S2 => "s2",
        S3 => "s3",
        S4 => "s4",
        S5 => "s5",
        S6 => "s6",
        S7 => "s7",
        Fuehrungshilfspersonal => "fuehrungshilfspersonal",
        Fachberater => "fachberater",
        /// Mitglied ohne Funktion im Einsatz (keine Stab-Besetzung, keine Funktion der
        /// Mitgliedschaft). Abschnittsleitung und Sichtung fallen darunter, solange der Katalog
        /// sie nicht kennt.
        Ohne => "ohne",
    }
    try_from = |s| format!("Ungültige Funktion: {s}");
}

impl VorgabeFunktion {
    /// Die Spalte einer Führungsfunktion.
    pub const fn aus(f: Fuehrungsfunktion) -> Self {
        match f {
            Fuehrungsfunktion::El => VorgabeFunktion::El,
            Fuehrungsfunktion::S1 => VorgabeFunktion::S1,
            Fuehrungsfunktion::S2 => VorgabeFunktion::S2,
            Fuehrungsfunktion::S3 => VorgabeFunktion::S3,
            Fuehrungsfunktion::S4 => VorgabeFunktion::S4,
            Fuehrungsfunktion::S5 => VorgabeFunktion::S5,
            Fuehrungsfunktion::S6 => VorgabeFunktion::S6,
            Fuehrungsfunktion::S7 => VorgabeFunktion::S7,
            Fuehrungsfunktion::Fuehrungshilfspersonal => VorgabeFunktion::Fuehrungshilfspersonal,
            Fuehrungsfunktion::Fachberater => VorgabeFunktion::Fachberater,
        }
    }

    /// Die Führungsfunktion der Spalte; `None` für [`VorgabeFunktion::Ohne`].
    pub fn fuehrungsfunktion(self) -> Option<Fuehrungsfunktion> {
        Fuehrungsfunktion::ALLE
            .into_iter()
            .find(|f| VorgabeFunktion::aus(*f) == self)
    }

    /// Kurzname für die Sektion: Kürzel („EL“, „S2“), bei Führungshilfspersonal und Fachberater
    /// das wirksame Label der Organisation, sonst „ohne Funktion“.
    fn name(self, karte: &Labelkarte) -> String {
        match self.fuehrungsfunktion() {
            Some(f) => karte.vorbelegung(f, None),
            None => "ohne Funktion".to_string(),
        }
    }
}

/// Höchstzahl der Funktionen in `still` (gezählt vor dem Entdoppeln, `src/AGENTS.md`,
/// Eingabegrenzen): jede Spalte einmal.
pub const STILL_MAX: usize = VorgabeFunktion::ALLE.len();

/// Eine Spalte der Sektion mit ihrem Kurznamen.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, ToSchema)]
pub struct VorgabeFunktionAnzeige {
    pub funktion: VorgabeFunktion,
    /// „EL“, „S2“, „Fachberater“, „ohne Funktion“.
    pub name: String,
}

/// Die wirksame Vorgabe einer Art: für welche Funktionen sie still ist (Zeile oder Katalog).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, ToSchema)]
pub struct BenachrichtigungVorgabeArt {
    pub art: BenachrichtigungArt,
    /// In der Reihenfolge von [`BenachrichtigungVorgaben::funktionen`].
    pub still: Vec<VorgabeFunktion>,
}

/// `GET /api/einsaetze/{id}/benachrichtigung-vorgaben` (design.md D4).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, ToSchema)]
pub struct BenachrichtigungVorgaben {
    /// Die Spalten in Katalogreihenfolge, `ohne` zuletzt; S7 nur, wenn die Organisation es
    /// eingeschaltet hat.
    pub funktionen: Vec<VorgabeFunktionAnzeige>,
    /// Jede einstellbare Art in Katalogreihenfolge.
    pub arten: Vec<BenachrichtigungVorgabeArt>,
}

/// Die gespeicherten Zeilen des Einsatzes je Art und Funktion. Unlesbares (eine Art oder Funktion,
/// die es nicht mehr gibt) fällt weg und lässt den Katalog gelten.
async fn zeilen(
    pool: &SqlitePool,
    einsatz_id: i64,
    art: Option<BenachrichtigungArt>,
) -> Result<BTreeMap<(BenachrichtigungArt, VorgabeFunktion), BenachrichtigungStufe>, AppError> {
    let roh = sqlx::query_as::<_, (String, String, String)>(
        "SELECT art, funktion, stufe FROM benachrichtigung_vorgabe \
         WHERE einsatz_id = ?1 AND (?2 IS NULL OR art = ?2)",
    )
    .bind(einsatz_id)
    .bind(art.map(|a| a.as_str()))
    .fetch_all(pool)
    .await?;
    Ok(roh
        .into_iter()
        .filter_map(|(a, f, s)| {
            Some((
                (BenachrichtigungArt::parse(&a)?, VorgabeFunktion::parse(&f)?),
                BenachrichtigungStufe::parse(&s)?,
            ))
        })
        .collect())
}

/// Ob `art` für `funktion` still ist: die Zeile, sonst der Katalog.
fn ist_still(
    zeilen: &BTreeMap<(BenachrichtigungArt, VorgabeFunktion), BenachrichtigungStufe>,
    art: BenachrichtigungArt,
    funktion: VorgabeFunktion,
) -> bool {
    zeilen
        .get(&(art, funktion))
        .map_or(art.vorgabe_still(), |s| *s == BenachrichtigungStufe::Still)
}

/// Die Funktionen, für die `art` im Einsatz still ist (Zeile oder Katalog). Leer für eine Art,
/// die nicht einstellbar ist: dort gilt keine Vorgabe.
pub async fn still_fuer(
    pool: &SqlitePool,
    einsatz_id: i64,
    art: BenachrichtigungArt,
) -> Result<BTreeSet<VorgabeFunktion>, AppError> {
    if !art.vorgabe_einstellbar() {
        return Ok(BTreeSet::new());
    }
    let zeilen = zeilen(pool, einsatz_id, Some(art)).await?;
    Ok(VorgabeFunktion::ALLE
        .into_iter()
        .filter(|f| ist_still(&zeilen, art, *f))
        .collect())
}

/// Die wirksame Vorgabe des Einsatzes für die Sektion (design.md D4). `karte` liefert Kurznamen
/// und den S7-Schalter der Organisation.
pub async fn laden(
    pool: &SqlitePool,
    einsatz_id: i64,
    karte: &Labelkarte,
) -> Result<BenachrichtigungVorgaben, AppError> {
    let zeilen = zeilen(pool, einsatz_id, None).await?;
    let funktionen: Vec<VorgabeFunktion> = VorgabeFunktion::ALLE
        .into_iter()
        .filter(|f| *f != VorgabeFunktion::S7 || karte.s7_aktiv)
        .collect();
    Ok(BenachrichtigungVorgaben {
        funktionen: funktionen
            .iter()
            .map(|f| VorgabeFunktionAnzeige {
                funktion: *f,
                name: f.name(karte),
            })
            .collect(),
        arten: BenachrichtigungArt::ALLE
            .into_iter()
            .filter(|a| a.vorgabe_einstellbar())
            .map(|art| art_anzeige(&zeilen, art, &funktionen))
            .collect(),
    })
}

fn art_anzeige(
    zeilen: &BTreeMap<(BenachrichtigungArt, VorgabeFunktion), BenachrichtigungStufe>,
    art: BenachrichtigungArt,
    funktionen: &[VorgabeFunktion],
) -> BenachrichtigungVorgabeArt {
    BenachrichtigungVorgabeArt {
        art,
        still: funktionen
            .iter()
            .copied()
            .filter(|f| ist_still(zeilen, art, *f))
            .collect(),
    }
}

/// Setzt die Vorgabe einer Art (design.md D4): eine Zeile je Funktion, still für `still`, sonst
/// Eingang; ersetzt den Bestand der Art in einer Anweisung. Art und Funktionen prüft der Aufrufer.
/// Liefert den neuen Stand der Art (Spalten wie [`laden`]).
pub async fn setzen(
    pool: &SqlitePool,
    einsatz_id: i64,
    art: BenachrichtigungArt,
    still: &BTreeSet<VorgabeFunktion>,
    benutzer_id: i64,
    karte: &Labelkarte,
) -> Result<BenachrichtigungVorgabeArt, AppError> {
    debug_assert!(art.vorgabe_einstellbar());
    let stufen: serde_json::Map<String, serde_json::Value> = VorgabeFunktion::ALLE
        .into_iter()
        .map(|f| {
            let stufe = if still.contains(&f) {
                BenachrichtigungStufe::Still
            } else {
                BenachrichtigungStufe::Hinweis
            };
            (f.as_str().to_string(), stufe.as_str().into())
        })
        .collect();
    // Alle Spalten in EINER Anweisung (`src/AGENTS.md`, Eingabegrenzen: von N unabhängig).
    sqlx::query(
        "INSERT INTO benachrichtigung_vorgabe \
            (einsatz_id, art, funktion, stufe, geaendert_at, geaendert_von) \
         SELECT ?1, ?2, key, value, datetime('now'), ?3 FROM json_each(?4) WHERE 1 \
         ON CONFLICT(einsatz_id, art, funktion) DO UPDATE SET \
             stufe = excluded.stufe, \
             geaendert_at = excluded.geaendert_at, \
             geaendert_von = excluded.geaendert_von",
    )
    .bind(einsatz_id)
    .bind(art.as_str())
    .bind(benutzer_id)
    .bind(serde_json::Value::Object(stufen).to_string())
    .execute(pool)
    .await?;
    let zeilen = zeilen(pool, einsatz_id, Some(art)).await?;
    let funktionen: Vec<VorgabeFunktion> = VorgabeFunktion::ALLE
        .into_iter()
        .filter(|f| *f != VorgabeFunktion::S7 || karte.s7_aktiv)
        .collect();
    Ok(art_anzeige(&zeilen, art, &funktionen))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Die Spalten sind die Führungsfunktionen in Katalogreihenfolge mit denselben Wire-Werten,
    /// dazu `ohne` zuletzt: eine neue Führungsfunktion ohne Spalte macht das rot.
    #[test]
    fn spalten_sind_der_funktionskatalog_und_ohne() {
        let erwartet: Vec<VorgabeFunktion> = Fuehrungsfunktion::ALLE
            .into_iter()
            .map(VorgabeFunktion::aus)
            .chain([VorgabeFunktion::Ohne])
            .collect();
        assert_eq!(VorgabeFunktion::ALLE.to_vec(), erwartet);
        for f in Fuehrungsfunktion::ALLE {
            assert_eq!(VorgabeFunktion::aus(f).as_str(), f.as_str());
            assert_eq!(VorgabeFunktion::aus(f).fuehrungsfunktion(), Some(f));
        }
        assert_eq!(VorgabeFunktion::Ohne.fuehrungsfunktion(), None);
    }

    /// Einstellbar sind die Eingänge des Einsatzes: kein Alarm, keine Org-Art, nicht Unwetter.
    /// Der Katalog stellt nur den Lagebericht still (Entscheidung zu LLH-1142 E2).
    #[test]
    fn einstellbar_sind_die_eingaenge_und_still_ist_nur_der_lagebericht() {
        for art in BenachrichtigungArt::ALLE {
            assert_eq!(
                art.vorgabe_einstellbar(),
                art.stufe() == BenachrichtigungStufe::Hinweis
                    && !art.ist_org()
                    && art != BenachrichtigungArt::Unwetter,
                "{}",
                art.as_str()
            );
        }
        let still: Vec<_> = BenachrichtigungArt::ALLE
            .into_iter()
            .filter(|a| a.vorgabe_still())
            .collect();
        assert_eq!(still, vec![BenachrichtigungArt::Lagebericht]);
        assert!(still.iter().all(|a| a.vorgabe_einstellbar()));
    }

    #[test]
    fn kurznamen_sind_kuerzel_label_und_ohne_funktion() {
        let karte = Labelkarte::standard();
        assert_eq!(VorgabeFunktion::El.name(&karte), "EL");
        assert_eq!(VorgabeFunktion::S2.name(&karte), "S2");
        assert_eq!(VorgabeFunktion::Fachberater.name(&karte), "Fachberater");
        assert_eq!(VorgabeFunktion::Ohne.name(&karte), "ohne Funktion");
    }

    // ── Mit Datenbank: Speicher und Auflösung ────────────────────────────────────────────────

    use crate::benachrichtigung::aufloesung;
    use crate::benachrichtigung::{Adressat, Anlass, BenachrichtigungBezugTyp, Bezug};

    /// Organisation, Einsatz und je Name ein Mitglied (Führungspersonal) mit dieser Funktion der
    /// Mitgliedschaft (`None` = ohne). Liefert Einsatz und Nutzer in Reihenfolge.
    async fn welt(pool: &SqlitePool, mitglieder: &[Option<&str>]) -> (i64, Vec<i64>) {
        sqlx::query("INSERT OR IGNORE INTO organisation (id, name) VALUES (1, 'Orga')")
            .execute(pool)
            .await
            .unwrap();
        let e: i64 = sqlx::query_scalar(
            "INSERT INTO einsatz (org_id, bezeichnung) VALUES (1, 'Lage') RETURNING id",
        )
        .fetch_one(pool)
        .await
        .unwrap();
        let mut ids = Vec::new();
        for (i, funktion) in mitglieder.iter().enumerate() {
            let b: i64 = sqlx::query_scalar(
                "INSERT INTO benutzer (org_id, anzeigename, benutzername, passwort_hash) \
                 VALUES (1, ?1, ?1, 'h') RETURNING id",
            )
            .bind(format!("n{i}"))
            .fetch_one(pool)
            .await
            .unwrap();
            sqlx::query(
                "INSERT INTO einsatz_mitgliedschaft \
                    (einsatz_id, benutzer_id, einsatz_rolle, fuehrungsfunktion) \
                 VALUES (?, ?, 'fuehrungspersonal', ?)",
            )
            .bind(e)
            .bind(b)
            .bind(funktion)
            .execute(pool)
            .await
            .unwrap();
            ids.push(b);
        }
        (e, ids)
    }

    fn anlass(e: i64, art: BenachrichtigungArt) -> Anlass {
        Anlass::neu(e, art, Bezug::neu(BenachrichtigungBezugTyp::Einsatz, e))
    }

    fn menge(fs: &[VorgabeFunktion]) -> BTreeSet<VorgabeFunktion> {
        fs.iter().copied().collect()
    }

    /// Ohne Festlegung gilt der Katalog; gesetzt wird je Funktion eine Zeile, und ein zweites
    /// Setzen ersetzt den Stand der Art, ohne andere Arten anzufassen.
    #[tokio::test]
    async fn setzen_schreibt_je_funktion_eine_zeile_und_ersetzt_den_stand_der_art() {
        let pool = crate::db::test_pool().await;
        let (e, ids) = welt(&pool, &[Some("el")]).await;
        let karte = Labelkarte::standard();
        assert_eq!(
            still_fuer(&pool, e, BenachrichtigungArt::Lagebericht)
                .await
                .unwrap(),
            menge(&VorgabeFunktion::ALLE)
        );
        assert!(still_fuer(&pool, e, BenachrichtigungArt::AuftragErteilt)
            .await
            .unwrap()
            .is_empty());

        let stand = setzen(
            &pool,
            e,
            BenachrichtigungArt::AuftragErteilt,
            &menge(&[VorgabeFunktion::S2, VorgabeFunktion::Ohne]),
            ids[0],
            &karte,
        )
        .await
        .unwrap();
        assert_eq!(
            stand.still,
            vec![VorgabeFunktion::S2, VorgabeFunktion::Ohne]
        );
        let zeilen: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM benachrichtigung_vorgabe WHERE einsatz_id = ? AND art = ?",
        )
        .bind(e)
        .bind("auftrag_erteilt")
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(zeilen as usize, VorgabeFunktion::ALLE.len());

        // Lagebericht für EL laut: die übrigen Spalten bleiben still, aber jetzt als Zeile.
        let ohne_el: BTreeSet<_> = VorgabeFunktion::ALLE
            .into_iter()
            .filter(|f| *f != VorgabeFunktion::El)
            .collect();
        setzen(
            &pool,
            e,
            BenachrichtigungArt::Lagebericht,
            &ohne_el,
            ids[0],
            &karte,
        )
        .await
        .unwrap();
        setzen(
            &pool,
            e,
            BenachrichtigungArt::AuftragErteilt,
            &menge(&[VorgabeFunktion::S4]),
            ids[0],
            &karte,
        )
        .await
        .unwrap();
        assert_eq!(
            still_fuer(&pool, e, BenachrichtigungArt::AuftragErteilt)
                .await
                .unwrap(),
            menge(&[VorgabeFunktion::S4])
        );
        assert_eq!(
            still_fuer(&pool, e, BenachrichtigungArt::Lagebericht)
                .await
                .unwrap(),
            ohne_el
        );

        let vorgaben = laden(&pool, e, &karte).await.unwrap();
        assert!(
            !vorgaben
                .funktionen
                .iter()
                .any(|f| f.funktion == VorgabeFunktion::S7),
            "S7 nur, wenn die Organisation es eingeschaltet hat"
        );
        assert_eq!(
            vorgaben.funktionen.last().map(|f| f.funktion),
            Some(VorgabeFunktion::Ohne)
        );
        assert!(vorgaben.arten.iter().all(|a| a.art.vorgabe_einstellbar()));
        let meldung = vorgaben
            .arten
            .iter()
            .find(|a| a.art == BenachrichtigungArt::Meldung)
            .unwrap();
        assert!(meldung.still.is_empty());

        sqlx::query("DELETE FROM einsatz WHERE id = ?")
            .bind(e)
            .execute(&pool)
            .await
            .unwrap();
        let rest: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM benachrichtigung_vorgabe")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(rest, 0, "die Vorgabe fällt mit dem Einsatz");
    }

    /// Spec „Still für S2“ in der Auflösung: S2 bekommt den Auftrag still, S4 als Eingang; wer ohne
    /// Funktion ist, zählt unter „ohne“.
    #[tokio::test]
    async fn vorgabe_stellt_die_art_fuer_die_funktion_still() {
        let pool = crate::db::test_pool().await;
        let (e, ids) = welt(&pool, &[Some("s2"), Some("s4"), None, Some("el")]).await;
        let (s2, s4, ohne, el) = (ids[0], ids[1], ids[2], ids[3]);
        setzen(
            &pool,
            e,
            BenachrichtigungArt::AuftragErteilt,
            &menge(&[VorgabeFunktion::S2, VorgabeFunktion::Ohne]),
            el,
            &Labelkarte::standard(),
        )
        .await
        .unwrap();
        let a = aufloesung::empfaenger(
            &pool,
            &anlass(e, BenachrichtigungArt::AuftragErteilt)
                .von(el)
                .an(Adressat::Funktion(Fuehrungsfunktion::S2))
                .an(Adressat::Funktion(Fuehrungsfunktion::S4))
                .an(Adressat::Nutzer(ohne)),
        )
        .await
        .unwrap();
        assert_eq!(a.benutzer_ids, vec![s4]);
        assert_eq!(a.still_ids, vec![s2, ohne]);
    }

    /// Spec „Lagebericht ohne Festlegung“: still für jeden Empfänger; ein Alarm bleibt laut,
    /// auch wenn eine Zeile ihn still stellen wollte (er ist nie einstellbar).
    #[tokio::test]
    async fn lagebericht_ist_ohne_festlegung_still_und_alarme_bleiben_laut() {
        let pool = crate::db::test_pool().await;
        let (e, ids) = welt(&pool, &[Some("s2"), None]).await;
        let a = aufloesung::empfaenger(
            &pool,
            &anlass(e, BenachrichtigungArt::Lagebericht)
                .an(Adressat::Nutzer(ids[0]))
                .an(Adressat::Nutzer(ids[1])),
        )
        .await
        .unwrap();
        assert!(a.benutzer_ids.is_empty());
        assert_eq!(a.still_ids, ids);

        sqlx::query(
            "INSERT INTO benachrichtigung_vorgabe (einsatz_id, art, funktion, stufe) \
             SELECT ?, 'sofortmeldung', value, 'still' FROM json_each('[\"s2\",\"ohne\"]')",
        )
        .bind(e)
        .execute(&pool)
        .await
        .unwrap();
        let a = aufloesung::empfaenger(
            &pool,
            &anlass(e, BenachrichtigungArt::Sofortmeldung)
                .an(Adressat::Nutzer(ids[0]))
                .an(Adressat::Nutzer(ids[1])),
        )
        .await
        .unwrap();
        assert_eq!(a.benutzer_ids, ids);
        assert!(a.still_ids.is_empty());
    }

    /// Lauter gewinnt (design.md D3): die Einsatzleitung besetzt per Zusammenlegung auch S2 und
    /// ist so EL und S2; nur S2 still lässt ihr den Eingang, beide still nehmen ihn.
    #[tokio::test]
    async fn wer_eine_laute_funktion_hat_bekommt_den_eingang() {
        let pool = crate::db::test_pool().await;
        let (e, ids) = welt(&pool, &[Some("s3")]).await;
        let leiter = ids[0];
        // Die Leiterin ist über die Führungsstelle EL und, weil S2 „bei der Einsatzleitung“
        // liegt, auch S2; die Mitgliedschaft nennt S3.
        let personal: i64 = sqlx::query_scalar(
            "INSERT INTO personal (org_id, name, benutzer_id) VALUES (1, 'Leiterin', ?) \
             RETURNING id",
        )
        .bind(leiter)
        .fetch_one(&pool)
        .await
        .unwrap();
        let ep: i64 = sqlx::query_scalar(
            "INSERT INTO einsatz_personal (einsatz_id, personal_id, snap_name) \
             VALUES (?, ?, 'Leiterin') RETURNING id",
        )
        .bind(e)
        .bind(personal)
        .fetch_one(&pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO einsatz_fuehrungsstelle (einsatz_id, einsatzleiter_art, \
                 einsatzleiter_personal_id) VALUES (?, 'personal', ?)",
        )
        .bind(e)
        .bind(ep)
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO einsatz_stabsfunktion (einsatz_id, sachgebiet, besetzung_art, \
                 gesetzt_von_id) VALUES (?, 's2', 'einsatzleitung', ?)",
        )
        .bind(e)
        .bind(leiter)
        .execute(&pool)
        .await
        .unwrap();
        let karte = Labelkarte::standard();
        let art = BenachrichtigungArt::Befehl;
        let an_s2 = || anlass(e, art).an(Adressat::Funktion(Fuehrungsfunktion::S2));

        setzen(
            &pool,
            e,
            art,
            &menge(&[VorgabeFunktion::S2]),
            leiter,
            &karte,
        )
        .await
        .unwrap();
        let a = aufloesung::empfaenger(&pool, &an_s2()).await.unwrap();
        assert_eq!(a.benutzer_ids, vec![leiter], "EL und S3 sind laut");

        let alle_drei = menge(&[
            VorgabeFunktion::El,
            VorgabeFunktion::S2,
            VorgabeFunktion::S3,
        ]);
        setzen(&pool, e, art, &alle_drei, leiter, &karte)
            .await
            .unwrap();
        let a = aufloesung::empfaenger(&pool, &an_s2()).await.unwrap();
        assert_eq!(a.still_ids, vec![leiter], "jede ihrer Funktionen ist still");
        assert!(a.benutzer_ids.is_empty());

        // Die persönliche Abschaltung bleibt daneben bestehen (D3: ODER).
        setzen(&pool, e, art, &BTreeSet::new(), leiter, &karte)
            .await
            .unwrap();
        sqlx::query(
            "INSERT INTO benutzer_einstellungen (benutzer_id, schluessel, wert, geaendert_at) \
             VALUES (?, 'benachrichtigungen_aus', '[\"befehl\"]', datetime('now'))",
        )
        .bind(leiter)
        .execute(&pool)
        .await
        .unwrap();
        let a = aufloesung::empfaenger(&pool, &an_s2()).await.unwrap();
        assert_eq!(a.still_ids, vec![leiter]);
    }
}
