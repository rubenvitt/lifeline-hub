# Tasks

Subtask LLH-1130 (`n08alz2v`) von LLH-1018. Setzt `knc0jyjd-sichtungswahl-flaechen` und
`pao1s6uw-verorten-rueckweg` voraus. Jede Aufgabe entsteht per TDD. Geprüft wird mit
`mise exec -- pnpm -C frontend exec vitest run <Datei>` bzw. mit der genannten e2e-Spec.

## 1. Ein Wort „Fundort“

- [ ] 1.1 UI-Texte zu `antreff_ort` bei Personen (`AufnahmeFelder`, `PersonVorschau`, `PersonenDetailPage`, `aufbewahrung/kategorieText.ts`) und Tieren (`TierePage`, `TiereDetailPage`, `TiereDruckTabelle`) auf „Fundort“ umstellen. Wort-Test für Maske, Detail, Liste, Druck und Vorschau; Seitentests der Tiere grün.

## 2. Zeilenaktionen

- [ ] 2.1 Sichtungszelle als Auslöser mit Popover (`SichtungsWahl` + „Übernehmen“), Name mit Kennung, kein Zeilenklick. Vitest in `personenSpalten`- bzw. `PersonenPage`-Test (drei Tipps, Zeilenklick bleibt aus, Fehler an der Zeile).
- [ ] 2.2 Verbleib-Zelle mit „Verbleib erfassen“ bei offenem Verbleib (Dialog `VerbleibErfassung`). Vitest, auch mit „Nur Lücken zeigen“.
- [ ] 2.3 Aktionsspalte mit `MenueAusloeser` (Sichten, Verbleib erfassen, Auf Lagekarte verorten mit `zurueck`), unter `md` im Kartenfuß. Vitest.
- [ ] 2.4 Schleuse: Popover und Menü halten den Zufluss der `Datensicht`. Vitest mit live hinzukommender Person.
- [ ] 2.5 Ohne Schreibrecht „Nur Ansicht · Grund“, keine Bedienelemente; Gerätevarianten (UHS-Tablet: Sichtung ja, Verorten nein). Vitest der Seite und der Geräte.

## 3. Nachweise und Doku

- [ ] 3.1 e2e `betroffene-layout.spec.ts`/`betroffene-handy.spec.ts`: Nachsichtung aus der Zeile, Kartenform unter `md`; Trefferflächen der neuen Zellen (Gate 3) grün.
- [ ] 3.2 Kapitel `betroffene.md` und `tiere.md` nachgezogen, Bild `betroffene/liste.png` neu, Wächter der Anwenderdoku grün.
