//! Routen des Ausgangskorbs (LLH-2093, Spec `docs/superpowers/specs/2026-11-24-w1ymakq6-ausgang-email-design.md`
//! Abschnitt 5): Senden an Lagebericht, Befehl und Nachforderung, Versandliste, „Erneut senden“,
//! Rechte, Org-Isolation und die 422-Codes.

use axum::http::StatusCode;
use lifeline_hub::live::LiveHub;
use serde_json::{json, Value};

mod adapter_testart;
mod common;
use common::{
    anfrage, anfrage_json, benutzer_anlegen, einsatz_anlegen_mit, fremde_org_anlegen, login_cookie,
    multipart_post, png_bytes, rolle_setzen,
};

struct Welt {
    app: axum::Router,
    pool: sqlx::SqlitePool,
    live: LiveHub,
    admin: String,
    einsatz: i64,
    org_id: i64,
    /// Zwei Kanaladressen (E-Mail) der Org.
    kanaele: Vec<i64>,
}

async fn stelle_mit_kanal(pool: &sqlx::SqlitePool, org_id: i64, name: &str, adresse: &str) -> i64 {
    stelle_mit(pool, org_id, name, "email", adresse).await
}

async fn stelle_mit(
    pool: &sqlx::SqlitePool,
    org_id: i64,
    name: &str,
    kanal: &str,
    adresse: &str,
) -> i64 {
    let stelle: i64 = sqlx::query_scalar(
        "INSERT INTO org_externe_stelle (org_id, bezeichnung, art) VALUES (?, ?, 'leitstelle') RETURNING id",
    )
    .bind(org_id)
    .bind(name)
    .fetch_one(pool)
    .await
    .unwrap();
    sqlx::query_scalar(
        "INSERT INTO org_externe_stelle_kanal (org_id, externe_stelle_id, kanal, adresse) \
         VALUES (?, ?, ?, ?) RETURNING id",
    )
    .bind(org_id)
    .bind(stelle)
    .bind(kanal)
    .bind(adresse)
    .fetch_one(pool)
    .await
    .unwrap()
}

async fn welt_mit(anbindung: bool) -> Welt {
    let pool = lifeline_hub::db::test_pool().await;
    lifeline_hub::auth::bootstrap::bootstrap_admin(&pool, "Test-Orga", "admin", Some("startpw12"))
        .await
        .unwrap();
    common::pool_merken(&pool);
    let live = LiveHub::new();
    let (rahmen, _smtp, _fax) = adapter_testart::rahmen_ausgang();
    let mut state = common::test_state(&pool, &live);
    state.adapter = rahmen;
    let app = lifeline_hub::app::build_router(state);
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen_mit(&app, &admin, "Hochwasser Süd").await;
    let org_id: i64 =
        sqlx::query_scalar("SELECT org_id FROM benutzer WHERE benutzername = 'admin'")
            .fetch_one(&pool)
            .await
            .unwrap();
    if anbindung {
        let body = json!({
            "art": "smtp", "name": "Ausgang",
            "einstellungen": {
                "host": "mail.example.org", "port": 587, "verschluesselung": "starttls",
                "benutzer": "versand", "absender": "einsatz@example.org"
            }
        });
        let (s, a) = anfrage_json(&app, "POST", "/api/admin/adapter", &admin, Some(&body)).await;
        assert_eq!(s, StatusCode::CREATED, "{a}");
        let id = a["id"].as_str().unwrap();
        let (s, v) = anfrage_json(
            &app,
            "PUT",
            &format!("/api/admin/adapter/{id}/secrets/passwort"),
            &admin,
            Some(&json!({ "wert": "Geheim-Passwort-4711" })),
        )
        .await;
        assert_eq!(s, StatusCode::NO_CONTENT, "{v}");
    }
    let k1 = stelle_mit_kanal(&pool, org_id, "Leitstelle Nord", "nord@leitstelle.example").await;
    let k2 = stelle_mit_kanal(&pool, org_id, "Kreisverwaltung", "lage@kreis.example").await;
    Welt {
        app,
        pool,
        live,
        admin,
        einsatz,
        org_id,
        kanaele: vec![k1, k2],
    }
}

async fn welt() -> Welt {
    welt_mit(true).await
}

impl Welt {
    fn lb(&self, rest: &str) -> String {
        format!("/api/incidents/{}/situation-reports{rest}", self.einsatz)
    }

