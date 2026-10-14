//! Planung und Bilden aus einer Einheiten-Vorlage (LLH-1049, design.md D2–D9).

use super::*;
use crate::einheit_vorlage::repo::{self as vrepo, NewVorlage, VorlagePatch};
use crate::einheit_vorlage::PersonalEntry;
use crate::katalog::KATEGORIE_GEBUNDEN;
use crate::personal::status_repo::{self, StatusDaten};
use sqlx::SqlitePool;

/// Der Demo-„Sanitätszug Musterstadt“ mit „Rettungsstaffel“ als Vorlage (Stamm-IDs).
struct Zug {
    k: Kontext,
    zug: i64,
    staffel: i64,
    typ_staffel: i64,
    elw: i64,
    rtw1: i64,
    rtw2: i64,
    zugfuehrer: i64,
    funker: i64,
    notarzt: i64,
    notsan: i64,
    rettsan1: i64,
    rettsan2: i64,
}

async fn person(pool: &SqlitePool, org: i64, name: &str) -> i64 {
    sqlx::query_scalar("INSERT INTO personal (org_id, name) VALUES (?, ?) RETURNING id")
        .bind(org)
        .bind(name)
        .fetch_one(pool)
        .await
        .unwrap()
}

async fn fahrzeug(pool: &SqlitePool, org: i64, funkrufname: &str) -> i64 {
    sqlx::query_scalar(
        "INSERT INTO fahrzeug (org_id, funkrufname, fahrzeugtyp) VALUES (?, ?, 'RTW') RETURNING id",
    )
    .bind(org)
    .bind(funkrufname)
    .fetch_one(pool)
    .await
    .unwrap()
}

async fn typ(pool: &SqlitePool, org: i64, label: &str, soll: (i64, i64, i64)) -> i64 {
    sqlx::query_scalar(
        "INSERT INTO einheit_typ (org_id, label, soll_fuehrer, soll_unterfuehrer, soll_mannschaft) \
         VALUES (?, ?, ?, ?, ?) RETURNING id",
    )
    .bind(org)
    .bind(label)
    .bind(soll.0)
    .bind(soll.1)
    .bind(soll.2)
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

fn neu_vorlage(name: &str, typ_id: i64) -> NewVorlage<'_> {
    NewVorlage {
        name,
        typ_id,
        ueber_vorlage_id: None,
        funkrufname: None,
        tz_fachaufgabe: Some("rettungswesen"),
        tz_organisation: Some("hilfsorganisation"),
        soll: None,
        bemerkung: Some("Stammdaten-Notiz"),
        sortier: 0,
    }
}

fn eintrag(p: i64, f: Option<i64>, s: Option<StaerkePosition>) -> PersonalEntry {
    PersonalEntry {
        personal_id: p,
        fahrzeug_id: f,
        staerke_position: s,
    }
}

async fn setup(pool: &SqlitePool) -> Zug {
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
    let typ_zug = typ(pool, 1, "Zug", (1, 3, 18)).await;
    let typ_staffel = typ(pool, 1, "Staffel", (0, 1, 5)).await;
    let zug = vrepo::create(
        pool,
        1,
        NewVorlage {
            funkrufname: Some("Rotkreuz Musterstadt 1"),
            soll: Some(Staerke {
                fuehrer: 1,
                unterfuehrer: 2,
                mannschaft: 10,
            }),
            sortier: 10,
            ..neu_vorlage("Sanitätszug Musterstadt", typ_zug)
        },
    )
    .await
    .unwrap()
    .id;
    let staffel = vrepo::create(
        pool,
        1,
        NewVorlage {
            ueber_vorlage_id: Some(zug),
            funkrufname: Some("Rotkreuz Musterstadt 1/83"),
            sortier: 20,
            ..neu_vorlage("Rettungsstaffel", typ_staffel)
        },
    )
    .await
    .unwrap()
    .id;
    let elw = fahrzeug(pool, 1, "ELW 1").await;
    let rtw1 = fahrzeug(pool, 1, "RTW 1").await;
    let rtw2 = fahrzeug(pool, 1, "RTW 2").await;
    let zugfuehrer = person(pool, 1, "Zugführer Zander").await;
    let funker = person(pool, 1, "Funker Fritz").await;
    let notarzt = person(pool, 1, "Notarzt Nora").await;
    let notsan = person(pool, 1, "Notsan Nils").await;
    let rettsan1 = person(pool, 1, "Rettsan Rita").await;
    let rettsan2 = person(pool, 1, "Rettsan Rolf").await;
    vrepo::replace_fahrzeuge(pool, 1, zug, &[elw])
        .await
        .unwrap();
    vrepo::replace_fahrzeuge(pool, 1, staffel, &[rtw1, rtw2])
        .await
        .unwrap();
    vrepo::replace_personal(
        pool,
        1,
        zug,
        &[
            eintrag(zugfuehrer, Some(elw), Some(StaerkePosition::Fuehrer)),
            eintrag(funker, Some(elw), None),
        ],
    )
    .await
    .unwrap();
    vrepo::replace_personal(
        pool,
        1,
        staffel,
        &[
            eintrag(notarzt, Some(rtw1), Some(StaerkePosition::Unterfuehrer)),
            eintrag(notsan, Some(rtw1), None),
            eintrag(rettsan1, Some(rtw2), None),
            eintrag(rettsan2, Some(rtw2), None),
        ],
    )
    .await
    .unwrap();
    Zug {
        k: Kontext {
            einsatz_id,
            org_id: 1,
            benutzer_id,
        },
        zug,
        staffel,
        typ_staffel,
        elw,
        rtw1,
        rtw2,
        zugfuehrer,
        funker,
        notarzt,
        notsan,
        rettsan1,
        rettsan2,
    }
}

const ALLES: Lesen = Lesen {
    fahrzeuge: true,
    personal: true,
};

/// Für [`vorschau`]: kein Modul gesperrt.
const NICHTS_GESPERRT: Lesen = Lesen {
    fahrzeuge: false,
    personal: false,
};

async fn plane(pool: &SqlitePool, z: &Zug, vorlage: i64) -> Result<Plan, AppError> {
    let mut conn = pool.acquire().await.unwrap();
    plane_tx(&mut conn, z.k.einsatz_id, z.k.org_id, vorlage, ALLES).await
}

