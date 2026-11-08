//! Integrationstests der Kopplung Schichtplan → Ablösung (LLH-1555, Change
//! `qo0amhd5-wechsel-aus-schichtplan`, Spec `kraefte-abloesung` „Fälligkeit laut Plan“ und
//! „Vollzug aus dem Plan“): Der Plan gibt einer laufenden Schicht die Fälligkeit, jede Änderung am
//! Block zieht Fälligkeit, Vorwarnung und Planungshinweis nach, und der Vollzug übernimmt die
//! Vorlage des Folgeblocks. Die Regel der Fälligkeit im Einzelnen prüft
//! `src/abloesung/schichtplan/kopplung.rs`.

use axum::http::StatusCode;
use chrono::{DateTime, Duration, DurationRound, Utc};
use serde_json::{json, Value};

mod common;
use common::*;

fn abloesung_pfad(einsatz: i64) -> String {
    format!("/api/einsaetze/{einsatz}/abloesungen")
}

fn plan(einsatz: i64) -> String {
    format!("/api/einsaetze/{einsatz}/abloesungen/schichtplan")
}

fn f(t: DateTime<Utc>) -> String {
    t.format("%Y-%m-%d %H:%M:%S").to_string()
}

/// Jetzt auf dem Raster des Plans (5 min).
fn jetzt() -> DateTime<Utc> {
    Utc::now().duration_trunc(Duration::minutes(5)).unwrap()
}

/// Offene Auto-Fristen einer Schicht als (bezug_typ, faellig_at), sortiert.
async fn fristen(pool: &sqlx::SqlitePool, schicht: i64) -> Vec<(String, String)> {
    sqlx::query_as(
        "SELECT bezug_typ, faellig_at FROM erinnerung \
         WHERE quelle = 'auto_frist' AND status = 'offen' AND bezug_id = ? \
           AND bezug_typ IN ('abloesung', 'abloesung_vorwarnung', 'abloesung_planung') \
         ORDER BY bezug_typ",
    )
    .bind(schicht)
    .fetch_all(pool)
    .await
    .unwrap()
}

fn frist(typ: &str, t: DateTime<Utc>) -> (String, String) {
    (typ.to_string(), f(t))
}

async fn schicht(app: &axum::Router, cookie: &str, e: i64, id: i64) -> Value {
    let (s, liste) = anfrage(app, "GET", &abloesung_pfad(e), cookie, None).await;
    assert_eq!(s, StatusCode::OK);
    liste
        .as_array()
        .unwrap()
        .iter()
        .find(|x| x["id"] == id)
        .cloned()
        .unwrap_or_else(|| panic!("Schicht {id} fehlt: {liste}"))
}

