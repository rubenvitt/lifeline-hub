//! Chat-Erwähnung (LLH-1220, Change `kcjecn9e-benachrichtigungskonzept`, design.md D9, Spec
//! `benachrichtigungen`, „Chat-Erwähnung“, „Drei Stufen“/„Stilles Ereignis“, „Eigene Aktionen
//! benachrichtigen den Auslöser nicht“): eine neue Nachricht nimmt die Liste der Erwähnten an
//! (Nutzer und Funktionen), speichert sie in `chat_erwaehnung` und meldet `chat_erwaehnung` über
//! `benachrichtigung::melden` an die Erwähnten, die den Chat sehen dürfen. Alles andere bleibt
//! still.

use axum::http::StatusCode;
use serde_json::{json, Value};

mod common;
use common::{
    anfrage, benutzer_anlegen, einsatz_anlegen, login_cookie, rolle_setzen, setup_mit_pool,
};

struct Welt {
    app: axum::Router,
    pool: sqlx::SqlitePool,
    admin: String,
    einsatz: i64,
    kanal: i64,
    /// Mitglied (Führungspersonal) „annika“.
    anna: i64,
    /// Mitglied (Führungspersonal) „bertram“.
    bert: i64,
    /// Mitglied (Beobachter) „dorothea“.
    dora: i64,
}

/// Eine gespeicherte Benachrichtigung: (Empfänger, Art, Bezugstyp, Bezugskennung).
type Zeile = (i64, String, String, i64);

