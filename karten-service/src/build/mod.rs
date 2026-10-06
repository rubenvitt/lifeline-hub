pub mod make_runner;
pub mod validate;
use crate::jobs::{JobStatus, Registry};
use crate::manifest::{baue_manifest, datei_key, published_aus_eintrag, PublishedVersion};
use crate::regions::Region;
use crate::storage::Storage;
use async_trait::async_trait;
use chrono::NaiveDate;
use karten_katalog::OfflineKatalogEintrag;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

pub struct BuildArtefakt {
    pub datei: PathBuf,
    pub sha256: String,
    pub bounds: Option<(f64, f64, f64, f64)>,
}

#[async_trait]
pub trait BuildRunner: Send + Sync {
    async fn baue(&self, geofabrik_area: &str) -> anyhow::Result<BuildArtefakt>;
    /// Räumt nach einem gescheiterten oder abgebrochenen Bau auf: Container stoppen,
    /// Teilartefakte löschen (LFH-927). Default: nichts zu tun.
    async fn raeume_ab(&self, _geofabrik_area: &str) {}
}

/// Baut, prüft und lädt die Datei einer Region hoch. Die lokale Ergebnisdatei samt Beilagen wird
/// danach in jedem Fall gelöscht — nach dem Upload wird sie nicht mehr gebraucht, nach einem
/// Fehlschlag ist sie unbrauchbar; sonst füllt `out/result/` Quartal für Quartal die Platte
/// (LFH-927). Den Bestand ändert das nicht: der wird erst nach dem Manifest-Upload gesetzt.
pub async fn build_region(
    reg: &Region,
    heute: NaiveDate,
    runner: &dyn BuildRunner,
    storage: &dyn Storage,
    bestand: &[PublishedVersion],
) -> anyhow::Result<Vec<PublishedVersion>> {
    let art = runner.baue(reg.geofabrik_area).await?;
    let ergebnis = lade_hoch(reg, heute, &art, storage, bestand).await;
    entferne_artefakt(&art.datei).await;
    ergebnis
}

async fn lade_hoch(
    reg: &Region,
    heute: NaiveDate,
    art: &BuildArtefakt,
    storage: &dyn Storage,
    bestand: &[PublishedVersion],
) -> anyhow::Result<Vec<PublishedVersion>> {
    let erwartet = validate::erwartete_box(reg.region)
        .ok_or_else(|| anyhow::anyhow!("keine Erwartungs-Box für {}", reg.region))?;
    if !validate::bounds_passen(art.bounds, erwartet) {
        anyhow::bail!(
            "Falschregion: bounds {:?} passen nicht zu {}",
            art.bounds,
            reg.region
        );
    }
    let key = datei_key(reg.slug, heute);
    let groesse = tokio::fs::metadata(&art.datei).await?.len() as i64;
    storage.put_datei(&key, &art.datei).await?; // gestreamt, nie in den RAM
    let mut out: Vec<PublishedVersion> = bestand
        .iter()
        .filter(|v| v.slug != reg.slug)
        .cloned()
        .collect();
    out.push(PublishedVersion {
        slug: reg.slug.into(),
        url: storage.public_url(&key),
        groesse,
        sha256: art.sha256.clone(),
    });
    Ok(out)
}

/// Löscht die Ergebnisdatei und ihre Beilagen (`.sha256` aus `--checksum`, die ungenutzte
/// `.versatiles`). Fehlt eine, ist das kein Fehler.
async fn entferne_artefakt(datei: &Path) {
    let mut pfade = vec![datei.to_path_buf(), beilage(datei, ".sha256")];
    let versatiles = datei.with_extension("versatiles");
    pfade.push(beilage(&versatiles, ".sha256"));
    pfade.push(versatiles);
    for p in pfade {
        match tokio::fs::remove_file(&p).await {
            Ok(()) => {}
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => tracing::warn!(pfad = %p.display(), "Ergebnisdatei nicht gelöscht: {e}"),
        }
    }
}

/// `<datei><endung>`, etwa `osm.bayern.2026-07-06.mbtiles.sha256`.
pub(crate) fn beilage(datei: &Path, endung: &str) -> PathBuf {
    let mut s = datei.as_os_str().to_owned();
    s.push(endung);
    PathBuf::from(s)
}

