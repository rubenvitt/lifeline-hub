use super::repo::{self, NewVorlage, VorlagePatch};
use super::{
    normalize_fahrzeug_ids, normalize_material, normalize_personal, MaterialEntry, PersonalEntry,
};
use crate::error::AppError;
use crate::material::MaterialArt;
use crate::staerke::{Staerke, StaerkePosition};
use sqlx::SqlitePool;

async fn org(pool: &SqlitePool, name: &str) -> i64 {
    sqlx::query_scalar("INSERT INTO organisation (name) VALUES (?) RETURNING id")
        .bind(name)
        .fetch_one(pool)
        .await
        .unwrap()
}

/// Einheitstyp mit Soll (oder ohne) in der Org.
async fn typ(pool: &SqlitePool, org_id: i64, label: &str, soll: Option<(i64, i64, i64)>) -> i64 {
    sqlx::query_scalar(
        "INSERT INTO einheit_typ (org_id, label, soll_fuehrer, soll_unterfuehrer, soll_mannschaft) \
         VALUES (?, ?, ?, ?, ?) RETURNING id",
    )
    .bind(org_id)
    .bind(label)
    .bind(soll.map(|s| s.0))
    .bind(soll.map(|s| s.1))
    .bind(soll.map(|s| s.2))
    .fetch_one(pool)
    .await
    .unwrap()
}

async fn fahrzeug(pool: &SqlitePool, org_id: i64, funkrufname: &str) -> i64 {
    sqlx::query_scalar(
        "INSERT INTO fahrzeug (org_id, funkrufname, fahrzeugtyp) VALUES (?, ?, 'RTW') RETURNING id",
    )
    .bind(org_id)
    .bind(funkrufname)
    .fetch_one(pool)
    .await
    .unwrap()
}

async fn person(pool: &SqlitePool, org_id: i64, name: &str) -> i64 {
    sqlx::query_scalar("INSERT INTO personal (org_id, name) VALUES (?, ?) RETURNING id")
        .bind(org_id)
        .bind(name)
        .fetch_one(pool)
        .await
        .unwrap()
}

/// Stamm-Material der Org mit Art und optionaler Bestandsnummer (LLH-1261).
async fn material(
    pool: &SqlitePool,
    org_id: i64,
    bezeichnung: &str,
    art: MaterialArt,
    bestandsnummer: Option<&str>,
) -> i64 {
    sqlx::query_scalar(
        "INSERT INTO material (org_id, bezeichnung, art, bestandsnummer) VALUES (?, ?, ?, ?) \
         RETURNING id",
    )
    .bind(org_id)
    .bind(bezeichnung)
    .bind(art.as_str())
    .bind(bestandsnummer)
    .fetch_one(pool)
    .await
    .unwrap()
}

fn posten(material_id: i64, menge: i64, fahrzeug_id: Option<i64>) -> MaterialEntry {
    MaterialEntry {
        material_id,
        menge,
        fahrzeug_id,
    }
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

fn neu(name: &str, typ_id: i64) -> NewVorlage<'_> {
    NewVorlage {
        name,
        typ_id,
        ueber_vorlage_id: None,
        funkrufname: None,
        tz_fachaufgabe: None,
        tz_organisation: None,
        soll: None,
        bemerkung: None,
        sortier: 0,
    }
}

async fn vorlage(
    pool: &SqlitePool,
    org_id: i64,
    name: &str,
    typ_id: i64,
    ueber: Option<i64>,
) -> i64 {
    repo::create(
        pool,
        org_id,
        NewVorlage {
            ueber_vorlage_id: ueber,
            ..neu(name, typ_id)
        },
    )
    .await
    .unwrap()
    .id
}

fn unter(ueber: Option<i64>) -> VorlagePatch<'static> {
    VorlagePatch {
        ueber_vorlage_id: Some(ueber),
        ..Default::default()
    }
}

fn is_422(e: &AppError) -> bool {
    matches!(e, AppError::UnprocessableEntity(_))
}

fn eintrag(personal_id: i64, fahrzeug_id: Option<i64>) -> PersonalEntry {
    PersonalEntry {
        personal_id,
        fahrzeug_id,
        staerke_position: None,
    }
}

// ── Kopf ─────────────────────────────────────────────────────────────────────────────────────

#[tokio::test]
async fn ohne_eigenes_soll_gilt_das_des_typs() {
    let pool = crate::db::test_pool().await;
    let o = org(&pool, "A").await;
    let zug = typ(&pool, o, "Zug", Some((1, 3, 18))).await;
    let v = repo::create(&pool, o, neu("Sanitätszug Musterstadt", zug))
        .await
        .unwrap();
    assert_eq!(v.typ_label, "Zug");
    assert_eq!(v.soll, Some(Staerke::neu(1, 3, 18)));
    assert!(!v.soll_eigen);
    assert!(v.aktiv);
    assert!(!v.ist_demo);
    assert!(v.fahrzeuge.is_empty() && v.personal.is_empty());

    let eigen = repo::create(
        &pool,
        o,
        NewVorlage {
            soll: Some(Staerke::neu(1, 2, 12)),
            ..neu("Kleiner Zug", zug)
        },
    )
    .await
    .unwrap();
    assert_eq!(eigen.soll, Some(Staerke::neu(1, 2, 12)));
    assert!(eigen.soll_eigen);

    let sonstige = typ(&pool, o, "Sonstige", None).await;
    let ohne = repo::create(&pool, o, neu("Sonderlage", sonstige))
        .await
        .unwrap();
    assert_eq!(
        ohne.soll, None,
        "kein Soll, wo weder Vorlage noch Typ eins tragen"
    );
}

