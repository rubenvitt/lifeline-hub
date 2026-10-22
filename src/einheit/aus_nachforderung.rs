//! Eine eingetroffene Nachforderung als Einheit übernehmen (LLH-1383, Teil b zu LLH-1097,
//! design.md D2–D7, Spec `nachforderung-einheit`): je Zeile eine neue Einheit oder eine schon
//! geführte verknüpfen, auf Wunsch in den Bereitstellungsraum des Ziels buchen, genau ein
//! ETB-Eintrag mit Verweis auf die Nachforderung. Alles in der Transaktion des Aufrufers
//! (`routes::einsatz_einheit::aus_nachforderung`, `write_retry!`); Live meldet die Route nach dem
//! Commit.

use crate::bereitstellungsraum::eintreffen::{self, normalize, Eintritt};
use crate::error::AppError;
use crate::nachforderung::{repo as nachforderung_repo, STATUS_EINGETROFFEN};
use crate::routes::support::pflicht_max;
use serde::Deserialize;
use sqlx::SqliteConnection;

/// Eine Zeile des Bodies: genau eines von `name` (neue Einheit) und `einheit_id` (verknüpfen).
#[derive(Debug, Default, Deserialize)]
pub struct ZeileEingabe {
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub einheit_id: Option<i64>,
}

/// Geprüfte Zeile (design.md D3).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Zeile {
    /// Neue Einheit; der Name ist zugleich ihr Funkrufname.
    Neu(String),
    /// Eine schon geführte Einheit des Einsatzes bekommt den Verweis.
    Bestehend(i64),
}

/// Feldprüfung vor jedem Lesen (400, design.md D2): mindestens eine, höchstens
/// [`crate::nachforderung::UEBERNAHME_EINHEITEN_MAX`] Zeilen (gezählt vor dem Entdoppeln), je Zeile
/// genau eines der beiden Felder, ein Name getrimmt und höchstens [`super::NAME_MAX`] Zeichen.
/// Entdoppelt in Eingabefolge: Namen nach [`normalize`], Kennungen gleich.
pub fn check_zeilen(roh: &[ZeileEingabe]) -> Result<Vec<Zeile>, AppError> {
    let max = crate::nachforderung::UEBERNAHME_EINHEITEN_MAX;
    if roh.is_empty() {
        return Err(AppError::Validation(
            "Mindestens eine Einheit angeben".into(),
        ));
    }
    if roh.len() > max {
        return Err(AppError::Validation(format!(
            "Höchstens {max} Einheiten je Übernahme"
        )));
    }
    let mut zeilen: Vec<Zeile> = Vec::with_capacity(roh.len());
    for z in roh {
        let zeile = match (&z.name, z.einheit_id) {
            (Some(name), None) => Zeile::Neu(pflicht_max(name, "Name", super::NAME_MAX)?),
            (None, Some(id)) => Zeile::Bestehend(id),
            _ => {
                return Err(AppError::Validation(
                    "Je Einheit entweder einen Namen oder eine bestehende Einheit angeben".into(),
                ))
            }
        };
        let doppelt = zeilen.iter().any(|g| match (g, &zeile) {
            (Zeile::Neu(a), Zeile::Neu(b)) => normalize(a) == normalize(b),
            (Zeile::Bestehend(a), Zeile::Bestehend(b)) => a == b,
            _ => false,
        });
        if !doppelt {
            zeilen.push(zeile);
        }
    }
    Ok(zeilen)
}

/// Rahmen einer Übernahme: wer, woraus, wohin.
#[derive(Debug, Clone, Copy)]
pub struct Rahmen<'a> {
    pub einsatz_id: i64,
    pub org_id: i64,
    pub benutzer_id: i64,
    pub nachforderung_id: i64,
    /// Einheitstyp der neuen Einheiten; `anlegen_tx` prüft ihn.
    pub typ_id: Option<i64>,
    /// In den Bereitstellungsraum des Ziels buchen (D5).
    pub in_bereitstellungsraum: bool,
    /// „Jetzt“ (DB-Format, UTC), Eingang der Buchung.
    pub jetzt: &'a str,
    /// ETB-Startwert des Einsatzes (vor der Transaktion gelesen).
    pub etb_startwert: i64,
}

