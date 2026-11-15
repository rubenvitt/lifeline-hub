# Proposal

Zunder: https://zunder.rubeen.dev/#/aufgabe/v5gg1doxlmap9w5nlexp80oc (LLH-1868)

## Why

Ein ELW, der sich für seine Org bei einem Hub meldet, nimmt keine Fremdsysteme an: Anbindungen
und Einwurf-Zugänge gehören an den Hub. Seit LLH-1497 kann ein ELW sich aber auch per
Direktkopplung vor Ort (`vor_ort`) bei einem zweiten ELW melden. Diese Kopplung trägt keinen der
Flüsse einer Hub-Kopplung, sperrt heute trotzdem alle Anbindungen und Einwurf-Zugänge der Org, und
die Seite „Anbindungen“ nennt den zweiten ELW als Hub. Am Einsatzort nimmt dann keiner der beiden
ELW Fremdsysteme an. Die Specs sagen im Anforderungstext „bei einer anderen Instanz“ und in den
Szenarien „bei einem Hub“; der Code folgt dem weiteren Text.

## What Changes

- Die Sperre für Fremdsysteme gilt nur, wenn sich die Instanz für die Org über eine aktive
  **Standardkopplung** meldet (meldende Seite, Org zugeordnet). Eine Direktkopplung vor Ort zählt
  nicht.
- Das betrifft alle Stellen, die dieselbe Frage stellen: Anfragen eines Maschinenzugangs (401),
  Anlegen und Code ausstellen (409), Einwürfe (401), Anlegen und Schlüsselwechsel eines
  Einwurf-Zugangs (409), den Sperrgrund der Seite „Anbindungen“ und das ruhende Freigabe-Paneel
  eines Einsatzes.
- Meldet sich die Instanz für die Org zugleich vor Ort bei einem ELW und per Standardkopplung bei
  einem Hub, bleibt die Sperre, und die Seite nennt den Hub.
- Anwenderdoku „Anbindungen“, Abschnitt „Am ELW“, nennt die Ausnahme.

## Capabilities

### New Capabilities

Keine.

### Modified Capabilities

- `maschinenzugang`: „Ein gekoppelter ELW nimmt keine Fremdsysteme an“ gilt nur für eine
  Standardkopplung, nicht für eine Direktkopplung vor Ort.
- `einwurf-zugang`: „Ein gekoppelter ELW nimmt keine Einwürfe an“ ebenso.

## Impact

- Backend: `src/public_api/zugang.rs` (`hub_fuer_org`), wirksam über die Aufrufer
  `src/public_api/machine.rs`, `src/public_api/routen.rs`, `src/public_api/einwurf/routen.rs`,
  `src/public_api/freigabe.rs`, `src/routes/anbindungen.rs`; Wächter in `src/instanz/mod.rs`.
- Tests: `tests/maschinenzugang.rs`, `tests/einwurf.rs`, Repo-Test in `src/public_api/zugang.rs`.
- Doku: `docs/anwender/kapitel/anbindungen.md`.
- Kein Wire-, Schema- oder Migrationswechsel; das Frontend zeigt `gesperrt_grund` unverändert an.
