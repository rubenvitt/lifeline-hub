use crate::auth::{password, ROLLE_ADMIN};
use crate::einheit::EINHEIT_TYP_STARTLISTE;
use crate::error::AppError;
use crate::fahrzeug::STATUS_STARTLISTE;
use crate::personal::{PERSONAL_STATUS_STARTLISTE, QUALIFIKATION_STARTLISTE};
use argon2::password_hash::rand_core::{OsRng, RngCore};
use sqlx::SqlitePool;

/// Start-Stichworte je neu angelegter Organisation (Reihenfolge = sortier).
/// Combobox erlaubt unabhängig davon Freitext.
const STICHWORT_STARTLISTE: [&str; 12] = [
    "B2", "B2Y", "B3", "B3Y", "B4", "B4Y", "MANV", "MANV7", "MANV15", "MANV50", "Sonderlage",
    "Übung",
];

/// Ergebnis des Bootstraps: ob ein Admin neu angelegt wurde und mit welchem
/// Passwort (nur gesetzt, wenn der Bootstrap ein Zufalls-Passwort erzeugt hat).
#[derive(Debug, Default)]
pub struct BootstrapErgebnis {
    pub admin_angelegt: bool,
    /// Generiertes Zufalls-Passwort, falls keines vorgegeben war.
    pub generiertes_passwort: Option<String>,
}

