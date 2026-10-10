//! Lesen der Zugangsspuren (LFH-1097): Anmeldespur (`auth_audit`) und Admin-Spur
//! (`admin_audit`) für die Verwaltung.
//!
//! Beide Spuren teilen Zeitraum, Cursor und Seitengröße; was sie trennt (Ereignis bzw. Aktion,
//! wen der Kontofilter trifft), steht in ihrem Modul. Gelesen wird nur über
//! `routes::zugangsprotokoll` (System-Admin), und das Lesen selbst schreibt keine Spur.

use sqlx::{QueryBuilder, Sqlite};

/// Seitengröße ohne `limit`.
pub const STANDARD_LIMIT: i64 = 100;
/// Obergrenze für `limit`; größere Werte werden geklemmt.
pub const MAX_LIMIT: i64 = 500;

/// Gemeinsamer Filter beider Spuren. Die Werte sind schon geprüft: Zeiten im SQLite-Format
/// (`etb::normalisiere_zeit`), `konto` normalisiert und so gekürzt wie beim Schreiben
/// (`benutzername::fuer_protokoll`), `limit` geklemmt.
#[derive(Debug, Clone, Default)]
pub struct SpurFilter {
    /// Untere Grenze von `zeitpunkt`, einschließlich.
    pub von: Option<String>,
    /// Obere Grenze von `zeitpunkt`, einschließlich.
    pub bis: Option<String>,
    /// Teil eines Benutzernamens, ohne Rücksicht auf Groß- und Kleinschreibung (LFH-1152,
    /// [`SpurFilter::konto_enthalten`]).
    pub konto: Option<String>,
    /// Cursor: nur Einträge mit kleinerer `id`.
    pub vor_id: Option<i64>,
    pub limit: i64,
}

impl SpurFilter {
    /// Hängt Zeitraum und Cursor an eine Abfrage, deren `WHERE` schon steht.
    pub(crate) fn zeitraum_und_cursor(&self, qb: &mut QueryBuilder<Sqlite>) {
        if let Some(von) = &self.von {
            qb.push(" AND zeitpunkt >= ");
            qb.push_bind(von.clone());
        }
        if let Some(bis) = &self.bis {
            qb.push(" AND zeitpunkt <= ");
            qb.push_bind(bis.clone());
        }
        if let Some(vor_id) = self.vor_id {
            qb.push(" AND id < ");
            qb.push_bind(vor_id);
        }
    }

    /// Hängt „`spalte` enthält `konto`“ an (LFH-1152): ein getippter Namensteil trifft schon,
    /// nicht erst der ganze Name. `lower()` faltet wie `COLLATE NOCASE` nur ASCII; `instr`
    /// statt `LIKE`, damit `%` und `_` im Namen wörtlich zählen. `spalte` ist ein fester
    /// Spaltenname des Aufrufers, nie eine Eingabe.
    pub(crate) fn konto_enthalten(
        qb: &mut QueryBuilder<Sqlite>,
        spalte: &'static str,
        konto: &str,
    ) {
        qb.push(format!("instr(lower({spalte}), lower("));
        qb.push_bind(konto.to_string());
        qb.push(")) > 0");
    }

    /// Neueste zuerst, eine Seite.
    pub(crate) fn ordnung_und_seite(&self, qb: &mut QueryBuilder<Sqlite>) {
        qb.push(" ORDER BY id DESC LIMIT ");
        qb.push_bind(self.limit);
    }
}