/// Was die Übernahme geschrieben hat, für Antwort und Live nach dem Commit (D12).
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Uebernommen {
    /// Die übernommenen Einheiten in Zeilenfolge.
    pub einheit_ids: Vec<i64>,
    /// Der Raum, in den gebucht wurde; `None` ohne Buchung.
    pub br_id: Option<i64>,
    /// Der eine ETB-Eintrag (D6).
    pub etb_id: i64,
    pub personen: Vec<i64>,
    pub abloesung: Vec<i64>,
    pub hinweise: Vec<crate::benachrichtigung::Anlass>,
}

/// ETB-Wortlaut (D6): „Nachforderung 2× RTW: als Einheiten übernommen (83-1, 83-2), im BR Nord
/// eingetroffen“; ist nur ein Teil gebucht, „…, im BR Nord eingetroffen: 83-1“; ohne Buchung ohne
/// Zusatz. `raum` ist die Bezeichnung des Raums und die gebuchten Namen.
pub fn etb_text(kurz: &str, namen: &[String], raum: Option<(&str, &[String])>) -> String {
    let wort = if namen.len() == 1 {
        "als Einheit übernommen"
    } else {
        "als Einheiten übernommen"
    };
    let mut text = format!("Nachforderung {kurz}: {wort} ({})", namen.join(", "));
    if let Some((bezeichnung, gebucht)) = raum {
        if gebucht.len() == namen.len() {
            text.push_str(&format!(", im BR {bezeichnung} eingetroffen"));
        } else if !gebucht.is_empty() {
            text.push_str(&format!(
                ", im BR {bezeichnung} eingetroffen: {}",
                gebucht.join(", ")
            ));
        }
    }
    text
}

