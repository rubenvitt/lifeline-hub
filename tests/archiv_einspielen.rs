//! Archivblock in der Verwaltung einspielen (LLH-1711, Change
//! `yftpw99d-archiv-einspielen-verwaltung`): Verfügbarkeit, Hochladen von Block und Schlüssel,
//! Hub-Sperre, Grenzen, Spur, und dass der Schlüssel nirgends liegen bleibt.

use axum::body::{to_bytes, Body};
use axum::http::{header, Request, StatusCode};
use chrono::Utc;
use serde_json::{json, Value};
use sqlx::SqlitePool;
use std::io::{Read, Write};
use std::path::Path;
use tower::ServiceExt;

mod common;
use common::{anfrage, anfrage_json, benutzer_anlegen, einsatz_anlegen, login_cookie};

const PFAD: &str = "/api/admin/archiv/einspielen";
const GRENZE: &str = "LFHARCHIVGRENZE";

/// Ein Feld des Uploads: Name, Dateiname (bei einer Datei) und Inhalt.
type Feld<'a> = (&'a str, Option<&'a str>, &'a [u8]);

fn multipart(felder: &[Feld<'_>]) -> Vec<u8> {
    let mut body = Vec::new();
    for (name, datei, inhalt) in felder {
        let kopf = match datei {
            Some(d) => format!(
                "--{GRENZE}\r\nContent-Disposition: form-data; name=\"{name}\"; \
                 filename=\"{d}\"\r\nContent-Type: application/octet-stream\r\n\r\n"
            ),
            None => {
                format!("--{GRENZE}\r\nContent-Disposition: form-data; name=\"{name}\"\r\n\r\n")
            }
        };
        body.extend_from_slice(kopf.as_bytes());
        body.extend_from_slice(inhalt);
        body.extend_from_slice(b"\r\n");
    }
    body.extend_from_slice(format!("--{GRENZE}--\r\n").as_bytes());
    body
}

fn anfrage_hochladen(cookie: &str, body: Body) -> Request<Body> {
    Request::builder()
        .method("POST")
        .uri(PFAD)
        .header(header::COOKIE, cookie)
        .header(
            header::CONTENT_TYPE,
            format!("multipart/form-data; boundary={GRENZE}"),
        )
        .extension(axum::extract::ConnectInfo(std::net::SocketAddr::from((
            [198, 51, 100, 4],
            40_000,
        ))))
        .body(body)
        .unwrap()
}

async fn hochladen(app: &axum::Router, cookie: &str, felder: &[Feld<'_>]) -> (StatusCode, Value) {
    let resp = app
        .clone()
        .oneshot(anfrage_hochladen(cookie, Body::from(multipart(felder))))
        .await
        .unwrap();
    let status = resp.status();
    let bytes = to_bytes(resp.into_body(), usize::MAX).await.unwrap();
    (
        status,
        serde_json::from_slice(&bytes).unwrap_or(Value::Null),
    )
}

struct Umgebung {
    dir: tempfile::TempDir,
    app: axum::Router,
    live: lifeline_hub::live::LiveHub,
    pool: SqlitePool,
    admin: String,
    identitaet: age::x25519::Identity,
    block: Vec<u8>,
}

impl Umgebung {
    fn schluessel_text(&self) -> String {
        use age::secrecy::ExposeSecret;
        format!("{}\n", self.identitaet.to_string().expose_secret())
    }
}

/// Eine Installation mit Datei-Datenbank, einem geprüften Archiv-Schlüssel der Org und einem
/// archivierten Einsatz, dessen Block über die Archivakte geladen ist.
async fn umgebung() -> Umgebung {
    let (dir, pool) = lifeline_hub::db::test_pool_datei().await;
    let (app, pool, live) = common::setup_mit_optionen_auf(pool, Default::default()).await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let identitaet = age::x25519::Identity::generate();
    let (s, v) = anfrage_json(
        &app,
        "POST",
        "/api/org-archiv-schluessel",
        &admin,
        Some(&json!({
            "schluessel": identitaet.to_public().to_string(),
            "bezeichnung": "Tresor",
        })),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
    let sid = v["empfaenger"]["id"].as_i64().unwrap();
    let mut code = String::new();
    age::Decryptor::new(age::armor::ArmoredReader::new(
        v["probe"].as_str().unwrap().as_bytes(),
    ))
    .unwrap()
    .decrypt(std::iter::once(&identitaet as &dyn age::Identity))
    .unwrap()
    .read_to_string(&mut code)
    .unwrap();
    let (s, v) = anfrage_json(
        &app,
        "POST",
        &format!("/api/org-archiv-schluessel/{sid}/pruefen"),
        &admin,
        Some(&json!({ "code": code.trim() })),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");

    let id = einsatz_anlegen(&app, &admin).await;
    let (s, v) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{id}/abschliessen"),
        &admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    sqlx::query(
        "UPDATE einsatz SET retention_bis = NULL, nachbereitung_bis = datetime('now', '-1 hour') \
         WHERE id = ?",
    )
    .bind(id)
    .execute(&pool)
    .await
    .unwrap();
    lifeline_hub::einsatz::purge_scheduler::tick_einmal(
        &pool,
        &lifeline_hub::live::LiveHub::new(),
        Utc::now(),
    )
    .await;
    let resp = app
        .clone()
        .oneshot(
            Request::builder()
                .uri(format!("/api/aufbewahrung/einsaetze/{id}/archiv"))
                .header(header::COOKIE, admin.clone())
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let block = to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap()
        .to_vec();
    Umgebung {
        dir,
        app,
        live,
        pool,
        admin,
        identitaet,
        block,
    }
}

fn zwischendateien(dir: &Path) -> Vec<String> {
    std::fs::read_dir(dir)
        .unwrap()
        .flatten()
        .map(|e| e.file_name().to_string_lossy().into_owned())
        .filter(|n| n.starts_with("lifeline-zwischen-"))
        .collect()
}

async fn eingespielt(pool: &SqlitePool) -> i64 {
    sqlx::query_scalar("SELECT COUNT(*) FROM einsatz_archiv_eingespielt")
        .fetch_one(pool)
        .await
        .unwrap()
}

async fn kopplung(pool: &SqlitePool, kennung: &str, richtung: &str, zustand: &str) {
    let adresse = (richtung == "meldet_sich").then_some("https://hub.example");
    sqlx::query(
        "INSERT INTO instanz_kopplung (gegenueber_kennung, gegenueber_schluessel, \
         gegenueber_name, richtung, gegenueber_adresse, zustand) VALUES (?, 'k', 'X', ?, ?, ?)",
    )
    .bind(kennung)
    .bind(richtung)
    .bind(adresse)
    .bind(zustand)
    .execute(pool)
    .await
    .unwrap();
}

/// Entschlüsselt den Block, ändert ihn mit `sql` und verschlüsselt ihn wieder für denselben
/// Schlüssel: so entsteht etwa ein Block mit abgelaufener Aufbewahrung.
async fn block_umschreiben(u: &Umgebung, sql: &str) -> Vec<u8> {
    let arbeit = tempfile::tempdir().unwrap();
    let pfad = arbeit.path().join("block.sqlite");
    let mut klar = Vec::new();
    age::Decryptor::new(u.block.as_slice())
        .unwrap()
        .decrypt(std::iter::once(&u.identitaet as &dyn age::Identity))
        .unwrap()
        .read_to_end(&mut klar)
        .unwrap();
    std::fs::write(&pfad, klar).unwrap();
    let pool = sqlx::sqlite::SqlitePoolOptions::new()
        .max_connections(1)
        .connect_with(sqlx::sqlite::SqliteConnectOptions::new().filename(&pfad))
        .await
        .unwrap();
    sqlx::query(sqlx::AssertSqlSafe(sql.to_string()))
        .execute(&pool)
        .await
        .unwrap();
    pool.close().await;
    let mut geheim = Vec::new();
    let empfaenger = u.identitaet.to_public();
    let mut w =
        age::Encryptor::with_recipients(std::iter::once(&empfaenger as &dyn age::Recipient))
            .unwrap()
            .wrap_output(&mut geheim)
            .unwrap();
    w.write_all(&std::fs::read(&pfad).unwrap()).unwrap();
    w.finish().unwrap();
    geheim
}

#[tokio::test]
async fn verfuegbarkeit_nur_fuer_admins_und_nicht_am_hub() {
    let (app, pool) = common::setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    benutzer_anlegen(&app, &admin, "fuehrung", "fuehrungskraft").await;
    let fk = login_cookie(&app, "fuehrung", "fuehrungpw1").await;

    let (s, _) = anfrage(&app, "GET", PFAD, &fk, None).await;
    assert_eq!(s, StatusCode::FORBIDDEN);
    let (s, v) = anfrage(&app, "GET", PFAD, &admin, None).await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert_eq!(v["verfuegbar"], true);

    // Eine Pseudo-Kopplung eines früheren Einspielens und eine eigene Meldung sperren nicht.
    kopplung(
        &pool,
        "archiv/0123456789abcdef",
        "wird_gemeldet",
        "widerrufen",
    )
    .await;
    kopplung(&pool, "hub", "meldet_sich", "aktiv").await;
    let (_, v) = anfrage(&app, "GET", PFAD, &admin, None).await;
    assert_eq!(v["verfuegbar"], true);

    kopplung(&pool, "elw", "wird_gemeldet", "angebahnt").await;
    let (_, v) = anfrage(&app, "GET", PFAD, &admin, None).await;
    assert_eq!(v["verfuegbar"], false);
}

#[tokio::test]
async fn ein_admin_spielt_ein_und_die_spur_nennt_ihn() {
    let u = umgebung().await;
    let schluessel = u.schluessel_text();
    let mut rx = u.live.abonniere_org();
    let (s, v) = hochladen(
        &u.app,
        &u.admin,
        &[
            ("schluessel", None, schluessel.as_bytes()),
            ("block", Some("einsatz-block-1.sqlite.age"), &u.block),
        ],
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    let neu = v["einsatz_id"].as_i64().unwrap();
    assert_eq!(v["org_name"], "Test-Orga");
    assert!(v["loeschen_at"].is_string());
    assert!(v["frist_endet_at"].is_null());
    assert!(v["hinweise"].as_array().unwrap().is_empty(), "{v}");

    // Der Einsatz steht in der Liste, als Spiegel „aus dem Archiv“.
    let (s, liste) = anfrage(&u.app, "GET", "/api/einsaetze", &u.admin, None).await;
    assert_eq!(s, StatusCode::OK);
    let e = liste
        .as_array()
        .unwrap()
        .iter()
        .find(|e| e["id"] == neu)
        .unwrap_or_else(|| panic!("eingespielter Einsatz fehlt: {liste}"));
    assert!(e["spiegel"]["archiv_bis"].is_string(), "{e}");

    // Offene Einsatzlisten der Org erfahren davon ohne Neuladen.
    let admin: lifeline_hub::auth::Benutzer =
        sqlx::query_as("SELECT * FROM benutzer WHERE benutzername = 'admin'")
            .fetch_one(&u.pool)
            .await
            .unwrap();
    let abonnent = lifeline_hub::live::org::OrgAbonnent::aus(&admin);
    let mut gesehen = Vec::new();
    while let Ok(n) = rx.try_recv() {
        if abonnent.sieht(&n) {
            gesehen.push(n.event.as_str());
        }
    }
    assert_eq!(gesehen, vec!["einsatzliste"]);

    let (akteur_id, akteur_name, peer_ip): (Option<i64>, String, Option<String>) = sqlx::query_as(
        "SELECT akteur_id, akteur_name, peer_ip FROM admin_audit \
             WHERE aktion = 'archiv_eingespielt'",
    )
    .fetch_one(&u.pool)
    .await
    .unwrap();
    assert!(akteur_id.is_some());
    assert_eq!(akteur_name, "admin");
    assert_eq!(peer_ip.as_deref(), Some("198.51.100.4"));
    assert!(zwischendateien(u.dir.path()).is_empty());
}

#[tokio::test]
async fn schluessel_als_datei_auch_mit_passphrase() {
    let u = umgebung().await;
    let schluessel = u.schluessel_text();
    let (s, v) = hochladen(
        &u.app,
        &u.admin,
        &[
            (
                "schluessel_datei",
                Some("archiv.txt"),
                schluessel.as_bytes(),
            ),
            ("block", Some("b.age"), &u.block),
        ],
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");

    // `age -p` auf die Schlüsseldatei, mit kleinem Arbeitsfaktor.
    let mut empf =
        age::scrypt::Recipient::new(age::secrecy::SecretString::from("geheim".to_owned()));
    empf.set_work_factor(10);
    let mut geschuetzt = Vec::new();
    let mut w = age::Encryptor::with_recipients(std::iter::once(&empf as &dyn age::Recipient))
        .unwrap()
        .wrap_output(&mut geschuetzt)
        .unwrap();
    w.write_all(schluessel.as_bytes()).unwrap();
    w.finish().unwrap();

    let (s, v) = hochladen(
        &u.app,
        &u.admin,
        &[
            ("schluessel_datei", Some("archiv.age"), &geschuetzt),
            ("block", Some("b.age"), &u.block),
        ],
    )
    .await;
    assert_eq!(s, StatusCode::BAD_REQUEST, "ohne Passphrase: {v}");
    assert!(v["error"].as_str().unwrap().contains("Passphrase"), "{v}");

    let (s, v) = hochladen(
        &u.app,
        &u.admin,
        &[
            ("schluessel_datei", Some("archiv.age"), &geschuetzt),
            ("passphrase", None, b"geheim"),
            ("block", Some("b.age"), &u.block),
        ],
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert_eq!(eingespielt(&u.pool).await, 2);
}

#[tokio::test]
async fn fehlerhafte_uploads_spielen_nichts_ein() {
    let u = umgebung().await;
    let schluessel = u.schluessel_text();
    let fremd = {
        use age::secrecy::ExposeSecret;
        age::x25519::Identity::generate()
            .to_string()
            .expose_secret()
            .to_owned()
    };
    let abgelaufen = block_umschreiben(
        &u,
        "UPDATE einsatz SET retention_bis = datetime('now', '-1 day')",
    )
    .await;
    let faelle: Vec<(&str, Vec<Feld<'_>>, &str)> = vec![
        (
            "ohne Schlüssel",
            vec![("block", Some("b"), &u.block)],
            "Schlüssel",
        ),
        (
            "doppelter Schlüssel",
            vec![
                ("schluessel", None, schluessel.as_bytes()),
                ("schluessel_datei", Some("k"), schluessel.as_bytes()),
                ("block", Some("b"), &u.block),
            ],
            "nicht beides",
        ),
        (
            "Block vor dem Schlüssel",
            vec![
                ("block", Some("b"), &u.block),
                ("schluessel", None, schluessel.as_bytes()),
            ],
            "Schlüssel",
        ),
        (
            "ohne Block",
            vec![("schluessel", None, schluessel.as_bytes())],
            "Archivblock",
        ),
        (
            "falscher Schlüssel",
            vec![
                ("schluessel", None, fremd.as_bytes()),
                ("block", Some("b"), &u.block),
            ],
            "passt nicht",
        ),
        (
            "abgelaufen",
            vec![
                ("schluessel", None, schluessel.as_bytes()),
                ("block", Some("b"), &abgelaufen),
            ],
            "Aufbewahrung",
        ),
        (
            "unbekanntes Feld",
            vec![
                ("schluessel", None, schluessel.as_bytes()),
                ("org", None, b"2"),
                ("block", Some("b"), &u.block),
            ],
            "org",
        ),
    ];
    for (fall, felder, meldung) in faelle {
        let (s, v) = hochladen(&u.app, &u.admin, &felder).await;
        assert_eq!(s, StatusCode::BAD_REQUEST, "{fall}: {v}");
        assert!(
            v["error"].as_str().unwrap_or_default().contains(meldung),
            "{fall}: {v}"
        );
    }

    // Fremde Org: hier heißt die Org inzwischen anders als im Archiv.
    sqlx::query("UPDATE organisation SET name = 'KV Süd' WHERE name = 'Test-Orga'")
        .execute(&u.pool)
        .await
        .unwrap();
    let (s, v) = hochladen(
        &u.app,
        &u.admin,
        &[
            ("schluessel", None, schluessel.as_bytes()),
            ("block", Some("b"), &u.block),
        ],
    )
    .await;
    assert_eq!(s, StatusCode::BAD_REQUEST, "{v}");
    let meldung = v["error"].as_str().unwrap();
    assert!(
        meldung.contains("Test-Orga") && meldung.contains("KV Süd"),
        "{v}"
    );
    assert!(!meldung.contains("--org"), "{v}");

    assert_eq!(eingespielt(&u.pool).await, 0);
    let spur: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM admin_audit WHERE aktion = 'archiv_eingespielt'")
            .fetch_one(&u.pool)
            .await
            .unwrap();
    assert_eq!(spur, 0);
    assert!(zwischendateien(u.dir.path()).is_empty());
}

#[tokio::test]
async fn nur_admins_und_nicht_am_hub() {
    let u = umgebung().await;
    let schluessel = u.schluessel_text();
    let felder: [Feld<'_>; 2] = [
        ("schluessel", None, schluessel.as_bytes()),
        ("block", Some("b"), &u.block),
    ];
    benutzer_anlegen(&u.app, &u.admin, "fuehrung", "fuehrungskraft").await;
    let fk = login_cookie(&u.app, "fuehrung", "fuehrungpw1").await;
    let (s, _) = hochladen(&u.app, &fk, &felder).await;
    assert_eq!(s, StatusCode::FORBIDDEN);

    // Eine Kopplung einer anderen Org, bei der sich eine Instanz hier meldet, sperrt ebenso.
    for zustand in ["angebahnt", "aktiv"] {
        sqlx::query("DELETE FROM instanz_kopplung")
            .execute(&u.pool)
            .await
            .unwrap();
        kopplung(&u.pool, "elw", "wird_gemeldet", zustand).await;
        let (s, v) = hochladen(&u.app, &u.admin, &felder).await;
        assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY, "{zustand}: {v}");
    }
    assert_eq!(eingespielt(&u.pool).await, 0);

    // Widerrufen: wieder frei, und ein eingespielter Block sperrt das nächste Einspielen nicht.
    sqlx::query("UPDATE instanz_kopplung SET zustand = 'widerrufen'")
        .execute(&u.pool)
        .await
        .unwrap();
    for _ in 0..2 {
        let (s, v) = hochladen(&u.app, &u.admin, &felder).await;
        assert_eq!(s, StatusCode::OK, "{v}");
    }
}

/// Alle Textspalten aller Tabellen und alle Dateien im Datenverzeichnis enthalten `geheim` nicht.
async fn nirgends(pool: &SqlitePool, dir: &Path, geheim: &str) {
    let tabellen: Vec<String> = sqlx::query_scalar(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
    )
    .fetch_all(pool)
    .await
    .unwrap();
    for t in tabellen {
        let spalten: Vec<(String,)> = sqlx::query_as(sqlx::AssertSqlSafe(format!(
            "SELECT name FROM pragma_table_info('{t}')"
        )))
        .fetch_all(pool)
        .await
        .unwrap();
        for (s,) in spalten {
            let treffer: i64 = sqlx::query_scalar(sqlx::AssertSqlSafe(format!(
                "SELECT COUNT(*) FROM \"{t}\" WHERE instr(CAST(\"{s}\" AS BLOB), CAST(? AS BLOB)) > 0"
            )))
            .bind(geheim)
            .fetch_one(pool)
            .await
            .unwrap();
            assert_eq!(treffer, 0, "{t}.{s} enthält das Geheimnis");
        }
    }
    sqlx::query("PRAGMA wal_checkpoint(TRUNCATE)")
        .execute(pool)
        .await
        .unwrap();
    for e in std::fs::read_dir(dir).unwrap().flatten() {
        let inhalt = std::fs::read(e.path()).unwrap();
        assert!(
            !inhalt.windows(geheim.len()).any(|w| w == geheim.as_bytes()),
            "{} enthält das Geheimnis",
            e.path().display()
        );
    }
}

#[tokio::test]
async fn schluessel_und_passphrase_bleiben_nirgends_liegen() {
    let u = umgebung().await;
    let schluessel = u.schluessel_text();
    let geheim = schluessel.trim().to_owned();
    let (s, v) = hochladen(
        &u.app,
        &u.admin,
        &[
            ("schluessel", None, schluessel.as_bytes()),
            ("passphrase", None, b"Passphrase-Unbenutzt-7x"),
            ("block", Some("b"), &u.block),
        ],
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    // Und nach einem Fehler: Block passt, aber die Org heißt inzwischen anders.
    sqlx::query("UPDATE organisation SET name = 'Anders'")
        .execute(&u.pool)
        .await
        .unwrap();
    let (s, _) = hochladen(
        &u.app,
        &u.admin,
        &[
            ("schluessel", None, schluessel.as_bytes()),
            ("block", Some("b"), &u.block),
        ],
    )
    .await;
    assert_eq!(s, StatusCode::BAD_REQUEST);
    nirgends(&u.pool, u.dir.path(), &geheim).await;
    nirgends(&u.pool, u.dir.path(), "Passphrase-Unbenutzt-7x").await;
    assert!(zwischendateien(u.dir.path()).is_empty());
}

#[tokio::test]
async fn ein_abbruch_laesst_keine_zwischendatei_zurueck() {
    let u = umgebung().await;
    let schluessel = u.schluessel_text();
    let body = multipart(&[
        ("schluessel", None, schluessel.as_bytes()),
        ("block", Some("b"), &u.block),
    ]);

    // Die Verbindung reißt mitten im Block ab.
    let haelfte = body.len() - u.block.len() / 2;
    let stuecke: Vec<Result<Vec<u8>, std::io::Error>> = vec![
        Ok(body[..haelfte].to_vec()),
        Err(std::io::Error::other("Verbindung abgebrochen")),
    ];
    let resp = u
        .app
        .clone()
        .oneshot(anfrage_hochladen(
            &u.admin,
            Body::from_stream(futures::stream::iter(stuecke)),
        ))
        .await
        .unwrap();
    assert_ne!(resp.status(), StatusCode::OK);
    assert!(zwischendateien(u.dir.path()).is_empty());

    // Der Browser gibt während des Einspielens auf: der Handler fällt an irgendeiner Stelle.
    for ms in [1, 5, 20, 80, 300] {
        let _ = tokio::time::timeout(
            std::time::Duration::from_millis(ms),
            u.app
                .clone()
                .oneshot(anfrage_hochladen(&u.admin, Body::from(body.clone()))),
        )
        .await;
        assert!(
            zwischendateien(u.dir.path()).is_empty(),
            "nach {ms} ms: {:?}",
            zwischendateien(u.dir.path())
        );
    }
}

#[tokio::test]
async fn ein_zu_grosser_block_ist_413() {
    let u = umgebung().await;
    let schluessel = u.schluessel_text();
    let kopf = format!(
        "--{GRENZE}\r\nContent-Disposition: form-data; name=\"schluessel\"\r\n\r\n{schluessel}\r\n\
         --{GRENZE}\r\nContent-Disposition: form-data; name=\"block\"; filename=\"b\"\r\n\
         Content-Type: application/octet-stream\r\n\r\n"
    );
    // Über der Grenze, in Stücken erzeugt statt im Speicher gehalten.
    const MIB: usize = 1024 * 1024;
    let stuecke = std::iter::once(Ok::<_, std::io::Error>(kopf.into_bytes()))
        .chain((0..257).map(|_| Ok(vec![0u8; MIB])))
        .chain(std::iter::once(Ok(
            format!("\r\n--{GRENZE}--\r\n").into_bytes()
        )));
    let resp = u
        .app
        .clone()
        .oneshot(anfrage_hochladen(
            &u.admin,
            Body::from_stream(futures::stream::iter(stuecke)),
        ))
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::PAYLOAD_TOO_LARGE);
    let v: Value =
        serde_json::from_slice(&to_bytes(resp.into_body(), usize::MAX).await.unwrap()).unwrap();
    assert!(v["error"].as_str().unwrap().contains("Befehl"), "{v}");
    assert!(zwischendateien(u.dir.path()).is_empty());
    assert_eq!(eingespielt(&u.pool).await, 0);
}
