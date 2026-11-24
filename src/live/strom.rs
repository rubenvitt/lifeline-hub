//! Zulassung und Lebensdauer der Live-Ströme (LFH-920).
//!
//! Die beiden SSE-Routen (`GET /api/incidents/{id}/live`, `GET /api/live`) stehen in
//! [`crate::zulassung::OHNE_ZULASSUNGSGRENZE`]: eine Dauerverbindung bände sonst einen Platz des
//! routerweiten Caps und liefe ins Zeitbudget. Ihre eigene Grenze steht hier.
//!
//! * **Je Benutzer** höchstens [`STROEME_JE_BENUTZER`] offene Ströme, darüber 429.
//! * **Insgesamt** höchstens [`STROEME_GESAMT`], darüber 503 wie im übrigen Lastabwurf.
//! * **Lebensdauer:** jeder Strom endet nach [`STROM_LEBENSDAUER`] plus einem Zufallsanteil bis
//!   [`STROM_LEBENSDAUER_STREUUNG`]. Der Browser verbindet mit `Last-Event-ID` neu, der Replay
//!   schließt die Lücke, und Sitzung und Modulrechte werden dabei frisch geprüft. Ein Entzug
//!   wirkt so spätestens nach der Höchstlebensdauer; das Ende der Sitzung selbst (Abmelden,
//!   Beenden, Deaktivieren) schließt ihre Ströme sofort (`routes/live.rs`, LFH-1092).
//!
//! Der Platz wird belegt, bevor die Aufbauphase des Stroms Datenbank liest, und lebt im Strom:
//! er fällt zurück, sobald hyper den Body fallen lässt (Abbruch durch den Client oder Ende der
//! Lebensdauer).

use crate::error::AppError;
use axum::response::sse::Event;
use std::collections::HashMap;
use std::convert::Infallible;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::sync::{OwnedSemaphorePermit, Semaphore};
use tokio_stream::Stream;

/// Offene Live-Ströme je Benutzer. Ein Tab hält genau einen (Einsatz- oder Org-Strom), eine
/// Person mit Laptop und Tablet und mehreren Tabs kommt auf eine Handvoll. Die Grenze lässt
/// Platz für ein Konto, das an mehreren Plätzen einer Führungsstelle zugleich angemeldet ist,
/// und liegt weit unter den Strömen, die eine HTTP/2-Verbindung tragen darf
/// ([`crate::verbindung::HTTP2_MAX_STREAMS`]).
pub const STROEME_JE_BENUTZER: usize = 16;

/// Offene Live-Ströme insgesamt. Unter HTTP/1.1 belegt jeder Strom eine Verbindung; die Hälfte
/// der Verbindungsgrenze bleibt so für gewöhnliche Anfragen frei. Unter HTTP/2 deckelt sie, was
/// die Verbindungsgrenze dort nicht deckelt.
pub const STROEME_GESAMT: usize = crate::verbindung::MAX_VERBINDUNGEN / 2;

/// Mindestlebensdauer eines Stroms. Bis dahin wirkt ein Entzug von Sitzung oder Modulrecht auf
/// einen offenen Strom nicht (Snapshot-Regel, `routes/live.rs`).
pub const STROM_LEBENSDAUER: Duration = Duration::from_secs(30 * 60);

/// Zufallsanteil auf die Lebensdauer: Ströme, die nach einem Serverneustart zugleich öffnen,
/// enden nicht zugleich. Die Höchstlebensdauer (und damit das Restfenster nach einem Entzug)
/// ist [`STROM_LEBENSDAUER`] + diese Streuung.
pub const STROM_LEBENSDAUER_STREUUNG: Duration = Duration::from_secs(15 * 60);

/// Kürzeste Wartezeit des Browsers vor dem Neuverbinden (SSE-Feld `retry:`).
pub const RETRY_MIN: Duration = Duration::from_secs(1);

