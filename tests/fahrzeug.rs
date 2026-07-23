use axum::http::StatusCode;

mod common;
use common::*;

// ---------- Tests ----------

#[tokio::test]
async fn admin_legt_fahrzeug_an_alle_lesen_es() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    benutzer_anlegen(&app, &admin, "erika", "keine").await;

    let (status, json) = anfrage(
        &app, "POST", "/api/fahrzeuge", &admin,
        Some(r#"{"funkrufname":"Florian Musterstadt 83/1","fahrzeugtyp":"LF 20","staerke_fuehrer":0,"staerke_unterfuehrer":1,"staerke_mannschaft":8}"#),
    ).await;
    assert_eq!(status, StatusCode::CREATED);
    assert_eq!(json["funkrufname"], "Florian Musterstadt 83/1");
    assert_eq!(json["staerke"]["mannschaft"], 8);

    let erika = login_cookie(&app, "erika", "erikapw1").await;
    let (status, json) = anfrage(&app, "GET", "/api/fahrzeuge", &erika, None).await;
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
        "/api/fahrzeuge",
        &erika,
        Some(r#"{"funkrufname":"Verboten 1"}"#),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn dublette_funkrufname_ist_409() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let body = r#"{"funkrufname":"Florian 1"}"#;
    assert_eq!(
        anfrage(&app, "POST", "/api/fahrzeuge", &admin, Some(body))
            .await
            .0,
        StatusCode::CREATED
    );
    assert_eq!(
        anfrage(&app, "POST", "/api/fahrzeuge", &admin, Some(body))
            .await
            .0,
        StatusCode::CONFLICT
    );
}

#[tokio::test]
async fn unvollstaendige_staerke_ist_400() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let (status, _) = anfrage(
        &app,
        "POST",
        "/api/fahrzeuge",
        &admin,
        Some(r#"{"funkrufname":"Florian 1","staerke_fuehrer":0,"staerke_mannschaft":8}"#),
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
        "/api/fahrzeuge",
        &admin,
        Some(r#"{"funkrufname":"Florian 1"}"#),
    )
    .await;
    let id = json["id"].as_i64().unwrap();

    assert_eq!(
        anfrage(
            &app,
            "POST",
            &format!("/api/fahrzeuge/{id}/ausser-dienst"),
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
        "/api/fahrzeuge?nur_im_dienst=true",
        &admin,
        None,
    )
    .await;
    assert!(im_dienst.as_array().unwrap().is_empty());
    let (_, alle) = anfrage(&app, "GET", "/api/fahrzeuge", &admin, None).await;
    assert_eq!(alle.as_array().unwrap().len(), 1);
}

#[tokio::test]
async fn patch_unbekannte_id_ist_404() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let (status, _) = anfrage(
        &app,
        "PATCH",
        "/api/fahrzeuge/9999",
        &admin,
        Some(r#"{"funkrufname":"X"}"#),
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
}

// ---------- LFH-306: Teil-PATCH mit Tri-State ----------

/// Legt ein Fahrzeug mit ALLEN 13 editierbaren Feldern distinkt gesetzt an und liefert
/// seine id. Die Vorbedingungs-Asserts sind Absicht: ein Setup, das die Felder gar nicht
/// gesetzt bekommt, macht die PATCH-Tests darunter still wertlos.
async fn fahrzeug_voll(app: &axum::Router, admin: &str, funkrufname: &str) -> i64 {
    let (status, json) = anfrage(
        app,
        "POST",
        "/api/fahrzeuge",
        admin,
        Some(&format!(
            r#"{{"funkrufname":"{funkrufname}","fahrzeugtyp":"LF 20",
                 "traegerorganisation":"Feuerwehr","kennzeichen":"XX-AB 123",
                 "opta":"OPTA-1","standort":"Wache Mitte","fms_issi":"ISSI-9",
                 "sondersignal":true,"tragenkapazitaet":3,
                 "staerke_fuehrer":1,"staerke_unterfuehrer":2,"staerke_mannschaft":5,
                 "bemerkung":"Bemerkung alt"}}"#
        )),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    assert_eq!(json["sondersignal"], true, "Vorbedingung des PATCH-Tests");
    assert_eq!(json["staerke"]["mannschaft"], 5, "Vorbedingung");
    json["id"].as_i64().unwrap()
}

/// **Der schärfste Test der Route.** `sondersignal` liegt auf einer NOT-NULL-Spalte und trug
/// im alten Vollersatz-Body ein `#[serde(default)] bool` — jeder PATCH ohne das Feld setzte
/// die Spalte still auf `false` (das Blaulicht verschwand beim Ändern der Bemerkung).
/// Fällt gegen HEAD hart durch.
#[tokio::test]
async fn patch_ohne_sondersignal_behaelt_true() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let id = fahrzeug_voll(&app, &admin, "Florian 1").await;

    let (status, json) = anfrage(
        &app,
        "PATCH",
        &format!("/api/fahrzeuge/{id}"),
        &admin,
        Some(r#"{"bemerkung":"Bemerkung neu"}"#),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(json["bemerkung"], "Bemerkung neu");
    assert_eq!(
        json["sondersignal"], true,
        "NOT-NULL-Bool darf nicht auf false fallen"
    );
}

/// Grenzt gegen den vorigen ab: `false` im Body ist ein echter Setz-Wunsch und muss
/// ankommen — sonst wäre „absent bleibt stehen" trivial durch Ignorieren des Feldes lösbar.
#[tokio::test]
async fn patch_sondersignal_false_setzt_auf_false() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let id = fahrzeug_voll(&app, &admin, "Florian 1").await;

    let (status, json) = anfrage(
        &app,
        "PATCH",
        &format!("/api/fahrzeuge/{id}"),
        &admin,
        Some(r#"{"sondersignal":false}"#),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(json["sondersignal"], false);
    assert_eq!(json["bemerkung"], "Bemerkung alt", "Nachbarfeld unberührt");
}

/// **Der breiteste unterscheidende Test** — zugleich der Bind-Reihenfolge-Test über HTTP:
/// alle 13 Felder distinkt setzen, EINES patchen, die anderen zwölf EINZELN prüfen.
/// Unter dem alten Vollersatz-Verhalten wurde jedes fehlende Feld zu `None` und nullte
/// seine Spalte.
#[tokio::test]
async fn patch_nur_bemerkung_laesst_zehn_nachbarfelder_stehen() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let id = fahrzeug_voll(&app, &admin, "Florian 1").await;

    let (status, json) = anfrage(
        &app,
        "PATCH",
        &format!("/api/fahrzeuge/{id}"),
        &admin,
        Some(r#"{"bemerkung":"Bemerkung neu"}"#),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(json["bemerkung"], "Bemerkung neu");
    assert_eq!(json["funkrufname"], "Florian 1");
    assert_eq!(json["fahrzeugtyp"], "LF 20");
    assert_eq!(json["traegerorganisation"], "Feuerwehr");
    assert_eq!(json["kennzeichen"], "XX-AB 123");
    assert_eq!(json["opta"], "OPTA-1");
    assert_eq!(json["standort"], "Wache Mitte");
    assert_eq!(json["fms_issi"], "ISSI-9");
    assert_eq!(json["sondersignal"], true);
    assert_eq!(json["tragenkapazitaet"], 3);
    assert_eq!(json["staerke"]["fuehrer"], 1);
    assert_eq!(json["staerke"]["unterfuehrer"], 2);
    assert_eq!(json["staerke"]["mannschaft"], 5);
}

/// Die Gegenprobe zum Nicht-Anfassen: `null` leert die Spalte wirklich.
#[tokio::test]
async fn patch_kennzeichen_null_loescht() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let id = fahrzeug_voll(&app, &admin, "Florian 1").await;

    let (status, json) = anfrage(
        &app,
        "PATCH",
        &format!("/api/fahrzeuge/{id}"),
        &admin,
        Some(r#"{"kennzeichen":null,"tragenkapazitaet":null}"#),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert!(json["kennzeichen"].is_null());
    assert!(json["tragenkapazitaet"].is_null());
    assert_eq!(json["opta"], "OPTA-1", "Nachbarfeld unberührt");
}

/// Effektivzustands-Prüfung (Abschnitt 4 des Musters): EIN Stärke-Feld zu patchen ist
/// zulässig, weil der Bestand die anderen zwei trägt — ein naiver Teil-Patch sähe zwei
/// `None` und lehnte mit „Stärke muss vollständig … sein" ab.
#[tokio::test]
async fn patch_ein_staerke_feld_ist_ok_und_laesst_die_anderen_stehen() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let id = fahrzeug_voll(&app, &admin, "Florian 1").await;

    let (status, json) = anfrage(
        &app,
        "PATCH",
        &format!("/api/fahrzeuge/{id}"),
        &admin,
        Some(r#"{"staerke_mannschaft":9}"#),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(json["staerke"]["fuehrer"], 1, "Bestand unberührt");
    assert_eq!(json["staerke"]["unterfuehrer"], 2, "Bestand unberührt");
    assert_eq!(json["staerke"]["mannschaft"], 9);
}

/// Die Invariante bleibt scharf: EIN `null` halbiert das Trio → 400; alle drei `null`
/// leeren es legitim.
#[tokio::test]
async fn patch_halbes_staerke_trio_ist_400_alle_drei_null_ok() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let id = fahrzeug_voll(&app, &admin, "Florian 1").await;

    assert_eq!(
        anfrage(
            &app,
            "PATCH",
            &format!("/api/fahrzeuge/{id}"),
            &admin,
            Some(r#"{"staerke_fuehrer":null}"#)
        )
        .await
        .0,
        StatusCode::BAD_REQUEST
    );
    let (status, json) = anfrage(
        &app,
        "PATCH",
        &format!("/api/fahrzeuge/{id}"),
        &admin,
        Some(r#"{"staerke_fuehrer":null,"staerke_unterfuehrer":null,"staerke_mannschaft":null}"#),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert!(json["staerke"].is_null());
}

/// Statuscode-Konvention (LFH-305): ein VORHANDENER, aber leerer Funkrufname scheitert am
/// Feld selbst → 400. Ein ABSENTER ist kein Wunsch und geht durch.
#[tokio::test]
async fn patch_leerer_funkrufname_ist_400_absenter_laesst_ihn_stehen() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let id = fahrzeug_voll(&app, &admin, "Florian 1").await;

    assert_eq!(
        anfrage(
            &app,
            "PATCH",
            &format!("/api/fahrzeuge/{id}"),
            &admin,
            Some(r#"{"funkrufname":"   "}"#)
        )
        .await
        .0,
        StatusCode::BAD_REQUEST
    );
    let (status, json) = anfrage(
        &app,
        "PATCH",
        &format!("/api/fahrzeuge/{id}"),
        &admin,
        Some(r#"{"opta":"OPTA-2"}"#),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "absentes Pflichtfeld ist zulässig");
    assert_eq!(json["funkrufname"], "Florian 1");
    assert_eq!(json["opta"], "OPTA-2");
}

#[tokio::test]
async fn kein_delete_endpunkt() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let (_, json) = anfrage(
        &app,
        "POST",
        "/api/fahrzeuge",
        &admin,
        Some(r#"{"funkrufname":"Florian 1"}"#),
    )
    .await;
    let id = json["id"].as_i64().unwrap();
    // DELETE existiert nicht → 405 Method Not Allowed (Route ist nur PATCH/POST).
    let (status, _) = anfrage(
        &app,
        "DELETE",
        &format!("/api/fahrzeuge/{id}"),
        &admin,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::METHOD_NOT_ALLOWED);
}
