# Auth-Provider-System — Increment 2 (HTTPS/TLS-Transport, Auto-Cert) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Einen optionalen HTTPS-Transport mit automatischer Cert-Beschaffung (BYO → Cache → mkcert → rcgen) einziehen, der lokales WebAuthn (secure context) freischaltet und bei HTTPS `Secure`-Cookies setzt — ohne den bestehenden HTTP-Bind zu verändern.

**Architecture:** Eine reine, unit-testbare **Cert-Auflösungslogik** wählt in Präzedenz die Cert-Quelle; der eigentliche `mkcert`-Aufruf liegt hinter einem Seam (Trait), damit die Entscheidung ohne externes Binary testbar ist. `main.rs` verzweigt beim Start: TLS aktiv → `axum-server` (`bind_rustls`) mit `Handle`-Graceful-Shutdown; sonst der unveränderte `axum::serve`-HTTP-Pfad. Der `Secure`-Cookie-Zustand wird über einen prozessweiten `OnceLock` (kein AppState-Feld) geführt, damit die vielen Inline-Test-Konstruktionen nicht brechen.

**Tech Stack:** Rust, axum 0.8, `axum-server` (feature `tls-rustls`), `rcgen` 0.14, rustls (via axum-server), `std::process::Command` (mkcert), clap.

## Global Constraints

