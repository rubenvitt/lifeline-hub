//! Modulzähler des Einsatz-Navigationsrahmens (LFH-612).
//!
//! Gezählt wird nur, wo die Bedeutung belegt ist: die Gesamtmengen von ETB, Betroffenen,
//! Einheiten, Einsatzabschnitten und Dokumenten (LFH-666) sowie die Handlungsmengen der vier
//! Kommunikationsmodule. Ein weiteres Modul braucht eine eigene Entscheidung.
//!
//! **Fehlt ≠ 0.** Jedes Feld fehlt, wenn der Benutzer das Modul nicht sehen darf
//! ([`crate::einsatz::berechtigung::erlaubte_module`]); eine 0 wäre eine Auskunft über ein
//! Modul, dessen Liste er mit 403 abgewiesen bekäme.
//!
//! **Die Kommunikationszähler zählen mit denselben Prädikaten wie die Listen** (LFH-935):
//! `ist_offen`, `ist_bestaetigt`, `ist_ueberfaellig`, `ist_faellig` und „ungelesen" stehen je
//! einmal als SQL-Fragment im Repo ihres Moduls; Listen-SELECT und Zählabfrage setzen sich
//! daraus zusammen, ein zweites Prädikat gibt es nicht. Gezählt wird je Modul mit EINER Abfrage
//! ohne Listen zu laden (`meldung::repo::zaehlen`, `auftrag::repo::zaehlen`,
//! `erinnerung::repo::faellige_offene`, `chat::repo::ungelesen_gesamt`): Meldungen und Aufträge
//! gruppiert nach ihren Merkmalen, gezählt mit den reinen Regeln unten.
//!
//! **Eine Heimat je Zahl (LFH-550):** Lage-Dashboard und Führungsüberblick zeigen Aufträge und
//! Meldungen aus diesem Zähler, nicht aus eigener Zählung. Die Zählregeln über den Zeilen stehen
//! als reine Funktionen ([`zaehle_auftraege`], [`zaehle_meldungen`]); das gemeinsame Fixture
//! `tests/fixtures/verdichtung/regeln.json` bindet sie an die Client-Regeln
//! (`tests/verdichtung_fixture.rs` und `frontend/src/lage/verdichtungFixture.test.ts`).

use crate::auftrag::AuftragBearbeitungsstatus;
use crate::auth::Benutzer;
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

/// Was an einem Auftrag gezählt wird. Die Flags kommen aus denselben SQL-Fragmenten wie in der
/// Liste (`auftrag::repo`); gezählt wird darüber in [`zaehle_auftraege`].
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct AuftragsMerkmale {
    pub bearbeitungsstatus: AuftragBearbeitungsstatus,
    pub ist_ueberfaellig: bool,
}

/// Was an einer Meldung gezählt wird. Die Flags kommen aus denselben SQL-Fragmenten wie in der
/// Liste (`meldung::repo`); gezählt wird darüber in [`zaehle_meldungen`].
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct MeldungsMerkmale {
    pub status: MeldungStatus,
    pub ist_offen: bool,
    pub bestaetigung_pflicht: bool,
    pub ist_bestaetigt: bool,
    pub ist_ueberfaellig: bool,
    pub eskaliert: bool,
}

/// Zählregel der Aufträge: offen = `ist_offen()` der Phase; davon in Arbeit; davon überfällig.
pub fn zaehle_auftraege(auftraege: &[AuftragsMerkmale]) -> AuftragsZaehler {
    zaehle_auftraege_gewichtet(auftraege.iter().map(|a| (*a, 1)))
}

/// [`zaehle_auftraege`] über Gruppen gleicher Merkmale mit ihrer Anzahl (LFH-935): der Server
/// zählt per `GROUP BY` über die Merkmale (`auftrag::repo::zaehlen`), die Regel bleibt diese.
pub fn zaehle_auftraege_gewichtet(
    gruppen: impl IntoIterator<Item = (AuftragsMerkmale, i64)>,
) -> AuftragsZaehler {
    let mut z = AuftragsZaehler {
        offen: 0,
        in_arbeit: 0,
        ueberfaellig: 0,
    };
    for (a, n) in gruppen {
        if !a.bearbeitungsstatus.ist_offen() {
            continue;
        }
        z.offen += n;
        if a.bearbeitungsstatus == AuftragBearbeitungsstatus::InArbeit {
            z.in_arbeit += n;
        }
        if a.ist_ueberfaellig {
            z.ueberfaellig += n;
        }
    }
    z
}

/// Zählregel der Meldungen: offen, davon ungesehen (Status „neu"), und die überfällige
/// Bestätigungspflicht über ALLE Meldungen (LFH-397). Die letzte Regel kennt auch der Client
/// (`istAlarmiert` in `frontend/src/meldungen/meldungKennzahlen.ts`); das gemeinsame Fixture
/// hält beide gleich.
pub fn zaehle_meldungen(meldungen: &[MeldungsMerkmale]) -> MeldungsZaehler {
    zaehle_meldungen_gewichtet(meldungen.iter().map(|m| (*m, 1)))
}

