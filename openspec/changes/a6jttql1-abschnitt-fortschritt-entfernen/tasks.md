# Tasks

Jede Aufgabe entsteht per `superpowers:test-driven-development`: erst der rote Test, dann der Code.
Frontend-Pfade ohne Präfix sind relativ zu `frontend/src/`.

## 1. Spalte und Schreibweg fallen (D1–D3)

- [x] 1.1 Integrationstests in `tests/einsatzabschnitt_lage.rs` auf das neue Verhalten
  umschreiben: Anlegen mit `"fortschritt":72` legt an, die Antwort trägt kein `fortschritt`
  (Spec-Szenario „Veralteter Client …“); PATCH mit `"fortschritt":40` ändert nichts und
  liefert 200 ohne das Feld. Die Grenztests 0–100/400 entfallen, Modulkommentar ohne
  „Fortschritt“. Nachweis: Tests rot vor 1.2–1.4.
- [x] 1.2 Migration mit der nächsten freien Nummer über `origin/alpha` (heute `0187`):
  `ALTER TABLE einsatzabschnitt DROP COLUMN fortschritt;` samt Kopfkommentar (LLH-1170,
  Herkunft `0109`). Nachweis: ein Test, dass `PRAGMA table_info('einsatzabschnitt')` keine
  Spalte `fortschritt` mehr meldet; `scripts/check-migrationen.sh` grün.
- [x] 1.3 `src/einsatzabschnitt/mod.rs` (DTO-Feld), `src/einsatzabschnitt/repo.rs` (SELECT,
  INSERT, PATCH-`CASE` samt Bind-Positionen, Testkonstruktoren) und
  `src/routes/einsatzabschnitt.rs` (`pruefe_fortschritt`, Felder in POST- und PATCH-Body) ohne
  Fortschritt. Nachweis: Tests aus 1.1 und die Repo-Unit-Tests grün.
- [x] 1.4 `src/einsatz/schwaerzung_registry.rs` ohne `retain("fortschritt", …)`. Nachweis: die
  Wächter-Tests des Registers (jede Spalte klassifiziert) grün.
- [x] 1.5 Demo-Daten: `src/demo/szenario.rs` (Feld und die drei Werte), `src/demo/import.rs`,
  `src/demo/import_tests.rs` (Abfrage und Erwartung, Doku-Kommentar „Fortschritt teils leer“).
  Nachweis: Demo-Import-Tests grün.
- [x] 1.6 Typ-Codegen: `scripts/check-typ-codegen.sh`, `api/openapi.json` und
  `api/types.generated.ts` neu erzeugt, ohne `fortschritt` am Abschnitt. Nachweis: Skript grün,
  beide Dateien im Diff.

## 2. Frontend und Doku ziehen nach (D5, D6)

- [x] 2.1 `api/einsatzabschnitte.ts`: Feld `fortschritt` samt Vermerk aus `AbschnittEingabe`.
  Fixtures in `pages/EinsatzabschnittePage.test.tsx`,
  `pages/einsatzabschnitte/AbschnittDetail.test.tsx`,
  `pages/einsatzabschnitte/AbschnittVorschau.test.tsx`, `pages/fuehrung/UeberblickPage.test.tsx`
  und `pages/fuehrung/ueberblickDaten.test.ts` ohne `fortschritt`; die Abwesenheitsprüfungen
  („kein Fortschritt“) bleiben. Nachweis: `tsc` und die genannten Vitest-Dateien grün.
- [x] 2.2 Kommentare in `pages/fuehrung/UeberblickPage.tsx` (Kopf „… und Fortschritt kommen aus
  dem Abschnitt“, `AbschnittEintrag` „fester Auftrag mit Fortschritt“) und
  `pages/einsatzabschnitte/AbschnittDaten.tsx` (Vermerk „Kein Fortschritt (LFH-1208)“) an den
  neuen Stand anpassen. Nachweis: Lint und Prettier grün.
- [x] 2.3 Anwenderdoku: `docs/anwender/kapitel/geraet-einsatzabschnitt.md` und
  `docs/anwender/kapitel/ueberblick.md` nennen „Fortschritt“ nicht mehr; die Bilder
  `geraet-einsatzabschnitt/abschnitt*.png` und `ueberblick/ueberblick*.png` prüfen und, falls
  sie den Fortschritt noch zeigen, nach `docs/anwender/AGENTS.md` neu erzeugen. Nachweis: die
  Doku-Wächter in `check-all.sh` grün.

## 3. Gesamtprüfung

- [x] 3.1 `grep -rni fortschritt` trifft im Abschnittskontext nichts mehr außer in
  `migrations/0109_einsatzabschnitt_lage.sql`, `openspec/changes/archive/` und
  `docs/superpowers/` (Upload-, Download- und Ladefortschritt ausgenommen). Nachweis: die
  Trefferliste im PR.
- [x] 3.2 `./scripts/check-all.sh` grün, `scripts/check-migrationen.sh` gegen `origin/alpha`
  grün. Nachweis: Lauf lokal bzw. CI des PRs.

## Workflow follow-up

- Nach Freigabe `/opsx:apply`, danach `/opsx:archive` im selben Branch vor dem PR (Spec-Sync
  nach `openspec/specs/einsatzabschnitt-bearbeitung/spec.md`).