    async fn lagebericht(&self, freigeben: bool) -> i64 {
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
        if freigeben {
            self.freigeben(lid).await;
        }
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

    fn senden_body(&self, client_id: &str, kanaele: &[i64]) -> String {
        json!({
            "client_id": client_id,
            "recipients": kanaele.iter().map(|k| json!({ "channel_id": k })).collect::<Vec<_>>()
        })
        .to_string()
    }

    async fn lb_senden(&self, lid: i64, client_id: &str, kanaele: &[i64]) -> (StatusCode, Value) {
        anfrage(
            &self.app,
            "POST",
            &self.lb(&format!("/{lid}/deliveries")),
            &self.admin,
            Some(&self.senden_body(client_id, kanaele)),
        )
        .await
    }

    /// Legt die Fax-Anbindung (sipgate) der Org mit Token an.
    async fn fax_anbindung(&self) {
        let body = json!({
            "art": "sipgate_fax", "name": "Fax",
            "einstellungen": { "token_id": "token-ABC", "faxline_id": "f0" }
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
            &format!("/api/admin/adapter/{id}/secrets/token"),
            &self.admin,
            Some(&json!({ "wert": "Geheim-Token-4711" })),
        )
        .await;
        assert_eq!(s, StatusCode::NO_CONTENT, "{v}");
    }

    /// Eine Faxnummer an einer neuen Stelle.
    async fn faxkanal(&self) -> i64 {
        stelle_mit(&self.pool, self.org_id, "Kreis Fax", "fax", "+49511123456").await
    }

    /// Ein freigegebener Lagebericht, dessen PDF über 30 Seiten hat.
    async fn langer_lagebericht(&self) -> i64 {
        let text = (1..=3000)
            .map(|n| format!("Zeile {n}: Pegel steigt weiter."))
            .collect::<Vec<_>>()
            .join("\n");
        let body = json!({
            "vorlage": "freitext", "titel": "Lage",
            "abschnitte": [{ "schluessel": "text", "text": text }]
        });
        let (s, lb) = anfrage(
            &self.app,
            "POST",
            &self.lb(""),
            &self.admin,
            Some(&body.to_string()),
        )
        .await;
        assert_eq!(s, StatusCode::CREATED, "{lb}");
        let lid = lb["id"].as_i64().unwrap();
        self.freigeben(lid).await;
        lid
    }

    async fn anzahl(&self) -> i64 {
        sqlx::query_scalar("SELECT COUNT(*) FROM ausgang")
            .fetch_one(&self.pool)
            .await
            .unwrap()
    }

    async fn nachforderung(&self) -> i64 {
        let (s, n) = anfrage(
            &self.app,
            "POST",
            &format!("/api/incidents/{}/resource-requests", self.einsatz),
            &self.admin,
            Some(
                &json!({
                    "art": "RTW", "bezeichnung": "2 RTW", "anzahl": 2,
                    "adressat_kategorie": "leitstelle", "adressat_bezeichnung": "Leitstelle Nord"
                })
                .to_string(),
            ),
        )
        .await;
        assert_eq!(s, StatusCode::CREATED, "{n}");
        n["id"].as_i64().unwrap()
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

    /// Eine Stelle mit einer Matrix-Kanaladresse.
    async fn matrix_kanal(&self) -> i64 {
        stelle_mit(
            &self.pool,
            self.org_id,
            "Lagedienst",
            "matrix",
            "#lage:example.org",
        )
        .await
    }

    async fn threema_anbindung(&self) {
        let body = json!({
            "art": "threema", "name": "Threema",
            "einstellungen": { "gateway_id": "*LAGE123" }
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
        for (platz, wert) in [
            ("secret", "geheim".to_string()),
            ("privater_schluessel", "05".repeat(32)),
        ] {
            let (s, v) = anfrage_json(
                &self.app,
                "PUT",
                &format!("/api/admin/adapter/{id}/secrets/{platz}"),
                &self.admin,
                Some(&json!({ "wert": wert })),
            )
            .await;
            assert_eq!(s, StatusCode::NO_CONTENT, "{v}");
        }
    }

    /// Eine Stelle mit einer Threema-ID.
    async fn threema_kanal(&self) -> i64 {
        stelle_mit(
            &self.pool,
            self.org_id,
            "Kreisverwaltung",
            "threema",
            "ECHOECHO",
        )
        .await
    }

    async fn setze_fehlgeschlagen(&self, id: &str) {
        sqlx::query(
            "UPDATE ausgang SET zustand = 'fehlgeschlagen', fehler_art = 'abgelehnt', \
             fehler_status = 550, versuche = 1 WHERE id = ?",
        )
        .bind(id)
        .execute(&self.pool)
        .await
        .unwrap();
    }
}

#[tokio::test]
async fn senden_legt_je_empfaenger_einen_versand_an() {
    let w = welt().await;
    let lid = w.lagebericht(true).await;
    let mut rx = w.live.abonniere(w.einsatz);

    let (s, v) = w.lb_senden(lid, "klick-1", &w.kanaele).await;

    assert_eq!(s, StatusCode::CREATED, "{v}");
    let liste = v.as_array().unwrap();
    assert_eq!(liste.len(), 2);
    assert_eq!(liste[0]["state"], "wartet");
    assert_eq!(liste[0]["source_kind"], "lagebericht");
    assert_eq!(liste[0]["source_id"], lid);
    assert_eq!(liste[0]["channel"], "email");
    assert_eq!(liste[0]["agency_name"], "Leitstelle Nord");
    assert_eq!(liste[0]["address"], "nord@leitstelle.example");
    assert!(liste[0]["subject"]
        .as_str()
        .unwrap()
        .starts_with("Lagebericht Nr. 1 – Hochwasser Süd"));
    assert_eq!(liste[1]["address"], "lage@kreis.example");
    assert_eq!(w.anzahl().await, 2);
    // Abgeleitete client_id je Empfänger.
    let cids: Vec<String> = sqlx::query_scalar("SELECT client_id FROM ausgang ORDER BY id")
        .fetch_all(&w.pool)
        .await
        .unwrap();
    assert!(
        cids.contains(&format!("klick-1:{}", w.kanaele[0])),
        "{cids:?}"
    );
    // Live-Ereignis für die Versandliste.
    let mut gesehen = false;
    while let Ok(e) = rx.try_recv() {
        gesehen |= format!("{e:?}").contains("ausgang") || format!("{e:?}").contains("Ausgang");
    }
    assert!(gesehen, "kein Live-Ereignis ausgang");

    // Liste der Quelle.
    let (s, l) = anfrage(
        &w.app,
        "GET",
        &format!(
            "/api/incidents/{}/deliveries?source_kind=lagebericht&source_id={lid}",
            w.einsatz
        ),
        &w.admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{l}");
    assert_eq!(l.as_array().unwrap().len(), 2);
    // Ohne Filter: alle des Einsatzes.
    let (s, l) = anfrage(
        &w.app,
        "GET",
        &format!("/api/incidents/{}/deliveries", w.einsatz),
        &w.admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{l}");
    assert_eq!(l.as_array().unwrap().len(), 2);
}

#[tokio::test]
async fn doppelklick_mit_gleicher_client_id_ein_versand() {
    let w = welt().await;
    let lid = w.lagebericht(true).await;

    let (s1, v1) = w.lb_senden(lid, "klick-2", &w.kanaele[..1]).await;
    let (s2, v2) = w.lb_senden(lid, "klick-2", &w.kanaele[..1]).await;

    assert_eq!(s1, StatusCode::CREATED, "{v1}");
    assert_eq!(s2, StatusCode::CREATED, "{v2}");
    assert_eq!(v1[0]["id"], v2[0]["id"]);
    assert_eq!(w.anzahl().await, 1);
}

#[tokio::test]
async fn gleiche_client_id_an_anderer_quelle_ist_409() {
    let w = welt().await;
    let a = w.lagebericht(true).await;
    let b = w.lagebericht(true).await;
    let (s, _) = w.lb_senden(a, "doppelt", &w.kanaele[..1]).await;
    assert_eq!(s, StatusCode::CREATED);
    let (s, v) = w.lb_senden(b, "doppelt", &w.kanaele[..1]).await;
    assert_eq!(s, StatusCode::CONFLICT, "{v}");
    assert_eq!(w.anzahl().await, 1);
}

#[tokio::test]
async fn entwurf_senden_ist_422() {
    let w = welt().await;
    let lid = w.lagebericht(false).await;
    let (s, v) = w.lb_senden(lid, "e-1", &w.kanaele[..1]).await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY, "{v}");
    assert_eq!(w.anzahl().await, 0);
}

#[tokio::test]
async fn ueberholte_fassung_senden_ist_422_ueberholt() {
    let w = welt().await;
    let lid = w.lagebericht(true).await;
    w.fortschreiben_und_freigeben(lid).await;
    let (s, v) = w.lb_senden(lid, "u-1", &w.kanaele[..1]).await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY, "{v}");
    assert_eq!(v["grund"], "ueberholt");
}

#[tokio::test]
async fn ohne_mailserver_ist_422_anbindung_fehlt() {
    let w = welt_mit(false).await;
    let lid = w.lagebericht(true).await;
    let (s, v) = w.lb_senden(lid, "m-1", &w.kanaele[..1]).await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY, "{v}");
    assert_eq!(v["grund"], "anbindung_fehlt");
    assert_eq!(v["error"], "Kein Mailserver eingerichtet");
    assert_eq!(w.anzahl().await, 0);
}

#[tokio::test]
async fn angehaltener_mailserver_ist_422_anbindung_angehalten() {
    let w = welt().await;
    let lid = w.lagebericht(true).await;
    sqlx::query("UPDATE adapter SET zustand = 'angehalten', angehalten_at = datetime('now') WHERE art = 'smtp'")
        .execute(&w.pool)
        .await
        .unwrap();
    let (s, v) = w.lb_senden(lid, "m-2", &w.kanaele[..1]).await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY, "{v}");
    assert_eq!(v["grund"], "anbindung_angehalten");
}

#[tokio::test]
async fn spiegel_ist_422() {
    let w = welt().await;
    let lid = w.lagebericht(true).await;
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

    let (s, v) = w.lb_senden(lid, "s-1", &w.kanaele[..1]).await;

    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY, "{v}");
    assert_eq!(v["grund"], "spiegel");
    assert_eq!(w.anzahl().await, 0);
}

#[tokio::test]
async fn leser_ohne_schreibrecht_403() {
    let w = welt().await;
    let lid = w.lagebericht(true).await;
    let beob = benutzer_anlegen(&w.app, &w.admin, "beobachter", "keine").await;
    rolle_setzen(&w.app, &w.admin, w.einsatz, beob, "beobachter").await;
    let cookie = login_cookie(&w.app, "beobachter", "beobachterpw1").await;

    let (s, v) = anfrage(
        &w.app,
        "POST",
        &w.lb(&format!("/{lid}/deliveries")),
        &cookie,
        Some(&w.senden_body("l-1", &w.kanaele[..1])),
    )
    .await;
    assert_eq!(s, StatusCode::FORBIDDEN, "{v}");

    // Lesen der Liste darf er.
    let (s, _) = anfrage(
        &w.app,
        "GET",
        &format!("/api/incidents/{}/deliveries", w.einsatz),
        &cookie,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(w.anzahl().await, 0);
}

#[tokio::test]
async fn fremde_kanaladresse_404() {
    let w = welt().await;
    let lid = w.lagebericht(true).await;
    let (fremd_org, _) =
        fremde_org_anlegen(&w.pool, "Fremd", "fremder", "fremderpw1", "keine").await;
    let fremd = stelle_mit_kanal(&w.pool, fremd_org, "Fremdstelle", "x@fremd.example").await;
    assert_ne!(fremd_org, w.org_id);

    let (s, v) = w.lb_senden(lid, "f-1", &[w.kanaele[0], fremd]).await;

    assert_eq!(s, StatusCode::NOT_FOUND, "{v}");
    assert_eq!(w.anzahl().await, 0, "nichts darf halb angelegt sein");
}

#[tokio::test]
async fn threema_versand_ohne_threema_anbindung_ist_422_anbindung_fehlt() {
    // Seit LLH-2096 nimmt der Ausgang Threema an; ohne Anbindung fehlt der Weg.
    let w = welt().await;
    let lid = w.lagebericht(true).await;
    sqlx::query(
        "UPDATE org_externe_stelle_kanal SET kanal = 'threema', adresse = 'ABCD1234' WHERE id = ?",
    )
    .bind(w.kanaele[0])
    .execute(&w.pool)
    .await
    .unwrap();
    let (s, v) = w.lb_senden(lid, "f-1", &[w.kanaele[0]]).await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY, "{v}");
    assert!(v.to_string().contains("anbindung_fehlt"), "{v}");
    assert_eq!(w.anzahl().await, 0);
}

#[tokio::test]
async fn matrix_versand_ohne_matrix_anbindung_ist_422_anbindung_fehlt() {
    // SMTP ist eingerichtet, Matrix nicht.
    let w = welt().await;
    let lid = w.lagebericht(true).await;
    let mk = w.matrix_kanal().await;
    let (s, v) = w.lb_senden(lid, "m-1", &[mk]).await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY, "{v}");
    assert_eq!(v["grund"], "anbindung_fehlt");
    assert_eq!(v["error"], "Kein Matrix-Konto eingerichtet");
    assert_eq!(w.anzahl().await, 0);
}

#[tokio::test]
async fn ohne_threema_anbindung_422_mit_text() {
    let w = welt().await;
    let lid = w.lagebericht(true).await;
    let tk = w.threema_kanal().await;
    let (s, v) = w.lb_senden(lid, "t-1", &[tk]).await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY, "{v}");
    assert_eq!(v["grund"], "anbindung_fehlt");
    assert_eq!(v["error"], "Kein Threema-Gateway eingerichtet");
    assert_eq!(w.anzahl().await, 0);
}

