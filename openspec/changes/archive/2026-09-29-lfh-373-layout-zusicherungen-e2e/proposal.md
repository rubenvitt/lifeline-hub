# Proposal

## Why

Drei Prüflisten-Zeilen konnten seit Juli 2026 nicht abgehakt werden, weil jsdom kein Layout
rechnet: Zeile 2 (Trefffläche im Handschuh-Betrieb), Zeile 12 (Umbruch und Fläche auf
schmalem Schirm) und Zeile 13 (Fokus nie verdeckt, WCAG 2.4.11). Betroffen sind die
Prüflisten zu ETB, Lagekarte und Gefahrenmatrix, dazu zwei Fokusfragen aus LFH-613.
Eine Vorab-Messung im Browser vom 24.09.2026 zeigt, dass die offenen Zeilen nicht nur
unbelegt sind. Drei davon sind **falsch**:

- **ETB:** Beim Tabben durch die Zeitachse landet jeder Auslöser „Aktionen zu Eintrag N“
  **vollständig** hinter der angepinnten Erfassungsleiste, auf jeder Breite und in jeder
  Dichtestufe. Die Leiste belegt bei 390 × 844 im Handschuh-Betrieb 497 px (59 %), bei
  390 × 600 sogar 83 % der Fensterhöhe.
- **Gefahrenmatrix:** Sobald die Tabelle waagerecht überläuft (390 px in allen Stufen,
  1024 px kompakt/komfortabel, 1366 px Handschuh), tabbt der Fokus beim Zeilenwechsel
  Zellen **vollständig** unter die fixierte Spalte „Gefahr“.
- **Lagekarte:** Bei 390 px im Handschuh-Betrieb liegen „Herauszoomen“, „Nach Norden
  ausrichten“ und „Messen“ **vollständig** unter dem Zeitachsenband, bei 1024 px liegt
  „Zeichenwerkzeuge“ zu 92 % darunter. Die Knöpfe sind damit auch per Zeiger nicht
  erreichbar. Der Abspielknopf der Zeitachse schrumpft auf 16 px Breite.

Belegt und in Ordnung sind die Höhen: Slash-Menü, Zeilenaktionen samt Menü, „Verortet“-
Einträge, Kartenknöpfe und alle 58 Matrixzellen erreichen im Handschuh-Betrieb 72 px.

## What Changes

- **Nachweise in `frontend/e2e/`** für Zeile 2, 12 und 13 an ETB, Lagekarte,
  Gefahrenmatrix, Personenliste und Personenkarte, jeweils mit echter Umschaltung der
  Dichtestufe und einer Gegenprobe in `kompakt`, die rot werden kann.
- **Messkerne:** `e2e/fokus-kern.ts` bekommt eine opt-in-Kandidatenliste für absolut
  positionierte Aufbauten. Die Vorgabe bleibt unverändert, weil vier Specs den Kern
  teilen. Der CLS-Beobachter wird als reiner Move nach `e2e/cls-kern.ts` gehoben.
- **Fix ETB, Fokus:** Der Fokus-Scroll des Dokuments hält die Höhe der Erfassungsleiste
  frei (`scroll-padding-block-end`, Muster LFH-465).
- **Fix ETB, Fläche:** Die Erfassungsleiste belegt höchstens die Hälfte der Fensterhöhe.
  Auf schmalem Schirm steht das Textfeld auf eigener, voller Breite statt zwischen
  Typ-Präfix und „Erfassen“ auf 124 px eingezwängt.
- **Fix Gefahrenmatrix:** Der Scrollcontainer der Tabelle hält die Breite der fixierten
  Spalte frei (`scroll-padding-inline-start`).
- **Fix Lagekarte:** Fußbänder und Knopfblock können sich per Layout nicht mehr
  überlagern (Prinzip LFH-355: Aufteilung statt `zIndex`). Das Zeitachsenband belegt
  höchstens die Hälfte der Kartenhöhe, sein Bezeichnungsfeld hat keine feste Breite mehr,
  und der Abspielknopf schrumpft nicht mehr.
- **Prüflisten:** Jede der drei Juli-Prüflisten, die LFH-613-Prüfliste und die
  LFH-342-Prüfliste bekommen einen datierten Nachtrag mit Verdikt aus Messung. Das
  „erfüllt“ der LFH-342-Liste für Zeile 12 stützt sich auf gelöschte Artefakte und wird
  ausdrücklich korrigiert.
- **Verweise:** Die rund 17 Verweise auf LFH-373 für die „Stufenwahl aus dem
  Einsatzkontext“ wandern auf LFH-724. CLAUDE.md verliert den Satz, die Lagekarte sei bei
  390 px nicht messbar. Die Messung widerlegt ihn: Die Leiste liegt dort unter der Karte
  und ist ausblendbar.

## Capabilities

### New Capabilities
- `einsatztauglichkeit-layout`: gerenderte Layout-Zusicherungen der Bedien-Leitlinie an
  ETB, Lagekarte, Gefahrenmatrix, Personenliste und Personenkarte: Trefffläche je
  Dichtestufe, Flächendeckel angepinnter und schwebender Leisten, kein vollständig
  verdecktes Fokusziel.

### Modified Capabilities
- keine (`openspec/specs/lagekarte-fachebenen` regelt Quellen und Ebenen, nicht das
  Layout der Aufbauten)

## Impact

- **Frontend-Code:** `index.css` / `pages/EtbPage.tsx` (Scroll-Abstand, Leistenhöhe),
  `etb/Schnellerfassung.tsx` und `components/instrument/Schnellerfassungszeile.tsx`
  (Umbruch auf schmalem Schirm), `pages/gefahren/GefahrenMatrix.tsx` (Scroll-Abstand der
  Tabelle), `pages/lagekarte/KartenFuss.tsx`, `KartenUeberlagerung.tsx`,
  `SnapshotLeiste.tsx` (Aufteilung, Bandhöhe, Knopfbreite).
- **e2e:** neue Blöcke in `gate3-trefflaeche.spec.ts` und `fokus-verdeckung.spec.ts`,
  eine neue Flächen-Spec, `fokus-kern.ts` (opt-in), `cls-kern.ts` (Move aus
  `einsatzauswahl-cls.spec.ts`). Die Laufzeit von `check-all.sh` Schritt 7 steigt.
- **Doku:** fünf Prüflisten, sechs Prüflisten mit umgehängtem Verweis (LFH-724),
  CLAUDE.md (Lagekarte bei 390 px, ETB „einziges sticky“).
- **Kein Backend, keine API, keine Migration.**
