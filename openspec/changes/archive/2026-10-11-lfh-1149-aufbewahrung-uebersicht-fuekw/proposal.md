# Proposal

## Why

Am Führungsarbeitsplatz (1440 × 900) läuft die Aufbewahrungsübersicht waagerecht über: zehn
Spalten brauchen rund 1390 px, die Verwaltung lässt der Tabelle 1154 px, gemessen 586 px Überlauf
(LFH-1149). Die Spec verlangt alle zehn Angaben in der Übersicht, sagt aber nicht, dass jede davon
in jeder Fensterbreite als eigene Spalte im Bild stehen muss. Ohne diese Klarstellung widerspricht
jede Lösung, die eine Spalte weichen lässt, der Spec.

## What Changes

- Die Übersicht zeigt weiter alle zehn Angaben je Einsatz.
- Unter der Fensterbreite `xxl` (1600 px) dürfen drei Angaben aus der Tabelle in den
  Spaltenschalter weichen: Zeitpunkt der Vormerkung („Vorgemerkt am“), Fälligkeit eines offenen
  Einsatz-Antrags („Schwärzung auf Antrag ab“) und Zeitpunkt der Schwärzung („Geschwärzt am“).
  Ihren Stand nennt schon die Zustandsmarke (`vorgemerkt`, `schwaerzung_beantragt`,
  `geschwaerzt`). Entscheidung Ruben, 10.10.2026.
- Eine gewichene Angabe bleibt erreichbar: der Spaltenschalter blendet sie ein, sein Zähler
  („Spalten · N ausgeblendet“) nennt sie mit. Andere Angaben weichen nicht.
- Kein **BREAKING**: Daten, Route und Zustände bleiben gleich.

## Capabilities

### New Capabilities

Keine.

### Modified Capabilities

- `aufbewahrung-archiv`: Requirement „Aufbewahrungsübersicht“ erlaubt, dass die drei
  Zustandsdaten unter `xxl` in den Spaltenschalter weichen; neues Szenario für den
  Führungsarbeitsplatz.

## Impact

- `frontend/src/aufbewahrung/AufbewahrungUebersicht.tsx`: `abBreite: 'xxl'` an den drei Spalten,
  Spaltenbreiten nach der Regel „Fließende Spalte“ (`frontend/AGENTS.md`). Schon im Branch
  `claude/lfh-1149-45al6q` umgesetzt.
- `frontend/src/aufbewahrung/AufbewahrungUebersicht.test.tsx`: zwei Tests prüfen die Spaltenköpfe
  bei 1024 px und sind rot; sie ziehen auf die neue Regel nach.
- `frontend/e2e/gate1-ueberlauf.spec.ts` („Tabellen am Führungsarbeitsplatz“): misst die Übersicht
  bei 1440 px.
- `docs/anwender/kapitel/aufbewahrung.md`: nennt das Einblenden über „Spalten“.
- Backend, API und Daten: keine Änderung.
- Fahrzeuge und Dokumente aus demselben Ticket ändern keine Spec und liegen außerhalb dieser
  Change.
