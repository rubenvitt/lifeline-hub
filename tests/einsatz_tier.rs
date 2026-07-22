//! HTTP-Integrationstests für Tiere (E‑4): CRUD, Registriernummer, Status-Maschine,
//! Halter-Exklusivität, Soft-Delete, ETB-Pseudonymisierung, Rechte-Matrix,
//! Cross-Einsatz-404 und Read-only-409 für abgeschlossene Einsätze.

use axum::body::{to_bytes, Body};
use axum::http::{header, Request, StatusCode};
use serde_json::{json, Value};
use tower::ServiceExt;

mod common;
use common::{benutzer_anlegen, einsatz_anlegen, login_cookie, rolle_setzen, setup};

// ---------- Harness ----------

async fn anfrage(
    app: &axum::Router,
    method: &str,
    uri: &str,
    cookie: &str,
    body: Option<&Value>,
) -> (StatusCode, Value) {
    let mut req = Request::builder()
        .method(method)
        .uri(uri)
        .header(header::COOKIE, cookie);
    let body = match body {
        Some(b) => {
            req = req.header(header::CONTENT_TYPE, "application/json");
            Body::from(b.to_string())
        }
        None => Body::empty(),
    };
    let resp = app.clone().oneshot(req.body(body).unwrap()).await.unwrap();
    let status = resp.status();
    let bytes = to_bytes(resp.into_body(), 1024 * 1024).await.unwrap();
    let value = if bytes.is_empty() {
        Value::Null
    } else {
        serde_json::from_slice(&bytes).unwrap_or(Value::Null)
    };
    (status, value)
}

// ---------- Domänen-Helfer ----------

async fn person_anlegen(app: &axum::Router, cookie: &str, einsatz: i64) -> i64 {
    let (s, v) = anfrage(
        app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/personen"),
        cookie,
        Some(&json!({})),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED);
    v["id"].as_i64().unwrap()
}

async fn tier_anlegen(app: &axum::Router, cookie: &str, einsatz: i64, body: &Value) -> i64 {
    let (s, v) = anfrage(
        app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/tiere"),
        cookie,
        Some(body),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "tier_anlegen: {v:?}");
    v["id"].as_i64().unwrap()
}

/// ETB-Einträge mit typ='system' als Vec der Inhalte.
async fn system_etb_inhalte(app: &axum::Router, cookie: &str, einsatz: i64) -> Vec<String> {
    let (_, json) = anfrage(
        app,
        "GET",
        &format!("/api/einsaetze/{einsatz}/etb"),
        cookie,
        None,
    )
    .await;
    json.as_array()
        .unwrap()
        .iter()
        .filter(|e| e["typ"] == "system")
        .map(|e| e["inhalt"].as_str().unwrap().to_string())
        .collect()
}

async fn einsatz_abschliessen(app: &axum::Router, cookie: &str, einsatz: i64) {
    let (s, _) = anfrage(
        app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/abschliessen"),
        cookie,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK);
}

// ---------- Tests: CRUD + Registriernummer + Status ----------

#[tokio::test]
async fn anlegen_vergibt_t_nummer_und_status_aktiv() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let (s, v) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{e}/tiere"),
        &admin,
        Some(&json!({"spezies":"hund","rufname":"Rex"})),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED);
    assert_eq!(v["registrier_nr"], 1);
    assert_eq!(v["status"], "aktiv");
    assert_eq!(v["spezies"], "hund");
}

#[tokio::test]
async fn registriernummer_fortlaufend_und_lueckenlos() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let t1 = tier_anlegen(&app, &admin, e, &json!({"spezies":"hund"})).await;
    let _t2 = tier_anlegen(&app, &admin, e, &json!({"spezies":"katze"})).await;
    // Storno t1 → nächste Nummer bleibt 3 (keine Wiederverwendung).
    anfrage(
        &app,
        "DELETE",
        &format!("/api/einsaetze/{e}/tiere/{t1}"),
        &admin,
        None,
    )
    .await;
    let (_, v) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{e}/tiere"),
        &admin,
        Some(&json!({"spezies":"wildtier"})),
    )
    .await;
    assert_eq!(v["registrier_nr"], 3);
}

