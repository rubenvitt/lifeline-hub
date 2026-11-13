//! Leserouten für Einsätze und der Abruf der Ereignisse über HTTP mit signierten Anfragen
//! (LLH-1655, Spec `ereignis-abruf`). Die Trigger selbst prüft
//! `tests/public_api_ereignis_trigger.rs`, das Lesen ab dem Cursor `tests/public_api_events.rs`.

use axum::http::{HeaderMap, StatusCode};
use lifeline_machine_client::Credentials;
use serde_json::{json, Value};
use std::time::{Duration, Instant};

mod common;
use common::maschine::{angebunden_als, jetzt, schluessel, senden, signiert, ANBINDUNGEN};
use common::{anfrage, anfrage_json, einsatz_anlegen_mit, login_cookie, setup_mit_pool};

const IP: &str = "198.51.100.9";
const EINSAETZE: &str = "/api/v1/einsaetze";
const EVENTS: &str = "/api/v1/events";

struct Lage {
    app: axum::Router,
    pool: sqlx::SqlitePool,
    admin: String,
}

async fn lage() -> Lage {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    Lage { app, pool, admin }
}

/// Eine Anbindung mit eingelöstem Code.
async fn anbindung(l: &Lage, name: &str, scopes: Value, n: u8) -> Credentials {
    angebunden_als(&l.app, &l.admin, name, scopes, &schluessel(n), IP).await
}

/// Das Einsatzbuch der iuk-suite: liest Einsätze und Ereignisse.
async fn einsatzbuch(l: &Lage, n: u8) -> Credentials {
    anbindung(
        l,
        "Einsatzbuch",
        json!(["einsaetze:read", "events:read"]),
        n,
    )
    .await
}

