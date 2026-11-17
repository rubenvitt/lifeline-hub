# Tasks

## 1. Kern für Dauern

- [x] 1.1 `anzeige/dauer.ts` mit `dauer`, `relativ`, `vorText`, `dauerZwischen` und `dauerAusgeschrieben` (D1, D2) per TDD anlegen. Prüfung: `anzeige/dauer.test.ts` deckt 0, 45, 60, 301 und 480 min ab, dazu 26 h 05 min ohne und mit Tagen, 167 h 59 min, die Vorwörter, „gerade eben“, „in < 1 min“, eine Zukunftszeit (Uhrversatz) und UTC-Wire-Strings.
- [x] 1.2 Gemeinsame Testpaare für Rust und Frontend in `anzeige/dauer.faelle.json` ablegen; `dauer.test.ts` liest sie. Prüfung: Vitest grün.
- [x] 1.3 Wächter `anzeige/dauer.guard.test.ts` nach D6 anlegen, die Schuldmenge `OFFEN` mit dem Bestand füllen. Prüfung: Er ist grün, eine eingefügte Probe `${n} min` unter `pages/` macht ihn rot (Mutationsprobe, danach zurücknehmen).

## 2. Helfer und Aufrufer umstellen

Jede Aufgabe stellt die Tests ihrer Aufrufer mit um und streicht ihre Dateien aus `OFFEN`.

- [x] 2.1 `einsatz/einsatzDauer.ts` → `dauerZwischen` mit Tagen (Fuß „Einsatzdauer“, Einsatzbericht). Prüfung: `einsatzDauer`-Aufrufer-Tests und `druck/einsatzbericht`-Tests zeigen „5 h 01 min“ bzw. „2 d 14 h“.
- [x] 2.2 Lagebild-Kennzahl Einsatzdauer (`lagebild.ts:einsatzdauer`, D3) samt Großbild und Lagebesprechung. Prüfung: `lagebild.test.ts` und `LagebildGrossbild.test.tsx` mit „5 h 01 min“, ohne gesonderte Einheit.
- [x] 2.3 `abloesung/dauer.ts`: `formatDauer` entfällt zugunsten von `dauer` (ohne Tage). `parseDauer` liest zusätzlich „7 h 30 min“ und „7 h 30“, die Fehlermeldung nennt die neue Form. Alle Aufrufer (Ablösung, Schichtmodelle, Planung, Grenzwerte, Schichtplan-Druck, `kraefte/zeitachse.ts` Grenzwerttexte) ziehen mit. Prüfung: `dauer.test.ts` mit Rundweg Anzeige → Eingabe, `AbloesungPage.test.tsx` mit „7 h 30 min“ im Feld, Rhythmuszeile „167 h 59 min“ einzeilig im bestehenden Test.
- [x] 2.4 `kraefte/zeitachse.ts:dauerText` → `dauer` ohne Tage (Meldebild, Personal, Einheit, BR, Einsatzbericht Helferstunden). Prüfung: `zeitachse.test.ts` und die Seitentests zeigen „7 h 40 min“ und „2 h“.
- [x] 2.5 `lagebesprechung/lagebesprechungZustand.ts:dauerText` und `pages/uhs/dringlichkeit.ts:wartezeitText` → `dauer`/`relativ`. Prüfung: `lagebesprechungZustand.test.ts`, `dringlichkeit.test.ts`, `ueberblickDaten.test.ts` und `meldebildRaster`-Tests grün mit unveränderten bzw. angepassten Texten.
- [x] 2.6 `anzeige/abstand.ts:formatVor` → `vorText` im Kern; Aufrufer (Sichtung, Patientenkopf, Nachforderung, Offene Vorgänge, Spiegel, Lagemonitor, `SitzungsListe` mit eigener Schwelle) umstellen und `abstand.ts` entfernen. Prüfung: `Patientenkopf.test.tsx` und die Spiegel-Tests zeigen „vor 3 h 05 min“.
- [x] 2.7 Inline-Stellen: `lage/wasBrennt.ts` („längste 5 h 01 min“), `geraet/GeraeteKopf.tsx` (ganze Stunden „noch 5 h“, auch über einen Tag, D7), `etb/schnellerfassungModell.ts` („Ereignis vor 1 h 05 min“). Prüfung: ihre Tests. Danach ist `OFFEN` im Wächter leer.

