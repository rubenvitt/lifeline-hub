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
        json!({"art": "mobil", "sprechgruppen": [], "fahrzeug_ids": []}),
        "leere Angaben fehlen im JSON, die Art steht mit ihrer Vorgabe (LFH-1181)"
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
        json!({"art": "mobil", "sprechgruppen": [], "fahrzeug_ids": []}),
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
    assert_eq!(
        json,
        json!({"art": "mobil", "sprechgruppen": [], "fahrzeug_ids": []})
    );
}

#[tokio::test]
async fn leerer_patch_legt_nichts_an() {
    let (app, pool, live) = setup_mit_pool_und_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let mut rx = live.abonniere(einsatz);

    let (status, json) = patchen(&app, &admin, einsatz, json!({})).await;
    assert_eq!(status, StatusCode::OK, "{json:?}");
    assert_eq!(
        json,
        json!({"art": "mobil", "sprechgruppen": [], "fahrzeug_ids": []})
    );
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
    let ergebnis = lifeline_hub::einsatz::fuehrungsstelle::patch_tx(
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
        json!({"art": "mobil", "sprechgruppen": [], "fahrzeug_ids": []})
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
        json!({"art": "mobil", "sprechgruppen": [], "fahrzeug_ids": [elw.min(kdow), elw.max(kdow)]}),
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
        json!({"art": "mobil", "sprechgruppen": [], "fahrzeug_ids": []}),
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

    let nachher = lifeline_hub::einsatz::fuehrungsstelle::load(&pool, einsatz)
        .await
        .unwrap();
    assert_eq!(nachher.erreichbarkeit, None);
    assert_eq!(nachher.rufname.as_deref(), Some("Florian 10/1"));
    assert_eq!(nachher.kommunikationsmittel.as_deref(), Some("digitalfunk"));
    assert_eq!(nachher.sprechgruppen.len(), 1);
}

#[tokio::test]
async fn schwaerzung_nullt_den_standort_und_laesst_art_und_bezeichnung() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let (status, vorher) = patchen(
        &app,
        &admin,
        einsatz,
        json!({
            "art": "ortsfest",
            "bezeichnung": "ELW 2 Musterstadt",
            "standort_adresse": "Hauptstraße 1, Musterstadt",
            "standort_lat": 52.1,
            "standort_lon": 9.9,
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

    let nachher = lifeline_hub::einsatz::fuehrungsstelle::load(&pool, einsatz)
        .await
        .unwrap();
    assert_eq!(nachher.standort_adresse, None);
    assert_eq!(nachher.standort_lat, None);
    assert_eq!(nachher.standort_lon, None);
    assert_eq!(nachher.bezeichnung.as_deref(), Some("ELW 2 Musterstadt"));
    assert_eq!(
        nachher.art,
        lifeline_hub::einsatz::fuehrungsstelle::FuehrungsstellenArt::Ortsfest
    );
}

// ---------- Art, Bezeichnung, Standort (LFH-1181) ----------

#[tokio::test]
async fn nur_die_art_macht_die_stelle_nicht_erfasst() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;

    let (status, json) = patchen(&app, &admin, einsatz, json!({"art": "ortsfest"})).await;
    assert_eq!(status, StatusCode::OK, "{json:?}");
    assert_eq!(
        json,
        json!({"art": "ortsfest", "sprechgruppen": [], "fahrzeug_ids": []}),
        "keine weitere Angabe gesetzt"
    );
    assert_eq!(lesen(&app, &admin, einsatz).await.1["art"], "ortsfest");
}

#[tokio::test]
async fn unbekannte_art_ist_400_und_speichert_nichts() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;

    let (status, _) = patchen(
        &app,
        &admin,
        einsatz,
        json!({"art": "stationaer", "rufname": "Florian 10/1"}),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    let json = lesen(&app, &admin, einsatz).await.1;
    assert!(json.get("rufname").is_none(), "{json:?}");
    assert_eq!(json["art"], "mobil");
}

#[tokio::test]
async fn art_laesst_sich_nicht_leeren() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    patchen(&app, &admin, einsatz, json!({"art": "ortsfest"})).await;

    for leer in [json!(null), json!(""), json!("  ")] {
        let (status, _) = patchen(&app, &admin, einsatz, json!({ "art": leer })).await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "art = {leer}");
    }
    assert_eq!(lesen(&app, &admin, einsatz).await.1["art"], "ortsfest");
}