#[tokio::test]
async fn anlegen_als_vermisst_erlaubt() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let (s, v) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{e}/tiere"),
        &admin,
        Some(&json!({"spezies":"katze","status":"vermisst"})),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED);
    assert_eq!(v["status"], "vermisst");
}

#[tokio::test]
async fn anlegen_als_abgeschlossen_ist_422() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let (s, _) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{e}/tiere"),
        &admin,
        Some(&json!({"spezies":"hund","status":"abgeschlossen"})),
    )
    .await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY);
}

#[tokio::test]
async fn anlegen_ohne_spezies_ist_400() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let (s, _) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{e}/tiere"),
        &admin,
        Some(&json!({"spezies":"dinosaurier"})),
    )
    .await;
    assert_eq!(s, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn gueltiger_status_wechsel_aktiv_vermisst_aktiv() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let t = tier_anlegen(&app, &admin, e, &json!({"spezies":"hund"})).await;
    let (s1, v1) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{e}/tiere/{t}/status"),
        &admin,
        Some(&json!({"status":"vermisst"})),
    )
    .await;
    assert_eq!(s1, StatusCode::OK);
    assert_eq!(v1["status"], "vermisst");
    let (s2, v2) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{e}/tiere/{t}/status"),
        &admin,
        Some(&json!({"status":"aktiv"})),
    )
    .await;
    assert_eq!(s2, StatusCode::OK);
    assert_eq!(v2["status"], "aktiv");
}

#[tokio::test]
async fn ungueltiger_status_wechsel_ist_422() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let t = tier_anlegen(&app, &admin, e, &json!({"spezies":"hund"})).await;
    let (s, _) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{e}/tiere/{t}/status"),
        &admin,
        Some(&json!({"status":"aktiv"})),
    )
    .await;
    assert_eq!(
        s,
        StatusCode::UNPROCESSABLE_ENTITY,
        "aktiv → aktiv verboten"
    );
}

#[tokio::test]
async fn unbekannter_zielstatus_ist_400() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let t = tier_anlegen(&app, &admin, e, &json!({"spezies":"hund"})).await;
    let (s, _) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{e}/tiere/{t}/status"),
        &admin,
        Some(&json!({"status":"entlaufen"})),
    )
    .await;
    assert_eq!(s, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn abschluss_ohne_grund_ist_422_und_mit_grund_ok() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let t = tier_anlegen(&app, &admin, e, &json!({"spezies":"hund"})).await;
    let (s_ohne, _) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{e}/tiere/{t}/status"),
        &admin,
        Some(&json!({"status":"abgeschlossen"})),
    )
    .await;
    assert_eq!(s_ohne, StatusCode::UNPROCESSABLE_ENTITY);
    let (s_mit, v) = anfrage(&app, "POST", &format!("/api/einsaetze/{e}/tiere/{t}/status"), &admin,
        Some(&json!({"status":"abgeschlossen","abschluss_grund":"uebergabe_tierarzt","abschluss_ziel":"Tierarzt Müller"}))).await;
    assert_eq!(s_mit, StatusCode::OK);
    assert_eq!(v["status"], "abgeschlossen");
    assert_eq!(v["abschluss_grund"], "uebergabe_tierarzt");
    assert_eq!(v["abschluss_ziel"], "Tierarzt Müller");
}

/// Unbekannter Enum-Wert scheitert am Feld selbst → 400 (LFH-305), nicht am Zusammenhang.
#[tokio::test]
async fn abschluss_mit_unbekanntem_grund_ist_400() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let t = tier_anlegen(&app, &admin, e, &json!({"spezies":"hund"})).await;
    let (s, v) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{e}/tiere/{t}/status"),
        &admin,
        Some(&json!({"status":"abgeschlossen","abschluss_grund":"quatsch"})),
    )
    .await;
    assert_eq!(s, StatusCode::BAD_REQUEST);
    assert!(
        v["error"]
            .as_str()
            .unwrap_or_default()
            .contains("Unbekannter"),
        "unerwartete Meldung: {v}"
    );
}

