//! Wächter für unverteilte ETB-Einträge (LLH-1976, `src/AGENTS.md`, „Backend — ETB live
//! verteilen“). Ein ETB-Eintrag, den eine Route oder ein Hintergrundlauf schreibt, geht nach dem
//! Commit per [`crate::live::LiveHub::publiziere`] hinaus; sonst sieht ein zweiter Schirm ihn erst
//! nach dem Neuladen.
//!
//! Nur in Debug- und Test-Builds wirksam: Ein `task_local` sammelt die IDs, die
//! `repo::einfuegen` schreibt ([`geschrieben`]) und die `LiveHub::publiziere` verteilt
//! ([`verteilt`]). [`klammer`] liest danach, welche geschriebenen und weder verteilten noch
//! ausgenommenen IDs tatsächlich in `etb_eintrag` stehen; ein zurückgerollter Versuch aus
//! `write_retry!` fällt damit heraus. Im Release-Build reicht jede Funktion nur durch.
//!
//! Grenze: Was in einem per `tokio::spawn` gestarteten Task geschieht, sieht der Sammler nicht,
//! weder das Schreiben noch das Verteilen. Das bleibt still und meldet nichts Falsches.

use sqlx::SqlitePool;
use std::future::Future;

/// Ausnahmegrund: Demo-Import (`routes/demo_daten.rs`).
pub const GRUND_DEMO: &str = "Demo-Import: Hunderte Einträge auf einmal";
/// Ausnahmegrund: Abgleich mit einer gekoppelten Instanz (`routes/instanz.rs`).
pub const GRUND_SPIEGEL: &str = "Instanz-Spiegel: Einträge kommen aus der Partnerinstanz";
/// Ausnahmegrund: Archivieren, Soft-Delete und Schwärzen des ganzen Einsatzes im Löschlauf
/// (Entscheidung 19.11.2026): offene Schirme erfahren es über `kopf_melden`, ein `etb` liefe in
/// einen Refetch mit 403/404.
pub const GRUND_BETRIEB_VERLASSEN: &str = "Einsatz verlässt den Betrieb; kopf_melden meldet es";

/// Ein committeter ETB-Eintrag, der in einer [`klammer`] geschrieben, aber nicht verteilt wurde.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Luecke {
    pub einsatz_id: i64,
    pub etb_id: i64,
    pub inhalt: String,
}

#[cfg(debug_assertions)]
mod aktiv {
    use std::cell::RefCell;
    use std::collections::HashSet;

    #[derive(Default)]
    pub(super) struct Sammler {
        pub geschrieben: Vec<i64>,
        pub verteilt: HashSet<i64>,
        pub ausgenommen: HashSet<i64>,
        pub ausnahme_tiefe: u32,
    }

    tokio::task_local! {
        pub(super) static SAMMLER: RefCell<Sammler>;
    }
}

/// Führt `fut` unter einem Sammler aus und liefert danach die Lücken. Läuft schon ein Sammler
/// (etwa bei einer Anfrage, die der Spiegel per `oneshot` erneut durch den Router schickt),
/// öffnet sie keinen neuen: die äußere Klammer prüft, die innere liefert keine Lücken.
pub async fn klammer<F: Future>(pool: &SqlitePool, fut: F) -> (F::Output, Vec<Luecke>) {
    #[cfg(debug_assertions)]
    {
        use std::cell::RefCell;
        if aktiv::SAMMLER.try_with(|_| ()).is_ok() {
            return (fut.await, Vec::new());
        }
        let (ausgabe, sammler) = aktiv::SAMMLER
            .scope(RefCell::new(aktiv::Sammler::default()), async {
                let ausgabe = fut.await;
                (ausgabe, aktiv::SAMMLER.with(|s| s.take()))
            })
            .await;
        let mut offen: Vec<i64> = sammler
            .geschrieben
            .into_iter()
            .filter(|id| !sammler.verteilt.contains(id) && !sammler.ausgenommen.contains(id))
            .collect();
        offen.sort_unstable();
        offen.dedup();
        (ausgabe, luecken_lesen(pool, &offen).await)
    }
    #[cfg(not(debug_assertions))]
    {
        let _ = pool;
        (fut.await, Vec::new())
    }
}

