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

/// Der Bootstrap-Admin (id 1) als Schreiber, für Aufrufe des Repos ohne Route.
fn admin_schreiber() -> lifeline_hub::einsatz::fuehrungsstelle::Schreiber {
    lifeline_hub::einsatz::fuehrungsstelle::Schreiber {
        benutzer_id: 1,
        etb_startwert: 1,
    }
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
        json!({"sprechgruppen": [], "fahrzeug_ids": []}),
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
        json!({"sprechgruppen": [], "fahrzeug_ids": []}),
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
    assert_eq!(json, json!({"sprechgruppen": [], "fahrzeug_ids": []}));
}

#[tokio::test]
async fn leerer_patch_legt_nichts_an() {
    let (app, pool, live) = setup_mit_pool_und_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let mut rx = live.abonniere(einsatz);

    let (status, json) = patchen(&app, &admin, einsatz, json!({})).await;
    assert_eq!(status, StatusCode::OK, "{json:?}");
    assert_eq!(json, json!({"sprechgruppen": [], "fahrzeug_ids": []}));
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
    let ergebnis = lifeline_hub::einsatz::fuehrungsstelle::patchen_tx(
        &mut tx,
        einsatz,
        admin_schreiber(),
        &patch,
    )
    .await;
    assert!(
        ergebnis.is_err(),
        "unbekannte Sprechgruppe verletzt den Fremdschlüssel"
    );
    drop(tx);

    assert_eq!(
        lesen(&app, &admin, einsatz).await.1,
        json!({"sprechgruppen": [], "fahrzeug_ids": []})
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

// ---------- Fahrzeuge (LFH-1106) ----------

async fn adhoc_fahrzeug(app: &axum::Router, cookie: &str, einsatz: i64, funkrufname: &str) -> i64 {
    let (status, json) = anfrage_json(
        app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/fahrzeuge"),
        cookie,
        Some(&json!({"adhoc": {"funkrufname": funkrufname, "fahrzeugtyp": "ELW 2"}})),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "Fahrzeug anlegen: {json:?}");
    json["id"].as_i64().unwrap()
}

#[tokio::test]
async fn fahrzeuge_ersetzen_die_zuordnung_und_liefern_nur_ids() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let elw = adhoc_fahrzeug(&app, &admin, einsatz, "Florian Musterstadt 10/1").await;
    let kdow = adhoc_fahrzeug(&app, &admin, einsatz, "Florian Musterstadt 10/2").await;

    let (status, json) = patchen(
        &app,
        &admin,
        einsatz,
        json!({"fahrzeug_ids": [kdow, elw, elw]}),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{json:?}");
    assert_eq!(
        json,
        json!({"sprechgruppen": [], "fahrzeug_ids": [elw.min(kdow), elw.max(kdow)]}),
        "nur IDs, aufsteigend, entdoppelt"
    );

    let (_, json) = patchen(&app, &admin, einsatz, json!({"fahrzeug_ids": [elw]})).await;
    assert_eq!(json["fahrzeug_ids"], json!([elw]), "ersetzt vollständig");

    // Eine andere Angabe lässt die Fahrzeuge stehen.
    let (_, json) = patchen(&app, &admin, einsatz, json!({"rufname": "Florian 10"})).await;
    assert_eq!(json["fahrzeug_ids"], json!([elw]));

    let (_, json) = patchen(&app, &admin, einsatz, json!({"fahrzeug_ids": null})).await;
    assert_eq!(json["fahrzeug_ids"], json!([]), "null leert");
    assert_eq!(lesen(&app, &admin, einsatz).await.1, json);
}

#[tokio::test]
async fn fahrzeug_eines_anderen_einsatzes_ist_422_und_speichert_nichts() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let anderer = einsatz_anlegen_mit(&app, &admin, "Anderer").await;
    let fremd = adhoc_fahrzeug(&app, &admin, anderer, "Florian Anderswo 10/1").await;

    for ids in [json!([fremd]), json!([987_654])] {
        let (status, json) = patchen(
            &app,
            &admin,
            einsatz,
            json!({"rufname": "Florian 10", "fahrzeug_ids": ids}),
        )
        .await;
        assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{json:?}");
    }
    assert_eq!(
        lesen(&app, &admin, einsatz).await.1,
        json!({"sprechgruppen": [], "fahrzeug_ids": []}),
        "auch der Rufname bleibt ungespeichert"
    );
}

#[tokio::test]
async fn zu_viele_fahrzeuge_sind_400() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let max = lifeline_hub::einsatz::fuehrungsstelle::FAHRZEUGE_JE_FUEHRUNGSSTELLE_MAX as i64;
    let ids: Vec<i64> = (1..=max + 1).collect();
    let (status, json) = patchen(&app, &admin, einsatz, json!({"fahrzeug_ids": ids})).await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "{json:?}");
}