/// Abgrenzung zu `einsatz_schaden.rs`/abschliessen, wo DERSELBE Input 400 liefert:
/// dort ist der Endpunkt dediziert und der Abschlussgrund unbedingtes Pflichtfeld, ein
/// leerer Wert scheitert also am Feld. Hier ist der Status-Endpunkt generisch — `trimme`
/// macht den Whitespace-Wert zu `None`, und die Pflicht entsteht erst aus dem Zielstatus
/// „abgeschlossen". Das ist ein Zusammenhang → 422.
#[tokio::test]
async fn abschluss_mit_leerem_grund_ist_422() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let t = tier_anlegen(&app, &admin, e, &json!({"spezies":"hund"})).await;
    let (s, _) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{e}/tiere/{t}/status"),
        &admin,
        Some(&json!({"status":"abgeschlossen","abschluss_grund":"   "})),
    )
    .await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY);
}

// ---------- Tests: Halter-Exklusivität + Soft-Delete ----------

#[tokio::test]
async fn halter_beide_felder_ist_422() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let p = person_anlegen(&app, &admin, e).await;
    let (s, _) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{e}/tiere"),
        &admin,
        Some(&json!({"spezies":"hund","halter_person_id":p,"halter_kontakt":"Frau Müller"})),
    )
    .await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY);
}

#[tokio::test]
async fn patch_zweites_halter_feld_bei_bestehendem_ist_422() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let p = person_anlegen(&app, &admin, e).await;
    // Tier mit Freitext-Halter; dann PATCH nur halter_person_id → beide würden gesetzt.
    let t = tier_anlegen(
        &app,
        &admin,
        e,
        &json!({"spezies":"hund","halter_kontakt":"Frau Müller"}),
    )
    .await;
    let (s, _) = anfrage(
        &app,
        "PATCH",
        &format!("/api/einsaetze/{e}/tiere/{t}"),
        &admin,
        Some(&json!({"halter_person_id": p})),
    )
    .await;
    assert_eq!(
        s,
        StatusCode::UNPROCESSABLE_ENTITY,
        "darf 422 sein, NICHT 500"
    );
}

#[tokio::test]
async fn halter_fk_auf_stornierte_person_bleibt_zulaessig() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let p = person_anlegen(&app, &admin, e).await;
    let t = tier_anlegen(
        &app,
        &admin,
        e,
        &json!({"spezies":"hund","halter_person_id":p}),
    )
    .await;
    // Person stornieren.
    anfrage(
        &app,
        "DELETE",
        &format!("/api/einsaetze/{e}/personen/{p}"),
        &admin,
        None,
    )
    .await;
    let (s, v) = anfrage(
        &app,
        "GET",
        &format!("/api/einsaetze/{e}/tiere/{t}"),
        &admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(v["halter_person_id"], p, "Tier-Datensatz unverändert");
    assert!(
        v["halter_registrier_nr"].is_i64(),
        "Join löst R-Nr weiterhin auf"
    );
    assert!(v["halter_storniert_at"].is_string(), "Join zeigt storniert");
}

#[tokio::test]
async fn soft_delete_blendet_aus_liste_und_doppelt_ist_409() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let t = tier_anlegen(&app, &admin, e, &json!({"spezies":"hund"})).await;
    let (s1, _) = anfrage(
        &app,
        "DELETE",
        &format!("/api/einsaetze/{e}/tiere/{t}"),
        &admin,
        None,
    )
    .await;
    assert_eq!(s1, StatusCode::NO_CONTENT);
    let (_, liste) = anfrage(
        &app,
        "GET",
        &format!("/api/einsaetze/{e}/tiere"),
        &admin,
        None,
    )
    .await;
    assert_eq!(
        liste.as_array().unwrap().len(),
        0,
        "storniert nicht in Liste"
    );
    let (s2, _) = anfrage(
        &app,
        "DELETE",
        &format!("/api/einsaetze/{e}/tiere/{t}"),
        &admin,
        None,
    )
    .await;
    assert_eq!(s2, StatusCode::CONFLICT, "doppeltes Stornieren → 409");
}

