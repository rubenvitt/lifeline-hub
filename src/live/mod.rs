use std::collections::HashMap;
use std::sync::{Arc, RwLock};
use tokio::sync::broadcast;

/// Kapazität des Broadcast-Puffers pro Einsatz. Großzügig bemessen für
/// Erfassungs-Bursts; läuft ein langsamer Client über, erhält er ein
/// `lagged`-Signal und resynct per GET (siehe SSE-Route).
const KANAL_KAPAZITAET: usize = 256;

/// Registry der Live-Kanäle: pro Einsatz ein Broadcast-Sender, über den
/// neu erfasste ETB-Einträge (als JSON-String) an alle SSE-Abonnenten gehen.
///
/// Klonbar (teilt denselben inneren Zustand) — wird im `AppState` gehalten.
#[derive(Clone, Default)]
pub struct LiveHub {
    kanaele: Arc<RwLock<HashMap<i64, broadcast::Sender<String>>>>,
}

impl LiveHub {
    /// Neuer, leerer Hub.
    pub fn new() -> Self {
        Self::default()
    }

    /// Abonniert den Live-Kanal eines Einsatzes (legt ihn bei Bedarf an)
    /// und liefert einen Empfänger für neue Einträge.
    pub fn abonniere(&self, einsatz_id: i64) -> broadcast::Receiver<String> {
        let mut kanaele = self.kanaele.write().expect("LiveHub-Lock");
        let sender = kanaele
            .entry(einsatz_id)
            .or_insert_with(|| broadcast::channel(KANAL_KAPAZITAET).0);
        sender.subscribe()
    }

    /// Sendet eine Nachricht an alle Abonnenten eines Einsatzes.
    /// Ohne Kanal/Abonnenten passiert nichts. Ein Kanal ohne Empfänger wird
    /// opportunistisch entfernt, damit der Hub nicht über abgeschlossene
    /// Einsätze hinweg leakt.
    /// Nachrichten, die bei leerem Kanal gesendet werden, gehen verloren — neue
    /// Abonnenten erhalten nach ihrem Connect nur nachfolgende Einträge (vgl. §6).
    pub fn publiziere(&self, einsatz_id: i64, nachricht: String) {
        // Häufiger Fall (Kanal existiert): nur Lese-Lock.
        let keine_empfaenger = {
            let kanaele = self.kanaele.read().expect("LiveHub-Lock");
            match kanaele.get(&einsatz_id) {
                // send() liefert Err, wenn kein Empfänger mehr lauscht.
                Some(sender) => sender.send(nachricht).is_err(),
                None => false,
            }
        };

        if keine_empfaenger {
            let mut kanaele = self.kanaele.write().expect("LiveHub-Lock");
            // Soundness-Invariante: abonniere() hält ebenfalls einen Write-Lock,
            // während es den Kanal anlegt und subscribt. Daher kann zwischen dem
            // Freigeben des Read-Locks oben und diesem Write-Lock kein Abonnent
            // dazukommen — receiver_count() == 0 garantiert hier einen wirklich
            // verwaisten Kanal. NICHT abonniere() auf einen Read-Lock-Fastpath
            // optimieren, sonst greift diese Garantie nicht mehr.
            // Erneut prüfen: zwischen den Locks könnte ein neuer Abonnent dazugekommen sein.
            if let Some(sender) = kanaele.get(&einsatz_id) {
                if sender.receiver_count() == 0 {
                    kanaele.remove(&einsatz_id);
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn abonnent_empfaengt_publizierte_nachricht() {
        let hub = LiveHub::new();
        let mut rx = hub.abonniere(1);
        hub.publiziere(1, "hallo".into());
        assert_eq!(rx.recv().await.unwrap(), "hallo");
    }

    #[tokio::test]
    async fn nachricht_geht_nur_an_passenden_einsatz() {
        let hub = LiveHub::new();
        let mut rx1 = hub.abonniere(1);
        let mut rx2 = hub.abonniere(2);
        hub.publiziere(1, "fuer-eins".into());

        assert_eq!(rx1.recv().await.unwrap(), "fuer-eins");
        // Einsatz 2 hat nichts bekommen.
        assert!(rx2.try_recv().is_err());
    }

    #[tokio::test]
    async fn publiziere_ohne_abonnenten_ist_harmlos() {
        let hub = LiveHub::new();
        hub.publiziere(99, "niemand-hoert".into()); // darf nicht panicken
    }

    #[tokio::test]
    async fn kanal_ohne_empfaenger_wird_entfernt() {
        let hub = LiveHub::new();
        let rx = hub.abonniere(1);
        drop(rx); // letzter Empfänger weg
        hub.publiziere(1, "ins-leere".into()); // löst Cleanup aus

        // Interner Zustand: Kanal entfernt.
        assert!(hub.kanaele.read().unwrap().get(&1).is_none());
    }

    #[tokio::test]
    async fn mehrere_abonnenten_erhalten_dieselbe_nachricht() {
        let hub = LiveHub::new();
        let mut a = hub.abonniere(1);
        let mut b = hub.abonniere(1);
        hub.publiziere(1, "broadcast".into());
        assert_eq!(a.recv().await.unwrap(), "broadcast");
        assert_eq!(b.recv().await.unwrap(), "broadcast");
    }
}
