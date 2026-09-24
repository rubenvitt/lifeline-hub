# Tasks

Jede Aufgabe mit Code entsteht per TDD (`superpowers:test-driven-development`): erst der
rote Test, dann die Umsetzung. Ein Commit je Bündel (2, 3, 4) war geplant; siehe 2.5.

## 1. Unterbau: Datenregel, Ziel, Zustand, Verweise

- [x] 1.1 In `useDatensaetze.ts` je Datensatzquelle eine exportierte Optionsfunktion `datensatzAbfrage.<quelle>(einsatzId)` mit `queryKey`, `queryFn` und `staleTime: FRISCH_MS` anlegen und die bestehenden `useQuery`-Aufrufe darauf umstellen. Die ETB-Nummernabfrage bekommt dieselbe Form. Prüfen: `useDatensaetze.test.tsx` bleibt unverändert grün. Ein neuer Test zeigt, dass jede Optionsfunktion den Byte-gleichen Key wie vorher liefert (Literale, nicht die Factory).
- [x] 1.2 `VorschauZiel` in `typen.ts` auf zwölf Varianten erweitern, ETB mit `lfdNr`. `baueQuelle` in `datensaetze.ts` bekommt den Baustein `vorschau`, `befehlFuer` reicht `kand.vorschau` durch. Zunächst trägt nur die Person ein Ziel. Prüfen: `tsc` ist grün, die Bestandstests in `datensaetze.test.ts` sind grün.
- [x] 1.3 Guard in `datensaetze.test.ts` umstellen: ein exhaustiver `Record<DatensatzQuelle, …>` der erwarteten Arten. Jede Datensatzzeile trägt `vorschau` mit dieser `art`, der `id` und beim ETB mit `lfdNr`. Sammeltreffer und Koordinatensprung tragen keine. Der Test wird rot und bleibt rot, bis Bündel 4 fertig ist. Deshalb wird er je Bündel auf die bis dahin angebundenen Sorten eingeschränkt, und die Einschränkung fällt in 4.6.
- [x] 1.4 Gemeinsamen Zustands-Helfer für die Vorschau anlegen: Laden, Fehler mit Wiederholen, „<Sorte> ist nicht mehr vorhanden.“, sonst Inhalt. Konstante `VORSCHAU_UNTER_EBENE = 2` daneben. Prüfen mit einem Test je Zustand; der Test für „nicht mehr vorhanden“ läuft mit `data === undefined` und `isLoading === false`.
- [x] 1.5 Klick-Riegel an der Vorschau-Region in `CommandPalette.tsx`: Ein Klick auf ein `<a href>` in der Region ruft `schliesse()`. Prüfen mit einem Paar: Klick auf einen Link in der Region schließt die Palette, Klick auf „Zurück“ oder eine Fläche ohne Link lässt sie offen. Dazu ein Test, dass Esc von einem fokussierten Link in der Region zur Liste zurückführt.

## 2. Bündel 1: ETB-Eintrag, Meldung, Fahrzeug

