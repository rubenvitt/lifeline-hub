# Proposal

## Why

Die Lese-Vorschau eines ETB-Eintrags in der Sprungpalette (LFH-664) zeigt bei einer
Berichtigung den Verweis auf ihren Grundeintrag, aber nicht die Rückrichtung: Wer einen
Eintrag öffnet, der später berichtigt wurde, liest ihn ohne den Hinweis „berichtigt durch
Nr. …“. Das ETB ist eine beweissichernde Unterlage, ein überholter Eintrag darf dort nicht
wie ein gültiger aussehen. Die Zeitachse kennt die Rückrichtung nur, weil sie einen Index
über die ganze geladene Liste bildet. Die Vorschau hat genau einen Eintrag, und die ETB-API
liefert keinen Weg, die Berichtigungen eines Eintrags zu erfragen (LFH-689, Nachzug aus
LFH-664, Prüfliste Zeile ETB/9).

## What Changes

- Jeder ETB-Eintrag auf dem Wire (Liste, Einzelladen, Antwort auf das Erfassen) trägt das
  neue Pflichtfeld `berichtigt_durch`: die Berichtigungen, die auf diesen Eintrag zeigen, je
  mit `id` und `lfd_nr`, aufsteigend nach Nummer, leer statt fehlend. Das Feld hängt nicht
  vom Listenfilter und nicht von der Seite ab.
- Ein Teilindex auf `etb_eintrag(berichtigt_eintrag_id)` (neue Migration), damit das
  Nachladen je Seite kein Tabellenscan ist.
- Die ETB-Vorschau der Palette nennt jede Berichtigung als Verweis „berichtigt durch Nr. Y ↗“,
  Wortlaut und Stil wie in der Zeitachse (blau, nicht rot). Ein Klick öffnet die Berichtigung
  im ETB und schließt die Palette. Ein Eintrag ohne Berichtigung zeigt keinen solchen Hinweis.
- Kein zusätzlicher Abruf: die Vorschau liest weiter das Nummernfach der Palette. Die
  Datenregel der Vorschau (`command-palette/AGENTS.md`) bleibt unverändert.
- Die Prüfliste LFH-664, Zeile ETB/9, wird fortgeschrieben.

Nicht in dieser Change: Zeitachse, Druck und Bilanz behalten ihren clientseitigen
`berichtigungsindex` (siehe design.md, Non-Goals).

## Capabilities

### New Capabilities

- `etb-berichtigung`: Die Verknüpfung zwischen einer Berichtigung und ihrem Grundeintrag in
  beiden Richtungen, wie sie die API am ETB-Eintrag ausliefert.

### Modified Capabilities

- `sprungpalette`: Die ETB-Vorschau nennt zusätzlich die Berichtigungen eines berichtigten
  Eintrags (Anforderung „Jede Datensatzsorte hat eine Vorschau“, neues Szenario und Satz).

## Impact

- Backend: `src/etb/mod.rs` (Feld und Verweistyp), `src/etb/repo.rs` (gebündelte
  Nachlade-Abfrage in `laden` und `abfrage`), `src/api_doc.rs` (Schema), neue Migration
  `migrations/0131_etb_berichtigt_index.sql` (Nummer vor dem Merge gegen `origin/alpha`
  prüfen), Tests in `tests/etb.rs` und die Schlüsselliste in `tests/aufbewahrung.rs`.
- Typ-Codegen: `frontend/src/api/openapi.json`, `frontend/src/api/types.generated.ts`.
- Frontend: `frontend/src/etb/EtbEintragVorschau.tsx` samt Test; ETB-Fixtures in Tests
  bekommen `berichtigt_durch: []` (Pflichtfeld bricht sonst den Typcheck).
- Doku: `docs/superpowers/specs/2026-09-24-lfh-664-pruefliste.md` (Zeile ETB/9).
- Antwortgröße: ein leeres Array je Eintrag, eine Abfrage mehr je ETB-Seite.
