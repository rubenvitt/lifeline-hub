//! Nachträgliche Korrektur einer Meldung (LLH-1066, Spec `meldungseingang`): Art, Priorität,
//! Richtung, Von-Bezug, Empfänger, Empfängerfunktion (LLH-1381) und die Lage-Angaben. Wortlaut, Absender, Meldeweg,
//! Ereigniszeit und Eingang bleiben, wie die Meldung einging (das prüft der Handler,
//! `routes::meldung_korrektur`). Jede wirksame Korrektur schreibt in derselben Transaktion EINEN
//! Systemeintrag mit Verweis auf die Meldung ins ETB; der ETB-Eintrag der Meldung behält seinen
//! Typ. Herleitung: `llh-1021/llh-1066/design.md` (Projektablage), D2–D8.
use crate::error::AppError;
use crate::fuehrung::Fuehrungsfunktion;
use crate::kommunikation::{Prioritaet, Richtung};
use sqlx::{SqliteConnection, SqlitePool};

use super::Meldungsart;

/// Eine geprüfte Korrektur. `None` heißt „bleibt“; bei den Tri-State-Feldern leert `Some(None)`.
#[derive(Debug, Default, Clone, PartialEq)]
pub struct Aenderung {
    pub meldungsart: Option<Meldungsart>,
    pub prioritaet: Option<Prioritaet>,
    pub richtung: Option<Richtung>,
    /// Von-Bezug als Paar (Einheit, Abschnitt), höchstens einer gesetzt (D3). `Some((None, None))`
    /// löst den Bezug.
    pub bezug: Option<(Option<i64>, Option<i64>)>,
    /// Empfänger als Freitext, getrimmt; `Some(None)` leert.
    pub empfaenger: Option<Option<String>>,
    /// Empfängerfunktion aus dem Katalog, vom Handler geprüft wie beim Erfassen; `Some(None)`
    /// leert (LLH-1381).
    pub empfaenger_funktion: Option<Option<Fuehrungsfunktion>>,
    /// In die Lage übernehmen (`true`) oder aus der Lage nehmen (`false`, D5).
    pub lagerelevant: Option<bool>,
    /// Lage-Text; `Some(None)` (leer) lässt den Wortlaut gelten (D6).
    pub lage_text: Option<Option<String>>,
    /// Verortung (Breite, Länge); `Some(None)` entfernt sie.
    pub geo: Option<Option<(f64, f64)>>,
}

/// Ergebnis einer Korrektur: ob sie etwas änderte, und der Systemeintrag im ETB.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Ergebnis {
    pub etb_id: Option<i64>,
}

impl Ergebnis {
    pub fn geaendert(&self) -> bool {
        self.etb_id.is_some()
    }
}

/// Der Stand einer Meldung, soweit die Korrektur ihn liest.
#[derive(Debug, Clone, PartialEq, sqlx::FromRow)]
struct Stand {
    lfd_nr: i64,
    #[sqlx(try_from = "String")]
    meldungsart: Meldungsart,
    #[sqlx(try_from = "String")]
    prioritaet: Prioritaet,
    #[sqlx(try_from = "String")]
    richtung: Richtung,
    einheit_id: Option<i64>,
    abschnitt_id: Option<i64>,
    empfaenger: Option<String>,
    /// Katalogcode (CHECK in der Datenbank); [`Stand::funktion`] liest ihn.
    empfaenger_funktion: Option<String>,
    inhalt: String,
    lagerelevant: bool,
    lage_text: Option<String>,
    lat: Option<f64>,
    lon: Option<f64>,
}

impl Stand {
    fn ist_sofort(&self) -> bool {
        self.meldungsart == Meldungsart::Sofortmeldung || self.prioritaet == Prioritaet::Sofort
    }

    fn geo(&self) -> Option<(f64, f64)> {
        self.lat.zip(self.lon)
    }

    fn funktion(&self) -> Option<Fuehrungsfunktion> {
        self.empfaenger_funktion
            .as_deref()
            .and_then(Fuehrungsfunktion::parse)
    }

