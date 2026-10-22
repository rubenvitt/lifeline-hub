//! Übliche Arten der Organisation für Schnellwahl und Vorschläge (LLH-1379,
//! `/mnt/project-files/llh-1021/llh-1379/design.md`): gezählt wird nur über Einsätze, deren
//! Nachforderungen der Benutzer selbst lesen darf (D1), in der Org des Einsatzes, ohne den
//! laufenden (D2), ohne geschwärzte oder gelöschte (D4), nach Zahl der Einsätze (D5).
use axum::http::StatusCode;

mod common;
use common::{
    anfrage, benutzer_anlegen, einsatz_anlegen_mit, login_cookie, rolle_setzen, setup_mit_pool,
};

async fn absetzen(app: &axum::Router, cookie: &str, e: i64, art: &str) {
    let body = serde_json::json!({ "art": art, "adressat_kategorie": "leitstelle" }).to_string();
    let (s, n) = anfrage(
        app,
        "POST",
        &format!("/api/einsaetze/{e}/nachforderungen"),
        cookie,
        Some(&body),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{n:?}");
}

async fn arten(app: &axum::Router, cookie: &str, e: i64) -> Vec<(String, i64)> {
    let (s, json) = anfrage(
        app,
        "GET",
        &format!("/api/einsaetze/{e}/nachforderungen/arten"),
        cookie,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{json:?}");
    json.as_array()
        .unwrap()
        .iter()
        .map(|a| {
            (
                a["art"].as_str().unwrap().to_string(),
                a["einsaetze"].as_i64().unwrap(),
            )
        })
        .collect()
}

fn namen(liste: &[(String, i64)]) -> Vec<&str> {
    liste.iter().map(|(a, _)| a.as_str()).collect()
}

#[tokio::test]
async fn ein_benutzer_sieht_nur_arten_aus_einsaetzen_die_er_lesen_darf() {
    let (app, _pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let a = einsatz_anlegen_mit(&app, &admin, "Hochwasser").await;
    let b = einsatz_anlegen_mit(&app, &admin, "Gesperrt").await;
    let c = einsatz_anlegen_mit(&app, &admin, "Laufend").await;
    let erika = benutzer_anlegen(&app, &admin, "erika", "keine").await;
    rolle_setzen(&app, &admin, a, erika, "fuehrungspersonal").await;
    rolle_setzen(&app, &admin, c, erika, "fuehrungspersonal").await;
    absetzen(&app, &admin, a, "Sandsäcke").await;
    absetzen(&app, &admin, b, "Dolmetscher Ukrainisch").await;
    absetzen(&app, &admin, c, "Feldbetten").await;
    let erika_c = login_cookie(&app, "erika", "erikapw1").await;

    let fuer_erika = arten(&app, &erika_c, c).await;
    assert_eq!(
        namen(&fuer_erika),
        vec!["Sandsäcke"],
        "nur der lesbare Einsatz zählt, der laufende nicht"
    );

    // Der System-Admin liest jeden Einsatz der Org; der laufende bleibt draußen.
    let fuer_admin = namen(&arten(&app, &admin, c).await)
        .into_iter()
        .map(str::to_string)
        .collect::<Vec<_>>();
    assert!(fuer_admin.contains(&"Sandsäcke".to_string()));
    assert!(fuer_admin.contains(&"Dolmetscher Ukrainisch".to_string()));
    assert!(!fuer_admin.contains(&"Feldbetten".to_string()));
}

#[tokio::test]
async fn ohne_zugriff_auf_das_modul_im_anderen_einsatz_zaehlt_er_nicht() {
    let (app, _pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let a = einsatz_anlegen_mit(&app, &admin, "Ausgeblendet").await;
    let c = einsatz_anlegen_mit(&app, &admin, "Laufend").await;
    let erika = benutzer_anlegen(&app, &admin, "erika", "keine").await;
    rolle_setzen(&app, &admin, a, erika, "fuehrungspersonal").await;
    rolle_setzen(&app, &admin, c, erika, "fuehrungspersonal").await;
    absetzen(&app, &admin, a, "Tauchpumpe").await;
    let (s, _) = anfrage(
        &app,
        "PUT",
        &format!("/api/einsaetze/{a}/modul-overrides/nachforderungen"),
        &admin,
        Some(r#"{"sichtbar":null,"benoetigte_rolle":"fuehrungskraft"}"#),
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    let erika_c = login_cookie(&app, "erika", "erikapw1").await;
    // Gegenprobe: dieselbe Tür wie die Liste des anderen Einsatzes.
    let (s, _) = anfrage(
        &app,
        "GET",
        &format!("/api/einsaetze/{a}/nachforderungen"),
        &erika_c,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::FORBIDDEN);
    assert!(arten(&app, &erika_c, c).await.is_empty());
}

#[tokio::test]
async fn nach_der_nachlauffrist_zaehlt_ein_abgeschlossener_einsatz_nur_fuer_die_leitung() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let a = einsatz_anlegen_mit(&app, &admin, "Alt").await;
    let c = einsatz_anlegen_mit(&app, &admin, "Laufend").await;
    let erika = benutzer_anlegen(&app, &admin, "erika", "keine").await;
    let otto = benutzer_anlegen(&app, &admin, "ottokar", "keine").await;
    rolle_setzen(&app, &admin, a, erika, "fuehrungspersonal").await;
    rolle_setzen(&app, &admin, a, otto, "einsatzleitung").await;
    rolle_setzen(&app, &admin, c, erika, "fuehrungspersonal").await;
    rolle_setzen(&app, &admin, c, otto, "fuehrungspersonal").await;
    absetzen(&app, &admin, a, "Notstromaggregat").await;
    sqlx::query(
        "UPDATE einsatz SET status = 'abgeschlossen', \
                abgeschlossen_at = datetime('now', '-3 days') WHERE id = ?",
    )
    .bind(a)
    .execute(&pool)
    .await
    .unwrap();
    let erika_c = login_cookie(&app, "erika", "erikapw1").await;
    let otto_c = login_cookie(&app, "ottokar", "ottokarpw1").await;
    assert!(arten(&app, &erika_c, c).await.is_empty());
    assert_eq!(
        namen(&arten(&app, &otto_c, c).await),
        vec!["Notstromaggregat"]
    );
}

#[tokio::test]
async fn geschwaerzte_geloeschte_und_fremde_einsaetze_tragen_nichts_bei() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let geschwaerzt = einsatz_anlegen_mit(&app, &admin, "Geschwärzt").await;
    let geloescht = einsatz_anlegen_mit(&app, &admin, "Gelöscht").await;
    let fremd = einsatz_anlegen_mit(&app, &admin, "Fremd").await;
    let mit_platzhalter = einsatz_anlegen_mit(&app, &admin, "Platzhalter").await;
    let c = einsatz_anlegen_mit(&app, &admin, "Laufend").await;
    absetzen(&app, &admin, geschwaerzt, "Familie Kowalenko abholen").await;
    absetzen(&app, &admin, geloescht, "Bagger Fa. Müller").await;
    absetzen(&app, &admin, fremd, "Fremdart").await;
    absetzen(&app, &admin, mit_platzhalter, "Wird geschwärzt").await;
    absetzen(&app, &admin, mit_platzhalter, "Drehleiter").await;
    sqlx::query("UPDATE einsatz SET geschwaerzt_at = datetime('now') WHERE id = ?")
        .bind(geschwaerzt)
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query("UPDATE einsatz SET geloescht_at = datetime('now') WHERE id = ?")
        .bind(geloescht)
        .execute(&pool)
        .await
        .unwrap();
    let fremde_org: i64 = sqlx::query_scalar(
        "INSERT INTO organisation (name, tz_organisation) \
         VALUES ('Nachbar-Org', 'hilfsorganisation') RETURNING id",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    sqlx::query("UPDATE einsatz SET org_id = ? WHERE id = ?")
        .bind(fremde_org)
        .bind(fremd)
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query(
        "UPDATE nachforderung SET art = ? WHERE einsatz_id = ? AND art = 'Wird geschwärzt'",
    )
    .bind(lifeline_hub::einsatz::repo::SCHWAERZUNG_PLATZHALTER)
    .bind(mit_platzhalter)
    .execute(&pool)
    .await
    .unwrap();

    assert_eq!(namen(&arten(&app, &admin, c).await), vec!["Drehleiter"]);
}

#[tokio::test]
async fn ueblich_heisst_in_vielen_einsaetzen_nicht_oft_in_einem() {
    let (app, _pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let flut = einsatz_anlegen_mit(&app, &admin, "Flut").await;
    let x = einsatz_anlegen_mit(&app, &admin, "X").await;
    let y = einsatz_anlegen_mit(&app, &admin, "Y").await;
    let c = einsatz_anlegen_mit(&app, &admin, "Laufend").await;
    for _ in 0..3 {
        absetzen(&app, &admin, flut, "Sandsäcke").await;
    }
    absetzen(&app, &admin, x, "rtw ").await;
    absetzen(&app, &admin, y, "RTW").await;

    let liste = arten(&app, &admin, c).await;
    assert_eq!(
        liste,
        vec![("RTW".to_string(), 2), ("Sandsäcke".to_string(), 1)],
        "zwei Einsätze vor einem, gleich ohne Groß-/Kleinschreibung, jüngste Schreibweise"
    );
}

#[tokio::test]
async fn ein_beobachter_bekommt_die_arten_wie_die_liste() {
    let (app, _pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let c = einsatz_anlegen_mit(&app, &admin, "Laufend").await;
    let fremder = einsatz_anlegen_mit(&app, &admin, "Ohne Erika").await;
    let erika = benutzer_anlegen(&app, &admin, "erika", "keine").await;
    rolle_setzen(&app, &admin, c, erika, "beobachter").await;
    let erika_c = login_cookie(&app, "erika", "erikapw1").await;
    assert!(arten(&app, &erika_c, c).await.is_empty());
    // Ohne Mitgliedschaft im Einsatz selbst: dieselbe Tür wie die Liste.
    let (s, _) = anfrage(
        &app,
        "GET",
        &format!("/api/einsaetze/{fremder}/nachforderungen/arten"),
        &erika_c,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::FORBIDDEN);
}
