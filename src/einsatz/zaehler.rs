//! Modulzähler des Einsatz-Navigationsrahmens (LFH-612).
//!
//! Gezählt wird nur, wo die Bedeutung belegt ist: die Gesamtmengen von ETB, Betroffenen,
//! Einheiten und Einsatzabschnitten sowie die Handlungsmengen der vier Kommunikationsmodule. Ein
//! weiteres Modul braucht eine eigene Entscheidung.
//!
//! **Fehlt ≠ 0.** Jedes Feld fehlt, wenn der Benutzer das Modul nicht sehen darf
//! ([`crate::einsatz::berechtigung::erlaubte_module`]); eine 0 wäre eine Auskunft über ein
//! Modul, dessen Liste er mit 403 abgewiesen bekäme.
//!
//! **Die Kommunikationszähler zählen über die Listenfunktionen**, nicht über ein eigenes
//! `COUNT`: `ist_offen`, `ist_ueberfaellig`, `ist_faellig` und `ungelesen_anzahl` rechnet der
//! Server dort je Zeile, und ein zweites Prädikat wiche bei der nächsten Änderung still ab.
//!
//! **Eine Heimat je Zahl (LFH-550):** Lage-Dashboard und Führungsüberblick zeigen Aufträge und
//! Meldungen aus diesem Zähler, nicht aus eigener Zählung. Die Zählregeln über den Zeilen stehen
//! als reine Funktionen ([`zaehle_auftraege`], [`zaehle_meldungen`]); das gemeinsame Fixture
//! `tests/fixtures/verdichtung/regeln.json` bindet sie an die Client-Regeln
//! (`tests/verdichtung_fixture.rs` und `frontend/src/lage/verdichtungFixture.test.ts`).

use crate::auftrag::AuftragBearbeitungsstatus;
use crate::auth::Benutzer;
use crate::erinnerung::STATUS_OFFEN as ERINNERUNG_OFFEN;
use crate::error::AppError;
use crate::meldung::MeldungStatus;
use serde::Serialize;
use sqlx::SqlitePool;
use std::collections::HashSet;
use utoipa::ToSchema;

/// Eine reine Menge (Gesamtzahl der Datensätze eines Moduls).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, ToSchema)]
pub struct MengenZaehler {
    pub gesamt: i64,
}

/// Meldungen: offen (Status ≠ erledigt), davon noch nicht gesichtet (Status „neu"), und die
/// Meldungen mit überfälliger Bestätigungspflicht.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, ToSchema)]
pub struct MeldungsZaehler {
    pub offen: i64,
    pub ungesehen: i64,
    /// Pflichtig, unbestätigt und Frist abgelaufen oder eskaliert — über ALLE Meldungen, nicht
    /// nur die offenen (LFH-397). Speist die Warnsperre des Helligkeitsreglers im Frontend.
    pub bestaetigung_ueberfaellig: i64,
}

/// Aufträge: offen (offen/in Arbeit), davon in Arbeit, davon überfällig.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, ToSchema)]
pub struct AuftragsZaehler {
    pub offen: i64,
    /// Davon mit Bearbeitungsstatus „in Arbeit" (LFH-550, „davon in Arbeit" im Überblick).
    pub in_arbeit: i64,
    /// Davon überfällig — nur unter den offenen: ein vollzogener Auftrag mit Quittungslücke
    /// zählt nicht (LFH-550).
    pub ueberfaellig: i64,
}

/// Was an einem Auftrag gezählt wird. Die Flags rechnet die Liste je Zeile
/// (`auftrag::repo::ANZEIGE_SELECT`); gezählt wird darüber in [`zaehle_auftraege`].
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct AuftragsMerkmale {
    pub bearbeitungsstatus: AuftragBearbeitungsstatus,
    pub ist_ueberfaellig: bool,
}

/// Was an einer Meldung gezählt wird. Die Flags rechnet die Liste je Zeile
/// (`meldung::repo`); gezählt wird darüber in [`zaehle_meldungen`].
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct MeldungsMerkmale {
    pub status: MeldungStatus,
    pub ist_offen: bool,
    pub bestaetigung_pflicht: bool,
    pub ist_bestaetigt: bool,
    pub ist_ueberfaellig: bool,
    pub eskaliert: bool,
}

fn anzahl(n: usize) -> i64 {
    i64::try_from(n).unwrap_or(i64::MAX)
}

