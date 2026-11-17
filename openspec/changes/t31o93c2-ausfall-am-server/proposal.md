# Proposal

Zunder: https://zunder.rubeen.dev/#/aufgabe/t31o93c2k279hpnglvh99q6y (LLH-1929)

## Why

Die Alarmzeile „Was brennt“ nennt auf Überblick und Lagebild „Ausfall: <Einheit>“, auf dem
Lagemonitor fehlt diese Art (Change `t9jjrajy-alarmzeile-was-brennt`, D6, Variante B). Der Grund:
Die Regel „Ausfall je Einheit“ gibt es nur im Browser, und der Monitor bekommt nur verdichtete
Werte vom Server. Wer am Monitor die Lage liest, sieht deshalb nicht, dass eine Einheit ganz oder
teilweise ausgefallen ist.

## What Changes

- Der Server zählt den Ausfall je Einheit nach derselben Regel wie das Meldebild. Gezählt werden
  die eigenen Mittel jeder aktiven Einheit: Personal und Fahrzeuge im Status der Kategorie „nicht
  verfügbar“ (entfällt, wenn die Einheit selbst „nicht verfügbar“ meldet), dazu Material mit Rolle
  Alarm oder Achtung an der Einheit oder als Beladung ihrer Fahrzeuge. Mittel ohne bekannte
  Einheit fallen unter „Ohne Einheit“.
- Der Block `alarm` der Lagemonitor-Antwort trägt neu `ausfall`, eine Liste von
  Einheitsbezeichnungen. Personennamen trägt er weiterhin nicht.
- Der Lagemonitor zeigt „Ausfall: <Einheit>“ wie Überblick und Lagebild.
- Ein neuer Abschnitt `ausfall` im gemeinsamen Fixture `tests/fixtures/verdichtung/regeln.json`
  bindet die Regel in Browser und Server. Weicht eine Seite ab, wird ihr Test rot.
- Die Einheiten in „Ausfall: …“ stehen überall in der Folge der Einheitenliste (Sortierung, dann
  Anlage), „Ohne Einheit“ zuletzt. Bisher galt in Überblick und Lagebild die Baumfolge des
  Meldebilds. Sichtbar wird das nur, wenn mehr als eine Einheit ausfällt.

## Capabilities

### New Capabilities

Keine.

### Modified Capabilities

- `lagemonitor`: Die Anforderung „Alarmzeile ohne Personenbezug“ schließt die Art „Ausfall“ nicht
  mehr aus. Der Monitor nennt dieselben Einheiten wie Überblick und Lagebild.
- `lage-alarmzeile`: Die Anforderung „Quellen in der Alarmrolle“ legt fest, in welcher Folge die
  Einheiten mit Ausfall genannt werden.
- `lage-verdichtung`: Die Anforderung „Gemeinsames Fixture für Regeln beider Sprachen“ deckt
  zusätzlich den Ausfall je Einheit ab.

## Impact

- Backend: neue reine Zählung samt Lader (`src/einsatz/ausfall.rs`), `LagemonitorAlarm` in
  `src/routes/lagemonitor.rs`, Fixture-Test `tests/verdichtung_fixture.rs`, generierte Typen
  (`scripts/check-typ-codegen.sh`).
- Frontend: `lage/ausfallJeEinheit.ts` (Folge der Einheitenliste, Namensliste für die
  Alarmzeile), `lage/useWasBrennt.ts`, `lage/alarmAusMonitor.ts`,
  `lage/verdichtungFixture.test.ts`, `frontend/AGENTS.md` („Eine Heimat je Zahl“).
- API: Die Lagemonitor-Antwort bekommt ein zusätzliches Feld. Lagebild für Externe und API v1
  tragen den Block `alarm` nicht und bleiben unverändert.
- Keine Migration.
