//! Reine Peilungs-Mathematik: Haversine-Distanz + 8-Strich-Bearing zwischen zwei
//! WGS84-Punkten. Keine I/O, keine Abhängigkeit zum Netz.

/// Verorteter Einsatz-Marker (Bezugspunkt-Kandidat). `typ` ist ein stabiles Tag
/// (`einsatzort`, `uhs`, `schaden`, `einheit`, `fahrzeug`, `personal`, `lagemeldung`)
/// für `exclude` und Anzeige; `label` ist die menschenlesbare Bezeichnung.
#[derive(Debug, Clone, sqlx::FromRow)]
pub struct Marker {
    pub typ: String,
    pub id: i64,
    pub label: String,
    pub lat: f64,
    pub lon: f64,
}

/// Distanz + 8-Strich-Richtung + Bezeichnung des nächsten Markers.
#[derive(Debug, Clone)]
pub struct Peilung {
    pub distanz_m: f64,
    pub richtung: String,
    pub bezug_label: String,
}

const ERDRADIUS_M: f64 = 6_371_000.0;
const STRICHE: [&str; 8] = ["N", "NO", "O", "SO", "S", "SW", "W", "NW"];

/// Haversine-Großkreisdistanz in Metern. Punkte als `(lat, lon)` in Grad.
pub fn haversine_m(a: (f64, f64), b: (f64, f64)) -> f64 {
    let (phi1, phi2) = (a.0.to_radians(), b.0.to_radians());
    let dphi = (b.0 - a.0).to_radians();
    let dlambda = (b.1 - a.1).to_radians();
    let h = (dphi / 2.0).sin().powi(2) + phi1.cos() * phi2.cos() * (dlambda / 2.0).sin().powi(2);
    2.0 * ERDRADIUS_M * h.sqrt().asin()
}

/// Initial-Bearing `from → to`, gerundet auf die nächste der 8 Strich-Richtungen.
pub fn bearing_8(from: (f64, f64), to: (f64, f64)) -> &'static str {
    let (phi1, phi2) = (from.0.to_radians(), to.0.to_radians());
    let dlambda = (to.1 - from.1).to_radians();
    let y = dlambda.sin() * phi2.cos();
    let x = phi1.cos() * phi2.sin() - phi1.sin() * phi2.cos() * dlambda.cos();
    let grad = (y.atan2(x).to_degrees() + 360.0) % 360.0;
    let idx = ((grad / 45.0).round() as usize) % 8;
    STRICHE[idx]
}

/// Nächsten Marker zur Anfrage-Koordinate finden (Haversine), optional eine Entität
/// (`typ`, `id`) ausschließen (Selbst-Ausschluss). `None`, wenn keiner übrig bleibt.
pub fn naechster(
    marker: &[Marker],
    lat: f64,
    lon: f64,
    exclude: Option<(&str, i64)>,
) -> Option<Peilung> {
    let nahe = marker
        .iter()
        .filter(|m| exclude != Some((m.typ.as_str(), m.id)))
        .min_by(|a, b| {
            let da = haversine_m((lat, lon), (a.lat, a.lon));
            let db = haversine_m((lat, lon), (b.lat, b.lon));
            da.total_cmp(&db)
        })?;
    Some(Peilung {
        distanz_m: haversine_m((lat, lon), (nahe.lat, nahe.lon)),
        richtung: bearing_8((lat, lon), (nahe.lat, nahe.lon)).to_string(),
        bezug_label: nahe.label.clone(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn haversine_bekannte_distanz() {
        // 1 Breitengrad-Minute ~ 1852 m (Seemeile). 0.1° Nord-Versatz ~ 11119 m.
        let d = haversine_m((51.0, 10.0), (51.1, 10.0));
        assert!((d - 11119.0).abs() < 50.0, "war {d}");
    }

    #[test]
    fn bearing_kardinalrichtungen() {
        assert_eq!(bearing_8((51.0, 10.0), (51.5, 10.0)), "N"); // genau Nord
        assert_eq!(bearing_8((51.0, 10.0), (51.0, 10.5)), "O"); // genau Ost
        assert_eq!(bearing_8((51.0, 10.0), (50.5, 10.0)), "S"); // genau Süd
        assert_eq!(bearing_8((51.0, 10.0), (51.0, 9.5)), "W"); // genau West
    }

    fn marker(typ: &str, id: i64, lat: f64, lon: f64) -> Marker {
        Marker {
            typ: typ.into(),
            id,
            label: format!("{typ}-{id}"),
            lat,
            lon,
        }
    }

    #[test]
    fn naechster_waehlt_dichtesten_und_liefert_label() {
        let m = vec![
            marker("uhs", 1, 51.5, 10.0),
            marker("schaden", 2, 51.01, 10.0),
        ];
        let p = naechster(&m, 51.0, 10.0, None).expect("Peilung");
        assert_eq!(p.bezug_label, "schaden-2"); // näher
        assert_eq!(p.richtung, "N");
        assert!(p.distanz_m > 0.0);
    }

    #[test]
    fn naechster_exclude_schliesst_eigene_entitaet_aus() {
        let m = vec![marker("uhs", 7, 51.001, 10.0), marker("uhs", 8, 51.5, 10.0)];
        // uhs:7 ist am nächsten, wird aber ausgeschlossen → uhs:8 gewinnt.
        let p = naechster(&m, 51.0, 10.0, Some(("uhs", 7))).expect("Peilung");
        assert_eq!(p.bezug_label, "uhs-8");
    }

    #[test]
    fn naechster_ohne_marker_ist_none() {
        assert!(naechster(&[], 51.0, 10.0, None).is_none());
    }
}
