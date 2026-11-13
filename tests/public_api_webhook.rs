//! Webhooks aus der Outbox (LLH-1656, Spec `webhook-zustellung`): Tabellen, Lesen der nächsten
//! fälligen Zeile und der Lauf, gegen die Funktionen aus `public_api::webhook` mit einem
//! aufzeichnenden Zusteller und gesteuerter Zeit.
//!
//! Die Ereignisse entstehen wie im Betrieb über die Trigger an Freigabe und Einsatzkopf. Direkt
//! in die Outbox schreibt hier niemand.

use std::collections::VecDeque;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use chrono::{DateTime, Duration, Utc};
use lifeline_hub::instanz::identitaet::{self, parse_oeffentlich};
use lifeline_hub::instanz::signatur::verify_webhook;
use lifeline_hub::public_api::events::{self, EventType, Naechstes};
use lifeline_hub::public_api::scope::Scope;
use lifeline_hub::public_api::webhook::lauf::{durchgang, starte, testereignis};
use lifeline_hub::public_api::webhook::repo::{self, Eingabe, Webhook};
use lifeline_hub::public_api::webhook::ziel::{Ergebnis, Zusteller, Zustellung};
use lifeline_hub::public_api::webhook::{WebhookFehler, VERLAUF_MAX};
use lifeline_hub::public_api::{freigabe, zugang};
use sqlx::SqlitePool;

const ALLE_LESE_SCOPES: &[Scope] = &[Scope::EventsRead, Scope::EinsaetzeRead, Scope::LageRead];

struct Org {
    pool: SqlitePool,
    id: i64,
    leitung: i64,
}

async fn org() -> Org {
    let pool = lifeline_hub::db::test_pool().await;
    let id: i64 =
        sqlx::query_scalar("INSERT INTO organisation (name) VALUES ('Test-Orga') RETURNING id")
            .fetch_one(&pool)
            .await
            .unwrap();
    let leitung: i64 = sqlx::query_scalar(
        "INSERT INTO benutzer (org_id, anzeigename, benutzername, passwort_hash) \
         VALUES (?, 'Leitung', 'leitung', 'x') RETURNING id",
    )
    .bind(id)
    .fetch_one(&pool)
    .await
    .unwrap();
    Org { pool, id, leitung }
}

/// Ein aktiver Zugang (Schlüssel gebunden) mit den Scopes.
async fn zugang_mit(o: &Org, name: &str, scopes: &[Scope]) -> String {
    let id = zugang::anlegen(
        &mut *o.pool.acquire().await.unwrap(),
        o.id,
        name,
        scopes,
        None,
        None,
        &lifeline_hub::zeit::jetzt(),
    )
    .await
    .unwrap();
    sqlx::query("UPDATE maschinenzugang SET zustand = 'aktiv' WHERE id = ?")
        .bind(&id)
        .execute(&o.pool)
        .await
        .unwrap();
    id
}

async fn webhook_anlegen(o: &Org, zugang_id: &str, arten: &[EventType]) -> Webhook {
    let mut conn = o.pool.acquire().await.unwrap();
    repo::anlegen(
        &mut conn,
        zugang_id,
        &Eingabe {
            url: "https://empfaenger.example/hook".into(),
            arten: arten.to_vec(),
            lan_erlaubt: false,
        },
        &lifeline_hub::zeit::jetzt(),
    )
    .await
    .unwrap()
}

async fn webhook(o: &Org, zugang_id: &str) -> Webhook {
    let mut conn = o.pool.acquire().await.unwrap();
    repo::laden_fuer_zugang(&mut conn, zugang_id)
        .await
        .unwrap()
        .unwrap()
}

/// Laufender Einsatz, für den Zugang freigegeben: schreibt `einsatz.created` und `lage.changed`.
async fn einsatz_freigeben(o: &Org, zugang_id: &str) -> i64 {
    let einsatz: i64 = sqlx::query_scalar(
        "INSERT INTO einsatz (org_id, bezeichnung) VALUES (?, 'Hochwasser') RETURNING id",
    )
    .bind(o.id)
    .fetch_one(&o.pool)
    .await
    .unwrap();
    freigabe::freigeben_tx(
        &mut *o.pool.acquire().await.unwrap(),
        zugang_id,
        einsatz,
        o.leitung,
    )
    .await
    .unwrap();
    einsatz
}

