//! Benachrichtigungen zu Aufträgen (LLH-1212, Change `kcjecn9e-benachrichtigungskonzept`, Spec
//! `benachrichtigungen`, „Auftrag erteilt“, „Auftrag quittiert oder erledigt“, „Eigene Aktionen
//! benachrichtigen den Auslöser nicht“): die Schreibwege der Aufträge melden über
//! `benachrichtigung::melden`, und zwar je Übergang genau einmal.

use axum::http::StatusCode;
use serde_json::{json, Value};

mod common;
use common::{
    anfrage, benutzer_anlegen, einheit_bilden, einsatz_anlegen, funktion_setzen, login_cookie,
    rolle_setzen, setup_mit_optionen_auf, setup_mit_pool,
};

struct Welt {
    app: axum::Router,
    pool: sqlx::SqlitePool,
    admin: String,
    einsatz: i64,
    /// Mitglied (Führungspersonal) „annika“.
    anna: i64,
    /// Mitglied (Führungspersonal) „bertram“.
    bert: i64,
    /// Mitglied (Führungspersonal) „carla“.
    carla: i64,
}

/// Eine gespeicherte Benachrichtigung: (Empfänger, Art, Bezugstyp, Bezugskennung).
type Zeile = (i64, String, String, i64);

async fn welt() -> Welt {
    let (app, pool) = setup_mit_pool().await;
    welt_from(app, pool).await
}

/// Wie [`welt`], auf dem Datei-Pool (WAL, mehrere Verbindungen): erst dort laufen zwei Anfragen
/// wirklich gleichzeitig und warten an der Schreibsperre (LLH-1681).
async fn welt_concurrent() -> (tempfile::TempDir, Welt) {
    let (dir, pool) = lifeline_hub::db::test_pool_datei().await;
    let (app, pool, _live) =
        setup_mit_optionen_auf(pool, lifeline_hub::app::RouterOptionen::default()).await;
    (dir, welt_from(app, pool).await)
}

async fn welt_from(app: axum::Router, pool: sqlx::SqlitePool) -> Welt {
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let anna = benutzer_anlegen(&app, &admin, "annika", "keine").await;
    let bert = benutzer_anlegen(&app, &admin, "bertram", "keine").await;
    let carla = benutzer_anlegen(&app, &admin, "carla", "keine").await;
    for id in [anna, bert, carla] {
        rolle_setzen(&app, &admin, einsatz, id, "fuehrungspersonal").await;
    }
    // Die Aufnahmen oben melden `einsatz_aufnahme` (tasks.md 15.1, `tests/benachrichtigung_org.rs`);
    // die Tests hier beginnen mit leerer Tabelle.
    sqlx::query("DELETE FROM benachrichtigung")
        .execute(&pool)
        .await
        .unwrap();
    Welt {
        app,
        pool,
        admin,
        einsatz,
        anna,
        bert,
        carla,
    }
}

impl Welt {
    async fn cookie(&self, name: &str) -> String {
        login_cookie(&self.app, name, &format!("{name}pw1")).await
    }

