//! Direktkopplung vor Ort (LLH-1497, Change `t10a7luh-elw-lan-direktkopplung`, Specs
//! `instanz-kopplung`, `instanz-fuehrung`, `stammdaten-verteilung`, `einsatz-spiegel`,
//! `spiegel-antraege`): zwei ELW im selben Netz, einer mit selbstsigniertem Zertifikat. Je
//! Instanz eigene DB und eigener Server auf Loopback (`tests/instanz_hilfen`).

mod common;
mod instanz_hilfen;

use axum::http::StatusCode;
use instanz_hilfen::*;
use serde_json::{json, Value};
use std::sync::{Arc, Mutex};

async fn kopplungen(i: &Instanz) -> Vec<Value> {
    let (s, v) = common::anfrage(&i.app, "GET", "/api/admin/instanz", &i.admin, None).await;
    assert_eq!(s, StatusCode::OK, "{v}");
    v["kopplungen"].as_array().cloned().unwrap_or_default()
}

async fn aktionen(i: &Instanz) -> Vec<String> {
    sqlx::query_scalar("SELECT aktion FROM admin_audit ORDER BY id")
        .fetch_all(&i.pool)
        .await
        .unwrap()
}

/// Ein Vermittler mit eigenem selbstsigniertem Zertifikat, der jede Anfrage unverändert an
/// `ziel` weiterreicht (Angreifer in der Mitte, der die TLS-Verbindung aufbricht). Liefert seine
/// Adresse und die Pfade, die er gesehen hat.
async fn vermittler(ziel: &str) -> (String, Arc<Mutex<Vec<String>>>) {
    let pfade = Arc::new(Mutex::new(Vec::new()));
    let (cert, key) =
        lifeline_hub::tls::rcgen_pem(&["localhost".into(), "127.0.0.1".into()]).unwrap();
    let config =
        axum_server::tls_rustls::RustlsConfig::from_pem(cert.into_bytes(), key.into_bytes())
            .await
            .unwrap();
    let client = lifeline_hub::instanz::zertifikat::build_client(None).unwrap();
    let ziel = ziel.to_string();
    let gesehen = pfade.clone();
    let app = axum::Router::new().fallback(move |req: axum::extract::Request| {
        let client = client.clone();
        let ziel = ziel.clone();
        let gesehen = gesehen.clone();
        async move {
            let (teile, body) = req.into_parts();
            gesehen.lock().unwrap().push(teile.uri.path().to_string());
            let body = axum::body::to_bytes(body, 8 << 20).await.unwrap();
            let mut weiter = client.request(teile.method.clone(), format!("{ziel}{}", teile.uri));
            for (k, v) in &teile.headers {
                if k != axum::http::header::HOST {
                    weiter = weiter.header(k, v);
                }
            }
            let resp = weiter.body(body).send().await.unwrap();
            let mut aus = axum::http::Response::builder().status(resp.status().as_u16());
            for (k, v) in resp.headers() {
                aus = aus.header(k, v);
            }
            aus.body(axum::body::Body::from(resp.bytes().await.unwrap()))
                .unwrap()
        }
    });
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    listener.set_nonblocking(true).unwrap();
    let adresse = format!("https://{}", listener.local_addr().unwrap());
    tokio::spawn(async move {
        axum_server::from_tcp_rustls(listener, config)
            .unwrap()
            .serve(app.into_make_service())
            .await
            .unwrap();
    });
    (adresse, pfade)
}

// ── Art der Kopplung (D1) ────────────────────────────────────────────────────────────────────

