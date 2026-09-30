//! Integrationstests der Checkliste Arbeitsaufnahme (LFH-551).
//!
//! Spec: `openspec/changes/lfh-551-stab-checkliste-arbeitsaufnahme/specs/stab-checkliste/spec.md`.
//! Die tragenden Aussagen sind die GEZÄHLTEN: kein ETB-Eintrag je Haken außer beim Punkt
//! `leitstelle_gemeldet`, dort genau einer je wirksamem Übergang (E1 = A: auch die Rücknahme).

use axum::http::StatusCode;
use serde_json::Value;

mod common;
use common::*;

fn liste_pfad(einsatz: i64) -> String {
    format!("/api/einsaetze/{einsatz}/stab/checkliste")
}

fn punkt_pfad(einsatz: i64, punkt: &str) -> String {
    format!("/api/einsaetze/{einsatz}/stab/checkliste/{punkt}")
}

async fn setzen(
    app: &axum::Router,
    cookie: &str,
    einsatz: i64,
    punkt: &str,
    body: &str,
) -> (StatusCode, Value) {
    anfrage(app, "PUT", &punkt_pfad(einsatz, punkt), cookie, Some(body)).await
}

/// Die Zeile eines Punkts aus einer Checklisten-Antwort.
fn zeile<'a>(json: &'a Value, punkt: &str) -> Option<&'a Value> {
    json.as_array()?.iter().find(|z| z["punkt"] == punkt)
}

async fn laden(app: &axum::Router, cookie: &str, einsatz: i64) -> Value {
    let (status, json) = anfrage(app, "GET", &liste_pfad(einsatz), cookie, None).await;
    assert_eq!(status, StatusCode::OK, "{json:?}");
    json
}

const ERSTE_SECHS: [&str; 6] = [
    "aufstellort",
    "einweisung",
    "lageskizze",
    "funkarbeitsplaetze",
    "sprechgruppen",
    "etb_eroeffnet",
];

// ---------- Lesen ----------

#[tokio::test]
async fn neue_checkliste_ist_leer() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;

    let json = laden(&app, &admin, einsatz).await;
    assert_eq!(
        json.as_array().map(Vec::len),
        Some(0),
        "keine Zeile = offen; die sieben festen Zeilen baut das Frontend"
    );
}

// ---------- Setzen ----------

#[tokio::test]
async fn haken_legt_die_zeile_lazy_an() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;

    let (status, json) = setzen(&app, &admin, einsatz, "lageskizze", r#"{"erledigt":true}"#).await;
    assert_eq!(status, StatusCode::OK, "{json:?}");
    let arr = json.as_array().expect("Antwort ist die ganze Checkliste");
    assert_eq!(arr.len(), 1, "nur der berührte Punkt hat eine Zeile");
    let z = &arr[0];
    assert_eq!(z["punkt"], "lageskizze");
    assert_eq!(z["erledigt"], true);
    assert!(z["erledigt_at"].is_string(), "Zeitpunkt des Hakens: {z:?}");
    assert!(z["erledigt_von_id"].is_i64());
    assert!(
        !z.as_object().unwrap().contains_key("bemerkung"),
        "keine Bemerkung = Feld fehlt (ehrliche Optionalität): {z:?}"
    );

    let geladen = laden(&app, &admin, einsatz).await;
    assert_eq!(
        geladen, json,
        "GET liefert denselben Stand wie die Quittung"
    );
}

