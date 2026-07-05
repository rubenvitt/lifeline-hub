use crate::build::{fahre_build, BuildRunner};
use crate::jobs::{JobStatus, Registry};
use crate::manifest::PublishedVersion;
use crate::{regions, storage::Storage};
use std::sync::{Arc, Mutex};
use std::time::Duration;

#[derive(Clone)]
pub struct WorkerState {
    pub registry: Registry,
    pub runner: Arc<dyn BuildRunner>,
    pub storage: Arc<dyn Storage>,
    pub bestand: Arc<Mutex<Vec<PublishedVersion>>>,
}

/// Nimmt — wenn der Build-Slot frei ist — genau den ältesten queued Job und fährt ihn zu Ende.
/// `true`, wenn gearbeitet wurde.
pub async fn tick(st: &WorkerState) -> bool {
    let Some(_guard) = st.registry.try_lock_build() else { return false };
    let Some((id, slug)) = st.registry.naechster_queued() else { return false };
    match regions::finde(&slug) {
        Some(reg) => fahre_build(reg, id, &st.registry, st.runner.clone(), st.storage.clone(), st.bestand.clone()).await,
        None => st.registry.set_status(id, JobStatus::Failed(format!("unbekannter slug {slug}"))),
    }
    true
}

/// Endlos-Loop: solange Jobs queued sind, sofort weiterarbeiten; sonst kurz pollen.
pub async fn run(st: WorkerState) {
    loop {
        if !tick(&st).await {
            tokio::time::sleep(Duration::from_millis(500)).await;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{jobs::Registry, storage::FakeStorage, manifest::PublishedVersion, build::{BuildArtefakt, BuildRunner}, regions};
    use std::sync::{Arc, Mutex};
    use std::io::Write;
    struct OkRunner(std::path::PathBuf);
    #[async_trait::async_trait]
    impl BuildRunner for OkRunner {
        async fn baue(&self, _a:&str)->anyhow::Result<BuildArtefakt> {
            Ok(BuildArtefakt { datei:self.0.clone(), sha256:"c".repeat(64), bounds:Some((8.9,47.2,13.9,50.6)) })
        }
    }
    #[tokio::test]
    async fn tick_faehrt_queued_job() {
        let mut f = tempfile::NamedTempFile::new().unwrap(); f.write_all(&[7;5]).unwrap();
        let reg = Registry::neu(4);
        let st = WorkerState { registry: reg.clone(), runner: Arc::new(OkRunner(f.path().into())),
            storage: Arc::new(FakeStorage::neu("https://cdn.example/maps")),
            bestand: Arc::new(Mutex::new(Vec::<PublishedVersion>::new())) };
        let id = reg.enqueue("bayern").unwrap();
        assert!(tick(&st).await, "hat gearbeitet");
        assert!(matches!(reg.get(id).unwrap().status, crate::jobs::JobStatus::Done));
        assert!(!tick(&st).await, "nichts mehr queued");
        let _ = regions::finde("bayern");
    }
}
