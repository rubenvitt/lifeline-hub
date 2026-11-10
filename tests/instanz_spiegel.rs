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
    // Jede Zeile des Führers hat ihr Gegenstück im Spiegel; Mitgliedschaften nur gemeinsamer
    // Konten (der Admin des ELW gibt es am Hub nicht).
    let fuehrer: i64 = eine(
        &elw.pool,
        &format!(
            "SELECT COUNT(*) FROM einsatz_aenderung WHERE einsatz_id = {e} \
             AND art <> 'einsatz_mitgliedschaft'"
        ),
    )
    .await;
    let gespiegelt: i64 = eine(
        &hub.pool,
        &format!(
            "SELECT COUNT(*) FROM spiegel_herkunft WHERE einsatz_id = {s} \
             AND art <> 'einsatz_mitgliedschaft'"
        ),
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

// ── Anhänge auf Abruf (D8) ───────────────────────────────────────────────────────────────────

/// Legt am ELW einen Anhang mit `n` Bytes an; liefert `(id, bytes)`.
async fn anhang_am_elw(elw: &Instanz, einsatz: i64, n: usize) -> (i64, Vec<u8>) {
    let bytes: Vec<u8> = (0..n).map(|i| (i * 7 % 251) as u8).collect();
    let id: i64 = sqlx::query_scalar(
        "INSERT INTO anhang (einsatz_id, dateiname, mime, groesse, sha256, daten, hochgeladen_von) \
         VALUES (?, 'foto.bin', 'application/octet-stream', ?, 'x', ?, 1) RETURNING id",
    )
    .bind(einsatz)
    .bind(n as i64)
    .bind(&bytes)
    .fetch_one(&elw.pool)
    .await
    .unwrap();
    (id, bytes)
}

#[tokio::test]
async fn ein_anhang_kommt_erst_als_metadaten_und_auf_abruf_in_stuecken() {
    let (hub, elw) = gekoppelt_gemeldet().await;
    let e = common::einsatz_anlegen(&elw.app, &elw.admin).await;
    // Drei Stücke à 256 KiB und ein Rest.
    let (_, bytes) = anhang_am_elw(&elw, e, 3 * 256 * 1024 + 1000).await;
    etb_eintrag(&elw, e, "Foto vom Deich").await;
    abgleichen(&elw).await;
    let s = spiegel_von(&hub).await;
    assert!(
        etb_inhalte(&hub, s)
            .await
            .contains(&"Foto vom Deich".to_string()),
        "ETB wartet nicht auf das Foto"
    );
    let (hub_id, laenge): (i64, i64) =
        sqlx::query_as("SELECT id, length(daten) FROM anhang WHERE einsatz_id = ?")
            .bind(s)
            .fetch_one(&hub.pool)
            .await
            .unwrap();
    assert_eq!(laenge, 0, "zuerst nur Metadaten");
    let groesse: i64 = eine(&hub.pool, "SELECT groesse FROM spiegel_anhang").await;
    assert_eq!(groesse as usize, bytes.len());

    // Öffnen am Hub: 409 „wird geholt“, die Anforderung steht.
    let f = lifeline_hub::instanz::spiegel::anhang::pruefe_vorhanden(
        &hub.pool,
        "anhang",
        &hub_id.to_string(),
    )
    .await;
    assert!(
        matches!(f, Err(lifeline_hub::error::AppError::Conflict(ref t)) if t == lifeline_hub::instanz::spiegel::anhang::WIRD_GEHOLT)
    );
    let angefordert: Option<String> =
        eine(&hub.pool, "SELECT angefordert_at FROM spiegel_anhang").await;
    assert!(angefordert.is_some());

    for _ in 0..4 {
        abgleichen(&elw).await;
    }
    let am_hub: Vec<u8> = eine(
        &hub.pool,
        &format!("SELECT daten FROM anhang WHERE id = {hub_id}"),
    )
    .await;
    assert_eq!(am_hub, bytes, "vollständig und gleich");
    lifeline_hub::instanz::spiegel::anhang::pruefe_vorhanden(
        &hub.pool,
        "anhang",
        &hub_id.to_string(),
    )
    .await
    .expect("jetzt da");
    let teile: i64 = eine(&hub.pool, "SELECT COUNT(*) FROM spiegel_anhang_teil").await;
    assert_eq!(teile, 0, "Stücke aufgeräumt");
}

#[tokio::test]
async fn ein_verfaelschtes_stueck_beginnt_neu_und_ein_geaenderter_anhang_auch() {
    let (hub, elw) = gekoppelt_gemeldet().await;
    let e = common::einsatz_anlegen(&elw.app, &elw.admin).await;
    let (elw_id, _) = anhang_am_elw(&elw, e, 1000).await;
    abgleichen(&elw).await;
    let kennung: String = eine(&hub.pool, "SELECT fremde_kennung FROM einsatz_spiegel").await;
    let sha: String = eine(&hub.pool, "SELECT sha256 FROM spiegel_anhang").await;
    // Das Vorabladen hat den Inhalt schon geholt; für den Fall setzen wir ihn zurück.
    exec(
        &hub.pool,
        "UPDATE spiegel_anhang SET empfangen = 0, fertig_at = NULL",
    )
    .await;
    // Ein Stück mit falschem Inhalt, aber richtiger Länge.
    let mut conn = hub.pool.acquire().await.unwrap();
    use base64::Engine;
    let falsch = lifeline_hub::instanz::spiegel::paket::AnhangTeil {
        kennung: kennung.clone(),
        art: "anhang".into(),
        schluessel: elw_id.to_string(),
        sha256: sha.clone(),
        ab: 0,
        daten: base64::engine::general_purpose::STANDARD.encode(vec![0u8; 1000]),
    };
    lifeline_hub::instanz::spiegel::anhang::uebernehme_teile(&mut conn, &[falsch])
        .await
        .unwrap();
    drop(conn);
    let (empfangen, fertig): (i64, Option<String>) =
        sqlx::query_as("SELECT empfangen, fertig_at FROM spiegel_anhang")
            .fetch_one(&hub.pool)
            .await
            .unwrap();
    assert_eq!(
        (empfangen, fertig),
        (0, None),
        "falsche Prüfsumme beginnt neu"
    );
    // Der Führer ändert den Inhalt: neue Prüfsumme, neuer Abruf.
    let neu: Vec<u8> = vec![9u8; 500];
    sqlx::query("UPDATE anhang SET daten = ?, groesse = 500 WHERE id = ?")
        .bind(&neu)
        .bind(elw_id)
        .execute(&elw.pool)
        .await
        .unwrap();
    abgleichen(&elw).await;
    let neue_sha: String = eine(&hub.pool, "SELECT sha256 FROM spiegel_anhang").await;
    assert_ne!(neue_sha, sha);
    exec(
        &hub.pool,
        "UPDATE spiegel_anhang SET angefordert_at = '2026-11-10 00:00:00'",
    )
    .await;
    for _ in 0..3 {
        abgleichen(&elw).await;
    }
    let am_hub: Vec<u8> = eine(&hub.pool, "SELECT daten FROM anhang").await;
    assert_eq!(am_hub, neu);
}

#[tokio::test]
async fn der_uhs_plan_kommt_ebenso_auf_abruf() {
    let (hub, elw) = gekoppelt_gemeldet().await;
    let e = common::einsatz_anlegen(&elw.app, &elw.admin).await;
    let uhs: i64 = eine(
        &elw.pool,
        &format!(
            "INSERT INTO uhs (einsatz_id, typ, bezeichnung, erfasst_von, geaendert_von) \
             VALUES ({e}, 'sonstige', 'UHS 1', 1, 1) RETURNING id"
        ),
    )
    .await;
    let bild: Vec<u8> = (0..300_000u32).map(|i| (i % 256) as u8).collect();
    sqlx::query(
        "INSERT INTO uhs_plan (uhs_id, einsatz_id, daten, mime, groesse, sha256, bild_breite, \
         bild_hoehe, breite, hinterlegt_von) VALUES (?, ?, ?, 'image/png', ?, 'x', 10, 10, 100, 1)",
    )
    .bind(uhs)
    .bind(e)
    .bind(&bild)
    .bind(bild.len() as i64)
    .execute(&elw.pool)
    .await
    .unwrap();
    abgleichen(&elw).await;
    exec(
        &hub.pool,
        "UPDATE spiegel_anhang SET angefordert_at = '2026-11-10 00:00:00'",
    )
    .await;
    for _ in 0..3 {
        abgleichen(&elw).await;
    }
    let am_hub: Vec<u8> = eine(&hub.pool, "SELECT daten FROM uhs_plan").await;
    assert_eq!(am_hub, bild);
}
