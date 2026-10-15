//! Baustein „disponieren und zuordnen in einer Transaktion“ (LLH-1100, D2/D3).

use super::*;
use crate::katalog::KATEGORIE_GEBUNDEN;
use crate::personal::status_repo::{self, StatusDaten};
use sqlx::SqlitePool;

/// Org 1 und 2, Benutzer, Einsatz, ein `gebunden`-Status mit Zeitachsen-Marke; liefert den
/// Kontext.
async fn setup(pool: &SqlitePool) -> Kontext {
    sqlx::query("INSERT INTO organisation (id, name) VALUES (1, 'Orga'), (2, 'Fremd')")
        .execute(pool)
        .await
        .unwrap();
    let benutzer_id: i64 = sqlx::query_scalar(
        "INSERT INTO benutzer (org_id, anzeigename, benutzername, passwort_hash) \
         VALUES (1, 'Leit', 'leit', 'h') RETURNING id",
    )
    .fetch_one(pool)
    .await
    .unwrap();
    let einsatz_id: i64 = sqlx::query_scalar(
        "INSERT INTO einsatz (org_id, bezeichnung) VALUES (1, 'Lage') RETURNING id",
    )
    .fetch_one(pool)
    .await
    .unwrap();
    status_repo::anlegen(
        pool,
        1,
        StatusDaten {
            label: "alarmiert",
            kategorie: KATEGORIE_GEBUNDEN,
            farbe: None,
            sortier: 20,
            zeitachse_marke: Some("alarmierung"),
        },
    )
    .await
    .unwrap();
    Kontext {
        einsatz_id,
        org_id: 1,
        benutzer_id,
    }
}

async fn person(pool: &SqlitePool, org: i64, name: &str, traeger: Option<&str>) -> i64 {
    sqlx::query_scalar(
        "INSERT INTO personal (org_id, name, traegerorganisation) VALUES (?, ?, ?) RETURNING id",
    )
    .bind(org)
    .bind(name)
    .bind(traeger)
    .fetch_one(pool)
    .await
    .unwrap()
}

async fn fahrzeug(pool: &SqlitePool, org: i64, funkrufname: &str) -> i64 {
    sqlx::query_scalar("INSERT INTO fahrzeug (org_id, funkrufname) VALUES (?, ?) RETURNING id")
        .bind(org)
        .bind(funkrufname)
        .fetch_one(pool)
        .await
        .unwrap()
}

async fn einheit(pool: &SqlitePool, einsatz: i64, name: &str) -> i64 {
    sqlx::query_scalar("INSERT INTO einsatz_einheit (einsatz_id, name) VALUES (?, ?) RETURNING id")
        .bind(einsatz)
        .bind(name)
        .fetch_one(pool)
        .await
        .unwrap()
}

async fn ausser_dienst(pool: &SqlitePool, tabelle: &str, id: i64) {
    sqlx::query(sqlx::AssertSqlSafe(format!(
        "UPDATE {tabelle} SET dienststatus = 'ausser_dienst' WHERE id = ?"
    )))
    .bind(id)
    .execute(pool)
    .await
    .unwrap();
}

/// Stamm-Fahrzeug disponieren und optional einer Einheit zuordnen; liefert die `ef_id`.
async fn einsatz_fahrzeug(pool: &SqlitePool, k: Kontext, fid: i64, einheit: Option<i64>) -> i64 {
    let mut conn = pool.acquire().await.unwrap();
    let ef = crate::fahrzeug::disposition_repo::disponiere_stamm_tx(
        &mut conn,
        k.einsatz_id,
        k.org_id,
        fid,
        k.benutzer_id,
    )
    .await
    .unwrap()
    .id;
    if let Some(e) = einheit {
        mitglied_repo::zuordnen_fahrzeug_tx(&mut conn, k.einsatz_id, e, ef)
            .await
            .unwrap();
    }
    ef
}

fn wahl(ids: &[i64]) -> Vec<PersonalWahl> {
    ids.iter()
        .map(|&personal_id| PersonalWahl {
            personal_id,
            staerke_position: None,
        })
        .collect()
}

