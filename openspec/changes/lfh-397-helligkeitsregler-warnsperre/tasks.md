# Tasks

Jede Aufgabe entsteht test-first (`superpowers:test-driven-development`): erst der rote Test,
dann der Code. Vorbild für die Achse ist die Bediendichte (LFH-329/361/392,
`git log origin/alpha --grep 'LFH-329\|LFH-361\|LFH-392' --name-only`).

## 1. Kern: Stufen und Sperre

- [x] 1.1 `theme/helligkeit.ts`: `Helligkeit`, `HELLIGKEIT_STUFEN`, `HELLIGKEIT_BODEN_WARNUNG`,
  `wirksameHelligkeit(wahl, warnungAktiv)`, `istHelligkeit(wert)`, `abdunkelung(stufe)`.
  Verifiziert durch `theme/helligkeit.test.ts`:
  - Sperre greift mit Warnung (40 → 80), aber nicht ohne (40 → 40).
  - Wahl über dem Boden bleibt (100 → 100).
  - Jede Stufe × beide Zustände als Tabelle mit **Literalen**.
  - **Mutationsprobe:** `warnungAktiv ?` entfernen (immer bzw. nie sperren) → rot. Ergebnis:
    je 4 rote Tests (29.09.2026).
- [x] 1.2 Boden-Herleitung als Guard: Der Test rechnet den WCAG-Kontrast von
  `alarmText`/`grund` unter Abdunklung aus `farbenDunkel`/`farbenHell` und prüft, dass
  `HELLIGKEIT_BODEN_WARNUNG` die kleinste Stufe mit ≥ 4,5 : 1 in beiden Paletten ist.
  Verifiziert durch die Mutationsprobe: Boden auf 60 → 6 rote Tests.

## 2. Träger und Darstellung

- [x] 2.1 `theme/ThemeModeProvider.tsx`:
  - `helligkeit`/`setHelligkeit` (Schlüssel `lifeline-hub.helligkeit`, Vorgabe 100,
    Müllwert → 100).
  - `useWarnsperre(aktiv)` (Anmeldung per `useId`, Abmeldung im Cleanup), `warnungAktiv`,
    `wirksam`.
  - Effekt setzt `data-helligkeit` und `--lfh-abdunkelung` am `<html>`.
  - Benannter Zugang `useHelligkeit()`, Fallback außerhalb des Providers.

  Verifiziert durch `ThemeModeProvider.test.tsx`:
  - Speichern und Neuladen.
  - Müllwert.
  - Eine Test-Quelle mit `useWarnsperre(true)` hebt `data-helligkeit` von 40 auf 80. Nach dem
    Unmount steht es wieder auf 40, und der Speicher bleibt 40.
  - Zwei Quellen: Das Abmelden einer Quelle hebt die Sperre nicht auf.
- [x] 2.2 `theme/rollen.css`: Abdunklungsschicht nach design.md D4 (`@media screen`,
  `pointer-events: none`). Guards `rollen.guard.test.ts`/`gate5.guard.test.ts` bleiben grün.
  Verifiziert durch den Quelltest „Regel steht unter `@media screen` und trägt
  `pointer-events: none`“.
- [x] 2.3 `index.html`: Das Bootstrap-Skript setzt die gespeicherte Stufe (Gültigkeitsprüfung
  gespiegelt, Querverweis in beiden Dateien). Verifiziert durch einen Test, der die
  Stufenliste in `index.html` gegen `HELLIGKEIT_STUFEN` pinnt, und durch den e2e-Fall in 5.1.

## 3. Warnsignal

- [x] 3.1 Backend `src/einsatz/zaehler.rs`: `MeldungsZaehler.bestaetigung_ueberfaellig`, mit
  derselben Regel wie `istAlarmiert` und Querverweis an beiden Stellen. Codegen über
  `scripts/check-typ-codegen.sh`, beide generierten Dateien mitcommitten. Verifiziert durch
  einen Integrationstest:
  - pflichtige Meldung mit abgelaufener Frist → 1
  - bestätigt → 0
  - nicht pflichtig → 0
  - Frist in der Zukunft → 0
