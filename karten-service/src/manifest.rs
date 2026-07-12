use crate::regions;
use chrono::NaiveDate;
use karten_katalog::OfflineKatalogEintrag;

#[derive(Clone)]
pub struct PublishedVersion {
    pub slug: String,
    pub url: String,
    pub groesse: i64,
    pub sha256: String,
}

pub fn datei_key(slug: &str, datum: NaiveDate) -> String {
    format!("{slug}.{}.shortbread.mbtiles", datum.format("%Y%m%d"))
}

pub fn baue_manifest(versionen: &[PublishedVersion]) -> Vec<OfflineKatalogEintrag> {
    versionen
        .iter()
        .filter_map(|v| {
            let r = regions::finde(&v.slug)?;
            Some(OfflineKatalogEintrag {
                name: r.name.into(),
                url: v.url.clone(),
                region: r.region.into(),
                groesse: v.groesse,
                lizenz: r.lizenz.into(),
                kachel_schema: "shortbread".into(),
                quelle: "Eigen-Service (karten-build, Planetiler-Shortbread)".into(),
                sha256: Some(v.sha256.clone()),
                gruppe: Some(r.gruppe.into()),
            })
        })
        .collect()
}

/// Rekonstruiert eine PublishedVersion aus einem Manifest-Eintrag (Slug = Dateiname-Präfix vor dem
/// ersten '.'; Slugs enthalten keinen Punkt). `None`, wenn kein sha256 oder Slug unbekannt.
pub fn published_aus_eintrag(e: &OfflineKatalogEintrag) -> Option<PublishedVersion> {
    let datei = e.url.rsplit('/').next()?;
    let slug = datei.split('.').next()?.to_string();
    regions::finde(&slug)?;
    let sha256 = e.sha256.clone()?;
    Some(PublishedVersion {
        slug,
        url: e.url.clone(),
        groesse: e.groesse,
        sha256,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use karten_katalog::remote_eintrag_ist_gueltig;
    #[test]
    fn key_ist_datiert() {
        let d = chrono::NaiveDate::from_ymd_opt(2026, 7, 5).unwrap();
        assert_eq!(datei_key("bayern", d), "bayern.20260705.shortbread.mbtiles");
    }
    #[test]
    fn manifest_eintraege_sind_vollstaendig_gepinnt() {
        let v = vec![PublishedVersion {
            slug: "germany".into(),
            url: "https://cdn.example/maps/germany.20260705.shortbread.mbtiles".into(),
            groesse: 3_000_000_000,
            sha256: "a".repeat(64),
        }];
        let m = baue_manifest(&v);
        assert_eq!(m.len(), 1);
        assert_eq!(m[0].kachel_schema, "shortbread");
        assert_eq!(m[0].name, "Deutschland (Shortbread)");
        assert!(remote_eintrag_ist_gueltig(&m[0]));
    }
    #[test]
    fn seed_round_trip() {
        // manifest -> eintrag -> published behält slug/url/sha
        let v = vec![PublishedVersion {
            slug: "baden-wuerttemberg".into(),
            url: "https://cdn.example/maps/baden-wuerttemberg.20260705.shortbread.mbtiles".into(),
            groesse: 1_000_000_000,
            sha256: "b".repeat(64),
        }];
        let m = baue_manifest(&v);
        let back = published_aus_eintrag(&m[0]).unwrap();
        assert_eq!(back.slug, "baden-wuerttemberg");
        assert_eq!(back.url, v[0].url);
        assert_eq!(back.sha256, v[0].sha256);
    }
    #[test]
    fn unbekannter_slug_wird_uebersprungen() {
        let v = vec![PublishedVersion {
            slug: "atlantis".into(),
            url: "https://x/a.mbtiles".into(),
            groesse: 1,
            sha256: "c".repeat(64),
        }];
        assert!(baue_manifest(&v).is_empty());
    }
}
