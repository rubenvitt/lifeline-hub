//! Qualifikationssoll an Einheitentyp, Einheiten-Vorlage, Einheit und UHS (LLH-1553, Change
//! `z14dre9r-qualifikationsstufen-soll`, design.md D3; Spec `qualifikationen`,
//! „Qualifikationssoll“).
//!
//! Gespeichert als JSON-Spalte `quali_soll` in der Form `[{"q": <id>, "n": <anzahl>}]`
//! (`migrations/0274_qualifikation_einschluss_soll.sql`). Eine Quelle für alle vier Träger:
//! - [`form`]/[`form_tri`]: Feldprüfung (400) und Umwandlung in die gespeicherte Form; eine leere
//!   Liste wird zu `NULL` („kein Soll“).
//! - [`pruefe_org`]: jede Qualifikation gehört zur eigenen Organisation (422), in einer Abfrage
//!   über `json_each`.
//! - [`quali_soll_sql!`]: der Lese-Ausdruck mit Labels, damit die Anzeige keinen zweiten Abruf
//!   braucht; dekodiert in [`QualiSoll`].

use crate::error::AppError;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use utoipa::ToSchema;

/// Höchstzahl Einträge eines Qualifikationssolls (`src/AGENTS.md`, „Eingabegrenzen“). Spiegel:
/// `QUALI_SOLL_MAX` in `frontend/src/api/eingabegrenzen.ts`.
pub const QUALI_SOLL_MAX: usize = 10;

/// Höchste Anzahl je Qualifikation. Spiegel: `QUALI_SOLL_ANZAHL_MAX`.
pub const QUALI_SOLL_ANZAHL_MAX: i64 = 50;

/// Ein Eintrag im Request.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, ToSchema)]
pub struct QualiSollEingabe {
    pub qualifikation_id: i64,
    pub anzahl: i64,
}

/// Ein Eintrag in der Antwort, mit dem Label der Qualifikation.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct QualiSollEintrag {
    pub qualifikation_id: i64,
    pub label: String,
    pub anzahl: i64,
}

/// Das gelesene Qualifikationssoll (nie leer; „kein Soll“ ist `None`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(transparent)]
pub struct QualiSoll(pub Vec<QualiSollEintrag>);

impl QualiSoll {
    /// Zurück in die gespeicherte Form, etwa wenn eine Einheit das Soll ihrer Vorlage übernimmt.
    pub fn gespeichert(&self) -> String {
        speicherform(self.0.iter().map(|e| (e.qualifikation_id, e.anzahl)))
    }

    /// Als Anforderungen für die Deckungsregel.
    pub fn anforderungen(&self) -> Vec<super::qualifikation_deckung::Anforderung> {
        self.0
            .iter()
            .map(|e| super::qualifikation_deckung::Anforderung {
                qualifikation_id: e.qualifikation_id,
                anzahl: e.anzahl,
            })
            .collect()
    }
}

impl sqlx::Type<sqlx::Sqlite> for QualiSoll {
    fn type_info() -> sqlx::sqlite::SqliteTypeInfo {
        <String as sqlx::Type<sqlx::Sqlite>>::type_info()
    }

    fn compatible(ty: &sqlx::sqlite::SqliteTypeInfo) -> bool {
        <String as sqlx::Type<sqlx::Sqlite>>::compatible(ty)
    }
}

impl<'r> sqlx::Decode<'r, sqlx::Sqlite> for QualiSoll {
    fn decode(wert: sqlx::sqlite::SqliteValueRef<'r>) -> Result<Self, sqlx::error::BoxDynError> {
        let text = <&str as sqlx::Decode<sqlx::Sqlite>>::decode(wert)?;
        Ok(serde_json::from_str(text)?)
    }
}

/// Lese-Ausdruck für eine `quali_soll`-Spalte: die Liste mit Labels in gespeicherter
/// Reihenfolge, `NULL` ohne Soll. Ein Eintrag, dessen Qualifikation es nicht mehr gibt, fällt weg
/// (Qualifikationen werden nie hart gelöscht, 0011). Das Argument ist ein String-Literal mit
/// Tabellen-Alias, etwa `quali_soll_sql!("t.quali_soll")`.
macro_rules! quali_soll_sql {
    ($spalte:literal) => {
        concat!(
            "(CASE WHEN ",
            $spalte,
            " IS NULL THEN NULL ELSE (SELECT json_group_array(json_object(\
             'qualifikation_id', qs_q.id, 'label', qs_q.label, 'anzahl', qs_j.value ->> 'n') \
             ORDER BY qs_j.key) FROM json_each(",
            $spalte,
            ") qs_j JOIN qualifikation qs_q ON qs_q.id = qs_j.value ->> 'q') END)"
        )
    };
}
pub(crate) use quali_soll_sql;

/// Feldprüfung (400) einer Liste von außen und die gespeicherte Form. Leer → `None`.
pub fn form(eintraege: &[QualiSollEingabe]) -> Result<Option<String>, AppError> {
    if eintraege.len() > QUALI_SOLL_MAX {
        return Err(AppError::Validation(format!(
            "Höchstens {QUALI_SOLL_MAX} Qualifikationen im Soll"
        )));
    }
    if eintraege
        .iter()
        .any(|e| !(1..=QUALI_SOLL_ANZAHL_MAX).contains(&e.anzahl))
    {
        return Err(AppError::Validation(format!(
            "Anzahl je Qualifikation von 1 bis {QUALI_SOLL_ANZAHL_MAX}"
        )));
    }
    let mut gesehen = HashSet::new();
    if !eintraege.iter().all(|e| gesehen.insert(e.qualifikation_id)) {
        return Err(AppError::Validation(
            "Jede Qualifikation höchstens einmal im Soll".into(),
        ));
    }
    if eintraege.is_empty() {
        return Ok(None);
    }
    Ok(Some(speicherform(
        eintraege.iter().map(|e| (e.qualifikation_id, e.anzahl)),
    )))
}

