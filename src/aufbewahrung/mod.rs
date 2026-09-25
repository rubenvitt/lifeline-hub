//! Aufbewahrung abgeschlossener Einsätze aus Sicht des Org-Admins (LFH-23).
//!
//! Die Lesesperre der regulären Einsatz-Routen (`einsatz::berechtigung::darf_lesen`) bleibt
//! unverändert — auch für den System-Admin. Dieses Modul stellt **daneben** einen eigenen,
//! lesenden Pfad bereit (Namensraum `/api/aufbewahrung`, `routes::aufbewahrung`): eine
//! Übersicht der abgeschlossenen Einsätze der eigenen Organisation mit ihrem
//! Aufbewahrungszustand und eine pseudonyme Archivakte (Kopf, Register, ETB), die
//! ausschließlich aus Retain-Spalten der Schwärzungs-Registry gelesen wird
//! ([`projektion`]). Einzige schreibende Aktion ist das Wiederherstellen während der
//! Karenz (`einsatz::repo::wiederherstellen`).
//!
//! **„Org-Admin“ ist der System-Admin derselben Organisation** (Annahme A1, design.md D1):
//! enger als sonst beim System-Admin, der Einsätze serverweit lesen darf. Die Prüfung
//! steht in [`fordere_archivzugriff`].
//!
//! Eigene DTOs statt `EinsatzAnzeige`/`EtbEintragAnzeige`/`PersonAnzeige`: diese wachsen
//! (Anhänge am ETB, LFH-117), und das Archiv würde neue Felder still mitliefern.

pub mod projektion;
pub mod repo;
#[cfg(test)]
mod repo_tests;

use crate::auth::Benutzer;
use crate::einsatz::retention::AufbewahrungZustand;
use crate::einsatz::{Einsatzart, STATUS_ABGESCHLOSSEN};
use crate::error::AppError;
use crate::etb::{EtbTyp, MeldeWeg};
use crate::person::{PersonStatus, Sichtungskategorie, VerbleibArt, VerbleibStatus};
use serde::Serialize;
use utoipa::ToSchema;

/// Eine Zeile der Aufbewahrungsübersicht (`GET /api/aufbewahrung`). Keine
/// personenbezogene Spalte: Einsatzort, Sachverhalt und meldende Stelle fehlen.
#[derive(Debug, Clone, PartialEq, Serialize, ToSchema)]
pub struct AufbewahrungEintragAnzeige {
    pub einsatz_id: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub einsatznummer_intern: Option<String>,
    pub bezeichnung: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub abgeschlossen_at: Option<String>,
    /// Aufbewahrungsfrist (UTC, DB-Format); fehlt = keine Frist.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub retention_bis: Option<String>,
    /// Zeitpunkt der Löschvormerkung (Beginn der Karenz).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub geloescht_at: Option<String>,
    /// Ende der Karenz (`geloescht_at` + 30 Tage); fehlt ohne Vormerkung.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub karenz_ende: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub geschwaerzt_at: Option<String>,
    pub zustand: AufbewahrungZustand,
}

/// Einsatzkopf der Archivakte — nur Retain-Spalten ([`projektion::KOPF`]).
#[derive(Debug, Clone, PartialEq, Serialize, ToSchema)]
pub struct ArchivKopfAnzeige {
    pub id: i64,
    pub bezeichnung: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stichwort: Option<String>,
    pub einsatzart: Einsatzart,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub einsatznummer_intern: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub leitstellen_nr: Option<String>,
    pub begonnen_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub abgeschlossen_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub anzahl_betroffene_initial: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub retention_bis: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub geloescht_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub geschwaerzt_at: Option<String>,
}

/// Registereintrag einer Person — Registriernummer und Kategorien, kein Name, kein Ort.
#[derive(Debug, Clone, PartialEq, Serialize, ToSchema)]
pub struct ArchivPersonAnzeige {
    pub registrier_nr: i64,
    /// Anzeigeform, z. B. `R-042`.
    pub registrier_anzeige: String,
    pub status: PersonStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub aktuelle_sichtung: Option<Sichtungskategorie>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub aktuelle_verbleib_art: Option<VerbleibArt>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub aktueller_verbleib_status: Option<VerbleibStatus>,
    pub erfasst_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub storniert_at: Option<String>,
}

/// Registereintrag eines Tiers — Registriernummer, Tierart, Status.
#[derive(Debug, Clone, PartialEq, Serialize, ToSchema)]
pub struct ArchivTierAnzeige {
    pub registrier_nr: i64,
    /// Anzeigeform, z. B. `T-007`.
    pub registrier_anzeige: String,
    pub spezies: crate::tier::Spezies,
    pub status: crate::tier::TierStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub abschluss_grund: Option<crate::tier::AbschlussGrund>,
    pub erfasst_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub storniert_at: Option<String>,
}

