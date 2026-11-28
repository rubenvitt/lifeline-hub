//! Adapter verwalten (LLH-2017, Design-Doc „Admin-API“): Routen unter `/api/admin/adapter`,
//! Rechte, Eingaben, Geheimnisse (nur schreiben), Konflikt, Sperre am gekoppelten ELW, Probelauf
//! und Admin-Spur.

use axum::http::StatusCode;
use lifeline_hub::adapter::art::Fehlschlag;
use lifeline_hub::adapter::zustand::AdapterFehler;
use serde_json::{json, Value};

use crate::adapter_testart;
use crate::common;
use common::{anfrage_json, benutzer_anlegen, fremde_org_anlegen, login_cookie, setup_mit_state};

const LISTE: &str = "/api/admin/adapter";
const TOKEN: &str = "sehr-geheimer-accesskey-4711";

async fn setup() -> (
    axum::Router,
    sqlx::SqlitePool,
    std::sync::Arc<adapter_testart::TestArt>,
    String,
) {
    let (rahmen, art, _) = adapter_testart::rahmen();
    let (app, pool) = setup_mit_state(|s| s.adapter = rahmen).await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    (app, pool, art, admin)
}

async fn anlegen(app: &axum::Router, admin: &str, body: Value) -> (StatusCode, Value) {
    anfrage_json(app, "POST", LISTE, admin, Some(&body)).await
}

async fn adapter(app: &axum::Router, admin: &str) -> String {
    let (s, v) = anlegen(app, admin, json!({ "art": "test", "name": "Leitstelle" })).await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
    v["id"].as_str().unwrap().to_string()
}

fn geheimnis_pfad(id: &str) -> String {
    format!("{LISTE}/{id}/secrets/token")
}

async fn spur(pool: &sqlx::SqlitePool) -> Vec<(String, String, Option<String>)> {
    sqlx::query_as("SELECT aktion, ziel, detail FROM admin_audit ORDER BY id")
        .fetch_all(pool)
        .await
        .unwrap()
}

