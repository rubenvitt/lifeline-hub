//! Repo-Tests der Schwärzungsanträge (LFH-751, Spec `aufbewahrung-loeschersuchen`).

use super::*;
use crate::einsatz::schwaerzung_person::testdaten::{
    self, Bestand, NACHBAR_KLARTEXTE, ZIEL_KLARTEXTE,
};
use chrono::Duration;

fn t(s: &str) -> DateTime<Utc> {
    crate::zeit::parse_utc(s).unwrap()
}

const T0: &str = "2026-10-02 08:00:00";

async fn etb_anzahl(pool: &SqlitePool, e: i64) -> i64 {
    sqlx::query_scalar("SELECT COUNT(*) FROM etb_eintrag WHERE einsatz_id = ?")
        .bind(e)
        .fetch_one(pool)
        .await
        .unwrap()
}

async fn antrag_anzahl(pool: &SqlitePool) -> i64 {
    sqlx::query_scalar("SELECT COUNT(*) FROM schwaerzung_antrag")
        .fetch_one(pool)
        .await
        .unwrap()
}

async fn etb_texte(pool: &SqlitePool, e: i64) -> Vec<String> {
    sqlx::query_scalar("SELECT inhalt FROM etb_eintrag WHERE einsatz_id = ? ORDER BY lfd_nr")
        .bind(e)
        .fetch_all(pool)
        .await
        .unwrap()
}

async fn stelle(
    pool: &SqlitePool,
    b: &Bestand,
    einsatz: i64,
    ziel: AntragZiel,
    bestaetigung: &str,
    jetzt: &str,
) -> Result<i64, AppError> {
    stellen(
        pool,
        einsatz,
        b.admin,
        b.org_id,
        ziel,
        "DS-2026-014",
        bestaetigung,
        t(jetzt),
    )
    .await
}

fn betroffene(id: i64) -> AntragZiel {
    AntragZiel::Person(PersonenArt::Betroffene, id)
}

// ---------- 1.1 Datenbank ----------

#[tokio::test]
async fn datenbank_haelt_hoechstens_einen_offenen_antrag_je_ziel() {
    let pool = crate::db::test_pool().await;
    let b = testdaten::anlegen(&pool).await;
    let ins = |ziel_art: &'static str, ziel_id: Option<i64>| {
        let pool = pool.clone();
        async move {
            sqlx::query(
                "INSERT INTO schwaerzung_antrag (einsatz_id, ziel_art, ziel_id, aktenzeichen, \
                    beantragt_von, beantragt_at, faellig_at) VALUES (?, ?, ?, 'AZ', ?, ?, ?)",
            )
            .bind(b.e1)
            .bind(ziel_art)
            .bind(ziel_id)
            .bind(b.admin)
            .bind(T0)
            .bind(T0)
            .execute(&pool)
            .await
        }
    };
    ins("einsatz", None).await.unwrap();
    assert!(
        ins("einsatz", None).await.is_err(),
        "zweiter offener Einsatz-Antrag"
    );
    ins("betroffene", Some(b.p1)).await.unwrap();
    assert!(ins("betroffene", Some(b.p1)).await.is_err());
    ins("betroffene", Some(b.p2)).await.unwrap();
    // CHECK: Einsatz ohne, Person mit ziel_id.
    assert!(ins("einsatz", Some(b.p1)).await.is_err());
    assert!(ins("medienkontakt", None).await.is_err());
}

// ---------- 3.1 Antrag stellen ----------

#[tokio::test]
async fn antrag_fuer_person_mit_audit_ohne_namen() {
    let pool = crate::db::test_pool().await;
    let b = testdaten::anlegen(&pool).await;
    let id = stelle(&pool, &b, b.e1, betroffene(b.p1), " R-001 ", T0)
        .await
        .unwrap();
    let liste = liste(&pool, b.e1, t(T0)).await.unwrap();
    assert_eq!(liste.len(), 1);
    let a = &liste[0];
    assert_eq!(a.id, id);
    assert_eq!(a.ziel_art, AntragZielArt::Betroffene);
    assert_eq!(a.ziel_kennung, "R-001");
    assert_eq!(a.faellig_at, "2026-10-03 08:00:00");
    assert_eq!(a.stand, AntragStand::Offen);
    assert!(a.zuruecknehmbar);

    let texte = etb_texte(&pool, b.e1).await.join("\n");
    assert!(
        texte.contains("DS-2026-014") && texte.contains("R-001"),
        "{texte}"
    );
    for k in ZIEL_KLARTEXTE {
        assert!(!texte.contains(k), "{k} im Audit");
    }
    // Der Antrag ändert keine Angabe der Person.
    let name: Option<String> = sqlx::query_scalar("SELECT name FROM einsatz_person WHERE id = ?")
        .bind(b.p1)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(name.as_deref(), Some("Yilmaz"));
}

