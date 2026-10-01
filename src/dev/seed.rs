use crate::auth::{password, ORG_ROLLE_FUEHRUNGSKRAFT, ORG_ROLLE_KEINE, ROLLE_ADMIN, ROLLE_KEINER};
use crate::error::AppError;
use sqlx::SqlitePool;

/// Ein Seed-Benutzer. Intern und bewusst nicht `Serialize`: `system_rolle`/`org_rolle` dürfen
/// nicht über den Dev-Endpoint hinaus; dafür gibt es `DevBenutzerResponse`.
pub struct DevBenutzer {
    pub benutzername: &'static str,
    /// Einheitliches Klartext-Dev-Passwort (siehe SEED_PASSWORT).
    pub passwort: &'static str,
    pub anzeigename: &'static str,
    pub system_rolle: &'static str,
    pub org_rolle: &'static str,
    /// Menschenlesbares Rollen-Label, nur für die Anzeige im Login-Picker.
    pub rolle_anzeige: &'static str,
    pub aktiv: bool,
}

/// Einheitliches Dev-Passwort für alle Seed-Benutzer.
pub const SEED_PASSWORT: &str = "dev";

/// Source of Truth für Seeding UND /api/dev/users. Nur hier gepflegt.
pub const SEED_BENUTZER: &[DevBenutzer] = &[
    DevBenutzer {
        benutzername: "admin",
        passwort: SEED_PASSWORT,
        anzeigename: "Administrator",
        system_rolle: ROLLE_ADMIN,
        org_rolle: ORG_ROLLE_KEINE,
        rolle_anzeige: "Admin",
        aktiv: true,
    },
    DevBenutzer {
        benutzername: "leitung",
        passwort: SEED_PASSWORT,
        anzeigename: "Führungskraft",
        system_rolle: ROLLE_KEINER,
        org_rolle: ORG_ROLLE_FUEHRUNGSKRAFT,
        rolle_anzeige: "Führungskraft",
        aktiv: true,
    },
    DevBenutzer {
        benutzername: "mitglied",
        passwort: SEED_PASSWORT,
        anzeigename: "Einsatzkraft",
        system_rolle: ROLLE_KEINER,
        org_rolle: ORG_ROLLE_KEINE,
        rolle_anzeige: "Benutzer",
        aktiv: true,
    },
    DevBenutzer {
        benutzername: "inaktiv",
        passwort: SEED_PASSWORT,
        anzeigename: "Gesperrtes Konto",
        system_rolle: ROLLE_KEINER,
        org_rolle: ORG_ROLLE_KEINE,
        rolle_anzeige: "Benutzer",
        aktiv: false,
    },
];

/// Fester Name der Dev-Organisation; `config.org_name` wird ignoriert, damit Dev-Daten
/// reproduzierbar sind.
const SEED_ORG_NAME: &str = "Entwicklung";

/// Wer die Seed-Einsätze anlegt und den abgeschlossenen abschließt. Über ihn bestimmt
/// `einsatz::repo::anlegen` die Organisation der Einsätze (LFH-232), und er wird dort
/// Einsatzleitung — wie beim Anlegen im Betrieb.
const SEED_ERSTELLER: &str = "leitung";

/// Seed-Einsätze: (bezeichnung, stichwort, status). `bezeichnung` ist der
/// natürliche Schlüssel für die Idempotenz.
const SEED_EINSAETZE: &[(&str, &str, &str)] = &[
    ("Übung Hochwasser", "THW-Übung", "aktiv"),
    ("Verkehrsunfall B27", "VU/Person", "aktiv"),
    ("Sturmtief Abschluss", "Unwetter", "abgeschlossen"),
];

/// Legt reproduzierbare Dev-Testdaten an, idempotent. Läuft in `main` NACH `bootstrap_admin` und
/// nutzt die Organisation des Admins `admin_benutzername`; die Seed-Benutzer werden per Upsert
/// auf den Dev-Stand gesetzt. Einsätze und ETB-Einträge entstehen über die Repo-Wege des
/// Betriebs (LFH-736), nicht über rohes SQL.
pub async fn dev_seed(pool: &SqlitePool, admin_benutzername: &str) -> Result<(), AppError> {
    let org_id = organisation_bestimmen(pool, admin_benutzername).await?;
    benutzer_seeden(pool, org_id).await?;
    einsaetze_seeden(pool, org_id).await?;
    mitgliedschaften_seeden(pool, org_id).await?;
    etb_seeden(pool, org_id).await?;
    Ok(())
}

