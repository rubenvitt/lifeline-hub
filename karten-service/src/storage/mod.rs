use async_trait::async_trait;
use std::collections::HashMap;
use std::path::Path;
use std::sync::{Arc, Mutex};

pub mod s3;

#[async_trait]
pub trait Storage: Send + Sync {
    async fn put_datei(&self, key: &str, pfad: &Path) -> anyhow::Result<()>;
    async fn put_bytes(&self, key: &str, bytes: Vec<u8>) -> anyhow::Result<()>;
    async fn get_bytes(&self, key: &str) -> anyhow::Result<Option<Vec<u8>>>;
    fn public_url(&self, key: &str) -> String;
}

#[derive(Clone)]
pub struct FakeStorage {
    base: String,
    map: Arc<Mutex<HashMap<String, Vec<u8>>>>,
}

impl FakeStorage {
    pub fn neu(base: &str) -> Self {
        Self {
            base: base.trim_end_matches('/').into(),
            map: Default::default(),
        }
    }

    pub fn inhalt(&self, key: &str) -> Option<Vec<u8>> {
        self.map.lock().unwrap().get(key).cloned()
    }
}

#[async_trait]
impl Storage for FakeStorage {
    async fn put_datei(&self, key: &str, pfad: &Path) -> anyhow::Result<()> {
        let bytes = tokio::fs::read(pfad).await?; // Testdateien sind klein
        self.map.lock().unwrap().insert(key.into(), bytes);
        Ok(())
    }

    async fn put_bytes(&self, key: &str, bytes: Vec<u8>) -> anyhow::Result<()> {
        self.map.lock().unwrap().insert(key.into(), bytes);
        Ok(())
    }

    async fn get_bytes(&self, key: &str) -> anyhow::Result<Option<Vec<u8>>> {
        Ok(self.map.lock().unwrap().get(key).cloned())
    }

    fn public_url(&self, key: &str) -> String {
        format!("{}/{}", self.base, key)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    #[tokio::test]
    async fn fake_datei_und_bytes_round_trip() {
        let s = FakeStorage::neu("https://cdn.example/maps");
        let mut f = tempfile::NamedTempFile::new().unwrap();
        f.write_all(&[1, 2, 3]).unwrap();
        s.put_datei("germany.20260705.shortbread.mbtiles", f.path())
            .await
            .unwrap();
        assert_eq!(
            s.public_url("germany.20260705.shortbread.mbtiles"),
            "https://cdn.example/maps/germany.20260705.shortbread.mbtiles"
        );
        assert_eq!(
            s.inhalt("germany.20260705.shortbread.mbtiles").unwrap(),
            vec![1, 2, 3]
        );
        s.put_bytes("m.json", b"[]".to_vec()).await.unwrap();
        assert_eq!(s.get_bytes("m.json").await.unwrap().unwrap(), b"[]".to_vec());
        assert!(s.get_bytes("fehlt").await.unwrap().is_none());
    }
}
