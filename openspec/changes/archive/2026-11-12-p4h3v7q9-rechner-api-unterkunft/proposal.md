# Proposal

Zunder: https://zunder.rubeen.dev/#/aufgabe/p4h3v7q95b32g7130k3chu7f (LLH-1524)

## Why

Der Unterkunfts- und Zeltrechner rechnet seit LLH-1520 nur im Browser der eigenen Oberfläche.
Andere Anwendungen (etwa die iuk-suite) sollen dieselbe Rechnung nutzen, ohne sie nachzubauen und
ohne dass zwei Fassungen auseinanderlaufen. Der Maschinenzugang (LLH-1652) und der Vertrag der
öffentlichen API (LLH-1653) stehen seit dem 12.11.2026; der Scope `rechner:use` ist vergeben, aber
noch keine Route nutzt ihn.

## What Changes

- **Zwei Routen in der öffentlichen API v1**, beide nur mit Maschinenanmeldung und Scope
  `rechner:use`, beide mit signierter Antwort:
  - `POST /api/v1/rechner/unterkunft` rechnet eine Unterkunft durch und speichert nichts.
  - `GET /api/v1/rechner/unterkunft/richtwerte` nennt die wirksamen Richtwerte samt Bezeichnung,
    Einheit, Grenzen und Zelttypen.
- **Ebene „Anfrage“:** Die Anfrage darf einzelne Richtwerte überschreiben. Wirksam ist je
  Schlüssel Anfrage vor Organisation des Zugangs vor Basis. Die Antwort nennt die Herkunft je
  Schlüssel.
- **Strenge Eingabeprüfung:** 400 mit Feldname für das Feld für sich (unbekanntes Feld,
  unbekannter Richtwert, Grenze), 422 für eine widersprüchliche Grundlage. Der Rechner der
  Oberfläche bleibt nachsichtig.
- **Rechenkern in Rust** neben dem TS-Kern. Die Fallsammlung
  `tests/fixtures/unterkunft/faelle.json` prüft ab jetzt beide; jeder ihrer Fälle ist zugleich
  eine gültige Anfrage an die API.
- **Ohne `einsatz_id`** (Entscheidung vom 12.11.2026): Die Einsatz-Werte bleiben draußen, bis es
  eine Einsatz-Freigabe für Maschinenzugänge gibt. Der Task hatte sie vorgesehen; das Feld kommt
  später als optionales Feld hinzu.
- Kein anonymer Zugang, kein CORS, kein neuer Fehlercode, keine Migration. Die Oberfläche ändert
  sich nicht und rechnet weiter im Browser.

## Capabilities

### New Capabilities

- `rechner-api-unterkunft`: Rechnung Unterkunft und Zelte für Fremdsysteme über die öffentliche
  API v1: Zugang, Eingabe und ihre Prüfung, Ebenen der Richtwerte samt Herkunft, Auskunft über die
  Richtwerte und Gleichheit mit dem Rechner der Oberfläche.

### Modified Capabilities

Keine. `maschinenzugang` und `oeffentliche-api-vertrag` gelten unverändert; die neuen Routen
halten sich an ihre Anforderungen (Scope, Dokument, Fehlerform, 64 KiB, `no-store`).

## Impact

- **Backend:** neuer Rechenkern `src/unterkunft/rechner.rs`; `src/unterkunft/mod.rs` liest aus
  der Basis zusätzlich Bezeichnung, Gruppe, Einheit und Zelttypen; neues Modul
  `src/public_api/rechner.rs` mit eigenen v1-Schemas; zwei Einträge in `public_api::router()`.
- **Vertrag:** `docs/api/public-v1.json` wächst um zwei Pfade und ihre Schemas;
  `src/public_api/description.md` nennt die neuen Namen.
- **Tests:** neue Datei `tests/rechner_api.rs`; die Helfer für signierte Aufrufe ziehen aus
  `tests/maschinenzugang.rs` in ein gemeinsames Testmodul.
- **Doku:** `docs/api/maschinenzugang.md` (Scope-Tabelle), Architektur Kapitel 5 (Zeilen
  `src/public_api` und `src/unterkunft`), Anwenderkapitel „Anbindungen“ und „Betreuung“,
  `frontend/src/betreuung/AGENTS.md`.
- **Frontend:** kein Verhalten; nur Kommentare im TS-Kern und in seinem Fixture-Test, die den
  Rust-Kern noch als „später“ ankündigen.
- **Folgeaufgabe:** `einsatz_id` für Einsatz-Werte, abhängig von der Einsatz-Freigabe für
  Zugänge (LLH-1638, LLH-1655).
