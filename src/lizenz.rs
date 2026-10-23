//! Lizenz der Anwendung (LLH-1446). Einzige Quelle ist `LICENSE` im Wurzelverzeichnis des Repos:
//! das Binary bettet die Datei ein, Startausgabe, `--help` und `lifeline-hub lizenz` lesen sie
//! von hier, Container-Abbild und Release legen dieselbe Datei bei. Ein Lizenzwechsel ändert nur
//! `LICENSE`.

/// Der vollständige Lizenztext, wie er in `LICENSE` steht.
pub const TEXT: &str = include_str!("../LICENSE");

/// Die Kurzbezeichnung: die erste nicht leere Zeile von `LICENSE`, ohne Markdown-Überschrift.
pub fn titel() -> &'static str {
    TEXT.lines()
        .map(|zeile| zeile.trim().trim_start_matches('#').trim())
        .find(|zeile| !zeile.is_empty())
        .unwrap_or("siehe LICENSE")
}

/// Eine Zeile für `--help` und jeden Serverstart.
pub fn hinweis_kurz() -> String {
    format!("Lizenz: {}. Volltext: `lifeline-hub lizenz`.", titel())
}

/// Der gerahmte Volltext für den ersten Start.
pub fn kasten() -> String {
    let linie = "=".repeat(78);
    format!(
        "\n{linie}\nLIZENZ VON LIFELINE HUB\n{linie}\n\n{}\n\n{linie}\nVolltext jederzeit: \
         `lifeline-hub lizenz`\n{linie}\n",
        TEXT.trim_end()
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn titel_ist_die_erste_zeile_der_lizenzdatei() {
        let erste = TEXT.lines().find(|z| !z.trim().is_empty()).unwrap();
        assert!(erste.contains(titel()));
        assert!(!titel().is_empty());
        assert!(!titel().starts_with('#'));
    }

    #[test]
    fn kasten_traegt_den_vollen_text() {
        assert!(kasten().contains(TEXT.trim_end()));
        assert!(hinweis_kurz().contains(titel()));
    }
}
