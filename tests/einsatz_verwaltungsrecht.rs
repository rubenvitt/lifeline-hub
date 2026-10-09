//! Verwaltungsrouten am Einsatz (LFH-1066): Kopfdaten, Einstellungen und Führungsstelle hinter
//! `EinsatzVerwaltungszugriff`. Der System-Admin schreibt ohne Mitgliedschaft nur an Einsätzen
//! seiner eigenen Org; Lesen bleibt serverweit, eine Mitgliedschaft trägt über die Org-Grenze.
//! Derselbe Schnitt wie am Frist-PUT und am Modul-Override (`src/AGENTS.md`,
//! „Admin-Schreibwege am Einsatz“).

use axum::http::StatusCode;
use serde_json::{json, Value};

mod common;
use common::*;

/// Einsatz einer Führungskraft der eigenen Org: der Admin ist dort KEIN Mitglied.
async fn einsatz_ohne_admin(app: &axum::Router, admin: &str) -> (i64, String) {
    benutzer_anlegen(app, admin, "fuehrung", "fuehrungskraft").await;
    let fk = login_cookie(app, "fuehrung", "fuehrungpw1").await;
    let einsatz = einsatz_anlegen_mit(app, &fk, "Hochwasser").await;
    (einsatz, fk)
}

/// System-Admin einer zweiten Org (`fremde_org_anlegen` legt `keiner` an, die Rolle per SQL).
async fn fremder_admin(app: &axum::Router, pool: &sqlx::SqlitePool) -> String {
    let (_, id) = fremde_org_anlegen(pool, "Nachbar", "fremdadmin", "fremdpw12", "keine").await;
    sqlx::query("UPDATE benutzer SET system_rolle = 'admin' WHERE id = ?")
        .bind(id)
        .execute(pool)
        .await
        .unwrap();
    login_cookie(app, "fremdadmin", "fremdpw12").await
}

async fn mitglied_per_sql(pool: &sqlx::SqlitePool, einsatz: i64, benutzername: &str, rolle: &str) {
    sqlx::query(
        "INSERT INTO einsatz_mitgliedschaft (einsatz_id, benutzer_id, einsatz_rolle) \
         SELECT ?, id, ? FROM benutzer WHERE benutzername = ?",
    )
    .bind(einsatz)
    .bind(rolle)
    .bind(benutzername)
    .execute(pool)
    .await
    .unwrap();
}

async fn sprechgruppe(app: &axum::Router, cookie: &str, einsatz: i64) -> i64 {
    let (status, json) = anfrage_json(
        app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/sprechgruppen"),
        cookie,
        Some(&json!({"bezeichnung": "311", "betriebsart": "TMO"})),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "Sprechgruppe: {json:?}");
    json["id"].as_i64().unwrap()
}

/// Die fünf Schreibwege hinter `EinsatzVerwaltungszugriff`, je mit einer wirksamen Änderung.
async fn alle_schreibwege(
    app: &axum::Router,
    cookie: &str,
    einsatz: i64,
    sg: i64,
) -> Vec<StatusCode> {
    let basis = format!("/api/einsaetze/{einsatz}");
    let mut s = Vec::new();
    for (methode, pfad, body) in [
        (
            "PATCH",
            basis.clone(),
            Some(json!({"leitstellen_nr": "ILS-1"})),
        ),
        (
            "PUT",
            format!("{basis}/einstellungen"),
            Some(json!({"auftrag_quittierung_frist_min": 45})),
        ),
        (
            "PATCH",
            format!("{basis}/fuehrungsstelle"),
            Some(json!({"rufname": "Florian 1"})),
        ),
        (
            "PUT",
            format!("{basis}/fuehrungsstelle/sprechgruppen/{sg}"),
            None,
        ),
        (
            "DELETE",
            format!("{basis}/fuehrungsstelle/sprechgruppen/{sg}"),
            None,
        ),
    ] {
        s.push(
            anfrage_json(app, methode, &pfad, cookie, body.as_ref())
                .await
                .0,
        );
    }
    s
}

async fn stand(app: &axum::Router, cookie: &str, einsatz: i64) -> (Value, Value, Value) {
    let basis = format!("/api/einsaetze/{einsatz}");
    let (s1, kopf) = anfrage(app, "GET", &basis, cookie, None).await;
    let (s2, einst) = anfrage(app, "GET", &format!("{basis}/einstellungen"), cookie, None).await;
    let (s3, fs) = anfrage(
        app,
        "GET",
        &format!("{basis}/fuehrungsstelle"),
        cookie,
        None,
    )
    .await;
    assert_eq!(
        (s1, s2, s3),
        (StatusCode::OK, StatusCode::OK, StatusCode::OK)
    );
    (
        kopf["leitstellen_nr"].clone(),
        einst["auftrag_quittierung_frist_min"].clone(),
        fs,
    )
}