#[tokio::test]
async fn name_doppelt_nur_unter_aktiven_ist_conflict() {
    let pool = crate::db::test_pool().await;
    let o = org(&pool, "A").await;
    let t = typ(&pool, o, "Zug", None).await;
    let erste = vorlage(&pool, o, "SEG", t, None).await;
    let fehler = repo::create(&pool, o, neu("SEG", t)).await.unwrap_err();
    assert!(matches!(fehler, AppError::Conflict(_)), "{fehler:?}");

    // Eine andere Org darf denselben Namen tragen.
    let b = org(&pool, "B").await;
    let tb = typ(&pool, b, "Zug", None).await;
    vorlage(&pool, b, "SEG", tb, None).await;

    let aus = VorlagePatch {
        aktiv: Some(false),
        ..Default::default()
    };
    repo::update(&pool, o, erste, aus).await.unwrap();
    let zweite = vorlage(&pool, o, "SEG", t, None).await;
    let wieder = VorlagePatch {
        aktiv: Some(true),
        ..Default::default()
    };
    let fehler = repo::update(&pool, o, erste, wieder).await.unwrap_err();
    assert!(
        matches!(fehler, AppError::Conflict(_)),
        "Reaktivieren gegen eine aktive Namensvetterin: {fehler:?}"
    );
    assert_ne!(erste, zweite);
}

#[tokio::test]
async fn deaktivierte_fehlt_in_der_aktiven_liste() {
    let pool = crate::db::test_pool().await;
    let o = org(&pool, "A").await;
    let t = typ(&pool, o, "Zug", None).await;
    let a = vorlage(&pool, o, "A-Zug", t, None).await;
    let b = vorlage(&pool, o, "B-Zug", t, None).await;
    let v = repo::update(
        &pool,
        o,
        a,
        VorlagePatch {
            aktiv: Some(false),
            ..Default::default()
        },
    )
    .await
    .unwrap();
    assert!(!v.aktiv);
    let aktiv: Vec<i64> = repo::list(&pool, o, true)
        .await
        .unwrap()
        .iter()
        .map(|v| v.id)
        .collect();
    assert_eq!(aktiv, vec![b]);
    let alle: Vec<(i64, bool)> = repo::list(&pool, o, false)
        .await
        .unwrap()
        .iter()
        .map(|v| (v.id, v.aktiv))
        .collect();
    assert_eq!(alle, vec![(a, false), (b, true)]);
}

#[tokio::test]
async fn patch_setzt_gesendete_felder_und_laesst_den_rest() {
    let pool = crate::db::test_pool().await;
    let o = org(&pool, "A").await;
    let t = typ(&pool, o, "Zug", Some((1, 3, 18))).await;
    let id = repo::create(
        &pool,
        o,
        NewVorlage {
            funkrufname: Some("Musterstadt 11-1"),
            bemerkung: Some("Wache Mitte"),
            soll: Some(Staerke::neu(1, 2, 10)),
            ..neu("Zug", t)
        },
    )
    .await
    .unwrap()
    .id;

    let v = repo::update(
        &pool,
        o,
        id,
        VorlagePatch {
            name: Some("1. Zug"),
            tz_fachaufgabe: Some(Some("rettungswesen")),
            soll_mannschaft: Some(Some(12)),
            bemerkung: Some(None),
            ..Default::default()
        },
    )
    .await
    .unwrap();
    assert_eq!(v.name, "1. Zug");
    assert_eq!(v.tz_fachaufgabe.as_deref(), Some("rettungswesen"));
    assert_eq!(
        v.funkrufname.as_deref(),
        Some("Musterstadt 11-1"),
        "unverändert"
    );
    assert_eq!(v.bemerkung, None, "geleert");
    assert_eq!(
        v.soll,
        Some(Staerke::neu(1, 2, 12)),
        "ein einzelnes Soll-Feld gegen den Effektivzustand"
    );

    let fehler = repo::update(
        &pool,
        o,
        id,
        VorlagePatch {
            soll_fuehrer: Some(None),
            ..Default::default()
        },
    )
    .await
    .unwrap_err();
    assert!(matches!(fehler, AppError::Validation(_)), "{fehler:?}");

    let ohne = repo::update(
        &pool,
        o,
        id,
        VorlagePatch {
            soll_fuehrer: Some(None),
            soll_unterfuehrer: Some(None),
            soll_mannschaft: Some(None),
            ..Default::default()
        },
    )
    .await
    .unwrap();
    assert_eq!(
        ohne.soll,
        Some(Staerke::neu(1, 3, 18)),
        "zurück auf das Typ-Soll"
    );
    assert!(!ohne.soll_eigen);
}

