//! Repo-Tests des Fachmoduls Verpflegung (LFH-634) — je Spec-Szenario mindestens ein Test.
//! Die Schreibpfade laufen wie in der Route in `write_retry!`.

use super::*;
use crate::einsatz::nummer::ZEITZONE_VORGABE;
use crate::error::AppError;
use crate::verpflegung::stelle::{VerpflegungsstelleArt, VerpflegungsstelleStatus};
use crate::verpflegung::{SonderkostEingabe, Verpflegungsart};
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
        verpflegungsart: None,
        stelle_ids: Vec::new(),
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
        verpflegungsstelle_id: None,
        client_id: None,
    }
}

fn mit_client_id(menge: i64, client_id: &str) -> AusgabeEingabe {
    AusgabeEingabe {
        client_id: Some(client_id.into()),
        ..ausgabe_eingabe(menge)
    }
}

// ── Wrapper: Schreibpfade in write_retry! wie in der Route ──────────────────────────────────

async fn anlegen_in(
    w: &Welt,
    e: i64,
    eingabe: ZeitfensterEingabe,
) -> Result<Geschrieben, AppError> {
    write_retry!(&w.pool, |conn| {
        create_zeitfenster_tx(conn, e, w.b, STARTWERT, TZ, &eingabe).await
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
        update_zeitfenster_tx(conn, e, id, w.b, STARTWERT, TZ, &a).await
    })
}

async fn aendern(w: &Welt, id: i64, a: ZeitfensterAenderung) -> Result<Geschrieben, AppError> {
    aendern_in(w, w.e, id, a).await
}

