# Proposal

## Why

Auf der Seite Einsatzdaten schaltet heute jede Änderung die ganze Seite in das
Bearbeitungsformular. Wer im Einsatz nur die Leitstellen-Nr. nachträgt oder die Alarmzeit
korrigiert, verliert dafür die Leseansicht mit allen übrigen Angaben. Der Server nimmt seit
LFH-306 einen echten Teil-PATCH an; das Frontend nutzt ihn nicht und schickt immer alle Felder.
LFH-345 · C10 hat die Gliederung der Leseansicht geliefert und die Zeilenbearbeitung
ausdrücklich hierher (LFH-472) verschoben.

## What Changes

- **Zeilenbearbeitung:** Neun Angaben werden in der Leseansicht einzeln bearbeitbar, ohne die
  Seite zu verlassen: Einsatzstichwort, Alarmzeit, Einsatzort (Adresse), Einsatzart, Nächste
  Lagebesprechung, Meldende Stelle, Sachverhalt, Anzahl Betroffene (initial) und Leitstellen-Nr.
  Alle übrigen Angaben bleiben während der Bearbeitung sichtbar.
- **Nicht zeilenweise bearbeitbar** bleiben Bezeichnung (Seitentitel), Koordinate (Eingabe mit
  Kartenbezug), Einsatzleitung (gehört zu den Mitgliedern), Einsatznummer (unveränderlich,
  LFH-617) und „Angelegt am" (Systemwert). Bezeichnung und Koordinate ändert weiter das
  Vollformular.
- **Einzelfeld-PATCH:** Eine Zeile schickt nur ihr eigenes Feld an `PATCH /api/einsaetze/{id}`.
  Zwei Personen, die gleichzeitig verschiedene Zeilen ändern, überschreiben sich damit nicht
  mehr gegenseitig. Bei derselben Zeile gilt wie bisher die letzte Speicherung.
- **Pflichtangabe:** Eine geleerte Alarmzeit wird abgelehnt. Es geht kein PATCH hinaus, und der
  bisherige Wert steht wieder da; die Zeile sagt, warum.
- **Unveränderter Wert** löst keinen PATCH aus (Wertgleichheits-Riegel wie bei `BemerkungZelle`).
- **Zeitpunkte ohne Zonenversatz:** Alarmzeit und Nächste Lagebesprechung gehen über dieselben
  Wandler `wireZuPicker`/`pickerZuWire` wie im Vollformular.
- **Ohne Schreibrecht** (Beobachter, abgeschlossener Einsatz) erscheint an keiner Zeile eine
  Bearbeiten-Aufforderung; leere Werte zeigen „—".
- **Neues Primitiv** `components/InlineAngabe.tsx` für „inline bearbeitbare Angabe mit
  beliebiger Eingabe" (Text, Textfeld, Zahl, Auswahl, Datum/Uhrzeit), optional als Pflichtangabe.
  Die Fokusrückgabe aus `BemerkungZelle` wird als gemeinsamer Hook herausgelöst, statt sie zu
  kopieren.
- Das **Vollformular bleibt** vollständig erhalten (Knopf „Bearbeiten" im Seitenkopf) und
  verhält sich unverändert.

## Capabilities

### New Capabilities
- `einsatzdaten-bearbeitung`: Bearbeitung der Kopfdaten eines Einsatzes auf der Seite
  Einsatzdaten, zeilenweise und über das Vollformular: welche Angaben inline bearbeitbar sind,
  Einzelfeld-PATCH, Pflichtangaben, Zeitwandlung und Schreibrecht.

### Modified Capabilities
- keine

## Impact

- **Frontend:** `pages/EinsatzdatenPage.tsx` (Leseansicht bekommt Inline-Zeilen),
  neu `components/InlineAngabe.tsx` samt Test, `components/BemerkungZelle.tsx` (nutzt den
  herausgelösten Fokus-Hook, Verhalten gleich), `api/einsaetze.ts` (Teil-PATCH-Typ neben
  `KopfdatenUpdate`), `pages/EinsatzdatenPage.test.tsx`.
- **Backend:** keine Änderung. `PATCH /api/einsaetze/{id}` ist bereits ein Tri-State-Teil-PATCH
  (`routes/einsatz.rs:KopfdatenPatch`) und lehnt eine leere Pflichtangabe mit 400 ab.
- **Nicht betroffen:** Query-Key-Registry (der Einsatzkopf bleibt `NICHT_LIVE_KEYS`),
  Codegen, Migrationen.
