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
//! Das Gate umschließt bewusst **alle** Arme des Matches, die beiden Wegwerf-Hashes
//! eingeschlossen — andernfalls bliebe genau der Vektor aus Punkt 2 offen.
//!
//! ## Drei Arme, ein Argon2-Lauf (LFH-310)
//!
//! Die Angleichung der Antwortzeit greift nur, wenn sie **jeden** Weg trifft. Sie tat das
//! lange nur für zwei: der Treffer-Arm verifiziert, der `None`-Arm brennt einen Wegwerf-Hash
//! — ein SSO-only-Konto aber (Sentinel-`passwort_hash` aus LFH-41, bewusst kein PHC-String)
//! scheiterte schon am Parsen und antwortete in ~0 ms statt nach ~50–100 ms. Damit waren
//! genau die per SSO angebundenen Konten per Timing aufzählbar. Den Ausgleich trägt seither
//! [`password::wegwerf_lauf`], gerufen aus dem Parse-Fehler-Zweig von
//! [`password::verifizieren`] — also **innerhalb** der Closure und damit unter demselben
//! KDF-Platz wie die beiden anderen Arme, ohne zusätzlichen Lauf je Anmeldeversuch.
//!
//! ## Warum der KDF-Platz IN der Blocking-Closure liegt
//!
//! Ein `spawn_blocking`-Task läuft weiter, wenn sein `JoinHandle` fällt — tokio bricht ihn
//! nicht ab. Läge der Platz im await-baren Future (also außerhalb der Closure), gäbe ihn ein
//! Client-Abbruch sofort frei, während der Argon2-Lauf im Blocking-Pool weiterrechnet. Das
//! Gate zählte dann nur noch die *wartenden* Handler statt der *laufenden* Hashes: ein
//! Angreifer, der jede Anfrage sofort trennt, könnte beliebig viele Läufe akkumulieren
//! (gemessen: der Platz fiel nach 22 ms zurück, der Hash lief 3 s weiter). Der Platz wandert
//! deshalb per `move` in die Closure — dort hängt seine Lebensdauer an der nicht
//! abbrechbaren Arbeit.
//!
//! ## Warum es ZWEI Semaphore braucht
//!
//! Das KDF-Gate lässt Wartende zu (s. [`WARTEFRIST`]). Ein wartender Login belegt dabei
//! einen der Plätze der Zulassungssteuerung ([`crate::zulassung`]) — genug gleichzeitige
//! Fantasie-Logins hätten also den globalen Cap geleert und die **gesamte** API in den
//! Lastabwurf geschickt, `/api/health` eingeschlossen. Der Andrangs-Deckel
//! ([`MAX_ANDRANG`]) begrenzt deshalb vorgelagert und **ohne zu warten**, wie viele
//! Anmeldungen überhaupt in die Warteschlange dürfen.
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

/// Wie viele Anmeldeversuche gleichzeitig überhaupt auf einen KDF-Platz warten dürfen.
///
/// Deutlich kleiner als [`crate::zulassung::MAX_GLEICHZEITIGE_REQUESTS`] (256): ein wartender
/// Login hält einen Zulassungsplatz, also darf der Login nie mehr als einen kleinen Bruchteil
/// davon binden — sonst drängt eine Login-Flut die gesamte übrige API in den Lastabwurf.
/// Großzügig genug für jede reale Anmeldewelle, weil ein Platz nach ~50–100 ms weiterrückt.
const MAX_ANDRANG: usize = 32;

/// Prozessweite Gates — bewusst `static` und keine `AppState`-Felder: die Grenzen sind eine
/// Eigenschaft der Maschine, nicht des Anwendungszustands, und zusätzliche Pflichtfelder
/// in `AppState` würden jede Test-Konstruktion brechen.
static KDF_GATE: LazyLock<Arc<Semaphore>> =
    LazyLock::new(|| Arc::new(Semaphore::new(kdf_plaetze())));

/// Vorgelagerter Andrangs-Deckel, s. [`MAX_ANDRANG`].
static ANDRANG: LazyLock<Arc<Semaphore>> = LazyLock::new(|| Arc::new(Semaphore::new(MAX_ANDRANG)));

/// Die drei Stellschrauben des Login-Schutzes, gebündelt — damit Tests sie deterministisch
/// setzen können, ohne an den prozessweiten Gates zu drehen.
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
    fn produktiv() -> Self {
        Self {
            andrang: ANDRANG.clone(),
            kdf: KDF_GATE.clone(),
            wartefrist: WARTEFRIST,
        }
    }
}

/// Prüft Anmeldedaten und liefert den aktiven Benutzer. `AppError::Unauthorized`
/// bei unbekanntem Benutzer ODER falschem Passwort. Gleicht die Antwortzeit an
/// (Wegwerf-Hash), damit sich existierende Benutzer nicht per Timing enumerieren lassen —
/// auch SSO-only-Konten, deren Sentinel-Hash gar nicht erst parsbar ist (LFH-310).
///
/// Bei dauerhaft ausgeschöpftem KDF-Gate: `AppError::ServiceUnavailable` (503), nachdem
/// [`WARTEFRIST`] erfolglos verstrichen ist.
pub async fn anmelden(
    pool: &SqlitePool,
    benutzername: &str,
    passwort: &str,
) -> Result<Benutzer, AppError> {
    anmelden_mit_schranken(pool, benutzername, passwort, &Schranken::produktiv()).await
}