#[tokio::test]
async fn entlassen_loest_die_zuordnung() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let elw = adhoc_fahrzeug(&app, &admin, einsatz, "Florian Musterstadt 10/1").await;
    let (status, _) = patchen(&app, &admin, einsatz, json!({"fahrzeug_ids": [elw]})).await;
    assert_eq!(status, StatusCode::OK);

    let (status, _) = anfrage(
        &app,
        "DELETE",
        &format!("/api/einsaetze/{einsatz}/fahrzeuge/{elw}"),
        &admin,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::NO_CONTENT, "Vorbedingung: entlassen");
    assert_eq!(
        lesen(&app, &admin, einsatz).await.1["fahrzeug_ids"],
        json!([])
    );
}

#[tokio::test]
async fn entlassen_eines_getragenen_fahrzeugs_feuert_einsatz() {
    let (app, _pool, live) = setup_mit_pool_und_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let elw = adhoc_fahrzeug(&app, &admin, einsatz, "Florian Musterstadt 10/1").await;
    let mtw = adhoc_fahrzeug(&app, &admin, einsatz, "Florian Musterstadt 19/1").await;
    let (status, _) = patchen(&app, &admin, einsatz, json!({"fahrzeug_ids": [elw]})).await;
    assert_eq!(status, StatusCode::OK);
    let mut rx = live.abonniere(einsatz);

    let entlassen = |ef: i64| {
        let (app, admin) = (app.clone(), admin.clone());
        async move {
            anfrage(
                &app,
                "DELETE",
                &format!("/api/einsaetze/{einsatz}/fahrzeuge/{ef}"),
                &admin,
                None,
            )
            .await
            .0
        }
    };
    assert_eq!(entlassen(mtw).await, StatusCode::NO_CONTENT);
    assert_eq!(kopf_events(&mut rx), 0, "ohne Zuordnung kein Kopf-Ereignis");
    assert_eq!(entlassen(elw).await, StatusCode::NO_CONTENT);
    assert_eq!(
        kopf_events(&mut rx),
        1,
        "die Führungsstelle hat sich geändert"
    );
}

#[tokio::test]
async fn beobachter_darf_fahrzeuge_nicht_zuordnen() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let elw = adhoc_fahrzeug(&app, &admin, einsatz, "Florian Musterstadt 10/1").await;
    let id = benutzer_anlegen(&app, &admin, "beobachterin", "keine").await;
    rolle_setzen(&app, &admin, einsatz, id, "beobachter").await;
    let beobachter = login_cookie(&app, "beobachterin", "beobachterinpw1").await;

    let (status, _) = patchen(&app, &beobachter, einsatz, json!({"fahrzeug_ids": [elw]})).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    assert_eq!(
        lesen(&app, &admin, einsatz).await.1["fahrzeug_ids"],
        json!([])
    );
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
    // Die beiden Ablehnungen melden nichts; die Mitgliedschaftsänderung meldet selbst `einsatz`
    // (LFH-854). Erst danach zählt die dritte Ablehnung.
    assert_eq!(kopf_events(&mut rx), 1);
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

// ---------- Einsatzleiter (LFH-1199) ----------
//
// Spec `einsatz-fuehrungsstelle`, „Einsatzleiter als Person oder Freitext“ und „Übergabe der
// Einsatzleitung im ETB“. Herleitung:
// `openspec/changes/lfh-1199-einsatzleiter-angabe/design.md` (D1–D3).

