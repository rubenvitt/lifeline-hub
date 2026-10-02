//! Org-Vorgabe der Aufbewahrungsfristen je Datenkategorie (LFH-749, Spec
//! `aufbewahrung-kategorien`, „Dauer und Rechtsgrundlage je Organisation“; design.md D4/D8).
//!
//! Eine Zeile in `org_aufbewahrung_kategorie` gibt es nur bei gesetzter Dauer. Fehlt sie, folgt
//! die Kategorie der Einsatz-Frist. Vorgabewerte gibt es bewusst nicht: Eine Frist, nach der
//! unwiderruflich geschwärzt wird, legt die Organisation selbst fest und begründet sie.

use crate::einsatz::retention::Datenkategorie;
use crate::error::AppError;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

/// Höchste Dauer in Tagen (wie die Einsatz-Dauer). Anders als dort ist 0 erlaubt: Wer eine
/// Höchstfrist von einem Monat einhalten muss, schwärzt nach Abschluss plus 30 Tagen Karenz
/// (design.md D6).
pub const DAUER_MAX_TAGE: i64 = 3650;
/// Höchstlänge der Rechtsgrundlage in Zeichen.
pub const RECHTSGRUNDLAGE_MAX: usize = 500;

/// Gespeicherte Vorgabe einer Kategorie.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, ToSchema)]
pub struct KategorieVorgabe {
    pub kategorie: Datenkategorie,
    pub dauer_tage: i64,
    pub rechtsgrundlage: String,
}

/// Eingabe einer Vorgabe im PUT der Org-Einstellungen. `kategorie` als Text, damit ein
/// unbekannter Wert 400 mit eigener Meldung liefert (Statuscode-Konvention, `src/AGENTS.md`).
#[derive(Debug, Clone, Deserialize)]
pub struct KategorieVorgabeEingabe {
    pub kategorie: String,
    pub dauer_tage: i64,
    #[serde(default)]
    pub rechtsgrundlage: Option<String>,
}

/// Prüft die Eingabe nach design.md D8: unbekannte oder doppelte Kategorie, Dauer außerhalb
/// `0..=DAUER_MAX_TAGE` und zu lange Rechtsgrundlage sind 400 (das Feld für sich), eine leere
/// Rechtsgrundlage bei gesetzter Dauer ist 422 (der Zusammenhang). Liefert die bereinigte,
/// nach Kategorie sortierte Liste.
pub fn pruefe(eingaben: Vec<KategorieVorgabeEingabe>) -> Result<Vec<KategorieVorgabe>, AppError> {
    let mut vorgaben: Vec<KategorieVorgabe> = Vec::with_capacity(eingaben.len());
    for e in eingaben {
        let Some(kategorie) = Datenkategorie::parse(&e.kategorie) else {
            return Err(AppError::Validation(format!(
                "Unbekannte Datenkategorie: {}",
                e.kategorie
            )));
        };
        if vorgaben.iter().any(|v| v.kategorie == kategorie) {
            return Err(AppError::Validation(format!(
                "Datenkategorie doppelt: {}",
                kategorie.as_str()
            )));
        }
        if !(0..=DAUER_MAX_TAGE).contains(&e.dauer_tage) {
            return Err(AppError::Validation(format!(
                "Aufbewahrungs-Dauer je Kategorie muss zwischen 0 und {DAUER_MAX_TAGE} Tagen liegen"
            )));
        }
        let rechtsgrundlage = e
            .rechtsgrundlage
            .map(|r| r.trim().to_string())
            .unwrap_or_default();
        if rechtsgrundlage.chars().count() > RECHTSGRUNDLAGE_MAX {
            return Err(AppError::Validation(format!(
                "Rechtsgrundlage darf höchstens {RECHTSGRUNDLAGE_MAX} Zeichen lang sein"
            )));
        }
        if rechtsgrundlage.is_empty() {
            return Err(AppError::UnprocessableEntity(format!(
                "Eine Dauer für „{}“ braucht eine Rechtsgrundlage",
                kategorie.as_str()
            )));
        }
        vorgaben.push(KategorieVorgabe {
            kategorie,
            dauer_tage: e.dauer_tage,
            rechtsgrundlage,
        });
    }
    vorgaben.sort_by_key(|v| v.kategorie);
    Ok(vorgaben)
}

/// Lädt die Vorgaben einer Organisation, nach Kategorie sortiert. Zeilen mit unbekannter
/// Kategorie (etwa nach einem Rückbau) werden übergangen.
pub async fn laden(
    executor: impl sqlx::Executor<'_, Database = sqlx::Sqlite>,
    org_id: i64,
) -> Result<Vec<KategorieVorgabe>, AppError> {
    let zeilen: Vec<(String, i64, String)> = sqlx::query_as(
        "SELECT kategorie, dauer_tage, rechtsgrundlage FROM org_aufbewahrung_kategorie \
         WHERE org_id = ?",
    )
    .bind(org_id)
    .fetch_all(executor)
    .await?;
    let mut vorgaben: Vec<KategorieVorgabe> = zeilen
        .into_iter()
        .filter_map(|(k, dauer_tage, rechtsgrundlage)| {
            Datenkategorie::parse(&k).map(|kategorie| KategorieVorgabe {
                kategorie,
                dauer_tage,
                rechtsgrundlage,
            })
        })
        .collect();
    vorgaben.sort_by_key(|v| v.kategorie);
    Ok(vorgaben)
}

