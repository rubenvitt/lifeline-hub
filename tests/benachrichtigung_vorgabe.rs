//! Vorgabe je Funktion am Einsatz (LLH-1421, Entwurf `/mnt/project-files/llh-1421/design.md`,
//! D2–D4; Spec `benachrichtigungen`, „Vorgabe je Funktion am Einsatz“): Lesen und Setzen über
//! `…/benachrichtigung-vorgaben`, Rechte und Statuscodes, das Live-Ereignis und die Wirkung auf
//! die Empfänger eines Auftrags (lauter gewinnt).

use axum::http::StatusCode;
use lifeline_hub::live::{LiveEvent, LiveNachricht};
use serde_json::{json, Value};
use tokio::sync::broadcast::Receiver;

mod common;
use common::{
    anfrage, anfrage_json, benutzer_anlegen, einsatz_anlegen, login_cookie, rolle_setzen,
    setup_mit_pool_und_live,
};

struct Welt {
    app: axum::Router,
    pool: sqlx::SqlitePool,
    live: lifeline_hub::live::LiveHub,
    admin: String,
    einsatz: i64,
    /// S2 über die Stab-Besetzung und S4 über die Mitgliedschaft.
    anna: i64,
    /// S2 über die Mitgliedschaft.
    bert: i64,
}

async fn welt() -> Welt {
    let (app, pool, live) = setup_mit_pool_und_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let anna = benutzer_anlegen(&app, &admin, "annika", "keine").await;
    let bert = benutzer_anlegen(&app, &admin, "bertram", "keine").await;
    // Beobachterin ohne Funktion.
    let carl = benutzer_anlegen(&app, &admin, "carlotta", "keine").await;
    rolle_setzen(&app, &admin, einsatz, carl, "beobachter").await;
    let w = Welt {
        app,
        pool,
        live,
        admin,
        einsatz,
        anna,
        bert,
    };
    w.funktion_setzen(w.anna, "s4").await;
    w.funktion_setzen(w.bert, "s2").await;
    let ep = w.personal("Anna", w.anna).await;
    let (s, v) = anfrage_json(
        &w.app,
        "PUT",
        &format!("/api/einsaetze/{}/stab/besetzung/s2", w.einsatz),
        &w.admin,
        Some(&json!({ "besetzung_art": "personal", "personal_id": ep })),
    )
    .await;
    assert!(s.is_success(), "besetzen: {s} {v}");
    // Die Aufnahmen oben melden `einsatz_aufnahme`; die Tests beginnen mit leerer Tabelle.
    sqlx::query("DELETE FROM benachrichtigung")
        .execute(&w.pool)
        .await
        .unwrap();
    w
}

impl Welt {
    async fn cookie(&self, name: &str) -> String {
        login_cookie(&self.app, name, &format!("{name}pw1")).await
    }

    fn pfad(&self) -> String {
        format!("/api/einsaetze/{}/benachrichtigung-vorgaben", self.einsatz)
    }

    async fn funktion_setzen(&self, benutzer_id: i64, funktion: &str) {
        let (s, v) = anfrage_json(
            &self.app,
            "PUT",
            &format!("/api/einsaetze/{}/mitglieder/{benutzer_id}", self.einsatz),
            &self.admin,
            Some(&json!({ "einsatz_rolle": "fuehrungspersonal", "fuehrungsfunktion": funktion })),
        )
        .await;
        assert_eq!(s, StatusCode::OK, "{v}");
    }

    /// Stamm-Person mit verknüpftem Konto, disponiert; liefert die `einsatz_personal.id`.
    async fn personal(&self, name: &str, benutzer_id: i64) -> i64 {
        let (s, v) = anfrage_json(
            &self.app,
            "POST",
            "/api/personal",
            &self.admin,
            Some(&json!({ "name": name, "benutzer_id": benutzer_id })),
        )
        .await;
        assert_eq!(s, StatusCode::CREATED, "{v}");
        let (s, v) = anfrage_json(
            &self.app,
            "POST",
            &format!("/api/einsaetze/{}/personal", self.einsatz),
            &self.admin,
            Some(&json!({ "personal_id": v["id"] })),
        )
        .await;
        assert_eq!(s, StatusCode::CREATED, "{v}");
        v["id"].as_i64().unwrap()
    }

    async fn setzen(&self, cookie: &str, art: &str, still: Value) -> (StatusCode, Value) {
        anfrage_json(
            &self.app,
            "PUT",
            &format!("{}/{art}", self.pfad()),
            cookie,
            Some(&json!({ "still": still })),
        )
        .await
    }