#[tokio::test]
async fn anlegen_zeigt_den_adapter_mit_vorschlag_und_ohne_gesetztes_geheimnis() {
    let (app, pool, _art, admin) = setup().await;
    let (s, a) = anlegen(
        &app,
        &admin,
        json!({ "art": "test", "name": " Leitstelle Nord ", "einstellungen": { "adresse": "https://api.example.org/alarme" } }),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{a}");
    assert_eq!(a["name"], "Leitstelle Nord");
    assert_eq!(a["art_bezeichnung"], "Testquelle");
    assert_eq!(a["intervall_s"], 60);
    assert_eq!(a["zustand"], "wartet");
    assert_eq!(a["lan_erlaubt"], false);
    assert_eq!(
        a["einstellungen"],
        json!({ "adresse": "https://api.example.org/alarme" })
    );
    assert_eq!(a["geheimnisse"][0]["name"], "token");
    assert_eq!(a["geheimnisse"][0]["is_gesetzt"], false);
    assert_eq!(a["geheimnisse"][0]["pflicht"], true);

    let (s, liste) = anfrage_json(&app, "GET", LISTE, &admin, None).await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(liste["adapter"][0]["id"], a["id"]);
    assert_eq!(liste["arten"][0]["code"], "test");
    assert_eq!(liste["speicher"], "bereit");
    assert_eq!(liste["speicher_fingerabdruck"].as_str().unwrap().len(), 16);
    assert!(liste.get("gesperrt_grund").is_none());

    let (aktion, ziel, detail) = spur(&pool).await.pop().unwrap();
    assert_eq!(aktion, "adapter_angelegt");
    assert_eq!(ziel, "Leitstelle Nord");
    let detail = detail.unwrap();
    assert!(detail.contains("api.example.org"), "{detail}");
    assert!(
        !detail.contains("/alarme"),
        "kein Pfad in der Spur: {detail}"
    );
}

#[tokio::test]
async fn eingaben_werden_geprueft() {
    let (app, _pool, _art, admin) = setup().await;
    for (body, grund) in [
        (json!({ "art": "divera", "name": "x" }), "unbekannte Art"),
        (json!({ "art": "test", "name": "  " }), "leerer Name"),
        (
            json!({ "art": "test", "name": "x".repeat(81) }),
            "Name zu lang",
        ),
        (
            json!({ "art": "test", "name": "x", "intervall_s": 10 }),
            "Intervall unter Minimum",
        ),
        (
            json!({ "art": "test", "name": "x", "intervall_s": 100000 }),
            "Intervall zu lang",
        ),
        (
            json!({ "art": "test", "name": "x", "einstellungen": { "unbekannt": 1 } }),
            "unbekanntes Feld",
        ),
        (
            json!({ "art": "test", "name": "x", "einstellungen": [] }),
            "kein Objekt",
        ),
        (
            json!({ "art": "test", "name": "x", "einstellungen": { "adresse": "http://a.example" } }),
            "kein https",
        ),
        (
            json!({ "art": "test", "name": "x", "einstellungen": { "adresse": "https://192.168.0.10/" } }),
            "LAN ohne Ausnahme",
        ),
        (
            json!({ "art": "test", "name": "x", "lan_erlaubt": true, "einstellungen": { "adresse": "https://127.0.0.1/" } }),
            "Loopback nie",
        ),
    ] {
        let (s, v) = anlegen(&app, &admin, body).await;
        assert_eq!(s, StatusCode::BAD_REQUEST, "{grund}: {v}");
    }
    // Mit LAN-Ausnahme ist das private Netz erlaubt.
    let (s, v) = anlegen(
        &app,
        &admin,
        json!({ "art": "test", "name": "x", "lan_erlaubt": true, "einstellungen": { "adresse": "https://192.168.0.10/" } }),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
}

#[tokio::test]
async fn geheimnis_wird_nur_geschrieben_nie_gezeigt() {
    let (app, pool, _art, admin) = setup().await;
    let id = adapter(&app, &admin).await;

    let (s, v) = anfrage_json(
        &app,
        "PUT",
        &geheimnis_pfad(&id),
        &admin,
        Some(&json!({ "wert": format!("{TOKEN}\r\n") })),
    )
    .await;
    assert_eq!(s, StatusCode::NO_CONTENT, "{v}");

    let (_, a) = anfrage_json(&app, "GET", &format!("{LISTE}/{id}"), &admin, None).await;
    assert_eq!(a["geheimnisse"][0]["is_gesetzt"], true);
    assert_eq!(a["geheimnisse"][0]["is_unlesbar"], false);
    assert!(a["geheimnisse"][0]["gesetzt_at"].is_string());
    let (_, liste) = anfrage_json(&app, "GET", LISTE, &admin, None).await;
    for text in [a.to_string(), liste.to_string()] {
        assert!(!text.contains(TOKEN), "Klartext in der Antwort: {text}");
    }

    // In der Datenbank steht nur das Chiffrat.
    let (chiffrat, fp): (Vec<u8>, String) =
        sqlx::query_as("SELECT chiffrat, schluessel_fp FROM adapter_geheimnis")
            .fetch_one(&pool)
            .await
            .unwrap();
    assert!(!chiffrat.windows(TOKEN.len()).any(|w| w == TOKEN.as_bytes()));
    assert_eq!(fp.len(), 16);

    let (aktion, _, detail) = spur(&pool).await.pop().unwrap();
    assert_eq!(aktion, "adapter_geheimnis_gesetzt");
    let detail = detail.unwrap();
    assert!(detail.contains("\"platz\":\"token\""), "{detail}");
    assert!(!detail.contains(TOKEN));

    // Unbekannter Platz 400, leerer Wert 400, zu lang 400.
    let (s, _) = anfrage_json(
        &app,
        "PUT",
        &format!("{LISTE}/{id}/secrets/passwort"),
        &admin,
        Some(&json!({ "wert": "x" })),
    )
    .await;
    assert_eq!(s, StatusCode::BAD_REQUEST);
    let (s, _) = anfrage_json(
        &app,
        "PUT",
        &geheimnis_pfad(&id),
        &admin,
        Some(&json!({ "wert": " " })),
    )
    .await;
    assert_eq!(s, StatusCode::BAD_REQUEST);
    let (s, _) = anfrage_json(
        &app,
        "PUT",
        &geheimnis_pfad(&id),
        &admin,
        Some(&json!({ "wert": "x".repeat(4097) })),
    )
    .await;
    assert_eq!(s, StatusCode::BAD_REQUEST);

    // Entfernen 204, zweimal 404.
    let (s, _) = anfrage_json(&app, "DELETE", &geheimnis_pfad(&id), &admin, None).await;
    assert_eq!(s, StatusCode::NO_CONTENT);
    let (s, _) = anfrage_json(&app, "DELETE", &geheimnis_pfad(&id), &admin, None).await;
    assert_eq!(s, StatusCode::NOT_FOUND);
    assert_eq!(
        spur(&pool).await.pop().unwrap().0,
        "adapter_geheimnis_entfernt"
    );
}

#[tokio::test]
async fn ohne_schluessel_wird_kein_geheimnis_gespeichert() {
    let (_, art, _) = adapter_testart::rahmen();
    let rahmen = adapter_testart::rahmen_mit(&art, None);
    let (app, pool) = setup_mit_state(|s| s.adapter = rahmen).await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let id = adapter(&app, &admin).await;
    let (s, v) = anfrage_json(
        &app,
        "PUT",
        &geheimnis_pfad(&id),
        &admin,
        Some(&json!({ "wert": TOKEN })),
    )
    .await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY, "{v}");
    let n: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM adapter_geheimnis")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(n, 0);
    let (_, liste) = anfrage_json(&app, "GET", LISTE, &admin, None).await;
    assert_eq!(liste["speicher"], "fehlt");
    assert!(liste.get("speicher_fingerabdruck").is_none());
}

#[tokio::test]
async fn anderer_schluessel_zeigt_passt_nicht_und_neu_setzen_hilft() {
    let (rahmen, art, _) = adapter_testart::rahmen();
    let (app, pool) = setup_mit_state(|s| s.adapter = rahmen).await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let id = adapter(&app, &admin).await;
    anfrage_json(
        &app,
        "PUT",
        &geheimnis_pfad(&id),
        &admin,
        Some(&json!({ "wert": TOKEN })),
    )
    .await;

    // Derselbe Datenbestand, ein anderer Schlüssel (Wiederherstellung auf anderem Rechner).
    let anderer = adapter_testart::rahmen_mit(
        &art,
        Some(lifeline_hub::adapter::geheimnis::GeheimnisSchluessel::generate()),
    );
    let app2 = lifeline_hub::app::build_router(lifeline_hub::app::AppState {
        adapter: anderer,
        ..common::test_state(&pool, &lifeline_hub::live::LiveHub::new())
    });
    let admin2 = login_cookie(&app2, "admin", "startpw12").await;
    let (_, liste) = anfrage_json(&app2, "GET", LISTE, &admin2, None).await;
    assert_eq!(liste["speicher"], "passt_nicht");
    assert_eq!(liste["adapter"][0]["geheimnisse"][0]["is_unlesbar"], true);

    let (s, _) = anfrage_json(
        &app2,
        "PUT",
        &geheimnis_pfad(&id),
        &admin2,
        Some(&json!({ "wert": TOKEN })),
    )
    .await;
    assert_eq!(s, StatusCode::NO_CONTENT);
    let (_, liste) = anfrage_json(&app2, "GET", LISTE, &admin2, None).await;
    assert_eq!(liste["speicher"], "bereit");
    assert_eq!(liste["adapter"][0]["geheimnisse"][0]["is_unlesbar"], false);
}

#[tokio::test]
async fn aendern_mit_konflikt_und_spur() {
    let (app, pool, _art, admin) = setup().await;
    let id = adapter(&app, &admin).await;
    let pfad = format!("{LISTE}/{id}");
    let (_, a) = anfrage_json(&app, "GET", &pfad, &admin, None).await;
    let stand = a["geaendert_at"].as_str().unwrap().to_string();

    let (s, b) = anfrage_json(
        &app,
        "PATCH",
        &pfad,
        &admin,
        Some(&json!({ "name": "Leitstelle Süd", "intervall_s": 120, "basis_geaendert_at": stand })),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{b}");
    assert_eq!(b["name"], "Leitstelle Süd");
    assert_eq!(b["intervall_s"], 120);
    assert_ne!(b["geaendert_at"], a["geaendert_at"]);

    // Mit dem alten Stand: 409 veraltet.
    let (s, v) = anfrage_json(
        &app,
        "PATCH",
        &pfad,
        &admin,
        Some(&json!({ "name": "Noch anders", "basis_geaendert_at": stand })),
    )
    .await;
    assert_eq!(s, StatusCode::CONFLICT);
    assert_eq!(v["grund"], "veraltet", "{v}");

    // LAN-Ausnahme an und aus: je eine eigene Zeile.
    let (s, _) = anfrage_json(
        &app,
        "PATCH",
        &pfad,
        &admin,
        Some(&json!({ "lan_erlaubt": true })),
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    let (s, _) = anfrage_json(
        &app,
        "PATCH",
        &pfad,
        &admin,
        Some(&json!({ "lan_erlaubt": false })),
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    let aktionen: Vec<String> = spur(&pool).await.into_iter().map(|z| z.0).collect();
    assert_eq!(
        &aktionen[aktionen.len() - 3..],
        [
            "adapter_geaendert",
            "adapter_lan_erlaubt",
            "adapter_lan_entzogen"
        ]
    );

    // Ein LAN-Ziel bleibt ohne Ausnahme nicht stehen.
    anfrage_json(
        &app,
        "PATCH",
        &pfad,
        &admin,
        Some(&json!({ "lan_erlaubt": true, "einstellungen": { "adresse": "https://10.1.1.1/" } })),
    )
    .await;
    let (s, _) = anfrage_json(
        &app,
        "PATCH",
        &pfad,
        &admin,
        Some(&json!({ "lan_erlaubt": false })),
    )
    .await;
    assert_eq!(s, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn fuehrungskraft_liest_ohne_einstellungen_und_schreibt_nicht() {
    let (app, _pool, _art, admin) = setup().await;
    let id = adapter(&app, &admin).await;
    benutzer_anlegen(&app, &admin, "erika", "fuehrungskraft").await;
    let fk = login_cookie(&app, "erika", "erikapw1").await;

    let (s, liste) = anfrage_json(&app, "GET", LISTE, &fk, None).await;
    assert_eq!(s, StatusCode::OK);
    assert!(liste["adapter"][0].get("einstellungen").is_none());
    let (s, _) = anfrage_json(&app, "GET", &format!("{LISTE}/{id}/attempts"), &fk, None).await;
    assert_eq!(s, StatusCode::OK);

    for (methode, pfad, body) in [
        (
            "POST",
            LISTE.to_string(),
            Some(json!({ "art": "test", "name": "x" })),
        ),
        (
            "PATCH",
            format!("{LISTE}/{id}"),
            Some(json!({ "name": "x" })),
        ),
        ("DELETE", format!("{LISTE}/{id}"), None),
        ("PUT", geheimnis_pfad(&id), Some(json!({ "wert": "x" }))),
        ("POST", format!("{LISTE}/{id}/check"), None),
        ("POST", format!("{LISTE}/{id}/pause"), None),
    ] {
        let (s, _) = anfrage_json(&app, methode, &pfad, &fk, body.as_ref()).await;
        assert_eq!(s, StatusCode::FORBIDDEN, "{methode} {pfad}");
    }
}

#[tokio::test]
async fn fremde_org_sieht_und_trifft_nichts() {
    let (app, pool, _art, admin) = setup().await;
    let id = adapter(&app, &admin).await;
    // Ein System-Admin der fremden Org: nur die Org trennt.
    let (_org, fremd_id) =
        fremde_org_anlegen(&pool, "Fremde Orga", "fremd", "fremdpw123", "keine").await;
    sqlx::query("UPDATE benutzer SET system_rolle = 'admin' WHERE id = ?")
        .bind(fremd_id)
        .execute(&pool)
        .await
        .unwrap();
    let fremd = login_cookie(&app, "fremd", "fremdpw123").await;

    let (_, liste) = anfrage_json(&app, "GET", LISTE, &fremd, None).await;
    assert_eq!(liste["adapter"], json!([]));
    for (methode, pfad, body) in [
        ("GET", format!("{LISTE}/{id}"), None),
        ("GET", format!("{LISTE}/{id}/attempts"), None),
        (
            "PATCH",
            format!("{LISTE}/{id}"),
            Some(json!({ "name": "x" })),
        ),
        ("DELETE", format!("{LISTE}/{id}"), None),
        ("PUT", geheimnis_pfad(&id), Some(json!({ "wert": "x" }))),
        ("POST", format!("{LISTE}/{id}/check"), None),
        ("POST", format!("{LISTE}/{id}/pause"), None),
    ] {
        let (s, _) = anfrage_json(&app, methode, &pfad, &fremd, body.as_ref()).await;
        assert_eq!(s, StatusCode::NOT_FOUND, "{methode} {pfad}");
    }
}

#[tokio::test]
async fn gekoppelter_elw_schreibt_nicht() {
    let (app, pool, _art, admin) = setup().await;
    let id = adapter(&app, &admin).await;
    let org: i64 = sqlx::query_scalar("SELECT org_id FROM adapter")
        .fetch_one(&pool)
        .await
        .unwrap();
    let kopplung: i64 = sqlx::query_scalar(
        "INSERT INTO instanz_kopplung (gegenueber_kennung, gegenueber_schluessel, gegenueber_name, \
         richtung, gegenueber_adresse, zustand, art) VALUES ('hub-a', 'X', 'Hub Kreis', 'meldet_sich', \
         'https://hub.example', 'aktiv', 'standard') RETURNING id",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    sqlx::query(
        "INSERT INTO instanz_kopplung_org (kopplung_id, org_id, fremde_org_kennung, fremde_org_name) \
         VALUES (?, ?, 'hub-a/1', 'Kreis')",
    )
    .bind(kopplung)
    .bind(org)
    .execute(&pool)
    .await
    .unwrap();

    let (_, liste) = anfrage_json(&app, "GET", LISTE, &admin, None).await;
    assert!(liste["gesperrt_grund"]
        .as_str()
        .unwrap()
        .contains("Hub Kreis"));
    for (methode, pfad, body) in [
        (
            "POST",
            LISTE.to_string(),
            Some(json!({ "art": "test", "name": "x" })),
        ),
        (
            "PATCH",
            format!("{LISTE}/{id}"),
            Some(json!({ "name": "x" })),
        ),
        ("PUT", geheimnis_pfad(&id), Some(json!({ "wert": "x" }))),
        ("POST", format!("{LISTE}/{id}/check"), None),
        ("DELETE", format!("{LISTE}/{id}"), None),
    ] {
        let (s, _) = anfrage_json(&app, methode, &pfad, &admin, body.as_ref()).await;
        assert_eq!(s, StatusCode::CONFLICT, "{methode} {pfad}");
    }
}

#[tokio::test]
async fn pruefen_uebernimmt_nichts_und_aendert_den_zustand_nicht() {
    let (app, pool, art, admin) = setup().await;
    let id = adapter(&app, &admin).await;
    let pfad = format!("{LISTE}/{id}");

    // Ohne Pflicht-Geheimnis: Fehler, ohne die Art zu fragen.
    let (s, e) = anfrage_json(&app, "POST", &format!("{pfad}/check"), &admin, None).await;
    assert_eq!(s, StatusCode::OK, "{e}");
    assert_eq!(e["erfolg"], false);
    assert_eq!(e["fehler_art"], "geheimnis_fehlt");
    assert!(art.gesehen().is_empty());

    anfrage_json(
        &app,
        "PUT",
        &geheimnis_pfad(&id),
        &admin,
        Some(&json!({ "wert": TOKEN })),
    )
    .await;
    art.plane(Ok(3));
    let (_, e) = anfrage_json(&app, "POST", &format!("{pfad}/check"), &admin, None).await;
    assert_eq!(e["erfolg"], true);
    assert_eq!(e["anzahl"], 3);
    let gesehen = art.gesehen();
    assert_eq!(gesehen.len(), 1);
    assert_eq!(gesehen[0].token.as_deref(), Some(TOKEN));
    assert!(gesehen[0].is_probe);

    art.plane(Err(Fehlschlag {
        art: AdapterFehler::Abgelehnt,
        status: Some(401),
    }));
    let (_, e) = anfrage_json(&app, "POST", &format!("{pfad}/check"), &admin, None).await;
    assert_eq!(e["fehler_art"], "abgelehnt");
    assert_eq!(e["status"], 401);

    // Keine Probe hat übernommen.
    assert_eq!(art.uebernommen(), 0);
    // Der Zustand bleibt „wartet“; der Verlauf zeigt die Proben.
    let (_, a) = anfrage_json(&app, "GET", &pfad, &admin, None).await;
    assert_eq!(a["zustand"], "wartet");
    assert_eq!(a["fehlversuche"], 0);
    let (_, versuche) = anfrage_json(&app, "GET", &format!("{pfad}/attempts"), &admin, None).await;
    assert_eq!(versuche.as_array().unwrap().len(), 3);
    assert_eq!(versuche[0]["probe"], true);
    assert_eq!(versuche[0]["fehler_art"], "abgelehnt");
    // Proben stehen nicht in der Admin-Spur.
    assert!(spur(&pool).await.iter().all(|z| !z.0.contains("pruef")));
}

#[tokio::test]
async fn anhalten_fortsetzen_loeschen() {
    let (app, pool, _art, admin) = setup().await;
    let id = adapter(&app, &admin).await;
    let pfad = format!("{LISTE}/{id}");

    let (s, a) = anfrage_json(&app, "POST", &format!("{pfad}/pause"), &admin, None).await;
    assert_eq!(s, StatusCode::OK, "{a}");
    assert_eq!(a["zustand"], "aus");
    let (s, _) = anfrage_json(&app, "POST", &format!("{pfad}/pause"), &admin, None).await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY);
    let (s, a) = anfrage_json(&app, "POST", &format!("{pfad}/resume"), &admin, None).await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(a["zustand"], "wartet");
    let (s, _) = anfrage_json(&app, "POST", &format!("{pfad}/resume"), &admin, None).await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY);

    anfrage_json(
        &app,
        "PUT",
        &geheimnis_pfad(&id),
        &admin,
        Some(&json!({ "wert": TOKEN })),
    )
    .await;
    let (s, _) = anfrage_json(&app, "DELETE", &pfad, &admin, None).await;
    assert_eq!(s, StatusCode::NO_CONTENT);
    let (s, _) = anfrage_json(&app, "GET", &pfad, &admin, None).await;
    assert_eq!(s, StatusCode::NOT_FOUND);
    let n: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM adapter_geheimnis")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(n, 0, "Geheimnisse gehen mit dem Adapter");

    let aktionen: Vec<String> = spur(&pool).await.into_iter().map(|z| z.0).collect();
    assert_eq!(
        &aktionen[aktionen.len() - 4..],
        [
            "adapter_angehalten",
            "adapter_fortgesetzt",
            "adapter_geheimnis_gesetzt",
            "adapter_geloescht"
        ]
    );
}

#[tokio::test]
async fn neues_ziel_entfernt_die_geheimnisse() {
    let (app, pool, _art, admin) = setup().await;
    let (_, a) = anlegen(
        &app,
        &admin,
        json!({ "art": "test", "name": "Quelle", "einstellungen": { "adresse": "https://api.example.org/a" } }),
    )
    .await;
    let id = a["id"].as_str().unwrap().to_string();
    let pfad = format!("{LISTE}/{id}");
    anfrage_json(
        &app,
        "PUT",
        &geheimnis_pfad(&id),
        &admin,
        Some(&json!({ "wert": TOKEN })),
    )
    .await;

    // Anderer Pfad am selben Host: das Geheimnis bleibt.
    let (s, b) = anfrage_json(
        &app,
        "PATCH",
        &pfad,
        &admin,
        Some(&json!({ "einstellungen": { "adresse": "https://api.example.org/b" } })),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{b}");
    assert_eq!(b["geheimnisse"][0]["is_gesetzt"], true);

    // Anderer Host: das Geheimnis ist weg, die Spur sagt es.
    let (_, c) = anfrage_json(
        &app,
        "PATCH",
        &pfad,
        &admin,
        Some(&json!({ "einstellungen": { "adresse": "https://anderer.example/b" } })),
    )
    .await;
    assert_eq!(c["geheimnisse"][0]["is_gesetzt"], false);
    let n: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM adapter_geheimnis")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(n, 0);
    let aktionen: Vec<String> = spur(&pool).await.into_iter().map(|z| z.0).collect();
    assert_eq!(
        &aktionen[aktionen.len() - 2..],
        ["adapter_geaendert", "adapter_geheimnis_entfernt"]
    );
}

#[tokio::test]
async fn geaenderter_host_entfernt_passwort() {
    let (app, pool, _art, admin) = setup().await;
    let (_, a) = anlegen(
        &app,
        &admin,
        json!({ "art": "test", "name": "Mail", "einstellungen": { "server": "A.Example.org" } }),
    )
    .await;
    assert_eq!(a["einstellungen"]["server"], "a.example.org");
    let id = a["id"].as_str().unwrap().to_string();
    let pfad = format!("{LISTE}/{id}");
    anfrage_json(
        &app,
        "PUT",
        &geheimnis_pfad(&id),
        &admin,
        Some(&json!({ "wert": TOKEN })),
    )
    .await;

    // Gleicher Host in anderer Schreibweise: das Geheimnis bleibt.
    let (s, b) = anfrage_json(
        &app,
        "PATCH",
        &pfad,
        &admin,
        Some(&json!({ "einstellungen": { "server": "a.example.org", "gruppe": "x" } })),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{b}");
    assert_eq!(b["geheimnisse"][0]["is_gesetzt"], true);

    // Ein Host mit Port ist kein Host (400).
    let (s, _) = anfrage_json(
        &app,
        "PATCH",
        &pfad,
        &admin,
        Some(&json!({ "einstellungen": { "server": "b.example.org:25" } })),
    )
    .await;
    assert_eq!(s, StatusCode::BAD_REQUEST);

    // Anderer Host: das Geheimnis ist weg.
    let (s, c) = anfrage_json(
        &app,
        "PATCH",
        &pfad,
        &admin,
        Some(&json!({ "einstellungen": { "server": "b.example.org" } })),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{c}");
    assert_eq!(c["geheimnisse"][0]["is_gesetzt"], false);
    let n: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM adapter_geheimnis")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(n, 0);
    let aktionen: Vec<String> = spur(&pool).await.into_iter().map(|z| z.0).collect();
    assert_eq!(
        &aktionen[aktionen.len() - 2..],
        ["adapter_geaendert", "adapter_geheimnis_entfernt"]
    );
}
