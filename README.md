# Lifeline Hub

[![Gate](https://github.com/rubenvitt/lifeline-hub/actions/workflows/ci.yml/badge.svg)](https://github.com/rubenvitt/lifeline-hub/actions/workflows/ci.yml)

Führungsunterstützung für Einsatzlagen im Bevölkerungsschutz: Einsatztagebuch, Lagekarte,
Kräfteübersicht, Betroffenen- und Schadenserfassung, Meldungen und Aufträge in einer
Anwendung, die weiterarbeitet, wenn das Netz ausfällt, und der Führungslogik folgt, nach der
Einsatzleitung und Stab ohnehin arbeiten.

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

Einsatzführung findet an Orten statt, an denen Netz nicht vorausgesetzt werden darf, unter
Zeitdruck und mit Daten über Menschen. Daraus folgt, worauf es ankommt:

- **Arbeitet weiter, wenn das Netz ausfällt.** Der Server kann vor Ort laufen und braucht für
  die Arbeit im lokalen Netz kein Internet; Kartenkacheln, Schriften und Zeichen bringt er mit.
  Reißt die Verbindung eines Geräts ab, bleibt die Lage mit dem Stand der letzten Verbindung
  lesbar. Neue Einträge werden vorgemerkt und gehen von selbst hinaus, sobald wieder Netz da
  ist ([Ohne Netz arbeiten](docs/anwender/kapitel/ohne-netz.md)).
- **Folgt der Führungslogik.** Das Einsatztagebuch lässt sich nicht ändern, nur berichtigen:
  Die Berichtigung steht als eigener Eintrag neben dem alten. Stärken stehen als F/UF/M//Ges,
  Betroffene mit ihrer Sichtungskategorie, der Stab arbeitet in den Sachgebieten S1 bis S6,
  und Funkplan und Fernmeldeskizze nennen ihre Lücken. Fehlt ein Wert, steht „—“, nie 0.
- **Bedienbar unter Stress.** Trefflächen, Dichte und Farbrollen folgen einer ausformulierten
  Bedienleitlinie statt dem Zufall: drei Dichtestufen bis zum Handschuhbetrieb, Nachtbetrieb als
  Vorgabe, Farbe als Signal und nie als Dekoration.
- **Datenschutz eingebaut.** Rechte hängen an der Rolle im einzelnen Einsatz. Nach Ablauf der
  Aufbewahrungsfrist schwärzt der Server die Personendaten, das Einsatztagebuch bleibt im
  Wortlaut. Gekoppelte Geräte wie das Tablet einer Unfallhilfsstelle arbeiten ohne persönliches
  Konto, der Lagemonitor auf dem Großbild zeigt keine Namen.
- **Einfach zu betreiben.** Als Container auf dem eigenen Server oder direkt als Programm auf
  einem Rechner vor Ort. Oberfläche, SQLite und OpenSSL sind eingebaut, daneben laufen weder
  Datenbank noch Webserver (siehe [Starten](#starten)).

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

Zwei Wege, dieselbe Anwendung. **Als Container:** Zu jedem Vorabstand gibt es ein Abbild für
amd64 und arm64, getaggt mit der Version ohne `v` (etwa `1.0.0-alpha.99`). Datenbank und
Offline-Karten liegen im Volume `/data`.

```bash
docker run -d -p 8080:8080 -v lifeline-daten:/data ghcr.io/rubenvitt/lifeline-hub:<version>
```

**Direkt:** Das Ergebnis von „Bauen“ ist eine einzelne ausführbare Datei. Backend, eingebettete
Oberfläche, SQLite und OpenSSL stecken darin; auf dem Zielrechner wird weder Node.js noch ein
Webserver noch eine Datenbank installiert. Datei kopieren, starten:

```bash
./target/release/lifeline-hub --db-path lifeline.db --bind 0.0.0.0:8080
```

Beim ersten Start entstehen Datenbank und Administrationskonto; das erzeugte Passwort steht
im Log. Alles Weitere — TLS, Anmeldeverfahren, Offline-Karten, Sicherung — steht in
[docs/betrieb/packaging.md](docs/betrieb/packaging.md).

Für die Menschen, die die App im Einsatz bedienen, gibt es die Anwenderdokumentation in
[docs/anwender/](docs/anwender/README.md); dieselben Kapitel zeigt die App unter „Hilfe“.

## Entwickeln

```bash
./scripts/check-all.sh
```

Das ist die **eine** Durchsetzungsinstanz vor jedem Merge: Formatierung, Lint, Typ-Drift
zwischen Backend und Frontend, Rust-Suite, Frontend-Suite, Abhängigkeits-Advisories und die
Playwright-Suite. Dieselbe Datei fährt auch die CI — was hier grün ist, ist dort grün. Ein
roter Schritt hält die übrigen nicht auf; am Ende steht der Gesamtstatus je Schritt
(`--abbrechen` bricht stattdessen beim ersten roten Schritt ab).

Für die tägliche Arbeit laufen Backend und Frontend getrennt, damit Änderungen am Frontend
ohne Neubau des Binaries sichtbar werden:

```bash
cargo run --features dev-seeds
mise exec -- pnpm -C frontend dev
```

Die Konventionen des Projekts — UI-Form, Bedienleitlinie, Fehlercodes, Query-Keys,
Typ-Codegen — stehen in [AGENTS.md](AGENTS.md) und den dort verzeichneten Bereichsdateien. Commits folgen
[Conventional Commits](https://www.conventionalcommits.org/); daraus ermittelt
semantic-release die Version.
