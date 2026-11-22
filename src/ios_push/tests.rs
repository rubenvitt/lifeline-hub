//! Einheitstests der iOS-Anmeldungen und der Nutzlast-Verschlüsselung.

use super::krypto::{self, b64, b64_lesen};
use super::repo::{self, Eingabe};
use crate::web_push::repo::Wahl;
use sqlx::SqlitePool;

async fn benutzer(pool: &SqlitePool, name: &str) -> i64 {
    sqlx::query("INSERT OR IGNORE INTO organisation (id, name) VALUES (1, 'Orga')")
        .execute(pool)
        .await
        .unwrap();
    sqlx::query_scalar(
        "INSERT INTO benutzer (org_id, anzeigename, benutzername, passwort_hash) \
         VALUES (1, ?, ?, 'h') RETURNING id",
    )
    .bind(name)
    .bind(name)
    .fetch_one(pool)
    .await
    .unwrap()
}

async fn sitzung(pool: &SqlitePool, benutzer_id: i64, hash: &str) {
    sqlx::query(
        "INSERT INTO session (token_hash, benutzer_id, expires_at) \
         VALUES (?, ?, '2999-01-01T00:00:00Z')",
    )
    .bind(hash)
    .bind(benutzer_id)
    .execute(pool)
    .await
    .unwrap();
}

fn eingabe<'a>(kennung: &'a str, token: &'a str, wahl: &'a Wahl) -> Eingabe<'a> {
    Eingabe {
        kennung,
        token,
        umgebung: "sandbox",
        schluessel: "c2NobHVlc3NlbA",
        wahl,
    }
}

async fn anzahl(pool: &SqlitePool) -> i64 {
    sqlx::query_scalar("SELECT COUNT(*) FROM ios_push_anmeldung")
        .fetch_one(pool)
        .await
        .unwrap()
}

#[tokio::test]
async fn anmelden_und_lesen() {
    let pool = crate::db::test_pool().await;
    let b = benutzer(&pool, "a").await;
    sitzung(&pool, b, "h1").await;
    let wahl = Wahl {
        inhalt: true,
        stumm: vec![],
    };
    repo::anmelden(&pool, b, "h1", &eingabe("k-1", "tok-1", &wahl))
        .await
        .unwrap();
    let a = repo::anmeldung(&pool, b, "k-1").await.unwrap().unwrap();
    assert_eq!(a.token, "tok-1");
    assert_eq!(a.umgebung, "sandbox");
    assert!(a.inhalt);
    assert!(repo::anmeldung(&pool, b + 1, "k-1")
        .await
        .unwrap()
        .is_none());
    assert_eq!(repo::anmeldungen_von(&pool, &[b]).await.unwrap().len(), 1);
    assert!(repo::anmeldungen_von(&pool, &[]).await.unwrap().is_empty());
    repo::abmelden(&pool, b, "k-1").await.unwrap();
    assert_eq!(anzahl(&pool).await, 0);
}

#[tokio::test]
async fn ein_bekanntes_token_ersetzt_die_alte_anmeldung() {
    let pool = crate::db::test_pool().await;
    let a = benutzer(&pool, "a").await;
    let b = benutzer(&pool, "b").await;
    sitzung(&pool, a, "ha").await;
    sitzung(&pool, b, "hb").await;
    let wahl = Wahl::default();
    repo::anmelden(&pool, a, "ha", &eingabe("k-alt", "tok", &wahl))
        .await
        .unwrap();
    // Dasselbe Gerät, anderer Nutzer, neue Kennung.
    repo::anmelden(&pool, b, "hb", &eingabe("k-neu", "tok", &wahl))
        .await
        .unwrap();
    assert_eq!(anzahl(&pool).await, 1);
    assert!(repo::anmeldung(&pool, a, "k-alt").await.unwrap().is_none());
    assert!(repo::anmeldung(&pool, b, "k-neu").await.unwrap().is_some());
    // Dieselbe Kennung mit anderem Token ersetzt ebenfalls.
    repo::anmelden(&pool, b, "hb", &eingabe("k-neu", "tok-2", &wahl))
        .await
        .unwrap();
    assert_eq!(anzahl(&pool).await, 1);
    let x = repo::anmeldung(&pool, b, "k-neu").await.unwrap().unwrap();
    assert_eq!(x.token, "tok-2");
}

