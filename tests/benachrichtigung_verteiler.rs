//! Benachrichtigungen zu Befehl und Lagebericht im Verteiler (LLH-1213, Change
//! `kcjecn9e-benachrichtigungskonzept`, Spec `benachrichtigungen`, „Befehl oder Lagebericht im
//! Verteiler“, „Der Server bestimmt die Empfänger“ und „Eigene Aktionen …“): Die Freigabe über
//! `POST …/{befehle|lageberichte}/{id}/freigeben` meldet `befehl` bzw. `lagebericht` an die
//! Nutzer der Funktionen im Verteiler. Jeder Fall prüft auch, wer nichts bekommt.

use axum::http::StatusCode;
use serde_json::{json, Value};

mod common;
use common::{
    anfrage, anfrage_json, benutzer_anlegen, einheit_bilden, einsatz_anlegen, login_cookie,
    rolle_setzen, setup_mit_pool_und_live,
};

/// Ein Dokumentpfad je Art: Präfix, Anlege-Body eines freigabefähigen Entwurfs, die Art der
/// Benachrichtigung (gleich dem Bezugstyp) und das Modul, dem die Art gehört.
struct Dok {
    praefix: &'static str,
    anlegen: &'static str,
    art: &'static str,
    modul: &'static str,
    titel: &'static str,
}

const BEFEHL: Dok = Dok {
    praefix: "befehle",
    anlegen: r#"{"vorlage":"befehl_lad","titel":"Räumung Hauptstraße","zeitstand":"2026-06-02 10:00:00","abschnitte":[{"schluessel":"lage","text":"L"},{"schluessel":"auftrag","text":"A"},{"schluessel":"durchfuehrung","text":"D"}]}"#,
    art: "befehl",
    modul: "auftraege",
    titel: "Neuer Befehl",
};

const LAGEBERICHT: Dok = Dok {
    praefix: "lageberichte",
    anlegen: r#"{"vorlage":"freitext","titel":"Lage Familie Muster","zeitstand":"2026-06-02 10:00:00","abschnitte":[{"schluessel":"text","text":"Ruhig"}]}"#,
    art: "lagebericht",
    modul: "lageberichte",
    titel: "Neuer Lagebericht",
};

const ARTEN: [&Dok; 2] = [&BEFEHL, &LAGEBERICHT];

struct Welt {
    app: axum::Router,
    pool: sqlx::SqlitePool,
    admin: String,
    admin_id: i64,
    einsatz: i64,
    /// S3 über die Stab-Besetzung.
    anna: i64,
    /// S4 über die Mitgliedschaft (Ersatz, S4 ist in der Besetzung frei).
    bert: i64,
    /// S2 über die Mitgliedschaft; steht in keinem Verteiler.
    carl: i64,
}

async fn welt() -> Welt {
    let (app, pool, _live) = setup_mit_pool_und_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let admin_id: i64 = sqlx::query_scalar("SELECT id FROM benutzer WHERE benutzername = 'admin'")
        .fetch_one(&pool)
        .await
        .unwrap();
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let anna = benutzer_anlegen(&app, &admin, "annika", "keine").await;
    let bert = benutzer_anlegen(&app, &admin, "bertram", "keine").await;
    let carl = benutzer_anlegen(&app, &admin, "carlotta", "keine").await;
    for b in [anna, bert, carl] {
        rolle_setzen(&app, &admin, einsatz, b, "fuehrungspersonal").await;
    }
    let w = Welt {
        app,
        pool,
        admin,
        admin_id,
        einsatz,
        anna,
        bert,
        carl,
    };
    let ep = w.personal("Anna", w.anna).await;
    w.besetzen(
        "s3",
        json!({ "besetzung_art": "personal", "personal_id": ep }),
    )
    .await;
    w.funktion_setzen(w.bert, "s4").await;
    w.funktion_setzen(w.carl, "s2").await;
    w
}

impl Welt {
    async fn cookie(&self, name: &str) -> String {
        login_cookie(&self.app, name, &format!("{name}pw1")).await
    }

