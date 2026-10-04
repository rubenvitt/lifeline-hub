//! Das Live-Ereignis des Einsatzkopfs `einsatz` (LFH-555).
//!
//! Wer es feuert, wann es ausbleibt, was es trägt. Wer es empfängt (Modul-Filter des Feeds),
//! prüft `modul_override.rs`. Spec: `openspec/specs/einsatzkopf-live/`, Herleitung
//! `openspec/changes/archive/2026-09-30-lfh-555-einsatzkopf-live/design.md`.
//!
//! Seit LFH-854 feuert auch eine Mitgliedschaftsänderung `einsatz`, damit `meine_rolle` (und
//! mit ihr das Schreibrecht) auf dem Schirm der betroffenen Person ohne Neuladen frisch wird.
//! Herleitung und Leck-Abwägung:
//! `openspec/changes/archive/2026-10-04-lfh-854-rollenwechsel-live/design.md`.

use axum::http::StatusCode;
use lifeline_hub::live::{LiveEvent, LiveNachricht};
use tokio::sync::broadcast::Receiver;

mod common;
use common::*;

/// Leert den Empfänger und liefert alle bis hierher publizierten Nachrichten.
fn eingegangen(rx: &mut Receiver<LiveNachricht>) -> Vec<LiveNachricht> {
    let mut alle = Vec::new();
    while let Ok(n) = rx.try_recv() {
        alle.push(n);
    }
    alle
}

fn kopf_events(nachrichten: &[LiveNachricht]) -> Vec<&LiveNachricht> {
    nachrichten
        .iter()
        .filter(|n| n.event == LiveEvent::Einsatz)
        .collect()
}

fn anzahl(nachrichten: &[LiveNachricht], event: LiveEvent) -> usize {
    nachrichten.iter().filter(|n| n.event == event).count()
}

fn besprechungen_pfad(einsatz: i64) -> String {
    format!("/api/einsaetze/{einsatz}/stab/lagebesprechungen")
}

/// Schliesst eine Lagebesprechung mit dem gegebenen Rumpf ab (Vorbedingung: 201).
async fn besprechung(app: &axum::Router, cookie: &str, einsatz: i64, rumpf: &str) {
    let (status, json) = anfrage(
        app,
        "POST",
        &besprechungen_pfad(einsatz),
        cookie,
        Some(rumpf),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "Vorbedingung: {json:?}");
}

// ---------- Kopfdaten, Abschluss, Frist ----------

