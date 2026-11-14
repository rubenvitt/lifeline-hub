//! Tests der Aufbewahrung je Kategorie.

use super::super::repo::{anlegen, NeuerEinsatzDaten};
use super::*;

/// Org 1, ein Benutzer und ein aktiver Einsatz; liefert `(einsatz_id, benutzer_id)`.
pub(super) async fn einsatz_mit_leitung(pool: &SqlitePool) -> (i64, i64) {
    sqlx::query("INSERT OR IGNORE INTO organisation (id, name) VALUES (1, 'Orga')")
        .execute(pool)
        .await
        .unwrap();
    let leit: i64 = sqlx::query_scalar(
        "INSERT INTO benutzer (org_id, anzeigename, benutzername, passwort_hash) \
             VALUES (1, 'leit', 'leit', 'h') RETURNING id",
    )
    .fetch_one(pool)
    .await
    .unwrap();
    let einsatz = anlegen(
        pool,
        NeuerEinsatzDaten {
            bezeichnung: "Lage",
            stichwort: None,
            einsatzart: None,
            begonnen_at: None,
            ort: Default::default(),
            vorlage_id: None,
        },
        leit,
    )
    .await
    .unwrap();
    (einsatz.id, leit)
}

/// Eine Person mit jedem personenbezogenen Feld gesetzt; liefert ihre id.
pub(super) async fn volle_person(pool: &SqlitePool, einsatz: i64, nr: i64, von: i64) -> i64 {
    sqlx::query_scalar(
        "INSERT INTO einsatz_person (einsatz_id, registrier_nr, status, name, vorname, \
                geschlecht, geburtsdatum, alter_geschaetzt, herkunft_adresse, antreff_ort, \
                melder_kontakt, notiz, aktueller_verbleib, zustand, antreff_lat, antreff_lon, \
                aktuelles_verbleib_ziel, erfasst_von, geaendert_von) \
             VALUES (?, ?, 'betroffen', 'Mustermann', 'Erika', 'weiblich', '1970-01-01', 55, \
                'Hauptstr. 5', 'Marktplatz', '0170 123', 'Notiz', 'Transport → KH', NULL, \
                52.1, 9.1, 'KH Mitte', ?, ?) RETURNING id",
    )
    .bind(einsatz)
    .bind(nr)
    .bind(von)
    .bind(von)
    .fetch_one(pool)
    .await
    .unwrap()
}

type PersonFelder = (
    Option<String>,
    Option<String>,
    Option<String>,
    Option<String>,
    Option<String>,
    Option<String>,
);

/// `(name, geburtsdatum, herkunft_adresse, melder_kontakt, antreff_ort, aktuelles_verbleib_ziel)`.
pub(super) async fn person_felder(pool: &SqlitePool, id: i64) -> PersonFelder {
    sqlx::query_as(
        "SELECT name, geburtsdatum, herkunft_adresse, melder_kontakt, antreff_ort, \
                aktuelles_verbleib_ziel FROM einsatz_person WHERE id = ?",
    )
    .bind(id)
    .fetch_one(pool)
    .await
    .unwrap()
}

/// Org-Vorgabe direkt in der DB (die Route deckt `tests/org_einstellungen.rs` ab).
pub(super) async fn org_vorgabe(pool: &SqlitePool, k: Datenkategorie, tage: i64, rg: &str) {
    sqlx::query(
        "INSERT INTO org_aufbewahrung_kategorie (org_id, kategorie, dauer_tage, \
                rechtsgrundlage, geaendert_at) VALUES (1, ?, ?, ?, datetime('now')) \
             ON CONFLICT(org_id, kategorie) DO UPDATE SET dauer_tage = excluded.dauer_tage, \
                rechtsgrundlage = excluded.rechtsgrundlage",
    )
    .bind(k.as_str())
    .bind(tage)
    .bind(rg)
    .execute(pool)
    .await
    .unwrap();
}

pub(super) async fn etb_texte(pool: &SqlitePool, einsatz: i64) -> Vec<String> {
    sqlx::query_scalar("SELECT inhalt FROM etb_eintrag WHERE einsatz_id = ? ORDER BY id")
        .bind(einsatz)
        .fetch_all(pool)
        .await
        .unwrap()
}

// ---------- Kategorie-Frist beim Abschluss ----------

#[tokio::test]
async fn abschluss_legt_kategorie_frist_mit_etb_an() {
    let pool = crate::db::test_pool().await;
    let (einsatz, leit) = einsatz_mit_leitung(&pool).await;
    org_vorgabe(
        &pool,
        Datenkategorie::Personenauskunft,
        0,
        "§ 46 Abs. 5 BHKG NRW",
    )
    .await;
    org_vorgabe(&pool, Datenkategorie::Anhaenge, 30, "§ 32b Abs. 3 NKatSG").await;

    let e = super::super::repo::abschliessen(&pool, einsatz, leit)
        .await
        .unwrap();
    let abgeschlossen_at = e.einsatz.abgeschlossen_at.unwrap();

    let zeilen = laden(&pool, einsatz).await.unwrap();
    assert_eq!(zeilen.len(), 2);
    let finde = |k: Datenkategorie| zeilen.iter().find(|z| z.kategorie == k).unwrap();
    let auskunft = finde(Datenkategorie::Personenauskunft);
    assert_eq!(
        auskunft.frist_bis.as_deref(),
        Some(abgeschlossen_at.as_str())
    );
    assert_eq!(auskunft.rechtsgrundlage, "§ 46 Abs. 5 BHKG NRW");
    assert_eq!(auskunft.vorgemerkt_at, None);
    assert_eq!(
        finde(Datenkategorie::Anhaenge).frist_bis,
        berechne_retention_bis(&abgeschlossen_at, 30)
    );

    let etb = etb_texte(&pool, einsatz).await;
    let eintrag = etb
        .iter()
        .find(|t| t.contains("„Personenauskunft“"))
        .expect("ETB-Eintrag zur Kategorie-Frist");
    // Die Frist (= Abschluss bei 0 Tagen) in der Vorgabe-Zeitdarstellung (LLH-1540).
    let frist = crate::zeitdarstellung::Zeitstil::VORGABE.zeitpunkt_text(&abgeschlossen_at);
    assert!(
        eintrag.contains(&format!("gesetzt auf {frist} ")),
        "{eintrag}"
    );
    assert!(eintrag.contains("§ 46 Abs. 5 BHKG NRW"));
    assert!(etb.iter().any(|t| t.contains("„Anhänge“")));

    // Beide Einträge kommen als Kennung zurück, damit die Route sie live meldet (LFH-858).
    let mut gemeldet: Vec<String> = Vec::new();
    for id in &e.etb_eintrag_ids {
        gemeldet.push(
            sqlx::query_scalar("SELECT inhalt FROM etb_eintrag WHERE id = ? AND einsatz_id = ?")
                .bind(id)
                .bind(einsatz)
                .fetch_one(&pool)
                .await
                .unwrap(),
        );
    }
    assert_eq!(gemeldet.len(), 2, "{gemeldet:?}");
    assert!(gemeldet.iter().any(|t| t.contains("„Personenauskunft“")));
    assert!(gemeldet.iter().any(|t| t.contains("„Anhänge“")));
}

#[tokio::test]
async fn abschluss_ohne_vorgabe_legt_nichts_an() {
    let pool = crate::db::test_pool().await;
    let (einsatz, leit) = einsatz_mit_leitung(&pool).await;
    let vorher = etb_texte(&pool, einsatz).await.len();
    super::super::repo::abschliessen(&pool, einsatz, leit)
        .await
        .unwrap();
    assert!(laden(&pool, einsatz).await.unwrap().is_empty());
    assert!(etb_texte(&pool, einsatz)
        .await
        .iter()
        .skip(vorher)
        .all(|t| !t.contains("Datenkategorie")));
}

#[tokio::test]
async fn spaetere_org_aenderung_und_zweiter_abschluss_lassen_frist_stehen() {
    let pool = crate::db::test_pool().await;
    let (einsatz, leit) = einsatz_mit_leitung(&pool).await;
    org_vorgabe(
        &pool,
        Datenkategorie::Behandlung,
        3650,
        "§ 630f BGB entsprechend",
    )
    .await;
    super::super::repo::abschliessen(&pool, einsatz, leit)
        .await
        .unwrap();
    let vorher = laden(&pool, einsatz).await.unwrap();

    org_vorgabe(&pool, Datenkategorie::Behandlung, 10, "neu").await;
    // Zweiter Abschluss ist ein No-Op (Einsatz schon abgeschlossen).
    super::super::repo::abschliessen(&pool, einsatz, leit)
        .await
        .unwrap();
    assert_eq!(laden(&pool, einsatz).await.unwrap(), vorher);
    let anzahl = etb_texte(&pool, einsatz)
        .await
        .iter()
        .filter(|t| t.contains("„Behandlung“"))
        .count();
    assert_eq!(anzahl, 1, "kein zweiter Eintrag");
}

// ---------- Kategorie-Frist am Einsatz (frist_setzen) ----------

fn t(s: &str) -> DateTime<Utc> {
    crate::zeit::parse_utc(s).unwrap()
}

const JETZT: &str = "2026-06-30 12:00:00";