/// Zufallsanteil auf [`RETRY_MIN`]: nach einem Serverneustart verbinden die Tabs verteilt über
/// einige Sekunden neu statt im selben Augenblick.
pub const RETRY_STREUUNG: Duration = Duration::from_secs(4);

/// Takt des Lebenszeichens (LLH-1935, Change `l39v43md-sse-herzschlag`, design.md D1/D5): so oft
/// sendet jeder Live-Strom das Kontroll-Ereignis
/// [`HEARTBEAT_EREIGNIS`](crate::routes::support::HEARTBEAT_EREIGNIS), auch ohne Fach-Ereignis.
/// Das Frontend hält eine Leitung nach drei verpassten Schlägen für stumm und baut sie neu auf
/// (`HEARTBEAT_TIMEOUT_MS` in `frontend/src/live/liveVerbindung.ts`). Die Keep-Alive-Kommentare
/// von axum reichen dafür nicht: eine `EventSource` meldet Kommentare keinem Listener.
pub const HEARTBEAT_INTERVAL: Duration = Duration::from_secs(15);

const ZU_VIELE_STROEME: &str =
    "Zu viele offene Live-Verbindungen für diesen Benutzer — bitte nicht benötigte Tabs schließen.";

/// Wortgleich mit der Überlast-Meldung der Zulassung (`zulassung::UEBERLASTET`).
const UEBERLASTET: &str = "Dienst vorübergehend ausgelastet — bitte erneut versuchen.";

/// Die Grenzen, gebündelt, damit Tests sie klein und die Lebensdauer auf Millisekunden stellen.
#[derive(Clone, Copy, Debug)]
pub struct StromGrenzen {
    pub je_benutzer: usize,
    pub gesamt: usize,
    pub lebensdauer: Duration,
    pub streuung: Duration,
    /// Takt des Lebenszeichens, Vorgabe [`HEARTBEAT_INTERVAL`].
    pub heartbeat: Duration,
}

impl Default for StromGrenzen {
    fn default() -> Self {
        Self {
            je_benutzer: STROEME_JE_BENUTZER,
            gesamt: STROEME_GESAMT,
            lebensdauer: STROM_LEBENSDAUER,
            streuung: STROM_LEBENSDAUER_STREUUNG,
            heartbeat: HEARTBEAT_INTERVAL,
        }
    }
}

/// Zählt die offenen Live-Ströme. Klonbar, teilt seinen Zustand; lebt im
/// [`crate::live::LiveHub`].
#[derive(Clone)]
pub struct StromZulassung {
    grenzen: StromGrenzen,
    gesamt: Arc<Semaphore>,
    je_benutzer: Arc<Mutex<HashMap<i64, usize>>>,
}

