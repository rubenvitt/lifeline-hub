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

    let (_, nachher) = zeitachse(&w.app, &w.admin, &pfad).await;
    assert_eq!(vorher, nachher);
    assert_eq!(system_etb_anzahl(&w.app, &w.admin, w.e).await, etb_vorher);
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