/// Liefert die Organisation des Admins aus `bootstrap_admin`; gibt es ihn nicht (Tests ohne
/// Bootstrap), wird die Dev-Organisation angelegt. Nicht `ORDER BY id LIMIT 1` (LFH-736): mit
/// einer zweiten Organisation landeten die Seed-Benutzer und ihre Einsätze in einer fremden.
async fn organisation_bestimmen(
    pool: &SqlitePool,
    admin_benutzername: &str,
) -> Result<i64, AppError> {
    if let Some(id) =
        sqlx::query_scalar::<_, i64>("SELECT org_id FROM benutzer WHERE benutzername = ?")
            .bind(admin_benutzername)
            .fetch_optional(pool)
            .await?
    {
        return Ok(id);
    }
    let id =
        sqlx::query_scalar::<_, i64>("INSERT INTO organisation (name) VALUES (?) RETURNING id")
            .bind(SEED_ORG_NAME)
            .fetch_one(pool)
            .await?;
    Ok(id)
}

/// Seedet `SEED_BENUTZER` per Upsert über `benutzername`. Ein vorhandenes Konto — auch der
/// Admin aus `bootstrap_admin` — wird inklusive Passwort-Hash auf den Dev-Stand gesetzt, damit
/// der Login-Picker funktioniert. Argon2 läuft dadurch bei jedem Start (im Dev-Build
/// akzeptabel).
async fn benutzer_seeden(pool: &SqlitePool, org_id: i64) -> Result<(), AppError> {
    for b in SEED_BENUTZER {
        let hash = password::hash(b.passwort)?;
        sqlx::query(
            "INSERT INTO benutzer \
                (org_id, anzeigename, benutzername, passwort_hash, system_rolle, org_rolle, aktiv) \
             VALUES (?, ?, ?, ?, ?, ?, ?) \
             ON CONFLICT(benutzername) DO UPDATE SET \
                org_id = excluded.org_id, anzeigename = excluded.anzeigename, \
                passwort_hash = excluded.passwort_hash, system_rolle = excluded.system_rolle, \
                org_rolle = excluded.org_rolle, aktiv = excluded.aktiv",
        )
        .bind(org_id)
        .bind(b.anzeigename)
        .bind(b.benutzername)
        .bind(&hash)
        .bind(b.system_rolle)
        .bind(b.org_rolle)
        .bind(b.aktiv)
        .execute(pool)
        .await?;
    }
    Ok(())
}

/// Seed-Mitgliedschaften: (einsatz_bezeichnung, benutzername, einsatz_rolle).
/// einsatz_rolle ∈ {einsatzleitung, fuehrungspersonal, beobachter}.
const SEED_MITGLIEDSCHAFTEN: &[(&str, &str, &str)] = &[
    ("Übung Hochwasser", "leitung", "einsatzleitung"),
    ("Übung Hochwasser", "mitglied", "beobachter"),
    ("Übung Hochwasser", "admin", "fuehrungspersonal"),
    ("Verkehrsunfall B27", "leitung", "einsatzleitung"),
    ("Verkehrsunfall B27", "mitglied", "fuehrungspersonal"),
];

/// Die id eines Seed-Einsatzes in der Seed-Organisation. `bezeichnung` ist nur innerhalb
/// einer Organisation eindeutig.
async fn seed_einsatz_id(
    pool: &SqlitePool,
    org_id: i64,
    bezeichnung: &str,
) -> Result<Option<i64>, AppError> {
    Ok(
        sqlx::query_scalar("SELECT id FROM einsatz WHERE bezeichnung = ? AND org_id = ?")
            .bind(bezeichnung)
            .bind(org_id)
            .fetch_optional(pool)
            .await?,
    )
}

/// Die id eines Seed-Benutzers; er existiert, weil `benutzer_seeden` vorher läuft.
async fn seed_benutzer_id(pool: &SqlitePool, benutzername: &str) -> Result<i64, AppError> {
    Ok(
        sqlx::query_scalar("SELECT id FROM benutzer WHERE benutzername = ?")
            .bind(benutzername)
            .fetch_one(pool)
            .await?,
    )
}

