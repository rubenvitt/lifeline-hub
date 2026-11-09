//! Stammdaten-Verteilung (LLH-1493, Spec `stammdaten-verteilung`): zwei echte Instanzen im selben
//! Testprozess wie in `tests/instanz_kopplung.rs`. „Hub“ stellt den Code aus und liefert, „ELW“
//! löst ein, meldet sich und übernimmt.

mod common;
mod instanz_hilfen;

use axum::http::StatusCode;
use instanz_hilfen::*;
use serde_json::{json, Value};

// ── Liefern und übernehmen ───────────────────────────────────────────────────────────────────

#[tokio::test]
async fn grundstock_mit_der_ersten_meldung_und_aenderung_mit_der_naechsten() {
    let (hub, elw) = gekoppelt().await;
    exec(
        &hub.pool,
        "INSERT INTO fahrzeug (org_id, funkrufname) VALUES (1, 'Rotkreuz Nord 1/83-1')",
    )
    .await;
    exec(
        &hub.pool,
        "INSERT INTO qualifikation (org_id, label) VALUES (1, 'Notfallsanitäter (Test)')",
    )
    .await;
    melden(&elw).await;
    let id = lokale_id(&elw, "fahrzeug", "funkrufname", "Rotkreuz Nord 1/83-1").await;
    assert_eq!(
        eine::<i64>(
            &elw.pool,
            "SELECT COUNT(*) FROM qualifikation WHERE label = 'Notfallsanitäter (Test)'"
        )
        .await,
        1
    );
    exec(&hub.pool, "UPDATE fahrzeug SET funkrufname = 'Rotkreuz Nord 1/83-2' WHERE funkrufname = 'Rotkreuz Nord 1/83-1'").await;
    melden(&elw).await;
    assert_eq!(
        eine::<String>(
            &elw.pool,
            &format!("SELECT funkrufname FROM fahrzeug WHERE id = {id}")
        )
        .await,
        "Rotkreuz Nord 1/83-2"
    );
    assert!(
        kopplung_elw(&elw).await["org"]["stammdaten"]["stand"]
            .as_i64()
            .unwrap()
            > 0
    );
}