#[tokio::test]
async fn zwei_elw_koppeln_vor_ort_mit_selbstsigniertem_zertifikat() {
    let (elw1, elw2) = vor_ort().await;
    let k2 = kopplungen(&elw2).await;
    assert_eq!(k2.len(), 1);
    assert_eq!(k2[0]["art"], "vor_ort");
    assert_eq!(k2[0]["richtung"], "meldet_sich");
    assert_eq!(k2[0]["zertifikat"], "bestaetigt");
    assert_eq!(k2[0]["zustand"], "aktiv");
    // Die erste Meldung lief gleich beim Einlösen: ELW 1 kennt die Kopplung aktiv und bestätigt.
    let k1 = kopplungen(&elw1).await;
    assert_eq!(k1[0]["art"], "vor_ort");
    assert_eq!(k1[0]["zustand"], "aktiv");
    assert_eq!(k1[0]["zertifikat"], "bestaetigt");
    let pin: String = eine(&elw2.pool, "SELECT tls_zertifikat FROM instanz_kopplung").await;
    let eigen: String = eine(&elw1.pool, "SELECT tls_zertifikat FROM instanz_identitaet").await;
    assert_eq!(pin, eigen);
    let art: String = eine(&elw1.pool, "SELECT art FROM instanz_kopplungscode").await;
    assert_eq!(art, "vor_ort");
    // Die Spur nennt die Art an beiden Seiten.
    let ziel = |i: &Instanz, aktion: &'static str| {
        let pool = i.pool.clone();
        async move {
            eine::<String>(
                &pool,
                &format!("SELECT ziel FROM admin_audit WHERE aktion = '{aktion}'"),
            )
            .await
        }
    };
    assert_eq!(
        ziel(&elw1, "instanz_code_ausgestellt").await,
        "Kopplungscode (vor Ort)"
    );
    assert!(ziel(&elw1, "instanz_code_eingeloest")
        .await
        .ends_with("(vor Ort)"));
    assert!(ziel(&elw2, "instanz_gekoppelt")
        .await
        .ends_with("(vor Ort)"));
}

#[tokio::test]
async fn ein_elw_ist_beim_hub_standard_und_vor_ort_gekoppelt() {
    let hub = instanz().await;
    let (elw1, elw2) = vor_ort().await;
    schluessel(&hub).await;
    koppeln(&hub, &elw2).await;
    let mut arten: Vec<(String, String)> = kopplungen(&elw2)
        .await
        .iter()
        .map(|k| {
            (
                k["gegenueber_kennung"].as_str().unwrap().to_string(),
                k["art"].as_str().unwrap().to_string(),
            )
        })
        .collect();
    arten.sort();
    let kennung = |i: &Instanz| {
        let pool = i.pool.clone();
        async move { eine::<String>(&pool, "SELECT kennung FROM instanz_identitaet").await }
    };
    let mut erwartet = vec![
        (kennung(&hub).await, "standard".to_string()),
        (kennung(&elw1).await, "vor_ort".to_string()),
    ];
    erwartet.sort();
    assert_eq!(arten, erwartet);
    let k = kopplungen(&elw2).await;
    let standard = k.iter().find(|k| k["art"] == "standard").unwrap();
    assert!(standard.get("zertifikat").is_none(), "{standard}");
    let pin: Option<String> = eine(
        &elw2.pool,
        "SELECT tls_zertifikat FROM instanz_kopplung WHERE art = 'standard'",
    )
    .await;
    assert_eq!(pin, None, "Standardkopplungen pinnen nichts");
}

#[tokio::test]
async fn ein_code_anderer_art_scheitert_mit_409_und_aendert_nichts() {
    // Eine Standardkopplung über Loopback; die ausstellende Seite gibt sich danach TLS, damit sie
    // einen Code „vor Ort“ ausstellen darf.
    let (hub, elw) = gekoppelt().await;
    lifeline_hub::instanz::identitaet::save_tls_zertifikat(&hub.pool, Some("ab"))
        .await
        .unwrap();
    let code = code_vor_ort(&hub).await;
    let (s, v) = einloesen(&elw, &hub, &code).await;
    assert_eq!(s, StatusCode::CONFLICT, "{v}");
    assert!(
        v["error"]
            .as_str()
            .unwrap()
            .contains("schon eine Standardkopplung"),
        "{v}"
    );
    let art: String = eine(&elw.pool, "SELECT art FROM instanz_kopplung").await;
    assert_eq!(art, "standard");
    let offen: i64 = eine(
        &hub.pool,
        "SELECT COUNT(*) FROM instanz_kopplungscode WHERE art = 'vor_ort' AND eingeloest_at IS NULL",
    )
    .await;
    assert_eq!(offen, 1, "der Code bleibt einlösbar");
}