async fn beginnen(app: &axum::Router, cookie: &str, e: i64, einheit: i64, beginn: &str) -> Value {
    let (s, j) = anfrage_json(
        app,
        "POST",
        &abloesung_pfad(e),
        cookie,
        Some(&json!({"einheit_id": einheit, "rhythmus_minuten": 480, "beginn_at": beginn})),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{j}");
    j
}

/// Legt einen Block an der Einheit an; liefert seine Kennung.
async fn block(
    app: &axum::Router,
    cookie: &str,
    e: i64,
    einheit: i64,
    von: &str,
    bis: &str,
    personen: Value,
) -> i64 {
    let (s, p) = anfrage_json(
        app,
        "POST",
        &format!("{}/bloecke", plan(e)),
        cookie,
        Some(&json!({"posten": {"art": "einheit", "einheit_id": einheit},
                     "von": von, "bis": bis, "personen": personen})),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{p}");
    p["bloecke"]
        .as_array()
        .unwrap()
        .iter()
        .find(|b| b["posten"]["einheit_id"] == einheit && b["von"] == von)
        .unwrap()["id"]
        .as_i64()
        .unwrap()
}

async fn block_patch(app: &axum::Router, cookie: &str, e: i64, bid: i64, body: Value) {
    let (s, p) = anfrage_json(
        app,
        "PATCH",
        &format!("{}/bloecke/{bid}", plan(e)),
        cookie,
        Some(&body),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{p}");
}

async fn block_loeschen(app: &axum::Router, cookie: &str, e: i64, bid: i64, version: i64) {
    let (s, p) = anfrage(
        app,
        "DELETE",
        &format!("{}/bloecke/{bid}?version={version}", plan(e)),
        cookie,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::NO_CONTENT, "{p:?}");
}

/// Eine ad hoc disponierte Person, optional einer Einheit zugeordnet.
async fn adhoc(app: &axum::Router, cookie: &str, e: i64, name: &str, einheit: Option<i64>) -> i64 {
    let (s, p) = anfrage_json(
        app,
        "POST",
        &format!("/api/einsaetze/{e}/personal"),
        cookie,
        Some(&json!({"adhoc": {"name": name}})),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{p}");
    let id = p["id"].as_i64().unwrap();
    if let Some(einheit) = einheit {
        let (s, j) = anfrage(
            app,
            "PUT",
            &format!("/api/einsaetze/{e}/einheiten/{einheit}/personal/{id}"),
            cookie,
            None,
        )
        .await;
        assert_eq!(s, StatusCode::NO_CONTENT, "{j:?}");
    }
    id
}

/// Die Personen einer Einheit, sortiert.
async fn mitglieder(app: &axum::Router, cookie: &str, e: i64, einheit: i64) -> Vec<i64> {
    let (_, liste) = anfrage(
        app,
        "GET",
        &format!("/api/einsaetze/{e}/einheiten"),
        cookie,
        None,
    )
    .await;
    let mut ids: Vec<i64> = liste
        .as_array()
        .unwrap()
        .iter()
        .find(|x| x["id"] == einheit)
        .unwrap()["personal_mitglieder"]
        .as_array()
        .unwrap()
        .iter()
        .map(|m| m["ep_id"].as_i64().unwrap())
        .collect();
    ids.sort_unstable();
    ids
}

async fn etb_mit(app: &axum::Router, cookie: &str, e: i64, nadel: &str) -> usize {
    let (_, etb) = anfrage(app, "GET", &format!("/api/einsaetze/{e}/etb"), cookie, None).await;
    etb.as_array()
        .unwrap()
        .iter()
        .filter(|x| x["inhalt"].as_str().is_some_and(|i| i.contains(nadel)))
        .count()
}

/// Akzeptanzkriterium 1 (LLH-1555): Ein verschobenes Blockende verschiebt Fälligkeit und
/// Vorwarnung. Dazu: ohne Folgeblock endet der Posten (kein Planungshinweis), ein leerer
/// Folgeblock braucht Planung, ein besetzter gilt als geplant; der Rhythmus ist laut Plan
/// gesperrt; ohne den deckenden Block zieht der nächste Block vor, ohne Blöcke gilt wieder die
/// Rangfolge.
#[tokio::test]
async fn blockende_verschiebt_faelligkeit_und_vorwarnung() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let rtw = einheit_bilden(&app, &admin, e, "RTW 1").await;
    let t = jetzt();
    let beginn = t - Duration::minutes(30);
    let b1 = block(
        &app,
        &admin,
        e,
        rtw,
        &f(beginn),
        &f(t + Duration::hours(3)),
        json!([]),
    )
    .await;

    let s = beginnen(&app, &admin, e, rtw, &f(beginn)).await;
    let id = s["id"].as_i64().unwrap();
    assert_eq!(s["faellig_at"], f(t + Duration::hours(3)), "{s}");
    assert_eq!(s["faellig_laut_plan"], true);
    assert!(
        s.get("plan_folgeblock").is_none(),
        "ohne Folgeblock endet der Posten"
    );
    assert_eq!(
        fristen(&pool, id).await,
        vec![
            frist("abloesung", t + Duration::hours(3)),
            frist("abloesung_vorwarnung", t + Duration::minutes(150)),
        ],
        "Posten endet: kein Planungshinweis"
    );

    // Blockende 1 h später: Fälligkeit und Vorwarnung wandern mit.
    block_patch(
        &app,
        &admin,
        e,
        b1,
        json!({"version": 1, "bis": f(t + Duration::hours(4))}),
    )
    .await;
    let s = schicht(&app, &admin, e, id).await;
    assert_eq!(s["faellig_at"], f(t + Duration::hours(4)));
    assert_eq!(
        fristen(&pool, id).await,
        vec![
            frist("abloesung", t + Duration::hours(4)),
            frist("abloesung_vorwarnung", t + Duration::minutes(210)),
        ]
    );

    // Ein leerer Folgeblock braucht Planung (2 h vorher), ein besetzter nicht mehr.
    let b2 = block(
        &app,
        &admin,
        e,
        rtw,
        &f(t + Duration::hours(4)),
        &f(t + Duration::hours(6)),
        json!([]),
    )
    .await;
    let s = schicht(&app, &admin, e, id).await;
    assert_eq!(s["plan_folgeblock"]["id"], b2, "{s}");
    assert_eq!(s["plan_folgeblock"]["personen"], 0);
    assert_eq!(
        fristen(&pool, id).await,
        vec![
            frist("abloesung", t + Duration::hours(4)),
            frist("abloesung_planung", t + Duration::hours(2)),
            frist("abloesung_vorwarnung", t + Duration::minutes(210)),
        ]
    );
    let ben = adhoc(&app, &admin, e, "Ben", None).await;
    block_patch(
        &app,
        &admin,
        e,
        b2,
        json!({"version": 1, "personen": [{"art": "einsatz", "einsatz_personal_id": ben}]}),
    )
    .await;
    let s = schicht(&app, &admin, e, id).await;
    assert_eq!(s["plan_folgeblock"]["personen"], 1);
    assert_eq!(
        fristen(&pool, id).await.len(),
        2,
        "besetzter Folgeblock gilt als geplant"
    );

    // Laut Plan ändert sich der Rhythmus nicht von Hand.
    let (st, j) = anfrage_json(
        &app,
        "PATCH",
        &format!("{}/{id}", abloesung_pfad(e)),
        &admin,
        Some(&json!({"rhythmus_minuten": 240})),
    )
    .await;
    assert_eq!(st, StatusCode::UNPROCESSABLE_ENTITY, "{j}");

    // Ohne den deckenden Block zieht der nächste vor (vor der Fälligkeit nach Rhythmus).
    block_loeschen(&app, &admin, e, b1, 2).await;
    let s = schicht(&app, &admin, e, id).await;
    assert_eq!(s["faellig_at"], f(t + Duration::hours(4)));
    assert_eq!(s["faellig_laut_plan"], true);
    assert_eq!(s["plan_folgeblock"]["id"], b2);

    // Ohne Blöcke gilt wieder die Rangfolge: Beginn + 8 h.
    block_loeschen(&app, &admin, e, b2, 2).await;
    let s = schicht(&app, &admin, e, id).await;
    assert_eq!(s["faellig_at"], f(beginn + Duration::hours(8)));
    assert_eq!(s["faellig_laut_plan"], false);
    assert_eq!(
        fristen(&pool, id).await,
        vec![
            frist("abloesung", beginn + Duration::hours(8)),
            frist("abloesung_planung", beginn + Duration::hours(6)),
            frist("abloesung_vorwarnung", beginn + Duration::minutes(450)),
        ]
    );

    // Ein Block nach der Fälligkeit nach Rhythmus schiebt sie nicht hinaus.
    block(
        &app,
        &admin,
        e,
        rtw,
        &f(beginn + Duration::hours(9)),
        &f(beginn + Duration::hours(11)),
        json!([]),
    )
    .await;
    let s = schicht(&app, &admin, e, id).await;
    assert_eq!(s["faellig_at"], f(beginn + Duration::hours(8)));
    assert_eq!(s["faellig_laut_plan"], false);
}

/// Vollzug aus dem Plan (LLH-1555, design.md D5): Die Vorlage nennt Bleibende, Kommende (auch
/// Stamm-Personal und Helfer, die erst übernommen werden) und Gehende; der vorgezogene Vollzug
/// ankert die Folgeschicht im Folgeblock; die Rücknahme legt die Besatzung zurück, die
/// Übernommenen bleiben im Einsatz. Rechte und Zusammenhang: ohne Personal 403, fremde Bleibende
/// und ein falscher Block 422, Übernahme ohne Besatzungswechsel 422, doppelte Quelle 400.
#[tokio::test]
async fn vollzug_aus_dem_plan_mit_bleibenden_und_uebernahme() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let f1 = einheit_bilden(&app, &admin, e, "Florian 1").await;
    let anna = adhoc(&app, &admin, e, "Anna", Some(f1)).await;
    let dana = adhoc(&app, &admin, e, "Dana", Some(f1)).await;
    let fremd = adhoc(&app, &admin, e, "Fritz", None).await;
    let (s, ben) = anfrage_json(
        &app,
        "POST",
        "/api/personal",
        &admin,
        Some(&json!({"name": "Ben"})),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{ben}");
    let ben = ben["id"].as_i64().unwrap();
    let (s, cem) = anfrage_json(
        &app,
        "POST",
        &format!("{}/helfer", plan(e)),
        &admin,
        Some(&json!({"name": "Cem", "organisation": "THW"})),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{cem}");
    let cem = cem["id"].as_i64().unwrap();

    let t = jetzt();
    let wechsel = t + Duration::minutes(10);
    let einsatz = |id: i64| json!({"art": "einsatz", "einsatz_personal_id": id});
    let b1 = block(
        &app,
        &admin,
        e,
        f1,
        &f(t - Duration::hours(1)),
        &f(wechsel),
        json!([einsatz(anna), einsatz(dana)]),
    )
    .await;
    let b2 = block(
        &app,
        &admin,
        e,
        f1,
        &f(wechsel),
        &f(wechsel + Duration::hours(2)),
        json!([einsatz(dana), {"art": "stamm", "personal_id": ben},
               {"art": "helfer", "helfer_id": cem}]),
    )
    .await;
    let s = beginnen(&app, &admin, e, f1, &f(t - Duration::hours(1))).await;
    let aid = s["id"].as_i64().unwrap();
    assert_eq!(s["faellig_at"], f(wechsel));
    assert_eq!(s["plan_folgeblock"]["id"], b2);

    let (s, v) = anfrage_json(
        &app,
        "GET",
        &format!("{}/{aid}/plan-vorlage", abloesung_pfad(e)),
        &admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert_eq!(v["folgeblock_id"], b2);
    assert_eq!(v["wechsel_at"], f(wechsel));
    assert_eq!(v["bleiben"], json!([{"personal_id": dana, "name": "Dana"}]));
    assert_eq!(v["gehen"], json!([{"personal_id": anna, "name": "Anna"}]));
    assert_eq!(
        v["kommen"],
        json!([
            {"stamm_personal_id": ben, "name": "Ben", "einheit_id": f1},
            {"plan_helfer_id": cem, "name": "Cem", "einheit_id": f1}
        ])
    );

    let vollzug = format!("{}/{aid}/vollzug", abloesung_pfad(e));
    let uebernahme = json!([{"stamm_personal_id": ben}, {"plan_helfer_id": cem}]);
    for (body, code) in [
        (
            json!({"art": "besatzung", "uebernahme": [{"stamm_personal_id": ben, "plan_helfer_id": cem}]}),
            StatusCode::BAD_REQUEST,
        ),
        (
            json!({"uebernahme": uebernahme, "bleiben": [dana]}),
            StatusCode::UNPROCESSABLE_ENTITY,
        ),
        (
            json!({"art": "besatzung", "uebernahme": uebernahme, "bleiben": [fremd]}),
            StatusCode::UNPROCESSABLE_ENTITY,
        ),
        (
            json!({"art": "besatzung", "uebernahme": uebernahme, "plan_block_id": b1}),
            StatusCode::UNPROCESSABLE_ENTITY,
        ),
    ] {
        let (s, j) = anfrage_json(&app, "POST", &vollzug, &admin, Some(&body)).await;
        assert_eq!(s, code, "{body} → {j}");
    }
    let (_, kraefte) = anfrage(
        &app,
        "GET",
        &format!("/api/einsaetze/{e}/personal"),
        &admin,
        None,
    )
    .await;
    assert_eq!(kraefte.as_array().unwrap().len(), 3, "nichts übernommen");

    // Ohne Freigabe Personal: keine Vorlage, keine Übernahme.
    let fid = benutzer_anlegen(&app, &admin, "frieda", "keine").await;
    rolle_setzen(&app, &admin, e, fid, "fuehrungspersonal").await;
    let frieda = login_cookie(&app, "frieda", "friedapw1").await;
    let override_personal =
        |sichtbar: bool| json!({"sichtbar": sichtbar, "benoetigte_rolle": null}).to_string();
    let (s, _) = anfrage(
        &app,
        "PUT",
        &format!("/api/einsaetze/{e}/modul-overrides/personal"),
        &admin,
        Some(&override_personal(false)),
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    let (s, _) = anfrage(
        &app,
        "GET",
        &format!("{}/{aid}/plan-vorlage", abloesung_pfad(e)),
        &frieda,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::FORBIDDEN);
    let wechsel_body = json!({"art": "besatzung", "uebernahme": uebernahme, "bleiben": [dana],
                              "plan_block_id": b2});
    let (s, _) = anfrage_json(&app, "POST", &vollzug, &frieda, Some(&wechsel_body)).await;
    assert_eq!(s, StatusCode::FORBIDDEN);
    let (s, _) = anfrage(
        &app,
        "PUT",
        &format!("/api/einsaetze/{e}/modul-overrides/personal"),
        &admin,
        Some(&override_personal(true)),
    )
    .await;
    assert_eq!(s, StatusCode::OK);

    // Vorgezogen vollzogen: die Folgeschicht ankert im Folgeblock und ist zu dessen Ende fällig.
    let (s, v) = anfrage_json(&app, "POST", &vollzug, &admin, Some(&wechsel_body)).await;
    assert_eq!(s, StatusCode::OK, "{v}");
    let folge = &v["folgeschicht"];
    assert_eq!(folge["plan_block_id"], b2, "{folge}");
    assert_eq!(folge["faellig_laut_plan"], true);
    assert_eq!(folge["faellig_at"], f(wechsel + Duration::hours(2)));
    let (_, kraefte) = anfrage(
        &app,
        "GET",
        &format!("/api/einsaetze/{e}/personal"),
        &admin,
        None,
    )
    .await;
    let id_von = |name: &str| {
        kraefte
            .as_array()
            .unwrap()
            .iter()
            .find(|k| k["name"] == name)
            .unwrap_or_else(|| panic!("{name} fehlt: {kraefte}"))["id"]
            .as_i64()
            .unwrap()
    };
    let (ben_ep, cem_ep) = (id_von("Ben"), id_von("Cem"));
    let mut erwartet = vec![dana, ben_ep, cem_ep];
    erwartet.sort_unstable();
    assert_eq!(mitglieder(&app, &admin, e, f1).await, erwartet);
    assert_eq!(etb_mit(&app, &admin, e, "Alte Besatzung: «Anna». Neue Besatzung: «Ben», «Cem». Bleibt: «Dana». Aus dem Schichtplan in den Einsatz übernommen: «Ben», «Cem».").await, 1);

    // Der übernommene Helfer steht im Plan als seine Kraft im Einsatz.
    let (_, p) = anfrage(&app, "GET", &plan(e), &admin, None).await;
    let im_b2 = p["bloecke"]
        .as_array()
        .unwrap()
        .iter()
        .find(|b| b["id"] == b2)
        .unwrap()["personen"]
        .as_array()
        .unwrap()
        .iter()
        .find(|x| x["helfer_id"] == cem)
        .unwrap()
        .clone();
    assert_eq!(im_b2["im_einsatz"], true, "{im_b2}");

    // Die Rücknahme legt die Besatzung zurück; Ben und Cem bleiben im Einsatz, ohne Einheit.
    let (s, r) = anfrage(
        &app,
        "POST",
        &format!("{vollzug}/zuruecknehmen"),
        &admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{r:?}");
    let mut zurueck = vec![anna, dana];
    zurueck.sort_unstable();
    assert_eq!(mitglieder(&app, &admin, e, f1).await, zurueck);
    assert_eq!(
        etb_mit(
            &app,
            &admin,
            e,
            "Im Einsatz bleiben, ohne Einheit: «Ben», «Cem»."
        )
        .await,
        1
    );

    // Ein zweiter Vollzug nimmt dieselben Kräfte, keine zweiten.
    let (s, v) = anfrage_json(
        &app,
        "GET",
        &format!("{}/{aid}/plan-vorlage", abloesung_pfad(e)),
        &admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(
        v["kommen"],
        json!([
            {"personal_id": ben_ep, "name": "Ben", "einheit_id": f1},
            {"personal_id": cem_ep, "name": "Cem", "einheit_id": f1}
        ])
    );
}

/// Posten endet (LLH-1555): Ohne Folgeblock ist die Vorlage leer, und der Vollzug ist das
/// Abziehen der ganzen Einheit; eine Schicht ohne Plan hat keine Vorlage (422).
#[tokio::test]
async fn posten_endet_und_schicht_ohne_plan() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let f1 = einheit_bilden(&app, &admin, e, "Florian 1").await;
    let f2 = einheit_bilden(&app, &admin, e, "Florian 2").await;
    let anna = adhoc(&app, &admin, e, "Anna", Some(f1)).await;
    let t = jetzt();
    block(
        &app,
        &admin,
        e,
        f1,
        &f(t - Duration::hours(1)),
        &f(t + Duration::hours(1)),
        json!([]),
    )
    .await;
    let s = beginnen(&app, &admin, e, f1, &f(t - Duration::hours(1))).await;
    let aid = s["id"].as_i64().unwrap();
    let (s, v) = anfrage_json(
        &app,
        "GET",
        &format!("{}/{aid}/plan-vorlage", abloesung_pfad(e)),
        &admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert!(v.get("folgeblock_id").is_none());
    assert_eq!(v["kommen"], json!([]));
    assert_eq!(v["bleiben"], json!([]));
    assert_eq!(v["gehen"], json!([{"personal_id": anna, "name": "Anna"}]));
    let (s, v) = anfrage_json(
        &app,
        "POST",
        &format!("{}/{aid}/vollzug", abloesung_pfad(e)),
        &admin,
        Some(&json!({})),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "Abziehen: {v}");
    assert_eq!(v["folgeschichten"], json!([]));

    let s = beginnen(&app, &admin, e, f2, &f(t - Duration::hours(1))).await;
    let ohne = s["id"].as_i64().unwrap();
    assert_eq!(s["faellig_laut_plan"], false);
    let (s, _) = anfrage(
        &app,
        "GET",
        &format!("{}/{ohne}/plan-vorlage", abloesung_pfad(e)),
        &admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY);
}

/// Bleibt die ganze Besatzung im Folgeblock (LLH-1555), kommt niemand: Der Vollzug aus dem Plan
/// nimmt nur die Bleibenden mit `plan_block_id`, ohne ihn bleibt die neue Besatzung Pflicht (400).
#[tokio::test]
async fn alle_bleiben_im_folgeblock() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    let f1 = einheit_bilden(&app, &admin, e, "Florian 1").await;
    let anna = adhoc(&app, &admin, e, "Anna", Some(f1)).await;
    let t = jetzt();
    let wechsel = t + Duration::minutes(10);
    let einsatz = json!([{"art": "einsatz", "einsatz_personal_id": anna}]);
    block(
        &app,
        &admin,
        e,
        f1,
        &f(t - Duration::hours(1)),
        &f(wechsel),
        einsatz.clone(),
    )
    .await;
    let b2 = block(
        &app,
        &admin,
        e,
        f1,
        &f(wechsel),
        &f(wechsel + Duration::hours(2)),
        einsatz,
    )
    .await;
    let s = beginnen(&app, &admin, e, f1, &f(t - Duration::hours(1))).await;
    let aid = s["id"].as_i64().unwrap();
    let (s, v) = anfrage_json(
        &app,
        "GET",
        &format!("{}/{aid}/plan-vorlage", abloesung_pfad(e)),
        &admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert_eq!(v["kommen"], json!([]));
    assert_eq!(v["gehen"], json!([]));
    assert_eq!(v["bleiben"], json!([{"personal_id": anna, "name": "Anna"}]));

    let vollzug = format!("{}/{aid}/vollzug", abloesung_pfad(e));
    let (s, j) = anfrage_json(
        &app,
        "POST",
        &vollzug,
        &admin,
        Some(&json!({"art": "besatzung", "bleiben": [anna]})),
    )
    .await;
    assert_eq!(s, StatusCode::BAD_REQUEST, "{j}");
    let (s, v) = anfrage_json(
        &app,
        "POST",
        &vollzug,
        &admin,
        Some(&json!({"art": "besatzung", "bleiben": [anna], "plan_block_id": b2})),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert_eq!(v["folgeschicht"]["plan_block_id"], b2);
    assert_eq!(mitglieder(&app, &admin, e, f1).await, vec![anna]);
    assert_eq!(
        etb_mit(
            &app,
            &admin,
            e,
            "Alte Besatzung: keine. Neue Besatzung: keine. Bleibt: «Anna»."
        )
        .await,
        1
    );
}