- **HTTP-Pfad bleibt byte-identisch:** ist TLS nicht aktiv, läuft der bestehende `axum::serve`-Pfad unverändert. Kein Verhaltenswechsel ohne `--tls`.
- **Cert-Präzedenz (exakt):** 1) BYO (`LIFELINE_TLS_CERT`+`LIFELINE_TLS_KEY` gesetzt) → 2) gecachtes Cert+Key neben der DB gültig → 3) `mkcert` auf PATH → 4) `rcgen` self-signed. mkcert fehlt/scheitert → **sauberer Fallback auf rcgen** (kein harter Abbruch). Kaputte **BYO**-Konfig (Datei fehlt/ungültig) → **fail-fast**.
- **`mkcert -install`** (Trust-Store-mutierend) nur wenn `LIFELINE_TLS_MKCERT_INSTALL` (Default `true`); abschaltbar.
- **`Secure`-Cookie NUR bei aktivem HTTPS.** Kein AppState-Feld — prozessweiter `OnceLock<bool>` (Präzedenz: `clamav`-ScanConfig-OnceLock, LFH-114; „AppState-Feld bricht Test-Konstruktionen"). Default `false` → Bestandstests unberührt.
- **Testbarkeit:** die Auflösungs-/Präzedenzlogik ist rein und unit-getestet; der `mkcert`-Command-Aufruf und die Verfügbarkeitsprüfung liegen hinter einem Trait-Seam (in Tests gefälscht). TLS-Serving selbst ist NICHT unit-getestet (manueller HTTPS-Smoke).
- **rustls-CryptoProvider:** bei GENAU EINEM kompilierten Provider-Feature nutzt rustls 0.23 dessen Default automatisch — meist **kein** manuelles `install_default()`. Nur falls der HTTPS-Smoke mit „no process-level CryptoProvider" paniced: aktiviertes Feature ermitteln (`cargo tree -e features -p rustls`), `rustls` mit **genau diesem** Feature als Direkt-Dep ergänzen und den **passenden** `install_default()` aufrufen (Feature ↔ Aufruf müssen übereinstimmen). NICHT blind `ring` einbauen.
- **rcgen-API:** `CertifiedKey { cert, signing_key }` (Feld heißt `signing_key` ab 0.14; falls die aufgelöste Version 0.13 zieht, ist es `key_pair` — beim Kompilieren verifizieren, `cargo tree -p rcgen`).
- **Nicht abhängig von OIDC/WebAuthn** (Increment 3/4). Rust-Gate `cargo test`; `cargo fmt --all` pflegen. Migrationsnummer-Thema entfällt (keine Migration).

## File Structure

**Neu:**
- `src/tls/mod.rs` — Config→Plan-Auflösung (`CertQuelle`-Enum, `plane_cert`), Cache-Pfade, `MkcertSeam`-Trait + Real-Impl, `beschaffe_cert` (führt den Plan aus → `(cert_pem, key_pem)`).
- `tests/tls_smoke.rs` — `#[ignore]` HTTPS-Integrationssmoke (manuell/Build-Host), damit der Serve-Pfad dokumentiert-testbar ist.

**Geändert:**
- `Cargo.toml` — `axum-server` + `rcgen`.
- `src/config.rs` — TLS-Felder in `Config`.
- `src/lib.rs` — `pub mod tls;` (falls Module dort deklariert werden; sonst `main.rs`-lokal — Bestand prüfen).
- `src/auth/session.rs` — `COOKIE_SECURE`-OnceLock + `cookie_secure()`/`set_cookie_secure()`.
- `src/routes/auth.rs` — `session_cookie` setzt `.secure(session::cookie_secure())`.
- `src/main.rs` — Start-Verzweigung HTTP vs. HTTPS; CryptoProvider-Install; `set_cookie_secure`.
- `docs/` — kurze mkcert-Dev-Setup-Notiz.

---

## Task 1: Dependencies + TLS-Config-Flags

**Files:**
- Modify: `Cargo.toml`
- Modify: `src/config.rs` (Config-Struct + ein Parse-Test)

**Interfaces:**
- Produces: `Config`-Felder `tls: bool`, `tls_cert: Option<String>`, `tls_key: Option<String>`, `tls_mkcert_install: bool`, `tls_hostname: Option<String>`.

- [ ] **Step 1: Crates ergänzen**

In `Cargo.toml` unter `[dependencies]`:

```toml
axum-server = { version = "0.7", features = ["tls-rustls"] }
rcgen = "0.14"
```

- [ ] **Step 2: Failing config-Test schreiben**

In `src/config.rs` im `#[cfg(test)] mod tests` ergänzen:

```rust
#[test]
fn tls_defaults_und_flags() {
    let c = Config::parse_from(["lifeline-hub"]);
    assert!(!c.tls, "TLS ist per Default aus (HTTP-Bestand)");
    assert!(c.tls_mkcert_install, "mkcert-install Default an");
    assert!(c.tls_cert.is_none() && c.tls_key.is_none());

    let c = Config::parse_from([
        "lifeline-hub", "--tls", "--tls-cert", "/c.pem", "--tls-key", "/k.pem",
        "--tls-hostname", "elw.local",
    ]);
    assert!(c.tls);
    assert_eq!(c.tls_cert.as_deref(), Some("/c.pem"));
    assert_eq!(c.tls_key.as_deref(), Some("/k.pem"));
    assert_eq!(c.tls_hostname.as_deref(), Some("elw.local"));
}
```

- [ ] **Step 3: Config-Felder ergänzen**

In `src/config.rs`, im `Config`-Struct (nach den `clamav_*`-Feldern, gleicher `#[arg(...)]`-Stil):

```rust
    /// HTTPS statt HTTP bedienen. Ohne Flag bleibt der bestehende HTTP-Bind aktiv
    /// (Dev/localhost). Mit `--tls` wird ein Server-Cert in Präzedenz beschafft
    /// (BYO → Cache → mkcert → rcgen) und `Secure`-Cookies aktiviert.
    #[arg(long, env = "LIFELINE_TLS", default_value_t = false)]
    pub tls: bool,

    /// BYO-Zertifikat (PEM). Nur zusammen mit `--tls-key`. Gesetzt → höchste Präzedenz;
    /// fehlend/ungültig → fail-fast (kein stiller Fallback bei explizitem BYO).
    #[arg(long, env = "LIFELINE_TLS_CERT")]
    pub tls_cert: Option<String>,

    /// BYO-Private-Key (PEM), Partner von `--tls-cert`.
    #[arg(long, env = "LIFELINE_TLS_KEY")]
    pub tls_key: Option<String>,

    /// Bei mkcert-Nutzung die lokale CA per `mkcert -install` sicherstellen
    /// (mutiert den System-/Browser-Trust-Store, ggf. sudo). Default an, abschaltbar.
    #[arg(long, env = "LIFELINE_TLS_MKCERT_INSTALL", default_value_t = true)]
    pub tls_mkcert_install: bool,

    /// Optionaler zusätzlicher Hostname als SAN im generierten Cert (mkcert/rcgen),
    /// z.B. der DNS-/mDNS-Name des ELW-Servers. localhost + Bind-IP sind immer dabei.
    #[arg(long, env = "LIFELINE_TLS_HOSTNAME")]
    pub tls_hostname: Option<String>,
```

- [ ] **Step 4: Test + Build**

Run: `cargo test --lib config::tests::tls_defaults_und_flags` → PASS. `cargo build` (zieht neue Crates).

- [ ] **Step 5: fmt + commit**

```bash
cargo fmt --all
git add Cargo.toml Cargo.lock src/config.rs
git commit -m "feat(lfh-274): TLS-Config-Flags + axum-server/rcgen-Dependencies"
```

---

## Task 2: Cert-Auflösungslogik (rein, testbar) + mkcert-Seam

**Files:**
- Create: `src/tls/mod.rs`
- Modify: `src/lib.rs` bzw. `src/main.rs` (Modul-Deklaration — Bestand prüfen: `grep -n "pub mod" src/lib.rs`)

**Interfaces:**
- Produces:
  - `pub enum CertQuelle { Byo { cert: String, key: String }, Cache, Mkcert, Rcgen }`
  - `pub struct CertPlan { pub quelle: CertQuelle, pub sans: Vec<String> }`
  - `pub trait MkcertSeam { fn verfuegbar(&self) -> bool; }` (nur die Verfügbarkeit; Ausführung in Task 4).
  - `pub fn plane_cert(tls_cert: Option<&str>, tls_key: Option<&str>, cache_vorhanden: bool, mkcert: &dyn MkcertSeam, sans: Vec<String>) -> CertPlan`

- [ ] **Step 1: Modul deklarieren**

`grep -n "pub mod" src/lib.rs` — falls dort die Module gelistet sind, `pub mod tls;` alphabetisch ergänzen; sonst in `src/main.rs`/wo die `mod`-Deklarationen stehen. (Bestand folgen, nicht raten.)

- [ ] **Step 2: Failing tests schreiben**

`src/tls/mod.rs`:

```rust
//! HTTPS-Transport (LFH-274): Cert-Beschaffung in Präzedenz BYO→Cache→mkcert→rcgen.
//! Die Auflösung ist rein/testbar; der mkcert-Aufruf liegt hinter `MkcertSeam`.

/// Gewählte Cert-Quelle (Ergebnis der Präzedenz-Auflösung).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CertQuelle {
    /// Bring-your-own: explizite PEM-Pfade.
    Byo { cert: String, key: String },
    /// Gültiges Cert bereits im Cache neben der DB.
    Cache,
    /// Über mkcert erzeugen (CA lokal vertrauenswürdig).
    Mkcert,
    /// self-signed via rcgen (Fallback).
    Rcgen,
}

/// Auflösungsplan inkl. der SANs, die ein neu erzeugtes Cert tragen soll.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CertPlan {
    pub quelle: CertQuelle,
    pub sans: Vec<String>,
}

/// Seam für die mkcert-Verfügbarkeit (Real-Impl prüft PATH; Tests fälschen).
pub trait MkcertSeam {
    fn verfuegbar(&self) -> bool;
}

/// Wählt die Cert-Quelle in Präzedenz. BYO nur, wenn BEIDE Pfade gesetzt sind
/// (Teil-Konfig behandelt der Aufrufer als fail-fast, s. Task 5/6).
pub fn plane_cert(
    tls_cert: Option<&str>,
    tls_key: Option<&str>,
    cache_vorhanden: bool,
    mkcert: &dyn MkcertSeam,
    sans: Vec<String>,
) -> CertPlan {
    let quelle = match (tls_cert, tls_key) {
        (Some(c), Some(k)) => CertQuelle::Byo { cert: c.to_string(), key: k.to_string() },
        _ if cache_vorhanden => CertQuelle::Cache,
        _ if mkcert.verfuegbar() => CertQuelle::Mkcert,
        _ => CertQuelle::Rcgen,
    };
    CertPlan { quelle, sans }
}

#[cfg(test)]
mod tests {
    use super::*;

    struct FakeMkcert(bool);
    impl MkcertSeam for FakeMkcert {
        fn verfuegbar(&self) -> bool { self.0 }
    }
    fn sans() -> Vec<String> { vec!["localhost".into(), "127.0.0.1".into()] }

    #[test]
    fn byo_hat_hoechste_praezedenz() {
        let p = plane_cert(Some("/c.pem"), Some("/k.pem"), true, &FakeMkcert(true), sans());
        assert_eq!(p.quelle, CertQuelle::Byo { cert: "/c.pem".into(), key: "/k.pem".into() });
    }

    #[test]
    fn cache_vor_mkcert() {
        let p = plane_cert(None, None, true, &FakeMkcert(true), sans());
        assert_eq!(p.quelle, CertQuelle::Cache);
    }

    #[test]
    fn mkcert_wenn_verfuegbar_und_kein_cache() {
        let p = plane_cert(None, None, false, &FakeMkcert(true), sans());
        assert_eq!(p.quelle, CertQuelle::Mkcert);
    }

    #[test]
    fn rcgen_fallback_wenn_kein_mkcert() {
        let p = plane_cert(None, None, false, &FakeMkcert(false), sans());
        assert_eq!(p.quelle, CertQuelle::Rcgen);
    }

    #[test]
    fn teil_byo_faellt_nicht_auf_byo() {
        // Nur cert, kein key → NICHT Byo (der Aufrufer macht daraus fail-fast).
        let p = plane_cert(Some("/c.pem"), None, false, &FakeMkcert(false), sans());
        assert_eq!(p.quelle, CertQuelle::Rcgen);
    }
}
```

- [ ] **Step 3: Test + commit**

Run: `cargo test --lib tls::tests` → PASS (5 Tests).

```bash
cargo fmt --all
git add src/tls/ src/lib.rs
git commit -m "feat(lfh-274): reine Cert-Präzedenz-Auflösung + mkcert-Seam"
```

---

## Task 3: rcgen self-signed + Cache-Lese/Schreiblogik

**Files:**
- Modify: `src/tls/mod.rs` (`cache_pfade`, `rcgen_erzeugen`, `cache_gueltig`)

**Interfaces:**
- Consumes: `CertPlan`.
- Produces:
  - `pub fn cache_pfade(db_path: &str) -> (std::path::PathBuf, std::path::PathBuf)` (cert, key neben der DB).
  - `pub fn rcgen_pem(sans: &[String]) -> Result<(String, String), AppError>` → (cert_pem, key_pem).
  - `pub fn cache_gueltig(cert: &std::path::Path, key: &std::path::Path) -> bool` (existieren + nicht leer; Ablauf-Prüfung optional, s.u.).

- [ ] **Step 1: Failing tests schreiben** (ans `tests`-Modul in `src/tls/mod.rs` anhängen)

```rust
    #[test]
    fn rcgen_liefert_pem_paar() {
        let (cert, key) = super::rcgen_pem(&["localhost".to_string(), "127.0.0.1".to_string()]).unwrap();
        assert!(cert.contains("BEGIN CERTIFICATE"));
        assert!(key.contains("PRIVATE KEY"));
    }

    #[test]
    fn cache_pfade_liegen_neben_der_db() {
        let (c, k) = super::cache_pfade("/data/lifeline.db");
        assert_eq!(c.parent().unwrap().to_str().unwrap(), "/data");
        assert!(c.file_name().unwrap().to_str().unwrap().ends_with(".pem"));
        assert_ne!(c, k);
    }

    #[test]
    fn cache_gueltig_nur_wenn_beide_dateien_da() {
        let dir = std::env::temp_dir().join(format!("lfh-tls-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let c = dir.join("c.pem"); let k = dir.join("k.pem");
        assert!(!super::cache_gueltig(&c, &k));
        std::fs::write(&c, "x").unwrap();
        assert!(!super::cache_gueltig(&c, &k), "nur cert reicht nicht");
        std::fs::write(&k, "y").unwrap();
        assert!(super::cache_gueltig(&c, &k));
        std::fs::remove_dir_all(&dir).ok();
    }
```

- [ ] **Step 2: Implementieren** (in `src/tls/mod.rs`, oben ergänzen; `use crate::error::AppError;`)

```rust
use std::path::{Path, PathBuf};

/// Cert-/Key-Cache-Pfade neben der DB-Datei.
pub fn cache_pfade(db_path: &str) -> (PathBuf, PathBuf) {
    let dir = Path::new(db_path).parent().unwrap_or_else(|| Path::new("."));
    (dir.join("lifeline-tls-cert.pem"), dir.join("lifeline-tls-key.pem"))
}

/// self-signed Cert+Key (PEM) via rcgen für die gegebenen SANs.
pub fn rcgen_pem(sans: &[String]) -> Result<(String, String), AppError> {
    let rcgen::CertifiedKey { cert, signing_key } =
        rcgen::generate_simple_self_signed(sans.to_vec())
            .map_err(|e| AppError::Internal(format!("rcgen: {e}")))?;
    Ok((cert.pem(), signing_key.serialize_pem()))
}

/// Cache gültig, wenn beide Dateien existieren und nicht leer sind.
/// (Ablauf-Prüfung bewusst weggelassen: rcgen-Certs laufen bis 4096; BYO/mkcert
/// verwaltet der Operator. Re-Erzeugung erzwingt man durch Löschen der Cache-Dateien.)
pub fn cache_gueltig(cert: &Path, key: &Path) -> bool {
    let nichtleer = |p: &Path| std::fs::metadata(p).map(|m| m.len() > 0).unwrap_or(false);
    nichtleer(cert) && nichtleer(key)
}
```

- [ ] **Step 3: Test + commit**

Run: `cargo test --lib tls::tests` → PASS (jetzt 8 Tests).

```bash
cargo fmt --all
git add src/tls/mod.rs
git commit -m "feat(lfh-274): rcgen-PEM-Erzeugung + Cache-Pfade/Gültigkeit"
```

---

## Task 4: mkcert-Integration (Command-Seam Real-Impl) + Beschaffung

**Files:**
- Modify: `src/tls/mod.rs` (`RealMkcert`, `mkcert_erzeugen`, `beschaffe_cert`)

**Interfaces:**
- Consumes: `plane_cert`, `rcgen_pem`, `cache_pfade`, `cache_gueltig`.
- Produces: `pub async fn beschaffe_cert(cfg: &crate::config::Config, sans: Vec<String>) -> Result<(PathBuf, PathBuf), AppError>` — liefert die zu ladenden PEM-Pfade (BYO-Pfade oder Cache-Pfade nach Erzeugung). `pub struct RealMkcert;` mit PATH-Check.

- [ ] **Step 1: Failing test (Command-Konstruktion, ohne echtes mkcert)**

Der echte mkcert-Lauf ist nicht unit-testbar; testbar ist die **Argument-Konstruktion**. In `src/tls/mod.rs`:

```rust
    #[test]
    fn mkcert_args_enthalten_alle_sans() {
        let args = super::mkcert_args(
            &std::path::PathBuf::from("/tmp/c.pem"),
            &std::path::PathBuf::from("/tmp/k.pem"),
            &["localhost".to_string(), "127.0.0.1".to_string(), "elw.local".to_string()],
        );
        // -cert-file /tmp/c.pem -key-file /tmp/k.pem localhost 127.0.0.1 elw.local
        assert!(args.iter().any(|a| a == "-cert-file"));
        assert!(args.iter().any(|a| a == "/tmp/c.pem"));
        assert!(args.iter().any(|a| a == "elw.local"));
        assert_eq!(args.last().unwrap(), "elw.local");
    }
```

- [ ] **Step 2: Implementieren** (`use std::process::Command;`)

```rust
/// PATH-basierte mkcert-Verfügbarkeit (Real-Seam).
pub struct RealMkcert;
impl MkcertSeam for RealMkcert {
    fn verfuegbar(&self) -> bool {
        Command::new("mkcert").arg("-CAROOT").output().map(|o| o.status.success()).unwrap_or(false)
    }
}

/// Argumentliste für `mkcert -cert-file <c> -key-file <k> <san…>`.
fn mkcert_args(cert: &Path, key: &Path, sans: &[String]) -> Vec<String> {
    let mut a = vec![
        "-cert-file".to_string(), cert.to_string_lossy().into_owned(),
        "-key-file".to_string(), key.to_string_lossy().into_owned(),
    ];
    a.extend(sans.iter().cloned());
    a
}

/// Führt mkcert aus (optional vorher `-install`), schreibt cert/key in den Cache.
fn mkcert_erzeugen(cert: &Path, key: &Path, sans: &[String], install: bool) -> Result<(), AppError> {
    if install {
        // Best-effort: CA sicherstellen. Fehler hier NICHT hart (Cert-Gen kann trotzdem klappen).
        let _ = Command::new("mkcert").arg("-install").status();
    }
    let status = Command::new("mkcert")
        .args(mkcert_args(cert, key, sans))
        .status()
        .map_err(|e| AppError::Internal(format!("mkcert exec: {e}")))?;
    if !status.success() {
        return Err(AppError::Internal("mkcert schlug fehl".into()));
    }
    Ok(())
}

/// Beschafft ein Cert nach Präzedenz und liefert die zu ladenden PEM-Pfade.
/// BYO mit fehlender Datei → fail-fast. mkcert-Fehler → Fallback rcgen (Cache).
pub async fn beschaffe_cert(
    cfg: &crate::config::Config,
    sans: Vec<String>,
) -> Result<(PathBuf, PathBuf), AppError> {
    // Teil-BYO (nur eine Hälfte gesetzt) ist Fehlkonfiguration → fail-fast.
    match (cfg.tls_cert.as_deref(), cfg.tls_key.as_deref()) {
        (Some(_), None) | (None, Some(_)) => {
            return Err(AppError::Internal(
                "--tls-cert und --tls-key müssen gemeinsam gesetzt sein".into(),
            ));
        }
        _ => {}
    }
    let (cache_cert, cache_key) = cache_pfade(&cfg.db_path);
    let plan = plane_cert(
        cfg.tls_cert.as_deref(),
        cfg.tls_key.as_deref(),
        cache_gueltig(&cache_cert, &cache_key),
        &RealMkcert,
        sans.clone(),
    );
    match plan.quelle {
        CertQuelle::Byo { cert, key } => {
            let (cp, kp) = (PathBuf::from(&cert), PathBuf::from(&key));
            if !cache_gueltig(&cp, &kp) {
                return Err(AppError::Internal(format!(
                    "BYO-Cert/Key nicht lesbar: {cert} / {key}"
                )));
            }
            Ok((cp, kp))
        }
        CertQuelle::Cache => Ok((cache_cert, cache_key)),
        CertQuelle::Mkcert => {
            match mkcert_erzeugen(&cache_cert, &cache_key, &plan.sans, cfg.tls_mkcert_install) {
                Ok(()) => Ok((cache_cert, cache_key)),
                Err(e) => {
                    tracing::warn!("mkcert fehlgeschlagen ({e}) — Fallback rcgen");
                    let (c, k) = rcgen_pem(&plan.sans)?;
                    std::fs::write(&cache_cert, c).map_err(|e| AppError::Internal(e.to_string()))?;
                    std::fs::write(&cache_key, k).map_err(|e| AppError::Internal(e.to_string()))?;
                    Ok((cache_cert, cache_key))
                }
            }
        }
        CertQuelle::Rcgen => {
            let (c, k) = rcgen_pem(&plan.sans)?;
            std::fs::write(&cache_cert, c).map_err(|e| AppError::Internal(e.to_string()))?;
            std::fs::write(&cache_key, k).map_err(|e| AppError::Internal(e.to_string()))?;
            Ok((cache_cert, cache_key))
        }
    }
}
```

- [ ] **Step 3: Test + commit**

Run: `cargo test --lib tls::tests` → PASS (9 Tests). `cargo build`.

```bash
cargo fmt --all
git add src/tls/mod.rs
git commit -m "feat(lfh-274): mkcert-Beschaffung + Präzedenz-Ausführung mit rcgen-Fallback"
```

---

## Task 5: Secure-Cookie-OnceLock + session_cookie-Verdrahtung

**Files:**
- Modify: `src/auth/session.rs` (OnceLock + Getter/Setter)
- Modify: `src/routes/auth.rs` (`session_cookie` liest `cookie_secure()`)

**Interfaces:**
- Produces: `pub fn set_cookie_secure(v: bool)` (idempotent-ish, `OnceLock::set` ignoriert Doppelsetzen), `pub fn cookie_secure() -> bool` (Default `false`). `session_cookie(token: String, secure: bool)` wird **pur** (Secure als Parameter, NICHT intern aus dem OnceLock) — der Caller liest `cookie_secure()`.

- [ ] **Step 1: Failing tests schreiben** (zwei Stellen — pure Cookie-Funktion diskriminierend, Getter-Default separat)

Warum pur: läse `session_cookie` den OnceLock intern, wäre der `Secure=true`-Zweig nicht diskriminierend testbar (der prozessglobale OnceLock ist in Unit-Tests nie gesetzt). Deshalb Secure als Parameter; der OnceLock bleibt der Startup-Global, den der **Caller** liest.

In `src/routes/auth.rs` (neues `#[cfg(test)] mod tests` mit `use super::*;`):

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn session_cookie_secure_folgt_parameter() {
        // Diskriminierend: beide Zweige geprüft (kein OnceLock im Test).
        assert_eq!(session_cookie("t".into(), true).secure(), Some(true));
        assert_ne!(session_cookie("t".into(), false).secure(), Some(true));
    }
}
```

In `src/auth/session.rs` `#[cfg(test)] mod tests` (Getter-Default; dieser Test darf `set_cookie_secure` NICHT aufrufen):

