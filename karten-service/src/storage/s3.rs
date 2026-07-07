use super::Storage;
use async_trait::async_trait;
use object_store::{aws::AmazonS3Builder, path::Path as ObjPath, ObjectStoreExt, WriteMultipart};
use std::path::Path;
use tokio::io::AsyncReadExt;

pub struct S3Storage {
    store: object_store::aws::AmazonS3,
    base: String,
}

impl S3Storage {
    pub fn neu(bucket: &str, base_url: &str) -> anyhow::Result<Self> {
        // Credentials/Endpoint aus Standard-ENV (AWS_ACCESS_KEY_ID/…, AWS_ENDPOINT für R2).
        let store = AmazonS3Builder::from_env()
            .with_bucket_name(bucket)
            .build()?;
        Ok(Self {
            store,
            base: base_url.trim_end_matches('/').into(),
        })
    }
}

#[async_trait]
impl Storage for S3Storage {
    async fn put_datei(&self, key: &str, pfad: &Path) -> anyhow::Result<()> {
        // Erst die Datei öffnen, dann den Multipart-Upload starten: schlägt das Öffnen
        // fehl, existiert noch kein Upload-Handle, das aufgeräumt werden müsste.
        let mut f = tokio::fs::File::open(pfad).await?;
        let upload = self.store.put_multipart(&ObjPath::from(key)).await?;
        // WriteMultipart puffert intern auf korrekte Blockgrößen (≥5 MiB) — ein
        // Short-Read auf unserem Lesepuffer erzeugt so nie einen zu kleinen Part
        // (den S3/R2 zur Laufzeit ablehnen würden).
        let mut write = WriteMultipart::new(upload);
        let mut buf = vec![0u8; 8 * 1024 * 1024];
        loop {
            let n = match f.read(&mut buf).await {
                Ok(n) => n,
                Err(e) => {
                    // Best effort: verwaiste Parts abräumen, bevor der Lesefehler propagiert wird.
                    let _ = write.abort().await;
                    return Err(e.into());
                }
            };
            if n == 0 {
                break;
            }
            write.write(&buf[..n]);
            // Backpressure: ohne Deckel puffert WriteMultipart beliebig viele
            // In-Flight-Parts (Speicher wüchse mit der Dateigröße, wenn Lesen
            // schneller ist als Hochladen). Zusätzlich surfacen Part-Fehler so
            // schon hier, wo das Upload-Handle noch für abort() erreichbar ist.
            if let Err(e) = write.wait_for_capacity(4).await {
                let _ = write.abort().await;
                return Err(e.into());
            }
        }
        write.finish().await?;
        Ok(())
    }

    async fn put_bytes(&self, key: &str, bytes: Vec<u8>) -> anyhow::Result<()> {
        self.store.put(&ObjPath::from(key), bytes.into()).await?;
        Ok(())
    }

    async fn get_bytes(&self, key: &str) -> anyhow::Result<Option<Vec<u8>>> {
        match self.store.get(&ObjPath::from(key)).await {
            Ok(r) => Ok(Some(r.bytes().await?.to_vec())),
            Err(object_store::Error::NotFound { .. }) => Ok(None),
            Err(e) => Err(e.into()),
        }
    }

    fn public_url(&self, key: &str) -> String {
        format!("{}/{}", self.base, key)
    }
}
