//! Bericht eines Absturzes aus dem Client (LLH-1822, Change `a12ms7g9-seitenzustaende`, D3; Spec
//! `seiten-zustaende`, „Absturz wird dem Server gemeldet“). Der Server nimmt nur von einer
//! Sitzung an, lehnt zu große Berichte vor dem Handler ab und prüft jedes Feld gegen seine
//! Grenze. Die Drossel der Logzeile prüft der Unit-Test in `routes::client_fehler`.

use axum::http::StatusCode;
use serde_json::{json, Value};

mod common;
use common::{anfrage, anfrage_json, login_cookie, setup};

use lifeline_hub::app::CLIENT_FEHLER_BODY_MAX;
use lifeline_hub::routes::client_fehler::{MELDUNG_MAX, ROUTE_MAX, STACK_MAX, VERSION_MAX};

const PFAD: &str = "/api/client-fehler";

fn bericht() -> Value {
    json!({
        "route": "/einsaetze/:id/personen/:personId",
        "version": "1.2.3",
        "meldung": "Cannot read properties of undefined (reading 'rolle')",
        "stack": "TypeError: Cannot read properties of undefined\n    at PersonDetail (Person.tsx:12:3)",
    })
}

/// Gültiger Bericht, mit Leerzeichen hinter dem letzten Feld auf genau `laenge` Bytes gebracht.
/// Ohne Body-Grenze an der Route nähme der Handler ihn an.
fn bericht_mit_laenge(laenge: usize) -> String {
    let kern = bericht().to_string();
    let ohne_klammer = &kern[..kern.len() - 1];
    let fuellung = laenge - ohne_klammer.len() - 1;
    format!("{ohne_klammer}{}}}", " ".repeat(fuellung))
}

#[tokio::test]
async fn ein_bericht_mit_sitzung_wird_mit_204_angenommen() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;

    let (s, j) = anfrage_json(&app, "POST", PFAD, &admin, Some(&bericht())).await;

    assert_eq!(s, StatusCode::NO_CONTENT, "{j:?}");
}

#[tokio::test]
async fn ein_bericht_ohne_stack_und_mit_leerer_route_wird_angenommen() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;

    let (s, j) = anfrage_json(
        &app,
        "POST",
        PFAD,
        &admin,
        Some(&json!({ "route": "", "version": "1.2.3", "meldung": "kaputt" })),
    )
    .await;

    assert_eq!(s, StatusCode::NO_CONTENT, "{j:?}");
}

#[tokio::test]
async fn ein_bericht_ohne_sitzung_ist_401() {
    let app = setup().await;

    let (s, j) = anfrage_json(&app, "POST", PFAD, "", Some(&bericht())).await;

    assert_eq!(s, StatusCode::UNAUTHORIZED, "{j:?}");
}

#[tokio::test]
async fn ein_bericht_ueber_der_body_grenze_ist_413() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;

    let body = bericht_mit_laenge(CLIENT_FEHLER_BODY_MAX + 1);
    assert_eq!(body.len(), CLIENT_FEHLER_BODY_MAX + 1);
    let (s, j) = anfrage(&app, "POST", PFAD, &admin, Some(&body)).await;
    assert_eq!(s, StatusCode::PAYLOAD_TOO_LARGE, "{j:?}");
    assert_eq!(j["error"], "Anfrage ist zu groß.");

    let body = bericht_mit_laenge(CLIENT_FEHLER_BODY_MAX);
    let (s, j) = anfrage(&app, "POST", PFAD, &admin, Some(&body)).await;
    assert_eq!(
        s,
        StatusCode::NO_CONTENT,
        "genau an der Grenze geht es durch: {j:?}"
    );
}

#[tokio::test]
async fn die_body_grenze_liegt_bei_8_kib_und_traegt_die_felder_an_ihrer_grenze() {
    assert_eq!(CLIENT_FEHLER_BODY_MAX, 8 * 1024);
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;

    // Jedes Feld an seiner Grenze passt unter die Body-Grenze: so bleibt die Feldprüfung (400)
    // die wirksame Grenze für einen gewöhnlichen Bericht.
    let voll = json!({
        "route": "r".repeat(ROUTE_MAX),
        "version": "v".repeat(VERSION_MAX),
        "meldung": "m".repeat(MELDUNG_MAX),
        "stack": "s".repeat(STACK_MAX),
    });
    assert!(voll.to_string().len() < CLIENT_FEHLER_BODY_MAX);
    let (s, j) = anfrage_json(&app, "POST", PFAD, &admin, Some(&voll)).await;
    assert_eq!(s, StatusCode::NO_CONTENT, "{j:?}");
}

#[tokio::test]
async fn ein_zu_langes_feld_ist_400_mit_dem_namen_des_felds() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;

    for (feld, max, name) in [
        ("route", ROUTE_MAX, "Route"),
        ("version", VERSION_MAX, "Version"),
        ("meldung", MELDUNG_MAX, "Meldung"),
        ("stack", STACK_MAX, "Stack"),
    ] {
        let mut b = bericht();
        b[feld] = Value::String("x".repeat(max + 1));
        let (s, j) = anfrage_json(&app, "POST", PFAD, &admin, Some(&b)).await;
        assert_eq!(s, StatusCode::BAD_REQUEST, "{feld}: {j:?}");
        assert_eq!(
            j["error"],
            format!("{name} darf höchstens {max} Zeichen lang sein"),
            "{feld}"
        );

        // Gezählt werden Zeichen, nicht Bytes: ein Umlaut an der Grenze geht durch.
        b[feld] = Value::String("ä".repeat(max));
        let (s, j) = anfrage_json(&app, "POST", PFAD, &admin, Some(&b)).await;
        assert_eq!(s, StatusCode::NO_CONTENT, "{feld} an der Grenze: {j:?}");
    }
}

/// `export const NAME = 123;` aus `frontend/src/api/clientFehler.ts`; andere Zeilen zählen nicht.
fn client_grenze(name: &str) -> usize {
    let pfad = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/frontend/src/api/clientFehler.ts"
    );
    let text = std::fs::read_to_string(pfad).expect("clientFehler.ts lesbar");
    let praefix = format!("export const {name} = ");
    let zeile = text
        .lines()
        .find_map(|z| z.trim().strip_prefix(praefix.as_str()))
        .unwrap_or_else(|| panic!("{name} fehlt in clientFehler.ts"));
    zeile
        .trim_end_matches(';')
        .replace('_', "")
        .parse()
        .unwrap_or_else(|_| panic!("{name}: keine Zahl: {zeile}"))
}

#[test]
fn die_feldgrenzen_entsprechen_dem_kuerzen_im_client() {
    // Der Client kürzt Meldung und Stack vor dem Senden; der Server darf nicht enger sein, sonst
    // verlöre er jeden langen Bericht, und nicht weiter, sonst prüfte er eine Grenze, die nie
    // greift. Gelesen aus der Datei, damit eine einseitige Änderung rot wird (Muster
    // `eingabegrenzen_spiegel.rs`). Route und Version kürzt der Client nicht.
    assert_eq!(client_grenze("CLIENT_FEHLER_MELDUNG_MAX"), MELDUNG_MAX);
    assert_eq!(client_grenze("CLIENT_FEHLER_STACK_MAX"), STACK_MAX);
}
