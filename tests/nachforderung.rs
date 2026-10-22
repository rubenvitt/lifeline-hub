use axum::http::StatusCode;

mod common;
use common::{anfrage, benutzer_anlegen, einsatz_anlegen, login_cookie, rolle_setzen, setup};

fn body() -> String {
    serde_json::json!({
        "art": "RTW", "bezeichnung": "2 RTW zur Verstärkung", "anzahl": 2,
        "adressat_kategorie": "leitstelle", "adressat_bezeichnung": "Leitstelle Nord",
        "prioritaet": "dringend"
    })
    .to_string()
}

#[tokio::test]
async fn anlegen_erzeugt_nachforderung_und_etb() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let (status, n) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{e}/nachforderungen"),
        &admin,
        Some(&body()),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{n:?}");
    assert_eq!(n["status"], "angefordert");
    assert_eq!(n["anzahl"], 2);
    assert_eq!(n["adressat_kategorie"], "leitstelle");
    assert_eq!(n["ist_offen"], true);
    assert!(n["etb_nachforderung_id"].is_i64());
    // ETB enthält die Anforderung als Meldung.
    let (_, etb) = anfrage(
        &app,
        "GET",
        &format!("/api/einsaetze/{e}/etb"),
        &admin,
        None,
    )
    .await;
    assert!(etb
        .as_array()
        .unwrap()
        .iter()
        .any(|x| x["typ"] == "meldung"));
}

#[tokio::test]
async fn leere_bezeichnung_ist_ohne_details_und_leere_art_ist_400() {
    // LLH-1089: Die Bezeichnung („Details / Zweck“) ist optional; Leerraum zählt als fehlend.
    // Pflicht bleibt die Art.
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let url = format!("/api/einsaetze/{e}/nachforderungen");
    let b = serde_json::json!({ "art": "RTW", "bezeichnung": "  ", "adressat_kategorie": "leitstelle" }).to_string();
    let (status, n) = anfrage(&app, "POST", &url, &admin, Some(&b)).await;
    assert_eq!(status, StatusCode::CREATED, "{n:?}");
    assert!(n.get("bezeichnung").is_none(), "{n:?}");
    let b = serde_json::json!({ "art": "  ", "adressat_kategorie": "leitstelle" }).to_string();
    let (status, _) = anfrage(&app, "POST", &url, &admin, Some(&b)).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
}

/// LFH-553 (Spec `stab-versorgung`, „Betriebsstoffe als Nachforderung mit freier Art“):
/// Betriebsstoffe und Verbrauchsgüter laufen als Nachforderung mit frei beschrifteter Art.
/// Eine feste Artenliste wäre eine neue Entscheidung (Wiedervorlage nur mit Feldbefund) —
/// dieser Test hält fest, dass die Art heute nicht gegen eine Liste geprüft wird.
#[tokio::test]
async fn betriebsstoff_ist_eine_nachforderung_mit_freier_art() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let b = serde_json::json!({
        "art": "Kraftstoff Diesel", "bezeichnung": "2 × 200 l für Pumpen EA Süd", "anzahl": 2,
        "adressat_kategorie": "leitstelle"
    })
    .to_string();
    let (status, n) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{e}/nachforderungen"),
        &admin,
        Some(&b),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{n:?}");
    assert_eq!(n["art"], "Kraftstoff Diesel");
    assert_eq!(n["status"], "angefordert");
    let etb_id = n["etb_nachforderung_id"].as_i64().expect("ETB-Verweis");
    let (_, etb) = anfrage(
        &app,
        "GET",
        &format!("/api/einsaetze/{e}/etb"),
        &admin,
        None,
    )
    .await;
    let eintrag = etb
        .as_array()
        .unwrap()
        .iter()
        .find(|x| x["id"] == etb_id)
        .expect("ETB-Eintrag der Nachforderung");
    assert!(eintrag["inhalt"]
        .as_str()
        .unwrap()
        .contains("Kraftstoff Diesel"));
}

