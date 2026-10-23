//! Meldung an meine Funktion (LLH-1214, Change `kcjecn9e-benachrichtigungskonzept`, design.md D8,
//! Spec `benachrichtigungen`, „Meldung an mich“): eine Meldung trägt neben dem freien
//! Empfängertext eine Empfängerfunktion aus dem Katalog; das Erfassen meldet `meldung` an die
//! Nutzer dieser Funktion, eine Sofortmeldung nur ihren Alarm.

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
    /// Mitglied (Führungspersonal) „annika“, besetzt S2.
    anna: i64,
    /// Mitglied (Führungspersonal) „bertram“, besetzt S3.
    bert: i64,
    /// Mitglied (Führungspersonal) „carla“, ohne Funktion.
    carla: i64,
}

/// Eine gespeicherte Benachrichtigung: (Empfänger, Art, Bezugstyp, Bezugskennung).
type Zeile = (i64, String, String, i64);

/// Einsatz mit S2 = Anna und S3 = Bert in der Stab-Besetzung, Carla ohne Funktion.
async fn welt() -> Welt {
    let (app, pool) = setup_mit_pool().await;
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
    let w = Welt {
        app,
        pool,
        admin,
        einsatz,
        anna,
        bert,
        carla,
    };
    let ep_anna = w.personal("Anna Albers", w.anna).await;
    w.besetzen("s2", ep_anna).await;
    let ep_bert = w.personal("Bert Brandt", w.bert).await;
    w.besetzen("s3", ep_bert).await;
    w
}

impl Welt {
    async fn cookie(&self, name: &str) -> String {
        login_cookie(&self.app, name, &format!("{name}pw1")).await
    }

