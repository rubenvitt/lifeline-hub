use serde::Serialize;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

#[derive(Clone, Serialize)]
#[serde(tag = "status", content = "fehler", rename_all = "lowercase")]
pub enum JobStatus {
    Queued,
    Building,
    Uploading,
    Publishing,
    Done,
    Failed(String),
}

#[derive(Clone, Serialize)]
pub struct BuildJob {
    pub id: u64,
    pub slug: String,
    pub status: JobStatus,
    pub gestartet: String,
    pub beendet: Option<String>,
}

#[derive(Debug)]
pub enum EnqueueError {
    Voll,
}

#[derive(Clone)]
pub struct Registry {
    inner: Arc<Mutex<Vec<BuildJob>>>,
    seq: Arc<AtomicU64>,
    building: Arc<AtomicBool>,
    offene_cap: usize,
}
pub struct BuildGuard(Arc<AtomicBool>);
impl Drop for BuildGuard {
    fn drop(&mut self) {
        self.0.store(false, Ordering::SeqCst);
    }
}

impl Registry {
    pub fn neu(offene_cap: usize) -> Self {
        Self {
            inner: Arc::new(Mutex::new(Vec::new())),
            seq: Arc::new(AtomicU64::new(1)),
            building: Arc::new(AtomicBool::new(false)),
            offene_cap,
        }
    }
    pub fn enqueue(&self, slug: &str) -> Result<u64, EnqueueError> {
        let mut v = self.inner.lock().unwrap();
        if v.iter()
            .filter(|j| matches!(j.status, JobStatus::Queued))
            .count()
            >= self.offene_cap
        {
            return Err(EnqueueError::Voll);
        }
        let id = self.seq.fetch_add(1, Ordering::SeqCst);
        v.push(BuildJob {
            id,
            slug: slug.into(),
            status: JobStatus::Queued,
            gestartet: now_iso(),
            beendet: None,
        });
        Ok(id)
    }
    pub fn get(&self, id: u64) -> Option<BuildJob> {
        self.inner
            .lock()
            .unwrap()
            .iter()
            .find(|j| j.id == id)
            .cloned()
    }
    pub fn alle(&self) -> Vec<BuildJob> {
        self.inner.lock().unwrap().clone()
    }
    pub fn set_status(&self, id: u64, s: JobStatus) {
        let mut v = self.inner.lock().unwrap();
        if let Some(j) = v.iter_mut().find(|j| j.id == id) {
            if matches!(s, JobStatus::Done | JobStatus::Failed(_)) {
                j.beendet = Some(now_iso());
            }
            j.status = s;
        }
    }
    /// Ältester Job im Status Queued (FIFO). Für den Worker-Drain.
    pub fn naechster_queued(&self) -> Option<(u64, String)> {
        self.inner
            .lock()
            .unwrap()
            .iter()
            .find(|j| matches!(j.status, JobStatus::Queued))
            .map(|j| (j.id, j.slug.clone()))
    }
    pub fn try_lock_build(&self) -> Option<BuildGuard> {
        if self
            .building
            .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
            .is_ok()
        {
            Some(BuildGuard(self.building.clone()))
        } else {
            None
        }
    }
}
fn now_iso() -> String {
    chrono::Utc::now().to_rfc3339()
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn nur_ein_build_guard_gleichzeitig() {
        let r = Registry::neu(4);
        let g1 = r.try_lock_build();
        assert!(g1.is_some());
        assert!(r.try_lock_build().is_none());
        drop(g1);
        assert!(r.try_lock_build().is_some());
    }
    #[test]
    fn naechster_queued_ist_fifo_und_ueberspringt_nicht_queued() {
        let r = Registry::neu(4);
        let a = r.enqueue("bayern").unwrap();
        let _b = r.enqueue("germany").unwrap();
        assert_eq!(r.naechster_queued().unwrap().0, a, "ältester queued zuerst");
        r.set_status(a, JobStatus::Building);
        assert_eq!(
            r.naechster_queued().unwrap().1,
            "germany",
            "Building wird übersprungen"
        );
    }
    #[test]
    fn queue_cap_greift() {
        let r = Registry::neu(1);
        r.enqueue("bayern").unwrap();
        assert!(matches!(r.enqueue("germany"), Err(EnqueueError::Voll)));
    }
}
