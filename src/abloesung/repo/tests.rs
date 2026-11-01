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
        beginn_at: Some(T0.into()),
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

/// Vollzug mit höchstens einem Ablöser und ohne Abschnittsübergabe (Form vor LLH-1132); die
/// Liste prüft [`vollzug`].
async fn vollziehen(
    pool: &SqlitePool,
    e: i64,
    id: i64,
    b: i64,
    vollzogen_at: &str,
    abloeser: Option<i64>,
    jetzt: &str,
) -> Result<(AbloesungVollzugAnzeige, i64, VollzugWirkung), AppError> {
    vollzug(
        pool,
        e,
        id,
        b,
        vollzogen_at,
        &abloeser.into_iter().collect::<Vec<_>>(),
        false,
        jetzt,
    )
    .await
}

#[allow(clippy::too_many_arguments)]
async fn vollzug(
    pool: &SqlitePool,
    e: i64,
    id: i64,
    b: i64,
    vollzogen_at: &str,
    abloeser: &[i64],
    abschnitt_uebergeben: bool,
    jetzt: &str,
) -> Result<(AbloesungVollzugAnzeige, i64, VollzugWirkung), AppError> {
    super::vollziehen(
        pool,
        e,
        id,
        b,
        &VollzugEingabe {
            vollzogen_at: vollzogen_at.into(),
            abloeser: abloeser.to_vec(),
            abschnitt_uebergeben,
            ..Default::default()
        },
        jetzt,
    )
    .await
}

