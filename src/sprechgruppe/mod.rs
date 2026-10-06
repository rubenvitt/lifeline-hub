pub mod repo;

use crate::katalog::Betriebsart;
use serde::Serialize;
use utoipa::ToSchema;

/// Interner Sprechgruppen-Datensatz (alle Spalten von `sprechgruppe`).
#[derive(Debug, Clone, sqlx::FromRow)]
pub struct Sprechgruppe {
    pub id: i64,
    pub org_id: i64,
    pub einsatz_id: Option<i64>,
    pub bezeichnung: String,
    #[sqlx(try_from = "String")]
    pub betriebsart: Betriebsart,
    pub hinweis: Option<String>,
    pub aktiv: bool,
    pub sortier: i64,
    pub angelegt_at: String,
}

impl Sprechgruppe {
    /// Serialisierbare Anzeige (mit aufgelöstem `einsatz_lokal`-Flag).
    pub fn anzeige(&self) -> SprechgruppeAnzeige {
        SprechgruppeAnzeige {
            id: self.id,
            einsatz_id: self.einsatz_id,
            einsatz_lokal: self.einsatz_id.is_some(),
            bezeichnung: self.bezeichnung.clone(),
            betriebsart: self.betriebsart,
            hinweis: self.hinweis.clone(),
            aktiv: self.aktiv,
            sortier: self.sortier,
        }
    }
}

/// Öffentliche Sprechgruppen-Darstellung (ohne `org_id`, mit `einsatz_lokal`-Flag).
#[derive(Debug, Clone, Serialize, PartialEq, Eq, ToSchema)]
pub struct SprechgruppeAnzeige {
    pub id: i64,
    pub einsatz_id: Option<i64>,
    /// `true` wenn die Sprechgruppe einsatzlokal ist (d.h. `einsatz_id` gesetzt).
    pub einsatz_lokal: bool,
    pub bezeichnung: String,
    pub betriebsart: Betriebsart,
    pub hinweis: Option<String>,
    pub aktiv: bool,
    pub sortier: i64,
}

/// Höchstzahl verschiedener Sprechgruppen je Ziel (Abschnitt, Einheit, Führungsstelle; LFH-937,
/// design.md D5). Darüber ist die Liste für sich unbrauchbar → 400.
pub const SPRECHGRUPPEN_JE_ZIEL_MAX: usize = 32;

/// Sprechgruppen-Liste von außen: sortiert, entdoppelt, höchstens
/// [`SPRECHGRUPPEN_JE_ZIEL_MAX`] (sonst 400). Jede Route ruft das als ersten Schritt, vor jedem
/// Schreiben (LFH-937, `src/AGENTS.md`, „Eingabegrenzen“).
pub fn normalisiere_ids(mut ids: Vec<i64>) -> Result<Vec<i64>, crate::error::AppError> {
    ids.sort_unstable();
    ids.dedup();
    if ids.len() > SPRECHGRUPPEN_JE_ZIEL_MAX {
        return Err(crate::error::AppError::Validation(format!(
            "Höchstens {SPRECHGRUPPEN_JE_ZIEL_MAX} Sprechgruppen je Zuordnung"
        )));
    }
    Ok(ids)
}

#[cfg(test)]
mod normalisiere_tests {
    use super::*;

    #[test]
    fn entdoppelt_und_begrenzt() {
        assert_eq!(normalisiere_ids(vec![8, 7, 7, 8, 7]).unwrap(), vec![7, 8]);
        let voll: Vec<i64> = (1..=SPRECHGRUPPEN_JE_ZIEL_MAX as i64).collect();
        assert_eq!(normalisiere_ids(voll.clone()).unwrap(), voll);
        // Dubletten zählen nicht mit.
        let mit_dubletten: Vec<i64> = voll.iter().chain(voll.iter()).copied().collect();
        assert!(normalisiere_ids(mit_dubletten).is_ok());
        let zu_viele: Vec<i64> = (1..=SPRECHGRUPPEN_JE_ZIEL_MAX as i64 + 1).collect();
        assert!(matches!(
            normalisiere_ids(zu_viele),
            Err(crate::error::AppError::Validation(_))
        ));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn sg(einsatz_id: Option<i64>) -> Sprechgruppe {
        Sprechgruppe {
            id: 1,
            org_id: 1,
            einsatz_id,
            bezeichnung: "412_F_DRK".into(),
            betriebsart: Betriebsart::Tmo,
            hinweis: None,
            aktiv: true,
            sortier: 0,
            angelegt_at: "2026-06-21 10:00:00".into(),
        }
    }
    #[test]
    fn anzeige_markiert_einsatz_lokal() {
        assert!(!sg(None).anzeige().einsatz_lokal, "Katalog ist nicht lokal");
        assert!(
            sg(Some(7)).anzeige().einsatz_lokal,
            "mit einsatz_id = lokal"
        );
        assert_eq!(sg(None).anzeige().bezeichnung, "412_F_DRK");
    }
}