async fn einheit(pool: &SqlitePool, einsatz: i64, name: &str) -> i64 {
    sqlx::query_scalar("INSERT INTO einsatz_einheit (einsatz_id, name) VALUES (?, ?) RETURNING id")
        .bind(einsatz)
        .bind(name)
        .fetch_one(pool)
        .await
        .unwrap()
}

/// Stamm-Fahrzeug disponieren und optional einer Einheit zuordnen; liefert die `ef_id`.
async fn im_einsatz_fahrzeug(pool: &SqlitePool, k: Kontext, fid: i64, e: Option<i64>) -> i64 {
    let mut conn = pool.acquire().await.unwrap();
    let ef = crate::fahrzeug::disposition_repo::disponiere_stamm_tx(
        &mut conn,
        k.einsatz_id,
        k.org_id,
        fid,
        k.benutzer_id,
    )
    .await
    .unwrap();
    if let Some(e) = e {
        mitglied_repo::ordne_fahrzeug_zu_tx(&mut conn, k.einsatz_id, e, ef)
            .await
            .unwrap();
    }
    ef
}

/// Stamm-Person disponieren, optional mit Position, Einheit und Fahrzeug; liefert die `ep_id`.
async fn im_einsatz_person(
    pool: &SqlitePool,
    k: Kontext,
    pid: i64,
    position: Option<&str>,
    e: Option<i64>,
    ef: Option<i64>,
) -> i64 {
    let mut conn = pool.acquire().await.unwrap();
    let d = crate::personal::disposition_repo::disponieren_stamm_tx(
        &mut conn,
        k.einsatz_id,
        k.org_id,
        pid,
        position,
        k.benutzer_id,
    )
    .await
    .unwrap();
    if let Some(e) = e {
        mitglied_repo::ordne_personal_zu_tx(&mut conn, k.einsatz_id, e, d.id)
            .await
            .unwrap();
    }
    if let Some(ef) = ef {
        besatzung_repo::ordne_besatzung_zu_tx(&mut conn, k.einsatz_id, ef, d.id)
            .await
            .unwrap();
    }
    d.id
}

fn wahl(ids: &[i64]) -> Vec<Wahl> {
    ids.iter()
        .map(|&id| Wahl {
            id,
            umhaengen: false,
        })
        .collect()
}

async fn bilde(pool: &SqlitePool, z: &Zug, anfrage: &Anfrage<'_>) -> Result<Gebildet, AppError> {
    let mut tx = pool.begin().await.unwrap();
    let plan = plane_tx(&mut tx, z.k.einsatz_id, z.k.org_id, z.zug, ALLES).await?;
    let g = bilde_tx(&mut tx, z.k, &plan, anfrage).await?;
    tx.commit().await.unwrap();
    Ok(g)
}

fn anfrage<'a>(fahrzeuge: &'a [Wahl], personal: &'a [Wahl]) -> Anfrage<'a> {
    Anfrage {
        name: None,
        abschnitt_id: None,
        fahrzeuge,
        personal,
    }
}

async fn zaehle(pool: &SqlitePool, sql: &str, einsatz: i64) -> i64 {
    sqlx::query_scalar(sqlx::AssertSqlSafe(sql.to_string()))
        .bind(einsatz)
        .fetch_one(pool)
        .await
        .unwrap()
}

// ── 2.1 Knoten ───────────────────────────────────────────────────────────────────────────────

#[tokio::test]
async fn plan_traegt_den_aktiven_baum_wurzel_vorn() {
    let pool = crate::db::test_pool().await;
    let z = setup(&pool).await;
    let plan = plane(&pool, &z, z.zug).await.unwrap();
    let ids: Vec<i64> = plan.knoten.iter().map(|k| k.id).collect();
    assert_eq!(ids, [z.zug, z.staffel]);
    let v = vorschau(
        &plan,
        Lesen {
            fahrzeuge: false,
            personal: false,
        },
    );
    assert_eq!(v.vorlage_id, z.zug);
    assert_eq!(v.knoten[0].ueber_vorlage_id, None);
    assert_eq!(v.knoten[1].ueber_vorlage_id, Some(z.zug));

    // Eine Untervorlage ist allein bildbar: sie ist dann selbst die Wurzel.
    let plan = plane(&pool, &z, z.staffel).await.unwrap();
    let v = vorschau(
        &plan,
        Lesen {
            fahrzeuge: false,
            personal: false,
        },
    );
    assert_eq!(v.knoten.len(), 1);
    assert_eq!(v.knoten[0].ueber_vorlage_id, None);
}

#[tokio::test]
async fn fremde_unbekannte_und_deaktivierte_vorlagen() {
    let pool = crate::db::test_pool().await;
    let z = setup(&pool).await;
    let fremd_typ = typ(&pool, 2, "Zug", (1, 3, 18)).await;
    let fremd = vrepo::create(&pool, 2, neu_vorlage("Fremdzug", fremd_typ))
        .await
        .unwrap()
        .id;
    assert!(matches!(
        plane(&pool, &z, fremd).await,
        Err(AppError::NotFound)
    ));
    assert!(matches!(
        plane(&pool, &z, 987654).await,
        Err(AppError::NotFound)
    ));

    // Eine deaktivierte Untereinheit fällt aus dem Baum, eine deaktivierte Wurzel ist 422.
    let patch = VorlagePatch {
        aktiv: Some(false),
        ..Default::default()
    };
    vrepo::update(&pool, 1, z.staffel, patch).await.unwrap();
    let plan = plane(&pool, &z, z.zug).await.unwrap();
    assert_eq!(plan.knoten.len(), 1);
    vrepo::update(&pool, 1, z.zug, patch).await.unwrap();
    match plane(&pool, &z, z.zug).await {
        Err(AppError::UnprocessableEntity(m)) => assert!(m.contains("deaktiviert"), "{m}"),
        andere => panic!("erwartet 422: {andere:?}"),
    }
}