/// Ändert die Bezeichnung: schreibt `einsatz.updated` (und ersetzt `lage.changed`).
async fn kopf_aendern(o: &Org, einsatz: i64, n: usize) {
    sqlx::query("UPDATE einsatz SET bezeichnung = ? WHERE id = ?")
        .bind(format!("Hochwasser {n}"))
        .bind(einsatz)
        .execute(&o.pool)
        .await
        .unwrap();
}

/// Zeichnet jede Zustellung auf und antwortet je nach Schalter mit 204 oder einem Netzfehler.
#[derive(Default)]
struct Aufzeichner {
    erreichbar: AtomicBool,
    gesendet: Mutex<Vec<(Zustellung, bool)>>,
    /// Feste Antworten, die vor dem Schalter gelten (für einzelne Status).
    vorgaben: Mutex<VecDeque<Ergebnis>>,
}

impl Aufzeichner {
    fn neu(erreichbar: bool) -> Arc<Self> {
        let a = Self::default();
        a.erreichbar.store(erreichbar, Ordering::SeqCst);
        Arc::new(a)
    }
    fn erfolgreiche_ids(&self) -> Vec<i64> {
        self.gesendet
            .lock()
            .unwrap()
            .iter()
            .filter(|(_, ok)| *ok)
            .filter_map(|(z, _)| z.ereignis_id)
            .collect()
    }
    fn anzahl(&self) -> usize {
        self.gesendet.lock().unwrap().len()
    }
}

impl Zusteller for Aufzeichner {
    async fn senden(&self, z: Zustellung) -> Ergebnis {
        let ergebnis = self
            .vorgaben
            .lock()
            .unwrap()
            .pop_front()
            .unwrap_or_else(|| {
                if self.erreichbar.load(Ordering::SeqCst) {
                    Ergebnis {
                        status: Some(204),
                        fehler: None,
                        dauer_ms: 3,
                    }
                } else {
                    Ergebnis {
                        status: None,
                        fehler: Some(WebhookFehler::Verbindung),
                        dauer_ms: 5000,
                    }
                }
            });
        self.gesendet
            .lock()
            .unwrap()
            .push((z, ergebnis.is_erfolg()));
        ergebnis
    }
}

/// Spielt Durchgänge im Abstand `schritt` von `von` bis einschließlich `bis`.
async fn durchgaenge(
    pool: &SqlitePool,
    z: &Arc<Aufzeichner>,
    von: DateTime<Utc>,
    bis: DateTime<Utc>,
    schritt: Duration,
) {
    let mut t = von;
    while t <= bis {
        durchgang(pool, z, t).await.unwrap();
        t += schritt;
    }
}

// ---------------------------------------------------------------- 1.1 Tabellen

#[tokio::test]
async fn ein_webhook_je_zugang_und_er_geht_mit_dem_zugang() {
    let o = org().await;
    let z = zugang_mit(&o, "Einsatzbuch", ALLE_LESE_SCOPES).await;
    webhook_anlegen(&o, &z, &[EventType::EinsatzCreated]).await;

    let zweiter = repo::anlegen(
        &mut *o.pool.acquire().await.unwrap(),
        &z,
        &Eingabe {
            url: "https://anderer.example/".into(),
            arten: vec![EventType::EinsatzClosed],
            lan_erlaubt: false,
        },
        &lifeline_hub::zeit::jetzt(),
    )
    .await;
    assert!(matches!(
        zweiter,
        Err(lifeline_hub::error::AppError::Conflict(_))
    ));
    // Auch an der Datenbank vorbei hält der UNIQUE-Index.
    let direkt = sqlx::query(
        "INSERT INTO maschine_webhook (id, zugang_id, url, arten, cursor) \
         VALUES ('x', ?, 'https://a.example/', '[]', 0)",
    )
    .bind(&z)
    .execute(&o.pool)
    .await;
    assert!(direkt.is_err());

    sqlx::query("DELETE FROM maschinenzugang WHERE id = ?")
        .bind(&z)
        .execute(&o.pool)
        .await
        .unwrap();
    let rest: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM maschine_webhook")
        .fetch_one(&o.pool)
        .await
        .unwrap();
    assert_eq!(rest, 0);
}