#[tokio::test]
async fn sitzungsablauf_laesst_die_anmeldung_stehen() {
    let pool = crate::db::test_pool().await;
    let b = benutzer(&pool, "a").await;
    sitzung(&pool, b, "h1").await;
    let wahl = Wahl::default();
    repo::anmelden(&pool, b, "h1", &eingabe("k-1", "tok-1", &wahl))
        .await
        .unwrap();
    sqlx::query("DELETE FROM session WHERE token_hash = 'h1'")
        .execute(&pool)
        .await
        .unwrap();
    assert_eq!(anzahl(&pool).await, 1);
    let hash: Option<String> =
        sqlx::query_scalar("SELECT session_token_hash FROM ios_push_anmeldung")
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(hash, None);
}

#[tokio::test]
async fn benutzer_loeschen_loescht_per_cascade() {
    let pool = crate::db::test_pool().await;
    let b = benutzer(&pool, "a").await;
    sitzung(&pool, b, "x").await;
    let wahl = Wahl::default();
    repo::anmelden(&pool, b, "x", &eingabe("k-1", "tok-1", &wahl))
        .await
        .unwrap();
    sqlx::query("DELETE FROM benutzer WHERE id = ?")
        .bind(b)
        .execute(&pool)
        .await
        .unwrap();
    assert_eq!(anzahl(&pool).await, 0);
}

#[tokio::test]
async fn abmelden_mit_falschem_nachweis_aendert_nichts() {
    let pool = crate::db::test_pool().await;
    let b = benutzer(&pool, "a").await;
    sitzung(&pool, b, "x").await;
    let wahl = Wahl::default();
    repo::anmelden(&pool, b, "x", &eingabe("k-1", "tok-1", &wahl))
        .await
        .unwrap();
    assert!(repo::abmelden_mit_nachweis(&pool, "k-1", "falsch")
        .await
        .is_err());
    assert!(repo::abmelden_mit_nachweis(&pool, "k-1", &b64(&[0u8; 32]))
        .await
        .is_err());
    assert_eq!(anzahl(&pool).await, 1);
}

#[tokio::test]
async fn abmelden_mit_richtigem_nachweis_loescht() {
    let pool = crate::db::test_pool().await;
    let b = benutzer(&pool, "a").await;
    sitzung(&pool, b, "x").await;
    let wahl = Wahl::default();
    let schluessel = [7u8; 32];
    let e = Eingabe {
        kennung: "k-1",
        token: "tok-1",
        umgebung: "production",
        schluessel: &b64(&schluessel),
        wahl: &wahl,
    };
    repo::anmelden(&pool, b, "x", &e).await.unwrap();
    let n = krypto::nachweis(&schluessel, "k-1");
    repo::abmelden_mit_nachweis(&pool, "k-1", &n).await.unwrap();
    assert_eq!(anzahl(&pool).await, 0);
}

#[tokio::test]
async fn erloschen_nur_bei_gleichem_token() {
    let pool = crate::db::test_pool().await;
    let b = benutzer(&pool, "a").await;
    sitzung(&pool, b, "x").await;
    let wahl = Wahl::default();
    repo::anmelden(&pool, b, "x", &eingabe("k-1", "tok-1", &wahl))
        .await
        .unwrap();
    let id = repo::anmeldung(&pool, b, "k-1").await.unwrap().unwrap().id;
    repo::erloschen(&pool, id, "anderes").await.unwrap();
    assert_eq!(anzahl(&pool).await, 1);
    repo::erloschen(&pool, id, "tok-1").await.unwrap();
    assert_eq!(anzahl(&pool).await, 0);
}

