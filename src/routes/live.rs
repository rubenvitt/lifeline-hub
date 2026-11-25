//! Kanonischer Live-Feed eines Einsatzes (LFH-227) und Org-Strom (LFH-734).
//!
//! Der Einsatz-Feed trägt die Org-Ereignisse (`einsatzliste`, `stammdaten`) mit, damit ein Tab
//! im Einsatz bei EINER Verbindung bleibt; außerhalb eines Einsatzes öffnet das Frontend den
//! Org-Strom `GET /api/live` (`openspec/changes/archive/2026-10-01-lfh-734-org-live-ereignis/design.md`, D1).
//!
//! EINE Tür (Lesezugriff auf den Einsatz) und ein **Filter je Event** nach den erlaubten
//! Modulen — sonst läse, wer irgendeinen Stream öffnen darf, jedes Event mit, inkl. ETB- und
//! Chat-Volltexten. Eine Benachrichtigung geht zusätzlich nur an ihre Empfänger, jede Verbindung
//! mit der Nutzlast ihres Nutzers (LLH-1207, [`crate::live::LiveNachricht::fuer`]).
//!
//! **Revokation = Snapshot:** die erlaubten Module werden einmal beim Verbindungsaufbau
//! berechnet; ein Rechteentzug wirkt erst beim Reconnect. Den erzwingt die Lebensdauer jedes
//! Stroms (LFH-920, [`crate::live::strom`]): das Restfenster nach einem Entzug eines
//! Modulrechts ist höchstens `STROM_LEBENSDAUER + STROM_LEBENSDAUER_STREUUNG` (45 min). Es
//! verrät nur Metadaten (alle Payloads tragen nur IDs), der Inhalts-GET antwortet sofort 403.
//! Ein DB-Read je Event vervielfachte die Kosten bei Erfassungs-Bursts.
//!
//! **Das Ende der Sitzung selbst wirkt sofort** (LFH-1092, design.md D6): jeder Strom endet, sobald
//! seine Sitzung gelöscht ist ([`crate::live::LiveHub::melde_sitzung_ende`]). Der Neuaufbau
//! bekommt 401, und das Gerät räumt sein Lagebild, ohne dass dort jemand etwas bedient.
//!
//! **Lebenszeichen** (LLH-1935): beide Ströme senden im Takt [`strom::HEARTBEAT_INTERVAL`] das
//! Kontroll-Ereignis `heartbeat` ([`strom::mit_heartbeat`]). Daran erkennt das Frontend eine
//! Leitung, die offen scheint, aber nichts mehr liefert (halboffenes TCP im Funkloch); die
//! Keep-Alive-Kommentare sieht eine `EventSource` nicht. Sie bleiben trotzdem gesetzt
//! (`openspec/changes/archive/2026-11-17-l39v43md-sse-herzschlag/design.md`, D1).
//!
//! **Zulassung:** beide Ströme stehen außerhalb der routerweiten Zulassung
//! ([`crate::zulassung::OHNE_ZULASSUNGSGRENZE`]) und belegen stattdessen vor jeder weiteren
//! Datenbankabfrage einen Platz in [`crate::live::strom::StromZulassung`] (je Benutzer 429,
//! insgesamt 503). Der Platz lebt im Strom.

use crate::app::AppState;
use crate::auth::session::{AktuelleSitzung, CurrentUser, SitzungKennung};
use crate::einsatz::berechtigung::erlaubte_module;
use crate::einsatz::kontext::EinsatzLesezugriff;
use crate::error::AppError;
use crate::live::org::OrgAbonnent;
use crate::live::strom;
use axum::extract::State;
use axum::http::HeaderMap;
use axum::response::sse::{Event, KeepAlive, Sse};
use std::convert::Infallible;
use tokio_stream::{Stream, StreamExt};