/// Fährt einen kompletten Build-Job: Status-FSM Building→Publishing→Done/Failed. Der geteilte
/// `bestand` (alle publizierten Regionen) wird erst NACH erfolgreichem Manifest-Upload
/// aktualisiert — bei jedem Fehlerzweig bleibt der Vorbestand unangetastet (atomarer Publish).
pub async fn fahre_build(
    reg: &Region,
    job_id: u64,
    registry: &Registry,
    runner: Arc<dyn BuildRunner>,
    storage: Arc<dyn Storage>,
    bestand: Arc<Mutex<Vec<PublishedVersion>>>,
) {
    registry.set_status(job_id, JobStatus::Building);
    let heute = chrono::Utc::now().date_naive();
    let snapshot = bestand.lock().unwrap().clone();
    // LFH-927: Ein hängender make-/docker-Lauf darf den einzigen Bauplatz nicht dauerhaft belegen.
    // Läuft die Frist ab, wird der Bau-Future verworfen (make stirbt über `kill_on_drop`), der
    // Runner räumt Container und Teilartefakte ab, und der Aufrufer gibt den Guard regulär frei.
    let frist = reg.max_dauer();
    let gebaut = match tokio::time::timeout(
        frist,
        build_region(reg, heute, runner.as_ref(), storage.as_ref(), &snapshot),
    )
    .await
    {
        Ok(r) => r,
        Err(_) => Err(anyhow::anyhow!(
            "Zeitüberschreitung: Bau länger als {} h",
            frist.as_secs() / 3600
        )),
    };
    if gebaut.is_err() {
        runner.raeume_ab(reg.geofabrik_area).await;
    }
    match gebaut {
        Ok(neu) => {
            registry.set_status(job_id, JobStatus::Publishing);
            match serde_json::to_vec(&baue_manifest(&neu)) {
                Ok(js) => match storage.put_bytes("offline-katalog-manifest.json", js).await {
                    Ok(()) => {
                        *bestand.lock().unwrap() = neu;
                        registry.set_status(job_id, JobStatus::Done);
                    }
                    Err(e) => registry
                        .set_status(job_id, JobStatus::Failed(format!("Manifest-Upload: {e}"))),
                },
                Err(e) => registry.set_status(
                    job_id,
                    JobStatus::Failed(format!("Manifest-Serialisierung: {e}")),
                ),
            }
        }
        Err(e) => registry.set_status(job_id, JobStatus::Failed(e.to_string())),
    }
}

