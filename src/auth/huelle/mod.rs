//! Anmeldung der macOS-Hülle im Systembrowser (LFH-818): Einmalcode mit PKCE-Bindung.
//!
//! Der Browser stellt aus einer bestehenden Sitzung einen Code aus, gebunden an die
//! `challenge` der Hülle; die Hülle löst ihn mit dem `verifier` im Webview ein. Herleitung:
//! `openspec/changes/lfh-818-anmeldung-im-systembrowser/design.md`.

pub mod pkce;
pub mod state;

/// Anbieter-Kennung im Auth-Audit für die Einlösung eines Codes aus dem Browser.
pub const PROVIDER: &str = "systembrowser";
