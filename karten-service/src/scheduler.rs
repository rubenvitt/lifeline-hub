use std::sync::{Arc, Mutex};
use tokio_cron_scheduler::{Job, JobScheduler};

/// Startet einen Cron-Scheduler, der `enqueue_all` nach dem `cron`-Ausdruck (6 Felder inkl.
/// Sekunden) auslöst. Abweichung von der Skizze im Brief: die reale 0.15-API verlangt für
/// `Job::new_async` einen `FnMut(Uuid, JobsSchedulerLocked) -> Pin<Box<dyn Future<...> + Send>>
/// + Send + Sync + 'static` — `Sync` ist mit einem bloß `Send`-`FnMut` (wie hier via `impl FnMut()
/// + Send + 'static` gefordert) nicht automatisch erfüllt, weil eine Closure nur dann `Sync` ist,
/// wenn ihr gesamtes gefangenes Environment `Sync` ist. Deshalb `enqueue_all` in `Arc<Mutex<_>>`
/// kapseln (macht es unabhängig von `F: Sync` zu `Sync`, solange `F: Send`) und pro Tick sperren.
///
/// Gibt neben dem Scheduler die Job-ID zurück: `JobScheduler::next_tick_for_job` braucht sie für
/// `GET /zeitplan` (LFH-993). Der Cron läuft in UTC (`Job::new_async` = `new_async_tz(…, Utc, …)`).
pub async fn starte<F>(cron: &str, enqueue_all: F) -> anyhow::Result<(JobScheduler, uuid::Uuid)>
where
    F: FnMut() + Send + 'static,
{
    let enqueue_all = Arc::new(Mutex::new(enqueue_all));
    let sched = JobScheduler::new().await?;
    let job = Job::new_async(cron, move |_id, _lock| {
        let enqueue_all = enqueue_all.clone();
        Box::pin(async move {
            // Poisoning-Fix (Task-11-Finding): ein einmaliger Panic in `enqueue_all` soll den
            // Scheduler nicht dauerhaft lahmlegen — `.unwrap()` würde bei vergiftetem Mutex
            // selbst erneut panicken. `unwrap_or_else(|e| e.into_inner())` holt den Guard auch
            // nach einem Panic im Tick heraus; künftige Ticks bleiben funktionsfähig.
            (enqueue_all.lock().unwrap_or_else(|e| e.into_inner()))();
        })
    })?;
    let id = sched.add(job).await?;
    sched.start().await?;
    Ok((sched, id))
}

#[cfg(test)]
mod tests {
    /// LFH-993: Die Job-ID bleibt erhalten, damit `GET /zeitplan` den nächsten Lauf nennen kann.
    #[tokio::test]
    async fn naechster_tick_liegt_in_der_zukunft() {
        let (mut sched, id) = super::starte("0 0 3 1 1,4,7,10 *", || {}).await.unwrap();
        let naechster = sched.next_tick_for_job(id).await.unwrap();
        let naechster = naechster.expect("ein quartalsweiser Ausdruck hat einen nächsten Lauf");
        assert!(naechster > chrono::Utc::now());
        sched.shutdown().await.unwrap();
    }
}