#[cfg(debug_assertions)]
async fn luecken_lesen(pool: &SqlitePool, offen: &[i64]) -> Vec<Luecke> {
    if offen.is_empty() {
        return Vec::new();
    }
    let mut q =
        sqlx::QueryBuilder::new("SELECT id, einsatz_id, inhalt FROM etb_eintrag WHERE id IN (");
    let mut liste = q.separated(", ");
    for id in offen {
        liste.push_bind(id);
    }
    q.push(") ORDER BY id");
    let zeilen: Vec<(i64, i64, String)> = q
        .build_query_as()
        .fetch_all(pool)
        .await
        .expect("ETB-Wächter: Lesen der offenen Einträge");
    zeilen
        .into_iter()
        .map(|(etb_id, einsatz_id, inhalt)| Luecke {
            einsatz_id,
            etb_id,
            inhalt,
        })
        .collect()
}

/// Nimmt alle in `fut` geschriebenen Einträge vom Wächter aus. `grund` steht im Code, damit jede
/// Ausnahme eine sichtbare Entscheidung ist (`src/AGENTS.md`, „Backend — ETB live verteilen“).
pub async fn ohne_verteilung<F: Future>(grund: &'static str, fut: F) -> F::Output {
    let _ = grund;
    #[cfg(debug_assertions)]
    {
        let aktiv = aktiv::SAMMLER
            .try_with(|s| s.borrow_mut().ausnahme_tiefe += 1)
            .is_ok();
        let ausgabe = fut.await;
        if aktiv {
            aktiv::SAMMLER.with(|s| s.borrow_mut().ausnahme_tiefe -= 1);
        }
        ausgabe
    }
    #[cfg(not(debug_assertions))]
    {
        fut.await
    }
}

/// Nimmt einen schon geschriebenen Eintrag vom Wächter aus, wenn erst das Ergebnis eines Laufs
/// zeigt, dass er nicht verteilt wird (Vollzug eines Einsatz-Löschersuchens). Wie
/// [`ohne_verteilung`] steht der Grund im Code.
pub fn ausnehmen(grund: &'static str, etb_id: i64) {
    let _ = grund;
    #[cfg(debug_assertions)]
    let _ = aktiv::SAMMLER.try_with(|s| {
        s.borrow_mut().ausgenommen.insert(etb_id);
    });
    #[cfg(not(debug_assertions))]
    let _ = etb_id;
}

/// Merkt einen frisch eingefügten ETB-Eintrag vor (aus `repo::einfuegen`).
pub(crate) fn geschrieben(etb_id: i64) {
    #[cfg(debug_assertions)]
    let _ = aktiv::SAMMLER.try_with(|s| {
        let mut s = s.borrow_mut();
        if s.ausnahme_tiefe > 0 {
            s.ausgenommen.insert(etb_id);
        } else {
            s.geschrieben.push(etb_id);
        }
    });
    #[cfg(not(debug_assertions))]
    let _ = etb_id;
}

/// Merkt einen verteilten ETB-Eintrag vor (aus `LiveHub::publiziere`).
pub(crate) fn verteilt(etb_id: i64) {
    #[cfg(debug_assertions)]
    let _ = aktiv::SAMMLER.try_with(|s| {
        s.borrow_mut().verteilt.insert(etb_id);
    });
    #[cfg(not(debug_assertions))]
    let _ = etb_id;
}

/// Router-Schicht (`app::build_router_mit`, außerhalb von `CatchPanicLayer`): eine Lücke ist
/// ein Panic, der den Test rot macht. Im Release-Build nur ein Durchreichen.
pub async fn waechter(
    axum::extract::State(state): axum::extract::State<crate::app::AppState>,
    req: axum::extract::Request,
    next: axum::middleware::Next,
) -> axum::response::Response {
    let (antwort, luecken) = klammer(&state.pool, next.run(req)).await;
    if !luecken.is_empty() {
        panic!("{}", melde(&luecken));
    }
    antwort
}

/// Text für Panic oder Log: je Lücke Einsatz, Eintrag und Inhalt.
pub fn melde(luecken: &[Luecke]) -> String {
    let mut text = String::from(
        "ETB-Eintrag nicht live verteilt (src/AGENTS.md, „Backend — ETB live verteilen“, LLH-1976):",
    );
    for l in luecken {
        text.push_str(&format!(
            "\n  Einsatz {} · ETB {} · „{}“",
            l.einsatz_id, l.etb_id, l.inhalt
        ));
    }
    text
}
