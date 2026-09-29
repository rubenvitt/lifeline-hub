# Tasks

## 1. Beleg des spezifizierten Bestands

- [x] 1.1 Die Szenarien der Spec laufen gegen die tragenden Tests. Dazu grün ausführen:
  `pages/uhs/UhsDetailPage.test.tsx` (LFH-341 · H38), `pages/lage-dashboard/LageDashboardPage.test.tsx`
  (Leeraktion „Person aufnehmen“), `pages/personen/AufnahmePage.test.tsx` (ohne Schreibrecht),
  `command-palette/befehle.test.ts`, `command-palette/schnellaktionen.guard.test.ts` und
  `pages/PersonenPage.test.tsx` (`?neu=1` öffnet die Maske), dazu serverseitig
  `tests/benutzer_einstellungen.rs` (geschlossener Schlüsselraum). Nachweis: Vitest-Lauf dieser
  sechs Dateien und `cargo test --test benutzer_einstellungen` ohne Fehler.

## 2. Verankerung

- [x] 2.1 In `CLAUDE.md` einen Absatz „Keine Arbeitsplatzachse (LFH-456)“ neben „UI-Form-Leitlinie“
  und „Bedien-Leitlinie“ einfügen. Er nennt die Entscheidung (Einstiege statt Achse, Kontext am
  Gerät), die Nicht-Zuständigkeit gegenüber `EinsatzRolle`/`schreibrecht.ts`, den Aufnahme-Fall
  und den Wiedervorlage-Auslöser und verweist auf diese `design.md`. Nachweis: Der Absatz steht
  im Frontend-Teil, und jeder darin genannte Pfad existiert (`rg`/`ls` je Pfad).
- [x] 2.2 `openspec validate lfh-456-keine-arbeitsplatzachse --strict` läuft ohne Fehler durch.
  Nachweis: Exit-Code 0.

## 3. Abschluss

- [x] 3.1 `./scripts/check-fmt.sh` bleibt grün (nur Markdown geändert, Prettier prüft `frontend/`).
  Nachweis: Exit-Code 0.
- [x] 3.2 LFH-456 in ClickUp mit Verweis auf die Entscheidung kommentieren. Keine Folge-Tasks
  (Variante 1). Nachweis: Der Kommentar steht am Task.