/// Abgeschlossener Einsatz mit Org-Vorgabe `personenauskunft` (Frist ab Abschluss + 30 T).
async fn abgeschlossen_mit_kategorie(pool: &SqlitePool) -> (i64, i64) {
    let (einsatz, leit) = einsatz_mit_leitung(pool).await;
    org_vorgabe(pool, Datenkategorie::Personenauskunft, 30, "RG").await;
    super::super::repo::abschliessen(pool, einsatz, leit)
        .await
        .unwrap();
    sqlx::query(
        "UPDATE einsatz_aufbewahrung_kategorie SET frist_bis = '2026-07-30 12:00:00' \
             WHERE einsatz_id = ?",
    )
    .bind(einsatz)
    .execute(pool)
    .await
    .unwrap();
    (einsatz, leit)
}

fn aend(
    k: Datenkategorie,
    neu: Option<&'static str>,
    rg: Option<&'static str>,
    bestaetigt: bool,
) -> FristAenderung<'static> {
    FristAenderung {
        kategorie: k,
        neue_frist: neu,
        rechtsgrundlage: rg,
        bestaetigt,
    }
}

async fn zeile(pool: &SqlitePool, einsatz: i64, k: Datenkategorie) -> Option<KategorieZeile> {
    laden(pool, einsatz)
        .await
        .unwrap()
        .into_iter()
        .find(|z| z.kategorie == k)
}

#[tokio::test]
async fn frist_setzen_verlaengern_verkuerzen_aufheben() {
    let pool = crate::db::test_pool().await;
    let (einsatz, leit) = abgeschlossen_mit_kategorie(&pool).await;
    let auskunft = Datenkategorie::Personenauskunft;
    let n_etb = || async { etb_texte(&pool, einsatz).await.len() };

    // Unverändert: kein Schreibvorgang, kein ETB-Eintrag.
    let vorher = n_etb().await;
    let r = frist_setzen(
        &pool,
        einsatz,
        leit,
        aend(auskunft, Some("2026-07-30 12:00:00"), None, false),
        t(JETZT),
    )
    .await
    .unwrap();
    assert_eq!(r, FristErgebnis::Unveraendert);
    assert_eq!(n_etb().await, vorher);

    // Verlängern ohne Bestätigung.
    let r = frist_setzen(
        &pool,
        einsatz,
        leit,
        aend(auskunft, Some("2026-12-01 00:00:00"), None, false),
        t(JETZT),
    )
    .await
    .unwrap();
    assert_eq!(r, FristErgebnis::Geaendert);
    let etb = etb_texte(&pool, einsatz).await;
    let letzter = etb.last().unwrap();
    assert!(letzter.contains("„Personenauskunft“"), "{letzter}");
    // Alte und neue Frist in der Vorgabe-Zeitdarstellung (LLH-1540).
    assert!(
        letzter.contains("geändert von 301400jul26 auf 010100dez26"),
        "{letzter}"
    );

    // Verkürzen ohne Bestätigung → 409, nichts geändert.
    let err = frist_setzen(
        &pool,
        einsatz,
        leit,
        aend(auskunft, Some("2026-08-01 00:00:00"), None, false),
        t(JETZT),
    )
    .await
    .unwrap_err();
    assert_eq!(err.status(), axum::http::StatusCode::CONFLICT);
    assert_eq!(
        zeile(&pool, einsatz, auskunft)
            .await
            .unwrap()
            .frist_bis
            .as_deref(),
        Some("2026-12-01 00:00:00")
    );
    // Mit Bestätigung → gilt.
    frist_setzen(
        &pool,
        einsatz,
        leit,
        aend(auskunft, Some("2026-08-01 00:00:00"), None, true),
        t(JETZT),
    )
    .await
    .unwrap();
    assert_eq!(
        zeile(&pool, einsatz, auskunft)
            .await
            .unwrap()
            .frist_bis
            .as_deref(),
        Some("2026-08-01 00:00:00")
    );

    // Gleiche Frist, neue Rechtsgrundlage: Änderung mit altem und neuem Wert im ETB.
    let r = frist_setzen(
        &pool,
        einsatz,
        leit,
        aend(
            auskunft,
            Some("2026-08-01 00:00:00"),
            Some("§ 152 StPO"),
            false,
        ),
        t(JETZT),
    )
    .await
    .unwrap();
    assert_eq!(r, FristErgebnis::Geaendert);
    let letzter = etb_texte(&pool, einsatz).await.last().unwrap().clone();
    assert!(
        letzter.contains("„RG“") && letzter.contains("„§ 152 StPO“"),
        "{letzter}"
    );

    // Aufheben: folgt der Einsatz-Frist; das ETB nennt den alten Wert.
    frist_setzen(
        &pool,
        einsatz,
        leit,
        aend(auskunft, None, None, false),
        t(JETZT),
    )
    .await
    .unwrap();
    assert_eq!(
        zeile(&pool, einsatz, auskunft).await.unwrap().frist_bis,
        None
    );
    let letzter = etb_texte(&pool, einsatz).await.last().unwrap().clone();
    assert!(
        letzter.contains("aufgehoben (bisher 010200aug26"),
        "{letzter}"
    );

    // Ohne Frist vorher und nachher: eine Rechtsgrundlage allein schreibt nichts.
    let vorher = n_etb().await;
    let r = frist_setzen(
        &pool,
        einsatz,
        leit,
        aend(Datenkategorie::Anhaenge, None, Some("X"), false),
        t(JETZT),
    )
    .await
    .unwrap();
    assert_eq!(r, FristErgebnis::Unveraendert);
    assert_eq!(n_etb().await, vorher);
    assert_eq!(zeile(&pool, einsatz, Datenkategorie::Anhaenge).await, None);
}

#[tokio::test]
async fn erste_frist_braucht_rechtsgrundlage() {
    let pool = crate::db::test_pool().await;
    let (einsatz, leit) = abgeschlossen_mit_kategorie(&pool).await;
    let anhaenge = Datenkategorie::Anhaenge;
    let err = frist_setzen(
        &pool,
        einsatz,
        leit,
        aend(anhaenge, Some("2027-01-01 00:00:00"), None, true),
        t(JETZT),
    )
    .await
    .unwrap_err();
    assert_eq!(err.status(), axum::http::StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(zeile(&pool, einsatz, anhaenge).await, None);

    // Erstmaliges Setzen ist eine Verkürzung (wie bei der Einsatz-Frist): ohne Bestätigung 409.
    let err = frist_setzen(
        &pool,
        einsatz,
        leit,
        aend(
            anhaenge,
            Some("2027-01-01 00:00:00"),
            Some("§ 152 StPO"),
            false,
        ),
        t(JETZT),
    )
    .await
    .unwrap_err();
    assert_eq!(err.status(), axum::http::StatusCode::CONFLICT);

    frist_setzen(
        &pool,
        einsatz,
        leit,
        aend(
            anhaenge,
            Some("2027-01-01 00:00:00"),
            Some("§ 152 StPO"),
            true,
        ),
        t(JETZT),
    )
    .await
    .unwrap();
    let z = zeile(&pool, einsatz, anhaenge).await.unwrap();
    assert_eq!(z.rechtsgrundlage, "§ 152 StPO");
    assert!(etb_texte(&pool, einsatz)
        .await
        .last()
        .unwrap()
        .contains("§ 152 StPO"));
}

#[tokio::test]
async fn karenz_wiederherstellen_und_sperren() {
    let pool = crate::db::test_pool().await;
    let (einsatz, leit) = abgeschlossen_mit_kategorie(&pool).await;
    let auskunft = Datenkategorie::Personenauskunft;
    let setze_vormerkung = |v: &'static str| {
        let pool = pool.clone();
        async move {
            sqlx::query(
                "UPDATE einsatz_aufbewahrung_kategorie SET frist_bis = '2026-06-20 00:00:00', \
                        vorgemerkt_at = ? WHERE einsatz_id = ? AND kategorie = 'personenauskunft'",
            )
            .bind(v)
            .bind(einsatz)
            .execute(&pool)
            .await
            .unwrap();
        }
    };

    // 5 Tage vorgemerkt: Frist in der Vergangenheit → 422.
    setze_vormerkung("2026-06-25 12:00:00").await;
    let err = frist_setzen(
        &pool,
        einsatz,
        leit,
        aend(auskunft, Some("2026-06-29 00:00:00"), None, true),
        t(JETZT),
    )
    .await
    .unwrap_err();
    assert_eq!(err.status(), axum::http::StatusCode::UNPROCESSABLE_ENTITY);
    // Künftige Frist → Vormerkung zurückgenommen.
    frist_setzen(
        &pool,
        einsatz,
        leit,
        aend(auskunft, Some("2026-08-29 00:00:00"), None, false),
        t(JETZT),
    )
    .await
    .unwrap();
    let z = zeile(&pool, einsatz, auskunft).await.unwrap();
    assert_eq!(z.vorgemerkt_at, None);
    assert_eq!(z.frist_bis.as_deref(), Some("2026-08-29 00:00:00"));
    assert!(etb_texte(&pool, einsatz)
        .await
        .last()
        .unwrap()
        .contains("Löschvormerkung"));

    // 31 Tage vorgemerkt: Karenz abgelaufen → 409, nichts geändert.
    setze_vormerkung("2026-05-30 12:00:00").await;
    let err = frist_setzen(
        &pool,
        einsatz,
        leit,
        aend(auskunft, Some("2026-09-01 00:00:00"), None, false),
        t(JETZT),
    )
    .await
    .unwrap_err();
    assert_eq!(err.status(), axum::http::StatusCode::CONFLICT);
    assert_eq!(
        zeile(&pool, einsatz, auskunft)
            .await
            .unwrap()
            .vorgemerkt_at
            .as_deref(),
        Some("2026-05-30 12:00:00")
    );

    // Geschwärzte Kategorie → 409.
    sqlx::query(
        "UPDATE einsatz_aufbewahrung_kategorie SET geschwaerzt_at = '2026-06-29 00:00:00' \
             WHERE einsatz_id = ?",
    )
    .bind(einsatz)
    .execute(&pool)
    .await
    .unwrap();
    let err = frist_setzen(
        &pool,
        einsatz,
        leit,
        aend(auskunft, Some("2026-09-01 00:00:00"), None, false),
        t(JETZT),
    )
    .await
    .unwrap_err();
    assert_eq!(err.status(), axum::http::StatusCode::CONFLICT);
}