    async fn erteilen(&self, empfaenger: Value) -> i64 {
        let (s, v) = anfrage_json(
            &self.app,
            "POST",
            &format!("/api/einsaetze/{}/auftraege", self.einsatz),
            &self.admin,
            Some(&json!({ "auftrag_text": "Sandsäcke zum Deich", "empfaenger": empfaenger })),
        )
        .await;
        assert_eq!(s, StatusCode::CREATED, "{v}");
        v["id"].as_i64().unwrap()
    }

    /// Die Stufe und ob gelesen, je Empfänger der Art `art` zu Bezug `bezug_id`.
    async fn zeilen(&self, art: &str, bezug_id: i64) -> Vec<(i64, String, bool)> {
        sqlx::query_as(
            "SELECT benutzer_id, stufe, quittiert_at IS NOT NULL FROM benachrichtigung \
             WHERE einsatz_id = ? AND art = ? AND bezug_id = ? ORDER BY benutzer_id",
        )
        .bind(self.einsatz)
        .bind(art)
        .bind(bezug_id)
        .fetch_all(&self.pool)
        .await
        .unwrap()
    }
}

fn funktion(code: &str) -> Value {
    json!({ "empfaenger_typ": "funktion", "funktion": code })
}

fn kopf_events(rx: &mut Receiver<LiveNachricht>) -> usize {
    let mut n = 0;
    while let Ok(nachricht) = rx.try_recv() {
        if nachricht.event == LiveEvent::Einsatz {
            n += 1;
        }
    }
    n
}

fn art<'a>(vorgaben: &'a Value, art: &str) -> &'a Value {
    vorgaben["arten"]
        .as_array()
        .unwrap()
        .iter()
        .find(|a| a["art"] == art)
        .unwrap_or_else(|| panic!("{art} fehlt in {vorgaben}"))
}

/// Ohne Festlegung gilt der Katalog: Lagebericht still für jede Funktion, sonst Eingang. Alarme,
/// Org-Arten und Unwetter stehen nicht zur Wahl. Lesen darf auch ein Beobachter.
#[tokio::test]
async fn ohne_festlegung_gilt_der_katalog() {
    let w = welt().await;
    let carl = w.cookie("carlotta").await;
    let (s, v) = anfrage(&w.app, "GET", &w.pfad(), &carl, None).await;
    assert_eq!(s, StatusCode::OK, "{v}");
    let funktionen: Vec<&str> = v["funktionen"]
        .as_array()
        .unwrap()
        .iter()
        .map(|f| f["funktion"].as_str().unwrap())
        .collect();
    assert_eq!(
        funktionen,
        vec![
            "el",
            "s1",
            "s2",
            "s3",
            "s4",
            "s5",
            "s6",
            "fuehrungshilfspersonal",
            "fachberater",
            "ohne"
        ],
        "S7 nur, wenn die Organisation es eingeschaltet hat"
    );
    assert_eq!(v["funktionen"][0]["name"], "EL");
    assert_eq!(v["funktionen"][9]["name"], "ohne Funktion");
    assert_eq!(art(&v, "lagebericht")["still"], json!(funktionen));
    assert_eq!(art(&v, "auftrag_erteilt")["still"], json!([]));
    for nicht in [
        "sofortmeldung",
        "auftrag_ueberfaellig",
        "einsatz_neu",
        "einsatz_aufnahme",
        "unwetter",
    ] {
        assert!(
            !v["arten"]
                .as_array()
                .unwrap()
                .iter()
                .any(|a| a["art"] == nicht),
            "{nicht} ist nicht einstellbar"
        );
    }
}

/// PUT ersetzt die Vorgabe einer Art und antwortet mit ihrem neuen Stand; danach meldet das
/// `einsatz`-Ereignis die Änderung, und das GET zeigt sie.
#[tokio::test]
async fn setzen_ersetzt_die_art_und_meldet_live() {
    let w = welt().await;
    let mut rx = w.live.abonniere(w.einsatz);
    let (s, v) = w
        .setzen(&w.admin, "auftrag_erteilt", json!(["s4", "s2", "s2"]))
        .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert_eq!(
        v,
        json!({ "art": "auftrag_erteilt", "still": ["s2", "s4"] })
    );
    assert_eq!(kopf_events(&mut rx), 1);

    // Führungspersonal hat die Schreibrolle der Einstellungen.
    let bert = w.cookie("bertram").await;
    let (s, v) = w.setzen(&bert, "lagebericht", json!(["ohne"])).await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert_eq!(v["still"], json!(["ohne"]));

    let (s, v) = anfrage(&w.app, "GET", &w.pfad(), &w.admin, None).await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert_eq!(art(&v, "auftrag_erteilt")["still"], json!(["s2", "s4"]));
    assert_eq!(art(&v, "lagebericht")["still"], json!(["ohne"]));
    assert_eq!(art(&v, "befehl")["still"], json!([]));

    let (s, v) = w.setzen(&w.admin, "auftrag_erteilt", json!([])).await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert_eq!(v["still"], json!([]));
}