#[tokio::test]
async fn ablehnungen_schreiben_nichts() {
    let pool = crate::db::test_pool().await;
    let b = testdaten::anlegen(&pool).await;
    let etb0 = etb_anzahl(&pool, b.e1).await;
    let faelle: Vec<(AntragZiel, &str, i64, i64, &str)> = vec![
        // (Ziel, Bestätigung, Einsatz, Org, erwarteter Code)
        (betroffene(b.p1), "R-002", b.e1, b.org_id, "422"),
        (betroffene(b.p_e2), "R-001", b.e1, b.org_id, "404"),
        (
            AntragZiel::Person(PersonenArt::ExterneKraft, b.k_stamm),
            "EK-0",
            b.e1,
            b.org_id,
            "422",
        ),
        (
            AntragZiel::Person(PersonenArt::Medienkontakt, 999_999),
            "MK-999999",
            b.e1,
            b.org_id,
            "404",
        ),
        (AntragZiel::Einsatz, "E-2026-0751", 999_999, b.org_id, "404"),
        (AntragZiel::Einsatz, "E-2026-0751", b.e1, 2, "403"),
        (AntragZiel::Einsatz, "E-2026-0752", b.e1, b.org_id, "422"),
    ];
    for (ziel, best, einsatz, org, code) in faelle {
        let err = stellen(&pool, einsatz, b.admin, org, ziel, "AZ", best, t(T0))
            .await
            .unwrap_err();
        let ist = match err {
            AppError::UnprocessableEntity(_) => "422",
            AppError::NotFound => "404",
            AppError::Forbidden => "403",
            AppError::Conflict(_) => "409",
            ref e => panic!("unerwartet {e:?}"),
        };
        assert_eq!(ist, code, "{ziel:?}/{best}");
    }
    assert_eq!(etb_anzahl(&pool, b.e1).await, etb0);
    assert_eq!(antrag_anzahl(&pool).await, 0);
}

#[tokio::test]
async fn aktiver_einsatz_ist_409() {
    let pool = crate::db::test_pool().await;
    let b = testdaten::anlegen_mit_status(&pool, "aktiv").await;
    let err = stelle(&pool, &b, b.e1, AntragZiel::Einsatz, "E-2026-0751", T0)
        .await
        .unwrap_err();
    assert!(matches!(err, AppError::Conflict(_)), "{err:?}");
    assert_eq!(antrag_anzahl(&pool).await, 0);
}

#[tokio::test]
async fn doppelt_409_nach_ruecknahme_neu_vollzogen_409() {
    let pool = crate::db::test_pool().await;
    let b = testdaten::anlegen(&pool).await;
    let a1 = stelle(&pool, &b, b.e1, betroffene(b.p1), "R-001", T0)
        .await
        .unwrap();
    assert!(matches!(
        stelle(&pool, &b, b.e1, betroffene(b.p1), "R-001", T0).await,
        Err(AppError::Conflict(_))
    ));
    zuruecknehmen(&pool, b.e1, a1, b.admin, t(T0) + Duration::hours(1))
        .await
        .unwrap();
    let a2 = stelle(
        &pool,
        &b,
        b.e1,
        betroffene(b.p1),
        "R-001",
        "2026-10-02 10:00:00",
    )
    .await
    .unwrap();
    assert!(vollziehen(&pool, a2, t("2026-10-03 10:00:00"))
        .await
        .unwrap());
    let err = stelle(
        &pool,
        &b,
        b.e1,
        betroffene(b.p1),
        "R-001",
        "2026-10-04 10:00:00",
    )
    .await
    .unwrap_err();
    assert!(
        matches!(&err, AppError::Conflict(m) if m.contains("bereits auf Antrag geschwärzt")),
        "{err:?}"
    );
}