#[tokio::test]
async fn patch_auf_storniertem_tier_ist_409() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let t = tier_anlegen(&app, &admin, e, &json!({"spezies":"hund"})).await;
    anfrage(
        &app,
        "DELETE",
        &format!("/api/einsaetze/{e}/tiere/{t}"),
        &admin,
        None,
    )
    .await;
    let (s, _) = anfrage(
        &app,
        "PATCH",
        &format!("/api/einsaetze/{e}/tiere/{t}"),
        &admin,
        Some(&json!({"rufname":"Bello"})),
    )
    .await;
    assert_eq!(s, StatusCode::CONFLICT);
}

#[tokio::test]
async fn halter_aus_fremdem_einsatz_ist_404() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e1 = einsatz_anlegen(&app, &admin).await;
    let e2 = einsatz_anlegen(&app, &admin).await;
    let p_fremd = person_anlegen(&app, &admin, e2).await; // Person in e2
                                                          // Tier in e1 mit Halter-FK auf Person aus e2 → Org-Isolation greift → 404.
    let (s, _) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{e1}/tiere"),
        &admin,
        Some(&json!({"spezies":"hund","halter_person_id":p_fremd})),
    )
    .await;
    assert_eq!(s, StatusCode::NOT_FOUND, "Halter aus fremdem Einsatz → 404");
}

#[tokio::test]
async fn liste_filtert_nach_halter_person_id() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let p = person_anlegen(&app, &admin, e).await;
    tier_anlegen(
        &app,
        &admin,
        e,
        &json!({"spezies":"hund","halter_person_id":p}),
    )
    .await;
    tier_anlegen(&app, &admin, e, &json!({"spezies":"katze"})).await; // ohne Halter
    let (s, v) = anfrage(
        &app,
        "GET",
        &format!("/api/einsaetze/{e}/tiere?halter_person_id={p}"),
        &admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(v.as_array().unwrap().len(), 1);
    assert_eq!(v[0]["halter_person_id"], p);
}

// ---------- Tests: ETB-Leak ----------

#[tokio::test]
async fn anlegen_etb_pseudonym_ohne_rufname_und_halter() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    tier_anlegen(&app, &admin, e, &json!({"spezies":"hund","rufname":"GEHEIM_REX","kennzeichnung":"CHIP_999","halter_kontakt":"Frau GEHEIM"})).await;
    let inhalte = system_etb_inhalte(&app, &admin, e).await;
    assert_eq!(inhalte.len(), 1);
    assert!(
        inhalte[0].contains("T-001"),
        "ETB nennt die Registriernummer"
    );
    assert!(inhalte[0].contains("Hund"), "ETB nennt die Spezies");
    assert!(!inhalte[0].contains("GEHEIM_REX"), "ETB-Leak (rufname)");
    assert!(!inhalte[0].contains("CHIP_999"), "ETB-Leak (kennzeichnung)");
    assert!(!inhalte[0].contains("GEHEIM"), "ETB-Leak (halter_kontakt)");
}

#[tokio::test]
async fn lifecycle_etb_kein_leak_von_ziel_und_kennzeichnung() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let t = tier_anlegen(
        &app,
        &admin,
        e,
        &json!({"spezies":"katze","rufname":"GEHEIM_MIEZ","kennzeichnung":"TATTOO_ABC"}),
    )
    .await;
    anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{e}/tiere/{t}/status"),
        &admin,
        Some(&json!({"status":"vermisst"})),
    )
    .await;
    anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{e}/tiere/{t}/status"),
        &admin,
        Some(&json!({"status":"aktiv"})),
    )
    .await;
    anfrage(&app, "POST", &format!("/api/einsaetze/{e}/tiere/{t}/status"), &admin,
        Some(&json!({"status":"abgeschlossen","abschluss_grund":"uebergabe_tierarzt","abschluss_ziel":"GEHEIM_ZIEL_TIERARZT"}))).await;
    anfrage(
        &app,
        "DELETE",
        &format!("/api/einsaetze/{e}/tiere/{t}"),
        &admin,
        None,
    )
    .await;

    let inhalte = system_etb_inhalte(&app, &admin, e).await;
    // 1× Anlegen + 3× Status + 1× Storno = 5 Einträge.
    assert_eq!(
        inhalte.len(),
        5,
        "ein Eintrag je Lifecycle-Event: {inhalte:?}"
    );
    for i in &inhalte {
        assert!(!i.contains("GEHEIM_MIEZ"), "Leak rufname: {i}");
        assert!(!i.contains("TATTOO_ABC"), "Leak kennzeichnung: {i}");
        assert!(
            !i.contains("GEHEIM_ZIEL_TIERARZT"),
            "Leak abschluss_ziel: {i}"
        );
    }
    assert!(
        inhalte
            .iter()
            .any(|i| i.contains("T-001") && i.contains("aufgefunden")),
        "vermisst→aktiv (aufgefunden)"
    );
    assert!(
        inhalte
            .iter()
            .any(|i| i.contains("abgeschlossen (uebergabe_tierarzt)")),
        "Abschluss nennt nur den Grund"
    );
    assert!(inhalte.iter().any(|i| i.contains("T-001 storniert")));
}

