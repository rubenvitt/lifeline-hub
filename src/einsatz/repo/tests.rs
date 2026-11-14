//! Tests des Einsatz-Repos.

use super::*;

/// Kurzform für die Testfälle dieser Datei: legt einen Einsatz mit den beiden
/// Pflichtangaben an. Einsatzart und Alarmzeit spielen hier nirgends eine Rolle —
/// die deckt `tests/einsatz.rs` über die Route ab, wo sie auch validiert werden.
async fn test_anlegen(
    pool: &SqlitePool,
    bezeichnung: &str,
    stichwort: Option<&str>,
    ersteller_id: i64,
) -> Result<Einsatz, AppError> {
    anlegen(
        pool,
        NeuerEinsatzDaten {
            bezeichnung,
            stichwort,
            einsatzart: None,
            begonnen_at: None,
            ort: Default::default(),
            vorlage_id: None,
        },
        ersteller_id,
    )
    .await
}

/// Legt Org (id=1) + einen Benutzer an und liefert dessen id.
async fn benutzer_anlegen(pool: &SqlitePool, name: &str) -> i64 {
    sqlx::query("INSERT OR IGNORE INTO organisation (id, name) VALUES (1, 'Orga')")
        .execute(pool)
        .await
        .unwrap();
    sqlx::query(
        "INSERT INTO benutzer (org_id, anzeigename, benutzername, passwort_hash) \
             VALUES (1, ?, ?, 'h')",
    )
    .bind(name)
    .bind(name)
    .execute(pool)
    .await
    .unwrap();
    sqlx::query_scalar::<_, i64>("SELECT id FROM benutzer WHERE benutzername = ?")
        .bind(name)
        .fetch_one(pool)
        .await
        .unwrap()
}

#[tokio::test]
async fn anlegen_macht_ersteller_zur_einsatzleitung() {
    let pool = crate::db::test_pool().await;
    let leit = benutzer_anlegen(&pool, "leit").await;

    let einsatz = test_anlegen(&pool, "Hochwasser", Some("Deichbruch"), leit)
        .await
        .unwrap();
    assert_eq!(einsatz.bezeichnung, "Hochwasser");
    assert_eq!(einsatz.stichwort.as_deref(), Some("Deichbruch"));
    assert!(einsatz.ist_aktiv());

    let rolle = rolle_von(&pool, einsatz.id, leit).await.unwrap();
    assert_eq!(rolle, Some(EinsatzRolle::Einsatzleitung));
}

#[tokio::test]
async fn rolle_von_fuer_nicht_mitglied_ist_none() {
    let pool = crate::db::test_pool().await;
    let leit = benutzer_anlegen(&pool, "leit").await;
    let fremd = benutzer_anlegen(&pool, "fremd").await;
    let einsatz = test_anlegen(&pool, "Lage", None, leit).await.unwrap();

    assert_eq!(rolle_von(&pool, einsatz.id, fremd).await.unwrap(), None);
}

#[tokio::test]
async fn abschliessen_setzt_status_und_von() {
    let pool = crate::db::test_pool().await;
    let leit = benutzer_anlegen(&pool, "leit").await;
    let einsatz = test_anlegen(&pool, "Lage", None, leit).await.unwrap();

    let abgeschlossen = abschliessen(&pool, einsatz.id, leit).await.unwrap().einsatz;
    assert_eq!(abgeschlossen.status, EinsatzStatus::Abgeschlossen);
    assert!(abgeschlossen.abgeschlossen_at.is_some());
    assert_eq!(abgeschlossen.abgeschlossen_von, Some(leit));
    assert!(!abgeschlossen.ist_aktiv());
}

/// Setzt die Dauer-Politik direkt in der DB (umgeht die Route, reiner Repo-Test).
async fn setze_dauer(pool: &SqlitePool, einsatz_id: i64, bid: i64, tage: i64) {
    super::super::einstellungen::speichern(
        pool,
        einsatz_id,
        bid,
        super::super::einstellungen::EinstellungenDaten {
            retention_dauer_tage: Some(tage),
            ..Default::default()
        },
    )
    .await
    .unwrap();
}

#[tokio::test]
async fn schwaerzung_loescht_dokument_samt_anhang_und_haelt_den_etb_nachweis() {
    // LFH-632, Entscheidung E9: `einsatz_dokument.anhang_id … ON DELETE CASCADE`. Die
    // Registry löscht `anhang` VOR `einsatz_dokument` (Reihenfolge in `TABELLEN`); mit
    // RESTRICT/NO ACTION scheiterte der DELETE auf `anhang` am FK und die ganze
    // Schwärzung rollte zurück. Der ETB-Nachweis bleibt — samt Titel im Wortlaut (G_ETB).
    let pool = crate::db::test_pool().await;
    let leit = benutzer_anlegen(&pool, "leit").await;
    let einsatz = test_anlegen(&pool, "Lage", None, leit).await.unwrap();
    abschliessen(&pool, einsatz.id, leit).await.unwrap();
    sqlx::query("UPDATE einsatz SET geloescht_at = ? WHERE id = ?")
        .bind("2026-01-01 00:00:00")
        .bind(einsatz.id)
        .execute(&pool)
        .await
        .unwrap();
    let anhang_id: i64 = sqlx::query_scalar(
            "INSERT INTO anhang (einsatz_id, dateiname, mime, groesse, sha256, daten, hochgeladen_von) \
             VALUES (?, 'familie.jpg', 'image/jpeg', 3, 'deadbeef', ?, ?) RETURNING id",
        )
        .bind(einsatz.id)
        .bind(b"ABC".as_slice())
        .bind(leit)
        .fetch_one(&pool)
        .await
        .unwrap();
    // Wortlaut aus der Zeit vor LFH-752: Seitdem nennt die Ablage keinen Titel mehr. Ein
    // solcher Bestandseintrag bleibt über die Schwärzung hinweg unverändert.
    let inhalt = "Dokument abgelegt: Foto Familie Müller (Foto)";
    let etb_id: i64 = sqlx::query_scalar(
        "INSERT INTO etb_eintrag (einsatz_id, lfd_nr, typ, inhalt, erfasser_id, ereigniszeit) \
             VALUES (?, 1, 'system', ?, ?, datetime('now')) RETURNING id",
    )
    .bind(einsatz.id)
    .bind(inhalt)
    .bind(leit)
    .fetch_one(&pool)
    .await
    .unwrap();
    sqlx::query(
        "INSERT INTO einsatz_dokument \
               (einsatz_id, anhang_id, kategorie, titel, etb_eintrag_id, abgelegt_von_id) \
             VALUES (?, ?, 'foto', 'Foto Familie Müller', ?, ?)",
    )
    .bind(einsatz.id)
    .bind(anhang_id)
    .bind(etb_id)
    .bind(leit)
    .execute(&pool)
    .await
    .unwrap();

    assert!(schwaerze_einsatz(&pool, einsatz.id, "2026-02-01 00:00:00")
        .await
        .unwrap());

    let zaehle = |sql: &'static str| {
        let pool = pool.clone();
        async move {
            sqlx::query_scalar::<_, i64>(sql)
                .bind(einsatz.id)
                .fetch_one(&pool)
                .await
                .unwrap()
        }
    };
    assert_eq!(
        zaehle("SELECT COUNT(*) FROM einsatz WHERE id = ? AND schwaerzung_marke IS NOT NULL").await,
        1,
        "die Marke trägt die Schwärzung zum Spiegel (LLH-1649)"
    );
    assert_eq!(
        zaehle("SELECT COUNT(*) FROM anhang WHERE einsatz_id = ?").await,
        0,
        "Datei weg"
    );
    assert_eq!(
        zaehle("SELECT COUNT(*) FROM einsatz_dokument WHERE einsatz_id = ?").await,
        0,
        "Dokument-Zeile weg"
    );
    let etb_inhalt: String = sqlx::query_scalar("SELECT inhalt FROM etb_eintrag WHERE id = ?")
        .bind(etb_id)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(
        etb_inhalt, inhalt,
        "ETB-Nachweis bleibt im Wortlaut (G_ETB), auch ein Bestandseintrag mit Titel"
    );
}

#[tokio::test]
async fn schwaerzung_loescht_schaden_anhaenge_und_haelt_den_etb_nachweis() {
    // LFH-21, design.md D7: die Registry löscht `anhang` (und per CASCADE den Linker),
    // `einsatz_schaden_anhang` ist ZeileLoeschen — auch der soft-gelöschte Anhang geht.
    // Die pseudonymen ETB-Nachweise bleiben (G_ETB), sie nennen keinen Dateinamen.
    use crate::schaden::anhang::{self as sa, Ablage};
    let pool = crate::db::test_pool().await;
    let leit = benutzer_anlegen(&pool, "leit").await;
    let einsatz = test_anlegen(&pool, "Lage", None, leit).await.unwrap();
    let schaden = crate::schaden::repo::anlegen(
        &pool,
        einsatz.id,
        leit,
        crate::schaden::repo::NeueDaten {
            typ: "sachschaden",
            ausmass: "gering",
            gefahrenart: None,
            schadensgrad: None,
            ort: "Hauptstr. 1",
            beschreibung: None,
            lat: None,
            lon: None,
            geschaedigt_person_id: None,
            geschaedigt_kontakt: None,
            geschaedigt_personal_id: None,
            geschaedigt_organisation_id: None,
        },
    )
    .await
    .unwrap();
    let startwert = crate::einsatz::einstellungen::laden_oder_default(&pool, einsatz.id)
        .await
        .unwrap()
        .etb_startwert();
    let mut etb_ids = Vec::new();
    let mut linker_ids = Vec::new();
    for name in ["Müller_Hauswand.jpg", "gutachten.pdf"] {
        let mime = if name.ends_with(".pdf") {
            "application/pdf"
        } else {
            "image/jpeg"
        };
        let (id, etb) = sa::ablegen(
            &pool,
            einsatz.id,
            schaden.id,
            leit,
            startwert,
            &Ablage {
                dateiname: name,
                mime,
                daten: b"ABC",
            },
        )
        .await
        .unwrap();
        linker_ids.push(id);
        etb_ids.push(etb);
    }
    etb_ids.push(
        sa::entfernen(
            &pool,
            einsatz.id,
            schaden.id,
            linker_ids[1],
            leit,
            startwert,
        )
        .await
        .unwrap(),
    );
    abschliessen(&pool, einsatz.id, leit).await.unwrap();
    sqlx::query("UPDATE einsatz SET geloescht_at = ? WHERE id = ?")
        .bind("2026-01-01 00:00:00")
        .bind(einsatz.id)
        .execute(&pool)
        .await
        .unwrap();

    assert!(schwaerze_einsatz(&pool, einsatz.id, "2026-02-01 00:00:00")
        .await
        .unwrap());

    let zaehle = |sql: &'static str| {
        let pool = pool.clone();
        async move {
            sqlx::query_scalar::<_, i64>(sql)
                .bind(einsatz.id)
                .fetch_one(&pool)
                .await
                .unwrap()
        }
    };
    assert_eq!(
        zaehle("SELECT COUNT(*) FROM anhang WHERE einsatz_id = ?").await,
        0,
        "Dateien weg, auch die entfernte"
    );
    assert_eq!(
        zaehle("SELECT COUNT(*) FROM einsatz_schaden_anhang WHERE einsatz_id = ?").await,
        0,
        "Linker-Zeilen weg"
    );
    let mut inhalte = Vec::new();
    for id in etb_ids {
        let inhalt: String = sqlx::query_scalar("SELECT inhalt FROM etb_eintrag WHERE id = ?")
            .bind(id)
            .fetch_one(&pool)
            .await
            .unwrap();
        inhalte.push(inhalt);
    }
    assert_eq!(
        inhalte,
        vec![
            "Schaden S-001: Foto abgelegt",
            "Schaden S-001: PDF abgelegt",
            "Schaden S-001: PDF entfernt",
        ],
        "die drei pseudonymen Nachweise bleiben"
    );
}

#[tokio::test]
async fn schwaerzung_loescht_personen_anhaenge_und_haelt_etb_und_audit() {
    // LFH-757, design.md D5: `einsatz_person_anhang` ist ZeileLoeschen (auch der entfernte
    // Anhang geht), die pseudonymen ETB-Nachweise und das Zugriffsprotokoll (Art `anhang`)
    // bleiben.
    use crate::person::anhang::{self as pa, Ablage};
    let pool = crate::db::test_pool().await;
    let leit = benutzer_anlegen(&pool, "leit").await;
    let einsatz = test_anlegen(&pool, "Lage", None, leit).await.unwrap();
    let person: i64 = sqlx::query_scalar(
        "INSERT INTO einsatz_person \
               (einsatz_id, registrier_nr, name, vorname, erfasst_von, geaendert_von) \
             VALUES (?, 1, 'Müller', 'Erika', ?, ?) RETURNING id",
    )
    .bind(einsatz.id)
    .bind(leit)
    .bind(leit)
    .fetch_one(&pool)
    .await
    .unwrap();
    let startwert = crate::einsatz::einstellungen::laden_oder_default(&pool, einsatz.id)
        .await
        .unwrap()
        .etb_startwert();
    let mut etb_ids = Vec::new();
    let mut linker_ids = Vec::new();
    for (name, mime) in [
        ("Erika_Mueller.jpg", "image/jpeg"),
        ("protokoll.pdf", "application/pdf"),
    ] {
        let (id, etb) = pa::ablegen(
            &pool,
            einsatz.id,
            person,
            leit,
            startwert,
            &Ablage {
                dateiname: name,
                mime,
                daten: b"ABC",
            },
        )
        .await
        .unwrap();
        linker_ids.push(id);
        etb_ids.push(etb);
    }
    // Ein Download hinterlässt seine Protokollzeile (die Route schreibt sie, hier direkt).
    crate::person::audit_repo::create(&pool, einsatz.id, Some(person), leit, "anhang")
        .await
        .unwrap();
    etb_ids.push(
        pa::entfernen(&pool, einsatz.id, person, linker_ids[1], leit, startwert)
            .await
            .unwrap(),
    );
    abschliessen(&pool, einsatz.id, leit).await.unwrap();
    sqlx::query("UPDATE einsatz SET geloescht_at = ? WHERE id = ?")
        .bind("2026-01-01 00:00:00")
        .bind(einsatz.id)
        .execute(&pool)
        .await
        .unwrap();

    assert!(schwaerze_einsatz(&pool, einsatz.id, "2026-02-01 00:00:00")
        .await
        .unwrap());

    let zaehle = |sql: &'static str| {
        let pool = pool.clone();
        async move {
            sqlx::query_scalar::<_, i64>(sql)
                .bind(einsatz.id)
                .fetch_one(&pool)
                .await
                .unwrap()
        }
    };
    assert_eq!(
        zaehle("SELECT COUNT(*) FROM anhang WHERE einsatz_id = ?").await,
        0,
        "Dateien weg, auch die entfernte"
    );
    assert_eq!(
        zaehle("SELECT COUNT(*) FROM einsatz_person_anhang WHERE einsatz_id = ?").await,
        0,
        "Linker-Zeilen weg"
    );
    assert_eq!(
        zaehle("SELECT COUNT(*) FROM person_zugriff_audit WHERE einsatz_id = ? AND art = 'anhang'")
            .await,
        1,
        "das Zugriffsprotokoll bleibt"
    );
    let mut inhalte = Vec::new();
    for id in etb_ids {
        let inhalt: String = sqlx::query_scalar("SELECT inhalt FROM etb_eintrag WHERE id = ?")
            .bind(id)
            .fetch_one(&pool)
            .await
            .unwrap();
        inhalte.push(inhalt);
    }
    assert_eq!(
        inhalte,
        vec![
            "Person R-001: Foto abgelegt",
            "Person R-001: PDF abgelegt",
            "Person R-001: PDF entfernt",
        ],
        "die drei pseudonymen Nachweise bleiben"
    );
}

