//! Fängt die Log-Ausgabe eines Tests ein (nur unter `cfg(test)`).
//!
//! Über EINEN globalen Subscriber, dessen Writer nur in den Puffer des eigenen Threads schreibt
//! (ein `#[tokio::test]` läuft auf genau einem). Ein thread-lokaler (`set_default`) fing unter
//! parallelen Tests mal alles, mal nichts: `tracing` speichert je Meldestelle zwischen, ob sie
//! jemand hören will, und das über alle Threads hinweg. Deshalb gibt es diesen Subscriber genau
//! einmal im Crate; ein zweiter `set_global_default` liefe still ins Leere.

use std::cell::RefCell;
use std::sync::{Arc, Mutex};

thread_local! {
    /// Ziel der Log-Ausgabe dieses Test-Threads, solange ein [`LogPuffer`] einfängt.
    static LOG_ZIEL: RefCell<Option<LogPuffer>> = const { RefCell::new(None) };
}

/// Puffer der eingefangenen Logzeilen eines Tests.
#[derive(Clone, Default)]
pub(crate) struct LogPuffer(Arc<Mutex<Vec<u8>>>);

/// Hebt das Einfangen beim Verlassen des Tests auf.
pub(crate) struct LogWaechter;

impl Drop for LogWaechter {
    fn drop(&mut self) {
        LOG_ZIEL.with(|z| z.borrow_mut().take());
    }
}

impl LogPuffer {
    pub(crate) fn einfangen() -> (Self, LogWaechter) {
        static GLOBAL: std::sync::Once = std::sync::Once::new();
        GLOBAL.call_once(|| {
            let _ = tracing::subscriber::set_global_default(
                tracing_subscriber::fmt()
                    .with_writer(|| ThreadLog)
                    .with_ansi(false)
                    .with_max_level(tracing::Level::INFO)
                    .finish(),
            );
        });
        // Eine Meldestelle, die ein anderer Thread gerade während des Setzens registriert
        // hat, kann sonst als „hört niemand“ stehen bleiben.
        tracing::callsite::rebuild_interest_cache();
        let puffer = Self::default();
        LOG_ZIEL.with(|z| *z.borrow_mut() = Some(puffer.clone()));
        (puffer, LogWaechter)
    }

    pub(crate) fn text(&self) -> String {
        String::from_utf8_lossy(&self.0.lock().unwrap()).into_owned()
    }
}

/// Writer des globalen Test-Subscribers: schreibt in den Puffer des Threads oder verwirft.
struct ThreadLog;

impl std::io::Write for ThreadLog {
    fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
        LOG_ZIEL.with(|z| {
            if let Some(puffer) = z.borrow().as_ref() {
                puffer.0.lock().unwrap().extend_from_slice(buf);
            }
        });
        Ok(buf.len())
    }
    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}