/// LLH-1540: Organisation New York, Einsatz Tokio (UTC+9) in der gegebenen Darstellung.
async fn zeitstil_einsatz_tokio(pool: &SqlitePool, einsatz: i64, darstellung: &str) {
    sqlx::query(
        "INSERT INTO org_einstellungen (org_id, zeitzone, zeitdarstellung) \
             VALUES (1, 'America/New_York', 'datum_uhrzeit') \
             ON CONFLICT (org_id) DO UPDATE SET zeitzone = excluded.zeitzone, \
                zeitdarstellung = excluded.zeitdarstellung",
    )
    .execute(pool)
    .await
    .unwrap();
    sqlx::query(
        "INSERT INTO einsatz_einstellungen (einsatz_id, zeitzone, zeitdarstellung) \
             VALUES (?, 'Asia/Tokyo', ?) \
             ON CONFLICT (einsatz_id) DO UPDATE SET zeitzone = excluded.zeitzone, \
                zeitdarstellung = excluded.zeitdarstellung",
    )
    .bind(einsatz)
    .bind(darstellung)
    .execute(pool)
    .await
    .unwrap();
}

/// LLH-1540, Spec `zeitdarstellung`, „Servertexte“: jeder ETB-Text der Kategorie-Frist nennt
/// Fristen und Vormerkung in Zone und Darstellung des Einsatzes (Tokio), nicht der
/// Organisation (New York) und nicht als UTC-String.
#[tokio::test]
async fn kategorie_fristen_im_etb_folgen_dem_zeitstil_des_einsatzes() {
    use crate::zeitdarstellung::{Zeitdarstellung, Zeitstil};
    // (Darstellung, 30.07. 12:00Z, 01.12. 00:00Z, 20.06. 00:00Z, 25.06. 12:00Z, 29.08. 00:00Z)
    for (darstellung, d, juli, dez, juni20, juni25, aug) in [
        (
            "taktisch",
            Zeitdarstellung::Taktisch,
            "302100jul26",
            "010900dez26",
            "200900jun26",
            "252100jun26",
            "290900aug26",
        ),
        (
            "datum_uhrzeit",
            Zeitdarstellung::DatumUhrzeit,
            "30.07.26 21:00",
            "01.12.26 09:00",
            "20.06.26 09:00",
            "25.06.26 21:00",
            "29.08.26 09:00",
        ),
    ] {
        let pool = crate::db::test_pool().await;
        let (einsatz, leit) = einsatz_mit_leitung(&pool).await;
        zeitstil_einsatz_tokio(&pool, einsatz, darstellung).await;
        org_vorgabe(&pool, Datenkategorie::Personenauskunft, 30, "RG").await;
        let auskunft = Datenkategorie::Personenauskunft;
        let letzter = || async { etb_texte(&pool, einsatz).await.last().unwrap().clone() };

        // Abschluss: „automatisch gesetzt auf …“.
        super::super::repo::abschliessen(&pool, einsatz, leit)
            .await
            .unwrap();
        let frist = zeile(&pool, einsatz, auskunft)
            .await
            .unwrap()
            .frist_bis
            .unwrap();
        let tokio = Zeitstil::new(chrono_tz::Asia::Tokyo, d);
        let auto = etb_texte(&pool, einsatz)
            .await
            .into_iter()
            .find(|t| t.contains("automatisch gesetzt auf"))
            .unwrap();
        assert!(
            auto.contains(&format!(
                "automatisch gesetzt auf {} ",
                tokio.zeitpunkt_text(&frist)
            )),
            "{darstellung}: {auto}"
        );
        assert!(!auto.contains(&frist), "kein UTC-String: {auto}");

        // „geändert von … auf …“.
        sqlx::query(
            "UPDATE einsatz_aufbewahrung_kategorie SET frist_bis = '2026-07-30 12:00:00' \
                 WHERE einsatz_id = ?",
        )
        .bind(einsatz)
        .execute(&pool)
        .await
        .unwrap();
        frist_setzen(
            &pool,
            einsatz,
            leit,
            aend(auskunft, Some("2026-12-01 00:00:00"), None, false),
            t(JETZT),
        )
        .await
        .unwrap();
        let text = letzter().await;
        assert!(
            text.contains(&format!("geändert von {juli} auf {dez}")),
            "{darstellung}: {text}"
        );

        // Gleiche Frist, neue Rechtsgrundlage: „unverändert …“.
        frist_setzen(
            &pool,
            einsatz,
            leit,
            aend(auskunft, Some("2026-12-01 00:00:00"), Some("neu"), false),
            t(JETZT),
        )
        .await
        .unwrap();
        let text = letzter().await;
        assert!(
            text.contains(&format!("unverändert {dez}")),
            "{darstellung}: {text}"
        );

        // „aufgehoben (bisher …)“.
        frist_setzen(
            &pool,
            einsatz,
            leit,
            aend(auskunft, None, None, false),
            t(JETZT),
        )
        .await
        .unwrap();
        let text = letzter().await;
        assert!(
            text.contains(&format!("aufgehoben (bisher {dez};")),
            "{darstellung}: {text}"
        );

        // Erste Frist einer weiteren Kategorie: „gesetzt auf …“.
        frist_setzen(
            &pool,
            einsatz,
            leit,
            aend(
                Datenkategorie::Anhaenge,
                Some("2026-12-01 00:00:00"),
                Some("X"),
                true,
            ),
            t(JETZT),
        )
        .await
        .unwrap();
        let text = letzter().await;
        assert!(
            text.contains(&format!("„Anhänge“ gesetzt auf {dez}")),
            "{darstellung}: {text}"
        );

        // In der Karenz: „Löschvormerkung vom … aufgehoben“, dazu die alte und neue Frist.
        sqlx::query(
            "UPDATE einsatz_aufbewahrung_kategorie SET frist_bis = '2026-06-20 00:00:00', \
                    vorgemerkt_at = '2026-06-25 12:00:00' \
                 WHERE einsatz_id = ? AND kategorie = 'personenauskunft'",
        )
        .bind(einsatz)
        .execute(&pool)
        .await
        .unwrap();
        frist_setzen(
            &pool,
            einsatz,
            leit,
            aend(auskunft, Some("2026-08-29 00:00:00"), None, false),
            t(JETZT),
        )
        .await
        .unwrap();
        let text = letzter().await;
        assert!(
            text.contains(&format!("geändert von {juni20} auf {aug}"))
                && text.contains(&format!("Löschvormerkung vom {juni25} aufgehoben")),
            "{darstellung}: {text}"
        );
    }
}

async fn frist_gesetzt_at(pool: &SqlitePool, einsatz: i64, k: Datenkategorie) -> Option<String> {
    sqlx::query_scalar(
        "SELECT frist_gesetzt_at FROM einsatz_aufbewahrung_kategorie \
             WHERE einsatz_id = ? AND kategorie = ?",
    )
    .bind(einsatz)
    .bind(k.as_str())
    .fetch_one(pool)
    .await
    .unwrap()
}

/// LFH-1049, design.md D2: jeder Schreibweg der Kategorie-Frist hält fest, wann sie gesetzt
/// wurde. Der Abschluss gilt als Zeitpunkt der automatischen Frist, eine manuelle Frist und
/// das Wiederherstellen in der Karenz als ihr Aufruf; ein Aufruf ohne Änderung schreibt nichts.
#[tokio::test]
async fn frist_gesetzt_at_folgt_jedem_schreibweg() {
    let pool = crate::db::test_pool().await;
    let (einsatz, leit) = einsatz_mit_leitung(&pool).await;
    org_vorgabe(&pool, Datenkategorie::Personenauskunft, 30, "RG").await;
    let e = super::super::repo::abschliessen(&pool, einsatz, leit)
        .await
        .unwrap();
    let auskunft = Datenkategorie::Personenauskunft;
    assert_eq!(
        frist_gesetzt_at(&pool, einsatz, auskunft).await,
        e.einsatz.abgeschlossen_at,
        "die automatische Frist gilt als beim Abschluss gesetzt"
    );

    frist_setzen(
        &pool,
        einsatz,
        leit,
        aend(auskunft, Some("2099-01-01 00:00:00"), None, false),
        t(JETZT),
    )
    .await
    .unwrap();
    assert_eq!(
        frist_gesetzt_at(&pool, einsatz, auskunft).await.as_deref(),
        Some(JETZT)
    );

    let r = frist_setzen(
        &pool,
        einsatz,
        leit,
        aend(auskunft, Some("2099-01-01 00:00:00"), None, false),
        t("2026-07-01 00:00:00"),
    )
    .await
    .unwrap();
    assert_eq!(r, FristErgebnis::Unveraendert);
    assert_eq!(
        frist_gesetzt_at(&pool, einsatz, auskunft).await.as_deref(),
        Some(JETZT),
        "ohne Änderung bleibt der Zeitpunkt"
    );

    // Wiederherstellen in der Karenz: die neue Frist gilt als jetzt gesetzt.
    sqlx::query(
        "UPDATE einsatz_aufbewahrung_kategorie SET frist_bis = '2026-07-01 00:00:00', \
                vorgemerkt_at = '2026-07-01 00:00:00' WHERE einsatz_id = ?",
    )
    .bind(einsatz)
    .execute(&pool)
    .await
    .unwrap();
    frist_setzen(
        &pool,
        einsatz,
        leit,
        aend(auskunft, Some("2099-01-01 00:00:00"), None, false),
        t("2026-07-05 08:00:00"),
    )
    .await
    .unwrap();
    assert_eq!(
        frist_gesetzt_at(&pool, einsatz, auskunft).await.as_deref(),
        Some("2026-07-05 08:00:00")
    );
}

