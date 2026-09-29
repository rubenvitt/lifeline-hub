# Proposal

## Why

Beim Zeichnen auf der Lagekarte (Gefahrengebiet, Zone, Abschnittsfläche) gibt es keinen Weg zurück: ein
falsch gesetzter Punkt zwingt dazu, die ganze Figur neu zu zeichnen. Esc verwirft die angefangene Figur
**still** (terra-draw bricht sie beim Loslassen der Taste ab): die Punkte sind weg, ohne Hinweis und ohne
Quittung, und die Steuerung steht unverändert offen da. Eine Eigenposition gibt es auf der Karte nicht,
obwohl Führungs-Tablet und Handschirm den eigenen Standort kennen. Befund aus dem C9-Abgleich
(LFH-344, Punkte 7 und 16), eingeordnet als LFH-100 P4. LFH-468 (reaktive Sperre des Zurück-Knopfs)
geht hierin auf.

## What Changes

- **„Letzten Punkt zurück"** in der Zeichnen-Steuerung: nimmt genau den zuletzt gesetzten Punkt der
  laufenden Figur zurück. Der Knopf ist gesperrt, solange es nichts zurückzunehmen gibt, und die
  Freigabe folgt dem Zeichenstand **reaktiv**. Die Steuerung zeigt die Zahl der gesetzten Punkte.
- **Esc ist zweistufig** (Entscheidung des Auftraggebers, 28.09.2026: „je öfter Esc, desto mehr
  Richtung view-only"):
  - 1. Esc mit angefangener Figur → Figur verworfen, Zeichenmodus bleibt, Quittung „Zeichnung verworfen".
  - 1. Esc in der Bestätigungsphase (Figur fertig, noch nicht gespeichert) → Figur verworfen, zurück in
    die Zeichenphase, Quittung.
  - Esc ohne Figur → Zeichenmodus endet (in einer Serie mit Gespeichertem wie „Fertig").
  - Die Steuerung nennt beide Stufen als Hinweis.
- **Eigenposition** als Knopf im Knopfblock der Karte: Umschalter; an = eigener Standort als Punkt mit
  Genauigkeitskreis, live nachgeführt, beim ersten Standort einmal angeflogen, danach folgt die Karte
  nicht. Ohne sicheren Kontext (Klartext-HTTP) steht der Knopf gesperrt da und nennt den Grund beim
  Antippen als Text. Der Standort verlässt das Gerät nicht.
- **Geänderte Regel:** Bisher war das Messen der einzige Kartenmodus, den Esc beendet (LFH-616). Mit
  diesem Change beendet auch der **zweite** Esc das Zeichnen. Die Regel in CLAUDE.md wird angepasst.

## Capabilities

### New Capabilities
- `lagekarte-zeichnen`: Korrigierbares Zeichnen von Flächen und Linien auf der Lagekarte — Punkt
  zurücknehmen, Punktzähler, zweistufiges Esc mit Quittung.
- `lagekarte-eigenposition`: Anzeige des eigenen Gerätestandorts auf der Lagekarte, samt Verhalten
  ohne sicheren Kontext, ohne Berechtigung und ohne Standort.

### Modified Capabilities
<!-- keine: `lagekarte-fachebenen` ist nicht betroffen -->

## Impact

- Frontend, nur Lagekarte: `pages/lagekarte/zeichnen.ts` (Undo, Punktzahl, Esc-Besitz),
  `ZeichnenSteuerung.tsx`, `Kartenflaeche.tsx` (Handle + Callback + Eigenpositions-Darstellung),
  `KartenUeberlagerung.tsx` (neuer Knopf, optional wie „Messen"), `useKartenInteraktion.ts`
  (Rückkehr aus der Bestätigungsphase), `pages/LagekartePage.tsx` (Esc-Handler, Verdrahtung).
- `personen/BetroffeneKarte.tsx` nutzt dieselbe Überlagerung und bleibt ohne Eigenposition-Knopf.
- Keine Backend-, API- oder Datenmodelländerung. Keine neue Abhängigkeit (terra-draw 1.34 bringt
  Undo und ein `history`-Ereignis mit; Geolocation ist Browser-API).
- Doku: `docs/betrieb/packaging.md` (HTTP ohne sicheren Kontext: keine Eigenposition), CLAUDE.md
  (Esc-Regel der Lagekarte).