/// Kern von [`anmelden`] mit injizierbaren Schranken — nur damit Tests Erschöpfung
/// deterministisch und ohne mehrsekündige Laufzeit herstellen können.
pub(crate) async fn anmelden_mit_schranken(
    pool: &SqlitePool,
    benutzername: &str,
    passwort: &str,
    schranken: &Schranken,
) -> Result<Benutzer, AppError> {
    let benutzer = sqlx::query_as::<_, Benutzer>(
        "SELECT id, org_id, anzeigename, benutzername, passwort_hash, system_rolle, org_rolle, aktiv, erstellt_at \
         FROM benutzer WHERE benutzername = ? AND aktiv = 1",
    )
    .bind(benutzername)
    .fetch_optional(pool)
    .await?;

    // Erste Schranke: wer nicht einmal warten darf, wird SOFORT abgewiesen. Ohne diesen
    // Deckel könnte eine Login-Flut über die Wartefrist alle Plätze der Zulassungssteuerung
    // binden und damit die gesamte übrige API in den Lastabwurf drängen.
    let Ok(_andrang) = schranken.andrang.clone().try_acquire_owned() else {
        tracing::warn!("Login-Andrang über {MAX_ANDRANG}, Anmeldeversuch sofort abgewiesen (503)");
        return Err(AppError::ServiceUnavailable(
            ANMELDUNG_AUSGELASTET.to_string(),
        ));
    };

    // Zweite Schranke: gedeckelte Wartezeit auf einen KDF-Platz, s. [`WARTEFRIST`].
    let wartefrist = schranken.wartefrist;
    let platz = tokio::time::timeout(wartefrist, schranken.kdf.clone().acquire_owned()).await;
    let Ok(Ok(platz)) = platz else {
        tracing::warn!(
            "KDF-Gate seit {wartefrist:?} ausgeschöpft, Anmeldeversuch abgewiesen (503)"
        );
        return Err(AppError::ServiceUnavailable(
            ANMELDUNG_AUSGELASTET.to_string(),
        ));
    };

    // Argon2id ist rechen- und speicherintensiv und blockiert den aufrufenden Thread für die
    // volle Dauer. Auf dem async-Executor ausgeführt hieße das: ein Worker steht still. Der
    // gesamte Match — Verifikation UND beide Wegwerf-Hashes — wandert deshalb auf den
    // Blocking-Pool.
    //
    // `platz` wandert MIT in die Closure: ein `spawn_blocking`-Task überlebt das Fallen seines
    // JoinHandle. Läge der Platz draußen, gäbe ein Client-Abbruch ihn frei, während der Hash
    // noch rechnet — das Gate zählte dann Wartende statt laufender Hashes (s. Modul-Doku).
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

/// Eine Meldung für beide Abweisungsgründe: nach außen ist der Zustand derselbe („gerade zu
/// viel los"), und die Unterscheidung Andrang/KDF-Gate ist eine Betriebsinformation, die ins
/// Log gehört, nicht in die Antwort.
const ANMELDUNG_AUSGELASTET: &str = "Anmeldung vorübergehend ausgelastet — bitte erneut versuchen.";

#[cfg(test)]
mod tests {
    use super::*;

    /// Kurz genug, dass die Erschöpfungs-Tests in Millisekunden laufen statt in Sekunden.
    const TEST_FRIST: std::time::Duration = std::time::Duration::from_millis(80);

    /// Schranken mit weitem Andrang (der ist hier nie der Prüfgegenstand) und den übergebenen
    /// KDF-Grenzen.
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

    /// Ein per OIDC JIT-provisioniertes Konto: existiert, hat aber kein lokales Passwort,
    /// sondern den Sentinel aus LFH-41.
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

    /// Der schnellste von drei Anmeldeversuchen — das Minimum kommt der reinen Rechenzeit am
    /// nächsten, weil eine Störung einen Lauf nur verlangsamen kann.
    async fn schnellster_versuch(
        pool: &SqlitePool,
        name: &str,
        schranken: &Schranken,
    ) -> std::time::Duration {
        let mut bestzeit = std::time::Duration::MAX;
        for _ in 0..3 {
            let start = std::time::Instant::now();
            let err = anmelden_mit_schranken(pool, name, "egal", schranken)
                .await
                .unwrap_err();
            assert!(matches!(err, AppError::Unauthorized), "war: {err:?}");
            bestzeit = bestzeit.min(start.elapsed());
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

    /// LFH-270/G07: bleibt das Gate über die Wartefrist hinaus voll, wird abgewiesen —
    /// statt unbegrenzt zu warten oder einen weiteren Argon2-Lauf zu starten.
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

    /// Der eigentliche DoS-Vektor: der Wegwerf-Hash im `None`-Arm kostet einen vollen
    /// Argon2-Lauf OHNE gültigen Benutzernamen. Läge das Gate nur um den Verifikations-Zweig,
    /// bliebe er ungedrosselt — dieser Test hält genau das fest.
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

    /// LFH-310: der Sentinel-Zweig brennt seit diesem Ticket einen Wegwerf-Hash — und dieser
    /// Lauf muss ebenso unter dem Gate stehen wie die beiden anderen Arme. Läge er darunter
    /// hinweg, hätte LFH-270 ein Loch genau in der Größe der SSO-only-Konten.
    ///
    /// Der Test war auch VOR dem Fix grün, und das ist kein Mangel: das Gate liegt vor dem
    /// Match, umschließt also jeden Arm von selbst. Er hält genau diese Lage fest — wer das
    /// Gate je in die Arme hinein verschiebt, lässt ihn rot werden.
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

    /// Das Akzeptanzkriterium von LFH-310, am tatsächlichen Angriffsweg gemessen: der
    /// Anmeldeversuch gegen ein SSO-only-Konto darf nicht schneller antworten als einer gegen
    /// einen erfundenen Benutzernamen — sonst sind genau die SSO-Konten aufzählbar.
    ///
    /// Verglichen wird der **schnellste** von drei Läufen je Seite (Störungen verlangsamen
    /// nur) und als **Verhältnis**, nicht gegen ein Millisekunden-Literal: die Lücke, die der
    /// Test fängt, ist drei Größenordnungen breit (gemessen im Debug-Build vor dem Fix:
    /// 505 ms unbekannter Name gegen 280 µs SSO-only-Konto).
    #[tokio::test]
    async fn sso_only_konto_antwortet_nicht_schneller_als_ein_unbekannter_name() {
        let pool = crate::db::test_pool().await;
        benutzer_mit_pw(&pool, "geheim123").await;
        sso_only_benutzer(&pool).await;
        let s = schranken(1, std::time::Duration::from_secs(60));

        let unbekannt = schnellster_versuch(&pool, "gibtesnicht", &s).await;
        let sso_only = schnellster_versuch(&pool, "sina", &s).await;

        assert!(
            sso_only * 4 >= unbekannt,
            "SSO-only-Konto antwortete in {sso_only:?}, unbekannter Name in {unbekannt:?} — \
             dieser Abstand ist ein Timing-Orakel, das die SSO-Konten aufzählbar macht \
             (LFH-310)"
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
        // Die Frist ist bewusst großzügig und NICHT die Produktionsfrist: unter paralleler
        // Testlast steigt ein Argon2-Lauf von ~50-100 ms deutlich an, und der Test soll die
        // Warte-Semantik prüfen, nicht die Maschinengeschwindigkeit.
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

    /// Review-Befund (HOCH): ein `spawn_blocking`-Task überlebt das Fallen seines JoinHandle.
    /// Läge der KDF-Platz im abbrechbaren Future statt in der Closure, gäbe ein Client-Abbruch
    /// ihn frei, während der Argon2-Lauf weiterrechnet — ein Angreifer, der jede Anfrage sofort
    /// trennt, könnte dann beliebig viele Läufe akkumulieren (Blocking-Pool: 512 × ~19 MiB).
    #[tokio::test]
    async fn abgebrochener_login_gibt_den_platz_nicht_vorzeitig_frei() {
        let pool = crate::db::test_pool().await;
        benutzer_mit_pw(&pool, "geheim123").await;
        let s = schranken(1, std::time::Duration::from_secs(60));
        let kdf = s.kdf.clone();

        {
            let lauf = anmelden_mit_schranken(&pool, "max", "geheim123", &s);
            tokio::pin!(lauf);

            // Das Future so weit treiben, bis es den Platz wirklich genommen hat — vorher zu
            // verwerfen würde nichts beweisen (es hinge dann noch in der DB-Abfrage).
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

            // Hier fällt `lauf` — genau das tut hyper, wenn der Client die Verbindung trennt.
        }

        assert_eq!(
            kdf.available_permits(),
            0,
            "der Platz darf erst zurückfallen, wenn der Argon2-Lauf beendet ist — sonst zählt \
             das Gate wartende Handler statt laufender Hashes"
        );
    }

    /// Review-Befund (HOCH): ein wartender Login belegt einen Platz der Zulassungssteuerung.
    /// Ohne vorgelagerten Andrangs-Deckel hätte eine Login-Flut den globalen Cap geleert und
    /// die gesamte übrige API in den Lastabwurf gedrängt. Überzählige müssen deshalb SOFORT
    /// abgewiesen werden, nicht erst nach der Wartefrist.
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

    /// Der Platz muss nach jedem Versuch zurückfallen — sonst sperrt sich der Login nach
    /// wenigen Anmeldungen dauerhaft selbst aus.
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
