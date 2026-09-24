//! Repo-Tests des Fachmoduls Betreuung (LFH-639) — je Spec-Szenario mindestens ein Test.
//! Die Schreibpfade laufen wie in der Route in `write_retry!`.

use super::*;
use crate::betreuung::{
    BetreuungsstelleArt as Art, BetreuungsstelleStatus as Status, Erhebung, Raeumungszustand,
};
use crate::error::AppError;
use crate::write_retry;
use axum::http::StatusCode;

const STARTWERT: i64 = 1;

struct Welt {
    pool: SqlitePool,
    b: i64,
    e: i64,
    abschnitt: i64,
    /// Abschnitt eines anderen Einsatzes.
    fremder_abschnitt: i64,
    /// Ein anderer Einsatz.
    e2: i64,
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
    let e = einsatz(&pool, "Hochwasser").await;
    let e2 = einsatz(&pool, "Anderer Einsatz").await;
    let ea_nord = abschnitt(&pool, e, "EA Nord").await;
    let fremder_abschnitt = abschnitt(&pool, e2, "EA Fremd").await;
    Welt {
        pool,
        b,
        e,
        abschnitt: ea_nord,
        fremder_abschnitt,
        e2,
    }
}

async fn einsatz(pool: &SqlitePool, name: &str) -> i64 {
    sqlx::query_scalar("INSERT INTO einsatz (org_id, bezeichnung) VALUES (1, ?) RETURNING id")
        .bind(name)
        .fetch_one(pool)
        .await
        .unwrap()
}

async fn abschnitt(pool: &SqlitePool, e: i64, name: &str) -> i64 {
    sqlx::query_scalar("INSERT INTO einsatzabschnitt (einsatz_id, name) VALUES (?, ?) RETURNING id")
        .bind(e)
        .bind(name)
        .fetch_one(pool)
        .await
        .unwrap()
}

/// ETB des Einsatzes: `(id, typ, inhalt, berichtigt_eintrag_id, ereigniszeit)`.
type Etb = (i64, String, String, Option<i64>, String);

async fn etb(pool: &SqlitePool, e: i64) -> Vec<Etb> {
    sqlx::query_as(
        "SELECT id, typ, inhalt, berichtigt_eintrag_id, ereigniszeit FROM etb_eintrag \
         WHERE einsatz_id = ? ORDER BY id",
    )
    .bind(e)
    .fetch_all(pool)
    .await
    .unwrap()
}

async fn zaehle(pool: &SqlitePool, sql: &'static str) -> i64 {
    sqlx::query_scalar(sql).fetch_one(pool).await.unwrap()
}

fn status(r: Result<impl std::fmt::Debug, AppError>) -> StatusCode {
    r.unwrap_err().status()
}

// ── Wrapper: Schreibpfade in write_retry! wie in der Route ──────────────────────────────────

fn bezirk_eingabe(bezeichnung: &str, plan: i64, erhebung: Erhebung) -> BezirkEingabe {
    BezirkEingabe {
        bezeichnung: bezeichnung.into(),
        abschnitt_id: None,
        plan_personen: plan,
        plan_erhebung: erhebung,
        sammelstelle: None,
        notiz: None,
    }
}

async fn bezirk_anlegen(w: &Welt, eingabe: BezirkEingabe) -> Result<Geschrieben, AppError> {
    write_retry!(&w.pool, |conn| {
        bezirk_anlegen_tx(conn, w.e, w.b, STARTWERT, &eingabe).await
    })
}

async fn bezirk(w: &Welt, bezeichnung: &str, plan: i64) -> i64 {
    bezirk_anlegen(w, bezirk_eingabe(bezeichnung, plan, Erhebung::Geschaetzt))
        .await
        .unwrap()
        .id
}

async fn bezirk_aendern(w: &Welt, id: i64, a: BezirkAenderung) -> Result<Geschrieben, AppError> {
    write_retry!(&w.pool, |conn| {
        bezirk_aendern_tx(conn, w.e, id, w.b, STARTWERT, &a).await
    })
}

async fn bezirk_stornieren(w: &Welt, id: i64) -> Result<Geschrieben, AppError> {
    bezirk_stornieren_mit_zonen(w, id).await.map(|(g, _)| g)
}

async fn bezirk_stornieren_mit_zonen(
    w: &Welt,
    id: i64,
) -> Result<(Geschrieben, Vec<i64>), AppError> {
    write_retry!(&w.pool, |conn| {
        bezirk_stornieren_tx(conn, w.e, id, w.b, STARTWERT).await
    })
}

async fn stand(
    w: &Welt,
    bezirk_id: i64,
    evakuiert: i64,
    erhebung: Erhebung,
    zeitpunkt_at: &str,
) -> Result<Gemeldet, AppError> {
    let eingabe = StandEingabe {
        evakuiert,
        erhebung,
        zeitpunkt_at: zeitpunkt_at.into(),
    };
    write_retry!(&w.pool, |conn| {
        stand_melden_tx(conn, w.e, bezirk_id, w.b, STARTWERT, &eingabe).await
    })
}

async fn stand_zurueck(w: &Welt, stand_id: i64) -> Result<Gemeldet, AppError> {
    write_retry!(&w.pool, |conn| {
        stand_zuruecknehmen_tx(conn, w.e, stand_id, w.b, STARTWERT).await
    })
}

fn stelle_eingabe(bezeichnung: &str, art: Art, kapazitaet: Option<i64>) -> StelleEingabe {
    StelleEingabe {
        bezeichnung: bezeichnung.into(),
        art,
        abschnitt_id: None,
        kapazitaet_personen: kapazitaet,
        standort: None,
        notiz: None,
    }
}

async fn stelle_anlegen(w: &Welt, eingabe: StelleEingabe) -> Result<Geschrieben, AppError> {
    write_retry!(&w.pool, |conn| {
        stelle_anlegen_tx(conn, w.e, w.b, STARTWERT, &eingabe).await
    })
}

async fn stelle(w: &Welt, bezeichnung: &str, kapazitaet: Option<i64>) -> i64 {
    stelle_anlegen(
        w,
        stelle_eingabe(bezeichnung, Art::Notunterkunft, kapazitaet),
    )
    .await
    .unwrap()
    .id
}

async fn stelle_aendern(w: &Welt, id: i64, a: StelleAenderung) -> Result<Geschrieben, AppError> {
    write_retry!(&w.pool, |conn| {
        stelle_aendern_tx(conn, w.e, id, w.b, STARTWERT, &a).await
    })
}

async fn stelle_status(w: &Welt, id: i64, s: Status) -> Result<Geschrieben, AppError> {
    stelle_aendern(
        w,
        id,
        StelleAenderung {
            status: Some(s),
            ..Default::default()
        },
    )
    .await
}

async fn stelle_stornieren(w: &Welt, id: i64) -> Result<Geschrieben, AppError> {
    write_retry!(&w.pool, |conn| {
        stelle_stornieren_tx(conn, w.e, id, w.b, STARTWERT).await
    })
}

async fn belegung(
    w: &Welt,
    stelle_id: i64,
    belegt: i64,
    zeitpunkt_at: &str,
) -> Result<Gemeldet, AppError> {
    let eingabe = BelegungEingabe {
        belegt,
        zeitpunkt_at: zeitpunkt_at.into(),
    };
    write_retry!(&w.pool, |conn| {
        belegung_melden_tx(conn, w.e, stelle_id, w.b, STARTWERT, &eingabe).await
    })
}

async fn belegung_zurueck(w: &Welt, belegung_id: i64) -> Result<Gemeldet, AppError> {
    write_retry!(&w.pool, |conn| {
        belegung_zuruecknehmen_tx(conn, w.e, belegung_id, w.b, STARTWERT).await
    })
}

async fn aktueller_stand(w: &Welt, bezirk_id: i64) -> Option<i64> {
    bezirk_laden(&w.pool, w.e, bezirk_id)
        .await
        .unwrap()
        .stand
        .map(|s| s.evakuiert)
}

async fn aktuelle_belegung(w: &Welt, stelle_id: i64) -> Option<i64> {
    stelle_laden(&w.pool, w.e, stelle_id)
        .await
        .unwrap()
        .belegung
        .map(|b| b.belegt)
}

// ── Requirement: Evakuierungsbezirk ─────────────────────────────────────────────────────────

#[tokio::test]
async fn bezirk_anlegen_angeordnet_ohne_stand_mit_entscheidung() {
    let w = welt().await;
    let mut eingabe = bezirk_eingabe("  Uferstraße 12–40 ", 640, Erhebung::Geschaetzt);
    eingabe.abschnitt_id = Some(w.abschnitt);
    let g = bezirk_anlegen(&w, eingabe).await.unwrap();

    let b = bezirk_laden(&w.pool, w.e, g.id).await.unwrap();
    assert_eq!(b.bezeichnung, "Uferstraße 12–40", "getrimmt gespeichert");
    assert_eq!(b.raeumung, Raeumungszustand::Angeordnet);
    assert_eq!(b.plan_personen, 640);
    assert_eq!(b.plan_erhebung, Erhebung::Geschaetzt);
    assert_eq!(b.abschnitt_name.as_deref(), Some("EA Nord"));
    assert!(b.stand.is_none());
    let v = serde_json::to_value(&b).unwrap();
    assert!(
        !v.as_object().unwrap().contains_key("stand"),
        "ohne Meldung fehlt `stand` auf dem Draht"
    );

    let etb = etb(&w.pool, w.e).await;
    assert_eq!(etb.len(), 1);
    assert_eq!(g.etb_ids, vec![etb[0].0]);
    assert_eq!(etb[0].1, "entscheidung");
    assert!(
        etb[0].2.contains("Uferstraße 12–40") && etb[0].2.contains("640"),
        "{}",
        etb[0].2
    );

    let u = uebersicht(&w.pool, w.e).await.unwrap();
    assert_eq!(u.bezirke.len(), 1);
    assert!(u.stellen.is_empty());
}

