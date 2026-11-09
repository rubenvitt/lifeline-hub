//! Vertrauenskette der Unterschriftsschlüssel (Spec `org-admin-unterschrift`).

use super::*;
use crate::auth::unterschrift::pruefen::test_authenticator::SoftwarePasskey;
use crate::instanz::repo as kopplung;
use crate::instanz::{InstanzKopplungRichtung, InstanzKopplungZustand};

const JETZT: &str = "2026-11-08 12:00:00";
const ORIGIN: &str = "https://hub.example.org";
const RP: &str = "hub.example.org";
const FREMDE_ORG: &str = "hub-kennung/1";

async fn pool_mit_admin() -> SqlitePool {
    let pool = crate::db::test_pool().await;
    crate::auth::bootstrap::bootstrap_admin(&pool, "Org", "admin", Some("startpw12"))
        .await
        .unwrap();
    pool
}

/// Eine Kopplung, in der diese Instanz sich meldet, mit einer Org-Zuordnung; liefert deren id.
async fn kopplung_org(pool: &SqlitePool, richtung: InstanzKopplungRichtung) -> i64 {
    let mut conn = pool.acquire().await.unwrap();
    let k = kopplung::create_or_renew_kopplung(
        &mut conn,
        &kopplung::Gegenueber {
            kennung: "hub-kennung",
            schluessel_b64: "AAAA",
            name: "Hub",
            softwarestand: "1",
            protokoll: 1,
        },
        richtung,
        (richtung == InstanzKopplungRichtung::MeldetSich).then_some("https://hub.example.org"),
        InstanzKopplungZustand::Aktiv,
        JETZT,
    )
    .await
    .unwrap();
    kopplung::create_org_zuordnung(&mut conn, k, 1, FREMDE_ORG, "Hub-Org", Some(1), true)
        .await
        .unwrap()
}

fn lieferung(
    id: i64,
    p: &SoftwarePasskey,
    zustand: UnterschriftSchluesselZustand,
    stand: i64,
) -> UnterschriftSchluesselLieferung {
    UnterschriftSchluesselLieferung {
        id,
        benutzer_name: format!("admin{id}"),
        credential_id: p.credential_id.clone(),
        alg: ALG_ES256.into(),
        schluessel: p.oeffentlich(),
        rp_id: RP.into(),
        origin: ORIGIN.into(),
        bezeichnung: "Stick".into(),
        zustand,
        gegenzeichnung: None,
        stand,
    }
}

fn gegengezeichnet(
    mut l: UnterschriftSchluesselLieferung,
    unterzeichner: &SoftwarePasskey,
    org: &str,
) -> UnterschriftSchluesselLieferung {
    let erklaerung = serde_json::to_string(&AufnahmeErklaerung {
        typ: TYP_AUFNAHME.into(),
        org: org.into(),
        credential_id: l.credential_id.clone(),
        schluessel_hash: sha256_b64(&parse_b64(&l.schluessel).unwrap()),
        fingerabdruck: "x".into(),
        inhaber: l.benutzer_name.clone(),
        zeitpunkt: JETZT.into(),
        rp_id: l.rp_id.clone(),
        origin: l.origin.clone(),
        alg: l.alg.clone(),
    })
    .unwrap();
    let assertion = unterzeichner.sign(&erklaerung, ORIGIN, RP, 0x05);
    l.gegenzeichnung = Some(Gegenzeichnung {
        erklaerung,
        assertion,
        unterzeichner_credential_id: unterzeichner.credential_id.clone(),
    });
    l
}

async fn gueltige_fremde(conn: &mut SqliteConnection) -> Vec<String> {
    sqlx::query_scalar(
        "SELECT credential_id FROM unterschrift_schluessel WHERE herkunft = 'gegenueber' \
         AND zustand = 'gueltig' ORDER BY id",
    )
    .fetch_all(&mut *conn)
    .await
    .unwrap()
}

