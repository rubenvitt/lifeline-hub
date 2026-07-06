/// Grobe Erwartungs-Box (min_lon, min_lat, max_lon, max_lat) je Region. PFLICHT für jede baubare
/// Region — eine fehlende Box bricht den Build hart ab (build/mod.rs). Der Check ist ein grobes
/// Sicherheitsnetz gegen Falschregion (z. B. LFH-200: der Bau lieferte die falsche/erste Region),
/// keine landesscharfe Prüfung. Bundesländer nutzen bewusst die DE-weite Box (kein DE-*-Bundesland
/// liegt außerhalb DEs). NL/FR/DK haben im Geofabrik-Extrakt Übersee-/Karibik-/Färöer-Gebiete →
/// bewusst WEITE Boxen, sonst würde `bounds_passen` den korrekten Bau fälschlich abweisen.
pub fn erwartete_box(region_code: &str) -> Option<(f64,f64,f64,f64)> {
    Some(match region_code {
        "DE" => (5.8,47.2,15.1,55.1),
        "AT" => (9.5,46.3,17.2,49.1),
        "CH" => (5.9,45.8,10.5,47.9),
        // Geofabrik-Länderextrakte sind METROPOLITAN-only — Übersee (Färöer, DOM-TOM, Karibik) sind
        // eigene Geofabrik-Regionen und NICHT enthalten. Boxen daher an den realen Extrakt-Bounds
        // (aus den Geofabrik-.poly-Dateien, +Toleranz) — kompakt, echter Falschregion-Schutz.
        "BE" => (2.4,49.4,6.5,51.6),
        "CZ" => (12.0,48.5,18.9,51.1),
        "LU" => (5.6,49.3,6.7,50.3),
        "PL" => (14.0,48.9,24.2,55.0),
        "DK" => (7.5,54.3,15.8,58.2),   // metropolitanes DK (Bornholm inkl.); Färöer = eigene Region
        "NL" => (2.8,50.6,7.4,54.2),    // europäisches NL; Karibische NL = eigene Region
        "FR" => (-5.3,41.2,9.7,51.2),   // France Métropolitaine (inkl. Korsika); DOM-TOM = eigene Regionen
        // Ganze Welt: degeneriert-global (Web-Mercator-Grenze ±85°) — die Falschregion-Prüfung ist
        // für den Planeten kein sinnvolles Konzept, jedes plausible Planet-Extent passt.
        "WORLD" => (-180.0,-86.0,180.0,86.0),
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

    #[test]
    fn jede_baubare_region_hat_eine_box() {
        // Invariante: ohne Box bricht build_region() hart ab (build/mod.rs) — jede in regions.rs
        // gelistete Region MUSS hier eine Erwartungs-Box haben.
        for r in crate::regions::alle() {
            assert!(erwartete_box(r.region).is_some(), "keine erwartete_box für {} ({})", r.region, r.slug);
        }
    }

    #[test]
    fn laender_bounds_passen_in_ihre_metropolitane_box() {
        // Reale metropolitane Geofabrik-Extrakt-Bounds (aus den .poly-Dateien) liegen in der Box.
        let faelle: &[(&str, (f64,f64,f64,f64))] = &[
            ("BE", (2.51,49.49,6.41,51.51)),
            ("CZ", (12.09,48.55,18.86,51.06)),
            ("LU", (5.73,49.44,6.53,50.19)),
            ("PL", (14.07,49.00,24.15,54.86)),
            ("DK", (7.70,54.44,15.65,58.06)),   // metropolitanes DK (Bornholm), OHNE Färöer
            ("NL", (2.94,50.75,7.22,54.02)),    // europäisches NL, OHNE Karibik
            ("FR", (-5.15,41.33,9.56,51.09)),   // France Métropolitaine inkl. Korsika
        ];
        for (code, b) in faelle {
            assert!(bounds_passen(Some(*b), erwartete_box(code).unwrap()), "{code} bounds passen nicht");
        }
    }

    #[test]
    fn kompakte_boxen_weisen_uebersee_ab_welt_ist_global() {
        // Die metropolitanen Boxen sind eng genug, ein Übersee-Extent (das eine EIGENE Geofabrik-
        // Region wäre) abzuweisen — echter Falschregion-Schutz statt ozean-spannender Illusion.
        assert!(!bounds_passen(Some((-68.4,12.0,-68.2,12.3)), erwartete_box("NL").unwrap()), "Bonaire ≠ NL");
        assert!(!bounds_passen(Some((55.2,-21.4,55.9,-20.9)), erwartete_box("FR").unwrap()), "Réunion ≠ metrop. FR");
        // Welt bleibt bewusst global — jedes plausible Planet-Extent passt.
        assert_eq!(erwartete_box("WORLD").unwrap(), (-180.0,-86.0,180.0,86.0));
        assert!(bounds_passen(Some((-179.0,-84.0,179.0,84.0)), erwartete_box("WORLD").unwrap()));
    }
}
