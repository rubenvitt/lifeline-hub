# Proposal

## Why

LFH-690 legt beim Demo-Import echte Stammdaten an (Fahrzeuge, Personal, Material) und markiert
sie in `demo_herkunft`, zeigt die Marke aber nirgends an (dort ausdrücklich Non-Goal). Wer einen
echten Einsatz bearbeitet, kann deshalb ein Demo-Fahrzeug disponieren, ohne es zu merken. Das
Entfernen fängt den Fall nachträglich ab (die Zeile bleibt als „behalten“), die Verwechslung
selbst verhindert es nicht (LFH-733).

## What Changes

- Die Stammdaten-Antworten für Fahrzeug, Personal und Material tragen ein neues Pflichtfeld
  `ist_demo` (bool). Es ist wahr, solange die Zeile eine Demo-Marke trägt, und wird bei jeder
  Abfrage aus der Marke gelesen. Ein gespeichertes Zweitflag gibt es nicht.
- Die Einsatz-Dispositionen (`EinsatzFahrzeugAnzeige`, `EinsatzPersonalAnzeige`,
  `EinsatzMaterialAnzeige`) tragen dasselbe Feld, abgeleitet über ihren Stamm-Bezug. Ad-hoc-Kräfte
  sind nie Demo.
- Die Admin-Kataloge (Fahrzeuge, Personal, Material) und die Detailseiten für Fahrzeug und
  Personal zeigen neben der Leitspalte bzw. im Kopf eine Text-Marke „Demo“.
- In den Stammdaten-Auswahllisten zum Disponieren (Fahrzeuge, Personal, Material eines
  Einsatzes) bleiben Demo-Einträge wählbar. Sie tragen die Marke „Demo“ und stehen gesammelt in
  einer eigenen Gruppe „Demo-Daten“ am Ende der Liste. Entscheidung des Menschen am
  Scope-Checkpoint: kennzeichnen statt ausblenden.
- Die Einsatz-Tabellen für Fahrzeuge, Personal und Material zeigen die Marke an disponierten
  Demo-Kräften, neben dem Funkrufnamen, Namen bzw. der Bezeichnung. Auch das hat der Mensch am
  Scope-Checkpoint so entschieden.
- Kein **BREAKING** im Wire-Format: das Feld kommt hinzu, nichts fällt weg. Die generierten
  TS-Typen machen es zur Pflicht, deshalb wachsen die Test-Fixtures im Frontend mit.

## Capabilities

### New Capabilities

_keine_

### Modified Capabilities

- `demo-daten`: neue Anforderung „Demo-Marke in der Anzeige“. Die Stammdaten-Antworten und die
  Einsatz-Dispositionen legen die Marke offen, und die Oberfläche kennzeichnet Demo-Stammdaten in
  den Katalogen, in den Auswahllisten (dort gruppiert am Ende) und in den Einsatz-Tabellen. Damit
  ist das Non-Goal aus LFH-690 aufgehoben.

## Impact

- **Backend:** `src/fahrzeug/`, `src/personal/`, `src/material/` (Stamm-`SPALTEN`, interne
  Datensätze, `…Anzeige`-DTOs, `disposition_repo`-SELECTs). Keine Migration: `demo_herkunft`
  (0123) hat den Schlüssel `(tabelle, datensatz_id)` schon als PK.
- **Codegen:** `frontend/src/api/openapi.json` und `types.generated.ts` neu erzeugen
  (`scripts/check-typ-codegen.sh`).
- **Frontend:** neue gemeinsame Marke in `components/`, `stammdaten/*Tab.tsx`,
  `stammdaten/{Fahrzeug,Personal}DetailPage.tsx`, `pages/{Fahrzeuge,Personal,Material}Page.tsx`
  sowie die Fixtures der Tests, die diese Typen bauen.
- **Regeln:** ein Satz im Abschnitt „Demo-Daten zur Laufzeit“ in `src/AGENTS.md` (Server) und
  einer unter „Farbe und Zeichen“ in `frontend/AGENTS.md` (Darstellung).
- Keine neue Abhängigkeit, kein neuer Endpunkt, keine Rechteänderung.