#[tokio::test]
async fn loeschen_fuer_sitzungen_und_benutzer() {
    let pool = crate::db::test_pool().await;
    let b = benutzer(&pool, "a").await;
    sitzung(&pool, b, "h1").await;
    sitzung(&pool, b, "h2").await;
    let wahl = Wahl::default();
    repo::anmelden(&pool, b, "h1", &eingabe("k-1", "t1", &wahl))
        .await
        .unwrap();
    repo::anmelden(&pool, b, "h2", &eingabe("k-2", "t2", &wahl))
        .await
        .unwrap();
    let mut conn = pool.acquire().await.unwrap();
    repo::loeschen_fuer_sitzungen(&mut conn, &["h1".to_string()])
        .await
        .unwrap();
    drop(conn);
    assert_eq!(anzahl(&pool).await, 1);
    let mut conn = pool.acquire().await.unwrap();
    repo::loeschen_fuer_benutzer(&mut conn, b).await.unwrap();
    drop(conn);
    assert_eq!(anzahl(&pool).await, 0);
}

#[tokio::test]
async fn loeschen_fuer_benutzer_ausser_laesst_nur_die_behaltene_sitzung() {
    let pool = crate::db::test_pool().await;
    let b = benutzer(&pool, "a").await;
    let fremd = benutzer(&pool, "f").await;
    sitzung(&pool, b, "h1").await;
    sitzung(&pool, b, "h2").await;
    sitzung(&pool, b, "h3").await;
    sitzung(&pool, fremd, "hf").await;
    let wahl = Wahl::default();
    for (konto, hash, k, t) in [
        (b, "h1", "k-1", "t1"),
        (b, "h2", "k-2", "t2"),
        (b, "h3", "k-3", "t3"),
        (fremd, "hf", "k-f", "tf"),
    ] {
        repo::anmelden(&pool, konto, hash, &eingabe(k, t, &wahl))
            .await
            .unwrap();
    }
    // k-3 hat keine Sitzung mehr (abgelaufen und weggeräumt).
    sqlx::query("DELETE FROM session WHERE token_hash = 'h3'")
        .execute(&pool)
        .await
        .unwrap();
    let kennungen = || async {
        sqlx::query_scalar::<_, String>("SELECT kennung FROM ios_push_anmeldung ORDER BY kennung")
            .fetch_all(&pool)
            .await
            .unwrap()
    };

    let mut conn = pool.acquire().await.unwrap();
    repo::loeschen_fuer_benutzer_ausser(&mut conn, b, Some("h1"))
        .await
        .unwrap();
    drop(conn);
    assert_eq!(kennungen().await, ["k-1", "k-f"]);

    let mut conn = pool.acquire().await.unwrap();
    repo::loeschen_fuer_benutzer_ausser(&mut conn, b, None)
        .await
        .unwrap();
    drop(conn);
    assert_eq!(
        kennungen().await,
        ["k-f"],
        "ohne behaltene Sitzung alle des Kontos"
    );
}

#[tokio::test]
async fn relais_zugang_speichern_lesen_sperren_loeschen() {
    let pool = crate::db::test_pool().await;
    assert!(repo::relais_zugang(&pool).await.unwrap().is_none());
    let z = repo::RelaisZugang {
        server_id: "s".into(),
        geheimnis: "g".into(),
        gesperrt: false,
        sperre_abgelaufen: false,
    };
    repo::relais_zugang_speichern(&pool, &z).await.unwrap();
    assert_eq!(repo::relais_zugang(&pool).await.unwrap().unwrap(), z);
    repo::relais_gesperrt_setzen(&pool).await.unwrap();
    assert!(repo::relais_zugang(&pool).await.unwrap().unwrap().gesperrt);
    repo::relais_zugang_loeschen(&pool).await.unwrap();
    assert!(repo::relais_zugang(&pool).await.unwrap().is_none());
}