    /// Der Text, den die Lage zeigt: eigener Lage-Text oder der Wortlaut.
    fn lage_text_wirksam(&self) -> &str {
        self.lage_text.as_deref().unwrap_or(&self.inhalt)
    }
}

/// Anzeigelabel wie an der Karte (`MELDUNGSART_OPTIONEN` in `frontend/src/meldungen/MeldungFormular.tsx`).
fn art_label(a: Meldungsart) -> &'static str {
    match a {
        Meldungsart::Lagemeldung => "Lagemeldung",
        Meldungsart::Sofortmeldung => "Sofortmeldung",
        Meldungsart::Rueckmeldung => "Rückmeldung",
        Meldungsart::Vollzugsmeldung => "Vollzugsmeldung",
        Meldungsart::Anfrage => "Anfrage",
        Meldungsart::Sonstige => "Sonstige",
    }
}

fn prioritaet_label(p: Prioritaet) -> &'static str {
    match p {
        Prioritaet::Sofort => "Sofort",
        Prioritaet::Dringend => "Dringend",
        Prioritaet::Normal => "Normal",
    }
}

fn richtung_label(r: Richtung) -> &'static str {
    match r {
        Richtung::Intern => "Intern",
        Richtung::Extern => "Extern",
    }
}

/// Die Empfängerfunktion im Systemeintrag (LLH-1381): ihr Kürzel wie in der ETB-Vorbelegung, ohne
/// Funktion „keine“. Eine Meldung trägt nur Funktionen mit Kürzel (der Handler prüft das).
fn funktion_label(f: Option<Fuehrungsfunktion>) -> &'static str {
    f.map_or("keine", |f| {
        f.kuerzel().unwrap_or_else(|| f.standard_label())
    })
}

/// Der Stand nach der Korrektur, abgeleitet aus Stand und Änderung (D3–D6), samt der Prüfung des
/// Zusammenhangs (422). Ohne Datenbank, damit die Regeln für sich testbar sind.
#[derive(Debug, Clone, PartialEq)]
struct Ziel {
    meldungsart: Meldungsart,
    prioritaet: Prioritaet,
    richtung: Richtung,
    einheit_id: Option<i64>,
    abschnitt_id: Option<i64>,
    empfaenger: Option<String>,
    empfaenger_funktion: Option<Fuehrungsfunktion>,
    lagerelevant: bool,
    lage_text: Option<String>,
    geo: Option<(f64, f64)>,
}

fn ziel(alt: &Stand, a: &Aenderung) -> Result<Ziel, AppError> {
    let meldungsart = a.meldungsart.unwrap_or(alt.meldungsart);
    let prioritaet = a.prioritaet.unwrap_or(alt.prioritaet);
    let wird_sofort = meldungsart == Meldungsart::Sofortmeldung || prioritaet == Prioritaet::Sofort;
    if wird_sofort && !alt.ist_sofort() {
        return Err(AppError::UnprocessableEntity(
            "Zur Sofortmeldung wird eine Meldung beim Erfassen; nachträglich gäbe es weder Alarm \
             noch Frist"
                .into(),
        ));
    }
    let lagerelevant = if meldungsart == Meldungsart::Lagemeldung {
        if a.lagerelevant == Some(false) {
            return Err(AppError::UnprocessableEntity(
                "Eine Lagemeldung steht immer in der Lage".into(),
            ));
        }
        true
    } else {
        a.lagerelevant.unwrap_or(alt.lagerelevant)
    };
    if !lagerelevant && (a.lage_text.is_some() || a.geo.is_some()) {
        return Err(AppError::UnprocessableEntity(
            "Lage-Text und Verortung hat nur eine Meldung in der Lage".into(),
        ));
    }
    let (einheit_id, abschnitt_id) = a.bezug.unwrap_or((alt.einheit_id, alt.abschnitt_id));
    if einheit_id.is_some() && abschnitt_id.is_some() {
        return Err(AppError::UnprocessableEntity(
            "Eine Meldung kommt entweder von einer Einheit oder von einem Abschnitt".into(),
        ));
    }
    // Lage-Angaben: eine Meldung außerhalb der Lage trägt keine (D5); eine neu übernommene
    // beginnt ohne; eine bleibende behält ihre, soweit die Änderung sie nicht setzt.
    let (lage_text, geo) = if !lagerelevant {
        (None, None)
    } else {
        let (text_vorher, geo_vorher) = if alt.lagerelevant {
            (alt.lage_text.clone(), alt.geo())
        } else {
            (None, None)
        };
        let text = match &a.lage_text {
            Some(t) => t.clone().filter(|t| *t != alt.inhalt),
            None => text_vorher,
        };
        (text, a.geo.unwrap_or(geo_vorher))
    };
    Ok(Ziel {
        meldungsart,
        prioritaet,
        richtung: a.richtung.unwrap_or(alt.richtung),
        einheit_id,
        abschnitt_id,
        empfaenger: a
            .empfaenger
            .clone()
            .unwrap_or_else(|| alt.empfaenger.clone()),
        empfaenger_funktion: a.empfaenger_funktion.unwrap_or_else(|| alt.funktion()),
        lagerelevant,
        lage_text,
        geo,
    })
}

