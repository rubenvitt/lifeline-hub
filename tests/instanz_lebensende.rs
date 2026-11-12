//! Lebensende eines Einsatzes zwischen zwei Instanzen (LLH-1494, Change
//! `tkky2noy-archiv-nachbereitung`, design.md D2–D6): Verwahrung am Hub nach der Nachbereitung,
//! gelöschte Einsätze in beide Richtungen, Soft-Delete und Wiederherstellung am Spiegel, Spiegel
//! am ELW nach der Nachbereitung. Je Instanz eigene DB und eigener Server auf Loopback.

mod common;
mod instanz_hilfen;

use axum::http::StatusCode;
use instanz_hilfen::*;
use lifeline_hub::einsatz::abraeumen::{self, AbraeumArt};
use serde_json::json;

async fn gekoppelt_gemeldet() -> (Instanz, Instanz) {
    let (hub, elw) = gekoppelt().await;
    melden(&elw).await;
    (hub, elw)
}

async fn abgleichen(elw: &Instanz) {
    lifeline_hub::instanz::spiegel::takt::durchlauf(&elw.pool, Some(&elw.app), true)
        .await
        .unwrap();
}

async fn etb_eintrag(i: &Instanz, einsatz: i64, inhalt: &str) {
    let (s, v) = common::anfrage_json(
        &i.app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/etb"),
        &i.admin,
        Some(&json!({ "typ": "meldung", "inhalt": inhalt, "von": "ELW", "an": "EL" })),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
}

async fn abschliessen(i: &Instanz, einsatz: i64) {
    let (s, v) = common::anfrage(
        &i.app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/abschliessen"),
        &i.admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
}

/// Lässt die Nachbereitung eines eigenen Einsatzes ablaufen.
async fn nachbereitung_vorbei(i: &Instanz, einsatz: i64) {
    exec(
        &i.pool,
        &format!(
            "UPDATE einsatz SET nachbereitung_bis = '2000-01-01 00:00:00' WHERE id = {einsatz}"
        ),
    )
    .await;
}

async fn gibt_es(pool: &sqlx::SqlitePool, sql: &str) -> bool {
    eine::<i64>(pool, &format!("SELECT COUNT(*) FROM ({sql})")).await > 0
}

async fn protokoll(pool: &sqlx::SqlitePool, einsatz: i64) -> (String, Option<String>) {
    sqlx::query_as("SELECT art, gegenstelle FROM aufbewahrung_loeschprotokoll WHERE einsatz_id = ?")
        .bind(einsatz)
        .fetch_one(pool)
        .await
        .unwrap()
}

async fn kennung(pool: &sqlx::SqlitePool, einsatz: i64) -> String {
    eine(
        pool,
        &format!("SELECT kennung FROM einsatz WHERE id = {einsatz}"),
    )
    .await
}

/// Der Einsatz des Hubs mit dieser Kennung: (id, spiegel).
async fn am_hub(hub: &Instanz, kennung: &str) -> (i64, bool) {
    sqlx::query_as("SELECT id, spiegel FROM einsatz WHERE kennung = ?")
        .bind(kennung)
        .fetch_one(&hub.pool)
        .await
        .unwrap()
}

async fn etb_texte(pool: &sqlx::SqlitePool, einsatz: i64) -> Vec<String> {
    sqlx::query_scalar("SELECT inhalt FROM etb_eintrag WHERE einsatz_id = ? ORDER BY id")
        .bind(einsatz)
        .fetch_all(pool)
        .await
        .unwrap()
}

#[tokio::test]
async fn nach_der_nachbereitung_verwahrt_der_hub_und_der_elw_raeumt_ab() {
    let (hub, elw) = gekoppelt_gemeldet().await;
    let e = common::einsatz_anlegen_mit(&elw.app, &elw.admin, "Hochwasser").await;
    etb_eintrag(&elw, e, "Lage erkundet").await;
    abgleichen(&elw).await;
    abschliessen(&elw, e).await;
    abgleichen(&elw).await;
    let k = kennung(&elw.pool, e).await;
    assert!(am_hub(&hub, &k).await.1, "erst Spiegel");

    nachbereitung_vorbei(&elw, e).await;
    abgleichen(&elw).await;

    let (h, spiegel) = am_hub(&hub, &k).await;
    assert!(!spiegel, "am Hub ein eigener Einsatz");
    let texte = etb_texte(&hub.pool, h).await;
    assert!(texte.contains(&"Lage erkundet".to_string()), "{texte:?}");
    assert!(
        texte
            .iter()
            .any(|t| t.starts_with("Zur Verwahrung übernommen von ")),
        "{texte:?}"
    );
    assert!(
        !gibt_es(&elw.pool, &format!("SELECT 1 FROM einsatz WHERE id = {e}")).await,
        "am ELW abgeräumt"
    );
    let (art, gegenstelle) = protokoll(&elw.pool, e).await;
    assert_eq!(art, "verwahrt");
    assert!(gegenstelle.is_some());
    // Am Hub ist der Einsatz beschreibbar und wird nicht zurückgeliefert.
    let (s, v) = common::anfrage_json(
        &hub.app,
        "PUT",
        &format!("/api/einsaetze/{h}/nachbereitung"),
        &hub.admin,
        Some(&json!({ "nachbereitung_bis": null })),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    abgleichen(&elw).await;
    assert!(!gibt_es(&elw.pool, "SELECT 1 FROM einsatz_spiegel").await);
}

#[tokio::test]
async fn ein_ohne_netz_angelegter_einsatz_wird_ebenso_verwahrt() {
    let (hub, elw) = gekoppelt_gemeldet().await;
    let e = common::einsatz_anlegen_mit(&elw.app, &elw.admin, "Ohne Netz").await;
    etb_eintrag(&elw, e, "Funkloch").await;
    abschliessen(&elw, e).await;
    nachbereitung_vorbei(&elw, e).await;
    // Abgeschlossene Einsätze liefert der ELW nur, wenn der Hub sie nennt; dieser hier geht als
    // fällige Verwahrung trotzdem hinaus.
    abgleichen(&elw).await;

    // Die Kennung trägt einen Zufallsteil (`<instanz>/<id>-<zufall>`, LLH-1641); den Einsatz gibt
    // es am ELW nicht mehr, also am Hub über das Präfix suchen.
    let praefix = format!(
        "{}/{e}-",
        eine::<String>(&elw.pool, "SELECT kennung FROM instanz_identitaet").await
    );
    let k: String = eine(
        &hub.pool,
        &format!("SELECT kennung FROM einsatz WHERE kennung LIKE '{praefix}%'"),
    )
    .await;
    let (h, spiegel) = am_hub(&hub, &k).await;
    assert!(!spiegel);
    assert!(etb_texte(&hub.pool, h)
        .await
        .contains(&"Funkloch".to_string()));
    assert!(!gibt_es(&elw.pool, &format!("SELECT 1 FROM einsatz WHERE id = {e}")).await);
}

#[tokio::test]
async fn die_verwahrung_wartet_auf_einen_anhang_und_gelingt_danach() {
    let (hub, elw) = gekoppelt_gemeldet().await;
    let e = common::einsatz_anlegen(&elw.app, &elw.admin).await;
    // Fünf Stücke: mehr, als die Runden eines Abgleichs nach dem Abruf tragen.
    let bytes: Vec<u8> = (0..5 * 256 * 1024 - 100)
        .map(|i| (i * 7 % 251) as u8)
        .collect();
    sqlx::query(
        "INSERT INTO anhang (einsatz_id, dateiname, mime, groesse, sha256, daten, hochgeladen_von) \
         VALUES (?, 'karte.bin', 'application/octet-stream', ?, 'x', ?, 1)",
    )
    .bind(e)
    .bind(bytes.len() as i64)
    .bind(&bytes)
    .execute(&elw.pool)
    .await
    .unwrap();
    abschliessen(&elw, e).await;
    nachbereitung_vorbei(&elw, e).await;
    abgleichen(&elw).await;

    let grund: Option<String> = eine(
        &elw.pool,
        &format!("SELECT grund FROM einsatz_verwahrung WHERE einsatz_id = {e}"),
    )
    .await;
    assert_eq!(grund.as_deref(), Some("1 Anhang fehlt"));
    let k = kennung(&elw.pool, e).await;
    assert!(am_hub(&hub, &k).await.1, "noch Spiegel");

    for _ in 0..3 {
        abgleichen(&elw).await;
    }
    let (h, spiegel) = am_hub(&hub, &k).await;
    assert!(!spiegel, "nach dem Anhang angenommen");
    let am_hub: Vec<u8> = eine(
        &hub.pool,
        &format!("SELECT daten FROM anhang WHERE einsatz_id = {h}"),
    )
    .await;
    assert_eq!(am_hub, bytes);
    assert!(!gibt_es(&elw.pool, &format!("SELECT 1 FROM einsatz WHERE id = {e}")).await);
}

#[tokio::test]
async fn soft_delete_und_wiederherstellung_kommen_beim_spiegel_an() {
    let (hub, elw) = gekoppelt_gemeldet().await;
    let e = common::einsatz_anlegen(&elw.app, &elw.admin).await;
    abgleichen(&elw).await;
    abschliessen(&elw, e).await;
    abgleichen(&elw).await;
    let k = kennung(&elw.pool, e).await;
    let (s, _) = am_hub(&hub, &k).await;
    let geloescht = |pool: sqlx::SqlitePool| async move {
        eine::<Option<String>>(
            &pool,
            &format!("SELECT geloescht_at FROM einsatz WHERE id = {s}"),
        )
        .await
    };
    assert_eq!(geloescht(hub.pool.clone()).await, None);

    exec(
        &elw.pool,
        &format!("UPDATE einsatz SET geloescht_at = '2026-11-01 00:00:00' WHERE id = {e}"),
    )
    .await;
    abgleichen(&elw).await;
    assert_eq!(
        geloescht(hub.pool.clone()).await.as_deref(),
        Some("2026-11-01 00:00:00")
    );

    exec(
        &elw.pool,
        &format!("UPDATE einsatz SET geloescht_at = NULL WHERE id = {e}"),
    )
    .await;
    abgleichen(&elw).await;
    assert_eq!(geloescht(hub.pool.clone()).await, None);
}

/// Löscht einen eigenen Einsatz so, wie es die Aufbewahrung tut: Protokollzeile, dann weg.
async fn loeschen(i: &Instanz, einsatz: i64) {
    let mut tx = i.pool.begin().await.unwrap();
    abraeumen::vormerken(&mut tx, einsatz, AbraeumArt::Verwahrt, None)
        .await
        .unwrap();
    tx.commit().await.unwrap();
    assert!(abraeumen::ausfuehren(&i.pool, einsatz).await.unwrap());
}

#[tokio::test]
async fn loescht_der_hub_seinen_einsatz_raeumt_der_elw_den_spiegel_ab() {
    let (hub, elw) = gekoppelt_gemeldet().await;
    let e = common::einsatz_anlegen(&hub.app, &hub.admin).await;
    abgleichen(&elw).await;
    abschliessen(&hub, e).await;
    abgleichen(&elw).await;
    let s: i64 = eine(&elw.pool, "SELECT einsatz_id FROM einsatz_spiegel").await;

    loeschen(&hub, e).await;
    abgleichen(&elw).await;

    assert!(!gibt_es(&elw.pool, &format!("SELECT 1 FROM einsatz WHERE id = {s}")).await);
    let (art, _) = protokoll(&elw.pool, s).await;
    assert_eq!(art, "spiegel");
}

#[tokio::test]
async fn loescht_der_elw_seinen_einsatz_raeumt_der_hub_den_spiegel_ab() {
    let (hub, elw) = gekoppelt_gemeldet().await;
    let e = common::einsatz_anlegen(&elw.app, &elw.admin).await;
    abgleichen(&elw).await;
    abschliessen(&elw, e).await;
    abgleichen(&elw).await;
    let s: i64 = eine(&hub.pool, "SELECT einsatz_id FROM einsatz_spiegel").await;
    let andere = common::einsatz_anlegen(&elw.app, &elw.admin).await;
    abgleichen(&elw).await;

    loeschen(&elw, e).await;
    abgleichen(&elw).await;

    assert!(!gibt_es(&hub.pool, &format!("SELECT 1 FROM einsatz WHERE id = {s}")).await);
    let (art, gegenstelle) = protokoll(&hub.pool, s).await;
    assert_eq!(art, "spiegel");
    assert!(gegenstelle.is_some());
    let k = kennung(&elw.pool, andere).await;
    assert!(am_hub(&hub, &k).await.1, "der andere Spiegel bleibt");
}

#[tokio::test]
async fn ein_spiegel_am_elw_geht_nach_der_nachbereitung_der_einsatz_am_hub_bleibt() {
    let (hub, elw) = gekoppelt_gemeldet().await;
    let e = common::einsatz_anlegen(&hub.app, &hub.admin).await;
    abgleichen(&elw).await;
    abschliessen(&hub, e).await;
    nachbereitung_vorbei(&hub, e).await;
    abgleichen(&elw).await;
    let s: i64 = eine(&elw.pool, "SELECT einsatz_id FROM einsatz_spiegel").await;

    assert_eq!(
        abraeumen::phase_r(&elw.pool, "2026-11-11 12:00:00").await,
        1
    );
    assert!(!gibt_es(&elw.pool, &format!("SELECT 1 FROM einsatz WHERE id = {s}")).await);
    abgleichen(&elw).await;
    assert!(
        !gibt_es(&elw.pool, "SELECT 1 FROM einsatz_spiegel").await,
        "nicht neu geliefert"
    );
    assert!(gibt_es(&hub.pool, &format!("SELECT 1 FROM einsatz WHERE id = {e}")).await);
}

// ── Führungsakte bei Verwahrung (LLH-1647) ───────────────────────────────────────────────────

/// Beide Instanzen mit `LIFELINE_FUEHRUNG`, gekoppelt und gemeldet.
async fn mit_fuehrung() -> (Instanz, Instanz) {
    let (hub, elw) = gekoppelt_gemeldet().await;
    for i in [&hub, &elw] {
        lifeline_hub::instanz::fuehrung::save_schalter(&i.pool, true)
            .await
            .unwrap();
    }
    melden(&elw).await;
    (hub, elw)
}

/// Abgeschlossener ELW-Einsatz mit ETB-Eintrag, am Hub gespiegelt samt Akte: (ELW-ID, Kennung).
async fn abgeschlossen_gespiegelt(hub: &Instanz, elw: &Instanz) -> (i64, String) {
    let e = common::einsatz_anlegen_mit(&elw.app, &elw.admin, "Hochwasser").await;
    etb_eintrag(elw, e, "Lage erkundet").await;
    melden(elw).await;
    abgleichen(elw).await;
    abschliessen(elw, e).await;
    melden(elw).await;
    abgleichen(elw).await;
    let k = kennung(&elw.pool, e).await;
    let (h, spiegel) = am_hub(hub, &k).await;
    assert!(spiegel, "erst Spiegel");
    assert_eq!(
        eine::<String>(
            &hub.pool,
            &format!("SELECT fuehrer_kennung FROM einsatz_fuehrung WHERE einsatz_id = {h}")
        )
        .await,
        eine::<String>(&elw.pool, "SELECT kennung FROM instanz_identitaet").await,
        "die Akte des ELW hängt am Spiegel"
    );
    (e, k)
}

async fn fuehrung_am(i: &Instanz, einsatz: i64) -> serde_json::Value {
    let (s, v) = common::anfrage(
        &i.app,
        "GET",
        &format!("/api/einsaetze/{einsatz}/fuehrung"),
        &i.admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    v
}

async fn texte(pool: &sqlx::SqlitePool, sql: &str) -> Vec<String> {
    sqlx::query_scalar(sqlx::AssertSqlSafe(sql.to_string()))
        .fetch_all(pool)
        .await
        .unwrap()
}

/// Kein Alarm „ungültige Übernahme“ und keine Admin-Spur der Führung an dieser Instanz.
async fn ohne_alarm(i: &Instanz) {
    assert!(
        texte(
            &i.pool,
            "SELECT art FROM benachrichtigung WHERE art LIKE 'fuehrung%'"
        )
        .await
        .is_empty(),
        "kein Alarm an die Einsatzleitung"
    );
    assert!(
        texte(
            &i.pool,
            "SELECT aktion FROM admin_audit WHERE aktion LIKE 'fuehrung%'"
        )
        .await
        .is_empty(),
        "keine Admin-Spur der Führung"
    );
}

#[tokio::test]
async fn mit_fuehrung_fuehrt_der_hub_den_verwahrten_einsatz_mit_nachvollziehbarem_verlauf() {
    let (hub, elw) = mit_fuehrung().await;
    let (e, k) = abgeschlossen_gespiegelt(&hub, &elw).await;
    // Im Testprozess tragen beide Instanzen denselben Namen; die Kennung unterscheidet sie.
    let name = lifeline_hub::instanz::name().to_string();
    let elw_kennung: String = eine(&elw.pool, "SELECT kennung FROM instanz_identitaet").await;
    let hub_kennung: String = eine(&hub.pool, "SELECT kennung FROM instanz_identitaet").await;

    nachbereitung_vorbei(&elw, e).await;
    abgleichen(&elw).await;

    let (h, spiegel) = am_hub(&hub, &k).await;
    assert!(!spiegel, "am Hub ein eigener Einsatz");
    assert!(
        !gibt_es(&elw.pool, &format!("SELECT 1 FROM einsatz WHERE id = {e}")).await,
        "am ELW abgeräumt"
    );
    let a = fuehrung_am(&hub, h).await;
    assert_eq!(a["fuehrend"], true, "{a}");
    assert_eq!(a["fuehrer_kennung"], hub_kennung.as_str(), "{a}");
    assert_eq!(a["art"], "verwahrung", "{a}");
    assert_eq!(a["verwahrt"], true, "{a}");
    assert_eq!(a["epoche"], 2, "{a}");
    let verlauf = a["verlauf"].as_array().unwrap();
    let arten: Vec<&str> = verlauf.iter().map(|v| v["art"].as_str().unwrap()).collect();
    assert_eq!(arten, ["angelegt", "verwahrung"], "{a}");
    let letzter = verlauf.last().unwrap();
    assert_eq!(letzter["epoche_zaehler"], 2, "{a}");
    assert_eq!(letzter["von_name"], name.as_str(), "{a}");
    assert_eq!(letzter["nach_name"], name.as_str(), "{a}");
    assert!(letzter.get("wer").is_none(), "der Abgleich löst aus: {a}");
    let epoche_von: String = eine(
        &hub.pool,
        &format!("SELECT epoche_instanz FROM einsatz_fuehrung WHERE einsatz_id = {h}"),
    )
    .await;
    assert_eq!(epoche_von, hub_kennung, "der Hub vergibt die Epoche");

    // Die Akte des Hubs geht beim ELW ins Leere: kein Alarm, nichts zurück.
    melden(&elw).await;
    melden(&elw).await;
    ohne_alarm(&elw).await;
    ohne_alarm(&hub).await;
    assert!(!gibt_es(&elw.pool, "SELECT 1 FROM einsatz_fuehrung").await);

    // Ausrichten nach der Akte (jede Meldung, Neustart) lässt ihn eigen, der Abgleich räumt nichts.
    lifeline_hub::instanz::fuehrung::save_schalter(&hub.pool, true)
        .await
        .unwrap();
    abgleichen(&elw).await;
    assert_eq!(am_hub(&hub, &k).await, (h, false), "bleibt eigen am Hub");
    assert_eq!(fuehrung_am(&hub, h).await["epoche"], 2);

    // E4: Übergeben lässt sich ein verwahrter Einsatz nicht mehr.
    let (s, v) = common::anfrage_json(
        &hub.app,
        "POST",
        &format!("/api/einsaetze/{h}/fuehrung/uebergeben"),
        &hub.admin,
        Some(&json!({ "an": elw_kennung })),
    )
    .await;
    assert_eq!(s, StatusCode::CONFLICT, "{v}");
    assert_eq!(v["error"], "Einsatz ist verwahrt.", "{v}");
}

/// Trägt am Hub ein eigener Einsatz schon die Nummer, wird vor dem Wechsel der Akte umnummeriert:
/// Sonst stieße der verwahrte Einsatz beim Ende des Spiegels auf die Eindeutigkeit der Nummer.
#[tokio::test]
async fn mit_fuehrung_verwahrt_der_hub_auch_bei_belegter_nummer() {
    let (hub, elw) = mit_fuehrung().await;
    let (e, k) = abgeschlossen_gespiegelt(&hub, &elw).await;
    let (h, _) = am_hub(&hub, &k).await;
    let eigen = common::einsatz_anlegen_mit(&hub.app, &hub.admin, "Eigener Einsatz").await;
    sqlx::query(
        "UPDATE einsatz SET (einsatznummer_intern, nummer_jahr, nummer_lfd) = \
         (SELECT einsatznummer_intern, nummer_jahr, nummer_lfd FROM einsatz WHERE id = ?1) \
         WHERE id = ?2",
    )
    .bind(h)
    .bind(eigen)
    .execute(&hub.pool)
    .await
    .unwrap();
    let nummer: String = eine(
        &hub.pool,
        &format!("SELECT einsatznummer_intern FROM einsatz WHERE id = {h}"),
    )
    .await;

    nachbereitung_vorbei(&elw, e).await;
    abgleichen(&elw).await;

    assert_eq!(
        am_hub(&hub, &k).await,
        (h, false),
        "am Hub ein eigener Einsatz"
    );
    assert!(
        !gibt_es(&elw.pool, &format!("SELECT 1 FROM einsatz WHERE id = {e}")).await,
        "am ELW abgeräumt"
    );
    let neu: String = eine(
        &hub.pool,
        &format!("SELECT einsatznummer_intern FROM einsatz WHERE id = {h}"),
    )
    .await;
    assert_ne!(neu, nummer, "eigene Nummer am Hub");
    assert_eq!(fuehrung_am(&hub, h).await["art"], "verwahrung");
}

#[tokio::test]
async fn ohne_quittung_lehnt_der_elw_die_verwahrung_still_ab_und_sie_gelingt_spaeter() {
    use lifeline_hub::instanz::repo as kopplungen;
    use lifeline_hub::instanz::spiegel::lebensende;

    let (hub, elw) = mit_fuehrung().await;
    let (e, k) = abgeschlossen_gespiegelt(&hub, &elw).await;
    // Nachbereitung bis weit in die Zukunft, am Hub angekommen: Das Angebot unten rechnet mit
    // einem späteren `jetzt`, damit der Hub denselben Stand hat wie der ELW.
    exec(
        &elw.pool,
        &format!("UPDATE einsatz SET nachbereitung_bis = '2999-01-01 00:00:00' WHERE id = {e}"),
    )
    .await;
    abgleichen(&elw).await;

    // Der Hub nimmt an, die Quittung erreicht den ELW nie (Antwort verloren).
    let angebot = {
        let ich: String = eine(&elw.pool, "SELECT kennung FROM instanz_identitaet").await;
        let kid: i64 = eine(&elw.pool, "SELECT id FROM instanz_kopplung").await;
        let mut conn = elw.pool.acquire().await.unwrap();
        let orgs = kopplungen::list_orgs_aktiv(&mut conn, kid).await.unwrap();
        lebensende::faellige_verwahrungen(&mut conn, &ich, &orgs, "3000-01-01 00:00:00")
            .await
            .unwrap()
    };
    assert_eq!(angebot.len(), 1);
    {
        let kid: i64 = eine(&hub.pool, "SELECT id FROM instanz_kopplung").await;
        let kopplung = kopplungen::load_kopplung(&hub.pool, kid).await.unwrap();
        let mut tx = hub.pool.begin().await.unwrap();
        let (q, _) = lebensende::verwahrung_annehmen(
            &mut tx,
            &kopplung,
            &angebot[0],
            &lifeline_hub::zeit::jetzt(),
        )
        .await
        .unwrap()
        .unwrap();
        assert_eq!(q.ergebnis, "angenommen");
        tx.commit().await.unwrap();
    }
    let (h, spiegel) = am_hub(&hub, &k).await;
    assert!(!spiegel);
    assert_eq!(fuehrung_am(&hub, h).await["art"], "verwahrung");

    // Die Meldung bringt die Akte des Hubs vor der Quittung: Der ELW führt still weiter …
    melden(&elw).await;
    let am_elw: (String, String) =
        sqlx::query_as("SELECT art, grund FROM einsatz_fuehrung_verlauf ORDER BY id DESC LIMIT 1")
            .fetch_one(&elw.pool)
            .await
            .unwrap();
    assert_eq!(am_elw.0, "verworfen");
    assert!(
        am_elw.1.starts_with("Verwahrung durch ")
            && am_elw
                .1
                .ends_with(" abgelehnt: Übergabe hier nicht bestätigt"),
        "{am_elw:?}"
    );
    // … und der Hub wird mit der nächsten Meldung wieder Spiegel.
    melden(&elw).await;
    let (h2, spiegel) = am_hub(&hub, &k).await;
    assert_eq!(h2, h);
    assert!(spiegel, "Rückfall zum Spiegel");
    let a = fuehrung_am(&hub, h).await;
    assert_eq!(a["fuehrend"], false, "{a}");
    assert_eq!(a["verwahrt"], false, "{a}");
    let grund = a["verlauf"].as_array().unwrap().last().unwrap()["grund"].clone();
    assert!(
        grund
            .as_str()
            .is_some_and(|g| g.starts_with("Verwahrung von ")
                && g.ends_with(" abgelehnt, der Einsatz liegt dort weiter")),
        "{a}"
    );
    ohne_alarm(&elw).await;
    ohne_alarm(&hub).await;

    // Das nächste Angebot läuft normal durch, ohne doppelte Zeilen.
    nachbereitung_vorbei(&elw, e).await;
    for _ in 0..4 {
        abgleichen(&elw).await;
        if !gibt_es(&elw.pool, &format!("SELECT 1 FROM einsatz WHERE id = {e}")).await {
            break;
        }
    }
    assert!(
        !gibt_es(&elw.pool, &format!("SELECT 1 FROM einsatz WHERE id = {e}")).await,
        "am ELW abgeräumt"
    );
    let (h3, spiegel) = am_hub(&hub, &k).await;
    assert_eq!(h3, h);
    assert!(!spiegel, "verwahrt");
    let texte = etb_texte(&hub.pool, h).await;
    assert_eq!(
        texte.iter().filter(|t| *t == "Lage erkundet").count(),
        1,
        "{texte:?}"
    );
    let a = fuehrung_am(&hub, h).await;
    assert_eq!(a["art"], "verwahrung", "{a}");
    assert_eq!(a["fuehrend"], true, "{a}");
    melden(&elw).await;
    ohne_alarm(&elw).await;
}

#[tokio::test]
async fn ohne_schalter_bleibt_die_verwahrung_ohne_akte() {
    let (hub, elw) = gekoppelt_gemeldet().await;
    let e = common::einsatz_anlegen_mit(&elw.app, &elw.admin, "Hochwasser").await;
    abgleichen(&elw).await;
    abschliessen(&elw, e).await;
    abgleichen(&elw).await;
    let k = kennung(&elw.pool, e).await;
    nachbereitung_vorbei(&elw, e).await;
    abgleichen(&elw).await;
    let (h, spiegel) = am_hub(&hub, &k).await;
    assert!(!spiegel);
    assert!(!gibt_es(&hub.pool, "SELECT 1 FROM einsatz_fuehrung").await);
    // Wird die Führung danach eingeschaltet, trägt die neue Akte die Art `verwahrung`.
    lifeline_hub::instanz::fuehrung::save_schalter(&hub.pool, true)
        .await
        .unwrap();
    let a = fuehrung_am(&hub, h).await;
    assert_eq!(a["art"], "verwahrung", "{a}");
    assert_eq!(a["fuehrend"], true, "{a}");
    assert_eq!(a["verlauf"][0]["art"], "verwahrung", "{a}");
}
