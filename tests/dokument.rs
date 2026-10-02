//! Integrationstests der Dokumentenablage (LFH-632).

use axum::body::{to_bytes, Body};
use axum::http::{header, HeaderMap, Request, StatusCode};
use serde_json::Value;
use tower::ServiceExt;

mod common;
use common::*;

fn pfad(einsatz: i64) -> String {
    format!("/api/einsaetze/{einsatz}/dokumente")
}

/// Multipart mit Datei + beliebigen Textfeldern. `datei = None` lässt das Dateifeld weg.
async fn ablegen(
    app: &axum::Router,
    einsatz: i64,
    cookie: &str,
    datei: Option<(&str, &[u8])>,
    felder: &[(&str, &str)],
) -> (StatusCode, Value) {
    multipart_post(app, &pfad(einsatz), cookie, datei, felder).await
}

async fn datei_laden(
    app: &axum::Router,
    einsatz: i64,
    did: i64,
    cookie: &str,
) -> (StatusCode, HeaderMap, Vec<u8>) {
    let resp = app
        .clone()
        .oneshot(
            Request::builder()
                .uri(format!("{}/{did}/datei", pfad(einsatz)))
                .header(header::COOKIE, cookie)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let status = resp.status();
    let headers = resp.headers().clone();
    let bytes = to_bytes(resp.into_body(), usize::MAX)
        .await
        .unwrap()
        .to_vec();
    (status, headers, bytes)
}

const PDF: (&str, &[u8]) = ("lageplan.pdf", b"%PDF-1.4 inhalt");

const STANDARD: &[(&str, &str)] = &[("titel", "Lageplan Nord"), ("kategorie", "lagekarte_plan")];

async fn start() -> (axum::Router, String, i64) {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    (app, admin, einsatz)
}

async fn etb(app: &axum::Router, cookie: &str, einsatz: i64) -> Vec<Value> {
    let (status, json) = anfrage(
        app,
        "GET",
        &format!("/api/einsaetze/{einsatz}/etb"),
        cookie,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    json.as_array().cloned().unwrap_or_default()
}

async fn abschnitt_anlegen(app: &axum::Router, cookie: &str, einsatz: i64, name: &str) -> i64 {
    let (status, json) = anfrage(
        app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/abschnitte"),
        cookie,
        Some(&format!(r#"{{"name":"{name}"}}"#)),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{json:?}");
    json["id"].as_i64().unwrap()
}

// ---------- Ablegen, Liste, Download ----------

#[tokio::test]
async fn ablegen_listet_und_laedt_herunter() {
    let (app, admin, einsatz) = start().await;
    let (status, json) = ablegen(&app, einsatz, &admin, Some(PDF), STANDARD).await;
    assert_eq!(status, StatusCode::CREATED, "{json:?}");
    assert_eq!(json["kategorie"], "lagekarte_plan");
    assert_eq!(json["titel"], "Lageplan Nord");
    assert_eq!(json["dateiname"], "lageplan.pdf");
    assert_eq!(json["mime"], "application/pdf");
    assert_eq!(json["groesse"], 15);
    assert!(json["abgelegt_von_name"].is_string(), "{json:?}");
    let did = json["id"].as_i64().unwrap();

    let (status, liste) = anfrage(&app, "GET", &pfad(einsatz), &admin, None).await;
    assert_eq!(status, StatusCode::OK);
    let liste = liste.as_array().unwrap();
    assert_eq!(liste.len(), 1);
    assert_eq!(liste[0]["id"], did);

    let (status, headers, bytes) = datei_laden(&app, einsatz, did, &admin).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(bytes, PDF.1);
    assert!(headers[header::CONTENT_DISPOSITION]
        .to_str()
        .unwrap()
        .starts_with("attachment"));
    assert!(headers.contains_key(header::ETAG));
}

#[tokio::test]
async fn download_revalidiert_mit_304() {
    let (app, admin, einsatz) = start().await;
    let (_, json) = ablegen(&app, einsatz, &admin, Some(PDF), STANDARD).await;
    let did = json["id"].as_i64().unwrap();
    let (_, headers, _) = datei_laden(&app, einsatz, did, &admin).await;
    let etag = headers[header::ETAG].to_str().unwrap().to_string();

    let resp = app
        .clone()
        .oneshot(
            Request::builder()
                .uri(format!("{}/{did}/datei", pfad(einsatz)))
                .header(header::COOKIE, &admin)
                .header(header::IF_NONE_MATCH, &etag)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::NOT_MODIFIED);
}

#[tokio::test]
async fn ablegen_schreibt_system_etb_eintrag() {
    let (app, admin, einsatz) = start().await;
    let (status, json) = ablegen(&app, einsatz, &admin, Some(PDF), STANDARD).await;
    assert_eq!(status, StatusCode::CREATED);
    let eintraege = etb(&app, &admin, einsatz).await;
    let treffer: Vec<&Value> = eintraege
        .iter()
        .filter(|e| {
            e["typ"] == "system"
                && e["inhalt"]
                    .as_str()
                    .is_some_and(|i| i == "Dokument abgelegt (Lagekarte/Plan)")
        })
        .collect();
    assert_eq!(treffer.len(), 1, "{eintraege:?}");
    assert_eq!(json["etb_eintrag_id"], treffer[0]["id"]);
    // LFH-752: Der Titel ist Scrub der Dokumentzeile und bleibt aus dem ETB.
    assert!(
        eintraege
            .iter()
            .all(|e| !e["inhalt"].as_str().unwrap_or("").contains("Lageplan Nord")),
        "{eintraege:?}"
    );
}

// ---------- Validierung ----------

async fn erwarte_status(
    felder: &[(&str, &str)],
    datei: Option<(&str, &[u8])>,
    erwartet: StatusCode,
) {
    let (app, admin, einsatz) = start().await;
    let (status, json) = ablegen(&app, einsatz, &admin, datei, felder).await;
    assert_eq!(status, erwartet, "{json:?}");
}

#[tokio::test]
async fn unbekannte_kategorie_ist_400() {
    erwarte_status(
        &[("titel", "X"), ("kategorie", "geheim")],
        Some(PDF),
        StatusCode::BAD_REQUEST,
    )
    .await;
}

#[tokio::test]
async fn fehlender_titel_ist_400() {
    erwarte_status(
        &[("kategorie", "befehl")],
        Some(PDF),
        StatusCode::BAD_REQUEST,
    )
    .await;
}

#[tokio::test]
async fn leerer_titel_ist_400() {
    erwarte_status(
        &[("titel", "   "), ("kategorie", "befehl")],
        Some(PDF),
        StatusCode::BAD_REQUEST,
    )
    .await;
}

#[tokio::test]
async fn titel_ueber_200_zeichen_ist_400() {
    let lang = "ä".repeat(201);
    erwarte_status(
        &[("titel", &lang), ("kategorie", "befehl")],
        Some(PDF),
        StatusCode::BAD_REQUEST,
    )
    .await;
}

#[tokio::test]
async fn titel_mit_200_zeichen_ist_erlaubt() {
    let genau = "ä".repeat(200);
    erwarte_status(
        &[("titel", &genau), ("kategorie", "befehl")],
        Some(PDF),
        StatusCode::CREATED,
    )
    .await;
}

#[tokio::test]
async fn fehlende_datei_ist_400() {
    erwarte_status(STANDARD, None, StatusCode::BAD_REQUEST).await;
}

#[tokio::test]
async fn unerlaubter_typ_ist_400() {
    erwarte_status(STANDARD, Some(("x.exe", b"MZ")), StatusCode::BAD_REQUEST).await;
}

#[tokio::test]
async fn unbekannter_bezug_typ_ist_400() {
    erwarte_status(
        &[
            ("titel", "X"),
            ("kategorie", "befehl"),
            ("bezug_typ", "fahrzeug"),
            ("bezug_id", "1"),
        ],
        Some(PDF),
        StatusCode::BAD_REQUEST,
    )
    .await;
}

#[tokio::test]
async fn bezug_typ_ohne_id_ist_422() {
    erwarte_status(
        &[
            ("titel", "X"),
            ("kategorie", "befehl"),
            ("bezug_typ", "abschnitt"),
        ],
        Some(PDF),
        StatusCode::UNPROCESSABLE_ENTITY,
    )
    .await;
}

#[tokio::test]
async fn bezug_id_ohne_typ_ist_422() {
    erwarte_status(
        &[("titel", "X"), ("kategorie", "befehl"), ("bezug_id", "1")],
        Some(PDF),
        StatusCode::UNPROCESSABLE_ENTITY,
    )
    .await;
}

// ---------- Bezug ----------

#[tokio::test]
async fn bezug_auf_abschnitt_wird_gespeichert() {
    let (app, admin, einsatz) = start().await;
    let aid = abschnitt_anlegen(&app, &admin, einsatz, "Abschnitt Nord").await;
    let aid_s = aid.to_string();
    let (status, json) = ablegen(
        &app,
        einsatz,
        &admin,
        Some(PDF),
        &[
            ("titel", "Plan"),
            ("kategorie", "lagekarte_plan"),
            ("bezug_typ", "abschnitt"),
            ("bezug_id", &aid_s),
        ],
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{json:?}");
    assert_eq!(json["bezug_abschnitt_id"], aid);
    assert_eq!(json["bezug_abschnitt_name"], "Abschnitt Nord");
    let obj = json.as_object().unwrap();
    assert!(!obj.contains_key("bezug_einheit_id"), "{json:?}");
    assert!(!obj.contains_key("bezug_etb_eintrag_id"), "{json:?}");
}

#[tokio::test]
async fn bezug_auf_fremden_abschnitt_ist_400() {
    let (app, admin, einsatz_a) = start().await;
    let einsatz_b = einsatz_anlegen(&app, &admin).await;
    let fremd = abschnitt_anlegen(&app, &admin, einsatz_b, "Fremd").await;
    let fremd_s = fremd.to_string();
    let (status, json) = ablegen(
        &app,
        einsatz_a,
        &admin,
        Some(PDF),
        &[
            ("titel", "Plan"),
            ("kategorie", "befehl"),
            ("bezug_typ", "abschnitt"),
            ("bezug_id", &fremd_s),
        ],
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "{json:?}");
    // Keine Teil-Anlage: die Transaktion rollt Anhang und ETB-Eintrag mit zurück.
    let (_, liste) = anfrage(&app, "GET", &pfad(einsatz_a), &admin, None).await;
    assert_eq!(liste.as_array().unwrap().len(), 0);
}

// ---------- MIME-Allowlist ----------

#[tokio::test]
async fn heic_und_tiff_sind_erlaubt() {
    let (app, admin, einsatz) = start().await;
    for (datei, mime) in [("foto.heic", "image/heic"), ("scan.tiff", "image/tiff")] {
        let (status, json) = ablegen(
            &app,
            einsatz,
            &admin,
            Some((datei, b"x")),
            &[("titel", datei), ("kategorie", "foto")],
        )
        .await;
        assert_eq!(status, StatusCode::CREATED, "{datei}: {json:?}");
        assert_eq!(json["mime"], mime);
    }
}

#[tokio::test]
async fn chat_allowlist_bleibt_ohne_heic() {
    let (app, admin, einsatz) = start().await;
    let (status, json) = multipart_post(
        &app,
        &format!("/api/einsaetze/{einsatz}/anhaenge"),
        &admin,
        Some(("foto.heic", b"x")),
        &[],
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "{json:?}");
}

// ---------- Isolation, Löschen ----------

#[tokio::test]
async fn dokument_aus_fremdem_einsatz_ist_404() {
    let (app, admin, einsatz_a) = start().await;
    let einsatz_b = einsatz_anlegen(&app, &admin).await;
    let (_, json) = ablegen(&app, einsatz_b, &admin, Some(PDF), STANDARD).await;
    let did = json["id"].as_i64().unwrap();

    let (status, _, _) = datei_laden(&app, einsatz_a, did, &admin).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    let (status, _) = anfrage(
        &app,
        "DELETE",
        &format!("{}/{did}", pfad(einsatz_a)),
        &admin,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    // Das Dokument in B ist unberührt.
    let (status, _, _) = datei_laden(&app, einsatz_b, did, &admin).await;
    assert_eq!(status, StatusCode::OK);
}

#[tokio::test]
async fn entfernen_ist_soft_delete() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    ids_verschieben(&app, &admin).await;
    let (_, json) = ablegen(&app, einsatz, &admin, Some(PDF), STANDARD).await;
    let did = json["id"].as_i64().unwrap();
    let loeschpfad = format!("{}/{did}", pfad(einsatz));

    let (status, _) = anfrage(&app, "DELETE", &loeschpfad, &admin, None).await;
    assert_eq!(status, StatusCode::NO_CONTENT);

    let (_, liste) = anfrage(&app, "GET", &pfad(einsatz), &admin, None).await;
    assert_eq!(liste.as_array().unwrap().len(), 0);
    let (status, _, _) = datei_laden(&app, einsatz, did, &admin).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    let (status, _) = anfrage(&app, "DELETE", &loeschpfad, &admin, None).await;
    assert_eq!(status, StatusCode::NOT_FOUND);

    let eintraege = etb(&app, &admin, einsatz).await;
    // LFH-752: Die Entfernung nennt den Ablage-Eintrag statt des Titels.
    let ablage_nr = ablage_lfd_nr(&eintraege, &json);
    nummer_ist_eindeutig(ablage_nr, &json);
    let erwartet = format!("Dokument entfernt: Ablage ETB {ablage_nr} (Lagekarte/Plan)");
    assert!(
        eintraege
            .iter()
            .any(|e| e["typ"] == "system" && e["inhalt"].as_str() == Some(erwartet.as_str())),
        "{erwartet} fehlt: {eintraege:?}"
    );
    assert!(
        eintraege
            .iter()
            .all(|e| !e["inhalt"].as_str().unwrap_or("").contains("Lageplan Nord")),
        "Leak: Dokumenttitel im ETB: {eintraege:?}"
    );
    let anhaenge: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM anhang WHERE einsatz_id = ?")
        .bind(einsatz)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(anhaenge, 1, "Soft-Delete lässt die Bytes stehen");

    // Kein Bypass über die modul-lose generische Route: auch nach dem Soft-Delete bleibt der
    // Anhang dort gesperrt (`LinkerStand` zählt gelöschte Dokumente mit).
    let aid: i64 = sqlx::query_scalar("SELECT anhang_id FROM einsatz_dokument WHERE id = ?")
        .bind(did)
        .fetch_one(&pool)
        .await
        .unwrap();
    let (status, _) = anfrage(
        &app,
        "GET",
        &format!("/api/einsaetze/{einsatz}/anhaenge/{aid}"),
        &admin,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn liste_zeigt_neueste_zuerst() {
    let (app, admin, einsatz) = start().await;
    let mut ids = Vec::new();
    for titel in ["Erstes", "Zweites", "Drittes"] {
        let (status, json) = ablegen(
            &app,
            einsatz,
            &admin,
            Some(PDF),
            &[("titel", titel), ("kategorie", "sonstiges")],
        )
        .await;
        assert_eq!(status, StatusCode::CREATED);
        ids.push(json["id"].as_i64().unwrap());
    }
    let (_, liste) = anfrage(&app, "GET", &pfad(einsatz), &admin, None).await;
    let reihenfolge: Vec<i64> = liste
        .as_array()
        .unwrap()
        .iter()
        .map(|d| d["id"].as_i64().unwrap())
        .collect();
    ids.reverse();
    assert_eq!(
        reihenfolge, ids,
        "neueste zuerst (gleiche Sekunde → id DESC)"
    );
}

// ---------- Rechte ----------

#[tokio::test]
async fn beobachter_darf_lesen_nicht_ablegen() {
    let (app, admin, einsatz) = start().await;
    let (_, json) = ablegen(&app, einsatz, &admin, Some(PDF), STANDARD).await;
    let did = json["id"].as_i64().unwrap();
    let beob = benutzer_anlegen(&app, &admin, "beobachter", "keine").await;
    rolle_setzen(&app, &admin, einsatz, beob, "beobachter").await;
    let beob_cookie = login_cookie(&app, "beobachter", "beobachterpw1").await;

    let (status, _) = anfrage(&app, "GET", &pfad(einsatz), &beob_cookie, None).await;
    assert_eq!(status, StatusCode::OK);
    let (status, _, _) = datei_laden(&app, einsatz, did, &beob_cookie).await;
    assert_eq!(status, StatusCode::OK);
    let (status, _) = ablegen(&app, einsatz, &beob_cookie, Some(PDF), STANDARD).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    let (status, _) = anfrage(
        &app,
        "DELETE",
        &format!("{}/{did}", pfad(einsatz)),
        &beob_cookie,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn abgeschlossener_einsatz_ablegen_ist_409() {
    let (app, admin, einsatz) = start().await;
    let (status, _) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/abschliessen"),
        &admin,
        None,
    )
    .await;
    assert!(status.is_success(), "abschliessen: {status}");
    let (status, json) = ablegen(&app, einsatz, &admin, Some(PDF), STANDARD).await;
    assert_eq!(status, StatusCode::CONFLICT, "{json:?}");
}

/// Eine fremde **Org** scheitert am Einsatz-Extractor (Org-Floor) mit 403, auf ALLEN vier
/// Routen — bewusst nicht „403 oder 404", das eine 404 aus einem Handler-Pfad (Ownership
/// statt Org-Grenze) still durchgehen ließe.
#[tokio::test]
async fn fremde_org_ist_403() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let (_, json) = ablegen(&app, einsatz, &admin, Some(PDF), STANDARD).await;
    let did = json["id"].as_i64().unwrap();
    fremde_org_anlegen(&pool, "Fremd-Orga", "fremd", "fremdpw1", "fuehrungskraft").await;
    let fremd = login_cookie(&app, "fremd", "fremdpw1").await;

    let (status, _) = anfrage(&app, "GET", &pfad(einsatz), &fremd, None).await;
    assert_eq!(status, StatusCode::FORBIDDEN, "GET-Liste");
    let (status, _, _) = datei_laden(&app, einsatz, did, &fremd).await;
    assert_eq!(status, StatusCode::FORBIDDEN, "Download");
    let (status, _) = ablegen(&app, einsatz, &fremd, Some(PDF), STANDARD).await;
    assert_eq!(status, StatusCode::FORBIDDEN, "POST");
    let (status, _) = anfrage(
        &app,
        "DELETE",
        &format!("{}/{did}", pfad(einsatz)),
        &fremd,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN, "DELETE");
    let (status, _) = anfrage(
        &app,
        "PATCH",
        &format!("{}/{did}", pfad(einsatz)),
        &fremd,
        Some(r#"{"titel":"Fremd"}"#),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN, "PATCH");
}

// ---------- LFH-656: Angaben nachträglich ändern ----------

/// Legt das Standard-Dokument ab und liefert seine id.
async fn standard_ablegen(app: &axum::Router, cookie: &str, einsatz: i64) -> i64 {
    let (status, json) = ablegen(app, einsatz, cookie, Some(PDF), STANDARD).await;
    assert_eq!(status, StatusCode::CREATED, "{json:?}");
    json["id"].as_i64().unwrap()
}

/// Laufende Nummer des ETB-Eintrags, mit dem das Dokument `dokument` (Antwort der Ablage)
/// abgelegt wurde — darüber bezeichnen Änderung und Entfernung das Dokument (LFH-752).
fn ablage_lfd_nr(eintraege: &[Value], dokument: &Value) -> i64 {
    eintraege
        .iter()
        .find(|e| e["id"] == dokument["etb_eintrag_id"])
        .and_then(|e| e["lfd_nr"].as_i64())
        .unwrap_or_else(|| panic!("Ablage-Eintrag fehlt: {eintraege:?}"))
}

/// Legt in einem fremden Einsatz zwei Dokumente ab, damit ETB-id, Dokument-id und laufende
/// Nummer im Prüfling auseinanderfallen. Sonst bestünde ein Test, der „Ablage ETB {lfd_nr}“
/// erwartet, auch mit der id im Text.
async fn ids_verschieben(app: &axum::Router, cookie: &str) {
    let fremd = einsatz_anlegen(app, cookie).await;
    for _ in 0..2 {
        let (status, json) = ablegen(app, fremd, cookie, Some(PDF), STANDARD).await;
        assert_eq!(status, StatusCode::CREATED, "{json:?}");
    }
}

/// Die laufende Nummer, die der Text nennen soll, ist weder die ETB-id noch die Dokument-id.
fn nummer_ist_eindeutig(ablage_nr: i64, dokument: &Value) {
    assert_ne!(
        Some(ablage_nr),
        dokument["etb_eintrag_id"].as_i64(),
        "lfd_nr = ETB-id"
    );
    assert_ne!(
        Some(ablage_nr),
        dokument["id"].as_i64(),
        "lfd_nr = Dokument-id"
    );
}

async fn aendern(
    app: &axum::Router,
    cookie: &str,
    einsatz: i64,
    did: i64,
    body: &str,
) -> (StatusCode, Value) {
    anfrage(
        app,
        "PATCH",
        &format!("{}/{did}", pfad(einsatz)),
        cookie,
        Some(body),
    )
    .await
}

/// System-Einträge, die mit „Dokument geändert:“ beginnen.
async fn aenderungs_eintraege(app: &axum::Router, cookie: &str, einsatz: i64) -> Vec<String> {
    etb(app, cookie, einsatz)
        .await
        .iter()
        .filter(|e| e["typ"] == "system")
        .filter_map(|e| e["inhalt"].as_str().map(str::to_string))
        .filter(|i| i.starts_with("Dokument geändert:"))
        .collect()
}

#[tokio::test]
async fn aendern_setzt_titel_und_kategorie_und_laesst_die_datei() {
    let (app, admin, einsatz) = start().await;
    let did = standard_ablegen(&app, &admin, einsatz).await;

    let (status, json) = aendern(
        &app,
        &admin,
        einsatz,
        did,
        r#"{"titel":"  Lageplan Süd  ","kategorie":"befehl"}"#,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{json:?}");
    assert_eq!(json["id"], did);
    assert_eq!(json["titel"], "Lageplan Süd");
    assert_eq!(json["kategorie"], "befehl");
    assert_eq!(json["dateiname"], "lageplan.pdf");

    let (_, liste) = anfrage(&app, "GET", &pfad(einsatz), &admin, None).await;
    assert_eq!(liste[0]["titel"], "Lageplan Süd");
    let (status, _, bytes) = datei_laden(&app, einsatz, did, &admin).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(bytes, PDF.1);
}

#[tokio::test]
async fn aendern_nur_titel_laesst_kategorie_und_bezug() {
    let (app, admin, einsatz) = start().await;
    let abschnitt = abschnitt_anlegen(&app, &admin, einsatz, "Nord").await;
    let (_, json) = ablegen(
        &app,
        einsatz,
        &admin,
        Some(PDF),
        &[
            ("titel", "Lageplan Nord"),
            ("kategorie", "lagekarte_plan"),
            ("bezug_typ", "abschnitt"),
            ("bezug_id", &abschnitt.to_string()),
        ],
    )
    .await;
    let did = json["id"].as_i64().unwrap();

    let (status, json) = aendern(&app, &admin, einsatz, did, r#"{"titel":"Neu"}"#).await;
    assert_eq!(status, StatusCode::OK, "{json:?}");
    assert_eq!(json["titel"], "Neu");
    assert_eq!(json["kategorie"], "lagekarte_plan");
    assert_eq!(json["bezug_abschnitt_id"], abschnitt);
}

#[tokio::test]
async fn aendern_setzt_wechselt_und_entfernt_den_bezug() {
    let (app, admin, einsatz) = start().await;
    let nord = abschnitt_anlegen(&app, &admin, einsatz, "Nord").await;
    let did = standard_ablegen(&app, &admin, einsatz).await;

    // Setzen.
    let (status, json) = aendern(
        &app,
        &admin,
        einsatz,
        did,
        &format!(r#"{{"bezug_typ":"abschnitt","bezug_id":{nord}}}"#),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{json:?}");
    assert_eq!(json["bezug_abschnitt_id"], nord);
    assert_eq!(json["bezug_abschnitt_name"], "Nord");

    // Wechseln auf einen ETB-Eintrag: der Abschnitt fällt weg.
    let etb_id = etb(&app, &admin, einsatz).await[0]["id"].as_i64().unwrap();
    let (status, json) = aendern(
        &app,
        &admin,
        einsatz,
        did,
        &format!(r#"{{"bezug_typ":"etb_eintrag","bezug_id":{etb_id}}}"#),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{json:?}");
    assert_eq!(json["bezug_etb_eintrag_id"], etb_id);
    assert!(json.get("bezug_abschnitt_id").is_none(), "{json:?}");

    // Entfernen.
    let (status, json) = aendern(
        &app,
        &admin,
        einsatz,
        did,
        r#"{"bezug_typ":null,"bezug_id":null}"#,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{json:?}");
    assert!(json.get("bezug_etb_eintrag_id").is_none(), "{json:?}");
    assert!(json.get("bezug_abschnitt_id").is_none(), "{json:?}");
}

#[tokio::test]
async fn aendern_feldfehler_sind_400_und_aendern_nichts() {
    let (app, admin, einsatz) = start().await;
    let did = standard_ablegen(&app, &admin, einsatz).await;
    let fremder_einsatz = einsatz_anlegen(&app, &admin).await;
    let fremd = abschnitt_anlegen(&app, &admin, fremder_einsatz, "Fremd").await;
    let lang = "x".repeat(201);

    for body in [
        r#"{"titel":"   "}"#.to_string(),
        format!(r#"{{"titel":"{lang}"}}"#),
        r#"{"kategorie":"plakat"}"#.to_string(),
        r#"{"kategorie":""}"#.to_string(),
        r#"{"bezug_typ":"fahrzeug","bezug_id":1}"#.to_string(),
        r#"{"bezug_typ":"abschnitt","bezug_id":"x"}"#.to_string(),
        format!(r#"{{"bezug_typ":"abschnitt","bezug_id":{fremd}}}"#),
        r#"{"bezug_typ":"abschnitt","bezug_id":999999}"#.to_string(),
        r#"{}"#.to_string(),
        r#"{"titel":null}"#.to_string(),
    ] {
        let (status, json) = aendern(&app, &admin, einsatz, did, &body).await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{body}: {json:?}");
    }
    let (_, liste) = anfrage(&app, "GET", &pfad(einsatz), &admin, None).await;
    assert_eq!(liste[0]["titel"], "Lageplan Nord");
    assert_eq!(liste[0]["kategorie"], "lagekarte_plan");
    assert!(liste[0].get("bezug_abschnitt_id").is_none());
    assert!(aenderungs_eintraege(&app, &admin, einsatz).await.is_empty());
}

#[tokio::test]
async fn aendern_halber_bezug_ist_422() {
    let (app, admin, einsatz) = start().await;
    let nord = abschnitt_anlegen(&app, &admin, einsatz, "Nord").await;
    let did = standard_ablegen(&app, &admin, einsatz).await;

    for body in [
        r#"{"bezug_typ":"abschnitt"}"#.to_string(),
        format!(r#"{{"bezug_id":{nord}}}"#),
        r#"{"bezug_typ":"abschnitt","bezug_id":null}"#.to_string(),
        format!(r#"{{"bezug_typ":null,"bezug_id":{nord}}}"#),
        r#"{"bezug_typ":null}"#.to_string(),
    ] {
        let (status, json) = aendern(&app, &admin, einsatz, did, &body).await;
        assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{body}: {json:?}");
    }
}

#[tokio::test]
async fn aendern_braucht_schreibrecht_und_aktiven_einsatz() {
    let (app, admin, einsatz) = start().await;
    let did = standard_ablegen(&app, &admin, einsatz).await;
    let beob = benutzer_anlegen(&app, &admin, "beobachter", "keine").await;
    rolle_setzen(&app, &admin, einsatz, beob, "beobachter").await;
    let beob_cookie = login_cookie(&app, "beobachter", "beobachterpw1").await;

    let (status, _) = aendern(&app, &beob_cookie, einsatz, did, r#"{"titel":"X"}"#).await;
    assert_eq!(status, StatusCode::FORBIDDEN);

    let (status, _) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/abschliessen"),
        &admin,
        None,
    )
    .await;
    assert!(status.is_success(), "abschliessen: {status}");
    let (status, json) = aendern(&app, &admin, einsatz, did, r#"{"titel":"X"}"#).await;
    assert_eq!(status, StatusCode::CONFLICT, "{json:?}");
}

#[tokio::test]
async fn aendern_entferntes_oder_fremdes_dokument_ist_404() {
    let (app, admin, einsatz) = start().await;
    let einsatz_b = einsatz_anlegen(&app, &admin).await;
    let fremd = standard_ablegen(&app, &admin, einsatz_b).await;
    let (status, _) = aendern(&app, &admin, einsatz, fremd, r#"{"titel":"X"}"#).await;
    assert_eq!(status, StatusCode::NOT_FOUND);

    let did = standard_ablegen(&app, &admin, einsatz).await;
    let (status, _) = anfrage(
        &app,
        "DELETE",
        &format!("{}/{did}", pfad(einsatz)),
        &admin,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::NO_CONTENT);
    let (status, _) = aendern(&app, &admin, einsatz, did, r#"{"titel":"X"}"#).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    let (status, _) = aendern(&app, &admin, einsatz, 999_999, r#"{"titel":"X"}"#).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn aendern_schreibt_etb_nachweis_mit_alt_und_neu() {
    let (app, admin, einsatz) = start().await;
    let nord = abschnitt_anlegen(&app, &admin, einsatz, "Nord").await;
    ids_verschieben(&app, &admin).await;
    let (status, dokument) = ablegen(&app, einsatz, &admin, Some(PDF), STANDARD).await;
    assert_eq!(status, StatusCode::CREATED, "{dokument:?}");
    let did = dokument["id"].as_i64().unwrap();
    let ablage_nr = ablage_lfd_nr(&etb(&app, &admin, einsatz).await, &dokument);
    nummer_ist_eindeutig(ablage_nr, &dokument);

    let (status, _) = aendern(
        &app,
        &admin,
        einsatz,
        did,
        r#"{"titel":"Befehl 1 – Nachtrag","kategorie":"befehl"}"#,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let eintraege = aenderungs_eintraege(&app, &admin, einsatz).await;
    assert_eq!(eintraege.len(), 1, "{eintraege:?}");
    let text = &eintraege[0];
    // LFH-752: Titel weder alt noch neu, nur „Titel geändert“; Kategorie mit alt und neu.
    assert_eq!(
        text,
        &format!(
            "Dokument geändert: Ablage ETB {ablage_nr} (Befehl) — Titel geändert; \
             Kategorie: Lagekarte/Plan → Befehl"
        ),
    );
    assert!(!text.contains("Lageplan Nord"), "{text}");
    assert!(!text.contains("Nachtrag"), "{text}");
    assert!(!text.contains("Bezug:"), "nur Geändertes: {text}");

    let (status, _) = aendern(
        &app,
        &admin,
        einsatz,
        did,
        &format!(r#"{{"bezug_typ":"abschnitt","bezug_id":{nord}}}"#),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let eintraege = aenderungs_eintraege(&app, &admin, einsatz).await;
    assert_eq!(eintraege.len(), 2, "{eintraege:?}");
    assert!(
        eintraege
            .iter()
            .any(|t| t.contains("Bezug: ohne → Abschnitt Nord") && !t.contains("Titel")),
        "{eintraege:?}"
    );
}

/// LFH-752: Eine reine Kategorieänderung nennt alt und neu, aber keinen Titel.
#[tokio::test]
async fn aendern_nur_kategorie_nennt_alt_und_neu_ohne_titel() {
    let (app, admin, einsatz) = start().await;
    ids_verschieben(&app, &admin).await;
    let (status, dokument) = ablegen(
        &app,
        einsatz,
        &admin,
        Some(PDF),
        &[("titel", "Personenliste NU"), ("kategorie", "sonstiges")],
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{dokument:?}");
    let did = dokument["id"].as_i64().unwrap();
    let ablage_nr = ablage_lfd_nr(&etb(&app, &admin, einsatz).await, &dokument);
    nummer_ist_eindeutig(ablage_nr, &dokument);

    let (status, _) = aendern(&app, &admin, einsatz, did, r#"{"kategorie":"befehl"}"#).await;
    assert_eq!(status, StatusCode::OK);
    let eintraege = aenderungs_eintraege(&app, &admin, einsatz).await;
    assert_eq!(
        eintraege,
        vec![format!(
            "Dokument geändert: Ablage ETB {ablage_nr} (Befehl) — Kategorie: Sonstiges → Befehl"
        )]
    );
    let alle = etb(&app, &admin, einsatz).await;
    assert!(
        alle.iter()
            .all(|e| !e["inhalt"].as_str().unwrap_or("").contains("Personenliste")),
        "Leak: Dokumenttitel im ETB: {alle:?}"
    );
}

#[tokio::test]
async fn aendern_ohne_wirkung_schreibt_keinen_etb_eintrag() {
    let (app, admin, einsatz) = start().await;
    let did = standard_ablegen(&app, &admin, einsatz).await;
    let vorher = etb(&app, &admin, einsatz).await.len();

    let (status, json) = aendern(
        &app,
        &admin,
        einsatz,
        did,
        r#"{"titel":" Lageplan Nord ","kategorie":"lagekarte_plan","bezug_typ":null,"bezug_id":null}"#,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{json:?}");
    assert_eq!(json["titel"], "Lageplan Nord");
    assert_eq!(etb(&app, &admin, einsatz).await.len(), vorher);
}

// ---------- LFH-21: Abschottung der Schaden-Anhänge ----------

/// Ein Foto an einem Schaden steht nicht in der Dokumentenablage.
#[tokio::test]
async fn schaden_anhang_erscheint_nicht_in_der_ablage() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    schaden_anhang(&pool, einsatz).await;

    let (status, json) = anfrage(&app, "GET", &pfad(einsatz), &admin, None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(json.as_array().unwrap().len(), 0, "{json:?}");
}

/// Recht auf Dokumente genügt nicht: wer Dokumente sieht, aber nicht Schäden, bekommt an der
/// Schadensroute 403. Die 404 über den generischen Download belegt HIER nichts (diese Person
/// hat nicht abgelegt, für sie wäre ein ungebundener Anhang ohnehin 404) — die Aussage tragen
/// die Uploader-Tests in `tests/anhang.rs`.
#[tokio::test]
async fn recht_auf_dokumente_genuegt_nicht_fuer_schaden_anhaenge() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let aid = schaden_anhang(&pool, einsatz).await;
    let (sid, lid): (i64, i64) =
        sqlx::query_as("SELECT schaden_id, id FROM einsatz_schaden_anhang WHERE anhang_id = ?")
            .bind(aid)
            .fetch_one(&pool)
            .await
            .unwrap();
    let fid = benutzer_anlegen(&app, &admin, "frieda", "keine").await;
    rolle_setzen(&app, &admin, einsatz, fid, "fuehrungspersonal").await;
    let frieda = login_cookie(&app, "frieda", "friedapw1").await;
    let (s, _) = anfrage(
        &app,
        "PUT",
        &format!("/api/einsaetze/{einsatz}/modul-overrides/schaeden"),
        &admin,
        Some(r#"{"sichtbar":false,"benoetigte_rolle":null}"#),
    )
    .await;
    assert_eq!(s, StatusCode::OK);

    let (s, _) = anfrage(&app, "GET", &pfad(einsatz), &frieda, None).await;
    assert_eq!(s, StatusCode::OK, "Vorbedingung: Dokumente sieht sie");
    let schaden_pfad = format!("/api/einsaetze/{einsatz}/schaeden/{sid}/anhaenge");
    let (s, _) = anfrage(&app, "GET", &schaden_pfad, &frieda, None).await;
    assert_eq!(s, StatusCode::FORBIDDEN, "Liste an der Schadensroute");
    let (s, _) = anfrage(
        &app,
        "GET",
        &format!("{schaden_pfad}/{lid}/datei"),
        &frieda,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::FORBIDDEN, "Download an der Schadensroute");
    let (s, _) = anfrage(
        &app,
        "GET",
        &format!("/api/einsaetze/{einsatz}/anhaenge/{aid}"),
        &frieda,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::NOT_FOUND, "generischer Download");
}

// ---------- LFH-757: Abschottung der Personen-Anhänge ----------

/// Ein Foto an einer Person steht nicht in der Dokumentenablage.
#[tokio::test]
async fn person_anhang_erscheint_nicht_in_der_ablage() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    person_anhang(&pool, einsatz).await;

    let (status, json) = anfrage(&app, "GET", &pfad(einsatz), &admin, None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(json.as_array().unwrap().len(), 0, "{json:?}");
}

/// Recht auf Dokumente genügt nicht: wer Dokumente sieht, aber nicht Personen, bekommt an der
/// Personenroute 403. Die 404 über den generischen Download belegt HIER nichts (diese Person
/// hat nicht abgelegt, für sie wäre ein ungebundener Anhang ohnehin 404) — die Aussage tragen
/// die Uploader-Tests in `tests/anhang.rs`.
#[tokio::test]
async fn recht_auf_dokumente_genuegt_nicht_fuer_personen_anhaenge() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let aid = person_anhang(&pool, einsatz).await;
    let (pid, lid): (i64, i64) =
        sqlx::query_as("SELECT person_id, id FROM einsatz_person_anhang WHERE anhang_id = ?")
            .bind(aid)
            .fetch_one(&pool)
            .await
            .unwrap();
    let fid = benutzer_anlegen(&app, &admin, "frieda", "keine").await;
    rolle_setzen(&app, &admin, einsatz, fid, "fuehrungspersonal").await;
    let frieda = login_cookie(&app, "frieda", "friedapw1").await;
    let (s, _) = anfrage(
        &app,
        "PUT",
        &format!("/api/einsaetze/{einsatz}/modul-overrides/personen"),
        &admin,
        Some(r#"{"sichtbar":false,"benoetigte_rolle":null}"#),
    )
    .await;
    assert_eq!(s, StatusCode::OK);

    let (s, _) = anfrage(&app, "GET", &pfad(einsatz), &frieda, None).await;
    assert_eq!(s, StatusCode::OK, "Vorbedingung: Dokumente sieht sie");
    let person_pfad = format!("/api/einsaetze/{einsatz}/personen/{pid}/anhaenge");
    let (s, _) = anfrage(&app, "GET", &person_pfad, &frieda, None).await;
    assert_eq!(s, StatusCode::FORBIDDEN, "Liste an der Personenroute");
    let (s, _) = anfrage(
        &app,
        "GET",
        &format!("{person_pfad}/{lid}/datei"),
        &frieda,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::FORBIDDEN, "Download an der Personenroute");
    let (s, _) = anfrage(
        &app,
        "GET",
        &format!("/api/einsaetze/{einsatz}/anhaenge/{aid}"),
        &frieda,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::NOT_FOUND, "generischer Download");
}