#[tokio::test]
async fn plangroesse_kleiner_1_ist_400_und_legt_nichts_an() {
    let w = welt().await;
    for plan in [0, -5] {
        let r = bezirk_anlegen(&w, bezirk_eingabe("Uferstraße", plan, Erhebung::Gezaehlt)).await;
        assert_eq!(status(r), StatusCode::BAD_REQUEST, "Plan {plan}");
    }
    assert_eq!(
        zaehle(&w.pool, "SELECT COUNT(*) FROM evakuierungsbezirk").await,
        0
    );
    assert!(etb(&w.pool, w.e).await.is_empty());
}

#[tokio::test]
async fn leere_bezeichnung_ist_400() {
    let w = welt().await;
    for bez in ["", "   "] {
        let r = bezirk_anlegen(&w, bezirk_eingabe(bez, 640, Erhebung::Gezaehlt)).await;
        assert_eq!(status(r), StatusCode::BAD_REQUEST, "{bez:?}");
    }
    assert_eq!(
        zaehle(&w.pool, "SELECT COUNT(*) FROM evakuierungsbezirk").await,
        0
    );
}

#[tokio::test]
async fn doppelte_bezeichnung_ist_409_und_nach_storno_wieder_frei() {
    let w = welt().await;
    let erster = bezirk(&w, "Uferstraße 12–40", 640).await;
    let r = bezirk_anlegen(
        &w,
        bezirk_eingabe(" Uferstraße 12–40", 100, Erhebung::Gezaehlt),
    )
    .await;
    assert_eq!(status(r), StatusCode::CONFLICT);
    assert_eq!(
        zaehle(&w.pool, "SELECT COUNT(*) FROM evakuierungsbezirk").await,
        1
    );
    assert_eq!(
        etb(&w.pool, w.e).await.len(),
        1,
        "kein ETB für die Ablehnung"
    );

    // Dieselbe Bezeichnung in einem anderen Einsatz ist frei.
    write_retry!(&w.pool, |conn| {
        bezirk_anlegen_tx(
            conn,
            w.e2,
            w.b,
            STARTWERT,
            &bezirk_eingabe("Uferstraße 12–40", 10, Erhebung::Gezaehlt),
        )
        .await
    })
    .unwrap();

    bezirk_stornieren(&w, erster).await.unwrap();
    bezirk(&w, "Uferstraße 12–40", 820).await;
}

/// Der partielle UNIQUE-Index selbst, am Repo vorbei: er lehnt die doppelte Bezeichnung ab
/// und lässt sie nach dem Stornieren wieder zu. Für beide Tabellen.
#[tokio::test]
async fn unique_index_greift_direkt_und_storno_gibt_frei() {
    let w = welt().await;
    for (tabelle, rest_spalten, rest_werte) in [
        (
            "evakuierungsbezirk",
            "plan_personen, plan_erhebung",
            "640, 'gezaehlt'",
        ),
        ("betreuungsstelle", "art", "'notunterkunft'"),
    ] {
        let insert = format!(
            "INSERT INTO {tabelle} (einsatz_id, bezeichnung, {rest_spalten}, angelegt_von_id) \
             VALUES (?, 'Doppelt', {rest_werte}, ?)"
        );
        let erst = sqlx::query(sqlx::AssertSqlSafe(insert.clone()))
            .bind(w.e)
            .bind(w.b)
            .execute(&w.pool)
            .await
            .unwrap()
            .last_insert_rowid();
        let fehler = sqlx::query(sqlx::AssertSqlSafe(insert.clone()))
            .bind(w.e)
            .bind(w.b)
            .execute(&w.pool)
            .await
            .unwrap_err();
        let db = fehler.as_database_error().expect("DB-Fehler");
        assert!(db.is_unique_violation(), "{tabelle}: {db}");
        assert_eq!(
            AppError::from(fehler).status(),
            StatusCode::CONFLICT,
            "Sicherheitsnetz → 409"
        );

        sqlx::query(sqlx::AssertSqlSafe(format!(
            "UPDATE {tabelle} SET storniert_at = datetime('now') WHERE id = ?"
        )))
        .bind(erst)
        .execute(&w.pool)
        .await
        .unwrap();
        sqlx::query(sqlx::AssertSqlSafe(insert))
            .bind(w.e)
            .bind(w.b)
            .execute(&w.pool)
            .await
            .unwrap();
    }
}