#[tokio::test]
async fn fremder_typ_ist_422_und_fremde_vorlage_404() {
    let pool = crate::db::test_pool().await;
    let a = org(&pool, "A").await;
    let b = org(&pool, "B").await;
    let ta = typ(&pool, a, "Zug", None).await;
    let tb = typ(&pool, b, "Zug", None).await;
    let fehler = repo::create(&pool, a, neu("X", tb)).await.unwrap_err();
    assert!(is_422(&fehler), "{fehler:?}");

    let va = vorlage(&pool, a, "X", ta, None).await;
    let fehler = repo::update(&pool, b, va, VorlagePatch::default())
        .await
        .unwrap_err();
    assert!(matches!(fehler, AppError::NotFound), "{fehler:?}");
    let fehler = repo::update(
        &pool,
        a,
        va,
        VorlagePatch {
            typ_id: Some(tb),
            ..Default::default()
        },
    )
    .await
    .unwrap_err();
    assert!(is_422(&fehler), "{fehler:?}");
    assert!(repo::list(&pool, b, false).await.unwrap().is_empty());
}

#[tokio::test]
async fn ist_demo_liest_die_marke_live() {
    let pool = crate::db::test_pool().await;
    let o = org(&pool, "A").await;
    let t = typ(&pool, o, "Zug", None).await;
    let id = vorlage(&pool, o, "Demo-Zug", t, None).await;
    let kopf: i64 = sqlx::query_scalar(
        "INSERT INTO demo_import (org_id, einsatz_id, bericht) VALUES (?, 99, '{}') RETURNING id",
    )
    .bind(o)
    .fetch_one(&pool)
    .await
    .unwrap();
    sqlx::query(
        "INSERT INTO demo_herkunft (import_id, tabelle, datensatz_id) \
         VALUES (?, 'einheit_vorlage', ?)",
    )
    .bind(kopf)
    .bind(id)
    .execute(&pool)
    .await
    .unwrap();
    assert!(repo::list(&pool, o, true).await.unwrap()[0].ist_demo);
    sqlx::query("DELETE FROM demo_herkunft")
        .execute(&pool)
        .await
        .unwrap();
    assert!(!repo::list(&pool, o, true).await.unwrap()[0].ist_demo);
}

// ── Baum ─────────────────────────────────────────────────────────────────────────────────────

#[tokio::test]
async fn untereinheit_traegt_den_verweis_und_zyklus_ist_422() {
    let pool = crate::db::test_pool().await;
    let o = org(&pool, "A").await;
    let t = typ(&pool, o, "Zug", None).await;
    let zug = vorlage(&pool, o, "Sanitätszug Musterstadt", t, None).await;
    let staffel = vorlage(&pool, o, "Rettungsstaffel", t, Some(zug)).await;
    let trupp = vorlage(&pool, o, "Trupp", t, Some(staffel)).await;

    let liste = repo::list(&pool, o, true).await.unwrap();
    let staffel_v = liste.iter().find(|v| v.id == staffel).unwrap();
    assert_eq!(staffel_v.ueber_vorlage_id, Some(zug));

    for (start, ueber) in [(zug, staffel), (zug, trupp), (zug, zug)] {
        let fehler = repo::update(&pool, o, start, unter(Some(ueber)))
            .await
            .unwrap_err();
        assert!(is_422(&fehler), "{start} unter {ueber}: {fehler:?}");
    }
    let ueber: Option<i64> =
        sqlx::query_scalar("SELECT ueber_vorlage_id FROM einheit_vorlage WHERE id = ?")
            .bind(zug)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(ueber, None, "die Unterstellung bleibt unverändert");

    // Umhängen im Baum ohne Zyklus und Lösen gehen.
    repo::update(&pool, o, trupp, unter(Some(zug)))
        .await
        .unwrap();
    let v = repo::update(&pool, o, trupp, unter(None)).await.unwrap();
    assert_eq!(v.ueber_vorlage_id, None);
}

#[tokio::test]
async fn unterstellung_nur_in_der_eigenen_org() {
    let pool = crate::db::test_pool().await;
    let a = org(&pool, "A").await;
    let b = org(&pool, "B").await;
    let ta = typ(&pool, a, "Zug", None).await;
    let tb = typ(&pool, b, "Zug", None).await;
    let fremd = vorlage(&pool, b, "Fremd", tb, None).await;
    let fehler = repo::create(
        &pool,
        a,
        NewVorlage {
            ueber_vorlage_id: Some(fremd),
            ..neu("X", ta)
        },
    )
    .await
    .unwrap_err();
    assert!(is_422(&fehler), "{fehler:?}");
    let eigen = vorlage(&pool, a, "X", ta, None).await;
    let fehler = repo::update(&pool, a, eigen, unter(Some(fremd)))
        .await
        .unwrap_err();
    assert!(is_422(&fehler), "{fehler:?}");
}

