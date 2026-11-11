---
id: ADR-0019
titel: Beta zählt neben Alpha und bekommt nur veröffentlichte Alpha-Tags über einen Nachzug
status: akzeptiert
datum: 2026-11-11
gilt_fuer:
  - release.config.mjs
  - scripts/release/kanal-nachziehen.sh
  - scripts/release/desktop-kanal.mjs
  - scripts/release/abbild-kanal.mjs
  - src-tauri/src/kanal.rs
  - .github/workflows/kanal-nachziehen.yml
  - .github/workflows/artefakte.yml
herleitung:
  - Zunder LLH-1545 (Entwurf und Probelauf, freigegeben von Ruben am 11.11.2026)
---

# ADR-0019: Beta zählt neben Alpha und bekommt nur veröffentlichte Alpha-Tags über einen Nachzug

## Regeln

- MUST: `beta` zählt `X.Y.Z-beta.N`, `alpha` zählt daneben `X.Y.Z-alpha.N` weiter; kein Tag von
  Hand, um Alpha auf eine höhere Version zu heben.
- MUST: Ein Stand kommt nach `beta` nur über `scripts/release/kanal-nachziehen.sh` (Workflow
  „Beta nachziehen“) und nur als veröffentlichter Alpha-Tag.
- MUST NOT: Auf `beta` wird nicht entwickelt, nichts wird von `beta` nach `alpha` gemergt.
  Fehler werden auf `alpha` behoben und mit dem nächsten Alpha-Tag nachgezogen.
- MUST NOT: Kein `git push origin alpha:beta` und kein Force-Push auf `beta`.
- MUST: Jeder Vorabkanal der Desktop-Hülle und jeder gleitende Abbild-Tag führt nur Releases
  seines Kanals (`desktop-kanal.mjs`, `abbild-kanal.mjs`); stabile Releases gehen in beide
  Desktop-Kanäle.
- MUST NOT: Beta-Releases legen kein Deployment an; Rubens Server bleibt auf Alpha.

## Prüfung

```sh
verlange "name: 'beta', prerelease: true" release.config.mjs
verlange 'chore\(\$ZIEL\): Versionsdateien' scripts/release/kanal-nachziehen.sh
verlange "beta: 'desktop-beta'" scripts/release/desktop-kanal.mjs
verlange 'Kanal::Beta' src-tauri/src/kanal.rs
verlange "contains\(needs.vorbereiten.outputs.tag, '-alpha.'\)" .github/workflows/artefakte.yml
verbiete 'alpha:beta' .github/workflows/kanal-nachziehen.yml scripts/release/kanal-nachziehen.sh
```

## Kontext

semantic-release legt auf jedem Kanal einen Versions-Commit an (`Cargo.toml`, `Cargo.lock`,
`frontend/package.json`, `CHANGELOG.md`). Nach der ersten Beta hätte deshalb jeder Merge
`alpha → beta` Konflikte in genau diesen Dateien; ein Probelauf mit semantic-release 25 hat das
belegt. Nach SemVer ist jede `1.0.0-beta.N` neuer als jede `1.0.0-alpha.N`; ein gemeinsamer
Desktop-Kanal hätte Alpha-Hüllen auf die Beta gezogen und den Alpha-Kanal eingefroren.

## Konsequenzen

Der Nachzug setzt mit einem Angleich-Commit die Versionsdateien des Alpha-Tags auf den Stand von
`beta` und mergt dann; Code und Abhängigkeiten kommen unverändert an. Eine Beta ist immer ein
erprobter Alpha-Stand. Alpha-Nummern sehen nach SemVer älter aus als Beta-Nummern, obwohl sie
neuer sind; das stört nur, wer Nummern kanalübergreifend vergleicht. Der Weg nach `main` hat
dasselbe Problem und ist noch offen.