#[tokio::test]
async fn ein_standardcode_ueber_selbstsigniertes_zertifikat_scheitert_ohne_verbrauch() {
    let elw1 = instanz_tls().await;
    let elw2 = instanz().await;
    schluessel(&elw1).await;
    let (s, v) = common::anfrage(
        &elw1.app,
        "POST",
        "/api/admin/instanz/codes",
        &elw1.admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
    assert_eq!(v["art"], "standard");
    let (s, v) = einloesen(&elw2, &elw1, v["code"].as_str().unwrap()).await;
    assert_eq!(s, StatusCode::CONFLICT, "{v}");
    assert!(v["error"].as_str().unwrap().contains("vor Ort"), "{v}");
    let offen: i64 = eine(
        &elw1.pool,
        "SELECT COUNT(*) FROM instanz_kopplungscode WHERE eingeloest_at IS NULL",
    )
    .await;
    assert_eq!(offen, 1);
    assert!(kopplungen(&elw2).await.is_empty());
}

#[tokio::test]
async fn ausstellen_vor_ort_ohne_eigenes_tls_endet_mit_409() {
    let i = instanz().await;
    schluessel(&i).await;
    let (s, v) = common::anfrage_json(
        &i.app,
        "POST",
        "/api/admin/instanz/codes",
        &i.admin,
        Some(&json!({"art": "vor_ort"})),
    )
    .await;
    assert_eq!(s, StatusCode::CONFLICT, "{v}");
    assert!(v["error"].as_str().unwrap().contains("--tls"), "{v}");
}

#[tokio::test]
async fn eine_einloesende_seite_mit_protokoll_2_bekommt_426_und_der_code_bleibt() {
    use lifeline_hub::instanz::code as kcode;
    use lifeline_hub::instanz::identitaet::Identitaet;
    let elw1 = instanz_tls().await;
    schluessel(&elw1).await;
    let code = kcode::normalize(&code_vor_ort(&elw1).await).unwrap();
    let a = kcode::derive(&code);
    let ich = Identitaet::create();
    let (kennung, schluessel, jti) = (
        ich.kennung.clone(),
        ich.oeffentlich_b64(),
        "jti-alt".to_string(),
    );
    let org = ("alt/1".to_string(), "Alt".to_string());
    let t =
        kcode::transkript_einloeser(&a.suche, &kennung, &schluessel, &org.0, &org.1, "Alt", &jti);
    let anfrage = json!({
        "suche": a.suche, "jti": jti, "protokoll": 2, "kennung": kennung,
        "schluessel": schluessel, "name": "Alt", "softwarestand": "0.1",
        "org": {"kennung": org.0, "name": org.1},
        "pruefwert": kcode::pruefwert(&a.k_einloeser, &t),
    });
    let antwort = lifeline_hub::instanz::zertifikat::build_client(None)
        .unwrap()
        .post(format!("{}/api/instanz/koppeln", elw1.adresse))
        .json(&anfrage)
        .send()
        .await
        .unwrap();
    assert_eq!(antwort.status().as_u16(), 426);
    let offen: i64 = eine(
        &elw1.pool,
        "SELECT COUNT(*) FROM instanz_kopplungscode WHERE eingeloest_at IS NULL",
    )
    .await;
    assert_eq!(offen, 1, "nicht verbraucht");
    let n: i64 = eine(&elw1.pool, "SELECT COUNT(*) FROM instanz_kopplung").await;
    assert_eq!(n, 0, "keine angebahnte Kopplung");
    // Derselbe Code geht danach an eine aktuelle Instanz.
    let elw2 = instanz().await;
    let (s, v) = einloesen(&elw2, &elw1, &code).await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
}

// ── Beglaubigtes Zertifikat (D3) ─────────────────────────────────────────────────────────────

#[tokio::test]
async fn ein_angreifer_mit_eigenem_zertifikat_scheitert_beim_koppeln() {
    let elw1 = instanz_tls().await;
    let elw2 = instanz().await;
    schluessel(&elw1).await;
    let code = code_vor_ort(&elw1).await;
    let (adresse, pfade) = vermittler(&elw1.adresse).await;
    let (s, v) = common::anfrage_json(
        &elw2.app,
        "POST",
        "/api/admin/instanz/einloesen",
        &elw2.admin,
        Some(&json!({"adresse": adresse, "code": code})),
    )
    .await;
    assert_eq!(s, StatusCode::BAD_GATEWAY, "{v}");
    assert!(
        v["error"]
            .as_str()
            .unwrap()
            .contains("Zertifikat passt nicht"),
        "{v}"
    );
    assert!(pfade
        .lock()
        .unwrap()
        .contains(&"/api/instanz/koppeln".to_string()));
    assert!(kopplungen(&elw2).await.is_empty(), "ELW 2 speichert nichts");
    let zustand: String = eine(&elw1.pool, "SELECT zustand FROM instanz_kopplung").await;
    assert_eq!(zustand, "angebahnt", "verfällt nach 15 Minuten");
}

#[tokio::test]
async fn ein_neues_zertifikat_wird_signiert_bestaetigt_und_die_meldung_laeuft_weiter() {
    let (elw1, elw2) = vor_ort().await;
    let neu = zertifikat_neu(&elw1).await;
    assert_eq!(
        kopplungen(&elw1).await[0]["zertifikat"],
        "gegenstelle_kennt_aelteres"
    );
    melden(&elw2).await;
    let k2 = &kopplungen(&elw2).await[0];
    assert_eq!(k2["zertifikat"], "bestaetigt", "{k2}");
    assert!(k2.get("letzter_fehler").is_none(), "{k2}");
    let pin: String = eine(&elw2.pool, "SELECT tls_zertifikat FROM instanz_kopplung").await;
    assert_eq!(pin, neu);
    assert!(aktionen(&elw2)
        .await
        .contains(&"instanz_zertifikat_gewechselt".to_string()));
    // Die Meldung, die den Wechsel auslöste, nannte noch den alten Pin; die nächste den neuen.
    melden(&elw2).await;
    assert_eq!(kopplungen(&elw1).await[0]["zertifikat"], "bestaetigt");
}

#[tokio::test]
async fn unter_fremdem_zertifikat_geht_nur_die_leere_rueckfrage_hinaus() {
    let (elw1, elw2) = vor_ort().await;
    let (adresse, pfade) = vermittler(&elw1.adresse).await;
    exec(
        &elw2.pool,
        &format!("UPDATE instanz_kopplung SET gegenueber_adresse = '{adresse}'"),
    )
    .await;
    let vorher: Option<String> = eine(
        &elw1.pool,
        "SELECT zuletzt_gesehen_at FROM instanz_kopplung",
    )
    .await;
    melden(&elw2).await;
    let k2 = &kopplungen(&elw2).await[0];
    assert_eq!(k2["zertifikat"], "passt_nicht", "{k2}");
    assert_eq!(k2["letzter_fehler"], "Zertifikat passt nicht");
    assert_eq!(
        *pfade.lock().unwrap(),
        vec!["/api/instanz/zertifikat".to_string()],
        "keine Meldung, kein Abgleich"
    );
    let nachher: Option<String> = eine(
        &elw1.pool,
        "SELECT zuletzt_gesehen_at FROM instanz_kopplung",
    )
    .await;
    assert_eq!(vorher, nachher);
    assert!(!aktionen(&elw2)
        .await
        .contains(&"instanz_zertifikat_gewechselt".to_string()));
}
