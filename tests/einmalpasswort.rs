//! LFH-1121, Spec `konto-einmalpasswort`: Die Administration vergibt ein Einmalpasswort, und wer
//! sich damit anmeldet, legt erst ein eigenes Passwort fest, bevor eine Sitzung entsteht.

use axum::body::{to_bytes, Body};
use axum::http::{header, HeaderMap, Request, StatusCode};
use serde_json::{json, Value};
use tower::ServiceExt;

mod common;
use common::{
    anfrage, anfrage_json, benutzer_anlegen, einsatz_anlegen, fremde_org_anlegen, login_cookie,
    setup_mit_pool, setup_mit_pool_und_live,
};

/// Antwort mit Status, JSON-Body, allen `Set-Cookie`-Paaren (`name=wert`) und Kopfzeilen.
struct Antwort {
    status: StatusCode,
    json: Value,
    cookies: Vec<String>,
    koepfe: HeaderMap,
}

impl Antwort {
    /// Das `name=wert`-Paar des Cookies `name`, falls gesetzt (und nicht gelöscht).
    fn cookie(&self, name: &str) -> Option<String> {
        self.cookies
            .iter()
            .find(|c| c.starts_with(&format!("{name}=")) && c.len() > name.len() + 1)
            .cloned()
    }
}

async fn senden(
    app: &axum::Router,
    methode: &str,
    uri: &str,
    cookie: &str,
    body: Option<Value>,
) -> Antwort {
    let mut req = Request::builder().method(methode).uri(uri);
    if !cookie.is_empty() {
        req = req.header(header::COOKIE, cookie);
    }
    let body = match body {
        Some(b) => {
            req = req.header(header::CONTENT_TYPE, "application/json");
            Body::from(b.to_string())
        }
        None => Body::empty(),
    };
    let resp = app.clone().oneshot(req.body(body).unwrap()).await.unwrap();
    let status = resp.status();
    let koepfe = resp.headers().clone();
    let cookies = koepfe
        .get_all(header::SET_COOKIE)
        .iter()
        .map(|c| c.to_str().unwrap().split(';').next().unwrap().to_string())
        .collect();
    let bytes = to_bytes(resp.into_body(), usize::MAX).await.unwrap();
    Antwort {
        status,
        json: serde_json::from_slice(&bytes).unwrap_or(Value::Null),
        cookies,
        koepfe,
    }
}

async fn login(app: &axum::Router, name: &str, passwort: &str) -> Antwort {
    senden(
        app,
        "POST",
        "/api/auth/login",
        "",
        Some(json!({"benutzername": name, "passwort": passwort})),
    )
    .await
}

async fn festlegen(app: &axum::Router, wechsel_cookie: &str, neu: &str) -> Antwort {
    senden(
        app,
        "POST",
        "/api/auth/passwort/festlegen",
        wechsel_cookie,
        Some(json!({"neues_passwort": neu})),
    )
    .await
}

async fn einmalpasswort(app: &axum::Router, admin: &str, id: i64) -> Antwort {
    senden(
        app,
        "POST",
        &format!("/api/benutzer/{id}/einmalpasswort"),
        admin,
        None,
    )
    .await
}

/// Admin-Cookie und das Konto `maxim` (Passwort `maximpw1`, ohne Zwang).
async fn ausgangslage() -> (axum::Router, sqlx::SqlitePool, String, i64) {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let max = benutzer_anlegen(&app, &admin, "maxim", "keine").await;
    (app, pool, admin, max)
}

/// Vergibt `maxim` ein Einmalpasswort und liefert es.
async fn einmalpasswort_fuer_max(app: &axum::Router, admin: &str, max: i64) -> String {
    let a = einmalpasswort(app, admin, max).await;
    assert_eq!(a.status, StatusCode::OK, "{}", a.json);
    a.json["einmalpasswort"].as_str().unwrap().to_string()
}

