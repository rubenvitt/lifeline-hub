//! Katalog-Lookup des Demo-Imports (LFH-690, design.md D8).
//!
//! **Kataloge werden nie angelegt, nur mitbenutzt.** Eine neu angelegte Katalogzeile würde
//! per `NO ACTION` von echten Einsätzen festgehalten und machte das Entfernen unsauber
//! (Entscheidung Auftraggeber, 24.09.2026). Jeder Lookup sieht nur **aktive** Einträge der
//! **eigenen** Organisation. Fehlt einer, bricht der Import mit 422 ab und nennt ihn:
//! „Katalogeintrag fehlt: Einheitstyp «Gruppe»“.
//!
//! Die Prüfungen der Fach-Repos reichen dafür nicht, und das ist der Grund für dieses Modul:
//! `personal::repo::setze_qualifikationen` prüft `aktiv` nicht und verwirft eine fremde ID
//! still (`INSERT OR IGNORE … WHERE org_id = ?`), `einheit::typ_repo::ist_in_org` lässt
//! deaktivierte Typen bewusst gelten, und die Dispositionen setzen ohne passenden Status
//! still `NULL`.
//!
//! Alle Helfer arbeiten auf der offenen Verbindung des Imports, committen nicht und sind für
//! den Einsatz-Teil (Block 4.2) gedacht. Bei mehreren Treffern gewinnt der erste nach
//! `sortier, id`, dieselbe Ordnung wie `erster_der_kategorie_tx`.

use sqlx::SqliteConnection;

use super::szenario::Katalogeintrag;
use crate::error::AppError;
use crate::katalog::StatusKategorie;

/// Die Kataloge, aus denen der Import liest; ihr Name steht in der 422-Meldung.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Katalog {
    Fahrzeugstatus,
    Personalstatus,
    Einheitstyp,
    Qualifikation,
}

impl Katalog {
    pub fn name(&self) -> &'static str {
        match self {
            Katalog::Fahrzeugstatus => "Fahrzeugstatus",
            Katalog::Personalstatus => "Personalstatus",
            Katalog::Einheitstyp => "Einheitstyp",
            Katalog::Qualifikation => "Qualifikation",
        }
    }
}

/// Die 422-Meldung für einen fehlenden Eintrag (design.md D3/D8).
pub fn fehlt(katalog: Katalog, bezeichnung: &str) -> AppError {
    AppError::UnprocessableEntity(format!(
        "Katalogeintrag fehlt: {} «{bezeichnung}»",
        katalog.name()
    ))
}

/// Bezeichnung einer Kategorie in der Meldung, etwa «Kategorie gebunden».
fn kategorie_bezeichnung(kategorie: StatusKategorie) -> String {
    format!("Kategorie {}", kategorie.as_str())
}

/// Aktive Qualifikation der Org über ihr Label.
pub async fn qualifikation_tx(
    conn: &mut SqliteConnection,
    org_id: i64,
    label: &str,
) -> Result<i64, AppError> {
    sqlx::query_scalar(
        "SELECT id FROM qualifikation WHERE org_id = ? AND aktiv = 1 AND label = ? \
         ORDER BY sortier, id LIMIT 1",
    )
    .bind(org_id)
    .bind(label)
    .fetch_optional(&mut *conn)
    .await?
    .ok_or_else(|| fehlt(Katalog::Qualifikation, label))
}

/// Aktiver Einheitstyp der Org über sein Label.
pub async fn einheitstyp_tx(
    conn: &mut SqliteConnection,
    org_id: i64,
    label: &str,
) -> Result<i64, AppError> {
    sqlx::query_scalar(
        "SELECT id FROM einheit_typ WHERE org_id = ? AND aktiv = 1 AND label = ? \
         ORDER BY sortier, id LIMIT 1",
    )
    .bind(org_id)
    .bind(label)
    .fetch_optional(&mut *conn)
    .await?
    .ok_or_else(|| fehlt(Katalog::Einheitstyp, label))
}

/// Aktiver Fahrzeugstatus der Org über den FMS-Anker (0–9). Das Label ist umbenennbar, der
/// Anker nicht.
pub async fn fahrzeugstatus_fms_tx(
    conn: &mut SqliteConnection,
    org_id: i64,
    fms_anker: i64,
) -> Result<i64, AppError> {
    sqlx::query_scalar(
        "SELECT id FROM fahrzeug_status WHERE org_id = ? AND aktiv = 1 AND fms_anker = ? \
         ORDER BY sortier, id LIMIT 1",
    )
    .bind(org_id)
    .bind(fms_anker)
    .fetch_optional(&mut *conn)
    .await?
    .ok_or_else(|| fehlt(Katalog::Fahrzeugstatus, &format!("FMS {fms_anker}")))
}

