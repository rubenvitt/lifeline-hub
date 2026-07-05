pub fn erwartete_box(region_code: &str) -> Option<(f64,f64,f64,f64)> {
    Some(match region_code {
        "DE" => (5.8,47.2,15.1,55.1),
        "AT" => (9.5,46.3,17.2,49.1),
        "CH" => (5.9,45.8,10.5,47.9),
        c if c.starts_with("DE-") => (5.8,47.2,15.1,55.1),
        _ => return None,
    })
}
/// Gebautes bounds muss (mit kleiner Toleranz) INNERHALB der Erwartungs-Box liegen.
pub fn bounds_passen(gebaut: Option<(f64,f64,f64,f64)>, erwartet: (f64,f64,f64,f64)) -> bool {
    let Some((w,s,o,n)) = gebaut else { return false };
    let (ew,es,eo,en) = erwartet; let t = 0.5;
    w >= ew-t && s >= es-t && o <= eo+t && n <= en+t && w < o && s < n
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn bremen_bounds_liegen_in_de_box() {
        assert!(bounds_passen(Some((8.48,53.01,8.99,53.23)), erwartete_box("DE").unwrap()));
    }
    #[test]
    fn de_weit_faellt_aus_bayern_box() {
        let by = (8.9,47.2,13.9,50.6);
        assert!(!bounds_passen(Some((5.8,47.2,15.1,55.1)), by));
    }
    #[test]
    fn fehlende_bounds_ungueltig() { assert!(!bounds_passen(None, erwartete_box("DE").unwrap())); }
}
