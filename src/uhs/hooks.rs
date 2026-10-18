//! Cross-Modul-Hooks der UHS-Domäne (LFH-124). Rein pool-basiert; die SSE-Emission bleibt beim
//! aufrufenden Route-Handler, damit die Domäne nicht an `AppState`/`live` koppelt.
use crate::error::AppError;
use crate::etb::{self, repo as etb_repo};
use crate::person::{registrier_anzeige, repo as person_repo};
use crate::uhs::belegung_repo::{self, AustrittInfo};
use crate::uhs::repo as uhs_repo;
use sqlx::{SqliteConnection, SqlitePool};

/// Ergebnis eines erfolgten Auto-Austritts: was der Route-Handler per SSE emittieren muss (den
/// neuen ETB-Eintrag sowie `uhs_id`/`person_id` für die Board-Events).
#[derive(Debug)]
pub struct AutoAustrittEffekt {
    pub uhs_id: i64,
    pub person_id: i64,
    pub etb_eintrag: etb::EtbEintragAnzeige,
}

/// Auto-Austritt einer Person aus ihrer UHS-Belegung (Personen-Storno, Status
/// verstorben/abgemeldet, Verbleib Transport/Entlassung). Schreibt bei einem echten Austritt den
/// pseudonymen System-ETB-Eintrag mit Anlass-Notiz.
///
/// `Some(effekt)` bei einem Austritt, damit der Handler die SSE-Events emittiert; `None`, wenn
/// die Person nicht belegt war (der Reservierungs-Cleanup lief trotzdem). **Wird sequentiell
/// nach dem auslösenden Repo-Update gerufen** (Konvention für Cross-Modul-Wirkung; akzeptiertes
/// Risiko-Fenster).
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

/// Was ein Auto-Austritt in einer laufenden Transaktion hinterlässt: der ETB-Eintrag und die
/// Kennungen für die Board-Events nach dem Commit.
#[derive(Debug)]
pub struct AutoAustrittTx {
    pub uhs_id: i64,
    pub person_id: i64,
    pub etb_id: i64,
}

/// [`auto_austritt`] in der Transaktion des auslösenden Schritts (Verbleib, LLH-1138): Austritt,
/// Reservierungs-Cleanup und der pseudonyme System-ETB-Eintrag fallen mit ihm oder gar nicht.
/// `startwert` reicht der pool-besitzende Aufrufer durch (LFH-133).
pub async fn auto_austritt_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    person_id: i64,
    anlass: &str,
    benutzer_id: i64,
    startwert: i64,
) -> Result<Option<AutoAustrittTx>, AppError> {
    let Some(info) =
        belegung_repo::austritt_intern_tx(conn, einsatz_id, person_id, Some(anlass), benutzer_id)
            .await?
    else {
        return Ok(None);
    };
    let person = person_repo::laden_tx(conn, einsatz_id, person_id).await?;
    let uhs = uhs_repo::laden_tx(conn, einsatz_id, info.uhs_id).await?;
    let text = format!(
        "Person {}: verlässt {} ({anlass})",
        registrier_anzeige(person.registrier_nr),
        uhs.bezeichnung
    );
    let etb_id = etb::system_audit_tx(conn, einsatz_id, benutzer_id, startwert, &text).await?;
    Ok(Some(AutoAustrittTx {
        uhs_id: info.uhs_id,
        person_id,
        etb_id,
    }))
}