/// Zählt auf der Verbindung des Tests (der Testpool hat nur eine).
async fn anzahl_disponiert(conn: &mut sqlx::SqliteConnection, einsatz: i64) -> i64 {
    sqlx::query_scalar(
        "SELECT COUNT(*) FROM einsatz_personal WHERE einsatz_id = ? AND beendet_at IS NULL",
    )
    .bind(einsatz)
    .fetch_one(&mut *conn)
    .await
    .unwrap()
}

fn gruende(zeilen: &[ZeilenGrund]) -> Vec<(i64, &str)> {
    zeilen.iter().map(|z| (z.id, z.grund.as_str())).collect()
}

#[tokio::test]
async fn vorpruefung_nennt_je_id_einen_grund_in_einer_abfrage() {
    let pool = crate::db::test_pool().await;
    let k = setup(&pool).await;
    let frei = person(&pool, 1, "Frei", None).await;
    let fremd = person(&pool, 2, "Fremd", None).await;
    let ruhend = person(&pool, 1, "Ruhend", None).await;
    ausser_dienst(&pool, "personal", ruhend).await;
    let dabei = person(&pool, 1, "Dabei", None).await;
    let entlassen = person(&pool, 1, "Entlassen", None).await;
    let storniert = person(&pool, 1, "Storniert", None).await;
    let mut conn = pool.acquire().await.unwrap();
    for (pid, als) in [
        (dabei, None),
        (entlassen, Some("entlassen")),
        (storniert, Some("storniert")),
    ] {
        sqlx::query(
            "INSERT INTO einsatz_personal (einsatz_id, personal_id, snap_name, beendet_at, \
                 beendet_als) VALUES (?, ?, 'x', CASE WHEN ?3 IS NULL THEN NULL ELSE \
                 datetime('now') END, ?3)",
        )
        .bind(k.einsatz_id)
        .bind(pid)
        .bind(als)
        .execute(&mut *conn)
        .await
        .unwrap();
    }
    let ids = [9999, frei, fremd, ruhend, dabei, entlassen, storniert];

    let sammel = check_personal_tx(&mut conn, k.einsatz_id, 1, &ids, Regeln::SAMMEL)
        .await
        .unwrap();
    assert_eq!(
        gruende(&sammel),
        [
            (9999, GRUND_UNBEKANNT),
            (fremd, GRUND_UNBEKANNT),
            (ruhend, GRUND_AUSSER_DIENST),
            (dabei, GRUND_SCHON_DISPONIERT),
            (entlassen, GRUND_ENTLASSEN),
        ]
    );
    assert!(sammel.iter().all(|z| z.art == ZeilenArt::Personal));

    // Der Einzelweg nimmt eine entlassene Person wieder auf (LLH-1079 D7).
    let einzel = check_personal_tx(
        &mut conn,
        k.einsatz_id,
        1,
        &[entlassen, dabei],
        Regeln::EINZEL,
    )
    .await
    .unwrap();
    assert_eq!(gruende(&einzel), [(dabei, GRUND_SCHON_DISPONIERT)]);
}

