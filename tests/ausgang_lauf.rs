//! Lauf des Ausgangskorbs (LLH-2093, Spec `docs/superpowers/specs/2026-11-24-w1ymakq6-ausgang-email-design.md`,
//! Abschnitte 2, 3, 4 und 6): fällige Versände zustellen, Ergebnis und ETB in einer Transaktion,
//! Wiederholung, überholte Quellen, Spiegel, angehaltene Anbindung, Neustart, keine Geheimnisse.
//!
//! Zugestellt wird über den echten `SmtpZusteller` mit einem Skript als SMTP-Transport (`Skript`),
//! das die Ergebnisse vorgibt und mitschreibt, was es zustellen sollte. Die Versände legt der Test direkt in `ausgang` an (die Routen kommen
//! später); Anbindung, Passwort, Lagebericht und Anlage entstehen über die echten Routen.

use std::collections::VecDeque;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use axum::http::StatusCode;
use chrono::{DateTime, Utc};
use futures::future::BoxFuture;
use lifeline_hub::adapter::smtp::SmtpFehler;
use lifeline_hub::adapter::Rahmen;
use lifeline_hub::ausgang::lauf::{self, SmtpZusteller, Versandzugang, Zusteller};
use lifeline_hub::ausgang::lauf::{Fehlschlag, Versandauftrag, Zustellfehler, Zustellt};
use lifeline_hub::ausgang::zusteller::{MatrixNichtVerfuegbar, SmtpTransport, Zustellerwahl};
use lifeline_hub::ausgang::{AusgangFehler, VersandZeile, VersandZustand};
use lifeline_hub::live::LiveHub;
use serde_json::json;

mod adapter_testart;
mod common;
use common::{anfrage, anfrage_json, einsatz_anlegen_mit, login_cookie, multipart_post, png_bytes};

const PASSWORT: &str = "Geheim-Passwort-4711";
const ADRESSE: &str = "lagedienst@leitstelle.example";
const STELLE: &str = "Leitstelle Nord";

/// Ein SMTP-Transport, der vorgegebene Ergebnisse abspielt (leer heißt angenommen) und mitschreibt.
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

impl SmtpTransport for Skript {
    fn senden<'a>(
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
    let (rahmen, _pruefer) = adapter_testart::rahmen_smtp_matrix();
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
        // Wie produktiv: E-Mail über SMTP, Matrix noch ohne Zusteller.
        zusteller: Arc::new(Zustellerwahl::new(
            Arc::new(SmtpZusteller::mit_transport(skript.clone())),
            Arc::new(MatrixNichtVerfuegbar),
        )),
        skript,
    }
}

impl Welt {
    fn lb(&self, rest: &str) -> String {
        format!("/api/incidents/{}/situation-reports{rest}", self.einsatz)
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
        self.versand_in("email", ADRESSE, quelle, quelle_id, ab)
            .await
    }

