//! Quittung einer Empfängerzeile (Achse 1), gemeinsam für die Leitung, gekoppelte Geräte
//! (`routes::auftrag::quittieren`) und die Helfer-App (`routes::helfer::auftrag_quittieren`,
//! ADR-0105: kein eigener Quittungsweg). Die Prüfung, ob die Zeile dem Aufrufer gehört, bleibt beim
//! Handler.

use crate::app::AppState;
use crate::auftrag::repo;
use crate::error::AppError;
use crate::live::LiveEvent;
use crate::zeit::jetzt;

/// Quittiert `empfaenger_id` für `benutzer_id`: Quittung (idempotent, 422 bei aufgehobenem
/// Auftrag), Benachrichtigung des Erstellers bei der ersten Quittung, Schließen der
/// Fristerinnerung, sobald alle quittiert haben, Live `auftrag` und die Helfer-Apps des Auftrags
/// (`helfer::pager::notify_changed`). Liefert, ob es die erste Quittung der Zeile war.
pub async fn acknowledge(
    state: &AppState,
    einsatz_id: i64,
    auftrag_id: i64,
    empfaenger_id: i64,
    benutzer_id: i64,
) -> Result<bool, AppError> {
    let erste_quittung =
        repo::quittiere_empfaenger(&state.pool, empfaenger_id, benutzer_id, &jetzt()).await?;
    let d = repo::laden(&state.pool, auftrag_id, &jetzt()).await?;
    // Nur die erste Quittung der Zeile meldet dem Auftraggeber; eine wiederholte bleibt still.
    if erste_quittung {
        crate::auftrag::benachrichtigung::quittiert(
            &state.pool,
            &state.live,
            einsatz_id,
            empfaenger_id,
            d.auftrag.erstellt_von_id,
            benutzer_id,
        )
        .await;
    }
    // LFH-118: sobald ALLE Empfänger quittiert haben, ist der Auftrag nicht mehr überfällig →
    // die Auto-Frist-Erinnerung schließen (verstummt den Nachfass). Solange ein Empfänger offen
    // ist, bleibt sie offen.
    if d.auftrag.empfaenger_anzahl > 0 && d.auftrag.empfaenger_anzahl == d.auftrag.quittiert_anzahl
    {
        crate::erinnerung::repo::schliesse_offene_auto(
            &state.pool,
            crate::kommunikation::OBJEKT_AUFTRAG,
            auftrag_id,
            &jetzt(),
        )
        .await?;
    }
    state
        .live
        .publiziere_einsatz(einsatz_id, LiveEvent::Auftrag);
    if erste_quittung {
        crate::helfer::pager::notify_changed(state, einsatz_id, auftrag_id).await;
    }
    Ok(erste_quittung)
}
