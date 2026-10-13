//! Integrationstests der Quittung je Verteiler-Empfänger am Einsatzbefehl (LLH-1173, Spec
//! `befehl-quittung`, Herleitung `openspec/changes/archive/2026-10-13-koiqi51u-befehl-quittung/design.md`) über
//! `POST /api/einsaetze/{id}/befehle/{bid}/verteiler/{vid}/{quittieren|zuruecknehmen}`:
//! Quittung und Rücknahme samt ETB, Fassungsregel, Rechte, Liste und Live-Ereignis.

use axum::http::StatusCode;
use serde_json::{json, Value};
use std::time::Duration;

mod common;
use common::*;

const ADMIN_PW: &str = "startpw12";

const BEFEHL: &str = r#"{"vorlage":"befehl_lad","titel":"Brandbekämpfung Halle 3","zeitstand":"2026-06-02 10:00:00","abschnitte":[{"schluessel":"lage","text":"L"},{"schluessel":"auftrag","text":"A"},{"schluessel":"durchfuehrung","text":"D"}]}"#;

struct Umgebung {
    app: axum::Router,
    admin: String,
    einsatz: i64,
    sued: i64,
}

async fn umgebung_mit(app: axum::Router) -> Umgebung {
    let admin = login_cookie(&app, "admin", ADMIN_PW).await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let (s, j) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/abschnitte"),
        &admin,
        Some(r#"{"name":"EA Süd"}"#),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{j:?}");
    Umgebung {
        app,
        admin,
        einsatz,
        sued: j["id"].as_i64().unwrap(),
    }
}

async fn umgebung() -> Umgebung {
    umgebung_mit(setup().await).await
}

impl Umgebung {
    fn befehl(&self, id: i64) -> String {
        format!("/api/einsaetze/{}/befehle/{id}", self.einsatz)
    }

    /// Entwurf mit dem Verteiler „EA Süd, S3 Einsatz“.
    async fn entwurf(&self) -> i64 {
        let (s, j) = anfrage(
            &self.app,
            "POST",
            &format!("/api/einsaetze/{}/befehle", self.einsatz),
            &self.admin,
            Some(BEFEHL),
        )
        .await;
        assert_eq!(s, StatusCode::CREATED, "{j:?}");
        let id = j["id"].as_i64().unwrap();
        let (s, j) = anfrage_json(
            &self.app,
            "PATCH",
            &self.befehl(id),
            &self.admin,
            Some(&json!({"verteiler": [
                {"empfaenger_typ": "abschnitt", "abschnitt_id": self.sued},
                {"empfaenger_typ": "funktion", "funktion": "s3"},
            ]})),
        )
        .await;
        assert_eq!(s, StatusCode::OK, "{j:?}");
        id
    }

    async fn post(&self, pfad: &str) -> (StatusCode, Value) {
        anfrage(&self.app, "POST", pfad, &self.admin, None).await
    }

    async fn freigegeben(&self) -> Value {
        let id = self.entwurf().await;
        let (s, j) = self.post(&format!("{}/freigeben", self.befehl(id))).await;
        assert_eq!(s, StatusCode::OK, "{j:?}");
        j
    }

    async fn fortschreiben(&self, id: i64) -> Value {
        let (s, j) = anfrage(
            &self.app,
            "POST",
            &format!("{}/fortschreiben", self.befehl(id)),
            &self.admin,
            Some("{}"),
        )
        .await;
        assert_eq!(s, StatusCode::CREATED, "{j:?}");
        j
    }

    fn quittung_pfad(&self, bid: i64, vid: i64, wort: &str) -> String {
        format!("{}/verteiler/{vid}/{wort}", self.befehl(bid))
    }

    async fn quittieren(&self, bid: i64, vid: i64) -> (StatusCode, Value) {
        self.post(&self.quittung_pfad(bid, vid, "quittieren")).await
    }

    async fn zuruecknehmen(&self, bid: i64, vid: i64) -> (StatusCode, Value) {
        self.post(&self.quittung_pfad(bid, vid, "zuruecknehmen"))
            .await
    }

    async fn laden(&self, id: i64) -> Value {
        let (s, j) = anfrage(&self.app, "GET", &self.befehl(id), &self.admin, None).await;
        assert_eq!(s, StatusCode::OK, "{j:?}");
        j
    }

    async fn liste(&self) -> Vec<Value> {
        let (s, j) = anfrage(
            &self.app,
            "GET",
            &format!("/api/einsaetze/{}/befehle", self.einsatz),
            &self.admin,
            None,
        )
        .await;
        assert_eq!(s, StatusCode::OK, "{j:?}");
        j.as_array().unwrap().clone()
    }

    async fn etb(&self) -> Vec<Value> {
        let (_, j) = anfrage(
            &self.app,
            "GET",
            &format!("/api/einsaetze/{}/etb", self.einsatz),
            &self.admin,
            None,
        )
        .await;
        j.as_array().unwrap().clone()
    }

    /// Systemeinträge des ETB, deren Inhalt mit `praefix` beginnt, als `(inhalt, von, an)`.
    async fn etb_mit(&self, praefix: &str) -> Vec<(String, String, String)> {
        self.etb()
            .await
            .into_iter()
            .filter(|e| e["typ"] == "system")
            .filter(|e| e["inhalt"].as_str().unwrap().starts_with(praefix))
            .map(|e| {
                (
                    e["inhalt"].as_str().unwrap().to_string(),
                    e["von"].as_str().unwrap_or_default().to_string(),
                    e["an"].as_str().unwrap_or_default().to_string(),
                )
            })
            .collect()
    }

    /// Laufende Nummer des ETB-Eintrags, mit dem der Befehl freigegeben wurde.
    async fn freigabe_nr(&self, befehl: &Value) -> i64 {
        let etb_id = befehl["etb_eintrag_id"].as_i64().unwrap();
        self.etb()
            .await
            .into_iter()
            .find(|e| e["id"] == etb_id)
            .expect("Freigabe-Eintrag")["lfd_nr"]
            .as_i64()
            .unwrap()
    }
}

fn id(v: &Value) -> i64 {
    v["id"].as_i64().unwrap()
}

fn zeile(befehl: &Value, i: usize) -> &Value {
    &befehl["verteiler"][i]
}

fn ist_quittiert(befehl: &Value, i: usize) -> bool {
    zeile(befehl, i)["quittiert_at"].is_string()
}

#[tokio::test]
async fn frischer_verteiler_ist_offen_und_der_entwurf_nicht_quittierbar() {
    let u = umgebung().await;
    let id = u.entwurf().await;
    let b = u.laden(id).await;
    assert_eq!(b["is_quittierbar"], false);
    assert!(zeile(&b, 0).get("quittiert_at").is_none(), "{b}");
    assert!(zeile(&b, 0).get("quittiert_von_id").is_none(), "{b}");

    let (s, j) = u.quittieren(id, id_of_row(&b, 0)).await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY, "{j:?}");
    assert!(!ist_quittiert(&u.laden(id).await, 0));
}

