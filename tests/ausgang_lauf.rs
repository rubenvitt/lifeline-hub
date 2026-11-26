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
use lifeline_hub::adapter::sipgate::{FaxStatus, SipgateFehler};
use lifeline_hub::adapter::smtp::SmtpFehler;
use lifeline_hub::adapter::Rahmen;
use lifeline_hub::ausgang::lauf::{self, SmtpZusteller, Versandzugang, Zusteller};
use lifeline_hub::ausgang::lauf::{Fehlschlag, Versandauftrag, Zustellfehler, Zustellt};
use lifeline_hub::ausgang::zusteller::{
    AufzeichnenderFaxZusteller, AufzeichnenderZusteller, SmtpTransport, Zustellerwahl, Zustellwege,
};
use lifeline_hub::ausgang::{AusgangFehler, VersandZeile, VersandZustand};
use lifeline_hub::live::LiveHub;
use serde_json::json;

mod adapter_testart;
mod common;
use common::{anfrage, anfrage_json, einsatz_anlegen_mit, login_cookie, multipart_post, png_bytes};

const PASSWORT: &str = "Geheim-Passwort-4711";
const ADRESSE: &str = "lagedienst@leitstelle.example";
const STELLE: &str = "Leitstelle Nord";
const FAXNUMMER: &str = "+49511123456";

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
    fax_adapter_id: String,
    skript: Arc<Skript>,
    /// Was der Matrix-Zweig der Weiche angenommen hat (ohne Netz).
    matrix: Arc<AufzeichnenderZusteller>,
    fax: Arc<AufzeichnenderFaxZusteller>,
    wege: Zustellwege,
}

async fn welt() -> Welt {
    let pool = lifeline_hub::db::test_pool().await;
    lifeline_hub::auth::bootstrap::bootstrap_admin(&pool, "Test-Orga", "admin", Some("startpw12"))
        .await
        .unwrap();
    let live = LiveHub::new();
    let (rahmen, _smtp, _fax) = adapter_testart::rahmen_ausgang();
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

    let body = json!({
        "art": "sipgate_fax", "name": "Fax",
        "einstellungen": { "token_id": "token-ABC", "faxline_id": "f0", "absender_kennung": "ELW 1" }
    });
    let (s, a) = anfrage_json(&app, "POST", "/api/admin/adapter", &admin, Some(&body)).await;
    assert_eq!(s, StatusCode::CREATED, "{a}");
    let fax_adapter_id = a["id"].as_str().unwrap().to_string();
    let (s, v) = anfrage_json(
        &app,
        "PUT",
        &format!("/api/admin/adapter/{fax_adapter_id}/secrets/token"),
        &admin,
        Some(&json!({ "wert": "Geheim-Token-0815" })),
    )
    .await;
    assert_eq!(s, StatusCode::NO_CONTENT, "{v}");

    let skript = Arc::new(Skript::default());
    let matrix = Arc::new(AufzeichnenderZusteller::default());
    let fax = Arc::new(AufzeichnenderFaxZusteller::default());
    // Wie produktiv eine Weiche je Kanal: E-Mail über SMTP, Matrix an ein Doppel ohne Netz (der
    // echte Matrix-Zusteller: `tests/ausgang_matrix.rs`); das Fax an das Fax-Doppel.
    let wege = Zustellwege {
        mail: Arc::new(Zustellerwahl::new(
            Arc::new(SmtpZusteller::mit_transport(skript.clone())),
            matrix.clone(),
        )),
        fax: fax.clone(),
    };
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
        fax_adapter_id,
        skript,
        matrix,
        fax,
        wege,
    }
}

