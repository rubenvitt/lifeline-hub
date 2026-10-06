use std::time::Duration;

pub struct Region {
    pub slug: &'static str,
    pub geofabrik_area: &'static str,
    pub name: &'static str,
    pub region: &'static str,
    pub gruppe: &'static str,
    pub lizenz: &'static str,
    pub bau: BauKlasse,
}

/// Wie schwer ein Bau ist (LFH-927, LFH-929). Daraus folgen die Frist des Baus und ob der
/// Quartals-Cron die Region von selbst einreiht.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum BauKlasse {
    /// Länder und Bundesländer: wenige GB, in Stunden gebaut, läuft im Cron mit.
    Region,
    /// Ganze Welt (~70–80 GB Download, ~300 GB Build-Platte): nur auf ausdrücklichen Auftrag
    /// (`POST /builds`, `build --slug planet`), nie im Cron und nie in `build --all`.
    Welt,
}

impl Region {
    /// Frist für Bau und Upload. Ein hängender make-/docker-Lauf darf den einzigen Bauplatz nicht
    /// dauerhaft belegen (LFH-927); germany braucht auf schwacher Hardware wenige Stunden.
    pub fn max_dauer(&self) -> Duration {
        match self.bau {
            BauKlasse::Region => Duration::from_secs(6 * 3600),
            BauKlasse::Welt => Duration::from_secs(72 * 3600),
        }
    }
    /// Reiht der Quartals-Cron (und `build --all`) diese Region ein? (LFH-929)
    pub fn im_cron(&self) -> bool {
        self.bau == BauKlasse::Region
    }
}
const ODBL: &str = "© OpenStreetMap contributors (ODbL)";
// Jede Region = EIN einzelner Geofabrik-Bare-Name (gegen den Geofabrik-Index gematcht, wie
// `germany`/`bremen`), kein Pfad und keine Kombi (DACH ist kein einzelner Extrakt). Neue Region =
// Zeile ergänzen + (falls kein `DE-*`) eine `erwartete_box` in build/validate.rs (Pflicht — eine
// fehlende Box bricht den Build hart ab, build/mod.rs).
static REGIONS: &[Region] = &[
    Region {
        slug: "germany",
        geofabrik_area: "germany",
        name: "Deutschland (Shortbread)",
        region: "DE",
        gruppe: "Deutschland",
        lizenz: ODBL,
        bau: BauKlasse::Region,
    },
    // Alle 16 Bundesländer (ISO 3166-2:DE) — Falschregion-Schutz via generischem DE-*-Fallback.
    Region {
        slug: "baden-wuerttemberg",
        geofabrik_area: "baden-wuerttemberg",
        name: "Baden-Württemberg",
        region: "DE-BW",
        gruppe: "Bundesländer",
        lizenz: ODBL,
        bau: BauKlasse::Region,
    },
    Region {
        slug: "bayern",
        geofabrik_area: "bayern",
        name: "Bayern",
        region: "DE-BY",
        gruppe: "Bundesländer",
        lizenz: ODBL,
        bau: BauKlasse::Region,
    },
    Region {
        slug: "berlin",
        geofabrik_area: "berlin",
        name: "Berlin",
        region: "DE-BE",
        gruppe: "Bundesländer",
        lizenz: ODBL,
        bau: BauKlasse::Region,
    },
    Region {
        slug: "brandenburg",
        geofabrik_area: "brandenburg",
        name: "Brandenburg",
        region: "DE-BB",
        gruppe: "Bundesländer",
        lizenz: ODBL,
        bau: BauKlasse::Region,
    },
    Region {
        slug: "bremen",
        geofabrik_area: "bremen",
        name: "Bremen",
        region: "DE-HB",
        gruppe: "Bundesländer",
        lizenz: ODBL,
        bau: BauKlasse::Region,
    },
    Region {
        slug: "hamburg",
        geofabrik_area: "hamburg",
        name: "Hamburg",
        region: "DE-HH",
        gruppe: "Bundesländer",
        lizenz: ODBL,
        bau: BauKlasse::Region,
    },
    Region {
        slug: "hessen",
        geofabrik_area: "hessen",
        name: "Hessen",
        region: "DE-HE",
        gruppe: "Bundesländer",
        lizenz: ODBL,
        bau: BauKlasse::Region,
    },
    Region {
        slug: "mecklenburg-vorpommern",
        geofabrik_area: "mecklenburg-vorpommern",
        name: "Mecklenburg-Vorpommern",
        region: "DE-MV",
        gruppe: "Bundesländer",
        lizenz: ODBL,
        bau: BauKlasse::Region,
    },
    Region {
        slug: "niedersachsen",
        geofabrik_area: "niedersachsen",
        name: "Niedersachsen",
        region: "DE-NI",
        gruppe: "Bundesländer",
        lizenz: ODBL,
        bau: BauKlasse::Region,
    },
    Region {
        slug: "nordrhein-westfalen",
        geofabrik_area: "nordrhein-westfalen",
        name: "Nordrhein-Westfalen",
        region: "DE-NW",
        gruppe: "Bundesländer",
        lizenz: ODBL,
        bau: BauKlasse::Region,
    },
    Region {
        slug: "rheinland-pfalz",
        geofabrik_area: "rheinland-pfalz",
        name: "Rheinland-Pfalz",
        region: "DE-RP",
        gruppe: "Bundesländer",
        lizenz: ODBL,
        bau: BauKlasse::Region,
    },
    Region {
        slug: "saarland",
        geofabrik_area: "saarland",
        name: "Saarland",
        region: "DE-SL",
        gruppe: "Bundesländer",
        lizenz: ODBL,
        bau: BauKlasse::Region,
    },
    Region {
        slug: "sachsen",
        geofabrik_area: "sachsen",
        name: "Sachsen",
        region: "DE-SN",
        gruppe: "Bundesländer",
        lizenz: ODBL,
        bau: BauKlasse::Region,
    },
    Region {
        slug: "sachsen-anhalt",
        geofabrik_area: "sachsen-anhalt",
        name: "Sachsen-Anhalt",
        region: "DE-ST",
        gruppe: "Bundesländer",
        lizenz: ODBL,
        bau: BauKlasse::Region,
    },
    Region {
        slug: "schleswig-holstein",
        geofabrik_area: "schleswig-holstein",
        name: "Schleswig-Holstein",
        region: "DE-SH",
        gruppe: "Bundesländer",
        lizenz: ODBL,
        bau: BauKlasse::Region,
    },
    Region {
        slug: "thueringen",
        geofabrik_area: "thueringen",
        name: "Thüringen",
        region: "DE-TH",
        gruppe: "Bundesländer",
        lizenz: ODBL,
        bau: BauKlasse::Region,
    },
    // Alle 9 Nachbarländer Deutschlands — je eine erwartete_box in validate.rs (FR/NL/DK weit
    // wegen Übersee-/Karibik-/Färöer-Gebieten im Geofabrik-Extrakt).
    Region {
        slug: "austria",
        geofabrik_area: "austria",
        name: "Österreich",
        region: "AT",
        gruppe: "Nachbarländer",
        lizenz: ODBL,
        bau: BauKlasse::Region,
    },
    Region {
        slug: "belgium",
        geofabrik_area: "belgium",
        name: "Belgien",
        region: "BE",
        gruppe: "Nachbarländer",
        lizenz: ODBL,
        bau: BauKlasse::Region,
    },
    Region {
        slug: "czech-republic",
        geofabrik_area: "czech-republic",
        name: "Tschechien",
        region: "CZ",
        gruppe: "Nachbarländer",
        lizenz: ODBL,
        bau: BauKlasse::Region,
    },
    Region {
        slug: "denmark",
        geofabrik_area: "denmark",
        name: "Dänemark",
        region: "DK",
        gruppe: "Nachbarländer",
        lizenz: ODBL,
        bau: BauKlasse::Region,
    },
    Region {
        slug: "france",
        geofabrik_area: "france",
        name: "Frankreich",
        region: "FR",
        gruppe: "Nachbarländer",
        lizenz: ODBL,
        bau: BauKlasse::Region,
    },
    Region {
        slug: "luxembourg",
        geofabrik_area: "luxembourg",
        name: "Luxemburg",
        region: "LU",
        gruppe: "Nachbarländer",
        lizenz: ODBL,
        bau: BauKlasse::Region,
    },
    Region {
        slug: "netherlands",
        geofabrik_area: "netherlands",
        name: "Niederlande",
        region: "NL",
        gruppe: "Nachbarländer",
        lizenz: ODBL,
        bau: BauKlasse::Region,
    },
    Region {
        slug: "poland",
        geofabrik_area: "poland",
        name: "Polen",
        region: "PL",
        gruppe: "Nachbarländer",
        lizenz: ODBL,
        bau: BauKlasse::Region,
    },
    Region {
        slug: "switzerland",
        geofabrik_area: "switzerland",
        name: "Schweiz",
        region: "CH",
        gruppe: "Nachbarländer",
        lizenz: ODBL,
        bau: BauKlasse::Region,
    },
    // Ganze Welt, VOLL-Detail (z2–14) — bewusst wählbare Option, sehr groß (~70–80 GB Download,
    // ~300 GB Build-Platte). `--area planet` ist ein Sonderfall des versatiles-planetiler-Images
    // (kein Geofabrik-Extrakt). Die Low-Zoom-Welt-Übersicht (auto-präsent) ist ein separater Bau.
    Region {
        slug: "planet",
        geofabrik_area: "planet",
        name: "Ganze Welt (Voll-Detail)",
        region: "WORLD",
        gruppe: "Welt",
        lizenz: ODBL,
        bau: BauKlasse::Welt,
    },
];
pub fn alle() -> &'static [Region] {
    REGIONS
}
/// Regionen, die der Quartals-Cron und `build --all` bauen — ohne die Welt (LFH-929).
pub fn fuer_cron() -> impl Iterator<Item = &'static Region> {
    REGIONS.iter().filter(|r| r.im_cron())
}
pub fn finde(slug: &str) -> Option<&'static Region> {
    REGIONS.iter().find(|r| r.slug == slug)
}
/// Slugs für `build --slug <x>` / `--all`. `--all` baut dieselben Regionen wie der Cron, also
/// ohne die Welt; planet geht nur über `--slug planet` (LFH-929).
pub fn fuer_build(slug: Option<&str>, alle: bool) -> anyhow::Result<Vec<&'static str>> {
    match (slug, alle) {
        (Some(s), _) => {
            let reg = finde(s).ok_or_else(|| anyhow::anyhow!("unbekannter slug {s}"))?;
            Ok(vec![reg.slug])
        }
        (None, true) => Ok(fuer_cron().map(|r| r.slug).collect()),
        (None, false) => anyhow::bail!("build braucht --slug <x> oder --all"),
    }
}