#[tokio::test]
async fn einsatz_zustand_sperrt() {
    let pool = crate::db::test_pool().await;
    let (aktiv, leit) = einsatz_mit_leitung(&pool).await;
    let a = aend(
        Datenkategorie::Anhaenge,
        Some("2027-01-01 00:00:00"),
        Some("x"),
        true,
    );
    let err = frist_setzen(&pool, aktiv, leit, a, t(JETZT))
        .await
        .unwrap_err();
    assert_eq!(
        err.status(),
        axum::http::StatusCode::CONFLICT,
        "aktiv → 409"
    );

    super::super::repo::abschliessen(&pool, aktiv, leit)
        .await
        .unwrap();
    sqlx::query("UPDATE einsatz SET geloescht_at = '2026-06-25 12:00:00' WHERE id = ?")
        .bind(aktiv)
        .execute(&pool)
        .await
        .unwrap();
    let err = frist_setzen(&pool, aktiv, leit, a, t(JETZT))
        .await
        .unwrap_err();
    assert_eq!(
        err.status(),
        axum::http::StatusCode::UNPROCESSABLE_ENTITY,
        "vorgemerkt → 422"
    );

    sqlx::query("UPDATE einsatz SET geschwaerzt_at = '2026-06-29 12:00:00' WHERE id = ?")
        .bind(aktiv)
        .execute(&pool)
        .await
        .unwrap();
    let err = frist_setzen(&pool, aktiv, leit, a, t(JETZT))
        .await
        .unwrap_err();
    assert_eq!(
        err.status(),
        axum::http::StatusCode::CONFLICT,
        "geschwärzt → 409"
    );
    assert_eq!(zeile(&pool, aktiv, Datenkategorie::Anhaenge).await, None);
}

// ---------- Vormerkung (K1) und Schwärzung (K2) ----------

/// Setzt Frist und optional Vormerkung einer Kategorie direkt (Zeile muss nicht existieren).
async fn kategorie_stand(
    pool: &SqlitePool,
    einsatz: i64,
    k: Datenkategorie,
    frist: &str,
    vorgemerkt: Option<&str>,
) {
    sqlx::query(
        "INSERT INTO einsatz_aufbewahrung_kategorie (einsatz_id, kategorie, frist_bis, \
                rechtsgrundlage, vorgemerkt_at) VALUES (?, ?, ?, 'RG ' || ?, ?) \
             ON CONFLICT(einsatz_id, kategorie) DO UPDATE SET frist_bis = excluded.frist_bis, \
                vorgemerkt_at = excluded.vorgemerkt_at",
    )
    .bind(einsatz)
    .bind(k.as_str())
    .bind(frist)
    .bind(k.as_str())
    .bind(vorgemerkt)
    .execute(pool)
    .await
    .unwrap();
}

async fn abgeschlossen(pool: &SqlitePool) -> (i64, i64) {
    let (einsatz, leit) = einsatz_mit_leitung(pool).await;
    // Personen vor dem Abschluss (danach ist der Einsatz schreibgeschützt).
    (einsatz, leit)
}

async fn schliessen(pool: &SqlitePool, einsatz: i64, leit: i64) {
    super::super::repo::abschliessen(pool, einsatz, leit)
        .await
        .unwrap();
}

#[tokio::test]
async fn vormerken_ist_idempotent_und_laesst_einsatz_lesbar() {
    let pool = crate::db::test_pool().await;
    let (einsatz, leit) = abgeschlossen(&pool).await;
    schliessen(&pool, einsatz, leit).await;
    kategorie_stand(
        &pool,
        einsatz,
        Datenkategorie::Personenauskunft,
        "2026-06-01 00:00:00",
        None,
    )
    .await;
    kategorie_stand(
        &pool,
        einsatz,
        Datenkategorie::Anhaenge,
        "2026-12-01 00:00:00",
        None,
    )
    .await;

    let faellig = faellige_vormerkung(&pool, JETZT).await.unwrap();
    assert_eq!(faellig, vec![(einsatz, Datenkategorie::Personenauskunft)]);
    assert!(
        vormerken(&pool, einsatz, Datenkategorie::Personenauskunft, JETZT)
            .await
            .unwrap()
    );
    let z = zeile(&pool, einsatz, Datenkategorie::Personenauskunft)
        .await
        .unwrap();
    assert_eq!(z.vorgemerkt_at.as_deref(), Some(JETZT));
    let etb = etb_texte(&pool, einsatz).await;
    assert!(etb
        .last()
        .unwrap()
        .contains("„Personenauskunft“ abgelaufen"));
    // Der Einsatz selbst bleibt unberührt (lesbar).
    let (geloescht, _) = crate::aufbewahrung::repo::tombstones(&pool, einsatz)
        .await
        .unwrap();
    assert_eq!(geloescht, None);

    // Zweiter Lauf: nichts.
    let n = etb.len();
    assert!(faellige_vormerkung(&pool, JETZT).await.unwrap().is_empty());
    assert!(
        !vormerken(&pool, einsatz, Datenkategorie::Personenauskunft, JETZT)
            .await
            .unwrap()
    );
    assert_eq!(etb_texte(&pool, einsatz).await.len(), n);
}

#[tokio::test]
async fn aktiver_einsatz_wird_nie_vorgemerkt() {
    let pool = crate::db::test_pool().await;
    let (einsatz, _) = einsatz_mit_leitung(&pool).await;
    kategorie_stand(
        &pool,
        einsatz,
        Datenkategorie::Anhaenge,
        "2026-01-01 00:00:00",
        None,
    )
    .await;
    assert!(faellige_vormerkung(&pool, JETZT).await.unwrap().is_empty());
    assert!(!vormerken(&pool, einsatz, Datenkategorie::Anhaenge, JETZT)
        .await
        .unwrap());
}

