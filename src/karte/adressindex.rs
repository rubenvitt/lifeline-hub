//! Lädt den Offline-Adressindex einer Region mit ihrer Karte (LLH-1119, Spec
//! `offline-karten-aktualisierung`, „Der Adressindex kommt mit der Region“).
//!
//! Der Katalog-Eintrag der Karte (gleiche URL) nennt den Index samt Größe und SHA256-Pin
//! (`OfflineKatalogEintrag::adressindex`). Nach einem fertigen Karten-Download oder In-Place-Reload
//! lädt der Hub ihn nach `karte-{id}.adressen.sqlite` (über `.part`, atomarer Tausch); gesucht wird
//! darin über `geocoding::offline`. Ein Fehler hier lässt die Karte `bereit` und einen vorhandenen
//! Index stehen. Ohne Index im Katalog bleibt ein vorhandener ebenfalls stehen.

use crate::karte::download::{self, Fortschritt};
use karten_katalog::adressindex::ADRESSINDEX_ENDUNG;
use karten_katalog::{AdressindexEintrag, OfflineKatalogEintrag};
use std::path::Path;

/// Deckel je Index-Download: ein Index für Deutschland liegt im unteren GB-Bereich.
pub const MAX_ADRESSINDEX_BYTES: u64 = 8 * 1024 * 1024 * 1024;

/// Dateiname des Index zur Karte `id` im Kartenverzeichnis.
pub fn dateiname(id: i64) -> String {
    format!("karte-{id}{ADRESSINDEX_ENDUNG}")
}

/// Der Index des Katalog-Eintrags, dessen Karten-URL `karten_url` ist (URLs geparst verglichen).
pub fn eintrag_zur_karte<'a>(
    katalog: &'a [OfflineKatalogEintrag],
    karten_url: &str,
) -> Option<&'a AdressindexEintrag> {
    let gesucht = reqwest::Url::parse(karten_url).ok()?;
    katalog
        .iter()
        .find(|e| reqwest::Url::parse(&e.url).is_ok_and(|u| u == gesucht))
        .and_then(|e| e.adressindex.as_ref())
}

/// Lädt den Index zur Karte `id` nach, wenn der Katalog-Cache einen nennt. Best-effort: jeder
/// Fehler wird geloggt, die Karte bleibt unberührt.
pub async fn lade_zur_karte(
    client: &reqwest::Client,
    karten_dir: &Path,
    id: i64,
    karten_url: &str,
) {
    let katalog = crate::karte::katalog::katalog_aus_cache();
    let Some(eintrag) = eintrag_zur_karte(&katalog, karten_url).cloned() else {
        return;
    };
    let url = match download::validiere_download_url(&eintrag.url) {
        Ok(u) => u,
        Err(e) => {
            tracing::warn!("Adressindex zur Karte {id}: URL abgelehnt: {e}");
            return;
        }
    };
    match lade(client, karten_dir, id, url, &eintrag.sha256).await {
        Ok(groesse) => tracing::info!("Adressindex zur Karte {id} geladen ({groesse} Bytes)"),
        Err(e) => tracing::warn!("Adressindex zur Karte {id} nicht geladen: {e}"),
    }
}