fn id_of_row(befehl: &Value, i: usize) -> i64 {
    zeile(befehl, i)["id"].as_i64().unwrap()
}

#[tokio::test]
async fn quittieren_setzt_zeitpunkt_und_person_und_schreibt_ins_etb() {
    let u = umgebung().await;
    let b = u.freigegeben().await;
    assert_eq!(b["is_quittierbar"], true);
    let nr = u.freigabe_nr(&b).await;

    let (s, nach) = u.quittieren(id(&b), id_of_row(&b, 0)).await;
    assert_eq!(s, StatusCode::OK, "{nach:?}");
    assert!(ist_quittiert(&nach, 0), "{nach}");
    assert!(zeile(&nach, 0)["quittiert_von_id"].is_i64(), "{nach}");
    assert!(!ist_quittiert(&nach, 1), "{nach}");

    assert_eq!(
        u.etb_mit("Empfang quittiert").await,
        [(
            format!("Empfang quittiert: Einsatzbefehl v1 (ETB {nr})"),
            "EA Süd".to_string(),
            "System".to_string(),
        )]
    );
    // Der Titel ist ein Dokumenttitel und steht nicht im Quittungseintrag (Spec `aufbewahrung`).
    assert!(u
        .etb_mit("Empfang quittiert")
        .await
        .iter()
        .all(|(inhalt, _, _)| !inhalt.contains("Halle 3")));
}

