//! Einzel-Zuordnung von Sprechgruppen (LFH-893, design.md D5/D14): `PUT/DELETE
//! …/sprechgruppen/{sg}` an Abschnitt, Einheit, Führungsstelle und externer Stelle des
//! Kommunikationsplans.
//!
//! Tragend: idempotent, eine Zuordnung verdrängt keine andere (zwei Arbeitsplätze zugleich),
//! dieselben Prüfungen wie der PATCH mit `sprechgruppe_ids`, dasselbe Live-Ereignis, dieselbe
//! ETB-Wirkung (keine), 403 je fehlendem Recht, 422 für eine Funktion mit Sprechgruppe.

use axum::http::StatusCode;
use lifeline_hub::live::{LiveEvent, LiveNachricht};
use serde_json::{json, Value};
use tokio::sync::broadcast::Receiver;

mod common;
use common::*;

async fn lokale_sprechgruppe(
    app: &axum::Router,
    cookie: &str,
    einsatz: i64,
    bezeichnung: &str,
    betriebsart: &str,
) -> i64 {
    let (status, json) = anfrage_json(
        app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/sprechgruppen"),
        cookie,
        Some(&json!({"bezeichnung": bezeichnung, "betriebsart": betriebsart})),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{json:?}");
    json["id"].as_i64().unwrap()
}

async fn abschnitt(app: &axum::Router, cookie: &str, einsatz: i64, name: &str) -> i64 {
    let (s, json) = anfrage_json(
        app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/abschnitte"),
        cookie,
        Some(&json!({"name": name})),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{json:?}");
    json["id"].as_i64().unwrap()
}

async fn stelle(app: &axum::Router, cookie: &str, einsatz: i64, body: Value) -> i64 {
    let (status, plan) = anfrage_json(
        app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/stab/kommunikationsplan/stellen"),
        cookie,
        Some(&body),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{plan:?}");
    plan.as_array()
        .unwrap()
        .iter()
        .map(|s| s["id"].as_i64().unwrap())
        .max()
        .unwrap()
}

/// Die vier Ziele: Pfad-Präfix (ohne `/{sg}`), Lese-Pfad, wo die Sprechgruppen im JSON stehen.
#[derive(Clone, Copy)]
enum Ziel {
    Abschnitt(i64),
    Einheit(i64),
    Fuehrungsstelle,
    Stelle(i64),
}

impl Ziel {
    fn pfad(self, einsatz: i64, sg: i64) -> String {
        let b = format!("/api/einsaetze/{einsatz}");
        match self {
            Ziel::Abschnitt(id) => format!("{b}/abschnitte/{id}/sprechgruppen/{sg}"),
            Ziel::Einheit(id) => format!("{b}/einheiten/{id}/sprechgruppen/{sg}"),
            Ziel::Fuehrungsstelle => format!("{b}/fuehrungsstelle/sprechgruppen/{sg}"),
            Ziel::Stelle(id) => {
                format!("{b}/stab/kommunikationsplan/stellen/{id}/sprechgruppen/{sg}")
            }
        }
    }

    fn body(self) -> Option<Value> {
        match self {
            Ziel::Stelle(_) => Some(json!({"status": "bestehend"})),
            _ => None,
        }
    }

    fn live(self) -> LiveEvent {
        match self {
            Ziel::Abschnitt(_) => LiveEvent::Abschnitt,
            Ziel::Einheit(_) => LiveEvent::Einheit,
            Ziel::Fuehrungsstelle => LiveEvent::Einsatz,
            Ziel::Stelle(_) => LiveEvent::Stab,
        }
    }

    /// Die zugeordneten Sprechgruppen-Bezeichnungen, gelesen über den Datensatz.
    async fn namen(self, app: &axum::Router, cookie: &str, einsatz: i64) -> Vec<String> {
        let b = format!("/api/einsaetze/{einsatz}");
        let liste: Vec<Value> = match self {
            Ziel::Abschnitt(id) | Ziel::Einheit(id) => {
                let pfad = match self {
                    Ziel::Abschnitt(_) => format!("{b}/abschnitte"),
                    _ => format!("{b}/einheiten"),
                };
                let (_, json) = anfrage(app, "GET", &pfad, cookie, None).await;
                let eintrag = json
                    .as_array()
                    .unwrap()
                    .iter()
                    .find(|e| e["id"] == id)
                    .unwrap()
                    .clone();
                eintrag["sprechgruppen"].as_array().unwrap().clone()
            }
            Ziel::Fuehrungsstelle => {
                let (_, json) =
                    anfrage(app, "GET", &format!("{b}/fuehrungsstelle"), cookie, None).await;
                json["sprechgruppen"].as_array().unwrap().clone()
            }
            Ziel::Stelle(id) => {
                let (_, json) = anfrage(
                    app,
                    "GET",
                    &format!("{b}/stab/kommunikationsplan"),
                    cookie,
                    None,
                )
                .await;
                let s = json
                    .as_array()
                    .unwrap()
                    .iter()
                    .find(|s| s["id"] == id)
                    .unwrap()
                    .clone();
                s["sprechgruppen"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .map(|k| k["sprechgruppe"].clone())
                    .collect()
            }
        };
        liste
            .iter()
            .map(|g| g["bezeichnung"].as_str().unwrap().to_string())
            .collect()
    }
}

fn zaehle(rx: &mut Receiver<LiveNachricht>, event: LiveEvent) -> (usize, usize) {
    let (mut treffer, mut etb) = (0, 0);
    while let Ok(n) = rx.try_recv() {
        if n.event == event {
            treffer += 1;
        }
        if n.event == LiveEvent::Etb {
            etb += 1;
        }
    }
    (treffer, etb)
}

struct Aufbau {
    app: axum::Router,
    live: lifeline_hub::live::LiveHub,
    admin: String,
    einsatz: i64,
    ziele: [Ziel; 4],
    tmo311: i64,
    dmo505: i64,
}

async fn aufbau() -> Aufbau {
    let (app, _pool, live) = setup_mit_pool_und_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let ab = abschnitt(&app, &admin, einsatz, "EA 1").await;
    let eh = einheit_bilden(&app, &admin, einsatz, "1. Zug").await;
    let ils = stelle(
        &app,
        &admin,
        einsatz,
        json!({"stellenart": "leitstelle", "bezeichnung": "ILS Musterhausen"}),
    )
    .await;
    let tmo311 = lokale_sprechgruppe(&app, &admin, einsatz, "311", "TMO").await;
    let dmo505 = lokale_sprechgruppe(&app, &admin, einsatz, "505", "DMO").await;
    Aufbau {
        app,
        live,
        admin,
        einsatz,
        ziele: [
            Ziel::Abschnitt(ab),
            Ziel::Einheit(eh),
            Ziel::Fuehrungsstelle,
            Ziel::Stelle(ils),
        ],
        tmo311,
        dmo505,
    }
}

#[tokio::test]
async fn gleichzeitig_zwei_kanaele_und_idempotent() {
    let a = aufbau().await;
    for ziel in a.ziele {
        // A ordnet 311 zu, B gleichzeitig 505: beide bleiben.
        for sg in [a.tmo311, a.dmo505, a.tmo311] {
            let (status, json) = anfrage_json(
                &a.app,
                "PUT",
                &ziel.pfad(a.einsatz, sg),
                &a.admin,
                ziel.body().as_ref(),
            )
            .await;
            assert_eq!(status, StatusCode::NO_CONTENT, "{json:?}");
        }
        let mut namen = ziel.namen(&a.app, &a.admin, a.einsatz).await;
        namen.sort();
        assert_eq!(namen, ["311", "505"]);

        for _ in 0..2 {
            let (status, _) = anfrage(
                &a.app,
                "DELETE",
                &ziel.pfad(a.einsatz, a.dmo505),
                &a.admin,
                None,
            )
            .await;
            assert_eq!(status, StatusCode::NO_CONTENT, "lösen ist idempotent");
        }
        assert_eq!(ziel.namen(&a.app, &a.admin, a.einsatz).await, ["311"]);
    }
}

#[tokio::test]
async fn gleiches_live_und_keine_etb_wirkung_wie_der_patch() {
    let a = aufbau().await;
    let vor = system_etb_anzahl(&a.app, &a.admin, a.einsatz).await;
    for ziel in a.ziele {
        let mut rx = a.live.abonniere(a.einsatz);
        anfrage_json(
            &a.app,
            "PUT",
            &ziel.pfad(a.einsatz, a.tmo311),
            &a.admin,
            ziel.body().as_ref(),
        )
        .await;
        anfrage(
            &a.app,
            "DELETE",
            &ziel.pfad(a.einsatz, a.tmo311),
            &a.admin,
            None,
        )
        .await;
        assert_eq!(
            zaehle(&mut rx, ziel.live()),
            (2, 0),
            "je wirksamer Änderung ein Ereignis des Datensatzes, kein ETB"
        );
    }
    // Der PATCH mit derselben Wirkung schreibt ebenfalls nichts ins ETB.
    let b = format!("/api/einsaetze/{}", a.einsatz);
    let mut rx = a.live.abonniere(a.einsatz);
    let ids = json!({"sprechgruppe_ids": [a.tmo311]});
    if let Ziel::Abschnitt(id) = a.ziele[0] {
        anfrage_json(
            &a.app,
            "PATCH",
            &format!("{b}/abschnitte/{id}"),
            &a.admin,
            Some(&ids),
        )
        .await;
    }
    if let Ziel::Einheit(id) = a.ziele[1] {
        anfrage_json(
            &a.app,
            "PATCH",
            &format!("{b}/einheiten/{id}"),
            &a.admin,
            Some(&ids),
        )
        .await;
    }
    anfrage_json(
        &a.app,
        "PATCH",
        &format!("{b}/fuehrungsstelle"),
        &a.admin,
        Some(&ids),
    )
    .await;
    let mut abschnitt = 0;
    let mut einheit = 0;
    let mut einsatz = 0;
    let mut etb = 0;
    while let Ok(n) = rx.try_recv() {
        match n.event {
            LiveEvent::Abschnitt => abschnitt += 1,
            LiveEvent::Einheit => einheit += 1,
            LiveEvent::Einsatz => einsatz += 1,
            LiveEvent::Etb => etb += 1,
            _ => {}
        }
    }
    assert_eq!((abschnitt, einheit, einsatz, etb), (1, 1, 1, 0));
    assert_eq!(
        system_etb_anzahl(&a.app, &a.admin, a.einsatz).await,
        vor,
        "weder PATCH noch Einzel-Endpunkt schreiben ins ETB"
    );
    // Der PATCH ersetzt die Menge weiterhin über dieselbe Zuordnung.
    for ziel in &a.ziele[..3] {
        assert_eq!(ziel.namen(&a.app, &a.admin, a.einsatz).await, ["311"]);
    }
}

#[tokio::test]
async fn fremde_sprechgruppe_ist_422_und_fremder_datensatz_404() {
    let a = aufbau().await;
    let anderer = einsatz_anlegen(&a.app, &a.admin).await;
    let fremd = lokale_sprechgruppe(&a.app, &a.admin, anderer, "999", "DMO").await;
    for ziel in a.ziele {
        let (status, _) = anfrage_json(
            &a.app,
            "PUT",
            &ziel.pfad(a.einsatz, fremd),
            &a.admin,
            ziel.body().as_ref(),
        )
        .await;
        assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
        let (status, _) = anfrage_json(
            &a.app,
            "PUT",
            &ziel.pfad(a.einsatz, 999_999),
            &a.admin,
            ziel.body().as_ref(),
        )
        .await;
        assert_eq!(
            status,
            StatusCode::UNPROCESSABLE_ENTITY,
            "unbekannte Sprechgruppe"
        );
        assert!(ziel.namen(&a.app, &a.admin, a.einsatz).await.is_empty());
    }
    // Abschnitt, Einheit und Stelle eines anderen Einsatzes: 404.
    for ziel in [a.ziele[0], a.ziele[1], a.ziele[3]] {
        let (status, _) = anfrage_json(
            &a.app,
            "PUT",
            &ziel.pfad(anderer, a.tmo311),
            &a.admin,
            ziel.body().as_ref(),
        )
        .await;
        assert_eq!(status, StatusCode::NOT_FOUND);
        let (status, _) = anfrage(
            &a.app,
            "DELETE",
            &ziel.pfad(anderer, a.tmo311),
            &a.admin,
            None,
        )
        .await;
        assert_eq!(status, StatusCode::NOT_FOUND);
    }
}

#[tokio::test]
async fn ohne_recht_403() {
    let a = aufbau().await;
    let id = benutzer_anlegen(&a.app, &a.admin, "beobachter", "keine").await;
    rolle_setzen(&a.app, &a.admin, a.einsatz, id, "beobachter").await;
    let beob = login_cookie(&a.app, "beobachter", "beobachterpw1").await;
    for ziel in a.ziele {
        let (status, _) = anfrage_json(
            &a.app,
            "PUT",
            &ziel.pfad(a.einsatz, a.tmo311),
            &beob,
            ziel.body().as_ref(),
        )
        .await;
        assert_eq!(status, StatusCode::FORBIDDEN);
        let (status, _) = anfrage(
            &a.app,
            "DELETE",
            &ziel.pfad(a.einsatz, a.tmo311),
            &beob,
            None,
        )
        .await;
        assert_eq!(status, StatusCode::FORBIDDEN);
    }
}

/// „Recht auf Stab, nicht auf Einheiten“: die Stelle geht, die Einheit nicht.
#[tokio::test]
async fn recht_auf_stab_nicht_auf_einheiten() {
    let a = aufbau().await;
    let id = benutzer_anlegen(&a.app, &a.admin, "frieda", "keine").await;
    rolle_setzen(&a.app, &a.admin, a.einsatz, id, "fuehrungspersonal").await;
    let frieda = login_cookie(&a.app, "frieda", "friedapw1").await;
    let (status, _) = anfrage(
        &a.app,
        "PUT",
        &format!("/api/einsaetze/{}/modul-overrides/einheiten", a.einsatz),
        &a.admin,
        Some(r#"{"sichtbar":true,"benoetigte_rolle":"admin"}"#),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let einheit = a.ziele[1];
    let stelle = a.ziele[3];
    let (status, _) = anfrage(
        &a.app,
        "PUT",
        &einheit.pfad(a.einsatz, a.tmo311),
        &frieda,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    let (status, _) = anfrage_json(
        &a.app,
        "PUT",
        &stelle.pfad(a.einsatz, a.tmo311),
        &frieda,
        stelle.body().as_ref(),
    )
    .await;
    assert_eq!(status, StatusCode::NO_CONTENT);
}

#[tokio::test]
async fn stelle_status_und_funktion_ohne_sprechgruppe() {
    let a = aufbau().await;
    let Ziel::Stelle(ils) = a.ziele[3] else {
        unreachable!()
    };
    let pfad = Ziel::Stelle(ils).pfad(a.einsatz, a.tmo311);
    let (status, _) = anfrage_json(
        &a.app,
        "PUT",
        &pfad,
        &a.admin,
        Some(&json!({"status": "geplant"})),
    )
    .await;
    assert_eq!(status, StatusCode::NO_CONTENT);
    let plan_pfad = format!("/api/einsaetze/{}/stab/kommunikationsplan", a.einsatz);
    let (_, plan) = anfrage(&a.app, "GET", &plan_pfad, &a.admin, None).await;
    let kanal = &plan[0]["sprechgruppen"][0];
    assert_eq!(kanal["status"], "geplant");
    assert_eq!(kanal["sprechgruppe"]["bezeichnung"], "311");
    // Erneutes PUT setzt den Status um.
    anfrage_json(
        &a.app,
        "PUT",
        &pfad,
        &a.admin,
        Some(&json!({"status": "bestehend"})),
    )
    .await;
    let (_, plan) = anfrage(&a.app, "GET", &plan_pfad, &a.admin, None).await;
    assert_eq!(plan[0]["sprechgruppen"][0]["status"], "bestehend");

    for body in [None, Some(json!({})), Some(json!({"status": "vielleicht"}))] {
        let (status, _) = anfrage_json(&a.app, "PUT", &pfad, &a.admin, body.as_ref()).await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{body:?}");
    }

    // Funktion mit Sprechgruppe: 422, nichts gespeichert; ihre Zeile trägt immer `[]`.
    let s2 = stelle(
        &a.app,
        &a.admin,
        a.einsatz,
        json!({"stellenart": "funktion", "funktion": "s2"}),
    )
    .await;
    let (status, _) = anfrage_json(
        &a.app,
        "PUT",
        &Ziel::Stelle(s2).pfad(a.einsatz, a.tmo311),
        &a.admin,
        Some(&json!({"status": "bestehend"})),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    let (_, plan) = anfrage(&a.app, "GET", &plan_pfad, &a.admin, None).await;
    let funktion = plan
        .as_array()
        .unwrap()
        .iter()
        .find(|s| s["id"] == s2)
        .unwrap();
    assert_eq!(funktion["sprechgruppen"], json!([]));
}

#[tokio::test]
async fn stelle_mit_kanal_entfernen_nimmt_die_zuordnung_mit() {
    let a = aufbau().await;
    let Ziel::Stelle(ils) = a.ziele[3] else {
        unreachable!()
    };
    anfrage_json(
        &a.app,
        "PUT",
        &Ziel::Stelle(ils).pfad(a.einsatz, a.tmo311),
        &a.admin,
        Some(&json!({"status": "bestehend"})),
    )
    .await;
    let (status, plan) = anfrage(
        &a.app,
        "DELETE",
        &format!(
            "/api/einsaetze/{}/stab/kommunikationsplan/stellen/{ils}",
            a.einsatz
        ),
        &a.admin,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(plan, json!([]));
}