/// Name eines Von-Bezugs für den ETB-Text; Einheit und Abschnitt sind Lagestruktur (Retain).
fn bezug_name(einheit: Option<&str>, abschnitt: Option<&str>) -> String {
    einheit
        .or(abschnitt)
        .map_or_else(|| "ohne Zuordnung".to_string(), str::to_string)
}

/// Die Teile des Systemeintrags in fester Folge (D7). Leer = keine wirksame Änderung. Empfänger
/// und Lage-Text sind Scrub-Spalten (LFH-752) und stehen ohne Wert.
fn etb_teile(alt: &Stand, neu: &Ziel, von_alt: &str, von_neu: &str) -> Vec<String> {
    let mut teile = Vec::new();
    if neu.meldungsart != alt.meldungsart {
        teile.push(format!(
            "Art {} → {}",
            art_label(alt.meldungsart),
            art_label(neu.meldungsart)
        ));
    }
    match (alt.lagerelevant, neu.lagerelevant) {
        (false, true) => teile.push("in die Lage übernommen".to_string()),
        (true, false) => teile.push("aus der Lage genommen".to_string()),
        _ => {}
    }
    if neu.prioritaet != alt.prioritaet {
        teile.push(format!(
            "Priorität {} → {}",
            prioritaet_label(alt.prioritaet),
            prioritaet_label(neu.prioritaet)
        ));
    }
    if neu.richtung != alt.richtung {
        teile.push(format!(
            "Richtung {} → {}",
            richtung_label(alt.richtung),
            richtung_label(neu.richtung)
        ));
    }
    if (neu.einheit_id, neu.abschnitt_id) != (alt.einheit_id, alt.abschnitt_id) {
        teile.push(format!("Von {von_alt} → {von_neu}"));
    }
    if neu.empfaenger != alt.empfaenger {
        teile.push("Empfänger geändert".to_string());
    }
    if neu.empfaenger_funktion != alt.funktion() {
        teile.push(format!(
            "Empfängerfunktion {} → {}",
            funktion_label(alt.funktion()),
            funktion_label(neu.empfaenger_funktion)
        ));
    }
    if neu.lagerelevant {
        let text_vorher = if alt.lagerelevant {
            alt.lage_text_wirksam()
        } else {
            &alt.inhalt
        };
        if neu.lage_text.as_deref().unwrap_or(&alt.inhalt) != text_vorher {
            teile.push("Lage-Text geändert".to_string());
        }
        let geo_vorher = if alt.lagerelevant { alt.geo() } else { None };
        match (geo_vorher, neu.geo) {
            (None, Some(_)) => teile.push("Verortung gesetzt".to_string()),
            (Some(a), Some(n)) if a != n => teile.push("Verortung geändert".to_string()),
            (Some(_), None) => teile.push("Verortung entfernt".to_string()),
            _ => {}
        }
    }
    teile
}

