//! Hinweise der Ablösung an die Führung (LLH-1131, Specs `kraefte-abloesung` „Hinweise zur
//! ablösenden Einheit“, „Planungshinweis“, „Planung entfällt“, „Plausibilität beim Planen“ und
//! `benachrichtigungen`): über die echten Routen und den Erinnerungs-Scheduler mit fester Uhr.
//! Geprüft wird, wer eine Zeile bekommt und wer nicht, und dass der Live-Strom sie nur den
//! Empfängern zustellt. Die Fachlogik der Schreibpfade belegt `src/abloesung/repo/tests.rs`.

use axum::body::Body;
use axum::http::{header, Request, StatusCode};
use chrono::{DateTime, Duration, Utc};
use lifeline_hub::erinnerung::scheduler::tick_einmal;
use lifeline_hub::live::LiveHub;
use serde_json::{json, Value};
use tower::ServiceExt;

mod common;
use common::{
    anfrage, anfrage_json, benutzer_anlegen, einsatz_anlegen, login_cookie, rolle_setzen,
    setup_mit_pool_und_live,
};

struct Welt {
    app: axum::Router,
    pool: sqlx::SqlitePool,
    live: LiveHub,
    admin: String,
    admin_id: i64,
    einsatz: i64,
    /// Setzt die Status (Auslöserin), liest die Ablösung.
    anna: i64,
    bert: i64,
    carl: i64,
}

async fn welt() -> Welt {
    let (app, pool, live) = setup_mit_pool_und_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let admin_id: i64 = sqlx::query_scalar("SELECT id FROM benutzer WHERE benutzername = 'admin'")
        .fetch_one(&pool)
        .await
        .unwrap();
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let anna = benutzer_anlegen(&app, &admin, "annika", "keine").await;
    let bert = benutzer_anlegen(&app, &admin, "bertram", "keine").await;
    let carl = benutzer_anlegen(&app, &admin, "carlotta", "keine").await;
    for b in [anna, bert, carl] {
        rolle_setzen(&app, &admin, einsatz, b, "fuehrungspersonal").await;
    }
    sqlx::query("DELETE FROM benachrichtigung")
        .execute(&pool)
        .await
        .unwrap();
    Welt {
        app,
        pool,
        live,
        admin,
        admin_id,
        einsatz,
        anna,
        bert,
        carl,
    }
}

fn wire(t: DateTime<Utc>) -> String {
    t.format("%Y-%m-%dT%H:%M:%SZ").to_string()
}

impl Welt {
    async fn cookie(&self, name: &str) -> String {
        login_cookie(&self.app, name, &format!("{name}pw1")).await
    }

    fn pfad(&self, rest: &str) -> String {
        format!("/api/einsaetze/{}/{rest}", self.einsatz)
    }

    async fn einheit(&self, name: &str) -> i64 {
        let (s, v) = anfrage(
            &self.app,
            "POST",
            &self.pfad("einheiten"),
            &self.admin,
            Some(&json!({ "name": name }).to_string()),
        )
        .await;
        assert_eq!(s, StatusCode::CREATED, "{v}");
        v["id"].as_i64().unwrap()
    }

    /// Schicht der Einheit: Beginn vor einer Stunde, Rhythmus `minuten`.
    async fn schicht(&self, einheit: i64, minuten: i64) -> i64 {
        let (s, v) = anfrage(
            &self.app,
            "POST",
            &self.pfad("abloesungen"),
            &self.admin,
            Some(
                &json!({
                    "einheit_id": einheit,
                    "beginn_at": wire(Utc::now() - Duration::hours(1)),
                    "rhythmus_minuten": minuten,
                })
                .to_string(),
            ),
        )
        .await;
        assert_eq!(s, StatusCode::CREATED, "{v}");
        v["id"].as_i64().unwrap()
    }

    async fn aendern(&self, schicht: i64, body: Value) -> Value {
        let (s, v) = anfrage(
            &self.app,
            "PATCH",
            &self.pfad(&format!("abloesungen/{schicht}")),
            &self.admin,
            Some(&body.to_string()),
        )
        .await;
        assert_eq!(s, StatusCode::OK, "{v}");
        v
    }

    async fn status_mit_marke(&self, label: &str, marke: &str) -> i64 {
        let (s, v) = anfrage(
            &self.app,
            "POST",
            "/api/fahrzeug-status",
            &self.admin,
            Some(
                &json!({ "label": label, "kategorie": "gebunden", "zeitachse_marke": marke })
                    .to_string(),
            ),
        )
        .await;
        assert_eq!(s, StatusCode::CREATED, "{v}");
        v["id"].as_i64().unwrap()
    }