/// Vollzug als Besatzungswechsel (LLH-1150) mit der neuen Besatzung `neu`.
async fn besatzungswechsel(
    w: &Welt,
    id: i64,
    vollzogen_at: &str,
    neu: &[i64],
) -> Result<(AbloesungVollzugAnzeige, i64, VollzugWirkung), AppError> {
    super::vollziehen(
        &w.pool,
        w.e,
        id,
        w.b,
        &VollzugEingabe {
            vollzogen_at: vollzogen_at.into(),
            art: AbloesungArt::Besatzung,
            besatzung: neu.to_vec(),
            ..Default::default()
        },
        vollzogen_at,
    )
    .await
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
            abloeser: Some(vec![w.f2]),
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
            abloeser: Some(vec![w.f1]),
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
    let (v, etb_id, _) = vollziehen(&w.pool, w.e, a.id, w.b, jetzt, Some(w.f2), jetzt)
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
    let (v, _, _) = vollziehen(&w.pool, w.e, a.id, w.b, "2026-09-22 15:40:00", None, T0)
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

/// Nachtrag 17.10. (LLH-1132): Ein Ablöser, dessen laufende Schicht schon eine Folgeschicht ist,
/// lässt sich nicht übernehmen → 422, und nichts ändert sich.
#[tokio::test]
async fn abloeser_mit_laufender_folgeschicht_ist_422_und_aendert_nichts() {
    let w = welt().await;
    let f3 = einheit(&w.pool, w.e, "Florian 3", None).await;
    let (a, _) = beginnen(&w.pool, w.e, w.b, &beginn(w.f1, Some(360)), T0)
        .await
        .unwrap();
    let (b, _) = beginnen(&w.pool, w.e, w.b, &beginn(f3, Some(360)), T0)
        .await
        .unwrap();
    // Florian 2 löst Florian 3 ab und führt damit eine Folgeschicht.
    vollziehen(
        &w.pool,
        w.e,
        b.id,
        w.b,
        "2026-09-22 15:00:00",
        Some(w.f2),
        T0,
    )
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
    assert!(a2.abloeser.is_empty(), "die Liste bleibt, wie sie war");
    assert_eq!(
        offene_fristen(&w.pool, a.id).await.len(),
        2,
        "Fristen unverändert offen"
    );
    assert_eq!(etb(&w.pool, w.e).await.len(), n_etb);
}

/// Nachtrag 17.10. (LLH-1132): Hat der Ablöser schon eine eigene laufende Schicht ohne Vorgänger
/// (ungeplant eingetroffen), übernimmt der Vollzug sie als Folgeschicht: Beginn, Fälligkeit und
/// Fristen bleiben. Die Rücknahme löst sie wieder vom Vorgänger, statt sie zu löschen.
#[tokio::test]
async fn ungeplanter_abloeser_wird_uebernommen_und_bei_ruecknahme_geloest() {
    let w = welt().await;
    let (a, _) = beginnen(&w.pool, w.e, w.b, &beginn(w.f1, Some(360)), T0)
        .await
        .unwrap();
    let (eigene, _) = beginnen(
        &w.pool,
        w.e,
        w.b,
        &BeginnEingabe {
            einheit_id: w.f2,
            beginn_at: Some("2026-09-22 14:00:00".into()),
            rhythmus_minuten: Some(240),
        },
        T0,
    )
    .await
    .unwrap();
    let fristen = offene_fristen(&w.pool, eigene.id).await;
    let jetzt = "2026-09-22 15:40:00";
    let (v, _, _) = vollziehen(&w.pool, w.e, a.id, w.b, jetzt, Some(w.f2), jetzt)
        .await
        .unwrap();
    let f = v.folgeschicht.expect("übernommene Folgeschicht");
    assert_eq!(f.id, eigene.id, "keine neue Schicht");
    assert_eq!(f.vorgaenger_id, Some(a.id));
    assert!(f.uebernommen_bei_vollzug);
    assert_eq!(f.beginn_at, "2026-09-22 14:00:00", "Beginn bleibt");
    assert_eq!(f.faellig_at, eigene.faellig_at, "Fälligkeit bleibt");
    assert_eq!(offene_fristen(&w.pool, f.id).await, fristen);
    assert_eq!(
        v.abgeloest.folgeschichten,
        vec![AbloesungFolge {
            id: eigene.id,
            einheit_id: w.f2,
            einheit_name: "Florian 2".into(),
            status: AbloesungStatus::Laufend,
            uebernommen: true,
        }]
    );
    assert!(v.abgeloest.ruecknehmbar);
    let vollzug = etb(&w.pool, w.e).await.pop().unwrap().1;
    assert!(
        vollzug.contains("Laufende Schicht übernommen: «Florian 2»"),
        "{vollzug}"
    );

    let (r, _, _) = zuruecknehmen(&w.pool, w.e, a.id, w.b, jetzt).await.unwrap();
    assert_eq!(r.status, AbloesungStatus::Laufend);
    assert!(r.folgeschichten.is_empty());
    let geloest = laden(&w.pool, w.e, eigene.id, jetzt).await.unwrap();
    assert_eq!(geloest.status, AbloesungStatus::Laufend, "nicht gelöscht");
    assert_eq!(geloest.vorgaenger_id, None);
    assert!(!geloest.uebernommen_bei_vollzug);
    assert_eq!(offene_fristen(&w.pool, eigene.id).await, fristen);
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
    let (v, vollzug_etb, _) = vollziehen(&w.pool, w.e, a.id, w.b, jetzt, Some(w.f2), jetzt)
        .await
        .unwrap();
    let folge = v.folgeschicht.unwrap();

    let (r, _, _) = zuruecknehmen(&w.pool, w.e, a.id, w.b, "2026-09-22 15:41:00")
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
    let (v, _, _) = vollziehen(
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
    crate::einheit::repo::aufloesen(&w.pool, w.e, w.f1, w.b)
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
    assert!(liste(&w.pool, w.e, Some(AbloesungStatus::Laufend), T0)
        .await
        .unwrap()
        .is_empty());
    // LLH-1128 (Entscheidung 15.10.2026): beendet mit Spur statt gelöscht.
    let beendet = liste(&w.pool, w.e, Some(AbloesungStatus::Beendet), T0)
        .await
        .unwrap();
    assert_eq!(beendet.len(), 1);
    assert_eq!(beendet[0].id, a.id);
    assert_eq!(beendet[0].beendet_grund, Some(BeendetGrund::Aufloesung));
    assert_eq!(beendet[0].beendet_von_id, Some(w.b));
    assert!(beendet[0].beendet_at.is_some());
    assert_eq!(
        beendet[0].einstufung, None,
        "keine Einstufung, nie „laufend“"
    );
}

/// LLH-1079 (design.md D5), LLH-1128: Auflösen beendet die laufende Schicht mit Spur. Die
/// abgelöste Schicht bleibt als Vollzug stehen, die laufende Folgeschicht der aufgelösten Einheit
/// endet mit Grund `aufloesung` und ohne offene Fristen, und eine fremde Schicht verliert die
/// aufgelöste Einheit als geplante Ablösung.
#[tokio::test]
async fn aufloesen_behaelt_abgeloeste_schicht_und_leert_fremde_planung() {
    let w = welt().await;
    let (a, _) = beginnen(&w.pool, w.e, w.b, &beginn(w.f1, Some(360)), T0)
        .await
        .unwrap();
    let jetzt = "2026-09-22 15:40:00";
    let (v, _, _) = vollziehen(&w.pool, w.e, a.id, w.b, jetzt, Some(w.f2), jetzt)
        .await
        .unwrap();
    let folge = v.folgeschicht.unwrap();
    // Eine dritte Einheit plant f1 als Ablösung ihrer laufenden Schicht.
    let f3 = einheit(&w.pool, w.e, "Florian 3", None).await;
    let (c, _) = beginnen(&w.pool, w.e, w.b, &beginn(f3, Some(360)), T0)
        .await
        .unwrap();
    aendern(
        &w.pool,
        w.e,
        c.id,
        w.b,
        &AenderungEingabe {
            abloeser: Some(vec![w.f1]),
            ..Default::default()
        },
        T0,
    )
    .await
    .unwrap();

    let f1 = crate::einheit::repo::aufloesen(&w.pool, w.e, w.f1, w.b)
        .await
        .unwrap();
    assert!(f1.abloesung && !f1.geloescht, "{f1:?}");
    let status: String = sqlx::query_scalar("SELECT status FROM einsatz_abloesung WHERE id = ?")
        .bind(a.id)
        .fetch_one(&w.pool)
        .await
        .unwrap();
    assert_eq!(status, "abgeloest", "der Vollzug bleibt");
    let geplant: Option<i64> =
        sqlx::query_scalar("SELECT abloesende_einheit_id FROM einsatz_abloesung WHERE id = ?")
            .bind(c.id)
            .fetch_one(&w.pool)
            .await
            .unwrap();
    assert_eq!(geplant, None);

    let f2 = crate::einheit::repo::aufloesen(&w.pool, w.e, w.f2, w.b)
        .await
        .unwrap();
    assert!(f2.abloesung && !f2.geloescht, "{f2:?}");
    let (status, grund): (String, Option<String>) =
        sqlx::query_as("SELECT status, beendet_grund FROM einsatz_abloesung WHERE id = ?")
            .bind(folge.id)
            .fetch_one(&w.pool)
            .await
            .unwrap();
    assert_eq!(
        (status.as_str(), grund.as_deref()),
        ("beendet", Some("aufloesung")),
        "die laufende Schicht endet mit Spur"
    );
    assert!(offene_fristen(&w.pool, folge.id).await.is_empty());
}

/// LLH-1079 (Spec `kraefte-entlassung`, Schreibwege an beendeten Kräften): eine aufgelöste
/// Einheit bekommt keine Schicht, wird nicht als Ablösung geplant und löst niemanden ab.
#[tokio::test]
async fn aufgeloeste_einheit_ist_kein_ziel_der_abloesung() {
    let w = welt().await;
    let (a, _) = beginnen(&w.pool, w.e, w.b, &beginn(w.f1, Some(360)), T0)
        .await
        .unwrap();
    // Mit Spur, damit sie aufgelöst statt gelöscht wird.
    eintreffen(&w, w.f2, T0).await;
    let f2 = crate::einheit::repo::aufloesen(&w.pool, w.e, w.f2, w.b)
        .await
        .unwrap();
    assert!(!f2.geloescht, "{f2:?}");

    let neu = beginnen(&w.pool, w.e, w.b, &beginn(w.f2, Some(360)), T0).await;
    assert!(matches!(neu, Err(AppError::Conflict(_))), "{neu:?}");
    let geplant = aendern(
        &w.pool,
        w.e,
        a.id,
        w.b,
        &AenderungEingabe {
            abloeser: Some(vec![w.f2]),
            ..Default::default()
        },
        T0,
    )
    .await;
    assert!(matches!(geplant, Err(AppError::Conflict(_))), "{geplant:?}");
    let jetzt = "2026-09-22 15:40:00";
    let vollzug = vollziehen(&w.pool, w.e, a.id, w.b, jetzt, Some(w.f2), jetzt).await;
    assert!(matches!(vollzug, Err(AppError::Conflict(_))), "{vollzug:?}");
}

// ── Kräfte-Zeitachse (LFH-552) ──────────────────────────────────────────────────────────────

/// Schreibt ein Eintreffen der Einheit in die Kräfte-Zeitachse (wie ein markierter Status).
async fn eintreffen(w: &Welt, einheit: i64, zeit: &str) {
    let mut conn = w.pool.acquire().await.unwrap();
    crate::zeitachse::repo::schreibe_tx(
        &mut conn,
        w.e,
        w.b,
        crate::zeitachse::repo::Kraft::Einheit(einheit),
        crate::zeitachse::repo::Neu {
            art: crate::zeitachse::ZeitachseArt::Eintreffen,
            zeitpunkt_at: zeit,
            quelle: crate::zeitachse::ZeitachseQuelle::Status,
            notiz: None,
        },
    )
    .await
    .unwrap();
}

async fn perioden(w: &Welt, einheit: i64) -> Vec<crate::zeitachse::Einsatzperiode> {
    crate::zeitachse::repo::laden(
        &w.pool,
        w.e,
        crate::zeitachse::repo::Kraft::Einheit(einheit),
    )
    .await
    .unwrap()
    .perioden
}

/// MODIFIED `kraefte-abloesung` „Beginn fehlt, Einheit ist eingetroffen".
#[tokio::test]
async fn beginn_fehlt_uebernimmt_das_eintreffen() {
    let w = welt().await;
    eintreffen(&w, w.f1, "2026-09-22 06:40:00").await;
    let eingabe = BeginnEingabe {
        einheit_id: w.f1,
        beginn_at: None,
        rhythmus_minuten: Some(360),
    };
    let (a, _) = beginnen(&w.pool, w.e, w.b, &eingabe, "2026-09-22 09:00:00")
        .await
        .unwrap();
    assert_eq!(a.beginn_at, "2026-09-22 06:40:00");
    assert_eq!(a.faellig_at, "2026-09-22 12:40:00");
}

/// MODIFIED `kraefte-abloesung` „Beginn fehlt" ohne Eintreffen.
#[tokio::test]
async fn beginn_fehlt_ohne_eintreffen_ist_jetzt() {
    let w = welt().await;
    let eingabe = BeginnEingabe {
        einheit_id: w.f1,
        beginn_at: None,
        rhythmus_minuten: Some(360),
    };
    let (a, _) = beginnen(&w.pool, w.e, w.b, &eingabe, "2026-09-22 09:00:00")
        .await
        .unwrap();
    assert_eq!(a.beginn_at, "2026-09-22 09:00:00");
}

/// Spec `kraefte-zeitachse` „Vollzug beendet die Periode" und „Rücknahme öffnet die Periode
/// wieder"; die ablösende Einheit bekommt kein Ereignis.
#[tokio::test]
async fn vollzug_und_ruecknahme_fuehren_die_zeitachse() {
    let w = welt().await;
    eintreffen(&w, w.f1, T0).await;
    let (a, _) = beginnen(&w.pool, w.e, w.b, &beginn(w.f1, Some(360)), T0)
        .await
        .unwrap();
    let jetzt = "2026-09-22 15:40:00";
    vollziehen(&w.pool, w.e, a.id, w.b, jetzt, Some(w.f2), jetzt)
        .await
        .unwrap();
    let p = perioden(&w, w.f1).await;
    assert_eq!(p[0].ende_at.as_deref(), Some(jetzt));
    assert_eq!(
        p[0].ende_art,
        Some(crate::zeitachse::ZeitachseArt::Abloesung)
    );
    assert!(perioden(&w, w.f2).await.is_empty(), "Ablöser bleibt leer");

    zuruecknehmen(&w.pool, w.e, a.id, w.b, "2026-09-22 15:41:00")
        .await
        .unwrap();
    let p = perioden(&w, w.f1).await;
    assert_eq!(p[0].ende_at, None, "wieder offen");
}

/// Zweite Ablösung derselben Einheit: die Rücknahme trifft das Ereignis ihres eigenen Vollzugs,
/// nicht das des ersten (design.md D5, Risiko „Rücknahme über den Zeitpunkt").
#[tokio::test]
async fn ruecknahme_nach_zweiter_abloesung_trifft_die_richtige() {
    let w = welt().await;
    eintreffen(&w, w.f1, T0).await;
    let (a, _) = beginnen(&w.pool, w.e, w.b, &beginn(w.f1, Some(360)), T0)
        .await
        .unwrap();
    vollziehen(&w.pool, w.e, a.id, w.b, "2026-09-22 15:40:00", None, T0)
        .await
        .unwrap();
    eintreffen(&w, w.f1, "2026-09-22 20:00:00").await;
    let (b, _) = beginnen(
        &w.pool,
        w.e,
        w.b,
        &BeginnEingabe {
            einheit_id: w.f1,
            beginn_at: None,
            rhythmus_minuten: Some(360),
        },
        "2026-09-22 20:05:00",
    )
    .await
    .unwrap();
    assert_eq!(
        b.beginn_at, "2026-09-22 20:00:00",
        "Eintreffen der zweiten Periode"
    );
    vollziehen(&w.pool, w.e, b.id, w.b, "2026-09-23 02:00:00", None, T0)
        .await
        .unwrap();
    zuruecknehmen(&w.pool, w.e, b.id, w.b, "2026-09-23 02:01:00")
        .await
        .unwrap();
    let p = perioden(&w, w.f1).await;
    assert_eq!(p.len(), 2);
    assert_eq!(p[0].ende_at.as_deref(), Some("2026-09-22 15:40:00"));
    assert_eq!(p[1].ende_at, None);
}

/// LFH-933: die Folgeschicht ist ein Indexzugriff (`idx_abloesung_vorgaenger`), kein Scan über
/// die Ablösungen aller Einsätze. Geprüft für jeden Statusfilter der Liste: KEINE Zeile des
/// Abfrageplans ist ein `SCAN` — jede Tabelle (auch `a`, `fv` und `o`) wird über einen Index
/// oder den Primärschlüssel gesucht.
#[tokio::test]
async fn liste_plan_ohne_scan() {
    let w = welt().await;
    for status in [
        None,
        Some(AbloesungStatus::Laufend),
        Some(AbloesungStatus::Abgeloest),
        Some(AbloesungStatus::Beendet),
    ] {
        let plan = plan_zeilen(&w.pool, &liste_sql(status), w.e).await;
        assert!(
            plan.iter().any(|z| z.contains("idx_abloesung_vorgaenger")),
            "{status:?}: Folgeschicht über den Index: {plan:#?}"
        );
        assert!(
            !plan.iter().any(|z| z.starts_with("SCAN")),
            "{status:?}: kein Scan im Plan: {plan:#?}"
        );
    }
}

/// `EXPLAIN QUERY PLAN` als Textzeilen (`detail`-Spalte).
async fn plan_zeilen(pool: &SqlitePool, sql: &str, einsatz_id: i64) -> Vec<String> {
    use sqlx::Row;
    sqlx::query(sqlx::AssertSqlSafe(format!("EXPLAIN QUERY PLAN {sql}")))
        .bind(einsatz_id)
        .fetch_all(pool)
        .await
        .unwrap()
        .iter()
        .map(|r| r.get::<String, _>("detail"))
        .collect()
}

/// LLH-1122: Die Projektion nennt die Vorgabe der Vorwarnung als SQL-Literal; sie muss
/// [`VORWARNUNG_VORGABE_MINUTEN`] sein, sonst stuften Server und Fristen verschieden ein.
#[test]
fn vorwarnung_vorgabe_im_sql() {
    assert!(ANZEIGE_SELECT.contains(&format!(
        "COALESCE(m.vorwarnung_minuten, {VORWARNUNG_VORGABE_MINUTEN}) AS vorwarnung_minuten"
    )));
}

/// LLH-1122: ohne eigenen Wert und ohne Abschnittsvorgabe folgt die Schicht der Vorgabe des
/// Einsatzes; Wechselzeiten rechnen in dessen Zone, die Vorwarnung kommt aus dem Modell.
#[tokio::test]
async fn beginnen_folgt_der_einsatzvorgabe_mit_wechselzeiten() {
    let w = welt().await;
    let werte = crate::schichtmodell::Werte {
        bezeichnung: "12-h-Schicht".into(),
        regel: crate::schichtmodell::Regel::Wechselzeiten {
            zeiten: vec![
                crate::uhrzeit::Uhrzeit::parse("t", "06:00").unwrap(),
                crate::uhrzeit::Uhrzeit::parse("t", "18:00").unwrap(),
            ],
            mindestdauer_minuten: 240,
        },
        vorwarnung_minuten: 45,
        planungsvorlauf_minuten: 120,
    };
    let etb = set_einsatz_vorgabe(
        &w.pool,
        w.e,
        w.b,
        &EinsatzVorgabeInput::Werte(werte.clone()),
        T0,
    )
    .await
    .unwrap();
    assert!(etb.is_some());
    let (s, _) = beginnen(
        &w.pool,
        w.e,
        w.b,
        &BeginnEingabe {
            einheit_id: w.f2,
            // 13:42 Sommerzeit Berlin
            beginn_at: Some("2026-09-22 11:42:00".into()),
            rhythmus_minuten: None,
        },
        T0,
    )
    .await
    .unwrap();
    assert_eq!(s.rhythmus_quelle, RhythmusQuelle::Einsatz);
    assert_eq!(s.faellig_at, "2026-09-22 16:00:00");
    assert_eq!(s.rhythmus_minuten, 258);
    assert_eq!(s.vorwarnung_minuten, 45);
    let vorwarnung: String = sqlx::query_scalar(
        "SELECT faellig_at FROM erinnerung WHERE quelle = 'auto_frist' AND status = 'offen' \
           AND bezug_typ = 'abloesung_vorwarnung' AND bezug_id = ?",
    )
    .bind(s.id)
    .fetch_one(&w.pool)
    .await
    .unwrap();
    assert_eq!(vorwarnung, "2026-09-22 15:15:00");
    assert_eq!(
        einstufung(&s.faellig_at, "2026-09-22 15:15:00", s.vorwarnung_minuten),
        Einstufung::Vorwarnung
    );
}

// ── Review PR #833 (LLH-1122): Regressionstests ─────────────────────────────────────────────

fn rhythmus_werte(minuten: i64, vorwarnung: i64) -> crate::schichtmodell::Werte {
    crate::schichtmodell::Werte {
        bezeichnung: "Sanitätsdienst".into(),
        regel: crate::schichtmodell::Regel::Rhythmus { minuten },
        vorwarnung_minuten: vorwarnung,
        planungsvorlauf_minuten: 120,
    }
}

/// Fristen der Schicht `id`, die der Scheduler zu `jetzt` auslösen würde.
async fn ausloesbar(pool: &SqlitePool, id: i64, jetzt: &str) -> Vec<String> {
    erepo::faellige_zum_ausloesen(pool, jetzt)
        .await
        .unwrap()
        .into_iter()
        .filter(|f| f.bezug_id == Some(id))
        .filter_map(|f| f.bezug_typ)
        .collect()
}

/// Eine reine Änderung der Vorwarnung setzt die schon ausgelöste Fälligkeit einer überfälligen
/// Schicht nicht zurück: „fällig“ kommt genau einmal (Spec „Einmaliges Auslösen“). Ebenso beim
/// Entfernen einer Vorgabe mit Vorwarnung ≠ 30.
#[tokio::test]
async fn reine_vorwarnungsaenderung_loest_die_faelligkeit_nicht_erneut_aus() {
    let w = welt().await;
    let (a, _) = beginnen(&w.pool, w.e, w.b, &beginn(w.f2, Some(60)), T0)
        .await
        .unwrap();
    assert_eq!(a.faellig_at, "2026-09-22 10:30:00");
    let tick = "2026-09-22 10:31:00";
    for f in erepo::faellige_zum_ausloesen(&w.pool, tick).await.unwrap() {
        erepo::markiere_ausgeloest(&w.pool, f.id, None, tick)
            .await
            .unwrap();
    }
    set_einsatz_vorgabe(
        &w.pool,
        w.e,
        w.b,
        &EinsatzVorgabeInput::Werte(rhythmus_werte(360, 45)),
        "2026-09-22 10:33:00",
    )
    .await
    .unwrap();
    assert!(
        ausloesbar(&w.pool, a.id, "2026-09-22 10:34:00")
            .await
            .is_empty(),
        "keine zweite Auslösung nach der Vorwarnungsänderung"
    );
    set_einsatz_vorgabe(
        &w.pool,
        w.e,
        w.b,
        &EinsatzVorgabeInput::Remove,
        "2026-09-22 10:35:00",
    )
    .await
    .unwrap();
    assert!(
        ausloesbar(&w.pool, a.id, "2026-09-22 10:36:00")
            .await
            .is_empty(),
        "keine zweite Auslösung nach dem Entfernen"
    );
}

/// LLH-1469: das ETB schreibt die Wechselzeiten eines Schichtmodells in der Darstellung des
/// Einsatzes, beim Setzen der Vorgabe und beim Beginn einer Schicht, die ihr folgt: taktisch
/// (Vorgabe) „Wechsel 0600/1800“, „Datum und Uhrzeit“ „Wechsel 06:00/18:00“.
#[tokio::test]
async fn wechselzeiten_im_etb_folgen_der_darstellung_des_einsatzes() {
    let w = welt().await;
    let werte = |bezeichnung: &str| crate::schichtmodell::Werte {
        bezeichnung: bezeichnung.into(),
        regel: crate::schichtmodell::Regel::Wechselzeiten {
            zeiten: vec![
                crate::uhrzeit::Uhrzeit::parse("t", "06:00").unwrap(),
                crate::uhrzeit::Uhrzeit::parse("t", "18:00").unwrap(),
            ],
            mindestdauer_minuten: 240,
        },
        vorwarnung_minuten: 30,
        planungsvorlauf_minuten: 120,
    };
    let setzen = |bezeichnung: &'static str| {
        let pool = w.pool.clone();
        let (e, b) = (w.e, w.b);
        async move {
            set_einsatz_vorgabe(
                &pool,
                e,
                b,
                &EinsatzVorgabeInput::Werte(werte(bezeichnung)),
                T0,
            )
            .await
            .unwrap();
            etb(&pool, e).await.pop().unwrap().1
        }
    };
    let beginn_text = |einheit_id: i64| {
        let pool = w.pool.clone();
        let (e, b) = (w.e, w.b);
        async move {
            beginnen(
                &pool,
                e,
                b,
                &BeginnEingabe {
                    einheit_id,
                    beginn_at: Some("2026-09-22 11:42:00".into()),
                    rhythmus_minuten: None,
                },
                T0,
            )
            .await
            .unwrap();
            etb(&pool, e).await.pop().unwrap().1
        }
    };

    assert_eq!(
        setzen("Hochwasser").await,
        "Ablösung Einsatz: Schichtmodell «Hochwasser», Wechsel 0600/1800, Mindestdauer 4 h, \
         Vorwarnung 30 min gesetzt."
    );
    let t = beginn_text(w.f2).await;
    assert!(
        t.contains("Rhythmus Wechsel 0600/1800, Mindestdauer 4 h"),
        "{t}"
    );

    // Die Organisation wählt „Datum und Uhrzeit“, der Einsatz taktisch: der Einsatz geht vor.
    sqlx::query(
        "INSERT INTO org_einstellungen (org_id, zeitdarstellung) VALUES (1, 'datum_uhrzeit')",
    )
    .execute(&w.pool)
    .await
    .unwrap();
    sqlx::query(
        "INSERT INTO einsatz_einstellungen (einsatz_id, zeitdarstellung) VALUES (?, 'taktisch')",
    )
    .bind(w.e)
    .execute(&w.pool)
    .await
    .unwrap();
    assert!(setzen("Hochwasser 2").await.contains("Wechsel 0600/1800"));

    // Der Einsatz stellt „Datum und Uhrzeit“ ein.
    sqlx::query(
        "UPDATE einsatz_einstellungen SET zeitdarstellung = 'datum_uhrzeit' WHERE einsatz_id = ?",
    )
    .bind(w.e)
    .execute(&w.pool)
    .await
    .unwrap();
    assert_eq!(
        setzen("Hochwasser 3").await,
        "Ablösung Einsatz: Schichtmodell «Hochwasser 3», Wechsel 06:00/18:00, Mindestdauer 4 h, \
         Vorwarnung 30 min gesetzt (vorher «Hochwasser 2», Wechsel 06:00/18:00, Mindestdauer 4 h, \
         Vorwarnung 30 min)."
    );
    let f3 = einheit(&w.pool, w.e, "Florian 3", None).await;
    let t = beginn_text(f3).await;
    assert!(
        t.contains("Rhythmus Wechsel 06:00/18:00, Mindestdauer 4 h"),
        "{t}"
    );
}

/// Wird eine Einsatzvorgabe mit Wechselzeiten entfernt, bleibt die Fälligkeit sekundengenau
/// stehen — beim Entfernen und bei einer späteren Änderung ohne neuen Beginn oder Rhythmus.
#[tokio::test]
async fn entfernte_wechselzeiten_vorgabe_laesst_die_faelligkeit_stehen() {
    let w = welt().await;
    let werte = crate::schichtmodell::Werte {
        bezeichnung: "12-h-Schicht".into(),
        regel: crate::schichtmodell::Regel::Wechselzeiten {
            zeiten: vec![
                crate::uhrzeit::Uhrzeit::parse("t", "06:00").unwrap(),
                crate::uhrzeit::Uhrzeit::parse("t", "18:00").unwrap(),
            ],
            mindestdauer_minuten: 240,
        },
        vorwarnung_minuten: 30,
        planungsvorlauf_minuten: 120,
    };
    set_einsatz_vorgabe(&w.pool, w.e, w.b, &EinsatzVorgabeInput::Werte(werte), T0)
        .await
        .unwrap();
    let (a, _) = beginnen(
        &w.pool,
        w.e,
        w.b,
        &BeginnEingabe {
            einheit_id: w.f2,
            beginn_at: Some("2026-09-22 11:42:17".into()),
            rhythmus_minuten: None,
        },
        T0,
    )
    .await
    .unwrap();
    assert_eq!(a.faellig_at, "2026-09-22 16:00:00");
    set_einsatz_vorgabe(&w.pool, w.e, w.b, &EinsatzVorgabeInput::Remove, T0)
        .await
        .unwrap();
    assert_eq!(
        laden(&w.pool, w.e, a.id, T0).await.unwrap().faellig_at,
        "2026-09-22 16:00:00"
    );
    let (geaendert, _) = aendern(
        &w.pool,
        w.e,
        a.id,
        w.b,
        &AenderungEingabe {
            abloeser: Some(vec![w.f1]),
            ..Default::default()
        },
        T0,
    )
    .await
    .unwrap();
    assert_eq!(geaendert.faellig_at, "2026-09-22 16:00:00");
    assert_eq!(
        offene_fristen(&w.pool, a.id).await,
        vec![
            ("abloesung".into(), "2026-09-22 16:00:00".into()),
            ("abloesung_vorwarnung".into(), "2026-09-22 15:30:00".into()),
        ]
    );
}

/// Eine ungültige Zone des Einsatzes verdrängt keine gültige der Organisation; die erste
/// gültige gilt, sonst Europe/Berlin.
#[tokio::test]
async fn ungueltige_einsatzzone_verdraengt_die_org_zone_nicht() {
    let w = welt().await;
    let zone = |pool: SqlitePool, e: i64| async move {
        let mut conn = pool.acquire().await.unwrap();
        load_einsatz_vorgabe_tx(&mut conn, e)
            .await
            .unwrap()
            .stil
            .zone
    };
    let setze = |pool: SqlitePool, sql: &'static str, wert: Option<&'static str>, id: i64| async move {
        sqlx::query(sql)
            .bind(id)
            .bind(wert)
            .execute(&pool)
            .await
            .unwrap();
    };
    const EINSATZ: &str = "INSERT INTO einsatz_einstellungen (einsatz_id, zeitzone) VALUES (?, ?) \
         ON CONFLICT (einsatz_id) DO UPDATE SET zeitzone = excluded.zeitzone";
    const ORG: &str = "INSERT INTO org_einstellungen (org_id, zeitzone) VALUES (?, ?) \
         ON CONFLICT (org_id) DO UPDATE SET zeitzone = excluded.zeitzone";

    setze(w.pool.clone(), EINSATZ, Some("MEZ"), w.e).await;
    assert_eq!(zone(w.pool.clone(), w.e).await, chrono_tz::Europe::Berlin);
    setze(w.pool.clone(), ORG, Some("UTC"), 1).await;
    assert_eq!(
        zone(w.pool.clone(), w.e).await,
        chrono_tz::UTC,
        "ungültige Einsatzzone → gültige Org-Zone"
    );
    setze(w.pool.clone(), EINSATZ, Some("Europe/Vienna"), w.e).await;
    assert_eq!(zone(w.pool.clone(), w.e).await, chrono_tz::Europe::Vienna);
    setze(w.pool.clone(), ORG, Some("Mond/Basis"), 1).await;
    setze(w.pool.clone(), EINSATZ, None, w.e).await;
    assert_eq!(zone(w.pool.clone(), w.e).await, chrono_tz::Europe::Berlin);
}

/// Die Rücknahme setzt die Fristen nach der aktuellen Einsatzvorgabe: eine geänderte Vorwarnung
/// gilt für die wieder laufende Schicht, und folgt sie der Vorgabe, rechnet deren Regel neu.
#[tokio::test]
async fn ruecknahme_setzt_die_fristen_nach_der_aktuellen_vorgabe() {
    let w = welt().await;
    set_einsatz_vorgabe(
        &w.pool,
        w.e,
        w.b,
        &EinsatzVorgabeInput::Werte(rhythmus_werte(360, 30)),
        T0,
    )
    .await
    .unwrap();
    // f2 folgt der Einsatzvorgabe, f1 (Abschnitt ohne Vorgabe) hat einen eigenen Rhythmus.
    let (einsatz, _) = beginnen(&w.pool, w.e, w.b, &beginn(w.f2, None), T0)
        .await
        .unwrap();
    assert_eq!(einsatz.rhythmus_quelle, RhythmusQuelle::Einsatz);
    let (eigen, _) = beginnen(&w.pool, w.e, w.b, &beginn(w.f1, Some(360)), T0)
        .await
        .unwrap();
    for s in [einsatz.id, eigen.id] {
        vollziehen(
            &w.pool,
            w.e,
            s,
            w.b,
            "2026-09-22 10:00:00",
            None,
            "2026-09-22 10:00:00",
        )
        .await
        .unwrap();
    }
    set_einsatz_vorgabe(
        &w.pool,
        w.e,
        w.b,
        &EinsatzVorgabeInput::Werte(rhythmus_werte(240, 45)),
        "2026-09-22 10:05:00",
    )
    .await
    .unwrap();

    let (r, _, _) = zuruecknehmen(&w.pool, w.e, eigen.id, w.b, "2026-09-22 10:10:00")
        .await
        .unwrap();
    assert_eq!(
        r.faellig_at, "2026-09-22 15:30:00",
        "eigener Rhythmus bleibt"
    );
    assert_eq!(
        offene_fristen(&w.pool, eigen.id).await,
        vec![
            ("abloesung".into(), "2026-09-22 15:30:00".into()),
            ("abloesung_vorwarnung".into(), "2026-09-22 14:45:00".into()),
        ],
        "Vorwarnung nach der aktuellen Vorgabe"
    );

    let (r, _, _) = zuruecknehmen(&w.pool, w.e, einsatz.id, w.b, "2026-09-22 10:10:00")
        .await
        .unwrap();
    assert_eq!(
        r.faellig_at, "2026-09-22 13:30:00",
        "Regel der Vorgabe neu gerechnet"
    );
    assert_eq!(r.rhythmus_minuten, 240);
    assert_eq!(
        offene_fristen(&w.pool, einsatz.id).await,
        vec![
            ("abloesung".into(), "2026-09-22 13:30:00".into()),
            ("abloesung_vorwarnung".into(), "2026-09-22 12:45:00".into()),
        ]
    );
}

// ── Kopplung an die Kräfte-Zeitachse (LLH-1128) ─────────────────────────────────────────────

/// Weit in der Zukunft, damit beide Fristen vor der Serveruhr liegen, mit der die Kopplung
/// rechnet.
const ANKUNFT: &str = "2030-06-03 08:00:00";

/// Schreibt ein Ereignis an der Einheit über den einzigen Schreibpfad (wie ein markierter
/// Status) und liefert das Ergebnis samt dem, was es berührt hat.
async fn schreibe(
    w: &Welt,
    einheit: i64,
    art: crate::zeitachse::ZeitachseArt,
    zeit: &str,
) -> (
    crate::zeitachse::repo::Schreibergebnis,
    crate::zeitachse::repo::Beruehrt,
) {
    let mut tx = w.pool.begin().await.unwrap();
    let r = crate::zeitachse::repo::schreibe_tx(
        &mut tx,
        w.e,
        w.b,
        crate::zeitachse::repo::Kraft::Einheit(einheit),
        crate::zeitachse::repo::Neu {
            art,
            zeitpunkt_at: zeit,
            quelle: crate::zeitachse::ZeitachseQuelle::Status,
            notiz: None,
        },
    )
    .await
    .unwrap();
    tx.commit().await.unwrap();
    r
}

/// Wie [`schreibe`], das Ereignis muss geschrieben werden.
async fn ereignis(
    w: &Welt,
    einheit: i64,
    art: crate::zeitachse::ZeitachseArt,
    zeit: &str,
) -> crate::zeitachse::repo::Beruehrt {
    let (r, b) = schreibe(w, einheit, art, zeit).await;
    assert!(
        matches!(r, crate::zeitachse::repo::Schreibergebnis::Geschrieben(_)),
        "{art:?} {zeit}: {r:?}"
    );
    b
}

/// Streicht das jüngste nicht gestrichene Ereignis `art` der Einheit (Route „Streichung“).
async fn streiche(
    w: &Welt,
    einheit: i64,
    art: crate::zeitachse::ZeitachseArt,
) -> crate::zeitachse::repo::Beruehrt {
    let id: i64 = sqlx::query_scalar(
        "SELECT id FROM einsatz_kraft_zeitachse WHERE einheit_id = ? AND art = ? \
           AND gestrichen_at IS NULL ORDER BY id DESC LIMIT 1",
    )
    .bind(einheit)
    .bind(art.as_str())
    .fetch_one(&w.pool)
    .await
    .unwrap();
    let mut tx = w.pool.begin().await.unwrap();
    let g = crate::zeitachse::repo::streiche_tx(
        &mut tx,
        w.e,
        w.b,
        crate::zeitachse::repo::Kraft::Einheit(einheit),
        id,
        "Fehlbuchung",
        false,
    )
    .await
    .unwrap();
    tx.commit().await.unwrap();
    g.beruehrt
}

async fn set_einsatz_rhythmus(w: &Welt, minuten: i64) {
    set_einsatz_vorgabe(
        &w.pool,
        w.e,
        w.b,
        &EinsatzVorgabeInput::Werte(rhythmus_werte(minuten, 30)),
        T0,
    )
    .await
    .unwrap();
}

async fn schichten(w: &Welt, einheit: i64) -> Vec<AbloesungAnzeige> {
    liste(&w.pool, w.e, None, T0)
        .await
        .unwrap()
        .into_iter()
        .filter(|a| a.einheit_id == einheit)
        .collect()
}

async fn untereinheit(w: &Welt, name: &str, ueber: i64) -> i64 {
    sqlx::query_scalar(
        "INSERT INTO einsatz_einheit (einsatz_id, name, ueber_einheit_id) VALUES (?, ?, ?) \
         RETURNING id",
    )
    .bind(w.e)
    .bind(name)
    .bind(ueber)
    .fetch_one(&w.pool)
    .await
    .unwrap()
}

use crate::zeitachse::ZeitachseArt::{Alarmierung, Eintreffen, Entlassung};

/// Spec „Schicht mit dem Eintreffen“: Einsatzvorgabe 6 h → Beginn = Eintreffen, fällig +6 h,
/// beide Fristen, ETB mit Herkunft; die Kopplung meldet ihren ETB-Eintrag für die Live-Events.
#[tokio::test]
async fn eintreffen_beginnt_die_schicht_nach_der_einsatzvorgabe() {
    let w = welt().await;
    set_einsatz_rhythmus(&w, 360).await;
    let b = ereignis(&w, w.f2, Eintreffen, ANKUNFT).await;

    let s = schichten(&w, w.f2).await;
    assert_eq!(s.len(), 1);
    assert_eq!(s[0].status, AbloesungStatus::Laufend);
    assert_eq!(s[0].beginn_at, ANKUNFT);
    assert_eq!(s[0].faellig_at, "2030-06-03 14:00:00");
    assert_eq!(s[0].rhythmus_quelle, RhythmusQuelle::Einsatz);
    assert_eq!(
        offene_fristen(&w.pool, s[0].id).await,
        vec![
            ("abloesung".into(), "2030-06-03 14:00:00".into()),
            ("abloesung_vorwarnung".into(), "2030-06-03 13:30:00".into()),
        ]
    );
    let etb = etb(&w.pool, w.e).await;
    let beginn: Vec<_> = etb
        .iter()
        .filter(|(_, i, _, _)| i.contains("mit dem Eintreffen begonnen"))
        .collect();
    assert_eq!(beginn.len(), 1, "{etb:?}");
    assert!(
        beginn[0].1.contains("(Vorgabe Einsatz «Sanitätsdienst»)"),
        "{}",
        beginn[0].1
    );
    assert_eq!(b.abloesung.len(), 1, "der ETB-Eintrag für Kurzruf und Live");
}

/// Ohne Vorgabe keine Schicht: keine erfundene Zahl.
#[tokio::test]
async fn eintreffen_ohne_vorgabe_beginnt_keine_schicht() {
    let w = welt().await;
    let b = ereignis(&w, w.f1, Eintreffen, ANKUNFT).await;
    assert!(schichten(&w, w.f1).await.is_empty());
    assert!(b.abloesung.is_empty());
}

/// Rangfolge wie von Hand: die Vorgabe des Abschnitts vor der des Einsatzes.
#[tokio::test]
async fn autostart_nimmt_die_abschnittsvorgabe_vor_der_einsatzvorgabe() {
    let w = welt().await;
    set_einsatz_rhythmus(&w, 360).await;
    vorgabe_setzen(&w.pool, w.e, w.abschnitt, w.b, Some(480), T0)
        .await
        .unwrap();
    ereignis(&w, w.f1, Eintreffen, ANKUNFT).await;
    let s = schichten(&w, w.f1).await;
    assert_eq!(s[0].rhythmus_quelle, RhythmusQuelle::Abschnitt);
    assert_eq!(s[0].faellig_at, "2030-06-03 16:00:00");
}

/// Ein Eintreffen nach einer Alarmierung (Anker) beginnt die Schicht zum Eintreffen; ein
/// zweites in derselben Periode wird ausgelassen und legt keine zweite an, ebenso wenig ein
/// Eintreffen bei schon laufender (von Hand begonnener) Schicht. Nach der Entlassung beginnt das
/// nächste Eintreffen eine neue.
#[tokio::test]
async fn autostart_nur_ohne_laufende_schicht() {
    let w = welt().await;
    set_einsatz_rhythmus(&w, 360).await;
    ereignis(&w, w.f2, Alarmierung, "2030-06-03 07:30:00").await;
    ereignis(&w, w.f2, Eintreffen, ANKUNFT).await;
    let (r, b) = schreibe(&w, w.f2, Eintreffen, "2030-06-03 08:05:00").await;
    assert!(matches!(
        r,
        crate::zeitachse::repo::Schreibergebnis::Ausgelassen(_)
    ));
    assert!(b.abloesung.is_empty());
    let s = schichten(&w, w.f2).await;
    assert_eq!(s.len(), 1);
    assert_eq!(s[0].beginn_at, ANKUNFT);

    // Von Hand begonnen, dann eingetroffen: keine zweite.
    let f3 = einheit(&w.pool, w.e, "Florian 3", None).await;
    beginnen(&w.pool, w.e, w.b, &beginn(f3, Some(120)), T0)
        .await
        .unwrap();
    let b = ereignis(&w, f3, Eintreffen, ANKUNFT).await;
    assert!(b.abloesung.is_empty());
    assert_eq!(schichten(&w, f3).await.len(), 1);

    // Entlassen und wieder eingetroffen: eine neue Schicht.
    ereignis(&w, w.f2, Entlassung, "2030-06-03 12:00:00").await;
    ereignis(&w, w.f2, Eintreffen, "2030-06-04 08:00:00").await;
    let s = schichten(&w, w.f2).await;
    assert_eq!(s.len(), 2, "{s:?}");
    assert_eq!(s[0].status, AbloesungStatus::Laufend, "laufende zuerst");
    assert_eq!(s[0].beginn_at, "2030-06-04 08:00:00");
    assert_eq!(s[1].status, AbloesungStatus::Beendet);
}

/// Knoten-Modell (LLH-1118 Punkt 1): die Untereinheiten erben die Schicht des Knotens und
/// bekommen mit ihrem Eintreffen keine eigene. Von Hand begonnen übersteuert eine eigene für
/// den Teilbaum darunter.
#[tokio::test]
async fn untereinheit_erbt_die_schicht_des_knotens() {
    let w = welt().await;
    set_einsatz_rhythmus(&w, 360).await;
    let zug = w.f2;
    let gruppe = untereinheit(&w, "Gruppe 1", zug).await;
    let trupp = untereinheit(&w, "Trupp 1", gruppe).await;
    ereignis(&w, zug, Eintreffen, ANKUNFT).await;
    let b = ereignis(&w, gruppe, Eintreffen, ANKUNFT).await;
    ereignis(&w, trupp, Eintreffen, ANKUNFT).await;
    assert!(b.abloesung.is_empty());
    assert!(schichten(&w, gruppe).await.is_empty(), "erbt, keine eigene");
    assert!(schichten(&w, trupp).await.is_empty());
    let knoten = schichten(&w, zug).await;
    let erben: Vec<(i64, &str)> = knoten[0]
        .erbende_einheiten
        .iter()
        .map(|e| (e.einheit_id, e.einheit_name.as_str()))
        .collect();
    assert_eq!(erben, vec![(gruppe, "Gruppe 1"), (trupp, "Trupp 1")]);
    let mut conn = w.pool.acquire().await.unwrap();
    assert_eq!(
        load_wirksamen_traeger_tx(&mut conn, w.e, trupp)
            .await
            .unwrap(),
        Some(zug)
    );
    drop(conn);

    // Von Hand an der Gruppe: übersteuert für Gruppe und Trupp.
    let (eigen, _) = beginnen(&w.pool, w.e, w.b, &beginn(gruppe, Some(240)), T0)
        .await
        .unwrap();
    assert_eq!(
        eigen.erbende_einheiten,
        vec![AbloesungErbe {
            einheit_id: trupp,
            einheit_name: "Trupp 1".into()
        }]
    );
    assert!(schichten(&w, zug).await[0].erbende_einheiten.is_empty());
}

/// Spec „Ende mit der Entlassung“: beendet mit Spur, Fristen geschlossen, der Scheduler löst
/// nach der Fälligkeit nichts mehr aus (kein Fehlalarm „überfällig“), ETB-Eintrag.
#[tokio::test]
async fn entlassung_beendet_die_schicht() {
    let w = welt().await;
    set_einsatz_rhythmus(&w, 360).await;
    ereignis(&w, w.f2, Eintreffen, ANKUNFT).await;
    let id = schichten(&w, w.f2).await[0].id;
    let b = ereignis(&w, w.f2, Entlassung, "2030-06-03 12:00:00").await;
    assert_eq!(b.abloesung.len(), 1);

    let s = laden(&w.pool, w.e, id, T0).await.unwrap();
    assert_eq!(s.status, AbloesungStatus::Beendet);
    assert_eq!(s.beendet_grund, Some(BeendetGrund::Entlassung));
    assert_eq!(s.beendet_at.as_deref(), Some("2030-06-03 12:00:00"));
    assert_eq!(s.beendet_von_id, Some(w.b));
    assert_eq!(s.einstufung, None);
    assert!(!s.ruecknehmbar);
    assert!(offene_fristen(&w.pool, id).await.is_empty());
    assert!(
        ausloesbar(&w.pool, id, "2030-06-03 14:01:00")
            .await
            .is_empty(),
        "keine Erinnerung nach der Fälligkeit"
    );
    let live = crate::live::LiveHub::new();
    let mut rx = live.abonniere(w.e);
    crate::erinnerung::scheduler::tick_einmal(
        &w.pool,
        &live,
        crate::zeit::parse_utc("2030-06-03 14:01:00").unwrap(),
    )
    .await;
    while let Ok(n) = rx.try_recv() {
        assert_ne!(n.event.as_str(), "abloesung", "kein Hinweis: {}", n.data);
    }
    assert!(etb(&w.pool, w.e)
        .await
        .iter()
        .any(|(_, i, _, _)| i == "Ablösung: Schicht von «Florian 2» mit der Entlassung beendet"));

    // Eine beendete Schicht lässt sich weder ändern noch vollziehen.
    let e = aendern(
        &w.pool,
        w.e,
        id,
        w.b,
        &AenderungEingabe {
            rhythmus_minuten: Some(Some(60)),
            ..Default::default()
        },
        T0,
    )
    .await
    .unwrap_err();
    assert_eq!(status(e), StatusCode::UNPROCESSABLE_ENTITY);
    let e = vollziehen(&w.pool, w.e, id, w.b, "2030-06-03 13:00:00", None, T0)
        .await
        .unwrap_err();
    assert_eq!(status(e), StatusCode::UNPROCESSABLE_ENTITY);
}

/// Die Streichung genau dieser Entlassung öffnet die Schicht wieder, samt Fristen.
#[tokio::test]
async fn streichung_der_entlassung_oeffnet_die_schicht_wieder() {
    let w = welt().await;
    set_einsatz_rhythmus(&w, 360).await;
    ereignis(&w, w.f2, Eintreffen, ANKUNFT).await;
    let id = schichten(&w, w.f2).await[0].id;
    ereignis(&w, w.f2, Entlassung, "2030-06-03 12:00:00").await;
    let b = streiche(&w, w.f2, Entlassung).await;
    assert_eq!(b.abloesung.len(), 1);

    let s = laden(&w.pool, w.e, id, T0).await.unwrap();
    assert_eq!(s.status, AbloesungStatus::Laufend);
    assert_eq!(s.beendet_at, None);
    assert_eq!(s.beendet_grund, None);
    assert_eq!(
        offene_fristen(&w.pool, id).await,
        vec![
            ("abloesung".into(), "2030-06-03 14:00:00".into()),
            ("abloesung_vorwarnung".into(), "2030-06-03 13:30:00".into()),
        ]
    );
    assert!(etb(&w.pool, w.e)
        .await
        .iter()
        .any(|(_, i, _, _)| i.contains("läuft wieder, Entlassung gestrichen")));
}

/// Eine Entlassung, die eine frühere Periode schließt, während eine spätere offen bleibt
/// (Alarmierung 07:30, Eintreffen 08:00, Entlassung 07:45 nachgetragen), lässt die laufende
/// Schicht stehen.
#[tokio::test]
async fn entlassung_einer_frueheren_periode_laesst_die_schicht_stehen() {
    let w = welt().await;
    set_einsatz_rhythmus(&w, 360).await;
    ereignis(&w, w.f2, Alarmierung, "2030-06-03 07:30:00").await;
    ereignis(&w, w.f2, Eintreffen, ANKUNFT).await;
    let b = ereignis(&w, w.f2, Entlassung, "2030-06-03 07:45:00").await;
    assert!(b.abloesung.is_empty());
    let s = schichten(&w, w.f2).await;
    assert_eq!(s.len(), 1);
    assert_eq!(s[0].status, AbloesungStatus::Laufend);
}

/// Auflösen schreibt die Entlassung der Einheit, die Schicht endet aber mit Grund
/// `aufloesung` (das Auflösen beendet sie vorher).
#[tokio::test]
async fn aufloesen_nach_autostart_beendet_mit_grund_aufloesung() {
    let w = welt().await;
    set_einsatz_rhythmus(&w, 360).await;
    ereignis(&w, w.f2, Eintreffen, ANKUNFT).await;
    let id = schichten(&w, w.f2).await[0].id;
    crate::einheit::repo::aufloesen(&w.pool, w.e, w.f2, w.b)
        .await
        .unwrap();
    let grund: Option<String> =
        sqlx::query_scalar("SELECT beendet_grund FROM einsatz_abloesung WHERE id = ?")
            .bind(id)
            .fetch_one(&w.pool)
            .await
            .unwrap();
    assert_eq!(grund.as_deref(), Some("aufloesung"));
}

/// Spec „Fehler im Autostart“: scheitert der Autostart mitten im Schreiben (hier an den Fristen,
/// nach dem Anlegen der Schicht), gelingt das Eintreffen trotzdem, und von der Schicht bleibt
/// nichts zurück.
#[tokio::test]
async fn fehler_im_autostart_bricht_das_eintreffen_nicht() {
    let w = welt().await;
    set_einsatz_rhythmus(&w, 360).await;
    sqlx::query(
        "CREATE TRIGGER frist_scheitert BEFORE INSERT ON erinnerung \
         BEGIN SELECT RAISE(ABORT, 'erzwungen'); END",
    )
    .execute(&w.pool)
    .await
    .unwrap();
    let b = ereignis(&w, w.f2, Eintreffen, ANKUNFT).await;
    assert!(b.abloesung.is_empty());
    assert_eq!(
        perioden(&w, w.f2).await[0].eintreffen_at.as_deref(),
        Some(ANKUNFT),
        "das Eintreffen steht"
    );
    let n: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM einsatz_abloesung WHERE einheit_id = ?")
        .bind(w.f2)
        .fetch_one(&w.pool)
        .await
        .unwrap();
    assert_eq!(n, 0, "der Savepoint nimmt die halbe Schicht zurück");
}

/// Eine als ablösende geplante Einheit bekommt mit ihrem Eintreffen keine Schicht: sonst
/// scheiterte der Vollzug an ihrer laufenden Schicht. Ihre Schicht entsteht mit dem Vollzug.
#[tokio::test]
async fn geplanter_abloeser_bekommt_beim_eintreffen_keine_schicht() {
    let w = welt().await;
    set_einsatz_rhythmus(&w, 360).await;
    ereignis(&w, w.f1, Eintreffen, ANKUNFT).await;
    let a = schichten(&w, w.f1).await[0].id;
    aendern(
        &w.pool,
        w.e,
        a,
        w.b,
        &AenderungEingabe {
            abloeser: Some(vec![w.f2]),
            ..Default::default()
        },
        T0,
    )
    .await
    .unwrap();
    let b = ereignis(&w, w.f2, Eintreffen, "2030-06-03 13:30:00").await;
    assert!(b.abloesung.is_empty());
    assert!(schichten(&w, w.f2).await.is_empty());
    let (v, _, _) = vollziehen(
        &w.pool,
        w.e,
        a,
        w.b,
        "2030-06-03 14:00:00",
        Some(w.f2),
        "2030-06-03 14:00:00",
    )
    .await
    .unwrap();
    assert_eq!(
        v.folgeschicht.unwrap().beginn_at,
        "2030-06-03 14:00:00",
        "Folgeschicht ab dem Vollzug"
    );
}

// ── Hinweise zur ablösenden Einheit (LLH-1131) ──────────────────────────────────────────────

use crate::benachrichtigung::BenachrichtigungBezugTyp as Bezugstyp;

/// Beginn der Schichten dieses Abschnitts: weit genug in der Zukunft, dass der Planungshinweis
/// (2 h vor der Fälligkeit) auch gegen die echte Uhr der Kopplung noch vor uns liegt.
const BEGINN_ZUKUNFT: &str = "2030-06-03 08:00:00";

/// Offene Planungs-Frist der Schicht, `None` ohne eine.
async fn planung_frist(pool: &SqlitePool, id: i64) -> Option<String> {
    sqlx::query_scalar(
        "SELECT faellig_at FROM erinnerung WHERE quelle = 'auto_frist' AND status = 'offen' \
           AND bezug_typ = 'abloesung_planung' AND bezug_id = ?",
    )
    .bind(id)
    .fetch_optional(pool)
    .await
    .unwrap()
}

/// Schicht von `einheit`, Beginn [`BEGINN_ZUKUNFT`], 6 h: fällig 14:00, Planungshinweis 12:00.
async fn schicht_zukunft(w: &Welt, einheit: i64) -> i64 {
    beginnen(
        &w.pool,
        w.e,
        w.b,
        &BeginnEingabe {
            einheit_id: einheit,
            beginn_at: Some(BEGINN_ZUKUNFT.into()),
            rhythmus_minuten: Some(360),
        },
        T0,
    )
    .await
    .unwrap()
    .0
    .id
}

async fn plane(w: &Welt, schicht: i64, abloeser: Option<i64>) -> AbloesungAnzeige {
    aendern(
        &w.pool,
        w.e,
        schicht,
        w.b,
        &AenderungEingabe {
            abloeser: Some(abloeser.into_iter().collect()),
            ..Default::default()
        },
        T0,
    )
    .await
    .unwrap()
    .0
}

fn anlass(w: &Welt, schicht: i64, typ: Bezugstyp) -> crate::benachrichtigung::Anlass {
    crate::abloesung::hinweis::anlass(w.e, schicht, typ, w.b)
}

/// Spec „Planungshinweis“: die dritte Frist liegt den Planungsvorlauf (Vorgabe 2 h) vor der
/// Fälligkeit, gibt es nur ohne geplante ablösende Einheit, kommt mit einer aufgehobenen Planung
/// wieder, wandert mit der Fälligkeit und mit dem Vorlauf des Schichtmodells, und der Vollzug
/// schließt sie.
#[tokio::test]
async fn planungshinweis_liegt_zwei_stunden_vor_der_faelligkeit_und_nur_ohne_planung() {
    let w = welt().await;
    let id = schicht_zukunft(&w, w.f1).await;
    assert_eq!(
        planung_frist(&w.pool, id).await.as_deref(),
        Some("2030-06-03 12:00:00")
    );

    plane(&w, id, Some(w.f2)).await;
    assert_eq!(
        planung_frist(&w.pool, id).await,
        None,
        "geplant: kein Hinweis"
    );
    plane(&w, id, None).await;
    assert_eq!(
        planung_frist(&w.pool, id).await.as_deref(),
        Some("2030-06-03 12:00:00"),
        "Planung aufgehoben: der Hinweis steht wieder an"
    );

    aendern(
        &w.pool,
        w.e,
        id,
        w.b,
        &AenderungEingabe {
            beginn_at: Some("2030-06-03 09:00:00".into()),
            ..Default::default()
        },
        T0,
    )
    .await
    .unwrap();
    assert_eq!(
        planung_frist(&w.pool, id).await.as_deref(),
        Some("2030-06-03 13:00:00"),
        "verschiebt sich mit der Fälligkeit"
    );

    // Ein Schichtmodell mit 90 min Planungsvorlauf zieht die Frist nach, auch wenn die
    // Fälligkeit (eigener Rhythmus) bleibt.
    let mut werte = rhythmus_werte(480, 30);
    werte.planungsvorlauf_minuten = 90;
    set_einsatz_vorgabe(&w.pool, w.e, w.b, &EinsatzVorgabeInput::Werte(werte), T0)
        .await
        .unwrap();
    assert_eq!(
        planung_frist(&w.pool, id).await.as_deref(),
        Some("2030-06-03 13:30:00")
    );

    vollziehen(
        &w.pool,
        w.e,
        id,
        w.b,
        "2030-06-03 12:00:00",
        None,
        "2030-06-03 12:00:00",
    )
    .await
    .unwrap();
    assert_eq!(
        planung_frist(&w.pool, id).await,
        None,
        "der Vollzug schließt"
    );
}

/// Liegt der Zeitpunkt schon hinter uns (kurzer Rhythmus), entsteht keine Planungs-Frist: ein
/// Planungshinweis in der Vergangenheit ist keiner mehr (wie die Vorwarnung).
#[tokio::test]
async fn planungshinweis_in_der_vergangenheit_entsteht_nicht() {
    let w = welt().await;
    let (a, _) = beginnen(&w.pool, w.e, w.b, &beginn(w.f1, Some(90)), T0)
        .await
        .unwrap();
    assert_eq!(planung_frist(&w.pool, a.id).await, None);
}

/// Spec „Hinweise zur ablösenden Einheit“: Alarmierung und Eintreffen der geplanten Einheit
/// werden je genau ein Anlass an die Schicht; ein zweites Eintreffen (ausgelassen), eine nicht
/// geplante Einheit und das Eintreffen am Bereitstellungsraum (meldet dessen Buchung) melden über
/// die Kopplung nichts.
#[tokio::test]
async fn alarmierung_und_eintreffen_der_geplanten_einheit_werden_je_ein_anlass() {
    let w = welt().await;
    let id = schicht_zukunft(&w, w.f1).await;
    plane(&w, id, Some(w.f2)).await;

    let b = ereignis(&w, w.f2, Alarmierung, "2030-06-03 10:00:00").await;
    assert_eq!(
        b.hinweise,
        vec![anlass(&w, id, Bezugstyp::AbloeserAlarmiert)]
    );
    let b = ereignis(&w, w.f2, Eintreffen, "2030-06-03 10:40:00").await;
    assert_eq!(
        b.hinweise,
        vec![anlass(&w, id, Bezugstyp::AbloeserEingetroffen)]
    );
    let (_, b) = schreibe(&w, w.f2, Eintreffen, "2030-06-03 10:41:00").await;
    assert!(b.hinweise.is_empty(), "ausgelassen: kein zweiter Hinweis");

    let f3 = einheit(&w.pool, w.e, "Florian 3", None).await;
    let b = ereignis(&w, f3, Alarmierung, "2030-06-03 10:00:00").await;
    assert!(b.hinweise.is_empty(), "nicht geplant");

    // Eine zweite Schicht plant f3 über die Ablöser-Liste (LLH-1118 Punkt 3).
    let f4 = einheit(&w.pool, w.e, "Florian 4", None).await;
    let id4 = schicht_zukunft(&w, f4).await;
    sqlx::query("INSERT INTO einsatz_abloesung_abloeser (abloesung_id, einheit_id) VALUES (?, ?)")
        .bind(id4)
        .bind(f3)
        .execute(&w.pool)
        .await
        .unwrap();
    let mut tx = w.pool.begin().await.unwrap();
    let (_, b) = crate::zeitachse::repo::schreibe_tx(
        &mut tx,
        w.e,
        w.b,
        crate::zeitachse::repo::Kraft::Einheit(f3),
        crate::zeitachse::repo::Neu {
            art: Eintreffen,
            zeitpunkt_at: "2030-06-03 10:30:00",
            quelle: crate::zeitachse::ZeitachseQuelle::Bereitstellungsraum,
            notiz: None,
        },
    )
    .await
    .unwrap();
    tx.commit().await.unwrap();
    assert!(
        b.hinweise.is_empty(),
        "das Eintreffen am Raum meldet die Buchung, nicht die Kopplung"
    );
    let b = ereignis(&w, f3, Entlassung, "2030-06-03 11:00:00").await;
    assert_eq!(
        b.hinweise,
        vec![anlass(&w, id4, Bezugstyp::AbloeserEntfallen)],
        "auch ein Eintrag der Ablöser-Liste entfällt"
    );
}

/// Ein Nachtrag in einen abgeschlossenen Einsatzabschnitt der geplanten Einheit meldet nichts:
/// Alarmierung und Eintreffen zählen nur als Beginn der offenen Periode.
#[tokio::test]
async fn nachtrag_in_eine_abgeschlossene_periode_meldet_nichts() {
    let w = welt().await;
    let id = schicht_zukunft(&w, w.f1).await;
    plane(&w, id, Some(w.f2)).await;
    // Frühere Perioden von f2, mit einer Ablösung geschlossen (keine Entlassung: die Planung
    // entfiele sonst): eine nur mit Alarmierung, eine nur mit Eintreffen.
    use crate::zeitachse::ZeitachseArt::Abloesung;
    ereignis(&w, w.f2, Alarmierung, "2030-06-03 06:00:00").await;
    ereignis(&w, w.f2, Abloesung, "2030-06-03 07:00:00").await;
    ereignis(&w, w.f2, Eintreffen, "2030-06-03 08:00:00").await;
    ereignis(&w, w.f2, Abloesung, "2030-06-03 08:30:00").await;

    let b = ereignis(&w, w.f2, Eintreffen, "2030-06-03 06:30:00").await;
    assert!(
        b.hinweise.is_empty(),
        "Eintreffen nachgetragen: {:?}",
        b.hinweise
    );
    let b = ereignis(&w, w.f2, Alarmierung, "2030-06-03 07:50:00").await;
    assert!(
        b.hinweise.is_empty(),
        "Alarmierung nachgetragen: {:?}",
        b.hinweise
    );
}

/// Spec „Planung entfällt“: die Entlassung der geplanten Einheit hebt die Planung auf, mit ETB
/// und Hinweis, und der Planungshinweis steht wieder an.
#[tokio::test]
async fn entlassung_der_geplanten_einheit_laesst_die_planung_entfallen() {
    let w = welt().await;
    let id = schicht_zukunft(&w, w.f1).await;
    plane(&w, id, Some(w.f2)).await;
    ereignis(&w, w.f2, Alarmierung, "2030-06-03 10:00:00").await;

    let b = ereignis(&w, w.f2, Entlassung, "2030-06-03 10:30:00").await;
    assert_eq!(
        b.hinweise,
        vec![anlass(&w, id, Bezugstyp::AbloeserEntfallen)]
    );
    assert_eq!(b.abloesung.len(), 1, "der ETB-Eintrag für Kurzruf und Live");
    let a = laden(&w.pool, w.e, id, T0).await.unwrap();
    assert_eq!(a.abloesende_einheit_id, None);
    let etb = etb(&w.pool, w.e).await;
    assert!(
        etb.iter().any(|(_, i, _, _)| i
            == "Ablösung «Florian 1»: Planung der ablösenden Einheit entfallen, «Florian 2» entlassen"),
        "{etb:?}"
    );
    assert_eq!(
        planung_frist(&w.pool, id).await.as_deref(),
        Some("2030-06-03 12:00:00"),
        "ohne Planung steht der Planungshinweis wieder an"
    );
    let v = a
        .planung_entfallen
        .expect("Vermerk an der Schicht (LLH-1309)");
    assert_eq!(v.grund, crate::abloesung::PlanungEntfallenGrund::Entlassung);
    assert_eq!(v.einheit_name, "Florian 2");
}

/// Spec „Planung entfällt“: das Auflösen der geplanten Einheit hebt die Planung selbst auf, mit
/// ETB und Hinweis, statt sie einem still leerenden FK `SET NULL` zu überlassen.
#[tokio::test]
async fn aufloesen_der_geplanten_einheit_laesst_die_planung_mit_hinweis_entfallen() {
    let w = welt().await;
    let id = schicht_zukunft(&w, w.f1).await;
    plane(&w, id, Some(w.f2)).await;

    let f = crate::einheit::repo::aufloesen(&w.pool, w.e, w.f2, w.b)
        .await
        .unwrap();
    assert!(
        !f.geloescht,
        "die Planung ist eine Spur: aufgelöst, nicht gelöscht"
    );
    assert!(f.abloesung);
    let a = laden(&w.pool, w.e, id, T0).await.unwrap();
    assert_eq!(a.abloesende_einheit_id, None);
    assert_eq!(
        f.abloesung_wirkung.anlaesse,
        vec![anlass(&w, id, Bezugstyp::AbloeserEntfallen)]
    );
    assert_eq!(f.abloesung_wirkung.etb.len(), 1);
    let etb = etb(&w.pool, w.e).await;
    assert!(
        etb.iter().any(|(_, i, _, _)| i
            == "Ablösung «Florian 1»: Planung der ablösenden Einheit entfallen, «Florian 2» aufgelöst"),
        "{etb:?}"
    );
    assert_eq!(
        a.planung_entfallen
            .as_ref()
            .map(|v| (v.grund, v.einheit_name.as_str())),
        Some((
            crate::abloesung::PlanungEntfallenGrund::Aufloesung,
            "Florian 2"
        )),
        "Vermerk an der Schicht (LLH-1309)"
    );
}

/// Spec „Planung entfällt“, LLH-1309: eine neue Planung räumt den Vermerk; bleibt danach wieder
/// keiner, taucht der alte nicht wieder auf.
#[tokio::test]
async fn neue_planung_raeumt_den_vermerk_der_entfallenen() {
    let w = welt().await;
    let id = schicht_zukunft(&w, w.f1).await;
    plane(&w, id, Some(w.f2)).await;
    crate::einheit::repo::aufloesen(&w.pool, w.e, w.f2, w.b)
        .await
        .unwrap();
    assert!(laden(&w.pool, w.e, id, T0)
        .await
        .unwrap()
        .planung_entfallen
        .is_some());

    let f3 = einheit(&w.pool, w.e, "Florian 3", None).await;
    let a = plane(&w, id, Some(f3)).await;
    assert_eq!(a.planung_entfallen, None, "neue Planung");
    let a = plane(&w, id, None).await;
    assert_eq!(a.planung_entfallen, None, "Planung von Hand aufgehoben");
}

/// LLH-1309: die Tabelle nimmt den Vermerk nur ganz oder gar nicht, auch ohne Grund.
#[tokio::test]
async fn vermerk_nur_vollstaendig() {
    let w = welt().await;
    let id = schicht_zukunft(&w, w.f1).await;
    for (at, grund, name) in [
        (Some(T0), None, Some("Florian 2")),
        (Some(T0), None, None),
        (None, None, Some("Florian 2")),
        (Some(T0), Some("aufloesung"), None),
        (None, Some("entlassung"), Some("Florian 2")),
        (Some(T0), Some("verschwunden"), Some("Florian 2")),
    ] {
        let r = sqlx::query(
            "UPDATE einsatz_abloesung SET planung_entfallen_at = ?, \
             planung_entfallen_grund = ?, planung_entfallen_einheit_name = ? WHERE id = ?",
        )
        .bind(at)
        .bind(grund)
        .bind(name)
        .bind(id)
        .execute(&w.pool)
        .await;
        assert!(r.is_err(), "Teilstand {at:?}/{grund:?}/{name:?} angenommen");
    }
    sqlx::query(
        "UPDATE einsatz_abloesung SET planung_entfallen_at = ?, \
         planung_entfallen_grund = 'aufloesung', planung_entfallen_einheit_name = 'Florian 2' \
         WHERE id = ?",
    )
    .bind(T0)
    .bind(id)
    .execute(&w.pool)
    .await
    .unwrap();
}

/// LLH-1309: entfällt einer von zwei Ablösern, zeigt die Schicht keinen Vermerk, solange der
/// andere geplant bleibt; entfällt auch er, nennt der Vermerk den jüngsten.
#[tokio::test]
async fn vermerk_zeigt_sich_erst_ohne_verbleibenden_abloeser() {
    let w = welt().await;
    let id = schicht_zukunft(&w, w.f1).await;
    let f3 = einheit(&w.pool, w.e, "Florian 3", None).await;
    aendern(
        &w.pool,
        w.e,
        id,
        w.b,
        &AenderungEingabe {
            abloeser: Some(vec![w.f2, f3]),
            ..Default::default()
        },
        T0,
    )
    .await
    .unwrap();

    ereignis(&w, w.f2, Alarmierung, "2030-06-03 10:00:00").await;
    ereignis(&w, w.f2, Entlassung, "2030-06-03 10:30:00").await;
    let a = laden(&w.pool, w.e, id, T0).await.unwrap();
    assert_eq!(a.abloesende_einheit_id, Some(f3));
    assert_eq!(a.planung_entfallen, None, "Florian 3 bleibt geplant");

    crate::einheit::repo::aufloesen(&w.pool, w.e, f3, w.b)
        .await
        .unwrap();
    let a = laden(&w.pool, w.e, id, T0).await.unwrap();
    assert_eq!(
        a.planung_entfallen
            .as_ref()
            .map(|v| (v.grund, v.einheit_name.as_str())),
        Some((
            crate::abloesung::PlanungEntfallenGrund::Aufloesung,
            "Florian 3"
        ))
    );
}

/// Spec „Plausibilität beim Planen“: eine Einheit, die schon eine andere Schicht plant, oder
/// eine mit eigener laufender Schicht ergibt eine Warnung im Antwort-DTO, die Planung gelingt.
#[tokio::test]
async fn planen_warnt_bei_doppelplanung_und_eigener_schicht() {
    let w = welt().await;
    let id1 = schicht_zukunft(&w, w.f1).await;
    let f3 = einheit(&w.pool, w.e, "Florian 3", None).await;
    let id3 = schicht_zukunft(&w, f3).await;

    let a = plane(&w, id1, Some(w.f2)).await;
    assert!(a.planung_warnungen.is_empty(), "{:?}", a.planung_warnungen);
    let a = plane(&w, id3, Some(w.f2)).await;
    assert_eq!(a.abloesende_einheit_id, Some(w.f2), "gelingt trotzdem");
    assert_eq!(
        a.planung_warnungen,
        vec![crate::abloesung::AbloesungPlanungWarnung {
            art: crate::abloesung::AbloesungWarnungArt::SchonGeplant,
            einheit_id: w.f2,
            einheit_name: "Florian 2".into(),
            abloesung_id: Some(id1),
            abloesung_einheit_name: Some("Florian 1".into()),
            seit_at: None,
        }]
    );

    // f3 hat selbst eine laufende Schicht: als Ablöser von f1 „steht selbst im Einsatz“.
    let a = plane(&w, id1, Some(f3)).await;
    assert_eq!(
        a.planung_warnungen,
        vec![crate::abloesung::AbloesungPlanungWarnung {
            art: crate::abloesung::AbloesungWarnungArt::ImEinsatz,
            einheit_id: f3,
            einheit_name: "Florian 3".into(),
            abloesung_id: None,
            abloesung_einheit_name: None,
            seit_at: Some(BEGINN_ZUKUNFT.into()),
        }]
    );
    // Die Liste trägt dieselben Warnungen.
    let l = liste(&w.pool, w.e, Some(AbloesungStatus::Laufend), T0)
        .await
        .unwrap();
    let s1 = l.iter().find(|s| s.id == id1).unwrap();
    assert_eq!(s1.planung_warnungen, a.planung_warnungen);
}

// ── Vollzug mit Liste, Fan-out und Abschnittsübergabe (LLH-1132) ────────────────────────────

/// Abschnitt einer Einheit, wie ihn die Gliederung führt.
async fn abschnitt_von(w: &Welt, einheit: i64) -> Option<i64> {
    sqlx::query_scalar("SELECT abschnitt_id FROM einsatz_einheit WHERE id = ?")
        .bind(einheit)
        .fetch_one(&w.pool)
        .await
        .unwrap()
}

async fn neuer_abschnitt(w: &Welt, name: &str) -> i64 {
    sqlx::query_scalar("INSERT INTO einsatzabschnitt (einsatz_id, name) VALUES (?, ?) RETURNING id")
        .bind(w.e)
        .bind(name)
        .fetch_one(&w.pool)
        .await
        .unwrap()
}

/// Nicht gestrichene Ereignisse `abloesung` einer Einheit bzw. Person (`spalte`).
async fn abloesungsereignisse(w: &Welt, spalte: &str, id: i64) -> i64 {
    sqlx::query_scalar(sqlx::AssertSqlSafe(format!(
        "SELECT COUNT(*) FROM einsatz_kraft_zeitachse \
         WHERE {spalte} = ? AND art = 'abloesung' AND gestrichen_at IS NULL"
    )))
    .bind(id)
    .fetch_one(&w.pool)
    .await
    .unwrap()
}

/// Entscheidung LLH-1118 Punkt 3: je Ablöser eine Folgeschicht, in der Reihenfolge der Liste;
/// die Liste steht an der Schicht, der Spiegel ist ihr erster Eintrag, das ETB nennt alle. Die
/// Rücknahme entfernt alle Folgeschichten und lässt die Liste als Planung stehen.
#[tokio::test]
async fn vollzug_mit_liste_legt_je_abloeser_eine_folgeschicht_an() {
    let w = welt().await;
    let f3 = einheit(&w.pool, w.e, "Florian 3", None).await;
    let (a, _) = beginnen(&w.pool, w.e, w.b, &beginn(w.f1, Some(360)), T0)
        .await
        .unwrap();
    let jetzt = "2026-09-22 15:40:00";
    let (v, _, _) = vollzug(&w.pool, w.e, a.id, w.b, jetzt, &[f3, w.f2], false, jetzt)
        .await
        .unwrap();
    let einheiten: Vec<i64> = v.folgeschichten.iter().map(|f| f.einheit_id).collect();
    assert_eq!(einheiten, vec![f3, w.f2], "Reihenfolge der Liste");
    for f in &v.folgeschichten {
        assert_eq!(f.vorgaenger_id, Some(a.id));
        assert_eq!(f.beginn_at, jetzt);
        assert_eq!(f.faellig_at, "2026-09-22 21:40:00");
        assert_eq!(offene_fristen(&w.pool, f.id).await.len(), 2);
    }
    assert_eq!(v.folgeschicht.as_ref().map(|f| f.einheit_id), Some(f3));
    let namen: Vec<&str> = v
        .abgeloest
        .abloeser
        .iter()
        .map(|a| a.einheit_name.as_str())
        .collect();
    assert_eq!(namen, vec!["Florian 3", "Florian 2"]);
    assert_eq!(
        v.abgeloest.abloesende_einheit_id,
        Some(f3),
        "Spiegel = erster"
    );
    assert_eq!(v.abgeloest.folgeschichten.len(), 2);
    assert!(v.abgeloest.ruecknehmbar);
    let inhalt = etb(&w.pool, w.e).await.pop().unwrap().1;
    assert!(
        inhalt.contains("«Florian 1» durch «Florian 3», «Florian 2»"),
        "{inhalt}"
    );

    // Die ältere Folgeschicht endet, nicht die jüngste (`folgeschicht_id`): der Vollzug ist
    // trotzdem nicht mehr unberührt.
    vollziehen(
        &w.pool,
        w.e,
        v.folgeschichten[0].id,
        w.b,
        "2026-09-22 16:00:00",
        None,
        jetzt,
    )
    .await
    .unwrap();
    assert!(!laden(&w.pool, w.e, a.id, jetzt).await.unwrap().ruecknehmbar);
    let err = zuruecknehmen(&w.pool, w.e, a.id, w.b, jetzt)
        .await
        .unwrap_err();
    assert_eq!(status(err), StatusCode::UNPROCESSABLE_ENTITY);
    zuruecknehmen(&w.pool, w.e, v.folgeschichten[0].id, w.b, jetzt)
        .await
        .unwrap();

    let (r, _, _) = zuruecknehmen(&w.pool, w.e, a.id, w.b, jetzt).await.unwrap();
    assert_eq!(r.status, AbloesungStatus::Laufend);
    assert!(r.folgeschichten.is_empty());
    for f in &v.folgeschichten {
        assert!(laden(&w.pool, w.e, f.id, jetzt).await.is_err(), "entfernt");
        assert!(offene_fristen(&w.pool, f.id).await.is_empty());
    }
    let geplant: Vec<i64> = r.abloeser.iter().map(|a| a.einheit_id).collect();
    assert_eq!(geplant, vec![f3, w.f2], "die Liste bleibt als Planung");
}

/// Löst ein Verband ab, bekommt nur der Knoten eine Schicht; seine Untereinheit in derselben
/// Liste erbt sie (Knoten-Modell, LLH-1118 Punkte 1 und 3).
#[tokio::test]
async fn verband_als_abloeser_bekommt_nur_am_knoten_eine_schicht() {
    let w = welt().await;
    let zug = einheit(&w.pool, w.e, "Zug 2", None).await;
    let trupp = untereinheit(&w, "Trupp 2", zug).await;
    let (a, _) = beginnen(&w.pool, w.e, w.b, &beginn(w.f1, Some(360)), T0)
        .await
        .unwrap();
    let jetzt = "2026-09-22 15:40:00";
    let (v, _, _) = vollzug(&w.pool, w.e, a.id, w.b, jetzt, &[trupp, zug], false, jetzt)
        .await
        .unwrap();
    assert_eq!(v.folgeschichten.len(), 1);
    let knoten = &v.folgeschichten[0];
    assert_eq!(knoten.einheit_id, zug);
    assert_eq!(
        knoten
            .erbende_einheiten
            .iter()
            .map(|e| e.einheit_id)
            .collect::<Vec<_>>(),
        vec![trupp]
    );
    assert!(schichten(&w, trupp).await.is_empty());
    assert_eq!(v.abgeloest.abloeser.len(), 2, "die Liste nennt beide");
}

/// Entscheidung LLH-1118 Punkt 1: Der Vollzug schreibt `abloesung` auch an jede erbende
/// Untereinheit samt ihren Personen; die Rücknahme streicht alle.
#[tokio::test]
async fn vollzug_schreibt_die_abloesung_an_erbende_untereinheiten() {
    let w = welt().await;
    let gruppe = untereinheit(&w, "Gruppe 1", w.f1).await;
    let trupp = untereinheit(&w, "Trupp 1", gruppe).await;
    let person: i64 = sqlx::query_scalar(
        "INSERT INTO einsatz_personal (einsatz_id, snap_name, einheit_id) \
         VALUES (?, 'Truppführer', ?) RETURNING id",
    )
    .bind(w.e)
    .bind(trupp)
    .fetch_one(&w.pool)
    .await
    .unwrap();
    for e in [w.f1, gruppe, trupp] {
        eintreffen(&w, e, T0).await;
    }
    let (a, _) = beginnen(&w.pool, w.e, w.b, &beginn(w.f1, Some(360)), T0)
        .await
        .unwrap();
    let jetzt = "2026-09-22 15:40:00";
    let (_, _, wirkung) = vollziehen(&w.pool, w.e, a.id, w.b, jetzt, Some(w.f2), jetzt)
        .await
        .unwrap();
    for e in [w.f1, gruppe, trupp] {
        assert_eq!(abloesungsereignisse(&w, "einheit_id", e).await, 1, "{e}");
        assert_eq!(perioden(&w, e).await[0].ende_at.as_deref(), Some(jetzt));
    }
    assert_eq!(abloesungsereignisse(&w, "personal_id", person).await, 1);
    let mut einheiten: Vec<i64> = wirkung.zeitachse.iter().map(|(e, _)| *e).collect();
    einheiten.sort_unstable();
    assert_eq!(einheiten, vec![w.f1, gruppe, trupp]);
    assert!(wirkung
        .zeitachse
        .iter()
        .any(|(e, b)| *e == trupp && b.personen == vec![person]));
    assert!(
        perioden(&w, w.f2).await.is_empty(),
        "der Ablöser bekommt kein Ereignis"
    );

    let (_, _, wirkung) = zuruecknehmen(&w.pool, w.e, a.id, w.b, jetzt).await.unwrap();
    for e in [w.f1, gruppe, trupp] {
        assert_eq!(abloesungsereignisse(&w, "einheit_id", e).await, 0, "{e}");
        assert_eq!(perioden(&w, e).await[0].ende_at, None, "wieder offen");
    }
    assert_eq!(abloesungsereignisse(&w, "personal_id", person).await, 0);
    assert_eq!(wirkung.zeitachse.len(), 3);
}

/// Entscheidung LLH-1118 Punkt 6: „Abschnitt übergeben“ unterstellt den Knoten-Ablöser dem
/// Abschnitt der abgelösten Einheit und leert deren Abschnitt; die Rücknahme stellt beide
/// wieder her. Die Untereinheit in der Liste behält ihren Abschnitt.
#[tokio::test]
async fn abschnitt_uebergeben_und_zuruecknehmen() {
    let w = welt().await;
    let sued = neuer_abschnitt(&w, "Deichwache Süd").await;
    let zug = einheit(&w.pool, w.e, "Zug 2", Some(sued)).await;
    let trupp = untereinheit(&w, "Trupp 2", zug).await;
    let (a, _) = beginnen(&w.pool, w.e, w.b, &beginn(w.f1, Some(360)), T0)
        .await
        .unwrap();
    let jetzt = "2026-09-22 15:40:00";
    let (v, _, wirkung) = vollzug(
        &w.pool,
        w.e,
        a.id,
        w.b,
        jetzt,
        &[w.f2, zug, trupp],
        true,
        jetzt,
    )
    .await
    .unwrap();
    assert_eq!(abschnitt_von(&w, w.f1).await, None, "geleert");
    assert_eq!(abschnitt_von(&w, w.f2).await, Some(w.abschnitt));
    assert_eq!(abschnitt_von(&w, zug).await, Some(w.abschnitt));
    assert_eq!(abschnitt_von(&w, trupp).await, None, "nur der Knoten");
    assert!(v.abgeloest.abschnitt_uebergeben);
    assert_eq!(
        v.abgeloest.uebergebener_abschnitt_name.as_deref(),
        Some("Deichwache Nord")
    );
    let mut geaendert = wirkung.einheiten.clone();
    geaendert.sort_unstable();
    let mut erwartet = vec![w.f1, w.f2, zug];
    erwartet.sort_unstable();
    assert_eq!(geaendert, erwartet);
    let inhalt = etb(&w.pool, w.e).await.pop().unwrap().1;
    assert!(
        inhalt.contains("Abschnitt «Deichwache Nord» an «Florian 2», «Zug 2» übergeben"),
        "{inhalt}"
    );

    let (r, _, _) = zuruecknehmen(&w.pool, w.e, a.id, w.b, jetzt).await.unwrap();
    assert_eq!(abschnitt_von(&w, w.f1).await, Some(w.abschnitt));
    assert_eq!(abschnitt_von(&w, w.f2).await, None, "alter Wert: keiner");
    assert_eq!(abschnitt_von(&w, zug).await, Some(sued), "alter Wert");
    assert_eq!(abschnitt_von(&w, trupp).await, None);
    assert!(!r.abschnitt_uebergeben);
    assert_eq!(r.uebergebener_abschnitt_name, None);
    let berichtigung = etb(&w.pool, w.e).await.pop().unwrap().1;
    assert!(
        berichtigung.contains("Abschnitt «Deichwache Nord» zurückgegeben"),
        "{berichtigung}"
    );
    let vorher: i64 = sqlx::query_scalar(
        "SELECT COUNT(abschnitt_vorher_id) FROM einsatz_abloesung_abloeser WHERE abloesung_id = ?",
    )
    .bind(a.id)
    .fetch_one(&w.pool)
    .await
    .unwrap();
    assert_eq!(vorher, 0, "die Vorher-Werte sind verbraucht");
}

/// Wer nach dem Vollzug von Hand umgehängt wurde, bleibt, wo er ist: die Rücknahme stellt nur
/// den Stand her, den der Vollzug hinterlassen hat. Ohne Abschnitt der abgelösten Einheit oder
/// ohne Ablöser gibt es nichts zu übergeben.
#[tokio::test]
async fn abschnittsuebergabe_nur_wo_der_vollzug_den_stand_hinterliess() {
    let w = welt().await;
    let sued = neuer_abschnitt(&w, "Deichwache Süd").await;
    let (a, _) = beginnen(&w.pool, w.e, w.b, &beginn(w.f1, Some(360)), T0)
        .await
        .unwrap();
    let jetzt = "2026-09-22 15:40:00";
    vollzug(&w.pool, w.e, a.id, w.b, jetzt, &[w.f2], true, jetzt)
        .await
        .unwrap();
    for (einheit, abschnitt) in [(w.f1, Some(sued)), (w.f2, Some(sued))] {
        sqlx::query("UPDATE einsatz_einheit SET abschnitt_id = ? WHERE id = ?")
            .bind(abschnitt)
            .bind(einheit)
            .execute(&w.pool)
            .await
            .unwrap();
    }
    zuruecknehmen(&w.pool, w.e, a.id, w.b, jetzt).await.unwrap();
    assert_eq!(
        abschnitt_von(&w, w.f1).await,
        Some(sued),
        "von Hand gesetzt"
    );
    assert_eq!(
        abschnitt_von(&w, w.f2).await,
        Some(sued),
        "von Hand gesetzt"
    );

    // Florian 2 (ohne Abschnitt) wird abgelöst: nichts zu übergeben, kein Flag.
    sqlx::query("UPDATE einsatz_einheit SET abschnitt_id = NULL WHERE id = ?")
        .bind(w.f2)
        .execute(&w.pool)
        .await
        .unwrap();
    let (b, _) = beginnen(&w.pool, w.e, w.b, &beginn(w.f2, Some(360)), T0)
        .await
        .unwrap();
    let f3 = einheit(&w.pool, w.e, "Florian 3", Some(sued)).await;
    let (v, _, wirkung) = vollzug(&w.pool, w.e, b.id, w.b, jetzt, &[f3], true, jetzt)
        .await
        .unwrap();
    assert!(!v.abgeloest.abschnitt_uebergeben);
    assert!(wirkung.einheiten.is_empty());
    assert_eq!(abschnitt_von(&w, f3).await, Some(sued));

    // Ohne Ablöser bleibt der Abschnitt der abgelösten Einheit stehen (`a` läuft wieder).
    let (v, _, _) = vollzug(&w.pool, w.e, a.id, w.b, jetzt, &[], true, jetzt)
        .await
        .unwrap();
    assert!(!v.abgeloest.abschnitt_uebergeben);
    assert_eq!(abschnitt_von(&w, w.f1).await, Some(sued));
}

/// Statuscodes der Liste: die Einheit selbst → 422, eine fremde → 404, eine aufgelöste → 409;
/// jeweils ohne halben Stand.
#[tokio::test]
async fn abloeserliste_prueft_jeden_eintrag() {
    let w = welt().await;
    let fremd_einsatz: i64 = sqlx::query_scalar(
        "INSERT INTO einsatz (org_id, bezeichnung) VALUES (1, 'Sturm') RETURNING id",
    )
    .fetch_one(&w.pool)
    .await
    .unwrap();
    let fremd = einheit(&w.pool, fremd_einsatz, "Fremd", None).await;
    let weg = einheit(&w.pool, w.e, "Aufgelöst", None).await;
    sqlx::query("UPDATE einsatz_einheit SET aufgeloest_at = datetime('now') WHERE id = ?")
        .bind(weg)
        .execute(&w.pool)
        .await
        .unwrap();
    let (a, _) = beginnen(&w.pool, w.e, w.b, &beginn(w.f1, Some(360)), T0)
        .await
        .unwrap();
    let jetzt = "2026-09-22 15:40:00";
    for (liste, erwartet) in [
        (vec![w.f2, w.f1], StatusCode::UNPROCESSABLE_ENTITY),
        (vec![w.f2, fremd], StatusCode::NOT_FOUND),
        (vec![w.f2, weg], StatusCode::CONFLICT),
    ] {
        let err = vollzug(&w.pool, w.e, a.id, w.b, jetzt, &liste, false, jetzt)
            .await
            .unwrap_err();
        assert_eq!(status(err), erwartet, "{liste:?}");
        let err = aendern(
            &w.pool,
            w.e,
            a.id,
            w.b,
            &AenderungEingabe {
                abloeser: Some(liste.clone()),
                ..Default::default()
            },
            T0,
        )
        .await
        .unwrap_err();
        assert_eq!(status(err), erwartet, "Planung {liste:?}");
    }
    let a2 = laden(&w.pool, w.e, a.id, T0).await.unwrap();
    assert_eq!(a2.status, AbloesungStatus::Laufend);
    assert!(a2.abloeser.is_empty());
    assert!(schichten(&w, w.f2).await.is_empty());
}

/// Planen als Liste: die Reihenfolge bleibt, der Spiegel folgt dem ersten Eintrag, das ETB nennt
/// alle; dieselbe Liste noch einmal schreibt nichts. Wird ein Ablöser aufgelöst, fällt er aus der
/// Liste, und der Spiegel rückt nach.
#[tokio::test]
async fn abloeser_als_liste_planen() {
    let w = welt().await;
    let f3 = einheit(&w.pool, w.e, "Florian 3", None).await;
    let (a, _) = beginnen(&w.pool, w.e, w.b, &beginn(w.f1, Some(360)), T0)
        .await
        .unwrap();
    let planen = |liste: Vec<i64>| {
        let pool = w.pool.clone();
        let (e, id, b) = (w.e, a.id, w.b);
        async move {
            aendern(
                &pool,
                e,
                id,
                b,
                &AenderungEingabe {
                    abloeser: Some(liste),
                    ..Default::default()
                },
                T0,
            )
            .await
            .unwrap()
        }
    };
    let (s, etb_id) = planen(vec![f3, w.f2]).await;
    assert!(etb_id.is_some());
    assert_eq!(
        s.abloeser.iter().map(|x| x.einheit_id).collect::<Vec<_>>(),
        vec![f3, w.f2]
    );
    assert_eq!(s.abloesende_einheit_id, Some(f3));
    let inhalt = etb(&w.pool, w.e).await.pop().unwrap().1;
    assert!(
        inhalt.contains("ablösende Einheiten «Florian 3», «Florian 2» geplant"),
        "{inhalt}"
    );
    assert_eq!(planen(vec![f3, w.f2]).await.1, None, "unverändert");

    let mut conn = w.pool.acquire().await.unwrap();
    release_einheit_tx(&mut conn, w.e, f3, w.b, T0)
        .await
        .unwrap();
    drop(conn);
    let s = laden(&w.pool, w.e, a.id, T0).await.unwrap();
    assert_eq!(
        s.abloeser.iter().map(|x| x.einheit_id).collect::<Vec<_>>(),
        vec![w.f2]
    );
    assert_eq!(s.abloesende_einheit_id, Some(w.f2), "Spiegel rückt nach");

    let (s, _) = planen(vec![]).await;
    assert!(s.abloeser.is_empty());
    assert_eq!(s.abloesende_einheit_id, None);
}

/// Nachtrag 17.10.: Die Ausnahme vom Autostart gilt für jeden Eintrag der Liste und für die
/// Untereinheiten eines geplanten Verbands; ein ungeplanter bekommt seine Schicht.
#[tokio::test]
async fn ausnahme_vom_autostart_gilt_fuer_die_liste_und_den_verband() {
    let w = welt().await;
    set_einsatz_rhythmus(&w, 360).await;
    ereignis(&w, w.f1, Eintreffen, ANKUNFT).await;
    let a = schichten(&w, w.f1).await[0].id;
    let f3 = einheit(&w.pool, w.e, "Florian 3", None).await;
    let zug = einheit(&w.pool, w.e, "Zug 2", None).await;
    let trupp = untereinheit(&w, "Trupp 2", zug).await;
    let frei = einheit(&w.pool, w.e, "Florian 4", None).await;
    aendern(
        &w.pool,
        w.e,
        a,
        w.b,
        &AenderungEingabe {
            abloeser: Some(vec![w.f2, f3, zug]),
            ..Default::default()
        },
        T0,
    )
    .await
    .unwrap();
    for e in [f3, trupp] {
        let b = ereignis(&w, e, Eintreffen, "2030-06-03 13:30:00").await;
        assert!(b.abloesung.is_empty(), "{e}");
        assert!(schichten(&w, e).await.is_empty(), "{e}");
    }
    let b = ereignis(&w, frei, Eintreffen, "2030-06-03 13:30:00").await;
    assert_eq!(b.abloesung.len(), 1, "ungeplant: eigene Schicht");
}

// ── Besatzungswechsel (LLH-1150) ────────────────────────────────────────────────────────────

/// Eine Person im Einsatz, optional in einer Einheit und auf einem Fahrzeug.
async fn person(w: &Welt, name: &str, einheit: Option<i64>, fahrzeug: Option<i64>) -> i64 {
    sqlx::query_scalar(
        "INSERT INTO einsatz_personal (einsatz_id, snap_name, einheit_id, fahrzeug_id) \
         VALUES (?, ?, ?, ?) RETURNING id",
    )
    .bind(w.e)
    .bind(name)
    .bind(einheit)
    .bind(fahrzeug)
    .fetch_one(&w.pool)
    .await
    .unwrap()
}

/// `(einheit_id, fahrzeug_id)` einer Person.
async fn zuordnung(w: &Welt, person: i64) -> (Option<i64>, Option<i64>) {
    sqlx::query_as("SELECT einheit_id, fahrzeug_id FROM einsatz_personal WHERE id = ?")
        .bind(person)
        .fetch_one(&w.pool)
        .await
        .unwrap()
}

async fn fuehrer(w: &Welt, einheit: i64) -> Option<i64> {
    sqlx::query_scalar("SELECT fuehrer_id FROM einsatz_einheit WHERE id = ?")
        .bind(einheit)
        .fetch_one(&w.pool)
        .await
        .unwrap()
}

/// Nicht gestrichene Ereignisse einer Person: `(art, quelle)` nach Zeit.
async fn ereignisse_person(w: &Welt, person: i64) -> Vec<(String, String)> {
    sqlx::query_as(
        "SELECT art, quelle FROM einsatz_kraft_zeitachse \
         WHERE personal_id = ? AND gestrichen_at IS NULL ORDER BY zeitpunkt_at, id",
    )
    .bind(person)
    .fetch_all(&w.pool)
    .await
    .unwrap()
}

/// Ein Zug mit Gruppe (erbt die Schicht), Führer auf dem Fahrzeug des Zugs, Gruppenmitglied;
/// dazu eine Person ohne Einheit und eine aus „Florian 2“. Zug und Gruppe sind eingetroffen.
struct Lage {
    gruppe: i64,
    fahrzeug: i64,
    fuehrer: i64,
    mitglied: i64,
    frei: i64,
    fremd: i64,
    schicht: i64,
}

async fn lage(w: &Welt) -> Lage {
    let gruppe = untereinheit(w, "Gruppe 1", w.f1).await;
    let fahrzeug: i64 = sqlx::query_scalar(
        "INSERT INTO einsatz_fahrzeug (einsatz_id, snap_funkrufname, einheit_id) \
         VALUES (?, 'Florian 1-44', ?) RETURNING id",
    )
    .bind(w.e)
    .bind(w.f1)
    .fetch_one(&w.pool)
    .await
    .unwrap();
    let fuehrer = person(w, "Anna Alt", Some(w.f1), Some(fahrzeug)).await;
    sqlx::query("UPDATE einsatz_einheit SET fuehrer_id = ? WHERE id = ?")
        .bind(fuehrer)
        .bind(w.f1)
        .execute(&w.pool)
        .await
        .unwrap();
    let mitglied = person(w, "Bernd Alt", Some(gruppe), None).await;
    let frei = person(w, "Cora Neu", None, None).await;
    let fremd = person(w, "Dirk Neu", Some(w.f2), None).await;
    for e in [w.f1, gruppe] {
        eintreffen(w, e, T0).await;
    }
    let (a, _) = beginnen(&w.pool, w.e, w.b, &beginn(w.f1, Some(360)), T0)
        .await
        .unwrap();
    Lage {
        gruppe,
        fahrzeug,
        fuehrer,
        mitglied,
        frei,
        fremd,
        schicht: a.id,
    }
}

/// Spec `kraefte-abloesung`, „Besatzungswechsel“: Einheit, Fahrzeug und Abschnitt bleiben, die
/// Folgeschicht hängt an derselben Einheit; die alte Besatzung (auch die der erbenden Gruppe)
/// geht aus Einheit, Fahrzeug und Führung und bekommt `abloesung`, die neue kommt in die Einheit
/// und bekommt `eintreffen`; die Einheiten selbst bekommen kein Ereignis. Das ETB nennt beide
/// Besatzungen, die Schicht trägt Art und Besatzung, die Rücknahme stellt alles wieder her.
#[tokio::test]
async fn besatzungswechsel_tauscht_das_personal_und_die_einheit_bleibt() {
    let w = welt().await;
    let l = lage(&w).await;
    let jetzt = "2026-09-22 15:40:00";
    let (v, _, wirkung) = besatzungswechsel(&w, l.schicht, jetzt, &[l.frei, l.fremd])
        .await
        .unwrap();

    let a = &v.abgeloest;
    assert_eq!(a.status, AbloesungStatus::Abgeloest);
    assert_eq!(a.art, AbloesungArt::Besatzung);
    assert!(a.abloeser.is_empty(), "keine ablösende Einheit");
    let besatzung: Vec<(&str, BesatzungRolle)> = a
        .besatzung
        .iter()
        .map(|b| (b.name.as_str(), b.rolle))
        .collect();
    assert_eq!(
        besatzung,
        vec![
            ("Anna Alt", BesatzungRolle::Alt),
            ("Bernd Alt", BesatzungRolle::Alt),
            ("Cora Neu", BesatzungRolle::Neu),
            ("Dirk Neu", BesatzungRolle::Neu),
        ]
    );
    assert!(
        a.ruecknehmbar,
        "die eigene Folgeschicht sperrt die Rücknahme nicht"
    );
    assert_eq!(v.folgeschichten.len(), 1);
    let f = &v.folgeschichten[0];
    assert_eq!(f.einheit_id, w.f1, "dieselbe Einheit");
    assert_eq!(f.vorgaenger_id, Some(l.schicht));
    assert_eq!(
        f.beginn_quelle,
        BeginnQuelle::Vollzug,
        "die Folgeschicht des Besatzungswechsels (LLH-1312)"
    );
    assert_eq!(f.beginn_at, jetzt);
    assert_eq!(f.faellig_at, "2026-09-22 21:40:00");
    assert_eq!(
        f.art,
        AbloesungArt::Einheit,
        "eine laufende trägt die Vorgabe"
    );
    assert_eq!(
        f.erbende_einheiten
            .iter()
            .map(|e| e.einheit_id)
            .collect::<Vec<_>>(),
        vec![l.gruppe],
        "die Gruppe erbt weiter"
    );
    assert_eq!(
        abschnitt_von(&w, w.f1).await,
        Some(w.abschnitt),
        "Abschnitt bleibt"
    );

    // Zeitachse: nur Personen-Ereignisse, die Perioden der Einheiten laufen weiter.
    for e in [w.f1, l.gruppe] {
        assert_eq!(abloesungsereignisse(&w, "einheit_id", e).await, 0, "{e}");
        assert_eq!(perioden(&w, e).await[0].ende_at, None, "{e}");
    }
    for p in [l.fuehrer, l.mitglied] {
        assert_eq!(
            ereignisse_person(&w, p).await,
            vec![
                ("eintreffen".to_string(), "einheit".to_string()),
                ("abloesung".to_string(), "abloesung".to_string())
            ],
            "{p}"
        );
    }
    for p in [l.frei, l.fremd] {
        assert_eq!(
            ereignisse_person(&w, p).await,
            vec![("eintreffen".to_string(), "abloesung".to_string())],
            "{p}"
        );
    }

    // Zugehörigkeit.
    assert_eq!(
        zuordnung(&w, l.fuehrer).await,
        (None, None),
        "aus Einheit und Fahrzeug"
    );
    assert_eq!(zuordnung(&w, l.mitglied).await, (None, None));
    assert_eq!(fuehrer(&w, w.f1).await, None, "aus der Führung");
    assert_eq!(zuordnung(&w, l.frei).await, (Some(w.f1), None));
    assert_eq!(zuordnung(&w, l.fremd).await, (Some(w.f1), None));
    let traeger: Option<i64> =
        sqlx::query_scalar("SELECT einheit_id FROM einsatz_fahrzeug WHERE id = ?")
            .bind(l.fahrzeug)
            .fetch_one(&w.pool)
            .await
            .unwrap();
    assert_eq!(traeger, Some(w.f1), "das Fahrzeug bleibt bei der Einheit");

    let inhalt = etb(&w.pool, w.e).await.pop().unwrap().1;
    assert_eq!(
        inhalt,
        "Ablösung vollzogen: Besatzungswechsel «Florian 1», Einheit und Fahrzeug bleiben. \
         Alte Besatzung: «Anna Alt», «Bernd Alt». Neue Besatzung: «Cora Neu», «Dirk Neu»."
    );
    let mut personen = wirkung.personen.clone();
    personen.sort_unstable();
    let mut erwartet = vec![l.fuehrer, l.mitglied, l.frei, l.fremd];
    erwartet.sort_unstable();
    assert_eq!(personen, erwartet);
    for e in [w.f1, l.gruppe, w.f2] {
        assert!(wirkung.einheiten.contains(&e), "{e}");
    }

    // Rücknahme: alles wie vorher.
    let (r, _, wirkung) = zuruecknehmen(&w.pool, w.e, l.schicht, w.b, jetzt)
        .await
        .unwrap();
    assert_eq!(r.status, AbloesungStatus::Laufend);
    assert_eq!(r.art, AbloesungArt::Einheit);
    assert!(r.besatzung.is_empty());
    assert!(
        laden(&w.pool, w.e, f.id, jetzt).await.is_err(),
        "Folgeschicht entfernt"
    );
    assert_eq!(schichten(&w, w.f1).await.len(), 1);
    assert_eq!(
        zuordnung(&w, l.fuehrer).await,
        (Some(w.f1), Some(l.fahrzeug))
    );
    assert_eq!(zuordnung(&w, l.mitglied).await, (Some(l.gruppe), None));
    assert_eq!(fuehrer(&w, w.f1).await, Some(l.fuehrer), "Führung zurück");
    assert_eq!(zuordnung(&w, l.frei).await, (None, None));
    assert_eq!(zuordnung(&w, l.fremd).await, (Some(w.f2), None));
    for p in [l.fuehrer, l.mitglied] {
        assert_eq!(
            ereignisse_person(&w, p).await.len(),
            1,
            "nur das Eintreffen"
        );
    }
    for p in [l.frei, l.fremd] {
        assert!(ereignisse_person(&w, p).await.is_empty(), "{p}");
    }
    let zeilen: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM einsatz_abloesung_besatzung")
        .fetch_one(&w.pool)
        .await
        .unwrap();
    assert_eq!(zeilen, 0);
    assert_eq!(wirkung.personen.len(), 4);
    let (typ, inhalt, bezug, _) = etb(&w.pool, w.e).await.pop().unwrap();
    assert_eq!(typ, crate::etb::TYP_BERICHTIGUNG);
    assert!(inhalt.contains("Besatzungswechsel rückgängig"), "{inhalt}");
    assert!(bezug.is_some());
}

/// Die Rücknahme legt nur zurück, was noch den Stand des Vollzugs trägt: wer danach von Hand
/// umgehängt wurde, bleibt dort, und eine Einheit mit neuer Führung behält sie.
#[tokio::test]
async fn ruecknahme_des_besatzungswechsels_laesst_handaenderungen_stehen() {
    let w = welt().await;
    let l = lage(&w).await;
    let f3 = einheit(&w.pool, w.e, "Florian 3", None).await;
    let jetzt = "2026-09-22 15:40:00";
    besatzungswechsel(&w, l.schicht, jetzt, &[l.frei, l.fremd])
        .await
        .unwrap();
    for (p, e) in [(l.frei, f3), (l.fuehrer, f3)] {
        sqlx::query("UPDATE einsatz_personal SET einheit_id = ? WHERE id = ?")
            .bind(e)
            .bind(p)
            .execute(&w.pool)
            .await
            .unwrap();
    }
    sqlx::query("UPDATE einsatz_einheit SET fuehrer_id = ? WHERE id = ?")
        .bind(l.fremd)
        .bind(w.f1)
        .execute(&w.pool)
        .await
        .unwrap();
    zuruecknehmen(&w.pool, w.e, l.schicht, w.b, jetzt)
        .await
        .unwrap();
    assert_eq!(
        zuordnung(&w, l.frei).await.0,
        Some(f3),
        "von Hand umgehängt"
    );
    assert_eq!(
        zuordnung(&w, l.fuehrer).await,
        (Some(f3), None),
        "bleibt in Florian 3"
    );
    assert_eq!(zuordnung(&w, l.mitglied).await.0, Some(l.gruppe));
    assert_eq!(zuordnung(&w, l.fremd).await.0, Some(w.f2));
    assert_eq!(
        fuehrer(&w, w.f1).await,
        Some(l.fremd),
        "neue Führung bleibt"
    );
}

/// Die neue Besatzung wird vor jedem Schreiben geprüft: unbekannt 404, entlassen 409, schon in
/// der bisherigen Besatzung (auch der erbenden Gruppe) 422, Führung einer anderen Einheit 422.
/// Nichts wird halb geschrieben.
#[tokio::test]
async fn besatzungswechsel_lehnt_unpassende_personen_ab() {
    let w = welt().await;
    let l = lage(&w).await;
    let entlassen = person(&w, "Erik Weg", None, None).await;
    sqlx::query(
        "UPDATE einsatz_personal SET beendet_at = ?, beendet_als = 'entlassen' WHERE id = ?",
    )
    .bind(T0)
    .bind(entlassen)
    .execute(&w.pool)
    .await
    .unwrap();
    let fuehrt = person(&w, "Fritz Führt", Some(w.f2), None).await;
    sqlx::query("UPDATE einsatz_einheit SET fuehrer_id = ? WHERE id = ?")
        .bind(fuehrt)
        .bind(w.f2)
        .execute(&w.pool)
        .await
        .unwrap();
    let jetzt = "2026-09-22 15:40:00";
    for (neu, code) in [
        (vec![l.frei, 99_999], StatusCode::NOT_FOUND),
        (vec![l.frei, entlassen], StatusCode::CONFLICT),
        (vec![l.frei, l.mitglied], StatusCode::UNPROCESSABLE_ENTITY),
        (vec![fuehrt], StatusCode::UNPROCESSABLE_ENTITY),
    ] {
        let err = besatzungswechsel(&w, l.schicht, jetzt, &neu)
            .await
            .unwrap_err();
        assert_eq!(status(err), code, "{neu:?}");
    }
    let a = laden(&w.pool, w.e, l.schicht, jetzt).await.unwrap();
    assert_eq!(a.status, AbloesungStatus::Laufend);
    assert_eq!(zuordnung(&w, l.frei).await, (None, None));
    assert_eq!(zuordnung(&w, l.fuehrer).await.0, Some(w.f1));
    assert!(ereignisse_person(&w, l.frei).await.is_empty());
}

/// Spec `kraefte-zeitachse`, „Streichung“: das Eintreffen der neuen Besatzung aus dem Vollzug
/// streicht nur dessen Rücknahme, wie die Ablösung der alten.
#[tokio::test]
async fn ereignisse_des_besatzungswechsels_streicht_nur_die_ruecknahme() {
    let w = welt().await;
    let l = lage(&w).await;
    let jetzt = "2026-09-22 15:40:00";
    besatzungswechsel(&w, l.schicht, jetzt, &[l.frei])
        .await
        .unwrap();
    for p in [l.frei, l.fuehrer] {
        let id: i64 = sqlx::query_scalar(
            "SELECT id FROM einsatz_kraft_zeitachse \
             WHERE personal_id = ? AND quelle = 'abloesung'",
        )
        .bind(p)
        .fetch_one(&w.pool)
        .await
        .unwrap();
        let mut tx = w.pool.begin().await.unwrap();
        let err = crate::zeitachse::repo::streiche_tx(
            &mut tx,
            w.e,
            w.b,
            crate::zeitachse::repo::Kraft::Person(p),
            id,
            "Fehlbuchung",
            false,
        )
        .await
        .unwrap_err();
        assert_eq!(status(err), StatusCode::UNPROCESSABLE_ENTITY, "{p}");
    }
}

/// Bricht die Streichung die Folge einer Person (nach dem Wechsel neu alarmiert), scheitert die
/// Rücknahme mit 422, nennt die Person und ändert nichts.
#[tokio::test]
async fn ruecknahme_des_besatzungswechsels_bricht_keine_spaetere_folge() {
    let w = welt().await;
    let l = lage(&w).await;
    let jetzt = "2026-09-22 15:40:00";
    besatzungswechsel(&w, l.schicht, jetzt, &[l.frei])
        .await
        .unwrap();
    let mut tx = w.pool.begin().await.unwrap();
    crate::zeitachse::repo::schreibe_tx(
        &mut tx,
        w.e,
        w.b,
        crate::zeitachse::repo::Kraft::Person(l.mitglied),
        crate::zeitachse::repo::Neu {
            art: Alarmierung,
            zeitpunkt_at: "2026-09-22 16:00:00",
            quelle: crate::zeitachse::ZeitachseQuelle::Status,
            notiz: None,
        },
    )
    .await
    .unwrap();
    tx.commit().await.unwrap();
    let err = zuruecknehmen(&w.pool, w.e, l.schicht, w.b, jetzt)
        .await
        .unwrap_err();
    let text = err.to_string();
    assert_eq!(status(err), StatusCode::UNPROCESSABLE_ENTITY);
    assert!(text.contains("Bernd Alt"), "{text}");
    let a = laden(&w.pool, w.e, l.schicht, jetzt).await.unwrap();
    assert_eq!(a.status, AbloesungStatus::Abgeloest);
    assert_eq!(zuordnung(&w, l.frei).await.0, Some(w.f1));
}

// ── Verbleib der abgelösten Einheit (LLH-1308) ──────────────────────────────────────────────

/// Ein Bereitstellungsraum mit Status `status`.
async fn raum(w: &Welt, bezeichnung: &str, status: &str) -> i64 {
    sqlx::query_scalar(
        "INSERT INTO bereitstellungsraum (einsatz_id, bezeichnung, erfasst_von, geaendert_von, \
            status) VALUES (?, ?, ?, ?, ?) RETURNING id",
    )
    .bind(w.e)
    .bind(bezeichnung)
    .bind(w.b)
    .bind(w.b)
    .bind(status)
    .fetch_one(&w.pool)
    .await
    .unwrap()
}

/// Bucht eine Einheit über den Schreibweg der Belegung (`eintritt`, `abruf` über `abruf_tx`).
async fn belege(w: &Welt, br: i64, einheit: i64, art: &str) {
    use crate::bereitstellungsraum::{abruf, belegung_repo, ObjektTyp};
    if art == "abruf" {
        let mut tx = w.pool.begin().await.unwrap();
        abruf::abruf_tx(
            &mut tx,
            w.e,
            br,
            &abruf::AbrufDaten {
                objekt_typ: ObjektTyp::Einheit,
                objekt_id: einheit,
                abschnitt: None,
                auftrag: None,
                ausgerueckt: false,
            },
            abruf::Startwerte {
                auftrag: 0,
                etb: 0,
                auto_etb: false,
            },
            w.b,
        )
        .await
        .unwrap();
        tx.commit().await.unwrap();
        return;
    }
    belegung_repo::belege(&w.pool, w.e, br, "einheit", einheit, art, None, w.b)
        .await
        .unwrap();
}

/// Raum, in dem die Einheit steht.
async fn steht_in(w: &Welt, einheit: i64) -> Option<i64> {
    sqlx::query_scalar("SELECT aktueller_br_id FROM einsatz_einheit WHERE id = ?")
        .bind(einheit)
        .fetch_one(&w.pool)
        .await
        .unwrap()
}

/// Belegungsereignisse der Einheit: `(Raum, Art, Notiz)` in ihrer Reihenfolge.
async fn belegungen(w: &Welt, einheit: i64) -> Vec<(i64, String, Option<String>)> {
    sqlx::query_as(
        "SELECT br_id, art, notiz FROM br_belegung WHERE objekt_typ = 'einheit' AND objekt_id = ? \
         ORDER BY id",
    )
    .bind(einheit)
    .fetch_all(&w.pool)
    .await
    .unwrap()
}

/// Vollzug mit Ablösern und Verbleib.
async fn vollzug_mit_verbleib(
    w: &Welt,
    id: i64,
    vollzogen_at: &str,
    abloeser: &[i64],
    verbleib: AbloesungVerbleib,
    br: Option<i64>,
) -> Result<(AbloesungVollzugAnzeige, i64, VollzugWirkung), AppError> {
    super::vollziehen(
        &w.pool,
        w.e,
        id,
        w.b,
        &VollzugEingabe {
            vollzogen_at: vollzogen_at.into(),
            abloeser: abloeser.to_vec(),
            verbleib,
            verbleib_br_id: br,
            ..Default::default()
        },
        vollzogen_at,
    )
    .await
}

/// Spec `kraefte-abloesung` „Verbleib der abgelösten Einheit“, Szenario „In den
/// Bereitstellungsraum“: Periode endet mit der Ablösung, Eintritt in den Raum, ein ETB-Satz; die
/// Schicht nennt den Raum. Rücknahme: Austritt mit Notiz, Verbleib wieder Ruhe.
#[tokio::test]
async fn verbleib_im_bereitstellungsraum_und_ruecknahme() {
    let w = welt().await;
    let schule = raum(&w, "Schule", "aktiv").await;
    eintreffen(&w, w.f1, T0).await;
    let (a, _) = beginnen(&w.pool, w.e, w.b, &beginn(w.f1, Some(360)), T0)
        .await
        .unwrap();
    let vorher = etb(&w.pool, w.e).await.len();
    let jetzt = "2026-09-22 15:40:00";
    let (v, _, wirkung) = vollzug_mit_verbleib(
        &w,
        a.id,
        jetzt,
        &[w.f2],
        AbloesungVerbleib::Bereitstellungsraum,
        Some(schule),
    )
    .await
    .unwrap();
    assert_eq!(v.abgeloest.verbleib, AbloesungVerbleib::Bereitstellungsraum);
    assert_eq!(
        v.abgeloest.verbleib_br_bezeichnung.as_deref(),
        Some("Schule")
    );
    assert_eq!(steht_in(&w, w.f1).await, Some(schule));
    let p = perioden(&w, w.f1).await;
    assert_eq!(p[0].ende_at.as_deref(), Some(jetzt));
    assert_eq!(
        p[0].ende_art,
        Some(crate::zeitachse::ZeitachseArt::Abloesung)
    );
    assert_eq!(wirkung.raeume, vec![schule]);
    let eintraege = etb(&w.pool, w.e).await;
    assert_eq!(eintraege.len(), vorher + 1, "genau ein ETB-Satz");
    assert_eq!(
        eintraege.last().unwrap().1,
        "Ablösung vollzogen: «Florian 1» durch «Florian 2». \
         «Florian 1» danach in Bereitstellungsraum Schule."
    );

    let (r, _, wirkung) = zuruecknehmen(&w.pool, w.e, a.id, w.b, jetzt).await.unwrap();
    assert_eq!(r.verbleib, AbloesungVerbleib::Ruhe);
    assert_eq!(r.verbleib_br_bezeichnung, None);
    assert_eq!(steht_in(&w, w.f1).await, None);
    assert_eq!(
        belegungen(&w, w.f1).await,
        vec![
            (schule, "eintritt".into(), None),
            (
                schule,
                "austritt".into(),
                Some("Ablösung zurückgenommen".into())
            ),
        ]
    );
    assert_eq!(wirkung.raeume, vec![schule]);
    let text = etb(&w.pool, w.e).await.last().unwrap().1.clone();
    assert!(
        text.ends_with("«Florian 1» verlässt Bereitstellungsraum Schule wieder."),
        "{text}"
    );
    let zeilen: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM einsatz_abloesung_br_buchung")
        .fetch_one(&w.pool)
        .await
        .unwrap();
    assert_eq!(zeilen, 0);
}

/// Akzeptanzkriterium: ein inaktiver Raum lehnt den Vollzug mit Grund ab, und nichts ist halb
/// geschrieben (Schicht laufend, keine Folgeschicht, keine Belegung, kein ETB, Zeitachse offen).
#[tokio::test]
async fn verbleib_in_inaktivem_raum_ist_422_und_schreibt_nichts() {
    let w = welt().await;
    let geplant = raum(&w, "Sportplatz", "geplant").await;
    eintreffen(&w, w.f1, T0).await;
    let (a, _) = beginnen(&w.pool, w.e, w.b, &beginn(w.f1, Some(360)), T0)
        .await
        .unwrap();
    let vorher = etb(&w.pool, w.e).await.len();
    let jetzt = "2026-09-22 15:40:00";
    let err = vollzug_mit_verbleib(
        &w,
        a.id,
        jetzt,
        &[w.f2],
        AbloesungVerbleib::Bereitstellungsraum,
        Some(geplant),
    )
    .await
    .unwrap_err();
    let text = err.to_string();
    assert_eq!(status(err), StatusCode::UNPROCESSABLE_ENTITY);
    assert!(text.contains("Belegung nur bei aktivem BR"), "{text}");
    let a = laden(&w.pool, w.e, a.id, jetzt).await.unwrap();
    assert_eq!(a.status, AbloesungStatus::Laufend);
    assert_eq!(a.verbleib, AbloesungVerbleib::Ruhe);
    assert!(schichten(&w, w.f2).await.is_empty(), "keine Folgeschicht");
    assert!(belegungen(&w, w.f1).await.is_empty());
    assert_eq!(etb(&w.pool, w.e).await.len(), vorher);
    assert_eq!(perioden(&w, w.f1).await[0].ende_at, None);

    // Fremder Raum: 404, ebenso ohne Spur.
    let err = vollzug_mit_verbleib(
        &w,
        a.id,
        jetzt,
        &[],
        AbloesungVerbleib::Bereitstellungsraum,
        Some(geplant + 1000),
    )
    .await
    .unwrap_err();
    assert_eq!(status(err), StatusCode::NOT_FOUND);

    // Steht die Einheit schon in einem Raum: 422 mit dem Raum.
    let schule = raum(&w, "Schule", "aktiv").await;
    belege(&w, schule, w.f1, "eintritt").await;
    let err = vollzug_mit_verbleib(
        &w,
        a.id,
        jetzt,
        &[],
        AbloesungVerbleib::Bereitstellungsraum,
        Some(schule),
    )
    .await
    .unwrap_err();
    let text = err.to_string();
    assert_eq!(status(err), StatusCode::UNPROCESSABLE_ENTITY);
    assert!(
        text.contains("schon im Bereitstellungsraum Schule"),
        "{text}"
    );
}

/// Szenario „Entlassen“ und Akzeptanzkriterium „beendet die Schicht nicht doppelt“ (LLH-1128):
/// die Entlassung statt der Ablösung an Einheit, Erbe und Person; die Schicht ist abgelöst, nicht
/// beendet, und das ETB kennt keinen Satz „mit der Entlassung beendet“. Die Rücknahme streicht
/// die Entlassungen, und die Schicht läuft (auch hier ohne zweiten Satz der Kopplung).
#[tokio::test]
async fn verbleib_entlassen_beendet_nicht_doppelt_und_ruecknahme() {
    let w = welt().await;
    let gruppe = untereinheit(&w, "Gruppe 1", w.f1).await;
    let person: i64 = sqlx::query_scalar(
        "INSERT INTO einsatz_personal (einsatz_id, snap_name, einheit_id) \
         VALUES (?, 'Gruppenführer', ?) RETURNING id",
    )
    .bind(w.e)
    .bind(gruppe)
    .fetch_one(&w.pool)
    .await
    .unwrap();
    for e in [w.f1, gruppe] {
        eintreffen(&w, e, T0).await;
    }
    let (a, _) = beginnen(&w.pool, w.e, w.b, &beginn(w.f1, Some(360)), T0)
        .await
        .unwrap();
    let vorher = etb(&w.pool, w.e).await.len();
    let jetzt = "2026-09-22 15:40:00";
    let (v, _, _) =
        vollzug_mit_verbleib(&w, a.id, jetzt, &[w.f2], AbloesungVerbleib::Entlassen, None)
            .await
            .unwrap();
    assert_eq!(v.abgeloest.status, AbloesungStatus::Abgeloest);
    assert_eq!(v.abgeloest.beendet_grund, None);
    assert_eq!(v.abgeloest.verbleib, AbloesungVerbleib::Entlassen);
    for e in [w.f1, gruppe] {
        let p = perioden(&w, e).await;
        assert_eq!(p[0].ende_at.as_deref(), Some(jetzt), "{e}");
        assert_eq!(p[0].ende_art, Some(Entlassung), "{e}");
        assert_eq!(abloesungsereignisse(&w, "einheit_id", e).await, 0, "{e}");
    }
    let entlassungen = |spalte: &'static str, id: i64| {
        let pool = w.pool.clone();
        async move {
            sqlx::query_scalar::<_, i64>(sqlx::AssertSqlSafe(format!(
                "SELECT COUNT(*) FROM einsatz_kraft_zeitachse \
                 WHERE {spalte} = ? AND art = 'entlassung' AND gestrichen_at IS NULL"
            )))
            .bind(id)
            .fetch_one(&pool)
            .await
            .unwrap()
        }
    };
    assert_eq!(entlassungen("personal_id", person).await, 1, "Fan-out");
    let eintraege = etb(&w.pool, w.e).await;
    assert_eq!(eintraege.len(), vorher + 1, "genau ein ETB-Satz");
    assert!(
        eintraege
            .last()
            .unwrap()
            .1
            .ends_with("«Florian 1» danach entlassen."),
        "{:?}",
        eintraege.last()
    );
    assert!(
        !eintraege
            .iter()
            .any(|e| e.1.contains("mit der Entlassung beendet")),
        "keine zweite Beendigung"
    );

    let vorher = etb(&w.pool, w.e).await.len();
    let (r, _, _) = zuruecknehmen(&w.pool, w.e, a.id, w.b, jetzt).await.unwrap();
    assert_eq!(r.status, AbloesungStatus::Laufend);
    assert_eq!(r.verbleib, AbloesungVerbleib::Ruhe);
    for e in [w.f1, gruppe] {
        assert_eq!(perioden(&w, e).await[0].ende_at, None, "wieder offen {e}");
    }
    assert_eq!(entlassungen("personal_id", person).await, 0);
    let eintraege = etb(&w.pool, w.e).await;
    assert_eq!(eintraege.len(), vorher + 1, "nur die Berichtigung");
    assert!(
        eintraege
            .last()
            .unwrap()
            .1
            .contains("Entlassung gestrichen."),
        "{:?}",
        eintraege.last()
    );
}