impl Welt {
    /// Die Wege des Laufs mit einem eigenen Zusteller für E-Mail und Matrix; Faxe an das Doppel.
    fn wege_mit(&self, mail: Arc<dyn Zusteller>) -> Zustellwege {
        Zustellwege {
            mail,
            fax: self.fax.clone(),
        }
    }

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
        self.versand_an("email", ADRESSE, quelle, quelle_id, ab)
            .await
    }

    /// Legt einen wartenden Fax-Versand an, fällig zu `ab`.
    async fn fax_versand(&self, quelle: &str, quelle_id: i64, ab: DateTime<Utc>) -> String {
        self.versand_an("fax", FAXNUMMER, quelle, quelle_id, ab)
            .await
    }

    async fn versand_an(
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
        lauf::durchgang(&self.pool, &self.rahmen, &self.live, &self.wege, jetzt)
            .await
            .unwrap();
    }

    /// Die Systemeinträge des Einsatzes zum Versand: (Inhalt, An).
    async fn etb_versand(&self) -> Vec<(String, String)> {
        sqlx::query_as(
            "SELECT inhalt, an FROM etb_eintrag \
             WHERE einsatz_id = ? AND typ = 'system' \
               AND (inhalt LIKE '%per E-Mail an%' OR inhalt LIKE '%per Fax an%') ORDER BY id",
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
        &w.wege,
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
        &w.wege,
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
    let gesperrt = Zustellwege {
        mail: Arc::new(SmtpZusteller::mit_transport(sperre.clone())),
        fax: w.fax.clone(),
    };

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
    lauf::zustellen_zeile(&w.pool, &w.rahmen, &w.live, &w.wege, veraltet, t0)
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
    let gesperrt = Zustellwege {
        mail: Arc::new(SmtpZusteller::mit_transport(sperre.clone())),
        fax: w.fax.clone(),
    };
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
    let zusteller = w.wege_mit(doppel.clone());

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
    let zusteller = w.wege_mit(doppel.clone());

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
        .versand_an("matrix", "#lage:example.org", "lagebericht", lid, t0)
        .await;

    w.durchgang(t0).await;

    assert!(w.skript.gesehen().is_empty(), "Matrix ging an SMTP");
    let angenommen = w.matrix.angenommen();
    assert_eq!(angenommen.len(), 1, "{angenommen:?}");
    assert_eq!(angenommen[0].adresse, "#lage:example.org");
    let z = w.zeile(&id).await;
    assert_eq!(z.zustand, VersandZustand::Uebergeben);
    let text: String = sqlx::query_scalar(
        "SELECT inhalt FROM etb_eintrag WHERE einsatz_id = ? AND typ = 'system' ORDER BY id DESC LIMIT 1",
    )
    .bind(w.einsatz)
    .fetch_one(&w.pool)
    .await
    .unwrap();
    assert!(text.contains("per Matrix an"), "{text}");
}

/// Ein Zusteller, der mit einem festen Fehlschlag scheitert.
struct Scheitert(Zustellfehler, &'static str);

impl Zusteller for Scheitert {
    fn zustellen<'a>(
        &'a self,
        _auftrag: &'a Versandauftrag<'a>,
    ) -> BoxFuture<'a, Result<Zustellt, Fehlschlag>> {
        Box::pin(async move {
            Err(Fehlschlag {
                fehler: self.0.clone(),
                grund: self.1.into(),
                smtp_status: None,
                teile: Vec::new(),
            })
        })
    }
}

