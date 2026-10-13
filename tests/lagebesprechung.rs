//! Integrationstests der Lagebesprechung (LLH-1111): Stand, Verlauf, Abschluss und Termin,
//! eigenes Modul mit eigener Freigabe (Spec `lagebesprechung`). Der Abschluss-Teil kam aus
//! `tests/stab.rs` (LFH-46).

use axum::http::StatusCode;

mod common;
use common::*;

fn stand_pfad(einsatz: i64) -> String {
    format!("/api/einsaetze/{einsatz}/lagebesprechung")
}

fn termin_pfad(einsatz: i64) -> String {
    format!("/api/einsaetze/{einsatz}/lagebesprechung/termin")
}

fn besprechungen_pfad(einsatz: i64) -> String {
    format!("/api/einsaetze/{einsatz}/lagebesprechungen")
}

/// Zählt ETB-Einträge, deren Inhalt `nadel` enthält.
async fn etb_treffer(app: &axum::Router, cookie: &str, einsatz: i64, nadel: &str) -> usize {
    let (_, json) = anfrage(
        app,
        "GET",
        &format!("/api/einsaetze/{einsatz}/etb"),
        cookie,
        None,
    )
    .await;
    json.as_array()
        .map(|a| {
            a.iter()
                .filter(|e| e["inhalt"].as_str().is_some_and(|i| i.contains(nadel)))
                .count()
        })
        .unwrap_or(0)
}