/// Erster aktiver Fahrzeugstatus der Org in der Kategorie.
pub async fn fahrzeugstatus_der_kategorie_tx(
    conn: &mut SqliteConnection,
    org_id: i64,
    kategorie: StatusKategorie,
) -> Result<i64, AppError> {
    sqlx::query_scalar(
        "SELECT id FROM fahrzeug_status WHERE org_id = ? AND aktiv = 1 AND kategorie = ? \
         ORDER BY sortier, id LIMIT 1",
    )
    .bind(org_id)
    .bind(kategorie.as_str())
    .fetch_optional(&mut *conn)
    .await?
    .ok_or_else(|| fehlt(Katalog::Fahrzeugstatus, &kategorie_bezeichnung(kategorie)))
}

/// Aktiver Personalstatus der Org über sein Label.
pub async fn personalstatus_tx(
    conn: &mut SqliteConnection,
    org_id: i64,
    label: &str,
) -> Result<i64, AppError> {
    sqlx::query_scalar(
        "SELECT id FROM personal_status WHERE org_id = ? AND aktiv = 1 AND label = ? \
         ORDER BY sortier, id LIMIT 1",
    )
    .bind(org_id)
    .bind(label)
    .fetch_optional(&mut *conn)
    .await?
    .ok_or_else(|| fehlt(Katalog::Personalstatus, label))
}

/// Erster aktiver Personalstatus der Org in der Kategorie.
pub async fn personalstatus_der_kategorie_tx(
    conn: &mut SqliteConnection,
    org_id: i64,
    kategorie: StatusKategorie,
) -> Result<i64, AppError> {
    sqlx::query_scalar(
        "SELECT id FROM personal_status WHERE org_id = ? AND aktiv = 1 AND kategorie = ? \
         ORDER BY sortier, id LIMIT 1",
    )
    .bind(org_id)
    .bind(kategorie.as_str())
    .fetch_optional(&mut *conn)
    .await?
    .ok_or_else(|| fehlt(Katalog::Personalstatus, &kategorie_bezeichnung(kategorie)))
}

/// Löst einen einzelnen Eintrag auf.
pub async fn eintrag_tx(
    conn: &mut SqliteConnection,
    org_id: i64,
    eintrag: Katalogeintrag,
) -> Result<i64, AppError> {
    match eintrag {
        Katalogeintrag::Qualifikation(label) => qualifikation_tx(conn, org_id, label).await,
        Katalogeintrag::Einheitstyp(label) => einheitstyp_tx(conn, org_id, label).await,
        Katalogeintrag::FahrzeugstatusFms(anker) => {
            fahrzeugstatus_fms_tx(conn, org_id, anker).await
        }
        Katalogeintrag::FahrzeugstatusKategorie(k) => {
            fahrzeugstatus_der_kategorie_tx(conn, org_id, k).await
        }
        Katalogeintrag::Personalstatus(label) => personalstatus_tx(conn, org_id, label).await,
        Katalogeintrag::PersonalstatusKategorie(k) => {
            personalstatus_der_kategorie_tx(conn, org_id, k).await
        }
    }
}

/// Aufgelöste Katalog-IDs zu einem Bedarf.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct KatalogIds {
    eintraege: Vec<(Katalogeintrag, i64)>,
}

impl KatalogIds {
    /// ID eines aufgelösten Eintrags. Ein Eintrag, der nicht im Bedarf stand, ist ein
    /// Programmierfehler des Drehbuchs und endet laut als `Internal`, nie als stilles `None`.
    pub fn id(&self, eintrag: Katalogeintrag) -> Result<i64, AppError> {
        self.eintraege
            .iter()
            .find(|(e, _)| *e == eintrag)
            .map(|(_, id)| *id)
            .ok_or_else(|| {
                AppError::Internal(format!("Demo-Katalogeintrag nicht aufgelöst: {eintrag:?}"))
            })
    }

    /// Alle aufgelösten Einträge in Bedarfsreihenfolge.
    pub fn eintraege(&self) -> &[(Katalogeintrag, i64)] {
        &self.eintraege
    }
}

/// Löst den ganzen Bedarf in seiner Reihenfolge auf. Der erste fehlende Eintrag bricht mit
/// 422 ab; der Aufrufer rollt zurück. Doppelte Einträge werden einmal aufgelöst.
pub async fn aufloesen_tx(
    conn: &mut SqliteConnection,
    org_id: i64,
    bedarf: &[Katalogeintrag],
) -> Result<KatalogIds, AppError> {
    let mut ids = KatalogIds::default();
    for &eintrag in bedarf {
        if ids.eintraege.iter().any(|(e, _)| *e == eintrag) {
            continue;
        }
        let id = eintrag_tx(conn, org_id, eintrag).await?;
        ids.eintraege.push((eintrag, id));
    }
    Ok(ids)
}