/// Zweimal derselbe Haken: gleicher Zustand, der Zeitpunkt des ERSTEN bleibt.
#[tokio::test]
async fn doppelter_haken_ist_idempotent() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;

    setzen(&app, &admin, einsatz, "einweisung", r#"{"erledigt":true}"#).await;
    // Den Zeitpunkt künstlich zurückdatieren: sonst fiele ein Überschreiben innerhalb derselben
    // Sekunde nicht auf.
    sqlx::query(
        "UPDATE einsatz_stab_checkliste SET erledigt_at = '2026-01-01 00:00:00' \
         WHERE einsatz_id = ? AND punkt = 'einweisung'",
    )
    .bind(einsatz)
    .execute(&pool)
    .await
    .unwrap();

    let (status, json) = setzen(&app, &admin, einsatz, "einweisung", r#"{"erledigt":true}"#).await;
    assert_eq!(status, StatusCode::OK);
    let z = zeile(&json, "einweisung").unwrap();
    assert_eq!(z["erledigt"], true);
    assert_eq!(
        z["erledigt_at"], "2026-01-01 00:00:00",
        "ein erneutes „erledigt“ bewegt den Zeitpunkt nicht"
    );
}

/// Haken und Bemerkung sind zwei Bedienziele: jedes lässt das andere unberührt.
#[tokio::test]
async fn haken_und_bemerkung_lassen_sich_gegenseitig_stehen() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;

    // Erst die Bemerkung: legt die Zeile an, offen.
    let (status, json) = setzen(
        &app,
        &admin,
        einsatz,
        "aufstellort",
        r#"{"bemerkung":"  Parkplatz Feuerwache Nord  "}"#,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{json:?}");
    let z = zeile(&json, "aufstellort").unwrap();
    assert_eq!(z["erledigt"], false);
    assert_eq!(z["bemerkung"], "Parkplatz Feuerwache Nord", "getrimmt");
    assert!(!z.as_object().unwrap().contains_key("erledigt_at"));

    // Haken setzen: Bemerkung bleibt.
    let (_, json) = setzen(&app, &admin, einsatz, "aufstellort", r#"{"erledigt":true}"#).await;
    let z = zeile(&json, "aufstellort").unwrap();
    assert_eq!(z["erledigt"], true);
    assert_eq!(z["bemerkung"], "Parkplatz Feuerwache Nord");

    // Neue Bemerkung: Haken bleibt.
    let (_, json) = setzen(
        &app,
        &admin,
        einsatz,
        "aufstellort",
        r#"{"bemerkung":"Hof"}"#,
    )
    .await;
    let z = zeile(&json, "aufstellort").unwrap();
    assert_eq!(
        z["erledigt"], true,
        "die Bemerkung darf den Haken nicht anfassen"
    );
    assert_eq!(z["bemerkung"], "Hof");

    // Haken entfernen: Bemerkung überlebt, Zeitpunkt fällt.
    let (_, json) = setzen(
        &app,
        &admin,
        einsatz,
        "aufstellort",
        r#"{"erledigt":false}"#,
    )
    .await;
    let z = zeile(&json, "aufstellort").unwrap();
    assert_eq!(z["erledigt"], false);
    assert_eq!(
        z["bemerkung"], "Hof",
        "die Umkehr verliert die Bemerkung nicht"
    );
    assert!(!z.as_object().unwrap().contains_key("erledigt_at"));
    assert!(!z.as_object().unwrap().contains_key("erledigt_von_id"));
}

#[tokio::test]
async fn null_oder_leere_bemerkung_loescht_sie() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;

    for leer in [r#"{"bemerkung":null}"#, r#"{"bemerkung":"   "}"#] {
        setzen(&app, &admin, einsatz, "lageskizze", r#"{"bemerkung":"x"}"#).await;
        let (status, json) = setzen(&app, &admin, einsatz, "lageskizze", leer).await;
        assert_eq!(status, StatusCode::OK, "{leer}: {json:?}");
        let z = zeile(&json, "lageskizze").unwrap();
        assert!(
            !z.as_object().unwrap().contains_key("bemerkung"),
            "{leer} löscht die Bemerkung: {z:?}"
        );
    }
}

/// Jede Ablehnung am Feld ist 400 (LFH-267) und hinterlässt keine Zeile.
#[tokio::test]
async fn ungueltige_eingaben_sind_400_und_speichern_nichts() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let lang = format!(r#"{{"bemerkung":"{}"}}"#, "x".repeat(501));

    for (punkt, body) in [
        ("patienten", r#"{"erledigt":true}"#),
        ("Lageskizze", r#"{"erledigt":true}"#),
        ("lageskizze", "{}"),
        ("lageskizze", r#"{"erledigt":"ja"}"#),
        ("lageskizze", r#"{"erledigt":null}"#),
        ("lageskizze", lang.as_str()),
    ] {
        let (status, json) = setzen(&app, &admin, einsatz, punkt, body).await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{punkt} {body}: {json:?}");
    }
    assert_eq!(
        laden(&app, &admin, einsatz).await.as_array().map(Vec::len),
        Some(0)
    );

    // Die Grenze selbst geht durch.
    let genau = format!(r#"{{"bemerkung":"{}"}}"#, "x".repeat(500));
    let (status, _) = setzen(&app, &admin, einsatz, "lageskizze", &genau).await;
    assert_eq!(status, StatusCode::OK);
}

// ---------- ETB ----------

/// Die ersten sechs Punkte schreiben NIE ins ETB — weder beim Haken noch bei der Umkehr noch bei
/// der Bemerkung.
#[tokio::test]
async fn die_ersten_sechs_punkte_schreiben_nichts_ins_etb() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let vorher = system_etb_anzahl(&app, &admin, einsatz).await;

    for punkt in ERSTE_SECHS {
        for body in [
            r#"{"erledigt":true}"#,
            r#"{"bemerkung":"Notiz"}"#,
            r#"{"erledigt":false}"#,
        ] {
            let (status, _) = setzen(&app, &admin, einsatz, punkt, body).await;
            assert_eq!(status, StatusCode::OK, "{punkt} {body}");
        }
    }
    assert_eq!(
        system_etb_anzahl(&app, &admin, einsatz).await,
        vorher,
        "ein Haken am Arbeitsmittel ist kein Führungsnachweis"
    );
}

/// Der eine Beleg: je wirksamem Übergang genau ein Eintrag, ohne Übergang keiner.
#[tokio::test]
async fn meldung_an_die_leitstelle_wird_je_uebergang_genau_einmal_belegt() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let basis = system_etb_anzahl(&app, &admin, einsatz).await;
    let p = "leitstelle_gemeldet";

    // Eine Bemerkung auf dem offenen Punkt ist kein Übergang.
    setzen(
        &app,
        &admin,
        einsatz,
        p,
        r#"{"bemerkung":"über Funk, 14:32"}"#,
    )
    .await;
    assert_eq!(system_etb_anzahl(&app, &admin, einsatz).await, basis);
    // Entfernen eines nie gesetzten Hakens ist kein Übergang.
    setzen(&app, &admin, einsatz, p, r#"{"erledigt":false}"#).await;
    assert_eq!(system_etb_anzahl(&app, &admin, einsatz).await, basis);

    setzen(&app, &admin, einsatz, p, r#"{"erledigt":true}"#).await;
    assert_eq!(system_etb_anzahl(&app, &admin, einsatz).await, basis + 1);
    setzen(&app, &admin, einsatz, p, r#"{"erledigt":true}"#).await;
    assert_eq!(
        system_etb_anzahl(&app, &admin, einsatz).await,
        basis + 1,
        "erneutes „erledigt“ ist kein Übergang"
    );

    setzen(&app, &admin, einsatz, p, r#"{"erledigt":false}"#).await;
    assert_eq!(
        system_etb_anzahl(&app, &admin, einsatz).await,
        basis + 2,
        "die Rücknahme wird belegt (E1 = A)"
    );
    setzen(&app, &admin, einsatz, p, r#"{"erledigt":false}"#).await;
    assert_eq!(system_etb_anzahl(&app, &admin, einsatz).await, basis + 2);

    let inhalte = system_etb_inhalte(&app, &admin, einsatz).await;
    let gemeldet = inhalte
        .iter()
        .filter(|i| {
            i.contains("Einsatzbereitschaft der Führungseinheit an die Leitstelle gemeldet")
        })
        .count();
    let zurueck = inhalte
        .iter()
        .filter(|i| i.contains("zurückgenommen"))
        .count();
    assert_eq!((gemeldet, zurueck), (1, 1), "{inhalte:?}");
    assert!(
        inhalte.iter().all(|i| !i.contains("über Funk")),
        "die Bemerkung geht nicht in den ETB-Text ein: {inhalte:?}"
    );
}

// ---------- Live ----------

#[tokio::test]
async fn live_stab_immer_etb_nur_beim_beleg() {
    let (app, _pool, live) = setup_mit_pool_und_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;

    let zaehle = |rx: &mut tokio::sync::broadcast::Receiver<_>| {
        let (mut stab, mut etb) = (0, 0);
        while let Ok(n) = rx.try_recv() {
            let n: lifeline_hub::live::LiveNachricht = n;
            match n.event.as_str() {
                "stab" => stab += 1,
                "etb" => etb += 1,
                _ => {}
            }
        }
        (stab, etb)
    };

    let mut rx = live.abonniere(einsatz);
    setzen(&app, &admin, einsatz, "lageskizze", r#"{"erledigt":true}"#).await;
    assert_eq!(
        zaehle(&mut rx),
        (1, 0),
        "Arbeitsmittel: Stab-Ereignis, kein ETB"
    );

    let mut rx = live.abonniere(einsatz);
    setzen(
        &app,
        &admin,
        einsatz,
        "leitstelle_gemeldet",
        r#"{"erledigt":true}"#,
    )
    .await;
    assert_eq!(
        zaehle(&mut rx),
        (1, 1),
        "der Beleg entsteht im selben Commit und muss die ETB-Chronologie anderer anstoßen"
    );
}

// ---------- Rechte und Lebenszyklus ----------

#[tokio::test]
async fn beobachter_liest_aber_schreibt_nicht() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    setzen(&app, &admin, einsatz, "lageskizze", r#"{"erledigt":true}"#).await;
    let beob = benutzer_anlegen(&app, &admin, "beobachter", "keine").await;
    rolle_setzen(&app, &admin, einsatz, beob, "beobachter").await;
    let beob_cookie = login_cookie(&app, "beobachter", "beobachterpw1").await;

    let json = laden(&app, &beob_cookie, einsatz).await;
    assert_eq!(
        json.as_array().map(Vec::len),
        Some(1),
        "Beobachter sieht den Stand"
    );

    let (status, _) = setzen(
        &app,
        &beob_cookie,
        einsatz,
        "lageskizze",
        r#"{"erledigt":false}"#,
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    assert_eq!(
        zeile(&laden(&app, &admin, einsatz).await, "lageskizze").unwrap()["erledigt"],
        true
    );
}

#[tokio::test]
async fn fremde_org_wird_abgewiesen() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    fremde_org_anlegen(&pool, "Fremd-Orga", "fremd", "fremdpw1", "fuehrungskraft").await;
    let fremd = login_cookie(&app, "fremd", "fremdpw1").await;

    for (methode, pfad, body) in [
        ("GET", liste_pfad(einsatz), None),
        (
            "PUT",
            punkt_pfad(einsatz, "lageskizze"),
            Some(r#"{"erledigt":true}"#),
        ),
    ] {
        let (status, _) = anfrage(&app, methode, &pfad, &fremd, body).await;
        assert!(
            status == StatusCode::FORBIDDEN || status == StatusCode::NOT_FOUND,
            "{methode} {pfad}: erwartet 403/404, war {status}"
        );
    }
    let (status, _) = anfrage(&app, "GET", &liste_pfad(999_999), &admin, None).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn abgeschlossener_einsatz_ist_409_und_bleibt_lesbar() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/abschliessen"),
        &admin,
        None,
    )
    .await;

    let (status, _) = setzen(&app, &admin, einsatz, "lageskizze", r#"{"erledigt":true}"#).await;
    assert_eq!(status, StatusCode::CONFLICT);
    assert_eq!(
        laden(&app, &admin, einsatz).await.as_array().map(Vec::len),
        Some(0)
    );
}

// ---------- Schwärzung ----------

/// Die Bemerkung ist Freitext und kann Namen tragen: sie fällt, das Skelett bleibt. Getrieben
/// über denselben Registry-Scrub wie die Schwärzung selbst.
#[tokio::test]
async fn schwaerzung_nullt_die_bemerkung_und_behaelt_den_haken() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    setzen(&app, &admin, einsatz, "einweisung", r#"{"erledigt":true}"#).await;
    setzen(
        &app,
        &admin,
        einsatz,
        "einweisung",
        r#"{"bemerkung":"durch BI Müller"}"#,
    )
    .await;

    let mut tx = pool.begin().await.unwrap();
    lifeline_hub::einsatz::schwaerzung_registry::scrubbe_aus_registry(&mut tx, einsatz)
        .await
        .unwrap();
    tx.commit().await.unwrap();

    let (erledigt, erledigt_at, bemerkung): (i64, Option<String>, Option<String>) = sqlx::query_as(
        "SELECT erledigt, erledigt_at, bemerkung FROM einsatz_stab_checkliste \
             WHERE einsatz_id = ? AND punkt = 'einweisung'",
    )
    .bind(einsatz)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(erledigt, 1);
    assert!(erledigt_at.is_some());
    assert_eq!(bemerkung, None);
}