/// GET /api/incidents/{id}/live — der Live-Feed des Einsatzes.
///
/// `EinsatzLesezugriff<OhneModul>` erzwingt Org-Floor und Lesezugriff (Org-Grenze, Soft-Delete,
/// Retention, Nachlauffrist) und **kein** Modul-Gate: die Route gehört keinem Modul, die
/// Modul-Ebene wirkt als Event-Filter.
pub async fn stream(
    State(state): State<AppState>,
    ctx: EinsatzLesezugriff,
    AktuelleSitzung(sitzung): AktuelleSitzung,
    headers: HeaderMap,
) -> Result<Sse<impl Stream<Item = Result<Event, Infallible>>>, AppError> {
    // Erst der Platz, dann die Aufbauphase: ein abgewiesener Strom kostet keine Modulabfrage.
    let platz = state.live.stroeme.belegen(ctx.benutzer.id)?;
    let einsatz_id = ctx.einsatz.id;
    let mut erlaubt = erlaubte_module(
        &state.pool,
        einsatz_id,
        ctx.einsatz.org_id,
        &ctx.benutzer,
        ctx.modul_rolle(),
    )
    .await?;
    // Ein Gerät (LFH-892) erhält nur die Ereignisse seiner Ansicht.
    if let Some(g) = &ctx.geraet {
        erlaubt = g.schneide_module(erlaubt);
    }

    // Reconnect-Resync: mit `Last-Event-ID` liefert der LiveHub die verpassten Nachrichten nach
    // (bzw. `lagged` bei Ring-Overflow/Neustart). Der Filter greift auf beiden Wegen.
    // Danach die Position des Abonnements als `id:` ohne Daten (LFH-922, design.md D4).
    // Benachrichtigungen (LLH-1207, design.md D2) gehen nur an die Verbindungen ihrer Empfänger,
    // auch im Replay, je mit der Nutzlast dieses Nutzers: der Filter sieht die ganze Nachricht
    // samt interner Empfängerliste und gibt die Fassung dieser Verbindung weiter.
    let seit = crate::routes::support::last_event_id(&headers);
    let (replay, rx, position) = state.live.abonniere_mit_position(einsatz_id, seit);
    let benutzer_id = ctx.benutzer.id;
    // Der Lagemonitor bekommt Sofortmeldungen als Signal ohne Inhalt (LLH-1743, D7).
    let lagemonitor = ctx.geraet.as_ref().map(|g| g.ansicht)
        == Some(crate::geraet::Funktionsansicht::Lagemonitor);
    // Ereignisse nur für die Einsatzleitung (Helfer-App, `LiveEvent::nur_leitung`): nie an ein
    // Gerät, dessen Rolle keine Person in Führung ist.
    let leitung = ctx.geraet.is_none() && ctx.fordere_einsatzleitung().is_ok();
    // Präsenz an Einzelangaben (LLH-1946, Entwurf D2): eigener Teilstrom am Ring vorbei, nie an
    // ein Gerät. Abonniert vor dem Lesen des Stands, damit keine Änderung dazwischen verloren geht.
    let praesenz_strom = match &ctx.geraet {
        None => {
            let rx = state.live.abonniere_praesenz();
            let hub = state.live.clone();
            futures::StreamExt::boxed(crate::routes::support::sse_praesenz_stream(
                state.live.praesenz_stand(einsatz_id),
                rx,
                erlaubt.clone(),
                move || hub.praesenz_stand(einsatz_id),
            ))
        }
        Some(_) => futures::StreamExt::boxed(futures::stream::empty()),
    };
    let einsatz_strom =
        crate::routes::support::sse_stream_mit_replay(replay, rx, position, move |n| {
            n.fuer_verbindung(benutzer_id, &erlaubt, lagemonitor, leitung)
        });
    // Org-Ereignisse ohne `id:` und ohne Replay (LFH-734, design.md D4); gefiltert gegen den Benutzer,
    // nicht gegen die Modulrechte des Einsatzes. Ein Gerät kennt weder Einsatzliste noch
    // Stammdaten und bekommt sie nicht.
    let org_strom = match &ctx.geraet {
        None => futures::StreamExt::boxed(crate::routes::support::sse_org_stream(
            state.live.abonniere_org(),
            OrgAbonnent::aus(&ctx.benutzer),
        )),
        Some(_) => futures::StreamExt::boxed(futures::stream::empty()),
    };
    // Aufträge an die eigene Helfer-Kopplung (ADR-0105), am Ring vorbei und ohne `id:`; die App
    // lädt danach `GET /api/devices/me/tasks`.
    let helfer_strom = match &ctx.geraet {
        Some(g) if g.ansicht == crate::geraet::Funktionsansicht::Helfer => {
            futures::StreamExt::boxed(helfer_auftraege(&state, g.kopplung_id))
        }
        _ => futures::StreamExt::boxed(futures::stream::empty()),
    };
    // Das Lebenszeichen nach dem Filter: es erreicht jede Verbindung, auch ein Gerät (LLH-1935).
    let stream = strom::mit_heartbeat(
        einsatz_strom
            .merge(org_strom)
            .merge(praesenz_strom)
            .merge(helfer_strom),
        state.live.stroeme.heartbeat(),
    );

    // Sofort ein erstes Byte: ein Proxy, der die Header erst mit dem ersten Body-Byte weitergibt
    // (etwa der Vite-Dev-Proxy), hielte sie sonst bis zum ersten Keep-Alive zurück, und
    // `EventSource.onopen` feuerte erst dann. Ein Kommentar trägt kein `id:` und lässt die
    // `Last-Event-ID` unberührt.
    // Danach die gestreute Wartezeit für das Neuverbinden (LFH-920), als eigenes Ereignis: das
    // erste Frame bleibt reiner Kommentar.
    let verbunden = tokio_stream::once(Ok(Event::default().comment("verbunden")))
        .chain(tokio_stream::once(strom::retry_ereignis()));
    let kopplung = kopplung_ende(&state, ctx.geraet.as_ref());
    let sitzung = sitzung_ende(&state, sitzung);
    let ende = async move {
        tokio::select! {
            _ = kopplung => {}
            _ = sitzung => {}
        }
    };
    let feed = futures::StreamExt::take_until(verbunden.chain(stream), ende);

    Ok(Sse::new(strom::begrenzt(
        feed,
        platz,
        state.live.stroeme.lebensdauer(),
    ))
    .keep_alive(KeepAlive::default()))
}

