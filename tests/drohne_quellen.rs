//! Drohnenquelle je Einsatz zu- und abschalten (LLH-2105): `/api/incidents/{id}/drone/sources`.

use axum::http::StatusCode;
use serde_json::{json, Value};
use sqlx::SqlitePool;

mod common;
use common::{
    anfrage, benutzer_anlegen, einsatz_anlegen_mit, fremde_org_anlegen, login_cookie, rolle_setzen,
    system_etb_inhalte,
};

struct Umgebung {
    app: axum::Router,
    pool: SqlitePool,
    org_id: i64,
    admin: String,
    einsatz: i64,
}

async fn umgebung() -> Umgebung {
    let (app, pool) = common::setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen_mit(&app, &admin, "Lage A").await;
    let org_id: i64 = sqlx::query_scalar("SELECT org_id FROM einsatz WHERE id = ?")
        .bind(einsatz)
        .fetch_one(&pool)
        .await
        .unwrap();
    Umgebung {
        app,
        pool,
        org_id,
        admin,
        einsatz,
    }
}

impl Umgebung {
    async fn adapter(&self, id: &str, art: &str, org_id: i64) {
        sqlx::query(
            "INSERT INTO adapter (id, org_id, art, name, intervall_s) VALUES (?, ?, ?, 'Drohnen Nord', 30)",
        )
        .bind(id)
        .bind(org_id)
        .bind(art)
        .execute(&self.pool)
        .await
        .unwrap();
    }

    fn pfad(&self, einsatz: i64, aid: &str) -> String {
        format!("/api/incidents/{einsatz}/drone/sources/{aid}")
    }

    async fn zuschalten(&self, einsatz: i64, aid: &str) -> (StatusCode, Value) {
        anfrage(
            &self.app,
            "PUT",
            &self.pfad(einsatz, aid),
            &self.admin,
            Some(&json!({"lagemonitor": true}).to_string()),
        )
        .await
    }

    async fn schliessen(&self, einsatz: i64) {
        let (s, v) = anfrage(
            &self.app,
            "POST",
            &format!("/api/incidents/{einsatz}/close"),
            &self.admin,
            None,
        )
        .await;
        assert_eq!(s, StatusCode::OK, "{v:?}");
    }

    async fn zeilen(&self) -> Vec<(String, i64, bool)> {
        sqlx::query_as(
            "SELECT adapter_id, einsatz_id, lagemonitor FROM adapter_einsatz \
             ORDER BY adapter_id, einsatz_id",
        )
        .fetch_all(&self.pool)
        .await
        .unwrap()
    }

    async fn liste(&self, einsatz: i64, cookie: &str) -> (StatusCode, Value) {
        anfrage(
            &self.app,
            "GET",
            &format!("/api/incidents/{einsatz}/drone/sources"),
            cookie,
            None,
        )
        .await
    }
}

#[tokio::test]
async fn einsatzleitung_schaltet_zu_und_ab() {
    let u = umgebung().await;
    u.adapter("a1", "suchlage", u.org_id).await;
    u.adapter("a2", "test", u.org_id).await;

    let (s, liste) = u.liste(u.einsatz, &u.admin).await;
    assert_eq!(s, StatusCode::OK);
    // Nur Quellen mit Drohnenvertrag stehen in der Liste.
    assert_eq!(liste.as_array().unwrap().len(), 1);
    assert_eq!(liste[0]["adapter_id"], "a1");
    assert_eq!(liste[0]["label"], "Drohnen Nord");
    assert_eq!(liste[0]["connected"], false);

    let (s, v) = u.zuschalten(u.einsatz, "a1").await;
    assert_eq!(s, StatusCode::OK, "{v:?}");
    assert_eq!(v["connected"], true);
    assert_eq!(v["lagemonitor"], true);
    assert!(v["held_by_other"].is_null());
    assert!(v["video_keys"].as_array().unwrap().is_empty());

    let (_, liste) = u.liste(u.einsatz, &u.admin).await;
    assert_eq!(liste[0]["connected"], true);

    let (s, _) = anfrage(&u.app, "DELETE", &u.pfad(u.einsatz, "a1"), &u.admin, None).await;
    assert_eq!(s, StatusCode::NO_CONTENT);
    let (_, liste) = u.liste(u.einsatz, &u.admin).await;
    assert_eq!(liste[0]["connected"], false);
}

