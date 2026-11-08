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
    let k = kopplung::kopplung_anlegen_oder_erneuern(
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
    kopplung::org_zuordnen(&mut conn, k, 1, FREMDE_ORG, "Hub-Org", Some(1))
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
        schluessel_hash: sha256_b64(&b64_lesen(&l.schluessel).unwrap()),
        fingerabdruck: "x".into(),
        inhaber: l.benutzer_name.clone(),
        zeitpunkt: JETZT.into(),
    })
    .unwrap();
    let assertion = unterzeichner.unterschreibe(&erklaerung, ORIGIN, RP, 0x05);
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
    let a = SoftwarePasskey::neu("a", [1u8; 32]);
    let ziel = Ziel {
        kopplung_org_id: ko,
        org_id: 1,
        fremde_org_kennung: FREMDE_ORG,
    };
    let mut conn = pool.acquire().await.unwrap();
    let abgelehnt = annehmen(
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
    let a = SoftwarePasskey::neu("a", [1u8; 32]);
    let boese = SoftwarePasskey::neu("boese", [9u8; 32]);
    let ziel = Ziel {
        kopplung_org_id: ko,
        org_id: 1,
        fremde_org_kennung: FREMDE_ORG,
    };
    let mut conn = pool.acquire().await.unwrap();
    annehmen(
        &mut conn,
        &ziel,
        &[lieferung(10, &a, UnterschriftSchluesselZustand::Gueltig, 1)],
        true,
        JETZT,
    )
    .await
    .unwrap();
    // Ohne Gegenzeichnung
    let ab = annehmen(
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
    let ab = annehmen(&mut conn, &ziel, &[selbst], false, JETZT)
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
    let ab = annehmen(&mut conn, &ziel, &[falsche_org], false, JETZT)
        .await
        .unwrap();
    assert_eq!(ab.len(), 1);
    // Gegenzeichnung eines anderen Schlüssels untergeschoben
    let mut fremd = gegengezeichnet(
        lieferung(11, &boese, UnterschriftSchluesselZustand::Gueltig, 2),
        &a,
        FREMDE_ORG,
    );
    fremd.schluessel = SoftwarePasskey::neu("boese", [8u8; 32]).oeffentlich();
    let ab = annehmen(&mut conn, &ziel, &[fremd], false, JETZT)
        .await
        .unwrap();
    assert_eq!(ab.len(), 1);
    assert_eq!(gueltige_fremde(&mut conn).await, vec!["a"]);
}

#[tokio::test]
async fn gegengezeichneter_schluessel_wird_angenommen_und_widerruf_uebernommen() {
    let pool = pool_mit_admin().await;
    let ko = kopplung_org(&pool, InstanzKopplungRichtung::MeldetSich).await;
    let a = SoftwarePasskey::neu("a", [1u8; 32]);
    let b = SoftwarePasskey::neu("b", [2u8; 32]);
    let ziel = Ziel {
        kopplung_org_id: ko,
        org_id: 1,
        fremde_org_kennung: FREMDE_ORG,
    };
    let mut conn = pool.acquire().await.unwrap();
    annehmen(
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
    let ab = annehmen(&mut conn, &ziel, &[neu], false, JETZT)
        .await
        .unwrap();
    assert!(ab.is_empty(), "{ab:?}");
    assert_eq!(gueltige_fremde(&mut conn).await, vec!["a", "b"]);
    // Widerruf ohne Gegenzeichnung
    annehmen(
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
    assert_eq!(gueltige_fremde(&mut conn).await, vec!["b"]);
    // Ein widerrufener lebt nicht wieder auf
    annehmen(
        &mut conn,
        &ziel,
        &[lieferung(10, &a, UnterschriftSchluesselZustand::Gueltig, 4)],
        true,
        JETZT,
    )
    .await
    .unwrap();
    assert_eq!(gueltige_fremde(&mut conn).await, vec!["b"]);
}

#[tokio::test]
async fn lokaler_schluessel_gilt_ohne_kopplung_und_wartet_mit() {
    let pool = pool_mit_admin().await;
    let a = SoftwarePasskey::neu("a", [1u8; 32]);
    let mut conn = pool.acquire().await.unwrap();
    let schluessel_a = a.oeffentlich();
    let id_a = anlegen_lokal(
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
        laden(&mut conn, 1, id_a).await.unwrap().zustand(),
        UnterschriftSchluesselZustand::Gueltig
    );
    drop(conn);
    // Jetzt verteilt die Org ihre Schlüssel (wir stellen aus).
    kopplung_org(&pool, InstanzKopplungRichtung::WirdGemeldet).await;
    let mut conn = pool.acquire().await.unwrap();
    assert!(ist_letzter_bei_kopplung(&mut conn, 1, id_a).await.unwrap());
    let b = SoftwarePasskey::neu("b", [2u8; 32]);
    let schluessel_b = b.oeffentlich();
    let id_b = anlegen_lokal(
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
        laden(&mut conn, 1, id_b).await.unwrap().zustand(),
        UnterschriftSchluesselZustand::WartetAufGegenzeichnung
    );
    // Wartende gehen nicht hinaus, nur der gültige.
    let (grund, _) = grundstock(&mut conn, 1).await.unwrap();
    assert_eq!(grund.len(), 1);
    assert!(nachlieferung(&mut conn, 1, 0)
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
    let n = nachlieferung(&mut conn, 1, 1).await.unwrap();
    assert_eq!(n.len(), 1);
    assert_eq!(n[0].zustand, UnterschriftSchluesselZustand::Widerrufen);
}