    /// Stamm-Person mit verknüpftem Konto, disponiert; liefert die `einsatz_personal.id`.
    async fn personal(&self, name: &str, benutzer_id: i64) -> i64 {
        let (s, v) = anfrage_json(
            &self.app,
            "POST",
            "/api/personal",
            &self.admin,
            Some(&json!({ "name": name, "benutzer_id": benutzer_id })),
        )
        .await;
        assert_eq!(s, StatusCode::CREATED, "{v}");
        let (s, v) = anfrage_json(
            &self.app,
            "POST",
            &format!("/api/einsaetze/{}/personal", self.einsatz),
            &self.admin,
            Some(&json!({ "personal_id": v["id"] })),
        )
        .await;
        assert_eq!(s, StatusCode::CREATED, "{v}");
        v["id"].as_i64().unwrap()
    }

    async fn besetzen(&self, sachgebiet: &str, body: Value) {
        let (s, v) = anfrage_json(
            &self.app,
            "PUT",
            &format!(
                "/api/einsaetze/{}/stab/besetzung/{sachgebiet}",
                self.einsatz
            ),
            &self.admin,
            Some(&body),
        )
        .await;
        assert!(s.is_success(), "besetzen {sachgebiet}: {s} {v}");
    }

    async fn funktion_setzen(&self, benutzer_id: i64, funktion: &str) {
        let (s, v) = anfrage_json(
            &self.app,
            "PUT",
            &format!("/api/einsaetze/{}/mitglieder/{benutzer_id}", self.einsatz),
            &self.admin,
            Some(&json!({ "einsatz_rolle": "fuehrungspersonal", "fuehrungsfunktion": funktion })),
        )
        .await;
        assert_eq!(s, StatusCode::OK, "{v}");
    }

