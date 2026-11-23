//! iOS-Push über das Relais (LLH-2040): die Routen der Anmeldung, ihre Lebensdauer an Sitzung
//! und Konto und der Versand aus `benachrichtigung::melden` an ein Relais-Doppel.

use axum::body::Body;
use axum::http::{header, Request, StatusCode};
use lifeline_hub::ios_push::krypto::nachweis;
use lifeline_hub::ios_push::IosPush;
use lifeline_hub::web_push::krypto::b64;
use serde_json::{json, Value};
use tower::ServiceExt;

mod common;
use common::relais::{oeffnen, relais_doppel, RelaisDoppel};
use common::{
    anfrage, benutzer_anlegen, einsatz_anlegen, login_cookie, rolle_setzen, setup_mit_pool_und_live,
};

const KENNUNG: &str = "6f1c2a64-3b1e-4a55-9c1d-0d3b5a7e9f10";
const KENNUNG_2: &str = "0a8f3a6e-52a4-4d0b-8a3c-6b1f6c2d9e11";
const TOKEN: &str = "a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90";
const TOKEN_2: &str = "ff00ee11dd22cc33bb44aa5599668877ff00ee11dd22cc33bb44aa5599668877";
const KENNUNG_3: &str = "3c9d1e2f-7a6b-4c5d-8e9f-a0b1c2d3e4f5";
const TOKEN_3: &str = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

fn schluessel() -> [u8; 32] {
    [7u8; 32]
}

fn body(kennung: &str, token: &str) -> Value {
    json!({
        "kennung": kennung,
        "token": token,
        "umgebung": "sandbox",
        "schluessel": b64(&schluessel()),
        "inhalt": true,
        "stumm": ["lagebericht", "quatsch"],
    })
}

async fn mit_ios_push() -> (axum::Router, sqlx::SqlitePool) {
    let (app, pool, live) = setup_mit_pool_und_live().await;
    live.ios_push_einrichten(
        IosPush::einrichten_fuer_test(pool.clone(), "http://127.0.0.1:9".parse().unwrap()).unwrap(),
    );
    (app, pool)
}

async fn anmelden(app: &axum::Router, cookie: &str, kennung: &str, token: &str) -> StatusCode {
    anfrage(
        app,
        "PUT",
        "/api/ios-push/registration",
        cookie,
        Some(&body(kennung, token).to_string()),
    )
    .await
    .0
}

async fn zahl(pool: &sqlx::SqlitePool) -> i64 {
    sqlx::query_scalar("SELECT COUNT(*) FROM ios_push_anmeldung")
        .fetch_one(pool)
        .await
        .unwrap()
}