/// SSE `helfer_auftrag` mit `{"task_id": n}` für jeden Auftrag an `kopplung_id`. Verpasste Meldungen
/// (`Lagged`) fallen weg: die App lädt nach jedem Neuverbinden ohnehin die Liste.
fn helfer_auftraege(
    state: &AppState,
    kopplung_id: i64,
) -> impl Stream<Item = Result<Event, Infallible>> + Send + 'static {
    let rx = state.live.abonniere_helfer_auftrag();
    tokio_stream::wrappers::BroadcastStream::new(rx).filter_map(move |n| match n {
        Ok((ids, auftrag_id)) if ids.contains(&kopplung_id) => Some(Ok(Event::default()
            .event(crate::live::LiveEvent::HelferAuftrag.as_str())
            .data(serde_json::json!({ "task_id": auftrag_id }).to_string()))),
        _ => None,
    })
}

/// Abstand, in dem ein Strom einer Gerätesitzung seine Kopplung neu prüft (Ablauf,
/// Einsatzabschluss). Widerruf und Gerätetausch wirken sofort über den Broadcast.
const KOPPLUNG_PRUEFTAKT: std::time::Duration = std::time::Duration::from_secs(15);

/// Endet, sobald die Sitzung des Stroms gelöscht ist (LFH-1092, design.md D6): sofort über
/// [`crate::live::LiveHub::melde_sitzung_ende`]; verpasst der Empfänger Meldungen (`Lagged`),
/// prüft er die Sitzung einmal in der Datenbank. Ohne Kennung (Bestand vor 0168 hat immer eine)
/// endet nichts hier.
fn sitzung_ende(
    state: &AppState,
    sitzung: Option<SitzungKennung>,
) -> std::pin::Pin<Box<dyn std::future::Future<Output = ()> + Send>> {
    let Some(SitzungKennung(kennung)) = sitzung else {
        return Box::pin(std::future::pending());
    };
    // Vor dem ersten `await` abonniert: ein Beenden zwischen Anmeldeprüfung und Abo fängt die
    // Prüfung nach `Lagged` nicht, wohl aber der Neuaufbau mit 401. Das Fenster ist der
    // Aufbau dieses Stroms.
    let mut rx = state.live.abonniere_sitzung_ende();
    let pool = state.pool.clone();
    Box::pin(async move {
        loop {
            match rx.recv().await {
                Ok(beendet) if beendet == kennung => return,
                Ok(_) => {}
                Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => {
                    let lebt: Result<Option<i64>, _> =
                        sqlx::query_scalar("SELECT 1 FROM session WHERE kennung = ?")
                            .bind(&kennung)
                            .fetch_optional(&pool)
                            .await;
                    if !matches!(lebt, Ok(Some(_))) {
                        return;
                    }
                }
                // Ohne Hub meldet niemand mehr ein Ende; der Strom endet dann mit seiner
                // Lebensdauer (`live::strom`), nicht hier. Ein vorzeitiges Ende schlösse jeden
                // Strom, dessen Router schon fallen gelassen ist (`oneshot` in den Tests).
                Err(tokio::sync::broadcast::error::RecvError::Closed) => {
                    std::future::pending::<()>().await
                }
            }
        }
    })
}

