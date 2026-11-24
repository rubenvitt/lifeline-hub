//! Abschluss und Wiederöffnen eines Einsatzes (LLH-1814, Spec `einsatz-abschluss`, Change
//! `sa41jgmj-einsatz-abschluss-absichern`).

use axum::http::StatusCode;
use serde_json::{json, Value};
use sqlx::SqlitePool;

mod common;
use common::{anfrage, anfrage_json, einsatz_anlegen, login_cookie, setup_mit_pool};

async fn benutzer_id(pool: &SqlitePool, benutzername: &str) -> i64 {
    sqlx::query_scalar("SELECT id FROM benutzer WHERE benutzername = ?")
        .bind(benutzername)
        .fetch_one(pool)
        .await
        .unwrap()
}

async fn abschliessen(app: &axum::Router, cookie: &str, id: i64) -> (StatusCode, Value) {
    anfrage(
        app,
        "POST",
        &format!("/api/einsaetze/{id}/close"),
        cookie,
        None,
    )
    .await
}

/// System-Einträge des ETB in Schreibreihenfolge: (lfd_nr, inhalt, erfasser_id).
async fn system_eintraege(pool: &SqlitePool, id: i64) -> Vec<(i64, String, i64)> {
    sqlx::query_as(
        "SELECT lfd_nr, inhalt, erfasser_id FROM etb_eintrag \
         WHERE einsatz_id = ? AND typ = 'system' ORDER BY lfd_nr",
    )
    .bind(id)
    .fetch_all(pool)
    .await
    .unwrap()
}

// ── 1. Abschluss im ETB (D3) ─────────────────────────────────────────────────────────────────

#[tokio::test]
async fn abschluss_schreibt_genau_einen_eintrag_einsatz_abgeschlossen_mit_der_abschliessenden_person(
) {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let admin_id = benutzer_id(&pool, "admin").await;
    let id = einsatz_anlegen(&app, &admin).await;

    let (status, body) = abschliessen(&app, &admin, id).await;
    assert_eq!(status, StatusCode::OK, "{body}");

    let eintraege = system_eintraege(&pool, id).await;
    let abschluss: Vec<_> = eintraege
        .iter()
        .filter(|(_, inhalt, _)| inhalt == "Einsatz abgeschlossen")
        .collect();
    assert_eq!(abschluss.len(), 1, "{eintraege:?}");
    assert_eq!(
        abschluss[0].2, admin_id,
        "Erfasser ist die abschließende Person"
    );

    // Ein zweiter Aufruf am abgeschlossenen Einsatz schreibt nichts, weder über die Route (409)
    // noch über den Repo-Vorgang selbst (kein Re-Close).
    let (status, _) = abschliessen(&app, &admin, id).await;
    assert_eq!(status, StatusCode::CONFLICT);
    let ergebnis = lifeline_hub::einsatz::repo::abschliessen(&pool, id, admin_id)
        .await
        .unwrap();
    assert!(ergebnis.etb_eintrag_ids.is_empty());
    assert_eq!(system_eintraege(&pool, id).await, eintraege);
}

