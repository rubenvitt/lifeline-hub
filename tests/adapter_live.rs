//! Live-Abruf außerhalb des Laufs (LLH-2107, ADR-0098): wann der Rahmen einen Adapter für eine
//! Anfragezeit herausgibt und wann nicht. Mit der Test-Art, ohne Netz.

use age::secrecy::ExposeSecret;
use axum::http::StatusCode;
use lifeline_hub::adapter::live::{live_kontext, LiveVerweigert};
use lifeline_hub::adapter::Rahmen;
use serde_json::json;

mod adapter_testart;
mod common;
use common::{anfrage_json, login_cookie, setup_mit_state};

const LISTE: &str = "/api/admin/adapter";
const TOKEN: &str = "token-0815";

struct Umgebung {
    pool: sqlx::SqlitePool,
    rahmen: Rahmen,
    art: std::sync::Arc<adapter_testart::TestArt>,
    id: String,
    org_id: i64,
}

/// Ein Adapter der Test-Art; mit Token, wenn `mit_token`.
async fn umgebung(mit_token: bool) -> Umgebung {
    let (rahmen, art, _) = adapter_testart::rahmen();
    let r = rahmen.clone();
    let (app, pool) = setup_mit_state(|s| s.adapter = r).await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let (s, v) = anfrage_json(
        &app,
        "POST",
        LISTE,
        &admin,
        Some(&json!({ "art": "test", "name": "Quelle", "intervall_s": 60 })),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
    let id = v["id"].as_str().unwrap().to_string();
    if mit_token {
        let (s, v) = anfrage_json(
            &app,
            "PUT",
            &format!("{LISTE}/{id}/secrets/token"),
            &admin,
            Some(&json!({ "wert": TOKEN })),
        )
        .await;
        assert_eq!(s, StatusCode::NO_CONTENT, "{v}");
    }
    let org_id = sqlx::query_scalar("SELECT org_id FROM adapter WHERE id = ?")
        .bind(&id)
        .fetch_one(&pool)
        .await
        .unwrap();
    Umgebung {
        pool,
        rahmen,
        art,
        id,
        org_id,
    }
}

impl Umgebung {
    async fn kontext(&self) -> Result<lifeline_hub::adapter::live::LiveKontext, LiveVerweigert> {
        self.kontext_mit(&self.rahmen).await
    }

    async fn kontext_mit(
        &self,
        rahmen: &Rahmen,
    ) -> Result<lifeline_hub::adapter::live::LiveKontext, LiveVerweigert> {
        live_kontext(
            &self.pool,
            rahmen,
            &rahmen.arten,
            self.org_id,
            &self.id,
            "test",
        )
        .await
    }

    async fn sql(&self, sql: &str) {
        sqlx::query(sqlx::AssertSqlSafe(sql.to_string()))
            .execute(&self.pool)
            .await
            .unwrap();
    }
}

#[tokio::test]
async fn laufender_adapter_liefert_kontext_mit_geheimnis() {
    let u = umgebung(true).await;
    let k = u.kontext().await.ok().expect("Kontext");
    assert_eq!(k.geheimnis("token").unwrap().expose_secret(), TOKEN);
    assert_eq!(k.adapter_id(), u.id);
    assert!(k.geheimnis("gibt-es-nicht").is_none());
    // Der Zielschutz gilt auch hier.
    assert!(k.get("https://127.0.0.1/x").is_err());
    assert!(k.get("https://api.example.org/x").is_ok());
    // Es lief nichts: der Abruf der Art wurde nicht angestoßen.
    assert!(u.art.gesehen().is_empty());
}

#[tokio::test]
async fn jeder_aufruf_entschluesselt_neu() {
    let u = umgebung(true).await;
    assert!(u.kontext().await.is_ok());
    u.sql("DELETE FROM adapter_geheimnis").await;
    // Nichts war zwischengespeichert: ohne Chiffrat fehlt jetzt das Pflicht-Geheimnis.
    assert_eq!(
        u.kontext().await.err(),
        Some(LiveVerweigert::BrauchtEingriff)
    );
}

#[tokio::test]
async fn unbekannt_ist_unbekannt() {
    let u = umgebung(true).await;
    let r = live_kontext(
        &u.pool,
        &u.rahmen,
        &u.rahmen.arten,
        u.org_id,
        "gibt-es-nicht",
        "test",
    )
    .await;
    assert_eq!(r.err(), Some(LiveVerweigert::Unbekannt));
    u.sql("UPDATE adapter SET art = 'weg'").await;
    assert_eq!(u.kontext().await.err(), Some(LiveVerweigert::Unbekannt));
}

#[tokio::test]
async fn adapter_einer_anderen_art_als_erwartet_ist_unbekannt() {
    let u = umgebung(true).await;
    // Die Drohnenrouten erwarten `suchlage`; ein Adapter der Test-Art bekommt dort keinen Kontext.
    let r = live_kontext(
        &u.pool,
        &u.rahmen,
        &u.rahmen.arten,
        u.org_id,
        &u.id,
        "suchlage",
    )
    .await;
    assert_eq!(r.err(), Some(LiveVerweigert::Unbekannt));
    assert!(u.kontext().await.is_ok());
}

#[tokio::test]
async fn fremde_org_ist_unbekannt() {
    let u = umgebung(true).await;
    // Ein Adapter einer anderen Org ist von einem nicht vorhandenen nicht zu unterscheiden.
    let r = live_kontext(
        &u.pool,
        &u.rahmen,
        &u.rahmen.arten,
        u.org_id + 1000,
        &u.id,
        "test",
    )
    .await;
    assert_eq!(r.err(), Some(LiveVerweigert::Unbekannt));
    // Die eigene Org bekommt ihn weiterhin.
    assert!(u.kontext().await.is_ok());
}

#[tokio::test]
async fn angehaltener_adapter_verweigert() {
    let u = umgebung(true).await;
    u.sql("UPDATE adapter SET zustand = 'angehalten', angehalten_at = '2026-11-25T10:00:00Z'")
        .await;
    assert_eq!(u.kontext().await.err(), Some(LiveVerweigert::Angehalten));
}

#[tokio::test]
async fn adapter_mit_eingriff_verweigert() {
    let u = umgebung(true).await;
    // Vom Lauf angehalten.
    u.sql(
        "UPDATE adapter SET zustand = 'angehalten', angehalten_grund = 'abgelehnt', \
         angehalten_at = '2026-11-25T10:00:00Z', letzter_fehler_art = 'abgelehnt', \
         fehler_seit = '2026-11-25T10:00:00Z'",
    )
    .await;
    assert_eq!(
        u.kontext().await.err(),
        Some(LiveVerweigert::BrauchtEingriff)
    );
    // Noch aktiv, aber der laufende Fehler braucht einen Menschen.
    u.sql("UPDATE adapter SET zustand = 'aktiv', angehalten_grund = NULL, angehalten_at = NULL")
        .await;
    assert_eq!(
        u.kontext().await.err(),
        Some(LiveVerweigert::BrauchtEingriff)
    );
    // Ein vorübergehender Fehler hindert den Live-Abruf nicht.
    u.sql("UPDATE adapter SET letzter_fehler_art = 'verbindung'")
        .await;
    assert!(u.kontext().await.is_ok());
    // Und ein früherer Eingriffsfehler, der inzwischen überstanden ist, auch nicht.
    u.sql("UPDATE adapter SET letzter_fehler_art = 'abgelehnt', fehler_seit = NULL")
        .await;
    assert!(u.kontext().await.is_ok());
}

#[tokio::test]
async fn fehlendes_pflicht_geheimnis_braucht_eingriff() {
    let u = umgebung(false).await;
    assert_eq!(
        u.kontext().await.err(),
        Some(LiveVerweigert::BrauchtEingriff)
    );
}

#[tokio::test]
async fn gesperrter_speicher_verweigert() {
    let u = umgebung(true).await;
    let ohne = adapter_testart::rahmen_mit(&u.art, None);
    assert_eq!(
        u.kontext_mit(&ohne).await.err(),
        Some(LiveVerweigert::SpeicherGesperrt)
    );
}

#[tokio::test]
async fn org_am_hub_verweigert() {
    let u = umgebung(true).await;
    let org: i64 = sqlx::query_scalar("SELECT org_id FROM adapter")
        .fetch_one(&u.pool)
        .await
        .unwrap();
    let kopplung: i64 = sqlx::query_scalar(
        "INSERT INTO instanz_kopplung (gegenueber_kennung, gegenueber_schluessel, gegenueber_name, \
         richtung, gegenueber_adresse, zustand, art) VALUES ('hub-a', 'X', 'Hub Kreis', 'meldet_sich', \
         'https://hub.example', 'aktiv', 'standard') RETURNING id",
    )
    .fetch_one(&u.pool)
    .await
    .unwrap();
    sqlx::query(
        "INSERT INTO instanz_kopplung_org (kopplung_id, org_id, fremde_org_kennung, fremde_org_name) \
         VALUES (?, ?, 'hub-a/1', 'Kreis')",
    )
    .bind(kopplung)
    .bind(org)
    .execute(&u.pool)
    .await
    .unwrap();
    assert_eq!(u.kontext().await.err(), Some(LiveVerweigert::AmHub));
}