#[tokio::test]
async fn load_tree_liefert_wurzel_und_aktive_nachfahren_auch_bei_korruptem_zyklus() {
    let pool = crate::db::test_pool().await;
    let o = org(&pool, "A").await;
    let t = typ(&pool, o, "Zug", None).await;
    let zug = vorlage(&pool, o, "Zug", t, None).await;
    let staffel = vorlage(&pool, o, "Staffel", t, Some(zug)).await;
    let trupp = vorlage(&pool, o, "Trupp", t, Some(staffel)).await;
    let aus = vorlage(&pool, o, "Ruhend", t, Some(zug)).await;
    let unter_aus = vorlage(&pool, o, "Unter Ruhend", t, Some(aus)).await;
    repo::update(
        &pool,
        o,
        aus,
        VorlagePatch {
            aktiv: Some(false),
            ..Default::default()
        },
    )
    .await
    .unwrap();

    let mut conn = pool.acquire().await.unwrap();
    let ids: Vec<i64> = repo::load_tree_tx(&mut conn, o, zug)
        .await
        .unwrap()
        .iter()
        .map(|v| v.id)
        .collect();
    assert_eq!(ids, vec![zug, staffel, trupp]);
    assert!(
        !ids.contains(&unter_aus),
        "unter einer deaktivierten wird nicht gesucht"
    );

    // Korrupter Zyklus am Validator vorbei: Zug unter Trupp.
    sqlx::query("UPDATE einheit_vorlage SET ueber_vorlage_id = ? WHERE id = ?")
        .bind(trupp)
        .bind(zug)
        .execute(&mut *conn)
        .await
        .unwrap();
    let ids: Vec<i64> = repo::load_tree_tx(&mut conn, o, zug)
        .await
        .unwrap()
        .iter()
        .map(|v| v.id)
        .collect();
    assert_eq!(
        ids,
        vec![zug, staffel, trupp],
        "terminiert, jede Vorlage einmal"
    );
    drop(conn);
    // Auch die Schreibwege terminieren im korrupten Baum.
    let f = fahrzeug(&pool, o, "F 1").await;
    repo::replace_fahrzeuge(&pool, o, staffel, &[f])
        .await
        .unwrap();
    let fehler = repo::replace_fahrzeuge(&pool, o, trupp, &[f])
        .await
        .unwrap_err();
    assert!(is_422(&fehler), "{fehler:?}");

    let b = org(&pool, "B").await;
    let mut conn = pool.acquire().await.unwrap();
    let fehler = repo::load_tree_tx(&mut conn, b, zug).await.unwrap_err();
    assert!(matches!(fehler, AppError::NotFound), "{fehler:?}");
}

// ── Zuordnungen ──────────────────────────────────────────────────────────────────────────────

#[tokio::test]
async fn fahrzeuge_werden_als_ganze_liste_ersetzt_in_ihrer_reihenfolge() {
    let pool = crate::db::test_pool().await;
    let o = org(&pool, "A").await;
    let t = typ(&pool, o, "Zug", None).await;
    let v = vorlage(&pool, o, "Zug", t, None).await;
    let f1 = fahrzeug(&pool, o, "B 1").await;
    let f2 = fahrzeug(&pool, o, "A 2").await;
    let f3 = fahrzeug(&pool, o, "C 3").await;

    let nach = repo::replace_fahrzeuge(&pool, o, v, &[f1, f2])
        .await
        .unwrap();
    let ids: Vec<i64> = nach.fahrzeuge.iter().map(|f| f.fahrzeug_id).collect();
    assert_eq!(ids, vec![f1, f2]);
    assert_eq!(nach.fahrzeuge[0].dienststatus, "in_dienst");
    assert_eq!(nach.fahrzeuge[0].fahrzeugtyp.as_deref(), Some("RTW"));

    let nach = repo::replace_fahrzeuge(&pool, o, v, &[f3, f1])
        .await
        .unwrap();
    let ids: Vec<i64> = nach.fahrzeuge.iter().map(|f| f.fahrzeug_id).collect();
    assert_eq!(ids, vec![f3, f1], "f2 fällt, die neue Reihenfolge gilt");

    let leer = repo::replace_fahrzeuge(&pool, o, v, &[]).await.unwrap();
    assert!(leer.fahrzeuge.is_empty());
}

#[tokio::test]
async fn fremdes_oder_ausser_dienst_gestelltes_fahrzeug_ist_422() {
    let pool = crate::db::test_pool().await;
    let a = org(&pool, "A").await;
    let b = org(&pool, "B").await;
    let t = typ(&pool, a, "Zug", None).await;
    let v = vorlage(&pool, a, "Zug", t, None).await;
    let eigen = fahrzeug(&pool, a, "Eigen").await;
    let fremd = fahrzeug(&pool, b, "Fremd").await;
    let fehler = repo::replace_fahrzeuge(&pool, a, v, &[eigen, fremd])
        .await
        .unwrap_err();
    assert!(is_422(&fehler), "{fehler:?}");
    assert!(
        repo::list(&pool, a, true).await.unwrap()[0]
            .fahrzeuge
            .is_empty(),
        "nichts geändert"
    );

    let aus = fahrzeug(&pool, a, "Aus").await;
    ausser_dienst(&pool, "fahrzeug", aus).await;
    let fehler = repo::replace_fahrzeuge(&pool, a, v, &[aus])
        .await
        .unwrap_err();
    assert!(is_422(&fehler), "{fehler:?}");

    let fehler = repo::replace_fahrzeuge(&pool, b, v, &[fremd])
        .await
        .unwrap_err();
    assert!(
        matches!(fehler, AppError::NotFound),
        "fremde Vorlage: {fehler:?}"
    );
}