/// Endet, sobald die Kopplung einer Gerätesitzung beendet ist (LFH-892, design.md D7): sofort
/// bei Widerruf und Gerätetausch über [`crate::live::LiveHub::melde_kopplung_ende`], sonst
/// spätestens nach [`KOPPLUNG_PRUEFTAKT`]. Das Ende einer Personensitzung meldet
/// [`sitzung_ende`].
fn kopplung_ende(
    state: &AppState,
    geraet: Option<&crate::geraet::GeraetKontext>,
) -> std::pin::Pin<Box<dyn std::future::Future<Output = ()> + Send>> {
    let Some(geraet) = geraet else {
        return Box::pin(std::future::pending());
    };
    let kopplung_id = geraet.kopplung_id;
    // Vor dem ersten `await` abonniert: ein Widerruf zwischen Prüfung und Abo fängt der erste,
    // sofortige Takt.
    let mut rx = state.live.abonniere_kopplung_ende();
    let pool = state.pool.clone();
    Box::pin(async move {
        let gueltig = |pool: sqlx::SqlitePool| async move {
            matches!(
                crate::geraet::repo::kontext_wenn_gueltig(&pool, kopplung_id).await,
                Ok(Some(_))
            )
        };
        let mut takt = tokio::time::interval(KOPPLUNG_PRUEFTAKT);
        loop {
            tokio::select! {
                nachricht = rx.recv() => match nachricht {
                    Ok(id) if id == kopplung_id => return,
                    Ok(_) => {}
                    Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => {
                        if !gueltig(pool.clone()).await {
                            return;
                        }
                    }
                    Err(tokio::sync::broadcast::error::RecvError::Closed) => return,
                },
                _ = takt.tick() => {
                    if !gueltig(pool.clone()).await {
                        return;
                    }
                }
            }
        }
    })
}

/// GET /api/live — der Org-Strom (LFH-734) für Tabs außerhalb eines Einsatzes.
///
/// Tür: angemeldet und aktiv (`CurrentUser`), sonst 401. Trägt nur Org-Ereignisse und `lagged`,
/// keine Einsatz-Ereignisse. Empfänger-Schnappschuss beim Aufbau wie beim Einsatz-Feed; Platz
/// und Lebensdauer teilt er mit ihm (LFH-920).
pub async fn org_stream(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    AktuelleSitzung(sitzung): AktuelleSitzung,
) -> Result<Sse<impl Stream<Item = Result<Event, Infallible>>>, AppError> {
    let platz = state.live.stroeme.belegen(benutzer.id)?;
    let rx = state.live.abonniere_org();
    let stream = strom::mit_heartbeat(
        crate::routes::support::sse_org_stream(rx, OrgAbonnent::aus(&benutzer)),
        state.live.stroeme.heartbeat(),
    );
    let verbunden = tokio_stream::once(Ok(Event::default().comment("verbunden")))
        .chain(tokio_stream::once(strom::retry_ereignis()));
    let ende = sitzung_ende(&state, sitzung);
    Ok(Sse::new(strom::begrenzt(
        futures::StreamExt::take_until(verbunden.chain(stream), ende),
        platz,
        state.live.stroeme.lebensdauer(),
    ))
    .keep_alive(KeepAlive::default()))
}

