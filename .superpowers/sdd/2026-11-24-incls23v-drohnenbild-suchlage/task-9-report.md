# Task 9 Report (LLH-2107)
Status: DONE. Commit: see `git log -1` ("feat: Livebild der Drohne über einen bündelnden HLS-Proxy (LLH-2107)").
TDD RED: stubs with unimplemented!() -> `cargo test --lib drohne::video`: 0 passed, 9 failed. GREEN: 9 passed.
Integration `--test drohne_video`: 4 passed (video_ohne_zuschaltung_404, fremder_key_404, datei_mit_schrägstrich_404, ohne_zugang_503_ohne_seriennummer). `einsatz_kontext_guard` 1 passed. check-api-routen OK. `cargo check --tests` OK (one pre-existing dead_code warning in adapter_live).
Files: src/drohne/video.rs (new), src/drohne/mod.rs, src/routes/drohne.rs, src/app.rs, src/http_begrenzt.rs, scripts/api-routen-woerter.tsv, src/AGENTS.md, tests/drohne_video.rs.
Design: Buendel is a process-global (`video::buendel()`, OnceLock) rather than an AppState field, to avoid touching all AppState constructors. The fetch closure builds LiveKontext inside and drops it; cache stores only Bytes. Fetch runs as spawned task (continues if client aborts). Errors are not cached.
Concerns: (1) No test of the happy path against a real upstream (needs https + zielschutz); only the 404/503 paths and Buendel/playlist units. (2) Query on URIs inside playlists is allowed by check_playlist but the route discards queries. (3) Multi-level playlist URIs (subdirectories) are rejected by the route's flat filename rule; MediaMTX is flat. (4) Missing basis_url/token maps to 503. (5) A stale Buendel entry remains up to its TTL after abschalten (<=30 s).

## Fix (Review-Befunde 1 und 2)
Änderungen: `video::is_playlist` (Endung ohne Groß-/Kleinschreibung, über `endung`) ersetzt beide `ends_with(".m3u8")` in `routes/drohne.rs` (Deckel, Prüfung, Cache-Kopf). `drohne::is_safe_segment` (`[A-Za-z0-9._-]+`, nicht `.`/`..`) in `src/drohne/mod.rs`; `suchlage::parse_lage` verwirft Fluggerät und Video mit unsicherer `gateway_sn` und zählt in `verworfen`; `hls_abrufen` prüft `gateway_sn` und `file` vor dem URL-Bau erneut (Fehler Upstream = 502); `is_dateiname` nutzt das Prädikat (plus Verbot von `..` darin).
Tests: `drohne::tests::sicheres_segment`, `suchlage::tests::feindliche_seriennummer_wird_samt_video_verworfen`, `video::tests::ttl_nach_endung` (um `index.M3U8` und `is_playlist` erweitert).
Befehle (CARGO_INCREMENTAL=0): `cargo fmt`; `cargo test --lib drohne::`; `cargo test --test drohne_video`; `cargo check --tests`.
RED (Stubs mit todo!): `cargo test --lib drohne::` 28 passed, 3 failed (die drei Tests oben). GREEN: 31 passed; `--test drohne_video` 4 passed; `cargo check --tests` OK.