```rust
    #[test]
    fn cookie_secure_default_false() {
        assert!(!cookie_secure());
    }
```

- [ ] **Step 2: OnceLock implementieren** (`src/auth/session.rs`, oben)

```rust
use std::sync::OnceLock;

/// Prozessweiter `Secure`-Cookie-Schalter (nur bei aktivem HTTPS `true`).
/// OnceLock statt AppState-Feld: bricht keine der vielen Inline-Test-Konstruktionen
/// (Präzedenz: clamav-ScanConfig-OnceLock, LFH-114). Default (ungesetzt) = false.
static COOKIE_SECURE: OnceLock<bool> = OnceLock::new();

/// Einmalig beim Serverstart setzen (true bei HTTPS). Doppelsetzen wird ignoriert.
pub fn set_cookie_secure(v: bool) {
    let _ = COOKIE_SECURE.set(v);
}

/// Ob Session-Cookies `Secure` tragen sollen (Default false → HTTP-Betrieb).
pub fn cookie_secure() -> bool {
    *COOKIE_SECURE.get().unwrap_or(&false)
}
```

- [ ] **Step 3: `session_cookie` pur machen + Caller verdrahten** (`src/routes/auth.rs`)

`session_cookie` bekommt `secure` als Parameter (pur, testbar); der einzige Caller (`login`) liest den OnceLock:

