//! Abbild der Zuschaltungen im Arbeitsspeicher samt letztem Stand je Drohnenquelle. Die Datenbank
//! (`adapter_einsatz`) ist die Quelle der Wahrheit; der Store wird beim Start geladen und von den
//! Routen nachgeführt. Nichts hieraus wird gespeichert.
//!
//! Abgleich (LLH-2123): Wer den Merker setzt, hat vorher die Datenbank gelesen. Zwischen Lesen und
//! Setzen kann ein anderer Abgleich schon den neueren Stand gesetzt haben. Deshalb zieht jeder
//! Abgleich **nach seinem eigenen Commit und vor dem Lesen** eine [`Marke`]; der Store übernimmt
//! einen Wert nur, wenn seine Marke neuer ist als die zuletzt übernommene des Adapters. Die zuletzt
//! gezogene Marke hat nach allen Commits gelesen, die vor ihr lagen, und setzt sich durch.

use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::RwLock;

use sqlx::{SqliteConnection, SqlitePool};

use crate::error::AppError;

use super::repo;
use super::suchlage::Upstream;
use super::vertrag::DrohnenLage;

/// Letzter Abruf einer Quelle.
#[derive(Debug, Clone)]
pub struct Stand {
    pub lage: DrohnenLage,
    pub map_etag: Option<String>,
    pub photos_latest_ms: Option<i64>,
    pub upstream: Upstream,
}

/// Reihenfolge eines Abgleichs: später gezogen heißt später gelesen.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub struct Marke(u64);

#[derive(Default)]
struct Innen {
    zugeschaltet: HashSet<String>,
    staende: HashMap<String, Stand>,
    /// Zuletzt übernommene Marke je Adapter; bleibt auch nach dem Löschen eines Adapters stehen,
    /// damit ein verspäteter Abgleich ihn nicht wieder anschaltet.
    marken: HashMap<String, Marke>,
}

#[derive(Default)]
pub struct Store {
    innen: RwLock<Innen>,
    naechste: AtomicU64,
}

impl Store {
    pub fn new() -> Self {
        Self::default()
    }

    /// Setzt den Merker für alle Adapter, die in einem laufenden Einsatz zugeschaltet sind. Ein
    /// Lesefehler lässt den Store leer und wird protokolliert: dann sind alle abgeschaltet.
    pub async fn load(&self, pool: &SqlitePool) {
        let marke = self.marke();
        let ids = match pool.acquire().await {
            Ok(mut conn) => repo::load_active_adapter_ids(&mut conn).await.ok(),
            Err(_) => None,
        };
        let Some(ids) = ids else {
            tracing::error!("Zuschaltungen der Drohnenquellen nicht geladen");
            return;
        };
        for id in ids {
            self.set_zugeschaltet(&id, true, marke);
        }
    }

    /// Zieht die Marke eines Abgleichs. Erst nach dem eigenen Commit ziehen, dann lesen.
    pub fn marke(&self) -> Marke {
        Marke(self.naechste.fetch_add(1, Ordering::SeqCst) + 1)
    }

    /// Führt den Merker eines Adapters aus der Datenbank nach (Marke, dann Lesen, dann Setzen).
    /// Nach jedem Commit aufrufen, der `adapter_einsatz` oder den Adapter ändert.
    pub async fn abgleichen(
        &self,
        conn: &mut SqliteConnection,
        adapter_id: &str,
    ) -> Result<(), AppError> {
        let marke = self.marke();
        let an = super::repo::is_active(conn, adapter_id).await?;
        self.set_zugeschaltet(adapter_id, an, marke);
        Ok(())
    }

    pub fn is_zugeschaltet(&self, adapter_id: &str) -> bool {
        self.lesen().zugeschaltet.contains(adapter_id)
    }

    /// Setzt den Merker, wenn `marke` neuer ist als die zuletzt übernommene des Adapters; sonst
    /// bleibt alles, wie es ist. Bei `false` wird auch der Stand geleert. `true`, wenn übernommen.
    pub fn set_zugeschaltet(&self, adapter_id: &str, an: bool, marke: Marke) -> bool {
        let mut innen = self.innen.write().unwrap_or_else(|e| e.into_inner());
        Self::setzen(&mut innen, adapter_id, an, marke)
    }

    /// Übernahme eines Abrufs: Merker wie [`Self::set_zugeschaltet`] und, wenn der Adapter danach
    /// zugeschaltet ist, den Stand, beides unter einer Sperre. Eine überholte Übernahme legt
    /// keinen Stand ab. `true`, wenn der Stand abgelegt wurde.
    pub fn uebernehmen(&self, adapter_id: &str, an: bool, marke: Marke, stand: Stand) -> bool {
        let mut innen = self.innen.write().unwrap_or_else(|e| e.into_inner());
        if !Self::setzen(&mut innen, adapter_id, an, marke)
            || !innen.zugeschaltet.contains(adapter_id)
        {
            return false;
        }
        innen.staende.insert(adapter_id.to_string(), stand);
        true
    }

    fn setzen(innen: &mut Innen, adapter_id: &str, an: bool, marke: Marke) -> bool {
        if innen.marken.get(adapter_id).is_some_and(|m| *m >= marke) {
            return false;
        }
        innen.marken.insert(adapter_id.to_string(), marke);
        if an {
            innen.zugeschaltet.insert(adapter_id.to_string());
        } else {
            innen.zugeschaltet.remove(adapter_id);
            innen.staende.remove(adapter_id);
        }
        true
    }

    pub fn put(&self, adapter_id: &str, stand: Stand) {
        let mut innen = self.innen.write().unwrap_or_else(|e| e.into_inner());
        innen.staende.insert(adapter_id.to_string(), stand);
    }

    pub fn get(&self, adapter_id: &str) -> Option<Stand> {
        self.lesen().staende.get(adapter_id).cloned()
    }

    /// Adapter und Seriennummer des Gateways zu einer Videokennung.
    pub fn find_video(&self, key: &str) -> Option<(String, String)> {
        let innen = self.lesen();
        innen.staende.iter().find_map(|(id, s)| {
            s.upstream
                .videos
                .get(key)
                .map(|sn| (id.clone(), sn.clone()))
        })
    }

    /// Adapter und Vorschau-Pfad zu einer Fotokennung.
    pub fn find_photo(&self, key: &str) -> Option<(String, String)> {
        let innen = self.lesen();
        innen.staende.iter().find_map(|(id, s)| {
            s.upstream
                .fotos
                .get(key)
                .map(|url| (id.clone(), url.clone()))
        })
    }

    fn lesen(&self) -> std::sync::RwLockReadGuard<'_, Innen> {
        self.innen.read().unwrap_or_else(|e| e.into_inner())
    }
}
