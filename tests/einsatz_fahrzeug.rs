use axum::http::StatusCode;

mod common;
use common::*;

/// Legt ein Stamm-Fahrzeug an (Admin) und liefert dessen id.
async fn fahrzeug_anlegen(app: &axum::Router, admin: &str, funkrufname: &str) -> i64 {
    let (status, json) = anfrage(
        app,
        "POST",
        "/api/vehicles",
        admin,
        Some(&format!(
            r#"{{"funkrufname":"{funkrufname}","kennzeichen":"XX-AB 1"}}"#
        )),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    json["id"].as_i64().unwrap()
}

/// Disponiert ein Stamm-Fahrzeug in den Einsatz → liefert einsatz_fahrzeug.id.
async fn fahrzeug_disponieren(
    app: &axum::Router,
    admin: &str,
    einsatz: i64,
    funkrufname: &str,
) -> i64 {
    let fz = fahrzeug_anlegen(app, admin, funkrufname).await;
    let (s, json) = anfrage(
        app,
        "POST",
        &format!("/api/incidents/{einsatz}/vehicles"),
        admin,
        Some(&format!(r#"{{"fahrzeug_id":{fz}}}"#)),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED);
    json["id"].as_i64().unwrap()
}

// ---------- Besatzung (LFH-9) ----------

#[tokio::test]
async fn besatzung_zuordnen_freigeben_mit_etb() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let ef = fahrzeug_disponieren(&app, &admin, einsatz, "Florian 1").await;
    let ep = stammpersonal_disponieren(&app, &admin, einsatz, "Anna").await;

    // Vor Zuordnung: freie Kraft (fahrzeug_id null) → erscheint im Frei-Pool-Picker.
    let (_, personal) = anfrage(
        &app,
        "GET",
        &format!("/api/incidents/{einsatz}/personnel"),
        &admin,
        None,
    )
    .await;
    assert!(personal
        .as_array()
        .unwrap()
        .iter()
        .find(|p| p["id"] == ep)
        .unwrap()["fahrzeug_id"]
        .is_null());

    let etb_vor = system_etb_anzahl(&app, &admin, einsatz).await;

    // Zuordnen → 204, fahrzeug_id gesetzt.
    assert_eq!(
        anfrage(
            &app,
            "PUT",
            &format!("/api/incidents/{einsatz}/vehicles/{ef}/crew/{ep}"),
            &admin,
            None
        )
        .await
        .0,
        StatusCode::NO_CONTENT
    );
    let (_, personal2) = anfrage(
        &app,
        "GET",
        &format!("/api/incidents/{einsatz}/personnel"),
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
            .unwrap()["fahrzeug_id"],
        ef
    );

    // Freigeben → 204, wieder frei.
    assert_eq!(
        anfrage(
            &app,
            "DELETE",
            &format!("/api/incidents/{einsatz}/vehicles/{ef}/crew/{ep}"),
            &admin,
            None
        )
        .await
        .0,
        StatusCode::NO_CONTENT
    );
    let (_, personal3) = anfrage(
        &app,
        "GET",
        &format!("/api/incidents/{einsatz}/personnel"),
        &admin,
        None,
    )
    .await;
    assert!(personal3
        .as_array()
        .unwrap()
        .iter()
        .find(|p| p["id"] == ep)
        .unwrap()["fahrzeug_id"]
        .is_null());

    // Zuordnen + Freigeben = je ein append-only System-ETB.
    assert_eq!(
        system_etb_anzahl(&app, &admin, einsatz).await,
        etb_vor + 2,
        "Zuordnen + Freigeben = 2 System-ETB"
    );
}

#[tokio::test]
async fn besatzung_beobachter_darf_nicht_zuordnen() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let ef = fahrzeug_disponieren(&app, &admin, einsatz, "Florian 1").await;
    let ep = stammpersonal_disponieren(&app, &admin, einsatz, "Anna").await;

    let erika_id = benutzer_anlegen(&app, &admin, "erika", "keine").await;
    rolle_setzen(&app, &admin, einsatz, erika_id, "beobachter").await;
    let erika = login_cookie(&app, "erika", "erikapw1").await;
    // Schreibrecht-Gating (MODUL_KEY=fahrzeuge): Beobachter darf nicht zuordnen.
    assert_eq!(
        anfrage(
            &app,
            "PUT",
            &format!("/api/incidents/{einsatz}/vehicles/{ef}/crew/{ep}"),
            &erika,
            None
        )
        .await
        .0,
        StatusCode::FORBIDDEN
    );
}

#[tokio::test]
async fn fahrzeug_entfernen_gibt_besatzung_frei() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let ef = fahrzeug_disponieren(&app, &admin, einsatz, "Florian 1").await;
    let ep = stammpersonal_disponieren(&app, &admin, einsatz, "Anna").await;
    assert_eq!(
        anfrage(
            &app,
            "PUT",
            &format!("/api/incidents/{einsatz}/vehicles/{ef}/crew/{ep}"),
            &admin,
            None
        )
        .await
        .0,
        StatusCode::NO_CONTENT
    );

    // Fahrzeug entlassen → 200 (LLH-1079); die Kraft bleibt frei.
    assert_eq!(
        anfrage(
            &app,
            "POST",
            &format!("/api/incidents/{einsatz}/vehicles/{ef}/stand-down"),
            &admin,
            None
        )
        .await
        .0,
        StatusCode::OK
    );
    let (_, personal) = anfrage(
        &app,
        "GET",
        &format!("/api/incidents/{einsatz}/personnel"),
        &admin,
        None,
    )
    .await;
    assert!(
        personal
            .as_array()
            .unwrap()
            .iter()
            .find(|p| p["id"] == ep)
            .unwrap()["fahrzeug_id"]
            .is_null(),
        "Besatzung wird beim Fahrzeug-Entfernen frei, nicht gelöscht"
    );
}

// ---------- Tests ----------

#[tokio::test]
async fn disponieren_stamm_setzt_status_und_schreibt_etb() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let fz = fahrzeug_anlegen(&app, &admin, "Florian 1").await;

    let (status, json) = anfrage(
        &app,
        "POST",
        &format!("/api/incidents/{einsatz}/vehicles"),
        &admin,
        Some(&format!(r#"{{"fahrzeug_id":{fz}}}"#)),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    assert_eq!(json["funkrufname"], "Florian 1");
    assert_eq!(json["status_kategorie"], "gebunden");
    assert_eq!(json["ist_adhoc"], false);

    assert_eq!(
        system_etb_anzahl(&app, &admin, einsatz).await,
        1,
        "Disponieren schreibt 1 System-ETB"
    );
}

/// Ein Stamm-Fahrzeug außer Dienst ist ein Zustand: 422 wie bei der Person (`src/AGENTS.md`,
/// Statuscode-Konvention; bis LLH-1100 war es 400), ohne ETB-Eintrag.
#[tokio::test]
async fn stamm_fahrzeug_ausser_dienst_ist_422() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let fz = fahrzeug_anlegen(&app, &admin, "Florian 1").await;
    let (s, _) = anfrage(
        &app,
        "POST",
        &format!("/api/vehicles/{fz}/out-of-service"),
        &admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    let (s, json) = anfrage(
        &app,
        "POST",
        &format!("/api/incidents/{einsatz}/vehicles"),
        &admin,
        Some(&format!(r#"{{"fahrzeug_id":{fz}}}"#)),
    )
    .await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY, "{json}");
    assert_eq!(
        json["error"],
        "Fahrzeug ist außer Dienst und kann nicht disponiert werden"
    );
    assert_eq!(system_etb_anzahl(&app, &admin, einsatz).await, 0);
}

#[tokio::test]
async fn doppelte_stamm_disposition_ist_409() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let fz = fahrzeug_anlegen(&app, &admin, "Florian 1").await;
    let body = format!(r#"{{"fahrzeug_id":{fz}}}"#);
    assert_eq!(
        anfrage(
            &app,
            "POST",
            &format!("/api/incidents/{einsatz}/vehicles"),
            &admin,
            Some(&body)
        )
        .await
        .0,
        StatusCode::CREATED
    );
    assert_eq!(
        anfrage(
            &app,
            "POST",
            &format!("/api/incidents/{einsatz}/vehicles"),
            &admin,
            Some(&body)
        )
        .await
        .0,
        StatusCode::CONFLICT
    );
}

#[tokio::test]
async fn adhoc_disposition_ohne_stamm() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;

    let (status, json) = anfrage(
        &app,
        "POST",
        &format!("/api/incidents/{einsatz}/vehicles"),
        &admin,
        Some(r#"{"adhoc":{"funkrufname":"FW Extern 1","traegerorganisation":"Feuerwehr"}}"#),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    assert_eq!(json["ist_adhoc"], true);
    assert!(json["fahrzeug_id"].is_null());
}

#[tokio::test]
async fn beobachter_darf_lesen_aber_nicht_disponieren() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let erika_id = benutzer_anlegen(&app, &admin, "erika", "keine").await;
    rolle_setzen(&app, &admin, einsatz, erika_id, "beobachter").await;
    let erika = login_cookie(&app, "erika", "erikapw1").await;

    // Lesen erlaubt.
    assert_eq!(
        anfrage(
            &app,
            "GET",
            &format!("/api/incidents/{einsatz}/vehicles"),
            &erika,
            None
        )
        .await
        .0,
        StatusCode::OK
    );
    // Disponieren verboten.
    let fz = fahrzeug_anlegen(&app, &admin, "Florian 1").await;
    let (status, _) = anfrage(
        &app,
        "POST",
        &format!("/api/incidents/{einsatz}/vehicles"),
        &erika,
        Some(&format!(r#"{{"fahrzeug_id":{fz}}}"#)),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn fuehrungspersonal_darf_disponieren_nicht_mitglied_nicht() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let fz = fahrzeug_anlegen(&app, &admin, "Florian 1").await;

    // Führungspersonal darf.
    let f_id = benutzer_anlegen(&app, &admin, "fritz", "keine").await;
    rolle_setzen(&app, &admin, einsatz, f_id, "fuehrungspersonal").await;
    let fritz = login_cookie(&app, "fritz", "fritzpw1").await;
    assert_eq!(
        anfrage(
            &app,
            "POST",
            &format!("/api/incidents/{einsatz}/vehicles"),
            &fritz,
            Some(&format!(r#"{{"fahrzeug_id":{fz}}}"#))
        )
        .await
        .0,
        StatusCode::CREATED
    );

    // Nicht-Mitglied (ohne höhere Berechtigung) darf weder lesen noch schreiben.
    benutzer_anlegen(&app, &admin, "norbert", "keine").await;
    let norbert = login_cookie(&app, "norbert", "norbertpw1").await;
    assert_eq!(
        anfrage(
            &app,
            "GET",
            &format!("/api/incidents/{einsatz}/vehicles"),
            &norbert,
            None
        )
        .await
        .0,
        StatusCode::FORBIDDEN
    );
}

#[tokio::test]
async fn disponieren_auf_abgeschlossenem_einsatz_ist_409() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let fz = fahrzeug_anlegen(&app, &admin, "Florian 1").await;
    assert_eq!(
        anfrage(
            &app,
            "POST",
            &format!("/api/incidents/{einsatz}/close"),
            &admin,
            None
        )
        .await
        .0,
        StatusCode::OK
    );

    let (status, _) = anfrage(
        &app,
        "POST",
        &format!("/api/incidents/{einsatz}/vehicles"),
        &admin,
        Some(&format!(r#"{{"fahrzeug_id":{fz}}}"#)),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT);
}

#[tokio::test]
async fn status_wechsel_und_entfernen_schreiben_etb() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let fz = fahrzeug_anlegen(&app, &admin, "Florian 1").await;
    let (_, json) = anfrage(
        &app,
        "POST",
        &format!("/api/incidents/{einsatz}/vehicles"),
        &admin,
        Some(&format!(r#"{{"fahrzeug_id":{fz}}}"#)),
    )
    .await;
    let ef = json["id"].as_i64().unwrap();

    // Anderen 'gebunden'-Status aus dem Seed holen ('4 – Am Einsatzort').
    let (_, stati) = anfrage(&app, "GET", "/api/vehicle-statuses", &admin, None).await;
    let am_einsatzort = stati
        .as_array()
        .unwrap()
        .iter()
        .find(|s| s["label"] == "4 – Am Einsatzort")
        .unwrap()["id"]
        .as_i64()
        .unwrap();

    let (status, _) = anfrage(
        &app,
        "PATCH",
        &format!("/api/incidents/{einsatz}/vehicles/{ef}"),
        &admin,
        Some(&format!(r#"{{"status_id":{am_einsatzort}}}"#)),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    let (status, _) = anfrage(
        &app,
        "POST",
        &format!("/api/incidents/{einsatz}/vehicles/{ef}/stand-down"),
        &admin,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    // Disponieren + Status-Wechsel + Entlassen = 3 System-Einträge.
    assert_eq!(system_etb_anzahl(&app, &admin, einsatz).await, 3);
}

#[tokio::test]
async fn bemerkung_setzen_und_leeren() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let fz = fahrzeug_anlegen(&app, &admin, "Florian 1").await;
    let (_, json) = anfrage(
        &app,
        "POST",
        &format!("/api/incidents/{einsatz}/vehicles"),
        &admin,
        Some(&format!(r#"{{"fahrzeug_id":{fz}}}"#)),
    )
    .await;
    let ef = json["id"].as_i64().unwrap();

    // Setzen.
    let (_, gesetzt) = anfrage(
        &app,
        "PATCH",
        &format!("/api/incidents/{einsatz}/vehicles/{ef}"),
        &admin,
        Some(r#"{"bemerkung":"Tank halb"}"#),
    )
    .await;
    assert_eq!(gesetzt["bemerkung"], "Tank halb");

    // Leeren: leerer String ist der Leerwunsch — die Spalte geht auf NULL, nicht auf "".
    let (_, geleert) = anfrage(
        &app,
        "PATCH",
        &format!("/api/incidents/{einsatz}/vehicles/{ef}"),
        &admin,
        Some(r#"{"bemerkung":""}"#),
    )
    .await;
    assert!(
        geleert["bemerkung"].is_null(),
        "leerer String leert die Spalte auf NULL, nicht auf \"\""
    );

    // status_id absent → Status bleibt; eine reine Bemerkung-Änderung schreibt KEINEN ETB.
    assert_eq!(
        system_etb_anzahl(&app, &admin, einsatz).await,
        1,
        "nur die Disposition selbst"
    );
}

// LFH-4 P2: XOR-Fehlermeldung differenziert both-None vs both-Some.
#[tokio::test]
async fn disponieren_leerer_body_meldet_entweder_oder() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    // Weder fahrzeug_id noch adhoc → "angeben", NICHT "nicht beides".
    let (status, json) = anfrage(
        &app,
        "POST",
        &format!("/api/incidents/{einsatz}/vehicles"),
        &admin,
        Some("{}"),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(
        json["error"],
        "Entweder fahrzeug_id (Stamm) oder adhoc angeben"
    );
}

#[tokio::test]
async fn disponieren_beides_meldet_nicht_beides() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let fz = fahrzeug_anlegen(&app, &admin, "Florian 1").await;
    // fahrzeug_id UND adhoc → "nicht beides".
    let body = format!(r#"{{"fahrzeug_id":{fz},"adhoc":{{"funkrufname":"FW Extern"}}}}"#);
    let (status, json) = anfrage(
        &app,
        "POST",
        &format!("/api/incidents/{einsatz}/vehicles"),
        &admin,
        Some(&body),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(
        json["error"],
        "Entweder fahrzeug_id (Stamm) oder adhoc angeben, nicht beides"
    );
}

// F12-c (LFH-266-Nachzug): `bemerkung` ist nullable und muss per PATCH löschbar sein.
// Tri-State wie in d167778: absent = unverändert, `null`/`""` = leeren, Wert = setzen.
#[tokio::test]
async fn patch_null_leert_bemerkung() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let fz = fahrzeug_anlegen(&app, &admin, "Florian 1").await;
    let (_, json) = anfrage(
        &app,
        "POST",
        &format!("/api/incidents/{einsatz}/vehicles"),
        &admin,
        Some(&format!(r#"{{"fahrzeug_id":{fz}}}"#)),
    )
    .await;
    let ef = json["id"].as_i64().unwrap();

    anfrage(
        &app,
        "PATCH",
        &format!("/api/incidents/{einsatz}/vehicles/{ef}"),
        &admin,
        Some(r#"{"bemerkung":"Tank halb"}"#),
    )
    .await;
    let (_, geleert) = anfrage(
        &app,
        "PATCH",
        &format!("/api/incidents/{einsatz}/vehicles/{ef}"),
        &admin,
        Some(r#"{"bemerkung":null}"#),
    )
    .await;
    assert!(
        geleert["bemerkung"].is_null(),
        "explizites null muss die Bemerkung löschen"
    );
}

#[tokio::test]
async fn patch_leerstring_leert_bemerkung() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let fz = fahrzeug_anlegen(&app, &admin, "Florian 1").await;
    let (_, json) = anfrage(
        &app,
        "POST",
        &format!("/api/incidents/{einsatz}/vehicles"),
        &admin,
        Some(&format!(r#"{{"fahrzeug_id":{fz}}}"#)),
    )
    .await;
    let ef = json["id"].as_i64().unwrap();

    anfrage(
        &app,
        "PATCH",
        &format!("/api/incidents/{einsatz}/vehicles/{ef}"),
        &admin,
        Some(r#"{"bemerkung":"Tank halb"}"#),
    )
    .await;
    let (_, geleert) = anfrage(
        &app,
        "PATCH",
        &format!("/api/incidents/{einsatz}/vehicles/{ef}"),
        &admin,
        Some(r#"{"bemerkung":"   "}"#),
    )
    .await;
    assert!(
        geleert["bemerkung"].is_null(),
        "whitespace-only zählt als Leerwunsch (trimme_tri), nicht als Wert"
    );
}

#[tokio::test]
async fn patch_ohne_bemerkung_laesst_sie_stehen() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let fz = fahrzeug_anlegen(&app, &admin, "Florian 1").await;
    let (_, json) = anfrage(
        &app,
        "POST",
        &format!("/api/incidents/{einsatz}/vehicles"),
        &admin,
        Some(&format!(r#"{{"fahrzeug_id":{fz}}}"#)),
    )
    .await;
    let ef = json["id"].as_i64().unwrap();

    anfrage(
        &app,
        "PATCH",
        &format!("/api/incidents/{einsatz}/vehicles/{ef}"),
        &admin,
        Some(r#"{"bemerkung":"Tank halb"}"#),
    )
    .await;
    let (_, unberuehrt) = anfrage(
        &app,
        "PATCH",
        &format!("/api/incidents/{einsatz}/vehicles/{ef}"),
        &admin,
        Some(r#"{}"#),
    )
    .await;
    assert_eq!(
        unberuehrt["bemerkung"], "Tank halb",
        "absentes Feld lässt die Bemerkung unverändert"
    );
}

// LFH-609: `status_seit` ist der Zeitpunkt des letzten ECHTEN Statuswechsels. Um „bleibt"
// von „springt" unterscheiden zu können, wird der Wert per SQL auf einen alten Zeitpunkt
// gesetzt — `datetime('now')` zweier Aufrufe in derselben Sekunde wäre sonst gleich.
#[tokio::test]
async fn status_seit_nur_bei_echtem_statuswechsel() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let fz = fahrzeug_anlegen(&app, &admin, "Florian 1").await;
    let (_, json) = anfrage(
        &app,
        "POST",
        &format!("/api/incidents/{einsatz}/vehicles"),
        &admin,
        Some(&format!(r#"{{"fahrzeug_id":{fz}}}"#)),
    )
    .await;
    let ef = json["id"].as_i64().unwrap();
    let start_status = json["status_id"].as_i64().unwrap();
    assert!(
        json["status_seit"].is_string(),
        "Disponieren setzt den Initialstatus und damit „Seit“"
    );

    let alt = "2000-01-01 00:00:00";
    let setze_alt = || async {
        sqlx::query("UPDATE einsatz_fahrzeug SET status_seit = ? WHERE id = ?")
            .bind(alt)
            .bind(ef)
            .execute(&pool)
            .await
            .unwrap();
    };
    let patch = |body: String| {
        let app = app.clone();
        let admin = admin.clone();
        async move {
            let (s, j) = anfrage(
                &app,
                "PATCH",
                &format!("/api/incidents/{einsatz}/vehicles/{ef}"),
                &admin,
                Some(&body),
            )
            .await;
            assert_eq!(s, StatusCode::OK);
            j
        }
    };

    // Nur Bemerkung → bleibt.
    setze_alt().await;
    let j = patch(r#"{"bemerkung":"x"}"#.into()).await;
    assert_eq!(j["status_seit"], alt, "Bemerkung ist kein Statuswechsel");

    // Gleicher Status → bleibt.
    let j = patch(format!(r#"{{"status_id":{start_status}}}"#)).await;
    assert_eq!(j["status_seit"], alt, "derselbe Status ist kein Wechsel");

    // Anderer Status → springt.
    let (_, stati) = anfrage(&app, "GET", "/api/vehicle-statuses", &admin, None).await;
    let anderer = stati
        .as_array()
        .unwrap()
        .iter()
        .map(|s| s["id"].as_i64().unwrap())
        .find(|id| *id != start_status)
        .unwrap();
    let j = patch(format!(r#"{{"status_id":{anderer}}}"#)).await;
    let seit = j["status_seit"].as_str().unwrap();
    assert!(seit > alt, "echter Wechsel setzt „Seit“ neu, war {seit}");
}

// ---------- Fremd-Ereignisse (LLH-1182) ----------

const FREMD: &[(&str, &str)] = &[
    ("einheit", "einheit_id"),
    ("personal", "personal_id"),
    ("bereitstellungsraum", "br_id"),
];

fn ereignis(tag: &str, id: i64) -> (String, i64) {
    (tag.to_string(), id)
}

async fn in_einheit(app: &axum::Router, cookie: &str, einsatz: i64, ef: i64) -> i64 {
    let einheit = einheit_bilden(app, cookie, einsatz, "1. Zug").await;
    let (s, _) = anfrage(
        app,
        "PUT",
        &format!("/api/incidents/{einsatz}/units/{einheit}/vehicles/{ef}"),
        cookie,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::NO_CONTENT, "Fahrzeug der Einheit zuordnen");
    einheit
}

/// Das Entfernen nimmt der Einheit ein Mitglied (und ändert ihren abgeleiteten Status), löst die
/// Besatzung (`fahrzeug_id` → NULL in der Personalliste) und nimmt das Fahrzeug aus dem Detail
/// seines Bereitstellungsraums. `fahrzeug` erreicht Einheiten- und Personalleser ohne Fahrzeugrecht
/// nicht und invalidiert das BR-Detail nicht; `einheit`, je Kraft `personal` und
/// `bereitstellungsraum` tragen es, aber nur, wenn das Fahrzeug dort stand.
#[tokio::test]
async fn entfernen_feuert_einheit_und_personal_nur_bei_betroffenem_fahrzeug() {
    let (app, live) = setup_mit_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let frei = fahrzeug_disponieren(&app, &admin, einsatz, "Florian 1").await;
    let im_zug = fahrzeug_disponieren(&app, &admin, einsatz, "Florian 2").await;
    let besetzt = fahrzeug_disponieren(&app, &admin, einsatz, "Florian 3").await;
    let einheit = in_einheit(&app, &admin, einsatz, im_zug).await;
    let ep = stammpersonal_disponieren(&app, &admin, einsatz, "Maschinist").await;
    let (s, _) = anfrage(
        &app,
        "PUT",
        &format!("/api/incidents/{einsatz}/vehicles/{besetzt}/crew/{ep}"),
        &admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::NO_CONTENT, "Besatzung zuordnen");
    let im_br = fahrzeug_disponieren(&app, &admin, einsatz, "Florian 4").await;
    let (s, json) = anfrage(
        &app,
        "POST",
        &format!("/api/incidents/{einsatz}/staging-areas"),
        &admin,
        Some(r#"{"bezeichnung":"BR Nord"}"#),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{json}");
    let br = json["id"].as_i64().unwrap();
    for (pfad, body) in [
        ("status".to_string(), r#"{"status":"aktiv"}"#.to_string()),
        (
            "occupancy".to_string(),
            format!(r#"{{"objekt_typ":"fahrzeug","objekt_id":{im_br},"art":"eintritt"}}"#),
        ),
    ] {
        let (s, json) = anfrage(
            &app,
            "POST",
            &format!("/api/incidents/{einsatz}/staging-areas/{br}/{pfad}"),
            &admin,
            Some(&body),
        )
        .await;
        assert!(s.is_success(), "{pfad}: {s} {json}");
    }

    let mut rx = live.abonniere(einsatz);
    let entfernen = |ef: i64| {
        let (app, admin) = (app.clone(), admin.clone());
        async move {
            anfrage(
                &app,
                "POST",
                &format!("/api/incidents/{einsatz}/vehicles/{ef}/stand-down"),
                &admin,
                None,
            )
            .await
            .0
        }
    };

    assert_eq!(entfernen(frei).await, StatusCode::OK);
    assert_eq!(objekt_ereignisse(&mut rx, FREMD), vec![], "ohne Bezug");
    assert_eq!(entfernen(im_zug).await, StatusCode::OK);
    assert_eq!(
        objekt_ereignisse(&mut rx, FREMD),
        vec![ereignis("einheit", einheit)],
        "Mitglied der Einheit"
    );
    assert_eq!(entfernen(besetzt).await, StatusCode::OK);
    assert_eq!(
        objekt_ereignisse(&mut rx, FREMD),
        vec![ereignis("personal", ep)],
        "Besatzung gelöst"
    );
    assert_eq!(entfernen(im_br).await, StatusCode::OK);
    assert_eq!(
        objekt_ereignisse(&mut rx, FREMD),
        vec![ereignis("bereitstellungsraum", br)],
        "Fahrzeug im Bereitstellungsraum"
    );
}

/// Der Status einer Einheit leitet sich aus ihren Fahrzeugen ab, und ihre Mitgliederliste zeigt
/// den Status jedes Fahrzeugs (LFH-609). Ein Statuswechsel meldet `einheit` genau dann, wenn das
/// Fahrzeug in einer Einheit steht und sich der Status ändert, nicht bei der Bemerkung.
#[tokio::test]
async fn statuswechsel_feuert_einheit_nur_fuer_fahrzeug_einer_einheit() {
    let (app, live) = setup_mit_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let frei = fahrzeug_disponieren(&app, &admin, einsatz, "Florian 1").await;
    let im_zug = fahrzeug_disponieren(&app, &admin, einsatz, "Florian 2").await;
    let einheit = in_einheit(&app, &admin, einsatz, im_zug).await;
    let (_, stati) = anfrage(&app, "GET", "/api/vehicle-statuses", &admin, None).await;
    let am_einsatzort = stati
        .as_array()
        .unwrap()
        .iter()
        .find(|s| s["label"] == "4 – Am Einsatzort")
        .unwrap()["id"]
        .as_i64()
        .unwrap();

    let mut rx = live.abonniere(einsatz);
    let patch = |ef: i64, body: String| {
        let (app, admin) = (app.clone(), admin.clone());
        async move {
            anfrage(
                &app,
                "PATCH",
                &format!("/api/incidents/{einsatz}/vehicles/{ef}"),
                &admin,
                Some(&body),
            )
            .await
            .0
        }
    };
    let status = format!(r#"{{"status_id":{am_einsatzort}}}"#);

    assert_eq!(patch(frei, status.clone()).await, StatusCode::OK);
    assert_eq!(objekt_ereignisse(&mut rx, FREMD), vec![], "freies Fahrzeug");
    assert_eq!(patch(im_zug, status.clone()).await, StatusCode::OK);
    assert_eq!(
        objekt_ereignisse(&mut rx, FREMD),
        vec![ereignis("einheit", einheit)],
        "Status eines Einheitsfahrzeugs"
    );
    assert_eq!(patch(im_zug, status).await, StatusCode::OK);
    assert_eq!(objekt_ereignisse(&mut rx, FREMD), vec![], "gleicher Status");
    assert_eq!(
        patch(im_zug, r#"{"bemerkung":"Pumpe defekt"}"#.into()).await,
        StatusCode::OK
    );
    assert_eq!(objekt_ereignisse(&mut rx, FREMD), vec![], "nur Bemerkung");
}

// ── Entlassen statt löschen (LLH-1079 Teil II, Spec `kraefte-entlassung`) ────────────────

async fn aktion(
    app: &axum::Router,
    cookie: &str,
    einsatz: i64,
    ef: i64,
    was: &str,
) -> (StatusCode, serde_json::Value) {
    anfrage(
        app,
        "POST",
        &format!("/api/incidents/{einsatz}/vehicles/{ef}/{was}"),
        cookie,
        None,
    )
    .await
}

async fn funkrufnamen(app: &axum::Router, cookie: &str, einsatz: i64, query: &str) -> Vec<String> {
    let (s, json) = anfrage(
        app,
        "GET",
        &format!("/api/incidents/{einsatz}/vehicles{query}"),
        cookie,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{json}");
    json.as_array()
        .unwrap()
        .iter()
        .map(|f| f["funkrufname"].as_str().unwrap().to_string())
        .collect()
}

/// Das entlassene Fahrzeug bleibt mit Zeitpunkt und entlassender Person, fehlt in der Liste und
/// steht unter `?entlassene=1`; jeder Schreibweg an ihm ist 409, das Disponieren des Stamm-
/// Fahrzeugs holt dieselbe Zeile zurück. Das alte Löschen gibt es nicht mehr.
#[tokio::test]
async fn fahrzeug_entlassen_und_erneut_disponieren() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let fz = fahrzeug_anlegen(&app, &admin, "Florian 1").await;
    let (_, json) = anfrage(
        &app,
        "POST",
        &format!("/api/incidents/{einsatz}/vehicles"),
        &admin,
        Some(&format!(r#"{{"fahrzeug_id":{fz}}}"#)),
    )
    .await;
    let ef = json["id"].as_i64().unwrap();
    fahrzeug_disponieren(&app, &admin, einsatz, "Florian 2").await;

    let (s, json) = aktion(&app, &admin, einsatz, ef, "stand-down").await;
    assert_eq!(s, StatusCode::OK, "{json}");
    assert_eq!(json["fahrzeug"]["beendet_als"], "entlassen");
    assert!(json["fahrzeug"]["beendet_at"].is_string() && json["fahrzeug"]["beendet_von"].is_i64());
    assert_eq!(funkrufnamen(&app, &admin, einsatz, "").await, ["Florian 2"]);
    assert_eq!(
        funkrufnamen(&app, &admin, einsatz, "?entlassene=1").await,
        ["Florian 1"]
    );
    assert!(system_etb_inhalte(&app, &admin, einsatz)
        .await
        .iter()
        .any(|t| t == "Fahrzeug «Florian 1» aus dem Einsatz entlassen"));

    assert_eq!(
        aktion(&app, &admin, einsatz, ef, "stand-down").await.0,
        StatusCode::CONFLICT
    );
    assert_eq!(
        aktion(&app, &admin, einsatz, ef, "annul").await.0,
        StatusCode::CONFLICT
    );
    for (methode, pfad, body) in [
        ("PATCH", format!("vehicles/{ef}"), r#"{"bemerkung":"x"}"#),
        (
            "PATCH",
            format!("vehicles/{ef}/position"),
            r#"{"lat":52.0,"lon":10.0}"#,
        ),
    ] {
        let (s, json) = anfrage(
            &app,
            methode,
            &format!("/api/incidents/{einsatz}/{pfad}"),
            &admin,
            Some(body),
        )
        .await;
        assert_eq!(s, StatusCode::CONFLICT, "{methode} {pfad}: {json}");
    }
    let (s, _) = anfrage(
        &app,
        "DELETE",
        &format!("/api/incidents/{einsatz}/vehicles/{ef}"),
        &admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::METHOD_NOT_ALLOWED, "kein Löschweg mehr");

    // D7: das Stamm-Fahrzeug erneut disponieren trifft dieselbe Zeile.
    let (s, json) = anfrage(
        &app,
        "POST",
        &format!("/api/incidents/{einsatz}/vehicles"),
        &admin,
        Some(&format!(r#"{{"fahrzeug_id":{fz}}}"#)),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{json}");
    assert_eq!(json["id"], ef);
    assert!(json.get("beendet_als").is_none_or(|v| v.is_null()));
    assert!(system_etb_inhalte(&app, &admin, einsatz)
        .await
        .iter()
        .any(|t| t == "Fahrzeug «Florian 1» erneut disponiert"));
    assert_eq!(
        aktion(&app, &admin, einsatz, ef, "reactivate").await.0,
        StatusCode::CONFLICT,
        "ein aktives Fahrzeug wird nicht reaktiviert"
    );
}

/// LLH-1722 (Spec `kraefte-entlassung`, „Entlassung eines Fahrzeugs zurücknehmen“): Nach
/// „Entlassen“ und „Rückgängig“ steht das Fahrzeug im selben Zustand wie vorher — Status samt
/// „Status seit“, Einheit, Besatzung. Ein zweites Rücknehmen und eines nach „Erneut disponieren“
/// sind 409.
#[tokio::test]
async fn fahrzeug_entlassen_und_zuruecknehmen_ergibt_denselben_zustand() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let ef = fahrzeug_disponieren(&app, &admin, einsatz, "83-1").await;
    let einheit = einheit_bilden(&app, &admin, einsatz, "Zug 1").await;
    let ep = stammpersonal_disponieren(&app, &admin, einsatz, "Anna Müller").await;
    for (methode, pfad) in [
        ("PUT", format!("units/{einheit}/vehicles/{ef}")),
        ("PUT", format!("vehicles/{ef}/crew/{ep}")),
    ] {
        let (s, j) = anfrage(
            &app,
            methode,
            &format!("/api/incidents/{einsatz}/{pfad}"),
            &admin,
            None,
        )
        .await;
        assert!(s.is_success(), "{pfad}: {j}");
    }
    let (_, stati) = anfrage(&app, "GET", "/api/vehicle-statuses", &admin, None).await;
    let s2 = stati
        .as_array()
        .unwrap()
        .iter()
        .find(|s| s["label"].as_str().unwrap().starts_with("2"))
        .unwrap()["id"]
        .as_i64()
        .unwrap();
    let (s, _) = anfrage(
        &app,
        "PATCH",
        &format!("/api/incidents/{einsatz}/vehicles/{ef}"),
        &admin,
        Some(&format!(r#"{{"status_id":{s2}}}"#)),
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    let stand = |j: &serde_json::Value| {
        (
            j["status_id"].clone(),
            j["status_seit"].clone(),
            j["einheit_id"].clone(),
            j["aktueller_br_id"].clone(),
        )
    };
    let (_, liste) = anfrage(
        &app,
        "GET",
        &format!("/api/incidents/{einsatz}/vehicles"),
        &admin,
        None,
    )
    .await;
    let vorher = stand(
        liste
            .as_array()
            .unwrap()
            .iter()
            .find(|f| f["id"] == ef)
            .unwrap(),
    );
    assert_eq!(vorher.0, s2);

    let (s, entlassen) = aktion(&app, &admin, einsatz, ef, "stand-down").await;
    assert_eq!(s, StatusCode::OK, "{entlassen}");
    assert_eq!(entlassen["fahrzeug"]["beendet_als"], "entlassen");
    assert_eq!(entlassen["vorzustand"]["einheit_id"], einheit);
    assert_eq!(
        entlassen["vorzustand"]["besatzung"],
        serde_json::json!([ep])
    );
    let vorzustand = entlassen["vorzustand"].to_string();

    let (s, json) = anfrage(
        &app,
        "POST",
        &format!("/api/incidents/{einsatz}/vehicles/{ef}/stand-down/undo"),
        &admin,
        Some(&vorzustand),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{json}");
    assert_eq!(json["ausgelassen"], serde_json::json!([]));
    assert_eq!(stand(&json["fahrzeug"]), vorher);
    let (_, personal) = anfrage(
        &app,
        "GET",
        &format!("/api/incidents/{einsatz}/personnel"),
        &admin,
        None,
    )
    .await;
    let anna = personal
        .as_array()
        .unwrap()
        .iter()
        .find(|p| p["id"] == ep)
        .unwrap();
    assert_eq!(anna["fahrzeug_id"], ef);
    assert!(system_etb_inhalte(&app, &admin, einsatz)
        .await
        .iter()
        .any(|t| t == "Fahrzeug «83-1»: Entlassung zurückgenommen"));

    let (s, _) = anfrage(
        &app,
        "POST",
        &format!("/api/incidents/{einsatz}/vehicles/{ef}/stand-down/undo"),
        &admin,
        Some(&vorzustand),
    )
    .await;
    assert_eq!(s, StatusCode::CONFLICT, "schon zurückgenommen");

    let (_, entlassen) = aktion(&app, &admin, einsatz, ef, "stand-down").await;
    assert_eq!(
        aktion(&app, &admin, einsatz, ef, "reactivate").await.0,
        StatusCode::OK
    );
    let (s, _) = anfrage(
        &app,
        "POST",
        &format!("/api/incidents/{einsatz}/vehicles/{ef}/stand-down/undo"),
        &admin,
        Some(&entlassen["vorzustand"].to_string()),
    )
    .await;
    assert_eq!(s, StatusCode::CONFLICT, "nach „Erneut disponieren“");
}

/// design.md D3: Storno direkt nach der Disposition (204, in keiner Liste); nach einem
/// Statuswechsel 422 mit dem Grund. Ein Ad-hoc-Fahrzeug kehrt über `…/reaktivieren` zurück.
#[tokio::test]
async fn fahrzeug_stornieren_und_reaktivieren() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let (_, json) = anfrage(
        &app,
        "POST",
        &format!("/api/incidents/{einsatz}/vehicles"),
        &admin,
        Some(r#"{"adhoc":{"funkrufname":"FW Extern 1"}}"#),
    )
    .await;
    let fehl = json["id"].as_i64().unwrap();
    assert_eq!(
        aktion(&app, &admin, einsatz, fehl, "annul").await.0,
        StatusCode::NO_CONTENT
    );
    assert!(funkrufnamen(&app, &admin, einsatz, "").await.is_empty());
    assert!(funkrufnamen(&app, &admin, einsatz, "?entlassene=1")
        .await
        .is_empty());
    assert!(system_etb_inhalte(&app, &admin, einsatz)
        .await
        .iter()
        .any(|t| t == "Fahrzeug «FW Extern 1» storniert (Fehldisposition)"));
    let (s, json) = aktion(&app, &admin, einsatz, fehl, "reactivate").await;
    assert_eq!(s, StatusCode::OK, "{json}");
    assert_eq!(
        funkrufnamen(&app, &admin, einsatz, "").await,
        ["FW Extern 1"]
    );

    // Ein Statuswechsel ist eine Spur.
    let gewechselt = fahrzeug_disponieren(&app, &admin, einsatz, "Florian 3").await;
    let (_, stati) = anfrage(&app, "GET", "/api/vehicle-statuses", &admin, None).await;
    let anderer = stati
        .as_array()
        .unwrap()
        .iter()
        .find(|s| s["label"].as_str().unwrap().starts_with("4"))
        .unwrap()["id"]
        .as_i64()
        .unwrap();
    let (s, _) = anfrage(
        &app,
        "PATCH",
        &format!("/api/incidents/{einsatz}/vehicles/{gewechselt}"),
        &admin,
        Some(&format!(r#"{{"status_id":{anderer}}}"#)),
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    let (s, json) = aktion(&app, &admin, einsatz, gewechselt, "annul").await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY, "{json}");
    assert!(json["error"]
        .as_str()
        .unwrap_or_default()
        .contains("Status des Fahrzeugs"));
}

/// Jeder Schreibweg anderer Module an einem entlassenen Fahrzeug antwortet 409: Besatzung,
/// Einheit, Bereitstellungsraum, Führungsstelle, neuer Auftragsempfänger.
#[tokio::test]
async fn schreibwege_an_einem_entlassenen_fahrzeug_sind_409() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let ef = fahrzeug_disponieren(&app, &admin, einsatz, "Florian 1").await;
    let ep = stammpersonal_disponieren(&app, &admin, einsatz, "Maschinist").await;
    let einheit = einheit_bilden(&app, &admin, einsatz, "1. Zug").await;
    let (_, json) = anfrage(
        &app,
        "POST",
        &format!("/api/incidents/{einsatz}/staging-areas"),
        &admin,
        Some(r#"{"bezeichnung":"BR Nord"}"#),
    )
    .await;
    let br = json["id"].as_i64().unwrap();
    let (s, _) = anfrage(
        &app,
        "POST",
        &format!("/api/incidents/{einsatz}/staging-areas/{br}/status"),
        &admin,
        Some(r#"{"status":"aktiv"}"#),
    )
    .await;
    assert!(s.is_success());
    assert_eq!(
        aktion(&app, &admin, einsatz, ef, "stand-down").await.0,
        StatusCode::OK
    );

    let belegung = format!(r#"{{"objekt_typ":"fahrzeug","objekt_id":{ef},"art":"eintritt"}}"#);
    let fuehrungsstelle = format!(r#"{{"fahrzeug_ids":[{ef}]}}"#);
    let auftrag = serde_json::json!({
        "auftrag_text": "Deich sichern",
        "empfaenger": [{ "empfaenger_typ": "fahrzeug", "fahrzeug_id": ef }]
    })
    .to_string();
    for (methode, pfad, body) in [
        ("PUT", format!("vehicles/{ef}/crew/{ep}"), None),
        ("PUT", format!("units/{einheit}/vehicles/{ef}"), None),
        (
            "POST",
            format!("staging-areas/{br}/occupancy"),
            Some(belegung),
        ),
        ("PATCH", "command-post".to_string(), Some(fuehrungsstelle)),
        ("POST", "tasks".to_string(), Some(auftrag)),
    ] {
        let (s, json) = anfrage(
            &app,
            methode,
            &format!("/api/incidents/{einsatz}/{pfad}"),
            &admin,
            body.as_deref(),
        )
        .await;
        assert_eq!(s, StatusCode::CONFLICT, "{methode} {pfad}: {json}");
    }
}

// ── Fahrzeuge bearbeiten (LLH-1073 Teil I) ───────────────────────────────────────────────

/// Disponiert ein Ad-hoc-Fahrzeug nur mit Funkrufnamen; liefert die `ef_id`.
async fn adhoc_disponieren(
    app: &axum::Router,
    cookie: &str,
    einsatz: i64,
    funkrufname: &str,
) -> i64 {
    let body = serde_json::json!({ "adhoc": { "funkrufname": funkrufname } }).to_string();
    let (s, json) = anfrage(
        app,
        "POST",
        &format!("/api/incidents/{einsatz}/vehicles"),
        cookie,
        Some(&body),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{json}");
    json["id"].as_i64().unwrap()
}

async fn fahrzeug_patch(
    app: &axum::Router,
    cookie: &str,
    einsatz: i64,
    ef: i64,
    body: &str,
) -> (StatusCode, serde_json::Value) {
    anfrage(
        app,
        "PATCH",
        &format!("/api/incidents/{einsatz}/vehicles/{ef}"),
        cookie,
        Some(body),
    )
    .await
}

/// Die Zeile eines Fahrzeugs aus der Liste (aktive oder mit `?entlassene=1` die entlassenen).
async fn fahrzeug_zeile(
    app: &axum::Router,
    cookie: &str,
    einsatz: i64,
    ef: i64,
) -> serde_json::Value {
    for query in ["", "?entlassene=1"] {
        let (s, json) = anfrage(
            app,
            "GET",
            &format!("/api/incidents/{einsatz}/vehicles{query}"),
            cookie,
            None,
        )
        .await;
        assert_eq!(s, StatusCode::OK, "{json}");
        if let Some(z) = json.as_array().unwrap().iter().find(|f| f["id"] == ef) {
            return z.clone();
        }
    }
    panic!("Fahrzeug {ef} fehlt in der Liste");
}

/// Kennung eines Katalogstatus nach seinem Label.
async fn status_nach_label(app: &axum::Router, cookie: &str, label: &str) -> i64 {
    let (_, stati) = anfrage(app, "GET", "/api/vehicle-statuses", cookie, None).await;
    stati
        .as_array()
        .unwrap()
        .iter()
        .find(|s| s["label"] == label)
        .unwrap_or_else(|| panic!("Status {label} fehlt"))["id"]
        .as_i64()
        .unwrap()
}

/// Spec `eingabegrenzen`, „Ad-hoc-Fahrzeug und Fahrzeugbemerkung sind begrenzt“: jeder der fünf
/// Ad-hoc-Texte höchstens 200 Zeichen beim Disponieren, sonst 400 und weder Fahrzeug noch
/// ETB-Eintrag; 200 Zeichen gehen.
#[tokio::test]
async fn adhoc_texte_ueber_der_grenze_sind_400_und_legen_nichts_an() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let lang = "x".repeat(201);
    for feld in [
        "funkrufname",
        "fahrzeugtyp",
        "kennzeichen",
        "traegerorganisation",
        "opta",
    ] {
        let mut adhoc = serde_json::json!({ "funkrufname": "Florian Extern 1" });
        adhoc[feld] = serde_json::Value::String(lang.clone());
        let body = serde_json::json!({ "adhoc": adhoc }).to_string();
        let (s, json) = anfrage(
            &app,
            "POST",
            &format!("/api/incidents/{einsatz}/vehicles"),
            &admin,
            Some(&body),
        )
        .await;
        assert_eq!(s, StatusCode::BAD_REQUEST, "{feld}: {json}");
        assert!(
            json["error"]
                .as_str()
                .unwrap()
                .contains("darf höchstens 200 Zeichen lang sein"),
            "{feld}: {json}"
        );
    }
    assert!(funkrufnamen(&app, &admin, einsatz, "").await.is_empty());
    assert_eq!(system_etb_anzahl(&app, &admin, einsatz).await, 0);
    adhoc_disponieren(&app, &admin, einsatz, &"y".repeat(200)).await;
}

/// Bemerkung höchstens 2 000 Zeichen; darüber 400, und auch der mitgesendete Status bleibt.
#[tokio::test]
async fn bemerkung_ueber_der_grenze_ist_400_und_schreibt_nichts() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let ef = fahrzeug_disponieren(&app, &admin, einsatz, "Florian 1").await;
    let vorher = fahrzeug_zeile(&app, &admin, einsatz, ef).await;
    let s4 = status_nach_label(&app, &admin, "4 – Am Einsatzort").await;
    let lang = "b".repeat(2_001);
    let (s, json) = fahrzeug_patch(
        &app,
        &admin,
        einsatz,
        ef,
        &format!(r#"{{"bemerkung":"{lang}","status_id":{s4}}}"#),
    )
    .await;
    assert_eq!(s, StatusCode::BAD_REQUEST, "{json}");
    let zeile = fahrzeug_zeile(&app, &admin, einsatz, ef).await;
    assert_eq!(zeile["status_id"], vorher["status_id"]);
    assert!(zeile["bemerkung"].is_null());
    let (s, json) = fahrzeug_patch(
        &app,
        &admin,
        einsatz,
        ef,
        &format!(r#"{{"bemerkung":"{}"}}"#, "b".repeat(2_000)),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{json}");
}

/// Spec `fahrzeug-bearbeitung`, „Angaben eines Ad-hoc-Fahrzeugs ändern“: genau ein ETB-Eintrag
/// nennt jede geänderte Angabe mit alt und neu (leer als „—“), vorn der alte Funkrufname;
/// unverändert gesendet schreibt nichts; leere Felder leeren.
#[tokio::test]
async fn adhoc_angaben_aendern_schreibt_einen_etb_eintrag() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let ef = adhoc_disponieren(&app, &admin, einsatz, "Florian Nachbarstdt 44/1").await;
    let etb_vorher = system_etb_anzahl(&app, &admin, einsatz).await;

    let (s, json) = fahrzeug_patch(
        &app,
        &admin,
        einsatz,
        ef,
        r#"{"funkrufname":"  Florian Nachbarstadt 44/1 ","fahrzeugtyp":"HLF 20"}"#,
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{json}");
    assert_eq!(json["funkrufname"], "Florian Nachbarstadt 44/1");
    assert_eq!(json["fahrzeugtyp"], "HLF 20");
    assert_eq!(
        system_etb_anzahl(&app, &admin, einsatz).await,
        etb_vorher + 1
    );
    let texte = system_etb_inhalte(&app, &admin, einsatz).await;
    assert!(
        texte.iter().any(|t| t
            == "Fahrzeug «Florian Nachbarstdt 44/1»: Funkrufname «Florian Nachbarstdt 44/1» → «Florian Nachbarstadt 44/1», Typ «—» → «HLF 20»"),
        "{texte:?}"
    );
    assert_eq!(
        funkrufnamen(&app, &admin, einsatz, "").await,
        ["Florian Nachbarstadt 44/1"]
    );

    // Kennzeichen, Träger und OPTA setzen, dann leeren (`null` und Leerzeichen).
    let (s, json) = fahrzeug_patch(
        &app,
        &admin,
        einsatz,
        ef,
        r#"{"kennzeichen":"NB-FW 441","traegerorganisation":"FF Nachbarstadt","opta":"FWNB4401"}"#,
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{json}");
    assert_eq!(
        (
            json["kennzeichen"].as_str(),
            json["traegerorganisation"].as_str(),
            json["opta"].as_str()
        ),
        (Some("NB-FW 441"), Some("FF Nachbarstadt"), Some("FWNB4401"))
    );
    let (s, json) = fahrzeug_patch(
        &app,
        &admin,
        einsatz,
        ef,
        r#"{"kennzeichen":null,"traegerorganisation":"  ","opta":""}"#,
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{json}");
    assert!(
        json["kennzeichen"].is_null()
            && json["traegerorganisation"].is_null()
            && json["opta"].is_null(),
        "{json}"
    );
    assert!(system_etb_inhalte(&app, &admin, einsatz)
        .await
        .iter()
        .any(|t| t
            == "Fahrzeug «Florian Nachbarstadt 44/1»: Kennzeichen «NB-FW 441» → «—», Träger «FF Nachbarstadt» → «—», OPTA «FWNB4401» → «—»"));

    // Unverändert gesendet: kein Eintrag. Mit Statuswechsel: nur dessen Eintrag.
    let anzahl = system_etb_anzahl(&app, &admin, einsatz).await;
    let (s, _) = fahrzeug_patch(
        &app,
        &admin,
        einsatz,
        ef,
        r#"{"funkrufname":"Florian Nachbarstadt 44/1","fahrzeugtyp":"HLF 20","kennzeichen":null}"#,
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(system_etb_anzahl(&app, &admin, einsatz).await, anzahl);
    let s4 = status_nach_label(&app, &admin, "4 – Am Einsatzort").await;
    let (s, _) = fahrzeug_patch(
        &app,
        &admin,
        einsatz,
        ef,
        &format!(r#"{{"status_id":{s4},"fahrzeugtyp":"LF 20"}}"#),
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(system_etb_anzahl(&app, &admin, einsatz).await, anzahl + 2);
}

/// Spec `fahrzeug-bearbeitung`, „Angaben eines Stamm-Fahrzeugs bleiben im Stamm“: 422 „im Stamm
/// pflegen“, und nichts aus der Anfrage ist geschrieben, auch kein Status. Eine zu lange Angabe
/// ist auch hier 400 (Spec `eingabegrenzen`, „Grenze vor dem Zusammenhang“).
#[tokio::test]
async fn stamm_angaben_sind_422_und_schreiben_nichts() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let ef = fahrzeug_disponieren(&app, &admin, einsatz, "Florian 1").await;
    let vorher = fahrzeug_zeile(&app, &admin, einsatz, ef).await;
    let etb = system_etb_anzahl(&app, &admin, einsatz).await;
    let s4 = status_nach_label(&app, &admin, "4 – Am Einsatzort").await;
    for body in [
        format!(r#"{{"funkrufname":"Florian 9","status_id":{s4}}}"#),
        r#"{"fahrzeugtyp":"HLF 20","bemerkung":"x"}"#.to_string(),
        r#"{"kennzeichen":null}"#.to_string(),
        r#"{"traegerorganisation":"THW"}"#.to_string(),
        r#"{"opta":"X"}"#.to_string(),
    ] {
        let (s, json) = fahrzeug_patch(&app, &admin, einsatz, ef, &body).await;
        assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY, "{body}: {json}");
        assert!(
            json["error"].as_str().unwrap().contains("im Stamm pflegen"),
            "{json}"
        );
    }
    let zeile = fahrzeug_zeile(&app, &admin, einsatz, ef).await;
    assert_eq!(zeile["funkrufname"], "Florian 1");
    assert_eq!(zeile["kennzeichen"], "XX-AB 1");
    assert_eq!(zeile["status_id"], vorher["status_id"]);
    assert!(zeile["bemerkung"].is_null());
    assert_eq!(system_etb_anzahl(&app, &admin, einsatz).await, etb);

    let (s, json) = fahrzeug_patch(
        &app,
        &admin,
        einsatz,
        ef,
        &format!(r#"{{"kennzeichen":"{}"}}"#, "k".repeat(201)),
    )
    .await;
    assert_eq!(
        s,
        StatusCode::BAD_REQUEST,
        "Grenze vor dem Zusammenhang: {json}"
    );
}

/// Leerer oder `null`-Funkrufname ist 400 (Pflicht), zu lange Angaben auch; an einem entlassenen
/// Fahrzeug ist die Änderung 409.
#[tokio::test]
async fn adhoc_angaben_grenzen_und_entlassenes_fahrzeug() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let ef = adhoc_disponieren(&app, &admin, einsatz, "Florian Extern 1").await;
    let lang = "k".repeat(201);
    for body in [
        r#"{"funkrufname":""}"#.to_string(),
        r#"{"funkrufname":"   "}"#.to_string(),
        r#"{"funkrufname":null}"#.to_string(),
        format!(r#"{{"funkrufname":"{lang}"}}"#),
        format!(r#"{{"fahrzeugtyp":"{lang}"}}"#),
        format!(r#"{{"kennzeichen":"{lang}"}}"#),
        format!(r#"{{"traegerorganisation":"{lang}"}}"#),
        format!(r#"{{"opta":"{lang}"}}"#),
    ] {
        let (s, json) = fahrzeug_patch(&app, &admin, einsatz, ef, &body).await;
        assert_eq!(s, StatusCode::BAD_REQUEST, "{body}: {json}");
    }
    assert_eq!(
        fahrzeug_zeile(&app, &admin, einsatz, ef).await["funkrufname"],
        "Florian Extern 1"
    );
    assert_eq!(
        aktion(&app, &admin, einsatz, ef, "stand-down").await.0,
        StatusCode::OK
    );
    let (s, json) = fahrzeug_patch(
        &app,
        &admin,
        einsatz,
        ef,
        r#"{"funkrufname":"Florian Extern 2"}"#,
    )
    .await;
    assert_eq!(s, StatusCode::CONFLICT, "{json}");
    assert_eq!(
        fahrzeug_zeile(&app, &admin, einsatz, ef).await["funkrufname"],
        "Florian Extern 1"
    );
}

// ── Personal der Einheit als Besatzung übernehmen (LLH-1073 Teil II) ─────────────────────

/// Disponiert eine Ad-hoc-Kraft; liefert die `ep_id`.
async fn adhoc_kraft(app: &axum::Router, cookie: &str, einsatz: i64, name: &str) -> i64 {
    let body = serde_json::json!({ "adhoc": { "name": name } }).to_string();
    let (s, json) = anfrage(
        app,
        "POST",
        &format!("/api/incidents/{einsatz}/personnel"),
        cookie,
        Some(&body),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{json}");
    json["id"].as_i64().unwrap()
}

async fn besatzung_uebernehmen(
    app: &axum::Router,
    cookie: &str,
    einsatz: i64,
    ef: i64,
    ep_ids: &[i64],
) -> (StatusCode, serde_json::Value) {
    let body = serde_json::json!({ "ep_ids": ep_ids }).to_string();
    anfrage(
        app,
        "POST",
        &format!("/api/incidents/{einsatz}/vehicles/{ef}/crew"),
        cookie,
        Some(&body),
    )
    .await
}

async fn fahrzeug_der_person(pool: &sqlx::SqlitePool, ep: i64) -> Option<i64> {
    sqlx::query_scalar("SELECT fahrzeug_id FROM einsatz_personal WHERE id = ?")
        .bind(ep)
        .fetch_one(pool)
        .await
        .unwrap()
}

/// Spec `fahrzeug-bearbeitung`, „Besatzung in einem Schritt übernehmen“, und `eingabegrenzen`,
/// „Dubletten“ (design.md D12): drei Personen in einer Anfrage, eine davon zweimal genannt und
/// vorher auf einem anderen Fahrzeug. Alle sitzen danach auf dem Ziel, genau ein ETB-Eintrag nennt
/// jede einmal, gemeldet werden das Ziel, das verlassene Fahrzeug und jede Person.
#[tokio::test]
async fn besatzung_uebernehmen_ordnet_alle_in_einem_schritt_zu() {
    let (app, pool, live) = setup_mit_pool_und_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let rtw = adhoc_disponieren(&app, &admin, einsatz, "RTW 1").await;
    let ktw = adhoc_disponieren(&app, &admin, einsatz, "KTW 1").await;
    let anna = adhoc_kraft(&app, &admin, einsatz, "Anna").await;
    let berta = adhoc_kraft(&app, &admin, einsatz, "Berta").await;
    let carl = adhoc_kraft(&app, &admin, einsatz, "Carl").await;
    let (s, _) = anfrage(
        &app,
        "PUT",
        &format!("/api/incidents/{einsatz}/vehicles/{ktw}/crew/{carl}"),
        &admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::NO_CONTENT);
    let anzahl = system_etb_anzahl(&app, &admin, einsatz).await;
    let mut rx = live.abonniere(einsatz);

    let (s, json) =
        besatzung_uebernehmen(&app, &admin, einsatz, rtw, &[anna, berta, carl, anna]).await;
    assert_eq!(s, StatusCode::NO_CONTENT, "{json}");
    for ep in [anna, berta, carl] {
        assert_eq!(fahrzeug_der_person(&pool, ep).await, Some(rtw));
    }
    assert_eq!(system_etb_anzahl(&app, &admin, einsatz).await, anzahl + 1);
    let texte = system_etb_inhalte(&app, &admin, einsatz).await;
    assert!(
        texte
            .iter()
            .any(|t| t == "Fahrzeug «RTW 1»: 3 Kräfte als Besatzung zugeordnet: Anna, Berta, Carl"),
        "{texte:?}"
    );
    let mut gemeldet = objekt_ereignisse(
        &mut rx,
        &[("fahrzeug", "fahrzeug_id"), ("personal", "personal_id")],
    );
    gemeldet.sort();
    let mut erwartet = vec![
        ereignis("fahrzeug", rtw),
        ereignis("fahrzeug", ktw),
        ereignis("personal", anna),
        ereignis("personal", berta),
        ereignis("personal", carl),
    ];
    erwartet.sort();
    assert_eq!(gemeldet, erwartet);

    // Wer schon auf dem Ziel sitzt, ändert nichts: kein Eintrag, kein Ereignis.
    let (s, _) = besatzung_uebernehmen(&app, &admin, einsatz, rtw, &[anna]).await;
    assert_eq!(s, StatusCode::NO_CONTENT);
    assert_eq!(system_etb_anzahl(&app, &admin, einsatz).await, anzahl + 1);
    assert_eq!(
        objekt_ereignisse(
            &mut rx,
            &[("fahrzeug", "fahrzeug_id"), ("personal", "personal_id")]
        ),
        vec![]
    );
}

/// Bei einer Person steht der Wortlaut des Einzelwegs im ETB (LLH-1100 D1).
#[tokio::test]
async fn besatzung_uebernehmen_mit_einer_person_im_einzelwortlaut() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let rtw = adhoc_disponieren(&app, &admin, einsatz, "RTW 1").await;
    let anna = adhoc_kraft(&app, &admin, einsatz, "Anna").await;
    let (s, json) = besatzung_uebernehmen(&app, &admin, einsatz, rtw, &[anna]).await;
    assert_eq!(s, StatusCode::NO_CONTENT, "{json}");
    let texte = system_etb_inhalte(&app, &admin, einsatz).await;
    assert!(
        texte
            .iter()
            .any(|t| t == "Fahrzeug «RTW 1»: «Anna» als Besatzung zugeordnet"),
        "{texte:?}"
    );
}

/// Spec `fahrzeug-bearbeitung`, „Eine Person entlassen“: eine entlassene, eine unbekannte und
/// eine Person eines anderen Einsatzes stehen je mit Grund im 422; niemand sitzt danach auf dem
/// Fahrzeug, kein ETB-Eintrag.
#[tokio::test]
async fn besatzung_uebernehmen_mit_entlassener_person_ist_422_und_ordnet_niemanden_zu() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let anderer = einsatz_anlegen_mit(&app, &admin, "Nachbarlage").await;
    let rtw = adhoc_disponieren(&app, &admin, einsatz, "RTW 1").await;
    let anna = adhoc_kraft(&app, &admin, einsatz, "Anna").await;
    let berta = adhoc_kraft(&app, &admin, einsatz, "Berta").await;
    let carl = adhoc_kraft(&app, &admin, einsatz, "Carl").await;
    let fremd = adhoc_kraft(&app, &admin, anderer, "Fremd").await;
    let (s, json) = anfrage(
        &app,
        "POST",
        &format!("/api/incidents/{einsatz}/personnel/{carl}/stand-down"),
        &admin,
        None,
    )
    .await;
    assert!(s.is_success(), "{json}");
    let anzahl = system_etb_anzahl(&app, &admin, einsatz).await;

    let (s, json) = besatzung_uebernehmen(
        &app,
        &admin,
        einsatz,
        rtw,
        &[anna, berta, carl, fremd, 999999],
    )
    .await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY, "{json}");
    assert_eq!(
        json["zeilen"],
        serde_json::json!([
            {"art": "personal", "id": carl, "grund": "entlassen"},
            {"art": "personal", "id": fremd, "grund": "unbekannt"},
            {"art": "personal", "id": 999999, "grund": "unbekannt"},
        ])
    );
    for ep in [anna, berta, carl] {
        assert_eq!(fahrzeug_der_person(&pool, ep).await, None);
    }
    assert_eq!(system_etb_anzahl(&app, &admin, einsatz).await, anzahl);
}

/// Spec `eingabegrenzen`, „51 Personen“: 51 (gezählt vor dem Entdoppeln) und eine leere Liste
/// sind 400, bevor eine Abfrage läuft; ein entlassenes Fahrzeug ist 409, ein unbekanntes 404.
#[tokio::test]
async fn besatzung_uebernehmen_grenzen_und_beendetes_fahrzeug() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let rtw = adhoc_disponieren(&app, &admin, einsatz, "RTW 1").await;
    let anna = adhoc_kraft(&app, &admin, einsatz, "Anna").await;
    let anzahl = system_etb_anzahl(&app, &admin, einsatz).await;

    let (s, json) = besatzung_uebernehmen(&app, &admin, einsatz, rtw, &[anna; 51]).await;
    assert_eq!(s, StatusCode::BAD_REQUEST, "{json}");
    assert!(json["error"].as_str().unwrap().contains("50"), "{json}");
    let (s, json) = besatzung_uebernehmen(&app, &admin, einsatz, rtw, &[]).await;
    assert_eq!(s, StatusCode::BAD_REQUEST, "{json}");
    let (s, json) = besatzung_uebernehmen(&app, &admin, einsatz, 999999, &[anna]).await;
    assert_eq!(s, StatusCode::NOT_FOUND, "{json}");
    assert_eq!(fahrzeug_der_person(&pool, anna).await, None);
    assert_eq!(system_etb_anzahl(&app, &admin, einsatz).await, anzahl);

    let (s, json) = besatzung_uebernehmen(&app, &admin, einsatz, rtw, &[anna; 50]).await;
    assert_eq!(s, StatusCode::NO_CONTENT, "genau 50 mit Dubletten: {json}");
    assert_eq!(fahrzeug_der_person(&pool, anna).await, Some(rtw));
    // Spec `eingabegrenzen`, „Dubletten“: der ETB-Eintrag nennt sie einmal.
    assert_eq!(system_etb_anzahl(&app, &admin, einsatz).await, anzahl + 1);
    let texte = system_etb_inhalte(&app, &admin, einsatz).await;
    assert!(
        texte
            .iter()
            .any(|t| t == "Fahrzeug «RTW 1»: «Anna» als Besatzung zugeordnet"),
        "{texte:?}"
    );

    let ktw = adhoc_disponieren(&app, &admin, einsatz, "KTW 1").await;
    assert_eq!(
        aktion(&app, &admin, einsatz, ktw, "stand-down").await.0,
        StatusCode::OK
    );
    let (s, json) = besatzung_uebernehmen(&app, &admin, einsatz, ktw, &[anna]).await;
    assert_eq!(s, StatusCode::CONFLICT, "{json}");
    assert_eq!(fahrzeug_der_person(&pool, anna).await, Some(rtw));
}

/// Ein Beobachter darf die Besatzung nicht übernehmen (Modul Fahrzeuge, wie der Einzelweg).
#[tokio::test]
async fn besatzung_uebernehmen_ist_dem_beobachter_verwehrt() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let rtw = adhoc_disponieren(&app, &admin, einsatz, "RTW 1").await;
    let anna = adhoc_kraft(&app, &admin, einsatz, "Anna").await;
    let erika = benutzer_anlegen(&app, &admin, "erika", "keine").await;
    rolle_setzen(&app, &admin, einsatz, erika, "beobachter").await;
    let erika_c = login_cookie(&app, "erika", "erikapw1").await;
    let (s, json) = besatzung_uebernehmen(&app, &erika_c, einsatz, rtw, &[anna]).await;
    assert_eq!(s, StatusCode::FORBIDDEN, "{json}");
}

// ── Beladung (LLH-1224, design.md D13) ───────────────────────────────────────────────────

/// Spec `material-modell`, „Ende eines Orts“: ein Fahrzeug mit Beladung lässt sich nicht
/// stornieren (422); beim Entlassen bleibt die Beladung ohne Ort im Einsatz, der ETB-Eintrag des
/// Entlassens nennt die Zahl der Posten, und jeder Posten wird live gemeldet.
#[tokio::test]
async fn beladung_sperrt_den_storno_und_bleibt_beim_entlassen_ohne_ort() {
    let (app, live) = setup_mit_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let ef = fahrzeug_disponieren(&app, &admin, einsatz, "Florian 1/83-1").await;
    let (s, json) = anfrage(
        &app,
        "POST",
        &format!("/api/incidents/{einsatz}/material"),
        &admin,
        Some(&format!(
            r#"{{"adhoc":{{"bezeichnung":"Stromerzeuger"}},"einsatz_fahrzeug_id":{ef}}}"#
        )),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{json}");
    assert_eq!(json["einsatz_fahrzeug_id"], ef);
    assert_eq!(json["art"], "geraet", "Ad-hoc ×1 ist ein Gerät");
    let em = json["id"].as_i64().unwrap();
    assert!(system_etb_inhalte(&app, &admin, einsatz)
        .await
        .iter()
        .any(|t| t == "Material «Stromerzeuger» (×1) disponiert, Ort Fahrzeug «Florian 1/83-1»"));

    let (s, json) = aktion(&app, &admin, einsatz, ef, "annul").await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY, "{json}");
    assert!(
        json["error"]
            .as_str()
            .unwrap_or_default()
            .contains("Fahrzeug hat Material geladen"),
        "{json}"
    );

    let mut rx = live.abonniere(einsatz);
    let (s, json) = aktion(&app, &admin, einsatz, ef, "stand-down").await;
    assert_eq!(s, StatusCode::OK, "{json}");
    assert!(system_etb_inhalte(&app, &admin, einsatz)
        .await
        .iter()
        .any(|t| t
            == "Fahrzeug «Florian 1/83-1» aus dem Einsatz entlassen; Beladung ohne Ort: 1 Posten"),);
    assert_eq!(
        objekt_ereignisse(&mut rx, &[("material", "material_id")]),
        vec![ereignis("material", em)],
        "der Posten wird gemeldet"
    );
    let (_, liste) = anfrage(
        &app,
        "GET",
        &format!("/api/incidents/{einsatz}/material"),
        &admin,
        None,
    )
    .await;
    let zeile = liste
        .as_array()
        .unwrap()
        .iter()
        .find(|m| m["id"] == em)
        .expect("der Posten steht weiter im Einsatz")
        .clone();
    for feld in ["einheit_id", "einsatz_fahrzeug_id", "uhs_id", "br_id"] {
        assert!(
            zeile.get(feld).is_none_or(|v| v.is_null()),
            "{feld}: {zeile}"
        );
    }
}

/// LLH-1924 (Spec `bedien-muster`, „Rückgängig nimmt nichts woanders weg“): das Rückgängig nach
/// „Vom Fahrzeug lösen“ schickt `?nur_wenn_frei=1`. Sitzt die Person inzwischen auf einem anderen
/// Fahrzeug, antwortet der Server 409 und nennt es; ohne den Parameter bleibt das bewusste
/// Umsetzen.
#[tokio::test]
async fn besatzung_zuruecknehmen_nur_wenn_frei() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let a = fahrzeug_disponieren(&app, &admin, einsatz, "83-1").await;
    let b = fahrzeug_disponieren(&app, &admin, einsatz, "83-2").await;
    let ep = stammpersonal_disponieren(&app, &admin, einsatz, "Anna").await;
    let pfad = |ef: i64, q: &str| format!("/api/incidents/{einsatz}/vehicles/{ef}/crew/{ep}{q}");
    let fahrzeug_von = || async {
        let (_, personal) = anfrage(
            &app,
            "GET",
            &format!("/api/incidents/{einsatz}/personnel"),
            &admin,
            None,
        )
        .await;
        personal
            .as_array()
            .unwrap()
            .iter()
            .find(|p| p["id"] == ep)
            .unwrap()["fahrzeug_id"]
            .clone()
    };

    // Frei: das Rückgängig gelingt, auf demselben Fahrzeug noch einmal auch, dann ohne zweiten
    // ETB-Eintrag (Review LLH-1924).
    let (s, j) = anfrage(&app, "PUT", &pfad(a, "?nur_wenn_frei=1"), &admin, None).await;
    assert_eq!(s, StatusCode::NO_CONTENT, "{j}");
    let etb_einmal = system_etb_anzahl(&app, &admin, einsatz).await;
    let (s, j) = anfrage(&app, "PUT", &pfad(a, "?nur_wenn_frei=1"), &admin, None).await;
    assert_eq!(s, StatusCode::NO_CONTENT, "{j}");
    assert_eq!(system_etb_anzahl(&app, &admin, einsatz).await, etb_einmal);

    // Gelöst, inzwischen auf 83-2: das Rückgängig scheitert und nennt das Fahrzeug.
    assert_eq!(
        anfrage(&app, "DELETE", &pfad(a, ""), &admin, None).await.0,
        StatusCode::NO_CONTENT
    );
    assert_eq!(
        anfrage(&app, "PUT", &pfad(b, ""), &admin, None).await.0,
        StatusCode::NO_CONTENT
    );
    let etb_vorher = system_etb_anzahl(&app, &admin, einsatz).await;
    let (s, j) = anfrage(&app, "PUT", &pfad(a, "?nur_wenn_frei=1"), &admin, None).await;
    assert_eq!(s, StatusCode::CONFLICT, "{j}");
    assert_eq!(j["error"], "Anna sitzt inzwischen auf «83-2»");
    assert_eq!(fahrzeug_von().await, b, "bleibt auf 83-2");
    assert_eq!(system_etb_anzahl(&app, &admin, einsatz).await, etb_vorher);

    // Ohne den Parameter: bewusstes Umsetzen wie bisher.
    assert_eq!(
        anfrage(&app, "PUT", &pfad(a, ""), &admin, None).await.0,
        StatusCode::NO_CONTENT
    );
    assert_eq!(fahrzeug_von().await, a);
}

// ── Statuswechsel zurücknehmen (LLH-1781, Spec `fahrzeugstatus-quittung`) ───────────────────

/// Ein Fahrzeug in einer Einheit auf S2, dann ein Wechsel auf einen Status mit Zeitachsen-Marke.
/// Liefert (app, pool, admin, einsatz, ef, einheit, s2, s4, Antwort des Wechsels).
async fn statuswechsel_welt() -> (
    axum::Router,
    sqlx::SqlitePool,
    String,
    i64,
    i64,
    i64,
    i64,
    i64,
    serde_json::Value,
) {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let ef = fahrzeug_disponieren(&app, &admin, einsatz, "85-1").await;
    let einheit = in_einheit(&app, &admin, einsatz, ef).await;
    let (_, stati) = anfrage(&app, "GET", "/api/vehicle-statuses", &admin, None).await;
    let nach_anfang = |p: &str| {
        stati
            .as_array()
            .unwrap()
            .iter()
            .find(|s| s["label"].as_str().unwrap().starts_with(p))
            .unwrap()["id"]
            .as_i64()
            .unwrap()
    };
    let (s2, s4) = (nach_anfang("2"), nach_anfang("4"));
    sqlx::query("UPDATE fahrzeug_status SET zeitachse_marke = 'eintreffen' WHERE id = ?")
        .bind(s4)
        .execute(&pool)
        .await
        .unwrap();
    let (s, _) = fahrzeug_patch(
        &app,
        &admin,
        einsatz,
        ef,
        &format!(r#"{{"status_id":{s2}}}"#),
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    // „Status seit“ von S2 in die Vergangenheit, damit vorher und nachher verschieden sind.
    sqlx::query(
        "UPDATE einsatz_fahrzeug SET status_seit = datetime('now', '-5 minutes') WHERE id = ?",
    )
    .bind(ef)
    .execute(&pool)
    .await
    .unwrap();
    let (s, wechsel) = fahrzeug_patch(
        &app,
        &admin,
        einsatz,
        ef,
        &format!(r#"{{"status_id":{s4}}}"#),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{wechsel}");
    (app, pool, admin, einsatz, ef, einheit, s2, s4, wechsel)
}

async fn status_zuruecknehmen(
    app: &axum::Router,
    cookie: &str,
    einsatz: i64,
    ef: i64,
    beleg: &serde_json::Value,
) -> (StatusCode, serde_json::Value) {
    anfrage(
        app,
        "POST",
        &format!("/api/incidents/{einsatz}/vehicles/{ef}/status/undo"),
        cookie,
        Some(&beleg.to_string()),
    )
    .await
}

/// Ereignisse der Einheit: (Art, gestrichen?).
async fn einheit_ereignisse(pool: &sqlx::SqlitePool, einheit: i64) -> Vec<(String, bool)> {
    sqlx::query_as::<_, (String, bool)>(
        "SELECT art, gestrichen_at IS NOT NULL FROM einsatz_kraft_zeitachse \
         WHERE einheit_id = ? ORDER BY id",
    )
    .bind(einheit)
    .fetch_all(pool)
    .await
    .unwrap()
}

/// Spec „Statuswechsel zurücknehmen“, Szenario „Wechsel und Rückgängig“.
#[tokio::test]
async fn statuswechsel_zuruecknehmen_stellt_status_und_seit_her_und_streicht_das_ereignis() {
    let (app, pool, admin, einsatz, ef, einheit, s2, s4, wechsel) = statuswechsel_welt().await;
    let beleg = wechsel["status_ruecknahme"].clone();
    assert_eq!(beleg["vorher_status_id"], s2);
    assert_eq!(beleg["status_id"], s4);
    // Der Beleg trägt nur Prüfwerte; was zurückkommt, hält der Server selbst fest (D8).
    assert!(beleg.get("ereignis_id").is_none(), "{beleg}");
    let vorher_seit: String =
        sqlx::query_scalar("SELECT status_vorher_seit FROM einsatz_fahrzeug WHERE id = ?")
            .bind(ef)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(
        einheit_ereignisse(&pool, einheit).await,
        vec![("eintreffen".into(), false)]
    );

    let (s, json) = status_zuruecknehmen(&app, &admin, einsatz, ef, &beleg).await;
    assert_eq!(s, StatusCode::OK, "{json}");
    assert_eq!(json["status_id"], s2);
    assert_eq!(json["status_seit"], vorher_seit);
    assert_eq!(
        einheit_ereignisse(&pool, einheit).await,
        vec![("eintreffen".into(), true)]
    );
    let etb = system_etb_inhalte(&app, &admin, einsatz).await;
    assert!(
        etb.iter()
            .any(|t| t.starts_with("Fahrzeug «85-1»: Statuswechsel «")
                && t.ends_with("» zurückgenommen")),
        "{etb:?}"
    );

    // Ein zweites Mal: der Status steht nicht mehr → 409 veraltet.
    let (s, json) = status_zuruecknehmen(&app, &admin, einsatz, ef, &beleg).await;
    assert_eq!(s, StatusCode::CONFLICT);
    assert_eq!(json["grund"], "veraltet", "{json}");
}

/// Ein Wechsel ohne Änderung liefert keinen Beleg.
#[tokio::test]
async fn gleicher_status_liefert_keinen_beleg() {
    let (app, _pool, admin, einsatz, ef, _einheit, _s2, s4, _) = statuswechsel_welt().await;
    let (s, json) = fahrzeug_patch(
        &app,
        &admin,
        einsatz,
        ef,
        &format!(r#"{{"status_id":{s4}}}"#),
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    assert!(json.get("status_ruecknahme").is_none(), "{json}");
    assert_eq!(
        json["status_id"], s4,
        "die Anzeige steht flach in der Antwort"
    );
}

/// Szenario „Inzwischen erneut gewechselt“.
#[tokio::test]
async fn rueckname_nach_erneutem_wechsel_ist_409_und_aendert_nichts() {
    let (app, pool, admin, einsatz, ef, einheit, s2, _s4, wechsel) = statuswechsel_welt().await;
    let (s, _) = fahrzeug_patch(
        &app,
        &admin,
        einsatz,
        ef,
        &format!(r#"{{"status_id":{s2}}}"#),
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    let (s, _) =
        status_zuruecknehmen(&app, &admin, einsatz, ef, &wechsel["status_ruecknahme"]).await;
    assert_eq!(s, StatusCode::CONFLICT);
    assert_eq!(
        fahrzeug_zeile(&app, &admin, einsatz, ef).await["status_id"],
        s2
    );
    assert_eq!(
        einheit_ereignisse(&pool, einheit).await,
        vec![("eintreffen".into(), false)]
    );
}

/// Szenario „Andere Person“.
#[tokio::test]
async fn rueckname_durch_andere_person_ist_409() {
    let (app, _pool, admin, einsatz, ef, _einheit, _s2, s4, wechsel) = statuswechsel_welt().await;
    let id = benutzer_anlegen(&app, &admin, "fritz", "keine").await;
    rolle_setzen(&app, &admin, einsatz, id, "fuehrungspersonal").await;
    let fritz = login_cookie(&app, "fritz", "fritzpw1").await;
    let (s, json) =
        status_zuruecknehmen(&app, &fritz, einsatz, ef, &wechsel["status_ruecknahme"]).await;
    assert_eq!(s, StatusCode::CONFLICT, "{json}");
    assert_eq!(
        fahrzeug_zeile(&app, &admin, einsatz, ef).await["status_id"],
        s4
    );
}

/// Szenario „Nach elf Minuten“.
#[tokio::test]
async fn rueckname_nach_elf_minuten_ist_409() {
    let (app, pool, admin, einsatz, ef, _einheit, _s2, s4, wechsel) = statuswechsel_welt().await;
    sqlx::query(
        "UPDATE einsatz_fahrzeug SET status_seit = datetime('now', '-11 minutes') WHERE id = ?",
    )
    .bind(ef)
    .execute(&pool)
    .await
    .unwrap();
    let seit: String = sqlx::query_scalar("SELECT status_seit FROM einsatz_fahrzeug WHERE id = ?")
        .bind(ef)
        .fetch_one(&pool)
        .await
        .unwrap();
    let mut beleg = wechsel["status_ruecknahme"].clone();
    beleg["status_seit"] = serde_json::json!(seit);
    let (s, json) = status_zuruecknehmen(&app, &admin, einsatz, ef, &beleg).await;
    assert_eq!(s, StatusCode::CONFLICT, "{json}");
    assert_ne!(
        json["grund"], "veraltet",
        "kein CAS-Fall, sondern die Frist"
    );
    assert_eq!(
        fahrzeug_zeile(&app, &admin, einsatz, ef).await["status_id"],
        s4
    );
}

/// Szenario „Zeitachse lässt sich nicht streichen“: nach dem Wechsel kam ein späteres Ereignis
/// dazu, das ohne das Eintreffen die Ordnung bräche; die Rücknahme ist 409 und ändert nichts.
#[tokio::test]
async fn rueckname_scheitert_an_der_zeitachse_und_aendert_nichts() {
    let (app, pool, admin, einsatz, ef, einheit, _s2, s4, wechsel) = statuswechsel_welt().await;
    let (_, stati) = anfrage(&app, "GET", "/api/vehicle-statuses", &admin, None).await;
    let heim = stati
        .as_array()
        .unwrap()
        .iter()
        .find(|s| s["label"].as_str().unwrap().starts_with("1"))
        .unwrap()["id"]
        .as_i64()
        .unwrap();
    sqlx::query("UPDATE fahrzeug_status SET zeitachse_marke = 'entlassung' WHERE id = ?")
        .bind(heim)
        .execute(&pool)
        .await
        .unwrap();
    // Die Entlassung der Einheit von Hand, damit der Status S4 bleibt.
    let ereignis: i64 =
        sqlx::query_scalar("SELECT status_ereignis_id FROM einsatz_fahrzeug WHERE id = ?")
            .bind(ef)
            .fetch_one(&pool)
            .await
            .unwrap();
    let admin_id: i64 = sqlx::query_scalar("SELECT id FROM benutzer WHERE benutzername = 'admin'")
        .fetch_one(&pool)
        .await
        .unwrap();
    sqlx::query(
        "INSERT INTO einsatz_kraft_zeitachse (einsatz_id, einheit_id, art, zeitpunkt_at, quelle, erfasst_von) \
         SELECT einsatz_id, einheit_id, 'entlassung', datetime(zeitpunkt_at, '+1 minutes'), 'nachtrag', ? \
         FROM einsatz_kraft_zeitachse WHERE id = ?",
    )
    .bind(admin_id)
    .bind(ereignis)
    .execute(&pool)
    .await
    .unwrap();
    let (s, json) =
        status_zuruecknehmen(&app, &admin, einsatz, ef, &wechsel["status_ruecknahme"]).await;
    assert_eq!(s, StatusCode::CONFLICT, "{json}");
    assert_eq!(
        fahrzeug_zeile(&app, &admin, einsatz, ef).await["status_id"],
        s4
    );
    assert_eq!(
        einheit_ereignisse(&pool, einheit).await,
        vec![("eintreffen".into(), false), ("entlassung".into(), false)]
    );
}

/// Ohne Schreibrecht im Modul: 403, wie beim Wechsel.
#[tokio::test]
async fn rueckname_ohne_schreibrecht_ist_403() {
    let (app, _pool, admin, einsatz, ef, _einheit, _s2, _s4, wechsel) = statuswechsel_welt().await;
    let id = benutzer_anlegen(&app, &admin, "erika", "keine").await;
    rolle_setzen(&app, &admin, einsatz, id, "beobachter").await;
    let erika = login_cookie(&app, "erika", "erikapw1").await;
    let (s, _) =
        status_zuruecknehmen(&app, &erika, einsatz, ef, &wechsel["status_ruecknahme"]).await;
    assert_eq!(s, StatusCode::FORBIDDEN);
}

/// Review vor dem PR: Werte im Beleg außer den Prüfwerten zählen nicht. Ein erfundener Vorzustand
/// und ein fremdes Ereignis ändern nichts an dem, was zurückkommt.
#[tokio::test]
async fn rueckname_glaubt_dem_beleg_keinen_vorzustand() {
    let (app, pool, admin, einsatz, ef, einheit, s2, _s4, wechsel) = statuswechsel_welt().await;
    let vorher_seit: String =
        sqlx::query_scalar("SELECT status_vorher_seit FROM einsatz_fahrzeug WHERE id = ?")
            .bind(ef)
            .fetch_one(&pool)
            .await
            .unwrap();
    let mut beleg = wechsel["status_ruecknahme"].clone();
    beleg["vorher_status_id"] = serde_json::json!(null);
    beleg["vorher_seit"] = serde_json::json!("1970-01-01 00:00:00");
    beleg["ereignis_id"] = serde_json::json!(999_999);
    let (s, json) = status_zuruecknehmen(&app, &admin, einsatz, ef, &beleg).await;
    assert_eq!(s, StatusCode::OK, "{json}");
    assert_eq!(json["status_id"], s2);
    assert_eq!(json["status_seit"], vorher_seit);
    assert_eq!(
        einheit_ereignisse(&pool, einheit).await,
        vec![("eintreffen".into(), true)]
    );
}

/// LLH-1952: Jeder ETB-Eintrag des Fahrzeugmoduls geht als Ereignis `etb` hinaus. `fahrzeug`
/// frischt das Einsatztagebuch nicht auf; ohne das eigene Ereignis sähe ein zweiter Schirm den
/// Eintrag erst nach dem Neuladen.
#[tokio::test]
async fn etb_eintraege_der_fahrzeuge_gehen_live_hinaus() {
    let (app, _pool, live) = setup_mit_pool_und_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let ep = adhoc_kraft(&app, &admin, einsatz, "Anna").await;
    let s4 = status_nach_label(&app, &admin, "4 – Am Einsatzort").await;
    let mut etb = EtbLive::neu(&app, &admin, einsatz, &live).await;

    let ef = adhoc_disponieren(&app, &admin, einsatz, "83-1").await;
    etb.pruefe(&app, &admin, einsatz, "disponieren").await;
    let fehl = adhoc_disponieren(&app, &admin, einsatz, "83-2").await;
    etb.pruefe(&app, &admin, einsatz, "zweites disponieren")
        .await;

    let body = format!(r#"{{"status_id":{s4},"funkrufname":"83-1a"}}"#);
    let (s, json) = fahrzeug_patch(&app, &admin, einsatz, ef, &body).await;
    assert_eq!(s, StatusCode::OK, "{json}");
    etb.pruefe(&app, &admin, einsatz, "Status und Angaben ändern")
        .await;

    let besatzung = format!("/api/incidents/{einsatz}/vehicles/{ef}/crew/{ep}");
    for methode in ["PUT", "DELETE"] {
        let (s, json) = anfrage(&app, methode, &besatzung, &admin, None).await;
        assert_eq!(s, StatusCode::NO_CONTENT, "{methode}: {json}");
        etb.pruefe(&app, &admin, einsatz, methode).await;
    }

    let (s, json) = aktion(&app, &admin, einsatz, ef, "stand-down").await;
    assert_eq!(s, StatusCode::OK, "{json}");
    etb.pruefe(&app, &admin, einsatz, "entlassen").await;
    let (s, json) = anfrage(
        &app,
        "POST",
        &format!("/api/incidents/{einsatz}/vehicles/{ef}/stand-down/undo"),
        &admin,
        Some(&json["vorzustand"].to_string()),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{json}");
    etb.pruefe(&app, &admin, einsatz, "zurücknehmen").await;

    for (fz, was, erwartet) in [
        (ef, "stand-down", StatusCode::OK),
        (ef, "reactivate", StatusCode::OK),
        (fehl, "annul", StatusCode::NO_CONTENT),
    ] {
        let (s, json) = aktion(&app, &admin, einsatz, fz, was).await;
        assert_eq!(s, erwartet, "{was}: {json}");
        etb.pruefe(&app, &admin, einsatz, was).await;
    }
}

// ---------- Feld-CAS an der Disposition (LLH-1945) ----------

async fn fahrzeug_patch_json(
    app: &axum::Router,
    cookie: &str,
    einsatz: i64,
    ef: i64,
    body: serde_json::Value,
) -> (StatusCode, serde_json::Value) {
    anfrage_json(
        app,
        "PATCH",
        &format!("/api/incidents/{einsatz}/vehicles/{ef}"),
        cookie,
        Some(&body),
    )
    .await
}

async fn adhoc_fahrzeug(app: &axum::Router, cookie: &str, einsatz: i64) -> i64 {
    let (s, json) = anfrage(
        app,
        "POST",
        &format!("/api/incidents/{einsatz}/vehicles"),
        cookie,
        Some(r#"{"adhoc":{"funkrufname":"FW Extern 1","traegerorganisation":"Feuerwehr"}}"#),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{json}");
    json["id"].as_i64().unwrap()
}

#[tokio::test]
async fn bemerkung_mit_ueberholtem_altwert_ist_409_und_schreibt_nichts() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let ef = fahrzeug_disponieren(&app, &admin, einsatz, "Florian 1").await;
    fahrzeug_patch_json(
        &app,
        &admin,
        einsatz,
        ef,
        serde_json::json!({"bemerkung": "Tor 3"}),
    )
    .await;
    fahrzeug_patch_json(
        &app,
        &admin,
        einsatz,
        ef,
        serde_json::json!({"bemerkung": "Tor 5"}),
    )
    .await;

    let (s, j) = fahrzeug_patch_json(
        &app,
        &admin,
        einsatz,
        ef,
        serde_json::json!({"bemerkung": "Halle 2", "erwartet": {"bemerkung": "Tor 3"}}),
    )
    .await;
    assert_eq!(s, StatusCode::CONFLICT, "{j:?}");
    assert_eq!(j["grund"], "veraltet", "{j:?}");
    let (_, a) = fahrzeug_patch_json(&app, &admin, einsatz, ef, serde_json::json!({})).await;
    assert_eq!(a["bemerkung"], "Tor 5");

    let (s, j) = fahrzeug_patch_json(
        &app,
        &admin,
        einsatz,
        ef,
        serde_json::json!({"bemerkung": null, "erwartet": {"bemerkung": "Tor 5"}}),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{j:?}");
    assert!(j["bemerkung"].is_null());
}

#[tokio::test]
async fn andere_angabe_des_fahrzeugs_dazwischen_speichert() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let ef = adhoc_fahrzeug(&app, &admin, einsatz).await;
    fahrzeug_patch_json(
        &app,
        &admin,
        einsatz,
        ef,
        serde_json::json!({"kennzeichen": "M-X 1"}),
    )
    .await;
    let (s, j) = fahrzeug_patch_json(
        &app,
        &admin,
        einsatz,
        ef,
        serde_json::json!({"bemerkung": "Tor 3", "erwartet": {"bemerkung": null}}),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{j:?}");
    assert_eq!(j["kennzeichen"], "M-X 1");
    // Die Ad-hoc-Angabe selbst prüft ihren Altwert.
    let (s, j) = fahrzeug_patch_json(
        &app,
        &admin,
        einsatz,
        ef,
        serde_json::json!({"kennzeichen": "M-X 2", "erwartet": {"kennzeichen": null}}),
    )
    .await;
    assert_eq!(s, StatusCode::CONFLICT, "{j:?}");
    let (s, j) = fahrzeug_patch_json(
        &app,
        &admin,
        einsatz,
        ef,
        serde_json::json!({"funkrufname": "FW Extern 2", "erwartet": {"funkrufname": "FW Extern 1"}}),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{j:?}");
}

#[tokio::test]
async fn altwert_ohne_aenderung_der_angabe_ist_422() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let ef = fahrzeug_disponieren(&app, &admin, einsatz, "Florian 1").await;
    let (s, j) = fahrzeug_patch_json(
        &app,
        &admin,
        einsatz,
        ef,
        serde_json::json!({"bemerkung": "Tor 3", "erwartet": {"opta": null}}),
    )
    .await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY, "{j:?}");
}

/// LLH-1976: Die Rücknahme eines Statuswechsels geht als Ereignis `etb` hinaus.
#[tokio::test]
async fn status_ruecknahme_etb_geht_live_hinaus() {
    let (app, _pool, live) = setup_mit_pool_und_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let ef = adhoc_disponieren(&app, &admin, einsatz, "83-1").await;
    let s2 = status_nach_label(&app, &admin, "2 – Frei auf Wache").await;
    let s4 = status_nach_label(&app, &admin, "4 – Am Einsatzort").await;
    let (s, _) = fahrzeug_patch(
        &app,
        &admin,
        einsatz,
        ef,
        &format!(r#"{{"status_id":{s2}}}"#),
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    let (s, wechsel) = fahrzeug_patch(
        &app,
        &admin,
        einsatz,
        ef,
        &format!(r#"{{"status_id":{s4}}}"#),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{wechsel}");
    let mut etb = EtbLive::neu(&app, &admin, einsatz, &live).await;
    let (s, json) =
        status_zuruecknehmen(&app, &admin, einsatz, ef, &wechsel["status_ruecknahme"]).await;
    assert_eq!(s, StatusCode::OK, "{json}");
    etb.pruefe(&app, &admin, einsatz, "Statuswechsel zurücknehmen")
        .await;
}

// ---------- Positionsquelle und Ortung (LLH-2091) ----------

/// Ein PATCH nur der taktischen Zeichen lässt Quelle und Zeitpunkt einer Einwurf-Position stehen
/// (die Handwege setzen `manuell` nur mit `lat`/`lon`, Positionsbaustein ADR-0101).
#[tokio::test]
async fn nur_tz_felder_aendern_die_quelle_nicht() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let ef = fahrzeug_disponieren(&app, &admin, einsatz, "Florian 1").await;
    let pfad = format!("/api/incidents/{einsatz}/vehicles/{ef}/position");
    sqlx::query(
        "UPDATE einsatz_fahrzeug SET lat = 52.0, lon = 10.0, position_quelle = 'einwurf', \
         position_aktualisiert_at = '2026-11-24 10:00:00' WHERE id = ?",
    )
    .bind(ef)
    .execute(&pool)
    .await
    .unwrap();

    let (s, json) = anfrage(
        &app,
        "PATCH",
        &pfad,
        &admin,
        Some(r#"{"tz_fachaufgabe":"fuehrung"}"#),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{json}");
    assert_eq!(json["position_quelle"], "einwurf");
    assert_eq!(json["position_aktualisiert_at"], "2026-11-24 10:00:00");
}

#[tokio::test]
async fn anzeige_traegt_keine_kennung() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    fahrzeug_disponieren(&app, &admin, einsatz, "Florian 1").await;
    let (s, json) = anfrage(
        &app,
        "GET",
        &format!("/api/incidents/{einsatz}/vehicles"),
        &admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    let zeile = &json[0];
    assert_eq!(zeile["ortung_gekoppelt"], false, "{zeile}");
    for verboten in ["kennung", "zugang", "zugang_id", "zugang_name"] {
        assert!(zeile.get(verboten).is_none(), "{verboten} in {zeile}");
    }
}