#[tokio::test]
async fn mehr_als_zwanzig_einheiten_sind_422() {
    let pool = crate::db::test_pool().await;
    let z = setup(&pool).await;
    // Der Zug hat schon die Staffel: 18 weitere Untereinheiten ergeben 20 Knoten.
    for i in 0..18 {
        let name = format!("Trupp {i}");
        vrepo::create(
            &pool,
            1,
            NewVorlage {
                ueber_vorlage_id: Some(z.zug),
                ..neu_vorlage(&name, z.typ_staffel)
            },
        )
        .await
        .unwrap();
    }
    assert_eq!(
        plane(&pool, &z, z.zug).await.unwrap().knoten.len(),
        KNOTEN_MAX
    );
    vrepo::create(
        &pool,
        1,
        NewVorlage {
            ueber_vorlage_id: Some(z.staffel),
            ..neu_vorlage("Trupp 21", z.typ_staffel)
        },
    )
    .await
    .unwrap();
    match plane(&pool, &z, z.zug).await {
        Err(AppError::UnprocessableEntity(m)) => {
            assert_eq!(m, "Vorlage hat mehr als 20 Einheiten")
        }
        andere => panic!("erwartet 422: {andere:?}"),
    }
}

// ── 2.2 Fahrzeugzeilen ───────────────────────────────────────────────────────────────────────

#[test]
fn fahrzeug_zustand_je_fall() {
    use VorschauZustand::*;
    assert_eq!(fahrzeug_zustand(true, None), Neu);
    assert_eq!(fahrzeug_zustand(false, None), AusserDienst);
    assert_eq!(fahrzeug_zustand(true, Some((false, false))), Frei);
    assert_eq!(fahrzeug_zustand(true, Some((false, true))), Gebunden);
    // Schon im Einsatz zählt vor dem Stamm: ein inzwischen außer Dienst gestelltes bleibt.
    assert_eq!(fahrzeug_zustand(false, Some((false, false))), Frei);
    assert_eq!(fahrzeug_zustand(true, Some((true, false))), Entlassen);
    assert_eq!(fahrzeug_zustand(false, Some((true, false))), AusserDienst);
}

#[tokio::test]
async fn fahrzeugzeilen_nennen_zustand_und_einheit() {
    let pool = crate::db::test_pool().await;
    let z = setup(&pool).await;
    let zweiter = einheit(&pool, z.k.einsatz_id, "2. Zug").await;
    let ef1 = im_einsatz_fahrzeug(&pool, z.k, z.rtw1, None).await;
    let ef2 = im_einsatz_fahrzeug(&pool, z.k, z.rtw2, Some(zweiter)).await;
    ausser_dienst(&pool, "fahrzeug", z.elw).await;

    let plan = plane(&pool, &z, z.zug).await.unwrap();
    let elw = &plan.fahrzeuge[&z.elw];
    assert_eq!(elw.zustand, VorschauZustand::AusserDienst);
    assert_eq!(elw.ef_id, None);
    let r1 = &plan.fahrzeuge[&z.rtw1];
    assert_eq!((r1.zustand, r1.ef_id), (VorschauZustand::Frei, Some(ef1)));
    let r2 = &plan.fahrzeuge[&z.rtw2];
    assert_eq!(r2.zustand, VorschauZustand::Gebunden);
    assert_eq!(
        r2.einheit,
        Some(Bezug {
            id: zweiter,
            name: "2. Zug".into()
        })
    );
    let v = vorschau(
        &plan,
        Lesen {
            fahrzeuge: false,
            personal: false,
        },
    );
    let rtw2 = &v.knoten[1].fahrzeuge[1];
    assert_eq!(rtw2.funkrufname, "RTW 2");
    assert_eq!(rtw2.ef_id, Some(ef2));
    assert_eq!(rtw2.einheit_name.as_deref(), Some("2. Zug"));

    // Eine aufgelöste Einheit zählt nicht: das Fahrzeug gilt als frei.
    sqlx::query("UPDATE einsatz_einheit SET aufgeloest_at = datetime('now') WHERE id = ?")
        .bind(zweiter)
        .execute(&pool)
        .await
        .unwrap();
    let plan = plane(&pool, &z, z.zug).await.unwrap();
    assert_eq!(plan.fahrzeuge[&z.rtw2].zustand, VorschauZustand::Frei);
    assert_eq!(plan.fahrzeuge[&z.rtw2].einheit, None);
}

#[tokio::test]
async fn gesperrte_module_bleiben_in_der_vorschau_leer() {
    let pool = crate::db::test_pool().await;
    let z = setup(&pool).await;
    let mut conn = pool.acquire().await.unwrap();
    let gesperrt = Lesen {
        fahrzeuge: true,
        personal: false,
    };
    let plan = plane_tx(
        &mut conn,
        z.k.einsatz_id,
        1,
        z.zug,
        Lesen {
            fahrzeuge: !gesperrt.fahrzeuge,
            personal: !gesperrt.personal,
        },
    )
    .await
    .unwrap();
    assert!(plan.fahrzeuge.is_empty());
    assert_eq!(plan.personal.len(), 6);
    let v = vorschau(&plan, gesperrt);
    assert!(v.fahrzeuge_gesperrt && !v.personal_gesperrt);
    assert!(v.knoten.iter().all(|k| k.fahrzeuge.is_empty()));
    assert_eq!(v.knoten[1].personal.len(), 4);
}

// ── 2.3 Personenzeilen ───────────────────────────────────────────────────────────────────────

#[test]
fn personal_zustand_je_fall() {
    use VorschauZustand::*;
    assert_eq!(personal_zustand(true, None), Neu);
    assert_eq!(personal_zustand(false, None), AusserDienst);
    assert_eq!(personal_zustand(true, Some((None, false))), Frei);
    assert_eq!(personal_zustand(true, Some((None, true))), Gebunden);
    assert_eq!(personal_zustand(false, Some((None, false))), Frei);
    assert_eq!(
        personal_zustand(true, Some((Some("entlassen"), false))),
        Entlassen
    );
    assert_eq!(
        personal_zustand(true, Some((Some("storniert"), false))),
        Neu
    );
    assert_eq!(
        personal_zustand(false, Some((Some("entlassen"), false))),
        AusserDienst
    );
    assert_eq!(
        personal_zustand(false, Some((Some("storniert"), false))),
        AusserDienst
    );
}

