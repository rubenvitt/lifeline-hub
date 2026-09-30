//! Checkliste Arbeitsaufnahme der Führungseinheit (LFH-551).
//!
//! **Ein Arbeitsmittel am Fahrzeug, kein Führungsnachweis.** Sieben feste Punkte für die ersten
//! Minuten eines Einsatzes (LFS-BW F5-I Kap. 5, S. 33–34; HLFS „Aufgaben S3“ Kap. 5, S. 12 —
//! Lehrmeinung). Ein Haken schreibt deshalb **keinen** System-ETB-Eintrag, mit einer Ausnahme:
//! die Meldung der Einsatzbereitschaft an die Leitstelle, die die FwDV 100 selbst dokumentiert
//! sehen will (Anlage 5, S. 64). Auch deren Rücknahme wird belegt (Entscheidung E1 = A): das
//! ETB ist append-only, und ein Fehlklick ohne Gegenbeleg liesse dort eine Meldung stehen, die
//! es nie gab.
//!
//! **Keine Zeile = offen, ohne Bemerkung.** Die sieben festen Zeilen baut das Frontend aus
//! `stab/checkliste.ts` (Text und Quelle je Punkt); eine Leerzeile vom Server wäre ein
//! erfundener Datensatz (Muster `StabAnzeige.besetzung`).
//!
//! Design: `openspec/changes/archive/2026-09-30-lfh-551-stab-checkliste-arbeitsaufnahme/design.md`

use serde::Serialize;
use sqlx::{SqliteConnection, SqlitePool};
use utoipa::ToSchema;

use crate::error::AppError;
use crate::wire_enum::wire_enum;
use crate::write_retry;

wire_enum! {
    /// Punkt der Checkliste. Wire == `as_str()`.
    ///
    /// `ALLE` ist die Anzeigereihenfolge und Teil des Vertrags: das Frontend prüft seine Vorlage
    /// gegen den generierten Typ in derselben Reihenfolge.
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
    pub enum ChecklistenPunkt {
        Aufstellort => "aufstellort",
        Einweisung => "einweisung",
        Lageskizze => "lageskizze",
        Funkarbeitsplaetze => "funkarbeitsplaetze",
        Sprechgruppen => "sprechgruppen",
        EtbEroeffnet => "etb_eroeffnet",
        LeitstelleGemeldet => "leitstelle_gemeldet",
    }
    try_from = |s| format!("Ungültiger Checklisten-Punkt: {s}");
}

impl ChecklistenPunkt {
    /// Der ETB-Beleg eines wirksamen Übergangs — `None` für jeden Punkt ausser der Meldung an
    /// die Leitstelle. Liegt im Backend, weil ein ETB-Text ein Führungsnachweis ist und nicht
    /// davon abhängen darf, welches Frontend ihn erzeugt hat (wie `Sachgebiet::label`).
    pub fn etb_beleg(&self, erledigt: bool) -> Option<&'static str> {
        match (self, erledigt) {
            (ChecklistenPunkt::LeitstelleGemeldet, true) => Some(
                "Arbeitsaufnahme: Einsatzbereitschaft der Führungseinheit an die Leitstelle gemeldet",
            ),
            (ChecklistenPunkt::LeitstelleGemeldet, false) => Some(
                "Arbeitsaufnahme: Meldung der Einsatzbereitschaft an die Leitstelle zurückgenommen",
            ),
            _ => None,
        }
    }
}

/// Maximale Länge der Bemerkung je Punkt (Zeichen, nach dem Trimmen).
pub const BEMERKUNG_MAX: usize = 500;

/// Ein gespeicherter Punkt der Checkliste.
///
/// `erledigt_at`/`erledigt_von_id` sind genau dann gesetzt, wenn `erledigt` (CHECK in der
/// Tabelle); `bemerkung` fehlt, wenn keine gesetzt ist.
#[derive(Debug, Clone, Serialize, sqlx::FromRow, ToSchema)]
pub struct ChecklistenEintrag {
    #[sqlx(try_from = "String")]
    pub punkt: ChecklistenPunkt,
    pub erledigt: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub erledigt_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub erledigt_von_id: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bemerkung: Option<String>,
    pub geaendert_von_id: i64,
    pub geaendert_at: String,
}

/// Validierte Eingabe: `None` = Feld unverändert lassen. `bemerkung: Some(None)` löscht.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PunktEingabe {
    pub erledigt: Option<bool>,
    pub bemerkung: Option<Option<String>>,
}

