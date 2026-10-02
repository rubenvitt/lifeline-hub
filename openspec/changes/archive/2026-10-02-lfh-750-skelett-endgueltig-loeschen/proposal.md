# Proposal

## Why

Nach der Schwärzung (LFH-23) bleibt das pseudonyme Skelett eines Einsatzes unbegrenzt
erhalten: Einsatzkopf, ETB im Wortlaut, Registriernummern, Triage- und Statuskategorien. Das
Skelett ist weiter personenbezogen, solange eine Registriernummer über eine Papierkarte auf
einen Menschen zurückführt. Eine Aufbewahrung ohne Ende verträgt sich nicht mit der
Speicherbegrenzung (Art. 5 Abs. 1 lit. e DSGVO). Gesetzliche Höchstfristen für die
Einsatzdokumentation (üblich sind 10 Jahre nach Einsatzende) gibt es, eine Löschung danach
nicht. LFH-750 ist das Folgeticket aus LFH-23 (Epic LFH-60). Am Checkpoint ist entschieden:
Das Skelett wird nach einer zweiten Frist endgültig gelöscht.

## What Changes

- **Neue Org-Einstellung „Skelett löschen nach (Tagen ab Abschluss)“** (`skelett_dauer_tage`).
  Sie ist opt-in: Leer heißt, das Skelett bleibt unbegrenzt erhalten, wie bisher. Ein
  Einsatz-Override gibt es nicht. Das erstmalige Setzen und jede Verkürzung muss der Admin
  ausdrücklich bestätigen, sonst antwortet das System mit 409, wie bei der Verkürzung der
  Einsatzfrist.
- **Neuer Schritt im Purge-Lauf: endgültige Löschung.** Ein geschwärzter Einsatz, dessen
  Skelett-Frist abgelaufen ist (Abschluss + `skelett_dauer_tage`, frühestens die Schwärzung),
  wird mit allen abhängigen Zeilen gelöscht (`DELETE FROM einsatz`, Kaskade), ETB
  eingeschlossen. Danach wird der WAL zurückgeschrieben wie nach einer Schwärzung (LFH-725).
  Nicht geschwärzte und aktive Einsätze sind nie betroffen.
- **Neues Löschprotokoll der Organisation** (Tabelle `aufbewahrung_loeschprotokoll`,
  Migration). Es entsteht im selben atomaren Vorgang wie die Löschung und hält Einsatz-ID,
  Einsatznummer, Abschluss, Schwärzung, Löschzeitpunkt, angewandte Frist in Tagen und den
  Akteur fest. Die Bezeichnung steht nicht darin. Der Audit ist fail-closed mit derselben
  Akteurskette wie bisher. Ohne Akteur unterbleibt die Löschung, und der nächste Lauf versucht
  es erneut.
- **Keine Wiedervergabe.** Einsatz-ID und laufende Einsatznummer eines gelöschten Einsatzes
  werden nie wieder vergeben. Die Vergabe berücksichtigt das Löschprotokoll.
- **Übersicht „Aufbewahrung“:** zwei neue Zustände, `loeschung_ausstehend` (Skelett-Frist
  abgelaufen, noch nicht gelöscht) und `endgueltig_geloescht` (Zeile aus dem Löschprotokoll).
  Abgeschlossene Einsätze zeigen „Löschung am“, sobald die Organisation eine Skelett-Frist hat.
  Gelöschte Zeilen tragen keine Bezeichnung und führen in keine Archivakte.
- **Einstellungsseite** (Verwaltung → Einstellungen → Einsatz, Abschnitt „Aufbewahrung“): neues
  Feld samt Bestätigungsdialog beim Setzen oder Verkürzen.
- `src/AGENTS.md`, Abschnitt Aufbewahrung: Regeln zur endgültigen Löschung (Löschprotokoll als
  einzige Spur, ID- und Nummernsperre, fail-closed).

## Capabilities

### New Capabilities

_keine_

### Modified Capabilities

- `aufbewahrung`: neue Anforderungen „Frist für die endgültige Löschung“, „Endgültige
  Löschung des Skeletts“ und „Löschprotokoll“. Geändert werden „Unwiderrufliche Schwärzung“
  (das Skelett bleibt bis zur endgültigen Löschung), „Auslöser der Aufbewahrung“ (der
  Purge-Lauf löscht auch endgültig) und „Lückenloser Audit im ETB“ (die endgültige Löschung
  auditiert im Löschprotokoll statt im ETB).
- `aufbewahrung-archiv`: „Aufbewahrungsübersicht“ bekommt neue Zustände, „Löschung am“ und
  Protokollzeilen. „Übersicht in der Verwaltung“ führt aus einer gelöschten Zeile in keine
  Akte. Die Archivakte eines gelöschten Einsatzes liefert 404, das deckt die bestehende Regel
  „unbekannter Einsatz“ ab, ohne dass sich die Anforderung ändert.

## Impact

- **Backend:** Migration (Spalte `org_einstellungen.skelett_dauer_tage`, Tabelle
  `aufbewahrung_loeschprotokoll`). Dazu `src/org/einstellungen.rs`,
  `src/routes/org_einstellungen.rs` (Validierung, Bestätigung, 409), `src/einsatz/retention.rs`
  (Zustände, Löschtermin), neu `src/einsatz/skelett_loeschung.rs` (Kandidaten, Löschung),
  `src/einsatz/repo.rs` (ID-/Nummernvergabe), `src/einsatz/purge_scheduler.rs` (neue Phase,
  Rückschrieb), `migrations/0136` auch für `secure-delete` am ETB-Suchindex (design.md D8),
  `src/aufbewahrung/{mod,repo}.rs` (Übersicht), `src/einsatz/schwaerzung_registry.rs`
  (Klassifikation der neuen Tabelle).
- **API/DTO:** `GET /api/aufbewahrung` bekommt neue Felder, und `bezeichnung` wird optional.
  Das Enum `AufbewahrungZustand` bekommt zwei Werte. `GET/PUT /api/org-einstellungen` bekommen
  das neue Feld und den Bestätigungsschalter. Der Typ-Codegen (`scripts/check-typ-codegen.sh`)
  muss danach laufen.
- **Frontend:** `frontend/src/aufbewahrung/AufbewahrungUebersicht.tsx`,
  `frontend/src/pages/einstellungen/EinsatzDefaults.tsx` und `orgEinstellungenForm.ts`, dazu
  `frontend/src/api/` und die generierten Typen.
- **Arbeitsanleitung:** `src/AGENTS.md`, Abschnitt „Backend — Aufbewahrung (LFH-23)“.
- **Betrieb:** Eine Sicherung von vor der endgültigen Löschung bringt das Skelett zurück. Der
  nächste Purge-Lauf löscht es erneut, denn die Frist leitet sich aus Abschluss und
  Org-Einstellung ab. `docs/betrieb/backup-restore.md` bekommt einen Satz dazu.
- Ohne gesetzte Org-Einstellung ändert sich kein Verhalten.