#[tokio::test]
async fn kein_zutritt_und_verschluesselung_sind_endgueltig_mit_eigenem_code() {
    for (fehler, grund, code) in [
        (
            Zustellfehler::KeinZutritt,
            "kein Zutritt zum Raum (M_FORBIDDEN)",
            AusgangFehler::KeinZutritt,
        ),
        (
            Zustellfehler::Verschluesselung,
            "Verschlüsseln nicht möglich",
            AusgangFehler::Verschluesselung,
        ),
    ] {
        let w = welt().await;
        w.matrix_anbindung().await;
        let lid = w.lagebericht_freigeben(false).await;
        let t0 = Utc::now();
        let id = w
            .versand_an("matrix", "#lage:example.org", "lagebericht", lid, t0)
            .await;
        let zusteller = w.wege_mit(Arc::new(Scheitert(fehler, grund)));

        lauf::durchgang(&w.pool, &w.rahmen, &w.live, &zusteller, t0)
            .await
            .unwrap();

        let z = w.zeile(&id).await;
        assert_eq!(z.zustand, VersandZustand::Fehlgeschlagen);
        assert_eq!(z.fehler_art, Some(code));
        let text: String = sqlx::query_scalar(
            "SELECT inhalt FROM etb_eintrag WHERE einsatz_id = ? AND typ = 'system' ORDER BY id DESC LIMIT 1",
        )
        .bind(w.einsatz)
        .fetch_one(&w.pool)
        .await
        .unwrap();
        assert!(
            text.ends_with(&format!("nicht zugestellt: {grund}")),
            "{text}"
        );
    }
}

/// Ein Zusteller, der den Versand während der Zustellung verschwinden lässt (Einsatz gelöscht,
/// Kaskade) und gesendete Teile meldet.
struct LoeschtDieZeile(sqlx::SqlitePool);

impl Zusteller for LoeschtDieZeile {
    fn zustellen<'a>(
        &'a self,
        auftrag: &'a Versandauftrag<'a>,
    ) -> BoxFuture<'a, Result<Zustellt, Fehlschlag>> {
        Box::pin(async move {
            sqlx::query("DELETE FROM ausgang WHERE id = ?")
                .bind(auftrag.versand_id)
                .execute(&self.0)
                .await
                .unwrap();
            Ok(Zustellt {
                teile: teile(&[(0, "$text")]),
            })
        })
    }
}

#[tokio::test]
async fn geloeschter_versand_nimmt_seine_teile_ohne_fehler_mit() {
    let w = welt().await;
    w.matrix_anbindung().await;
    let lid = w.lagebericht_freigeben(false).await;
    let t0 = Utc::now();
    let id = w
        .versand_an("matrix", "#lage:example.org", "lagebericht", lid, t0)
        .await;
    let zeile = w.zeile(&id).await;
    let zusteller = w.wege_mit(Arc::new(LoeschtDieZeile(w.pool.clone())));
    let vorher = w.etb_anzahl().await;

    lauf::zustellen_zeile(&w.pool, &w.rahmen, &w.live, &zusteller, zeile, t0)
        .await
        .expect("ein verschwundener Versand ist kein Fehler");

    assert!(w.teile(&id).await.is_empty());
    assert_eq!(
        w.etb_anzahl().await,
        vorher,
        "kein ETB-Eintrag für einen gelöschten Versand"
    );
}

/// Ersetzt die Bytes der jüngsten PNG-Anlage durch ein PNG, das die Bereinigung durchlässt, das
/// aber kein Bild ergibt (IDAT ohne gültige Daten).
async fn anlage_unlesbar_machen(w: &Welt) {
    let png = png_bytes(32, 24);
    let mut kaputt = png[..33].to_vec();
    kaputt.extend_from_slice(&png_chunk(b"IDAT", b"kein zlib"));
    kaputt.extend_from_slice(&png_chunk(b"IEND", b""));
    let n = sqlx::query(
        "UPDATE anhang SET daten = ?, groesse = ? WHERE id = \
         (SELECT id FROM anhang WHERE einsatz_id = ? AND mime = 'image/png' ORDER BY id DESC LIMIT 1)",
    )
    .bind(&kaputt)
    .bind(kaputt.len() as i64)
    .bind(w.einsatz)
    .execute(&w.pool)
    .await
    .unwrap()
    .rows_affected();
    assert_eq!(n, 1);
}

async fn without_pdf(w: &Welt, id: &str) -> bool {
    sqlx::query_scalar("SELECT ohne_pdf FROM ausgang WHERE id = ?")
        .bind(id)
        .fetch_one(&w.pool)
        .await
        .unwrap()
}

