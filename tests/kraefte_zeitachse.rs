//! Integrationstests der Kräfte-Zeitachse (LFH-552): Ereignisse aus Statuswechseln über die
//! echten Routen, Katalog-Marke, Nachtrag, Streichung, Rechte und Live-Event.
//!
//! Die Fachlogik (Perioden, Fan-out, Streichkette) prüft `src/zeitachse/repo/tests.rs`; hier
//! zählt, dass die Routen sie in derselben Transaktion auslösen und die Statuscodes stimmen.

use axum::http::StatusCode;
use serde_json::Value;
use std::time::Duration;

mod common;
use common::*;

async fn status_anlegen(app: &axum::Router, admin: &str, katalog: &str, body: &str) -> i64 {
    let (s, json) = anfrage(app, "POST", &format!("/api/{katalog}"), admin, Some(body)).await;
    assert_eq!(s, StatusCode::CREATED, "{katalog}: {json:?}");
    json["id"].as_i64().unwrap()
}

async fn zeitachse(app: &axum::Router, cookie: &str, pfad: &str) -> (StatusCode, Value) {
    anfrage(app, "GET", &format!("{pfad}/zeitachse"), cookie, None).await
}

fn arten(z: &Value) -> Vec<(String, String)> {
    z["ereignisse"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|e| e.get("gestrichen_at").is_none())
        .map(|e| {
            (
                e["art"].as_str().unwrap().to_string(),
                e["quelle"].as_str().unwrap().to_string(),
            )
        })
        .collect()
}

/// Zeitpunkt `stunden` vor der Serveruhr im Drahtformat — feste Uhrzeiten lägen je nach Tag
/// in der Zukunft (422).
fn vor(stunden: i64, minuten: i64) -> String {
    (chrono::Utc::now() - chrono::Duration::hours(stunden) + chrono::Duration::minutes(minuten))
        .format("%Y-%m-%d %H:%M:%S")
        .to_string()
}

fn paar(art: &str, quelle: &str) -> (String, String) {
    (art.into(), quelle.into())
}

struct Welt {
    app: axum::Router,
    admin: String,
    e: i64,
    einheit: i64,
    /// Stamm-Person, der Einheit zugeordnet; bei der Disposition „alarmiert" (Startmarke).
    ep: i64,
}

async fn welt() -> Welt {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let einheit = einheit_bilden(&app, &admin, e, "Florian 1").await;
    let ep = stammpersonal_disponieren(&app, &admin, e, "Anna").await;
    let (s, _) = anfrage(
        &app,
        "PUT",
        &format!("/api/einsaetze/{e}/einheiten/{einheit}/personal/{ep}"),
        &admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::NO_CONTENT);
    Welt {
        app,
        admin,
        e,
        einheit,
        ep,
    }
}

impl Welt {
    fn einheit_pfad(&self) -> String {
        format!("/api/einsaetze/{}/einheiten/{}", self.e, self.einheit)
    }
    fn person_pfad(&self) -> String {
        format!("/api/einsaetze/{}/personal/{}", self.e, self.ep)
    }
    async fn nachtrag(&self, pfad: &str, body: &str) -> (StatusCode, Value) {
        anfrage(
            &self.app,
            "POST",
            &format!("{pfad}/zeitachse"),
            &self.admin,
            Some(body),
        )
        .await
    }
}

// ── Aus Statuswechseln ──────────────────────────────────────────────────────────────────────

