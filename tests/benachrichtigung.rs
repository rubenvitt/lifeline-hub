//! Benachrichtigungen, Fundament Server (LLH-1207, Change `kcjecn9e-benachrichtigungskonzept`,
//! Spec `benachrichtigungen`): `benachrichtigung::melden` gegen echte Testdaten — Auflösung der
//! Empfänger mit allen Ausschlüssen, Zustellung im Einsatz-Strom (live und Replay) und im
//! Org-Kanal, die drei Routen und die Einstellung `benachrichtigungen_aus`.

use axum::body::Body;
use axum::http::{header, Request, StatusCode};
use lifeline_hub::benachrichtigung::{
    melden, Adressat, Anlass, BenachrichtigungArt as Art, BenachrichtigungBezugTyp as Typ, Bezug,
};
use lifeline_hub::fuehrung::Fuehrungsfunktion;
use lifeline_hub::live::{LiveEvent, LiveHub, Replay};
use serde_json::{json, Value};
use tower::ServiceExt;

mod common;
use common::{
    anfrage, benutzer_anlegen, einsatz_anlegen, login_cookie, rolle_setzen, setup_mit_pool_und_live,
};

struct Welt {
    app: axum::Router,
    pool: sqlx::SqlitePool,
    live: LiveHub,
    admin: String,
    admin_id: i64,
    einsatz: i64,
    /// Mitglied (Führungspersonal) „annika“.
    anna: i64,
    /// Mitglied (Führungspersonal) „bertram“.
    bert: i64,
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
    rolle_setzen(&app, &admin, einsatz, anna, "fuehrungspersonal").await;
    rolle_setzen(&app, &admin, einsatz, bert, "fuehrungspersonal").await;
    // Die Aufnahmen oben melden `einsatz_aufnahme` (tasks.md 15.1, `tests/benachrichtigung_org.rs`);
    // die Tests hier beginnen mit leerer Tabelle.
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
    }
}

impl Welt {
    async fn cookie(&self, name: &str) -> String {
        login_cookie(&self.app, name, &format!("{name}pw1")).await
    }

    /// Legt eine Stamm-Person mit verknüpftem Konto an und disponiert sie; liefert die
    /// `einsatz_personal.id`.
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

    async fn besetzen(&self, sachgebiet: &str, body: Value) {
        let (s, v) = anfrage(
            &self.app,
            "PUT",
            &format!(
                "/api/einsaetze/{}/stab/besetzung/{sachgebiet}",
                self.einsatz
            ),
            &self.admin,
            Some(&body.to_string()),
        )
        .await;
        assert!(s.is_success(), "besetzen {sachgebiet}: {s} {v}");
    }

    async fn funktion_setzen(&self, benutzer_id: i64, funktion: &str) {
        let (s, v) = anfrage(
            &self.app,
            "PUT",
            &format!("/api/einsaetze/{}/mitglieder/{benutzer_id}", self.einsatz),
            &self.admin,
            Some(
                &json!({ "einsatz_rolle": "fuehrungspersonal", "fuehrungsfunktion": funktion })
                    .to_string(),
            ),
        )
        .await;
        assert_eq!(s, StatusCode::OK, "{v}");
    }

