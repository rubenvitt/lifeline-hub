//! Zustellung in Matrix-Räume (LLH-2094, Spec
//! `docs/superpowers/specs/2026-11-25-ntaizave-ausgang-matrix-design.md`, Abschnitte 6 und 7): der
//! echte `MatrixZusteller` mit dem echten SDK-Client gegen einen nachgebauten Homeserver
//! (`MatrixMockServer`), über den Lauf des Ausgangskorbs. Raum auflösen, beitreten, Text und
//! Anlagen mit fester Transaktions-ID, gemerkte Teile, Fehlerzuordnung und E2EE.
//!
//! Der Mock lauscht auf `http://127.0.0.1:…`; das ließe der Zielschutz nie zu (auch nicht als
//! Einstellung der Anbindung). Die Anbindung trägt deshalb `https://matrix.example.org`, und das
//! Doppel [`ZumMock`] setzt beim Zustellen die Adresse des Mocks ein und gibt den Auftrag an den
//! echten Zusteller mit Clients ohne Zielschutz weiter.

use std::sync::Arc;
use std::time::Duration;

use axum::http::StatusCode;
use chrono::{DateTime, Utc};
use futures::future::BoxFuture;
use lifeline_hub::adapter::matrix::{self, Clients, MatrixZiel};
use lifeline_hub::adapter::Rahmen;
use lifeline_hub::ausgang::lauf::{self, Fehlschlag, Versandauftrag, Versandzugang, Zusteller};
use lifeline_hub::ausgang::zusteller::{MatrixZusteller, Zustellt};
use lifeline_hub::ausgang::{AusgangFehler, VersandZeile, VersandZustand};
use lifeline_hub::live::LiveHub;
use matrix_sdk::ruma::{device_id, user_id, RoomVersionId};
use matrix_sdk::test_utils::mocks::MatrixMockServer;
use matrix_sdk::test_utils::wiremock::matchers::{method, path, path_regex};
use matrix_sdk::test_utils::wiremock::{Mock, MockGuard, Request, ResponseTemplate};
use matrix_sdk_test::{event_factory::EventFactory, JoinedRoomBuilder};
use serde_json::{json, Value};

mod adapter_testart;
mod common;
use common::{anfrage, anfrage_json, einsatz_anlegen_mit, login_cookie, multipart_post, png_bytes};

const BOT: &str = "@lifeline:example.org";
const RAUM: &str = "!lage:example.org";
const ALIAS: &str = "#lage:example.org";
const STELLE: &str = "Leitstelle Nord";

/// Gibt den Auftrag mit der Adresse des Mocks an den echten Zusteller weiter.
struct ZumMock {
    homeserver: String,
    echt: MatrixZusteller,
}

impl Zusteller for ZumMock {
    fn zustellen<'a>(
        &'a self,
        auftrag: &'a Versandauftrag<'a>,
    ) -> BoxFuture<'a, Result<Zustellt, Fehlschlag>> {
        Box::pin(async move {
            let mut einstellungen = auftrag.zugang.einstellungen.clone();
            einstellungen.insert("homeserver".into(), Value::from(self.homeserver.clone()));
            let zugang = Versandzugang {
                einstellungen,
                geheimnisse: auftrag.zugang.geheimnisse.clone(),
                lan_erlaubt: auftrag.zugang.lan_erlaubt,
                adapter_id: auftrag.zugang.adapter_id.clone(),
            };
            let umgeleitet = Versandauftrag {
                zugang: &zugang,
                ..*auftrag
            };
            self.echt.zustellen(&umgeleitet).await
        })
    }
}

/// Ein nachgebauter Homeserver mit Schlüssel-Endpunkten, `whoami` für das Gerät `BOT1`,
/// Medien-Grenze 50 MiB, Beitreten, Alias, Senden und Hochladen. Der Raum ist (ohne
/// [`raum_im_sync`]) dem Client unbekannt.
struct Homeserver {
    server: MatrixMockServer,
    token: String,
}