/// [`zaehle_meldungen`] über Gruppen gleicher Merkmale mit ihrer Anzahl (LFH-935): der Server
/// zählt per `GROUP BY` über die Merkmale (`meldung::repo::zaehlen`), die Regel bleibt diese.
pub fn zaehle_meldungen_gewichtet(
    gruppen: impl IntoIterator<Item = (MeldungsMerkmale, i64)>,
) -> MeldungsZaehler {
    let mut z = MeldungsZaehler {
        offen: 0,
        ungesehen: 0,
        bestaetigung_ueberfaellig: 0,
    };
    for (m, n) in gruppen {
        if m.ist_offen {
            z.offen += n;
            if m.status == MeldungStatus::Neu {
                z.ungesehen += n;
            }
        }
        if m.bestaetigung_pflicht && !m.ist_bestaetigt && (m.ist_ueberfaellig || m.eskaliert) {
            z.bestaetigung_ueberfaellig += n;
        }
    }
    z
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
    #[serde(skip_serializing_if = "Option::is_none")]
    pub dokumente: Option<MengenZaehler>,
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
        z.meldungen = Some(crate::meldung::repo::zaehlen(pool, einsatz_id, jetzt).await?);
    }
    if erlaubt.contains("auftraege") {
        z.auftraege = Some(crate::auftrag::repo::zaehlen(pool, einsatz_id, jetzt).await?);
    }
    if erlaubt.contains("erinnerungen") {
        z.erinnerungen = Some(ErinnerungsZaehler {
            faellig: crate::erinnerung::repo::faellige_offene(pool, einsatz_id, jetzt).await?,
        });
    }
    if erlaubt.contains("chat") {
        // Rein lesend, ohne das Anlegen des Standardkanals: dieser Abruf läuft bei jedem gezählten
        // Live-Ereignis und darf keine Schreibsperre nehmen.
        z.chat = Some(ChatZaehler {
            ungelesen: crate::chat::repo::ungelesen_gesamt(pool, einsatz_id, benutzer.id).await?,
        });
    }
    if erlaubt.contains("dokumente") {
        // Dasselbe Prädikat wie `dokument::repo::liste`: gelöschte zählen nicht. Den Join auf
        // `anhang` braucht die Zahl nicht — `anhang_id` ist NOT NULL mit ON DELETE CASCADE.
        z.dokumente = Some(
            menge(
                pool,
                "SELECT COUNT(*) FROM einsatz_dokument \
                 WHERE einsatz_id = ? AND geloescht_at IS NULL",
                einsatz_id,
            )
            .await?,
        );
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
            dokumente: Some(MengenZaehler { gesamt: 1 }),
        };
        let v = serde_json::to_value(&voll).unwrap();
        let felder = v.as_object().unwrap();
        assert_eq!(felder.len(), 9, "{v:?}");
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

    /// Der Server zählt über Gruppen gleicher Merkmale (LFH-935): Gewicht n zählt wie n gleiche
    /// Zeilen, quer über alle Merkmalskombinationen beider Regeln.
    #[test]
    fn gewicht_zaehlt_wie_gleiche_zeilen() {
        use AuftragBearbeitungsstatus as A;
        let mut auftraege = vec![];
        for bs in [A::Offen, A::InArbeit, A::Vollzogen, A::Abgenommen] {
            for ist_ueberfaellig in [false, true] {
                auftraege.push(AuftragsMerkmale {
                    bearbeitungsstatus: bs,
                    ist_ueberfaellig,
                });
            }
        }
        let mut meldungen = vec![];
        for status in [
            MeldungStatus::Neu,
            MeldungStatus::Gesichtet,
            MeldungStatus::InBearbeitung,
            MeldungStatus::Erledigt,
        ] {
            for bits in 0u8..16 {
                meldungen.push(MeldungsMerkmale {
                    status,
                    ist_offen: status != MeldungStatus::Erledigt,
                    bestaetigung_pflicht: bits & 1 != 0,
                    ist_bestaetigt: bits & 2 != 0,
                    ist_ueberfaellig: bits & 4 != 0,
                    eskaliert: bits & 8 != 0,
                });
            }
        }
        // Gewicht je Kombination unterschiedlich, damit eine vertauschte Zuordnung auffällt.
        let gewicht = |i: usize| i64::try_from(i % 5 + 1).unwrap();
        let ausgeschrieben = |n: i64| usize::try_from(n).unwrap();

        let a_zeilen: Vec<_> = auftraege
            .iter()
            .enumerate()
            .flat_map(|(i, a)| std::iter::repeat_n(*a, ausgeschrieben(gewicht(i))))
            .collect();
        let a_gruppen = auftraege.iter().enumerate().map(|(i, a)| (*a, gewicht(i)));
        assert_eq!(
            zaehle_auftraege_gewichtet(a_gruppen),
            zaehle_auftraege(&a_zeilen)
        );

        let m_zeilen: Vec<_> = meldungen
            .iter()
            .enumerate()
            .flat_map(|(i, m)| std::iter::repeat_n(*m, ausgeschrieben(gewicht(i))))
            .collect();
        let m_gruppen = meldungen.iter().enumerate().map(|(i, m)| (*m, gewicht(i)));
        assert_eq!(
            zaehle_meldungen_gewichtet(m_gruppen),
            zaehle_meldungen(&m_zeilen)
        );
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