#[tokio::test]
async fn geschwaerzter_einsatz_ist_409() {
    let pool = crate::db::test_pool().await;
    let b = testdaten::anlegen(&pool).await;
    sqlx::query("UPDATE einsatz SET geloescht_at = ?1, geschwaerzt_at = ?1 WHERE id = ?2")
        .bind(T0)
        .bind(b.e1)
        .execute(&pool)
        .await
        .unwrap();
    assert!(matches!(
        stelle(&pool, &b, b.e1, AntragZiel::Einsatz, "E-2026-0751", T0).await,
        Err(AppError::Conflict(_))
    ));
}

#[test]
fn aktenzeichen_form() {
    assert!(matches!(
        pruefe_aktenzeichen("   "),
        Err(AppError::Validation(_))
    ));
    assert!(matches!(
        pruefe_aktenzeichen(&"x".repeat(65)),
        Err(AppError::Validation(_))
    ));
    assert_eq!(pruefe_aktenzeichen(" DS-1 ").unwrap(), "DS-1");
    assert_eq!(
        pruefe_aktenzeichen(&"ä".repeat(64))
            .unwrap()
            .chars()
            .count(),
        64
    );
}

// ---------- 3.2 Rücknahme ----------

#[tokio::test]
async fn ruecknahme_grenzen() {
    let pool = crate::db::test_pool().await;
    let b = testdaten::anlegen(&pool).await;
    let a = stelle(&pool, &b, b.e1, betroffene(b.p1), "R-001", T0)
        .await
        .unwrap();
    // Fremder Einsatz → 404.
    assert!(matches!(
        zuruecknehmen(&pool, b.e2, a, b.admin, t(T0)).await,
        Err(AppError::NotFound)
    ));
    // Nach 3 h: zurückgenommen, mit Eintrag.
    let etb0 = etb_anzahl(&pool, b.e1).await;
    zuruecknehmen(&pool, b.e1, a, b.admin, t(T0) + Duration::hours(3))
        .await
        .unwrap();
    assert_eq!(etb_anzahl(&pool, b.e1).await, etb0 + 1);
    let l = liste(&pool, b.e1, t(T0)).await.unwrap();
    assert_eq!(l[0].stand, AntragStand::Zurueckgenommen);
    assert_eq!(l[0].zurueckgenommen_von_name.as_deref(), Some("Admin"));
    // Zweite Rücknahme → 409, nichts geschrieben.
    assert!(matches!(
        zuruecknehmen(&pool, b.e1, a, b.admin, t(T0) + Duration::hours(4)).await,
        Err(AppError::Conflict(_))
    ));
    assert_eq!(etb_anzahl(&pool, b.e1).await, etb0 + 1);
    // Vollzug findet nichts.
    assert!(!vollziehen(&pool, a, t(T0) + Duration::hours(30))
        .await
        .unwrap());
}

#[tokio::test]
async fn ruecknahme_nach_25_stunden_ist_409_und_vollzug_folgt() {
    let pool = crate::db::test_pool().await;
    let b = testdaten::anlegen(&pool).await;
    let a = stelle(&pool, &b, b.e1, betroffene(b.p1), "R-001", T0)
        .await
        .unwrap();
    // Genau 24 h: nicht mehr zurücknehmbar.
    assert!(matches!(
        zuruecknehmen(&pool, b.e1, a, b.admin, t(T0) + Duration::hours(24)).await,
        Err(AppError::Conflict(_))
    ));
    assert!(matches!(
        zuruecknehmen(&pool, b.e1, a, b.admin, t(T0) + Duration::hours(25)).await,
        Err(AppError::Conflict(_))
    ));
    assert!(vollziehen(&pool, a, t(T0) + Duration::hours(25))
        .await
        .unwrap());
    assert!(matches!(
        zuruecknehmen(&pool, b.e1, a, b.admin, t(T0) + Duration::hours(26)).await,
        Err(AppError::Conflict(_))
    ));
}

// ---------- 3.3 / 3.4 Vollzug ----------

