# Proposal

## Why

Der Backend-Kern der Aufbewahrung steht seit LFH-135/LFH-229. Beim Abschluss entsteht aus der
Dauer eine Frist, nach Fristablauf folgt ein Soft-Delete, nach 30 Tagen Karenz die
irreversible Schwärzung nach der Registry. LFH-23 ist trotzdem nicht fertig. Eine Spec für die
Politik fehlt (AK 1). Das aufbewahrte, pseudonyme Skelett kann in der App niemand mehr lesen,
weil `darf_lesen` nach Fristablauf alle sperrt, auch den Admin (AK 3, Teil „lesbar“). Die
Frist eines abgeschlossenen Einsatzes lässt sich in der Oberfläche nicht ändern, und
Wiederherstellen während der Karenz geht nur per DB-Eingriff. Ein ETB-Audit entfällt außerdem
still, wenn kein Akteur auffindbar ist. Welle D des Epics LFH-60 schließt diese Lücken. Der
Auftraggeber hat am 24.09.2026 entschieden: Der Org-Admin darf die gesperrte oder geschwärzte
Akte als pseudonymes Skelett lesen und während der Karenz wiederherstellen, mit ETB-Audit.

## What Changes

- **Die Aufbewahrungspolitik wird Spec.** Datenkategorien (Registry als einzige Quelle für
  Scrub/Retain), Frist-Politik, Sperre, Soft-Delete, Karenz, Schwärzung, Auslöser und Audit
  stehen als Anforderungen in `aufbewahrung`. Der gelieferte Bestand wird damit formal
  festgeschrieben. `design.md` ordnet jeder Anforderung die Tests zu, die sie heute pinnen.
  Damit ist AK 1 geschlossen.
- **„Org-Admin“ heißt hier: System-Admin derselben Organisation.** Eine eigene Rolle
  „Org-Admin“ gibt es nicht. Es gibt `system_rolle = admin` (schreibt die Org-Einstellungen)
  und die org-weite Führungskraft (liest den Admin-Bereich nur). Die Entscheidung wird auf
  den System-Admin abgebildet, begrenzt auf Einsätze seiner eigenen Organisation. Die
  Führungskraft ist ausgeschlossen.
- **Archiv-Lesepfad für den Org-Admin.** Ein eigener Namensraum `/api/aufbewahrung/…`, der
  bis auf das Wiederherstellen nur liest. Er zeigt den Einsatzkopf, das ETB und ein Register
  der Personen, Tiere und Schäden, und zwar **nur aus Spalten, die die Registry als Retain
  führt**. Vor und nach der Schwärzung liefert er deshalb dasselbe. Die Totalsperre der
  normalen Einsatz-Routen (`darf_lesen`) bleibt unverändert, auch für den Admin. Anhänge,
  Dokumente, Chat, Lagekarte, Export und Live-Strom sind im Archiv nicht lesbar.
- **Aufbewahrungsübersicht.** Neue Admin-Sektion „Aufbewahrung“ mit allen abgeschlossenen
  Einsätzen der eigenen Organisation und ihrem Zustand: ohne Frist, Frist läuft, fällig,
  vorgemerkt mit Karenz-Ende, Schwärzung ausstehend, geschwärzt. Von dort geht es in die
  Archivakte.
- **Wiederherstellen während der Karenz.** `POST /api/aufbewahrung/einsaetze/{id}/wiederherstellen`
  hebt die Löschvormerkung auf und setzt im selben Vorgang eine neue Frist, in der Zukunft
  oder unbegrenzt. Ohne neue Frist würde der nächste Purge-Lauf den Einsatz sofort wieder
  vormerken. Nur der Org-Admin darf wiederherstellen, und es entsteht ein ETB-Audit. Nach
  Karenz-Ende oder Schwärzung antwortet der Endpunkt 409, ohne Vormerkung 422.
- **Frist in der Oberfläche.** Der Einsatz zeigt seine Frist. Einsatzleitung und System-Admin
  können sie auch nach dem Abschluss setzen, verlängern oder aufheben. Eine Verkürzung gilt
  erst nach Rückfrage. Die eingefrorenen Einstellungen bleiben eingefroren, die Frist steht
  daneben.
- **Frist an vorgemerkten Einsätzen gesperrt.** `PUT …/aufbewahrungsfrist` auf einen
  vorgemerkten Einsatz antwortet 422 mit dem Hinweis auf das Wiederherstellen, auf einen
  geschwärzten 409. Heute ändert der PUT dort still `retention_bis`, und die Schwärzung kommt
  trotzdem.