#[tokio::test]
async fn bezeichnung_und_standort_einzeln_und_leeren() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;

    let (status, json) = patchen(
        &app,
        &admin,
        einsatz,
        json!({"bezeichnung": "  TEL Rathaus  "}),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{json:?}");
    assert_eq!(json["bezeichnung"], "TEL Rathaus", "getrimmt");
    assert!(json.get("standort_adresse").is_none());

    let (status, json) = patchen(
        &app,
        &admin,
        einsatz,
        json!({
            "standort_adresse": "Hauptstraße 1, Musterstadt",
            "standort_lat": 52.1,
            "standort_lon": 9.9,
        }),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{json:?}");
    assert_eq!(json["bezeichnung"], "TEL Rathaus", "unverändert");
    assert_eq!(json["standort_adresse"], "Hauptstraße 1, Musterstadt");
    assert_eq!(json["standort_lat"], 52.1);
    assert_eq!(json["standort_lon"], 9.9);

    let (status, json) = patchen(
        &app,
        &admin,
        einsatz,
        json!({"standort_lat": null, "standort_lon": null, "bezeichnung": ""}),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{json:?}");
    assert!(json.get("standort_lat").is_none(), "{json:?}");
    assert!(json.get("standort_lon").is_none(), "{json:?}");
    assert!(json.get("bezeichnung").is_none(), "{json:?}");
    assert_eq!(json["standort_adresse"], "Hauptstraße 1, Musterstadt");
}

#[tokio::test]
async fn bezeichnung_und_adresse_haben_grenzen() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;

    let (status, _) = patchen(
        &app,
        &admin,
        einsatz,
        json!({"bezeichnung": "x".repeat(201), "rufname": "Florian"}),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    let (status, _) = patchen(
        &app,
        &admin,
        einsatz,
        json!({"standort_adresse": "x".repeat(501)}),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert!(lesen(&app, &admin, einsatz)
        .await
        .1
        .get("rufname")
        .is_none());

    let (status, _) = patchen(
        &app,
        &admin,
        einsatz,
        json!({"bezeichnung": "x".repeat(200), "standort_adresse": "y".repeat(500)}),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "genau an der Grenze");
}

#[tokio::test]
async fn halbe_koordinate_ist_422_am_stand_nach_der_aenderung() {
    let (app, _pool, live) = setup_mit_pool_und_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let mut rx = live.abonniere(einsatz);

    let (status, _) = patchen(
        &app,
        &admin,
        einsatz,
        json!({"standort_lat": 52.1, "bezeichnung": "ELW 2"}),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    assert!(lesen(&app, &admin, einsatz)
        .await
        .1
        .get("bezeichnung")
        .is_none());
    assert_eq!(kopf_events(&mut rx), 0);

    // Mit gespeicherter Koordinate ändert ein einzelner Wert nur seine Hälfte.
    patchen(
        &app,
        &admin,
        einsatz,
        json!({"standort_lat": 52.1, "standort_lon": 9.9}),
    )
    .await;
    let (status, json) = patchen(&app, &admin, einsatz, json!({"standort_lat": 52.2})).await;
    assert_eq!(status, StatusCode::OK, "{json:?}");
    assert_eq!(json["standort_lat"], 52.2);
    assert_eq!(json["standort_lon"], 9.9);

    let (status, _) = patchen(&app, &admin, einsatz, json!({"standort_lon": null})).await;
    assert_eq!(
        status,
        StatusCode::UNPROCESSABLE_ENTITY,
        "nur eine Hälfte leeren"
    );
}

#[tokio::test]
async fn koordinate_ausserhalb_ist_422() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;

    for (lat, lon) in [(95.0, 9.9), (52.1, 181.0), (-90.5, 0.0)] {
        let (status, _) = patchen(
            &app,
            &admin,
            einsatz,
            json!({"standort_lat": lat, "standort_lon": lon}),
        )
        .await;
        assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{lat}/{lon}");
    }
}

#[tokio::test]
async fn nur_die_adresse_wird_gespeichert() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;

    let (status, _) = patchen(
        &app,
        &admin,
        einsatz,
        json!({"standort_adresse": "Rathaus, Marktplatz 1"}),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let json = lesen(&app, &admin, einsatz).await.1;
    assert_eq!(json["standort_adresse"], "Rathaus, Marktplatz 1");
    assert!(json.get("standort_lat").is_none(), "{json:?}");
}

#[tokio::test]
async fn feldfehler_400_geht_vor_dem_zusammenhang_422() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;

    let (status, _) = patchen(
        &app,
        &admin,
        einsatz,
        json!({"art": "stationaer", "standort_lat": 95.0, "standort_lon": 0.0}),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
}

// ---------- Einsatzleiter (LFH-1199) ----------
//
// Spec `einsatz-fuehrungsstelle`, „Einsatzleiter als Person oder Freitext“ und „Übergabe der
// Einsatzleitung im ETB“. Herleitung:
// `openspec/changes/archive/2026-10-11-lfh-1199-einsatzleiter-angabe/design.md` (D1–D3).

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

/// Das Entlassen feuert `personal`, das nur Leser mit Personal- oder Kartenrecht erreicht; die
/// Führungsstelle liest jeder. Den Vermerk „nicht mehr disponiert“ trägt deshalb `einsatz`, wie
/// beim Entlassen eines getragenen Fahrzeugs (LLH-1164).
#[tokio::test]
async fn entlassen_des_einsatzleiters_feuert_einsatz() {
    let (app, _pool, live) = setup_mit_pool_und_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    // Eine Stamm-Person ohne Einsatz, damit Stamm- und Dispositionskennung auseinanderfallen.
    stammpersonal_anlegen(&app, &admin, "Carla Ohne").await;
    let anna = stammpersonal_disponieren(&app, &admin, einsatz, "Anna Schulz").await;
    let bernd = stammpersonal_disponieren(&app, &admin, einsatz, "Bernd Kurz").await;
    let (status, _) = patchen(
        &app,
        &admin,
        einsatz,
        json!({"einsatzleiter": {"art": "personal", "personal_id": anna}}),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let mut rx = live.abonniere(einsatz);

    let entlassen = |ep: i64| {
        let (app, admin) = (app.clone(), admin.clone());
        async move {
            anfrage(
                &app,
                "DELETE",
                &format!("/api/einsaetze/{einsatz}/personal/{ep}"),
                &admin,
                None,
            )
            .await
            .0
        }
    };
    assert_eq!(entlassen(bernd).await, StatusCode::NO_CONTENT);
    assert_eq!(
        kopf_events(&mut rx),
        0,
        "kein Einsatzleiter, kein Kopf-Ereignis"
    );
    assert_eq!(entlassen(anna).await, StatusCode::NO_CONTENT);
    assert_eq!(
        kopf_events(&mut rx),
        1,
        "der Einsatzleiter ist nicht mehr disponiert"
    );
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
        lifeline_hub::einsatz::fuehrungsstelle::patch_tx(&mut tx, einsatz, schreiber, &patch).await;
    assert!(
        ergebnis.is_err(),
        "unbekannter Erfasser verletzt den Fremdschlüssel"
    );
    drop(tx);

    assert_eq!(
        lesen(&app, &admin, einsatz).await.1,
        json!({"art": "mobil", "sprechgruppen": [], "fahrzeug_ids": []})
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
    let ergebnis = lifeline_hub::einsatz::fuehrungsstelle::patch_tx(
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

    let nachher = lifeline_hub::einsatz::fuehrungsstelle::load(&pool, einsatz)
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

// ── Einsatzleiter an der Einsatzanzeige (LLH-1168) ─────────────────────────────────────────
// Spec `einsatz-fuehrungsstelle`, „Einsatzleiter in der Einsatzanzeige“. Herleitung:
// `openspec/changes/b1tfx66d-einsatzleiter-kommplan-einsatzliste/design.md` (D1–D3).

/// Der Eintrag `einsatz` aus `GET /api/einsaetze`.
async fn listeneintrag(app: &axum::Router, cookie: &str, einsatz: i64) -> Value {
    let (status, json) = anfrage(app, "GET", "/api/einsaetze", cookie, None).await;
    assert_eq!(status, StatusCode::OK, "{json:?}");
    json.as_array()
        .unwrap()
        .iter()
        .find(|e| e["id"].as_i64() == Some(einsatz))
        .cloned()
        .expect("Einsatz steht in der Liste")
}

async fn detail(app: &axum::Router, cookie: &str, einsatz: i64) -> Value {
    let (status, json) = anfrage(
        app,
        "GET",
        &format!("/api/einsaetze/{einsatz}"),
        cookie,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{json:?}");
    json
}

#[tokio::test]
async fn liste_und_detail_tragen_den_einsatzleiter() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let anna = stammpersonal_disponieren(&app, &admin, einsatz, "Anna Schulz").await;
    let (status, json) = patchen(
        &app,
        &admin,
        einsatz,
        json!({"einsatzleiter": {"art": "personal", "personal_id": anna, "seit": "2026-10-12T12:30:00Z"}}),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{json:?}");

    let erwartet = json!({
        "art": "personal",
        "name": "Anna Schulz",
        "personal_id": anna,
        "personal_noch_disponiert": true,
        "seit": "2026-10-12 12:30:00",
    });
    assert_eq!(
        listeneintrag(&app, &admin, einsatz).await["einsatzleiter"],
        erwartet
    );
    assert_eq!(
        detail(&app, &admin, einsatz).await["einsatzleiter"],
        erwartet
    );
}

#[tokio::test]
async fn ohne_einsatzleiter_fehlt_das_feld_auch_bei_app_rolle() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    // Der Anleger trägt die App-Rolle Einsatzleitung; das ist kein Einsatzleiter.
    let eintrag = listeneintrag(&app, &admin, einsatz).await;
    assert_eq!(eintrag["meine_rolle"], "einsatzleitung");
    assert!(
        !eintrag.as_object().unwrap().contains_key("einsatzleiter"),
        "{eintrag}"
    );
    let kopf = detail(&app, &admin, einsatz).await;
    assert!(
        !kopf.as_object().unwrap().contains_key("einsatzleiter"),
        "{kopf}"
    );
}

#[tokio::test]
async fn liste_traegt_den_vermerk_einer_entlassenen_person() {
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

    let el = &listeneintrag(&app, &admin, einsatz).await["einsatzleiter"];
    assert_eq!(el["name"], "Anna Schulz");
    assert_eq!(el["personal_noch_disponiert"], false);
    assert!(el.get("personal_id").is_none(), "{el:?}");
}

#[tokio::test]
async fn liste_liefert_den_geschwaerzten_einsatzleiter_ohne_namen() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    patchen(
        &app,
        &admin,
        einsatz,
        json!({"einsatzleiter": {"art": "extern", "name": "Anna Schulz", "seit": "2026-10-12T12:00:00Z"}}),
    )
    .await;

    let mut tx = pool.begin().await.unwrap();
    lifeline_hub::einsatz::schwaerzung_registry::scrubbe_aus_registry(
        &mut tx,
        einsatz,
        lifeline_hub::einsatz::schwaerzung_registry::Umfang::Alles,
    )
    .await
    .unwrap();
    tx.commit().await.unwrap();

    let (status, liste) = anfrage(&app, "GET", "/api/einsaetze", &admin, None).await;
    assert_eq!(status, StatusCode::OK);
    assert!(!liste.to_string().contains("Anna Schulz"), "{liste}");
    let el = &listeneintrag(&app, &admin, einsatz).await["einsatzleiter"];
    assert_eq!(el["art"], "extern");
    assert!(el.get("name").is_none(), "{el:?}");
    assert_eq!(el["seit"], "2026-10-12 12:00:00");
}

#[tokio::test]
async fn lage_snapshot_friert_keinen_einsatzleiter_ein() {
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
    let (status, snapshot) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/lage-snapshots"),
        &admin,
        Some(r#"{"bezeichnung":"Stand 1"}"#),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{snapshot:?}");
    let eingefroren = snapshot["daten"]["einsatz"]
        .as_object()
        .expect("Einsatz im Snapshot");
    assert!(
        !eingefroren.contains_key("einsatzleiter"),
        "{eingefroren:?}"
    );
    assert!(!snapshot.to_string().contains("KBM Weber"), "{snapshot}");
}

/// Szenario „Wechsel auf einem anderen Schirm“ der Einsatzliste: der Wechsel meldet nach dem
/// Commit `einsatzliste`, auf das die Liste im Browser neu abruft (`ORG_STREAM_EVENTS`).
#[tokio::test]
async fn wechsel_des_einsatzleiters_meldet_die_einsatzliste() {
    let (app, _pool, live) = setup_mit_pool_und_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let mut rx = live.abonniere_org();
    let listen_events = |rx: &mut Receiver<lifeline_hub::live::org::OrgNachricht>| {
        let mut n = 0;
        while let Ok(nachricht) = rx.try_recv() {
            if nachricht.event == lifeline_hub::live::org::OrgLiveEvent::Einsatzliste {
                n += 1;
            }
        }
        n
    };

    let (status, json) = patchen(
        &app,
        &admin,
        einsatz,
        json!({"einsatzleiter": {"art": "extern", "name": "KBM Weber"}}),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{json:?}");
    assert_eq!(listen_events(&mut rx), 1);

    // Abgelehnt: kein Ereignis.
    let (status, _) = patchen(
        &app,
        &admin,
        einsatz,
        json!({"einsatzleiter": {"art": "extern", "name": "   "}}),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(listen_events(&mut rx), 0);
}
