# Löschersuchen nach Art. 17 nimmt die Fotos und Dateien einer Person mit (LFH-757 × LFH-751)

## Why

LFH-757 (Anhänge an Personen, PR #367) und LFH-751 (Löschersuchen nach Art. 17, PR #375) sind
parallel auf `alpha` gelandet. Danach war `alpha` zweifach rot:

1. Zwei Migrationen trugen die Nummer 0140 (`0140_schwaerzung_antrag`, `0140_einsatz_person_anhang`).
2. Der Guard `jeder_personenverweis_ist_als_bezug_deklariert` aus LFH-751 kennt den neuen Linker
   `einsatz_person_anhang` nicht. Er lässt sich mit den Mitteln von LFH-751 auch nicht deklarieren:
   der Personen-Scrub schreibt nur Spalten, der Linker wird beim Einsatz aber ganz gelöscht.

Entscheidung des Menschen am 03.10.2026: Ein Löschersuchen für eine betroffene Person löscht ihre
Fotos und Dateien samt Datei. Sie sind ihre Daten; sie bis zur Schwärzung des Einsatzes zu
behalten, liefe dem Antrag zuwider.

## What Changes

**Stand nach dem Merge von `alpha` (03.10.2026):** Umbenennung und Backend (`PERSONENANHAENGE`,
DELETE im Personen-Scrub, GUARD 1/4) sind parallel aus einer anderen Sitzung über PR #374 auf
`alpha` gelandet (`d33e1f8e`, `e6c2e638`), mit derselben Entscheidung. Dieser Change übernimmt
deren Umsetzung unverändert und ergänzt, was dort fehlt: die Specs, die Rückfrage im Frontend und
Testdaten mit Anhängen für die bestehenden Scrub- und Vollzugstests. Die Liste unten beschreibt
den Gesamtstand.


- Migration: `0140_einsatz_person_anhang` → `0142_einsatz_person_anhang` (wie PR #379: der später
  gemergte weicht aus, Inhalt unverändert, `0141_person_zugriff_audit_anhang` bleibt).
- Backend: neue Konstante `PERSONENANHAENGE` neben `PERSONENBEZUEGE`; `scrubbe_person` löscht die
  `anhang`-Zeilen der Person (auch schon entfernte), die Verknüpfung folgt per CASCADE. ETB und
  Zugriffsprotokoll bleiben.
- Guards: ein Personenverweis gilt als deklariert, wenn er in einer der beiden Listen steht; ein
  neuer Guard verlangt, dass ein Eintrag in `PERSONENANHAENGE` ein ganz gelöschter Linker mit
  `ON DELETE CASCADE` auf `anhang` ist und nicht zugleich in `PERSONENBEZUEGE` steht; Selbsttests.
- Frontend: Die Rückfrage vor dem Antrag nennt bei Betroffenen auch „ihre Fotos und Dateien“.

## Capabilities

### Modified Capabilities

- `aufbewahrung-loeschersuchen`: Vollzug für eine Person, Klassifikation der Personenverweise.
- `personen-anhaenge`: neue Anforderung „Löschersuchen löscht die Dateien der Person“.

## Impact

In diesem Change: `src/einsatz/schwaerzung_person_testdaten.rs`, `src/aufbewahrung/antrag_tests.rs`,
`frontend/src/aufbewahrung/SchwaerzungsantragDialog.tsx`, Specs. Über `alpha` (PR #374):
`src/einsatz/schwaerzung_person.rs`, `src/einsatz/schwaerzung_person_tests.rs`, `src/AGENTS.md`,
`migrations/0142_einsatz_person_anhang.sql`. Keine API- oder Typänderung.