## 3. Server

- [x] 3.1 `dauer_text` in `src/zeitdarstellung.rs` (D7) per TDD anlegen; der Test liest `frontend/src/anzeige/dauer.faelle.json` (nur Fälle ohne Tage). `plan.rs:dauer_text` und `abloesung::rhythmus_text` rufen sie auf. Prüfung: `cargo test zeitdarstellung` und `cargo test schichtplan` grün, der Export nennt „13 h 30 min im Dienst“.

## 4. Uhr

- [x] 4.1 `formatiereUhr` mit Darstellung nach `anzeige/zeitDarstellung.ts` verlegen (D4), Kopfleiste und Gerätekopf lesen die Konventionen; die Ausnahme im Zeit-Wächter entfällt. Prüfung: `Kopfleiste.test.tsx` zeigt taktisch „0705“ und bei Gerätewahl ohne Neuladen „07:05“.
- [x] 4.2 Uhr aus dem Lagebild-Titel nehmen (`lagebildZeit` entfällt), Großbild von Lagebild und Lagebesprechung sowie Lagemonitor nehmen den `Uhr`-Baustein. Prüfung: `LageDashboardPage.test.tsx` findet neben dem h1 keine Uhrzeit, `LagebildGrossbild.test.tsx` und `LagemonitorPage.test.tsx` zeigen „1733“.

## 5. Datenstand

- [x] 5.1 `components/Datenstand.tsx` mit Option `alter` (D5): ab 1 min „· vor 2 min“, darunter nichts, Reihenfolge „Stand 1731 · vor 2 min · offline“. Prüfung: `Datenstand.test.tsx` mit 20 s, 2 min, offline, anderem Tag.
- [x] 5.2 Lagebild, beide Großbilder und Lagemonitor nehmen `Datenstand alter`; `standText` entfällt, der Lagemonitor behält „Veraltet“ ab 2 min. Prüfung: Seitentests, e2e `lagebild-offline.spec.ts` liest die Uhrzeit per Muster.

## 6. Doku und Regeln

- [ ] 6.1 `frontend/AGENTS.md`, „Zeitdarstellung“: Dauerkern, Wächter, Uhr folgt der Darstellung (E5), Datenstand-Baustein; Verweise auf `formatVor`/`einsatzDauer` greppen und nachziehen. Prüfung: `rg 'formatVor|einsatzDauer|formatDauer|lagebildZeit|standText' frontend/ docs/ .claude/` leer bzw. nur Archiv.
- [ ] 6.2 Anwenderdoku: Texte mit alten Dauern oder Uhren berichtigen (`rg '[0-9]:[0-9]{2} h|Stand vor' docs/anwender`), betroffene Bilder per Bildlauf neu aufnehmen. Prüfung: Doku-Wächter von `check-all.sh` grün.

## 7. Integration

- [ ] 7.1 `./scripts/check-all.sh --geaendert --ohne-e2e` grün; e2e-Specs, die Uhr, Stand oder Dauern lesen (`lagebild-offline`, `lagekarte-smoke`, `abloesung-zufluss`), einzeln laufen lassen.

## Workflow follow-up

- In `openspec/specs/zeitdarstellung/spec.md` beim Archivieren unter „Entscheidungen“ E5 nachtragen: Die Uhr im Kopf folgt der Darstellung, Dauern haben eine Form (LLH-1750, 17.11.2026). Dazu E2 auf Zeitpunkte einschränken.