/// Blendet ein Modul im Einsatz aus (Override `sichtbar=false`).
async fn ausblenden(app: &axum::Router, admin: &str, einsatz: i64, modul: &str) {
    let (status, json) = anfrage(
        app,
        "PUT",
        &format!("/api/einsaetze/{einsatz}/modul-overrides/{modul}"),
        admin,
        Some(r#"{"sichtbar":false,"benoetigte_rolle":null}"#),
    )
    .await;
    assert!(status.is_success(), "Override {modul}: {status} {json:?}");
}

/// Führungskraft mit Einsatzrolle Führungspersonal; liefert ihren Cookie.
async fn fuehrungskraft(app: &axum::Router, admin: &str, einsatz: i64) -> String {
    let kraft = benutzer_anlegen(app, admin, "kraft", "fuehrungskraft").await;
    rolle_setzen(app, admin, einsatz, kraft, "fuehrungspersonal").await;
    login_cookie(app, "kraft", "kraftpw1").await
}

// ---------- Freigabe und Rechte ----------

/// Spec `lagebesprechung`, „Eigenes Modul mit eigener Freigabe“: Stab aus, Lagebesprechung an.
#[tokio::test]
async fn ohne_stab_bleibt_die_lagebesprechung_voll_nutzbar() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let kraft = fuehrungskraft(&app, &admin, einsatz).await;
    ausblenden(&app, &admin, einsatz, "stab").await;

    let (status, _) = anfrage(
        &app,
        "GET",
        &format!("/api/einsaetze/{einsatz}/stab"),
        &kraft,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN, "Stab ist zu");

    let (status, _) = anfrage(&app, "GET", &stand_pfad(einsatz), &kraft, None).await;
    assert_eq!(status, StatusCode::OK, "Stand lesbar ohne Stab");
    let (status, _) = anfrage(&app, "GET", &besprechungen_pfad(einsatz), &kraft, None).await;
    assert_eq!(status, StatusCode::OK, "Verlauf lesbar ohne Stab");
    let (status, json) = anfrage(
        &app,
        "PUT",
        &termin_pfad(einsatz),
        &kraft,
        Some(r#"{"naechste_at":"2099-01-01 10:00:00"}"#),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "Termin ohne Stab: {json:?}");
    let (status, json) = anfrage(
        &app,
        "POST",
        &besprechungen_pfad(einsatz),
        &kraft,
        Some(r#"{"entschluss":"Ohne Stab beschlossen"}"#),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "Abschluss ohne Stab: {json:?}");
}

#[tokio::test]
async fn ausgeblendete_lagebesprechung_sperrt_lesen_und_schreiben() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let kraft = fuehrungskraft(&app, &admin, einsatz).await;
    ausblenden(&app, &admin, einsatz, "lagebesprechung").await;

    for (methode, pfad, body) in [
        ("GET", stand_pfad(einsatz), None),
        ("GET", besprechungen_pfad(einsatz), None),
        ("PUT", termin_pfad(einsatz), Some(r#"{"naechste_at":null}"#)),
        (
            "POST",
            besprechungen_pfad(einsatz),
            Some(r#"{"entschluss":"A"}"#),
        ),
    ] {
        let (status, _) = anfrage(&app, methode, &pfad, &kraft, body).await;
        assert_eq!(status, StatusCode::FORBIDDEN, "{methode} {pfad}");
    }

    // Stab bleibt davon unberührt.
    let (status, _) = anfrage(
        &app,
        "GET",
        &format!("/api/einsaetze/{einsatz}/stab"),
        &kraft,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "Stab offen");
}

/// Fremde Organisation: 403 oder 404 auf jeder Route (wie `tests/cross_org.rs`); ein Einsatz,
/// den es nicht gibt, ist 404.
#[tokio::test]
async fn fremde_org_wird_auf_allen_routen_abgewiesen() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    fremde_org_anlegen(&pool, "Fremd-Orga", "fremd", "fremdpw1", "fuehrungskraft").await;
    let fremd = login_cookie(&app, "fremd", "fremdpw1").await;

    for (methode, pfad, body) in [
        ("GET", stand_pfad(einsatz), None),
        ("GET", besprechungen_pfad(einsatz), None),
        ("PUT", termin_pfad(einsatz), Some(r#"{"naechste_at":null}"#)),
        (
            "POST",
            besprechungen_pfad(einsatz),
            Some(r#"{"entschluss":"A"}"#),
        ),
    ] {
        let (status, _) = anfrage(&app, methode, &pfad, &fremd, body).await;
        assert!(
            status == StatusCode::FORBIDDEN || status == StatusCode::NOT_FOUND,
            "{methode} {pfad}: erwartet 403/404, war {status}"
        );
    }
    let (status, _) = anfrage(&app, "GET", &stand_pfad(999_999), &admin, None).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
}

/// LFH-1118: Modulrouten schreiben nur mit Einsatzrolle; die System-Rolle allein genügt nicht.
#[tokio::test]
async fn system_admin_ohne_einsatzrolle_schreibt_nicht() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    // Eine Führungskraft legt den Einsatz an; der System-Admin ist dort kein Mitglied.
    benutzer_anlegen(&app, &admin, "frieda", "fuehrungskraft").await;
    let frieda = login_cookie(&app, "frieda", "friedapw1").await;
    let einsatz = einsatz_anlegen(&app, &frieda).await;

    let (status, _) = anfrage(
        &app,
        "PUT",
        &termin_pfad(einsatz),
        &admin,
        Some(r#"{"naechste_at":"2099-01-01 10:00:00"}"#),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN, "Termin");
    let (status, _) = anfrage(
        &app,
        "POST",
        &besprechungen_pfad(einsatz),
        &admin,
        Some(r#"{"entschluss":"A"}"#),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN, "Abschluss");
}

// ---------- Abschluss ----------

/// Zählt ETB-Einträge vom Typ `entscheidung`.
async fn entscheidungen(app: &axum::Router, cookie: &str, einsatz: i64) -> usize {
    let (_, json) = anfrage(
        app,
        "GET",
        &format!("/api/einsaetze/{einsatz}/etb"),
        cookie,
        None,
    )
    .await;
    json.as_array()
        .map(|a| a.iter().filter(|e| e["typ"] == "entscheidung").count())
        .unwrap_or(0)
}

#[tokio::test]
async fn abschluss_schreibt_etb_entscheidung_zeile_und_termin() {
    let (app, _pool, live) = setup_mit_pool_und_live().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let mut rx = live.abonniere(einsatz);

    let (status, json) = anfrage(
        &app,
        "POST",
        &besprechungen_pfad(einsatz),
        &admin,
        Some(
            r#"{"entschluss":"Abschnitte bilden, Riegelstellung halten",
                "abgehalten_at":"2026-09-12 14:30:00",
                "naechste_at":"2026-09-12 16:30:00"}"#,
        ),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{json:?}");

    // Die Quittung ist der FRISCH geladene Stand — nicht ein Zustand, den es nie gab.
    assert_eq!(json["anzahl_lagebesprechungen"], 1);
    assert_eq!(json["letzte_lagebesprechung"]["lfd_nr"], 1);
    assert_eq!(
        json["letzte_lagebesprechung"]["entschluss"],
        "Abschnitte bilden, Riegelstellung halten"
    );
    assert_eq!(
        json["naechste_lagebesprechung_at"], "2026-09-12 16:30:00",
        "der Termin kommt aus `einsatz` und wird mitgeliefert"
    );

    // Der Beleg: genau EIN ETB-Eintrag vom Typ `entscheidung`, mit dem Snapshot-Text.
    assert_eq!(entscheidungen(&app, &admin, einsatz).await, 1);
    assert_eq!(
        etb_treffer(
            &app,
            &admin,
            einsatz,
            "Lagebesprechung Nr. 1 (2026-09-12 14:30:00)"
        )
        .await,
        1
    );
    assert_eq!(
        etb_treffer(
            &app,
            &admin,
            einsatz,
            "Nächste Lagebesprechung: 2026-09-12 16:30:00"
        )
        .await,
        1
    );

    // Und der Termin steht auch am Einsatzkopf (EINE Wahrheit).
    let (_, kopf) = anfrage(
        &app,
        "GET",
        &format!("/api/einsaetze/{einsatz}"),
        &admin,
        None,
    )
    .await;
    assert_eq!(kopf["naechste_lagebesprechung_at"], "2026-09-12 16:30:00");

    // Beide Live-Ereignisse: `lagebesprechung` und der ETB-Kurzruf — und NICHT `stab`
    // (design.md D6: Stab-Leser ohne dieses Recht erführen sonst von jeder Besprechung).
    let (mut sah_lb, mut sah_etb, mut sah_stab) = (false, false, false);
    while let Ok(n) = rx.try_recv() {
        match n.event.as_str() {
            "lagebesprechung" => sah_lb = true,
            "etb" => sah_etb = true,
            "stab" => sah_stab = true,
            _ => {}
        }
    }
    assert!(sah_lb, "`lagebesprechung`-Ereignis fehlt");
    assert!(!sah_stab, "kein `stab`-Ereignis mehr");
    assert!(
        sah_etb,
        "ETB-Kurzruf fehlt — der Eintrag entstand im selben Commit"
    );
}

/// Der Termin ist **Tri-State**: Feld fehlt = unverändert, `null` = löschen, Wert = setzen.
#[tokio::test]
async fn termin_ist_tri_state() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;

    // Wert setzen.
    anfrage(
        &app,
        "POST",
        &besprechungen_pfad(einsatz),
        &admin,
        Some(r#"{"entschluss":"A","abgehalten_at":"2026-09-12 10:00:00","naechste_at":"2026-09-12 12:00:00"}"#),
    )
    .await;

    // Feld FEHLT → Termin unverändert, und der Snapshot trägt den geltenden Termin.
    let (_, json) = anfrage(
        &app,
        "POST",
        &besprechungen_pfad(einsatz),
        &admin,
        Some(r#"{"entschluss":"B","abgehalten_at":"2026-09-12 11:00:00"}"#),
    )
    .await;
    assert_eq!(
        json["naechste_lagebesprechung_at"], "2026-09-12 12:00:00",
        "ohne Schlüssel bleibt der Termin stehen"
    );
    assert_eq!(
        json["letzte_lagebesprechung"]["naechste_at"], "2026-09-12 12:00:00",
        "der Snapshot trägt den GELTENDEN Termin, nicht „nichts\""
    );

    // `null` → Termin löschen.
    let (_, json) = anfrage(
        &app,
        "POST",
        &besprechungen_pfad(einsatz),
        &admin,
        Some(r#"{"entschluss":"C","abgehalten_at":"2026-09-12 12:30:00","naechste_at":null}"#),
    )
    .await;
    assert!(
        json.get("naechste_lagebesprechung_at").is_none(),
        "null löscht den Termin: {json}"
    );
    assert_eq!(
        etb_treffer(
            &app,
            &admin,
            einsatz,
            "Nächste Lagebesprechung: kein Termin"
        )
        .await,
        1,
        "„kein Termin\" ist eine Aussage und gehört in den Beleg"
    );
}

#[tokio::test]
async fn lfd_nr_ist_luckenlos_und_historie_absteigend() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    for i in 0..3 {
        let (status, _) = anfrage(
            &app,
            "POST",
            &besprechungen_pfad(einsatz),
            &admin,
            Some(&format!(
                r#"{{"entschluss":"Entschluss {i}","abgehalten_at":"2026-09-12 1{i}:00:00"}}"#
            )),
        )
        .await;
        assert_eq!(status, StatusCode::CREATED);
    }

    let (status, json) = anfrage(&app, "GET", &besprechungen_pfad(einsatz), &admin, None).await;
    assert_eq!(status, StatusCode::OK);
    let liste = json.as_array().unwrap();
    assert_eq!(liste.len(), 3);
    let nummern: Vec<i64> = liste
        .iter()
        .map(|e| e["lfd_nr"].as_i64().unwrap())
        .collect();
    assert_eq!(nummern, vec![3, 2, 1], "absteigend, lückenlos");
    // Jede Zeile trägt ihren eigenen Beleg.
    assert_eq!(entscheidungen(&app, &admin, einsatz).await, 3);
}

#[tokio::test]
async fn leerer_entschluss_ist_400_und_termin_vor_besprechung_ist_422() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;

    for body in [
        r#"{"entschluss":""}"#,
        r#"{"entschluss":"   "}"#,
        r#"{"entschluss":"A","abgehalten_at":"kein Datum"}"#,
        r#"{"entschluss":"A","naechste_at":"kein Datum"}"#,
    ] {
        let (status, _) = anfrage(
            &app,
            "POST",
            &besprechungen_pfad(einsatz),
            &admin,
            Some(body),
        )
        .await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "erwartet 400 für {body}");
    }

    // Zusammenhang zweier Felder → 422.
    let (status, _) = anfrage(
        &app,
        "POST",
        &besprechungen_pfad(einsatz),
        &admin,
        Some(r#"{"entschluss":"A","abgehalten_at":"2026-09-12 14:00:00","naechste_at":"2026-09-12 13:00:00"}"#),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);

    // Keiner der Fehlversuche hat einen Beleg hinterlassen.
    assert_eq!(entscheidungen(&app, &admin, einsatz).await, 0);
}

#[tokio::test]
async fn beobachter_darf_historie_lesen_aber_nicht_abschliessen() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let beob = benutzer_anlegen(&app, &admin, "zuschauer", "keine").await;
    rolle_setzen(&app, &admin, einsatz, beob, "beobachter").await;
    let beob_cookie = login_cookie(&app, "zuschauer", "zuschauerpw1").await;

    let (status, _) = anfrage(
        &app,
        "GET",
        &besprechungen_pfad(einsatz),
        &beob_cookie,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let (status, _) = anfrage(
        &app,
        "POST",
        &besprechungen_pfad(einsatz),
        &beob_cookie,
        Some(r#"{"entschluss":"A"}"#),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
}

/// **Die Atomaritäts-Probe.** Sie hängt ausdrücklich NICHT an einem ungültigen
/// `naechste_at`: die Route lehnt den Wert vorher ab (400/422), der Request erreicht die
/// Transaktion also nie — ein solcher Test bliebe auch dann grün, wenn ETB-Eintrag, Zeile
/// und Termin-Update drei getrennte Aufrufe wären.
///
/// Sie hängt stattdessen am Fehler **nach** dem ETB-Insert: der Termin-Schritt läuft als
/// `UPDATE … WHERE id = ? AND status = 'aktiv'` und rollt bei `rows_affected == 0` zurück.
/// Gerufen wird die Repo-Funktion **direkt**, weil `fordere_aktiv` den Zweig auf der Route
/// verdeckt.
#[tokio::test]
async fn abschluss_rollt_bei_inaktivem_einsatz_vollstaendig_zurueck() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;

    // Einen Termin vorbelegen, damit „unverändert" beweisbar ist.
    sqlx::query(
        "UPDATE einsatz SET naechste_lagebesprechung_at = '2026-09-12 20:00:00' WHERE id = ?",
    )
    .bind(einsatz)
    .execute(&pool)
    .await
    .unwrap();
    // Einsatz abschliessen — damit trifft das `status = 'aktiv'`-Prädikat keine Zeile.
    anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/abschliessen"),
        &admin,
        None,
    )
    .await;

    let fehler = lifeline_hub::lagebesprechung::repo::abschliessen(
        &pool,
        einsatz,
        1,
        &lifeline_hub::lagebesprechung::repo::AbschlussEingabe {
            entschluss: "Darf nicht bestehen bleiben".into(),
            abgehalten_at: "2026-09-12 18:00:00".into(),
            naechste_at: Some(Some("2026-09-12 19:00:00".into())),
        },
    )
    .await;
    let fehler = fehler.expect_err("inaktiver Einsatz muss scheitern");
    assert_eq!(
        fehler.status(),
        StatusCode::CONFLICT,
        "Lebenszyklus des Einsatzes → 409, dieselbe Antwort wie `fordere_aktiv` am Route-Gate"
    );

    // (1) Kein ETB-Eintrag vom Typ `entscheidung`.
    let etb: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM etb_eintrag WHERE einsatz_id = ? AND typ = 'entscheidung'",
    )
    .bind(einsatz)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(etb, 0, "der ETB-Eintrag muss mit zurückgerollt sein");

    // (2) Keine Lagebesprechungs-Zeile.
    let zeilen: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM einsatz_lagebesprechung WHERE einsatz_id = ?")
            .bind(einsatz)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(zeilen, 0);

    // (3) Der Termin ist unverändert.
    let termin: Option<String> =
        sqlx::query_scalar("SELECT naechste_lagebesprechung_at FROM einsatz WHERE id = ?")
            .bind(einsatz)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(termin.as_deref(), Some("2026-09-12 20:00:00"));
}

/// Der Normalfall über die Route: `fordere_aktiv` im Extractor greift, bevor die Transaktion
/// beginnt → 409. Das ist die Ergänzung zu den Rollback-Proben oben, nicht ihr Ersatz.
///
/// **Nicht** zu verwechseln mit „der Riegel in der Transaktion ist unerreichbar": er ist es
/// nicht (siehe `lagebesprechung::repo::abschliessen`). Beide Wege antworten deshalb
/// mit demselben Code — 409 —, sonst hinge die Antwort am Timing.
#[tokio::test]
async fn abschluss_auf_abgeschlossenem_einsatz_ist_409() {
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
    let (status, _) = anfrage(
        &app,
        "POST",
        &besprechungen_pfad(einsatz),
        &admin,
        Some(r#"{"entschluss":"A"}"#),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT);
}

/// Die Schwärzung ersetzt `entschluss` durch den Platzhalter (LFH-701, Linie A) — wie
/// `lagebericht.abschnitte` und `befehl`, deren Inhalt derselbe Entschluss ist. Der Wortlaut
/// bleibt im ETB-Eintrag der Lagebesprechung, der Führungsdokumentation.
#[tokio::test]
async fn schwaerzung_ersetzt_den_entschluss_und_haelt_den_etb_wortlaut() {
    let (app, pool) = setup_mit_pool().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    anfrage(
        &app,
        "POST",
        &besprechungen_pfad(einsatz),
        &admin,
        Some(r#"{"entschluss":"Riegelstellung Nordufer halten"}"#),
    )
    .await;

    let mut tx = pool.begin().await.unwrap();
    lifeline_hub::einsatz::schwaerzung_registry::scrubbe_aus_registry(
        &mut tx,
        einsatz,
        lifeline_hub::einsatz::schwaerzung_registry::Umfang::Alles,
    )
    .await
    .unwrap();
    tx.commit().await.unwrap();

    let (entschluss, etb_inhalt): (String, String) = sqlx::query_as(
        "SELECT b.entschluss, e.inhalt FROM einsatz_lagebesprechung b \
         JOIN etb_eintrag e ON e.id = b.etb_eintrag_id WHERE b.einsatz_id = ?",
    )
    .bind(einsatz)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(
        entschluss,
        lifeline_hub::einsatz::repo::SCHWAERZUNG_PLATZHALTER,
        "Modul-Freitext geschwärzt, gemeinsam mit Lagebericht und Befehl"
    );
    assert!(
        etb_inhalt.contains("Riegelstellung Nordufer halten"),
        "ETB behält den Entschluss im Wortlaut: {etb_inhalt}"
    );
}

/// Abschluss OHNE Termin auf einem inaktiven Einsatz: `fordere_aktiv` im Extractor liest einen
/// Stand von VOR der Transaktion, der Riegel in der Transaktion muss also auch ohne
/// Termin-Update greifen. Ein ETB-Eintrag vom Typ `entscheidung` ist append-only und gehört
/// nicht in einen abgeschlossenen Einsatz.
///
/// Das **Paar** zu `abschluss_rollt_bei_inaktivem_einsatz_vollstaendig_zurueck`: dort MIT
/// Termin, hier OHNE. Nur zusammen belegen sie, dass der Riegel unbedingt greift und nicht
/// bloss als Nebenwirkung des Termin-Updates.
#[tokio::test]
async fn abschluss_ohne_termin_rollt_bei_inaktivem_einsatz_ebenfalls_zurueck() {
    let (app, pool) = setup_mit_pool().await;
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

    let fehler = lifeline_hub::lagebesprechung::repo::abschliessen(
        &pool,
        einsatz,
        1,
        &lifeline_hub::lagebesprechung::repo::AbschlussEingabe {
            entschluss: "Darf nicht bestehen bleiben".into(),
            abgehalten_at: "2026-09-12 18:00:00".into(),
            // KEIN Termin — der Pfad, der ohne eigenen Riegel ungeprüft durchliefe.
            naechste_at: None,
        },
    )
    .await;
    assert!(
        fehler.is_err(),
        "inaktiver Einsatz muss auch ohne Termin scheitern"
    );

    let etb: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM etb_eintrag WHERE einsatz_id = ? AND typ = 'entscheidung'",
    )
    .bind(einsatz)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(
        etb, 0,
        "kein append-only Beleg in einem abgeschlossenen Einsatz"
    );

    let zeilen: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM einsatz_lagebesprechung WHERE einsatz_id = ?")
            .bind(einsatz)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(zeilen, 0);
}

/// Spec `lagebesprechung`, „Entschluss mit Pflicht und Längengrenze“ (design.md D10).
#[tokio::test]
async fn zu_langer_entschluss_ist_400() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let max = lifeline_hub::lagebesprechung::ENTSCHLUSS_MAX;

    let zu_lang = serde_json::json!({ "entschluss": "x".repeat(max + 1) }).to_string();
    let (status, json) = anfrage(
        &app,
        "POST",
        &besprechungen_pfad(einsatz),
        &admin,
        Some(&zu_lang),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "{json:?}");
    assert_eq!(
        entscheidungen(&app, &admin, einsatz).await,
        0,
        "nichts gespeichert"
    );

    // Die Grenze selbst geht durch, und der Snapshot passt in die ETB-Grenze.
    let genau =
        serde_json::json!({ "entschluss": "x".repeat(max), "naechste_at": "2099-12-31 23:59:59" })
            .to_string();
    let (status, json) = anfrage(
        &app,
        "POST",
        &besprechungen_pfad(einsatz),
        &admin,
        Some(&genau),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{json:?}");
}

// ---------- Termin ohne Abschluss ----------

/// Spec `lagebesprechung`, „Termin ohne Abschluss setzen“: setzen, leeren, kein ETB-Eintrag;
/// der Einsatzkopf trägt denselben Wert.
#[tokio::test]
async fn termin_setzen_und_leeren_ohne_etb_eintrag() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let etb_vorher = system_etb_anzahl(&app, &admin, einsatz).await;

    let (status, json) = anfrage(
        &app,
        "PUT",
        &termin_pfad(einsatz),
        &admin,
        Some(r#"{"naechste_at":"2099-01-01T15:05:00Z"}"#),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{json:?}");
    assert_eq!(json["naechste_lagebesprechung_at"], "2099-01-01 15:05:00");
    assert_eq!(json["anzahl_lagebesprechungen"], 0);

    let (_, kopf) = anfrage(
        &app,
        "GET",
        &format!("/api/einsaetze/{einsatz}"),
        &admin,
        None,
    )
    .await;
    assert_eq!(kopf["naechste_lagebesprechung_at"], "2099-01-01 15:05:00");

    let (status, json) = anfrage(
        &app,
        "PUT",
        &termin_pfad(einsatz),
        &admin,
        Some(r#"{"naechste_at":null}"#),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert!(json.get("naechste_lagebesprechung_at").is_none(), "{json}");

    let (_, etb) = anfrage(
        &app,
        "GET",
        &format!("/api/einsaetze/{einsatz}/etb"),
        &admin,
        None,
    )
    .await;
    assert_eq!(entscheidungen(&app, &admin, einsatz).await, 0);
    assert_eq!(
        system_etb_anzahl(&app, &admin, einsatz).await,
        etb_vorher,
        "kein ETB-Eintrag: {etb}"
    );
}

#[tokio::test]
async fn termin_ohne_schluessel_oder_unlesbar_ist_400() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    for body in [r#"{}"#, r#"{"naechste_at":"kein Datum"}"#] {
        let (status, _) = anfrage(&app, "PUT", &termin_pfad(einsatz), &admin, Some(body)).await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{body}");
    }
}

#[tokio::test]
async fn termin_beobachter_403_und_abgeschlossener_einsatz_409() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;
    let beob = benutzer_anlegen(&app, &admin, "zuschauer", "keine").await;
    rolle_setzen(&app, &admin, einsatz, beob, "beobachter").await;
    let beob_cookie = login_cookie(&app, "zuschauer", "zuschauerpw1").await;

    let (status, _) = anfrage(&app, "GET", &stand_pfad(einsatz), &beob_cookie, None).await;
    assert_eq!(status, StatusCode::OK, "Beobachter liest den Stand");
    let (status, _) = anfrage(
        &app,
        "PUT",
        &termin_pfad(einsatz),
        &beob_cookie,
        Some(r#"{"naechste_at":null}"#),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);

    anfrage(
        &app,
        "POST",
        &format!("/api/einsaetze/{einsatz}/abschliessen"),
        &admin,
        None,
    )
    .await;
    let (status, _) = anfrage(
        &app,
        "PUT",
        &termin_pfad(einsatz),
        &admin,
        Some(r#"{"naechste_at":"2099-01-01 10:00:00"}"#),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT);
}

/// Der Riegel in der Transaktion greift auch beim Termin: `fordere_aktiv` im Extractor liest
/// einen Stand von VOR der Transaktion (wie beim Abschluss).
#[tokio::test]
async fn termin_rollt_bei_inaktivem_einsatz_zurueck() {
    let (app, pool) = setup_mit_pool().await;
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

    let fehler = lifeline_hub::lagebesprechung::repo::set_termin(
        &pool,
        einsatz,
        Some("2099-01-01 10:00:00"),
    )
    .await
    .expect_err("inaktiver Einsatz muss scheitern");
    assert_eq!(fehler.status(), StatusCode::CONFLICT);
    let termin: Option<String> =
        sqlx::query_scalar("SELECT naechste_lagebesprechung_at FROM einsatz WHERE id = ?")
            .bind(einsatz)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(termin, None);
}

/// Spec `lagebesprechung`, „Termin ohne Abschluss setzen“: der alte Weg über die Kopfdaten ist
/// zu, laut statt still (design.md D3) — und er ändert auch die übrigen Felder nicht.
#[tokio::test]
async fn kopf_patch_mit_termin_ist_400_und_aendert_nichts() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let einsatz = einsatz_anlegen(&app, &admin).await;

    for body in [
        r#"{"bezeichnung":"Neu","naechste_lagebesprechung_at":"2099-01-01 10:00:00"}"#,
        r#"{"bezeichnung":"Neu","naechste_lagebesprechung_at":null}"#,
    ] {
        let (status, json) = anfrage(
            &app,
            "PATCH",
            &format!("/api/einsaetze/{einsatz}"),
            &admin,
            Some(body),
        )
        .await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{body}: {json:?}");
    }
    let (_, kopf) = anfrage(
        &app,
        "GET",
        &format!("/api/einsaetze/{einsatz}"),
        &admin,
        None,
    )
    .await;
    assert_ne!(kopf["bezeichnung"], "Neu", "nichts geschrieben");
    assert!(kopf
        .get("naechste_lagebesprechung_at")
        .is_none_or(|v| v.is_null()));
}