#[tokio::test]
async fn grundstock_gilt_ohne_gegenzeichnung() {
    let pool = pool_mit_admin().await;
    let ko = kopplung_org(&pool, InstanzKopplungRichtung::MeldetSich).await;
    let a = SoftwarePasskey::new("a", [1u8; 32]);
    let ziel = Ziel {
        kopplung_org_id: ko,
        org_id: 1,
        fremde_org_kennung: FREMDE_ORG,
    };
    let mut conn = pool.acquire().await.unwrap();
    let abgelehnt = accept_lieferungen(
        &mut conn,
        &ziel,
        &[lieferung(10, &a, UnterschriftSchluesselZustand::Gueltig, 3)],
        true,
        JETZT,
    )
    .await
    .unwrap();
    assert!(abgelehnt.is_empty());
    assert_eq!(gueltige_fremde(&mut conn).await, vec!["a"]);
    let stand: i64 =
        sqlx::query_scalar("SELECT unterschrift_stand FROM instanz_kopplung_org WHERE id = ?")
            .bind(ko)
            .fetch_one(&mut *conn)
            .await
            .unwrap();
    assert_eq!(stand, 3);
}

#[tokio::test]
async fn untergeschobener_schluessel_ohne_gegenzeichnung_wird_verworfen() {
    let pool = pool_mit_admin().await;
    let ko = kopplung_org(&pool, InstanzKopplungRichtung::MeldetSich).await;
    let a = SoftwarePasskey::new("a", [1u8; 32]);
    let boese = SoftwarePasskey::new("boese", [9u8; 32]);
    let ziel = Ziel {
        kopplung_org_id: ko,
        org_id: 1,
        fremde_org_kennung: FREMDE_ORG,
    };
    let mut conn = pool.acquire().await.unwrap();
    accept_lieferungen(
        &mut conn,
        &ziel,
        &[lieferung(10, &a, UnterschriftSchluesselZustand::Gueltig, 1)],
        true,
        JETZT,
    )
    .await
    .unwrap();
    // Ohne Gegenzeichnung
    let ab = accept_lieferungen(
        &mut conn,
        &ziel,
        &[lieferung(
            11,
            &boese,
            UnterschriftSchluesselZustand::Gueltig,
            2,
        )],
        false,
        JETZT,
    )
    .await
    .unwrap();
    assert_eq!(ab.len(), 1, "{ab:?}");
    // Vom bösen Schlüssel selbst gegengezeichnet (nicht bekannt)
    let selbst = gegengezeichnet(
        lieferung(11, &boese, UnterschriftSchluesselZustand::Gueltig, 2),
        &boese,
        FREMDE_ORG,
    );
    let ab = accept_lieferungen(&mut conn, &ziel, &[selbst], false, JETZT)
        .await
        .unwrap();
    assert_eq!(ab.len(), 1);
    assert!(ab[0].grund.contains("unbekannt"), "{ab:?}");
    // Gegenzeichnung für eine andere Org
    let falsche_org = gegengezeichnet(
        lieferung(11, &boese, UnterschriftSchluesselZustand::Gueltig, 2),
        &a,
        "andere/1",
    );
    let ab = accept_lieferungen(&mut conn, &ziel, &[falsche_org], false, JETZT)
        .await
        .unwrap();
    assert_eq!(ab.len(), 1);
    // Gegenzeichnung eines anderen Schlüssels untergeschoben
    let mut fremd = gegengezeichnet(
        lieferung(11, &boese, UnterschriftSchluesselZustand::Gueltig, 2),
        &a,
        FREMDE_ORG,
    );
    fremd.schluessel = SoftwarePasskey::new("boese", [8u8; 32]).oeffentlich();
    let ab = accept_lieferungen(&mut conn, &ziel, &[fremd], false, JETZT)
        .await
        .unwrap();
    assert_eq!(ab.len(), 1);
    assert_eq!(gueltige_fremde(&mut conn).await, vec!["a"]);
}