/// Szenario „Ablöser wartet im Raum“ (Entscheidung 31.10.2026: abrufen und austragen): der
/// Verband geht mit, ein schon abgerufener Ablöser rückt nur aus, der ETB-Satz nennt beides. Die
/// Rücknahme bucht beide wieder ein; wer sich inzwischen bewegt hat, bleibt.
#[tokio::test]
async fn abloeser_im_raum_ruecken_aus_und_kommen_bei_ruecknahme_zurueck() {
    let w = welt().await;
    let sport = raum(&w, "Sportplatz", "aktiv").await;
    let schule = raum(&w, "Schule", "aktiv").await;
    let trupp = untereinheit(&w, "Trupp 2", w.f2).await;
    let f3 = einheit(&w.pool, w.e, "Florian 3", None).await;
    let f4 = einheit(&w.pool, w.e, "Florian 4", None).await;
    belege(&w, sport, w.f2, "eintritt").await;
    belege(&w, sport, trupp, "eintritt").await;
    belege(&w, schule, f3, "eintritt").await;
    belege(&w, schule, f3, "abruf").await;
    belege(&w, schule, f4, "eintritt").await;
    let (a, _) = beginnen(&w.pool, w.e, w.b, &beginn(w.f1, Some(360)), T0)
        .await
        .unwrap();
    let jetzt = "2026-09-22 15:40:00";
    let (_, _, wirkung) = vollzug_mit_verbleib(
        &w,
        a.id,
        jetzt,
        &[w.f2, f3, f4],
        AbloesungVerbleib::Ruhe,
        None,
    )
    .await
    .unwrap();
    for e in [w.f2, trupp, f3, f4] {
        assert_eq!(steht_in(&w, e).await, None, "{e} rückt aus");
    }
    let arten = |v: Vec<(i64, String, Option<String>)>| -> Vec<String> {
        v.into_iter().map(|(_, a, _)| a).collect()
    };
    assert_eq!(
        arten(belegungen(&w, w.f2).await),
        ["eintritt", "abruf", "austritt"]
    );
    assert_eq!(
        arten(belegungen(&w, trupp).await),
        ["eintritt", "abruf", "austritt"],
        "der Verband geht mit"
    );
    assert_eq!(
        arten(belegungen(&w, f3).await),
        ["eintritt", "abruf", "austritt"],
        "schon abgerufen: nur der Austritt"
    );
    let mut raeume = wirkung.raeume.clone();
    raeume.sort_unstable();
    assert_eq!(raeume, vec![sport, schule, schule]);
    let text = etb(&w.pool, w.e).await.last().unwrap().1.clone();
    assert!(
        text.contains(
            "«Florian 2» mit «Trupp 2» aus Bereitstellungsraum Sportplatz abgerufen und \
             ausgerückt."
        ),
        "{text}"
    );
    assert!(
        text.contains("«Florian 3» rückt aus Bereitstellungsraum Schule aus."),
        "{text}"
    );

    // „Florian 4“ ist inzwischen wieder eingetreten: die Rücknahme lässt ihn.
    belege(&w, schule, f4, "eintritt").await;
    zuruecknehmen(&w.pool, w.e, a.id, w.b, jetzt).await.unwrap();
    assert_eq!(steht_in(&w, w.f2).await, Some(sport));
    assert_eq!(steht_in(&w, trupp).await, Some(sport));
    assert_eq!(steht_in(&w, f3).await, Some(schule));
    assert_eq!(steht_in(&w, f4).await, Some(schule));
    assert_eq!(
        arten(belegungen(&w, f4).await),
        ["eintritt", "abruf", "austritt", "eintritt"],
        "kein zweiter Eintritt"
    );
    let text = etb(&w.pool, w.e).await.last().unwrap().1.clone();
    assert!(
        text.contains("«Florian 2» wieder in Bereitstellungsraum Sportplatz."),
        "{text}"
    );
    assert!(!text.contains("«Florian 4»"), "{text}");
}

