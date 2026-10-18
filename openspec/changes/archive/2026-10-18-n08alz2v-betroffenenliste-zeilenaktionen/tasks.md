# Tasks

Subtask LLH-1130 (`n08alz2v`) von LLH-1018. Setzt `knc0jyjd-sichtungswahl-flaechen` und
`pao1s6uw-verorten-rueckweg` voraus. Jede Aufgabe entsteht per TDD. Geprüft wird mit
`mise exec -- pnpm -C frontend exec vitest run <Datei>` bzw. mit der genannten e2e-Spec.

## 1. Ein Wort „Fundort“

- [x] 1.1 UI-Texte zu `antreff_ort` bei Personen (`AufnahmeFelder`, `PersonVorschau`, `PersonenDetailPage`, `aufbewahrung/kategorieText.ts`) und Tieren (`TierePage`, `TiereDetailPage`, `TiereDruckTabelle`) auf „Fundort“ umstellen. Wort-Test für Maske, Detail, Liste, Druck und Vorschau; Seitentests der Tiere grün.

## 2. Zeilenaktionen

- [x] 2.1 Sichtungszelle als Auslöser mit Popover (`SichtungsWahl` + „Übernehmen“), Name mit Kennung, kein Zeilenklick. Vitest in `personenSpalten`- bzw. `PersonenPage`-Test (drei Tipps, Zeilenklick bleibt aus, Fehler an der Zeile). (`personen/ZeilenSichtung.tsx`, Test `pages/PersonenPage.zeilenaktionen.test.tsx`; das Popover trägt nur die Fläche, Kurzbegründung und „Bestätigt von“ bleiben Patientenkopf und Dialog; eine ungesichtete Person zeigt „Sichten“, Name „R-007 sichten“.)
- [x] 2.2 Verbleib-Zelle mit „Verbleib erfassen“ bei offenem Verbleib (Dialog `VerbleibErfassung`). Vitest, auch mit „Nur Lücken zeigen“. (Damit die Zeile unter „Nur Lücken zeigen“ den Verbleib zeigt, behält `filterPersonen` aus der Zeile geschlossene Lücken, bis sich die Sicht ändert; der Grund einer Ablehnung steht nach D2 im Dialog, nicht an der Zeile.)
- [x] 2.3 Aktionsspalte mit `MenueAusloeser` (Sichten, Verbleib erfassen, Auf Lagekarte verorten mit `zurueck`), unter `md` im Kartenfuß. Vitest. („Sichten“ öffnet den Dialog „Sichtung erfassen“; eine gesperrte Lagekarte steht gesperrt mit Grund im Menü; unter drei Einträgen kein Menü, deshalb keins am Gerät.)
- [x] 2.4 Schleuse: Popover und Menü halten den Zufluss der `Datensicht`. Vitest mit live hinzukommender Person. (Neuer Prop `halten` als dritte Bedingung in `useZuflussSchleuse`; auch die Dialoge aus der Zeile halten; die Menüs des Kartenfußes meldet die `Datensicht` selbst über `MenueAusloeser.onOffenAenderung`.)
- [x] 2.5 Ohne Schreibrecht „Nur Ansicht · Grund“, keine Bedienelemente; Gerätevarianten (UHS-Tablet: Sichtung ja, Verorten nein). Vitest der Seite und der Geräte. (Grund aus `einsatzRechteGrund`: beim Beobachter „nur Einsatzleitung und Führungspersonal“.)

## 3. Nachweise und Doku

- [x] 3.1 e2e `betroffene-layout.spec.ts`/`betroffene-handy.spec.ts`: Nachsichtung aus der Zeile, Kartenform unter `md`; Trefferflächen der neuen Zellen (Gate 3) grün. (Unter `md` steht das Menü rechts in der Karte statt gestapelt im Fuß: gestapelt fiel die erste Karte bei 390 × 844 aus dem ersten Bild, gemessen 0,79; Spec `einsatztauglichkeit-layout`. Mitgezogen: der veraltete Knopfname „Zustand zu …“ im Layout-Test, Vorbedingungen des Beobachter-Gates.)
- [x] 3.2 Kapitel `betroffene.md` und `tiere.md` nachgezogen, Bild `betroffene/liste.png` neu, Wächter der Anwenderdoku grün. (Dazu „Fundort“ in `aufbewahrung.md`, `geraet-uhs.md`, `geraet-betreuungsstelle.md`; neu erzeugt auch `betroffene/erfassen`, `tiere/erfassen`, `tiere/liste`, `geraet-uhs/patienten`, `geraet-uhs/aufnahme`.)