#[tokio::test]
async fn gegengezeichneter_schluessel_wird_angenommen_und_widerruf_uebernommen() {
    let pool = pool_mit_admin().await;
    let ko = kopplung_org(&pool, InstanzKopplungRichtung::MeldetSich).await;
    let a = SoftwarePasskey::new("a", [1u8; 32]);
    let b = SoftwarePasskey::new("b", [2u8; 32]);
    let ziel = Ziel {
        kopplung_org_id: ko,
        org_id: 1,
        fremde_org_kennung: FREMDE_ORG,
    };
    let mut conn = pool.acquire().await.unwrap();
    accept_lieferungen(
        &mut conn,
        &ziel,
        &[lieferung(10, &a, UnterschriftSchluesselZustand::Gueltig, 1)],
        true,
        JETZT,
    )
    .await
    .unwrap();
    let neu = gegengezeichnet(
        lieferung(11, &b, UnterschriftSchluesselZustand::Gueltig, 2),
        &a,
        FREMDE_ORG,
    );
    let ab = accept_lieferungen(&mut conn, &ziel, &[neu], false, JETZT)
        .await
        .unwrap();
    assert!(ab.is_empty(), "{ab:?}");
    // Übernommen, aber erst nach der Bestätigung gültig (R24, Change zkvt2l8z).
    assert_eq!(gueltige_fremde(&mut conn).await, vec!["a"]);
    assert_eq!(zustand_von(&mut conn, 11).await, "wartet_auf_bestaetigung");
    // Widerruf ohne Gegenzeichnung
    accept_lieferungen(
        &mut conn,
        &ziel,
        &[lieferung(
            10,
            &a,
            UnterschriftSchluesselZustand::Widerrufen,
            3,
        )],
        false,
        JETZT,
    )
    .await
    .unwrap();
    assert!(gueltige_fremde(&mut conn).await.is_empty());
    // Ein widerrufener lebt nicht wieder auf
    accept_lieferungen(
        &mut conn,
        &ziel,
        &[lieferung(10, &a, UnterschriftSchluesselZustand::Gueltig, 4)],
        true,
        JETZT,
    )
    .await
    .unwrap();
    assert!(gueltige_fremde(&mut conn).await.is_empty());
    assert_eq!(zustand_von(&mut conn, 11).await, "wartet_auf_bestaetigung");
}

#[tokio::test]
async fn lokaler_schluessel_gilt_ohne_kopplung_und_wartet_mit() {
    let pool = pool_mit_admin().await;
    let a = SoftwarePasskey::new("a", [1u8; 32]);
    let mut conn = pool.acquire().await.unwrap();
    let schluessel_a = a.oeffentlich();
    let id_a = create_lokal(
        &mut conn,
        &NeuerSchluessel {
            org_id: 1,
            benutzer_id: 1,
            benutzer_name: "admin",
            credential_id: "a",
            schluessel: &schluessel_a,
            rp_id: RP,
            origin: ORIGIN,
            bezeichnung: "Stick",
        },
    )
    .await
    .unwrap();
    assert_eq!(
        load(&mut conn, 1, id_a).await.unwrap().zustand(),
        UnterschriftSchluesselZustand::Gueltig
    );
    drop(conn);
    // Jetzt verteilt die Org ihre Schlüssel (wir stellen aus).
    kopplung_org(&pool, InstanzKopplungRichtung::WirdGemeldet).await;
    let mut conn = pool.acquire().await.unwrap();
    assert!(is_letzter_bei_kopplung(&mut conn, 1, id_a).await.unwrap());
    let b = SoftwarePasskey::new("b", [2u8; 32]);
    let schluessel_b = b.oeffentlich();
    let id_b = create_lokal(
        &mut conn,
        &NeuerSchluessel {
            org_id: 1,
            benutzer_id: 1,
            benutzer_name: "admin",
            credential_id: "b",
            schluessel: &schluessel_b,
            rp_id: RP,
            origin: ORIGIN,
            bezeichnung: "Zweiter",
        },
    )
    .await
    .unwrap();
    assert_eq!(
        load(&mut conn, 1, id_b).await.unwrap().zustand(),
        UnterschriftSchluesselZustand::WartetAufGegenzeichnung
    );
    // Wartende gehen nicht hinaus, nur der gültige.
    let (grund, _) = grundstock(&mut conn, 1).await.unwrap();
    assert_eq!(grund.len(), 1);
    assert!(nachlieferung(&mut conn, 1, 0, LIEFERUNGEN_MAX)
        .await
        .unwrap()
        .iter()
        .all(|l| l.credential_id == "a"));
    // Nach dem Widerruf von a ist nichts mehr gültig; Nachlieferung trägt den Widerruf.
    assert!(widerrufen(&mut conn, 1, id_a, JETZT).await.unwrap());
    assert!(
        !widerrufen(&mut conn, 1, id_a, JETZT).await.unwrap(),
        "zweites Mal ohne Wirkung"
    );
    let n = nachlieferung(&mut conn, 1, 1, LIEFERUNGEN_MAX)
        .await
        .unwrap();
    assert_eq!(n.len(), 1);
    assert_eq!(n[0].zustand, UnterschriftSchluesselZustand::Widerrufen);
}

