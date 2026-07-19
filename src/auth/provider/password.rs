//! Passwort-Provider — extrahierte Login-Logik (verhaltensneutral aus routes/auth.rs).
//!
//! ## Drosselung der Schlüsselableitung (LFH-270/G07)
//!
//! Argon2id ist bewusst teuer (OWASP-Defaults: ~19 MiB Speicher, t=2 je Lauf). Der Login ist
//! damit der teuerste unauthentifizierte Endpoint des Systems — und war ungedrosselt. Zwei
//! Eigenschaften machten das gefährlich:
//!
//! 1. Der KDF lief **synchron im async-Handler**: jeder Lauf belegte einen Tokio-Worker
//!    vollständig. Bereits ~Kernzahl gleichzeitige Logins ließen alles andere verhungern —
//!    auch Lesezugriffe, SSE und `/api/health`.
//! 2. Der `None`-Arm brennt einen **vollen Wegwerf-Hash** als Timing-Angleich. Ein Angreifer
//!    braucht also **keinen gültigen Benutzernamen**; jeder Fantasie-Login kostet vollen KDF.
//!
//! Beides wird hier adressiert: die KDF-Arbeit wandert per `spawn_blocking` vom Worker-Pool
//! weg, und ein Semaphore deckelt die gleichzeitigen Läufe. **Das Semaphore ist der wirksame
//! Teil** — `spawn_blocking` allein würde den DoS nur von CPU auf Speicher verschieben, weil
//! der Blocking-Pool bis auf 512 Threads wächst (× ~19 MiB je laufendem Hash).
//!
//! Das Gate umschließt bewusst **beide** Arme des Matches, den Wegwerf-Hash eingeschlossen —
//! andernfalls bliebe genau der Vektor aus Punkt 2 offen.
use crate::auth::{password, Benutzer};
use crate::error::AppError;
use sqlx::SqlitePool;
use std::sync::{Arc, LazyLock};
use tokio::sync::Semaphore;

/// Gleichzeitig zugelassene KDF-Läufe.
///
/// Die Hälfte der verfügbaren Parallelität, mindestens 2: der Speicherbedarf ist der harte
/// Deckel (Plätze × ~19 MiB), und der Login soll auch unter Last nie die gesamte Maschine
/// für sich beanspruchen.
fn kdf_plaetze() -> usize {
    std::thread::available_parallelism()
        .map(|n| (n.get() / 2).max(2))
        .unwrap_or(2)
}

/// Wie lange ein Anmeldeversuch auf einen freien KDF-Platz wartet, bevor er abgewiesen wird.
///
/// Ein sofortiges Abweisen (`try_acquire`) wäre der reinere Lastabwurf — es trifft aber schon
/// bei einer gewöhnlichen Anmeldewelle zu: mehr gleichzeitige Anmeldungen als Plätze sind im
/// Schichtwechsel einer Lage der Normalfall, nicht der Angriff. Die Testsuite hat das
/// aufgedeckt (parallele Logins im selben Prozess liefen in 503).
///
/// Deshalb eine kurze, gedeckelte Wartezeit: ein Burst wird in Wellen abgearbeitet
/// (ein KDF-Lauf dauert ~50-100 ms), eine echte Flut reißt die Frist sofort und bekommt 503.
/// Unbegrenztes Queueing entsteht dabei nicht — wie viele Anmeldungen überhaupt gleichzeitig
/// warten können, deckelt bereits die Zulassungssteuerung ([`crate::zulassung`]).
const WARTEFRIST: std::time::Duration = std::time::Duration::from_secs(3);

/// Prozessweites Gate — bewusst ein `static` und kein `AppState`-Feld: die Grenze ist eine
/// Eigenschaft der Maschine, nicht des Anwendungszustands, und ein zusätzliches Pflichtfeld
/// in `AppState` würde jede Test-Konstruktion brechen.
static KDF_GATE: LazyLock<Arc<Semaphore>> =
    LazyLock::new(|| Arc::new(Semaphore::new(kdf_plaetze())));