    /// Legt eine Stamm-Person (optional mit verknüpftem Konto) an und disponiert sie; liefert
    /// die `einsatz_personal.id`.
    async fn personal(&self, name: &str, benutzer_id: Option<i64>) -> i64 {
        let body = match benutzer_id {
            Some(b) => json!({ "name": name, "benutzer_id": b }),
            None => json!({ "name": name }),
        };
        let (s, v) = anfrage(
            &self.app,
            "POST",
            "/api/personal",
            &self.admin,
            Some(&body.to_string()),
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
        v["id"].as_i64().unwrap()
    }

    /// Gibt dem Mitglied `benutzer_id` die Führungsfunktion `sachgebiet` (Mitgliedschaft,
    /// i6k6mzed D2).
    async fn besetzen(&self, sachgebiet: &str, benutzer_id: i64) {
        funktion_setzen(
            &self.app,
            &self.admin,
            self.einsatz,
            benutzer_id,
            "fuehrungspersonal",
            Some(sachgebiet),
        )
        .await;
    }

    /// Erteilt als `cookie` einen Auftrag an `empfaenger`; liefert die Antwort.
    async fn erteilen(&self, cookie: &str, empfaenger: Value) -> Value {
        let body =
            json!({ "auftrag_text": "Sandsäcke zum Deich bringen", "empfaenger": empfaenger });
        let (s, v) = anfrage(
            &self.app,
            "POST",
            &format!("/api/einsaetze/{}/auftraege", self.einsatz),
            cookie,
            Some(&body.to_string()),
        )
        .await;
        assert_eq!(s, StatusCode::CREATED, "{v}");
        v
    }

    async fn zeilen(&self) -> Vec<Zeile> {
        sqlx::query_as(
            "SELECT benutzer_id, art, bezug_typ, bezug_id FROM benachrichtigung ORDER BY id",
        )
        .fetch_all(&self.pool)
        .await
        .unwrap()
    }

    async fn zeilen_der_art(&self, art: &str) -> Vec<Zeile> {
        self.zeilen()
            .await
            .into_iter()
            .filter(|z| z.1 == art)
            .collect()
    }

    /// Die Benachrichtigungen, wie `cookie` sie über die Route liest.
    async fn lesen(&self, cookie: &str) -> Vec<Value> {
        let (s, v) = anfrage(&self.app, "GET", "/api/benachrichtigungen", cookie, None).await;
        assert_eq!(s, StatusCode::OK, "{v}");
        v.as_array().unwrap().clone()
    }

    async fn quittieren(&self, cookie: &str, auftrag: i64, empfaenger: i64) -> StatusCode {
        let (s, _) = anfrage(
            &self.app,
            "POST",
            &format!(
                "/api/einsaetze/{}/auftraege/{auftrag}/empfaenger/{empfaenger}/quittieren",
                self.einsatz
            ),
            cookie,
            None,
        )
        .await;
        s
    }

    async fn vollzug(&self, cookie: &str, auftrag: i64, body: Value) -> StatusCode {
        let (s, _) = anfrage(
            &self.app,
            "POST",
            &format!(
                "/api/einsaetze/{}/auftraege/{auftrag}/vollzug",
                self.einsatz
            ),
            cookie,
            Some(&body.to_string()),
        )
        .await;
        s
    }
}

fn person(ep: i64) -> Value {
    json!({ "empfaenger_typ": "person", "person_id": ep })
}

fn funktion(code: &str) -> Value {
    json!({ "empfaenger_typ": "funktion", "funktion": code })
}

// ───────────────────────── Auftrag erteilt ─────────────────────────

/// Spec-Szenario „Auftrag an eine Person“: der mit dem Personal verknüpfte Nutzer bekommt
/// „Neuer Auftrag“ mit Sprung zum Auftrag; andere Mitglieder mit Modulrecht nicht.
#[tokio::test]
async fn auftrag_an_eine_person_erreicht_den_verknuepften_nutzer() {
    let w = welt().await;
    let ep = w.personal("Anna Albers", Some(w.anna)).await;
    let a = w.erteilen(&w.admin, json!([person(ep)])).await;
    let auftrag = a["id"].as_i64().unwrap();

    assert_eq!(
        w.zeilen().await,
        vec![(w.anna, "auftrag_erteilt".into(), "auftrag".into(), auftrag)]
    );
    let gelesen = w.lesen(&w.cookie("annika").await).await;
    assert_eq!(gelesen.len(), 1, "{gelesen:?}");
    assert_eq!(gelesen[0]["titel"], "Neuer Auftrag");
    assert_eq!(gelesen[0]["stufe"], "hinweis");
    assert_eq!(gelesen[0]["detail"], format!("Auftrag #{}", a["lfd_nr"]));
    assert_eq!(
        gelesen[0]["pfad"],
        format!("/einsaetze/{}/auftraege?auftrag={auftrag}", w.einsatz)
    );
    assert!(w.lesen(&w.cookie("bertram").await).await.is_empty());
}

/// Spec-Szenario „Auftrag an eine Einheit“: Einheit, Abschnitt, Fahrzeug, extern und eine
/// Funktion als Freitext haben keinen Nutzer, niemand wird benachrichtigt.
#[tokio::test]
async fn auftrag_an_eine_einheit_benachrichtigt_niemanden() {
    let w = welt().await;
    let einheit = einheit_bilden(&w.app, &w.admin, w.einsatz, "Florian 1").await;
    w.erteilen(
        &w.admin,
        json!([{ "empfaenger_typ": "einheit", "einheit_id": einheit }]),
    )
    .await;
    w.erteilen(
        &w.admin,
        json!([
            { "empfaenger_typ": "extern", "extern_kategorie": "leitstelle", "extern_bezeichnung": "ILS Nord" },
            { "empfaenger_typ": "funktion", "funktion_text": "Logistiktrupp" }
        ]),
    )
    .await;
    assert_eq!(w.zeilen().await, vec![]);
}

/// Spec-Szenario „Auftrag an die eigene Funktion“: A besetzt S4 und erteilt an S4 — A bekommt
/// nichts. Ein zweiter Empfänger desselben Auftrags bekommt seinen Hinweis trotzdem.
#[tokio::test]
async fn auftrag_an_die_eigene_funktion_benachrichtigt_den_ausloeser_nicht() {
    let w = welt().await;
    w.besetzen("s4", w.anna).await;
    w.besetzen("s2", w.bert).await;
    let anna = w.cookie("annika").await;

    w.erteilen(&anna, json!([funktion("s4")])).await;
    assert_eq!(w.zeilen().await, vec![], "A erteilt an die eigene S4");

    let a = w
        .erteilen(&anna, json!([funktion("s4"), funktion("s2")]))
        .await;
    assert_eq!(
        w.zeilen().await,
        vec![(
            w.bert,
            "auftrag_erteilt".into(),
            "auftrag".into(),
            a["id"].as_i64().unwrap()
        )],
        "nur S2, nicht die auslösende S4"
    );
}

/// Ein Nutzer, der über zwei Empfänger desselben Auftrags erreicht wird, bekommt einen Hinweis.
#[tokio::test]
async fn zwei_wege_zum_selben_nutzer_ergeben_einen_hinweis() {
    let w = welt().await;
    let ep = w.personal("Bert Brandt", Some(w.bert)).await;
    w.besetzen("s2", w.bert).await;
    w.erteilen(&w.admin, json!([funktion("s2"), person(ep)]))
        .await;
    assert_eq!(w.zeilen_der_art("auftrag_erteilt").await.len(), 1);
}

/// Auch die anderen Wege, einen Auftrag zu erteilen, melden: aus einem ETB-Eintrag, aus einer
/// Meldung und aus einer Chat-Nachricht.
#[tokio::test]
async fn erteilen_aus_etb_meldung_und_chat_meldet_ebenso() {
    let w = welt().await;
    let ep = w.personal("Bert Brandt", Some(w.bert)).await;
    let body = json!({ "auftrag_text": "Deich sichern", "empfaenger": [person(ep)] }).to_string();
    let post = |pfad: String, body: String| {
        let w = &w;
        async move {
            let (s, v) = anfrage(&w.app, "POST", &pfad, &w.admin, Some(&body)).await;
            assert!(s.is_success(), "{pfad}: {s} {v}");
            v
        }
    };
    let e = w.einsatz;

    let etb = post(
        format!("/api/einsaetze/{e}/etb"),
        r#"{"von":"ELW 1","an":"ELW 1","typ":"meldung","inhalt":"Deich km12"}"#.into(),
    )
    .await;
    post(
        format!("/api/einsaetze/{e}/etb/{}/auftrag", etb["id"]),
        body.clone(),
    )
    .await;

    let meldung = post(
        format!("/api/einsaetze/{e}/meldungen"),
        r#"{"absender":"Florian Nord 1","empfaenger":"ELW 1","meldeweg":"funk","inhalt":"Deich km12","ereigniszeit":"2026-06-12 09:00:00"}"#.into(),
    )
    .await;
    post(
        format!("/api/einsaetze/{e}/meldungen/{}/auftrag", meldung["id"]),
        body.clone(),
    )
    .await;

    let (_, kanaele) = anfrage(
        &w.app,
        "GET",
        &format!("/api/einsaetze/{e}/chat/kanaele"),
        &w.admin,
        None,
    )
    .await;
    let nachricht = post(
        format!(
            "/api/einsaetze/{e}/chat/kanaele/{}/nachrichten",
            kanaele[0]["id"]
        ),
        r#"{"inhalt":"Deich sichern"}"#.into(),
    )
    .await;
    post(
        format!(
            "/api/einsaetze/{e}/chat/nachrichten/{}/heraufstufen-auftrag",
            nachricht["id"]
        ),
        body,
    )
    .await;

    let erteilt = w.zeilen_der_art("auftrag_erteilt").await;
    assert_eq!(erteilt.len(), 3, "{erteilt:?}");
    assert!(erteilt.iter().all(|z| z.0 == w.bert && z.2 == "auftrag"));
    let auftraege: std::collections::BTreeSet<i64> = erteilt.iter().map(|z| z.3).collect();
    assert_eq!(auftraege.len(), 3, "je Auftrag einer");
}

/// Eine Berichtigung meldet nur die hinzugekommenen Empfänger; bleibende Empfänger und eine
/// Berichtigung ohne neuen Empfänger bleiben still.
#[tokio::test]
async fn berichtigung_meldet_nur_hinzugekommene_empfaenger() {
    let w = welt().await;
    let ep_anna = w.personal("Anna Albers", Some(w.anna)).await;
    w.besetzen("s2", w.bert).await;
    let a = w.erteilen(&w.admin, json!([person(ep_anna)])).await;
    let auftrag = a["id"].as_i64().unwrap();
    let patch = |body: Value| {
        let w = &w;
        async move {
            let (s, v) = anfrage(
                &w.app,
                "PATCH",
                &format!("/api/einsaetze/{}/auftraege/{auftrag}", w.einsatz),
                &w.admin,
                Some(&body.to_string()),
            )
            .await;
            assert_eq!(s, StatusCode::OK, "{v}");
        }
    };

    patch(json!({ "auftrag_text": "Sandsäcke zum Deich km 12 bringen" })).await;
    patch(json!({ "empfaenger": [person(ep_anna)] })).await;
    assert_eq!(w.zeilen().await.len(), 1, "nur der Hinweis beim Erteilen");

    patch(json!({ "empfaenger": [person(ep_anna), funktion("s2")] })).await;
    assert_eq!(
        w.zeilen().await,
        vec![
            (w.anna, "auftrag_erteilt".into(), "auftrag".into(), auftrag),
            (w.bert, "auftrag_erteilt".into(), "auftrag".into(), auftrag),
        ]
    );

    // Dieselbe Berichtigung noch einmal ändert nichts und meldet nichts.
    patch(json!({ "empfaenger": [person(ep_anna), funktion("s2")] })).await;
    assert_eq!(w.zeilen().await.len(), 2);
}

// ───────────────────────── Quittiert und erledigt ─────────────────────────

/// Spec-Szenario „Quittung“: S2 quittiert einen Auftrag von A — A bekommt „Auftrag quittiert“
/// mit S2 im Detail. Der Quittierende und ein unbeteiligtes Mitglied bekommen nichts, eine
/// wiederholte Quittung meldet nicht noch einmal.
#[tokio::test]
async fn quittung_meldet_dem_auftraggeber_mit_dem_empfaenger() {
    let w = welt().await;
    w.besetzen("s2", w.bert).await;
    let anna = w.cookie("annika").await;
    let bert = w.cookie("bertram").await;
    let a = w.erteilen(&anna, json!([funktion("s2")])).await;
    let auftrag = a["id"].as_i64().unwrap();
    let zeile = a["empfaenger"][0]["id"].as_i64().unwrap();

    assert_eq!(w.quittieren(&bert, auftrag, zeile).await, StatusCode::OK);
    assert_eq!(w.quittieren(&bert, auftrag, zeile).await, StatusCode::OK);

    let quittiert = w.zeilen_der_art("auftrag_quittiert").await;
    assert_eq!(
        quittiert,
        vec![(
            w.anna,
            "auftrag_quittiert".into(),
            "auftrag_empfaenger".into(),
            zeile
        )]
    );
    let gelesen: Vec<Value> = w
        .lesen(&anna)
        .await
        .into_iter()
        .filter(|b| b["art"] == "auftrag_quittiert")
        .collect();
    assert_eq!(gelesen.len(), 1);
    assert_eq!(gelesen[0]["titel"], "Auftrag quittiert");
    assert_eq!(
        gelesen[0]["detail"],
        format!("Auftrag #{} an S2", a["lfd_nr"])
    );
    assert_eq!(
        gelesen[0]["pfad"],
        format!("/einsaetze/{}/auftraege?auftrag={auftrag}", w.einsatz)
    );
    assert!(w.lesen(&w.cookie("carla").await).await.is_empty());
}

/// Die Detailzeile nennt nie einen Personennamen (Scrub-Wert): bei einer Person bleibt es bei der
/// Auftragsnummer; Einheiten erscheinen mit ihrem Namen.
#[tokio::test]
async fn quittung_einer_person_nennt_keinen_namen() {
    let w = welt().await;
    let ep_bert = w.personal("Bert Brandt", Some(w.bert)).await;
    let einheit = einheit_bilden(&w.app, &w.admin, w.einsatz, "Florian 1").await;
    let anna = w.cookie("annika").await;
    let a = w
        .erteilen(
            &anna,
            json!([person(ep_bert), { "empfaenger_typ": "einheit", "einheit_id": einheit }]),
        )
        .await;
    let auftrag = a["id"].as_i64().unwrap();
    let bert = w.cookie("bertram").await;
    for e in a["empfaenger"].as_array().unwrap() {
        assert_eq!(
            w.quittieren(&bert, auftrag, e["id"].as_i64().unwrap())
                .await,
            StatusCode::OK
        );
    }
    let mut details: Vec<String> = w
        .lesen(&anna)
        .await
        .into_iter()
        .filter(|b| b["art"] == "auftrag_quittiert")
        .map(|b| b["detail"].as_str().unwrap().to_string())
        .collect();
    details.sort();
    let nr = a["lfd_nr"].as_i64().unwrap();
    assert_eq!(
        details,
        vec![
            format!("Auftrag #{nr}"),
            format!("Auftrag #{nr} an Florian 1")
        ]
    );
}

/// Quittiert der Auftraggeber selbst, bleibt er still (eigene Aktion).
#[tokio::test]
async fn eigene_quittung_des_auftraggebers_bleibt_still() {
    let w = welt().await;
    w.besetzen("s2", w.anna).await;
    let anna = w.cookie("annika").await;
    let a = w.erteilen(&anna, json!([funktion("s2")])).await;
    let zeile = a["empfaenger"][0]["id"].as_i64().unwrap();
    assert_eq!(
        w.quittieren(&anna, a["id"].as_i64().unwrap(), zeile).await,
        StatusCode::OK
    );
    assert_eq!(w.zeilen().await, vec![]);
}

/// Meldet ein Empfänger den Auftrag erledigt (Vollzug), bekommt der Auftraggeber
/// „Auftrag erledigt“; „In Bearbeitung“ und die Rücknahme bleiben still, ein zweiter Vollzug
/// wird abgelehnt und meldet nichts.
#[tokio::test]
async fn erledigt_meldet_dem_auftraggeber() {
    let w = welt().await;
    let ep_bert = w.personal("Bert Brandt", Some(w.bert)).await;
    let anna = w.cookie("annika").await;
    let bert = w.cookie("bertram").await;
    let a = w.erteilen(&anna, json!([person(ep_bert)])).await;
    let auftrag = a["id"].as_i64().unwrap();

    for status in ["in_arbeit", "offen", "in_arbeit"] {
        assert_eq!(
            w.vollzug(&bert, auftrag, json!({ "status": status })).await,
            StatusCode::OK,
            "{status}"
        );
    }
    assert!(w.zeilen_der_art("auftrag_erledigt").await.is_empty());

    let erledigt = json!({ "status": "vollzogen", "vollzugsmeldung": "Sandsäcke liegen" });
    assert_eq!(
        w.vollzug(&bert, auftrag, erledigt.clone()).await,
        StatusCode::OK
    );
    assert_eq!(
        w.vollzug(&bert, auftrag, erledigt).await,
        StatusCode::UNPROCESSABLE_ENTITY
    );
    assert_eq!(
        w.zeilen_der_art("auftrag_erledigt").await,
        vec![(w.anna, "auftrag_erledigt".into(), "auftrag".into(), auftrag)]
    );
    let gelesen: Vec<Value> = w
        .lesen(&anna)
        .await
        .into_iter()
        .filter(|b| b["art"] == "auftrag_erledigt")
        .collect();
    assert_eq!(gelesen[0]["titel"], "Auftrag erledigt");
    assert!(
        !gelesen[0].to_string().contains("Sandsäcke"),
        "keine Vollzugsmeldung im Text: {}",
        gelesen[0]
    );
    // Der Melder hat nur seinen Hinweis vom Erteilen, ein unbeteiligtes Mitglied nichts.
    let alle = w.zeilen().await;
    assert!(alle
        .iter()
        .all(|z| z.0 != w.carla && (z.0 != w.bert || z.1 == "auftrag_erteilt")));
}

/// Zählt die ETB-Meldungen am Auftrag (die Vollzugsmeldung ist eine, append-only).
async fn etb_meldungen(pool: &sqlx::SqlitePool, auftrag: i64) -> i64 {
    sqlx::query_scalar("SELECT COUNT(*) FROM etb_eintrag WHERE auftrag_id = ? AND typ = 'meldung'")
        .bind(auftrag)
        .fetch_one(pool)
        .await
        .unwrap()
}

/// Wartet, bis beide Anfragen an der gehaltenen Schreibsperre hängen, gibt sie frei und liefert
/// beide Statuscodes. Die Sperre hält eine fremde Verbindung, ohne etwas zu schreiben: beide
/// Anfragen lesen den Auftrag vorher unverändert.
async fn concurrently(
    pool: &sqlx::SqlitePool,
    a: impl std::future::Future<Output = StatusCode>,
    b: impl std::future::Future<Output = StatusCode>,
) -> (StatusCode, StatusCode) {
    let lock = pool.begin_with("BEGIN IMMEDIATE").await.unwrap();
    let both = async { tokio::join!(a, b) };
    tokio::pin!(both);
    assert!(
        tokio::time::timeout(std::time::Duration::from_millis(500), &mut both)
            .await
            .is_err(),
        "beide Anfragen warten an der Schreibsperre"
    );
    lock.rollback().await.unwrap();
    both.await
}

/// LLH-1681, Fall 1: Zugführer und S3 melden nach demselben Funkspruch beide „vollzogen“. Beide
/// lesen den Auftrag als offen; nur der erste Vollzug kommt durch, der zweite bekommt 422. Genau
/// eine ETB-Meldung und eine Benachrichtigung „erledigt“, Text und Person des ersten bleiben.
#[tokio::test]
async fn gleichzeitiger_doppelvollzug_meldet_einmal() {
    let (_dir, w) = welt_concurrent().await;
    let ep_bert = w.personal("Bert Brandt", Some(w.bert)).await;
    let ep_carla = w.personal("Carla Cramer", Some(w.carla)).await;
    let anna = w.cookie("annika").await;
    let bert = w.cookie("bertram").await;
    let carla = w.cookie("carla").await;
    let a = w
        .erteilen(&anna, json!([person(ep_bert), person(ep_carla)]))
        .await;
    let auftrag = a["id"].as_i64().unwrap();

    let (s_bert, s_carla) = concurrently(
        &w.pool,
        w.vollzug(
            &bert,
            auftrag,
            json!({ "status": "vollzogen", "vollzugsmeldung": "Sandsäcke liegen" }),
        ),
        w.vollzug(
            &carla,
            auftrag,
            json!({ "status": "vollzogen", "vollzugsmeldung": "Deich gesichert" }),
        ),
    )
    .await;

    let mut codes = [s_bert, s_carla];
    codes.sort();
    assert_eq!(
        codes,
        [StatusCode::OK, StatusCode::UNPROCESSABLE_ENTITY],
        "bert {s_bert}, carla {s_carla}"
    );
    assert_eq!(etb_meldungen(&w.pool, auftrag).await, 1);
    assert_eq!(
        w.zeilen_der_art("auftrag_erledigt").await,
        vec![(w.anna, "auftrag_erledigt".into(), "auftrag".into(), auftrag)]
    );
    let (text, von): (String, i64) = sqlx::query_as(
        "SELECT a.vollzugsmeldung, k.vollzogen_von_id FROM auftrag a \
         JOIN kommunikation_status k ON k.objekt_typ = 'auftrag' AND k.objekt_id = a.id \
         WHERE a.id = ?",
    )
    .bind(auftrag)
    .fetch_one(&w.pool)
    .await
    .unwrap();
    let (expected_text, expected_von) = if s_bert == StatusCode::OK {
        ("Sandsäcke liegen", w.bert)
    } else {
        ("Deich gesichert", w.carla)
    };
    assert_eq!((text.as_str(), von), (expected_text, expected_von));
}

/// LLH-1681, Fall 2: „Rückgängig“ liest den Auftrag noch in Bearbeitung, während eine andere
/// Verbindung den Vollzug schon geschrieben, aber noch nicht festgeschrieben hat. Die Rücknahme
/// wartet an der Sperre und trifft danach auf den Vollzug: 422, der Vollzug bleibt bestehen.
#[tokio::test]
async fn ruecknahme_ueberholt_keinen_gleichzeitigen_vollzug() {
    let (_dir, w) = welt_concurrent().await;
    let ep_bert = w.personal("Bert Brandt", Some(w.bert)).await;
    let anna = w.cookie("annika").await;
    let bert = w.cookie("bertram").await;
    let a = w.erteilen(&anna, json!([person(ep_bert)])).await;
    let auftrag = a["id"].as_i64().unwrap();
    assert_eq!(
        w.vollzug(&bert, auftrag, json!({ "status": "in_arbeit" }))
            .await,
        StatusCode::OK
    );

    let org_id: i64 = sqlx::query_scalar("SELECT org_id FROM einsatz WHERE id = ?")
        .bind(w.einsatz)
        .fetch_one(&w.pool)
        .await
        .unwrap();
    let startwert = lifeline_hub::einsatz::einstellungen::etb_startwert(&w.pool, w.einsatz)
        .await
        .unwrap();
    let mut vollzug = w.pool.begin_with("BEGIN IMMEDIATE").await.unwrap();
    lifeline_hub::auftrag::repo::melde_vollzug_tx(
        &mut vollzug,
        org_id,
        w.einsatz,
        auftrag,
        w.bert,
        startwert,
        "Sandsäcke liegen",
        "2026-11-13 10:00:00",
    )
    .await
    .unwrap();

    let ruecknahme = w.vollzug(&bert, auftrag, json!({ "status": "offen" }));
    tokio::pin!(ruecknahme);
    assert!(
        tokio::time::timeout(std::time::Duration::from_millis(500), &mut ruecknahme)
            .await
            .is_err(),
        "die Rücknahme wartet an der Schreibsperre"
    );
    vollzug.commit().await.unwrap();
    assert_eq!(ruecknahme.await, StatusCode::UNPROCESSABLE_ENTITY);

    let (status, at): (String, Option<String>) = sqlx::query_as(
        "SELECT vollzug_status, vollzogen_at FROM kommunikation_status \
         WHERE objekt_typ = 'auftrag' AND objekt_id = ?",
    )
    .bind(auftrag)
    .fetch_one(&w.pool)
    .await
    .unwrap();
    assert_eq!(status, "vollzogen");
    assert_eq!(at.as_deref(), Some("2026-11-13 10:00:00"));
    let in_arbeit_at: Option<String> =
        sqlx::query_scalar("SELECT in_arbeit_at FROM auftrag WHERE id = ?")
            .bind(auftrag)
            .fetch_one(&w.pool)
            .await
            .unwrap();
    assert!(
        in_arbeit_at.is_some(),
        "die Rücknahme hat nichts geschrieben"
    );
    assert_eq!(etb_meldungen(&w.pool, auftrag).await, 1);
}