#[tokio::test]
async fn spaeter_ausser_dienst_bleibt_und_meldet_den_status() {
    let pool = crate::db::test_pool().await;
    let o = org(&pool, "A").await;
    let t = typ(&pool, o, "Zug", None).await;
    let v = vorlage(&pool, o, "Zug", t, None).await;
    let f = fahrzeug(&pool, o, "F").await;
    let g = fahrzeug(&pool, o, "G").await;
    repo::replace_fahrzeuge(&pool, o, v, &[f]).await.unwrap();
    ausser_dienst(&pool, "fahrzeug", f).await;
    let liste = repo::list(&pool, o, true).await.unwrap();
    assert_eq!(liste[0].fahrzeuge[0].dienststatus, "ausser_dienst");
    // Es darf in der Liste bleiben, wenn die Liste neu geschickt wird.
    let nach = repo::replace_fahrzeuge(&pool, o, v, &[f, g]).await.unwrap();
    assert_eq!(nach.fahrzeuge.len(), 2);
}

#[tokio::test]
async fn fahrzeug_in_zwei_baeumen_nennt_die_andere_vorlage() {
    let pool = crate::db::test_pool().await;
    let o = org(&pool, "A").await;
    let t = typ(&pool, o, "Zug", None).await;
    let a = vorlage(&pool, o, "Zug A", t, None).await;
    let b = vorlage(&pool, o, "Zug B", t, None).await;
    let f = fahrzeug(&pool, o, "Musterstadt 83-1").await;
    repo::replace_fahrzeuge(&pool, o, a, &[f]).await.unwrap();
    let vb = repo::replace_fahrzeuge(&pool, o, b, &[f]).await.unwrap();
    assert_eq!(vb.fahrzeuge[0].auch_in, vec![a]);
    let liste = repo::list(&pool, o, true).await.unwrap();
    let va = liste.iter().find(|v| v.id == a).unwrap();
    assert_eq!(va.fahrzeuge[0].auch_in, vec![b]);

    // Eine deaktivierte Vorlage zählt nicht mit.
    repo::update(
        &pool,
        o,
        b,
        VorlagePatch {
            aktiv: Some(false),
            ..Default::default()
        },
    )
    .await
    .unwrap();
    let liste = repo::list(&pool, o, true).await.unwrap();
    assert!(liste[0].fahrzeuge[0].auch_in.is_empty());
}

#[tokio::test]
async fn fahrzeug_doppelt_im_selben_baum_ist_422() {
    let pool = crate::db::test_pool().await;
    let o = org(&pool, "A").await;
    let t = typ(&pool, o, "Zug", None).await;
    let zug = vorlage(&pool, o, "Zug", t, None).await;
    let staffel = vorlage(&pool, o, "Staffel", t, Some(zug)).await;
    let f = fahrzeug(&pool, o, "ELW").await;
    repo::replace_fahrzeuge(&pool, o, zug, &[f]).await.unwrap();
    let fehler = repo::replace_fahrzeuge(&pool, o, staffel, &[f])
        .await
        .unwrap_err();
    assert!(is_422(&fehler), "{fehler:?}");

    // Umhängen, nach dem es doppelt stünde, ebenso.
    let andere = vorlage(&pool, o, "Andere", t, None).await;
    repo::replace_fahrzeuge(&pool, o, andere, &[f])
        .await
        .unwrap();
    let fehler = repo::update(&pool, o, andere, unter(Some(staffel)))
        .await
        .unwrap_err();
    assert!(is_422(&fehler), "{fehler:?}");
}

#[tokio::test]
async fn umhaengen_prueft_auch_die_stammbesetzung() {
    let pool = crate::db::test_pool().await;
    let o = org(&pool, "A").await;
    let t = typ(&pool, o, "Zug", None).await;
    let zug = vorlage(&pool, o, "Zug", t, None).await;
    let andere = vorlage(&pool, o, "Andere", t, None).await;
    let p = person(&pool, o, "Erika").await;
    repo::replace_personal(&pool, o, zug, &[eintrag(p, None)])
        .await
        .unwrap();
    repo::replace_personal(&pool, o, andere, &[eintrag(p, None)])
        .await
        .unwrap();
    let fehler = repo::update(&pool, o, andere, unter(Some(zug)))
        .await
        .unwrap_err();
    assert!(is_422(&fehler), "{fehler:?}");
}

