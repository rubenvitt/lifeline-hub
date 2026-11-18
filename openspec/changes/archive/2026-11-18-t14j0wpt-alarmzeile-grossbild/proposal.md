# Proposal

## Why

Seit LLH-1743 trägt das Großbild des Lagebilds keine Aufträge und Meldungen mehr. Ihr Block heißt
jetzt „Stand“ und zeigt nur Lagebericht und UHS. Wer das Lagebild an die Wand wirft, sieht deshalb
weder einen überfälligen Auftrag noch eine überfällige Bestätigung oder Rückmeldung. Auf der Seite
sieht man sie in der Alarmzeile „Was brennt“, im Großbild fehlt diese Zeile bisher (LLH-1931,
abgestimmt mit Ruben am 16. und 17.11.2026).

## What Changes

- Das Großbild des Lagebilds zeigt die Alarmzeile „Was brennt“ als erstes Element unter seinem
  Kopf, über dem Band der Kennzahlen. Einträge, Folge und Wortlaut sind dieselben wie auf der Seite
  und ändern sich live mit ihr.
- `AlarmZeile` bekommt eine dritte Größe `grossbild`. Ihr Text ist bei 1920 × 1080 28 px groß und
  wächst und schrumpft über `grossMass` mit dem Fenster. Sie hat keine Links und kein Aufklappen;
  was nicht in die Breite passt, steht als „+n“.
- Das Großbild der Lagebesprechung bekommt **keine** Alarmzeile, denn ihre Seite zeigt auch keine.
  Die überfälligen Zahlen stehen dort schon in der Vorbereitung, und akute Alarme nennt der Kopf
  der Großbild-Fläche als Zahl.

## Capabilities

### New Capabilities

Keine.

### Modified Capabilities

- `grossbild-ansicht`: Das Requirement „Inhalt des Großbilds im Lagebild“ nimmt die Alarmzeile
  auf: Sie steht ganz oben, ohne Sprünge und ohne Liste hinter „+n“. Ein überfälliger Auftrag steht
  dort als Eintrag der Alarmzeile, nicht als Kennzahl „Aufträge offen“. Das Requirement „Inhalt des
  Großbilds in der Lagebesprechung“ hält fest, dass dieses Großbild keine Alarmzeile trägt.

## Impact

- Nur Frontend: `components/instrument/AlarmZeile.tsx` mit der neuen Größe,
  `pages/lage-dashboard/LagebildGrossbild.tsx` und `LageDashboardPage.tsx`, die das vorhandene
  Ergebnis von `useWasBrennt` hineinreicht (ADR-0057, kein zweiter Abruf).
- Tests: `AlarmZeile.test.tsx`, `LagebildGrossbild` (Einheit) und `e2e/grossbild.spec.ts` (kein
  Bildlauf bei 1920 × 1080 und 1280 × 720, Eintrag „1 vermisst“ in Alarmrolle).
- Design System: Die Karte `AlarmZeile` zeigt die neue Größe mit, also neu erzeugen.
- Kein Backend, keine Migration, keine API.
