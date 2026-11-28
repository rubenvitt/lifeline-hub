//! Adapterart `matrix` (LLH-2094, Spec Abschnitte 3–5): Client je Anbindung, Verbindungsprüfung,
//! Schlüsselspeicher, eine Anbindung je Org, interne Speicher-Passphrase.
//!
//! Der nachgebaute Homeserver (`MatrixMockServer`) lauscht auf `http://127.0.0.1:…`; das ließe
//! der Zielschutz nie zu. Die Prüfungen gegen ihn laufen deshalb über
//! `Clients::ohne_zielschutz_fuer_tests`, die Routen-Tests mit `https://`-Adressen ohne Netz.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use age::secrecy::SecretString;
use axum::http::StatusCode;
use lifeline_hub::adapter::art::{AdapterArt, Verzeichnis};
use lifeline_hub::adapter::geheimnis::{GeheimnisSchluessel, Geheimnisspeicher};
use lifeline_hub::adapter::matrix::{self, Clients, MatrixFehler, MatrixZiel};
use lifeline_hub::adapter::matrix_art::MatrixArt;
use lifeline_hub::adapter::ziel::AbrufKontext;
use lifeline_hub::adapter::zustand::AdapterFehler;
use lifeline_hub::adapter::Rahmen;
use matrix_sdk::ruma::{device_id, user_id};
use matrix_sdk::test_utils::mocks::MatrixMockServer;
use matrix_sdk::test_utils::wiremock::matchers::{method, path};
use matrix_sdk::test_utils::wiremock::{Mock, ResponseTemplate};
use serde_json::{json, Map, Value};

mod common;
use common::{anfrage_json, login_cookie, setup_mit_state};

const LISTE: &str = "/api/admin/adapter";
const BOT: &str = "@lifeline:example.org";

/// Ein Homeserver mit Schlüssel-Endpunkten, der für `geraet` antwortet. Liefert das Token, das
/// die Schlüssel-Endpunkte kennen.
async fn homeserver(geraet: &str) -> (MatrixMockServer, String) {
    let server = MatrixMockServer::new().await;
    server.mock_crypto_endpoints_preset().await;
    // Ein Client des Mock-Servers meldet sein Token bei den Schlüssel-Endpunkten an; die Prüfung
    // nutzt dasselbe Token mit eigenem Client und Speicher.
    let vorlage = server
        .client_builder_for_crypto_end_to_end(user_id!("@lifeline:example.org"), device_id!("X"))
        .build()
        .await;
    let token = vorlage.access_token().expect("Token des Mock-Clients");
    drop(vorlage);
    whoami(&server, geraet).await;
    server.mock_versions().ok().mount().await;
    server.mock_sync().ok(|_| {}).mount().await;
    (server, token)
}

async fn whoami(server: &MatrixMockServer, geraet: &str) {
    Mock::given(method("GET"))
        .and(path("/_matrix/client/v3/account/whoami"))
        .respond_with(
            ResponseTemplate::new(200)
                .set_body_json(json!({ "user_id": BOT, "device_id": geraet })),
        )
        .mount(server.server())
        .await;
}

fn ziel(server: &MatrixMockServer, token: &str, adapter_id: &str) -> MatrixZiel {
    MatrixZiel {
        homeserver: server.uri().parse().expect("URL des Mock-Servers"),
        access_token: SecretString::from(token.to_string()),
        passphrase: SecretString::from("passphrase-des-speichers".to_string()),
        lan_erlaubt: false,
        adapter_id: adapter_id.to_string(),
    }
}

fn clients(basis: &tempfile::TempDir) -> Arc<Clients> {
    Arc::new(Clients::ohne_zielschutz_fuer_tests(
        basis.path().join("matrix"),
    ))
}

/// Ruft die Art ab wie der Lauf, mit Einstellungen und Geheimnissen der Anbindung.
async fn abrufen(
    art: &MatrixArt,
    server: &MatrixMockServer,
    token: &str,
    adapter_id: &str,
) -> Result<i64, lifeline_hub::adapter::art::Fehlschlag> {
    let mut einstellungen = Map::new();
    einstellungen.insert("homeserver".into(), Value::from(server.uri()));
    let geheimnisse: HashMap<String, SecretString> = [
        ("access_token", token),
        ("speicher_passphrase", "passphrase-des-speichers"),
    ]
    .into_iter()
    .map(|(k, v)| (k.to_string(), SecretString::from(v.to_string())))
    .collect();
    let kontext = AbrufKontext::new(adapter_id, 1, &einstellungen, &geheimnisse, false, false);
    art.abrufen(&kontext).await.map(|u| u.anzahl())
}