#[tokio::test]
async fn doppeltes_quittieren_behaelt_die_erste_quittung_und_schreibt_kein_zweites_etb() {
    let u = umgebung().await;
    let b = u.freigegeben().await;
    let (_, erst) = u.quittieren(id(&b), id_of_row(&b, 0)).await;
    let (s, zweit) = u.quittieren(id(&b), id_of_row(&b, 0)).await;
    assert_eq!(s, StatusCode::OK, "{zweit:?}");
    assert_eq!(
        zeile(&zweit, 0)["quittiert_at"],
        zeile(&erst, 0)["quittiert_at"]
    );
    assert_eq!(u.etb_mit("Empfang quittiert").await.len(), 1);
}

#[tokio::test]
async fn zuruecknehmen_leert_die_quittung_und_schreibt_den_gegeneintrag() {
    let u = umgebung().await;
    let b = u.freigegeben().await;
    let nr = u.freigabe_nr(&b).await;
    u.quittieren(id(&b), id_of_row(&b, 0)).await;

    let (s, nach) = u.zuruecknehmen(id(&b), id_of_row(&b, 0)).await;
    assert_eq!(s, StatusCode::OK, "{nach:?}");
    assert!(!ist_quittiert(&nach, 0), "{nach}");
    assert!(zeile(&nach, 0).get("quittiert_von_id").is_none(), "{nach}");
    assert_eq!(
        u.etb_mit("Quittung zurückgenommen").await,
        [(
            format!("Quittung zurückgenommen: Einsatzbefehl v1 (ETB {nr})"),
            "EA Süd".to_string(),
            "System".to_string(),
        )]
    );
    // Der Eintrag der Quittung bleibt stehen.
    assert_eq!(u.etb_mit("Empfang quittiert").await.len(), 1);
}

#[tokio::test]
async fn zuruecknehmen_an_einer_offenen_zeile_aendert_nichts() {
    let u = umgebung().await;
    let b = u.freigegeben().await;
    let (s, nach) = u.zuruecknehmen(id(&b), id_of_row(&b, 1)).await;
    assert_eq!(s, StatusCode::OK, "{nach:?}");
    assert!(!ist_quittiert(&nach, 1));
    assert!(u.etb_mit("Quittung zurückgenommen").await.is_empty());
}

#[tokio::test]
async fn nur_die_juengste_freigegebene_fassung_ist_quittierbar() {
    let u = umgebung().await;
    let v1 = u.freigegeben().await;
    u.quittieren(id(&v1), id_of_row(&v1, 0)).await;

    // Nachfolgerin im Entwurf: v1 bleibt quittierbar.
    let v2 = u.fortschreiben(id(&v1)).await;
    assert_eq!(u.laden(id(&v1)).await["is_quittierbar"], true);
    assert_eq!(v2["is_quittierbar"], false);
    // Fortschreiben kopiert keine Quittung, v1 behält ihre.
    assert!(!ist_quittiert(&v2, 0), "{v2}");
    assert!(ist_quittiert(&u.laden(id(&v1)).await, 0));
    let (s, _) = u.quittieren(id(&v1), id_of_row(&v1, 1)).await;
    assert_eq!(s, StatusCode::OK);

    // Nachfolgerin freigegeben: v1 ist überholt, ihre Quittungen bleiben stehen.
    let (s, v2) = u.post(&format!("{}/freigeben", u.befehl(id(&v2)))).await;
    assert_eq!(s, StatusCode::OK, "{v2:?}");
    assert_eq!(v2["is_quittierbar"], true);
    assert!(!ist_quittiert(&v2, 0) && !ist_quittiert(&v2, 1), "{v2}");
    let alt = u.laden(id(&v1)).await;
    assert_eq!(alt["is_quittierbar"], false);

    let (s, j) = u.zuruecknehmen(id(&v1), id_of_row(&v1, 0)).await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY, "{j:?}");
    let (s, j) = u.quittieren(id(&v1), id_of_row(&v1, 0)).await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY, "{j:?}");
    let alt = u.laden(id(&v1)).await;
    assert!(ist_quittiert(&alt, 0) && ist_quittiert(&alt, 1), "{alt}");
}