#[tokio::test]
async fn personenzeilen_nennen_zustand_einheit_und_fahrzeug() {
    let pool = crate::db::test_pool().await;
    let z = setup(&pool).await;
    let zweiter = einheit(&pool, z.k.einsatz_id, "2. Zug").await;
    let fremd_fz = fahrzeug(&pool, 1, "83-4").await;
    let ef_fremd = im_einsatz_fahrzeug(&pool, z.k, fremd_fz, None).await;
    let ep_frei = im_einsatz_person(&pool, z.k, z.funker, None, None, None).await;
    im_einsatz_person(&pool, z.k, z.notarzt, None, Some(zweiter), None).await;
    im_einsatz_person(&pool, z.k, z.notsan, None, None, Some(ef_fremd)).await;
    let ep_entlassen = im_einsatz_person(&pool, z.k, z.rettsan1, None, None, None).await;
    let ep_storniert = im_einsatz_person(&pool, z.k, z.rettsan2, None, None, None).await;
    ausser_dienst(&pool, "personal", z.zugfuehrer).await;
    {
        let mut conn = pool.acquire().await.unwrap();
        crate::personal::disposition_repo::entlassen_tx(
            &mut conn,
            z.k.einsatz_id,
            ep_entlassen,
            z.k.benutzer_id,
            &crate::zeit::jetzt(),
        )
        .await
        .unwrap();
        sqlx::query(
            "UPDATE einsatz_personal SET beendet_at = datetime('now'), beendet_von = ?, \
             beendet_als = 'storniert' WHERE id = ?",
        )
        .bind(z.k.benutzer_id)
        .bind(ep_storniert)
        .execute(&mut *conn)
        .await
        .unwrap();
    }

    let plan = plane(&pool, &z, z.zug).await.unwrap();
    let lage = |id: i64| plan.personal[&id].clone();
    assert_eq!(lage(z.zugfuehrer).zustand, VorschauZustand::AusserDienst);
    let frei = lage(z.funker);
    assert_eq!(
        (frei.zustand, frei.ep_id),
        (VorschauZustand::Frei, Some(ep_frei))
    );
    let in_einheit = lage(z.notarzt);
    assert_eq!(in_einheit.zustand, VorschauZustand::Gebunden);
    assert_eq!(in_einheit.einheit.unwrap().name, "2. Zug");
    let auf_fahrzeug = lage(z.notsan);
    assert_eq!(auf_fahrzeug.zustand, VorschauZustand::Gebunden);
    assert_eq!(auf_fahrzeug.einheit, None);
    assert_eq!(
        auf_fahrzeug.fahrzeug,
        Some(Bezug {
            id: ef_fremd,
            name: "83-4".into()
        })
    );
    let entlassen = lage(z.rettsan1);
    assert_eq!(
        (entlassen.zustand, entlassen.ep_id),
        (VorschauZustand::Entlassen, None)
    );
    assert_eq!(lage(z.rettsan2).zustand, VorschauZustand::Neu);

    let v = vorschau(
        &plan,
        Lesen {
            fahrzeuge: false,
            personal: false,
        },
    );
    let zf = &v.knoten[0].personal[0];
    assert_eq!(zf.name, "Zugführer Zander");
    assert_eq!(zf.staerke_position, Some(StaerkePosition::Fuehrer));
    assert_eq!(zf.fahrzeug_id, Some(z.elw));
    let ns = v.knoten[1]
        .personal
        .iter()
        .find(|p| p.personal_id == z.notsan)
        .unwrap();
    assert_eq!(ns.fahrzeug_name.as_deref(), Some("83-4"));
    assert_eq!(ns.ef_id, Some(ef_fremd));
}

// ── 2.4 Abgleich ─────────────────────────────────────────────────────────────────────────────

fn lage_f(zustand: VorschauZustand, einheit: Option<&str>) -> FahrzeugLage {
    FahrzeugLage {
        zustand,
        ef_id: None,
        einheit: einheit.map(|n| Bezug {
            id: 9,
            name: n.into(),
        }),
    }
}

fn lage_p(zustand: VorschauZustand, einheit: Option<&str>, fz: Option<&str>) -> PersonalLage {
    PersonalLage {
        zustand,
        ep_id: None,
        einheit: einheit.map(|n| Bezug {
            id: 9,
            name: n.into(),
        }),
        fahrzeug: fz.map(|n| Bezug {
            id: 8,
            name: n.into(),
        }),
    }
}

#[test]
fn abgleich_nennt_je_zeile_den_grund_fahrzeuge_vor_personen() {
    use VorschauZustand::*;
    let plan = Plan {
        knoten: Vec::new(),
        fahrzeuge: HashMap::from([
            (1, lage_f(Neu, None)),
            (2, lage_f(Gebunden, Some("2. Zug"))),
            (3, lage_f(AusserDienst, None)),
            (4, lage_f(Entlassen, None)),
            (5, lage_f(Frei, None)),
        ]),
        personal: HashMap::from([
            (1, lage_p(Neu, None, None)),
            (2, lage_p(Gebunden, None, Some("83-4"))),
            (3, lage_p(AusserDienst, None, None)),
            (4, lage_p(Entlassen, None, None)),
            (6, lage_p(Gebunden, Some("2. Zug"), Some("83-4"))),
        ]),
    };
    let fahrzeuge = [
        Wahl {
            id: 1,
            umhaengen: false,
        },
        Wahl {
            id: 2,
            umhaengen: false,
        },
        Wahl {
            id: 3,
            umhaengen: true,
        },
        Wahl {
            id: 4,
            umhaengen: false,
        },
        Wahl {
            id: 5,
            umhaengen: false,
        },
        Wahl {
            id: 77,
            umhaengen: false,
        },
    ];
    let personal = [
        Wahl {
            id: 6,
            umhaengen: false,
        },
        Wahl {
            id: 2,
            umhaengen: false,
        },
        Wahl {
            id: 3,
            umhaengen: false,
        },
        Wahl {
            id: 4,
            umhaengen: false,
        },
        Wahl {
            id: 1,
            umhaengen: false,
        },
    ];
    let gruende: Vec<(ZeilenArt, i64, String)> = gleiche_ab(&plan, &fahrzeuge, &personal)
        .into_iter()
        .map(|z| (z.art, z.id, z.grund))
        .collect();
    let f = ZeilenArt::Fahrzeug;
    let p = ZeilenArt::Personal;
    assert_eq!(
        gruende,
        vec![
            (f, 2, "in «2. Zug»".to_string()),
            (f, 3, "außer Dienst".to_string()),
            (f, 4, "entlassen".to_string()),
            (f, 77, "nicht in der Vorlage".to_string()),
            (p, 6, "in «2. Zug»".to_string()),
            (p, 2, "auf «83-4»".to_string()),
            (p, 3, "außer Dienst".to_string()),
        ]
    );
    // Mit „umhängen“ ist eine gebundene Kraft übernehmbar.
    let umhaengen = [Wahl {
        id: 2,
        umhaengen: true,
    }];
    assert!(gleiche_ab(&plan, &umhaengen, &umhaengen).is_empty());
}