/// Prüft Anmeldedaten und liefert den aktiven Benutzer. `AppError::Unauthorized`
/// bei unbekanntem Benutzer ODER falschem Passwort. Gleicht die Antwortzeit an
/// (Wegwerf-Hash), damit sich existierende Benutzer nicht per Timing enumerieren lassen.
///
/// Bei dauerhaft ausgeschöpftem KDF-Gate: `AppError::ServiceUnavailable` (503), nachdem
/// [`WARTEFRIST`] erfolglos verstrichen ist.
pub async fn anmelden(
    pool: &SqlitePool,
    benutzername: &str,
    passwort: &str,
) -> Result<Benutzer, AppError> {
    anmelden_mit_gate(pool, benutzername, passwort, &KDF_GATE, WARTEFRIST).await
}

/// Kern von [`anmelden`] mit injizierbarem Gate und injizierbarer Wartefrist — nur damit
/// Tests die Erschöpfung deterministisch und ohne mehrsekündige Laufzeit herstellen können.
pub(crate) async fn anmelden_mit_gate(
    pool: &SqlitePool,
    benutzername: &str,
    passwort: &str,
    gate: &Arc<Semaphore>,
    wartefrist: std::time::Duration,
) -> Result<Benutzer, AppError> {
    let benutzer = sqlx::query_as::<_, Benutzer>(
        "SELECT id, org_id, anzeigename, benutzername, passwort_hash, system_rolle, org_rolle, aktiv, erstellt_at \
         FROM benutzer WHERE benutzername = ? AND aktiv = 1",
    )
    .bind(benutzername)
    .fetch_optional(pool)
    .await?;

    // Gedeckelte Wartezeit statt sofortigem Abweisen — Begründung s. [`WARTEFRIST`].
    // Der Platz wird beim Verlassen dieser Funktion frei, auch im Fehlerfall.
    let platz = tokio::time::timeout(wartefrist, gate.clone().acquire_owned()).await;
    let Ok(Ok(_platz)) = platz else {
        tracing::warn!(
            "KDF-Gate seit {wartefrist:?} ausgeschöpft, Anmeldeversuch abgewiesen (503)"
        );
        return Err(AppError::ServiceUnavailable(
            "Anmeldung vorübergehend ausgelastet — bitte erneut versuchen.".to_string(),
        ));
    };

    // Argon2id ist rechen- und speicherintensiv und blockiert den aufrufenden Thread für die
    // volle Dauer. Auf dem async-Executor ausgeführt hieße das: ein Worker steht still. Der
    // gesamte Match — Verifikation UND Wegwerf-Hash — wandert deshalb auf den Blocking-Pool.
    let passwort = passwort.to_string();
    tokio::task::spawn_blocking(move || match benutzer {
        Some(b) if password::verifizieren(&passwort, &b.passwort_hash) => Ok(b),
        Some(_) => Err(AppError::Unauthorized),
        None => {
            let _ = password::hash(&passwort);
            Err(AppError::Unauthorized)
        }
    })
    .await
    .map_err(|e| AppError::Internal(format!("KDF-Task abgebrochen: {e}")))?
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Kurz genug, dass die Erschöpfungs-Tests in Millisekunden laufen statt in Sekunden.
    const TEST_FRIST: std::time::Duration = std::time::Duration::from_millis(80);

    async fn benutzer_mit_pw(pool: &SqlitePool, pw: &str) {
        sqlx::query("INSERT INTO organisation (id, name) VALUES (1, 'Orga')")
            .execute(pool)
            .await
            .unwrap();
        let hash = password::hash(pw).unwrap();
        sqlx::query(
            "INSERT INTO benutzer (org_id, anzeigename, benutzername, passwort_hash, aktiv) \
             VALUES (1, 'Max', 'max', ?, 1)",
        )
        .bind(hash)
        .execute(pool)
        .await
        .unwrap();
    }

    #[tokio::test]
    async fn korrektes_passwort_meldet_an() {
        let pool = crate::db::test_pool().await;
        benutzer_mit_pw(&pool, "geheim123").await;
        let b = anmelden(&pool, "max", "geheim123").await.unwrap();
        assert_eq!(b.benutzername, "max");
    }

    #[tokio::test]
    async fn falsches_passwort_ist_unauthorized() {
        let pool = crate::db::test_pool().await;
        benutzer_mit_pw(&pool, "geheim123").await;
        let err = anmelden(&pool, "max", "falsch").await.unwrap_err();
        assert!(matches!(err, AppError::Unauthorized));
    }

    #[tokio::test]
    async fn unbekannter_benutzer_ist_unauthorized() {
        let pool = crate::db::test_pool().await;
        benutzer_mit_pw(&pool, "geheim123").await;
        let err = anmelden(&pool, "niemand", "geheim123").await.unwrap_err();
        assert!(matches!(err, AppError::Unauthorized));
    }

    /// LFH-270/G07: bleibt das Gate über die Wartefrist hinaus voll, wird abgewiesen —
    /// statt unbegrenzt zu warten oder einen weiteren Argon2-Lauf zu starten.
    #[tokio::test]
    async fn erschoepftes_gate_weist_ab_statt_zu_hashen() {
        let pool = crate::db::test_pool().await;
        benutzer_mit_pw(&pool, "geheim123").await;
        let gate = Arc::new(Semaphore::new(0));

        let err = anmelden_mit_gate(&pool, "max", "geheim123", &gate, TEST_FRIST)
            .await
            .unwrap_err();

        assert!(
            matches!(err, AppError::ServiceUnavailable(_)),
            "erwartet 503 bei erschöpftem KDF-Gate, war: {err:?}"
        );
    }

    /// Der eigentliche DoS-Vektor: der Wegwerf-Hash im `None`-Arm kostet einen vollen
    /// Argon2-Lauf OHNE gültigen Benutzernamen. Läge das Gate nur um den Verifikations-Zweig,
    /// bliebe er ungedrosselt — dieser Test hält genau das fest.
    #[tokio::test]
    async fn auch_der_unbekannte_benutzer_laeuft_durch_das_gate() {
        let pool = crate::db::test_pool().await;
        benutzer_mit_pw(&pool, "geheim123").await;
        let gate = Arc::new(Semaphore::new(0));

        let err = anmelden_mit_gate(&pool, "gibtesnicht", "egal", &gate, TEST_FRIST)
            .await
            .unwrap_err();

        assert!(
            matches!(err, AppError::ServiceUnavailable(_)),
            "der Wegwerf-Hash-Pfad muss ebenfalls gedrosselt sein, war: {err:?}"
        );
    }

    /// Die Anmeldewelle: mehr gleichzeitige Logins als Plätze ist im Schichtwechsel einer Lage
    /// der Normalfall. Sie müssen in Wellen abgearbeitet werden, nicht abgewiesen — genau
    /// dieses Verhalten hatte ein sofort abweisendes `try_acquire` gebrochen (aufgedeckt von
    /// der Testsuite, die parallele Logins fährt).
    #[tokio::test]
    async fn anmeldewelle_wird_bedient_statt_abgewiesen() {
        let pool = crate::db::test_pool().await;
        benutzer_mit_pw(&pool, "geheim123").await;
        // EIN Platz, vier gleichzeitige Anmeldungen — ohne Warten wären drei davon 503.
        let gate = Arc::new(Semaphore::new(1));

        let mut laeufe = Vec::new();
        for _ in 0..4 {
            let pool = pool.clone();
            let gate = gate.clone();
            laeufe.push(tokio::spawn(async move {
                anmelden_mit_gate(&pool, "max", "geheim123", &gate, WARTEFRIST)
                    .await
                    .map(|b| b.benutzername)
            }));
        }

        for lauf in laeufe {
            let name = lauf
                .await
                .expect("Task")
                .expect("jede Anmeldung der Welle muss bedient werden, nicht abgewiesen");
            assert_eq!(name, "max");
        }
    }

    /// Der Platz muss nach jedem Versuch zurückfallen — sonst sperrt sich der Login nach
    /// wenigen Anmeldungen dauerhaft selbst aus.
    #[tokio::test]
    async fn platz_faellt_nach_jedem_versuch_zurueck() {
        let pool = crate::db::test_pool().await;
        benutzer_mit_pw(&pool, "geheim123").await;
        let gate = Arc::new(Semaphore::new(1));

        for durchgang in 1..=3 {
            let b = anmelden_mit_gate(&pool, "max", "geheim123", &gate, TEST_FRIST)
                .await
                .unwrap_or_else(|e| panic!("Durchgang {durchgang} scheiterte: {e:?}"));
            assert_eq!(b.benutzername, "max");
        }

        // Auch der Fehlschlag-Pfad darf den Platz nicht einbehalten.
        let _ = anmelden_mit_gate(&pool, "max", "falsch", &gate, TEST_FRIST).await;
        assert!(
            anmelden_mit_gate(&pool, "max", "geheim123", &gate, TEST_FRIST)
                .await
                .is_ok(),
            "nach einem Fehlversuch muss der Platz wieder frei sein"
        );
    }
}
