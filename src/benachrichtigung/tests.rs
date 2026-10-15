//! Katalog-, Text- und Speicher-Tests der Benachrichtigungen. Auflösung, Routen und Zustellung
//! belegt `tests/benachrichtigung.rs` gegen echte Testdaten.

use super::*;
use crate::einsatz::schwaerzung_registry::{klassifikation_von, Klassifikation};
use chrono::{DateTime, Utc};

fn t(s: &str) -> DateTime<Utc> {
    crate::zeit::parse_utc(s).unwrap()
}

#[test]
fn alarm_sind_genau_sofortmeldung_eskalation_ueberfaelliger_auftrag_und_faellige_abloesung() {
    let alarm: Vec<BenachrichtigungArt> = BenachrichtigungArt::ALLE
        .iter()
        .copied()
        .filter(|a| a.stufe() == BenachrichtigungStufe::Alarm)
        .collect();
    assert_eq!(
        alarm,
        vec![
            BenachrichtigungArt::Sofortmeldung,
            BenachrichtigungArt::SofortmeldungEskaliert,
            BenachrichtigungArt::AuftragUeberfaellig,
            BenachrichtigungArt::AbloesungFaellig,
        ]
    );
}

#[test]
fn org_arten_sind_aufnahme_und_neuer_einsatz_und_unwetter_nur_einstellung() {
    let org: Vec<_> = BenachrichtigungArt::ALLE
        .iter()
        .filter(|a| a.ist_org())
        .collect();
    assert_eq!(
        org,
        vec![
            &BenachrichtigungArt::EinsatzAufnahme,
            &BenachrichtigungArt::EinsatzNeu
        ]
    );
    let nur: Vec<_> = BenachrichtigungArt::ALLE
        .iter()
        .filter(|a| a.nur_einstellung())
        .collect();
    assert_eq!(nur, vec![&BenachrichtigungArt::Unwetter]);
}

#[test]
fn jedes_bezugsmodul_steht_im_modulkatalog() {
    for typ in BenachrichtigungBezugTyp::ALLE {
        if let Some(m) = typ.modul() {
            assert!(
                crate::einsatz::modul::MODUL_KEYS.contains(&m),
                "{}: Modul {m} unbekannt",
                typ.as_str()
            );
        }
    }
}

/// Liest die Werte einer `CHECK (<spalte> IN (...))`-Liste aus dem Tabellen-SQL.
fn check_liste(sql: &str, spalte: &str) -> Vec<String> {
    let start = sql
        .find(&format!("CHECK ({spalte} IN ("))
        .unwrap_or_else(|| panic!("CHECK auf {spalte} fehlt"));
    let rest = &sql[start + format!("CHECK ({spalte} IN (").len()..];
    let ende = rest.find(')').unwrap();
    rest[..ende]
        .split(',')
        .map(|w| w.trim().trim_matches('\'').to_string())
        .collect()
}

