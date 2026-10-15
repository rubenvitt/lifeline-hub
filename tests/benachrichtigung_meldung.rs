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

/// Ohne Empfängerfunktion bleibt die Meldung still, auch wenn der Freitext „S2“ lautet: es gibt
/// keinen Rückschluss vom Freitext auf eine Funktion (`frontend/src/fuehrung/AGENTS.md`).
#[tokio::test]
async fn meldung_ohne_empfaengerfunktion_bleibt_still() {
    let w = welt().await;
    w.erfassen(&w.admin, json!({ "empfaenger": "S2" })).await;
    w.erfassen(&w.admin, json!({})).await;
    assert!(w.zeilen().await.is_empty());
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