async fn homeserver() -> Homeserver {
    let server = MatrixMockServer::new().await;
    server.mock_crypto_endpoints_preset().await;
    // Ein Client des Mocks meldet sein Token bei den Schlüssel-Endpunkten an; der Zusteller nutzt
    // dasselbe Token mit eigenem Client und Speicher.
    let vorlage = server
        .client_builder_for_crypto_end_to_end(user_id!("@lifeline:example.org"), device_id!("X"))
        .build()
        .await;
    let token = vorlage.access_token().expect("Token des Mock-Clients");
    drop(vorlage);
    Mock::given(method("GET"))
        .and(path("/_matrix/client/v3/account/whoami"))
        .respond_with(
            ResponseTemplate::new(200)
                .set_body_json(json!({ "user_id": BOT, "device_id": "BOT1" })),
        )
        .mount(server.server())
        .await;
    server.mock_versions().ok().mount().await;
    server
        .mock_authenticated_media_config()
        .ok(matrix_sdk::ruma::uint!(52_428_800))
        .mount()
        .await;
    Mock::given(method("GET"))
        .and(path_regex(r"^/_matrix/client/v3/directory/room/"))
        .respond_with(
            ResponseTemplate::new(200)
                .set_body_json(json!({ "room_id": RAUM, "servers": ["example.org"] })),
        )
        .mount(server.server())
        .await;
    Mock::given(method("POST"))
        .and(path_regex(r"^/_matrix/client/v3/join/"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({ "room_id": RAUM })))
        .mount(server.server())
        .await;
    // Ein unverschlüsselter Raum: kein `m.room.encryption` (ein verschlüsselter bringt ihn im Sync).
    Mock::given(method("GET"))
        .and(path_regex(
            r"^/_matrix/client/v3/rooms/.*/state/m\.room\.encryption",
        ))
        .respond_with(ResponseTemplate::new(404).set_body_json(json!({
            "errcode": "M_NOT_FOUND", "error": "Event not found."
        })))
        .mount(server.server())
        .await;
    Mock::given(method("POST"))
        .and(path_regex(r"^/_matrix/media/v3/upload"))
        .respond_with(
            ResponseTemplate::new(200)
                .set_body_json(json!({ "content_uri": "mxc://example.org/anlage" })),
        )
        .mount(server.server())
        .await;
    Homeserver { server, token }
}

impl Homeserver {
    /// Jeder Sync bringt den Raum mit, in dem der Bot (allein) Mitglied ist; `verschluesselt` mit
    /// `m.room.encryption`.
    async fn raum_im_sync(&self, verschluesselt: bool) -> [MockGuard; 2] {
        let raum = matrix_sdk::ruma::room_id!("!lage:example.org");
        let bot = user_id!("@lifeline:example.org");
        let f = EventFactory::new().room(raum).sender(bot);
        let mut builder = JoinedRoomBuilder::new(raum)
            .add_state_event(f.create(bot, RoomVersionId::V10))
            .add_state_event(f.member(bot));
        if verschluesselt {
            builder = builder.add_state_event(f.room_encryption());
        }
        let mitglieder = self
            .server
            .mock_get_members()
            .ok(vec![f.member(bot).into_raw()])
            .mount_as_scoped()
            .await;
        let sync = self
            .server
            .mock_sync()
            .ok(move |sync| {
                sync.add_joined_room(builder);
            })
            .mount_as_scoped()
            .await;
        [sync, mitglieder]
    }

    /// Antwortet auf jedes Senden mit `$ev-{txn}`.
    async fn senden_nimmt_an(&self) {
        Mock::given(method("PUT"))
            .and(path_regex(r"^/_matrix/client/v3/rooms/.*/send/.*"))
            .respond_with(|req: &Request| {
                let txn = req.url.path().rsplit('/').next().unwrap_or_default();
                ResponseTemplate::new(200)
                    .set_body_json(json!({ "event_id": format!("$ev-{txn}") }))
            })
            .mount(self.server.server())
            .await;
    }

    /// Die gesendeten Ereignisse als (Typ, Transaktions-ID, Inhalt), in Reihenfolge.
    async fn gesendet(&self) -> Vec<(String, String, Value)> {
        let anfragen = self
            .server
            .server()
            .received_requests()
            .await
            .unwrap_or_default();
        anfragen
            .iter()
            .filter(|r| r.method.as_str() == "PUT" && r.url.path().contains("/send/"))
            .map(|r| {
                let teile: Vec<&str> = r.url.path().rsplit('/').take(2).collect();
                let inhalt: Value = serde_json::from_slice(&r.body).unwrap_or(Value::Null);
                (teile[1].to_string(), teile[0].to_string(), inhalt)
            })
            .collect()
    }

