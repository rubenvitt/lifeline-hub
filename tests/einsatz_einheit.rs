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

async fn einheit_bilden(app: &axum::Router, cookie: &str, einsatz: i64, name: &str) -> i64 {
    let (s, json) = anfrage(
        app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/einheiten"),
        cookie,
        Some(&format!(r#"{{"name":"{name}"}}"#)),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED);
    json["id"].as_i64().unwrap()
}

#[tokio::test]
async fn bilden_schreibt_etb_und_liefert_nullstaerke() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let (s, json) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/einheiten"),
        &admin,
        Some(r#"{"name":"1. Zug"}"#),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED);
    assert_eq!(json["name"], "1. Zug");
    assert_eq!(json["ist"]["mannschaft"], 0);
    assert!(json["soll"].is_null());
    assert_eq!(system_etb_anzahl(&app, &admin, einsatz).await, 1);
}

#[tokio::test]
async fn mitglied_zuordnen_wechseln_freigeben_mit_etb() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let a = einheit_bilden(&app, &admin, einsatz, "A").await;
    let b = einheit_bilden(&app, &admin, einsatz, "B").await;
    let ep = person_anlegen(&app, &admin, einsatz, "Anna").await; // disponiert ins Personal

    assert_eq!(
        anfrage(
            &app,
            "PUT",
            &format!("/api/einsaetze/{einsatz}/einheiten/{a}/personal/{ep}"),
            &admin,
            None
        )
        .await
        .0,
        StatusCode::NO_CONTENT
    );
    // In A sichtbar.
    let (_, liste) = anfrage(
        &app,
        "GET",
        &format!("/api/einsaetze/{einsatz}/einheiten"),
        &admin,
        None,
    )
    .await;
    let einheit_a = liste
        .as_array()
        .unwrap()
        .iter()
        .find(|e| e["id"] == a)
        .unwrap();
    assert_eq!(
        einheit_a["personal_mitglieder"].as_array().unwrap().len(),
        1
    );

    // Wechsel zu B → A verliert sie.
    anfrage(
        &app,
        "PUT",
        &format!("/api/einsaetze/{einsatz}/einheiten/{b}/personal/{ep}"),
        &admin,
        None,
    )
    .await;
    let (_, liste2) = anfrage(
        &app,
        "GET",
        &format!("/api/einsaetze/{einsatz}/einheiten"),
        &admin,
        None,
    )
    .await;
    let einheit_a2 = liste2
        .as_array()
        .unwrap()
        .iter()
        .find(|e| e["id"] == a)
        .unwrap();
    assert!(einheit_a2["personal_mitglieder"]
        .as_array()
        .unwrap()
        .is_empty());

    // Freigeben.
    assert_eq!(
        anfrage(
            &app,
            "DELETE",
            &format!("/api/einsaetze/{einsatz}/einheiten/{b}/personal/{ep}"),
            &admin,
            None
        )
        .await
        .0,
        StatusCode::NO_CONTENT
    );
}

#[tokio::test]
async fn freier_pool_zeigt_einheit_id_null() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let a = einheit_bilden(&app, &admin, einsatz, "A").await;
    let ep = person_anlegen(&app, &admin, einsatz, "Anna").await;
    // Vor Zuordnung: einheit_id null im Personal.
    let (_, personal) = anfrage(
        &app,
        "GET",
        &format!("/api/einsaetze/{einsatz}/personal"),
        &admin,
        None,
    )
    .await;
    assert!(personal
        .as_array()
        .unwrap()
        .iter()
        .find(|p| p["id"] == ep)
        .unwrap()["einheit_id"]
        .is_null());
    // Nach Zuordnung: einheit_id gesetzt.
    anfrage(
        &app,
        "PUT",
        &format!("/api/einsaetze/{einsatz}/einheiten/{a}/personal/{ep}"),
        &admin,
        None,
    )
    .await;
    let (_, personal2) = anfrage(
        &app,
        "GET",
        &format!("/api/einsaetze/{einsatz}/personal"),
        &admin,
        None,
    )
    .await;
    assert_eq!(
        personal2
            .as_array()
            .unwrap()
            .iter()
            .find(|p| p["id"] == ep)
            .unwrap()["einheit_id"],
        a
    );
}

#[tokio::test]
async fn fuehrer_nur_mitglied_dieser_einheit() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let a = einheit_bilden(&app, &admin, einsatz, "A").await;
    let ep = person_anlegen(&app, &admin, einsatz, "Chef").await;
    // Nicht-Mitglied als Führer bei gleichzeitigem Namens-Edit → 400 UND kein Teil-Update.
    let body_umbenennen = format!(r#"{{"name":"A-NEU","fuehrer_id":{ep}}}"#);
    assert_eq!(
        anfrage(
            &app,
            "PATCH",
            &format!("/api/einsaetze/{einsatz}/einheiten/{a}"),
            &admin,
            Some(&body_umbenennen)
        )
        .await
        .0,
        StatusCode::BAD_REQUEST
    );
    // Name darf NICHT geändert worden sein (Führer-Prüfung läuft vor jedem Write).
    let (_, liste) = anfrage(
        &app,
        "GET",
        &format!("/api/einsaetze/{einsatz}/einheiten"),
        &admin,
        None,
    )
    .await;
    assert_eq!(
        liste
            .as_array()
            .unwrap()
            .iter()
            .find(|e| e["id"] == a)
            .unwrap()["name"],
        "A"
    );
    // Nach Zuordnung erlaubt.
    anfrage(
        &app,
        "PUT",
        &format!("/api/einsaetze/{einsatz}/einheiten/{a}/personal/{ep}"),
        &admin,
        None,
    )
    .await;
    let (s, json) = anfrage(
        &app,
        "PATCH",
        &format!("/api/einsaetze/{einsatz}/einheiten/{a}"),
        &admin,
        Some(&body_umbenennen),
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(json["fuehrer_id"], ep);
    assert_eq!(json["name"], "A-NEU");
}

#[tokio::test]
async fn aufloesen_gibt_mitglieder_frei() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let a = einheit_bilden(&app, &admin, einsatz, "A").await;
    let ep = person_anlegen(&app, &admin, einsatz, "Anna").await;
    anfrage(
        &app,
        "PUT",
        &format!("/api/einsaetze/{einsatz}/einheiten/{a}/personal/{ep}"),
        &admin,
        None,
    )
    .await;
    assert_eq!(
        anfrage(
            &app,
            "DELETE",
            &format!("/api/einsaetze/{einsatz}/einheiten/{a}"),
            &admin,
            None
        )
        .await
        .0,
        StatusCode::NO_CONTENT
    );
    // Person wieder frei.
    let (_, personal) = anfrage(
        &app,
        "GET",
        &format!("/api/einsaetze/{einsatz}/personal"),
        &admin,
        None,
    )
    .await;
    assert!(personal
        .as_array()
        .unwrap()
        .iter()
        .find(|p| p["id"] == ep)
        .unwrap()["einheit_id"]
        .is_null());
}

#[tokio::test]
async fn beobachter_darf_nicht_bilden() {
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
            &format!("/api/einsaetze/{einsatz}/einheiten"),
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
            &format!("/api/einsaetze/{einsatz}/einheiten"),
            &erika_c,
            Some(r#"{"name":"X"}"#)
        )
        .await
        .0,
        StatusCode::FORBIDDEN
    );
}