    /// Wie [`Welt::versand`], in einem Kanal an eine Adresse.
    async fn versand_in(
        &self,
        kanal: &str,
        adresse: &str,
        quelle: &str,
        quelle_id: i64,
        ab: DateTime<Utc>,
    ) -> String {
        let id = uuid::Uuid::new_v4().to_string();
        sqlx::query(
            "INSERT INTO ausgang (id, org_id, einsatz_id, client_id, quelle_art, quelle_id, kanal, \
                 stelle_bezeichnung, adresse, betreff, inhalt, zustand, naechster_versuch_at, \
                 erstellt_von_id, erstellt_at) \
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'wartet', ?, ?, ?)",
        )
        .bind(&id)
        .bind(self.org_id)
        .bind(self.einsatz)
        .bind(format!("c-{id}"))
        .bind(quelle)
        .bind(quelle_id)
        .bind(kanal)
        .bind(STELLE)
        .bind(adresse)
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

    /// Legt die Matrix-Anbindung der Org an, mit Access-Token (ohne Netz).
    async fn matrix_anbindung(&self) {
        let body = json!({
            "art": "matrix", "name": "Matrix",
            "einstellungen": { "homeserver": "https://matrix.example.org" }
        });
        let (s, a) = anfrage_json(
            &self.app,
            "POST",
            "/api/admin/adapter",
            &self.admin,
            Some(&body),
        )
        .await;
        assert_eq!(s, StatusCode::CREATED, "{a}");
        let id = a["id"].as_str().unwrap();
        let (s, v) = anfrage_json(
            &self.app,
            "PUT",
            &format!("/api/admin/adapter/{id}/secrets/access_token"),
            &self.admin,
            Some(&json!({ "wert": "syt_geheimes_token" })),
        )
        .await;
        assert_eq!(s, StatusCode::NO_CONTENT, "{v}");
    }

    async fn teile(&self, id: &str) -> Vec<(i64, String)> {
        sqlx::query_as("SELECT teil, event_id FROM ausgang_teil WHERE versand_id = ? ORDER BY teil")
            .bind(id)
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

/// Hält jede Zustellung an, bis der Test sie freigibt; danach wie [`Skript`].
struct Sperre {
    skript: Arc<Skript>,
    begonnen: tokio::sync::Notify,
    frei: tokio::sync::Semaphore,
}

impl SmtpTransport for Sperre {
    fn senden<'a>(
        &'a self,
        zugang: &'a Versandzugang,
        von: &'a str,
        an: &'a str,
        mail: &'a [u8],
    ) -> BoxFuture<'a, Result<(), SmtpFehler>> {
        Box::pin(async move {
            self.begonnen.notify_one();
            self.frei.acquire().await.unwrap().forget();
            self.skript.senden(zugang, von, an, mail).await
        })
    }
}

#[tokio::test]
async fn veraltete_kopie_nach_dem_abschluss_stellt_nicht_ein_zweites_mal_zu() {
    let w = welt().await;
    let lid = w.lagebericht_freigeben(false).await;
    let t0 = Utc::now();
    let id = w.versand("lagebericht", lid, t0).await;
    // Ein zweiter Durchgang hat die Zeile gelesen, bevor der erste sie abschloss.
    let veraltet = w.zeile(&id).await;

    w.durchgang(t0).await;
    assert_eq!(w.zeile(&id).await.zustand, VersandZustand::Uebergeben);
    lauf::zustellen_zeile(
        &w.pool,
        &w.rahmen,
        &w.live,
        &w.zusteller,
        veraltet.clone(),
        t0 + chrono::Duration::seconds(1),
    )
    .await
    .unwrap();

    assert_eq!(w.skript.gesehen().len(), 1, "die Mail ging zweimal hinaus");
    assert_eq!(w.etb_versand().await.len(), 1);
    let z = w.zeile(&id).await;
    assert_eq!(z.zustand, VersandZustand::Uebergeben);
    assert_eq!(z.versuche, 1);

    // Auch ein Abschluss vor dem Netz (Quelle inzwischen überholt) schreibt nichts mehr.
    w.fortschreiben_und_freigeben(lid).await;
    let vorher = w.etb_anzahl().await;
    lauf::zustellen_zeile(
        &w.pool,
        &w.rahmen,
        &w.live,
        &w.zusteller,
        veraltet,
        t0 + chrono::Duration::seconds(2),
    )
    .await
    .unwrap();
    assert_eq!(w.etb_anzahl().await, vorher);
    assert_eq!(w.zeile(&id).await.zustand, VersandZustand::Uebergeben);
}

#[tokio::test]
async fn zwei_gleichzeitige_laeufe_derselben_zeile_stellen_einmal_zu() {
    let w = welt().await;
    let lid = w.lagebericht_freigeben(false).await;
    let t0 = Utc::now();
    let id = w.versand("lagebericht", lid, t0).await;
    let veraltet = w.zeile(&id).await;
    let sperre = Arc::new(Sperre {
        skript: w.skript.clone(),
        begonnen: tokio::sync::Notify::new(),
        frei: tokio::sync::Semaphore::new(0),
    });
    let gesperrt: Arc<dyn Zusteller> = Arc::new(SmtpZusteller::mit_transport(sperre.clone()));

    // Lauf A beansprucht die Zeile und hängt im Netz.
    let a = {
        let (pool, rahmen, live, z) = (
            w.pool.clone(),
            w.rahmen.clone(),
            w.live.clone(),
            gesperrt.clone(),
        );
        tokio::spawn(async move { lauf::durchgang(&pool, &rahmen, &live, &z, t0).await })
    };
    sperre.begonnen.notified().await;
    // Lauf B mit der Kopie von vorher (ungesperrt, damit der Test nie hängt): bekommt die
    // Zeile nicht.
    lauf::zustellen_zeile(&w.pool, &w.rahmen, &w.live, &w.zusteller, veraltet, t0)
        .await
        .unwrap();
    sperre.frei.add_permits(2);
    a.await.unwrap().unwrap();

    assert_eq!(w.skript.gesehen().len(), 1, "die Mail ging zweimal hinaus");
    assert_eq!(w.etb_versand().await.len(), 1);
    assert_eq!(w.zeile(&id).await.zustand, VersandZustand::Uebergeben);
}

#[tokio::test]
async fn haengengebliebener_versuch_wird_im_betrieb_ungewiss() {
    let w = welt().await;
    let lid = w.lagebericht_freigeben(false).await;
    let t0 = Utc::now();
    let alt = w.versand("lagebericht", lid, t0).await;
    let frisch = w.versand("lagebericht", lid, t0).await;
    let setze_begonnen = |id: String, vor_min: i64| {
        let pool = w.pool.clone();
        async move {
            sqlx::query("UPDATE ausgang SET versuch_begonnen_at = ?, versuche = 1 WHERE id = ?")
                .bind(lifeline_hub::zeit::formatiere_utc(
                    t0 - chrono::Duration::minutes(vor_min),
                ))
                .bind(&id)
                .execute(&pool)
                .await
                .unwrap();
        }
    };
    // Der eine hängt länger als jede Sitzung dauern kann, der andere läuft womöglich noch.
    setze_begonnen(alt.clone(), 15).await;
    setze_begonnen(frisch.clone(), 1).await;

    w.durchgang(t0).await;

    let z = w.zeile(&alt).await;
    assert_eq!(z.zustand, VersandZustand::Fehlgeschlagen);
    assert_eq!(z.fehler_art, Some(AusgangFehler::Ungewiss));
    assert!(z.versuch_begonnen_at.is_none());
    assert!(z.etb_eintrag_id.is_some());
    let etb = w.etb_versand().await;
    assert_eq!(etb.len(), 1, "{etb:?}");
    assert!(etb[0].0.contains("Zustellung unklar"), "{etb:?}");
    let f = w.zeile(&frisch).await;
    assert_eq!(f.zustand, VersandZustand::Wartet);
    assert!(f.versuch_begonnen_at.is_some());
    assert!(w.skript.gesehen().is_empty());
    assert!(lauf::HAENGT_NACH > std::time::Duration::from_secs(12 * 60));
}

/// Macht den Einsatz zum Spiegel (Führungswechsel), wie es die Übernahme täte.
async fn zum_spiegel(pool: &sqlx::SqlitePool, einsatz: i64) {
    let mut tx = pool.begin().await.unwrap();
    sqlx::query("INSERT INTO spiegel_uebernahme (id) VALUES (1)")
        .execute(&mut *tx)
        .await
        .unwrap();
    sqlx::query("INSERT INTO einsatz_spiegel (einsatz_id, fremde_kennung) VALUES (?1, 'x/' || ?1)")
        .bind(einsatz)
        .execute(&mut *tx)
        .await
        .unwrap();
    sqlx::query("DELETE FROM spiegel_uebernahme")
        .execute(&mut *tx)
        .await
        .unwrap();
    tx.commit().await.unwrap();
}

/// Die eine Ausnahme von „nie halb“ (src/AGENTS.md, „Ausgang an Menschen“): wird der Einsatz
/// während der Zustellung zum Spiegel, nimmt das ETB nichts mehr an. Die übergebene Mail lässt
/// sich nicht zurückholen; der Versand steht als `uebergeben` ohne ETB-Eintrag.
#[tokio::test]
async fn spiegel_waehrend_der_zustellung_bleibt_uebergeben_ohne_etb() {
    let w = welt().await;
    let lid = w.lagebericht_freigeben(false).await;
    let t0 = Utc::now();
    let id = w.versand("lagebericht", lid, t0).await;
    let sperre = Arc::new(Sperre {
        skript: w.skript.clone(),
        begonnen: tokio::sync::Notify::new(),
        frei: tokio::sync::Semaphore::new(0),
    });
    let gesperrt: Arc<dyn Zusteller> = Arc::new(SmtpZusteller::mit_transport(sperre.clone()));
    let lauf_a = {
        let (pool, rahmen, live, z) = (
            w.pool.clone(),
            w.rahmen.clone(),
            w.live.clone(),
            gesperrt.clone(),
        );
        tokio::spawn(async move { lauf::durchgang(&pool, &rahmen, &live, &z, t0).await })
    };
    sperre.begonnen.notified().await;
    zum_spiegel(&w.pool, w.einsatz).await;
    let vorher = w.etb_anzahl().await;
    sperre.frei.add_permits(1);
    lauf_a.await.unwrap().unwrap();

    let z = w.zeile(&id).await;
    assert_eq!(z.zustand, VersandZustand::Uebergeben);
    assert!(z.uebergeben_at.is_some());
    assert!(z.versuch_begonnen_at.is_none());
    assert!(z.etb_eintrag_id.is_none());
    assert_eq!(w.skript.gesehen().len(), 1);
    assert_eq!(w.etb_anzahl().await, vorher);
}

/// Ein PNG-Chunk, wie ihn die Bereinigung liest (sie prüft die CRC nicht).
fn png_chunk(typ: &[u8; 4], daten: &[u8]) -> Vec<u8> {
    let mut c = (daten.len() as u32).to_be_bytes().to_vec();
    c.extend_from_slice(typ);
    c.extend_from_slice(daten);
    c.extend_from_slice(&[0, 0, 0, 0]);
    c
}

/// Setzt `chunk` hinter den IHDR (Signatur 8 + IHDR 25 Bytes) eines PNG.
fn png_mit_chunk(chunk: &[u8]) -> Vec<u8> {
    let png = png_bytes(32, 24);
    let mut aus = png[..33].to_vec();
    aus.extend_from_slice(chunk);
    aus.extend_from_slice(&png[33..]);
    aus
}

/// Die Bytes der Anlage `anlage-1.png` aus der Mail (Base64-Teil bis zur nächsten Grenze).
fn anlage_aus_mail(mail: &str) -> Vec<u8> {
    use base64::Engine;
    let ab = mail
        .find("filename=\"anlage-1.png\"")
        .expect("Anlage fehlt in der Mail");
    let rest = &mail[ab..];
    let start = rest.find("\r\n\r\n").expect("Kopf der Anlage endet nicht") + 4;
    let koerper: String = rest[start..]
        .lines()
        .take_while(|z| !z.starts_with("--"))
        .collect::<Vec<_>>()
        .concat();
    base64::engine::general_purpose::STANDARD
        .decode(koerper.trim())
        .expect("Anlage ist kein Base64")
}

#[tokio::test]
async fn anlage_geht_bereinigt_hinaus_nicht_im_original() {
    let w = welt().await;
    let lid = w.lagebericht_freigeben(true).await;
    // Gespeichert bleibt das Original mit Textchunk (LFH-747); nach außen nur die bereinigte Fassung.
    let original = png_mit_chunk(&png_chunk(b"tEXt", b"Comment\0Fundort Gartenweg 7"));
    sqlx::query("UPDATE anhang SET daten = ? WHERE einsatz_id = ? AND mime = 'image/png'")
        .bind(&original)
        .bind(w.einsatz)
        .execute(&w.pool)
        .await
        .unwrap();
    let t0 = Utc::now();
    let id = w.versand("lagebericht", lid, t0).await;

    w.durchgang(t0).await;

    assert_eq!(w.zeile(&id).await.zustand, VersandZustand::Uebergeben);
    let gesehen = w.skript.gesehen();
    let anlage = anlage_aus_mail(&String::from_utf8_lossy(&gesehen[0].mail));
    assert!(anlage.starts_with(b"\x89PNG\r\n\x1a\n"), "keine PNG-Anlage");
    assert!(
        !anlage.windows(b"tEXt".len()).any(|f| f == b"tEXt"),
        "der Textchunk des Originals ging mit hinaus"
    );
}

#[tokio::test]
async fn lauf_prueft_die_echten_bytes_der_anlagen() {
    let w = welt().await;
    let lid = w.lagebericht_freigeben(true).await;
    // Die gespeicherte Größe ist klein, die Bytes sind über 20 MiB: ein gültiges PNG mit einem
    // übergroßen IDAT, das auch die Bereinigung behält.
    let riesig = png_mit_chunk(&png_chunk(b"IDAT", &vec![0u8; 20 * 1024 * 1024 + 1]));
    sqlx::query("UPDATE anhang SET daten = ? WHERE einsatz_id = ? AND mime = 'image/png'")
        .bind(&riesig)
        .bind(w.einsatz)
        .execute(&w.pool)
        .await
        .unwrap();
    let t0 = Utc::now();
    let id = w.versand("lagebericht", lid, t0).await;

    w.durchgang(t0).await;

    let z = w.zeile(&id).await;
    assert_eq!(z.zustand, VersandZustand::Fehlgeschlagen);
    assert_eq!(z.fehler_art, Some(AusgangFehler::ZuGross));
    assert!(w.skript.gesehen().is_empty());
}

/// Ein Zusteller, der vorgegebene Antworten abspielt (leer heißt zugestellt ohne Teile) und
/// sich merkt, welche Teile ihm als schon gesendet genannt wurden.
#[derive(Default)]
struct TeilDoppel {
    antworten: Mutex<VecDeque<Result<Zustellt, Fehlschlag>>>,
    gesendet: Mutex<Vec<Vec<i64>>>,
}

impl Zusteller for TeilDoppel {
    fn zustellen<'a>(
        &'a self,
        auftrag: &'a Versandauftrag<'a>,
    ) -> BoxFuture<'a, Result<Zustellt, Fehlschlag>> {
        Box::pin(async move {
            self.gesendet
                .lock()
                .unwrap()
                .push(auftrag.gesendet.to_vec());
            self.antworten
                .lock()
                .unwrap()
                .pop_front()
                .unwrap_or_else(|| Ok(Zustellt::default()))
        })
    }
}