/// Meldet `maxim` mit dem Einmalpasswort an und liefert das Wechsel-Cookie.
async fn zwischenschritt(app: &axum::Router, passwort: &str) -> String {
    let a = login(app, "maxim", passwort).await;
    assert_eq!(a.status, StatusCode::OK, "{}", a.json);
    assert_eq!(a.json, json!({"passwort_wechsel_erforderlich": true}));
    a.cookie("passwort_wechsel")
        .expect("der Zwischenschritt setzt das Wechsel-Cookie")
}

async fn admin_spur(
    pool: &sqlx::SqlitePool,
    aktion: &str,
) -> Vec<(Option<i64>, String, Option<String>)> {
    sqlx::query_as(
        "SELECT ziel_benutzer_id, ziel, detail FROM admin_audit WHERE aktion = ? ORDER BY id",
    )
    .bind(aktion)
    .fetch_all(pool)
    .await
    .unwrap()
}

async fn anmelde_spur(pool: &sqlx::SqlitePool, benutzer_id: i64) -> Vec<(String, String)> {
    sqlx::query_as("SELECT ereignis, provider FROM auth_audit WHERE benutzer_id = ? ORDER BY id")
        .bind(benutzer_id)
        .fetch_all(pool)
        .await
        .unwrap()
}

// ===== Einmalpasswort vergeben =====