/// Beim Start: den aktuellen Manifest-Stand aus dem Storage laden, damit ein einzelner Rebuild
/// nicht die anderen Regionen aus dem Manifest wirft. Nur ein fehlendes Objekt (`Ok(None)`,
/// legitimer Erststart ohne Manifest) liefert einen leeren Bestand — ein Storage-Lesefehler
/// oder ein korruptes Manifest wird propagiert statt still als "kein Manifest" behandelt zu
/// werden, sonst würde ein transienter Lesefehler den nächsten Build dazu bringen, alle
/// anderen Regionen aus dem publizierten Manifest zu werfen.
pub async fn seed_bestand(storage: &dyn Storage) -> anyhow::Result<Vec<PublishedVersion>> {
    let js = match storage.get_bytes("offline-katalog-manifest.json").await {
        Ok(Some(js)) => js,
        Ok(None) => return Ok(vec![]),
        Err(e) => return Err(e.context("Manifest-Lesefehler beim Seed des Bestands")),
    };
    let eintraege: Vec<OfflineKatalogEintrag> = serde_json::from_slice(&js)
        .map_err(|e| anyhow::anyhow!("Manifest-Parse-Fehler beim Seed des Bestands: {e}"))?;
    Ok(eintraege.iter().filter_map(published_aus_eintrag).collect())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{regions, storage::FakeStorage};
    use std::io::Write;

    fn tempdatei(bytes: &[u8]) -> tempfile::NamedTempFile {
        let mut f = tempfile::NamedTempFile::new().unwrap();
        f.write_all(bytes).unwrap();
        f
    }
    struct OkRunner(std::path::PathBuf);
    #[async_trait::async_trait]
    impl BuildRunner for OkRunner {
        async fn baue(&self, _a: &str) -> anyhow::Result<BuildArtefakt> {
            Ok(BuildArtefakt {
                datei: self.0.clone(),
                sha256: "a".repeat(64),
                bounds: Some((8.9, 47.2, 13.9, 50.6)),
            })
        }
    }
    struct FalschRunner(std::path::PathBuf);
    #[async_trait::async_trait]
    impl BuildRunner for FalschRunner {
        async fn baue(&self, _a: &str) -> anyhow::Result<BuildArtefakt> {
            // Abweichung vom Brief: (5.8,47.2,15.1,55.1) ist die DE-weite Box, die
            // erwartete_box("DE-BY") wegen der spec-gewollt groben DE-*-Fallback-Zuordnung
            // (progress.md Task 5+6) selbst zurückgibt — bounds_passen hätte das nie erkannt.
            // Stattdessen: Bounds eines Nachbarlands (AT), das eindeutig außerhalb der
            // DE-Box liegt und so die Falschregion-Erkennung real auslöst.
            Ok(BuildArtefakt {
                datei: self.0.clone(),
                sha256: "a".repeat(64),
                bounds: Some((9.5, 46.3, 17.2, 49.1)),
            })
        }
    }
    #[tokio::test]
    async fn build_region_laedt_hoch_und_pinnt() {
        let f = tempdatei(&[9; 10]);
        let s = FakeStorage::neu("https://cdn.example/maps");
        let d = chrono::NaiveDate::from_ymd_opt(2026, 7, 5).unwrap();
        let by = regions::finde("bayern").unwrap();
        let neu = build_region(by, d, &OkRunner(f.path().into()), &s, &[])
            .await
            .unwrap();
        let v = neu.iter().find(|v| v.slug == "bayern").unwrap();
        assert_eq!(
            v.url,
            "https://cdn.example/maps/bayern.20260705.shortbread.mbtiles"
        );
        assert_eq!(v.groesse, 10);
        assert!(s.inhalt("bayern.20260705.shortbread.mbtiles").is_some());
    }
    /// Legt wie Planetiler eine Ergebnisdatei samt Beilagen in `dir` an.
    struct DateiRunner {
        dir: std::path::PathBuf,
        bounds: (f64, f64, f64, f64),
    }
    #[async_trait::async_trait]
    impl BuildRunner for DateiRunner {
        async fn baue(&self, a: &str) -> anyhow::Result<BuildArtefakt> {
            let datei = self.dir.join(format!("osm.{a}.2026-07-05.mbtiles"));
            std::fs::write(&datei, [9; 10])?;
            std::fs::write(beilage(&datei, ".sha256"), "a".repeat(64))?;
            std::fs::write(datei.with_extension("versatiles"), [1])?;
            Ok(BuildArtefakt {
                datei,
                sha256: "a".repeat(64),
                bounds: Some(self.bounds),
            })
        }
    }
    fn dateien(dir: &std::path::Path) -> Vec<String> {
        std::fs::read_dir(dir)
            .unwrap()
            .map(|e| e.unwrap().file_name().into_string().unwrap())
            .collect()
    }
    #[tokio::test]
    async fn ergebnisdateien_sind_nach_upload_weg() {
        let dir = tempfile::tempdir().unwrap();
        let runner = DateiRunner {
            dir: dir.path().into(),
            bounds: (8.9, 47.2, 13.9, 50.6),
        };
        let s = FakeStorage::neu("https://cdn.example/maps");
        let d = chrono::NaiveDate::from_ymd_opt(2026, 7, 5).unwrap();
        let by = regions::finde("bayern").unwrap();
        build_region(by, d, &runner, &s, &[]).await.unwrap();
        assert!(s.inhalt("bayern.20260705.shortbread.mbtiles").is_some());
        assert_eq!(dateien(dir.path()), Vec::<String>::new());
    }
    #[tokio::test]
    async fn ergebnisdateien_sind_nach_fehlschlag_weg() {
        let dir = tempfile::tempdir().unwrap();
        // Bounds von AT: Falschregion für Bayern, wie im FalschRunner.
        let runner = DateiRunner {
            dir: dir.path().into(),
            bounds: (9.5, 46.3, 17.2, 49.1),
        };
        let s = FakeStorage::neu("https://cdn.example/maps");
        let d = chrono::NaiveDate::from_ymd_opt(2026, 7, 5).unwrap();
        let by = regions::finde("bayern").unwrap();
        assert!(build_region(by, d, &runner, &s, &[]).await.is_err());
        assert_eq!(dateien(dir.path()), Vec::<String>::new());
    }
    #[tokio::test]
    async fn falschregion_bricht_ab_ohne_upload() {
        let f = tempdatei(&[9; 10]);
        let s = FakeStorage::neu("https://cdn.example/maps");
        let d = chrono::NaiveDate::from_ymd_opt(2026, 7, 5).unwrap();
        let by = regions::finde("bayern").unwrap();
        assert!(build_region(by, d, &FalschRunner(f.path().into()), &s, &[])
            .await
            .is_err());
        assert!(s.inhalt("bayern.20260705.shortbread.mbtiles").is_none());
    }
}

