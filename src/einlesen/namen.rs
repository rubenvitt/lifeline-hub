//! Texte zum Vergleichen: Namen, Telefonnummern, Herkunft (LLH-1556, LLH-1633).

/// Text zum Vergleichen: getrimmt, Leerraum zusammengezogen, klein.
pub fn norm(s: &str) -> String {
    s.split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_lowercase()
}

/// Telefonnummer zum Vergleichen: nur Ziffern, `+49`/`0049` wie die führende `0`.
pub fn telefon_norm(s: &str) -> String {
    let t = s.trim();
    let plus = t.starts_with('+');
    let ziffern: String = t.chars().filter(char::is_ascii_digit).collect();
    if plus {
        if let Some(rest) = ziffern.strip_prefix("49") {
            return format!("0{rest}");
        }
        return format!("+{ziffern}");
    }
    if let Some(rest) = ziffern.strip_prefix("0049") {
        return format!("0{rest}");
    }
    ziffern
}

/// Die Schreibweisen eines Namens aus Nach- und Vorname, normalisiert.
pub fn namensformen(nachname: &str, vorname: Option<&str>) -> Vec<String> {
    let n = norm(nachname);
    match vorname.map(norm).filter(|v| !v.is_empty()) {
        None => vec![n],
        Some(v) => vec![
            format!("{v} {n}"),
            format!("{n}, {v}"),
            format!("{n},{v}"),
            format!("{n} {v}"),
        ],
    }
}

/// Ob ein gespeicherter Name zu Nach- und Vorname passt.
pub fn name_passt(gespeichert: &str, formen: &[String]) -> bool {
    let g = norm(gespeichert);
    formen.contains(&g)
}

/// Herkunft zum Vergleichen: fehlend wie leer.
pub fn herkunft_norm(h: Option<&str>) -> String {
    h.map(norm).unwrap_or_default()
}
