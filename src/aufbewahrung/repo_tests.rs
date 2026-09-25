//! Repo-Tests der Aufbewahrung (LFH-23). Fixtures direkt per SQL, `jetzt` injiziert.

use super::repo::{self, ArchivEtbFilter};
use crate::einsatz::retention::AufbewahrungZustand;
use crate::etb::EtbTyp;
use chrono::{DateTime, NaiveDateTime, Utc};
use sqlx::SqlitePool;

fn t(s: &str) -> DateTime<Utc> {
    NaiveDateTime::parse_from_str(s, "%Y-%m-%d %H:%M:%S")
        .unwrap()
        .and_utc()
}

const JETZT: &str = "2026-06-30 12:00:00";

async fn grundlage(pool: &SqlitePool) -> i64 {
    sqlx::query("INSERT OR IGNORE INTO organisation (id, name) VALUES (1, 'Orga'), (2, 'Fremd')")
        .execute(pool)
        .await
        .unwrap();
    sqlx::query_scalar(
        "INSERT INTO benutzer (org_id, anzeigename, benutzername, passwort_hash, system_rolle) \
         VALUES (1,'Anna Admin','admin','h','admin') RETURNING id",
    )
    .fetch_one(pool)
    .await
    .unwrap()
}

/// Einsatz in `org` mit Status, Frist und Tombstones; Kopf-PII gesetzt.
async fn einsatz(
    pool: &SqlitePool,
    org: i64,
    bezeichnung: &str,
    status: &str,
    frist: Option<&str>,
    geloescht: Option<&str>,
    geschwaerzt: Option<&str>,
) -> i64 {
    sqlx::query_scalar(
        "INSERT INTO einsatz (org_id, bezeichnung, status, abgeschlossen_at, retention_bis, \
            geloescht_at, geschwaerzt_at, einsatznummer_intern, einsatzort, meldende_stelle, \
            sachverhalt) \
         VALUES (?, ?, ?, CASE WHEN ? = 'abgeschlossen' THEN '2026-01-01 00:00:00' END, ?, ?, ?, \
            'E-' || ?, 'Hauptstr 3, Familie Mustermann', 'Anrufer Herr Mustermann', \
            'Betroffener im OG eingeschlossen') RETURNING id",
    )
    .bind(org)
    .bind(bezeichnung)
    .bind(status)
    .bind(status)
    .bind(frist)
    .bind(geloescht)
    .bind(geschwaerzt)
    .bind(bezeichnung)
    .fetch_one(pool)
    .await
    .unwrap()
}

#[tokio::test]
async fn uebersicht_nur_abgeschlossene_der_org_mit_zustand() {
    let pool = crate::db::test_pool().await;
    grundlage(&pool).await;
    let ohne = einsatz(&pool, 1, "ohne", "abgeschlossen", None, None, None).await;
    let laeuft = einsatz(
        &pool,
        1,
        "laeuft",
        "abgeschlossen",
        Some("2026-12-01 00:00:00"),
        None,
        None,
    )
    .await;
    let faellig = einsatz(
        &pool,
        1,
        "faellig",
        "abgeschlossen",
        Some("2026-06-01 00:00:00"),
        None,
        None,
    )
    .await;
    let vorgemerkt = einsatz(
        &pool,
        1,
        "vorgemerkt",
        "abgeschlossen",
        Some("2026-06-01 00:00:00"),
        Some("2026-06-27 12:00:00"),
        None,
    )
    .await;
    let ausstehend = einsatz(
        &pool,
        1,
        "ausstehend",
        "abgeschlossen",
        Some("2026-05-01 00:00:00"),
        Some("2026-05-30 12:00:00"),
        None,
    )
    .await;
    let geschwaerzt = einsatz(
        &pool,
        1,
        "geschwaerzt",
        "abgeschlossen",
        Some("2026-03-01 00:00:00"),
        Some("2026-03-02 00:00:00"),
        Some("2026-04-01 00:00:00"),
    )
    .await;
    let _aktiv = einsatz(
        &pool,
        1,
        "aktiv",
        "aktiv",
        Some("2026-01-01 00:00:00"),
        None,
        None,
    )
    .await;
    let _fremd = einsatz(&pool, 2, "fremd", "abgeschlossen", None, None, None).await;

    let liste = repo::uebersicht(&pool, 1, t(JETZT)).await.unwrap();
    let mut paare: Vec<(i64, AufbewahrungZustand)> =
        liste.iter().map(|e| (e.einsatz_id, e.zustand)).collect();
    paare.sort_by_key(|(id, _)| *id);
    use AufbewahrungZustand::*;
    assert_eq!(
        paare,
        vec![
            (ohne, OhneFrist),
            (laeuft, FristLaeuft),
            (faellig, Faellig),
            (vorgemerkt, Vorgemerkt),
            (ausstehend, SchwaerzungAusstehend),
            (geschwaerzt, Geschwaerzt),
        ],
        "nur abgeschlossene Einsätze der eigenen Org, je mit Zustand"
    );
    let v = liste.iter().find(|e| e.einsatz_id == vorgemerkt).unwrap();
    assert_eq!(v.karenz_ende.as_deref(), Some("2026-07-27 12:00:00"));
    assert_eq!(v.einsatznummer_intern.as_deref(), Some("E-vorgemerkt"));

    // Keine personenbezogene Angabe in der Übersicht.
    let text = serde_json::to_string(&liste).unwrap();
    assert!(!text.contains("Mustermann"), "{text}");
    assert!(!text.contains("eingeschlossen"), "{text}");
}

