//! `GET /api/v1/lage` (LLH-1638, Spec `lage-schnittstelle`): das Lagebild des freigegebenen
//! Einsatzes für einen Maschinenzugang mit `lage:read`. Die Freigabe selbst (Routen der
//! Einsatzleitung, Spiegel, Ende) prüft `tests/einsatz_anbindungen.rs`.

use axum::http::StatusCode;
use lifeline_machine_client::Credentials;
use serde_json::{json, Value};

mod common;
use common::maschine::{angebunden, jetzt, schluessel, senden, signiert};
use common::{
    anfrage, anfrage_json, einheit_bilden, einsatz_anlegen_mit, login_cookie, setup_mit_pool,
    stammpersonal_disponieren,
};

const LAGE: &str = "/api/v1/lage";
const IP: &str = "198.51.100.7";
const POLY: &str =
    r#"{"type":"Polygon","coordinates":[[[8.6,50.1],[8.7,50.1],[8.7,50.2],[8.6,50.1]]]}"#;
const STELLE_SANITAET: &str =
    r#"{"v":1,"spec":{"bodyMarks":["medical-service"],"kind":"post","organization":"feuerwehr"}}"#;

/// Gibt den Einsatz für den Zugang frei, an der Einsatzleitung vorbei: hier geht es um den Abruf.
async fn freigeben(pool: &sqlx::SqlitePool, cred: &Credentials, einsatz: i64) {
    sqlx::query("DELETE FROM maschinenzugang_freigabe WHERE zugang_id = ?")
        .bind(&cred.zugang_id)
        .execute(pool)
        .await
        .unwrap();
    sqlx::query("INSERT INTO maschinenzugang_freigabe (zugang_id, einsatz_id) VALUES (?, ?)")
        .bind(&cred.zugang_id)
        .bind(einsatz)
        .execute(pool)
        .await
        .unwrap();
}