/// Die CHECK-Listen der Migration müssen genau `ALLE` tragen — sonst lehnt die DB eine gültige
/// Art ab oder nimmt eine ungültige an.
#[tokio::test]
async fn check_listen_entsprechen_dem_katalog() {
    let pool = crate::db::test_pool().await;
    let sql: String = sqlx::query_scalar(
        "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'benachrichtigung'",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    let arten: Vec<String> = BenachrichtigungArt::ALLE
        .iter()
        .map(|a| a.as_str().to_string())
        .collect();
    assert_eq!(check_liste(&sql, "art"), arten);
    let stufen: Vec<String> = BenachrichtigungStufe::ALLE
        .iter()
        .map(|s| s.as_str().to_string())
        .collect();
    assert_eq!(check_liste(&sql, "stufe"), stufen);
}

/// Die Detailzeile darf nie einen Scrub-Wert zeigen (`src/AGENTS.md`, Aufbewahrung): jede
/// Quelle ist in der Schwärzungs-Registry als Retain erfasst und existiert im Schema.
#[tokio::test]
async fn detail_liest_nur_retain_spalten() {
    let pool = crate::db::test_pool().await;
    for (tabelle, spalte) in text::DETAIL_ABLOESUNG_SPALTEN {
        assert!(
            matches!(
                klassifikation_von(tabelle, spalte),
                Some(Klassifikation::Retain(_))
            ),
            "abloesung: {tabelle}.{spalte} ist kein Retain-Wert"
        );
    }
    for typ in BenachrichtigungBezugTyp::ALLE {
        let Some((tabelle, spalte)) = text::detail_quelle(typ) else {
            continue;
        };
        assert!(
            matches!(
                klassifikation_von(tabelle, spalte),
                Some(Klassifikation::Retain(_))
            ),
            "{}: {tabelle}.{spalte} ist kein Retain-Wert",
            typ.as_str()
        );
        let sql = format!("SELECT {spalte} FROM {tabelle} LIMIT 0");
        sqlx::query(sqlx::AssertSqlSafe(sql))
            .fetch_all(&pool)
            .await
            .unwrap_or_else(|e| panic!("{tabelle}.{spalte}: {e}"));
        if tabelle != "einsatz" {
            let sql = format!("SELECT einsatz_id FROM {tabelle} LIMIT 0");
            sqlx::query(sqlx::AssertSqlSafe(sql))
                .fetch_all(&pool)
                .await
                .unwrap_or_else(|e| panic!("{tabelle} ohne einsatz_id: {e}"));
        }
    }
}

/// Dasselbe für die Detailzeile der Empfänger-Zeile eines Auftrags (Quittung, LLH-1212), die
/// mehrere Spalten liest.
#[tokio::test]
async fn detail_der_auftrag_empfaenger_zeile_liest_nur_retain_spalten() {
    let pool = crate::db::test_pool().await;
    for &(tabelle, spalte) in text::AUFTRAG_EMPFAENGER_SPALTEN {
        assert!(
            matches!(
                klassifikation_von(tabelle, spalte),
                Some(Klassifikation::Retain(_))
            ),
            "{tabelle}.{spalte} ist kein Retain-Wert"
        );
        let sql = format!("SELECT {spalte} FROM {tabelle} LIMIT 0");
        sqlx::query(sqlx::AssertSqlSafe(sql))
            .fetch_all(&pool)
            .await
            .unwrap_or_else(|e| panic!("{tabelle}.{spalte}: {e}"));
    }
    // Die Abfrage nennt keine Scrub-Spalte der Empfänger-Zeile.
    for scrub in ["snap_anzeige", "funktion_text", "extern_bezeichnung"] {
        assert!(
            !text::AUFTRAG_EMPFAENGER_SQL.contains(scrub),
            "Detailzeile liest {scrub}"
        );
    }
}

/// Dasselbe für den Sprung zu einer Chat-Nachricht (Erwähnung, LLH-1220): nur der Kanal.
#[test]
fn sprung_zur_chat_nachricht_liest_nur_retain_spalten() {
    for &(tabelle, spalte) in text::CHAT_NACHRICHT_SPALTEN {
        assert!(
            matches!(
                klassifikation_von(tabelle, spalte),
                Some(Klassifikation::Retain(_))
            ),
            "{tabelle}.{spalte} ist kein Retain-Wert"
        );
    }
}

#[test]
fn jede_tabellenspalte_der_benachrichtigung_ist_retain() {
    for spalte in [
        "id",
        "einsatz_id",
        "benutzer_id",
        "art",
        "stufe",
        "bezug_typ",
        "bezug_id",
        "ausloeser_id",
        "erstellt_at",
        "quittiert_at",
    ] {
        assert!(
            matches!(
                klassifikation_von("benachrichtigung", spalte),
                Some(Klassifikation::Retain(_))
            ),
            "benachrichtigung.{spalte}"
        );
    }
}

#[test]
fn pfade_folgen_den_deeplinks() {
    use BenachrichtigungBezugTyp as B;
    let p = |typ, id| text::pfad(7, Bezug::neu(typ, id));
    assert_eq!(p(B::Einsatz, 7), "/einsaetze/7");
    assert_eq!(p(B::Meldung, 3), "/einsaetze/7/meldungen?meldung=3");
    assert_eq!(p(B::Auftrag, 4), "/einsaetze/7/auftraege?auftrag=4");
    // Ohne gelesene Zeile die Liste; `bilden` setzt den Auftrag ein.
    assert_eq!(p(B::AuftragEmpfaenger, 4), "/einsaetze/7/auftraege");
    assert_eq!(p(B::Befehl, 5), "/einsaetze/7/auftraege/befehle/5");
    assert_eq!(p(B::Lagebericht, 6), "/einsaetze/7/lageberichte/6");
    assert_eq!(
        p(B::Gefahrengebiet, 8),
        "/einsaetze/7/lagekarte?gefahrengebiet=8"
    );
    assert_eq!(p(B::Person, 9), "/einsaetze/7/personen/9");
    assert_eq!(p(B::Fahrzeug, 2), "/einsaetze/7/fahrzeuge?fahrzeug=2");
    for typ in BenachrichtigungBezugTyp::ALLE {
        assert!(p(typ, 1).starts_with("/einsaetze/7"), "{}", typ.as_str());
    }
}

#[test]
fn jede_art_hat_einen_titel() {
    let mut gesehen = std::collections::HashSet::new();
    for art in BenachrichtigungArt::ALLE {
        let titel = text::titel(art);
        assert!(!titel.is_empty());
        assert!(gesehen.insert(titel), "Titel doppelt: {titel}");
    }
}

async fn setup(pool: &SqlitePool) -> (i64, i64) {
    sqlx::query("INSERT OR IGNORE INTO organisation (id, name) VALUES (1, 'Orga')")
        .execute(pool)
        .await
        .unwrap();
    let b: i64 = sqlx::query_scalar(
        "INSERT INTO benutzer (org_id, anzeigename, benutzername, passwort_hash) \
         VALUES (1, 'L', 'l', 'h') RETURNING id",
    )
    .fetch_one(pool)
    .await
    .unwrap();
    let e: i64 = sqlx::query_scalar(
        "INSERT INTO einsatz (org_id, bezeichnung) VALUES (1, 'Hochwasser Nord') RETURNING id",
    )
    .fetch_one(pool)
    .await
    .unwrap();
    (b, e)
}

async fn zeile(
    pool: &SqlitePool,
    e: i64,
    b: i64,
    erstellt_at: &str,
    quittiert_at: Option<&str>,
) -> i64 {
    sqlx::query_scalar(
        "INSERT INTO benachrichtigung (einsatz_id, benutzer_id, art, stufe, bezug_typ, bezug_id, \
             erstellt_at, quittiert_at) \
         VALUES (?, ?, 'meldung', 'hinweis', 'meldung', 1, ?, ?) RETURNING id",
    )
    .bind(e)
    .bind(b)
    .bind(erstellt_at)
    .bind(quittiert_at)
    .fetch_one(pool)
    .await
    .unwrap()
}

async fn ids(pool: &SqlitePool) -> Vec<i64> {
    sqlx::query_scalar("SELECT id FROM benachrichtigung ORDER BY id")
        .fetch_all(pool)
        .await
        .unwrap()
}

/// design.md D1: quittierte Zeilen nach 24 h, unquittierte nach 12 h.
#[tokio::test]
async fn aufraeumen_loescht_quittierte_nach_24_und_offene_nach_12_stunden() {
    let pool = crate::db::test_pool().await;
    let (b, e) = setup(&pool).await;
    let offen_frisch = zeile(&pool, e, b, "2026-06-11 00:00:01", None).await;
    let _offen_alt = zeile(&pool, e, b, "2026-06-10 23:59:59", None).await;
    let quittiert_frisch = zeile(
        &pool,
        e,
        b,
        "2026-06-09 00:00:00",
        Some("2026-06-10 12:00:01"),
    )
    .await;
    let _quittiert_alt = zeile(
        &pool,
        e,
        b,
        "2026-06-09 00:00:00",
        Some("2026-06-10 11:59:59"),
    )
    .await;

    let geloescht = repo::aufraeumen(&pool, t("2026-06-11 12:00:00"))
        .await
        .unwrap();
    assert_eq!(geloescht, 2);
    assert_eq!(ids(&pool).await, vec![offen_frisch, quittiert_frisch]);
}

/// Der Erinnerungs-Scheduler räumt bei jedem Takt mit ab.
#[tokio::test]
async fn scheduler_takt_raeumt_ab() {
    let pool = crate::db::test_pool().await;
    let (b, e) = setup(&pool).await;
    zeile(&pool, e, b, "2026-06-10 00:00:00", None).await;
    crate::erinnerung::scheduler::tick_einmal(&pool, &LiveHub::new(), t("2026-06-11 12:00:00"))
        .await;
    assert!(ids(&pool).await.is_empty());
}

/// Die Zeilen fallen mit dem Einsatz (Purge, Skelett-Löschung): ON DELETE CASCADE.
#[tokio::test]
async fn zeilen_fallen_mit_dem_einsatz() {
    let pool = crate::db::test_pool().await;
    let (b, e) = setup(&pool).await;
    zeile(&pool, e, b, "2026-06-11 00:00:00", None).await;
    sqlx::query("DELETE FROM einsatz WHERE id = ?")
        .bind(e)
        .execute(&pool)
        .await
        .unwrap();
    assert!(ids(&pool).await.is_empty());
}

#[tokio::test]
async fn liste_reicht_zwoelf_stunden_nach_und_filtert_offen_und_einsatz() {
    let pool = crate::db::test_pool().await;
    let (b, e) = setup(&pool).await;
    let alt = zeile(&pool, e, b, "2026-06-10 23:00:00", None).await;
    let offen = zeile(&pool, e, b, "2026-06-11 08:00:00", None).await;
    let quittiert = zeile(
        &pool,
        e,
        b,
        "2026-06-11 09:00:00",
        Some("2026-06-11 09:01:00"),
    )
    .await;
    let jetzt = t("2026-06-11 12:00:00");
    let alle: Vec<i64> = repo::liste(&pool, b, false, None, jetzt)
        .await
        .unwrap()
        .into_iter()
        .map(|z| z.id)
        .collect();
    assert_eq!(alle, vec![quittiert, offen], "jüngste zuerst, ohne {alt}");
    let nur_offen: Vec<i64> = repo::liste(&pool, b, true, None, jetzt)
        .await
        .unwrap()
        .into_iter()
        .map(|z| z.id)
        .collect();
    assert_eq!(nur_offen, vec![offen]);
    assert!(repo::liste(&pool, b, false, Some(e + 1), jetzt)
        .await
        .unwrap()
        .is_empty());
}

#[tokio::test]
async fn quittieren_ist_an_den_empfaenger_gebunden_und_idempotent() {
    let pool = crate::db::test_pool().await;
    let (b, e) = setup(&pool).await;
    let id = zeile(&pool, e, b, "2026-06-11 08:00:00", None).await;
    assert_eq!(repo::quittieren(&pool, id, b + 1).await.unwrap(), None);
    assert_eq!(repo::quittieren(&pool, id, b).await.unwrap(), Some(true));
    assert_eq!(repo::quittieren(&pool, id, b).await.unwrap(), Some(false));
    assert_eq!(repo::quittieren(&pool, id + 99, b).await.unwrap(), None);
    assert!(repo::laden_eigene(&pool, id, b + 1)
        .await
        .unwrap()
        .is_none());
}

#[tokio::test]
async fn text_nimmt_den_bezug_nur_aus_dem_eigenen_einsatz() {
    let pool = crate::db::test_pool().await;
    let (_, e) = setup(&pool).await;
    let anderer: i64 = sqlx::query_scalar(
        "INSERT INTO einsatz (org_id, bezeichnung) VALUES (1, 'Fremd') RETURNING id",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    let eigen = text::bilden(
        &pool,
        e,
        BenachrichtigungArt::EinsatzNeu,
        Bezug::neu(BenachrichtigungBezugTyp::Einsatz, e),
    )
    .await
    .unwrap();
    assert_eq!(eigen.titel, "Neuer Einsatz");
    assert_eq!(eigen.detail.as_deref(), Some("Hochwasser Nord"));
    assert_eq!(eigen.pfad, format!("/einsaetze/{e}"));

    let fremd = text::bilden(
        &pool,
        e,
        BenachrichtigungArt::EinsatzNeu,
        Bezug::neu(BenachrichtigungBezugTyp::Einsatz, anderer),
    )
    .await
    .unwrap();
    assert_eq!(fremd.detail, None, "Bezug aus einem fremden Einsatz");
}

/// Eine Art, die nur als Schalter besteht, wird nie gemeldet.
#[tokio::test]
async fn unwetter_wird_nicht_gemeldet() {
    let pool = crate::db::test_pool().await;
    let (b, e) = setup(&pool).await;
    let empfaenger = melden(
        &pool,
        &LiveHub::new(),
        Anlass::neu(
            e,
            BenachrichtigungArt::Unwetter,
            Bezug::neu(BenachrichtigungBezugTyp::Einsatz, e),
        )
        .an(Adressat::Nutzer(b)),
    )
    .await;
    assert!(empfaenger.is_empty());
    assert!(ids(&pool).await.is_empty());
}

/// Die Detailzeile einer Ablösung nennt Einheit und Fälligkeit in der Anzeigezone des Einsatzes
/// (LLH-1209; vorher bildete sie der Client, LFH-692): 13:30 UTC ist in Berlin 15:30, eine
/// eigene Zone des Einsatzes geht der Organisation vor.
#[tokio::test]
async fn detail_der_abloesung_nennt_einheit_und_uhrzeit_in_der_anzeigezone() {
    let pool = crate::db::test_pool().await;
    let (b, e) = setup(&pool).await;
    let einheit: i64 = sqlx::query_scalar(
        "INSERT INTO einsatz_einheit (einsatz_id, name) VALUES (?, 'Florian 1') RETURNING id",
    )
    .bind(e)
    .fetch_one(&pool)
    .await
    .unwrap();
    let schicht: i64 = sqlx::query_scalar(
        "INSERT INTO einsatz_abloesung (einsatz_id, einheit_id, beginn_at, rhythmus_minuten, \
             rhythmus_quelle, faellig_at, angelegt_von_id) \
         VALUES (?, ?, '2026-09-22 09:30:00', 240, 'einheit', '2026-09-22 13:30:00', ?) \
         RETURNING id",
    )
    .bind(e)
    .bind(einheit)
    .bind(b)
    .fetch_one(&pool)
    .await
    .unwrap();
    let bezug = Bezug::neu(BenachrichtigungBezugTyp::Abloesung, schicht);
    let detail = |art| {
        let pool = pool.clone();
        async move {
            text::bilden(&pool, e, art, bezug)
                .await
                .unwrap()
                .detail
                .unwrap()
        }
    };
    // Ohne Einstellung gilt die Vorgabe Europe/Berlin; die Vorwarnung nennt die Fälligkeit.
    assert_eq!(
        detail(BenachrichtigungArt::AbloesungVorwarnung).await,
        "Florian 1, 15:30"
    );
    sqlx::query("INSERT INTO einsatz_einstellungen (einsatz_id, zeitzone) VALUES (?, 'UTC')")
        .bind(e)
        .execute(&pool)
        .await
        .unwrap();
    assert_eq!(
        detail(BenachrichtigungArt::AbloesungFaellig).await,
        "Florian 1, 13:30"
    );
}

/// Dasselbe für die Detailzeile eines Nachforderungs-Status (LLH-1216), die zwei Spalten liest:
/// nur Retain-Werte, und die Abfrage nennt keinen Führungs-Freitext der Nachforderung.
#[tokio::test]
async fn detail_der_nachforderung_liest_nur_retain_spalten() {
    let pool = crate::db::test_pool().await;
    for &(tabelle, spalte) in text::NACHFORDERUNG_SPALTEN {
        assert!(
            matches!(
                klassifikation_von(tabelle, spalte),
                Some(Klassifikation::Retain(_))
            ),
            "{tabelle}.{spalte} ist kein Retain-Wert"
        );
    }
    sqlx::query(text::NACHFORDERUNG_SQL)
        .bind(1)
        .bind(1)
        .fetch_all(&pool)
        .await
        .expect("Abfrage passt zum Schema");
    for scrub in [
        "art",
        "bezeichnung",
        "begruendung",
        "abgelehnt_grund",
        "adressat_bezeichnung",
    ] {
        assert!(
            matches!(
                klassifikation_von("nachforderung", scrub),
                Some(Klassifikation::Scrub(..))
            ),
            "nachforderung.{scrub} ist kein Scrub-Wert mehr"
        );
        let gelesen = text::NACHFORDERUNG_SQL
            .split(" FROM ")
            .next()
            .unwrap()
            .split([' ', ','])
            .any(|w| w == scrub);
        assert!(!gelesen, "Detailzeile liest {scrub}");
    }
}

/// Der Titel nennt den Status aus dem Bezug, auch wenn die Nachforderung inzwischen weiter ist.
#[tokio::test]
async fn nachforderung_titel_nennt_den_status_des_wechsels() {
    let pool = crate::db::test_pool().await;
    let (b, e) = setup(&pool).await;
    let nf: i64 = sqlx::query_scalar(
        "INSERT INTO nachforderung (einsatz_id, art, bezeichnung, anzahl, adressat_kategorie, \
         prioritaet, status, angefordert_at, erstellt_von_id) \
         VALUES (?, 'RTW', 'Verstärkung', 2, 'nachbar_ea', 'normal', 'eingetroffen', \
         '2026-10-14 09:00:00', ?) RETURNING id",
    )
    .bind(e)
    .bind(b)
    .fetch_one(&pool)
    .await
    .unwrap();
    let t = text::bilden(
        &pool,
        e,
        BenachrichtigungArt::NachforderungStatus,
        Bezug::neu(BenachrichtigungBezugTyp::NachforderungZugesagt, nf),
    )
    .await
    .unwrap();
    assert_eq!(t.titel, "Nachforderung zugesagt");
    assert_eq!(t.detail.as_deref(), Some("2× an Nachbar-EA"));
    assert_eq!(t.pfad, format!("/einsaetze/{e}/nachforderungen"));
    sqlx::query("UPDATE nachforderung SET anzahl = NULL WHERE id = ?")
        .bind(nf)
        .execute(&pool)
        .await
        .unwrap();
    let ohne_anzahl = text::bilden(
        &pool,
        e,
        BenachrichtigungArt::NachforderungStatus,
        Bezug::neu(BenachrichtigungBezugTyp::NachforderungAbgelehnt, nf),
    )
    .await
    .unwrap();
    assert_eq!(ohne_anzahl.titel, "Nachforderung abgelehnt");
    assert_eq!(ohne_anzahl.detail.as_deref(), Some("an Nachbar-EA"));
    let fremd = text::bilden(
        &pool,
        e + 1,
        BenachrichtigungArt::NachforderungStatus,
        Bezug::neu(BenachrichtigungBezugTyp::NachforderungAbgelehnt, nf),
    )
    .await
    .unwrap();
    assert_eq!(fremd.detail, None, "Bezug aus einem fremden Einsatz");
}
