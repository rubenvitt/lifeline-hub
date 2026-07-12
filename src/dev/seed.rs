use crate::auth::{password, ORG_ROLLE_FUEHRUNGSKRAFT, ORG_ROLLE_KEINE, ROLLE_ADMIN, ROLLE_KEINER};
use crate::error::AppError;
use sqlx::SqlitePool;

/// Ein Seed-Benutzer. **Interne** Struktur — bewusst NICHT `Serialize`:
/// `system_rolle`/`org_rolle` dürfen nicht über den Dev-Endpoint nach außen.
/// Für die Endpoint-Antwort gibt es den separaten `DevBenutzerResponse`-Typ.
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

/// Fester Name der Dev-Organisation. `config.org_name` wird im Dev-Seed
/// bewusst ignoriert — Dev-Daten sollen unabhängig von der Server-Konfiguration
/// reproduzierbar sein.
const SEED_ORG_NAME: &str = "Entwicklung";

/// Seed-Einsätze: (bezeichnung, stichwort, status). `bezeichnung` ist der
/// natürliche Schlüssel für die Idempotenz.
const SEED_EINSAETZE: &[(&str, &str, &str)] = &[
    ("Übung Hochwasser", "THW-Übung", "aktiv"),
    ("Verkehrsunfall B27", "VU/Person", "aktiv"),
    ("Sturmtief Abschluss", "Unwetter", "abgeschlossen"),
];

/// Legt reproduzierbare Dev-Testdaten an. Idempotent: mehrfacher Aufruf
/// erzeugt keine Duplikate. Wird in `main` NACH `bootstrap_admin` aufgerufen und
/// nutzt dessen Organisation (oder legt selbst eine an, falls keine existiert);
/// die Seed-Benutzer werden per Upsert auf den bekannten Dev-Stand gesetzt.
pub async fn dev_seed(pool: &SqlitePool) -> Result<(), AppError> {
    let org_id = organisation_anlegen(pool).await?;
    benutzer_seeden(pool, org_id).await?;
    einsaetze_seeden(pool, org_id).await?;
    mitgliedschaften_seeden(pool).await?;
    etb_seeden(pool).await?;
    Ok(())
}

/// Liefert die id der (einzigen) Organisation; legt sie an, falls keine existiert.
async fn organisation_anlegen(pool: &SqlitePool) -> Result<i64, AppError> {
    if let Some(id) =
        sqlx::query_scalar::<_, i64>("SELECT id FROM organisation ORDER BY id LIMIT 1")
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

/// Seedet die `SEED_BENUTZER` per Upsert über den natürlichen Schlüssel
/// `benutzername`. Existiert ein Konto bereits — insbesondere der von
/// `bootstrap_admin` angelegte Admin (mit Zufalls-/Config-Passwort) —, werden
/// seine Felder inkl. des auf das **Dev-Passwort** zurückgesetzten Hashes
/// überschrieben. So sind die Dev-Konten reproduzierbar und der
/// `/api/dev/users`-Login-Picker funktioniert auch nach `bootstrap_admin`.
/// (Das Argon2-Hashing läuft dadurch bei jedem Start — im Dev-Build akzeptabel.)
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

/// Seedet die `SEED_EINSAETZE`. Idempotent: nur fehlende `bezeichnung`en anlegen.
async fn einsaetze_seeden(pool: &SqlitePool, org_id: i64) -> Result<(), AppError> {
    for &(bezeichnung, stichwort, status) in SEED_EINSAETZE {
        let existiert: Option<i64> =
            sqlx::query_scalar("SELECT 1 FROM einsatz WHERE bezeichnung = ? AND org_id = ?")
                .bind(bezeichnung)
                .bind(org_id)
                .fetch_optional(pool)
                .await?;
        if existiert.is_some() {
            continue;
        }
        sqlx::query(
            "INSERT INTO einsatz (org_id, bezeichnung, stichwort, status) VALUES (?, ?, ?, ?)",
        )
        .bind(org_id)
        .bind(bezeichnung)
        .bind(stichwort)
        .bind(status)
        .execute(pool)
        .await?;
    }
    Ok(())
}

/// Seed-ETB-Einträge: (einsatz_bezeichnung, typ, inhalt, erfasser_benutzername,
/// ereigniszeit). typ ∈ {meldung, anordnung, lage, ...}. Reihenfolge bestimmt
/// die lfd_nr innerhalb eines Einsatzes (ab 1, lückenlos).
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
async fn mitgliedschaften_seeden(pool: &SqlitePool) -> Result<(), AppError> {
    for &(einsatz_bez, benutzername, rolle) in SEED_MITGLIEDSCHAFTEN {
        let einsatz_id: Option<i64> =
            sqlx::query_scalar("SELECT id FROM einsatz WHERE bezeichnung = ?")
                .bind(einsatz_bez)
                .fetch_optional(pool)
                .await?;
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

/// Seedet die `SEED_ETB`. Idempotent pro Einsatz: nur anlegen, wenn der
/// Einsatz noch KEINE Einträge hat (so bleibt lfd_nr lückenlos ab 1).
async fn etb_seeden(pool: &SqlitePool) -> Result<(), AppError> {
    for &(einsatz_bez, _, _) in SEED_EINSAETZE {
        let einsatz_id: Option<i64> =
            sqlx::query_scalar("SELECT id FROM einsatz WHERE bezeichnung = ?")
                .bind(einsatz_bez)
                .fetch_optional(pool)
                .await?;
        let Some(einsatz_id) = einsatz_id else {
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

        let mut lfd_nr: i64 = 0;
        for &(bez, typ, inhalt, erfasser, ereigniszeit) in SEED_ETB {
            if bez != einsatz_bez {
                continue;
            }
            let erfasser_id: i64 =
                sqlx::query_scalar("SELECT id FROM benutzer WHERE benutzername = ?")
                    .bind(erfasser)
                    .fetch_one(pool)
                    .await?;
            lfd_nr += 1;
            sqlx::query(
                "INSERT INTO etb_eintrag \
                    (einsatz_id, lfd_nr, typ, inhalt, erfasser_id, ereigniszeit) \
                 VALUES (?, ?, ?, ?, ?, ?)",
            )
            .bind(einsatz_id)
            .bind(lfd_nr)
            .bind(typ)
            .bind(inhalt)
            .bind(erfasser_id)
            .bind(ereigniszeit)
            .execute(pool)
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
        // Reihenfolge wie in main: bootstrap_admin zuerst (Org + Admin + Kataloge,
        // hier mit zufälligem Bootstrap-Passwort), dann dev_seed.
        crate::auth::bootstrap::bootstrap_admin(
            &pool,
            "Org",
            "admin",
            Some("zufalls-bootstrap-pw"),
        )
        .await
        .unwrap();
        dev_seed(&pool).await.unwrap();

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
        dev_seed(&pool).await.unwrap();
        dev_seed(&pool).await.unwrap();

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
        dev_seed(&pool).await.unwrap();
        let n1: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM einsatz_mitgliedschaft")
            .fetch_one(&pool)
            .await
            .unwrap();
        dev_seed(&pool).await.unwrap();
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
        dev_seed(&pool).await.unwrap();
        let n1: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM etb_eintrag")
            .fetch_one(&pool)
            .await
            .unwrap();
        dev_seed(&pool).await.unwrap();
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

    #[tokio::test]
    async fn org_und_benutzer_seeding_ist_idempotent() {
        let pool = crate::db::test_pool().await;

        dev_seed(&pool).await.unwrap();
        dev_seed(&pool).await.unwrap();

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
