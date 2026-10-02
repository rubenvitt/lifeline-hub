# Proposal

## Why

Seit LFH-23 schwärzt das System Personendaten nur fristbasiert: Frist abgelaufen, Vormerkung
im Purge-Lauf, 30 Tage Karenz, dann die Schwärzung des ganzen Einsatzes. Verlangt eine Person
nach Art. 17 DSGVO die Löschung ihrer Daten, kann die Organisation dem nicht nachkommen, weder
für den ganzen Einsatz noch für diese eine Person. Die Spec `aufbewahrung` verbietet einen
manuellen Sofort-Auslöser heute ausdrücklich („in dieser Fassung“). LFH-751 ist das
Folgeticket, das LFH-23 dafür angelegt hat.

Entscheidung des Menschen vom 02.10.2026 (Phase-1-Checkpoint):

1. **Auslösen darf nur der System-Admin der Einsatz-Organisation**, wie Archivakte und
   Wiederherstellen.
2. **Karenz 24 Stunden.** Der Antrag wird erfasst und erst nach 24 Stunden vollzogen. Bis dahin
   kann der Admin ihn zurücknehmen.
3. **Nur an abgeschlossenen Einsätzen.** An einem laufenden Einsatz lehnt das System ab.
4. **„Eine Person“ umfasst Betroffene und weitere Personen:** Betroffene im Personenregister,
   ad hoc erfasste externe Kräfte, Anrufende am Informationstelefon und Ansprechpersonen im
   Presse-Log.

## What Changes

- Neuer **Schwärzungsantrag** (Löschersuchen nach Art. 17) im Archiv-Namensraum. Er zielt
  entweder auf den ganzen Einsatz oder auf genau eine Person. Pflicht sind ein Aktenzeichen des
  Antrags und eine Bestätigung durch Eintippen der Kennung (Einsatznummer bzw. Registriernummer
  oder Kennung der Zeile).
- Der Antrag ist **24 Stunden lang zurücknehmbar**. Danach vollzieht ihn der Purge-Lauf
  unwiderruflich. Ein vollzogener Antrag bleibt mit Aktenzeichen, Antragsteller und Zeitpunkten
  als Nachweis stehen.
- **Einsatz-Antrag:** Der Vollzug schwärzt den Einsatz mit demselben Registry-Scrub wie die
  fristbasierte Schwärzung, aber ohne Frist und ohne 30-Tage-Karenz. Der Einsatz ist danach
  `geschwaerzt` wie jeder andere.
- **Personen-Antrag:** Der Vollzug scrubbt nur die Zeilen dieser Person. Welche Spalten das
  sind, steht für jede Personenart in der Klassifikations-Registry, und ein Guard-Test prüft sie
  gegen die Fremdschlüssel der Datenbank. Das operative Skelett bleibt wie bei der
  Einsatz-Schwärzung: Registriernummer, Status, Sichtungskategorie, Zeitpunkte, Verweise.
- **ETB-Spur bleibt pseudonym:** Antrag, Rücknahme und Vollzug schreiben je einen System-Eintrag
  mit Aktenzeichen und Registriernummer bzw. Kennung, nie mit Namen.
- **Personensuche im Archiv:** Der Admin kennt den Namen der antragstellenden Person, die
  pseudonyme Akte zeigt ihn aber nicht. Eine Suche nimmt Name oder Kontakt entgegen und liefert
  die passenden Zeilen nur pseudonym zurück (Kennung, Art, Zeitpunkt, Status).
- Neuer Aufbewahrungszustand `schwaerzung_beantragt` für einen Einsatz mit offenem
  Einsatz-Antrag. Die Archivakte führt offene und vollzogene Anträge, und das Register markiert
  geschwärzte Personen.
- Frontend: In der Archivakte stehen die Aktionen „Einsatz sofort schwärzen“ und „Person suchen
  und schwärzen“, eine Antragsliste mit „Zurücknehmen“ und eine Rückfrage, die die
  Unumkehrbarkeit benennt.

## Capabilities

### New Capabilities
- `aufbewahrung-loeschersuchen`: Wer ein Löschersuchen nach Art. 17 stellen darf, für welchen
  Einsatzzustand, mit welchen Pflichtangaben und welcher Rückfrage. Dazu die 24-Stunden-Karenz
  mit Rücknahme, der Vollzug für Einsatz und Person, der Personenumfang je Personenart, die
  pseudonyme Personensuche und der Audit mit Antragsbezug.

### Modified Capabilities
- `aufbewahrung`: „Auslöser der Aufbewahrung“ bekommt den Schwärzungsantrag als weiteren
  Auslöser, statt einen Sofort-Auslöser zu verbieten. „Karenz von 30 Tagen“ und „Unwiderrufliche
  Schwärzung“ nehmen den Vollzug eines Einsatz-Antrags aus bzw. auf. „Lückenloser Audit im ETB“
  nennt Antrag, Rücknahme und Vollzug als Mutationen und den Antragsteller als ersten Akteur.
- `aufbewahrung-archiv`: „Zugriff nur für den Org-Admin“ umfasst Anträge und Personensuche.
  „Archiv liest nur, bis auf das Wiederherstellen“ heißt künftig „… bis auf Wiederherstellen und
  Schwärzungsantrag“ und erlaubt Antrag und Rücknahme; die Personensuche ist ein lesender Abruf
  mit Body. Die „Aufbewahrungsübersicht“ kennt den Zustand `schwaerzung_beantragt`.

## Impact

- **Backend:** neue Migration mit der Tabelle `schwaerzung_antrag` (einsatz-scoped, also in der
  Registry klassifiziert). Neues Modul für Antrag, Rücknahme, Vollzug und Personensuche unter
  `src/aufbewahrung/`. `src/einsatz/schwaerzung_registry.rs` bekommt die Personenbezüge je
  Personenart und einen Guard dafür. `src/einsatz/purge_scheduler.rs` bekommt eine Phase für
  fällige Anträge, `src/einsatz/retention.rs` den neuen Zustand. Neue Routen in `src/app.rs` und
  `src/routes/aufbewahrung.rs`. Der Guard `archiv_namensraum_nur_lesend_und_admin`
  (`tests/aufbewahrung.rs`) wird auf die neue Routenmenge umgestellt.
- **API/Codegen:** neue Response-DTOs und der Enum-Wert `schwaerzung_beantragt` →
  `scripts/check-typ-codegen.sh`, `openapi.json`, `types.generated.ts`,
  `tests/enum_wire_kontrakt.rs`.
- **Frontend:** `frontend/src/aufbewahrung/` (Akte, neue Dialoge, Antragsliste),
  `frontend/src/api/aufbewahrung.ts`, `frontend/src/api/queryKeys.ts`,
  `frontend/src/theme/statusFarben.ts` (Zustand).
- **Regeln:** `src/AGENTS.md`, Abschnitt „Backend — Aufbewahrung (LFH-23)“, bekommt den Antrag und
  den neuen Guard.
- **Nicht betroffen:** reguläre Einsatz-Routen, Lesesperre (`darf_lesen`), fristbasierter Purge,
  Wiederherstellen.
