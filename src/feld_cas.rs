//! Feld-CAS: ein UPDATE schreibt nur, solange jede genannte Spalte noch den Wert trägt, den die
//! Oberfläche beim Öffnen gesehen hat (LLH-1103 für die Personendaten, LLH-1831 für Einheit,
//! Einsatzkopf und Führungsstelle; design.md D1 der Change
//! `nvhnqynd-konflikt-und-aenderungsvermerk`).
//!
//! Der Baustein hängt je erwarteter Spalte `AND <spalte> IS ?<n>` an ein statisches UPDATE und
//! bindet die Altwerte in derselben Reihenfolge. `IS` vergleicht auch NULL; ein leerer
//! Text-Altwert trifft zusätzlich eine gespeicherte leere oder nur aus Leerraum bestehende
//! Zeichenkette (die Oberfläche zeigt beides als „ohne Angabe“ und schickt `null`). Spaltennamen
//! kommen nur aus festen Listen im Code, nie aus der Anfrage: das Suffix bleibt SQL-sicher, nur
//! seine Länge ist dynamisch.
//!
//! Die Regeln am Handler („Altwert nur mit Änderung desselben Felds“, Paare) prüft
//! [`pruefe_felder`].

use sqlx::query::Query;
use sqlx::sqlite::SqliteArguments;
use sqlx::Sqlite;

use crate::error::AppError;

/// Meldung eines 409, wenn eine erwartete Spalte inzwischen einen anderen Wert trägt.
pub const KONFLIKT_MELDUNG: &str = "Das Feld wurde zwischenzeitlich geändert. Bitte neu laden.";

/// Ein erwarteter Spaltenwert, getypt für den Bind (`None` = leer erwartet).
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum ExpectedValue<'a> {
    Text(Option<&'a str>),
    Integer(Option<i64>),
    Real(Option<f64>),
    Bool(Option<bool>),
}

/// Die erwarteten Spalten einer Anfrage in fester Reihenfolge.
#[derive(Debug, Clone, Default)]
pub struct ExpectedValues<'a> {
    werte: Vec<(&'static str, ExpectedValue<'a>)>,
}

impl<'a> ExpectedValues<'a> {
    pub fn new() -> Self {
        Self::default()
    }

    /// Nimmt die Spalte auf, wenn ein Altwert genannt ist (`None` = kein Vergleich).
    pub fn push(&mut self, spalte: &'static str, wert: Option<ExpectedValue<'a>>) {
        if let Some(w) = wert {
            self.werte.push((spalte, w));
        }
    }

    pub fn is_empty(&self) -> bool {
        self.werte.is_empty()
    }

    pub fn len(&self) -> usize {
        self.werte.len()
    }

    /// Das Suffix mit nummerierten Parametern ab `erste_nummer`, je Spalte einer.
    pub fn sql_suffix(&self, erste_nummer: usize) -> String {
        let mut sql = String::new();
        for (i, (spalte, wert)) in self.werte.iter().enumerate() {
            let nummer = erste_nummer + i;
            if matches!(wert, ExpectedValue::Text(_)) {
                sql.push_str(&format!(
                    " AND ({spalte} IS ?{nummer} OR (?{nummer} IS NULL AND \
                     TRIM({spalte}, ' ' || char(9) || char(10) || char(13)) = ''))"
                ));
            } else {
                sql.push_str(&format!(" AND {spalte} IS ?{nummer}"));
            }
        }
        sql
    }

    /// Bindet die Altwerte in der Reihenfolge von [`Self::sql_suffix`].
    pub fn bind_all<'q>(
        &self,
        mut q: Query<'q, Sqlite, SqliteArguments>,
    ) -> Query<'q, Sqlite, SqliteArguments> {
        for (_, wert) in self.werte.iter().copied() {
            q = match wert {
                ExpectedValue::Text(v) => q.bind(v.map(str::to_owned)),
                ExpectedValue::Integer(v) => q.bind(v),
                ExpectedValue::Real(v) => q.bind(v),
                ExpectedValue::Bool(v) => q.bind(v),
            };
        }
        q
    }
}