/// Der Abgleich läuft vor dem ersten Schreiben: eine Ablehnung legt keine Einheit an.
#[tokio::test]
async fn gruende_vor_dem_ersten_schreiben() {
    let pool = crate::db::test_pool().await;
    let z = setup(&pool).await;
    let zweiter = einheit(&pool, z.k.einsatz_id, "2. Zug").await;
    im_einsatz_fahrzeug(&pool, z.k, z.rtw2, Some(zweiter)).await;
    let fahrzeuge = wahl(&[z.elw, z.rtw1, z.rtw2]);
    let personal = wahl(&[z.zugfuehrer]);
    match bilde(&pool, &z, &anfrage(&fahrzeuge, &personal)).await {
        Err(AppError::Zeilen { zeilen, .. }) => {
            assert_eq!(zeilen.len(), 1);
            assert_eq!(
                (zeilen[0].art, zeilen[0].id, zeilen[0].grund.as_str()),
                (ZeilenArt::Fahrzeug, z.rtw2, "in «2. Zug»")
            );
        }
        andere => panic!("erwartet Zeilen: {andere:?}"),
    }
    let einheiten = zaehle(
        &pool,
        "SELECT COUNT(*) FROM einsatz_einheit WHERE einsatz_id = ? AND aufgeloest_at IS NULL",
        z.k.einsatz_id,
    )
    .await;
    assert_eq!(einheiten, 1, "nur der 2. Zug");
}

// ── 3. Bilden ────────────────────────────────────────────────────────────────────────────────