/// Registereintrag eines Schadens — Registriernummer, Typ, Ausmaß, Status.
#[derive(Debug, Clone, PartialEq, Serialize, ToSchema)]
pub struct ArchivSchadenAnzeige {
    pub registrier_nr: i64,
    /// Anzeigeform, z. B. `S-003`.
    pub registrier_anzeige: String,
    pub typ: crate::schaden::SchadenTyp,
    pub ausmass: crate::schaden::Ausmass,
    pub status: crate::schaden::SchadenStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub abschluss_grund: Option<crate::schaden::AbschlussGrund>,
    pub erfasst_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub storniert_at: Option<String>,
}

/// Die pseudonyme Archivakte (`GET /api/aufbewahrung/einsaetze/{id}`). Vor und nach der
/// Schwärzung dieselben Felder, weil jede Angabe aus einer Retain-Spalte stammt.
#[derive(Debug, Clone, PartialEq, Serialize, ToSchema)]
pub struct ArchivAkteAnzeige {
    pub kopf: ArchivKopfAnzeige,
    pub zustand: AufbewahrungZustand,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub karenz_ende: Option<String>,
    pub personen: Vec<ArchivPersonAnzeige>,
    pub tiere: Vec<ArchivTierAnzeige>,
    pub schaeden: Vec<ArchivSchadenAnzeige>,
}

/// Ein ETB-Eintrag der Archivakte im Wortlaut — ohne Anhänge und ohne Rückverweise auf
/// Aufträge, Befehle, Lageberichte, Meldungen und Nachforderungen (deren Ziele sind im
/// Archiv nicht lesbar).
#[derive(Debug, Clone, PartialEq, Serialize, ToSchema)]
pub struct ArchivEtbEintragAnzeige {
    pub id: i64,
    pub lfd_nr: i64,
    pub typ: EtbTyp,
    pub inhalt: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub von: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub an: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub meldeweg: Option<MeldeWeg>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub veranlassung: Option<String>,
    pub erfasser_id: i64,
    pub erfasser_name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub erfasser_funktion: Option<String>,
    pub ereigniszeit: String,
    pub received_at: String,
    /// Verweis auf den berichtigten Eintrag (nur bei `typ = berichtigung`).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub berichtigt_eintrag_id: Option<i64>,
}

/// Archivzugriff (design.md D1/D2): nur der System-Admin, nur für Einsätze seiner
/// Organisation (fremde Org → 403), nur für abgeschlossene Einsätze (aktiv → 409, eine
/// Archivakte gibt es erst nach dem Abschluss). Die Admin-Eigenschaft selbst sichert der
/// `AdminUser`-Extractor der Route; sie wird hier trotzdem geprüft, damit die Funktion
/// allein keine falsche Zusage macht.
pub fn fordere_archivzugriff(
    benutzer: &Benutzer,
    einsatz_org_id: i64,
    status: &str,
) -> Result<(), AppError> {
    if !benutzer.ist_admin() || benutzer.org_id != einsatz_org_id {
        return Err(AppError::Forbidden);
    }
    if status != STATUS_ABGESCHLOSSEN {
        return Err(AppError::Conflict(
            "Einsatz ist nicht abgeschlossen — eine Archivakte gibt es erst nach dem Abschluss"
                .into(),
        ));
    }
    Ok(())
}

/// Sperre des Frist-PUT an Tombstones (LFH-23, design.md D6) — EINE Stelle für Route und
/// Repo-Fallback, damit beide dieselbe Linie ziehen:
/// - geschwärzt → 409 (endgültig),
/// - vorgemerkt, Karenz abgelaufen (`schwaerzung_ausstehend`) → 409: auch das
///   Wiederherstellen ist dort 409, ein Verweis darauf zeigte auf einen geschlossenen Weg,
/// - vorgemerkt, Karenz läuft → 422 mit dem Hinweis auf das Wiederherstellen,
/// - sonst `None` (die Frist darf gesetzt werden).
pub fn frist_sperre(
    geloescht_at: Option<&str>,
    geschwaerzt_at: Option<&str>,
    jetzt: chrono::DateTime<chrono::Utc>,
) -> Option<AppError> {
    if geschwaerzt_at.is_some() {
        return Some(AppError::Conflict(
            "Einsatz ist geschwärzt — die Aufbewahrungsfrist ist nicht mehr änderbar".into(),
        ));
    }
    let geloescht_at = geloescht_at?;
    if crate::einsatz::retention::karenz_abgelaufen(Some(geloescht_at), jetzt) {
        return Some(AppError::Conflict(
            "Die Karenz ist abgelaufen — die Schwärzung steht aus, die Aufbewahrungsfrist ist \
             nicht mehr änderbar"
                .into(),
        ));
    }
    Some(AppError::UnprocessableEntity(
        "Einsatz ist zur Löschung vorgemerkt – erst wiederherstellen".into(),
    ))
}
