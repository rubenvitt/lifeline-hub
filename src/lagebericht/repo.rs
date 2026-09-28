//! Persistenz der Lagebericht-Dokumente: dünne Hülle um [`crate::vorlagendokument::repo`], die den
//! geteilten Kern auf die Wire-Typen dieser Art abbildet.

use super::{Abschnitt, Lagebericht};
use crate::error::AppError;
use crate::vorlagendokument::repo::{self as kern, Dokument};
use serde::Serialize;
use sqlx::SqliteConnection;
use utoipa::ToSchema;

/// Öffentliche Anzeige eines Lageberichts (Abschnitte aus JSON geparst, Namen aufgelöst).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, ToSchema)]
pub struct LageberichtAnzeige {
    pub id: i64,
    pub einsatz_id: i64,
    #[schema(value_type = crate::lagebericht::LageberichtVorlage)]
    pub vorlage: String,
    pub titel: String,
    pub zeitstand: String,
    #[schema(value_type = crate::lagebericht::LageberichtStatus)]
    pub status: String,
    pub abschnitte: Vec<Abschnitt>,
    pub version: i64,
    pub vorgaenger_id: Option<i64>,
    pub ersteller_id: i64,
    pub ersteller_name: String,
    pub erstellt_at: String,
    pub aktualisiert_at: String,
    pub freigegeben_von_id: Option<i64>,
    pub freigegeben_von_name: Option<String>,
    pub freigegeben_at: Option<String>,
    pub etb_eintrag_id: Option<i64>,
}

impl From<Dokument<Abschnitt>> for LageberichtAnzeige {
    fn from(d: Dokument<Abschnitt>) -> Self {
        Self {
            id: d.id,
            einsatz_id: d.einsatz_id,
            vorlage: d.vorlage,
            titel: d.titel,
            zeitstand: d.zeitstand,
            status: d.status,
            abschnitte: d.abschnitte,
            version: d.version,
            vorgaenger_id: d.vorgaenger_id,
            ersteller_id: d.ersteller_id,
            ersteller_name: d.ersteller_name,
            erstellt_at: d.erstellt_at,
            aktualisiert_at: d.aktualisiert_at,
            freigegeben_von_id: d.freigegeben_von_id,
            freigegeben_von_name: d.freigegeben_von_name,
            freigegeben_at: d.freigegeben_at,
            etb_eintrag_id: d.etb_eintrag_id,
        }
    }
}

/// Editierbare Felder eines Entwurfs-PATCH. `None` = unverändert.
pub type LageberichtPatch<'a> = kern::Patch<'a, Abschnitt>;

/// Siehe [`kern::laden`].
pub async fn laden(
    executor: impl sqlx::Executor<'_, Database = sqlx::Sqlite>,
    einsatz_id: i64,
    id: i64,
) -> Result<LageberichtAnzeige, AppError> {
    kern::laden::<Lagebericht>(executor, einsatz_id, id)
        .await
        .map(Into::into)
}

/// Siehe [`kern::anlegen_tx`].
pub async fn anlegen_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    vorlage_key: &str,
    titel: &str,
    zeitstand: &str,
    ersteller_id: i64,
) -> Result<LageberichtAnzeige, AppError> {
    kern::anlegen_tx::<Lagebericht>(
        conn,
        einsatz_id,
        vorlage_key,
        titel,
        zeitstand,
        ersteller_id,
    )
    .await
    .map(Into::into)
}

/// Siehe [`kern::aktualisiere_tx`].
pub async fn aktualisiere_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    id: i64,
    patch: &LageberichtPatch<'_>,
) -> Result<LageberichtAnzeige, AppError> {
    kern::aktualisiere_tx::<Lagebericht>(conn, einsatz_id, id, patch)
        .await
        .map(Into::into)
}

/// Siehe [`kern::freigeben_tx`].
pub async fn freigeben_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    id: i64,
    freigeber_id: i64,
) -> Result<LageberichtAnzeige, AppError> {
    kern::freigeben_tx::<Lagebericht>(conn, einsatz_id, id, freigeber_id)
        .await
        .map(Into::into)
}