// LFH-323: `RegionDto` lebt jetzt im geteilten Crate `karten-katalog` — auf owned `String`-Felder
// umgebaut, damit `lifeline-hub` die Proxy-Antwort deserialisieren kann. Re-Export hält den Pfad
// `crate::regions::RegionDto` erhalten; `dtos()` klont die `&'static str`-Refs entsprechend.
pub use karten_katalog::RegionDto;

pub fn dtos() -> Vec<RegionDto> {
    alle()
        .iter()
        .map(|r| RegionDto {
            slug: r.slug.to_string(),
            name: r.name.to_string(),
            region: r.region.to_string(),
            gruppe: r.gruppe.to_string(),
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn kein_dach_kombi_und_lookup_klappt() {
        assert!(finde("germany").is_some());
        assert!(
            finde("dach").is_none(),
            "DACH ist kein einzelner Geofabrik-Extrakt (v1)"
        );
        assert!(finde("atlantis").is_none());
        let mut slugs: Vec<_> = alle().iter().map(|r| r.slug).collect();
        let n = slugs.len();
        slugs.sort();
        slugs.dedup();
        assert_eq!(slugs.len(), n, "Slugs eindeutig");
        assert!(alle().iter().all(|r| !r.geofabrik_area.is_empty()));
        assert!(
            alle().iter().all(|r| !r.slug.contains('.')),
            "Slug ohne Punkt (URL-Parsing)"
        );
    }

    #[test]
    fn welt_ist_baubar_aber_nicht_im_cron() {
        assert!(finde("planet").is_some(), "planet bleibt von Hand baubar");
        assert!(
            alle().iter().any(|r| r.slug == "planet"),
            "GET /regions listet planet"
        );
        assert!(fuer_cron().all(|r| r.slug != "planet"));
        assert_eq!(
            fuer_cron().count(),
            alle().len() - 1,
            "nur planet fällt heraus"
        );
    }

    #[test]
    fn welt_bekommt_die_laengere_frist() {
        let welt = finde("planet").unwrap().max_dauer();
        assert!(alle()
            .iter()
            .filter(|r| r.slug != "planet")
            .all(|r| r.max_dauer() < welt));
    }

    #[test]
    fn voller_satz_16_bundeslaender_und_9_nachbarn() {
        let bl = alle().iter().filter(|r| r.gruppe == "Bundesländer").count();
        assert_eq!(bl, 16, "alle 16 Bundesländer");
        let nb = alle()
            .iter()
            .filter(|r| r.gruppe == "Nachbarländer")
            .count();
        assert_eq!(nb, 9, "alle 9 Nachbarländer Deutschlands");
        // Nachbarländer stichprobenartig baubar (Bare-Name-Lookup).
        for slug in ["france", "poland", "denmark", "luxembourg", "netherlands"] {
            assert!(finde(slug).is_some(), "{slug} fehlt");
        }
        // DE-*-Codes sind eindeutig (kein Bundesland doppelt).
        let mut codes: Vec<_> = alle()
            .iter()
            .filter(|r| r.region.starts_with("DE-"))
            .map(|r| r.region)
            .collect();
        let m = codes.len();
        codes.sort();
        codes.dedup();
        assert_eq!(codes.len(), m, "Bundesland-Codes eindeutig");
    }
}