#[tokio::test]
async fn vormerken_ohne_akteur_unterbleibt_und_holt_es_mit_admin_nach() {
    let pool = crate::db::test_pool().await;
    sqlx::query("INSERT INTO organisation (id, name) VALUES (1, 'Orga')")
        .execute(&pool)
        .await
        .unwrap();
    let einsatz: i64 = sqlx::query_scalar(
        "INSERT INTO einsatz (org_id, bezeichnung, status, abgeschlossen_at) \
             VALUES (1, 'Lage', 'abgeschlossen', '2026-01-01 00:00:00') RETURNING id",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    kategorie_stand(
        &pool,
        einsatz,
        Datenkategorie::Anhaenge,
        "2026-06-01 00:00:00",
        None,
    )
    .await;
    assert!(vormerken(&pool, einsatz, Datenkategorie::Anhaenge, JETZT)
        .await
        .is_err());
    assert_eq!(
        zeile(&pool, einsatz, Datenkategorie::Anhaenge)
            .await
            .unwrap()
            .vorgemerkt_at,
        None
    );
    assert!(etb_texte(&pool, einsatz).await.is_empty());

    sqlx::query(
        "INSERT INTO benutzer (org_id, anzeigename, benutzername, passwort_hash, system_rolle) \
             VALUES (1, 'a', 'a', 'h', 'admin')",
    )
    .execute(&pool)
    .await
    .unwrap();
    assert!(vormerken(&pool, einsatz, Datenkategorie::Anhaenge, JETZT)
        .await
        .unwrap());
}

async fn sichtung(pool: &SqlitePool, einsatz: i64, person: i64, von: i64) {
    sqlx::query(
        "INSERT INTO person_sichtung (einsatz_id, person_id, kategorie, notiz, gesichtet_von) \
             VALUES (?, ?, 'sk2', 'Sichtungsnotiz', ?)",
    )
    .bind(einsatz)
    .bind(person)
    .bind(von)
    .execute(pool)
    .await
    .unwrap();
}

type Behandlungsfelder = (Option<String>, Option<String>);

/// `(zustand, sichtungsnotiz)` einer Person.
async fn behandlungsfelder(pool: &SqlitePool, person: i64) -> Behandlungsfelder {
    let zustand: Option<String> =
        sqlx::query_scalar("SELECT zustand FROM einsatz_person WHERE id = ?")
            .bind(person)
            .fetch_one(pool)
            .await
            .unwrap();
    let notiz: Option<String> =
        sqlx::query_scalar("SELECT notiz FROM person_sichtung WHERE person_id = ? LIMIT 1")
            .bind(person)
            .fetch_optional(pool)
            .await
            .unwrap()
            .flatten();
    (zustand, notiz)
}

/// Spec „Nur registriert“, „Behandelt, Auskunft abgelaufen“, „Beide Zwecke abgelaufen“.
#[tokio::test]
async fn personenstamm_folgt_den_zwecken() {
    let pool = crate::db::test_pool().await;
    let (einsatz, leit) = abgeschlossen(&pool).await;
    let registriert = volle_person(&pool, einsatz, 1, leit).await;
    let behandelt = volle_person(&pool, einsatz, 2, leit).await;
    sqlx::query("UPDATE einsatz_person SET zustand = 'unterkühlt' WHERE id = ?")
        .bind(behandelt)
        .execute(&pool)
        .await
        .unwrap();
    sichtung(&pool, einsatz, behandelt, leit).await;
    sqlx::query(
            "INSERT INTO person_verbleib (einsatz_id, person_id, art, ziel, transportmittel, \
                status, erfasst_von) VALUES (?, ?, 'transport', 'KH Mitte', 'RTW', 'angemeldet', ?)",
        )
        .bind(einsatz)
        .bind(registriert)
        .bind(leit)
        .execute(&pool)
        .await
        .unwrap();
    schliessen(&pool, einsatz, leit).await;
    let vor_31 = "2026-05-30 12:00:00";
    kategorie_stand(
        &pool,
        einsatz,
        Datenkategorie::Personenauskunft,
        "2026-05-01 00:00:00",
        Some(vor_31),
    )
    .await;
    kategorie_stand(
        &pool,
        einsatz,
        Datenkategorie::Behandlung,
        "2026-12-01 00:00:00",
        None,
    )
    .await;

    assert!(
        schwaerzen(&pool, einsatz, Datenkategorie::Personenauskunft, t(JETZT))
            .await
            .unwrap()
    );

    // Nur registriert: Stamm und Auskunft weg, Verbleib weg.
    let (name, geb, adresse, kontakt, ort, ziel) = person_felder(&pool, registriert).await;
    assert_eq!(
        (name, geb, adresse, kontakt, ort, ziel),
        (None, None, None, None, None, None)
    );
    let verbleib: (Option<String>, Option<String>) =
        sqlx::query_as("SELECT ziel, transportmittel FROM person_verbleib WHERE person_id = ?")
            .bind(registriert)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(verbleib, (None, None));

    // Behandelt: nur Adresse und Kontakt weg.
    let (name, geb, adresse, kontakt, ort, ziel) = person_felder(&pool, behandelt).await;
    assert_eq!((adresse, kontakt), (None, None));
    assert_eq!(name.as_deref(), Some("Mustermann"));
    assert_eq!(geb.as_deref(), Some("1970-01-01"));
    assert_eq!(ort.as_deref(), Some("Marktplatz"));
    assert_eq!(ziel.as_deref(), Some("KH Mitte"));
    assert_eq!(
        behandlungsfelder(&pool, behandelt).await,
        (Some("unterkühlt".into()), Some("Sichtungsnotiz".into()))
    );
    let etb = etb_texte(&pool, einsatz).await;
    let eintrag = etb.last().unwrap();
    assert!(
        eintrag.contains("„Personenauskunft“ unwiderruflich geschwärzt"),
        "{eintrag}"
    );
    assert!(eintrag.contains("RG personenauskunft"));
    assert!(eintrag.contains("ohne Behandlungsbezug"));

    // Beide Zwecke abgelaufen: auch der Stamm der behandelten Person.
    kategorie_stand(
        &pool,
        einsatz,
        Datenkategorie::Behandlung,
        "2026-05-01 00:00:00",
        Some(vor_31),
    )
    .await;
    assert!(
        schwaerzen(&pool, einsatz, Datenkategorie::Behandlung, t(JETZT))
            .await
            .unwrap()
    );
    let (name, geb, _, _, ort, ziel) = person_felder(&pool, behandelt).await;
    assert_eq!((name, geb, ort, ziel), (None, None, None, None));
    assert_eq!(behandlungsfelder(&pool, behandelt).await, (None, None));
    assert!(etb_texte(&pool, einsatz)
        .await
        .last()
        .unwrap()
        .contains("der Personen mit Behandlungsbezug"));

    // Eine spätere Kategorie, die den Stamm nicht betrifft, nennt ihn nicht (Review LFH-749):
    // das ETB hielte sonst eine zweite Stamm-Schwärzung unter fremder Rechtsgrundlage fest.
    kategorie_stand(
        &pool,
        einsatz,
        Datenkategorie::Anhaenge,
        "2026-05-01 00:00:00",
        Some(vor_31),
    )
    .await;
    assert!(
        schwaerzen(&pool, einsatz, Datenkategorie::Anhaenge, t(JETZT))
            .await
            .unwrap()
    );
    let letzter = etb_texte(&pool, einsatz).await.last().unwrap().clone();
    assert!(letzter.contains("„Anhänge“"), "{letzter}");
    assert!(!letzter.contains("Personenstamm"), "{letzter}");

    // Sichtungskategorie und Registriernummer bleiben.
    let (kat, nr): (String, i64) = sqlx::query_as(
        "SELECT s.kategorie, p.registrier_nr FROM person_sichtung s \
             JOIN einsatz_person p ON p.id = s.person_id WHERE p.id = ?",
    )
    .bind(behandelt)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!((kat.as_str(), nr), ("sk2", 2));

    let verstoesse: Vec<(String,)> =
        sqlx::query_as("SELECT \"table\" FROM pragma_foreign_key_check")
            .fetch_all(&pool)
            .await
            .unwrap();
    assert!(verstoesse.is_empty(), "{verstoesse:?}");
}

/// Jede Bezugsart hält den Stamm, wenn nur die Personenauskunft geschwärzt wird —
/// auch an einer stornierten Person (design.md, Risiko „Prädikat erfasst einen Bezug nicht“).
#[tokio::test]
async fn jede_bezugsart_haelt_den_stamm() {
    let pool = crate::db::test_pool().await;
    let (einsatz, leit) = abgeschlossen(&pool).await;
    let mit_sichtung = volle_person(&pool, einsatz, 1, leit).await;
    sichtung(&pool, einsatz, mit_sichtung, leit).await;
    let mit_verlauf = volle_person(&pool, einsatz, 2, leit).await;
    sqlx::query(
        "INSERT INTO person_verlaufsnotiz (einsatz_id, person_id, text, erfasst_von) \
             VALUES (?, ?, 'RR 120/80', ?)",
    )
    .bind(einsatz)
    .bind(mit_verlauf)
    .bind(leit)
    .execute(&pool)
    .await
    .unwrap();
    let mit_uhs = volle_person(&pool, einsatz, 3, leit).await;
    let uhs: i64 = sqlx::query_scalar(
        "INSERT INTO uhs (einsatz_id, typ, bezeichnung, erfasst_von, geaendert_von) \
             VALUES (?, 'patientenablage', 'PA 1', ?, ?) RETURNING id",
    )
    .bind(einsatz)
    .bind(leit)
    .bind(leit)
    .fetch_one(&pool)
    .await
    .unwrap();
    sqlx::query(
        "INSERT INTO person_uhs_belegung (einsatz_id, person_id, uhs_id, art, erfasst_von) \
             VALUES (?, ?, ?, 'eintritt', ?)",
    )
    .bind(einsatz)
    .bind(mit_uhs)
    .bind(uhs)
    .bind(leit)
    .execute(&pool)
    .await
    .unwrap();
    let mit_zustand = volle_person(&pool, einsatz, 4, leit).await;
    sqlx::query("UPDATE einsatz_person SET zustand = 'gehfähig' WHERE id = ?")
        .bind(mit_zustand)
        .execute(&pool)
        .await
        .unwrap();
    let storniert = volle_person(&pool, einsatz, 5, leit).await;
    sichtung(&pool, einsatz, storniert, leit).await;
    sqlx::query("UPDATE einsatz_person SET storniert_at = '2026-01-01 00:00:00' WHERE id = ?")
        .bind(storniert)
        .execute(&pool)
        .await
        .unwrap();
    schliessen(&pool, einsatz, leit).await;
    kategorie_stand(
        &pool,
        einsatz,
        Datenkategorie::Personenauskunft,
        "2026-05-01 00:00:00",
        Some("2026-05-30 12:00:00"),
    )
    .await;

    assert!(
        schwaerzen(&pool, einsatz, Datenkategorie::Personenauskunft, t(JETZT))
            .await
            .unwrap()
    );
    for p in [mit_sichtung, mit_verlauf, mit_uhs, mit_zustand, storniert] {
        let (name, _, adresse, _, _, _) = person_felder(&pool, p).await;
        assert_eq!(
            name.as_deref(),
            Some("Mustermann"),
            "Person {p} behält ihren Stamm"
        );
        assert_eq!(adresse, None, "Person {p}: Adresse weg");
    }
}

/// LLH-1326 (Spec `aufbewahrung-kategorien`, „Nur eine PAT-Nummer“ und „Schwärzung der
/// Behandlung leert die PAT-Kern-Freitexte“): eine PAT-Nummer und eine Kontamination „ja“
/// geben Behandlungsbezug, „nein“ nicht. Die Behandlung leert die PAT-Nummer, die
/// Kontamination bleibt als Statuskategorie.
#[tokio::test]
async fn pat_nummer_und_kontamination_halten_den_stamm_bis_zur_behandlung() {
    let pool = crate::db::test_pool().await;
    let (einsatz, leit) = abgeschlossen(&pool).await;
    let nur_pat = volle_person(&pool, einsatz, 1, leit).await;
    let kontaminiert = volle_person(&pool, einsatz, 2, leit).await;
    let nicht_kontaminiert = volle_person(&pool, einsatz, 3, leit).await;
    for (p, pat, kont) in [
        (nur_pat, Some("A-4711"), None),
        (kontaminiert, None, Some(1_i64)),
        (nicht_kontaminiert, None, Some(0)),
    ] {
        sqlx::query("UPDATE einsatz_person SET pat_nummer = ?, kontamination = ? WHERE id = ?")
            .bind(pat)
            .bind(kont)
            .bind(p)
            .execute(&pool)
            .await
            .unwrap();
    }
    schliessen(&pool, einsatz, leit).await;
    let vor_31 = "2026-05-30 12:00:00";
    kategorie_stand(
        &pool,
        einsatz,
        Datenkategorie::Personenauskunft,
        "2026-05-01 00:00:00",
        Some(vor_31),
    )
    .await;
    assert!(
        schwaerzen(&pool, einsatz, Datenkategorie::Personenauskunft, t(JETZT))
            .await
            .unwrap()
    );
    let name = |p: i64| {
        let pool = pool.clone();
        async move { person_felder(&pool, p).await.0 }
    };
    assert_eq!(
        name(nur_pat).await.as_deref(),
        Some("Mustermann"),
        "nur PAT-Nummer"
    );
    assert_eq!(
        name(kontaminiert).await.as_deref(),
        Some("Mustermann"),
        "kontaminiert"
    );
    assert_eq!(
        name(nicht_kontaminiert).await,
        None,
        "„nein“ ist kein Behandlungsbezug"
    );

    kategorie_stand(
        &pool,
        einsatz,
        Datenkategorie::Behandlung,
        "2026-05-01 00:00:00",
        Some(vor_31),
    )
    .await;
    assert!(
        schwaerzen(&pool, einsatz, Datenkategorie::Behandlung, t(JETZT))
            .await
            .unwrap()
    );
    let pat_kern = |p: i64| {
        let pool = pool.clone();
        async move {
            sqlx::query_as::<_, (Option<String>, Option<i64>)>(
                "SELECT pat_nummer, kontamination FROM einsatz_person WHERE id = ?",
            )
            .bind(p)
            .fetch_one(&pool)
            .await
            .unwrap()
        }
    };
    assert_eq!(
        pat_kern(nur_pat).await,
        (None, None),
        "die PAT-Nummer ist weg"
    );
    assert_eq!(
        pat_kern(kontaminiert).await,
        (None, Some(1)),
        "Kontamination bleibt"
    );
    assert_eq!(name(nur_pat).await, None, "beide Zwecke abgelaufen");
}

/// Schwärzt erst `personenauskunft`, dann `behandlung` eines abgeschlossenen Einsatzes; dazwischen
/// läuft `zwischen`. Für die Behandlungsbezüge der PAT-Kern-Tabellen (Change `y18v58dt-pat-kern`).
async fn erst_auskunft_dann_behandlung(pool: &SqlitePool, einsatz: i64) {
    let vor_31 = "2026-05-30 12:00:00";
    for k in [Datenkategorie::Personenauskunft, Datenkategorie::Behandlung] {
        kategorie_stand(pool, einsatz, k, "2026-05-01 00:00:00", Some(vor_31)).await;
    }
}

/// LLH-1325 (Spec `aufbewahrung-kategorien`, design.md D4): ein Transportstand gibt
/// Behandlungsbezug, auch ein aufgehobener. Die Schwärzung der Behandlung leert die
/// Fachrichtung in Verlauf und Cache; Priorität und Art bleiben als Statuskategorie.
#[tokio::test]
async fn transportstand_haelt_den_stamm_und_die_behandlung_leert_die_fachrichtung() {
    let pool = crate::db::test_pool().await;
    let (einsatz, leit) = abgeschlossen(&pool).await;
    let mit_transport = volle_person(&pool, einsatz, 1, leit).await;
    let aufgehoben = volle_person(&pool, einsatz, 2, leit).await;
    let ohne = volle_person(&pool, einsatz, 3, leit).await;
    for (p, prio, art, fach) in [
        (
            mit_transport,
            Some("dringlich"),
            Some("liegend"),
            Some("psychiatrie"),
        ),
        (aufgehoben, None, None, None),
    ] {
        sqlx::query(
            "INSERT INTO person_transport (einsatz_id, person_id, prioritaet, art, \
                    fachrichtung, zeitpunkt_at, erfasst_at, erfasst_von) \
                 VALUES (?, ?, ?, ?, ?, '2026-05-27 10:00:00', '2026-05-27 10:00:00', ?)",
        )
        .bind(einsatz)
        .bind(p)
        .bind(prio)
        .bind(art)
        .bind(fach)
        .bind(leit)
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query(
            "UPDATE einsatz_person SET transport_prioritaet = ?, transport_art = ?, \
                    transport_fachrichtung = ? WHERE id = ?",
        )
        .bind(prio)
        .bind(art)
        .bind(fach)
        .bind(p)
        .execute(&pool)
        .await
        .unwrap();
    }
    schliessen(&pool, einsatz, leit).await;
    erst_auskunft_dann_behandlung(&pool, einsatz).await;
    assert!(
        schwaerzen(&pool, einsatz, Datenkategorie::Personenauskunft, t(JETZT))
            .await
            .unwrap()
    );
    let name = |p: i64| {
        let pool = pool.clone();
        async move { person_felder(&pool, p).await.0 }
    };
    assert_eq!(name(mit_transport).await.as_deref(), Some("Mustermann"));
    assert_eq!(
        name(aufgehoben).await.as_deref(),
        Some("Mustermann"),
        "auch ein aufgehobener Transport ist ein Behandlungsbezug"
    );
    assert_eq!(name(ohne).await, None, "ohne Bezug nur Personenauskunft");

    assert!(
        schwaerzen(&pool, einsatz, Datenkategorie::Behandlung, t(JETZT))
            .await
            .unwrap()
    );
    let verlauf: (Option<String>, Option<String>, Option<String>) = sqlx::query_as(
        "SELECT prioritaet, art, fachrichtung FROM person_transport WHERE person_id = ?",
    )
    .bind(mit_transport)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(
        verlauf,
        (Some("dringlich".into()), Some("liegend".into()), None),
        "Verlauf"
    );
    let cache: (Option<String>, Option<String>, Option<String>) = sqlx::query_as(
        "SELECT transport_prioritaet, transport_art, transport_fachrichtung \
             FROM einsatz_person WHERE id = ?",
    )
    .bind(mit_transport)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(
        cache,
        (Some("dringlich".into()), Some("liegend".into()), None),
        "Cache"
    );
    assert_eq!(name(mit_transport).await, None, "beide Zwecke abgelaufen");
}

/// LLH-1324 (Spec `aufbewahrung-kategorien`, design.md D4): eine Maßnahme gibt
/// Behandlungsbezug, auch eine aufgehobene; sie selbst bleibt als Katalogwert erhalten.
#[tokio::test]
async fn massnahme_haelt_den_stamm_und_bleibt_als_katalogwert() {
    let pool = crate::db::test_pool().await;
    let (einsatz, leit) = abgeschlossen(&pool).await;
    let mit = volle_person(&pool, einsatz, 1, leit).await;
    let ohne = volle_person(&pool, einsatz, 2, leit).await;
    sqlx::query(
        "INSERT INTO person_massnahme (einsatz_id, person_id, art, zeitpunkt_at, erfasst_at, \
                erfasst_von, aufgehoben_at, aufgehoben_von_id) \
             VALUES (?, ?, 'analgesie', '2026-05-27 10:00:00', '2026-05-27 10:00:00', ?, \
                '2026-05-27 10:05:00', ?)",
    )
    .bind(einsatz)
    .bind(mit)
    .bind(leit)
    .bind(leit)
    .execute(&pool)
    .await
    .unwrap();
    schliessen(&pool, einsatz, leit).await;
    erst_auskunft_dann_behandlung(&pool, einsatz).await;
    assert!(
        schwaerzen(&pool, einsatz, Datenkategorie::Personenauskunft, t(JETZT))
            .await
            .unwrap()
    );
    assert_eq!(
        person_felder(&pool, mit).await.0.as_deref(),
        Some("Mustermann"),
        "auch eine aufgehobene Maßnahme ist ein Behandlungsbezug"
    );
    assert_eq!(person_felder(&pool, ohne).await.0, None);
    assert!(
        schwaerzen(&pool, einsatz, Datenkategorie::Behandlung, t(JETZT))
            .await
            .unwrap()
    );
    let art: String = sqlx::query_scalar("SELECT art FROM person_massnahme WHERE person_id = ?")
        .bind(mit)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(art, "analgesie", "die Maßnahme bleibt");
    assert_eq!(
        person_felder(&pool, mit).await.0,
        None,
        "beide Zwecke abgelaufen"
    );
}

/// LLH-1113 (Spec `aufbewahrung-kategorien`, „Schwärzung der Behandlung leert die
/// PAT-Kern-Freitexte“): eine Verletzung, auch eine aufgehobene, gibt Behandlungsbezug. Die
/// Schwärzung der Behandlung leert ihre Lage und Notiz; Ansicht, Region, Art und Schwere
/// bleiben.
#[tokio::test]
async fn verletzung_haelt_den_stamm_und_die_behandlung_leert_lage_und_notiz() {
    let pool = crate::db::test_pool().await;
    let (einsatz, leit) = abgeschlossen(&pool).await;
    let mit = volle_person(&pool, einsatz, 1, leit).await;
    let ohne = volle_person(&pool, einsatz, 2, leit).await;
    sqlx::query(
        "INSERT INTO person_verletzung (einsatz_id, person_id, ansicht, region, art, schwere, \
                x, y, notiz, zeitpunkt_at, erfasst_at, erfasst_von, aufgehoben_at, \
                aufgehoben_von_id) \
             VALUES (?, ?, 'vorn', 'unterarm_l', 'fraktur_verdacht', 'mittel', 0.3, 0.4, \
                'offene Fehlstellung', '2026-05-27 10:00:00', '2026-05-27 10:00:00', ?, \
                '2026-05-27 10:05:00', ?)",
    )
    .bind(einsatz)
    .bind(mit)
    .bind(leit)
    .bind(leit)
    .execute(&pool)
    .await
    .unwrap();
    schliessen(&pool, einsatz, leit).await;
    erst_auskunft_dann_behandlung(&pool, einsatz).await;
    assert!(
        schwaerzen(&pool, einsatz, Datenkategorie::Personenauskunft, t(JETZT))
            .await
            .unwrap()
    );
    assert_eq!(
        person_felder(&pool, mit).await.0.as_deref(),
        Some("Mustermann"),
        "auch eine aufgehobene Verletzung ist ein Behandlungsbezug"
    );
    assert_eq!(person_felder(&pool, ohne).await.0, None);
    assert!(
        schwaerzen(&pool, einsatz, Datenkategorie::Behandlung, t(JETZT))
            .await
            .unwrap()
    );
    type Zeile = (
        String,
        String,
        String,
        Option<String>,
        Option<f64>,
        Option<f64>,
        Option<String>,
    );
    let zeile: Zeile = sqlx::query_as(
        "SELECT ansicht, region, art, schwere, x, y, notiz FROM person_verletzung \
             WHERE person_id = ?",
    )
    .bind(mit)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(
        zeile,
        (
            "vorn".into(),
            "unterarm_l".into(),
            "fraktur_verdacht".into(),
            Some("mittel".into()),
            None,
            None,
            None
        )
    );
    assert_eq!(
        person_felder(&pool, mit).await.0,
        None,
        "beide Zwecke abgelaufen"
    );
}

/// LLH-1568 (Spec `aufbewahrung-kategorien`): ein Verbleib mit Einsatznummer der Leitstelle
/// gibt Behandlungsbezug, ein Verbleib ohne sie nicht. Die Schwärzung der Behandlung leert
/// die Nummer; „gegen Rat“ bleibt als Katalogwert.
#[tokio::test]
async fn einsatznummer_haelt_den_stamm_und_die_behandlung_leert_sie() {
    let pool = crate::db::test_pool().await;
    let (einsatz, leit) = abgeschlossen(&pool).await;
    let mit = volle_person(&pool, einsatz, 1, leit).await;
    let ohne = volle_person(&pool, einsatz, 2, leit).await;
    for (p, nummer) in [(mit, Some("2611-0815")), (ohne, None)] {
        sqlx::query(
            "INSERT INTO person_verbleib (einsatz_id, person_id, art, ziel, transportmittel, \
                    status, transport_durch, leitstelle_einsatznummer, gegen_rat, erfasst_von) \
                 VALUES (?, ?, 'transport', 'KH Mitte', 'RTW', 'abtransportiert', 'fremd', ?, \
                    'behandlung', ?)",
        )
        .bind(einsatz)
        .bind(p)
        .bind(nummer)
        .bind(leit)
        .execute(&pool)
        .await
        .unwrap();
    }
    schliessen(&pool, einsatz, leit).await;
    erst_auskunft_dann_behandlung(&pool, einsatz).await;
    assert!(
        schwaerzen(&pool, einsatz, Datenkategorie::Personenauskunft, t(JETZT))
            .await
            .unwrap()
    );
    assert_eq!(
        person_felder(&pool, mit).await.0.as_deref(),
        Some("Mustermann"),
        "die Einsatznummer ist ein Behandlungsbezug"
    );
    assert_eq!(
        person_felder(&pool, ohne).await.0,
        None,
        "ein Verbleib ohne Einsatznummer allein ist keiner"
    );
    assert!(
        schwaerzen(&pool, einsatz, Datenkategorie::Behandlung, t(JETZT))
            .await
            .unwrap()
    );
    let verbleib: (Option<String>, Option<String>) = sqlx::query_as(
        "SELECT leitstelle_einsatznummer, gegen_rat FROM person_verbleib WHERE person_id = ?",
    )
    .bind(mit)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(verbleib, (None, Some("behandlung".into())));
    assert_eq!(
        person_felder(&pool, mit).await.0,
        None,
        "beide Zwecke abgelaufen"
    );
}

#[tokio::test]
async fn jede_kategorie_nimmt_die_bruchstelle_mit() {
    let pool = crate::db::test_pool().await;
    let (einsatz, leit) = abgeschlossen(&pool).await;
    sqlx::query(
        "INSERT INTO einsatz_bruchstelle (einsatz_id, art, schluessel, stand, daten, \
                gesichert_at) VALUES (?, 'einsatz_person', '1', 1, '{\"name\":\"Muster\"}', \
                '2026-01-01 09:00:00')",
    )
    .bind(einsatz)
    .execute(&pool)
    .await
    .unwrap();
    schliessen(&pool, einsatz, leit).await;
    kategorie_stand(
        &pool,
        einsatz,
        Datenkategorie::Anhaenge,
        "2026-05-01 00:00:00",
        Some("2026-05-30 12:00:00"),
    )
    .await;
    assert!(
        schwaerzen(&pool, einsatz, Datenkategorie::Anhaenge, t(JETZT))
            .await
            .unwrap()
    );
    let uebrig: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM einsatz_bruchstelle WHERE einsatz_id = ?")
            .bind(einsatz)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(uebrig, 0);
    // Die Marke am Kopf trägt die Schwärzung zum Spiegel (LLH-1649).
    let marke: Option<String> =
        sqlx::query_scalar("SELECT schwaerzung_marke FROM einsatz WHERE id = ?")
            .bind(einsatz)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(marke.map(|m| m.len()), Some(16));
}

#[tokio::test]
async fn anhaenge_schwaerzung_laesst_anderes_stehen_und_ist_idempotent() {
    let pool = crate::db::test_pool().await;
    let (einsatz, leit) = abgeschlossen(&pool).await;
    let person = volle_person(&pool, einsatz, 1, leit).await;
    let anhang = |name: &'static str| {
        let pool = pool.clone();
        async move {
            sqlx::query_scalar::<_, i64>(
                "INSERT INTO anhang (einsatz_id, dateiname, mime, groesse, sha256, daten, \
                        hochgeladen_von) VALUES (?, ?, 'image/jpeg', 3, 'x', X'010203', ?) \
                     RETURNING id",
            )
            .bind(einsatz)
            .bind(name)
            .bind(leit)
            .fetch_one(&pool)
            .await
            .unwrap()
        }
    };
    // Dokumentablage samt ETB-Nachweis, Schaden mit Anhang, Meldung.
    let dok_anhang = anhang("lageplan.png").await;
    let etb: i64 = sqlx::query_scalar(
        "INSERT INTO etb_eintrag (einsatz_id, lfd_nr, typ, inhalt, erfasser_id, ereigniszeit) \
             VALUES (?, 900, 'system', 'Dokument abgelegt', ?, '2026-01-01 09:00:00') RETURNING id",
    )
    .bind(einsatz)
    .bind(leit)
    .fetch_one(&pool)
    .await
    .unwrap();
    sqlx::query(
        "INSERT INTO einsatz_dokument (einsatz_id, anhang_id, kategorie, titel, \
                etb_eintrag_id, abgelegt_von_id) VALUES (?, ?, 'lagekarte_plan', 'Plan', ?, ?)",
    )
    .bind(einsatz)
    .bind(dok_anhang)
    .bind(etb)
    .bind(leit)
    .execute(&pool)
    .await
    .unwrap();
    let schaden: i64 = sqlx::query_scalar(
        "INSERT INTO einsatz_schaden (einsatz_id, registrier_nr, typ, ausmass, ort, \
                erfasst_von, geaendert_von) VALUES (?, 1, 'sachschaden', 'gering', \
                'Hauptstr. 1', ?, ?) RETURNING id",
    )
    .bind(einsatz)
    .bind(leit)
    .bind(leit)
    .fetch_one(&pool)
    .await
    .unwrap();
    let schaden_anhang = anhang("dach.jpg").await;
    sqlx::query(
        "INSERT INTO einsatz_schaden_anhang (einsatz_id, schaden_id, anhang_id, \
                abgelegt_von_id) VALUES (?, ?, ?, ?)",
    )
    .bind(einsatz)
    .bind(schaden)
    .bind(schaden_anhang)
    .bind(leit)
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query(
        "INSERT INTO meldung (einsatz_id, lfd_nr, absender, meldeweg, inhalt, \
                ereigniszeit, eingang_at, erfasst_von_id) VALUES (?, 1, 'Nord 1', 'funk', \
                'Dach abgedeckt', '2026-01-01 09:00:00', '2026-01-01 09:00:00', ?)",
    )
    .bind(einsatz)
    .bind(leit)
    .execute(&pool)
    .await
    .unwrap();
    anhang("foto.jpg").await;
    schliessen(&pool, einsatz, leit).await;

    // Karenz läuft noch (29 Tage): nichts.
    kategorie_stand(
        &pool,
        einsatz,
        Datenkategorie::Anhaenge,
        "2026-05-01 00:00:00",
        Some("2026-06-01 12:00:00"),
    )
    .await;
    assert!(
        !schwaerzen(&pool, einsatz, Datenkategorie::Anhaenge, t(JETZT))
            .await
            .unwrap()
    );

    kategorie_stand(
        &pool,
        einsatz,
        Datenkategorie::Anhaenge,
        "2026-05-01 00:00:00",
        Some("2026-05-31 12:00:00"),
    )
    .await;
    assert!(
        schwaerzen(&pool, einsatz, Datenkategorie::Anhaenge, t(JETZT))
            .await
            .unwrap()
    );
    let anhaenge: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM anhang WHERE einsatz_id = ?")
        .bind(einsatz)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(anhaenge, 0);
    for tabelle in ["einsatz_dokument", "einsatz_schaden_anhang"] {
        let n: i64 = sqlx::query_scalar(sqlx::AssertSqlSafe(format!(
            "SELECT COUNT(*) FROM {tabelle} WHERE einsatz_id = ?"
        )))
        .bind(einsatz)
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(n, 0, "{tabelle}: Dokumentablage weg");
    }
    // Personen, Schäden, Meldungen und ETB tragen ihre Angaben unverändert.
    let (name, _, adresse, _, _, _) = person_felder(&pool, person).await;
    assert_eq!(name.as_deref(), Some("Mustermann"));
    assert_eq!(adresse.as_deref(), Some("Hauptstr. 5"));
    let ort: String = sqlx::query_scalar("SELECT ort FROM einsatz_schaden WHERE id = ?")
        .bind(schaden)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(ort, "Hauptstr. 1");
    let inhalt: String = sqlx::query_scalar("SELECT inhalt FROM meldung WHERE einsatz_id = ?")
        .bind(einsatz)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(inhalt, "Dach abgedeckt");
    assert!(etb_texte(&pool, einsatz)
        .await
        .contains(&"Dokument abgelegt".to_string()));
    let verstoesse: Vec<(String,)> =
        sqlx::query_as("SELECT \"table\" FROM pragma_foreign_key_check")
            .fetch_all(&pool)
            .await
            .unwrap();
    assert!(verstoesse.is_empty(), "{verstoesse:?}");
    let n = etb_texte(&pool, einsatz).await.len();
    let letzter = etb_texte(&pool, einsatz).await.last().unwrap().clone();
    assert!(letzter.contains("„Anhänge“"), "{letzter}");
    assert!(letzter.contains("RG anhaenge"), "{letzter}");
    assert!(
        !letzter.contains("Personenstamm"),
        "Anhänge ändern den Stamm nicht: {letzter}"
    );

    // Zweiter Lauf: nichts, kein Eintrag.
    assert!(
        !schwaerzen(&pool, einsatz, Datenkategorie::Anhaenge, t(JETZT))
            .await
            .unwrap()
    );
    assert_eq!(etb_texte(&pool, einsatz).await.len(), n);
}