/// Ergebnis von [`setzen`]: die Checkliste nach dem Commit, ob überhaupt geschrieben wurde (nur
/// dann ein Live-Ereignis), und die id eines ETB-Belegs für den ETB-Kurzruf des Aufrufers.
#[derive(Debug)]
pub struct Gesetzt {
    pub liste: Vec<ChecklistenEintrag>,
    pub geschrieben: bool,
    pub etb_eintrag_id: Option<i64>,
}

const SELECT_EINTRAEGE: &str = "SELECT punkt, erledigt, erledigt_at, erledigt_von_id, bemerkung, \
            geaendert_von_id, geaendert_at \
     FROM einsatz_stab_checkliste WHERE einsatz_id = ?";

/// Die gespeicherten Punkte eines Einsatzes in `ALLE`-Reihenfolge.
///
/// Sortiert wird hier und nicht in SQL: die Reihenfolge ist die des Enums, nicht die
/// alphabetische der Wire-Werte.
pub async fn laden(
    pool: &SqlitePool,
    einsatz_id: i64,
) -> Result<Vec<ChecklistenEintrag>, AppError> {
    let mut conn = pool.acquire().await?;
    laden_conn(&mut conn, einsatz_id).await
}

async fn laden_conn(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
) -> Result<Vec<ChecklistenEintrag>, AppError> {
    let mut zeilen = sqlx::query_as::<_, ChecklistenEintrag>(SELECT_EINTRAEGE)
        .bind(einsatz_id)
        .fetch_all(&mut *conn)
        .await?;
    zeilen.sort_by_key(|z| ChecklistenPunkt::ALLE.iter().position(|p| *p == z.punkt));
    Ok(zeilen)
}

