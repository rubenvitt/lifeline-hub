# Proposal

Zunder: https://zunder.rubeen.dev/#/aufgabe/r3r7ul21obq13d9yk9535o3j (LLH-1888)

## Why

Das Einspielen eines Archivblocks über die Verwaltung ist an einer erreichten Instanz (einem Hub)
gesperrt, damit dort nie ein privater Archiv-Schlüssel liegt. Die Sperre zählt heute jede
angebahnte oder aktive Kopplung, in der sich eine andere Instanz hier meldet, also auch eine
**Direktkopplung vor Ort** (LLH-1497, LLH-1678). Ein ELW, der einem zweiten ELW einen Code für
die Direktkopplung ausgestellt hat, gilt damit als Hub und kann kein Archiv mehr einspielen,
obwohl er keiner ist: eine Direktkopplung trägt weder Stammdaten noch Geheimnisse, Verwahrung oder
Führungswechsel nach der Richtung, und sie macht die Instanz nicht öffentlich erreichbar.

## What Changes

- Die Hub-Sperre für das Einspielen zählt eine Direktkopplung vor Ort nicht mehr, gleich in
  welcher Richtung. Jede andere Art einer angebahnten oder aktiven Kopplung, in der diese Instanz
  die erreichte Seite ist, sperrt weiter, auch eine künftige Art.
- Am Hub (Standardkopplung, in der sich ein ELW hier meldet) bleibt das Einspielen gesperrt;
  Statuscode, Zeitpunkt der Prüfung und das Ausblenden der Aktion bleiben, wie sie sind.
- ADR-0045 nennt die Ausnahme in Regel und Prüfung; Anwender- und Betriebshandbuch beschreiben
  die Sperre entsprechend.

## Capabilities

### New Capabilities

_keine_

### Modified Capabilities

- `aufbewahrung-archiv`: Die Anforderung „Kein Einspielen an einer erreichten Instanz“ nimmt die
  Direktkopplung vor Ort aus.

## Impact

- Backend: `src/instanz/repo.rs` (`wird_erreicht`), Tests in `src/instanz/repo.rs` und
  `tests/archiv_einspielen.rs`. `src/routes/archiv_einspielen.rs` ruft dieselbe Funktion für
  Ablehnung und Verfügbarkeit und ändert sich nur im Text der Fehlermeldung, falls nötig.
- Kein Frontend-Code: die Oberfläche fragt `GET /api/admin/archiv/einspielen` und folgt der
  Antwort. Keine API-, Schema- oder Migrationsänderung.
- Doku: ADR-0045, `docs/anwender/kapitel/aufbewahrung.md`, `docs/betrieb/backup-restore.md`.