#[test]
fn stumm_ist_bereinigt_und_lesbar() {
    use crate::benachrichtigung::BenachrichtigungArt;
    let a = repo::Anmeldung {
        id: 1,
        kennung: "k".into(),
        benutzer_id: 1,
        token: "t".into(),
        umgebung: "sandbox".into(),
        schluessel: "s".into(),
        inhalt: false,
        stumm: sqlx::types::Json(vec!["x".into()]),
    };
    assert!(!a.ist_stumm(BenachrichtigungArt::ALLE[0]));
}

const VEKTOR: &str = include_str!("../../src-tauri/faelle/push-nutzlast.json");

#[derive(serde::Deserialize)]
struct Datei {
    faelle: Vec<Fall>,
}

#[derive(serde::Deserialize)]
struct Fall {
    beschreibung: String,
    schluessel: String,
    kennung: String,
    nonce: String,
    klartext: String,
    chiffrat: String,
    umschlag: String,
    nachweis: String,
}

#[test]
fn krypto_folgt_dem_gemeinsamen_testvektor() {
    let datei: Datei = serde_json::from_str(VEKTOR).expect("Testvektor lesbar");
    assert!(datei.faelle.len() >= 2);
    for f in datei.faelle {
        let schluessel: [u8; 32] = b64_lesen(&f.schluessel).unwrap().try_into().unwrap();
        let nonce: [u8; 12] = b64_lesen(&f.nonce).unwrap().try_into().unwrap();
        let chiffrat =
            krypto::verschluesseln(&schluessel, &f.kennung, f.klartext.as_bytes(), nonce).unwrap();
        assert_eq!(b64(&chiffrat), f.chiffrat, "{}", f.beschreibung);
        assert_eq!(
            krypto::umschlag(&f.kennung, &nonce, &chiffrat),
            f.umschlag,
            "{}",
            f.beschreibung
        );
        assert_eq!(
            krypto::nachweis(&schluessel, &f.kennung),
            f.nachweis,
            "{}",
            f.beschreibung
        );
    }
}

// ---- Relais-Client ----

mod relais_client {
    use crate::ios_push::relais::{RelaisFehler, RelaisNachricht, Stufe, Umgebung};
    use crate::ios_push::repo::{self, RelaisZugang};
    use crate::ios_push::IosPush;
    use axum::{
        body::to_bytes, body::Body, http::Request, http::StatusCode, response::IntoResponse,
    };
    use serde_json::{json, Value};
    use std::collections::VecDeque;
    use std::sync::{Arc, Mutex};

    /// Was das Relais-Doppel gesehen hat: Pfad, Authorization, Rumpf.
    type Gesehen = Arc<Mutex<Vec<(String, Option<String>, Value)>>>;
    /// Vorgegebene Antworten von `/v1/senden` (Status, Rumpf), der Reihe nach.
    type Antworten = Arc<Mutex<VecDeque<(u16, Value)>>>;

    async fn relais_doppel(antworten: Antworten) -> (String, Gesehen) {
        let gesehen: Gesehen = Arc::default();
        let g = gesehen.clone();
        let zaehler = Arc::new(Mutex::new(0u32));
        let app = axum::Router::new().fallback(move |req: Request<Body>| {
            let g = g.clone();
            let antworten = antworten.clone();
            let zaehler = zaehler.clone();
            async move {
                let pfad = req.uri().path().to_owned();
                let auth = req
                    .headers()
                    .get("authorization")
                    .map(|v| v.to_str().unwrap().to_owned());
                let rumpf = to_bytes(req.into_body(), usize::MAX).await.unwrap();
                let rumpf: Value = serde_json::from_slice(&rumpf).unwrap_or(Value::Null);
                g.lock().unwrap().push((pfad.clone(), auth, rumpf));
                if pfad == "/v1/server" {
                    let mut n = zaehler.lock().unwrap();
                    *n += 1;
                    let antwort =
                        json!({ "server_id": format!("s{n}"), "geheimnis": format!("g{n}") });
                    return (StatusCode::OK, axum::Json(antwort)).into_response();
                }
                let (status, rumpf) = antworten
                    .lock()
                    .unwrap()
                    .pop_front()
                    .unwrap_or((200, json!({ "ergebnisse": ["zugestellt"] })));
                (StatusCode::from_u16(status).unwrap(), axum::Json(rumpf)).into_response()
            }
        });
        let lauscher = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let adresse = lauscher.local_addr().unwrap();
        tokio::spawn(async move { axum::serve(lauscher, app).await.unwrap() });
        (format!("http://{adresse}"), gesehen)
    }

