# Proposal

## Why

Auf der Seite Ablösung macht eine fremde Rhythmusänderung die geänderte Karte kurz vor
Mitternacht höher, und alle Karten darunter rutschen. Das verletzt Prüflisten-Kriterium 12
(„Kein Sprung unter dem Cursor“), das die Seite seit LFH-660 als erfüllt führt
(`docs/superpowers/specs/2026-09-22-lfh-635-pruefliste.md`, Nr. 12: „der frische Inhalt darf
die geänderte Karte nicht höher machen“). Aufgefallen ist es am 24.09.2026 gegen 23:30 CEST:
`e2e/abloesung-zufluss.spec.ts` war im Kontext mobil (390 px, `komfortabel`)
deterministisch rot (LFH-708). Tagsüber ist derselbe Test grün.

Reproduziert ist das mit fester Browser-Uhr (Playwright `page.clock.setFixedTime`, Zone
Europe/Berlin, Schichtbeginn fünf Minuten vor der festen Uhr). Um 12:00 bleiben alle drei Karten
175 px hoch. Um 23:40 wächst die mittlere Karte auf 198 px, Karte 3 rutscht von y 691,6 auf
714,6, also um die 23 px aus dem Ticket. Die Ursache steckt in der Seite, nicht im Test:

- Die Zeitspalte der Karte zeigt die Fälligkeit im Format `kurz`, also `HHmm` für heute und
  sonst `DDHHmm`. Sie hat nur eine Mindestbreite von 64 px und wächst mit dem Text. Liegt die
  Fälligkeit auf einem anderen Tag, ist sie 12 px breiter (mobil 73 → 85 px).
- Die Inhaltsspalte wird entsprechend schmaler (mobil 289 → 277 px). Die Sekundärzeile
  „Deichwache Nord · im Einsatz seit 2335 · Rhythmus 30 min (eigener Wert)“ bricht nach der
  fremden Änderung („6 h“ → „30 min“) in eine dritte Zeile um. Tagsüber passt sie knapp in
  zwei Zeilen.

Ob die Karte springt, hängt also an der Uhrzeit und an wenigen Pixeln Reserve. Der grüne
Tageslauf hat das nur verdeckt.

## What Changes

- **Zeitspalte in fester Breite:** Die Spalte bekommt immer die Breite des breitesten
  `kurz`-Formats (sechs Mono-Ziffern). Ihre Breite und damit der Umbruch der ganzen Karte
  hängen nicht mehr von Tageszeit oder Tageswechsel ab.
- **Rhythmus in eigener Zeile:** „Rhythmus … (Quelle)“ steht in einer eigenen Zeile, getrennt
  von „Abschnitt · im Einsatz seit …“. Eine fremde Rhythmusänderung ändert dann nur diese Zeile.
- **Kürzere Quellenangabe:** Statt „(Vorgabe des Abschnitts)“ und „(eigener Wert)“ steht
  „(Vorgabe)“ bzw. „(eigen)“. Den Abschnitt nennt die Zeile darüber schon. So bleibt die
  Rhythmuszeile für jeden zulässigen Rhythmus (bis 7 Tage) einzeilig, gemessen bis 226 px
  Inhaltsbreite.
- **e2e gegen die Uhr:** `e2e/abloesung-zufluss.spec.ts` läuft im Fall „fremde
  Rhythmusänderung“ je Kontext mit fester Uhr am Tag (12:00) und kurz vor Mitternacht (23:40,
  Europe/Berlin). Zusätzlich misst er die Höhe jeder Karte.
- Prüfliste LFH-635, Nr. 12 bekommt den Befund, die neuen Messwerte und die benannten Reste.

## Capabilities

### New Capabilities

Keine.

### Modified Capabilities

- `kraefte-abloesung`: Die Anzeige im Modul hält Breite der Zeitspalte und Höhe der Karten
  unabhängig von der Tageszeit, und eine fremde Rhythmusänderung macht die geänderte Karte
  nicht höher. Die Kennzeichnung der Rhythmusquelle heißt „Vorgabe“ bzw. „eigen“.

## Impact

- Frontend: `frontend/src/abloesung/AbloesungKarte.tsx` (Zeitspalte, Zeilenschnitt,
  Quellenwort), Vitest neben der Karte bzw. in `pages/AbloesungPage.test.tsx`, wo Texte mit
  „Vorgabe des Abschnitts“/„eigener Wert“ geprüft werden.
- e2e: `frontend/e2e/abloesung-zufluss.spec.ts` (feste Uhr, Tag und Mitternacht, Kartenhöhe).
- Doku: `docs/superpowers/specs/2026-09-22-lfh-635-pruefliste.md` (Nr. 12).
- Kein Backend, keine API, keine Migration. Die Wörter im ETB-Nachweis des Backends bleiben
  unverändert. Es ändert sich nur die Anzeige auf der Karte.
