//! Der Hintergrundlauf der Adapter (LLH-2017, Design-Doc „Lauf“): Erfolg, Wartezeit nach einem
//! vorübergehenden Fehler, Anhalten bei einem Fehler, der einen Menschen braucht, und wieder
//! fällig nach dem Ersetzen eines Geheimnisses. Mit einer Test-Art, ohne Netz.
//!
//! Dazu die Störungsmeldung an die Admins (LLH-2026): einmal je Störung, „gestört“ erst ab 30
//! Minuten, Entwarnung nach der Rückkehr, nichts bei gesperrtem Geheimnisspeicher.

use axum::http::StatusCode;
use chrono::{Duration, Utc};
use lifeline_hub::adapter::art::Fehlschlag;
use lifeline_hub::adapter::lauf::durchgang;
use lifeline_hub::adapter::zustand::AdapterFehler;
use serde_json::{json, Value};

mod adapter_testart;
mod common;
use common::{anfrage_json, benutzer_anlegen, fremde_org_anlegen, login_cookie, setup_mit_state};
use lifeline_hub::live::LiveHub;

const LISTE: &str = "/api/admin/adapter";
const TOKEN: &str = "token-0815";

struct Umgebung {
    app: axum::Router,
    pool: sqlx::SqlitePool,
    live: LiveHub,
    rahmen: lifeline_hub::adapter::Rahmen,
    art: std::sync::Arc<adapter_testart::TestArt>,
    admin: String,
    /// Zweiter System-Admin der Org.
    admin2: String,
    /// Führungskraft der Org: sieht Anbindungen, ändert sie nicht.
    fuehrungskraft: String,
    /// System-Admin einer fremden Org.
    fremd: String,
}

async fn umgebung() -> Umgebung {
    let (rahmen, art, _) = adapter_testart::rahmen();
    let r = rahmen.clone();
    let mut live = None;
    let (app, pool) = setup_mit_state(|s| {
        s.adapter = r;
        live = Some(s.live.clone());
    })
    .await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    benutzer_anlegen(&app, &admin, "admin2", "keine").await;
    sqlx::query("UPDATE benutzer SET system_rolle = 'admin' WHERE benutzername = 'admin2'")
        .execute(&pool)
        .await
        .unwrap();
    let admin2 = login_cookie(&app, "admin2", "admin2pw1").await;
    benutzer_anlegen(&app, &admin, "fuehrung", "fuehrungskraft").await;
    let fuehrungskraft = login_cookie(&app, "fuehrung", "fuehrungpw1").await;
    let (fremde_org, _) =
        fremde_org_anlegen(&pool, "Fremde Orga", "fremdadmin", "fremdpw123", "keine").await;
    sqlx::query("UPDATE benutzer SET system_rolle = 'admin' WHERE org_id = ?")
        .bind(fremde_org)
        .execute(&pool)
        .await
        .unwrap();
    let fremd = login_cookie(&app, "fremdadmin", "fremdpw123").await;
    Umgebung {
        app,
        pool,
        live: live.unwrap(),
        rahmen,
        art,
        admin,
        admin2,
        fuehrungskraft,
        fremd,
    }
}

impl Umgebung {
    async fn adapter(&self, mit_token: bool) -> String {
        let (s, v) = anfrage_json(
            &self.app,
            "POST",
            LISTE,
            &self.admin,
            Some(&json!({ "art": "test", "name": "Quelle", "intervall_s": 60 })),
        )
        .await;
        assert_eq!(s, StatusCode::CREATED, "{v}");
        let id = v["id"].as_str().unwrap().to_string();
        if mit_token {
            self.set_token(&id, TOKEN).await;
        }
        id
    }

    async fn set_token(&self, id: &str, wert: &str) {
        let (s, v) = anfrage_json(
            &self.app,
            "PUT",
            &format!("{LISTE}/{id}/secrets/token"),
            &self.admin,
            Some(&json!({ "wert": wert })),
        )
        .await;
        assert_eq!(s, StatusCode::NO_CONTENT, "{v}");
    }

    async fn ansicht(&self, id: &str) -> Value {
        let (s, v) = anfrage_json(
            &self.app,
            "GET",
            &format!("{LISTE}/{id}"),
            &self.admin,
            None,
        )
        .await;
        assert_eq!(s, StatusCode::OK, "{v}");
        v
    }

    async fn lauf(&self, jetzt: chrono::DateTime<Utc>) {
        durchgang(&self.pool, &self.rahmen, &self.live, jetzt)
            .await
            .unwrap();
    }

