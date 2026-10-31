//! Stamm-Treffer und Eintreffen aus einer Vorlage (LLH-1300, design.md D2–D4).

use super::*;
use crate::bereitstellungsraum::eintreffen::{self, EintreffenEingabe, Erfassung, VorlageAngabe};
use crate::bereitstellungsraum::repo as br_repo;
use crate::db::test_pool;
use crate::einheit_vorlage::repo::{self as vrepo, NewVorlage};
use crate::einheit_vorlage::PersonalEntry;

const ZEIT: &str = "2026-05-28 14:30:00";
const EINGANG: &str = "2026-05-28 14:31:00";

/// Org 1 mit dem Löschzug „Florian Musterstadt 1“ (Untereinheit „1. Gruppe“) als Vorlage, Stamm-
/// Fahrzeuge „1-10-1“ (Zug) und „1-44-1“ (Gruppe), eine Person der Stammbesetzung, ein aktiver
/// Einsatz mit aktivem BR „Sportplatz“.
struct Welt {
    benutzer: i64,
    einsatz: i64,
    br: i64,
    zug: i64,
    gruppe: i64,
    elw: i64,
    hlf: i64,
    typ: i64,
}

async fn welt(pool: &SqlitePool) -> Welt {
    sqlx::query("INSERT INTO organisation (id, name) VALUES (1, 'Orga'), (2, 'Fremd')")
        .execute(pool)
        .await
        .unwrap();
    let benutzer: i64 = sqlx::query_scalar(
        "INSERT INTO benutzer (org_id, anzeigename, benutzername, passwort_hash, \
            system_rolle, org_rolle, aktiv) \
         VALUES (1, 'A', 'a', 'h', 'keiner', 'keine', 1) RETURNING id",
    )
    .fetch_one(pool)
    .await
    .unwrap();
    let einsatz: i64 = sqlx::query_scalar(
        "INSERT INTO einsatz (org_id, bezeichnung, status, begonnen_at, einsatzart, angelegt_at) \
         VALUES (1, 'Lage', 'aktiv', '2026-05-28', 'realeinsatz', '2026-05-28') RETURNING id",
    )
    .fetch_one(pool)
    .await
    .unwrap();
    let br = br_repo::create(
        pool,
        einsatz,
        benutzer,
        br_repo::NeueDaten {
            bezeichnung: "Sportplatz",
            abschnitt_id: None,
            standort: None,
            notiz: None,
            lat: None,
            lon: None,
        },
    )
    .await
    .unwrap()
    .id;
    br_repo::setze_status(pool, einsatz, br, "aktiv", benutzer)
        .await
        .unwrap();
    let typ: i64 = sqlx::query_scalar(
        "INSERT INTO einheit_typ (org_id, label) VALUES (1, 'Löschzug') RETURNING id",
    )
    .fetch_one(pool)
    .await
    .unwrap();
    let vorlage = |name: &'static str, ueber: Option<i64>, frn: Option<&'static str>| NewVorlage {
        name,
        typ_id: typ,
        ueber_vorlage_id: ueber,
        funkrufname: frn,
        tz_fachaufgabe: None,
        tz_organisation: None,
        soll: None,
        bemerkung: Some("Schlüssel im Spind 4"),
        sortier: 0,
    };
    let zug = vrepo::create(
        pool,
        1,
        vorlage("Florian Musterstadt 1", None, Some("FL MUS 1")),
    )
    .await
    .unwrap()
    .id;
    let gruppe = vrepo::create(pool, 1, vorlage("1. Gruppe", Some(zug), None))
        .await
        .unwrap()
        .id;
    let elw = stamm_fahrzeug(pool, "1-10-1").await;
    let hlf = stamm_fahrzeug(pool, "1-44-1").await;
    vrepo::replace_fahrzeuge(pool, 1, zug, &[elw])
        .await
        .unwrap();
    vrepo::replace_fahrzeuge(pool, 1, gruppe, &[hlf])
        .await
        .unwrap();
    let person: i64 =
        sqlx::query_scalar("INSERT INTO personal (org_id, name) VALUES (1, 'Zander') RETURNING id")
            .fetch_one(pool)
            .await
            .unwrap();
    vrepo::replace_personal(
        pool,
        1,
        zug,
        &[PersonalEntry {
            personal_id: person,
            fahrzeug_id: Some(elw),
            staerke_position: None,
        }],
    )
    .await
    .unwrap();
    Welt {
        benutzer,
        einsatz,
        br,
        zug,
        gruppe,
        elw,
        hlf,
        typ,
    }
}