#[tokio::test]
async fn fremde_zeile_und_fremder_einsatz_sind_nicht_vorhanden() {
    let u = umgebung().await;
    let a = u.freigegeben().await;
    let b = u.freigegeben().await;
    // Zeile von Befehl B am Pfad von Befehl A.
    let (s, _) = u.quittieren(id(&a), id_of_row(&b, 0)).await;
    assert_eq!(s, StatusCode::NOT_FOUND);
    let (s, _) = u.quittieren(id(&a), 999_999).await;
    assert_eq!(s, StatusCode::NOT_FOUND);

    let anderer = einsatz_anlegen(&u.app, &u.admin).await;
    let (s, _) = u
        .post(&format!(
            "/api/einsaetze/{anderer}/befehle/{}/verteiler/{}/quittieren",
            id(&a),
            id_of_row(&a, 0)
        ))
        .await;
    assert_eq!(s, StatusCode::NOT_FOUND);
    assert!(!ist_quittiert(&u.laden(id(&a)).await, 0));
}

#[tokio::test]
async fn ohne_schreibrecht_ist_quittieren_verboten() {
    let u = umgebung().await;
    let b = u.freigegeben().await;
    let erika = benutzer_anlegen(&u.app, &u.admin, "erika", "keine").await;
    rolle_setzen(&u.app, &u.admin, u.einsatz, erika, "beobachter").await;
    let erika_c = login_cookie(&u.app, "erika", "erikapw1").await;
    for wort in ["quittieren", "zuruecknehmen"] {
        let (s, _) = anfrage(
            &u.app,
            "POST",
            &u.quittung_pfad(id(&b), id_of_row(&b, 0), wort),
            &erika_c,
            None,
        )
        .await;
        assert_eq!(s, StatusCode::FORBIDDEN, "{wort}");
    }
    assert!(!ist_quittiert(&u.laden(id(&b)).await, 0));
}

#[tokio::test]
async fn liste_traegt_verteiler_mit_quittung_und_quittierbarkeit() {
    let u = umgebung().await;
    let b = u.freigegeben().await;
    u.quittieren(id(&b), id_of_row(&b, 0)).await;
    let entwurf = u.entwurf().await;

    let liste = u.liste().await;
    let kopf = liste.iter().find(|k| k["id"] == id(&b)).unwrap();
    assert_eq!(kopf["is_quittierbar"], true);
    let snaps: Vec<_> = kopf["verteiler"]
        .as_array()
        .unwrap()
        .iter()
        .map(|e| e["snap_anzeige"].as_str().unwrap())
        .collect();
    assert_eq!(snaps, ["EA Süd", "S3 Einsatz"]);
    assert!(ist_quittiert(kopf, 0) && !ist_quittiert(kopf, 1), "{kopf}");
    assert_eq!(kopf["verteiler"][0]["abschnitt_id"], u.sued);

    let kopf = liste.iter().find(|k| k["id"] == entwurf).unwrap();
    assert_eq!(kopf["is_quittierbar"], false);
    assert_eq!(kopf["verteiler"].as_array().unwrap().len(), 2);
}

