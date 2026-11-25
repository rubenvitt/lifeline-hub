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
