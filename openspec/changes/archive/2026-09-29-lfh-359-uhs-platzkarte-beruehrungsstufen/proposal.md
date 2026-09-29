# Proposal

## Why

Die Platzkarte im UHS-Grundriss ist fest 140 × 116 px groß, weil das Platzraster im Backend
(`raster_position`, `SCHRITT_X = 160`, `SCHRITT_Y = 120`) die Kartenfelder vergibt und
gespeicherte Layouts (`pos_x`/`pos_y`) daran hängen. Ihre Aktionszeile trägt bis zu vier
Knöpfe in `controlHeightSM`, also 24 / 48 / 72 px je nach Dichtestufe. In `kompakt` passt das
genau. Ab `komfortabel` passt es weder in der Höhe (Titel 30 + Tags 24 + Belegung 24 + 48 =
126 px bei 100 px Innenraum, LFH-359) noch in der Breite (4 × 48 = 192 px bei 124 px, die Knöpfe
schrumpfen auf rund 31 px, LFH-379). Das ist **kein Vorsorgefall**: Ein Gerät mit grobem Zeiger
beginnt ohne gespeicherte Wahl in `komfortabel` (`DICHTE_DEFAULT_BERUEHRUNG`). Auf dem
Führungs-Tablet stehen die Knöpfe also heute schon abgeschnitten und zu klein in der Karte.

Die Geometrie lässt ohne Änderung der Kartengröße nur eine Form zu. Im Handschuh-Betrieb gilt
2 × 72 > 116 und 2 × 72 > 140, also passt je Karte genau **ein** Bedienziel. Der Auftraggeber
hat am 24.09.2026 entschieden: In beiden Berührungsstufen öffnet ein Tipp auf die Karte immer
das Aktionsmenü, und die Primäraktion steht darin oben.

## What Changes

- In den Dichtestufen `komfortabel` und `handschuh` wird die ganze Platzkarte zum **einzigen
  Bedienziel**. Ein Tipp, Klick, Enter oder Leertaste öffnet das Aktionsmenü der Karte. Die
  Aktionszeile mit den vier Knöpfen entfällt in diesen Stufen.
- Die Einträge folgen der Bündelungsregel (LFH-365). Die Primäraktion steht oben: bei einem
  unbelegten Platz „Patient zuweisen“, bei einem belegten „Verbleib / Entlassung erfassen“.
  Danach folgen „Person öffnen“, „Zurück in den Wartebereich“ und die Verfügbarkeiten. Hinter
  einem Trenner stehen die Gefahraktionen, „zurückweisen“ und im Bearbeiten-Modus „Platz
  löschen“. Die Einträge messen `controlHeight`, also 48 bzw. 72 px.
- **Verhaltensänderung auf dem Tablet:** In den Berührungsstufen weist ein einzelner Tipp auf
  einen unbelegten Platz nicht mehr direkt zu (LFH-367/B5g), dafür braucht es jetzt zwei Tipps.
  In `kompakt` bleibt der Ein-Klick-Weg bestehen.
- In diesen Stufen ist die Personenmarke auf einer belegten Karte kein eigenes Klickziel mehr,
  weil sie mit 24 px Höhe verschachtelt im Auslöser säße. Sie öffnet den Detail-Drawer über
  „Person öffnen“ im Menü. Der Drag der Person bleibt als zusätzliche Geste erhalten.
- Welche Form die Karte bekommt, entscheidet eine reine, exportierte Funktion aus den
  aufgelösten Tokens. Sie legt die Zeilenform nur fest, wenn Höhe und Breite der Zeile die
  Knöpfe tragen. `aktionsabstand()` geht in dieser Funktion auf und ist danach nur noch für die
  Zeilenform definiert.
- `kompakt` bleibt unverändert. Die vier Knöpfe messen dort 24 px, und das ist der Gate-3-Boden
  dieser Stufe (A1-Spec, Gate 3: „kompakt ≥ 24 px“).
- Die Dokumentation zieht nach: Dateikopf von `Grundriss.tsx`, Begründung des `OFFEN`-Eintrags
  in `dichte.guard.test.ts`, CLAUDE.md, AGENTS.md, die Herleitungen der Bedien-Leitlinie und
  die UHS-Prüfliste. Überall ist die Aussage bisher, die Ausnahme falle „erst mit einer Änderung
  an `raster_position`“. Das gilt nicht mehr.

## Capabilities

### New Capabilities
- `uhs-grundriss`: Bedienform der Platzkarte im UHS-Grundriss je Dichtestufe. Festgelegt werden
  Zeilenform gegen Kartenform, der Inhalt und die Reihenfolge des Aktionsmenüs, die
  Erreichbarkeit aller Aktionen in jeder Stufe und die Unveränderlichkeit von Kartengröße und
  gespeicherten Layouts.

### Modified Capabilities
<!-- keine: `openspec/specs/` führt bisher nur `lagekarte-fachebenen` -->

## Impact

- **Code:** `frontend/src/pages/uhs/Grundriss.tsx` (`PlatzKarte`, `Personenkarte`/
  `PersonenkarteDrag`, neue reine Funktion statt `aktionsabstand`).
- **Tests:** `Grundriss.test.tsx` bekommt einen Kartenform-Zweig mit Dichte-Theme, und der
  Abstandstest aus LFH-378 wird umgebaut. `dichte.guard.test.ts` behält den Eintrag, aber mit
  neuer Begründung. e2e: `uhs-grundriss-touch.spec.ts` (der Mobil-Test tippt künftig über das
  Menü) und neu eine Trefflächen-Messung in `gate3-trefflaeche.spec.ts`.
- **Backend:** keine Änderung. `SCHRITT_X`/`SCHRITT_Y` bleiben, eine Migration gibt es nicht,
  und gespeicherte `pos_x`/`pos_y` gelten weiter.
- **Tickets:** schließt LFH-359 und LFH-379.