#[tokio::test]
async fn lagebericht_bleibt_ohne_quittung() {
    let u = umgebung().await;
    let (s, j) = anfrage(
        &u.app,
        "POST",
        &format!("/api/einsaetze/{}/lageberichte", u.einsatz),
        &u.admin,
        Some(r#"{"vorlage":"freitext","titel":"Lage 12:00","zeitstand":"2026-06-02 10:00:00","abschnitte":[{"schluessel":"text","text":"Ruhig"}]}"#),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{j:?}");
    assert!(j.get("is_quittierbar").is_none(), "{j}");
    let lid = id(&j);
    let (s, liste) = anfrage(
        &u.app,
        "GET",
        &format!("/api/einsaetze/{}/lageberichte", u.einsatz),
        &u.admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    let kopf = liste
        .as_array()
        .unwrap()
        .iter()
        .find(|k| k["id"] == lid)
        .unwrap();
    assert!(kopf.get("verteiler").is_none(), "{kopf}");
    assert!(kopf.get("is_quittierbar").is_none(), "{kopf}");
    // Es gibt keine Quittungsroute am Lagebericht.
    let (s, _) = u
        .post(&format!(
            "/api/einsaetze/{}/lageberichte/{lid}/verteiler/1/quittieren",
            u.einsatz
        ))
        .await;
    assert!(
        s == StatusCode::NOT_FOUND || s == StatusCode::METHOD_NOT_ALLOWED,
        "{s}"
    );
}

#[tokio::test]
async fn quittung_und_ruecknahme_gehen_live_ohne_nur_inhalt() {
    let (app, live) = setup_mit_live().await;
    let u = umgebung_mit(app).await;
    let b = u.freigegeben().await;
    let mut rx = live.abonniere(u.einsatz);

    for wort in ["quittieren", "zuruecknehmen"] {
        let (s, _) = u
            .post(&u.quittung_pfad(id(&b), id_of_row(&b, 0), wort))
            .await;
        assert_eq!(s, StatusCode::OK);
        // Wie bei der Freigabe: erst das ETB, dann der Befehl.
        recv_until_tag(&mut rx, "etb", Duration::from_secs(1)).await;
        let n = recv_until_tag(&mut rx, "befehl", Duration::from_secs(1)).await;
        let data: Value = serde_json::from_str(&n.data).unwrap();
        assert_eq!(data["befehl_id"], id(&b), "{wort}: {data}");
        assert!(data.get("nur_inhalt").is_none(), "{wort}: {data}");
    }
}

#[tokio::test]
async fn nach_einer_zweiten_fortschreibung_der_alten_fassung_gilt_nur_die_zuletzt_freigegebene() {
    let u = umgebung().await;
    let v1 = u.freigegeben().await;
    let v2 = u.fortschreiben(id(&v1)).await;
    let (s, _) = u.post(&format!("{}/freigeben", u.befehl(id(&v2)))).await;
    assert_eq!(s, StatusCode::OK);
    // Die überholte v1 wird noch einmal fortgeschrieben und freigegeben (Seitenzweig der Kette).
    let zweig = u.fortschreiben(id(&v1)).await;
    let (s, zweig) = u.post(&format!("{}/freigeben", u.befehl(id(&zweig)))).await;
    assert_eq!(s, StatusCode::OK, "{zweig:?}");

    assert_eq!(zweig["is_quittierbar"], true);
    assert_eq!(u.laden(id(&v2)).await["is_quittierbar"], false);
    assert_eq!(u.laden(id(&v1)).await["is_quittierbar"], false);
    let (s, _) = u.quittieren(id(&v2), id_of_row(&v2, 0)).await;
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY);
    // Eine andere Kette im selben Einsatz bleibt unberührt.
    let andere = u.freigegeben().await;
    assert_eq!(u.laden(id(&andere)).await["is_quittierbar"], true);
    assert_eq!(u.laden(id(&zweig)).await["is_quittierbar"], true);
}

#[tokio::test]
async fn verteiler_im_entwurf_aendern_meldet_den_kopf_neu() {
    let (app, live) = setup_mit_live().await;
    let u = umgebung_mit(app).await;
    let id = u.entwurf().await;
    let mut rx = live.abonniere(u.einsatz);
    let (s, j) = anfrage_json(
        &u.app,
        "PATCH",
        &u.befehl(id),
        &u.admin,
        Some(&json!({"verteiler": [{"empfaenger_typ": "funktion", "funktion": "s3"}]})),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{j:?}");
    let n = recv_until_tag(&mut rx, "befehl", Duration::from_secs(1)).await;
    let data: Value = serde_json::from_str(&n.data).unwrap();
    // Die Liste trägt den Verteiler (Karte, Empfängerfilter): kein `nur_inhalt`.
    assert!(data.get("nur_inhalt").is_none(), "{data}");
}