#[test]
fn matrix_art_ist_im_verzeichnis() {
    let basis = tempfile::tempdir().unwrap();
    let v = Verzeichnis::produktiv(
        Arc::new(lifeline_hub::drohne::Store::new()),
        clients(&basis),
    );
    let art = v.find("matrix").expect("Art matrix");
    assert_eq!(art.intervall_min_s(), 900);
    assert_eq!(art.intervall_vorschlag_s(), 3600);
    let token = art.plaetze().iter().find(|p| p.name == "access_token");
    assert!(token.is_some_and(|p| p.pflicht && !p.intern));
    let passphrase = art
        .plaetze()
        .iter()
        .find(|p| p.name == "speicher_passphrase");
    assert!(passphrase.is_some_and(|p| p.intern));
}

#[tokio::test]
async fn pruefung_mit_gueltigem_token_meldet_ok_und_geraet() {
    let (server, token) = homeserver("BOT1").await;
    let basis = tempfile::tempdir().unwrap();
    let clients = clients(&basis);

    server
        .mock_authenticated_media_config()
        .ok(matrix_sdk::ruma::uint!(52_428_800))
        .mount()
        .await;

    let befund = matrix::pruefe(&clients, &ziel(&server, &token, "a1"))
        .await
        .expect("Prüfung");
    assert_eq!(befund.user_id, BOT);
    assert_eq!(befund.device_id, "BOT1");
    // Der Homeserver nimmt die Cross-Signing-Schlüssel ohne erneute Anmeldung an.
    assert!(befund.cross_signing, "{befund:?}");
    assert_eq!(befund.upload_max, Some(52_428_800));
    assert_eq!(
        clients.befund("a1").await.map(|b| b.device_id),
        Some("BOT1".into())
    );
    // Der Schlüsselspeicher liegt im Verzeichnis der Anbindung.
    assert!(basis
        .path()
        .join("matrix/a1/matrix-sdk-crypto.sqlite3")
        .is_file());

    // Der Lauf meldet Erfolg ohne Übernahme: der Zustand wird `ok`.
    let art = MatrixArt::new(clients.clone());
    assert_eq!(abrufen(&art, &server, &token, "a1").await, Ok(0));
}

/// 403 oder 404 des eigenen `keys/query` beim ersten Öffnen ist ein verweigerter
/// Schlüsselabgleich (Eingriff nötig), weder „kein Zutritt zum Raum“ noch „Antwort ungültig“
/// (LLH-2145).
#[tokio::test]
async fn verweigerter_schluesselabgleich_ist_abgelehnt() {
    for status in [403_u16, 404] {
        let server = MatrixMockServer::new().await;
        whoami(&server, "BOT1").await;
        Mock::given(method("POST"))
            .and(path("/_matrix/client/v3/keys/query"))
            .respond_with(ResponseTemplate::new(status).set_body_json(json!({
                "errcode": if status == 403 { "M_FORBIDDEN" } else { "M_NOT_FOUND" },
                "error": "nein"
            })))
            .mount(server.server())
            .await;
        let basis = tempfile::tempdir().unwrap();
        let clients = clients(&basis);

        let f = matrix::pruefe(&clients, &ziel(&server, "t", "a1"))
            .await
            .unwrap_err();
        assert_eq!(f, MatrixFehler::SchluesselabgleichVerweigert, "{status}");
        assert_eq!(AdapterFehler::from(f), AdapterFehler::Abgelehnt);
        // Kein Speicher für ein Gerät, dessen Schlüsselstand unbekannt ist.
        assert!(!basis.path().join("matrix/a1").exists());
    }
}

#[tokio::test]
async fn ungueltiges_token_ist_abgelehnt() {
    let server = MatrixMockServer::new().await;
    Mock::given(method("GET"))
        .and(path("/_matrix/client/v3/account/whoami"))
        .respond_with(ResponseTemplate::new(401).set_body_json(json!({
            "errcode": "M_UNKNOWN_TOKEN",
            "error": "Unknown token",
            "soft_logout": false
        })))
        .mount(server.server())
        .await;
    let basis = tempfile::tempdir().unwrap();
    let clients = clients(&basis);

    let f = matrix::pruefe(&clients, &ziel(&server, "falsch", "a1"))
        .await
        .unwrap_err();
    assert_eq!(f, MatrixFehler::Token);
    assert_eq!(AdapterFehler::from(f), AdapterFehler::Abgelehnt);

    let art = MatrixArt::new(clients.clone());
    let f = abrufen(&art, &server, "falsch", "a1").await.unwrap_err();
    assert_eq!(f.art, AdapterFehler::Abgelehnt);
    assert_eq!(f.status, Some(401));
    // Ohne gültiges Token entsteht kein Speicher.
    assert!(!basis.path().join("matrix/a1").exists());
}