impl StromZulassung {
    pub fn neu(grenzen: StromGrenzen) -> Self {
        Self {
            grenzen,
            gesamt: Arc::new(Semaphore::new(grenzen.gesamt)),
            je_benutzer: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    /// Belegt einen Platz für `benutzer_id`, ohne zu warten: je Benutzer voll → 429, insgesamt
    /// voll → 503. Der Platz fällt zurück, wenn der [`StromPlatz`] fällt.
    pub fn belegen(&self, benutzer_id: i64) -> Result<StromPlatz, AppError> {
        let mut zaehler = self.je_benutzer.lock().expect("Strom-Zähler");
        let offen = zaehler.get(&benutzer_id).copied().unwrap_or(0);
        if offen >= self.grenzen.je_benutzer {
            tracing::warn!(
                benutzer_id,
                offen,
                "Live-Ströme je Benutzer ausgeschöpft, Verbindung abgewiesen (429)"
            );
            return Err(AppError::TooManyRequests(ZU_VIELE_STROEME.into()));
        }
        let Ok(gesamt) = self.gesamt.clone().try_acquire_owned() else {
            tracing::warn!(
                "Live-Ströme insgesamt ausgeschöpft ({}), Verbindung abgewiesen (503)",
                self.grenzen.gesamt
            );
            return Err(AppError::ServiceUnavailable(UEBERLASTET.into()));
        };
        zaehler.insert(benutzer_id, offen + 1);
        Ok(StromPlatz {
            benutzer_id,
            je_benutzer: self.je_benutzer.clone(),
            _gesamt: gesamt,
        })
    }

    /// Offene Ströme von `benutzer_id` — für Tests und Diagnose.
    pub fn offen(&self, benutzer_id: i64) -> usize {
        self.je_benutzer
            .lock()
            .expect("Strom-Zähler")
            .get(&benutzer_id)
            .copied()
            .unwrap_or(0)
    }

    /// Lebensdauer des nächsten Stroms: Grundwert plus Zufallsanteil bis zur Streuung.
    pub fn lebensdauer(&self) -> Duration {
        self.grenzen.lebensdauer + zufall_bis(self.grenzen.streuung)
    }

    /// Takt des Lebenszeichens für den nächsten Strom ([`mit_heartbeat`]).
    pub fn heartbeat(&self) -> Duration {
        self.grenzen.heartbeat
    }
}

impl Default for StromZulassung {
    fn default() -> Self {
        Self::neu(StromGrenzen::default())
    }
}

/// Ein belegter Platz. Gibt beim Fallen den Benutzer-Zähler und den Gesamtplatz zurück.
pub struct StromPlatz {
    benutzer_id: i64,
    je_benutzer: Arc<Mutex<HashMap<i64, usize>>>,
    _gesamt: OwnedSemaphorePermit,
}

impl Drop for StromPlatz {
    fn drop(&mut self) {
        // Ein vergifteter Lock hieße, ein anderer Thread ist mitten im Zählen gestorben; den
        // Zähler trotzdem zu pflegen ist besser als einen Platz für immer zu verlieren.
        let mut zaehler = self
            .je_benutzer
            .lock()
            .unwrap_or_else(|vergiftet| vergiftet.into_inner());
        if let Some(offen) = zaehler.get_mut(&self.benutzer_id) {
            *offen = offen.saturating_sub(1);
            if *offen == 0 {
                zaehler.remove(&self.benutzer_id);
            }
        }
    }
}

/// Begrenzt einen Live-Strom: er endet nach `lebensdauer` und hält bis zu seinem Fallen den
/// `platz`.
pub fn begrenzt<S>(
    strom: S,
    platz: StromPlatz,
    lebensdauer: Duration,
) -> impl Stream<Item = Result<Event, Infallible>>
where
    S: Stream<Item = Result<Event, Infallible>>,
{
    let ende = tokio::time::sleep(lebensdauer);
    futures::StreamExt::map(
        futures::StreamExt::take_until(strom, ende),
        move |ereignis| {
            // Der Platz gehört der Closure und fällt mit dem Strom.
            let _ = &platz;
            ereignis
        },
    )
}

/// Das `retry:`-Feld mit gestreuter Wartezeit, als eigenes Ereignis ohne `id:`/`data:` (der
/// Browser verwirft es nach dem Übernehmen der Wartezeit, `Last-Event-ID` bleibt unberührt).
pub fn retry_ereignis() -> Result<Event, Infallible> {
    Ok(Event::default().retry(RETRY_MIN + zufall_bis(RETRY_STREUUNG)))
}

/// Mischt das Lebenszeichen im Takt `takt` in `strom` (LLH-1935, design.md D1): erster Schlag
/// nach einem Takt, danach im Takt, unabhängig von Fach-Ereignissen. Endet `strom`, endet auch
/// der Takt; eine bloße Verschmelzung liefe sonst ewig weiter.
///
/// Das Lebenszeichen trägt kein `id:` (die `Last-Event-ID` des Browsers bleibt die gemeldete
/// Position) und läuft an jedem Modul- und Gerätefilter vorbei: die Route mischt es nach dem
/// Filter ein.
pub fn mit_heartbeat<S>(strom: S, takt: Duration) -> impl Stream<Item = Result<Event, Infallible>>
where
    S: Stream<Item = Result<Event, Infallible>>,
{
    use tokio_stream::StreamExt as _;
    let mut intervall = tokio::time::interval_at(tokio::time::Instant::now() + takt, takt);
    // Ein blockierter Takt holt keine Schläge im Bündel nach.
    intervall.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
    let schlaege = futures::stream::unfold(intervall, |mut intervall| async move {
        intervall.tick().await;
        Some((Some(heartbeat_ereignis()), intervall))
    });
    // `None` markiert das Ende des inneren Stroms und beendet die Verschmelzung.
    strom
        .map(Some)
        .chain(tokio_stream::once(None))
        .merge(schlaege)
        .map_while(|ereignis| ereignis)
}

/// Das Lebenszeichen: `event: heartbeat`, `data: {}`, ohne `id:` (design.md D2). Ohne Daten
/// meldete eine `EventSource` das Ereignis keinem Listener.
fn heartbeat_ereignis() -> Result<Event, Infallible> {
    Ok(Event::default()
        .event(crate::routes::support::HEARTBEAT_EREIGNIS)
        .data("{}"))
}

/// Gleichverteilte Dauer in `[0, max]`, millisekundengenau. Quelle ist der Zufall von
/// `Uuid::new_v4` (Betriebssystem); eine eigene Crate lohnt für eine Streuung nicht.
fn zufall_bis(max: Duration) -> Duration {
    let millis = max.as_millis();
    if millis == 0 {
        return Duration::ZERO;
    }
    let zufall = uuid::Uuid::new_v4().as_u128() % (millis + 1);
    Duration::from_millis(zufall as u64)
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::http::StatusCode;

    fn zulassung(je_benutzer: usize, gesamt: usize) -> StromZulassung {
        StromZulassung::neu(StromGrenzen {
            je_benutzer,
            gesamt,
            ..StromGrenzen::default()
        })
    }

    #[test]
    fn je_benutzer_ist_nach_der_grenze_429_und_der_platz_faellt_zurueck() {
        let z = zulassung(2, 100);
        let a = z.belegen(7).expect("erster");
        let _b = z.belegen(7).expect("zweiter");
        let fehler = z.belegen(7).err().expect("dritter muss scheitern");
        assert_eq!(fehler.status(), StatusCode::TOO_MANY_REQUESTS);
        assert!(
            z.belegen(8).is_ok(),
            "ein anderer Benutzer hat eigene Plätze"
        );

        drop(a);
        assert_eq!(z.offen(7), 1);
        assert!(
            z.belegen(7).is_ok(),
            "nach dem Schließen ist der Platz frei"
        );
    }

    #[test]
    fn insgesamt_ist_nach_der_grenze_503() {
        let z = zulassung(10, 2);
        let _a = z.belegen(1).unwrap();
        let b = z.belegen(2).unwrap();
        let fehler = z.belegen(3).err().expect("Gesamtgrenze");
        assert_eq!(fehler.status(), StatusCode::SERVICE_UNAVAILABLE);
        assert_eq!(z.offen(3), 0, "ein abgewiesener Versuch zählt nicht");

        drop(b);
        assert!(z.belegen(3).is_ok());
    }

    #[test]
    fn leerer_benutzer_verschwindet_aus_dem_zaehler() {
        let z = zulassung(2, 2);
        drop(z.belegen(5).unwrap());
        assert!(z.je_benutzer.lock().unwrap().is_empty());
    }

    #[test]
    fn lebensdauer_liegt_im_gestreuten_fenster() {
        let z = StromZulassung::default();
        for _ in 0..50 {
            let d = z.lebensdauer();
            assert!(d >= STROM_LEBENSDAUER, "{d:?}");
            assert!(d <= STROM_LEBENSDAUER + STROM_LEBENSDAUER_STREUUNG, "{d:?}");
        }
    }

    #[test]
    fn zufall_streut_und_bleibt_in_der_grenze() {
        let max = Duration::from_secs(4);
        let werte: std::collections::HashSet<_> = (0..50).map(|_| zufall_bis(max)).collect();
        assert!(werte.iter().all(|d| *d <= max));
        assert!(
            werte.len() > 1,
            "50 Ziehungen dürfen nicht alle gleich sein"
        );
        assert_eq!(zufall_bis(Duration::ZERO), Duration::ZERO);
    }

    #[tokio::test]
    async fn begrenzter_strom_endet_nach_der_lebensdauer_und_gibt_den_platz_frei() {
        let z = zulassung(1, 1);
        let platz = z.belegen(9).unwrap();
        let endlos = futures::stream::pending::<Result<Event, Infallible>>();
        let strom = begrenzt(endlos, platz, Duration::from_millis(50));
        let gesammelt = tokio::time::timeout(
            Duration::from_secs(5),
            futures::StreamExt::collect::<Vec<_>>(strom),
        )
        .await
        .expect("der Strom muss nach der Lebensdauer enden");
        assert!(gesammelt.is_empty());
        assert_eq!(z.offen(9), 0, "mit dem Strom fällt der Platz");
    }

    /// Wire-Text eines Ereignisses; `Event` legt seinen Puffer nur über `Debug` offen.
    fn draht(e: &Result<Event, Infallible>) -> String {
        format!("{:?}", e.as_ref().unwrap())
    }

    #[test]
    fn heartbeat_takt_ist_15_s() {
        assert_eq!(HEARTBEAT_INTERVAL, Duration::from_secs(15));
        assert_eq!(StromGrenzen::default().heartbeat, HEARTBEAT_INTERVAL);
        assert_eq!(StromZulassung::default().heartbeat(), HEARTBEAT_INTERVAL);
    }

    /// Spec `live-abgleich`, „Live-Ströme senden ein regelmäßiges Lebenszeichen“ (LLH-1935): erster
    /// Schlag nach einem Takt, dann im Takt, ohne `id:`; Fach-Ereignisse laufen durch, und mit dem
    /// inneren Strom endet auch der Takt.
    #[tokio::test(start_paused = true)]
    async fn heartbeat_schlaegt_im_takt_ohne_id_und_endet_mit_dem_strom() {
        use tokio_stream::StreamExt as _;
        let (tx, rx) = tokio::sync::mpsc::channel::<Result<Event, Infallible>>(4);
        let takt = Duration::from_secs(15);
        let mut strom = Box::pin(mit_heartbeat(
            tokio_stream::wrappers::ReceiverStream::new(rx),
            takt,
        ));

        let vor_dem_takt =
            tokio::time::timeout(takt - Duration::from_millis(1), strom.next()).await;
        assert!(vor_dem_takt.is_err(), "vor dem ersten Takt kein Schlag");

        let erster = strom.next().await.expect("erster Schlag");
        let d = draht(&erster);
        assert!(d.contains("event: heartbeat"), "{d}");
        assert!(d.contains("data: {}"), "{d}");
        assert!(
            !d.contains("id:"),
            "das Lebenszeichen trägt keine Position: {d}"
        );

        tx.send(Ok(Event::default()
            .event(crate::live::LiveEvent::Etb.as_str())
            .data("{}")))
            .await
            .unwrap();
        assert!(draht(&strom.next().await.unwrap()).contains("event: etb"));

        let zweiter = strom.next().await.expect("zweiter Schlag");
        assert!(draht(&zweiter).contains("event: heartbeat"));

        drop(tx);
        let rest = tokio::time::timeout(takt * 4, strom.next()).await;
        assert!(
            matches!(rest, Ok(None)),
            "endet der innere Strom, endet auch der Takt"
        );
    }
}