/// ETB-Einträge des Einsatzes, deren Inhalt `nadel` enthält.
async fn etb_mit(app: &axum::Router, cookie: &str, einsatz: i64, nadel: &str) -> Vec<Value> {
    let (status, json) = anfrage(
        app,
        "GET",
        &format!("/api/einsaetze/{einsatz}/etb"),
        cookie,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{json:?}");
    json.as_array()
        .unwrap()
        .iter()
        .filter(|e| e["inhalt"].as_str().is_some_and(|i| i.contains(nadel)))
        .cloned()
        .collect()
}

/// Alle Einträge, die eine Übergabe der Einsatzleitung festhalten.
async fn uebergaben(app: &axum::Router, cookie: &str, einsatz: i64) -> Vec<Value> {
    etb_mit(app, cookie, einsatz, "Einsatzleitung").await
}

fn etb_events(rx: &mut Receiver<LiveNachricht>) -> usize {
    let mut n = 0;
    while let Ok(nachricht) = rx.try_recv() {
        if nachricht.event == LiveEvent::Etb {
            n += 1;
        }
    }
    n
}

#[tokio::test]
async fn einsatzleiter_als_person_mit_eingefrorenem_namen() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let anna = stammpersonal_disponieren(&app, &admin, einsatz, "Anna Schulz").await;

    let (status, json) = patchen(
        &app,
        &admin,
        einsatz,
        json!({"einsatzleiter": {"art": "personal", "personal_id": anna, "seit": "2026-10-11T12:30:00Z"}}),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{json:?}");
    assert_eq!(
        json["einsatzleiter"],
        json!({
            "art": "personal",
            "name": "Anna Schulz",
            "personal_id": anna,
            "personal_noch_disponiert": true,
            "seit": "2026-10-11 12:30:00",
        })
    );
    let (_, gelesen) = lesen(&app, &admin, einsatz).await;
    assert_eq!(gelesen["einsatzleiter"], json["einsatzleiter"]);
}

#[tokio::test]
async fn einsatzleiter_extern_ohne_seit_nimmt_die_serverzeit() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;

    let vorher = lifeline_hub::zeit::jetzt();
    let (status, json) = patchen(
        &app,
        &admin,
        einsatz,
        json!({"einsatzleiter": {"art": "extern", "name": "  KBM Weber  "}}),
    )
    .await;
    let nachher = lifeline_hub::zeit::jetzt();
    assert_eq!(status, StatusCode::OK, "{json:?}");
    let el = &json["einsatzleiter"];
    assert_eq!(el["art"], "extern");
    assert_eq!(el["name"], "KBM Weber", "Freitext wird getrimmt");
    assert!(el.get("personal_id").is_none(), "{el:?}");
    assert_eq!(el["personal_noch_disponiert"], false);
    let seit = el["seit"].as_str().unwrap();
    assert!(
        vorher.as_str() <= seit && seit <= nachher.as_str(),
        "seit {seit} liegt nicht in [{vorher}, {nachher}]"
    );
}

#[tokio::test]
async fn einsatzleiter_leeren_und_fehlendes_feld_laesst_ihn_stehen() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    patchen(
        &app,
        &admin,
        einsatz,
        json!({"einsatzleiter": {"art": "extern", "name": "KBM Weber"}}),
    )
    .await;

    let (_, json) = patchen(&app, &admin, einsatz, json!({"rufname": "Florian 10/1"})).await;
    assert_eq!(json["einsatzleiter"]["name"], "KBM Weber");

    let (status, json) = patchen(&app, &admin, einsatz, json!({"einsatzleiter": null})).await;
    assert_eq!(status, StatusCode::OK, "{json:?}");
    assert!(json.get("einsatzleiter").is_none(), "{json:?}");
    assert_eq!(json["rufname"], "Florian 10/1");
}

#[tokio::test]
async fn einsatzleiter_feldpruefungen_sind_400() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let zu_lang = "x".repeat(lifeline_hub::einsatz::fuehrungsstelle::EINSATZLEITER_NAME_MAX + 1);
    for body in [
        json!({"einsatzleiter": {"art": "kommandant", "name": "X"}}),
        json!({"einsatzleiter": {"art": "extern", "name": "   "}}),
        json!({"einsatzleiter": {"art": "extern"}}),
        json!({"einsatzleiter": {"art": "extern", "name": zu_lang}}),
        json!({"einsatzleiter": {"art": "extern", "name": "X", "seit": "gestern"}}),
        json!({"einsatzleiter": {"art": "personal"}}),
    ] {
        let (status, json) = patchen(&app, &admin, einsatz, body.clone()).await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{body} → {json:?}");
    }
    let (_, json) = lesen(&app, &admin, einsatz).await;
    assert!(json.get("einsatzleiter").is_none(), "{json:?}");
}