#[tokio::test]
async fn einheitenbaum_mit_kopfdaten_der_vorlage() {
    let pool = crate::db::test_pool().await;
    let z = setup(&pool).await;
    let abschnitt: i64 = sqlx::query_scalar(
        "INSERT INTO einsatzabschnitt (einsatz_id, name) VALUES (?, 'Nord') RETURNING id",
    )
    .bind(z.k.einsatz_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    let g = bilde(
        &pool,
        &z,
        &Anfrage {
            name: Some("1. Zug"),
            abschnitt_id: Some(abschnitt),
            fahrzeuge: &[],
            personal: &[],
        },
    )
    .await
    .unwrap();
    let namen: Vec<&str> = g.einheiten.iter().map(|b| b.name.as_str()).collect();
    assert_eq!(namen, ["1. Zug", "Rettungsstaffel"]);
    let zug = einheit_repo::laden(&pool, z.k.einsatz_id, g.einheiten[0].id)
        .await
        .unwrap();
    let staffel = einheit_repo::laden(&pool, z.k.einsatz_id, g.einheiten[1].id)
        .await
        .unwrap();
    assert_eq!(zug.typ_label.as_deref(), Some("Zug"));
    assert_eq!(zug.funkrufname.as_deref(), Some("Rotkreuz Musterstadt 1"));
    assert_eq!(zug.tz_fachaufgabe.as_deref(), Some("rettungswesen"));
    assert_eq!(zug.tz_organisation.as_deref(), Some("hilfsorganisation"));
    assert_eq!(zug.abschnitt_id, Some(abschnitt));
    assert_eq!(zug.ueber_einheit_id, None);
    assert_eq!(zug.sortier, 10);
    assert_eq!(zug.bemerkung, None, "die Stammdaten-Notiz kommt nicht mit");
    assert_eq!(
        zug.soll,
        Some(Staerke {
            fuehrer: 1,
            unterfuehrer: 2,
            mannschaft: 10
        })
    );
    assert_eq!(staffel.ueber_einheit_id, Some(zug.id));
    assert_eq!(
        staffel.abschnitt_id, None,
        "Untereinheiten erben den Abschnitt"
    );
    assert_eq!(staffel.typ_label.as_deref(), Some("Staffel"));
    assert_eq!(staffel.tz_fachaufgabe.as_deref(), Some("rettungswesen"));
    assert_eq!(staffel.sortier, 20);
    // Ohne eigenes Soll wirkt das des Typs; gespeichert ist keins.
    assert_eq!(
        staffel.soll,
        Some(Staerke {
            fuehrer: 0,
            unterfuehrer: 1,
            mannschaft: 5
        })
    );
    let roh = einheit_repo::soll_roh(&pool, z.k.einsatz_id, staffel.id)
        .await
        .unwrap();
    assert_eq!(roh, (None, None, None));
    // Ohne Namen übernimmt die Wurzel den der Vorlage.
    let g = bilde(&pool, &z, &anfrage(&[], &[])).await.unwrap();
    assert_eq!(g.einheiten[0].name, "Sanitätszug Musterstadt");
}

/// Drei Ebenen, deren Enkel in der Sortierung vor seinem Elternteil steht (erst alphabetisch bei
/// gleichem `sortier`, dann per kleinerem `sortier`): Plan, Vorschau und Bilden halten Eltern vor
/// Kindern, der Enkel hängt unter der Staffel, nicht als eigenständige Einheit.
#[tokio::test]
async fn enkel_vor_seinem_elternteil_in_der_sortierung_haengt_unter_ihm() {
    for (fall, enkel_name, sortier) in [
        ("alphabetisch", "Atemschutztrupp", 0),
        ("per sortier", "Zugtrupp", 5),
    ] {
        let pool = crate::db::test_pool().await;
        let z = setup(&pool).await;
        if sortier == 0 {
            for id in [z.zug, z.staffel] {
                let patch = VorlagePatch {
                    sortier: Some(0),
                    ..Default::default()
                };
                vrepo::update(&pool, 1, id, patch).await.unwrap();
            }
        }
        let enkel = vrepo::create(
            &pool,
            1,
            NewVorlage {
                ueber_vorlage_id: Some(z.staffel),
                sortier,
                ..neu_vorlage(enkel_name, z.typ_staffel)
            },
        )
        .await
        .unwrap()
        .id;

        let plan = plane(&pool, &z, z.zug).await.unwrap();
        let ids: Vec<i64> = plan.knoten.iter().map(|k| k.id).collect();
        assert_eq!(ids, [z.zug, z.staffel, enkel], "{fall}: Plan");
        let v = vorschau(&plan, NICHTS_GESPERRT);
        let knoten: Vec<(i64, Option<i64>)> = v
            .knoten
            .iter()
            .map(|k| (k.vorlage_id, k.ueber_vorlage_id))
            .collect();
        assert_eq!(
            knoten,
            [
                (z.zug, None),
                (z.staffel, Some(z.zug)),
                (enkel, Some(z.staffel))
            ],
            "{fall}: Vorschau"
        );

        let g = bilde(&pool, &z, &anfrage(&[], &[])).await.unwrap();
        let namen: Vec<&str> = g.einheiten.iter().map(|b| b.name.as_str()).collect();
        assert_eq!(
            namen,
            ["Sanitätszug Musterstadt", "Rettungsstaffel", enkel_name],
            "{fall}: einheit_ids, Eltern vor Kindern"
        );
        let mut ueber = Vec::new();
        for b in &g.einheiten {
            let e = einheit_repo::laden(&pool, z.k.einsatz_id, b.id)
                .await
                .unwrap();
            ueber.push(e.ueber_einheit_id);
        }
        assert_eq!(
            ueber,
            [None, Some(g.einheiten[0].id), Some(g.einheiten[1].id)],
            "{fall}: ueber_einheit_id"
        );
    }
}

/// Ein Plan, dessen Knoten ein Kind vor seinem Elternteil tragen, ist ein Programmfehler: kein
/// stilles Anlegen als eigenständige Einheit, sondern `Internal`.
#[tokio::test]
async fn fehlender_elternteil_im_plan_ist_ein_interner_fehler() {
    let pool = crate::db::test_pool().await;
    let z = setup(&pool).await;
    let enkel = vrepo::create(
        &pool,
        1,
        NewVorlage {
            ueber_vorlage_id: Some(z.staffel),
            ..neu_vorlage("Atemschutztrupp", z.typ_staffel)
        },
    )
    .await
    .unwrap()
    .id;
    let mut tx = pool.begin().await.unwrap();
    let mut plan = plane_tx(&mut tx, z.k.einsatz_id, 1, z.zug, ALLES)
        .await
        .unwrap();
    let pos = plan.knoten.iter().position(|k| k.id == enkel).unwrap();
    let k = plan.knoten.remove(pos);
    plan.knoten.insert(1, k);
    let fehler = bilde_tx(&mut tx, z.k, &plan, &anfrage(&[], &[]))
        .await
        .unwrap_err();
    assert!(matches!(fehler, AppError::Internal(_)), "{fehler:?}");
}

#[tokio::test]
async fn fahrzeuge_neu_disponiert_frei_zugeordnet_gebunden_umgehaengt() {
    let pool = crate::db::test_pool().await;
    let z = setup(&pool).await;
    let zweiter = einheit(&pool, z.k.einsatz_id, "2. Zug").await;
    let ef1 = im_einsatz_fahrzeug(&pool, z.k, z.rtw1, None).await;
    let ef2 = im_einsatz_fahrzeug(&pool, z.k, z.rtw2, Some(zweiter)).await;
    let fahrzeuge = [
        Wahl {
            id: z.rtw2,
            umhaengen: true,
        },
        Wahl {
            id: z.rtw1,
            umhaengen: false,
        },
        Wahl {
            id: z.elw,
            umhaengen: false,
        },
    ];
    let g = bilde(&pool, &z, &anfrage(&fahrzeuge, &[])).await.unwrap();
    let (zug, staffel) = (g.einheiten[0].id, g.einheiten[1].id);
    let namen: Vec<&str> = g.fahrzeuge.iter().map(|b| b.name.as_str()).collect();
    assert_eq!(namen, ["ELW 1", "RTW 1", "RTW 2"], "Vorlagenreihenfolge");
    assert_eq!(g.fahrzeuge[1].id, ef1, "keine zweite Disposition");
    assert_eq!(g.fahrzeuge[2].id, ef2);
    assert_eq!(g.alte_einheiten, [zweiter]);
    assert_eq!(
        g.umgehaengt,
        [Umgehaengt {
            name: "RTW 2".into(),
            woher: "aus «2. Zug»".into()
        }]
    );
    let zuordnung: Vec<(String, Option<i64>)> = sqlx::query_as(
        "SELECT snap_funkrufname, einheit_id FROM einsatz_fahrzeug WHERE einsatz_id = ? \
         ORDER BY snap_funkrufname",
    )
    .bind(z.k.einsatz_id)
    .fetch_all(&pool)
    .await
    .unwrap();
    assert_eq!(
        zuordnung,
        [
            ("ELW 1".to_string(), Some(zug)),
            ("RTW 1".to_string(), Some(staffel)),
            ("RTW 2".to_string(), Some(staffel)),
        ]
    );
}

#[tokio::test]
async fn personen_nach_vorlage_mit_position_und_besatzung() {
    let pool = crate::db::test_pool().await;
    let z = setup(&pool).await;
    let zweiter = einheit(&pool, z.k.einsatz_id, "2. Zug").await;
    let fremd_fz = fahrzeug(&pool, 1, "83-4").await;
    let ef_fremd = im_einsatz_fahrzeug(&pool, z.k, fremd_fz, Some(zweiter)).await;
    // Frei mit eigener Position: behält sie.
    let ep_funker = im_einsatz_person(&pool, z.k, z.funker, Some("unterfuehrer"), None, None).await;
    // Im 2. Zug auf 83-4: umgehängt; ihr RTW 2 kommt nicht mit → ohne Fahrzeug.
    let ep_rita =
        im_einsatz_person(&pool, z.k, z.rettsan1, None, Some(zweiter), Some(ef_fremd)).await;
    // Entlassen: wird erneut disponiert, mit neuem Initialstatus.
    let ep_nils = im_einsatz_person(&pool, z.k, z.notsan, None, None, None).await;
    {
        let mut conn = pool.acquire().await.unwrap();
        crate::personal::disposition_repo::entlassen_tx(
            &mut conn,
            z.k.einsatz_id,
            ep_nils,
            z.k.benutzer_id,
            &crate::zeit::jetzt(),
        )
        .await
        .unwrap();
    }
    let zeitachse_vorher = zaehle(
        &pool,
        "SELECT COUNT(*) FROM einsatz_kraft_zeitachse WHERE personal_id = ? AND gestrichen_at IS NULL",
        ep_nils,
    )
    .await;

    let fahrzeuge = wahl(&[z.elw, z.rtw1]);
    let personal = [
        Wahl {
            id: z.zugfuehrer,
            umhaengen: false,
        },
        Wahl {
            id: z.funker,
            umhaengen: false,
        },
        Wahl {
            id: z.notsan,
            umhaengen: false,
        },
        Wahl {
            id: z.rettsan1,
            umhaengen: true,
        },
    ];
    let g = bilde(&pool, &z, &anfrage(&fahrzeuge, &personal))
        .await
        .unwrap();
    let (zug, staffel) = (g.einheiten[0].id, g.einheiten[1].id);
    let ef_elw = g.fahrzeuge[0].id;
    let ef_rtw1 = g.fahrzeuge[1].id;
    let namen: Vec<&str> = g.personal.iter().map(|b| b.name.as_str()).collect();
    assert_eq!(
        namen,
        [
            "Zugführer Zander",
            "Funker Fritz",
            "Notsan Nils",
            "Rettsan Rita"
        ]
    );
    let zeilen: Vec<(String, Option<i64>, Option<i64>, Option<String>)> = sqlx::query_as(
        "SELECT snap_name, einheit_id, fahrzeug_id, staerke_position FROM einsatz_personal \
         WHERE einsatz_id = ? AND beendet_at IS NULL ORDER BY snap_name",
    )
    .bind(z.k.einsatz_id)
    .fetch_all(&pool)
    .await
    .unwrap();
    assert_eq!(
        zeilen,
        [
            (
                "Funker Fritz".to_string(),
                Some(zug),
                Some(ef_elw),
                Some("unterfuehrer".to_string())
            ),
            (
                "Notsan Nils".to_string(),
                Some(staffel),
                Some(ef_rtw1),
                None
            ),
            ("Rettsan Rita".to_string(), Some(staffel), None, None),
            (
                "Zugführer Zander".to_string(),
                Some(zug),
                Some(ef_elw),
                Some("fuehrer".to_string())
            ),
        ]
    );
    assert!(g.personal.iter().any(|b| b.id == ep_funker));
    assert!(g.personal.iter().any(|b| b.id == ep_rita));
    assert!(
        g.personal.iter().any(|b| b.id == ep_nils),
        "dieselbe Zeile, erneut disponiert"
    );
    assert_eq!(g.alte_einheiten, [zweiter]);
    assert_eq!(g.alte_fahrzeuge, [ef_fremd]);
    assert_eq!(
        g.umgehaengt,
        [Umgehaengt {
            name: "Rettsan Rita".into(),
            woher: "aus «2. Zug»".into()
        }]
    );
    let zeitachse_nachher = zaehle(
        &pool,
        "SELECT COUNT(*) FROM einsatz_kraft_zeitachse WHERE personal_id = ? AND gestrichen_at IS NULL",
        ep_nils,
    )
    .await;
    assert_eq!(
        zeitachse_nachher,
        zeitachse_vorher + 1,
        "neuer Initialstatus"
    );
    // Die Einheiten bekommen kein Ereignis (Einsatzdauer ab dem ersten Fahrzeugstatus).
    let einheit_ereignisse = zaehle(
        &pool,
        "SELECT COUNT(*) FROM einsatz_kraft_zeitachse WHERE einheit_id IN \
         (SELECT id FROM einsatz_einheit WHERE einsatz_id = ?1 AND aufgeloest_at IS NULL)",
        z.k.einsatz_id,
    )
    .await;
    assert_eq!(einheit_ereignisse, 0);
}

/// Eine Person ohne Einheit, die schon auf ihrem Vorlagen-Fahrzeug sitzt, ist frei (Spec
/// `kraefte-disposition`, „Umhängen nur auf Wunsch“: nur ein *anderes* Fahrzeug bindet): sie
/// kommt ohne „umhängen“ mit und gilt nicht als umgehängt. Eine auf einem fremden Fahrzeug
/// braucht „umhängen“ und wechselt dann aufs Vorlagen-Fahrzeug.
#[tokio::test]
async fn besatzung_wechselt_aufs_vorlagenfahrzeug() {
    let pool = crate::db::test_pool().await;
    let z = setup(&pool).await;
    let ef1 = im_einsatz_fahrzeug(&pool, z.k, z.rtw1, None).await;
    let fremd_fz = fahrzeug(&pool, 1, "83-4").await;
    let ef_fremd = im_einsatz_fahrzeug(&pool, z.k, fremd_fz, None).await;
    let ep_nora = im_einsatz_person(&pool, z.k, z.notarzt, None, None, Some(ef1)).await;
    let ep_nils = im_einsatz_person(&pool, z.k, z.notsan, None, None, Some(ef_fremd)).await;

    let plan = plane(&pool, &z, z.zug).await.unwrap();
    let nora = &plan.personal[&z.notarzt];
    assert_eq!(
        (nora.zustand, nora.ep_id),
        (VorschauZustand::Frei, Some(ep_nora)),
        "auf dem eigenen Vorlagen-Fahrzeug: frei"
    );
    assert_eq!(plan.personal[&z.notsan].zustand, VorschauZustand::Gebunden);
    let v = vorschau(&plan, NICHTS_GESPERRT);
    let zeile = v.knoten[1]
        .personal
        .iter()
        .find(|p| p.personal_id == z.notarzt)
        .unwrap();
    assert_eq!(zeile.zustand, VorschauZustand::Frei);

    let personal = [
        Wahl {
            id: z.notarzt,
            umhaengen: false,
        },
        Wahl {
            id: z.notsan,
            umhaengen: true,
        },
    ];
    let g = bilde(&pool, &z, &anfrage(&wahl(&[z.rtw1]), &personal))
        .await
        .unwrap();
    assert_eq!(
        g.umgehaengt,
        [Umgehaengt {
            name: "Notsan Nils".into(),
            woher: "von «83-4»".into()
        }]
    );
    assert_eq!(g.alte_fahrzeuge, [ef_fremd]);
    let zeilen: Vec<(i64, Option<i64>)> = sqlx::query_as(
        "SELECT id, fahrzeug_id FROM einsatz_personal WHERE id IN (?, ?) ORDER BY id",
    )
    .bind(ep_nora)
    .bind(ep_nils)
    .fetch_all(&pool)
    .await
    .unwrap();
    assert_eq!(zeilen, [(ep_nora, Some(ef1)), (ep_nils, Some(ef1))]);
}

/// Gegenfall: eine Person ohne Einheit auf einem anderen als ihrem Vorlagen-Fahrzeug ist
/// gebunden; ohne „umhängen“ 422 mit dem Grund an ihr, und nichts ist angelegt.
#[tokio::test]
async fn person_auf_anderem_fahrzeug_braucht_umhaengen() {
    let pool = crate::db::test_pool().await;
    let z = setup(&pool).await;
    // Notarzt Nora gehört laut Vorlage auf RTW 1, sitzt aber auf RTW 2 (auch ein Fahrzeug der
    // Vorlage, nur nicht ihres).
    let ef2 = im_einsatz_fahrzeug(&pool, z.k, z.rtw2, None).await;
    im_einsatz_person(&pool, z.k, z.notarzt, None, None, Some(ef2)).await;
    let plan = plane(&pool, &z, z.zug).await.unwrap();
    assert_eq!(plan.personal[&z.notarzt].zustand, VorschauZustand::Gebunden);
    let fahrzeuge = wahl(&[z.rtw1, z.rtw2]);
    let personal = wahl(&[z.notarzt]);
    match bilde(&pool, &z, &anfrage(&fahrzeuge, &personal)).await {
        Err(AppError::Zeilen { zeilen, .. }) => {
            let gruende: Vec<(ZeilenArt, i64, &str)> = zeilen
                .iter()
                .map(|z| (z.art, z.id, z.grund.as_str()))
                .collect();
            assert_eq!(gruende, [(ZeilenArt::Personal, z.notarzt, "auf «RTW 2»")]);
        }
        andere => panic!("erwartet Zeilen: {andere:?}"),
    }
    let einheiten = zaehle(
        &pool,
        "SELECT COUNT(*) FROM einsatz_einheit WHERE einsatz_id = ? AND aufgeloest_at IS NULL",
        z.k.einsatz_id,
    )
    .await;
    assert_eq!(einheiten, 0);
}

/// Alles oder nichts: ein Fehler mitten im Schreiben (hier eine seit der Planung entlassene
/// Person, 409 aus dem Lebenszyklus) lässt weder Einheit noch Disposition stehen.
#[tokio::test]
async fn fehler_mitten_im_schreiben_legt_nichts_an() {
    let pool = crate::db::test_pool().await;
    let z = setup(&pool).await;
    let ep = im_einsatz_person(&pool, z.k, z.rettsan2, None, None, None).await;
    let mut tx = pool.begin().await.unwrap();
    let plan = plane_tx(&mut tx, z.k.einsatz_id, 1, z.zug, ALLES)
        .await
        .unwrap();
    crate::personal::disposition_repo::entlassen_tx(
        &mut tx,
        z.k.einsatz_id,
        ep,
        z.k.benutzer_id,
        &crate::zeit::jetzt(),
    )
    .await
    .unwrap();
    let fahrzeuge = wahl(&[z.elw, z.rtw1, z.rtw2]);
    let personal = wahl(&[z.zugfuehrer, z.rettsan2]);
    let fehler = bilde_tx(&mut tx, z.k, &plan, &anfrage(&fahrzeuge, &personal))
        .await
        .unwrap_err();
    assert!(matches!(fehler, AppError::Conflict(_)), "{fehler:?}");
    tx.rollback().await.unwrap();
    let einheiten = zaehle(
        &pool,
        "SELECT COUNT(*) FROM einsatz_einheit WHERE einsatz_id = ? AND aufgeloest_at IS NULL",
        z.k.einsatz_id,
    )
    .await;
    let fahrzeuge = zaehle(
        &pool,
        "SELECT COUNT(*) FROM einsatz_fahrzeug WHERE einsatz_id = ?",
        z.k.einsatz_id,
    )
    .await;
    let personal = zaehle(
        &pool,
        "SELECT COUNT(*) FROM einsatz_personal WHERE einsatz_id = ? AND beendet_at IS NULL",
        z.k.einsatz_id,
    )
    .await;
    assert_eq!((einheiten, fahrzeuge, personal), (0, 0, 1));
}

#[tokio::test]
async fn etb_text_aus_dem_ergebnis() {
    let pool = crate::db::test_pool().await;
    let z = setup(&pool).await;
    let zweiter = einheit(&pool, z.k.einsatz_id, "2. Zug").await;
    im_einsatz_fahrzeug(&pool, z.k, z.rtw2, Some(zweiter)).await;
    let fahrzeuge = [
        Wahl {
            id: z.elw,
            umhaengen: false,
        },
        Wahl {
            id: z.rtw1,
            umhaengen: false,
        },
        Wahl {
            id: z.rtw2,
            umhaengen: true,
        },
    ];
    let personal = wahl(&[z.rettsan1, z.rettsan2]);
    let g = bilde(
        &pool,
        &z,
        &Anfrage {
            name: Some("1. Zug"),
            ..anfrage(&fahrzeuge, &personal)
        },
    )
    .await
    .unwrap();
    assert_eq!(
        etb_text("Sanitätszug Musterstadt", &g),
        "Einheit «1. Zug» aus Vorlage «Sanitätszug Musterstadt» gebildet; Untereinheit: \
         «Rettungsstaffel»; 3 Fahrzeuge: ELW 1, RTW 1, RTW 2; 2 Kräfte: Rettsan Rita, \
         Rettsan Rolf; umgehängt: RTW 2 aus «2. Zug»"
    );
}