#[tokio::test]
async fn stammbesetzung_mit_fahrzeug_und_position() {
    let pool = crate::db::test_pool().await;
    let o = org(&pool, "A").await;
    let t = typ(&pool, o, "Zug", None).await;
    let v = vorlage(&pool, o, "Zug", t, None).await;
    let f = fahrzeug(&pool, o, "RTW").await;
    let fremdes_fz = fahrzeug(&pool, o, "Nicht in der Vorlage").await;
    let erika = person(&pool, o, "Erika").await;
    let max = person(&pool, o, "Max").await;
    repo::replace_fahrzeuge(&pool, o, v, &[f]).await.unwrap();

    let nach = repo::replace_personal(
        &pool,
        o,
        v,
        &[
            eintrag(max, None),
            PersonalEntry {
                personal_id: erika,
                fahrzeug_id: Some(f),
                staerke_position: Some(StaerkePosition::Fuehrer),
            },
        ],
    )
    .await
    .unwrap();
    let zeilen: Vec<(i64, Option<i64>, Option<StaerkePosition>)> = nach
        .personal
        .iter()
        .map(|p| (p.personal_id, p.fahrzeug_id, p.staerke_position))
        .collect();
    assert_eq!(
        zeilen,
        vec![
            (erika, Some(f), Some(StaerkePosition::Fuehrer)),
            (max, None, None)
        ],
        "Führer vorn, ohne Position nach Name"
    );

    let fehler = repo::replace_personal(&pool, o, v, &[eintrag(max, Some(fremdes_fz))])
        .await
        .unwrap_err();
    assert!(is_422(&fehler), "Person auf fremdem Fahrzeug: {fehler:?}");

    // Ein Fahrzeug fällt aus der Vorlage → die Bindung der Person fällt mit.
    let nach = repo::replace_fahrzeuge(&pool, o, v, &[]).await.unwrap();
    let erika_zeile = nach
        .personal
        .iter()
        .find(|p| p.personal_id == erika)
        .unwrap();
    assert_eq!(erika_zeile.fahrzeug_id, None);
    assert_eq!(erika_zeile.staerke_position, Some(StaerkePosition::Fuehrer));

    // Neu und außer Dienst → 422; schon zugeordnet und später außer Dienst → bleibt.
    let aus = person(&pool, o, "Aus").await;
    ausser_dienst(&pool, "personal", aus).await;
    let fehler = repo::replace_personal(&pool, o, v, &[eintrag(aus, None)])
        .await
        .unwrap_err();
    assert!(is_422(&fehler), "{fehler:?}");
    ausser_dienst(&pool, "personal", max).await;
    let nach = repo::replace_personal(&pool, o, v, &[eintrag(max, None)])
        .await
        .unwrap();
    assert_eq!(nach.personal.len(), 1);
    assert_eq!(nach.personal[0].dienststatus, "ausser_dienst");
}

#[tokio::test]
async fn person_fremd_oder_doppelt_im_baum_ist_422_und_auch_in_ueber_baeume() {
    let pool = crate::db::test_pool().await;
    let a = org(&pool, "A").await;
    let b = org(&pool, "B").await;
    let t = typ(&pool, a, "Zug", None).await;
    let zug = vorlage(&pool, a, "Zug", t, None).await;
    let staffel = vorlage(&pool, a, "Staffel", t, Some(zug)).await;
    let anderer = vorlage(&pool, a, "Anderer", t, None).await;
    let p = person(&pool, a, "Erika").await;
    let fremd = person(&pool, b, "Fremd").await;

    let fehler = repo::replace_personal(&pool, a, zug, &[eintrag(fremd, None)])
        .await
        .unwrap_err();
    assert!(is_422(&fehler), "{fehler:?}");

    repo::replace_personal(&pool, a, zug, &[eintrag(p, None)])
        .await
        .unwrap();
    let fehler = repo::replace_personal(&pool, a, staffel, &[eintrag(p, None)])
        .await
        .unwrap_err();
    assert!(is_422(&fehler), "{fehler:?}");
    let v = repo::replace_personal(&pool, a, anderer, &[eintrag(p, None)])
        .await
        .unwrap();
    assert_eq!(v.personal[0].auch_in, vec![zug]);
}

#[test]
fn listen_von_aussen_werden_entdoppelt_und_gedeckelt() {
    assert_eq!(
        normalize_fahrzeug_ids(vec![3, 1, 3, 2, 1]).unwrap(),
        vec![3, 1, 2]
    );
    let zu_viele: Vec<i64> = (0..=super::FAHRZEUGE_JE_VORLAGE_MAX as i64).collect();
    assert!(matches!(
        normalize_fahrzeug_ids(zu_viele),
        Err(AppError::Validation(_))
    ));
    let genau: Vec<i64> = (0..super::FAHRZEUGE_JE_VORLAGE_MAX as i64).collect();
    assert!(normalize_fahrzeug_ids(genau).is_ok());

    let doppelt = normalize_personal(vec![
        eintrag(1, Some(5)),
        eintrag(2, None),
        eintrag(1, None),
    ])
    .unwrap();
    assert_eq!(doppelt, vec![eintrag(1, Some(5)), eintrag(2, None)]);
    let zu_viele: Vec<PersonalEntry> = (0..=super::PERSONAL_JE_VORLAGE_MAX as i64)
        .map(|i| eintrag(i, None))
        .collect();
    assert!(matches!(
        normalize_personal(zu_viele),
        Err(AppError::Validation(_))
    ));
}

