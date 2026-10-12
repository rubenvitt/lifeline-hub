//! Integrationstests des Verteilers an Befehl und Lagebericht (LLH-1172, Spec
//! `dokument-verteiler`) über die Routen `/api/einsaetze/{id}/{befehle|lageberichte}/{did}`:
//! Ersetzen im Entwurf, Prüfung und Grenzen, Anzeigename, Freigabe ins ETB und Fortschreiben.
//! Jeder Fall läuft für beide Arten.

use axum::http::StatusCode;
use serde_json::{json, Value};

mod common;
use common::*;

const ADMIN_PW: &str = "startpw12";

/// Ein Dokumentpfad je Art: Präfix und Anlege-Body eines freigabefähigen Entwurfs.
struct Art {
    praefix: &'static str,
    anlegen: &'static str,
}

const BEFEHL: Art = Art {
    praefix: "befehle",
    anlegen: r#"{"vorlage":"befehl_lad","titel":"Befehl 1","zeitstand":"2026-06-02 10:00:00","abschnitte":[{"schluessel":"lage","text":"L"},{"schluessel":"auftrag","text":"A"},{"schluessel":"durchfuehrung","text":"D"}]}"#,
};

const LAGEBERICHT: Art = Art {
    praefix: "lageberichte",
    anlegen: r#"{"vorlage":"freitext","titel":"Lage 12:00","zeitstand":"2026-06-02 10:00:00","abschnitte":[{"schluessel":"text","text":"Ruhig"}]}"#,
};

const ARTEN: [&Art; 2] = [&BEFEHL, &LAGEBERICHT];

struct Umgebung {
    app: axum::Router,
    admin: String,
    einsatz: i64,
}

async fn umgebung() -> Umgebung {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", ADMIN_PW).await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    Umgebung {
        app,
        admin,
        einsatz,
    }
}

impl Umgebung {
    fn dok(&self, art: &Art, id: i64) -> String {
        format!("/api/einsaetze/{}/{}/{id}", self.einsatz, art.praefix)
    }

    async fn anlegen(&self, art: &Art) -> i64 {
        let (s, j) = anfrage(
            &self.app,
            "POST",
            &format!("/api/einsaetze/{}/{}", self.einsatz, art.praefix),
            &self.admin,
            Some(art.anlegen),
        )
        .await;
        assert_eq!(s, StatusCode::CREATED, "{j:?}");
        j["id"].as_i64().unwrap()
    }

    async fn patch(&self, art: &Art, id: i64, body: Value) -> (StatusCode, Value) {
        anfrage_json(
            &self.app,
            "PATCH",
            &self.dok(art, id),
            &self.admin,
            Some(&body),
        )
        .await
    }

    async fn laden(&self, art: &Art, id: i64) -> Value {
        let (s, j) = anfrage(&self.app, "GET", &self.dok(art, id), &self.admin, None).await;
        assert_eq!(s, StatusCode::OK, "{j:?}");
        j
    }

    async fn freigeben(&self, art: &Art, id: i64) -> Value {
        let (s, j) = anfrage(
            &self.app,
            "POST",
            &format!("{}/freigeben", self.dok(art, id)),
            &self.admin,
            None,
        )
        .await;
        assert_eq!(s, StatusCode::OK, "{j:?}");
        j
    }