#[tokio::test]
async fn uebernommene_zeile_ist_nur_lesbar_lokale_ergaenzung_nicht() {
    let (hub, elw) = gekoppelt().await;
    exec(
        &hub.pool,
        "INSERT INTO fahrzeug (org_id, funkrufname) VALUES (1, 'Hub 1')",
    )
    .await;
    melden(&elw).await;
    let id = lokale_id(&elw, "fahrzeug", "funkrufname", "Hub 1").await;
    let (s, v) = common::anfrage_json(
        &elw.app,
        "PATCH",
        &format!("/api/fahrzeuge/{id}"),
        &elw.admin,
        Some(&json!({"bemerkung": "geändert"})),
    )
    .await;
    assert_eq!(s, StatusCode::CONFLICT, "{v}");
    assert_eq!(v["error"], "Wird am Hub gepflegt.");
    let (s, _) = common::anfrage(
        &elw.app,
        "POST",
        &format!("/api/fahrzeuge/{id}/ausser-dienst"),
        &elw.admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::CONFLICT);

    // Geliehenes Fahrzeug: gilt sofort, bearbeitbar, geht nicht an den Hub.
    let (s, v) = common::anfrage_json(
        &elw.app,
        "POST",
        "/api/fahrzeuge",
        &elw.admin,
        Some(&json!({"funkrufname": "Geliehen 1"})),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
    let lokal = v["id"].as_i64().unwrap();
    let (s, v) = common::anfrage_json(
        &elw.app,
        "PATCH",
        &format!("/api/fahrzeuge/{lokal}"),
        &elw.admin,
        Some(&json!({"bemerkung": "von KV Süd"})),
    )
    .await;
    assert!(s.is_success(), "{s} {v}");
    melden(&elw).await;
    assert_eq!(
        eine::<i64>(
            &hub.pool,
            "SELECT COUNT(*) FROM fahrzeug WHERE funkrufname = 'Geliehen 1'"
        )
        .await,
        0
    );
    let (s, v) = common::anfrage(
        &elw.app,
        "GET",
        "/api/instanz/stammdaten/herkunft",
        &elw.admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(v["quelle"], "Lifeline Hub");
    assert!(v["vom_hub"]["fahrzeug"]
        .as_array()
        .unwrap()
        .contains(&json!(id.to_string())));
    assert!(!v["vom_hub"]["fahrzeug"]
        .as_array()
        .unwrap()
        .contains(&json!(lokal.to_string())));
}

#[tokio::test]
async fn gleiches_fahrzeug_wird_zusammengefuehrt_und_behaelt_seine_id() {
    let hub = instanz().await;
    let elw = instanz().await;
    schluessel(&hub).await;
    exec(
        &elw.pool,
        "INSERT INTO fahrzeug (org_id, funkrufname, bemerkung) VALUES (1, 'RK 1', 'alt')",
    )
    .await;
    let vorher = lokale_id(&elw, "fahrzeug", "funkrufname", "RK 1").await;
    exec(
        &hub.pool,
        "INSERT INTO fahrzeug (org_id, funkrufname, bemerkung) VALUES (1, 'RK 1', 'vom Hub')",
    )
    .await;
    koppeln(&hub, &elw).await;
    melden(&elw).await;
    assert_eq!(
        eine::<i64>(
            &elw.pool,
            "SELECT COUNT(*) FROM fahrzeug WHERE funkrufname = 'RK 1'"
        )
        .await,
        1
    );
    assert_eq!(
        lokale_id(&elw, "fahrzeug", "funkrufname", "RK 1").await,
        vorher
    );
    assert_eq!(
        eine::<String>(
            &elw.pool,
            &format!("SELECT bemerkung FROM fahrzeug WHERE id = {vorher}")
        )
        .await,
        "vom Hub"
    );
    // Die Standard-Kataloge beider Instanzen (Status, Qualifikationen) sind ebenso zusammengeführt.
    let doppelt: i64 = eine(
        &elw.pool,
        "SELECT COUNT(*) FROM (SELECT label FROM fahrzeug_status GROUP BY org_id, label HAVING COUNT(*) > 1)",
    )
    .await;
    assert_eq!(doppelt, 0);
}

#[tokio::test]
async fn geloeschte_zeilen_verschwinden_oder_werden_stillgelegt() {
    let (hub, elw) = gekoppelt().await;
    exec(
        &hub.pool,
        "INSERT INTO material (org_id, bezeichnung) VALUES (1, 'Decke')",
    )
    .await;
    exec(
        &hub.pool,
        "INSERT INTO material (org_id, bezeichnung) VALUES (1, 'Trage')",
    )
    .await;
    melden(&elw).await;
    let decke = lokale_id(&elw, "material", "bezeichnung", "Decke").await;
    let einsatz = common::einsatz_anlegen(&elw.app, &elw.admin).await;
    let (s, v) = common::anfrage_json(
        &elw.app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/material"),
        &elw.admin,
        Some(&json!({"material_id": decke})),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
    exec(&hub.pool, "DELETE FROM material").await;
    melden(&elw).await;
    assert_eq!(
        eine::<String>(
            &elw.pool,
            &format!("SELECT dienststatus FROM material WHERE id = {decke}")
        )
        .await,
        "ausser_dienst"
    );
    assert_eq!(
        eine::<i64>(
            &elw.pool,
            "SELECT COUNT(*) FROM material WHERE bezeichnung = 'Trage'"
        )
        .await,
        0
    );
}

#[tokio::test]
async fn vorlage_kommt_mit_typ_fahrzeug_personal_und_qualifikationssoll() {
    let (hub, elw) = gekoppelt().await;
    exec(
        &hub.pool,
        "INSERT INTO einheit_typ (id, org_id, label) VALUES (900, 1, 'San-Trupp')",
    )
    .await;
    exec(
        &hub.pool,
        "INSERT INTO qualifikation (id, org_id, label) VALUES (900, 1, 'RettSan')",
    )
    .await;
    exec(
        &hub.pool,
        "INSERT INTO fahrzeug (id, org_id, funkrufname) VALUES (900, 1, 'KTW 1')",
    )
    .await;
    exec(
        &hub.pool,
        "INSERT INTO personal (id, org_id, name, personalnummer) VALUES (900, 1, 'Max', 'P1')",
    )
    .await;
    exec(
        &hub.pool,
        "INSERT INTO personal_qualifikation VALUES (900, 900)",
    )
    .await;
    exec(
        &hub.pool,
        "INSERT INTO einheit_vorlage (id, org_id, name, typ_id, quali_soll) \
         VALUES (900, 1, 'San 1', 900, '[{\"q\":900,\"n\":2}]')",
    )
    .await;
    exec(
        &hub.pool,
        "INSERT INTO einheit_vorlage_fahrzeug (vorlage_id, fahrzeug_id) VALUES (900, 900)",
    )
    .await;
    exec(&hub.pool, "INSERT INTO einheit_vorlage_personal (vorlage_id, personal_id, fahrzeug_id) VALUES (900, 900, 900)").await;
    melden(&elw).await;
    let typ = lokale_id(&elw, "einheit_typ", "label", "San-Trupp").await;
    let q = lokale_id(&elw, "qualifikation", "label", "RettSan").await;
    let f = lokale_id(&elw, "fahrzeug", "funkrufname", "KTW 1").await;
    let p = lokale_id(&elw, "personal", "name", "Max").await;
    let v = lokale_id(&elw, "einheit_vorlage", "name", "San 1").await;
    assert_eq!(
        eine::<i64>(
            &elw.pool,
            &format!("SELECT typ_id FROM einheit_vorlage WHERE id = {v}")
        )
        .await,
        typ
    );
    let soll: Value = serde_json::from_str(
        &eine::<String>(
            &elw.pool,
            &format!("SELECT quali_soll FROM einheit_vorlage WHERE id = {v}"),
        )
        .await,
    )
    .unwrap();
    assert_eq!(soll, json!([{"q": q, "n": 2}]));
    assert_eq!(
        eine::<i64>(
            &elw.pool,
            &format!("SELECT fahrzeug_id FROM einheit_vorlage_fahrzeug WHERE vorlage_id = {v}")
        )
        .await,
        f
    );
    assert_eq!(
        eine::<i64>(&elw.pool, &format!("SELECT fahrzeug_id FROM einheit_vorlage_personal WHERE vorlage_id = {v} AND personal_id = {p}")).await,
        f
    );
    assert_eq!(
        eine::<i64>(
            &elw.pool,
            &format!("SELECT qualifikation_id FROM personal_qualifikation WHERE personal_id = {p}")
        )
        .await,
        q
    );
}

// ── Konten ───────────────────────────────────────────────────────────────────────────────────

#[tokio::test]
async fn gleicher_kontoname_bleibt_draussen_bis_zum_erneuten_abgleich() {
    let (hub, elw) = gekoppelt().await;
    konto(&hub, "annameier").await;
    konto(&hub, "maxmuster").await;
    konto(&elw, "annameier").await;
    melden(&elw).await;
    let hinweise = kopplung_elw(&elw).await["org"]["stammdaten"]["hinweise"].clone();
    let hinweise: Vec<String> = serde_json::from_value(hinweise).unwrap();
    assert!(
        hinweise.contains(&"Konto „admin“ ist hier schon vergeben.".to_string()),
        "{hinweise:?}"
    );
    assert!(
        hinweise.contains(&"Konto „annameier“ ist hier schon vergeben.".to_string()),
        "{hinweise:?}"
    );
    assert_eq!(
        eine::<i64>(
            &elw.pool,
            "SELECT COUNT(*) FROM benutzer WHERE benutzername = 'maxmuster'"
        )
        .await,
        1
    );
    assert_eq!(
        eine::<i64>(
            &elw.pool,
            "SELECT COUNT(*) FROM benutzer WHERE benutzername = 'annameier'"
        )
        .await,
        1
    );
    // Konflikt lösen und erneut abgleichen.
    exec(
        &elw.pool,
        "UPDATE benutzer SET benutzername = 'annameier-lokal' WHERE benutzername = 'annameier'",
    )
    .await;
    let id = kopplung_elw(&elw).await["id"].as_i64().unwrap();
    let (s, v) = common::anfrage(
        &elw.app,
        "POST",
        &format!("/api/admin/instanz/kopplungen/{id}/stammdaten-neu"),
        &elw.admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert_eq!(
        eine::<i64>(
            &elw.pool,
            "SELECT COUNT(*) FROM benutzer WHERE benutzername = 'annameier'"
        )
        .await,
        1
    );
    let hinweise: Vec<String> =
        serde_json::from_value(v["org"]["stammdaten"]["hinweise"].clone()).unwrap();
    assert!(
        !hinweise.iter().any(|h| h.contains("annameier")),
        "{hinweise:?}"
    );
}

#[tokio::test]
async fn deaktivierung_am_hub_beendet_die_sitzung_am_elw() {
    let (hub, elw) = gekoppelt().await;
    let max = konto(&hub, "maxmuster").await;
    melden(&elw).await;
    let lokal = lokale_id(&elw, "benutzer", "benutzername", "maxmuster").await;
    exec(
        &elw.pool,
        &format!(
            "INSERT INTO session (token_hash, benutzer_id, expires_at, kennung) \
             VALUES ('t', {lokal}, '2999-01-01 00:00:00', 'k')"
        ),
    )
    .await;
    let (s, v) = common::anfrage(
        &hub.app,
        "POST",
        &format!("/api/benutzer/{max}/deaktivieren"),
        &hub.admin,
        None,
    )
    .await;
    assert!(s.is_success(), "{s} {v}");
    melden(&elw).await;
    assert_eq!(
        eine::<i64>(
            &elw.pool,
            &format!("SELECT aktiv FROM benutzer WHERE id = {lokal}")
        )
        .await,
        0
    );
    assert_eq!(
        eine::<i64>(
            &elw.pool,
            &format!("SELECT COUNT(*) FROM session WHERE benutzer_id = {lokal}")
        )
        .await,
        0
    );
}

#[tokio::test]
async fn nach_dem_widerruf_gehoeren_die_zeilen_dem_elw() {
    let (hub, elw) = gekoppelt().await;
    exec(
        &hub.pool,
        "INSERT INTO fahrzeug (org_id, funkrufname) VALUES (1, 'Hub 1')",
    )
    .await;
    melden(&elw).await;
    let id = lokale_id(&elw, "fahrzeug", "funkrufname", "Hub 1").await;
    let k = kopplung_elw(&elw).await["id"].as_i64().unwrap();
    let (s, v) = common::anfrage(
        &elw.app,
        "POST",
        &format!("/api/admin/instanz/kopplungen/{k}/widerrufen"),
        &elw.admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    let (s, v) = common::anfrage_json(
        &elw.app,
        "PATCH",
        &format!("/api/fahrzeuge/{id}"),
        &elw.admin,
        Some(&json!({"bemerkung": "jetzt unseres"})),
    )
    .await;
    assert!(s.is_success(), "{s} {v}");
}

#[tokio::test]
async fn zweite_quelle_fuer_dieselbe_org_liefert_nichts() {
    let (hub, elw) = gekoppelt().await;
    let hub2 = instanz().await;
    lifeline_hub::auth::unterschrift::set_rp(RP.into(), ORIGIN.into());
    schluessel(&hub2).await;
    exec(
        &hub2.pool,
        "INSERT INTO fahrzeug (org_id, funkrufname) VALUES (1, 'Von Hub 2')",
    )
    .await;
    koppeln(&hub2, &elw).await;
    melden(&elw).await;
    let _ = &hub;
    let hinweise: i64 = eine(
        &elw.pool,
        "SELECT COUNT(*) FROM instanz_kopplung_org WHERE stammdaten_hinweis LIKE '%anderen Kopplung%'",
    )
    .await;
    assert_eq!(hinweise, 1);
}

// ── Geheimnisse, Passkey-Pflicht, ELW verloren ───────────────────────────────────────────────

async fn login(i: &Instanz, name: &str, passwort: &str) -> (StatusCode, Value) {
    common::anfrage_json(
        &i.app,
        "POST",
        "/api/auth/login",
        "",
        Some(&json!({"benutzername": name, "passwort": passwort})),
    )
    .await
}

/// Hub und ELW gekoppelt; der ELW bestätigt seine Plattenverschlüsselung, wenn `platte`.
async fn gekoppelt_mit_platte(platte: bool) -> (Instanz, Instanz) {
    let hub = instanz().await;
    let elw = instanz().await;
    schluessel(&hub).await;
    lifeline_hub::instanz::stammdaten::geheimnis::save_datentraeger_bestaetigt(&elw.pool, platte)
        .await
        .unwrap();
    koppeln(&hub, &elw).await;
    (hub, elw)
}

/// Ein Konto am Hub ohne Wechselpflicht, damit die Anmeldung gleich eine Sitzung ergibt.
async fn konto_bereit(hub: &Instanz, name: &str) -> i64 {
    let id = konto(hub, name).await;
    exec(
        &hub.pool,
        &format!("UPDATE benutzer SET passwort_wechsel_pflicht = 0 WHERE id = {id}"),
    )
    .await;
    id
}

#[tokio::test]
async fn anmeldung_am_elw_ohne_netz_mit_passwort_und_totp_vom_hub() {
    let (mut hub, elw) = gekoppelt_mit_platte(true).await;
    let max = konto_bereit(&hub, "maxmuster").await;
    exec(
        &hub.pool,
        &format!("UPDATE benutzer SET totp_secret = 'JBSWY3DPEHPK3PXP', totp_aktiviert = 1 WHERE id = {max}"),
    )
    .await;
    melden(&elw).await;
    hub._server.abort();
    let (s, v) = login(&elw, "maxmuster", "maxmuster-pw-123").await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert_eq!(v["mfa_erforderlich"], "totp", "{v}");
    assert_eq!(
        eine::<String>(
            &elw.pool,
            "SELECT totp_secret FROM benutzer WHERE benutzername = 'maxmuster'"
        )
        .await,
        "JBSWY3DPEHPK3PXP"
    );
    let (s, _) = login(&elw, "maxmuster", "falsch-falsch").await;
    assert_eq!(s, StatusCode::UNAUTHORIZED);
    let _ = &mut hub;
}

#[tokio::test]
async fn ohne_plattenbestaetigung_kommt_das_konto_ohne_geheimnis() {
    let (hub, elw) = gekoppelt_mit_platte(false).await;
    konto_bereit(&hub, "maxmuster").await;
    melden(&elw).await;
    let (s, _) = login(&elw, "maxmuster", "maxmuster-pw-123").await;
    assert_eq!(s, StatusCode::UNAUTHORIZED);
    assert_eq!(
        eine::<String>(
            &elw.pool,
            "SELECT passwort_hash FROM benutzer WHERE benutzername = 'maxmuster'"
        )
        .await,
        lifeline_hub::auth::PASSWORT_HASH_KEIN_LOKALES
    );
    let (_, v) = common::anfrage(&hub.app, "GET", "/api/admin/instanz", &hub.admin, None).await;
    assert_eq!(
        v["kopplungen"][0]["org"]["stammdaten"]["geheimnisse_verteilt"],
        false
    );
    assert_eq!(
        v["kopplungen"][0]["org"]["stammdaten"]["konten_mit_geheimnis"],
        0
    );
}

#[tokio::test]
async fn einmalpasswort_am_elw_bleibt_bis_der_hub_das_passwort_aendert() {
    let (hub, elw) = gekoppelt_mit_platte(true).await;
    let max = konto_bereit(&hub, "maxmuster").await;
    melden(&elw).await;
    let lokal = lokale_id(&elw, "benutzer", "benutzername", "maxmuster").await;
    let (s, v) = common::anfrage(
        &elw.app,
        "POST",
        &format!("/api/benutzer/{lokal}/einmalpasswort"),
        &elw.admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    let einmal = eine::<String>(
        &elw.pool,
        &format!("SELECT passwort_hash FROM benutzer WHERE id = {lokal}"),
    )
    .await;
    // Eine andere Änderung am Konto überschreibt das Einmalpasswort nicht.
    exec(
        &hub.pool,
        &format!("UPDATE benutzer SET anzeigename = 'Max M.' WHERE id = {max}"),
    )
    .await;
    melden(&elw).await;
    assert_eq!(
        eine::<String>(
            &elw.pool,
            &format!("SELECT passwort_hash FROM benutzer WHERE id = {lokal}")
        )
        .await,
        einmal
    );
    // Ein neues Passwort am Hub gilt danach auch am ELW.
    let neu = lifeline_hub::auth::password::hash("ganz-neues-pw-1").unwrap();
    sqlx::query("UPDATE benutzer SET passwort_hash = ? WHERE id = ?")
        .bind(&neu)
        .bind(max)
        .execute(&hub.pool)
        .await
        .unwrap();
    melden(&elw).await;
    assert_eq!(
        eine::<String>(
            &elw.pool,
            &format!("SELECT passwort_hash FROM benutzer WHERE id = {lokal}")
        )
        .await,
        neu
    );
}

#[tokio::test]
async fn admin_mit_passkey_meldet_sich_am_verteilenden_hub_nicht_per_passwort_an() {
    let (hub, elw) = gekoppelt_mit_platte(true).await;
    // Vor der Kopplung ging es, und ohne Passkey geht es weiter.
    let (s, v) = login(&hub, "admin", "startpw12").await;
    assert_eq!(s, StatusCode::OK, "{v}");
    exec(
        &hub.pool,
        "INSERT INTO webauthn_credential (benutzer_id, credential_id, public_key) VALUES (1, x'0102', x'0304')",
    )
    .await;
    let (s, v) = login(&hub, "admin", "startpw12").await;
    assert_eq!(s, StatusCode::FORBIDDEN, "{v}");
    assert_eq!(v["error"], "Admins melden sich hier per Passkey an.");
    let (s, _) = login(&hub, "admin", "falsches-pw").await;
    assert_eq!(s, StatusCode::UNAUTHORIZED);
    // Am ELW, der nichts verteilt, gilt die Regel nicht.
    exec(
        &elw.pool,
        "INSERT INTO webauthn_credential (benutzer_id, credential_id, public_key) VALUES (1, x'0506', x'0708')",
    )
    .await;
    let (s, v) = login(&elw, "admin", "startpw12").await;
    assert_eq!(s, StatusCode::OK, "{v}");
}

#[tokio::test]
async fn elw_verloren_macht_die_verteilten_geheimnisse_wertlos() {
    let (hub, elw) = gekoppelt_mit_platte(true).await;
    let max = konto_bereit(&hub, "maxmuster").await;
    let elw2 = instanz().await;
    lifeline_hub::instanz::stammdaten::geheimnis::save_datentraeger_bestaetigt(&elw2.pool, true)
        .await
        .unwrap();
    koppeln(&hub, &elw2).await;
    melden(&elw).await;
    melden(&elw2).await;
    let (s, _) = login(&hub, "maxmuster", "maxmuster-pw-123").await;
    assert_eq!(s, StatusCode::OK);
    let (_, v) = common::anfrage(&hub.app, "GET", "/api/admin/instanz", &hub.admin, None).await;
    let k = v["kopplungen"]
        .as_array()
        .unwrap()
        .iter()
        .find(|k| k["org"]["stammdaten"]["konten_mit_geheimnis"].as_i64() > Some(0))
        .unwrap()
        .clone();
    let (s, v) = common::anfrage(
        &hub.app,
        "POST",
        &format!("/api/admin/instanz/kopplungen/{}/verloren", k["id"]),
        &hub.admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert!(v["konten"].as_i64().unwrap() >= 1);
    assert_eq!(v["kopplung"]["zustand"], "widerrufen");
    assert_eq!(
        eine::<i64>(
            &hub.pool,
            &format!("SELECT COUNT(*) FROM session WHERE benutzer_id = {max}")
        )
        .await,
        0
    );
    let (s, _) = login(&hub, "maxmuster", "maxmuster-pw-123").await;
    assert_eq!(
        s,
        StatusCode::UNAUTHORIZED,
        "das alte Passwort führt zu nichts"
    );
    assert_eq!(
        eine::<String>(
            &hub.pool,
            "SELECT aktion FROM admin_audit ORDER BY id DESC LIMIT 1"
        )
        .await,
        "instanz_elw_verloren"
    );
    // Der andere ELW bekommt das Konto mit ungültigem Passwort.
    melden(&elw2).await;
    let (s, _) = login(&elw2, "maxmuster", "maxmuster-pw-123").await;
    assert_eq!(s, StatusCode::UNAUTHORIZED);
    // Zurück per Einmalpasswort.
    let (s, v) = common::anfrage(
        &hub.app,
        "POST",
        &format!("/api/benutzer/{max}/einmalpasswort"),
        &hub.admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    let (s, v) = login(&hub, "maxmuster", v["einmalpasswort"].as_str().unwrap()).await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert_eq!(v["passwort_wechsel_erforderlich"], true);
}

#[tokio::test]
async fn sso_konto_bekommt_am_elw_ein_einmalpasswort() {
    let (hub, elw) = gekoppelt_mit_platte(true).await;
    let sina = konto_bereit(&hub, "sinasso").await;
    sqlx::query("UPDATE benutzer SET passwort_hash = ? WHERE id = ?")
        .bind(lifeline_hub::auth::PASSWORT_HASH_SSO_ONLY)
        .bind(sina)
        .execute(&hub.pool)
        .await
        .unwrap();
    melden(&elw).await;
    let lokal = lokale_id(&elw, "benutzer", "benutzername", "sinasso").await;
    let (s, v) = common::anfrage(
        &elw.app,
        "POST",
        &format!("/api/benutzer/{lokal}/einmalpasswort"),
        &elw.admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    let (s, v) = login(&elw, "sinasso", v["einmalpasswort"].as_str().unwrap()).await;
    assert_eq!(s, StatusCode::OK, "{v}");
}

// ── Nachträge aus dem Review ─────────────────────────────────────────────────────────────────

#[tokio::test]
async fn stillgelegte_zeile_verliert_ihre_herkunft_und_eine_wiederverwendete_id_trifft_sie_nicht() {
    let (hub, elw) = gekoppelt().await;
    exec(
        &hub.pool,
        "INSERT INTO material (org_id, bezeichnung) VALUES (1, 'Decke')",
    )
    .await;
    let hub_id: i64 = eine(
        &hub.pool,
        "SELECT id FROM material WHERE bezeichnung = 'Decke'",
    )
    .await;
    melden(&elw).await;
    let decke = lokale_id(&elw, "material", "bezeichnung", "Decke").await;
    let einsatz = common::einsatz_anlegen(&elw.app, &elw.admin).await;
    let (s, v) = common::anfrage_json(
        &elw.app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/material"),
        &elw.admin,
        Some(&json!({"material_id": decke})),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
    exec(&hub.pool, "DELETE FROM material").await;
    melden(&elw).await;
    assert_eq!(
        eine::<i64>(
            &elw.pool,
            &format!(
                "SELECT COUNT(*) FROM stammdaten_herkunft \
                 WHERE art = 'material' AND lokaler_schluessel = '{decke}'"
            )
        )
        .await,
        0,
        "die stillgelegte Zeile gehört jetzt dem ELW"
    );
    // Eine neue Zeile am Hub mit derselben id wird eine neue Zeile, nicht die stillgelegte.
    exec(
        &hub.pool,
        &format!("INSERT INTO material (id, org_id, bezeichnung) VALUES ({hub_id}, 1, 'Schaufel')"),
    )
    .await;
    melden(&elw).await;
    assert_eq!(
        eine::<String>(
            &elw.pool,
            &format!("SELECT bezeichnung FROM material WHERE id = {decke}")
        )
        .await,
        "Decke"
    );
    assert_ne!(
        lokale_id(&elw, "material", "bezeichnung", "Schaufel").await,
        decke
    );
}

#[tokio::test]
async fn geraetekonto_bleibt_am_hub() {
    let (hub, elw) = gekoppelt().await;
    let geraet = konto(&hub, "lagemonitor1").await;
    let einsatz = common::einsatz_anlegen(&hub.app, &hub.admin).await;
    exec(
        &hub.pool,
        &format!(
            "INSERT INTO geraet_kopplung (einsatz_id, benutzer_id, ansicht, bezeichnung, \
             erstellt_von, laeuft_ab_at) VALUES ({einsatz}, {geraet}, 'lagemonitor', 'Monitor', 1, \
             '2099-01-01T00:00:00Z')"
        ),
    )
    .await;
    konto(&hub, "maxmuster").await;
    melden(&elw).await;
    assert_eq!(
        eine::<i64>(
            &elw.pool,
            "SELECT COUNT(*) FROM benutzer WHERE benutzername = 'maxmuster'"
        )
        .await,
        1
    );
    assert_eq!(
        eine::<i64>(
            &elw.pool,
            "SELECT COUNT(*) FROM benutzer WHERE benutzername = 'lagemonitor1'"
        )
        .await,
        0
    );
}

#[tokio::test]
async fn erneut_abgleichen_waehrend_einer_meldung_wird_nicht_ueberschrieben() {
    let (hub, elw) = gekoppelt().await;
    exec(
        &hub.pool,
        "INSERT INTO fahrzeug (org_id, funkrufname) VALUES (1, 'Hub 1')",
    )
    .await;
    melden(&elw).await;
    let (id, gemeldet): (i64, i64) =
        sqlx::query_as("SELECT id, stammdaten_stand FROM instanz_kopplung_org")
            .fetch_one(&elw.pool)
            .await
            .unwrap();
    assert!(gemeldet > 0);
    // „Erneut abgleichen“ setzt den Stand auf 0, während eine Meldung mit dem alten Stand läuft.
    exec(
        &elw.pool,
        "UPDATE instanz_kopplung_org SET stammdaten_stand = 0",
    )
    .await;
    let mut conn = elw.pool.acquire().await.unwrap();
    lifeline_hub::instanz::repo::save_stammdaten_stand(&mut conn, id, gemeldet, gemeldet + 5)
        .await
        .unwrap();
    drop(conn);
    assert_eq!(
        eine::<i64>(
            &elw.pool,
            "SELECT stammdaten_stand FROM instanz_kopplung_org"
        )
        .await,
        0
    );
    // Die passende Meldung schreibt fort, nur vorwärts.
    let mut conn = elw.pool.acquire().await.unwrap();
    lifeline_hub::instanz::repo::save_stammdaten_stand(&mut conn, id, 0, 7)
        .await
        .unwrap();
    lifeline_hub::instanz::repo::save_stammdaten_stand(&mut conn, id, 7, 3)
        .await
        .unwrap();
    drop(conn);
    assert_eq!(
        eine::<i64>(
            &elw.pool,
            "SELECT stammdaten_stand FROM instanz_kopplung_org"
        )
        .await,
        7
    );
}

#[tokio::test]
async fn passkey_pflicht_bleibt_nach_dem_widerruf_wenn_der_hash_geliefert_wurde() {
    let (hub, elw) = gekoppelt_mit_platte(true).await;
    exec(
        &hub.pool,
        "INSERT INTO webauthn_credential (benutzer_id, credential_id, public_key) VALUES (1, x'0102', x'0304')",
    )
    .await;
    melden(&elw).await;
    assert_eq!(
        eine::<i64>(
            &hub.pool,
            "SELECT COUNT(*) FROM instanz_geheimnis_lieferung WHERE benutzer_id = 1"
        )
        .await,
        1
    );
    let (_, v) = common::anfrage(&hub.app, "GET", "/api/admin/instanz", &hub.admin, None).await;
    let k = v["kopplungen"][0]["id"].as_i64().unwrap();
    let (s, v) = common::anfrage(
        &hub.app,
        "POST",
        &format!("/api/admin/instanz/kopplungen/{k}/widerrufen"),
        &hub.admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    let (s, v) = login(&hub, "admin", "startpw12").await;
    assert_eq!(s, StatusCode::FORBIDDEN, "{v}");
}

#[tokio::test]
async fn demo_entfernen_laesst_eine_zeile_vom_hub_stehen() {
    let (hub, elw) = gekoppelt().await;
    let mut tx = elw.pool.begin_with("BEGIN IMMEDIATE").await.unwrap();
    lifeline_hub::demo::import::importieren_tx(
        &mut tx,
        1,
        1,
        lifeline_hub::demo::DemoLage::Starkregen,
        chrono::Utc::now().naive_utc(),
    )
    .await
    .unwrap();
    tx.commit().await.unwrap();
    // Ein Demo-Fahrzeug des ELW, das der Hub mit gleichem Funkrufnamen pflegt: der Abgleich
    // führt beide zusammen, die Zeile ist danach vom Hub.
    let funkrufname: String = eine(
        &elw.pool,
        "SELECT f.funkrufname FROM fahrzeug f JOIN demo_herkunft m \
         ON m.tabelle = 'fahrzeug' AND m.datensatz_id = f.id LIMIT 1",
    )
    .await;
    sqlx::query("INSERT INTO fahrzeug (org_id, funkrufname) VALUES (1, ?)")
        .bind(&funkrufname)
        .execute(&hub.pool)
        .await
        .unwrap();
    melden(&elw).await;
    let id = lokale_id(&elw, "fahrzeug", "funkrufname", &funkrufname).await;
    assert_eq!(
        eine::<i64>(
            &elw.pool,
            &format!(
                "SELECT COUNT(*) FROM stammdaten_herkunft \
                 WHERE art = 'fahrzeug' AND lokaler_schluessel = '{id}'"
            )
        )
        .await,
        1
    );
    let mut tx = elw.pool.begin_with("BEGIN IMMEDIATE").await.unwrap();
    lifeline_hub::demo::entfernen::entfernen_tx(
        &mut tx,
        1,
        lifeline_hub::demo::DemoLage::Starkregen,
    )
    .await
    .expect("Entfernen scheitert nicht an der Zeile vom Hub");
    tx.commit().await.unwrap();
    assert_eq!(
        lokale_id(&elw, "fahrzeug", "funkrufname", &funkrufname).await,
        id
    );
}

#[tokio::test]
async fn elw_verloren_zaehlt_auch_frueher_gelieferte_geheimnisse() {
    let (hub, elw) = gekoppelt_mit_platte(true).await;
    let max = konto_bereit(&hub, "maxmuster").await;
    melden(&elw).await;
    // Die Lieferung hängt an einer früheren, widerrufenen Zuordnung; die Org ist seitdem neu
    // zugeordnet.
    exec(
        &hub.pool,
        "UPDATE instanz_kopplung_org SET widerrufen_at = datetime('now')",
    )
    .await;
    exec(
        &hub.pool,
        "INSERT INTO instanz_kopplung_org (kopplung_id, org_id, fremde_org_kennung, \
         fremde_org_name) SELECT kopplung_id, org_id, fremde_org_kennung, fremde_org_name \
         FROM instanz_kopplung_org LIMIT 1",
    )
    .await;
    let (_, v) = common::anfrage(&hub.app, "GET", "/api/admin/instanz", &hub.admin, None).await;
    let k = v["kopplungen"][0]["id"].as_i64().unwrap();
    let (s, v) = common::anfrage(
        &hub.app,
        "POST",
        &format!("/api/admin/instanz/kopplungen/{k}/verloren"),
        &hub.admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert_eq!(v["konten"], 1, "{v}");
    let (s, _) = login(&hub, "maxmuster", "maxmuster-pw-123").await;
    assert_eq!(s, StatusCode::UNAUTHORIZED);
    let _ = max;
}

// ── Rettungsweg und Admin-Rolle (Entscheidungen 09.11.2026) ──────────────────────────────────

/// Ein zweiter System-Admin am Hub mit Anmelde-Passkey.
async fn admin_mit_passkey(hub: &Instanz, name: &str) -> i64 {
    let id = konto_bereit(hub, name).await;
    exec(
        &hub.pool,
        &format!(
            "UPDATE benutzer SET system_rolle = 'admin' WHERE id = {id};
             INSERT INTO webauthn_credential (benutzer_id, credential_id, public_key)
             VALUES ({id}, x'0a{id:02x}', x'0b')"
        ),
    )
    .await;
    id
}

#[tokio::test]
async fn einmalpasswort_fuer_einen_admin_unter_passkey_pflicht_entfernt_seine_passkeys() {
    let (hub, elw) = gekoppelt_mit_platte(true).await;
    let anna = admin_mit_passkey(&hub, "annaadmin").await;
    let (s, _) = login(&hub, "annaadmin", "annaadmin-pw-123").await;
    assert_eq!(s, StatusCode::FORBIDDEN, "Pflicht gilt");
    let (s, v) = common::anfrage(
        &hub.app,
        "POST",
        &format!("/api/benutzer/{anna}/einmalpasswort"),
        &hub.admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert_eq!(
        eine::<i64>(
            &hub.pool,
            &format!("SELECT COUNT(*) FROM webauthn_credential WHERE benutzer_id = {anna}")
        )
        .await,
        0
    );
    let (s, w) = login(&hub, "annaadmin", v["einmalpasswort"].as_str().unwrap()).await;
    assert_eq!(s, StatusCode::OK, "{w}");
    assert_eq!(w["passwort_wechsel_erforderlich"], true);
    assert_eq!(
        eine::<String>(
            &hub.pool,
            "SELECT detail FROM admin_audit WHERE aktion = 'einmalpasswort_vergeben' \
             ORDER BY id DESC LIMIT 1"
        )
        .await,
        r#"{"passkeys_entfernt":1}"#
    );
    // Am ELW, der nichts verteilt, bleibt der Passkey eines Admins beim Einmalpasswort.
    let berta = admin_mit_passkey(&elw, "bertaadmin").await;
    let (s, v) = common::anfrage(
        &elw.app,
        "POST",
        &format!("/api/benutzer/{berta}/einmalpasswort"),
        &elw.admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert_eq!(
        eine::<i64>(
            &elw.pool,
            &format!("SELECT COUNT(*) FROM webauthn_credential WHERE benutzer_id = {berta}")
        )
        .await,
        1
    );
}

#[tokio::test]
async fn notfallbefehl_gibt_dem_letzten_admin_wieder_zugang() {
    let (hub, _elw) = gekoppelt_mit_platte(true).await;
    exec(
        &hub.pool,
        "INSERT INTO webauthn_credential (benutzer_id, credential_id, public_key) VALUES (1, x'0102', x'0304')",
    )
    .await;
    konto(&hub, "maxmuster").await;
    let (s, _) = login(&hub, "admin", "startpw12").await;
    assert_eq!(s, StatusCode::FORBIDDEN);
    let z = lifeline_hub::auth::notfall::admin_zugang_zuruecksetzen(&hub.pool, "admin")
        .await
        .unwrap();
    assert_eq!(z.passkeys_entfernt, 1);
    let (s, v) = login(&hub, "admin", &z.einmalpasswort).await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert_eq!(v["passwort_wechsel_erforderlich"], true);
    let (akteur, akteur_id, ziel_id): (String, Option<i64>, Option<i64>) = sqlx::query_as(
        "SELECT akteur_name, akteur_id, ziel_benutzer_id FROM admin_audit \
         WHERE aktion = 'einmalpasswort_vergeben' ORDER BY id DESC LIMIT 1",
    )
    .fetch_one(&hub.pool)
    .await
    .unwrap();
    assert_eq!(akteur, lifeline_hub::auth::notfall::AKTEUR);
    assert_eq!(akteur_id, None);
    assert_eq!(
        ziel_id,
        Some(1),
        "der Kontofilter der Admin-Spur findet den Eintrag"
    );
    // Nur für System-Admins.
    assert!(
        lifeline_hub::auth::notfall::admin_zugang_zuruecksetzen(&hub.pool, "maxmuster")
            .await
            .is_err()
    );
    assert!(
        lifeline_hub::auth::notfall::admin_zugang_zuruecksetzen(&hub.pool, "niemand")
            .await
            .is_err()
    );
}

#[tokio::test]
async fn admin_vom_hub_ist_am_elw_admin_nur_wenn_er_eine_org_traegt() {
    let (hub, elw) = gekoppelt().await;
    let anna = konto(&hub, "annaadmin").await;
    exec(
        &hub.pool,
        &format!("UPDATE benutzer SET system_rolle = 'admin' WHERE id = {anna}"),
    )
    .await;
    melden(&elw).await;
    assert_eq!(
        eine::<String>(
            &elw.pool,
            "SELECT system_rolle FROM benutzer WHERE benutzername = 'annaadmin'"
        )
        .await,
        "admin"
    );
    // Eine zweite Org am ELW: mit der nächsten Lieferung kommt sie als `keiner`.
    exec(
        &elw.pool,
        "INSERT INTO organisation (name) VALUES ('Zweite Org')",
    )
    .await;
    exec(
        &hub.pool,
        &format!("UPDATE benutzer SET anzeigename = 'Anna A.' WHERE id = {anna}"),
    )
    .await;
    melden(&elw).await;
    assert_eq!(
        eine::<String>(
            &elw.pool,
            "SELECT system_rolle FROM benutzer WHERE benutzername = 'annaadmin'"
        )
        .await,
        "keiner"
    );
    assert!(eine::<String>(
        &elw.pool,
        "SELECT stammdaten_hinweis FROM instanz_kopplung_org"
    )
    .await
    .contains("„annaadmin“ ist am Hub Admin, hier nicht"));
}

#[tokio::test]
async fn elw_verloren_geht_auch_nach_dem_widerruf_aber_nur_einmal() {
    let (hub, elw) = gekoppelt_mit_platte(true).await;
    konto_bereit(&hub, "maxmuster").await;
    melden(&elw).await;
    let (_, v) = common::anfrage(&hub.app, "GET", "/api/admin/instanz", &hub.admin, None).await;
    let k = v["kopplungen"][0]["id"].as_i64().unwrap();
    let (s, v) = common::anfrage(
        &hub.app,
        "POST",
        &format!("/api/admin/instanz/kopplungen/{k}/widerrufen"),
        &hub.admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    // Der Widerruf lässt die Passwörter dort gelten, also zählt die Kopplung sie weiter.
    let (_, v) = common::anfrage(&hub.app, "GET", "/api/admin/instanz", &hub.admin, None).await;
    assert_eq!(
        v["kopplungen"][0]["org"]["stammdaten"]["konten_mit_geheimnis"],
        1
    );
    let pfad = format!("/api/admin/instanz/kopplungen/{k}/verloren");
    let (s, v) = common::anfrage(&hub.app, "POST", &pfad, &hub.admin, None).await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert_eq!(v["konten"], 1, "{v}");
    assert_eq!(
        v["kopplung"]["org"]["stammdaten"]["konten_mit_geheimnis"],
        0
    );
    let (s, _) = login(&hub, "maxmuster", "maxmuster-pw-123").await;
    assert_eq!(s, StatusCode::UNAUTHORIZED);
    // Ein zweites Mal setzte es wiederhergestellte Zugänge erneut zurück.
    let (s, v) = common::anfrage(&hub.app, "POST", &pfad, &hub.admin, None).await;
    assert_eq!(s, StatusCode::CONFLICT, "{v}");
}