    /// Die Benachrichtigungen, die `cookie` sieht (`GET /api/benachrichtigungen`), jüngste zuerst.
    async fn meldungen(&self, cookie: &str) -> Vec<Value> {
        let (s, v) = anfrage_json(&self.app, "GET", "/api/benachrichtigungen", cookie, None).await;
        assert_eq!(s, StatusCode::OK, "{v}");
        v.as_array().unwrap().clone()
    }

    /// Die Arten der Meldungen, die `cookie` sieht, älteste zuerst, mit „offen“ oder „quittiert“.
    async fn arten(&self, cookie: &str) -> Vec<(String, bool)> {
        let mut aus: Vec<(String, bool)> = self
            .meldungen(cookie)
            .await
            .iter()
            .map(|m| {
                (
                    m["art"].as_str().unwrap().to_string(),
                    m.get("quittiert_at").is_none(),
                )
            })
            .collect();
        aus.reverse();
        aus
    }

    async fn gemeldet(&self, id: &str) -> Option<String> {
        sqlx::query_scalar("SELECT gemeldet FROM adapter WHERE id = ?")
            .bind(id)
            .fetch_one(&self.pool)
            .await
            .unwrap()
    }
}

fn offen(art: &str) -> (String, bool) {
    (art.to_string(), true)
}

fn erledigt(art: &str) -> (String, bool) {
    (art.to_string(), false)
}

fn zeit(t: chrono::DateTime<Utc>) -> String {
    lifeline_hub::zeit::formatiere_utc(t)
}

#[tokio::test]
async fn erfolg_setzt_zustand_und_naechsten_abruf() {
    let u = umgebung().await;
    let id = u.adapter(true).await;
    u.art.plane(Ok(5));
    let t0 = Utc::now();
    u.lauf(t0).await;

    let gesehen = u.art.gesehen();
    assert_eq!(gesehen.len(), 1);
    assert_eq!(gesehen[0].token.as_deref(), Some(TOKEN));
    assert!(!gesehen[0].is_probe);

    let a = u.ansicht(&id).await;
    assert_eq!(a["zustand"], "ok");
    assert_eq!(a["letzte_anzahl"], 5);
    assert_eq!(a["fehlversuche"], 0);
    let naechster = a["naechster_abruf_at"].as_str().unwrap().to_string();
    assert!(naechster >= zeit(t0 + Duration::seconds(59)), "{naechster}");

    // Vor dem nächsten Abruf passiert nichts.
    u.lauf(t0 + Duration::seconds(30)).await;
    assert_eq!(u.art.gesehen().len(), 1);
    u.lauf(t0 + Duration::seconds(65)).await;
    assert_eq!(u.art.gesehen().len(), 2);
}

#[tokio::test]
async fn voruebergehender_fehler_wartet_und_erholt_sich() {
    let u = umgebung().await;
    let id = u.adapter(true).await;
    u.art.plane(Err(Fehlschlag {
        art: AdapterFehler::Status,
        status: Some(503),
    }));
    u.art.plane(Err(Fehlschlag::new(AdapterFehler::Verbindung)));
    let t0 = Utc::now();
    u.lauf(t0).await;

    let a = u.ansicht(&id).await;
    assert_eq!(a["zustand"], "gestoert");
    assert_eq!(a["fehlversuche"], 1);
    assert_eq!(a["letzter_fehler"]["art"], "status");
    assert_eq!(a["letzter_fehler"]["status"], 503);

    // Zweiter Fehlschlag nach der Wartezeit; dann Erfolg.
    u.lauf(t0 + Duration::seconds(61)).await;
    let a = u.ansicht(&id).await;
    assert_eq!(a["fehlversuche"], 2);
    assert_eq!(a["letzter_fehler"]["art"], "verbindung");
    u.lauf(t0 + Duration::seconds(200)).await;
    let a = u.ansicht(&id).await;
    assert_eq!(a["zustand"], "ok");
    assert!(a.get("fehler_seit").is_none());
    assert_eq!(a["fehlversuche"], 0);
    // Der letzte Fehler bleibt zur Ansicht stehen.
    assert_eq!(a["letzter_fehler"]["art"], "verbindung");

    let (_, versuche) = anfrage_json(
        &u.app,
        "GET",
        &format!("{LISTE}/{id}/attempts"),
        &u.admin,
        None,
    )
    .await;
    let erfolge: Vec<bool> = versuche
        .as_array()
        .unwrap()
        .iter()
        .map(|v| v["erfolg"].as_bool().unwrap())
        .collect();
    assert_eq!(erfolge, [true, false, false]);
}

