use serde::Serialize;
use std::collections::{HashMap, VecDeque};
use std::sync::{Arc, RwLock};
use tokio::sync::broadcast;
use utoipa::ToSchema;

/// SSE-Wire-Event-Namen als BE↔FE-Kontrakt (LFH-298). Schema-Anker für die OpenAPI-Union;
/// die Emitter routen über `as_str()`, das Frontend filtert exakt auf diese Wire-Tags.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum LiveEvent {
    Uhs,
    Schaden,
    Fahrzeug,
    Material,
    Tier,
    LageZone,
    FreiesZeichen,
    Gefahr,
    Einheit,
    Abschnitt,
    Person,
    Lagebericht,
    Chat,
    Erinnerung,
    Auftrag,
    Nachforderung,
    Meldung,
    Bereitstellungsraum,
    KarteBild,
    Etb,
    Befehl,
    Sofortmeldung,
    Lagged,
}

impl LiveEvent {
    /// Alle Varianten in kanonischer Reihenfolge — Anker für den Wire-Kontrakt-Guard
    /// (`tests/enum_wire_kontrakt.rs`) und die Exhaustiveness-Prüfung.
    pub const ALLE: [LiveEvent; 23] = [
        LiveEvent::Uhs,
        LiveEvent::Schaden,
        LiveEvent::Fahrzeug,
        LiveEvent::Material,
        LiveEvent::Tier,
        LiveEvent::LageZone,
        LiveEvent::FreiesZeichen,
        LiveEvent::Gefahr,
        LiveEvent::Einheit,
        LiveEvent::Abschnitt,
        LiveEvent::Person,
        LiveEvent::Lagebericht,
        LiveEvent::Chat,
        LiveEvent::Erinnerung,
        LiveEvent::Auftrag,
        LiveEvent::Nachforderung,
        LiveEvent::Meldung,
        LiveEvent::Bereitstellungsraum,
        LiveEvent::KarteBild,
        LiveEvent::Etb,
        LiveEvent::Befehl,
        LiveEvent::Sofortmeldung,
        LiveEvent::Lagged,
    ];

    /// Der load-bearing SSE-Wire-Tag. Das Frontend filtert exakt auf diesen String
    /// (`EINSATZ_STREAM_EVENTS` in `queryKeys.ts`); Änderungen bricht der Cross-Language-
    /// Kontrakttest (`live_event_wire` + FE `liveEvent.contract.test.ts`).
    pub fn as_str(&self) -> &'static str {
        match self {
            LiveEvent::Uhs => "uhs",
            LiveEvent::Schaden => "schaden",
            LiveEvent::Fahrzeug => "fahrzeug",
            LiveEvent::Material => "material",
            LiveEvent::Tier => "tier",
            LiveEvent::LageZone => "lage_zone",
            LiveEvent::FreiesZeichen => "freies_zeichen",
            LiveEvent::Gefahr => "gefahr",
            LiveEvent::Einheit => "einheit",
            LiveEvent::Abschnitt => "abschnitt",
            LiveEvent::Person => "person",
            LiveEvent::Lagebericht => "lagebericht",
            LiveEvent::Chat => "chat",
            LiveEvent::Erinnerung => "erinnerung",
            LiveEvent::Auftrag => "auftrag",
            LiveEvent::Nachforderung => "nachforderung",
            LiveEvent::Meldung => "meldung",
            LiveEvent::Bereitstellungsraum => "bereitstellungsraum",
            LiveEvent::KarteBild => "karte_bild",
            LiveEvent::Etb => "etb",
            LiveEvent::Befehl => "befehl",
            LiveEvent::Sofortmeldung => "sofortmeldung",
            LiveEvent::Lagged => "lagged",
        }
    }
}

/// Kapazität des Broadcast-Puffers pro Einsatz. Großzügig bemessen für
/// Erfassungs-Bursts; läuft ein langsamer Client über, erhält er ein
/// `lagged`-Signal und resynct per GET (siehe SSE-Route).
const KANAL_KAPAZITAET: usize = 256;

/// Größe des Replay-Ringpuffers pro Einsatz (F14/LFH-263). Ein kurz getrennter Client
/// (Reconnect mit `Last-Event-ID`) bekommt die verpassten Nachrichten nachgeliefert;
/// liegt seine Last-Event-ID vor dem ältesten Ring-Eintrag, gilt eine `Luecke` → Voll-Resync.
const REPLAY_KAPAZITAET: usize = 256;

