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
    welt_in(setup().await).await
}

async fn welt_in(app: axum::Router) -> Welt {
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

/// LLH-1443: der Nachtrag nennt den Zeitpunkt in der Zone des Einsatzes, nicht in der der
/// Organisation (Tokio statt New York).
#[tokio::test]
async fn nachtrag_nennt_die_ortszeit_des_einsatzes_nicht_der_organisation() {
    use lifeline_hub::zeitdarstellung::{Zeitdarstellung, Zeitstil};
    let (app, pool) = setup_mit_pool().await;
    let w = welt_in(app).await;
    sqlx::query(
        "INSERT INTO org_einstellungen (org_id, zeitzone) VALUES (1, 'America/New_York') \
         ON CONFLICT (org_id) DO UPDATE SET zeitzone = excluded.zeitzone",
    )
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query(
        "INSERT INTO einsatz_einstellungen (einsatz_id, zeitzone) VALUES (?, 'Asia/Tokyo') \
         ON CONFLICT (einsatz_id) DO UPDATE SET zeitzone = excluded.zeitzone",
    )
    .bind(w.e)
    .execute(&pool)
    .await
    .unwrap();
    let zeit = chrono::Utc::now() - chrono::Duration::hours(8);
    let (s, z) = w
        .nachtrag(
            &w.einheit_pfad(),
            &format!(
                r#"{{"art":"eintreffen","zeitpunkt_at":"{}"}}"#,
                zeit.format("%Y-%m-%dT%H:%M:%SZ")
            ),
        )
        .await;
    assert_eq!(s, StatusCode::CREATED, "{z:?}");
    let dtg = |zone| Zeitstil::new(zone, Zeitdarstellung::Taktisch).zeitpunkt(zeit);
    let tokio = dtg(chrono_tz::Asia::Tokyo);
    assert_ne!(tokio, dtg(chrono_tz::America::New_York));
    let etb = system_etb_inhalte(&w.app, &w.admin, w.e).await;
    assert!(
        etb.iter()
            .any(|t| t.contains("Einheit «Florian 1» eingetroffen") && t.contains(&tokio)),
        "{tokio} in {etb:?}"
    );
}

/// LLH-1541: die 422 des Nachtrags nennt den Zeitpunkt in Zone und Darstellung des Einsatzes
/// (Tokio, „Datum und Uhrzeit“), nicht der Organisation (New York, taktisch) und nicht im
/// UTC-Drahtformat mit Sekunden.
#[tokio::test]
async fn nachtrag_422_nennt_den_zeitpunkt_im_zeitstil_des_einsatzes() {
    let (app, pool) = setup_mit_pool().await;
    let w = welt_in(app).await;
    sqlx::query(
        "INSERT INTO org_einstellungen (org_id, zeitzone, zeitdarstellung) \
         VALUES (1, 'America/New_York', 'taktisch') ON CONFLICT (org_id) DO UPDATE SET \
         zeitzone = excluded.zeitzone, zeitdarstellung = excluded.zeitdarstellung",
    )
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query(
        "INSERT INTO einsatz_einstellungen (einsatz_id, zeitzone, zeitdarstellung) \
         VALUES (?, 'Asia/Tokyo', 'datum_uhrzeit') ON CONFLICT (einsatz_id) DO UPDATE SET \
         zeitzone = excluded.zeitzone, zeitdarstellung = excluded.zeitdarstellung",
    )
    .bind(w.e)
    .execute(&pool)
    .await
    .unwrap();
    let pfad = w.einheit_pfad();
    let eins = format!(r#"{{"art":"eintreffen","zeitpunkt_at":"{}"}}"#, vor(8, 0));
    assert_eq!(w.nachtrag(&pfad, &eins).await.0, StatusCode::CREATED);
    let zweites = vor(8, 15);
    let (s, json) = w
        .nachtrag(
            &pfad,
            &format!(r#"{{"art":"eintreffen","zeitpunkt_at":"{zweites}"}}"#),
        )
        .await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY, "{json:?}");
    let tokio = chrono::NaiveDateTime::parse_from_str(&zweites, "%Y-%m-%d %H:%M:%S")
        .unwrap()
        .and_utc()
        .with_timezone(&chrono_tz::Asia::Tokyo)
        .format("%d.%m.%y %H:%M")
        .to_string();
    assert_eq!(
        json["error"].as_str(),
        Some(format!("Die Einsatzperiode trägt schon ein Eintreffen ({tokio})").as_str()),
        "{json:?}"
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
    // 400 vor 422: zu lange Notiz, auch bei einem Zeitpunkt in der Zukunft.
    let (s, _) = w
        .nachtrag(
            &pfad,
            &format!(
                r#"{{"art":"eintreffen","zeitpunkt_at":"{}","notiz":"{}"}}"#,
                zukunft.format("%Y-%m-%d %H:%M:%S"),
                "x".repeat(lifeline_hub::zeitachse::NOTIZ_MAX + 1)
            ),
        )
        .await;
    assert_eq!(s, StatusCode::BAD_REQUEST, "Notiz zu lang");
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
    let lang = format!(
        r#"{{"grund":"{}"}}"#,
        "x".repeat(lifeline_hub::zeitachse::GRUND_MAX + 1)
    );
    let (s, _) = anfrage(&w.app, "POST", &streich, &w.admin, Some(&lang)).await;
    assert_eq!(s, StatusCode::BAD_REQUEST, "Grund zu lang");
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
    // Die Berichtigung (LLH-1455) verlangt dasselbe Schreibrecht.
    let (_, z) = zeitachse(&w.app, &w.admin, &w.person_pfad()).await;
    let alarmierung = ereignis_id(&z, "alarmierung");
    let (s, _) = anfrage(
        &w.app,
        "POST",
        &format!("{}/zeitachse/{alarmierung}/berichtigen", w.person_pfad()),
        &bea,
        Some(&format!(
            r#"{{"zeitpunkt_at":"{}","grund":"x"}}"#,
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

// ── Grenzwerte (LLH-730) ────────────────────────────────────────────────────────────────────

async fn grenzwerte(w: &Welt, cookie: &str, modul: &str) -> (StatusCode, Value) {
    anfrage(
        &w.app,
        "GET",
        &format!("/api/einsaetze/{}/{modul}/zeitachse/grenzwerte", w.e),
        cookie,
        None,
    )
    .await
}

async fn modul_sichtbar(w: &Welt, modul: &str, sichtbar: bool) {
    let (s, _) = anfrage(
        &w.app,
        "PUT",
        &format!("/api/einsaetze/{}/modul-overrides/{modul}", w.e),
        &w.admin,
        Some(&format!(
            r#"{{"sichtbar":{sichtbar},"benoetigte_rolle":null}}"#
        )),
    )
    .await;
    assert_eq!(s, StatusCode::OK);
}

/// Die Einstufung des Ist liest dieselben wirksamen Grenzwerte wie der Plan: ohne eigenen Wert
/// die Vorgaben, sonst den Wert des Schichtplans, unter Einheiten und Personal, ohne das Modul
/// Ablösung (Spec `kraefte-zeitachse`, „Grenzwerte lesen“).
#[tokio::test]
async fn grenzwerte_lesen_ohne_modul_abloesung() {
    let w = welt().await;
    let bid = benutzer_anlegen(&w.app, &w.admin, "beatrix", "keine").await;
    rolle_setzen(&w.app, &w.admin, w.e, bid, "beobachter").await;
    let bea = login_cookie(&w.app, "beatrix", "beatrixpw1").await;

    for modul in ["einheiten", "personal"] {
        let (s, g) = grenzwerte(&w, &bea, modul).await;
        assert_eq!(s, StatusCode::OK, "{modul}: {g:?}");
        assert_eq!(g["max_dienst_minuten"], 720);
        assert_eq!(g["min_ruhe_minuten"], 480);
        assert_eq!(g["max_dienst_eigen"], false);
        assert_eq!(g["min_ruhe_eigen"], false);
    }

    let (s, _) = anfrage(
        &w.app,
        "PATCH",
        &format!("/api/einsaetze/{}/abloesungen/schichtplan/grenzwerte", w.e),
        &w.admin,
        Some(r#"{"max_dienst_minuten":360}"#),
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    modul_sichtbar(&w, "abloesung", false).await;

    let (s, g) = grenzwerte(&w, &bea, "einheiten").await;
    assert_eq!(s, StatusCode::OK, "{g:?}");
    assert_eq!(g["max_dienst_minuten"], 360);
    assert_eq!(g["max_dienst_eigen"], true);
    assert_eq!(g["min_ruhe_minuten"], 480);

    modul_sichtbar(&w, "personal", false).await;
    let (s, _) = grenzwerte(&w, &bea, "personal").await;
    assert_eq!(s, StatusCode::FORBIDDEN);
    let (s, _) = grenzwerte(&w, &bea, "einheiten").await;
    assert_eq!(s, StatusCode::OK);
    modul_sichtbar(&w, "einheiten", false).await;
    let (s, _) = grenzwerte(&w, &bea, "einheiten").await;
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

const PERSONAL: &[(&str, &str)] = &[("personal", "personal_id")];

/// Zweite Person der Einheit, die per eigenem Status schon eingetroffen ist: ihre Kopie eines
/// Eintreffens aus dem Fan-out wird ausgelassen, ihre Zeitachse ändert sich also nicht.
async fn schon_eingetroffen_in_einheit(w: &Welt, name: &str) -> i64 {
    let ep = stammpersonal_disponieren(&w.app, &w.admin, w.e, name).await;
    let (s, _) = anfrage(
        &w.app,
        "PUT",
        &format!("{}/personal/{ep}", w.einheit_pfad()),
        &w.admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::NO_CONTENT);
    let (_, katalog) = anfrage(&w.app, "GET", "/api/personal-status", &w.admin, None).await;
    let im_einsatz = katalog
        .as_array()
        .unwrap()
        .iter()
        .find(|s| s["zeitachse_marke"] == "eintreffen")
        .unwrap()["id"]
        .as_i64()
        .unwrap();
    let (s, _) = anfrage(
        &w.app,
        "PATCH",
        &format!("/api/einsaetze/{}/personal/{ep}", w.e),
        &w.admin,
        Some(&format!(r#"{{"status_id":{im_einsatz}}}"#)),
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    ep
}

/// Ein markierter Fahrzeugstatus schreibt per Fan-out die Zeitachse der Personen seiner Einheit;
/// `GET …/personal/{ep}/zeitachse` hängt am Personalrecht, also meldet der Wechsel `personal`
/// genau für diese Personen (LLH-1185). Eine Person außerhalb der Einheit, eine schon
/// eingetroffene Person der Einheit, ein Status ohne Marke und ein zweites Fahrzeug, dessen
/// Eintreffen die Einheit schon trägt, melden nichts.
#[tokio::test]
async fn fahrzeugstatus_meldet_personal_fuer_den_fan_out() {
    let (app, live) = setup_mit_live().await;
    let w = welt_in(app).await;
    let fremd = stammpersonal_disponieren(&w.app, &w.admin, w.e, "Bert").await;
    let eingetroffen = schon_eingetroffen_in_einheit(&w, "Carla").await;
    let am_ort = status_anlegen(
        &w.app,
        &w.admin,
        "fahrzeug-status",
        r#"{"label":"am Einsatzort","kategorie":"gebunden","sortier":999,"zeitachse_marke":"eintreffen"}"#,
    )
    .await;
    let ohne_marke = status_anlegen(
        &w.app,
        &w.admin,
        "fahrzeug-status",
        r#"{"label":"Werkstatt","kategorie":"gebunden","sortier":998}"#,
    )
    .await;
    let mut fahrzeuge = Vec::new();
    for funkrufname in ["HLF 1", "RW 1"] {
        let (s, fz) = anfrage(
            &w.app,
            "POST",
            &format!("/api/einsaetze/{}/fahrzeuge", w.e),
            &w.admin,
            Some(&format!(r#"{{"adhoc":{{"funkrufname":"{funkrufname}"}}}}"#)),
        )
        .await;
        assert_eq!(s, StatusCode::CREATED);
        let ef = fz["id"].as_i64().unwrap();
        let (s, _) = anfrage(
            &w.app,
            "PUT",
            &format!("{}/fahrzeug/{ef}", w.einheit_pfad()),
            &w.admin,
            None,
        )
        .await;
        assert_eq!(s, StatusCode::NO_CONTENT);
        fahrzeuge.push(ef);
    }

    let mut rx = live.abonniere(w.e);
    let patch = |ef: i64, status: i64| {
        let (app, admin, e) = (w.app.clone(), w.admin.clone(), w.e);
        async move {
            anfrage(
                &app,
                "PATCH",
                &format!("/api/einsaetze/{e}/fahrzeuge/{ef}"),
                &admin,
                Some(&format!(r#"{{"status_id":{status}}}"#)),
            )
            .await
            .0
        }
    };

    assert_eq!(patch(fahrzeuge[0], ohne_marke).await, StatusCode::OK);
    assert_eq!(objekt_ereignisse(&mut rx, PERSONAL), vec![], "ohne Marke");
    assert_eq!(patch(fahrzeuge[0], am_ort).await, StatusCode::OK);
    assert_eq!(
        objekt_ereignisse(&mut rx, PERSONAL),
        vec![("personal".to_string(), w.ep)],
        "Fan-out auf die Person der Einheit, nicht auf {fremd} und {eingetroffen}"
    );
    assert_eq!(patch(fahrzeuge[1], am_ort).await, StatusCode::OK);
    assert_eq!(
        objekt_ereignisse(&mut rx, PERSONAL),
        vec![],
        "Einheit trägt das Eintreffen schon"
    );
}

/// Der Handstatus einer Einheit ohne Fahrzeug schreibt denselben Fan-out und meldet ebenso
/// `personal` genau für die Personen der Einheit, deren Zeitachse sich ändert (LLH-1185).
#[tokio::test]
async fn handstatus_meldet_personal_fuer_den_fan_out() {
    let (app, live) = setup_mit_live().await;
    let w = welt_in(app).await;
    let fremd = stammpersonal_disponieren(&w.app, &w.admin, w.e, "Bert").await;
    let eingetroffen = schon_eingetroffen_in_einheit(&w, "Carla").await;
    let am_ort = status_anlegen(
        &w.app,
        &w.admin,
        "fahrzeug-status",
        r#"{"label":"Einheit am Ort","kategorie":"gebunden","zeitachse_marke":"eintreffen"}"#,
    )
    .await;
    let ohne_marke = status_anlegen(
        &w.app,
        &w.admin,
        "fahrzeug-status",
        r#"{"label":"Einheit frei","kategorie":"gebunden"}"#,
    )
    .await;

    let mut rx = live.abonniere(w.e);
    let set = |status: i64| {
        let (app, admin, pfad) = (w.app.clone(), w.admin.clone(), w.einheit_pfad());
        async move {
            anfrage(
                &app,
                "PUT",
                &format!("{pfad}/status"),
                &admin,
                Some(&format!(r#"{{"status_id":{status}}}"#)),
            )
            .await
            .0
        }
    };

    assert_eq!(set(ohne_marke).await, StatusCode::OK);
    assert_eq!(objekt_ereignisse(&mut rx, PERSONAL), vec![], "ohne Marke");
    assert_eq!(set(am_ort).await, StatusCode::OK);
    assert_eq!(
        objekt_ereignisse(&mut rx, PERSONAL),
        vec![("personal".to_string(), w.ep)],
        "Fan-out auf die Person der Einheit, nicht auf {fremd} und {eingetroffen}"
    );
    assert_eq!(set(ohne_marke).await, StatusCode::OK);
    assert_eq!(set(am_ort).await, StatusCode::OK);
    assert_eq!(
        objekt_ereignisse(&mut rx, PERSONAL),
        vec![],
        "Einheit trägt das Eintreffen schon"
    );
}

// ── Ablösung ────────────────────────────────────────────────────────────────────────────────

const EINHEIT_UND_PERSONAL: &[(&str, &str)] =
    &[("einheit", "einheit_id"), ("personal", "personal_id")];

/// Welt für den Vollzug: die Einheit ist eingetroffen (Fan-out auf Anna und Carla), Carla danach
/// per eigenem Status entlassen — ihre Kopie der Ablösung wird ausgelassen. Bert gehört zu keiner
/// Einheit. Liefert `(carla, bert, schicht)`.
async fn abloesung_bereit(w: &Welt) -> (i64, i64, i64) {
    let bert = stammpersonal_disponieren(&w.app, &w.admin, w.e, "Bert").await;
    let carla = stammpersonal_disponieren(&w.app, &w.admin, w.e, "Carla").await;
    let (s, _) = anfrage(
        &w.app,
        "PUT",
        &format!("{}/personal/{carla}", w.einheit_pfad()),
        &w.admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::NO_CONTENT);
    let jetzt = chrono::Utc::now().format("%Y-%m-%d %H:%M:%S").to_string();
    let (s, json) = w
        .nachtrag(
            &w.einheit_pfad(),
            &format!(r#"{{"art":"eintreffen","zeitpunkt_at":"{jetzt}"}}"#),
        )
        .await;
    assert_eq!(s, StatusCode::CREATED, "{json:?}");
    let entlassen = status_anlegen(
        &w.app,
        &w.admin,
        "personal-status",
        r#"{"label":"entlassen","kategorie":"gebunden","zeitachse_marke":"entlassung"}"#,
    )
    .await;
    let (s, _) = anfrage(
        &w.app,
        "PATCH",
        &format!("/api/einsaetze/{}/personal/{carla}", w.e),
        &w.admin,
        Some(&format!(r#"{{"status_id":{entlassen}}}"#)),
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    let (s, schicht) = anfrage(
        &w.app,
        "POST",
        &format!("/api/einsaetze/{}/abloesungen", w.e),
        &w.admin,
        Some(&format!(
            r#"{{"einheit_id":{},"rhythmus_minuten":480}}"#,
            w.einheit
        )),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{schicht:?}");
    (carla, bert, schicht["id"].as_i64().unwrap())
}

async fn vollziehen(w: &Welt, schicht: i64) {
    let (s, json) = anfrage(
        &w.app,
        "POST",
        &format!("/api/einsaetze/{}/abloesungen/{schicht}/vollzug", w.e),
        &w.admin,
        Some("{}"),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{json:?}");
}

/// Schicht einer zweiten Einheit ohne Personen und ohne Zeitachse: ihr Vollzug trifft keine
/// offene Periode.
async fn schicht_ohne_periode(w: &Welt) -> i64 {
    let einheit = einheit_bilden(&w.app, &w.admin, w.e, "Florian 2").await;
    let (s, schicht) = anfrage(
        &w.app,
        "POST",
        &format!("/api/einsaetze/{}/abloesungen", w.e),
        &w.admin,
        Some(&format!(
            r#"{{"einheit_id":{einheit},"beginn_at":"{}","rhythmus_minuten":480}}"#,
            vor(2, 0)
        )),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{schicht:?}");
    schicht["id"].as_i64().unwrap()
}

async fn zuruecknehmen(w: &Welt, schicht: i64) {
    let (s, json) = anfrage(
        &w.app,
        "POST",
        &format!(
            "/api/einsaetze/{}/abloesungen/{schicht}/vollzug/zuruecknehmen",
            w.e
        ),
        &w.admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{json:?}");
}

/// Der Vollzug schreibt die Ablösung an die Einheit und per Fan-out an ihre Personen; Leser
/// nur mit Einheiten- oder Personalrecht erreicht `abloesung` nicht, also meldet er `einheit`
/// und `personal` genau für die Kräfte, deren Zeitachse sich ändert (LLH-1189). Carla (Kopie
/// ausgelassen), Bert (keine Einheit) und ein Vollzug ohne offene Periode melden nichts davon.
#[tokio::test]
async fn vollzug_meldet_einheit_und_personal() {
    let (app, live) = setup_mit_live().await;
    let w = welt_in(app).await;
    let (carla, bert, schicht) = abloesung_bereit(&w).await;
    let ohne = schicht_ohne_periode(&w).await;

    let mut rx = live.abonniere(w.e);
    vollziehen(&w, schicht).await;
    assert_eq!(
        objekt_ereignisse(&mut rx, EINHEIT_UND_PERSONAL),
        vec![
            ("einheit".to_string(), w.einheit),
            ("personal".to_string(), w.ep)
        ],
        "nicht für {carla} (ausgelassen) und {bert}"
    );
    let (_, z) = zeitachse(
        &w.app,
        &w.admin,
        &format!("/api/einsaetze/{}/personal/{carla}", w.e),
    )
    .await;
    assert!(
        !arten(&z).contains(&paar("abloesung", "einheit")),
        "Carlas Kopie ist ausgelassen: {z:?}"
    );

    vollziehen(&w, ohne).await;
    assert_eq!(
        objekt_ereignisse(&mut rx, EINHEIT_UND_PERSONAL),
        vec![],
        "ohne offene Periode bleibt die Zeitachse unberührt"
    );
}

/// Die Rücknahme streicht die Ablösung der Einheit samt ihren Fan-out-Kopien und meldet
/// `einheit` und `personal` genau für diese Kräfte (LLH-1189); Carla hatte keine Kopie, und
/// die Rücknahme eines Vollzugs ohne offene Periode meldet nichts davon.
#[tokio::test]
async fn ruecknahme_meldet_einheit_und_personal() {
    let (app, live) = setup_mit_live().await;
    let w = welt_in(app).await;
    let (carla, bert, schicht) = abloesung_bereit(&w).await;
    vollziehen(&w, schicht).await;
    let ohne = schicht_ohne_periode(&w).await;
    vollziehen(&w, ohne).await;

    let mut rx = live.abonniere(w.e);
    zuruecknehmen(&w, schicht).await;
    assert_eq!(
        objekt_ereignisse(&mut rx, EINHEIT_UND_PERSONAL),
        vec![
            ("einheit".to_string(), w.einheit),
            ("personal".to_string(), w.ep)
        ],
        "nicht für {carla} (keine Kopie) und {bert}"
    );
    let (_, z) = zeitachse(&w.app, &w.admin, &w.person_pfad()).await;
    assert!(
        !arten(&z).contains(&paar("abloesung", "einheit")),
        "Annas Kopie ist gestrichen: {z:?}"
    );

    zuruecknehmen(&w, ohne).await;
    assert_eq!(
        objekt_ereignisse(&mut rx, EINHEIT_UND_PERSONAL),
        vec![],
        "ohne Ablösungsereignis bleibt die Zeitachse unberührt"
    );
}

/// Rückwirkend entlassen (LLH-1079, Kapitel Personal): wer die Entlassung vorher mit ihrer Zeit
/// nachträgt, behält genau diese eine; „Entlassen“ schreibt ohne offene Periode keine zweite.
#[tokio::test]
async fn nachgetragene_entlassung_bleibt_die_einzige() {
    let (app, pool) = setup_mit_pool().await;
    let w = welt_in(app).await;
    // Die Disposition liegt drei Stunden zurück.
    sqlx::query("UPDATE einsatz_kraft_zeitachse SET zeitpunkt_at = ? WHERE personal_id = ?")
        .bind(vor(3, 0))
        .bind(w.ep)
        .execute(&pool)
        .await
        .unwrap();
    let pfad = w.person_pfad();
    let (s, json) = w
        .nachtrag(
            &pfad,
            &format!(r#"{{"art":"eintreffen","zeitpunkt_at":"{}"}}"#, vor(2, 0)),
        )
        .await;
    assert_eq!(s, StatusCode::CREATED, "{json:?}");
    let ende = vor(1, 0);
    let (s, json) = w
        .nachtrag(
            &pfad,
            &format!(r#"{{"art":"entlassung","zeitpunkt_at":"{ende}"}}"#),
        )
        .await;
    assert_eq!(s, StatusCode::CREATED, "{json:?}");

    let (s, json) = anfrage(&w.app, "POST", &format!("{pfad}/entlassen"), &w.admin, None).await;
    assert_eq!(s, StatusCode::OK, "{json:?}");
    let (_, z) = zeitachse(&w.app, &w.admin, &pfad).await;
    let entlassungen: Vec<_> = z["ereignisse"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|e| e["art"] == "entlassung" && e.get("gestrichen_at").is_none())
        .collect();
    assert_eq!(entlassungen.len(), 1, "{z:?}");
    assert_eq!(entlassungen[0]["quelle"], "nachtrag");
    assert_eq!(entlassungen[0]["zeitpunkt_at"], ende.as_str());
}

// ── Kopplung an die Ablösung (LLH-1128) ─────────────────────────────────────────────────────

async fn einsatzvorgabe_6h(w: &Welt) {
    let (s, v) = anfrage(
        &w.app,
        "PUT",
        &format!("/api/einsaetze/{}/abloesungen/schichtmodell", w.e),
        &w.admin,
        Some(r#"{"schichtmodell":{"bezeichnung":"Sanitätsdienst","typ":"rhythmus","rhythmus_minuten":360}}"#),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
}

async fn laufende_schichten(w: &Welt) -> Vec<Value> {
    let (s, v) = anfrage(
        &w.app,
        "GET",
        &format!("/api/einsaetze/{}/abloesungen?status=laufend", w.e),
        &w.admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    v.as_array().unwrap().clone()
}

/// Spec `kraefte-zeitachse` „Kopplung an die Ablösung“: auch ein nachgetragenes Eintreffen
/// läuft durch den einzigen Schreibpfad und beginnt die Schicht zum nachgetragenen Zeitpunkt;
/// der Nachtrag meldet `abloesung` an die Leser des Moduls. Die nachgetragene Entlassung beendet
/// sie wieder.
#[tokio::test]
async fn nachgetragenes_eintreffen_beginnt_die_schicht() {
    let (app, live) = setup_mit_live().await;
    let w = welt_in(app).await;
    einsatzvorgabe_6h(&w).await;
    let eintreffen = vor(1, 0);
    let mut rx = live.abonniere(w.e);
    let (s, json) = w
        .nachtrag(
            &w.einheit_pfad(),
            &format!(r#"{{"art":"eintreffen","zeitpunkt_at":"{eintreffen}"}}"#),
        )
        .await;
    assert_eq!(s, StatusCode::CREATED, "{json:?}");
    recv_until_tag(&mut rx, "abloesung", Duration::from_secs(2)).await;
    let laufend = laufende_schichten(&w).await;
    assert_eq!(laufend.len(), 1, "{laufend:?}");
    assert_eq!(laufend[0]["einheit_id"], w.einheit);
    assert_eq!(laufend[0]["beginn_at"], eintreffen.as_str());
    assert_eq!(laufend[0]["rhythmus_quelle"], "einsatz");

    let (s, json) = w
        .nachtrag(
            &w.einheit_pfad(),
            &format!(r#"{{"art":"entlassung","zeitpunkt_at":"{}"}}"#, vor(1, 30)),
        )
        .await;
    assert_eq!(s, StatusCode::CREATED, "{json:?}");
    assert!(laufende_schichten(&w).await.is_empty());
}

/// Das Eintreffen über das erste Fahrzeug der Einheit beginnt die Schicht der Einheit.
#[tokio::test]
async fn fahrzeugstatus_beginnt_die_schicht_der_einheit() {
    let w = welt().await;
    einsatzvorgabe_6h(&w).await;
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
        &format!("{}/fahrzeug/{ef}", w.einheit_pfad()),
        &w.admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::NO_CONTENT);
    let (s, json) = anfrage(
        &w.app,
        "PATCH",
        &format!("/api/einsaetze/{}/fahrzeuge/{ef}", w.e),
        &w.admin,
        Some(&format!(r#"{{"status_id":{am_ort}}}"#)),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{json:?}");
    let laufend = laufende_schichten(&w).await;
    assert_eq!(laufend.len(), 1, "{laufend:?}");
    assert_eq!(laufend[0]["einheit_id"], w.einheit);
}

// ── Berichtigung nach dem Entlassen (LLH-1263, Spec `kraefte-entlassung`) ───────────────────

/// Id des nicht gestrichenen Ereignisses `art` in einer Zeitachse.
fn ereignis_id(z: &Value, art: &str) -> i64 {
    z["ereignisse"]
        .as_array()
        .unwrap()
        .iter()
        .find(|e| e["art"] == art && e.get("gestrichen_at").is_none())
        .unwrap_or_else(|| panic!("kein {art}: {z:?}"))["id"]
        .as_i64()
        .unwrap()
}

/// Anna mit Alarmierung vor 5 h und Eintreffen vor 4 h, entlassen vor 1 h.
async fn entlassene_anna() -> (Welt, sqlx::SqlitePool) {
    let (app, pool) = setup_mit_pool().await;
    let w = welt_in(app).await;
    sqlx::query("UPDATE einsatz_kraft_zeitachse SET zeitpunkt_at = ? WHERE personal_id = ?")
        .bind(vor(5, 0))
        .bind(w.ep)
        .execute(&pool)
        .await
        .unwrap();
    let (s, json) = w
        .nachtrag(
            &w.person_pfad(),
            &format!(r#"{{"art":"eintreffen","zeitpunkt_at":"{}"}}"#, vor(4, 0)),
        )
        .await;
    assert_eq!(s, StatusCode::CREATED, "{json:?}");
    let (s, json) = anfrage(
        &w.app,
        "POST",
        &format!("{}/entlassen", w.person_pfad()),
        &w.admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{json:?}");
    sqlx::query(
        "UPDATE einsatz_kraft_zeitachse SET zeitpunkt_at = ? \
         WHERE personal_id = ? AND art = 'entlassung'",
    )
    .bind(vor(1, 0))
    .bind(w.ep)
    .execute(&pool)
    .await
    .unwrap();
    (w, pool)
}

/// Spec „Eintreffzeit nach dem Entlassen berichtigen“ und „Andere Schreibwege bleiben gesperrt“.
#[tokio::test]
async fn entlassene_person_berichtigt_ihre_zeitachse() {
    let (w, _pool) = entlassene_anna().await;
    let pfad = w.person_pfad();
    let (_, z) = zeitachse(&w.app, &w.admin, &pfad).await;
    let eintreffen = ereignis_id(&z, "eintreffen");

    let (s, json) = anfrage(
        &w.app,
        "POST",
        &format!("{pfad}/zeitachse/{eintreffen}/streichen"),
        &w.admin,
        Some(r#"{"grund":"Zeit verwechselt"}"#),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{json:?}");
    let richtig = vor(4, 10);
    let (s, z) = w
        .nachtrag(
            &pfad,
            &format!(r#"{{"art":"eintreffen","zeitpunkt_at":"{richtig}"}}"#),
        )
        .await;
    assert_eq!(s, StatusCode::CREATED, "{z:?}");
    let perioden = z["perioden"].as_array().unwrap();
    assert_eq!(perioden.len(), 1, "{z:?}");
    assert!(perioden[0]["ende_at"].is_string(), "{z:?}");
    assert_eq!(perioden[0]["eintreffen_at"], richtig.as_str());

    let etb = system_etb_inhalte(&w.app, &w.admin, w.e).await;
    assert!(
        etb.iter()
            .any(|t| t.contains("gestrichen (berichtigt nach Entlassung)")
                && t.contains("Zeit verwechselt")),
        "{etb:?}"
    );
    assert!(
        etb.iter()
            .any(|t| t.contains("(nachgetragen, berichtigt nach Entlassung)")),
        "{etb:?}"
    );

    // Alle anderen Schreibwege an der Entlassenen bleiben 409.
    let (s, _) = anfrage(
        &w.app,
        "PATCH",
        &pfad,
        &w.admin,
        Some(r#"{"bemerkung":"x"}"#),
    )
    .await;
    assert_eq!(s, StatusCode::CONFLICT);
    let (s, json) = anfrage(
        &w.app,
        "GET",
        &format!("/api/einsaetze/{}/personal?entlassene=1", w.e),
        &w.admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(
        json[0]["beendet_als"], "entlassen",
        "die Person bleibt entlassen"
    );
}

/// Spec „Nachtrag öffnet eine Periode“ und „Abschließende Entlassung streichen“: 422, und weder
/// Zeitachse noch ETB ändern sich.
#[tokio::test]
async fn berichtigung_laesst_keine_offene_periode_zu() {
    let (w, _pool) = entlassene_anna().await;
    let pfad = w.person_pfad();
    let (_, vorher) = zeitachse(&w.app, &w.admin, &pfad).await;
    let etb_vorher = system_etb_anzahl(&w.app, &w.admin, w.e).await;

    let (s, json) = w
        .nachtrag(
            &pfad,
            &format!(r#"{{"art":"eintreffen","zeitpunkt_at":"{}"}}"#, vor(0, -30)),
        )
        .await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY, "{json:?}");
    assert!(
        json["error"]
            .as_str()
            .unwrap()
            .contains("Erneut disponieren"),
        "{json:?}"
    );
    let entlassung = ereignis_id(&vorher, "entlassung");
    let (s, json) = anfrage(
        &w.app,
        "POST",
        &format!("{pfad}/zeitachse/{entlassung}/streichen"),
        &w.admin,
        Some(r#"{"grund":"zu früh"}"#),
    )
    .await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY, "{json:?}");
    assert!(
        json["error"]
            .as_str()
            .unwrap()
            .contains("Erneut disponieren"),
        "der 422 kommt aus der Prüfung auf eine offene Periode: {json:?}"
    );

    let (_, nachher) = zeitachse(&w.app, &w.admin, &pfad).await;
    assert_eq!(vorher, nachher);
    assert_eq!(system_etb_anzahl(&w.app, &w.admin, w.e).await, etb_vorher);
}

/// Spec „Fehleintrag einer früheren Periode streichen“: zwei abgeschlossene Perioden, das
/// Eintreffen der ersten fällt weg, beide bleiben geschlossen, die Person bleibt entlassen.
#[tokio::test]
async fn fehleintrag_einer_frueheren_periode_streichen() {
    let (app, pool) = setup_mit_pool().await;
    let w = welt_in(app).await;
    sqlx::query("UPDATE einsatz_kraft_zeitachse SET zeitpunkt_at = ? WHERE personal_id = ?")
        .bind(vor(8, 0))
        .bind(w.ep)
        .execute(&pool)
        .await
        .unwrap();
    let pfad = w.person_pfad();
    let falsch = vor(7, 30);
    for (art, zeitpunkt) in [
        ("eintreffen", falsch.clone()),
        ("entlassung", vor(6, 0)),
        ("alarmierung", vor(5, 0)),
        ("eintreffen", vor(4, 0)),
    ] {
        let (s, json) = w
            .nachtrag(
                &pfad,
                &format!(r#"{{"art":"{art}","zeitpunkt_at":"{zeitpunkt}"}}"#),
            )
            .await;
        assert_eq!(s, StatusCode::CREATED, "{art}: {json:?}");
    }
    let (s, json) = anfrage(&w.app, "POST", &format!("{pfad}/entlassen"), &w.admin, None).await;
    assert_eq!(s, StatusCode::OK, "{json:?}");

    let (_, z) = zeitachse(&w.app, &w.admin, &pfad).await;
    let erstes = z["ereignisse"]
        .as_array()
        .unwrap()
        .iter()
        .find(|e| e["art"] == "eintreffen" && e["zeitpunkt_at"] == falsch.as_str())
        .unwrap()["id"]
        .as_i64()
        .unwrap();
    let (s, z) = anfrage(
        &w.app,
        "POST",
        &format!("{pfad}/zeitachse/{erstes}/streichen"),
        &w.admin,
        Some(r#"{"grund":"falsche Person"}"#),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{z:?}");
    let perioden = z["perioden"].as_array().unwrap();
    assert_eq!(perioden.len(), 2, "{z:?}");
    assert!(perioden.iter().all(|p| p["ende_at"].is_string()), "{z:?}");
    assert!(
        perioden[0].get("eintreffen_at").is_none_or(|v| v.is_null()),
        "{z:?}"
    );
    let (_, json) = anfrage(
        &w.app,
        "GET",
        &format!("/api/einsaetze/{}/personal?entlassene=1", w.e),
        &w.admin,
        None,
    )
    .await;
    assert_eq!(json[0]["beendet_als"], "entlassen");
}

/// Spec „Stornierte Person“ und „Aufgelöste Einheit“: dort bleiben Nachtrag und Streichung 409.
#[tokio::test]
async fn storno_und_aufgeloeste_einheit_bleiben_gesperrt() {
    let w = welt().await;
    let nachtrag = format!(r#"{{"art":"eintreffen","zeitpunkt_at":"{}"}}"#, vor(1, 0));

    let bert = stammpersonal_disponieren(&w.app, &w.admin, w.e, "Bert").await;
    let bert_pfad = format!("/api/einsaetze/{}/personal/{bert}", w.e);
    let (_, z) = zeitachse(&w.app, &w.admin, &bert_pfad).await;
    let alarmierung = ereignis_id(&z, "alarmierung");
    let (s, json) = anfrage(
        &w.app,
        "POST",
        &format!("{bert_pfad}/stornieren"),
        &w.admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::NO_CONTENT, "{json:?}");
    let (s, _) = w.nachtrag(&bert_pfad, &nachtrag).await;
    assert_eq!(s, StatusCode::CONFLICT);
    let (s, _) = anfrage(
        &w.app,
        "POST",
        &format!("{bert_pfad}/zeitachse/{alarmierung}/streichen"),
        &w.admin,
        Some(r#"{"grund":"x"}"#),
    )
    .await;
    assert_eq!(s, StatusCode::CONFLICT);

    // Eine Einheit ohne Personal, aber mit Zeitachse, wird aufgelöst statt gelöscht.
    let leer = einheit_bilden(&w.app, &w.admin, w.e, "Florian 2").await;
    let leer_pfad = format!("/api/einsaetze/{}/einheiten/{leer}", w.e);
    let (s, z) = w
        .nachtrag(
            &leer_pfad,
            &format!(r#"{{"art":"eintreffen","zeitpunkt_at":"{}"}}"#, vor(2, 0)),
        )
        .await;
    assert_eq!(s, StatusCode::CREATED, "{z:?}");
    let eintreffen = ereignis_id(&z, "eintreffen");
    let (s, _) = anfrage(&w.app, "DELETE", &leer_pfad, &w.admin, None).await;
    assert_eq!(s, StatusCode::NO_CONTENT);
    let (s, _) = w.nachtrag(&leer_pfad, &nachtrag).await;
    assert_eq!(s, StatusCode::CONFLICT);
    let (s, _) = anfrage(
        &w.app,
        "POST",
        &format!("{leer_pfad}/zeitachse/{eintreffen}/streichen"),
        &w.admin,
        Some(r#"{"grund":"x"}"#),
    )
    .await;
    assert_eq!(s, StatusCode::CONFLICT);
}

// ── Streichung an der Einheit nach dem Entlassen einer Person (LLH-1459) ───────────────────

/// Anna mit Alarmierung vor 5 h; an Florian 1 Eintreffen vor 4 h und Entlassung vor 1 h
/// nachgetragen, Annas Periode ist über die Kopien geschlossen. Danach wird Anna entlassen.
async fn anna_ueber_die_einheit_entlassen() -> (Welt, sqlx::SqlitePool) {
    let (app, pool) = setup_mit_pool().await;
    let w = welt_in(app).await;
    sqlx::query("UPDATE einsatz_kraft_zeitachse SET zeitpunkt_at = ? WHERE personal_id = ?")
        .bind(vor(5, 0))
        .bind(w.ep)
        .execute(&pool)
        .await
        .unwrap();
    for (art, zeitpunkt) in [("eintreffen", vor(4, 0)), ("entlassung", vor(1, 0))] {
        let (s, json) = w
            .nachtrag(
                &w.einheit_pfad(),
                &format!(r#"{{"art":"{art}","zeitpunkt_at":"{zeitpunkt}"}}"#),
            )
            .await;
        assert_eq!(s, StatusCode::CREATED, "{art}: {json:?}");
    }
    let (_, z) = zeitachse(&w.app, &w.admin, &w.person_pfad()).await;
    assert_eq!(
        arten(&z),
        vec![
            paar("alarmierung", "status"),
            paar("eintreffen", "einheit"),
            paar("entlassung", "einheit"),
        ],
        "{z:?}"
    );
    let (s, json) = anfrage(
        &w.app,
        "POST",
        &format!("{}/entlassen", w.person_pfad()),
        &w.admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{json:?}");
    (w, pool)
}

fn alle_geschlossen(z: &Value) -> bool {
    z["perioden"]
        .as_array()
        .unwrap()
        .iter()
        .all(|p| p["ende_at"].is_string())
}

/// Die Entlassung an der Einheit wird gestrichen: die Einheit ist wieder offen, die Kopie an der
/// inzwischen entlassenen Anna bleibt stehen, und Anna hat keine offene Periode.
#[tokio::test]
async fn streichung_an_der_einheit_laesst_die_entlassene_stehen() {
    let (w, _pool) = anna_ueber_die_einheit_entlassen().await;
    let (_, z) = zeitachse(&w.app, &w.admin, &w.einheit_pfad()).await;
    let entlassung = ereignis_id(&z, "entlassung");
    let (s, z) = anfrage(
        &w.app,
        "POST",
        &format!("{}/zeitachse/{entlassung}/streichen", w.einheit_pfad()),
        &w.admin,
        Some(r#"{"grund":"Einheit noch vor Ort"}"#),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{z:?}");
    assert!(!alle_geschlossen(&z), "die Einheit ist wieder offen: {z:?}");

    let (_, anna) = zeitachse(&w.app, &w.admin, &w.person_pfad()).await;
    assert!(alle_geschlossen(&anna), "{anna:?}");
    assert_eq!(
        arten(&anna),
        vec![
            paar("alarmierung", "status"),
            paar("eintreffen", "einheit"),
            paar("entlassung", "einheit"),
        ],
        "{anna:?}"
    );

    // Ihre Zeitachse bleibt berichtigbar: das Eintreffen streichen und neu nachtragen.
    let eintreffen = ereignis_id(&anna, "eintreffen");
    let (s, json) = anfrage(
        &w.app,
        "POST",
        &format!("{}/zeitachse/{eintreffen}/streichen", w.person_pfad()),
        &w.admin,
        Some(r#"{"grund":"Zeit verwechselt"}"#),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{json:?}");
}

/// Bestand von vor LLH-1459: Anna ist entlassen, ihre Periode aber über die mitgestrichene
/// Kopie wieder offen. Eine Berichtigung, die sie offen lässt, nennt den Nachtrag der
/// Entlassung; der Nachtrag selbst gelingt und schließt die Periode.
#[tokio::test]
async fn offene_periode_aus_dem_bestand_nennt_den_nachtrag_der_entlassung() {
    let (w, pool) = anna_ueber_die_einheit_entlassen().await;
    sqlx::query(
        "UPDATE einsatz_kraft_zeitachse SET gestrichen_at = datetime('now'), \
         gestrichen_von = 1, streichgrund = 'alt' \
         WHERE personal_id = ? AND art = 'entlassung'",
    )
    .bind(w.ep)
    .execute(&pool)
    .await
    .unwrap();
    let pfad = w.person_pfad();
    let (_, vorher) = zeitachse(&w.app, &w.admin, &pfad).await;
    assert!(!alle_geschlossen(&vorher), "{vorher:?}");

    let eintreffen = ereignis_id(&vorher, "eintreffen");
    let (s, json) = anfrage(
        &w.app,
        "POST",
        &format!("{pfad}/zeitachse/{eintreffen}/streichen"),
        &w.admin,
        Some(r#"{"grund":"Zeit verwechselt"}"#),
    )
    .await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY, "{json:?}");
    let meldung = json["error"].as_str().unwrap();
    assert!(meldung.contains("Entlassung nachtragen"), "{json:?}");
    assert!(!meldung.contains("Erneut disponieren"), "{json:?}");
    let (_, nachher) = zeitachse(&w.app, &w.admin, &pfad).await;
    assert_eq!(vorher, nachher, "nichts geschrieben");

    let (s, z) = w
        .nachtrag(
            &pfad,
            &format!(r#"{{"art":"entlassung","zeitpunkt_at":"{}"}}"#, vor(1, 0)),
        )
        .await;
    assert_eq!(s, StatusCode::CREATED, "{z:?}");
    assert!(alle_geschlossen(&z), "{z:?}");
}

// ── Zeitpunkt berichtigen (LLH-1455, Spec `kraefte-zeitachse` „Zeitpunkt berichtigen“) ──────

async fn berichtige(w: &Welt, pfad: &str, zid: i64, body: &str) -> (StatusCode, Value) {
    anfrage(
        &w.app,
        "POST",
        &format!("{pfad}/zeitachse/{zid}/berichtigen"),
        &w.admin,
        Some(body),
    )
    .await
}

fn berichtigung(zeitpunkt: &str, grund: &str) -> String {
    format!(r#"{{"zeitpunkt_at":"{zeitpunkt}","grund":"{grund}"}}"#)
}

/// Spec „Eintreffen als Anker berichtigen“ und „Kopien der Personen folgen“: Streichen allein gibt
/// 422, die Berichtigung gelingt in einem Schritt, die Kopie der Person folgt, das ETB nennt beide
/// Zeitpunkte und den Grund.
#[tokio::test]
async fn eintreffen_als_anker_an_der_einheit_berichtigen() {
    let (app, pool) = setup_mit_pool().await;
    let w = welt_in(app).await;
    sqlx::query("UPDATE einsatz_kraft_zeitachse SET zeitpunkt_at = ? WHERE personal_id = ?")
        .bind(vor(5, 0))
        .bind(w.ep)
        .execute(&pool)
        .await
        .unwrap();
    let pfad = w.einheit_pfad();
    for (art, zeitpunkt) in [("eintreffen", vor(4, 0)), ("entlassung", vor(1, 0))] {
        let (s, json) = w
            .nachtrag(
                &pfad,
                &format!(r#"{{"art":"{art}","zeitpunkt_at":"{zeitpunkt}"}}"#),
            )
            .await;
        assert_eq!(s, StatusCode::CREATED, "{art}: {json:?}");
    }
    let (_, z) = zeitachse(&w.app, &w.admin, &pfad).await;
    let eintreffen = ereignis_id(&z, "eintreffen");
    let (s, json) = anfrage(
        &w.app,
        "POST",
        &format!("{pfad}/zeitachse/{eintreffen}/streichen"),
        &w.admin,
        Some(r#"{"grund":"x"}"#),
    )
    .await;
    assert_eq!(
        s,
        StatusCode::UNPROCESSABLE_ENTITY,
        "Streichen allein: {json:?}"
    );

    let richtig = vor(4, -10);
    let (s, z) = berichtige(
        &w,
        &pfad,
        eintreffen,
        &berichtigung(&richtig, "Zeit verwechselt"),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{z:?}");
    let perioden = z["perioden"].as_array().unwrap();
    assert_eq!(perioden.len(), 1, "{z:?}");
    assert_eq!(perioden[0]["beginn_at"], richtig.as_str());
    assert!(perioden[0]["ende_at"].is_string(), "{z:?}");
    assert_eq!(
        arten(&z),
        vec![
            paar("eintreffen", "nachtrag"),
            paar("entlassung", "nachtrag")
        ]
    );

    let (_, anna) = zeitachse(&w.app, &w.admin, &w.person_pfad()).await;
    let kopie = anna["ereignisse"]
        .as_array()
        .unwrap()
        .iter()
        .find(|e| e["art"] == "eintreffen" && e.get("gestrichen_at").is_none())
        .unwrap()
        .clone();
    assert_eq!(kopie["zeitpunkt_at"], richtig.as_str());
    assert_eq!(kopie["quelle"], "einheit");

    let etb = system_etb_inhalte(&w.app, &w.admin, w.e).await;
    assert_eq!(
        etb.iter()
            .filter(
                |t| t.contains("Einheit «Florian 1» eingetroffen berichtigt von")
                    && t.contains("— Grund: Zeit verwechselt")
            )
            .count(),
        1,
        "{etb:?}"
    );
}

/// Spec „Entlassungszeit nach dem Entlassen berichtigen“ (`kraefte-entlassung`).
#[tokio::test]
async fn abschliessende_entlassung_einer_entlassenen_person_berichtigen() {
    let (w, _pool) = entlassene_anna().await;
    let pfad = w.person_pfad();
    let (_, z) = zeitachse(&w.app, &w.admin, &pfad).await;
    let entlassung = ereignis_id(&z, "entlassung");

    let richtig = vor(1, -30);
    let (s, z) = berichtige(
        &w,
        &pfad,
        entlassung,
        &berichtigung(&richtig, "zu spät gemeldet"),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{z:?}");
    let perioden = z["perioden"].as_array().unwrap();
    assert_eq!(perioden.len(), 1, "{z:?}");
    assert_eq!(perioden[0]["ende_at"], richtig.as_str());

    let etb = system_etb_inhalte(&w.app, &w.admin, w.e).await;
    assert!(
        etb.iter().any(|t| t.contains("entlassen berichtigt von")
            && t.contains("(nach Entlassung) — Grund: zu spät gemeldet")),
        "{etb:?}"
    );
    let (_, json) = anfrage(
        &w.app,
        "GET",
        &format!("/api/einsaetze/{}/personal?entlassene=1", w.e),
        &w.admin,
        None,
    )
    .await;
    assert_eq!(json[0]["beendet_als"], "entlassen");
}

/// Spec „Ergebnis verletzt die Regeln“ und „Berichtigung öffnet eine Periode“: 422, Zeitachse und
/// ETB bleiben unverändert.
#[tokio::test]
async fn berichtigung_mit_verstoss_schreibt_nichts() {
    let (w, _pool) = entlassene_anna().await;
    let pfad = w.person_pfad();
    let (_, vorher) = zeitachse(&w.app, &w.admin, &pfad).await;
    let etb_vorher = system_etb_anzahl(&w.app, &w.admin, w.e).await;
    let alarmierung = ereignis_id(&vorher, "alarmierung");
    let eintreffen = ereignis_id(&vorher, "eintreffen");

    // Alarmierung nach das Eintreffen: Regelverstoß.
    let (s, json) = berichtige(&w, &pfad, alarmierung, &berichtigung(&vor(3, 0), "x")).await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY, "{json:?}");
    // Eintreffen nach die Entlassung: regelkonform, aber eine offene Periode.
    let (s, json) = berichtige(&w, &pfad, eintreffen, &berichtigung(&vor(0, -30), "x")).await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY, "{json:?}");
    assert!(
        json["error"]
            .as_str()
            .unwrap()
            .contains("Erneut disponieren"),
        "{json:?}"
    );

    let (_, nachher) = zeitachse(&w.app, &w.admin, &pfad).await;
    assert_eq!(vorher, nachher);
    assert_eq!(system_etb_anzahl(&w.app, &w.admin, w.e).await, etb_vorher);
}

/// Statuscodes der Berichtigung (D1): 400 für das Feld, 422 für den Zusammenhang, 404 fremd, 409
/// an einer stornierten Person.
#[tokio::test]
async fn berichtigung_statuscodes() {
    let w = welt().await;
    let pfad = w.person_pfad();
    let (_, z) = zeitachse(&w.app, &w.admin, &pfad).await;
    let alarmierung = ereignis_id(&z, "alarmierung");
    let alt = z["ereignisse"][0]["zeitpunkt_at"]
        .as_str()
        .unwrap()
        .to_string();

    let (s, _) = berichtige(&w, &pfad, alarmierung, &berichtigung(&vor(1, 0), " ")).await;
    assert_eq!(s, StatusCode::BAD_REQUEST, "leerer Grund");
    // Grenze am Grund (Streichung und Berichtigung), vor dem 422 „unverändert“.
    let lang = "x".repeat(lifeline_hub::zeitachse::GRUND_MAX + 1);
    let (s, json) = berichtige(&w, &pfad, alarmierung, &berichtigung(&alt, &lang)).await;
    assert_eq!(s, StatusCode::BAD_REQUEST, "{json:?}");
    let (s, _) = berichtige(&w, &pfad, alarmierung, &berichtigung("", "x")).await;
    assert_eq!(s, StatusCode::BAD_REQUEST, "Zeitpunkt fehlt");
    let (s, _) = berichtige(&w, &pfad, alarmierung, &berichtigung(&vor(-1, 0), "x")).await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY, "Zukunft");
    let (s, _) = berichtige(&w, &pfad, alarmierung, &berichtigung(&alt, "x")).await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY, "unverändert");
    let (s, _) = berichtige(
        &w,
        &w.einheit_pfad(),
        alarmierung,
        &berichtigung(&vor(1, 0), "x"),
    )
    .await;
    assert_eq!(s, StatusCode::NOT_FOUND, "Ereignis einer anderen Kraft");

    let bert = stammpersonal_disponieren(&w.app, &w.admin, w.e, "Bert").await;
    let bert_pfad = format!("/api/einsaetze/{}/personal/{bert}", w.e);
    let (_, z) = zeitachse(&w.app, &w.admin, &bert_pfad).await;
    let bert_alarmierung = ereignis_id(&z, "alarmierung");
    let (s, _) = anfrage(
        &w.app,
        "POST",
        &format!("{bert_pfad}/stornieren"),
        &w.admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::NO_CONTENT);
    let (s, _) = berichtige(
        &w,
        &bert_pfad,
        bert_alarmierung,
        &berichtigung(&vor(1, 0), "x"),
    )
    .await;
    assert_eq!(s, StatusCode::CONFLICT, "stornierte Person");
}

// ── Periode nachtragen (LLH-1538) ───────────────────────────────────────────────────────────

async fn periode(w: &Welt, pfad: &str, body: &str) -> (StatusCode, Value) {
    anfrage(
        &w.app,
        "POST",
        &format!("{pfad}/zeitachse/periode"),
        &w.admin,
        Some(body),
    )
    .await
}

fn periode_body(alarmierung: Option<&str>, eintreffen: Option<&str>, ende: &str) -> String {
    let feld = |name: &str, wert: Option<&str>| {
        wert.map(|z| format!(r#""{name}":"{z}","#))
            .unwrap_or_default()
    };
    format!(
        r#"{{{}{}"entlassung_at":"{ende}","notiz":"aus dem Funkprotokoll"}}"#,
        feld("alarmierung_at", alarmierung),
        feld("eintreffen_at", eintreffen)
    )
}

/// Akzeptanzkriterium LLH-1538, Spec „Fehlende Periode nach dem Entlassen nachtragen“: an der
/// entlassenen Anna (Periode vor 5 h bis vor 1 h) eine frühere Periode in einem Schritt.
#[tokio::test]
async fn fehlende_periode_an_entlassener_person_nachtragen() {
    let (w, _pool) = entlassene_anna().await;
    let pfad = w.person_pfad();
    let (eintreffen, ende) = (vor(9, 0), vor(7, 0));
    let (s, z) = periode(&w, &pfad, &periode_body(None, Some(&eintreffen), &ende)).await;
    assert_eq!(s, StatusCode::CREATED, "{z:?}");
    let perioden = z["perioden"].as_array().unwrap();
    assert_eq!(perioden.len(), 2, "{z:?}");
    assert!(alle_geschlossen(&z), "{z:?}");
    assert_eq!(perioden[0]["beginn_at"], eintreffen.as_str());
    assert_eq!(perioden[0]["anker"], "eintreffen");
    assert_eq!(perioden[0]["ende_at"], ende.as_str());
    let neu: Vec<&Value> = z["ereignisse"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|e| e["zeitpunkt_at"] == eintreffen.as_str() || e["zeitpunkt_at"] == ende.as_str())
        .collect();
    assert_eq!(neu.len(), 2);
    assert!(neu.iter().all(|e| e["quelle"] == "nachtrag"));
    assert_eq!(neu[0]["notiz"], "aus dem Funkprotokoll", "Notiz am Beginn");
    assert!(neu[1].get("notiz").is_none(), "{z:?}");

    let etb = system_etb_inhalte(&w.app, &w.admin, w.e).await;
    assert!(
        etb.iter()
            .any(|t| t.contains("Einsatzperiode nachgetragen: eingetroffen")
                && t.contains("entlassen")
                && t.ends_with("(berichtigt nach Entlassung)")),
        "{etb:?}"
    );
    let (_, json) = anfrage(
        &w.app,
        "GET",
        &format!("/api/einsaetze/{}/personal?entlassene=1", w.e),
        &w.admin,
        None,
    )
    .await;
    assert_eq!(json[0]["beendet_als"], "entlassen", "bleibt entlassen");
}

/// Akzeptanzkriterium LLH-1538: ein Ergebnis mit Regelverstoß gibt 422 und schreibt nichts,
/// auch keinen ETB-Eintrag.
#[tokio::test]
async fn periode_mit_verstoss_schreibt_nichts() {
    let (w, _pool) = entlassene_anna().await;
    let pfad = w.person_pfad();
    let (_, vorher) = zeitachse(&w.app, &w.admin, &pfad).await;
    let etb_vorher = system_etb_anzahl(&w.app, &w.admin, w.e).await;

    // In die bestehende Periode hinein.
    let (s, json) = periode(&w, &pfad, &periode_body(None, Some(&vor(3, 0)), &vor(2, 0))).await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY, "{json:?}");
    // Über die bestehende hinweg: ihre Entlassung schlösse die neue.
    let (s, json) = periode(
        &w,
        &pfad,
        &periode_body(Some(&vor(6, 0)), None, &vor(0, 30)),
    )
    .await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY, "{json:?}");

    let (_, nachher) = zeitachse(&w.app, &w.admin, &pfad).await;
    assert_eq!(vorher, nachher);
    assert_eq!(system_etb_anzahl(&w.app, &w.admin, w.e).await, etb_vorher);
}

/// Spec „Periode vor der laufenden nachtragen“ und „Fan-out ganz oder gar nicht“: Florian 1 ist
/// seit 1 h eingetroffen. Anna bekommt die Periode als Kopie, Bert trägt im Zeitraum schon eine
/// eigene und bekommt keine.
#[tokio::test]
async fn periode_an_der_einheit_vor_der_laufenden() {
    let (app, pool) = setup_mit_pool().await;
    let w = welt_in(app).await;
    let (s, json) = w
        .nachtrag(
            &w.einheit_pfad(),
            &format!(r#"{{"art":"eintreffen","zeitpunkt_at":"{}"}}"#, vor(1, 0)),
        )
        .await;
    assert_eq!(s, StatusCode::CREATED, "{json:?}");

    let bert = stammpersonal_disponieren(&w.app, &w.admin, w.e, "Bert").await;
    let bert_pfad = format!("/api/einsaetze/{}/personal/{bert}", w.e);
    sqlx::query("UPDATE einsatz_kraft_zeitachse SET zeitpunkt_at = ? WHERE personal_id = ?")
        .bind(vor(8, 0))
        .bind(bert)
        .execute(&pool)
        .await
        .unwrap();
    let (s, json) = w
        .nachtrag(
            &bert_pfad,
            &format!(r#"{{"art":"entlassung","zeitpunkt_at":"{}"}}"#, vor(6, 0)),
        )
        .await;
    assert_eq!(s, StatusCode::CREATED, "{json:?}");
    let (s, _) = anfrage(
        &w.app,
        "PUT",
        &format!(
            "/api/einsaetze/{}/einheiten/{}/personal/{bert}",
            w.e, w.einheit
        ),
        &w.admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::NO_CONTENT);
    let (_, bert_vorher) = zeitachse(&w.app, &w.admin, &bert_pfad).await;

    let (s, z) = periode(
        &w,
        &w.einheit_pfad(),
        &periode_body(Some(&vor(10, 0)), Some(&vor(9, 30)), &vor(5, 0)),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{z:?}");
    let perioden = z["perioden"].as_array().unwrap();
    assert_eq!(perioden.len(), 2, "{z:?}");
    assert!(perioden[0]["ende_at"].is_string());
    assert!(
        perioden[1].get("ende_at").is_none(),
        "die laufende bleibt offen: {z:?}"
    );

    let (_, anna) = zeitachse(&w.app, &w.admin, &w.person_pfad()).await;
    let kopien: Vec<String> = anna["ereignisse"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|e| {
            e["quelle"] == "einheit" && e["zeitpunkt_at"].as_str() <= Some(vor(5, 0).as_str())
        })
        .map(|e| e["art"].as_str().unwrap().to_string())
        .collect();
    assert_eq!(
        kopien,
        ["alarmierung", "eintreffen", "entlassung"],
        "{anna:?}"
    );
    let (_, bert_nachher) = zeitachse(&w.app, &w.admin, &bert_pfad).await;
    assert_eq!(bert_vorher, bert_nachher, "keine halbe Periode");

    let etb = system_etb_inhalte(&w.app, &w.admin, w.e).await;
    assert!(
        etb.iter().any(|t| t
            .contains("Einheit «Florian 1» Einsatzperiode nachgetragen: alarmiert")
            && !t.contains("berichtigt nach Entlassung")),
        "{etb:?}"
    );
}

/// Statuscodes (design.md D1): 400 für die Felder, 422 für Zukunft und Reihenfolge, 404 fremd,
/// 409 an einer stornierten Person.
#[tokio::test]
async fn periode_statuscodes() {
    let w = welt().await;
    let pfad = w.einheit_pfad();
    let (s, _) = periode(
        &w,
        &pfad,
        &format!(r#"{{"entlassung_at":"{}"}}"#, vor(1, 0)),
    )
    .await;
    assert_eq!(s, StatusCode::BAD_REQUEST, "Beginn fehlt");
    let (s, _) = periode(
        &w,
        &pfad,
        &format!(r#"{{"eintreffen_at":"{}"}}"#, vor(2, 0)),
    )
    .await;
    assert_eq!(s, StatusCode::BAD_REQUEST, "Entlassung fehlt");
    let (s, _) = periode(&w, &pfad, &periode_body(None, Some("gestern"), &vor(1, 0))).await;
    assert_eq!(s, StatusCode::BAD_REQUEST, "unlesbar");
    let (s, _) = periode(
        &w,
        &pfad,
        &periode_body(None, Some(&vor(2, 0)), &vor(-1, 0)),
    )
    .await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY, "Zukunft");
    let (s, _) = periode(&w, &pfad, &periode_body(None, Some(&vor(1, 0)), &vor(2, 0))).await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY, "Ende vor dem Beginn");
    let lang = format!(
        r#"{{"eintreffen_at":"{}","entlassung_at":"{}","notiz":"{}"}}"#,
        vor(1, 0),
        vor(2, 0),
        "x".repeat(lifeline_hub::zeitachse::NOTIZ_MAX + 1)
    );
    let (s, _) = periode(&w, &pfad, &lang).await;
    assert_eq!(s, StatusCode::BAD_REQUEST, "Notiz zu lang, vor dem 422");
    let (s, _) = periode(
        &w,
        &pfad,
        &periode_body(Some(&vor(2, 0)), Some(&vor(3, 0)), &vor(1, 0)),
    )
    .await;
    assert_eq!(
        s,
        StatusCode::UNPROCESSABLE_ENTITY,
        "Alarmierung nach Eintreffen"
    );
    let fremd = format!("/api/einsaetze/{}/einheiten/999999", w.e);
    let (s, _) = periode(
        &w,
        &fremd,
        &periode_body(None, Some(&vor(2, 0)), &vor(1, 0)),
    )
    .await;
    assert_eq!(s, StatusCode::NOT_FOUND);

    let bert = stammpersonal_disponieren(&w.app, &w.admin, w.e, "Bert").await;
    let bert_pfad = format!("/api/einsaetze/{}/personal/{bert}", w.e);
    let (s, _) = anfrage(
        &w.app,
        "POST",
        &format!("{bert_pfad}/stornieren"),
        &w.admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::NO_CONTENT);
    let (s, _) = periode(
        &w,
        &bert_pfad,
        &periode_body(None, Some(&vor(9, 0)), &vor(8, 0)),
    )
    .await;
    assert_eq!(s, StatusCode::CONFLICT, "stornierte Person");
}