#[tokio::test]
async fn abgelehnt_haelt_an_bis_das_geheimnis_ersetzt_ist() {
    let u = umgebung().await;
    let id = u.adapter(true).await;
    u.art.plane(Err(Fehlschlag {
        art: AdapterFehler::Abgelehnt,
        status: Some(401),
    }));
    let t0 = Utc::now();
    u.lauf(t0).await;
    let a = u.ansicht(&id).await;
    assert_eq!(a["zustand"], "braucht_eingriff");
    assert_eq!(a["angehalten_grund"], "abgelehnt");

    // Kein weiterer Versuch, auch viel später nicht.
    u.lauf(t0 + Duration::hours(3)).await;
    assert_eq!(u.art.gesehen().len(), 1);

    // Neues Geheimnis: sofort wieder fällig.
    u.set_token(&id, "neues-token").await;
    let a = u.ansicht(&id).await;
    assert_eq!(a["zustand"], "gestoert");
    u.lauf(t0 + Duration::hours(3)).await;
    assert_eq!(
        u.art.gesehen().last().unwrap().token.as_deref(),
        Some("neues-token")
    );
    assert_eq!(u.ansicht(&id).await["zustand"], "ok");
}

#[tokio::test]
async fn von_admin_angehalten_bleibt_aus_auch_nach_neuem_geheimnis() {
    let u = umgebung().await;
    let id = u.adapter(true).await;
    anfrage_json(
        &u.app,
        "POST",
        &format!("{LISTE}/{id}/pause"),
        &u.admin,
        None,
    )
    .await;
    u.set_token(&id, "anderes").await;
    u.lauf(Utc::now()).await;
    assert!(u.art.gesehen().is_empty());
    assert_eq!(u.ansicht(&id).await["zustand"], "aus");
}

#[tokio::test]
async fn fehlendes_geheimnis_und_fehlender_schluessel_brauchen_eingriff() {
    let u = umgebung().await;
    let id = u.adapter(false).await;
    u.lauf(Utc::now()).await;
    assert!(
        u.art.gesehen().is_empty(),
        "ohne Pflicht-Geheimnis kein Abruf"
    );
    let a = u.ansicht(&id).await;
    assert_eq!(a["zustand"], "braucht_eingriff");
    assert_eq!(a["angehalten_grund"], "geheimnis_fehlt");

    // Derselbe Bestand nach einem Neustart ohne Schlüssel: gesperrt.
    let id2 = u.adapter(true).await;
    let ohne = adapter_testart::rahmen_mit(&u.art, None);
    durchgang(&u.pool, &ohne, &u.live, Utc::now())
        .await
        .unwrap();
    let a = u.ansicht(&id2).await;
    assert_eq!(a["angehalten_grund"], "geheimnisspeicher_gesperrt");

    // Und mit einem anderen Schlüssel: unlesbar.
    let id3 = u.adapter(true).await;
    let anderer = adapter_testart::rahmen_mit(
        &u.art,
        Some(lifeline_hub::adapter::geheimnis::GeheimnisSchluessel::generate()),
    );
    durchgang(&u.pool, &anderer, &u.live, Utc::now())
        .await
        .unwrap();
    let a = u.ansicht(&id3).await;
    assert_eq!(a["angehalten_grund"], "geheimnis_unlesbar");
    assert!(u.art.gesehen().is_empty());
}

#[tokio::test]
async fn unbekannte_art_und_gekoppelter_elw_laufen_nicht() {
    let u = umgebung().await;
    let id = u.adapter(true).await;

    // Unbekannte Art: wird ausgelassen und als solche gezeigt.
    sqlx::query("UPDATE adapter SET art = 'weg'")
        .execute(&u.pool)
        .await
        .unwrap();
    u.lauf(Utc::now()).await;
    assert!(u.art.gesehen().is_empty());
    assert_eq!(u.ansicht(&id).await["zustand"], "art_unbekannt");
    sqlx::query("UPDATE adapter SET art = 'test'")
        .execute(&u.pool)
        .await
        .unwrap();

    // Gekoppelter ELW: läuft nicht.
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
    u.lauf(Utc::now()).await;
    assert!(u.art.gesehen().is_empty());
    assert_eq!(u.ansicht(&id).await["zustand"], "wartet");
}

