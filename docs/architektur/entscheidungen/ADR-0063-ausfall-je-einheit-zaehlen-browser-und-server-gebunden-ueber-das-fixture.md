---
id: ADR-0063
titel: Ausfall je Einheit zählen Browser und Server, gebunden über das gemeinsame Fixture
status: akzeptiert
datum: 2026-11-17
gilt_fuer:
  - frontend/src/lage/ausfallJeEinheit.ts
  - frontend/src/lage/alarmAusMonitor.ts
  - src/einsatz/ausfall.rs
  - src/routes/lagemonitor.rs
  - tests/fixtures/verdichtung/regeln.json
herleitung:
  - openspec/changes/archive/2026-11-17-t31o93c2-ausfall-am-server/design.md
  - Zunder LLH-1929 (Heimat und Reihenfolge abgestimmt mit Ruben am 17.11.2026)
---

# ADR-0063: Ausfall je Einheit zählen Browser und Server, gebunden über das gemeinsame Fixture

## Regeln

- MUST: Der Browser leitet den Ausfall je Einheit nur aus den Gründen der Tönung des Meldebilds
  ab (`frontend/AGENTS.md`, „Eine Heimat je Zahl“). Der Server zählt ihn nur in
  `src/einsatz/ausfall.rs`.
- MUST: Eine Änderung der Regel ändert Browser, Server und den Abschnitt `ausfall` in
  `tests/fixtures/verdichtung/regeln.json` im selben PR; beide Fixture-Tests lesen jeden Fall.
- MUST: Einheiten mit Ausfall stehen überall in der Folge der Einheitenliste (`sortier`, dann
  `id`), „Ohne Einheit“ zuletzt; nie in der Baumfolge des Meldebilds.
- MUST NOT: Der Block `alarm` nennt beim Ausfall keine Person, nur Bezeichnungen von Einheiten
  (ADR-0057).

## Prüfung

```sh
verlange '"ausfall": \{' tests/fixtures/verdichtung/regeln.json
verlange 'einheiten_mit_ausfall' tests/verdichtung_fixture.rs
verlange 'einheitenMitAusfall' frontend/src/lage/verdichtungFixture.test.ts
verlange 'load_einheiten_mit_ausfall' src/routes/lagemonitor.rs
verlange 'einheitenMitAusfall\(' frontend/src/lage/useWasBrennt.ts
```

## Kontext

Die Alarmzeile nennt „Ausfall: <Einheit>“ auf Überblick, Lagebild und Lagemonitor. Der Monitor
bekommt nur verdichtete Werte vom Server, die Regel lebte aber nur im Browser (ADR-0057,
LLH-1929). Das Meldebild tönt aus gefilterten Listen und kann keine Server-Zahl lesen. Die Regel
braucht keinen Kräftebaum, weil jede Einheit nur ihre eigenen Mittel zählt.

## Konsequenzen

Der Monitor zeigt den Ausfall mit denselben Einheiten wie Überblick und Lagebild. Die Regel steht
zweimal, und das Fixture hält beide gleich. Die Folge der Einheitenliste ersetzt die Baumfolge.
Das ist sichtbar, sobald mehr als eine Einheit ausfällt.
