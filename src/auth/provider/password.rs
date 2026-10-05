//! Passwort-Provider: Login-Logik mit gedrosselter Schlüsselableitung (LFH-270, LFH-310). Dieselben
//! Schranken gelten für das Hashen neuer Passwörter in Anlage und Wechsel ([`hash_gedrosselt`],
//! LFH-921).
//!
//! Argon2id kostet je Lauf ~19 MiB und ~50–100 ms; der Login ist damit der teuerste
//! unauthentifizierte Endpoint. Deshalb:
//!
//! - **Jeder Arm kostet genau einen Argon2-Lauf** — Treffer, unbekannter Name (Wegwerf-Hash)
//!   und SSO-only-Sentinel (Wegwerf-Lauf in [`password::verifizieren`]). Sonst verrät die
//!   Antwortzeit, ob und welche Art Konto existiert. Ein Angreifer braucht damit keinen gültigen
//!   Namen, um vollen KDF auszulösen.
//! - **Der KDF läuft per `spawn_blocking`**, sonst blockiert er einen Tokio-Worker.
//! - **Ein Semaphore deckelt die gleichzeitigen Läufe** und umschließt alle Arme. Er ist der
//!   wirksame Teil: `spawn_blocking` allein verschöbe den DoS nur auf Speicher (bis zu 512
//!   Blocking-Threads × ~19 MiB).
//! - **Der KDF-Platz liegt IN der Blocking-Closure.** Ein `spawn_blocking`-Task läuft weiter,
//!   wenn sein `JoinHandle` fällt; läge der Platz im abbrechbaren Future, gäbe ein
//!   Client-Abbruch ihn frei, während der Hash weiterrechnet.
//! - **Ein zweiter, vorgelagerter Semaphore ([`MAX_ANDRANG`])** weist ohne Warten ab. Ein
//!   wartender Login hält einen Platz der Zulassungssteuerung ([`crate::zulassung`]); ohne
//!   diesen Deckel könnte eine Login-Flut die gesamte API in den Lastabwurf drängen.
use crate::auth::{password, Benutzer};
use crate::error::AppError;
use sqlx::SqlitePool;
use std::sync::{Arc, LazyLock};
use tokio::sync::{OwnedSemaphorePermit, Semaphore};

/// Gleichzeitig zugelassene KDF-Läufe: die Hälfte der Parallelität, mindestens 2. Der
/// Speicherbedarf (Plätze × ~19 MiB) ist der harte Deckel.
fn kdf_plaetze() -> usize {
    std::thread::available_parallelism()
        .map(|n| (n.get() / 2).max(2))
        .unwrap_or(2)
}

/// Wie lange ein Anmeldeversuch (oder ein Hash in Anlage und Wechsel) auf einen freien KDF-Platz
/// wartet, bevor er mit 503 abgewiesen wird.
///
/// Nicht `try_acquire`: mehr gleichzeitige Anmeldungen als Plätze sind im Schichtwechsel der
/// Normalfall und sollen in Wellen abgearbeitet werden. Unbegrenztes Warten verhindert
/// [`MAX_ANDRANG`].
const WARTEFRIST: std::time::Duration = std::time::Duration::from_secs(3);

/// Wie viele Anmeldeversuche und Hashes gleichzeitig auf einen KDF-Platz warten dürfen. Klein gegen
/// [`crate::zulassung::MAX_GLEICHZEITIGE_REQUESTS`], weil jeder Wartende einen Zulassungsplatz
/// hält.
const MAX_ANDRANG: usize = 32;

/// Prozessweite Gates als `static`: die Grenzen sind eine Eigenschaft der Maschine, und
/// zusätzliche `AppState`-Felder brächen jede Test-Konstruktion.
static KDF_GATE: LazyLock<Arc<Semaphore>> =
    LazyLock::new(|| Arc::new(Semaphore::new(kdf_plaetze())));