#[tokio::test]
async fn admin_vergibt_einmalpasswort_alte_anmeldungen_und_passwort_enden() {
    let (app, pool, admin, max) = ausgangslage().await;
    let sitzung_a = login_cookie(&app, "maxim", "maximpw1").await;
    let sitzung_b = login_cookie(&app, "maxim", "maximpw1").await;

    let a = einmalpasswort(&app, &admin, max).await;

    assert_eq!(a.status, StatusCode::OK, "{}", a.json);
    assert_eq!(
        a.koepfe
            .get(header::CACHE_CONTROL)
            .map(|v| v.to_str().unwrap()),
        Some("no-store")
    );
    let pw = a.json["einmalpasswort"].as_str().unwrap();
    let gruppen: Vec<&str> = pw.split('-').collect();
    assert_eq!(gruppen.len(), 3, "{pw}");
    assert!(gruppen.iter().all(|g| g.len() == 4), "{pw}");
    assert_eq!(a.json.as_object().unwrap().len(), 1, "nur das Passwort");

    for sitzung in [&sitzung_a, &sitzung_b] {
        let (s, _) = anfrage(&app, "GET", "/api/auth/me", sitzung, None).await;
        assert_eq!(
            s,
            StatusCode::UNAUTHORIZED,
            "alle Sitzungen der Person enden"
        );
    }
    assert_eq!(
        login(&app, "maxim", "maximpw1").await.status,
        StatusCode::UNAUTHORIZED
    );
    let pflicht: i64 =
        sqlx::query_scalar("SELECT passwort_wechsel_pflicht FROM benutzer WHERE id = ?")
            .bind(max)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(pflicht, 1);

    assert_eq!(
        admin_spur(&pool, "einmalpasswort_vergeben").await,
        vec![(Some(max), "maxim".to_string(), None)],
        "genau ein Eintrag, ohne Detail"
    );
    let spur_text: String = sqlx::query_scalar(
        "SELECT group_concat(coalesce(detail, '') || ziel || coalesce(akteur_name, ''), '|') FROM admin_audit",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert!(
        !spur_text.contains(pw),
        "das Passwort steht nie in der Spur"
    );
}

#[tokio::test]
async fn offene_live_stroeme_der_person_enden() {
    let (app, pool, live) = setup_mit_pool_und_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let max = benutzer_anlegen(&app, &admin, "maxim", "keine").await;
    login_cookie(&app, "maxim", "maximpw1").await;
    login_cookie(&app, "maxim", "maximpw1").await;
    let mut kennungen: Vec<String> =
        sqlx::query_scalar("SELECT kennung FROM session WHERE benutzer_id = ? ORDER BY kennung")
            .bind(max)
            .fetch_all(&pool)
            .await
            .unwrap();
    let mut ende = live.abonniere_sitzung_ende();

    einmalpasswort_fuer_max(&app, &admin, max).await;

    let mut gemeldet = Vec::new();
    while let Ok(k) = ende.try_recv() {
        gemeldet.push(k);
    }
    gemeldet.sort();
    kennungen.sort();
    assert_eq!(gemeldet, kennungen, "jede beendete Sitzung wird gemeldet");
}

#[tokio::test]
async fn zwei_einmalpasswoerter_unterscheiden_sich_und_nur_das_zweite_gilt() {
    let (app, _pool, admin, max) = ausgangslage().await;
    let erstes = einmalpasswort_fuer_max(&app, &admin, max).await;
    let zweites = einmalpasswort_fuer_max(&app, &admin, max).await;

    assert_ne!(erstes, zweites);
    assert_eq!(
        login(&app, "maxim", &erstes).await.status,
        StatusCode::UNAUTHORIZED
    );
    zwischenschritt(&app, &zweites).await;
}

#[tokio::test]
async fn ohne_admin_rolle_403_und_passwort_bleibt() {
    let (app, pool, admin, max) = ausgangslage().await;
    let moritz = benutzer_anlegen(&app, &admin, "moritz", "keine").await;
    let max_cookie = login_cookie(&app, "maxim", "maximpw1").await;

    let a = einmalpasswort(&app, &max_cookie, moritz).await;

    assert_eq!(a.status, StatusCode::FORBIDDEN);
    assert_eq!(
        login(&app, "moritz", "moritzpw1").await.status,
        StatusCode::OK
    );
    assert!(admin_spur(&pool, "einmalpasswort_vergeben")
        .await
        .is_empty());
    let _ = max;
}

#[tokio::test]
async fn konto_einer_fremden_organisation_ist_404() {
    let (app, pool, admin, _max) = ausgangslage().await;
    let (_org, fremd) =
        fremde_org_anlegen(&pool, "Fremd-Orga", "fremd", "fremdpw12", "keine").await;

    let a = einmalpasswort(&app, &admin, fremd).await;

    assert_eq!(a.status, StatusCode::NOT_FOUND);
    assert_eq!(
        login(&app, "fremd", "fremdpw12").await.status,
        StatusCode::OK
    );
    assert!(admin_spur(&pool, "einmalpasswort_vergeben")
        .await
        .is_empty());
}

#[tokio::test]
async fn unbekanntes_konto_ist_404() {
    let (app, _pool, admin, _max) = ausgangslage().await;
    assert_eq!(
        einmalpasswort(&app, &admin, 999_999).await.status,
        StatusCode::NOT_FOUND
    );
}

#[tokio::test]
async fn geraetekonto_ist_404() {
    let (app, pool, admin, _max) = ausgangslage().await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let (s, v) = anfrage_json(
        &app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/geraete"),
        &admin,
        Some(&json!({"ansicht": "lagemonitor", "bezeichnung": "Monitor"})),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
    let konto: i64 = sqlx::query_scalar("SELECT benutzer_id FROM geraet_kopplung WHERE id = ?")
        .bind(v["kopplung"]["id"].as_i64().unwrap())
        .fetch_one(&pool)
        .await
        .unwrap();

    assert_eq!(
        einmalpasswort(&app, &admin, konto).await.status,
        StatusCode::NOT_FOUND
    );
}

#[tokio::test]
async fn eigenes_konto_ist_422_und_die_sitzung_bleibt() {
    let (app, pool, admin, _max) = ausgangslage().await;
    let admin_id: i64 = sqlx::query_scalar("SELECT id FROM benutzer WHERE benutzername = 'admin'")
        .fetch_one(&pool)
        .await
        .unwrap();

    let a = einmalpasswort(&app, &admin, admin_id).await;

    assert_eq!(a.status, StatusCode::UNPROCESSABLE_ENTITY, "{}", a.json);
    let (s, _) = anfrage(&app, "GET", "/api/auth/me", &admin, None).await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(
        login(&app, "admin", "startpw12").await.status,
        StatusCode::OK
    );
    assert!(admin_spur(&pool, "einmalpasswort_vergeben")
        .await
        .is_empty());
}

#[tokio::test]
async fn sso_only_konto_ist_422_ohne_spur() {
    let (app, pool, admin, max) = ausgangslage().await;
    sqlx::query("UPDATE benutzer SET passwort_hash = ? WHERE id = ?")
        .bind(lifeline_hub::auth::PASSWORT_HASH_SSO_ONLY)
        .bind(max)
        .execute(&pool)
        .await
        .unwrap();

    let a = einmalpasswort(&app, &admin, max).await;

    assert_eq!(a.status, StatusCode::UNPROCESSABLE_ENTITY, "{}", a.json);
    let hash: String = sqlx::query_scalar("SELECT passwort_hash FROM benutzer WHERE id = ?")
        .bind(max)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(hash, lifeline_hub::auth::PASSWORT_HASH_SSO_ONLY);
    assert!(admin_spur(&pool, "einmalpasswort_vergeben")
        .await
        .is_empty());
}

#[tokio::test]
async fn abgeschalteter_passwort_provider_ist_403() {
    let (app, pool, admin, max) = ausgangslage().await;
    sqlx::query(
        "INSERT INTO auth_provider (id, aktiviert) VALUES ('passwort', 0) \
         ON CONFLICT(id) DO UPDATE SET aktiviert = 0",
    )
    .execute(&pool)
    .await
    .unwrap();

    assert_eq!(
        einmalpasswort(&app, &admin, max).await.status,
        StatusCode::FORBIDDEN
    );
    assert!(admin_spur(&pool, "einmalpasswort_vergeben")
        .await
        .is_empty());
}

// ===== Änderungszwang beim Passwort-Login =====

#[tokio::test]
async fn login_mit_einmalpasswort_liefert_keine_sitzung() {
    let (app, pool, admin, max) = ausgangslage().await;
    let pw = einmalpasswort_fuer_max(&app, &admin, max).await;
    let spur_vorher = anmelde_spur(&pool, max).await;

    let a = login(&app, "maxim", &pw).await;

    assert_eq!(a.status, StatusCode::OK);
    assert_eq!(a.json, json!({"passwort_wechsel_erforderlich": true}));
    assert_eq!(
        a.cookie("lifeline_sid"),
        None,
        "keine Sitzung vor dem Festlegen"
    );
    assert_eq!(
        a.cookies.len(),
        1,
        "nur das Wechsel-Cookie: {:?}",
        a.cookies
    );
    let wechsel = a.cookie("passwort_wechsel").unwrap();
    let (s, _) = anfrage(&app, "GET", "/api/auth/me", &wechsel, None).await;
    assert_eq!(s, StatusCode::UNAUTHORIZED);
    assert_eq!(
        anmelde_spur(&pool, max).await,
        spur_vorher,
        "der Zwischenschritt schreibt kein login_ok"
    );
}

#[tokio::test]
async fn falsches_passwort_bei_offenem_zwang_ist_401_ohne_hinweis() {
    let (app, _pool, admin, max) = ausgangslage().await;
    einmalpasswort_fuer_max(&app, &admin, max).await;

    let a = login(&app, "maxim", "falsch-falsch").await;

    assert_eq!(a.status, StatusCode::UNAUTHORIZED);
    assert!(a.cookies.is_empty());
    assert!(!a.json.to_string().contains("wechsel"));
}

#[tokio::test]
async fn festlegen_oeffnet_die_sitzung_und_das_neue_passwort_gilt() {
    let (app, pool, admin, max) = ausgangslage().await;
    let pw = einmalpasswort_fuer_max(&app, &admin, max).await;
    let wechsel = zwischenschritt(&app, &pw).await;

    let a = festlegen(&app, &wechsel, "neues-passwort-1").await;

    assert_eq!(a.status, StatusCode::OK, "{}", a.json);
    assert_eq!(a.json["benutzername"], "maxim");
    assert_eq!(a.json["passwort_gesetzt"], true);
    let sitzung = a.cookie("lifeline_sid").expect("Sitzungs-Cookie");
    let (s, me) = anfrage(&app, "GET", "/api/auth/me", &sitzung, None).await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(me["benutzername"], "maxim");
    assert!(
        a.cookies.iter().any(|c| c == "passwort_wechsel="),
        "das Wechsel-Cookie wird gelöscht: {:?}",
        a.cookies
    );

    assert_eq!(
        login(&app, "maxim", &pw).await.status,
        StatusCode::UNAUTHORIZED
    );
    let neu = login(&app, "maxim", "neues-passwort-1").await;
    assert_eq!(neu.status, StatusCode::OK);
    assert_eq!(neu.json["benutzername"], "maxim", "direkt angemeldet");
    assert!(neu.cookie("lifeline_sid").is_some());

    // Ein zweites Festlegen mit demselben Cookie läuft ins Leere.
    assert_eq!(
        festlegen(&app, &wechsel, "noch-ein-passwort").await.status,
        StatusCode::UNAUTHORIZED
    );

    let spur = anmelde_spur(&pool, max).await;
    let ab_festlegen: Vec<_> = spur
        .iter()
        .rev()
        .take(3)
        .rev()
        .map(|(e, p)| (e.as_str(), p.as_str()))
        .collect();
    assert_eq!(
        ab_festlegen,
        vec![
            ("passwort_geaendert", "passwort"),
            ("login_ok", "passwort"),
            ("login_ok", "passwort"),
        ],
        "Festlegen schreibt passwort_geaendert und login_ok, dann der Login mit dem neuen"
    );
}

#[tokio::test]
async fn dasselbe_passwort_ist_422_und_ein_zweiter_versuch_gelingt() {
    let (app, _pool, admin, max) = ausgangslage().await;
    let pw = einmalpasswort_fuer_max(&app, &admin, max).await;
    let wechsel = zwischenschritt(&app, &pw).await;

    let a = festlegen(&app, &wechsel, &pw).await;

    assert_eq!(a.status, StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(
        a.json["error"],
        "Das neue Passwort muss sich vom bisherigen unterscheiden."
    );
    assert!(a.cookie("lifeline_sid").is_none());
    let b = festlegen(&app, &wechsel, "anderes-passwort").await;
    assert_eq!(b.status, StatusCode::OK, "{}", b.json);
}

#[tokio::test]
async fn zu_kurzes_passwort_ist_400_und_ein_zweiter_versuch_gelingt() {
    let (app, _pool, admin, max) = ausgangslage().await;
    let pw = einmalpasswort_fuer_max(&app, &admin, max).await;
    let wechsel = zwischenschritt(&app, &pw).await;

    assert_eq!(
        festlegen(&app, &wechsel, "kurz123").await.status,
        StatusCode::BAD_REQUEST
    );
    assert_eq!(
        festlegen(&app, &wechsel, &"x".repeat(129)).await.status,
        StatusCode::BAD_REQUEST
    );
    assert_eq!(
        festlegen(&app, &wechsel, "lang-genug").await.status,
        StatusCode::OK
    );
}

#[tokio::test]
async fn festlegen_ohne_zwischenschritt_ist_401() {
    let (app, pool, _admin, max) = ausgangslage().await;
    assert_eq!(
        festlegen(&app, "", "neues-passwort-1").await.status,
        StatusCode::UNAUTHORIZED
    );
    assert_eq!(
        festlegen(&app, "passwort_wechsel=unbekannt", "neues-passwort-1")
            .await
            .status,
        StatusCode::UNAUTHORIZED
    );
    assert_eq!(
        login(&app, "maxim", "maximpw1").await.status,
        StatusCode::OK
    );
    let _ = (pool, max);
}

#[tokio::test]
async fn neues_einmalpasswort_waehrend_des_zwischenschritts_macht_ihn_ungueltig() {
    let (app, _pool, admin, max) = ausgangslage().await;
    let erstes = einmalpasswort_fuer_max(&app, &admin, max).await;
    let wechsel = zwischenschritt(&app, &erstes).await;
    let zweites = einmalpasswort_fuer_max(&app, &admin, max).await;

    assert_eq!(
        festlegen(&app, &wechsel, "neues-passwort-1").await.status,
        StatusCode::UNAUTHORIZED
    );
    assert_eq!(
        login(&app, "maxim", "neues-passwort-1").await.status,
        StatusCode::UNAUTHORIZED
    );
    let wechsel2 = zwischenschritt(&app, &zweites).await;
    assert_eq!(
        festlegen(&app, &wechsel2, "neues-passwort-2").await.status,
        StatusCode::OK
    );
}

/// Richtet für `maxim` TOTP ein und liefert die Recovery-Codes. Recovery-Codes statt eines zweiten
/// TOTP-Codes: der Zeitschritt des Enrollments ist verbraucht.
async fn totp_einrichten(app: &axum::Router) -> Vec<String> {
    let max_cookie = login_cookie(app, "maxim", "maximpw1").await;
    let (s, start) = anfrage_json(
        app,
        "POST",
        "/api/auth/totp/enroll/start",
        &max_cookie,
        Some(&json!({"passwort": "maximpw1"})),
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    let jetzt = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs();
    let code =
        lifeline_hub::auth::totp::generiere_code(start["secret_base32"].as_str().unwrap(), jetzt)
            .unwrap();
    let (s, fertig) = anfrage_json(
        app,
        "POST",
        "/api/auth/totp/enroll/finish",
        &max_cookie,
        Some(&json!({"code": code})),
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    fertig["recovery_codes"]
        .as_array()
        .unwrap()
        .iter()
        .map(|c| c.as_str().unwrap().to_string())
        .collect()
}

#[tokio::test]
async fn mit_totp_gilt_ein_ersetztes_einmalpasswort_auch_nach_dem_code_nicht() {
    let (app, _pool, admin, max) = ausgangslage().await;
    let recovery = totp_einrichten(&app).await;
    let erstes = einmalpasswort_fuer_max(&app, &admin, max).await;

    let a = login(&app, "maxim", &erstes).await;
    assert_eq!(a.json, json!({"mfa_erforderlich": "totp"}));
    let mfa = a.cookie("mfa_pending").unwrap();
    // Die Administration ersetzt das erste Einmalpasswort, bevor der Code kommt.
    let zweites = einmalpasswort_fuer_max(&app, &admin, max).await;

    let b = senden(
        &app,
        "POST",
        "/api/auth/totp/finish",
        &mfa,
        Some(json!({"code": recovery[0]})),
    )
    .await;
    assert_eq!(b.status, StatusCode::UNAUTHORIZED, "{}", b.json);
    assert!(b.cookie("passwort_wechsel").is_none());
    assert!(b.cookie("lifeline_sid").is_none());

    // Mit dem aktuellen Einmalpasswort geht es weiter.
    let c = login(&app, "maxim", &zweites).await;
    let mfa = c.cookie("mfa_pending").unwrap();
    let d = senden(
        &app,
        "POST",
        "/api/auth/totp/finish",
        &mfa,
        Some(json!({"code": recovery[1]})),
    )
    .await;
    assert_eq!(d.json, json!({"passwort_wechsel_erforderlich": true}));
}

#[tokio::test]
async fn mit_totp_erst_der_code_dann_der_wechsel() {
    let (app, pool, admin, max) = ausgangslage().await;
    let recovery = totp_einrichten(&app).await.remove(0);
    let pw = einmalpasswort_fuer_max(&app, &admin, max).await;

    let a = login(&app, "maxim", &pw).await;
    assert_eq!(a.json, json!({"mfa_erforderlich": "totp"}));
    let mfa = a.cookie("mfa_pending").unwrap();

    let b = senden(
        &app,
        "POST",
        "/api/auth/totp/finish",
        &mfa,
        Some(json!({"code": recovery})),
    )
    .await;
    assert_eq!(b.status, StatusCode::OK, "{}", b.json);
    assert_eq!(b.json, json!({"passwort_wechsel_erforderlich": true}));
    assert!(
        b.cookie("lifeline_sid").is_none(),
        "keine Sitzung vor dem Festlegen"
    );
    let wechsel = b
        .cookie("passwort_wechsel")
        .expect("Wechsel-Cookie nach dem zweiten Faktor");

    let c = festlegen(&app, &wechsel, "neues-passwort-1").await;
    assert_eq!(c.status, StatusCode::OK, "{}", c.json);
    assert_eq!(c.json["totp_aktiviert"], true);
    assert!(c.cookie("lifeline_sid").is_some());

    let spur = anmelde_spur(&pool, max).await;
    let letzte: Vec<_> = spur
        .iter()
        .rev()
        .take(2)
        .rev()
        .map(|(e, p)| (e.as_str(), p.as_str()))
        .collect();
    assert_eq!(
        letzte,
        vec![("login_ok", "totp"), ("passwort_geaendert", "passwort")],
        "der TOTP-Erfolg schreibt login_ok, das Festlegen nur noch passwort_geaendert"
    );
}

#[tokio::test]
async fn wechsel_im_profil_hebt_den_zwang_auf() {
    let (app, pool, _admin, max) = ausgangslage().await;
    let sitzung = login_cookie(&app, "maxim", "maximpw1").await;
    // Zwang wie nach einem Einmalpasswort, aber mit laufender Sitzung (etwa per Passkey).
    sqlx::query("UPDATE benutzer SET passwort_wechsel_pflicht = 1 WHERE id = ?")
        .bind(max)
        .execute(&pool)
        .await
        .unwrap();
    let (s, _) = anfrage(&app, "GET", "/api/auth/me", &sitzung, None).await;
    assert_eq!(
        s,
        StatusCode::OK,
        "eine bestehende Sitzung bleibt vom Zwang unberührt"
    );

    let (s, _) = anfrage_json(
        &app,
        "POST",
        "/api/auth/passwort",
        &sitzung,
        Some(&json!({"altes_passwort": "maximpw1", "neues_passwort": "selbst-gewaehlt"})),
    )
    .await;
    assert_eq!(s, StatusCode::NO_CONTENT);

    let a = login(&app, "maxim", "selbst-gewaehlt").await;
    assert_eq!(
        a.json["benutzername"], "maxim",
        "direkt angemeldet: {}",
        a.json
    );
}

// ===== Anlage =====

#[tokio::test]
async fn neu_angelegtes_konto_steht_unter_zwang_der_erste_admin_nicht() {
    let (app, _pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let (s, _) = anfrage_json(
        &app,
        "POST",
        "/api/benutzer",
        &admin,
        Some(
            &json!({"anzeigename": "Erika", "benutzername": "erika", "passwort": "startpasswort"}),
        ),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED);

    let a = login(&app, "erika", "startpasswort").await;
    assert_eq!(a.json, json!({"passwort_wechsel_erforderlich": true}));
    assert!(a.cookie("lifeline_sid").is_none());

    let b = login(&app, "admin", "startpw12").await;
    assert_eq!(b.json["benutzername"], "admin");
    assert!(b.cookie("lifeline_sid").is_some());
}