async fn loeschen_in(w: &Welt, e: i64, id: i64) -> Result<Geschrieben, AppError> {
    write_retry!(&w.pool, |conn| {
        delete_zeitfenster_tx(conn, e, id, w.b, STARTWERT, TZ).await
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

/// Beide Teilmengen-CHECKs der DB greifen auch ohne Precheck und kommen über das
/// Constraint-Netz als 422 heraus.
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

// ── Offline-Replay (LFH-688) ────────────────────────────────────────────────────────────────

/// Spec „Wiederholte Ausgabe“: derselbe Schlüssel liefert dieselbe Ausgabe als Replay, ohne
/// zweite Zeile, und die ausgegebene Menge steigt nicht.
#[tokio::test]
async fn replay_mit_client_id_legt_keine_zweite_ausgabe_an() {
    let w = welt().await;
    let id = anlegen(&w, mittag()).await.unwrap().id;
    let erst = ausgabe(&w, id, mit_client_id(120, "v1")).await.unwrap();
    assert!(erst.neu);
    let zweit = ausgabe(&w, id, mit_client_id(120, "v1")).await.unwrap();
    assert_eq!(zweit.ausgabe_id, erst.ausgabe_id);
    assert_eq!(zweit.zeitfenster_id, id);
    assert!(!zweit.neu, "Replay");
    assert_eq!(
        zaehle(&w.pool, "SELECT COUNT(*) FROM verpflegung_ausgabe").await,
        1
    );
    assert_eq!(laden(&w, id).await.ausgegeben.gesamt, 120);
    // Ohne Schlüssel bleibt alles wie bisher: zwei Aufrufe, zwei Ausgaben.
    ausgabe(&w, id, ausgabe_eingabe(5)).await.unwrap();
    ausgabe(&w, id, ausgabe_eingabe(5)).await.unwrap();
    assert_eq!(laden(&w, id).await.ausgegeben.gesamt, 130);
}

/// Spec „Replay einer zurückgenommenen Ausgabe“ (design.md D4): der Replay liefert sie, eine
/// Neuanlage höbe die Rücknahme still auf.
#[tokio::test]
async fn replay_einer_zurueckgenommenen_ausgabe_liefert_sie() {
    let w = welt().await;
    let id = anlegen(&w, mittag()).await.unwrap().id;
    let erst = ausgabe(&w, id, mit_client_id(120, "v5")).await.unwrap();
    zuruecknehmen_in(&w, w.e, erst.ausgabe_id).await.unwrap();
    let replay = ausgabe(&w, id, mit_client_id(120, "v5")).await.unwrap();
    assert_eq!(replay.ausgabe_id, erst.ausgabe_id);
    assert!(!replay.neu);
    let zf = laden(&w, id).await;
    assert_eq!(zf.ausgaben.len(), 1);
    assert_eq!(zf.ausgegeben.gesamt, 0, "die Rücknahme bleibt wirksam");
}

/// Spec „Schlüssel eines anderen Zeitfensters“ (design.md D3): 422, nichts gespeichert.
#[tokio::test]
async fn client_id_eines_anderen_zeitfensters_ist_422() {
    let w = welt().await;
    let mittag_id = anlegen(&w, mittag()).await.unwrap().id;
    let mut abend = mittag();
    abend.bezeichnung = "Abend".into();
    let abend_id = anlegen(&w, abend).await.unwrap().id;
    ausgabe(&w, mittag_id, mit_client_id(120, "v2"))
        .await
        .unwrap();
    assert_eq!(
        status(ausgabe(&w, abend_id, mit_client_id(120, "v2")).await),
        StatusCode::UNPROCESSABLE_ENTITY
    );
    assert_eq!(
        zaehle(&w.pool, "SELECT COUNT(*) FROM verpflegung_ausgabe").await,
        1
    );
}

/// Spec „Schlüssel eines anderen Einsatzes“: der Lookup ist einsatzgebunden.
#[tokio::test]
async fn lookup_nach_client_id_ist_einsatzgebunden() {
    let w = welt().await;
    let id = anlegen(&w, mittag()).await.unwrap().id;
    let erst = ausgabe(&w, id, mit_client_id(120, "v3")).await.unwrap();
    let treffer = laden_nach_client_id(&w.pool, w.e, "v3")
        .await
        .unwrap()
        .unwrap();
    assert_eq!(treffer.ausgabe_id, erst.ausgabe_id);
    assert_eq!(treffer.zeitfenster_id, id);
    assert!(!treffer.neu);
    assert_eq!(
        laden_nach_client_id(&w.pool, w.e2, "v3").await.unwrap(),
        None
    );
    assert_eq!(
        laden_nach_client_id(&w.pool, w.e, "v9").await.unwrap(),
        None
    );

    // Im anderen Einsatz entsteht mit demselben Schlüssel eine eigene Ausgabe.
    let id2 = anlegen_in(&w, w.e2, mittag()).await.unwrap().id;
    let fremd = ausgabe_in(&w, w.e2, id2, mit_client_id(30, "v3"))
        .await
        .unwrap();
    assert!(fremd.neu);
    assert_ne!(fremd.ausgabe_id, erst.ausgabe_id);
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

// ── Verpflegungsstellen (LLH-1040) ──────────────────────────────────────────────────────────

fn stelle_eingabe(bez: &str) -> StelleEingabe {
    StelleEingabe {
        bezeichnung: bez.into(),
        art: VerpflegungsstelleArt::Feldkueche,
        standort: Some("Am Sportplatz 2".into()),
        lat: None,
        lon: None,
        abschnitt_id: None,
    }
}

async fn stelle_anlegen_in(w: &Welt, e: i64, eingabe: StelleEingabe) -> Result<i64, AppError> {
    write_retry!(&w.pool, |conn| {
        create_stelle_tx(conn, e, w.b, &eingabe).await
    })
    .map(|g| g.id)
}

async fn stelle(w: &Welt, bez: &str) -> i64 {
    stelle_anlegen_in(w, w.e, stelle_eingabe(bez))
        .await
        .unwrap()
}

async fn stelle_status(
    w: &Welt,
    id: i64,
    nach: VerpflegungsstelleStatus,
) -> Result<StelleGeschrieben, AppError> {
    write_retry!(&w.pool, |conn| {
        update_stelle_status_tx(conn, w.e, id, w.b, STARTWERT, nach).await
    })
}

async fn stelle_aendern(
    w: &Welt,
    id: i64,
    a: StelleAenderung,
) -> Result<StelleGeschrieben, AppError> {
    write_retry!(&w.pool, |conn| {
        update_stelle_tx(conn, w.e, id, &a).await
    })
}

async fn stornieren(w: &Welt, id: i64) -> Result<StelleGeschrieben, AppError> {
    write_retry!(&w.pool, |conn| {
        stelle_stornieren_tx(conn, w.e, id, w.b).await
    })
}

/// Spec „Bezeichnung schon vergeben“ und „Bezeichnung nach Storno wieder frei“; die Bezeichnung
/// wird getrimmt verglichen, auch beim Umbenennen, und ein anderer Einsatz stört nicht.
#[tokio::test]
async fn stelle_bezeichnung_doppelt_409_nach_storno_frei() {
    let w = welt().await;
    let deich = stelle(&w, "Zuführung Deich").await;
    assert_eq!(
        status(stelle_anlegen_in(&w, w.e, stelle_eingabe("  Zuführung Deich ")).await),
        StatusCode::CONFLICT
    );
    stelle_anlegen_in(&w, w.e2, stelle_eingabe("Zuführung Deich"))
        .await
        .expect("anderer Einsatz");
    let turnhalle = stelle(&w, "Ausgabe Turnhalle Nord").await;
    assert_eq!(
        status(
            stelle_aendern(
                &w,
                turnhalle,
                StelleAenderung {
                    bezeichnung: Some("Zuführung Deich".into()),
                    ..Default::default()
                }
            )
            .await
        ),
        StatusCode::CONFLICT,
        "Umbenennen auf einen vergebenen Namen"
    );
    stornieren(&w, deich).await.unwrap();
    stelle(&w, "Zuführung Deich").await;
    assert_eq!(
        etb(&w.pool, w.e).await,
        vec![],
        "Anlegen und Storno ohne ETB"
    );
}

/// Spec „Halbe Koordinate“ (422, auch im Effektivzustand beim Ändern) und „Abschnitt eines
/// anderen Einsatzes“ (404).
#[tokio::test]
async fn stelle_halbe_koordinate_422_fremder_abschnitt_404() {
    let w = welt().await;
    let halb = StelleEingabe {
        lat: Some(52.0),
        ..stelle_eingabe("Feldküche")
    };
    assert_eq!(
        status(stelle_anlegen_in(&w, w.e, halb).await),
        StatusCode::UNPROCESSABLE_ENTITY
    );
    let id = stelle_anlegen_in(
        &w,
        w.e,
        StelleEingabe {
            lat: Some(52.0),
            lon: Some(9.0),
            ..stelle_eingabe("Feldküche")
        },
    )
    .await
    .unwrap();
    assert_eq!(
        status(
            stelle_aendern(
                &w,
                id,
                StelleAenderung {
                    lon: Some(None),
                    ..Default::default()
                }
            )
            .await
        ),
        StatusCode::UNPROCESSABLE_ENTITY
    );
    let fremd: i64 = sqlx::query_scalar(
        "INSERT INTO einsatzabschnitt (einsatz_id, name) VALUES (?, 'Nord') RETURNING id",
    )
    .bind(w.e2)
    .fetch_one(&w.pool)
    .await
    .unwrap();
    assert_eq!(
        status(
            stelle_anlegen_in(
                &w,
                w.e,
                StelleEingabe {
                    abschnitt_id: Some(fremd),
                    ..stelle_eingabe("Ausgabe")
                }
            )
            .await
        ),
        StatusCode::NOT_FOUND
    );
    assert_eq!(
        status(
            stelle_aendern(
                &w,
                id,
                StelleAenderung {
                    abschnitt_id: Some(Some(fremd)),
                    ..Default::default()
                }
            )
            .await
        ),
        StatusCode::NOT_FOUND
    );
}

/// Spec „Aktive Stelle stornieren“ und „Stornieren mit Ausgabe“, auch mit einer
/// zurückgenommenen; „Stornierte Stelle ändern“ (409).
#[tokio::test]
async fn stelle_storno_nur_geplant_ohne_ausgabe() {
    let w = welt().await;
    let aktiv = stelle(&w, "Feldküche").await;
    stelle_status(&w, aktiv, VerpflegungsstelleStatus::Aktiv)
        .await
        .unwrap();
    assert_eq!(
        status(stornieren(&w, aktiv).await),
        StatusCode::UNPROCESSABLE_ENTITY
    );

    let mit_ausgabe = stelle(&w, "Turnhalle").await;
    let zid = anlegen(&w, mittag()).await.unwrap().id;
    let a = ausgabe(
        &w,
        zid,
        AusgabeEingabe {
            verpflegungsstelle_id: Some(mit_ausgabe),
            ..ausgabe_eingabe(10)
        },
    )
    .await
    .unwrap();
    zuruecknehmen_in(&w, w.e, a.ausgabe_id).await.unwrap();
    assert_eq!(
        status(stornieren(&w, mit_ausgabe).await),
        StatusCode::UNPROCESSABLE_ENTITY,
        "auch eine zurückgenommene Ausgabe hält die Stelle"
    );

    let leer = stelle(&w, "Deich").await;
    stornieren(&w, leer).await.unwrap();
    assert_eq!(status(stornieren(&w, leer).await), StatusCode::CONFLICT);
    assert_eq!(
        status(
            stelle_aendern(
                &w,
                leer,
                StelleAenderung {
                    standort: Some(None),
                    ..Default::default()
                }
            )
            .await
        ),
        StatusCode::CONFLICT
    );
    assert_eq!(
        status(stelle_status(&w, leer, VerpflegungsstelleStatus::Aktiv).await),
        StatusCode::CONFLICT
    );
    let liste = liste(&w.pool, w.e).await.unwrap();
    assert!(
        liste.stellen.iter().all(|s| s.id != leer),
        "stornierte Stelle fehlt in stellen[]"
    );
}

/// Storno entfernt die Zuordnungen in derselben Transaktion.
#[tokio::test]
async fn stelle_storno_entfernt_zuordnung() {
    let w = welt().await;
    let a = stelle(&w, "A").await;
    let b = stelle(&w, "B").await;
    let zid = anlegen(
        &w,
        ZeitfensterEingabe {
            stelle_ids: vec![b, a],
            ..mittag()
        },
    )
    .await
    .unwrap()
    .id;
    assert_eq!(
        laden(&w, zid).await.stelle_ids,
        vec![a, b],
        "nach Bezeichnung"
    );
    stornieren(&w, a).await.unwrap();
    assert_eq!(laden(&w, zid).await.stelle_ids, vec![b]);
}

/// Statuswechsel: geplant → aktiv → aufgelöst mit Zeitpunkt und je einem ETB-Eintrag; ein
/// aufgelöste Stelle ist endgültig (422) und bleibt änderbar (D2, Entscheider-Agent 15.10.).
#[tokio::test]
async fn stelle_status_und_aufgeloeste_aendern() {
    let w = welt().await;
    let id = stelle(&w, "Feldküche BR Sportplatz").await;
    assert_eq!(
        status(stelle_status(&w, id, VerpflegungsstelleStatus::Geplant).await),
        StatusCode::UNPROCESSABLE_ENTITY,
        "geplant → geplant"
    );
    let g = stelle_status(&w, id, VerpflegungsstelleStatus::Aktiv)
        .await
        .unwrap();
    assert_eq!(g.etb_ids.len(), 1);
    let g = stelle_status(&w, id, VerpflegungsstelleStatus::Aufgeloest)
        .await
        .unwrap();
    assert_eq!(g.etb_ids.len(), 1);
    let s = load_stelle(&w.pool, w.e, id).await.unwrap();
    assert_eq!(s.status, VerpflegungsstelleStatus::Aufgeloest);
    assert!(s.aufgeloest_at.is_some());
    assert_eq!(
        status(stelle_status(&w, id, VerpflegungsstelleStatus::Aktiv).await),
        StatusCode::UNPROCESSABLE_ENTITY
    );
    let g = stelle_aendern(
        &w,
        id,
        StelleAenderung {
            bezeichnung: Some("Feldküche Sportplatz".into()),
            standort: Some(Some("Am Sportplatz 4".into())),
            lat: Some(Some(52.1)),
            lon: Some(Some(9.2)),
            ..Default::default()
        },
    )
    .await
    .unwrap();
    assert!(g.geaendert);
    let s = load_stelle(&w.pool, w.e, id).await.unwrap();
    assert_eq!(
        (s.bezeichnung.as_str(), s.standort.as_deref()),
        ("Feldküche Sportplatz", Some("Am Sportplatz 4"))
    );
    assert_eq!(
        s.status,
        VerpflegungsstelleStatus::Aufgeloest,
        "Status bleibt"
    );
    let leer = stelle_aendern(
        &w,
        id,
        StelleAenderung {
            bezeichnung: Some("Feldküche Sportplatz".into()),
            ..Default::default()
        },
    )
    .await
    .unwrap();
    assert!(!leer.geaendert, "ohne neuen Wert nichts geschrieben");
    let texte: Vec<String> = etb(&w.pool, w.e)
        .await
        .into_iter()
        .map(|(_, t)| t)
        .collect();
    assert_eq!(
        texte,
        vec![
            "Verpflegungsstelle ‚Feldküche BR Sportplatz‘ (Feldküche) in Betrieb genommen.",
            "Verpflegungsstelle ‚Feldküche BR Sportplatz‘ (Feldküche) aufgelöst.",
        ],
        "Ändern schreibt kein ETB, alte Einträge behalten den alten Namen"
    );
}

/// Spec „Stelle eines anderen Einsatzes“ im Pfad: 404 für Ändern, Status und Storno.
#[tokio::test]
async fn stelle_eines_anderen_einsatzes_ist_404() {
    let w = welt().await;
    let fremd = stelle_anlegen_in(&w, w.e2, stelle_eingabe("Fremd"))
        .await
        .unwrap();
    assert_eq!(
        status(stelle_aendern(&w, fremd, StelleAenderung::default()).await),
        StatusCode::NOT_FOUND
    );
    assert_eq!(
        status(stelle_status(&w, fremd, VerpflegungsstelleStatus::Aktiv).await),
        StatusCode::NOT_FOUND
    );
    assert_eq!(status(stornieren(&w, fremd).await), StatusCode::NOT_FOUND);
}

/// Spec „Getränke“: die Verpflegungsart ist nur Anzeige, die Deckung gleich gerechnet.
#[tokio::test]
async fn getraenke_fenster_wird_gleich_gedeckt() {
    let w = welt().await;
    let zid = anlegen(
        &w,
        ZeitfensterEingabe {
            bezeichnung: "Getränke".into(),
            bedarf_kraefte: 120,
            bedarf_betreute: 0,
            verpflegungsart: Some(Verpflegungsart::Getraenke),
            ..mittag()
        },
    )
    .await
    .unwrap()
    .id;
    ausgabe(&w, zid, ausgabe_eingabe(100)).await.unwrap();
    let zf = laden(&w, zid).await;
    assert_eq!(zf.verpflegungsart, Some(Verpflegungsart::Getraenke));
    assert_eq!((zf.ausgegeben.gesamt, zf.fehlmenge.gesamt), (100, 20));
}

/// Spec `eingabegrenzen` „Doppelte Stellen“: `[3, 3, 4]` ordnet genau 3 und 4 zu.
#[tokio::test]
async fn doppelte_stellen_werden_entdoppelt() {
    let w = welt().await;
    let a = stelle(&w, "A").await;
    let b = stelle(&w, "B").await;
    let zid = anlegen(
        &w,
        ZeitfensterEingabe {
            stelle_ids: vec![a, a, b],
            ..mittag()
        },
    )
    .await
    .unwrap()
    .id;
    assert_eq!(laden(&w, zid).await.stelle_ids, vec![a, b]);
    aendern(
        &w,
        zid,
        ZeitfensterAenderung {
            stelle_ids: Some(vec![b, b, a, b]),
            ..Default::default()
        },
    )
    .await
    .unwrap();
    assert_eq!(laden(&w, zid).await.stelle_ids, vec![a, b]);
}

/// Roher Zeitpunkt der Auflösung, wie gespeichert.
async fn aufgeloest_at(w: &Welt, id: i64) -> String {
    sqlx::query_scalar("SELECT aufgeloest_at FROM verpflegungsstelle WHERE id = ?")
        .bind(id)
        .fetch_one(&w.pool)
        .await
        .unwrap()
}

/// Spec „Replay vor der Zustandsprüfung“ IN der Transaktion (D3): der Fall zweier gleichzeitiger
/// Flushes, deren zweiter am Vorab-Lookup der Route vorbeikam. Die Ausgabe ist gebucht, die Stelle
/// danach aufgelöst; derselbe Schlüssel liefert die Ausgabe, auch mit einem Zeitpunkt, den die
/// Stellenprüfung ablehnte (Gegenprobe mit neuem Schlüssel: 409).
#[tokio::test]
async fn replay_in_der_transaktion_vor_der_stellenpruefung() {
    let w = welt().await;
    let sid = stelle(&w, "Ausgabe Turnhalle Nord").await;
    let zid = anlegen(&w, mittag()).await.unwrap().id;
    let an_stelle = |client_id: &str, zeitpunkt_at: &str| AusgabeEingabe {
        verpflegungsstelle_id: Some(sid),
        zeitpunkt_at: zeitpunkt_at.into(),
        ..mit_client_id(40, client_id)
    };
    let erst = ausgabe(&w, zid, an_stelle("s1", "2026-09-24 09:40:00"))
        .await
        .unwrap();
    stelle_status(&w, sid, VerpflegungsstelleStatus::Aufgeloest)
        .await
        .unwrap();
    let nach = aufgeloest_at(&w, sid).await;
    assert_eq!(
        status(ausgabe(&w, zid, an_stelle("s2", &nach)).await),
        StatusCode::CONFLICT,
        "Gegenprobe: neuer Schlüssel an der aufgelösten Stelle"
    );
    let wieder = ausgabe(&w, zid, an_stelle("s1", &nach)).await.unwrap();
    assert_eq!(wieder.ausgabe_id, erst.ausgabe_id);
    assert!(!wieder.neu, "Replay");
    assert_eq!(
        zaehle(&w.pool, "SELECT COUNT(*) FROM verpflegung_ausgabe").await,
        1
    );
}

/// Reihenfolge der Prüfungen (D3, tasks 5.1/5.2): die Stelle zuletzt. Eine stornierte oder
/// aufgelöste Stelle verdeckt weder das unbekannte Zeitfenster (404) noch einen 400er noch die
/// Teilmenge (422 statt 409).
#[tokio::test]
async fn stellenpruefung_nach_zeitfenster_400ern_und_teilmenge() {
    let w = welt().await;
    let zid = anlegen(&w, mittag()).await.unwrap().id;
    let weg = stelle(&w, "Zuführung Deich").await;
    stornieren(&w, weg).await.unwrap();
    let aufgeloest = stelle(&w, "Feldküche BR Sportplatz").await;
    stelle_status(&w, aufgeloest, VerpflegungsstelleStatus::Aufgeloest)
        .await
        .unwrap();
    let nach = aufgeloest_at(&w, aufgeloest).await;
    let an = |sid: i64, menge: i64| AusgabeEingabe {
        verpflegungsstelle_id: Some(sid),
        zeitpunkt_at: nach.clone(),
        ..ausgabe_eingabe(menge)
    };
    // Ohne weiteren Fehler sagt die Stelle selbst ab.
    assert_eq!(
        status(ausgabe(&w, zid, an(weg, 5)).await),
        StatusCode::UNPROCESSABLE_ENTITY
    );
    assert_eq!(
        status(ausgabe(&w, zid, an(aufgeloest, 5)).await),
        StatusCode::CONFLICT
    );
    for (sid, was) in [(weg, "storniert"), (aufgeloest, "aufgelöst")] {
        assert_eq!(
            status(ausgabe(&w, 999_999, an(sid, 5)).await),
            StatusCode::NOT_FOUND,
            "{was}: unbekanntes Zeitfenster"
        );
        assert_eq!(
            status(ausgabe(&w, zid, an(sid, 0)).await),
            StatusCode::BAD_REQUEST,
            "{was}: Menge 0"
        );
        assert_eq!(
            status(
                ausgabe(
                    &w,
                    zid,
                    AusgabeEingabe {
                        sonderkost: sk(-1, 0),
                        ..an(sid, 5)
                    }
                )
                .await
            ),
            StatusCode::BAD_REQUEST,
            "{was}: negative Kostform"
        );
    }
    assert_eq!(
        status(
            ausgabe(
                &w,
                zid,
                AusgabeEingabe {
                    sonderkost: sk(4, 3),
                    ..an(aufgeloest, 5)
                }
            )
            .await
        ),
        StatusCode::UNPROCESSABLE_ENTITY,
        "aufgelöst: Sonderkost über der Menge ist 422, nicht 409"
    );
    assert_eq!(
        zaehle(&w.pool, "SELECT COUNT(*) FROM verpflegung_ausgabe").await,
        0
    );
}

/// Eine direkt aufgelöste Stelle (geplant → aufgelöst, ohne Ausgabe) lässt sich nicht stornieren
/// (422): sie bleibt in `stellen[]`, und das ETB behält genau den Eintrag „… aufgelöst.“ (D2).
#[tokio::test]
async fn aufgeloeste_stelle_ohne_ausgabe_storno_422() {
    let w = welt().await;
    let id = stelle(&w, "Zuführung Deich").await;
    stelle_status(&w, id, VerpflegungsstelleStatus::Aufgeloest)
        .await
        .unwrap();
    assert_eq!(
        status(stornieren(&w, id).await),
        StatusCode::UNPROCESSABLE_ENTITY
    );
    let liste = liste(&w.pool, w.e).await.unwrap();
    let s = liste
        .stellen
        .iter()
        .find(|s| s.id == id)
        .expect("aufgelöste Stelle bleibt in stellen[]");
    assert_eq!(s.status, VerpflegungsstelleStatus::Aufgeloest);
    assert_eq!(
        etb(&w.pool, w.e).await.len(),
        1,
        "nur „… aufgelöst.“, kein Gegenstück"
    );
}

// ── Tag aus der Vorlage (LLH-1058, design.md D3, D5) ────────────────────────────────────────

/// Der 11.10.2026 in Berlin: 10.10. 22:00 bis 11.10. 22:00 UTC.
const TAG_VON: &str = "2026-10-10 22:00:00";
const TAG_BIS: &str = "2026-10-11 22:00:00";

/// Ein Fenster des 11.10. mit 100 Kräften und 20 Betreuten.
fn fenster(bezeichnung: &str, von_at: &str, bis_at: &str) -> ZeitfensterEingabe {
    ZeitfensterEingabe {
        bezeichnung: bezeichnung.into(),
        von_at: von_at.into(),
        bis_at: bis_at.into(),
        bedarf_kraefte: 100,
        bedarf_betreute: 20,
        ..mittag()
    }
}

/// Frühstück 06:30–08:00, Mittag 12:00–13:30, Abendessen 18:00–19:30 in Berlin.
fn drei_fenster() -> Vec<ZeitfensterEingabe> {
    vec![
        fenster("Frühstück", "2026-10-11 04:30:00", "2026-10-11 06:00:00"),
        fenster("Mittag", "2026-10-11 10:00:00", "2026-10-11 11:30:00"),
        fenster("Abendessen", "2026-10-11 16:00:00", "2026-10-11 17:30:00"),
    ]
}

async fn tag_in(
    w: &Welt,
    e: i64,
    von: &str,
    bis: &str,
    fenster: Vec<ZeitfensterEingabe>,
) -> Result<TagGeschrieben, AppError> {
    write_retry!(&w.pool, |conn| {
        zeitfenster_aus_vorlage_tx(conn, e, w.b, STARTWERT, TZ, von, bis, &fenster).await
    })
}

async fn tag(w: &Welt, fenster: Vec<ZeitfensterEingabe>) -> Result<TagGeschrieben, AppError> {
    tag_in(w, w.e, TAG_VON, TAG_BIS, fenster).await
}

async fn anzahl_zeitfenster(w: &Welt) -> i64 {
    zaehle(&w.pool, "SELECT COUNT(*) FROM verpflegung_zeitfenster").await
}

fn meldung(r: Result<TagGeschrieben, AppError>) -> (StatusCode, String) {
    let e = r.unwrap_err();
    (e.status(), e.to_string())
}

/// Spec „Drei Zeitfenster für einen Tag“: drei gewöhnliche Zeitfenster, je ein ETB-Eintrag mit
/// demselben Text wie beim Einzelanlegen.
#[tokio::test]
async fn tag_aus_vorlage_legt_drei_zeitfenster_wie_einzeln_an() {
    let w = welt().await;
    let g = tag(&w, drei_fenster()).await.unwrap();
    assert_eq!(g.angelegt.len(), 3);
    assert!(g.uebersprungen.is_empty());
    assert_eq!(g.etb_ids.len(), 3);
    let namen: Vec<String> = liste(&w.pool, w.e)
        .await
        .unwrap()
        .zeitfenster
        .into_iter()
        .map(|z| {
            assert!(z.stelle_ids.is_empty(), "keine Stelle: {z:?}");
            z.bezeichnung
        })
        .collect();
    assert_eq!(namen, ["Frühstück", "Mittag", "Abendessen"]);

    // Dieselben Fenster einzeln im anderen Einsatz: dieselben ETB-Texte.
    for f in drei_fenster() {
        anlegen_in(&w, w.e2, f).await.unwrap();
    }
    let sammel = etb(&w.pool, w.e).await;
    assert_eq!(sammel, etb(&w.pool, w.e2).await);
    assert_eq!(
        sammel[0].1,
        "Verpflegung ‚Frühstück‘ 11.10. 06:30–08:00 angelegt: Bedarf 120 EP (100 Kräfte, \
         20 Betreute)."
    );
}

/// Spec „Feldfehler vor dem Zusammenhang“ (D3): ein 422 im ersten Fenster und ein 400 im
/// dritten ergeben 400; nichts ist angelegt.
#[tokio::test]
async fn tag_aus_vorlage_feldfehler_irgendeines_fensters_vor_dem_zusammenhang() {
    let w = welt().await;
    let mut f = drei_fenster();
    f[0].sonderkost = sk(500, 0);
    f[2].bezeichnung = "  ".into();
    let (s, m) = meldung(tag(&w, f).await);
    assert_eq!(s, StatusCode::BAD_REQUEST, "{m}");
    assert!(m.contains("Zeitfenster 3"), "{m}");
    let mut f = drei_fenster();
    f[0].von_at = "2026-10-12 04:30:00".into();
    f[2].bedarf_betreute = -1;
    let (s, m) = meldung(tag(&w, f).await);
    assert_eq!(
        s,
        StatusCode::BAD_REQUEST,
        "Beginn außerhalb im ersten: {m}"
    );
    assert!(m.contains("„Abendessen“"), "{m}");
    assert_eq!(anzahl_zeitfenster(&w).await, 0);
    assert!(etb(&w.pool, w.e).await.is_empty());
}

/// Spec „Gleichnamiges Zeitfenster am selben Tag“: „mittag“ wird gegen „Mittag“ übersprungen
/// und genannt, ohne ETB-Eintrag.
#[tokio::test]
async fn tag_aus_vorlage_ueberspringt_gleichnamiges_am_selben_tag() {
    let w = welt().await;
    anlegen(
        &w,
        fenster("Mittag", "2026-10-11 09:30:00", "2026-10-11 11:00:00"),
    )
    .await
    .unwrap();
    let mut f = drei_fenster();
    f[1].bezeichnung = " mittag ".into();
    let g = tag(&w, f).await.unwrap();
    assert_eq!(g.angelegt.len(), 2);
    assert_eq!(g.uebersprungen, ["mittag"]);
    assert_eq!(g.etb_ids.len(), 2);
    assert_eq!(anzahl_zeitfenster(&w).await, 3);
    assert_eq!(
        etb(&w.pool, w.e).await.len(),
        3,
        "1 einzeln + 2 aus der Vorlage"
    );
}

/// Der Vergleich faltet auch Umlaute (`to_lowercase`, nicht SQLites `lower()`).
#[tokio::test]
async fn tag_aus_vorlage_ueberspringt_fruehstueck_gegen_grossbuchstaben() {
    let w = welt().await;
    anlegen(
        &w,
        fenster("Frühstück", "2026-10-11 04:30:00", "2026-10-11 06:00:00"),
    )
    .await
    .unwrap();
    let mut f = drei_fenster();
    f[0].bezeichnung = "FRÜHSTÜCK".into();
    let g = tag(&w, f).await.unwrap();
    assert_eq!(g.uebersprungen, ["FRÜHSTÜCK"]);
    assert_eq!(g.angelegt.len(), 2);
}

/// Spec „Gleicher Name am Vortag“ (R6): ein „Abendessen“, das am 10.10. beginnt und über
/// Mitternacht dauert, blockiert das des 11.10. nicht; ebenso wenig eins in einem anderen
/// Einsatz.
#[tokio::test]
async fn tag_aus_vorlage_name_am_vortag_oder_anderswo_blockiert_nicht() {
    let w = welt().await;
    anlegen(
        &w,
        fenster("Abendessen", "2026-10-10 21:30:00", "2026-10-10 22:30:00"),
    )
    .await
    .unwrap();
    anlegen_in(
        &w,
        w.e2,
        fenster("Mittag", "2026-10-11 10:00:00", "2026-10-11 11:30:00"),
    )
    .await
    .unwrap();
    let g = tag(&w, drei_fenster()).await.unwrap();
    assert_eq!(g.angelegt.len(), 3);
    assert!(g.uebersprungen.is_empty());
}

/// Spec „Alles schon angelegt“: nichts entsteht, kein ETB.
#[tokio::test]
async fn tag_aus_vorlage_alles_uebersprungen() {
    let w = welt().await;
    tag(&w, drei_fenster()).await.unwrap();
    let vorher = etb(&w.pool, w.e).await.len();
    let g = tag(&w, drei_fenster()).await.unwrap();
    assert!(g.angelegt.is_empty());
    assert!(g.etb_ids.is_empty());
    assert_eq!(g.uebersprungen, ["Frühstück", "Mittag", "Abendessen"]);
    assert_eq!(anzahl_zeitfenster(&w).await, 3);
    assert_eq!(etb(&w.pool, w.e).await.len(), vorher);
}

/// Spec „Ein Zeitfenster scheitert“: Sonderkost über dem Bedarf beim dritten ist 422 mit seiner
/// Bezeichnung; keines der drei entsteht.
#[tokio::test]
async fn tag_aus_vorlage_scheiterndes_drittes_fenster_legt_nichts_an() {
    let w = welt().await;
    let mut f = drei_fenster();
    f[2].sonderkost = sk(100, 21);
    let (s, m) = meldung(tag(&w, f).await);
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY, "{m}");
    assert!(m.contains("„Abendessen“"), "{m}");
    let mut f = drei_fenster();
    f[2].bis_at = f[2].von_at.clone();
    let (s, m) = meldung(tag(&w, f).await);
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY, "{m}");
    assert!(m.contains("„Abendessen“"), "{m}");
    assert_eq!(anzahl_zeitfenster(&w).await, 0);
    assert!(etb(&w.pool, w.e).await.is_empty());
}

/// Spec „Beginn außerhalb des Tages“: vor `tag_von_at` oder ab `tag_bis_at` ist 422; genau
/// `tag_von_at` gehört zum Tag.
#[tokio::test]
async fn tag_aus_vorlage_beginn_muss_im_tag_liegen() {
    let w = welt().await;
    for von in ["2026-10-10 21:59:59", TAG_BIS] {
        let mut f = drei_fenster();
        f[1].von_at = von.into();
        f[1].bis_at = "2026-10-11 23:00:00".into();
        let (s, m) = meldung(tag(&w, f).await);
        assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY, "{von}: {m}");
        assert!(m.contains("„Mittag“"), "{m}");
    }
    assert_eq!(anzahl_zeitfenster(&w).await, 0);
    let mut f = drei_fenster();
    f[0].von_at = TAG_VON.into();
    let g = tag(&w, f).await.unwrap();
    assert_eq!(g.angelegt.len(), 3, "Beginn genau an der Tagesgrenze");
}

/// Eine Bezeichnung höchstens einmal je Anfrage (getrimmt, ohne Groß- und Kleinschreibung).
#[tokio::test]
async fn tag_aus_vorlage_doppelte_bezeichnung_ist_422() {
    let w = welt().await;
    let mut f = drei_fenster();
    f[2].bezeichnung = " MITTAG".into();
    let (s, m) = meldung(tag(&w, f).await);
    assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY, "{m}");
    assert!(m.contains("MITTAG"), "{m}");
    assert_eq!(anzahl_zeitfenster(&w).await, 0);
}