async fn stamm_fahrzeug(pool: &SqlitePool, funkrufname: &str) -> i64 {
    sqlx::query_scalar(
        "INSERT INTO fahrzeug (org_id, funkrufname, fahrzeugtyp) VALUES (1, ?, 'HLF') RETURNING id",
    )
    .bind(funkrufname)
    .fetch_one(pool)
    .await
    .unwrap()
}

fn rahmen(w: &Welt, client_id: Option<&'static str>) -> Rahmen<'static> {
    Rahmen {
        einsatz_id: w.einsatz,
        org_id: 1,
        br_id: w.br,
        benutzer_id: w.benutzer,
        zeitpunkt_at: ZEIT,
        eingang_at: EINGANG,
        client_id,
        etb_startwert: 1,
    }
}

async fn buche(pool: &SqlitePool, w: &Welt, vorlage_id: i64) -> Result<Gebucht, AppError> {
    let mut tx = pool.begin().await.unwrap();
    let r = eintreffen::eintreffen_tx(
        &mut tx,
        &rahmen(w, Some("c1")),
        &Erfassung::Vorlage { vorlage_id },
        None,
    )
    .await;
    if r.is_ok() {
        tx.commit().await.unwrap();
    }
    r
}

async fn zahl(pool: &SqlitePool, sql: &str, einsatz: i64) -> i64 {
    sqlx::query_scalar(sqlx::AssertSqlSafe(sql.to_string()))
        .bind(einsatz)
        .fetch_one(pool)
        .await
        .unwrap()
}

async fn suche(pool: &SqlitePool, w: &Welt, text: &str) -> Vec<StammTreffer> {
    let s = check_suche(Some(text)).unwrap().expect("lang genug");
    suchen(pool, w.einsatz, 1, &s).await.unwrap()
}

#[test]
fn suche_unter_drei_zeichen_ist_leer_und_zu_lange_ist_400() {
    assert_eq!(check_suche(None).unwrap(), None);
    assert_eq!(check_suche(Some("  fl ")).unwrap(), None);
    assert_eq!(
        check_suche(Some("  Florian   MUSTERSTADT "))
            .unwrap()
            .as_deref(),
        Some("florian musterstadt")
    );
    let lang = "x".repeat(SUCHE_MAX + 1);
    assert!(matches!(
        check_suche(Some(&lang)),
        Err(AppError::Validation(_))
    ));
}

#[test]
fn etb_text_nennt_herkunft_untereinheiten_und_fahrzeuge() {
    assert_eq!(
        etb_text(
            "Florian Musterstadt 1",
            "Sportplatz",
            EintreffenZeitachse::Geschrieben,
            &["1. Gruppe".into()],
            &["1-10-1".into(), "1-44-1".into()],
        ),
        "Florian Musterstadt 1 im BR Sportplatz eingetroffen (aus den Stammdaten; mit 1. Gruppe; \
         Fahrzeuge 1-10-1, 1-44-1)"
    );
    assert_eq!(
        etb_text("Zug", "Nord", EintreffenZeitachse::Geschrieben, &[], &[]),
        "Zug im BR Nord eingetroffen (aus den Stammdaten)"
    );
}

#[test]
fn eingabe_vorlage_schliesst_andere_formen_und_nachforderung_aus() {
    let vorlage = || Some(VorlageAngabe { vorlage_id: 7 });
    let nur = EintreffenEingabe {
        vorlage: vorlage(),
        ..Default::default()
    };
    assert_eq!(
        eintreffen::check(&nur).unwrap(),
        Erfassung::Vorlage { vorlage_id: 7 }
    );
    let mit_kraft = EintreffenEingabe {
        vorlage: vorlage(),
        kraft: Some(eintreffen::KraftAngabe {
            objekt_typ: "einheit".into(),
            objekt_id: 1,
        }),
        ..Default::default()
    };
    assert!(matches!(
        eintreffen::check(&mit_kraft),
        Err(AppError::UnprocessableEntity(_))
    ));
    let mit_nachforderung = EintreffenEingabe {
        vorlage: vorlage(),
        nachforderung_id: Some(3),
        ..Default::default()
    };
    assert!(matches!(
        eintreffen::check(&mit_nachforderung),
        Err(AppError::UnprocessableEntity(_))
    ));
}

#[tokio::test]
async fn suche_findet_die_vorlage_ueber_name_funkrufname_und_fahrzeug() {
    let pool = test_pool().await;
    let w = welt(&pool).await;
    for text in ["florian musterstadt 1", "FL MUS", "1-10-1"] {
        let treffer = suche(&pool, &w, text).await;
        assert_eq!(
            treffer.iter().map(|t| t.vorlage_id).collect::<Vec<_>>(),
            vec![w.zug],
            "Suche {text}"
        );
    }
    // Der Typ trifft beide, nach Name.
    assert_eq!(
        suche(&pool, &w, "löschzug")
            .await
            .iter()
            .map(|t| t.vorlage_id)
            .collect::<Vec<_>>(),
        vec![w.gruppe, w.zug]
    );
    let t = &suche(&pool, &w, "Florian Musterstadt 1").await[0];
    assert_eq!(
        t,
        &StammTreffer {
            vorlage_id: w.zug,
            name: "Florian Musterstadt 1".into(),
            funkrufname: Some("FL MUS 1".into()),
            typ_label: "Löschzug".into(),
            untereinheiten: 1,
            fahrzeuge: vec!["1-10-1".into(), "1-44-1".into()],
            ist_demo: false,
        }
    );
    // Die Untervorlage ist selbst ein Treffer (über ihr eigenes Fahrzeug).
    let gruppe = suche(&pool, &w, "1-44").await;
    assert_eq!(
        gruppe.iter().map(|t| t.vorlage_id).collect::<Vec<_>>(),
        vec![w.gruppe]
    );
    // Projektion ohne Personen, Bemerkung und Material (design.md D2).
    let json = serde_json::to_string(&suche(&pool, &w, "florian").await).unwrap();
    assert!(
        !json.contains("Zander") && !json.contains("Spind"),
        "{json}"
    );
}

#[tokio::test]
async fn suche_laesst_aus_was_schon_im_einsatz_heisst_und_deaktiviertes() {
    let pool = test_pool().await;
    let w = welt(&pool).await;
    sqlx::query("INSERT INTO einsatz_einheit (einsatz_id, name) VALUES (?, 'fl mus 1')")
        .bind(w.einsatz)
        .execute(&pool)
        .await
        .unwrap();
    assert!(suche(&pool, &w, "florian").await.is_empty());
    sqlx::query("UPDATE einheit_vorlage SET aktiv = 0 WHERE id = ?")
        .bind(w.gruppe)
        .execute(&pool)
        .await
        .unwrap();
    assert!(suche(&pool, &w, "1. gruppe").await.is_empty());
}

#[tokio::test]
async fn suche_liefert_hoechstens_zehn_treffer_nach_name() {
    let pool = test_pool().await;
    let w = welt(&pool).await;
    for i in 0..12 {
        let name = format!("SEG Musterstadt {i:02}");
        vrepo::create(
            &pool,
            1,
            NewVorlage {
                name: &name,
                typ_id: w.typ,
                ueber_vorlage_id: None,
                funkrufname: None,
                tz_fachaufgabe: None,
                tz_organisation: None,
                soll: None,
                bemerkung: None,
                sortier: 0,
            },
        )
        .await
        .unwrap();
    }
    let treffer = suche(&pool, &w, "seg musterstadt").await;
    assert_eq!(treffer.len(), TREFFER_MAX);
    assert_eq!(treffer[0].name, "SEG Musterstadt 00");
    assert_eq!(treffer[9].name, "SEG Musterstadt 09");
}

#[tokio::test]
async fn buchen_bildet_zug_und_gruppe_und_bucht_beide_ein_mit_einem_etb_eintrag() {
    let pool = test_pool().await;
    let w = welt(&pool).await;
    let etb_vorher = zahl(
        &pool,
        "SELECT COUNT(*) FROM etb_eintrag WHERE einsatz_id = ?",
        w.einsatz,
    )
    .await;
    let g = buche(&pool, &w, w.zug).await.unwrap();

    let einheiten: Vec<(i64, String, Option<i64>, Option<String>)> = sqlx::query_as(
        "SELECT id, name, aktueller_br_id, uebernahme_offen_seit FROM einsatz_einheit \
         WHERE einsatz_id = ? ORDER BY id",
    )
    .bind(w.einsatz)
    .fetch_all(&pool)
    .await
    .unwrap();
    assert_eq!(
        einheiten
            .iter()
            .map(|e| (e.1.as_str(), e.2, e.3.is_some()))
            .collect::<Vec<_>>(),
        vec![
            ("Florian Musterstadt 1", Some(w.br), false),
            ("1. Gruppe", Some(w.br), false),
        ]
    );
    assert_eq!(g.einheit_id, Some(einheiten[0].0));
    assert_eq!(g.gebildet.untereinheiten, vec![einheiten[1].0]);
    assert_eq!(g.gebildet.fahrzeuge.len(), 2);
    assert_eq!(g.meldung_id, None);
    assert_eq!(g.zeitachse, EintreffenZeitachse::Geschrieben);
    // Beide Einheiten tragen ein Eintreffen mit Quelle `bereitstellungsraum`.
    assert_eq!(
        zahl(
            &pool,
            "SELECT COUNT(*) FROM einsatz_kraft_zeitachse WHERE einsatz_id = ? \
             AND art = 'eintreffen' AND quelle = 'bereitstellungsraum'",
            w.einsatz
        )
        .await,
        2
    );
    // Die Fahrzeuge gehören ihren Einheiten an, die Stammbesetzung kam nicht mit (D3).
    let fahrzeuge: Vec<(Option<i64>, i64)> = sqlx::query_as(
        "SELECT fahrzeug_id, einheit_id FROM einsatz_fahrzeug WHERE einsatz_id = ? ORDER BY id",
    )
    .bind(w.einsatz)
    .fetch_all(&pool)
    .await
    .unwrap();
    assert_eq!(
        fahrzeuge,
        vec![(Some(w.elw), einheiten[0].0), (Some(w.hlf), einheiten[1].0)]
    );
    assert_eq!(
        zahl(
            &pool,
            "SELECT COUNT(*) FROM einsatz_personal WHERE einsatz_id = ?",
            w.einsatz
        )
        .await,
        0
    );
    // Genau ein ETB-Eintrag, keine Meldung (D4).
    let texte: Vec<String> =
        sqlx::query_scalar("SELECT inhalt FROM etb_eintrag WHERE einsatz_id = ? ORDER BY id")
            .bind(w.einsatz)
            .fetch_all(&pool)
            .await
            .unwrap();
    assert_eq!(texte.len() as i64, etb_vorher + 1);
    assert_eq!(
        texte.last().unwrap(),
        "Florian Musterstadt 1 im BR Sportplatz eingetroffen (aus den Stammdaten; mit 1. Gruppe; \
         Fahrzeuge 1-10-1, 1-44-1)"
    );
    assert_eq!(
        zahl(
            &pool,
            "SELECT COUNT(*) FROM meldung WHERE einsatz_id = ?",
            w.einsatz
        )
        .await,
        0
    );
    // Nur die Belegung der Wurzel trägt den Idempotenzschlüssel.
    assert_eq!(
        zahl(
            &pool,
            "SELECT COUNT(*) FROM br_belegung WHERE einsatz_id = ? AND client_id = 'c1'",
            w.einsatz
        )
        .await,
        1
    );
}

#[tokio::test]
async fn gebundenes_fahrzeug_bleibt_in_seiner_einheit() {
    let pool = test_pool().await;
    let w = welt(&pool).await;
    let zweiter: i64 = sqlx::query_scalar(
        "INSERT INTO einsatz_einheit (einsatz_id, name) VALUES (?, '2. Zug') RETURNING id",
    )
    .bind(w.einsatz)
    .fetch_one(&pool)
    .await
    .unwrap();
    {
        let mut conn = pool.acquire().await.unwrap();
        let ef = crate::fahrzeug::disposition_repo::disponiere_stamm_tx(
            &mut conn, w.einsatz, 1, w.hlf, w.benutzer,
        )
        .await
        .unwrap()
        .id;
        crate::einheit::mitglied_repo::zuordnen_fahrzeug_tx(
            &mut conn, w.einsatz, zweiter, ef, w.benutzer,
        )
        .await
        .unwrap();
    }
    // Die Suche nennt nur, was mitkommt.
    assert_eq!(
        suche(&pool, &w, "florian").await[0].fahrzeuge,
        vec!["1-10-1".to_string()]
    );
    let g = buche(&pool, &w, w.zug).await.unwrap();
    assert_eq!(g.gebildet.fahrzeuge.len(), 1);
    let einheit_hlf: i64 = sqlx::query_scalar(
        "SELECT einheit_id FROM einsatz_fahrzeug WHERE einsatz_id = ? AND fahrzeug_id = ?",
    )
    .bind(w.einsatz)
    .bind(w.hlf)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(einheit_hlf, zweiter);
}

#[tokio::test]
async fn gleichnamige_kraft_im_einsatz_ist_422_und_nichts_ist_angelegt() {
    let pool = test_pool().await;
    let w = welt(&pool).await;
    sqlx::query(
        "INSERT INTO einsatz_einheit (einsatz_id, name) VALUES (?, 'florian musterstadt 1')",
    )
    .bind(w.einsatz)
    .execute(&pool)
    .await
    .unwrap();
    let fehler = buche(&pool, &w, w.zug).await.unwrap_err();
    assert!(
        matches!(&fehler, AppError::UnprocessableEntity(m) if m.contains("ist schon im Einsatz")),
        "{fehler:?}"
    );
    assert_eq!(
        zahl(
            &pool,
            "SELECT COUNT(*) FROM einsatz_einheit WHERE einsatz_id = ?",
            w.einsatz
        )
        .await,
        1
    );
}

#[tokio::test]
async fn fremde_vorlage_ist_404_und_deaktivierte_422() {
    let pool = test_pool().await;
    let w = welt(&pool).await;
    let fremd = vrepo::create(
        &pool,
        2,
        NewVorlage {
            name: "Fremdzug",
            typ_id: {
                sqlx::query_scalar(
                    "INSERT INTO einheit_typ (org_id, label) VALUES (2, 'Zug') RETURNING id",
                )
                .fetch_one(&pool)
                .await
                .unwrap()
            },
            ueber_vorlage_id: None,
            funkrufname: None,
            tz_fachaufgabe: None,
            tz_organisation: None,
            soll: None,
            bemerkung: None,
            sortier: 0,
        },
    )
    .await
    .unwrap()
    .id;
    assert!(matches!(
        buche(&pool, &w, fremd).await,
        Err(AppError::NotFound)
    ));
    sqlx::query("UPDATE einheit_vorlage SET aktiv = 0 WHERE id = ?")
        .bind(w.zug)
        .execute(&pool)
        .await
        .unwrap();
    assert!(matches!(
        buche(&pool, &w, w.zug).await,
        Err(AppError::UnprocessableEntity(_))
    ));
}