/// Die gespeicherte Form `[{"q": …, "n": …}]` aus (Qualifikation, Anzahl).
fn speicherform(paare: impl Iterator<Item = (i64, i64)>) -> String {
    let roh: Vec<serde_json::Value> = paare
        .map(|(q, n)| serde_json::json!({ "q": q, "n": n }))
        .collect();
    serde_json::Value::Array(roh).to_string()
}

/// [`form`] für ein optionales Feld beim Anlegen: fehlt oder `null` = kein Soll.
pub fn form_opt(eintraege: Option<&[QualiSollEingabe]>) -> Result<Option<String>, AppError> {
    match eintraege {
        Some(e) => form(e),
        None => Ok(None),
    }
}

/// [`form`] im Tri-State eines PATCH: fehlt = unverändert, `null` oder `[]` = kein Soll.
pub fn form_tri(
    eintraege: Option<Option<Vec<QualiSollEingabe>>>,
) -> Result<Option<Option<String>>, AppError> {
    match eintraege {
        None => Ok(None),
        Some(None) => Ok(Some(None)),
        Some(Some(e)) => Ok(Some(form(&e)?)),
    }
}

/// Jede Qualifikation der gespeicherten Form gehört zur Organisation (422 sonst). Eine
/// deaktivierte zählt mit: sie bleibt in bestehenden Zuordnungen wirksam (0011).
pub async fn pruefe_org(
    executor: impl sqlx::Executor<'_, Database = sqlx::Sqlite>,
    org_id: i64,
    gespeichert: Option<&str>,
) -> Result<(), AppError> {
    let Some(json) = gespeichert else {
        return Ok(());
    };
    let fremd: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM json_each(?1) j \
         LEFT JOIN qualifikation q ON q.id = j.value ->> 'q' AND q.org_id = ?2 \
         WHERE q.id IS NULL",
    )
    .bind(json)
    .bind(org_id)
    .fetch_one(executor)
    .await?;
    if fremd > 0 {
        return Err(AppError::UnprocessableEntity(
            "Qualifikation im Soll gehört nicht zur Organisation".into(),
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn e(q: i64, n: i64) -> QualiSollEingabe {
        QualiSollEingabe {
            qualifikation_id: q,
            anzahl: n,
        }
    }

    #[test]
    fn form_speichert_kurz_und_leer_als_none() {
        assert_eq!(
            form(&[e(2, 1), e(1, 2)]).unwrap().as_deref(),
            Some(r#"[{"n":1,"q":2},{"n":2,"q":1}]"#)
        );
        assert_eq!(form(&[]).unwrap(), None);
        assert_eq!(form_tri(Some(Some(vec![]))).unwrap(), Some(None));
        assert_eq!(form_tri(Some(None)).unwrap(), Some(None));
        assert_eq!(form_tri(None).unwrap(), None);
    }

    #[test]
    fn form_grenzen_sind_400() {
        let zu_viele: Vec<_> = (1..=11).map(|q| e(q, 1)).collect();
        for falsch in [
            vec![e(1, 0)],
            vec![e(1, 51)],
            vec![e(1, 1), e(1, 2)],
            zu_viele,
        ] {
            assert!(matches!(form(&falsch), Err(AppError::Validation(_))));
        }
        let genau: Vec<_> = (1..=10).map(|q| e(q, 50)).collect();
        assert!(form(&genau).is_ok());
    }

    #[tokio::test]
    async fn pruefe_org_und_lese_ausdruck() {
        let pool = crate::db::test_pool().await;
        for id in [1, 2] {
            sqlx::query("INSERT OR IGNORE INTO organisation (id, name) VALUES (?, 'O')")
                .bind(id)
                .execute(&pool)
                .await
                .unwrap();
        }
        let eigen = super::super::qualifikation_repo::anlegen(&pool, 1, "RS", 20)
            .await
            .unwrap();
        let zweite = super::super::qualifikation_repo::anlegen(&pool, 1, "San", 10)
            .await
            .unwrap();
        let fremd = super::super::qualifikation_repo::anlegen(&pool, 2, "RS", 20)
            .await
            .unwrap();
        let gut = form(&[e(eigen.id, 1), e(zweite.id, 2)]).unwrap();
        pruefe_org(&pool, 1, gut.as_deref()).await.unwrap();
        pruefe_org(&pool, 1, None).await.unwrap();
        let schlecht = form(&[e(eigen.id, 1), e(fremd.id, 1)]).unwrap();
        assert!(matches!(
            pruefe_org(&pool, 1, schlecht.as_deref()).await,
            Err(AppError::UnprocessableEntity(_))
        ));

        let gelesen: Option<QualiSoll> = sqlx::query_scalar(sqlx::AssertSqlSafe(concat!(
            "SELECT ",
            quali_soll_sql!("t.s"),
            " FROM (SELECT ? AS s) t"
        )))
        .bind(gut)
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(
            gelesen,
            Some(QualiSoll(vec![
                QualiSollEintrag {
                    qualifikation_id: eigen.id,
                    label: "RS".into(),
                    anzahl: 1
                },
                QualiSollEintrag {
                    qualifikation_id: zweite.id,
                    label: "San".into(),
                    anzahl: 2
                },
            ])),
            "Reihenfolge wie gespeichert, mit Label"
        );
        let leer: Option<QualiSoll> = sqlx::query_scalar(sqlx::AssertSqlSafe(concat!(
            "SELECT ",
            quali_soll_sql!("t.s"),
            " FROM (SELECT NULL AS s) t"
        )))
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(leer, None);
    }
}
