# Tasks

## 1. Kern der Stärke

- [ ] 1.1 `anzeige/staerke.ts`: `STAERKE_SCHREIBWEISE`, `STAERKE_AUSGESCHRIEBEN`, `staerkeBeschreibung(wert)`; `StaerkeAnzeige` mit `aria-label` und `title` (D1) per TDD. Prüfung: `StaerkeAnzeige.test.tsx` findet den Wert per zugänglichem Namen „… Führer / Unterführer / Mannschaft // Summe“.
- [ ] 1.2 Wächter `anzeige/staerke.guard.test.ts` (D4) mit Schuldmenge aus dem Bestand. Prüfung: grün; die Probe `//Ges` in einer Seite macht ihn rot (Mutationsprobe, zurücknehmen).

## 2. Flächen

Jede Aufgabe stellt die Tests der Fläche mit um und streicht sie aus der Schuldmenge.

- [ ] 2.1 Überblick: Feldetikett „F/UF/M//Σ“, Wert über `StaerkeAnzeige`; „UA“ → „inkl. Unterabschnitte · n Unterabschnitte“, Lagezustand „Unterabschnitt kritisch“. Prüfung: `UeberblickPage`-Tests.
- [ ] 2.2 Organigramm und Einsatzabschnitte (`Organigramm.tsx`, `AbschnittKnoten.tsx`, `EinsatzabschnittePage.tsx`, `GeraetAbschnittPage.tsx`): Legende „Stärke F/UF/M//Σ“ in der Paneel-Meta, auch im Druck. Prüfung: Komponententests und Druckvorschau-Test.
- [ ] 2.3 Meldebild (`KraefteuebersichtPage.tsx`, `meldebildMeta`, Druckkopf) und Kräfte-Verdichtungszeile („Fahrzeuge n“): Spaltenkopf „Stärke F/UF/M//Σ“. Prüfung: Seitentests.
- [ ] 2.4 `kraefte/kraeftebild.ts`: „F/UF/M//Ges“ → „F/UF/M//Σ“, „n.v.“ → „nicht verfügbar“. Prüfung: `kraeftebild.test.ts`.
- [ ] 2.5 Detailpaneele (`EinheitVorschau`, `FahrzeugVorschau`, `AbschnittDetail`, `AbschnittDaten`, `EinheitKopf` Ist und Soll, `EinheitTypenTab`, `BrDetailPage`): Etikett aus der Konstante, Soll ohne Summe → mit Summe. Prüfung: ihre Tests.
- [ ] 2.6 Lagebild, Großbild, Lagebesprechung: Notiz „n Einheiten · Stärke 1/2/5//8“ mit Beschreibung; „Verbleib offen“ mit Notiz „wohin nicht erfasst · n unterwegs“. Prüfung: `lagebild.test.ts`, `LagebildGrossbild.test.tsx`, `vorbereitung`-Tests.
- [ ] 2.7 Lagemonitor: Kachel „Kräfte“ über `staerkeText` mit Summe. Prüfung: `LagemonitorPage.test.tsx` zeigt „Stärke F/UF/M//Σ 1/2/5//8“. Danach ist die Schuldmenge des Wächters leer.

## 3. Regel und Kapitel

- [ ] 3.1 Anwenderkapitel `docs/anwender/kapitel/zeiten-und-kuerzel.md` (D3) samt Bilder-Spec und Bildern, Ablauf am laufenden System nachgeklickt. Prüfung: Doku-Wächter in `check-all.sh` grün, die Hilfe zeigt das Kapitel.
- [ ] 3.2 Vitest, der die Kürzeltabelle des Kapitels mit der Liste in `openspec/specs/bedien-wortlaut` bzw. der Delta-Spec abgleicht. Prüfung: Eine fehlende Zeile macht ihn rot (Mutationsprobe).
- [ ] 3.3 `frontend/AGENTS.md`: Regel „Kürzel sind eingeführt oder erklärt“ mit Verweis auf das Kapitel und den Stärke-Kern. Anwendertexte `meldebild.md`, `einheiten.md`, `lagemonitor.md`, `ueberblick.md`, `lagebild.md` auf „F/UF/M//Σ“, „Unterabschnitte“ und „wohin nicht erfasst“ ziehen, geänderte Bilder neu aufnehmen. Prüfung: `rg '//Ges|//Gesamt|Stärke F/UF/M[^/]' docs/anwender frontend/src` leer.

## 4. Integration

- [ ] 4.1 `./scripts/check-all.sh --geaendert --ohne-e2e` grün, zusammen mit Change `aovwhho1-zeitformate`.
