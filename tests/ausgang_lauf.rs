//! Lauf des Ausgangskorbs (LLH-2093, Spec `docs/superpowers/specs/2026-11-24-w1ymakq6-ausgang-email-design.md`,
//! Abschnitte 2, 3, 4 und 6): fällige Versände zustellen, Ergebnis und ETB in einer Transaktion,
//! Wiederholung, überholte Quellen, Spiegel, angehaltene Anbindung, Neustart, keine Geheimnisse.
//!
//! Zugestellt wird über ein Skript (`Skript`), das die Ergebnisse vorgibt und mitschreibt, was es
//! zustellen sollte. Die Versände legt der Test direkt in `ausgang` an (die Routen kommen
//! später); Anbindung, Passwort, Lagebericht und Anlage entstehen über die echten Routen.

use std::collections::VecDeque;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use axum::http::StatusCode;
use chrono::{DateTime, Utc};
use futures::future::BoxFuture;
use lifeline_hub::adapter::smtp::SmtpFehler;
use lifeline_hub::adapter::Rahmen;
use lifeline_hub::ausgang::lauf::{self, Versandzugang, Zusteller};
use lifeline_hub::ausgang::{AusgangFehler, VersandZeile, VersandZustand};
use lifeline_hub::live::LiveHub;
use serde_json::json;

mod adapter_testart;
mod common;
use common::{anfrage, anfrage_json, einsatz_anlegen_mit, login_cookie, multipart_post, png_bytes};

const PASSWORT: &str = "Geheim-Passwort-4711";
const ADRESSE: &str = "lagedienst@leitstelle.example";
const STELLE: &str = "Leitstelle Nord";

/// Ein Zusteller, der vorgegebene Ergebnisse abspielt (leer heißt angenommen) und mitschreibt.
#[derive(Default)]
struct Skript {
    ergebnisse: Mutex<VecDeque<Result<(), SmtpFehler>>>,
    gesehen: Mutex<Vec<Zustellung>>,
}

#[derive(Debug, Clone)]
struct Zustellung {
    von: String,
    an: String,
    mail: Vec<u8>,
    mit_passwort: bool,
}

impl Skript {
    fn plane(&self, e: Result<(), SmtpFehler>) {
        self.ergebnisse.lock().unwrap().push_back(e);
    }
    fn gesehen(&self) -> Vec<Zustellung> {
        self.gesehen.lock().unwrap().clone()
    }
}

impl Zusteller for Skript {
    fn zustellen<'a>(
        &'a self,
        zugang: &'a Versandzugang,
        von: &'a str,
        an: &'a str,
        mail: &'a [u8],
    ) -> BoxFuture<'a, Result<(), SmtpFehler>> {
        Box::pin(async move {
            self.gesehen.lock().unwrap().push(Zustellung {
                von: von.to_string(),
                an: an.to_string(),
                mail: mail.to_vec(),
                mit_passwort: zugang.geheimnisse.contains_key("passwort"),
            });
            self.ergebnisse
                .lock()
                .unwrap()
                .pop_front()
                .unwrap_or(Ok(()))
        })
    }
}

struct Welt {
    app: axum::Router,
    pool: sqlx::SqlitePool,
    live: LiveHub,
    rahmen: Rahmen,
    admin: String,
    einsatz: i64,
    org_id: i64,
    benutzer_id: i64,
    adapter_id: String,
    skript: Arc<Skript>,
    zusteller: Arc<dyn Zusteller>,
}