/// Zählregel der Aufträge: offen = `ist_offen()` der Phase; davon in Arbeit; davon überfällig.
pub fn zaehle_auftraege(auftraege: &[AuftragsMerkmale]) -> AuftragsZaehler {
    let offen: Vec<_> = auftraege
        .iter()
        .filter(|a| a.bearbeitungsstatus.ist_offen())
        .collect();
    AuftragsZaehler {
        offen: anzahl(offen.len()),
        in_arbeit: anzahl(
            offen
                .iter()
                .filter(|a| a.bearbeitungsstatus == AuftragBearbeitungsstatus::InArbeit)
                .count(),
        ),
        ueberfaellig: anzahl(offen.iter().filter(|a| a.ist_ueberfaellig).count()),
    }
}

/// Zählregel der Meldungen: offen, davon ungesehen (Status „neu"), und die überfällige
/// Bestätigungspflicht über ALLE Meldungen (LFH-397). Die letzte Regel kennt auch der Client
/// (`istAlarmiert` in `frontend/src/meldungen/meldungKennzahlen.ts`); das gemeinsame Fixture
/// hält beide gleich.
pub fn zaehle_meldungen(meldungen: &[MeldungsMerkmale]) -> MeldungsZaehler {
    let offen: Vec<_> = meldungen.iter().filter(|m| m.ist_offen).collect();
    MeldungsZaehler {
        offen: anzahl(offen.len()),
        ungesehen: anzahl(
            offen
                .iter()
                .filter(|m| m.status == MeldungStatus::Neu)
                .count(),
        ),
        bestaetigung_ueberfaellig: anzahl(
            meldungen
                .iter()
                .filter(|m| {
                    m.bestaetigung_pflicht && !m.ist_bestaetigt && (m.ist_ueberfaellig || m.eskaliert)
                })
                .count(),
        ),
    }
}

/// Erinnerungen: fällig und noch offen.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, ToSchema)]
pub struct ErinnerungsZaehler {
    pub faellig: i64,
}

/// Chat: für den anfragenden Benutzer ungelesene Nachrichten über alle Kanäle.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, ToSchema)]
pub struct ChatZaehler {
    pub ungelesen: i64,
}

/// Antwort von `GET /api/einsaetze/{id}/modul-zaehler`. Feldnamen = Modul-Keys
/// (`MODUL_KEYS`, Test unten); ein fehlendes Feld heißt „Modul nicht erlaubt".
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, ToSchema)]
pub struct ModulZaehlerAnzeige {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub etb: Option<MengenZaehler>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub personen: Option<MengenZaehler>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub einheiten: Option<MengenZaehler>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub einsatzabschnitte: Option<MengenZaehler>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub meldungen: Option<MeldungsZaehler>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub auftraege: Option<AuftragsZaehler>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub erinnerungen: Option<ErinnerungsZaehler>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub chat: Option<ChatZaehler>,
}

/// Zählt eine Tabelle je Einsatz. `sql` ist ein festes Literal (kein Nutzereingang).
async fn menge(
    pool: &SqlitePool,
    sql: &'static str,
    einsatz_id: i64,
) -> Result<MengenZaehler, AppError> {
    let gesamt: i64 = sqlx::query_scalar(sql)
        .bind(einsatz_id)
        .fetch_one(pool)
        .await?;
    Ok(MengenZaehler { gesamt })
}