    async fn modul_nur_fuer_admins(&self, modul: &str) {
        let (s, v) = anfrage(
            &self.app,
            "PUT",
            &format!("/api/einsaetze/{}/modul-overrides/{modul}", self.einsatz),
            &self.admin,
            Some(r#"{"sichtbar":true,"benoetigte_rolle":"admin"}"#),
        )
        .await;
        assert_eq!(s, StatusCode::OK, "{v}");
    }

    fn dok(&self, art: &Dok, id: i64) -> String {
        format!("/api/einsaetze/{}/{}/{id}", self.einsatz, art.praefix)
    }

    /// Legt als `cookie` einen Entwurf mit diesem Verteiler an; liefert seine id.
    async fn entwurf(&self, cookie: &str, art: &Dok, verteiler: Value) -> i64 {
        let (s, v) = anfrage(
            &self.app,
            "POST",
            &format!("/api/einsaetze/{}/{}", self.einsatz, art.praefix),
            cookie,
            Some(art.anlegen),
        )
        .await;
        assert_eq!(s, StatusCode::CREATED, "{v}");
        let id = v["id"].as_i64().unwrap();
        let (s, v) = anfrage_json(
            &self.app,
            "PATCH",
            &self.dok(art, id),
            cookie,
            Some(&json!({ "verteiler": verteiler })),
        )
        .await;
        assert_eq!(s, StatusCode::OK, "{v}");
        id
    }

    async fn freigeben(&self, cookie: &str, art: &Dok, id: i64) -> (StatusCode, Value) {
        anfrage(
            &self.app,
            "POST",
            &format!("{}/freigeben", self.dok(art, id)),
            cookie,
            None,
        )
        .await
    }

    async fn fortschreiben(&self, art: &Dok, id: i64) -> i64 {
        let (s, v) = anfrage(
            &self.app,
            "POST",
            &format!("{}/fortschreiben", self.dok(art, id)),
            &self.admin,
            Some("{}"),
        )
        .await;
        assert_eq!(s, StatusCode::CREATED, "{v}");
        v["id"].as_i64().unwrap()
    }

    /// Alle Benachrichtigungen der Art als `(benutzer_id, bezug_id)`, sortiert.
    async fn gemeldet(&self, art: &Dok) -> Vec<(i64, i64)> {
        sqlx::query_as(
            "SELECT benutzer_id, bezug_id FROM benachrichtigung \
             WHERE einsatz_id = ? AND art = ? AND bezug_typ = ? \
             ORDER BY bezug_id, benutzer_id",
        )
        .bind(self.einsatz)
        .bind(art.art)
        .bind(art.art)
        .fetch_all(&self.pool)
        .await
        .unwrap()
    }

    async fn alle_zeilen(&self) -> i64 {
        sqlx::query_scalar("SELECT COUNT(*) FROM benachrichtigung")
            .fetch_one(&self.pool)
            .await
            .unwrap()
    }
}

fn funktion(code: &str) -> Value {
    json!({ "empfaenger_typ": "funktion", "funktion": code })
}

/// Spec-Szenario „Befehl an S3 und S4“ (und dasselbe für den Lagebericht): die Nutzer von S3
/// (Stab-Besetzung) und S4 (Mitgliedschaft) bekommen den Hinweis, S2 und der Freigebende nicht.
/// Erst die Freigabe meldet, Anlegen und Bearbeiten des Entwurfs bleiben still.
#[tokio::test]
async fn freigabe_meldet_an_die_funktionen_im_verteiler() {
    let w = welt().await;
    for art in ARTEN {
        let id = w
            .entwurf(&w.admin, art, json!([funktion("s3"), funktion("s4")]))
            .await;
        assert!(
            w.gemeldet(art).await.is_empty(),
            "{}: Entwurf meldet",
            art.art
        );

        let (s, v) = w.freigeben(&w.admin, art, id).await;
        assert_eq!(s, StatusCode::OK, "{v}");
        let gemeldet = w.gemeldet(art).await;
        assert_eq!(gemeldet, vec![(w.anna, id), (w.bert, id)], "{}", art.art);
        assert!(
            !gemeldet
                .iter()
                .any(|(b, _)| *b == w.carl || *b == w.admin_id),
            "{}: S2 und Freigebender bleiben still",
            art.art
        );
    }
}

/// Der Empfänger liest Titel, Detail und Sprung; die Detailzeile nennt die Version, nie den
/// Dokumenttitel (Scrub-Wert, `src/AGENTS.md`, Aufbewahrung).
#[tokio::test]
async fn text_nennt_art_und_version_ohne_dokumenttitel() {
    let w = welt().await;
    let anna = w.cookie("annika").await;
    for (art, pfad) in [
        (&BEFEHL, "auftraege/befehle"),
        (&LAGEBERICHT, "lageberichte"),
    ] {
        let id = w.entwurf(&w.admin, art, json!([funktion("s3")])).await;
        let (s, _) = w.freigeben(&w.admin, art, id).await;
        assert_eq!(s, StatusCode::OK);
        let (s, offen) = anfrage(
            &w.app,
            "GET",
            "/api/benachrichtigungen?offen=true",
            &anna,
            None,
        )
        .await;
        assert_eq!(s, StatusCode::OK, "{offen}");
        let eintrag = offen
            .as_array()
            .unwrap()
            .iter()
            .find(|b| b["art"] == art.art)
            .unwrap_or_else(|| panic!("{}: keine offene Benachrichtigung in {offen}", art.art))
            .clone();
        assert_eq!(eintrag["stufe"], "hinweis");
        assert_eq!(eintrag["bezug_typ"], art.art);
        assert_eq!(eintrag["bezug_id"], id);
        assert_eq!(eintrag["titel"], art.titel);
        assert_eq!(eintrag["detail"], "Version 1");
        assert_eq!(
            eintrag["pfad"],
            format!("/einsaetze/{}/{pfad}/{id}", w.einsatz)
        );
        let roh = eintrag.to_string();
        assert!(
            !roh.contains("Räumung") && !roh.contains("Muster"),
            "Dokumenttitel im Text: {roh}"
        );
    }
}

/// Einheit, Abschnitt, extern und eine Funktion als Freitext haben keinen Nutzer: ein Verteiler
/// nur aus ihnen benachrichtigt niemanden.
#[tokio::test]
async fn einheit_abschnitt_extern_und_freitext_benachrichtigen_niemanden() {
    let w = welt().await;
    let einheit = einheit_bilden(&w.app, &w.admin, w.einsatz, "Florian 1").await;
    let (s, v) = anfrage_json(
        &w.app,
        "POST",
        &format!("/api/einsaetze/{}/abschnitte", w.einsatz),
        &w.admin,
        Some(&json!({ "name": "Süd" })),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
    let abschnitt = v["id"].as_i64().unwrap();
    for art in ARTEN {
        let id = w
            .entwurf(
                &w.admin,
                art,
                json!([
                    { "empfaenger_typ": "einheit", "einheit_id": einheit },
                    { "empfaenger_typ": "abschnitt", "abschnitt_id": abschnitt },
                    { "empfaenger_typ": "extern", "extern_kategorie": "leitstelle", "extern_bezeichnung": "ILS" },
                    { "empfaenger_typ": "funktion", "funktion_text": "S3" },
                ]),
            )
            .await;
        let (s, v) = w.freigeben(&w.admin, art, id).await;
        assert_eq!(s, StatusCode::OK, "{v}");
    }
    assert_eq!(w.alle_zeilen().await, 0);
}

/// Spec-Szenario „Empfänger ohne Modulrecht“: wer das Modul der Art nicht sehen darf, bekommt
/// trotz seiner Funktion im Verteiler nichts. Gegenprobe: gesperrt ist nur das Modul der Art —
/// das Modul der anderen Art zu sperren nimmt niemandem den Hinweis (Befehle gehören zu
/// `auftraege`, Lageberichte zu `lageberichte`).
#[tokio::test]
async fn ohne_modulrecht_kein_hinweis() {
    for (gesperrt, frei) in [(&BEFEHL, &LAGEBERICHT), (&LAGEBERICHT, &BEFEHL)] {
        let w = welt().await;
        w.modul_nur_fuer_admins(gesperrt.modul).await;

        let id = w
            .entwurf(&w.admin, gesperrt, json!([funktion("s3"), funktion("s4")]))
            .await;
        let (s, v) = w.freigeben(&w.admin, gesperrt, id).await;
        assert_eq!(s, StatusCode::OK, "{v}");
        assert!(
            w.gemeldet(gesperrt).await.is_empty(),
            "{}: Modul {} gesperrt, trotzdem gemeldet",
            gesperrt.art,
            gesperrt.modul
        );

        let id = w
            .entwurf(&w.admin, frei, json!([funktion("s3"), funktion("s4")]))
            .await;
        let (s, v) = w.freigeben(&w.admin, frei, id).await;
        assert_eq!(s, StatusCode::OK, "{v}");
        assert_eq!(
            w.gemeldet(frei).await,
            vec![(w.anna, id), (w.bert, id)],
            "{}: Sperre von {} darf nicht wirken",
            frei.art,
            gesperrt.modul
        );
    }
}

/// Spec „Eigene Aktionen benachrichtigen den Auslöser nicht“: gibt S3 selbst frei, bekommt S3
/// nichts, S4 aber schon.
#[tokio::test]
async fn freigebender_bekommt_nichts_auch_in_eigener_funktion() {
    let w = welt().await;
    let anna = w.cookie("annika").await;
    for art in ARTEN {
        let id = w
            .entwurf(&anna, art, json!([funktion("s3"), funktion("s4")]))
            .await;
        let (s, v) = w.freigeben(&anna, art, id).await;
        assert_eq!(s, StatusCode::OK, "{v}");
        assert_eq!(w.gemeldet(art).await, vec![(w.bert, id)], "{}", art.art);
    }
}

/// Eine zweite Freigabe derselben Fassung scheitert (422) und meldet nichts erneut; die
/// Fortschreibung ist erst mit ihrer eigenen Freigabe ein neuer Befehl bzw. Lagebericht und meldet
/// dann genau einmal, mit der neuen Fassung als Bezug.
#[tokio::test]
async fn wiederholte_freigabe_meldet_nicht_doppelt_fortschreibung_meldet_neu() {
    let w = welt().await;
    let anna = w.cookie("annika").await;
    for art in ARTEN {
        let v1 = w.entwurf(&w.admin, art, json!([funktion("s3")])).await;
        let (s, _) = w.freigeben(&w.admin, art, v1).await;
        assert_eq!(s, StatusCode::OK);
        let (s, v) = w.freigeben(&w.admin, art, v1).await;
        assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY, "{v}");
        assert_eq!(w.gemeldet(art).await, vec![(w.anna, v1)], "{}", art.art);

        let v2 = w.fortschreiben(art, v1).await;
        assert_eq!(
            w.gemeldet(art).await,
            vec![(w.anna, v1)],
            "{}: Fortschreiben allein meldet",
            art.art
        );
        let (s, v) = w.freigeben(&w.admin, art, v2).await;
        assert_eq!(s, StatusCode::OK, "{v}");
        assert_eq!(
            w.gemeldet(art).await,
            vec![(w.anna, v1), (w.anna, v2)],
            "{}",
            art.art
        );

        let (_, offen) = anfrage(
            &w.app,
            "GET",
            "/api/benachrichtigungen?offen=true",
            &anna,
            None,
        )
        .await;
        assert!(
            offen
                .as_array()
                .unwrap()
                .iter()
                .any(|b| b["bezug_id"] == v2 && b["detail"] == "Version 2"),
            "{}: {offen}",
            art.art
        );
    }
}