#[tokio::test]
async fn vorpruefung_fahrzeuge_nennt_je_id_einen_grund() {
    let pool = crate::db::test_pool().await;
    let k = setup(&pool).await;
    let frei = fahrzeug(&pool, 1, "83-1").await;
    let fremd = fahrzeug(&pool, 2, "99-1").await;
    let ruhend = fahrzeug(&pool, 1, "83-2").await;
    ausser_dienst(&pool, "fahrzeug", ruhend).await;
    let dabei = fahrzeug(&pool, 1, "83-3").await;
    einsatz_fahrzeug(&pool, k, dabei, None).await;
    // LLH-1079 Teil II: ein entlassenes Fahrzeug lehnt der Sammelweg ab, ein storniertes nicht.
    let entlassen = fahrzeug(&pool, 1, "83-4").await;
    let storniert = fahrzeug(&pool, 1, "83-5").await;
    for (fid, als) in [(entlassen, "entlassen"), (storniert, "storniert")] {
        let ef = einsatz_fahrzeug(&pool, k, fid, None).await;
        sqlx::query(
            "UPDATE einsatz_fahrzeug SET beendet_at = datetime('now'), beendet_als = ? WHERE id = ?",
        )
        .bind(als)
        .bind(ef)
        .execute(&pool)
        .await
        .unwrap();
    }
    let mut conn = pool.acquire().await.unwrap();
    let zeilen = check_fahrzeuge_tx(
        &mut conn,
        k.einsatz_id,
        1,
        &[frei, fremd, ruhend, dabei, entlassen, storniert],
        Regeln::SAMMEL,
    )
    .await
    .unwrap();
    assert_eq!(
        gruende(&zeilen),
        [
            (fremd, GRUND_UNBEKANNT),
            (ruhend, GRUND_AUSSER_DIENST),
            (dabei, GRUND_SCHON_DISPONIERT),
            (entlassen, GRUND_ENTLASSEN),
        ]
    );
    assert!(zeilen.iter().all(|z| z.art == ZeilenArt::Fahrzeug));

    // Das Bilden aus einer Vorlage nimmt ein entlassenes Fahrzeug wieder auf (LLH-1236).
    let einzel = check_fahrzeuge_tx(
        &mut conn,
        k.einsatz_id,
        1,
        &[entlassen, dabei],
        Regeln::EINZEL,
    )
    .await
    .unwrap();
    assert_eq!(gruende(&einzel), [(dabei, GRUND_SCHON_DISPONIERT)]);
}

#[tokio::test]
async fn gruppe_in_einheit_und_fahrzeug_mit_zeitachse() {
    let pool = crate::db::test_pool().await;
    let k = setup(&pool).await;
    let staffel = einheit(&pool, k.einsatz_id, "Rettungsstaffel").await;
    let fz = fahrzeug(&pool, 1, "83-1").await;
    let ef = einsatz_fahrzeug(&pool, k, fz, Some(staffel)).await;
    let a = person(&pool, 1, "Anna", Some("DRK")).await;
    let b = person(&pool, 1, "Bernd", None).await;
    let c = person(&pool, 1, "Clara", Some("ASB")).await;

    let mut tx = pool.begin().await.unwrap();
    let ergebnis = disponiere_personal_tx(
        &mut tx,
        k,
        &wahl(&[a, b, c]),
        Ziel {
            einheit_id: Some(staffel),
            fahrzeug_id: Some(ef),
        },
        Regeln::SAMMEL,
    )
    .await
    .unwrap();
    tx.commit().await.unwrap();

    assert_eq!(ergebnis.kraefte.len(), 3);
    assert_eq!(ergebnis.einheit.as_ref().unwrap().name, "Rettungsstaffel");
    assert_eq!(ergebnis.fahrzeug.as_ref().unwrap().name, "83-1");
    let zeilen: Vec<(Option<i64>, Option<i64>, i64)> = sqlx::query_as(
        "SELECT ep.einheit_id, ep.fahrzeug_id, \
                (SELECT COUNT(*) FROM einsatz_kraft_zeitachse z WHERE z.personal_id = ep.id) \
         FROM einsatz_personal ep WHERE ep.einsatz_id = ? AND ep.beendet_at IS NULL ORDER BY ep.id",
    )
    .bind(k.einsatz_id)
    .fetch_all(&pool)
    .await
    .unwrap();
    assert_eq!(zeilen, vec![(Some(staffel), Some(ef), 1); 3]);
    assert_eq!(
        etb_text_personal(&ergebnis),
        "3 Kräfte disponiert, Einheit «Rettungsstaffel», Fahrzeug «83-1»: Anna (DRK), Bernd, \
         Clara (ASB)"
    );
}