#[tokio::test]
async fn jede_org_laeuft_fuer_sich() {
    let u = umgebung().await;
    let eigen = u.adapter(true).await;
    // Ein Adapter der fremden Org, direkt angelegt.
    let (org, _) = fremde_org_anlegen(&u.pool, "Fremde Orga", "fremd", "fremdpw123", "keine").await;
    sqlx::query(
        "INSERT INTO adapter (id, org_id, art, name, intervall_s) VALUES ('fremd-1', ?, 'test', 'Fremd', 60)",
    )
    .bind(org)
    .execute(&u.pool)
    .await
    .unwrap();
    u.art.plane(Ok(1));
    u.art.plane(Ok(1));
    u.lauf(Utc::now()).await;
    // Der eigene läuft, der fremde scheitert an seinem fehlenden Token — jeder in seiner Zeile.
    assert_eq!(u.ansicht(&eigen).await["zustand"], "ok");
    let (zustand, grund): (String, Option<String>) =
        sqlx::query_as("SELECT zustand, angehalten_grund FROM adapter WHERE id = 'fremd-1'")
            .fetch_one(&u.pool)
            .await
            .unwrap();
    assert_eq!(zustand, "angehalten");
    assert_eq!(grund.as_deref(), Some("geheimnis_fehlt"));
    let eigene_versuche: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM adapter_versuch WHERE adapter_id = ?")
            .bind(&eigen)
            .fetch_one(&u.pool)
            .await
            .unwrap();
    assert_eq!(eigene_versuche, 1);
}

#[tokio::test]
async fn verlauf_bleibt_bei_fuenfzig() {
    let u = umgebung().await;
    let id = u.adapter(true).await;
    let mut t = Utc::now();
    for _ in 0..55 {
        u.lauf(t).await;
        t += Duration::seconds(61);
    }
    let n: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM adapter_versuch WHERE adapter_id = ?")
        .bind(&id)
        .fetch_one(&u.pool)
        .await
        .unwrap();
    assert_eq!(n, 50);
}

#[tokio::test]
async fn erfolg_uebernimmt_und_fehlgeschlagene_uebernahme_ist_ein_fehler() {
    let u = umgebung().await;
    let id = u.adapter(true).await;
    let t0 = Utc::now();
    u.lauf(t0).await;
    assert_eq!(u.art.uebernommen(), 1);

    u.art
        .uebernahme_scheitert
        .store(true, std::sync::atomic::Ordering::SeqCst);
    u.lauf(t0 + Duration::seconds(61)).await;
    assert_eq!(u.art.uebernommen(), 1);
    let a = u.ansicht(&id).await;
    assert_eq!(a["zustand"], "gestoert");
    assert_eq!(a["letzter_fehler"]["art"], "intern");
}

#[tokio::test]
async fn aenderung_waehrend_des_abrufs_gewinnt() {
    let u = umgebung().await;
    let id = u.adapter(true).await;
    // Der Abruf läuft noch mit dem alten Token und scheitert mit 401; währenddessen setzt ein
    // Admin ein neues (Stand steigt). Das alte Ergebnis darf den Adapter nicht anhalten.
    u.art.plane(Err(Fehlschlag {
        art: AdapterFehler::Abgelehnt,
        status: Some(401),
    }));
    *u.art.waehrenddessen.lock().unwrap() = Some((
        u.pool.clone(),
        format!("UPDATE adapter SET stand = stand + 1 WHERE id = '{id}'"),
    ));
    u.lauf(Utc::now()).await;
    let a = u.ansicht(&id).await;
    assert_eq!(a["zustand"], "wartet", "{a}");
    // Der Versuch steht trotzdem im Verlauf.
    let (_, versuche) = anfrage_json(
        &u.app,
        "GET",
        &format!("{LISTE}/{id}/attempts"),
        &u.admin,
        None,
    )
    .await;
    assert_eq!(versuche[0]["fehler_art"], "abgelehnt");

    // Ebenso ein Erfolg nach einem Anhalten: keine Übernahme, Zustand bleibt „aus“.
    *u.art.waehrenddessen.lock().unwrap() = Some((
        u.pool.clone(),
        format!("UPDATE adapter SET zustand = 'angehalten', stand = stand + 1 WHERE id = '{id}'"),
    ));
    u.lauf(Utc::now()).await;
    assert_eq!(u.art.uebernommen(), 0);
    assert_eq!(u.ansicht(&id).await["zustand"], "aus");
}

