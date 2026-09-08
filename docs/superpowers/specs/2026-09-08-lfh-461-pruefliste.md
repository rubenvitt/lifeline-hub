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

## Prüfbelege vom 08.09.2026

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

## Abschlussgrenze

Gezielte Task-Verifikation; kein Lauf des gesamten `scripts/check-all.sh` und
kein Dependency-Audit. Der PR bleibt bis zur Integration offen. Kein Merge im
Rahmen dieses Auftrags.