#[tokio::test]
async fn einsatzleiter_zusammenhaenge_sind_422_und_speichern_nichts() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let anderer = einsatz_anlegen(&app, &admin).await;
    let fremd = stammpersonal_disponieren(&app, &admin, anderer, "Fritz Fremd").await;
    let eigen = stammpersonal_disponieren(&app, &admin, einsatz, "Anna Schulz").await;
    let zukunft = lifeline_hub::zeit::plus_minuten(&lifeline_hub::zeit::jetzt(), 60).unwrap();

    for body in [
        json!({"rufname": "R", "einsatzleiter": {"art": "personal", "personal_id": fremd}}),
        json!({"rufname": "R", "einsatzleiter": {"art": "personal", "personal_id": eigen, "name": "X"}}),
        json!({"rufname": "R", "einsatzleiter": {"art": "extern", "name": "X", "personal_id": eigen}}),
        json!({"rufname": "R", "einsatzleiter": {"art": "extern", "name": "X", "seit": zukunft}}),
    ] {
        let (status, json) = patchen(&app, &admin, einsatz, body.clone()).await;
        assert_eq!(
            status,
            StatusCode::UNPROCESSABLE_ENTITY,
            "{body} → {json:?}"
        );
    }
    let (_, json) = lesen(&app, &admin, einsatz).await;
    assert!(json.get("einsatzleiter").is_none(), "{json:?}");
    assert!(
        json.get("rufname").is_none(),
        "nichts teilweise gespeichert: {json:?}"
    );
    assert!(uebergaben(&app, &admin, einsatz).await.is_empty());
}

#[tokio::test]
async fn einsatzleiter_am_abgeschlossenen_einsatz_ist_409() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/abschliessen"),
        &admin,
        None,
    )
    .await;
    let (status, _) = patchen(
        &app,
        &admin,
        einsatz,
        json!({"einsatzleiter": {"art": "extern", "name": "KBM Weber"}}),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT);
}

#[tokio::test]
async fn beobachter_ohne_personal_liest_den_namen() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let anna = stammpersonal_disponieren(&app, &admin, einsatz, "Anna Schulz").await;
    patchen(
        &app,
        &admin,
        einsatz,
        json!({"einsatzleiter": {"art": "personal", "personal_id": anna}}),
    )
    .await;
    let id = benutzer_anlegen(&app, &admin, "beobachterin", "keine").await;
    rolle_setzen(&app, &admin, einsatz, id, "beobachter").await;
    let bea = login_cookie(&app, "beobachterin", "beobachterinpw1").await;
    // Die Führungsstelle liest jeder mit dem Einsatz, ohne Modul Personal (D2).
    let (status, json) = lesen(&app, &bea, einsatz).await;
    assert_eq!(status, StatusCode::OK, "{json:?}");
    assert_eq!(json["einsatzleiter"]["name"], "Anna Schulz");
    assert!(json["einsatzleiter"]["seit"].is_string());
}

#[tokio::test]
async fn entlassene_person_bleibt_mit_vermerk() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let anna = stammpersonal_disponieren(&app, &admin, einsatz, "Anna Schulz").await;
    patchen(
        &app,
        &admin,
        einsatz,
        json!({"einsatzleiter": {"art": "personal", "personal_id": anna}}),
    )
    .await;
    let (status, _) = anfrage(
        &app,
        "DELETE",
        &format!("/api/einsaetze/{einsatz}/personal/{anna}"),
        &admin,
        None,
    )
    .await;
    assert!(status.is_success(), "entlassen: {status}");

    let (_, json) = lesen(&app, &admin, einsatz).await;
    let el = &json["einsatzleiter"];
    assert_eq!(el["art"], "personal");
    assert_eq!(el["name"], "Anna Schulz");
    assert!(el.get("personal_id").is_none(), "{el:?}");
    assert_eq!(el["personal_noch_disponiert"], false);
}

