//! Abbild der Zuschaltungen im Arbeitsspeicher samt letztem Stand je Drohnenquelle. Die Datenbank
//! (`adapter_einsatz`) ist die Quelle der Wahrheit; der Store wird beim Start geladen und von den
//! Routen nachgeführt. Nichts hieraus wird gespeichert.

use std::collections::{HashMap, HashSet};
use std::sync::RwLock;

use futures::future::BoxFuture;
use sqlx::{SqliteConnection, SqlitePool};

use super::repo;
use super::suchlage::Upstream;
use super::vertrag::DrohnenLage;
use crate::adapter::art::Uebernahme;
use crate::adapter::repo::Adapter;
use crate::error::AppError;

/// Letzter Abruf einer Quelle.
#[derive(Debug, Clone)]
pub struct Stand {
    pub lage: DrohnenLage,
    pub map_etag: Option<String>,
    pub photos_latest_ms: Option<i64>,
    pub upstream: Upstream,
}

#[derive(Default)]
struct Innen {
    zugeschaltet: HashSet<String>,
    staende: HashMap<String, Stand>,
}

#[derive(Default)]
pub struct Store {
    innen: RwLock<Innen>,
}

impl Store {
    pub fn new() -> Self {
        Self::default()
    }

    /// Setzt den Merker für alle Adapter, die in einem laufenden Einsatz zugeschaltet sind. Ein
    /// Lesefehler lässt den Store leer und wird protokolliert: dann sind alle abgeschaltet.
    pub async fn load(&self, pool: &SqlitePool) {
        let ids = match pool.acquire().await {
            Ok(mut conn) => repo::load_active_adapter_ids(&mut conn).await.ok(),
            Err(_) => None,
        };
        let Some(ids) = ids else {
            tracing::error!("Zuschaltungen der Drohnenquellen nicht geladen");
            return;
        };
        let mut innen = self.innen.write().unwrap_or_else(|e| e.into_inner());
        innen.zugeschaltet = ids.into_iter().collect();
    }

    pub fn is_zugeschaltet(&self, adapter_id: &str) -> bool {
        self.lesen().zugeschaltet.contains(adapter_id)
    }

    /// Bei `false` wird auch der Stand geleert.
    pub fn set_zugeschaltet(&self, adapter_id: &str, an: bool) {
        let mut innen = self.innen.write().unwrap_or_else(|e| e.into_inner());
        if an {
            innen.zugeschaltet.insert(adapter_id.to_string());
        } else {
            innen.zugeschaltet.remove(adapter_id);
            innen.staende.remove(adapter_id);
        }
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

/// Was der Abruf einer Drohnenart in den Store schreibt. Maßgeblich ist die Datenbank: sie sagt,
/// ob ein laufender Einsatz die Quelle hält; sonst wird nichts abgelegt.
pub struct StandUebernahme {
    pub store: std::sync::Arc<Store>,
    pub stand: Stand,
    pub geaendert: bool,
    /// Was der Lauf als Anzahl zeigt (Fluggeräte, bei einer reinen Videoquelle die Videos).
    pub anzahl: i64,
}

impl Uebernahme for StandUebernahme {
    fn anzahl(&self) -> i64 {
        self.anzahl
    }

    fn uebernehmen<'a>(
        &'a self,
        conn: &'a mut SqliteConnection,
        adapter: &'a Adapter,
    ) -> BoxFuture<'a, Result<i64, AppError>> {
        Box::pin(async move {
            let aktiv = repo::is_active(conn, &adapter.id).await?;
            self.store.set_zugeschaltet(&adapter.id, aktiv);
            if !aktiv {
                return Ok(0);
            }
            self.store.put(&adapter.id, self.stand.clone());
            Ok(i64::from(self.geaendert))
        })
    }
}
