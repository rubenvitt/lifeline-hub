pub struct Region {
    pub slug: &'static str, pub geofabrik_area: &'static str, pub name: &'static str,
    pub region: &'static str, pub gruppe: &'static str, pub lizenz: &'static str,
}
const ODBL: &str = "© OpenStreetMap contributors (ODbL)";
static REGIONS: &[Region] = &[
    Region { slug:"germany", geofabrik_area:"germany", name:"Deutschland (Shortbread)", region:"DE", gruppe:"Deutschland", lizenz:ODBL },
    Region { slug:"bayern", geofabrik_area:"bayern", name:"Bayern", region:"DE-BY", gruppe:"Bundesländer", lizenz:ODBL },
    Region { slug:"baden-wuerttemberg", geofabrik_area:"baden-wuerttemberg", name:"Baden-Württemberg", region:"DE-BW", gruppe:"Bundesländer", lizenz:ODBL },
    Region { slug:"nordrhein-westfalen", geofabrik_area:"nordrhein-westfalen", name:"Nordrhein-Westfalen", region:"DE-NW", gruppe:"Bundesländer", lizenz:ODBL },
    Region { slug:"niedersachsen", geofabrik_area:"niedersachsen", name:"Niedersachsen", region:"DE-NI", gruppe:"Bundesländer", lizenz:ODBL },
    Region { slug:"austria", geofabrik_area:"austria", name:"Österreich", region:"AT", gruppe:"Nachbarländer", lizenz:ODBL },
    Region { slug:"switzerland", geofabrik_area:"switzerland", name:"Schweiz", region:"CH", gruppe:"Nachbarländer", lizenz:ODBL },
];
pub fn alle() -> &'static [Region] { REGIONS }
pub fn finde(slug: &str) -> Option<&'static Region> { REGIONS.iter().find(|r| r.slug == slug) }

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn kein_dach_kombi_und_lookup_klappt() {
        assert!(finde("germany").is_some());
        assert!(finde("dach").is_none(), "DACH ist kein einzelner Geofabrik-Extrakt (v1)");
        assert!(finde("atlantis").is_none());
        let mut slugs: Vec<_> = alle().iter().map(|r| r.slug).collect();
        let n = slugs.len(); slugs.sort(); slugs.dedup();
        assert_eq!(slugs.len(), n, "Slugs eindeutig");
        assert!(alle().iter().all(|r| !r.geofabrik_area.is_empty()));
        assert!(alle().iter().all(|r| !r.slug.contains('.')), "Slug ohne Punkt (URL-Parsing)");
    }
}