#[tokio::test]
async fn neuer_webhook_beginnt_beim_hoechststand() {
    let o = org().await;
    let z = zugang_mit(&o, "Einsatzbuch", ALLE_LESE_SCOPES).await;
    einsatz_freigeben(&o, &z).await;
    let w = webhook_anlegen(&o, &z, &EventType::ALLE).await;
    assert_eq!(w.cursor, events::hoechststand(&o.pool).await.unwrap());
    assert!(w.cursor > 0);
}

// ---------------------------------------------------------------- 4.1 Lesen

#[tokio::test]
async fn naechstes_liest_nur_eigene_und_gewaehlte_zeilen() {
    let o = org().await;
    let a = zugang_mit(&o, "A", ALLE_LESE_SCOPES).await;
    let b = zugang_mit(&o, "B", ALLE_LESE_SCOPES).await;
    let ea = einsatz_freigeben(&o, &a).await;
    einsatz_freigeben(&o, &b).await;

    // A: zuerst `einsatz.created`.
    let Naechstes::Ereignis(erstes) = events::naechstes(&o.pool, &a, &EventType::ALLE, 0, None)
        .await
        .unwrap()
    else {
        panic!("Ereignis erwartet");
    };
    assert_eq!(erstes.event_type, EventType::EinsatzCreated);
    assert_eq!(erstes.einsatz_id, ea);

    // Nur `einsatz.closed` gewählt: nichts fällig, und die eigenen Zeilen sind übersprungen.
    let eigene_hoechste: i64 =
        sqlx::query_scalar("SELECT MAX(id) FROM maschine_ereignis WHERE zugang_id = ?")
            .bind(&a)
            .fetch_one(&o.pool)
            .await
            .unwrap();
    assert_eq!(
        events::naechstes(&o.pool, &a, &[EventType::EinsatzClosed], 0, None)
            .await
            .unwrap(),
        Naechstes::Leer {
            uebersprungen_bis: Some(eigene_hoechste)
        }
    );

    // Nach allen Zeilen von A: nichts, auch wenn B noch Zeilen hat.
    let hoechste_a: i64 =
        sqlx::query_scalar("SELECT MAX(id) FROM maschine_ereignis WHERE zugang_id = ?")
            .bind(&a)
            .fetch_one(&o.pool)
            .await
            .unwrap();
    assert_eq!(
        events::naechstes(&o.pool, &a, &EventType::ALLE, hoechste_a, None)
            .await
            .unwrap(),
        Naechstes::Leer {
            uebersprungen_bis: None
        }
    );
}

#[tokio::test]
async fn ersetztes_lage_changed_kommt_mit_neuer_nummer() {
    let o = org().await;
    let z = zugang_mit(&o, "A", ALLE_LESE_SCOPES).await;
    let e = einsatz_freigeben(&o, &z).await;
    let Naechstes::Ereignis(alt) =
        events::naechstes(&o.pool, &z, &[EventType::LageChanged], 0, None)
            .await
            .unwrap()
    else {
        panic!("lage.changed erwartet");
    };
    kopf_aendern(&o, e, 1).await;
    let Naechstes::Ereignis(neu) =
        events::naechstes(&o.pool, &z, &[EventType::LageChanged], 0, None)
            .await
            .unwrap()
    else {
        panic!("lage.changed erwartet");
    };
    assert!(neu.id > alt.id);
}

#[tokio::test]
async fn verlust_nur_wenn_das_wartende_ereignis_geloescht_ist() {
    let o = org().await;
    let z = zugang_mit(&o, "A", ALLE_LESE_SCOPES).await;
    einsatz_freigeben(&o, &z).await;
    let (_, purged_vorher) = {
        let mut c = o.pool.acquire().await.unwrap();
        events::stand_lesen(&mut c).await.unwrap()
    };
    assert_eq!(purged_vorher, 0);

    // Alles löschen (Zeitpunkt weit in der Zukunft).
    events::purge(&o.pool, "2099-01-01 00:00:00").await.unwrap();
    let head = events::hoechststand(&o.pool).await.unwrap();

    // Ohne wartendes Ereignis ist ein Cursor unter der Löschgrenze kein Verlust.
    assert_eq!(
        events::naechstes(&o.pool, &z, &EventType::ALLE, 0, None)
            .await
            .unwrap(),
        Naechstes::Leer {
            uebersprungen_bis: None
        }
    );
    // Wartete Ereignis 1, ist es verloren.
    assert_eq!(
        events::naechstes(&o.pool, &z, &EventType::ALLE, 0, Some(1))
            .await
            .unwrap(),
        Naechstes::Verloren { head }
    );
}