#[tokio::test]
async fn akte_waehrend_karenz_traegt_keine_personendaten() {
    let pool = crate::db::test_pool().await;
    let admin = grundlage(&pool).await;
    let e = einsatz(
        &pool,
        1,
        "Hochwasser",
        "abgeschlossen",
        Some("2026-06-01 00:00:00"),
        Some("2026-06-27 12:00:00"),
        None,
    )
    .await;
    sqlx::query(
        "INSERT INTO einsatz_person (einsatz_id, registrier_nr, status, name, vorname, geburtsdatum, \
            herkunft_adresse, antreff_ort, melder_kontakt, notiz, zustand, aktuelle_sichtung, \
            aktuelle_verbleib_art, aktuelles_verbleib_ziel, aktueller_verbleib_status, \
            erfasst_von, geaendert_von) \
         VALUES (?,1,'betroffen','Mustermann','Erika','1980-01-01','Lindenweg 7','Keller', \
            'Tochter 0170 111','Diabetikerin','unterkühlt','sk2','transport','Klinikum Nord', \
            'abtransportiert', ?, ?)",
    )
    .bind(e)
    .bind(admin)
    .bind(admin)
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query(
        "INSERT INTO einsatz_tier (einsatz_id, registrier_nr, spezies, rufname, halter_kontakt, \
            antreff_ort, notiz, kennzeichnung, erfasst_von, geaendert_von) \
         VALUES (?,1,'hund','Bello','Halterin 0170 222','Scheune','bissig','CHIP-276098', ?, ?)",
    )
    .bind(e)
    .bind(admin)
    .bind(admin)
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query(
        "INSERT INTO einsatz_schaden (einsatz_id, registrier_nr, status, typ, ausmass, ort, \
            beschreibung, geschaedigt_kontakt, erfasst_von, geaendert_von) \
         VALUES (?,1,'offen','sachschaden','mittel','Birkenallee 9','Dach abgedeckt', \
            'Eigentümer 0170 333', ?, ?)",
    )
    .bind(e)
    .bind(admin)
    .bind(admin)
    .execute(&pool)
    .await
    .unwrap();

    let kopf = repo::kopf_laden(&pool, e).await.unwrap().unwrap();
    let akte = repo::akte(&pool, &kopf, t(JETZT)).await.unwrap();
    assert_eq!(akte.zustand, AufbewahrungZustand::Vorgemerkt);
    assert_eq!(akte.karenz_ende.as_deref(), Some("2026-07-27 12:00:00"));
    assert_eq!(akte.personen.len(), 1);
    assert_eq!(akte.personen[0].registrier_anzeige, "R-001");
    assert_eq!(
        akte.personen[0].aktuelle_sichtung,
        Some(crate::person::Sichtungskategorie::Sk2)
    );
    assert_eq!(akte.tiere[0].registrier_anzeige, "T-001");
    assert_eq!(akte.schaeden[0].registrier_anzeige, "S-001");

    let wert = serde_json::to_value(&akte).unwrap();
    let kopf_obj = wert["kopf"].as_object().unwrap();
    for k in [
        "einsatzort",
        "einsatzort_lat",
        "meldende_stelle",
        "sachverhalt",
    ] {
        assert!(!kopf_obj.contains_key(k), "Kopf darf {k} nicht tragen");
    }
    for (liste, verboten) in [
        (
            "personen",
            &[
                "name",
                "vorname",
                "geburtsdatum",
                "herkunft_adresse",
                "antreff_ort",
                "melder_kontakt",
                "notiz",
                "zustand",
                "aktuelles_verbleib_ziel",
            ][..],
        ),
        (
            "tiere",
            &[
                "rufname",
                "halter_kontakt",
                "antreff_ort",
                "notiz",
                "kennzeichnung",
            ][..],
        ),
        (
            "schaeden",
            &["ort", "beschreibung", "geschaedigt_kontakt", "lat", "lon"][..],
        ),
    ] {
        let obj = wert[liste][0].as_object().unwrap();
        for k in verboten {
            assert!(!obj.contains_key(*k), "{liste} darf {k} nicht tragen");
        }
    }
    let text = wert.to_string();
    for gepflanzt in [
        "Erika",
        "Mustermann",
        "Hauptstr",
        "eingeschlossen",
        "Lindenweg",
        "0170",
        "Diabetikerin",
        "Klinikum Nord",
        "Bello",
        "CHIP-276098",
        "Birkenallee",
        "Dach abgedeckt",
        "Keller",
        "Scheune",
        "unterkühlt",
    ] {
        assert!(
            !text.contains(gepflanzt),
            "„{gepflanzt}“ in der Akte: {text}"
        );
    }
}

