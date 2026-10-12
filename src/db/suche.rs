//! Freitextsuche der geblätterten Listen (`src/AGENTS.md`, Abschnitt „Antwortkompression und
//! Phasenlisten“): `LIKE … ESCAPE '\'` mit maskierten Platzhaltern, damit ein eingetipptes `%`
//! oder `_` wörtlich sucht. Schadenliste und Auftragsliste teilen das Muster.

/// Maskiert `%`, `_` und `\` für `LIKE … ESCAPE '\'` und umschließt mit `%…%` (Teiltreffer).
pub fn like_muster(begriff: &str) -> String {
    let mut m = String::with_capacity(begriff.len() + 2);
    m.push('%');
    for c in begriff.chars() {
        if matches!(c, '%' | '_' | '\\') {
            m.push('\\');
        }
        m.push(c);
    }
    m.push('%');
    m
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maskiert_platzhalter_und_umschliesst_mit_prozent() {
        assert_eq!(like_muster("Keller"), "%Keller%");
        assert_eq!(like_muster("50%"), "%50\\%%");
        assert_eq!(like_muster("a_b"), "%a\\_b%");
        assert_eq!(like_muster("c:\\x"), "%c:\\\\x%");
        assert_eq!(like_muster(""), "%%");
    }
}
