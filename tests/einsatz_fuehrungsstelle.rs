//! Die eigene Führungsstelle eines Einsatzes (LFH-849): `GET`/`PATCH
//! /api/einsaetze/{id}/fuehrungsstelle`. Spec `einsatz-fuehrungsstelle`, Herleitung
//! `openspec/changes/archive/2026-10-04-lfh-849-eigene-fuehrungsstelle/design.md` (D2, D3, D6).
//!
//! Nicht verwechseln mit `tests/fuehrungsstelle.rs`: dort die Führungsstelle je Person
//! (`einsatz_mitgliedschaft.fuehrungsstelle`, LFH-461).

use axum::http::StatusCode;
use lifeline_hub::live::{LiveEvent, LiveNachricht};
use serde_json::{json, Value};
use tokio::sync::broadcast::Receiver;

mod common;
use common::*;

fn pfad(einsatz: i64) -> String {
    format!("/api/einsaetze/{einsatz}/fuehrungsstelle")
}

async fn lesen(app: &axum::Router, cookie: &str, einsatz: i64) -> (StatusCode, Value) {
    anfrage(app, "GET", &pfad(einsatz), cookie, None).await
}

async fn patchen(
    app: &axum::Router,
    cookie: &str,
    einsatz: i64,
    body: Value,
) -> (StatusCode, Value) {
    anfrage_json(app, "PATCH", &pfad(einsatz), cookie, Some(&body)).await
}

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
    assert_eq!(
        status,
        StatusCode::CREATED,
        "Sprechgruppe anlegen: {json:?}"
    );
    json["id"].as_i64().unwrap()
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

// ---------- Lesen ----------

#[tokio::test]
async fn neuer_einsatz_hat_leere_fuehrungsstelle() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;

    let (status, json) = lesen(&app, &admin, einsatz).await;
    assert_eq!(status, StatusCode::OK, "{json:?}");
    assert_eq!(
        json,
        json!({"sprechgruppen": []}),
        "leere Angaben fehlen im JSON"
    );
}

#[tokio::test]
async fn beobachter_liest_und_darf_nicht_schreiben() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let id = benutzer_anlegen(&app, &admin, "beobachterin", "keine").await;
    rolle_setzen(&app, &admin, einsatz, id, "beobachter").await;
    let bea = login_cookie(&app, "beobachterin", "beobachterinpw1").await;
    assert_eq!(
        patchen(&app, &admin, einsatz, json!({"rufname": "Florian 10/1"}))
            .await
            .0,
        StatusCode::OK
    );

    let (status, json) = lesen(&app, &bea, einsatz).await;
    assert_eq!(status, StatusCode::OK, "{json:?}");
    assert_eq!(json["rufname"], "Florian 10/1");

    let (status, _) = patchen(&app, &bea, einsatz, json!({"rufname": "Anders"})).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    assert_eq!(
        lesen(&app, &admin, einsatz).await.1["rufname"],
        "Florian 10/1"
    );
}

#[tokio::test]
async fn ohne_lesezugriff_wie_beim_einsatzkopf() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    benutzer_anlegen(&app, &admin, "fremd", "keine").await;
    let fremd = login_cookie(&app, "fremd", "fremdpw1").await;

    let (kopf, _) = anfrage(
        &app,
        "GET",
        &format!("/api/einsaetze/{einsatz}"),
        &fremd,
        None,
    )
    .await;
    assert!(kopf.is_client_error(), "Vorbedingung: {kopf}");
    let (status, json) = lesen(&app, &fremd, einsatz).await;
    assert_eq!(status, kopf, "dieselbe Tür wie der Kopf");
    assert!(
        json.get("sprechgruppen").is_none(),
        "keine Angaben: {json:?}"
    );
}

// ---------- Teil-Patch ----------

#[tokio::test]
async fn jede_angabe_einzeln_und_leeren() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;

    let (status, json) = patchen(
        &app,
        &admin,
        einsatz,
        json!({"rufname": "  Florian Musterstadt 10/1  "}),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{json:?}");
    assert_eq!(json["rufname"], "Florian Musterstadt 10/1", "getrimmt");

    // Aus einem älteren Stand nur die Erreichbarkeit: der Rufname bleibt.
    let (_, json) = patchen(
        &app,
        &admin,
        einsatz,
        json!({"erreichbarkeit": "0171 1234567", "kommunikationsmittel": "digitalfunk"}),
    )
    .await;
    assert_eq!(json["rufname"], "Florian Musterstadt 10/1");
    assert_eq!(json["erreichbarkeit"], "0171 1234567");
    assert_eq!(json["kommunikationsmittel"], "digitalfunk");

    // `null` und leerer Text leeren; ein fehlendes Feld bleibt.
    let (_, json) = patchen(
        &app,
        &admin,
        einsatz,
        json!({"rufname": null, "erreichbarkeit": "   "}),
    )
    .await;
    assert!(json.get("rufname").is_none(), "{json:?}");
    assert!(json.get("erreichbarkeit").is_none(), "{json:?}");
    assert_eq!(json["kommunikationsmittel"], "digitalfunk");
    assert_eq!(lesen(&app, &admin, einsatz).await.1, json);
}

