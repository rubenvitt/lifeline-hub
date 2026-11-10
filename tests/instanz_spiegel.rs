//! Spiegel und Anträge (LLH-1492, Specs `einsatz-spiegel` und `spiegel-antraege`): ein Einsatz
//! an einer gekoppelten Instanz, die ihn nicht führt. Die Fälle mit zwei Instanzen laufen wie in
//! `tests/instanz_stammdaten.rs` mit je eigener DB und eigenem Server auf Loopback.

mod common;
mod instanz_hilfen;

use axum::http::StatusCode;
use instanz_hilfen::*;
use serde_json::json;

const SPIEGEL_409: &str =
    "Dieser Einsatz ist ein Spiegel; ändern geht nur als Antrag an die führende Instanz.";

/// Markiert einen Einsatz von Hand als Spiegel, ohne zweite Instanz: unter dem Merker der
/// Übernahme, wie jede Übergabe.
async fn als_spiegel(pool: &sqlx::SqlitePool, einsatz: i64) {
    let mut tx = pool.begin().await.unwrap();
    for sql in [
        "INSERT INTO spiegel_uebernahme (id) VALUES (1)".to_string(),
        format!("INSERT INTO einsatz_spiegel (einsatz_id, fremde_kennung) VALUES ({einsatz}, 'x/{einsatz}')"),
        "DELETE FROM spiegel_uebernahme".to_string(),
    ] {
        sqlx::query(sqlx::AssertSqlSafe(sql))
            .execute(&mut *tx)
            .await
            .unwrap();
    }
    tx.commit().await.unwrap();
}

// ── Schreibschutz (D10) ──────────────────────────────────────────────────────────────────────

