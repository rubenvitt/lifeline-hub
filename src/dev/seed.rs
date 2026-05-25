use crate::auth::{
    password, ORG_ROLLE_FUEHRUNGSKRAFT, ORG_ROLLE_KEINE, ROLLE_ADMIN, ROLLE_KEINER,
};
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

/// Legt reproduzierbare Dev-Testdaten an. Idempotent: mehrfacher Aufruf
/// erzeugt keine Duplikate. Wird in `main` VOR `bootstrap_admin` aufgerufen,
/// daher legt diese Funktion die Organisation selbst an.
pub async fn dev_seed(pool: &SqlitePool) -> Result<(), AppError> {
    let org_id = organisation_anlegen(pool).await?;
    benutzer_seeden(pool, org_id).await?;
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
    let id = sqlx::query_scalar::<_, i64>("INSERT INTO organisation (name) VALUES (?) RETURNING id")
        .bind(SEED_ORG_NAME)
        .fetch_one(pool)
        .await?;
    Ok(id)
}

/// Seedet die `SEED_BENUTZER`. Idempotent über den natürlichen Schlüssel
/// `benutzername`: existiert der Benutzer bereits, wird übersprungen (und das
/// teure Argon2-Hashing gar nicht erst ausgeführt).
async fn benutzer_seeden(pool: &SqlitePool, org_id: i64) -> Result<(), AppError> {
    for b in SEED_BENUTZER {
        let existiert: Option<i64> =
            sqlx::query_scalar("SELECT 1 FROM benutzer WHERE benutzername = ?")
                .bind(b.benutzername)
                .fetch_optional(pool)
                .await?;
        if existiert.is_some() {
            continue;
        }
        let hash = password::hash(b.passwort)?;
        sqlx::query(
            "INSERT INTO benutzer \
                (org_id, anzeigename, benutzername, passwort_hash, system_rolle, org_rolle, aktiv) \
             VALUES (?, ?, ?, ?, ?, ?, ?)",
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