/// Spec „Zusammenspiel mit der Einsatz-Frist“: das Wiederherstellen des Einsatzes bringt
/// eine geschwärzte Kategorie nicht zurück.
#[tokio::test]
async fn wiederherstellen_des_einsatzes_laesst_geschwaerzte_kategorie_geschwaerzt() {
    let pool = crate::db::test_pool().await;
    let (einsatz, leit) = abgeschlossen(&pool).await;
    schliessen(&pool, einsatz, leit).await;
    kategorie_stand(
        &pool,
        einsatz,
        Datenkategorie::Personenauskunft,
        "2026-05-01 00:00:00",
        Some("2026-05-30 12:00:00"),
    )
    .await;
    assert!(
        schwaerzen(&pool, einsatz, Datenkategorie::Personenauskunft, t(JETZT))
            .await
            .unwrap()
    );
    let vorher = zeile(&pool, einsatz, Datenkategorie::Personenauskunft)
        .await
        .unwrap();

    let jetzt = Utc::now();
    sqlx::query("UPDATE einsatz SET geloescht_at = ? WHERE id = ?")
        .bind(crate::zeit::formatiere_utc(
            jetzt - chrono::Duration::days(1),
        ))
        .bind(einsatz)
        .execute(&pool)
        .await
        .unwrap();
    super::super::repo::wiederherstellen(&pool, einsatz, leit, 1, None, jetzt)
        .await
        .unwrap();

    let nachher = zeile(&pool, einsatz, Datenkategorie::Personenauskunft)
        .await
        .unwrap();
    assert_eq!(nachher, vorher);
    assert_eq!(
        kategorie_zustand(STATUS_ABGESCHLOSSEN, None, Some(&nachher), jetzt),
        Some(AufbewahrungZustand::Geschwaerzt)
    );
    let err = frist_setzen(
        &pool,
        einsatz,
        leit,
        aend(
            Datenkategorie::Personenauskunft,
            Some("2099-01-01 00:00:00"),
            None,
            false,
        ),
        jetzt,
    )
    .await
    .unwrap_err();
    assert_eq!(err.status(), axum::http::StatusCode::CONFLICT);
}