// ---------------------------------------------------------------- 4.3 Lauf

/// Drei Ereignisse an einem Zugang, dessen Webhook vorher angelegt wurde.
async fn drei_ereignisse(o: &Org) -> (String, Webhook) {
    let z = zugang_mit(o, "Einsatzbuch", ALLE_LESE_SCOPES).await;
    let w = webhook_anlegen(o, &z, &EventType::ALLE).await;
    let e = einsatz_freigeben(o, &z).await; // created, lage.changed
    kopf_aendern(o, e, 1).await; // updated, lage.changed ersetzt
    (z, w)
}

#[tokio::test]
async fn stellt_der_reihe_nach_zu_signiert_und_wie_im_abruf() {
    let o = org().await;
    let (z, w) = drei_ereignisse(&o).await;
    let auf = Aufzeichner::neu(true);
    durchgang(&o.pool, &auf, Utc::now()).await.unwrap();

    let erwartet = events::lesen(&o.pool, &z, ALLE_LESE_SCOPES, Some(w.cursor))
        .await
        .unwrap()
        .events;
    assert_eq!(erwartet.len(), 3);
    let gesendet = auf.gesendet.lock().unwrap().clone();
    assert_eq!(gesendet.len(), 3);

    let pk = parse_oeffentlich(
        &identitaet::load_or_create(&o.pool)
            .await
            .unwrap()
            .oeffentlich_b64(),
    )
    .unwrap();
    for ((zustellung, ok), ereignis) in gesendet.iter().zip(&erwartet) {
        assert!(ok);
        assert_eq!(zustellung.ereignis_id, Some(ereignis.id));
        assert_eq!(zustellung.body, serde_json::to_vec(ereignis).unwrap());
        verify_webhook(
            &zustellung.signatur,
            &pk,
            &w.id,
            &zustellung.body,
            Utc::now().timestamp(),
        )
        .expect("Signatur gilt für diesen Webhook");
        assert!(verify_webhook(
            &zustellung.signatur,
            &pk,
            "anderer-webhook",
            &zustellung.body,
            Utc::now().timestamp()
        )
        .is_err());
    }
    let nachher = webhook(&o, &z).await;
    assert_eq!(nachher.cursor, erwartet.last().unwrap().id);
    assert_eq!(nachher.offen_id, None);
    assert!(nachher.letzter_erfolg_at.is_some());
}

#[tokio::test]
async fn zwei_stunden_unerreichbar_danach_alles_in_reihenfolge() {
    let o = org().await;
    let (z, w) = drei_ereignisse(&o).await;
    let erwartet: Vec<i64> = events::lesen(&o.pool, &z, ALLE_LESE_SCOPES, Some(w.cursor))
        .await
        .unwrap()
        .events
        .iter()
        .map(|e| e.id)
        .collect();
    let auf = Aufzeichner::neu(false);
    let t0 = Utc::now();
    // Zwei Stunden lang jede Minute ein Durchgang, das Ziel antwortet nicht.
    durchgaenge(
        &o.pool,
        &auf,
        t0,
        t0 + Duration::hours(2),
        Duration::minutes(1),
    )
    .await;
    assert!(auf.erfolgreiche_ids().is_empty());
    // Versuche bei 0, 1, 3, 7, 15, 31, 63 min.
    assert_eq!(auf.anzahl(), 7);
    let w2 = webhook(&o, &z).await;
    assert!(w2.fehler_seit.is_some());
    assert_eq!(w2.offen_id, Some(erwartet[0]));

    // Wieder erreichbar: beim Versuch nach 127 min kommt alles der Reihe nach.
    auf.erreichbar.store(true, Ordering::SeqCst);
    durchgaenge(
        &o.pool,
        &auf,
        t0 + Duration::minutes(121),
        t0 + Duration::minutes(130),
        Duration::minutes(1),
    )
    .await;
    assert_eq!(auf.erfolgreiche_ids(), erwartet);
    let w3 = webhook(&o, &z).await;
    assert_eq!(w3.fehler_seit, None);
    assert_eq!(w3.fehlversuche, 0);
}