#[tokio::test]
async fn matrix_und_threema_fehlen_in_einer_ablehnung() {
    let w = welt().await;
    let lid = w.lagebericht(true).await;
    let mk = w.matrix_kanal().await;
    let tk = w.threema_kanal().await;
    let (s, v) = w.lb_senden(lid, "t-2", &[mk, tk, w.kanaele[0]]).await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY, "{v}");
    assert_eq!(v["grund"], "anbindung_fehlt");
    assert_eq!(
        v["error"],
        "Kein Matrix-Konto eingerichtet; Kein Threema-Gateway eingerichtet"
    );
    assert_eq!(w.anzahl().await, 0);
}

#[tokio::test]
async fn threema_mit_anbindung_legt_versand_an() {
    let w = welt_mit(false).await;
    w.threema_anbindung().await;
    let lid = w.lagebericht(true).await;
    let tk = w.threema_kanal().await;
    let (s, v) = w.lb_senden(lid, "t-3", &[tk]).await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
    assert_eq!(v[0]["channel"], "threema", "{v}");
    assert_eq!(v[0]["address"], "ECHOECHO", "{v}");
}

#[tokio::test]
async fn angehaltenes_matrix_konto_ist_422_anbindung_angehalten() {
    let w = welt().await;
    w.matrix_anbindung().await;
    let lid = w.lagebericht(true).await;
    let mk = w.matrix_kanal().await;
    sqlx::query("UPDATE adapter SET zustand = 'angehalten', angehalten_at = datetime('now') WHERE art = 'matrix'")
        .execute(&w.pool)
        .await
        .unwrap();
    let (s, v) = w.lb_senden(lid, "m-2", &[mk]).await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY, "{v}");
    assert_eq!(v["grund"], "anbindung_angehalten");
    assert_eq!(v["error"], "Das Matrix-Konto ist angehalten");
    // E-Mail allein geht weiter.
    let (s, v) = w.lb_senden(lid, "m-3", &w.kanaele[..1]).await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
}