#[tokio::test]
async fn eine_abgelehnte_person_legt_keine_an() {
    let pool = crate::db::test_pool().await;
    let k = setup(&pool).await;
    let a = person(&pool, 1, "Anna", None).await;
    let b = person(&pool, 1, "Bernd", None).await;
    ausser_dienst(&pool, "personal", b).await;
    let mut conn = pool.acquire().await.unwrap();
    let fehler = disponiere_personal_tx(
        &mut conn,
        k,
        &wahl(&[a, b]),
        Ziel::default(),
        Regeln::SAMMEL,
    )
    .await
    .unwrap_err();
    match fehler {
        AppError::Zeilen { zeilen, .. } => {
            assert_eq!(gruende(&zeilen), [(b, GRUND_AUSSER_DIENST)])
        }
        andere => panic!("erwartet Zeilen, war {andere:?}"),
    }
    // Ohne Rollback geprüft: die Vorprüfung läuft vor dem ersten Schreiben.
    assert_eq!(anzahl_disponiert(&mut conn, k.einsatz_id).await, 0);
}

#[tokio::test]
async fn fahrzeug_einer_anderen_einheit_ist_422_und_legt_nichts_an() {
    let pool = crate::db::test_pool().await;
    let k = setup(&pool).await;
    let staffel = einheit(&pool, k.einsatz_id, "Rettungsstaffel").await;
    let zug = einheit(&pool, k.einsatz_id, "Sanitätszug").await;
    let fz = fahrzeug(&pool, 1, "83-1").await;
    let ef = einsatz_fahrzeug(&pool, k, fz, Some(zug)).await;
    let lose = fahrzeug(&pool, 1, "83-9").await;
    let ef_lose = einsatz_fahrzeug(&pool, k, lose, None).await;
    let a = person(&pool, 1, "Anna", None).await;
    let mut conn = pool.acquire().await.unwrap();
    let ziel = Ziel {
        einheit_id: Some(staffel),
        fahrzeug_id: Some(ef),
    };
    let fehler = disponiere_personal_tx(&mut conn, k, &wahl(&[a]), ziel, Regeln::SAMMEL)
        .await
        .unwrap_err();
    assert!(
        matches!(fehler, AppError::UnprocessableEntity(_)),
        "{fehler:?}"
    );
    assert_eq!(anzahl_disponiert(&mut conn, k.einsatz_id).await, 0);

    // Ein Fahrzeug ohne Einheit gehört auch nicht zur gewählten Einheit (D5).
    let ziel = Ziel {
        einheit_id: Some(staffel),
        fahrzeug_id: Some(ef_lose),
    };
    let fehler = disponiere_personal_tx(&mut conn, k, &wahl(&[a]), ziel, Regeln::SAMMEL)
        .await
        .unwrap_err();
    assert!(
        matches!(fehler, AppError::UnprocessableEntity(_)),
        "{fehler:?}"
    );
    assert_eq!(anzahl_disponiert(&mut conn, k.einsatz_id).await, 0);

    // Ohne Einheit ist jedes Fahrzeug des Einsatzes Ziel (D5).
    let ziel = Ziel {
        einheit_id: None,
        fahrzeug_id: Some(ef),
    };
    disponiere_personal_tx(&mut conn, k, &wahl(&[a]), ziel, Regeln::SAMMEL)
        .await
        .unwrap();
    assert_eq!(anzahl_disponiert(&mut conn, k.einsatz_id).await, 1);
}

#[tokio::test]
async fn aufgeloeste_oder_fremde_einheit_ist_kein_ziel() {
    let pool = crate::db::test_pool().await;
    let k = setup(&pool).await;
    let alt = einheit(&pool, k.einsatz_id, "Alt").await;
    sqlx::query("UPDATE einsatz_einheit SET aufgeloest_at = datetime('now') WHERE id = ?")
        .bind(alt)
        .execute(&pool)
        .await
        .unwrap();
    let a = person(&pool, 1, "Anna", None).await;
    let mut conn = pool.acquire().await.unwrap();
    let aufgeloest = Ziel {
        einheit_id: Some(alt),
        fahrzeug_id: None,
    };
    let fehler = disponiere_personal_tx(&mut conn, k, &wahl(&[a]), aufgeloest, Regeln::SAMMEL)
        .await
        .unwrap_err();
    assert!(matches!(fehler, AppError::Conflict(_)), "{fehler:?}");
    let fremd = Ziel {
        einheit_id: Some(424242),
        fahrzeug_id: None,
    };
    let fehler = disponiere_personal_tx(&mut conn, k, &wahl(&[a]), fremd, Regeln::SAMMEL)
        .await
        .unwrap_err();
    assert!(
        matches!(fehler, AppError::UnprocessableEntity(_)),
        "{fehler:?}"
    );
    assert_eq!(anzahl_disponiert(&mut conn, k.einsatz_id).await, 0);
}

