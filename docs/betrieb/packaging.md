# Betrieb: Bauen & Betreiben der Binary

lifeline-hub wird als **eine** ausführbare Datei ausgeliefert. Sie enthält API,
eingebettetes Frontend und (statisch gebündeltes) SQLite — kein separater
Webserver, keine Laufzeit-Abhängigkeiten.

## Bauen

Voraussetzungen: Rust-Toolchain (stable) und Node.js (für den Frontend-Build).

```bash
./scripts/build-release.sh
```

Das Skript baut zuerst das Frontend nach `frontend/dist` und danach die
Release-Binary, die `frontend/dist` zur Compile-Zeit einbettet. Ergebnis:
`target/release/lifeline-hub`.

> **Wichtig:** Das Frontend muss **vor** dem Release-Build gebaut sein, sonst
> bettet die Binary einen veralteten/leeren Frontend-Stand ein. Das Skript
> erledigt die Reihenfolge automatisch.

## Starten

```bash
./target/release/lifeline-hub --db-path /var/lib/lifeline/lifeline.db --bind 0.0.0.0:8080
```

Konfiguration per CLI-Flag oder ENV (Auszug):

| Flag | ENV | Default | Bedeutung |
|---|---|---|---|
| `--db-path` | `LIFELINE_DB_PATH` | `lifeline.db` | Pfad zur SQLite-Datei |
| `--bind` | `LIFELINE_BIND` | `127.0.0.1:8080` | Lausch-Adresse |
| `--org-name` | `LIFELINE_ORG_NAME` | `Meine Organisation` | Org-Name beim ersten Start |
| `--admin-user` | `LIFELINE_ADMIN_USER` | `admin` | Initialer Admin (erster Start) |
| `--admin-password` | `LIFELINE_ADMIN_PASSWORD` | *(generiert)* | Fehlt es, wird beim ersten Start ein Zufallspasswort ins Log geschrieben |

> **Erstes Admin-Passwort:** Wurde kein `--admin-password` gesetzt, schreibt die
> Binary beim ersten Start ein Zufallspasswort als Warnung ins Log. Mit systemd:
> `journalctl -u lifeline-hub | grep -i passwort`. Beim direkten Start:
> in der Konsolenausgabe nach „Initiales Admin-Passwort" suchen. Danach umgehend
> über die Weboberfläche ändern.

Beim ersten Start legt die Binary die DB-Datei an, spielt die Migrationen ein
und bootstrappt das Admin-Konto.

## Lokaler Betrieb (ELW / Mini-PC)

`--bind 0.0.0.0:8080` macht den Server im lokalen WLAN erreichbar. Clients geben
die Server-URL einmalig in der PWA ein. TLS ist empfohlen, im vertrauenswürdigen
LAN ist HTTP zulässig.

> **Hinweis:** Die Binary wird auf einem Entwickler-/Build-Rechner mit Node.js und
> Rust gebaut und dann als fertige Datei auf den ELW-Rechner kopiert. Auf dem
> ELW-Rechner selbst werden weder Node.js noch eine Internetverbindung benötigt.
