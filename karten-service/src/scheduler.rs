use std::sync::{Arc, Mutex};
use tokio_cron_scheduler::{Job, JobScheduler};

/// Startet einen Cron-Scheduler, der `enqueue_all` nach dem `cron`-Ausdruck (6 Felder inkl.
/// Sekunden) auslöst. Abweichung von der Skizze im Brief: die reale 0.13-API verlangt für
/// `Job::new_async` einen `FnMut(Uuid, JobsSchedulerLocked) -> Pin<Box<dyn Future<...> + Send>>
/// + Send + Sync + 'static` — `Sync` ist mit einem bloß `Send`-`FnMut` (wie hier via `impl FnMut()
/// + Send + 'static` gefordert) nicht automatisch erfüllt, weil eine Closure nur dann `Sync` ist,
/// wenn ihr gesamtes gefangenes Environment `Sync` ist. Deshalb `enqueue_all` in `Arc<Mutex<_>>`
/// kapseln (macht es unabhängig von `F: Sync` zu `Sync`, solange `F: Send`) und pro Tick sperren.
pub async fn starte<F>(cron: &str, enqueue_all: F) -> anyhow::Result<JobScheduler>
where
    F: FnMut() + Send + 'static,
{
    let enqueue_all = Arc::new(Mutex::new(enqueue_all));
    let sched = JobScheduler::new().await?;
    let job = Job::new_async(cron, move |_id, _lock| {
        let enqueue_all = enqueue_all.clone();
        Box::pin(async move {
            (enqueue_all.lock().unwrap())();
        })
    })?;
    sched.add(job).await?;
    sched.start().await?;
    Ok(sched)
}