#[tokio::test]
async fn nach_24_stunden_angehalten_und_danach_kein_versuch() {
    let o = org().await;
    let (z, _) = drei_ereignisse(&o).await;
    let auf = Aufzeichner::neu(false);
    let t0 = Utc::now();
    durchgaenge(
        &o.pool,
        &auf,
        t0,
        t0 + Duration::hours(25),
        Duration::minutes(10),
    )
    .await;
    let w = webhook(&o, &z).await;
    assert!(w.is_angehalten());
    assert!(w.angehalten_at.is_some());
    assert_eq!(w.letzter_fehler(), Some(WebhookFehler::Verbindung));
    let versuche = auf.anzahl();
    durchgaenge(
        &o.pool,
        &auf,
        t0 + Duration::hours(26),
        t0 + Duration::hours(40),
        Duration::hours(1),
    )
    .await;
    assert_eq!(
        auf.anzahl(),
        versuche,
        "angehalten heißt: kein Versuch mehr"
    );
}

#[tokio::test]
async fn ruhender_zugang_bekommt_nichts_und_der_cursor_bleibt() {
    for (fall, sql) in [
        (
            "widerrufen",
            "UPDATE maschinenzugang SET zustand = 'widerrufen' WHERE id = ?",
        ),
        (
            "abgelaufen",
            "UPDATE maschinenzugang SET gueltig_bis = '2000-01-01 00:00:00' WHERE id = ?",
        ),
        (
            "ohne events:read",
            "UPDATE maschinenzugang SET scopes = '[\"einsaetze:read\",\"lage:read\"]' WHERE id = ?",
        ),
    ] {
        let o = org().await;
        let z = zugang_mit(&o, "A", ALLE_LESE_SCOPES).await;
        let w = webhook_anlegen(&o, &z, &EventType::ALLE).await;
        let e = einsatz_freigeben(&o, &z).await;
        kopf_aendern(&o, e, 1).await;
        sqlx::query(sql).bind(&z).execute(&o.pool).await.unwrap();
        let auf = Aufzeichner::neu(true);
        durchgang(&o.pool, &auf, Utc::now()).await.unwrap();
        assert_eq!(auf.anzahl(), 0, "{fall}");
        let nachher = webhook(&o, &z).await;
        assert_eq!(nachher.cursor, w.cursor, "{fall}");
    }
}

#[tokio::test]
async fn grosser_rueckstand_teilt_sich_auf_und_laesst_andere_dran() {
    let o = org().await;
    let a = zugang_mit(&o, "A", ALLE_LESE_SCOPES).await;
    let b = zugang_mit(&o, "B", ALLE_LESE_SCOPES).await;
    webhook_anlegen(&o, &a, &[EventType::EinsatzUpdated]).await;
    webhook_anlegen(&o, &b, &[EventType::EinsatzUpdated]).await;
    let ea = einsatz_freigeben(&o, &a).await;
    let eb = einsatz_freigeben(&o, &b).await;
    for n in 0..60 {
        kopf_aendern(&o, ea, n).await;
    }
    kopf_aendern(&o, eb, 1).await;

    let auf = Aufzeichner::neu(true);
    durchgang(&o.pool, &auf, Utc::now()).await.unwrap();
    let nach_einem = auf.gesendet.lock().unwrap().clone();
    let einsatz_von = |z: &Zustellung| -> i64 {
        serde_json::from_slice::<serde_json::Value>(&z.body).unwrap()["einsatz_id"]
            .as_i64()
            .unwrap()
    };
    let fuer_a = nach_einem
        .iter()
        .filter(|(z, _)| einsatz_von(z) == ea)
        .count();
    let fuer_b = nach_einem
        .iter()
        .filter(|(z, _)| einsatz_von(z) == eb)
        .count();
    assert_eq!(fuer_a, 50, "A höchstens 50 je Durchgang");
    assert_eq!(fuer_b, 1, "B kommt im selben Durchgang dran");

    durchgang(&o.pool, &auf, Utc::now()).await.unwrap();
    assert_eq!(auf.anzahl(), 61);

    // Der Verlauf hält höchstens VERLAUF_MAX Einträge.
    let w = webhook(&o, &a).await;
    let verlauf = repo::versuche(&mut *o.pool.acquire().await.unwrap(), &w.id)
        .await
        .unwrap();
    assert_eq!(verlauf.len() as i64, VERLAUF_MAX);
    let gespeichert: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM maschine_webhook_versuch WHERE webhook_id = ?")
            .bind(&w.id)
            .fetch_one(&o.pool)
            .await
            .unwrap();
    assert_eq!(gespeichert, VERLAUF_MAX);
}