#[tokio::test]
async fn beobachter_darf_lesen_aber_nicht_zuschalten() {
    let u = umgebung().await;
    u.adapter("a1", "suchlage", u.org_id).await;
    let beob = benutzer_anlegen(&u.app, &u.admin, "beobachter", "keine").await;
    rolle_setzen(&u.app, &u.admin, u.einsatz, beob, "beobachter").await;
    let cookie = login_cookie(&u.app, "beobachter", "beobachterpw1").await;

    let (s, liste) = u.liste(u.einsatz, &cookie).await;
    assert_eq!(s, StatusCode::OK, "{liste:?}");
    assert_eq!(liste.as_array().unwrap().len(), 1);

    let (s, _) = anfrage(
        &u.app,
        "PUT",
        &u.pfad(u.einsatz, "a1"),
        &cookie,
        Some(r#"{"lagemonitor":false}"#),
    )
    .await;
    assert_eq!(s, StatusCode::FORBIDDEN);
    let (s, _) = anfrage(&u.app, "DELETE", &u.pfad(u.einsatz, "a1"), &cookie, None).await;
    assert_eq!(s, StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn zweiter_einsatz_bekommt_409() {
    let u = umgebung().await;
    u.adapter("a1", "suchlage", u.org_id).await;
    let zweiter = einsatz_anlegen_mit(&u.app, &u.admin, "Lage B").await;

    let (s, _) = u.zuschalten(u.einsatz, "a1").await;
    assert_eq!(s, StatusCode::OK);
    let (s, body) = u.zuschalten(zweiter, "a1").await;
    assert_eq!(s, StatusCode::CONFLICT, "{body:?}");
    // Der Konflikt legt für den zweiten Einsatz keine Zeile an.
    assert_eq!(u.zeilen().await, vec![("a1".to_string(), u.einsatz, true)]);

    // Im zweiten Einsatz steht die Quelle als „gehalten“, mit dem Namen des ersten.
    let (_, liste) = u.liste(zweiter, &u.admin).await;
    assert_eq!(liste[0]["connected"], false);
    assert_eq!(liste[0]["held_by_other"], "Lage A");

    // Nach dem Abschalten im ersten geht es im zweiten.
    let (s, _) = anfrage(&u.app, "DELETE", &u.pfad(u.einsatz, "a1"), &u.admin, None).await;
    assert_eq!(s, StatusCode::NO_CONTENT);
    let (s, _) = u.zuschalten(zweiter, "a1").await;
    assert_eq!(s, StatusCode::OK);
}

#[tokio::test]
async fn fremde_org_bekommt_404() {
    let u = umgebung().await;
    let (fremd_org, _) = fremde_org_anlegen(&u.pool, "Fremd", "fremd", "fremdpw12", "keine").await;
    u.adapter("fremd-1", "suchlage", fremd_org).await;

    let (s, _) = u.zuschalten(u.einsatz, "fremd-1").await;
    assert_eq!(s, StatusCode::NOT_FOUND);
    let (s, _) = anfrage(
        &u.app,
        "DELETE",
        &u.pfad(u.einsatz, "fremd-1"),
        &u.admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::NOT_FOUND);
    let (_, liste) = u.liste(u.einsatz, &u.admin).await;
    assert!(liste.as_array().unwrap().is_empty());
}

#[tokio::test]
async fn adapter_anderer_art_ergibt_422() {
    let u = umgebung().await;
    u.adapter("a2", "test", u.org_id).await;
    let (s, _) = u.zuschalten(u.einsatz, "a2").await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY);
}

#[tokio::test]
async fn zuschalten_schreibt_ins_etb() {
    let u = umgebung().await;
    u.adapter("a1", "suchlage", u.org_id).await;

    u.zuschalten(u.einsatz, "a1").await;
    // Erneutes Zuschalten (nur die Lagemonitor-Wahl ändert sich) schreibt nichts mehr.
    u.zuschalten(u.einsatz, "a1").await;
    let inhalte = system_etb_inhalte(&u.app, &u.admin, u.einsatz).await;
    let n = inhalte
        .iter()
        .filter(|i| i.contains("Drohnenbild aus Suchlage zugeschaltet"))
        .count();
    assert_eq!(n, 1, "{inhalte:?}");

    anfrage(&u.app, "DELETE", &u.pfad(u.einsatz, "a1"), &u.admin, None).await;
    let inhalte = system_etb_inhalte(&u.app, &u.admin, u.einsatz).await;
    assert!(
        inhalte
            .iter()
            .any(|i| i.contains("Drohnenbild aus Suchlage abgeschaltet")),
        "{inhalte:?}"
    );
}

#[tokio::test]
async fn abgeschlossener_einsatz_kann_nicht_zuschalten() {
    let u = umgebung().await;
    u.adapter("a1", "suchlage", u.org_id).await;
    let (s, _) = anfrage(
        &u.app,
        "POST",
        &format!("/api/incidents/{}/close", u.einsatz),
        &u.admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK);

    let (s, _) = u.zuschalten(u.einsatz, "a1").await;
    assert_eq!(s, StatusCode::CONFLICT);
    let n: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM adapter_einsatz")
        .fetch_one(&u.pool)
        .await
        .unwrap();
    assert_eq!(n, 0);
}

#[tokio::test]
async fn fuehrungspersonal_bekommt_am_abgeschlossenen_einsatz_403_statt_409() {
    let u = umgebung().await;
    u.adapter("a1", "suchlage", u.org_id).await;
    let fuehrung = benutzer_anlegen(&u.app, &u.admin, "fuehrung", "keine").await;
    rolle_setzen(&u.app, &u.admin, u.einsatz, fuehrung, "fuehrungspersonal").await;
    let cookie = login_cookie(&u.app, "fuehrung", "fuehrungpw1").await;
    let (s, _) = anfrage(
        &u.app,
        "POST",
        &format!("/api/incidents/{}/close", u.einsatz),
        &u.admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK);

    let (s, _) = anfrage(
        &u.app,
        "PUT",
        &u.pfad(u.einsatz, "a1"),
        &cookie,
        Some(r#"{"lagemonitor":true}"#),
    )
    .await;
    assert_eq!(s, StatusCode::FORBIDDEN);
    let (s, _) = anfrage(&u.app, "DELETE", &u.pfad(u.einsatz, "a1"), &cookie, None).await;
    assert_eq!(s, StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn nur_die_lagemonitor_wahl_aendern_setzt_das_flag() {
    let u = umgebung().await;
    u.adapter("a1", "suchlage", u.org_id).await;
    let (s, _) = u.zuschalten(u.einsatz, "a1").await;
    assert_eq!(s, StatusCode::OK);

    let (s, v) = anfrage(
        &u.app,
        "PUT",
        &u.pfad(u.einsatz, "a1"),
        &u.admin,
        Some(r#"{"lagemonitor":false}"#),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v:?}");
    assert_eq!(v["lagemonitor"], false);
    assert_eq!(u.zeilen().await, vec![("a1".to_string(), u.einsatz, false)]);
    let (_, liste) = u.liste(u.einsatz, &u.admin).await;
    assert_eq!(liste[0]["lagemonitor"], false);
    assert_eq!(liste[0]["connected"], true);
}

#[tokio::test]
async fn abschluss_raeumt_die_zuschaltung_ab() {
    let u = umgebung().await;
    u.adapter("a1", "suchlage", u.org_id).await;
    let (s, _) = u.zuschalten(u.einsatz, "a1").await;
    assert_eq!(s, StatusCode::OK);

    u.schliessen(u.einsatz).await;
    assert!(u.zeilen().await.is_empty());
    let (s, liste) = u.liste(u.einsatz, &u.admin).await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(liste[0]["connected"], false);
    assert!(liste[0]["held_by_other"].is_null());

    // Abschalten am abgeschlossenen Einsatz ist ein Konflikt und ändert nichts.
    let (s, _) = anfrage(&u.app, "DELETE", &u.pfad(u.einsatz, "a1"), &u.admin, None).await;
    assert_eq!(s, StatusCode::CONFLICT);
    assert!(u.zeilen().await.is_empty());
}

#[tokio::test]
async fn wiedereroeffnen_nach_uebernahme_ergibt_keinen_zweiten_halter() {
    let u = umgebung().await;
    u.adapter("a1", "suchlage", u.org_id).await;
    let (s, _) = u.zuschalten(u.einsatz, "a1").await;
    assert_eq!(s, StatusCode::OK);
    u.schliessen(u.einsatz).await;

    let zweiter = einsatz_anlegen_mit(&u.app, &u.admin, "Lage B").await;
    let (s, _) = u.zuschalten(zweiter, "a1").await;
    assert_eq!(s, StatusCode::OK);

    let (s, v) = anfrage(
        &u.app,
        "POST",
        &format!("/api/incidents/{}/reopen", u.einsatz),
        &u.admin,
        Some(&json!({"grund": "Nachalarmierung"}).to_string()),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v:?}");

    // Nur der zweite Einsatz hält die Quelle; der wieder geöffnete beginnt ohne Zuschaltung.
    assert_eq!(u.zeilen().await, vec![("a1".to_string(), zweiter, true)]);
    let (_, liste) = u.liste(u.einsatz, &u.admin).await;
    assert_eq!(liste[0]["connected"], false);
    assert_eq!(liste[0]["held_by_other"], "Lage B");
}

#[tokio::test]
async fn ohne_leserecht_am_halter_kommt_kein_name_nur_das_merkmal() {
    let u = umgebung().await;
    u.adapter("a1", "suchlage", u.org_id).await;
    let zweiter = einsatz_anlegen_mit(&u.app, &u.admin, "Lage B").await;
    let (s, _) = u.zuschalten(zweiter, "a1").await;
    assert_eq!(s, StatusCode::OK);
    // Die Beobachterin ist nur im ersten Einsatz Mitglied.
    let beob = benutzer_anlegen(&u.app, &u.admin, "beobachter", "keine").await;
    rolle_setzen(&u.app, &u.admin, u.einsatz, beob, "beobachter").await;
    let cookie = login_cookie(&u.app, "beobachter", "beobachterpw1").await;

    let (s, liste) = u.liste(u.einsatz, &cookie).await;
    assert_eq!(s, StatusCode::OK, "{liste:?}");
    assert!(liste[0]["held_by_other"].is_null(), "{liste:?}");
    assert_eq!(liste[0]["held_by_other_hidden"], true);

    // Wer den anderen Einsatz lesen darf, bekommt den Namen und kein Merkmal.
    let (_, liste) = u.liste(u.einsatz, &u.admin).await;
    assert_eq!(liste[0]["held_by_other"], "Lage B");
    assert_eq!(liste[0]["held_by_other_hidden"], false);
}

/// PUT mit der Lagemonitor-Wahl `an` (LLH-2109).
async fn schalten(u: &Umgebung, an: bool) {
    let (s, v) = anfrage(
        &u.app,
        "PUT",
        &u.pfad(u.einsatz, "a1"),
        &u.admin,
        Some(&json!({ "lagemonitor": an }).to_string()),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v:?}");
}

/// Die Systemeinträge der Drohnenquelle (ohne Annahme über die Folge).
async fn drohnen_eintraege(u: &Umgebung) -> Vec<String> {
    system_etb_inhalte(&u.app, &u.admin, u.einsatz)
        .await
        .into_iter()
        .filter(|i| i.contains("Drohnenbild") || i.contains("Lagemonitor"))
        .collect()
}

fn anzahl(e: &[String], text: &str) -> usize {
    e.iter().filter(|i| i.contains(text)).count()
}

const ZU: &str = "Drohnenbild aus Suchlage zugeschaltet";

const EIN: &str = "Livebild auf dem Lagemonitor eingeschaltet";
const AUS: &str = "Livebild auf dem Lagemonitor ausgeschaltet";

#[tokio::test]
async fn schalter_an_und_aus_steht_im_etb() {
    let u = umgebung().await;
    u.adapter("a1", "suchlage", u.org_id).await;
    schalten(&u, false).await;
    schalten(&u, true).await;
    schalten(&u, false).await;
    let e = drohnen_eintraege(&u).await;
    assert_eq!(e.len(), 3, "{e:?}");
    assert_eq!(
        (anzahl(&e, ZU), anzahl(&e, EIN), anzahl(&e, AUS)),
        (1, 1, 1),
        "{e:?}"
    );
}

#[tokio::test]
async fn gleicher_wert_kein_neuer_eintrag() {
    let u = umgebung().await;
    u.adapter("a1", "suchlage", u.org_id).await;
    schalten(&u, false).await;
    schalten(&u, true).await;
    schalten(&u, true).await;
    schalten(&u, false).await;
    schalten(&u, false).await;
    let e = drohnen_eintraege(&u).await;
    assert_eq!((anzahl(&e, EIN), anzahl(&e, AUS)), (1, 1), "{e:?}");
}

#[tokio::test]
async fn neu_zuschalten_mit_schalter_an_zwei_eintraege() {
    let u = umgebung().await;
    u.adapter("a1", "suchlage", u.org_id).await;
    schalten(&u, true).await;
    let e = drohnen_eintraege(&u).await;
    assert_eq!(e.len(), 2, "{e:?}");
    assert_eq!((anzahl(&e, ZU), anzahl(&e, EIN)), (1, 1), "{e:?}");
}