#[tokio::test]
async fn speicher_eines_anderen_geraets_meldet_schluessel_passen_nicht() {
    let basis = tempfile::tempdir().unwrap();
    let (server1, token1) = homeserver("BOT1").await;
    matrix::pruefe(&clients(&basis), &ziel(&server1, &token1, "a1"))
        .await
        .expect("Speicher für BOT1 angelegt");

    // Nach einem Neustart (neue Clients, dasselbe Verzeichnis) gehört das Token zu BOT2.
    let (server2, token2) = homeserver("BOT2").await;
    let neu = clients(&basis);
    let f = matrix::pruefe(&neu, &ziel(&server2, &token2, "a1"))
        .await
        .unwrap_err();
    assert_eq!(f, MatrixFehler::SchluesselPassenNicht);
    assert_eq!(AdapterFehler::from(f), AdapterFehler::SchluesselPassenNicht);
    // Der fremde Speicher bleibt, wie er war: nichts wurde mit BOT2 geöffnet.
    assert!(basis
        .path()
        .join("matrix/a1/matrix-sdk-crypto.sqlite3")
        .is_file());

    // Auch ein schon offener Client merkt das Gerät, das nicht mehr passt.
    let (server3, token3) = homeserver("BOT1").await;
    let offen = clients(&basis);
    matrix::pruefe(&offen, &ziel(&server3, &token3, "a1"))
        .await
        .expect("BOT1 passt");
    let f = matrix::pruefe(&offen, &ziel(&server2, &token2, "a1"))
        .await
        .unwrap_err();
    assert_eq!(f, MatrixFehler::SchluesselPassenNicht);
}

