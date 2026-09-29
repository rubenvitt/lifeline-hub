# Proposal

## Why

Das Fachmodul Betreuung (LFH-639) speichert Stand- und Belegungsmeldungen append-only und
kann jede davon zurücknehmen. Die Oberfläche zeigt aber nur den aktuellen Stand. Zurücknehmen
lässt sich eine Meldung nur über den Rückgängig-Toast direkt nach dem Melden. Eine ältere
Fehlmeldung, etwa eine vertippte Nachtragung von vor einer Stunde, ist gezielt nicht
erreichbar, obwohl die Route sie annimmt. LFH-639 hat diese Lücke als Risiko benannt
(design.md, „Risks: Verlaufsansicht“), LFH-676 schließt sie.

## What Changes

- Zwei neue Lese-Endpunkte liefern die vollständige Meldereihe eines Bezirks bzw. einer
  Stelle, zurückgenommene Meldungen eingeschlossen. Jede Meldung trägt Anzahl, Zeitpunkt,
  Erfassungszeit, erfassende Person, die Marke „aktuell“ und gegebenenfalls Zeit und Person
  der Rücknahme.
- Die Betreuungsseite bekommt an jeder Bezirkskarte und jeder Stellenzeile einen
  Inline-Expander „Verlauf“ (UI-Form-Leitlinie: Inline für kontextbezogenen Zusatzinhalt).
  Er lädt die Reihe erst beim Aufklappen.
- Im Verlauf sind die aktuelle, nachgetragene und zurückgenommene Meldungen erkennbar, nicht
  nur über Farbe, sondern auch über Wortlaut.
- Jede nicht zurückgenommene Meldung lässt sich mit Schreibrecht aus dem Verlauf
  zurücknehmen, nach einer Rückfrage. Dafür dienen die bestehenden Rücknahme-Routen, ihr
  Verhalten ändert sich nicht.
- Das Primitiv `Datensicht` bekommt einen beschrifteten Aufklappbereich, der im Tabellen- und
  im Kartenzweig gleich funktioniert. Die Plan-Karte hatte bisher keinen Aufklappbereich, der
  Tabellenzweig nur das unbeschriftete Aufklapp-Symbol von antd.

## Capabilities

### New Capabilities
- `betreuung-meldeverlauf`: Lesen der Stand- und Belegungsreihen und Zurücknehmen einzelner
  Meldungen aus dem Verlauf heraus.

### Modified Capabilities
- keine. Die Anforderungen an Meldung und Rücknahme aus LFH-639
  (`openspec/changes/lfh-639-fachmodul-betreuung/specs/betreuung-evakuierung/spec.md`)
  bleiben unverändert. Diese Änderung macht sie nur über die Oberfläche erreichbar.

## Impact

- **Backend:** `src/betreuung/` (Anzeige-DTOs, Repo-Lesefunktionen), `src/routes/betreuung.rs`,
  Routenregistrierung, `src/api_doc.rs`, Tests in `tests/betreuung.rs`. Keine Migration, die
  Spalten existieren seit `0117_betreuung.sql`.
- **Frontend:** `api/betreuung.ts`, `api/queryKeys.ts` (Unterschlüssel unter
  `EINSATZ_KEYS.betreuung`, dadurch live), generierte Typen, `components/Datensicht.tsx`,
  `betreuung/EvakuierungBlock.tsx`, `betreuung/StellenBlock.tsx`, eine neue
  Verlaufskomponente samt Rückfrage.
- **Keine** neue Route, kein neues Live-Ereignis, keine neue Statusfarbkarte.