#[tokio::test]
async fn matrix_versand_mit_matrix_anbindung_legt_an() {
    // Nur Matrix: ein fehlender Mailserver stört nicht.
    let w = welt_mit(false).await;
    w.matrix_anbindung().await;
    let lid = w.lagebericht(true).await;
    let mk = w.matrix_kanal().await;
    let (s, v) = w.lb_senden(lid, "m-4", &[mk]).await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
    assert_eq!(v[0]["channel"], "matrix", "{v}");
    assert_eq!(v[0]["address"], "#lage:example.org", "{v}");
}

#[tokio::test]
async fn gemischte_empfaenger_brauchen_beide_anbindungen() {
    // Mailserver da, Matrix fehlt: die Matrix-Meldung, nichts angelegt.
    let w = welt().await;
    let lid = w.lagebericht(true).await;
    let mk_w = w.matrix_kanal().await;
    let (s, v) = w.lb_senden(lid, "g-1", &[w.kanaele[0], mk_w]).await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY, "{v}");
    assert_eq!(v["error"], "Kein Matrix-Konto eingerichtet");
    assert_eq!(w.anzahl().await, 0);

    // Matrix da, Mailserver fehlt: die Mail-Meldung, nichts angelegt.
    let o = welt_mit(false).await;
    o.matrix_anbindung().await;
    let lid = o.lagebericht(true).await;
    let mk = o.matrix_kanal().await;
    let (s, v) = o.lb_senden(lid, "g-2", &[mk, o.kanaele[0]]).await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY, "{v}");
    assert_eq!(v["error"], "Kein Mailserver eingerichtet");
    assert_eq!(o.anzahl().await, 0);

    // Beide da: je Empfänger ein Versand in seinem Kanal.
    w.matrix_anbindung().await;
    let lid = w.lagebericht(true).await;
    let (s, v) = w.lb_senden(lid, "g-3", &[w.kanaele[0], mk_w]).await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
    let kanaele: Vec<&str> = v
        .as_array()
        .unwrap()
        .iter()
        .map(|x| x["channel"].as_str().unwrap())
        .collect();
    assert_eq!(kanaele, ["email", "matrix"], "{v}");
}