#[tokio::test]
async fn fremder_nutzer_ohne_mitgliedschaft_kann_einheiten_nicht_lesen_oder_bilden() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    // Nutzer ohne Mitgliedschaft und ohne höhere Berechtigung anlegen.
    let _fremd = benutzer_anlegen(&app, &admin, "fremd", "keine").await;
    let fremd_c = login_cookie(&app, "fremd", "fremdpw1").await;
    // Kein Mitglied, keine höhere Berechtigung → Forbidden bzw. NotFound.
    let status_get = anfrage(
        &app,
        "GET",
        &format!("/api/einsaetze/{einsatz}/einheiten"),
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
        &format!("/api/einsaetze/{einsatz}/einheiten"),
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

#[tokio::test]
async fn bilden_auf_abgeschlossenem_einsatz_ist_409() {
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
            &format!("/api/einsaetze/{einsatz}/einheiten"),
            &admin,
            Some(r#"{"name":"X"}"#)
        )
        .await
        .0,
        StatusCode::CONFLICT
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// LFH-225/F23: Satzbasierte Anreicherung der Kräfte-Liste
//
// `GET /einheiten` reichert Mitglieder, Stärke und Sprechgruppen nicht mehr je
// Einheit einzeln nach, sondern satzweise über den ganzen Einsatz. Die folgenden
// Tests pinnen die Antwort inhaltlich UND in der Reihenfolge fest — die
// Sortierung je Gruppe war vorher implizit durch die Einzelabfragen garantiert.
// ─────────────────────────────────────────────────────────────────────────────

/// Ad-hoc-Kraft mit Stärke-Position direkt in den Einsatz disponieren.
async fn kraft_anlegen(
    app: &axum::Router,
    cookie: &str,
    einsatz: i64,
    name: &str,
    position: &str,
) -> i64 {
    let (s, json) = anfrage(
        app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/personal"),
        cookie,
        Some(&format!(
            r#"{{"adhoc":{{"name":"{name}","staerke_position":"{position}"}}}}"#
        )),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "Kraft {name} anlegen");
    json["id"].as_i64().unwrap()
}

async fn fahrzeug_anlegen(
    app: &axum::Router,
    cookie: &str,
    einsatz: i64,
    funkrufname: &str,
) -> i64 {
    let (s, json) = anfrage(
        app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/fahrzeuge"),
        cookie,
        Some(&format!(r#"{{"adhoc":{{"funkrufname":"{funkrufname}"}}}}"#)),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "Fahrzeug {funkrufname} anlegen");
    json["id"].as_i64().unwrap()
}

async fn material_anlegen(
    app: &axum::Router,
    cookie: &str,
    einsatz: i64,
    bezeichnung: &str,
) -> i64 {
    let (s, json) = anfrage(
        app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/material"),
        cookie,
        Some(&format!(
            r#"{{"adhoc":{{"bezeichnung":"{bezeichnung}"}},"menge":3}}"#
        )),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "Material {bezeichnung} anlegen");
    json["id"].as_i64().unwrap()
}

/// Katalog-Sprechgruppe anlegen; liefert die id.
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

/// Einheit mit optionalem Vater und Sprechgruppen bilden. Die Sprechgruppen werden
/// direkt beim Bilden gesetzt. (Seit LFH-306 wäre ein nachgelagertes PATCH ungefährlich —
/// es fasste `ueber_einheit_id` nicht mehr an —, der Aufbau bleibt trotzdem so, weil er
/// den Testaufbau in einem Request hält.)
async fn einheit_unter(
    app: &axum::Router,
    cookie: &str,
    einsatz: i64,
    name: &str,
    vater: Option<i64>,
    sprechgruppen: &[i64],
) -> i64 {
    let sg = sprechgruppen
        .iter()
        .map(|i| i.to_string())
        .collect::<Vec<_>>()
        .join(",");
    let rumpf = match vater {
        Some(v) => {
            format!(r#"{{"name":"{name}","ueber_einheit_id":{v},"sprechgruppe_ids":[{sg}]}}"#)
        }
        None => format!(r#"{{"name":"{name}","sprechgruppe_ids":[{sg}]}}"#),
    };
    let (s, json) = anfrage(
        app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/einheiten"),
        cookie,
        Some(&rumpf),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "Einheit {name} bilden");
    json["id"].as_i64().unwrap()
}

async fn personal_zuordnen(app: &axum::Router, cookie: &str, einsatz: i64, einheit: i64, ep: i64) {
    let (s, _) = anfrage(
        app,
        "PUT",
        &format!("/api/einsaetze/{einsatz}/einheiten/{einheit}/personal/{ep}"),
        cookie,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::NO_CONTENT);
}

async fn fahrzeug_zuordnen(app: &axum::Router, cookie: &str, einsatz: i64, einheit: i64, ef: i64) {
    let (s, _) = anfrage(
        app,
        "PUT",
        &format!("/api/einsaetze/{einsatz}/einheiten/{einheit}/fahrzeug/{ef}"),
        cookie,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::NO_CONTENT);
}

/// Liefert den Listeneintrag zur Einheit-id.
fn eintrag(liste: &serde_json::Value, id: i64) -> &serde_json::Value {
    liste
        .as_array()
        .unwrap()
        .iter()
        .find(|e| e["id"].as_i64() == Some(id))
        .unwrap_or_else(|| panic!("Einheit {id} fehlt in der Liste"))
}

fn namen(werte: &serde_json::Value, feld: &str) -> Vec<String> {
    werte
        .as_array()
        .unwrap()
        .iter()
        .map(|e| e[feld].as_str().unwrap().to_string())
        .collect()
}

fn staerke(e: &serde_json::Value, feld: &str) -> (i64, i64, i64) {
    (
        e[feld]["fuehrer"].as_i64().unwrap(),
        e[feld]["unterfuehrer"].as_i64().unwrap(),
        e[feld]["mannschaft"].as_i64().unwrap(),
    )
}

/// Mehrstufige Gliederung (3 Ebenen, 10 Einheiten, gemischt besetzt) über EINEN
/// Listenabruf: Mitglieder, eigene und kumulierte Stärke sowie Sprechgruppen müssen
/// je Einheit vollständig, korrekt zugeordnet und in stabiler Reihenfolge stehen.
#[tokio::test]
async fn liste_gliederung_mitglieder_staerke_und_sprechgruppen_je_einheit() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;

    // ── Sprechgruppen: alle drei Sortierschlüssel diskriminierend belegt ─────
    // ORDER BY betriebsart, sortier, bezeichnung ⇒ DMO vor TMO; bei gleicher
    // Betriebsart entscheidet sortier, bei Gleichstand die Bezeichnung.
    let sg_tmo5 = sprechgruppe_anlegen(&app, &admin, "410_F_DRK", "TMO", 5).await;
    let sg_dmo9_b = sprechgruppe_anlegen(&app, &admin, "112_D_LEIT", "DMO", 9).await;
    let sg_tmo1 = sprechgruppe_anlegen(&app, &admin, "999_T_ZUG", "TMO", 1).await;
    let sg_dmo9_a = sprechgruppe_anlegen(&app, &admin, "111_D_ALPHA", "DMO", 9).await;

    // ── Gliederung: 3 Ebenen, zwei Züge, dazu Wurzeln ohne Kinder ───────────
    // Sprechgruppen werden bewusst in „falscher" Reihenfolge zugewiesen.
    let stab = einheit_unter(&app, &admin, einsatz, "Stab", None, &[]).await;
    let zug1 = einheit_unter(
        &app,
        &admin,
        einsatz,
        "1. Zug",
        None,
        &[sg_tmo5, sg_dmo9_b, sg_tmo1, sg_dmo9_a],
    )
    .await;
    let gruppe11 = einheit_unter(
        &app,
        &admin,
        einsatz,
        "1./1. Gruppe",
        Some(zug1),
        &[sg_tmo1],
    )
    .await;
    let gruppe12 = einheit_unter(&app, &admin, einsatz, "2./1. Gruppe", Some(zug1), &[]).await;
    let trupp111 = einheit_unter(&app, &admin, einsatz, "1. Trupp", Some(gruppe11), &[]).await;
    let trupp112 = einheit_unter(&app, &admin, einsatz, "2. Trupp", Some(gruppe11), &[]).await;
    let zug2 = einheit_unter(&app, &admin, einsatz, "2. Zug", None, &[]).await;
    let gruppe21 = einheit_unter(&app, &admin, einsatz, "1./2. Gruppe", Some(zug2), &[]).await;
    let reserve = einheit_unter(&app, &admin, einsatz, "Reserve", None, &[]).await;
    let verpflegung = einheit_unter(&app, &admin, einsatz, "Verpflegung", None, &[]).await;

    // ── Kräfte ──────────────────────────────────────────────────────────────
    let stab_f = kraft_anlegen(&app, &admin, einsatz, "Stab Führer", "fuehrer").await;
    personal_zuordnen(&app, &admin, einsatz, stab, stab_f).await;

    let zug1_f = kraft_anlegen(&app, &admin, einsatz, "Zugführer 1", "fuehrer").await;
    personal_zuordnen(&app, &admin, einsatz, zug1, zug1_f).await;

    // Reihenfolge der Zuordnung bewusst NICHT id-aufsteigend — die Antwort muss
    // trotzdem nach einsatz_personal.id sortiert sein.
    let g11_uf = kraft_anlegen(&app, &admin, einsatz, "Gruppenführer 1.1", "unterfuehrer").await;
    let g11_m1 = kraft_anlegen(&app, &admin, einsatz, "Mann 1.1a", "mannschaft").await;
    let g11_m2 = kraft_anlegen(&app, &admin, einsatz, "Mann 1.1b", "mannschaft").await;
    for ep in [g11_m2, g11_uf, g11_m1] {
        personal_zuordnen(&app, &admin, einsatz, gruppe11, ep).await;
    }

    let g12_uf = kraft_anlegen(&app, &admin, einsatz, "Gruppenführer 1.2", "unterfuehrer").await;
    let g12_m1 = kraft_anlegen(&app, &admin, einsatz, "Mann 1.2a", "mannschaft").await;
    for ep in [g12_uf, g12_m1] {
        personal_zuordnen(&app, &admin, einsatz, gruppe12, ep).await;
    }

    let t111_m1 = kraft_anlegen(&app, &admin, einsatz, "Trupp 1.1.1a", "mannschaft").await;
    let t111_m2 = kraft_anlegen(&app, &admin, einsatz, "Trupp 1.1.1b", "mannschaft").await;
    for ep in [t111_m1, t111_m2] {
        personal_zuordnen(&app, &admin, einsatz, trupp111, ep).await;
    }

    let g21_m1 = kraft_anlegen(&app, &admin, einsatz, "Mann 2.1a", "mannschaft").await;
    personal_zuordnen(&app, &admin, einsatz, gruppe21, g21_m1).await;

    // Kraft ohne Stärke-Position — Mitglied, zählt aber nicht in die Stärke.
    let (s_ohne, ohne_json) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/personal"),
        &admin,
        Some(r#"{"adhoc":{"name":"Ohne Position"}}"#),
    )
    .await;
    assert_eq!(s_ohne, StatusCode::CREATED);
    let ohne_pos = ohne_json["id"].as_i64().unwrap();
    personal_zuordnen(&app, &admin, einsatz, gruppe12, ohne_pos).await;

    // ── Fahrzeuge / Material ────────────────────────────────────────────────
    let fz_a = fahrzeug_anlegen(&app, &admin, einsatz, "Florian 1").await;
    let fz_b = fahrzeug_anlegen(&app, &admin, einsatz, "Florian 2").await;
    // wieder verdrehte Zuordnungsreihenfolge
    for ef in [fz_b, fz_a] {
        let (s, _) = anfrage(
            &app,
            "PUT",
            &format!("/api/einsaetze/{einsatz}/einheiten/{gruppe11}/fahrzeug/{ef}"),
            &admin,
            None,
        )
        .await;
        assert_eq!(s, StatusCode::NO_CONTENT);
    }
    let mat_a = material_anlegen(&app, &admin, einsatz, "Wolldecke").await;
    let mat_b = material_anlegen(&app, &admin, einsatz, "Absperrband").await;
    for em in [mat_b, mat_a] {
        let (s, _) = anfrage(
            &app,
            "PUT",
            &format!("/api/einsaetze/{einsatz}/einheiten/{verpflegung}/material/{em}"),
            &admin,
            None,
        )
        .await;
        assert_eq!(s, StatusCode::NO_CONTENT);
    }

    // ── EIN Listenabruf, dann Feld für Feld prüfen ──────────────────────────
    let (status, liste) = anfrage(
        &app,
        "GET",
        &format!("/api/einsaetze/{einsatz}/einheiten"),
        &admin,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(liste.as_array().unwrap().len(), 10, "10 Einheiten");

    // Eigene Stärke je Einheit.
    assert_eq!(staerke(eintrag(&liste, stab), "ist"), (1, 0, 0));
    assert_eq!(staerke(eintrag(&liste, zug1), "ist"), (1, 0, 0));
    assert_eq!(staerke(eintrag(&liste, gruppe11), "ist"), (0, 1, 2));
    // „Ohne Position" ist Mitglied, zählt aber nicht mit.
    assert_eq!(staerke(eintrag(&liste, gruppe12), "ist"), (0, 1, 1));
    assert_eq!(staerke(eintrag(&liste, trupp111), "ist"), (0, 0, 2));
    assert_eq!(staerke(eintrag(&liste, trupp112), "ist"), (0, 0, 0));
    assert_eq!(staerke(eintrag(&liste, zug2), "ist"), (0, 0, 0));
    assert_eq!(staerke(eintrag(&liste, gruppe21), "ist"), (0, 0, 1));
    assert_eq!(staerke(eintrag(&liste, reserve), "ist"), (0, 0, 0));
    assert_eq!(staerke(eintrag(&liste, verpflegung), "ist"), (0, 0, 0));

    // Kumulierte Stärke über die Unterstellung.
    assert_eq!(staerke(eintrag(&liste, stab), "ist_kumuliert"), (1, 0, 0));
    // 1. Zug: eigen 1/0/0 + G1.1 0/1/2 + T1.1.1 0/0/2 + T1.1.2 0/0/0 + G1.2 0/1/1
    assert_eq!(staerke(eintrag(&liste, zug1), "ist_kumuliert"), (1, 2, 5));
    assert_eq!(
        staerke(eintrag(&liste, gruppe11), "ist_kumuliert"),
        (0, 1, 4)
    );
    assert_eq!(
        staerke(eintrag(&liste, gruppe12), "ist_kumuliert"),
        (0, 1, 1)
    );
    assert_eq!(
        staerke(eintrag(&liste, trupp111), "ist_kumuliert"),
        (0, 0, 2)
    );
    assert_eq!(
        staerke(eintrag(&liste, trupp112), "ist_kumuliert"),
        (0, 0, 0)
    );
    assert_eq!(staerke(eintrag(&liste, zug2), "ist_kumuliert"), (0, 0, 1));
    assert_eq!(
        staerke(eintrag(&liste, gruppe21), "ist_kumuliert"),
        (0, 0, 1)
    );
    assert_eq!(
        staerke(eintrag(&liste, reserve), "ist_kumuliert"),
        (0, 0, 0)
    );

    // Personal-Mitglieder: Zuordnung + Reihenfolge (nach einsatz_personal.id).
    let g11 = eintrag(&liste, gruppe11);
    assert_eq!(
        namen(&g11["personal_mitglieder"], "name"),
        vec!["Gruppenführer 1.1", "Mann 1.1a", "Mann 1.1b"],
        "Personal je Einheit nach id sortiert, nicht nach Zuordnungsreihenfolge"
    );
    assert_eq!(
        g11["personal_mitglieder"]
            .as_array()
            .unwrap()
            .iter()
            .map(|m| m["ep_id"].as_i64().unwrap())
            .collect::<Vec<_>>(),
        vec![g11_uf, g11_m1, g11_m2]
    );
    assert_eq!(
        namen(&eintrag(&liste, gruppe12)["personal_mitglieder"], "name"),
        vec!["Gruppenführer 1.2", "Mann 1.2a", "Ohne Position"]
    );
    assert_eq!(
        namen(&eintrag(&liste, trupp111)["personal_mitglieder"], "name"),
        vec!["Trupp 1.1.1a", "Trupp 1.1.1b"]
    );
    // Einheiten ohne Mitglieder: leere Listen, kein Fremdmitglied.
    for leer in [trupp112, zug2, reserve] {
        let e = eintrag(&liste, leer);
        assert!(
            e["personal_mitglieder"].as_array().unwrap().is_empty(),
            "Einheit {leer} darf kein Personal tragen"
        );
        assert!(e["fahrzeug_mitglieder"].as_array().unwrap().is_empty());
        assert!(e["material_mitglieder"].as_array().unwrap().is_empty());
        assert!(e["sprechgruppen"].as_array().unwrap().is_empty());
    }

    // Fahrzeuge / Material: Zuordnung + Reihenfolge (nach Dispozeilen-id).
    assert_eq!(
        namen(&g11["fahrzeug_mitglieder"], "funkrufname"),
        vec!["Florian 1", "Florian 2"],
        "Fahrzeuge nach id, nicht nach Zuordnungsreihenfolge"
    );
    assert_eq!(
        eintrag(&liste, verpflegung)["material_mitglieder"]
            .as_array()
            .unwrap()
            .iter()
            .map(|m| m["em_id"].as_i64().unwrap())
            .collect::<Vec<_>>(),
        vec![mat_a, mat_b],
        "Material nach id"
    );
    assert_eq!(
        namen(
            &eintrag(&liste, verpflegung)["material_mitglieder"],
            "bezeichnung"
        ),
        vec!["Wolldecke", "Absperrband"]
    );

    // Sprechgruppen: ORDER BY betriebsart, sortier, bezeichnung.
    assert_eq!(
        namen(&eintrag(&liste, zug1)["sprechgruppen"], "bezeichnung"),
        vec!["111_D_ALPHA", "112_D_LEIT", "999_T_ZUG", "410_F_DRK"],
        "DMO vor TMO; dann sortier; bei Gleichstand die Bezeichnung"
    );
    assert_eq!(
        namen(&g11["sprechgruppen"], "bezeichnung"),
        vec!["999_T_ZUG"],
        "Sprechgruppen dürfen nicht zwischen Einheiten verrutschen"
    );
}

/// Ein Einsatz ohne Einheiten liefert eine leere Liste (kein Fehler) — der
/// Randfall der Satz-Aggregation über HTTP.
#[tokio::test]
async fn liste_ohne_einheiten_ist_leer() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let (status, liste) = anfrage(
        &app,
        "GET",
        &format!("/api/einsaetze/{einsatz}/einheiten"),
        &admin,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert!(liste.as_array().unwrap().is_empty());
}

/// Zwei parallele Einsätze: pinnt, dass die Anreicherung aus LFH-225/F23 keine Kräfte,
/// Fahrzeuge oder Sprechgruppen eines fremden Einsatzes in die Liste zieht.
///
/// Wo die Isolation WIRKLICH herkommt (nachgemessen, nicht vermutet): nicht aus dem
/// Einsatz-Filter der Sammelabfragen, sondern aus der Schlüssel-Bindung beim Konsum.
/// `zu_anzeige_batch` liest die Maps ausschließlich per `remove(&row.id)`, und `row.id`
/// stammt aus einer bereits einsatz-gefilterten Abfrage; `einsatz_einheit.id` ist ein
/// global eindeutiger PK. Fremde Zeilen lägen also unter ihrem eigenen Schlüssel und
/// würden nie gelesen. Gegenprobe: weicht man den Einsatz-Filter in
/// `personal_mitglieder_map` auf, bleibt dieser Test grün — er ist gegen genau diese
/// Mutation blind.
///
/// Er hält trotzdem etwas fest, das kein anderer Test abdeckt: sobald die Anreicherung
/// künftig iteriert statt per Schlüssel entnommen wird (naheliegender Refactor, etwa um
/// die `remove`-Annahme „jede Einheit genau einmal" loszuwerden), wird der Einsatz-Filter
/// schlagartig sicherheitsrelevant — und dann schlägt dieser Test an.
#[tokio::test]
async fn liste_mischt_keine_kraefte_aus_einem_zweiten_einsatz() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let sg_a = sprechgruppe_anlegen(&app, &admin, "100_T_LAGE_A", "TMO", 1).await;
    let sg_b = sprechgruppe_anlegen(&app, &admin, "200_T_LAGE_B", "TMO", 2).await;

    // Einsatz A: eine Einheit mit je einer Kraft, einem Fahrzeug und einer Sprechgruppe.
    let a = einsatz_anlegen(&app, &admin).await;
    let einheit_a = einheit_unter(&app, &admin, a, "Zug A", None, &[sg_a]).await;
    let kraft_a = kraft_anlegen(&app, &admin, a, "Anton", "fuehrer").await;
    personal_zuordnen(&app, &admin, a, einheit_a, kraft_a).await;
    let fz_a = fahrzeug_anlegen(&app, &admin, a, "Florian A").await;
    fahrzeug_zuordnen(&app, &admin, a, einheit_a, fz_a).await;

    // Einsatz B: eigene Einheit, eigene Kräfte — darf in A nirgends auftauchen.
    let b = einsatz_anlegen(&app, &admin).await;
    let einheit_b = einheit_unter(&app, &admin, b, "Zug B", None, &[sg_b]).await;
    for name in ["Berta", "Bruno", "Bernd"] {
        let k = kraft_anlegen(&app, &admin, b, name, "mannschaft").await;
        personal_zuordnen(&app, &admin, b, einheit_b, k).await;
    }
    let fz_b = fahrzeug_anlegen(&app, &admin, b, "Florian B").await;
    fahrzeug_zuordnen(&app, &admin, b, einheit_b, fz_b).await;

    let (status, liste) = anfrage(
        &app,
        "GET",
        &format!("/api/einsaetze/{a}/einheiten"),
        &admin,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        liste.as_array().unwrap().len(),
        1,
        "Einsatz A hat genau eine Einheit"
    );

    let e = eintrag(&liste, einheit_a);
    assert_eq!(
        namen(&e["personal_mitglieder"], "name"),
        vec!["Anton"],
        "nur die Kraft aus Einsatz A"
    );
    assert_eq!(
        namen(&e["fahrzeug_mitglieder"], "funkrufname"),
        vec!["Florian A"],
        "nur das Fahrzeug aus Einsatz A"
    );
    assert_eq!(
        namen(&e["sprechgruppen"], "bezeichnung"),
        vec!["100_T_LAGE_A"],
        "nur die Sprechgruppe aus Einsatz A"
    );
    assert_eq!(
        staerke(e, "ist"),
        (1, 0, 0),
        "die drei Mannschafter aus Einsatz B dürfen die Stärke nicht aufblähen"
    );
    assert_eq!(
        staerke(e, "ist_kumuliert"),
        (1, 0, 0),
        "auch die kumulierte Stärke bleibt auf den eigenen Einsatz beschränkt"
    );
}

// ---------- LFH-306: Teil-PATCH mit Tri-State ----------

/// Bildet eine Einheit mit VOLL besetzten Nebenfeldern (Soll-Trio, Bemerkung,
/// Kommunikationsmittel, Erreichbarkeit, Sortierung) und ordnet ihr eine Sprechgruppe zu.
async fn einheit_voll(app: &axum::Router, cookie: &str, einsatz: i64, sg: i64) -> i64 {
    let (s, json) = anfrage(
        app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/einheiten"),
        cookie,
        Some(&format!(
            r#"{{"name":"1. Zug","soll_fuehrer":1,"soll_unterfuehrer":3,"soll_mannschaft":18,
                 "bemerkung":"Bem","kommunikationsmittel":"digitalfunk",
                 "erreichbarkeit":"0170/12345","sortier":42,"sprechgruppe_ids":[{sg}]}}"#
        )),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED);
    json["id"].as_i64().unwrap()
}

/// **Der fachliche Kern des Commits.** Bildet exakt den `fuehrerSetzen`-Aufruf der
/// Einheiten-Seite nach: ein PATCH, der NUR `fuehrer_id` trägt. Unter dem alten Vollersatz
/// löschte dieser Request stillschweigend Kommunikationsmittel, Erreichbarkeit und die
/// Sprechgruppen-Zuordnung der Einheit und nullte das Soll-Trio.
#[tokio::test]
async fn patch_fuehrer_laesst_kommunikationsmittel_erreichbarkeit_und_sprechgruppen_stehen() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let sg = sprechgruppe_anlegen(&app, &admin, "100_T_LAGE", "TMO", 10).await;
    let e = einheit_voll(&app, &admin, einsatz, sg).await;
    let ep = person_anlegen(&app, &admin, einsatz, "Chef").await;
    personal_zuordnen(&app, &admin, einsatz, e, ep).await;

    let (status, json) = anfrage(
        &app,
        "PATCH",
        &format!("/api/einsaetze/{einsatz}/einheiten/{e}"),
        &admin,
        Some(&format!(r#"{{"fuehrer_id":{ep}}}"#)),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(json["fuehrer_id"], ep);
    assert_eq!(json["name"], "1. Zug", "Pflichtfeld unberührt");
    assert_eq!(json["kommunikationsmittel"], "digitalfunk");
    assert_eq!(json["erreichbarkeit"], "0170/12345");
    assert_eq!(json["bemerkung"], "Bem");
    assert_eq!(json["sortier"], 42);
    assert_eq!(json["soll"]["fuehrer"], 1);
    assert_eq!(json["soll"]["unterfuehrer"], 3);
    assert_eq!(json["soll"]["mannschaft"], 18);
    assert_eq!(
        namen(&json["sprechgruppen"], "bezeichnung"),
        vec!["100_T_LAGE"],
        "Sprechgruppen-Zuordnung darf ein Patch ohne den Key nicht löschen"
    );
}

/// Die Änderungserkennung des Führers hängt jetzt an „Feld im Patch enthalten UND Wert
/// verschieden". Ein Patch ohne `fuehrer_id` darf keinen Führerwechsel auf `None` und
/// damit auch keinen ETB-Eintrag auslösen. Der ETB-Zähler ist die Assertion, die ein
/// reiner Spaltenvergleich nicht sichtbar machen würde.
#[tokio::test]
async fn patch_ohne_fuehrer_id_loest_keinen_fuehrerwechsel_aus() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let sg = sprechgruppe_anlegen(&app, &admin, "100_T_LAGE", "TMO", 10).await;
    let e = einheit_voll(&app, &admin, einsatz, sg).await;
    let ep = person_anlegen(&app, &admin, einsatz, "Chef").await;
    personal_zuordnen(&app, &admin, einsatz, e, ep).await;
    // Führer setzen (erzeugt EINEN ETB-Eintrag).
    anfrage(
        &app,
        "PATCH",
        &format!("/api/einsaetze/{einsatz}/einheiten/{e}"),
        &admin,
        Some(&format!(r#"{{"fuehrer_id":{ep}}}"#)),
    )
    .await;
    let vorher = system_etb_anzahl(&app, &admin, einsatz).await;

    // Patch ohne `fuehrer_id` → kein Wechsel, kein ETB-Eintrag, Führer bleibt.
    let (status, json) = anfrage(
        &app,
        "PATCH",
        &format!("/api/einsaetze/{einsatz}/einheiten/{e}"),
        &admin,
        Some(r#"{"bemerkung":"neue Bemerkung"}"#),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(json["fuehrer_id"], ep, "Führer bleibt gesetzt");
    assert_eq!(json["bemerkung"], "neue Bemerkung");
    assert_eq!(
        system_etb_anzahl(&app, &admin, einsatz).await,
        vorher,
        "kein Führerwechsel → kein ETB-Eintrag"
    );
}

/// Grenzt gegen den vorigen ab: der Leer-Weg bleibt offen. `null` entfernt den Führer
/// UND schreibt dafür den ETB-Eintrag.
#[tokio::test]
async fn patch_fuehrer_id_null_entfernt_fuehrer() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let sg = sprechgruppe_anlegen(&app, &admin, "100_T_LAGE", "TMO", 10).await;
    let e = einheit_voll(&app, &admin, einsatz, sg).await;
    let ep = person_anlegen(&app, &admin, einsatz, "Chef").await;
    personal_zuordnen(&app, &admin, einsatz, e, ep).await;
    anfrage(
        &app,
        "PATCH",
        &format!("/api/einsaetze/{einsatz}/einheiten/{e}"),
        &admin,
        Some(&format!(r#"{{"fuehrer_id":{ep}}}"#)),
    )
    .await;
    let vorher = system_etb_anzahl(&app, &admin, einsatz).await;

    let (status, json) = anfrage(
        &app,
        "PATCH",
        &format!("/api/einsaetze/{einsatz}/einheiten/{e}"),
        &admin,
        Some(r#"{"fuehrer_id":null}"#),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert!(json["fuehrer_id"].is_null());
    assert_eq!(
        system_etb_anzahl(&app, &admin, einsatz).await,
        vorher + 1,
        "Führer entfernt → genau ein ETB-Eintrag"
    );
}

/// `sprechgruppe_ids` war schon vor LFH-306 tri-state — der Test pinnt, dass der Umbau
/// die Semantik nicht verdreht hat: absent = unverändert, `[]` = leeren.
#[tokio::test]
async fn patch_ohne_sprechgruppe_ids_laesst_zuordnung_stehen_leeres_array_leert() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let sg = sprechgruppe_anlegen(&app, &admin, "100_T_LAGE", "TMO", 10).await;
    let e = einheit_voll(&app, &admin, einsatz, sg).await;

    let (_, json) = anfrage(
        &app,
        "PATCH",
        &format!("/api/einsaetze/{einsatz}/einheiten/{e}"),
        &admin,
        Some(r#"{"name":"Umbenannt"}"#),
    )
    .await;
    assert_eq!(
        namen(&json["sprechgruppen"], "bezeichnung"),
        vec!["100_T_LAGE"]
    );

    let (_, json) = anfrage(
        &app,
        "PATCH",
        &format!("/api/einsaetze/{einsatz}/einheiten/{e}"),
        &admin,
        Some(r#"{"sprechgruppe_ids":[]}"#),
    )
    .await;
    assert!(json["sprechgruppen"].as_array().unwrap().is_empty());
}

/// Effektivzustands-Prüfung des Soll-Trios: EIN Feld patchen ist zulässig, weil der
/// Bestand die anderen zwei trägt; das Trio halb zu leeren bleibt 400; alle drei `null`
/// leert es legitim.
#[tokio::test]
async fn patch_soll_trio_prueft_gegen_bestand() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let sg = sprechgruppe_anlegen(&app, &admin, "100_T_LAGE", "TMO", 10).await;
    let e = einheit_voll(&app, &admin, einsatz, sg).await;
    let pfad = format!("/api/einsaetze/{einsatz}/einheiten/{e}");

    let (status, json) = anfrage(
        &app,
        "PATCH",
        &pfad,
        &admin,
        Some(r#"{"soll_mannschaft":20}"#),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(json["soll"]["fuehrer"], 1);
    assert_eq!(json["soll"]["mannschaft"], 20);

    assert_eq!(
        anfrage(
            &app,
            "PATCH",
            &pfad,
            &admin,
            Some(r#"{"soll_fuehrer":null}"#)
        )
        .await
        .0,
        StatusCode::BAD_REQUEST,
        "Trio darf nicht halb geleert werden"
    );

    let (status, json) = anfrage(
        &app,
        "PATCH",
        &pfad,
        &admin,
        Some(r#"{"soll_fuehrer":null,"soll_unterfuehrer":null,"soll_mannschaft":null}"#),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert!(json["soll"].is_null());
}

/// Statuscode-Konvention (LFH-305): vorhandenes-aber-leeres Pflichtfeld → 400, absentes
/// geht durch. Der Kontrast ist die Aussage.
#[tokio::test]
async fn patch_leerer_name_ist_400_absenter_laesst_namen_stehen() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let sg = sprechgruppe_anlegen(&app, &admin, "100_T_LAGE", "TMO", 10).await;
    let e = einheit_voll(&app, &admin, einsatz, sg).await;
    let pfad = format!("/api/einsaetze/{einsatz}/einheiten/{e}");

    assert_eq!(
        anfrage(&app, "PATCH", &pfad, &admin, Some(r#"{"name":"   "}"#))
            .await
            .0,
        StatusCode::BAD_REQUEST
    );
    let (status, json) = anfrage(&app, "PATCH", &pfad, &admin, Some(r#"{"sortier":9}"#)).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(json["name"], "1. Zug");
    assert_eq!(json["sortier"], 9);
}