/// LLH-1308: der ETB-Text des Vollzugs bleibt in der ETB-Grenze; überzählige Raum-Sätze fallen
/// weg und werden gezählt, der Verbleib bleibt stehen.
#[test]
fn vollzug_inhalt_bleibt_in_der_grenze() {
    let kopf = "Ablösung vollzogen: «A» durch «B».".to_string();
    let saetze: Vec<String> = (0..4)
        .map(|i| format!("«R{i}» rückt aus Raum X aus"))
        .collect();
    let verbleib = " «A» danach entlassen.";

    let voll = vollzug_inhalt_gekappt(kopf.clone(), &saetze, Some(verbleib), 10_000);
    assert_eq!(
        voll,
        "Ablösung vollzogen: «A» durch «B». «R0» rückt aus Raum X aus. «R1» rückt aus Raum X aus. \
         «R2» rückt aus Raum X aus. «R3» rückt aus Raum X aus. «A» danach entlassen."
    );

    let max = kopf.chars().count() + 2 * 25 + 80;
    let gekappt = vollzug_inhalt_gekappt(kopf.clone(), &saetze, Some(verbleib), max);
    assert!(gekappt.chars().count() <= max, "{gekappt}");
    assert!(gekappt.ends_with(" «A» danach entlassen."), "{gekappt}");
    assert!(
        gekappt.contains("weitere ablösende Einheit"),
        "überzählige Sätze werden gezählt: {gekappt}"
    );
    let stehen = saetze
        .iter()
        .filter(|s| gekappt.contains(s.as_str()))
        .count();
    let gezaehlt: usize = gekappt
        .split(" weitere")
        .next()
        .and_then(|v| v.rsplit(' ').next())
        .and_then(|n| n.parse().ok())
        .unwrap();
    assert_eq!(stehen + gezaehlt, saetze.len(), "{gekappt}");

    // Passt kein Raum-Satz, zählt der Text alle; der Verbleib steht trotzdem.
    let eng = kopf.chars().count() + 75 + verbleib.chars().count();
    let nur_zahl = vollzug_inhalt_gekappt(kopf.clone(), &saetze, Some(verbleib), eng);
    assert_eq!(
        nur_zahl,
        format!(
            "{kopf} 4 weitere ablösende Einheiten aus Bereitstellungsräumen ausgerückt.{verbleib}"
        )
    );
}

