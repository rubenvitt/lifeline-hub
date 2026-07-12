pub mod repo;

use crate::etb::EtbTyp;
use serde::Serialize;
use utoipa::ToSchema;

/// Default-Bausteine, die beim Anlegen einer neuen Organisation geseedet werden.
/// (label, typ, inhalt, sortier) — muss inhaltlich zum CROSS-JOIN-Seed in
/// migrations/0037_etb_baustein.sql passen.
pub const ETB_BAUSTEIN_STARTLISTE: [(&str, &str, &str, i64); 5] = [
    ("Lage unverändert", "lage", "Lage unverändert.", 10),
    (
        "Erkundung eingeleitet",
        "meldung",
        "Erkundung durch {einheit} eingeleitet.",
        20,
    ),
    (
        "Einheit eingetroffen",
        "meldung",
        "{einheit} um {uhrzeit} an Einsatzstelle eingetroffen.",
        30,
    ),
    (
        "Lagemeldung Leitstelle",
        "meldung",
        "Lagemeldung an Leitstelle zu Einsatz {einsatznr}: {lage}.",
        40,
    ),
    (
        "Einsatzabschnitt gebildet",
        "entscheidung",
        "Einsatzabschnitt {abschnitt} gebildet, Führung {einheit}.",
        50,
    ),
];

/// Erfassbarer Baustein-Typ — echtes Subset der 4 zulässigen etb_baustein-Typen
/// (kein `system`, keine `berichtigung`). Macht die DB-CHECK-Grenze compile-fest.
/// Bewusst OHNE Serialize/ToSchema: `EtbBaustein.typ` behält den `EtbTyp`-Anker
/// (No-Op der OpenAPI-Union), BausteinTyp validiert nur den Request.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BausteinTyp {
    Meldung,
    Anordnung,
    Lage,
    Entscheidung,
}
impl BausteinTyp {
    pub fn as_str(&self) -> &'static str {
        match self {
            BausteinTyp::Meldung => "meldung",
            BausteinTyp::Anordnung => "anordnung",
            BausteinTyp::Lage => "lage",
            BausteinTyp::Entscheidung => "entscheidung",
        }
    }
    pub fn parse(s: &str) -> Option<BausteinTyp> {
        match s {
            "meldung" => Some(BausteinTyp::Meldung),
            "anordnung" => Some(BausteinTyp::Anordnung),
            "lage" => Some(BausteinTyp::Lage),
            "entscheidung" => Some(BausteinTyp::Entscheidung),
            _ => None,
        }
    }
}

/// Öffentliche Sicht eines ETB-Baustein-Katalogeintrags. Die DB-Spalten `aktiv`,
/// `erstellt_at` und `aktualisiert_at` werden bewusst nicht serialisiert.
#[derive(Debug, Clone, Serialize, sqlx::FromRow, ToSchema)]
pub struct EtbBaustein {
    pub id: i64,
    pub label: String,
    pub typ: EtbTyp,
    pub inhalt: String,
    pub meldeweg: Option<crate::etb::MeldeWeg>,
    pub veranlassung: Option<String>,
    pub sortier: i64,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn startliste_konsistent() {
        assert_eq!(ETB_BAUSTEIN_STARTLISTE.len(), 5);
        // Jeder Seed-Typ ist ein gültiger Baustein-Typ (schützt vor Drift
        // zwischen Konstante, Migration und CHECK-Constraint).
        for (_, typ, _, _) in ETB_BAUSTEIN_STARTLISTE {
            assert!(
                BausteinTyp::parse(typ).is_some(),
                "Seed-Typ {typ} ist kein gültiger Baustein-Typ"
            );
        }
    }
}
