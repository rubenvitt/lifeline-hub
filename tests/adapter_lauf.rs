//! Der Hintergrundlauf der Adapter (LLH-2017, Design-Doc „Lauf“): Erfolg, Wartezeit nach einem
//! vorübergehenden Fehler, Anhalten bei einem Fehler, der einen Menschen braucht, und wieder
//! fällig nach dem Ersetzen eines Geheimnisses. Mit einer Test-Art, ohne Netz.

use axum::http::StatusCode;
use chrono::{Duration, Utc};
use lifeline_hub::adapter::art::Fehlschlag;
use lifeline_hub::adapter::lauf::durchgang;
use lifeline_hub::adapter::zustand::AdapterFehler;
use serde_json::{json, Value};

mod adapter_testart;
mod common;
use common::{anfrage_json, fremde_org_anlegen, login_cookie, setup_mit_state};

const LISTE: &str = "/api/admin/adapter";
const TOKEN: &str = "token-0815";

struct Umgebung {
    app: axum::Router,
    pool: sqlx::SqlitePool,
    rahmen: lifeline_hub::adapter::Rahmen,
    art: std::sync::Arc<adapter_testart::TestArt>,
    admin: String,
}

async fn umgebung() -> Umgebung {
    let (rahmen, art, _) = adapter_testart::rahmen();
    let r = rahmen.clone();
    let (app, pool) = setup_mit_state(move |s| s.adapter = r).await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    Umgebung {
        app,
        pool,
        rahmen,
        art,
        admin,
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
            &format!("{LISTE}/{id}/geheimnisse/token"),
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
        durchgang(&self.pool, &self.rahmen, jetzt).await.unwrap();
    }
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
        &format!("{LISTE}/{id}/versuche"),
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
        &format!("{LISTE}/{id}/anhalten"),
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
    durchgang(&u.pool, &ohne, Utc::now()).await.unwrap();
    let a = u.ansicht(&id2).await;
    assert_eq!(a["angehalten_grund"], "geheimnisspeicher_gesperrt");

    // Und mit einem anderen Schlüssel: unlesbar.
    let id3 = u.adapter(true).await;
    let anderer = adapter_testart::rahmen_mit(
        &u.art,
        Some(lifeline_hub::adapter::geheimnis::GeheimnisSchluessel::generate()),
    );
    durchgang(&u.pool, &anderer, Utc::now()).await.unwrap();
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
        &format!("{LISTE}/{id}/versuche"),
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
    durchgang(&u.pool, &ohne, Utc::now()).await.unwrap();
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
        &format!("{LISTE}/{id}/anhalten"),
        &u.admin,
        None,
    )
    .await;
    lifeline_hub::adapter::lauf::beim_start(&u.pool, &u.rahmen)
        .await
        .unwrap();
    assert_eq!(u.ansicht(&id).await["zustand"], "aus");
}