// ── Herkunft des Beginns (LLH-1312) ─────────────────────────────────────────────────────────

/// Ändert nur den Beginn einer Schicht.
async fn beginn_aendern(w: &Welt, id: i64, beginn_at: &str) {
    aendern(
        &w.pool,
        w.e,
        id,
        w.b,
        &AenderungEingabe {
            beginn_at: Some(beginn_at.into()),
            ..Default::default()
        },
        T0,
    )
    .await
    .unwrap();
}

/// Spec „Herkunft des Beginns“: von Hand ist `hand`, auch wenn der Beginn das übernommene
/// Eintreffen ist (begonnen hat sie ein Mensch).
#[tokio::test]
async fn von_hand_begonnen_traegt_hand_auch_mit_dem_eintreffen_als_beginn() {
    let w = welt().await;
    let (a, _) = beginnen(&w.pool, w.e, w.b, &beginn(w.f1, Some(360)), T0)
        .await
        .unwrap();
    assert_eq!(a.beginn_quelle, BeginnQuelle::Hand);

    eintreffen(&w, w.f2, "2026-09-22 06:40:00").await;
    let (b, _) = beginnen(
        &w.pool,
        w.e,
        w.b,
        &BeginnEingabe {
            einheit_id: w.f2,
            beginn_at: None,
            rhythmus_minuten: Some(360),
        },
        "2026-09-22 09:00:00",
    )
    .await
    .unwrap();
    assert_eq!(b.beginn_at, "2026-09-22 06:40:00");
    assert_eq!(b.beginn_quelle, BeginnQuelle::Hand);
}