- [x] 2.1 `MELDEWEG_LABEL` aus `etb/EtbZeitachse.tsx` exportieren. `etb/EtbEintragVorschau.tsx` bauen: Nummer, Ereigniszeit, Typwort, von/an, Meldeweg, Veranlassung, Verfasser, nachgetragen (⧖ mit Wort), Inhalt als Markdown mit `VORSCHAU_UNTER_EBENE`. Die Daten kommen aus dem Nummernfach mit Id-Prüfung. Prüfen: Test für den Inhalt und für die Nummernlücke (Cursor liefert eine fremde `id` → „nicht mehr vorhanden“). Ein weiterer Test zeigt, dass ein warmes Nummernfach keinen Abruf auslöst.
- [x] 2.2 `ART_LABEL`/`WEG_LABEL` aus `MeldungKarte` exportieren. `meldungen/MeldungVorschau.tsx` rendert `MeldungKarte` ohne Rechte und Callbacks über `datensatzAbfrage.meldungen`. Prüfen: Test für den Inhalt, für die Abwesenheit von „Sichten“, „Bestätigen“ und `Aktionen zu Meldung` und für den Fall „kein Abruf bei warmem Fach“.
- [x] 2.3 `statusDarstellung` von Fahrzeug und Personal nach `kraefte/mittelStatus.ts` heben und beide Seiten von dort importieren lassen. `kraefte/FahrzeugVorschau.tsx` bauen: Funkrufname, Status mit Wort (Mandantenfarbe erzwingt Rand), Typ, Kennzeichen, OPTA, Trägerorganisation, Soll-Besatzung, Bemerkung, im `Datenraster` mit 2 Spalten. Prüfen: Test für Inhalt und Statuswort. `FahrzeugePage`- und `PersonalPage`-Tests bleiben grün.
- [x] 2.4 `Vorschau.tsx` um die drei Zweige und `datensaetze.ts` um die drei Ziele erweitern, dazu die Guard-Menge aus 1.3. Prüfen: `tsc`, `Vorschau.test.tsx` mit einem Fall je Sorte, Guard grün.
- [x] 2.5 Commit „Bündel 1“ mit `LFH-664` im Text, nachdem `pnpm lint`, `tsc` und die Vitest-Suite grün sind. — Abweichung: die drei Bündel entstanden parallel in getrennten Dateimengen und liegen in EINEM Commit (`feat(palette): Vorschau (→) für alle Datensatzsorten`), nach grünem `pnpm lint`, `tsc -b` und voller Vitest-Suite.

## 3. Bündel 2: Auftrag, Personal, Einheit, Schaden

- [x] 3.1 `auftraege/AuftragVorschau.tsx` rendert `AuftragKarte` ohne Rechte und Callbacks. Prüfen: Test für Inhalt, Empfängerstand und für die Abwesenheit von Quittieren- und Vollzugsknöpfen.
- [x] 3.2 `kraefte/PersonalVorschau.tsx`: Name, Status mit Wort, Funktion, Trägerorganisation, Stärkeposition, Bemerkung. Prüfen: Test für Inhalt und Statuswort.
- [x] 3.3 `kraefte/EinheitVorschau.tsx`: Name, Typ, Status über `einheitStatusAnzeige` (auch „gemischt“ mit Verteilung), Ist-/Soll-Stärke (`StaerkeAnzeige`), Führer, Abschnitt, Funk/Erreichbarkeit, Bemerkung. Prüfen: Test für Inhalt und für den Fall „gemischt“.
- [x] 3.4 `pages/schaeden/SchadenDaten.tsx` aus `SchaedenDetailPage` herauslösen. Die Seite übergibt im Bearbeiten-Modus ihre Eingabezellen als optionale Knoten und den Verorten-Link nur mit Schreibrecht. `SchadenVorschau.tsx` zeigt dazu den Status. Prüfen: `SchaedenDetailPage`-Tests bleiben unverändert grün. Neuer Test für die Vorschau (Inhalt, kein Verorten-Link, kein Eingabefeld).
- [x] 3.5 Zweige, Ziele und Guard-Menge für die vier Sorten ergänzen. Prüfen: `tsc`, `Vorschau.test.tsx`, Guard.
- [x] 3.6 Commit „Bündel 2“ wie 2.5. — Abweichung: die drei Bündel entstanden parallel in getrennten Dateimengen und liegen in EINEM Commit (`feat(palette): Vorschau (→) für alle Datensatzsorten`), nach grünem `pnpm lint`, `tsc -b` und voller Vitest-Suite.

## 4. Bündel 3: UHS, Lagebericht, Gefahrengebiet, Einsatzabschnitt

