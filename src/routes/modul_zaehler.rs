//! Modulzähler des Einsatz-Navigationsrahmens (LFH-612). Fachlogik und Bedeutung je Modul:
//! [`crate::einsatz::zaehler`].

use crate::app::AppState;
use crate::einsatz::berechtigung::modul_freigaben;
use crate::einsatz::kontext::EinsatzLesezugriff;
use crate::einsatz::zaehler::{self, ModulZaehlerAnzeige};
use crate::error::AppError;
use axum::extract::State;
use axum::Json;

/// GET /api/einsaetze/{id}/modul-zaehler — ein Zähler je erlaubtem Modul.
///
/// `EinsatzLesezugriff<OhneModul>`: Org-Floor + Lesezugriff, **kein** Modul-Gate — die Route
/// gehört keinem Modul (wie `/live`). Die Modulrechte wirken als Filter über die Felder: ein
/// nicht erlaubtes Modul fehlt in der Antwort, statt dass die ganze Antwort 403 wäre.
pub async fn liste(
    State(state): State<AppState>,
    ctx: EinsatzLesezugriff,
) -> Result<Json<ModulZaehlerAnzeige>, AppError> {
    let einsatz_id = ctx.einsatz.id;
    let freigaben = modul_freigaben(
        &state.pool,
        einsatz_id,
        ctx.einsatz.org_id,
        &ctx.benutzer,
        ctx.modul_rolle(),
    )
    .await?;
    // Wie `erlaubte_module`; dazu, was die Person sieht (LLH-1908, `zaehler::berechne`).
    let mut erlaubt: std::collections::HashSet<&'static str> = freigaben
        .iter()
        .filter(|(_, f)| f.zugriff)
        .map(|(key, _)| *key)
        .collect();
    let sichtbar: std::collections::HashSet<&'static str> = freigaben
        .iter()
        .filter(|(_, f)| f.sichtbar)
        .map(|(key, _)| *key)
        .collect();
    // Ein Gerät (LFH-892) zählt nur die Module seiner Ansicht.
    if let Some(g) = &ctx.geraet {
        erlaubt = g.schneide_module(erlaubt);
        // Personen und Meldungen zählen den ganzen Einsatz; ein Gerät sieht nur die Personen
        // seiner Stelle und nur die eigenen Meldungen, auch ohne Stelle (Verpflegung, LFH-1044),
        // und bekommt diese Zähler deshalb nie. Betreuung zählt ebenfalls den ganzen Einsatz; ein
        // stellengebundenes Gerät sieht nur seine Stelle (Stellenbindung).
        erlaubt.remove("personen");
        erlaubt.remove("meldungen");
        // Nachforderungen zählt der Server einsatzweit (LLH-1078); heute sieht keine Ansicht das
        // Modul, und wenn eine es bekommt, dann für ihre Stelle, nicht für den ganzen Einsatz.
        erlaubt.remove("nachforderungen");
        if crate::geraet::stelle::ist_gebunden(Some(g)) {
            erlaubt.remove("betreuung");
            // Ein Abschnittsgerät sieht nur seinen Teilbaum (LFH-1043); die einsatzweiten
            // Zähler dieser Module verrieten den Rest des Einsatzes.
            erlaubt.remove("einsatzabschnitte");
            erlaubt.remove("einheiten");
            erlaubt.remove("auftraege");
        }
    }
    let jetzt = crate::zeit::jetzt();
    Ok(Json(
        zaehler::berechne(
            &state.pool,
            einsatz_id,
            &ctx.benutzer,
            &erlaubt,
            &sichtbar,
            &jetzt,
        )
        .await?,
    ))
}