/// Die Übernahme in der Transaktion des Aufrufers (D2 Schritt 4). Fehlerfolge: Nachforderung
/// fremd 404, nicht eingetroffen 422, mehr Einheiten als die Anzahl 422, Raum gewünscht ohne Ziel
/// Raum 422, Raum nicht belegbar 404/422, Name schon im Einsatz 422, bestehende Einheit fremd 404,
/// aufgelöst oder schon übernommen 409. Ein Fehler rollt alles zurück.
pub async fn uebernehmen_tx(
    conn: &mut SqliteConnection,
    r: &Rahmen<'_>,
    zeilen: &[Zeile],
) -> Result<Uebernommen, AppError> {
    // 1. Die Nachforderung in der Transaktion: Status und Anzahl kippen sonst zwischen Prüfung
    // und Schreiben (Muster `check_uebernahme_tx`, LLH-1226 D2).
    let (status, art, anzahl, ziel_br_id, eingetroffen_at): (
        String,
        String,
        Option<i64>,
        Option<i64>,
        Option<String>,
    ) = sqlx::query_as(
        "SELECT status, art, anzahl, ziel_br_id, eingetroffen_at FROM nachforderung \
         WHERE id = ? AND einsatz_id = ?",
    )
    .bind(r.nachforderung_id)
    .bind(r.einsatz_id)
    .fetch_optional(&mut *conn)
    .await?
    .ok_or(AppError::NotFound)?;
    if status != STATUS_EINGETROFFEN {
        return Err(AppError::UnprocessableEntity(
            "Einheiten werden erst nach dem Eintreffen übernommen".into(),
        ));
    }
    // 2. Menge (D4): bestehende Verknüpfungen und neue zusammen höchstens die Anzahl.
    if let Some(a) = anzahl {
        let bestehend: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM einsatz_einheit WHERE einsatz_id = ? AND nachforderung_id = ?",
        )
        .bind(r.einsatz_id)
        .bind(r.nachforderung_id)
        .fetch_one(&mut *conn)
        .await?;
        let neu = i64::try_from(zeilen.len()).unwrap_or(i64::MAX);
        if bestehend.saturating_add(neu) > a {
            let rest = (a - bestehend).max(0);
            return Err(AppError::UnprocessableEntity(format!(
                "Die Nachforderung umfasst {a}; übernommen sind {bestehend}, höchstens {rest} weitere"
            )));
        }
    }
    // 3. Raum (D5): nur mit Ziel Raum, belegbar in derselben Transaktion.
    let raum = match (r.in_bereitstellungsraum, ziel_br_id) {
        (false, _) => None,
        (true, None) => {
            return Err(AppError::UnprocessableEntity(
                "Die Nachforderung hat keinen Bereitstellungsraum als Ziel".into(),
            ))
        }
        (true, Some(br_id)) => Some(
            crate::bereitstellungsraum::belegung_repo::require_belegbar_tx(
                &mut *conn,
                r.einsatz_id,
                br_id,
            )
            .await?,
        ),
    };
    // 4. Neue Namen gibt es nicht zweimal im Einsatz (D3).
    let neue: Vec<&str> = zeilen
        .iter()
        .filter_map(|z| match z {
            Zeile::Neu(n) => Some(n.as_str()),
            Zeile::Bestehend(_) => None,
        })
        .collect();
    eintreffen::check_namen_frei_tx(&mut *conn, r.einsatz_id, &neue).await?;

    // 5. Anlegen bzw. verknüpfen, in Zeilenfolge.
    let mut einheiten: Vec<(i64, String, Option<i64>)> = Vec::with_capacity(zeilen.len());
    for zeile in zeilen {
        let (id, name, aktueller_br) = match zeile {
            Zeile::Neu(name) => {
                let id = super::repo::anlegen_tx(
                    &mut *conn,
                    r.einsatz_id,
                    r.org_id,
                    &super::repo::EinheitDaten {
                        name,
                        abschnitt_id: None,
                        ueber_einheit_id: None,
                        typ_id: r.typ_id,
                        soll_fuehrer: None,
                        soll_unterfuehrer: None,
                        soll_mannschaft: None,
                        bemerkung: None,
                        funkrufname: Some(name),
                        sortier: 0,
                        tz_fachaufgabe: None,
                        tz_organisation: None,
                    },
                    r.benutzer_id,
                )
                .await?;
                (id, name.clone(), None)
            }
            Zeile::Bestehend(id) => {
                super::repo::require_aktiv_tx(&mut *conn, r.einsatz_id, *id).await?;
                let (name, verweis, aktueller_br): (String, Option<i64>, Option<i64>) =
                    sqlx::query_as(
                        "SELECT name, nachforderung_id, aktueller_br_id FROM einsatz_einheit \
                         WHERE id = ? AND einsatz_id = ?",
                    )
                    .bind(id)
                    .bind(r.einsatz_id)
                    .fetch_one(&mut *conn)
                    .await?;
                if verweis.is_some() {
                    return Err(AppError::Conflict(format!(
                        "«{name}» ist schon aus einer Nachforderung übernommen"
                    )));
                }
                (*id, name, aktueller_br)
            }
        };
        sqlx::query(
            "UPDATE einsatz_einheit SET nachforderung_id = ? WHERE id = ? AND einsatz_id = ?",
        )
        .bind(r.nachforderung_id)
        .bind(id)
        .bind(r.einsatz_id)
        .execute(&mut *conn)
        .await?;
        einheiten.push((id, name, aktueller_br));
    }

    // 6. Buchen (D5): wer schon in einem Raum steht, bleibt dort.
    let mut ergebnis = Uebernommen {
        einheit_ids: einheiten.iter().map(|(id, _, _)| *id).collect(),
        br_id: raum.as_ref().map(|b| b.id),
        ..Uebernommen::default()
    };
    let mut gebucht: Vec<String> = Vec::new();
    if let Some(br) = &raum {
        let zeitpunkt = eingetroffen_at.as_deref().unwrap_or(r.jetzt);
        let rahmen = eintreffen::Rahmen {
            einsatz_id: r.einsatz_id,
            org_id: r.org_id,
            br_id: br.id,
            benutzer_id: r.benutzer_id,
            zeitpunkt_at: zeitpunkt,
            eingang_at: r.jetzt,
            client_id: None,
            etb_startwert: r.etb_startwert,
        };
        for (id, name, aktueller_br) in &einheiten {
            if aktueller_br.is_some() {
                continue;
            }
            let Eintritt {
                personen,
                abloesung,
                hinweise,
                ..
            } = eintreffen::eintritt_einheit_tx(&mut *conn, &rahmen, *id).await?;
            ergebnis.personen.extend(personen);
            ergebnis.abloesung.extend(abloesung);
            ergebnis.hinweise.extend(hinweise);
            gebucht.push(name.clone());
        }
    }

    // 7. Genau ein ETB-Eintrag mit Verweis auf die Nachforderung (D6).
    let namen: Vec<String> = einheiten.iter().map(|(_, n, _)| n.clone()).collect();
    let text = etb_text(
        &nachforderung_repo::kurzname(anzahl, &art),
        &namen,
        raum.as_ref()
            .map(|b| (b.bezeichnung.as_str(), gebucht.as_slice())),
    );
    ergebnis.etb_id =
        nachforderung_repo::protokollieren_tx(conn, r.nachforderung_id, r.benutzer_id, &text)
            .await?;
    Ok(ergebnis)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn neu(name: &str) -> ZeileEingabe {
        ZeileEingabe {
            name: Some(name.into()),
            einheit_id: None,
        }
    }

    #[test]
    fn zeilen_werden_getrimmt_und_entdoppelt() {
        let zeilen = check_zeilen(&[
            neu(" 83-1 "),
            neu("83-1"),
            neu("Florian  83-2"),
            neu("florian 83-2"),
            ZeileEingabe {
                name: None,
                einheit_id: Some(7),
            },
            ZeileEingabe {
                name: None,
                einheit_id: Some(7),
            },
        ])
        .unwrap();
        assert_eq!(
            zeilen,
            vec![
                Zeile::Neu("83-1".into()),
                Zeile::Neu("Florian  83-2".into()),
                Zeile::Bestehend(7)
            ]
        );
    }

    #[test]
    fn zeilen_pruefen_jedes_feld_fuer_sich() {
        for roh in [
            vec![],
            vec![neu("   ")],
            vec![ZeileEingabe::default()],
            vec![ZeileEingabe {
                name: Some("83-1".into()),
                einheit_id: Some(3),
            }],
            vec![neu(&"x".repeat(super::super::NAME_MAX + 1))],
            (0..=crate::nachforderung::UEBERNAHME_EINHEITEN_MAX)
                .map(|_| neu("83-1"))
                .collect(),
        ] {
            assert!(
                matches!(check_zeilen(&roh), Err(AppError::Validation(_))),
                "{roh:?}"
            );
        }
    }

    #[test]
    fn etb_text_nennt_einheiten_und_raum() {
        let namen = vec!["83-1".to_string(), "83-2".to_string()];
        assert_eq!(
            etb_text("2× RTW", &namen, None),
            "Nachforderung 2× RTW: als Einheiten übernommen (83-1, 83-2)"
        );
        assert_eq!(
            etb_text("2× RTW", &namen, Some(("Nord", namen.as_slice()))),
            "Nachforderung 2× RTW: als Einheiten übernommen (83-1, 83-2), im BR Nord eingetroffen"
        );
        assert_eq!(
            etb_text("2× RTW", &namen, Some(("Nord", &namen[..1]))),
            "Nachforderung 2× RTW: als Einheiten übernommen (83-1, 83-2), im BR Nord \
             eingetroffen: 83-1"
        );
        assert_eq!(
            etb_text("RTW", &namen[..1], Some(("Nord", &[]))),
            "Nachforderung RTW: als Einheit übernommen (83-1)"
        );
    }
}
