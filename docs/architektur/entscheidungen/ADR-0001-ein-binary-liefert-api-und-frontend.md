---
id: ADR-0001
titel: Ein Rust-Binary mit axum liefert API und Frontend aus
status: akzeptiert
datum: 2026-05-23
gilt_fuer:
  - Cargo.toml
  - src/main.rs
  - src/app.rs
  - src/static_files.rs
  - Dockerfile
herleitung:
  - docs/superpowers/specs/2026-05-23-fundament-etb-kern-design.md
---

# ADR-0001: Ein Rust-Binary mit axum liefert API und Frontend aus

## Regeln

- MUST: Der Server ist genau ein Binary (`lifeline-hub`) auf axum; HTTP-API, Live-Strom und
  die statischen Dateien des Frontends kommen aus demselben Prozess.
- MUST: Das gebaute Frontend (`frontend/dist`) wird per `rust-embed` ins Binary eingebettet
  (`src/static_files.rs`) und über den Router-Fallback in `src/app.rs` ausgeliefert.
- MUST NOT: kein zweites Web-Framework (actix-web, rocket, warp, poem, salvo, tide) und kein
  separater Webserver als Pflichtbestandteil der Auslieferung.
- MUST: Das Container-Abbild startet nur dieses Binary (`Dockerfile`, `ENTRYPOINT`).
- SHOULD: Neue serverseitige Fähigkeiten kommen als Modul unter `src/` dazu, nicht als
  eigener Dienst; Ausnahme ist der Karten-Build ([ADR-0010](ADR-0010-offline-karten-aus-eigenem-build-service.md)).

## Prüfung

```sh
verlange '^axum = ' Cargo.toml
verbiete '^(actix-web|rocket|warp|poem|salvo|tide) *=' Cargo.toml
verlange '^#\[folder = "frontend/dist"\]' src/static_files.rs
verlange 'crate::static_files::serve' src/app.rs
verlange '^ENTRYPOINT \["/usr/local/bin/lifeline-hub"\]' Dockerfile
```

## Kontext

Eine Hilfsorganisation betreibt den Server ohne Fachpersonal, auf einem Mini-PC im ELW oder in
der Cloud. Das Fundament-Design verlangt deshalb ein einziges Artefakt: Binary starten, fertig.
Ein getrennter Webserver für das Frontend wäre ein zweites Teil, das jemand konfigurieren,
aktualisieren und absichern müsste.

## Konsequenzen

Auslieferung, Version und Rücksprung betreffen genau eine Datei; das Abbild ist distroless und
enthält nur das Binary. Dafür muss jeder Release-Bau das Frontend vorher bauen, sonst bettet er
einen veralteten Stand ein (`scripts/build-release.sh`). Frontend und Backend lassen sich nicht
getrennt ausrollen.