#[tokio::test]
async fn start_mit_schluessel_nimmt_wegen_des_speichers_angehaltene_wieder_auf() {
    let u = umgebung().await;
    let id = u.adapter(true).await;
    let ohne = adapter_testart::rahmen_mit(&u.art, None);
    durchgang(&u.pool, &ohne, &u.live, Utc::now())
        .await
        .unwrap();
    assert_eq!(
        u.ansicht(&id).await["angehalten_grund"],
        "geheimnisspeicher_gesperrt"
    );

    // Ein Start ohne Schlüssel ändert nichts, einer mit Schlüssel nimmt wieder auf.
    lifeline_hub::adapter::lauf::beim_start(&u.pool, &ohne)
        .await
        .unwrap();
    assert_eq!(u.ansicht(&id).await["zustand"], "braucht_eingriff");
    lifeline_hub::adapter::lauf::beim_start(&u.pool, &u.rahmen)
        .await
        .unwrap();
    u.lauf(Utc::now()).await;
    assert_eq!(u.ansicht(&id).await["zustand"], "ok");

    // Ein vom Admin angehaltener bleibt aus.
    anfrage_json(
        &u.app,
        "POST",
        &format!("{LISTE}/{id}/pause"),
        &u.admin,
        None,
    )
    .await;
    lifeline_hub::adapter::lauf::beim_start(&u.pool, &u.rahmen)
        .await
        .unwrap();
    assert_eq!(u.ansicht(&id).await["zustand"], "aus");
}

// ───────────────────── Störungsmeldung an die Admins (LLH-2026) ─────────────────────

fn abgelehnt() -> Result<i64, Fehlschlag> {
    Err(Fehlschlag {
        art: AdapterFehler::Abgelehnt,
        status: Some(401),
    })
}

fn verbindung() -> Result<i64, Fehlschlag> {
    Err(Fehlschlag::new(AdapterFehler::Verbindung))
}

/// Läuft fällige Durchgänge bis `bis`, jeweils zum nächsten geplanten Abruf.
async fn laufen_bis(u: &Umgebung, id: &str, bis: chrono::DateTime<Utc>) {
    loop {
        let naechster: Option<String> =
            sqlx::query_scalar("SELECT naechster_abruf_at FROM adapter WHERE id = ?")
                .bind(id)
                .fetch_one(&u.pool)
                .await
                .unwrap();
        let Some(t) = naechster.and_then(|n| lifeline_hub::zeit::parse_utc(&n)) else {
            return;
        };
        if t > bis {
            return;
        }
        u.lauf(t).await;
    }
}

#[tokio::test]
async fn anhalten_meldet_genau_einmal_an_die_admins() {
    let u = umgebung().await;
    let id = u.adapter(true).await;
    u.art.plane(abgelehnt());
    let t0 = Utc::now();
    u.lauf(t0).await;
    u.lauf(t0 + Duration::hours(3)).await;

    for cookie in [&u.admin, &u.admin2] {
        let m = u.meldungen(cookie).await;
        assert_eq!(m.len(), 1, "{m:?}");
        assert_eq!(m[0]["art"], "adapter_eingriff");
        assert_eq!(m[0]["stufe"], "hinweis");
        assert!(m[0]["einsatz_id"].is_null());
        assert_eq!(m[0]["titel"], "Anbindung braucht Eingriff");
        assert_eq!(m[0]["detail"], "Quelle · Zugang abgelehnt (401)");
        assert_eq!(
            m[0]["pfad"],
            format!("/admin/einstellungen/anbindungen/adapter/{id}")
        );
    }
    assert!(u.meldungen(&u.fuehrungskraft).await.is_empty());
    assert!(u.meldungen(&u.fremd).await.is_empty());
    assert_eq!(u.gemeldet(&id).await.as_deref(), Some("eingriff"));
}

#[tokio::test]
async fn kurze_stoerung_meldet_nicht() {
    let u = umgebung().await;
    let id = u.adapter(true).await;
    for _ in 0..5 {
        u.art.plane(verbindung());
    }
    let t0 = Utc::now();
    u.lauf(t0).await;
    laufen_bis(&u, &id, t0 + Duration::minutes(29)).await;
    assert!(u.art.gesehen().len() >= 4, "{:?}", u.art.gesehen());
    assert!(u.meldungen(&u.admin).await.is_empty());
    assert_eq!(u.gemeldet(&id).await, None);
}