#[tokio::test]
async fn schwaerzung_loescht_tier_anhaenge_und_haelt_den_etb_nachweis() {
    // LFH-758: wie Schäden — `anhang` geht (CASCADE nimmt den Linker), `einsatz_tier_anhang`
    // ist ZeileLoeschen, die pseudonymen Nachweise „Tier T-001: …“ bleiben.
    use crate::anhang::erfassung::Ablage;
    use crate::tier::anhang as ta;
    let pool = crate::db::test_pool().await;
    let leit = benutzer_anlegen(&pool, "leit").await;
    let einsatz = test_anlegen(&pool, "Lage", None, leit).await.unwrap();
    let tier = crate::tier::repo::anlegen(
        &pool,
        einsatz.id,
        leit,
        "aktiv",
        crate::tier::repo::NeueDaten {
            spezies: "hund",
            rasse_beschreibung: None,
            rufname: None,
            geschlecht: None,
            alter_geschaetzt: None,
            farbe_beschreibung: None,
            kennzeichnung: None,
            groesse_gewicht: None,
            halter_person_id: None,
            halter_kontakt: None,
            antreff_ort: None,
            antreff_lat: None,
            antreff_lon: None,
            notiz: None,
        },
    )
    .await
    .unwrap();
    let startwert = crate::einsatz::einstellungen::laden_oder_default(&pool, einsatz.id)
        .await
        .unwrap()
        .etb_startwert();
    let mut etb_ids = Vec::new();
    let mut linker_ids = Vec::new();
    for (name, mime) in [
        ("Müller_Bello.jpg", "image/jpeg"),
        ("impfpass.pdf", "application/pdf"),
    ] {
        let (id, etb) = ta::ablegen(
            &pool,
            einsatz.id,
            tier.id,
            leit,
            startwert,
            &Ablage {
                dateiname: name,
                mime,
                daten: b"ABC",
            },
        )
        .await
        .unwrap();
        linker_ids.push(id);
        etb_ids.push(etb);
    }
    etb_ids.push(
        ta::entfernen(&pool, einsatz.id, tier.id, linker_ids[1], leit, startwert)
            .await
            .unwrap(),
    );
    abschliessen(&pool, einsatz.id, leit).await.unwrap();
    sqlx::query("UPDATE einsatz SET geloescht_at = ? WHERE id = ?")
        .bind("2026-01-01 00:00:00")
        .bind(einsatz.id)
        .execute(&pool)
        .await
        .unwrap();

    assert!(schwaerze_einsatz(&pool, einsatz.id, "2026-02-01 00:00:00")
        .await
        .unwrap());

    for sql in [
        "SELECT COUNT(*) FROM anhang WHERE einsatz_id = ?",
        "SELECT COUNT(*) FROM einsatz_tier_anhang WHERE einsatz_id = ?",
    ] {
        let n: i64 = sqlx::query_scalar(sql)
            .bind(einsatz.id)
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(n, 0, "{sql}");
    }
    let mut inhalte = Vec::new();
    for id in etb_ids {
        let inhalt: String = sqlx::query_scalar("SELECT inhalt FROM etb_eintrag WHERE id = ?")
            .bind(id)
            .fetch_one(&pool)
            .await
            .unwrap();
        inhalte.push(inhalt);
    }
    assert_eq!(
        inhalte,
        vec![
            "Tier T-001: Foto abgelegt",
            "Tier T-001: PDF abgelegt",
            "Tier T-001: PDF entfernt",
        ]
    );
}

#[tokio::test]
async fn schwaerzung_loescht_den_uhs_plan_und_haelt_die_plaetze() {
    // LFH-999: `uhs_plan` ist ZeileLoeschen (Bild samt Bytes geht), das Platz-Layout und die
    // Bezeichnung der UHS bleiben.
    let pool = crate::db::test_pool().await;
    let leit = benutzer_anlegen(&pool, "leit").await;
    let einsatz = test_anlegen(&pool, "Lage", None, leit).await.unwrap();
    let uhs = crate::uhs::repo::anlegen(
        &pool,
        einsatz.id,
        leit,
        crate::uhs::repo::NeueDaten {
            lat: None,
            lon: None,
            typ: "behandlungsplatz",
            bezeichnung: "BHP 50",
            abschnitt_id: None,
            standort: None,
            notiz: None,
        },
    )
    .await
    .unwrap();
    crate::uhs::platz_repo::anlegen_bulk(&pool, uhs.id, "behandlungsplatz", "P", 3)
        .await
        .unwrap();
    let positionen = |pool: sqlx::SqlitePool| async move {
        sqlx::query_as::<_, (Option<f64>, Option<f64>)>(
            "SELECT pos_x, pos_y FROM uhs_platz WHERE uhs_id = ? ORDER BY id",
        )
        .bind(uhs.id)
        .fetch_all(&pool)
        .await
        .unwrap()
    };
    let vorher = positionen(pool.clone()).await;
    let bild = crate::uhs::plan::pruefe_bild(&crate::uhs::plan::testbild::png(16, 16)).unwrap();
    let mut conn = pool.acquire().await.unwrap();
    crate::uhs::plan::repo::hinterlegen_tx(&mut conn, einsatz.id, uhs.id, leit, &bild)
        .await
        .unwrap();
    drop(conn);
    abschliessen(&pool, einsatz.id, leit).await.unwrap();
    sqlx::query("UPDATE einsatz SET geloescht_at = ? WHERE id = ?")
        .bind("2026-01-01 00:00:00")
        .bind(einsatz.id)
        .execute(&pool)
        .await
        .unwrap();

    assert!(schwaerze_einsatz(&pool, einsatz.id, "2026-02-01 00:00:00")
        .await
        .unwrap());

    let plaene: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM uhs_plan WHERE einsatz_id = ?")
        .bind(einsatz.id)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(plaene, 0, "der Plan ist weg");
    assert_eq!(positionen(pool.clone()).await, vorher, "die Plätze stehen");
    let bez: String = sqlx::query_scalar("SELECT bezeichnung FROM uhs WHERE id = ?")
        .bind(uhs.id)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(bez, "BHP 50");
}

#[tokio::test]
async fn schwaerzung_loescht_uhs_anhaenge_und_haelt_etb_und_audit() {
    // LFH-758: `uhs_anhang` ist ZeileLoeschen (Datei und Linker gehen, auch entfernte), die
    // pseudonymen Nachweise „UHS BHP 50: …“ und das Lese-Audit `anhang_zugriff_audit`
    // bleiben — Letzteres mit `ablage`, obwohl `anhang_id` danach ins Leere zeigt.
    use crate::anhang::audit_repo::{self, ZugriffFassung};
    use crate::anhang::erfassung::Ablage;
    use crate::uhs::anhang as ua;
    let pool = crate::db::test_pool().await;
    let leit = benutzer_anlegen(&pool, "leit").await;
    let einsatz = test_anlegen(&pool, "Lage", None, leit).await.unwrap();
    let uhs = crate::uhs::repo::anlegen(
        &pool,
        einsatz.id,
        leit,
        crate::uhs::repo::NeueDaten {
            lat: None,
            lon: None,
            typ: "behandlungsplatz",
            bezeichnung: "BHP 50",
            abschnitt_id: None,
            standort: Some("Turnhalle Nord"),
            notiz: None,
        },
    )
    .await
    .unwrap();
    let startwert = crate::einsatz::einstellungen::laden_oder_default(&pool, einsatz.id)
        .await
        .unwrap()
        .etb_startwert();
    let mut etb_ids = Vec::new();
    let mut linker_ids = Vec::new();
    for (name, mime) in [
        ("Patient_Liege3.jpg", "image/jpeg"),
        ("plan.pdf", "application/pdf"),
    ] {
        let (id, etb) = ua::ablegen(
            &pool,
            einsatz.id,
            uhs.id,
            leit,
            startwert,
            &Ablage {
                dateiname: name,
                mime,
                daten: b"ABC",
            },
        )
        .await
        .unwrap();
        linker_ids.push(id);
        etb_ids.push(etb);
    }
    let aid = ua::anhang_id_fuer_download(&pool, einsatz.id, uhs.id, linker_ids[0])
        .await
        .unwrap();
    audit_repo::anlegen(
        &pool,
        einsatz.id,
        aid,
        "UHS BHP 50",
        leit,
        ZugriffFassung::Bereinigt,
    )
    .await
    .unwrap();
    etb_ids.push(
        ua::entfernen(&pool, einsatz.id, uhs.id, linker_ids[1], leit, startwert)
            .await
            .unwrap(),
    );
    abschliessen(&pool, einsatz.id, leit).await.unwrap();
    sqlx::query("UPDATE einsatz SET geloescht_at = ? WHERE id = ?")
        .bind("2026-01-01 00:00:00")
        .bind(einsatz.id)
        .execute(&pool)
        .await
        .unwrap();

    assert!(schwaerze_einsatz(&pool, einsatz.id, "2026-02-01 00:00:00")
        .await
        .unwrap());

    for sql in [
        "SELECT COUNT(*) FROM anhang WHERE einsatz_id = ?",
        "SELECT COUNT(*) FROM uhs_anhang WHERE einsatz_id = ?",
    ] {
        let n: i64 = sqlx::query_scalar(sql)
            .bind(einsatz.id)
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(n, 0, "{sql}");
    }
    let protokoll: Vec<(i64, String, String)> = sqlx::query_as(
        "SELECT anhang_id, ablage, fassung FROM anhang_zugriff_audit WHERE einsatz_id = ?",
    )
    .bind(einsatz.id)
    .fetch_all(&pool)
    .await
    .unwrap();
    assert_eq!(
        protokoll,
        vec![(aid, "UHS BHP 50".to_string(), "bereinigt".to_string())],
        "das Lese-Audit bleibt"
    );
    let mut inhalte = Vec::new();
    for id in etb_ids {
        let inhalt: String = sqlx::query_scalar("SELECT inhalt FROM etb_eintrag WHERE id = ?")
            .bind(id)
            .fetch_one(&pool)
            .await
            .unwrap();
        inhalte.push(inhalt);
    }
    assert_eq!(
        inhalte,
        vec![
            "UHS BHP 50: Foto abgelegt",
            "UHS BHP 50: PDF abgelegt",
            "UHS BHP 50: PDF entfernt",
        ]
    );
}

/// LFH-22 (design.md D8): das Logo ist keine Einsatzunterlage. Schwärzen eines
/// Einsatzes lässt die Logo-Bytes der Organisation unverändert.
#[tokio::test]
async fn schwaerzung_laesst_das_logo_der_organisation_unveraendert() {
    let pool = crate::db::test_pool().await;
    let leit = benutzer_anlegen(&pool, "leit").await;
    let einsatz = test_anlegen(&pool, "Lage", None, leit).await.unwrap();
    abschliessen(&pool, einsatz.id, leit).await.unwrap();
    sqlx::query("UPDATE einsatz SET geloescht_at = ? WHERE id = ?")
        .bind("2026-01-01 00:00:00")
        .bind(einsatz.id)
        .execute(&pool)
        .await
        .unwrap();
    let bytes = b"\x89PNG\r\n\x1a\nLogo-Bytes".to_vec();
    crate::org::logo::setzen(&pool, 1, "image/png", &bytes, leit)
        .await
        .unwrap();
    let vorher = crate::org::logo::meta(&pool, 1).await.unwrap().unwrap();

    assert!(schwaerze_einsatz(&pool, einsatz.id, "2026-02-01 00:00:00")
        .await
        .unwrap());

    assert_eq!(
        crate::org::logo::inhalt(&pool, 1)
            .await
            .unwrap()
            .map(|i| i.daten),
        Some(bytes),
        "Logo-Bytes bleiben"
    );
    assert_eq!(
        crate::org::logo::meta(&pool, 1).await.unwrap(),
        Some(vorher),
        "Metadaten bleiben"
    );
}

