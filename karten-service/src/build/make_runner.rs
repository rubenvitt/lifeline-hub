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
        let datei = waehle_artefakt(&result_dir, geofabrik_area)?;
        let sha256 = sha256_datei(&datei)?;
        let bounds = lies_bounds(&datei)?;
        Ok(BuildArtefakt { datei, sha256, bounds })
    }
}

/// Wählt aus `result_dir` die frisch gebaute `.mbtiles` GENAU der gebauten Region. `out/result/`
/// sammelt ALLE Alt-Builds (`osm.<area>.<datum>.mbtiles`); die frühere Auswahl „erste osm*.mbtiles
/// im Verzeichnis" nahm eine FS-reihenfolge-abhängige, beliebige Region → es wurde z. B. germany
/// statt der gebauten Region hochgeladen. Hier: exakt die zur `geofabrik_area` passende Datei, bei
/// mehreren Datumsständen die jüngste (dieser Build). Fehlt sie, ist es ein Fehler (statt still
/// eine fremde Region hochzuladen).
fn waehle_artefakt(result_dir: &Path, geofabrik_area: &str) -> anyhow::Result<PathBuf> {
    let praefix = format!("osm.{geofabrik_area}.");
    std::fs::read_dir(result_dir)?
        .filter_map(|e| e.ok())
        .filter(|e| {
            e.file_name()
                .to_str()
                .is_some_and(|n| n.starts_with(&praefix) && n.ends_with(".mbtiles"))
        })
        .max_by_key(|e| e.metadata().and_then(|m| m.modified()).ok())
        .map(|e| e.path())
        .ok_or_else(|| anyhow::anyhow!("keine {praefix}*.mbtiles in {}", result_dir.display()))
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn lege_an(dir: &Path, name: &str) {
        let mut f = std::fs::File::create(dir.join(name)).unwrap();
        f.write_all(b"x").unwrap();
    }

    #[test]
    fn waehlt_die_area_datei_nicht_eine_fremde() {
        // out/result sammelt viele Regionen; nur EINE ist die gerade gebaute.
        let dir = tempfile::tempdir().unwrap();
        for n in [
            "osm.bremen.2026-07-05.mbtiles",
            "osm.germany.2026-07-06.mbtiles",
            "osm.nordrhein-westfalen.2026-07-06.mbtiles",
            "osm.saarland.2026-07-05.mbtiles",
        ] {
            lege_an(dir.path(), n);
        }
        let gewaehlt = waehle_artefakt(dir.path(), "nordrhein-westfalen").unwrap();
        assert_eq!(
            gewaehlt.file_name().unwrap().to_str().unwrap(),
            "osm.nordrhein-westfalen.2026-07-06.mbtiles"
        );
        // Der Bug: germany durfte NIE für NRW gewählt werden.
        assert!(!gewaehlt.to_str().unwrap().contains("germany"));
    }

    #[test]
    fn praefix_matcht_nicht_ueber_den_punkt_hinaus() {
        // `germany` darf nicht `germany-nord` einfangen (Trenner `.` nach der Area).
        let dir = tempfile::tempdir().unwrap();
        lege_an(dir.path(), "osm.germany-nord.2026-07-06.mbtiles");
        assert!(waehle_artefakt(dir.path(), "germany").is_err());
    }

    #[test]
    fn waehlt_juengsten_datumsstand_derselben_region() {
        let dir = tempfile::tempdir().unwrap();
        lege_an(dir.path(), "osm.germany.2026-07-05.mbtiles");
        std::thread::sleep(std::time::Duration::from_millis(10)); // spätere mtime erzwingen
        lege_an(dir.path(), "osm.germany.2026-07-06.mbtiles");
        let gewaehlt = waehle_artefakt(dir.path(), "germany").unwrap();
        assert_eq!(gewaehlt.file_name().unwrap().to_str().unwrap(), "osm.germany.2026-07-06.mbtiles");
    }

    #[test]
    fn fehlende_region_ist_fehler_statt_fremder_datei() {
        // make „erfolgreich", aber kein Output für diese Area → Fehler, NICHT eine fremde Region.
        let dir = tempfile::tempdir().unwrap();
        lege_an(dir.path(), "osm.germany.2026-07-06.mbtiles");
        assert!(waehle_artefakt(dir.path(), "bayern").is_err());
    }
}
