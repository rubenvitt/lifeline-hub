//! Änderungen der Kräfte-Zeitachse an der ablösenden Einheit (LLH-1425, Katalog LLH-1142 E1
//! „Änderung bei ablösender Einheit“, Spec `benachrichtigungen` und `kraefte-abloesung`,
//! „Hinweise zur ablösenden Einheit“). Die Art `abloesung_abloeser` deckt Alarmierung, Eintreffen,
//! Eintreffen am Bereitstellungsraum, Abruf und entfallene Planung schon ab, auch wenn sie als
//! Nachtrag in die Zeitachse kommen (`tests/abloesung_hinweise.rs`). Neu ist die Streichung: wird
//! die Alarmierung oder das Eintreffen gestrichen, mit dem die offene Periode der geplanten
//! Einheit begann, gilt der frühere Hinweis nicht mehr; je Streichung genau ein Hinweis
//! „… gestrichen“ an die Leser des Moduls Ablösung, nicht an die Auslöserin.

use axum::http::StatusCode;
use chrono::{Duration, Utc};
use serde_json::{json, Value};

mod common;
use common::{
    anfrage, benutzer_anlegen, einsatz_anlegen, login_cookie, rolle_setzen, setup_mit_pool_und_live,
};

const ART: &str = "abloesung_abloeser";

struct Welt {
    app: axum::Router,
    pool: sqlx::SqlitePool,
    admin: String,
    admin_id: i64,
    einsatz: i64,
    /// Streicht (Auslöserin), liest die Ablösung.
    anna: i64,
    bert: i64,
    carl: i64,
    /// Die abzulösende Einheit, ihre Schicht und die geplante ablösende Einheit.
    schicht: i64,
    abloeser: i64,
}