#[tokio::test]
async fn akte_eines_aktiven_einsatzes_ist_konflikt() {
    let pool = crate::db::test_pool().await;
    grundlage(&pool).await;
    let e = einsatz(&pool, 1, "aktiv", "aktiv", None, None, None).await;
    let kopf = repo::kopf_laden(&pool, e).await.unwrap().unwrap();
    assert!(matches!(
        repo::akte(&pool, &kopf, t(JETZT)).await,
        Err(crate::error::AppError::Conflict(_))
    ));
    assert!(repo::kopf_laden(&pool, 999_999).await.unwrap().is_none());
}

#[tokio::test]
async fn archiv_etb_filtert_nach_typ_und_blaettert_ueber_lfd_nr() {
    let pool = crate::db::test_pool().await;
    let admin = grundlage(&pool).await;
    let e = einsatz(&pool, 1, "etb", "abgeschlossen", None, None, None).await;
    for (nr, typ) in [
        (1, "meldung"),
        (2, "system"),
        (3, "berichtigung"),
        (4, "system"),
        (5, "lage"),
    ] {
        sqlx::query(
            "INSERT INTO etb_eintrag (einsatz_id, lfd_nr, typ, inhalt, erfasser_id, ereigniszeit, \
                berichtigt_eintrag_id) \
             VALUES (?, ?, ?, 'Eintrag ' || ?, ?, '2026-01-01 09:00:00', \
                CASE WHEN ? = 3 THEN (SELECT id FROM etb_eintrag WHERE einsatz_id = ? AND lfd_nr = 1) END)",
        )
        .bind(e)
        .bind(nr)
        .bind(typ)
        .bind(nr)
        .bind(admin)
        .bind(nr)
        .bind(e)
        .execute(&pool)
        .await
        .unwrap();
    }
    let alle = repo::etb(
        &pool,
        e,
        ArchivEtbFilter {
            typ: None,
            before_lfd_nr: None,
            limit: 2,
        },
    )
    .await
    .unwrap();
    assert_eq!(
        alle.iter().map(|x| x.lfd_nr).collect::<Vec<_>>(),
        vec![5, 4],
        "neueste zuerst, Seitengröße"
    );
    assert_eq!(alle[0].erfasser_name, "Anna Admin");
    let weiter = repo::etb(
        &pool,
        e,
        ArchivEtbFilter {
            typ: None,
            before_lfd_nr: Some(4),
            limit: 10,
        },
    )
    .await
    .unwrap();
    assert_eq!(
        weiter.iter().map(|x| x.lfd_nr).collect::<Vec<_>>(),
        vec![3, 2, 1]
    );
    let erster = weiter.iter().find(|x| x.lfd_nr == 1).unwrap().id;
    assert_eq!(
        weiter
            .iter()
            .find(|x| x.lfd_nr == 3)
            .unwrap()
            .berichtigt_eintrag_id,
        Some(erster)
    );
    let system = repo::etb(
        &pool,
        e,
        ArchivEtbFilter {
            typ: Some(EtbTyp::System),
            before_lfd_nr: None,
            limit: 10,
        },
    )
    .await
    .unwrap();
    assert_eq!(
        system.iter().map(|x| x.lfd_nr).collect::<Vec<_>>(),
        vec![4, 2]
    );
}

#[tokio::test]
async fn tombstones_in_allen_drei_zustaenden() {
    let pool = crate::db::test_pool().await;
    grundlage(&pool).await;
    let offen = einsatz(&pool, 1, "a", "abgeschlossen", None, None, None).await;
    let vorgemerkt = einsatz(
        &pool,
        1,
        "b",
        "abgeschlossen",
        None,
        Some("2026-06-01 00:00:00"),
        None,
    )
    .await;
    let geschwaerzt = einsatz(
        &pool,
        1,
        "c",
        "abgeschlossen",
        None,
        Some("2026-06-01 00:00:00"),
        Some("2026-07-01 00:00:00"),
    )
    .await;
    assert_eq!(repo::tombstones(&pool, offen).await.unwrap(), (None, None));
    assert_eq!(
        repo::tombstones(&pool, vorgemerkt).await.unwrap(),
        (Some("2026-06-01 00:00:00".into()), None)
    );
    assert_eq!(
        repo::tombstones(&pool, geschwaerzt).await.unwrap(),
        (
            Some("2026-06-01 00:00:00".into()),
            Some("2026-07-01 00:00:00".into())
        )
    );
    assert!(matches!(
        repo::tombstones(&pool, 999_999).await,
        Err(crate::error::AppError::NotFound)
    ));
}