/// Erzeugt ein gut lesbares Zufalls-Passwort (Hex, 24 Zeichen).
fn zufalls_passwort() -> String {
    let mut bytes = [0u8; 12];
    OsRng.fill_bytes(&mut bytes);
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

/// Legt beim ersten Start eine Organisation und ein Admin-Konto an,
/// sofern noch kein Benutzer existiert. Idempotent: bei vorhandenen
/// Benutzern passiert nichts.
///
/// `admin_passwort = None` → es wird ein Zufalls-Passwort erzeugt und im
/// Ergebnis zurückgegeben (der Aufrufer loggt es).
pub async fn bootstrap_admin(
    pool: &SqlitePool,
    org_name: &str,
    admin_benutzername: &str,
    admin_passwort: Option<&str>,
) -> Result<BootstrapErgebnis, AppError> {
    let anzahl: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM benutzer")
        .fetch_one(pool)
        .await?;
    if anzahl > 0 {
        return Ok(BootstrapErgebnis::default());
    }

    let (passwort, generiert) = match admin_passwort {
        Some(p) => (p.to_string(), None),
        None => {
            let p = zufalls_passwort();
            (p.clone(), Some(p))
        }
    };
    let hash = password::hash(&passwort)?;

    let mut tx = pool.begin().await?;
    // Organisation anlegen (oder vorhandene id=1 nutzen, falls schon vorhanden).
    let org_id: i64 = sqlx::query_scalar(
        "INSERT INTO organisation (name) VALUES (?) RETURNING id",
    )
    .bind(org_name)
    .fetch_one(&mut *tx)
    .await?;

    sqlx::query(
        "INSERT INTO benutzer (org_id, anzeigename, benutzername, passwort_hash, system_rolle) \
         VALUES (?, ?, ?, ?, ?)",
    )
    .bind(org_id)
    .bind("Administrator")
    .bind(admin_benutzername)
    .bind(&hash)
    .bind(ROLLE_ADMIN)
    .execute(&mut *tx)
    .await?;

    for (i, text) in STICHWORT_STARTLISTE.iter().enumerate() {
        sqlx::query(
            "INSERT INTO einsatz_stichwort_vorschlag (org_id, text, sortier) VALUES (?, ?, ?)",
        )
        .bind(org_id)
        .bind(text)
        .bind(i as i64)
        .execute(&mut *tx)
        .await?;
    }

    for (label, kategorie, fms_anker, sortier) in STATUS_STARTLISTE {
        sqlx::query(
            "INSERT INTO fahrzeug_status (org_id, label, kategorie, fms_anker, sortier) \
             VALUES (?, ?, ?, ?, ?)",
        )
        .bind(org_id)
        .bind(label)
        .bind(kategorie)
        .bind(fms_anker)
        .bind(sortier)
        .execute(&mut *tx)
        .await?;
    }

    for (label, sortier) in QUALIFIKATION_STARTLISTE {
        sqlx::query("INSERT INTO qualifikation (org_id, label, sortier) VALUES (?, ?, ?)")
            .bind(org_id)
            .bind(label)
            .bind(sortier)
            .execute(&mut *tx)
            .await?;
    }

    for (label, kategorie, sortier) in PERSONAL_STATUS_STARTLISTE {
        sqlx::query(
            "INSERT INTO personal_status (org_id, label, kategorie, sortier) VALUES (?, ?, ?, ?)",
        )
        .bind(org_id)
        .bind(label)
        .bind(kategorie)
        .bind(sortier)
        .execute(&mut *tx)
        .await?;
    }

    for (label, f, u, m, sortier) in EINHEIT_TYP_STARTLISTE {
        sqlx::query(
            "INSERT INTO einheit_typ (org_id, label, soll_fuehrer, soll_unterfuehrer, soll_mannschaft, sortier) \
             VALUES (?, ?, ?, ?, ?, ?)",
        )
        .bind(org_id)
        .bind(label)
        .bind(f)
        .bind(u)
        .bind(m)
        .bind(sortier)
        .execute(&mut *tx)
        .await?;
    }

    tx.commit().await?;

    Ok(BootstrapErgebnis {
        admin_angelegt: true,
        generiertes_passwort: generiert,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::auth::password;

    #[tokio::test]
    async fn legt_org_und_admin_an_wenn_leer() {
        let pool = crate::db::test_pool().await;
        let erg = bootstrap_admin(&pool, "Meine Orga", "admin", Some("startpw12"))
            .await
            .unwrap();
        assert!(erg.admin_angelegt);
        assert!(erg.generiertes_passwort.is_none());

        let (rolle, hash): (String, String) = sqlx::query_as(
            "SELECT system_rolle, passwort_hash FROM benutzer WHERE benutzername = 'admin'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(rolle, "admin");
        assert!(password::verifizieren("startpw12", &hash));

        let org_name: String = sqlx::query_scalar("SELECT name FROM organisation LIMIT 1")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(org_name, "Meine Orga");
    }

    #[tokio::test]
    async fn generiert_passwort_wenn_keines_vorgegeben() {
        let pool = crate::db::test_pool().await;
        let erg = bootstrap_admin(&pool, "Orga", "admin", None).await.unwrap();
        let pw = erg.generiertes_passwort.expect("Passwort muss generiert sein");

        let hash: String =
            sqlx::query_scalar("SELECT passwort_hash FROM benutzer WHERE benutzername = 'admin'")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert!(password::verifizieren(&pw, &hash));
    }

    #[tokio::test]
    async fn seedet_stichwort_startliste_fuer_neue_org() {
        let pool = crate::db::test_pool().await;
        bootstrap_admin(&pool, "Orga", "admin", Some("startpw12"))
            .await
            .unwrap();

        let texte: Vec<String> = sqlx::query_scalar(
            "SELECT text FROM einsatz_stichwort_vorschlag ORDER BY sortier, text",
        )
        .fetch_all(&pool)
        .await
        .unwrap();

        assert!(texte.contains(&"B2".to_string()));
        assert!(texte.contains(&"MANV".to_string()));
        assert_eq!(texte.len(), 12, "zwölf Start-Stichworte erwartet");
    }

    #[tokio::test]
    async fn seedet_status_katalog_fuer_neue_org() {
        let pool = crate::db::test_pool().await;
        bootstrap_admin(&pool, "Orga", "admin", Some("startpw12"))
            .await
            .unwrap();

        let labels: Vec<String> = sqlx::query_scalar(
            "SELECT label FROM fahrzeug_status ORDER BY sortier",
        )
        .fetch_all(&pool)
        .await
        .unwrap();
        assert_eq!(labels.len(), 10, "zehn FMS-Default-Status erwartet");
        assert_eq!(labels.first().map(String::as_str), Some("1 – Frei auf Funk"));

        // '3 – Auf Anfahrt' ist als 'gebunden' geseedet (erster Initial-Status der Disposition).
        let kat: String = sqlx::query_scalar(
            "SELECT kategorie FROM fahrzeug_status WHERE label = '3 – Auf Anfahrt'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(kat, "gebunden");
    }

    #[tokio::test]
    async fn seedet_qualifikations_startliste_fuer_neue_org() {
        let pool = crate::db::test_pool().await;
        bootstrap_admin(&pool, "Orga", "admin", Some("startpw12")).await.unwrap();
        let labels: Vec<String> = sqlx::query_scalar(
            "SELECT label FROM qualifikation ORDER BY sortier",
        ).fetch_all(&pool).await.unwrap();
        assert_eq!(labels.len(), 9, "neun Default-Qualifikationen erwartet");
        assert_eq!(labels.first().map(String::as_str), Some("Sanitäter"));
        assert!(labels.contains(&"Notarzt".to_string()));
    }

    #[tokio::test]
    async fn seedet_personal_status_startliste_fuer_neue_org() {
        let pool = crate::db::test_pool().await;
        bootstrap_admin(&pool, "Orga", "admin", Some("startpw12")).await.unwrap();
        let labels: Vec<String> = sqlx::query_scalar(
            "SELECT label FROM personal_status ORDER BY sortier",
        ).fetch_all(&pool).await.unwrap();
        assert_eq!(labels.len(), 6, "sechs Default-Personal-Status erwartet");
        // 'alarmiert' ist als 'gebunden' geseedet (erster Initial-Status der Disposition).
        let kat: String = sqlx::query_scalar(
            "SELECT kategorie FROM personal_status WHERE label = 'alarmiert'",
        ).fetch_one(&pool).await.unwrap();
        assert_eq!(kat, "gebunden");
    }

    #[tokio::test]
    async fn seedet_einheit_typ_startliste_fuer_neue_org() {
        let pool = crate::db::test_pool().await;
        bootstrap_admin(&pool, "Orga", "admin", Some("startpw12")).await.unwrap();
        let labels: Vec<String> = sqlx::query_scalar(
            "SELECT label FROM einheit_typ ORDER BY sortier",
        ).fetch_all(&pool).await.unwrap();
        assert_eq!(labels.len(), 5, "fünf Default-Einheitstypen erwartet");
        assert_eq!(labels.first().map(String::as_str), Some("Trupp"));
        assert!(labels.contains(&"Zug".to_string()));

        // Zug hat die Soll-Stärke 1/3/18; Sonstige hat keine.
        let (zf, zu, zm): (Option<i64>, Option<i64>, Option<i64>) = sqlx::query_as(
            "SELECT soll_fuehrer, soll_unterfuehrer, soll_mannschaft FROM einheit_typ WHERE label = 'Zug'",
        ).fetch_one(&pool).await.unwrap();
        assert_eq!((zf, zu, zm), (Some(1), Some(3), Some(18)));
        let sonstige: (Option<i64>,) = sqlx::query_as(
            "SELECT soll_fuehrer FROM einheit_typ WHERE label = 'Sonstige'",
        ).fetch_one(&pool).await.unwrap();
        assert_eq!(sonstige.0, None);
    }

    #[tokio::test]
    async fn ist_idempotent_bei_vorhandenen_benutzern() {
        let pool = crate::db::test_pool().await;
        bootstrap_admin(&pool, "Orga", "admin", Some("pw")).await.unwrap();

        let erg2 = bootstrap_admin(&pool, "Orga", "admin2", Some("pw2"))
            .await
            .unwrap();
        assert!(!erg2.admin_angelegt, "zweiter Bootstrap darf nichts anlegen");

        let anzahl: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM benutzer")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(anzahl, 1);
    }
}
