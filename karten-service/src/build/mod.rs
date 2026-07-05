pub mod make_runner;
pub mod validate;
use crate::jobs::{JobStatus, Registry};
use crate::manifest::{baue_manifest, datei_key, published_aus_eintrag, PublishedVersion};
use crate::regions::Region;
use crate::storage::Storage;
use async_trait::async_trait;
use chrono::NaiveDate;
use karten_katalog::OfflineKatalogEintrag;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

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

/// Fährt einen kompletten Build-Job: Status-FSM Building→Publishing→Done/Failed. Der geteilte
/// `bestand` (alle publizierten Regionen) wird erst NACH erfolgreichem Manifest-Upload
/// aktualisiert — bei jedem Fehlerzweig bleibt der Vorbestand unangetastet (atomarer Publish).
pub async fn fahre_build(
    reg: &Region, job_id: u64, registry: &Registry,
    runner: Arc<dyn BuildRunner>, storage: Arc<dyn Storage>,
    bestand: Arc<Mutex<Vec<PublishedVersion>>>,
) {
    registry.set_status(job_id, JobStatus::Building);
    let heute = chrono::Utc::now().date_naive();
    let snapshot = bestand.lock().unwrap().clone();
    match build_region(reg, heute, runner.as_ref(), storage.as_ref(), &snapshot).await {
        Ok(neu) => {
            registry.set_status(job_id, JobStatus::Publishing);
            match serde_json::to_vec(&baue_manifest(&neu)) {
                Ok(js) => match storage.put_bytes("offline-katalog-manifest.json", js).await {
                    Ok(()) => { *bestand.lock().unwrap() = neu; registry.set_status(job_id, JobStatus::Done); }
                    Err(e) => registry.set_status(job_id, JobStatus::Failed(format!("Manifest-Upload: {e}"))),
                },
                Err(e) => registry.set_status(job_id, JobStatus::Failed(format!("Manifest-Serialisierung: {e}"))),
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

#[cfg(test)]
mod fahrt_tests {
    use super::*;
    use crate::{jobs::Registry, storage::FakeStorage, manifest::PublishedVersion, regions};
    use std::sync::{Arc, Mutex};
    use std::io::Write;
    struct OkRunner(std::path::PathBuf);
    #[async_trait::async_trait]
    impl BuildRunner for OkRunner {
        async fn baue(&self, _a:&str) -> anyhow::Result<BuildArtefakt> {
            Ok(BuildArtefakt { datei:self.0.clone(), sha256:"c".repeat(64), bounds:Some((8.9,47.2,13.9,50.6)) })
        }
    }
    #[tokio::test]
    async fn fahrt_done_und_seed_bewahrt_andere_regionen() {
        let mut f = tempfile::NamedTempFile::new().unwrap(); f.write_all(&[7;5]).unwrap();
        let s = Arc::new(FakeStorage::neu("https://cdn.example/maps"));
        // Vorbestand: germany bereits publiziert
        let bestand = Arc::new(Mutex::new(vec![PublishedVersion {
            slug:"germany".into(), url:"https://cdn.example/maps/germany.20260101.shortbread.mbtiles".into(),
            groesse:3, sha256:"d".repeat(64) }]));
        let id = { let r = Registry::neu(4); let id = r.enqueue("bayern").unwrap();
            fahre_build(regions::finde("bayern").unwrap(), id, &r, Arc::new(OkRunner(f.path().into())),
                        s.clone(), bestand.clone()).await;
            assert!(matches!(r.get(id).unwrap().status, crate::jobs::JobStatus::Done)); id };
        let _ = id;
        // Manifest enthält BEIDE Regionen (germany bewahrt + bayern neu)
        let m: Vec<karten_katalog::OfflineKatalogEintrag> =
            serde_json::from_slice(&s.inhalt("offline-katalog-manifest.json").unwrap()).unwrap();
        assert!(m.iter().any(|e| e.name=="Deutschland (Shortbread)"));
        assert!(m.iter().any(|e| e.name=="Bayern"));
        // seed_bestand liest das Manifest zurück (2 Einträge)
        assert_eq!(seed_bestand(s.as_ref()).await.unwrap().len(), 2);
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
        s.put_bytes("offline-katalog-manifest.json", b"{ not json".to_vec()).await.unwrap();
        assert!(seed_bestand(&s).await.is_err());
    }
}
