# LFH-461 – Führungsstelle und anfängliche ETB-Vorbelegung

Task: https://app.clickup.com/t/86cb87twm

## Entscheidung und Verhalten

Die Führungsstelle liegt optional an der **Einsatz-Mitgliedschaft**. Dieselbe Person
kann in zwei Einsätzen unterschiedliche Stellen haben. Die Einsatzleitung pflegt
sie im bestehenden Abschnitt „Zugriff“ über ein Formular mit einem Feld.

- Migration 0100 ergänzt die nullable Spalte. Der bestehende Mitglieder-PUT erhält
  den Wert bei fehlendem Feld und löscht ihn bei null oder leerer Eingabe.
  Rollenwechsel und Feldänderung erfolgen atomar; die Stelle wird getrimmt und
  auf 200 Zeichen begrenzt. Bestehende Rechte-, Org- und Aktivitätsprüfungen gelten.
- Mitgliederdarstellung und Einsatzdarstellung tragen die typisierten Felder
  `fuehrungsstelle` bzw. `meine_fuehrungsstelle`. Die zweite Angabe gehört dem
  abfragenden Benutzer. Ohne Wert fehlt das optionale Feld. Gemeinsame
  Lage-Snapshots erhalten keine persönliche Vorbelegung.
- Der erste neue ETB-Entwurf bekommt An. Vorhandene Entwürfe gewinnen auch mit
  bewusst leerem An. Refetches ändern aktive Eingaben nicht. Weitere Entwürfe
  erhalten Werte ausschließlich durch „Werte behalten“.
- Ein lokaler Herkunftsmarker erhält bewusst geleerte Anfangs- und Folgeentwürfe
  über Remount/Reload. Unberührte Anfangsdefaults lösen keinen Autosave aus.
  Geschlossene Tabs werden weiterhin entfernt.
- Freitext wird bei der Einsatz-Schwärzung gelöscht; andere Einsätze bleiben
  unverändert. Ohne gesetzte Stelle erscheint kein An-Chip.

## Prüfbelege der ursprünglichen Umsetzung vom 08.09.2026

Alle nachfolgenden Prüfungen endeten mit Exit 0. Rust-Kommandos liefen über
`scripts/lib/dev-env.sh` / `ohne_dev_env`; Frontend-Kommandos im Verzeichnis
`frontend` über den dort installierten Runner.

| Prüfung | Ergebnis |
| --- | --- |
| `cargo test --lib` | 1243 Tests grün, einschließlich Migrationen und Registry-Guards |
| `cargo test --test einsatz` | 65 Tests grün |
| `cargo test --test fuehrungsstelle` | 3 Tests grün: Persistenz/Isolation, Rechte/Validierung, Schwärzung |
| Vitest: `src/etb/entwuerfe`, `Schnellerfassung.test.tsx`, `MitgliederAbschnitt.test.tsx` | 84 Tests grün |
| Vitest: `EtbPage.test.tsx`, `EtbPage.abschliessen.test.tsx`, `EinsatzdatenPage.test.tsx`, Dichte-/Aktionsabstands-Guards | 71 Tests grün |
| `scripts/check-typ-codegen.sh` | OpenAPI, generierte Typen, Driftprüfung und Typecheck grün |
| `scripts/check-fmt.sh`, ESLint `--max-warnings 0`, Vite-Produktionsbuild | grün |
| Playwright: `fuehrungsstelle.spec.ts` + `etb-entwurf-tabs.spec.ts` | 4 Fälle grün; neue Pflege-/Entwurfsprüfung bei 1280 und 390 px |
| `git diff --check` | grün |

Der Browserlauf verwendet eine eigene temporäre Datenbank und eine Kopie des aus
diesem Worktree gebauten Backends. Er prüft tatsächliche Pflege per Dialog/Enter,
Vorbelegung im ETB, Entfernen und Wiederladen eines gespeicherten Entwurfs sowie
einen zweiten Einsatz ohne Führungsstelle.

## RED/GREEN und Review

Vor der Implementierung scheiterten die Backend-Regressionen an fehlender
Persistenz bzw. nicht abgewiesener ungültiger Eingabe (Exit 101). Die Frontend-
Regressionen scheiterten an fehlender Anfangsbelegung und fehlendem Pflegeweg
(Vitest Exit 1). Die Implementierung färbte diese Fälle grün.

Das unabhängige Review fand zwei Fehler, die mit neuen Regressionen zuerst
reproduziert und anschließend behoben wurden:

1. Ein vollständig geleerter Entwurf sowie der leere Folgeentwurf nach Absenden
   mit ausgeschalteter Wertübernahme verloren beim Remount die Entscheidung
   gegen An. Beide Remount-Tests waren rot und sind jetzt grün.