    /// Handstatus der Einheit, gesetzt von `cookie`.
    async fn handstatus(&self, cookie: &str, einheit: i64, status: i64) {
        let (s, v) = anfrage(
            &self.app,
            "PUT",
            &self.pfad(&format!("einheiten/{einheit}/status")),
            cookie,
            Some(&json!({ "status_id": status }).to_string()),
        )
        .await;
        assert_eq!(s, StatusCode::OK, "{v}");
    }

    async fn modul_nur_fuer_admins(&self, modul: &str) {
        let (s, v) = anfrage(
            &self.app,
            "PUT",
            &self.pfad(&format!("modul-overrides/{modul}")),
            &self.admin,
            Some(r#"{"sichtbar":true,"benoetigte_rolle":"admin"}"#),
        )
        .await;
        assert_eq!(s, StatusCode::OK, "{v}");
    }

    /// Empfänger der Benachrichtigungen einer Art und eines Bezugstyps, aufsteigend.
    async fn empfaenger(&self, art: &str, bezug_typ: &str) -> Vec<i64> {
        sqlx::query_scalar(
            "SELECT benutzer_id FROM benachrichtigung WHERE art = ? AND bezug_typ = ? \
             ORDER BY benutzer_id",
        )
        .bind(art)
        .bind(bezug_typ)
        .fetch_all(&self.pool)
        .await
        .unwrap()
    }

    async fn tick(&self, jetzt: DateTime<Utc>) {
        tick_einmal(&self.pool, &self.live, jetzt).await;
    }

    async fn etb_mit(&self, nadel: &str) -> Vec<String> {
        sqlx::query_scalar(
            "SELECT inhalt FROM etb_eintrag WHERE einsatz_id = ? AND inhalt LIKE ? ORDER BY id",
        )
        .bind(self.einsatz)
        .bind(format!("%{nadel}%"))
        .fetch_all(&self.pool)
        .await
        .unwrap()
    }
}

// ───────────────────────── Planungshinweis ─────────────────────────

/// Spec „Planungshinweis“: Schicht fällig in drei Stunden (Beginn vor einer, Rhythmus vier
/// Stunden), also Planungshinweis in einer Stunde. Er erreicht alle mit dem Modul Ablösung genau
/// einmal, als Hinweis, mit Einheit und Uhrzeit der Fälligkeit.
#[tokio::test]
async fn planungshinweis_feuert_einmal_zwei_stunden_vor_der_faelligkeit() {
    let w = welt().await;
    let f1 = w.einheit("Florian 1").await;
    let id = w.schicht(f1, 240).await;
    let alle = vec![w.admin_id, w.anna, w.bert, w.carl];

    w.tick(Utc::now() + Duration::minutes(50)).await;
    assert!(w
        .empfaenger("abloesung_planung", "abloesung")
        .await
        .is_empty());
    w.tick(Utc::now() + Duration::minutes(70)).await;
    assert_eq!(w.empfaenger("abloesung_planung", "abloesung").await, alle);
    w.tick(Utc::now() + Duration::minutes(80)).await;
    assert_eq!(
        w.empfaenger("abloesung_planung", "abloesung").await.len(),
        4,
        "einmal"
    );
    let stufe: Vec<String> =
        sqlx::query_scalar("SELECT DISTINCT stufe FROM benachrichtigung WHERE art = ?")
            .bind("abloesung_planung")
            .fetch_all(&w.pool)
            .await
            .unwrap();
    assert_eq!(
        stufe,
        vec!["hinweis".to_string()],
        "keine Einstufung, kein Alarm"
    );
    let b: i64 = sqlx::query_scalar(
        "SELECT id FROM benachrichtigung WHERE art = 'abloesung_planung' AND benutzer_id = ?",
    )
    .bind(w.anna)
    .fetch_one(&w.pool)
    .await
    .unwrap();
    let (s, v) = anfrage(
        &w.app,
        "GET",
        &format!("/api/benachrichtigungen/{b}"),
        &w.cookie("annika").await,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert_eq!(v["titel"], "Keine ablösende Einheit geplant");
    assert_eq!(v["bezug_id"], id);
    assert!(
        v["detail"]
            .as_str()
            .unwrap_or_default()
            .starts_with("Florian 1, "),
        "{v}"
    );
    assert!(
        w.empfaenger("erinnerung_faellig", "erinnerung")
            .await
            .is_empty(),
        "keine zweite Benachrichtigung als Erinnerung"
    );
}

/// Ist eine ablösende Einheit geplant, schweigt der Planungshinweis.
#[tokio::test]
async fn planungshinweis_schweigt_bei_geplanter_einheit() {
    let w = welt().await;
    let f1 = w.einheit("Florian 1").await;
    let f2 = w.einheit("Florian 2").await;
    let id = w.schicht(f1, 240).await;
    w.aendern(id, json!({ "abloesende_einheit_id": f2 })).await;
    w.tick(Utc::now() + Duration::minutes(70)).await;
    assert!(w
        .empfaenger("abloesung_planung", "abloesung")
        .await
        .is_empty());
}

/// Der Planungshinweis verschiebt sich mit der Fälligkeit: ein um eine Stunde späterer Beginn
/// verschiebt ihn um eine Stunde.
#[tokio::test]
async fn planungshinweis_verschiebt_sich_mit_der_faelligkeit() {
    let w = welt().await;
    let f1 = w.einheit("Florian 1").await;
    let id = w.schicht(f1, 240).await;
    w.aendern(id, json!({ "beginn_at": wire(Utc::now()) }))
        .await;
    w.tick(Utc::now() + Duration::minutes(70)).await;
    assert!(w
        .empfaenger("abloesung_planung", "abloesung")
        .await
        .is_empty());
    w.tick(Utc::now() + Duration::minutes(130)).await;
    assert_eq!(
        w.empfaenger("abloesung_planung", "abloesung").await.len(),
        4
    );
}

// ───────────────────────── Ereignisse der ablösenden Einheit ─────────────────────────

async fn oeffnen(
    app: &axum::Router,
    pfad: &str,
    cookie: &str,
    last_event_id: Option<&str>,
) -> axum::response::Response {
    let mut req = Request::builder()
        .uri(pfad)
        .header(header::COOKIE, cookie.to_string());
    if let Some(id) = last_event_id {
        req = req.header("last-event-id", id);
    }
    let resp = app
        .clone()
        .oneshot(req.body(Body::empty()).unwrap())
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    resp
}

/// Die `benachrichtigung`-Nutzlasten eines SSE-Mitschnitts.
fn benachrichtigungen(roh: &str) -> Vec<Value> {
    roh.split("\n\n")
        .filter_map(|block| {
            let mut event = None;
            let mut data = String::new();
            for zeile in block.lines() {
                if let Some(v) = zeile.strip_prefix("event: ") {
                    event = Some(v.to_string());
                } else if let Some(v) = zeile.strip_prefix("data: ") {
                    data = v.to_string();
                }
            }
            (event.as_deref() == Some("benachrichtigung"))
                .then(|| serde_json::from_str(&data).unwrap())
        })
        .collect()
}

/// Akzeptanzkriterium: das Eintreffen der geplanten ablösenden Einheit erzeugt genau einen
/// Hinweis je Leser des Moduls Ablösung (hier nur der Admin) und keinen bei den anderen
/// Mitgliedern, auch nicht im Live-Strom; die Auslöserin bekommt keinen.
#[tokio::test]
async fn eintreffen_der_geplanten_einheit_erreicht_nur_die_leser_des_moduls() {
    let w = welt().await;
    let rs = w.einheit("Rettungsstaffel").await;
    let rs2 = w.einheit("2. Rettungsstaffel").await;
    let id = w.schicht(rs, 480).await;
    w.aendern(id, json!({ "abloesende_einheit_id": rs2 })).await;
    let eintreffen = w.status_mit_marke("Am Einsatzort", "eintreffen").await;
    w.modul_nur_fuer_admins("abloesung").await;
    let (_, _halter, pos) = w.live.abonniere_mit_position(w.einsatz, None);

    let anna = w.cookie("annika").await;
    w.handstatus(&anna, rs2, eintreffen).await;

    assert_eq!(
        w.empfaenger("abloesung_abloeser", "abloeser_eingetroffen")
            .await,
        vec![w.admin_id],
        "genau einer, nur beim Leser des Moduls"
    );
    let n: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM benachrichtigung")
        .fetch_one(&w.pool)
        .await
        .unwrap();
    assert_eq!(n, 1, "keine weitere Benachrichtigung");

    let feed = format!("/api/einsaetze/{}/live", w.einsatz);
    let roh = common::sse_anfang_lesen(
        oeffnen(&w.app, &feed, &w.admin, Some(&pos))
            .await
            .into_body(),
        300,
    )
    .await;
    let an_admin = benachrichtigungen(&roh);
    assert_eq!(an_admin.len(), 1, "{roh:?}");
    assert_eq!(an_admin[0]["art"], "abloesung_abloeser");
    assert_eq!(an_admin[0]["stufe"], "hinweis");
    assert_eq!(an_admin[0]["bezug_typ"], "abloeser_eingetroffen");
    assert_eq!(an_admin[0]["bezug_id"], id);
    for name in ["annika", "bertram", "carlotta"] {
        let cookie = w.cookie(name).await;
        let roh = common::sse_anfang_lesen(
            oeffnen(&w.app, &feed, &cookie, Some(&pos))
                .await
                .into_body(),
            300,
        )
        .await;
        assert!(benachrichtigungen(&roh).is_empty(), "{name}: {roh:?}");
    }

    let b: i64 = sqlx::query_scalar("SELECT id FROM benachrichtigung")
        .fetch_one(&w.pool)
        .await
        .unwrap();
    let (s, v) = anfrage(
        &w.app,
        "GET",
        &format!("/api/benachrichtigungen/{b}"),
        &w.admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert_eq!(v["titel"], "Ablösende Einheit eingetroffen");
    assert_eq!(
        v["detail"],
        "Ablösung für Rettungsstaffel: 2. Rettungsstaffel"
    );
    assert_eq!(
        v["pfad"],
        format!("/einsaetze/{}/abloesung?schicht={id}", w.einsatz).as_str()
    );
}

/// Alarmierung, Eintreffen am Bereitstellungsraum und Abruf der geplanten Einheit melden je
/// genau einen Hinweis an alle Leser außer der Auslöserin; eine nicht geplante Einheit nichts.
#[tokio::test]
async fn alarmierung_bereitstellungsraum_und_abruf_melden_je_einen_hinweis() {
    let w = welt().await;
    let rs = w.einheit("Rettungsstaffel").await;
    let rs2 = w.einheit("2. Rettungsstaffel").await;
    let andere = w.einheit("Florian 9").await;
    let id = w.schicht(rs, 480).await;
    w.aendern(id, json!({ "abloesende_einheit_id": rs2 })).await;
    let alarmiert = w.status_mit_marke("Alarmiert", "alarmierung").await;
    let leser = vec![w.admin_id, w.bert, w.carl];
    let anna = w.cookie("annika").await;

    w.handstatus(&anna, rs2, alarmiert).await;
    w.handstatus(&anna, andere, alarmiert).await;
    assert_eq!(
        w.empfaenger("abloesung_abloeser", "abloeser_alarmiert")
            .await,
        leser
    );

    let (s, br) = anfrage_json(
        &w.app,
        "POST",
        &w.pfad("bereitstellungsraeume"),
        &w.admin,
        Some(&json!({ "bezeichnung": "BR Sportplatz" })),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{br}");
    let br = br["id"].as_i64().unwrap();
    let br_pfad = w.pfad(&format!("bereitstellungsraeume/{br}"));
    let (s, _) = anfrage_json(
        &w.app,
        "POST",
        &format!("{br_pfad}/status"),
        &w.admin,
        Some(&json!({ "status": "aktiv" })),
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    let (s, v) = anfrage_json(
        &w.app,
        "POST",
        &format!("{br_pfad}/eintreffen"),
        &anna,
        Some(&json!({ "kraft": { "objekt_typ": "einheit", "objekt_id": rs2 } })),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
    assert_eq!(
        w.empfaenger("abloesung_abloeser", "abloeser_br_eingetroffen")
            .await,
        leser
    );
    assert!(
        w.empfaenger("abloesung_abloeser", "abloeser_eingetroffen")
            .await
            .is_empty(),
        "das Eintreffen am Raum ist ein Hinweis, nicht zwei"
    );

    let (s, v) = anfrage_json(
        &w.app,
        "POST",
        &format!("{br_pfad}/abruf"),
        &anna,
        Some(&json!({ "objekt_typ": "einheit", "objekt_id": rs2 })),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
    assert_eq!(
        w.empfaenger("abloesung_abloeser", "abloeser_abgerufen")
            .await,
        leser
    );
    let n: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM benachrichtigung WHERE art = 'abloesung_abloeser'",
    )
    .fetch_one(&w.pool)
    .await
    .unwrap();
    assert_eq!(n, 9, "drei Ereignisse, je drei Leser");
}

// ───────────────────────── Planung entfällt ─────────────────────────

/// Akzeptanzkriterium: das Auflösen der geplanten Einheit → Hinweis an die Leser und ETB
/// „Planung der ablösenden Einheit entfallen“; die Schicht trägt keine Planung mehr.
#[tokio::test]
async fn aufloesen_der_geplanten_einheit_meldet_planung_entfallen() {
    let w = welt().await;
    let rs = w.einheit("Rettungsstaffel").await;
    let rs2 = w.einheit("2. Rettungsstaffel").await;
    let id = w.schicht(rs, 480).await;
    w.aendern(id, json!({ "abloesende_einheit_id": rs2 })).await;
    let anna = w.cookie("annika").await;

    let (s, v) = anfrage(
        &w.app,
        "DELETE",
        &w.pfad(&format!("einheiten/{rs2}")),
        &anna,
        None,
    )
    .await;
    assert!(s.is_success(), "{s} {v}");

    assert_eq!(
        w.empfaenger("abloesung_abloeser", "abloeser_entfallen")
            .await,
        vec![w.admin_id, w.bert, w.carl]
    );
    assert_eq!(
        w.etb_mit("Planung der ablösenden Einheit entfallen").await,
        vec![
            "Ablösung «Rettungsstaffel»: Planung der ablösenden Einheit entfallen, \
             «2. Rettungsstaffel» aufgelöst"
                .to_string()
        ]
    );
    let (s, v) = anfrage(
        &w.app,
        "GET",
        &w.pfad("abloesungen?status=laufend"),
        &w.admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    assert!(
        !v[0]
            .as_object()
            .unwrap()
            .contains_key("abloesende_einheit_id"),
        "{v}"
    );
}

// ───────────────────────── Plausibilität beim Planen ─────────────────────────

/// Spec „Plausibilität beim Planen“: die Antwort der Planung warnt „schon geplant“, die Planung
/// gelingt (200).
#[tokio::test]
async fn planen_einer_schon_geplanten_einheit_warnt_in_der_antwort() {
    let w = welt().await;
    let f1 = w.einheit("Florian 1").await;
    let f2 = w.einheit("Florian 2").await;
    let f3 = w.einheit("Florian 3").await;
    let a = w.schicht(f1, 480).await;
    let b = w.schicht(f2, 480).await;
    let v = w.aendern(a, json!({ "abloesende_einheit_id": f3 })).await;
    assert_eq!(v["planung_warnungen"], json!([]));
    let v = w.aendern(b, json!({ "abloesende_einheit_id": f3 })).await;
    assert_eq!(v["abloesende_einheit_id"], f3);
    assert_eq!(
        v["planung_warnungen"],
        json!([{
            "art": "schon_geplant",
            "einheit_id": f3,
            "einheit_name": "Florian 3",
            "abloesung_id": a,
            "abloesung_einheit_name": "Florian 1",
        }])
    );
    // Eine Einheit mit eigener Schicht: „steht selbst im Einsatz seit …“.
    let v = w.aendern(a, json!({ "abloesende_einheit_id": f2 })).await;
    let warnung = &v["planung_warnungen"][0];
    assert_eq!(warnung["art"], "im_einsatz");
    assert!(warnung["seit_at"].is_string(), "{v}");
}

// ───────────────────────── Gemeinte Einheit (LLH-1511) ─────────────────────────

impl Welt {
    /// Die Detailzeile des einzigen Hinweises `bezug_typ`, wie der Admin ihn liest.
    async fn detail_fuer_admin(&self, bezug_typ: &str) -> Value {
        let (s, v) = anfrage(
            &self.app,
            "GET",
            &format!("/api/benachrichtigungen?einsatz_id={}", self.einsatz),
            &self.admin,
            None,
        )
        .await;
        assert_eq!(s, StatusCode::OK, "{v}");
        let treffer: Vec<&Value> = v
            .as_array()
            .unwrap()
            .iter()
            .filter(|e| e["bezug_typ"] == bezug_typ)
            .collect();
        assert_eq!(treffer.len(), 1, "{bezug_typ}: {v}");
        treffer[0]["detail"].clone()
    }
}

/// Hinweis zu A, danach Umplanen auf B: der alte Hinweis nennt weiter A.
#[tokio::test]
async fn hinweis_nennt_nach_dem_umplanen_weiter_die_alte_einheit() {
    let w = welt().await;
    let rs = w.einheit("Rettungsstaffel").await;
    let rs2 = w.einheit("2. Rettungsstaffel").await;
    let rs3 = w.einheit("3. Rettungsstaffel").await;
    let id = w.schicht(rs, 480).await;
    w.aendern(id, json!({ "abloesende_einheit_id": rs2 })).await;
    let alarmiert = w.status_mit_marke("Alarmiert", "alarmierung").await;
    let anna = w.cookie("annika").await;
    w.handstatus(&anna, rs2, alarmiert).await;

    w.aendern(id, json!({ "abloesende_einheit_id": rs3 })).await;

    assert_eq!(
        w.detail_fuer_admin("abloeser_alarmiert").await,
        "Ablösung für Rettungsstaffel: 2. Rettungsstaffel"
    );
}

/// Der Hinweis zum zweiten Ablöser der Liste nennt diesen, nicht den ersten (den Spiegel).
#[tokio::test]
async fn hinweis_zum_zweiten_abloeser_der_liste_nennt_diesen() {
    let w = welt().await;
    let rs = w.einheit("Rettungsstaffel").await;
    let rs2 = w.einheit("2. Rettungsstaffel").await;
    let rs3 = w.einheit("3. Rettungsstaffel").await;
    let id = w.schicht(rs, 480).await;
    w.aendern(id, json!({ "abloeser_ids": [rs2, rs3] })).await;
    let alarmiert = w.status_mit_marke("Alarmiert", "alarmierung").await;
    let anna = w.cookie("annika").await;
    w.handstatus(&anna, rs3, alarmiert).await;

    assert_eq!(
        w.detail_fuer_admin("abloeser_alarmiert").await,
        "Ablösung für Rettungsstaffel: 3. Rettungsstaffel"
    );
}

/// „Planung entfallen“ nennt die entfallene Einheit, auch wenn ein weiterer Ablöser der Liste
/// nachrückt und der Spiegel ihn trägt.
#[tokio::test]
async fn hinweis_planung_entfallen_nennt_die_entfallene_einheit() {
    let w = welt().await;
    let rs = w.einheit("Rettungsstaffel").await;
    let rs2 = w.einheit("2. Rettungsstaffel").await;
    let rs3 = w.einheit("3. Rettungsstaffel").await;
    let id = w.schicht(rs, 480).await;
    w.aendern(id, json!({ "abloeser_ids": [rs2, rs3] })).await;
    // Mit Alarmierung hat rs2 eine Spur: das Auflösen entlässt sie, statt sie zu löschen.
    let alarmiert = w.status_mit_marke("Alarmiert", "alarmierung").await;
    w.handstatus(&w.admin, rs2, alarmiert).await;
    let anna = w.cookie("annika").await;

    let (s, v) = anfrage(
        &w.app,
        "DELETE",
        &w.pfad(&format!("einheiten/{rs2}")),
        &anna,
        None,
    )
    .await;
    assert!(s.is_success(), "{s} {v}");

    assert_eq!(
        w.detail_fuer_admin("abloeser_entfallen").await,
        "Ablösung für Rettungsstaffel: 2. Rettungsstaffel"
    );
}

/// Eine Einheit, die ein Hinweis nennt, hat eine Spur und wird nie gelöscht: Auflösen lässt
/// ihre Zeile stehen, SQLite vergibt ihre ID (kein AUTOINCREMENT) also nicht neu, und der
/// festgehaltene Hinweis kann keine fremde Einheit nennen.
#[tokio::test]
async fn hinweis_einheit_bleibt_beim_aufloesen_stehen_und_ihre_id_frei() {
    let w = welt().await;
    let rs = w.einheit("Rettungsstaffel").await;
    let rs2 = w.einheit("2. Rettungsstaffel").await;
    let id = w.schicht(rs, 480).await;
    w.aendern(id, json!({ "abloesende_einheit_id": rs2 })).await;
    let anna = w.cookie("annika").await;
    let (s, v) = anfrage(
        &w.app,
        "DELETE",
        &w.pfad(&format!("einheiten/{rs2}")),
        &anna,
        None,
    )
    .await;
    assert!(s.is_success(), "{s} {v}");
    let steht: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM einsatz_einheit WHERE id = ?")
        .bind(rs2)
        .fetch_one(&w.pool)
        .await
        .unwrap();
    assert_eq!(
        steht, 1,
        "die Planung ist eine Spur: aufgelöst, nicht gelöscht"
    );

    let neu = w.einheit("Florian 7").await;
    assert_ne!(neu, rs2, "die ID der aufgelösten Einheit bleibt belegt");

    assert_eq!(
        w.detail_fuer_admin("abloeser_entfallen").await,
        "Ablösung für Rettungsstaffel: 2. Rettungsstaffel"
    );
}

// ───────────────────────── Teilbaum eines geplanten Verbands (LLH-1509) ─────────────────────────

impl Welt {
    /// Hängt `einheit` unter `ueber` (Gliederung).
    async fn unter(&self, einheit: i64, ueber: i64) {
        let (s, v) = anfrage(
            &self.app,
            "PATCH",
            &self.pfad(&format!("einheiten/{einheit}")),
            &self.admin,
            Some(&json!({ "ueber_einheit_id": ueber }).to_string()),
        )
        .await;
        assert_eq!(s, StatusCode::OK, "{v}");
    }

    /// Nachtrag der Art vor `vor_minuten` an der Einheit, als `cookie`; die id des Ereignisses.
    async fn nachtrag(&self, cookie: &str, einheit: i64, art: &str, vor_minuten: i64) -> i64 {
        let (s, z) = anfrage(
            &self.app,
            "POST",
            &self.pfad(&format!("einheiten/{einheit}/zeitachse")),
            cookie,
            Some(
                &json!({
                    "art": art,
                    "zeitpunkt_at": wire(Utc::now() - Duration::minutes(vor_minuten)),
                })
                .to_string(),
            ),
        )
        .await;
        assert_eq!(s, StatusCode::CREATED, "{z}");
        z["ereignisse"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|e| e["art"] == art && e["gestrichen_at"].is_null())
            .map(|e| e["id"].as_i64().unwrap())
            .max()
            .unwrap()
    }

    async fn streichen(&self, cookie: &str, einheit: i64, zid: i64) {
        let (s, v) = anfrage(
            &self.app,
            "POST",
            &self.pfad(&format!("einheiten/{einheit}/zeitachse/{zid}/streichen")),
            cookie,
            Some(r#"{"grund":"falsche Einheit erfasst"}"#),
        )
        .await;
        assert_eq!(s, StatusCode::OK, "{v}");
    }

    /// Ein aktiver Bereitstellungsraum; sein Pfad.
    async fn bereitstellungsraum(&self, bezeichnung: &str) -> String {
        let (s, br) = anfrage_json(
            &self.app,
            "POST",
            &self.pfad("bereitstellungsraeume"),
            &self.admin,
            Some(&json!({ "bezeichnung": bezeichnung })),
        )
        .await;
        assert_eq!(s, StatusCode::CREATED, "{br}");
        let pfad = self.pfad(&format!(
            "bereitstellungsraeume/{}",
            br["id"].as_i64().unwrap()
        ));
        let (s, _) = anfrage_json(
            &self.app,
            "POST",
            &format!("{pfad}/status"),
            &self.admin,
            Some(&json!({ "status": "aktiv" })),
        )
        .await;
        assert_eq!(s, StatusCode::OK);
        pfad
    }

    /// Anzahl der Hinweise `abloesung_abloeser` mit dem Bezugstyp, über alle Empfänger.
    async fn anzahl_hinweise(&self, bezug_typ: &str) -> i64 {
        sqlx::query_scalar(
            "SELECT COUNT(*) FROM benachrichtigung \
             WHERE art = 'abloesung_abloeser' AND bezug_typ = ?",
        )
        .bind(bezug_typ)
        .fetch_one(&self.pool)
        .await
        .unwrap()
    }
}

/// Akzeptanzkriterium LLH-1509: Verband geplant, eine Staffel alarmiert → ein Hinweis
/// „Ablösende Einheit alarmiert“ zum Verband, das Detail nennt die Staffel; eine zweite Staffel
/// meldet nichts mehr. Die Schicht liefert die Untereinheiten am Ablöser (für die Karte).
#[tokio::test]
async fn verband_geplant_erste_staffel_alarmiert_meldet_genau_einen_hinweis() {
    let w = welt().await;
    let rs = w.einheit("Rettungsstaffel").await;
    let verband = w.einheit("Verband Nord").await;
    let st1 = w.einheit("1. Staffel").await;
    let st2 = w.einheit("2. Staffel").await;
    let trupp = w.einheit("Trupp").await;
    w.unter(st1, verband).await;
    w.unter(st2, verband).await;
    w.unter(trupp, st2).await;
    let id = w.schicht(rs, 480).await;
    let v = w.aendern(id, json!({ "abloeser_ids": [verband] })).await;
    let mut unter: Vec<i64> = v["abloeser"][0]["untereinheiten"]
        .as_array()
        .unwrap_or_else(|| panic!("{v}"))
        .iter()
        .map(|x| x.as_i64().unwrap())
        .collect();
    unter.sort_unstable();
    let mut erwartet = vec![st1, st2, trupp];
    erwartet.sort_unstable();
    assert_eq!(unter, erwartet, "der ganze Teilbaum, ohne den Verband: {v}");

    let alarmiert = w.status_mit_marke("Alarmiert", "alarmierung").await;
    let anna = w.cookie("annika").await;
    w.handstatus(&anna, st1, alarmiert).await;
    assert_eq!(
        w.empfaenger("abloesung_abloeser", "abloeser_alarmiert")
            .await,
        vec![w.admin_id, w.bert, w.carl]
    );
    assert_eq!(
        w.detail_fuer_admin("abloeser_alarmiert").await,
        "Ablösung für Rettungsstaffel: Verband Nord (durch 1. Staffel)"
    );

    w.handstatus(&anna, st2, alarmiert).await;
    w.handstatus(&anna, trupp, alarmiert).await;
    w.handstatus(&anna, verband, alarmiert).await;
    assert_eq!(
        w.anzahl_hinweise("abloeser_alarmiert").await,
        3,
        "weitere Einheiten des Teilbaums melden nichts"
    );
}

/// Ein nicht geplanter Verband: die Alarmierung seiner Staffel meldet nichts; ein geplanter
/// Vorfahr weiter oben zählt über die ganze Kette.
#[tokio::test]
async fn nur_ein_geplanter_vorfahr_zaehlt() {
    let w = welt().await;
    let rs = w.einheit("Rettungsstaffel").await;
    let bereitschaft = w.einheit("Bereitschaft").await;
    let verband = w.einheit("Verband Nord").await;
    let st1 = w.einheit("1. Staffel").await;
    let fremd = w.einheit("Verband Süd").await;
    let fremd_st = w.einheit("Staffel Süd").await;
    w.unter(verband, bereitschaft).await;
    w.unter(st1, verband).await;
    w.unter(fremd_st, fremd).await;
    let id = w.schicht(rs, 480).await;
    w.aendern(id, json!({ "abloeser_ids": [bereitschaft] }))
        .await;
    let alarmiert = w.status_mit_marke("Alarmiert", "alarmierung").await;
    let anna = w.cookie("annika").await;

    w.handstatus(&anna, fremd_st, alarmiert).await;
    assert_eq!(w.anzahl_hinweise("abloeser_alarmiert").await, 0);

    w.handstatus(&anna, st1, alarmiert).await;
    assert_eq!(
        w.detail_fuer_admin("abloeser_alarmiert").await,
        "Ablösung für Rettungsstaffel: Bereitschaft (durch 1. Staffel)"
    );
}

/// „Alarmierung … gestrichen“ erst, wenn im Teilbaum keine Einheit mehr alarmiert ist; das
/// Detail nennt die Staffel, deren Streichung es auslöste.
#[tokio::test]
async fn gestrichen_erst_wenn_im_teilbaum_keine_alarmierung_mehr_offen_ist() {
    let w = welt().await;
    let rs = w.einheit("Rettungsstaffel").await;
    let verband = w.einheit("Verband Nord").await;
    let st1 = w.einheit("1. Staffel").await;
    let st2 = w.einheit("2. Staffel").await;
    w.unter(st1, verband).await;
    w.unter(st2, verband).await;
    let id = w.schicht(rs, 480).await;
    w.aendern(id, json!({ "abloeser_ids": [verband] })).await;
    let anna = w.cookie("annika").await;
    let a1 = w.nachtrag(&anna, st1, "alarmierung", 20).await;
    let a2 = w.nachtrag(&anna, st2, "alarmierung", 10).await;
    assert_eq!(w.anzahl_hinweise("abloeser_alarmiert").await, 3);

    w.streichen(&anna, st1, a1).await;
    assert_eq!(
        w.anzahl_hinweise("abloeser_alarmierung_gestrichen").await,
        0,
        "2. Staffel ist noch alarmiert"
    );

    w.streichen(&anna, st2, a2).await;
    assert_eq!(
        w.empfaenger("abloesung_abloeser", "abloeser_alarmierung_gestrichen")
            .await,
        vec![w.admin_id, w.bert, w.carl]
    );
    assert_eq!(
        w.detail_fuer_admin("abloeser_alarmierung_gestrichen").await,
        "Ablösung für Rettungsstaffel: Verband Nord (durch 2. Staffel)"
    );
}

/// Bereitstellungsraum und Abruf: das erste Eintreffen im Raum und der erste Abruf im Teilbaum
/// melden je einmal. Die beim Abruf mitgenommene Untereinheit gehört zu diesem Ereignis und hält
/// den Hinweis nicht zurück.
#[tokio::test]
async fn raum_und_abruf_im_teilbaum_melden_je_einmal() {
    let w = welt().await;
    let rs = w.einheit("Rettungsstaffel").await;
    let verband = w.einheit("Verband Nord").await;
    let st1 = w.einheit("1. Staffel").await;
    let trupp = w.einheit("Trupp").await;
    w.unter(st1, verband).await;
    w.unter(trupp, st1).await;
    let id = w.schicht(rs, 480).await;
    w.aendern(id, json!({ "abloeser_ids": [verband] })).await;
    let br = w.bereitstellungsraum("BR Sportplatz").await;
    let anna = w.cookie("annika").await;
    for e in [st1, trupp] {
        let (s, v) = anfrage_json(
            &w.app,
            "POST",
            &format!("{br}/eintreffen"),
            &anna,
            Some(&json!({ "kraft": { "objekt_typ": "einheit", "objekt_id": e } })),
        )
        .await;
        assert_eq!(s, StatusCode::CREATED, "{v}");
    }
    assert_eq!(w.anzahl_hinweise("abloeser_br_eingetroffen").await, 3);
    assert_eq!(
        w.detail_fuer_admin("abloeser_br_eingetroffen").await,
        "Ablösung für Rettungsstaffel: Verband Nord (durch 1. Staffel)"
    );

    let (s, v) = anfrage_json(
        &w.app,
        "POST",
        &format!("{br}/abruf"),
        &anna,
        Some(&json!({ "objekt_typ": "einheit", "objekt_id": st1 })),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
    assert_eq!(
        w.empfaenger("abloesung_abloeser", "abloeser_abgerufen")
            .await,
        vec![w.admin_id, w.bert, w.carl],
        "der mitgenommene Trupp hält den Hinweis nicht zurück: {v}"
    );
}