/// Berechnet die Zähler aller Module in `erlaubt`; alle anderen Felder bleiben `None`.
pub async fn berechne(
    pool: &SqlitePool,
    einsatz_id: i64,
    benutzer: &Benutzer,
    erlaubt: &HashSet<&'static str>,
    jetzt: &str,
) -> Result<ModulZaehlerAnzeige, AppError> {
    let mut z = ModulZaehlerAnzeige::default();

    if erlaubt.contains("etb") {
        z.etb = Some(
            menge(
                pool,
                "SELECT COUNT(*) FROM etb_eintrag WHERE einsatz_id = ?",
                einsatz_id,
            )
            .await?,
        );
    }
    if erlaubt.contains("personen") {
        // Dasselbe Prädikat wie `person::repo::liste`: stornierte zählen nicht.
        z.personen = Some(
            menge(
                pool,
                "SELECT COUNT(*) FROM einsatz_person WHERE einsatz_id = ? AND storniert_at IS NULL",
                einsatz_id,
            )
            .await?,
        );
    }
    if erlaubt.contains("einheiten") {
        z.einheiten = Some(
            menge(
                pool,
                "SELECT COUNT(*) FROM einsatz_einheit WHERE einsatz_id = ?",
                einsatz_id,
            )
            .await?,
        );
    }
    if erlaubt.contains("einsatzabschnitte") {
        z.einsatzabschnitte = Some(
            menge(
                pool,
                "SELECT COUNT(*) FROM einsatzabschnitt WHERE einsatz_id = ?",
                einsatz_id,
            )
            .await?,
        );
    }
    if erlaubt.contains("meldungen") {
        let liste = crate::meldung::repo::liste(pool, einsatz_id, None, None, jetzt).await?;
        let merkmale: Vec<_> = liste
            .iter()
            .map(|m| MeldungsMerkmale {
                status: m.status,
                ist_offen: m.ist_offen,
                bestaetigung_pflicht: m.bestaetigung_pflicht,
                ist_bestaetigt: m.ist_bestaetigt,
                ist_ueberfaellig: m.ist_ueberfaellig,
                eskaliert: m.eskaliert,
            })
            .collect();
        z.meldungen = Some(zaehle_meldungen(&merkmale));
    }
    if erlaubt.contains("auftraege") {
        let liste = crate::auftrag::repo::liste(pool, einsatz_id, None, None, None, jetzt).await?;
        let merkmale: Vec<_> = liste
            .iter()
            .map(|d| AuftragsMerkmale {
                bearbeitungsstatus: d.auftrag.bearbeitungsstatus,
                ist_ueberfaellig: d.auftrag.ist_ueberfaellig,
            })
            .collect();
        z.auftraege = Some(zaehle_auftraege(&merkmale));
    }
    if erlaubt.contains("erinnerungen") {
        let liste = crate::erinnerung::repo::liste(pool, einsatz_id, false, jetzt).await?;
        z.erinnerungen = Some(ErinnerungsZaehler {
            faellig: liste
                .iter()
                .filter(|e| e.ist_faellig && e.status == ERINNERUNG_OFFEN)
                .count() as i64,
        });
    }
    if erlaubt.contains("chat") {
        // Rein lesend, ohne das Anlegen des Standardkanals: dieser Abruf läuft bei jedem gezählten
        // Live-Ereignis und darf keine Schreibsperre nehmen.
        let kanaele = crate::chat::repo::kanaele_lesen(pool, einsatz_id, benutzer.id).await?;
        z.chat = Some(ChatZaehler {
            ungelesen: kanaele.iter().map(|k| k.ungelesen_anzahl).sum(),
        });
    }
    Ok(z)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::einsatz::modul::MODUL_KEYS;

    #[test]
    fn jedes_feld_ist_ein_modul_key() {
        let voll = ModulZaehlerAnzeige {
            etb: Some(MengenZaehler { gesamt: 1 }),
            personen: Some(MengenZaehler { gesamt: 1 }),
            einheiten: Some(MengenZaehler { gesamt: 1 }),
            einsatzabschnitte: Some(MengenZaehler { gesamt: 1 }),
            meldungen: Some(MeldungsZaehler {
                offen: 1,
                ungesehen: 0,
                bestaetigung_ueberfaellig: 0,
            }),
            auftraege: Some(AuftragsZaehler {
                offen: 1,
                in_arbeit: 0,
                ueberfaellig: 0,
            }),
            erinnerungen: Some(ErinnerungsZaehler { faellig: 1 }),
            chat: Some(ChatZaehler { ungelesen: 1 }),
        };
        let v = serde_json::to_value(&voll).unwrap();
        let felder = v.as_object().unwrap();
        assert_eq!(felder.len(), 8, "{v:?}");
        for feld in felder.keys() {
            assert!(
                MODUL_KEYS.contains(&feld.as_str()),
                "kein Modul-Key: {feld}"
            );
        }
    }

    #[test]
    fn nicht_erlaubtes_modul_fehlt_statt_null() {
        let v = serde_json::to_value(ModulZaehlerAnzeige::default()).unwrap();
        assert!(v.as_object().unwrap().is_empty(), "{v:?}");
    }

    #[test]
    fn auftrag_offen_folgt_den_phasen_des_frontends() {
        // Literal-Paare wie `AUFTRAG_STATUS` in `frontend/src/kommunikation/phase.ts`.
        assert!(AuftragBearbeitungsstatus::Offen.ist_offen());
        assert!(AuftragBearbeitungsstatus::InArbeit.ist_offen());
        assert!(!AuftragBearbeitungsstatus::Vollzogen.ist_offen());
        assert!(!AuftragBearbeitungsstatus::Abgenommen.ist_offen());
    }
}
