use axum::http::StatusCode;

use crate::common;
use common::{anfrage, einsatz_anlegen, login_cookie, setup, setup_mit_optionen_auf};

#[tokio::test]
async fn anlegen_listen_und_erledigen() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;

    let (status, json) = anfrage(
        &app,
        "POST",
        &format!("/api/incidents/{e}/reminders"),
        &admin,
        Some(r#"{"titel":"Lagemeldung","faellig_at":"2026-06-11 10:00","intervall_minuten":30}"#),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    let eid = json["id"].as_i64().unwrap();
    assert_eq!(json["status"], "offen");
    assert_eq!(
        json["faellig_at"], "2026-06-11 10:00:00",
        "auf Sekundenformat normalisiert"
    );

    let (status, liste) = anfrage(
        &app,
        "GET",
        &format!("/api/incidents/{e}/reminders?nur_offen=true"),
        &admin,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(liste.as_array().unwrap().len(), 1);

    let (status, _) = anfrage(
        &app,
        "POST",
        &format!("/api/incidents/{e}/reminders/{eid}/complete"),
        &admin,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    let (_, liste) = anfrage(
        &app,
        "GET",
        &format!("/api/incidents/{e}/reminders?nur_offen=true"),
        &admin,
        None,
    )
    .await;
    assert!(
        liste.as_array().unwrap().is_empty(),
        "erledigte verschwinden aus offener Liste"
    );
}

#[tokio::test]
async fn anlegen_lehnt_leeren_titel_ab() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let (status, _) = anfrage(
        &app,
        "POST",
        &format!("/api/incidents/{e}/reminders"),
        &admin,
        Some(r#"{"titel":"  ","faellig_at":"2026-06-11 10:00"}"#),
    )
    .await;
    // Leerer Titel → AppError::Validation → 400 (Konvention, vgl. src/error.rs + tests/chat.rs).
    assert_eq!(status, StatusCode::BAD_REQUEST);
}

// --- Eingabegrenzen (LFH-924): Giftzeilen für den Planer gar nicht erst annehmen ---

async fn anlegen_status(faellig_at: &str, intervall: Option<i64>) -> StatusCode {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let body = serde_json::json!({
        "titel": "Lagemeldung", "faellig_at": faellig_at, "intervall_minuten": intervall
    })
    .to_string();
    anfrage(
        &app,
        "POST",
        &format!("/api/incidents/{e}/reminders"),
        &admin,
        Some(&body),
    )
    .await
    .0
}

#[tokio::test]
async fn intervall_ueber_sieben_tagen_ist_400() {
    assert_eq!(
        anlegen_status("2026-06-11 10:00", Some(999_999_999_999)).await,
        StatusCode::BAD_REQUEST
    );
    assert_eq!(
        anlegen_status("2026-06-11 10:00", Some(10_081)).await,
        StatusCode::BAD_REQUEST
    );
    assert_eq!(
        anlegen_status("2026-06-11 10:00", Some(0)).await,
        StatusCode::BAD_REQUEST
    );
    // Die Grenze selbst gilt: 7 Tage.
    assert_eq!(
        anlegen_status("2026-06-11 10:00", Some(10_080)).await,
        StatusCode::CREATED
    );
}

#[tokio::test]
async fn faelligkeit_ausserhalb_des_jahresbereichs_ist_400() {
    for faellig in [
        "0226-05-01 10:00",
        "-262000-05-01 10:00",
        "2101-01-01 00:00",
    ] {
        assert_eq!(
            anlegen_status(faellig, Some(1)).await,
            StatusCode::BAD_REQUEST,
            "{faellig}"
        );
    }
    for faellig in ["2000-01-01 00:00", "2100-12-31 23:59"] {
        assert_eq!(
            anlegen_status(faellig, None).await,
            StatusCode::CREATED,
            "{faellig}"
        );
    }
}

// --- Sachbezug-Guard (LFH-112): Allowlist + einsatz-gescopter Existenz-Check ---

#[tokio::test]
async fn erinnerung_bezug_fremde_meldung_ist_404() {
    // Schreibberechtigter in Einsatz e1 darf keine Meldungs-ID aus e2 referenzieren —
    // sonst Cross-Einsatz-Schreibzugriff über den Scheduler (setze_eskaliert, nicht
    // einsatz-gescopt). Der Guard weist das an der Quelle ab.
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e1 = einsatz_anlegen(&app, &admin).await;
    let e2 = einsatz_anlegen(&app, &admin).await;
    // Fremde Meldung in e2 anlegen.
    let meldung_body = serde_json::json!({
        "absender": "Florian Nord 1", "empfaenger": "ELW 1", "meldeweg": "funk",
        "inhalt": "Deich instabil", "ereigniszeit": "2026-06-12 09:00:00"
    })
    .to_string();
    let (status, m) = anfrage(
        &app,
        "POST",
        &format!("/api/incidents/{e2}/reports"),
        &admin,
        Some(&meldung_body),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    let fremde_mid = m["id"].as_i64().unwrap();

    let body = format!(
        r#"{{"titel":"X","faellig_at":"2026-06-11 10:00","bezug_typ":"meldung","bezug_id":{fremde_mid}}}"#
    );
    let (status, _) = anfrage(
        &app,
        "POST",
        &format!("/api/incidents/{e1}/reminders"),
        &admin,
        Some(&body),
    )
    .await;
    assert_eq!(
        status,
        StatusCode::NOT_FOUND,
        "fremde Meldungs-ID als Bezug → 404"
    );
}

#[tokio::test]
async fn erinnerung_bezug_unbekannter_typ_ist_400() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let (status, _) = anfrage(
        &app,
        "POST",
        &format!("/api/incidents/{e}/reminders"),
        &admin,
        Some(r#"{"titel":"X","faellig_at":"2026-06-11 10:00","bezug_typ":"schaden","bezug_id":1}"#),
    )
    .await;
    assert_eq!(
        status,
        StatusCode::BAD_REQUEST,
        "bezug_typ nicht in der Allowlist → Validation"
    );
}

#[tokio::test]
async fn erinnerung_bezug_gueltige_etb_ist_201() {
    // Der EtbPage-Frontend-Pfad postet bezug_typ='etb' + ETB-Eintrag-ID desselben Einsatzes —
    // das muss durchgehen.
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let (status, etb) = anfrage(
        &app,
        "POST",
        &format!("/api/incidents/{e}/etb"),
        &admin,
        Some(r#"{"von":"ELW 1","an":"ELW 1","typ":"meldung","inhalt":"Deich instabil"}"#),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    let etb_id = etb["id"].as_i64().unwrap();

    let body = format!(
        r#"{{"titel":"Nachverfolgen","faellig_at":"2026-06-11 10:00","bezug_typ":"etb","bezug_id":{etb_id}}}"#
    );
    let (status, json) = anfrage(
        &app,
        "POST",
        &format!("/api/incidents/{e}/reminders"),
        &admin,
        Some(&body),
    )
    .await;
    assert_eq!(
        status,
        StatusCode::CREATED,
        "gültiger ETB-Bezug aus demselben Einsatz → 201"
    );
    assert_eq!(json["bezug_typ"], "etb");
    assert_eq!(json["bezug_id"], etb_id);
}

/// LFH-1146: Der Verweis einer Erinnerung nennt die laufende Nummer des Bezugs, nie seine
/// Datenbank-ID. Meldungen und Aufträge im ersten Einsatz schieben die IDs im zweiten von den
/// laufenden Nummern weg; ohne Nummer (Ablösung) fehlt das Feld.
#[tokio::test]
async fn erinnerung_traegt_laufende_nummer_des_bezugs() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e1 = einsatz_anlegen(&app, &admin).await;
    let e2 = einsatz_anlegen(&app, &admin).await;
    let meldung_body = serde_json::json!({
        "absender": "Florian Nord 1", "empfaenger": "ELW 1", "meldeweg": "funk",
        "inhalt": "Deich instabil", "ereigniszeit": "2026-06-12 09:00:00"
    })
    .to_string();
    let mut meldung = serde_json::Value::Null;
    for e in [e1, e1, e2] {
        let (status, m) = anfrage(
            &app,
            "POST",
            &format!("/api/incidents/{e}/reports"),
            &admin,
            Some(&meldung_body),
        )
        .await;
        assert_eq!(status, StatusCode::CREATED);
        meldung = m;
    }
    let auftrag_body = serde_json::json!({
        "auftrag_text": "Deich sichern",
        "empfaenger": [{ "empfaenger_typ": "funktion", "funktion_text": "EA1" }]
    })
    .to_string();
    for _ in 0..2 {
        let (status, _) = anfrage(
            &app,
            "POST",
            &format!("/api/incidents/{e1}/tasks"),
            &admin,
            Some(&auftrag_body),
        )
        .await;
        assert_eq!(status, StatusCode::CREATED);
    }
    let (status, auftrag) = anfrage(
        &app,
        "POST",
        &format!("/api/incidents/{e2}/tasks"),
        &admin,
        Some(&auftrag_body),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    let (status, etb) = anfrage(
        &app,
        "POST",
        &format!("/api/incidents/{e2}/etb"),
        &admin,
        Some(r#"{"von":"ELW 1","an":"ELW 1","typ":"meldung","inhalt":"Deich instabil"}"#),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);

    for (typ, objekt) in [("meldung", &meldung), ("auftrag", &auftrag), ("etb", &etb)] {
        let id = objekt["id"].as_i64().unwrap();
        let lfd_nr = objekt["lfd_nr"].as_i64().unwrap();
        assert_ne!(id, lfd_nr, "{typ}: Testaufbau braucht ID ≠ laufende Nummer");
        let body = format!(
            r#"{{"titel":"Nachfassen","faellig_at":"2026-06-11 10:00","bezug_typ":"{typ}","bezug_id":{id}}}"#
        );
        let (status, json) = anfrage(
            &app,
            "POST",
            &format!("/api/incidents/{e2}/reminders"),
            &admin,
            Some(&body),
        )
        .await;
        assert_eq!(status, StatusCode::CREATED);
        assert_eq!(json["bezug_id"], id);
        assert_eq!(
            json["bezug_lfd_nr"], lfd_nr,
            "{typ}: laufende Nummer des Bezugs"
        );
    }

    let (_, liste) = anfrage(
        &app,
        "GET",
        &format!("/api/incidents/{e2}/reminders"),
        &admin,
        None,
    )
    .await;
    let liste = liste.as_array().unwrap();
    assert_eq!(liste.len(), 3);
    assert!(
        liste.iter().all(|e| e["bezug_lfd_nr"].is_i64()),
        "Liste trägt die laufende Nummer: {liste:?}"
    );

    let (_, ohne) = anfrage(
        &app,
        "POST",
        &format!("/api/incidents/{e2}/reminders"),
        &admin,
        Some(r#"{"titel":"Ohne Bezug","faellig_at":"2026-06-11 10:00"}"#),
    )
    .await;
    assert!(
        ohne.get("bezug_lfd_nr").is_none(),
        "ohne Bezug keine Nummer"
    );
}

#[tokio::test]
async fn erledigen_anderer_einsatz_ist_404() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e1 = einsatz_anlegen(&app, &admin).await;
    let e2 = einsatz_anlegen(&app, &admin).await;
    let (_, json) = anfrage(
        &app,
        "POST",
        &format!("/api/incidents/{e1}/reminders"),
        &admin,
        Some(r#"{"titel":"X","faellig_at":"2026-06-11 10:00"}"#),
    )
    .await;
    let eid = json["id"].as_i64().unwrap();
    // Erinnerung von e1 über e2 ansprechen → NotFound.
    let (status, _) = anfrage(
        &app,
        "POST",
        &format!("/api/incidents/{e2}/reminders/{eid}/complete"),
        &admin,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
}

/// Rücknahme von Erledigt/Quittiert (LFH-343).
///
/// Beide Knöpfe schalten mit EINEM Klick statt mit Rückfrage; der Rückgängig-Toast braucht
/// dafür einen Weg, den der Server annimmt.
#[tokio::test]
async fn oeffnen_nimmt_erledigt_und_quittiert_zurueck() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let (_, json) = anfrage(
        &app,
        "POST",
        &format!("/api/incidents/{e}/reminders"),
        &admin,
        Some(r#"{"titel":"Lagemeldung","faellig_at":"2026-06-11 10:00"}"#),
    )
    .await;
    let eid = json["id"].as_i64().unwrap();
    let oeffnen = format!("/api/incidents/{e}/reminders/{eid}/reopen");

    // Aus `offen` heraus wäre die Rücknahme ein No-op, der wie Erfolg aussieht → 422.
    let (leerlauf, _) = anfrage(&app, "POST", &oeffnen, &admin, None).await;
    assert_eq!(leerlauf, StatusCode::UNPROCESSABLE_ENTITY);

    // Weg 1: erledigt → offen.
    anfrage(
        &app,
        "POST",
        &format!("/api/incidents/{e}/reminders/{eid}/complete"),
        &admin,
        None,
    )
    .await;
    let (status, zurueck) = anfrage(&app, "POST", &oeffnen, &admin, None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(zurueck["status"], "offen");
    // Die Vollzugsachse muss MITgehen: bliebe sie stehen, zeigte die Karte „offen"
    // und trüge gleichzeitig den grünen Vollzugs-Tag.
    assert_eq!(zurueck["vollzug_status"], "offen");
    assert!(zurueck["erledigt_at"].is_null());

    // Weg 2: quittiert → offen. Die Quittungsachse ist eine ANDERE Spalte als der
    // Vollzug — eine Rücknahme, die nur eine von beiden räumt, ist keine.
    anfrage(
        &app,
        "POST",
        &format!("/api/incidents/{e}/reminders/{eid}/acknowledge"),
        &admin,
        None,
    )
    .await;
    let (status, zurueck) = anfrage(&app, "POST", &oeffnen, &admin, None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(zurueck["status"], "offen");
    assert!(zurueck["quittiert_at"].is_null());

    // Und sie taucht in der Offen-Liste wieder auf — das ist der sichtbare Zweck.
    let (_, liste) = anfrage(
        &app,
        "GET",
        &format!("/api/incidents/{e}/reminders?nur_offen=true"),
        &admin,
        None,
    )
    .await;
    assert_eq!(liste.as_array().unwrap().len(), 1);
}

/// Datei-Pool mit WAL und mehreren Verbindungen (wie `tests/benachrichtigung_auftrag.rs`): erst
/// damit kann ein Test die Schreibsperre halten, während eine Anfrage den letzten festgeschriebenen
/// Stand liest.
async fn welt_concurrent() -> (
    tempfile::TempDir,
    axum::Router,
    sqlx::SqlitePool,
    String,
    i64,
    i64,
) {
    let (dir, pool) = lifeline_hub::db::test_pool_datei().await;
    let (app, pool, _live) =
        setup_mit_optionen_auf(pool, lifeline_hub::app::RouterOptionen::default()).await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let (status, json) = anfrage(
        &app,
        "POST",
        &format!("/api/incidents/{e}/reminders"),
        &admin,
        Some(r#"{"titel":"Lagemeldung","faellig_at":"2026-06-11 10:00"}"#),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    let eid = json["id"].as_i64().unwrap();
    (dir, app, pool, admin, e, eid)
}

/// Triage-Status, Vollzug-Achse und Quittung einer Erinnerung, wie sie festgeschrieben sind.
async fn achsen(pool: &sqlx::SqlitePool, eid: i64) -> (String, Option<String>, Option<String>) {
    sqlx::query_as(
        "SELECT e.status, ks.vollzug_status, ks.quittiert_at FROM erinnerung e \
         LEFT JOIN kommunikation_status ks \
           ON ks.objekt_typ = 'erinnerung' AND ks.objekt_id = e.id \
         WHERE e.id = ?",
    )
    .bind(eid)
    .fetch_one(pool)
    .await
    .unwrap()
}

/// Schreibt auf einer fremden Verbindung, was ein Erledigen schreibt (Status und Vollzug-Achse),
/// ohne festzuschreiben: die Transaktion hält die Schreibsperre, bis der Test sie committet.
async fn erledigen_ohne_commit<'a>(
    pool: &'a sqlx::SqlitePool,
    e: i64,
    eid: i64,
) -> sqlx::Transaction<'a, sqlx::Sqlite> {
    let mut tx = pool.begin_with("BEGIN IMMEDIATE").await.unwrap();
    sqlx::query(
        "UPDATE erinnerung SET status = 'erledigt', erledigt_at = '2026-11-21 10:00:00' WHERE id = ?",
    )
    .bind(eid)
    .execute(&mut *tx)
    .await
    .unwrap();
    sqlx::query(
        "INSERT INTO kommunikation_status \
           (org_id, einsatz_id, objekt_typ, objekt_id, vollzug_status, vollzogen_at, vollzogen_von_id) \
         SELECT org_id, id, 'erinnerung', ?, 'vollzogen', '2026-11-21 10:00:00', \
                (SELECT id FROM benutzer WHERE benutzername = 'admin') \
         FROM einsatz WHERE id = ? \
         ON CONFLICT(objekt_typ, objekt_id) DO UPDATE SET \
           vollzug_status = excluded.vollzug_status, \
           vollzogen_at = excluded.vollzogen_at, vollzogen_von_id = excluded.vollzogen_von_id",
    )
    .bind(eid)
    .bind(e)
    .execute(&mut *tx)
    .await
    .unwrap();
    tx
}

/// LLH-1874: Zwei Stellen schließen dieselbe Erinnerung zugleich ab. Die erste hat „Erledigt“
/// geschrieben, aber noch nicht festgeschrieben; „Erledigt“ und „Erübrigt“ der zweiten Stelle
/// warten an der Sperre und treffen danach auf eine abgeschlossene Erinnerung: 422, nichts wird
/// überschrieben. Vorher stand danach Status „quittiert“ neben Vollzug „vollzogen“.
#[tokio::test]
async fn abschliessen_ueberschreibt_keine_gleichzeitige_erledigung() {
    let (_dir, app, pool, admin, e, eid) = welt_concurrent().await;
    let erledigen = format!("/api/incidents/{e}/reminders/{eid}/complete");
    let quittieren = format!("/api/incidents/{e}/reminders/{eid}/acknowledge");

    let erste = erledigen_ohne_commit(&pool, e, eid).await;
    let beide = async {
        tokio::join!(
            anfrage(&app, "POST", &erledigen, &admin, None),
            anfrage(&app, "POST", &quittieren, &admin, None),
        )
    };
    tokio::pin!(beide);
    assert!(
        tokio::time::timeout(std::time::Duration::from_millis(500), &mut beide)
            .await
            .is_err(),
        "beide Anfragen warten an der Schreibsperre"
    );
    erste.commit().await.unwrap();
    let ((s_erledigen, _), (s_quittieren, _)) = beide.await;
    assert_eq!(s_erledigen, StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(s_quittieren, StatusCode::UNPROCESSABLE_ENTITY);

    let (status, vollzug, quittiert_at) = achsen(&pool, eid).await;
    assert_eq!(status, "erledigt");
    assert_eq!(vollzug.as_deref(), Some("vollzogen"));
    assert!(quittiert_at.is_none(), "keine Quittung neben dem Vollzug");
    let vollzogen_at: Option<String> = sqlx::query_scalar(
        "SELECT vollzogen_at FROM kommunikation_status \
         WHERE objekt_typ = 'erinnerung' AND objekt_id = ?",
    )
    .bind(eid)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(
        vollzogen_at.as_deref(),
        Some("2026-11-21 10:00:00"),
        "die erste Erledigung bleibt stehen"
    );
}

/// LLH-1874: Zwei Stellen nehmen dieselbe Erledigung zugleich zurück („Rückgängig“ im Toast und
/// „Wieder öffnen“). Die erste hat Status und Vollzug-Achse schon auf „offen“ geschrieben, aber
/// noch nicht festgeschrieben. Die zweite liest nichts mehr vorab über den Pool, sondern prüft in
/// ihrer Schreibtransaktion: sie wartet an der Sperre und trifft danach auf eine offene
/// Erinnerung, 422 statt einer gemeldeten Rücknahme, die keine war. Vorher las sie „erledigt“ aus
/// dem festgeschriebenen Stand und meldete 200.
#[tokio::test]
async fn wieder_oeffnen_gegen_gleichzeitige_ruecknahme_ist_422() {
    let (_dir, app, pool, admin, e, eid) = welt_concurrent().await;
    let (s, _) = anfrage(
        &app,
        "POST",
        &format!("/api/incidents/{e}/reminders/{eid}/complete"),
        &admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    let oeffnen = format!("/api/incidents/{e}/reminders/{eid}/reopen");

    let mut andere = pool.begin_with("BEGIN IMMEDIATE").await.unwrap();
    sqlx::query("UPDATE erinnerung SET status = 'offen', erledigt_at = NULL WHERE id = ?")
        .bind(eid)
        .execute(&mut *andere)
        .await
        .unwrap();
    sqlx::query(
        "UPDATE kommunikation_status \
         SET vollzug_status = 'offen', vollzogen_at = NULL, vollzogen_von_id = NULL \
         WHERE objekt_typ = 'erinnerung' AND objekt_id = ?",
    )
    .bind(eid)
    .execute(&mut *andere)
    .await
    .unwrap();

    let ruecknahme = anfrage(&app, "POST", &oeffnen, &admin, None);
    tokio::pin!(ruecknahme);
    assert!(
        tokio::time::timeout(std::time::Duration::from_millis(500), &mut ruecknahme)
            .await
            .is_err(),
        "die Rücknahme wartet an der Schreibsperre"
    );
    andere.commit().await.unwrap();
    let (s, _) = ruecknahme.await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY);

    let (status, vollzug, _) = achsen(&pool, eid).await;
    assert_eq!(status, "offen");
    assert_eq!(vollzug.as_deref(), Some("offen"));
}

/// LLH-1874: „Erledigt“ und „Erübrigt“ gibt es nur an einer offenen Erinnerung. Ein zweiter Klick
/// auf einer schon abgeschlossenen ist 422 und überschreibt weder Zeitpunkt noch Achse.
#[tokio::test]
async fn abschliessen_nur_aus_offen() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let (_, json) = anfrage(
        &app,
        "POST",
        &format!("/api/incidents/{e}/reminders"),
        &admin,
        Some(r#"{"titel":"Lagemeldung","faellig_at":"2026-06-11 10:00"}"#),
    )
    .await;
    let eid = json["id"].as_i64().unwrap();
    let erledigen = format!("/api/incidents/{e}/reminders/{eid}/complete");
    let quittieren = format!("/api/incidents/{e}/reminders/{eid}/acknowledge");

    let (s, erledigt) = anfrage(&app, "POST", &erledigen, &admin, None).await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(erledigt["status"], "erledigt");
    assert_eq!(erledigt["vollzug_status"], "vollzogen");

    let (s, _) = anfrage(&app, "POST", &erledigen, &admin, None).await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY);
    let (s, _) = anfrage(&app, "POST", &quittieren, &admin, None).await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY);

    let (_, liste) = anfrage(
        &app,
        "GET",
        &format!("/api/incidents/{e}/reminders?nur_offen=false"),
        &admin,
        None,
    )
    .await;
    let nachher = liste
        .as_array()
        .unwrap()
        .iter()
        .find(|r| r["id"] == eid)
        .unwrap();
    assert_eq!(nachher["status"], "erledigt");
    assert_eq!(nachher["erledigt_at"], erledigt["erledigt_at"]);
    assert!(nachher["quittiert_at"].is_null());
}