// ── Material (LLH-1261) ──────────────────────────────────────────────────────────────────────

#[tokio::test]
async fn material_wird_als_ganze_liste_ersetzt_mit_ort_und_stamm() {
    let pool = crate::db::test_pool().await;
    let o = org(&pool, "A").await;
    let t = typ(&pool, o, "Staffel", None).await;
    let v = vorlage(&pool, o, "Rettungsstaffel", t, None).await;
    let rtw1 = fahrzeug(&pool, o, "RTW 1").await;
    let rtw2 = fahrzeug(&pool, o, "RTW 2").await;
    repo::replace_fahrzeuge(&pool, o, v, &[rtw1, rtw2])
        .await
        .unwrap();
    let decke = material(&pool, o, "Wolldecke", MaterialArt::Verbrauchsgut, None).await;
    let rucksack = material(&pool, o, "Sanitätsrucksack", MaterialArt::Geraet, None).await;
    let se = material(&pool, o, "Stromerzeuger", MaterialArt::Geraet, Some("SE-1")).await;

    let nach = repo::replace_material(
        &pool,
        o,
        v,
        &[
            posten(decke, 50, None),
            posten(rucksack, 1, Some(rtw1)),
            posten(rucksack, 3, Some(rtw2)),
            posten(se, 1, None),
        ],
    )
    .await
    .unwrap();
    let zeilen: Vec<(i64, i64, Option<i64>)> = nach
        .material
        .iter()
        .map(|m| (m.material_id, m.menge, m.fahrzeug_id))
        .collect();
    assert_eq!(
        zeilen,
        vec![
            (decke, 50, None),
            (rucksack, 1, Some(rtw1)),
            (rucksack, 3, Some(rtw2)),
            (se, 1, None)
        ],
        "Reihenfolge der Liste, dasselbe Material zweimal"
    );
    let stromer = &nach.material[3];
    assert_eq!(stromer.bezeichnung, "Stromerzeuger");
    assert_eq!(stromer.art, MaterialArt::Geraet);
    assert_eq!(stromer.bestandsnummer.as_deref(), Some("SE-1"));
    assert_eq!(stromer.dienststatus, "in_dienst");
    assert!(!stromer.ist_demo);
    assert_eq!(nach.material[0].art, MaterialArt::Verbrauchsgut);

    let gelistet = repo::list(&pool, o, true).await.unwrap();
    assert_eq!(gelistet[0].material, nach.material, "Liste liest dasselbe");

    let nach = repo::replace_material(&pool, o, v, &[posten(decke, 20, None)])
        .await
        .unwrap();
    assert_eq!(nach.material.len(), 1);
    assert_eq!(nach.material[0].menge, 20);
    let leer = repo::replace_material(&pool, o, v, &[]).await.unwrap();
    assert!(leer.material.is_empty());
}

#[tokio::test]
async fn material_regeln_sind_422() {
    let pool = crate::db::test_pool().await;
    let a = org(&pool, "A").await;
    let b = org(&pool, "B").await;
    let t = typ(&pool, a, "Zug", None).await;
    let v = vorlage(&pool, a, "Zug", t, None).await;
    let fz = fahrzeug(&pool, a, "Nicht in der Vorlage").await;
    let decke = material(&pool, a, "Wolldecke", MaterialArt::Verbrauchsgut, None).await;
    let rucksack = material(&pool, a, "Rucksack", MaterialArt::Geraet, None).await;
    let se = material(&pool, a, "Stromerzeuger", MaterialArt::Geraet, Some("SE-1")).await;
    let fremd = material(&pool, b, "Fremd", MaterialArt::Geraet, None).await;
    let aus = material(&pool, a, "Aus", MaterialArt::Verbrauchsgut, None).await;
    ausser_dienst(&pool, "material", aus).await;

    for (liste, was) in [
        (vec![posten(fremd, 1, None)], "fremdes Material"),
        (vec![posten(4711, 1, None)], "unbekanntes Material"),
        (vec![posten(aus, 5, None)], "neu und außer Dienst"),
        (
            vec![posten(decke, 5, Some(fz))],
            "Fahrzeug außerhalb der Vorlage",
        ),
        (vec![posten(rucksack, 11, None)], "Gerät über 10"),
        (vec![posten(se, 2, None)], "Bestandsnummer mit Menge 2"),
        (
            vec![posten(se, 1, None), posten(se, 1, None)],
            "Bestandsnummer zweimal in der Liste",
        ),
    ] {
        let fehler = repo::replace_material(&pool, a, v, &liste)
            .await
            .unwrap_err();
        assert!(is_422(&fehler), "{was}: {fehler:?}");
    }
    let stand = repo::replace_material(&pool, a, v, &[posten(rucksack, 10, None)])
        .await
        .expect("Gerät mit Menge 10");
    assert_eq!(stand.material[0].menge, 10);
    let fehler = repo::replace_material(&pool, b, v, &[]).await.unwrap_err();
    assert!(matches!(fehler, AppError::NotFound), "{fehler:?}");
}