    fn nachricht() -> RelaisNachricht {
        RelaisNachricht {
            token: "tok".into(),
            umgebung: Umgebung::Sandbox,
            stufe: Stufe::Alarm,
            kollaps: None,
            nutzlast: "xyz".into(),
        }
    }

    fn pfade(g: &Gesehen) -> Vec<String> {
        g.lock()
            .unwrap()
            .iter()
            .map(|(p, _, _)| p.clone())
            .collect()
    }

    async fn aufbau(antworten: Vec<(u16, Value)>) -> (sqlx::SqlitePool, IosPush, Gesehen) {
        let pool = crate::db::test_pool().await;
        let (basis, gesehen) = relais_doppel(Arc::new(Mutex::new(antworten.into()))).await;
        let ios = IosPush::einrichten_fuer_test(pool.clone(), basis.parse().unwrap()).unwrap();
        (pool, ios, gesehen)
    }

    #[tokio::test]
    async fn ohne_bedarf_kein_kontakt_zum_relais() {
        let (pool, _ios, gesehen) = aufbau(vec![]).await;
        tokio::time::sleep(std::time::Duration::from_millis(100)).await;
        assert!(pfade(&gesehen).is_empty());
        assert!(repo::relais_zugang(&pool).await.unwrap().is_none());
    }

    #[tokio::test]
    async fn erster_versand_registriert_einmal() {
        let (pool, ios, gesehen) = aufbau(vec![]).await;
        let e = ios.senden(&[nachricht()]).await.unwrap();
        assert_eq!(e.len(), 1);
        ios.senden(&[nachricht()]).await.unwrap();
        assert_eq!(pfade(&gesehen), ["/v1/server", "/v1/senden", "/v1/senden"]);
        let g = gesehen.lock().unwrap();
        assert_eq!(g[0].2["version"], env!("CARGO_PKG_VERSION"));
        assert_eq!(g[1].1.as_deref(), Some("Bearer s1.g1"));
        assert_eq!(g[1].2["nachrichten"][0]["umgebung"], "sandbox");
        assert_eq!(g[1].2["nachrichten"][0]["stufe"], "alarm");
        drop(g);
        let z = repo::relais_zugang(&pool).await.unwrap().unwrap();
        assert_eq!(z.server_id, "s1");
    }

    #[tokio::test]
    async fn unbekannt_401_fuehrt_zu_neuer_registrierung() {
        let (pool, ios, gesehen) = aufbau(vec![(401, json!({ "fehler": "unbekannt" }))]).await;
        repo::relais_zugang_speichern(
            &pool,
            &RelaisZugang {
                server_id: "alt".into(),
                geheimnis: "alt".into(),
                gesperrt: false,
                sperre_abgelaufen: false,
            },
        )
        .await
        .unwrap();
        let e = ios.senden(&[nachricht()]).await.unwrap();
        assert_eq!(e.len(), 1);
        assert_eq!(pfade(&gesehen), ["/v1/senden", "/v1/server", "/v1/senden"]);
        assert_eq!(
            gesehen.lock().unwrap()[2].1.as_deref(),
            Some("Bearer s1.g1")
        );
        assert_eq!(
            repo::relais_zugang(&pool).await.unwrap().unwrap().server_id,
            "s1"
        );
    }

