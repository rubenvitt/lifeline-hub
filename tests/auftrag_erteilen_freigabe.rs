//! „Auftrag erteilen" aus einem ETB-Eintrag und aus einer Meldung schreibt in die Aufträge, also
//! gilt deren Modulfreigabe (LFH-1051, Spec `modul-freigabe`), wie beim Heraufstufen aus dem Chat.
//! Schreibrecht im Quellmodul allein ist kein Weg an gesperrten Aufträgen vorbei.

use axum::http::StatusCode;
use serde_json::Value;

mod common;
use common::{anfrage, benutzer_anlegen, einsatz_anlegen, login_cookie, rolle_setzen, setup};

const AUFTRAG_BODY: &str = r#"{"auftrag_text":"Sandsäcke","empfaenger":[{"empfaenger_typ":"funktion","funktion_text":"S4"}]}"#;

/// Die beiden Wege: Pfadsegment unter `/api/einsaetze/{id}/` des Quellmoduls.
#[derive(Clone, Copy, Debug)]
enum Quelle {
    Etb,
    Meldung,
}

impl Quelle {
    fn segment(self) -> &'static str {
        match self {
            Quelle::Etb => "etb",
            Quelle::Meldung => "meldungen",
        }
    }

    /// Legt als `cookie` einen Quelldatensatz an; liefert seine ID.
    async fn anlegen(self, app: &axum::Router, einsatz: i64, cookie: &str) -> i64 {
        let body = match self {
            Quelle::Etb => r#"{"von":"ELW 1","an":"ELW 1","typ":"meldung","inhalt":"Deich km12"}"#,
            Quelle::Meldung => {
                r#"{"absender":"Florian Nord 1","empfaenger":"ELW 1","meldeweg":"funk","inhalt":"Deich km12","ereigniszeit":"2026-06-12 09:00:00"}"#
            }
        };
        let (s, v) = anfrage(
            app,
            "POST",
            &format!("/api/einsaetze/{einsatz}/{}", self.segment()),
            cookie,
            Some(body),
        )
        .await;
        assert!(s.is_success(), "{self:?}: {s} {v}");
        v["id"].as_i64().unwrap()
    }

    fn erteilen_pfad(self, einsatz: i64, id: i64) -> String {
        format!("/api/einsaetze/{einsatz}/{}/{id}/auftrag", self.segment())
    }
}

async fn fuehrungsperson(app: &axum::Router, admin: &str, einsatz: i64) -> String {
    let id = benutzer_anlegen(app, admin, "frieda", "keine").await;
    rolle_setzen(app, admin, einsatz, id, "fuehrungspersonal").await;
    login_cookie(app, "frieda", "friedapw1").await
}

/// Beschränkt ein Modul des Einsatzes auf System-Admins (Override, LFH-132).
async fn nur_fuer_admins(app: &axum::Router, admin: &str, einsatz: i64, modul: &str) {
    let (s, v) = anfrage(
        app,
        "PUT",
        &format!("/api/einsaetze/{einsatz}/modul-overrides/{modul}"),
        admin,
        Some(r#"{"sichtbar":true,"benoetigte_rolle":"admin"}"#),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
}

async fn auftraege(app: &axum::Router, einsatz: i64, admin: &str) -> usize {
    let (_, liste) = anfrage(
        app,
        "GET",
        &format!("/api/einsaetze/{einsatz}/auftraege"),
        admin,
        None,
    )
    .await;
    liste.as_array().unwrap().len()
}

async fn anordnungen(app: &axum::Router, einsatz: i64, admin: &str) -> usize {
    let (_, etb) = anfrage(
        app,
        "GET",
        &format!("/api/einsaetze/{einsatz}/etb"),
        admin,
        None,
    )
    .await;
    etb.as_array()
        .unwrap()
        .iter()
        .filter(|e| e["typ"] == "anordnung")
        .count()
}

#[tokio::test]
async fn auftrag_erteilen_ohne_auftrags_freigabe_ist_403() {
    for quelle in [Quelle::Etb, Quelle::Meldung] {
        let app = setup().await;
        let admin = login_cookie(&app, "admin", "startpw12").await;
        let einsatz = einsatz_anlegen(&app, &admin).await;
        let frieda = fuehrungsperson(&app, &admin, einsatz).await;
        let id = quelle.anlegen(&app, einsatz, &frieda).await;
        nur_fuer_admins(&app, &admin, einsatz, "auftraege").await;
        let anordnungen_vorher = anordnungen(&app, einsatz, &admin).await;

        let (s, v) = anfrage(
            &app,
            "POST",
            &quelle.erteilen_pfad(einsatz, id),
            &frieda,
            Some(AUFTRAG_BODY),
        )
        .await;
        assert_eq!(s, StatusCode::FORBIDDEN, "{quelle:?}: {v}");

        assert_eq!(auftraege(&app, einsatz, &admin).await, 0, "{quelle:?}");
        assert_eq!(
            anordnungen(&app, einsatz, &admin).await,
            anordnungen_vorher,
            "{quelle:?}: keine ETB-Anordnung"
        );
        if let Quelle::Meldung = quelle {
            let (_, m) = anfrage(
                &app,
                "GET",
                &format!("/api/einsaetze/{einsatz}/meldungen/{id}"),
                &admin,
                None,
            )
            .await;
            assert!(
                m.get("auftrag_id").is_none_or(Value::is_null),
                "kein Rückverweis an der Meldung: {m}"
            );
        }
    }
}

#[tokio::test]
async fn auftrag_erteilen_mit_auftrags_freigabe_gelingt() {
    for quelle in [Quelle::Etb, Quelle::Meldung] {
        let app = setup().await;
        let admin = login_cookie(&app, "admin", "startpw12").await;
        let einsatz = einsatz_anlegen(&app, &admin).await;
        let frieda = fuehrungsperson(&app, &admin, einsatz).await;
        let id = quelle.anlegen(&app, einsatz, &frieda).await;
        // Ein anderes Modul gesperrt: stört das Erteilen nicht.
        nur_fuer_admins(&app, &admin, einsatz, "lagekarte").await;

        let (s, v) = anfrage(
            &app,
            "POST",
            &quelle.erteilen_pfad(einsatz, id),
            &frieda,
            Some(AUFTRAG_BODY),
        )
        .await;
        assert_eq!(s, StatusCode::CREATED, "{quelle:?}: {v}");
        assert_eq!(auftraege(&app, einsatz, &admin).await, 1, "{quelle:?}");
    }
}

#[tokio::test]
async fn auftrag_erteilen_ohne_freigabe_ist_403_vor_404() {
    // Wie beim Heraufstufen aus dem Chat: wer nicht in die Aufträge darf, erfährt nichts über die
    // IDs des Quellmoduls.
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let frieda = fuehrungsperson(&app, &admin, einsatz).await;
    nur_fuer_admins(&app, &admin, einsatz, "auftraege").await;

    for quelle in [Quelle::Etb, Quelle::Meldung] {
        let (s, _) = anfrage(
            &app,
            "POST",
            &quelle.erteilen_pfad(einsatz, 999_999),
            &frieda,
            Some(AUFTRAG_BODY),
        )
        .await;
        assert_eq!(s, StatusCode::FORBIDDEN, "{quelle:?}");
    }
}
