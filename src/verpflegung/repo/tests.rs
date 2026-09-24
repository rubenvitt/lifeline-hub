//! Repo-Tests des Fachmoduls Verpflegung (LFH-634) — je Spec-Szenario mindestens ein Test.
//! Die Schreibpfade laufen wie in der Route in `write_retry!`.

use super::*;
use crate::einsatz::nummer::ZEITZONE_VORGABE;
use crate::error::AppError;
use crate::verpflegung::SonderkostEingabe;
use crate::write_retry;
use axum::http::StatusCode;

const STARTWERT: i64 = 1;
const TZ: Tz = ZEITZONE_VORGABE;

struct Welt {
    pool: SqlitePool,
    b: i64,
    e: i64,
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
    Welt { pool, b, e, e2 }
}

async fn einsatz(pool: &SqlitePool, name: &str) -> i64 {
    sqlx::query_scalar("INSERT INTO einsatz (org_id, bezeichnung) VALUES (1, ?) RETURNING id")
        .bind(name)
        .fetch_one(pool)
        .await
        .unwrap()
}

/// ETB des Einsatzes: `(typ, inhalt)`.
async fn etb(pool: &SqlitePool, e: i64) -> Vec<(String, String)> {
    sqlx::query_as("SELECT typ, inhalt FROM etb_eintrag WHERE einsatz_id = ? ORDER BY id")
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

fn sk(vegetarisch: i64, vegan: i64) -> SonderkostEingabe {
    SonderkostEingabe {
        vegetarisch: Some(vegetarisch),
        vegan: Some(vegan),
        ..SonderkostEingabe::default()
    }
}

/// „Mittag“ am 24.09., 10:00–11:30 UTC (12:00–13:30 in Berlin), 180 Kräfte, 70 Betreute.
fn mittag() -> ZeitfensterEingabe {
    ZeitfensterEingabe {
        bezeichnung: "Mittag".into(),
        von_at: "2026-09-24 10:00:00".into(),
        bis_at: "2026-09-24 11:30:00".into(),
        bedarf_kraefte: 180,
        bedarf_betreute: 70,
        bedarf_weitere: 0,
        sonderkost: SonderkostEingabe::default(),
    }
}

fn ausgabe_eingabe(menge: i64) -> AusgabeEingabe {
    AusgabeEingabe {
        zeitpunkt_at: "2026-09-24 09:40:00".into(),
        menge,
        ort: Some("Verpflegungsstelle Deich".into()),
        bemerkung: None,
        sonderkost: SonderkostEingabe::default(),
        nachforderung_id: None,
    }
}

// ── Wrapper: Schreibpfade in write_retry! wie in der Route ──────────────────────────────────

async fn anlegen_in(
    w: &Welt,
    e: i64,
    eingabe: ZeitfensterEingabe,
) -> Result<Geschrieben, AppError> {
    write_retry!(&w.pool, |conn| {
        zeitfenster_anlegen_tx(conn, e, w.b, STARTWERT, TZ, &eingabe).await
    })
}

async fn anlegen(w: &Welt, eingabe: ZeitfensterEingabe) -> Result<Geschrieben, AppError> {
    anlegen_in(w, w.e, eingabe).await
}

async fn aendern_in(
    w: &Welt,
    e: i64,
    id: i64,
    a: ZeitfensterAenderung,
) -> Result<Geschrieben, AppError> {
    write_retry!(&w.pool, |conn| {
        zeitfenster_aendern_tx(conn, e, id, w.b, STARTWERT, TZ, &a).await
    })
}

async fn aendern(w: &Welt, id: i64, a: ZeitfensterAenderung) -> Result<Geschrieben, AppError> {
    aendern_in(w, w.e, id, a).await
}

async fn loeschen_in(w: &Welt, e: i64, id: i64) -> Result<Geschrieben, AppError> {
    write_retry!(&w.pool, |conn| {
        zeitfenster_loeschen_tx(conn, e, id, w.b, STARTWERT, TZ).await
    })
}

async fn ausgabe_in(
    w: &Welt,
    e: i64,
    zid: i64,
    eingabe: AusgabeEingabe,
) -> Result<AusgabeGeschrieben, AppError> {
    write_retry!(&w.pool, |conn| {
        ausgabe_erfassen_tx(conn, e, zid, w.b, &eingabe).await
    })
}

async fn ausgabe(
    w: &Welt,
    zid: i64,
    eingabe: AusgabeEingabe,
) -> Result<AusgabeGeschrieben, AppError> {
    ausgabe_in(w, w.e, zid, eingabe).await
}

async fn zuruecknehmen_in(w: &Welt, e: i64, aid: i64) -> Result<AusgabeGeschrieben, AppError> {
    write_retry!(&w.pool, |conn| {
        ausgabe_zuruecknehmen_tx(conn, e, aid, w.b).await
    })
}

async fn laden(w: &Welt, id: i64) -> ZeitfensterAnzeige {
    zeitfenster_laden(&w.pool, w.e, id).await.unwrap()
}

// ── Verpflegungszeitfenster ─────────────────────────────────────────────────────────────────

/// Spec „Zeitfenster anlegen“ + „Zeitraum in Ortszeit“: Gesamtbedarf 250, ETB-Zeitraum in
/// Berliner Zeit.
#[tokio::test]
async fn zeitfenster_anlegen_mit_gesamtbedarf_und_etb_in_ortszeit() {
    let w = welt().await;
    let g = anlegen(&w, mittag()).await.unwrap();
    assert_eq!(g.etb_ids.len(), 1);
    let zf = laden(&w, g.id).await;
    assert_eq!(zf.bezeichnung, "Mittag");
    assert_eq!(zf.bedarf.gesamt, 250);
    assert_eq!(
        (zf.bedarf.kraefte, zf.bedarf.betreute, zf.bedarf.weitere),
        (180, 70, 0)
    );
    assert_eq!(zf.fehlmenge.gesamt, 250);
    assert_eq!(zf.ausgegeben.gesamt, 0);
    assert_eq!(zf.von_at, "2026-09-24 10:00:00", "gespeichert in UTC");
    assert_eq!(
        etb(&w.pool, w.e).await,
        vec![(
            "system".to_string(),
            "Verpflegung ‚Mittag‘ 24.09. 12:00–13:30 angelegt: Bedarf 250 EP (180 Kräfte, \
             70 Betreute)."
                .to_string()
        )]
    );
}

/// Spec: Zeitfenster dürfen sich überschneiden.
#[tokio::test]
async fn ueberschneidende_zeitfenster_sind_erlaubt() {
    let w = welt().await;
    anlegen(&w, mittag()).await.unwrap();
    let mut zweites = mittag();
    zweites.bezeichnung = "Mittag Betreute".into();
    zweites.von_at = "2026-09-24 10:30:00".into();
    anlegen(&w, zweites).await.unwrap();
    let liste = liste(&w.pool, w.e).await.unwrap();
    assert_eq!(liste.zeitfenster.len(), 2);
    assert_eq!(
        liste.zeitfenster[0].bezeichnung, "Mittag",
        "nach Beginn geordnet"
    );
}

/// Spec „Leere Bezeichnung oder negativer Bedarf“: 400, nichts angelegt, kein ETB.
#[tokio::test]
async fn leere_bezeichnung_negativer_bedarf_unlesbare_zeit_sind_400() {
    let w = welt().await;
    let mut faelle: Vec<ZeitfensterEingabe> = Vec::new();
    let mut f = mittag();
    f.bezeichnung = "   ".into();
    faelle.push(f);
    let mut f = mittag();
    f.von_at = "".into();
    faelle.push(f);
    let mut f = mittag();
    f.bis_at = "morgen".into();
    faelle.push(f);
    let mut f = mittag();
    f.bedarf_betreute = -1;
    faelle.push(f);
    let mut f = mittag();
    f.bedarf_weitere = -2;
    faelle.push(f);
    let mut f = mittag();
    f.sonderkost.saeugling_kleinkind = Some(-1);
    faelle.push(f);
    // Negativ UND Sonderkost über Bedarf: das Feld scheitert zuerst (400, nicht 422).
    let mut f = mittag();
    f.bedarf_kraefte = -500;
    f.sonderkost = sk(10, 0);
    faelle.push(f);
    for f in faelle {
        assert_eq!(
            status(anlegen(&w, f.clone()).await),
            StatusCode::BAD_REQUEST,
            "{f:?}"
        );
    }
    assert_eq!(
        zaehle(&w.pool, "SELECT COUNT(*) FROM verpflegung_zeitfenster").await,
        0
    );
    assert!(etb(&w.pool, w.e).await.is_empty());
}

/// Spec „Ende nicht nach Beginn“ — beim Anlegen.
#[tokio::test]
async fn ende_nicht_nach_beginn_ist_422_beim_anlegen() {
    let w = welt().await;
    for bis in ["2026-09-24 10:00:00", "2026-09-24 09:59:59"] {
        let mut f = mittag();
        f.bis_at = bis.into();
        assert_eq!(
            status(anlegen(&w, f).await),
            StatusCode::UNPROCESSABLE_ENTITY,
            "{bis}"
        );
    }
    assert_eq!(
        zaehle(&w.pool, "SELECT COUNT(*) FROM verpflegung_zeitfenster").await,
        0
    );
    assert!(etb(&w.pool, w.e).await.is_empty());
}

/// Spec „Ende nicht nach Beginn“ — beim Ändern, auch wenn nur EIN Zeitpunkt übergeben wird
/// (Effektivzustand). Nichts ändert sich.
#[tokio::test]
async fn ende_nicht_nach_beginn_ist_422_beim_aendern() {
    let w = welt().await;
    let id = anlegen(&w, mittag()).await.unwrap().id;
    let vorher = laden(&w, id).await;
    for a in [
        ZeitfensterAenderung {
            von_at: Some("2026-09-24 11:30:00".into()),
            ..Default::default()
        },
        ZeitfensterAenderung {
            bis_at: Some("2026-09-24 09:00:00".into()),
            ..Default::default()
        },
    ] {
        assert_eq!(
            status(aendern(&w, id, a).await),
            StatusCode::UNPROCESSABLE_ENTITY
        );
    }
    assert_eq!(laden(&w, id).await, vorher);
    assert_eq!(etb(&w.pool, w.e).await.len(), 1, "nur der Anlage-Eintrag");
}

// ── Sonderkost als Teilmenge ────────────────────────────────────────────────────────────────

/// Spec „Sonderkost im Bedarf“: 12 vegetarisch, 3 vegan, Rest 235 Normalkost.
#[tokio::test]
async fn sonderkost_im_bedarf_ist_teilmenge() {
    let w = welt().await;
    let mut f = mittag();
    f.sonderkost = sk(12, 3);
    let id = anlegen(&w, f).await.unwrap().id;
    let zf = laden(&w, id).await;
    assert_eq!(zf.bedarf.sonderkost.vegetarisch, 12);
    assert_eq!(zf.bedarf.sonderkost.vegan, 3);
    assert_eq!(zf.bedarf.sonderkost.ohne_schwein, 0);
    assert_eq!(
        zf.bedarf.gesamt - zf.bedarf.sonderkost.summe(),
        235,
        "Normalkost"
    );
    assert_eq!(zf.fehlmenge.sonderkost, zf.bedarf.sonderkost);
    assert!(etb(&w.pool, w.e).await[0].1.contains("davon 15 Sonderkost"));
}

/// Spec „Sonderkost übersteigt die Menge“ — Bedarf beim Anlegen.
#[tokio::test]
async fn sonderkost_ueber_gesamtbedarf_ist_422() {
    let w = welt().await;
    let mut f = mittag();
    f.sonderkost = sk(200, 51);
    assert_eq!(
        status(anlegen(&w, f).await),
        StatusCode::UNPROCESSABLE_ENTITY
    );
    let mut f = mittag();
    f.sonderkost = sk(200, 50);
    assert!(
        anlegen(&w, f).await.is_ok(),
        "genau der Gesamtbedarf ist erlaubt"
    );
}

/// Spec „Sonderkost übersteigt die Menge … auch nach einer Änderung des Bedarfs“: nur der
/// Bedarf wird gesenkt, die Sonderkost steht im Bestand — geprüft wird der Effektivzustand.
#[tokio::test]
async fn sonderkost_ueber_bedarf_nach_aenderung_ist_422_und_aendert_nichts() {
    let w = welt().await;
    let mut f = mittag();
    f.sonderkost = sk(12, 3);
    let id = anlegen(&w, f).await.unwrap().id;
    let vorher = laden(&w, id).await;
    let a = ZeitfensterAenderung {
        bedarf_kraefte: Some(0),
        bedarf_betreute: Some(10),
        ..Default::default()
    };
    assert_eq!(
        status(aendern(&w, id, a).await),
        StatusCode::UNPROCESSABLE_ENTITY
    );
    // Nur die Sonderkost erhöhen, eine Kostform: ebenfalls gegen den Bestand geprüft.
    let a = ZeitfensterAenderung {
        sonderkost: SonderkostEingabe {
            ohne_schwein: Some(236),
            ..Default::default()
        },
        ..Default::default()
    };
    assert_eq!(
        status(aendern(&w, id, a).await),
        StatusCode::UNPROCESSABLE_ENTITY
    );
    assert_eq!(laden(&w, id).await, vorher);
    assert_eq!(etb(&w.pool, w.e).await.len(), 1);
}

/// Spec „Sonderkost übersteigt die Menge“ — an der Ausgabe.
#[tokio::test]
async fn sonderkost_ueber_ausgabemenge_ist_422() {
    let w = welt().await;
    let id = anlegen(&w, mittag()).await.unwrap().id;
    let mut a = ausgabe_eingabe(10);
    a.sonderkost = sk(8, 3);
    assert_eq!(
        status(ausgabe(&w, id, a).await),
        StatusCode::UNPROCESSABLE_ENTITY
    );
    assert_eq!(
        zaehle(&w.pool, "SELECT COUNT(*) FROM verpflegung_ausgabe").await,
        0
    );
}

/// Spec „Negative Anzahl einer Kostform“ — an Ausgabe und Änderung.
#[tokio::test]
async fn negative_kostform_ist_400_an_ausgabe_und_aenderung() {
    let w = welt().await;
    let id = anlegen(&w, mittag()).await.unwrap().id;
    let mut a = ausgabe_eingabe(10);
    a.sonderkost.diaet_allergenarm = Some(-1);
    assert_eq!(status(ausgabe(&w, id, a).await), StatusCode::BAD_REQUEST);
    let a = ZeitfensterAenderung {
        sonderkost: SonderkostEingabe {
            vegan: Some(-3),
            ..Default::default()
        },
        ..Default::default()
    };
    assert_eq!(status(aendern(&w, id, a).await), StatusCode::BAD_REQUEST);
}

/// Task 1.1: beide Teilmengen-CHECKs der DB greifen, auch ohne Precheck — und kommen über
/// LFH-245 als 422 heraus.
#[tokio::test]
async fn db_checks_der_teilmenge_greifen() {
    let w = welt().await;
    let r = sqlx::query(
        "INSERT INTO verpflegung_zeitfenster (einsatz_id, bezeichnung, von_at, bis_at, \
            bedarf_kraefte, bedarf_betreute, sk_vegan, angelegt_von_id) \
         VALUES (?, 'X', '2026-09-24 10:00:00', '2026-09-24 11:00:00', 2, 1, 4, ?)",
    )
    .bind(w.e)
    .bind(w.b)
    .execute(&w.pool)
    .await;
    assert_eq!(
        AppError::from(r.unwrap_err()).status(),
        StatusCode::UNPROCESSABLE_ENTITY,
        "Zeitfenster: Σ Sonderkost > Gesamtbedarf"
    );
    let id = anlegen(&w, mittag()).await.unwrap().id;
    let r = sqlx::query(
        "INSERT INTO verpflegung_ausgabe (einsatz_id, zeitfenster_id, zeitpunkt_at, menge, \
            sk_vegetarisch, sk_vegan, erfasst_von_id) \
         VALUES (?, ?, '2026-09-24 10:00:00', 5, 3, 3, ?)",
    )
    .bind(w.e)
    .bind(id)
    .bind(w.b)
    .execute(&w.pool)
    .await;
    assert_eq!(
        AppError::from(r.unwrap_err()).status(),
        StatusCode::UNPROCESSABLE_ENTITY,
        "Ausgabe: Σ Sonderkost > Menge"
    );
    let r = sqlx::query(
        "INSERT INTO verpflegung_ausgabe (einsatz_id, zeitfenster_id, zeitpunkt_at, menge, \
            erfasst_von_id) VALUES (?, ?, '2026-09-24 10:00:00', 0, ?)",
    )
    .bind(w.e)
    .bind(id)
    .bind(w.b)
    .execute(&w.pool)
    .await;
    assert!(r.is_err(), "Menge 0 verletzt den CHECK");
}

// ── Zeitfenster ändern und löschen ──────────────────────────────────────────────────────────

/// Spec „Bedarf erhöhen“ + „Bedarf geändert“ (ETB): Betreute 70 → 90, Gesamtbedarf 270,
/// Fehlmenge steigt um 20; der ETB nennt 270 und den Vorwert 250.
#[tokio::test]
async fn bedarf_erhoehen_hebt_gesamt_und_fehlmenge_und_nennt_vorwert() {
    let w = welt().await;
    let id = anlegen(&w, mittag()).await.unwrap().id;
    ausgabe(&w, id, ausgabe_eingabe(230)).await.unwrap();
    assert_eq!(laden(&w, id).await.fehlmenge.gesamt, 20);
    let g = aendern(
        &w,
        id,
        ZeitfensterAenderung {
            bedarf_betreute: Some(90),
            ..Default::default()
        },
    )
    .await
    .unwrap();
    assert_eq!(g.etb_ids.len(), 1);
    let zf = laden(&w, id).await;
    assert_eq!(zf.bedarf.gesamt, 270);
    assert_eq!(zf.fehlmenge.gesamt, 40, "Fehlmenge steigt um 20");
    assert!(zf.geaendert_at.is_some());
    let eintraege = etb(&w.pool, w.e).await;
    assert_eq!(
        eintraege.len(),
        2,
        "Anlegen + Ändern, keine Zeile für die Ausgabe"
    );
    assert_eq!(
        eintraege[1],
        (
            "system".to_string(),
            "Verpflegung ‚Mittag‘ 24.09. 12:00–13:30 geändert: Bedarf 270 EP (vorher 250)."
                .to_string()
        )
    );
}

/// Ein Ändern ohne neuen Wert schreibt weder UPDATE noch ETB (Leerlauf-Riegel).
#[tokio::test]
async fn aendern_ohne_neuen_wert_schreibt_nichts() {
    let w = welt().await;
    let mut f = mittag();
    f.sonderkost = sk(12, 3);
    let id = anlegen(&w, f).await.unwrap().id;
    let g = aendern(
        &w,
        id,
        ZeitfensterAenderung {
            bezeichnung: Some("  Mittag ".into()),
            von_at: Some("2026-09-24 10:00:00".into()),
            bedarf_kraefte: Some(180),
            sonderkost: sk(12, 3),
            ..Default::default()
        },
    )
    .await
    .unwrap();
    assert!(g.etb_ids.is_empty());
    assert_eq!(etb(&w.pool, w.e).await.len(), 1);
    assert!(laden(&w, id).await.geaendert_at.is_none(), "kein UPDATE");
}

#[tokio::test]
async fn zeitraum_aendern_nennt_den_vorherigen_zeitraum() {
    let w = welt().await;
    let id = anlegen(&w, mittag()).await.unwrap().id;
    aendern(
        &w,
        id,
        ZeitfensterAenderung {
            bis_at: Some("2026-09-24 12:00:00".into()),
            ..Default::default()
        },
    )
    .await
    .unwrap();
    assert_eq!(
        etb(&w.pool, w.e).await[1].1,
        "Verpflegung ‚Mittag‘ 24.09. 12:00–14:00 (Bedarf 250 EP) geändert: Zeitraum \
         (vorher 24.09. 12:00–13:30)."
    );
}

/// Spec „Löschen mit Ausgaben“: 422, nichts gelöscht. Nach der Rücknahme geht es, und die
/// zurückgenommene Ausgabe verschwindet mit.
#[tokio::test]
async fn loeschen_mit_gueltiger_ausgabe_ist_422_danach_erlaubt() {
    let w = welt().await;
    let id = anlegen(&w, mittag()).await.unwrap().id;
    let a = ausgabe(&w, id, ausgabe_eingabe(120)).await.unwrap();
    assert_eq!(
        status(loeschen_in(&w, w.e, id).await),
        StatusCode::UNPROCESSABLE_ENTITY
    );
    assert_eq!(laden(&w, id).await.ausgaben.len(), 1);
    assert_eq!(etb(&w.pool, w.e).await.len(), 1);

    zuruecknehmen_in(&w, w.e, a.ausgabe_id).await.unwrap();
    let g = loeschen_in(&w, w.e, id).await.unwrap();
    assert_eq!(g.etb_ids.len(), 1);
    assert_eq!(
        status(zeitfenster_laden(&w.pool, w.e, id).await),
        StatusCode::NOT_FOUND
    );
    assert_eq!(
        zaehle(&w.pool, "SELECT COUNT(*) FROM verpflegung_ausgabe").await,
        0
    );
    let eintraege = etb(&w.pool, w.e).await;
    assert_eq!(eintraege.len(), 2, "Anlegen + Löschen");
    assert_eq!(
        eintraege[1].1,
        "Verpflegung ‚Mittag‘ 24.09. 12:00–13:30 gelöscht (Bedarf 250 EP)."
    );
}

/// Spec „Zeitfenster eines anderen Einsatzes“: ändern, löschen, Ausgabe → 404.
#[tokio::test]
async fn zeitfenster_eines_anderen_einsatzes_ist_404() {
    let w = welt().await;
    let fremd = anlegen_in(&w, w.e2, mittag()).await.unwrap().id;
    let a = ZeitfensterAenderung {
        bedarf_betreute: Some(90),
        ..Default::default()
    };
    assert_eq!(status(aendern(&w, fremd, a).await), StatusCode::NOT_FOUND);
    assert_eq!(
        status(loeschen_in(&w, w.e, fremd).await),
        StatusCode::NOT_FOUND
    );
    assert_eq!(
        status(ausgabe(&w, fremd, ausgabe_eingabe(10)).await),
        StatusCode::NOT_FOUND
    );
    assert_eq!(
        zaehle(&w.pool, "SELECT COUNT(*) FROM verpflegung_ausgabe").await,
        0
    );
    assert!(liste(&w.pool, w.e).await.unwrap().zeitfenster.is_empty());
}

// ── Ausgabe erfassen und zurücknehmen ───────────────────────────────────────────────────────

/// Spec „Ausgabe erfassen“: 120 EP am Ort „Verpflegungsstelle Deich“ um 11:40 (vor Beginn —
/// ein Zeitpunkt außerhalb des Zeitfensters ist erlaubt). Kein ETB-Eintrag.
#[tokio::test]
async fn ausgabe_erfassen_zaehlt_in_ausgegeben_ohne_etb() {
    let w = welt().await;
    let id = anlegen(&w, mittag()).await.unwrap().id;
    let mut a = ausgabe_eingabe(120);
    a.sonderkost = sk(10, 2);
    a.bemerkung = Some("  ".into());
    let g = ausgabe(&w, id, a).await.unwrap();
    assert_eq!(g.zeitfenster_id, id);
    let zf = laden(&w, id).await;
    assert_eq!(zf.ausgaben.len(), 1);
    let x = &zf.ausgaben[0];
    assert_eq!(x.id, g.ausgabe_id);
    assert_eq!(x.menge, 120);
    assert_eq!(x.ort.as_deref(), Some("Verpflegungsstelle Deich"));
    assert_eq!(x.bemerkung, None, "leerer Freitext bleibt leer");
    assert_eq!(x.zeitpunkt_at, "2026-09-24 09:40:00");
    assert_eq!(zf.ausgegeben.gesamt, 120);
    assert_eq!(zf.ausgegeben.sonderkost.vegetarisch, 10);
    assert_eq!(zf.fehlmenge.gesamt, 130);
    assert_eq!(etb(&w.pool, w.e).await.len(), 1, "Spec „Ausgabe ohne ETB“");
}

/// Spec „Menge nicht positiv“ + unlesbarer Zeitpunkt: 400.
#[tokio::test]
async fn menge_nicht_positiv_und_unlesbarer_zeitpunkt_sind_400() {
    let w = welt().await;
    let id = anlegen(&w, mittag()).await.unwrap().id;
    for menge in [0, -5] {
        assert_eq!(
            status(ausgabe(&w, id, ausgabe_eingabe(menge)).await),
            StatusCode::BAD_REQUEST
        );
    }
    let mut a = ausgabe_eingabe(5);
    a.zeitpunkt_at = "gleich".into();
    assert_eq!(status(ausgabe(&w, id, a).await), StatusCode::BAD_REQUEST);
    // Menge 0 UND Sonderkost darüber: das Feld scheitert zuerst.
    let mut a = ausgabe_eingabe(0);
    a.sonderkost = sk(3, 0);
    assert_eq!(status(ausgabe(&w, id, a).await), StatusCode::BAD_REQUEST);
    assert_eq!(
        zaehle(&w.pool, "SELECT COUNT(*) FROM verpflegung_ausgabe").await,
        0
    );
}

/// Spec „Rücknahme“ + „Zweite Rücknahme“ + „Ausgabe ohne ETB“.
#[tokio::test]
async fn ruecknahme_senkt_ausgegeben_zweite_ist_422_ohne_etb() {
    let w = welt().await;
    let id = anlegen(&w, mittag()).await.unwrap().id;
    let a1 = ausgabe(&w, id, ausgabe_eingabe(120)).await.unwrap();
    ausgabe(&w, id, ausgabe_eingabe(110)).await.unwrap();
    assert_eq!(laden(&w, id).await.ausgegeben.gesamt, 230);

    let r = zuruecknehmen_in(&w, w.e, a1.ausgabe_id).await.unwrap();
    assert_eq!(r, a1);
    let zf = laden(&w, id).await;
    assert_eq!(zf.ausgegeben.gesamt, 110, "sinkt um 120");
    assert_eq!(zf.ausgaben.len(), 2, "die zurückgenommene bleibt sichtbar");
    let zurueck = zf.ausgaben.iter().find(|x| x.id == a1.ausgabe_id).unwrap();
    assert!(zurueck.zurueckgenommen_at.is_some());

    assert_eq!(
        status(zuruecknehmen_in(&w, w.e, a1.ausgabe_id).await),
        StatusCode::UNPROCESSABLE_ENTITY
    );
    assert_eq!(
        status(zuruecknehmen_in(&w, w.e2, a1.ausgabe_id).await),
        StatusCode::NOT_FOUND,
        "fremde Ausgabe"
    );
    assert_eq!(etb(&w.pool, w.e).await.len(), 1, "nur der Anlage-Eintrag");
}

// ── Zeitzone ────────────────────────────────────────────────────────────────────────────────

#[tokio::test]
async fn zeitzone_kommt_aus_der_org_sonst_berlin() {
    let w = welt().await;
    assert_eq!(zeitzone(&w.pool, w.e).await.unwrap(), ZEITZONE_VORGABE);
    sqlx::query("INSERT INTO org_einstellungen (org_id, zeitzone) VALUES (1, 'America/New_York')")
        .execute(&w.pool)
        .await
        .unwrap();
    assert_eq!(
        zeitzone(&w.pool, w.e).await.unwrap(),
        chrono_tz::America::New_York
    );
    sqlx::query("UPDATE org_einstellungen SET zeitzone = 'Kein/Ort' WHERE org_id = 1")
        .execute(&w.pool)
        .await
        .unwrap();
    assert_eq!(zeitzone(&w.pool, w.e).await.unwrap(), ZEITZONE_VORGABE);
}