/// Seedet die `SEED_EINSAETZE` über `einsatz::repo::anlegen` (LFH-736): Einsatznummer
/// (LFH-617), ID oberhalb der Demo-Sperre (LFH-690), Organisation des Erstellers (LFH-232).
/// Idempotent: nur fehlende `bezeichnung`en anlegen.
async fn einsaetze_seeden(pool: &SqlitePool, org_id: i64) -> Result<(), AppError> {
    let ersteller_id = seed_benutzer_id(pool, SEED_ERSTELLER).await?;
    for &(bezeichnung, stichwort, status) in SEED_EINSAETZE {
        if seed_einsatz_id(pool, org_id, bezeichnung).await?.is_some() {
            continue;
        }
        let einsatz = crate::einsatz::repo::anlegen(
            pool,
            crate::einsatz::repo::NeuerEinsatzDaten {
                bezeichnung,
                stichwort: Some(stichwort),
                einsatzart: None,
                begonnen_at: None,
            },
            ersteller_id,
        )
        .await?;
        if status == crate::einsatz::STATUS_ABGESCHLOSSEN {
            crate::einsatz::repo::abschliessen(pool, einsatz.id, ersteller_id).await?;
        }
    }
    Ok(())
}

/// Seed-ETB-Einträge: (einsatz_bezeichnung, typ, inhalt, erfasser_benutzername,
/// ereigniszeit). typ ∈ {meldung, anordnung, lage, ...}. Reihenfolge bestimmt
/// die lfd_nr innerhalb eines Einsatzes (ab dem ETB-Startwert, lückenlos).
const SEED_ETB: &[(&str, &str, &str, &str, &str)] = &[
    (
        "Übung Hochwasser",
        "lage",
        "Deich bei km 12 wird beobachtet, Pegel steigt langsam.",
        "leitung",
        "2026-05-25 08:00:00",
    ),
    (
        "Übung Hochwasser",
        "meldung",
        "Sandsackfüllstelle am Bauhof eingerichtet.",
        "mitglied",
        "2026-05-25 08:15:00",
    ),
    (
        "Übung Hochwasser",
        "anordnung",
        "Trupp 1 zur Deichsicherung an km 12 entsenden.",
        "leitung",
        "2026-05-25 08:20:00",
    ),
    (
        "Verkehrsunfall B27",
        "meldung",
        "PKW gegen Baum, eine Person eingeklemmt.",
        "leitung",
        "2026-05-25 09:30:00",
    ),
    (
        "Verkehrsunfall B27",
        "lage",
        "Rettungsdienst und Feuerwehr vor Ort, Bergung läuft.",
        "mitglied",
        "2026-05-25 09:35:00",
    ),
];

/// Seedet die `SEED_MITGLIEDSCHAFTEN`. Idempotent über den Primärschlüssel
/// `(einsatz_id, benutzer_id)` via `ON CONFLICT DO NOTHING`.
async fn mitgliedschaften_seeden(pool: &SqlitePool, org_id: i64) -> Result<(), AppError> {
    for &(einsatz_bez, benutzername, rolle) in SEED_MITGLIEDSCHAFTEN {
        let einsatz_id = seed_einsatz_id(pool, org_id, einsatz_bez).await?;
        let benutzer_id: Option<i64> =
            sqlx::query_scalar("SELECT id FROM benutzer WHERE benutzername = ?")
                .bind(benutzername)
                .fetch_optional(pool)
                .await?;
        let (Some(einsatz_id), Some(benutzer_id)) = (einsatz_id, benutzer_id) else {
            continue;
        };
        sqlx::query(
            "INSERT INTO einsatz_mitgliedschaft (einsatz_id, benutzer_id, einsatz_rolle) \
             VALUES (?, ?, ?) ON CONFLICT DO NOTHING",
        )
        .bind(einsatz_id)
        .bind(benutzer_id)
        .bind(rolle)
        .execute(pool)
        .await?;
    }
    Ok(())
}