#[tokio::test]
async fn anlegen_ungueltige_adressat_kategorie_ist_400() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let b =
        serde_json::json!({ "art": "RTW", "bezeichnung": "x", "adressat_kategorie": "irgendwer" })
            .to_string();
    let (status, _) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{e}/nachforderungen"),
        &admin,
        Some(&b),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn status_workflow_und_ungueltiger_uebergang_ist_422() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let (_, n) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{e}/nachforderungen"),
        &admin,
        Some(&body()),
    )
    .await;
    let nid = n["id"].as_i64().unwrap();

    // angefordert → unterwegs ist KEIN erlaubter (Sprung) → 422.
    let (status, _) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{e}/nachforderungen/{nid}/status"),
        &admin,
        Some(r#"{"status":"unterwegs"}"#),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);

    // angefordert → zugesagt → unterwegs → eingetroffen (linear).
    for ziel in ["zugesagt", "unterwegs", "eingetroffen"] {
        let (status, j) = anfrage(
            &app,
            "POST",
            &format!("/api/einsaetze/{e}/nachforderungen/{nid}/status"),
            &admin,
            Some(&format!(r#"{{"status":"{ziel}"}}"#)),
        )
        .await;
        assert_eq!(status, StatusCode::OK, "{j:?}");
        assert_eq!(j["status"], ziel);
    }
    // eingetroffen ist terminal → weiterer Übergang 422.
    let (status, j) = anfrage(
        &app,
        "GET",
        &format!("/api/einsaetze/{e}/nachforderungen"),
        &admin,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(j.as_array().unwrap()[0]["ist_offen"], false);
}

/// LLH-1104 (Spec `etb-vorgaenge`): die ETB-Liste trägt am Anlage-Eintrag und an jeder Stufe den
/// Verweis `nachforderung_id`; Absender ist die Führungsstelle, nicht „System“.
#[tokio::test]
async fn stufen_stehen_mit_verweis_in_der_etb_liste() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let (s, _) = anfrage(
        &app,
        "PATCH",
        &format!("/api/einsaetze/{e}/fuehrungsstelle"),
        &admin,
        Some(r#"{"rufname":"Florian Musterstadt 10/1"}"#),
    )
    .await;
    assert!(s.is_success(), "Führungsstelle: {s}");
    let (_, n) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{e}/nachforderungen"),
        &admin,
        Some(&body()),
    )
    .await;
    let nid = n["id"].as_i64().unwrap();
    for ziel in ["zugesagt", "angefordert"] {
        let (status, j) = anfrage(
            &app,
            "POST",
            &format!("/api/einsaetze/{e}/nachforderungen/{nid}/status"),
            &admin,
            Some(&format!(r#"{{"status":"{ziel}"}}"#)),
        )
        .await;
        assert_eq!(status, StatusCode::OK, "{j:?}");
    }
    let (status, j) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{e}/nachforderungen/{nid}/ablehnen"),
        &admin,
        Some(r#"{"grund":"keine Reserven"}"#),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{j:?}");

    let (_, etb) = anfrage(
        &app,
        "GET",
        &format!("/api/einsaetze/{e}/etb"),
        &admin,
        None,
    )
    .await;
    let mut eigene: Vec<&serde_json::Value> = etb
        .as_array()
        .unwrap()
        .iter()
        .filter(|x| x["nachforderung_id"] == nid)
        .collect();
    eigene.sort_by_key(|x| x["lfd_nr"].as_i64());
    let inhalte: Vec<&str> = eigene
        .iter()
        .map(|x| x["inhalt"].as_str().unwrap())
        .collect();
    assert_eq!(
        inhalte,
        [
            "Nachforderung: 2× RTW — 2 RTW zur Verstärkung",
            "Nachforderung 2× RTW: zugesagt",
            "Nachforderung 2× RTW: zurückgesetzt auf angefordert",
            "Nachforderung 2× RTW: abgelehnt (keine Reserven)",
        ]
    );
    assert_eq!(eigene[0]["von"], "Florian Musterstadt 10/1");
    assert_eq!(eigene[0]["an"], "Leitstelle Nord");
    assert!(eigene[1..].iter().all(|x| x["typ"] == "system"));
}

#[tokio::test]
async fn status_abgelehnt_ueber_status_endpoint_ist_422() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let (_, n) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{e}/nachforderungen"),
        &admin,
        Some(&body()),
    )
    .await;
    let nid = n["id"].as_i64().unwrap();
    // 'abgelehnt' gehört auf den /ablehnen-Pfad → /status weist sauber mit 422 ab (kein 400).
    let (status, _) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{e}/nachforderungen/{nid}/status"),
        &admin,
        Some(r#"{"status":"abgelehnt"}"#),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
}

#[tokio::test]
async fn ablehnen_setzt_grund() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let (_, n) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{e}/nachforderungen"),
        &admin,
        Some(&body()),
    )
    .await;
    let nid = n["id"].as_i64().unwrap();
    let (status, j) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{e}/nachforderungen/{nid}/ablehnen"),
        &admin,
        Some(r#"{"grund":"keine Reserven"}"#),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(j["status"], "abgelehnt");
    assert_eq!(j["abgelehnt_grund"], "keine Reserven");
}

/// LLH-1385: der Ablehnungsgrund ist wie der Grund des Zurückziehens begrenzt (er steht im
/// ETB-Wortlaut); zu lang → 400 und die Nachforderung bleibt offen, die Grenze selbst geht.
#[tokio::test]
async fn ablehnen_mit_zu_langem_grund_ist_400() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let nid = absetzen(&app, &admin, e).await;
    let url = format!("/api/einsaetze/{e}/nachforderungen/{nid}/ablehnen");
    let max = lifeline_hub::nachforderung::ABLEHNEN_GRUND_MAX;

    let lang = serde_json::json!({ "grund": "x".repeat(max + 1) }).to_string();
    let (s, j) = anfrage(&app, "POST", &url, &admin, Some(&lang)).await;
    assert_eq!(s, StatusCode::BAD_REQUEST, "{j}");
    assert_eq!(liste(&app, &admin, e).await[0]["status"], "angefordert");

    // Gezählt wird nach dem Trimmen, in Zeichen (nicht Bytes).
    let genau = serde_json::json!({ "grund": format!(" {} ", "ä".repeat(max)) }).to_string();
    let (s, j) = anfrage(&app, "POST", &url, &admin, Some(&genau)).await;
    assert_eq!(s, StatusCode::OK, "{j}");
    assert_eq!(j["abgelehnt_grund"], "ä".repeat(max));
}

#[tokio::test]
async fn beobachter_liest_aber_schreibt_nicht() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let erika = benutzer_anlegen(&app, &admin, "erika", "keine").await;
    rolle_setzen(&app, &admin, e, erika, "beobachter").await;
    let erika_c = login_cookie(&app, "erika", "erikapw1").await;
    let (status, _) = anfrage(
        &app,
        "GET",
        &format!("/api/einsaetze/{e}/nachforderungen"),
        &erika_c,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let (status, _) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{e}/nachforderungen"),
        &erika_c,
        Some(&body()),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn cross_einsatz_status_ist_404() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let a = einsatz_anlegen(&app, &admin).await;
    let b = einsatz_anlegen(&app, &admin).await;
    let (_, n) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{a}/nachforderungen"),
        &admin,
        Some(&body()),
    )
    .await;
    let nid = n["id"].as_i64().unwrap();
    let (status, _) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{b}/nachforderungen/{nid}/status"),
        &admin,
        Some(r#"{"status":"zugesagt"}"#),
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
}

// ── Rücknahme nach einer Übernahme (LLH-1226, design.md D9) ─────────────────────────────

async fn set_status(
    app: &axum::Router,
    cookie: &str,
    e: i64,
    nid: i64,
    status: &str,
) -> (StatusCode, serde_json::Value) {
    anfrage(
        app,
        "POST",
        &format!("/api/einsaetze/{e}/nachforderungen/{nid}/status"),
        cookie,
        Some(&format!(r#"{{"status":"{status}"}}"#)),
    )
    .await
}

/// Setzt eine Nachforderung ab und meldet sie eingetroffen; liefert ihre id.
async fn eingetroffen(app: &axum::Router, cookie: &str, e: i64) -> i64 {
    let (_, n) = anfrage(
        app,
        "POST",
        &format!("/api/einsaetze/{e}/nachforderungen"),
        cookie,
        Some(&body()),
    )
    .await;
    let nid = n["id"].as_i64().unwrap();
    for s in ["zugesagt", "unterwegs", "eingetroffen"] {
        assert_eq!(set_status(app, cookie, e, nid, s).await.0, StatusCode::OK);
    }
    nid
}

/// Übernimmt einen Posten aus der Nachforderung; liefert die `em_id`.
async fn uebernehmen(app: &axum::Router, cookie: &str, e: i64, nid: i64) -> i64 {
    let (s, json) = anfrage(
        app,
        "POST",
        &format!("/api/einsaetze/{e}/material"),
        cookie,
        Some(&format!(
            r#"{{"adhoc":{{"bezeichnung":"RTW-Ausstattung"}},"nachforderung_id":{nid}}}"#
        )),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{json}");
    json["id"].as_i64().unwrap()
}

/// Spec `nachforderung-material`, „Rücknahme nach Übernahme gesperrt“: mit einem zählenden
/// Posten bleibt die Nachforderung eingetroffen (422 mit Grund), auch ein aus dem Einsatz
/// genommener Posten sperrt.
#[tokio::test]
async fn ruecknahme_nach_uebernahme_ist_422() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let nid = eingetroffen(&app, &admin, e).await;
    let em = uebernehmen(&app, &admin, e, nid).await;

    let (s, json) = set_status(&app, &admin, e, nid, "unterwegs").await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY, "{json}");
    assert_eq!(
        json["error"],
        "Aus der Nachforderung ist Material übernommen"
    );
    let (s, json) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{e}/material/{em}/entlassen"),
        &admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{json}");
    let (s, _) = set_status(&app, &admin, e, nid, "unterwegs").await;
    assert_eq!(
        s,
        StatusCode::UNPROCESSABLE_ENTITY,
        "entlassen zählt weiter"
    );

    let (_, liste) = anfrage(
        &app,
        "GET",
        &format!("/api/einsaetze/{e}/nachforderungen"),
        &admin,
        None,
    )
    .await;
    assert_eq!(liste[0]["status"], "eingetroffen");
}

/// LLH-1247: „Rückgängig“ nach „Zusage erfassen“ nimmt die Zusage zurück (früher 400
/// „Ungültiger Zielstatus“) und leert ihren Zeitpunkt; die nächste Zusage trägt ihren eigenen.
#[tokio::test]
async fn ruecknahme_auf_angefordert_geht_und_leert_den_zeitpunkt() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let (_, n) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{e}/nachforderungen"),
        &admin,
        Some(&body()),
    )
    .await;
    let nid = n["id"].as_i64().unwrap();

    let (s, json) = set_status(&app, &admin, e, nid, "zugesagt").await;
    assert_eq!(s, StatusCode::OK, "{json}");
    assert!(json["zugesagt_at"].is_string());

    let (s, json) = set_status(&app, &admin, e, nid, "angefordert").await;
    assert_eq!(s, StatusCode::OK, "{json}");
    assert_eq!(json["status"], "angefordert");
    assert!(json["zugesagt_at"].is_null(), "{json}");
    assert_eq!(json["ist_offen"], true);

    let (s, json) = set_status(&app, &admin, e, nid, "zugesagt").await;
    assert_eq!(s, StatusCode::OK, "{json}");
    assert!(json["zugesagt_at"].is_string());

    // Zwei Stufen zurück bleiben zu.
    assert_eq!(
        set_status(&app, &admin, e, nid, "unterwegs").await.0,
        StatusCode::OK
    );
    let (s, _) = set_status(&app, &admin, e, nid, "angefordert").await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY);
}

