pub mod anhang;
pub mod auftrag;
pub mod auth;
pub mod backup;
pub mod befehl;
pub mod benutzer;
pub mod benutzer_einstellungen;
pub mod chat;
#[cfg(feature = "dev-seeds")]
pub mod dev;
pub mod einheit_typ;
pub mod einsatz;
pub mod einsatz_bereitstellungsraum;
pub mod einsatz_einheit;
pub mod einsatz_fahrzeug;
pub mod einsatz_material;
pub mod einsatz_person;
pub mod einsatz_personal;
pub mod einsatz_schaden;
pub mod einsatz_tier;
pub mod einsatz_uhs;
pub mod einsatzabschnitt;
pub mod erinnerung;
pub mod etb;
pub mod etb_baustein;
pub mod fahrzeug;
pub mod fahrzeug_status;
pub mod freies_zeichen;
pub mod gefahr;
pub mod health;
pub mod karte;
pub mod karte_hintergrundbild;
pub mod karten_ansicht;
pub mod lage_snapshot;
pub mod lage_zone;
pub mod lagebericht;
pub mod live;
pub mod material;
pub mod meldung;
pub mod nachforderung;
pub mod org_einstellungen;
pub mod organisation;
pub mod ort_vorschau;
pub mod personal;
pub mod personal_status;
pub mod qualifikation;
pub mod sprechgruppe;
pub mod stichwort;
pub mod support;

use crate::app::AppState;
use crate::error::AppError;

/// Legt einen System-ETB-Eintrag DEGRADIERT an (F06/LFH-244, Tier-B): schlägt der ETB-Write
/// NACH dem bereits committeten Domänen-Write fehl, wird der Fehler NICHT fatal propagiert
/// (kein falscher 500) — er wird geloggt, die Domänen-Aktion samt ihres SSE-Broadcasts bleibt
/// bestehen, nur der zusätzliche ETB-SSE entfällt. Ersetzt die 12 modul-lokalen
/// `etb_system`-Kopien. Wo echte Atomarität gefordert ist, nutzt der Handler stattdessen
/// [`crate::etb::system_audit_tx`] innerhalb einer `write_retry!`-Transaktion (Tier-A).
///
/// Rückgabe ist **immer `Ok(())`** — der ETB-Fehler wird bewusst verschluckt (nicht fatal).
/// Das `?` an den Bestands-Aufrufstellen ist damit ein bewusster No-op (bleibt kompatibel,
/// bis Tier-A den jeweiligen Aufruf in eine atomare `write_retry!`-Tx zieht).
pub(crate) async fn etb_system_degradiert(
    state: &AppState,
    einsatz_id: i64,
    benutzer_id: i64,
    inhalt: &str,
) -> Result<(), AppError> {
    match crate::etb::system_audit(&state.pool, einsatz_id, benutzer_id, inhalt).await {
        Ok(anzeige) => state.live.publiziere(einsatz_id, anzeige.id),
        Err(e) => {
            tracing::error!(
                einsatz_id,
                fehler = ?e,
                "System-ETB-Eintrag fehlgeschlagen (degradiert, nicht fatal)"
            );
        }
    }
    Ok(())
}