#[tokio::test]
async fn verlorenes_ereignis_springt_auf_den_stand_und_haelt_es_fest() {
    let o = org().await;
    let (z, _) = drei_ereignisse(&o).await;
    let auf = Aufzeichner::neu(false);
    durchgang(&o.pool, &auf, Utc::now()).await.unwrap();
    assert!(webhook(&o, &z).await.offen_id.is_some());

    events::purge(&o.pool, "2099-01-01 00:00:00").await.unwrap();
    auf.erreichbar.store(true, Ordering::SeqCst);
    // Der nächste Versuch ist nach einer Minute fällig.
    durchgang(&o.pool, &auf, Utc::now() + Duration::minutes(2))
        .await
        .unwrap();
    let w = webhook(&o, &z).await;
    assert!(w.verlust_at.is_some());
    assert_eq!(w.offen_id, None);
    assert_eq!(w.cursor, events::hoechststand(&o.pool).await.unwrap());
    assert!(auf.erfolgreiche_ids().is_empty());
}

#[tokio::test]
async fn testereignis_aendert_weder_cursor_noch_zustand() {
    let o = org().await;
    let (z, _) = drei_ereignisse(&o).await;
    let auf = Aufzeichner::neu(false);
    durchgang(&o.pool, &auf, Utc::now()).await.unwrap();
    let vorher = webhook(&o, &z).await;

    auf.vorgaben.lock().unwrap().push_back(Ergebnis {
        status: Some(204),
        fehler: None,
        dauer_ms: 4,
    });
    let ergebnis = testereignis(&o.pool, &*auf, &vorher, Utc::now())
        .await
        .unwrap();
    assert!(ergebnis.is_erfolg());
    let nachher = webhook(&o, &z).await;
    assert_eq!(nachher, vorher);

    let (ping, _) = auf.gesendet.lock().unwrap().last().unwrap().clone();
    assert_eq!(ping.ereignis_id, None);
    let body: serde_json::Value = serde_json::from_slice(&ping.body).unwrap();
    assert_eq!(body["type"], "ping");

    let mut conn = o.pool.acquire().await.unwrap();
    let verlauf = repo::versuche(&mut conn, &vorher.id).await.unwrap();
    assert!(verlauf[0].test);
    assert_eq!(verlauf[0].status, Some(204));
}

#[tokio::test]
async fn stoppsignal_beendet_den_lauf() {
    let o = org().await;
    let (tx, rx) = tokio::sync::watch::channel(false);
    let task = starte(o.pool.clone(), rx);
    tx.send(true).unwrap();
    tokio::time::timeout(std::time::Duration::from_secs(5), task)
        .await
        .expect("Lauf endet binnen der Frist")
        .unwrap();
}

// ---------------------------------------------------------------- Befunde aus dem Review

/// Ruft je Zustellung eine Aktion mit der Nummer des Versuchs auf (ab 1), bevor er antwortet.
struct MitAktion<
    F: Fn(usize) -> futures::future::BoxFuture<'static, Ergebnis> + Send + Sync + 'static,
> {
    aktion: F,
    gesendet: Mutex<Vec<Zustellung>>,
}

impl<F: Fn(usize) -> futures::future::BoxFuture<'static, Ergebnis> + Send + Sync + 'static>
    Zusteller for MitAktion<F>
{
    async fn senden(&self, z: Zustellung) -> Ergebnis {
        let n = {
            let mut g = self.gesendet.lock().unwrap();
            g.push(z);
            g.len()
        };
        (self.aktion)(n).await
    }
}

fn ok() -> Ergebnis {
    Ergebnis {
        status: Some(204),
        fehler: None,
        dauer_ms: 1,
    }
}

fn kaputt() -> Ergebnis {
    Ergebnis {
        status: Some(503),
        fehler: Some(WebhookFehler::Status),
        dauer_ms: 1,
    }
}