async fn welt() -> Welt {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let anna = benutzer_anlegen(&app, &admin, "annika", "keine").await;
    let bert = benutzer_anlegen(&app, &admin, "bertram", "keine").await;
    let dora = benutzer_anlegen(&app, &admin, "dorothea", "keine").await;
    rolle_setzen(&app, &admin, einsatz, anna, "fuehrungspersonal").await;
    rolle_setzen(&app, &admin, einsatz, bert, "fuehrungspersonal").await;
    rolle_setzen(&app, &admin, einsatz, dora, "beobachter").await;
    // Die Aufnahmen oben melden `einsatz_aufnahme` (tasks.md 15.1, `tests/benachrichtigung_org.rs`);
    // die Tests hier beginnen mit leerer Tabelle.
    sqlx::query("DELETE FROM benachrichtigung")
        .execute(&pool)
        .await
        .unwrap();
    let (s, v) = anfrage(
        &app,
        "GET",
        &format!("/api/einsaetze/{einsatz}/chat/kanaele"),
        &admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    let kanal = v[0]["id"].as_i64().unwrap();
    Welt {
        app,
        pool,
        admin,
        einsatz,
        kanal,
        anna,
        bert,
        dora,
    }
}

impl Welt {
    async fn cookie(&self, name: &str) -> String {
        login_cookie(&self.app, name, &format!("{name}pw1")).await
    }

    /// Legt eine Stamm-Person mit verknüpftem Konto an, disponiert sie und besetzt mit ihr ein
    /// Sachgebiet.
    async fn besetzen(&self, sachgebiet: &str, benutzer_id: i64) {
        let (s, v) = anfrage(
            &self.app,
            "POST",
            "/api/personal",
            &self.admin,
            Some(&json!({ "name": "Anna Albers", "benutzer_id": benutzer_id }).to_string()),
        )
        .await;
        assert_eq!(s, StatusCode::CREATED, "{v}");
        let (s, v) = anfrage(
            &self.app,
            "POST",
            &format!("/api/einsaetze/{}/personal", self.einsatz),
            &self.admin,
            Some(&json!({ "personal_id": v["id"] }).to_string()),
        )
        .await;
        assert_eq!(s, StatusCode::CREATED, "{v}");
        let (s, v) = anfrage(
            &self.app,
            "PUT",
            &format!(
                "/api/einsaetze/{}/stab/besetzung/{sachgebiet}",
                self.einsatz
            ),
            &self.admin,
            Some(&json!({ "besetzung_art": "personal", "personal_id": v["id"] }).to_string()),
        )
        .await;
        assert!(s.is_success(), "besetzen {sachgebiet}: {s} {v}");
    }

    /// Setzt die Funktion einer Mitgliedschaft (Ersatz, wenn die Stab-Besetzung leer ist).
    async fn funktion_setzen(&self, benutzer_id: i64, rolle: &str, funktion: &str) {
        let (s, v) = anfrage(
            &self.app,
            "PUT",
            &format!("/api/einsaetze/{}/mitglieder/{benutzer_id}", self.einsatz),
            &self.admin,
            Some(&json!({ "einsatz_rolle": rolle, "fuehrungsfunktion": funktion }).to_string()),
        )
        .await;
        assert_eq!(s, StatusCode::OK, "{v}");
    }

    /// Sendet als `cookie` eine Nachricht; liefert Status und Antwort.
    async fn senden(&self, cookie: &str, body: Value) -> (StatusCode, Value) {
        anfrage(
            &self.app,
            "POST",
            &format!(
                "/api/einsaetze/{}/chat/kanaele/{}/nachrichten",
                self.einsatz, self.kanal
            ),
            cookie,
            Some(&body.to_string()),
        )
        .await
    }

    /// Sendet eine Nachricht, die angenommen werden muss; liefert ihre Kennung.
    async fn gesendet(&self, cookie: &str, body: Value) -> i64 {
        let (s, v) = self.senden(cookie, body).await;
        assert_eq!(s, StatusCode::CREATED, "{v}");
        v["id"].as_i64().unwrap()
    }

    async fn zeilen(&self) -> Vec<Zeile> {
        sqlx::query_as(
            "SELECT benutzer_id, art, bezug_typ, bezug_id FROM benachrichtigung ORDER BY id",
        )
        .fetch_all(&self.pool)
        .await
        .unwrap()
    }

    /// Die gespeicherten Erwähnungen: (Nachricht, Nutzer, Funktion).
    async fn erwaehnungen(&self) -> Vec<(i64, Option<i64>, Option<String>)> {
        sqlx::query_as(
            "SELECT nachricht_id, benutzer_id, funktion FROM chat_erwaehnung \
             ORDER BY nachricht_id, benutzer_id, funktion",
        )
        .fetch_all(&self.pool)
        .await
        .unwrap()
    }

    async fn nachrichten(&self) -> i64 {
        sqlx::query_scalar("SELECT COUNT(*) FROM chat_nachricht")
            .fetch_one(&self.pool)
            .await
            .unwrap()
    }

    /// Die Benachrichtigungen, wie `cookie` sie über die Route liest.
    async fn lesen(&self, cookie: &str) -> Vec<Value> {
        let (s, v) = anfrage(&self.app, "GET", "/api/benachrichtigungen", cookie, None).await;
        assert_eq!(s, StatusCode::OK, "{v}");
        v.as_array().unwrap().clone()
    }

    /// Erlaubt den Chat nur der Einsatzführung (nicht Beobachtern).
    async fn chat_nur_fuer_die_fuehrung(&self) {
        let (s, v) = anfrage(
            &self.app,
            "PUT",
            &format!("/api/einsaetze/{}/modul-overrides/chat", self.einsatz),
            &self.admin,
            Some(r#"{"sichtbar":true,"benoetigte_rolle":"einsatzfuehrung"}"#),
        )
        .await;
        assert_eq!(s, StatusCode::OK, "{v}");
    }
}

fn erwaehnung(id: i64) -> Value {
    json!({ "benutzer_id": id })
}

fn funktion(code: &str) -> Value {
    json!({ "funktion": code })
}

fn zeile(benutzer: i64, nachricht: i64) -> Zeile {
    (
        benutzer,
        "chat_erwaehnung".into(),
        "chat_nachricht".into(),
        nachricht,
    )
}

// ───────────────────────── Benachrichtigen ─────────────────────────

/// Spec-Szenario „Erwähnung einer Funktion“: „@S4 bitte Verpflegung klären“ erreicht die
/// Nutzer von S4 mit „Erwähnt im Chat“ und Sprung in den Kanal der Nachricht. Wer S4 nicht
/// hat (Bert als S2), der Autor und ein Beobachter bekommen nichts.
#[tokio::test]
async fn erwaehnung_einer_funktion_erreicht_ihre_nutzer() {
    let w = welt().await;
    w.besetzen("s4", w.anna).await;
    w.funktion_setzen(w.bert, "fuehrungspersonal", "s2").await;
    let n = w
        .gesendet(
            &w.admin,
            json!({ "inhalt": "@S4 bitte Verpflegung klären", "erwaehnungen": [funktion("s4")] }),
        )
        .await;

    assert_eq!(w.zeilen().await, vec![zeile(w.anna, n)]);
    assert_eq!(w.erwaehnungen().await, vec![(n, None, Some("s4".into()))]);
    let gelesen = w.lesen(&w.cookie("annika").await).await;
    assert_eq!(gelesen.len(), 1, "{gelesen:?}");
    assert_eq!(gelesen[0]["titel"], "Erwähnt im Chat");
    assert_eq!(gelesen[0]["stufe"], "hinweis");
    assert_eq!(
        gelesen[0]["pfad"],
        format!("/einsaetze/{}/chat?kanal={}", w.einsatz, w.kanal)
    );
    // Keine Detailzeile: Inhalt und Kanalname sind Scrub-Werte.
    assert!(!gelesen[0].as_object().unwrap().contains_key("detail"));
    assert!(w.lesen(&w.cookie("bertram").await).await.is_empty());
    assert!(w.lesen(&w.cookie("dorothea").await).await.is_empty());
    assert!(w.lesen(&w.admin).await.is_empty());
}

/// Ohne Stab-Besetzung gilt die Funktion der Mitgliedschaft (Spec „Meine Funktion“).
#[tokio::test]
async fn erwaehnung_einer_funktion_erreicht_ersatzweise_die_mitgliedschaft() {
    let w = welt().await;
    w.funktion_setzen(w.bert, "fuehrungspersonal", "s4").await;
    let n = w
        .gesendet(
            &w.admin,
            json!({ "inhalt": "@S4 bitte", "erwaehnungen": [funktion("s4")] }),
        )
        .await;
    assert_eq!(w.zeilen().await, vec![zeile(w.bert, n)]);
}

/// Ein erwähnter Nutzer bekommt den Hinweis, andere Mitglieder nicht.
#[tokio::test]
async fn erwaehnung_eines_nutzers_erreicht_nur_ihn() {
    let w = welt().await;
    let n = w
        .gesendet(
            &w.admin,
            json!({ "inhalt": "@Bertram kommst du?", "erwaehnungen": [erwaehnung(w.bert)] }),
        )
        .await;
    assert_eq!(w.zeilen().await, vec![zeile(w.bert, n)]);
    assert_eq!(w.erwaehnungen().await, vec![(n, Some(w.bert), None)]);
}

/// Spec „Eigene Aktionen benachrichtigen den Auslöser nicht“: wer sich selbst oder seine eigene
/// Funktion erwähnt, bekommt nichts; die anderen Erwähnten schon, jeder genau einmal.
#[tokio::test]
async fn der_autor_bekommt_nichts_auch_als_erwaehnter() {
    let w = welt().await;
    w.besetzen("s4", w.anna).await;
    let anna = w.cookie("annika").await;
    let n = w
        .gesendet(
            &anna,
            json!({
                "inhalt": "@Annika @S4 @Bertram",
                "erwaehnungen": [erwaehnung(w.anna), funktion("s4"), erwaehnung(w.bert),
                                 erwaehnung(w.bert)]
            }),
        )
        .await;
    assert_eq!(w.zeilen().await, vec![zeile(w.bert, n)]);
    assert!(w.lesen(&anna).await.is_empty());
}

/// Spec „Stilles Ereignis“: eine Nachricht ohne Erwähnung benachrichtigt niemanden, auch wenn
/// ihr Text `@S4` enthält (der Server parst den Text nicht, design.md D9).
#[tokio::test]
async fn nachricht_ohne_erwaehnung_bleibt_still() {
    let w = welt().await;
    w.besetzen("s4", w.anna).await;
    w.gesendet(
        &w.admin,
        json!({ "inhalt": "@S4 bitte Verpflegung klären" }),
    )
    .await;
    w.gesendet(
        &w.admin,
        json!({ "inhalt": "Lage ruhig", "erwaehnungen": [] }),
    )
    .await;
    assert!(w.zeilen().await.is_empty());
    assert!(w.erwaehnungen().await.is_empty());
}

/// Spec „Chat-Erwähnung“: nur wer den Kanal sehen darf. Ist der Chat der Einsatzführung
/// vorbehalten, bekommt die erwähnte Beobachterin nichts, der erwähnte Führungsassistent schon.
#[tokio::test]
async fn ohne_sicht_auf_den_chat_kein_hinweis() {
    let w = welt().await;
    w.chat_nur_fuer_die_fuehrung().await;
    w.funktion_setzen(w.dora, "beobachter", "s4").await;
    let n = w
        .gesendet(
            &w.admin,
            json!({
                "inhalt": "@Dora @Annika @S4",
                "erwaehnungen": [erwaehnung(w.dora), erwaehnung(w.anna), funktion("s4")]
            }),
        )
        .await;
    assert_eq!(w.zeilen().await, vec![zeile(w.anna, n)]);
    assert!(w.lesen(&w.cookie("dorothea").await).await.is_empty());
}

/// Wiederholung: Bearbeiten ändert eine bestehende Nachricht und bleibt still, auch mit
/// Erwähnungen im Body (die Route ignoriert sie dort); eine Erwähnung meldet genau einmal.
/// Das Senden kennt keinen Idempotenzschlüssel: ein zweites POST ist eine zweite Nachricht.
#[tokio::test]
async fn bearbeiten_bleibt_still() {
    let w = welt().await;
    let n = w
        .gesendet(
            &w.admin,
            json!({ "inhalt": "@Bertram", "erwaehnungen": [erwaehnung(w.bert)] }),
        )
        .await;
    let body = json!({ "inhalt": "@Bertram @Annika",
                       "erwaehnungen": [erwaehnung(w.bert), erwaehnung(w.anna)] });
    let (s, v) = anfrage(
        &w.app,
        "PATCH",
        &format!("/api/einsaetze/{}/chat/nachrichten/{n}", w.einsatz),
        &w.admin,
        Some(&body.to_string()),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert_eq!(w.zeilen().await, vec![zeile(w.bert, n)]);
    assert_eq!(w.erwaehnungen().await, vec![(n, Some(w.bert), None)]);
}

// ───────────────────────── Eingabe ─────────────────────────

/// `src/AGENTS.md`, Eingabegrenzen und Statuscode-Konvention: die Liste für sich (zu lang vor
/// dem Entdoppeln, falscher Typ, unbekannter Code) ist 400, der Zusammenhang (beide oder kein
/// Feld, Nicht-Mitglied, S7 ohne PSNV) 422. Abgelehnt wird vor jedem Schreiben: keine
/// Nachricht, keine Erwähnung, keine Benachrichtigung.
#[tokio::test]
async fn ungueltige_erwaehnungen_werden_abgelehnt() {
    let w = welt().await;
    let fremd = benutzer_anlegen(&w.app, &w.admin, "fremda", "keine").await;
    let max = lifeline_hub::chat::erwaehnung::ERWAEHNUNGEN_MAX;
    let faelle: Vec<(Value, StatusCode)> = vec![
        (
            json!(vec![erwaehnung(w.bert); max + 1]),
            StatusCode::BAD_REQUEST,
        ),
        (json!("s4"), StatusCode::BAD_REQUEST),
        (json!([{ "benutzer_id": "x" }]), StatusCode::BAD_REQUEST),
        (json!([funktion("s9")]), StatusCode::BAD_REQUEST),
        (
            json!([{ "benutzer_id": w.bert, "funktion": "s4" }]),
            StatusCode::UNPROCESSABLE_ENTITY,
        ),
        (json!([{}]), StatusCode::UNPROCESSABLE_ENTITY),
        (
            json!([erwaehnung(w.bert), erwaehnung(fremd)]),
            StatusCode::UNPROCESSABLE_ENTITY,
        ),
        (
            json!([erwaehnung(999_999)]),
            StatusCode::UNPROCESSABLE_ENTITY,
        ),
        (json!([funktion("s7")]), StatusCode::UNPROCESSABLE_ENTITY),
    ];
    for (liste, erwartet) in faelle {
        let (s, v) = w
            .senden(&w.admin, json!({ "inhalt": "@x", "erwaehnungen": liste }))
            .await;
        assert_eq!(s, erwartet, "{liste}: {v}");
        assert!(v["error"].is_string(), "{liste}: {v}");
    }
    assert_eq!(w.nachrichten().await, 0);
    assert!(w.erwaehnungen().await.is_empty());
    assert!(w.zeilen().await.is_empty());
}

/// Genau die Grenze geht durch; Doppelte zählen vorher mit und werden einmal gespeichert.
#[tokio::test]
async fn volle_liste_wird_entdoppelt_gespeichert() {
    let w = welt().await;
    let max = lifeline_hub::chat::erwaehnung::ERWAEHNUNGEN_MAX;
    let mut liste = vec![erwaehnung(w.bert); max - 1];
    liste.push(funktion(" s4 "));
    let n = w
        .gesendet(&w.admin, json!({ "inhalt": "@B", "erwaehnungen": liste }))
        .await;
    assert_eq!(
        w.erwaehnungen().await,
        vec![(n, None, Some("s4".into())), (n, Some(w.bert), None)]
    );
    assert_eq!(w.zeilen().await, vec![zeile(w.bert, n)]);
}

/// Aufbewahrung: die Erwähnungen fallen mit dem Einsatz (CASCADE über die Nachricht).
#[tokio::test]
async fn erwaehnungen_fallen_mit_dem_einsatz() {
    let w = welt().await;
    w.gesendet(
        &w.admin,
        json!({ "inhalt": "@B", "erwaehnungen": [erwaehnung(w.bert), funktion("s4")] }),
    )
    .await;
    assert_eq!(w.erwaehnungen().await.len(), 2);
    sqlx::query("DELETE FROM einsatz WHERE id = ?")
        .bind(w.einsatz)
        .execute(&w.pool)
        .await
        .unwrap();
    assert!(w.erwaehnungen().await.is_empty());
}