```rust
fn session_cookie(token: String, secure: bool) -> Cookie<'static> {
    Cookie::build((SESSION_COOKIE, token))
        .http_only(true)
        .same_site(SameSite::Lax)
        .secure(secure)
        .path("/")
        .build()
}
```

Im `login`-Handler den Aufruf anpassen (der Cookie-Wert kommt aus dem Startup-Global):

```rust
    let jar = jar.add(session_cookie(token, crate::auth::session::cookie_secure()));
```

Den bewussten Kommentar über `session_cookie` aktualisieren: `Secure` folgt jetzt dem Transport (HTTPS → an, HTTP → aus), gesteuert vom Aufrufer. `logout` baut weiterhin nur den Lösch-Cookie (`path("/")`, kein Secure nötig) — unverändert.

- [ ] **Step 4: Test + Bestandstests grün**

Run: `cargo test --lib auth::session` → PASS. `cargo test --test auth` (Login-Cookie-Pfad unverändert: Default false, kein Secure → Tests unberührt).

- [ ] **Step 5: fmt + commit**

```bash
cargo fmt --all
git add src/auth/session.rs src/routes/auth.rs
git commit -m "feat(lfh-274): Secure-Cookie via prozessweiten OnceLock (HTTPS-gebunden)"
```

---

## Task 6: Server-Bootstrap — HTTPS-Verzweigung in main.rs