#[tokio::test]
async fn patch_der_kopfdaten_feuert_einsatz_nur_mit_der_kennung() {
    let (app, _pool, live) = setup_mit_pool_und_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let mut rx = live.abonniere(einsatz);

    let (status, json) = anfrage(
        &app,
        "PATCH",
        &format!("/api/einsaetze/{einsatz}"),
        &admin,
        Some(r#"{"naechste_lagebesprechung_at":"2026-09-30 18:00:00","sachverhalt":"Geheim"}"#),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{json:?}");

    let alle = eingegangen(&mut rx);
    let kopf = kopf_events(&alle);
    assert_eq!(kopf.len(), 1, "genau ein `einsatz`-Ereignis: {alle:?}");
    assert_eq!(
        kopf[0].data,
        format!(r#"{{"einsatz_id":{einsatz}}}"#),
        "die Nutzlast trägt nur die Kennung, keine Kopfdaten"
    );
}

#[tokio::test]
async fn abgelehnter_patch_feuert_nichts() {
    let (app, _pool, live) = setup_mit_pool_und_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let mut rx = live.abonniere(einsatz);

    let (status, _) = anfrage(
        &app,
        "PATCH",
        &format!("/api/einsaetze/{einsatz}"),
        &admin,
        Some(r#"{"bezeichnung":"   "}"#),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert!(kopf_events(&eingegangen(&mut rx)).is_empty());
}

#[tokio::test]
async fn abschluss_des_einsatzes_feuert_einsatz() {
    let (app, _pool, live) = setup_mit_pool_und_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let mut rx = live.abonniere(einsatz);

    let (status, json) = anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/abschliessen"),
        &admin,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{json:?}");
    assert_eq!(kopf_events(&eingegangen(&mut rx)).len(), 1);
}

#[tokio::test]
async fn frist_setzen_feuert_einsatz_unveraendert_nicht() {
    let (app, _pool, live) = setup_mit_pool_und_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let pfad = format!("/api/einsaetze/{einsatz}/aufbewahrungsfrist");
    let rumpf = r#"{"retention_bis":"2099-01-01 00:00:00","bestaetigt":true}"#;

    let mut rx = live.abonniere(einsatz);
    let (status, json) = anfrage(&app, "PUT", &pfad, &admin, Some(rumpf)).await;
    assert_eq!(status, StatusCode::OK, "{json:?}");
    assert_eq!(kopf_events(&eingegangen(&mut rx)).len(), 1);

    // Dieselbe Frist noch einmal: 200 ohne UPDATE, also auch ohne Ereignis.
    let (status, _) = anfrage(&app, "PUT", &pfad, &admin, Some(rumpf)).await;
    assert_eq!(status, StatusCode::OK);
    assert!(kopf_events(&eingegangen(&mut rx)).is_empty());
}

// ---------- System-ETB aus Abschluss, Frist und Wiederherstellen (LFH-858) ----------

/// Die `etb`-Ereignisse als Nutzlast, in Eingangsreihenfolge.
fn etb_nutzlasten(nachrichten: &[LiveNachricht]) -> Vec<&str> {
    nachrichten
        .iter()
        .filter(|n| n.event == LiveEvent::Etb)
        .map(|n| n.data.as_str())
        .collect()
}

/// Die Kennungen der System-Einträge eines Einsatzes, aufsteigend.
async fn system_eintraege(pool: &sqlx::SqlitePool, einsatz: i64) -> Vec<i64> {
    sqlx::query_scalar(
        "SELECT id FROM etb_eintrag WHERE einsatz_id = ? AND typ = 'system' ORDER BY id",
    )
    .bind(einsatz)
    .fetch_all(pool)
    .await
    .unwrap()
}

/// Die Einträge, die zwischen zwei Ständen von [`system_eintraege`] neu hinzukamen.
fn neu(vorher: &[i64], nachher: &[i64]) -> Vec<i64> {
    nachher
        .iter()
        .copied()
        .filter(|id| !vorher.contains(id))
        .collect()
}

fn etb_nutzlast(einsatz: i64, etb_id: i64) -> String {
    format!(r#"{{"einsatz_id":{einsatz},"etb_id":{etb_id}}}"#)
}

async fn abschliessen(app: &axum::Router, cookie: &str, einsatz: i64) {
    let (status, json) = anfrage(
        app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/abschliessen"),
        cookie,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{json:?}");
}

#[tokio::test]
async fn abschluss_mit_dauer_politik_meldet_den_frist_eintrag_im_etb() {
    let (app, pool, live) = setup_mit_pool_und_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let (status, json) = anfrage(
        &app,
        "PUT",
        &format!("/api/einsaetze/{einsatz}/einstellungen"),
        &admin,
        Some(r#"{"retention_dauer_tage":365}"#),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "Vorbedingung: {json:?}");
    let vorher = system_eintraege(&pool, einsatz).await;

    let mut rx = live.abonniere(einsatz);
    abschliessen(&app, &admin, einsatz).await;

    let eintraege = neu(&vorher, &system_eintraege(&pool, einsatz).await);
    assert_eq!(eintraege.len(), 1, "Vorbedingung: ein Frist-Eintrag");
    let alle = eingegangen(&mut rx);
    assert_eq!(
        etb_nutzlasten(&alle),
        [etb_nutzlast(einsatz, eintraege[0])],
        "genau ein `etb`-Ereignis mit der Kennung des Frist-Eintrags: {alle:?}"
    );
}

#[tokio::test]
async fn abschluss_ohne_dauer_politik_meldet_kein_etb() {
    let (app, _pool, live) = setup_mit_pool_und_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;

    let mut rx = live.abonniere(einsatz);
    abschliessen(&app, &admin, einsatz).await;
    let alle = eingegangen(&mut rx);
    assert_eq!(
        anzahl(&alle, LiveEvent::Einsatz),
        1,
        "Vorbedingung: {alle:?}"
    );
    assert!(
        etb_nutzlasten(&alle).is_empty(),
        "kein Eintrag, kein Ereignis: {alle:?}"
    );
}

#[tokio::test]
async fn frist_setzen_meldet_den_audit_eintrag_im_etb() {
    let (app, pool, live) = setup_mit_pool_und_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let pfad = format!("/api/einsaetze/{einsatz}/aufbewahrungsfrist");
    let rumpf = r#"{"retention_bis":"2099-01-01 00:00:00","bestaetigt":true}"#;
    let vorher = system_eintraege(&pool, einsatz).await;

    let mut rx = live.abonniere(einsatz);
    let (status, json) = anfrage(&app, "PUT", &pfad, &admin, Some(rumpf)).await;
    assert_eq!(status, StatusCode::OK, "{json:?}");

    let eintraege = neu(&vorher, &system_eintraege(&pool, einsatz).await);
    assert_eq!(eintraege.len(), 1, "Vorbedingung: ein Audit-Eintrag");
    let alle = eingegangen(&mut rx);
    assert_eq!(
        etb_nutzlasten(&alle),
        [etb_nutzlast(einsatz, eintraege[0])],
        "genau ein `etb`-Ereignis mit der Kennung des Audit-Eintrags: {alle:?}"
    );

    // Unverändert: kein Eintrag, also auch kein `etb`-Ereignis.
    let (status, _) = anfrage(&app, "PUT", &pfad, &admin, Some(rumpf)).await;
    assert_eq!(status, StatusCode::OK);
    assert!(etb_nutzlasten(&eingegangen(&mut rx)).is_empty());
}

#[tokio::test]
async fn wiederherstellen_meldet_den_audit_eintrag_im_etb() {
    let (app, pool, live) = setup_mit_pool_und_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    abschliessen(&app, &admin, einsatz).await;
    // Vorgemerkt seit gestern, Karenz läuft.
    let gestern = (chrono::Utc::now() - chrono::Duration::days(1))
        .format("%Y-%m-%d %H:%M:%S")
        .to_string();
    sqlx::query("UPDATE einsatz SET retention_bis = ?1, geloescht_at = ?1 WHERE id = ?2")
        .bind(&gestern)
        .bind(einsatz)
        .execute(&pool)
        .await
        .unwrap();
    let vorher = system_eintraege(&pool, einsatz).await;

    let mut rx = live.abonniere(einsatz);
    let (status, json) = anfrage(
        &app,
        "POST",
        &format!("/api/aufbewahrung/einsaetze/{einsatz}/wiederherstellen"),
        &admin,
        Some(r#"{"retention_bis":null}"#),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{json:?}");

    let eintraege = neu(&vorher, &system_eintraege(&pool, einsatz).await);
    assert_eq!(eintraege.len(), 1, "Vorbedingung: ein Audit-Eintrag");
    let alle = eingegangen(&mut rx);
    assert_eq!(
        etb_nutzlasten(&alle),
        [etb_nutzlast(einsatz, eintraege[0])],
        "genau ein `etb`-Ereignis mit der Kennung des Audit-Eintrags: {alle:?}"
    );
}

// ---------- Lagebesprechung (design.md D3) ----------

#[tokio::test]
async fn lagebesprechung_mit_neuem_termin_feuert_einsatz_neben_stab_und_etb() {
    let (app, _pool, live) = setup_mit_pool_und_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let mut rx = live.abonniere(einsatz);

    besprechung(
        &app,
        &admin,
        einsatz,
        r#"{"entschluss":"A","abgehalten_at":"2026-09-12 10:00:00","naechste_at":"2026-09-12 12:00:00"}"#,
    )
    .await;

    let alle = eingegangen(&mut rx);
    assert_eq!(anzahl(&alle, LiveEvent::Stab), 1);
    assert_eq!(anzahl(&alle, LiveEvent::Etb), 1);
    assert_eq!(anzahl(&alle, LiveEvent::Einsatz), 1, "{alle:?}");
}

#[tokio::test]
async fn lagebesprechung_ohne_terminaenderung_feuert_kein_einsatz() {
    let (app, _pool, live) = setup_mit_pool_und_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    besprechung(
        &app,
        &admin,
        einsatz,
        r#"{"entschluss":"A","abgehalten_at":"2026-09-12 10:00:00","naechste_at":"2026-09-12 12:00:00"}"#,
    )
    .await;

    // (a) Derselbe Termin noch einmal, in anderer Schreibweise desselben Zeitpunkts.
    let mut rx = live.abonniere(einsatz);
    besprechung(
        &app,
        &admin,
        einsatz,
        r#"{"entschluss":"B","abgehalten_at":"2026-09-12 11:00:00","naechste_at":"2026-09-12T12:00:00Z"}"#,
    )
    .await;
    let alle = eingegangen(&mut rx);
    assert_eq!(anzahl(&alle, LiveEvent::Stab), 1, "Vorbedingung: {alle:?}");
    assert_eq!(
        anzahl(&alle, LiveEvent::Einsatz),
        0,
        "derselbe Termin verrät Kopf-Lesern ohne Stab-Recht keine Besprechung: {alle:?}"
    );

    // (b) Ohne den Schlüssel `naechste_at`: der Termin bleibt, kein Kopf-Ereignis.
    besprechung(
        &app,
        &admin,
        einsatz,
        r#"{"entschluss":"C","abgehalten_at":"2026-09-12 11:30:00"}"#,
    )
    .await;
    let alle = eingegangen(&mut rx);
    assert_eq!(anzahl(&alle, LiveEvent::Stab), 1, "Vorbedingung: {alle:?}");
    assert_eq!(anzahl(&alle, LiveEvent::Einsatz), 0, "{alle:?}");

    // Der Termin steht unverändert am Einsatz.
    let (_, kopf) = anfrage(
        &app,
        "GET",
        &format!("/api/einsaetze/{einsatz}"),
        &admin,
        None,
    )
    .await;
    assert_eq!(kopf["naechste_lagebesprechung_at"], "2026-09-12 12:00:00");
}

#[tokio::test]
async fn lagebesprechung_die_den_termin_aufhebt_feuert_einsatz() {
    let (app, _pool, live) = setup_mit_pool_und_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    besprechung(
        &app,
        &admin,
        einsatz,
        r#"{"entschluss":"A","abgehalten_at":"2026-09-12 10:00:00","naechste_at":"2026-09-12 12:00:00"}"#,
    )
    .await;

    let mut rx = live.abonniere(einsatz);
    besprechung(
        &app,
        &admin,
        einsatz,
        r#"{"entschluss":"B","abgehalten_at":"2026-09-12 11:00:00","naechste_at":null}"#,
    )
    .await;
    assert_eq!(anzahl(&eingegangen(&mut rx), LiveEvent::Einsatz), 1);

    // Schon leer und wieder `null`: keine Änderung, kein Ereignis.
    besprechung(
        &app,
        &admin,
        einsatz,
        r#"{"entschluss":"C","abgehalten_at":"2026-09-12 11:30:00","naechste_at":null}"#,
    )
    .await;
    assert_eq!(anzahl(&eingegangen(&mut rx), LiveEvent::Einsatz), 0);
}

// ---------- Bewusst nicht live (design.md D5) ----------

#[tokio::test]
async fn besetzung_eines_sachgebiets_feuert_kein_einsatz() {
    let (app, _pool, live) = setup_mit_pool_und_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let mut rx = live.abonniere(einsatz);

    let (status, json) = anfrage(
        &app,
        "PUT",
        &format!("/api/einsaetze/{einsatz}/stab/besetzung/s2"),
        &admin,
        Some(r#"{"besetzung_art":"einsatzleitung"}"#),
    )
    .await;
    assert!(status.is_success(), "Vorbedingung: {status} {json:?}");

    let alle = eingegangen(&mut rx);
    assert_eq!(anzahl(&alle, LiveEvent::Stab), 1, "Vorbedingung: {alle:?}");
    assert_eq!(anzahl(&alle, LiveEvent::Einsatz), 0, "{alle:?}");
}

// ---------- Mitgliedschaft (LFH-854) ----------

fn mitglied_pfad(einsatz: i64, benutzer: i64) -> String {
    format!("/api/einsaetze/{einsatz}/mitglieder/{benutzer}")
}

/// Setzt die Rolle eines Mitglieds (Vorbedingung: 200).
async fn rolle_setzen(app: &axum::Router, cookie: &str, einsatz: i64, benutzer: i64, rolle: &str) {
    let rumpf = format!(r#"{{"einsatz_rolle":"{rolle}"}}"#);
    let (status, json) = anfrage(
        app,
        "PUT",
        &mitglied_pfad(einsatz, benutzer),
        cookie,
        Some(&rumpf),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "Vorbedingung: {json:?}");
}

/// Die Benutzerkennung des Admin-Kontos der Test-Instanz (erste Einsatzleitung jedes Einsatzes).
async fn admin_id(pool: &sqlx::SqlitePool) -> i64 {
    sqlx::query_scalar("SELECT id FROM benutzer WHERE benutzername = 'admin'")
        .fetch_one(pool)
        .await
        .unwrap()
}

#[tokio::test]
async fn rollenwechsel_feuert_einsatz_nur_mit_der_kennung() {
    let (app, _pool, live) = setup_mit_pool_und_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let mitglied = benutzer_anlegen(&app, &admin, "mitglied", "keine").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let mut rx = live.abonniere(einsatz);

    rolle_setzen(&app, &admin, einsatz, mitglied, "beobachter").await;
    let alle = eingegangen(&mut rx);
    let kopf = kopf_events(&alle);
    assert_eq!(kopf.len(), 1, "Aufnahme: genau ein `einsatz`: {alle:?}");
    assert_eq!(
        kopf[0].data,
        format!(r#"{{"einsatz_id":{einsatz}}}"#),
        "die Nutzlast trägt nur die Kennung, keine Rolle"
    );

    rolle_setzen(&app, &admin, einsatz, mitglied, "fuehrungspersonal").await;
    assert_eq!(
        kopf_events(&eingegangen(&mut rx)).len(),
        1,
        "Wechsel Beobachter → Führungspersonal"
    );
}

#[tokio::test]
async fn entfernen_eines_mitglieds_feuert_einsatz() {
    let (app, _pool, live) = setup_mit_pool_und_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let mitglied = benutzer_anlegen(&app, &admin, "mitglied", "keine").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    rolle_setzen(&app, &admin, einsatz, mitglied, "fuehrungspersonal").await;
    let mut rx = live.abonniere(einsatz);

    let (status, json) = anfrage(
        &app,
        "DELETE",
        &mitglied_pfad(einsatz, mitglied),
        &admin,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{json:?}");
    assert_eq!(kopf_events(&eingegangen(&mut rx)).len(), 1);
}

#[tokio::test]
async fn abgelehnte_mitgliedschaftsaenderung_feuert_nichts() {
    let (app, pool, live) = setup_mit_pool_und_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let fp = benutzer_anlegen(&app, &admin, "fuehrpers", "keine").await;
    let ziel = benutzer_anlegen(&app, &admin, "zielperson", "keine").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    rolle_setzen(&app, &admin, einsatz, fp, "fuehrungspersonal").await;
    let admin_id = admin_id(&pool).await;
    let mut rx = live.abonniere(einsatz);

    // Letzte Einsatzleitung herabstufen bzw. entfernen: 409.
    let (status, _) = anfrage(
        &app,
        "PUT",
        &mitglied_pfad(einsatz, admin_id),
        &admin,
        Some(r#"{"einsatz_rolle":"beobachter"}"#),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT);
    let (status, _) = anfrage(
        &app,
        "DELETE",
        &mitglied_pfad(einsatz, admin_id),
        &admin,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT);

    // Unbekannter Benutzer: 404.
    let (status, _) = anfrage(
        &app,
        "PUT",
        &mitglied_pfad(einsatz, 999_999),
        &admin,
        Some(r#"{"einsatz_rolle":"beobachter"}"#),
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);

    // Führungspersonal ohne Leitungsrecht: 403.
    let fp_cookie = login_cookie(&app, "fuehrpers", "fuehrperspw1").await;
    let (status, _) = anfrage(
        &app,
        "PUT",
        &mitglied_pfad(einsatz, ziel),
        &fp_cookie,
        Some(r#"{"einsatz_rolle":"beobachter"}"#),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);

    let alle = eingegangen(&mut rx);
    assert!(kopf_events(&alle).is_empty(), "{alle:?}");
}

// ---------- Umschalten einer Lagekennzahl (LFH-855) ----------
//
// `einsatz` fällt nur, wenn sich die Menge der aktiven Lagekennzahlen ändert — nie bei jeder
// Änderung an Pegel oder Bezirk. Herleitung:
// `openspec/changes/archive/2026-10-04-lfh-855-lagekennzahl-umschalten-live/design.md` D1.

const PEGEL_A: &str = "a6ee8177-107b-47dd-bcfd-30960ccc6e9c";
const PEGEL_B: &str = "593647aa-9fea-43ec-a7d6-6476a76ae868";

/// Router mit LiveHub, dessen PEGELONLINE-Basis sofort scheitert und dessen Nachschlage-Cache in
/// einem eigenen Tempdir liegt: die Pegel-Routen stoßen fehlende Messungen im Hintergrund an,
/// und kein Test geht ins Netz (vgl. Kopf von `tests/pegel.rs`).
async fn setup_pegel_mit_live() -> (axum::Router, lifeline_hub::live::LiveHub, tempfile::TempDir) {
    let dir = tempfile::tempdir().unwrap();
    let mut hub = None;
    let (app, _pool) = setup_mit_state(|s| {
        s.karten_dir = dir.path().to_path_buf();
        s.fachebenen =
            lifeline_hub::karte::FachebenenState::neu().mit_pegel_basis_url("http://127.0.0.1:1");
        hub = Some(s.live.clone());
    })
    .await;
    (app, hub.unwrap(), dir)
}

fn pegel_station(uuid: &str) -> String {
    format!(r#"{{"station_uuid":"{uuid}","name":"Pegel {uuid}","gewaesser":"WESER"}}"#)
}

fn pegel_liste(uuids: &[&str]) -> String {
    let teile: Vec<String> = uuids.iter().map(|u| pegel_station(u)).collect();
    format!(r#"{{"stationen":[{}]}}"#, teile.join(","))
}

async fn pegel_anfuegen(app: &axum::Router, cookie: &str, einsatz: i64, uuid: &str) {
    let (status, json) = anfrage(
        app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/pegel"),
        cookie,
        Some(&pegel_station(uuid)),
    )
    .await;
    assert!(status.is_success(), "Vorbedingung: {status} {json:?}");
}

async fn pegel_ersetzen(app: &axum::Router, cookie: &str, einsatz: i64, uuids: &[&str]) {
    let (status, json) = anfrage(
        app,
        "PUT",
        &format!("/api/einsaetze/{einsatz}/pegel"),
        cookie,
        Some(&pegel_liste(uuids)),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "Vorbedingung: {json:?}");
}

#[tokio::test]
async fn erster_pegel_per_post_feuert_einsatz_weitere_nicht() {
    let (app, live, _dir) = setup_pegel_mit_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let mut rx = live.abonniere(einsatz);

    pegel_anfuegen(&app, &admin, einsatz, PEGEL_A).await;
    let alle = eingegangen(&mut rx);
    let kopf = kopf_events(&alle);
    assert_eq!(kopf.len(), 1, "erster Pegel schaltet `pegel`: {alle:?}");
    assert_eq!(
        serde_json::from_str::<serde_json::Value>(&kopf[0].data).unwrap(),
        serde_json::json!({ "einsatz_id": einsatz })
    );

    // Zweiter Pegel, derselbe noch einmal (idempotent) und Umordnen: kein Umschalten.
    pegel_anfuegen(&app, &admin, einsatz, PEGEL_B).await;
    pegel_anfuegen(&app, &admin, einsatz, PEGEL_B).await;
    pegel_ersetzen(&app, &admin, einsatz, &[PEGEL_B, PEGEL_A]).await;
    pegel_ersetzen(&app, &admin, einsatz, &[PEGEL_B]).await;
    let alle = eingegangen(&mut rx);
    assert_eq!(anzahl(&alle, LiveEvent::Einsatz), 0, "{alle:?}");
}

#[tokio::test]
async fn pegelliste_per_put_schaltet_in_beide_richtungen() {
    let (app, live, _dir) = setup_pegel_mit_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let mut rx = live.abonniere(einsatz);

    // Leer bleibt leer: kein Umschalten.
    pegel_ersetzen(&app, &admin, einsatz, &[]).await;
    assert_eq!(anzahl(&eingegangen(&mut rx), LiveEvent::Einsatz), 0);

    pegel_ersetzen(&app, &admin, einsatz, &[PEGEL_A, PEGEL_B]).await;
    assert_eq!(anzahl(&eingegangen(&mut rx), LiveEvent::Einsatz), 1);

    // Die Liste leeren nimmt den Platz zurück.
    pegel_ersetzen(&app, &admin, einsatz, &[]).await;
    assert_eq!(anzahl(&eingegangen(&mut rx), LiveEvent::Einsatz), 1);
}

#[tokio::test]
async fn prognose_eines_pegels_feuert_kein_einsatz() {
    let (app, live, _dir) = setup_pegel_mit_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    pegel_anfuegen(&app, &admin, einsatz, PEGEL_A).await;
    let (_, liste) = anfrage(
        &app,
        "GET",
        &format!("/api/einsaetze/{einsatz}/pegel"),
        &admin,
        None,
    )
    .await;
    let pegel_id = liste[0]["id"].as_i64().expect("Pegel-id");

    let mut rx = live.abonniere(einsatz);
    let (status, json) = anfrage(
        &app,
        "PUT",
        &format!("/api/einsaetze/{einsatz}/pegel/{pegel_id}/prognose"),
        &admin,
        Some(r#"{"hoechststand_cm":420,"zeitpunkt":"2026-09-22T18:00:00+02:00"}"#),
    )
    .await;
    assert!(status.is_success(), "Vorbedingung: {status} {json:?}");
    assert_eq!(anzahl(&eingegangen(&mut rx), LiveEvent::Einsatz), 0);
}

fn betreuung_pfad(einsatz: i64) -> String {
    format!("/api/einsaetze/{einsatz}/betreuung")
}

async fn bezirk_anlegen(app: &axum::Router, cookie: &str, einsatz: i64, bezeichnung: &str) -> i64 {
    let (status, json) = anfrage(
        app,
        "POST",
        &format!("{}/bezirke", betreuung_pfad(einsatz)),
        cookie,
        Some(&format!(
            r#"{{"bezeichnung":"{bezeichnung}","plan_personen":640,"plan_erhebung":"geschaetzt"}}"#
        )),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "Vorbedingung: {json:?}");
    json["id"].as_i64().unwrap()
}

async fn bezirk_aendern(app: &axum::Router, cookie: &str, einsatz: i64, bid: i64, rumpf: &str) {
    let (status, json) = anfrage(
        app,
        "PATCH",
        &format!("{}/bezirke/{bid}", betreuung_pfad(einsatz)),
        cookie,
        Some(rumpf),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "Vorbedingung: {json:?}");
}

async fn bezirk_stornieren(app: &axum::Router, cookie: &str, einsatz: i64, bid: i64) {
    let (status, json) = anfrage(
        app,
        "POST",
        &format!("{}/bezirke/{bid}/stornieren", betreuung_pfad(einsatz)),
        cookie,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "Vorbedingung: {json:?}");
}

#[tokio::test]
async fn erste_evakuierung_feuert_einsatz_neben_betreuung_weitere_nicht() {
    let (app, _pool, live) = setup_mit_pool_und_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let mut rx = live.abonniere(einsatz);

    let erster = bezirk_anlegen(&app, &admin, einsatz, "Uferstraße").await;
    let alle = eingegangen(&mut rx);
    assert_eq!(
        anzahl(&alle, LiveEvent::Betreuung),
        1,
        "Vorbedingung: {alle:?}"
    );
    assert_eq!(anzahl(&alle, LiveEvent::Einsatz), 1, "{alle:?}");

    // Zweiter Bezirk, Stammdaten, Räumung ohne Wechsel über `aufgehoben`, Stand: kein Umschalten.
    let zweiter = bezirk_anlegen(&app, &admin, einsatz, "Altstadt").await;
    bezirk_aendern(&app, &admin, einsatz, erster, r#"{"plan_personen":700}"#).await;
    bezirk_aendern(&app, &admin, einsatz, erster, r#"{"raeumung":"geraeumt"}"#).await;
    let (status, json) = anfrage(
        &app,
        "POST",
        &format!("{}/bezirke/{erster}/staende", betreuung_pfad(einsatz)),
        &admin,
        Some(r#"{"evakuiert":120,"erhebung":"gezaehlt"}"#),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "Vorbedingung: {json:?}");
    // Einer von zwei aktiven fällt weg: die Anordnung bleibt.
    bezirk_aendern(
        &app,
        &admin,
        einsatz,
        zweiter,
        r#"{"raeumung":"aufgehoben"}"#,
    )
    .await;
    let alle = eingegangen(&mut rx);
    assert_eq!(
        anzahl(&alle, LiveEvent::Betreuung),
        5,
        "Vorbedingung: {alle:?}"
    );
    assert_eq!(anzahl(&alle, LiveEvent::Einsatz), 0, "{alle:?}");
}

#[tokio::test]
async fn letzte_evakuierung_aufgehoben_und_wieder_angeordnet_feuert_einsatz() {
    let (app, _pool, live) = setup_mit_pool_und_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let bid = bezirk_anlegen(&app, &admin, einsatz, "Uferstraße").await;
    let mut rx = live.abonniere(einsatz);

    bezirk_aendern(&app, &admin, einsatz, bid, r#"{"raeumung":"aufgehoben"}"#).await;
    assert_eq!(anzahl(&eingegangen(&mut rx), LiveEvent::Einsatz), 1);

    bezirk_aendern(&app, &admin, einsatz, bid, r#"{"raeumung":"laeuft"}"#).await;
    assert_eq!(anzahl(&eingegangen(&mut rx), LiveEvent::Einsatz), 1);
}

#[tokio::test]
async fn stornieren_des_letzten_aktiven_bezirks_feuert_einsatz() {
    let (app, _pool, live) = setup_mit_pool_und_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let erster = bezirk_anlegen(&app, &admin, einsatz, "Uferstraße").await;
    let zweiter = bezirk_anlegen(&app, &admin, einsatz, "Altstadt").await;
    let mut rx = live.abonniere(einsatz);

    bezirk_stornieren(&app, &admin, einsatz, erster).await;
    assert_eq!(
        anzahl(&eingegangen(&mut rx), LiveEvent::Einsatz),
        0,
        "ein aktiver Bezirk bleibt"
    );
    bezirk_stornieren(&app, &admin, einsatz, zweiter).await;
    assert_eq!(anzahl(&eingegangen(&mut rx), LiveEvent::Einsatz), 1);
}
