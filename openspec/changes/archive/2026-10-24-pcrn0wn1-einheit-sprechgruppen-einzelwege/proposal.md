# Proposal

## Why

Die Einheit-Ansicht (LLH-1036) speichert die Sprechgruppen einer Einheit als ganze Menge
(`PATCH …/einheiten/{eid}` mit `sprechgruppe_ids`). Ändern zwei Arbeitsplätze die Sprechgruppen
derselben Einheit kurz nacheinander, ersetzt der zweite die Menge und löscht still, was der erste
eingetragen hat. Die Einzelwege `PUT/DELETE …/einheiten/{eid}/sprechgruppen/{sg}` gibt es seit
LFH-893; die Fernmeldeskizze nutzt sie schon, die Ansicht noch nicht. Außerdem steht heute keine
Sprechgruppen-Änderung einer Einheit im Einsatztagebuch (LLH-1265).

## What Changes

- Die Zeile „Sprechgruppen“ der Einheit-Ansicht schickt nach dem Speichern **je hinzugefügter
  Sprechgruppe ein `PUT`** und **je entfernter ein `DELETE`** an den Einzelweg, berechnet gegen den
  Stand beim Öffnen der Zeile. Eine Sprechgruppe, die ein anderer Arbeitsplatz inzwischen
  zugeordnet oder gelöst hat, bleibt davon unberührt.
- Die Einzelwege an der Einheit schreiben **je wirksamer Änderung einen System-Eintrag ins ETB**
  („Einheit «1. Zug»: Sprechgruppe «311» (TMO) zugeordnet“ bzw. „… entfernt“). Eine wiederholte,
  wirkungslose Anfrage schreibt nichts. Das gilt auch für Zuordnungen aus der Fernmeldeskizze, die
  denselben Weg nehmen.
- Der Client-Typ `EinheitPatch` verliert `sprechgruppe_ids`, damit die Ansicht nicht unbemerkt auf
  den Mengen-Weg zurückfällt. Der Server-PATCH mit `sprechgruppe_ids` bleibt unverändert bestehen
  (Wire-Grenze, ohne ETB).

Nicht Teil dieser Change: Abschnitt (`AbschnittDetail`) und Führungsstelle
(`EinsatzdatenPage`) speichern ihre Sprechgruppen weiter als ganze Menge. Ihre Einzelwege bleiben
ohne ETB. Beides ist ein eigener Nachzug.

## Capabilities

### New Capabilities

_keine_

### Modified Capabilities

- `einheit-ansicht`: Die Anforderung „Ein Speichern schickt genau die geänderte Angabe“ nimmt die
  Sprechgruppen aus (keine leere Liste mehr). Neu ist eine Anforderung für das Speichern der
  Sprechgruppen über die Einzelwege, mit zwei Arbeitsplätzen und dem ETB-Eintrag je Änderung.

## Impact

- **Frontend:** `frontend/src/pages/einheit/EinheitFunk.tsx` (Diff beim Speichern, Stand beim
  Öffnen), `frontend/src/pages/EinheitDetailPage.tsx` (neue Mutation, Cache und ETB nachladen),
  `frontend/src/api/einheiten.ts` (Einzelwege der Einheit, `EinheitPatch` ohne
  `sprechgruppe_ids`), Vitest dazu.
- **Backend:** `src/routes/einsatz_einheit.rs` (`sprechgruppe_zuordnen`/`sprechgruppe_loesen`
  schreiben bei Wirkung ins ETB). Kein neuer Endpunkt, keine Migration, keine DTO-Änderung.
- **Tests:** `tests/sprechgruppe_einzelzuordnung.rs` (die Einheit verlässt „keine ETB-Wirkung“,
  neuer Test für zwei gleichzeitige Änderungen samt ETB).
- **Anwenderdoku:** Satz zum ETB-Eintrag im Kapitel der Einheit, falls dort die Sprechgruppen
  beschrieben sind (Mitänderungsregel `docs/anwender/AGENTS.md`).