**Files:**
- Modify: `src/main.rs` (`run_server`: TLS-Zweig; CryptoProvider-Install; `set_cookie_secure`)

**Interfaces:**
- Consumes: `tls::beschaffe_cert`, `auth::session::set_cookie_secure`, `axum_server`, `RustlsConfig`.

- [ ] **Step 1: SAN-Ableitung + Verzweigung implementieren**

In `src/main.rs::run_server`, den Block `let listener = … axum::serve(…)` (aktuell Zeilen ~123-128) ersetzen durch:

```rust
    if config.tls {
        // CryptoProvider: rustls 0.23 nutzt bei GENAU EINEM kompilierten Provider-Feature dessen
        // Default automatisch — meist KEIN manueller install_default() nötig. Hier bewusst KEINE
        // hartkodierte Provider-Zeile (siehe Step 2 „CryptoProvider-Fall" für den Ernstfall).

        // SANs: localhost + Bind-IP + optionaler Hostname.
        let bind_ip = config.bind.split(':').next().unwrap_or("127.0.0.1").to_string();
        let mut sans = vec!["localhost".to_string(), "127.0.0.1".to_string()];
        if bind_ip != "127.0.0.1" && bind_ip != "localhost" && !bind_ip.is_empty() {
            sans.push(bind_ip);
        }
        if let Some(h) = &config.tls_hostname {
            sans.push(h.clone());
        }

        let (cert_pfad, key_pfad) = lifeline_hub::tls::beschaffe_cert(&config, sans).await?;
        let tls_config =
            axum_server::tls_rustls::RustlsConfig::from_pem_file(&cert_pfad, &key_pfad).await?;

        lifeline_hub::auth::session::set_cookie_secure(true);

        // Achtung: anders als der HTTP-Pfad (`TcpListener::bind` = ToSocketAddrs, löst Hostnamen)
        // erwartet axum-server eine `SocketAddr`. `--bind <hostname>:<port>` funktioniert daher NUR
        // im HTTP-Modus; unter `--tls` muss `--bind` IP:Port sein (Default 127.0.0.1:8080 ist ok).
        let addr: std::net::SocketAddr = config
            .bind
            .parse()
            .map_err(|e| anyhow::anyhow!("--bind muss unter --tls IP:Port sein (kein Hostname): {e}"))?;
        tracing::info!("Server (HTTPS) lauscht auf {}", addr);

        let handle = axum_server::Handle::new();
        let h2 = handle.clone();
        tokio::spawn(async move {
            shutdown_signal().await;
            h2.graceful_shutdown(Some(std::time::Duration::from_secs(10)));
        });
        axum_server::bind_rustls(addr, tls_config)
            .handle(handle)
            .serve(app.into_make_service())
            .await?;
    } else {
        // Unveränderter HTTP-Bestandspfad.
        let listener = tokio::net::TcpListener::bind(&config.bind).await?;
        tracing::info!("Server lauscht auf {}", config.bind);
        axum::serve(listener, app)
            .with_graceful_shutdown(shutdown_signal())
            .await?;
    }

    Ok(())
```