#[tokio::test]
async fn material_spaeter_ausser_dienst_bleibt_speicherbar() {
    let pool = crate::db::test_pool().await;
    let o = org(&pool, "A").await;
    let t = typ(&pool, o, "Zug", None).await;
    let v = vorlage(&pool, o, "Zug", t, None).await;
    let decke = material(&pool, o, "Wolldecke", MaterialArt::Verbrauchsgut, None).await;
    repo::replace_material(&pool, o, v, &[posten(decke, 50, None)])
        .await
        .unwrap();
    ausser_dienst(&pool, "material", decke).await;
    let nach = repo::replace_material(&pool, o, v, &[posten(decke, 40, None)])
        .await
        .unwrap();
    assert_eq!(nach.material[0].dienststatus, "ausser_dienst");
    assert_eq!(nach.material[0].menge, 40);
}

#[tokio::test]
async fn geraet_mit_bestandsnummer_einmal_im_baum() {
    let pool = crate::db::test_pool().await;
    let o = org(&pool, "A").await;
    let t = typ(&pool, o, "Zug", None).await;
    let zug = vorlage(&pool, o, "Zug", t, None).await;
    let staffel = vorlage(&pool, o, "Staffel", t, Some(zug)).await;
    let anderer = vorlage(&pool, o, "Anderer", t, None).await;
    let se = material(&pool, o, "Stromerzeuger", MaterialArt::Geraet, Some("SE-1")).await;
    let decke = material(&pool, o, "Wolldecke", MaterialArt::Verbrauchsgut, None).await;

    repo::replace_material(
        &pool,
        o,
        zug,
        &[posten(se, 1, None), posten(decke, 5, None)],
    )
    .await
    .unwrap();
    let fehler = repo::replace_material(&pool, o, staffel, &[posten(se, 1, None)])
        .await
        .unwrap_err();
    assert!(is_422(&fehler), "{fehler:?}");
    repo::replace_material(&pool, o, staffel, &[posten(decke, 5, None)])
        .await
        .expect("Verbrauchsgut darf im Baum mehrfach stehen");
    repo::replace_material(&pool, o, anderer, &[posten(se, 1, None)])
        .await
        .expect("in einem anderen Baum erlaubt");

    // Umhängen prüft das Material mit: „Anderer“ unter den Zug brächte SE-1 zweimal in den Baum.
    let fehler = repo::update(&pool, o, anderer, unter(Some(zug)))
        .await
        .unwrap_err();
    assert!(is_422(&fehler), "{fehler:?}");
}

#[tokio::test]
async fn fahrzeug_aus_der_vorlage_legt_sein_material_an_die_einheit() {
    let pool = crate::db::test_pool().await;
    let o = org(&pool, "A").await;
    let t = typ(&pool, o, "Staffel", None).await;
    let v = vorlage(&pool, o, "Staffel", t, None).await;
    let rtw1 = fahrzeug(&pool, o, "RTW 1").await;
    let rtw2 = fahrzeug(&pool, o, "RTW 2").await;
    repo::replace_fahrzeuge(&pool, o, v, &[rtw1, rtw2])
        .await
        .unwrap();
    let rucksack = material(&pool, o, "Rucksack", MaterialArt::Geraet, None).await;
    repo::replace_material(
        &pool,
        o,
        v,
        &[
            posten(rucksack, 1, Some(rtw1)),
            posten(rucksack, 1, Some(rtw2)),
        ],
    )
    .await
    .unwrap();
    let nach = repo::replace_fahrzeuge(&pool, o, v, &[rtw2]).await.unwrap();
    let orte: Vec<Option<i64>> = nach.material.iter().map(|m| m.fahrzeug_id).collect();
    assert_eq!(orte, vec![None, Some(rtw2)]);
}

#[test]
fn material_von_aussen_wird_gedeckelt_und_menge_geprueft() {
    let genau: Vec<MaterialEntry> = (0..super::MATERIAL_JE_VORLAGE_MAX as i64)
        .map(|i| posten(i, 1, None))
        .collect();
    assert_eq!(normalize_material(genau.clone()).unwrap(), genau);
    let zu_viele: Vec<MaterialEntry> = (0..=super::MATERIAL_JE_VORLAGE_MAX as i64)
        .map(|i| posten(i, 1, None))
        .collect();
    assert!(matches!(
        normalize_material(zu_viele),
        Err(AppError::Validation(_))
    ));
    assert!(matches!(
        normalize_material(vec![posten(1, 0, None)]),
        Err(AppError::Validation(_))
    ));
    let hoechst = super::MENGE_JE_POSITION_MAX;
    assert!(normalize_material(vec![posten(1, hoechst, None)]).is_ok());
    assert!(matches!(
        normalize_material(vec![posten(1, hoechst + 1, None)]),
        Err(AppError::Validation(_))
    ));
    let doppelt = vec![posten(1, 1, None), posten(1, 2, None)];
    assert_eq!(
        normalize_material(doppelt.clone()).unwrap(),
        doppelt,
        "dasselbe Material darf mehrfach stehen"
    );
}