/// Eine Live-Nachricht im Einsatz-Kanal: eine monotone Id plus SSE-Event-Name und
/// serialisierte Daten. Clients abonnieren denselben Kanal und filtern per Event-Name
/// (`etb`, `person`, …) — sensible Payload gehört NICHT in `data`.
///
/// `id` = `"{epoch}-{n}"`: `n` ist pro Einsatz monoton (ab 1), `epoch` ist prozess-eindeutig
/// (Prozessstart). Nach einem Serverneustart ändert sich die epoch → alte `Last-Event-ID`s
/// werden als `Luecke` erkannt statt auf wiederverwendete `n` zu aliasen (best-effort-Replay).
#[derive(Clone, Debug)]
pub struct LiveNachricht {
    pub id: String,
    pub event: String,
    pub data: String,
}

/// Ergebnis eines (Wieder-)Abonnements mit `Last-Event-ID` (F14/LFH-263).
pub enum Replay {
    /// Erstverbindung (kein `Last-Event-ID`) → nichts nachzuliefern.
    Keine,
    /// Seit der `Last-Event-ID` verpasste Nachrichten, aufsteigend.
    Events(Vec<LiveNachricht>),
    /// Die angeforderte Id ist nicht (mehr) bedienbar — Ring-Overflow oder fremde
    /// Prozess-Epoch (Neustart). Der Client muss voll resyncen (`lagged`).
    Luecke,
}

/// Ein Einsatz-Kanal: Broadcast-Sender + Zähler + Replay-Ring. Alle drei werden IMMER
/// unter demselben Write-Lock des `LiveHub` angefasst — so kann zwischen dem Ring-Snapshot
/// und dem `subscribe()` in `abonniere_mit_replay` kein `send` aus `publiziere_event`
/// dazwischenfunken (exactly-once, gap-/dup-frei).
struct Kanal {
    sender: broadcast::Sender<LiveNachricht>,
    naechste_id: u64,
    ring: VecDeque<LiveNachricht>,
}

/// Registry der Live-Kanäle: pro Einsatz ein `Kanal`, über den getaggte `LiveNachricht`-
/// Einträge an alle SSE-Abonnenten gehen.
///
/// Klonbar (teilt denselben inneren Zustand) — wird im `AppState` gehalten.
#[derive(Clone)]
pub struct LiveHub {
    kanaele: Arc<RwLock<HashMap<i64, Kanal>>>,
    /// Prozess-Epoch (Prozessstart). Teil jeder Nachrichten-Id; ein Neustart erzeugt eine
    /// andere Epoch → Replay über einen Neustart hinweg wird als `Luecke` erkannt.
    epoch: u64,
}

impl Default for LiveHub {
    fn default() -> Self {
        Self::new()
    }
}

/// Zerlegt eine Nachrichten-Id `"{epoch}-{n}"` in ihre beiden Zahlen.
fn parse_id(roh: &str) -> Option<(u64, u64)> {
    let (e, n) = roh.split_once('-')?;
    Some((e.parse().ok()?, n.parse().ok()?))
}

/// Bestimmt aus dem Ring, ob und welche Nachrichten seit `roh` (der `Last-Event-ID`) verpasst
/// wurden. `naechste_id` ist die nächste zu vergebende Id; die zuletzt vergebene war
/// `naechste_id - 1`.
fn bestimme_replay(
    ring: &VecDeque<LiveNachricht>,
    naechste_id: u64,
    epoch: u64,
    roh: &str,
) -> Replay {
    let Some((e, n)) = parse_id(roh) else {
        return Replay::Luecke; // unparsbare Id → sicherheitshalber Voll-Resync
    };
    if e != epoch {
        return Replay::Luecke; // fremde Epoch (Neustart)
    }
    // `saturating_add`, weil `n` aus der client-kontrollierten Last-Event-ID stammt
    // (parse_id akzeptiert bis u64::MAX) — `n + 1` würde bei u64::MAX im Debug/Test-Build
    // panicken. Eine „aus der Zukunft" liegende Id fällt so sauber auf „nichts Neues".
    if n.saturating_add(1) >= naechste_id {
        return Replay::Events(Vec::new());
    }
    // Es gibt Nachrichten mit Id-Nummer > n. Ist die erste davon (n+1) noch im Ring?
    match ring.front().and_then(|m| parse_id(&m.id)).map(|(_, mn)| mn) {
        None => Replay::Events(Vec::new()), // Ring leer → nichts nachzuliefern
        Some(aeltestes) if n.saturating_add(1) < aeltestes => Replay::Luecke, // (n+1) bereits evictet
        Some(_) => {
            let verpasst = ring
                .iter()
                .filter(|m| parse_id(&m.id).is_some_and(|(_, mn)| mn > n))
                .cloned()
                .collect();
            Replay::Events(verpasst)
        }
    }
}