async fn oeffentlich_abmelden(app: &axum::Router, kennung: &str, nachweis: &str) -> StatusCode {
    app.clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/ios-push/unregister")
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(
                    json!({ "kennung": kennung, "nachweis": nachweis }).to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap()
        .status()
}

#[tokio::test]
async fn ohne_schalter_404() {
    let (app, _pool, live) = setup_mit_pool_und_live().await;
    assert!(live.ios_push().is_none());
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let uri = format!("/api/ios-push?kennung={KENNUNG}");
    assert_eq!(
        anfrage(&app, "GET", &uri, &admin, None).await.0,
        StatusCode::NOT_FOUND
    );
    assert_eq!(
        anmelden(&app, &admin, KENNUNG, TOKEN).await,
        StatusCode::NOT_FOUND
    );
    let del = json!({ "kennung": KENNUNG }).to_string();
    assert_eq!(
        anfrage(
            &app,
            "DELETE",
            "/api/ios-push/registration",
            &admin,
            Some(&del)
        )
        .await
        .0,
        StatusCode::NOT_FOUND
    );
    assert_eq!(
        oeffentlich_abmelden(&app, KENNUNG, "x").await,
        StatusCode::NOT_FOUND
    );
}

#[tokio::test]
async fn geraetekonto_403() {
    let (app, _pool) = mit_ios_push().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let (s, v) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/geraete"),
        &admin,
        Some(r#"{"ansicht":"lagemonitor","bezeichnung":"Monitor"}"#),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
    let code = v["code"]["code"].as_str().unwrap();
    let resp = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/devices/pair")
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(json!({ "code": code }).to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let geraet = resp.headers()[header::SET_COOKIE]
        .to_str()
        .unwrap()
        .split(';')
        .next()
        .unwrap()
        .to_string();
    assert_eq!(
        anmelden(&app, &geraet, KENNUNG, TOKEN).await,
        StatusCode::FORBIDDEN
    );
    let uri = format!("/api/ios-push?kennung={KENNUNG}");
    assert_eq!(
        anfrage(&app, "GET", &uri, &geraet, None).await.0,
        StatusCode::FORBIDDEN
    );
}

#[tokio::test]
async fn anmelden_stand_abmelden() {
    let (app, pool) = mit_ios_push().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let uri = format!("/api/ios-push?kennung={KENNUNG}");

    let (s, v) = anfrage(&app, "GET", &uri, &admin, None).await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert_eq!(v["eingeschaltet"], true);
    assert_eq!(v["angemeldet"], false);
    assert_eq!(v["inhalt"], false);
    assert_eq!(v["stumm"], json!([]));
    assert_eq!(v["relais_gesperrt"], false);

    assert_eq!(
        anmelden(&app, &admin, KENNUNG, TOKEN).await,
        StatusCode::NO_CONTENT
    );
    let (_, v) = anfrage(&app, "GET", &uri, &admin, None).await;
    assert_eq!(v["angemeldet"], true);
    assert_eq!(v["inhalt"], true);
    assert_eq!(v["stumm"], json!(["lagebericht"]));

    // Erneut anmelden ersetzt, es bleibt eine Zeile.
    assert_eq!(
        anmelden(&app, &admin, KENNUNG, TOKEN).await,
        StatusCode::NO_CONTENT
    );
    assert_eq!(zahl(&pool).await, 1);

    // Ein anderer Nutzer sieht die Anmeldung nicht.
    benutzer_anlegen(&app, &admin, "marlene", "keine").await;
    let marlene = login_cookie(&app, "marlene", "marlenepw1").await;
    let (_, v) = anfrage(&app, "GET", &uri, &marlene, None).await;
    assert_eq!(v["angemeldet"], false);

    // Abmelden ist idempotent.
    let del = json!({ "kennung": KENNUNG }).to_string();
    for _ in 0..2 {
        let (s, _) = anfrage(
            &app,
            "DELETE",
            "/api/ios-push/registration",
            &admin,
            Some(&del),
        )
        .await;
        assert_eq!(s, StatusCode::NO_CONTENT);
    }
    assert_eq!(zahl(&pool).await, 0);
}

/// F-I2: `an_dieser_sitzung` sagt dem Client, ob die Anmeldung an der Sitzung dieser Anfrage
/// hängt. Nach einem Sitzungsablauf und neuem Login ist sie zwar angemeldet, aber an keiner
/// Sitzung; ein Logout nähme sie dann nicht mit. Der Client bindet sie dann per `PUT` neu.
#[tokio::test]
async fn stand_nennt_ob_die_anmeldung_an_dieser_sitzung_haengt() {
    let (app, pool) = mit_ios_push().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    benutzer_anlegen(&app, &admin, "marlene", "keine").await;
    let erste = login_cookie(&app, "marlene", "marlenepw1").await;
    let uri = format!("/api/ios-push?kennung={KENNUNG}");
    let stand = |cookie: String| {
        let app = app.clone();
        let uri = uri.clone();
        async move {
            let (s, v) = anfrage(&app, "GET", &uri, &cookie, None).await;
            assert_eq!(s, StatusCode::OK, "{v}");
            (v["angemeldet"].clone(), v["an_dieser_sitzung"].clone())
        }
    };
    assert_eq!(stand(erste.clone()).await, (json!(false), json!(false)));
    assert_eq!(
        anmelden(&app, &erste, KENNUNG, TOKEN).await,
        StatusCode::NO_CONTENT
    );
    assert_eq!(stand(erste.clone()).await, (json!(true), json!(true)));

    // Eine zweite Sitzung desselben Kontos sieht die Anmeldung, aber nicht an sich.
    let zweite = login_cookie(&app, "marlene", "marlenepw1").await;
    assert_eq!(stand(zweite.clone()).await, (json!(true), json!(false)));

    // Sitzung abgelaufen: die Anmeldung hängt an keiner; neu binden per PUT.
    sqlx::query("UPDATE ios_push_anmeldung SET session_token_hash = NULL")
        .execute(&pool)
        .await
        .unwrap();
    assert_eq!(stand(erste.clone()).await, (json!(true), json!(false)));
    assert_eq!(
        anmelden(&app, &zweite, KENNUNG, TOKEN).await,
        StatusCode::NO_CONTENT
    );
    assert_eq!(stand(zweite).await, (json!(true), json!(true)));
    assert_eq!(stand(erste).await, (json!(true), json!(false)));
}

/// Review M3: wer eine fremde Kennung kennt, meldet die Anmeldung eines anderen Kontos nicht ab.
/// Dasselbe Gerät (neues Token, anderes Konto) darf sie übernehmen: es beweist sich mit seinem
/// Schlüssel, der je Kennung auf dem Gerät bleibt.
#[tokio::test]
async fn fremde_kennung_uebernimmt_nur_dasselbe_geraet() {
    let (app, pool) = mit_ios_push().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    benutzer_anlegen(&app, &admin, "marlene", "keine").await;
    let marlene = login_cookie(&app, "marlene", "marlenepw1").await;
    assert_eq!(
        anmelden(&app, &admin, KENNUNG, TOKEN).await,
        StatusCode::NO_CONTENT
    );

    let mut fremd = body(KENNUNG, TOKEN_2);
    fremd["schluessel"] = json!(b64(&[9u8; 32]));
    let (s, v) = anfrage(
        &app,
        "PUT",
        "/api/ios-push/registration",
        &marlene,
        Some(&fremd.to_string()),
    )
    .await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY, "{v}");
    let zeilen: Vec<(String, String)> =
        sqlx::query_as("SELECT kennung, token FROM ios_push_anmeldung")
            .fetch_all(&pool)
            .await
            .unwrap();
    assert_eq!(zeilen, vec![(KENNUNG.to_string(), TOKEN.to_string())]);

    // Dasselbe Gerät mit neuem Token unter einem anderen Konto: übernimmt die Kennung.
    assert_eq!(
        anmelden(&app, &marlene, KENNUNG, TOKEN_2).await,
        StatusCode::NO_CONTENT
    );
    let zeilen: Vec<(String, String, String)> = sqlx::query_as(
        "SELECT a.kennung, a.token, b.benutzername FROM ios_push_anmeldung a \
         JOIN benutzer b ON b.id = a.benutzer_id",
    )
    .fetch_all(&pool)
    .await
    .unwrap();
    assert_eq!(
        zeilen,
        vec![(
            KENNUNG.to_string(),
            TOKEN_2.to_string(),
            "marlene".to_string()
        )]
    );
}

#[tokio::test]
async fn validierung_400_je_feld() {
    let (app, pool) = mit_ios_push().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let ok = body(KENNUNG, TOKEN);
    let faelle: Vec<(&str, Value)> = vec![
        ("kennung", json!("kein-uuid")),
        ("token", json!("zz")),
        ("token", json!("ab".repeat(33) + "g")),
        ("token", json!("ab")),
        ("token", json!("ab".repeat(101))),
        ("umgebung", json!("test")),
        ("schluessel", json!("!!!")),
        ("schluessel", json!(b64(&[1u8; 16]))),
        ("stumm", json!(vec!["lagebericht"; 200])),
    ];
    for (feld, wert) in faelle {
        let mut b = ok.clone();
        b[feld] = wert.clone();
        let (s, v) = anfrage(
            &app,
            "PUT",
            "/api/ios-push/registration",
            &admin,
            Some(&b.to_string()),
        )
        .await;
        assert_eq!(s, StatusCode::BAD_REQUEST, "{feld} = {wert}: {v}");
    }
    let (s, _) = anfrage(&app, "GET", "/api/ios-push?kennung=kein-uuid", &admin, None).await;
    assert_eq!(s, StatusCode::BAD_REQUEST);
    assert_eq!(zahl(&pool).await, 0);
}

#[tokio::test]
async fn abmelden_ohne_sitzung_immer_204_und_nur_mit_nachweis_wirksam() {
    let (app, pool) = mit_ios_push().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    assert_eq!(
        anmelden(&app, &admin, KENNUNG, TOKEN).await,
        StatusCode::NO_CONTENT
    );

    // Falscher Nachweis und unbekannte Kennung: 204, nichts ändert sich.
    assert_eq!(
        oeffentlich_abmelden(&app, KENNUNG, "falsch").await,
        StatusCode::NO_CONTENT
    );
    assert_eq!(
        oeffentlich_abmelden(&app, KENNUNG_2, "egal").await,
        StatusCode::NO_CONTENT
    );
    assert_eq!(zahl(&pool).await, 1);

    // Richtiger Nachweis löscht.
    let n = nachweis(&schluessel(), KENNUNG);
    assert_eq!(
        oeffentlich_abmelden(&app, KENNUNG, &n).await,
        StatusCode::NO_CONTENT
    );
    assert_eq!(zahl(&pool).await, 0);
}

#[tokio::test]
async fn logout_loescht_die_anmeldung_dieser_sitzung() {
    let (app, pool) = mit_ios_push().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    benutzer_anlegen(&app, &admin, "marlene", "keine").await;
    let marlene1 = login_cookie(&app, "marlene", "marlenepw1").await;
    let marlene2 = login_cookie(&app, "marlene", "marlenepw1").await;
    assert_eq!(
        anmelden(&app, &marlene1, KENNUNG, TOKEN).await,
        StatusCode::NO_CONTENT
    );
    assert_eq!(
        anmelden(&app, &marlene2, KENNUNG_2, TOKEN_2).await,
        StatusCode::NO_CONTENT
    );
    let (s, _) = anfrage(&app, "POST", "/api/auth/logout", &marlene1, None).await;
    assert!(s.is_success(), "{s}");
    let kennungen: Vec<String> = sqlx::query_scalar("SELECT kennung FROM ios_push_anmeldung")
        .fetch_all(&pool)
        .await
        .unwrap();
    assert_eq!(kennungen, vec![KENNUNG_2.to_string()]);
}

/// Review M6: Logout nimmt Anmeldung und Sitzung in einer Transaktion
/// (`session::abmelden`); ein `PUT` derselben Sitzung kann sich nicht zwischen beide schieben
/// und das Gerät nach dem Logout wieder anmelden.
#[tokio::test]
async fn abmelden_loescht_anmeldung_und_sitzung_zusammen() {
    let (app, pool) = mit_ios_push().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    assert_eq!(
        anmelden(&app, &admin, KENNUNG, TOKEN).await,
        StatusCode::NO_CONTENT
    );
    let token = admin
        .split(';')
        .next()
        .and_then(|c| c.split_once('='))
        .map(|(_, t)| t.to_string())
        .unwrap();
    let kennung = lifeline_hub::auth::session::abmelden(&pool, &token)
        .await
        .unwrap();
    assert!(kennung.is_some(), "die Sitzung hatte eine Kennung");
    assert_eq!(zahl(&pool).await, 0);
    let sitzungen: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM session")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(sitzungen, 0);
}

#[tokio::test]
async fn sitzungen_beenden_alle_loescht_alle_anmeldungen() {
    let (app, pool) = mit_ios_push().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let marlene_id = benutzer_anlegen(&app, &admin, "marlene", "keine").await;
    let marlene1 = login_cookie(&app, "marlene", "marlenepw1").await;
    let marlene2 = login_cookie(&app, "marlene", "marlenepw1").await;
    assert_eq!(
        anmelden(&app, &marlene1, KENNUNG, TOKEN).await,
        StatusCode::NO_CONTENT
    );
    assert_eq!(
        anmelden(&app, &marlene2, KENNUNG_2, TOKEN_2).await,
        StatusCode::NO_CONTENT
    );
    // Ein Admin beendet alle Sitzungen: auch deren Anmeldungen gehen.
    let (s, v) = anfrage(
        &app,
        "POST",
        &format!("/api/users/{marlene_id}/sessions/end"),
        &admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert_eq!(zahl(&pool).await, 0);
}

#[tokio::test]
async fn eine_sitzung_beenden_loescht_nur_deren_anmeldung() {
    let (app, pool) = mit_ios_push().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    benutzer_anlegen(&app, &admin, "marlene", "keine").await;
    let marlene1 = login_cookie(&app, "marlene", "marlenepw1").await;
    let marlene2 = login_cookie(&app, "marlene", "marlenepw1").await;
    assert_eq!(
        anmelden(&app, &marlene1, KENNUNG, TOKEN).await,
        StatusCode::NO_CONTENT
    );
    assert_eq!(
        anmelden(&app, &marlene2, KENNUNG_2, TOKEN_2).await,
        StatusCode::NO_CONTENT
    );
    let (_, liste) = anfrage(&app, "GET", "/api/auth/sessions", &marlene2, None).await;
    let fremde = liste
        .as_array()
        .unwrap()
        .iter()
        .find(|s| s["aktuell"] == false)
        .unwrap()["kennung"]
        .as_str()
        .unwrap()
        .to_string();
    let (s, v) = anfrage(
        &app,
        "DELETE",
        &format!("/api/auth/sessions/{fremde}"),
        &marlene2,
        None,
    )
    .await;
    assert!(s.is_success(), "{s} {v}");
    let kennungen: Vec<String> = sqlx::query_scalar("SELECT kennung FROM ios_push_anmeldung")
        .fetch_all(&pool)
        .await
        .unwrap();
    assert_eq!(kennungen, vec![KENNUNG_2.to_string()]);

    // „Andere beenden“ lässt die der eigenen Sitzung stehen.
    let (s, _) = anfrage(
        &app,
        "POST",
        "/api/auth/sessions/end-others",
        &marlene2,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(zahl(&pool).await, 1);
}

#[tokio::test]
async fn andere_beenden_loescht_alle_anmeldungen_ausser_der_eigenen_auch_ohne_sitzung() {
    let (app, pool) = mit_ios_push().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    benutzer_anlegen(&app, &admin, "marlene", "keine").await;
    let marlene1 = login_cookie(&app, "marlene", "marlenepw1").await;
    let marlene2 = login_cookie(&app, "marlene", "marlenepw1").await;
    let marlene3 = login_cookie(&app, "marlene", "marlenepw1").await;
    assert_eq!(
        anmelden(&app, &marlene1, KENNUNG, TOKEN).await,
        StatusCode::NO_CONTENT
    );
    assert_eq!(
        anmelden(&app, &marlene2, KENNUNG_2, TOKEN_2).await,
        StatusCode::NO_CONTENT
    );
    assert_eq!(
        anmelden(&app, &marlene3, KENNUNG_3, TOKEN_3).await,
        StatusCode::NO_CONTENT
    );
    // Das verlorene Gerät: seine Sitzung ist längst abgelaufen und weggeräumt, die Anmeldung
    // steht ohne Sitzung (`session_token_hash` NULL) und pusht weiter.
    sqlx::query(
        "DELETE FROM session WHERE token_hash = \
         (SELECT session_token_hash FROM ios_push_anmeldung WHERE kennung = ?)",
    )
    .bind(KENNUNG_3)
    .execute(&pool)
    .await
    .unwrap();
    let ohne: Option<String> =
        sqlx::query_scalar("SELECT session_token_hash FROM ios_push_anmeldung WHERE kennung = ?")
            .bind(KENNUNG_3)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert!(ohne.is_none());

    let (s, _) = anfrage(
        &app,
        "POST",
        "/api/auth/sessions/end-others",
        &marlene1,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    let kennungen: Vec<String> = sqlx::query_scalar("SELECT kennung FROM ios_push_anmeldung")
        .fetch_all(&pool)
        .await
        .unwrap();
    assert_eq!(
        kennungen,
        vec![KENNUNG.to_string()],
        "nur das eigene Gerät pusht weiter"
    );
}

#[tokio::test]
async fn deaktivieren_loescht_die_anmeldungen() {
    let (app, pool) = mit_ios_push().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let marlene_id = benutzer_anlegen(&app, &admin, "marlene", "keine").await;
    let marlene = login_cookie(&app, "marlene", "marlenepw1").await;
    assert_eq!(
        anmelden(&app, &marlene, KENNUNG, TOKEN).await,
        StatusCode::NO_CONTENT
    );
    let (s, v) = anfrage(
        &app,
        "POST",
        &format!("/api/users/{marlene_id}/deactivate"),
        &admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert_eq!(zahl(&pool).await, 0);
}

/// Review M1: Deaktivieren über `PATCH /api/users/{id}` mit `aktiv: false` nimmt die
/// Anmeldungen mit wie `deaktivieren`; sonst pushte das alte Gerät nach einer Reaktivierung wieder.
#[tokio::test]
async fn bearbeiten_mit_aktiv_false_loescht_die_anmeldungen() {
    let (app, pool) = mit_ios_push().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let marlene_id = benutzer_anlegen(&app, &admin, "marlene", "keine").await;
    let marlene = login_cookie(&app, "marlene", "marlenepw1").await;
    assert_eq!(
        anmelden(&app, &marlene, KENNUNG, TOKEN).await,
        StatusCode::NO_CONTENT
    );
    // Ohne Deaktivieren bleibt sie.
    let (s, v) = anfrage(
        &app,
        "PATCH",
        &format!("/api/users/{marlene_id}"),
        &admin,
        Some(&json!({ "anzeigename": "Marlene M." }).to_string()),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert_eq!(zahl(&pool).await, 1);
    let (s, v) = anfrage(
        &app,
        "PATCH",
        &format!("/api/users/{marlene_id}"),
        &admin,
        Some(&json!({ "aktiv": false }).to_string()),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert_eq!(zahl(&pool).await, 0);
}

#[tokio::test]
async fn ablauf_der_sitzung_laesst_anmeldung_und_versand_bestehen() {
    let (app, pool) = mit_ios_push().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    benutzer_anlegen(&app, &admin, "marlene", "keine").await;
    let marlene = login_cookie(&app, "marlene", "marlenepw1").await;
    assert_eq!(
        anmelden(&app, &marlene, KENNUNG, TOKEN).await,
        StatusCode::NO_CONTENT
    );
    sqlx::query("UPDATE session SET expires_at = datetime('now', '-1 hour')")
        .execute(&pool)
        .await
        .unwrap();
    lifeline_hub::auth::session::purge_abgelaufene(&pool)
        .await
        .unwrap();
    assert_eq!(zahl(&pool).await, 1, "Ablauf löscht die Anmeldung nicht");
    let hash: Option<String> =
        sqlx::query_scalar("SELECT session_token_hash FROM ios_push_anmeldung")
            .fetch_one(&pool)
            .await
            .unwrap();
    assert!(hash.is_none(), "Sitzungsbindung fällt weg");
    let a = lifeline_hub::ios_push::repo::anmeldungen_von(
        &pool,
        &[
            sqlx::query_scalar("SELECT id FROM benutzer WHERE benutzername = 'marlene'")
                .fetch_one(&pool)
                .await
                .unwrap(),
        ],
    )
    .await
    .unwrap();
    assert_eq!(a.len(), 1, "der Versand findet die Anmeldung weiter");
}

/// Sperrt den Zugang dieser Instanz am Relais seit einem festen Zeitpunkt.
async fn relais_gesperrt_seit(pool: &sqlx::SqlitePool, seit: &str) {
    lifeline_hub::ios_push::repo::relais_zugang_speichern(
        pool,
        &lifeline_hub::ios_push::repo::RelaisZugang {
            server_id: "s1".into(),
            geheimnis: "g1".into(),
            gesperrt: true,
            sperre_abgelaufen: false,
        },
    )
    .await
    .unwrap();
    sqlx::query("UPDATE ios_push_relais SET gesperrt_at = ?")
        .bind(seit)
        .execute(pool)
        .await
        .unwrap();
}

#[tokio::test]
async fn verwaltung_der_instanz_zeigt_die_sperre_des_relais() {
    let (app, pool) = mit_ios_push().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let (s, v) = anfrage(&app, "GET", "/api/admin/instance", &admin, None).await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert!(!v
        .as_object()
        .unwrap()
        .contains_key("ios_push_relais_gesperrt_seit"));

    relais_gesperrt_seit(&pool, "2026-11-20 08:15:00").await;
    let (s, v) = anfrage(&app, "GET", "/api/admin/instance", &admin, None).await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert_eq!(v["ios_push_relais_gesperrt_seit"], "2026-11-20 08:15:00");
}

#[tokio::test]
async fn ohne_ios_push_zeigt_die_verwaltung_keine_sperre() {
    let (app, pool, _live) = setup_mit_pool_und_live().await;
    relais_gesperrt_seit(&pool, "2026-11-20 08:15:00").await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let (s, v) = anfrage(&app, "GET", "/api/admin/instance", &admin, None).await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert!(!v
        .as_object()
        .unwrap()
        .contains_key("ios_push_relais_gesperrt_seit"));
}

// ── Versand aus `melden` (Aufgabe 7) ─────────────────────────────────────────────────────────

use lifeline_hub::benachrichtigung::{
    melden, Adressat, Anlass, BenachrichtigungArt as Art, BenachrichtigungBezugTyp as Typ, Bezug,
};
use lifeline_hub::ios_push::repo as ios_repo;
use lifeline_hub::live::LiveHub;
use lifeline_hub::web_push::repo::Wahl;
use std::time::Duration;

/// Ein Gerät: Kennung, Token, Schlüssel.
struct Geraet {
    kennung: String,
    token: String,
    schluessel: [u8; 32],
}

impl Geraet {
    fn neu(n: u8) -> Self {
        Geraet {
            kennung: format!("6f1c2a64-3b1e-4a55-9c1d-0d3b5a7e9f{n:02x}"),
            token: format!("{n:02x}").repeat(32),
            schluessel: [n; 32],
        }
    }
}

struct Versand {
    app: axum::Router,
    pool: sqlx::SqlitePool,
    live: LiveHub,
    einsatz: i64,
    anna: i64,
    relais: RelaisDoppel,
}

/// Eine Instanz mit iOS-Push an ein Relais-Doppel; Anna und Bert sind Führungspersonal eines
/// Einsatzes.
async fn versand() -> Versand {
    let (app, pool, live) = setup_mit_pool_und_live().await;
    let relais = relais_doppel().await;
    live.ios_push_einrichten(relais.ios_push(&pool));
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let anna = benutzer_anlegen(&app, &admin, "annika", "keine").await;
    let bert = benutzer_anlegen(&app, &admin, "bertram", "keine").await;
    rolle_setzen(&app, &admin, einsatz, anna, "fuehrungspersonal").await;
    rolle_setzen(&app, &admin, einsatz, bert, "fuehrungspersonal").await;
    Versand {
        app,
        pool,
        live,
        einsatz,
        anna,
        relais,
    }
}

impl Versand {
    /// Meldet ein Gerät für `benutzer` direkt im Speicher an, mit eigener Sitzung.
    async fn geraet(&self, benutzer: i64, g: &Geraet, inhalt: bool, stumm: &[Art]) {
        let sitzung = lifeline_hub::auth::session::anlegen(
            &self.pool,
            benutzer,
            None,
            lifeline_hub::auth::provider::Anmeldeweg::Passwort,
        )
        .await
        .unwrap();
        ios_repo::anmelden(
            &self.pool,
            benutzer,
            &lifeline_hub::auth::session::hash_token(&sitzung),
            &ios_repo::Eingabe {
                kennung: &g.kennung,
                token: &g.token,
                umgebung: "sandbox",
                schluessel: &b64(&g.schluessel),
                wahl: &Wahl {
                    inhalt,
                    stumm: stumm.to_vec(),
                },
            },
        )
        .await
        .unwrap();
    }

    /// Eine Sitzung für `benutzer` als Cookie.
    async fn cookie(&self, benutzer: i64) -> String {
        let token = lifeline_hub::auth::session::anlegen(
            &self.pool,
            benutzer,
            None,
            lifeline_hub::auth::provider::Anmeldeweg::Passwort,
        )
        .await
        .unwrap();
        format!("{}={token}", lifeline_hub::auth::session::SESSION_COOKIE)
    }

    /// Eine Meldung direkt im Speicher (ohne eigenen Hinweis).
    async fn meldung(&self, absender: &str, inhalt: &str) -> i64 {
        sqlx::query_scalar(
            "INSERT INTO meldung (einsatz_id, lfd_nr, absender, meldeweg, inhalt, ereigniszeit, \
             eingang_at, erfasst_von_id) VALUES (?, 7, ?, 'funk', ?, '2026-11-22 08:00:00', \
             '2026-11-22 08:00:00', 1) RETURNING id",
        )
        .bind(self.einsatz)
        .bind(absender)
        .bind(inhalt)
        .fetch_one(&self.pool)
        .await
        .unwrap()
    }

    async fn melden_an(&self, art: Art, typ: Typ, bezug_id: i64, an: i64) -> Vec<i64> {
        melden(
            &self.pool,
            &self.live,
            Anlass::neu(self.einsatz, art, Bezug::neu(typ, bezug_id)).an(Adressat::Nutzer(an)),
        )
        .await
    }

    /// Die Nachrichten des nächsten Aufrufs von `/v1/senden`.
    async fn nachrichten(&mut self) -> Vec<Value> {
        self.relais.naechste().await["nachrichten"]
            .as_array()
            .unwrap()
            .clone()
    }
}

fn nachricht_an<'a>(nachrichten: &'a [Value], g: &Geraet) -> &'a Value {
    nachrichten
        .iter()
        .find(|n| n["token"] == g.token.as_str())
        .unwrap_or_else(|| panic!("keine Nachricht an {}: {nachrichten:?}", g.token))
}

/// Ziel 1: ein Alarm geht immer, ein Hinweis nicht an ein Gerät, auf dem seine Art stumm ist.
#[tokio::test]
async fn alarm_kommt_trotz_stumm_hinweis_nicht() {
    let mut w = versand().await;
    let g = Geraet::neu(1);
    w.geraet(w.anna, &g, false, &[Art::Meldung]).await;
    let m = w.meldung("Florian Nord 1", "Deich bricht").await;

    assert_eq!(
        w.melden_an(Art::Meldung, Typ::Meldung, m, w.anna).await,
        vec![w.anna]
    );
    w.relais.keine().await;

    // Eine andere Art bleibt laut.
    w.melden_an(Art::AuftragErteilt, Typ::Auftrag, 1, w.anna)
        .await;
    let n = w.nachrichten().await;
    assert_eq!(n.len(), 1);
    assert_eq!(n[0]["stufe"], "hinweis");

    // Selbst ein Alarm in der Stummliste geht.
    sqlx::query("UPDATE ios_push_anmeldung SET stumm = '[\"sofortmeldung\",\"meldung\"]'")
        .execute(&w.pool)
        .await
        .unwrap();
    w.melden_an(Art::Sofortmeldung, Typ::Meldung, m, w.anna)
        .await;
    let n = w.nachrichten().await;
    assert_eq!(n.len(), 1);
    assert_eq!(n[0]["stufe"], "alarm");
    assert_eq!(n[0]["token"], g.token.as_str());
    assert_eq!(n[0]["umgebung"], "sandbox");
}

/// Stilles ist schon gelesen und erreicht kein Gerät.
#[tokio::test]
async fn still_erreicht_kein_geraet() {
    let mut w = versand().await;
    w.geraet(w.anna, &Geraet::neu(1), false, &[]).await;
    sqlx::query(
        "INSERT INTO benutzer_einstellungen (benutzer_id, schluessel, wert, geaendert_at) \
         VALUES (?, 'benachrichtigungen_aus', '[\"gefahr\"]', datetime('now'))",
    )
    .bind(w.anna)
    .execute(&w.pool)
    .await
    .unwrap();
    assert!(w
        .melden_an(Art::Gefahr, Typ::Gefahrengebiet, 1, w.anna)
        .await
        .is_empty());
    let still: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM benachrichtigung WHERE benutzer_id = ? AND stufe = 'still'",
    )
    .bind(w.anna)
    .fetch_one(&w.pool)
    .await
    .unwrap();
    assert_eq!(still, 1, "die stille Zeile gibt es");
    w.relais.keine().await;
}

/// Ziel 2: Titel, Detail und Pfad sind dieselben wie in `GET /api/notifications/{id}`.
#[tokio::test]
async fn nutzlast_entschluesselt_ergibt_titel_detail_pfad_wie_die_anzeige() {
    let mut w = versand().await;
    let g = Geraet::neu(1);
    w.geraet(w.anna, &g, false, &[]).await;
    let m = w.meldung("Florian Nord 1", "Deich bricht").await;
    w.melden_an(Art::Meldung, Typ::Meldung, m, w.anna).await;
    let n = w.nachrichten().await;
    let (kennung, k) = oeffnen(
        nachricht_an(&n, &g)["nutzlast"].as_str().unwrap(),
        &g.schluessel,
    );
    assert_eq!(kennung, g.kennung);
    let b = k["b"].as_i64().unwrap();
    let cookie = w.cookie(w.anna).await;
    let (s, anzeige) = anfrage(
        &w.app,
        "GET",
        &format!("/api/notifications/{b}"),
        &cookie,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{anzeige}");
    assert_eq!(k["v"], 1);
    assert_eq!(k["s"], lifeline_hub::instanz::name());
    assert_eq!(k["e"], w.einsatz);
    assert_eq!(k["stufe"], "hinweis");
    assert_eq!(k["titel"], anzeige["titel"]);
    assert_eq!(k["detail"], anzeige["detail"]);
    assert!(k["detail"].is_string(), "{k}");
    assert_eq!(k["pfad"], anzeige["pfad"]);
    // Ohne die Wahl „Mit Absender und Wortlaut“ kein Inhalt.
    assert!(
        k.get("absender").is_none() && k.get("wortlaut").is_none(),
        "{k}"
    );
}

/// Ziel 2: mit der Wahl am Gerät kommen Absender und Wortlaut mit, auf dem anderen Gerät
/// derselben Person nicht.
#[tokio::test]
async fn mit_inhalt_kommen_absender_und_wortlaut() {
    let mut w = versand().await;
    let mit = Geraet::neu(1);
    let ohne = Geraet::neu(2);
    w.geraet(w.anna, &mit, true, &[]).await;
    w.geraet(w.anna, &ohne, false, &[]).await;
    let m = w
        .meldung("  Florian Nord 1 ", "  Deich bricht bei km 12  ")
        .await;
    w.melden_an(Art::Sofortmeldung, Typ::Meldung, m, w.anna)
        .await;
    let n = w.nachrichten().await;
    assert_eq!(n.len(), 2);
    let (_, k) = oeffnen(
        nachricht_an(&n, &mit)["nutzlast"].as_str().unwrap(),
        &mit.schluessel,
    );
    assert_eq!(k["absender"], "Florian Nord 1");
    assert_eq!(k["wortlaut"], "Deich bricht bei km 12");
    let (_, k) = oeffnen(
        nachricht_an(&n, &ohne)["nutzlast"].as_str().unwrap(),
        &ohne.schluessel,
    );
    assert!(
        k.get("absender").is_none() && k.get("wortlaut").is_none(),
        "{k}"
    );

    // Eine Art ohne Meldungsinhalt im Service Worker (Auftrag) trägt auch hier keinen.
    w.melden_an(Art::AuftragErteilt, Typ::Auftrag, 1, w.anna)
        .await;
    let n = w.nachrichten().await;
    let (_, k) = oeffnen(
        nachricht_an(&n, &mit)["nutzlast"].as_str().unwrap(),
        &mit.schluessel,
    );
    assert!(
        k.get("absender").is_none() && k.get("wortlaut").is_none(),
        "{k}"
    );
}

/// Review Focus 5: Absender und Wortlaut nur, wenn der Empfänger die Meldung lesen dürfte. Die
/// Übernahme in die Lage erreicht die Leser der Lagemeldungen; wer das Modul Meldungen nicht
/// lesen darf, bekäme von `GET …/reports/{mid}` 403 und darum hier keinen Inhalt.
#[tokio::test]
async fn ohne_leserecht_fehlen_absender_und_wortlaut() {
    let mut w = versand().await;
    let g = Geraet::neu(1);
    w.geraet(w.anna, &g, true, &[]).await;
    let m = w.meldung("Florian Nord 1", "Deich bricht").await;

    // Mit Recht: der Inhalt kommt mit.
    w.melden_an(Art::Meldung, Typ::LageUebernahme, m, w.anna)
        .await;
    let n = w.nachrichten().await;
    let (_, k) = oeffnen(
        nachricht_an(&n, &g)["nutzlast"].as_str().unwrap(),
        &g.schluessel,
    );
    assert_eq!(k["absender"], "Florian Nord 1", "{k}");

    // Das Modul Meldungen nur noch für Führungskräfte der Org: Anna verliert das Leserecht.
    sqlx::query(
        "INSERT INTO einsatz_modul_override (einsatz_id, modul_key, sichtbar, benoetigte_rolle) \
         VALUES (?, 'meldungen', 1, 'fuehrungskraft')",
    )
    .bind(w.einsatz)
    .execute(&w.pool)
    .await
    .unwrap();
    let cookie = w.cookie(w.anna).await;
    let (s, _) = anfrage(
        &w.app,
        "GET",
        &format!("/api/einsaetze/{}/reports/{m}", w.einsatz),
        &cookie,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::FORBIDDEN, "die Route liest es ihr nicht vor");

    assert_eq!(
        w.melden_an(Art::Meldung, Typ::LageUebernahme, m, w.anna)
            .await,
        vec![w.anna],
        "die Übernahme erreicht sie weiter"
    );
    let n = w.nachrichten().await;
    let (_, k) = oeffnen(
        nachricht_an(&n, &g)["nutzlast"].as_str().unwrap(),
        &g.schluessel,
    );
    assert!(
        k.get("absender").is_none() && k.get("wortlaut").is_none(),
        "{k}"
    );
    assert!(k["titel"].is_string() && k["pfad"].is_string(), "{k}");
}

/// Review Focus 2: ein langer Wortlaut wird an einer Zeichengrenze gekürzt, der Umschlag bleibt
/// unter der Grenze des Relais (4096) und dem Anteil an der APNs-Nutzlast (3 KB).
#[tokio::test]
async fn langer_wortlaut_wird_an_zeichengrenze_gekuerzt() {
    let mut w = versand().await;
    let g = Geraet::neu(1);
    w.geraet(w.anna, &g, true, &[]).await;
    let lang = "ä🚑".repeat(10_000);
    let m = w.meldung("Florian Nord 1", &lang).await;
    w.melden_an(Art::Sofortmeldung, Typ::Meldung, m, w.anna)
        .await;
    let n = w.nachrichten().await;
    let nutzlast = nachricht_an(&n, &g)["nutzlast"].as_str().unwrap();
    assert!(nutzlast.len() <= 4096, "{}", nutzlast.len());
    assert!(nutzlast.len() <= 3072, "{}", nutzlast.len());
    let (_, k) = oeffnen(nutzlast, &g.schluessel);
    let wortlaut = k["wortlaut"].as_str().expect("gekürzt, nicht weggelassen");
    let anfang = wortlaut
        .strip_suffix('…')
        .expect("Auslassungszeichen am Ende");
    assert!(anfang.chars().count() > 100, "{}", anfang.chars().count());
    assert!(lang.starts_with(anfang));
    assert_eq!(k["absender"], "Florian Nord 1");
}

/// Meldet das Relais ein Token als ungültig, fällt die Anmeldung.
#[tokio::test]
async fn token_ungueltig_loescht_die_anmeldung() {
    let mut w = versand().await;
    let g = Geraet::neu(1);
    w.geraet(w.anna, &g, false, &[]).await;
    *w.relais.ergebnis.lock().unwrap() = "token_ungueltig";
    w.melden_an(Art::Sofortmeldung, Typ::Meldung, 1, w.anna)
        .await;
    w.nachrichten().await;
    for _ in 0..100 {
        if ios_repo::anmeldungen_von(&w.pool, &[w.anna])
            .await
            .unwrap()
            .is_empty()
        {
            return;
        }
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    panic!("Anmeldung nach token_ungueltig nicht gelöscht");
}

/// Review Focus 3: ein Relais, das annimmt, aber nie antwortet, hält `melden` nicht auf.
#[tokio::test]
async fn haengendes_relais_haelt_melden_nicht_auf() {
    let (app, pool, live) = setup_mit_pool_und_live().await;
    // Ein Port, der annimmt, aber nie antwortet.
    let stumm = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let adresse = stumm.local_addr().unwrap();
    live.ios_push_einrichten(
        IosPush::einrichten_fuer_test(pool.clone(), format!("http://{adresse}").parse().unwrap())
            .unwrap(),
    );
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let anna = benutzer_anlegen(&app, &admin, "annika", "keine").await;
    rolle_setzen(&app, &admin, einsatz, anna, "fuehrungspersonal").await;
    let w = Versand {
        app,
        pool,
        live,
        einsatz,
        anna,
        relais: relais_doppel().await,
    };
    w.geraet(anna, &Geraet::neu(1), true, &[]).await;
    let start = std::time::Instant::now();
    assert_eq!(
        w.melden_an(Art::Sofortmeldung, Typ::Meldung, 1, anna).await,
        vec![anna]
    );
    assert!(
        start.elapsed() < Duration::from_millis(200),
        "{:?}",
        start.elapsed()
    );
    drop(stumm);
}

/// `kollaps` ersetzt eine erneute Zustellung, ohne Kennungen preiszugeben; auch sonst sieht das
/// Relais nur Token, Umgebung, Stufe und den Umschlag.
#[tokio::test]
async fn kollaps_verraet_keine_ids() {
    use sha2::{Digest, Sha256};
    let mut w = versand().await;
    let g = Geraet::neu(1);
    w.geraet(w.anna, &g, true, &[]).await;
    let m = w.meldung("Florian Nord 1", "Deich bricht").await;
    let mut gesehen = Vec::new();
    for _ in 0..2 {
        w.melden_an(Art::Sofortmeldung, Typ::Meldung, m, w.anna)
            .await;
        let n = w.nachrichten().await;
        let nachricht = nachricht_an(&n, &g).clone();
        let mut felder: Vec<&str> = nachricht
            .as_object()
            .unwrap()
            .keys()
            .map(String::as_str)
            .collect();
        felder.sort_unstable();
        assert_eq!(
            felder,
            ["kollaps", "nutzlast", "stufe", "token", "umgebung"]
        );
        let (_, k) = oeffnen(nachricht["nutzlast"].as_str().unwrap(), &g.schluessel);
        let b = k["b"].as_i64().unwrap();
        let kollaps = nachricht["kollaps"].as_str().unwrap().to_owned();
        let erwartet: String = Sha256::digest(format!("s1:{b}").as_bytes())
            .iter()
            .map(|x| format!("{x:02x}"))
            .collect();
        assert_eq!(kollaps, erwartet[..32]);
        // Der Umschlag trägt nur Kennung, Nonce und Chiffrat.
        let umschlag: Value = serde_json::from_slice(
            &lifeline_hub::web_push::krypto::b64_lesen(nachricht["nutzlast"].as_str().unwrap())
                .unwrap(),
        )
        .unwrap();
        let mut felder: Vec<&String> = umschlag.as_object().unwrap().keys().collect();
        felder.sort_unstable();
        assert_eq!(felder, ["c", "k", "n"]);
        let roh = nachricht.to_string();
        for geheim in ["Florian", "Deich", "Sofortmeldung", "einsatz"] {
            assert!(!roh.contains(geheim), "{geheim} im Klartext: {roh}");
        }
        gesehen.push(kollaps);
    }
    assert_ne!(gesehen[0], gesehen[1], "je Benachrichtigung ein eigener");
}

/// LLH-2077: die Störung einer Anbindung hat keinen Einsatz und erreicht trotzdem das Gerät des
/// Admins. Der Klartext trägt kein `e`; Titel, Detail und Pfad (zu den Anbindungen) sind dieselben
/// wie in `GET /api/notifications/{id}`.
#[tokio::test]
async fn stoerung_einer_anbindung_erreicht_den_admin_ohne_einsatz() {
    let mut w = versand().await;
    let (admin, org_id): (i64, i64) =
        sqlx::query_as("SELECT id, org_id FROM benutzer WHERE benutzername = 'admin'")
            .fetch_one(&w.pool)
            .await
            .unwrap();
    sqlx::query(
        "INSERT INTO adapter (id, org_id, art, name, intervall_s, einstellungen, \
             letzter_fehler_art, letzter_fehler_status) \
         VALUES ('a1', ?, 'test', 'Leitstelle Nord', 60, '{}', 'abgelehnt', 401)",
    )
    .bind(org_id)
    .execute(&w.pool)
    .await
    .unwrap();
    let g = Geraet::neu(3);
    w.geraet(admin, &g, false, &[]).await;

    let empfaenger = melden(
        &w.pool,
        &w.live,
        Anlass::adapter(
            org_id,
            "a1",
            Art::AdapterGestoert,
            Bezug::neu(Typ::Adapter, 7),
        ),
    )
    .await;
    assert!(empfaenger.contains(&admin), "{empfaenger:?}");

    let n = w.nachrichten().await;
    let (kennung, k) = oeffnen(
        nachricht_an(&n, &g)["nutzlast"].as_str().unwrap(),
        &g.schluessel,
    );
    assert_eq!(kennung, g.kennung);
    assert!(k.get("e").is_none(), "ohne Einsatz kein `e`: {k}");
    let b = k["b"].as_i64().unwrap();
    let cookie = w.cookie(admin).await;
    let (s, anzeige) = anfrage(
        &w.app,
        "GET",
        &format!("/api/notifications/{b}"),
        &cookie,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{anzeige}");
    assert_eq!(k["titel"], anzeige["titel"]);
    assert_eq!(k["detail"], anzeige["detail"]);
    assert!(
        k["detail"].as_str().unwrap().contains("Leitstelle Nord"),
        "{k}"
    );
    assert_eq!(k["pfad"], anzeige["pfad"]);
    assert!(
        k["pfad"]
            .as_str()
            .unwrap()
            .starts_with("/admin/einstellungen/anbindungen"),
        "{k}"
    );
}