// ---------- Zustand je Kategorie ----------

#[test]
fn kategorie_zustand_je_wert() {
    use AufbewahrungZustand::*;
    let jetzt = t(JETZT);
    let z =
        |frist: Option<&str>, vorgemerkt: Option<&str>, geschwaerzt: Option<&str>| KategorieZeile {
            kategorie: Datenkategorie::Behandlung,
            frist_bis: frist.map(String::from),
            rechtsgrundlage: "x".into(),
            vorgemerkt_at: vorgemerkt.map(String::from),
            geschwaerzt_at: geschwaerzt.map(String::from),
        };
    let ab = STATUS_ABGESCHLOSSEN;
    assert_eq!(kategorie_zustand("aktiv", None, None, jetzt), None);
    assert_eq!(kategorie_zustand(ab, None, None, jetzt), Some(OhneFrist));
    assert_eq!(
        kategorie_zustand(ab, None, Some(&z(None, None, None)), jetzt),
        Some(OhneFrist)
    );
    assert_eq!(
        kategorie_zustand(
            ab,
            None,
            Some(&z(Some("2026-07-01 00:00:00"), None, None)),
            jetzt
        ),
        Some(FristLaeuft)
    );
    assert_eq!(
        kategorie_zustand(ab, None, Some(&z(Some(JETZT), None, None)), jetzt),
        Some(Faellig)
    );
    assert_eq!(
        kategorie_zustand(
            ab,
            None,
            Some(&z(
                Some("2026-06-01 00:00:00"),
                Some("2026-06-27 12:00:00"),
                None
            )),
            jetzt
        ),
        Some(Vorgemerkt)
    );
    assert_eq!(
        kategorie_zustand(
            ab,
            None,
            Some(&z(
                Some("2026-05-01 00:00:00"),
                Some("2026-05-31 12:00:00"),
                None
            )),
            jetzt
        ),
        Some(SchwaerzungAusstehend)
    );
    assert_eq!(
        kategorie_zustand(
            ab,
            None,
            Some(&z(
                None,
                Some("2026-05-01 00:00:00"),
                Some("2026-06-01 00:00:00")
            )),
            jetzt
        ),
        Some(Geschwaerzt)
    );
    // Einsatz geschwärzt: jede Kategorie geschwärzt, auch ohne Zeile.
    assert_eq!(
        kategorie_zustand(ab, Some("2026-06-01 00:00:00"), None, jetzt),
        Some(Geschwaerzt)
    );
    assert_eq!(
        kategorie_zustand(
            ab,
            Some("2026-06-01 00:00:00"),
            Some(&z(Some("2027-01-01 00:00:00"), None, None)),
            jetzt
        ),
        Some(Geschwaerzt)
    );
}

#[tokio::test]
async fn umfang_kategorie_personenauskunft_leert_genau_adresse_und_kontakt() {
    let pool = crate::db::test_pool().await;
    let (einsatz, leit) = einsatz_mit_leitung(&pool).await;
    let person = volle_person(&pool, einsatz, 1, leit).await;

    let mut tx = pool.begin().await.unwrap();
    scrubbe_aus_registry(
        &mut tx,
        einsatz,
        Umfang::Kategorie(Datenkategorie::Personenauskunft),
    )
    .await
    .unwrap();
    tx.commit().await.unwrap();

    let (name, geb, adresse, kontakt, ort, ziel) = person_felder(&pool, person).await;
    assert_eq!(adresse, None);
    assert_eq!(kontakt, None);
    assert_eq!(name.as_deref(), Some("Mustermann"));
    assert_eq!(geb.as_deref(), Some("1970-01-01"));
    assert_eq!(ort.as_deref(), Some("Marktplatz"));
    assert_eq!(ziel.as_deref(), Some("KH Mitte"));
}