/// Die Einsatzleitung gibt den Einsatz für die Anbindung frei (Paneel „Anbindungen“).
async fn freigeben(l: &Lage, einsatz: i64, cred: &Credentials) {
    let (s, v) = anfrage(
        &l.app,
        "PUT",
        &format!(
            "/api/einsaetze/{einsatz}/anbindungen/{}/freigabe",
            cred.zugang_id
        ),
        &l.admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
}

async fn kopf_patch(l: &Lage, einsatz: i64, body: Value) {
    let (s, v) = anfrage_json(
        &l.app,
        "PATCH",
        &format!("/api/einsaetze/{einsatz}"),
        &l.admin,
        Some(&body),
    )
    .await;
    assert!(s.is_success(), "{s} {v}");
}

async fn abschliessen(l: &Lage, einsatz: i64) {
    let (s, v) = anfrage(
        &l.app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/abschliessen"),
        &l.admin,
        None,
    )
    .await;
    assert!(s.is_success(), "{s} {v}");
}

/// Signierter Abruf; liefert Status, Köpfe und Body.
async fn abruf(
    app: &axum::Router,
    cred: &Credentials,
    pfad: &str,
) -> (StatusCode, HeaderMap, Value) {
    let jti = uuid::Uuid::new_v4().simple().to_string();
    signiert(app, cred, "GET", pfad, jetzt(), &jti, IP).await
}

async fn ok(app: &axum::Router, cred: &Credentials, pfad: &str) -> Value {
    let (s, _, v) = abruf(app, cred, pfad).await;
    assert_eq!(s, StatusCode::OK, "{pfad}: {v}");
    v
}

fn arten(antwort: &Value) -> Vec<&str> {
    antwort["events"]
        .as_array()
        .unwrap()
        .iter()
        .map(|e| e["type"].as_str().unwrap())
        .collect()
}

// ── Einsatzliste ─────────────────────────────────────────────────────────────────────────────

#[tokio::test]
async fn die_liste_nennt_nur_den_freigegebenen_laufenden_einsatz_ohne_freitext() {
    let l = lage().await;
    let einsatz = einsatz_anlegen_mit(&l.app, &l.admin, "Hochwasser").await;
    let _anderer = einsatz_anlegen_mit(&l.app, &l.admin, "Stadtfest").await;
    kopf_patch(
        &l,
        einsatz,
        json!({
            "stichwort": "B3",
            "leitstellen_nr": "L-2026-77",
            "einsatzort": "Marktplatz 1",
            "einsatzort_lat": 52.1,
            "einsatzort_lon": 9.3,
            "sachverhalt": "Familie Muster im Keller eingeschlossen",
            "meldende_stelle": "Herr Muster, 0171 000000",
            "anzahl_betroffene_initial": 4
        }),
    )
    .await;
    let cred = einsatzbuch(&l, 1).await;
    freigeben(&l, einsatz, &cred).await;

    let auth = cred
        .sign_request("GET", EINSAETZE, b"", jetzt(), "jti-liste")
        .unwrap();
    let (s, kopf, body) = senden(
        &l.app,
        "GET",
        EINSAETZE,
        Some(("authorization", auth)),
        vec![],
        IP,
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    let signatur = kopf
        .get(lifeline_machine_client::RESPONSE_HEADER)
        .expect("Antwort ist signiert")
        .to_str()
        .unwrap();
    cred.verify_response(signatur, "jti-liste", 200, &body, jetzt())
        .expect("Signatur gilt für diese Anfrage");
    assert_eq!(kopf.get("cache-control").unwrap(), "no-store");

    let v: Value = serde_json::from_slice(&body).unwrap();
    assert!(v["cursor"].as_i64().unwrap() > 0, "{v}");
    let liste = v["einsaetze"].as_array().unwrap();
    assert_eq!(liste.len(), 1, "nur der freigegebene Einsatz: {v}");
    let e = liste[0].as_object().unwrap();
    assert_eq!(e["id"], json!(einsatz));
    assert_eq!(e["bezeichnung"], "Hochwasser");
    assert_eq!(e["stichwort"], "B3");
    assert_eq!(e["einsatzart"], "realeinsatz");
    assert_eq!(e["leitstellen_nr"], "L-2026-77");
    assert_eq!(e["einsatzort"], "Marktplatz 1");
    assert_eq!(e["koordinate"], json!({ "lat": 52.1, "lon": 9.3 }));
    assert!(e["einsatznummer"].is_string(), "{v}");
    assert!(e["begonnen_at"].is_string());
    let mut felder: Vec<&str> = e.keys().map(String::as_str).collect();
    felder.sort();
    assert_eq!(
        felder,
        [
            "begonnen_at",
            "bezeichnung",
            "einsatzart",
            "einsatznummer",
            "einsatzort",
            "id",
            "koordinate",
            "leitstellen_nr",
            "stichwort"
        ]
    );
    let text = String::from_utf8(body).unwrap();
    assert!(
        !text.contains("Muster"),
        "kein Sachverhalt, keine meldende Stelle"
    );
}

#[tokio::test]
async fn ohne_freigabe_ist_die_liste_leer_und_ein_abgeschlossener_einsatz_fehlt() {
    let l = lage().await;
    let einsatz = einsatz_anlegen_mit(&l.app, &l.admin, "Hochwasser").await;
    let cred = einsatzbuch(&l, 2).await;

    let v = ok(&l.app, &cred, EINSAETZE).await;
    assert_eq!(v["einsaetze"], json!([]));
    assert!(v["cursor"].is_i64(), "{v}");

    // Ohne Koordinate fehlt das Feld.
    freigeben(&l, einsatz, &cred).await;
    let v = ok(&l.app, &cred, EINSAETZE).await;
    let e = v["einsaetze"][0].as_object().unwrap();
    assert_eq!(e["id"], json!(einsatz));
    assert!(
        !e.contains_key("koordinate") && !e.contains_key("stichwort"),
        "{v}"
    );

    abschliessen(&l, einsatz).await;
    let v = ok(&l.app, &cred, EINSAETZE).await;
    assert_eq!(
        v["einsaetze"],
        json!([]),
        "abgeschlossen: nicht mehr lesbar"
    );
}

#[tokio::test]
async fn nach_der_liste_geht_ab_ihrem_cursor_nichts_verloren() {
    let l = lage().await;
    let einsatz = einsatz_anlegen_mit(&l.app, &l.admin, "Hochwasser").await;
    let cred = einsatzbuch(&l, 3).await;
    freigeben(&l, einsatz, &cred).await;

    // Neuaufbau: Liste lesen, danach ändert sich der Kopf.
    let liste = ok(&l.app, &cred, EINSAETZE).await;
    let cursor = liste["cursor"].as_i64().unwrap();
    kopf_patch(&l, einsatz, json!({ "leitstellen_nr": "L-1" })).await;

    let v = ok(&l.app, &cred, &format!("{EVENTS}?after={cursor}")).await;
    assert_eq!(arten(&v), ["einsatz.updated"]);
    assert_eq!(v["events"][0]["einsatz_id"], json!(einsatz));
    // Was vor der Liste lag (die Freigabe), steckt schon in ihr und kommt nicht noch einmal.
    assert!(v["cursor"].as_i64().unwrap() > cursor);
}

// ── Einzelner Einsatz ────────────────────────────────────────────────────────────────────────

#[tokio::test]
async fn ein_einsatz_ist_nur_mit_freigabe_lesbar_sonst_immer_dieselbe_404() {
    let l = lage().await;
    let einsatz = einsatz_anlegen_mit(&l.app, &l.admin, "Hochwasser").await;
    let anderer = einsatz_anlegen_mit(&l.app, &l.admin, "Stadtfest").await;
    let cred = einsatzbuch(&l, 4).await;
    freigeben(&l, einsatz, &cred).await;

    let v = ok(&l.app, &cred, &format!("{EINSAETZE}/{einsatz}")).await;
    assert_eq!(v["id"], json!(einsatz));
    assert_eq!(v["bezeichnung"], "Hochwasser");

    // Ein Einsatz einer anderen Org, auf den eine Freigabe-Zeile zeigt: die Org wird mitgeprüft.
    let (fremde_org, _) = common::fremde_org_anlegen(
        &l.pool,
        "Nachbar-Orga",
        "nachbar",
        "startpw12",
        "fuehrungskraft",
    )
    .await;
    let fremd: i64 = sqlx::query_scalar(
        "INSERT INTO einsatz (org_id, bezeichnung) VALUES (?, 'Fremd') RETURNING id",
    )
    .bind(fremde_org)
    .fetch_one(&l.pool)
    .await
    .unwrap();

    let mut antworten = Vec::new();
    for pfad in [
        format!("{EINSAETZE}/{anderer}"),
        format!("{EINSAETZE}/{fremd}"),
        format!("{EINSAETZE}/999999"),
        format!("{EINSAETZE}/abc"),
        format!("{EINSAETZE}/-1"),
    ] {
        let (s, _, v) = abruf(&l.app, &cred, &pfad).await;
        assert_eq!(s, StatusCode::NOT_FOUND, "{pfad}: {v}");
        assert_eq!(v["code"], "not_found", "{pfad}: {v}");
        antworten.push(v);
    }

    sqlx::query("UPDATE maschinenzugang_freigabe SET einsatz_id = ? WHERE zugang_id = ?")
        .bind(fremd)
        .bind(&cred.zugang_id)
        .execute(&l.pool)
        .await
        .unwrap();
    let (s, _, v) = abruf(&l.app, &cred, &format!("{EINSAETZE}/{fremd}")).await;
    assert_eq!(
        s,
        StatusCode::NOT_FOUND,
        "fremde Org trotz Freigabe-Zeile: {v}"
    );
    antworten.push(v);
    let v = ok(&l.app, &cred, EINSAETZE).await;
    assert_eq!(v["einsaetze"], json!([]), "auch die Liste zeigt ihn nicht");

    // Abgeschlossen.
    freigeben(&l, einsatz, &cred).await;
    abschliessen(&l, einsatz).await;
    let (s, _, v) = abruf(&l.app, &cred, &format!("{EINSAETZE}/{einsatz}")).await;
    assert_eq!(s, StatusCode::NOT_FOUND, "{v}");
    antworten.push(v);

    assert!(
        antworten.windows(2).all(|w| w[0] == w[1]),
        "jede Ablehnung sieht gleich aus: {antworten:?}"
    );
}

#[tokio::test]
async fn ohne_das_recht_einsaetze_zu_lesen_gibt_es_403() {
    let l = lage().await;
    let einsatz = einsatz_anlegen_mit(&l.app, &l.admin, "Hochwasser").await;
    let monitor = anbindung(&l, "Monitor", json!(["lage:read", "events:read"]), 5).await;
    freigeben(&l, einsatz, &monitor).await;

    for pfad in [EINSAETZE.to_string(), format!("{EINSAETZE}/{einsatz}")] {
        let (s, _, v) = abruf(&l.app, &monitor, &pfad).await;
        assert_eq!(s, StatusCode::FORBIDDEN, "{pfad}: {v}");
        assert_eq!(v["code"], "missing_scope");
    }
}

// ── Freigebbare Zugänge (design.md D15) ──────────────────────────────────────────────────────

#[tokio::test]
async fn einsaetze_lesen_macht_freigebbar_ereignisse_abrufen_allein_nicht() {
    let l = lage().await;
    let einsatz = einsatz_anlegen_mit(&l.app, &l.admin, "Hochwasser").await;
    let buch = anbindung(&l, "Einsatzbuch", json!(["einsaetze:read"]), 6).await;
    let nur_events = anbindung(&l, "Nur Ereignisse", json!(["events:read"]), 7).await;

    let (s, v) = anfrage(
        &l.app,
        "GET",
        &format!("/api/einsaetze/{einsatz}/anbindungen"),
        &l.admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    let namen: Vec<&str> = v
        .as_array()
        .unwrap()
        .iter()
        .map(|a| a["name"].as_str().unwrap())
        .collect();
    assert_eq!(
        namen,
        ["Einsatzbuch"],
        "im Paneel steht nur, was eine Freigabe braucht"
    );

    freigeben(&l, einsatz, &buch).await;
    let (s, v) = anfrage(
        &l.app,
        "PUT",
        &format!(
            "/api/einsaetze/{einsatz}/anbindungen/{}/freigabe",
            nur_events.zugang_id
        ),
        &l.admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::NOT_FOUND, "{v}");
}

#[tokio::test]
async fn der_entzug_von_einsaetze_lesen_beendet_die_freigabe_und_schreibt_closed() {
    let l = lage().await;
    let einsatz = einsatz_anlegen_mit(&l.app, &l.admin, "Hochwasser").await;
    let buch = anbindung(
        &l,
        "Einsatzbuch",
        json!(["einsaetze:read", "events:read"]),
        8,
    )
    .await;
    freigeben(&l, einsatz, &buch).await;

    let (s, v) = anfrage_json(
        &l.app,
        "PATCH",
        &format!("{ANBINDUNGEN}/{}", buch.zugang_id),
        &l.admin,
        Some(&json!({ "scopes": ["events:read"] })),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");

    let freigaben: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM maschinenzugang_freigabe")
        .fetch_one(&l.pool)
        .await
        .unwrap();
    assert_eq!(freigaben, 0);
    let arten: Vec<String> =
        sqlx::query_scalar("SELECT type FROM maschine_ereignis WHERE zugang_id = ? ORDER BY id")
            .bind(&buch.zugang_id)
            .fetch_all(&l.pool)
            .await
            .unwrap();
    assert_eq!(
        arten,
        ["einsatz.created", "einsatz.closed", "lage.changed"],
        "die Freigabe endete mit dem Recht"
    );

    // Das ETB spricht von dem, was die Anbindung durfte: sie las nie eine Lage.
    let etb = common::system_etb_inhalte(&l.app, &l.admin, einsatz).await;
    assert!(
        etb.iter()
            .any(|t| t.contains("Anbindung „Einsatzbuch“ darf den Einsatz nicht mehr lesen")),
        "{etb:?}"
    );
    assert!(etb.iter().all(|t| !t.contains("keine Lage mehr lesen")));
}

// ── Ereignisse über HTTP ─────────────────────────────────────────────────────────────────────

/// Akzeptanzkriterium der Aufgabe: Ein Client, der eine Weile nicht abruft, holt alle Ereignisse
/// der Zwischenzeit in Reihenfolge nach.
#[tokio::test]
async fn nach_einer_pause_kommen_alle_ereignisse_in_reihenfolge() {
    let l = lage().await;
    let einsatz = einsatz_anlegen_mit(&l.app, &l.admin, "Hochwasser").await;
    let cred = einsatzbuch(&l, 9).await;
    let beginn = ok(&l.app, &cred, EVENTS).await;
    assert_eq!(beginn["events"], json!([]), "ohne after: nur der Stand");
    let cursor = beginn["cursor"].as_i64().unwrap();

    // Während der Client nicht abruft: Freigabe, zwei Kopfänderungen, Abschluss.
    freigeben(&l, einsatz, &cred).await;
    kopf_patch(&l, einsatz, json!({ "leitstellen_nr": "L-1" })).await;
    kopf_patch(&l, einsatz, json!({ "einsatzort": "Marktplatz 1" })).await;
    abschliessen(&l, einsatz).await;

    let auth_pfad = format!("{EVENTS}?after={cursor}");
    let auth = cred
        .sign_request("GET", &auth_pfad, b"", jetzt(), "jti-pause")
        .unwrap();
    let (s, kopf, body) = senden(
        &l.app,
        "GET",
        &auth_pfad,
        Some(("authorization", auth)),
        vec![],
        IP,
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    let signatur = kopf
        .get(lifeline_machine_client::RESPONSE_HEADER)
        .expect("Antwort ist signiert")
        .to_str()
        .unwrap();
    cred.verify_response(signatur, "jti-pause", 200, &body, jetzt())
        .expect("Signatur gilt für diese Anfrage");
    assert!(kopf.get("retry-after").is_none());

    let v: Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(
        arten(&v),
        [
            "einsatz.created",
            "einsatz.updated",
            "einsatz.updated",
            "einsatz.closed"
        ]
    );
    let events = v["events"].as_array().unwrap();
    let nummern: Vec<i64> = events.iter().map(|e| e["id"].as_i64().unwrap()).collect();
    assert!(
        nummern.windows(2).all(|w| w[0] < w[1]),
        "aufsteigend: {nummern:?}"
    );
    // Hinter dem letzten sichtbaren Ereignis liegt noch das `lage.changed` des Abschlusses, das
    // dieser Zugang ohne `lage:read` nicht sieht; der Cursor rückt darüber hinaus.
    assert!(v["cursor"].as_i64().unwrap() >= *nummern.last().unwrap());
    for e in events {
        let o = e.as_object().unwrap();
        let mut felder: Vec<&str> = o.keys().map(String::as_str).collect();
        felder.sort();
        assert_eq!(felder, ["einsatz_id", "id", "occurred_at", "type"]);
        assert_eq!(o["einsatz_id"], json!(einsatz));
        assert!(lifeline_hub::zeit::parse(o["occurred_at"].as_str().unwrap()).is_some());
    }
    let text = String::from_utf8(body).unwrap();
    assert!(!text.contains("Marktplatz") && !text.contains("Hochwasser"));

    // Mit dem neuen Cursor kommt nichts mehr.
    let danach = ok(
        &l.app,
        &cred,
        &format!("{EVENTS}?after={}", v["cursor"].as_i64().unwrap()),
    )
    .await;
    assert_eq!(danach["events"], json!([]));
}

#[tokio::test]
async fn falsche_abfragewerte_und_ein_fehlendes_recht_werden_abgewiesen() {
    let l = lage().await;
    let cred = einsatzbuch(&l, 10).await;
    for pfad in [
        format!("{EVENTS}?after=abc"),
        format!("{EVENTS}?after=-1"),
        format!("{EVENTS}?after=0&wait=60"),
        format!("{EVENTS}?after=0&wait=x"),
    ] {
        let (s, _, v) = abruf(&l.app, &cred, &pfad).await;
        assert_eq!(s, StatusCode::BAD_REQUEST, "{pfad}: {v}");
        assert_eq!(v["code"], "invalid_field", "{pfad}: {v}");
    }

    let ohne = anbindung(&l, "Nur Einsätze", json!(["einsaetze:read"]), 11).await;
    let (s, _, v) = abruf(&l.app, &ohne, EVENTS).await;
    assert_eq!(s, StatusCode::FORBIDDEN, "{v}");
    assert_eq!(v["code"], "missing_scope");
}

#[tokio::test]
async fn ein_zugang_sieht_weder_ohne_freigabe_noch_aus_einer_anderen_org_fremde_ereignisse() {
    let l = lage().await;
    let einsatz = einsatz_anlegen_mit(&l.app, &l.admin, "Hochwasser").await;
    let mit = einsatzbuch(&l, 12).await;
    let ohne = anbindung(
        &l,
        "Ohne Freigabe",
        json!(["einsaetze:read", "lage:read", "events:read"]),
        13,
    )
    .await;
    freigeben(&l, einsatz, &mit).await;
    kopf_patch(&l, einsatz, json!({ "stichwort": "B3" })).await;

    // Eine andere Org mit eigenem Zugang und eigenem freigegebenem Einsatz, an dem sich etwas tut.
    let (fremde_org, _) = common::fremde_org_anlegen(
        &l.pool,
        "Nachbar-Orga",
        "nachbar",
        "startpw12",
        "fuehrungskraft",
    )
    .await;
    let fremder_einsatz: i64 = sqlx::query_scalar(
        "INSERT INTO einsatz (org_id, bezeichnung) VALUES (?, 'Fremd') RETURNING id",
    )
    .bind(fremde_org)
    .fetch_one(&l.pool)
    .await
    .unwrap();
    let fremder_zugang = {
        let mut conn = l.pool.acquire().await.unwrap();
        lifeline_hub::public_api::zugang::anlegen(
            &mut conn,
            fremde_org,
            "Fremdes Einsatzbuch",
            &[
                lifeline_hub::public_api::scope::Scope::EinsaetzeRead,
                lifeline_hub::public_api::scope::Scope::EventsRead,
            ],
            None,
            None,
            &lifeline_hub::zeit::jetzt(),
        )
        .await
        .unwrap()
    };
    sqlx::query("INSERT INTO maschinenzugang_freigabe (zugang_id, einsatz_id) VALUES (?, ?)")
        .bind(&fremder_zugang)
        .bind(fremder_einsatz)
        .execute(&l.pool)
        .await
        .unwrap();
    sqlx::query("UPDATE einsatz SET stichwort = 'F1' WHERE id = ?")
        .bind(fremder_einsatz)
        .execute(&l.pool)
        .await
        .unwrap();

    let v = ok(&l.app, &ohne, &format!("{EVENTS}?after=0")).await;
    assert_eq!(v["events"], json!([]));
    let v = ok(&l.app, &mit, &format!("{EVENTS}?after=0")).await;
    assert_eq!(arten(&v), ["einsatz.created", "einsatz.updated"]);
    assert!(
        v["events"]
            .as_array()
            .unwrap()
            .iter()
            .all(|e| e["einsatz_id"] == json!(einsatz)),
        "nichts vom Einsatz der anderen Org: {v}"
    );
}

/// Der wartende Abruf im echten Takt von einer Sekunde.
#[tokio::test]
async fn ein_wartender_abruf_antwortet_binnen_zwei_sekunden_nach_der_aenderung() {
    let l = lage().await;
    let einsatz = einsatz_anlegen_mit(&l.app, &l.admin, "Hochwasser").await;
    let cred = einsatzbuch(&l, 14).await;
    freigeben(&l, einsatz, &cred).await;
    let cursor = ok(&l.app, &cred, EVENTS).await["cursor"].as_i64().unwrap();

    let wartender = {
        let (app, cred) = (l.app.clone(), cred.clone());
        tokio::spawn(async move {
            abruf(&app, &cred, &format!("{EVENTS}?after={cursor}&wait=25")).await
        })
    };
    tokio::time::sleep(Duration::from_millis(300)).await;
    assert!(!wartender.is_finished(), "ohne Ereignis wartet der Abruf");

    // Ein zweiter wartender Abruf desselben Zugangs antwortet sofort und nennt die Wartezeit.
    let beginn = Instant::now();
    let (s, kopf, v) = abruf(&l.app, &cred, &format!("{EVENTS}?after={cursor}&wait=25")).await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert!(beginn.elapsed() < Duration::from_secs(1));
    assert_eq!(v["events"], json!([]));
    assert_eq!(kopf.get("retry-after").unwrap(), "10");
    assert!(!wartender.is_finished(), "der erste wartet weiter");

    let geaendert = Instant::now();
    kopf_patch(&l, einsatz, json!({ "leitstellen_nr": "L-9" })).await;
    let (s, kopf, v) = tokio::time::timeout(Duration::from_secs(2), wartender)
        .await
        .expect("binnen zwei Sekunden nach der Änderung")
        .unwrap();
    assert!(geaendert.elapsed() < Duration::from_secs(2));
    assert_eq!(s, StatusCode::OK, "{v}");
    assert_eq!(arten(&v), ["einsatz.updated"]);
    assert!(kopf.get("retry-after").is_none());
}

#[tokio::test]
async fn nach_dem_purge_ist_ein_alter_cursor_abgelaufen() {
    let l = lage().await;
    let cred = einsatzbuch(&l, 15).await;
    // Das Alter braucht das direkte Einfügen: ein Trigger schreibt immer „jetzt“.
    let alt: i64 = sqlx::query_scalar(
        "INSERT INTO maschine_ereignis (zugang_id, type, einsatz_id, occurred_at) \
         VALUES (?, 'einsatz.updated', 1, datetime('now', '-9 days')) RETURNING id",
    )
    .bind(&cred.zugang_id)
    .fetch_one(&l.pool)
    .await
    .unwrap();
    lifeline_hub::public_api::events::purge(&l.pool, &lifeline_hub::zeit::jetzt())
        .await
        .unwrap();

    let (s, _, v) = abruf(&l.app, &cred, &format!("{EVENTS}?after={}", alt - 1)).await;
    assert_eq!(s, StatusCode::GONE, "{v}");
    assert_eq!(v["code"], "cursor_expired");

    // Der Neuaufbau: die Liste nennt einen Cursor, der wieder gilt.
    let cursor = ok(&l.app, &cred, EINSAETZE).await["cursor"]
        .as_i64()
        .unwrap();
    let v = ok(&l.app, &cred, &format!("{EVENTS}?after={cursor}")).await;
    assert_eq!(v["events"], json!([]));
}

// ── Rechteänderung beendet die Freigabe (Entscheidung Ruben, 13.11.2026) ─────────────────────

async fn scopes_setzen(l: &Lage, cred: &Credentials, scopes: Value) {
    let (s, v) = anfrage_json(
        &l.app,
        "PATCH",
        &format!("{ANBINDUNGEN}/{}", cred.zugang_id),
        &l.admin,
        Some(&json!({ "scopes": scopes })),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
}

async fn freigaben(l: &Lage) -> i64 {
    sqlx::query_scalar("SELECT COUNT(*) FROM maschinenzugang_freigabe")
        .fetch_one(&l.pool)
        .await
        .unwrap()
}

/// Ein Admin gibt einer freigegebenen Anbindung ein weiteres Recht mit Einsatzbezug: Sie liest
/// damit nicht sofort mehr, sondern erst nach einer neuen Entscheidung der Einsatzleitung.
#[tokio::test]
async fn ein_hinzugefuegtes_recht_mit_einsatzbezug_beendet_die_freigabe() {
    let l = lage().await;
    let einsatz = einsatz_anlegen_mit(&l.app, &l.admin, "Hochwasser").await;
    let buch = einsatzbuch(&l, 20).await;
    freigeben(&l, einsatz, &buch).await;

    scopes_setzen(
        &l,
        &buch,
        json!(["einsaetze:read", "events:read", "lage:read"]),
    )
    .await;

    assert_eq!(freigaben(&l).await, 0, "die Freigabe ist beendet");
    let v = ok(&l.app, &buch, "/api/v1/lage?karte=none").await;
    assert_eq!(
        v.get("einsatz"),
        Some(&Value::Null),
        "keine Lage ohne neue Freigabe: {v}"
    );
    let v = ok(&l.app, &buch, EINSAETZE).await;
    assert_eq!(v["einsaetze"], json!([]));
    let v = ok(&l.app, &buch, &format!("{EVENTS}?after=0")).await;
    assert_eq!(
        arten(&v),
        ["einsatz.created", "einsatz.closed", "lage.changed"],
        "das Fremdsystem erfährt das Ende"
    );
    let etb = common::system_etb_inhalte(&l.app, &l.admin, einsatz).await;
    assert!(
        etb.iter()
            .any(|t| t.contains("Rechte der Anbindung „Einsatzbuch“")
                && t.contains("Freigabe dieses Einsatzes ist beendet")),
        "{etb:?}"
    );

    // Die neue Freigabe meldet sich wie jede.
    freigeben(&l, einsatz, &buch).await;
    let v = ok(&l.app, &buch, "/api/v1/lage?karte=none").await;
    assert_eq!(v["einsatz"]["id"], json!(einsatz));
}

/// Fällt eines von zwei Rechten mit Einsatzbezug weg, endet die Freigabe ebenso; gibt der Admin
/// es zurück, liest die Anbindung erst nach einer neuen Freigabe.
#[tokio::test]
async fn ein_entzogenes_von_zwei_rechten_beendet_die_freigabe_ebenso() {
    let l = lage().await;
    let einsatz = einsatz_anlegen_mit(&l.app, &l.admin, "Hochwasser").await;
    let cred = anbindung(
        &l,
        "Monitor und Buch",
        json!(["einsaetze:read", "events:read", "lage:read"]),
        21,
    )
    .await;
    freigeben(&l, einsatz, &cred).await;

    scopes_setzen(&l, &cred, json!(["einsaetze:read", "events:read"])).await;
    assert_eq!(freigaben(&l).await, 0);

    scopes_setzen(
        &l,
        &cred,
        json!(["einsaetze:read", "events:read", "lage:read"]),
    )
    .await;
    let v = ok(&l.app, &cred, EINSAETZE).await;
    assert_eq!(
        v["einsaetze"],
        json!([]),
        "kein Einsatz, bis die Einsatzleitung neu freigibt"
    );
}

/// Ein Recht ohne Einsatzbezug ändert an der Freigabe nichts.
#[tokio::test]
async fn ein_recht_ohne_einsatzbezug_laesst_die_freigabe_stehen() {
    let l = lage().await;
    let einsatz = einsatz_anlegen_mit(&l.app, &l.admin, "Hochwasser").await;
    let buch = einsatzbuch(&l, 22).await;
    freigeben(&l, einsatz, &buch).await;

    scopes_setzen(
        &l,
        &buch,
        json!(["einsaetze:read", "events:read", "rechner:use"]),
    )
    .await;
    scopes_setzen(&l, &buch, json!(["einsaetze:read"])).await;

    assert_eq!(freigaben(&l).await, 1);
    let v = ok(&l.app, &buch, EINSAETZE).await;
    assert_eq!(v["einsaetze"][0]["id"], json!(einsatz));
}