#[tokio::test]
async fn widerrufener_schluessel_lebt_unter_neuer_id_nicht_wieder_auf() {
    let pool = pool_mit_admin().await;
    let ko = kopplung_org(&pool, InstanzKopplungRichtung::MeldetSich).await;
    let a = SoftwarePasskey::new("a", [1u8; 32]);
    let b = SoftwarePasskey::new("b", [2u8; 32]);
    let ziel = Ziel {
        kopplung_org_id: ko,
        org_id: 1,
        fremde_org_kennung: FREMDE_ORG,
    };
    let mut conn = pool.acquire().await.unwrap();
    accept_lieferungen(
        &mut conn,
        &ziel,
        &[lieferung(10, &a, UnterschriftSchluesselZustand::Gueltig, 1)],
        true,
        JETZT,
    )
    .await
    .unwrap();
    let neu = gegengezeichnet(
        lieferung(11, &b, UnterschriftSchluesselZustand::Gueltig, 2),
        &a,
        FREMDE_ORG,
    );
    accept_lieferungen(&mut conn, &ziel, &[neu], false, JETZT)
        .await
        .unwrap();
    accept_lieferungen(
        &mut conn,
        &ziel,
        &[lieferung(
            11,
            &b,
            UnterschriftSchluesselZustand::Widerrufen,
            3,
        )],
        false,
        JETZT,
    )
    .await
    .unwrap();
    // Derselbe Schlüssel mit derselben alten Gegenzeichnung unter neuer id
    let wieder = gegengezeichnet(
        lieferung(12, &b, UnterschriftSchluesselZustand::Gueltig, 4),
        &a,
        FREMDE_ORG,
    );
    let ab = accept_lieferungen(&mut conn, &ziel, &[wieder], false, JETZT)
        .await
        .unwrap();
    assert_eq!(ab.len(), 1, "{ab:?}");
    assert_eq!(gueltige_fremde(&mut conn).await, vec!["a"]);
}

#[tokio::test]
async fn erklaerung_bindet_herkunft_und_rp_des_neuen_schluessels() {
    let pool = pool_mit_admin().await;
    let ko = kopplung_org(&pool, InstanzKopplungRichtung::MeldetSich).await;
    let a = SoftwarePasskey::new("a", [1u8; 32]);
    let b = SoftwarePasskey::new("b", [2u8; 32]);
    let ziel = Ziel {
        kopplung_org_id: ko,
        org_id: 1,
        fremde_org_kennung: FREMDE_ORG,
    };
    let mut conn = pool.acquire().await.unwrap();
    accept_lieferungen(
        &mut conn,
        &ziel,
        &[lieferung(10, &a, UnterschriftSchluesselZustand::Gueltig, 1)],
        true,
        JETZT,
    )
    .await
    .unwrap();
    let mut neu = gegengezeichnet(
        lieferung(11, &b, UnterschriftSchluesselZustand::Gueltig, 2),
        &a,
        FREMDE_ORG,
    );
    neu.origin = "https://boese.example".into();
    let ab = accept_lieferungen(&mut conn, &ziel, &[neu], false, JETZT)
        .await
        .unwrap();
    assert_eq!(ab.len(), 1, "{ab:?}");
}

