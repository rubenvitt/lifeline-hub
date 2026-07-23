use axum::http::StatusCode;

mod common;
use common::*;

// ---------- Tests ----------

#[tokio::test]
async fn admin_legt_person_an_alle_lesen_sie() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    benutzer_anlegen(&app, &admin, "erika", "keine").await;

    let (status, json) = anfrage(
        &app,
        "POST",
        "/api/personal",
        &admin,
        Some(r#"{"name":"Thomas Müller","staerke_position":"fuehrer"}"#),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    assert_eq!(json["name"], "Thomas Müller");
    assert_eq!(json["staerke_position"], "fuehrer");
    assert_eq!(json["qualifikationen"].as_array().unwrap().len(), 0);

    let erika = login_cookie(&app, "erika", "erikapw1").await;
    let (status, json) = anfrage(&app, "GET", "/api/personal", &erika, None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(json.as_array().unwrap().len(), 1);
}

#[tokio::test]
async fn nicht_admin_darf_nicht_anlegen() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    benutzer_anlegen(&app, &admin, "erika", "keine").await;
    let erika = login_cookie(&app, "erika", "erikapw1").await;
    let (status, _) = anfrage(
        &app,
        "POST",
        "/api/personal",
        &erika,
        Some(r#"{"name":"Verboten"}"#),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn dublette_personalnummer_ist_409_namen_erlaubt() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    // Gleicher Name ohne Nummer → erlaubt.
    assert_eq!(
        anfrage(
            &app,
            "POST",
            "/api/personal",
            &admin,
            Some(r#"{"name":"Thomas Müller"}"#)
        )
        .await
        .0,
        StatusCode::CREATED
    );
    assert_eq!(
        anfrage(
            &app,
            "POST",
            "/api/personal",
            &admin,
            Some(r#"{"name":"Thomas Müller"}"#)
        )
        .await
        .0,
        StatusCode::CREATED
    );
    // Gleiche Nummer → Conflict.
    let mit_nr = r#"{"name":"A","personalnummer":"4711"}"#;
    assert_eq!(
        anfrage(&app, "POST", "/api/personal", &admin, Some(mit_nr))
            .await
            .0,
        StatusCode::CREATED
    );
    assert_eq!(
        anfrage(
            &app,
            "POST",
            "/api/personal",
            &admin,
            Some(r#"{"name":"B","personalnummer":"4711"}"#)
        )
        .await
        .0,
        StatusCode::CONFLICT
    );
}

#[tokio::test]
async fn ungueltige_staerke_position_ist_400() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let (status, _) = anfrage(
        &app,
        "POST",
        "/api/personal",
        &admin,
        Some(r#"{"name":"X","staerke_position":"chef"}"#),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn ausser_dienst_versteckt_aus_nur_im_dienst() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let (_, json) = anfrage(
        &app,
        "POST",
        "/api/personal",
        &admin,
        Some(r#"{"name":"Thomas"}"#),
    )
    .await;
    let id = json["id"].as_i64().unwrap();
    assert_eq!(
        anfrage(
            &app,
            "POST",
            &format!("/api/personal/{id}/ausser-dienst"),
            &admin,
            None
        )
        .await
        .0,
        StatusCode::OK
    );
    let (_, im_dienst) = anfrage(
        &app,
        "GET",
        "/api/personal?nur_im_dienst=true",
        &admin,
        None,
    )
    .await;
    assert!(im_dienst.as_array().unwrap().is_empty());
    let (_, alle) = anfrage(&app, "GET", "/api/personal", &admin, None).await;
    assert_eq!(alle.as_array().unwrap().len(), 1);
}

#[tokio::test]
async fn qualifikationen_werden_zugeordnet_und_aufgeloest() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    // Aus dem Bootstrap-Seed zwei Qualifikations-IDs holen.
    let (_, quals) = anfrage(&app, "GET", "/api/qualifikationen", &admin, None).await;
    let ids: Vec<i64> = quals
        .as_array()
        .unwrap()
        .iter()
        .take(2)
        .map(|q| q["id"].as_i64().unwrap())
        .collect();
    let body = format!(
        r#"{{"name":"Thomas","qualifikation_ids":[{},{}]}}"#,
        ids[0], ids[1]
    );
    let (status, json) = anfrage(&app, "POST", "/api/personal", &admin, Some(&body)).await;
    assert_eq!(status, StatusCode::CREATED);
    assert_eq!(json["qualifikationen"].as_array().unwrap().len(), 2);
}

// ---------- LFH-306: Teil-PATCH mit Tri-State ----------

/// Legt eine Qualifikation an und liefert ihre id.
async fn qualifikation_anlegen(app: &axum::Router, admin: &str, label: &str, sortier: i64) -> i64 {
    let (status, json) = anfrage(
        app,
        "POST",
        "/api/qualifikationen",
        admin,
        Some(&format!(r#"{{"label":"{label}","sortier":{sortier}}}"#)),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "Qualifikation muss existieren");
    json["id"].as_i64().unwrap()
}

/// Legt eine Person mit allen Stammfeldern UND zwei echten Qualifikationen an; liefert
/// `(personal_id, q1, q2)`. Die Vorbedingungs-Asserts sind Absicht: `setze_qualifikationen`
/// fügt nur ids ein, die zur Org gehören — mit erfundenen ids hätte die Person null
/// Zuordnungen und `patch_ohne_qualifikation_ids_behaelt_qualifikationen` wäre still
/// wertlos (0 bliebe 0).
/// Die Labels sind bewusst frei erfunden: `QUALIFIKATION_STARTLISTE` seedet jede neue Org
/// mit 9 Einträgen (u. a. „Sanitäter"), ein Label dublett anzulegen wäre 409.
async fn person_mit_qualifikationen(app: &axum::Router, admin: &str) -> (i64, i64, i64) {
    let q1 = qualifikation_anlegen(app, admin, "LFH-306 Alpha", 910).await;
    let q2 = qualifikation_anlegen(app, admin, "LFH-306 Beta", 920).await;
    let (status, json) = anfrage(
        app,
        "POST",
        "/api/personal",
        admin,
        Some(&format!(
            r#"{{"name":"Thomas Müller","personalnummer":"4711",
                 "traegerorganisation":"DRK","telefon":"0123",
                 "staerke_position":"fuehrer","bemerkung":"Bemerkung alt",
                 "qualifikation_ids":[{q1},{q2}]}}"#
        )),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    assert_eq!(
        json["qualifikationen"].as_array().unwrap().len(),
        2,
        "Vorbedingung: Person hat 2 Qualifikationen"
    );
    (json["id"].as_i64().unwrap(), q1, q2)
}

/// **Der wichtigste Test des Tickets.** `qualifikation_ids` trug im alten Vollersatz-Body
/// ein `#[serde(default)] Vec<i64>` — jeder PATCH ohne das Feld (z. B. das Ändern der
/// Telefonnummer) löschte ALLE Qualifikationszuordnungen der Person. Fällt gegen HEAD
/// hart durch.
#[tokio::test]
async fn patch_ohne_qualifikation_ids_behaelt_qualifikationen() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let (id, q1, q2) = person_mit_qualifikationen(&app, &admin).await;

    let (status, json) = anfrage(
        &app,
        "PATCH",
        &format!("/api/personal/{id}"),
        &admin,
        Some(r#"{"telefon":"0999"}"#),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(json["telefon"], "0999");
    let ids: Vec<i64> = json["qualifikationen"]
        .as_array()
        .unwrap()
        .iter()
        .map(|q| q["id"].as_i64().unwrap())
        .collect();
    assert_eq!(
        ids,
        vec![q1, q2],
        "nicht gesendetes qualifikation_ids darf die Zuordnung nicht löschen"
    );
}

/// Die Gegenprobe: das EXPLIZITE leere Array ist der Leerwunsch und leert weiter.
/// Zusammen mit dem vorigen Test ist das die Unterscheidung absent ↔ gesendet — ein Test
/// allein wäre in beiden Welten grün.
#[tokio::test]
async fn patch_qualifikation_ids_leeres_array_leert() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let (id, _, _) = person_mit_qualifikationen(&app, &admin).await;

    let (status, json) = anfrage(
        &app,
        "PATCH",
        &format!("/api/personal/{id}"),
        &admin,
        Some(r#"{"qualifikation_ids":[]}"#),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert!(json["qualifikationen"].as_array().unwrap().is_empty());
    assert_eq!(json["telefon"], "0123", "Nachbarfeld unberührt");
}

/// Innerhalb von `Some` bleibt die Vollersatz-Semantik bewusst erhalten: die gesendete
/// Liste ersetzt die Menge vollständig (kein Diff-Protokoll).
#[tokio::test]
async fn patch_qualifikation_ids_ersetzt_die_menge_vollstaendig() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let (id, q1, _) = person_mit_qualifikationen(&app, &admin).await;

    let (status, json) = anfrage(
        &app,
        "PATCH",
        &format!("/api/personal/{id}"),
        &admin,
        Some(&format!(r#"{{"qualifikation_ids":[{q1}]}}"#)),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let quals = json["qualifikationen"].as_array().unwrap();
    assert_eq!(quals.len(), 1);
    assert_eq!(quals[0]["id"], q1);
}

/// Nicht gesendete Stammfelder bleiben stehen — unter dem alten Vollersatz wurde jedes
/// fehlende Feld zu `None` und nullte seine Spalte.
#[tokio::test]
async fn patch_ohne_telefon_laesst_nachbarfelder_stehen() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let (id, _, _) = person_mit_qualifikationen(&app, &admin).await;

    let (status, json) = anfrage(
        &app,
        "PATCH",
        &format!("/api/personal/{id}"),
        &admin,
        Some(r#"{"bemerkung":"Bemerkung neu"}"#),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(json["bemerkung"], "Bemerkung neu");
    assert_eq!(json["name"], "Thomas Müller", "unberührt");
    assert_eq!(json["personalnummer"], "4711", "unberührt");
    assert_eq!(json["traegerorganisation"], "DRK", "unberührt");
    assert_eq!(json["telefon"], "0123", "unberührt");
    assert_eq!(json["staerke_position"], "fuehrer", "unberührt");
}

/// Die Gegenprobe zum Nicht-Anfassen: `null` (bzw. `""`) leert die Spalte wirklich.
#[tokio::test]
async fn patch_telefon_null_loescht() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let (id, _, _) = person_mit_qualifikationen(&app, &admin).await;

    let (status, json) = anfrage(
        &app,
        "PATCH",
        &format!("/api/personal/{id}"),
        &admin,
        Some(r#"{"telefon":null,"traegerorganisation":"   "}"#),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert!(
        json["telefon"].is_null(),
        "explizites null leert die Spalte"
    );
    assert!(
        json["traegerorganisation"].is_null(),
        "Leerstring leert ebenfalls"
    );
    assert_eq!(json["personalnummer"], "4711", "Nachbarfeld unberührt");
}

/// Statuscode-Konvention (LFH-305): ein VORHANDENER, aber leerer Name scheitert am Feld
/// selbst → 400; ein unbekannter Enum-Wert ebenfalls. Ein ABSENTER Name ist kein Wunsch
/// und geht durch.
#[tokio::test]
async fn patch_leerer_name_ist_400_absenter_laesst_ihn_stehen() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let (id, _, _) = person_mit_qualifikationen(&app, &admin).await;

    assert_eq!(
        anfrage(
            &app,
            "PATCH",
            &format!("/api/personal/{id}"),
            &admin,
            Some(r#"{"name":"   "}"#)
        )
        .await
        .0,
        StatusCode::BAD_REQUEST
    );
    assert_eq!(
        anfrage(
            &app,
            "PATCH",
            &format!("/api/personal/{id}"),
            &admin,
            Some(r#"{"staerke_position":"quatsch"}"#)
        )
        .await
        .0,
        StatusCode::BAD_REQUEST
    );
    let (status, json) = anfrage(
        &app,
        "PATCH",
        &format!("/api/personal/{id}"),
        &admin,
        Some(r#"{"telefon":"0999"}"#),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "absentes Pflichtfeld ist zulässig");
    assert_eq!(json["name"], "Thomas Müller");
}

#[tokio::test]
async fn patch_unbekannte_id_ist_404() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let (status, _) = anfrage(
        &app,
        "PATCH",
        "/api/personal/9999",
        &admin,
        Some(r#"{"name":"X"}"#),
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn in_dienst_auf_vergebene_personalnummer_ist_409() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    // A mit Nummer 7, dann außer Dienst.
    let (_, a) = anfrage(
        &app,
        "POST",
        "/api/personal",
        &admin,
        Some(r#"{"name":"Alt","personalnummer":"7"}"#),
    )
    .await;
    let id = a["id"].as_i64().unwrap();
    assert_eq!(
        anfrage(
            &app,
            "POST",
            &format!("/api/personal/{id}/ausser-dienst"),
            &admin,
            None
        )
        .await
        .0,
        StatusCode::OK
    );
    // Nummer 7 neu vergeben.
    assert_eq!(
        anfrage(
            &app,
            "POST",
            "/api/personal",
            &admin,
            Some(r#"{"name":"Neu","personalnummer":"7"}"#)
        )
        .await
        .0,
        StatusCode::CREATED
    );
    // Reaktivieren von A kollidiert → 409.
    assert_eq!(
        anfrage(
            &app,
            "POST",
            &format!("/api/personal/{id}/in-dienst"),
            &admin,
            None
        )
        .await
        .0,
        StatusCode::CONFLICT
    );
}

#[tokio::test]
async fn kein_delete_endpunkt() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let (_, json) = anfrage(
        &app,
        "POST",
        "/api/personal",
        &admin,
        Some(r#"{"name":"Thomas"}"#),
    )
    .await;
    let id = json["id"].as_i64().unwrap();
    let (status, _) = anfrage(&app, "DELETE", &format!("/api/personal/{id}"), &admin, None).await;
    assert_eq!(status, StatusCode::METHOD_NOT_ALLOWED);
}
