pub mod repo;

use crate::etb::EtbTyp;
use serde::Serialize;
use utoipa::ToSchema;

/// Default-Bausteine, die beim Anlegen einer neuen Organisation geseedet werden.
/// (label, typ, inhalt, sortier) — muss inhaltlich zum CROSS-JOIN-Seed in
/// migrations/0037_etb_baustein.sql passen.
pub const ETB_BAUSTEIN_STARTLISTE: [(&str, &str, &str, i64); 5] = [
    ("Lage unverändert", "lage", "Lage unverändert.", 10),
    ("Erkundung eingeleitet", "meldung", "Erkundung durch {einheit} eingeleitet.", 20),
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

/// Ein Baustein-Typ ist erfassbar (kein `system`) und keine `berichtigung`.
pub fn ist_baustein_typ(typ: EtbTyp) -> bool {
    typ.darf_client_erfassen() && !typ.ist_berichtigung()
}

/// Öffentliche Sicht eines ETB-Baustein-Katalogeintrags. Die DB-Spalten `aktiv`,
/// `erstellt_at` und `aktualisiert_at` werden bewusst nicht serialisiert.
#[derive(Debug, Clone, Serialize, sqlx::FromRow, ToSchema)]
pub struct EtbBaustein {
    pub id: i64,
    pub label: String,
    #[schema(value_type = EtbTyp)]
    pub typ: String,
    pub inhalt: String,
    #[schema(value_type = Option<crate::etb::MeldeWeg>)]
    pub meldeweg: Option<String>,
    pub veranlassung: Option<String>,
    pub sortier: i64,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn startliste_konsistent() {
        assert_eq!(ETB_BAUSTEIN_STARTLISTE.len(), 5);
        // Jeder Seed-Typ ist parsebar und ein gültiger Baustein-Typ (schützt vor
        // Drift zwischen Konstante, Migration und CHECK-Constraint).
        for (_, typ, _, _) in ETB_BAUSTEIN_STARTLISTE {
            let t = EtbTyp::parse(typ).expect("Seed-Typ muss parsebar sein");
            assert!(ist_baustein_typ(t), "Seed-Typ {typ} ist kein gültiger Baustein-Typ");
        }
    }
}