#[tokio::test]
async fn schwaerzung_loescht_etb_anhang_und_haelt_den_eintrag() {
    // LFH-117, design.md D8: die Datei geht (Nachlauf, LFH-905), die Verknüpfung schon im
    // atomaren Vorgang, der Eintrag bleibt mit Inhalt und Nummer (G_ETB) und trägt danach
    // `anhaenge: []`. Die Bindungsabfrage des ETB-Downloads trifft nichts mehr → 404.
    let pool = crate::db::test_pool().await;
    let leit = benutzer_anlegen(&pool, "leit").await;
    let einsatz = test_anlegen(&pool, "Lage", None, leit).await.unwrap();
    let foto = crate::anhang::repo::anlegen(
        &pool,
        einsatz.id,
        leit,
        "Familie Müller.jpg",
        "image/jpeg",
        b"JPEG",
    )
    .await
    .unwrap();
    let inhalt = "Foto der Schadenstelle";
    let (eintrag, _) = crate::etb::repo::anlegen_idempotent(
        &pool,
        einsatz.id,
        leit,
        None,
        &[foto.id],
        crate::etb::repo::EintragDaten {
            typ: "meldung",
            inhalt,
            von: None,
            an: None,
            meldeweg: None,
            veranlassung: None,
            ereigniszeit: None,
            erfasst_lokal_at: None,
            berichtigt_eintrag_id: None,
        },
    )
    .await
    .unwrap();
    assert_eq!(
        eintrag.anhaenge.len(),
        1,
        "Vorbedingung: Foto hängt am Eintrag"
    );
    abschliessen(&pool, einsatz.id, leit).await.unwrap();
    sqlx::query("UPDATE einsatz SET geloescht_at = ? WHERE id = ?")
        .bind("2026-01-01 00:00:00")
        .bind(einsatz.id)
        .execute(&pool)
        .await
        .unwrap();

    assert!(schwaerze_einsatz(&pool, einsatz.id, "2026-02-01 00:00:00")
        .await
        .unwrap());

    let (dateien, links): (i64, i64) = sqlx::query_as(
        "SELECT (SELECT COUNT(*) FROM anhang WHERE id = ?1), \
                    (SELECT COUNT(*) FROM etb_eintrag_anhang WHERE anhang_id = ?1)",
    )
    .bind(foto.id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!((dateien, links), (0, 0), "Datei und Verknüpfung weg");

    let liste = crate::etb::repo::abfrage(
        &pool,
        einsatz.id,
        &crate::etb::repo::EtbFilter {
            limit: 100,
            ..Default::default()
        },
    )
    .await
    .unwrap();
    let danach = liste
        .iter()
        .find(|e| e.id == eintrag.id)
        .expect("der Eintrag bleibt");
    assert_eq!(danach.inhalt, inhalt, "Inhalt unverändert (G_ETB)");
    assert_eq!(danach.lfd_nr, eintrag.lfd_nr, "Nummer unverändert");
    assert!(danach.anhaenge.is_empty(), "anhaenge: []");
    assert!(
        !crate::etb::repo::anhang_am_eintrag(&pool, einsatz.id, eintrag.id, foto.id)
            .await
            .unwrap(),
        "der frühere Download-Pfad findet nichts mehr (Route antwortet 404)"
    );
}

/// LFH-905, Spec `aufbewahrung`, „Anhänge zwischen Schwärzung und Entfernung“: Der atomare
/// Vorgang löscht die Anhang-Zeilen nicht mehr (das tut der Nachlauf einzeln), macht sie
/// aber unerreichbar: keine Verknüpfung mehr, und auch der generische Abruf eines
/// ungebundenen Uploads durch die hochladende Person findet nichts.
#[tokio::test]
async fn atomare_schwaerzung_macht_anhaenge_unerreichbar_und_laesst_die_zeilen_stehen() {
    let pool = crate::db::test_pool().await;
    let leit = benutzer_anlegen(&pool, "leit").await;
    let einsatz = test_anlegen(&pool, "Lage", None, leit).await.unwrap();
    let foto = crate::anhang::repo::anlegen(
        &pool,
        einsatz.id,
        leit,
        "Familie Müller.jpg",
        "image/jpeg",
        b"JPEG",
    )
    .await
    .unwrap();
    let lose = crate::anhang::repo::anlegen(
        &pool,
        einsatz.id,
        leit,
        "nie gesendet.jpg",
        "image/jpeg",
        b"JPEG2",
    )
    .await
    .unwrap();
    crate::etb::repo::anlegen_idempotent(
        &pool,
        einsatz.id,
        leit,
        None,
        &[foto.id],
        crate::etb::repo::EintragDaten {
            typ: "meldung",
            inhalt: "Foto der Schadenstelle",
            von: None,
            an: None,
            meldeweg: None,
            veranlassung: None,
            ereigniszeit: None,
            erfasst_lokal_at: None,
            berichtigt_eintrag_id: None,
        },
    )
    .await
    .unwrap();
    abschliessen(&pool, einsatz.id, leit).await.unwrap();
    sqlx::query("UPDATE einsatz SET geloescht_at = ? WHERE id = ?")
        .bind("2026-01-01 00:00:00")
        .bind(einsatz.id)
        .execute(&pool)
        .await
        .unwrap();

    assert!(
        schwaerze_einsatz_atomar(&pool, einsatz.id, "2026-02-01 00:00:00")
            .await
            .unwrap()
    );

    let (dateien, links): (i64, i64) = sqlx::query_as(
        "SELECT (SELECT COUNT(*) FROM anhang WHERE einsatz_id = ?1), \
                    (SELECT COUNT(*) FROM etb_eintrag_anhang WHERE anhang_id = ?2)",
    )
    .bind(einsatz.id)
    .bind(foto.id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(
        (dateien, links),
        (2, 0),
        "Zeilen stehen bis zum Nachlauf, Verknüpfung weg"
    );
    for id in [foto.id, lose.id] {
        assert!(
            !crate::anhang::repo::gehoert_anhang_zu_einsatz(&pool, id, einsatz.id)
                .await
                .unwrap(),
            "erstes Gate des Abrufs: 404 vor jedem Lese-Audit"
        );
        assert!(matches!(
            crate::anhang::repo::meta_fuer_download(&pool, id).await,
            Err(AppError::NotFound)
        ));
        assert!(matches!(
            crate::anhang::repo::anzeige_laden(&pool, id).await,
            Err(AppError::NotFound)
        ));
    }
}

#[tokio::test]
async fn schwaerzung_loescht_heraufgestufte_kopie_samt_chat_quelle_und_haelt_den_eintrag() {
    // LFH-700, design.md D1: Die Kopie beim Heraufstufen ist eine gewöhnliche
    // `anhang`-Zeile des Einsatzes. Die Schwärzung räumt sie wie die Chat-Quelle, der
    // Eintrag bleibt mit Inhalt (G_ETB).
    let pool = crate::db::test_pool().await;
    let leit = benutzer_anlegen(&pool, "leit").await;
    let einsatz = test_anlegen(&pool, "Lage", None, leit).await.unwrap();
    let foto = crate::anhang::repo::anlegen(
        &pool,
        einsatz.id,
        leit,
        "Familie Müller.jpg",
        "image/jpeg",
        b"JPEG",
    )
    .await
    .unwrap();
    let kanal = crate::chat::repo::kanal_anlegen(&pool, einsatz.id, leit, "K", None)
        .await
        .unwrap();
    let m = crate::chat::repo::anlegen_mit_anhaengen(
        &pool,
        einsatz.id,
        leit,
        kanal.id,
        "Lage am Deich",
        &[foto.id],
    )
    .await
    .unwrap();
    let etb_id = crate::chat::repo::heraufstufen_zu_etb(
        &pool,
        einsatz.id,
        m.id,
        leit,
        "meldung",
        "Lage am Deich",
        &m.erstellt_at,
        &[foto.id],
    )
    .await
    .unwrap();
    let kopie = crate::etb::repo::laden(&pool, etb_id)
        .await
        .unwrap()
        .anhaenge[0]
        .id;
    abschliessen(&pool, einsatz.id, leit).await.unwrap();
    sqlx::query("UPDATE einsatz SET geloescht_at = ? WHERE id = ?")
        .bind("2026-01-01 00:00:00")
        .bind(einsatz.id)
        .execute(&pool)
        .await
        .unwrap();

    assert!(schwaerze_einsatz(&pool, einsatz.id, "2026-02-01 00:00:00")
        .await
        .unwrap());

    let (dateien, links): (i64, i64) = sqlx::query_as(
        "SELECT (SELECT COUNT(*) FROM anhang WHERE id IN (?1, ?2)), \
                    (SELECT COUNT(*) FROM etb_eintrag_anhang WHERE anhang_id = ?2)",
    )
    .bind(foto.id)
    .bind(kopie)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(
        (dateien, links),
        (0, 0),
        "Quelle, Kopie und Verknüpfung weg"
    );
    let inhalt: String = sqlx::query_scalar("SELECT inhalt FROM etb_eintrag WHERE id = ?")
        .bind(etb_id)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(inhalt, "Lage am Deich", "Eintrag bleibt (G_ETB)");
}

#[tokio::test]
async fn schwaerzung_nullt_freies_zeichen_label_pii() {
    // LFH-170/Review: freies_zeichen.label ist Freitext (kann PII tragen, z. B. „ELW Fam.
    // Müller"). Es MUSS von schwaerze_einsatz genullt werden; die operative Position (lat/lon)
    // bleibt wie das übrige Skelett erhalten.
    let pool = crate::db::test_pool().await;
    let leit = benutzer_anlegen(&pool, "leit").await;
    let einsatz = test_anlegen(&pool, "Lage", None, leit).await.unwrap();
    abschliessen(&pool, einsatz.id, leit).await.unwrap();
    // Retention-Guard erfüllen: soft-gelöscht.
    sqlx::query("UPDATE einsatz SET geloescht_at = ? WHERE id = ?")
        .bind("2026-01-01 00:00:00")
        .bind(einsatz.id)
        .execute(&pool)
        .await
        .unwrap();
    // LLH-1160: eine Altzeile trägt ihre Altwerte als Hülle in `zeichen_spec` (Migration 0192).
    let alt = r#"{"v":1,"alt":{"grundzeichen":"stelle"}}"#;
    sqlx::query(
        "INSERT INTO freies_zeichen (einsatz_id, lat, lon, zeichen_spec, label, erstellt_von) \
             VALUES (?, ?, ?, ?, 'ELW Fam. Müller', ?)",
    )
    .bind(einsatz.id)
    .bind(50.1)
    .bind(8.6)
    .bind(alt)
    .bind(leit)
    .execute(&pool)
    .await
    .unwrap();
    // LFH-836: ein Zeichen mit Zeichenbeschreibung — die Beschreibung trägt nur Katalogwerte
    // (Freitext lehnt der Server ab) und bleibt als Skelett, das Label fällt.
    let spec = r#"{"v":1,"freestanding":{"kind":"state","state":"developed-fire"}}"#;
    sqlx::query(
        "INSERT INTO freies_zeichen (einsatz_id, lat, lon, zeichen_spec, label, erstellt_von) \
             VALUES (?, ?, ?, ?, 'Fam. Meier', ?)",
    )
    .bind(einsatz.id)
    .bind(50.2)
    .bind(8.7)
    .bind(spec)
    .bind(leit)
    .execute(&pool)
    .await
    .unwrap();

    assert!(schwaerze_einsatz(&pool, einsatz.id, "2026-02-01 00:00:00")
        .await
        .unwrap());

    let zeilen: Vec<(Option<String>, f64, String)> = sqlx::query_as(
        "SELECT label, lat, zeichen_spec FROM freies_zeichen WHERE einsatz_id = ? ORDER BY id",
    )
    .bind(einsatz.id)
    .fetch_all(&pool)
    .await
    .unwrap();
    assert_eq!(
        zeilen,
        vec![
            (None, 50.1, alt.to_string()),
            (None, 50.2, spec.to_string())
        ],
        "Freitext-Label (PII) NULL, Position und Zeichenbeschreibung bleiben (Skelett)"
    );
}

#[tokio::test]
async fn schwaerzung_nullt_lagedaten_der_person_und_behaelt_die_kategorien() {
    // LFH-613, Spec-Szenario „Geschwärzter Einsatz": Zustand (Gesundheitsdatum),
    // Fundort-Koordinate und Verbleib-Ziel tragen Personenbezug und werden leer; Art und
    // Status des Verbleibs sowie „vermisst seit" sind Kategorien bzw. Zeitstempel und
    // bleiben für die statistische Aufbewahrung stehen.
    let pool = crate::db::test_pool().await;
    let leit = benutzer_anlegen(&pool, "leit").await;
    let einsatz = test_anlegen(&pool, "Lage", None, leit).await.unwrap();
    abschliessen(&pool, einsatz.id, leit).await.unwrap();
    sqlx::query("UPDATE einsatz SET geloescht_at = ? WHERE id = ?")
        .bind("2026-01-01 00:00:00")
        .bind(einsatz.id)
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query(
        "INSERT INTO einsatz_person (einsatz_id, registrier_nr, status, zustand, \
                antreff_lat, antreff_lon, vermisst_seit, aktuelle_verbleib_art, \
                aktuelles_verbleib_ziel, aktueller_verbleib_status, erfasst_von, geaendert_von) \
             VALUES (?, 1, 'vermisst', 'gehfähig, unterkühlt', 52.2691, 9.1342, \
                '2026-01-01 06:00:00', 'transport', 'KH Mitte', 'angemeldet', ?, ?)",
    )
    .bind(einsatz.id)
    .bind(leit)
    .bind(leit)
    .execute(&pool)
    .await
    .unwrap();
    // LFH-674: eine zweite Person mit Notunterkunft an einer Stelle — der Verweis ist eine
    // Kennung und bleibt, das Ziel (Stellenname als Freitext) wird leer.
    let stelle: i64 = sqlx::query_scalar(
        "INSERT INTO betreuungsstelle (einsatz_id, bezeichnung, art, angelegt_von_id) \
             VALUES (?, 'NU Turnhalle Nord', 'notunterkunft', ?) RETURNING id",
    )
    .bind(einsatz.id)
    .bind(leit)
    .fetch_one(&pool)
    .await
    .unwrap();
    let person2: i64 = sqlx::query_scalar(
            "INSERT INTO einsatz_person (einsatz_id, registrier_nr, status, aktuelle_verbleib_art, \
                aktuelles_verbleib_ziel, aktuelle_verbleib_betreuungsstelle_id, erfasst_von, \
                geaendert_von) \
             VALUES (?, 2, 'betroffen', 'notunterkunft', 'NU Turnhalle Nord', ?, ?, ?) RETURNING id",
        )
        .bind(einsatz.id)
        .bind(stelle)
        .bind(leit)
        .bind(leit)
        .fetch_one(&pool)
        .await
        .unwrap();
    sqlx::query(
        "INSERT INTO person_verbleib (einsatz_id, person_id, art, ziel, betreuungsstelle_id, \
                erfasst_von) VALUES (?, ?, 'notunterkunft', 'NU Turnhalle Nord', ?, ?)",
    )
    .bind(einsatz.id)
    .bind(person2)
    .bind(stelle)
    .bind(leit)
    .execute(&pool)
    .await
    .unwrap();

    assert!(schwaerze_einsatz(&pool, einsatz.id, "2026-02-01 00:00:00")
        .await
        .unwrap());

    #[allow(clippy::type_complexity)]
    let zeile: (
        Option<String>,
        Option<f64>,
        Option<f64>,
        Option<String>,
        Option<String>,
        Option<String>,
        Option<String>,
    ) = sqlx::query_as(
        "SELECT zustand, antreff_lat, antreff_lon, aktuelles_verbleib_ziel, \
                    aktuelle_verbleib_art, aktueller_verbleib_status, vermisst_seit \
             FROM einsatz_person WHERE einsatz_id = ? AND registrier_nr = 1",
    )
    .bind(einsatz.id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(
        zeile,
        (
            None,
            None,
            None,
            None,
            Some("transport".into()),
            Some("angemeldet".into()),
            Some("2026-01-01 06:00:00".into()),
        ),
        "Zustand, Koordinate und Ziel leer; Art, Status und vermisst_seit erhalten"
    );

    let cache: (Option<String>, Option<i64>) = sqlx::query_as(
        "SELECT aktuelles_verbleib_ziel, aktuelle_verbleib_betreuungsstelle_id \
             FROM einsatz_person WHERE id = ?",
    )
    .bind(person2)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(
        cache,
        (None, Some(stelle)),
        "Cache: Ziel leer, Verweis bleibt"
    );
    let ereignis: (Option<String>, Option<i64>) =
        sqlx::query_as("SELECT ziel, betreuungsstelle_id FROM person_verbleib WHERE person_id = ?")
            .bind(person2)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(
        ereignis,
        (None, Some(stelle)),
        "Ereignis: Ziel leer, Verweis bleibt"
    );
}

#[tokio::test]
async fn schwaerzung_trifft_die_verbindungen() {
    let pool = crate::db::test_pool().await;
    let leit = benutzer_anlegen(&pool, "leit").await;
    let einsatz = test_anlegen(&pool, "Lage", None, leit).await.unwrap();
    abschliessen(&pool, einsatz.id, leit).await.unwrap();
    sqlx::query("UPDATE einsatz SET geloescht_at = ? WHERE id = ?")
        .bind("2026-01-01 00:00:00")
        .bind(einsatz.id)
        .execute(&pool)
        .await
        .unwrap();
    let abschnitt: i64 = sqlx::query_scalar(
        "INSERT INTO einsatzabschnitt (einsatz_id, name, rufname) VALUES (?, 'Nord', \
             'Rotkreuz 1/10-1') RETURNING id",
    )
    .bind(einsatz.id)
    .fetch_one(&pool)
    .await
    .unwrap();
    let liste = [crate::einsatz::verbindungen::Verbindung {
        mittel: crate::fernmeldewesen::kommunikation::Verbindungsmittel::Mobil,
        wert: "0170 98765".into(),
        hinweis: Some("nur Anna".into()),
    }];
    for bezug in [
        crate::einsatz::verbindungen::Bezug::Abschnitt(abschnitt),
        crate::einsatz::verbindungen::Bezug::Fuehrungsstelle,
    ] {
        crate::einsatz::verbindungen::ersetzen(&pool, einsatz.id, bezug, &liste)
            .await
            .unwrap();
    }

    assert!(schwaerze_einsatz(&pool, einsatz.id, "2026-02-01 00:00:00")
        .await
        .unwrap());

    let zeilen: Vec<(String, String, Option<String>)> = sqlx::query_as(
        "SELECT mittel, wert, hinweis FROM einsatz_verbindung WHERE einsatz_id = ? ORDER BY id",
    )
    .bind(einsatz.id)
    .fetch_all(&pool)
    .await
    .unwrap();
    assert_eq!(zeilen.len(), 2);
    for (mittel, wert, hinweis) in zeilen {
        assert_eq!(mittel, "mobil", "das Mittel ist kein PII");
        assert_ne!(wert, "0170 98765", "der Wert ist PII");
        assert_eq!(hinweis, None, "der Hinweis ist PII");
    }
}

/// Bereitet einen schwärzbaren Einsatz vor (abgeschlossen + soft-gelöscht).
async fn schwaerzbarer_einsatz(pool: &SqlitePool) -> (i64, i64) {
    let leit = benutzer_anlegen(pool, "leit").await;
    let einsatz = test_anlegen(pool, "Lage", None, leit).await.unwrap();
    abschliessen(pool, einsatz.id, leit).await.unwrap();
    sqlx::query("UPDATE einsatz SET geloescht_at = ? WHERE id = ?")
        .bind("2026-01-01 00:00:00")
        .bind(einsatz.id)
        .execute(pool)
        .await
        .unwrap();
    (einsatz.id, leit)
}

#[tokio::test]
async fn schwaerzung_entfernt_chat_und_erinnerungs_freitexte() {
    // LFH-290: Chat- und Erinnerungs-Freitexte tragen Personenbezug („Fam. Müller,
    // Tel. 0170 …“) und standen bis dahin als RETAIN v1 in der Registry. Sie werden
    // jetzt entfernt — auch in soft-gelöschten Nachrichten, deren Inhalt stehen blieb.
    // Die Struktur (ids, kanal_id, faellig_at, status) bleibt; ein Chat-Anhang geht
    // mit seiner Verknüpfung vollständig weg.
    let pool = crate::db::test_pool().await;
    let (eid, leit) = schwaerzbarer_einsatz(&pool).await;
    let kanal_id: i64 = sqlx::query_scalar(
        "INSERT INTO chat_kanal (einsatz_id, name, beschreibung, erstellt_von_id) \
             VALUES (?, 'Absprache Fam. Müller', 'Kontakt Tochter 0170 111', ?) RETURNING id",
    )
    .bind(eid)
    .bind(leit)
    .fetch_one(&pool)
    .await
    .unwrap();
    let mut nachricht_ids = Vec::new();
    for (inhalt, geloescht) in [
        ("Herr Schmidt, Hauptstr. 5, sitzt fest", None),
        (
            "Frau Meyer, Tel. 0151 222 — versehentlich gepostet",
            Some("2026-01-01 01:00:00"),
        ),
        ("Foto Familie Weber anbei", None),
    ] {
        let id: i64 = sqlx::query_scalar(
            "INSERT INTO chat_nachricht (einsatz_id, kanal_id, autor_id, inhalt, geloescht_at) \
                 VALUES (?, ?, ?, ?, ?) RETURNING id",
        )
        .bind(eid)
        .bind(kanal_id)
        .bind(leit)
        .bind(inhalt)
        .bind(geloescht)
        .fetch_one(&pool)
        .await
        .unwrap();
        nachricht_ids.push(id);
    }
    let anhang_id: i64 = sqlx::query_scalar(
            "INSERT INTO anhang (einsatz_id, dateiname, mime, groesse, sha256, daten, hochgeladen_von) \
             VALUES (?, 'weber.jpg', 'image/jpeg', 3, 'deadbeef', ?, ?) RETURNING id",
        )
        .bind(eid)
        .bind(b"ABC".as_slice())
        .bind(leit)
        .fetch_one(&pool)
        .await
        .unwrap();
    sqlx::query("INSERT INTO chat_nachricht_anhang (nachricht_id, anhang_id) VALUES (?, ?)")
        .bind(nachricht_ids[2])
        .bind(anhang_id)
        .execute(&pool)
        .await
        .unwrap();
    let erinnerung_id: i64 = sqlx::query_scalar(
        "INSERT INTO erinnerung (einsatz_id, titel, beschreibung, faellig_at, \
                empfaenger_funktion, status, erstellt_von_id) \
             VALUES (?, 'Rückruf Frau Meyer', 'Tel. 0151 222, Tochter vermisst', \
                '2026-01-01 12:00:00', 'Herr Müller (S2)', 'offen', ?) RETURNING id",
    )
    .bind(eid)
    .bind(leit)
    .fetch_one(&pool)
    .await
    .unwrap();

    assert!(schwaerze_einsatz(&pool, eid, "2026-02-01 00:00:00")
        .await
        .unwrap());

    let kanal: (i64, i64, String, Option<String>) =
        sqlx::query_as("SELECT id, einsatz_id, name, beschreibung FROM chat_kanal WHERE id = ?")
            .bind(kanal_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(
        kanal,
        (kanal_id, eid, SCHWAERZUNG_PLATZHALTER.to_string(), None),
        "Kanal: Name Platzhalter, Beschreibung NULL, Struktur bleibt"
    );

    let nachrichten: Vec<(i64, i64, String, Option<String>)> = sqlx::query_as(
        "SELECT id, kanal_id, inhalt, geloescht_at FROM chat_nachricht \
             WHERE einsatz_id = ? ORDER BY id",
    )
    .bind(eid)
    .fetch_all(&pool)
    .await
    .unwrap();
    assert_eq!(
        nachrichten,
        vec![
            (
                nachricht_ids[0],
                kanal_id,
                SCHWAERZUNG_PLATZHALTER.to_string(),
                None
            ),
            (
                nachricht_ids[1],
                kanal_id,
                SCHWAERZUNG_PLATZHALTER.to_string(),
                Some("2026-01-01 01:00:00".to_string())
            ),
            (
                nachricht_ids[2],
                kanal_id,
                SCHWAERZUNG_PLATZHALTER.to_string(),
                None
            ),
        ],
        "jede Nachricht (auch die soft-gelöschte) trägt den Platzhalter"
    );

    let erinnerung: (i64, String, Option<String>, Option<String>, String, String) = sqlx::query_as(
        "SELECT id, titel, beschreibung, empfaenger_funktion, faellig_at, status \
                 FROM erinnerung WHERE id = ?",
    )
    .bind(erinnerung_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(
        erinnerung,
        (
            erinnerung_id,
            SCHWAERZUNG_PLATZHALTER.to_string(),
            None,
            None,
            "2026-01-01 12:00:00".to_string(),
            "offen".to_string()
        ),
        "Erinnerung: Titel Platzhalter, Beschreibung und Empfänger NULL, Termin/Status bleiben"
    );

    let anhaenge: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM anhang WHERE einsatz_id = ?")
        .bind(eid)
        .fetch_one(&pool)
        .await
        .unwrap();
    let verknuepfungen: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM chat_nachricht_anhang")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(
        (anhaenge, verknuepfungen),
        (0, 0),
        "Chat-Anhang samt Verknüpfung weg"
    );

    // Der Audit ist ein bleibender, rechtsverbindlicher ETB-Eintrag: er darf nur
    // behaupten, was die Registry tut — die FREITEXTE gehen, die Datensätze bleiben.
    let audit: String = sqlx::query_scalar(
        "SELECT inhalt FROM etb_eintrag \
             WHERE einsatz_id = ? AND inhalt LIKE 'PII-Schwärzung durchgeführt%'",
    )
    .bind(eid)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert!(
        audit.contains("Freitexte von Chat-Kanälen, Chat-Nachrichten und Erinnerungen"),
        "Audit nennt die Chat-/Erinnerungs-Freitexte als entfernt: {audit}"
    );
    assert!(
        audit.contains("die Struktur von Chat, Erinnerungen und Führungsmodulen"),
        "Audit nennt die erhaltene Struktur: {audit}"
    );
    assert!(
        !audit.contains("sowie Chat-Kanäle, Chat-Nachrichten und Erinnerungen)"),
        "kein Overclaim, die Datensätze seien entfernt: {audit}"
    );
}

#[tokio::test]
async fn schwaerzung_entfernt_fuehrungs_freitexte_und_haelt_das_etb() {
    // LFH-701, Linie A: Die Führungsdokumentation ist das ETB. Die Freitexte der
    // Führungsmodule (Meldung, Auftrag samt Empfänger, Nachforderung, Lagebericht, Befehl,
    // Lagebesprechung) werden geschwärzt, auch die, die nie ins ETB
    // gelangt sind (Fünf-Punkte-Felder, Entwürfe), samt Ablehnungsgrund und Ziel als Freitext
    // (LLH-1385). Struktur bleibt, der ETB-Wortlaut auch.
    let pool = crate::db::test_pool().await;
    let (eid, leit) = schwaerzbarer_einsatz(&pool).await;
    let etb_id: i64 = sqlx::query_scalar(
        "INSERT INTO etb_eintrag (einsatz_id, lfd_nr, typ, inhalt, von, an, meldeweg, \
                erfasser_id, ereigniszeit) \
             VALUES (?, 900, 'meldung', 'Fam. Yilmaz, Hauptstr. 5, Tochter vermisst', \
                'Anrufer Herr Krause', 'S2 Frau Lang', 'telefon', ?, '2026-01-01 10:00:00') \
             RETURNING id",
    )
    .bind(eid)
    .bind(leit)
    .fetch_one(&pool)
    .await
    .unwrap();
    let meldung_id: i64 = sqlx::query_scalar(
        "INSERT INTO meldung (einsatz_id, lfd_nr, absender, empfaenger, meldeweg, inhalt, \
                ereigniszeit, eingang_at, etb_meldung_id, erfasst_von_id) \
             VALUES (?, 1, 'Anrufer Herr Krause', 'S2 Frau Lang', 'telefon', \
                'Fam. Yilmaz, Hauptstr. 5, Tochter vermisst', '2026-01-01 10:00:00', \
                '2026-01-01 10:00:00', ?, ?) RETURNING id",
    )
    .bind(eid)
    .bind(etb_id)
    .bind(leit)
    .fetch_one(&pool)
    .await
    .unwrap();
    let auftrag_id: i64 = sqlx::query_scalar(
        "INSERT INTO auftrag (einsatz_id, lfd_nr, auftrag_text, absicht, lage, ort, zeit, \
                mittel, verbindung, sicherheit, weg, vollzugsmeldung, erteilt_at, erstellt_von_id) \
             VALUES (?, 1, 'Fam. Yilmaz evakuieren', 'Tochter Yilmaz finden', \
                'Herr Krause meldet Keller unter Wasser', 'Hauptstr. 5', 'sofort', 'Boot', \
                'Tel. 0170 333', 'Hund im Haus', 'über den Hof von Fam. Yilmaz', \
                'Fam. Yilmaz übergeben an Klinikum', \
                '2026-01-01 10:05:00', ?) RETURNING id",
    )
    .bind(eid)
    .bind(leit)
    .fetch_one(&pool)
    .await
    .unwrap();
    let empfaenger_id: i64 = sqlx::query_scalar(
        "INSERT INTO auftrag_empfaenger (auftrag_id, empfaenger_typ, funktion_text, \
                extern_kategorie, extern_bezeichnung, snap_anzeige) \
             VALUES (?, 'extern', 'Herr Peters (Ortsbürgermeister)', NULL, \
                'Herr Peters, Bürgerbüro', 'Herr Peters, Bürgerbüro') RETURNING id",
    )
    .bind(auftrag_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    let nachforderung_id: i64 = sqlx::query_scalar(
        "INSERT INTO nachforderung (einsatz_id, art, bezeichnung, adressat_kategorie, \
                adressat_bezeichnung, begruendung, status, abgelehnt_at, abgelehnt_grund, \
                angefordert_at, erstellt_von_id, ziel_text) \
             VALUES (?, 'Dolmetscher', 'Dolmetscher für Fam. Yilmaz', 'leitstelle', \
                'Leitstelle Nord, Herr Kurz', 'Frau Yilmaz spricht kein Deutsch', 'abgelehnt', \
                '2026-01-01 11:00:00', 'Herr Kurz nicht erreichbar', '2026-01-01 10:30:00', ?, \
                'Wohnung Fam. Yilmaz, Hauptstr. 5') \
             RETURNING id",
    )
    .bind(eid)
    .bind(leit)
    .fetch_one(&pool)
    .await
    .unwrap();
    let mut dokumente = Vec::new();
    for (tabelle, vorlage, status) in [
        ("lagebericht", "lagebericht", "freigegeben"),
        ("lagebericht", "lagebericht", "entwurf"),
        ("befehl", "befehl_lad", "entwurf"),
    ] {
        let id: i64 = sqlx::query_scalar(sqlx::AssertSqlSafe(format!(
            "INSERT INTO {tabelle} (einsatz_id, vorlage, titel, zeitstand, status, \
                    abschnitte, ersteller_id) \
                 VALUES (?, ?, 'Lage Fam. Yilmaz', '2026-01-01 12:00:00', ?, \
                    '[{{\"schluessel\":\"lage\",\"text\":\"Fam. Yilmaz im Keller\"}}]', ?) \
                 RETURNING id"
        )))
        .bind(eid)
        .bind(vorlage)
        .bind(status)
        .bind(leit)
        .fetch_one(&pool)
        .await
        .unwrap();
        dokumente.push((tabelle, id));
    }
    // Freigabe-Snapshot des freigegebenen Lageberichts im ETB (wie `render_snapshot`).
    let snapshot =
        "# Lage Fam. Yilmaz\n_Zeitstand: 2026-01-01 12:00:00_\n\n## Lage\nFam. Yilmaz im Keller";
    let snapshot_etb_id: i64 = sqlx::query_scalar(
        "INSERT INTO etb_eintrag (einsatz_id, lfd_nr, typ, inhalt, erfasser_id, ereigniszeit, \
                lagebericht_id) \
             VALUES (?, 901, 'lage', ?, ?, '2026-01-01 12:00:00', ?) RETURNING id",
    )
    .bind(eid)
    .bind(snapshot)
    .bind(leit)
    .bind(dokumente[0].1)
    .fetch_one(&pool)
    .await
    .unwrap();
    sqlx::query("UPDATE lagebericht SET etb_eintrag_id = ? WHERE id = ?")
        .bind(snapshot_etb_id)
        .bind(dokumente[0].1)
        .execute(&pool)
        .await
        .unwrap();
    let besprechung_id: i64 = sqlx::query_scalar(
        "INSERT INTO einsatz_lagebesprechung (einsatz_id, lfd_nr, abgehalten_at, entschluss, \
                etb_eintrag_id, erfasst_von_id) \
             VALUES (?, 1, '2026-01-01 13:00:00', 'Fam. Yilmaz bleibt in der Notunterkunft', \
                ?, ?) RETURNING id",
    )
    .bind(eid)
    .bind(etb_id)
    .bind(leit)
    .fetch_one(&pool)
    .await
    .unwrap();

    assert!(schwaerze_einsatz(&pool, eid, "2026-02-01 00:00:00")
        .await
        .unwrap());

    let p = || SCHWAERZUNG_PLATZHALTER.to_string();
    let meldung: (i64, String, Option<String>, String, String, String) = sqlx::query_as(
        "SELECT lfd_nr, absender, empfaenger, meldeweg, inhalt, status FROM meldung \
             WHERE id = ?",
    )
    .bind(meldung_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(
        meldung,
        (1, p(), None, "telefon".into(), p(), "neu".into()),
        "Meldung: Freitexte weg, Nummer/Meldeweg/Status bleiben"
    );

    type AuftragZeile = (Option<i64>, String, [Option<String>; 9], String);
    let a: (
        Option<i64>,
        String,
        Option<String>,
        Option<String>,
        Option<String>,
        Option<String>,
        Option<String>,
        Option<String>,
        Option<String>,
        Option<String>,
        Option<String>,
        String,
    ) = sqlx::query_as(
        "SELECT lfd_nr, auftrag_text, absicht, lage, ort, zeit, mittel, verbindung, \
                sicherheit, weg, vollzugsmeldung, erteilt_at FROM auftrag WHERE id = ?",
    )
    .bind(auftrag_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    let auftrag: AuftragZeile = (
        a.0,
        a.1,
        [a.2, a.3, a.4, a.5, a.6, a.7, a.8, a.9, a.10],
        a.11,
    );
    assert_eq!(
        auftrag,
        (
            Some(1),
            p(),
            Default::default(),
            "2026-01-01 10:05:00".to_string()
        ),
        "Auftrag: Auftragstext Platzhalter, Fünf-Punkte und Vollzug NULL, Struktur bleibt"
    );

    let empfaenger: (String, Option<String>, Option<String>, String) = sqlx::query_as(
        "SELECT empfaenger_typ, funktion_text, extern_bezeichnung, snap_anzeige \
             FROM auftrag_empfaenger WHERE id = ?",
    )
    .bind(empfaenger_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(
        empfaenger,
        ("extern".into(), None, None, p()),
        "Auftragsempfänger: Klartext und Snapshot weg, Typ bleibt"
    );

    let nachforderung: (
        String,
        String,
        Option<String>,
        Option<String>,
        String,
        Option<String>,
        Option<String>,
    ) = sqlx::query_as(
        "SELECT art, bezeichnung, adressat_bezeichnung, begruendung, status, \
                abgelehnt_grund, ziel_text FROM nachforderung WHERE id = ?",
    )
    .bind(nachforderung_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(
        nachforderung,
        (p(), p(), None, None, "abgelehnt".into(), None, None),
        "Nachforderung: Freitexte weg, auch Ablehnungsgrund und Ziel als Freitext"
    );

    for (tabelle, id) in &dokumente {
        let dok: (String, String, String, String) = sqlx::query_as(sqlx::AssertSqlSafe(format!(
            "SELECT titel, zeitstand, status, abschnitte FROM {tabelle} WHERE id = ?"
        )))
        .bind(id)
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(
            (dok.0, dok.1, dok.3),
            (p(), "2026-01-01 12:00:00".to_string(), "[]".to_string()),
            "{tabelle} ({}): Titel Platzhalter, Abschnitte leer, Zeitstand bleibt",
            dok.2
        );
    }

    let entschluss: String =
        sqlx::query_scalar("SELECT entschluss FROM einsatz_lagebesprechung WHERE id = ?")
            .bind(besprechung_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(entschluss, p(), "Entschluss der Lagebesprechung geschwärzt");

    // Der ETB-Wortlaut ist die Führungsdokumentation und bleibt vollständig.
    let etb: (String, Option<String>, Option<String>) =
        sqlx::query_as("SELECT inhalt, von, an FROM etb_eintrag WHERE id = ?")
            .bind(etb_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(
        etb,
        (
            "Fam. Yilmaz, Hauptstr. 5, Tochter vermisst".to_string(),
            Some("Anrufer Herr Krause".to_string()),
            Some("S2 Frau Lang".to_string())
        ),
        "ETB-Eintrag behält den Wortlaut"
    );
    let snapshot_nachher: String =
        sqlx::query_scalar("SELECT inhalt FROM etb_eintrag WHERE id = ?")
            .bind(snapshot_etb_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(
        snapshot_nachher, snapshot,
        "Freigabe-Snapshot des Lageberichts bleibt im ETB"
    );

    let audit: String = sqlx::query_scalar(
        "SELECT inhalt FROM etb_eintrag \
             WHERE einsatz_id = ? AND inhalt LIKE 'PII-Schwärzung durchgeführt%'",
    )
    .bind(eid)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert!(
        audit.contains(
            "Freitexte der Führungsmodule (Meldungen, Aufträge, Nachforderungen, \
                 Lageberichte, Befehle, Lagebesprechungen))"
        ),
        "Audit nennt die Führungs-Freitexte als entfernt: {audit}"
    );
    assert!(
        audit.contains("die Führungsdokumentation im ETB im Wortlaut"),
        "Audit nennt das ETB als erhaltene Führungsdokumentation: {audit}"
    );
    assert!(
        !audit.contains("ETB, Meldungen, Aufträge"),
        "kein Overclaim, Meldungen und Aufträge blieben als Text: {audit}"
    );
}

#[tokio::test]
async fn schwaerzung_nullt_sprechgruppen_hinweis_nur_einsatz_lokal() {
    // LFH-140: `sprechgruppe.hinweis` ist ein Freitext-Zettel („Ansprechpartner Herr
    // Müller …“) und wird genullt — aber NUR an einsatz-lokalen Sprechgruppen. Der
    // org-weite Katalog (einsatz_id NULL) gehört keinem Einsatz und bleibt unberührt;
    // `bezeichnung` ist Funkgruppen-Label (G_OP_LABEL) und bleibt überall.
    let pool = crate::db::test_pool().await;
    let (eid, _) = schwaerzbarer_einsatz(&pool).await;
    let org_id: i64 = sqlx::query_scalar("SELECT org_id FROM einsatz WHERE id = ?")
        .bind(eid)
        .fetch_one(&pool)
        .await
        .unwrap();
    let lokal: i64 = sqlx::query_scalar(
        "INSERT INTO sprechgruppe (org_id, einsatz_id, bezeichnung, betriebsart, hinweis) \
             VALUES (?, ?, 'TMO_EINSATZ_1', 'TMO', 'Ansprechpartner Herr Müller 0170 111') \
             RETURNING id",
    )
    .bind(org_id)
    .bind(eid)
    .fetch_one(&pool)
    .await
    .unwrap();
    let katalog: i64 = sqlx::query_scalar(
        "INSERT INTO sprechgruppe (org_id, einsatz_id, bezeichnung, betriebsart, hinweis) \
             VALUES (?, NULL, 'TMO_KATALOG', 'TMO', 'Nur für Großlagen') RETURNING id",
    )
    .bind(org_id)
    .fetch_one(&pool)
    .await
    .unwrap();

    assert!(schwaerze_einsatz(&pool, eid, "2026-02-01 00:00:00")
        .await
        .unwrap());

    let lies = |id: i64| {
        let pool = pool.clone();
        async move {
            sqlx::query_as::<_, (String, Option<String>)>(
                "SELECT bezeichnung, hinweis FROM sprechgruppe WHERE id = ?",
            )
            .bind(id)
            .fetch_one(&pool)
            .await
            .unwrap()
        }
    };
    assert_eq!(
        lies(lokal).await,
        ("TMO_EINSATZ_1".to_string(), None),
        "einsatz-lokal: Hinweis NULL, Bezeichnung bleibt"
    );
    assert_eq!(
        lies(katalog).await,
        (
            "TMO_KATALOG".to_string(),
            Some("Nur für Großlagen".to_string())
        ),
        "Gegenprobe org-weiter Katalog: Hinweis bleibt"
    );
}

#[tokio::test]
async fn schwaerzung_nullt_alle_abschnitts_freitexte_und_haelt_die_labels() {
    // LFH-140, AK „kein Freitext überlebt“: bemerkung und (LFH-608) abschnittsauftrag
    // werden NULL. Retain bleiben name, kurzbezeichnung und die eingefrorenen Alt-Spalten
    // sprechgruppe_tmo/_dmo — Letzteres ist die Entscheidung des Auftraggebers
    // (Funkgruppen-Label, konsistent mit `sprechgruppe.bezeichnung`).
    let pool = crate::db::test_pool().await;
    let (eid, _) = schwaerzbarer_einsatz(&pool).await;
    let aid: i64 = sqlx::query_scalar(
        "INSERT INTO einsatzabschnitt (einsatz_id, name, kurzbezeichnung, bemerkung, \
                abschnittsauftrag, sprechgruppe_tmo, sprechgruppe_dmo) \
             VALUES (?, 'Nord', 'EA-N', 'Fam. Weber evakuiert', \
                'Evakuierung Uferstraße 3, Familie Schulz', 'TMO_NORD', 'DMO_NORD') \
             RETURNING id",
    )
    .bind(eid)
    .fetch_one(&pool)
    .await
    .unwrap();

    assert!(schwaerze_einsatz(&pool, eid, "2026-02-01 00:00:00")
        .await
        .unwrap());

    #[allow(clippy::type_complexity)]
    let zeile: (
        Option<String>,
        Option<String>,
        String,
        Option<String>,
        Option<String>,
        Option<String>,
    ) = sqlx::query_as(
        "SELECT bemerkung, abschnittsauftrag, \
                    name, kurzbezeichnung, sprechgruppe_tmo, sprechgruppe_dmo \
             FROM einsatzabschnitt WHERE id = ?",
    )
    .bind(aid)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(
        zeile,
        (
            None,
            None,
            "Nord".to_string(),
            Some("EA-N".to_string()),
            Some("TMO_NORD".to_string()),
            Some("DMO_NORD".to_string()),
        ),
        "Freitexte NULL; Name, Kürzel und TMO/DMO bleiben"
    );
}

#[tokio::test]
async fn schwaerzung_ersetzt_den_namen_der_kartenansicht() {
    // LFH-283: der Ansichts-Name kann PII tragen („Lage Fam. Müller“) → Platzhalter
    // (NOT NULL); die Konfiguration (Zentrum, Zoom) bleibt.
    let pool = crate::db::test_pool().await;
    let (eid, leit) = schwaerzbarer_einsatz(&pool).await;
    let ansicht: i64 = sqlx::query_scalar(
        "INSERT INTO karten_ansicht (einsatz_id, name, zentrum_lat, zoom, erstellt_von) \
             VALUES (?, 'Lage Fam. Müller', 52.1, 14.0, ?) RETURNING id",
    )
    .bind(eid)
    .bind(leit)
    .fetch_one(&pool)
    .await
    .unwrap();

    assert!(schwaerze_einsatz(&pool, eid, "2026-02-01 00:00:00")
        .await
        .unwrap());

    let (name, lat, zoom): (String, Option<f64>, Option<f64>) =
        sqlx::query_as("SELECT name, zentrum_lat, zoom FROM karten_ansicht WHERE id = ?")
            .bind(ansicht)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(
        (name.as_str(), lat, zoom),
        (SCHWAERZUNG_PLATZHALTER, Some(52.1), Some(14.0))
    );
}

#[tokio::test]
async fn schwaerzung_loescht_den_lage_snapshot() {
    // LFH-283: ein Lage-Snapshot friert das volle Lagebild samt PII ein (`daten`) und
    // hat keine ETB-Kopplung → die ganze Zeile geht weg.
    let pool = crate::db::test_pool().await;
    let (eid, leit) = schwaerzbarer_einsatz(&pool).await;
    sqlx::query(
            "INSERT INTO lage_snapshot (einsatz_id, bezeichnung, notiz, stand_at, daten, erstellt_von) \
             VALUES (?, 'Stand 14 Uhr', 'Fam. Müller noch im Haus', '2026-01-01 14:00:00', \
                '{\"personen\":[\"Müller\"]}', ?)",
        )
        .bind(eid)
        .bind(leit)
        .execute(&pool)
        .await
        .unwrap();

    assert!(schwaerze_einsatz(&pool, eid, "2026-02-01 00:00:00")
        .await
        .unwrap());

    let anzahl: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM lage_snapshot WHERE einsatz_id = ?")
        .bind(eid)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(anzahl, 0, "Snapshot-Zeile samt Lagebild weg");
}

/// Setzt die Org-Retention-Dauer direkt in der DB (reiner Repo-Test).
async fn setze_org_dauer(pool: &SqlitePool, org_id: i64, bid: i64, tage: i64) {
    crate::org::einstellungen::speichern(
        pool,
        org_id,
        bid,
        crate::org::einstellungen::OrgEinstellungenDaten {
            retention_dauer_tage: Some(tage),
            ..Default::default()
        },
    )
    .await
    .unwrap();
}

#[tokio::test]
async fn abschliessen_befuellt_retention_bis_aus_dauer_und_schreibt_audit() {
    let pool = crate::db::test_pool().await;
    let leit = benutzer_anlegen(&pool, "leit").await;
    let einsatz = test_anlegen(&pool, "Lage", None, leit).await.unwrap();
    setze_dauer(&pool, einsatz.id, leit, 30).await;

    let abgeschlossen = abschliessen(&pool, einsatz.id, leit).await.unwrap().einsatz;
    // retention_bis = abgeschlossen_at + 30 Tage (gleiche Uhrzeit, kanonisches Format).
    let erwartet = super::super::retention::berechne_retention_bis(
        abgeschlossen.abgeschlossen_at.as_deref().unwrap(),
        30,
    )
    .unwrap();
    assert_eq!(
        abgeschlossen.retention_bis.as_deref(),
        Some(erwartet.as_str())
    );
    // LFH-906: die Frist gilt als beim Abschluss gesetzt (Karenz-Beginn ab ihrem Ablauf).
    assert_eq!(
        retention_gesetzt_at(&pool, einsatz.id).await,
        abgeschlossen.abgeschlossen_at
    );

    // Ein ETB-System-Audit über die Auto-Frist entstanden.
    let anzahl: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM etb_eintrag WHERE einsatz_id = ? AND typ = 'system' \
             AND inhalt LIKE 'Aufbewahrungsfrist automatisch gesetzt%'",
    )
    .bind(einsatz.id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(anzahl, 1);
}

#[tokio::test]
async fn abschliessen_ohne_dauer_setzt_keine_frist() {
    let pool = crate::db::test_pool().await;
    let leit = benutzer_anlegen(&pool, "leit").await;
    let einsatz = test_anlegen(&pool, "Lage", None, leit).await.unwrap();

    let abgeschlossen = abschliessen(&pool, einsatz.id, leit).await.unwrap().einsatz;
    assert_eq!(abgeschlossen.retention_bis, None);
}

/// Einsatz-Override NULL, Org-Default=30 → Effektivwert 30 → retention_bis gesetzt.
#[tokio::test]
async fn abschliessen_org_default_befuellt_retention_bis() {
    let pool = crate::db::test_pool().await;
    let leit = benutzer_anlegen(&pool, "leit").await;
    let einsatz = test_anlegen(&pool, "Lage", None, leit).await.unwrap();
    // Kein Einsatz-Override; Org-Default=30.
    setze_org_dauer(&pool, einsatz.org_id, leit, 30).await;

    let abgeschlossen = abschliessen(&pool, einsatz.id, leit).await.unwrap().einsatz;
    let erwartet = super::super::retention::berechne_retention_bis(
        abgeschlossen.abgeschlossen_at.as_deref().unwrap(),
        30,
    )
    .unwrap();
    assert_eq!(
        abgeschlossen.retention_bis.as_deref(),
        Some(erwartet.as_str()),
        "Org-Default (30) soll greifen wenn kein Einsatz-Override gesetzt"
    );
}

/// Einsatz-Override=60 schlägt Org-Default=30 → Effektivwert 60.
#[tokio::test]
async fn abschliessen_einsatz_dauer_schlaegt_org_default() {
    let pool = crate::db::test_pool().await;
    let leit = benutzer_anlegen(&pool, "leit").await;
    let einsatz = test_anlegen(&pool, "Lage", None, leit).await.unwrap();
    setze_dauer(&pool, einsatz.id, leit, 60).await;
    setze_org_dauer(&pool, einsatz.org_id, leit, 30).await;

    let abgeschlossen = abschliessen(&pool, einsatz.id, leit).await.unwrap().einsatz;
    let erwartet = super::super::retention::berechne_retention_bis(
        abgeschlossen.abgeschlossen_at.as_deref().unwrap(),
        60,
    )
    .unwrap();
    assert_eq!(
        abgeschlossen.retention_bis.as_deref(),
        Some(erwartet.as_str()),
        "Einsatz-Override (60) soll Org-Default (30) schlagen"
    );
}

#[tokio::test]
async fn abschliessen_ueberschreibt_manuelle_frist_nicht() {
    let pool = crate::db::test_pool().await;
    let leit = benutzer_anlegen(&pool, "leit").await;
    let einsatz = test_anlegen(&pool, "Lage", None, leit).await.unwrap();
    setze_dauer(&pool, einsatz.id, leit, 30).await;
    // Manuell gesetzte Frist VOR Abschluss.
    frist_setzen(
        &pool,
        einsatz.id,
        leit,
        Some("2099-01-01 00:00:00"),
        "manuell",
        Utc::now(),
    )
    .await
    .unwrap();

    let abgeschlossen = abschliessen(&pool, einsatz.id, leit).await.unwrap().einsatz;
    // Auto-Fill darf die manuelle Frist nicht überschreiben.
    assert_eq!(
        abgeschlossen.retention_bis.as_deref(),
        Some("2099-01-01 00:00:00")
    );
}

#[tokio::test]
async fn frist_setzen_speichert_und_schreibt_etb_audit() {
    let pool = crate::db::test_pool().await;
    let leit = benutzer_anlegen(&pool, "leit").await;
    let einsatz = test_anlegen(&pool, "Lage", None, leit).await.unwrap();
    assert_eq!(einsatz.retention_bis, None);

    let aktualisiert = frist_setzen(
        &pool,
        einsatz.id,
        leit,
        Some("2030-01-01 00:00:00"),
        "Aufbewahrungsfrist gesetzt auf 010100jan30",
        Utc::now(),
    )
    .await
    .unwrap()
    .einsatz;
    assert_eq!(
        aktualisiert.retention_bis.as_deref(),
        Some("2030-01-01 00:00:00")
    );

    // Genau ein ETB-System-Eintrag als Audit entstanden.
    let anzahl: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM etb_eintrag WHERE einsatz_id = ? AND typ = 'system'",
    )
    .bind(einsatz.id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(anzahl, 1);
}

#[tokio::test]
async fn faellige_soft_delete_nur_abgeschlossen_abgelaufen_offen() {
    let pool = crate::db::test_pool().await;
    let leit = benutzer_anlegen(&pool, "leit").await;

    // (1) abgeschlossen + Frist abgelaufen + nicht gelöscht → fällig.
    let faellig: i64 = sqlx::query_scalar(
        "INSERT INTO einsatz (org_id, bezeichnung, status, abgeschlossen_von, retention_bis) \
             VALUES (1,'Faellig','abgeschlossen', ?, '2026-01-01 00:00:00') RETURNING id",
    )
    .bind(leit)
    .fetch_one(&pool)
    .await
    .unwrap();
    // (2) AKTIV mit abgelaufener Frist → NIE fällig (harter status-Guard).
    sqlx::query(
        "INSERT INTO einsatz (org_id, bezeichnung, status, retention_bis) \
             VALUES (1,'Aktiv','aktiv','2026-01-01 00:00:00')",
    )
    .execute(&pool)
    .await
    .unwrap();
    // (3) abgeschlossen, Frist NICHT abgelaufen → nicht fällig.
    sqlx::query(
        "INSERT INTO einsatz (org_id, bezeichnung, status, abgeschlossen_von, retention_bis) \
             VALUES (1,'Zukunft','abgeschlossen', ?, '2099-01-01 00:00:00')",
    )
    .bind(leit)
    .execute(&pool)
    .await
    .unwrap();
    // (4) abgeschlossen, keine Frist → nicht fällig.
    sqlx::query(
        "INSERT INTO einsatz (org_id, bezeichnung, status, abgeschlossen_von) \
             VALUES (1,'OhneFrist','abgeschlossen', ?)",
    )
    .bind(leit)
    .execute(&pool)
    .await
    .unwrap();
    // (5) abgeschlossen, abgelaufen, ABER schon soft-gelöscht → nicht erneut fällig.
    sqlx::query(
            "INSERT INTO einsatz (org_id, bezeichnung, status, abgeschlossen_von, retention_bis, geloescht_at) \
             VALUES (1,'Schon','abgeschlossen', ?, '2026-01-01 00:00:00','2026-02-01 00:00:00')",
        )
        .bind(leit)
        .execute(&pool)
        .await
        .unwrap();

    let ids = faellige_soft_delete(&pool, "2026-06-01 00:00:00")
        .await
        .unwrap();
    assert_eq!(
        ids,
        vec![faellig],
        "nur der abgeschlossene, abgelaufene, offene Einsatz"
    );

    // soft_delete_einsatz kippt den Tombstone + ist idempotent (zweiter Aufruf false).
    assert!(soft_delete_einsatz(&pool, faellig, "2026-06-01 00:00:00")
        .await
        .unwrap());
    assert!(!soft_delete_einsatz(&pool, faellig, "2026-06-02 00:00:00")
        .await
        .unwrap());
    let g: Option<String> = sqlx::query_scalar("SELECT geloescht_at FROM einsatz WHERE id = ?")
        .bind(faellig)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(g.as_deref(), Some("2026-06-01 00:00:00"));
}

#[tokio::test]
async fn frist_setzen_none_hebt_frist_auf() {
    let pool = crate::db::test_pool().await;
    let leit = benutzer_anlegen(&pool, "leit").await;
    let einsatz = test_anlegen(&pool, "Lage", None, leit).await.unwrap();
    frist_setzen(
        &pool,
        einsatz.id,
        leit,
        Some("2030-01-01 00:00:00"),
        "set",
        Utc::now(),
    )
    .await
    .unwrap();

    let aufgehoben = frist_setzen(&pool, einsatz.id, leit, None, "aufgehoben", Utc::now())
        .await
        .unwrap()
        .einsatz;
    assert_eq!(aufgehoben.retention_bis, None);
}

/// LFH-906: `frist_setzen` merkt sich den Zeitpunkt des Setzens. Eine Frist in die
/// Vergangenheit behält so die volle Karenz ab dem Setzen (Phase A, D1).
#[tokio::test]
async fn frist_setzen_merkt_sich_den_zeitpunkt_des_setzens() {
    let pool = crate::db::test_pool().await;
    let leit = benutzer_anlegen(&pool, "leit").await;
    let einsatz = test_anlegen(&pool, "Lage", None, leit).await.unwrap();
    frist_setzen(
        &pool,
        einsatz.id,
        leit,
        Some("2026-01-01 00:00:00"),
        "verkürzt",
        zeit("2026-06-30 12:00:00"),
    )
    .await
    .unwrap();
    assert_eq!(
        retention_gesetzt_at(&pool, einsatz.id).await.as_deref(),
        Some("2026-06-30 12:00:00")
    );
}

async fn retention_gesetzt_at(pool: &SqlitePool, einsatz_id: i64) -> Option<String> {
    sqlx::query_scalar("SELECT retention_gesetzt_at FROM einsatz WHERE id = ?")
        .bind(einsatz_id)
        .fetch_one(pool)
        .await
        .unwrap()
}

#[tokio::test]
async fn setze_rolle_legt_an_und_aktualisiert() {
    let pool = crate::db::test_pool().await;
    let leit = benutzer_anlegen(&pool, "leit").await;
    let erika = benutzer_anlegen(&pool, "erika").await;
    let einsatz = test_anlegen(&pool, "Lage", None, leit).await.unwrap();

    setze_rolle(&pool, einsatz.id, erika, EinsatzRolle::Beobachter)
        .await
        .unwrap();
    assert_eq!(
        rolle_von(&pool, einsatz.id, erika).await.unwrap(),
        Some(EinsatzRolle::Beobachter)
    );

    // Upsert: dieselbe (einsatz, benutzer)-Kombination aktualisiert die Rolle.
    setze_rolle(&pool, einsatz.id, erika, EinsatzRolle::Fuehrungspersonal)
        .await
        .unwrap();
    assert_eq!(
        rolle_von(&pool, einsatz.id, erika).await.unwrap(),
        Some(EinsatzRolle::Fuehrungspersonal)
    );
}

#[tokio::test]
async fn entferne_loescht_mitgliedschaft() {
    let pool = crate::db::test_pool().await;
    let leit = benutzer_anlegen(&pool, "leit").await;
    let erika = benutzer_anlegen(&pool, "erika").await;
    let einsatz = test_anlegen(&pool, "Lage", None, leit).await.unwrap();
    setze_rolle(&pool, einsatz.id, erika, EinsatzRolle::Beobachter)
        .await
        .unwrap();

    entferne(&pool, einsatz.id, erika).await.unwrap();
    assert_eq!(rolle_von(&pool, einsatz.id, erika).await.unwrap(), None);
}

#[tokio::test]
async fn zaehle_einsatzleitung_zaehlt_nur_leitungen() {
    let pool = crate::db::test_pool().await;
    let leit = benutzer_anlegen(&pool, "leit").await;
    let erika = benutzer_anlegen(&pool, "erika").await;
    let einsatz = test_anlegen(&pool, "Lage", None, leit).await.unwrap();
    setze_rolle(&pool, einsatz.id, erika, EinsatzRolle::Beobachter)
        .await
        .unwrap();

    assert_eq!(zaehle_einsatzleitung(&pool, einsatz.id).await.unwrap(), 1);

    setze_rolle(&pool, einsatz.id, erika, EinsatzRolle::Einsatzleitung)
        .await
        .unwrap();
    assert_eq!(zaehle_einsatzleitung(&pool, einsatz.id).await.unwrap(), 2);
}

/// Lädt den vollständigen `Benutzer`-Datensatz per id (für die Lese-Policy).
async fn benutzer_laden(pool: &SqlitePool, id: i64) -> Benutzer {
    sqlx::query_as::<_, Benutzer>("SELECT * FROM benutzer WHERE id = ?")
        .bind(id)
        .fetch_one(pool)
        .await
        .unwrap()
}

#[tokio::test]
async fn liste_fuer_annotiert_meine_rolle() {
    let pool = crate::db::test_pool().await;
    let leit = benutzer_anlegen(&pool, "leit").await;
    let fremd = benutzer_anlegen(&pool, "fremd").await;
    let einsatz = test_anlegen(&pool, "Lage", None, leit).await.unwrap();

    // Ersteller sieht sich als Einsatzleitung.
    let leit_benutzer = benutzer_laden(&pool, leit).await;
    let fuer_leit = liste_fuer(&pool, &leit_benutzer).await.unwrap();
    assert_eq!(fuer_leit.len(), 1);
    assert_eq!(fuer_leit[0].id, einsatz.id);
    assert_eq!(
        fuer_leit[0].meine_rolle.as_deref(),
        Some(EINSATZ_ROLLE_LEITUNG)
    );

    // Nicht-Mitglied ohne höhere Berechtigung sieht den Einsatz NICHT (DSGVO-Filter).
    let fremd_benutzer = benutzer_laden(&pool, fremd).await;
    let fuer_fremd = liste_fuer(&pool, &fremd_benutzer).await.unwrap();
    assert!(fuer_fremd.is_empty());
}

/// Legt einen Einsatz mit fester ID per SQL an — die ID-Vergabe von [`anlegen_tx`]
/// soll hier gegen einen bekannten Höchstwert laufen, nicht gegen die eigene.
async fn einsatz_mit_id(pool: &SqlitePool, id: i64) {
    sqlx::query("INSERT INTO einsatz (id, org_id, bezeichnung) VALUES (?, 1, 'Bestand')")
        .bind(id)
        .execute(pool)
        .await
        .unwrap();
}

/// Kopf eines (entfernten) Demo-Imports per SQL — `einsatz_id` ohne FK, wie in der
/// Historie nach dem Entfernen (LFH-690 D6).
async fn demo_historie(pool: &SqlitePool, einsatz_id: i64) {
    sqlx::query(
        "INSERT INTO demo_import (org_id, einsatz_id, entfernt_at, bericht) \
             VALUES (1, ?, datetime('now'), '{}')",
    )
    .bind(einsatz_id)
    .execute(pool)
    .await
    .unwrap();
}

/// LFH-690 D6: Die ID eines entfernten Demo-Einsatzes wird nie wiedervergeben. Höchste
/// Einsatz-ID 5, Demo-Historie mit ID 7 → der neue Einsatz bekommt 8, nicht 6. Die Sperre
/// hebt nur an: liegt die Historie darunter, gilt wieder der Höchstwert der Einsätze.
#[tokio::test]
async fn anlegen_ueberspringt_die_id_eines_entfernten_demo_einsatzes() {
    let pool = crate::db::test_pool().await;
    let leit = benutzer_anlegen(&pool, "leit").await;
    einsatz_mit_id(&pool, 5).await;
    demo_historie(&pool, 7).await;

    let neu = test_anlegen(&pool, "Echter Einsatz", None, leit)
        .await
        .unwrap();
    assert_eq!(
        neu.id, 8,
        "über der gesperrten Demo-ID 7, nicht MAX(id)+1 = 6"
    );

    let danach = test_anlegen(&pool, "Nächster", None, leit).await.unwrap();
    assert_eq!(
        danach.id, 9,
        "Historie unter dem Höchstwert erzeugt keine Lücke"
    );
}

/// LFH-690 D6: Ohne Demo-Historie ist die Vergabe dieselbe wie SQLites eigene
/// (`MAX(rowid)+1`) — für Bestandsinstanzen ändert sich nichts. Läuft direkt über
/// [`anlegen_tx`] auf einer Transaktion des Aufrufers.
#[tokio::test]
async fn anlegen_tx_ohne_demo_historie_vergibt_ohne_luecke() {
    let pool = crate::db::test_pool().await;
    let leit = benutzer_anlegen(&pool, "leit").await;
    einsatz_mit_id(&pool, 5).await;

    let mut tx = pool.begin().await.unwrap();
    let id = anlegen_tx(
        &mut tx,
        &NeuerEinsatzDaten {
            bezeichnung: "Echter Einsatz",
            stichwort: None,
            einsatzart: None,
            begonnen_at: None,
            ort: Default::default(),
            vorlage_id: None,
        },
        leit,
        Utc::now(),
    )
    .await
    .unwrap();
    tx.commit().await.unwrap();

    assert_eq!(id, 6);
    let rolle = rolle_von(&pool, id, leit).await.unwrap();
    assert_eq!(rolle, Some(EinsatzRolle::Einsatzleitung));
}

#[tokio::test]
async fn anlegen_vergibt_fortlaufende_einsatznummer() {
    let pool = crate::db::test_pool().await;
    let leit = benutzer_anlegen(&pool, "leit").await;

    let jahr = crate::einsatz::nummer::jahr_in_zone(chrono::Utc::now(), None);

    let a = test_anlegen(&pool, "Lage A", None, leit).await.unwrap();
    let b = test_anlegen(&pool, "Lage B", None, leit).await.unwrap();
    assert_eq!(
        a.einsatznummer_intern.as_deref(),
        Some(format!("E-{jahr}-0001").as_str())
    );
    assert_eq!(
        b.einsatznummer_intern.as_deref(),
        Some(format!("E-{jahr}-0002").as_str())
    );

    // angelegt_at wurde gesetzt (nicht der '' Default).
    assert!(!a.angelegt_at.is_empty());
}

#[tokio::test]
async fn anlegen_zaehlt_je_organisation_getrennt() {
    let pool = crate::db::test_pool().await;
    let leit = benutzer_anlegen(&pool, "leit").await; // legt Org id=1 an

    let jahr = crate::einsatz::nummer::jahr_in_zone(chrono::Utc::now(), None);

    // Zweite Organisation mit bereits hoher Nummer — darf Org 1 nicht beeinflussen.
    sqlx::query("INSERT INTO organisation (id, name) VALUES (2, 'Orga 2')")
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query(
        "INSERT INTO einsatz (org_id, bezeichnung, einsatznummer_intern, nummer_jahr, nummer_lfd) \
             VALUES (2, 'Fremd', ?, ?, 9)",
    )
    .bind(format!("E-{jahr}-0009"))
    .bind(jahr)
    .execute(&pool)
    .await
    .unwrap();

    // anlegen nutzt die Org des Erstellers (Org 1) → beginnt bei 0001.
    let a = test_anlegen(&pool, "Lage", None, leit).await.unwrap();
    assert_eq!(
        a.einsatznummer_intern.as_deref(),
        Some(format!("E-{jahr}-0001").as_str())
    );
}

/// LFH-617: Bestandsnummern `JJJJ-NNN` (von 0115 in die Zahlenspalten übernommen) zählen
/// mit — die Zählung setzt dahinter fort, ihr Text bleibt wörtlich. Ein Vorjahr zählt nicht.
#[tokio::test]
async fn anlegen_setzt_hinter_bestandsnummern_fort() {
    let pool = crate::db::test_pool().await;
    let leit = benutzer_anlegen(&pool, "leit").await;
    let jahr = crate::einsatz::nummer::jahr_in_zone(chrono::Utc::now(), None);

    for (text, j, lfd) in [
        (format!("{jahr}-001"), jahr, 1),
        (format!("{jahr}-003"), jahr, 3),
        (format!("{}-042", jahr - 1), jahr - 1, 42),
    ] {
        sqlx::query(
                "INSERT INTO einsatz (org_id, bezeichnung, einsatznummer_intern, nummer_jahr, nummer_lfd) \
                 VALUES (1, 'Bestand', ?, ?, ?)",
            )
            .bind(&text)
            .bind(j)
            .bind(lfd)
            .execute(&pool)
            .await
            .unwrap();
    }

    let neu = test_anlegen(&pool, "Neu", None, leit).await.unwrap();
    assert_eq!(
        neu.einsatznummer_intern.as_deref(),
        Some(format!("E-{jahr}-0004").as_str())
    );
    let bestand: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM einsatz WHERE einsatznummer_intern IN (?, ?)")
            .bind(format!("{jahr}-001"))
            .bind(format!("{jahr}-003"))
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(bestand, 2, "Bestandstext bleibt wörtlich");
}

/// LFH-617 (Review): ein früher VON HAND gesetzter Text, der zufällig dem neuen Muster
/// entspricht, trägt keine Zahlen (0115 übernimmt nur `JJJJ-NNN`) und zählt nicht mit.
/// Ohne Ausweichen entstünde derselbe Text erneut, der Text-Index aus 0005 schlüge an —
/// und weil MAX(nummer_lfd) dann nie wächst, bei JEDEM weiteren Versuch: die Org könnte
/// in diesem Jahr keinen Einsatz mehr anlegen. Die Vergabe überspringt belegte Texte.
#[tokio::test]
async fn anlegen_ueberspringt_handbelegten_nummerntext() {
    let pool = crate::db::test_pool().await;
    let leit = benutzer_anlegen(&pool, "leit").await;
    let jahr = crate::einsatz::nummer::jahr_in_zone(chrono::Utc::now(), None);
    for text in [format!("E-{jahr}-0001"), format!("E-{jahr}-0002")] {
        sqlx::query(
            "INSERT INTO einsatz (org_id, bezeichnung, einsatznummer_intern) VALUES (1, 'Hand', ?)",
        )
        .bind(text)
        .execute(&pool)
        .await
        .unwrap();
    }

    let a = test_anlegen(&pool, "A", None, leit).await.unwrap();
    assert_eq!(
        a.einsatznummer_intern.as_deref(),
        Some(format!("E-{jahr}-0003").as_str())
    );
    let b = test_anlegen(&pool, "B", None, leit).await.unwrap();
    assert_eq!(
        b.einsatznummer_intern.as_deref(),
        Some(format!("E-{jahr}-0004").as_str())
    );
}

/// LFH-617: das Org-Präfix wird beim Anlegen eingefroren — ein späterer Wechsel trifft
/// nur neue Einsätze, die Zählung läuft über den Wechsel hinweg weiter.
#[tokio::test]
async fn praefixwechsel_trifft_nur_neue_einsaetze() {
    let pool = crate::db::test_pool().await;
    let leit = benutzer_anlegen(&pool, "leit").await;
    let jahr = crate::einsatz::nummer::jahr_in_zone(chrono::Utc::now(), None);

    let alt = test_anlegen(&pool, "Alt", None, leit).await.unwrap();
    sqlx::query("INSERT INTO org_einstellungen (org_id, einsatz_nummer_praefix) VALUES (1, 'WF-')")
        .execute(&pool)
        .await
        .unwrap();
    let neu = test_anlegen(&pool, "Neu", None, leit).await.unwrap();

    assert_eq!(
        laden(&pool, alt.id)
            .await
            .unwrap()
            .einsatznummer_intern
            .as_deref(),
        Some(format!("E-{jahr}-0001").as_str()),
        "bestehende Nummer ändert sich nicht"
    );
    assert_eq!(
        neu.einsatznummer_intern.as_deref(),
        Some(format!("WF-{jahr}-0002").as_str())
    );
}

/// LFH-617: das Jahr folgt der Org-Zeitzone, nicht UTC. Fester Zeitpunkt in der
/// Neujahrsnacht (23:30 UTC = 00:30 MEZ): Berlin zählt schon 2027, eine Org mit
/// Zeitzone `UTC` noch 2026. Mit der früheren `strftime`-Vergabe wären beide 2026.
#[tokio::test]
async fn anlegen_zaehlt_das_jahr_in_der_org_zeitzone() {
    use chrono::TimeZone;
    let pool = crate::db::test_pool().await;
    let leit = benutzer_anlegen(&pool, "leit").await;
    let silvester = chrono::Utc
        .with_ymd_and_hms(2026, 12, 31, 23, 30, 0)
        .unwrap();
    let daten = || NeuerEinsatzDaten {
        bezeichnung: "Neujahr",
        stichwort: None,
        einsatzart: None,
        begonnen_at: None,
        ort: Default::default(),
        vorlage_id: None,
    };

    // Ohne Einstellung: Europe/Berlin.
    let berlin = anlegen_zum(&pool, daten(), leit, silvester).await.unwrap();
    assert_eq!(berlin.einsatznummer_intern.as_deref(), Some("E-2027-0001"));

    // Org stellt UTC ein → dieselbe Sekunde gehört noch zu 2026.
    sqlx::query("INSERT INTO org_einstellungen (org_id, zeitzone) VALUES (1, 'UTC')")
        .execute(&pool)
        .await
        .unwrap();
    let utc = anlegen_zum(&pool, daten(), leit, silvester).await.unwrap();
    assert_eq!(utc.einsatznummer_intern.as_deref(), Some("E-2026-0001"));

    // Unbekannte Zeitzone (die Einstellung prüft nur „nicht leer“): das Anlegen
    // gelingt und zählt wie Europe/Berlin.
    sqlx::query("UPDATE org_einstellungen SET zeitzone = 'Quatsch/Zone' WHERE org_id = 1")
        .execute(&pool)
        .await
        .unwrap();
    let quatsch = anlegen_zum(&pool, daten(), leit, silvester).await.unwrap();
    assert_eq!(quatsch.einsatznummer_intern.as_deref(), Some("E-2027-0002"));
}

/// Migriert aus `aktualisiere_kopf_setzt_felder_und_leere_optionals_null` (LFH-306):
/// ein VOLLSTÄNDIGER Patch verhält sich weiterhin wie der frühere Vollersatz, und der
/// explizite Leerwunsch (`Some(None)`) schreibt weiterhin NULL. Zugleich der
/// Bind-Reihenfolge-Test der zwölf Flag/Wert-Paare: jede Spalte trägt einen anderen
/// Wert und wird einzeln geprüft — eine verschobene Kette vertauschte
/// `meldende_stelle`↔`sachverhalt` bzw. `einsatzort_lat`↔`einsatzort_lon` still.
#[tokio::test]
async fn patche_kopf_setzt_jede_spalte_an_ihren_platz() {
    let pool = crate::db::test_pool().await;
    let leit = benutzer_anlegen(&pool, "leit").await;
    let einsatz = test_anlegen(&pool, "Alt", None, leit).await.unwrap();

    let aktualisiert = patche_kopf(
        &pool,
        einsatz.id,
        KopfPatch {
            bezeichnung: Some("Neu"),
            stichwort: Some(Some("H1")),
            einsatzart: Some(crate::einsatz::EINSATZART_UEBUNG),
            leitstellen_nr: Some(None),
            einsatzort: Some(Some("Hauptstraße 1")),
            einsatzort_lat: Some(Some(52.5)),
            einsatzort_lon: Some(Some(13.4)),
            meldende_stelle: Some(None),
            sachverhalt: Some(Some("Mehrzeiliges\nMeldebild")),
            anzahl_betroffene_initial: Some(Some(3)),
            begonnen_at: Some("2026-05-25 08:00:00"),
        },
    )
    .await
    .unwrap();

    assert_eq!(aktualisiert.bezeichnung, "Neu");
    assert_eq!(aktualisiert.stichwort.as_deref(), Some("H1"));
    assert_eq!(aktualisiert.einsatzart, Einsatzart::Uebung);
    assert_eq!(aktualisiert.einsatzort.as_deref(), Some("Hauptstraße 1"));
    assert_eq!(aktualisiert.einsatzort_lat, Some(52.5));
    assert_eq!(aktualisiert.einsatzort_lon, Some(13.4));
    assert_eq!(
        aktualisiert.sachverhalt.as_deref(),
        Some("Mehrzeiliges\nMeldebild")
    );
    assert_eq!(aktualisiert.anzahl_betroffene_initial, Some(3));
    assert_eq!(aktualisiert.leitstellen_nr, None, "Some(None) leert");
    assert_eq!(aktualisiert.meldende_stelle, None, "Some(None) leert");
    assert_eq!(aktualisiert.begonnen_at, "2026-05-25 08:00:00");
    // angelegt_at bleibt unverändert (Audit-Spur).
    assert_eq!(aktualisiert.angelegt_at, einsatz.angelegt_at);
    // Die Einsatznummer schreibt nur `anlegen` (LFH-617).
    assert_eq!(
        aktualisiert.einsatznummer_intern,
        einsatz.einsatznummer_intern
    );
}

/// Der Kern von LFH-306: ein Patch fasst nur die gesendeten Spalten an. Der
/// `Default`-Patch (alle Felder absent) lässt die Zeile vollständig in Ruhe —
/// insbesondere springt `begonnen_at` nicht auf `now`.
#[tokio::test]
async fn patche_kopf_laesst_nicht_gesendete_spalten_stehen() {
    let pool = crate::db::test_pool().await;
    let leit = benutzer_anlegen(&pool, "leit").await;
    let einsatz = test_anlegen(&pool, "Alt", None, leit).await.unwrap();
    let voll = patche_kopf(
        &pool,
        einsatz.id,
        KopfPatch {
            stichwort: Some(Some("H1")),
            einsatzort: Some(Some("Hauptstraße 1")),
            meldende_stelle: Some(Some("Leitstelle")),
            sachverhalt: Some(Some("Meldebild")),
            anzahl_betroffene_initial: Some(Some(3)),
            begonnen_at: Some("2026-05-25 08:00:00"),
            ..Default::default()
        },
    )
    .await
    .unwrap();

    let nachher = patche_kopf(
        &pool,
        einsatz.id,
        KopfPatch {
            einsatzort_lat: Some(Some(52.5)),
            einsatzort_lon: Some(Some(13.4)),
            ..Default::default()
        },
    )
    .await
    .unwrap();
    assert_eq!(nachher.einsatzort_lat, Some(52.5));
    assert_eq!(nachher.bezeichnung, voll.bezeichnung);
    assert_eq!(nachher.stichwort, voll.stichwort);
    assert_eq!(nachher.einsatzort, voll.einsatzort);
    assert_eq!(nachher.meldende_stelle, voll.meldende_stelle);
    assert_eq!(nachher.sachverhalt, voll.sachverhalt);
    assert_eq!(
        nachher.anzahl_betroffene_initial,
        voll.anzahl_betroffene_initial
    );
    assert_eq!(nachher.einsatznummer_intern, voll.einsatznummer_intern);
    assert_eq!(
        nachher.begonnen_at, "2026-05-25 08:00:00",
        "Alarmzeit darf nicht auf 'now' springen"
    );

    // Leerer Patch → die Zeile bleibt vollständig, kein Fehler.
    let unveraendert = patche_kopf(&pool, einsatz.id, KopfPatch::default())
        .await
        .unwrap();
    assert_eq!(unveraendert.stichwort, voll.stichwort);
    assert_eq!(unveraendert.begonnen_at, "2026-05-25 08:00:00");
}

/// Ersetzt `patche_kopf_doppelte_nummer_ist_conflict`: bis LFH-617 war die Nummer per
/// Patch setzbar und ein Duplikat ergab 409. Jetzt kennt `KopfPatch` das Feld nicht
/// mehr, und ein Patch anderer Kopffelder lässt Text UND Zahlenspalten stehen.
#[tokio::test]
async fn patche_kopf_laesst_die_einsatznummer_unberuehrt() {
    let pool = crate::db::test_pool().await;
    let leit = benutzer_anlegen(&pool, "leit").await;
    let a = test_anlegen(&pool, "A", None, leit).await.unwrap();
    let vorher: (Option<String>, Option<i64>, Option<i64>) = sqlx::query_as(
        "SELECT einsatznummer_intern, nummer_jahr, nummer_lfd FROM einsatz WHERE id = ?",
    )
    .bind(a.id)
    .fetch_one(&pool)
    .await
    .unwrap();

    patche_kopf(
        &pool,
        a.id,
        KopfPatch {
            bezeichnung: Some("A2"),
            leitstellen_nr: Some(Some("LS-1")),
            ..Default::default()
        },
    )
    .await
    .unwrap();

    let nachher: (Option<String>, Option<i64>, Option<i64>) = sqlx::query_as(
        "SELECT einsatznummer_intern, nummer_jahr, nummer_lfd FROM einsatz WHERE id = ?",
    )
    .bind(a.id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(nachher, vorher);
    assert!(vorher.0.is_some() && vorher.1.is_some() && vorher.2 == Some(1));
}

#[tokio::test]
async fn liste_fuer_zeigt_admin_nicht_mitglied_fremden_einsatz() {
    let pool = crate::db::test_pool().await;
    let leit = benutzer_anlegen(&pool, "leit").await;
    let admin = benutzer_anlegen(&pool, "admin").await;
    let einsatz = test_anlegen(&pool, "Lage", None, leit).await.unwrap();

    // Admin zur höheren Berechtigung machen.
    sqlx::query("UPDATE benutzer SET system_rolle = ? WHERE id = ?")
        .bind(crate::auth::ROLLE_ADMIN)
        .bind(admin)
        .execute(&pool)
        .await
        .unwrap();

    // Admin ist KEIN Mitglied, sieht den Einsatz aber trotzdem (ohne Rolle).
    let admin_benutzer = benutzer_laden(&pool, admin).await;
    let fuer_admin = liste_fuer(&pool, &admin_benutzer).await.unwrap();
    assert_eq!(fuer_admin.len(), 1);
    assert_eq!(fuer_admin[0].id, einsatz.id);
    assert_eq!(fuer_admin[0].meine_rolle, None);
}

/// LFH-933: `liste_fuer` zieht die harten Sperren schon im SQL, liefert aber für jede
/// Benutzerart genau, was `darf_lesen` über ALLE Einsätze zuließe — in derselben
/// Reihenfolge. Abgedeckt: Tombstone (auch leerer Wert), abgelaufene und künftige Frist,
/// Schonfrist, fremde Org mit und ohne Mitgliedschaft, System-Admin, Führungskraft, Helfer.
#[tokio::test]
async fn liste_fuer_wie_darf_lesen_ueber_alle() {
    use crate::einsatz::{EINSATZ_ROLLE_BEOBACHTER, EINSATZ_ROLLE_FUEHRUNG};
    let pool = crate::db::test_pool().await;
    sqlx::query("INSERT OR IGNORE INTO organisation (id, name) VALUES (1, 'Orga'), (2, 'Fremd')")
        .execute(&pool)
        .await
        .unwrap();
    let admin = benutzer_in_org(&pool, 1, "admin1", true, true).await;
    let fk1 = benutzer_in_org(&pool, 1, "fk1", false, true).await;
    let fk2 = benutzer_in_org(&pool, 2, "fk2", false, true).await;
    let helfer = benutzer_in_org(&pool, 1, "helfer1", false, true).await;
    sqlx::query("UPDATE benutzer SET org_rolle = 'fuehrungskraft' WHERE id IN (?, ?)")
        .bind(fk1)
        .bind(fk2)
        .execute(&pool)
        .await
        .unwrap();

    let jetzt = Utc::now();
    let vor = |stunden: i64| crate::zeit::formatiere_utc(jetzt - chrono::Duration::hours(stunden));
    let nach = |stunden: i64| crate::zeit::formatiere_utc(jetzt + chrono::Duration::hours(stunden));
    // (Org, Status, abgeschlossen_at, retention_bis, geloescht_at, begonnen vor Stunden)
    let faelle: Vec<(
        i64,
        &str,
        Option<String>,
        Option<String>,
        Option<String>,
        i64,
    )> = vec![
        (1, "aktiv", None, None, None, 1),
        (1, "abgeschlossen", Some(vor(2)), None, None, 2),
        (1, "abgeschlossen", Some(vor(72)), None, None, 3),
        (1, "abgeschlossen", Some(vor(72)), Some(vor(1)), None, 4),
        (1, "abgeschlossen", Some(vor(72)), Some(nach(24)), None, 5),
        (
            1,
            "abgeschlossen",
            Some(vor(72)),
            Some(vor(1)),
            Some(vor(1)),
            6,
        ),
        (1, "aktiv", None, None, Some(String::new()), 7),
        (1, "aktiv", None, Some(vor(1)), None, 8),
        // Nicht kanonische Fristen sperrt `darf_lesen` nicht, also auch das SQL nicht.
        (
            1,
            "abgeschlossen",
            Some(vor(72)),
            Some(String::new()),
            None,
            14,
        ),
        (
            1,
            "abgeschlossen",
            Some(vor(72)),
            Some(vor(1).replace(' ', "T")),
            None,
            15,
        ),
        (2, "aktiv", None, None, None, 9),
        (2, "abgeschlossen", Some(vor(72)), None, None, 10),
        (2, "abgeschlossen", Some(vor(72)), Some(vor(1)), None, 11),
        (2, "aktiv", None, None, None, 12),
        (2, "aktiv", None, None, Some(vor(1)), 13),
    ];
    let mut ids = Vec::new();
    for (org, status, abg, ret, gel, std) in &faelle {
        ids.push(
            sqlx::query_scalar::<_, i64>(
                "INSERT INTO einsatz (org_id, bezeichnung, status, abgeschlossen_at, \
                     retention_bis, geloescht_at, begonnen_at) \
                     VALUES (?, 'Lage', ?, ?, ?, ?, ?) RETURNING id",
            )
            .bind(org)
            .bind(status)
            .bind(abg)
            .bind(ret)
            .bind(gel)
            .bind(vor(*std))
            .fetch_one(&pool)
            .await
            .unwrap(),
        );
    }
    // Mitgliedschaften quer über beide Orgs, auch an gesperrten Einsätzen.
    for (benutzer, i, rolle) in [
        (helfer, 0, EINSATZ_ROLLE_FUEHRUNG),
        (helfer, 2, EINSATZ_ROLLE_BEOBACHTER),
        (helfer, 3, EINSATZ_ROLLE_LEITUNG),
        (helfer, 8, EINSATZ_ROLLE_FUEHRUNG),
        (helfer, 9, EINSATZ_ROLLE_LEITUNG),
        (helfer, 12, EINSATZ_ROLLE_LEITUNG),
        (fk2, 1, EINSATZ_ROLLE_BEOBACHTER),
        (fk2, 4, EINSATZ_ROLLE_LEITUNG),
        (fk1, 10, EINSATZ_ROLLE_LEITUNG),
    ] {
        sqlx::query(
            "INSERT INTO einsatz_mitgliedschaft (einsatz_id, benutzer_id, einsatz_rolle) \
                 VALUES (?, ?, ?)",
        )
        .bind(ids[i])
        .bind(benutzer)
        .bind(rolle)
        .execute(&pool)
        .await
        .unwrap();
    }

    for id in [admin, fk1, fk2, helfer] {
        let benutzer = benutzer_laden(&pool, id).await;
        // Referenz: alle Einsätze, nur `darf_lesen` filtert (das frühere Verhalten).
        let alle: Vec<(
            i64,
            i64,
            String,
            Option<String>,
            Option<String>,
            Option<String>,
            Option<String>,
        )> = sqlx::query_as(
            "SELECT e.id, e.org_id, e.status, e.abgeschlossen_at, e.retention_bis, \
                            e.geloescht_at, m.einsatz_rolle \
                     FROM einsatz e LEFT JOIN einsatz_mitgliedschaft m \
                          ON m.einsatz_id = e.id AND m.benutzer_id = ? \
                     ORDER BY e.begonnen_at DESC, e.id DESC",
        )
        .bind(id)
        .fetch_all(&pool)
        .await
        .unwrap();
        let erwartet: Vec<i64> = alle
            .iter()
            .filter(|(_, org, status, abg, ret, gel, rolle)| {
                darf_lesen(
                    &benutzer,
                    *org,
                    status,
                    abg.as_deref(),
                    ret.as_deref(),
                    gel.as_deref(),
                    rolle.as_deref().and_then(EinsatzRolle::parse),
                    jetzt,
                )
            })
            .map(|z| z.0)
            .collect();
        let ist: Vec<i64> = liste_fuer(&pool, &benutzer)
            .await
            .unwrap()
            .iter()
            .map(|e| e.id)
            .collect();
        assert_eq!(ist, erwartet, "Benutzer {}", benutzer.benutzername);
        assert!(!ist.is_empty(), "{} sieht etwas", benutzer.benutzername);
    }
}

// ---------- LFH-23: Akteurskette des System-Audits ----------

/// Abgeschlossener Einsatz ohne `abgeschlossen_von` und ohne Mitgliedschaft in Org `org`.
async fn einsatz_ohne_akteur(pool: &SqlitePool, org: i64) -> i64 {
    sqlx::query_scalar(
        "INSERT INTO einsatz (org_id, bezeichnung, status, abgeschlossen_at) \
             VALUES (?, 'Ohne Akteur', 'abgeschlossen', '2026-01-01 00:00:00') RETURNING id",
    )
    .bind(org)
    .fetch_one(pool)
    .await
    .unwrap()
}

/// Legt einen Benutzer in Org `org` an; `admin` setzt `system_rolle = admin`.
async fn benutzer_in_org(pool: &SqlitePool, org: i64, name: &str, admin: bool, aktiv: bool) -> i64 {
    sqlx::query_scalar(
            "INSERT INTO benutzer (org_id, anzeigename, benutzername, passwort_hash, system_rolle, aktiv) \
             VALUES (?, ?, ?, 'h', ?, ?) RETURNING id",
        )
        .bind(org)
        .bind(name)
        .bind(name)
        .bind(if admin { "admin" } else { "keiner" })
        .bind(aktiv)
        .fetch_one(pool)
        .await
        .unwrap()
}

#[tokio::test]
async fn system_akteur_faellt_auf_admin_der_eigenen_org_zurueck() {
    let pool = crate::db::test_pool().await;
    sqlx::query("INSERT OR IGNORE INTO organisation (id, name) VALUES (1, 'Orga'), (2, 'Fremd')")
        .execute(&pool)
        .await
        .unwrap();
    // Ein Admin der FREMDEN Org mit kleinerer id darf nie gewählt werden.
    let _fremd = benutzer_in_org(&pool, 2, "fremdadmin", true, true).await;
    let _kein_admin = benutzer_in_org(&pool, 1, "helfer", false, true).await;
    let e = einsatz_ohne_akteur(&pool, 1).await;

    let mut conn = pool.acquire().await.unwrap();
    assert_eq!(
        ermittle_system_akteur(&mut conn, e).await.unwrap(),
        None,
        "ohne Admin der eigenen Org gibt es keinen Akteur"
    );
    drop(conn);

    let inaktiv = benutzer_in_org(&pool, 1, "altadmin", true, false).await;
    let mut conn = pool.acquire().await.unwrap();
    assert_eq!(
        ermittle_system_akteur(&mut conn, e).await.unwrap(),
        Some(inaktiv),
        "ein inaktiver Admin ist besser als kein Audit"
    );
    drop(conn);

    let aktiv = benutzer_in_org(&pool, 1, "neuadmin", true, true).await;
    let mut conn = pool.acquire().await.unwrap();
    assert_eq!(
        ermittle_system_akteur(&mut conn, e).await.unwrap(),
        Some(aktiv),
        "aktive Admins vor inaktiven, auch bei größerer id"
    );
}

#[tokio::test]
async fn system_akteur_bevorzugt_abschliessende_person_und_leitung_vor_admin() {
    let pool = crate::db::test_pool().await;
    let leit = benutzer_anlegen(&pool, "leit").await;
    let _admin = benutzer_in_org(&pool, 1, "orgadmin", true, true).await;
    let einsatz = test_anlegen(&pool, "Lage", None, leit).await.unwrap();

    // Aktiv, ohne abgeschlossen_von: die Einsatzleitung gewinnt vor dem Admin.
    let mut conn = pool.acquire().await.unwrap();
    assert_eq!(
        ermittle_system_akteur(&mut conn, einsatz.id).await.unwrap(),
        Some(leit)
    );
    drop(conn);

    // Abgeschlossen von einer DRITTEN Person (weder Leitung noch Admin): sie gewinnt vor
    // Einsatzleitung und Admin — die erste Stufe der Kette.
    let abschliesser = benutzer_in_org(&pool, 1, "abschliesser", false, true).await;
    sqlx::query("UPDATE einsatz SET status = 'abgeschlossen', abgeschlossen_von = ? WHERE id = ?")
        .bind(abschliesser)
        .bind(einsatz.id)
        .execute(&pool)
        .await
        .unwrap();
    let mut conn = pool.acquire().await.unwrap();
    assert_eq!(
        ermittle_system_akteur(&mut conn, einsatz.id).await.unwrap(),
        Some(abschliesser)
    );
}

// ---------- LLH-1540: Aufbewahrungsfristen im ETB im Zeitstil des Einsatzes ----------

/// Organisation New York, Einsatz Tokio (UTC+9) in der gegebenen Darstellung. Nach
/// `setze_dauer`, das die Einstellungen des Einsatzes neu schreibt.
async fn zeitstil_einsatz_tokio(pool: &SqlitePool, einsatz: i64, darstellung: &str) {
    sqlx::query(
        "INSERT INTO org_einstellungen (org_id, zeitzone, zeitdarstellung) \
             VALUES (1, 'America/New_York', 'datum_uhrzeit') \
             ON CONFLICT (org_id) DO UPDATE SET zeitzone = excluded.zeitzone, \
                zeitdarstellung = excluded.zeitdarstellung",
    )
    .execute(pool)
    .await
    .unwrap();
    sqlx::query(
        "INSERT INTO einsatz_einstellungen (einsatz_id, zeitzone, zeitdarstellung) \
             VALUES (?, 'Asia/Tokyo', ?) \
             ON CONFLICT (einsatz_id) DO UPDATE SET zeitzone = excluded.zeitzone, \
                zeitdarstellung = excluded.zeitdarstellung",
    )
    .bind(einsatz)
    .bind(darstellung)
    .execute(pool)
    .await
    .unwrap();
}

async fn letzter_etb_text(pool: &SqlitePool, einsatz: i64) -> String {
    sqlx::query_scalar(
        "SELECT inhalt FROM etb_eintrag WHERE einsatz_id = ? ORDER BY lfd_nr DESC LIMIT 1",
    )
    .bind(einsatz)
    .fetch_one(pool)
    .await
    .unwrap()
}

/// Spec `zeitdarstellung`, „Servertexte“: die Frist beim Abschluss, beim manuellen Setzen
/// und Ändern und beim Wiederherstellen steht in Zone und Darstellung des Einsatzes (Tokio),
/// nicht der Organisation (New York) und nicht als UTC-String.
#[tokio::test]
async fn aufbewahrungsfristen_im_etb_folgen_dem_zeitstil_des_einsatzes() {
    use crate::zeitdarstellung::{Zeitdarstellung, Zeitstil};
    // (Darstellung, 25.06. 12:00Z, 28.09. 12:00Z, 01.01.30 00:00Z)
    for (darstellung, d, juni, sept, neujahr) in [
        (
            "taktisch",
            Zeitdarstellung::Taktisch,
            "252100jun26",
            "282100sep26",
            "010900jan30",
        ),
        (
            "datum_uhrzeit",
            Zeitdarstellung::DatumUhrzeit,
            "25.06.26 21:00",
            "28.09.26 21:00",
            "01.01.30 09:00",
        ),
    ] {
        let pool = crate::db::test_pool().await;
        let leit = benutzer_anlegen(&pool, "leit").await;
        let admin = benutzer_anlegen(&pool, "admin").await;
        let tokio = Zeitstil::new(chrono_tz::Asia::Tokyo, d);

        // Abschluss: „automatisch gesetzt auf …“.
        let einsatz = test_anlegen(&pool, "Lage", None, leit).await.unwrap();
        setze_dauer(&pool, einsatz.id, leit, 30).await;
        zeitstil_einsatz_tokio(&pool, einsatz.id, darstellung).await;
        let frist = abschliessen(&pool, einsatz.id, leit)
            .await
            .unwrap()
            .einsatz
            .retention_bis
            .unwrap();
        let text = letzter_etb_text(&pool, einsatz.id).await;
        assert!(
            text.contains(&format!(
                "automatisch gesetzt auf {} (",
                tokio.zeitpunkt_text(&frist)
            )),
            "{darstellung}: {text}"
        );
        assert!(!text.contains(&frist), "kein UTC-String: {text}");

        // Manuell (Text der Route): „gesetzt auf …“, „geändert von … auf …“.
        let stil = crate::zeitdarstellung::zeitstil_laden(&pool, einsatz.id)
            .await
            .unwrap();
        assert_eq!(
            frist_audit(&stil, None, Some("2030-01-01 00:00:00")),
            format!("Aufbewahrungsfrist gesetzt auf {neujahr}")
        );
        assert_eq!(
            frist_audit(
                &stil,
                Some("2026-09-28 12:00:00"),
                Some("2030-01-01 00:00:00")
            ),
            format!("Aufbewahrungsfrist geändert von {sept} auf {neujahr}")
        );
        assert_eq!(
            frist_audit(&stil, Some("2026-09-28 12:00:00"), None),
            "Aufbewahrungsfrist aufgehoben (unbegrenzt)"
        );

        // Wiederherstellen: „Löschvormerkung vom … aufgehoben … Aufbewahrungsfrist neu: …“.
        let e = archiv_einsatz(&pool, leit, Some("2026-06-25 12:00:00"), None).await;
        zeitstil_einsatz_tokio(&pool, e, darstellung).await;
        wiederherstellen(
            &pool,
            e,
            admin,
            1,
            Some("2026-09-28 12:00:00"),
            zeit("2026-06-30 12:00:00"),
        )
        .await
        .unwrap();
        let text = letzter_etb_text(&pool, e).await;
        assert!(
            text.contains(&format!("Löschvormerkung vom {juni} aufgehoben"))
                && text.contains(&format!("Aufbewahrungsfrist neu: {sept}")),
            "{darstellung}: {text}"
        );
    }
}

// ---------- LFH-23: Wiederherstellen während der Karenz ----------

fn zeit(s: &str) -> chrono::DateTime<Utc> {
    crate::zeit::parse_utc(s).unwrap()
}

/// Abgeschlossener Einsatz mit abgelaufener Frist und den übergebenen Tombstones.
async fn archiv_einsatz(
    pool: &SqlitePool,
    leit: i64,
    geloescht: Option<&str>,
    geschwaerzt: Option<&str>,
) -> i64 {
    sqlx::query_scalar(
            "INSERT INTO einsatz (org_id, bezeichnung, status, abgeschlossen_at, abgeschlossen_von, \
                retention_bis, geloescht_at, geschwaerzt_at) \
             VALUES (1,'Archiv','abgeschlossen','2026-01-01 00:00:00', ?, '2026-05-01 00:00:00', ?, ?) \
             RETURNING id",
        )
        .bind(leit)
        .bind(geloescht)
        .bind(geschwaerzt)
        .fetch_one(pool)
        .await
        .unwrap()
}

async fn stand(
    pool: &SqlitePool,
    id: i64,
) -> (Option<String>, Option<String>, Option<String>, i64) {
    let (frist, g, s): (Option<String>, Option<String>, Option<String>) = sqlx::query_as(
        "SELECT retention_bis, geloescht_at, geschwaerzt_at FROM einsatz WHERE id = ?",
    )
    .bind(id)
    .fetch_one(pool)
    .await
    .unwrap();
    let etb: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM etb_eintrag WHERE einsatz_id = ?")
        .bind(id)
        .fetch_one(pool)
        .await
        .unwrap();
    (frist, g, s, etb)
}

#[tokio::test]
async fn wiederherstellen_hebt_vormerkung_auf_und_setzt_frist_mit_audit() {
    let pool = crate::db::test_pool().await;
    let leit = benutzer_anlegen(&pool, "leit").await;
    let admin = benutzer_anlegen(&pool, "admin").await;
    let e = archiv_einsatz(&pool, leit, Some("2026-06-25 12:00:00"), None).await;

    wiederherstellen(
        &pool,
        e,
        admin,
        1,
        Some("2026-09-28 12:00:00"),
        zeit("2026-06-30 12:00:00"),
    )
    .await
    .unwrap();
    let (frist, g, s, etb) = stand(&pool, e).await;
    assert_eq!(frist.as_deref(), Some("2026-09-28 12:00:00"));
    assert_eq!((g, s, etb), (None, None, 1));
    assert_eq!(
        retention_gesetzt_at(&pool, e).await.as_deref(),
        Some("2026-06-30 12:00:00"),
        "LFH-906: die neue Frist gilt als beim Wiederherstellen gesetzt"
    );
    let (erfasser, typ, inhalt): (i64, String, String) =
        sqlx::query_as("SELECT erfasser_id, typ, inhalt FROM etb_eintrag WHERE einsatz_id = ?")
            .bind(e)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!((erfasser, typ.as_str()), (admin, "system"));
    // Vormerkung und neue Frist in der Vorgabe-Zeitdarstellung (LLH-1540).
    assert!(inhalt.contains("vom 251400jun26 aufgehoben"), "{inhalt}");
    assert!(
        inhalt.contains("Aufbewahrungsfrist neu: 281400sep26"),
        "{inhalt}"
    );

    // Unbegrenzt: ein zweiter Einsatz, Frist None.
    let e2 = archiv_einsatz(&pool, leit, Some("2026-06-25 12:00:00"), None).await;
    wiederherstellen(&pool, e2, admin, 1, None, zeit("2026-06-30 12:00:00"))
        .await
        .unwrap();
    let (frist, g, _, _) = stand(&pool, e2).await;
    assert_eq!((frist, g), (None, None));
    let inhalt: String = sqlx::query_scalar("SELECT inhalt FROM etb_eintrag WHERE einsatz_id = ?")
        .bind(e2)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert!(inhalt.contains("unbegrenzt"), "{inhalt}");
}

#[tokio::test]
async fn wiederherstellen_lehnt_ab_ohne_zu_schreiben() {
    let pool = crate::db::test_pool().await;
    let leit = benutzer_anlegen(&pool, "leit").await;
    let admin = benutzer_anlegen(&pool, "admin").await;
    let jetzt = zeit("2026-06-30 12:00:00");

    // Vormerkung genau 30 Tage alt → Karenz abgelaufen (Grenze wie karenz_abgelaufen) → 409.
    let grenze = archiv_einsatz(&pool, leit, Some("2026-05-31 12:00:00"), None).await;
    let vorher = stand(&pool, grenze).await;
    assert!(matches!(
        wiederherstellen(&pool, grenze, admin, 1, None, jetzt).await,
        Err(AppError::Conflict(_))
    ));
    assert_eq!(stand(&pool, grenze).await, vorher);
    // Eine Sekunde jünger → noch in der Karenz → gelingt.
    let knapp = archiv_einsatz(&pool, leit, Some("2026-05-31 12:00:01"), None).await;
    wiederherstellen(&pool, knapp, admin, 1, None, jetzt)
        .await
        .unwrap();

    // Geschwärzt → 409.
    let schwarz = archiv_einsatz(
        &pool,
        leit,
        Some("2026-06-29 00:00:00"),
        Some("2026-06-30 00:00:00"),
    )
    .await;
    let vorher = stand(&pool, schwarz).await;
    assert!(matches!(
        wiederherstellen(&pool, schwarz, admin, 1, None, jetzt).await,
        Err(AppError::Conflict(_))
    ));
    assert_eq!(stand(&pool, schwarz).await, vorher);

    // Nicht vorgemerkt → 422.
    let offen = archiv_einsatz(&pool, leit, None, None).await;
    let vorher = stand(&pool, offen).await;
    assert!(matches!(
        wiederherstellen(&pool, offen, admin, 1, None, jetzt).await,
        Err(AppError::UnprocessableEntity(_))
    ));
    assert_eq!(stand(&pool, offen).await, vorher);

    // Unbekannt → 404.
    assert!(matches!(
        wiederherstellen(&pool, 999_999, admin, 1, None, jetzt).await,
        Err(AppError::NotFound)
    ));

    // Fremde Org → 403, ohne zu schreiben — auch ohne die Vorprüfung der Route.
    let fremd = archiv_einsatz(&pool, leit, Some("2026-06-29 00:00:00"), None).await;
    let vorher = stand(&pool, fremd).await;
    assert!(matches!(
        wiederherstellen(&pool, fremd, admin, 2, None, jetzt).await,
        Err(AppError::Forbidden)
    ));
    assert_eq!(stand(&pool, fremd).await, vorher);
}

// ---------- LFH-23 Review: bewachte Schreibwege gegen den Purge-Lauf ----------

#[tokio::test]
async fn frist_setzen_schreibt_nicht_an_vorgemerkte_oder_geschwaerzte_einsaetze() {
    let pool = crate::db::test_pool().await;
    let leit = benutzer_anlegen(&pool, "leit").await;
    // Vormerkung relativ zu jetzt, damit sie wirklich INNERHALB der Karenz liegt.
    let gestern = crate::zeit::formatiere_utc(Utc::now() - chrono::Duration::days(1));
    let vorgemerkt = archiv_einsatz(&pool, leit, Some(&gestern), None).await;
    let vorher = stand(&pool, vorgemerkt).await;
    assert!(matches!(
        frist_setzen(
            &pool,
            vorgemerkt,
            leit,
            Some("2099-01-01 00:00:00"),
            "x",
            Utc::now()
        )
        .await,
        Err(AppError::UnprocessableEntity(_))
    ));
    assert_eq!(
        stand(&pool, vorgemerkt).await,
        vorher,
        "kein Schreibvorgang, kein ETB"
    );

    // Karenz abgelaufen, noch nicht geschwärzt: 409 wie beim Wiederherstellen.
    let ausstehend = archiv_einsatz(&pool, leit, Some("2026-01-02 00:00:00"), None).await;
    let vorher = stand(&pool, ausstehend).await;
    assert!(matches!(
        frist_setzen(
            &pool,
            ausstehend,
            leit,
            Some("2099-01-01 00:00:00"),
            "x",
            Utc::now()
        )
        .await,
        Err(AppError::Conflict(_))
    ));
    assert_eq!(stand(&pool, ausstehend).await, vorher);

    let schwarz = archiv_einsatz(
        &pool,
        leit,
        Some("2026-06-25 12:00:00"),
        Some("2026-07-26 12:00:00"),
    )
    .await;
    let vorher = stand(&pool, schwarz).await;
    assert!(matches!(
        frist_setzen(&pool, schwarz, leit, None, "x", Utc::now()).await,
        Err(AppError::Conflict(_))
    ));
    assert_eq!(stand(&pool, schwarz).await, vorher);
}

/// Eine zwischen Kandidatenliste und UPDATE verlängerte Frist gewinnt: der Soft-Delete
/// prüft `retention_bis` im UPDATE selbst noch einmal.
#[tokio::test]
async fn soft_delete_prueft_die_frist_im_update_noch_einmal() {
    let pool = crate::db::test_pool().await;
    let leit = benutzer_anlegen(&pool, "leit").await;
    let e = archiv_einsatz(&pool, leit, None, None).await;
    assert_eq!(
        faellige_soft_delete(&pool, "2026-06-01 00:00:00")
            .await
            .unwrap(),
        vec![e]
    );
    sqlx::query("UPDATE einsatz SET retention_bis = '2099-01-01 00:00:00' WHERE id = ?")
        .bind(e)
        .execute(&pool)
        .await
        .unwrap();
    assert!(!soft_delete_einsatz(&pool, e, "2026-06-01 00:00:00")
        .await
        .unwrap());
    let (_, g, _, etb) = stand(&pool, e).await;
    assert_eq!((g, etb), (None, 0));
}

/// Das Rennen aus LFH-754: der Purge-Lauf hat seine Kandidatenliste schon gelesen (alte
/// Vormerkung, Karenz abgelaufen), dann wird der Einsatz wiederhergestellt und neu
/// vorgemerkt. Die Schwärzung prüft die Karenz im UPDATE selbst noch einmal und lässt
/// die frische Vormerkung stehen.
#[tokio::test]
async fn schwaerzung_prueft_die_karenz_im_update_noch_einmal() {
    let pool = crate::db::test_pool().await;
    let leit = benutzer_anlegen(&pool, "leit").await;
    let admin = benutzer_anlegen(&pool, "admin").await;
    let jetzt = zeit("2026-06-30 12:00:00");
    let jetzt_s = crate::zeit::formatiere_utc(jetzt);
    let e = archiv_einsatz(&pool, leit, Some("2026-05-20 12:00:00"), None).await;
    let kandidaten = faellige_purge(&pool, super::super::retention::KARENZ_TAGE)
        .await
        .unwrap();
    assert_eq!(kandidaten, vec![(e, "2026-05-20 12:00:00".to_string())]);

    // Zwischen Kandidatenliste und Schwärzung: wiederhergestellt (in der Karenz) mit
    // einer Frist, die abläuft, und neu vorgemerkt — die Karenz beginnt von vorn.
    wiederherstellen(
        &pool,
        e,
        admin,
        1,
        Some("2026-06-01 00:00:00"),
        zeit("2026-05-25 12:00:00"),
    )
    .await
    .unwrap();
    assert!(soft_delete_einsatz(&pool, e, "2026-06-29 12:00:00")
        .await
        .unwrap());

    assert!(
        super::super::retention::karenz_abgelaufen(Some(&kandidaten[0].1), jetzt),
        "der Purge-Lauf hält den Kandidaten nach seiner Liste für fällig"
    );
    let vorher = stand(&pool, e).await;
    assert!(!schwaerze_einsatz(&pool, e, &jetzt_s).await.unwrap());
    assert_eq!(stand(&pool, e).await, vorher, "nichts geschwärzt, kein ETB");
    // Karenz-Beginn ist der Ablauf der neuen Frist (LFH-906), nicht der Lauf am 29.06.
    assert_eq!(vorher.1.as_deref(), Some("2026-06-01 00:00:00"));

    // Grenze wie `karenz_abgelaufen`: genau 30 Tage → schwärzen, eine Sekunde jünger nicht.
    let knapp = archiv_einsatz(&pool, leit, Some("2026-05-31 12:00:01"), None).await;
    assert!(!schwaerze_einsatz(&pool, knapp, &jetzt_s).await.unwrap());
    let grenze = archiv_einsatz(&pool, leit, Some("2026-05-31 12:00:00"), None).await;
    assert!(schwaerze_einsatz(&pool, grenze, &jetzt_s).await.unwrap());
}
