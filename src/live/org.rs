//! Org-Ereignisse (LFH-734): Einsatzliste und Stammdaten-Kataloge auf jedem angemeldeten Schirm
//! frisch halten.
//!
//! Eigene Familie neben [`super::LiveEvent`], weil die Gate-Semantik eine andere ist: ein
//! Einsatz-Ereignis gehört einem Modul (Filter gegen die Modulrechte des Abonnenten), ein
//! Org-Ereignis gehört der Organisation bzw. den Lesern eines Einsatzes in der Liste. Beide
//! laufen auf derselben Verbindung (der Einsatz-Strom trägt die Org-Ereignisse mit, außerhalb
//! eines Einsatzes `GET /api/live`), ihre Wire-Namen sind deshalb disjunkt (Guard unten).
//!
//! Org-Ereignisse tragen keine `id:` und keinen Replay: sie bedeuten nur „neu laden", und das
//! Frontend lädt nach jedem Wiederaufbau ohnehin nach (design.md D4). Die Nutzlast ist leer.
//! Spec `openspec/specs/org-live/`.

use crate::auth::Benutzer;
use crate::wire_enum::wire_enum;
use serde::Serialize;
use sqlx::{SqliteConnection, SqlitePool};
use std::sync::Arc;
use utoipa::ToSchema;

wire_enum! {
    /// SSE-Wire-Namen der Org-Ereignisse (LFH-734). Das Frontend bildet sie in
    /// `ORG_STREAM_EVENTS` (`api/queryKeys.ts`) auf die globalen Query-Keys ab.
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
    pub enum OrgLiveEvent {
        /// Die Einsatzliste ist für den Empfänger möglicherweise veraltet.
        Einsatzliste => "einsatzliste",
        /// Ein Stammdaten-Katalog der Organisation hat sich geändert.
        Stammdaten => "stammdaten",
    }
}

/// Kapazität des prozessweiten Org-Kanals. Das Aufkommen ist gering (Admin-Schreibvorgänge,
/// Einsatz-Lebenszyklus); läuft ein Empfänger über, bekommt er `lagged` und lädt nach.
pub const ORG_KANAL_KAPAZITAET: usize = 256;

/// Die leere Nutzlast jedes Org-Ereignisses: keine Kennung, keine Daten (design.md D3).
pub const ORG_NUTZLAST: &str = "{}";

/// Wer eine Org-Nachricht erhalten darf.
#[derive(Clone, Debug)]
pub enum OrgEmpfaenger {
    /// Jeder angemeldete Abonnent der Organisation (`stammdaten`: dieselbe Tür wie die
    /// Katalog-GETs).
    Organisation,
    /// Wer den Einsatz in seiner Liste sehen kann oder bis eben sehen konnte: die org-weiten
    /// Leser der Organisation, System-Admins jeder Organisation und die genannten Benutzer
    /// (Mitglieder zum Zeitpunkt des Ereignisses, dazu eine gerade hinzugefügte oder entfernte
    /// Person). Wer den Einsatz nicht sehen darf, erfährt nicht, dass sich an ihm etwas ändert.
    Einsatzleser { benutzer_ids: Arc<[i64]> },
}

/// Eine Nachricht im Org-Kanal. `org_id` ist die Organisation des Katalogs bzw. des Einsatzes.
#[derive(Clone, Debug)]
pub struct OrgNachricht {
    pub org_id: i64,
    pub event: OrgLiveEvent,
    pub empfaenger: OrgEmpfaenger,
}

/// Schnappschuss des Abonnenten vom Verbindungsaufbau. Ein Rollenwechsel wirkt erst beim
/// Wiederaufbau, wie bei den Modulrechten des Einsatz-Stroms („Revokation = Snapshot",
/// `routes/live.rs`).
#[derive(Clone, Copy, Debug)]
pub struct OrgAbonnent {
    pub benutzer_id: i64,
    pub org_id: i64,
    /// System-Admin: liest Einsätze jeder Organisation (`darf_fremdeinsatz_lesen`).
    pub ist_admin: bool,
    /// Liest jeden Einsatz der EIGENEN Organisation ohne Mitgliedschaft (Führungskraft, Admin).
    pub org_weiter_leser: bool,
}