#[tokio::test]
async fn der_abschluss_eintrag_steht_vor_den_frist_eintraegen_und_wird_mitgemeldet() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let (status, body) = anfrage_json(
        &app,
        "PUT",
        "/api/org-settings",
        &admin,
        Some(&json!({ "retention_dauer_tage": 30, "nachbereitung_tage": 7 })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let id = einsatz_anlegen(&app, &admin).await;
    let vorher: Vec<i64> = system_eintraege(&pool, id)
        .await
        .into_iter()
        .map(|(lfd, _, _)| lfd)
        .collect();

    let admin_id = benutzer_id(&pool, "admin").await;
    let ergebnis = lifeline_hub::einsatz::repo::abschliessen(&pool, id, admin_id)
        .await
        .unwrap();

    let neu: Vec<_> = system_eintraege(&pool, id)
        .await
        .into_iter()
        .filter(|(lfd, _, _)| !vorher.contains(lfd))
        .collect();
    assert_eq!(neu.len(), 3, "{neu:?}");
    assert_eq!(neu[0].1, "Einsatz abgeschlossen", "{neu:?}");
    assert!(neu[1]
        .1
        .starts_with("Aufbewahrungsfrist automatisch gesetzt"));
    assert!(neu[2].1.starts_with("Nachbereitung bis"));
    assert_eq!(
        ergebnis.etb_eintrag_ids.len(),
        3,
        "jede Kennung wird live gemeldet"
    );
}

// ── 2. Prüfung offener Punkte (D1) ───────────────────────────────────────────────────────────

async fn pruefung(app: &axum::Router, cookie: &str, id: i64) -> (StatusCode, Value) {
    anfrage(
        app,
        "GET",
        &format!("/api/einsaetze/{id}/closure/check"),
        cookie,
        None,
    )
    .await
}

async fn anlegen(app: &axum::Router, cookie: &str, pfad: &str, body: Value) -> i64 {
    let (status, v) = anfrage_json(app, "POST", pfad, cookie, Some(&body)).await;
    assert_eq!(status, StatusCode::CREATED, "{pfad}: {v}");
    v["id"].as_i64().unwrap()
}

async fn status_id(pool: &SqlitePool, label: &str) -> i64 {
    sqlx::query_scalar("SELECT id FROM fahrzeug_status WHERE label = ? ORDER BY id LIMIT 1")
        .bind(label)
        .fetch_one(pool)
        .await
        .unwrap()
}

/// Spec „Gebundene Einheit und offener Verbleib“, „Prüfung ohne Leitungsrecht“; die Zählung
/// hängt nicht an der Modulfreigabe der anfragenden Person.
#[tokio::test]
async fn pruefung_nennt_gebundene_einheit_und_offene_betroffene_auch_bei_ausgeblendetem_modul() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;

    let zug = common::einheit_bilden(&app, &admin, e, "Rettungszug 1").await;
    let anfahrt = status_id(&pool, "3 – Auf Anfahrt").await;
    let (s, v) = anfrage_json(
        &app,
        "PUT",
        &format!("/api/einsaetze/{e}/units/{zug}/status"),
        &admin,
        Some(&json!({ "status_id": anfahrt })),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    let weg = common::einheit_bilden(&app, &admin, e, "Zug entlassen").await;
    let (s, v) = anfrage(
        &app,
        "DELETE",
        &format!("/api/einsaetze/{e}/units/{weg}"),
        &admin,
        None,
    )
    .await;
    assert!(s.is_success(), "{v}");
    common::person_anlegen(&app, &admin, e, r#"{"name":"Muster"}"#).await;
    anlegen(
        &app,
        &admin,
        &format!("/api/einsaetze/{e}/tasks"),
        json!({ "auftrag_text": "Deich sichern",
                "empfaenger": [{ "empfaenger_typ": "funktion", "funktion_text": "Nord" }] }),
    )
    .await;
    anlegen(
        &app,
        &admin,
        &format!("/api/einsaetze/{e}/reports"),
        json!({ "absender": "Florian 1", "empfaenger": "ELW 1", "meldeweg": "funk",
                "inhalt": "Deich instabil", "ereigniszeit": "2026-06-12 09:00:00" }),
    )
    .await;
    anlegen(
        &app,
        &admin,
        &format!("/api/einsaetze/{e}/resource-requests"),
        json!({ "art": "RTW", "bezeichnung": "2 RTW", "anzahl": 2,
                "adressat_kategorie": "leitstelle" }),
    )
    .await;

    // Eine Einsatzleitung ohne Admin-Recht, für die das Modul Personen ausgeblendet ist.
    let helena_id = common::benutzer_anlegen(&app, &admin, "helena", "keine").await;
    common::rolle_setzen(&app, &admin, e, helena_id, "einsatzleitung").await;
    let lena = login_cookie(&app, "helena", "helenapw1").await;
    let (s, _) = anfrage(
        &app,
        "PUT",
        &format!("/api/einsaetze/{e}/module-overrides/personen"),
        &admin,
        Some(r#"{"sichtbar":false,"benoetigte_rolle":null}"#),
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    let (s, _) = anfrage(
        &app,
        "GET",
        &format!("/api/einsaetze/{e}/persons"),
        &lena,
        None,
    )
    .await;
    assert_eq!(
        s,
        StatusCode::FORBIDDEN,
        "Modul Personen ist für lena ausgeblendet"
    );

    let (s, p) = pruefung(&app, &lena, e).await;
    assert_eq!(s, StatusCode::OK, "{p}");
    let kraefte = p["kraefte"]["eintraege"].as_array().unwrap();
    let einheit = kraefte
        .iter()
        .find(|k| k["bezeichnung"] == "Rettungszug 1")
        .unwrap_or_else(|| panic!("Einheit fehlt: {p}"));
    assert_eq!(einheit["art"], "einheit");
    assert_eq!(einheit["status"], "3 – Auf Anfahrt");
    assert!(
        !kraefte.iter().any(|k| k["bezeichnung"] == "Zug entlassen"),
        "aufgelöste Einheit erscheint nicht: {p}"
    );
    assert_eq!(p["kraefte"]["anzahl"], 1, "{p}");
    assert_eq!(p["kraefte"]["personal"], 0, "{p}");
    // Gezählt wird auch im ausgeblendeten Modul, genannt wird dort nichts.
    assert_eq!(p["betroffene"]["anzahl"], 1, "{p}");
    assert_eq!(p["betroffene"]["eintraege"], json!([]), "{p}");
    let (_, p_admin) = pruefung(&app, &admin, e).await;
    assert_eq!(
        p_admin["betroffene"]["eintraege"][0]["bezeichnung"],
        "Verbleib offen"
    );
    assert_eq!(p["auftraege"]["anzahl"], 1, "{p}");
    assert_eq!(
        p["auftraege"]["eintraege"][0]["bezeichnung"],
        "Deich sichern"
    );
    assert_eq!(p["meldungen"]["anzahl"], 1, "{p}");
    assert_eq!(p["nachforderungen"]["anzahl"], 1, "{p}");
    assert_eq!(p["nachforderungen"]["eintraege"][0]["bezeichnung"], "2 RTW");

    // Führungspersonal und Beobachter: 403.
    for (name, rolle) in [("fritz", "fuehrungspersonal"), ("beate", "beobachter")] {
        let bid = common::benutzer_anlegen(&app, &admin, name, "keine").await;
        common::rolle_setzen(&app, &admin, e, bid, rolle).await;
        let cookie = login_cookie(&app, name, &format!("{name}pw1")).await;
        let (s, _) = pruefung(&app, &cookie, e).await;
        assert_eq!(s, StatusCode::FORBIDDEN, "{rolle}");
    }

    // Abschluss trotz offener Punkte; danach ist die Prüfung 409.
    let (s, v) = abschliessen(&app, &admin, e).await;
    assert_eq!(s, StatusCode::OK, "{v}");
    let (s, _) = pruefung(&app, &admin, e).await;
    assert_eq!(s, StatusCode::CONFLICT);
}

/// Spec „Gesperrtes Modul nennt nur die Zahl“: Ist ein Modul für die Einsatzleitung ausgeblendet
/// oder an eine Rolle gebunden, die sie nicht hat, zählt die Prüfung seine offenen Punkte weiter,
/// gibt aber weder Text noch Bezeichnung heraus. Die Liste des Moduls wiese sie mit 403 ab.
#[tokio::test]
async fn pruefung_nennt_texte_nur_aus_modulen_die_die_person_lesen_darf() {
    let (app, _pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    common::einheit_bilden(&app, &admin, e, "Rettungszug 1").await;
    anlegen(
        &app,
        &admin,
        &format!("/api/einsaetze/{e}/tasks"),
        json!({ "auftrag_text": "Deich sichern",
                "empfaenger": [{ "empfaenger_typ": "funktion", "funktion_text": "Nord" }] }),
    )
    .await;
    anlegen(
        &app,
        &admin,
        &format!("/api/einsaetze/{e}/reports"),
        json!({ "absender": "Florian 1", "empfaenger": "ELW 1", "meldeweg": "funk",
                "inhalt": "Frau Muster, Hauptstr. 4, vermisst ihren Sohn",
                "ereigniszeit": "2026-06-12 09:00:00" }),
    )
    .await;
    anlegen(
        &app,
        &admin,
        &format!("/api/einsaetze/{e}/resource-requests"),
        json!({ "art": "RTW", "bezeichnung": "2 RTW", "anzahl": 2,
                "adressat_kategorie": "leitstelle" }),
    )
    .await;

    let helena_id = common::benutzer_anlegen(&app, &admin, "helena", "keine").await;
    common::rolle_setzen(&app, &admin, e, helena_id, "einsatzleitung").await;
    let lena = login_cookie(&app, "helena", "helenapw1").await;
    for (modul, regel) in [
        ("meldungen", r#"{"sichtbar":false,"benoetigte_rolle":null}"#),
        ("einheiten", r#"{"sichtbar":false,"benoetigte_rolle":null}"#),
        (
            "auftraege",
            r#"{"sichtbar":true,"benoetigte_rolle":"fuehrungskraft"}"#,
        ),
    ] {
        let (s, v) = anfrage(
            &app,
            "PUT",
            &format!("/api/einsaetze/{e}/module-overrides/{modul}"),
            &admin,
            Some(regel),
        )
        .await;
        assert_eq!(s, StatusCode::OK, "{modul}: {v}");
        let (s, _) = anfrage(
            &app,
            "GET",
            // Modulschlüssel bleiben deutsch, die Route ist englisch (ADR-0085).
            &format!(
                "/api/einsaetze/{e}/{}",
                match modul {
                    "meldungen" => "reports",
                    "auftraege" => "tasks",
                    "einheiten" => "units",
                    andere => andere,
                }
            ),
            &lena,
            None,
        )
        .await;
        assert_eq!(s, StatusCode::FORBIDDEN, "{modul} ist für lena gesperrt");
    }

    let (s, p) = pruefung(&app, &lena, e).await;
    assert_eq!(s, StatusCode::OK, "{p}");
    for gruppe in ["kraefte", "auftraege", "meldungen"] {
        assert_eq!(p[gruppe]["anzahl"], 1, "{gruppe} zählt weiter: {p}");
        assert_eq!(
            p[gruppe]["eintraege"],
            json!([]),
            "{gruppe} nennt nichts: {p}"
        );
    }
    assert!(
        !p.to_string().contains("Hauptstr"),
        "kein Meldungstext in der Antwort: {p}"
    );
    // Ein freigegebenes Modul nennt seine Einträge weiter.
    assert_eq!(p["nachforderungen"]["eintraege"][0]["bezeichnung"], "2 RTW");

    // Der Admin liest jedes Modul und sieht alle Einträge.
    let (_, p) = pruefung(&app, &admin, e).await;
    assert_eq!(
        p["meldungen"]["eintraege"].as_array().unwrap().len(),
        1,
        "{p}"
    );
    assert_eq!(
        p["auftraege"]["eintraege"][0]["bezeichnung"],
        "Deich sichern"
    );
    assert_eq!(p["kraefte"]["eintraege"][0]["bezeichnung"], "Rettungszug 1");
}

/// Spec „Nichts offen“: ein leerer Einsatz hat in jeder Gruppe 0 und keine Einträge.
#[tokio::test]
async fn pruefung_am_leeren_einsatz_ist_ueberall_null() {
    let (app, _pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let (s, p) = pruefung(&app, &admin, e).await;
    assert_eq!(s, StatusCode::OK, "{p}");
    for gruppe in [
        "kraefte",
        "auftraege",
        "meldungen",
        "nachforderungen",
        "betroffene",
    ] {
        assert_eq!(p[gruppe]["anzahl"], 0, "{gruppe}: {p}");
        assert_eq!(p[gruppe]["eintraege"], json!([]), "{gruppe}: {p}");
    }
}

// ── 3. Wiederöffnen (D4, D5) ─────────────────────────────────────────────────────────────────

async fn wiedereroeffnen(
    app: &axum::Router,
    cookie: &str,
    id: i64,
    body: Option<Value>,
) -> (StatusCode, Value) {
    anfrage_json(
        app,
        "POST",
        &format!("/api/einsaetze/{id}/reopen"),
        cookie,
        body.as_ref(),
    )
    .await
}

fn grund(text: &str) -> Option<Value> {
    Some(json!({ "grund": text }))
}

async fn status_von(pool: &SqlitePool, id: i64) -> String {
    sqlx::query_scalar("SELECT status FROM einsatz WHERE id = ?")
        .bind(id)
        .fetch_one(pool)
        .await
        .unwrap()
}

/// Verlegt den Abschluss um `stunden` in die Vergangenheit, samt der Zeitstempel, an denen das
/// Wiederöffnen eine automatisch gesetzte Frist erkennt (gleich `abgeschlossen_at`).
pub async fn zurueckdatieren(pool: &SqlitePool, id: i64, stunden: i64) {
    let versatz = format!("-{stunden} hours");
    sqlx::query(
        "UPDATE einsatz_aufbewahrung_kategorie SET frist_gesetzt_at = datetime(frist_gesetzt_at, ?1) \
         WHERE einsatz_id = ?2 \
           AND frist_gesetzt_at = (SELECT abgeschlossen_at FROM einsatz WHERE id = ?2)",
    )
    .bind(&versatz)
    .bind(id)
    .execute(pool)
    .await
    .unwrap();
    sqlx::query(
        "UPDATE einsatz SET \
            retention_gesetzt_at = CASE WHEN retention_gesetzt_at = abgeschlossen_at \
                THEN datetime(retention_gesetzt_at, ?1) ELSE retention_gesetzt_at END, \
            abgeschlossen_at = datetime(abgeschlossen_at, ?1) \
         WHERE id = ?2",
    )
    .bind(&versatz)
    .bind(id)
    .execute(pool)
    .await
    .unwrap();
}

async fn abgeschlossen(app: &axum::Router, cookie: &str, id: i64) {
    let (s, v) = abschliessen(app, cookie, id).await;
    assert_eq!(s, StatusCode::OK, "{v}");
}

/// Spec „Einsatzleitung öffnet nach zwei Stunden“, „Eintrag mit Grund“.
#[tokio::test]
async fn einsatzleitung_oeffnet_nach_zwei_stunden_wieder_mit_eintrag_und_etb_ist_wieder_offen() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let fk_id = common::benutzer_anlegen(&app, &admin, "erika", "fuehrungskraft").await;
    let erika = login_cookie(&app, "erika", "erikapw1").await;
    let e = einsatz_anlegen(&app, &erika).await;
    abgeschlossen(&app, &erika, e).await;
    zurueckdatieren(&pool, e, 2).await;
    let abgeschlossen_at: String =
        sqlx::query_scalar("SELECT abgeschlossen_at FROM einsatz WHERE id = ?")
            .bind(e)
            .fetch_one(&pool)
            .await
            .unwrap();

    let (s, v) = wiedereroeffnen(&app, &erika, e, grund("  Falscher Einsatz abgeschlossen ")).await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert_eq!(v["status"], "aktiv");
    assert_eq!(v["abgeschlossen_at"], Value::Null);
    assert_eq!(status_von(&pool, e).await, "aktiv");

    let eintraege = system_eintraege(&pool, e).await;
    let (_, inhalt, erfasser) = eintraege.last().unwrap();
    assert_eq!(*erfasser, fk_id, "Erfasser ist die wieder öffnende Person");
    assert!(inhalt.starts_with("Einsatz wieder geöffnet"), "{inhalt}");
    assert!(
        inhalt.ends_with(": Falscher Einsatz abgeschlossen"),
        "{inhalt}"
    );
    assert!(
        inhalt.contains("von erika"),
        "abschließende Person: {inhalt}"
    );
    // Abschlusszeitpunkt in Zone und Darstellung des Einsatzes.
    let stil = lifeline_hub::zeitdarstellung::zeitstil_laden(&pool, e)
        .await
        .unwrap();
    let zeitpunkt = stil.zeitpunkt_text(&abgeschlossen_at);
    assert!(
        inhalt.contains(&format!("abgeschlossen am {zeitpunkt} von erika")),
        "{inhalt} / {zeitpunkt}"
    );

    // Der Einsatz ist wieder beschreibbar.
    let (s, v) = anfrage_json(
        &app,
        "POST",
        &format!("/api/einsaetze/{e}/etb"),
        &erika,
        Some(&json!({ "typ": "meldung", "inhalt": "Weiter geht's", "von": "A", "an": "B" })),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
}

/// Spec „Frist abgelaufen“ und aktiver Einsatz: 422, nichts geschrieben.
#[tokio::test]
async fn nach_25_stunden_und_am_aktiven_einsatz_ist_wiederoeffnen_422() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let (s, v) = wiedereroeffnen(&app, &admin, e, grund("Versehen")).await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY, "aktiv: {v}");

    abgeschlossen(&app, &admin, e).await;
    zurueckdatieren(&pool, e, 25).await;
    let vorher = system_eintraege(&pool, e).await;
    let (s, v) = wiedereroeffnen(&app, &admin, e, grund("Versehen")).await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY, "{v}");
    assert_eq!(status_von(&pool, e).await, "abgeschlossen");
    assert_eq!(system_eintraege(&pool, e).await, vorher);
}

/// Spec „Admin der Einsatz-Organisation ohne Mitgliedschaft“, „Wer nicht wieder öffnen darf“.
#[tokio::test]
async fn admin_der_org_darf_ohne_rolle_andere_bekommen_403() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    common::benutzer_anlegen(&app, &admin, "erika", "fuehrungskraft").await;
    let erika = login_cookie(&app, "erika", "erikapw1").await;
    let e = einsatz_anlegen(&app, &erika).await;
    for (name, rolle) in [("fritz", "fuehrungspersonal"), ("beate", "beobachter")] {
        let id = common::benutzer_anlegen(&app, &admin, name, "keine").await;
        common::rolle_setzen(&app, &erika, e, id, rolle).await;
    }
    // Org-weite Führungskraft ohne Einsatzrolle.
    common::benutzer_anlegen(&app, &admin, "karlo", "fuehrungskraft").await;
    abgeschlossen(&app, &erika, e).await;

    // Admin einer fremden Organisation.
    let org: i64 = sqlx::query_scalar(
        "INSERT INTO organisation (name, tz_organisation) \
         VALUES ('Fremd', 'hilfsorganisation') RETURNING id",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    let hash = lifeline_hub::auth::password::hash("fremdpw12").unwrap();
    sqlx::query(
        "INSERT INTO benutzer (org_id, anzeigename, benutzername, passwort_hash, system_rolle) \
         VALUES (?, 'Fremd-Admin', 'fremdadmin', ?, 'admin')",
    )
    .bind(org)
    .bind(&hash)
    .execute(&pool)
    .await
    .unwrap();
    let fremd = login_cookie(&app, "fremdadmin", "fremdpw12").await;

    for (name, pw) in [
        ("fritz", "fritzpw1"),
        ("beate", "beatepw1"),
        ("karlo", "karlopw1"),
        ("fremdadmin", "fremdpw12"),
    ] {
        let cookie = if name == "fremdadmin" {
            fremd.clone()
        } else {
            login_cookie(&app, name, pw).await
        };
        let (s, v) = wiedereroeffnen(&app, &cookie, e, grund("Versehen")).await;
        assert_eq!(s, StatusCode::FORBIDDEN, "{name}: {v}");
    }
    assert_eq!(status_von(&pool, e).await, "abgeschlossen");

    // Der Admin der Einsatz-Org ist kein Mitglied und darf.
    let (s, v) = wiedereroeffnen(&app, &admin, e, grund("Versehen")).await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert_eq!(status_von(&pool, e).await, "aktiv");
}

/// Spec „Ohne Grund“: fehlt, leer oder nur Leerzeichen → 400; zu lang → 400.
#[tokio::test]
async fn ohne_grund_ist_400_und_der_einsatz_bleibt_abgeschlossen() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    abgeschlossen(&app, &admin, e).await;
    let zu_lang = "x".repeat(lifeline_hub::etb::INHALT_MAX + 1);
    for body in [
        Some(json!({})),
        grund(""),
        grund("   "),
        grund(&zu_lang),
        Some(json!({ "grund": null })),
    ] {
        let (s, v) = wiedereroeffnen(&app, &admin, e, body.clone()).await;
        assert_eq!(s, StatusCode::BAD_REQUEST, "{body:?}: {v}");
    }
    assert_eq!(status_von(&pool, e).await, "abgeschlossen");
}

/// Ein gekoppeltes Gerät öffnet nicht wieder: 403 vor jeder Prüfung des Zustands.
///
/// Über HTTP hält schon die Routenschranke der Gerätesitzung (`auth::session`,
/// `fordere_geraeteroute`) das Gerät auf, und keine Ansicht ist Einsatzleitung. Damit der Test
/// die Geräteprüfung des Gates selbst belegt, prüft er dessen Entscheidung zusätzlich an einem
/// Kontext, der ohne sie durchkäme: ein Gerät mit Einsatzleitung und dem System-Admin der
/// Einsatz-Org als Konto, am abgeschlossenen Einsatz innerhalb der Frist.
#[tokio::test]
async fn ein_geraet_bekommt_403() {
    use axum::body::{to_bytes, Body};
    use axum::http::{header, Request};
    use lifeline_hub::auth::Benutzer;
    use lifeline_hub::einsatz::kontext::{EinsatzKontext, EinsatzWiedereroeffnungszugriff};
    use lifeline_hub::einsatz::EinsatzRolle;
    use lifeline_hub::error::AppError;
    use lifeline_hub::geraet::{Funktionsansicht, GeraetKontext};
    use tower::ServiceExt;

    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let (s, v) = anfrage_json(
        &app,
        "POST",
        &format!("/api/einsaetze/{e}/devices"),
        &admin,
        Some(&json!({ "ansicht": "lagemonitor", "bezeichnung": "Monitor" })),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
    let code = v["code"]["code"].as_str().unwrap().to_string();
    let resp = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/devices/pair")
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(json!({ "code": code }).to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let geraet = resp
        .headers()
        .get(header::SET_COOKIE)
        .unwrap()
        .to_str()
        .unwrap()
        .split(';')
        .next()
        .unwrap()
        .to_string();
    let _ = to_bytes(resp.into_body(), usize::MAX).await;
    let (s, v) = wiedereroeffnen(&app, &geraet, e, grund("Versehen")).await;
    assert_eq!(s, StatusCode::FORBIDDEN, "{v}");

    // Die Entscheidung des Gates: dieselbe Person ohne Gerät darf, mit Gerät nicht.
    abgeschlossen(&app, &admin, e).await;
    let benutzer: Benutzer = sqlx::query_as(
        "SELECT id, org_id, anzeigename, benutzername, passwort_hash, system_rolle, org_rolle, \
                aktiv, erstellt_at FROM benutzer WHERE benutzername = 'admin'",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    let kontext = |geraet: Option<GeraetKontext>| {
        let pool = pool.clone();
        let benutzer = benutzer.clone();
        async move {
            EinsatzKontext {
                einsatz: lifeline_hub::einsatz::repo::laden(&pool, e).await.unwrap(),
                rolle: Some(EinsatzRolle::Einsatzleitung),
                benutzer,
                geraet,
            }
        }
    };
    let person = kontext(None).await;
    assert_eq!(person.einsatz.org_id, person.benutzer.org_id);
    assert!(person.benutzer.ist_admin());
    EinsatzWiedereroeffnungszugriff::check(&person).expect("ohne Gerät darf sie");
    let mit_geraet = kontext(Some(GeraetKontext {
        kopplung_id: 1,
        einsatz_id: e,
        ansicht: Funktionsansicht::Lagemonitor,
        stelle: None,
        bezeichnung: "Monitor".into(),
        laeuft_ab_at: "2099-01-01 00:00:00".into(),
    }))
    .await;
    assert!(matches!(
        EinsatzWiedereroeffnungszugriff::check(&mit_geraet),
        Err(AppError::Forbidden)
    ));
}

/// Spec „Geschwärzte Kategorie“ und die übrigen Sperren der Aufbewahrung: je 422, nichts
/// geschrieben. Ein zur Löschung vorgemerkter Einsatz scheitert schon an der Lese-Policy des
/// Gates (Totalsperre, design.md D4): 403, ebenso ohne Schreibvorgang.
#[tokio::test]
async fn greift_die_aufbewahrung_schon_ist_wiederoeffnen_422() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let admin_id = benutzer_id(&pool, "admin").await;
    let sperren: [(&str, String); 7] = [
        (
            "vorgemerkt",
            "UPDATE einsatz SET geloescht_at = datetime('now') WHERE id = {e}".into(),
        ),
        (
            "geschwärzt",
            "UPDATE einsatz SET geschwaerzt_at = datetime('now') WHERE id = {e}".into(),
        ),
        (
            "Kategorie geschwärzt",
            "INSERT INTO einsatz_aufbewahrung_kategorie \
             (einsatz_id, kategorie, frist_bis, rechtsgrundlage, frist_gesetzt_at, geschwaerzt_at) \
             VALUES ({e}, 'personenauskunft', datetime('now'), 'x', datetime('now', '-1 day'), \
                     datetime('now'))"
                .into(),
        ),
        (
            "offener Schwärzungsantrag",
            format!(
                "INSERT INTO schwaerzung_antrag (einsatz_id, ziel_art, ziel_id, aktenzeichen, \
                 beantragt_von, beantragt_at, faellig_at) \
                 VALUES ({{e}}, 'einsatz', NULL, 'AZ 1', {admin_id}, datetime('now'), \
                         datetime('now', '+1 day'))"
            ),
        ),
        (
            "archiviert",
            "INSERT INTO einsatz_archiv (einsatz_id, block, empfaenger_fingerabdruecke, groesse, \
             sha256, inhalt) VALUES ({e}, 1, '[]', 1, 'x', x'00')"
                .into(),
        ),
        (
            "zur Verwahrung übergeben",
            "INSERT INTO einsatz_verwahrung (einsatz_id, gegenstelle, quittiert_at) \
             VALUES ({e}, 'Hub', datetime('now'))"
                .into(),
        ),
        (
            "Abräumen vorgemerkt",
            "INSERT INTO einsatz_abraeumen (einsatz_id, art, gegenstelle) \
             VALUES ({e}, 'verwahrt', 'Hub')"
                .into(),
        ),
    ];
    for (name, sql) in sperren {
        let e = einsatz_anlegen(&app, &admin).await;
        abgeschlossen(&app, &admin, e).await;
        sqlx::query(sqlx::AssertSqlSafe(sql.replace("{e}", &e.to_string())))
            .execute(&pool)
            .await
            .unwrap_or_else(|err| panic!("{name}: {err}"));
        let vorher = system_eintraege(&pool, e).await;
        let (s, v) = wiedereroeffnen(&app, &admin, e, grund("Versehen")).await;
        let erwartet = if name == "vorgemerkt" {
            StatusCode::FORBIDDEN
        } else {
            StatusCode::UNPROCESSABLE_ENTITY
        };
        assert_eq!(s, erwartet, "{name}: {v}");
        // Der Repo-Vorgang selbst lehnt jede Sperre mit 422 ab, auch hinter dem Gate.
        let fehler = lifeline_hub::einsatz::repo::wiedereroeffnen(
            &pool,
            e,
            admin_id,
            "Versehen",
            chrono::Utc::now(),
        )
        .await
        .unwrap_err();
        assert_eq!(
            fehler.status(),
            StatusCode::UNPROCESSABLE_ENTITY,
            "{name}: {fehler:?}"
        );
        assert_eq!(status_von(&pool, e).await, "abgeschlossen", "{name}");
        assert_eq!(system_eintraege(&pool, e).await, vorher, "{name}");
    }
}

/// Spec „Wiederöffnen am Spiegel“: 409, nichts geschrieben.
#[tokio::test]
async fn am_spiegel_ist_wiederoeffnen_409() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    abgeschlossen(&app, &admin, e).await;
    let mut tx = pool.begin().await.unwrap();
    for sql in [
        "INSERT INTO spiegel_uebernahme (id) VALUES (1)".to_string(),
        format!("INSERT INTO einsatz_spiegel (einsatz_id, fremde_kennung) VALUES ({e}, 'x/{e}')"),
        "DELETE FROM spiegel_uebernahme".to_string(),
    ] {
        sqlx::query(sqlx::AssertSqlSafe(sql))
            .execute(&mut *tx)
            .await
            .unwrap();
    }
    tx.commit().await.unwrap();
    let (s, v) = wiedereroeffnen(&app, &admin, e, grund("Versehen")).await;
    assert_eq!(s, StatusCode::CONFLICT, "{v}");
    assert_eq!(status_von(&pool, e).await, "abgeschlossen");
}

// ── 3.7 Abschließende Person im Kopf ─────────────────────────────────────────────────────────

#[tokio::test]
async fn der_kopf_nennt_die_abschliessende_person_mit_namen() {
    let (app, _pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    common::benutzer_anlegen(&app, &admin, "erika", "fuehrungskraft").await;
    let erika = login_cookie(&app, "erika", "erikapw1").await;
    let e = einsatz_anlegen(&app, &erika).await;

    let (s, kopf) = anfrage(&app, "GET", &format!("/api/einsaetze/{e}"), &erika, None).await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(kopf["abgeschlossen_von_name"], Value::Null, "aktiv: {kopf}");

    abgeschlossen(&app, &erika, e).await;
    let (s, kopf) = anfrage(&app, "GET", &format!("/api/einsaetze/{e}"), &erika, None).await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(kopf["abgeschlossen_von_name"], "erika", "{kopf}");
    let (s, liste) = anfrage(&app, "GET", "/api/einsaetze", &erika, None).await;
    assert_eq!(s, StatusCode::OK);
    let eintrag = liste
        .as_array()
        .unwrap()
        .iter()
        .find(|x| x["id"] == e)
        .unwrap();
    assert_eq!(
        eintrag["abgeschlossen_von_name"], "erika",
        "Liste wie Detail"
    );

    let (s, kopf) = wiedereroeffnen(&app, &erika, e, grund("Versehen")).await;
    assert_eq!(s, StatusCode::OK, "{kopf}");
    assert_eq!(kopf["abgeschlossen_von_name"], Value::Null, "{kopf}");
}
