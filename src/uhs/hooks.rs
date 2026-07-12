//! Cross-Modul-Hooks der UHS-Domäne (LFH-124). Rein pool-basiert — die
//! SSE-/Transport-Emission bleibt Sache des aufrufenden Route-Handlers, damit die
//! Domäne nicht an `AppState`/`live` koppelt. Vorher lag dieser Hook als
//! `routes::einsatz_uhs::auto_austritt` in einem Route-Modul und wurde von
//! `routes::einsatz_person` route-übergreifend aufgerufen.
use crate::error::AppError;
use crate::etb::{self, repo as etb_repo};
use crate::person::{registrier_anzeige, repo as person_repo};
use crate::uhs::belegung_repo::{self, AustrittInfo};
use crate::uhs::repo as uhs_repo;
use sqlx::SqlitePool;

/// Ergebnis eines tatsächlich erfolgten Auto-Austritts. Trägt, was der aufrufende
/// Route-Handler per SSE emittieren muss: den frisch geschriebenen ETB-Eintrag
/// (ETB-Live-Stream) sowie die betroffene `uhs_id`/`person_id` (Board-Events).
#[derive(Debug)]
pub struct AutoAustrittEffekt {
    pub uhs_id: i64,
    pub person_id: i64,
    pub etb_eintrag: etb::EtbEintragAnzeige,
}

/// Auto-Austritt einer Person aus ihrer UHS-Belegung (Cross-Modul-Hook: Personen-Storno,
/// Status verstorben/abgemeldet, Verbleib Transport/Entlassung). Führt den belegung-Austritt
/// aus und schreibt — falls tatsächlich ein Austritt-Event passiert ist — den pseudonymen
/// ETB-System-Eintrag mit Anlass-Notiz. Rein pool-basiert.
///
/// Gibt `Some(effekt)` zurück, wenn ein Austritt stattfand, damit der Route-Handler die
/// SSE-Events emittiert (Transport bleibt in der Route, LFH-124). `None`, wenn die Person
/// nicht belegt war — der Reservierungs-Cleanup lief dann trotzdem. **Wird sequentiell nach
/// dem auslösenden Repo-Update gerufen (Codebase-Konvention für Cross-Modul-Wirkung;
/// akzeptiertes Risiko-Fenster).**
pub async fn auto_austritt(
    pool: &SqlitePool,
    einsatz_id: i64,
    person_id: i64,
    anlass: &str,
    benutzer_id: i64,
) -> Result<Option<AutoAustrittEffekt>, AppError> {
    let info: Option<AustrittInfo> =
        belegung_repo::austritt_intern(pool, einsatz_id, person_id, Some(anlass), benutzer_id)
            .await?;
    let Some(info) = info else {
        return Ok(None); // Person war nicht belegt — Reservierungs-Cleanup ist trotzdem gelaufen.
    };
    let person = person_repo::laden(pool, einsatz_id, person_id).await?;
    let uhs = uhs_repo::laden(pool, einsatz_id, info.uhs_id).await?;
    let r = registrier_anzeige(person.registrier_nr);
    let text = format!("Person {r}: verlässt {} ({anlass})", uhs.bezeichnung);
    let etb_eintrag = etb_repo::anlegen(
        pool,
        einsatz_id,
        benutzer_id,
        etb_repo::EintragDaten {
            typ: etb::TYP_SYSTEM,
            inhalt: &text,
            von: None,
            an: None,
            meldeweg: None,
            veranlassung: None,
            ereigniszeit: None,
            erfasst_lokal_at: None,
            berichtigt_eintrag_id: None,
        },
    )
    .await?;
    Ok(Some(AutoAustrittEffekt {
        uhs_id: info.uhs_id,
        person_id,
        etb_eintrag,
    }))
}