#[tokio::test]
async fn schreibende_routen_am_spiegel_enden_mit_409_die_lesemarke_nicht() {
    let i = instanz().await;
    let e = common::einsatz_anlegen(&i.app, &i.admin).await;
    let (s, v) = common::anfrage_json(
        &i.app,
        "POST",
        &format!("/api/einsaetze/{e}/schaeden"),
        &i.admin,
        Some(&json!({ "typ": "sachschaden", "ausmass": "gering", "ort": "Hauptstr. 1" })),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
    let schaden = v["id"].as_i64().unwrap();
    als_spiegel(&i.pool, e).await;

    for (methode, pfad, body) in [
        (
            "PATCH",
            format!("/api/einsaetze/{e}"),
            json!({ "bezeichnung": "Neu" }),
        ),
        (
            "POST",
            format!("/api/einsaetze/{e}/schaeden"),
            json!({ "typ": "sachschaden", "ausmass": "gering", "ort": "Hauptstr. 2" }),
        ),
        (
            "PATCH",
            format!("/api/einsaetze/{e}/schaeden/{schaden}"),
            json!({ "ort": "Hauptstr. 3" }),
        ),
    ] {
        let (s, v) = common::anfrage_json(&i.app, methode, &pfad, &i.admin, Some(&body)).await;
        assert_eq!(s, StatusCode::CONFLICT, "{methode} {pfad}: {v}");
        assert_eq!(v["error"], SPIEGEL_409, "{methode} {pfad}");
    }
    let bezeichnung: String = eine(
        &i.pool,
        &format!("SELECT bezeichnung FROM einsatz WHERE id = {e}"),
    )
    .await;
    assert_eq!(bezeichnung, "Lage", "nichts geschrieben");

    // Die Lesemarke gehört der Person an dieser Instanz und wird nicht gespiegelt.
    let lfd: i64 = eine(
        &i.pool,
        &format!("SELECT COALESCE(MAX(lfd_nr), 0) FROM etb_eintrag WHERE einsatz_id = {e}"),
    )
    .await;
    let (s, v) = common::anfrage(
        &i.app,
        "POST",
        &format!("/api/einsaetze/{e}/etb/lesemarke"),
        &i.admin,
        Some(&format!(r#"{{"bis_lfd_nr":{lfd}}}"#)),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
}

// ── Abgleich mit zwei Instanzen (D6, D12) ────────────────────────────────────────────────────

/// Gekoppelt und einmal gemeldet: beide Seiten kennen die Protokollversion des Gegenübers.
async fn gekoppelt_gemeldet() -> (Instanz, Instanz) {
    let (hub, elw) = gekoppelt().await;
    melden(&elw).await;
    (hub, elw)
}

async fn abgleichen(elw: &Instanz) {
    lifeline_hub::instanz::spiegel::takt::durchlauf(&elw.pool, true)
        .await
        .unwrap();
}

async fn etb_eintrag(i: &Instanz, einsatz: i64, inhalt: &str) {
    let (s, v) = common::anfrage_json(
        &i.app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/etb"),
        &i.admin,
        Some(&json!({ "typ": "meldung", "inhalt": inhalt, "von": "ELW", "an": "EL" })),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
}

async fn spiegel_von(i: &Instanz) -> i64 {
    eine(&i.pool, "SELECT einsatz_id FROM einsatz_spiegel").await
}

async fn etb_inhalte(i: &Instanz, einsatz: i64) -> Vec<String> {
    let (s, v) = common::anfrage(
        &i.app,
        "GET",
        &format!("/api/einsaetze/{einsatz}/etb"),
        &i.admin,
        None,
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    let liste = v
        .as_array()
        .cloned()
        .or_else(|| v["eintraege"].as_array().cloned())
        .unwrap_or_default();
    liste
        .iter()
        .filter_map(|e| e["inhalt"].as_str().map(str::to_string))
        .collect()
}

#[tokio::test]
async fn elw_fuehrt_und_der_hub_spiegelt() {
    let (hub, elw) = gekoppelt_gemeldet().await;
    let e = common::einsatz_anlegen_mit(&elw.app, &elw.admin, "Hochwasser").await;
    etb_eintrag(&elw, e, "Lage erkundet").await;
    abgleichen(&elw).await;
    let s = spiegel_von(&hub).await;
    let hinweis: Option<String> = eine(
        &hub.pool,
        &format!("SELECT hinweis FROM einsatz_spiegel WHERE einsatz_id = {s}"),
    )
    .await;
    assert_eq!(hinweis, None, "jede Zeile übernommen");
    // Jede Zeile des Führers hat ihr Gegenstück im Spiegel.
    let fuehrer: i64 = eine(
        &elw.pool,
        &format!("SELECT COUNT(*) FROM einsatz_aenderung WHERE einsatz_id = {e}"),
    )
    .await;
    let gespiegelt: i64 = eine(
        &hub.pool,
        &format!("SELECT COUNT(*) FROM spiegel_herkunft WHERE einsatz_id = {s}"),
    )
    .await;
    assert_eq!(fuehrer, gespiegelt);
    let (st, kopf) = common::anfrage(
        &hub.app,
        "GET",
        &format!("/api/einsaetze/{s}"),
        &hub.admin,
        None,
    )
    .await;
    assert_eq!(st, StatusCode::OK, "{kopf}");
    assert_eq!(kopf["bezeichnung"], "Hochwasser");
    assert!(etb_inhalte(&hub, s)
        .await
        .contains(&"Lage erkundet".to_string()));
    // Am Hub ist der Spiegel nur lesbar.
    let (st, _) = common::anfrage_json(
        &hub.app,
        "PATCH",
        &format!("/api/einsaetze/{s}"),
        &hub.admin,
        Some(&json!({ "bezeichnung": "X" })),
    )
    .await;
    assert_eq!(st, StatusCode::CONFLICT);
    // Ein zweiter Eintrag kommt mit dem nächsten Abgleich.
    etb_eintrag(&elw, e, "Pumpen angefordert").await;
    abgleichen(&elw).await;
    assert!(etb_inhalte(&hub, s)
        .await
        .contains(&"Pumpen angefordert".to_string()));
}

#[tokio::test]
async fn hub_fuehrt_und_der_elw_spiegelt() {
    let (hub, elw) = gekoppelt_gemeldet().await;
    let e = common::einsatz_anlegen_mit(&hub.app, &hub.admin, "Alarm Hub").await;
    etb_eintrag(&hub, e, "Alarm eingegangen").await;
    abgleichen(&elw).await;
    let s = spiegel_von(&elw).await;
    assert!(etb_inhalte(&elw, s)
        .await
        .contains(&"Alarm eingegangen".to_string()));
    let kennung: String = eine(
        &hub.pool,
        &format!("SELECT kennung FROM einsatz WHERE id = {e}"),
    )
    .await;
    let fremd: String = eine(&elw.pool, "SELECT fremde_kennung FROM einsatz_spiegel").await;
    assert_eq!(kennung, fremd, "Kennung über Instanzen gleich");
}

#[tokio::test]
async fn viele_eintraege_ohne_netz_kommen_vollstaendig_an() {
    let (hub, elw) = gekoppelt_gemeldet().await;
    let e = common::einsatz_anlegen(&elw.app, &elw.admin).await;
    for n in 0..300 {
        etb_eintrag(&elw, e, &format!("Eintrag {n}")).await;
    }
    for _ in 0..5 {
        abgleichen(&elw).await;
    }
    let s = spiegel_von(&hub).await;
    let (elw_zahl, hub_zahl): (i64, i64) = (
        eine(
            &elw.pool,
            &format!("SELECT COUNT(*) FROM etb_eintrag WHERE einsatz_id = {e}"),
        )
        .await,
        eine(
            &hub.pool,
            &format!("SELECT COUNT(*) FROM etb_eintrag WHERE einsatz_id = {s}"),
        )
        .await,
    );
    assert_eq!(elw_zahl, hub_zahl);
    let doppelt: i64 = eine(
        &hub.pool,
        &format!(
            "SELECT COUNT(*) - COUNT(DISTINCT lfd_nr) FROM etb_eintrag WHERE einsatz_id = {s}"
        ),
    )
    .await;
    assert_eq!(doppelt, 0);
}

#[tokio::test]
async fn ein_niedrigerer_stand_am_spiegel_laesst_neu_liefern() {
    let (hub, elw) = gekoppelt_gemeldet().await;
    let e = common::einsatz_anlegen(&elw.app, &elw.admin).await;
    etb_eintrag(&elw, e, "Erster").await;
    abgleichen(&elw).await;
    let s = spiegel_von(&hub).await;
    // Wie nach einer Wiederherstellung des Hubs: Stand zurück, der zweite Eintrag fehlt dort.
    exec(
        &hub.pool,
        &format!("UPDATE einsatz_spiegel SET stand = 0 WHERE einsatz_id = {s}"),
    )
    .await;
    etb_eintrag(&elw, e, "Zweiter").await;
    abgleichen(&elw).await;
    abgleichen(&elw).await;
    let inhalte = etb_inhalte(&hub, s).await;
    assert!(inhalte.contains(&"Zweiter".to_string()), "{inhalte:?}");
    let stand: i64 = eine(
        &hub.pool,
        &format!("SELECT stand FROM einsatz_spiegel WHERE einsatz_id = {s}"),
    )
    .await;
    assert!(stand > 0);
}

#[tokio::test]
async fn mit_einem_gegenueber_ohne_spiegel_wird_nicht_abgeglichen() {
    let (hub, elw) = gekoppelt_gemeldet().await;
    exec(
        &elw.pool,
        "UPDATE instanz_kopplung SET gegenueber_protokoll = 1",
    )
    .await;
    common::einsatz_anlegen(&elw.app, &elw.admin).await;
    abgleichen(&elw).await;
    let anzahl: i64 = eine(&hub.pool, "SELECT COUNT(*) FROM einsatz_spiegel").await;
    assert_eq!(anzahl, 0);
}

#[tokio::test]
async fn konten_nur_einer_seite_werden_stellvertreter_ohne_anmeldung_und_ohne_mitgliedschaft() {
    let (hub, elw) = gekoppelt_gemeldet().await;
    // Erika gibt es an beiden Seiten: der Hub verteilt sie an den ELW.
    let (s, v) = common::anfrage_json(
        &hub.app,
        "POST",
        "/api/benutzer",
        &hub.admin,
        Some(&json!({"anzeigename": "Erika", "benutzername": "erika", "passwort": "erikapw12"})),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
    let erika_hub = v["id"].as_i64().unwrap();
    melden(&elw).await;
    let erika_elw = lokale_id(&elw, "benutzer", "benutzername", "erika").await;
    // Spontanhelfer gibt es nur am ELW.
    let spontan = common::benutzer_anlegen(&elw.app, &elw.admin, "spontan", "keine").await;
    let e = common::einsatz_anlegen(&elw.app, &elw.admin).await;
    common::rolle_setzen(&elw.app, &elw.admin, e, spontan, "fuehrungspersonal").await;
    common::rolle_setzen(&elw.app, &elw.admin, e, erika_elw, "beobachter").await;
    let spontan_cookie = common::login_cookie(&elw.app, "spontan", "spontanpw1").await;
    let (s, v) = common::anfrage_json(
        &elw.app,
        "POST",
        &format!("/api/einsaetze/{e}/etb"),
        &spontan_cookie,
        Some(&json!({ "typ": "meldung", "inhalt": "Sandsäcke da", "von": "A", "an": "B" })),
    )
    .await;
    assert_eq!(s, StatusCode::CREATED, "{v}");
    abgleichen(&elw).await;

    let sp = spiegel_von(&hub).await;
    let verfasser: String = eine(
        &hub.pool,
        &format!(
            "SELECT b.anzeigename FROM etb_eintrag e JOIN benutzer b ON b.id = e.erfasser_id \
             WHERE e.einsatz_id = {sp} AND e.inhalt = 'Sandsäcke da'"
        ),
    )
    .await;
    assert_eq!(verfasser, "spontan", "ETB zeigt den Verfasser vom ELW");
    let (s, liste) = common::anfrage(&hub.app, "GET", "/api/benutzer", &hub.admin, None).await;
    assert_eq!(s, StatusCode::OK);
    assert!(
        !liste.as_array().unwrap().iter().any(|b| b["benutzername"]
            .as_str()
            .unwrap_or("")
            .starts_with("spiegel:")),
        "Stellvertreter fehlen in der Benutzerverwaltung: {liste}"
    );
    let stellvertreter: String = eine(
        &hub.pool,
        "SELECT b.benutzername FROM spiegel_konto k JOIN benutzer b ON b.id = k.benutzer_id \
         WHERE b.anzeigename = 'spontan'",
    )
    .await;
    let (s, _) = common::anfrage_json(
        &hub.app,
        "POST",
        "/api/auth/login",
        "",
        Some(&json!({"benutzername": stellvertreter, "passwort": "spontanpw1"})),
    )
    .await;
    assert_eq!(
        s,
        StatusCode::UNAUTHORIZED,
        "Stellvertreter meldet sich nie an"
    );
    let mitglieder: Vec<(i64, String)> = sqlx::query_as(
        "SELECT benutzer_id, einsatz_rolle FROM einsatz_mitgliedschaft WHERE einsatz_id = ? \
         ORDER BY benutzer_id",
    )
    .bind(sp)
    .fetch_all(&hub.pool)
    .await
    .unwrap();
    assert!(
        mitglieder.contains(&(erika_hub, "beobachter".to_string())),
        "gemeinsames Konto hat dieselbe Rolle: {mitglieder:?}"
    );
    let stellvertreter_mitglied: i64 = eine(
        &hub.pool,
        &format!(
            "SELECT COUNT(*) FROM einsatz_mitgliedschaft m JOIN spiegel_konto k \
             ON k.benutzer_id = m.benutzer_id WHERE m.einsatz_id = {sp}"
        ),
    )
    .await;
    assert_eq!(stellvertreter_mitglied, 0, "Stellvertreter nie Mitglied");
    // Stellvertreter werden nie als Stammdaten verteilt.
    melden(&elw).await;
    let am_elw: i64 = eine(
        &elw.pool,
        "SELECT COUNT(*) FROM benutzer WHERE benutzername LIKE 'spiegel:%'",
    )
    .await;
    assert_eq!(am_elw, 0);
}