2. Ein offener Mitglieder-Dialog konnte nach Einsatzwechsel die neue Route als
   Schreibziel verwenden. Der Wechsel-Test war rot und ist jetzt grün;
   Schreibziel und Cache-Aktualisierung tragen nun die ursprüngliche Einsatz-ID.

Das gezielte Re-Review hat beide Korrekturen freigegeben und keine belegte neue
Regression gefunden. Die unveränderten jsdom-/antd-Warnungen wurden nicht als
bestandene Assertions gezählt.

## Nacharbeit nach Merge von PR #19

PR #19 wurde am 08.09.2026 um 18:38:50 UTC als `fd435f50` integriert. Das
GitHub-Review traf um 18:42:15 UTC ein. Alle drei Befunde sind bestätigt:

1. Ein gecachter Einsatz wurde beim ersten ETB-Mount als endgültige Vorbelegung
   festgehalten, obwohl die Detail-Invalidierung nach dem Stellen-Speichern noch
   lief. Jetzt wartet die Initialisierung auf den laufenden Abruf. Danach schützt
   der Initialisierungsmerker die Entwürfe gegen Refetches. Auch eine verspätete
   IndexedDB-Antwort darf keine aktuellere Initialisierung überschreiben.
2. Der Stellen-Editor verwendete die allgemeine Admin-Ausnahme. Er verlangt jetzt
   zusätzlich die tatsächliche Einsatzleitungsrolle, wie `mitglied_setzen` im
   Backend. Die übrigen Verwaltungsaktionen sind nicht Gegenstand dieses Fixes.
3. Der Editor verwendet jetzt `ErfassungsModal` mit eigener Formularinstanz und
   `mutateAsync`. Der Absende-Knopf liegt im Formular; Fokus, Reset und Abbruch
   folgen dem Primitiv. Ein Einsatz-Key trennt die Mitgliederverwaltung beim
   Routenwechsel; verspätete Antworten aktualisieren nur ihren ursprünglichen
   Cache und schließen keinen neuen Dialog.

**RED:** `rtk proxy node node_modules/vitest/vitest.mjs run
src/pages/MitgliederAbschnitt.test.tsx src/pages/EinsatzdatenPage.test.tsx
src/pages/EtbPage.test.tsx -t 'LFH-461' --reporter=dot` (in `frontend`): Exit 1,
6 rot / 4 grün / 46 ausgelassen. Nachweis: falsche bzw. fehlende Vorbelegung trotz
Refetch, sichtbare Editor-Knöpfe für drei Nicht-Leitungsrollen eines System-Admins,
Absende-Knopf außerhalb des Formulars.

**GREEN:** folgende aktuelle Prüfungen endeten mit Exit 0:

| Prüfung | Ergebnis |
| --- | --- |
| Vitest: `src/etb/entwuerfe`, `Schnellerfassung.test.tsx`, `MitgliederAbschnitt.test.tsx`, `EinsatzdatenPage.test.tsx`, `EtbPage.test.tsx`, `Erfassung.test.tsx`, Schreibrecht-/Dichte-/Aktionsabstands-Guards | 199 Tests in 12 Dateien |
| Playwright: `fuehrungsstelle.spec.ts`, `etb-entwurf-tabs.spec.ts` | 4 Fälle; verzögerter Detailabruf + echte SPA-Navigation bei 1280/390 px, Fokus und Enter, Entfernen und Reload |
| `node node_modules/typescript/bin/tsc --noEmit` | grün |
| `node node_modules/eslint/bin/eslint.js . --max-warnings 0` | grün |
| `antd lint frontend/src/pages/MitgliederAbschnitt.tsx --format json` | keine Befunde |
| `node node_modules/vite/bin/vite.js build` | grün |
| `cargo build` via `ohne_dev_env` | grün; eigene Binary-Kopie für den Browserlauf |
| `git diff --check` | grün |

Das unabhängige, lesende Review der Nacharbeit gab den Diff ohne belegte Findings
frei. Rust-Code, Migration und generierte API-Typen bleiben unverändert; die oben
stehenden Rust-/Codegen-Testzahlen gehören zur ursprünglichen Umsetzung.

## Abschlussgrenze

Gezielte Task-Verifikation; kein Lauf des gesamten `scripts/check-all.sh` und
kein Dependency-Audit. PR #19 ist bereits integriert; der Folge-PR für die nach
dem Merge eingegangenen Review-Befunde bleibt bis zu seiner Integration offen.
Kein Merge des Folge-PRs im Rahmen dieses Auftrags.