fn teile(paare: &[(i64, &str)]) -> Vec<(i64, String)> {
    paare.iter().map(|(n, e)| (*n, e.to_string())).collect()
}

#[tokio::test]
async fn teile_werden_mit_dem_ergebnis_gespeichert() {
    let w = welt().await;
    let lid = w.lagebericht_freigeben(false).await;
    let t0 = Utc::now();
    let id = w.versand("lagebericht", lid, t0).await;
    let doppel = Arc::new(TeilDoppel::default());
    doppel.antworten.lock().unwrap().push_back(Ok(Zustellt {
        teile: teile(&[(0, "$text"), (1, "$anlage")]),
    }));
    let zusteller: Arc<dyn Zusteller> = doppel.clone();

    lauf::durchgang(&w.pool, &w.rahmen, &w.live, &zusteller, t0)
        .await
        .unwrap();

    assert_eq!(w.zeile(&id).await.zustand, VersandZustand::Uebergeben);
    assert_eq!(w.teile(&id).await, teile(&[(0, "$text"), (1, "$anlage")]));
    let liste = lifeline_hub::ausgang::repo::list_teile(&w.pool, &id)
        .await
        .unwrap();
    assert_eq!(liste, [0, 1]);
    assert_eq!(doppel.gesendet.lock().unwrap().clone(), [Vec::<i64>::new()]);
}