/// Ohne Posten und mit nur storniertem Posten bleibt die Rücknahme (LFH-343 C8) erlaubt.
#[tokio::test]
async fn ruecknahme_ohne_oder_mit_storniertem_posten_geht() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let ohne = eingetroffen(&app, &admin, e).await;
    let (s, json) = set_status(&app, &admin, e, ohne, "unterwegs").await;
    assert_eq!(s, StatusCode::OK, "{json}");
    assert_eq!(json["status"], "unterwegs");

    let storniert = eingetroffen(&app, &admin, e).await;
    let em = uebernehmen(&app, &admin, e, storniert).await;
    let (s, _) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{e}/material/{em}/stornieren"),
        &admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::NO_CONTENT);
    let (s, json) = set_status(&app, &admin, e, storniert, "unterwegs").await;
    assert_eq!(s, StatusCode::OK, "{json}");
}

// ── Zusage, Zurückziehen, Bearbeiten (LLH-1097 Teil a) ─────────────────────────────────

/// Setzt „2× RTW“ ab; liefert die id.
async fn absetzen(app: &axum::Router, cookie: &str, e: i64) -> i64 {
    let (s, n) = anfrage(
        app,
        "POST",
        &format!("/api/einsaetze/{e}/nachforderungen"),
        cookie,
        Some(&body()),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{n}");
    n["id"].as_i64().unwrap()
}

async fn zusage(
    app: &axum::Router,
    cookie: &str,
    e: i64,
    nid: i64,
    body: serde_json::Value,
) -> (StatusCode, serde_json::Value) {
    anfrage(
        app,
        "POST",
        &format!("/api/einsaetze/{e}/nachforderungen/{nid}/zusage"),
        cookie,
        Some(&body.to_string()),
    )
    .await
}

async fn liste(app: &axum::Router, cookie: &str, e: i64) -> Vec<serde_json::Value> {
    let (_, l) = anfrage(
        app,
        "GET",
        &format!("/api/einsaetze/{e}/nachforderungen"),
        cookie,
        None,
    )
    .await;
    l.as_array().unwrap().clone()
}

/// ETB-Inhalte mit Verweis auf die Nachforderung, in Folge der Liste.
async fn etb_inhalte(app: &axum::Router, cookie: &str, e: i64, nid: i64) -> Vec<String> {
    let (_, etb) = anfrage(app, "GET", &format!("/api/einsaetze/{e}/etb"), cookie, None).await;
    etb.as_array()
        .unwrap()
        .iter()
        .filter(|x| x["nachforderung_id"] == nid)
        .map(|x| x["inhalt"].as_str().unwrap().to_string())
        .collect()
}

/// Akzeptanz: Zusage 1 von 2 über die Route → zwei Positionen in der Liste; „Wer“ getrimmt und
/// entdoppelt, Eintreffen normalisiert.
#[tokio::test]
async fn teilzusage_ueber_die_route_ergibt_zwei_positionen() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let nid = absetzen(&app, &admin, e).await;
    let (s, n) = zusage(
        &app,
        &admin,
        e,
        nid,
        serde_json::json!({
            "anzahl": 1,
            "rufnamen": [" Florian Musterstadt 83-1 ", "", "Florian Musterstadt 83-1"],
            "eintreffen_erwartet_at": "2099-01-01T12:30"
        }),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{n}");
    assert_eq!(n["status"], "zugesagt");
    assert_eq!(n["anzahl"], 1);
    assert_eq!(n["anzahl_angefordert"], 2);
    assert_eq!(
        n["zusage_rufnamen"],
        serde_json::json!(["Florian Musterstadt 83-1"])
    );
    assert_eq!(n["eintreffen_erwartet_at"], "2099-01-01 12:30:00");
    assert!(n.get("teilung_aus_id").is_none(), "{n}");

    let l = liste(&app, &admin, e).await;
    assert_eq!(l.len(), 2);
    let rest = l.iter().find(|x| x["id"] != nid).unwrap();
    assert_eq!(rest["status"], "angefordert");
    assert_eq!(rest["anzahl"], 1);
    assert_eq!(rest["teilung_aus_id"], nid);
    assert_eq!(rest["zusage_rufnamen"], serde_json::json!([]));
    assert_eq!(rest["ist_offen"], true);

    let etb = etb_inhalte(&app, &admin, e, nid).await;
    assert!(
        etb.iter().any(|i| i.starts_with(
            "Nachforderung 2× RTW: 1 zugesagt (Florian Musterstadt 83-1), Eintreffen erwartet"
        ) && i.ends_with("; 1× RTW weiter angefordert")),
        "{etb:?}"
    );
}

/// D4: erst die Felder für sich (400), dann der Zusammenhang (422), Bezug 404, Rolle 403.
#[tokio::test]
async fn zusage_statuscodes() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let anderer = einsatz_anlegen(&app, &admin).await;
    let nid = absetzen(&app, &admin, e).await;
    let viele: Vec<String> = (0..21).map(|i| format!("83-{i}")).collect();
    for (body, erwartet) in [
        (serde_json::json!({ "anzahl": 0 }), StatusCode::BAD_REQUEST),
        (
            serde_json::json!({ "rufnamen": viele }),
            StatusCode::BAD_REQUEST,
        ),
        (
            serde_json::json!({ "rufnamen": ["x".repeat(101)] }),
            StatusCode::BAD_REQUEST,
        ),
        (
            serde_json::json!({ "eintreffen_erwartet_at": "gleich" }),
            StatusCode::BAD_REQUEST,
        ),
        (
            serde_json::json!({ "anzahl": 3 }),
            StatusCode::UNPROCESSABLE_ENTITY,
        ),
        (
            serde_json::json!({ "anzahl": 1, "rufnamen": ["83-1", "83-2"] }),
            StatusCode::UNPROCESSABLE_ENTITY,
        ),
        (
            serde_json::json!({ "eintreffen_erwartet_at": "2001-01-01 08:00:00" }),
            StatusCode::UNPROCESSABLE_ENTITY,
        ),
    ] {
        let (s, j) = zusage(&app, &admin, e, nid, body.clone()).await;
        assert_eq!(s, erwartet, "{body} → {j}");
    }
    let (s, _) = zusage(&app, &admin, anderer, nid, serde_json::json!({})).await;
    assert_eq!(s, StatusCode::NOT_FOUND);

    let erika = benutzer_anlegen(&app, &admin, "erika", "keine").await;
    rolle_setzen(&app, &admin, e, erika, "beobachter").await;
    let erika_c = login_cookie(&app, "erika", "erikapw1").await;
    let (s, _) = zusage(&app, &erika_c, e, nid, serde_json::json!({})).await;
    assert_eq!(s, StatusCode::FORBIDDEN);

    let (s, n) = zusage(&app, &admin, e, nid, serde_json::json!({})).await;
    assert_eq!(s, StatusCode::OK, "{n}");
    assert_eq!(n["anzahl"], 2);
    assert!(n.get("anzahl_angefordert").is_none(), "{n}");
    let (s, _) = zusage(&app, &admin, e, nid, serde_json::json!({})).await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY, "schon zugesagt");
    assert_eq!(liste(&app, &admin, e).await.len(), 1);
}