/// Download nach `.part`, Pin-Prüfung, dann Tausch. Die URL ist geprüft (bzw. im Test ein
/// Loopback-Fixture). Liefert die Größe.
pub async fn lade(
    client: &reqwest::Client,
    karten_dir: &Path,
    id: i64,
    url: reqwest::Url,
    sha256: &str,
) -> Result<i64, String> {
    let ziel = karten_dir.join(dateiname(id));
    let part = karten_dir.join(format!("{}.part", dateiname(id)));
    let ergebnis = download::lade_datei(
        client,
        url,
        &part,
        &Fortschritt::default(),
        Some(sha256),
        MAX_ADRESSINDEX_BYTES,
    )
    .await;
    match ergebnis {
        Ok(erg) => match tokio::fs::rename(&part, &ziel).await {
            Ok(()) => Ok(erg.groesse),
            Err(e) => {
                let _ = tokio::fs::remove_file(&part).await;
                Err(format!("Tausch: {e}"))
            }
        },
        Err(e) => {
            let _ = tokio::fs::remove_file(&part).await;
            Err(e.to_string())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use sha2::{Digest, Sha256};

    fn eintrag(url: &str, index: Option<&str>) -> OfflineKatalogEintrag {
        OfflineKatalogEintrag {
            name: "Testgebiet".into(),
            url: url.into(),
            region: "DE".into(),
            groesse: 1,
            lizenz: "ODbL".into(),
            kachel_schema: "shortbread".into(),
            quelle: "t".into(),
            sha256: Some("a".repeat(64)),
            gruppe: None,
            adressindex: index.map(|u| AdressindexEintrag {
                url: u.into(),
                groesse: 3,
                sha256: "b".repeat(64),
            }),
        }
    }

    #[test]
    fn findet_den_index_zur_karten_url() {
        let katalog = vec![
            eintrag(
                "https://cdn.example/a.mbtiles",
                Some("https://cdn.example/a.adressen.sqlite"),
            ),
            eintrag("https://cdn.example/b.mbtiles", None),
        ];
        assert_eq!(
            eintrag_zur_karte(&katalog, "https://cdn.example/a.mbtiles").map(|e| e.url.as_str()),
            Some("https://cdn.example/a.adressen.sqlite")
        );
        // Gleiche URL, anders geschrieben (Host groß): geparst gleich.
        assert!(eintrag_zur_karte(&katalog, "https://CDN.example/a.mbtiles").is_some());
        assert_eq!(
            eintrag_zur_karte(&katalog, "https://cdn.example/b.mbtiles"),
            None
        );
        assert_eq!(
            eintrag_zur_karte(&katalog, "https://cdn.example/c.mbtiles"),
            None
        );
        assert_eq!(eintrag_zur_karte(&katalog, "kein url"), None);
    }

    async fn fixture(body: Vec<u8>) -> reqwest::Url {
        let app = axum::Router::new().route(
            "/i.adressen.sqlite",
            axum::routing::get(move || {
                let b = body.clone();
                async move { b }
            }),
        );
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        tokio::spawn(async move {
            axum::serve(listener, app).await.unwrap();
        });
        reqwest::Url::parse(&format!("http://{addr}/i.adressen.sqlite")).unwrap()
    }

    fn hex(b: &[u8]) -> String {
        Sha256::digest(b)
            .iter()
            .map(|x| format!("{x:02x}"))
            .collect()
    }

    #[tokio::test]
    async fn laedt_mit_pin_und_tauscht() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("karte-3.adressen.sqlite"), b"alt").unwrap();
        let url = fixture(b"neu".to_vec()).await;
        let n = lade(
            &download::download_client(),
            dir.path(),
            3,
            url,
            &hex(b"neu"),
        )
        .await
        .unwrap();
        assert_eq!(n, 3);
        assert_eq!(
            std::fs::read(dir.path().join("karte-3.adressen.sqlite")).unwrap(),
            b"neu"
        );
        assert!(!dir.path().join("karte-3.adressen.sqlite.part").exists());
    }

    #[tokio::test]
    async fn falscher_pin_laesst_den_alten_index_stehen() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("karte-3.adressen.sqlite"), b"alt").unwrap();
        let url = fixture(b"manipuliert".to_vec()).await;
        let e = lade(
            &download::download_client(),
            dir.path(),
            3,
            url,
            &hex(b"neu"),
        )
        .await;
        assert!(e.is_err());
        assert_eq!(
            std::fs::read(dir.path().join("karte-3.adressen.sqlite")).unwrap(),
            b"alt"
        );
        assert!(!dir.path().join("karte-3.adressen.sqlite.part").exists());
    }
}