/// Ersetzt die Vorgaben einer Organisation durch `vorgaben` (fehlende Kategorie → Zeile weg),
/// auf der Verbindung des Aufrufers, damit es mit den übrigen Org-Einstellungen atomar bleibt.
pub async fn ersetzen(
    conn: &mut sqlx::SqliteConnection,
    org_id: i64,
    erfasser_id: i64,
    vorgaben: &[KategorieVorgabe],
) -> Result<(), AppError> {
    sqlx::query("DELETE FROM org_aufbewahrung_kategorie WHERE org_id = ?")
        .bind(org_id)
        .execute(&mut *conn)
        .await?;
    for v in vorgaben {
        sqlx::query(
            "INSERT INTO org_aufbewahrung_kategorie \
                (org_id, kategorie, dauer_tage, rechtsgrundlage, geaendert_at, geaendert_von) \
             VALUES (?, ?, ?, ?, datetime('now'), ?)",
        )
        .bind(org_id)
        .bind(v.kategorie.as_str())
        .bind(v.dauer_tage)
        .bind(&v.rechtsgrundlage)
        .bind(erfasser_id)
        .execute(&mut *conn)
        .await?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;

    fn e(
        kategorie: &str,
        dauer_tage: i64,
        rechtsgrundlage: Option<&str>,
    ) -> KategorieVorgabeEingabe {
        KategorieVorgabeEingabe {
            kategorie: kategorie.into(),
            dauer_tage,
            rechtsgrundlage: rechtsgrundlage.map(String::from),
        }
    }

    #[test]
    fn pruefe_nimmt_gueltige_eingaben_sortiert_und_getrimmt() {
        let v = pruefe(vec![
            e("personenauskunft", 0, Some("  § 46 Abs. 5 BHKG NRW ")),
            e("behandlung", 3650, Some("§ 630f BGB entsprechend")),
        ])
        .unwrap();
        assert_eq!(v.len(), 2);
        assert_eq!(v[0].kategorie, Datenkategorie::Behandlung);
        assert_eq!(v[1].kategorie, Datenkategorie::Personenauskunft);
        assert_eq!(v[1].dauer_tage, 0);
        assert_eq!(v[1].rechtsgrundlage, "§ 46 Abs. 5 BHKG NRW");
    }

    #[test]
    fn pruefe_statuscodes() {
        let status = |r: Result<Vec<KategorieVorgabe>, AppError>| r.unwrap_err().status();
        use axum::http::StatusCode;
        assert_eq!(
            status(pruefe(vec![e("einsatzkraefte", 5, Some("x"))])),
            StatusCode::BAD_REQUEST
        );
        assert_eq!(
            status(pruefe(vec![e("anhaenge", -1, Some("x"))])),
            StatusCode::BAD_REQUEST
        );
        assert_eq!(
            status(pruefe(vec![e("anhaenge", 3651, Some("x"))])),
            StatusCode::BAD_REQUEST
        );
        assert_eq!(
            status(pruefe(vec![e("anhaenge", 30, Some(&"x".repeat(501)))])),
            StatusCode::BAD_REQUEST
        );
        assert_eq!(
            status(pruefe(vec![
                e("anhaenge", 30, Some("a")),
                e("anhaenge", 40, Some("b"))
            ])),
            StatusCode::BAD_REQUEST
        );
        assert_eq!(
            status(pruefe(vec![e("anhaenge", 30, None)])),
            StatusCode::UNPROCESSABLE_ENTITY
        );
        assert_eq!(
            status(pruefe(vec![e("anhaenge", 30, Some("   "))])),
            StatusCode::UNPROCESSABLE_ENTITY
        );
        // Grenzen sind gültig.
        assert!(pruefe(vec![e("anhaenge", 0, Some("x"))]).is_ok());
        assert!(pruefe(vec![e("anhaenge", 3650, Some(&"x".repeat(500)))]).is_ok());
    }

    #[tokio::test]
    async fn ersetzen_und_laden() {
        let pool = db::test_pool().await;
        sqlx::query("INSERT OR IGNORE INTO organisation (id, name) VALUES (1, 'Orga')")
            .execute(&pool)
            .await
            .unwrap();
        let admin: i64 = sqlx::query_scalar(
            "INSERT INTO benutzer (org_id, anzeigename, benutzername, passwort_hash) \
             VALUES (1, 'a', 'a', 'h') RETURNING id",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert!(
            laden(&pool, 1).await.unwrap().is_empty(),
            "keine Vorgabewerte"
        );

        let zwei = pruefe(vec![
            e("anhaenge", 30, Some("§ 32b Abs. 3 NKatSG")),
            e("personenauskunft", 0, Some("§ 46 Abs. 5 BHKG NRW")),
        ])
        .unwrap();
        let mut conn = pool.acquire().await.unwrap();
        ersetzen(&mut conn, 1, admin, &zwei).await.unwrap();
        assert_eq!(laden(&mut *conn, 1).await.unwrap(), zwei);

        // Ersetzen: eine fehlende Kategorie verschwindet.
        let eine = pruefe(vec![e("personenauskunft", 7, Some("neu"))]).unwrap();
        ersetzen(&mut conn, 1, admin, &eine).await.unwrap();
        assert_eq!(laden(&mut *conn, 1).await.unwrap(), eine);
    }
}
