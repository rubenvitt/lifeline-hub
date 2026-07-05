use clap::Parser;
use std::path::PathBuf;

#[derive(Parser, Debug, Clone)]
#[command(version, about = "karten-service — Region-Pack-Build-Service")]
pub struct ServiceConfig {
    #[arg(long, env = "KS_BIND", default_value = "0.0.0.0:8088")]
    pub bind: String,
    #[arg(long, env = "KS_TOKEN", default_value = "")]
    pub token: String,
    /// Öffentliche Basis-URL des Object-Storage (ohne End-Slash), z. B. https://cdn.example/maps
    #[arg(long, env = "KS_BASE_URL", default_value = "")]
    pub base_url: String,
    #[arg(long, env = "KS_KARTEN_BUILD_DIR", default_value = "karten-build")]
    pub karten_build_dir: PathBuf,
    /// Cron-Expression (6 Felder). Default: quartalsweise 03:00 am 1. (Jan/Apr/Jul/Okt).
    #[arg(long, env = "KS_SCHEDULE", default_value = "0 0 3 1 1,4,7,10 *")]
    pub schedule: String,
    #[arg(long, env = "KS_STORAGE_BUCKET", default_value = "")]
    pub storage_bucket: String,
}