#[cfg(test)]
mod fahrt_tests {
    use super::*;
    use crate::{jobs::Registry, manifest::PublishedVersion, regions, storage::FakeStorage};
    use std::io::Write;
    use std::sync::{Arc, Mutex};
    struct OkRunner(std::path::PathBuf);
    #[async_trait::async_trait]
    impl BuildRunner for OkRunner {
        async fn baue(&self, _a: &str) -> anyhow::Result<BuildArtefakt> {
            Ok(BuildArtefakt {
                datei: self.0.clone(),
                sha256: "c".repeat(64),
                bounds: Some((8.9, 47.2, 13.9, 50.6)),
            })
        }
    }
    #[tokio::test]
    async fn fahrt_done_und_seed_bewahrt_andere_regionen() {
        let mut f = tempfile::NamedTempFile::new().unwrap();
        f.write_all(&[7; 5]).unwrap();
        let s = Arc::new(FakeStorage::neu("https://cdn.example/maps"));
        // Vorbestand: germany bereits publiziert
        let bestand = Arc::new(Mutex::new(vec![PublishedVersion {
            slug: "germany".into(),
            url: "https://cdn.example/maps/germany.20260101.shortbread.mbtiles".into(),
            groesse: 3,
            sha256: "d".repeat(64),
        }]));
        let id = {
            let r = Registry::neu(4);
            let id = r.enqueue("bayern").unwrap();
            fahre_build(
                regions::finde("bayern").unwrap(),
                id,
                &r,
                Arc::new(OkRunner(f.path().into())),
                s.clone(),
                bestand.clone(),
            )
            .await;
            assert!(matches!(
                r.get(id).unwrap().status,
                crate::jobs::JobStatus::Done
            ));
            id
        };
        let _ = id;
        // Manifest enthält BEIDE Regionen (germany bewahrt + bayern neu)
        let m: Vec<karten_katalog::OfflineKatalogEintrag> =
            serde_json::from_slice(&s.inhalt("offline-katalog-manifest.json").unwrap()).unwrap();
        assert!(m.iter().any(|e| e.name == "Deutschland (Shortbread)"));
        assert!(m.iter().any(|e| e.name == "Bayern"));
        // seed_bestand liest das Manifest zurück (2 Einträge)
        assert_eq!(seed_bestand(s.as_ref()).await.unwrap().len(), 2);
    }

    /// Bau, der nie fertig wird (hängender Download, hängender Docker-Daemon).
    #[derive(Default)]
    struct HaengtRunner {
        abgeraeumt: std::sync::Mutex<Vec<String>>,
    }
    #[async_trait::async_trait]
    impl BuildRunner for HaengtRunner {
        async fn baue(&self, _a: &str) -> anyhow::Result<BuildArtefakt> {
            std::future::pending().await
        }
        async fn raeume_ab(&self, a: &str) {
            self.abgeraeumt.lock().unwrap().push(a.into());
        }
    }
    #[tokio::test(start_paused = true)]
    async fn frist_beendet_haengenden_bau_ohne_bestand_zu_aendern() {
        let s = Arc::new(FakeStorage::neu("https://cdn.example/maps"));
        let bestand = Arc::new(Mutex::new(Vec::<PublishedVersion>::new()));
        let runner = Arc::new(HaengtRunner::default());
        let r = Registry::neu(4);
        let id = r.enqueue("bayern").unwrap();
        let frist = regions::finde("bayern").unwrap().max_dauer();
        let start = tokio::time::Instant::now();
        // Äußere Grenze, damit ein Bau ohne Frist den Test rot macht statt ihn hängen zu lassen.
        tokio::time::timeout(
            frist * 2,
            fahre_build(
                regions::finde("bayern").unwrap(),
                id,
                &r,
                runner.clone(),
                s.clone(),
                bestand.clone(),
            ),
        )
        .await
        .expect("fahre_build endet an der Frist der Region");
        match r.get(id).unwrap().status {
            crate::jobs::JobStatus::Failed(f) => {
                assert!(f.starts_with("Zeitüberschreitung"), "{f}")
            }
            anders => panic!("erwartet Failed, war {anders:?}"),
        }
        assert_eq!(
            start.elapsed(),
            regions::finde("bayern").unwrap().max_dauer()
        );
        assert_eq!(*runner.abgeraeumt.lock().unwrap(), ["bayern"]);
        assert!(bestand.lock().unwrap().is_empty());
        assert!(s.inhalt("offline-katalog-manifest.json").is_none());
    }

    #[tokio::test]
    async fn seed_bestand_ohne_manifest_liefert_leeren_bestand_kein_fehler() {
        // Erststart: Storage kennt "offline-katalog-manifest.json" nicht (Ok(None)) — das ist
        // ein legitimer Zustand, kein Fehler, also Ok(vec![]) statt Err.
        let s = FakeStorage::neu("https://cdn.example/maps");
        assert!(seed_bestand(&s).await.unwrap().is_empty());
    }

    #[tokio::test]
    async fn seed_bestand_bei_korruptem_manifest_scheitert_statt_leer_zu_wipen() {
        // Vorhandenes, aber kaputtes Manifest (z.B. durch einen halb geschriebenen Upload)
        // darf NICHT wie "kein Manifest" behandelt werden — sonst würde ein Folge-Build den
        // publizierten Katalog auf die eine neu gebaute Region reduzieren.
        let s = FakeStorage::neu("https://cdn.example/maps");
        s.put_bytes("offline-katalog-manifest.json", b"{ not json".to_vec())
            .await
            .unwrap();
        assert!(seed_bestand(&s).await.is_err());
    }
}