impl OrgAbonnent {
    pub fn aus(benutzer: &Benutzer) -> Self {
        Self {
            benutzer_id: benutzer.id,
            org_id: benutzer.org_id,
            ist_admin: benutzer.ist_admin(),
            org_weiter_leser: benutzer.darf_fremdeinsatz_lesen(benutzer.org_id),
        }
    }

    /// Ob die Nachricht diesen Abonnenten erreichen darf.
    pub fn sieht(&self, n: &OrgNachricht) -> bool {
        match &n.empfaenger {
            OrgEmpfaenger::Organisation => self.org_id == n.org_id,
            OrgEmpfaenger::Einsatzleser { benutzer_ids } => {
                self.ist_admin
                    || (self.org_weiter_leser && self.org_id == n.org_id)
                    || benutzer_ids.contains(&self.benutzer_id)
            }
        }
    }
}

/// Meldet nach dem Commit, dass sich die Einsatzliste zu `einsatz_id` geändert haben kann.
/// Empfänger sind die Leser des Einsatzes in der Liste ([`OrgEmpfaenger::Einsatzleser`]), dazu
/// `zusaetzlich` (etwa eine gerade entfernte Person).
///
/// Ein Fehler beim Lesen von Org und Mitgliedern lässt die Anfrage nicht scheitern, die schon
/// committet ist: er wird geloggt, und der nächste Refetch holt den Stand.
pub async fn einsatzliste_melden(
    pool: &SqlitePool,
    live: &super::LiveHub,
    einsatz_id: i64,
    zusaetzlich: &[i64],
) {
    let gelesen = match pool.acquire().await {
        Ok(mut conn) => einsatzleser_lesen(&mut conn, einsatz_id).await,
        Err(e) => Err(e),
    };
    match gelesen {
        Ok(Some(mut leser)) => {
            leser.benutzer_ids.extend_from_slice(zusaetzlich);
            leser.melden(live);
        }
        Ok(None) => {}
        Err(e) => tracing::warn!(einsatz_id, fehler = %e, "einsatzliste nicht gemeldet"),
    }
}

/// Organisation und Mitglieder eines Einsatzes — die Empfänger von `einsatzliste`.
#[derive(Clone, Debug)]
pub struct Einsatzleser {
    pub org_id: i64,
    pub benutzer_ids: Vec<i64>,
}

impl Einsatzleser {
    /// Publiziert `einsatzliste` an diese Leser. Nur nach dem Commit rufen.
    pub fn melden(self, live: &super::LiveHub) {
        live.publiziere_einsatzliste(self.org_id, self.benutzer_ids);
    }
}

/// Liest die Leser eines Einsatzes, `None` wenn es ihn nicht (mehr) gibt. Läuft auch in einer
/// offenen Transaktion, damit ein Löschweg sie VOR dem `DELETE` festhalten kann.
pub async fn einsatzleser_lesen(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
) -> Result<Option<Einsatzleser>, sqlx::Error> {
    let Some(org_id) = sqlx::query_scalar::<_, i64>("SELECT org_id FROM einsatz WHERE id = ?")
        .bind(einsatz_id)
        .fetch_optional(&mut *conn)
        .await?
    else {
        return Ok(None);
    };
    let benutzer_ids = sqlx::query_scalar::<_, i64>(
        "SELECT benutzer_id FROM einsatz_mitgliedschaft WHERE einsatz_id = ?",
    )
    .bind(einsatz_id)
    .fetch_all(&mut *conn)
    .await?;
    Ok(Some(Einsatzleser {
        org_id,
        benutzer_ids,
    }))
}

#[cfg(test)]
mod tests {
    use super::super::{LiveEvent, LiveHub};
    use super::*;

    fn abonnent(benutzer_id: i64, org_id: i64, ist_admin: bool, org_weit: bool) -> OrgAbonnent {
        OrgAbonnent {
            benutzer_id,
            org_id,
            ist_admin,
            org_weiter_leser: org_weit || ist_admin,
        }
    }

    fn einsatzliste(org_id: i64, ids: &[i64]) -> OrgNachricht {
        OrgNachricht {
            org_id,
            event: OrgLiveEvent::Einsatzliste,
            empfaenger: OrgEmpfaenger::Einsatzleser {
                benutzer_ids: ids.into(),
            },
        }
    }