#[tokio::test]
async fn stornierte_person_wird_wieder_aufgenommen() {
    let pool = crate::db::test_pool().await;
    let k = setup(&pool).await;
    let a = person(&pool, 1, "Anna", None).await;
    sqlx::query(
        "INSERT INTO einsatz_personal (einsatz_id, personal_id, snap_name, beendet_at, beendet_als) \
         VALUES (?, ?, 'Anna', datetime('now'), 'storniert')",
    )
    .bind(k.einsatz_id)
    .bind(a)
    .execute(&pool)
    .await
    .unwrap();
    let mut conn = pool.acquire().await.unwrap();
    let e = disponiere_personal_tx(&mut conn, k, &wahl(&[a]), Ziel::default(), Regeln::SAMMEL)
        .await
        .unwrap();
    assert!(e.kraefte[0].reaktiviert);
    assert_eq!(etb_text_personal(&e), "Person «Anna» erneut disponiert");
    assert_eq!(anzahl_disponiert(&mut conn, k.einsatz_id).await, 1);
}

/// LLH-1079 Teil II: ein storniertes Fahrzeug war nie im Einsatz; der Sammelweg nimmt seine
/// Zeile wieder auf (UNIQUE(einsatz_id, fahrzeug_id)), der ETB sagt „erneut disponiert“.
#[tokio::test]
async fn storniertes_fahrzeug_wird_wieder_aufgenommen() {
    let pool = crate::db::test_pool().await;
    let k = setup(&pool).await;
    let f = fahrzeug(&pool, 1, "83-1").await;
    let ef = einsatz_fahrzeug(&pool, k, f, None).await;
    sqlx::query(
        "UPDATE einsatz_fahrzeug SET beendet_at = datetime('now'), beendet_als = 'storniert' \
         WHERE id = ?",
    )
    .bind(ef)
    .execute(&pool)
    .await
    .unwrap();
    let mut conn = pool.acquire().await.unwrap();
    let e = disponiere_fahrzeuge_tx(&mut conn, k, &[f], None, Regeln::SAMMEL)
        .await
        .unwrap();
    assert_eq!(e.fahrzeuge[0].ef_id, ef, "dieselbe Zeile");
    assert!(e.fahrzeuge[0].reaktiviert);
    assert_eq!(etb_text_fahrzeuge(&e), "Fahrzeug «83-1» erneut disponiert");
    let beendet: Option<String> =
        sqlx::query_scalar("SELECT beendet_at FROM einsatz_fahrzeug WHERE id = ?")
            .bind(ef)
            .fetch_one(&mut *conn)
            .await
            .unwrap();
    assert_eq!(beendet, None);
}

#[tokio::test]
async fn fahrzeuge_in_eine_einheit() {
    let pool = crate::db::test_pool().await;
    let k = setup(&pool).await;
    let zug = einheit(&pool, k.einsatz_id, "Sanitätszug").await;
    let f1 = fahrzeug(&pool, 1, "83-1").await;
    let f2 = fahrzeug(&pool, 1, "83-2").await;
    let mut tx = pool.begin().await.unwrap();
    let e = disponiere_fahrzeuge_tx(&mut tx, k, &[f1, f2], Some(zug), Regeln::SAMMEL)
        .await
        .unwrap();
    tx.commit().await.unwrap();
    assert_eq!(e.fahrzeuge.len(), 2);
    let zuordnung: Vec<Option<i64>> = sqlx::query_scalar(
        "SELECT einheit_id FROM einsatz_fahrzeug WHERE einsatz_id = ? ORDER BY id",
    )
    .bind(k.einsatz_id)
    .fetch_all(&pool)
    .await
    .unwrap();
    assert_eq!(zuordnung, [Some(zug), Some(zug)]);
    assert_eq!(
        etb_text_fahrzeuge(&e),
        "2 Fahrzeuge disponiert, Einheit «Sanitätszug»: 83-1, 83-2"
    );
    // Keine Zeitachse für Fahrzeuge (D6).
    let zeitachse: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM einsatz_kraft_zeitachse")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(zeitachse, 0);
}