/// Pfadpräfixe der Stammdaten-Kataloge (LFH-734). Eine schreibende Anfrage, deren Route unter
/// einem dieser Präfixe liegt, meldet nach Erfolg `stammdaten` an die Organisation des
/// Benutzers ([`stammdaten_live`]). Ein Präfix deckt den Pfad selbst und alles unter `…/`.
///
/// Gegen eine vergessene Route wacht `tests/stammdaten_live_guard.rs`: jede schreibende Route
/// eines Katalog-Moduls muss hier abgedeckt sein, und jeder Eintrag braucht eine schreibende
/// Route. Bewusst NICHT dabei: Org-Einstellungen und Org-Modul-Einstellungen (enger Lesekreis),
/// Benutzer, Karten (instanzweit) — Spec `org-live`, „Bewusst nicht live".
pub const STAMMDATEN_PFADE: &[&str] = &[
    "/api/vehicles",
    "/api/vehicle-statuses",
    "/api/personnel",
    "/api/personnel-statuses",
    "/api/material",
    "/api/qualifications",
    "/api/unit-types",
    "/api/unit-templates",
    "/api/incident-templates",
    "/api/catering-templates",
    "/api/shift-models",
    "/api/talk-groups",
    "/api/etb-snippets",
    "/api/keyword-suggestions",
    "/api/external-agencies",
    "/api/org-command-roles",
    "/api/org-accommodation-guidelines",
    "/api/organization",
];

/// Ob `pfad` (das `MatchedPath`-Muster) unter einem Stammdaten-Präfix liegt.
pub fn ist_stammdaten_pfad(pfad: &str) -> bool {
    STAMMDATEN_PFADE.iter().any(|p| {
        pfad.strip_prefix(p)
            .is_some_and(|rest| rest.is_empty() || rest.starts_with('/'))
    })
}

/// Middleware: meldet `stammdaten` nach jeder erfolgreichen (2xx) schreibenden Anfrage an eine
/// Katalog-Route (LFH-734, design.md D5). Der Handler hat beim Erfolg schon committet. Den
/// Benutzer löst die Middleware selbst auf; scheitert das, scheitert auch der Handler, und es
/// gibt nichts zu melden.
pub async fn stammdaten_live(
    State(state): State<AppState>,
    pfad: Option<axum::extract::MatchedPath>,
    req: axum::extract::Request,
    next: axum::middleware::Next,
) -> axum::response::Response {
    let betroffen = req.method() != axum::http::Method::GET
        && req.method() != axum::http::Method::HEAD
        && pfad.is_some_and(|p| ist_stammdaten_pfad(p.as_str()));
    if !betroffen {
        return next.run(req).await;
    }
    let (mut parts, body) = req.into_parts();
    let org_id = {
        use axum::extract::FromRequestParts;
        CurrentUser::from_request_parts(&mut parts, &state)
            .await
            .ok()
            .map(|CurrentUser(b)| b.org_id)
    };
    let antwort = next
        .run(axum::extract::Request::from_parts(parts, body))
        .await;
    if let (true, Some(org_id)) = (antwort.status().is_success(), org_id) {
        state.live.publiziere_stammdaten(org_id);
    }
    antwort
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stammdaten_praefix_ist_segmentgenau() {
        assert!(ist_stammdaten_pfad("/api/vehicles"));
        assert!(ist_stammdaten_pfad("/api/vehicles/{id}/out-of-service"));
        assert!(ist_stammdaten_pfad("/api/organization/logo"));
        assert!(!ist_stammdaten_pfad("/api/fahrzeuge-x"));
        assert!(!ist_stammdaten_pfad("/api/vehicle-suggestions"));
        assert!(!ist_stammdaten_pfad("/api/incidents/{id}/talk-groups"));
        assert!(!ist_stammdaten_pfad("/api/org-settings"));
    }
}
