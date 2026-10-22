use crate::regions;
use chrono::NaiveDate;
use karten_katalog::{AdressindexEintrag, OfflineKatalogEintrag};

#[derive(Clone)]
pub struct PublishedVersion {
    pub slug: String,
    pub url: String,
    pub groesse: i64,
    pub sha256: String,
    /// Offline-Adressindex derselben Region (LLH-1119).
    pub adressindex: Option<AdressindexEintrag>,
}

pub fn datei_key(slug: &str, datum: NaiveDate) -> String {
    format!("{slug}.{}.shortbread.mbtiles", datum.format("%Y%m%d"))
}

/// Objektname des Adressindex, neben der Karte desselben Baus (LLH-1119). Das Präfix vor dem ersten
/// Punkt ist der Slug wie bei der Karte (`karten_katalog::slug_aus_url`).
pub fn adressindex_key(slug: &str, datum: NaiveDate) -> String {
    format!(
        "{slug}.{}{}",
        datum.format("%Y%m%d"),
        karten_katalog::adressindex::ADRESSINDEX_ENDUNG
    )
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
                adressindex: v.adressindex.clone(),
            })
        })
        .collect()
}

/// Rekonstruiert eine PublishedVersion aus einem Manifest-Eintrag (Slug per
/// `karten_katalog::slug_aus_url`, dieselbe Regel nutzt der Hub für Karte ↔ Region). `None`,
/// wenn kein sha256 oder Slug unbekannt.
pub fn published_aus_eintrag(e: &OfflineKatalogEintrag) -> Option<PublishedVersion> {
    let slug = karten_katalog::slug_aus_url(&e.url)?;
    regions::finde(&slug)?;
    let sha256 = e.sha256.clone()?;
    Some(PublishedVersion {
        slug,
        url: e.url.clone(),
        groesse: e.groesse,
        sha256,
        adressindex: e.adressindex.clone(),
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
            adressindex: None,
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
            adressindex: None,
        }];
        let m = baue_manifest(&v);
        let back = published_aus_eintrag(&m[0]).unwrap();
        assert_eq!(back.slug, "baden-wuerttemberg");
        assert_eq!(back.url, v[0].url);
        assert_eq!(back.sha256, v[0].sha256);
    }
    /// LLH-1119: der Adressindex steht im Manifest und übersteht den Seed des Bestands.
    #[test]
    fn adressindex_im_manifest_und_im_seed() {
        let d = chrono::NaiveDate::from_ymd_opt(2026, 7, 5).unwrap();
        assert_eq!(
            adressindex_key("bremen", d),
            "bremen.20260705.adressen.sqlite"
        );
        let index = AdressindexEintrag {
            url: "https://cdn.example/maps/bremen.20260705.adressen.sqlite".into(),
            groesse: 4_000_000,
            sha256: "e".repeat(64),
        };
        let v = vec![PublishedVersion {
            slug: "bremen".into(),
            url: "https://cdn.example/maps/bremen.20260705.shortbread.mbtiles".into(),
            groesse: 50_000_000,
            sha256: "b".repeat(64),
            adressindex: Some(index.clone()),
        }];
        let m = baue_manifest(&v);
        assert_eq!(m[0].adressindex.as_ref(), Some(&index));
        assert_eq!(
            published_aus_eintrag(&m[0]).unwrap().adressindex,
            Some(index)
        );
    }

    #[test]
    fn unbekannter_slug_wird_uebersprungen() {
        let v = vec![PublishedVersion {
            slug: "atlantis".into(),
            url: "https://x/a.mbtiles".into(),
            groesse: 1,
            sha256: "c".repeat(64),
            adressindex: None,
        }];
        assert!(baue_manifest(&v).is_empty());
    }
}