/// Name einer Einheit bzw. eines Abschnitts DIESES Einsatzes; eine fremde id ist ein Fehler des
/// Zusammenhangs (422, D3: die Korrektur ist eine bewusste Handlung und geht nicht still ins
/// Leere, anders als beim Erfassen).
async fn bezug_namen(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    einheit_id: Option<i64>,
    abschnitt_id: Option<i64>,
    pruefen: bool,
) -> Result<String, AppError> {
    let einheit: Option<String> = match einheit_id {
        Some(id) => {
            let name: Option<String> = sqlx::query_scalar(
                "SELECT name FROM einsatz_einheit WHERE id = ? AND einsatz_id = ?",
            )
            .bind(id)
            .bind(einsatz_id)
            .fetch_optional(&mut *conn)
            .await?;
            if pruefen && name.is_none() {
                return Err(AppError::UnprocessableEntity(
                    "Die Einheit gehört nicht zu diesem Einsatz".into(),
                ));
            }
            name
        }
        None => None,
    };
    let abschnitt: Option<String> = match abschnitt_id {
        Some(id) => {
            let name: Option<String> = sqlx::query_scalar(
                "SELECT name FROM einsatzabschnitt WHERE id = ? AND einsatz_id = ?",
            )
            .bind(id)
            .bind(einsatz_id)
            .fetch_optional(&mut *conn)
            .await?;
            if pruefen && name.is_none() {
                return Err(AppError::UnprocessableEntity(
                    "Der Abschnitt gehört nicht zu diesem Einsatz".into(),
                ));
            }
            name
        }
        None => None,
    };
    Ok(bezug_name(einheit.as_deref(), abschnitt.as_deref()))
}