#[tokio::test]
async fn vollzug_person_23h_nichts_24h_geschwaerzt_zweiter_lauf_nichts() {
    let pool = crate::db::test_pool().await;
    let b = testdaten::anlegen(&pool).await;
    let a = stelle(&pool, &b, b.e1, betroffene(b.p1), "R-001", T0)
        .await
        .unwrap();
    assert_eq!(
        vollziehe_faellige(
            &pool,
            &crate::live::LiveHub::new(),
            t(T0) + Duration::hours(23)
        )
        .await,
        0
    );
    assert!(testdaten::alle_texte(&pool).await.contains("Yilmaz"));

    let etb0 = etb_anzahl(&pool, b.e1).await;
    assert_eq!(
        vollziehe_faellige(
            &pool,
            &crate::live::LiveHub::new(),
            t(T0) + Duration::hours(24)
        )
        .await,
        1
    );
    let texte = testdaten::alle_texte(&pool).await;
    for k in [
        "Yilmaz",
        "Ayse",
        "0171 2345678",
        "Hund-Chip-276",
        "Gartenweg 7",
    ] {
        assert!(!texte.contains(k), "{k} steht noch");
    }
    for n in NACHBAR_KLARTEXTE {
        assert!(texte.contains(n), "{n} fehlt");
    }
    assert_eq!(etb_anzahl(&pool, b.e1).await, etb0 + 1);
    let l = liste(&pool, b.e1, t(T0) + Duration::hours(24))
        .await
        .unwrap();
    assert_eq!(l[0].id, a);
    assert_eq!(l[0].stand, AntragStand::Vollzogen);
    assert!(!l[0].zuruecknehmbar);
    // Erfasser des Vollzugs ist die antragstellende Person.
    let erfasser: i64 = sqlx::query_scalar(
        "SELECT erfasser_id FROM etb_eintrag WHERE einsatz_id = ? ORDER BY lfd_nr DESC LIMIT 1",
    )
    .bind(b.e1)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(erfasser, b.admin);

    assert_eq!(
        vollziehe_faellige(
            &pool,
            &crate::live::LiveHub::new(),
            t(T0) + Duration::hours(25)
        )
        .await,
        0
    );
    assert_eq!(etb_anzahl(&pool, b.e1).await, etb0 + 1);
    // Einsatz ist dadurch NICHT geschwärzt.
    let g: Option<String> = sqlx::query_scalar("SELECT geschwaerzt_at FROM einsatz WHERE id = ?")
        .bind(b.e1)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(g, None);
}

#[tokio::test]
async fn vollzug_einsatz_mit_frist_in_5_jahren_wie_fristbasiert() {
    let pool = crate::db::test_pool().await;
    let b = testdaten::anlegen(&pool).await;
    let p = stelle(&pool, &b, b.e1, betroffene(b.p2), "R-002", T0)
        .await
        .unwrap();
    let a = stelle(&pool, &b, b.e1, AntragZiel::Einsatz, "E-2026-0751", T0)
        .await
        .unwrap();
    // Eine Datenkategorie mit eigener Frist (LFH-749): die Schwärzung auf Antrag nimmt sie mit
    // wie die fristbasierte.
    sqlx::query(
        "INSERT INTO einsatz_aufbewahrung_kategorie (einsatz_id, kategorie, frist_bis, \
         rechtsgrundlage) VALUES (?, 'behandlung', '2036-10-01 00:00:00', 'Test')",
    )
    .bind(b.e1)
    .execute(&pool)
    .await
    .unwrap();
    // Vollzug nur des Einsatz-Antrags (der Personen-Antrag hat dieselbe Fälligkeit; hier
    // gezielt der Einsatz-Antrag zuerst).
    assert!(vollziehen(&pool, a, t(T0) + Duration::hours(24))
        .await
        .unwrap());
    let (g, s): (Option<String>, Option<String>) =
        sqlx::query_as("SELECT geloescht_at, geschwaerzt_at FROM einsatz WHERE id = ?")
            .bind(b.e1)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(g.as_deref(), Some("2026-10-03 08:00:00"));
    assert_eq!(s.as_deref(), Some("2026-10-03 08:00:00"));
    let k: Option<String> = sqlx::query_scalar(
        "SELECT geschwaerzt_at FROM einsatz_aufbewahrung_kategorie WHERE einsatz_id = ?",
    )
    .bind(b.e1)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(k.as_deref(), Some("2026-10-03 08:00:00"));
    let texte = testdaten::alle_texte(&pool).await;
    for k in ZIEL_KLARTEXTE.iter().chain(
        NACHBAR_KLARTEXTE
            .iter()
            .filter(|n| !["Stamm-Dora", "Anderer Einsatz Meier", "Meier-Foto-E2.jpg"].contains(n)),
    ) {
        assert!(
            !texte.contains(k),
            "{k} steht nach der Einsatz-Schwärzung noch"
        );
    }
    // Stammkraft-Snapshot und der andere Einsatz bleiben.
    assert!(
        texte.contains("Stamm-Dora")
            && texte.contains("Anderer Einsatz Meier")
            && texte.contains("Meier-Foto-E2.jpg")
    );
    // Der offene Personen-Antrag gilt als vollzogen.
    let l = liste(&pool, b.e1, t(T0) + Duration::hours(24))
        .await
        .unwrap();
    assert!(l.iter().all(|x| x.stand == AntragStand::Vollzogen), "{l:?}");
    assert!(!vollziehen(&pool, p, t(T0) + Duration::hours(25))
        .await
        .unwrap());
    let audit = etb_texte(&pool, b.e1).await.join("\n");
    assert!(audit.contains(
        "PII-Schwärzung durchgeführt (Löschersuchen nach Art. 17 DSGVO für Einsatz E-2026-0751, Aktenzeichen DS-2026-014)"
    ));
}