    async fn modul_nur_fuer_admins(&self, modul: &str) {
        let (s, v) = anfrage(
            &self.app,
            "PUT",
            &format!("/api/einsaetze/{}/modul-overrides/{modul}", self.einsatz),
            &self.admin,
            Some(r#"{"sichtbar":true,"benoetigte_rolle":"admin"}"#),
        )
        .await;
        assert_eq!(s, StatusCode::OK, "{v}");
    }

    fn anlass(&self, art: Art, typ: Typ, id: i64) -> Anlass {
        Anlass::neu(self.einsatz, art, Bezug::neu(typ, id))
    }

    async fn melden(&self, anlass: Anlass) -> Vec<i64> {
        melden(&self.pool, &self.live, anlass).await
    }

    async fn zeilen(&self) -> i64 {
        sqlx::query_scalar("SELECT COUNT(*) FROM benachrichtigung")
            .fetch_one(&self.pool)
            .await
            .unwrap()
    }

    async fn auftrag(&self) -> (i64, i64) {
        let body = json!({
            "auftrag_text": "Sandsäcke zum Deich bringen",
            "empfaenger": [{ "empfaenger_typ": "funktion", "funktion_text": "Logistiktrupp" }]
        });
        let (s, v) = anfrage(
            &self.app,
            "POST",
            &format!("/api/einsaetze/{}/auftraege", self.einsatz),
            &self.admin,
            Some(&body.to_string()),
        )
        .await;
        assert_eq!(s, StatusCode::CREATED, "{v}");
        (v["id"].as_i64().unwrap(), v["lfd_nr"].as_i64().unwrap())
    }
}

// ───────────────────────── Empfängerauflösung ─────────────────────────

/// Spec-Szenario „Auftrag an S4“: die Stab-Besetzung S4 bekommt ihn, ein anderes Mitglied nicht.
#[tokio::test]
async fn auftrag_an_s4_erreicht_nur_die_besetzung() {
    let w = welt().await;
    let ep = w.personal("Anna", Some(w.anna)).await;
    w.besetzen(
        "s4",
        json!({ "besetzung_art": "personal", "personal_id": ep }),
    )
    .await;
    let an = w
        .melden(
            w.anlass(Art::AuftragErteilt, Typ::Auftrag, 1)
                .von(w.admin_id)
                .an(Adressat::Funktion(Fuehrungsfunktion::S4)),
        )
        .await;
    assert_eq!(an, vec![w.anna]);
    assert_eq!(w.zeilen().await, 1);
}

/// Die Stab-Besetzung geht der Funktion aus der Mitgliedschaft vor.
#[tokio::test]
async fn stab_besetzung_geht_der_mitgliedschaft_vor() {
    let w = welt().await;
    let ep = w.personal("Anna", Some(w.anna)).await;
    w.besetzen(
        "s4",
        json!({ "besetzung_art": "personal", "personal_id": ep }),
    )
    .await;
    w.funktion_setzen(w.bert, "s4").await;
    let an = w
        .melden(
            w.anlass(Art::AuftragErteilt, Typ::Auftrag, 1)
                .an(Adressat::Funktion(Fuehrungsfunktion::S4)),
        )
        .await;
    assert_eq!(an, vec![w.anna]);
}

/// Ohne Stab-Besetzung gilt die Funktion der Mitgliedschaft (Spec „Meine Funktion“).
#[tokio::test]
async fn ohne_besetzung_gilt_die_funktion_der_mitgliedschaft() {
    let w = welt().await;
    w.funktion_setzen(w.bert, "s4").await;
    let an = w
        .melden(
            w.anlass(Art::AuftragErteilt, Typ::Auftrag, 1)
                .an(Adressat::Funktion(Fuehrungsfunktion::S4)),
        )
        .await;
    assert_eq!(an, vec![w.bert]);
}

/// Besetzt niemand die Funktion, entsteht keine Benachrichtigung.
#[tokio::test]
async fn unbesetzte_funktion_erzeugt_nichts() {
    let w = welt().await;
    let an = w
        .melden(
            w.anlass(Art::AuftragErteilt, Typ::Auftrag, 1)
                .an(Adressat::Funktion(Fuehrungsfunktion::S4)),
        )
        .await;
    assert!(an.is_empty());
    assert_eq!(w.zeilen().await, 0);
}

/// EL ist der Einsatzleiter der Führungsstelle; ein Sachgebiet „bei der Einsatzleitung“ löst
/// ebenso auf.
#[tokio::test]
async fn el_und_sachgebiet_bei_der_einsatzleitung_erreichen_den_einsatzleiter() {
    let w = welt().await;
    let ep = w.personal("Anna", Some(w.anna)).await;
    let geaendert = sqlx::query(
        "UPDATE einsatz_fuehrungsstelle SET einsatzleiter_art = 'personal', \
             einsatzleiter_personal_id = ?, einsatzleiter_name = 'Anna', \
             einsatzleiter_seit = '2026-01-01 00:00:00' WHERE einsatz_id = ?",
    )
    .bind(ep)
    .bind(w.einsatz)
    .execute(&w.pool)
    .await
    .unwrap()
    .rows_affected();
    if geaendert == 0 {
        sqlx::query(
            "INSERT INTO einsatz_fuehrungsstelle (einsatz_id, einsatzleiter_art, \
                 einsatzleiter_personal_id, einsatzleiter_name, einsatzleiter_seit) \
             VALUES (?, 'personal', ?, 'Anna', '2026-01-01 00:00:00')",
        )
        .bind(w.einsatz)
        .bind(ep)
        .execute(&w.pool)
        .await
        .unwrap();
    }
    let an = w
        .melden(
            w.anlass(Art::Befehl, Typ::Befehl, 1)
                .an(Adressat::Funktion(Fuehrungsfunktion::El)),
        )
        .await;
    assert_eq!(an, vec![w.anna], "EL");

    w.besetzen("s2", json!({ "besetzung_art": "einsatzleitung" }))
        .await;
    let an = w
        .melden(
            w.anlass(Art::Befehl, Typ::Befehl, 1)
                .an(Adressat::Funktion(Fuehrungsfunktion::S2)),
        )
        .await;
    assert_eq!(an, vec![w.anna], "S2 bei der Einsatzleitung");
}

/// Wer das Modul des Bezugs nicht lesen darf, bekommt nichts — auch wenn seine Funktion
/// adressiert ist.
#[tokio::test]
async fn ohne_modulrecht_am_bezug_entfaellt_der_empfaenger() {
    let w = welt().await;
    let ep = w.personal("Anna", Some(w.anna)).await;
    w.besetzen(
        "s4",
        json!({ "besetzung_art": "personal", "personal_id": ep }),
    )
    .await;
    w.modul_nur_fuer_admins("auftraege").await;
    let an = w
        .melden(
            w.anlass(Art::AuftragErteilt, Typ::Auftrag, 1)
                .an(Adressat::Funktion(Fuehrungsfunktion::S4)),
        )
        .await;
    assert!(an.is_empty());
    assert_eq!(w.zeilen().await, 0);
}

/// Modul-Leser: alle Mitglieder mit Leserecht am Modul, ohne den Auslöser (Spec „Eigene
/// Aktionen benachrichtigen den Auslöser nicht“, Szenario eigene Sofortmeldung).
#[tokio::test]
async fn eigene_sofortmeldung_erreicht_die_anderen_leser_nicht_den_ausloeser() {
    let w = welt().await;
    let an = w
        .melden(
            w.anlass(Art::Sofortmeldung, Typ::Meldung, 1)
                .von(w.admin_id)
                .an(Adressat::ModulLeser("meldungen")),
        )
        .await;
    assert_eq!(an, vec![w.anna, w.bert]);

    let an = w
        .melden(
            w.anlass(Art::Sofortmeldung, Typ::Meldung, 1)
                .von(w.anna)
                .an(Adressat::ModulLeser("meldungen")),
        )
        .await;
    assert_eq!(an, vec![w.admin_id, w.bert]);
}

/// Spec-Szenario: ein Auftrag an die eigene Funktion benachrichtigt den Erteilenden nicht.
#[tokio::test]
async fn auftrag_an_die_eigene_funktion_benachrichtigt_niemanden() {
    let w = welt().await;
    let ep = w.personal("Anna", Some(w.anna)).await;
    w.besetzen(
        "s4",
        json!({ "besetzung_art": "personal", "personal_id": ep }),
    )
    .await;
    let an = w
        .melden(
            w.anlass(Art::AuftragErteilt, Typ::Auftrag, 1)
                .von(w.anna)
                .an(Adressat::Funktion(Fuehrungsfunktion::S4)),
        )
        .await;
    assert!(an.is_empty());
}

/// Spec „Gekoppelte Geräte bleiben still“: ein Gerätekonto bekommt nie eine Benachrichtigung,
/// auch wenn es adressiert ist und den Einsatz lesen dürfte.
#[tokio::test]
async fn geraetekonto_bleibt_still() {
    let w = welt().await;
    let (s, v) = anfrage(
        &w.app,
        "POST",
        &format!("/api/einsaetze/{}/geraete", w.einsatz),
        &w.admin,
        Some(r#"{"ansicht":"lagemonitor","bezeichnung":"Monitor"}"#),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
    let konto: i64 = sqlx::query_scalar("SELECT benutzer_id FROM geraet_kopplung WHERE id = ?")
        .bind(v["kopplung"]["id"].as_i64().unwrap())
        .fetch_one(&w.pool)
        .await
        .unwrap();
    // Ein Gerät ist nie Mitglied; hier doch, damit allein die Gerätekopplung ausschließt.
    sqlx::query(
        "INSERT INTO einsatz_mitgliedschaft (einsatz_id, benutzer_id, einsatz_rolle) \
         VALUES (?, ?, 'fuehrungspersonal')",
    )
    .bind(w.einsatz)
    .bind(konto)
    .execute(&w.pool)
    .await
    .unwrap();
    let an = w
        .melden(
            w.anlass(Art::Sofortmeldung, Typ::Meldung, 1)
                .an(Adressat::Nutzer(konto))
                .an(Adressat::Nutzer(w.anna))
                .an(Adressat::ModulLeser("meldungen")),
        )
        .await;
    assert!(!an.contains(&konto), "{an:?}");
    assert!(an.contains(&w.anna));
}

/// Inaktive Konten und Nutzer ohne Leserecht am Einsatz entfallen.
#[tokio::test]
async fn inaktive_und_einsatzfremde_entfallen() {
    let w = welt().await;
    let fremd = benutzer_anlegen(&w.app, &w.admin, "fremder", "keine").await;
    sqlx::query("UPDATE benutzer SET aktiv = 0 WHERE id = ?")
        .bind(w.bert)
        .execute(&w.pool)
        .await
        .unwrap();
    let an = w
        .melden(
            w.anlass(Art::Meldung, Typ::Meldung, 1)
                .an(Adressat::Nutzer(fremd))
                .an(Adressat::Nutzer(w.bert))
                .an(Adressat::Nutzer(w.anna)),
        )
        .await;
    assert_eq!(an, vec![w.anna]);
}

/// Spec „Person“: der mit dem Einsatzpersonal verknüpfte Nutzer; ohne Verknüpfung niemand.
#[tokio::test]
async fn person_adressat_erreicht_den_verknuepften_nutzer() {
    let w = welt().await;
    let mit = w.personal("Anna", Some(w.anna)).await;
    let ohne = w.personal("Ohne Konto", None).await;
    let an = w
        .melden(
            w.anlass(Art::AuftragErteilt, Typ::Auftrag, 1)
                .an(Adressat::Person(mit))
                .an(Adressat::Person(ohne)),
        )
        .await;
    assert_eq!(an, vec![w.anna]);
}

/// D6: eine abgeschaltete Hinweis-Art entfällt; ein Alarm erreicht den Nutzer immer, selbst
/// wenn seine gespeicherte Liste ihn (an der Prüfung vorbei) nennt.
#[tokio::test]
async fn abgeschaltete_hinweis_art_entfaellt_alarm_nie() {
    let w = welt().await;
    let anna = w.cookie("annika").await;
    let (s, v) = anfrage(
        &w.app,
        "PUT",
        "/api/benutzer-einstellungen/benachrichtigungen_aus",
        &anna,
        Some(r#"{"wert":"[\"meldung\",\"auftrag_erteilt\",\"meldung\"]"}"#),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert_eq!(
        v["eintraege"]["benachrichtigungen_aus"], r#"["auftrag_erteilt","meldung"]"#,
        "entdoppelt, in Katalogreihenfolge"
    );
    let an = w
        .melden(
            w.anlass(Art::AuftragErteilt, Typ::Auftrag, 1)
                .an(Adressat::Nutzer(w.anna))
                .an(Adressat::Nutzer(w.bert)),
        )
        .await;
    assert_eq!(an, vec![w.bert]);

    sqlx::query(
        "UPDATE benutzer_einstellungen SET wert = '[\"sofortmeldung\"]' \
         WHERE benutzer_id = ? AND schluessel = 'benachrichtigungen_aus'",
    )
    .bind(w.anna)
    .execute(&w.pool)
    .await
    .unwrap();
    let an = w
        .melden(
            w.anlass(Art::Sofortmeldung, Typ::Meldung, 1)
                .an(Adressat::Nutzer(w.anna)),
        )
        .await;
    assert_eq!(an, vec![w.anna]);
}

#[tokio::test]
async fn einstellung_lehnt_alarm_mit_422_und_unbekanntes_mit_400_ab() {
    let w = welt().await;
    let anna = w.cookie("annika").await;
    for (wert, erwartet) in [
        (r#"["sofortmeldung"]"#, StatusCode::UNPROCESSABLE_ENTITY),
        (
            r#"["auftrag_ueberfaellig","meldung"]"#,
            StatusCode::UNPROCESSABLE_ENTITY,
        ),
        (r#"["gibt_es_nicht"]"#, StatusCode::BAD_REQUEST),
        (r#"{"meldung":true}"#, StatusCode::BAD_REQUEST),
        ("[]", StatusCode::OK),
        // Seit LLH-1425 Alarme (Katalog LLH-1142 E1): nicht abschaltbar.
        (r#"["unwetter"]"#, StatusCode::UNPROCESSABLE_ENTITY),
        (r#"["vermisstenmeldung"]"#, StatusCode::UNPROCESSABLE_ENTITY),
        (r#"["rueckmeldung_ueberfaellig"]"#, StatusCode::OK),
    ] {
        let (s, v) = anfrage(
            &w.app,
            "PUT",
            "/api/benutzer-einstellungen/benachrichtigungen_aus",
            &anna,
            Some(&json!({ "wert": wert }).to_string()),
        )
        .await;
        assert_eq!(s, erwartet, "{wert}: {v}");
    }
}

/// `einsatz_neu` erreicht Führungskräfte der Org, die den Einsatz ohne Mitgliedschaft lesen
/// dürfen, nicht Konten ohne Org-Rolle.
#[tokio::test]
async fn fuehrungskraefte_sind_die_org_weiten_leser() {
    let w = welt().await;
    let fk = benutzer_anlegen(&w.app, &w.admin, "fuehrung", "fuehrungskraft").await;
    let an = w
        .melden(
            w.anlass(Art::EinsatzNeu, Typ::Einsatz, w.einsatz)
                .von(w.admin_id)
                .an(Adressat::Fuehrungskraefte),
        )
        .await;
    assert_eq!(an, vec![fk]);
}

// ───────────────────────── Zustellung ─────────────────────────

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

/// `(event, data)` je Frame mit Ereignisnamen, ohne die Position.
fn ereignisse(roh: &str) -> Vec<(String, String)> {
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
            event.filter(|e| e != "position").map(|e| (e, data))
        })
        .collect()
}

fn position(roh: &str) -> String {
    roh.split("\n\n")
        .find(|b| b.lines().any(|z| z == "event: position"))
        .and_then(|b| b.lines().find_map(|z| z.strip_prefix("id: ")))
        .unwrap_or_else(|| panic!("keine Position: {roh:?}"))
        .to_string()
}

async fn lesen(resp: axum::response::Response) -> String {
    common::sse_anfang_lesen(resp.into_body(), 300).await
}

/// Der Empfängerfilter im Stream-Builder: ein fremder Nutzer erhält das Ereignis weder live
/// noch im Replay (Last-Event-ID), der Empfänger in beiden.
#[tokio::test]
async fn einsatz_strom_stellt_nur_dem_empfaenger_zu_live_und_im_replay() {
    let w = welt().await;
    let anna = w.cookie("annika").await;
    let bert = w.cookie("bertram").await;
    let feed = format!("/api/einsaetze/{}/live", w.einsatz);

    let anna_live = oeffnen(&w.app, &feed, &anna, None).await;
    let bert_live = oeffnen(&w.app, &feed, &bert, None).await;
    let pos = position(&lesen(oeffnen(&w.app, &feed, &w.admin, None).await).await);

    let an = w
        .melden(
            w.anlass(Art::AuftragErteilt, Typ::Auftrag, 7)
                .an(Adressat::Nutzer(w.anna)),
        )
        .await;
    assert_eq!(an, vec![w.anna]);
    let id: i64 = sqlx::query_scalar("SELECT id FROM benachrichtigung")
        .fetch_one(&w.pool)
        .await
        .unwrap();
    // Ein ungegatetes Ereignis daneben: Bert hört zu, er bekommt nur das eine nicht.
    w.live.publiziere_einsatz(w.einsatz, LiveEvent::Einsatz);

    let live_anna = ereignisse(&lesen(anna_live).await);
    let live_bert = ereignisse(&lesen(bert_live).await);
    let namen = |e: &[(String, String)]| e.iter().map(|(n, _)| n.clone()).collect::<Vec<_>>();
    assert_eq!(namen(&live_anna), ["benachrichtigung", "einsatz"]);
    assert_eq!(namen(&live_bert), ["einsatz"]);
    let data: Value = serde_json::from_str(&live_anna[0].1).unwrap();
    assert_eq!(
        data,
        json!({
            "einsatz_id": w.einsatz,
            "benachrichtigung_id": id,
            "art": "auftrag_erteilt",
            "stufe": "hinweis",
            "bezug_typ": "auftrag",
            "bezug_id": 7,
            "quittiert": false,
        })
    );

    let replay_anna = ereignisse(&lesen(oeffnen(&w.app, &feed, &anna, Some(&pos)).await).await);
    let replay_bert = ereignisse(&lesen(oeffnen(&w.app, &feed, &bert, Some(&pos)).await).await);
    assert_eq!(namen(&replay_anna), ["benachrichtigung", "einsatz"]);
    assert_eq!(namen(&replay_bert), ["einsatz"]);
}

/// Ein `melden`-Aufruf belegt genau EINEN Platz im Ring des Einsatzes, gleich wie viele
/// Empfänger er hat; jeder Empfänger bekommt live und im Replay seine eigene
/// `benachrichtigung_id`, ein Nicht-Empfänger nichts.
#[tokio::test]
async fn ein_melden_belegt_einen_ringplatz_und_jeder_bekommt_seine_eigene_id() {
    let w = welt().await;
    let anna = w.cookie("annika").await;
    let bert = w.cookie("bertram").await;
    let feed = format!("/api/einsaetze/{}/live", w.einsatz);
    let anna_live = oeffnen(&w.app, &feed, &anna, None).await;
    let bert_live = oeffnen(&w.app, &feed, &bert, None).await;
    let admin_live = oeffnen(&w.app, &feed, &w.admin, None).await;
    let (_, _halter, pos) = w.live.abonniere_mit_position(w.einsatz, None);

    let an = w
        .melden(
            w.anlass(Art::Sofortmeldung, Typ::Meldung, 3)
                .von(w.admin_id)
                .an(Adressat::ModulLeser("meldungen")),
        )
        .await;
    assert_eq!(an, vec![w.anna, w.bert]);

    let Replay::Events(ring) = w.live.abonniere_mit_replay(w.einsatz, Some(pos.clone())).0 else {
        panic!("Replay erwartet");
    };
    assert_eq!(ring.len(), 1, "ein melden-Aufruf, ein Ringplatz");

    let eigene = |benutzer_id: i64| {
        let pool = w.pool.clone();
        async move {
            sqlx::query_scalar::<_, i64>("SELECT id FROM benachrichtigung WHERE benutzer_id = ?")
                .bind(benutzer_id)
                .fetch_one(&pool)
                .await
                .unwrap()
        }
    };
    let ids_aus = |roh: &str| -> Vec<i64> {
        ereignisse(roh)
            .into_iter()
            .filter(|(n, _)| n == "benachrichtigung")
            .map(|(_, d)| {
                serde_json::from_str::<Value>(&d).unwrap()["benachrichtigung_id"]
                    .as_i64()
                    .unwrap()
            })
            .collect()
    };
    let id_anna = eigene(w.anna).await;
    let id_bert = eigene(w.bert).await;
    assert_ne!(id_anna, id_bert);

    assert_eq!(ids_aus(&lesen(anna_live).await), vec![id_anna], "live");
    assert_eq!(ids_aus(&lesen(bert_live).await), vec![id_bert], "live");
    assert!(
        ids_aus(&lesen(admin_live).await).is_empty(),
        "Auslöser live"
    );
    for (cookie, erwartet) in [
        (&anna, vec![id_anna]),
        (&bert, vec![id_bert]),
        (&w.admin, vec![]),
    ] {
        let roh = lesen(oeffnen(&w.app, &feed, cookie, Some(&pos)).await).await;
        assert_eq!(ids_aus(&roh), erwartet, "Replay: {roh:?}");
    }
}

/// Org-Arten gehen über den Org-Kanal (`/api/live`) an genau ihren Empfänger.
#[tokio::test]
async fn org_art_geht_ueber_den_org_kanal_nur_an_den_empfaenger() {
    let w = welt().await;
    let anna = w.cookie("annika").await;
    let bert = w.cookie("bertram").await;
    let anna_org = oeffnen(&w.app, "/api/live", &anna, None).await;
    let bert_org = oeffnen(&w.app, "/api/live", &bert, None).await;
    let admin_org = oeffnen(&w.app, "/api/live", &w.admin, None).await;
    let anna_einsatz = oeffnen(
        &w.app,
        &format!("/api/einsaetze/{}/live", w.einsatz),
        &anna,
        None,
    )
    .await;

    let an = w
        .melden(
            w.anlass(Art::EinsatzAufnahme, Typ::Einsatz, w.einsatz)
                .von(w.admin_id)
                .an(Adressat::Nutzer(w.anna)),
        )
        .await;
    assert_eq!(an, vec![w.anna]);

    let e = ereignisse(&lesen(anna_org).await);
    let treffer: Vec<_> = e
        .iter()
        .filter(|(n, _)| n == "org_benachrichtigung")
        .collect();
    assert_eq!(treffer.len(), 1, "{e:?}");
    let data: Value = serde_json::from_str(&treffer[0].1).unwrap();
    assert_eq!(data["art"], "einsatz_aufnahme");
    assert_eq!(data["einsatz_id"], w.einsatz);
    for (wer, resp) in [("bert", bert_org), ("admin", admin_org)] {
        let e = ereignisse(&lesen(resp).await);
        assert!(
            e.iter().all(|(n, _)| n != "org_benachrichtigung"),
            "{wer}: {e:?}"
        );
    }
    let e = ereignisse(&lesen(anna_einsatz).await);
    assert!(
        e.iter().all(|(n, _)| n != "benachrichtigung"),
        "nicht zusätzlich im Einsatz-Strom: {e:?}"
    );
}

// ───────────────────────── Routen ─────────────────────────

/// GET liefert den Text aus dem Bezug, Fremde bekommen 404; quittieren ist 204, schickt das
/// Ereignis mit `quittiert: true` an die eigenen Verbindungen und ist idempotent.
#[tokio::test]
async fn lesen_liste_und_quittieren() {
    let w = welt().await;
    let anna = w.cookie("annika").await;
    let bert = w.cookie("bertram").await;
    let (auftrag, lfd) = w.auftrag().await;
    w.melden(
        w.anlass(Art::AuftragErteilt, Typ::Auftrag, auftrag)
            .an(Adressat::Nutzer(w.anna)),
    )
    .await;
    let id: i64 = sqlx::query_scalar("SELECT id FROM benachrichtigung")
        .fetch_one(&w.pool)
        .await
        .unwrap();
    let pfad = format!("/api/benachrichtigungen/{id}");

    let (s, v) = anfrage(&w.app, "GET", &pfad, &anna, None).await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert_eq!(v["titel"], "Neuer Auftrag");
    assert_eq!(v["detail"], format!("Auftrag #{lfd}"));
    assert_eq!(
        v["pfad"],
        format!("/einsaetze/{}/auftraege?auftrag={auftrag}", w.einsatz)
    );
    assert_eq!(v["stufe"], "hinweis");
    assert!(!v.as_object().unwrap().contains_key("quittiert_at"));
    assert!(
        !v.to_string().contains("Sandsäcke"),
        "kein Freitext des Bezugs: {v}"
    );

    for (methode, uri) in [
        ("GET", pfad.clone()),
        ("POST", format!("{pfad}/quittieren")),
    ] {
        let (s, _) = anfrage(&w.app, methode, &uri, &bert, None).await;
        assert_eq!(s, StatusCode::NOT_FOUND, "fremd: {methode} {uri}");
    }
    let (s, _) = anfrage(&w.app, "GET", "/api/benachrichtigungen/999999", &anna, None).await;
    assert_eq!(s, StatusCode::NOT_FOUND);
    let (s, v) = anfrage(&w.app, "GET", "/api/benachrichtigungen", &bert, None).await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(v, json!([]));

    let (s, v) = anfrage(
        &w.app,
        "GET",
        "/api/benachrichtigungen?offen=true",
        &anna,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(v.as_array().unwrap().len(), 1, "{v}");
    assert_eq!(v[0]["id"], id);

    let feed = format!("/api/einsaetze/{}/live", w.einsatz);
    let zweiter_tab = oeffnen(&w.app, &feed, &anna, None).await;
    let (s, _) = anfrage(&w.app, "POST", &format!("{pfad}/quittieren"), &anna, None).await;
    assert_eq!(s, StatusCode::NO_CONTENT);
    let (s, _) = anfrage(&w.app, "POST", &format!("{pfad}/quittieren"), &anna, None).await;
    assert_eq!(s, StatusCode::NO_CONTENT, "idempotent");
    let e = ereignisse(&lesen(zweiter_tab).await);
    let quittungen: Vec<Value> = e
        .iter()
        .filter(|(n, _)| n == "benachrichtigung")
        .map(|(_, d)| serde_json::from_str(d).unwrap())
        .collect();
    assert_eq!(quittungen.len(), 1, "genau eine Quittung: {e:?}");
    assert_eq!(quittungen[0]["quittiert"], true);
    assert_eq!(quittungen[0]["benachrichtigung_id"], id);

    let (_, v) = anfrage(
        &w.app,
        "GET",
        "/api/benachrichtigungen?offen=true",
        &anna,
        None,
    )
    .await;
    assert_eq!(v, json!([]));
    let (_, v) = anfrage(
        &w.app,
        "GET",
        &format!("/api/benachrichtigungen?einsatz_id={}", w.einsatz),
        &anna,
        None,
    )
    .await;
    assert_eq!(v.as_array().unwrap().len(), 1, "{v}");
    assert!(v[0]["quittiert_at"].is_string());
}

/// Das Modulrecht gilt beim Lesen erneut: wer es seit dem Melden verloren hat, bekommt 404 und
/// sieht die Benachrichtigung nicht in der Liste.
#[tokio::test]
async fn verlorenes_modulrecht_macht_die_benachrichtigung_unlesbar() {
    let w = welt().await;
    let anna = w.cookie("annika").await;
    w.melden(
        w.anlass(Art::AuftragErteilt, Typ::Auftrag, 1)
            .an(Adressat::Nutzer(w.anna)),
    )
    .await;
    let id: i64 = sqlx::query_scalar("SELECT id FROM benachrichtigung")
        .fetch_one(&w.pool)
        .await
        .unwrap();
    let pfad = format!("/api/benachrichtigungen/{id}");
    let (s, _) = anfrage(&w.app, "GET", &pfad, &anna, None).await;
    assert_eq!(s, StatusCode::OK);

    w.modul_nur_fuer_admins("auftraege").await;
    let (s, _) = anfrage(&w.app, "GET", &pfad, &anna, None).await;
    assert_eq!(s, StatusCode::NOT_FOUND);
    let (_, v) = anfrage(&w.app, "GET", "/api/benachrichtigungen", &anna, None).await;
    assert_eq!(v, json!([]));
}

/// Wer aus dem Einsatz entfernt wird, liest seine Benachrichtigungen daraus nicht mehr.
#[tokio::test]
async fn entferntes_mitglied_liest_nichts_mehr() {
    let w = welt().await;
    let anna = w.cookie("annika").await;
    w.melden(
        w.anlass(Art::Meldung, Typ::Meldung, 1)
            .an(Adressat::Nutzer(w.anna)),
    )
    .await;
    let id: i64 = sqlx::query_scalar("SELECT id FROM benachrichtigung")
        .fetch_one(&w.pool)
        .await
        .unwrap();
    sqlx::query("DELETE FROM einsatz_mitgliedschaft WHERE benutzer_id = ?")
        .bind(w.anna)
        .execute(&w.pool)
        .await
        .unwrap();
    let (s, _) = anfrage(
        &w.app,
        "GET",
        &format!("/api/benachrichtigungen/{id}"),
        &anna,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn pfad_id_und_filter_sind_validiert() {
    let w = welt().await;
    let anna = w.cookie("annika").await;
    let (s, v) = anfrage(&w.app, "GET", "/api/benachrichtigungen/abc", &anna, None).await;
    assert_eq!(s, StatusCode::BAD_REQUEST, "{v}");
    assert!(v["error"].is_string(), "{v}");
    let (s, _) = anfrage(&w.app, "GET", "/api/benachrichtigungen", "", None).await;
    assert_eq!(s, StatusCode::UNAUTHORIZED);
}

// ───────────────────────── Benachrichtigungszentrale (LLH-1143) ─────────────────────────

impl Welt {
    async fn verlauf(&self, cookie: &str) -> (StatusCode, Value) {
        anfrage(
            &self.app,
            "GET",
            &format!("/api/einsaetze/{}/benachrichtigungen", self.einsatz),
            cookie,
            None,
        )
        .await
    }

    async fn gelesen(&self, cookie: &str, body: &str) -> (StatusCode, Value) {
        anfrage(
            &self.app,
            "POST",
            &format!("/api/einsaetze/{}/benachrichtigungen/gelesen", self.einsatz),
            cookie,
            Some(body),
        )
        .await
    }

    /// `(stufe, quittiert)` der Zeilen eines Nutzers, nach id.
    async fn zeilen_von(&self, benutzer_id: i64) -> Vec<(String, bool)> {
        sqlx::query_as::<_, (String, bool)>(
            "SELECT stufe, quittiert_at IS NOT NULL FROM benachrichtigung \
             WHERE benutzer_id = ? ORDER BY id",
        )
        .bind(benutzer_id)
        .fetch_all(&self.pool)
        .await
        .unwrap()
    }
}

/// design.md D2: eine abgeschaltete Art erzeugt eine Zeile der Stufe still, schon gelesen. Sie
/// steht im Verlauf, zählt nicht, kommt nicht ins Nachreichen; `melden` nennt nur die Lauten.
#[tokio::test]
async fn abgeschaltete_art_steht_still_im_verlauf_und_zaehlt_nicht() {
    let w = welt().await;
    let anna = w.cookie("annika").await;
    let (s, v) = anfrage(
        &w.app,
        "PUT",
        "/api/benutzer-einstellungen/benachrichtigungen_aus",
        &anna,
        Some(r#"{"wert":"[\"auftrag_erteilt\"]"}"#),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    let feed = format!("/api/einsaetze/{}/live", w.einsatz);
    let anna_live = oeffnen(&w.app, &feed, &anna, None).await;
    let (auftrag, _) = w.auftrag().await;

    let an = w
        .melden(
            w.anlass(Art::AuftragErteilt, Typ::Auftrag, auftrag)
                .an(Adressat::Nutzer(w.anna))
                .an(Adressat::Nutzer(w.bert)),
        )
        .await;
    assert_eq!(an, vec![w.bert], "benachrichtigt ist nur Bert");
    assert_eq!(w.zeilen_von(w.anna).await, vec![("still".into(), true)]);
    assert_eq!(w.zeilen_von(w.bert).await, vec![("hinweis".into(), false)]);

    let (s, v) = w.verlauf(&anna).await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert_eq!(v["ungelesen"], 0, "{v}");
    let eintraege = v["eintraege"].as_array().unwrap();
    assert_eq!(eintraege.len(), 1, "{v}");
    assert_eq!(eintraege[0]["stufe"], "still");
    assert_eq!(eintraege[0]["titel"], "Neuer Auftrag");
    assert!(eintraege[0]["quittiert_at"].is_string());

    let (_, v) = anfrage(
        &w.app,
        "GET",
        "/api/benachrichtigungen?offen=true",
        &anna,
        None,
    )
    .await;
    assert_eq!(v, json!([]), "still wird nicht nachgereicht");

    // Live geht sie hinaus, damit ein offener Verlauf mitläuft — als still.
    let e = ereignisse(&lesen(anna_live).await);
    let still: Vec<Value> = e
        .iter()
        .filter(|(n, _)| n == "benachrichtigung")
        .map(|(_, d)| serde_json::from_str(d).unwrap())
        .collect();
    assert_eq!(still.len(), 1, "{e:?}");
    assert_eq!(still[0]["stufe"], "still");
}

/// design.md D3: der Verlauf nennt die eigenen Benachrichtigungen des Einsatzes, jüngste zuerst,
/// und zählt die ungelesenen Eingänge — keine Alarme, keine gelesenen, nichts Fremdes.
#[tokio::test]
async fn verlauf_zaehlt_ungelesene_eingaenge_ohne_alarme() {
    let w = welt().await;
    let anna = w.cookie("annika").await;
    let bert = w.cookie("bertram").await;
    let (a1, _) = w.auftrag().await;
    let (a2, _) = w.auftrag().await;
    for anlass in [
        w.anlass(Art::AuftragErteilt, Typ::Auftrag, a1),
        w.anlass(Art::AuftragErteilt, Typ::Auftrag, a2),
        w.anlass(Art::AuftragUeberfaellig, Typ::Auftrag, a1),
    ] {
        w.melden(anlass.an(Adressat::Nutzer(w.anna))).await;
    }
    let (s, v) = w.verlauf(&anna).await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert_eq!(
        v["ungelesen"], 2,
        "zwei Eingänge, der Alarm zählt nicht: {v}"
    );
    let stufen: Vec<&str> = v["eintraege"]
        .as_array()
        .unwrap()
        .iter()
        .map(|e| e["stufe"].as_str().unwrap())
        .collect();
    assert_eq!(stufen, ["alarm", "hinweis", "hinweis"], "jüngste zuerst");

    let (s, v) = w.verlauf(&bert).await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(v, json!({ "eintraege": [], "ungelesen": 0 }));

    // Nur wer den Einsatz lesen darf: die Tür des Einsatzes (`EinsatzLesezugriff`) wie jede
    // Einsatzroute, für ein Org-Mitglied ohne Mitgliedschaft 403.
    benutzer_anlegen(&w.app, &w.admin, "fremdling", "keine").await;
    let fremd = w.cookie("fremdling").await;
    let (s, _) = w.verlauf(&fremd).await;
    assert_eq!(s, StatusCode::FORBIDDEN);
}

/// Das Modulrecht am Bezug gilt auch im Verlauf: ohne Recht weder Eintrag noch Zählung.
#[tokio::test]
async fn verlauf_prueft_das_modulrecht_am_bezug() {
    let w = welt().await;
    let anna = w.cookie("annika").await;
    w.melden(
        w.anlass(Art::AuftragErteilt, Typ::Auftrag, 1)
            .an(Adressat::Nutzer(w.anna)),
    )
    .await;
    w.modul_nur_fuer_admins("auftraege").await;
    let (s, v) = w.verlauf(&anna).await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(v, json!({ "eintraege": [], "ungelesen": 0 }));
}

/// design.md D4: „alle gelesen“ quittiert die eigenen Eingänge bis zur Kennung, nie einen Alarm,
/// nie eine fremde Zeile, und meldet es den anderen Tabs mit EINEM Ereignis samt `gelesen_bis`.
#[tokio::test]
async fn alle_gelesen_quittiert_eingaenge_nicht_alarme_und_meldet_einmal() {
    let w = welt().await;
    let anna = w.cookie("annika").await;
    for anlass in [
        w.anlass(Art::AuftragErteilt, Typ::Auftrag, 1),
        w.anlass(Art::Sofortmeldung, Typ::Meldung, 2),
        w.anlass(Art::Befehl, Typ::Befehl, 3),
    ] {
        w.melden(
            anlass
                .an(Adressat::Nutzer(w.anna))
                .an(Adressat::Nutzer(w.bert)),
        )
        .await;
    }
    let bis: i64 = sqlx::query_scalar("SELECT MAX(id) FROM benachrichtigung WHERE benutzer_id = ?")
        .bind(w.anna)
        .fetch_one(&w.pool)
        .await
        .unwrap();
    // Nach `bis` kommt noch einer: er bleibt ungelesen.
    w.melden(
        w.anlass(Art::Gefahr, Typ::Gefahrengebiet, 4)
            .an(Adressat::Nutzer(w.anna)),
    )
    .await;

    let feed = format!("/api/einsaetze/{}/live", w.einsatz);
    let zweiter_tab = oeffnen(&w.app, &feed, &anna, None).await;
    let (s, v) = w
        .gelesen(&anna, &json!({ "bis_id": bis }).to_string())
        .await;
    assert_eq!(s, StatusCode::NO_CONTENT, "{v}");
    assert_eq!(
        w.zeilen_von(w.anna).await,
        vec![
            ("hinweis".into(), true),
            ("alarm".into(), false),
            ("hinweis".into(), true),
            ("hinweis".into(), false),
        ]
    );
    assert!(
        w.zeilen_von(w.bert).await.iter().all(|(_, q)| !q),
        "Berts Zeilen bleiben ungelesen"
    );
    let e = ereignisse(&lesen(zweiter_tab).await);
    let gelesen: Vec<Value> = e
        .iter()
        .filter(|(n, _)| n == "benachrichtigung")
        .map(|(_, d)| serde_json::from_str(d).unwrap())
        .collect();
    assert_eq!(gelesen.len(), 1, "ein Ereignis für alle: {e:?}");
    assert_eq!(gelesen[0]["quittiert"], true);
    assert_eq!(gelesen[0]["gelesen_bis"], bis);

    let (_, v) = w.verlauf(&anna).await;
    assert_eq!(v["ungelesen"], 1, "{v}");

    // Noch einmal: nichts mehr zu quittieren, kein Fehler.
    let (s, _) = w
        .gelesen(&anna, &json!({ "bis_id": bis }).to_string())
        .await;
    assert_eq!(s, StatusCode::NO_CONTENT);
}

#[tokio::test]
async fn alle_gelesen_validiert_den_body_und_das_recht() {
    let w = welt().await;
    let anna = w.cookie("annika").await;
    for body in ["{}", r#"{"bis_id":"x"}"#, "kein json"] {
        let (s, v) = w.gelesen(&anna, body).await;
        assert_eq!(s, StatusCode::BAD_REQUEST, "{body}: {v}");
    }
    benutzer_anlegen(&w.app, &w.admin, "fremdling", "keine").await;
    let fremd = w.cookie("fremdling").await;
    let (s, _) = w.gelesen(&fremd, r#"{"bis_id":1}"#).await;
    assert_eq!(
        s,
        StatusCode::FORBIDDEN,
        "Tür des Einsatzes wie beim Verlauf"
    );
}
