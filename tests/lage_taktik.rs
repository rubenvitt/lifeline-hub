//! L-2 Lage/Taktik — Backend-Integrationstests.
//!
//! Deckt ab: Verorten ohne ETB, Geo-Paar-Semantik (Partial-Merge + unpaariges 422),
//! Karten-Lesedaten (aufgelöste Einheiten verschwinden, Karten-Personal = alle disponierten),
//! reguläre Org-Isolation (Fremd-Nutzer ohne Mitgliedschaft) sowie Live-Events bei
//! Geo-PATCH und K&M-Mutation.
//!
//! Harness aus tests/common; `setup_mit_pool_und_live()` liefert zusätzlich
//! den `LiveHub`-Klon (teilt denselben inneren Zustand wie der im AppState), damit
//! der SSE-Test direkt via `live.abonniere(einsatz_id)` mithören kann.

use axum::http::StatusCode;
use std::time::Duration;

mod common;
use common::{
    anfrage, einheit_bilden, einsatz_anlegen, login_cookie, recv_until_tag,
    setup_mit_pool_und_live, stammpersonal_disponieren,
};

// ---------- Harness ----------

/// Anzahl ETB-Einträge (gesamt) im Einsatz.
async fn etb_anzahl(app: &axum::Router, cookie: &str, einsatz: i64) -> usize {
    let (s, json) = anfrage(
        app,
        "GET",
        &format!("/api/einsaetze/{einsatz}/etb"),
        cookie,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    json.as_array().unwrap().len()
}

// ---------- Fall 1: Verorten erzeugt KEINEN ETB-Eintrag ----------

#[tokio::test]
async fn verorten_erzeugt_keinen_etb() {
    let (app, _pool, _live) = setup_mit_pool_und_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let eid = einheit_bilden(&app, &admin, einsatz, "1. Zug").await; // Bilden DARF ETB erzeugen.

    let vorher = etb_anzahl(&app, &admin, einsatz).await;
    // Positive Kontrolle: ohne diesen Assert wäre vorher=0=nachher fälschlich grün,
    // falls das ETB-System komplett kaputt wäre.
    assert!(
        vorher >= 1,
        "bilden muss mindestens einen ETB-Eintrag erzeugt haben — ETB-Baseline ist kaputt"
    );
    let (s, _) = anfrage(
        &app,
        "PATCH",
        &format!("/api/einsaetze/{einsatz}/einheiten/{eid}/position"),
        &admin,
        Some(r#"{"lat":52.5,"lon":13.4,"tz_fachaufgabe":"fuehrung"}"#),
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    let nachher = etb_anzahl(&app, &admin, einsatz).await;
    assert_eq!(
        vorher, nachher,
        "Geo-PATCH darf KEINEN ETB-Eintrag schreiben"
    );
}

// ---------- Fall 2: Geo-Paar + Partial-Merge ----------

#[tokio::test]
async fn geo_paar_partial_merge_und_unpaarig_422() {
    let (app, _pool, _live) = setup_mit_pool_und_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let eid = einheit_bilden(&app, &admin, einsatz, "1. Zug").await;
    let pos = format!("/api/einsaetze/{einsatz}/einheiten/{eid}/position");

    // 1) lat+lon gemeinsam setzen → 200.
    let (s, json) = anfrage(
        &app,
        "PATCH",
        &pos,
        &admin,
        Some(r#"{"lat":52.5,"lon":13.4}"#),
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(json["lat"], 52.5);
    assert_eq!(json["lon"], 13.4);

    // 2) nur tz_fachaufgabe patchen → 200, lat/lon bleiben erhalten (Partial-Merge).
    let (s, json) = anfrage(
        &app,
        "PATCH",
        &pos,
        &admin,
        Some(r#"{"tz_fachaufgabe":"betreuung"}"#),
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(
        json["lat"], 52.5,
        "lat muss nach reinem tz-Patch bestehen bleiben"
    );
    assert_eq!(
        json["lon"], 13.4,
        "lon muss nach reinem tz-Patch bestehen bleiben"
    );
    assert_eq!(json["tz_fachaufgabe"], "betreuung");

    // 3) {"lat":null} allein → 422 (unpaarig: lat leer, lon noch gesetzt).
    let (s, _) = anfrage(&app, "PATCH", &pos, &admin, Some(r#"{"lat":null}"#)).await;
    assert_eq!(
        s,
        StatusCode::UNPROCESSABLE_ENTITY,
        "unpaariges lat=null muss 422 liefern"
    );
}

// ---------- Fall 3: Filter Aufgelöstes + Führungskräfte nur Leader ----------

#[tokio::test]
async fn aufgeloeste_verschwinden_und_karte_zeigt_alle_personen() {
    let (app, _pool, _live) = setup_mit_pool_und_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;

    // Einheit auflösen → verschwindet aus GET .../einheiten.
    let weg = einheit_bilden(&app, &admin, einsatz, "Auflöser").await;
    let bleibt = einheit_bilden(&app, &admin, einsatz, "Bleibt").await;
    assert_eq!(
        anfrage(
            &app,
            "DELETE",
            &format!("/api/einsaetze/{einsatz}/einheiten/{weg}"),
            &admin,
            None
        )
        .await
        .0,
        StatusCode::NO_CONTENT
    );
    let (_, liste) = anfrage(
        &app,
        "GET",
        &format!("/api/einsaetze/{einsatz}/einheiten"),
        &admin,
        None,
    )
    .await;
    let ids: Vec<i64> = liste
        .as_array()
        .unwrap()
        .iter()
        .map(|e| e["id"].as_i64().unwrap())
        .collect();
    assert!(
        !ids.contains(&weg),
        "aufgelöste Einheit darf nicht mehr gelistet werden"
    );
    assert!(ids.contains(&bleibt));

    // Personal: einer wird Einheitsführer, einer bleibt normal.
    let chef = stammpersonal_disponieren(&app, &admin, einsatz, "Chef").await;
    let normal = stammpersonal_disponieren(&app, &admin, einsatz, "Helfer").await;
    // Chef in die verbleibende Einheit, dann als Führer setzen.
    assert_eq!(
        anfrage(
            &app,
            "PUT",
            &format!("/api/einsaetze/{einsatz}/einheiten/{bleibt}/personal/{chef}"),
            &admin,
            None
        )
        .await
        .0,
        StatusCode::NO_CONTENT
    );
    let (s, _) = anfrage(
        &app,
        "PATCH",
        &format!("/api/einsaetze/{einsatz}/einheiten/{bleibt}"),
        &admin,
        Some(&format!(r#"{{"name":"Bleibt","fuehrer_id":{chef}}}"#)),
    )
    .await;
    assert_eq!(s, StatusCode::OK);

    // Karten-Personal enthält ALLE disponierten Personen (Chef + Helfer); Führung via Flags (LFH-276).
    let (s, fk) = anfrage(
        &app,
        "GET",
        &format!("/api/einsaetze/{einsatz}/karte/fuehrungskraefte"),
        &admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    let arr = fk.as_array().unwrap();
    let fk_ids: Vec<i64> = arr.iter().map(|p| p["id"].as_i64().unwrap()).collect();
    assert!(
        fk_ids.contains(&chef) && fk_ids.contains(&normal),
        "Chef UND Helfer müssen in karte/fuehrungskraefte erscheinen"
    );
    assert_eq!(
        fk_ids.len(),
        2,
        "alle disponierten Personen (Chef + Helfer)"
    );
    let chef_obj = arr.iter().find(|p| p["id"].as_i64() == Some(chef)).unwrap();
    let normal_obj = arr
        .iter()
        .find(|p| p["id"].as_i64() == Some(normal))
        .unwrap();
    assert_eq!(
        chef_obj["ist_einheitsfuehrer"].as_bool(),
        Some(true),
        "Einheitsführer-Flag bleibt gesetzt"
    );
    assert_eq!(normal_obj["ist_einheitsfuehrer"].as_bool(), Some(false));
    assert_eq!(normal_obj["ist_abschnittsleiter"].as_bool(), Some(false));
}

#[tokio::test]
async fn personal_ohne_fuehrung_ist_verortbar() {
    // LFH-276: Der 404 entstand ausschließlich am Re-list-`.find` in aktualisiere_position
    // (der Filter schloss Nicht-Führung aus der Ergebnisliste aus; das UPDATE lief bereits).
    // Fix = Filter entfernt → die Position eines beliebigen disponierten Helfers ist setzbar.
    let (app, _pool, _live) = setup_mit_pool_und_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let helfer = stammpersonal_disponieren(&app, &admin, einsatz, "Helfer").await;

    let (s, body) = anfrage(
        &app,
        "PATCH",
        &format!("/api/einsaetze/{einsatz}/personal/{helfer}/position"),
        &admin,
        Some(r#"{"lat":50.1,"lon":8.6}"#),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "Nicht-Führungskraft muss verortbar sein");
    assert_eq!(body["lat"].as_f64(), Some(50.1));
    assert_eq!(body["lon"].as_f64(), Some(8.6));
}

// ---------- Fall 4: Org-Isolation (regulärer Fremd-Nutzer) ----------

#[tokio::test]
async fn fremder_org_nutzer_wird_abgewiesen() {
    let (app, pool, _live) = setup_mit_pool_und_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let eid = einheit_bilden(&app, &admin, einsatz, "1. Zug").await;

    // Zweite Organisation + Nutzer in Org B (system_rolle='keiner', org_rolle default 'keine',
    // keine Einsatz-Mitgliedschaft). Passwort-Hash vom Bootstrap-Admin wiederverwenden
    // (gleicher Klartext "startpw12") — unabhängig von der Sichtbarkeit des password-Moduls.
    let org_b: i64 =
        sqlx::query_scalar("INSERT INTO organisation (name) VALUES ('Fremd-Orga') RETURNING id")
            .fetch_one(&pool)
            .await
            .unwrap();
    let admin_hash: String =
        sqlx::query_scalar("SELECT passwort_hash FROM benutzer WHERE benutzername = 'admin'")
            .fetch_one(&pool)
            .await
            .unwrap();
    sqlx::query(
        "INSERT INTO benutzer (org_id, anzeigename, benutzername, passwort_hash, system_rolle) \
         VALUES (?, 'Fremd', 'fremd', ?, 'keiner')",
    )
    .bind(org_b)
    .bind(&admin_hash)
    .execute(&pool)
    .await
    .unwrap();

    let fremd = login_cookie(&app, "fremd", "startpw12").await;

    // Lesen ist verboten (kein Mitglied, keine höhere Berechtigung) → 403.
    assert_eq!(
        anfrage(
            &app,
            "GET",
            &format!("/api/einsaetze/{einsatz}/einheiten"),
            &fremd,
            None
        )
        .await
        .0,
        StatusCode::FORBIDDEN
    );
    // Geo-PATCH ebenso → 403 (Schreibrecht-Gate vor Laden) oder 404.
    let s = anfrage(
        &app,
        "PATCH",
        &format!("/api/einsaetze/{einsatz}/einheiten/{eid}/position"),
        &fremd,
        Some(r#"{"lat":52.5,"lon":13.4}"#),
    )
    .await
    .0;
    assert!(
        matches!(s, StatusCode::FORBIDDEN | StatusCode::NOT_FOUND),
        "Fremd-PATCH muss 403/404 sein, war {s}"
    );
}

// ---------- Fall 5: SSE feuert bei Geo-PATCH UND K&M-Mutation ----------

#[tokio::test]
async fn sse_feuert_bei_kum_mutation_und_geo_patch() {
    let (app, _pool, live) = setup_mit_pool_und_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await; // Anlage ist kein gemessenes Event.

    // VOR den Aktionen abonnieren — derselbe Arc wie im AppState.
    let mut rx = live.abonniere(einsatz);
    let kurz = Duration::from_secs(2);

    // K&M-Mutation: Einheit bilden → feuert "etb" + "einheit"; auf "einheit" warten.
    let eid = einheit_bilden(&app, &admin, einsatz, "1. Zug").await;
    let n = recv_until_tag(&mut rx, "einheit", kurz).await;
    assert!(
        n.data.contains(&format!("\"einheit_id\":{eid}")),
        "Event-Payload muss die einheit_id tragen"
    );

    // Geo-PATCH auf dieselbe Einheit → erneut ein "einheit"-Event (ohne ETB).
    let (s, _) = anfrage(
        &app,
        "PATCH",
        &format!("/api/einsaetze/{einsatz}/einheiten/{eid}/position"),
        &admin,
        Some(r#"{"lat":52.5,"lon":13.4}"#),
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    let n = recv_until_tag(&mut rx, "einheit", kurz).await;
    assert!(n.data.contains(&format!("\"einheit_id\":{eid}")));
}

// ---------- LLH-1945: Feld-CAS an Position und taktischem Zeichen ----------

/// Verortet eine Kraft per Ad-hoc-Disposition als Fahrzeug → `einsatz_fahrzeug.id`.
async fn fahrzeug_adhoc(app: &axum::Router, cookie: &str, einsatz: i64) -> i64 {
    let (s, json) = anfrage(
        app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/fahrzeuge"),
        cookie,
        Some(r#"{"adhoc":{"funkrufname":"FW Extern 1","traegerorganisation":"Feuerwehr"}}"#),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{json}");
    json["id"].as_i64().unwrap()
}

/// Gemeinsamer Ablauf für die drei Positionswege (Einheit, Fahrzeug, Person): Konflikt an der
/// Koordinate und am Zeichen, andere Angabe dazwischen ohne 409, 422 für Altwert ohne Änderung
/// und für eine halbe Koordinate, ohne `erwartet` ohne Vergleich.
async fn check_position_cas(app: &axum::Router, admin: &str, uri: &str) {
    let patch = |body: &'static str| async move {
        let (s, j) = anfrage(app, "PATCH", uri, admin, Some(body)).await;
        (s, j)
    };
    // Ausgangsstand, den B sieht: 50/8, kein Zeichen.
    let (s, j) = patch(r#"{"lat":50.0,"lon":8.0}"#).await;
    assert_eq!(s, StatusCode::OK, "{uri}: {j}");
    // A verschiebt (ohne Altwert, wie bisher).
    let (s, j) = patch(r#"{"lat":51.0,"lon":9.0}"#).await;
    assert_eq!(s, StatusCode::OK, "{uri}: {j}");

    // B platziert auf seinem alten Stand → 409 `veraltet`, nichts überschrieben.
    let (s, j) = patch(r#"{"lat":52.0,"lon":10.0,"erwartet":{"lat":50.0,"lon":8.0}}"#).await;
    assert_eq!(s, StatusCode::CONFLICT, "{uri}: {j}");
    assert_eq!(j["grund"], "veraltet", "{uri}: {j}");

    // Das Zeichen ist eine andere Angabe: die geänderte Koordinate löst keinen Konflikt aus.
    let (s, j) = patch(r#"{"tz_fachaufgabe":"fuehrung","erwartet":{"tz_fachaufgabe":null}}"#).await;
    assert_eq!(s, StatusCode::OK, "{uri}: {j}");
    assert_eq!(j["lat"].as_f64(), Some(51.0), "{uri}: {j}");
    assert_eq!(j["tz_fachaufgabe"], "fuehrung", "{uri}: {j}");

    // Mit dem aktuellen Paar geht das Verschieben durch.
    let (s, j) = patch(r#"{"lat":52.0,"lon":10.0,"erwartet":{"lat":51.0,"lon":9.0}}"#).await;
    assert_eq!(s, StatusCode::OK, "{uri}: {j}");
    assert_eq!(j["lat"].as_f64(), Some(52.0), "{uri}: {j}");

    // Zeichen auf überholtem Stand → 409, das Zeichen bleibt.
    let (s, j) = patch(r#"{"tz_fachaufgabe":"sanitaet","erwartet":{"tz_fachaufgabe":null}}"#).await;
    assert_eq!(s, StatusCode::CONFLICT, "{uri}: {j}");
    assert_eq!(j["grund"], "veraltet", "{uri}: {j}");
    let (s, j) = patch(r#"{"tz_organisation":null,"erwartet":{"tz_organisation":null}}"#).await;
    assert_eq!(s, StatusCode::OK, "{uri}: {j}");
    assert_eq!(j["tz_fachaufgabe"], "fuehrung", "{uri}: {j}");

    // 422: Altwert ohne Änderung desselben Felds, halbe Koordinate im Altwert.
    for body in [
        r#"{"tz_organisation":"thw","erwartet":{"lat":52.0,"lon":10.0}}"#,
        r#"{"lat":53.0,"lon":11.0,"erwartet":{"lat":52.0}}"#,
    ] {
        let (s, j) = anfrage(app, "PATCH", uri, admin, Some(body)).await;
        assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY, "{uri} {body}: {j}");
    }
    let (s, j) = patch(r#"{"lat":null,"lon":null}"#).await;
    assert_eq!(s, StatusCode::OK, "{uri}: {j}");
    assert!(
        j["lat"].is_null(),
        "{uri}: ohne erwartet ohne Vergleich: {j}"
    );
}

#[tokio::test]
async fn position_und_zeichen_pruefen_auf_zwischenzeitliche_aenderung() {
    let (app, _pool, _live) = setup_mit_pool_und_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let eid = einheit_bilden(&app, &admin, einsatz, "1. Zug").await;
    let ef = fahrzeug_adhoc(&app, &admin, einsatz).await;
    let ep = stammpersonal_disponieren(&app, &admin, einsatz, "Helfer").await;
    for uri in [
        format!("/api/einsaetze/{einsatz}/einheiten/{eid}/position"),
        format!("/api/einsaetze/{einsatz}/fahrzeuge/{ef}/position"),
        format!("/api/einsaetze/{einsatz}/personal/{ep}/position"),
    ] {
        check_position_cas(&app, &admin, &uri).await;
    }
}

#[tokio::test]
async fn abschnittsflaeche_und_zeichen_pruefen_auf_zwischenzeitliche_aenderung() {
    let (app, _pool, _live) = setup_mit_pool_und_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let (s, a) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/abschnitte"),
        &admin,
        Some(r#"{"name":"Nord"}"#),
    )
    .await;
    assert!(s.is_success(), "{a}");
    let aid = a["id"].as_i64().unwrap();
    let uri = format!("/api/einsaetze/{einsatz}/abschnitte/{aid}/flaeche");
    let poly = |x: f64| {
        format!(r#"{{"type":"Polygon","coordinates":[[[{x},50],[{x},51],[9,51],[{x},50]]]}}"#)
    };
    let alt = poly(8.0);
    let neu = poly(8.5);
    let body = |geo: &str, erwartet: serde_json::Value| {
        serde_json::json!({ "flaeche_geojson": geo, "erwartet": erwartet }).to_string()
    };
    let (s, j) = anfrage(
        &app,
        "PATCH",
        &uri,
        &admin,
        Some(&serde_json::json!({ "flaeche_geojson": alt }).to_string()),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{j}");
    // A zeichnet die Fläche neu.
    let (s, j) = anfrage(
        &app,
        "PATCH",
        &uri,
        &admin,
        Some(&serde_json::json!({ "flaeche_geojson": neu }).to_string()),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{j}");

    // B zeichnet auf dem alten Stand → 409.
    let b = body(&poly(7.5), serde_json::json!({ "flaeche_geojson": alt }));
    let (s, j) = anfrage(&app, "PATCH", &uri, &admin, Some(&b)).await;
    assert_eq!(s, StatusCode::CONFLICT, "{j}");
    assert_eq!(j["grund"], "veraltet", "{j}");

    // Das Zeichen ist eine andere Angabe.
    let (s, j) = anfrage(
        &app,
        "PATCH",
        &uri,
        &admin,
        Some(r#"{"tz_fachaufgabe":"fuehrung","erwartet":{"tz_fachaufgabe":null}}"#),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{j}");
    assert_eq!(j["flaeche_geojson"], neu.as_str(), "{j}");
    let (s, j) = anfrage(
        &app,
        "PATCH",
        &uri,
        &admin,
        Some(r#"{"tz_fachaufgabe":"sanitaet","erwartet":{"tz_fachaufgabe":null}}"#),
    )
    .await;
    assert_eq!(s, StatusCode::CONFLICT, "{j}");

    // Mit dem aktuellen Stand durch; Löschen der Fläche mit Altwert ebenso.
    let b = body(&poly(7.5), serde_json::json!({ "flaeche_geojson": neu }));
    let (s, j) = anfrage(&app, "PATCH", &uri, &admin, Some(&b)).await;
    assert_eq!(s, StatusCode::OK, "{j}");

    // 422: Altwert ohne Änderung desselben Felds.
    let (s, j) = anfrage(
        &app,
        "PATCH",
        &uri,
        &admin,
        Some(r#"{"tz_organisation":"thw","erwartet":{"flaeche_geojson":null}}"#),
    )
    .await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY, "{j}");
}