#[tokio::test]
async fn sprechgruppen_ersetzen_die_zuordnung() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let tmo = lokale_sprechgruppe(&app, &admin, einsatz, "311", "TMO").await;
    let dmo = lokale_sprechgruppe(&app, &admin, einsatz, "505", "DMO").await;

    let (status, json) = patchen(
        &app,
        &admin,
        einsatz,
        json!({"sprechgruppe_ids": [dmo, tmo]}),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{json:?}");
    let namen: Vec<&str> = json["sprechgruppen"]
        .as_array()
        .unwrap()
        .iter()
        .map(|s| s["bezeichnung"].as_str().unwrap())
        .collect();
    assert_eq!(
        namen,
        ["505", "311"],
        "sortiert nach Betriebsart: DMO vor TMO"
    );

    let (_, json) = patchen(&app, &admin, einsatz, json!({"sprechgruppe_ids": [tmo]})).await;
    assert_eq!(json["sprechgruppen"].as_array().unwrap().len(), 1);
    let (_, json) = patchen(&app, &admin, einsatz, json!({"rufname": "X"})).await;
    assert_eq!(
        json["sprechgruppen"].as_array().unwrap().len(),
        1,
        "ohne `sprechgruppe_ids` bleibt die Zuordnung"
    );
}

#[tokio::test]
async fn fremde_sprechgruppe_ist_422_und_speichert_nichts() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let anderer = einsatz_anlegen_mit(&app, &admin, "Anderer").await;
    let fremd = lokale_sprechgruppe(&app, &admin, anderer, "999", "DMO").await;

    let (status, json) = patchen(
        &app,
        &admin,
        einsatz,
        json!({"rufname": "Florian 10/1", "sprechgruppe_ids": [fremd]}),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{json:?}");
    assert_eq!(
        lesen(&app, &admin, einsatz).await.1,
        json!({"sprechgruppen": []}),
        "auch der Rufname aus demselben Aufruf ist nicht gespeichert"
    );
}

#[tokio::test]
async fn sprechgruppe_einer_fremden_org_ist_422() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let (fremde_org, _) =
        fremde_org_anlegen(&pool, "Fremde Org", "fremdling", "fremdlingpw1", "keine").await;
    let katalog: i64 = sqlx::query_scalar(
        "INSERT INTO sprechgruppe (org_id, bezeichnung, betriebsart) \
         VALUES (?, '311', 'TMO') RETURNING id",
    )
    .bind(fremde_org)
    .fetch_one(&pool)
    .await
    .unwrap();

    let (status, json) = patchen(
        &app,
        &admin,
        einsatz,
        json!({"sprechgruppe_ids": [katalog]}),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{json:?}");
}

#[tokio::test]
async fn null_leert_die_sprechgruppen() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let tmo = lokale_sprechgruppe(&app, &admin, einsatz, "311", "TMO").await;
    patchen(&app, &admin, einsatz, json!({"sprechgruppe_ids": [tmo]})).await;

    let (status, json) = patchen(&app, &admin, einsatz, json!({"sprechgruppe_ids": null})).await;
    assert_eq!(status, StatusCode::OK, "{json:?}");
    assert_eq!(json, json!({"sprechgruppen": []}));
}

#[tokio::test]
async fn leerer_patch_legt_nichts_an() {
    let (app, pool, live) = setup_mit_pool_und_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let mut rx = live.abonniere(einsatz);

    let (status, json) = patchen(&app, &admin, einsatz, json!({})).await;
    assert_eq!(status, StatusCode::OK, "{json:?}");
    assert_eq!(json, json!({"sprechgruppen": []}));
    let zeilen: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM einsatz_fuehrungsstelle WHERE einsatz_id = ?")
            .bind(einsatz)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(zeilen, 0, "keine leere Zeile");
    assert_eq!(kopf_events(&mut rx), 0, "nichts geändert, nichts gemeldet");
}