#[tokio::test]
async fn vollzug_rollt_bei_fehler_im_audit_zurueck() {
    let pool = crate::db::test_pool().await;
    let b = testdaten::anlegen(&pool).await;
    let a = stelle(&pool, &b, b.e1, betroffene(b.p1), "R-001", T0)
        .await
        .unwrap();
    sqlx::query(
        "CREATE TRIGGER lfh751_kein_etb BEFORE INSERT ON etb_eintrag \
         BEGIN SELECT RAISE(ABORT, 'Probe'); END",
    )
    .execute(&pool)
    .await
    .unwrap();
    assert!(vollziehen(&pool, a, t(T0) + Duration::hours(24))
        .await
        .is_err());
    assert!(testdaten::alle_texte(&pool).await.contains("Yilmaz"));
    let l = liste(&pool, b.e1, t(T0) + Duration::hours(24))
        .await
        .unwrap();
    assert_eq!(l[0].stand, AntragStand::Offen);
    sqlx::query("DROP TRIGGER lfh751_kein_etb")
        .execute(&pool)
        .await
        .unwrap();
    assert_eq!(
        vollziehe_faellige(
            &pool,
            &crate::live::LiveHub::new(),
            t(T0) + Duration::hours(25)
        )
        .await,
        1
    );
    assert!(!testdaten::alle_texte(&pool).await.contains("Yilmaz"));
}

#[tokio::test]
async fn antrag_an_fristbasiert_geschwaerztem_einsatz_wird_ohne_scrub_erledigt() {
    let pool = crate::db::test_pool().await;
    let b = testdaten::anlegen(&pool).await;
    let a = stelle(&pool, &b, b.e1, betroffene(b.p1), "R-001", T0)
        .await
        .unwrap();
    sqlx::query("UPDATE einsatz SET geloescht_at = ?1, geschwaerzt_at = ?1 WHERE id = ?2")
        .bind(T0)
        .bind(b.e1)
        .execute(&pool)
        .await
        .unwrap();
    assert!(!vollziehen(&pool, a, t(T0) + Duration::hours(24))
        .await
        .unwrap());
    let l = liste(&pool, b.e1, t(T0) + Duration::hours(24))
        .await
        .unwrap();
    assert_eq!(l[0].stand, AntragStand::Vollzogen);
    assert!(etb_texte(&pool, b.e1)
        .await
        .last()
        .unwrap()
        .contains("bereits geschwärzt"));
}