#[tokio::test]
async fn zugriffe_auf_eine_anbindung_laufen_nacheinander() {
    let (server, token) = homeserver("BOT1").await;
    let basis = tempfile::tempdir().unwrap();
    let clients = clients(&basis);
    let ziel = ziel(&server, &token, "a1");
    let spur = Arc::new(Mutex::new(Vec::<&'static str>::new()));

    let zugriff = |name: [&'static str; 2]| {
        let spur = spur.clone();
        let clients = clients.clone();
        let ziel = &ziel;
        async move {
            clients
                .mit_client(ziel, move |_client| {
                    Box::pin(async move {
                        spur.lock().unwrap().push(name[0]);
                        tokio::time::sleep(Duration::from_millis(150)).await;
                        spur.lock().unwrap().push(name[1]);
                    })
                })
                .await
                .expect("Zugriff")
        }
    };
    tokio::time::timeout(Duration::from_secs(30), async {
        tokio::join!(zugriff(["a an", "a aus"]), zugriff(["b an", "b aus"]))
    })
    .await
    .expect("beide Zugriffe enden");

    let spur = spur.lock().unwrap().clone();
    assert!(
        spur == ["a an", "a aus", "b an", "b aus"] || spur == ["b an", "b aus", "a an", "a aus"],
        "nicht verschränkt: {spur:?}"
    );
}

// --- Routen ---------------------------------------------------------------------------------

async fn setup() -> (axum::Router, sqlx::SqlitePool, String, tempfile::TempDir) {
    let basis = tempfile::tempdir().unwrap();
    let clients = clients(&basis);
    let rahmen = Rahmen::mit_matrix(
        Geheimnisspeicher::new(Some(GeheimnisSchluessel::generate())),
        Verzeichnis::new(vec![Arc::new(MatrixArt::new(clients.clone()))]),
        clients,
    );
    let (app, pool) = setup_mit_state(|s| s.adapter = rahmen).await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    (app, pool, admin, basis)
}

async fn anlegen(app: &axum::Router, admin: &str, homeserver: &str) -> (StatusCode, Value) {
    let body = json!({
        "art": "matrix",
        "name": "Matrix",
        "einstellungen": { "homeserver": homeserver, "anzeigename": "Lifeline Hub" }
    });
    anfrage_json(app, "POST", LISTE, admin, Some(&body)).await
}

#[tokio::test]
async fn zweite_matrix_anbindung_je_org_ist_422() {
    let (app, _pool, admin, _basis) = setup().await;
    let (s, a) = anlegen(&app, &admin, "https://matrix.example.org").await;
    assert_eq!(s, StatusCode::CREATED, "{a}");
    assert_eq!(a["intervall_s"], 3600);
    let (s, _) = anlegen(&app, &admin, "https://matrix.example.org").await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY);
}

#[tokio::test]
async fn homeserver_im_gesperrten_netz_wird_abgelehnt() {
    let (app, _pool, admin, _basis) = setup().await;
    let (s, e) = anlegen(&app, &admin, "https://127.0.0.1").await;
    assert_eq!(s, StatusCode::BAD_REQUEST, "{e}");
    let (s, _) = anlegen(&app, &admin, "https://192.168.1.5").await;
    assert_eq!(s, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn anlegen_erzeugt_speicher_passphrase_und_zeigt_sie_nie() {
    let (app, pool, admin, _basis) = setup().await;
    let (s, a) = anlegen(&app, &admin, "https://matrix.example.org").await;
    assert_eq!(s, StatusCode::CREATED, "{a}");
    let id = a["id"].as_str().unwrap().to_string();

    let (passphrasen,): (i64,) =
        sqlx::query_as("SELECT COUNT(*) FROM adapter_geheimnis WHERE adapter_id = ? AND name = ?")
            .bind(&id)
            .bind("speicher_passphrase")
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(passphrasen, 1, "Passphrase beim Anlegen erzeugt");

    let (s, a) = anfrage_json(&app, "GET", &format!("{LISTE}/{id}"), &admin, None).await;
    assert_eq!(s, StatusCode::OK);
    let plaetze: Vec<&str> = a["geheimnisse"]
        .as_array()
        .unwrap()
        .iter()
        .map(|g| g["name"].as_str().unwrap())
        .collect();
    assert_eq!(plaetze, ["access_token"]);
    assert!(!a.to_string().contains("speicher_passphrase"), "{a}");

    let (_, liste) = anfrage_json(&app, "GET", LISTE, &admin, None).await;
    assert!(
        !liste.to_string().contains("speicher_passphrase"),
        "{liste}"
    );

    // Setzen oder Entfernen von außen gibt es nicht.
    let pfad = format!("{LISTE}/{id}/secrets/speicher_passphrase");
    let (s, _) = anfrage_json(&app, "PUT", &pfad, &admin, Some(&json!({ "wert": "x" }))).await;
    assert_eq!(s, StatusCode::BAD_REQUEST);
    let (s, _) = anfrage_json(&app, "DELETE", &pfad, &admin, None).await;
    assert_eq!(s, StatusCode::BAD_REQUEST);
}

// --- Lebenszyklus des Speichers (Spec Abschnitt 4) --------------------------------------------

/// Die gespeicherte Passphrase einer Anbindung (Chiffrat), `None` ohne Zeile.
async fn passphrase_chiffrat(pool: &sqlx::SqlitePool, id: &str) -> Option<Vec<u8>> {
    sqlx::query_scalar("SELECT chiffrat FROM adapter_geheimnis WHERE adapter_id = ? AND name = ?")
        .bind(id)
        .bind("speicher_passphrase")
        .fetch_optional(pool)
        .await
        .unwrap()
}

async fn hat_geheimnis(pool: &sqlx::SqlitePool, id: &str, platz: &str) -> bool {
    let (n,): (i64,) =
        sqlx::query_as("SELECT COUNT(*) FROM adapter_geheimnis WHERE adapter_id = ? AND name = ?")
            .bind(id)
            .bind(platz)
            .fetch_one(pool)
            .await
            .unwrap();
    n > 0
}

/// Legt ein Speicherverzeichnis an, wie es eine Prüfung hinterlässt.
fn speicher_anlegen(basis: &tempfile::TempDir, id: &str) -> std::path::PathBuf {
    let dir = basis.path().join("matrix").join(id);
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(dir.join("matrix-sdk-crypto.sqlite3"), b"alt").unwrap();
    std::fs::write(
        dir.join(matrix::GERAET_DATEI),
        br#"{"user_id":"@lifeline:example.org","device_id":"ALT"}"#,
    )
    .unwrap();
    dir
}

async fn token_setzen(app: &axum::Router, admin: &str, id: &str, wert: &str) {
    let (s, e) = anfrage_json(
        app,
        "PUT",
        &format!("{LISTE}/{id}/secrets/access_token"),
        admin,
        Some(&json!({ "wert": wert })),
    )
    .await;
    assert_eq!(s, StatusCode::NO_CONTENT, "{e}");
}

#[tokio::test]
async fn neues_token_loescht_speicherverzeichnis() {
    let (app, pool, admin, basis) = setup().await;
    let (s, a) = anlegen(&app, &admin, "https://matrix.example.org").await;
    assert_eq!(s, StatusCode::CREATED, "{a}");
    let id = a["id"].as_str().unwrap().to_string();
    token_setzen(&app, &admin, &id, "erstes-token").await;
    let dir = speicher_anlegen(&basis, &id);
    let passphrase_vorher = passphrase_chiffrat(&pool, &id).await.expect("Passphrase");

    token_setzen(&app, &admin, &id, "neues-token").await;

    assert!(!dir.exists(), "altes Verzeichnis gelöscht");
    let passphrase_nachher = passphrase_chiffrat(&pool, &id).await.expect("Passphrase");
    assert_ne!(passphrase_vorher, passphrase_nachher, "neue Passphrase");
}

#[tokio::test]
async fn geaenderter_homeserver_loescht_speicherverzeichnis_und_token() {
    let (app, pool, admin, basis) = setup().await;
    let (s, a) = anlegen(&app, &admin, "https://matrix.example.org").await;
    assert_eq!(s, StatusCode::CREATED, "{a}");
    let id = a["id"].as_str().unwrap().to_string();
    token_setzen(&app, &admin, &id, "erstes-token").await;
    let dir = speicher_anlegen(&basis, &id);
    let passphrase_vorher = passphrase_chiffrat(&pool, &id).await.expect("Passphrase");

    let (s, a) = anfrage_json(
        &app,
        "PATCH",
        &format!("{LISTE}/{id}"),
        &admin,
        Some(&json!({ "einstellungen": { "homeserver": "https://matrix.invalid" } })),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{a}");

    assert!(!dir.exists(), "altes Verzeichnis gelöscht");
    assert!(
        !hat_geheimnis(&pool, &id, "access_token").await,
        "Token entfernt"
    );
    let passphrase_nachher = passphrase_chiffrat(&pool, &id)
        .await
        .expect("neue Passphrase im selben Schreiben");
    assert_ne!(passphrase_vorher, passphrase_nachher);
    // Die Spur nennt nur, was der Admin gesetzt hatte.
    let (n,): (i64,) = sqlx::query_as(
        "SELECT COUNT(*) FROM admin_audit WHERE aktion = 'adapter_geheimnis_entfernt' \
         AND detail LIKE '%speicher_passphrase%'",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(n, 0, "kein Spur-Eintrag für den internen Platz");

    // Mit neuem Token fehlt der nächsten Prüfung kein Geheimnis.
    token_setzen(&app, &admin, &id, "token-fuer-neuen-server").await;
    let (s, p) = anfrage_json(&app, "POST", &format!("{LISTE}/{id}/check"), &admin, None).await;
    assert_eq!(s, StatusCode::OK, "{p}");
    assert_ne!(p["fehler_art"], "geheimnis_fehlt", "{p}");
}

#[tokio::test]
async fn geloeschte_anbindung_loescht_speicherverzeichnis() {
    let (app, _pool, admin, basis) = setup().await;
    let (s, a) = anlegen(&app, &admin, "https://matrix.example.org").await;
    assert_eq!(s, StatusCode::CREATED, "{a}");
    let id = a["id"].as_str().unwrap().to_string();
    let dir = speicher_anlegen(&basis, &id);

    let (s, _) = anfrage_json(&app, "DELETE", &format!("{LISTE}/{id}"), &admin, None).await;
    assert_eq!(s, StatusCode::NO_CONTENT);
    assert!(!dir.exists(), "Verzeichnis gelöscht");
}

#[tokio::test]
async fn restore_ohne_verzeichnis_meldet_schluessel_passen_nicht() {
    let (server, token) = homeserver("BOT1").await;
    let vorher = tempfile::tempdir().unwrap();
    matrix::pruefe(&clients(&vorher), &ziel(&server, &token, "a1"))
        .await
        .expect("Speicher für BOT1 angelegt, Schlüssel hochgeladen");

    // Nach einem Restore fehlt das Verzeichnis; der Server kennt die Schlüssel von BOT1.
    let nachher = tempfile::tempdir().unwrap();
    let f = matrix::pruefe(&clients(&nachher), &ziel(&server, &token, "a1"))
        .await
        .unwrap_err();
    assert_eq!(f, MatrixFehler::SchluesselPassenNicht);
    // Kein neuer Speicher für ein Gerät, dessen Schlüssel anderswo liegen.
    assert!(!nachher.path().join("matrix/a1").exists());
}

#[tokio::test]
async fn verwerfen_wartet_auf_den_alten_client_und_die_naechste_pruefung_gelingt() {
    let basis = tempfile::tempdir().unwrap();
    let clients = clients(&basis);
    let (server1, token1) = homeserver("BOT1").await;
    let ziel1 = ziel(&server1, &token1, "a1");
    matrix::pruefe(&clients, &ziel1).await.expect("BOT1");

    // Ein Hintergrund-Task (wie die des SDK) hält den alten Client noch kurz.
    let spur = Arc::new(Mutex::new(Vec::<&'static str>::new()));
    let schwach = {
        let spur = spur.clone();
        clients
            .mit_client(&ziel1, move |client| {
                let halter = client.clone();
                tokio::spawn(async move {
                    tokio::time::sleep(Duration::from_millis(300)).await;
                    spur.lock().unwrap().push("alter Client frei");
                    drop(halter);
                });
                Box::pin(async move { client.downgrade() })
            })
            .await
            .expect("Zugriff")
    };

    let begonnen = std::time::Instant::now();
    clients.verwerfen("a1").await;
    spur.lock().unwrap().push("verworfen");
    assert_eq!(schwach.strong_count(), 0, "kein alter Client lebt mehr");
    assert_eq!(*spur.lock().unwrap(), ["alter Client frei", "verworfen"]);
    assert!(begonnen.elapsed() < Duration::from_secs(5));
    assert!(!basis.path().join("matrix/a1").exists());
    assert_eq!(clients.befund("a1").await, None);

    // Gleich danach: neues Token (neues Gerät) auf derselben Anbindung.
    let (server2, token2) = homeserver("BOT2").await;
    let befund = matrix::pruefe(&clients, &ziel(&server2, &token2, "a1"))
        .await
        .expect("Prüfung nach dem Verwerfen");
    assert_eq!(befund.device_id, "BOT2");
}

#[tokio::test]
async fn verwerfen_ohne_client_schliesst_den_naechsten_zugriff_ein() {
    // Wer nach dem Vormerken zuerst an den Client kommt, verwirft vorher: auch wenn das
    // Verwerfen selbst nicht abgewartet wurde.
    let basis = tempfile::tempdir().unwrap();
    let clients = clients(&basis);
    let dir = speicher_anlegen(&basis, "a1");
    drop(clients.verwerfen("a1"));
    let (server, token) = homeserver("BOT1").await;
    let befund = matrix::pruefe(&clients, &ziel(&server, &token, "a1"))
        .await
        .expect("frischer Speicher");
    assert_eq!(befund.device_id, "BOT1");
    let merk = std::fs::read_to_string(dir.join(matrix::GERAET_DATEI)).unwrap();
    assert!(merk.contains("BOT1"), "{merk}");
}

#[tokio::test]
async fn befund_wartet_nicht_auf_einen_laufenden_zugriff() {
    let (server, token) = homeserver("BOT1").await;
    let basis = tempfile::tempdir().unwrap();
    let clients = clients(&basis);
    let ziel = ziel(&server, &token, "a1");
    matrix::pruefe(&clients, &ziel).await.expect("Prüfung");

    let (los_tx, los_rx) = tokio::sync::oneshot::channel::<()>();
    let (frei_tx, frei_rx) = tokio::sync::oneshot::channel::<()>();
    let langer = {
        let clients = clients.clone();
        let ziel = MatrixZiel {
            homeserver: ziel.homeserver.clone(),
            access_token: ziel.access_token.clone(),
            passphrase: ziel.passphrase.clone(),
            lan_erlaubt: ziel.lan_erlaubt,
            adapter_id: ziel.adapter_id.clone(),
        };
        tokio::spawn(async move {
            clients
                .mit_client(&ziel, move |_client| {
                    Box::pin(async move {
                        los_tx.send(()).unwrap();
                        let _ = frei_rx.await;
                    })
                })
                .await
                .expect("Zugriff")
        })
    };
    los_rx.await.unwrap();
    let befund = tokio::time::timeout(Duration::from_millis(500), clients.befund("a1"))
        .await
        .expect("Befund ohne Warten auf den Zugriff");
    assert_eq!(befund.map(|b| b.device_id), Some("BOT1".into()));
    frei_tx.send(()).unwrap();
    langer.await.unwrap();
}

#[tokio::test]
async fn pruefung_endet_nach_der_frist() {
    let (server, token) = homeserver("BOT1").await;
    let basis = tempfile::tempdir().unwrap();
    let clients = clients(&basis);
    let ziel = ziel(&server, &token, "a1");
    matrix::pruefe(&clients, &ziel).await.expect("Prüfung");

    // Ein langer Versand hält den Client; die Uhr läuft ab hier nur virtuell.
    tokio::time::pause();
    let (los_tx, los_rx) = tokio::sync::oneshot::channel::<()>();
    let langer = {
        let clients = clients.clone();
        let ziel = MatrixZiel {
            homeserver: ziel.homeserver.clone(),
            access_token: ziel.access_token.clone(),
            passphrase: ziel.passphrase.clone(),
            lan_erlaubt: ziel.lan_erlaubt,
            adapter_id: ziel.adapter_id.clone(),
        };
        tokio::spawn(async move {
            clients
                .mit_client(&ziel, move |_client| {
                    Box::pin(async move {
                        los_tx.send(()).unwrap();
                        tokio::time::sleep(Duration::from_secs(600)).await;
                    })
                })
                .await
        })
    };
    los_rx.await.unwrap();
    let begonnen = tokio::time::Instant::now();
    let f = matrix::pruefe(&clients, &ziel).await.unwrap_err();
    assert_eq!(f, MatrixFehler::Zeit);
    let dauer = begonnen.elapsed();
    assert!(
        dauer >= matrix::PRUEF_ZEITLIMIT
            && dauer < matrix::PRUEF_ZEITLIMIT + Duration::from_secs(1),
        "{dauer:?}"
    );
    assert!(matrix::PRUEF_ZEITLIMIT < lifeline_hub::zulassung::REQUEST_BUDGET);
    langer.abort();
}

#[tokio::test]
async fn abgebrochenes_verwerfen_loescht_das_verzeichnis_trotzdem() {
    let basis = tempfile::tempdir().unwrap();
    let clients = clients(&basis);
    let (server1, token1) = homeserver("BOT1").await;
    let ziel1 = ziel(&server1, &token1, "a1");
    matrix::pruefe(&clients, &ziel1).await.expect("BOT1");

    // Ein Hintergrund-Task hält den alten Client länger, als der Aufrufer wartet.
    clients
        .mit_client(&ziel1, |client| {
            let halter = client.clone();
            tokio::spawn(async move {
                tokio::time::sleep(Duration::from_millis(400)).await;
                drop(halter);
            });
            Box::pin(async {})
        })
        .await
        .expect("Zugriff");
    let abgebrochen =
        tokio::time::timeout(Duration::from_millis(50), clients.verwerfen("a1")).await;
    assert!(
        abgebrochen.is_err(),
        "Verwerfen wartet noch auf den alten Client"
    );

    // Der nächste Zugriff findet keinen Speicher des alten Geräts mehr.
    let (server2, token2) = homeserver("BOT2").await;
    let befund = matrix::pruefe(&clients, &ziel(&server2, &token2, "a1"))
        .await
        .expect("Prüfung nach abgebrochenem Verwerfen");
    assert_eq!(befund.device_id, "BOT2");
    let merk =
        std::fs::read_to_string(basis.path().join("matrix/a1").join(matrix::GERAET_DATEI)).unwrap();
    assert!(merk.contains("BOT2"), "{merk}");
}

#[tokio::test]
async fn verwerfen_schliesst_den_speicher_auch_wenn_der_alte_client_noch_gehalten_wird() {
    use matrix_sdk::store::StateStoreDataKey;

    let basis = tempfile::tempdir().unwrap();
    let clients = clients(&basis);
    let (server, token) = homeserver("BOT1").await;
    let ziel1 = ziel(&server, &token, "a1");
    matrix::pruefe(&clients, &ziel1).await.expect("BOT1");

    // Ein Hintergrund-Task hält den alten Client und liest weiter aus seinem Speicher. Sobald
    // das Verwerfen läuft, muss der Speicher zu sein, nicht erst, wenn der Halter loslässt:
    // sonst greift der alte Client noch auf Dateien zu, die fallen oder neu entstehen.
    let (tx, rx) = tokio::sync::oneshot::channel();
    clients
        .mit_client(&ziel1, |client| {
            let halter = client.clone();
            tokio::spawn(async move {
                let frist = tokio::time::Instant::now() + Duration::from_secs(5);
                let geschlossen = loop {
                    let lesen = halter
                        .state_store()
                        .get_kv_data(StateStoreDataKey::SyncToken)
                        .await;
                    if lesen.is_err() {
                        break true;
                    }
                    if tokio::time::Instant::now() >= frist {
                        break false;
                    }
                    tokio::time::sleep(Duration::from_millis(10)).await;
                };
                drop(halter);
                let _ = tx.send(geschlossen);
            });
            Box::pin(async {})
        })
        .await
        .expect("Zugriff");

    let (_, geschlossen) = tokio::join!(clients.verwerfen("a1"), rx);
    assert!(
        geschlossen.expect("Halter meldet sich"),
        "der Speicher des alten Clients blieb offen, solange er gehalten wurde"
    );
    assert!(!basis.path().join("matrix/a1").exists());
}

/// Ein zweites Verwerfen, während das erste noch räumt, erledigt derselbe Halter, bevor er einen
/// Speicher öffnet: nie fällt danach ein Speicher, den ein Client schon benutzt hat (der Server
/// kennt dann seine Schlüssel, und ein neuer Speicher passte nicht mehr).
#[tokio::test]
async fn zweites_verwerfen_waehrend_des_raeumens_raeumt_vor_dem_oeffnen() {
    let basis = tempfile::tempdir().unwrap();
    let clients = clients(&basis);
    let (server1, token1) = homeserver("BOT1").await;
    let ziel1 = ziel(&server1, &token1, "a1");
    matrix::pruefe(&clients, &ziel1).await.expect("BOT1");

    // Ein Hintergrund-Task hält den alten Client, das Räumen wartet darauf.
    clients
        .mit_client(&ziel1, |client| {
            let halter = client.clone();
            tokio::spawn(async move {
                tokio::time::sleep(Duration::from_millis(400)).await;
                drop(halter);
            });
            Box::pin(async {})
        })
        .await
        .expect("Zugriff");
    drop(clients.verwerfen("a1"));

    // Ein Versand mit dem neuen Token räumt zuerst und benutzt dann seinen Speicher (Sync lädt
    // die Geräteschlüssel hoch).
    let (server2, token2) = homeserver("BOT2").await;
    let versand = {
        let clients = clients.clone();
        let ziel2 = ziel(&server2, &token2, "a1");
        tokio::spawn(async move {
            clients
                .mit_client(&ziel2, |client| {
                    Box::pin(async move {
                        client
                            .sync_once(matrix_sdk::config::SyncSettings::default())
                            .await
                            .map(|_| ())
                    })
                })
                .await
        })
    };
    tokio::time::sleep(Duration::from_millis(100)).await;
    assert!(!versand.is_finished(), "das Räumen wartet noch");
    drop(clients.verwerfen("a1"));
    versand
        .await
        .unwrap()
        .expect("Zugriff")
        .expect("Sync mit dem neuen Speicher");

    let befund = matrix::pruefe(&clients, &ziel(&server2, &token2, "a1"))
        .await
        .expect("der benutzte Speicher bleibt");
    assert_eq!(befund.device_id, "BOT2");
}

/// Das Setzen des Anzeigenamens nach der Prüfung bleibt in deren Frist: wartet es auf einen
/// langen Versand, endet „Verbindung prüfen“ trotzdem vor dem Zeitbudget eines Requests.
#[tokio::test]
async fn anzeigename_bleibt_in_der_frist_der_pruefung() {
    let server = MatrixMockServer::new().await;
    server.mock_crypto_endpoints_preset().await;
    let vorlage = server
        .client_builder_for_crypto_end_to_end(user_id!("@lifeline:example.org"), device_id!("X"))
        .build()
        .await;
    let token = vorlage.access_token().expect("Token des Mock-Clients");
    drop(vorlage);
    // `whoami` antwortet langsam: in diesem Fenster hält die Prüfung den Client, und ein Versand
    // stellt sich hinter ihr an.
    Mock::given(method("GET"))
        .and(path("/_matrix/client/v3/account/whoami"))
        .respond_with(
            ResponseTemplate::new(200)
                .set_body_json(json!({ "user_id": BOT, "device_id": "BOT1" }))
                .set_delay(Duration::from_millis(300)),
        )
        .mount(server.server())
        .await;
    server.mock_versions().ok().mount().await;
    server.mock_sync().ok(|_| {}).mount().await;

    let basis = tempfile::tempdir().unwrap();
    let clients = clients(&basis);
    let art = Arc::new(MatrixArt::new(clients.clone()));
    let pruefung = {
        let art = art.clone();
        let uri = server.uri();
        let token = token.clone();
        tokio::spawn(async move {
            let mut einstellungen = Map::new();
            einstellungen.insert("homeserver".into(), Value::from(uri));
            einstellungen.insert("anzeigename".into(), Value::from("Lifeline Hub"));
            let geheimnisse: HashMap<String, SecretString> = [
                ("access_token", token.as_str()),
                ("speicher_passphrase", "passphrase-des-speichers"),
            ]
            .into_iter()
            .map(|(k, v)| (k.to_string(), SecretString::from(v.to_string())))
            .collect();
            let kontext = AbrufKontext::new("a1", 1, &einstellungen, &geheimnisse, false, false);
            let begonnen = tokio::time::Instant::now();
            let ergebnis = art.abrufen(&kontext).await.map(|u| u.anzahl());
            (ergebnis, begonnen.elapsed())
        })
    };
    tokio::time::sleep(Duration::from_millis(100)).await;
    let (los_tx, los_rx) = tokio::sync::oneshot::channel::<()>();
    let langer = {
        let clients = clients.clone();
        let ziel = ziel(&server, &token, "a1");
        tokio::spawn(async move {
            clients
                .mit_client(&ziel, move |_client| {
                    Box::pin(async move {
                        los_tx.send(()).unwrap();
                        tokio::time::sleep(Duration::from_secs(600)).await;
                    })
                })
                .await
        })
    };
    // Der Versand hat den Client nach der Prüfung; ab hier läuft die Uhr nur virtuell.
    los_rx.await.unwrap();
    tokio::time::pause();
    let (ergebnis, dauer) = pruefung.await.unwrap();
    assert_eq!(ergebnis, Ok(0), "der Name ist kein Fehler der Anbindung");
    assert!(
        dauer < matrix::PRUEF_ZEITLIMIT + Duration::from_secs(1),
        "{dauer:?}"
    );
    langer.abort();
}