#[tokio::test]
async fn ein_abgelehntes_fahrzeug_legt_keines_an() {
    let pool = crate::db::test_pool().await;
    let k = setup(&pool).await;
    let f1 = fahrzeug(&pool, 1, "83-1").await;
    let f2 = fahrzeug(&pool, 1, "83-2").await;
    ausser_dienst(&pool, "fahrzeug", f2).await;
    let mut conn = pool.acquire().await.unwrap();
    let fehler = disponiere_fahrzeuge_tx(&mut conn, k, &[f1, f2], None, Regeln::SAMMEL)
        .await
        .unwrap_err();
    assert!(matches!(fehler, AppError::Zeilen { .. }), "{fehler:?}");
    let n: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM einsatz_fahrzeug")
        .fetch_one(&mut *conn)
        .await
        .unwrap();
    assert_eq!(n, 0);
}

#[test]
fn etb_text_bei_einer_kraft_ist_der_einzelwortlaut() {
    let kraft = |name: &str, funktion: Option<&str>| DisponiertePerson {
        ep_id: 1,
        name: name.into(),
        funktion: funktion.map(Into::into),
        traegerorganisation: Some("DRK".into()),
        reaktiviert: false,
    };
    let ohne_ziel = PersonalErgebnis {
        kraefte: vec![kraft("Anna Muster", Some("Sanitäter"))],
        einheit: None,
        fahrzeug: None,
    };
    assert_eq!(
        etb_text_personal(&ohne_ziel),
        crate::personal::etb_text_disponiert("Anna Muster", Some("Sanitäter"))
    );
    let mit_einheit = PersonalErgebnis {
        einheit: Some(ZielName {
            id: 1,
            name: "Rettungsstaffel".into(),
        }),
        ..ohne_ziel
    };
    assert_eq!(
        etb_text_personal(&mit_einheit),
        "Person «Anna Muster (Sanitäter)» disponiert, Einheit «Rettungsstaffel»"
    );
    let ein_fahrzeug = FahrzeugErgebnis {
        fahrzeuge: vec![DisponiertesFahrzeug {
            ef_id: 1,
            funkrufname: "83-1".into(),
            reaktiviert: false,
        }],
        einheit: None,
    };
    assert_eq!(
        etb_text_fahrzeuge(&ein_fahrzeug),
        crate::fahrzeug::etb_text_disponiert("83-1")
    );
}

#[test]
fn id_liste_ist_gedeckelt_vor_dem_entdoppeln() {
    assert!(matches!(check_ids(&[]), Err(AppError::Validation(_))));
    let voll: Vec<i64> = (1..=SAMMEL_MAX as i64).collect();
    assert_eq!(check_ids(&voll).unwrap().len(), SAMMEL_MAX);
    // 51 Einträge sind zu viel, auch wenn nach dem Entdoppeln weniger blieben.
    let mut zu_viel = vec![1; SAMMEL_MAX];
    zu_viel.push(2);
    assert!(matches!(check_ids(&zu_viel), Err(AppError::Validation(_))));
    assert_eq!(check_ids(&[5, 5, 6]).unwrap(), [5, 6]);
}

#[test]
fn dedupe_behaelt_die_erste_reihenfolge() {
    assert_eq!(dedupe(&[3, 1, 3, 2, 1], |x| *x), [3, 1, 2]);
}