/// D8: Zurückziehen aus offenen Stufen, terminal, mit Grund und ETB; nicht über `…/status`.
#[tokio::test]
async fn zurueckziehen_ist_terminal_und_steht_im_etb() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let nid = absetzen(&app, &admin, e).await;
    let url = format!("/api/einsaetze/{e}/nachforderungen/{nid}/zurueckziehen");

    let (s, _) = set_status(&app, &admin, e, nid, "zurueckgezogen").await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY);
    let lang = serde_json::json!({ "grund": "x".repeat(201) }).to_string();
    let (s, _) = anfrage(&app, "POST", &url, &admin, Some(&lang)).await;
    assert_eq!(s, StatusCode::BAD_REQUEST);

    assert_eq!(
        set_status(&app, &admin, e, nid, "zugesagt").await.0,
        StatusCode::OK
    );
    let (s, n) = anfrage(
        &app,
        "POST",
        &url,
        &admin,
        Some(r#"{"grund":" nicht mehr benötigt "}"#),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{n}");
    assert_eq!(n["status"], "zurueckgezogen");
    assert_eq!(n["ist_offen"], false);
    assert_eq!(n["zurueckgezogen_grund"], "nicht mehr benötigt");
    assert!(n["zurueckgezogen_at"].is_string());
    assert!(etb_inhalte(&app, &admin, e, nid)
        .await
        .contains(&"Nachforderung 2× RTW: zurückgezogen (nicht mehr benötigt)".to_string()));

    let (s, _) = anfrage(&app, "POST", &url, &admin, Some("{}")).await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY, "terminal");
    let (s, _) = set_status(&app, &admin, e, nid, "angefordert").await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY, "kein Rückweg");

    let da = eingetroffen(&app, &admin, e).await;
    let (s, _) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{e}/nachforderungen/{da}/zurueckziehen"),
        &admin,
        Some("{}"),
    )
    .await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY, "was da ist, bleibt");
}

