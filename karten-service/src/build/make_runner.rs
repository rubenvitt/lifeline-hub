use super::{BuildArtefakt, BuildRunner};
use async_trait::async_trait;
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};
use std::time::Duration;
use tokio::process::Command;

pub struct MakeRunner {
    pub karten_build_dir: PathBuf,
}

#[async_trait]
impl BuildRunner for MakeRunner {
    async fn baue(&self, geofabrik_area: &str) -> anyhow::Result<BuildArtefakt> {
        let result_dir = self.karten_build_dir.join("out/result");
        let tmp_dir = self.karten_build_dir.join("out/tmp");
        // LFH-927: Reste früherer Läufe dieser Area und die Arbeitsdaten in `out/tmp/` vorab weg.
        let area = geofabrik_area.to_string();
        let (r, t) = (result_dir.clone(), tmp_dir.clone());
        tokio::task::spawn_blocking(move || {
            raeume_ergebnisse(&r, &area)?;
            leere_verzeichnis(&t)
        })
        .await??;

        // `kill_on_drop`: Verwirft `fahre_build` den Bau nach Ablauf der Frist, stirbt make mit;
        // den Container räumt danach `raeume_ab` (LFH-927).
        let status = Command::new("make")
            .arg("-C")
            .arg(&self.karten_build_dir)
            .arg("tiles")
            .arg(format!("AREA={geofabrik_area}"))
            .kill_on_drop(true)
            .status()
            .await?;
        anyhow::ensure!(
            status.success(),
            "make tiles AREA={geofabrik_area} fehlgeschlagen ({status})"
        );
        // LFH-927: kein blockierendes std::fs/std::process auf der Laufzeit von axum und Cron.
        let area = geofabrik_area.to_string();
        let datei =
            tokio::task::spawn_blocking(move || waehle_artefakt(&result_dir, &area)).await??;
        let sha256 = match lies_sha256_beilage(&datei).await {
            Some(h) => h,
            None => {
                let d = datei.clone();
                tokio::task::spawn_blocking(move || sha256_datei(&d)).await??
            }
        };
        let bounds = lies_bounds(&datei).await?;
        Ok(BuildArtefakt {
            datei,
            sha256,
            bounds,
        })
    }

    /// Stoppt den Container `ks-<area>` (Name aus dem Makefile) und löscht die Teilartefakte der
    /// Area. Beides darf scheitern, ohne dass es den Worker aufhält.
    async fn raeume_ab(&self, geofabrik_area: &str) {
        let name = container_name(geofabrik_area);
        let docker = Command::new("docker")
            .args(["rm", "-f", &name])
            .kill_on_drop(true)
            .output();
        match tokio::time::timeout(Duration::from_secs(60), docker).await {
            Ok(Ok(_)) => {}
            Ok(Err(e)) => tracing::warn!(container = name, "docker rm -f nicht ausführbar: {e}"),
            Err(_) => tracing::warn!(container = name, "docker rm -f hängt, abgebrochen"),
        }
        let result_dir = self.karten_build_dir.join("out/result");
        let area = geofabrik_area.to_string();
        match tokio::task::spawn_blocking(move || raeume_ergebnisse(&result_dir, &area)).await {
            Ok(Ok(())) => {}
            Ok(Err(e)) => tracing::warn!("Teilartefakte nicht gelöscht: {e}"),
            Err(e) => tracing::warn!("Aufräumen abgebrochen: {e}"),
        }
    }
}

/// Name des Bau-Containers, muss zu `--name ks-$(AREA)` in `karten-build/Makefile` passen.
fn container_name(geofabrik_area: &str) -> String {
    format!("ks-{geofabrik_area}")
}

/// Löscht alle `osm.<area>.*` in `result_dir` (Ergebnis, `.sha256`, `.versatiles`), fremde
/// Regionen bleiben. Ein fehlendes Verzeichnis ist kein Fehler.
fn raeume_ergebnisse(result_dir: &Path, geofabrik_area: &str) -> std::io::Result<()> {
    let praefix = format!("osm.{geofabrik_area}.");
    let eintraege = match std::fs::read_dir(result_dir) {
        Ok(e) => e,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(e) => return Err(e),
    };
    for e in eintraege {
        let e = e?;
        if e.file_name()
            .to_str()
            .is_some_and(|n| n.starts_with(&praefix))
        {
            std::fs::remove_file(e.path())?;
        }
    }
    Ok(())
}

/// Leert `dir`, behält das Verzeichnis selbst. Ein fehlendes Verzeichnis ist kein Fehler.
fn leere_verzeichnis(dir: &Path) -> std::io::Result<()> {
    let eintraege = match std::fs::read_dir(dir) {
        Ok(e) => e,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(e) => return Err(e),
    };
    for e in eintraege {
        let p = e?.path();
        if p.is_dir() {
            std::fs::remove_dir_all(&p)?;
        } else {
            std::fs::remove_file(&p)?;
        }
    }
    Ok(())
}