async fn welt() -> Welt {
    let pool = lifeline_hub::db::test_pool().await;
    lifeline_hub::auth::bootstrap::bootstrap_admin(&pool, "Test-Orga", "admin", Some("startpw12"))
        .await
        .unwrap();
    let live = LiveHub::new();
    let (rahmen, _pruefer) = adapter_testart::rahmen_smtp();
    let mut state = common::test_state(&pool, &live);
    state.adapter = rahmen.clone();
    let app = lifeline_hub::app::build_router(state);
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen_mit(&app, &admin, "Hochwasser Süd").await;
    let (org_id, benutzer_id): (i64, i64) =
        sqlx::query_as("SELECT org_id, id FROM benutzer WHERE benutzername = 'admin'")
            .fetch_one(&pool)
            .await
            .unwrap();

    let body = json!({
        "art": "smtp",
        "name": "Ausgang",
        "einstellungen": {
            "host": "mail.example.org",
            "port": 587,
            "verschluesselung": "starttls",
            "benutzer": "versand",
            "absender": " einsatz@example.org ",
            "absender_name": "EL Hochwasser"
        }
    });
    let (s, a) = anfrage_json(&app, "POST", "/api/admin/adapter", &admin, Some(&body)).await;
    assert_eq!(s, StatusCode::CREATED, "{a}");
    let adapter_id = a["id"].as_str().unwrap().to_string();
    let (s, v) = anfrage_json(
        &app,
        "PUT",
        &format!("/api/admin/adapter/{adapter_id}/secrets/passwort"),
        &admin,
        Some(&json!({ "wert": PASSWORT })),
    )
    .await;
    assert_eq!(s, StatusCode::NO_CONTENT, "{v}");

    let skript = Arc::new(Skript::default());
    Welt {
        app,
        pool,
        live,
        rahmen,
        admin,
        einsatz,
        org_id,
        benutzer_id,
        adapter_id,
        zusteller: skript.clone(),
        skript,
    }
}

impl Welt {
    fn lb(&self, rest: &str) -> String {
        format!("/api/einsaetze/{}/situation-reports{rest}", self.einsatz)
    }