#[tokio::test]
async fn eine_mail_traegt_das_pdf_als_ersten_anhang() {
    let w = welt().await;
    let lid = w.lagebericht_freigeben(true).await;
    let t0 = Utc::now();
    let id = w.versand("lagebericht", lid, t0).await;
    w.durchgang(t0).await;
    let text = String::from_utf8_lossy(&w.skript.gesehen()[0].mail).to_lowercase();
    let pdf = text
        .find("content-type: application/pdf")
        .expect("PDF fehlt");
    let png = text.find("content-type: image/png").expect("PNG fehlt");
    assert!(pdf < png, "das PDF kommt vor den PNG-Anlagen");
    assert!(text.contains("filename=\"lagebericht-1.pdf\""), "{text}");
    assert!(!without_pdf(&w, &id).await);
}

#[tokio::test]
async fn scheitert_das_pdf_geht_die_mail_ohne_pdf_und_ist_vermerkt() {
    let w = welt().await;
    let lid = w.lagebericht_freigeben(true).await;
    anlage_unlesbar_machen(&w).await;
    let t0 = Utc::now();
    let id = w.versand("lagebericht", lid, t0).await;
    w.durchgang(t0).await;
    assert_eq!(w.zeile(&id).await.zustand, VersandZustand::Uebergeben);
    let text = String::from_utf8_lossy(&w.skript.gesehen()[0].mail).to_lowercase();
    assert!(!text.contains("application/pdf"), "{text}");
    assert!(
        text.contains("content-type: image/png"),
        "die PNG-Anlage geht trotzdem mit"
    );
    assert!(without_pdf(&w, &id).await);
}

#[tokio::test]
async fn ein_fax_wird_uebergeben_und_merkt_die_session() {
    let w = welt().await;
    let lid = w.lagebericht_freigeben(true).await;
    let t0 = Utc::now();
    let id = w.fax_versand("lagebericht", lid, t0).await;
    w.fax.plane_senden(Ok("sess-1".into()));
    w.durchgang(t0).await;

    let z = w.zeile(&id).await;
    assert_eq!(z.zustand, VersandZustand::Uebergeben);
    assert_eq!(z.anbieter_ref.as_deref(), Some("sess-1"));
    assert!(z.naechste_abfrage_at.is_some());
    let gesendet = w.fax.gesendet();
    assert_eq!(gesendet.len(), 1);
    assert_eq!(gesendet[0].empfaenger, FAXNUMMER);
    assert_eq!(gesendet[0].faxline_id, "f0");
    assert_eq!(gesendet[0].dateiname, "lagebericht-1.pdf");
    assert!(gesendet[0].pdf.starts_with(b"%PDF-"));
    assert!(gesendet[0].mit_token, "das Token kam nicht im Zugang an");
    assert!(w.skript.gesehen().is_empty(), "keine Mail für ein Fax");
    assert!(w.etb_versand().await.is_empty(), "ETB erst beim Endstand");
}

#[tokio::test]
async fn fax_402_ist_anbindung_fehler_mit_etb() {
    let w = welt().await;
    let lid = w.lagebericht_freigeben(false).await;
    let t0 = Utc::now();
    let id = w.fax_versand("lagebericht", lid, t0).await;
    w.fax.plane_senden(Err(SipgateFehler::Status(402)));
    w.durchgang(t0).await;
    let z = w.zeile(&id).await;
    assert_eq!(z.zustand, VersandZustand::Fehlgeschlagen);
    assert_eq!(z.fehler_art, Some(AusgangFehler::AnbindungFehler));
    assert_eq!(z.fehler_status, Some(402));
    let etb = w.etb_versand().await;
    assert_eq!(etb.len(), 1);
    assert_eq!(
        etb[0].0,
        format!(
            "Lagebericht Nr. 1 per Fax an {STELLE} ({FAXNUMMER}) nicht zugestellt: \
             Guthaben bei sipgate aufgebraucht"
        )
    );
}