#[tokio::test]
async fn setzen_wechseln_leeren_schreibt_je_genau_einen_eintrag() {
    let (app, _pool, live) = setup_mit_pool_und_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let anna = stammpersonal_disponieren(&app, &admin, einsatz, "Anna Schulz").await;
    let mut rx = live.abonniere(einsatz);

    // Erstes Setzen, mit „seit“ als Ereigniszeit.
    let (status, json) = patchen(
        &app,
        &admin,
        einsatz,
        json!({"einsatzleiter": {"art": "personal", "personal_id": anna, "seit": "2026-10-11T12:00:00Z"}}),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{json:?}");
    let eintraege = uebergaben(&app, &admin, einsatz).await;
    assert_eq!(eintraege.len(), 1, "{eintraege:?}");
    assert_eq!(
        eintraege[0]["inhalt"],
        "Einsatzleitung übernommen: Anna Schulz"
    );
    assert_eq!(eintraege[0]["typ"], "system");
    assert_eq!(eintraege[0]["ereigniszeit"], "2026-10-11 12:00:00");
    assert_eq!(etb_events(&mut rx), 1);

    // Wechsel an einen externen Einsatzleiter.
    patchen(
        &app,
        &admin,
        einsatz,
        json!({"einsatzleiter": {"art": "extern", "name": "KBM Weber", "seit": "2026-10-11T12:30:00Z"}}),
    )
    .await;
    let wechsel = etb_mit(&app, &admin, einsatz, "Übergabe der Einsatzleitung").await;
    assert_eq!(wechsel.len(), 1, "{wechsel:?}");
    assert_eq!(
        wechsel[0]["inhalt"],
        "Übergabe der Einsatzleitung von Anna Schulz an KBM Weber (extern)"
    );
    assert_eq!(wechsel[0]["ereigniszeit"], "2026-10-11 12:30:00");
    assert_eq!(etb_events(&mut rx), 1);

    // Leeren: Ereigniszeit ist die Zeit des Speicherns.
    patchen(&app, &admin, einsatz, json!({"einsatzleiter": null})).await;
    let leer = etb_mit(&app, &admin, einsatz, "nicht mehr erfasst").await;
    assert_eq!(leer.len(), 1, "{leer:?}");
    assert_eq!(
        leer[0]["inhalt"],
        "Einsatzleitung nicht mehr erfasst (vorher: KBM Weber (extern))"
    );
    assert_eq!(etb_events(&mut rx), 1);
    assert_eq!(uebergaben(&app, &admin, einsatz).await.len(), 3);

    // Erneutes Leeren ändert nichts und schreibt nichts.
    patchen(&app, &admin, einsatz, json!({"einsatzleiter": null})).await;
    assert_eq!(uebergaben(&app, &admin, einsatz).await.len(), 3);
    assert_eq!(etb_events(&mut rx), 0);
}

#[tokio::test]
async fn gleiche_wahl_mit_anderem_seit_schreibt_keinen_eintrag() {
    let (app, _pool, live) = setup_mit_pool_und_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let anna = stammpersonal_disponieren(&app, &admin, einsatz, "Anna Schulz").await;
    patchen(
        &app,
        &admin,
        einsatz,
        json!({"einsatzleiter": {"art": "personal", "personal_id": anna, "seit": "2026-10-11T12:00:00Z"}}),
    )
    .await;
    let mut rx = live.abonniere(einsatz);

    let (status, json) = patchen(
        &app,
        &admin,
        einsatz,
        json!({"einsatzleiter": {"art": "personal", "personal_id": anna, "seit": "2026-10-11T11:45:00Z"}}),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{json:?}");
    assert_eq!(json["einsatzleiter"]["seit"], "2026-10-11 11:45:00");
    assert_eq!(uebergaben(&app, &admin, einsatz).await.len(), 1);
    assert_eq!(etb_events(&mut rx), 0);

    // Derselbe externe Name ebenso.
    patchen(
        &app,
        &admin,
        einsatz,
        json!({"einsatzleiter": {"art": "extern", "name": "KBM Weber"}}),
    )
    .await;
    patchen(
        &app,
        &admin,
        einsatz,
        json!({"einsatzleiter": {"art": "extern", "name": " KBM Weber "}}),
    )
    .await;
    assert_eq!(uebergaben(&app, &admin, einsatz).await.len(), 2);

    // Eine andere Angabe schreibt keinen Eintrag.
    patchen(&app, &admin, einsatz, json!({"rufname": "Florian 10/1"})).await;
    assert_eq!(uebergaben(&app, &admin, einsatz).await.len(), 2);
}

/// Der Übergabe-Eintrag ist Teil der Änderung: scheitert er (hier ein unbekannter Erfasser, der
/// den Fremdschlüssel des ETB verletzt), ist auch der Einsatzleiter nach dem Rollback fort.
#[tokio::test]
async fn scheitert_der_etb_eintrag_scheitert_die_aenderung() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;

    let mut tx = pool.begin().await.unwrap();
    let patch = lifeline_hub::einsatz::fuehrungsstelle::FuehrungsstellePatch {
        rufname: Some(Some("Florian 10/1")),
        einsatzleiter: Some(Some(
            lifeline_hub::einsatz::fuehrungsstelle::EinsatzleiterEingabe::Extern {
                name: "KBM Weber",
                seit: "2026-10-11 12:00:00",
            },
        )),
        ..Default::default()
    };
    let schreiber = lifeline_hub::einsatz::fuehrungsstelle::Schreiber {
        benutzer_id: 987_654,
        etb_startwert: 1,
    };
    let ergebnis =
        lifeline_hub::einsatz::fuehrungsstelle::patchen_tx(&mut tx, einsatz, schreiber, &patch)
            .await;
    assert!(
        ergebnis.is_err(),
        "unbekannter Erfasser verletzt den Fremdschlüssel"
    );
    drop(tx);

    assert_eq!(
        lesen(&app, &admin, einsatz).await.1,
        json!({"sprechgruppen": [], "fahrzeug_ids": []})
    );
}

/// Der Extractor prüft den Lebenszyklus VOR der Transaktion; ein Abschluss kann dazwischenliegen.
/// Das Repo schreibt in einen abgeschlossenen Einsatz weder Einsatzleiter noch Übergabe (D3).
#[tokio::test]
async fn repo_lehnt_den_abgeschlossenen_einsatz_in_der_transaktion_ab() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/abschliessen"),
        &admin,
        None,
    )
    .await;

    let mut tx = pool.begin().await.unwrap();
    let patch = lifeline_hub::einsatz::fuehrungsstelle::FuehrungsstellePatch {
        einsatzleiter: Some(Some(
            lifeline_hub::einsatz::fuehrungsstelle::EinsatzleiterEingabe::Extern {
                name: "KBM Weber",
                seit: "2026-10-11 12:00:00",
            },
        )),
        ..Default::default()
    };
    let ergebnis = lifeline_hub::einsatz::fuehrungsstelle::patchen_tx(
        &mut tx,
        einsatz,
        admin_schreiber(),
        &patch,
    )
    .await;
    assert!(
        matches!(ergebnis, Err(lifeline_hub::error::AppError::Conflict(_))),
        "{ergebnis:?}"
    );
}