/// Die Prüfungen der Route laufen vor dem Schreiben; dass ein Fehler MITTEN im Schreiben nichts
/// teilweise hinterlässt, zeigt erst der Repo-Aufruf in einer Transaktion: der Rufname steht vor
/// der scheiternden Zuordnung (Fremdschlüssel) und ist nach dem Rollback fort.
#[tokio::test]
async fn ein_fehler_im_schreiben_hinterlaesst_nichts() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;

    let mut tx = pool.begin().await.unwrap();
    let patch = lifeline_hub::einsatz::fuehrungsstelle::FuehrungsstellePatch {
        rufname: Some(Some("Florian 10/1")),
        sprechgruppe_ids: Some(&[987_654]),
        ..Default::default()
    };
    let ergebnis =
        lifeline_hub::einsatz::fuehrungsstelle::patchen_tx(&mut tx, einsatz, &patch).await;
    assert!(
        ergebnis.is_err(),
        "unbekannte Sprechgruppe verletzt den Fremdschlüssel"
    );
    drop(tx);

    assert_eq!(
        lesen(&app, &admin, einsatz).await.1,
        json!({"sprechgruppen": []})
    );
}

#[tokio::test]
async fn unbekanntes_kommunikationsmittel_ist_400() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;

    let (status, _) = patchen(
        &app,
        &admin,
        einsatz,
        json!({"kommunikationsmittel": "brieftaube"}),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn abgeschlossener_einsatz_ist_409() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let (status, _) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/abschliessen"),
        &admin,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "Vorbedingung");

    let (status, _) = patchen(&app, &admin, einsatz, json!({"rufname": "X"})).await;
    assert_eq!(status, StatusCode::CONFLICT);
}

// ---------- Live ----------

#[tokio::test]
async fn erfolg_feuert_einsatz_ablehnung_nicht() {
    let (app, _pool, live) = setup_mit_pool_und_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let mut rx = live.abonniere(einsatz);

    assert_eq!(
        patchen(&app, &admin, einsatz, json!({"rufname": "X"}))
            .await
            .0,
        StatusCode::OK
    );
    assert_eq!(kopf_events(&mut rx), 1);

    assert_eq!(
        patchen(&app, &admin, einsatz, json!({"kommunikationsmittel": "x"}))
            .await
            .0,
        StatusCode::BAD_REQUEST
    );
    assert_eq!(
        patchen(&app, &admin, einsatz, json!({"sprechgruppe_ids": [987654]}))
            .await
            .0,
        StatusCode::UNPROCESSABLE_ENTITY
    );
    let id = benutzer_anlegen(&app, &admin, "beobachterin", "keine").await;
    rolle_setzen(&app, &admin, einsatz, id, "beobachter").await;
    let bea = login_cookie(&app, "beobachterin", "beobachterinpw1").await;
    assert_eq!(
        patchen(&app, &bea, einsatz, json!({"rufname": "Y"}))
            .await
            .0,
        StatusCode::FORBIDDEN
    );
    assert_eq!(kopf_events(&mut rx), 0);

    // Der Abschluss meldet selbst `einsatz`; erst danach zählt die Ablehnung.
    anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/abschliessen"),
        &admin,
        None,
    )
    .await;
    kopf_events(&mut rx);
    assert_eq!(
        patchen(&app, &admin, einsatz, json!({"rufname": "Z"}))
            .await
            .0,
        StatusCode::CONFLICT
    );
    assert_eq!(kopf_events(&mut rx), 0);
}

// ---------- Schwärzung ----------

#[tokio::test]
async fn schwaerzung_nullt_nur_die_erreichbarkeit() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let tmo = lokale_sprechgruppe(&app, &admin, einsatz, "311", "TMO").await;
    let (status, vorher) = patchen(
        &app,
        &admin,
        einsatz,
        json!({
            "rufname": "Florian 10/1",
            "kommunikationsmittel": "digitalfunk",
            "erreichbarkeit": "0171 1234567",
            "sprechgruppe_ids": [tmo],
        }),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{vorher:?}");

    let mut tx = pool.begin().await.unwrap();
    lifeline_hub::einsatz::schwaerzung_registry::scrubbe_aus_registry(
        &mut tx,
        einsatz,
        lifeline_hub::einsatz::schwaerzung_registry::Umfang::Alles,
    )
    .await
    .unwrap();
    tx.commit().await.unwrap();

    let nachher = lifeline_hub::einsatz::fuehrungsstelle::laden(&pool, einsatz)
        .await
        .unwrap();
    assert_eq!(nachher.erreichbarkeit, None);
    assert_eq!(nachher.rufname.as_deref(), Some("Florian 10/1"));
    assert_eq!(nachher.kommunikationsmittel.as_deref(), Some("digitalfunk"));
    assert_eq!(nachher.sprechgruppen.len(), 1);
}