#[tokio::test]
async fn matrix_zeile_ohne_matrix_anbindung_ist_anbindung_fehlt() {
    // Der Mailserver ist da; er zählt für Matrix nicht.
    let w = welt().await;
    let lid = w.lagebericht_freigeben(false).await;
    let t0 = Utc::now();
    let id = w
        .versand_an("matrix", "#lage:example.org", "lagebericht", lid, t0)
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

#[tokio::test]
async fn fax_407_ist_abgelehnt() {
    let w = welt().await;
    let lid = w.lagebericht_freigeben(false).await;
    let t0 = Utc::now();
    let id = w.fax_versand("lagebericht", lid, t0).await;
    w.fax.plane_senden(Err(SipgateFehler::Status(407)));
    w.durchgang(t0).await;
    let z = w.zeile(&id).await;
    assert_eq!(z.zustand, VersandZustand::Fehlgeschlagen);
    assert_eq!(z.fehler_art, Some(AusgangFehler::Abgelehnt));
}

#[tokio::test]
async fn fax_503_wird_wiederholt() {
    let w = welt().await;
    let lid = w.lagebericht_freigeben(false).await;
    let t0 = Utc::now();
    let id = w.fax_versand("lagebericht", lid, t0).await;
    w.fax.plane_senden(Err(SipgateFehler::Status(503)));
    w.durchgang(t0).await;
    let z = w.zeile(&id).await;
    assert_eq!(z.zustand, VersandZustand::Wartet);
    assert_eq!(z.fehler_art, Some(AusgangFehler::Voruebergehend));
    let naechster =
        lifeline_hub::zeit::parse_utc(z.naechster_versuch_at.as_deref().unwrap()).unwrap();
    let abstand = (naechster - t0).num_seconds();
    assert!((29..=32).contains(&abstand), "{abstand}");
    assert!(w.etb_versand().await.is_empty());
}

#[tokio::test]
async fn fax_abbruch_nach_dem_senden_ist_ungewiss_ohne_zweiten_versuch() {
    let w = welt().await;
    let lid = w.lagebericht_freigeben(false).await;
    let t0 = Utc::now();
    let id = w.fax_versand("lagebericht", lid, t0).await;
    w.fax.plane_senden(Err(SipgateFehler::Ungewiss));
    w.durchgang(t0).await;
    w.durchgang(t0 + chrono::Duration::minutes(5)).await;
    let z = w.zeile(&id).await;
    assert_eq!(z.zustand, VersandZustand::Fehlgeschlagen);
    assert_eq!(z.fehler_art, Some(AusgangFehler::Ungewiss));
    assert_eq!(w.fax.gesendet().len(), 1, "kein zweites Fax");
}

#[tokio::test]
async fn fax_401_zieht_die_pruefung_der_anbindung_vor() {
    let w = welt().await;
    let lid = w.lagebericht_freigeben(false).await;
    let t0 = Utc::now();
    sqlx::query("UPDATE adapter SET naechster_abruf_at = '2099-01-01 00:00:00' WHERE id = ?")
        .bind(&w.fax_adapter_id)
        .execute(&w.pool)
        .await
        .unwrap();
    w.fax_versand("lagebericht", lid, t0).await;
    w.fax.plane_senden(Err(SipgateFehler::Status(401)));
    w.durchgang(t0).await;
    let naechster: String =
        sqlx::query_scalar("SELECT naechster_abruf_at FROM adapter WHERE id = ?")
            .bind(&w.fax_adapter_id)
            .fetch_one(&w.pool)
            .await
            .unwrap();
    assert!(naechster.as_str() < "2099", "{naechster}");
}

#[tokio::test]
async fn fax_status_doppel_liefert_den_geplanten_stand() {
    // Hilfstest für das Doppel selbst: ohne Plan ist der Stand „gesendet“.
    let f = AufzeichnenderFaxZusteller::default();
    f.plane_status(Ok(FaxStatus::Laeuft));
    let z = Versandzugang {
        einstellungen: Default::default(),
        geheimnisse: Default::default(),
        lan_erlaubt: false,
        adapter_id: "a".into(),
    };
    use lifeline_hub::ausgang::zusteller::FaxZusteller;
    assert_eq!(f.status(&z, "s").await, Ok(FaxStatus::Laeuft));
    assert_eq!(f.status(&z, "s").await, Ok(FaxStatus::Gesendet));
}

impl Welt {
    /// Ein übergebenes Fax: legt es an und lässt einen Durchgang es senden.
    async fn uebergebenes_fax(&self, t0: DateTime<Utc>) -> String {
        let lid = self.lagebericht_freigeben(false).await;
        let id = self.fax_versand("lagebericht", lid, t0).await;
        self.durchgang(t0).await;
        assert_eq!(self.zeile(&id).await.zustand, VersandZustand::Uebergeben);
        id
    }
}

#[tokio::test]
async fn sent_wird_zugestellt_mit_etb() {
    let w = welt().await;
    let t0 = Utc::now();
    let id = w.uebergebenes_fax(t0).await;
    let mut rx = w.live.abonniere(w.einsatz);
    w.fax.plane_status(Ok(FaxStatus::Gesendet));
    w.durchgang(t0 + chrono::Duration::seconds(31)).await;

    let z = w.zeile(&id).await;
    assert_eq!(z.zustand, VersandZustand::Zugestellt);
    assert!(z.zugestellt_at.is_some());
    assert!(z.naechste_abfrage_at.is_none());
    let etb = w.etb_versand().await;
    assert_eq!(
        etb,
        vec![(
            format!("Lagebericht Nr. 1 per Fax an {STELLE} ({FAXNUMMER}) zugestellt"),
            STELLE.to_string()
        )]
    );
    common::recv_until_tag(&mut rx, "ausgang", Duration::from_secs(2)).await;
    let (_, v) = anfrage_json(
        &w.app,
        "GET",
        &format!("/api/incidents/{}/deliveries", w.einsatz),
        &w.admin,
        None,
    )
    .await;
    let eintrag = v
        .as_array()
        .unwrap()
        .iter()
        .find(|e| e["id"] == id.as_str())
        .unwrap()
        .clone();
    assert_eq!(eintrag["state"], "zugestellt");
    assert!(eintrag["delivered_at"].is_string(), "{eintrag}");
}

#[tokio::test]
async fn failed_wird_nicht_zugestellt_und_laesst_sich_erneut_senden() {
    let w = welt().await;
    let t0 = Utc::now();
    let id = w.uebergebenes_fax(t0).await;
    w.fax.plane_status(Ok(FaxStatus::Gescheitert));
    w.durchgang(t0 + chrono::Duration::seconds(31)).await;

    let z = w.zeile(&id).await;
    assert_eq!(z.zustand, VersandZustand::Fehlgeschlagen);
    assert_eq!(z.fehler_art, Some(AusgangFehler::NichtZugestellt));
    assert_eq!(
        w.etb_versand().await[0].0,
        format!(
            "Lagebericht Nr. 1 per Fax an {STELLE} ({FAXNUMMER}) nicht zugestellt: \
             Gegenstelle nicht erreicht"
        )
    );
    let (s, v) = anfrage_json(
        &w.app,
        "POST",
        &format!("/api/incidents/{}/deliveries/{id}/retry", w.einsatz),
        &w.admin,
        None,
    )
    .await;
    assert!(s.is_success(), "{s} {v}");
    let z = w.zeile(&id).await;
    assert_eq!(z.zustand, VersandZustand::Wartet);
    assert!(z.anbieter_ref.is_none() && z.naechste_abfrage_at.is_none());
}

#[tokio::test]
async fn laeuft_fragt_eine_minute_spaeter_erneut() {
    let w = welt().await;
    let t0 = Utc::now();
    let id = w.uebergebenes_fax(t0).await;
    w.fax.plane_status(Ok(FaxStatus::Laeuft));
    let t1 = t0 + chrono::Duration::seconds(31);
    w.durchgang(t1).await;
    let z = w.zeile(&id).await;
    assert_eq!(z.zustand, VersandZustand::Uebergeben);
    let naechste =
        lifeline_hub::zeit::parse_utc(z.naechste_abfrage_at.as_deref().unwrap()).unwrap();
    assert!(((naechste - t1).num_seconds() - 60).abs() <= 1);
    // Vor der nächsten Abfrage wird nicht gefragt.
    w.durchgang(t1 + chrono::Duration::seconds(30)).await;
    assert_eq!(w.fax.abfragen(), 1);
    w.durchgang(t1 + chrono::Duration::seconds(61)).await;
    assert_eq!(w.fax.abfragen(), 2);
    assert_eq!(w.zeile(&id).await.zustand, VersandZustand::Zugestellt);
}

#[tokio::test]
async fn abfragefehler_fragt_spaeter_erneut() {
    let w = welt().await;
    let t0 = Utc::now();
    let id = w.uebergebenes_fax(t0).await;
    w.fax.plane_status(Err(SipgateFehler::Verbindung));
    w.durchgang(t0 + chrono::Duration::seconds(31)).await;
    let z = w.zeile(&id).await;
    assert_eq!(z.zustand, VersandZustand::Uebergeben);
    assert!(z.naechste_abfrage_at.is_some());
    assert!(w.etb_versand().await.is_empty());
}

#[tokio::test]
async fn ohne_endstand_nach_zwei_stunden_ungewiss() {
    let w = welt().await;
    let t0 = Utc::now();
    let id = w.uebergebenes_fax(t0).await;
    w.fax.plane_status(Ok(FaxStatus::Laeuft));
    w.durchgang(t0 + chrono::Duration::minutes(121)).await;
    let z = w.zeile(&id).await;
    assert_eq!(z.zustand, VersandZustand::Fehlgeschlagen);
    assert_eq!(z.fehler_art, Some(AusgangFehler::Ungewiss));
    assert_eq!(
        w.etb_versand().await[0].0,
        format!("Lagebericht Nr. 1 per Fax an {STELLE} ({FAXNUMMER}): Zustellung nicht bestätigt")
    );
}

#[tokio::test]
async fn vor_der_ersten_abfrage_wird_nicht_gefragt() {
    let w = welt().await;
    let t0 = Utc::now();
    w.uebergebenes_fax(t0).await;
    w.durchgang(t0 + chrono::Duration::seconds(29)).await;
    assert_eq!(w.fax.abfragen(), 0);
}

#[tokio::test]
async fn neustart_mit_uebergebenem_fax_fragt_weiter_und_sendet_nicht() {
    let w = welt().await;
    let t0 = Utc::now();
    let id = w.uebergebenes_fax(t0).await;
    lauf::beim_start(&w.pool, &w.live).await.unwrap();
    assert_eq!(w.zeile(&id).await.zustand, VersandZustand::Uebergeben);
    w.durchgang(t0 + chrono::Duration::seconds(31)).await;
    assert_eq!(w.fax.gesendet().len(), 1, "nicht erneut gesendet");
    assert_eq!(w.fax.abfragen(), 1);
    assert_eq!(w.zeile(&id).await.zustand, VersandZustand::Zugestellt);
}

#[tokio::test]
async fn eine_mail_auf_uebergeben_wird_nie_abgefragt() {
    let w = welt().await;
    let lid = w.lagebericht_freigeben(false).await;
    let t0 = Utc::now();
    let id = w.versand("lagebericht", lid, t0).await;
    w.durchgang(t0).await;
    w.durchgang(t0 + chrono::Duration::minutes(5)).await;
    assert_eq!(w.fax.abfragen(), 0);
    assert_eq!(w.zeile(&id).await.zustand, VersandZustand::Uebergeben);
}
