# Tasks

Jede Aufgabe entsteht per `superpowers:test-driven-development` (erst der rote Test, dann der
Code). Befehle laufen in `frontend/` mit `mise exec -- pnpm …`.

## 1. Skala und Feldbreiten in den Tokens

- [x] 1.1 `schriftskala.kartentitel` (15/600, `text`) in `theme/tokens.ts` und
  `--lfh-typo-kartentitel-*` in `theme/rollen.css`; Test in `theme/tokens.test.ts` (Stufe 15/600)
  und `rollen.guard.test.ts` grün (`pnpm vitest run src/theme`)
- [x] 1.2 `FELDBREITE` (`kurz` 120, `schmal` 200, `mittel` 320, `voll` ohne Grenze) in
  `theme/tokens.ts`, `--lfh-feld-*` in `theme/rollen.css`, Deckungsgleichheit im
  `rollen.guard.test.ts`; Test rot vor dem Eintrag, grün danach

## 2. Bausteine

- [x] 2.1 `components/instrument/Textstufe.tsx` mit `Textstufe.test.tsx`: Stufe setzt Größe,
  Gewicht, Familie, Sperrung, Versalien; Ton setzt die Rollenfarbe (Tag und Nacht); `als="h3"`
  ändert Element, nicht Stil; Zahlenfamilie bekommt `tabular-nums`; Typ lässt keine Zahl als
  Stufe zu (`// @ts-expect-error` im Test). Dateikopf nennt die Regel
- [x] 2.2 `components/instrument/Stapel.tsx` mit `Stapel.test.tsx`: Lücke je Stufe aus dem Raster
  in `kompakt` und `komfortabel` (ConfigProvider mit `antdToken`), `richtung`, `umbruch`,
  `ausrichten`, `verteilen`, `wachsen`, `als`; `@ts-expect-error` für `abstand={12}`
- [x] 2.3 `components/instrument/MetaZeile.tsx` mit `MetaZeile.test.tsx`: Trenner zwischen Teilen,
  `aria-hidden`, leere Teile samt Trenner weg, `mono` in Stufe `meta`, eigener `ton` je Teil,
  Umbruch erlaubt; Prüfung des zugänglichen Namens ohne „·“
- [x] 2.4 `components/instrument/Feld.tsx` mit `Feld.test.tsx`: in einer `<Form>` gebunden,
  Pflichtfehler wie Form.Item, `maxWidth` je Breite, `voll` ohne Grenze, `InputNumber` füllt die
  Breite (Klasse `lfh-formfeld` in `index.css` (`lfh-feld` ist der Werteblock in `theme/sprache.css`)), `noStyle`/`dependencies` werden durchgereicht,
  `@ts-expect-error` für `style`
- [x] 2.5 Export der vier Bausteine über `components/instrument/index.ts`; `pnpm tsc -b` grün

## 3. Wächter

- [x] 3.1 Gemeinsame Scan-Hilfen aus `theme/abstandsraster.guard.test.ts` nach `test/ratsche.ts`
  ziehen (neben `test/ohneKommentare.ts`, weil es `node:fs` braucht und der Scan `test/` auslässt) (Kommentare entfernen, Dateien sammeln, Schuld vergleichen); Abstandsraster-Wächter
  unverändert grün
- [x] 3.2 `theme/schriftgroesse.guard.test.ts` + `schriftgroesse.schuld.ts`: Selbsttests (neues
  Literal rot mit Datei/Zeile/Wert, Schuld sinkt nur, Ausnahmen, CSS-px) und Bestandsprüfung;
  Schuld aus dem Stand vor dem Pilot erzeugt
- [x] 3.3 `components/feld.guard.test.ts` ersetzt `components/feldbreiten.guard.test.ts`:
  Selbsttests (Zahl-, String- und Konstantenbreite an Eingabefeldern rot, `<Form.Item` im
  Verwaltungsteil rot, Tabellenspalte und Fortschrittsbalken frei); zunächst mit Liste der noch
  nicht umgestellten Pilotdateien, die in Gruppe 4 auf leer sinkt

## 4. Pilot im Verwaltungsteil

- [x] 4.1 `stammdaten/`: `Form.Item` → `Feld` mit Breitenstufe, `maxWidth`/`width` an Feldern
  entfernt, `fontSize`-Stellen → `Textstufe` (13 → `text`/`textKlein`, 15 → `kartentitel`),
  Stapel und Metaangaben auf `Stapel`/`MetaZeile`; bestehende Tests der Dateien grün, Schulden
  in `schriftgroesse.schuld.ts` und `abstandsraster.schuld.ts` gesenkt
- [x] 4.2 `karten/` wie 4.1; Kommentarverweise auf den alten Wächter in
  `karten/OnlineQuellenVerwaltung*.tsx` nachgezogen
- [x] 4.3 `pages/einstellungen/` und `pages/BenutzerPage.tsx` wie 4.1; Verweis in
  `pages/einstellungen/EinsatzVerhalten.tsx` nachgezogen
- [x] 4.4 Liste der offenen Pilotdateien im `feld.guard.test.ts` ist leer und entfernt;
  `pnpm vitest run src/stammdaten src/karten src/pages/einstellungen src/pages/BenutzerPage src/components src/theme`
  grün

## 5. Regeltext und Design System

- [x] 5.1 `frontend/AGENTS.md`: Skala um `kartentitel`, Bausteine-Liste um `Textstufe`, `Stapel`,
  `MetaZeile`, `Feld`; Bausteinwahl um Zeilen für Text, Stapel und Metazeile, Feld-Zeile auf
  `Feld`; Regeltext, den die Bausteine tragen, gekürzt; Prettier grün
- [x] 5.2 Karten `Text`, `Stapel`, `MetaZeile` in `frontend/scripts/design-system/previews.tsx`,
  Karte `Eingabefeld` zeigt `Feld`; `pnpm design-system` erzeugt
  `docs/design/design-system/project/`, `designSystem.test.ts` und `designSystem.guard.test.ts`
  grün
- [x] 5.3 ADR „Text, Abstand und Feldbreite kommen aus benannten Stufen“ nach
  `docs/architektur/entscheidungen/VORLAGE.md` mit nächster freier Nummer auf `alpha`, `gilt_fuer`
  auf Bausteine, Wächter und Schuld; Prüfblock grün (`scripts/check-all.sh` ADR-Schritt)
- [x] 5.4 Folgeaufgaben je übrigem Bereich (Umstellung auf die Bausteine) und für Mono-Stufe sowie
  Knopfreihe per `zunder-task-anlegen` angelegt, Kennungen in der PR-Beschreibung

## 6. Prüfung

- [x] 6.1 `./scripts/check-all.sh --geaendert --ohne-e2e` grün (aus der Repo-Wurzel)
- [x] 6.2 Bilder vorher/nachher einer Stammdaten-Seite in `kompakt` und `komfortabel` aufgenommen
  (Wegwerf-Spec im Bildlauf, nicht committet)

## Workflow follow-up

- `/opsx:archive hzru8iq7-text-stapel-meta-feld` im selben Branch vor dem PR
- PR gegen `alpha`; nach dem Merge Design System neu veröffentlichen
