use super::{BuildArtefakt, BuildRunner};
use async_trait::async_trait;
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};
use tokio::process::Command;

pub struct MakeRunner { pub karten_build_dir: PathBuf }

#[async_trait]
impl BuildRunner for MakeRunner {
    async fn baue(&self, geofabrik_area: &str) -> anyhow::Result<BuildArtefakt> {
        let status = Command::new("make")
            .arg("-C").arg(&self.karten_build_dir)
            .arg("tiles").arg(format!("AREA={geofabrik_area}"))
            .status().await?;
        anyhow::ensure!(status.success(), "make tiles AREA={geofabrik_area} fehlgeschlagen ({status})");
        let result_dir = self.karten_build_dir.join("out/result");
        let datei = std::fs::read_dir(&result_dir)?
            .filter_map(|e| e.ok().map(|e| e.path()))
            .find(|p| p.file_name().and_then(|n| n.to_str())
                .map(|n| n.starts_with("osm") && n.ends_with(".mbtiles")).unwrap_or(false))
            .ok_or_else(|| anyhow::anyhow!("keine osm*.mbtiles in {}", result_dir.display()))?;
        let sha256 = sha256_datei(&datei)?;
        let bounds = lies_bounds(&datei)?;
        Ok(BuildArtefakt { datei, sha256, bounds })
    }
}

/// sha256 GESTREAMT in festen 64-KiB-Blöcken — die Multi-GB-Datei nie ganz in den RAM.
/// (sha2/digest 0.11 implementiert kein io::Write mehr — daher manuelle Read-Schleife
/// statt std::io::copy, aber identisches Streaming-Verhalten.)
fn sha256_datei(p: &Path) -> anyhow::Result<String> {
    use std::io::Read;
    let mut f = std::fs::File::open(p)?;
    let mut h = Sha256::new();
    let mut buf = [0u8; 65536];
    loop {
        let n = f.read(&mut buf)?;
        if n == 0 { break; }
        h.update(&buf[..n]);
    }
    Ok(h.finalize().iter().map(|b| format!("{b:02x}")).collect())
}

fn lies_bounds(datei: &Path) -> anyhow::Result<Option<(f64,f64,f64,f64)>> {
    let out = std::process::Command::new("sqlite3").arg(datei)
        .arg("select value from metadata where name='bounds';").output()?;
    let s = String::from_utf8_lossy(&out.stdout);
    let teile: Vec<f64> = s.trim().split(',').filter_map(|x| x.trim().parse().ok()).collect();
    Ok(match teile.as_slice() { [w,s,o,n] => Some((*w,*s,*o,*n)), _ => None })
}