    fn stammdaten(org_id: i64) -> OrgNachricht {
        OrgNachricht {
            org_id,
            event: OrgLiveEvent::Stammdaten,
            empfaenger: OrgEmpfaenger::Organisation,
        }
    }

    #[test]
    fn zwei_ereignisse_mit_festen_wire_namen() {
        let wire: Vec<&str> = OrgLiveEvent::ALLE.iter().map(|e| e.as_str()).collect();
        assert_eq!(wire, vec!["einsatzliste", "stammdaten"]);
    }

    /// Beide Familien laufen auf derselben Verbindung; ein geteilter Wire-Name ließe das
    /// Frontend ein Org-Ereignis als Einsatz-Ereignis lesen (oder umgekehrt).
    #[test]
    fn wire_namen_sind_disjunkt_zu_den_einsatz_ereignissen() {
        for org in OrgLiveEvent::ALLE {
            assert!(
                LiveEvent::parse(org.as_str()).is_none(),
                "{} ist schon ein Einsatz-Ereignis",
                org.as_str()
            );
        }
    }

    #[test]
    fn stammdaten_erreichen_genau_die_eigene_organisation() {
        let n = stammdaten(1);
        assert!(abonnent(10, 1, false, false).sieht(&n));
        assert!(!abonnent(20, 2, false, false).sieht(&n));
        // Auch ein System-Admin einer anderen Organisation nicht: Kataloge sind org-eigen.
        assert!(!abonnent(21, 2, true, true).sieht(&n));
    }

    #[test]
    fn einsatzliste_erreicht_nur_die_leser_des_einsatzes() {
        let n = einsatzliste(1, &[11]);
        assert!(
            abonnent(10, 1, false, true).sieht(&n),
            "Führungskraft derselben Org"
        );
        assert!(abonnent(12, 1, true, true).sieht(&n), "Admin derselben Org");
        assert!(
            abonnent(20, 2, true, true).sieht(&n),
            "System-Admin fremder Org"
        );
        assert!(
            abonnent(11, 1, false, false).sieht(&n),
            "genanntes Mitglied"
        );
        assert!(
            !abonnent(13, 1, false, false).sieht(&n),
            "Org-Benutzer ohne Bezug"
        );
        assert!(
            !abonnent(22, 2, false, true).sieht(&n),
            "Führungskraft fremder Org"
        );
    }

    #[tokio::test]
    async fn publizieren_ohne_abonnent_ist_harmlos() {
        let hub = LiveHub::new();
        hub.publiziere_stammdaten(1);
        hub.publiziere_einsatzliste(1, vec![1]);
    }

    #[tokio::test]
    async fn abonnent_empfaengt_org_nachricht() {
        let hub = LiveHub::new();
        let mut rx = hub.abonniere_org();
        hub.publiziere_stammdaten(7);
        let n = rx.recv().await.unwrap();
        assert_eq!(n.org_id, 7);
        assert_eq!(n.event, OrgLiveEvent::Stammdaten);
        assert!(matches!(n.empfaenger, OrgEmpfaenger::Organisation));
    }

    /// Org-Nachrichten gehen nicht in den Ring eines Einsatzes und verbrauchen keine Id seiner
    /// Folge — sonst verschöbe ein Org-Ereignis die `Last-Event-ID`-Replay-Logik.
    #[tokio::test]
    async fn org_nachricht_beruehrt_den_einsatz_ring_nicht() {
        let hub = LiveHub::new();
        let mut einsatz = hub.abonniere(1);
        let _org = hub.abonniere_org();
        hub.publiziere_event(1, LiveEvent::Etb, "eins".into());
        hub.publiziere_stammdaten(1);
        hub.publiziere_einsatzliste(1, vec![]);
        hub.publiziere_event(1, LiveEvent::Etb, "zwei".into());

        let n1 = einsatz.recv().await.unwrap();
        let n2 = einsatz.recv().await.unwrap();
        assert_eq!(
            n2.data, "zwei",
            "auf dem Einsatz-Kanal kommt nichts dazwischen"
        );
        let nummer = |id: &str| id.split_once('-').unwrap().1.parse::<u64>().unwrap();
        assert_eq!(nummer(&n2.id), nummer(&n1.id) + 1, "Id-Folge lückenlos");
    }
}