/// Spec „Herkunft des Beginns“, Szenarien „Autostart“ und „Beginn korrigiert“: der Autostart
/// trägt `eintreffen`; der Rhythmus ändert das nicht, ein geänderter Beginn macht `hand` daraus.
#[tokio::test]
async fn autostart_traegt_eintreffen_bis_der_beginn_geaendert_wird() {
    let w = welt().await;
    set_einsatz_rhythmus(&w, 360).await;
    ereignis(&w, w.f2, Eintreffen, ANKUNFT).await;
    let s = schichten(&w, w.f2).await;
    assert_eq!(s[0].beginn_quelle, BeginnQuelle::Eintreffen);

    aendern(
        &w.pool,
        w.e,
        s[0].id,
        w.b,
        &AenderungEingabe {
            rhythmus_minuten: Some(Some(480)),
            ..Default::default()
        },
        T0,
    )
    .await
    .unwrap();
    assert_eq!(
        schichten(&w, w.f2).await[0].beginn_quelle,
        BeginnQuelle::Eintreffen,
        "der Rhythmus ändert die Herkunft nicht"
    );

    beginn_aendern(&w, s[0].id, "2030-06-03 08:30:00").await;
    assert_eq!(
        schichten(&w, w.f2).await[0].beginn_quelle,
        BeginnQuelle::Hand,
        "ein korrigierter Beginn ist nicht mehr das Eintreffen"
    );
}

