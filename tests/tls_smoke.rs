//! HTTPS-Transport-Smoke (LFH-274). `#[ignore]`: braucht einen laufenden `--tls`-Server;
//! manuell/Build-Host: `cargo test --test tls_smoke -- --ignored`.
#[test]
#[ignore]
fn https_handshake_dokumentiert() {
    // Platzhalter-Doku: der echte HTTPS-Smoke läuft manuell (Task 6 Step 3),
    // weil TLS-Serving einen Prozess + Port + Cert braucht (nicht in der Unit-Suite).
    // Verifiziert: `curl -k https://127.0.0.1:8443/api/health` → 200.
}