/// Übernimmt die Prüfsumme, die Planetiler wegen `--checksum` neben die Datei schreibt
/// (`<datei>.sha256`, Hash als erstes Wort). Fehlt sie oder ist sie kein sha256, `None`: dann
/// hasht der Aufrufer selbst im Blocking-Pool.
async fn lies_sha256_beilage(datei: &Path) -> Option<String> {
    let text = tokio::fs::read_to_string(super::beilage(datei, ".sha256"))
        .await
        .ok()?;
    let hash = text.split_whitespace().next()?.to_ascii_lowercase();
    (hash.len() == 64 && hash.bytes().all(|b| b.is_ascii_hexdigit())).then_some(hash)
}

/// Wählt aus `result_dir` die frisch gebaute `.mbtiles` GENAU der gebauten Region. `out/result/`
/// sammelte früher ALLE Alt-Builds (`osm.<area>.<datum>.mbtiles`; seit LFH-927 wird nach jedem Bau
/// geräumt, Altbestände anderer Regionen können aber liegen); die frühere Auswahl „erste osm*.mbtiles
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
        if n == 0 {
            break;
        }
        h.update(&buf[..n]);
    }
    Ok(h.finalize().iter().map(|b| format!("{b:02x}")).collect())
}

async fn lies_bounds(datei: &Path) -> anyhow::Result<Option<(f64, f64, f64, f64)>> {
    let out = Command::new("sqlite3")
        .arg(datei)
        .arg("select value from metadata where name='bounds';")
        .kill_on_drop(true)
        .output()
        .await?;
    let s = String::from_utf8_lossy(&out.stdout);
    let teile: Vec<f64> = s
        .trim()
        .split(',')
        .filter_map(|x| x.trim().parse().ok())
        .collect();
    Ok(match teile.as_slice() {
        [w, s, o, n] => Some((*w, *s, *o, *n)),
        _ => None,
    })
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
        assert_eq!(
            gewaehlt.file_name().unwrap().to_str().unwrap(),
            "osm.germany.2026-07-06.mbtiles"
        );
    }

    #[test]
    fn raeumt_alt_staende_der_area_fremde_bleiben() {
        let dir = tempfile::tempdir().unwrap();
        for n in [
            "osm.bremen.2026-04-01.mbtiles",
            "osm.bremen.2026-04-01.mbtiles.sha256",
            "osm.bremen.2026-04-01.versatiles",
            "osm.bremen.2026-07-01.mbtiles",
            "osm.germany.2026-07-06.mbtiles",
            "osm.bremen-nord.2026-07-06.mbtiles",
        ] {
            lege_an(dir.path(), n);
        }
        raeume_ergebnisse(dir.path(), "bremen").unwrap();
        let mut rest: Vec<String> = std::fs::read_dir(dir.path())
            .unwrap()
            .map(|e| e.unwrap().file_name().into_string().unwrap())
            .collect();
        rest.sort();
        assert_eq!(
            rest,
            [
                "osm.bremen-nord.2026-07-06.mbtiles",
                "osm.germany.2026-07-06.mbtiles"
            ]
        );
        // Fehlendes Verzeichnis (Erststart) ist kein Fehler.
        raeume_ergebnisse(&dir.path().join("fehlt"), "bremen").unwrap();
    }

    #[test]
    fn leert_tmp_und_behaelt_das_verzeichnis() {
        let dir = tempfile::tempdir().unwrap();
        lege_an(dir.path(), "teil.bin");
        std::fs::create_dir(dir.path().join("unter")).unwrap();
        lege_an(&dir.path().join("unter"), "x");
        leere_verzeichnis(dir.path()).unwrap();
        assert!(dir.path().is_dir());
        assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 0);
        leere_verzeichnis(&dir.path().join("fehlt")).unwrap();
    }

    #[tokio::test]
    async fn uebernimmt_die_pruefsumme_aus_der_beilage() {
        let dir = tempfile::tempdir().unwrap();
        let datei = dir.path().join("osm.bremen.2026-07-06.mbtiles");
        lege_an(dir.path(), "osm.bremen.2026-07-06.mbtiles");
        assert_eq!(lies_sha256_beilage(&datei).await, None, "ohne Beilage");
        let hash = "AB".repeat(32);
        std::fs::write(
            super::super::beilage(&datei, ".sha256"),
            format!("{hash}  osm.bremen.2026-07-06.mbtiles\n"),
        )
        .unwrap();
        assert_eq!(
            lies_sha256_beilage(&datei).await,
            Some(hash.to_ascii_lowercase())
        );
        std::fs::write(super::super::beilage(&datei, ".sha256"), "kaputt").unwrap();
        assert_eq!(lies_sha256_beilage(&datei).await, None, "kein sha256");
    }

    #[test]
    fn container_name_passt_zum_makefile() {
        assert_eq!(container_name("bremen"), "ks-bremen");
        let makefile = include_str!("../../../karten-build/Makefile");
        assert!(makefile.contains("--name ks-$(AREA)"));
        assert!(makefile.contains("docker rm -f ks-$(AREA)"));
    }

    #[test]
    fn fehlende_region_ist_fehler_statt_fremder_datei() {
        // make „erfolgreich", aber kein Output für diese Area → Fehler, NICHT eine fremde Region.
        let dir = tempfile::tempdir().unwrap();
        lege_an(dir.path(), "osm.germany.2026-07-06.mbtiles");
        assert!(waehle_artefakt(dir.path(), "bayern").is_err());
    }
}