- [x] 3.2 `einsatz/aktiveWarnung.ts`: `aktiveWarnung({ hoechsteWarnstufe,
  bestaetigungUeberfaellig })` über `warnstufeKennzahl[...].rolle === 'alarm'`. Verifiziert
  durch eine Tabelle über alle `Warnstufe`-Werte × {0, 1} (mit Literalen), und `undefined`
  (kein Recht / lädt) → keine Warnung.
- [x] 3.3 `einsatz/useAktiveWarnung.ts` (statt Durchreichen über `useModulZaehler`, das nur
  Anzeigewerte liefert): liest den Modulzähler über denselben Schlüssel per `select` und die
  Gefahrengebiete (nur mit `istModulFreigegeben`), verdichtet mit `verdichteGefahrengebiete`.
  `einsatz/EinsatzLayout.tsx` ruft `useWarnsperre(useAktiveWarnung(…))`. Default-Handler für
  `…/gefahrengebiete` in `test/server.ts`. Verifiziert zusätzlich durch
  `useAktiveWarnung.test.tsx` (ausgeblendet → 0 Anfragen; Mutationsprobe `enabled` → rot). Verifiziert durch
  einen Layout-Test mit MSW:
  - Gebiet `akut` → `data-helligkeit` = 80 bei Wahl 40.
  - Gebiet `mittel` → 40.
  - Zähler `bestaetigung_ueberfaellig: 1` → 80.
  - Gefahrengebiete 500 → 40.

## 4. Bedienung

- [x] 4.1 `theme/darstellungOptionen.ts`: `HELLIGKEIT_OPTIONEN` als Ableitung aus einem
  `Record<Helligkeit, …>`.
- [x] 4.2 `components/BenutzerMenu.tsx`: Gruppe „Helligkeit“ mit Sperrhinweis und gesperrten
  Stufen nach design.md D6. Verifiziert durch `BenutzerMenu.test.tsx`:
  - Fünf Einträge, „✓“ an der Wahl, Klick setzt die Wahl.
  - Mit Warnung: Überschrift nennt 80 %, Stufen 60/40/20 sind `aria-disabled`, die Wahl 40
    trägt „(wirkt 80 %)“.
- [x] 4.3 Sprungpalette: `HELLIGKEIT_BEFEHLE`, `setHelligkeit` in `typen.ts`/`useBefehle.ts`/
  `befehle.ts`. Verifiziert durch `befehle.test.ts` (Muster „Schnelleinstellung
  Bediendichte“).

## 5. Nachweise und Doku

- [x] 5.1 e2e `e2e/helligkeit.spec.ts`:
  - Stufe 40 wählen, neu laden → `data-helligkeit` = 40, bevor die App steht.
  - Ein Knopf unter der Schicht löst per **Klick** aus (LFH-355).
  - `page.emulateMedia({ media: 'print' })` → keine Abdunklung.
- [x] 5.2 CLAUDE.md: Absatz „Helligkeit“ unter der Bedien-Leitlinie (Träger, Sperre, Boden,
  „aktive Warnung“). Die Leitlinie unter `docs/superpowers/` bleibt unverändert
  (eingefrorenes Archiv).
- [x] 5.3 Prüfliste `pruefliste.md` für die Änderung (15 Zeilen, Verdikt je Zeile).
  Kriterium 8 steht auf „erfüllt“ mit Verweis auf den Träger.
- [x] 5.4 Gates, lokal soweit die Sitzung trägt:
  - rustfmt, Prettier, `pnpm lint`, `pnpm typecheck`, Codegen-Drift: grün.
  - `cargo test --lib` und die berührten Integrationstests (`modul_zaehler`,
    `openapi_spec_aktuell`, `enum_wire_kontrakt`, `meldung`): grün.
  - Vitest: 6833 grün, 10 rot. Die 10 roten (DemoDaten, kartenbilder, EtbFilterleiste,
    LageberichtVorschau, FachebenenInspector) scheitern auf `origin/alpha` identisch, sind
    also umgebungsbedingt.
  - `e2e/helligkeit.spec.ts`: 4/4 grün. Mutationsprobe ohne `pointer-events: none` →
    Klicktest rot.
  - Den vollen `./scripts/check-all.sh` (`cargo test --workspace`, ganze e2e-Suite) trägt
    die Plattenquote dieser Sitzung nicht; er läuft in der CI.