#[tokio::test]
async fn abgelehnte_aenderung_meldet_kein_etb() {
    let (app, _pool, live) = setup_mit_pool_und_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let anderer = einsatz_anlegen(&app, &admin).await;
    let fremd = stammpersonal_disponieren(&app, &admin, anderer, "Fritz Fremd").await;
    let mut rx = live.abonniere(einsatz);
    let (status, _) = patchen(
        &app,
        &admin,
        einsatz,
        json!({"einsatzleiter": {"art": "personal", "personal_id": fremd}}),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(etb_events(&mut rx), 0);
}

#[tokio::test]
async fn schwaerzung_nullt_den_namen_des_einsatzleiters() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let anna = stammpersonal_disponieren(&app, &admin, einsatz, "Anna Schulz").await;
    let (status, vorher) = patchen(
        &app,
        &admin,
        einsatz,
        json!({
            "rufname": "Florian 10/1",
            "erreichbarkeit": "0171 1234567",
            "einsatzleiter": {"art": "personal", "personal_id": anna, "seit": "2026-10-11T12:00:00Z"},
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
    let el = nachher.einsatzleiter.expect("Art und seit bleiben");
    assert_eq!(el.name, None);
    assert_eq!(el.seit, "2026-10-11 12:00:00");
    assert_eq!(
        el.art,
        lifeline_hub::einsatz::fuehrungsstelle::EinsatzleiterArt::Personal
    );
}