/// Die Startliste neuer Organisationen markiert „alarmiert": die Disposition schreibt die
/// Alarmierung, ein Wechsel auf „im Einsatz" das Eintreffen, „Pause" nichts.
#[tokio::test]
async fn personalstatus_schreibt_die_zeitachse() {
    let w = welt().await;
    let (_, z) = zeitachse(&w.app, &w.admin, &w.person_pfad()).await;
    assert_eq!(arten(&z), vec![paar("alarmierung", "status")]);

    let (_, katalog) = anfrage(&w.app, "GET", "/api/personal-status", &w.admin, None).await;
    let id_von = |label: &str| {
        katalog
            .as_array()
            .unwrap()
            .iter()
            .find(|s| s["label"] == label)
            .unwrap()["id"]
            .as_i64()
            .unwrap()
    };
    assert_eq!(
        katalog
            .as_array()
            .unwrap()
            .iter()
            .find(|s| s["label"] == "im Einsatz")
            .unwrap()["zeitachse_marke"],
        "eintreffen"
    );
    for label in ["im Einsatz", "Pause"] {
        let (s, _) = anfrage(
            &w.app,
            "PATCH",
            &w.person_pfad(),
            &w.admin,
            Some(&format!(r#"{{"status_id":{}}}"#, id_von(label))),
        )
        .await;
        assert_eq!(s, StatusCode::OK);
    }
    let (_, z) = zeitachse(&w.app, &w.admin, &w.person_pfad()).await;
    assert_eq!(
        arten(&z),
        vec![paar("alarmierung", "status"), paar("eintreffen", "status")]
    );
    assert_eq!(z["perioden"][0]["anker"], "alarmierung");

    // Zurück auf „alarmiert": der Status gelingt, die Zeitachse bleibt (Spec „Unpassendes
    // Ereignis bricht den Status nicht").
    let (s, _) = anfrage(
        &w.app,
        "PATCH",
        &w.person_pfad(),
        &w.admin,
        Some(&format!(r#"{{"status_id":{}}}"#, id_von("alarmiert"))),
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    let (_, z) = zeitachse(&w.app, &w.admin, &w.person_pfad()).await;
    assert_eq!(arten(&z).len(), 2);
}

/// Fahrzeug einer Einheit auf einen markierten Status: Einheit + Fan-out auf ihre Person.
#[tokio::test]
async fn fahrzeugstatus_wirkt_ueber_die_einheit() {
    let w = welt().await;
    let am_ort = status_anlegen(
        &w.app,
        &w.admin,
        "fahrzeug-status",
        r#"{"label":"am Einsatzort","kategorie":"gebunden","sortier":999,"zeitachse_marke":"eintreffen"}"#,
    )
    .await;
    let (s, fz) = anfrage(
        &w.app,
        "POST",
        &format!("/api/einsaetze/{}/fahrzeuge", w.e),
        &w.admin,
        Some(r#"{"adhoc":{"funkrufname":"HLF 1"}}"#),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED);
    let ef = fz["id"].as_i64().unwrap();
    let (s, _) = anfrage(
        &w.app,
        "PUT",
        &format!(
            "/api/einsaetze/{}/einheiten/{}/fahrzeug/{ef}",
            w.e, w.einheit
        ),
        &w.admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::NO_CONTENT);
    let (s, _) = anfrage(
        &w.app,
        "PATCH",
        &format!("/api/einsaetze/{}/fahrzeuge/{ef}", w.e),
        &w.admin,
        Some(&format!(r#"{{"status_id":{am_ort}}}"#)),
    )
    .await;
    assert_eq!(s, StatusCode::OK);

    let (_, z) = zeitachse(&w.app, &w.admin, &w.einheit_pfad()).await;
    assert_eq!(arten(&z), vec![paar("eintreffen", "status")]);
    let (_, z) = zeitachse(&w.app, &w.admin, &w.person_pfad()).await;
    assert_eq!(
        arten(&z),
        vec![paar("alarmierung", "status"), paar("eintreffen", "einheit")]
    );
    let ereignis = &z["ereignisse"][1];
    assert_eq!(ereignis["ursprung_einheit_name"], "Florian 1");

    // Liste fürs Meldebild
    let (s, liste) = anfrage(
        &w.app,
        "GET",
        &format!("/api/einsaetze/{}/einheiten/zeitachse", w.e),
        &w.admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(liste[0]["einheit_id"], w.einheit);
    assert_eq!(liste[0]["perioden"][0]["anker"], "eintreffen");
}

#[tokio::test]
async fn handstatus_der_einheit_schreibt_die_zeitachse() {
    let w = welt().await;
    let alarm = status_anlegen(
        &w.app,
        &w.admin,
        "fahrzeug-status",
        r#"{"label":"Einheit alarmiert","kategorie":"gebunden","zeitachse_marke":"alarmierung"}"#,
    )
    .await;
    let (s, _) = anfrage(
        &w.app,
        "PUT",
        &format!("{}/status", w.einheit_pfad()),
        &w.admin,
        Some(&format!(r#"{{"status_id":{alarm}}}"#)),
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    let (_, z) = zeitachse(&w.app, &w.admin, &w.einheit_pfad()).await;
    assert_eq!(arten(&z), vec![paar("alarmierung", "status")]);
}

// ── Katalog ─────────────────────────────────────────────────────────────────────────────────

/// Spec „Unbekannte Marke" für beide Kataloge, Anlegen und Ändern; `null` entfernt die Marke.
#[tokio::test]
async fn katalog_marke_setzen_pruefen_entfernen() {
    let w = welt().await;
    for katalog in ["personal-status", "fahrzeug-status"] {
        let (s, _) = anfrage(
            &w.app,
            "POST",
            &format!("/api/{katalog}"),
            &w.admin,
            Some(r#"{"label":"X","kategorie":"gebunden","zeitachse_marke":"pause"}"#),
        )
        .await;
        assert_eq!(s, StatusCode::BAD_REQUEST, "{katalog}");
        let id = status_anlegen(
            &w.app,
            &w.admin,
            katalog,
            r#"{"label":"Y","kategorie":"gebunden","zeitachse_marke":"entlassung"}"#,
        )
        .await;
        let pfad = format!("/api/{katalog}/{id}");
        let (s, _) = anfrage(
            &w.app,
            "PATCH",
            &pfad,
            &w.admin,
            Some(r#"{"zeitachse_marke":"abloesung"}"#),
        )
        .await;
        assert_eq!(s, StatusCode::BAD_REQUEST, "abloesung ist keine Marke");
        let (s, json) = anfrage(&w.app, "PATCH", &pfad, &w.admin, Some(r#"{"label":"Y2"}"#)).await;
        assert_eq!(s, StatusCode::OK);
        assert_eq!(json["zeitachse_marke"], "entlassung", "unberührt");
        let (s, json) = anfrage(
            &w.app,
            "PATCH",
            &pfad,
            &w.admin,
            Some(r#"{"zeitachse_marke":null}"#),
        )
        .await;
        assert_eq!(s, StatusCode::OK);
        assert!(json.get("zeitachse_marke").is_none(), "{json:?}");
    }
}

// ── Nachtrag ────────────────────────────────────────────────────────────────────────────────

/// Spec „Eintreffen nachtragen": 201, Notiz getrimmt, ISO-Eingabe normalisiert, ETB
/// „… eingetroffen … (nachgetragen)".
#[tokio::test]
async fn nachtrag_an_der_einheit() {
    let w = welt().await;
    let zeit = chrono::Utc::now() - chrono::Duration::hours(8);
    let (s, z) = w
        .nachtrag(
            &w.einheit_pfad(),
            &format!(
                r#"{{"art":"eintreffen","zeitpunkt_at":"{}","notiz":" per Funk "}}"#,
                zeit.format("%Y-%m-%dT%H:%M:%SZ")
            ),
        )
        .await;
    assert_eq!(s, StatusCode::CREATED, "{z:?}");
    assert_eq!(arten(&z), vec![paar("eintreffen", "nachtrag")]);
    assert_eq!(z["ereignisse"][0]["notiz"], "per Funk");
    assert_eq!(
        z["ereignisse"][0]["zeitpunkt_at"],
        zeit.format("%Y-%m-%d %H:%M:%S").to_string()
    );
    let etb = system_etb_inhalte(&w.app, &w.admin, w.e).await;
    assert!(
        etb.iter()
            .any(|t| t.contains("Einheit «Florian 1» eingetroffen") && t.contains("(nachgetragen)")),
        "{etb:?}"
    );
}

#[tokio::test]
async fn nachtrag_statuscodes() {
    let w = welt().await;
    let pfad = w.einheit_pfad();
    // 400: Art fehlt, unbekannt, abloesung; Zeitpunkt fehlt/unlesbar.
    let z = vor(8, 0);
    for body in [
        format!(r#"{{"zeitpunkt_at":"{z}"}}"#),
        format!(r#"{{"art":"pause","zeitpunkt_at":"{z}"}}"#),
        format!(r#"{{"art":"abloesung","zeitpunkt_at":"{z}"}}"#),
        r#"{"art":"eintreffen","zeitpunkt_at":""}"#.to_string(),
        r#"{"art":"eintreffen","zeitpunkt_at":"gestern"}"#.to_string(),
    ] {
        let (s, _) = w.nachtrag(&pfad, &body).await;
        assert_eq!(s, StatusCode::BAD_REQUEST, "{body}");
    }
    // 422: Zukunft (Spec „Zukunft").
    let zukunft = chrono::Utc::now() + chrono::Duration::hours(1);
    let (s, _) = w
        .nachtrag(
            &pfad,
            &format!(
                r#"{{"art":"eintreffen","zeitpunkt_at":"{}"}}"#,
                zukunft.format("%Y-%m-%d %H:%M:%S")
            ),
        )
        .await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY);
    // 422: doppeltes Eintreffen (Spec „Doppeltes Eintreffen"), und nichts geschrieben.
    let eins = format!(r#"{{"art":"eintreffen","zeitpunkt_at":"{}"}}"#, vor(8, 0));
    let eins = eins.as_str();
    assert_eq!(w.nachtrag(&pfad, eins).await.0, StatusCode::CREATED);
    let (s, _) = w
        .nachtrag(
            &pfad,
            &format!(r#"{{"art":"eintreffen","zeitpunkt_at":"{}"}}"#, vor(8, 15)),
        )
        .await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY);
    let (_, z) = zeitachse(&w.app, &w.admin, &pfad).await;
    assert_eq!(arten(&z).len(), 1);
    // 404: Kraft eines anderen Einsatzes (Spec „Kraft eines anderen Einsatzes").
    let anderer = einsatz_anlegen_mit(&w.app, &w.admin, "Anderswo").await;
    let fremd = einheit_bilden(&w.app, &w.admin, anderer, "Fremd").await;
    let (s, _) = w
        .nachtrag(&format!("/api/einsaetze/{}/einheiten/{fremd}", w.e), eins)
        .await;
    assert_eq!(s, StatusCode::NOT_FOUND);
}

// ── Streichung ──────────────────────────────────────────────────────────────────────────────

#[tokio::test]
async fn streichung_mit_grund_und_statuscodes() {
    let w = welt().await;
    let (_, z) = w
        .nachtrag(
            &w.einheit_pfad(),
            &format!(r#"{{"art":"eintreffen","zeitpunkt_at":"{}"}}"#, vor(8, 0)),
        )
        .await;
    let zid = z["ereignisse"][0]["id"].as_i64().unwrap();
    let streich = format!("{}/zeitachse/{zid}/streichen", w.einheit_pfad());
    // Spec „Grund fehlt"
    let (s, _) = anfrage(
        &w.app,
        "POST",
        &streich,
        &w.admin,
        Some(r#"{"grund":"  "}"#),
    )
    .await;
    assert_eq!(s, StatusCode::BAD_REQUEST);
    // Fremde Kraft im Pfad → 404
    let (s, _) = anfrage(
        &w.app,
        "POST",
        &format!("{}/zeitachse/{zid}/streichen", w.person_pfad()),
        &w.admin,
        Some(r#"{"grund":"x"}"#),
    )
    .await;
    assert_eq!(s, StatusCode::NOT_FOUND);
    // Spec „Falsches Eintreffen streichen"
    let (s, z) = anfrage(
        &w.app,
        "POST",
        &streich,
        &w.admin,
        Some(r#"{"grund":"Zeit verwechselt"}"#),
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(z["ereignisse"][0]["streichgrund"], "Zeit verwechselt");
    assert!(arten(&z).is_empty());
    let etb = system_etb_inhalte(&w.app, &w.admin, w.e).await;
    assert!(
        etb.iter()
            .any(|t| t.contains("gestrichen") && t.contains("Zeit verwechselt")),
        "{etb:?}"
    );
    // Spec „Doppelt gestrichen"
    let (s, _) = anfrage(&w.app, "POST", &streich, &w.admin, Some(r#"{"grund":"x"}"#)).await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY);
}

// ── Rechte ──────────────────────────────────────────────────────────────────────────────────

/// Spec „Beobachter liest", „Beobachter trägt nach", „Personal ausgeblendet".
#[tokio::test]
async fn rechte_und_modulsperre() {
    let w = welt().await;
    let bid = benutzer_anlegen(&w.app, &w.admin, "beatrix", "keine").await;
    rolle_setzen(&w.app, &w.admin, w.e, bid, "beobachter").await;
    let bea = login_cookie(&w.app, "beatrix", "beatrixpw1").await;

    let (s, _) = zeitachse(&w.app, &bea, &w.einheit_pfad()).await;
    assert_eq!(s, StatusCode::OK);
    let (s, _) = anfrage(
        &w.app,
        "POST",
        &format!("{}/zeitachse", w.einheit_pfad()),
        &bea,
        Some(&format!(
            r#"{{"art":"eintreffen","zeitpunkt_at":"{}"}}"#,
            vor(8, 0)
        )),
    )
    .await;
    assert_eq!(s, StatusCode::FORBIDDEN);

    let (s, _) = anfrage(
        &w.app,
        "PUT",
        &format!("/api/einsaetze/{}/modul-overrides/personal", w.e),
        &w.admin,
        Some(r#"{"sichtbar":false,"benoetigte_rolle":null}"#),
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    let (s, _) = zeitachse(&w.app, &bea, &w.person_pfad()).await;
    assert_eq!(s, StatusCode::FORBIDDEN);
    let (s, _) = anfrage(
        &w.app,
        "GET",
        &format!("/api/einsaetze/{}/personal/zeitachse", w.e),
        &bea,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::FORBIDDEN);
}

// ── Live (Task 5.2) ─────────────────────────────────────────────────────────────────────────

/// Ein Nachtrag an der Einheit sendet `einheit` und — für die per Fan-out berührte Person —
/// `personal`, damit auch reine Personal-Leser neu laden.
#[tokio::test]
async fn nachtrag_sendet_live_events() {
    let (app, live) = setup_mit_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let einheit = einheit_bilden(&app, &admin, e, "Florian 1").await;
    let ep = stammpersonal_disponieren(&app, &admin, e, "Anna").await;
    anfrage(
        &app,
        "PUT",
        &format!("/api/einsaetze/{e}/einheiten/{einheit}/personal/{ep}"),
        &admin,
        None,
    )
    .await;
    // Die Disposition alarmiert heute; das Eintreffen jetzt passt dahinter.
    let jetzt = chrono::Utc::now().format("%Y-%m-%d %H:%M:%S").to_string();
    let mut rx = live.abonniere(e);
    let (s, _) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{e}/einheiten/{einheit}/zeitachse"),
        &admin,
        Some(&format!(
            r#"{{"art":"eintreffen","zeitpunkt_at":"{jetzt}"}}"#
        )),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED);
    recv_until_tag(&mut rx, "einheit", Duration::from_secs(2)).await;
    let n = recv_until_tag(&mut rx, "personal", Duration::from_secs(2)).await;
    assert!(n.data.contains(&ep.to_string()), "{}", n.data);
}
