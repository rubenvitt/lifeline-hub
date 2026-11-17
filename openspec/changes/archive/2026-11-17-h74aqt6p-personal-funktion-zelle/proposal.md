# Proposal

Zunder: https://zunder.rubeen.dev/#/aufgabe/h74aqt6plo2271m3ahp14rtr (LLH-1791, `h74aqt6p`),
Unteraufgabe von LLH-1721 („Listen und Tabellen auf Touch und Handy“), Welle „Tabellen“.

## Why

In der Personalliste steht in jeder Zeile der blaue Link „Funktion eintragen“ über der grauen
Qualifikation („Zugführer, Sprechfunker“). Bei zwölf Kräften sind das zwölf gleiche Links und
Zeilen von 67 bis 88 px Höhe. Die Qualifikation, das eigentlich Gefüllte, tritt hinter eine
Aufforderung zurück.

## What Changes

- Ist die Einsatzfunktion leer, steht die Qualifikation als normaler Wert in einer Zeile, daneben
  ein Stift-Knopf mit dem zugänglichen Namen „Funktion zu <Name> eintragen“ und dem Boden der
  Dichtestufe.
- Ist die Einsatzfunktion gesetzt, steht sie als Wert (Wertknopf, wie bisher) und die
  Qualifikation gedämpft darunter.
- Ohne Schreibrecht steht nur, was gefüllt ist: die Einsatzfunktion und sonst die Qualifikation.
- Die Regel „Ein leeres Feld muss sagen, dass man es schreiben kann“ (`frontend/AGENTS.md`)
  bekommt eine Listenform: Steht in der Zelle schon ein anderer Wert, sagt ein Stift-Knopf mit
  zugänglichem Namen das Schreibbare, und es braucht kein Wort.

## Capabilities

### New Capabilities

Keine.

### Modified Capabilities

- `personal-einsatzangaben`: „Einsatzfunktion vor Qualifikation“ legt fest, wie die
  Personalliste beide zeigt, wenn die Einsatzfunktion leer oder gesetzt ist.

## Impact

- `frontend/src/kraefte/EinsatzfunktionZelle.tsx` samt Test, `frontend/src/pages/PersonalPage.tsx`
  (Spaltenbreite prüfen).
- `frontend/AGENTS.md`, „Inline-Bearbeitung und Status“.
- `frontend/e2e/kraefte-einsatzfunktion.spec.ts`, `frontend/e2e/gate3-trefflaeche.spec.ts` (Ziel
  des Stifts).
- Anwenderdoku `docs/anwender/kapitel/personal.md` samt Bild.
- Kein Backend. In der Tabelle öffnet die Bearbeitung schwebend an der Zelle, wie es die Change
  `lsug0joq-tabellen-touch` (D2) für alle Tabellenzellen festlegt. Diese Change setzt darauf auf.