#[tokio::test]
async fn lieferung_ueber_der_grenze_wird_abgelehnt_und_ein_widerruf_derselben_id_greift() {
    let pool = pool_mit_admin().await;
    let ko = kopplung_org(&pool, InstanzKopplungRichtung::MeldetSich).await;
    let a = SoftwarePasskey::new("a", [1u8; 32]);
    let ziel = Ziel {
        kopplung_org_id: ko,
        org_id: 1,
        fremde_org_kennung: FREMDE_ORG,
    };
    let mut conn = pool.acquire().await.unwrap();
    let zu_viele: Vec<_> = (0..=LIEFERUNGEN_MAX as i64)
        .map(|i| lieferung(i, &a, UnterschriftSchluesselZustand::Gueltig, i))
        .collect();
    assert!(matches!(
        accept_lieferungen(&mut conn, &ziel, &zu_viele, true, JETZT).await,
        Err(AppError::Validation(_))
    ));
    assert!(gueltige_fremde(&mut conn).await.is_empty());

    accept_lieferungen(
        &mut conn,
        &ziel,
        &[
            lieferung(10, &a, UnterschriftSchluesselZustand::Gueltig, 3),
            lieferung(10, &a, UnterschriftSchluesselZustand::Gueltig, 3),
            lieferung(10, &a, UnterschriftSchluesselZustand::Widerrufen, 4),
        ],
        true,
        JETZT,
    )
    .await
    .unwrap();
    assert!(
        gueltige_fremde(&mut conn).await.is_empty(),
        "der Widerruf derselben id gilt"
    );
}

#[tokio::test]
async fn grundstock_ueber_der_grenze_scheitert_statt_abzuschneiden() {
    // Ein abgeschnittener Grundstock verlöre Schlüssel still: was danach nachkommt, braucht eine
    // Gegenzeichnung, die ein Schlüssel aus der Zeit vor der Kopplung nicht hat.
    let pool = pool_mit_admin().await;
    let mut conn = pool.acquire().await.unwrap();
    for stand in 1..=LIEFERUNGEN_MAX as i64 {
        lokaler_gueltiger(&mut conn, stand).await;
    }
    let (grund, _) = grundstock(&mut conn, 1).await.unwrap();
    assert_eq!(grund.len(), LIEFERUNGEN_MAX);
    lokaler_gueltiger(&mut conn, LIEFERUNGEN_MAX as i64 + 1).await;
    assert!(matches!(
        grundstock(&mut conn, 1).await,
        Err(AppError::Conflict(_))
    ));
}

#[tokio::test]
async fn nachlieferung_liefert_hoechstens_die_grenze_und_der_rest_folgt() {
    let pool = pool_mit_admin().await;
    let mut conn = pool.acquire().await.unwrap();
    let anzahl = LIEFERUNGEN_MAX as i64 + 1;
    for stand in 1..=anzahl {
        lokaler_gueltiger(&mut conn, stand).await;
    }
    let erste = nachlieferung(&mut conn, 1, 0, LIEFERUNGEN_MAX)
        .await
        .unwrap();
    assert_eq!(erste.len(), LIEFERUNGEN_MAX);
    let bis = erste.last().unwrap().stand;
    assert_eq!(
        bis, LIEFERUNGEN_MAX as i64,
        "nach Stand sortiert, die ältesten zuerst"
    );
    let rest = nachlieferung(&mut conn, 1, bis, LIEFERUNGEN_MAX)
        .await
        .unwrap();
    assert_eq!(
        rest.iter().map(|l| l.stand).collect::<Vec<_>>(),
        [anzahl],
        "der Rest folgt mit der nächsten Meldung"
    );
    assert_eq!(
        nachlieferung(&mut conn, 1, 0, 3).await.unwrap().len(),
        3,
        "das Restbudget der Antwort deckelt"
    );
}