    async fn abschnitt(&self, name: &str) -> i64 {
        let (s, j) = anfrage(
            &self.app,
            "POST",
            &format!("/api/einsaetze/{}/abschnitte", self.einsatz),
            &self.admin,
            Some(&format!(r#"{{"name":"{name}"}}"#)),
        )
        .await;
        assert_eq!(s, StatusCode::CREATED, "{j:?}");
        j["id"].as_i64().unwrap()
    }

    async fn etb_eintrag(&self, etb_id: i64) -> Value {
        let (_, etb) = anfrage(
            &self.app,
            "GET",
            &format!("/api/einsaetze/{}/etb", self.einsatz),
            &self.admin,
            None,
        )
        .await;
        etb.as_array()
            .unwrap()
            .iter()
            .find(|e| e["id"] == etb_id)
            .cloned()
            .expect("ETB-Eintrag der Freigabe")
    }
}

fn snaps(dok: &Value) -> Vec<String> {
    dok["verteiler"]
        .as_array()
        .expect("verteiler als Array")
        .iter()
        .map(|e| e["snap_anzeige"].as_str().unwrap().to_string())
        .collect()
}

fn s3() -> Value {
    json!({"empfaenger_typ": "funktion", "funktion": "s3"})
}

fn extern_stelle(bezeichnung: &str) -> Value {
    json!({"empfaenger_typ": "extern", "extern_kategorie": "leitstelle", "extern_bezeichnung": bezeichnung})
}

#[tokio::test]
async fn neues_dokument_hat_einen_leeren_verteiler() {
    let u = umgebung().await;
    for art in ARTEN {
        let id = u.anlegen(art).await;
        assert_eq!(
            u.laden(art, id).await["verteiler"],
            json!([]),
            "{}",
            art.praefix
        );
    }
}

#[tokio::test]
async fn pressemitteilung_traegt_keinen_verteiler() {
    let u = umgebung().await;
    let basis = format!("/api/einsaetze/{}/stab/pressemitteilungen", u.einsatz);
    let (s, pm) = anfrage(
        &u.app,
        "POST",
        &basis,
        &u.admin,
        Some(r#"{"vorlage":"erstinformation","titel":"X","abschnitte":[{"schluessel":"sachverhalt","text":"a"}]}"#),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{pm:?}");
    assert!(!pm.as_object().unwrap().contains_key("verteiler"), "{pm:?}");
    let (s, j) = anfrage_json(
        &u.app,
        "PATCH",
        &format!("{basis}/{}", pm["id"]),
        &u.admin,
        Some(&json!({"verteiler": [s3()]})),
    )
    .await;
    assert_eq!(s, StatusCode::BAD_REQUEST, "{j:?}");
}

#[tokio::test]
async fn verteiler_wird_ersetzt_und_ein_patch_ohne_feld_laesst_ihn_stehen() {
    let u = umgebung().await;
    let sued = u.abschnitt("EA Süd").await;
    let zug = einheit_bilden(&u.app, &u.admin, u.einsatz, "1. Zug").await;
    for art in ARTEN {
        let id = u.anlegen(art).await;
        let (s, d) = u
            .patch(
                art,
                id,
                json!({"verteiler": [
                    {"empfaenger_typ": "abschnitt", "abschnitt_id": sued},
                    s3(),
                    extern_stelle("ILS Musterstadt"),
                ]}),
            )
            .await;
        assert_eq!(s, StatusCode::OK, "{d:?}");
        assert_eq!(snaps(&d), ["EA Süd", "S3 Einsatz", "ILS Musterstadt"]);
        assert_eq!(d["verteiler"][0]["empfaenger_typ"], "abschnitt");
        assert_eq!(d["verteiler"][0]["abschnitt_id"], sued);
        assert_eq!(d["verteiler"][1]["funktion"], "s3");
        assert_eq!(d["verteiler"][2]["extern_kategorie"], "leitstelle");
        assert_eq!(snaps(&u.laden(art, id).await), snaps(&d));

        let (s, d) = u.patch(art, id, json!({"titel": "Neu"})).await;
        assert_eq!(s, StatusCode::OK, "{d:?}");
        assert_eq!(snaps(&d), ["EA Süd", "S3 Einsatz", "ILS Musterstadt"]);

        let (s, d) = u
            .patch(
                art,
                id,
                json!({"verteiler": [{"empfaenger_typ": "einheit", "einheit_id": zug}]}),
            )
            .await;
        assert_eq!(s, StatusCode::OK, "{d:?}");
        assert_eq!(snaps(&d), ["1. Zug"]);

        let (s, d) = u.patch(art, id, json!({"verteiler": []})).await;
        assert_eq!(s, StatusCode::OK, "{d:?}");
        assert_eq!(d["verteiler"], json!([]));
    }
}

#[tokio::test]
async fn ungueltiger_eintrag_aendert_weder_titel_noch_verteiler() {
    let u = umgebung().await;
    let anderer = einsatz_anlegen_mit(&u.app, &u.admin, "Anderer").await;
    let fremde_einheit = einheit_bilden(&u.app, &u.admin, anderer, "Fremd").await;
    for art in ARTEN {
        let id = u.anlegen(art).await;
        let (s, _) = u.patch(art, id, json!({"verteiler": [s3()]})).await;
        assert_eq!(s, StatusCode::OK);
        let vorher = u.laden(art, id).await;
        let (s, j) = u
            .patch(
                art,
                id,
                json!({"titel": "Geändert", "verteiler": [{"empfaenger_typ": "einheit", "einheit_id": fremde_einheit}]}),
            )
            .await;
        assert_eq!(s, StatusCode::BAD_REQUEST, "{j:?}");
        let nachher = u.laden(art, id).await;
        assert_eq!(nachher["titel"], vorher["titel"]);
        assert_eq!(nachher["verteiler"], vorher["verteiler"]);
    }
}

#[tokio::test]
async fn freigegebenes_dokument_nimmt_keinen_verteiler_an() {
    let u = umgebung().await;
    for art in ARTEN {
        let id = u.anlegen(art).await;
        let (s, _) = u.patch(art, id, json!({"verteiler": [s3()]})).await;
        assert_eq!(s, StatusCode::OK);
        u.freigeben(art, id).await;
        let (s, j) = u.patch(art, id, json!({"verteiler": []})).await;
        assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY, "{j:?}");
        assert_eq!(snaps(&u.laden(art, id).await), ["S3 Einsatz"]);
    }
}

#[tokio::test]
async fn grenzen_und_pruefung_der_eintraege() {
    let u = umgebung().await;
    let sued = u.abschnitt("EA Süd").await;
    for art in ARTEN {
        let id = u.anlegen(art).await;

        let zu_viele: Vec<Value> = (0..51)
            .map(|i| extern_stelle(&format!("Stelle {i}")))
            .collect();
        let (s, j) = u.patch(art, id, json!({"verteiler": zu_viele})).await;
        assert_eq!(s, StatusCode::BAD_REQUEST, "{j:?}");

        // Fünfzig sind erlaubt, gezählt vor dem Zusammenführen.
        let genau: Vec<Value> = (0..50)
            .map(|i| extern_stelle(&format!("Stelle {i}")))
            .collect();
        let (s, j) = u.patch(art, id, json!({"verteiler": genau})).await;
        assert_eq!(s, StatusCode::OK, "{j:?}");
        assert_eq!(j["verteiler"].as_array().unwrap().len(), 50);

        let abschnitt = json!({"empfaenger_typ": "abschnitt", "abschnitt_id": sued});
        let (s, j) = u
            .patch(art, id, json!({"verteiler": [abschnitt, s3(), abschnitt]}))
            .await;
        assert_eq!(s, StatusCode::OK, "{j:?}");
        assert_eq!(snaps(&j), ["EA Süd", "S3 Einsatz"]);

        for typ in ["person", "fahrzeug"] {
            let (s, j) = u
                .patch(
                    art,
                    id,
                    json!({"verteiler": [{"empfaenger_typ": typ, "person_id": 1}]}),
                )
                .await;
            assert_eq!(s, StatusCode::BAD_REQUEST, "{typ}: {j:?}");
        }

        let (s, j) = u
            .patch(
                art,
                id,
                json!({"verteiler": [extern_stelle(&"x".repeat(201))]}),
            )
            .await;
        assert_eq!(s, StatusCode::BAD_REQUEST, "{j:?}");
        let (s, _) = u
            .patch(
                art,
                id,
                json!({"verteiler": [extern_stelle(&"x".repeat(200))]}),
            )
            .await;
        assert_eq!(s, StatusCode::OK);

        let (s, j) = u
            .patch(art, id, json!({"verteiler": [{"empfaenger_typ": "zug"}]}))
            .await;
        assert_eq!(s, StatusCode::BAD_REQUEST, "{j:?}");
    }
}

#[tokio::test]
async fn anzeigename_ueberlebt_das_loeschen_und_nennt_keine_besetzung() {
    let u = umgebung().await;
    let sued = u.abschnitt("EA Süd").await;
    let (s, j) = anfrage(
        &u.app,
        "PUT",
        &format!("/api/einsaetze/{}/stab/besetzung/s3", u.einsatz),
        &u.admin,
        Some(r#"{"besetzung_art":"extern","bezeichnung":"Schulz"}"#),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "Besetzung: {j:?}");
    let mut ids = Vec::new();
    for art in ARTEN {
        let id = u.anlegen(art).await;
        let (s, d) = u
            .patch(
                art,
                id,
                json!({"verteiler": [{"empfaenger_typ": "abschnitt", "abschnitt_id": sued}, s3()]}),
            )
            .await;
        assert_eq!(s, StatusCode::OK, "{d:?}");
        assert_eq!(snaps(&d), ["EA Süd", "S3 Einsatz"]);
        ids.push(id);
    }
    let (s, j) = anfrage(
        &u.app,
        "DELETE",
        &format!("/api/einsaetze/{}/abschnitte/{sued}", u.einsatz),
        &u.admin,
        None,
    )
    .await;
    assert!(s.is_success(), "Abschnitt auflösen: {s} {j:?}");
    for (art, id) in ARTEN.iter().zip(ids) {
        let d = u.laden(art, id).await;
        assert_eq!(snaps(&d), ["EA Süd", "S3 Einsatz"]);
        assert!(
            !d["verteiler"][0]
                .as_object()
                .unwrap()
                .contains_key("abschnitt_id"),
            "Verweis auf den gelöschten Abschnitt entfällt: {d:?}"
        );
    }
}

#[tokio::test]
async fn freigabe_schreibt_verteiler_als_an_und_in_den_wortlaut() {
    let u = umgebung().await;
    let sued = u.abschnitt("EA Süd").await;
    for art in ARTEN {
        let id = u.anlegen(art).await;
        let (s, _) = u
            .patch(
                art,
                id,
                json!({"verteiler": [{"empfaenger_typ": "abschnitt", "abschnitt_id": sued}, s3()]}),
            )
            .await;
        assert_eq!(s, StatusCode::OK);
        let frei = u.freigeben(art, id).await;
        let e = u
            .etb_eintrag(frei["etb_eintrag_id"].as_i64().unwrap())
            .await;
        assert_eq!(e["an"], "EA Süd, S3 Einsatz", "{}", art.praefix);
        let inhalt = e["inhalt"].as_str().unwrap();
        assert!(
            inhalt.ends_with("\n\n## Verteiler\n- EA Süd\n- S3 Einsatz\n"),
            "{inhalt}"
        );
        assert_eq!(snaps(&frei), ["EA Süd", "S3 Einsatz"]);
    }
}

#[tokio::test]
async fn freigabe_ohne_verteiler_bleibt_wie_bisher() {
    let u = umgebung().await;
    for art in ARTEN {
        let id = u.anlegen(art).await;
        let frei = u.freigeben(art, id).await;
        let e = u
            .etb_eintrag(frei["etb_eintrag_id"].as_i64().unwrap())
            .await;
        assert_eq!(e["an"], "System", "{}", art.praefix);
        assert!(!e["inhalt"].as_str().unwrap().contains("Verteiler"));
    }
}

#[tokio::test]
async fn langer_verteiler_wird_im_an_gekappt_und_im_wortlaut_ganz_genannt() {
    let u = umgebung().await;
    for art in ARTEN {
        let id = u.anlegen(art).await;
        let lang: Vec<Value> = (0..12)
            .map(|i| {
                extern_stelle(&format!(
                    "Kreisverwaltung mit sehr langem Namen Nummer {i:02}"
                ))
            })
            .collect();
        let (s, _) = u.patch(art, id, json!({"verteiler": lang})).await;
        assert_eq!(s, StatusCode::OK);
        let frei = u.freigeben(art, id).await;
        let e = u
            .etb_eintrag(frei["etb_eintrag_id"].as_i64().unwrap())
            .await;
        let an = e["an"].as_str().unwrap();
        assert!(an.chars().count() <= 500, "{an}");
        assert!(an.ends_with(" weitere"), "{an}");
        let inhalt = e["inhalt"].as_str().unwrap();
        for i in 0..12 {
            assert!(
                inhalt.contains(&format!(
                    "- Kreisverwaltung mit sehr langem Namen Nummer {i:02}\n"
                )),
                "{inhalt}"
            );
        }
    }
}

#[tokio::test]
async fn fortschreiben_uebernimmt_den_verteiler_je_fassung() {
    let u = umgebung().await;
    let nord = u.abschnitt("EA Nord").await;
    for art in ARTEN {
        let id = u.anlegen(art).await;
        let (s, _) = u
            .patch(
                art,
                id,
                json!({"verteiler": [extern_stelle("Leitstelle"), {"empfaenger_typ": "abschnitt", "abschnitt_id": nord}]}),
            )
            .await;
        assert_eq!(s, StatusCode::OK);
        u.freigeben(art, id).await;
        let (s, v2) = anfrage(
            &u.app,
            "POST",
            &format!("{}/fortschreiben", u.dok(art, id)),
            &u.admin,
            Some("{}"),
        )
        .await;
        assert_eq!(s, StatusCode::CREATED, "{v2:?}");
        assert_eq!(snaps(&v2), ["Leitstelle", "EA Nord"]);
        assert_eq!(v2["verteiler"][1]["abschnitt_id"], nord);
        let v2_id = v2["id"].as_i64().unwrap();

        let (s, _) = u.patch(art, v2_id, json!({"verteiler": []})).await;
        assert_eq!(s, StatusCode::OK);
        assert_eq!(u.laden(art, v2_id).await["verteiler"], json!([]));
        assert_eq!(snaps(&u.laden(art, id).await), ["Leitstelle", "EA Nord"]);
    }
}