// ---------- Tests: Rechte-Matrix + Org-Isolation + Read-only ----------

#[tokio::test]
async fn beobachter_kann_nicht_schreiben_aber_lesen() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let beob_id = benutzer_anlegen(&app, &admin, "beobachter", "keine").await;
    let e = einsatz_anlegen(&app, &admin).await;
    rolle_setzen(&app, &admin, e, beob_id, "beobachter").await;
    tier_anlegen(&app, &admin, e, &json!({"spezies":"hund"})).await;
    let beob = login_cookie(&app, "beobachter", "beobachterpw1").await;
    // Lesen ok.
    let (s_get, _) = anfrage(
        &app,
        "GET",
        &format!("/api/einsaetze/{e}/tiere"),
        &beob,
        None,
    )
    .await;
    assert_eq!(s_get, StatusCode::OK);
    // Schreiben verboten.
    let (s_post, _) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{e}/tiere"),
        &beob,
        Some(&json!({"spezies":"katze"})),
    )
    .await;
    assert_eq!(s_post, StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn fremder_einsatz_detail_ist_404() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let t = tier_anlegen(&app, &admin, e, &json!({"spezies":"hund"})).await;
    let anderer = einsatz_anlegen(&app, &admin).await;
    let (s, _) = anfrage(
        &app,
        "GET",
        &format!("/api/einsaetze/{anderer}/tiere/{t}"),
        &admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn fremder_einsatz_ohne_mitgliedschaft_ist_403() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    // Benutzer anlegen (Existenz reicht), aber NICHT dem Einsatz zuordnen.
    benutzer_anlegen(&app, &admin, "fremdnutzer", "keine").await;
    let e = einsatz_anlegen(&app, &admin).await; // admin ist Leitung, fremdnutzer kein Mitglied
    let fremd = login_cookie(&app, "fremdnutzer", "fremdnutzerpw1").await;
    let (s, _) = anfrage(
        &app,
        "GET",
        &format!("/api/einsaetze/{e}/tiere"),
        &fremd,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn abgeschlossener_einsatz_ist_readonly_409() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let t = tier_anlegen(&app, &admin, e, &json!({"spezies":"hund"})).await;
    einsatz_abschliessen(&app, &admin, e).await;
    // Lesen weiterhin ok (Nachlauffrist), Schreiben → 409.
    let (s_get, _) = anfrage(
        &app,
        "GET",
        &format!("/api/einsaetze/{e}/tiere"),
        &admin,
        None,
    )
    .await;
    assert_eq!(s_get, StatusCode::OK);
    let (s_post, _) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{e}/tiere"),
        &admin,
        Some(&json!({"spezies":"katze"})),
    )
    .await;
    assert_eq!(s_post, StatusCode::CONFLICT);
    let (s_patch, _) = anfrage(
        &app,
        "PATCH",
        &format!("/api/einsaetze/{e}/tiere/{t}"),
        &admin,
        Some(&json!({"rufname":"X"})),
    )
    .await;
    assert_eq!(s_patch, StatusCode::CONFLICT);
    let (s_del, _) = anfrage(
        &app,
        "DELETE",
        &format!("/api/einsaetze/{e}/tiere/{t}"),
        &admin,
        None,
    )
    .await;
    assert_eq!(s_del, StatusCode::CONFLICT);
}

#[tokio::test]
async fn export_liefert_csv_ohne_audit() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    tier_anlegen(&app, &admin, e, &json!({"spezies":"hund","rufname":"Rex"})).await;
    let resp = app
        .clone()
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(format!("/api/einsaetze/{e}/tiere/export"))
                .header(header::COOKIE, &admin)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let ct = resp
        .headers()
        .get(header::CONTENT_TYPE)
        .unwrap()
        .to_str()
        .unwrap()
        .to_string();
    assert!(ct.starts_with("text/csv"));
    let bytes = to_bytes(resp.into_body(), 1024 * 1024).await.unwrap();
    let csv = String::from_utf8(bytes.to_vec()).unwrap();
    assert!(csv.contains("T-001"));
    assert!(csv.contains("Rex"));
}