Keine `rustls::…`-Imports blind einbauen — der Code oben nutzt nur `axum_server::…`. Ob `rustls` als direkte Dependency + ein `install_default()` nötig wird, entscheidet erst der Laufzeit-Smoke (Step 3).

- [ ] **Step 2: Build + HTTP-Bestand grün + CryptoProvider-Fall**

Run: `cargo build`. Dann `cargo tree -p rcgen` (pin 0.14 bestätigen → Feld heißt `signing_key`; bei 0.13 → `key_pair` in Task 3 anpassen).
HTTP-Pfad unverändert testbar: `cargo test --test auth` (nutzt `build_router`, nicht `run_server` — kein Kollateralschaden) + `cargo test --lib`.

**CryptoProvider-Fall (nur falls der HTTPS-Smoke in Step 3 mit „no process-level CryptoProvider" paniced):**
1. `cargo tree -e features -p rustls | grep -E 'aws-lc-rs|ring'` → zeigt das tatsächlich aktivierte Provider-Feature.
2. `rustls = "0.23"` mit **genau diesem** Feature als direkte Dependency in `Cargo.toml` ergänzen.
3. Vor dem Serve `let _ = rustls::crypto::<provider>::default_provider().install_default();` mit **demselben** Provider aufrufen (`<provider>` = `aws_lc_rs` bzw. `ring`). Dependency-Feature und Install-Aufruf MÜSSEN übereinstimmen.
Meist ist das nicht nötig (ein Provider-Feature → Auto-Default).

- [ ] **Step 3: Manueller HTTPS-Smoke (nicht CI)**

```bash
cargo run -- --tls --db-path /tmp/lfh-tls.db --bind 127.0.0.1:8443 &
sleep 3
curl -k https://127.0.0.1:8443/api/health   # erwartet: 200/ok über TLS
curl -k -I https://127.0.0.1:8443/api/auth/me  # 401, aber TLS-Handshake ok
kill %1
```
Erwartet: TLS-Handshake klappt (self-signed via rcgen, da mkcert im CI evtl. fehlt), `/api/health` antwortet. Cert-/Key-Dateien liegen neben `/tmp/lfh-tls.db`.

- [ ] **Step 4: fmt + commit**

```bash
cargo fmt --all
git add src/main.rs Cargo.toml Cargo.lock
git commit -m "feat(lfh-274): HTTPS-Serve-Zweig (axum-server/rustls) + Secure-Cookie-Aktivierung"
```

---

## Task 7: Dev-Doku (mkcert) + Voll-Gate + Abschluss

**Files:**
- Create/Modify: eine kurze Notiz (z.B. `docs/betrieb-tls.md` oder Abschnitt in vorhandener Doku — Bestand prüfen)
- Create: `tests/tls_smoke.rs` (`#[ignore]`-Doku-Smoke)

- [ ] **Step 1: `#[ignore]`-Smoke-Test dokumentieren**

`tests/tls_smoke.rs`:

```rust
//! HTTPS-Transport-Smoke (LFH-274). `#[ignore]`: braucht einen laufenden `--tls`-Server;
//! manuell/Build-Host: `cargo test --test tls_smoke -- --ignored`.
#[test]
#[ignore]
fn https_handshake_dokumentiert() {
    // Platzhalter-Doku: der echte HTTPS-Smoke läuft manuell (Task 6 Step 3),
    // weil TLS-Serving einen Prozess + Port + Cert braucht (nicht in der Unit-Suite).
    // Verifiziert: `curl -k https://127.0.0.1:8443/api/health` → 200.
}
```

- [ ] **Step 2: mkcert-Dev-Notiz**

Kurze Doku (Bestandsdoku-Ort prüfen; sonst `docs/betrieb-tls.md`): mkcert für Dev/LAN — `mkcert -install` einmalig; für LAN-Tablets die Root-CA (`mkcert -CAROOT`) ausrollen; BYO via `LIFELINE_TLS_CERT/_KEY`; ohne mkcert fällt der Server auf rcgen-self-signed zurück (Browser-Warnung erwartbar).

- [ ] **Step 3: Voll-Gate (Controller fährt es; hier als Abschluss-Checkliste)**

```bash
env -u LIFELINE_DOWNLOAD_ALLOW_LOOPBACK -u LIFELINE_OFFLINE_KATALOG_MANIFEST_URL -u AWS_ALLOW_HTTP cargo test
```
Erwartet: grün. Manueller HTTPS-Smoke (Task 6 Step 3) einmal ausführen.

- [ ] **Step 4: commit**

```bash
git add tests/tls_smoke.rs docs/
git commit -m "docs(lfh-274): mkcert-Dev-Setup + HTTPS-Smoke-Doku"
```

---

## Self-Review

**Spec coverage (Design Sektion 4):**
- BYO → Cache → mkcert → rcgen Präzedenz → Task 2 (`plane_cert`) + Task 4 (`beschaffe_cert`). ✓
- mkcert `-install` hinter `LIFELINE_TLS_MKCERT_INSTALL` → Task 1 (Flag) + Task 4 (`mkcert_erzeugen(install)`). ✓
- Cert neben DB cachen, Auto-Renew durch Löschen → Task 3 (`cache_pfade`/`cache_gueltig`). (Zeit-Renew bewusst weggelassen — im Code kommentiert.) ✓
- mkcert fehlt/scheitert → rcgen-Fallback (kein harter Abbruch) → Task 4 (`Mkcert`-Zweig `Err` → rcgen). ✓
- BYO kaputt → fail-fast → Task 4 (Teil-BYO + unlesbares BYO → `Err`). ✓
- Secure-Cookie nur bei HTTPS → Task 5 (OnceLock) + Task 6 (`set_cookie_secure(true)` nur im TLS-Zweig). ✓
- HTTP bleibt Bind-Option, unverändert → Task 6 (`else`-Zweig byte-identisch). ✓
- SANs localhost+Bind-IP+Hostname → Task 6 (SAN-Ableitung). ✓
- Testbare Auflösung, Command hinter Seam → Task 2 (`MkcertSeam`) + Task 4 (`mkcert_args`-Test). ✓
- Caveat LAN-Trust/Prod → Task 7 (Doku). ✓

**Placeholder-Scan:** Konkrete Codeblöcke. Zwei bewusste „Bestand prüfen"-Hinweise (Modul-Deklarationsort Task 2, Doku-Ort Task 7) — begründet, weil die exakte Stelle im Repo liegt. Ein bekannter API-Drift-Punkt (rcgen `signing_key` vs `key_pair`; ggf. direkte `rustls`-Dependency) ist in Global Constraints + Task 6 Step 1 explizit als beim-Kompilieren-verifizieren markiert (kein blindes Placeholder).

**Type-Konsistenz:** `CertQuelle`/`CertPlan`/`MkcertSeam`/`plane_cert`/`beschaffe_cert`/`cache_pfade`/`rcgen_pem`/`cache_gueltig`/`mkcert_args`/`set_cookie_secure`/`cookie_secure` durchgängig gleich benannt zwischen Tasks. `beschaffe_cert` liefert `(PathBuf, PathBuf)`, von Task 6 an `RustlsConfig::from_pem_file` gereicht (Pfad-basiert, konsistent).

## Offene Punkte (bewusst, nicht blockierend)
- Direkte `rustls`-Dependency nur im CryptoProvider-Ernstfall nötig (Task 6 Step 2), und dann mit dem Feature, das zum `install_default()`-Provider passt. Standard: gar keine rustls-Direkt-Dep, kein `install_default()`.
- Cert-Ablauf-Renew: v1 durch Cache-Löschen. Ein `--tls-cert-erneuern`-Trigger (Design) ist additiv nachrüstbar, hier nicht enthalten (YAGNI).
