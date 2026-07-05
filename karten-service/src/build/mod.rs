pub mod validate;
use crate::manifest::{datei_key, PublishedVersion};
use crate::regions::Region;
use crate::storage::Storage;
use async_trait::async_trait;
use chrono::NaiveDate;
use std::path::PathBuf;

pub struct BuildArtefakt { pub datei: PathBuf, pub sha256: String, pub bounds: Option<(f64,f64,f64,f64)> }

#[async_trait]
pub trait BuildRunner: Send + Sync {
    async fn baue(&self, geofabrik_area: &str) -> anyhow::Result<BuildArtefakt>;
}

pub async fn build_region(
    reg: &Region, heute: NaiveDate, runner: &dyn BuildRunner, storage: &dyn Storage,
    bestand: &[PublishedVersion],
) -> anyhow::Result<Vec<PublishedVersion>> {
    let art = runner.baue(reg.geofabrik_area).await?;
    let erwartet = validate::erwartete_box(reg.region)
        .ok_or_else(|| anyhow::anyhow!("keine Erwartungs-Box für {}", reg.region))?;
    if !validate::bounds_passen(art.bounds, erwartet) {
        anyhow::bail!("Falschregion: bounds {:?} passen nicht zu {}", art.bounds, reg.region);
    }
    let key = datei_key(reg.slug, heute);
    let groesse = std::fs::metadata(&art.datei)?.len() as i64;
    storage.put_datei(&key, &art.datei).await?;            // gestreamt, nie in den RAM
    let mut out: Vec<PublishedVersion> = bestand.iter().filter(|v| v.slug != reg.slug).cloned().collect();
    out.push(PublishedVersion { slug: reg.slug.into(), url: storage.public_url(&key), groesse, sha256: art.sha256 });
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{storage::FakeStorage, regions};
    use std::io::Write;

    fn tempdatei(bytes: &[u8]) -> tempfile::NamedTempFile {
        let mut f = tempfile::NamedTempFile::new().unwrap(); f.write_all(bytes).unwrap(); f
    }
    struct OkRunner(std::path::PathBuf);
    #[async_trait::async_trait]
    impl BuildRunner for OkRunner {
        async fn baue(&self, _a:&str) -> anyhow::Result<BuildArtefakt> {
            Ok(BuildArtefakt { datei: self.0.clone(), sha256:"a".repeat(64), bounds:Some((8.9,47.2,13.9,50.6)) })
        }
    }
    struct FalschRunner(std::path::PathBuf);
    #[async_trait::async_trait]
    impl BuildRunner for FalschRunner {
        async fn baue(&self, _a:&str) -> anyhow::Result<BuildArtefakt> {
            // Abweichung vom Brief: (5.8,47.2,15.1,55.1) ist die DE-weite Box, die
            // erwartete_box("DE-BY") wegen der spec-gewollt groben DE-*-Fallback-Zuordnung
            // (progress.md Task 5+6) selbst zurückgibt — bounds_passen hätte das nie erkannt.
            // Stattdessen: Bounds eines Nachbarlands (AT), das eindeutig außerhalb der
            // DE-Box liegt und so die Falschregion-Erkennung real auslöst.
            Ok(BuildArtefakt { datei: self.0.clone(), sha256:"a".repeat(64), bounds:Some((9.5,46.3,17.2,49.1)) })
        }
    }
    #[tokio::test]
    async fn build_region_laedt_hoch_und_pinnt() {
        let f = tempdatei(&[9;10]);
        let s = FakeStorage::neu("https://cdn.example/maps");
        let d = chrono::NaiveDate::from_ymd_opt(2026,7,5).unwrap();
        let by = regions::finde("bayern").unwrap();
        let neu = build_region(by, d, &OkRunner(f.path().into()), &s, &[]).await.unwrap();
        let v = neu.iter().find(|v| v.slug=="bayern").unwrap();
        assert_eq!(v.url, "https://cdn.example/maps/bayern.20260705.shortbread.mbtiles");
        assert_eq!(v.groesse, 10);
        assert!(s.inhalt("bayern.20260705.shortbread.mbtiles").is_some());
    }
    #[tokio::test]
    async fn falschregion_bricht_ab_ohne_upload() {
        let f = tempdatei(&[9;10]);
        let s = FakeStorage::neu("https://cdn.example/maps");
        let d = chrono::NaiveDate::from_ymd_opt(2026,7,5).unwrap();
        let by = regions::finde("bayern").unwrap();
        assert!(build_region(by, d, &FalschRunner(f.path().into()), &s, &[]).await.is_err());
        assert!(s.inhalt("bayern.20260705.shortbread.mbtiles").is_none());
    }
}