#[tokio::test]
async fn abschnitt_eines_anderen_einsatzes_ist_404() {
    let w = welt().await;
    let mut eingabe = bezirk_eingabe("Uferstraße", 640, Erhebung::Gezaehlt);
    eingabe.abschnitt_id = Some(w.fremder_abschnitt);
    assert_eq!(
        status(bezirk_anlegen(&w, eingabe).await),
        StatusCode::NOT_FOUND
    );

    let id = bezirk(&w, "Uferstraße", 640).await;
    let r = bezirk_aendern(
        &w,
        id,
        BezirkAenderung {
            abschnitt_id: Some(Some(w.fremder_abschnitt)),
            ..Default::default()
        },
    )
    .await;
    assert_eq!(status(r), StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn bezirk_eines_anderen_einsatzes_ist_404() {
    let w = welt().await;
    let fremd = write_retry!(&w.pool, |conn| {
        bezirk_anlegen_tx(
            conn,
            w.e2,
            w.b,
            STARTWERT,
            &bezirk_eingabe("Fremd", 10, Erhebung::Gezaehlt),
        )
        .await
    })
    .unwrap()
    .id;
    assert_eq!(
        status(bezirk_laden(&w.pool, w.e, fremd).await),
        StatusCode::NOT_FOUND
    );
    assert_eq!(
        status(bezirk_stornieren(&w, fremd).await),
        StatusCode::NOT_FOUND
    );
    assert_eq!(
        status(stand(&w, fremd, 1, Erhebung::Gezaehlt, "2026-09-23 12:00:00").await),
        StatusCode::NOT_FOUND
    );
}

// ── Requirement: Bezirk fortschreiben ──────────────────────────────────────────────────────

#[tokio::test]
async fn plangroesse_fortschreiben_ist_entscheidung_mit_vorwert() {
    let w = welt().await;
    let id = bezirk(&w, "Uferstraße 12–40", 640).await;
    let g = bezirk_aendern(
        &w,
        id,
        BezirkAenderung {
            plan_personen: Some(820),
            plan_erhebung: Some(Erhebung::Gezaehlt),
            ..Default::default()
        },
    )
    .await
    .unwrap();
    let b = bezirk_laden(&w.pool, w.e, id).await.unwrap();
    assert_eq!(b.plan_personen, 820);
    assert_eq!(b.plan_erhebung, Erhebung::Gezaehlt);
    assert!(b.geaendert_at.is_some());

    let etb = etb(&w.pool, w.e).await;
    assert_eq!(etb.len(), 2);
    assert_eq!(
        g.etb_ids,
        vec![etb[1].0],
        "genau ein Eintrag für Plangröße+Erhebung"
    );
    assert_eq!(etb[1].1, "entscheidung");
    assert!(
        etb[1].2.contains("820") && etb[1].2.contains("vorher 640"),
        "{}",
        etb[1].2
    );
}

#[tokio::test]
async fn bezirk_geraeumt_ist_meldung() {
    let w = welt().await;
    let id = bezirk(&w, "Uferstraße 12–40", 640).await;
    bezirk_aendern(
        &w,
        id,
        BezirkAenderung {
            raeumung: Some(Raeumungszustand::Geraeumt),
            ..Default::default()
        },
    )
    .await
    .unwrap();
    assert_eq!(
        bezirk_laden(&w.pool, w.e, id).await.unwrap().raeumung,
        Raeumungszustand::Geraeumt
    );
    let etb = etb(&w.pool, w.e).await;
    let letzter = etb.last().unwrap();
    assert_eq!(letzter.1, "meldung");
    assert!(
        letzter.2.contains("Uferstraße 12–40") && letzter.2.contains("geräumt"),
        "{}",
        letzter.2
    );
}

/// ETB-Typ je Zielzustand nach D5.
#[tokio::test]
async fn raeumungswechsel_etb_typ_je_zustand() {
    let w = welt().await;
    let id = bezirk(&w, "Uferstraße", 640).await;
    for (z, typ) in [
        (Raeumungszustand::Laeuft, "meldung"),
        (Raeumungszustand::Aufgehoben, "entscheidung"),
        (Raeumungszustand::Angeordnet, "entscheidung"),
    ] {
        bezirk_aendern(
            &w,
            id,
            BezirkAenderung {
                raeumung: Some(z),
                ..Default::default()
            },
        )
        .await
        .unwrap();
        let etb = etb(&w.pool, w.e).await;
        assert_eq!(etb.last().unwrap().1, typ, "{z:?}");
    }
}

#[tokio::test]
async fn unveraenderte_werte_schreiben_keinen_etb_eintrag() {
    let w = welt().await;
    let mut eingabe = bezirk_eingabe("Uferstraße", 640, Erhebung::Geschaetzt);
    eingabe.abschnitt_id = Some(w.abschnitt);
    eingabe.sammelstelle = Some("Kirchplatz".into());
    let id = bezirk_anlegen(&w, eingabe).await.unwrap().id;
    let vorher = etb(&w.pool, w.e).await.len();

    let g = bezirk_aendern(
        &w,
        id,
        BezirkAenderung {
            bezeichnung: Some("Uferstraße".into()),
            abschnitt_id: Some(Some(w.abschnitt)),
            plan_personen: Some(640),
            plan_erhebung: Some(Erhebung::Geschaetzt),
            raeumung: Some(Raeumungszustand::Angeordnet),
            sammelstelle: Some(Some("Kirchplatz".into())),
            notiz: Some(None),
        },
    )
    .await
    .unwrap();
    assert_eq!(
        g,
        Geschrieben {
            id,
            etb_ids: vec![],
            still_geaendert: false,
        }
    );
    assert_eq!(etb(&w.pool, w.e).await.len(), vorher);
    assert!(
        bezirk_laden(&w.pool, w.e, id)
            .await
            .unwrap()
            .geaendert_at
            .is_none(),
        "Leerlauf: kein UPDATE"
    );
}

/// Ein PATCH über mehrere Felder schreibt je Achse einen Eintrag mit eigenem Typ (D5).
#[tokio::test]
async fn aenderung_mehrerer_achsen_schreibt_je_einen_eintrag() {
    let w = welt().await;
    let id = bezirk(&w, "Uferstraße", 640).await;
    let g = bezirk_aendern(
        &w,
        id,
        BezirkAenderung {
            bezeichnung: Some("Uferstraße 12–40".into()),
            notiz: Some(Some("Zugang über Hof".into())),
            plan_personen: Some(700),
            raeumung: Some(Raeumungszustand::Laeuft),
            ..Default::default()
        },
    )
    .await
    .unwrap();
    let etb = etb(&w.pool, w.e).await;
    assert_eq!(g.etb_ids.len(), 3);
    let typen: Vec<&str> = etb[1..].iter().map(|e| e.1.as_str()).collect();
    assert_eq!(typen, ["system", "entscheidung", "meldung"]);
    assert!(etb[1].2.contains("vorher ‚Uferstraße‘"), "{}", etb[1].2);
    assert!(
        etb[2].2.contains("‚Uferstraße 12–40‘"),
        "neuer Name: {}",
        etb[2].2
    );
    let b = bezirk_laden(&w.pool, w.e, id).await.unwrap();
    assert_eq!(b.notiz.as_deref(), Some("Zugang über Hof"));
    assert_eq!(b.bezeichnung, "Uferstraße 12–40");
}

#[tokio::test]
async fn aenderung_validiert_die_felder() {
    let w = welt().await;
    let id = bezirk(&w, "Uferstraße", 640).await;
    let r = bezirk_aendern(
        &w,
        id,
        BezirkAenderung {
            plan_personen: Some(0),
            ..Default::default()
        },
    )
    .await;
    assert_eq!(status(r), StatusCode::BAD_REQUEST);
    let r = bezirk_aendern(
        &w,
        id,
        BezirkAenderung {
            bezeichnung: Some("  ".into()),
            ..Default::default()
        },
    )
    .await;
    assert_eq!(status(r), StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn umbenennen_auf_vergebene_bezeichnung_ist_409() {
    let w = welt().await;
    bezirk(&w, "A", 10).await;
    let b = bezirk(&w, "B", 10).await;
    let r = bezirk_aendern(
        &w,
        b,
        BezirkAenderung {
            bezeichnung: Some("A".into()),
            ..Default::default()
        },
    )
    .await;
    assert_eq!(status(r), StatusCode::CONFLICT);
}

#[tokio::test]
async fn stornierten_bezirk_aendern_ist_409() {
    let w = welt().await;
    let id = bezirk(&w, "Uferstraße", 640).await;
    bezirk_stornieren(&w, id).await.unwrap();
    let r = bezirk_aendern(
        &w,
        id,
        BezirkAenderung {
            plan_personen: Some(900),
            ..Default::default()
        },
    )
    .await;
    assert_eq!(status(r), StatusCode::CONFLICT);
}

// ── Requirement: Bezirk stornieren ─────────────────────────────────────────────────────────

#[tokio::test]
async fn stornieren_nimmt_bezirk_aus_der_liste_und_schreibt_etb() {
    let w = welt().await;
    let id = bezirk(&w, "Uferstraße 12–40", 640).await;
    stand(&w, id, 212, Erhebung::Gezaehlt, "2026-09-23 12:00:00")
        .await
        .unwrap();
    let g = bezirk_stornieren(&w, id).await.unwrap();
    assert!(uebersicht(&w.pool, w.e).await.unwrap().bezirke.is_empty());
    assert!(bezirk_laden(&w.pool, w.e, id)
        .await
        .unwrap()
        .storniert_at
        .is_some());
    let etb = etb(&w.pool, w.e).await;
    let letzter = etb.last().unwrap();
    assert_eq!(g.etb_ids, vec![letzter.0]);
    assert_eq!(letzter.1, "system");
    assert!(
        letzter.2.contains("Uferstraße 12–40") && letzter.2.contains("storniert"),
        "{}",
        letzter.2
    );
}

#[tokio::test]
async fn doppelt_stornieren_ist_409() {
    let w = welt().await;
    let id = bezirk(&w, "Uferstraße", 640).await;
    bezirk_stornieren(&w, id).await.unwrap();
    let n = etb(&w.pool, w.e).await.len();
    assert_eq!(
        status(bezirk_stornieren(&w, id).await),
        StatusCode::CONFLICT
    );
    assert_eq!(etb(&w.pool, w.e).await.len(), n);
}

// ── Requirement: Stand „evakuiert“ melden ──────────────────────────────────────────────────

#[tokio::test]
async fn erste_meldung_setzt_stand_und_schreibt_meldung() {
    let w = welt().await;
    let id = bezirk(&w, "Uferstraße 12–40", 640).await;
    let m = stand(&w, id, 212, Erhebung::Gezaehlt, "2026-09-23 12:00:00")
        .await
        .unwrap();
    assert_eq!(m.objekt_id, id);
    let b = bezirk_laden(&w.pool, w.e, id).await.unwrap();
    let s = b.stand.unwrap();
    assert_eq!((s.id, s.evakuiert), (m.meldung_id, 212));
    assert_eq!(s.erhebung, Erhebung::Gezaehlt);
    assert_eq!(s.zeitpunkt_at, "2026-09-23 12:00:00");

    let etb = etb(&w.pool, w.e).await;
    let e = etb.last().unwrap();
    assert_eq!(e.0, m.etb_id);
    assert_eq!(e.1, "meldung");
    assert_eq!(
        e.4, "2026-09-23 12:00:00",
        "Ereigniszeit = Zeitpunkt der Meldung"
    );
    for teil in ["212", "gezählt", "640", "Uferstraße 12–40"] {
        assert!(e.2.contains(teil), "{teil:?} fehlt: {}", e.2);
    }
    let etb_bezug: i64 =
        sqlx::query_scalar("SELECT etb_eintrag_id FROM evakuierung_stand WHERE id = ?")
            .bind(m.meldung_id)
            .fetch_one(&w.pool)
            .await
            .unwrap();
    assert_eq!(etb_bezug, m.etb_id);
}

#[tokio::test]
async fn fortschreibung_nennt_den_vorwert() {
    let w = welt().await;
    let id = bezirk(&w, "Uferstraße", 640).await;
    stand(&w, id, 212, Erhebung::Gezaehlt, "2026-09-23 12:00:00")
        .await
        .unwrap();
    stand(&w, id, 480, Erhebung::Gezaehlt, "2026-09-23 13:00:00")
        .await
        .unwrap();
    assert_eq!(aktueller_stand(&w, id).await, Some(480));
    let etb = etb(&w.pool, w.e).await;
    let e = &etb.last().unwrap().2;
    assert!(e.contains("480") && e.contains("vorher 212"), "{e}");
}

#[tokio::test]
async fn nachgetragene_aeltere_meldung_laesst_den_stand_stehen() {
    let w = welt().await;
    let id = bezirk(&w, "Uferstraße", 640).await;
    stand(&w, id, 480, Erhebung::Gezaehlt, "2026-09-23 13:00:00")
        .await
        .unwrap();
    let alt = stand(&w, id, 212, Erhebung::Geschaetzt, "2026-09-23 12:00:00")
        .await
        .unwrap();
    assert_eq!(aktueller_stand(&w, id).await, Some(480));
    let gespeichert: i64 =
        sqlx::query_scalar("SELECT evakuiert FROM evakuierung_stand WHERE id = ?")
            .bind(alt.meldung_id)
            .fetch_one(&w.pool)
            .await
            .unwrap();
    assert_eq!(gespeichert, 212);
    let etb = etb(&w.pool, w.e).await;
    let e = etb.iter().find(|e| e.0 == alt.etb_id).unwrap();
    assert_eq!(e.4, "2026-09-23 12:00:00");
    // D5: die Nachtragung sagt, dass der Stand bleibt — „vorher 480“ läse sich mit der
    // Ereigniszeit 12:00 als Rückgang, den es nie gab.
    assert!(
        e.2.contains("212") && e.2.contains("nachgetragen") && e.2.contains("bleibt 480"),
        "{}",
        e.2
    );
    assert!(!e.2.contains("vorher"), "{}", e.2);
}

/// Grenze der Nachtragung: gleicher Zeitpunkt wie die aktuelle Meldung ist KEINE Nachtragung
/// — die spätere Erfassung gewinnt (D2), der Text nennt den Vorwert.
#[tokio::test]
async fn gleicher_zeitpunkt_ist_keine_nachtragung() {
    let w = welt().await;
    let id = bezirk(&w, "Uferstraße", 640).await;
    stand(&w, id, 300, Erhebung::Gezaehlt, "2026-09-23 12:00:00")
        .await
        .unwrap();
    let m = stand(&w, id, 310, Erhebung::Gezaehlt, "2026-09-23 12:00:00")
        .await
        .unwrap();
    let etb = etb(&w.pool, w.e).await;
    let e = etb.iter().find(|e| e.0 == m.etb_id).unwrap();
    assert!(e.2.contains("310") && e.2.contains("vorher 300"), "{}", e.2);
    assert!(!e.2.contains("nachgetragen"), "{}", e.2);
}

/// Der Fall aus dem Review: 212 um 12:00, 480 um 14:00, 300 für 13:00 nachgetragen und
/// wieder zurückgenommen. Der Stand ist durchgehend 480; kein Eintrag darf eine Änderung
/// unterstellen.
#[tokio::test]
async fn nachtrag_und_ruecknahme_des_nachtrags_nennen_den_bleibenden_stand() {
    let w = welt().await;
    let id = bezirk(&w, "Uferstraße", 640).await;
    stand(&w, id, 212, Erhebung::Gezaehlt, "2026-09-23 12:00:00")
        .await
        .unwrap();
    stand(&w, id, 480, Erhebung::Gezaehlt, "2026-09-23 14:00:00")
        .await
        .unwrap();
    let nach = stand(&w, id, 300, Erhebung::Gezaehlt, "2026-09-23 13:00:00")
        .await
        .unwrap();
    assert_eq!(aktueller_stand(&w, id).await, Some(480));
    let r = stand_zurueck(&w, nach.meldung_id).await.unwrap();
    assert_eq!(aktueller_stand(&w, id).await, Some(480));
    let etb = etb(&w.pool, w.e).await;
    let meldung = etb.iter().find(|e| e.0 == nach.etb_id).unwrap();
    assert_eq!(
        meldung.2,
        "Bezirk ‚Uferstraße‘: 300 evakuiert (gezählt), nachgetragen, aktueller Stand bleibt \
         480, Plan 640."
    );
    let berichtigung = etb.iter().find(|e| e.0 == r.etb_id).unwrap();
    assert_eq!(berichtigung.3, Some(nach.etb_id));
    assert_eq!(
        berichtigung.2,
        "Meldung zurückgenommen, Stand Bezirk ‚Uferstraße‘ bleibt 480."
    );
}

/// D2: bei gleichem Zeitpunkt gewinnt die später erfasste Meldung (größere id).
#[tokio::test]
async fn gleicher_zeitpunkt_spaetere_erfassung_gewinnt() {
    let w = welt().await;
    let id = bezirk(&w, "Uferstraße", 640).await;
    stand(&w, id, 300, Erhebung::Gezaehlt, "2026-09-23 12:00:00")
        .await
        .unwrap();
    stand(&w, id, 310, Erhebung::Gezaehlt, "2026-09-23 12:00:00")
        .await
        .unwrap();
    assert_eq!(aktueller_stand(&w, id).await, Some(310));
}

/// D5: dieselbe Zahl wie der Vorwert bestätigt den Stand zu einem neuen Zeitpunkt — keine
/// Leermeldung.
#[tokio::test]
async fn gleiche_zahl_wie_vorwert_wird_geschrieben() {
    let w = welt().await;
    let id = bezirk(&w, "Uferstraße", 640).await;
    stand(&w, id, 212, Erhebung::Gezaehlt, "2026-09-23 12:00:00")
        .await
        .unwrap();
    let n = etb(&w.pool, w.e).await.len();
    let m = stand(&w, id, 212, Erhebung::Gezaehlt, "2026-09-23 13:00:00")
        .await
        .unwrap();
    assert_eq!(etb(&w.pool, w.e).await.len(), n + 1);
    let s = bezirk_laden(&w.pool, w.e, id).await.unwrap().stand.unwrap();
    assert_eq!(
        (s.id, s.zeitpunkt_at.as_str()),
        (m.meldung_id, "2026-09-23 13:00:00")
    );
}

#[tokio::test]
async fn stand_ueber_der_plangroesse_wird_angenommen() {
    let w = welt().await;
    let id = bezirk(&w, "Uferstraße", 640).await;
    stand(&w, id, 700, Erhebung::Gezaehlt, "2026-09-23 12:00:00")
        .await
        .unwrap();
    assert_eq!(aktueller_stand(&w, id).await, Some(700));
}

#[tokio::test]
async fn negative_anzahl_oder_unlesbarer_zeitpunkt_ist_400_und_speichert_nichts() {
    let w = welt().await;
    let id = bezirk(&w, "Uferstraße", 640).await;
    let n = etb(&w.pool, w.e).await.len();
    let r = stand(&w, id, -1, Erhebung::Gezaehlt, "2026-09-23 12:00:00").await;
    assert_eq!(status(r), StatusCode::BAD_REQUEST);
    // Auch ein lesbarer, aber nicht auf Drahtform gepolsterter Zeitpunkt ist 400: er stünde
    // im Textvergleich der „aktuell“-Abfrage falsch sortiert.
    for t in [
        "23.09.2026 12:00",
        "2026-9-3 1:02:03",
        " 2026-09-23 12:00:00",
    ] {
        let r = stand(&w, id, 5, Erhebung::Gezaehlt, t).await;
        assert_eq!(status(r), StatusCode::BAD_REQUEST, "{t:?}");
    }
    assert_eq!(
        zaehle(&w.pool, "SELECT COUNT(*) FROM evakuierung_stand").await,
        0
    );
    assert_eq!(etb(&w.pool, w.e).await.len(), n);
}

#[tokio::test]
async fn meldung_an_storniertem_bezirk_ist_409_und_speichert_nichts() {
    let w = welt().await;
    let id = bezirk(&w, "Uferstraße", 640).await;
    bezirk_stornieren(&w, id).await.unwrap();
    let n = etb(&w.pool, w.e).await.len();
    let r = stand(&w, id, 5, Erhebung::Gezaehlt, "2026-09-23 12:00:00").await;
    assert_eq!(status(r), StatusCode::CONFLICT);
    assert_eq!(
        zaehle(&w.pool, "SELECT COUNT(*) FROM evakuierung_stand").await,
        0
    );
    assert_eq!(etb(&w.pool, w.e).await.len(), n);
}

/// Atomarität: scheitert ein Schritt NACH dem ETB-Eintrag, bleibt weder Zeile noch ETB
/// zurück, und der Zeiger ist unverändert.
#[tokio::test]
async fn standmeldung_ist_atomar() {
    let w = welt().await;
    let id = bezirk(&w, "Uferstraße", 640).await;
    stand(&w, id, 212, Erhebung::Gezaehlt, "2026-09-23 12:00:00")
        .await
        .unwrap();
    let n = etb(&w.pool, w.e).await.len();
    sqlx::query(
        "CREATE TRIGGER test_stand_scheitert BEFORE INSERT ON evakuierung_stand \
         BEGIN SELECT RAISE(ABORT, 'Testfehler'); END",
    )
    .execute(&w.pool)
    .await
    .unwrap();
    stand(&w, id, 480, Erhebung::Gezaehlt, "2026-09-23 13:00:00")
        .await
        .unwrap_err();
    assert_eq!(etb(&w.pool, w.e).await.len(), n, "kein ETB-Eintrag übrig");
    assert_eq!(
        zaehle(&w.pool, "SELECT COUNT(*) FROM evakuierung_stand").await,
        1
    );
    assert_eq!(aktueller_stand(&w, id).await, Some(212));
}

// ── Requirement: Standmeldung zurücknehmen ─────────────────────────────────────────────────

#[tokio::test]
async fn letzte_meldung_zuruecknehmen_stellt_vorwert_her() {
    let w = welt().await;
    let id = bezirk(&w, "Uferstraße 12–40", 640).await;
    stand(&w, id, 212, Erhebung::Gezaehlt, "2026-09-23 12:00:00")
        .await
        .unwrap();
    let m480 = stand(&w, id, 480, Erhebung::Gezaehlt, "2026-09-23 13:00:00")
        .await
        .unwrap();
    let r = stand_zurueck(&w, m480.meldung_id).await.unwrap();
    assert_eq!((r.meldung_id, r.objekt_id), (m480.meldung_id, id));
    assert_eq!(aktueller_stand(&w, id).await, Some(212));

    let (zurueck_at, zurueck_von): (Option<String>, Option<i64>) = sqlx::query_as(
        "SELECT zurueckgenommen_at, zurueckgenommen_von_id FROM evakuierung_stand WHERE id = ?",
    )
    .bind(m480.meldung_id)
    .fetch_one(&w.pool)
    .await
    .unwrap();
    assert!(zurueck_at.is_some(), "Zeile bleibt, gekennzeichnet");
    assert_eq!(zurueck_von, Some(w.b));

    let etb = etb(&w.pool, w.e).await;
    let e = etb.last().unwrap();
    assert_eq!(e.0, r.etb_id);
    assert_eq!(e.1, "berichtigung");
    assert_eq!(
        e.3,
        Some(m480.etb_id),
        "verweist auf den Eintrag der Meldung 480"
    );
    assert!(e.2.contains("wieder 212"), "{}", e.2);
}

#[tokio::test]
async fn einzige_meldung_zuruecknehmen_laesst_keinen_stand() {
    let w = welt().await;
    let id = bezirk(&w, "Uferstraße", 640).await;
    let m = stand(&w, id, 212, Erhebung::Gezaehlt, "2026-09-23 12:00:00")
        .await
        .unwrap();
    stand_zurueck(&w, m.meldung_id).await.unwrap();
    assert_eq!(aktueller_stand(&w, id).await, None);
    assert_eq!(
        zaehle(&w.pool, "SELECT COUNT(*) FROM evakuierung_stand").await,
        1,
        "append-only"
    );
}

/// Eine ältere Meldung zurückzunehmen lässt den aktuellen Stand stehen.
#[tokio::test]
async fn aeltere_meldung_zuruecknehmen_laesst_stand_stehen() {
    let w = welt().await;
    let id = bezirk(&w, "Uferstraße", 640).await;
    let alt = stand(&w, id, 212, Erhebung::Gezaehlt, "2026-09-23 12:00:00")
        .await
        .unwrap();
    stand(&w, id, 480, Erhebung::Gezaehlt, "2026-09-23 13:00:00")
        .await
        .unwrap();
    let r = stand_zurueck(&w, alt.meldung_id).await.unwrap();
    assert_eq!(aktueller_stand(&w, id).await, Some(480));
    // „wieder 480“ unterstellte eine Änderung, die es nicht gab.
    let etb = etb(&w.pool, w.e).await;
    let e = etb.iter().find(|e| e.0 == r.etb_id).unwrap();
    assert!(e.2.contains("bleibt 480"), "{}", e.2);
    assert!(!e.2.contains("wieder"), "{}", e.2);
}

#[tokio::test]
async fn doppelt_zuruecknehmen_ist_422_und_aendert_nichts() {
    let w = welt().await;
    let id = bezirk(&w, "Uferstraße", 640).await;
    stand(&w, id, 212, Erhebung::Gezaehlt, "2026-09-23 12:00:00")
        .await
        .unwrap();
    let m = stand(&w, id, 480, Erhebung::Gezaehlt, "2026-09-23 13:00:00")
        .await
        .unwrap();
    stand_zurueck(&w, m.meldung_id).await.unwrap();
    let n = etb(&w.pool, w.e).await.len();
    assert_eq!(
        status(stand_zurueck(&w, m.meldung_id).await),
        StatusCode::UNPROCESSABLE_ENTITY
    );
    assert_eq!(etb(&w.pool, w.e).await.len(), n);
    assert_eq!(aktueller_stand(&w, id).await, Some(212));
}

#[tokio::test]
async fn ruecknahme_am_stornierten_bezirk_ist_409() {
    let w = welt().await;
    let id = bezirk(&w, "Uferstraße", 640).await;
    let m = stand(&w, id, 212, Erhebung::Gezaehlt, "2026-09-23 12:00:00")
        .await
        .unwrap();
    bezirk_stornieren(&w, id).await.unwrap();
    assert_eq!(
        status(stand_zurueck(&w, m.meldung_id).await),
        StatusCode::CONFLICT
    );
    assert_eq!(status(stand_zurueck(&w, 9999).await), StatusCode::NOT_FOUND);
}

// ── Requirement: Betreuungsstelle ──────────────────────────────────────────────────────────

#[tokio::test]
async fn stelle_anlegen_vorbereitet_ohne_belegung() {
    let w = welt().await;
    let mut eingabe = stelle_eingabe(" Turnhalle Ost ", Art::Notunterkunft, Some(150));
    eingabe.abschnitt_id = Some(w.abschnitt);
    let g = stelle_anlegen(&w, eingabe).await.unwrap();
    let s = stelle_laden(&w.pool, w.e, g.id).await.unwrap();
    assert_eq!(s.bezeichnung, "Turnhalle Ost");
    assert_eq!(s.status, Status::Vorbereitet);
    assert_eq!(s.art, Art::Notunterkunft);
    assert_eq!(s.kapazitaet_personen, Some(150));
    assert_eq!(s.abschnitt_name.as_deref(), Some("EA Nord"));
    assert!(s.belegung.is_none());
    let etb = etb(&w.pool, w.e).await;
    assert_eq!(g.etb_ids, vec![etb[0].0]);
    assert_eq!(etb[0].1, "system");
    assert!(
        etb[0].2.contains("Turnhalle Ost") && etb[0].2.contains("Notunterkunft"),
        "{}",
        etb[0].2
    );
    assert_eq!(uebersicht(&w.pool, w.e).await.unwrap().stellen.len(), 1);
}

#[tokio::test]
async fn stelle_ohne_kapazitaet_hat_keine_kapazitaet_auf_dem_draht() {
    let w = welt().await;
    let id = stelle(&w, "Anlaufstelle Markt", None).await;
    let s = stelle_laden(&w.pool, w.e, id).await.unwrap();
    assert_eq!(s.kapazitaet_personen, None);
    let v = serde_json::to_value(&s).unwrap();
    let o = v.as_object().unwrap();
    assert!(!o.contains_key("kapazitaet_personen"));
    assert!(!o.contains_key("belegung"));
}

#[tokio::test]
async fn kapazitaet_kleiner_1_oder_leere_bezeichnung_ist_400() {
    let w = welt().await;
    let r = stelle_anlegen(&w, stelle_eingabe("Halle", Art::Notunterkunft, Some(0))).await;
    assert_eq!(status(r), StatusCode::BAD_REQUEST);
    let r = stelle_anlegen(&w, stelle_eingabe(" ", Art::Notunterkunft, Some(10))).await;
    assert_eq!(status(r), StatusCode::BAD_REQUEST);
    let id = stelle(&w, "Halle", Some(10)).await;
    let r = stelle_aendern(
        &w,
        id,
        StelleAenderung {
            kapazitaet_personen: Some(Some(0)),
            ..Default::default()
        },
    )
    .await;
    assert_eq!(status(r), StatusCode::BAD_REQUEST);
    assert_eq!(
        zaehle(&w.pool, "SELECT COUNT(*) FROM betreuungsstelle").await,
        1
    );
}

#[tokio::test]
async fn stelle_doppelte_bezeichnung_409_fremder_abschnitt_404() {
    let w = welt().await;
    stelle(&w, "Turnhalle Ost", Some(150)).await;
    let r = stelle_anlegen(&w, stelle_eingabe("Turnhalle Ost", Art::Anlaufstelle, None)).await;
    assert_eq!(status(r), StatusCode::CONFLICT);
    let mut eingabe = stelle_eingabe("Weserstadion", Art::Betreuungsplatz, None);
    eingabe.abschnitt_id = Some(w.fremder_abschnitt);
    assert_eq!(
        status(stelle_anlegen(&w, eingabe).await),
        StatusCode::NOT_FOUND
    );
}

#[tokio::test]
async fn schliessen_mit_belegung_ist_422() {
    let w = welt().await;
    let id = stelle(&w, "Turnhalle Ost", Some(150)).await;
    stelle_status(&w, id, Status::InBetrieb).await.unwrap();
    belegung(&w, id, 40, "2026-09-23 12:00:00").await.unwrap();
    let n = etb(&w.pool, w.e).await.len();
    assert_eq!(
        status(stelle_status(&w, id, Status::Geschlossen).await),
        StatusCode::UNPROCESSABLE_ENTITY
    );
    assert_eq!(
        stelle_laden(&w.pool, w.e, id).await.unwrap().status,
        Status::InBetrieb
    );
    assert_eq!(etb(&w.pool, w.e).await.len(), n);
}

#[tokio::test]
async fn schliessen_nach_leermeldung_oder_ohne_meldung() {
    let w = welt().await;
    let id = stelle(&w, "Turnhalle Ost", Some(150)).await;
    stelle_status(&w, id, Status::InBetrieb).await.unwrap();
    belegung(&w, id, 40, "2026-09-23 12:00:00").await.unwrap();
    belegung(&w, id, 0, "2026-09-23 13:00:00").await.unwrap();
    stelle_status(&w, id, Status::Geschlossen).await.unwrap();
    assert_eq!(
        stelle_laden(&w.pool, w.e, id).await.unwrap().status,
        Status::Geschlossen
    );

    let ohne = stelle(&w, "Weserstadion", None).await;
    stelle_status(&w, ohne, Status::Geschlossen).await.unwrap();
    assert_eq!(
        stelle_laden(&w.pool, w.e, ohne).await.unwrap().status,
        Status::Geschlossen
    );
}

#[tokio::test]
async fn stornierte_stelle_ist_409_fuer_aendern_stornieren_und_belegung() {
    let w = welt().await;
    let id = stelle(&w, "Turnhalle Ost", Some(150)).await;
    let g = stelle_stornieren(&w, id).await.unwrap();
    let etb_liste = etb(&w.pool, w.e).await;
    assert_eq!(g.etb_ids, vec![etb_liste.last().unwrap().0]);
    assert!(etb_liste.last().unwrap().2.contains("storniert"));
    assert!(uebersicht(&w.pool, w.e).await.unwrap().stellen.is_empty());

    let n = etb_liste.len();
    assert_eq!(
        status(
            stelle_aendern(
                &w,
                id,
                StelleAenderung {
                    kapazitaet_personen: Some(Some(200)),
                    ..Default::default()
                }
            )
            .await
        ),
        StatusCode::CONFLICT
    );
    assert_eq!(
        status(stelle_stornieren(&w, id).await),
        StatusCode::CONFLICT
    );
    assert_eq!(
        status(belegung(&w, id, 5, "2026-09-23 12:00:00").await),
        StatusCode::CONFLICT
    );
    assert_eq!(
        zaehle(&w.pool, "SELECT COUNT(*) FROM betreuungsstelle_belegung").await,
        0
    );
    assert_eq!(etb(&w.pool, w.e).await.len(), n);
    // Die Bezeichnung ist wieder frei.
    stelle(&w, "Turnhalle Ost", Some(150)).await;
}

#[tokio::test]
async fn geschlossene_stelle_wieder_oeffnen_nimmt_belegung_an() {
    let w = welt().await;
    let id = stelle(&w, "Turnhalle Ost", Some(150)).await;
    stelle_status(&w, id, Status::Geschlossen).await.unwrap();
    stelle_status(&w, id, Status::InBetrieb).await.unwrap();
    assert_eq!(
        stelle_laden(&w.pool, w.e, id).await.unwrap().status,
        Status::InBetrieb
    );
    belegung(&w, id, 12, "2026-09-23 12:00:00").await.unwrap();
    assert_eq!(aktuelle_belegung(&w, id).await, Some(12));
}

#[tokio::test]
async fn stelle_aendern_leerlauf_und_je_achse_ein_eintrag() {
    let w = welt().await;
    let mut eingabe = stelle_eingabe("Turnhalle Ost", Art::Notunterkunft, Some(150));
    eingabe.standort = Some("Ostring 5".into());
    let id = stelle_anlegen(&w, eingabe).await.unwrap().id;
    let n = etb(&w.pool, w.e).await.len();

    let g = stelle_aendern(
        &w,
        id,
        StelleAenderung {
            bezeichnung: Some("Turnhalle Ost".into()),
            art: Some(Art::Notunterkunft),
            abschnitt_id: Some(None),
            kapazitaet_personen: Some(Some(150)),
            status: Some(Status::Vorbereitet),
            standort: Some(Some("Ostring 5".into())),
            notiz: Some(None),
            ..Default::default()
        },
    )
    .await
    .unwrap();
    assert!(g.etb_ids.is_empty());
    assert_eq!(etb(&w.pool, w.e).await.len(), n);
    assert!(stelle_laden(&w.pool, w.e, id)
        .await
        .unwrap()
        .geaendert_at
        .is_none());

    let g = stelle_aendern(
        &w,
        id,
        StelleAenderung {
            kapazitaet_personen: Some(Some(200)),
            status: Some(Status::InBetrieb),
            ..Default::default()
        },
    )
    .await
    .unwrap();
    assert_eq!(g.etb_ids.len(), 2);
    let etb = etb(&w.pool, w.e).await;
    assert!(etb[n..].iter().all(|e| e.1 == "system"));
    assert!(
        etb[n].2.contains("Kapazität 200 (vorher 150)"),
        "{}",
        etb[n].2
    );
    assert!(etb[n + 1].2.contains("in Betrieb"), "{}", etb[n + 1].2);
    let s = stelle_laden(&w.pool, w.e, id).await.unwrap();
    assert_eq!(s.kapazitaet_personen, Some(200));
    assert_eq!(s.status, Status::InBetrieb);
}

// ── LFH-673: Koordinate einer Betreuungsstelle ─────────────────────────────────────────────

fn verortung(lat: Option<f64>, lon: Option<f64>) -> StelleAenderung {
    StelleAenderung {
        lat: Some(lat),
        lon: Some(lon),
        ..Default::default()
    }
}

#[tokio::test]
async fn stelle_verorten_speichert_ohne_etb_und_meldet_wirksam() {
    let w = welt().await;
    let id = stelle(&w, "NU Turnhalle Nord", Some(150)).await;
    let n = etb(&w.pool, w.e).await.len();

    let g = stelle_aendern(&w, id, verortung(Some(51.93), Some(8.87)))
        .await
        .unwrap();
    assert!(g.etb_ids.is_empty(), "Verortung schreibt kein ETB");
    assert!(g.still_geaendert, "Verortung muss live verteilt werden");
    assert_eq!(etb(&w.pool, w.e).await.len(), n);
    let s = stelle_laden(&w.pool, w.e, id).await.unwrap();
    assert_eq!((s.lat, s.lon), (Some(51.93), Some(8.87)));
    assert!(s.geaendert_at.is_some());
}

#[tokio::test]
async fn gleiche_koordinate_ist_leerlauf() {
    let w = welt().await;
    let id = stelle(&w, "NU Turnhalle Nord", None).await;
    stelle_aendern(&w, id, verortung(Some(51.93), Some(8.87)))
        .await
        .unwrap();
    let g = stelle_aendern(&w, id, verortung(Some(51.93), Some(8.87)))
        .await
        .unwrap();
    assert!(g.etb_ids.is_empty());
    assert!(
        !g.still_geaendert,
        "unveränderte Koordinate ist kein Ereignis"
    );
}

#[tokio::test]
async fn stammdaten_ohne_koordinate_sind_nicht_still() {
    let w = welt().await;
    let id = stelle(&w, "NU Turnhalle Nord", Some(150)).await;
    let g = stelle_aendern(
        &w,
        id,
        StelleAenderung {
            kapazitaet_personen: Some(Some(200)),
            ..Default::default()
        },
    )
    .await
    .unwrap();
    assert_eq!(g.etb_ids.len(), 1);
    assert!(!g.still_geaendert);
}

#[tokio::test]
async fn koordinate_mit_kapazitaet_nennt_nur_die_kapazitaet() {
    let w = welt().await;
    let id = stelle(&w, "NU Turnhalle Nord", Some(150)).await;
    let n = etb(&w.pool, w.e).await.len();
    let g = stelle_aendern(
        &w,
        id,
        StelleAenderung {
            kapazitaet_personen: Some(Some(200)),
            lat: Some(Some(51.93)),
            lon: Some(Some(8.87)),
            ..Default::default()
        },
    )
    .await
    .unwrap();
    assert_eq!(g.etb_ids.len(), 1);
    let etb = etb(&w.pool, w.e).await;
    let text = &etb[n].2;
    assert!(text.contains("Kapazität 200"), "{text}");
    assert!(
        !text.contains("51") && !text.contains("8,87") && !text.contains("8.87"),
        "{text}"
    );
}

#[tokio::test]
async fn halbes_paar_oder_bereich_ist_422_und_aendert_nichts() {
    let w = welt().await;
    let id = stelle(&w, "NU Turnhalle Nord", None).await;
    let nur_lat = StelleAenderung {
        lat: Some(Some(51.93)),
        ..Default::default()
    };
    assert_eq!(
        status(stelle_aendern(&w, id, nur_lat).await),
        StatusCode::UNPROCESSABLE_ENTITY
    );
    for (la, lo) in [(91.0, 8.0), (-90.5, 8.0), (51.0, 180.5), (51.0, -181.0)] {
        assert_eq!(
            status(stelle_aendern(&w, id, verortung(Some(la), Some(lo))).await),
            StatusCode::UNPROCESSABLE_ENTITY,
            "{la}/{lo}"
        );
    }
    let s = stelle_laden(&w.pool, w.e, id).await.unwrap();
    assert_eq!((s.lat, s.lon), (None, None));

    // Paar gegen den Bestand: nur lon auf null bei verorteter Stelle zerreißt das Paar.
    stelle_aendern(&w, id, verortung(Some(51.93), Some(8.87)))
        .await
        .unwrap();
    let nur_lon_weg = StelleAenderung {
        lon: Some(None),
        ..Default::default()
    };
    assert_eq!(
        status(stelle_aendern(&w, id, nur_lon_weg).await),
        StatusCode::UNPROCESSABLE_ENTITY
    );
    // Nur lat ändern, lon bleibt aus dem Bestand: gültiges Paar.
    let nur_lat_neu = StelleAenderung {
        lat: Some(Some(52.0)),
        ..Default::default()
    };
    stelle_aendern(&w, id, nur_lat_neu).await.unwrap();
    let s = stelle_laden(&w.pool, w.e, id).await.unwrap();
    assert_eq!((s.lat, s.lon), (Some(52.0), Some(8.87)));
}

#[tokio::test]
async fn verortung_entfernen() {
    let w = welt().await;
    let id = stelle(&w, "NU Turnhalle Nord", None).await;
    stelle_aendern(&w, id, verortung(Some(51.93), Some(8.87)))
        .await
        .unwrap();
    let g = stelle_aendern(&w, id, verortung(None, None)).await.unwrap();
    assert!(g.still_geaendert);
    let s = stelle_laden(&w.pool, w.e, id).await.unwrap();
    assert_eq!((s.lat, s.lon), (None, None));
    let v = serde_json::to_value(&s).unwrap();
    let o = v.as_object().unwrap();
    assert!(!o.contains_key("lat") && !o.contains_key("lon"), "{v}");
}

#[tokio::test]
async fn verortete_stelle_traegt_beide_felder_auf_dem_draht() {
    let w = welt().await;
    let id = stelle(&w, "NU Turnhalle Nord", None).await;
    let v = serde_json::to_value(stelle_laden(&w.pool, w.e, id).await.unwrap()).unwrap();
    assert!(!v.as_object().unwrap().contains_key("lat"), "{v}");
    stelle_aendern(&w, id, verortung(Some(51.93), Some(8.87)))
        .await
        .unwrap();
    let u = uebersicht(&w.pool, w.e).await.unwrap();
    let v = serde_json::to_value(&u.stellen[0]).unwrap();
    assert_eq!(v["lat"], serde_json::json!(51.93));
    assert_eq!(v["lon"], serde_json::json!(8.87));
}

#[tokio::test]
async fn verortung_laesst_fremde_aenderung_stehen() {
    let w = welt().await;
    let id = stelle(&w, "NU Turnhalle Nord", Some(150)).await;
    // A: Status und Kapazität.
    stelle_aendern(
        &w,
        id,
        StelleAenderung {
            kapazitaet_personen: Some(Some(200)),
            status: Some(Status::InBetrieb),
            ..Default::default()
        },
    )
    .await
    .unwrap();
    // B: nur die Koordinate.
    stelle_aendern(&w, id, verortung(Some(51.93), Some(8.87)))
        .await
        .unwrap();
    let s = stelle_laden(&w.pool, w.e, id).await.unwrap();
    assert_eq!(s.kapazitaet_personen, Some(200));
    assert_eq!(s.status, Status::InBetrieb);
    assert_eq!((s.lat, s.lon), (Some(51.93), Some(8.87)));
}

#[tokio::test]
async fn stornierte_stelle_verorten_ist_409() {
    let w = welt().await;
    let id = stelle(&w, "NU Turnhalle Nord", None).await;
    stelle_stornieren(&w, id).await.unwrap();
    assert_eq!(
        status(stelle_aendern(&w, id, verortung(Some(51.93), Some(8.87))).await),
        StatusCode::CONFLICT
    );
}

// ── Requirement: Belegung melden ───────────────────────────────────────────────────────────

#[tokio::test]
async fn belegung_melden_nennt_zahl_vorwert_und_kapazitaet() {
    let w = welt().await;
    let id = stelle(&w, "Turnhalle Ost", Some(150)).await;
    belegung(&w, id, 60, "2026-09-23 12:00:00").await.unwrap();
    let m = belegung(&w, id, 89, "2026-09-23 14:00:00").await.unwrap();
    assert_eq!(m.objekt_id, id);
    let b = stelle_laden(&w.pool, w.e, id)
        .await
        .unwrap()
        .belegung
        .unwrap();
    assert_eq!((b.id, b.belegt), (m.meldung_id, 89));
    let etb = etb(&w.pool, w.e).await;
    let e = etb.last().unwrap();
    assert_eq!(e.0, m.etb_id);
    assert_eq!(e.1, "meldung");
    assert_eq!(e.4, "2026-09-23 14:00:00");
    for teil in ["89", "150", "vorher 60", "Turnhalle Ost"] {
        assert!(e.2.contains(teil), "{teil:?} fehlt: {}", e.2);
    }
}

#[tokio::test]
async fn ueberbelegung_wird_angenommen() {
    let w = welt().await;
    let id = stelle(&w, "Turnhalle Ost", Some(150)).await;
    belegung(&w, id, 170, "2026-09-23 12:00:00").await.unwrap();
    assert_eq!(aktuelle_belegung(&w, id).await, Some(170));
}

#[tokio::test]
async fn geschlossene_stelle_belegen_ist_422_und_speichert_nichts() {
    let w = welt().await;
    let id = stelle(&w, "Turnhalle Ost", Some(150)).await;
    stelle_status(&w, id, Status::Geschlossen).await.unwrap();
    let n = etb(&w.pool, w.e).await.len();
    assert_eq!(
        status(belegung(&w, id, 10, "2026-09-23 12:00:00").await),
        StatusCode::UNPROCESSABLE_ENTITY
    );
    assert_eq!(
        zaehle(&w.pool, "SELECT COUNT(*) FROM betreuungsstelle_belegung").await,
        0
    );
    assert_eq!(etb(&w.pool, w.e).await.len(), n);
}

#[tokio::test]
async fn negative_belegung_ist_400() {
    let w = welt().await;
    let id = stelle(&w, "Turnhalle Ost", Some(150)).await;
    assert_eq!(
        status(belegung(&w, id, -3, "2026-09-23 12:00:00").await),
        StatusCode::BAD_REQUEST
    );
}

#[tokio::test]
async fn belegung_zuruecknehmen_wie_standmeldung() {
    let w = welt().await;
    let id = stelle(&w, "Turnhalle Ost", Some(150)).await;
    belegung(&w, id, 60, "2026-09-23 12:00:00").await.unwrap();
    let m = belegung(&w, id, 89, "2026-09-23 14:00:00").await.unwrap();
    let r = belegung_zurueck(&w, m.meldung_id).await.unwrap();
    assert_eq!(r.objekt_id, id);
    assert_eq!(aktuelle_belegung(&w, id).await, Some(60));
    let etb = etb(&w.pool, w.e).await;
    let e = etb.last().unwrap();
    assert_eq!(e.1, "berichtigung");
    assert_eq!(e.3, Some(m.etb_id));
    assert!(e.2.contains("wieder 60"), "{}", e.2);
    assert_eq!(
        status(belegung_zurueck(&w, m.meldung_id).await),
        StatusCode::UNPROCESSABLE_ENTITY
    );
}

/// Belegung wie Stand: eine nachgetragene ältere Meldung lässt die Belegung stehen und sagt
/// das; ihre Rücknahme ebenso. Gleicher Zeitpunkt ist keine Nachtragung.
#[tokio::test]
async fn belegung_nachtrag_und_ruecknahme_des_nachtrags() {
    let w = welt().await;
    let id = stelle(&w, "Turnhalle Ost", Some(150)).await;
    belegung(&w, id, 60, "2026-09-23 12:00:00").await.unwrap();
    belegung(&w, id, 89, "2026-09-23 14:00:00").await.unwrap();
    let nach = belegung(&w, id, 30, "2026-09-23 13:00:00").await.unwrap();
    assert_eq!(aktuelle_belegung(&w, id).await, Some(89));
    let r = belegung_zurueck(&w, nach.meldung_id).await.unwrap();
    assert_eq!(aktuelle_belegung(&w, id).await, Some(89));
    let gleich = belegung(&w, id, 95, "2026-09-23 14:00:00").await.unwrap();
    assert_eq!(aktuelle_belegung(&w, id).await, Some(95));

    let etb = etb(&w.pool, w.e).await;
    let text = |etb_id: i64| etb.iter().find(|e| e.0 == etb_id).unwrap().2.clone();
    assert_eq!(
        text(nach.etb_id),
        "Betreuungsstelle ‚Turnhalle Ost‘: 30 untergebracht, nachgetragen, aktuelle Belegung \
         bleibt 89, Kapazität 150."
    );
    assert_eq!(
        text(r.etb_id),
        "Meldung zurückgenommen, Belegung Betreuungsstelle ‚Turnhalle Ost‘ bleibt 89."
    );
    assert_eq!(
        text(gleich.etb_id),
        "Betreuungsstelle ‚Turnhalle Ost‘: 95 untergebracht, vorher 89, Kapazität 150."
    );
}

#[tokio::test]
async fn belegungsmeldung_ist_atomar() {
    let w = welt().await;
    let id = stelle(&w, "Turnhalle Ost", Some(150)).await;
    let n = etb(&w.pool, w.e).await.len();
    sqlx::query(
        "CREATE TRIGGER test_belegung_scheitert BEFORE INSERT ON betreuungsstelle_belegung \
         BEGIN SELECT RAISE(ABORT, 'Testfehler'); END",
    )
    .execute(&w.pool)
    .await
    .unwrap();
    belegung(&w, id, 10, "2026-09-23 12:00:00")
        .await
        .unwrap_err();
    assert_eq!(etb(&w.pool, w.e).await.len(), n);
    assert_eq!(aktuelle_belegung(&w, id).await, None);
}

// ── Requirement: Kopfzahl in Betreuung zu einem Zeitpunkt ──────────────────────────────────

#[tokio::test]
async fn kopfzahl_zum_schichtbeginn() {
    let w = welt().await;
    let turnhalle = stelle(&w, "Turnhalle Ost", Some(150)).await;
    let stadion = stelle(&w, "Weserstadion", Some(500)).await;
    let leer = stelle(&w, "Anlaufstelle Markt", None).await;
    let storniert = stelle(&w, "Fehlanlage", None).await;
    belegung(&w, turnhalle, 60, "2026-09-23 12:00:00")
        .await
        .unwrap();
    belegung(&w, turnhalle, 89, "2026-09-23 14:00:00")
        .await
        .unwrap();
    belegung(&w, stadion, 84, "2026-09-23 13:00:00")
        .await
        .unwrap();
    // Eine zurückgenommene Meldung vor dem Stichtag zählt nicht.
    let falsch = belegung(&w, stadion, 999, "2026-09-23 13:15:00")
        .await
        .unwrap();
    belegung_zurueck(&w, falsch.meldung_id).await.unwrap();
    // Die Meldung der leeren Stelle liegt NACH dem Stichtag.
    belegung(&w, leer, 30, "2026-09-23 15:00:00").await.unwrap();
    belegung(&w, storniert, 7, "2026-09-23 12:00:00")
        .await
        .unwrap();
    stelle_stornieren(&w, storniert).await.unwrap();

    let k = kopfzahl(&w.pool, w.e, "2026-09-23 13:30:00").await.unwrap();
    assert_eq!(k.zeitpunkt_at, "2026-09-23 13:30:00");
    assert_eq!(k.summe, 144);
    assert_eq!(k.stellen_ohne_meldung, 1);
    let je: Vec<(&str, Option<i64>, Option<&str>)> = k
        .stellen
        .iter()
        .map(|s| (s.bezeichnung.as_str(), s.belegt, s.zeitpunkt_at.as_deref()))
        .collect();
    assert_eq!(
        je,
        [
            ("Turnhalle Ost", Some(60), Some("2026-09-23 12:00:00")),
            ("Weserstadion", Some(84), Some("2026-09-23 13:00:00")),
            ("Anlaufstelle Markt", None, None),
        ]
    );
    let v = serde_json::to_value(&k).unwrap();
    let ohne = v["stellen"][2].as_object().unwrap();
    assert!(!ohne.contains_key("belegt") && !ohne.contains_key("zeitpunkt_at"));

    // Genau auf dem Meldezeitpunkt zählt die Meldung (≤ t).
    let k = kopfzahl(&w.pool, w.e, "2026-09-23 14:00:00").await.unwrap();
    assert_eq!(k.summe, 89 + 84);
}

#[tokio::test]
async fn kopfzahl_ohne_meldungen_summiert_nichts() {
    let w = welt().await;
    stelle(&w, "Turnhalle Ost", Some(150)).await;
    let k = kopfzahl(&w.pool, w.e, "2026-09-23 13:30:00").await.unwrap();
    assert_eq!((k.summe, k.stellen_ohne_meldung), (0, 1));
    assert_eq!(k.stellen[0].belegt, None);
}

#[tokio::test]
async fn kopfzahl_mit_unlesbarem_zeitpunkt_ist_400() {
    let w = welt().await;
    for t in [
        "morgen",
        "2026-09-23",
        "2026-09-23T13:30:00Z",
        "2026-9-23 13:30:00",
    ] {
        assert_eq!(
            status(kopfzahl(&w.pool, w.e, t).await),
            StatusCode::BAD_REQUEST,
            "{t}"
        );
    }
}

// ── D5: kein ETB-Text trägt Sammelstelle, Standort oder Notiz ──────────────────────────────

#[tokio::test]
async fn etb_nennt_keine_freitexte() {
    let w = welt().await;
    let geheim = [
        "Kirchplatz Süd",
        "Ostring 5",
        "Schlüssel beim Hausmeister",
        "Rollstuhl Frau M.",
    ];
    let mut be = bezirk_eingabe("Uferstraße", 640, Erhebung::Geschaetzt);
    be.sammelstelle = Some(geheim[0].into());
    be.notiz = Some(geheim[3].into());
    let bid = bezirk_anlegen(&w, be).await.unwrap().id;
    bezirk_aendern(
        &w,
        bid,
        BezirkAenderung {
            sammelstelle: Some(Some(geheim[1].into())),
            notiz: Some(Some(geheim[2].into())),
            plan_personen: Some(700),
            raeumung: Some(Raeumungszustand::Laeuft),
            ..Default::default()
        },
    )
    .await
    .unwrap();
    let m = stand(&w, bid, 12, Erhebung::Gezaehlt, "2026-09-23 12:00:00")
        .await
        .unwrap();
    stand_zurueck(&w, m.meldung_id).await.unwrap();

    let mut se = stelle_eingabe("Turnhalle Ost", Art::Notunterkunft, Some(150));
    se.standort = Some(geheim[1].into());
    se.notiz = Some(geheim[2].into());
    let sid = stelle_anlegen(&w, se).await.unwrap().id;
    stelle_aendern(
        &w,
        sid,
        StelleAenderung {
            standort: Some(Some(geheim[0].into())),
            notiz: Some(Some(geheim[3].into())),
            status: Some(Status::InBetrieb),
            ..Default::default()
        },
    )
    .await
    .unwrap();
    let m = belegung(&w, sid, 9, "2026-09-23 12:00:00").await.unwrap();
    belegung_zurueck(&w, m.meldung_id).await.unwrap();
    stelle_stornieren(&w, sid).await.unwrap();
    bezirk_stornieren(&w, bid).await.unwrap();

    let etb = etb(&w.pool, w.e).await;
    assert!(etb.len() >= 12, "alle Schreibpfade liefen: {}", etb.len());
    for e in &etb {
        for g in geheim {
            assert!(!e.2.contains(g), "{g:?} im ETB: {}", e.2);
        }
    }
}

/// Das Löschen eines Einsatzes räumt alle vier Tabellen trotz Zeigerzyklus
/// (`stand_id` ↔ `bezirk_id`) und NOT-NULL-Bezug auf `etb_eintrag`.
#[tokio::test]
async fn einsatz_loeschen_kaskadiert_sauber() {
    let w = welt().await;
    let bid = bezirk(&w, "Uferstraße", 640).await;
    let m = stand(&w, bid, 12, Erhebung::Gezaehlt, "2026-09-23 12:00:00")
        .await
        .unwrap();
    stand_zurueck(&w, m.meldung_id).await.unwrap();
    stand(&w, bid, 20, Erhebung::Gezaehlt, "2026-09-23 13:00:00")
        .await
        .unwrap();
    let sid = stelle(&w, "Turnhalle Ost", Some(150)).await;
    belegung(&w, sid, 9, "2026-09-23 12:00:00").await.unwrap();

    sqlx::query("DELETE FROM einsatz WHERE id = ?")
        .bind(w.e)
        .execute(&w.pool)
        .await
        .unwrap();
    for sql in [
        "SELECT COUNT(*) FROM evakuierungsbezirk",
        "SELECT COUNT(*) FROM evakuierung_stand",
        "SELECT COUNT(*) FROM betreuungsstelle",
        "SELECT COUNT(*) FROM betreuungsstelle_belegung",
    ] {
        assert_eq!(zaehle(&w.pool, sql).await, 0, "{sql}");
    }
}

/// D4 (Controller-Entscheid): An einer geschlossenen Stelle ist eine Rücknahme 422 — sonst
/// stünde die Stelle nach Rücknahme der Leermeldung „geschlossen und belegt“ da.
#[tokio::test]
async fn ruecknahme_an_geschlossener_stelle_ist_422_und_aendert_nichts() {
    let w = welt().await;
    let id = stelle(&w, "Turnhalle Ost", Some(150)).await;
    belegung(&w, id, 40, "2026-09-23 12:00:00").await.unwrap();
    let leer = belegung(&w, id, 0, "2026-09-23 13:00:00").await.unwrap();
    stelle_status(&w, id, Status::Geschlossen).await.unwrap();
    let n = etb(&w.pool, w.e).await.len();

    assert_eq!(
        status(belegung_zurueck(&w, leer.meldung_id).await),
        StatusCode::UNPROCESSABLE_ENTITY
    );
    assert_eq!(etb(&w.pool, w.e).await.len(), n, "kein ETB-Eintrag");
    let zurueck: Option<String> =
        sqlx::query_scalar("SELECT zurueckgenommen_at FROM betreuungsstelle_belegung WHERE id = ?")
            .bind(leer.meldung_id)
            .fetch_one(&w.pool)
            .await
            .unwrap();
    assert_eq!(zurueck, None);
    assert_eq!(aktuelle_belegung(&w, id).await, Some(0));
}

/// Gegenstück: nach dem Wiederöffnen geht dieselbe Rücknahme durch.
#[tokio::test]
async fn ruecknahme_nach_wiederoeffnen_gelingt() {
    let w = welt().await;
    let id = stelle(&w, "Turnhalle Ost", Some(150)).await;
    belegung(&w, id, 40, "2026-09-23 12:00:00").await.unwrap();
    let leer = belegung(&w, id, 0, "2026-09-23 13:00:00").await.unwrap();
    stelle_status(&w, id, Status::Geschlossen).await.unwrap();
    stelle_status(&w, id, Status::InBetrieb).await.unwrap();

    belegung_zurueck(&w, leer.meldung_id).await.unwrap();
    assert_eq!(aktuelle_belegung(&w, id).await, Some(40));
}

// ── LFH-673: Bezirksflächen ─────────────────────────────────────────────────────────────────

/// Legt eine Zone vom Typ `evakuierungsbezirk` an, optional einem Bezirk zugeordnet.
async fn bezirksflaeche(w: &Welt, bezirk: Option<i64>) -> i64 {
    sqlx::query_scalar(
        "INSERT INTO lage_zone (einsatz_id, typ, geometrie_typ, geometrie, erstellt_von, \
            evakuierungsbezirk_id) \
         VALUES (?, 'evakuierungsbezirk', 'Polygon', \
            '{\"type\":\"Polygon\",\"coordinates\":[[[8,50],[8.1,50],[8.1,50.1],[8,50]]]}', ?, ?) \
         RETURNING id",
    )
    .bind(w.e)
    .bind(w.b)
    .bind(bezirk)
    .fetch_one(&w.pool)
    .await
    .unwrap()
}

#[tokio::test]
async fn flaechen_zaehlt_die_zugeordneten_zonen() {
    let w = welt().await;
    let ufer = bezirk(&w, "Uferstraße 12–40", 640).await;
    let hafen = bezirk(&w, "Hafenviertel", 120).await;
    assert_eq!(bezirk_laden(&w.pool, w.e, ufer).await.unwrap().flaechen, 0);
    bezirksflaeche(&w, Some(ufer)).await;
    bezirksflaeche(&w, Some(ufer)).await;
    bezirksflaeche(&w, None).await;
    let u = uebersicht(&w.pool, w.e).await.unwrap();
    let flaechen = |id: i64| u.bezirke.iter().find(|b| b.id == id).unwrap().flaechen;
    assert_eq!(flaechen(ufer), 2);
    assert_eq!(flaechen(hafen), 0);
    let v = serde_json::to_value(bezirk_laden(&w.pool, w.e, hafen).await.unwrap()).unwrap();
    assert_eq!(
        v["flaechen"], 0,
        "0 steht auf dem Draht, nicht weggelassen: {v}"
    );
}

#[tokio::test]
async fn storno_loest_die_flaechen_und_laesst_sie_stehen() {
    let w = welt().await;
    let ufer = bezirk(&w, "Uferstraße 12–40", 640).await;
    let a = bezirksflaeche(&w, Some(ufer)).await;
    let b = bezirksflaeche(&w, Some(ufer)).await;
    let fremd = bezirksflaeche(&w, None).await;

    let (_, geloest) = bezirk_stornieren_mit_zonen(&w, ufer).await.unwrap();
    let mut geloest = geloest;
    geloest.sort();
    assert_eq!(geloest, vec![a, b]);

    let zonen: Vec<(i64, String, Option<i64>)> = sqlx::query_as(
        "SELECT id, typ, evakuierungsbezirk_id FROM lage_zone WHERE einsatz_id = ? ORDER BY id",
    )
    .bind(w.e)
    .fetch_all(&w.pool)
    .await
    .unwrap();
    assert_eq!(
        zonen,
        vec![
            (a, "evakuierungsbezirk".into(), None),
            (b, "evakuierungsbezirk".into(), None),
            (fremd, "evakuierungsbezirk".into(), None),
        ],
        "die Flächen bleiben als nicht zugeordnete Bezirksflächen"
    );
    assert_eq!(bezirk_laden(&w.pool, w.e, ufer).await.unwrap().flaechen, 0);
}