#[tokio::test]
async fn offener_einsatz_antrag_liefert_faelligkeit() {
    let pool = crate::db::test_pool().await;
    let b = testdaten::anlegen(&pool).await;
    assert_eq!(offener_einsatz_antrag(&pool, b.e1).await.unwrap(), None);
    stelle(&pool, &b, b.e1, betroffene(b.p1), "R-001", T0)
        .await
        .unwrap();
    assert_eq!(offener_einsatz_antrag(&pool, b.e1).await.unwrap(), None);
    let a = stelle(&pool, &b, b.e1, AntragZiel::Einsatz, "E-2026-0751", T0)
        .await
        .unwrap();
    assert_eq!(
        offener_einsatz_antrag(&pool, b.e1)
            .await
            .unwrap()
            .as_deref(),
        Some("2026-10-03 08:00:00")
    );
    zuruecknehmen(&pool, b.e1, a, b.admin, t(T0)).await.unwrap();
    assert_eq!(offener_einsatz_antrag(&pool, b.e1).await.unwrap(), None);
    let _ = b.leitung;
}

/// Review LFH-751: die fristbasierte Schwärzung erfüllt offene Anträge mit — danach ist keiner
/// mehr zurücknehmbar.
#[tokio::test]
async fn fristbasierte_schwaerzung_schliesst_offene_antraege() {
    let pool = crate::db::test_pool().await;
    let b = testdaten::anlegen(&pool).await;
    let a = stelle(&pool, &b, b.e1, betroffene(b.p1), "R-001", T0)
        .await
        .unwrap();
    sqlx::query("UPDATE einsatz SET geloescht_at = '2026-01-01 00:00:00' WHERE id = ?")
        .bind(b.e1)
        .execute(&pool)
        .await
        .unwrap();
    assert!(
        crate::einsatz::repo::schwaerze_einsatz(&pool, b.e1, "2026-10-02 09:00:00")
            .await
            .unwrap()
    );
    let l = liste(&pool, b.e1, t(T0)).await.unwrap();
    assert_eq!(l[0].stand, AntragStand::Vollzogen);
    assert!(!l[0].zuruecknehmbar);
    assert!(matches!(
        zuruecknehmen(&pool, b.e1, a, b.admin, t(T0)).await,
        Err(AppError::Conflict(_))
    ));
}

// ---------- LFH-996: Schwärzungsstand und Meldungen ----------

async fn kopf_stand(pool: &SqlitePool, e: i64) -> Option<i64> {
    crate::einsatz::repo::laden(pool, e)
        .await
        .unwrap()
        .teilschwaerzungen
}

async fn listen_stand(pool: &SqlitePool, benutzer: i64, e: i64) -> Option<i64> {
    let b: crate::auth::Benutzer = sqlx::query_as("SELECT * FROM benutzer WHERE id = ?")
        .bind(benutzer)
        .fetch_one(pool)
        .await
        .unwrap();
    crate::einsatz::repo::liste_fuer(pool, &b)
        .await
        .unwrap()
        .into_iter()
        .find(|a| a.id == e)
        .expect("Einsatz in der Liste")
        .teilschwaerzungen
}

/// Spec `einsatzkopf-live`, „Schwärzungsstand im Einsatzkopf“: vollzogene Personen-Anträge
/// zählen in Kopf und Liste, offene nicht, und der Nachbareinsatz bleibt ohne Feld.
#[tokio::test]
async fn teilschwaerzungen_zaehlt_vollzogene_personen_antraege() {
    let pool = crate::db::test_pool().await;
    let b = testdaten::anlegen(&pool).await;
    stelle(&pool, &b, b.e1, betroffene(b.p1), "R-001", T0)
        .await
        .unwrap();
    assert_eq!(kopf_stand(&pool, b.e1).await, None, "offen zählt nicht");
    vollziehe_faellige(
        &pool,
        &crate::live::LiveHub::new(),
        t(T0) + Duration::hours(24),
    )
    .await;
    assert_eq!(kopf_stand(&pool, b.e1).await, Some(1));
    assert_eq!(listen_stand(&pool, b.admin, b.e1).await, Some(1));
    assert_eq!(kopf_stand(&pool, b.e2).await, None);
    assert_eq!(listen_stand(&pool, b.admin, b.e2).await, None);

    stelle(
        &pool,
        &b,
        b.e1,
        betroffene(b.p2),
        "R-002",
        "2026-10-04 08:00:00",
    )
    .await
    .unwrap();
    vollziehe_faellige(
        &pool,
        &crate::live::LiveHub::new(),
        t("2026-10-05 08:00:00"),
    )
    .await;
    assert_eq!(kopf_stand(&pool, b.e1).await, Some(2));
}