    #[tokio::test]
    async fn gesperrt_403_merkt_sperre_und_registriert_nicht_neu() {
        let (pool, ios, gesehen) = aufbau(vec![(403, json!({ "fehler": "gesperrt" }))]).await;
        let f = ios.senden(&[nachricht()]).await.unwrap_err();
        assert!(matches!(f, RelaisFehler::Gesperrt), "{f:?}");
        assert!(repo::relais_zugang(&pool).await.unwrap().unwrap().gesperrt);
        // Danach kein weiterer Kontakt zum Relais.
        let f = ios.senden(&[nachricht()]).await.unwrap_err();
        assert!(matches!(f, RelaisFehler::Gesperrt), "{f:?}");
        assert_eq!(pfade(&gesehen), ["/v1/server", "/v1/senden"]);
    }

    /// Ein gespeicherter Zugang, den das Relais vor `stunden` Stunden gesperrt hat.
    async fn gesperrt_vor(pool: &sqlx::SqlitePool, stunden: i64) {
        repo::relais_zugang_speichern(
            pool,
            &RelaisZugang {
                server_id: "s0".into(),
                geheimnis: "g0".into(),
                gesperrt: true,
                sperre_abgelaufen: false,
            },
        )
        .await
        .unwrap();
        sqlx::query(
            "UPDATE ios_push_relais \
             SET gesperrt_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now', ?)",
        )
        .bind(format!("-{stunden} hours"))
        .execute(pool)
        .await
        .unwrap();
    }

    /// Ob die Sperre in der letzten Minute gesetzt oder erneuert wurde.
    async fn gerade_gesperrt(pool: &sqlx::SqlitePool) -> bool {
        sqlx::query_scalar(
            "SELECT datetime(gesperrt_at) > datetime('now', '-1 minute') \
             FROM ios_push_relais WHERE id = 1",
        )
        .fetch_one(pool)
        .await
        .unwrap()
    }

    #[tokio::test]
    async fn sperre_juenger_als_einen_tag_kein_kontakt() {
        let (pool, ios, gesehen) = aufbau(vec![]).await;
        gesperrt_vor(&pool, 23).await;
        let f = ios.senden(&[nachricht()]).await.unwrap_err();
        assert!(matches!(f, RelaisFehler::Gesperrt), "{f:?}");
        assert!(pfade(&gesehen).is_empty());
    }

    #[tokio::test]
    async fn abgelaufene_sperre_versucht_einmal_und_freigegeben_hebt_sie_auf() {
        let (pool, ios, gesehen) = aufbau(vec![]).await;
        gesperrt_vor(&pool, 25).await;
        let e = ios.senden(&[nachricht()]).await.unwrap();
        assert_eq!(e.len(), 1);
        assert_eq!(pfade(&gesehen), ["/v1/senden"], "keine Neuregistrierung");
        assert_eq!(
            gesehen.lock().unwrap()[0].1.as_deref(),
            Some("Bearer s0.g0"),
            "mit dem gespeicherten Zugang"
        );
        assert!(!repo::relais_zugang(&pool).await.unwrap().unwrap().gesperrt);
        ios.senden(&[nachricht()]).await.unwrap();
        assert_eq!(pfade(&gesehen), ["/v1/senden", "/v1/senden"]);
    }