/// Die Tagesgrenzen liegen 23 bis 25 Stunden auseinander (Tage der Zeitumstellung), sonst 422.
#[tokio::test]
async fn tag_aus_vorlage_tagesgrenzen_23_bis_25_stunden() {
    let w = welt().await;
    for bis in ["2026-10-11 20:00:00", "2026-10-12 00:00:00", TAG_VON] {
        let (s, m) = meldung(tag_in(&w, w.e, TAG_VON, bis, drei_fenster()).await);
        assert_eq!(s, StatusCode::UNPROCESSABLE_ENTITY, "bis {bis}: {m}");
    }
    assert_eq!(anzahl_zeitfenster(&w).await, 0);
    // 25.10.2026 in Berlin (25 h) und 29.03.2026 (23 h).
    let g = tag_in(
        &w,
        w.e,
        "2026-10-24 22:00:00",
        "2026-10-25 23:00:00",
        vec![fenster(
            "Nachtverpflegung",
            "2026-10-24 22:00:00",
            "2026-10-25 03:00:00",
        )],
    )
    .await
    .unwrap();
    assert_eq!(g.angelegt.len(), 1);
    let g = tag_in(
        &w,
        w.e,
        "2026-03-28 23:00:00",
        "2026-03-29 22:00:00",
        vec![fenster(
            "Frühstück",
            "2026-03-29 04:30:00",
            "2026-03-29 06:00:00",
        )],
    )
    .await
    .unwrap();
    assert_eq!(g.angelegt.len(), 1);
}

/// Tagesgrenzen unlesbar und eine leere oder zu große Anfrage sind 400.
#[tokio::test]
async fn tag_aus_vorlage_grenzen_und_unlesbarer_tag_sind_400() {
    let w = welt().await;
    let (s, _) = meldung(tag_in(&w, w.e, "gestern", TAG_BIS, drei_fenster()).await);
    assert_eq!(s, StatusCode::BAD_REQUEST);
    let (s, _) = meldung(tag(&w, Vec::new()).await);
    assert_eq!(s, StatusCode::BAD_REQUEST, "leere Anfrage");
    let viele: Vec<ZeitfensterEingabe> = (0..=crate::verpflegung::AUS_VORLAGE_MAX)
        .map(|i| {
            fenster(
                &format!("Mahlzeit {i}"),
                "2026-10-11 04:30:00",
                "2026-10-11 06:00:00",
            )
        })
        .collect();
    let (s, _) = meldung(tag(&w, viele).await);
    assert_eq!(s, StatusCode::BAD_REQUEST, "25 Fenster");
    assert_eq!(anzahl_zeitfenster(&w).await, 0);
}
