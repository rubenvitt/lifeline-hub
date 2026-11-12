# Proposal

## Why

Das Benutzermenü hat nach LLH-1549 18 anklickbare Einträge und drei Gruppenköpfe; in
`komfortabel` ist es rund 1070 px hoch, am Handy (390 × 844) liegen Helligkeit, Neuigkeiten,
Hilfe, Rückmeldung und Lizenzen unter dem Rand (Ruben, 11.11.2026: „viel zu voll“). Das Menü
soll kürzer und geordnet werden, ohne dass ein Weg verloren geht. Weg und Variante sind mit
Ruben abgestimmt (Zunder LLH-1642, Mockups
https://claude.ai/artifact/1Qv9ekT2kPm3CjK8Pk67vK, Variante A).

## What Changes

- **Gruppe „Anzeige“ mit drei Segmentleisten:** Darstellung (Hell, Dunkel, System),
  Bediendichte (Kompakt, Komfortabel, Handschuh) und Helligkeit (100 … 20 %) stehen je als eine
  `Segmentleiste` im Menü statt als elf Listeneinträge unter drei Überschriften. Die Wahl bleibt
  ein Tipp und sofort wirksam, der gewählte Wert ist ausgewählt (`aria-checked`) statt „✓“ im
  Text. Die Sperre der Helligkeit bei aktiver Warnung erklärt weiter Boden und Grund.
- **Rückmeldung und Lizenzen ziehen auf die Hilfe-Seite** (`/hilfe`): ein Block „Rückmeldung“ und
  ein Link „Lizenzen“ in der Übersicht der Hilfe. Beide Einträge entfallen im Menü.
- **Benachrichtigungen** bleibt im Menü und bekommt einen zweiten Weg: den Link
  „Benachrichtigungen einstellen“ unten in der Eingänge-Klappfläche im Einsatz.
- **Unverändert:** Kopf (Name, Funktion, Rollen, Version), Profil und Abmelden direkt darunter,
  Neuigkeiten mit Ungelesen-Punkt, Hilfe. Die Sprungpalette behält ihre Schnelleinstellungen.
- Das Menü hat danach 6 Einträge und 3 Leisten (am Handy in `komfortabel` rund 620 px hoch).
- **BREAKING (für Tests und Doku, nicht für Daten):** die Rollen `menuitem` „Hell“, „Dunkel ✓“,
  „60 %“ usw. gibt es nicht mehr; wer sie anspricht, wählt künftig `radio` in einer benannten
  `radiogroup`.

## Capabilities

### New Capabilities

- `benutzermenue`: Was das Benutzermenü trägt, in welcher Reihenfolge, und wo die Wege liegen,
  die es nicht (mehr) trägt (Rückmeldung, Lizenzen, zweiter Weg zu den Benachrichtigungen).

### Modified Capabilities

- `bedien-helligkeit`: Die Stufen stehen im Benutzermenü als Leiste „Helligkeit“, die gewählte
  Stufe ist ausgewählt statt „✓ im Text“; die Erklärung der Sperre hängt an der Leiste.

## Impact

- Frontend: `components/BenutzerMenu.tsx` (Gruppe „Anzeige“, Einträge Rückmeldung und Lizenzen
  entfallen), `components/instrument/Segmentleiste.tsx` (volle Breite, falls nötig),
  `hilfe/HilfePage.tsx` und `hilfe/Hilfe.css` (Block Rückmeldung, Link Lizenzen),
  `alarm/EingaengeKnopf.tsx` (Link Benachrichtigungen), `rueckmeldung/adresse.ts` (Bereich der
  App beim Aufruf aus der Hilfe).
- Tests: `BenutzerMenu.test.tsx`, `AppLayout.test.tsx`, `EinsatzLayout.test.tsx`,
  `Benutzermenue.neuigkeiten.test.tsx`, `HilfePage.test.tsx`, e2e-Specs, die Darstellung,
  Dichte oder Helligkeit über das Menü setzen (`dichte-ableitung`, `kopfzeile-schmal`,
  `lagekarte-smoke`, `lagekarte-zeichnen-korrigierbar`, `menue-kern.ts` u. a.), Bildlauf
  (`doku-bilder/einsatz-oberflaeche`, `anmelden-abmelden`).
- Anwenderdoku: `anmelden-abmelden`, `einsatz-oberflaeche` (Darstellung, Benachrichtigungen),
  `rueckmeldung`, Bilder `benutzermenue*.png` und `darstellung*.png`.
- Entwurf: Mockups nach `docs/design/2026-11-11-benutzermenue/`.
- Kein Backend, keine Migration, keine gespeicherten Schlüssel ändern sich.