/// Ruft die Lage signiert ab; `abfrage` etwa `?karte=none`.
async fn lage(app: &axum::Router, cred: &Credentials, abfrage: &str) -> Value {
    let jti = uuid::Uuid::new_v4().simple().to_string();
    let (s, _, v) = signiert(
        app,
        cred,
        "GET",
        &format!("{LAGE}{abfrage}"),
        jetzt(),
        &jti,
        IP,
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    v
}

async fn post(app: &axum::Router, cookie: &str, pfad: &str, body: Value) -> Value {
    let (s, v) = anfrage_json(app, "POST", pfad, cookie, Some(&body)).await;
    assert!(
        s == StatusCode::CREATED || s == StatusCode::OK,
        "{pfad}: {s} {v}"
    );
    v
}

#[tokio::test]
async fn ohne_freigabe_ist_der_einsatz_null_und_die_antwort_signiert() {
    let (app, _pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    einsatz_anlegen_mit(&app, &admin, "Stadtfest").await;
    let cred = angebunden(&app, &admin, json!(["lage:read"]), &schluessel(1), IP).await;

    let auth = cred
        .sign_request("GET", LAGE, b"", jetzt(), "jti-ohne-freigabe")
        .unwrap();
    let (s, kopf, body) =
        senden(&app, "GET", LAGE, Some(("authorization", auth)), vec![], IP).await;
    assert_eq!(s, StatusCode::OK);
    let signatur = kopf
        .get(lifeline_machine_client::RESPONSE_HEADER)
        .expect("Antwort ist signiert")
        .to_str()
        .unwrap();
    cred.verify_response(signatur, "jti-ohne-freigabe", 200, &body, jetzt())
        .expect("Signatur gilt für diese Anfrage");
    assert_eq!(kopf.get("cache-control").unwrap(), "no-store");

    let v: Value = serde_json::from_slice(&body).unwrap();
    let o = v.as_object().unwrap();
    assert!(o["einsatz"].is_null(), "{v}");
    assert!(o["stand_at"].is_string());
    assert!(!o.contains_key("karte") && !o.contains_key("karte_etag"));
    assert!(!o.contains_key("api_version"), "die Version steht im Pfad");
}

#[tokio::test]
async fn freigegebener_einsatz_traegt_kopf_zahlen_uhs_und_lagemeldung() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen_mit(&app, &admin, "Stadtfest").await;
    let basis = format!("/api/einsaetze/{einsatz}");
    let cred = angebunden(&app, &admin, json!(["lage:read"]), &schluessel(1), IP).await;
    freigeben(&pool, &cred, einsatz).await;

    // Eine UHS in Betrieb mit drei Personen, davon zwei SK I; dazu eine Vermisste.
    let uhs = post(
        &app,
        &admin,
        &format!("{basis}/uhs"),
        json!({"typ": "behandlungsplatz", "bezeichnung": "BHP Nord"}),
    )
    .await["id"]
        .as_i64()
        .unwrap();
    post(
        &app,
        &admin,
        &format!("{basis}/uhs/{uhs}/status"),
        json!({"status": "aktiv"}),
    )
    .await;
    for i in 0..3 {
        let person = post(
            &app,
            &admin,
            &format!("{basis}/personen"),
            json!({"name": "Muster", "vorname": "Max", "uhs_id": uhs}),
        )
        .await["id"]
            .as_i64()
            .unwrap();
        if i < 2 {
            post(
                &app,
                &admin,
                &format!("{basis}/personen/{person}/sichtung"),
                json!({"kategorie": "sk1"}),
            )
            .await;
        }
    }
    post(
        &app,
        &admin,
        &format!("{basis}/personen"),
        json!({"name": "Vermisstfrau", "vorname": "Vera", "status": "vermisst"}),
    )
    .await;

    let v = lage(&app, &cred, "").await;
    let e = &v["einsatz"];
    assert_eq!(e["id"], json!(einsatz));
    assert_eq!(e["bezeichnung"], "Stadtfest");
    assert_eq!(e["einsatzart"], "realeinsatz");
    assert!(e["begonnen_at"].is_string());
    assert_eq!(e["betroffene"]["gesamt"], json!(4));
    assert_eq!(e["betroffene"]["sk1"], json!(2));
    assert_eq!(e["betroffene"]["vermisst"], json!(1));
    assert!(e["kraefte"]["einheiten"].is_i64());
    assert!(e["kraefte"]["personal"].is_i64());
    assert!(e["kraefte"]["staerke"]["mannschaft"].is_u64());
    assert_eq!(e["sofortmeldungen_offen"], json!(0));
    let u = &e["uhs"][0];
    assert_eq!(u["id"], json!(uhs));
    assert_eq!(u["bezeichnung"], "BHP Nord");
    assert_eq!(u["kind"], "behandlungsplatz");
    assert_eq!(u["state"], "aktiv");
    assert_eq!(u["belegt"], json!(3));
    let uhs_felder = u.as_object().unwrap();
    assert!(
        !uhs_felder.contains_key("typ") && !uhs_felder.contains_key("status"),
        "v1 nennt kind und state: {u}"
    );
    let einsatz_felder = e.as_object().unwrap();
    assert!(einsatz_felder.contains_key("lagemeldung") && e["lagemeldung"].is_null());
    assert!(
        !einsatz_felder.contains_key("spiegel"),
        "selbst geführt: kein Abgleich"
    );
    assert!(!einsatz_felder.contains_key("sanitaetsdienst"));

    // Lagemeldung: erst der freigegebene Lagebericht zählt.
    let lid = post(
        &app,
        &admin,
        &format!("{basis}/lageberichte"),
        json!({"vorlage": "lagebericht", "titel": "Lage 10:00"}),
    )
    .await["id"]
        .as_i64()
        .unwrap();
    let (s, r) = anfrage_json(
        &app,
        "PATCH",
        &format!("{basis}/lageberichte/{lid}"),
        &admin,
        Some(&json!({"abschnitte": [
            {"schluessel": "zusammenfassung", "text": "Lage stabil."},
            {"schluessel": "auftrag", "text": "Sanitätsdienst sichern."},
            {"schluessel": "gefahren_schadenlage", "text": "Keine."},
            {"schluessel": "eigene_lage", "text": "Zwei Trupps vor Ort."},
            {"schluessel": "lageentwicklung", "text": "Ruhig."},
            {"schluessel": "fuehrungsprobleme", "text": "Keine."},
            {"schluessel": "antraege_vorschlaege", "text": "Keine."},
            {"schluessel": "medienlage", "text": "Ruhig."}
        ]})),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{r}");
    assert!(
        lage(&app, &cred, "").await["einsatz"]["lagemeldung"].is_null(),
        "ein Entwurf ist keine Lagemeldung"
    );
    let (s, r) = anfrage(
        &app,
        "POST",
        &format!("{basis}/lageberichte/{lid}/freigeben"),
        &admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{r}");
    let v = lage(&app, &cred, "").await;
    assert_eq!(v["einsatz"]["lagemeldung"]["text"], "Lage stabil.");
    assert!(v["einsatz"]["lagemeldung"]["freigegeben_at"].is_string());

    // Reihe „Sanitätsdienst“: der Block kommt nur mit der Wahl.
    let (s, r) = anfrage_json(
        &app,
        "PUT",
        &format!("{basis}/lagekennzahl-wahl"),
        &admin,
        Some(&json!({"gewaehlt": ["sanitaetsdienst"]})),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{r}");
    let v = lage(&app, &cred, "").await;
    assert_eq!(
        v["einsatz"]["sanitaetsdienst"],
        json!({
            "kontakte": 3,
            "kontakte_letzte_stunde": 3,
            "in_versorgung": 3,
            "transporte": 0
        }),
        "{v}"
    );

    // Jeder Abruf zählt im Abrufprotokoll unter der Routenvorlage, ohne Abfrage.
    lage(&app, &cred, "?karte=none").await;
    let (route, anzahl): (String, i64) =
        sqlx::query_as("SELECT route, anzahl FROM maschine_abruf WHERE zugang_id = ?")
            .bind(&cred.zugang_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(route, LAGE);
    assert_eq!(anzahl, 5);
}

#[tokio::test]
async fn ohne_scope_403_mit_bearer_401_und_ein_abgeschlossener_einsatz_ist_null() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen_mit(&app, &admin, "Stadtfest").await;

    // Scope fehlt: 403 mit stabilem Code, auch wenn (fälschlich) eine Freigabe stünde.
    let adapter = angebunden(
        &app,
        &admin,
        json!(["alarmmeldungen:write"]),
        &schluessel(2),
        IP,
    )
    .await;
    freigeben(&pool, &adapter, einsatz).await;
    let (s, _, v) = signiert(&app, &adapter, "GET", LAGE, jetzt(), "jti-a", IP).await;
    assert_eq!(s, StatusCode::FORBIDDEN, "{v}");
    assert_eq!(v["code"], "missing_scope");

    // Bearer, auch in der Form eines früheren Lagemonitor-Schlüssels: 401.
    let bearer = "Bearer llh_lm_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA".to_string();
    let (s, _, body) = senden(
        &app,
        "GET",
        LAGE,
        Some(("authorization", bearer)),
        vec![],
        IP,
    )
    .await;
    assert_eq!(s, StatusCode::UNAUTHORIZED);
    let v: Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(v["code"], "unauthorized");
    // Eine Sitzung öffnet die Route nicht.
    let (s, _) = anfrage(&app, "GET", LAGE, &admin, None).await;
    assert_eq!(s, StatusCode::UNAUTHORIZED);

    // Abschluss: die Lage zeigt den Einsatz nicht mehr.
    let monitor = angebunden(&app, &admin, json!(["lage:read"]), &schluessel(3), IP).await;
    freigeben(&pool, &monitor, einsatz).await;
    assert_eq!(
        lage(&app, &monitor, "").await["einsatz"]["id"],
        json!(einsatz)
    );
    let (s, v) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/abschliessen"),
        &admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    let v = lage(&app, &monitor, "").await;
    assert!(v["einsatz"].is_null(), "{v}");
    assert!(v.get("karte").is_none());
}

/// Spec `lage-schnittstelle`, „Zahlen des Einsatzes“ und „Sofortmeldung“: zwei Einheiten, acht
/// Kräfte und zwei offene Sofortmeldungen kommen als diese Zahlen an, ohne Meldungstext.
#[tokio::test]
async fn lage_zaehlt_einheiten_kraefte_und_offene_sofortmeldungen() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen_mit(&app, &admin, "Stadtfest").await;
    let cred = angebunden(&app, &admin, json!(["lage:read"]), &schluessel(1), IP).await;
    freigeben(&pool, &cred, einsatz).await;

    einheit_bilden(&app, &admin, einsatz, "Trupp 1").await;
    einheit_bilden(&app, &admin, einsatz, "Trupp 2").await;
    for i in 0..8 {
        stammpersonal_disponieren(&app, &admin, einsatz, &format!("Kraft {i}")).await;
    }
    for (art, prio, inhalt) in [
        ("sofortmeldung", "sofort", "Herr Geheimrat eingeklemmt"),
        ("lagemeldung", "sofort", "Gasgeruch bei Familie Verborgen"),
        ("lagemeldung", "normal", "Lage ruhig"),
    ] {
        post(
            &app,
            &admin,
            &format!("/api/einsaetze/{einsatz}/meldungen"),
            json!({
                "absender": "Melder Unbekannt",
                "empfaenger": "Empfaengerin Vertraulich",
                "meldeweg": "persoenlich",
                "inhalt": inhalt,
                "meldungsart": art,
                "prioritaet": prio,
                "ereigniszeit": "2026-10-04 10:00:00",
            }),
        )
        .await;
    }

    let v = lage(&app, &cred, "?karte=none").await;
    let e = &v["einsatz"];
    assert_eq!(e["kraefte"]["einheiten"], json!(2), "{v}");
    assert_eq!(e["kraefte"]["personal"], json!(8), "{v}");
    let s = &e["kraefte"]["staerke"];
    assert_eq!(
        s["fuehrer"].as_u64().unwrap()
            + s["unterfuehrer"].as_u64().unwrap()
            + s["mannschaft"].as_u64().unwrap(),
        8,
        "die Stärke zählt jede Kraft: {v}"
    );
    assert_eq!(e["sofortmeldungen_offen"], json!(2), "{v}");
    let text = v.to_string();
    for wort in [
        "Geheimrat",
        "Verborgen",
        "Unbekannt",
        "Vertraulich",
        "Kraft 0",
    ] {
        assert!(!text.contains(wort), "{wort} in der Antwort: {text}");
    }
}

/// ADR-0034: Ein Lese-Scope mit Einsatzbezug (`Scope::has_einsatzbezug`) und die Routen, die
/// ihren Einsatz aus der Freigabe nehmen, laufen nicht auseinander. Kommt eine Route mit einem
/// solchen Scope dazu, steht sie hier, und der Test darunter belegt, dass sie ohne Freigabe
/// keinen Einsatz liest.
#[tokio::test]
async fn routen_mit_einsatzbezug_lesen_nur_ueber_die_freigabe() {
    use lifeline_hub::public_api::scope::Scope;

    /// Routen, deren Einsatz allein aus `public_api::freigabe` kommt.
    const UEBER_FREIGABE: &[&str] = &[LAGE, "/api/v1/einsaetze", "/api/v1/einsaetze/{id}"];

    let dokument = serde_json::to_value(lifeline_hub::public_api::openapi()).unwrap();
    let mut scopes_im_dokument = Vec::new();
    for (pfad, methoden) in dokument["paths"].as_object().unwrap() {
        for (_, operation) in methoden.as_object().unwrap() {
            let Some(security) = operation.get("security").and_then(|s| s.as_array()) else {
                continue;
            };
            for eintrag in security {
                for scope in eintrag["machine"].as_array().into_iter().flatten() {
                    let scope = Scope::parse(scope.as_str().unwrap())
                        .unwrap_or_else(|| panic!("{pfad}: unbekannter Scope {scope}"));
                    if scope.has_einsatzbezug() {
                        assert!(
                            UEBER_FREIGABE.contains(&pfad.as_str()),
                            "{pfad} verlangt {} (Einsatzbezug), steht aber nicht in \
                             UEBER_FREIGABE",
                            scope.as_str()
                        );
                        scopes_im_dokument.push(scope);
                    }
                }
            }
        }
    }
    // Umgekehrt: ein Scope gilt erst als „mit Einsatzbezug“, wenn seine Route steht. Sonst
    // zeigte das Paneel „Anbindungen“ einen Schalter ohne Wirkung.
    for scope in Scope::ALLE {
        assert_eq!(
            scope.has_einsatzbezug(),
            scopes_im_dokument.contains(&scope),
            "{}: has_einsatzbezug und die Routen des Dokuments passen nicht zusammen",
            scope.as_str()
        );
    }

    // Ohne Freigabe liest keine dieser Routen einen Einsatz.
    let (app, _pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen_mit(&app, &admin, "Stadtfest").await;
    let scopes: Vec<&str> = Scope::ALLE
        .iter()
        .filter(|s| s.has_einsatzbezug())
        .map(|s| s.as_str())
        .collect();
    let cred = angebunden(&app, &admin, json!(scopes), &schluessel(1), IP).await;
    for (i, pfad) in UEBER_FREIGABE.iter().enumerate() {
        let konkret = pfad.replace("{id}", &einsatz.to_string());
        let (s, _, v) = signiert(
            &app,
            &cred,
            "GET",
            &konkret,
            jetzt(),
            &format!("jti-{i}"),
            IP,
        )
        .await;
        // Je Form der Antwort ihr Zeichen für „kein Einsatz“. Der Schlüssel muss da sein:
        // `v["einsatz"].is_null()` wäre auch bei fehlendem Schlüssel oder leerem Body wahr
        // (`src/AGENTS.md`, Typ-Codegen, Testfalle).
        match *pfad {
            LAGE => {
                assert_eq!(s, StatusCode::OK, "{pfad}: {v}");
                assert_eq!(
                    v.get("einsatz"),
                    Some(&Value::Null),
                    "{pfad} liest ohne Freigabe: {v}"
                );
            }
            "/api/v1/einsaetze" => {
                assert_eq!(s, StatusCode::OK, "{pfad}: {v}");
                assert_eq!(v.get("einsaetze"), Some(&json!([])), "{pfad}: {v}");
            }
            "/api/v1/einsaetze/{id}" => {
                assert_eq!(s, StatusCode::NOT_FOUND, "{pfad}: {v}");
                assert_eq!(v["code"], "not_found", "{pfad}: {v}");
            }
            andere => panic!("{andere}: hier fehlt, woran man „kein Einsatz“ erkennt"),
        }
        // Unabhängig von der Form der Antwort: der Einsatz der Org kommt nicht vor.
        assert!(
            !v.to_string().contains("Stadtfest"),
            "{pfad} nennt ohne Freigabe einen Einsatz: {v}"
        );
    }
}

/// Der frühere Schlüsselweg (LLH-1484) ist entfernt: Pfad und Verwaltung gibt es nicht mehr.
#[tokio::test]
async fn der_fruehere_schluesselweg_ist_entfernt() {
    let (app, _pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let bearer = "Bearer llh_lm_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA".to_string();
    let (s, _, _) = senden(
        &app,
        "GET",
        "/api/lagemonitor/v1/lage",
        Some(("authorization", bearer)),
        vec![],
        IP,
    )
    .await;
    assert_eq!(s, StatusCode::NOT_FOUND);
    let (s, _) = anfrage(&app, "GET", "/api/lagemonitor-zugaenge", &admin, None).await;
    assert_eq!(s, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn karte_kommt_mit_fassung_und_nur_wenn_sie_sich_geaendert_hat() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen_mit(&app, &admin, "Stadtfest").await;
    let basis = format!("/api/einsaetze/{einsatz}");
    let cred = angebunden(&app, &admin, json!(["lage:read"]), &schluessel(1), IP).await;
    freigeben(&pool, &cred, einsatz).await;
    let (s, v) = anfrage_json(
        &app,
        "PATCH",
        &basis,
        &admin,
        Some(&json!({ "einsatzort_lat": 52.96, "einsatzort_lon": 10.56 })),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");

    // Erste Abfrage: Karte und Fassung.
    let v = lage(&app, &cred, "").await;
    assert_eq!(v["karte"]["type"], "FeatureCollection");
    let features = v["karte"]["features"].as_array().unwrap();
    assert_eq!(features.len(), 1);
    assert_eq!(features[0]["type"], "Feature");
    assert_eq!(features[0]["properties"], json!({ "kind": "einsatzort" }));
    assert_eq!(
        features[0]["geometry"]["coordinates"],
        json!([10.56, 52.96])
    );
    let etag = v["karte_etag"].as_str().unwrap().to_string();
    assert_eq!(etag.len(), 16);

    // Unveränderte Karte: nur die Fassung. Die Abfrage steht in `htu`.
    let v = lage(&app, &cred, &format!("?karte={etag}")).await;
    assert!(v.get("karte").is_none(), "{v}");
    assert_eq!(v["karte_etag"], json!(etag));
    assert!(v["einsatz"].is_object());

    // Eine Gefahrenzone ändert die Karte: neue Fassung, die Zone nennt ihre Art in `subkind`.
    let (s, z) = anfrage_json(
        &app,
        "POST",
        &format!("{basis}/zonen"),
        &admin,
        Some(
            &json!({"typ": "absperrbereich", "geometrie_typ": "Polygon", "geometrie": POLY,
                     "label": "Halle 3"}),
        ),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{z}");
    let v = lage(&app, &cred, &format!("?karte={etag}")).await;
    let neu = v["karte_etag"].as_str().unwrap();
    assert_ne!(neu, etag);
    let zone = v["karte"]["features"]
        .as_array()
        .unwrap()
        .iter()
        .find(|f| f["properties"]["kind"] == "zone")
        .expect("Zone in der Karte");
    assert_eq!(zone["properties"]["subkind"], "absperrbereich");
    assert!(zone["properties"]["id"].is_i64());
    assert!(
        zone["properties"].get("typ").is_none(),
        "v1 nennt subkind, nicht typ"
    );
    assert!(
        !v.to_string().contains("Halle 3"),
        "Beschriftung ist Freitext"
    );

    // Abbestellt: weder Karte noch Fassung, die Zahlen bleiben.
    let v = lage(&app, &cred, "?karte=none").await;
    assert!(v.get("karte").is_none() && v.get("karte_etag").is_none());
    assert!(v["einsatz"]["betroffene"].is_object());
    // `aus` war der Wert des früheren Wegs; hier ist es nur eine unbekannte Fassung.
    let v = lage(&app, &cred, "?karte=aus").await;
    assert!(v["karte"].is_object());
}

#[tokio::test]
async fn lage_traegt_keine_namen_freitexte_oder_personenkennungen() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen_mit(&app, &admin, "Stadtfest").await;
    let basis = format!("/api/einsaetze/{einsatz}");
    let cred = angebunden(&app, &admin, json!(["lage:read"]), &schluessel(1), IP).await;
    freigeben(&pool, &cred, einsatz).await;

    let (s, v) = anfrage_json(
        &app,
        "PATCH",
        &basis,
        &admin,
        Some(&json!({
            "sachverhalt": "Herr Muster gestürzt",
            "meldende_stelle": "Frau Vera",
            "einsatzort": "Musterweg 3",
            "einsatzort_lat": 52.96,
            "einsatzort_lon": 10.56,
        })),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    let uhs = post(
        &app,
        &admin,
        &format!("{basis}/uhs"),
        json!({"typ": "behandlungsplatz", "bezeichnung": "BHP Nord"}),
    )
    .await["id"]
        .as_i64()
        .unwrap();
    post(
        &app,
        &admin,
        &format!("{basis}/uhs/{uhs}/status"),
        json!({"status": "aktiv"}),
    )
    .await;
    post(
        &app,
        &admin,
        &format!("{basis}/personen"),
        json!({"name": "Beispiel", "vorname": "Erika", "uhs_id": uhs}),
    )
    .await;
    post(
        &app,
        &admin,
        &format!("{basis}/freie-zeichen"),
        json!({
            "lat": 52.95, "lon": 10.55,
            "zeichen_spec": STELLE_SANITAET,
            "label": "Familie Muster",
        }),
    )
    .await;

    let v = lage(&app, &cred, "").await;
    let zeichen = v["karte"]["features"]
        .as_array()
        .unwrap()
        .iter()
        .find(|f| f["properties"]["kind"] == "zeichen")
        .expect("freies Zeichen in der Karte");
    assert_eq!(zeichen["properties"]["zeichen_spec"], STELLE_SANITAET);

    let text = v.to_string();
    for name in ["Muster", "Beispiel", "Erika", "Vera", "Musterweg"] {
        assert!(!text.contains(name), "{name} in der Antwort: {text}");
    }
    for feld in [
        "sachverhalt",
        "meldende_stelle",
        "einsatzort",
        "person_id",
        "name",
        "vorname",
        "label",
        "registrier_nr",
        "programm",
    ] {
        assert!(
            !text.contains(&format!("\"{feld}\":")),
            "Feld {feld} in der Antwort: {text}"
        );
    }
}