/// Ein gültiger lokaler Schlüssel von Admin 1 in Org 1 mit dem Stand `stand`.
async fn lokaler_gueltiger(conn: &mut SqliteConnection, stand: i64) {
    sqlx::query(
        "INSERT INTO unterschrift_schluessel (org_id, herkunft, benutzer_id, benutzer_name, \
         credential_id, alg, schluessel, rp_id, origin, bezeichnung, fingerabdruck, zustand, \
         stand) VALUES (1, 'lokal', 1, 'admin', ?, 'es256', 'AAAA', ?, ?, 'Stick', 'fp', \
         'gueltig', ?)",
    )
    .bind(format!("c{stand}"))
    .bind(RP)
    .bind(ORIGIN)
    .bind(stand)
    .execute(&mut *conn)
    .await
    .unwrap();
}

#[tokio::test]
async fn registrieren_begrenzt_credential_id_und_kuerzt_den_namen() {
    let pool = pool_mit_admin().await;
    let mut conn = pool.acquire().await.unwrap();
    let p = SoftwarePasskey::new("a", [1u8; 32]);
    let oeff = p.oeffentlich();
    let lang = "A".repeat(super::super::pruefen::CREDENTIAL_ID_MAX + 1);
    let name = "ü".repeat(500);
    let neu = |cid: &'static str| NeuerSchluessel {
        org_id: 1,
        benutzer_id: 1,
        benutzer_name: &name,
        credential_id: cid,
        schluessel: &oeff,
        rp_id: RP,
        origin: ORIGIN,
        bezeichnung: "Stick",
    };
    let lang: &'static str = Box::leak(lang.into_boxed_str());
    assert!(matches!(
        create_lokal(&mut conn, &neu(lang)).await,
        Err(AppError::Validation(_))
    ));
    let id = create_lokal(&mut conn, &neu("kurz")).await.unwrap();
    let gespeichert: String =
        sqlx::query_scalar("SELECT benutzer_name FROM unterschrift_schluessel WHERE id = ?")
            .bind(id)
            .fetch_one(&mut *conn)
            .await
            .unwrap();
    assert_eq!(gespeichert.chars().count(), NAME_MAX);
}

/// Zustand des vom Gegenüber gelieferten Schlüssels mit der id `fremde_id` dort.
async fn zustand_von(conn: &mut SqliteConnection, fremde_id: i64) -> String {
    sqlx::query_scalar(
        "SELECT zustand FROM unterschrift_schluessel WHERE herkunft = 'gegenueber' \
         AND fremde_id = ?",
    )
    .bind(fremde_id)
    .fetch_one(&mut *conn)
    .await
    .unwrap()
}

/// Grundstock mit dem Schlüssel von `a` (id 10), danach `b` (id 11) von `a` gegengezeichnet.
async fn mit_wartendem_b(
    pool: &SqlitePool,
    a: &SoftwarePasskey,
    b: &SoftwarePasskey,
) -> (i64, SqliteConnection) {
    let ko = kopplung_org(pool, InstanzKopplungRichtung::MeldetSich).await;
    let ziel = Ziel {
        kopplung_org_id: ko,
        org_id: 1,
        fremde_org_kennung: FREMDE_ORG,
    };
    let mut conn = pool.acquire().await.unwrap().detach();
    accept_lieferungen(
        &mut conn,
        &ziel,
        &[lieferung(10, a, UnterschriftSchluesselZustand::Gueltig, 1)],
        true,
        JETZT,
    )
    .await
    .unwrap();
    let neu = gegengezeichnet(
        lieferung(11, b, UnterschriftSchluesselZustand::Gueltig, 2),
        a,
        FREMDE_ORG,
    );
    accept_lieferungen(&mut conn, &ziel, &[neu], false, JETZT)
        .await
        .unwrap();
    (ko, conn)
}

fn ziel_zu(ko: i64) -> Ziel<'static> {
    Ziel {
        kopplung_org_id: ko,
        org_id: 1,
        fremde_org_kennung: FREMDE_ORG,
    }
}