/// Setzt Haken und/oder Bemerkung eines Punkts (Upsert) und schreibt bei einem **wirksamen**
/// Übergang des Meldungspunkts den ETB-Beleg in **derselben** Transaktion.
///
/// Idempotent: derselbe Aufruf zweimal ergibt denselben Zustand; ein erneutes „erledigt“ lässt
/// `erledigt_at` stehen und schreibt keinen zweiten Beleg. Der Zeilen-Write selbst ist
/// unbedingt (`geaendert_at` hält den Klick fest) — dieselbe Aufteilung wie bei der Besetzung.
///
/// Ein Aufruf ohne Wirkung auf einen Punkt ohne Zeile (Haken entfernen, Bemerkung leeren)
/// schreibt nichts — [`Gesetzt::geschrieben`] ist dann `false`.
pub async fn setzen(
    pool: &SqlitePool,
    einsatz_id: i64,
    punkt: ChecklistenPunkt,
    benutzer_id: i64,
    eingabe: &PunktEingabe,
) -> Result<Gesetzt, AppError> {
    let etb_startwert = crate::einsatz::einstellungen::etb_startwert(pool, einsatz_id).await?;

    let wirkung = write_retry!(pool, |conn| {
        super::repo::fordere_aktiv_in_tx(conn, einsatz_id).await?;

        // Vorherstand: nur der Haken entscheidet über den Beleg. `None` = keine Zeile.
        let vorher_zeile: Option<bool> = sqlx::query_scalar(
            "SELECT erledigt FROM einsatz_stab_checkliste WHERE einsatz_id = ? AND punkt = ?",
        )
        .bind(einsatz_id)
        .bind(punkt.as_str())
        .fetch_optional(&mut *conn)
        .await?;
        let vorher = vorher_zeile.unwrap_or(false);

        // Ohne Zeile legt nur ein Haken oder eine Bemerkung eine an. „Offen, ohne Bemerkung“ ist
        // der Normalzustand; eine Zeile, die ihn nur wiederholt, wäre ein erfundener Datensatz
        // (Muster `repo::entfernen`: ohne Wirkung kein Write und kein Live-Ereignis).
        let legt_an = eingabe.erledigt == Some(true) || matches!(eingabe.bemerkung, Some(Some(_)));
        if vorher_zeile.is_none() && !legt_an {
            return Ok(None);
        }

        // Ein fehlendes Feld bleibt unverändert — deshalb je Feld ein Schalter statt eines
        // Vollersatzes: zwei Schirme (A hakt ab, B schreibt eine Bemerkung) überschreiben sich
        // sonst gegenseitig die andere Angabe.
        let (setzt_erledigt, erledigt) = match eingabe.erledigt {
            Some(e) => (true, e),
            None => (false, vorher),
        };
        let (setzt_bemerkung, bemerkung) = match &eingabe.bemerkung {
            Some(b) => (true, b.clone()),
            None => (false, None),
        };

        sqlx::query(
            "INSERT INTO einsatz_stab_checkliste \
                (einsatz_id, punkt, erledigt, erledigt_at, erledigt_von_id, bemerkung, \
                 geaendert_von_id, geaendert_at) \
             VALUES (?1, ?2, ?3, \
                     CASE WHEN ?3 = 1 THEN datetime('now') END, \
                     CASE WHEN ?3 = 1 THEN ?4 END, \
                     ?5, ?4, datetime('now')) \
             ON CONFLICT(einsatz_id, punkt) DO UPDATE SET \
                erledigt = CASE WHEN ?6 = 1 THEN excluded.erledigt ELSE erledigt END, \
                erledigt_at = CASE \
                    WHEN ?6 = 0 THEN erledigt_at \
                    WHEN excluded.erledigt = 0 THEN NULL \
                    ELSE COALESCE(erledigt_at, excluded.erledigt_at) END, \
                erledigt_von_id = CASE \
                    WHEN ?6 = 0 THEN erledigt_von_id \
                    WHEN excluded.erledigt = 0 THEN NULL \
                    ELSE COALESCE(erledigt_von_id, excluded.erledigt_von_id) END, \
                bemerkung = CASE WHEN ?7 = 1 THEN excluded.bemerkung ELSE bemerkung END, \
                geaendert_von_id = excluded.geaendert_von_id, \
                geaendert_at = excluded.geaendert_at",
        )
        .bind(einsatz_id)
        .bind(punkt.as_str())
        .bind(erledigt)
        .bind(benutzer_id)
        .bind(bemerkung.as_deref())
        .bind(setzt_erledigt)
        .bind(setzt_bemerkung)
        .execute(&mut *conn)
        .await?;

        // Der Beleg ist BEDINGT: nur ein wirksamer Übergang des Hakens. Ein Doppelklick oder ein
        // Retry nach verlorener Antwort schriebe sonst eine scheinbar zweite Meldung ins ETB.
        if erledigt == vorher {
            return Ok(Some(None));
        }
        match punkt.etb_beleg(erledigt) {
            Some(inhalt) => {
                crate::etb::system_audit_tx(conn, einsatz_id, benutzer_id, etb_startwert, inhalt)
                    .await
                    .map(|id| Some(Some(id)))
            }
            None => Ok(Some(None)),
        }
    })?;

    Ok(Gesetzt {
        liste: laden(pool, einsatz_id).await?,
        geschrieben: wirkung.is_some(),
        etb_eintrag_id: wirkung.flatten(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn punkt_round_trip_ueber_alle() {
        for p in ChecklistenPunkt::ALLE {
            assert_eq!(ChecklistenPunkt::parse(p.as_str()), Some(p), "{p:?}");
        }
        assert_eq!(ChecklistenPunkt::parse(""), None);
        assert_eq!(
            ChecklistenPunkt::parse("Lageskizze"),
            None,
            "Wire ist kleingeschrieben"
        );
        assert_eq!(ChecklistenPunkt::parse("patienten"), None);
    }

    /// Nur der Meldungspunkt belegt, und zwar in beide Richtungen mit verschiedenem Text.
    #[test]
    fn nur_die_meldung_an_die_leitstelle_hat_einen_beleg() {
        for p in ChecklistenPunkt::ALLE {
            let belegt = p.etb_beleg(true).is_some() || p.etb_beleg(false).is_some();
            assert_eq!(belegt, p == ChecklistenPunkt::LeitstelleGemeldet, "{p:?}");
        }
        let hin = ChecklistenPunkt::LeitstelleGemeldet
            .etb_beleg(true)
            .unwrap();
        let zurueck = ChecklistenPunkt::LeitstelleGemeldet
            .etb_beleg(false)
            .unwrap();
        assert_ne!(hin, zurueck);
        assert!(zurueck.contains("zurückgenommen"));
    }

    #[test]
    fn alle_hat_sieben_punkte_in_vertragsreihenfolge() {
        let wire: Vec<&str> = ChecklistenPunkt::ALLE.iter().map(|p| p.as_str()).collect();
        assert_eq!(
            wire,
            [
                "aufstellort",
                "einweisung",
                "lageskizze",
                "funkarbeitsplaetze",
                "sprechgruppen",
                "etb_eroeffnet",
                "leitstelle_gemeldet",
            ]
        );
    }
}