/// Ein Feld des Patches für [`pruefe_felder`]: Name, steht es in `erwartet`, steht es im Patch.
pub type FeldLage = (&'static str, bool, bool);

/// Ein Paar, das nur ganz oder gar nicht erwartet sein darf: zwei Feldnamen und die Meldung.
pub type Paar<'m> = (&'static str, &'static str, &'m str);

/// Prüft `erwartet` gegen die Änderung: jedes Paar (etwa Breite und Länge einer Koordinate) ganz
/// oder gar nicht, und jedes Feld mit Altwert muss im Patch stehen. Beides ist eine
/// Feldkombination, also 422 (`src/AGENTS.md`, Statuscode-Konvention).
pub fn pruefe_felder(felder: &[FeldLage], paare: &[Paar<'_>]) -> Result<(), AppError> {
    for (a, b, meldung) in paare {
        let lage = |name: &str| felder.iter().any(|(f, alt, _)| *f == name && *alt);
        if lage(a) != lage(b) {
            return Err(AppError::UnprocessableEntity((*meldung).into()));
        }
    }
    for (feld, im_erwartet, im_patch) in felder {
        if *im_erwartet && !*im_patch {
            return Err(AppError::UnprocessableEntity(format!(
                "erwartet nennt {feld}, der PATCH ändert {feld} aber nicht"
            )));
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ohne_altwert_kein_suffix() {
        let mut w = ExpectedValues::new();
        w.push("name", None);
        assert!(w.is_empty());
        assert_eq!(w.sql_suffix(5), "");
    }

    #[test]
    fn suffix_nummeriert_je_spalte_und_faengt_leerraum_bei_text() {
        let mut w = ExpectedValues::new();
        w.push("bemerkung", Some(ExpectedValue::Text(None)));
        w.push("soll_fuehrer", Some(ExpectedValue::Integer(Some(1))));
        let sql = w.sql_suffix(30);
        assert!(sql.contains("bemerkung IS ?30 OR (?30 IS NULL AND TRIM(bemerkung"));
        assert!(sql.ends_with(" AND soll_fuehrer IS ?31"));
    }

    #[test]
    fn altwert_ohne_aenderung_ist_422() {
        let e = pruefe_felder(&[("name", true, false)], &[]).unwrap_err();
        assert!(matches!(e, AppError::UnprocessableEntity(m) if m.contains("name")));
    }

    #[test]
    fn halbes_paar_ist_422() {
        let paar = [("lat", "lon", "nur als Paar")];
        let felder = [("lat", true, true), ("lon", false, true)];
        assert!(matches!(
            pruefe_felder(&felder, &paar),
            Err(AppError::UnprocessableEntity(m)) if m == "nur als Paar"
        ));
        let ganz = [("lat", true, true), ("lon", true, true)];
        assert!(pruefe_felder(&ganz, &paar).is_ok());
    }

    #[tokio::test]
    async fn treffer_und_konflikt_am_echten_update() {
        let pool = sqlx::SqlitePool::connect("sqlite::memory:").await.unwrap();
        sqlx::query("CREATE TABLE t (id INTEGER PRIMARY KEY, a TEXT, b INTEGER)")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("INSERT INTO t VALUES (1, '  ', 7)")
            .execute(&pool)
            .await
            .unwrap();
        let schreibe = |a_alt: Option<&'static str>, b_alt: Option<i64>| {
            let pool = pool.clone();
            async move {
                let mut w = ExpectedValues::new();
                w.push("a", Some(ExpectedValue::Text(a_alt)));
                w.push("b", Some(ExpectedValue::Integer(b_alt)));
                let sql = format!("UPDATE t SET a = 'neu' WHERE id = ?1{}", w.sql_suffix(2));
                let q = w.bind_all(sqlx::query(sqlx::AssertSqlSafe(sql)).bind(1_i64));
                q.execute(&pool).await.unwrap().rows_affected()
            }
        };
        // Leerraum gilt als „leer erwartet“; b stimmt nicht → kein Treffer.
        assert_eq!(schreibe(None, Some(8)).await, 0);
        // Beide stimmen → Treffer.
        assert_eq!(schreibe(None, Some(7)).await, 1);
        // Jetzt steht „neu“: der leere Altwert trifft nicht mehr.
        assert_eq!(schreibe(None, Some(7)).await, 0);
    }
}