    /// Die hochgeladenen Dateien als (Content-Type, Bytes), in Reihenfolge.
    async fn uploads(&self) -> Vec<(String, Vec<u8>)> {
        self.server
            .server()
            .received_requests()
            .await
            .unwrap_or_default()
            .iter()
            .filter(|r| r.method.as_str() == "POST" && r.url.path().contains("/media/v3/upload"))
            .map(|r| {
                let typ = r
                    .headers
                    .get("content-type")
                    .and_then(|t| t.to_str().ok())
                    .unwrap_or_default()
                    .to_string();
                (typ, r.body.clone())
            })
            .collect()
    }

    async fn anfragen_an(&self, pfad: &str) -> usize {
        self.server
            .server()
            .received_requests()
            .await
            .unwrap_or_default()
            .iter()
            .filter(|r| r.url.path().contains(pfad))
            .count()
    }
}

struct Welt {
    app: axum::Router,
    pool: sqlx::SqlitePool,
    live: LiveHub,
    rahmen: Rahmen,
    admin: String,
    einsatz: i64,
    org_id: i64,
    benutzer_id: i64,
    hs: Homeserver,
    clients: Arc<Clients>,
    zusteller: Arc<dyn Zusteller>,
    _basis: tempfile::TempDir,
}

async fn welt() -> Welt {
    let pool = lifeline_hub::db::test_pool().await;
    lifeline_hub::auth::bootstrap::bootstrap_admin(&pool, "Test-Orga", "admin", Some("startpw12"))
        .await
        .unwrap();
    let live = LiveHub::new();
    let (rahmen, _pruefer) = adapter_testart::rahmen_smtp_matrix();
    let mut state = common::test_state(&pool, &live);
    state.adapter = rahmen.clone();
    let app = lifeline_hub::app::build_router(state);
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen_mit(&app, &admin, "Hochwasser Süd").await;
    let (org_id, benutzer_id): (i64, i64) =
        sqlx::query_as("SELECT org_id, id FROM benutzer WHERE benutzername = 'admin'")
            .fetch_one(&pool)
            .await
            .unwrap();

    let hs = homeserver().await;
    let body = json!({
        "art": "matrix", "name": "Matrix",
        "einstellungen": { "homeserver": "https://matrix.example.org" }
    });
    let (s, a) = anfrage_json(&app, "POST", "/api/admin/adapter", &admin, Some(&body)).await;
    assert_eq!(s, StatusCode::CREATED, "{a}");
    let adapter_id = a["id"].as_str().unwrap().to_string();
    let (s, v) = anfrage_json(
        &app,
        "PUT",
        &format!("/api/admin/adapter/{adapter_id}/secrets/access_token"),
        &admin,
        Some(&json!({ "wert": hs.token })),
    )
    .await;
    assert_eq!(s, StatusCode::NO_CONTENT, "{v}");

    let basis = tempfile::tempdir().unwrap();
    let clients = Arc::new(Clients::ohne_zielschutz_fuer_tests(
        basis.path().join("matrix"),
    ));
    let zusteller: Arc<dyn Zusteller> = Arc::new(ZumMock {
        homeserver: hs.server.uri(),
        echt: MatrixZusteller::new(clients.clone()),
    });
    Welt {
        app,
        pool,
        live,
        rahmen,
        admin,
        einsatz,
        org_id,
        benutzer_id,
        hs,
        clients,
        zusteller,
        _basis: basis,
    }
}

impl Welt {
    fn lb(&self, rest: &str) -> String {
        format!("/api/incidents/{}/situation-reports{rest}", self.einsatz)
    }

