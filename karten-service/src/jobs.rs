use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

// LFH-323: Wire-Typen leben jetzt im geteilten Crate `karten-katalog` (Cross-Service-Vertrag durch
// den Typ-Codegen). Re-Export, damit `crate::jobs::{BuildJob, JobStatus}` als Pfad erhalten bleibt.
pub use karten_katalog::{BuildJob, JobStatus};

#[derive(Debug)]
pub enum EnqueueError {
    Voll,
}

/// So viele abgeschlossene Aufträge behält der Verlauf (LFH-929). Ohne Grenze wächst er über
/// Monate `serve` und geht bei jedem 2-s-Poll der Admin-Ansicht komplett über die Leitung.
pub const VERLAUF_MAX: usize = 100;

#[derive(Clone)]
pub struct Registry {
    inner: Arc<Mutex<Vec<BuildJob>>>,
    seq: Arc<AtomicU64>,
    building: Arc<AtomicBool>,
    offene_cap: usize,
    verlauf_max: usize,
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
            verlauf_max: VERLAUF_MAX,
        }
    }
    /// Andere Verlaufsgrenze, für Tests.
    pub fn mit_verlauf_max(mut self, n: usize) -> Self {
        self.verlauf_max = n;
        self
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
        let Some(j) = v.iter_mut().find(|j| j.id == id) else {
            return;
        };
        let abgeschlossen = abgeschlossen(&s);
        if abgeschlossen {
            j.beendet = Some(now_iso());
        }
        j.status = s;
        if abgeschlossen {
            kappe_verlauf(&mut v, self.verlauf_max);
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
fn abgeschlossen(s: &JobStatus) -> bool {
    matches!(s, JobStatus::Done | JobStatus::Failed(_))
}

/// Kappt die abgeschlossenen Aufträge auf `max`. Offene (`Queued`, laufend) bleiben immer. Von den
/// abgeschlossenen bleibt zuerst der neueste je Slug — `neuesterJob` und die Verkettung „bauen →
/// fertig → laden“ im `OfflineRegionPicker` lesen ihn —, der Rest füllt nach Alter (höchste id
/// zuerst) bis `max` auf.
fn kappe_verlauf(v: &mut Vec<BuildJob>, max: usize) {
    if v.iter().filter(|j| abgeschlossen(&j.status)).count() <= max {
        return;
    }
    let mut fertig: Vec<&BuildJob> = v.iter().filter(|j| abgeschlossen(&j.status)).collect();
    fertig.sort_by_key(|j| std::cmp::Reverse(j.id));
    let mut behalten = std::collections::HashSet::new();
    let mut slugs = std::collections::HashSet::new();
    for j in &fertig {
        if slugs.insert(j.slug.as_str()) {
            behalten.insert(j.id);
        }
    }
    for j in &fertig {
        if behalten.len() >= max {
            break;
        }
        behalten.insert(j.id);
    }
    v.retain(|j| !abgeschlossen(&j.status) || behalten.contains(&j.id));
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
    fn verlauf_bleibt_begrenzt_und_behaelt_neuesten_je_slug() {
        let r = Registry::neu(100).mit_verlauf_max(3);
        // Ältester Auftrag einer Region, die danach nie wieder gebaut wird.
        let bremen = r.enqueue("bremen").unwrap();
        r.set_status(bremen, JobStatus::Failed("alt".into()));
        let offen = r.enqueue("saarland").unwrap();
        let mut letzter_bayern = 0;
        for i in 0..10 {
            let id = r.enqueue("bayern").unwrap();
            let s = if i % 2 == 0 {
                JobStatus::Done
            } else {
                JobStatus::Failed("x".into())
            };
            r.set_status(id, s);
            letzter_bayern = id;
        }
        let alle = r.alle();
        let fertig = alle.iter().filter(|j| abgeschlossen(&j.status)).count();
        let offene = alle.len() - fertig;
        assert!(
            alle.len() <= 3 + offene,
            "höchstens N abgeschlossene + offene"
        );
        assert!(r.get(offen).is_some(), "Queued wird nie verworfen");
        assert!(
            r.get(bremen).is_some(),
            "neuester je Slug bleibt, auch wenn alt"
        );
        assert!(r.get(letzter_bayern).is_some());
        assert_eq!(r.naechster_queued().unwrap().0, offen);
    }
    #[test]
    fn laufender_auftrag_wird_nie_gekappt() {
        let r = Registry::neu(100).mit_verlauf_max(1);
        let laeuft = r.enqueue("germany").unwrap();
        r.set_status(laeuft, JobStatus::Building);
        for _ in 0..5 {
            let id = r.enqueue("bayern").unwrap();
            r.set_status(id, JobStatus::Done);
        }
        assert!(matches!(r.get(laeuft).unwrap().status, JobStatus::Building));
        assert_eq!(r.alle().len(), 2);
    }
    #[test]
    fn queue_cap_greift() {
        let r = Registry::neu(1);
        r.enqueue("bayern").unwrap();
        assert!(matches!(r.enqueue("germany"), Err(EnqueueError::Voll)));
    }
}
