//! Personenauswahl ohne Freitexte (LFH-940, Spec `listen-projektion`).

use axum::http::StatusCode;

mod common;
use common::{
    anfrage, benutzer_anlegen, einsatz_anlegen, login_cookie, person_anlegen, rolle_setzen, setup,
    setup_mit_pool,
};

#[tokio::test]
async fn auswahl_ohne_freitexte_und_ohne_stornierte() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let erste = person_anlegen(
        &app,
        &admin,
        e,
        r#"{"name":"Muster","vorname":"Erika","notiz":"Diabetikerin","melder_kontakt":"0171 1234",
            "herkunft_adresse":"Hauptstraße 3","antreff_ort":"Turnhalle","zustand":"unterkühlt"}"#,
    )
    .await;
    let zweite = person_anlegen(&app, &admin, e, r#"{"name":"Beispiel"}"#).await;
    let storniert = person_anlegen(&app, &admin, e, r#"{"name":"Weg"}"#).await;
    let (s, v) = anfrage(
        &app,
        "DELETE",
        &format!("/api/einsaetze/{e}/personen/{storniert}"),
        &admin,
        None,
    )
    .await;
    assert!(s.is_success(), "stornieren: {s} {v}");

    let (s, v) = anfrage(
        &app,
        "GET",
        &format!("/api/einsaetze/{e}/personen/auswahl"),
        &admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    let zeilen = v.as_array().unwrap();
    let ids: Vec<i64> = zeilen.iter().map(|z| z["id"].as_i64().unwrap()).collect();
    assert_eq!(
        ids,
        [erste, zweite],
        "nach Registriernummer, ohne Stornierte"
    );
    let mut felder: Vec<&str> = zeilen[0]
        .as_object()
        .unwrap()
        .keys()
        .map(String::as_str)
        .collect();
    felder.sort_unstable();
    assert_eq!(felder, ["id", "name", "registrier_nr", "status", "vorname"]);
    assert_eq!(zeilen[0]["vorname"], "Erika");
    let text = v.to_string();
    for frei in [
        "Diabetikerin",
        "0171",
        "Hauptstraße",
        "Turnhalle",
        "unterkühlt",
    ] {
        assert!(!text.contains(frei), "kein Freitext „{frei}“: {text}");
    }

    let protokoll: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM person_zugriff_audit WHERE einsatz_id = ?")
            .bind(e)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(protokoll, 0, "die Auswahl schreibt kein Zugriffsprotokoll");
}

/// Spec `listen-projektion`, „Ohne Modulrecht“: dieselbe Sperre wie die Personenliste.
#[tokio::test]
async fn auswahl_hinter_dem_modulrecht() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let gid = benutzer_anlegen(&app, &admin, "gustav", "fuehrungskraft").await;
    rolle_setzen(&app, &admin, e, gid, "fuehrungspersonal").await;
    let gustav = login_cookie(&app, "gustav", "gustavpw1").await;
    let auswahl = format!("/api/einsaetze/{e}/personen/auswahl");
    let (s, _) = anfrage(&app, "GET", &auswahl, &gustav, None).await;
    assert_eq!(s, StatusCode::OK, "Vorbedingung: sichtbar liest er");
    let (s, v) = anfrage(
        &app,
        "PUT",
        &format!("/api/einsaetze/{e}/modul-overrides/personen"),
        &admin,
        Some(r#"{"sichtbar":false,"benoetigte_rolle":null}"#),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "Override: {v}");
    let (s_liste, _) = anfrage(
        &app,
        "GET",
        &format!("/api/einsaetze/{e}/personen"),
        &gustav,
        None,
    )
    .await;
    let (s_auswahl, _) = anfrage(&app, "GET", &auswahl, &gustav, None).await;
    assert_eq!(
        s_liste,
        StatusCode::FORBIDDEN,
        "Vorbedingung: Liste gesperrt"
    );
    assert_eq!(s_auswahl, StatusCode::FORBIDDEN);
}