/// Vorgelagerter Andrangs-Deckel, s. [`MAX_ANDRANG`].
static ANDRANG: LazyLock<Arc<Semaphore>> = LazyLock::new(|| Arc::new(Semaphore::new(MAX_ANDRANG)));

/// Die Stellschrauben des Login-Schutzes, gebündelt, damit Tests sie deterministisch setzen
/// können.
pub(crate) struct Schranken {
    /// Deckelt, wer überhaupt warten darf (sofortiges Abweisen).
    pub andrang: Arc<Semaphore>,
    /// Deckelt die gleichzeitig laufenden Argon2-Läufe.
    pub kdf: Arc<Semaphore>,
    /// Wie lange auf einen KDF-Platz gewartet wird.
    pub wartefrist: std::time::Duration,
}

impl Schranken {
    /// Die prozessweiten Produktionsgrenzen.
    pub(crate) fn produktiv() -> Self {
        Self {
            andrang: ANDRANG.clone(),
            kdf: KDF_GATE.clone(),
            wartefrist: WARTEFRIST,
        }
    }
}

/// Prüft Anmeldedaten und liefert den aktiven Benutzer. `AppError::Unauthorized` bei
/// unbekanntem Benutzer ODER falschem Passwort, mit angeglichener Antwortzeit (auch für
/// SSO-only-Konten). 503, wenn nach [`WARTEFRIST`] kein KDF-Platz frei wurde.
///
/// `benutzername` kommt schon normalisiert ([`crate::auth::benutzername::normalisiere`]); die
/// Suche vergleicht ohne Groß-/Kleinschreibung (`COLLATE NOCASE`, LFH-981).
pub async fn anmelden(
    pool: &SqlitePool,
    benutzername: &str,
    passwort: &str,
) -> Result<Benutzer, AppError> {
    anmelden_mit_schranken(pool, benutzername, passwort, &Schranken::produktiv()).await
}

/// Kern von [`anmelden`] mit injizierbaren Schranken für Tests.
pub(crate) async fn anmelden_mit_schranken(
    pool: &SqlitePool,
    benutzername: &str,
    passwort: &str,
    schranken: &Schranken,
) -> Result<Benutzer, AppError> {
    let benutzer = sqlx::query_as::<_, Benutzer>(
        "SELECT id, org_id, anzeigename, benutzername, passwort_hash, system_rolle, org_rolle, aktiv, erstellt_at \
         FROM benutzer WHERE benutzername = ? COLLATE NOCASE AND aktiv = 1",
    )
    .bind(benutzername)
    .fetch_optional(pool)
    .await?;

    let (_andrang, platz) = platz_holen(schranken).await?;

    // Der gesamte Match — Verifikation UND beide Wegwerf-Hashes — läuft auf dem Blocking-Pool.
    // `platz` wandert mit in die Closure, damit ein Client-Abbruch ihn nicht freigibt, solange der
    // Hash noch rechnet (s. Modul-Doku).
    let passwort = passwort.to_string();
    tokio::task::spawn_blocking(move || {
        let _platz = platz;
        match benutzer {
            Some(b) if password::verifizieren(&passwort, &b.passwort_hash) => Ok(b),
            Some(_) => Err(AppError::Unauthorized),
            None => {
                password::wegwerf_lauf(&passwort);
                Err(AppError::Unauthorized)
            }
        }
    })
    .await
    .map_err(|e| AppError::Internal(format!("KDF-Task abgebrochen: {e}")))?
}

/// Hasht ein neues Passwort unter denselben Schranken wie der Login (LFH-921): Benutzeranlage
/// und Self-Service-Wechsel rechnen Argon2 sonst außerhalb des Speicherdeckels, die Anlage
/// sogar auf einem Tokio-Worker. 503, wenn nach [`WARTEFRIST`] kein KDF-Platz frei wurde.
pub async fn hash_gedrosselt(passwort: &str) -> Result<String, AppError> {
    hash_gedrosselt_mit_schranken(passwort, &Schranken::produktiv()).await
}