#[tokio::test]
async fn gemerkte_teile_gehen_dem_naechsten_versuch_mit() {
    let w = welt().await;
    let lid = w.lagebericht_freigeben(false).await;
    let t0 = Utc::now();
    let id = w.versand("lagebericht", lid, t0).await;
    let doppel = Arc::new(TeilDoppel::default());
    // Der Text ging hinaus, die Anlage scheiterte vorübergehend.
    doppel.antworten.lock().unwrap().push_back(Err(Fehlschlag {
        fehler: Zustellfehler::Voruebergehend { nicht_vor: None },
        grund: "Homeserver nicht erreichbar".into(),
        smtp_status: None,
        teile: teile(&[(0, "$text")]),
    }));
    doppel.antworten.lock().unwrap().push_back(Ok(Zustellt {
        teile: teile(&[(1, "$anlage")]),
    }));
    let zusteller: Arc<dyn Zusteller> = doppel.clone();

    lauf::durchgang(&w.pool, &w.rahmen, &w.live, &zusteller, t0)
        .await
        .unwrap();
    let z = w.zeile(&id).await;
    assert_eq!(z.zustand, VersandZustand::Wartet);
    assert_eq!(w.teile(&id).await, teile(&[(0, "$text")]));

    let spaeter = t0 + chrono::Duration::minutes(5);
    lauf::durchgang(&w.pool, &w.rahmen, &w.live, &zusteller, spaeter)
        .await
        .unwrap();
    assert_eq!(w.zeile(&id).await.zustand, VersandZustand::Uebergeben);
    assert_eq!(
        doppel.gesendet.lock().unwrap().clone(),
        [Vec::<i64>::new(), vec![0]]
    );
    assert_eq!(w.teile(&id).await, teile(&[(0, "$text"), (1, "$anlage")]));
}

