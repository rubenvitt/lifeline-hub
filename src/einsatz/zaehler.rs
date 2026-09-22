//! Modulzähler des Einsatz-Navigationsrahmens (LFH-612, Neuentwurf Shell `module[].zahl`).
//!
//! **Welche Zahl, entscheidet diese Datei — und nur für belegte Module.** Der Entwurf zeigt
//! Zahlen an vielen Modulen, definiert aber keine. Gezählt wird nur, wo die Bedeutung aus
//! dem Entwurf herleitbar ist (Entscheidung vom 22.09.2026): die Gesamtmengen von ETB,
//! Betroffenen, Einheiten und Einsatzabschnitten, dazu die Handlungsmengen der vier
//! Kommunikationsmodule mit ihrer bisherigen Bedeutung. Ein weiteres Modul braucht eine
//! eigene Entscheidung, keine naheliegende Zahl.
//!
//! **Fehlt ≠ 0.** Jedes Feld ist optional und fehlt, wenn der Benutzer das Modul nicht sehen
//! darf ([`crate::einsatz::berechtigung::erlaubte_module`]). Eine 0 wäre eine Auskunft über
//! ein Modul, dessen Liste er mit 403 abgewiesen bekäme.
//!
//! **Die Kommunikationszähler zählen über die Listenfunktionen**, nicht über ein eigenes
//! `COUNT`: `ist_offen`, `ist_ueberfaellig`, `ist_faellig` und `ungelesen_anzahl` rechnet der
//! Server dort je Zeile. Ein zweites Prädikat wäre eine zweite Definition, die bei der
//! nächsten Änderung still abwiche. Die Listen sind je Einsatz klein, und der Browser lud
//! sie vorher für denselben Zweck vollständig.

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

/// Meldungen: offen (Status ≠ erledigt), davon noch nicht gesichtet (Status „neu").
#[derive(Debug, Clone, PartialEq, Eq, Serialize, ToSchema)]
pub struct MeldungsZaehler {
    pub offen: i64,
    pub ungesehen: i64,
}

/// Aufträge: offen (offen/in Arbeit), davon überfällig.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, ToSchema)]
pub struct AuftragsZaehler {
    pub offen: i64,
    pub ueberfaellig: i64,
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
        let offen = liste.iter().filter(|m| m.ist_offen);
        z.meldungen = Some(MeldungsZaehler {
            offen: offen.clone().count() as i64,
            ungesehen: offen.filter(|m| m.status == MeldungStatus::Neu).count() as i64,
        });
    }
    if erlaubt.contains("auftraege") {
        let liste = crate::auftrag::repo::liste(pool, einsatz_id, None, None, None, jetzt).await?;
        let offen = liste
            .iter()
            .filter(|d| d.auftrag.bearbeitungsstatus.ist_offen());
        z.auftraege = Some(AuftragsZaehler {
            offen: offen.clone().count() as i64,
            ueberfaellig: offen.filter(|d| d.auftrag.ist_ueberfaellig).count() as i64,
        });
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
        // Rein lesend (ohne das Anlegen des Standardkanals, das `liste_kanaele` vorweg tut):
        // dieser Abruf läuft bei jedem gezählten Live-Ereignis und darf keine Schreibsperre
        // nehmen.
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
    use crate::auftrag::AuftragBearbeitungsstatus;
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
            }),
            auftraege: Some(AuftragsZaehler {
                offen: 1,
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