impl LiveHub {
    /// Neuer, leerer Hub mit einer prozess-eindeutigen Epoch (Prozessstart-Zeitstempel).
    pub fn new() -> Self {
        let epoch = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos() as u64)
            .unwrap_or(0);
        Self {
            kanaele: Arc::new(RwLock::new(HashMap::new())),
            epoch,
        }
    }

    /// Abonniert den Live-Kanal eines Einsatzes (legt ihn bei Bedarf an) und liefert einen
    /// Empfänger. Dünner Wrapper um [`Self::abonniere_mit_replay`] ohne `Last-Event-ID`.
    pub fn abonniere(&self, einsatz_id: i64) -> broadcast::Receiver<LiveNachricht> {
        self.abonniere_mit_replay(einsatz_id, None).1
    }

    /// Abonniert mit optionaler `Last-Event-ID` und liefert `(Replay, Empfänger)`.
    ///
    /// Snapshot des Replay-Rings UND `subscribe()` passieren unter EINER Write-Lock-
    /// Acquisition — dieselbe Lock, die `publiziere_event` nimmt. Dadurch kann zwischen dem
    /// Snapshot und dem Abonnieren kein `send` dazwischenkommen: der Client erhält jede
    /// Nachricht genau einmal (per Replay ODER live), ohne Lücke oder Dublette am Nahtpunkt.
    pub fn abonniere_mit_replay(
        &self,
        einsatz_id: i64,
        seit: Option<String>,
    ) -> (Replay, broadcast::Receiver<LiveNachricht>) {
        let mut kanaele = self.kanaele.write().expect("LiveHub-Lock");
        let kanal = kanaele.entry(einsatz_id).or_insert_with(|| Kanal {
            sender: broadcast::channel(KANAL_KAPAZITAET).0,
            naechste_id: 1,
            ring: VecDeque::new(),
        });
        let replay = match seit {
            None => Replay::Keine,
            Some(roh) => bestimme_replay(&kanal.ring, kanal.naechste_id, self.epoch, &roh),
        };
        let rx = kanal.sender.subscribe();
        (replay, rx)
    }

    /// Sendet einen ETB-Eintrag (JSON) an alle Abonnenten. Bequemer Wrapper für
    /// den häufigsten Fall — entspricht `publiziere_event(id, "etb", json)`.
    pub fn publiziere(&self, einsatz_id: i64, json: String) {
        self.publiziere_event(einsatz_id, LiveEvent::Etb, json);
    }

    /// Sendet ein getaggtes Event an alle Abonnenten eines Einsatzes.
    ///
    /// Vergibt die monotone Id, pflegt den Replay-Ring und sendet — alles unter EINEM
    /// Write-Lock (dieselbe Lock wie `abonniere_mit_replay`, siehe dort). Existiert kein
    /// Kanal (nie jemand abonniert), geht die Nachricht verloren — neue Abonnenten erhalten
    /// nur nachfolgende Einträge. Ein Kanal, dessen letzter Empfänger weg ist, wird
    /// opportunistisch entfernt, damit der Hub nicht über abgeschlossene Einsätze leakt.
    pub fn publiziere_event(&self, einsatz_id: i64, event: LiveEvent, data: String) {
        let mut kanaele = self.kanaele.write().expect("LiveHub-Lock");
        let Some(kanal) = kanaele.get_mut(&einsatz_id) else {
            return; // kein Abonnent → verwerfen
        };
        let nachricht = LiveNachricht {
            id: format!("{}-{}", self.epoch, kanal.naechste_id),
            event: event.as_str().to_string(),
            data,
        };
        kanal.naechste_id += 1;
        if kanal.ring.len() >= REPLAY_KAPAZITAET {
            kanal.ring.pop_front();
        }
        kanal.ring.push_back(nachricht.clone());
        // send() liefert Err, wenn kein Empfänger mehr lauscht → verwaisten Kanal entfernen.
        if kanal.sender.send(nachricht).is_err() {
            kanaele.remove(&einsatz_id);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Extrahiert die Epoch aus einer Nachrichten-Id (für deterministische Replay-Tests).
    fn epoch_von(id: &str) -> u64 {
        parse_id(id).unwrap().0
    }

    #[tokio::test]
    async fn abonnent_empfaengt_publizierte_nachricht() {
        let hub = LiveHub::new();
        let mut rx = hub.abonniere(1);
        hub.publiziere(1, "hallo".into());
        assert_eq!(rx.recv().await.unwrap().data, "hallo");
    }

    #[tokio::test]
    async fn nachricht_geht_nur_an_passenden_einsatz() {
        let hub = LiveHub::new();
        let mut rx1 = hub.abonniere(1);
        let mut rx2 = hub.abonniere(2);
        hub.publiziere(1, "fuer-eins".into());

        assert_eq!(rx1.recv().await.unwrap().data, "fuer-eins");
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
        assert!(hub.kanaele.read().unwrap().get(&1).is_none());
    }

    #[tokio::test]
    async fn mehrere_abonnenten_erhalten_dieselbe_nachricht() {
        let hub = LiveHub::new();
        let mut a = hub.abonniere(1);
        let mut b = hub.abonniere(1);
        hub.publiziere(1, "broadcast".into());
        assert_eq!(a.recv().await.unwrap().data, "broadcast");
        assert_eq!(b.recv().await.unwrap().data, "broadcast");
    }

    #[tokio::test]
    async fn publiziere_event_traegt_event_typ() {
        let hub = LiveHub::new();
        let mut rx = hub.abonniere(1);
        hub.publiziere_event(
            1,
            LiveEvent::Person,
            r#"{"einsatz_id":1,"person_id":5}"#.into(),
        );
        let n = rx.recv().await.unwrap();
        assert_eq!(n.event, "person");
        assert_eq!(n.data, r#"{"einsatz_id":1,"person_id":5}"#);
    }

    #[tokio::test]
    async fn publiziere_wrapt_als_etb_event() {
        let hub = LiveHub::new();
        let mut rx = hub.abonniere(1);
        hub.publiziere(1, "hallo".into());
        let n = rx.recv().await.unwrap();
        assert_eq!(n.event, "etb");
        assert_eq!(n.data, "hallo");
    }

    // --- F14/LFH-263: monotone Ids + Replay ---

    #[tokio::test]
    async fn ids_sind_pro_einsatz_monoton_und_unabhaengig() {
        let hub = LiveHub::new();
        let mut a = hub.abonniere(1);
        let mut b = hub.abonniere(2);
        hub.publiziere_event(1, LiveEvent::Etb, "a1".into());
        hub.publiziere_event(1, LiveEvent::Etb, "a2".into());
        hub.publiziere_event(2, LiveEvent::Etb, "b1".into());

        let a1 = a.recv().await.unwrap();
        let a2 = a.recv().await.unwrap();
        let b1 = b.recv().await.unwrap();
        assert_eq!(parse_id(&a1.id).unwrap().1, 1);
        assert_eq!(parse_id(&a2.id).unwrap().1, 2);
        assert_eq!(
            parse_id(&b1.id).unwrap().1,
            1,
            "Einsatz 2 zählt unabhängig ab 1"
        );
    }

    #[tokio::test]
    async fn abonniere_mit_replay_ohne_seit_ist_keine() {
        let hub = LiveHub::new();
        let (replay, _rx) = hub.abonniere_mit_replay(1, None);
        assert!(matches!(replay, Replay::Keine));
    }

    #[tokio::test]
    async fn replay_liefert_nur_verpasste_nachrichten() {
        let hub = LiveHub::new();
        let mut rx = hub.abonniere(1);
        hub.publiziere_event(1, LiveEvent::Etb, "eins".into());
        hub.publiziere_event(1, LiveEvent::Etb, "zwei".into());
        let n1 = rx.recv().await.unwrap(); // id …-1

        // Client hatte n1 gesehen und verbindet neu → nur "zwei" (id …-2) ist verpasst.
        let (replay, _rx2) = hub.abonniere_mit_replay(1, Some(n1.id.clone()));
        match replay {
            Replay::Events(v) => {
                assert_eq!(v.len(), 1);
                assert_eq!(v[0].data, "zwei");
            }
            _ => panic!("erwartete Events, keine Luecke/Keine"),
        }
    }

    #[tokio::test]
    async fn replay_auf_aktuellem_stand_ist_leer() {
        let hub = LiveHub::new();
        let mut rx = hub.abonniere(1);
        hub.publiziere_event(1, LiveEvent::Etb, "eins".into());
        let n1 = rx.recv().await.unwrap();
        let (replay, _rx2) = hub.abonniere_mit_replay(1, Some(n1.id.clone()));
        assert!(matches!(replay, Replay::Events(v) if v.is_empty()));
    }

    #[tokio::test]
    async fn replay_bei_ring_overflow_ist_luecke() {
        let hub = LiveHub::new();
        let mut rx = hub.abonniere(1);
        // Erste Nachricht merken, dann den Ring (REPLAY_KAPAZITAET) sicher überlaufen lassen.
        hub.publiziere_event(1, LiveEvent::Etb, "erste".into());
        let n1 = rx.recv().await.unwrap();
        for i in 0..(REPLAY_KAPAZITAET as i32 + 5) {
            hub.publiziere_event(1, LiveEvent::Etb, format!("f{i}"));
        }
        // n1 ist längst aus dem Ring evictet → Luecke.
        let (replay, _rx2) = hub.abonniere_mit_replay(1, Some(n1.id.clone()));
        assert!(matches!(replay, Replay::Luecke));
    }

    #[tokio::test]
    async fn replay_bei_fremder_epoch_ist_luecke() {
        let hub = LiveHub::new();
        let mut rx = hub.abonniere(1);
        hub.publiziere_event(1, LiveEvent::Etb, "eins".into());
        let n1 = rx.recv().await.unwrap();
        let fremde_epoch = epoch_von(&n1.id) + 1; // simuliert einen Serverneustart
        let (replay, _rx2) = hub.abonniere_mit_replay(1, Some(format!("{fremde_epoch}-1")));
        assert!(matches!(replay, Replay::Luecke));
    }

    #[tokio::test]
    async fn replay_bei_unparsbarer_last_event_id_ist_luecke() {
        // Der Last-Event-ID-Header ist client-kontrolliert und wird roh durchgereicht.
        let hub = LiveHub::new();
        let _rx = hub.abonniere(1);
        hub.publiziere_event(1, LiveEvent::Etb, "eins".into());
        for seit in ["kaputt", "1-abc", ""] {
            let (replay, _) = hub.abonniere_mit_replay(1, Some(seit.to_string()));
            assert!(
                matches!(replay, Replay::Luecke),
                "unparsbare Last-Event-ID {seit:?} muss Luecke (Voll-Resync) ergeben"
            );
        }
    }

    #[tokio::test]
    async fn replay_bei_u64_max_last_event_id_panickt_nicht() {
        // Adversariale Id: echte epoch (passiert den Epoch-Guard) + u64::MAX. Ohne
        // saturating_add wuerde n + 1 im Debug/Test-Build panicken.
        let hub = LiveHub::new();
        let mut rx = hub.abonniere(1);
        hub.publiziere_event(1, LiveEvent::Etb, "eins".into());
        let n1 = rx.recv().await.unwrap();
        let epoch = epoch_von(&n1.id);
        let (replay, _) = hub.abonniere_mit_replay(1, Some(format!("{epoch}-{}", u64::MAX)));
        // „aus der Zukunft" → nichts Neues, kein Panic.
        assert!(matches!(replay, Replay::Events(v) if v.is_empty()));
    }

    #[tokio::test]
    async fn replay_traegt_alarm_events_nach() {
        // F14-Kern: der Mittelfrist rechtfertigt sich über verpasste ALARME. Eine während der
        // Trennung gesendete sofortmeldung muss beim Reconnect nachgeliefert werden (der FE-Hook
        // feuert dann seinen Alarm-Listener genau einmal).
        let hub = LiveHub::new();
        let mut rx = hub.abonniere(1);
        hub.publiziere_event(1, LiveEvent::Etb, "vorher".into());
        let n1 = rx.recv().await.unwrap();
        hub.publiziere_event(1, LiveEvent::Sofortmeldung, r#"{"meldung_id":3}"#.into());

        let (replay, _rx2) = hub.abonniere_mit_replay(1, Some(n1.id.clone()));
        match replay {
            Replay::Events(v) => {
                assert_eq!(v.len(), 1);
                assert_eq!(v[0].event, "sofortmeldung");
            }
            _ => panic!("verpasste sofortmeldung muss als Replay-Event kommen"),
        }
    }
}