#[tokio::test]
async fn admin_einer_fremden_org_schreibt_an_keiner_verwaltungsroute() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let (einsatz, fk) = einsatz_ohne_admin(&app, &admin).await;
    let sg = sprechgruppe(&app, &fk, einsatz).await;
    // Die Zuordnung steht schon, damit auch das DELETE etwas lösen könnte.
    let (s, _) = anfrage(
        &app,
        "PUT",
        &format!("/api/einsaetze/{einsatz}/fuehrungsstelle/sprechgruppen/{sg}"),
        &fk,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::NO_CONTENT);
    let vorher = stand(&app, &fk, einsatz).await;

    let fremd = fremder_admin(&app, &pool).await;
    assert_eq!(
        alle_schreibwege(&app, &fremd, einsatz, sg).await,
        vec![StatusCode::FORBIDDEN; 5]
    );
    assert_eq!(stand(&app, &fk, einsatz).await, vorher, "nichts geändert");

    // Lesen bleibt serverweit.
    assert_eq!(stand(&app, &fremd, einsatz).await, vorher);
}

#[tokio::test]
async fn admin_einer_fremden_org_bekommt_am_abgeschlossenen_einsatz_403() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let (einsatz, _) = einsatz_ohne_admin(&app, &admin).await;
    sqlx::query(
        "UPDATE einsatz SET status = 'abgeschlossen', abgeschlossen_at = datetime('now') WHERE id = ?",
    )
    .bind(einsatz)
    .execute(&pool)
    .await
    .unwrap();
    let fremd = fremder_admin(&app, &pool).await;

    let (s, _) = anfrage_json(
        &app,
        "PATCH",
        &format!("/api/einsaetze/{einsatz}"),
        &fremd,
        Some(&json!({"leitstellen_nr": "ILS-1"})),
    )
    .await;
    assert_eq!(s, StatusCode::FORBIDDEN, "Recht vor Zustand");
    let (s, _) = anfrage_json(
        &app,
        "PATCH",
        &format!("/api/einsaetze/{einsatz}"),
        &admin,
        Some(&json!({"leitstellen_nr": "ILS-1"})),
    )
    .await;
    assert_eq!(
        s,
        StatusCode::CONFLICT,
        "der eigene Admin trifft den Freeze"
    );
}

#[tokio::test]
async fn mitgliedschaft_traegt_ueber_die_org_grenze() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let fremd = fremder_admin(&app, &pool).await;

    for rolle in ["einsatzleitung", "fuehrungspersonal"] {
        let einsatz = einsatz_anlegen_mit(&app, &admin, rolle).await;
        mitglied_per_sql(&pool, einsatz, "fremdadmin", rolle).await;
        let sg = sprechgruppe(&app, &admin, einsatz).await;
        assert_eq!(
            alle_schreibwege(&app, &fremd, einsatz, sg).await,
            vec![
                StatusCode::OK,
                StatusCode::OK,
                StatusCode::OK,
                StatusCode::NO_CONTENT,
                StatusCode::NO_CONTENT
            ],
            "{rolle}"
        );
    }

    let als_beobachter = einsatz_anlegen_mit(&app, &admin, "beobachter").await;
    mitglied_per_sql(&pool, als_beobachter, "fremdadmin", "beobachter").await;
    let sg = sprechgruppe(&app, &admin, als_beobachter).await;
    assert_eq!(
        alle_schreibwege(&app, &fremd, als_beobachter, sg).await,
        vec![StatusCode::FORBIDDEN; 5]
    );
}

#[tokio::test]
async fn admin_der_eigenen_org_schreibt_ohne_mitgliedschaft() {
    let (app, _pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let (einsatz, fk) = einsatz_ohne_admin(&app, &admin).await;
    let sg = sprechgruppe(&app, &fk, einsatz).await;

    assert_eq!(
        alle_schreibwege(&app, &admin, einsatz, sg).await,
        vec![
            StatusCode::OK,
            StatusCode::OK,
            StatusCode::OK,
            StatusCode::NO_CONTENT,
            StatusCode::NO_CONTENT
        ]
    );
    let (leitstellen_nr, frist, fs) = stand(&app, &fk, einsatz).await;
    assert_eq!(leitstellen_nr, "ILS-1");
    assert_eq!(frist, 45);
    assert_eq!(fs["rufname"], "Florian 1");
}