    #[tokio::test]
    async fn abgelaufene_sperre_wieder_gesperrt_erneuert_den_zeitpunkt() {
        let (pool, ios, gesehen) = aufbau(vec![(403, json!({ "fehler": "gesperrt" }))]).await;
        gesperrt_vor(&pool, 25).await;
        let f = ios.senden(&[nachricht()]).await.unwrap_err();
        assert!(matches!(f, RelaisFehler::Gesperrt), "{f:?}");
        assert_eq!(pfade(&gesehen), ["/v1/senden"], "keine Neuregistrierung");
        assert!(repo::relais_zugang(&pool).await.unwrap().unwrap().gesperrt);
        assert!(gerade_gesperrt(&pool).await, "gesperrt_at erneuert");
        // Die erneuerte Sperre gilt wieder einen Tag: kein weiterer Kontakt.
        let f = ios.senden(&[nachricht()]).await.unwrap_err();
        assert!(matches!(f, RelaisFehler::Gesperrt), "{f:?}");
        assert_eq!(pfade(&gesehen), ["/v1/senden"]);
    }
}

// ---- Klartext, Kürzung, Kollaps (Aufgabe 7) ----

mod nutzlast {
    use crate::benachrichtigung::BenachrichtigungStufe;
    use crate::ios_push::inhalt::{kuerzen, Klartext};
    use crate::ios_push::krypto::{entschluesseln, umschlag_lesen};
    use crate::ios_push::{kollaps, nutzlast_bauen, UMSCHLAG_MAX};

    fn klartext(detail: Option<&str>, wortlaut: Option<&str>) -> Klartext {
        Klartext {
            v: 1,
            s: "ELW 1".into(),
            e: 4,
            b: 77,
            stufe: BenachrichtigungStufe::Alarm,
            titel: "Sofortmeldung".into(),
            detail: detail.map(str::to_owned),
            pfad: "/einsaetze/4/meldungen?meldung=9".into(),
            absender: Some("Florian Nord 1".into()),
            wortlaut: wortlaut.map(str::to_owned),
        }
    }

    fn groesse(k: &Klartext) -> usize {
        serde_json::to_vec(k).unwrap().len() + 16
    }

    #[test]
    fn klartext_traegt_die_feldnamen_des_entwurfs() {
        let v = serde_json::to_value(klartext(None, Some("x"))).unwrap();
        let mut felder: Vec<&String> = v.as_object().unwrap().keys().collect();
        felder.sort_unstable();
        assert_eq!(
            felder,
            ["absender", "b", "e", "pfad", "s", "stufe", "titel", "v", "wortlaut"]
        );
        assert_eq!(v["stufe"], "alarm");
    }

    #[test]
    fn kuerzen_schneidet_den_wortlaut_an_einer_zeichengrenze() {
        let lang = "ä🚑".repeat(10_000);
        let mut k = klartext(Some("Meldung 9"), Some(&lang));
        kuerzen(&mut k, 1000);
        assert!(groesse(&k) <= 1000, "{}", groesse(&k));
        let w = k.wortlaut.as_deref().unwrap();
        let anfang = w.strip_suffix('…').unwrap();
        assert!(lang.starts_with(anfang));
        assert!(
            groesse(&k) > 900,
            "nicht mehr als nötig gekürzt: {}",
            groesse(&k)
        );
        assert_eq!(k.detail.as_deref(), Some("Meldung 9"), "Detail bleibt");
    }

    #[test]
    fn kuerzen_laesst_einen_passenden_klartext_unveraendert() {
        let mut k = klartext(Some("Meldung 9"), Some("kurz"));
        let vorher = k.clone();
        kuerzen(&mut k, 4096);
        assert_eq!(k, vorher);
    }

    #[test]
    fn kuerzen_nimmt_danach_das_detail() {
        let lang = "x".repeat(2000);
        let mut k = klartext(Some(&lang), Some(&lang));
        kuerzen(&mut k, 600);
        assert!(groesse(&k) <= 600, "{}", groesse(&k));
        assert_eq!(k.wortlaut, None, "Wortlaut zuerst weg");
        assert!(k.detail.as_deref().unwrap().ends_with('…'));
    }