/// Seedet die `SEED_ETB` über `etb::repo::anlegen` (LFH-736): `lfd_nr` ab dem ETB-Startwert
/// des Einsatzes (LFH-133) und Funktions-Snapshot des Verfassers (LFH-615). Idempotent pro
/// Einsatz: nur anlegen, wenn der Einsatz noch KEINE Einträge hat (so bleibt `lfd_nr`
/// lückenlos).
async fn etb_seeden(pool: &SqlitePool, org_id: i64) -> Result<(), AppError> {
    for &(einsatz_bez, _, _) in SEED_EINSAETZE {
        let Some(einsatz_id) = seed_einsatz_id(pool, org_id, einsatz_bez).await? else {
            continue;
        };

        let vorhandene: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM etb_eintrag WHERE einsatz_id = ?")
                .bind(einsatz_id)
                .fetch_one(pool)
                .await?;
        if vorhandene > 0 {
            continue;
        }

        for &(bez, typ, inhalt, erfasser, ereigniszeit) in SEED_ETB {
            if bez != einsatz_bez {
                continue;
            }
            let erfasser_id = seed_benutzer_id(pool, erfasser).await?;
            crate::etb::repo::anlegen(
                pool,
                einsatz_id,
                erfasser_id,
                crate::etb::repo::EintragDaten {
                    typ,
                    inhalt,
                    von: None,
                    an: None,
                    meldeweg: None,
                    veranlassung: None,
                    ereigniszeit: Some(ereigniszeit),
                    erfasst_lokal_at: None,
                    berichtigt_eintrag_id: None,
                },
            )
            .await?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn seed_benutzer_enthaelt_erwartete_konten() {
        let namen: Vec<&str> = SEED_BENUTZER.iter().map(|b| b.benutzername).collect();
        assert!(namen.contains(&"admin"));
        assert!(namen.contains(&"leitung"));
        assert!(namen.contains(&"mitglied"));
        assert!(namen.contains(&"inaktiv"));
        // Einheitliches Dev-Passwort für alle.
        assert!(SEED_BENUTZER.iter().all(|b| b.passwort == "dev"));
        // 'inaktiv' ist nicht aktiv (Test der Login-Sperre).
        let inaktiv = SEED_BENUTZER
            .iter()
            .find(|b| b.benutzername == "inaktiv")
            .unwrap();
        assert!(!inaktiv.aktiv);
    }

    #[tokio::test]
    async fn dev_seed_nach_bootstrap_setzt_admin_passwort_zurueck() {
        let pool = crate::db::test_pool().await;
        // Reihenfolge wie in `main`: `bootstrap_admin` zuerst (mit zufälligem Passwort), dann
        // `dev_seed`.
        crate::auth::bootstrap::bootstrap_admin(
            &pool,
            "Org",
            "admin",
            Some("zufalls-bootstrap-pw"),
        )
        .await
        .unwrap();
        dev_seed(&pool, "admin").await.unwrap();

        // bootstrap_admin hat den FMS-Default-Katalog geseedet (10 Hauptstatus).
        let status: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM fahrzeug_status")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(status, 10, "Katalog wird trotz dev-seeds geseedet");

        // dev_seed hat das Admin-Passwort auf das Dev-Passwort zurückgesetzt.
        let hash: String =
            sqlx::query_scalar("SELECT passwort_hash FROM benutzer WHERE benutzername = 'admin'")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert!(
            password::verifizieren(SEED_PASSWORT, &hash),
            "Admin nutzt das Dev-Passwort"
        );
        assert!(
            !password::verifizieren("zufalls-bootstrap-pw", &hash),
            "altes Bootstrap-Passwort gilt nicht mehr"
        );

        // Genau die vier Dev-Benutzer — 'admin' wurde nicht dupliziert.
        let anzahl: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM benutzer")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(anzahl, 4);
    }

    #[tokio::test]
    async fn einsatz_seeding_ist_idempotent() {
        let pool = crate::db::test_pool().await;
        dev_seed(&pool, "admin").await.unwrap();
        dev_seed(&pool, "admin").await.unwrap();

        let einsaetze: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM einsatz")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(einsaetze, 3);

        // Zwei aktive und ein abgeschlossener Einsatz sind enthalten.
        let aktiv: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM einsatz WHERE status = 'aktiv'")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(aktiv, 2);
        let abgeschlossen: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM einsatz WHERE status = 'abgeschlossen'")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(abgeschlossen, 1);
    }

    #[tokio::test]
    async fn mitgliedschaft_seeding_ist_idempotent() {
        let pool = crate::db::test_pool().await;
        dev_seed(&pool, "admin").await.unwrap();
        let n1: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM einsatz_mitgliedschaft")
            .fetch_one(&pool)
            .await
            .unwrap();
        dev_seed(&pool, "admin").await.unwrap();
        let n2: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM einsatz_mitgliedschaft")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(n1, n2, "zweiter Seed-Lauf darf keine Duplikate erzeugen");
        assert!(n1 > 0, "es müssen Mitgliedschaften angelegt werden");

        // 'leitung' ist Einsatzleitung in 'Übung Hochwasser'.
        let rolle: String = sqlx::query_scalar(
            "SELECT m.einsatz_rolle FROM einsatz_mitgliedschaft m \
             JOIN einsatz e ON e.id = m.einsatz_id \
             JOIN benutzer b ON b.id = m.benutzer_id \
             WHERE e.bezeichnung = 'Übung Hochwasser' AND b.benutzername = 'leitung'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(rolle, "einsatzleitung");
    }

    #[tokio::test]
    async fn etb_seeding_ist_idempotent_und_lfd_nr_lueckenlos() {
        let pool = crate::db::test_pool().await;
        dev_seed(&pool, "admin").await.unwrap();
        let n1: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM etb_eintrag")
            .fetch_one(&pool)
            .await
            .unwrap();
        dev_seed(&pool, "admin").await.unwrap();
        let n2: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM etb_eintrag")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(
            n1, n2,
            "zweiter Seed-Lauf darf keine ETB-Duplikate erzeugen"
        );
        assert!(n1 > 0, "es müssen ETB-Einträge angelegt werden");

        // lfd_nr lückenlos ab 1 pro Einsatz: COUNT == MAX(lfd_nr).
        let gruppen: Vec<(i64, i64, i64)> = sqlx::query_as(
            "SELECT einsatz_id, COUNT(*) AS anzahl, MAX(lfd_nr) AS maxnr \
             FROM etb_eintrag GROUP BY einsatz_id",
        )
        .fetch_all(&pool)
        .await
        .unwrap();
        for (einsatz_id, anzahl, maxnr) in gruppen {
            assert_eq!(
                anzahl, maxnr,
                "lfd_nr in Einsatz {einsatz_id} nicht lückenlos"
            );
        }
    }

    /// LFH-736: Die Seed-Daten gehören zur Organisation des Bootstrap-Admins, nicht zur
    /// ältesten der Instanz (`ORDER BY id LIMIT 1`).
    #[tokio::test]
    async fn seed_nutzt_die_organisation_des_bootstrap_admins() {
        let pool = crate::db::test_pool().await;
        let fremd: i64 =
            sqlx::query_scalar("INSERT INTO organisation (name) VALUES ('Fremd') RETURNING id")
                .fetch_one(&pool)
                .await
                .unwrap();
        crate::auth::bootstrap::bootstrap_admin(&pool, "Eigene", "chef", Some("pw"))
            .await
            .unwrap();
        let eigene: i64 =
            sqlx::query_scalar("SELECT org_id FROM benutzer WHERE benutzername = 'chef'")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_ne!(fremd, eigene);

        dev_seed(&pool, "chef").await.unwrap();

        let je_org: Vec<(i64, i64)> =
            sqlx::query_as("SELECT org_id, COUNT(*) FROM einsatz GROUP BY org_id")
                .fetch_all(&pool)
                .await
                .unwrap();
        assert_eq!(
            je_org,
            vec![(eigene, 3)],
            "alle Einsätze in der Org des Admins"
        );
        let leitung_org: i64 =
            sqlx::query_scalar("SELECT org_id FROM benutzer WHERE benutzername = 'leitung'")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(leitung_org, eigene);
    }

    /// LFH-736: Die Einsätze entstehen über `einsatz::repo::anlegen` — mit Einsatznummer
    /// (LFH-617) und oberhalb jeder ID, die eine entfernte Demo-Historie sperrt (LFH-690).
    #[tokio::test]
    async fn seed_einsaetze_tragen_nummer_und_achten_die_demo_sperre() {
        let pool = crate::db::test_pool().await;
        crate::auth::bootstrap::bootstrap_admin(&pool, "Org", "admin", Some("pw"))
            .await
            .unwrap();
        sqlx::query(
            "INSERT INTO demo_import (org_id, einsatz_id, bericht, entfernt_at) \
             SELECT org_id, 41, '{}', datetime('now') FROM benutzer WHERE benutzername = 'admin'",
        )
        .execute(&pool)
        .await
        .unwrap();

        dev_seed(&pool, "admin").await.unwrap();

        let (min_id, ohne_nummer): (i64, i64) = sqlx::query_as(
            "SELECT MIN(id), SUM(einsatznummer_intern IS NULL OR nummer_lfd IS NULL) FROM einsatz",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert!(min_id > 41, "gesperrte Demo-ID wiederverwendet: {min_id}");
        assert_eq!(
            ohne_nummer, 0,
            "jeder Seed-Einsatz trägt eine Einsatznummer"
        );
    }

    /// LFH-736: Der abgeschlossene Seed-Einsatz wird über den Betriebsweg abgeschlossen, mit
    /// Zeitpunkt und abschließender Person.
    #[tokio::test]
    async fn abgeschlossener_seed_einsatz_traegt_abschluss() {
        let pool = crate::db::test_pool().await;
        dev_seed(&pool, "admin").await.unwrap();

        let (status, at, von): (String, Option<String>, Option<String>) = sqlx::query_as(
            "SELECT e.status, e.abgeschlossen_at, b.benutzername FROM einsatz e \
             LEFT JOIN benutzer b ON b.id = e.abgeschlossen_von \
             WHERE e.bezeichnung = 'Sturmtief Abschluss'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(status, "abgeschlossen");
        assert!(at.is_some(), "abgeschlossen_at gesetzt");
        assert_eq!(von.as_deref(), Some(SEED_ERSTELLER));
    }

    /// LFH-736: Die Seed-ETB-Einträge entstehen über `etb::repo::anlegen` und tragen den
    /// Funktions-Snapshot (LFH-615) ihres Verfassers.
    #[tokio::test]
    async fn seed_etb_traegt_funktions_snapshot() {
        let pool = crate::db::test_pool().await;
        dev_seed(&pool, "admin").await.unwrap();

        let funktionen: Vec<Option<String>> = sqlx::query_scalar(
            "SELECT t.erfasser_funktion FROM etb_eintrag t \
             JOIN einsatz e ON e.id = t.einsatz_id \
             JOIN benutzer b ON b.id = t.erfasser_id \
             WHERE e.bezeichnung = 'Übung Hochwasser' AND b.benutzername = 'leitung'",
        )
        .fetch_all(&pool)
        .await
        .unwrap();
        assert!(!funktionen.is_empty());
        assert!(
            funktionen.iter().all(|f| f.as_deref() == Some("EL")),
            "Einsatzleitung schreibt als „EL“: {funktionen:?}"
        );
    }

    #[tokio::test]
    async fn org_und_benutzer_seeding_ist_idempotent() {
        let pool = crate::db::test_pool().await;

        dev_seed(&pool, "admin").await.unwrap();
        dev_seed(&pool, "admin").await.unwrap();

        // Genau eine Organisation, egal wie oft geseedet wird.
        let orgs: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM organisation")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(orgs, 1);

        // Alle vier Seed-Benutzer, keine Duplikate.
        let benutzer: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM benutzer")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(benutzer, 4);

        // 'admin' hat system_rolle 'admin', 'leitung' org_rolle 'fuehrungskraft'.
        let admin_rolle: String =
            sqlx::query_scalar("SELECT system_rolle FROM benutzer WHERE benutzername = 'admin'")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(admin_rolle, "admin");
        let leitung_org: String =
            sqlx::query_scalar("SELECT org_rolle FROM benutzer WHERE benutzername = 'leitung'")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(leitung_org, "fuehrungskraft");

        // 'inaktiv' ist aktiv=0 (Login-Sperre testbar).
        let inaktiv_aktiv: i64 =
            sqlx::query_scalar("SELECT aktiv FROM benutzer WHERE benutzername = 'inaktiv'")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(inaktiv_aktiv, 0);

        // Geseedetes Passwort ist 'dev' (verifizierbar gegen den Hash).
        let hash: String =
            sqlx::query_scalar("SELECT passwort_hash FROM benutzer WHERE benutzername = 'admin'")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert!(crate::auth::password::verifizieren("dev", &hash));
    }
}