/// Spec „Herkunft des Beginns“, Szenario „Folgeschicht“: die neue Folgeschicht trägt `vollzug`,
/// auch mit geändertem Beginn; die Rücknahme räumt sie samt Herkunft.
#[tokio::test]
async fn folgeschicht_traegt_vollzug_auch_mit_geaendertem_beginn() {
    let w = welt().await;
    let (a, _) = beginnen(&w.pool, w.e, w.b, &beginn(w.f1, Some(360)), T0)
        .await
        .unwrap();
    let jetzt = "2026-09-22 15:40:00";
    let (v, _, _) = vollziehen(&w.pool, w.e, a.id, w.b, jetzt, Some(w.f2), jetzt)
        .await
        .unwrap();
    let f = v.folgeschicht.expect("Folgeschicht");
    assert_eq!(f.beginn_quelle, BeginnQuelle::Vollzug);
    assert_eq!(
        v.abgeloest.beginn_quelle,
        BeginnQuelle::Hand,
        "der Vorgänger bleibt"
    );

    beginn_aendern(&w, f.id, "2026-09-22 15:50:00").await;
    let f = laden(&w.pool, w.e, f.id, jetzt).await.unwrap();
    assert_eq!(f.beginn_quelle, BeginnQuelle::Vollzug);
}