/// Korrigiert eine Meldung des Einsatzes in EINER Transaktion: Stand lesen, Zusammenhang prüfen,
/// Spalten setzen, die Invariante „Art Lagemeldung ⇒ lagerelevant“ anwenden
/// ([`super::repo::apply_lage_invariante_tx`]) und den Systemeintrag schreiben (D7). Ohne
/// wirksame Änderung schreibt sie nichts. `NotFound`, wenn die Meldung nicht zum Einsatz gehört.
///
/// Übernahme und Rücknahme (D4, D5): kommt die Meldung in die Lage, ist die Übernahme `jetzt`
/// durch `von_id` und neu für die Kenntnisnahme; verlässt sie die Lage, werden Lage-Text,
/// Verortung, Übernahme und Kenntnisnahme leer. Ein geänderter Lage-Text macht sie wieder neu.
pub async fn korrigieren(
    pool: &SqlitePool,
    einsatz_id: i64,
    meldung_id: i64,
    von_id: i64,
    jetzt: &str,
    aenderung: &Aenderung,
) -> Result<Ergebnis, AppError> {
    crate::write_retry!(pool, |conn| {
        let alt: Stand = sqlx::query_as(
            "SELECT lfd_nr, meldungsart, prioritaet, richtung, einheit_id, abschnitt_id, \
                    empfaenger_funktion, \
                    empfaenger, inhalt, lagerelevant = 1 AS lagerelevant, lage_text, lat, lon \
             FROM meldung WHERE id = ? AND einsatz_id = ?",
        )
        .bind(meldung_id)
        .bind(einsatz_id)
        .fetch_optional(&mut *conn)
        .await?
        .ok_or(AppError::NotFound)?;
        let neu = ziel(&alt, aenderung)?;
        let bezug_geaendert =
            (neu.einheit_id, neu.abschnitt_id) != (alt.einheit_id, alt.abschnitt_id);
        let (von_alt, von_neu) = if bezug_geaendert {
            (
                bezug_namen(
                    &mut *conn,
                    einsatz_id,
                    alt.einheit_id,
                    alt.abschnitt_id,
                    false,
                )
                .await?,
                bezug_namen(
                    &mut *conn,
                    einsatz_id,
                    neu.einheit_id,
                    neu.abschnitt_id,
                    true,
                )
                .await?,
            )
        } else {
            (String::new(), String::new())
        };
        let teile = etb_teile(&alt, &neu, &von_alt, &von_neu);
        if teile.is_empty() {
            return Ok(Ergebnis { etb_id: None });
        }

        // Übernahme: bleibt, beginnt jetzt oder endet. Die Kenntnisnahme beginnt neu, wenn die
        // Meldung neu in die Lage kommt oder ihr Lage-Text sich ändert (Spec
        // `lagemeldung-kenntnisnahme`); eine geänderte Verortung lässt sie stehen.
        let neu_in_lage = neu.lagerelevant && !alt.lagerelevant;
        let text_geaendert = neu.lagerelevant
            && alt.lagerelevant
            && neu.lage_text.as_deref().unwrap_or(&alt.inhalt) != alt.lage_text_wirksam();
        let gesehen_bleibt = neu.lagerelevant && !neu_in_lage && !text_geaendert;
        sqlx::query(
            "UPDATE meldung SET meldungsart = ?1, prioritaet = ?2, richtung = ?3, \
               einheit_id = ?4, abschnitt_id = ?5, empfaenger = ?6, \
               lagerelevant = ?7, lage_text = ?8, lat = ?9, lon = ?10, \
               lage_uebergeben_at = CASE WHEN ?7 = 0 THEN NULL \
                                         WHEN ?11 = 1 THEN ?12 ELSE lage_uebergeben_at END, \
               lage_uebergeben_von_id = CASE WHEN ?7 = 0 THEN NULL \
                                             WHEN ?11 = 1 THEN ?13 ELSE lage_uebergeben_von_id END, \
               lage_gesehen_at = CASE WHEN ?14 = 1 THEN lage_gesehen_at END, \
               lage_gesehen_von_id = CASE WHEN ?14 = 1 THEN lage_gesehen_von_id END \
             WHERE id = ?15",
        )
        .bind(neu.meldungsart.as_str())
        .bind(neu.prioritaet.as_str())
        .bind(neu.richtung.as_str())
        .bind(neu.einheit_id)
        .bind(neu.abschnitt_id)
        .bind(neu.empfaenger.as_deref())
        .bind(neu.lagerelevant)
        .bind(neu.lage_text.as_deref())
        .bind(neu.geo.map(|(lat, _)| lat))
        .bind(neu.geo.map(|(_, lon)| lon))
        .bind(neu_in_lage)
        .bind(jetzt)
        .bind(von_id)
        .bind(gesehen_bleibt)
        .bind(meldung_id)
        .execute(&mut *conn)
        .await?;
        // Eigene Anweisung, damit die Platzhalter oben stehen bleiben (LLH-1381).
        if neu.empfaenger_funktion != alt.funktion() {
            sqlx::query("UPDATE meldung SET empfaenger_funktion = ? WHERE id = ?")
                .bind(neu.empfaenger_funktion.map(|f| f.as_str()))
                .bind(meldung_id)
                .execute(&mut *conn)
                .await?;
        }
        super::repo::apply_lage_invariante_tx(&mut *conn, meldung_id).await?;

        let startwert = crate::einsatz::einstellungen::laden_oder_default(&mut *conn, einsatz_id)
            .await?
            .etb_startwert();
        let inhalt = format!("Meldung #{}: {}", alt.lfd_nr, teile.join("; "));
        let etb_id =
            crate::etb::system_audit_tx(&mut *conn, einsatz_id, von_id, startwert, &inhalt).await?;
        sqlx::query("UPDATE etb_eintrag SET meldung_id = ? WHERE id = ?")
            .bind(meldung_id)
            .bind(etb_id)
            .execute(&mut *conn)
            .await?;
        Ok(Ergebnis {
            etb_id: Some(etb_id),
        })
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn stand() -> Stand {
        Stand {
            lfd_nr: 12,
            meldungsart: Meldungsart::Sonstige,
            prioritaet: Prioritaet::Normal,
            richtung: Richtung::Intern,
            einheit_id: None,
            abschnitt_id: None,
            empfaenger: None,
            empfaenger_funktion: Some("s3".into()),
            inhalt: "Brücke gesperrt".into(),
            lagerelevant: false,
            lage_text: None,
            lat: None,
            lon: None,
        }
    }

    fn in_der_lage() -> Stand {
        Stand {
            lagerelevant: true,
            lage_text: Some("Brücke Nord gesperrt".into()),
            lat: Some(52.0),
            lon: Some(9.0),
            ..stand()
        }
    }

    fn teile(alt: &Stand, a: &Aenderung) -> Vec<String> {
        etb_teile(alt, &ziel(alt, a).unwrap(), "ohne Zuordnung", "1. Zug")
    }

    fn ist_422(r: Result<Ziel, AppError>) -> bool {
        matches!(r, Err(AppError::UnprocessableEntity(_)))
    }

    #[test]
    fn teile_stehen_in_fester_folge() {
        let a = Aenderung {
            meldungsart: Some(Meldungsart::Lagemeldung),
            prioritaet: Some(Prioritaet::Dringend),
            richtung: Some(Richtung::Extern),
            bezug: Some((Some(4), None)),
            empfaenger: Some(Some("Leitstelle".into())),
            lage_text: Some(Some("Brücke Nord".into())),
            geo: Some(Some((52.0, 9.0))),
            ..Default::default()
        };
        assert_eq!(
            teile(&stand(), &a),
            [
                "Art Sonstige → Lagemeldung",
                "in die Lage übernommen",
                "Priorität Normal → Dringend",
                "Richtung Intern → Extern",
                "Von ohne Zuordnung → 1. Zug",
                "Empfänger geändert",
                "Lage-Text geändert",
                "Verortung gesetzt",
            ]
        );
    }

    #[test]
    fn gleiche_werte_ergeben_keine_teile() {
        let a = Aenderung {
            meldungsart: Some(Meldungsart::Sonstige),
            prioritaet: Some(Prioritaet::Normal),
            bezug: Some((None, None)),
            empfaenger: Some(None),
            ..Default::default()
        };
        assert!(teile(&stand(), &a).is_empty());
        // Lage-Text gleich dem Wortlaut zählt wie „leer“.
        let a = Aenderung {
            lage_text: Some(Some("Brücke gesperrt".into())),
            ..Default::default()
        };
        let alt = Stand {
            lagerelevant: true,
            ..stand()
        };
        assert!(teile(&alt, &a).is_empty());
        assert_eq!(ziel(&alt, &a).unwrap().lage_text, None);
    }

    #[test]
    fn ruecknahme_leert_die_lage_angaben() {
        let a = Aenderung {
            lagerelevant: Some(false),
            ..Default::default()
        };
        let z = ziel(&in_der_lage(), &a).unwrap();
        assert!(!z.lagerelevant);
        assert_eq!((z.lage_text, z.geo), (None, None));
        assert_eq!(teile(&in_der_lage(), &a), ["aus der Lage genommen"]);
    }

    #[test]
    fn neue_uebernahme_beginnt_ohne_alte_angaben() {
        // Ein Altstand mit Resten (Handeingriff) trägt sie nicht in die neue Übernahme.
        let alt = Stand {
            lagerelevant: false,
            ..in_der_lage()
        };
        let z = ziel(
            &alt,
            &Aenderung {
                lagerelevant: Some(true),
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!((z.lage_text, z.geo), (None, None));
    }

    #[test]
    fn verortung_gesetzt_geaendert_entfernt() {
        let alt = in_der_lage();
        let mit = |geo| Aenderung {
            geo: Some(geo),
            ..Default::default()
        };
        assert_eq!(teile(&alt, &mit(Some((52.1, 9.0)))), ["Verortung geändert"]);
        assert_eq!(teile(&alt, &mit(None)), ["Verortung entfernt"]);
        assert!(teile(&alt, &mit(Some((52.0, 9.0)))).is_empty());
    }

    #[test]
    fn lagemeldung_bleibt_in_der_lage() {
        let alt = Stand {
            meldungsart: Meldungsart::Lagemeldung,
            ..in_der_lage()
        };
        assert!(ist_422(ziel(
            &alt,
            &Aenderung {
                lagerelevant: Some(false),
                ..Default::default()
            }
        )));
        // Weg von Lagemeldung: die Lagerelevanz bleibt samt Angaben.
        let z = ziel(
            &alt,
            &Aenderung {
                meldungsart: Some(Meldungsart::Rueckmeldung),
                ..Default::default()
            },
        )
        .unwrap();
        assert!(z.lagerelevant);
        assert_eq!(z.geo, Some((52.0, 9.0)));
    }

    #[test]
    fn heraufstufen_zu_sofort_ist_422_herabstufen_geht() {
        let prio = |p| Aenderung {
            prioritaet: Some(p),
            ..Default::default()
        };
        assert!(ist_422(ziel(&stand(), &prio(Prioritaet::Sofort))));
        assert!(ist_422(ziel(
            &stand(),
            &Aenderung {
                meldungsart: Some(Meldungsart::Sofortmeldung),
                ..Default::default()
            }
        )));
        let sofort = Stand {
            prioritaet: Prioritaet::Sofort,
            ..stand()
        };
        assert!(ziel(&sofort, &prio(Prioritaet::Normal)).is_ok());
        // Schon sofort: die Art „Sofortmeldung“ dazu ist kein Heraufstufen.
        assert!(ziel(
            &sofort,
            &Aenderung {
                meldungsart: Some(Meldungsart::Sofortmeldung),
                ..Default::default()
            }
        )
        .is_ok());
    }

    #[test]
    fn lage_angaben_ausserhalb_der_lage_und_doppelter_bezug_sind_422() {
        assert!(ist_422(ziel(
            &stand(),
            &Aenderung {
                lage_text: Some(None),
                ..Default::default()
            }
        )));
        assert!(ist_422(ziel(
            &in_der_lage(),
            &Aenderung {
                lagerelevant: Some(false),
                geo: Some(None),
                ..Default::default()
            }
        )));
        assert!(ist_422(ziel(
            &stand(),
            &Aenderung {
                bezug: Some((Some(1), Some(2))),
                ..Default::default()
            }
        )));
    }

    #[test]
    fn von_nennt_einheit_oder_abschnitt() {
        assert_eq!(bezug_name(Some("Florian Nord 1"), None), "Florian Nord 1");
        assert_eq!(bezug_name(None, Some("EA Nord")), "EA Nord");
        assert_eq!(bezug_name(None, None), "ohne Zuordnung");
    }

    #[test]
    fn empfaengerfunktion_nennt_alt_und_neu() {
        let funktion = |f| Aenderung {
            empfaenger_funktion: Some(f),
            ..Default::default()
        };
        assert_eq!(
            teile(&stand(), &funktion(Some(Fuehrungsfunktion::S2))),
            ["Empfängerfunktion S3 → S2"]
        );
        assert_eq!(
            teile(&stand(), &funktion(None)),
            ["Empfängerfunktion S3 → keine"]
        );
        let ohne = Stand {
            empfaenger_funktion: None,
            ..stand()
        };
        assert_eq!(
            teile(&ohne, &funktion(Some(Fuehrungsfunktion::El))),
            ["Empfängerfunktion keine → EL"]
        );
        // Gleiche Funktion oder keine Angabe: nichts.
        assert!(teile(&stand(), &funktion(Some(Fuehrungsfunktion::S3))).is_empty());
        assert_eq!(
            ziel(&stand(), &Aenderung::default())
                .unwrap()
                .empfaenger_funktion,
            Some(Fuehrungsfunktion::S3)
        );
        // Neben dem Freitext-Empfänger, in dieser Folge.
        let beide = Aenderung {
            empfaenger: Some(Some("Leitstelle".into())),
            empfaenger_funktion: Some(Some(Fuehrungsfunktion::S2)),
            ..Default::default()
        };
        assert_eq!(
            teile(&stand(), &beide),
            ["Empfänger geändert", "Empfängerfunktion S3 → S2"]
        );
    }
}
