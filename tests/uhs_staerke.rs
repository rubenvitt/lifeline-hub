//! Stärke der UHS (LFH-1045): berechnet aus den zugeordneten Einsatzkräften, gepflegt über die
//! Zuordnung. Spec: `uhs-staerke` (OpenSpec-Change unter /mnt/project-files/lfh-1045/).

use axum::http::StatusCode;
use serde_json::{json, Value};

mod common;
use common::{
    anfrage, anfrage_json, einheit_bilden, einsatz_anlegen, login_cookie, setup, system_etb_inhalte,
};

async fn uhs_anlegen(app: &axum::Router, cookie: &str, einsatz: i64, bez: &str) -> i64 {
    let (s, v) = anfrage_json(
        app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/uhs"),
        cookie,
        Some(&json!({"typ": "behandlungsplatz", "bezeichnung": bez})),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
    let uhs = v["id"].as_i64().unwrap();
    let (s, _) = anfrage_json(
        app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/uhs/{uhs}/status"),
        cookie,
        Some(&json!({"status": "aktiv"})),
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    uhs
}

/// Ad-hoc-Kraft mit Position; liefert die `ep_id`.
async fn kraft(app: &axum::Router, cookie: &str, einsatz: i64, name: &str, position: &str) -> i64 {
    let (s, v) = anfrage_json(
        app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/personal"),
        cookie,
        Some(&json!({"adhoc": {"name": name, "funktion": "Sanitäter", "staerke_position": position}})),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
    v["id"].as_i64().unwrap()
}

async fn zuordnen(app: &axum::Router, cookie: &str, einsatz: i64, uhs: i64, ep: i64) -> StatusCode {
    anfrage(
        app,
        "PUT",
        &format!("/api/einsaetze/{einsatz}/uhs/{uhs}/kraefte/{ep}"),
        cookie,
        None,
    )
    .await
    .0
}

async fn detail(app: &axum::Router, cookie: &str, einsatz: i64, uhs: i64) -> Value {
    let (s, v) = anfrage(
        app,
        "GET",
        &format!("/api/einsaetze/{einsatz}/uhs/{uhs}"),
        cookie,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    v
}

fn staerke(f: u32, uf: u32, m: u32) -> Value {
    json!({"fuehrer": f, "unterfuehrer": uf, "mannschaft": m})
}

async fn personal(app: &axum::Router, cookie: &str, einsatz: i64, ep: i64) -> Value {
    let (_, liste) = anfrage(
        app,
        "GET",
        &format!("/api/einsaetze/{einsatz}/personal"),
        cookie,
        None,
    )
    .await;
    liste
        .as_array()
        .unwrap()
        .iter()
        .find(|p| p["id"] == ep)
        .cloned()
        .expect("Kraft bleibt im Einsatz")
}

#[tokio::test]
async fn kraft_einer_einheit_zaehlt_an_der_uhs_und_bleibt_in_ihrer_einheit() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let nord = uhs_anlegen(&app, &admin, einsatz, "Nord").await;
    let seg = einheit_bilden(&app, &admin, einsatz, "SEG 1").await;
    let ep = kraft(&app, &admin, einsatz, "Anna", "mannschaft").await;
    let (s, _) = anfrage(
        &app,
        "PUT",
        &format!("/api/einsaetze/{einsatz}/einheiten/{seg}/personal/{ep}"),
        &admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::NO_CONTENT);

    assert_eq!(
        detail(&app, &admin, einsatz, nord).await["staerke"],
        staerke(0, 0, 0)
    );
    assert_eq!(
        zuordnen(&app, &admin, einsatz, nord, ep).await,
        StatusCode::OK
    );
    let d = detail(&app, &admin, einsatz, nord).await;
    assert_eq!(d["staerke"], staerke(0, 0, 1), "{d}");
    assert_eq!(d["kraefte"][0]["name"], "Anna");
    assert_eq!(d["kraefte"][0]["einheit"], "SEG 1");
    assert_eq!(d["kraefte"][0]["funktion"], "Sanitäter");

    // Die Einheit behält ihre Stärke.
    let (_, einheiten) = anfrage(
        &app,
        "GET",
        &format!("/api/einsaetze/{einsatz}/einheiten"),
        &admin,
        None,
    )
    .await;
    assert_eq!(einheiten[0]["ist"]["mannschaft"], json!(1), "{einheiten}");
    assert_eq!(
        personal(&app, &admin, einsatz, ep).await["uhs_id"],
        json!(nord)
    );

    let etb = system_etb_inhalte(&app, &admin, einsatz).await;
    assert!(
        etb.iter()
            .any(|t| t == "«Anna (Sanitäter)» an UHS «Nord» eingesetzt"),
        "{etb:?}"
    );

    // Nochmals zuordnen: unverändert, kein zweiter ETB-Eintrag.
    let vorher = system_etb_inhalte(&app, &admin, einsatz).await.len();
    assert_eq!(
        zuordnen(&app, &admin, einsatz, nord, ep).await,
        StatusCode::OK
    );
    assert_eq!(
        system_etb_inhalte(&app, &admin, einsatz).await.len(),
        vorher
    );
}

#[tokio::test]
async fn position_und_wechsel_aendern_die_staerke_ohne_pflege() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let nord = uhs_anlegen(&app, &admin, einsatz, "Nord").await;
    let sued = uhs_anlegen(&app, &admin, einsatz, "Süd").await;
    let ep = kraft(&app, &admin, einsatz, "Bernd", "mannschaft").await;
    assert_eq!(
        zuordnen(&app, &admin, einsatz, nord, ep).await,
        StatusCode::OK
    );

    let (s, v) = anfrage_json(
        &app,
        "PATCH",
        &format!("/api/einsaetze/{einsatz}/personal/{ep}"),
        &admin,
        Some(&json!({"staerke_position": "unterfuehrer"})),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert_eq!(
        detail(&app, &admin, einsatz, nord).await["staerke"],
        staerke(0, 1, 0)
    );

    // Die Leitung setzt die Kraft an die UHS Süd: sie zählt nur noch dort.
    assert_eq!(
        zuordnen(&app, &admin, einsatz, sued, ep).await,
        StatusCode::OK
    );
    let (_, liste) = anfrage(
        &app,
        "GET",
        &format!("/api/einsaetze/{einsatz}/uhs"),
        &admin,
        None,
    )
    .await;
    let von = |id: i64| {
        liste
            .as_array()
            .unwrap()
            .iter()
            .find(|u| u["id"] == id)
            .unwrap()["staerke"]
            .clone()
    };
    assert_eq!(von(nord), staerke(0, 0, 0));
    assert_eq!(von(sued), staerke(0, 1, 0));
}

#[tokio::test]
async fn loesen_laesst_die_kraft_im_einsatz() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let nord = uhs_anlegen(&app, &admin, einsatz, "Nord").await;
    let ep = kraft(&app, &admin, einsatz, "Clara", "fuehrer").await;
    assert_eq!(
        zuordnen(&app, &admin, einsatz, nord, ep).await,
        StatusCode::OK
    );
    let pfad = format!("/api/einsaetze/{einsatz}/uhs/{nord}/kraefte/{ep}");

    let (s, _) = anfrage(&app, "DELETE", &pfad, &admin, None).await;
    assert_eq!(s, StatusCode::NO_CONTENT);
    assert_eq!(
        detail(&app, &admin, einsatz, nord).await["staerke"],
        staerke(0, 0, 0)
    );
    assert!(personal(&app, &admin, einsatz, ep).await["uhs_id"].is_null());
    let (_, frei) = anfrage(
        &app,
        "GET",
        &format!("/api/einsaetze/{einsatz}/uhs/{nord}/kraefte/verfuegbar"),
        &admin,
        None,
    )
    .await;
    assert_eq!(frei[0]["id"], json!(ep), "{frei}");
    let etb = system_etb_inhalte(&app, &admin, einsatz).await;
    assert!(
        etb.iter()
            .any(|t| t == "«Clara (Sanitäter)» von UHS «Nord» abgezogen"),
        "{etb:?}"
    );

    // Nicht (mehr) an dieser UHS: 404.
    let (s, _) = anfrage(&app, "DELETE", &pfad, &admin, None).await;
    assert_eq!(s, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn adhoc_kraft_wird_disponiert_und_zugeordnet() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let nord = uhs_anlegen(&app, &admin, einsatz, "Nord").await;
    let pfad = format!("/api/einsaetze/{einsatz}/uhs/{nord}/kraefte");

    let (s, v) = anfrage_json(
        &app,
        "POST",
        &pfad,
        &admin,
        Some(&json!({"name": "  Dora  ", "funktion": "Notärztin", "staerke_position": "fuehrer"})),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
    assert_eq!(v["name"], "Dora");
    assert_eq!(v["ist_adhoc"], json!(true));
    let ep = v["id"].as_i64().unwrap();
    assert_eq!(
        personal(&app, &admin, einsatz, ep).await["uhs_id"],
        json!(nord)
    );
    assert_eq!(
        detail(&app, &admin, einsatz, nord).await["staerke"],
        staerke(1, 0, 0)
    );

    for body in [
        json!({"name": "  "}),
        json!({"name": "x".repeat(201)}),
        json!({"name": "Emil", "funktion": "y".repeat(201)}),
        json!({"name": "Emil", "staerke_position": "chef"}),
    ] {
        let (s, v) = anfrage_json(&app, "POST", &pfad, &admin, Some(&body)).await;
        assert_eq!(s, StatusCode::BAD_REQUEST, "{body} → {v}");
    }
}

#[tokio::test]
async fn aufloesen_und_stornieren_loesen_die_kraefte() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let nord = uhs_anlegen(&app, &admin, einsatz, "Nord").await;
    let a = kraft(&app, &admin, einsatz, "Anna", "mannschaft").await;
    let b = kraft(&app, &admin, einsatz, "Bernd", "mannschaft").await;
    for ep in [a, b] {
        assert_eq!(
            zuordnen(&app, &admin, einsatz, nord, ep).await,
            StatusCode::OK
        );
    }
    let (s, v) = anfrage_json(
        &app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/uhs/{nord}/status"),
        &admin,
        Some(&json!({"status": "aufgeloest"})),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert_eq!(v["staerke"], staerke(0, 0, 0), "{v}");
    for ep in [a, b] {
        assert!(personal(&app, &admin, einsatz, ep).await["uhs_id"].is_null());
    }
    let etb = system_etb_inhalte(&app, &admin, einsatz).await;
    assert!(
        etb.iter().any(|t| t == "2 Kräfte von UHS «Nord» abgezogen"),
        "{etb:?}"
    );
    // An einer aufgelösten UHS ändert sich nichts mehr (Lebenszyklus, 409).
    assert_eq!(
        zuordnen(&app, &admin, einsatz, nord, a).await,
        StatusCode::CONFLICT
    );

    // Storno einer geplanten UHS mit einer Kraft.
    let (s, v) = anfrage_json(
        &app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/uhs"),
        &admin,
        Some(&json!({"typ": "patientenablage", "bezeichnung": "Süd"})),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
    let sued = v["id"].as_i64().unwrap();
    assert_eq!(
        zuordnen(&app, &admin, einsatz, sued, a).await,
        StatusCode::OK
    );
    let (s, _) = anfrage(
        &app,
        "DELETE",
        &format!("/api/einsaetze/{einsatz}/uhs/{sued}"),
        &admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::NO_CONTENT);
    assert!(personal(&app, &admin, einsatz, a).await["uhs_id"].is_null());
    let etb = system_etb_inhalte(&app, &admin, einsatz).await;
    assert!(
        etb.iter().any(|t| t == "1 Kraft von UHS «Süd» abgezogen"),
        "{etb:?}"
    );
}

#[tokio::test]
async fn ganze_einheit_zuordnen_nimmt_nur_kraefte_ohne_uhs() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let nord = uhs_anlegen(&app, &admin, einsatz, "Nord").await;
    let sued = uhs_anlegen(&app, &admin, einsatz, "Süd").await;
    let seg = einheit_bilden(&app, &admin, einsatz, "SEG 1").await;
    let mut eps = Vec::new();
    for name in ["Anna", "Bernd", "Clara"] {
        let ep = kraft(&app, &admin, einsatz, name, "mannschaft").await;
        let (s, _) = anfrage(
            &app,
            "PUT",
            &format!("/api/einsaetze/{einsatz}/einheiten/{seg}/personal/{ep}"),
            &admin,
            None,
        )
        .await;
        assert_eq!(s, StatusCode::NO_CONTENT);
        eps.push(ep);
    }
    assert_eq!(
        zuordnen(&app, &admin, einsatz, sued, eps[0]).await,
        StatusCode::OK
    );
    let pfad = format!("/api/einsaetze/{einsatz}/uhs/{nord}/kraefte/einheit/{seg}");

    let (s, v) = anfrage(&app, "PUT", &pfad, &admin, None).await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert_eq!(v.as_array().unwrap().len(), 2, "{v}");
    assert_eq!(
        detail(&app, &admin, einsatz, nord).await["staerke"],
        staerke(0, 0, 2)
    );
    assert_eq!(
        detail(&app, &admin, einsatz, sued).await["staerke"],
        staerke(0, 0, 1)
    );
    let etb = system_etb_inhalte(&app, &admin, einsatz).await;
    assert!(
        etb.iter()
            .any(|t| t == "Einheit «SEG 1» mit 2 Kräften an UHS «Nord» eingesetzt"),
        "{etb:?}"
    );

    let (s, _) = anfrage(&app, "PUT", &pfad, &admin, None).await;
    assert_eq!(
        s,
        StatusCode::UNPROCESSABLE_ENTITY,
        "keine Kraft ohne UHS mehr"
    );
    let (s, _) = anfrage(
        &app,
        "PUT",
        &format!("/api/einsaetze/{einsatz}/uhs/{nord}/kraefte/einheit/999999"),
        &admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::NOT_FOUND);
}