/// Leert einen Einsatz-Empfänger und liefert die Ereignisse.
fn einsatz_ereignisse(
    rx: &mut tokio::sync::broadcast::Receiver<crate::live::LiveNachricht>,
) -> Vec<crate::live::LiveEvent> {
    let mut aus = Vec::new();
    while let Ok(n) = rx.try_recv() {
        aus.push(n.event);
    }
    aus
}

fn org_ereignisse(
    rx: &mut tokio::sync::broadcast::Receiver<crate::live::org::OrgNachricht>,
) -> Vec<crate::live::org::OrgLiveEvent> {
    let mut aus = Vec::new();
    while let Ok(n) = rx.try_recv() {
        aus.push(n.event);
    }
    aus
}

/// Spec `aufbewahrung-loeschersuchen`, „Vollzug erreicht offene Clients und Geräte“: nach dem
/// Vollzug für eine Person gehen `einsatz` an den Strom und `einsatzliste` an die Leser.
#[tokio::test]
async fn vollzug_person_meldet_kopf_und_liste() {
    let pool = crate::db::test_pool().await;
    let b = testdaten::anlegen(&pool).await;
    stelle(&pool, &b, b.e1, betroffene(b.p1), "R-001", T0)
        .await
        .unwrap();
    let live = crate::live::LiveHub::new();
    let mut rx = live.abonniere(b.e1);
    let mut org = live.abonniere_org();
    assert_eq!(
        vollziehe_faellige(&pool, &live, t(T0) + Duration::hours(24)).await,
        1
    );
    assert!(einsatz_ereignisse(&mut rx).contains(&crate::live::LiveEvent::Einsatz));
    assert!(org_ereignisse(&mut org).contains(&crate::live::org::OrgLiveEvent::Einsatzliste));
}

/// Dasselbe für den Einsatz-Antrag: der offene Tab ruft den Kopf ab und räumt am 404.
#[tokio::test]
async fn vollzug_einsatz_meldet_kopf_und_liste() {
    let pool = crate::db::test_pool().await;
    let b = testdaten::anlegen(&pool).await;
    stelle(&pool, &b, b.e1, AntragZiel::Einsatz, "E-2026-0751", T0)
        .await
        .unwrap();
    let live = crate::live::LiveHub::new();
    let mut rx = live.abonniere(b.e1);
    let mut org = live.abonniere_org();
    assert_eq!(
        vollziehe_faellige(&pool, &live, t(T0) + Duration::hours(24)).await,
        1
    );
    assert!(einsatz_ereignisse(&mut rx).contains(&crate::live::LiveEvent::Einsatz));
    assert!(org_ereignisse(&mut org).contains(&crate::live::org::OrgLiveEvent::Einsatzliste));
}

/// Spec „Vollzug ohne Wirkung“: war der Einsatz schon geschwärzt, meldet der Vollzug nichts.
#[tokio::test]
async fn vollzug_ohne_wirkung_meldet_nichts() {
    let pool = crate::db::test_pool().await;
    let b = testdaten::anlegen(&pool).await;
    stelle(&pool, &b, b.e1, betroffene(b.p1), "R-001", T0)
        .await
        .unwrap();
    sqlx::query("UPDATE einsatz SET geloescht_at = ?1, geschwaerzt_at = ?1 WHERE id = ?2")
        .bind(T0)
        .bind(b.e1)
        .execute(&pool)
        .await
        .unwrap();
    let live = crate::live::LiveHub::new();
    let mut rx = live.abonniere(b.e1);
    let mut org = live.abonniere_org();
    assert_eq!(
        vollziehe_faellige(&pool, &live, t(T0) + Duration::hours(24)).await,
        0
    );
    assert_eq!(einsatz_ereignisse(&mut rx), vec![]);
    assert_eq!(org_ereignisse(&mut org), vec![]);
}