/// Eine beim Vollzug übernommene Schicht lief schon vorher: sie behält ihre Herkunft, auch über
/// die Rücknahme.
#[tokio::test]
async fn uebernommene_schicht_behaelt_ihre_herkunft() {
    let w = welt().await;
    set_einsatz_rhythmus(&w, 360).await;
    let (a, _) = beginnen(&w.pool, w.e, w.b, &beginn(w.f1, Some(360)), T0)
        .await
        .unwrap();
    ereignis(&w, w.f2, Eintreffen, ANKUNFT).await;
    let eigene = schichten(&w, w.f2).await.remove(0);
    assert_eq!(eigene.beginn_quelle, BeginnQuelle::Eintreffen);

    let jetzt = "2030-06-03 15:40:00";
    let (v, _, _) = vollziehen(&w.pool, w.e, a.id, w.b, jetzt, Some(w.f2), jetzt)
        .await
        .unwrap();
    let f = v.folgeschicht.expect("übernommen");
    assert_eq!(f.id, eigene.id);
    assert!(f.uebernommen_bei_vollzug);
    assert_eq!(f.beginn_quelle, BeginnQuelle::Eintreffen);

    zuruecknehmen(&w.pool, w.e, a.id, w.b, jetzt).await.unwrap();
    let geloest = laden(&w.pool, w.e, eigene.id, jetzt).await.unwrap();
    assert_eq!(geloest.beginn_quelle, BeginnQuelle::Eintreffen);
}