#[tokio::test]
async fn lange_stoerung_meldet_einmal_ab_dreissig_minuten() {
    let u = umgebung().await;
    let id = u.adapter(true).await;
    for _ in 0..10 {
        u.art.plane(verbindung());
    }
    let t0 = Utc::now();
    u.lauf(t0).await;
    laufen_bis(&u, &id, t0 + Duration::minutes(31)).await;
    assert_eq!(u.arten(&u.admin).await, [offen("adapter_gestoert")]);
    let m = u.meldungen(&u.admin).await;
    assert_eq!(m[0]["detail"], "Quelle · Keine Verbindung zum Ziel");

    laufen_bis(&u, &id, t0 + Duration::minutes(80)).await;
    assert_eq!(u.arten(&u.admin).await, [offen("adapter_gestoert")]);
    assert_eq!(u.gemeldet(&id).await.as_deref(), Some("gestoert"));
}

#[tokio::test]
async fn eskalation_ersetzt_die_stoerungsmeldung() {
    let u = umgebung().await;
    let id = u.adapter(true).await;
    for _ in 0..6 {
        u.art.plane(verbindung());
    }
    u.art.plane(abgelehnt());
    let t0 = Utc::now();
    u.lauf(t0).await;
    laufen_bis(&u, &id, t0 + Duration::hours(2)).await;
    assert_eq!(
        u.arten(&u.admin).await,
        [erledigt("adapter_gestoert"), offen("adapter_eingriff")]
    );
    assert_eq!(u.gemeldet(&id).await.as_deref(), Some("eingriff"));
}

#[tokio::test]
async fn erholung_erledigt_und_entwarnt() {
    let u = umgebung().await;
    let id = u.adapter(true).await;
    for _ in 0..6 {
        u.art.plane(verbindung());
    }
    let t0 = Utc::now();
    u.lauf(t0).await;
    // Sechs Fehlschläge, dann Erfolg (leeres Skript).
    laufen_bis(&u, &id, t0 + Duration::hours(2)).await;
    assert_eq!(
        u.arten(&u.admin).await,
        [erledigt("adapter_gestoert"), offen("adapter_wieder_ok")]
    );
    let m = u.meldungen(&u.admin2).await;
    assert_eq!(m[0]["titel"], "Anbindung läuft wieder");
    assert_eq!(m[0]["detail"], "Quelle");
    assert_eq!(u.gemeldet(&id).await, None);
    assert_eq!(u.ansicht(&id).await["zustand"], "ok");
}

#[tokio::test]
async fn erfolg_ohne_meldung_entwarnt_nicht() {
    let u = umgebung().await;
    let id = u.adapter(true).await;
    u.art.plane(verbindung());
    let t0 = Utc::now();
    u.lauf(t0).await;
    u.lauf(t0 + Duration::minutes(2)).await;
    assert_eq!(u.ansicht(&id).await["zustand"], "ok");
    assert!(u.meldungen(&u.admin).await.is_empty());
}

#[tokio::test]
async fn gesperrter_speicher_meldet_nicht() {
    let u = umgebung().await;
    let id = u.adapter(true).await;
    let ohne = adapter_testart::rahmen_mit(&u.art, None);
    durchgang(&u.pool, &ohne, &u.live, Utc::now())
        .await
        .unwrap();
    assert_eq!(
        u.ansicht(&id).await["angehalten_grund"],
        "geheimnisspeicher_gesperrt"
    );
    lifeline_hub::adapter::lauf::beim_start(&u.pool, &u.rahmen)
        .await
        .unwrap();
    u.lauf(Utc::now()).await;
    assert_eq!(u.ansicht(&id).await["zustand"], "ok");
    assert!(u.meldungen(&u.admin).await.is_empty());
}

#[tokio::test]
async fn unlesbares_geheimnis_meldet() {
    let u = umgebung().await;
    let id = u.adapter(true).await;
    let anderer = adapter_testart::rahmen_mit(
        &u.art,
        Some(lifeline_hub::adapter::geheimnis::GeheimnisSchluessel::generate()),
    );
    durchgang(&u.pool, &anderer, &u.live, Utc::now())
        .await
        .unwrap();
    assert_eq!(u.arten(&u.admin).await, [offen("adapter_eingriff")]);
    assert_eq!(
        u.meldungen(&u.admin).await[0]["detail"],
        "Quelle · Geheimnis mit anderem Schlüssel gesetzt"
    );
    assert_eq!(u.gemeldet(&id).await.as_deref(), Some("eingriff"));
}

#[tokio::test]
async fn veralteter_abruf_meldet_nicht() {
    let u = umgebung().await;
    let id = u.adapter(true).await;
    u.art.plane(abgelehnt());
    *u.art.waehrenddessen.lock().unwrap() = Some((
        u.pool.clone(),
        format!("UPDATE adapter SET stand = stand + 1 WHERE id = '{id}'"),
    ));
    u.lauf(Utc::now()).await;
    assert!(u.meldungen(&u.admin).await.is_empty());
    assert_eq!(u.gemeldet(&id).await, None);
}

