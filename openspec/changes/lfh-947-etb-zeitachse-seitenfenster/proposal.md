# Proposal

## Why

ETB-Tabs bleiben in der Führungsstelle 24 bis 72 Stunden offen. Wer einmal tief geblättert hat
(„Ältere laden“ oder ein Sprung auf einen alten Eintrag), zahlt danach bei jedem neuen
ETB-Eintrag: Das Live-Ereignis lädt alle geladenen Seiten nacheinander neu, bei 30 Seiten sind das
30 Abrufe in Folge, und der neue Eintrag erscheint erst nach der ganzen Kette. Dazu rendert die
Zeitachse bei jedem Anlass alle Zeilen neu und parst dabei das Markdown jedes Eintrags erneut, und
jede Zeile hängt eigene Medienabfrage-Hörer an (acht je Zeile). Auf Feld-Tablets ruckelt dann die
Schnellerfassung.

## What Changes

- **Seitenfenster:** Die ETB-Liste hält höchstens 5 Seiten zu je 100 Einträgen. Wer weiter
  blättert, verliert die Seiten am anderen Ende aus dem Speicher. Ein Live-Ereignis lädt damit
  höchstens 5 Seiten neu.
- **Neuere laden:** Ist das Fenster nicht mehr am neuesten Eintrag, steht über der Zeitachse der
  Knopf „Neuere laden“. Er führt lückenlos zurück bis zum neuesten Eintrag.
- **Aufsteigender Cursor in der API:** `GET /api/einsaetze/{id}/etb` nimmt `after_lfd_nr`: die
  Einträge direkt über dieser Nummer, Seite weiter absteigend sortiert. `before_lfd_nr` und
  `after_lfd_nr` zusammen weist der Server mit 422 ab. Zählungen bleiben unverändert.
- **Sprung auf einen Eintrag (`?eintrag=`):** Liegt das Ziel außerhalb des Fensters, blättert die
  Seite in die richtige Richtung (älter oder neuer), bis es da ist. Das Ziel bleibt im Fenster und
  wird hervorgehoben, auch offline aus dem Gerätespeicher.
- **Rendern ohne Neu-Parsen:** Liste, Chronologie, Zufluss-Teilung und Stundengruppen werden nur
  neu abgeleitet, wenn sich ihre Eingaben ändern; jede Zeile ist eine eigene, gemerkte
  Komponente; die Markdown-Anzeige parst nur bei geändertem Text neu.
- **Fensterung im Browser:** Jede Stundengruppe bekommt `content-visibility: auto` mit einer
  geschätzten Höhe; keine neue Abhängigkeit.
- **Ein Satz Medienabfrage-Hörer:** Die Viewport-Abfrage registriert ihre Breiten- und
  Zeigerabfragen einmal für die ganze Seite statt je Komponente. Ihre Antwort bleibt dieselbe.
- Kopfzahl und Bilanz zählt weiter der Server; eine Zahl des geladenen Fensters erscheint
  nirgends.

## Capabilities

### New Capabilities

- `etb-zeitachse-fenster`: Wie die ETB-Zeitachse Einträge seitenweise in einem begrenzten
  Fenster hält, in beide Richtungen nachlädt, auf einen Eintrag springt und dabei ohne
  wiederholtes Parsen rendert; dazu der aufsteigende Cursor der Listen-API.
- `viewport-abfrage`: Die Breiten- und Zeigerabfrage des Frontends hält je Seite einen Satz
  Medienabfrage-Hörer, unabhängig davon, wie viele Komponenten fragen.

### Modified Capabilities

Keine. `etb-zaehler` (Kopfzahl und Bilanz über denselben Filter) gilt unverändert.

## Impact

- Backend: `src/routes/etb.rs` (`EtbAbfrageParams.after_lfd_nr`, Validierung), `src/etb/repo.rs`
  (`EtbFilter`, `abfrage`), Tests in `src/etb/repo.rs` und `tests/`. Keine Migration, kein neues
  Response-DTO.
- Frontend: `api/etb.ts`, `pages/EtbPage.tsx`, `etb/EtbZeitachse.tsx` (Zeile als eigene
  Komponente), `components/Markdown.tsx`, `components/useViewport.ts`, `index.css` oder
  Zeitachsen-Stil, Tests dazu; e2e-Gate für den Sprung auf einen alten Eintrag.
- Regeln: `frontend/src/etb/AGENTS.md` (Seitenfenster), `frontend/AGENTS.md` bzw. Dateikopf von
  `useViewport.ts` (ein Hörersatz).
- Nutzt die zentrale Live-Entprellung unverändert.