- **Audit ohne stilles Auslassen.** Der Purge sucht für den System-Eintrag einen Akteur: die
  abschließende Person, dann die Einsatzleitung, dann einen Admin der Organisation. Findet er
  keinen, bricht er die Mutation ab und versucht es im nächsten Lauf erneut. Eine Löschung
  oder Schwärzung ohne ETB-Audit gibt es nicht mehr.
- **Ende-zu-Ende-Nachweis für AK 3.** Ein Integrationstest legt Person, Tier und Schaden über
  die API an, wechselt ihren Status und schließt ab. Dann lässt er den Purge über Frist und
  Karenz laufen und prüft die ETB-Spur, die Fremdschlüssel, die Pseudonyme und die
  Lesbarkeit durch den Admin.

Keine Änderung ist **BREAKING** für Clients. `PUT …/aufbewahrungsfrist` weist nur einen Fall
ab, der bisher wirkungslos durchlief (vorgemerkter oder geschwärzter Einsatz).

## Capabilities

### New Capabilities

- `aufbewahrung`: Aufbewahrungspolitik abgeschlossener Einsätze. Dazu gehören die
  Datenkategorien über die Registry, die Frist-Politik (Dauer, Org-Vorgabe, manuelle Frist
  mit Bestätigung), die Lesesperre nach Fristablauf, Soft-Delete, 30 Tage Karenz, die
  irreversible Schwärzung, die Auslöser und ein lückenloser ETB-Audit.
- `aufbewahrung-archiv`: Verwaltung und Einsicht der Aufbewahrung durch den Org-Admin, also
  Aufbewahrungsübersicht, pseudonyme Archivakte (Kopf, ETB, Register) und Wiederherstellen
  während der Karenz. Dazu kommen Anzeige und Änderung der Frist am Einsatz.

### Modified Capabilities

(keine; `openspec/specs/` führt nur `lagekarte-fachebenen`, das hier nicht berührt wird.)

## Impact

- **Backend:** neues Modul `src/aufbewahrung/` (DTOs, Zustandsableitung, Projektion, Repo),
  `src/routes/aufbewahrung.rs`, Router in `src/app.rs`, `src/einsatz/repo.rs`
  (`system_audit_tx`, `ermittle_system_akteur`, Wiederherstellen), `src/einsatz/retention.rs`
  (Zustand, Karenz-Ende), `src/routes/einsatz.rs` (`aufbewahrungsfrist_setzen`),
  `src/api_doc.rs`, `tests/enum_wire_kontrakt.rs`, Codegen (`openapi.json`,
  `types.generated.ts`). `darf_lesen` und `fordere_lesezugriff` bleiben unverändert.
- **Tests:** neu `tests/aufbewahrung.rs` (Lesepfad, Wiederherstellen, Übersicht, Guard des
  Namensraums) und `tests/aufbewahrung_e2e.rs` (AK 3), dazu Ergänzungen in `tests/einsatz.rs`
  und `src/einsatz/purge_scheduler.rs`.
- **Frontend:** Admin-Sektion `/admin/aufbewahrung` und Akte `/admin/aufbewahrung/:einsatzId`
  (`admin/adminNav.tsx`, `App.tsx`), neues Verzeichnis `aufbewahrung/`, Frist-Paneel in
  `pages/einstellungen/EinsatzAufbewahrung.tsx`, Hinweis in `EinsatzEinstellungenPage.tsx`,
  `api/aufbewahrung.ts`, `api/queryKeys.ts` (`globalKeys`), `theme/statusFarben.ts` (neue
  Vertragskarte `aufbewahrungZustand`, 24 → 25).
- **Migration:** keine, weil `retention_bis`, `geloescht_at` und `geschwaerzt_at` schon
  existieren.
- **Keine neuen Abhängigkeiten.**
- **Verhältnis zu Welle A (LFH-290/291):** unabhängig. Die Registry bleibt Quelle der
  Wahrheit, und der Audit-Text der Schwärzung bleibt hier unangetastet.

## Folgetickets

Aus den Nicht-Zielen und dem Review der Welle D (angelegt 25.09.2026):

- LFH-749 — Fristen je Datenkategorie
- LFH-750 — endgültige Löschung des Skeletts
- LFH-751 — Sofort-Schwärzung auf Antrag (Art. 17) je Einsatz und je Person
- LFH-752 — Wortlaut der System-ETB-Einträge laut `AUSNAHMEN_SYSTEM_ETB` (Annahme A2)
- LFH-753 — Org-Prüfung des System-Admins am `PUT …/aufbewahrungsfrist` und Verlängerung einer
  abgelaufenen Frist durch die Einsatzleitung (die Einstellungen liefern dann 403)
- LFH-754 — Routen-Guard gegen `.nest`/`.merge`/`any`/`on`, Karenzgrenze im Schwärzungs-UPDATE
- Umzug von `etb/filterZeit.ts` in ein gemeinsames Modul (ohne ID)
