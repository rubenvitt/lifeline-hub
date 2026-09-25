//! LFH-690: Demo-Daten zur Laufzeit — Freischaltung und Rechte der Endpunkte.
//!
//! Spec: `openspec/changes/lfh-690-demo-daten-laufzeit-import/specs/demo-daten/spec.md`,
//! Anforderungen „Freischaltung per Umgebungsvariable“ und „Nur der System-Admin, nur die
//! eigene Organisation“; Herleitung in `design.md` D1–D3.

mod common;

use axum::body::{to_bytes, Body};
use axum::http::{header, Request, StatusCode};
use lifeline_hub::app::RouterOptionen;
use serde_json::Value;
use tower::ServiceExt;

/// Alle Demo-Endpunkte als `(Methode, Pfad)`.
const ENDPUNKTE: &[(&str, &str)] = &[
    ("GET", "/api/demo-daten"),
    ("POST", "/api/demo-daten"),
    ("DELETE", "/api/demo-daten"),
    ("POST", "/api/demo-daten/neu"),
];

/// Ein garantiert nicht registrierter `/api/`-Pfad als Vergleichsmaßstab.
const UNBEKANNT: &str = "/api/gibt-es-garantiert-nicht";

/// Antwort in Rohform: Status, Content-Type und Body-Bytes.
async fn roh(
    app: &axum::Router,
    methode: &str,
    uri: &str,
    cookie: Option<&str>,
) -> (StatusCode, String, Vec<u8>) {
    let mut req = Request::builder().method(methode).uri(uri);
    if let Some(c) = cookie {
        req = req.header(header::COOKIE, c.to_string());
    }
    let resp = app
        .clone()
        .oneshot(req.body(Body::empty()).unwrap())
        .await
        .unwrap();
    let status = resp.status();
    let ct = resp
        .headers()
        .get(header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("<fehlt>")
        .to_string();
    let bytes = to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap()
        .to_vec();
    (status, ct, bytes)
}

/// Ohne Freischaltung ist jeder Demo-Pfad von einem unbekannten `/api/`-Pfad nicht zu
/// unterscheiden: 404, gleicher Content-Type, gleicher Body — anonym wie als Admin, bei jeder
/// Methode. Ein 401/403/405 verriete, dass der Pfad existiert.
#[tokio::test]
async fn ohne_freischaltung_antworten_alle_demo_pfade_wie_ein_unbekannter_pfad() {
    let (app, _pool) = common::setup_mit_optionen(RouterOptionen::default()).await;
    let admin = common::login_cookie(&app, "admin", "startpw12").await;

    for cookie in [None, Some(admin.as_str())] {
        let wer = if cookie.is_some() { "Admin" } else { "anonym" };
        for (methode, pfad) in ENDPUNKTE {
            let (ref_status, ref_ct, ref_body) = roh(&app, methode, UNBEKANNT, cookie).await;
            assert_eq!(
                ref_status,
                StatusCode::NOT_FOUND,
                "Vergleichspfad muss 404 sein"
            );

            let (status, ct, body) = roh(&app, methode, pfad, cookie).await;
            assert!(
                ![
                    StatusCode::UNAUTHORIZED,
                    StatusCode::FORBIDDEN,
                    StatusCode::METHOD_NOT_ALLOWED
                ]
                .contains(&status),
                "[{wer}] {methode} {pfad}: {status} verrät den Pfad"
            );
            assert_eq!(status, ref_status, "[{wer}] {methode} {pfad}: Status");
            assert_eq!(ct, ref_ct, "[{wer}] {methode} {pfad}: Content-Type");
            assert_eq!(
                body,
                ref_body,
                "[{wer}] {methode} {pfad}: Body {:?}",
                String::from_utf8_lossy(&body)
            );
            let json: Value = serde_json::from_slice(&body).expect("Body ist JSON");
            assert!(json["error"].is_string(), "Envelope mit `error`: {json}");
        }
    }
}

/// Mit Freischaltung: anonym 401 auf jedem Endpunkt.
#[tokio::test]
async fn mit_freischaltung_anonym_401() {
    let (app, _pool) = common::setup_mit_optionen(RouterOptionen { demo_daten: true }).await;
    for (methode, pfad) in ENDPUNKTE {
        let (status, _ct, _body) = roh(&app, methode, pfad, None).await;
        assert_eq!(status, StatusCode::UNAUTHORIZED, "{methode} {pfad}");
    }
}

/// Mit Freischaltung: eine Führungskraft (Zugang zur Verwaltung, aber kein System-Admin)
/// bekommt auf jedem Endpunkt 403.
#[tokio::test]
async fn mit_freischaltung_fuehrungskraft_403() {
    let (app, _pool) = common::setup_mit_optionen(RouterOptionen { demo_daten: true }).await;
    let admin = common::login_cookie(&app, "admin", "startpw12").await;
    common::benutzer_anlegen(&app, &admin, "fuehrung", "fuehrungskraft").await;
    let fk = common::login_cookie(&app, "fuehrung", "fuehrungpw1").await;

    for (methode, pfad) in ENDPUNKTE {
        let (status, _ct, _body) = roh(&app, methode, pfad, Some(&fk)).await;
        assert_eq!(status, StatusCode::FORBIDDEN, "{methode} {pfad}");
    }
}

/// Mit Freischaltung: der Admin bekommt den Status „nicht importiert“ ohne Kopf und ohne
/// Bericht. Die Felder sind abwesend, nicht `null` (LFH-265).
#[tokio::test]
async fn mit_freischaltung_admin_status_nicht_importiert() {
    let (app, _pool) = common::setup_mit_optionen(RouterOptionen { demo_daten: true }).await;
    let admin = common::login_cookie(&app, "admin", "startpw12").await;

    let (status, v) = common::anfrage(&app, "GET", "/api/demo-daten", &admin, None).await;
    assert_eq!(status, StatusCode::OK, "{v}");
    assert_eq!(v["importiert"], Value::Bool(false));
    let o = v.as_object().expect("Objekt");
    assert!(!o.contains_key("import"), "import muss ABSENT sein: {v}");
    assert!(!o.contains_key("bericht"), "bericht muss ABSENT sein: {v}");
}

/// Mit Freischaltung: die schreibenden Endpunkte tragen die echten Codes aus D3. Ohne
/// aktiven Import ist Entfernen 409, Import 201 und Neu-Import 200; der Rumpf ist in jedem
/// Fall der Status im Envelope-freien DTO, beim Fehler der `{error}`-Envelope.
#[tokio::test]
async fn mit_freischaltung_schreibende_endpunkte_tragen_die_codes_aus_d3() {
    let (app, _pool) = common::setup_mit_optionen(RouterOptionen { demo_daten: true }).await;
    let admin = common::login_cookie(&app, "admin", "startpw12").await;

    let (status, v) = common::anfrage(&app, "DELETE", "/api/demo-daten", &admin, None).await;
    assert_eq!(status, StatusCode::CONFLICT, "DELETE ohne Import: {v}");
    assert!(v["error"].is_string(), "{v}");

    let (status, v) = common::anfrage(&app, "POST", "/api/demo-daten", &admin, None).await;
    assert_eq!(status, StatusCode::CREATED, "POST: {v}");
    assert_eq!(v["importiert"], Value::Bool(true), "{v}");

    let (status, v) = common::anfrage(&app, "POST", "/api/demo-daten/neu", &admin, None).await;
    assert_eq!(status, StatusCode::OK, "POST /neu: {v}");
    assert_eq!(v["importiert"], Value::Bool(true), "{v}");

    let (status, v) = common::anfrage(&app, "DELETE", "/api/demo-daten", &admin, None).await;
    assert_eq!(status, StatusCode::OK, "DELETE: {v}");
    assert_eq!(v["importiert"], Value::Bool(false), "{v}");
}

/// `build_router` ist die Vorgabe „aus“: ohne Optionen gibt es keinen Demo-Pfad.
#[tokio::test]
async fn build_router_ohne_optionen_hat_keinen_demo_pfad() {
    let app = common::setup().await;
    let admin = common::login_cookie(&app, "admin", "startpw12").await;
    let (status, _ct, _body) = roh(&app, "GET", "/api/demo-daten", Some(&admin)).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
}

/// Importiert direkt über `importieren_tx` gegen den Pool des Test-States, ohne die HTTP-Route:
/// der Lesetest braucht einen Router ohne Demo-Freischaltung nicht anders als mit ihr, und so
/// hängt er nicht an den Routen. `write_retry!` ist außerhalb des Crates nicht nutzbar (seine
/// Helfer in `tx` sind crate-privat); `BEGIN IMMEDIATE` plus Commit ist derselbe
/// Transaktionsmodus ohne Retry, und in diesem Test schreibt niemand nebenher. `jetzt` ist die echte Uhr, damit die
/// Lese-Endpunkte „überfällig“ gegen ihre eigene Zeit rechnen.
async fn demo_importieren(pool: &sqlx::SqlitePool) -> (i64, chrono::NaiveDateTime) {
    let (org, admin_id): (i64, i64) =
        sqlx::query_as("SELECT org_id, id FROM benutzer WHERE benutzername = 'admin'")
            .fetch_one(pool)
            .await
            .unwrap();
    let jetzt = chrono::Utc::now().naive_utc();
    let mut tx = pool.begin_with("BEGIN IMMEDIATE").await.unwrap();
    let erg = lifeline_hub::demo::import::importieren_tx(&mut tx, org, admin_id, jetzt)
        .await
        .expect("importieren");
    tx.commit().await.unwrap();
    (erg.einsatz_id, jetzt)
}

/// Liste eines Lese-Endpunkts des Demo-Einsatzes, als der importierende Admin über den echten
/// GET-Endpunkt gelesen. Belegt wird, dass das Modul Daten trägt und wie viele: Status 200 und
/// eine Liste, deren Länge der Aufrufer gegen das Drehbuch prüft. Die Sichtbarkeit für andere
/// Rollen belegt das nicht: Der System-Admin kommt am Modul-Guard immer vorbei
/// (`einsatz::berechtigung::fordere_modul_zugriff`, Admin-Mindest-Guard). Ein ausgeblendetes
/// Modul liefert ihm also kein 403 (gemessen per Mutationsprobe, design.md Nachtrag Block 4.3).
async fn liste(app: &axum::Router, cookie: &str, einsatz: i64, pfad: &str) -> Vec<Value> {
    let (status, v) = common::anfrage(
        app,
        "GET",
        &format!("/api/einsaetze/{einsatz}{pfad}"),
        cookie,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{pfad}: {v}");
    v.as_array()
        .unwrap_or_else(|| panic!("{pfad}: keine Liste: {v}"))
        .clone()
}

/// LFH-690 Task 4.3: nach dem Import trägt jedes Modul des Demo-Einsatzes Datensätze, gelesen
/// über die echten GET-Endpunkte als der importierende Admin. Dazu die Spec-Szenarien
/// „Überblick zeigt die Lage“ (Übung in der Einsatzliste, Lagekennzahl `evakuiert`, keine
/// `pegel`), „Sichtung nach BBK“ und „Einzige Mitgliedschaft“ über die API.
#[tokio::test]
async fn import_ist_je_modul_ueber_die_lese_endpunkte_sichtbar() {
    let (app, pool) = common::setup_mit_pool().await;
    let admin = common::login_cookie(&app, "admin", "startpw12").await;
    let (e, jetzt) = demo_importieren(&pool).await;

    // Überblick zeigt die Lage.
    let (status, einsatz) =
        common::anfrage(&app, "GET", &format!("/api/einsaetze/{e}"), &admin, None).await;
    assert_eq!(status, StatusCode::OK, "{einsatz}");
    assert_eq!(einsatz["einsatzart"], "uebung");
    assert_eq!(einsatz["lagekennzahlen"], serde_json::json!(["evakuiert"]));
    let (status, alle) = common::anfrage(&app, "GET", "/api/einsaetze", &admin, None).await;
    assert_eq!(status, StatusCode::OK);
    let in_liste: Vec<&Value> = alle
        .as_array()
        .unwrap()
        .iter()
        .filter(|x| x["id"] == e)
        .collect();
    assert_eq!(in_liste.len(), 1);
    assert_eq!(in_liste[0]["einsatzart"], "uebung");
    assert_eq!(
        in_liste[0]["lagekennzahlen"],
        serde_json::json!(["evakuiert"])
    );

    // Einzige Mitgliedschaft.
    let mitglieder = liste(&app, &admin, e, "/mitglieder").await;
    assert_eq!(mitglieder.len(), 1, "{mitglieder:?}");

    // Je Modul die Zahl aus dem Drehbuch.
    for (pfad, n) in [
        ("/abschnitte", 4),
        ("/einheiten", 5),
        ("/fahrzeuge", 8),
        ("/personal", 12),
        ("/personen", 12),
        ("/uhs", 1),
        ("/bereitstellungsraeume", 1),
        ("/zonen", 2),
        ("/gefahrengebiete", 2),
        ("/meldungen", 8),
        ("/auftraege", 5),
        ("/befehle", 1),
        ("/lageberichte", 1),
        ("/erinnerungen", 3),
    ] {
        assert_eq!(liste(&app, &admin, e, pfad).await.len(), n, "{pfad}");
    }
    assert!(!liste(&app, &admin, e, "/etb").await.is_empty());

    // Betreuung: ein Bezirk, eine Stelle.
    let (status, betreuung) = common::anfrage(
        &app,
        "GET",
        &format!("/api/einsaetze/{e}/betreuung"),
        &admin,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{betreuung}");
    assert_eq!(betreuung["bezirke"].as_array().unwrap().len(), 1);
    assert_eq!(betreuung["stellen"].as_array().unwrap().len(), 1);

    // Sichtung nach BBK: jede Kategorie SK I–IV mindestens einmal.
    let personen = liste(&app, &admin, e, "/personen").await;
    for sk in ["sk1", "sk2", "sk3", "sk4"] {
        assert!(
            personen.iter().any(|p| p["aktuelle_sichtung"] == sk),
            "{sk} fehlt"
        );
    }

    // Rückmeldungen: fünf Einheiten, genau eine überfällig (Frist gegen die echte Uhr).
    let (status, rm) = common::anfrage(
        &app,
        "GET",
        &format!("/api/einsaetze/{e}/meldungen/rueckmeldungen"),
        &admin,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{rm}");
    let einheiten = rm["einheiten"].as_array().unwrap();
    assert_eq!(einheiten.len(), 5, "{rm}");
    let jetzt = jetzt.format("%Y-%m-%d %H:%M:%S").to_string();
    let ueberfaellig = einheiten
        .iter()
        .filter(|r| r["faellig_at"].as_str().unwrap() < jetzt.as_str())
        .count();
    assert_eq!(ueberfaellig, 1, "{rm}");

    // Befehl und Lagebericht freigegeben.
    assert_eq!(
        liste(&app, &admin, e, "/befehle").await[0]["status"],
        "freigegeben"
    );
    assert_eq!(
        liste(&app, &admin, e, "/lageberichte").await[0]["status"],
        "freigegeben"
    );
}

// ---------------------------------------------------------------------------------------------
// Routen, Neu-Import, Live (Task 5.1, design.md D3, D7, D11)
// ---------------------------------------------------------------------------------------------

const AN: RouterOptionen = RouterOptionen { demo_daten: true };

/// Einen Demo-Endpunkt aufrufen; liefert `(Status, Body)`.
async fn demo(app: &axum::Router, cookie: &str, methode: &str, pfad: &str) -> (StatusCode, Value) {
    common::anfrage(app, methode, pfad, cookie, None).await
}

/// Der Status über GET. Jede Schreibantwort muss ihm gleichen: sie trägt den neuen Stand, damit
/// das Frontend ohne zweiten Abruf weiß, wo es steht (D3).
async fn status_lesen(app: &axum::Router, cookie: &str) -> Value {
    let (status, v) = demo(app, cookie, "GET", "/api/demo-daten").await;
    assert_eq!(status, StatusCode::OK, "{v}");
    v
}

fn einsatz_id(status: &Value) -> i64 {
    status["import"]["einsatz_id"]
        .as_i64()
        .unwrap_or_else(|| panic!("kein aktiver Import: {status}"))
}

async fn aktive_koepfe(pool: &sqlx::SqlitePool, org_id: i64) -> i64 {
    sqlx::query_scalar("SELECT COUNT(*) FROM demo_import WHERE org_id = ? AND entfernt_at IS NULL")
        .bind(org_id)
        .fetch_one(pool)
        .await
        .unwrap()
}

async fn einsatz_existiert(pool: &sqlx::SqlitePool, id: i64) -> bool {
    sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM einsatz WHERE id = ?")
        .bind(id)
        .fetch_one(pool)
        .await
        .unwrap()
        == 1
}

async fn org_von(pool: &sqlx::SqlitePool, benutzername: &str) -> i64 {
    sqlx::query_scalar("SELECT org_id FROM benutzer WHERE benutzername = ?")
        .bind(benutzername)
        .fetch_one(pool)
        .await
        .unwrap()
}

/// Wartet kurz auf die nächste Nachricht eines Live-Empfängers. `None`, wenn keine kommt.
async fn naechste(
    rx: &mut tokio::sync::broadcast::Receiver<lifeline_hub::live::LiveNachricht>,
) -> Option<lifeline_hub::live::LiveNachricht> {
    tokio::time::timeout(std::time::Duration::from_millis(200), rx.recv())
        .await
        .ok()
        .and_then(|r| r.ok())
}

/// Spec „Status der Demo-Daten“ (beide Szenarien) und die 409-Paare aus D3: vorher „nicht
/// importiert“ ohne Bericht, nach dem Import Kopf und Bericht mit „angelegt“, ein zweiter Import
/// ist 409, nach dem Entfernen „nicht importiert“ mit dem Bericht des Entfernens, ein zweites
/// Entfernen ist 409. Jede Schreibantwort gleicht dem GET danach, und ein 409 ändert nichts.
#[tokio::test]
async fn status_vorher_nachher_und_409_paare() {
    let (app, pool) = common::setup_mit_optionen(AN).await;
    let admin = common::login_cookie(&app, "admin", "startpw12").await;

    let vorher = status_lesen(&app, &admin).await;
    assert_eq!(vorher, serde_json::json!({ "importiert": false }));

    let (status, importiert) = demo(&app, &admin, "POST", "/api/demo-daten").await;
    assert_eq!(status, StatusCode::CREATED, "{importiert}");
    assert_eq!(importiert, status_lesen(&app, &admin).await);
    assert_eq!(importiert["importiert"], true);
    let e = einsatz_id(&importiert);
    assert!(einsatz_existiert(&pool, e).await);
    assert_eq!(
        importiert["import"]["einsatz_bezeichnung"],
        "ÜBUNG – Starkregen Musterstadt"
    );
    assert!(importiert["import"]["id"].is_i64(), "{importiert}");
    assert!(
        importiert["import"]["importiert_at"].is_string(),
        "{importiert}"
    );
    assert_eq!(importiert["bericht"]["vorgang"], "importiert");
    let je_art = importiert["bericht"]["je_art"].as_array().unwrap();
    assert_eq!(je_art.len(), 3, "{importiert}");
    for zeile in je_art {
        assert!(zeile["angelegt"].as_i64().unwrap() > 0, "{zeile}");
    }

    // Zweiter Import: 409, und der Stand bleibt.
    let (status, v) = demo(&app, &admin, "POST", "/api/demo-daten").await;
    assert_eq!(status, StatusCode::CONFLICT, "{v}");
    assert!(v["error"].is_string(), "{v}");
    assert_eq!(status_lesen(&app, &admin).await, importiert);

    let (status, entfernt) = demo(&app, &admin, "DELETE", "/api/demo-daten").await;
    assert_eq!(status, StatusCode::OK, "{entfernt}");
    assert_eq!(entfernt, status_lesen(&app, &admin).await);
    assert_eq!(entfernt["importiert"], false);
    assert!(
        !entfernt.as_object().unwrap().contains_key("import"),
        "import muss ABSENT sein: {entfernt}"
    );
    assert_eq!(entfernt["bericht"]["vorgang"], "entfernt");
    for zeile in entfernt["bericht"]["je_art"].as_array().unwrap() {
        assert!(zeile["entfernt"].as_i64().unwrap() > 0, "{zeile}");
        assert_eq!(zeile["behalten"], 0, "{zeile}");
    }
    assert!(!einsatz_existiert(&pool, e).await);

    // Zweites Entfernen: 409, und der Bericht des Entfernens bleibt stehen.
    let (status, v) = demo(&app, &admin, "DELETE", "/api/demo-daten").await;
    assert_eq!(status, StatusCode::CONFLICT, "{v}");
    assert!(v["error"].is_string(), "{v}");
    assert_eq!(status_lesen(&app, &admin).await, entfernt);
}

/// Spec „Neu importieren“, Scenario „Import, Entfernen, Import gegen das aktuelle Schema“:
/// gegen die voll migrierte Test-DB gelingen alle drei Schritte über HTTP, und der zweite
/// Import meldet dieselben Zahlen wie der erste. `zeitpunkt` folgt der Uhr und bleibt außen vor.
#[tokio::test]
async fn import_entfernen_import_meldet_dieselben_zahlen() {
    let (app, pool) = common::setup_mit_optionen(AN).await;
    let admin = common::login_cookie(&app, "admin", "startpw12").await;
    let org = org_von(&pool, "admin").await;

    let (s1, erster) = demo(&app, &admin, "POST", "/api/demo-daten").await;
    assert_eq!(s1, StatusCode::CREATED, "{erster}");
    let (s2, entfernt) = demo(&app, &admin, "DELETE", "/api/demo-daten").await;
    assert_eq!(s2, StatusCode::OK, "{entfernt}");
    let (s3, zweiter) = demo(&app, &admin, "POST", "/api/demo-daten").await;
    assert_eq!(s3, StatusCode::CREATED, "{zweiter}");

    assert_eq!(zweiter["bericht"]["vorgang"], "importiert");
    assert_eq!(zweiter["bericht"]["je_art"], erster["bericht"]["je_art"]);
    assert_ne!(zweiter["import"]["id"], erster["import"]["id"]);
    assert!(einsatz_id(&zweiter) > einsatz_id(&erster), "ID-Sperre (D6)");
    assert!(!einsatz_existiert(&pool, einsatz_id(&erster)).await);
    assert_eq!(aktive_koepfe(&pool, org).await, 1);
}

/// Spec „Neu importieren“, Scenario „Neu importieren ersetzt den Stand“, und „Invalidierung
/// nach Import und Entfernen“: danach besteht genau ein aktiver Import mit einem neuen
/// Demo-Einsatz, der alte existiert nicht mehr (auch nicht über die API), und ein vorher
/// abonnierter Live-Strom des alten Einsatzes erhält `lagged`.
#[tokio::test]
async fn neu_import_ersetzt_den_einsatz_und_sendet_lagged() {
    let (app, pool, live) = common::setup_mit_optionen_und_live(AN).await;
    let admin = common::login_cookie(&app, "admin", "startpw12").await;
    let org = org_von(&pool, "admin").await;

    let (_, erster) = demo(&app, &admin, "POST", "/api/demo-daten").await;
    let alt = einsatz_id(&erster);
    let mut rx = live.abonniere(alt);

    let (status, neu) = demo(&app, &admin, "POST", "/api/demo-daten/neu").await;
    assert_eq!(status, StatusCode::OK, "{neu}");
    assert_eq!(neu, status_lesen(&app, &admin).await);
    assert_eq!(neu["importiert"], true);
    assert_eq!(neu["bericht"]["vorgang"], "importiert");
    assert_eq!(neu["bericht"]["je_art"], erster["bericht"]["je_art"]);
    let e = einsatz_id(&neu);
    assert!(e > alt, "neuer Demo-Einsatz über der gesperrten ID");
    assert_ne!(neu["import"]["id"], erster["import"]["id"]);
    assert_eq!(aktive_koepfe(&pool, org).await, 1);
    assert!(!einsatz_existiert(&pool, alt).await);
    let (status, _) =
        common::anfrage(&app, "GET", &format!("/api/einsaetze/{alt}"), &admin, None).await;
    assert_eq!(status, StatusCode::NOT_FOUND);

    let n = naechste(&mut rx).await.expect("lagged auf dem alten Kanal");
    assert_eq!(n.event, lifeline_hub::live::LiveEvent::Lagged);
    assert_eq!(n.data, "resync");
    assert!(naechste(&mut rx).await.is_none(), "genau ein Signal");
}

/// Spec „Neu importieren“: ohne aktiven Import läuft der Vorgang wie ein erstmaliger Import
/// (200 statt 201, weil `/neu` keinen neuen Kopf „erzeugt“, sondern den Stand setzt, D3).
#[tokio::test]
async fn neu_import_ohne_aktiven_import_importiert() {
    let (app, pool) = common::setup_mit_optionen(AN).await;
    let admin = common::login_cookie(&app, "admin", "startpw12").await;
    let org = org_von(&pool, "admin").await;

    let (status, v) = demo(&app, &admin, "POST", "/api/demo-daten/neu").await;
    assert_eq!(status, StatusCode::OK, "{v}");
    assert_eq!(v, status_lesen(&app, &admin).await);
    assert_eq!(v["importiert"], true);
    assert!(einsatz_existiert(&pool, einsatz_id(&v)).await);
    assert_eq!(aktive_koepfe(&pool, org).await, 1);
}

/// Alle Zeilen einer Tabelle, jede als Text aus `quote()` aller Spalten, in `rowid`-Folge.
/// Zeilengleich statt bloß gleich viele: eine geänderte Spalte fällt auf.
async fn tabellen_zeilen(pool: &sqlx::SqlitePool, tabelle: &str) -> Vec<String> {
    let spalten: Vec<String> =
        sqlx::query_scalar("SELECT name FROM pragma_table_info(?) ORDER BY cid")
            .bind(tabelle)
            .fetch_all(pool)
            .await
            .unwrap();
    assert!(!spalten.is_empty(), "Tabelle {tabelle} hat keine Spalten");
    let ausdruck = spalten
        .iter()
        .map(|s| format!("quote(\"{s}\")"))
        .collect::<Vec<_>>()
        .join(" || '|' || ");
    // `tabelle` kommt aus `sqlite_master` bzw. aus festen Literalen dieser Datei, nie aus
    // einer Eingabe.
    let sql = format!("SELECT {ausdruck} FROM \"{tabelle}\" ORDER BY rowid");
    sqlx::query_scalar(sqlx::AssertSqlSafe(sql))
        .fetch_all(pool)
        .await
        .unwrap()
}

/// Die Zeilen der Demo-Verwaltung und aller Einsätze, zeilengleich.
async fn demo_stand(pool: &sqlx::SqlitePool) -> Vec<(String, Vec<String>)> {
    let mut stand = Vec::new();
    for t in [
        "demo_import",
        "demo_herkunft",
        "einsatz",
        "fahrzeug",
        "personal",
        "material",
    ] {
        stand.push((t.to_string(), tabellen_zeilen(pool, t).await));
    }
    stand
}

/// Spec „Neu importieren“: scheitert der Import, bleibt der bisherige Demo-Stand erhalten
/// (D11, ein `write_retry!` um Entfernen und Import). Der Fehler kommt spät im Drehbuch aus
/// einem Trigger auf `lagebericht` — nach dem Entfernen und nach Einsatz, Kopf und Stammdaten
/// des neuen Imports. Der Trigger ist ein normaler (kein TEMP-)Trigger, weil er für jede
/// Verbindung des Pools gelten muss; der Test legt ihn erst nach dem ersten Import an und
/// entfernt ihn danach. Die Gegenprobe ohne Trigger zeigt, dass er die Ursache war.
#[tokio::test]
async fn neu_import_mit_importfehler_laesst_den_alten_stand_stehen() {
    let (app, pool, live) = common::setup_mit_optionen_und_live(AN).await;
    let admin = common::login_cookie(&app, "admin", "startpw12").await;

    let (_, erster) = demo(&app, &admin, "POST", "/api/demo-daten").await;
    let alt = einsatz_id(&erster);
    let mut rx = live.abonniere(alt);

    sqlx::query(
        "CREATE TRIGGER test_lagebericht_nicht_anlegen BEFORE INSERT ON lagebericht \
         BEGIN SELECT RAISE(ABORT, 'Testfehler: Lagebericht'); END",
    )
    .execute(&pool)
    .await
    .unwrap();
    let vorher = demo_stand(&pool).await;

    let (status, v) = demo(&app, &admin, "POST", "/api/demo-daten/neu").await;
    // Der Trigger-Abbruch ist kein fachlicher Fall aus D3, sondern ein unerwarteter
    // DB-Fehler: 500 mit Envelope (gemessen). Tragend ist der unveränderte Stand darunter.
    assert_eq!(status, StatusCode::INTERNAL_SERVER_ERROR, "{v}");
    assert!(v["error"].is_string(), "{v}");

    assert_eq!(
        demo_stand(&pool).await,
        vorher,
        "alter Stand bleibt zeilengleich"
    );
    assert_eq!(status_lesen(&app, &admin).await, erster);
    assert!(einsatz_existiert(&pool, alt).await);
    assert!(
        naechste(&mut rx).await.is_none(),
        "kein lagged nach Rollback"
    );

    sqlx::query("DROP TRIGGER test_lagebericht_nicht_anlegen")
        .execute(&pool)
        .await
        .unwrap();
    let (status, v) = demo(&app, &admin, "POST", "/api/demo-daten/neu").await;
    assert_eq!(status, StatusCode::OK, "Gegenprobe ohne Trigger: {v}");
    assert!(!einsatz_existiert(&pool, alt).await);
}

/// Legt eine zweite Organisation mit eigenem System-Admin per SQL an (bootstrap läuft nur
/// einmal) und seedet ihre Kataloge wie `bootstrap_admin`. Liefert `(org_id, cookie)`.
async fn zweite_org_mit_admin(app: &axum::Router, pool: &sqlx::SqlitePool) -> (i64, String) {
    let org: i64 = sqlx::query_scalar(
        "INSERT INTO organisation (name, tz_organisation) \
         VALUES ('Org B', 'hilfsorganisation') RETURNING id",
    )
    .fetch_one(pool)
    .await
    .unwrap();
    let hash = lifeline_hub::auth::password::hash("adminbpw12").unwrap();
    sqlx::query(
        "INSERT INTO benutzer (org_id, anzeigename, benutzername, passwort_hash, system_rolle) \
         VALUES (?, 'Admin B', 'admin-b', ?, 'admin')",
    )
    .bind(org)
    .bind(&hash)
    .execute(pool)
    .await
    .unwrap();
    for (label, kategorie, fms_anker, sortier) in lifeline_hub::fahrzeug::STATUS_STARTLISTE {
        sqlx::query(
            "INSERT INTO fahrzeug_status (org_id, label, kategorie, fms_anker, sortier) \
             VALUES (?, ?, ?, ?, ?)",
        )
        .bind(org)
        .bind(label)
        .bind(kategorie)
        .bind(fms_anker)
        .bind(sortier)
        .execute(pool)
        .await
        .unwrap();
    }
    for (label, sortier) in lifeline_hub::personal::QUALIFIKATION_STARTLISTE {
        sqlx::query("INSERT INTO qualifikation (org_id, label, sortier) VALUES (?, ?, ?)")
            .bind(org)
            .bind(label)
            .bind(sortier)
            .execute(pool)
            .await
            .unwrap();
    }
    for (label, kategorie, sortier) in lifeline_hub::personal::PERSONAL_STATUS_STARTLISTE {
        sqlx::query(
            "INSERT INTO personal_status (org_id, label, kategorie, sortier) VALUES (?, ?, ?, ?)",
        )
        .bind(org)
        .bind(label)
        .bind(kategorie)
        .bind(sortier)
        .execute(pool)
        .await
        .unwrap();
    }
    for (label, f, u, m, sortier) in lifeline_hub::einheit::EINHEIT_TYP_STARTLISTE {
        sqlx::query(
            "INSERT INTO einheit_typ \
                (org_id, label, soll_fuehrer, soll_unterfuehrer, soll_mannschaft, sortier) \
             VALUES (?, ?, ?, ?, ?, ?)",
        )
        .bind(org)
        .bind(label)
        .bind(f)
        .bind(u)
        .bind(m)
        .bind(sortier)
        .execute(pool)
        .await
        .unwrap();
    }
    let cookie = common::login_cookie(app, "admin-b", "adminbpw12").await;
    (org, cookie)
}

/// Spec „Nur der System-Admin, nur die eigene Organisation“, Scenario „Zwei Organisationen“:
/// Status, Import und Entfernen beziehen sich immer auf die Org des Admins. B importiert,
/// während A schon importiert hat; der Einsatz entsteht in B, jeder Status zeigt nur den
/// eigenen Import, und Entfernen durch B lässt A samt Live-Kanal unberührt.
#[tokio::test]
async fn zwei_organisationen_bleiben_getrennt() {
    let (app, pool, live) = common::setup_mit_optionen_und_live(AN).await;
    let admin_a = common::login_cookie(&app, "admin", "startpw12").await;
    let org_a = org_von(&pool, "admin").await;
    let (org_b, admin_b) = zweite_org_mit_admin(&app, &pool).await;
    assert_ne!(org_a, org_b);

    let (status, a) = demo(&app, &admin_a, "POST", "/api/demo-daten").await;
    assert_eq!(status, StatusCode::CREATED, "{a}");
    assert_eq!(
        status_lesen(&app, &admin_b).await,
        serde_json::json!({ "importiert": false }),
        "B sieht den Import von A nicht"
    );
    // B hat nichts zu entfernen, auch wenn A importiert hat.
    let (status, v) = demo(&app, &admin_b, "DELETE", "/api/demo-daten").await;
    assert_eq!(status, StatusCode::CONFLICT, "{v}");

    let (status, b) = demo(&app, &admin_b, "POST", "/api/demo-daten").await;
    assert_eq!(
        status,
        StatusCode::CREATED,
        "B importiert trotz aktivem Import von A: {b}"
    );
    let (e_a, e_b) = (einsatz_id(&a), einsatz_id(&b));
    assert_ne!(e_a, e_b);
    let org_des_einsatzes = |id: i64| {
        let pool = pool.clone();
        async move {
            sqlx::query_scalar::<_, i64>("SELECT org_id FROM einsatz WHERE id = ?")
                .bind(id)
                .fetch_one(&pool)
                .await
                .unwrap()
        }
    };
    assert_eq!(org_des_einsatzes(e_a).await, org_a);
    assert_eq!(org_des_einsatzes(e_b).await, org_b);
    assert_eq!(status_lesen(&app, &admin_a).await, a);
    assert_eq!(status_lesen(&app, &admin_b).await, b);

    let mut rx_a = live.abonniere(e_a);
    let mut rx_b = live.abonniere(e_b);
    let (status, v) = demo(&app, &admin_b, "DELETE", "/api/demo-daten").await;
    assert_eq!(status, StatusCode::OK, "{v}");
    assert_eq!(v["importiert"], false);
    assert!(!einsatz_existiert(&pool, e_b).await);
    assert!(einsatz_existiert(&pool, e_a).await, "A bleibt");
    assert_eq!(
        status_lesen(&app, &admin_a).await,
        a,
        "Status von A unverändert"
    );
    assert_eq!(aktive_koepfe(&pool, org_a).await, 1);
    assert_eq!(
        naechste(&mut rx_b).await.map(|n| n.event),
        Some(lifeline_hub::live::LiveEvent::Lagged)
    );
    assert!(naechste(&mut rx_a).await.is_none(), "A bekommt kein Signal");
}

/// Spec „Invalidierung nach Import und Entfernen“, Scenario „Offener Tab beim Entfernen“: ein
/// vor dem Entfernen abonnierter Live-Strom des Demo-Einsatzes erhält das
/// Resynchronisations-Signal, das vorhandene Kontrollereignis `lagged` (D7). Ein Strom eines
/// anderen Einsatzes bekommt nichts.
#[tokio::test]
async fn entfernen_sendet_lagged_an_den_kanal_des_demo_einsatzes() {
    let (app, _pool, live) = common::setup_mit_optionen_und_live(AN).await;
    let admin = common::login_cookie(&app, "admin", "startpw12").await;
    let nachbar = common::einsatz_anlegen(&app, &admin).await;

    let (_, v) = demo(&app, &admin, "POST", "/api/demo-daten").await;
    let e = einsatz_id(&v);
    let mut rx = live.abonniere(e);
    let mut rx_nachbar = live.abonniere(nachbar);

    let (status, v) = demo(&app, &admin, "DELETE", "/api/demo-daten").await;
    assert_eq!(status, StatusCode::OK, "{v}");

    let n = naechste(&mut rx).await.expect("lagged nach dem Entfernen");
    assert_eq!(n.event, lifeline_hub::live::LiveEvent::Lagged);
    assert_eq!(n.data, "resync");
    assert!(naechste(&mut rx).await.is_none(), "genau ein Signal");
    assert!(naechste(&mut rx_nachbar).await.is_none());
}

/// Spec „Keine Wiederverwendung der Einsatz-ID“, Scenario „Echter Einsatz nach dem Entfernen“:
/// der Demo-Einsatz ist der jüngste (frische DB, kein anderer Einsatz), wird entfernt, und der
/// danach über `POST /api/einsaetze` angelegte echte Einsatz liegt über seiner ID.
#[tokio::test]
async fn echter_einsatz_nach_dem_entfernen_hat_eine_groessere_id() {
    let (app, pool) = common::setup_mit_optionen(AN).await;
    let admin = common::login_cookie(&app, "admin", "startpw12").await;

    let (_, v) = demo(&app, &admin, "POST", "/api/demo-daten").await;
    let demo_id = einsatz_id(&v);
    let hoechste: i64 = sqlx::query_scalar("SELECT MAX(id) FROM einsatz")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(
        hoechste, demo_id,
        "Vorbedingung: Demo-Einsatz ist der jüngste"
    );

    let (status, _) = demo(&app, &admin, "DELETE", "/api/demo-daten").await;
    assert_eq!(status, StatusCode::OK);
    let echt = common::einsatz_anlegen(&app, &admin).await;
    assert!(
        echt > demo_id,
        "echt {echt} muss über dem Demo-Einsatz {demo_id} liegen"
    );
}

// ---------------------------------------------------------------------------------------------
// „DB wie vorher“ (Task 5.2, design.md D12)
// ---------------------------------------------------------------------------------------------

/// Tabellen, die der Vergleich bewusst auslässt, als Präfix (`sqlite_*`, `etb_eintrag_fts*`)
/// oder als Name. Begründung je Eintrag in D12 und Spec „Demo-Daten entfernen“:
/// SQLite-Verwaltung (auch `sqlite_sequence`), Migrationsbuch, die Schattentabellen der
/// Volltextsuche, Sitzungen und Anmeldeprotokoll, Benutzereinstellungen und der Kopf als
/// Historie. Das Präfix wird in Rust geprüft, nicht per `LIKE`: dort wäre `_` ein Platzhalter.
const AUSNAHME_PRAEFIXE: &[&str] = &["sqlite_", "etb_eintrag_fts"];
const AUSNAHMEN: &[&str] = &[
    "_sqlx_migrations",
    "session",
    "auth_audit",
    "benutzer_einstellungen",
    "demo_import",
];

/// Das Bild aller Nutzdatentabellen: die Tabellenliste aus dem Schema **entdeckt**, nicht
/// aufgezählt (D12), damit eine künftige Tabelle ohne Nachtrag mitgeprüft wird.
async fn db_bild(pool: &sqlx::SqlitePool) -> Vec<(String, Vec<String>)> {
    let tabellen: Vec<String> =
        sqlx::query_scalar("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
            .fetch_all(pool)
            .await
            .unwrap();
    let mut bild = Vec::new();
    for t in tabellen {
        if AUSNAHME_PRAEFIXE.iter().any(|p| t.starts_with(p)) || AUSNAHMEN.contains(&t.as_str()) {
            continue;
        }
        let zeilen = tabellen_zeilen(pool, &t).await;
        bild.push((t, zeilen));
    }
    bild
}

/// Ein echter Nachbar-Einsatz mit ETB, Person und disponierten echten Stammdaten, per HTTP.
/// Dazu je Art eine freie Stammdatenzeile mit der Kennung eines Demo-Datensatzes: der Import
/// benutzt sie mit („mitbenutzt“), ohne sie zu markieren — die wahrscheinlichste Stelle, an der
/// ein Import Spuren hinterließe (Disposition, FMS-Status an der Stammdatenzeile).
async fn nachbar_mit_stammdaten(app: &axum::Router, admin: &str) {
    let e = common::einsatz_anlegen(app, admin).await;
    let post = |pfad: String, body: String| async move {
        let (status, v) = common::anfrage(app, "POST", &pfad, admin, Some(&body)).await;
        assert!(status.is_success(), "POST {pfad}: {status} {v}");
        v
    };
    let fz = post(
        "/api/fahrzeuge".into(),
        r#"{"funkrufname":"Nachbar 44-1","kennzeichen":"XX-NB 1"}"#.into(),
    )
    .await;
    post(
        format!("/api/einsaetze/{e}/fahrzeuge"),
        format!(r#"{{"fahrzeug_id":{}}}"#, fz["id"]),
    )
    .await;
    let pers = post(
        "/api/personal".into(),
        r#"{"name":"Nachbar Person"}"#.into(),
    )
    .await;
    post(
        format!("/api/einsaetze/{e}/personal"),
        format!(r#"{{"personal_id":{}}}"#, pers["id"]),
    )
    .await;
    let mat = post(
        "/api/material".into(),
        r#"{"bezeichnung":"Nachbar-Decke","kategorie":"Betreuung"}"#.into(),
    )
    .await;
    post(
        format!("/api/einsaetze/{e}/material"),
        format!(r#"{{"material_id":{},"menge":5}}"#, mat["id"]),
    )
    .await;
    post(
        format!("/api/einsaetze/{e}/etb"),
        r#"{"typ":"meldung","inhalt":"Lage im Nachbar-Einsatz"}"#.into(),
    )
    .await;
    post(
        format!("/api/einsaetze/{e}/personen"),
        r#"{"name":"Muster","vorname":"Max"}"#.into(),
    )
    .await;

    // Freie Zeilen mit Demo-Kennung: mitbenutzt statt angelegt.
    post(
        "/api/fahrzeuge".into(),
        r#"{"funkrufname":"Musterstadt 11-1","kennzeichen":"XX-MS 11"}"#.into(),
    )
    .await;
    post(
        "/api/personal".into(),
        r#"{"name":"Vorhandene Person","personalnummer":"DEMO-P-001"}"#.into(),
    )
    .await;
    post(
        "/api/material".into(),
        r#"{"bezeichnung":"Vorhandenes Material","kategorie":"Betreuung","bestandsnummer":"DEMO-M-001"}"#
            .into(),
    )
    .await;
}

/// Spec „Demo-Daten entfernen“, Scenario „Stand vor dem Import“ (D12): nach Import und
/// Entfernen tragen alle Nutzdatentabellen dieselben Zeilen wie vorher. Der Stand „vorher“
/// entsteht nach Anmeldung und Aufbau; zwischen den Bildern laufen nur die zwei Demo-Aufrufe.
///
/// Mutationsprobe (nicht committet, Report Block 5): `LOESCHWEGE` in `src/demo/entfernen.rs`
/// ohne den Material-Schritt → der Test wird rot und nennt `demo_herkunft` und `material`.
#[tokio::test]
async fn import_entfernen_stellt_den_stand_wieder_her() {
    let (app, pool) = common::setup_mit_optionen(AN).await;
    let admin = common::login_cookie(&app, "admin", "startpw12").await;
    nachbar_mit_stammdaten(&app, &admin).await;

    let vorher = db_bild(&pool).await;
    assert!(
        vorher.iter().any(|(t, _)| t == "einsatz") && vorher.len() > 50,
        "Tabellen entdeckt: {}",
        vorher.len()
    );

    let (status, importiert) = demo(&app, &admin, "POST", "/api/demo-daten").await;
    assert_eq!(status, StatusCode::CREATED, "{importiert}");
    for zeile in importiert["bericht"]["je_art"].as_array().unwrap() {
        assert_eq!(
            zeile["mitbenutzt"], 1,
            "je Art genau die eine freie Zeile: {zeile}"
        );
    }
    let (status, entfernt) = demo(&app, &admin, "DELETE", "/api/demo-daten").await;
    assert_eq!(status, StatusCode::OK, "{entfernt}");
    for zeile in entfernt["bericht"]["je_art"].as_array().unwrap() {
        assert_eq!(zeile["behalten"], 0, "{zeile}");
    }

    let nachher = db_bild(&pool).await;
    let namen = |b: &[(String, Vec<String>)]| b.iter().map(|(t, _)| t.clone()).collect::<Vec<_>>();
    assert_eq!(namen(&nachher), namen(&vorher), "dieselben Tabellen");
    let abweichend: Vec<String> = vorher
        .iter()
        .zip(&nachher)
        .filter(|((_, v), (_, n))| v != n)
        .map(|((t, v), (_, n))| {
            let nur_vorher: Vec<&String> = v.iter().filter(|z| !n.contains(z)).take(3).collect();
            let nur_nachher: Vec<&String> = n.iter().filter(|z| !v.contains(z)).take(3).collect();
            format!("{t}: vorher {} / nachher {} Zeilen; nur vorher {nur_vorher:?}; nur nachher {nur_nachher:?}", v.len(), n.len())
        })
        .collect();
    assert!(
        abweichend.is_empty(),
        "abweichende Tabellen:\n{}",
        abweichend.join("\n")
    );
}

// ---------------------------------------------------------------------------------------------
// Dauer von Import und Neu-Import (Task 5.3, design.md D11(c))
// ---------------------------------------------------------------------------------------------

const MESSLAEUFE: usize = 9;

fn median_ms(mut werte: Vec<std::time::Duration>) -> f64 {
    werte.sort();
    werte[werte.len() / 2].as_secs_f64() * 1000.0
}

/// Misst je [`MESSLAEUFE`] Läufe `POST /api/demo-daten` (auf leerem Stand) und
/// `POST /api/demo-daten/neu` (auf aktivem Import) über HTTP, samt Routing und Auth. Die Dauer
/// von `/neu` ist die obere Schranke dafür, wie lange der Vorgang die Schreibsperre hält (D11).
async fn messen(app: &axum::Router, admin: &str) -> (f64, f64) {
    let mut import = Vec::new();
    for _ in 0..MESSLAEUFE {
        let t = std::time::Instant::now();
        let (status, v) = demo(app, admin, "POST", "/api/demo-daten").await;
        import.push(t.elapsed());
        assert_eq!(status, StatusCode::CREATED, "{v}");
        let (status, v) = demo(app, admin, "DELETE", "/api/demo-daten").await;
        assert_eq!(status, StatusCode::OK, "{v}");
    }
    let (status, v) = demo(app, admin, "POST", "/api/demo-daten").await;
    assert_eq!(status, StatusCode::CREATED, "{v}");
    let mut neu = Vec::new();
    for _ in 0..MESSLAEUFE {
        let t = std::time::Instant::now();
        let (status, v) = demo(app, admin, "POST", "/api/demo-daten/neu").await;
        neu.push(t.elapsed());
        assert_eq!(status, StatusCode::OK, "{v}");
    }
    (median_ms(import), median_ms(neu))
}

/// Messung, kein Gate: eine Millisekunden-Schranke wäre auf geteilter CI-Hardware ein Würfel.
/// Aufruf: `cargo test --test demo_daten dauer_import_und_neu_import -- --ignored --nocapture`
/// (`--release` für Produktionsnähe). Gemessen gegen den In-Memory-Test-Pool (eine Verbindung,
/// kein WAL) und gegen `db::test_pool_datei()` (Datei, WAL, fünf Verbindungen).
/// Ergebnis: design.md, „Open Questions“, Ergebnis (c).
#[tokio::test]
#[ignore = "Messung für design.md D11(c), kein Gate"]
async fn dauer_import_und_neu_import() {
    let (app, _pool, _live) = common::setup_mit_optionen_und_live(AN).await;
    let admin = common::login_cookie(&app, "admin", "startpw12").await;
    let (import, neu) = messen(&app, &admin).await;
    eprintln!(
        "Demo-Dauer In-Memory (Median aus {MESSLAEUFE}): Import {import:.1} ms, Neu-Import {neu:.1} ms"
    );

    let (_dir, pool) = lifeline_hub::db::test_pool_datei().await;
    let (app, _pool, _live) = common::setup_mit_optionen_auf(pool, AN).await;
    let admin = common::login_cookie(&app, "admin", "startpw12").await;
    let (import, neu) = messen(&app, &admin).await;
    eprintln!(
        "Demo-Dauer Datei/WAL (Median aus {MESSLAEUFE}): Import {import:.1} ms, Neu-Import {neu:.1} ms"
    );
}