    #[test]
    fn nutzlast_bleibt_unter_der_grenze_und_ist_entschluesselbar() {
        let lang = "ä🚑".repeat(10_000);
        let schluessel = [9u8; 32];
        let kennung = "6f1c2a64-3b1e-4a55-9c1d-0d3b5a7e9f10";
        let mut k = klartext(Some("Meldung 9"), Some(&lang));
        let n = nutzlast_bauen(kennung, &schluessel, &mut k).unwrap();
        assert!(n.len() <= UMSCHLAG_MAX, "{}", n.len());
        const { assert!(UMSCHLAG_MAX <= 4096) };
        let (k2, nonce, chiffrat) = umschlag_lesen(&n).unwrap();
        assert_eq!(k2, kennung);
        let klar = entschluesseln(&schluessel, kennung, &nonce, &chiffrat).unwrap();
        let v: serde_json::Value = serde_json::from_slice(&klar).unwrap();
        assert!(v["wortlaut"].as_str().unwrap().ends_with('…'));
        // Mit falscher Kennung (AAD) nicht entschlüsselbar.
        assert!(entschluesseln(&schluessel, "andere", &nonce, &chiffrat).is_err());
    }

    #[test]
    fn zwei_nutzlasten_haben_verschiedene_nonces() {
        let schluessel = [9u8; 32];
        let kennung = "6f1c2a64-3b1e-4a55-9c1d-0d3b5a7e9f10";
        let a = nutzlast_bauen(kennung, &schluessel, &mut klartext(None, None)).unwrap();
        let b = nutzlast_bauen(kennung, &schluessel, &mut klartext(None, None)).unwrap();
        assert_ne!(umschlag_lesen(&a).unwrap().1, umschlag_lesen(&b).unwrap().1);
    }

    #[test]
    fn kollaps_ist_ein_kurzer_hash_ohne_kennungen() {
        let k = kollaps("s1", 77);
        assert_eq!(k.len(), 32);
        assert!(k
            .chars()
            .all(|c| c.is_ascii_hexdigit() && !c.is_ascii_uppercase()));
        assert_eq!(k, kollaps("s1", 77));
        assert_ne!(k, kollaps("s1", 78));
        assert_ne!(k, kollaps("s2", 77));
        // sha256("s1:77"), erste 32 Hex-Zeichen.
        use sha2::{Digest, Sha256};
        let voll: String = Sha256::digest(b"s1:77")
            .iter()
            .map(|x| format!("{x:02x}"))
            .collect();
        assert_eq!(k, voll[..32]);
    }
}

/// Der Klartext, wie Rust ihn serialisiert, gegen die gemeinsamen Fälle mit der iOS-Seite
/// (`src-tauri/faelle/push-inhalt.json`, Swift: `PushNutzlastTests`).
#[test]
fn klartext_passt_zu_den_gemeinsamen_faellen() {
    use super::inhalt::Klartext;
    use crate::benachrichtigung::BenachrichtigungStufe;

    let datei: serde_json::Value =
        serde_json::from_str(include_str!("../../src-tauri/faelle/push-inhalt.json")).unwrap();
    let faelle = datei["faelle"].as_array().unwrap();
    assert_eq!(faelle.len(), 3);
    for fall in faelle {
        let k = &fall["klartext"];
        let text = |f: &str| k.get(f).map(|v| v.as_str().unwrap().to_owned());
        let klartext = Klartext {
            v: k["v"].as_u64().unwrap() as u8,
            s: text("s").unwrap(),
            e: k["e"].as_i64().unwrap(),
            b: k["b"].as_i64().unwrap(),
            stufe: match k["stufe"].as_str().unwrap() {
                "alarm" => BenachrichtigungStufe::Alarm,
                "hinweis" => BenachrichtigungStufe::Hinweis,
                _ => BenachrichtigungStufe::Still,
            },
            titel: text("titel").unwrap(),
            detail: text("detail"),
            pfad: text("pfad").unwrap(),
            absender: text("absender"),
            wortlaut: text("wortlaut"),
        };
        assert_eq!(
            &serde_json::to_value(&klartext).unwrap(),
            k,
            "{}",
            fall["beschreibung"]
        );
    }
}
