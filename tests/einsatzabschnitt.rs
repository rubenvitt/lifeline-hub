use axum::http::StatusCode;

mod common;
use common::{
    anfrage, benutzer_anlegen, einsatz_anlegen, login_cookie, rolle_setzen, setup,
    system_etb_anzahl,
};

async fn person_anlegen(app: &axum::Router, admin: &str, einsatz: i64, name: &str) -> i64 {
    // Stamm anlegen + in den Einsatz disponieren → liefert die einsatz_personal.id.
    let (s1, stamm) = anfrage(
        app,
        "POST",
        "/api/personal",
        admin,
        Some(&format!(r#"{{"name":"{name}"}}"#)),
    )
    .await;
    assert_eq!(s1, StatusCode::CREATED);
    let pid = stamm["id"].as_i64().unwrap();
    let (s2, dispo) = anfrage(
        app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/personal"),
        admin,
        Some(&format!(r#"{{"personal_id":{pid}}}"#)),
    )
    .await;
    assert_eq!(s2, StatusCode::CREATED);
    dispo["id"].as_i64().unwrap()
}

#[tokio::test]
async fn anlegen_schreibt_etb_und_liste_zeigt_abschnitt() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let (status, json) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/abschnitte"),
        &admin,
        Some(r#"{"name":"Nord"}"#),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    assert_eq!(json["name"], "Nord");
    assert_eq!(system_etb_anzahl(&app, &admin, einsatz).await, 1);

    let (_, liste) = anfrage(
        &app,
        "GET",
        &format!("/api/einsaetze/{einsatz}/abschnitte"),
        &admin,
        None,
    )
    .await;
    assert_eq!(liste.as_array().unwrap().len(), 1);
}

#[tokio::test]
async fn leiter_setzen_und_aufloesen() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let leiter = person_anlegen(&app, &admin, einsatz, "Leiter Nord").await;
    // Snapshot vor den Abschnitt-Aktionen (person_anlegen schreibt ebenfalls System-ETB).
    let etb_vorher = system_etb_anzahl(&app, &admin, einsatz).await;
    let (s, json) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/abschnitte"),
        &admin,
        Some(&format!(r#"{{"name":"Nord","leiter_id":{leiter}}}"#)),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED);
    assert_eq!(json["leiter_name"], "Leiter Nord");
    let aid = json["id"].as_i64().unwrap();

    assert_eq!(
        anfrage(
            &app,
            "DELETE",
            &format!("/api/einsaetze/{einsatz}/abschnitte/{aid}"),
            &admin,
            None
        )
        .await
        .0,
        StatusCode::NO_CONTENT
    );
    // angelegt + aufgelöst = 2 zusätzliche System-Einträge.
    assert_eq!(
        system_etb_anzahl(&app, &admin, einsatz).await,
        etb_vorher + 2
    );
}

#[tokio::test]
async fn beobachter_liest_aber_schreibt_nicht() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let erika = benutzer_anlegen(&app, &admin, "erika", "keine").await;
    rolle_setzen(&app, &admin, einsatz, erika, "beobachter").await;
    let erika_c = login_cookie(&app, "erika", "erikapw1").await;
    assert_eq!(
        anfrage(
            &app,
            "GET",
            &format!("/api/einsaetze/{einsatz}/abschnitte"),
            &erika_c,
            None
        )
        .await
        .0,
        StatusCode::OK
    );
    assert_eq!(
        anfrage(
            &app,
            "POST",
            &format!("/api/einsaetze/{einsatz}/abschnitte"),
            &erika_c,
            Some(r#"{"name":"X"}"#)
        )
        .await
        .0,
        StatusCode::FORBIDDEN
    );
}

#[tokio::test]
async fn abgeschlossener_einsatz_ist_409() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/abschliessen"),
        &admin,
        None,
    )
    .await;
    assert_eq!(
        anfrage(
            &app,
            "POST",
            &format!("/api/einsaetze/{einsatz}/abschnitte"),
            &admin,
            Some(r#"{"name":"X"}"#)
        )
        .await
        .0,
        StatusCode::CONFLICT
    );
}

#[tokio::test]
async fn fremde_org_kann_abschnitte_nicht_lesen_oder_schreiben() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    // Fremde Org B mit eigenem Admin (kein System-Admin auf Org A).
    // Bootstrap legt nur eine Org an; hier zweiten Nutzer OHNE Mitgliedschaft + ohne höhere Rolle.
    let fremd = benutzer_anlegen(&app, &admin, "fremd", "keine").await;
    let _ = fremd;
    let fremd_c = login_cookie(&app, "fremd", "fremdpw1").await;
    // Kein Mitglied, keine höhere Berechtigung → Forbidden bzw. NotFound.
    let status_get = anfrage(
        &app,
        "GET",
        &format!("/api/einsaetze/{einsatz}/abschnitte"),
        &fremd_c,
        None,
    )
    .await
    .0;
    assert!(matches!(
        status_get,
        StatusCode::FORBIDDEN | StatusCode::NOT_FOUND
    ));
    let status_post = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/abschnitte"),
        &fremd_c,
        Some(r#"{"name":"X"}"#),
    )
    .await
    .0;
    assert!(matches!(
        status_post,
        StatusCode::FORBIDDEN | StatusCode::NOT_FOUND
    ));
}

// ─────────────────────────────────────────────────────────────────────────────
// LFH-225/F23: Satzbasierte Sprechgruppen-Anreicherung der Abschnittsliste
//
// `GET /abschnitte` lädt die Sprechgruppen nicht mehr je Abschnitt einzeln nach.
// Zuordnung und Sortierung (`ORDER BY betriebsart, sortier, bezeichnung`) müssen
// dabei je Abschnitt exakt erhalten bleiben.
// ─────────────────────────────────────────────────────────────────────────────

async fn sprechgruppe_anlegen(
    app: &axum::Router,
    cookie: &str,
    bezeichnung: &str,
    betriebsart: &str,
    sortier: i64,
) -> i64 {
    let (s, json) = anfrage(
        app,
        "POST",
        "/api/sprechgruppen",
        cookie,
        Some(&format!(
            r#"{{"bezeichnung":"{bezeichnung}","betriebsart":"{betriebsart}","sortier":{sortier}}}"#
        )),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "Sprechgruppe {bezeichnung} anlegen");
    json["id"].as_i64().unwrap()
}

async fn abschnitt_anlegen(
    app: &axum::Router,
    cookie: &str,
    einsatz: i64,
    name: &str,
    sprechgruppen: &[i64],
) -> i64 {
    let ids = sprechgruppen
        .iter()
        .map(|i| i.to_string())
        .collect::<Vec<_>>()
        .join(",");
    let (s, json) = anfrage(
        app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/abschnitte"),
        cookie,
        Some(&format!(
            r#"{{"name":"{name}","sprechgruppe_ids":[{ids}]}}"#
        )),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "Abschnitt {name} anlegen");
    json["id"].as_i64().unwrap()
}

fn eintrag(liste: &serde_json::Value, id: i64) -> &serde_json::Value {
    liste
        .as_array()
        .unwrap()
        .iter()
        .find(|e| e["id"].as_i64() == Some(id))
        .unwrap_or_else(|| panic!("Abschnitt {id} fehlt in der Liste"))
}

fn bezeichnungen(werte: &serde_json::Value) -> Vec<String> {
    werte
        .as_array()
        .unwrap()
        .iter()
        .map(|e| e["bezeichnung"].as_str().unwrap().to_string())
        .collect()
}

/// Mehrere Abschnitte × mehrere Sprechgruppen in EINEM Listenabruf: jede
/// Sprechgruppe landet beim richtigen Abschnitt, sortiert nach
/// `betriebsart, sortier, bezeichnung`.
#[tokio::test]
async fn liste_ordnet_sprechgruppen_je_abschnitt_sortiert_zu() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;

    // Alle drei Sortierschlüssel diskriminierend belegt: DMO vor TMO, dann
    // sortier, bei Gleichstand die Bezeichnung.
    let tmo5 = sprechgruppe_anlegen(&app, &admin, "410_F_DRK", "TMO", 5).await;
    let dmo9_b = sprechgruppe_anlegen(&app, &admin, "112_D_LEIT", "DMO", 9).await;
    let tmo1 = sprechgruppe_anlegen(&app, &admin, "999_T_ZUG", "TMO", 1).await;
    let dmo9_a = sprechgruppe_anlegen(&app, &admin, "111_D_ALPHA", "DMO", 9).await;

    // Zuweisung bewusst in „falscher" Reihenfolge.
    let nord =
        abschnitt_anlegen(&app, &admin, einsatz, "Nord", &[tmo5, dmo9_b, tmo1, dmo9_a]).await;
    let sued = abschnitt_anlegen(&app, &admin, einsatz, "Süd", &[tmo5, dmo9_a]).await;
    let ost = abschnitt_anlegen(&app, &admin, einsatz, "Ost", &[tmo1]).await;
    let west = abschnitt_anlegen(&app, &admin, einsatz, "West", &[]).await;

    let (status, liste) = anfrage(
        &app,
        "GET",
        &format!("/api/einsaetze/{einsatz}/abschnitte"),
        &admin,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(liste.as_array().unwrap().len(), 4);

    assert_eq!(
        bezeichnungen(&eintrag(&liste, nord)["sprechgruppen"]),
        vec!["111_D_ALPHA", "112_D_LEIT", "999_T_ZUG", "410_F_DRK"],
        "DMO vor TMO; dann sortier; bei Gleichstand die Bezeichnung"
    );
    assert_eq!(
        bezeichnungen(&eintrag(&liste, sued)["sprechgruppen"]),
        vec!["111_D_ALPHA", "410_F_DRK"]
    );
    assert_eq!(
        bezeichnungen(&eintrag(&liste, ost)["sprechgruppen"]),
        vec!["999_T_ZUG"]
    );
    assert!(
        eintrag(&liste, west)["sprechgruppen"]
            .as_array()
            .unwrap()
            .is_empty(),
        "Abschnitt ohne Zuordnung bleibt leer"
    );
}

/// Ein Einsatz ohne Abschnitte liefert eine leere Liste (Randfall der Aggregation).
#[tokio::test]
async fn liste_ohne_abschnitte_ist_leer() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let (status, liste) = anfrage(
        &app,
        "GET",
        &format!("/api/einsaetze/{einsatz}/abschnitte"),
        &admin,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert!(liste.as_array().unwrap().is_empty());
}