/// Kern von [`hash_gedrosselt`] mit injizierbaren Schranken für Tests.
pub(crate) async fn hash_gedrosselt_mit_schranken(
    passwort: &str,
    schranken: &Schranken,
) -> Result<String, AppError> {
    let (_andrang, platz) = platz_holen(schranken).await?;
    let passwort = passwort.to_string();
    // Der Platz liegt in der Closure, wie beim Login (s. Modul-Doku).
    tokio::task::spawn_blocking(move || {
        let _platz = platz;
        password::hash(&passwort)
    })
    .await
    .map_err(|e| AppError::Internal(format!("KDF-Task abgebrochen: {e}")))?
}

/// Erwirbt erst einen Andrangsplatz ohne Warten, dann den KDF-Platz mit gedeckelter Wartezeit;
/// beide Abweisungen sind 503. Der Aufrufer hält den Andrangsplatz bis zum Ende seines Futures
/// und gibt den KDF-Platz in die Blocking-Closure (s. Modul-Doku).
async fn platz_holen(
    schranken: &Schranken,
) -> Result<(OwnedSemaphorePermit, OwnedSemaphorePermit), AppError> {
    // Erste Schranke: wer nicht einmal warten darf, wird sofort abgewiesen (s. [`MAX_ANDRANG`]).
    let Ok(andrang) = schranken.andrang.clone().try_acquire_owned() else {
        tracing::warn!("KDF-Andrang über {MAX_ANDRANG}, Versuch sofort abgewiesen (503)");
        return Err(AppError::ServiceUnavailable(
            ANMELDUNG_AUSGELASTET.to_string(),
        ));
    };

    // Zweite Schranke: gedeckelte Wartezeit auf einen KDF-Platz, s. [`WARTEFRIST`].
    let wartefrist = schranken.wartefrist;
    let platz = tokio::time::timeout(wartefrist, schranken.kdf.clone().acquire_owned()).await;
    let Ok(Ok(platz)) = platz else {
        tracing::warn!("KDF-Gate seit {wartefrist:?} ausgeschöpft, Versuch abgewiesen (503)");
        return Err(AppError::ServiceUnavailable(
            ANMELDUNG_AUSGELASTET.to_string(),
        ));
    };
    Ok((andrang, platz))
}

/// Eine Meldung für beide Abweisungsgründe und alle Aufrufer (Login, Anlage, Wechsel); die
/// Unterscheidung Andrang/KDF-Gate gehört ins Log.
const ANMELDUNG_AUSGELASTET: &str =
    "Passwortprüfung vorübergehend ausgelastet — bitte erneut versuchen.";

#[cfg(test)]
mod tests {
    use super::*;

    /// Kurz genug, dass die Erschöpfungs-Tests in Millisekunden laufen statt in Sekunden.
    const TEST_FRIST: std::time::Duration = std::time::Duration::from_millis(80);

    /// Schranken mit weitem Andrang und den übergebenen KDF-Grenzen.
    fn schranken(kdf_plaetze: usize, wartefrist: std::time::Duration) -> Schranken {
        Schranken {
            andrang: Arc::new(Semaphore::new(MAX_ANDRANG)),
            kdf: Arc::new(Semaphore::new(kdf_plaetze)),
            wartefrist,
        }
    }

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

    /// Ein per OIDC JIT-provisioniertes Konto ohne lokales Passwort (Sentinel).
    async fn sso_only_benutzer(pool: &SqlitePool) {
        sqlx::query(
            "INSERT INTO benutzer (org_id, anzeigename, benutzername, passwort_hash, aktiv) \
             VALUES (1, 'Sina SSO', 'sina', ?, 1)",
        )
        .bind(crate::auth::PASSWORT_HASH_SSO_ONLY)
        .execute(pool)
        .await
        .unwrap();
    }

    /// Ein abgewiesener Anmeldeversuch, gemessen.
    async fn versuch(pool: &SqlitePool, name: &str, schranken: &Schranken) -> std::time::Duration {
        let start = std::time::Instant::now();
        let err = anmelden_mit_schranken(pool, name, "egal", schranken)
            .await
            .unwrap_err();
        assert!(matches!(err, AppError::Unauthorized), "war: {err:?}");
        start.elapsed()
    }

