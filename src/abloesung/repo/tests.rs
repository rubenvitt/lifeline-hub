//! Repo-Tests der Ablösung (LFH-635) — je ein Test pro Spec-Szenario der Schreibpfade.

use super::*;
use crate::abloesung::Einstufung;
use crate::erinnerung::repo as erepo;
use crate::error::AppError;
use axum::http::StatusCode;

const T0: &str = "2026-09-22 09:30:00";

struct Welt {
    pool: SqlitePool,
    b: i64,
    e: i64,
    abschnitt: i64,
    f1: i64,
    f2: i64,
}

async fn welt() -> Welt {
    let pool = crate::db::test_pool().await;
    sqlx::query("INSERT OR IGNORE INTO organisation (id, name) VALUES (1, 'Orga')")
        .execute(&pool)
        .await
        .unwrap();
    let b: i64 = sqlx::query_scalar(
        "INSERT INTO benutzer (org_id, anzeigename, benutzername, passwort_hash) \
         VALUES (1, 'Leitung', 'leit', 'h') RETURNING id",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    let e: i64 = sqlx::query_scalar(
        "INSERT INTO einsatz (org_id, bezeichnung) VALUES (1, 'Hochwasser') RETURNING id",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    let abschnitt: i64 = sqlx::query_scalar(
        "INSERT INTO einsatzabschnitt (einsatz_id, name) VALUES (?, 'Deichwache Nord') RETURNING id",
    )
    .bind(e)
    .fetch_one(&pool)
    .await
    .unwrap();
    let f1 = einheit(&pool, e, "Florian 1", Some(abschnitt)).await;
    let f2 = einheit(&pool, e, "Florian 2", None).await;
    Welt {
        pool,
        b,
        e,
        abschnitt,
        f1,
        f2,
    }
}

async fn einheit(pool: &SqlitePool, e: i64, name: &str, abschnitt: Option<i64>) -> i64 {
    sqlx::query_scalar(
        "INSERT INTO einsatz_einheit (einsatz_id, name, abschnitt_id) VALUES (?, ?, ?) RETURNING id",
    )
    .bind(e)
    .bind(name)
    .bind(abschnitt)
    .fetch_one(pool)
    .await
    .unwrap()
}

fn beginn(einheit_id: i64, rhythmus: Option<i64>) -> BeginnEingabe {
    BeginnEingabe {
        einheit_id,
        beginn_at: T0.into(),
        rhythmus_minuten: rhythmus,
    }
}

/// Offene Auto-Fristen der Schicht: `(bezug_typ, faellig_at)`, sortiert.
async fn offene_fristen(pool: &SqlitePool, id: i64) -> Vec<(String, String)> {
    sqlx::query_as(
        "SELECT bezug_typ, faellig_at FROM erinnerung \
         WHERE quelle = 'auto_frist' AND status = 'offen' AND bezug_id = ? \
           AND bezug_typ IN ('abloesung','abloesung_vorwarnung') ORDER BY bezug_typ",
    )
    .bind(id)
    .fetch_all(pool)
    .await
    .unwrap()
}

async fn etb(pool: &SqlitePool, e: i64) -> Vec<(String, String, Option<i64>, Option<String>)> {
    sqlx::query_as(
        "SELECT typ, inhalt, berichtigt_eintrag_id, ereigniszeit FROM etb_eintrag \
         WHERE einsatz_id = ? ORDER BY id",
    )
    .bind(e)
    .fetch_all(pool)
    .await
    .unwrap()
}

fn status(err: AppError) -> StatusCode {
    err.status()
}

// ── Schicht einer Einheit ───────────────────────────────────────────────────────────────────

#[tokio::test]
async fn schicht_beginnen_mit_eigenem_rhythmus() {
    let w = welt().await;
    let (a, _) = beginnen(
        &w.pool,
        w.e,
        w.b,
        &beginn(w.f1, Some(360)),
        "2026-09-22 09:30:00",
    )
    .await
    .unwrap();
    assert_eq!(a.faellig_at, "2026-09-22 15:30:00");
    assert_eq!(a.status, AbloesungStatus::Laufend);
    assert_eq!(a.rhythmus_quelle, RhythmusQuelle::Einheit);
    assert_eq!(a.abschnitt_name.as_deref(), Some("Deichwache Nord"));
    assert_eq!(a.einstufung, Some(Einstufung::Planmaessig));
    assert_eq!(
        offene_fristen(&w.pool, a.id).await,
        vec![
            ("abloesung".into(), "2026-09-22 15:30:00".into()),
            ("abloesung_vorwarnung".into(), "2026-09-22 15:00:00".into()),
        ],
        "Fristen zu 15:00 und 15:30"
    );
    let etb = etb(&w.pool, w.e).await;
    assert_eq!(etb.len(), 1);
    assert_eq!(etb[0].0, "system");
    assert!(
        etb[0].1.contains("Florian 1") && etb[0].1.contains("6 h"),
        "{}",
        etb[0].1
    );
}

#[tokio::test]
async fn zweite_laufende_schicht_ist_422() {
    let w = welt().await;
    beginnen(&w.pool, w.e, w.b, &beginn(w.f1, Some(360)), T0)
        .await
        .unwrap();
    let err = beginnen(&w.pool, w.e, w.b, &beginn(w.f1, Some(60)), T0)
        .await
        .unwrap_err();
    assert_eq!(status(err), StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(liste(&w.pool, w.e, None, T0).await.unwrap().len(), 1);
    assert_eq!(
        etb(&w.pool, w.e).await.len(),
        1,
        "der gescheiterte Versuch schreibt nichts"
    );
}

/// Die DB selbst hält „höchstens eine laufende je Einheit" — nicht nur der Precheck.
#[tokio::test]
async fn unique_index_haelt_eine_laufende_je_einheit() {
    let w = welt().await;
    let einfuegen = || {
        sqlx::query(
            "INSERT INTO einsatz_abloesung (einsatz_id, einheit_id, beginn_at, rhythmus_minuten, \
               rhythmus_quelle, faellig_at, angelegt_von_id) \
             VALUES (?, ?, ?, 60, 'einheit', ?, ?)",
        )
        .bind(w.e)
        .bind(w.f1)
        .bind(T0)
        .bind(T0)
        .bind(w.b)
        .execute(&w.pool)
    };
    einfuegen().await.unwrap();
    assert!(einfuegen().await.is_err());
}

#[tokio::test]
async fn fremde_einheit_ist_404() {
    let w = welt().await;
    let e2: i64 = sqlx::query_scalar(
        "INSERT INTO einsatz (org_id, bezeichnung) VALUES (1, 'X') RETURNING id",
    )
    .fetch_one(&w.pool)
    .await
    .unwrap();
    let fremd = einheit(&w.pool, e2, "Fremd", None).await;
    let err = beginnen(&w.pool, w.e, w.b, &beginn(fremd, Some(60)), T0)
        .await
        .unwrap_err();
    assert_eq!(status(err), StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn ohne_rhythmus_und_ohne_vorgabe_ist_400() {
    let w = welt().await;
    let err = beginnen(&w.pool, w.e, w.b, &beginn(w.f1, None), T0)
        .await
        .unwrap_err();
    assert_eq!(status(err), StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn ohne_rhythmus_uebernimmt_vorgabe() {
    let w = welt().await;
    vorgabe_setzen(&w.pool, w.e, w.abschnitt, w.b, Some(480), T0)
        .await
        .unwrap();
    let (a, _) = beginnen(&w.pool, w.e, w.b, &beginn(w.f1, None), T0)
        .await
        .unwrap();
    assert_eq!(a.rhythmus_minuten, 480);
    assert_eq!(a.rhythmus_quelle, RhythmusQuelle::Abschnitt);
    assert_eq!(a.faellig_at, "2026-09-22 17:30:00");
}

#[tokio::test]
async fn vorwarnung_nur_wenn_in_der_zukunft() {
    let w = welt().await;
    // Beginn 09:30 + 30 min = 10:00; jetzt 09:45 → Vorwarnung (09:30) liegt hinter uns.
    let (a, _) = beginnen(
        &w.pool,
        w.e,
        w.b,
        &beginn(w.f1, Some(30)),
        "2026-09-22 09:45:00",
    )
    .await
    .unwrap();
    assert_eq!(
        offene_fristen(&w.pool, a.id).await,
        vec![("abloesung".into(), "2026-09-22 10:00:00".into())]
    );
}

// ── Rhythmus-Vorgabe am Abschnitt ───────────────────────────────────────────────────────────

#[tokio::test]
async fn vorgabe_verkuerzt_zieht_folgende_schichten_mit() {
    let w = welt().await;
    let f3 = einheit(&w.pool, w.e, "Florian 3", Some(w.abschnitt)).await;
    let f4 = einheit(&w.pool, w.e, "Florian 4", Some(w.abschnitt)).await;
    vorgabe_setzen(&w.pool, w.e, w.abschnitt, w.b, Some(480), T0)
        .await
        .unwrap();
    let (a1, _) = beginnen(&w.pool, w.e, w.b, &beginn(w.f1, None), T0)
        .await
        .unwrap();
    let (a3, _) = beginnen(&w.pool, w.e, w.b, &beginn(f3, None), T0)
        .await
        .unwrap();
    let (a4, _) = beginnen(&w.pool, w.e, w.b, &beginn(f4, Some(120)), T0)
        .await
        .unwrap();

    let etb_id = vorgabe_setzen(&w.pool, w.e, w.abschnitt, w.b, Some(360), T0)
        .await
        .unwrap();
    assert!(etb_id.is_some());

    for id in [a1.id, a3.id] {
        let a = laden(&w.pool, w.e, id, T0).await.unwrap();
        assert_eq!(a.faellig_at, "2026-09-22 15:30:00", "120 min früher fällig");
        assert_eq!(
            offene_fristen(&w.pool, id).await[0].1,
            "2026-09-22 15:30:00",
            "Frist wandert mit"
        );
    }
    let a4n = laden(&w.pool, w.e, a4.id, T0).await.unwrap();
    assert_eq!(a4n.faellig_at, a4.faellig_at, "eigener Rhythmus bleibt");

    let letzter = etb(&w.pool, w.e).await.pop().unwrap();
    assert_eq!(letzter.0, "entscheidung");
    assert!(
        letzter.1.contains("Deichwache Nord")
            && letzter.1.contains("6 h")
            && letzter.1.contains("8 h"),
        "{}",
        letzter.1
    );
}

#[tokio::test]
async fn vorgabe_entfernen_behaelt_rhythmus() {
    let w = welt().await;
    vorgabe_setzen(&w.pool, w.e, w.abschnitt, w.b, Some(480), T0)
        .await
        .unwrap();
    let (a, _) = beginnen(&w.pool, w.e, w.b, &beginn(w.f1, None), T0)
        .await
        .unwrap();
    vorgabe_setzen(&w.pool, w.e, w.abschnitt, w.b, None, T0)
        .await
        .unwrap();
    let n = laden(&w.pool, w.e, a.id, T0).await.unwrap();
    assert_eq!(n.rhythmus_minuten, 480);
    assert_eq!(n.faellig_at, a.faellig_at);
    let v = vorgaben(&w.pool, w.e).await.unwrap();
    assert_eq!(v[0].rhythmus_minuten, None);
}

#[tokio::test]
async fn gleiche_vorgabe_schreibt_nichts() {
    let w = welt().await;
    vorgabe_setzen(&w.pool, w.e, w.abschnitt, w.b, Some(480), T0)
        .await
        .unwrap();
    let n = etb(&w.pool, w.e).await.len();
    assert!(
        vorgabe_setzen(&w.pool, w.e, w.abschnitt, w.b, Some(480), T0)
            .await
            .unwrap()
            .is_none()
    );
    assert_eq!(etb(&w.pool, w.e).await.len(), n);
}

// ── Schicht bearbeiten ──────────────────────────────────────────────────────────────────────

#[tokio::test]
async fn abloesende_einheit_planen() {
    let w = welt().await;
    let (a, _) = beginnen(&w.pool, w.e, w.b, &beginn(w.f1, Some(360)), T0)
        .await
        .unwrap();
    let (n, etb_id) = aendern(
        &w.pool,
        w.e,
        a.id,
        w.b,
        &AenderungEingabe {
            abloesende_einheit_id: Some(Some(w.f2)),
            ..Default::default()
        },
        T0,
    )
    .await
    .unwrap();
    assert_eq!(n.abloesende_einheit_name.as_deref(), Some("Florian 2"));
    assert!(etb_id.is_some());
}

#[tokio::test]
async fn selbstabloesung_ist_422() {
    let w = welt().await;
    let (a, _) = beginnen(&w.pool, w.e, w.b, &beginn(w.f1, Some(360)), T0)
        .await
        .unwrap();
    let err = aendern(
        &w.pool,
        w.e,
        a.id,
        w.b,
        &AenderungEingabe {
            abloesende_einheit_id: Some(Some(w.f1)),
            ..Default::default()
        },
        T0,
    )
    .await
    .unwrap_err();
    assert_eq!(status(err), StatusCode::UNPROCESSABLE_ENTITY);
}

#[tokio::test]
async fn rhythmus_aendern_verschiebt_fristen_und_loest_erneut_aus() {
    let w = welt().await;
    let (a, _) = beginnen(&w.pool, w.e, w.b, &beginn(w.f1, Some(360)), T0)
        .await
        .unwrap();
    // Die Vorwarnung war schon ausgelöst.
    let vorwarn: i64 = sqlx::query_scalar(
        "SELECT id FROM erinnerung WHERE bezug_typ = 'abloesung_vorwarnung' AND bezug_id = ?",
    )
    .bind(a.id)
    .fetch_one(&w.pool)
    .await
    .unwrap();
    erepo::markiere_ausgeloest(&w.pool, vorwarn, None, "2026-09-22 15:00:00")
        .await
        .unwrap();

    aendern(
        &w.pool,
        w.e,
        a.id,
        w.b,
        &AenderungEingabe {
            rhythmus_minuten: Some(Some(480)),
            ..Default::default()
        },
        "2026-09-22 15:05:00",
    )
    .await
    .unwrap();
    assert_eq!(
        offene_fristen(&w.pool, a.id).await,
        vec![
            ("abloesung".into(), "2026-09-22 17:30:00".into()),
            ("abloesung_vorwarnung".into(), "2026-09-22 17:00:00".into()),
        ]
    );
    let faellig = erepo::faellige_zum_ausloesen(&w.pool, "2026-09-22 17:00:00")
        .await
        .unwrap();
    assert!(
        faellig.iter().any(|f| f.id == vorwarn),
        "verschobene Vorwarnung löst erneut aus"
    );
}

#[tokio::test]
async fn zurueck_zur_vorgabe_ohne_vorgabe_ist_422() {
    let w = welt().await;
    let (a, _) = beginnen(&w.pool, w.e, w.b, &beginn(w.f1, Some(360)), T0)
        .await
        .unwrap();
    let err = aendern(
        &w.pool,
        w.e,
        a.id,
        w.b,
        &AenderungEingabe {
            rhythmus_minuten: Some(None),
            ..Default::default()
        },
        T0,
    )
    .await
    .unwrap_err();
    assert_eq!(status(err), StatusCode::UNPROCESSABLE_ENTITY);
}

#[tokio::test]
async fn abgeloeste_schicht_aendern_ist_422() {
    let w = welt().await;
    let (a, _) = beginnen(&w.pool, w.e, w.b, &beginn(w.f1, Some(360)), T0)
        .await
        .unwrap();
    vollziehen(
        &w.pool,
        w.e,
        a.id,
        w.b,
        "2026-09-22 15:40:00",
        None,
        "2026-09-22 15:40:00",
    )
    .await
    .unwrap();
    let err = aendern(
        &w.pool,
        w.e,
        a.id,
        w.b,
        &AenderungEingabe {
            rhythmus_minuten: Some(Some(60)),
            ..Default::default()
        },
        T0,
    )
    .await
    .unwrap_err();
    assert_eq!(status(err), StatusCode::UNPROCESSABLE_ENTITY);
}

// ── Einstufung ──────────────────────────────────────────────────────────────────────────────

#[tokio::test]
async fn einstufung_beim_lesen() {
    let w = welt().await;
    let (a, _) = beginnen(&w.pool, w.e, w.b, &beginn(w.f1, Some(360)), T0)
        .await
        .unwrap();
    let spaet = laden(&w.pool, w.e, a.id, "2026-09-22 15:31:00")
        .await
        .unwrap();
    assert_eq!(spaet.einstufung, Some(Einstufung::Ueberfaellig));
    let knapp = laden(&w.pool, w.e, a.id, "2026-09-22 15:05:00")
        .await
        .unwrap();
    assert_eq!(knapp.einstufung, Some(Einstufung::Vorwarnung));
}

// ── Vollzug mit Folgeschicht ────────────────────────────────────────────────────────────────

#[tokio::test]
async fn vollzug_mit_abloesender_einheit_legt_folgeschicht_an() {
    let w = welt().await;
    let (a, _) = beginnen(&w.pool, w.e, w.b, &beginn(w.f1, Some(360)), T0)
        .await
        .unwrap();
    let jetzt = "2026-09-22 15:40:00";
    let (v, etb_id) = vollziehen(&w.pool, w.e, a.id, w.b, jetzt, Some(w.f2), jetzt)
        .await
        .unwrap();
    assert_eq!(v.abgeloest.status, AbloesungStatus::Abgeloest);
    assert!(v.abgeloest.ruecknehmbar);
    let f = v.folgeschicht.expect("Folgeschicht");
    assert_eq!(f.einheit_name, "Florian 2");
    assert_eq!(f.beginn_at, "2026-09-22 15:40:00");
    assert_eq!(f.faellig_at, "2026-09-22 21:40:00");
    assert_eq!(
        f.abschnitt_name.as_deref(),
        Some("Deichwache Nord"),
        "erbt die Einsatzstelle"
    );
    assert_eq!(f.vorgaenger_id, Some(a.id));
    assert!(
        offene_fristen(&w.pool, a.id).await.is_empty(),
        "Fristen der abgelösten geschlossen"
    );
    assert_eq!(
        offene_fristen(&w.pool, f.id).await.len(),
        2,
        "Folgeschicht hat eigene Fristen"
    );

    let e = etb(&w.pool, w.e).await;
    let vollzug = e.last().unwrap();
    assert_eq!(vollzug.0, "meldung");
    assert!(
        vollzug.1.contains("Florian 1") && vollzug.1.contains("Florian 2"),
        "{}",
        vollzug.1
    );
    assert_eq!(
        vollzug.3.as_deref(),
        Some("2026-09-22 15:40:00"),
        "Zeitpunkt als Ereigniszeit"
    );
    let gespeichert: Option<i64> =
        sqlx::query_scalar("SELECT etb_vollzug_id FROM einsatz_abloesung WHERE id = ?")
            .bind(a.id)
            .fetch_one(&w.pool)
            .await
            .unwrap();
    assert_eq!(gespeichert, Some(etb_id));
}

#[tokio::test]
async fn vollzug_ohne_abloesende_einheit() {
    let w = welt().await;
    let (a, _) = beginnen(&w.pool, w.e, w.b, &beginn(w.f1, Some(360)), T0)
        .await
        .unwrap();
    let (v, _) = vollziehen(&w.pool, w.e, a.id, w.b, "2026-09-22 15:40:00", None, T0)
        .await
        .unwrap();
    assert!(v.folgeschicht.is_none());
    assert_eq!(
        liste(&w.pool, w.e, Some(AbloesungStatus::Laufend), T0)
            .await
            .unwrap()
            .len(),
        0
    );
}

#[tokio::test]
async fn abloeser_mit_laufender_schicht_ist_422_und_aendert_nichts() {
    let w = welt().await;
    let (a, _) = beginnen(&w.pool, w.e, w.b, &beginn(w.f1, Some(360)), T0)
        .await
        .unwrap();
    beginnen(&w.pool, w.e, w.b, &beginn(w.f2, Some(360)), T0)
        .await
        .unwrap();
    let n_etb = etb(&w.pool, w.e).await.len();
    let err = vollziehen(
        &w.pool,
        w.e,
        a.id,
        w.b,
        "2026-09-22 15:40:00",
        Some(w.f2),
        T0,
    )
    .await
    .unwrap_err();
    assert_eq!(status(err), StatusCode::UNPROCESSABLE_ENTITY);
    let a2 = laden(&w.pool, w.e, a.id, T0).await.unwrap();
    assert_eq!(
        a2.status,
        AbloesungStatus::Laufend,
        "ursprüngliche Schicht bleibt laufend"
    );
    assert_eq!(
        offene_fristen(&w.pool, a.id).await.len(),
        2,
        "Fristen unverändert offen"
    );
    assert_eq!(etb(&w.pool, w.e).await.len(), n_etb);
}

#[tokio::test]
async fn doppelter_vollzug_ist_422() {
    let w = welt().await;
    let (a, _) = beginnen(&w.pool, w.e, w.b, &beginn(w.f1, Some(360)), T0)
        .await
        .unwrap();
    vollziehen(&w.pool, w.e, a.id, w.b, "2026-09-22 15:40:00", None, T0)
        .await
        .unwrap();
    let err = vollziehen(&w.pool, w.e, a.id, w.b, "2026-09-22 15:41:00", None, T0)
        .await
        .unwrap_err();
    assert_eq!(status(err), StatusCode::UNPROCESSABLE_ENTITY);
}

#[tokio::test]
async fn vollzug_vor_beginn_ist_422() {
    let w = welt().await;
    let (a, _) = beginnen(&w.pool, w.e, w.b, &beginn(w.f1, Some(360)), T0)
        .await
        .unwrap();
    let err = vollziehen(&w.pool, w.e, a.id, w.b, "2026-09-22 09:00:00", None, T0)
        .await
        .unwrap_err();
    assert_eq!(status(err), StatusCode::UNPROCESSABLE_ENTITY);
}

// ── Rücknahme ───────────────────────────────────────────────────────────────────────────────

#[tokio::test]
async fn ruecknahme_direkt_nach_vollzug() {
    let w = welt().await;
    let (a, _) = beginnen(&w.pool, w.e, w.b, &beginn(w.f1, Some(360)), T0)
        .await
        .unwrap();
    // Fälligkeit war schon ausgelöst — die Rücknahme darf sie nicht erneut auslösen.
    let jetzt = "2026-09-22 15:40:00";
    for f in erepo::faellige_zum_ausloesen(&w.pool, jetzt).await.unwrap() {
        erepo::markiere_ausgeloest(&w.pool, f.id, None, jetzt)
            .await
            .unwrap();
    }
    let (v, vollzug_etb) = vollziehen(&w.pool, w.e, a.id, w.b, jetzt, Some(w.f2), jetzt)
        .await
        .unwrap();
    let folge = v.folgeschicht.unwrap();

    let (r, _) = zuruecknehmen(&w.pool, w.e, a.id, w.b, "2026-09-22 15:41:00")
        .await
        .unwrap();
    assert_eq!(r.status, AbloesungStatus::Laufend);
    assert_eq!(r.faellig_at, "2026-09-22 15:30:00", "alte Fälligkeit");
    assert!(
        laden(&w.pool, w.e, folge.id, jetzt).await.is_err(),
        "Folgeschicht entfernt"
    );
    assert!(offene_fristen(&w.pool, folge.id).await.is_empty());
    let geister: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM erinnerung WHERE bezug_id = ? AND bezug_typ LIKE 'abloesung%'",
    )
    .bind(folge.id)
    .fetch_one(&w.pool)
    .await
    .unwrap();
    assert_eq!(geister, 0, "keine Geister-Fristen der Folgeschicht");
    assert_eq!(
        offene_fristen(&w.pool, a.id).await,
        vec![("abloesung".into(), "2026-09-22 15:30:00".into())],
        "Fälligkeitsfrist wieder offen, die vergangene Vorwarnung nicht"
    );
    assert!(
        erepo::faellige_zum_ausloesen(&w.pool, "2026-09-22 15:42:00")
            .await
            .unwrap()
            .is_empty(),
        "keine erneute Auslösung"
    );
    let berichtigung = etb(&w.pool, w.e).await.pop().unwrap();
    assert_eq!(berichtigung.0, "berichtigung");
    assert_eq!(berichtigung.2, Some(vollzug_etb));

    // Florian 2 kann jetzt wieder eine eigene Schicht beginnen.
    beginnen(&w.pool, w.e, w.b, &beginn(w.f2, Some(60)), jetzt)
        .await
        .unwrap();
}

#[tokio::test]
async fn ruecknahme_nach_vollzug_der_folgeschicht_ist_422() {
    let w = welt().await;
    let (a, _) = beginnen(&w.pool, w.e, w.b, &beginn(w.f1, Some(360)), T0)
        .await
        .unwrap();
    let (v, _) = vollziehen(
        &w.pool,
        w.e,
        a.id,
        w.b,
        "2026-09-22 15:40:00",
        Some(w.f2),
        T0,
    )
    .await
    .unwrap();
    let folge = v.folgeschicht.unwrap();
    vollziehen(&w.pool, w.e, folge.id, w.b, "2026-09-22 21:40:00", None, T0)
        .await
        .unwrap();
    assert!(!laden(&w.pool, w.e, a.id, T0).await.unwrap().ruecknehmbar);
    let err = zuruecknehmen(&w.pool, w.e, a.id, w.b, T0)
        .await
        .unwrap_err();
    assert_eq!(status(err), StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(
        laden(&w.pool, w.e, a.id, T0).await.unwrap().status,
        AbloesungStatus::Abgeloest
    );
}

#[tokio::test]
async fn ruecknahme_ohne_vollzug_ist_422() {
    let w = welt().await;
    let (a, _) = beginnen(&w.pool, w.e, w.b, &beginn(w.f1, Some(360)), T0)
        .await
        .unwrap();
    let err = zuruecknehmen(&w.pool, w.e, a.id, w.b, T0)
        .await
        .unwrap_err();
    assert_eq!(status(err), StatusCode::UNPROCESSABLE_ENTITY);
}

// ── Einheit wird aufgelöst ──────────────────────────────────────────────────────────────────

#[tokio::test]
async fn aufgeloeste_einheit_hinterlaesst_keine_frist() {
    let w = welt().await;
    let (a, _) = beginnen(&w.pool, w.e, w.b, &beginn(w.f1, Some(360)), T0)
        .await
        .unwrap();
    crate::einheit::repo::loese_auf(&w.pool, w.e, w.f1)
        .await
        .unwrap();
    assert!(offene_fristen(&w.pool, a.id).await.is_empty());
    assert!(
        erepo::faellige_zum_ausloesen(&w.pool, "2026-09-23 00:00:00")
            .await
            .unwrap()
            .is_empty(),
        "der Scheduler löst nichts mehr aus"
    );
    assert!(liste(&w.pool, w.e, None, T0).await.unwrap().is_empty());
}
