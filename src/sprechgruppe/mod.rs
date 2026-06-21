pub mod repo;

use serde::Serialize;

/// Interner Sprechgruppen-Datensatz (alle Spalten von `sprechgruppe`).
#[derive(Debug, Clone, sqlx::FromRow)]
pub struct Sprechgruppe {
    pub id: i64,
    pub org_id: i64,
    pub einsatz_id: Option<i64>,
    pub bezeichnung: String,
    pub betriebsart: String,
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
            betriebsart: self.betriebsart.clone(),
            hinweis: self.hinweis.clone(),
            aktiv: self.aktiv,
            sortier: self.sortier,
        }
    }
}

/// Öffentliche Sprechgruppen-Darstellung (ohne `org_id`, mit `einsatz_lokal`-Flag).
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct SprechgruppeAnzeige {
    pub id: i64,
    pub einsatz_id: Option<i64>,
    /// `true` wenn die Sprechgruppe einsatzlokal ist (d.h. `einsatz_id` gesetzt).
    pub einsatz_lokal: bool,
    pub bezeichnung: String,
    pub betriebsart: String,
    pub hinweis: Option<String>,
    pub aktiv: bool,
    pub sortier: i64,
}

#[cfg(test)]
mod tests {
    use super::*;
    fn sg(einsatz_id: Option<i64>) -> Sprechgruppe {
        Sprechgruppe {
            id: 1, org_id: 1, einsatz_id, bezeichnung: "412_F_DRK".into(),
            betriebsart: "TMO".into(), hinweis: None, aktiv: true, sortier: 0,
            angelegt_at: "2026-06-21 10:00:00".into(),
        }
    }
    #[test]
    fn anzeige_markiert_einsatz_lokal() {
        assert!(!sg(None).anzeige().einsatz_lokal, "Katalog ist nicht lokal");
        assert!(sg(Some(7)).anzeige().einsatz_lokal, "mit einsatz_id = lokal");
        assert_eq!(sg(None).anzeige().bezeichnung, "412_F_DRK");
    }
}