#[tokio::test]
async fn wartender_schluessel_taugt_nicht_als_unterzeichner() {
    let pool = pool_mit_admin().await;
    let a = SoftwarePasskey::new("a", [1u8; 32]);
    let b = SoftwarePasskey::new("b", [2u8; 32]);
    let c = SoftwarePasskey::new("c", [3u8; 32]);
    let (ko, mut conn) = mit_wartendem_b(&pool, &a, &b).await;
    let von_b = gegengezeichnet(
        lieferung(12, &c, UnterschriftSchluesselZustand::Gueltig, 3),
        &b,
        FREMDE_ORG,
    );
    let ab = accept_lieferungen(&mut conn, &ziel_zu(ko), &[von_b], false, JETZT)
        .await
        .unwrap();
    assert_eq!(ab.len(), 1, "von einem wartenden Schlüssel gegengezeichnet");
    assert_eq!(gueltige_fremde(&mut conn).await, vec!["a"]);
}

#[tokio::test]
async fn widerruf_trifft_auch_einen_wartenden_schluessel() {
    let pool = pool_mit_admin().await;
    let a = SoftwarePasskey::new("a", [1u8; 32]);
    let b = SoftwarePasskey::new("b", [2u8; 32]);
    let (ko, mut conn) = mit_wartendem_b(&pool, &a, &b).await;
    accept_lieferungen(
        &mut conn,
        &ziel_zu(ko),
        &[lieferung(
            11,
            &b,
            UnterschriftSchluesselZustand::Widerrufen,
            3,
        )],
        false,
        JETZT,
    )
    .await
    .unwrap();
    assert_eq!(zustand_von(&mut conn, 11).await, "widerrufen");
}

#[tokio::test]
async fn erneute_lieferung_aendert_wartenden_und_abgelehnten_nicht() {
    let pool = pool_mit_admin().await;
    let a = SoftwarePasskey::new("a", [1u8; 32]);
    let b = SoftwarePasskey::new("b", [2u8; 32]);
    let (ko, mut conn) = mit_wartendem_b(&pool, &a, &b).await;
    let nochmal = || {
        gegengezeichnet(
            lieferung(11, &b, UnterschriftSchluesselZustand::Gueltig, 4),
            &a,
            FREMDE_ORG,
        )
    };
    accept_lieferungen(&mut conn, &ziel_zu(ko), &[nochmal()], false, JETZT)
        .await
        .unwrap();
    assert_eq!(zustand_von(&mut conn, 11).await, "wartet_auf_bestaetigung");
    sqlx::query("UPDATE unterschrift_schluessel SET zustand = 'abgelehnt' WHERE fremde_id = 11")
        .execute(&mut conn)
        .await
        .unwrap();
    accept_lieferungen(&mut conn, &ziel_zu(ko), &[nochmal()], false, JETZT)
        .await
        .unwrap();
    assert_eq!(zustand_von(&mut conn, 11).await, "abgelehnt");
    // Derselbe Schlüssel unter neuer id lebt nach einer Ablehnung nicht wieder auf.
    let neue_id = gegengezeichnet(
        lieferung(13, &b, UnterschriftSchluesselZustand::Gueltig, 5),
        &a,
        FREMDE_ORG,
    );
    let ab = accept_lieferungen(&mut conn, &ziel_zu(ko), &[neue_id], false, JETZT)
        .await
        .unwrap();
    assert_eq!(ab.len(), 1);
    assert_eq!(gueltige_fremde(&mut conn).await, vec!["a"]);
}

#[test]
fn fingerabdruck_ende_vergleicht_ohne_trennzeichen_und_schreibweise() {
    let fp = "ABCD-EFGH-JKMN-PQRS";
    assert!(is_fingerabdruck_ende(fp, "PQRS"));
    assert!(is_fingerabdruck_ende(fp, "pqrs"));
    assert!(is_fingerabdruck_ende(fp, " pq-rs "));
    assert!(!is_fingerabdruck_ende(fp, "QRS"), "zu kurz");
    assert!(!is_fingerabdruck_ende(fp, "NPQRS"), "zu lang");
    assert!(!is_fingerabdruck_ende(fp, "ABCD"), "Anfang statt Ende");
    assert!(!is_fingerabdruck_ende(fp, ""));
}