#[tokio::test]
async fn matrix_zeile_erreicht_nie_den_smtp_zusteller() {
    let w = welt().await;
    w.matrix_anbindung().await;
    let lid = w.lagebericht_freigeben(false).await;
    let t0 = Utc::now();
    let id = w
        .versand_in("matrix", "#lage:example.org", "lagebericht", lid, t0)
        .await;

    w.durchgang(t0).await;

    assert!(w.skript.gesehen().is_empty(), "Matrix ging an SMTP");
    let z = w.zeile(&id).await;
    assert_eq!(z.zustand, VersandZustand::Fehlgeschlagen);
    assert_eq!(z.fehler_art, Some(AusgangFehler::AnbindungFehler));
    let text: String = sqlx::query_scalar(
        "SELECT inhalt FROM etb_eintrag WHERE einsatz_id = ? AND typ = 'system' ORDER BY id DESC LIMIT 1",
    )
    .bind(w.einsatz)
    .fetch_one(&w.pool)
    .await
    .unwrap();
    assert!(text.contains("per Matrix an"), "{text}");
    assert!(
        text.contains("Matrix-Zustellung noch nicht verfügbar"),
        "{text}"
    );
}

#[tokio::test]
async fn matrix_zeile_ohne_matrix_anbindung_ist_anbindung_fehlt() {
    // Der Mailserver ist da; er zählt für Matrix nicht.
    let w = welt().await;
    let lid = w.lagebericht_freigeben(false).await;
    let t0 = Utc::now();
    let id = w
        .versand_in("matrix", "#lage:example.org", "lagebericht", lid, t0)
        .await;

    w.durchgang(t0).await;

    assert!(w.skript.gesehen().is_empty());
    let z = w.zeile(&id).await;
    assert_eq!(z.fehler_art, Some(AusgangFehler::AnbindungFehlt));
    let text: String = sqlx::query_scalar(
        "SELECT inhalt FROM etb_eintrag WHERE einsatz_id = ? AND typ = 'system' ORDER BY id DESC LIMIT 1",
    )
    .bind(w.einsatz)
    .fetch_one(&w.pool)
    .await
    .unwrap();
    assert!(text.contains("kein Matrix-Konto eingerichtet"), "{text}");
}