    /// Legt einen Lagebericht an, hängt auf Wunsch eine PNG-Anlage an und gibt ihn frei.
    async fn lagebericht_freigeben(&self, mit_anlage: bool) -> i64 {
        let (s, lb) = anfrage(
            &self.app,
            "POST",
            &self.lb(""),
            &self.admin,
            Some(r#"{"vorlage":"freitext","titel":"Lage","abschnitte":[{"schluessel":"text","text":"Pegel steigt"}]}"#),
        )
        .await;
        assert_eq!(s, StatusCode::CREATED, "{lb}");
        let lid = lb["id"].as_i64().unwrap();
        if mit_anlage {
            let png = png_bytes(32, 24);
            let (s, v) = multipart_post(
                &self.app,
                &self.lb(&format!("/{lid}/enclosures")),
                &self.admin,
                Some(("skizze.png", &png)),
                &[
                    ("art", "fernmeldeskizze"),
                    ("titel", "Fernmeldeskizze"),
                    ("stand_at", "2026-10-08 12:15:00"),
                ],
            )
            .await;
            assert_eq!(s, StatusCode::CREATED, "{v}");
        }
        let (s, v) = anfrage(
            &self.app,
            "POST",
            &self.lb(&format!("/{lid}/release")),
            &self.admin,
            None,
        )
        .await;
        assert!(s.is_success(), "Freigabe: {s} {v}");
        lid
    }

    /// Legt einen wartenden Matrix-Versand an `adresse` an, fällig zu `ab`.
    async fn versand(&self, adresse: &str, lid: i64, ab: DateTime<Utc>) -> String {
        let id = uuid::Uuid::new_v4().to_string();
        sqlx::query(
            "INSERT INTO ausgang (id, org_id, einsatz_id, client_id, quelle_art, quelle_id, kanal, \
                 stelle_bezeichnung, adresse, betreff, inhalt, zustand, naechster_versuch_at, \
                 erstellt_von_id, erstellt_at) \
             VALUES (?, ?, ?, ?, 'lagebericht', ?, 'matrix', ?, ?, ?, ?, 'wartet', ?, ?, ?)",
        )
        .bind(&id)
        .bind(self.org_id)
        .bind(self.einsatz)
        .bind(format!("c-{id}"))
        .bind(lid)
        .bind(STELLE)
        .bind(adresse)
        .bind("Lagebericht Nr. 1 – Hochwasser Süd – Stand 021000jun26")
        .bind("Pegel steigt\n\n-- \nHochwasser Süd\nErika Muster (S3)\n")
        .bind(lifeline_hub::zeit::formatiere_utc(ab))
        .bind(self.benutzer_id)
        .bind(lifeline_hub::zeit::formatiere_utc(ab))
        .execute(&self.pool)
        .await
        .unwrap();
        id
    }

    async fn zeile(&self, id: &str) -> VersandZeile {
        let mut conn = self.pool.acquire().await.unwrap();
        lifeline_hub::ausgang::repo::load(&mut conn, self.einsatz, id)
            .await
            .unwrap()
    }

    async fn durchgang(&self, jetzt: DateTime<Utc>) {
        lauf::durchgang(&self.pool, &self.rahmen, &self.live, &self.zusteller, jetzt)
            .await
            .unwrap();
    }

    async fn teile(&self, id: &str) -> Vec<(i64, String)> {
        sqlx::query_as("SELECT teil, event_id FROM ausgang_teil WHERE versand_id = ? ORDER BY teil")
            .bind(id)
            .fetch_all(&self.pool)
            .await
            .unwrap()
    }

    async fn letzter_etb(&self) -> String {
        sqlx::query_scalar(
            "SELECT inhalt FROM etb_eintrag WHERE einsatz_id = ? AND typ = 'system' \
             ORDER BY id DESC LIMIT 1",
        )
        .bind(self.einsatz)
        .fetch_one(&self.pool)
        .await
        .unwrap()
    }

    /// Das Ziel der Anbindung, wie der Zusteller es baut, mit der Adresse des Mocks.
    async fn ziel(&self) -> MatrixZiel {
        let zugang = lifeline_hub::adapter::lauf::zugang_fuer_versand(
            &self.pool,
            &self.rahmen,
            self.org_id,
            lifeline_hub::externe_stelle::KanalArt::Matrix,
        )
        .await
        .unwrap()
        .expect("Zugang der Matrix-Anbindung");
        let mut ziel = lifeline_hub::adapter::matrix_art::matrix_ziel(
            &zugang.adapter_id,
            &zugang.einstellungen,
            &zugang.geheimnisse,
            zugang.lan_erlaubt,
        )
        .expect("Ziel");
        ziel.homeserver = self.hs.server.uri().parse().unwrap();
        ziel
    }
}

fn txn(id: &str, n: i64) -> String {
    format!("ausgang-{id}-{n}")
}

#[tokio::test]
async fn alias_wird_aufgeloest_und_text_mit_txn_0_gesendet() {
    let w = welt().await;
    let _sync = w.hs.raum_im_sync(false).await;
    w.hs.senden_nimmt_an().await;
    let lid = w.lagebericht_freigeben(false).await;
    let t0 = Utc::now();
    let id = w.versand(ALIAS, lid, t0).await;

    w.durchgang(t0).await;

    let z = w.zeile(&id).await;
    assert_eq!(z.zustand, VersandZustand::Uebergeben, "{z:?}");
    assert_eq!(w.hs.anfragen_an("/directory/room/").await, 1);
    let gesendet = w.hs.gesendet().await;
    assert_eq!(gesendet.len(), 1, "{gesendet:?}");
    let (typ, t, inhalt) = &gesendet[0];
    assert_eq!(typ, "m.room.message");
    assert_eq!(t, &txn(&id, 0));
    assert_eq!(inhalt["msgtype"], "m.text");
    let body = inhalt["body"].as_str().unwrap();
    assert!(
        body.starts_with(
            "**Lagebericht Nr. 1 – Hochwasser Süd – Stand 021000jun26**\n\nPegel steigt"
        ),
        "{body}"
    );
    assert!(
        body.contains("Gesendet") || body.contains("Erika Muster (S3)"),
        "{body}"
    );
    assert_eq!(inhalt["format"], "org.matrix.custom.html");
    let html = inhalt["formatted_body"].as_str().unwrap();
    assert!(html.contains("<strong>Lagebericht Nr. 1"), "{html}");
    // Die Zeilen des Fußes bleiben getrennt.
    assert!(html.contains("Hochwasser Süd<br"), "{html}");
    assert_eq!(
        w.teile(&id).await,
        vec![(0, format!("$ev-{}", txn(&id, 0)))]
    );
    let etb = w.letzter_etb().await;
    assert_eq!(
        etb,
        format!("Lagebericht Nr. 1 per Matrix an {STELLE} ({ALIAS}) übergeben")
    );
}

#[tokio::test]
async fn anlagen_gehen_als_m_image_mit_eigenen_txn() {
    let w = welt().await;
    let _sync = w.hs.raum_im_sync(false).await;
    w.hs.senden_nimmt_an().await;
    let lid = w.lagebericht_freigeben(true).await;
    let t0 = Utc::now();
    let id = w.versand(RAUM, lid, t0).await;

    w.durchgang(t0).await;

    assert_eq!(w.zeile(&id).await.zustand, VersandZustand::Uebergeben);
    // Eine Raum-ID braucht keine Auflösung.
    assert_eq!(w.hs.anfragen_an("/directory/room/").await, 0);
    let gesendet = w.hs.gesendet().await;
    let txns: Vec<&str> = gesendet.iter().map(|(_, t, _)| t.as_str()).collect();
    assert_eq!(txns, vec![txn(&id, 0), txn(&id, 1)]);
    let (typ, _, bild) = &gesendet[1];
    assert_eq!(typ, "m.room.message");
    assert_eq!(bild["msgtype"], "m.image", "{bild}");
    assert_eq!(bild["body"], "anlage-1.png");
    assert_eq!(bild["url"], "mxc://example.org/anlage");
    assert_eq!(bild["info"]["mimetype"], "image/png");
    assert!(
        bild["info"]["size"].as_u64().is_some_and(|s| s > 0),
        "{bild}"
    );
    assert!(
        bild["info"]["w"].is_u64() && bild["info"]["h"].is_u64(),
        "{bild}"
    );
    assert_eq!(w.hs.anfragen_an("/media/v3/upload").await, 1);
    assert_eq!(
        w.teile(&id).await,
        vec![
            (0, format!("$ev-{}", txn(&id, 0))),
            (1, format!("$ev-{}", txn(&id, 1)))
        ]
    );
}

#[tokio::test]
async fn ohne_einladung_kein_zutritt_endgueltig() {
    let w = welt().await;
    // Der Bot ist nicht im Raum, und Beitreten verweigert der Homeserver.
    Mock::given(method("POST"))
        .and(path_regex(r"^/_matrix/client/v3/join/"))
        .respond_with(ResponseTemplate::new(403).set_body_json(json!({
            "errcode": "M_FORBIDDEN", "error": "You are not invited to this room."
        })))
        .with_priority(1)
        .mount(w.hs.server.server())
        .await;
    w.hs.senden_nimmt_an().await;
    let lid = w.lagebericht_freigeben(false).await;
    let t0 = Utc::now();
    let id = w.versand(ALIAS, lid, t0).await;

    w.durchgang(t0).await;

    let z = w.zeile(&id).await;
    assert_eq!(z.zustand, VersandZustand::Fehlgeschlagen);
    assert_eq!(z.fehler_art, Some(AusgangFehler::KeinZutritt));
    assert_eq!(z.fehler_status, None);
    assert!(w.hs.gesendet().await.is_empty());
    let etb = w.letzter_etb().await;
    assert!(etb.contains("per Matrix an"), "{etb}");
    assert!(etb.contains("kein Zutritt zum Raum"), "{etb}");
    assert!(
        !etb.contains("not invited"),
        "kein Text des Homeservers: {etb}"
    );
}

#[tokio::test]
async fn rate_limit_respektiert_retry_after() {
    let w = welt().await;
    let _sync = w.hs.raum_im_sync(false).await;
    Mock::given(method("PUT"))
        .and(path_regex(r"^/_matrix/client/v3/rooms/.*/send/.*"))
        .respond_with(ResponseTemplate::new(429).set_body_json(json!({
            "errcode": "M_LIMIT_EXCEEDED", "error": "Too many requests", "retry_after_ms": 600000
        })))
        .mount(w.hs.server.server())
        .await;
    let lid = w.lagebericht_freigeben(false).await;
    let t0 = Utc::now();
    let id = w.versand(RAUM, lid, t0).await;

    w.durchgang(t0).await;

    let z = w.zeile(&id).await;
    assert_eq!(z.zustand, VersandZustand::Wartet, "{z:?}");
    assert_eq!(z.fehler_art, Some(AusgangFehler::Voruebergehend));
    let naechster = z
        .naechster_versuch_at
        .as_deref()
        .and_then(lifeline_hub::zeit::parse_utc)
        .expect("nächster Versuch");
    assert!(
        naechster >= t0 + chrono::Duration::minutes(10),
        "{naechster} vor {t0} + 10 min"
    );
}

#[tokio::test]
async fn abbruch_beim_senden_ist_voruebergehend_nicht_ungewiss() {
    let w = welt().await;
    let _sync = w.hs.raum_im_sync(false).await;
    // Der Homeserver bricht die Verbindung mitten in der Anfrage ab (keine Antwort).
    Mock::given(method("PUT"))
        .and(path_regex(r"^/_matrix/client/v3/rooms/.*/send/.*"))
        .respond_with(|_: &Request| -> ResponseTemplate {
            panic!("Verbindung abgebrochen (gewollt im Test)")
        })
        .mount(w.hs.server.server())
        .await;
    let lid = w.lagebericht_freigeben(false).await;
    let t0 = Utc::now();
    let id = w.versand(RAUM, lid, t0).await;

    w.durchgang(t0).await;

    let z = w.zeile(&id).await;
    assert_eq!(z.zustand, VersandZustand::Wartet, "{z:?}");
    assert_eq!(z.fehler_art, Some(AusgangFehler::Voruebergehend));
    assert!(z.naechster_versuch_at.is_some());
    assert!(w.teile(&id).await.is_empty());
}

/// Ein Speicherverzeichnis, das sich nicht löschen und nicht öffnen lässt (hier eine Datei an
/// seiner Stelle), ist ein vorübergehendes Problem des Hubs, kein endgültiges „Verschlüsseln
/// nicht möglich“: der Versand bleibt im Wiederholungsfenster.
#[tokio::test]
async fn nicht_nutzbarer_speicher_ist_voruebergehend() {
    let w = welt().await;
    let _sync = w.hs.raum_im_sync(false).await;
    w.hs.senden_nimmt_an().await;
    let adapter_id = w.ziel().await.adapter_id;
    let basis = w._basis.path().join("matrix");
    std::fs::create_dir_all(&basis).unwrap();
    std::fs::write(basis.join(&adapter_id), b"kein Verzeichnis").unwrap();
    // Das Verwerfen scheitert am Löschen und bleibt vorgemerkt.
    w.clients.verwerfen(&adapter_id).await;
    let lid = w.lagebericht_freigeben(false).await;
    let t0 = Utc::now();
    let id = w.versand(RAUM, lid, t0).await;

    w.durchgang(t0).await;

    let z = w.zeile(&id).await;
    assert_eq!(z.zustand, VersandZustand::Wartet, "{z:?}");
    assert_eq!(z.fehler_art, Some(AusgangFehler::Voruebergehend));
    assert!(z.naechster_versuch_at.is_some());
    assert!(w.hs.gesendet().await.is_empty());
}

#[tokio::test]
async fn erneut_senden_ueberspringt_gemerkte_teile() {
    let w = welt().await;
    let _sync = w.hs.raum_im_sync(false).await;
    w.hs.senden_nimmt_an().await;
    let lid = w.lagebericht_freigeben(true).await;
    let t0 = Utc::now();
    let id = w.versand(RAUM, lid, t0).await;
    // Ein früherer Versuch hat den Text gesendet und ist dann an der Anlage gescheitert.
    sqlx::query(
        "UPDATE ausgang SET zustand = 'fehlgeschlagen', fehler_art = 'voruebergehend', \
             versuche = 3, naechster_versuch_at = NULL WHERE id = ?",
    )
    .bind(&id)
    .execute(&w.pool)
    .await
    .unwrap();
    sqlx::query(
        "INSERT INTO ausgang_teil (versand_id, teil, event_id, gesendet_at) VALUES (?, 0, '$alt', ?)",
    )
    .bind(&id)
    .bind(lifeline_hub::zeit::formatiere_utc(t0))
    .execute(&w.pool)
    .await
    .unwrap();

    let (s, v) = anfrage(
        &w.app,
        "POST",
        &format!("/api/incidents/{}/deliveries/{id}/retry", w.einsatz),
        &w.admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    w.durchgang(Utc::now() + chrono::Duration::seconds(1)).await;

    assert_eq!(w.zeile(&id).await.zustand, VersandZustand::Uebergeben);
    let txns: Vec<String> =
        w.hs.gesendet()
            .await
            .into_iter()
            .map(|(_, t, _)| t)
            .collect();
    assert_eq!(txns, vec![txn(&id, 1)]);
    assert_eq!(
        w.teile(&id).await,
        vec![(0, "$alt".to_string()), (1, format!("$ev-{}", txn(&id, 1)))]
    );
}

#[tokio::test]
async fn anlage_ueber_der_grenze_des_homeservers_ist_zu_gross_vor_dem_text() {
    let w = welt().await;
    let _sync = w.hs.raum_im_sync(false).await;
    w.hs.senden_nimmt_an().await;
    // Der Homeserver erlaubt nur 100 Bytes je Datei; die Grenze kennt der Client aus der Prüfung.
    let kleine_grenze = Mock::given(method("GET"))
        .and(path("/_matrix/client/v1/media/config"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({ "m.upload.size": 100 })))
        .with_priority(1)
        .mount_as_scoped(w.hs.server.server())
        .await;
    let befund = matrix::pruefe(&w.clients, &w.ziel().await)
        .await
        .expect("Prüfung");
    drop(kleine_grenze);
    assert_eq!(befund.upload_max, Some(100));
    let lid = w.lagebericht_freigeben(true).await;
    let t0 = Utc::now();
    let id = w.versand(RAUM, lid, t0).await;

    w.durchgang(t0).await;

    let z = w.zeile(&id).await;
    assert_eq!(z.zustand, VersandZustand::Fehlgeschlagen);
    assert_eq!(z.fehler_art, Some(AusgangFehler::ZuGross));
    assert!(
        w.hs.gesendet().await.is_empty(),
        "kein Text vor der zu großen Anlage"
    );
}

#[tokio::test]
async fn homeserver_ohne_grenze_fuer_anlagen_ist_endgueltig_mit_eigenem_grund() {
    let w = welt().await;
    let _sync = w.hs.raum_im_sync(false).await;
    w.hs.senden_nimmt_an().await;
    // Der Homeserver nennt kein `m.upload.size`.
    let _ohne_grenze = Mock::given(method("GET"))
        .and(path("/_matrix/client/v1/media/config"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({})))
        .with_priority(1)
        .mount_as_scoped(w.hs.server.server())
        .await;
    let lid = w.lagebericht_freigeben(true).await;
    let t0 = Utc::now();
    let id = w.versand(RAUM, lid, t0).await;

    w.durchgang(t0).await;

    let z = w.zeile(&id).await;
    assert_eq!(z.zustand, VersandZustand::Fehlgeschlagen, "{z:?}");
    assert_eq!(z.fehler_art, Some(AusgangFehler::Abgelehnt));
    assert!(w.hs.gesendet().await.is_empty(), "kein Text ohne Grenze");
    let etb = w.letzter_etb().await;
    assert!(
        etb.contains("Homeserver nennt keine Grenze für Anlagen"),
        "{etb}"
    );
}

#[tokio::test]
async fn in_verschluesselten_raum_geht_nie_klartext() {
    in_verschluesselten_raum_senden(false).await;
}

#[tokio::test]
async fn in_verschluesselten_raum_geht_auch_die_anlage_nur_verschluesselt() {
    in_verschluesselten_raum_senden(true).await;
}

/// Ein Versand in einen verschlüsselten Raum, auf Wunsch mit einer PNG-Anlage: jedes Ereignis
/// geht als `m.room.encrypted`, die Anlage als verschlüsselte Datei.
async fn in_verschluesselten_raum_senden(mit_anlage: bool) {
    let w = welt().await;
    let server = &w.hs.server;
    let bot_id = user_id!("@lifeline:example.org");
    // Die Leitstelle hat ein Gerät mit hochgeladenen Schlüsseln.
    let leitstelle_id = user_id!("@leitstelle:example.org");
    let leitstelle = server
        .client_builder_for_crypto_end_to_end(leitstelle_id, device_id!("LEITSTELLE"))
        .build()
        .await;
    server.mock_sync().ok_and_run(&leitstelle, |_| {}).await;

    // Die Verbindungsprüfung synct ohne Räume: danach kennt der Client den Raum noch nicht.
    {
        let _leer = server.mock_sync().ok(|_| {}).mount_as_scoped().await;
        matrix::pruefe(&w.clients, &w.ziel().await)
            .await
            .expect("Prüfung");
    }
    // Der Sync des Versands bringt den verschlüsselten Raum, aber keine Mitglieder; die kommen
    // nur über die Mitgliederliste.
    let raum = matrix_sdk::ruma::room_id!("!lage:example.org");
    let f = EventFactory::new().room(raum).sender(bot_id);
    let _sync = server
        .mock_sync()
        .ok(|sync| {
            sync.add_joined_room(
                JoinedRoomBuilder::new(raum)
                    .add_state_event(f.create(bot_id, RoomVersionId::V10))
                    .add_state_event(f.room_encryption()),
            );
        })
        .mount_as_scoped()
        .await;
    let _mitglieder = server
        .mock_get_members()
        .ok(vec![
            f.member(bot_id).into_raw(),
            f.member(leitstelle_id).sender(leitstelle_id).into_raw(),
        ])
        .mount_as_scoped()
        .await;
    w.hs.senden_nimmt_an().await;
    let (_wache, raumschluessel) = server.mock_capture_put_to_device(bot_id).await;
    let lid = w.lagebericht_freigeben(mit_anlage).await;
    let t0 = Utc::now();
    let id = w.versand(RAUM, lid, t0).await;

    w.durchgang(t0).await;

    let z = w.zeile(&id).await;
    let gesendet = w.hs.gesendet().await;
    assert!(
        gesendet.iter().all(|(typ, _, _)| typ == "m.room.encrypted"),
        "nie m.room.message in einen verschlüsselten Raum: {gesendet:?}"
    );
    assert!(
        gesendet
            .iter()
            .all(|(_, _, inhalt)| !inhalt.to_string().contains("Pegel")),
        "kein Klartext: {gesendet:?}"
    );
    // Entweder verschlüsselt zugestellt oder sichtbar gescheitert, nie still im Klartext.
    match z.zustand {
        VersandZustand::Uebergeben => {
            let txns: Vec<&str> = gesendet.iter().map(|(_, t, _)| t.as_str()).collect();
            if mit_anlage {
                assert_eq!(txns, vec![txn(&id, 0), txn(&id, 1)]);
            } else {
                assert_eq!(txns, vec![txn(&id, 0)]);
            }
            for (_, _, inhalt) in &gesendet {
                assert_eq!(inhalt["algorithm"], "m.megolm.v1.aes-sha2", "{inhalt}");
                assert!(inhalt["ciphertext"].is_string(), "{inhalt}");
                assert!(inhalt.get("msgtype").is_none(), "{inhalt}");
            }
            if mit_anlage {
                // Die Datei geht verschlüsselt hoch: als Bytes ohne Typ, nicht als PNG.
                let uploads = w.hs.uploads().await;
                assert_eq!(uploads.len(), 1, "eine Anlage, ein Upload");
                let (typ, daten) = &uploads[0];
                assert_eq!(typ, "application/octet-stream");
                assert!(
                    !daten.starts_with(b"\x89PNG"),
                    "die Anlage ging als PNG hoch"
                );
                assert_ne!(daten, &png_bytes(32, 24));
            }
            let schluessel: Value = tokio::time::timeout(Duration::from_secs(10), raumschluessel)
                .await
                .expect("Raumschlüssel an das Gerät der Leitstelle")
                .deserialize_as()
                .expect("JSON des Raumschlüssels");
            assert_eq!(
                schluessel["content"]["algorithm"],
                "m.olm.v1.curve25519-aes-sha2"
            );
        }
        _ => {
            assert_eq!(z.fehler_art, Some(AusgangFehler::Verschluesselung), "{z:?}");
            panic!("Versand in den verschlüsselten Raum gescheitert: {z:?}");
        }
    }
}