- [x] 4.1 `pages/uhs/UhsVorschau.tsx`: Bezeichnung, Typ, Status, Standort, Notiz, Verortung, aus der Liste. Prüfen: Test für Inhalt.
- [x] 4.2 `lageberichte/LageberichtText.tsx` aus dem Lesezweig von `LageberichtDetailPage` herauslösen, `unterEbene` als Prop (Seite 3, Vorschau `VORSCHAU_UNTER_EBENE`). `LageberichtVorschau.tsx` zeigt dazu Status (`LAGEBERICHT_STATUS`), Zeitstand, Version, Ersteller und Freigabe. Prüfen: `LageberichtDetailPage`-Tests bleiben grün. Neuer Test für die Vorschau, auch für einen leeren Abschnitt („—“).
- [x] 4.3 Abfrage der Matrix aus `GefahrenPage` als Optionsfunktion exportieren, `SPALTENKOPF` und die Zellhelfer aus `GefahrenMatrix.tsx` exportieren. `pages/gefahren/GefahrenMatrixAuszug.tsx` bauen: nur Gefahrentypen mit mindestens einer Bewertung über „keine“, alle fünf Schutzobjekte, Zelle mit Fläche, Balken, Kürzel und zugänglichem Namen, „n. a.“ für ungültige Paare, sonst „Keine Gefahren bewertet.“. `GefahrengebietVorschau.tsx`: Name (`gefahrengebietName`), höchste Warnstufe als Wort über `warnstufeKarte`, Zahl der Zonen, darunter der Auszug. Prüfen: `GefahrenMatrix`-/`GefahrenPage`-Tests bleiben grün. Neue Tests: Zeilenfilter (Zeile nur mit „keine“ fällt weg), Zelltext und -name, Leerzustand, keine Knöpfe im Auszug, `keine` → „keine Stufe gesetzt“.
- [x] 4.4 `pages/einsatzabschnitte/AbschnittDaten.tsx` aus dem Lesezweig von `EinsatzabschnittePage` herauslösen (ohne Bearbeiten/Auflösen). Das Bauteil nimmt `Datenraster` statt `Descriptions`, damit wechselt auch die Seite auf die Detail-Optik des Neuentwurfs; die Feldbeschriftungen bleiben wortgleich. `AbschnittVorschau.tsx` liest zusätzlich `datensatzAbfrage.einheiten` für die Stärke. Prüfen: `EinsatzabschnittePage`-Tests bleiben grün. Neuer Test für Inhalt, Stärke und „nicht beurteilt“. Ein Test deckt „Abschnitt aufgelöst → nicht mehr vorhanden“ ab.
- [x] 4.5 Zweige und Ziele für die vier Sorten ergänzen. Prüfen: `tsc` und `Vorschau.test.tsx`.
- [x] 4.6 Einschränkung des Guards aus 1.3 entfernen. Prüfen: Der vollständige Guard ist grün. Mutationsprobe: Ein entfernter `vorschau`-Baustein an einer Quelle färbt ihn rot (zurückgenommen).
- [x] 4.7 Commit „Bündel 3“ wie 2.5. — Abweichung: die drei Bündel entstanden parallel in getrennten Dateimengen und liegen in EINEM Commit (`feat(palette): Vorschau (→) für alle Datensatzsorten`), nach grünem `pnpm lint`, `tsc -b` und voller Vitest-Suite.

## 5. Nachweis, Doku, Abschluss

- [ ] 5.1 `e2e/palette-oeffnung.spec.ts` um einen Fall ergänzen: Eine Meldung suchen, mit → die Vorschau öffnen, Inhalt sehen, auf „↗ Auftrag“ klicken. Die App steht dann auf den Aufträgen, die Palette ist zu. Dazu ein ETB-Eintrag per Nummer mit Vorschau. Prüfen mit `pnpm e2e` für die Spec.
- [x] 5.2 Prüfliste `docs/superpowers/specs/2026-09-24-lfh-664-pruefliste.md` nach dem Muster von LFH-645: gemeinsame Zeilen einmal, je Sorte ein Block mit den abweichenden Zeilen (5, 6, 9), 15 Verdikte je Block. Prüfen: keine Zeile ohne Verdikt, jede offene Zeile mit Zielticket.
- [x] 5.3 CLAUDE.md, Absatz Sprungpalette: Datenregel der Vorschau (Palettenfach mit `select`, geteilte Abrufoptionen, ETB über Nummernfach mit Id-Prüfung, Verweis schließt die Palette). Prüfen per Diff-Review.
- [ ] 5.4 `./scripts/check-all.sh` grün. Prüfen: Ausgabe des Gates.