#[tokio::test]
async fn bestaetigen_und_zurueckweisen_nur_aus_dem_wartezustand() {
    let pool = pool_mit_admin().await;
    let a = SoftwarePasskey::new("a", [1u8; 32]);
    let b = SoftwarePasskey::new("b", [2u8; 32]);
    let (_, mut conn) = mit_wartendem_b(&pool, &a, &b).await;
    let id: i64 = sqlx::query_scalar("SELECT id FROM unterschrift_schluessel WHERE fremde_id = 11")
        .fetch_one(&mut conn)
        .await
        .unwrap();
    assert!(
        !confirm(&mut conn, 2, id, 1, JETZT).await.unwrap(),
        "fremde Org, solange er noch wartet"
    );
    assert_eq!(zustand_von(&mut conn, 11).await, "wartet_auf_bestaetigung");
    assert!(confirm(&mut conn, 1, id, 1, JETZT).await.unwrap());
    assert_eq!(zustand_von(&mut conn, 11).await, "gueltig");
    let (am, von): (Option<String>, Option<i64>) = sqlx::query_as(
        "SELECT entschieden_at, entschieden_von FROM unterschrift_schluessel WHERE id = ?",
    )
    .bind(id)
    .fetch_one(&mut conn)
    .await
    .unwrap();
    assert_eq!((am.as_deref(), von), (Some(JETZT), Some(1)));
    assert!(
        !confirm(&mut conn, 1, id, 1, JETZT).await.unwrap(),
        "zweimal"
    );
    assert!(
        !reject(&mut conn, 1, id, 1, JETZT).await.unwrap(),
        "schon gültig"
    );
    assert_eq!(gueltige_fremde(&mut conn).await, vec!["a", "b"]);
}

#[tokio::test]
async fn zurueckgewiesener_schluessel_bleibt_es() {
    let pool = pool_mit_admin().await;
    let a = SoftwarePasskey::new("a", [1u8; 32]);
    let b = SoftwarePasskey::new("b", [2u8; 32]);
    let (_, mut conn) = mit_wartendem_b(&pool, &a, &b).await;
    let id: i64 = sqlx::query_scalar("SELECT id FROM unterschrift_schluessel WHERE fremde_id = 11")
        .fetch_one(&mut conn)
        .await
        .unwrap();
    assert!(reject(&mut conn, 1, id, 1, JETZT).await.unwrap());
    assert_eq!(zustand_von(&mut conn, 11).await, "abgelehnt");
    assert!(!confirm(&mut conn, 1, id, 1, JETZT).await.unwrap());
    assert_eq!(zustand_von(&mut conn, 11).await, "abgelehnt");
    // Ein späterer Widerruf vom Gegenüber oder der Widerruf der Zuordnung überschreibt die
    // Entscheidung hier nicht: der Schlüssel bleibt „zurückgewiesen“ (design.md D1).
    let ko: i64 =
        sqlx::query_scalar("SELECT kopplung_org_id FROM unterschrift_schluessel WHERE id = ?")
            .bind(id)
            .fetch_one(&mut conn)
            .await
            .unwrap();
    accept_lieferungen(
        &mut conn,
        &ziel_zu(ko),
        &[lieferung(
            11,
            &b,
            UnterschriftSchluesselZustand::Widerrufen,
            9,
        )],
        false,
        JETZT,
    )
    .await
    .unwrap();
    assert_eq!(zustand_von(&mut conn, 11).await, "abgelehnt");
    fremde_der_zuordnung_widerrufen(&mut conn, ko, JETZT)
        .await
        .unwrap();
    assert_eq!(zustand_von(&mut conn, 11).await, "abgelehnt");
    assert_eq!(zustand_von(&mut conn, 10).await, "widerrufen");
}