#[tokio::test]
async fn nicht_gewaehlte_arten_werden_uebersprungen_und_nie_nachgeliefert() {
    let o = org().await;
    let z = zugang_mit(&o, "A", ALLE_LESE_SCOPES).await;
    webhook_anlegen(&o, &z, &[EventType::EinsatzClosed]).await;
    let e = einsatz_freigeben(&o, &z).await;
    kopf_aendern(&o, e, 1).await;
    let auf = Aufzeichner::neu(true);
    durchgang(&o.pool, &auf, Utc::now()).await.unwrap();
    assert_eq!(auf.anzahl(), 0);
    let w = webhook(&o, &z).await;
    assert_eq!(
        w.cursor,
        events::hoechststand(&o.pool).await.unwrap(),
        "rückt darüber hinweg"
    );

    // Wählt der Admin `einsatz.updated` dazu, kommt das alte nicht nachträglich.
    sqlx::query("UPDATE maschine_webhook SET arten = '[\"einsatz.updated\",\"einsatz.closed\"]'")
        .execute(&o.pool)
        .await
        .unwrap();
    durchgang(&o.pool, &auf, Utc::now()).await.unwrap();
    assert_eq!(auf.anzahl(), 0);
}

#[tokio::test]
async fn nichts_mehr_faellig_beendet_die_stoerung() {
    let o = org().await;
    let (z, _) = drei_ereignisse(&o).await;
    let auf = Aufzeichner::neu(false);
    durchgang(&o.pool, &auf, Utc::now()).await.unwrap();
    let w = webhook(&o, &z).await;
    assert!(w.fehler_seit.is_some() && w.offen_id.is_some());

    // Der Admin wählt alle Arten ab, die anstehen: nichts ist mehr fällig.
    sqlx::query("UPDATE maschine_webhook SET arten = '[\"einsatz.closed\"]'")
        .execute(&o.pool)
        .await
        .unwrap();
    durchgang(&o.pool, &auf, Utc::now() + Duration::minutes(2))
        .await
        .unwrap();
    let w = webhook(&o, &z).await;
    assert_eq!(w.fehler_seit, None);
    assert_eq!(w.fehlversuche, 0);
    assert_eq!(w.naechster_versuch_at, None);
    assert_eq!(w.offen_id, None);
}

#[tokio::test]
async fn widerruf_mitten_im_durchgang_stoppt_die_zustellung() {
    let o = org().await;
    let (z, _) = drei_ereignisse(&o).await;
    let pool = o.pool.clone();
    let zid = z.clone();
    let auf = Arc::new(MitAktion {
        gesendet: Mutex::new(Vec::new()),
        aktion: move |n| {
            let (pool, zid) = (pool.clone(), zid.clone());
            Box::pin(async move {
                if n == 1 {
                    sqlx::query("UPDATE maschinenzugang SET zustand = 'widerrufen' WHERE id = ?")
                        .bind(&zid)
                        .execute(&pool)
                        .await
                        .unwrap();
                }
                ok()
            })
        },
    });
    durchgang(&o.pool, &auf, Utc::now()).await.unwrap();
    assert_eq!(
        auf.gesendet.lock().unwrap().len(),
        1,
        "nach dem Widerruf geht nichts mehr hinaus"
    );
}

#[tokio::test]
async fn fehlschlag_an_ein_altes_ziel_macht_die_ruecksetzung_nicht_rueckgaengig() {
    let o = org().await;
    let (z, _) = drei_ereignisse(&o).await;
    let pool = o.pool.clone();
    let zid = z.clone();
    let auf = Arc::new(MitAktion {
        gesendet: Mutex::new(Vec::new()),
        aktion: move |_| {
            let (pool, zid) = (pool.clone(), zid.clone());
            Box::pin(async move {
                // Während der Versuch läuft, ändert der Admin das Ziel.
                let w = repo::laden_fuer_zugang(&mut *pool.acquire().await.unwrap(), &zid)
                    .await
                    .unwrap()
                    .unwrap();
                repo::aendern(
                    &mut *pool.acquire().await.unwrap(),
                    &zid,
                    Some(&w.geaendert_at),
                    &Eingabe {
                        url: "https://neu.example/hook".into(),
                        arten: w.arten(),
                        lan_erlaubt: false,
                    },
                    "2099-01-01 00:00:00",
                )
                .await
                .unwrap();
                kaputt()
            })
        },
    });
    durchgang(&o.pool, &auf, Utc::now()).await.unwrap();
    let w = webhook(&o, &z).await;
    assert_eq!(w.url, "https://neu.example/hook");
    assert_eq!(w.fehler_seit, None, "der Fehlschlag galt dem alten Ziel");
    assert_eq!(w.fehlversuche, 0);
    // Der Versuch steht trotzdem im Verlauf.
    let verlauf = repo::versuche(&mut *o.pool.acquire().await.unwrap(), &w.id)
        .await
        .unwrap();
    assert_eq!(verlauf.len(), 1);
}
