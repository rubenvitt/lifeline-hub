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

// ── Nebenwirkungen der Richtung (D2) ─────────────────────────────────────────────────────────

async fn kennung_von(i: &Instanz) -> String {
    eine(&i.pool, "SELECT kennung FROM instanz_identitaet").await
}

async fn abgleichen(i: &Instanz) {
    lifeline_hub::instanz::spiegel::takt::durchlauf(&i.pool, Some(&i.app), true)
        .await
        .unwrap();
}

#[tokio::test]
async fn erst_vor_ort_dann_hub_die_stammdaten_kommen_nur_vom_hub() {
    let (elw1, elw2) = vor_ort().await;
    konto(&elw1, "nurelwa").await;
    melden(&elw2).await;
    let hub = instanz().await;
    schluessel(&hub).await;
    konto(&hub, "vomhub").await;
    koppeln(&hub, &elw2).await;
    melden(&elw2).await;
    let namen: Vec<String> = sqlx::query_scalar("SELECT benutzername FROM benutzer ORDER BY id")
        .fetch_all(&elw2.pool)
        .await
        .unwrap();
    assert!(namen.contains(&"vomhub".to_string()), "{namen:?}");
    assert!(!namen.contains(&"nurelwa".to_string()), "{namen:?}");
    let quelle: i64 = eine(
        &elw2.pool,
        "SELECT COUNT(*) FROM stammdaten_herkunft h JOIN instanz_kopplung_org o \
         ON o.id = h.kopplung_org_id JOIN instanz_kopplung k ON k.id = o.kopplung_id \
         WHERE k.art = 'vor_ort'",
    )
    .await;
    assert_eq!(quelle, 0, "nichts über die Direktkopplung übernommen");
}

#[tokio::test]
async fn vor_ort_macht_die_org_nicht_verteilend_und_kennt_kein_elw_verloren() {
    use lifeline_hub::instanz::stammdaten::geheimnis::is_org_verteilend;
    let (elw1, _elw2) = vor_ort().await;
    assert!(!is_org_verteilend(&elw1.pool, 1).await.unwrap());
    let id = kopplungen(&elw1).await[0]["id"].as_i64().unwrap();
    let (s, v) = common::anfrage(
        &elw1.app,
        "POST",
        &format!("/api/admin/instanz/kopplungen/{id}/verloren"),
        &elw1.admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::CONFLICT, "{v}");
    // Gegenprobe: eine Standardkopplung macht verteilend.
    let (hub, _elw) = gekoppelt().await;
    assert!(is_org_verteilend(&hub.pool, 1).await.unwrap());
}