async fn welt() -> Welt {
    let (app, pool, _live) = setup_mit_pool_und_live().await;
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
    let mut w = Welt {
        app,
        pool,
        admin,
        admin_id,
        einsatz,
        anna,
        bert,
        carl,
        schicht: 0,
        abloeser: 0,
    };
    let rs = w.einheit("Rettungsstaffel").await;
    w.abloeser = w.einheit("2. Rettungsstaffel").await;
    let (s, v) = anfrage(
        &w.app,
        "POST",
        &w.pfad("abloesungen"),
        &w.admin,
        Some(
            &json!({
                "einheit_id": rs,
                "beginn_at": wire_vor(60),
                "rhythmus_minuten": 480,
            })
            .to_string(),
        ),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
    w.schicht = v["id"].as_i64().unwrap();
    w.planen().await;
    sqlx::query("DELETE FROM benachrichtigung")
        .execute(&w.pool)
        .await
        .unwrap();
    w
}

/// Zeitpunkt vor `minuten` Minuten auf dem Draht.
fn wire_vor(minuten: i64) -> String {
    (Utc::now() - Duration::minutes(minuten))
        .format("%Y-%m-%dT%H:%M:%SZ")
        .to_string()
}

impl Welt {
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

    /// Plant die ablösende Einheit für die Schicht.
    async fn planen(&self) {
        let (s, v) = anfrage(
            &self.app,
            "PATCH",
            &self.pfad(&format!("abloesungen/{}", self.schicht)),
            &self.admin,
            Some(&json!({ "abloesende_einheit_id": self.abloeser }).to_string()),
        )
        .await;
        assert_eq!(s, StatusCode::OK, "{v}");
    }

    /// Nachtrag an der Einheit (als Admin); liefert die id des neuen Ereignisses.
    async fn nachtrag(&self, einheit: i64, art: &str, vor_minuten: i64) -> i64 {
        let (s, z) = anfrage(
            &self.app,
            "POST",
            &self.pfad(&format!("einheiten/{einheit}/zeitachse")),
            &self.admin,
            Some(&json!({ "art": art, "zeitpunkt_at": wire_vor(vor_minuten) }).to_string()),
        )
        .await;
        assert_eq!(s, StatusCode::CREATED, "{z}");
        ereignis_id(&z, art)
    }

    /// Streicht als Annika das Ereignis `zid` der Einheit.
    async fn streichen(&self, einheit: i64, zid: i64) {
        let anna = login_cookie(&self.app, "annika", "annikapw1").await;
        let (s, v) = anfrage(
            &self.app,
            "POST",
            &self.pfad(&format!("einheiten/{einheit}/zeitachse/{zid}/streichen")),
            &anna,
            Some(r#"{"grund":"falsche Einheit erfasst"}"#),
        )
        .await;
        assert_eq!(s, StatusCode::OK, "{v}");
    }

    /// Empfänger der Hinweise mit dem Bezugstyp, aufsteigend.
    async fn empfaenger(&self, bezug_typ: &str) -> Vec<i64> {
        sqlx::query_scalar(
            "SELECT benutzer_id FROM benachrichtigung WHERE art = ? AND bezug_typ = ? \
             AND bezug_id = ? ORDER BY benutzer_id",
        )
        .bind(ART)
        .bind(bezug_typ)
        .bind(self.schicht)
        .fetch_all(&self.pool)
        .await
        .unwrap()
    }

    async fn anzahl(&self) -> i64 {
        sqlx::query_scalar("SELECT COUNT(*) FROM benachrichtigung")
            .fetch_one(&self.pool)
            .await
            .unwrap()
    }
}

/// Die id des zuletzt erfassten, nicht gestrichenen Ereignisses der Art in der Zeitachse.
fn ereignis_id(z: &Value, art: &str) -> i64 {
    z["ereignisse"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|e| e["art"] == art && e["gestrichen_at"].is_null())
        .map(|e| e["id"].as_i64().unwrap())
        .max()
        .unwrap_or_else(|| panic!("kein Ereignis {art}: {z}"))
}

/// Ein Nachtrag der Alarmierung in die Zeitachse ist schon der bestehende Hinweis „alarmiert“;
/// ihre Streichung meldet „Alarmierung der ablösenden Einheit gestrichen“ an alle Leser außer der
/// Auslöserin, genau einmal, als Eingang mit Sprung zur Schicht.
#[tokio::test]
async fn gestrichene_alarmierung_der_abloesenden_einheit_meldet_einen_hinweis() {
    let w = welt().await;
    let zid = w.nachtrag(w.abloeser, "alarmierung", 10).await;
    assert_eq!(
        w.empfaenger("abloeser_alarmiert").await,
        vec![w.anna, w.bert, w.carl],
        "Nachtrag durch den Admin: der bestehende Hinweis deckt ihn ab"
    );

    w.streichen(w.abloeser, zid).await;

    let leser = vec![w.admin_id, w.bert, w.carl];
    assert_eq!(w.empfaenger("abloeser_alarmierung_gestrichen").await, leser);
    assert_eq!(w.anzahl().await, 3 + 3, "alarmiert und gestrichen, je drei");

    let bert = login_cookie(&w.app, "bertram", "bertrampw1").await;
    let (s, v) = anfrage(
        &w.app,
        "GET",
        "/api/benachrichtigungen?offen=true",
        &bert,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    let eintrag = v
        .as_array()
        .unwrap()
        .iter()
        .find(|e| e["bezug_typ"] == "abloeser_alarmierung_gestrichen")
        .unwrap_or_else(|| panic!("kein Hinweis im Verlauf: {v}"));
    assert_eq!(
        eintrag["titel"],
        "Alarmierung der ablösenden Einheit gestrichen"
    );
    assert_eq!(eintrag["stufe"], "hinweis");
    assert_eq!(
        eintrag["detail"],
        "Ablösung für Rettungsstaffel: 2. Rettungsstaffel"
    );
    assert_eq!(
        eintrag["pfad"],
        format!("/einsaetze/{}/abloesung?schicht={}", w.einsatz, w.schicht)
    );
}

/// Das gestrichene Eintreffen, mit dem die offene Periode begann, meldet „Eintreffen der
/// ablösenden Einheit gestrichen“.
#[tokio::test]
async fn gestrichenes_eintreffen_der_abloesenden_einheit_meldet_einen_hinweis() {
    let w = welt().await;
    let zid = w.nachtrag(w.abloeser, "eintreffen", 10).await;
    assert_eq!(
        w.empfaenger("abloeser_eingetroffen").await,
        vec![w.anna, w.bert, w.carl]
    );

    w.streichen(w.abloeser, zid).await;

    assert_eq!(
        w.empfaenger("abloeser_eintreffen_gestrichen").await,
        vec![w.admin_id, w.bert, w.carl]
    );
    assert_eq!(w.anzahl().await, 6);
}

/// Gegenseiten: eine Streichung an einer Einheit, die nirgends als ablösende geplant ist, und die
/// Streichung eines Ereignisses einer schon abgeschlossenen Periode (dazu gab es nie einen
/// Hinweis) bleiben still.
#[tokio::test]
async fn ohne_planung_oder_ausserhalb_der_offenen_periode_bleibt_es_still() {
    let w = welt().await;
    let andere = w.einheit("Florian 9").await;
    let zid = w.nachtrag(andere, "alarmierung", 10).await;
    w.streichen(andere, zid).await;
    assert_eq!(w.anzahl().await, 0, "nicht geplant");

    // Abgeschlossene Periode der geplanten Einheit (Alarmierung, Eintreffen, Entlassung), danach
    // eine neue offene Periode ab dem Eintreffen. Die Entlassung hob die Planung auf; neu planen.
    let alt = w.nachtrag(w.abloeser, "alarmierung", 50).await;
    w.nachtrag(w.abloeser, "eintreffen", 40).await;
    w.nachtrag(w.abloeser, "entlassung", 30).await;
    let offen = w.nachtrag(w.abloeser, "eintreffen", 10).await;
    w.planen().await;
    sqlx::query("DELETE FROM benachrichtigung")
        .execute(&w.pool)
        .await
        .unwrap();
    w.streichen(w.abloeser, alt).await;
    assert_eq!(w.anzahl().await, 0, "abgeschlossene Periode");

    // Gegenprobe: die Planung steht, das Eintreffen der offenen Periode meldet.
    w.streichen(w.abloeser, offen).await;
    assert_eq!(
        w.empfaenger("abloeser_eintreffen_gestrichen").await,
        vec![w.admin_id, w.bert, w.carl]
    );
}