    /// Legt eine Stamm-Person mit verknüpftem Konto an und disponiert sie; liefert die
    /// `einsatz_personal.id`.
    async fn personal(&self, name: &str, benutzer_id: i64) -> i64 {
        let (s, v) = anfrage(
            &self.app,
            "POST",
            "/api/personal",
            &self.admin,
            Some(&json!({ "name": name, "benutzer_id": benutzer_id }).to_string()),
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

    /// Besetzt ein Sachgebiet mit dem Einsatzpersonal `ep`.
    async fn besetzen(&self, sachgebiet: &str, ep: i64) {
        let (s, v) = anfrage(
            &self.app,
            "PUT",
            &format!(
                "/api/einsaetze/{}/stab/besetzung/{sachgebiet}",
                self.einsatz
            ),
            &self.admin,
            Some(&json!({ "besetzung_art": "personal", "personal_id": ep }).to_string()),
        )
        .await;
        assert!(s.is_success(), "besetzen {sachgebiet}: {s} {v}");
    }

    /// Erfasst als `cookie` eine Meldung; `zusatz` ergänzt oder überschreibt Felder des Bodys.
    async fn erfassen_roh(&self, cookie: &str, zusatz: Value) -> (StatusCode, Value) {
        let mut body = json!({
            "absender": "Florian Nord 1",
            "meldeweg": "funk",
            "inhalt": "Deich bei km 3 instabil",
            "ereigniszeit": "2026-06-12 09:00:00",
        });
        for (k, v) in zusatz.as_object().unwrap() {
            body[k] = v.clone();
        }
        anfrage(
            &self.app,
            "POST",
            &format!("/api/einsaetze/{}/meldungen", self.einsatz),
            cookie,
            Some(&body.to_string()),
        )
        .await
    }

    async fn erfassen(&self, cookie: &str, zusatz: Value) -> Value {
        let (s, v) = self.erfassen_roh(cookie, zusatz).await;
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
}

// ───────────────────────── Empfängerfunktion am DTO ─────────────────────────

/// Die Empfängerfunktion wird angenommen, gespeichert und neben dem Freitext zurückgegeben,
/// auch beim Einzelabruf; ohne Angabe fehlt das Feld.
#[tokio::test]
async fn empfaengerfunktion_wird_angenommen_und_gelesen() {
    let w = welt().await;
    let m = w
        .erfassen(
            &w.admin,
            json!({ "empfaenger": "S2 Lage", "empfaenger_funktion": "s2" }),
        )
        .await;
    assert_eq!(m["empfaenger_funktion"], "s2");
    assert_eq!(
        m["empfaenger"], "S2 Lage",
        "der Freitext bleibt eigenständig"
    );

    let (s, detail) = anfrage(
        &w.app,
        "GET",
        &format!("/api/einsaetze/{}/meldungen/{}", w.einsatz, m["id"]),
        &w.admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{detail}");
    assert_eq!(detail["empfaenger_funktion"], "s2");

    let ohne = w.erfassen(&w.admin, json!({ "empfaenger": "ELW 1" })).await;
    assert!(
        !ohne
            .as_object()
            .unwrap()
            .contains_key("empfaenger_funktion"),
        "{ohne}"
    );
    let leer = w
        .erfassen(&w.admin, json!({ "empfaenger_funktion": "  " }))
        .await;
    assert!(
        !leer
            .as_object()
            .unwrap()
            .contains_key("empfaenger_funktion"),
        "leer = keine Funktion: {leer}"
    );
}

/// Statuscode-Konvention (`src/AGENTS.md`): ein Code außerhalb des Katalogs ist ein unbekannter
/// Enum-Wert (400); ein Katalogcode, der als Empfänger einer Meldung nicht taugt, ist ein Fehler
/// des Zusammenhangs (422): Führungshilfspersonal und Fachberater brauchen eine Bezeichnung, die
/// die Meldung nicht trägt, und S7 ist ohne Org-Schalter aus. Nichts wird gespeichert.
#[tokio::test]
async fn ungueltige_empfaengerfunktion_wird_abgelehnt() {
    let w = welt().await;
    let (s, v) = w
        .erfassen_roh(&w.admin, json!({ "empfaenger_funktion": "s9" }))
        .await;
    assert_eq!(s, StatusCode::BAD_REQUEST, "{v}");
    for code in ["fachberater", "fuehrungshilfspersonal", "s7"] {
        let (s, v) = w
            .erfassen_roh(&w.admin, json!({ "empfaenger_funktion": code }))
            .await;
        assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY, "{code}: {v}");
    }
    let anzahl: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM meldung WHERE einsatz_id = ?")
        .bind(w.einsatz)
        .fetch_one(&w.pool)
        .await
        .unwrap();
    assert_eq!(anzahl, 0);
}

// ───────────────────────── Meldung an mich ─────────────────────────

/// Spec-Szenario „Meldung an S2“: die Nutzer von S2 bekommen „Neue Meldung“ mit Sprung zur
/// Meldung; S3 und Mitglieder ohne Funktion nicht, der Erfasser nicht.
#[tokio::test]
async fn meldung_an_s2_erreicht_die_nutzer_von_s2() {
    let w = welt().await;
    let m = w
        .erfassen(
            &w.admin,
            json!({ "empfaenger": "S2", "empfaenger_funktion": "s2" }),
        )
        .await;
    let id = m["id"].as_i64().unwrap();

    assert_eq!(
        w.zeilen().await,
        vec![(w.anna, "meldung".into(), "meldung".into(), id)]
    );
    let gelesen = w.lesen(&w.cookie("annika").await).await;
    assert_eq!(gelesen.len(), 1, "{gelesen:?}");
    assert_eq!(gelesen[0]["titel"], "Neue Meldung");
    assert_eq!(gelesen[0]["stufe"], "hinweis");
    assert_eq!(gelesen[0]["detail"], format!("Meldung #{}", m["lfd_nr"]));
    assert_eq!(
        gelesen[0]["pfad"],
        format!("/einsaetze/{}/meldungen?meldung={id}", w.einsatz)
    );
    for name in ["bertram", "carla"] {
        assert!(w.lesen(&w.cookie(name).await).await.is_empty(), "{name}");
    }
    assert!(w.lesen(&w.admin).await.is_empty(), "Erfasser");
}

/// Ersatz über die Mitgliedschaft (Spec „Meine Funktion“): ist S4 nicht besetzt, erreicht die
/// Meldung an S4 das Mitglied, das S4 in seiner Mitgliedschaft trägt.
#[tokio::test]
async fn meldung_an_unbesetzte_funktion_erreicht_die_mitgliedschaft() {
    let w = welt().await;
    sqlx::query(
        "UPDATE einsatz_mitgliedschaft SET fuehrungsfunktion = 's4' \
         WHERE einsatz_id = ? AND benutzer_id = ?",
    )
    .bind(w.einsatz)
    .bind(w.carla)
    .execute(&w.pool)
    .await
    .unwrap();
    let m = w
        .erfassen(&w.admin, json!({ "empfaenger_funktion": "s4" }))
        .await;
    assert_eq!(
        w.zeilen().await,
        vec![(
            w.carla,
            "meldung".into(),
            "meldung".into(),
            m["id"].as_i64().unwrap()
        )]
    );
}

/// Spec-Szenario „Sofortmeldung an S2“: eine Sofortmeldung (Art oder Priorität) an S2 bringt den
/// Nutzern von S2 genau eine Benachrichtigung, den Alarm; einen Hinweis „Neue Meldung“ gibt es
/// nicht zusätzlich.
#[tokio::test]
async fn sofortmeldung_an_s2_bringt_keinen_zweiten_hinweis() {
    let w = welt().await;
    for sofort in [
        json!({ "meldungsart": "sofortmeldung", "empfaenger_funktion": "s2" }),
        json!({ "prioritaet": "sofort", "empfaenger_funktion": "s2" }),
    ] {
        let m = w.erfassen(&w.admin, sofort.clone()).await;
        assert_eq!(m["empfaenger_funktion"], "s2", "{sofort}");
    }
    assert!(w.zeilen_der_art("meldung").await.is_empty());
    // Den Alarm selbst trägt die Anforderung „Sofortmeldung alarmiert“; je Sofortmeldung höchstens
    // eine Benachrichtigung an S2, und nur als Alarm.
    let an_anna: Vec<Zeile> = w
        .zeilen()
        .await
        .into_iter()
        .filter(|z| z.0 == w.anna)
        .collect();
    assert!(an_anna.len() <= 2, "{an_anna:?}");
    assert!(
        an_anna.iter().all(|z| z.1 == "sofortmeldung"),
        "{an_anna:?}"
    );
}

/// Eigene Aktionen bleiben still: wer selbst S2 besetzt und eine Meldung an S2 erfasst, bekommt
/// nichts dafür.
#[tokio::test]
async fn erfasser_in_der_funktion_bekommt_nichts() {
    let w = welt().await;
    let anna = w.cookie("annika").await;
    w.erfassen(&anna, json!({ "empfaenger_funktion": "s2" }))
        .await;
    assert!(w.zeilen().await.is_empty());
    assert!(w.lesen(&anna).await.is_empty());
}

/// Ohne Empfängerfunktion ist eine normale Meldung ein Eingang für alle Schreiber (LLH-1143 D5),
/// auch wenn der Freitext „S2“ lautet: es gibt keinen Rückschluss vom Freitext auf eine Funktion
/// (`frontend/src/fuehrung/AGENTS.md`), S2 bekommt sie wie jeder andere Schreiber.
#[tokio::test]
async fn meldung_ohne_empfaengerfunktion_geht_an_alle_schreiber() {
    let w = welt().await;
    for zusatz in [json!({ "empfaenger": "S2" }), json!({})] {
        let m = w.erfassen(&w.admin, zusatz.clone()).await;
        assert_eq!(
            w.empfaenger("meldung", m["id"].as_i64().unwrap()).await,
            vec![w.anna, w.bert, w.carla],
            "{zusatz}"
        );
    }
}

/// Eine Wiederholung mit derselben `client_id` (Offline-Queue, Timeout-Replay) liefert dieselbe
/// Meldung und meldet nicht noch einmal.
#[tokio::test]
async fn wiederholung_mit_client_id_meldet_nicht_doppelt() {
    let w = welt().await;
    let zusatz = json!({ "empfaenger_funktion": "s2", "client_id": "meldung-s2-1" });
    let erste = w.erfassen(&w.admin, zusatz.clone()).await;
    let zweite = w.erfassen(&w.admin, zusatz).await;
    assert_eq!(erste["id"], zweite["id"]);
    assert_eq!(
        w.zeilen().await,
        vec![(
            w.anna,
            "meldung".into(),
            "meldung".into(),
            erste["id"].as_i64().unwrap()
        )]
    );
}

// ───────────────────────── Eingang (LLH-1062) ─────────────────────────
//
// Spec `benachrichtigungen`, „Eingang einer Meldung“: eine dringende Meldung, jede Lagemeldung und
// jede Meldung von einem gekoppelten Gerät gehen als Hinweis „Neue Meldung“ an alle mit
// Schreibrecht im Modul Meldungen, mit Empfängerfunktion an deren Nutzer und die
// Einsatzleitung. Seit LLH-1143 (D5) gilt das auch für eine normale Meldung von Hand.

impl Welt {
    /// Nimmt „doris“ als Beobachterin in den Einsatz auf.
    async fn beobachterin(&self) -> i64 {
        let doris = benutzer_anlegen(&self.app, &self.admin, "doris", "keine").await;
        rolle_setzen(&self.app, &self.admin, self.einsatz, doris, "beobachter").await;
        sqlx::query("DELETE FROM benachrichtigung")
            .execute(&self.pool)
            .await
            .unwrap();
        doris
    }

    /// Gibt `benutzer_id` in seiner Mitgliedschaft die Funktion `funktion`.
    async fn mitgliedschaft_funktion(&self, benutzer_id: i64, funktion: &str) {
        sqlx::query(
            "UPDATE einsatz_mitgliedschaft SET fuehrungsfunktion = ? \
             WHERE einsatz_id = ? AND benutzer_id = ?",
        )
        .bind(funktion)
        .bind(self.einsatz)
        .bind(benutzer_id)
        .execute(&self.pool)
        .await
        .unwrap();
    }

    /// Die Empfänger der Art `meldung` zu Bezug `typ`/`id`, aufsteigend.
    async fn empfaenger(&self, typ: &str, id: i64) -> Vec<i64> {
        let mut an: Vec<i64> = self
            .zeilen_der_art("meldung")
            .await
            .into_iter()
            .filter(|z| z.2 == typ && z.3 == id)
            .map(|z| z.0)
            .collect();
        an.sort_unstable();
        an
    }

    /// Wie viele Benachrichtigungen der Art `art` zum Bezug noch offen sind.
    async fn offen(&self, art: &str, typ: &str, id: i64) -> i64 {
        sqlx::query_scalar(
            "SELECT COUNT(*) FROM benachrichtigung \
             WHERE art = ? AND bezug_typ = ? AND bezug_id = ? AND quittiert_at IS NULL",
        )
        .bind(art)
        .bind(typ)
        .bind(id)
        .fetch_one(&self.pool)
        .await
        .unwrap()
    }

    async fn admin_id(&self) -> i64 {
        sqlx::query_scalar("SELECT id FROM benutzer WHERE benutzername = 'admin'")
            .fetch_one(&self.pool)
            .await
            .unwrap()
    }

    /// Koppelt einen UHS-Laptop an eine neue, aktive UHS; liefert das Geräte-Cookie und das
    /// Gerätekonto.
    async fn geraet(&self) -> (String, i64) {
        let e = self.einsatz;
        let (s, v) = anfrage(
            &self.app,
            "POST",
            &format!("/api/einsaetze/{e}/uhs"),
            &self.admin,
            Some(&json!({"typ": "behandlungsplatz", "bezeichnung": "UHS Nord"}).to_string()),
        )
        .await;
        assert_eq!(s, StatusCode::CREATED, "{v}");
        let uhs = v["id"].as_i64().unwrap();
        let (s, v) = anfrage(
            &self.app,
            "POST",
            &format!("/api/einsaetze/{e}/uhs/{uhs}/status"),
            &self.admin,
            Some(&json!({"status": "aktiv"}).to_string()),
        )
        .await;
        assert_eq!(s, StatusCode::OK, "{v}");
        let (s, v) = anfrage(
            &self.app,
            "POST",
            &format!("/api/einsaetze/{e}/geraete"),
            &self.admin,
            Some(
                &json!({"ansicht": "uhs-laptop", "uhs_id": uhs, "bezeichnung": "Laptop 1"})
                    .to_string(),
            ),
        )
        .await;
        assert_eq!(s, StatusCode::CREATED, "{v}");
        let kopplung = v["kopplung"]["id"].as_i64().unwrap();
        let code = v["code"]["code"].as_str().unwrap().to_string();
        let resp = tower::ServiceExt::oneshot(
            self.app.clone(),
            axum::http::Request::builder()
                .method("POST")
                .uri("/api/geraete/koppeln")
                .header(axum::http::header::CONTENT_TYPE, "application/json")
                .body(axum::body::Body::from(json!({ "code": code }).to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
        assert_eq!(resp.status(), StatusCode::OK);
        let cookie = resp.headers()[axum::http::header::SET_COOKIE]
            .to_str()
            .unwrap()
            .split(';')
            .next()
            .unwrap()
            .to_string();
        let konto: i64 = sqlx::query_scalar("SELECT benutzer_id FROM geraet_kopplung WHERE id = ?")
            .bind(kopplung)
            .fetch_one(&self.pool)
            .await
            .unwrap();
        (cookie, konto)
    }
}

/// Spec-Szenarien „Dringende Meldung“ und „Lagemeldung“: ohne Empfängerfunktion erreichen sie
/// alle mit Schreibrecht im Modul Meldungen, nie den Erfasser und nie eine Beobachterin.
#[tokio::test]
async fn dringende_meldung_und_lagemeldung_erreichen_alle_schreiber_ausser_erfasser() {
    let w = welt().await;
    let doris = w.beobachterin().await;
    let admin = w.admin_id().await;
    let anna = w.cookie("annika").await;
    for zusatz in [
        json!({ "prioritaet": "dringend" }),
        json!({ "meldungsart": "lagemeldung" }),
    ] {
        let m = w.erfassen(&anna, zusatz.clone()).await;
        let an = w.empfaenger("meldung", m["id"].as_i64().unwrap()).await;
        let mut erwartet = vec![admin, w.bert, w.carla];
        erwartet.sort_unstable();
        assert_eq!(an, erwartet, "{zusatz}");
        assert!(!an.contains(&doris), "Beobachterin: {zusatz}");
        assert!(!an.contains(&w.anna), "Erfasserin: {zusatz}");
    }
    let gelesen = w.lesen(&w.cookie("bertram").await).await;
    assert_eq!(gelesen[0]["titel"], "Neue Meldung");
    assert_eq!(gelesen[0]["stufe"], "hinweis");
}

/// Spec-Szenario „Normale Meldung von Hand“ (LLH-1143 D5): ein Eingang für alle Schreiber außer
/// dem Erfasser, nie für eine Beobachterin.
#[tokio::test]
async fn normale_meldung_von_hand_ist_ein_eingang_fuer_die_schreiber() {
    let w = welt().await;
    let doris = w.beobachterin().await;
    let admin = w.admin_id().await;
    let m = w
        .erfassen(&w.cookie("annika").await, json!({ "prioritaet": "normal" }))
        .await;
    let an = w.empfaenger("meldung", m["id"].as_i64().unwrap()).await;
    let mut erwartet = vec![admin, w.bert, w.carla];
    erwartet.sort_unstable();
    assert_eq!(an, erwartet);
    assert!(!an.contains(&doris));
    let gelesen = w.lesen(&w.cookie("bertram").await).await;
    assert_eq!(gelesen[0]["stufe"], "hinweis");
}

/// Spec-Szenario „Eingang mit Empfängerfunktion“: die Nutzer der Funktion und die Einsatzleitung
/// bekommen den Hinweis, die übrigen Schreiber nicht.
#[tokio::test]
async fn eingang_mit_funktion_erreicht_funktion_und_einsatzleitung() {
    let w = welt().await;
    w.mitgliedschaft_funktion(w.carla, "el").await;
    let m = w
        .erfassen(
            &w.admin,
            json!({ "meldungsart": "lagemeldung", "empfaenger_funktion": "s2" }),
        )
        .await;
    assert_eq!(
        w.empfaenger("meldung", m["id"].as_i64().unwrap()).await,
        vec![w.anna, w.carla]
    );
}

/// Spec-Szenario „Meldung von einem gekoppelten Gerät“: auch eine normale Meldung vom Gerät ist
/// Eingang; das Gerät selbst bekommt nichts.
#[tokio::test]
async fn meldung_vom_geraet_erreicht_alle_schreiber() {
    let w = welt().await;
    let (geraet, konto) = w.geraet().await;
    sqlx::query("DELETE FROM benachrichtigung")
        .execute(&w.pool)
        .await
        .unwrap();
    let m = w
        .erfassen(
            &geraet,
            json!({ "absender": "UHS Nord", "meldeweg": "persoenlich" }),
        )
        .await;
    let an = w.empfaenger("meldung", m["id"].as_i64().unwrap()).await;
    let mut erwartet = vec![w.admin_id().await, w.anna, w.bert, w.carla];
    erwartet.sort_unstable();
    assert_eq!(an, erwartet);
    assert!(!an.contains(&konto));
}

/// Spec-Szenario „Sichten räumt den Hinweis bei allen“: geht die Meldung aus „Neu“, sind die
/// Hinweise aller Empfänger quittiert. Ein Sofortalarm bleibt davon unberührt.
#[tokio::test]
async fn sichten_raeumt_den_eingang_bei_allen_nicht_den_sofortalarm() {
    let w = welt().await;
    let m = w
        .erfassen(&w.admin, json!({ "prioritaet": "dringend" }))
        .await;
    let id = m["id"].as_i64().unwrap();
    assert_eq!(w.offen("meldung", "meldung", id).await, 3);
    let (s, v) = anfrage(
        &w.app,
        "POST",
        &format!("/api/einsaetze/{}/meldungen/{id}/status", w.einsatz),
        &w.cookie("carla").await,
        Some(&json!({ "status": "gesichtet" }).to_string()),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert_eq!(w.offen("meldung", "meldung", id).await, 0);
    assert!(w
        .lesen(&w.cookie("annika").await)
        .await
        .iter()
        .all(|b| b["quittiert_at"].is_string()));

    let sofort = w
        .erfassen(
            &w.cookie("annika").await,
            json!({ "meldungsart": "sofortmeldung" }),
        )
        .await;
    let sid = sofort["id"].as_i64().unwrap();
    let vorher = w.offen("sofortmeldung", "meldung", sid).await;
    assert!(vorher > 0);
    let (s, _) = anfrage(
        &w.app,
        "POST",
        &format!("/api/einsaetze/{}/meldungen/{sid}/status", w.einsatz),
        &w.admin,
        Some(&json!({ "status": "in_bearbeitung" }).to_string()),
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(w.offen("sofortmeldung", "meldung", sid).await, vorher);
}

/// Bestätigen hebt Neu auf Gesichtet (LLH-1052) und räumt damit auch den Eingang einer
/// bestätigungspflichtigen Lagemeldung.
#[tokio::test]
async fn bestaetigen_raeumt_den_eingang() {
    let w = welt().await;
    let m = w
        .erfassen(
            &w.admin,
            json!({ "meldungsart": "lagemeldung", "bestaetigung_pflicht": true }),
        )
        .await;
    let id = m["id"].as_i64().unwrap();
    assert_eq!(w.offen("meldung", "meldung", id).await, 3);
    let (s, v) = anfrage(
        &w.app,
        "POST",
        &format!("/api/einsaetze/{}/meldungen/{id}/bestaetigen", w.einsatz),
        &w.cookie("bertram").await,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert_eq!(w.offen("meldung", "meldung", id).await, 0);
}

// ───────────────────────── In die Lage übernommen ─────────────────────────

async fn uebernehmen(w: &Welt, cookie: &str, id: i64) -> Value {
    let (s, v) = anfrage(
        &w.app,
        "POST",
        &format!("/api/einsaetze/{}/meldungen/{id}/lagerelevant", w.einsatz),
        cookie,
        Some("{}"),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    v
}

/// Spec-Szenario „Übernahme in die Lage“: S2 und die Einsatzleitung bekommen „In die Lage
/// übernommen“ mit Sprung zu den Lagemeldungen, der Übernehmende nicht; eine zweite Übergabe und
/// eine Meldung der Art Lagemeldung lösen keinen weiteren Hinweis aus.
#[tokio::test]
async fn uebernahme_in_die_lage_erreicht_s2_und_einsatzleitung() {
    let w = welt().await;
    w.mitgliedschaft_funktion(w.carla, "el").await;
    let m = w.erfassen(&w.admin, json!({})).await;
    let id = m["id"].as_i64().unwrap();
    let bert = w.cookie("bertram").await;
    uebernehmen(&w, &bert, id).await;
    assert_eq!(
        w.empfaenger("lage_uebernahme", id).await,
        vec![w.anna, w.carla]
    );
    // Der Eingang der Meldung selbst (LLH-1143 D5) steht daneben; hier zählt die Übernahme.
    let gelesen: Vec<Value> = w
        .lesen(&w.cookie("annika").await)
        .await
        .into_iter()
        .filter(|b| b["bezug_typ"] == "lage_uebernahme")
        .collect();
    assert_eq!(gelesen.len(), 1, "{gelesen:?}");
    assert_eq!(gelesen[0]["titel"], "In die Lage übernommen");
    assert_eq!(gelesen[0]["bezug_typ"], "lage_uebernahme");
    assert_eq!(gelesen[0]["detail"], format!("Meldung #{}", m["lfd_nr"]));
    assert_eq!(
        gelesen[0]["pfad"],
        format!("/einsaetze/{}/lagemeldungen", w.einsatz)
    );

    // Zweite Übergabe mit neuem Text: kein weiterer Hinweis.
    let (s, _) = anfrage(
        &w.app,
        "POST",
        &format!("/api/einsaetze/{}/meldungen/{id}/lagerelevant", w.einsatz),
        &bert,
        Some(&json!({ "text": "Deich gesichert" }).to_string()),
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(w.empfaenger("lage_uebernahme", id).await.len(), 2);

    // Art Lagemeldung: hatte ihren Eingang, die Übergabe meldet nicht noch einmal.
    let lage = w
        .erfassen(&w.admin, json!({ "meldungsart": "lagemeldung" }))
        .await;
    let lid = lage["id"].as_i64().unwrap();
    uebernehmen(&w, &bert, lid).await;
    assert!(w.empfaenger("lage_uebernahme", lid).await.is_empty());
}

/// Spec-Szenario „Kenntnisnahme räumt die Übernahme“: als gesehen gekennzeichnet (einzeln oder
/// alle) quittiert die Übernahme-Hinweise aller Empfänger.
#[tokio::test]
async fn gesehen_raeumt_die_uebernahme() {
    let w = welt().await;
    let bert = w.cookie("bertram").await;
    let eins = w.erfassen(&w.admin, json!({})).await["id"]
        .as_i64()
        .unwrap();
    let zwei = w.erfassen(&w.admin, json!({})).await["id"]
        .as_i64()
        .unwrap();
    // Die Kennung der Lagemeldung ist die der Meldung (LLH-1031).
    uebernehmen(&w, &bert, eins).await;
    uebernehmen(&w, &bert, zwei).await;
    assert_eq!(w.offen("meldung", "lage_uebernahme", eins).await, 1);

    let (s, v) = anfrage(
        &w.app,
        "POST",
        &format!("/api/einsaetze/{}/meldungen/{eins}/lage-gesehen", w.einsatz),
        &w.admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert_eq!(w.offen("meldung", "lage_uebernahme", eins).await, 0);
    assert_eq!(w.offen("meldung", "lage_uebernahme", zwei).await, 1);

    let (s, v) = anfrage(
        &w.app,
        "POST",
        &format!("/api/einsaetze/{}/lage/gesehen", w.einsatz),
        &w.admin,
        Some(&json!({ "meldung_ids": [zwei] }).to_string()),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert_eq!(w.offen("meldung", "lage_uebernahme", zwei).await, 0);
}

/// Die Korrektur (LLH-1066) wirkt wie die Übergabe: kommt die Meldung über sie in die Lage,
/// bekommen S2 und die Einsatzleitung „In die Lage übernommen“; nimmt sie sie wieder heraus,
/// ist der Hinweis für alle erledigt.
#[tokio::test]
async fn korrektur_in_und_aus_der_lage_meldet_und_raeumt_die_uebernahme() {
    let w = welt().await;
    w.mitgliedschaft_funktion(w.carla, "el").await;
    let bert = w.cookie("bertram").await;
    let id = w.erfassen(&w.admin, json!({})).await["id"]
        .as_i64()
        .unwrap();
    let korrigieren = |body: Value| {
        let (app, cookie, einsatz) = (w.app.clone(), bert.clone(), w.einsatz);
        async move {
            let (s, v) = anfrage(
                &app,
                "PATCH",
                &format!("/api/einsaetze/{einsatz}/meldungen/{id}"),
                &cookie,
                Some(&body.to_string()),
            )
            .await;
            assert_eq!(s, StatusCode::OK, "{v}");
        }
    };

    korrigieren(json!({ "lagerelevant": true })).await;
    assert_eq!(
        w.empfaenger("lage_uebernahme", id).await,
        vec![w.anna, w.carla]
    );
    assert_eq!(w.offen("meldung", "lage_uebernahme", id).await, 2);

    // Eine Korrektur in der Lage meldet nicht noch einmal.
    korrigieren(json!({ "lage_text": "Deich gesichert" })).await;
    assert_eq!(w.empfaenger("lage_uebernahme", id).await.len(), 2);

    korrigieren(json!({ "lagerelevant": false })).await;
    assert_eq!(w.offen("meldung", "lage_uebernahme", id).await, 0);
}

// ───────────────────────── Empfängerfunktion korrigiert (LLH-1381) ─────────────────────────

impl Welt {
    /// Korrigiert als `cookie` die Meldung `id` per PATCH; erwartet 200.
    async fn korrigieren(&self, cookie: &str, id: i64, body: Value) -> Value {
        let (s, v) = anfrage(
            &self.app,
            "PATCH",
            &format!("/api/einsaetze/{}/meldungen/{id}", self.einsatz),
            cookie,
            Some(&body.to_string()),
        )
        .await;
        assert_eq!(s, StatusCode::OK, "{v}");
        v
    }

    /// Die offenen Empfänger der Art `meldung` zu Bezug `meldung`/`id`, aufsteigend.
    async fn offen_an(&self, id: i64) -> Vec<i64> {
        sqlx::query_scalar(
            "SELECT benutzer_id FROM benachrichtigung \
             WHERE art = 'meldung' AND bezug_typ = 'meldung' AND bezug_id = ? \
               AND quittiert_at IS NULL ORDER BY benutzer_id",
        )
        .bind(id)
        .fetch_all(&self.pool)
        .await
        .unwrap()
    }
}

/// Akzeptanzkriterium LLH-1381: die Empfängerfunktion einer neuen Lagemeldung von S3 auf S2
/// korrigiert. S2 bekommt den Hinweis, der von S3 ist erledigt; die Einsatzleitung behält ihren
/// einen Hinweis und bekommt keinen zweiten.
#[tokio::test]
async fn korrigierte_empfaengerfunktion_erreicht_die_neue_funktion() {
    let w = welt().await;
    w.mitgliedschaft_funktion(w.carla, "el").await;
    let id = w
        .erfassen(
            &w.admin,
            json!({ "meldungsart": "lagemeldung", "empfaenger_funktion": "s3" }),
        )
        .await["id"]
        .as_i64()
        .unwrap();
    assert_eq!(w.offen_an(id).await, vec![w.bert, w.carla]);

    let m = w
        .korrigieren(&w.admin, id, json!({ "empfaenger_funktion": "s2" }))
        .await;
    assert_eq!(m["empfaenger_funktion"], "s2");
    assert_eq!(w.offen_an(id).await, vec![w.anna, w.carla]);
    assert_eq!(
        w.empfaenger("meldung", id).await,
        vec![w.anna, w.bert, w.carla],
        "je Person höchstens ein Hinweis"
    );
    let bert = w.lesen(&w.cookie("bertram").await).await;
    assert!(
        bert.iter().all(|b| b["quittiert_at"].is_string()),
        "{bert:?}"
    );
    let anna = w.lesen(&w.cookie("annika").await).await;
    assert_eq!(anna.len(), 1);
    assert_eq!(anna[0]["titel"], "Neue Meldung");
}

/// Auch der stille Fall „Meldung an mich“ (normal, von Hand) folgt der Funktion. Wer korrigiert,
/// bekommt nichts, auch wenn er die neue Funktion besetzt.
#[tokio::test]
async fn meldung_an_mich_folgt_der_korrektur_nicht_an_den_korrigierenden() {
    let w = welt().await;
    let id = w
        .erfassen(&w.admin, json!({ "empfaenger_funktion": "s3" }))
        .await["id"]
        .as_i64()
        .unwrap();
    assert_eq!(w.offen_an(id).await, vec![w.bert]);

    w.korrigieren(
        &w.cookie("annika").await,
        id,
        json!({ "empfaenger_funktion": "s2" }),
    )
    .await;
    assert!(w.offen_an(id).await.is_empty());

    w.korrigieren(&w.admin, id, json!({ "empfaenger_funktion": "s3" }))
        .await;
    assert_eq!(
        w.offen_an(id).await,
        Vec::<i64>::new(),
        "Bert hatte ihn schon"
    );
    // Funktion geleert: eine normale Meldung von Hand ohne Funktion geht an alle mit Schreibrecht
    // im Modul (LLH-1143, design.md D5); Bert hatte seinen Hinweis schon, der Admin löst aus.
    w.korrigieren(&w.admin, id, json!({ "empfaenger_funktion": null }))
        .await;
    assert_eq!(w.offen_an(id).await, vec![w.anna, w.carla]);
}

/// Akzeptanzkriterium LLH-1381: eine schon gesichtete Meldung löst mit der Korrektur keinen
/// neuen Hinweis aus.
#[tokio::test]
async fn gesichtete_meldung_meldet_nach_der_korrektur_nicht() {
    let w = welt().await;
    let id = w
        .erfassen(
            &w.admin,
            json!({ "prioritaet": "dringend", "empfaenger_funktion": "s3" }),
        )
        .await["id"]
        .as_i64()
        .unwrap();
    let (s, v) = anfrage(
        &w.app,
        "POST",
        &format!("/api/einsaetze/{}/meldungen/{id}/status", w.einsatz),
        &w.cookie("bertram").await,
        Some(&json!({ "status": "gesichtet" }).to_string()),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert!(w.offen_an(id).await.is_empty());

    w.korrigieren(&w.admin, id, json!({ "empfaenger_funktion": "s2" }))
        .await;
    assert!(w.offen_an(id).await.is_empty());
    assert!(!w.empfaenger("meldung", id).await.contains(&w.anna));
}
