//! Vertrag des Offline-Adressindex (LLH-1119): Dateiformat und Normalisierung, geteilt von Bau
//! (`karten-service/src/adressindex.rs`) und Suche (`src/geocoding/offline.rs` im Hub). Eine
//! Änderung am Schema hebt [`ADRESSINDEX_FORMAT`]; der Hub liest nur Dateien seines Formats.
//!
//! Eine Datei je Region (`<slug>.<datum>.adressen.sqlite`), SQLite mit FTS5 und R*-Baum (beides im
//! gebündelten SQLite von `libsqlite3-sys` eingeschaltet).

use serde::{Deserialize, Serialize};

/// Formatversion, steht als `meta.format` in jeder Datei.
pub const ADRESSINDEX_FORMAT: &str = "1";

/// Dateiendung eines Adressindex; der Hub sucht in jeder Datei mit dieser Endung im Kartenverzeichnis.
pub const ADRESSINDEX_ENDUNG: &str = ".adressen.sqlite";

/// Schema einer Indexdatei.
///
/// - `adressen.art`: `adresse` (Hausnummer), `strasse` (aus den Adressen abgeleitet), `ort`
///   (`place=*`).
/// - `adressen_fts`: contentless, `rowid` = `adressen.id`, eine Spalte mit dem Suchtext aus
///   [`suchtext`].
/// - `adressen_rtree`: nur Zeilen mit `art = 'adresse'`, für die Rückwärtssuche.
pub const ADRESSINDEX_SCHEMA: &str = "\
CREATE TABLE meta (name TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE adressen (
    id INTEGER PRIMARY KEY,
    art TEXT NOT NULL CHECK (art IN ('adresse', 'strasse', 'ort')),
    strasse TEXT,
    hausnummer TEXT,
    plz TEXT,
    ort TEXT,
    ortsteil TEXT,
    lat REAL NOT NULL,
    lon REAL NOT NULL
);
CREATE VIRTUAL TABLE adressen_fts USING fts5(
    suchtext, content = '', tokenize = 'unicode61 remove_diacritics 2'
);
CREATE VIRTUAL TABLE adressen_rtree USING rtree(id, min_lat, max_lat, min_lon, max_lon);
";

/// Der Adressindex einer Region im Manifest (`OfflineKatalogEintrag::adressindex`).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
pub struct AdressindexEintrag {
    pub url: String,
    /// Dateigröße in Bytes.
    pub groesse: i64,
    /// SHA256 (hex, lowercase); der Hub prüft den Download dagegen.
    pub sha256: String,
}

/// Normalisiert Text für Index und Suchanfrage gleich: klein, `ß` → `ss`. Diakritika entfernt der
/// Tokenizer (`remove_diacritics 2`), Satzzeichen trennen dort Tokens.
pub fn normieren(text: &str) -> String {
    text.to_lowercase().replace('ß', "ss")
}

/// Suchtext einer Zeile: alle vorhandenen Teile, normalisiert, durch Leerzeichen getrennt.
pub fn suchtext(teile: &[Option<&str>]) -> String {
    teile
        .iter()
        .flatten()
        .map(|t| t.trim())
        .filter(|t| !t.is_empty())
        .map(normieren)
        .collect::<Vec<_>>()
        .join(" ")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normieren_macht_klein_und_loest_eszett_auf() {
        assert_eq!(normieren("Hauptstraße"), "hauptstrasse");
        assert_eq!(normieren("HAUPTSTRASSE"), "hauptstrasse");
        // Umlaute bleiben: die entfernt der Tokenizer, für Index und Anfrage gleich.
        assert_eq!(normieren("Müller-Gasse"), "müller-gasse");
    }

    #[test]
    fn suchtext_ueberspringt_fehlende_und_leere_teile() {
        assert_eq!(
            suchtext(&[
                Some("Hauptstraße"),
                Some("12"),
                None,
                Some("  "),
                Some("Musterstadt")
            ]),
            "hauptstrasse 12 musterstadt"
        );
    }

    #[test]
    fn schema_nennt_alle_tabellen() {
        for t in ["meta", "adressen", "adressen_fts", "adressen_rtree"] {
            assert!(ADRESSINDEX_SCHEMA.contains(&format!("TABLE {t} ")), "{t}");
        }
    }
}