async fn abschliessen_und_nachbereitung_vorbei(i: &Instanz, einsatz: i64) {
    let (s, v) = common::anfrage(
        &i.app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/abschliessen"),
        &i.admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    abgleichen(i).await;
    exec(
        &i.pool,
        &format!(
            "UPDATE einsatz SET nachbereitung_bis = '2000-01-01 00:00:00' WHERE id = {einsatz}"
        ),
    )
    .await;
}

#[tokio::test]
async fn nur_vor_ort_gekoppelt_wird_nichts_verwahrt() {
    let (elw1, elw2) = vor_ort().await;
    let e = common::einsatz_anlegen_mit(&elw2.app, &elw2.admin, "Brand").await;
    abgleichen(&elw2).await;
    let k: String = eine(
        &elw2.pool,
        &format!("SELECT kennung FROM einsatz WHERE id = {e}"),
    )
    .await;
    let spiegel: bool = eine(
        &elw1.pool,
        &format!("SELECT spiegel FROM einsatz WHERE kennung = '{k}'"),
    )
    .await;
    assert!(spiegel, "ELW 1 spiegelt über die Direktkopplung");
    abschliessen_und_nachbereitung_vorbei(&elw2, e).await;
    for _ in 0..3 {
        abgleichen(&elw2).await;
    }
    let spiegel: bool = eine(
        &elw1.pool,
        &format!("SELECT spiegel FROM einsatz WHERE kennung = '{k}'"),
    )
    .await;
    assert!(spiegel, "kein eigener Einsatz aus dem Spiegel");
    let n: i64 = eine(
        &elw2.pool,
        &format!("SELECT COUNT(*) FROM einsatz WHERE id = {e}"),
    )
    .await;
    assert_eq!(n, 1, "ELW 2 behält den Einsatz");
}

#[tokio::test]
async fn mit_hub_und_vor_ort_geht_die_verwahrung_nur_an_den_hub() {
    let (elw1, elw2) = vor_ort().await;
    let hub = instanz().await;
    schluessel(&hub).await;
    koppeln(&hub, &elw2).await;
    melden(&elw2).await;
    let e = common::einsatz_anlegen_mit(&elw2.app, &elw2.admin, "Brand").await;
    abgleichen(&elw2).await;
    let k: String = eine(
        &elw2.pool,
        &format!("SELECT kennung FROM einsatz WHERE id = {e}"),
    )
    .await;
    abschliessen_und_nachbereitung_vorbei(&elw2, e).await;
    for _ in 0..3 {
        abgleichen(&elw2).await;
    }
    let am_hub: bool = eine(
        &hub.pool,
        &format!("SELECT spiegel FROM einsatz WHERE kennung = '{k}'"),
    )
    .await;
    assert!(!am_hub, "der Hub verwahrt");
    let am_elw1: i64 = eine(
        &elw1.pool,
        &format!("SELECT COUNT(*) FROM einsatz WHERE kennung = '{k}' AND spiegel = 0"),
    )
    .await;
    assert_eq!(am_elw1, 0, "ELW 1 nicht");
}

// ── Führung über eine Direktkopplung (D4) ────────────────────────────────────────────────────

async fn fuehrung_an(instanzen: &[&Instanz]) {
    for i in instanzen {
        lifeline_hub::instanz::fuehrung::save_schalter(&i.pool, true)
            .await
            .unwrap();
    }
}

async fn fuehrer(i: &Instanz, kennung: &str) -> String {
    eine(
        &i.pool,
        &format!("SELECT fuehrer_kennung FROM einsatz_fuehrung WHERE kennung = '{kennung}'"),
    )
    .await
}

#[tokio::test]
async fn die_gegenstelle_vor_ort_kann_die_fuehrung_nicht_beanspruchen() {
    let (elw1, elw2) = vor_ort().await;
    fuehrung_an(&[&elw1, &elw2]).await;
    let e = common::einsatz_anlegen_mit(&elw1.app, &elw1.admin, "Unwetter").await;
    melden(&elw2).await;
    abgleichen(&elw2).await;
    let k: String = eine(
        &elw1.pool,
        &format!("SELECT kennung FROM einsatz WHERE id = {e}"),
    )
    .await;
    let ich1 = kennung_von(&elw1).await;
    let ich2 = kennung_von(&elw2).await;
    assert_eq!(fuehrer(&elw2, &k).await, ich1);
    // Die Route der Notübernahme an ELW 2 endet mit 409.
    let s2: i64 = eine(
        &elw2.pool,
        &format!("SELECT id FROM einsatz WHERE kennung = '{k}'"),
    )
    .await;
    let (s, v) = common::anfrage_json(
        &elw2.app,
        "POST",
        &format!("/api/einsaetze/{s2}/fuehrung/notuebernahme"),
        &elw2.admin,
        Some(&json!({"grund": "ELW 1 antwortet nicht"})),
    )
    .await;
    assert_eq!(s, StatusCode::CONFLICT, "{v}");
    assert!(
        v["error"].as_str().unwrap().contains("vor Ort gekoppelt"),
        "{v}"
    );
    // ELW 2 behauptet trotzdem eine höhere Epoche mit sich als Führer.
    exec(
        &elw2.pool,
        "UPDATE instanz_identitaet SET fuehrung_stand = fuehrung_stand + 1",
    )
    .await;
    exec(
        &elw2.pool,
        &format!(
            "UPDATE einsatz_fuehrung SET epoche_zaehler = epoche_zaehler + 5, \
             epoche_instanz = '{ich2}', fuehrer_kennung = '{ich2}', fuehrer_name = 'ELW 2', \
             stand = (SELECT fuehrung_stand FROM instanz_identitaet) WHERE kennung = '{k}'"
        ),
    )
    .await;
    melden(&elw2).await;
    assert_eq!(fuehrer(&elw1, &k).await, ich1, "ELW 1 führt weiter");
    let hinweis = kopplungen(&elw1).await[0]["hinweis"].clone();
    assert!(
        hinweis
            .as_str()
            .unwrap_or_default()
            .contains("über eine Direktkopplung"),
        "{hinweis}"
    );
    // Das Paneel zeigt die Gegenstelle mit ihrer Art.
    let (s, v) = common::anfrage(
        &elw1.app,
        "GET",
        &format!("/api/einsaetze/{e}/fuehrung"),
        &elw1.admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert_eq!(v["gegenueber"][0]["art"], "vor_ort", "{v}");
    let (s, v) = common::anfrage_json(
        &elw1.app,
        "POST",
        &format!("/api/einsaetze/{e}/fuehrung/uebergeben"),
        &elw1.admin,
        Some(&json!({"an": ich2})),
    )
    .await;
    assert_eq!(s, StatusCode::CONFLICT, "{v}");
}

#[tokio::test]
async fn gibt_der_fuehrer_an_den_hub_ab_folgt_die_akte_vor_ort() {
    let hub = instanz().await;
    let (elw1, elw2) = vor_ort().await;
    schluessel(&hub).await;
    koppeln(&hub, &elw1).await;
    fuehrung_an(&[&hub, &elw1, &elw2]).await;
    melden(&elw1).await;
    melden(&elw2).await;
    let e = common::einsatz_anlegen_mit(&elw1.app, &elw1.admin, "Unwetter").await;
    for _ in 0..2 {
        melden(&elw1).await;
        abgleichen(&elw1).await;
        melden(&elw2).await;
        abgleichen(&elw2).await;
    }
    let k: String = eine(
        &elw1.pool,
        &format!("SELECT kennung FROM einsatz WHERE id = {e}"),
    )
    .await;
    let ich_hub = kennung_von(&hub).await;
    let (s, v) = common::anfrage_json(
        &elw1.app,
        "POST",
        &format!("/api/einsaetze/{e}/fuehrung/uebergeben"),
        &elw1.admin,
        Some(&json!({"an": ich_hub})),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    melden(&elw1).await;
    assert_eq!(fuehrer(&hub, &k).await, ich_hub);
    // ELW 2 ist nur mit ELW 1 gekoppelt: es nimmt die Abgabe an, der Spiegel bleibt stehen.
    melden(&elw2).await;
    assert_eq!(fuehrer(&elw2, &k).await, ich_hub);
    let hinweis: Option<String> = eine(
        &elw2.pool,
        &format!(
            "SELECT s.hinweis FROM einsatz_spiegel s JOIN einsatz e ON e.id = s.einsatz_id \
             WHERE e.kennung = '{k}'"
        ),
    )
    .await;
    assert_eq!(
        hinweis.as_deref(),
        Some("Die führende Instanz ist hier nicht gekoppelt.")
    );
}

#[tokio::test]
async fn gibt_der_fuehrer_an_den_hub_ab_spiegelt_ein_dort_gekoppeltes_elw_danach_vom_hub() {
    // Spec `instanz-fuehrung`, „ELW übergibt an den Hub“: ELW 2 ist auch beim Hub gekoppelt.
    let (hub, elw1, elw2) = hub_und_zwei_elw().await;
    fuehrung_an(&[&hub, &elw1, &elw2]).await;
    let e = common::einsatz_anlegen_mit(&elw1.app, &elw1.admin, "Unwetter").await;
    for _ in 0..2 {
        melden(&elw1).await;
        abgleichen(&elw1).await;
        melden(&elw2).await;
        abgleichen(&elw2).await;
    }
    let k: String = eine(
        &elw1.pool,
        &format!("SELECT kennung FROM einsatz WHERE id = {e}"),
    )
    .await;
    let ich_elw1 = kennung_von(&elw1).await;
    let ich_hub = kennung_von(&hub).await;
    assert_eq!(fuehrer(&elw2, &k).await, ich_elw1);
    let (s, v) = common::anfrage_json(
        &elw1.app,
        "POST",
        &format!("/api/einsaetze/{e}/fuehrung/uebergeben"),
        &elw1.admin,
        Some(&json!({"an": ich_hub})),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    for _ in 0..2 {
        melden(&elw1).await;
        abgleichen(&hub).await;
        melden(&elw2).await;
        abgleichen(&elw2).await;
    }
    assert_eq!(fuehrer(&hub, &k).await, ich_hub);
    assert_eq!(fuehrer(&elw2, &k).await, ich_hub);
    let (hinweis, quelle): (Option<String>, Option<String>) =
        sqlx::query_as(sqlx::AssertSqlSafe(format!(
            "SELECT s.hinweis, k.gegenueber_kennung FROM einsatz_spiegel s \
             JOIN einsatz e ON e.id = s.einsatz_id \
             LEFT JOIN instanz_kopplung_org o ON o.id = s.kopplung_org_id \
             LEFT JOIN instanz_kopplung k ON k.id = o.kopplung_id WHERE e.kennung = '{k}'"
        )))
        .fetch_one(&elw2.pool)
        .await
        .unwrap();
    assert_eq!(hinweis, None, "kein Hinweis „nicht gekoppelt“");
    assert_eq!(
        quelle.as_deref(),
        Some(ich_hub.as_str()),
        "der Spiegel kommt vom Hub"
    );
}

// ── Ursprungskennung (D5) ────────────────────────────────────────────────────────────────────

/// Hub mit dem Konto „anna“ und dem Fahrzeug „Rotkreuz Nord 1/83-1“, beide ELW beim Hub
/// gekoppelt und beliefert, dazu vor Ort miteinander (ELW 2 meldet sich bei ELW 1).
async fn hub_und_zwei_elw() -> (Instanz, Instanz, Instanz) {
    let hub = instanz().await;
    schluessel(&hub).await;
    konto(&hub, "anna").await;
    exec(
        &hub.pool,
        "INSERT INTO fahrzeug (org_id, funkrufname) VALUES (1, 'Rotkreuz Nord 1/83-1')",
    )
    .await;
    let elw1 = instanz_tls().await;
    let elw2 = instanz().await;
    koppeln(&hub, &elw1).await;
    koppeln(&hub, &elw2).await;
    melden(&elw1).await;
    melden(&elw2).await;
    schluessel(&elw1).await;
    let code = code_vor_ort(&elw1).await;
    let (s, v) = einloesen(&elw2, &elw1, &code).await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
    (hub, elw1, elw2)
}

async fn ursprung_von(i: &Instanz, art: &str, lokal: i64) -> Option<String> {
    eine(
        &i.pool,
        &format!(
            "SELECT ursprung FROM stammdaten_herkunft WHERE art = '{art}' \
             AND lokaler_schluessel = '{lokal}'"
        ),
    )
    .await
}

#[tokio::test]
async fn ein_konto_vom_hub_traegt_an_beiden_elw_denselben_ursprung() {
    let (hub, elw1, elw2) = hub_und_zwei_elw().await;
    let anna_hub = lokale_id(&hub, "benutzer", "benutzername", "anna").await;
    let anna1 = lokale_id(&elw1, "benutzer", "benutzername", "anna").await;
    let anna2 = lokale_id(&elw2, "benutzer", "benutzername", "anna").await;
    let erwartet = format!("{}/{anna_hub}", kennung_von(&hub).await);
    assert_eq!(
        ursprung_von(&elw1, "konto", anna1).await,
        Some(erwartet.clone())
    );
    assert_eq!(ursprung_von(&elw2, "konto", anna2).await, Some(erwartet));
}

#[tokio::test]
async fn eine_lieferung_mit_protokoll_3_berichtigt_den_ursprung_aelterer_zeilen() {
    let (hub, _elw1, elw2) = hub_und_zwei_elw().await;
    let anna_hub = lokale_id(&hub, "benutzer", "benutzername", "anna").await;
    let anna2 = lokale_id(&elw2, "benutzer", "benutzername", "anna").await;
    exec(
        &elw2.pool,
        "UPDATE stammdaten_herkunft SET ursprung = 'veraltet'",
    )
    .await;
    exec(
        &elw2.pool,
        "UPDATE instanz_kopplung SET gegenueber_protokoll = 2 WHERE art = 'standard'",
    )
    .await;
    for _ in 0..3 {
        melden(&elw2).await;
    }
    assert_eq!(
        ursprung_von(&elw2, "konto", anna2).await,
        Some(format!("{}/{anna_hub}", kennung_von(&hub).await))
    );
}

#[tokio::test]
async fn im_spiegel_vor_ort_gelten_konto_rolle_und_fahrzeug_vom_hub_als_dieselben() {
    let (_hub, elw1, elw2) = hub_und_zwei_elw().await;
    let e = common::einsatz_anlegen_mit(&elw1.app, &elw1.admin, "Hochwasser").await;
    let anna1 = lokale_id(&elw1, "benutzer", "benutzername", "anna").await;
    let anna2 = lokale_id(&elw2, "benutzer", "benutzername", "anna").await;
    common::rolle_setzen(&elw1.app, &elw1.admin, e, anna1, "einsatzleitung").await;
    let fz1 = lokale_id(&elw1, "fahrzeug", "funkrufname", "Rotkreuz Nord 1/83-1").await;
    let fz2 = lokale_id(&elw2, "fahrzeug", "funkrufname", "Rotkreuz Nord 1/83-1").await;
    let (s, v) = common::anfrage(
        &elw1.app,
        "POST",
        &format!("/api/einsaetze/{e}/fahrzeuge"),
        &elw1.admin,
        Some(&format!(r#"{{"fahrzeug_id":{fz1}}}"#)),
    )
    .await;
    assert!(s.is_success(), "{s} {v}");
    // Ein geliehenes Fahrzeug nur an ELW 1.
    let (s, v) = common::anfrage_json(
        &elw1.app,
        "POST",
        "/api/fahrzeuge",
        &elw1.admin,
        Some(&json!({"funkrufname": "Geliehen 1"})),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
    let geliehen = v["id"].as_i64().unwrap();
    let (s, v) = common::anfrage(
        &elw1.app,
        "POST",
        &format!("/api/einsaetze/{e}/fahrzeuge"),
        &elw1.admin,
        Some(&format!(r#"{{"fahrzeug_id":{geliehen}}}"#)),
    )
    .await;
    assert!(s.is_success(), "{s} {v}");
    for _ in 0..2 {
        abgleichen(&elw2).await;
    }
    let k: String = eine(
        &elw1.pool,
        &format!("SELECT kennung FROM einsatz WHERE id = {e}"),
    )
    .await;
    let s2: i64 = eine(
        &elw2.pool,
        &format!("SELECT id FROM einsatz WHERE kennung = '{k}'"),
    )
    .await;
    let fahrzeuge: Vec<Option<i64>> = sqlx::query_scalar(
        "SELECT fahrzeug_id FROM einsatz_fahrzeug WHERE einsatz_id = ? ORDER BY id",
    )
    .bind(s2)
    .fetch_all(&elw2.pool)
    .await
    .unwrap();
    assert_eq!(
        fahrzeuge,
        vec![Some(fz2), None],
        "vom Hub dasselbe, geliehen ohne Verweis"
    );
    let rolle: String = eine(
        &elw2.pool,
        &format!(
            "SELECT einsatz_rolle FROM einsatz_mitgliedschaft WHERE einsatz_id = {s2} \
             AND benutzer_id = {anna2}"
        ),
    )
    .await;
    assert_eq!(rolle, "einsatzleitung");
    // Stellvertreter gibt es nur für Konten allein an ELW 1 (etwa dessen lokalen Admin).
    let stellvertreter: i64 = eine(
        &elw2.pool,
        "SELECT COUNT(*) FROM spiegel_konto sk JOIN benutzer b ON b.id = sk.benutzer_id \
         WHERE b.anzeigename = 'anna'",
    )
    .await;
    assert_eq!(stellvertreter, 0, "kein Stellvertreter für Anna");
}

#[tokio::test]
async fn ein_antrag_vom_elw_vor_ort_laeuft_im_namen_desselben_kontos() {
    let (_hub, elw1, elw2) = hub_und_zwei_elw().await;
    let e = common::einsatz_anlegen_mit(&elw1.app, &elw1.admin, "Hochwasser").await;
    let anna1 = lokale_id(&elw1, "benutzer", "benutzername", "anna").await;
    common::rolle_setzen(&elw1.app, &elw1.admin, e, anna1, "fuehrungspersonal").await;
    for _ in 0..2 {
        abgleichen(&elw2).await;
    }
    let k: String = eine(
        &elw1.pool,
        &format!("SELECT kennung FROM einsatz WHERE id = {e}"),
    )
    .await;
    let s2: i64 = eine(
        &elw2.pool,
        &format!("SELECT id FROM einsatz WHERE kennung = '{k}'"),
    )
    .await;
    // Ohne bestätigte Platte kommt Annas Passwort nicht mit; an ELW 2 ein lokales.
    let hilfe = konto(&elw2, "hilfe").await;
    exec(
        &elw2.pool,
        "UPDATE benutzer SET passwort_hash = (SELECT passwort_hash FROM benutzer \
         WHERE benutzername = 'hilfe'), passwort_wechsel_pflicht = 0 WHERE benutzername = 'anna'",
    )
    .await;
    let anna = common::login_cookie(&elw2.app, "anna", "hilfe-pw-123").await;

    let (st, v) = common::anfrage_json(
        &elw2.app,
        "POST",
        &format!("/api/einsaetze/{s2}/etb"),
        &anna,
        Some(
            &json!({ "typ": "meldung", "inhalt": "Vom ELW 2", "von": "ELW 2", "an": "EL",
                      "client_id": "vo-1" }),
        ),
    )
    .await;
    assert_eq!(st, StatusCode::ACCEPTED, "{v}");
    // „hilfe“ ist ein Konto nur an ELW 2; die Rolle bekommt es direkt am Spiegel.
    {
        let mut tx = elw2.pool.begin().await.unwrap();
        for sql in [
            "INSERT INTO spiegel_uebernahme (id) VALUES (1)".to_string(),
            format!(
                "INSERT INTO einsatz_mitgliedschaft (einsatz_id, benutzer_id, einsatz_rolle) \
                 VALUES ({s2}, {hilfe}, 'fuehrungspersonal')"
            ),
            "DELETE FROM spiegel_uebernahme".to_string(),
        ] {
            sqlx::query(sqlx::AssertSqlSafe(sql))
                .execute(&mut *tx)
                .await
                .unwrap();
        }
        tx.commit().await.unwrap();
    }
    exec(
        &elw2.pool,
        "UPDATE benutzer SET passwort_wechsel_pflicht = 0 WHERE benutzername = 'hilfe'",
    )
    .await;
    let hilfe_cookie = common::login_cookie(&elw2.app, "hilfe", "hilfe-pw-123").await;
    let (st, v) = common::anfrage_json(
        &elw2.app,
        "POST",
        &format!("/api/einsaetze/{s2}/etb"),
        &hilfe_cookie,
        Some(
            &json!({ "typ": "meldung", "inhalt": "Von Hilfe", "von": "ELW 2", "an": "EL",
                      "client_id": "vo-2" }),
        ),
    )
    .await;
    assert_eq!(st, StatusCode::ACCEPTED, "{v}");
    for _ in 0..3 {
        abgleichen(&elw2).await;
    }
    let verfasser: String = eine(
        &elw1.pool,
        &format!(
            "SELECT b.benutzername FROM etb_eintrag e JOIN benutzer b ON b.id = e.erfasser_id \
             WHERE e.einsatz_id = {e} AND e.inhalt = 'Vom ELW 2'"
        ),
    )
    .await;
    assert_eq!(verfasser, "anna");
    let grund: String = eine(
        &elw2.pool,
        "SELECT grund FROM spiegel_antrag WHERE client_id = 'vo-2'",
    )
    .await;
    assert_eq!(grund, "Konto am Führer unbekannt.");
    let im_spiegel: i64 = eine(
        &elw2.pool,
        &format!(
            "SELECT COUNT(*) FROM etb_eintrag WHERE einsatz_id = {s2} AND inhalt = 'Vom ELW 2'"
        ),
    )
    .await;
    assert_eq!(im_spiegel, 1, "übernommen und zurückgespiegelt");
}

// ── Entdeckung im LAN (D6) ───────────────────────────────────────────────────────────────────

/// Ein Sucher, der immer dieselben Instanzen „findet“.
struct Attrappe(Vec<lifeline_hub::instanz::entdeckung::InstanzGefunden>);

impl lifeline_hub::instanz::entdeckung::Sucher for Attrappe {
    fn suche(
        &self,
        _dauer: std::time::Duration,
    ) -> Vec<lifeline_hub::instanz::entdeckung::InstanzGefunden> {
        self.0.clone()
    }
}

async fn gefunden(
    i: &Instanz,
    adresse: &str,
) -> lifeline_hub::instanz::entdeckung::InstanzGefunden {
    let ident = lifeline_hub::instanz::identitaet::load_or_create(&i.pool)
        .await
        .unwrap();
    lifeline_hub::instanz::entdeckung::InstanzGefunden {
        kennung: ident.kennung.clone(),
        name: "ELW 1".into(),
        fingerabdruck: ident.fingerabdruck(),
        protokoll: lifeline_hub::instanz::PROTOKOLL,
        adressen: vec![adresse.to_string()],
        gekoppelt: false,
    }
}

async fn attrappe(i: &Instanz, liste: Vec<lifeline_hub::instanz::entdeckung::InstanzGefunden>) {
    let ich = lifeline_hub::instanz::identitaet::load_or_create(&i.pool)
        .await
        .unwrap()
        .kennung;
    lifeline_hub::instanz::entdeckung::set_sucher(&i.pool, &ich, Arc::new(Attrappe(liste)))
        .await
        .unwrap();
}

#[tokio::test]
async fn die_liste_im_netz_gefunden_ohne_eigene_und_mit_markierung() {
    let elw1 = instanz_tls().await;
    let elw2 = instanz().await;
    // Schalter aus: Hinweis, keine Einträge.
    let (s, v) = common::anfrage(
        &elw2.app,
        "GET",
        "/api/admin/instanz/lan",
        &elw2.admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert_eq!(v["aus"], true);
    assert_eq!(v["gefunden"], json!([]));
    let eigen = gefunden(&elw2, "https://10.0.0.2:8443").await;
    attrappe(&elw2, vec![gefunden(&elw1, &elw1.adresse).await, eigen]).await;
    let (s, v) = common::anfrage(
        &elw2.app,
        "GET",
        "/api/admin/instanz/lan",
        &elw2.admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert_eq!(v["aus"], false);
    let liste = v["gefunden"].as_array().unwrap();
    assert_eq!(liste.len(), 1, "ohne die eigene: {v}");
    assert_eq!(liste[0]["kennung"], kennung_von(&elw1).await);
    assert_eq!(liste[0]["gekoppelt"], false);
    // Gewählte Adresse einlösen wie eine eingetippte, danach „schon gekoppelt“.
    schluessel(&elw1).await;
    let code = code_vor_ort(&elw1).await;
    let adresse = liste[0]["adressen"][0].as_str().unwrap().to_string();
    let (s, v) = common::anfrage_json(
        &elw2.app,
        "POST",
        "/api/admin/instanz/einloesen",
        &elw2.admin,
        Some(&json!({"adresse": adresse, "code": code})),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
    let (_, v) = common::anfrage(
        &elw2.app,
        "GET",
        "/api/admin/instanz/lan",
        &elw2.admin,
        None,
    )
    .await;
    assert_eq!(v["gefunden"][0]["gekoppelt"], true);
    // Nicht-Admin: 403.
    let konto_id = konto(&elw2, "leser").await;
    let _ = konto_id;
    exec(
        &elw2.pool,
        "UPDATE benutzer SET passwort_wechsel_pflicht = 0 WHERE benutzername = 'leser'",
    )
    .await;
    let leser = common::login_cookie(&elw2.app, "leser", "leser-pw-123").await;
    let (s, _) = common::anfrage(&elw2.app, "GET", "/api/admin/instanz/lan", &leser, None).await;
    assert_eq!(s, StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn eine_gefaelschte_ankuendigung_begruendet_keine_kopplung() {
    // Ein Gerät kündigt sich mit Kennung und Name von ELW 1 an, ist aber eine andere Instanz.
    let elw1 = instanz_tls().await;
    let faelscher = instanz_tls().await;
    let elw2 = instanz().await;
    schluessel(&elw1).await;
    let code = code_vor_ort(&elw1).await;
    attrappe(&elw2, vec![gefunden(&elw1, &faelscher.adresse).await]).await;
    let (s, v) = einloesen(&elw2, &faelscher, &code).await;
    assert!(
        s == StatusCode::UNPROCESSABLE_ENTITY || s == StatusCode::CONFLICT,
        "{s} {v}"
    );
    assert!(kopplungen(&elw2).await.is_empty());
}

#[tokio::test]
async fn eine_direktkopplung_findet_ihre_gegenstelle_unter_neuer_adresse() {
    let (elw1, elw2) = vor_ort().await;
    // ELW 1 ist unter der gespeicherten Adresse nicht mehr da (neue IP per DHCP).
    exec(
        &elw2.pool,
        "UPDATE instanz_kopplung SET gegenueber_adresse = 'https://127.0.0.1:9'",
    )
    .await;
    attrappe(&elw2, vec![gefunden(&elw1, &elw1.adresse).await]).await;
    let vorher: Option<String> = eine(
        &elw1.pool,
        "SELECT zuletzt_gesehen_at FROM instanz_kopplung",
    )
    .await;
    tokio::time::sleep(std::time::Duration::from_millis(1100)).await;
    melden(&elw2).await;
    let adresse: String = eine(
        &elw2.pool,
        "SELECT gegenueber_adresse FROM instanz_kopplung",
    )
    .await;
    assert_eq!(adresse, elw1.adresse);
    assert!(aktionen(&elw2)
        .await
        .contains(&"instanz_adresse_geaendert".to_string()));
    let k2 = &kopplungen(&elw2).await[0];
    assert!(k2.get("letzter_fehler").is_none(), "{k2}");
    let nachher: Option<String> = eine(
        &elw1.pool,
        "SELECT zuletzt_gesehen_at FROM instanz_kopplung",
    )
    .await;
    assert_ne!(vorher, nachher, "gleich dort gemeldet");
}

#[tokio::test]
async fn unter_der_neuen_adresse_ohne_signierte_antwort_bleibt_die_alte() {
    let (elw1, elw2) = vor_ort().await;
    let alt = "https://127.0.0.1:9";
    exec(
        &elw2.pool,
        &format!("UPDATE instanz_kopplung SET gegenueber_adresse = '{alt}'"),
    )
    .await;
    // Unter der „neuen“ Adresse antwortet ein Gerät ohne Signatur von ELW 1.
    let (fremd, _) = vermittler_ohne_signatur().await;
    attrappe(&elw2, vec![gefunden(&elw1, &fremd).await]).await;
    melden(&elw2).await;
    let adresse: String = eine(
        &elw2.pool,
        "SELECT gegenueber_adresse FROM instanz_kopplung",
    )
    .await;
    assert_eq!(adresse, alt);
    let k2 = &kopplungen(&elw2).await[0];
    assert!(
        k2["letzter_fehler"]
            .as_str()
            .unwrap()
            .starts_with("Antwort ungültig"),
        "{k2}"
    );
}

/// Ein HTTPS-Gerät, das auf alles mit 200 und einem leeren JSON antwortet, ohne Signatur.
async fn vermittler_ohne_signatur() -> (String, ()) {
    let (cert, key) =
        lifeline_hub::tls::rcgen_pem(&["localhost".into(), "127.0.0.1".into()]).unwrap();
    let config =
        axum_server::tls_rustls::RustlsConfig::from_pem(cert.into_bytes(), key.into_bytes())
            .await
            .unwrap();
    let app = axum::Router::new().fallback(|| async { axum::Json(json!({})) });
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
    (adresse, ())
}

// ── Befunde aus dem Review vor dem PR ────────────────────────────────────────────────────────

#[tokio::test]
async fn ein_fremdes_geraet_ohne_aussage_unter_der_adresse_passt_nicht() {
    let (elw1, elw2) = vor_ort().await;
    let pin_vorher: String = eine(&elw2.pool, "SELECT tls_zertifikat FROM instanz_kopplung").await;
    let (fremd, _) = vermittler_ohne_signatur().await;
    exec(
        &elw2.pool,
        &format!("UPDATE instanz_kopplung SET gegenueber_adresse = '{fremd}'"),
    )
    .await;
    melden(&elw2).await;
    let k2 = &kopplungen(&elw2).await[0];
    assert_eq!(k2["zertifikat"], "passt_nicht", "{k2}");
    assert_eq!(k2["letzter_fehler"], "Zertifikat passt nicht");
    let pin: String = eine(&elw2.pool, "SELECT tls_zertifikat FROM instanz_kopplung").await;
    assert_eq!(pin, pin_vorher);
    let _ = elw1;
}

#[tokio::test]
async fn das_neuaufloesen_laeuft_je_meldung_hoechstens_einmal() {
    // ELW 1 ist unter zwei Adressen angekündigt. Beide liefern die signierte Aussage, brechen
    // aber jede Meldung ab: ohne Grenze lösten die Adressen einander ohne Ende ab.
    let (elw1, elw2) = vor_ort().await;
    let (cert, key) =
        lifeline_hub::tls::rcgen_pem(&["localhost".into(), "127.0.0.1".into()]).unwrap();
    let fp = lifeline_hub::instanz::identitaet::tls_fingerabdruck_pem(cert.as_bytes()).unwrap();
    lifeline_hub::instanz::identitaet::save_tls_zertifikat(&elw1.pool, Some(&fp))
        .await
        .unwrap();
    let rueckfragen = Arc::new(Mutex::new(0usize));
    let mut adressen = Vec::new();
    for _ in 0..2 {
        let zaehler = rueckfragen.clone();
        let nur_aussage = elw1.app.clone().layer(axum::middleware::from_fn(
            move |req: axum::extract::Request, next: axum::middleware::Next| {
                let zaehler = zaehler.clone();
                async move {
                    if req.uri().path() != "/api/instanz/zertifikat" {
                        panic!("Verbindung bricht ab");
                    }
                    *zaehler.lock().unwrap() += 1;
                    next.run(req).await
                }
            },
        ));
        let frei = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = frei.local_addr().unwrap();
        drop(frei);
        let _handle = tls_starten(nur_aussage, addr, cert.clone(), key.clone()).await;
        adressen.push(format!("https://{addr}"));
    }
    exec(
        &elw2.pool,
        "UPDATE instanz_kopplung SET gegenueber_adresse = 'https://127.0.0.1:9'",
    )
    .await;
    let mut eintrag = gefunden(&elw1, &adressen[0]).await;
    eintrag.adressen = adressen.clone();
    attrappe(&elw2, vec![eintrag]).await;
    tokio::time::timeout(std::time::Duration::from_secs(60), melden(&elw2))
        .await
        .expect("das Neuauflösen endet");
    assert_eq!(*rueckfragen.lock().unwrap(), 1, "eine Adresse, ein Versuch");
    let adresse: String = eine(
        &elw2.pool,
        "SELECT gegenueber_adresse FROM instanz_kopplung",
    )
    .await;
    assert!(adressen.contains(&adresse), "{adresse}");
    let k2 = &kopplungen(&elw2).await[0];
    assert!(k2.get("letzter_fehler").is_some(), "{k2}");
}

#[tokio::test]
async fn die_art_bleibt_solange_gelieferte_geheimnisse_gelten() {
    let (hub, elw) = gekoppelt().await;
    lifeline_hub::instanz::identitaet::save_tls_zertifikat(&hub.pool, Some("ab"))
        .await
        .unwrap();
    for i in [&hub, &elw] {
        exec(
            &i.pool,
            "UPDATE instanz_kopplung_org SET widerrufen_at = '2026-01-01 00:00:00'",
        )
        .await;
    }
    exec(
        &hub.pool,
        "INSERT INTO instanz_geheimnis_lieferung (kopplung_org_id, benutzer_id, geliefert_at) \
         SELECT (SELECT id FROM instanz_kopplung_org), (SELECT MIN(id) FROM benutzer), \
         '2026-01-01 00:00:00'",
    )
    .await;
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
    let offen: i64 = eine(
        &hub.pool,
        "SELECT COUNT(*) FROM instanz_kopplungscode WHERE art = 'vor_ort' AND eingeloest_at IS NULL",
    )
    .await;
    assert_eq!(offen, 1, "der Code bleibt einlösbar");
    // Ohne gelieferte Geheimnisse und ohne Org scheitert es nicht mehr an der Art (hier dann am
    // Zertifikat, weil der Hub nur zum Schein TLS hat).
    exec(&hub.pool, "DELETE FROM instanz_geheimnis_lieferung").await;
    let (_, v) = einloesen(&elw, &hub, &code).await;
    assert!(
        !v["error"].as_str().unwrap_or("").contains("schon eine"),
        "{v}"
    );
}

#[tokio::test]
async fn ein_standardcode_an_einer_direktkopplung_nennt_die_bestehende_art() {
    let (elw1, elw2) = vor_ort().await;
    let (s, v) = common::anfrage(
        &elw1.app,
        "POST",
        "/api/admin/instanz/codes",
        &elw1.admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
    let (s, v) = einloesen(&elw2, &elw1, v["code"].as_str().unwrap()).await;
    assert_eq!(s, StatusCode::CONFLICT, "{v}");
    assert!(
        v["error"]
            .as_str()
            .unwrap()
            .contains("schon eine Direktkopplung vor Ort"),
        "{v}"
    );
}

#[tokio::test]
async fn schon_gekoppelt_gilt_nur_mit_gueltiger_zuordnung_der_eigenen_org() {
    let (elw1, elw2) = vor_ort().await;
    attrappe(&elw2, vec![gefunden(&elw1, &elw1.adresse).await]).await;
    let lan = |i: &Instanz| {
        let app = i.app.clone();
        let admin = i.admin.clone();
        async move {
            let (s, v) = common::anfrage(&app, "GET", "/api/admin/instanz/lan", &admin, None).await;
            assert_eq!(s, StatusCode::OK, "{v}");
            v["gefunden"][0]["gekoppelt"].clone()
        }
    };
    assert_eq!(lan(&elw2).await, true);
    exec(
        &elw2.pool,
        "UPDATE instanz_kopplung_org SET widerrufen_at = '2026-01-01 00:00:00'",
    )
    .await;
    assert_eq!(lan(&elw2).await, false);
}

#[tokio::test]
async fn ein_widerruf_der_direktkopplung_holt_die_fuehrung_nicht_zurueck() {
    // Spec `instanz-fuehrung`: Über eine Direktkopplung wechselt die Führung nicht, auch nicht
    // durch das Zurückholen nach einem Widerruf. Sonst führten ELW 1 und ELW 2 denselben Einsatz.
    let (elw1, elw2) = vor_ort().await;
    fuehrung_an(&[&elw1, &elw2]).await;
    let e = common::einsatz_anlegen_mit(&elw1.app, &elw1.admin, "Unwetter").await;
    melden(&elw2).await;
    abgleichen(&elw2).await;
    let k: String = eine(
        &elw1.pool,
        &format!("SELECT kennung FROM einsatz WHERE id = {e}"),
    )
    .await;
    let ich1 = kennung_von(&elw1).await;
    assert_eq!(fuehrer(&elw2, &k).await, ich1);
    let id: i64 = eine(&elw2.pool, "SELECT id FROM instanz_kopplung").await;
    let (s, v) = common::anfrage(
        &elw2.app,
        "POST",
        &format!("/api/admin/instanz/kopplungen/{id}/widerrufen"),
        &elw2.admin,
        None,
    )
    .await;
    assert!(s.is_success(), "{s} {v}");
    assert_eq!(fuehrer(&elw2, &k).await, ich1, "ELW 2 führt nicht selbst");
    let art: String = eine(
        &elw2.pool,
        &format!("SELECT art FROM einsatz_fuehrung WHERE kennung = '{k}'"),
    )
    .await;
    assert_ne!(art, "notuebernahme");
}
