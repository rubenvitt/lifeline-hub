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
         VALUES (?, ?, 'email', ?) RETURNING id",
    )
    .bind(org_id)
    .bind(stelle)
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
    let (rahmen, _pruefer) = adapter_testart::rahmen_smtp();
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
