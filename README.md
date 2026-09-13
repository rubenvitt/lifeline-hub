# Lifeline Hub

[![Gate](https://github.com/rubenvitt/lifeline-hub/actions/workflows/ci.yml/badge.svg)](https://github.com/rubenvitt/lifeline-hub/actions/workflows/ci.yml)

Führungsunterstützung für Einsatzlagen im Bevölkerungsschutz: Einsatztagebuch, Lagekarte,
Kräfteübersicht, Betroffenen- und Schadenserfassung, Meldungen und Aufträge — als **eine
ausführbare Datei**, die im Einsatzleitwagen oder auf einem Mini-PC ohne Internetverbindung
läuft.

> **Stand: frühe Alpha.** Es gibt noch kein Release. Schnittstellen, Datenmodell und
> Bedienung ändern sich laufend, Migrationspfade zwischen Ständen sind nicht zugesichert.
> Wer das produktiv in einer echten Lage einsetzt, tut das auf eigenes Risiko.

## Lizenz — alle Rechte vorbehalten

**Dieses Repository steht unter keiner Open-Source-Lizenz.** Der Quelltext ist einsehbar,
damit die Arbeitsweise nachvollziehbar ist; es wird damit **kein** Recht zur Nutzung,
Vervielfältigung, Veränderung oder Weitergabe eingeräumt. Öffentliche Sichtbarkeit ist keine
Erlaubnis. Wer das Projekt einsetzen oder darauf aufbauen möchte, fragt vorher an.

Beiträge von außen werden derzeit nicht angenommen. Fehlerberichte sind willkommen.

## Warum überhaupt

Einsatzführung findet an Orten statt, an denen Netz nicht vorausgesetzt werden darf. Die
tragenden Entscheidungen folgen daraus:

- **Eine Datei, keine Laufzeitabhängigkeiten.** Backend, eingebettetes Frontend, SQLite und
  OpenSSL stecken im Binary. Auf dem Zielrechner werden weder Node.js noch ein Webserver
  noch eine Datenbank installiert — bauen, Datei kopieren, starten.
- **Offline-fähige Lagekarte.** Kartenkacheln liegen als lokale MBTiles-Datei vor, Schriften
  und Symbole sind eingebettet. Ohne Netz fehlt der Kartenhintergrund, nicht die Funktion.
- **Bedienbar unter Einsatzbedingungen.** Trefflächen, Dichte und Farbrollen folgen einer
  ausformulierten Leitlinie (Handschuhbetrieb, Tageslicht, Nachtmodus) statt dem Zufall.

## Bauen

Voraussetzungen: Rust (stable), Node.js und pnpm über [mise](https://mise.jdx.dev), Perl und
ein C-Compiler (für das statisch eingebackene OpenSSL), `nasm` (für die TLS-Krypto).

```bash
./scripts/build-release.sh
```

Ergebnis ist `target/release/lifeline-hub` samt Software-Stückliste. Ein direkter
`cargo build --release` reicht **nicht**: das Skript baut zuvor das Frontend und erzwingt,
dass es auch wirklich neu eingebettet wird.

Für eine andere Zielplattform:

```bash
./scripts/build-release.sh --target x86_64-pc-windows-gnu
```

## Starten

```bash
./target/release/lifeline-hub --db-path lifeline.db --bind 0.0.0.0:8080
```

Beim ersten Start entstehen Datenbank und Administrationskonto; das erzeugte Passwort steht
im Log. Alles Weitere — TLS, Anmeldeverfahren, Offline-Karten, Sicherung — steht in
[docs/betrieb/packaging.md](docs/betrieb/packaging.md).

## Entwickeln

```bash
./scripts/check-all.sh
```

Das ist die **eine** Durchsetzungsinstanz vor jedem Merge: Formatierung, Lint, Typ-Drift
zwischen Backend und Frontend, Rust-Suite, Frontend-Suite, Abhängigkeits-Advisories und die
Playwright-Suite. Dieselbe Datei fährt auch die CI — was hier grün ist, ist dort grün.

Für die tägliche Arbeit laufen Backend und Frontend getrennt, damit Änderungen am Frontend
ohne Neubau des Binaries sichtbar werden:

```bash
cargo run --features dev-seeds
mise exec pnpm@11.10.0 -- pnpm -C frontend dev
```

Die Konventionen des Projekts — UI-Form, Bedienleitlinie, Fehlercodes, Query-Keys,
Typ-Codegen — stehen in [CLAUDE.md](CLAUDE.md). Commits folgen
[Conventional Commits](https://www.conventionalcommits.org/); daraus ermittelt
semantic-release die Version.