#[tokio::test]
async fn inaktive_stelle_ist_422() {
    let w = welt().await;
    let lid = w.lagebericht(true).await;
    sqlx::query("UPDATE org_externe_stelle SET aktiv = 0 WHERE bezeichnung = 'Kreisverwaltung'")
        .execute(&w.pool)
        .await
        .unwrap();
    let (s, v) = w.lb_senden(lid, "i-1", &[w.kanaele[1]]).await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY, "{v}");
}

#[tokio::test]
async fn empfaengerliste_wird_geprueft() {
    let w = welt().await;
    let lid = w.lagebericht(true).await;
    let (s, _) = w.lb_senden(lid, "r-1", &[]).await;
    assert_eq!(s, StatusCode::BAD_REQUEST, "leer");
    let (s, _) = w.lb_senden(lid, "r-2", &[w.kanaele[0], w.kanaele[0]]).await;
    assert_eq!(s, StatusCode::BAD_REQUEST, "doppelte Adresse");
    let viele: Vec<i64> = (1..=21).collect();
    let (s, _) = w.lb_senden(lid, "r-3", &viele).await;
    assert_eq!(s, StatusCode::BAD_REQUEST, "mehr als 20");
    let (s, _) = w.lb_senden(lid, "  ", &w.kanaele[..1]).await;
    assert_eq!(s, StatusCode::BAD_REQUEST, "client_id leer");
    let lang = "x".repeat(65);
    let (s, _) = w.lb_senden(lid, &lang, &w.kanaele[..1]).await;
    assert_eq!(s, StatusCode::BAD_REQUEST, "client_id zu lang");
    assert_eq!(w.anzahl().await, 0);
}

#[tokio::test]
async fn erneut_senden_aus_fehlgeschlagen_setzt_wartet() {
    let w = welt().await;
    let lid = w.lagebericht(true).await;
    let (_, v) = w.lb_senden(lid, "w-1", &w.kanaele[..1]).await;
    let id = v[0]["id"].as_str().unwrap().to_string();
    let url = format!("/api/incidents/{}/deliveries/{id}/retry", w.einsatz);

    // Aus `wartet` nicht.
    let (s, v) = anfrage(&w.app, "POST", &url, &w.admin, None).await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY, "{v}");

    w.setze_fehlgeschlagen(&id).await;
    let (s, v) = anfrage(&w.app, "POST", &url, &w.admin, None).await;

    assert_eq!(s, StatusCode::OK, "{v}");
    assert_eq!(v["state"], "wartet");
    assert_eq!(v["attempts"], 0);
    assert!(v.get("error").is_none(), "{v}");
}

#[tokio::test]
async fn erneut_senden_ueberholter_fassung_422() {
    let w = welt().await;
    let lid = w.lagebericht(true).await;
    let (_, v) = w.lb_senden(lid, "w-2", &w.kanaele[..1]).await;
    let id = v[0]["id"].as_str().unwrap().to_string();
    w.setze_fehlgeschlagen(&id).await;
    w.fortschreiben_und_freigeben(lid).await;

    let (s, v) = anfrage(
        &w.app,
        "POST",
        &format!("/api/incidents/{}/deliveries/{id}/retry", w.einsatz),
        &w.admin,
        None,
    )
    .await;

    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY, "{v}");
    assert_eq!(v["grund"], "ueberholt");
    let zustand: String = sqlx::query_scalar("SELECT zustand FROM ausgang WHERE id = ?")
        .bind(&id)
        .fetch_one(&w.pool)
        .await
        .unwrap();
    assert_eq!(zustand, "fehlgeschlagen");
}