    /// Der schnellste von fünf Versuchen je Name, ABWECHSELND gemessen. Störungen können einen
    /// Lauf nur verlangsamen; im Wechsel trifft eine Lastspitze beide Seiten statt nur die, die
    /// gerade an der Reihe ist. Nacheinander gemessen stand in der Coverage-CI (llvm-cov, volle
    /// Suite parallel) einmal 352 ms gegen 72 ms bei gleichem Code.
    async fn schnellste_versuche(
        pool: &SqlitePool,
        namen: [&str; 2],
        schranken: &Schranken,
    ) -> [std::time::Duration; 2] {
        let mut bestzeit = [std::time::Duration::MAX; 2];
        for _ in 0..5 {
            for (i, name) in namen.iter().enumerate() {
                bestzeit[i] = bestzeit[i].min(versuch(pool, name, schranken).await);
            }
        }
        bestzeit
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

    /// Die Bildschirmtastatur schreibt den ersten Buchstaben groß (LFH-981).
    #[tokio::test]
    async fn schreibweise_des_namens_spielt_keine_rolle() {
        let pool = crate::db::test_pool().await;
        benutzer_mit_pw(&pool, "geheim123").await;
        for name in ["Max", "MAX", "mAx"] {
            let b = anmelden(&pool, name, "geheim123")
                .await
                .unwrap_or_else(|e| panic!("`{name}` muss `max` finden, war: {e:?}"));
            assert_eq!(
                b.benutzername, "max",
                "die gespeicherte Schreibweise bleibt"
            );
        }
    }

    #[tokio::test]
    async fn deaktiviertes_konto_bleibt_in_jeder_schreibweise_abgewiesen() {
        let pool = crate::db::test_pool().await;
        benutzer_mit_pw(&pool, "geheim123").await;
        sqlx::query("UPDATE benutzer SET aktiv = 0 WHERE benutzername = 'max'")
            .execute(&pool)
            .await
            .unwrap();
        for name in ["max", "Max"] {
            let err = anmelden(&pool, name, "geheim123").await.unwrap_err();
            assert!(matches!(err, AppError::Unauthorized), "`{name}`: {err:?}");
        }
    }

    /// Anlage und Passwortwechsel hashen unter demselben Gate wie der Login (LFH-921).
    #[tokio::test]
    async fn hash_gedrosselt_weist_bei_belegtem_gate_ab() {
        let s = schranken(0, TEST_FRIST);
        let err = hash_gedrosselt_mit_schranken("geheim123", &s)
            .await
            .unwrap_err();
        assert!(
            matches!(err, AppError::ServiceUnavailable(_)),
            "erwartet 503 bei ausgeschöpftem KDF-Gate, war: {err:?}"
        );
    }

    #[tokio::test]
    async fn hash_gedrosselt_liefert_pruefbaren_hash_und_gibt_den_platz_zurueck() {
        let s = schranken(1, TEST_FRIST);
        let hash = hash_gedrosselt_mit_schranken("geheim123", &s)
            .await
            .unwrap();
        assert!(password::verifizieren("geheim123", &hash));
        assert_eq!(s.kdf.available_permits(), 1, "der KDF-Platz fällt zurück");
        assert_eq!(s.andrang.available_permits(), MAX_ANDRANG);
    }

    /// Bleibt das Gate über die Wartefrist hinaus voll, wird abgewiesen.
    #[tokio::test]
    async fn erschoepftes_gate_weist_ab_statt_zu_hashen() {
        let pool = crate::db::test_pool().await;
        benutzer_mit_pw(&pool, "geheim123").await;
        let s = schranken(0, TEST_FRIST);

        let err = anmelden_mit_schranken(&pool, "max", "geheim123", &s)
            .await
            .unwrap_err();

        assert!(
            matches!(err, AppError::ServiceUnavailable(_)),
            "erwartet 503 bei erschöpftem KDF-Gate, war: {err:?}"
        );
    }

    /// Der Wegwerf-Hash im `None`-Arm kostet einen vollen Argon2-Lauf ohne gültigen Namen und muss
    /// deshalb ebenfalls unter dem Gate stehen.
    #[tokio::test]
    async fn auch_der_unbekannte_benutzer_laeuft_durch_das_gate() {
        let pool = crate::db::test_pool().await;
        benutzer_mit_pw(&pool, "geheim123").await;
        let s = schranken(0, TEST_FRIST);

        let err = anmelden_mit_schranken(&pool, "gibtesnicht", "egal", &s)
            .await
            .unwrap_err();

        assert!(
            matches!(err, AppError::ServiceUnavailable(_)),
            "der Wegwerf-Hash-Pfad muss ebenfalls gedrosselt sein, war: {err:?}"
        );
    }

    /// Auch der Wegwerf-Lauf des Sentinel-Zweigs steht unter dem Gate. Das Gate liegt vor dem
    /// Match; wer es in die Arme verschiebt, macht diesen Test rot.
    #[tokio::test]
    async fn auch_das_sso_only_konto_laeuft_durch_das_gate() {
        let pool = crate::db::test_pool().await;
        benutzer_mit_pw(&pool, "geheim123").await;
        sso_only_benutzer(&pool).await;
        let s = schranken(0, TEST_FRIST);

        let err = anmelden_mit_schranken(&pool, "sina", "egal", &s)
            .await
            .unwrap_err();

        assert!(
            matches!(err, AppError::ServiceUnavailable(_)),
            "der Wegwerf-Hash des Sentinel-Zweigs muss ebenfalls gedrosselt sein, war: {err:?}"
        );
    }

    /// Ein Versuch gegen ein SSO-only-Konto darf nicht schneller antworten als einer gegen einen
    /// erfundenen Namen, sonst sind die SSO-Konten aufzählbar. Verglichen wird der schnellste von
    /// fünf abwechselnd gemessenen Läufen je Seite als Verhältnis, nicht gegen ein
    /// Millisekunden-Literal.
    ///
    /// Die Schwelle 10 prüft die Größenordnung: Der Fehler, den der Test fängt, ist ein Zweig ganz
    /// OHNE Argon2 (Mikrosekunden gegen einen vollen KDF-Lauf, Faktor weit über 100). Eine
    /// engere Schwelle fängt nichts zusätzlich, sie misst nur die Last des Runners.
    #[tokio::test]
    async fn sso_only_konto_antwortet_nicht_schneller_als_ein_unbekannter_name() {
        let pool = crate::db::test_pool().await;
        benutzer_mit_pw(&pool, "geheim123").await;
        sso_only_benutzer(&pool).await;
        let s = schranken(1, std::time::Duration::from_secs(60));

        let [unbekannt, sso_only] = schnellste_versuche(&pool, ["gibtesnicht", "sina"], &s).await;

        assert!(
            sso_only * 10 >= unbekannt,
            "SSO-only-Konto antwortete in {sso_only:?}, unbekannter Name in {unbekannt:?} — \
             dieser Abstand ist ein Timing-Orakel, das die SSO-Konten aufzählbar macht \
             (LFH-310)"
        );
    }

    /// Mehr gleichzeitige Logins als Plätze werden in Wellen abgearbeitet, nicht abgewiesen.
    #[tokio::test]
    async fn anmeldewelle_wird_bedient_statt_abgewiesen() {
        let pool = crate::db::test_pool().await;
        benutzer_mit_pw(&pool, "geheim123").await;
        // Ein Platz, vier gleichzeitige Anmeldungen. Die Frist ist großzügig, weil Argon2 unter
        // paralleler Testlast deutlich langsamer wird; geprüft wird die Warte-Semantik.
        let s = Arc::new(schranken(1, std::time::Duration::from_secs(60)));

        let mut laeufe = Vec::new();
        for _ in 0..4 {
            let pool = pool.clone();
            let s = s.clone();
            laeufe.push(tokio::spawn(async move {
                anmelden_mit_schranken(&pool, "max", "geheim123", &s)
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

    /// Ein abgebrochener Login gibt den KDF-Platz erst frei, wenn der Argon2-Lauf fertig ist.
    #[tokio::test]
    async fn abgebrochener_login_gibt_den_platz_nicht_vorzeitig_frei() {
        let pool = crate::db::test_pool().await;
        benutzer_mit_pw(&pool, "geheim123").await;
        let s = schranken(1, std::time::Duration::from_secs(60));
        let kdf = s.kdf.clone();

        {
            let lauf = anmelden_mit_schranken(&pool, "max", "geheim123", &s);
            tokio::pin!(lauf);

            // Erst verwerfen, wenn das Future den Platz wirklich hält (vorher hinge es in der
            // DB-Abfrage).
            let mut belegt = false;
            for _ in 0..2000 {
                tokio::select! {
                    _ = &mut lauf => panic!("Argon2 war unerwartet schon fertig"),
                    _ = tokio::time::sleep(std::time::Duration::from_millis(1)) => {}
                }
                if kdf.available_permits() == 0 {
                    belegt = true;
                    break;
                }
            }
            assert!(belegt, "Platz wurde nie belegt — Test greift ins Leere");

            // Hier fällt `lauf`, wie bei einem Verbindungsabbruch des Clients.
        }

        assert_eq!(
            kdf.available_permits(),
            0,
            "der Platz darf erst zurückfallen, wenn der Argon2-Lauf beendet ist — sonst zählt \
             das Gate wartende Handler statt laufender Hashes"
        );
    }

    /// Überzählige Wartende werden sofort abgewiesen, nicht erst nach der Wartefrist.
    #[tokio::test]
    async fn ueberzaehliger_andrang_wird_sofort_abgewiesen_statt_zu_warten() {
        let pool = crate::db::test_pool().await;
        benutzer_mit_pw(&pool, "geheim123").await;
        let wartefrist = std::time::Duration::from_secs(30);
        let s = Schranken {
            andrang: Arc::new(Semaphore::new(0)), // kein Andrangsplatz frei
            kdf: Arc::new(Semaphore::new(8)),     // KDF wäre reichlich verfügbar
            wartefrist,
        };

        let start = std::time::Instant::now();
        let err = anmelden_mit_schranken(&pool, "max", "geheim123", &s)
            .await
            .unwrap_err();
        let gebraucht = start.elapsed();

        assert!(
            matches!(err, AppError::ServiceUnavailable(_)),
            "erwartet 503 bei vollem Andrang, war: {err:?}"
        );
        assert!(
            gebraucht < wartefrist / 10,
            "Abweisung muss sofort erfolgen, brauchte aber {gebraucht:?} — sonst hält der \
             Versuch weiter einen Zulassungsplatz"
        );
    }

    /// Der Platz fällt nach jedem Versuch zurück, sonst sperrt sich der Login selbst aus.
    #[tokio::test]
    async fn platz_faellt_nach_jedem_versuch_zurueck() {
        let pool = crate::db::test_pool().await;
        benutzer_mit_pw(&pool, "geheim123").await;
        let s = schranken(1, TEST_FRIST);

        for durchgang in 1..=3 {
            let b = anmelden_mit_schranken(&pool, "max", "geheim123", &s)
                .await
                .unwrap_or_else(|e| panic!("Durchgang {durchgang} scheiterte: {e:?}"));
            assert_eq!(b.benutzername, "max");
        }

        // Auch der Fehlschlag-Pfad darf den Platz nicht einbehalten.
        let _ = anmelden_mit_schranken(&pool, "max", "falsch", &s).await;
        assert!(
            anmelden_mit_schranken(&pool, "max", "geheim123", &s)
                .await
                .is_ok(),
            "nach einem Fehlversuch muss der Platz wieder frei sein"
        );
    }
}