    /// Legt einen Lagebericht an, füllt ihn, hängt auf Wunsch eine PNG-Anlage an und gibt ihn frei.
    async fn lagebericht_freigeben(&self, mit_anlage: bool) -> i64 {
        let (s, lb) = anfrage(
            &self.app,
            "POST",
            &self.lb(""),
            &self.admin,
            Some(r#"{"vorlage":"freitext","titel":"Lage","abschnitte":[{"schluessel":"text","text":"Pegel steigt"}]}"#),
        )
        .await;
        assert_eq!(s, StatusCode::CREATED, "{lb}");
        let lid = lb["id"].as_i64().unwrap();
        if mit_anlage {
            let png = png_bytes(32, 24);
            let (s, v) = multipart_post(
                &self.app,
                &self.lb(&format!("/{lid}/enclosures")),
                &self.admin,
                Some(("skizze.png", &png)),
                &[
                    ("art", "fernmeldeskizze"),
                    ("titel", "Fernmeldeskizze"),
                    ("stand_at", "2026-10-08 12:15:00"),
                ],
            )
            .await;
            assert_eq!(s, StatusCode::CREATED, "{v}");
        }
        self.freigeben(lid).await;
        lid
    }

    async fn freigeben(&self, lid: i64) {
        let (s, v) = anfrage(
            &self.app,
            "POST",
            &self.lb(&format!("/{lid}/release")),
            &self.admin,
            None,
        )
        .await;
        assert!(s.is_success(), "Freigabe: {s} {v}");
    }

    /// Schreibt den Lagebericht fort und gibt die neue Fassung frei.
    async fn fortschreiben_und_freigeben(&self, lid: i64) -> i64 {
        let (s, v) = anfrage(
            &self.app,
            "POST",
            &self.lb(&format!("/{lid}/revise")),
            &self.admin,
            Some("{}"),
        )
        .await;
        assert!(s.is_success(), "Fortschreiben: {s} {v}");
        let neu = v["id"].as_i64().unwrap();
        self.freigeben(neu).await;
        neu
    }

    /// Legt einen wartenden Versand an, fällig zu `ab`.
    async fn versand(&self, quelle: &str, quelle_id: i64, ab: DateTime<Utc>) -> String {
        let id = uuid::Uuid::new_v4().to_string();
        sqlx::query(
            "INSERT INTO ausgang (id, org_id, einsatz_id, client_id, quelle_art, quelle_id, kanal, \
                 stelle_bezeichnung, adresse, betreff, inhalt, zustand, naechster_versuch_at, \
                 erstellt_von_id, erstellt_at) \
             VALUES (?, ?, ?, ?, ?, ?, 'email', ?, ?, ?, ?, 'wartet', ?, ?, ?)",
        )
        .bind(&id)
        .bind(self.org_id)
        .bind(self.einsatz)
        .bind(format!("c-{id}"))
        .bind(quelle)
        .bind(quelle_id)
        .bind(STELLE)
        .bind(ADRESSE)
        .bind("Lagebericht Nr. 1 – Hochwasser Süd – Stand 021000jun26")
        .bind("Pegel steigt\n\n-- \nHochwasser Süd\n")
        .bind(lifeline_hub::zeit::formatiere_utc(ab))
        .bind(self.benutzer_id)
        .bind(lifeline_hub::zeit::formatiere_utc(ab))
        .execute(&self.pool)
        .await
        .unwrap();
        id
    }

    async fn zeile(&self, id: &str) -> VersandZeile {
        let mut conn = self.pool.acquire().await.unwrap();
        lifeline_hub::ausgang::repo::load(&mut conn, self.einsatz, id)
            .await
            .unwrap()
    }

    async fn durchgang(&self, jetzt: DateTime<Utc>) {
        lauf::durchgang(&self.pool, &self.rahmen, &self.live, &self.zusteller, jetzt)
            .await
            .unwrap();
    }

    /// Die Systemeinträge des Einsatzes zum Versand: (Inhalt, An).
    async fn etb_versand(&self) -> Vec<(String, String)> {
        sqlx::query_as(
            "SELECT inhalt, an FROM etb_eintrag \
             WHERE einsatz_id = ? AND typ = 'system' AND inhalt LIKE '%per E-Mail an%' ORDER BY id",
        )
        .bind(self.einsatz)
        .fetch_all(&self.pool)
        .await
        .unwrap()
    }

    async fn etb_anzahl(&self) -> i64 {
        sqlx::query_scalar("SELECT COUNT(*) FROM etb_eintrag WHERE einsatz_id = ?")
            .bind(self.einsatz)
            .fetch_one(&self.pool)
            .await
            .unwrap()
    }
}

#[tokio::test]
async fn freigegebener_lagebericht_wird_uebergeben_und_steht_im_etb() {
    let w = welt().await;
    let lid = w.lagebericht_freigeben(true).await;
    let t0 = Utc::now();
    let id = w.versand("lagebericht", lid, t0).await;
    let mut rx = w.live.abonniere(w.einsatz);

    w.durchgang(t0).await;

    let z = w.zeile(&id).await;
    assert_eq!(z.zustand, VersandZustand::Uebergeben);
    assert_eq!(z.versuche, 1);
    assert!(z.uebergeben_at.is_some());
    assert!(z.versuch_begonnen_at.is_none());
    let gesehen = w.skript.gesehen();
    assert_eq!(gesehen.len(), 1);
    let g = &gesehen[0];
    assert_eq!(g.von, "einsatz@example.org");
    assert_eq!(g.an, ADRESSE);
    assert!(g.mit_passwort, "das Passwort kam nicht im Zugang an");
    let text = String::from_utf8_lossy(&g.mail).to_string();
    assert!(
        text.contains(&format!("Message-ID: <ausgang-{id}@example.org>")),
        "{text}"
    );
    assert!(text.contains("To: lagedienst@leitstelle.example"), "{text}");
    // Die PNG-Anlage der freigegebenen Fassung hängt an (load_anhaenge von Ende zu Ende).
    let klein = text.to_lowercase();
    assert!(klein.contains("multipart/mixed"), "{text}");
    assert!(klein.contains("content-type: image/png"), "{text}");
    assert!(klein.contains("filename=\"anlage-1.png\""), "{text}");
    assert!(
        text.contains("iVBORw0KGgo"),
        "PNG-Signatur fehlt im Anhang: {text}"
    );

    let etb = w.etb_versand().await;
    assert_eq!(etb.len(), 1, "{etb:?}");
    let (inhalt, an) = &etb[0];
    assert_eq!(an, STELLE);
    assert_eq!(
        inhalt,
        &format!("Lagebericht Nr. 1 per E-Mail an {STELLE} ({ADRESSE}) übergeben")
    );
    let etb_id: i64 = sqlx::query_scalar("SELECT id FROM etb_eintrag WHERE inhalt = ?")
        .bind(inhalt)
        .fetch_one(&w.pool)
        .await
        .unwrap();
    assert_eq!(z.etb_eintrag_id, Some(etb_id));

    // Nach dem Commit: der ETB-Eintrag und das Ereignis der Versandliste.
    common::recv_until_tag(&mut rx, "ausgang", Duration::from_secs(2)).await;

    // Ein zweiter Durchgang stellt nichts erneut zu.
    w.durchgang(t0 + chrono::Duration::seconds(60)).await;
    assert_eq!(w.skript.gesehen().len(), 1);
}

#[tokio::test]
async fn antwort_450_wird_wiederholt_dann_uebergeben() {
    let w = welt().await;
    let lid = w.lagebericht_freigeben(false).await;
    let t0 = Utc::now();
    let id = w.versand("lagebericht", lid, t0).await;
    w.skript.plane(Err(SmtpFehler::Voruebergehend(450)));

    w.durchgang(t0).await;
    let z = w.zeile(&id).await;
    assert_eq!(z.zustand, VersandZustand::Wartet);
    assert_eq!(z.versuche, 1);
    assert_eq!(z.fehler_art, Some(AusgangFehler::Voruebergehend));
    assert_eq!(z.fehler_status, Some(450));
    assert!(z.versuch_begonnen_at.is_none());
    assert!(
        w.etb_versand().await.is_empty(),
        "kein ETB vor dem Ergebnis"
    );

    // Vor der Wartezeit geschieht nichts.
    w.durchgang(t0 + chrono::Duration::seconds(10)).await;
    assert_eq!(w.skript.gesehen().len(), 1);

    w.durchgang(t0 + chrono::Duration::seconds(31)).await;
    let z = w.zeile(&id).await;
    assert_eq!(z.zustand, VersandZustand::Uebergeben);
    assert_eq!(z.versuche, 2);
    assert_eq!(z.fehler_art, None);
    assert_eq!(w.skript.gesehen().len(), 2);
    assert_eq!(w.etb_versand().await.len(), 1);
}

#[tokio::test]
async fn nach_30_minuten_voruebergehend_fehlgeschlagen() {
    let w = welt().await;
    let lid = w.lagebericht_freigeben(false).await;
    let t0 = Utc::now();
    let id = w.versand("lagebericht", lid, t0).await;
    w.skript.plane(Err(SmtpFehler::Verbindung));
    w.skript.plane(Err(SmtpFehler::Zeitueberschreitung));

    w.durchgang(t0).await;
    assert_eq!(w.zeile(&id).await.zustand, VersandZustand::Wartet);

    w.durchgang(t0 + chrono::Duration::minutes(31)).await;
    let z = w.zeile(&id).await;
    assert_eq!(z.zustand, VersandZustand::Fehlgeschlagen);
    assert_eq!(z.fehler_art, Some(AusgangFehler::Voruebergehend));
    let etb = w.etb_versand().await;
    assert_eq!(etb.len(), 1);
    assert!(
        etb[0].0.starts_with(&format!(
            "Lagebericht Nr. 1 per E-Mail an {STELLE} ({ADRESSE}) nicht zugestellt: "
        )),
        "{etb:?}"
    );
}

#[tokio::test]
async fn abgelehnt_sofort_fehlgeschlagen_mit_etb() {
    let w = welt().await;
    let lid = w.lagebericht_freigeben(false).await;
    let t0 = Utc::now();
    let id = w.versand("lagebericht", lid, t0).await;
    w.skript.plane(Err(SmtpFehler::Abgelehnt(550)));

    w.durchgang(t0).await;
    let z = w.zeile(&id).await;
    assert_eq!(z.zustand, VersandZustand::Fehlgeschlagen);
    assert_eq!(z.fehler_art, Some(AusgangFehler::Abgelehnt));
    assert_eq!(z.fehler_status, Some(550));
    let etb = w.etb_versand().await;
    assert_eq!(etb.len(), 1);
    assert!(etb[0].0.contains("nicht zugestellt"), "{etb:?}");
    assert!(etb[0].0.contains("abgelehnt"), "{etb:?}");
    assert!(z.etb_eintrag_id.is_some());

    // Keine Wiederholung.
    w.durchgang(t0 + chrono::Duration::minutes(5)).await;
    assert_eq!(w.skript.gesehen().len(), 1);
}

#[tokio::test]
async fn neuere_freigabe_im_fenster_macht_ueberholt() {
    let w = welt().await;
    let lid = w.lagebericht_freigeben(false).await;
    let t0 = Utc::now();
    let id = w.versand("lagebericht", lid, t0).await;
    w.skript.plane(Err(SmtpFehler::Voruebergehend(421)));
    w.durchgang(t0).await;
    assert_eq!(w.zeile(&id).await.zustand, VersandZustand::Wartet);

    w.fortschreiben_und_freigeben(lid).await;
    w.durchgang(t0 + chrono::Duration::seconds(31)).await;

    let z = w.zeile(&id).await;
    assert_eq!(z.zustand, VersandZustand::Fehlgeschlagen);
    assert_eq!(z.fehler_art, Some(AusgangFehler::Ueberholt));
    assert_eq!(
        w.skript.gesehen().len(),
        1,
        "die überholte Fassung ging erneut hinaus"
    );
    let etb = w.etb_versand().await;
    assert_eq!(etb.len(), 1);
    assert!(etb[0].0.contains("nicht gesendet"), "{etb:?}");
    assert!(etb[0].0.contains("neuere Fassung"), "{etb:?}");
}

#[tokio::test]
async fn zurueckgezogene_nachforderung_wird_nicht_gesendet() {
    let w = welt().await;
    let n = lifeline_hub::nachforderung::repo::create(
        &w.pool,
        w.einsatz,
        w.benutzer_id,
        lifeline_hub::nachforderung::repo::NachforderungDaten {
            art: "RTW",
            anzahl: Some(2),
            adressat_kategorie: "leitstelle",
            prioritaet: "dringend",
            angefordert_at: "2026-06-02 10:00:00",
            ..Default::default()
        },
    )
    .await
    .unwrap();
    sqlx::query("UPDATE nachforderung SET status = 'zurueckgezogen' WHERE id = ?")
        .bind(n.id)
        .execute(&w.pool)
        .await
        .unwrap();
    let t0 = Utc::now();
    let id = w.versand("nachforderung", n.id, t0).await;

    w.durchgang(t0).await;
    let z = w.zeile(&id).await;
    assert_eq!(z.zustand, VersandZustand::Fehlgeschlagen);
    assert_eq!(z.fehler_art, Some(AusgangFehler::Ueberholt));
    assert!(w.skript.gesehen().is_empty());
    assert_eq!(w.etb_versand().await.len(), 1);
}

#[tokio::test]
async fn spiegel_nach_anlegen_fehlgeschlagen_ohne_etb() {
    let w = welt().await;
    let lid = w.lagebericht_freigeben(false).await;
    let t0 = Utc::now();
    let id = w.versand("lagebericht", lid, t0).await;
    // Führungswechsel zwischen Anlegen und Zustellen: der Einsatz wird Spiegel.
    let mut tx = w.pool.begin().await.unwrap();
    sqlx::query("INSERT INTO spiegel_uebernahme (id) VALUES (1)")
        .execute(&mut *tx)
        .await
        .unwrap();
    sqlx::query("INSERT INTO einsatz_spiegel (einsatz_id, fremde_kennung) VALUES (?1, 'x/' || ?1)")
        .bind(w.einsatz)
        .execute(&mut *tx)
        .await
        .unwrap();
    sqlx::query("DELETE FROM spiegel_uebernahme")
        .execute(&mut *tx)
        .await
        .unwrap();
    tx.commit().await.unwrap();
    let vorher = w.etb_anzahl().await;

    w.durchgang(t0).await;

    let z = w.zeile(&id).await;
    assert_eq!(z.zustand, VersandZustand::Fehlgeschlagen);
    assert_eq!(z.fehler_art, Some(AusgangFehler::Spiegel));
    assert!(z.etb_eintrag_id.is_none());
    assert!(w.skript.gesehen().is_empty());
    assert_eq!(w.etb_anzahl().await, vorher);
}

#[tokio::test]
async fn angehaltene_anbindung_fehlgeschlagen() {
    let w = welt().await;
    let lid = w.lagebericht_freigeben(false).await;
    let (s, v) = anfrage_json(
        &w.app,
        "POST",
        &format!("/api/admin/adapter/{}/pause", w.adapter_id),
        &w.admin,
        None,
    )
    .await;
    assert!(s.is_success(), "{s} {v}");
    let t0 = Utc::now();
    let id = w.versand("lagebericht", lid, t0).await;

    w.durchgang(t0).await;

    let z = w.zeile(&id).await;
    assert_eq!(z.zustand, VersandZustand::Fehlgeschlagen);
    assert_eq!(z.fehler_art, Some(AusgangFehler::AnbindungAngehalten));
    assert_eq!(z.versuche, 0, "ohne Anbindung beginnt kein Versuch");
    assert!(w.skript.gesehen().is_empty());
    let etb = w.etb_versand().await;
    assert_eq!(etb.len(), 1);
    assert!(
        etb[0]
            .0
            .ends_with("nicht zugestellt: Mailserver angehalten"),
        "{etb:?}"
    );
}

#[tokio::test]
async fn ohne_anbindung_fehlgeschlagen_mit_anbindung_fehlt() {
    let w = welt().await;
    let lid = w.lagebericht_freigeben(false).await;
    let (s, v) = anfrage_json(
        &w.app,
        "DELETE",
        &format!("/api/admin/adapter/{}", w.adapter_id),
        &w.admin,
        None,
    )
    .await;
    assert!(s.is_success(), "{s} {v}");
    let t0 = Utc::now();
    let id = w.versand("lagebericht", lid, t0).await;

    w.durchgang(t0).await;

    let z = w.zeile(&id).await;
    assert_eq!(z.fehler_art, Some(AusgangFehler::AnbindungFehlt));
    assert!(w.skript.gesehen().is_empty());
}

#[tokio::test]
async fn anmeldefehler_zieht_adapterpruefung_vor() {
    let w = welt().await;
    let lid = w.lagebericht_freigeben(false).await;
    let spaeter = lifeline_hub::zeit::formatiere_utc(Utc::now() + chrono::Duration::hours(1));
    sqlx::query("UPDATE adapter SET naechster_abruf_at = ? WHERE id = ?")
        .bind(&spaeter)
        .bind(&w.adapter_id)
        .execute(&w.pool)
        .await
        .unwrap();
    let t0 = Utc::now();
    let id = w.versand("lagebericht", lid, t0).await;
    w.skript.plane(Err(SmtpFehler::Anmeldung));

    w.durchgang(t0).await;

    let z = w.zeile(&id).await;
    assert_eq!(z.zustand, VersandZustand::Fehlgeschlagen);
    assert_eq!(z.fehler_art, Some(AusgangFehler::AnbindungFehler));
    let (naechster, zustand): (Option<String>, String) =
        sqlx::query_as("SELECT naechster_abruf_at, zustand FROM adapter WHERE id = ?")
            .bind(&w.adapter_id)
            .fetch_one(&w.pool)
            .await
            .unwrap();
    let naechster = naechster.expect("nächster Abruf gesetzt");
    assert!(
        naechster <= lifeline_hub::zeit::formatiere_utc(Utc::now()),
        "nächster Abruf {naechster} nicht vorgezogen"
    );
    assert_eq!(
        zustand, "aktiv",
        "der Versand ändert den Zustand der Anbindung nie"
    );
    let etb = w.etb_versand().await;
    assert!(
        etb[0]
            .0
            .ends_with("nicht zugestellt: Anmeldung am Mailserver abgelehnt"),
        "{etb:?}"
    );
}

#[tokio::test]
async fn neustart_mit_begonnenem_versuch_ist_ungewiss_und_wird_nicht_zugestellt() {
    let w = welt().await;
    let lid = w.lagebericht_freigeben(false).await;
    let t0 = Utc::now();
    let id = w.versand("lagebericht", lid, t0).await;
    sqlx::query("UPDATE ausgang SET versuch_begonnen_at = ?, versuche = 1 WHERE id = ?")
        .bind(lifeline_hub::zeit::formatiere_utc(t0))
        .bind(&id)
        .execute(&w.pool)
        .await
        .unwrap();

    let n = lauf::beim_start(&w.pool, &w.live).await.unwrap();
    assert_eq!(n, 1);
    w.durchgang(t0 + chrono::Duration::seconds(5)).await;

    let z = w.zeile(&id).await;
    assert_eq!(z.zustand, VersandZustand::Fehlgeschlagen);
    assert_eq!(z.fehler_art, Some(AusgangFehler::Ungewiss));
    assert!(z.versuch_begonnen_at.is_none());
    assert!(w.skript.gesehen().is_empty());
    let etb = w.etb_versand().await;
    assert_eq!(etb.len(), 1, "{etb:?}");
    assert!(etb[0].0.contains("Zustellung unklar"), "{etb:?}");
    assert!(z.etb_eintrag_id.is_some());
}

#[tokio::test]
async fn kein_geheimnis_im_etb_oder_fehler() {
    let w = welt().await;
    let lid = w.lagebericht_freigeben(true).await;
    let t0 = Utc::now();
    let a = w.versand("lagebericht", lid, t0).await;
    let b = w.versand("lagebericht", lid, t0).await;
    w.skript.plane(Ok(()));
    w.skript.plane(Err(SmtpFehler::Anmeldung));
    w.durchgang(t0).await;
    // Parallel zugestellt: welcher angenommen und welcher abgewiesen wurde, ist offen.
    let mut zustaende = vec![w.zeile(&a).await.zustand, w.zeile(&b).await.zustand];
    zustaende.sort_by_key(|z| z.as_str());
    assert_eq!(
        zustaende,
        vec![VersandZustand::Fehlgeschlagen, VersandZustand::Uebergeben]
    );

    let etb: Vec<String> = sqlx::query_scalar(
        "SELECT COALESCE(inhalt, '') || COALESCE(von, '') || COALESCE(an, '') FROM etb_eintrag",
    )
    .fetch_all(&w.pool)
    .await
    .unwrap();
    for e in &etb {
        assert!(!e.contains(PASSWORT), "Passwort im ETB: {e}");
    }
    let zeilen: Vec<String> = sqlx::query_scalar(
        "SELECT id || client_id || quelle_art || kanal || stelle_bezeichnung || adresse || betreff \
             || inhalt || zustand || COALESCE(fehler_art, '') || COALESCE(fehler_status, '') \
         FROM ausgang",
    )
    .fetch_all(&w.pool)
    .await
    .unwrap();
    assert_eq!(zeilen.len(), 2);
    for z in &zeilen {
        assert!(!z.contains(PASSWORT), "Passwort in ausgang: {z}");
    }
    for g in w.skript.gesehen() {
        assert!(!String::from_utf8_lossy(&g.mail).contains(PASSWORT));
    }
}