#[tokio::test]
async fn erneut_senden_fremder_versand_404_und_leser_403() {
    let w = welt().await;
    let lid = w.lagebericht(true).await;
    let (_, v) = w.lb_senden(lid, "w-3", &w.kanaele[..1]).await;
    let id = v[0]["id"].as_str().unwrap().to_string();
    w.setze_fehlgeschlagen(&id).await;
    // Anderer Einsatz derselben Org: der Versand gehört nicht dazu.
    let anderer = einsatz_anlegen_mit(&w.app, &w.admin, "Anderer").await;
    let (s, _) = anfrage(
        &w.app,
        "POST",
        &format!("/api/incidents/{anderer}/deliveries/{id}/retry"),
        &w.admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::NOT_FOUND);

    let beob = benutzer_anlegen(&w.app, &w.admin, "beobachter", "keine").await;
    rolle_setzen(&w.app, &w.admin, w.einsatz, beob, "beobachter").await;
    let cookie = login_cookie(&w.app, "beobachter", "beobachterpw1").await;
    let (s, _) = anfrage(
        &w.app,
        "POST",
        &format!("/api/incidents/{}/deliveries/{id}/retry", w.einsatz),
        &cookie,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn nachforderung_senden_und_zurueckgezogen_ist_422() {
    let w = welt().await;
    let nid = w.nachforderung().await;
    let url = format!(
        "/api/incidents/{}/resource-requests/{nid}/deliveries",
        w.einsatz
    );

    let (s, v) = anfrage(
        &w.app,
        "POST",
        &url,
        &w.admin,
        Some(&w.senden_body("n-1", &w.kanaele[..1])),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
    assert_eq!(v[0]["source_kind"], "nachforderung");
    assert!(v[0]["subject"]
        .as_str()
        .unwrap()
        .starts_with("Nachforderung:"));

    let (s, v) = anfrage(
        &w.app,
        "POST",
        &format!(
            "/api/incidents/{}/resource-requests/{nid}/withdraw",
            w.einsatz
        ),
        &w.admin,
        Some("{}"),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");

    let (s, v) = anfrage(
        &w.app,
        "POST",
        &url,
        &w.admin,
        Some(&w.senden_body("n-2", &w.kanaele[..1])),
    )
    .await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY, "{v}");
    assert_eq!(w.anzahl().await, 1);
}

#[tokio::test]
async fn befehl_senden() {
    let w = welt().await;
    let (s, b) = anfrage(
        &w.app,
        "POST",
        &format!("/api/incidents/{}/orders", w.einsatz),
        &w.admin,
        Some(r#"{"vorlage":"befehl_lad","titel":"Erstbefehl"}"#),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{b}");
    let bid = b["id"].as_i64().unwrap();
    let url = format!("/api/incidents/{}/orders/{bid}/deliveries", w.einsatz);
    let (s, v) = anfrage(
        &w.app,
        "PATCH",
        &format!("/api/incidents/{}/orders/{bid}", w.einsatz),
        &w.admin,
        Some(r#"{"abschnitte":[{"schluessel":"lage","text":"Hochwasser steigt."},{"schluessel":"auftrag","text":"Sandsäcke füllen."},{"schluessel":"durchfuehrung","text":"Zug 2 rückt aus."}]}"#),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    let (s, v) = anfrage(
        &w.app,
        "POST",
        &url,
        &w.admin,
        Some(&w.senden_body("b-0", &w.kanaele[..1])),
    )
    .await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY, "Entwurf: {v}");

    let (s, v) = anfrage(
        &w.app,
        "POST",
        &format!("/api/incidents/{}/orders/{bid}/release", w.einsatz),
        &w.admin,
        None,
    )
    .await;
    assert!(s.is_success(), "Freigabe: {s} {v}");
    let (s, v) = anfrage(
        &w.app,
        "POST",
        &url,
        &w.admin,
        Some(&w.senden_body("b-1", &w.kanaele[..1])),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
    assert_eq!(v[0]["source_kind"], "befehl");
    assert!(v[0]["subject"]
        .as_str()
        .unwrap()
        .starts_with("Einsatzbefehl Nr. 1"));
}

#[tokio::test]
async fn liste_ohne_filter_zeigt_nur_lesbare_quellarten() {
    let w = welt().await;
    let lid = w.lagebericht(true).await;
    let (s, _) = w.lb_senden(lid, "z-1", &w.kanaele[..1]).await;
    assert_eq!(s, StatusCode::CREATED);
    // Ein Mitarbeiter, dem das Modul der Lageberichte ausgeblendet ist, sieht keinen Versand
    // dazu; der Admin sieht ihn weiter.
    let mit = benutzer_anlegen(&w.app, &w.admin, "mitarbeiter", "keine").await;
    rolle_setzen(&w.app, &w.admin, w.einsatz, mit, "mitarbeit").await;
    let cookie = login_cookie(&w.app, "mitarbeiter", "mitarbeiterpw1").await;
    let url = format!("/api/incidents/{}/deliveries", w.einsatz);
    let (s, l) = anfrage(&w.app, "GET", &url, &cookie, None).await;
    assert_eq!(s, StatusCode::OK, "{l}");
    assert_eq!(l.as_array().unwrap().len(), 1, "vorher sichtbar");
    let (s, v) = anfrage(
        &w.app,
        "PUT",
        &format!("/api/incidents/{}/module-overrides/lageberichte", w.einsatz),
        &w.admin,
        Some(r#"{"sichtbar":false,"benoetigte_rolle":null}"#),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    let (s, l) = anfrage(&w.app, "GET", &url, &cookie, None).await;
    assert_eq!(s, StatusCode::OK, "{l}");
    assert!(l.as_array().unwrap().is_empty(), "{l}");
    let (s, _) = anfrage(
        &w.app,
        "GET",
        &format!("{url}?source_kind=lagebericht"),
        &cookie,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::FORBIDDEN);
    let (s, l) = anfrage(&w.app, "GET", &url, &w.admin, None).await;
    assert_eq!(s, StatusCode::OK, "{l}");
    assert_eq!(l.as_array().unwrap().len(), 1);
    // Ungültiger Filter.
    let (s, _) = anfrage(
        &w.app,
        "GET",
        &format!(
            "/api/incidents/{}/deliveries?source_kind=quatsch",
            w.einsatz
        ),
        &w.admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn anlegen_klappt_auch_wenn_das_geheimnis_nicht_lesbar_ist() {
    let w = welt().await;
    let lid = w.lagebericht(true).await;
    // Das gespeicherte Passwort wird unlesbar; Entschlüsseln würde scheitern.
    sqlx::query("UPDATE adapter_geheimnis SET chiffrat = x'00'")
        .execute(&w.pool)
        .await
        .unwrap();
    let (s, v) = w.lb_senden(lid, "m-geheim", &w.kanaele[..1]).await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
    assert_eq!(w.anzahl().await, 1);
}

#[tokio::test]
async fn wiederholte_anfrage_liefert_die_versaende_auch_wenn_sich_die_umstaende_aendern() {
    let w = welt().await;
    let lid = w.lagebericht(true).await;
    let (s1, v1) = w.lb_senden(lid, "replay-1", &w.kanaele).await;
    assert_eq!(s1, StatusCode::CREATED, "{v1}");

    // Die Antwort ging verloren; inzwischen ist der Mailserver angehalten und eine neuere
    // Fassung freigegeben.
    sqlx::query("UPDATE adapter SET zustand = 'angehalten', angehalten_at = datetime('now') WHERE art = 'smtp'")
        .execute(&w.pool)
        .await
        .unwrap();
    w.fortschreiben_und_freigeben(lid).await;

    let (s2, v2) = w.lb_senden(lid, "replay-1", &w.kanaele).await;
    assert_eq!(s2, StatusCode::CREATED, "{v2}");
    let ids = |v: &Value| -> Vec<Value> {
        v.as_array()
            .unwrap()
            .iter()
            .map(|x| x["id"].clone())
            .collect()
    };
    assert_eq!(ids(&v1), ids(&v2));
    assert_eq!(w.anzahl().await, 2);

    // Fehlt ein Empfänger noch, gelten für ihn die Prüfungen.
    let (s, v) = w.lb_senden(lid, "replay-2", &w.kanaele[..1]).await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY, "{v}");
    assert_eq!(w.anzahl().await, 2);
}

#[tokio::test]
async fn wiederholte_anfrage_mit_einem_neuen_empfaenger_prueft_nur_den_neuen() {
    let w = welt().await;
    let lid = w.lagebericht(true).await;
    let (s, v1) = w.lb_senden(lid, "teil-1", &w.kanaele[..1]).await;
    assert_eq!(s, StatusCode::CREATED, "{v1}");
    sqlx::query("UPDATE adapter SET zustand = 'angehalten', angehalten_at = datetime('now') WHERE art = 'smtp'")
        .execute(&w.pool)
        .await
        .unwrap();
    // Der neue Empfänger scheitert an der angehaltenen Anbindung, der vorhandene bleibt.
    let (s, v) = w.lb_senden(lid, "teil-1", &w.kanaele).await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY, "{v}");
    assert_eq!(v["grund"], "anbindung_angehalten");
    assert_eq!(w.anzahl().await, 1);
    sqlx::query("UPDATE adapter SET zustand = 'aktiv', angehalten_at = NULL WHERE art = 'smtp'")
        .execute(&w.pool)
        .await
        .unwrap();
    let (s, v2) = w.lb_senden(lid, "teil-1", &w.kanaele).await;
    assert_eq!(s, StatusCode::CREATED, "{v2}");
    assert_eq!(v2.as_array().unwrap().len(), 2);
    assert_eq!(v2[0]["id"], v1[0]["id"]);
    assert_eq!(w.anzahl().await, 2);
}

/// Legt einen Lagebericht mit einer PNG-Anlage an, gibt ihn frei und liefert (Lagebericht,
/// anhang.id der Anlage).
async fn lagebericht_mit_anlage(w: &Welt) -> (i64, i64) {
    let lid = w.lagebericht(false).await;
    let png = png_bytes(32, 24);
    let (s, v) = multipart_post(
        &w.app,
        &w.lb(&format!("/{lid}/enclosures")),
        &w.admin,
        Some(("skizze.png", &png)),
        &[
            ("art", "fernmeldeskizze"),
            ("titel", "Fernmeldeskizze"),
            ("stand_at", "2026-10-08 12:15:00"),
        ],
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
    w.freigeben(lid).await;
    let anhang_id: i64 = sqlx::query_scalar(
        "SELECT a.id FROM anhang a WHERE a.einsatz_id = ? AND a.mime = 'image/png' \
         ORDER BY a.id DESC LIMIT 1",
    )
    .bind(w.einsatz)
    .fetch_one(&w.pool)
    .await
    .unwrap();
    (lid, anhang_id)
}

const UEBER_20_MIB: i64 = 20 * 1024 * 1024 + 1;

#[tokio::test]
async fn anlagen_ueber_20_mib_nach_gespeicherter_groesse_sind_422_zu_gross() {
    let w = welt().await;
    let (lid, anhang_id) = lagebericht_mit_anlage(&w).await;
    sqlx::query("UPDATE anhang SET groesse = ? WHERE id = ?")
        .bind(UEBER_20_MIB)
        .bind(anhang_id)
        .execute(&w.pool)
        .await
        .unwrap();
    let (s, v) = w.lb_senden(lid, "gross-1", &w.kanaele[..1]).await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY, "{v}");
    assert_eq!(v["grund"], "zu_gross");
    assert_eq!(w.anzahl().await, 0);
}

#[tokio::test]
async fn anlegen_liest_keine_anlagenbytes_sondern_die_gespeicherte_groesse() {
    let w = welt().await;
    let (lid, anhang_id) = lagebericht_mit_anlage(&w).await;
    // Die Bytes sind größer als die gespeicherte Größe: das Anlegen sieht sie nicht (erst der
    // Lauf prüft die echten Bytes).
    sqlx::query("UPDATE anhang SET daten = zeroblob(?) WHERE id = ?")
        .bind(UEBER_20_MIB)
        .bind(anhang_id)
        .execute(&w.pool)
        .await
        .unwrap();
    let (s, v) = w.lb_senden(lid, "gross-2", &w.kanaele[..1]).await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
    assert_eq!(w.anzahl().await, 1);
}

#[tokio::test]
async fn fax_senden_legt_einen_versand_an_die_faxnummer_an() {
    let w = welt().await;
    w.fax_anbindung().await;
    let fax = w.faxkanal().await;
    let lid = w.lagebericht(true).await;
    let (s, v) = w.lb_senden(lid, "fax-1", &[fax]).await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
    assert_eq!(v[0]["channel"], "fax");
    assert_eq!(v[0]["address"], "+49511123456");
    assert_eq!(v[0]["state"], "wartet");
    assert_eq!(v[0]["without_pdf"], false);
}

#[tokio::test]
async fn fax_ohne_faxzugang_ist_anbindung_fehlt() {
    let w = welt().await;
    let fax = w.faxkanal().await;
    let lid = w.lagebericht(true).await;
    let (s, v) = w.lb_senden(lid, "fax-2", &[fax]).await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY, "{v}");
    assert_eq!(v["grund"], "anbindung_fehlt");
    assert!(
        v["error"].as_str().unwrap_or_default().contains("Fax"),
        "{v}"
    );
    assert_eq!(w.anzahl().await, 0);
}

#[tokio::test]
async fn mail_ohne_mailzugang_aber_mit_faxzugang_ist_anbindung_fehlt() {
    let w = welt_mit(false).await;
    w.fax_anbindung().await;
    let lid = w.lagebericht(true).await;
    let (s, v) = w.lb_senden(lid, "mail-1", &w.kanaele[..1]).await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY, "{v}");
    assert_eq!(v["grund"], "anbindung_fehlt");
    assert!(
        v["error"]
            .as_str()
            .unwrap_or_default()
            .contains("Mailserver"),
        "{v}"
    );
}

#[tokio::test]
async fn ein_fax_ueber_30_seiten_wird_beim_anlegen_abgelehnt() {
    let w = welt().await;
    w.fax_anbindung().await;
    let fax = w.faxkanal().await;
    let lid = w.langer_lagebericht().await;
    let (s, v) = w.lb_senden(lid, "fax-lang", &[fax]).await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY, "{v}");
    assert_eq!(v["grund"], "zu_gross");
    assert_eq!(w.anzahl().await, 0);
}

#[tokio::test]
async fn mail_und_fax_zusammen_werden_ganz_abgelehnt_wenn_das_fax_zu_gross_ist() {
    let w = welt().await;
    w.fax_anbindung().await;
    let fax = w.faxkanal().await;
    let lid = w.langer_lagebericht().await;
    let (s, v) = w.lb_senden(lid, "beide-lang", &[w.kanaele[0], fax]).await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY, "{v}");
    assert_eq!(v["grund"], "zu_gross");
    assert_eq!(w.anzahl().await, 0, "keine Zeile, auch nicht für die Mail");
}

#[tokio::test]
async fn eine_lange_mail_ist_nicht_begrenzt() {
    let w = welt().await;
    let lid = w.langer_lagebericht().await;
    let (s, v) = w.lb_senden(lid, "mail-lang", &w.kanaele[..1]).await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
    assert_eq!(w.anzahl().await, 1);
}