// ── LFH-266/F12: PATCH-Tri-State für die Identitätsfelder ────────────────────────────

/// `null` leert ein Identitätsfeld (vorher: COALESCE behielt still den Altwert und
/// antwortete 200).
#[tokio::test]
async fn patch_null_leert_identitaetsfeld() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let t = tier_anlegen(
        &app,
        &admin,
        e,
        &json!({"spezies":"hund","rufname":"Rex","notiz":"scheu"}),
    )
    .await;

    let (status, v) = anfrage(
        &app,
        "PATCH",
        &format!("/api/einsaetze/{e}/tiere/{t}"),
        &admin,
        Some(&json!({"rufname":null})),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert!(v["rufname"].is_null(), "null leert das Feld");
    assert_eq!(v["spezies"], "hund", "nicht genanntes Feld bleibt");
    assert_eq!(v["notiz"], "scheu", "nicht genanntes Feld bleibt");
}

/// Leerstring wird wie `null` behandelt — Symmetrie zu `einsatz_person`.
#[tokio::test]
async fn patch_leerstring_leert_identitaetsfeld() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let t = tier_anlegen(
        &app,
        &admin,
        e,
        &json!({"spezies":"hund","kennzeichnung":"Chip 123"}),
    )
    .await;

    let (status, v) = anfrage(
        &app,
        "PATCH",
        &format!("/api/einsaetze/{e}/tiere/{t}"),
        &admin,
        Some(&json!({"kennzeichnung":"  "})),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert!(v["kennzeichnung"].is_null());
}

/// Der schärfste Test des Umbaus: die neun neuen Identitäts-Flag/Wert-Paare liegen im SQL
/// direkt VOR den bestehenden Halter-Paaren. Eine um eine Position verschobene Bind-Kette
/// würde ein Identitäts-Flag auf einen Halter-Wert treffen lassen und den Halter still
/// mitleeren — ohne Compile- und ohne Laufzeitfehler.
#[tokio::test]
async fn patch_identitaet_laesst_halter_unberuehrt() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let t = tier_anlegen(
        &app,
        &admin,
        e,
        &json!({"spezies":"katze","rufname":"Mia","halter_kontakt":"Frau Meier, 0170-9"}),
    )
    .await;

    let (status, v) = anfrage(
        &app,
        "PATCH",
        &format!("/api/einsaetze/{e}/tiere/{t}"),
        &admin,
        Some(&json!({"rufname":null})),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert!(v["rufname"].is_null(), "das gemeinte Feld wird geleert");
    assert_eq!(
        v["halter_kontakt"], "Frau Meier, 0170-9",
        "der Halter darf NICHT mitgeleert werden (Bind-Verschiebung)"
    );
}

/// Gegenprobe: ein leerer Patch fasst nichts an.
#[tokio::test]
async fn patch_leeres_objekt_laesst_tier_unveraendert() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let t = tier_anlegen(
        &app,
        &admin,
        e,
        &json!({"spezies":"hund","rufname":"Rex","notiz":"scheu"}),
    )
    .await;

    let (status, v) = anfrage(
        &app,
        "PATCH",
        &format!("/api/einsaetze/{e}/tiere/{t}"),
        &admin,
        Some(&json!({})),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(v["rufname"], "Rex");
    assert_eq!(v["notiz"], "scheu");
}