#[tokio::test]
async fn meldung_enthaelt_keine_einstellung_und_kein_geheimnis() {
    let u = umgebung().await;
    let (s, v) = anfrage_json(
        &u.app,
        "POST",
        LISTE,
        &u.admin,
        Some(&json!({
            "art": "test",
            "name": "Quelle",
            "intervall_s": 60,
            "einstellungen": { "adresse": "https://ziel.example/pfad?schluessel=abc123", "gruppe": "g7" }
        })),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
    let id = v["id"].as_str().unwrap().to_string();
    u.set_token(&id, TOKEN).await;
    u.art.plane(abgelehnt());
    u.lauf(Utc::now()).await;
    let m = u.meldungen(&u.admin).await;
    assert_eq!(m.len(), 1);
    let alles = serde_json::to_string(&m).unwrap();
    for verboten in [TOKEN, "ziel.example", "abc123", "g7"] {
        assert!(!alles.contains(verboten), "{verboten} in {alles}");
    }
    let (s, einzeln) = anfrage_json(
        &u.app,
        "GET",
        &format!("/api/benachrichtigungen/{}", m[0]["id"]),
        &u.admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    assert!(!einzeln.to_string().contains(TOKEN));
    // Ein Fremder bekommt 404.
    let (s, _) = anfrage_json(
        &u.app,
        "GET",
        &format!("/api/benachrichtigungen/{}", m[0]["id"]),
        &u.fremd,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::NOT_FOUND);
}

// ───────────────────── Admin greift ein (LLH-2026) ─────────────────────

/// Ein Adapter, den der Lauf mit 401 angehalten und gemeldet hat.
async fn eingriff_gemeldet(u: &Umgebung) -> String {
    let id = u.adapter(true).await;
    u.art.plane(abgelehnt());
    u.lauf(Utc::now()).await;
    assert_eq!(u.arten(&u.admin).await, [offen("adapter_eingriff")]);
    id
}

/// Ein Adapter, der als gestört gemeldet ist (sechs Verbindungsfehler über 30 Minuten), und der
/// Zeitpunkt, bis zu dem gelaufen wurde.
async fn stoerung_gemeldet(u: &Umgebung) -> (String, chrono::DateTime<Utc>) {
    let id = u.adapter(true).await;
    for _ in 0..20 {
        u.art.plane(verbindung());
    }
    let t0 = Utc::now();
    u.lauf(t0).await;
    let bis = t0 + Duration::minutes(31);
    laufen_bis(u, &id, bis).await;
    assert_eq!(u.arten(&u.admin).await, [offen("adapter_gestoert")]);
    (id, bis)
}

async fn post(u: &Umgebung, pfad: &str) -> StatusCode {
    let (s, _) = anfrage_json(&u.app, "POST", pfad, &u.admin, None).await;
    s
}

#[tokio::test]
async fn fortsetzen_erledigt_ohne_entwarnung() {
    let u = umgebung().await;
    let id = eingriff_gemeldet(&u).await;
    assert_eq!(
        post(&u, &format!("{LISTE}/{id}/resume")).await,
        StatusCode::OK
    );
    assert_eq!(u.arten(&u.admin).await, [erledigt("adapter_eingriff")]);
    assert_eq!(u.gemeldet(&id).await, None);
    // Auch der nächste Erfolg entwarnt nicht: der Admin weiß es schon.
    u.lauf(Utc::now()).await;
    assert_eq!(u.ansicht(&id).await["zustand"], "ok");
    assert_eq!(u.arten(&u.admin).await, [erledigt("adapter_eingriff")]);
}

#[tokio::test]
async fn neues_geheimnis_erledigt() {
    let u = umgebung().await;
    let id = eingriff_gemeldet(&u).await;
    u.set_token(&id, "neues-token").await;
    assert_eq!(u.arten(&u.admin2).await, [erledigt("adapter_eingriff")]);
    assert_eq!(u.gemeldet(&id).await, None);
}

#[tokio::test]
async fn wirksame_aenderung_nach_anhalten_erledigt() {
    let u = umgebung().await;
    let id = eingriff_gemeldet(&u).await;
    let (s, v) = anfrage_json(
        &u.app,
        "PATCH",
        &format!("{LISTE}/{id}"),
        &u.admin,
        Some(&json!({ "einstellungen": { "gruppe": "neu" } })),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert_eq!(u.arten(&u.admin).await, [erledigt("adapter_eingriff")]);
    assert_eq!(u.gemeldet(&id).await, None);
}

#[tokio::test]
async fn anhalten_durch_admin_erledigt_stoerung() {
    let u = umgebung().await;
    let (id, _) = stoerung_gemeldet(&u).await;
    assert_eq!(
        post(&u, &format!("{LISTE}/{id}/pause")).await,
        StatusCode::OK
    );
    assert_eq!(u.arten(&u.admin).await, [erledigt("adapter_gestoert")]);
    assert_eq!(u.gemeldet(&id).await, None);
}

#[tokio::test]
async fn umbenennen_laesst_merker_stehen() {
    let u = umgebung().await;
    let (id, _) = stoerung_gemeldet(&u).await;
    let (s, v) = anfrage_json(
        &u.app,
        "PATCH",
        &format!("{LISTE}/{id}"),
        &u.admin,
        Some(&json!({ "name": "Quelle Nord" })),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert_eq!(u.arten(&u.admin).await, [offen("adapter_gestoert")]);
    assert_eq!(u.gemeldet(&id).await.as_deref(), Some("gestoert"));
}

#[tokio::test]
async fn loeschen_erledigt_und_raeumt() {
    let u = umgebung().await;
    let id = eingriff_gemeldet(&u).await;
    let (s, _) = anfrage_json(&u.app, "DELETE", &format!("{LISTE}/{id}"), &u.admin, None).await;
    assert_eq!(s, StatusCode::NO_CONTENT);
    let n: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM benachrichtigung WHERE adapter_id = ?")
        .bind(&id)
        .fetch_one(&u.pool)
        .await
        .unwrap();
    assert_eq!(n, 0);
    assert!(u.meldungen(&u.admin).await.is_empty());
}

// ───────────────────── Review-Befunde (LLH-2026) ─────────────────────

/// Meldet die Org des Adapters bei einem Hub an: Schreibwege am Adapter sind dann gesperrt (409).
async fn an_den_hub(u: &Umgebung) {
    let org: i64 = sqlx::query_scalar("SELECT org_id FROM benutzer WHERE benutzername = 'admin'")
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
}

#[tokio::test]
async fn gescheitertes_loeschen_laesst_die_meldung_offen() {
    let u = umgebung().await;
    let id = eingriff_gemeldet(&u).await;
    an_den_hub(&u).await;
    let (s, _) = anfrage_json(&u.app, "DELETE", &format!("{LISTE}/{id}"), &u.admin, None).await;
    assert_eq!(s, StatusCode::CONFLICT);
    assert_eq!(u.arten(&u.admin).await, [offen("adapter_eingriff")]);
    assert_eq!(u.gemeldet(&id).await.as_deref(), Some("eingriff"));
}

#[tokio::test]
async fn meldung_nur_fuer_admins_der_org_lesbar() {
    let u = umgebung().await;
    eingriff_gemeldet(&u).await;
    let id = u.meldungen(&u.admin2).await[0]["id"].clone();
    let pfad = format!("/api/benachrichtigungen/{id}");
    let (s, _) = anfrage_json(&u.app, "GET", &pfad, &u.admin2, None).await;
    assert_eq!(s, StatusCode::OK);

    // Nicht mehr Admin: 404, die Liste lässt sie aus.
    sqlx::query("UPDATE benutzer SET system_rolle = 'keiner' WHERE benutzername = 'admin2'")
        .execute(&u.pool)
        .await
        .unwrap();
    let (s, _) = anfrage_json(&u.app, "GET", &pfad, &u.admin2, None).await;
    assert_eq!(s, StatusCode::NOT_FOUND);
    assert!(u.meldungen(&u.admin2).await.is_empty());

    // Wieder Admin, aber in einer anderen Org: ebenso.
    let (fremde_org, _) =
        fremde_org_anlegen(&u.pool, "Dritte Orga", "dritter", "drittpw123", "keine").await;
    sqlx::query(
        "UPDATE benutzer SET system_rolle = 'admin', org_id = ? WHERE benutzername = 'admin2'",
    )
    .bind(fremde_org)
    .execute(&u.pool)
    .await
    .unwrap();
    let (s, _) = anfrage_json(&u.app, "GET", &pfad, &u.admin2, None).await;
    assert_eq!(s, StatusCode::NOT_FOUND);
    assert!(u.meldungen(&u.admin2).await.is_empty());
}
