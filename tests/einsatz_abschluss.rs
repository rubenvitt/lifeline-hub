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
        &format!("/api/einsaetze/{id}/abschliessen"),
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
        "/api/org-einstellungen",
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
        &format!("/api/einsaetze/{id}/abschluss/pruefung"),
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
        &format!("/api/einsaetze/{e}/einheiten/{zug}/status"),
        &admin,
        Some(&json!({ "status_id": anfahrt })),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    let weg = common::einheit_bilden(&app, &admin, e, "Zug entlassen").await;
    let (s, v) = anfrage(
        &app,
        "DELETE",
        &format!("/api/einsaetze/{e}/einheiten/{weg}"),
        &admin,
        None,
    )
    .await;
    assert!(s.is_success(), "{v}");
    common::person_anlegen(&app, &admin, e, r#"{"name":"Muster"}"#).await;
    anlegen(
        &app,
        &admin,
        &format!("/api/einsaetze/{e}/auftraege"),
        json!({ "auftrag_text": "Deich sichern",
                "empfaenger": [{ "empfaenger_typ": "funktion", "funktion_text": "Nord" }] }),
    )
    .await;
    anlegen(
        &app,
        &admin,
        &format!("/api/einsaetze/{e}/meldungen"),
        json!({ "absender": "Florian 1", "empfaenger": "ELW 1", "meldeweg": "funk",
                "inhalt": "Deich instabil", "ereigniszeit": "2026-06-12 09:00:00" }),
    )
    .await;
    anlegen(
        &app,
        &admin,
        &format!("/api/einsaetze/{e}/nachforderungen"),
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
        &format!("/api/einsaetze/{e}/modul-overrides/personen"),
        &admin,
        Some(r#"{"sichtbar":false,"benoetigte_rolle":null}"#),
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    let (s, _) = anfrage(
        &app,
        "GET",
        &format!("/api/einsaetze/{e}/personen"),
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
    assert_eq!(p["betroffene"]["anzahl"], 1, "{p}");
    assert_eq!(
        p["betroffene"]["eintraege"][0]["bezeichnung"],
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