/// Statuscodes (`src/AGENTS.md`, Statuscode-Konvention): eine unbekannte Art oder Funktion ist
/// das Feld für sich (400), eine gültige, aber nicht einstellbare Art der Zusammenhang (422); ein
/// Beobachter darf nicht (403), ein abgeschlossener Einsatz ist eingefroren (409).
#[tokio::test]
async fn statuscodes_und_rechte() {
    let w = welt().await;
    for (art, still, erwartet) in [
        ("gibtsnicht", json!([]), StatusCode::BAD_REQUEST),
        ("auftrag_erteilt", json!(["s9"]), StatusCode::BAD_REQUEST),
        (
            "auftrag_erteilt",
            json!(["el", "s1", "s2", "s3", "s4", "s5", "s6", "s7", "s7", "s7", "s7", "s7"]),
            StatusCode::BAD_REQUEST,
        ),
        ("sofortmeldung", json!([]), StatusCode::UNPROCESSABLE_ENTITY),
        ("einsatz_neu", json!([]), StatusCode::UNPROCESSABLE_ENTITY),
        ("unwetter", json!([]), StatusCode::UNPROCESSABLE_ENTITY),
    ] {
        let (s, v) = w.setzen(&w.admin, art, still.clone()).await;
        assert_eq!(s, erwartet, "{art} {still}: {v}");
    }
    let zeilen: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM benachrichtigung_vorgabe")
        .fetch_one(&w.pool)
        .await
        .unwrap();
    assert_eq!(zeilen, 0, "abgelehnt schreibt nichts");

    let carl = w.cookie("carlotta").await;
    let (s, v) = w.setzen(&carl, "auftrag_erteilt", json!(["s2"])).await;
    assert_eq!(s, StatusCode::FORBIDDEN, "{v}");

    let (s, v) = anfrage(
        &w.app,
        "POST",
        &format!("/api/einsaetze/{}/abschliessen", w.einsatz),
        &w.admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    let (s, v) = w.setzen(&w.admin, "auftrag_erteilt", json!(["s2"])).await;
    assert_eq!(s, StatusCode::CONFLICT, "{v}");
    let (s, v) = anfrage(&w.app, "GET", &w.pfad(), &w.admin, None).await;
    assert_eq!(s, StatusCode::OK, "lesen bleibt: {v}");
}

/// Spec „Still für S2“: der Auftrag steht bei S2 still (gelesen, zählt nicht) im Verlauf.
/// Spec „Zwei Funktionen“: wer S2 und S4 ist, bekommt ihn als Eingang.
#[tokio::test]
async fn still_fuer_s2_und_lauter_gewinnt() {
    let w = welt().await;
    let (s, v) = w.setzen(&w.admin, "auftrag_erteilt", json!(["s2"])).await;
    assert_eq!(s, StatusCode::OK, "{v}");

    let id = w.erteilen(json!([funktion("s2")])).await;
    // S2 ist Anna über die Besetzung; Bert nur über die Mitgliedschaft und damit kein Empfänger.
    assert_eq!(
        w.zeilen("auftrag_erteilt", id).await,
        vec![(w.anna, "hinweis".to_string(), false)],
        "Anna ist auch S4: lauter gewinnt"
    );

    // Ohne die Besetzung ist Bert S2 (Mitgliedschaft) und bekommt den Auftrag still.
    let (s, v) = anfrage(
        &w.app,
        "DELETE",
        &format!("/api/einsaetze/{}/stab/besetzung/s2", w.einsatz),
        &w.admin,
        None,
    )
    .await;
    assert!(s.is_success(), "Besetzung lösen: {s} {v}");
    let id = w.erteilen(json!([funktion("s2"), funktion("s4")])).await;
    assert_eq!(
        w.zeilen("auftrag_erteilt", id).await,
        vec![
            (w.anna, "hinweis".to_string(), false),
            (w.bert, "still".to_string(), true),
        ]
    );
    let bert = w.cookie("bertram").await;
    let (s, v) = anfrage(
        &w.app,
        "GET",
        &format!("/api/einsaetze/{}/benachrichtigungen", w.einsatz),
        &bert,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert_eq!(v["ungelesen"], 0);
    assert_eq!(v["eintraege"][0]["stufe"], "still");
}
