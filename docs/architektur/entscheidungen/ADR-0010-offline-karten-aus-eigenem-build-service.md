---
id: ADR-0010
titel: Offline-Karten baut ein eigener Karten-Service, der Server lädt sie nur herunter
status: akzeptiert
datum: 2026-07-05
gilt_fuer:
  - karten-service/**
  - karten-build/**
  - crates/karten-katalog/**
  - src/karte/download.rs
  - src/karte/katalog.rs
herleitung:
  - docs/superpowers/specs/2026-07-05-karten-region-build-service-design.md
  - docs/superpowers/specs/2026-07-04-offline-region-katalog-hybrid-design.md
  - openspec/changes/archive/2026-10-02-lfh-993-offline-karten-auto-aktualisierung/design.md
---

# ADR-0010: Offline-Karten baut ein eigener Karten-Service, der Server lädt sie nur herunter

## Regeln

- MUST: Regionen-Pakete (Shortbread-MBTiles) baut der eigenständige `karten-service` über
  `karten-build/`, legt sie in einen Objektspeicher und veröffentlicht ein Manifest.
- MUST NOT: der Server (`lifeline-hub`) startet zur Laufzeit keinen Container und baut keine
  Kacheln.
- MUST: Der Server lädt ein Paket nur über `src/karte/download.rs` (SSRF-Prüfung, Streaming)
  und prüft dabei den `sha256`-Pin des Katalogeintrags.
- MUST: Den Vertrag zwischen Server und Karten-Service tragen die Typen in
  `crates/karten-katalog`; keiner der beiden hängt vom anderen Crate ab.
- SHOULD: Der Katalog ist einkompilierter Grundbestand plus Remote-Manifest
  (`src/karte/katalog.rs`); fällt das Manifest aus, gilt der letzte Stand.

## Prüfung

```sh
verbiete 'Command::new\("(docker|podman)"' 'src/**/*.rs'
verbiete '^(lifeline-hub|karten-service) *=' Cargo.toml karten-service/Cargo.toml
verlange '^karten-katalog = ' Cargo.toml
verlange '^karten-katalog = ' karten-service/Cargo.toml
verlange 'Sha256' src/karte/download.rs
test -f karten-build/Makefile
```

## Kontext

Offline-Karten müssen im ELW ohne Internet vorliegen, ihr Bau braucht aber Docker, ein
Planetiler-Abbild und große OSM-Quelldaten (`karten-build/README.md`). Der erste Ansatz, den laufenden Server `docker run` anstoßen zu lassen,
wurde verworfen, weil er das Prinzip „ein Binary, kein Laufzeit-Docker“ bricht
([ADR-0001](ADR-0001-ein-binary-liefert-api-und-frontend.md)). Stattdessen baut ein zentral
gehosteter Dienst nach Zeitplan, und der Server bleibt Client.

## Konsequenzen

Der Server bleibt klein und braucht beim Betreiber weder Docker noch Kachel-Werkzeuge. Dafür ist
ein zweiter Dienst mit Objektspeicher zu betreiben, und ohne veröffentlichtes Manifest gibt es
keine lieferbaren Pakete ([Risiken](../11-risiken-und-technische-schulden.md)). Der Pin schützt
den Download gegen ausgetauschte Dateien.