/// D9: Bearbeiten über PATCH — Felder 400, Zusammenhang 422, Ziel 404, ohne Änderung kein ETB.
#[tokio::test]
async fn bearbeiten_ueber_patch() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let nid = absetzen(&app, &admin, e).await;
    let url = format!("/api/einsaetze/{e}/nachforderungen/{nid}");
    let patch = |body: serde_json::Value| {
        let (app, admin, url) = (app.clone(), admin.clone(), url.clone());
        async move { anfrage(&app, "PATCH", &url, &admin, Some(&body.to_string())).await }
    };

    for (body, erwartet) in [
        (serde_json::json!({ "anzahl": 0 }), StatusCode::BAD_REQUEST),
        (
            serde_json::json!({ "prioritaet": "ultra" }),
            StatusCode::BAD_REQUEST,
        ),
        (
            serde_json::json!({ "bezeichnung": "x".repeat(201) }),
            StatusCode::BAD_REQUEST,
        ),
        (
            serde_json::json!({ "ziel_text": "Hof", "ziel_br_id": 1 }),
            StatusCode::UNPROCESSABLE_ENTITY,
        ),
        (
            serde_json::json!({ "eintreffen_erwartet_at": "2099-01-01 12:00:00" }),
            StatusCode::UNPROCESSABLE_ENTITY,
        ),
        (
            serde_json::json!({ "ziel_br_id": 999999 }),
            StatusCode::NOT_FOUND,
        ),
    ] {
        let (s, j) = patch(body.clone()).await;
        assert_eq!(s, erwartet, "{body} → {j}");
    }
    let vorher = etb_inhalte(&app, &admin, e, nid).await.len();

    let (s, n) = patch(serde_json::json!({
        "anzahl": 3, "prioritaet": "sofort", "ziel_text": " Hof Süd ", "bezeichnung": null
    }))
    .await;
    assert_eq!(s, StatusCode::OK, "{n}");
    assert_eq!(n["anzahl"], 3);
    assert_eq!(n["prioritaet"], "sofort");
    assert_eq!(n["ziel_text"], "Hof Süd");
    assert!(n.get("bezeichnung").is_none(), "{n}");
    assert_eq!(n["art"], "RTW");
    let etb = etb_inhalte(&app, &admin, e, nid).await;
    assert_eq!(etb.len(), vorher + 1);
    assert!(etb.contains(
        &"Nachforderung 2× RTW geändert: Anzahl 3; → Hof Süd; Priorität sofort; ohne Details"
            .to_string()
    ));

    let (s, _) = patch(serde_json::json!({ "anzahl": 3 })).await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(etb_inhalte(&app, &admin, e, nid).await.len(), vorher + 1);

    // Ein Ziel im Body ersetzt das ganze Ziel: nur `ziel_br_id: null` leert auch den Ort.
    let (s, n) = patch(serde_json::json!({ "ziel_br_id": null })).await;
    assert_eq!(s, StatusCode::OK, "{n}");
    assert!(n.get("ziel_text").is_none(), "{n}");

    assert_eq!(
        zusage(&app, &admin, e, nid, serde_json::json!({})).await.0,
        StatusCode::OK
    );
    let (s, n) = patch(serde_json::json!({
        "eintreffen_erwartet_at": "2099-01-01 13:00", "rufnamen": ["83-1"]
    }))
    .await;
    assert_eq!(s, StatusCode::OK, "{n}");
    assert_eq!(n["eintreffen_erwartet_at"], "2099-01-01 13:00:00");
    assert_eq!(n["zusage_rufnamen"], serde_json::json!(["83-1"]));

    let (s, _) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{e}/nachforderungen/{nid}/zurueckziehen"),
        &admin,
        Some("{}"),
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    let (s, _) = patch(serde_json::json!({ "anzahl": 1 })).await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY, "abgeschlossen");
}
