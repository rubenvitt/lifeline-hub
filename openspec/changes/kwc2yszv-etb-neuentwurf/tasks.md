# Tasks

Jede Aufgabe entsteht testgetrieben (`superpowers:test-driven-development`): erst der Test, der
ohne die Änderung rot ist, dann der Code. Pfade ohne Präfix relativ zu `frontend/src/`.

## 1. Vorgabe für Von und An nach Typ

- [ ] 1.1 `etb/standardRufname.ts`: `wirksameMetadaten` und `ausStandard` nehmen den Typ und liefern die Vorgabe der Tabelle (Meldung: An = eigene Stelle; Anordnung: Von = eigene Stelle; Entscheidung, Lage: beide). Nachweis: Unit-Tests je Typ, Typwechsel mit ausdrücklichem Von, `@` bei Meldung und Anordnung (`etb/standardRufname.test.ts`).
- [ ] 1.2 `etb/schnellerfassungModell.ts`/`etb/entwuerfe/entwurfModell.ts`: Vorgabe „Auch in den Meldungseingang“ (an, außer Von = An = eigene Stelle), `nur_protokollieren` dreiwertig gelesen (fehlt = Vorgabe). Nachweis: Unit-Tests für Vorgabe, Handwahl, Zurücksetzen nach dem Erfassen, alter Entwurf mit `nur_protokollieren: true`.
- [ ] 1.3 Alle Aufrufer von `wirksameMetadaten` reichen den Typ durch (Schnellerfassung, Berichtigung, Warteschlange `offline/useEtbErfassung.ts`). Nachweis: `npx vitest run src/etb src/offline` grün, `tsc --noEmit` grün.

## 2. Tastaturregel des Vorschlagsfelds

- [ ] 2.1 `components/StammdatenFeld.tsx`: oberster passender Vorschlag markiert, Enter und Tab übernehmen ihn, Tab springt weiter, letzter Eintrag „„…“ als Freitext übernehmen“, ohne Treffer gilt der Text. Nachweis: Szenarien der Delta-Spec `stammdaten-feld` als Unit-Tests in `components/StammdatenFeld.test.tsx`.
- [ ] 2.2 Nutzer nachziehen: `etb/RufnameAbfrage.tsx`, `meldungen/MeldungFormular.tsx` und ihre Tests (Freitext jetzt über den eigenen Eintrag). Nachweis: deren Tests grün; `e2e/etb-standard-rufname.spec.ts` und die Absender-Fälle der Meldungs-e2e angepasst und lokal grün.

## 3. Feldzeile der Erfassung

- [ ] 3.1 Typ als `Segmentleiste` „Typ des Eintrags“ mit Farbpunkt und Kante der Typfarbe; unter `md` Knopf mit Pfeil. Slash-Befehl setzt das Segment. Nachweis: Tests „Wechsel per Slash-Befehl“ und „Wechsel per Klick“.
- [ ] 3.2 Feste Felder Zeit, Von, An, Meldeweg in dieser Folge, Tab-Folge bis in den Inhalt, Werte gelten beim Verlassen; Veranlassung als Feld hinter „+ Veranlassung“; `MetaChip`, `editFeld`, `chipFelder`, `editNeu` entfallen (design.md D2); Specs mit „Chip“ der Erfassung nachgezogen (`datensatz-aktionsmenue`, `ereigniszeit-vorgabe`, `zeiteingabe`). Nachweis: Szenarien „Funkspruch nachtragen“ und „Reihenfolge per Tastatur“, die LLH-1842-Tests auf die Felder umgestellt.
- [ ] 3.3 Fokus im ersten leeren Pflichtfeld beim Laden und nach dem Erfassen; Pflichtfehler am Feld mit Fokus dorthin. Nachweis: Szenarien „Fokus beim Laden“, „Alles vorbelegt“, „Kein Standard, kein Von“.
- [ ] 3.4 Abweichende Ereigniszeit: Feld in Achtungsrolle, Fußzeile „Nachtrag · Ereignis vor n min“, Knopf „Erfassen als HHMM“ samt zugänglichem Namen; geleertes Feld = jetzt; Zukunft am Feld Zeit; `/zeit` füllt das Feld. Nachweis: Szenarien „Nachtrag“, „Geleert“, „Nachtrag am Knopf“, „Tippfehler in die Zukunft“, „Uhrzeit mit Inhalt“, „Unlesbar“.
- [ ] 3.5 Enter im Inhalt folgt nur dem Tastaturvertrag; Enter in einem Feld übernimmt und springt in den Inhalt. Nachweis: Szenarien „Nach dem Setzen der Zeit“ und „Enter im Feld Von“; der LLH-1865-Fall ist als Test grün; LLH-1865 in Zunder auf erledigt.
- [ ] 3.6 Fußzeile: „Auch in den Meldungseingang“ (nur Meldung und Lage, gesperrt ohne Recht der Meldungen) und „Werte behalten“ links, Textknöpfe rechts; Entwurfsreiter erst ab dem zweiten Entwurf; „Vorschau“ nur bei Formatierung. Nachweis: Szenarien der Anforderungen „Auch in den Meldungseingang“, „Meldungseingang ohne Recht der Meldungen“, „Entwurfsreiter und Vorschau nur bei Bedarf“; `e2e/etb-meldungseingang.spec.ts` und `e2e/etb-entwurf-tabs.spec.ts` angepasst.
- [ ] 3.7 Fläche und Fokus: Leiste ≤ halbe Fensterhöhe in allen Dichten, Handschuh-Treffflächen. Nachweis: `e2e/leisten-flaeche.spec.ts`, `e2e/fokus-verdeckung.spec.ts`, `e2e/zeiteingabe-tippen.spec.ts` lokal grün, Szenario „Fükw im Handschuh-Betrieb“.
- [ ] 3.8 `frontend/src/etb/AGENTS.md` (Erfassung, Tastatur, Standard-Rufname, Meldungseingang) und `docs/anwender/kapitel/einsatztagebuch.md` (Abschnitt Erfassen) auf die Feldzeile umschreiben. Nachweis: `npx vitest run src/hilfe` (Wächter der Anwenderdoku) grün.

## 4. Erfassung am Handschirm

- [ ] 4.1 Unter `md` eingeklappt eine Zeile (Typ-Knopf, Inhalt); beim Fokus klappen Zeit und Weg, Von, An und „Erfassen“ über der Tastatur auf, nur der Primärknopf klebt. Nachweis: Zeichenfläche „Handy schreiben“ nachgestellt bei 390 × 844 und 390 × 500, `e2e/leisten-flaeche.spec.ts` (zwei Einträge ganz im Bild).

## 5. Leseansicht

- [ ] 5.1 `etb/EtbSpaltenzeile.tsx` mit geteiltem Spaltenraster und Spaltenkopf für kompakt ab `lg`; Von → An ≥ 13 px Textschrift, nichts unter 12 px, Verfasser im Titel und Zeilenmenü. Nachweis: Szenarien „Einzeiliger Eintrag im Fükw“ (≤ 36 px, ≥ 14 Einträge), „Spalten fluchten“, „Langer Absender“, „Bedienbarer Verfasser“, „Langer Verfasser“; `e2e/etb-zeilenhoehe.spec.ts` auf die neuen Werte.
- [ ] 5.2 Spalte Vermerk mit allen Verweisen und Marken, „+n“ bei Überlauf, durchgestrichener berichtigter Inhalt; „Vermerk <Stelle>“ bei Von = An. Nachweis: Szenarien „Meldung mit Verweis“, „Berichtigt“, „Entscheidung der Einsatzleitung“; `e2e/etb-verweise.spec.ts`, `e2e/etb-folgeauftraege.spec.ts` grün.
- [ ] 5.3 Lange Einträge auf drei Zeilen mit „mehr“/„weniger“, aufgeklappt bei Sprung und Suchtreffer, nie im Druck. Nachweis: Szenario „Lagebericht im Strom“, Druck-Test unverändert grün.
- [ ] 5.4 Handschirm-Zeile (Kopfzeile, Text in voller Breite); komfortabel und Handschuh behalten `Zeitachseneintrag`. Nachweis: Szenario „390 px“; `e2e/kontextmenue-etb.spec.ts` grün (Menü an Spaltenzeile und Handschirm-Zeile).
- [ ] 5.5 Regel „≥ 50 % Meldungstext“ fortschreiben (`frontend/src/etb/AGENTS.md`, `e2e/etb-chronologie.spec.ts`: Spalte Inhalt ≥ 45 % und breiteste Spalte), Abschnitt „Kompakte Zeile“ dort ersetzen; Anwenderkapitel Abschnitt „Lesen“. Nachweis: `e2e/etb-chronologie.spec.ts` lokal grün.

## 6. Filterleiste, Systemeinträge, Zahlen

- [ ] 6.1 Systemeinträge in der Vorgabe aus: Adresse `system=an` zum Einblenden, ohne Merkmal `ohne_system=true` an den Server, alter Link mit `ohne_system=true` gilt als Vorgabe (`routing/deeplinks.ts`, `pages/EtbPage.tsx`, Druck-Link). Nachweis: Szenarien von „Systemeinträge zeigen“ als Tests; `routing/deeplinks.test.ts`.
- [ ] 6.2 Bilanz-Paneel entfernen (`etb/EtbBilanz.tsx` samt Test), Zahlen je Typ an den Segmenten, Kopf „n Einträge · m Systemeinträge ausgeblendet“ bzw. „n Treffer“, Sendestatus-Marke mit Sprung zu den vorgemerkten Zeilen. Nachweis: Szenarien von „ETB-Kopf und Typ-Segmente zeigen die exakte Zahl“ als Tests in `pages/EtbPage.test.tsx`.
- [ ] 6.3 Filterleiste und Spaltenkopf kleben unter dem Seitenkopf (`--lfh-rahmen-oben`), Fokusabstand angepasst. Nachweis: Szenario „An der Arbeitsposition“, `components/rahmenOben.guard.test.ts` grün, `e2e/etb-filterleiste.spec.ts` und `e2e/etb-seitenfenster.spec.ts` lokal grün.
- [ ] 6.4 Anwenderkapitel Abschnitte „Filtern“ und „Bilanz“ umschreiben (Bilanz entfällt, Zahlen am Segment, Systemeinträge in der Vorgabe aus). Nachweis: Wächter der Anwenderdoku grün.

## 7. Integration

- [ ] 7.1 Bilder des Anwenderkapitels neu erzeugen (`pnpm doku:bilder --grep einsatztagebuch`) und Design System neu erzeugen, falls ein vorgestellter Baustein geändert wurde (`pnpm design-system`). Nachweis: Bilder im Kapitel zeigen die neue Ansicht, `designSystem.guard.test.ts` grün.
- [ ] 7.2 `./scripts/check-all.sh --geaendert` grün (in der Cloud-Sitzung ohne `mise`: Frontend-Suite, Typprüfung, Lint, Prettier und die betroffenen e2e-Specs einzeln, Verweis auf die CI des PRs).
- [ ] 7.3 Zeichenflächen des Entwurfs gegen die laufende App nachgestellt (Fükw Nacht und Tag, Tablet, Handschuh, Handy) und Bilder der Änderung aufgenommen.

## Workflow follow-up

- Review vor dem PR über den ganzen Branch (`dev-zunder-ausfuehren`, „Review vor dem PR“), Befunde gegenprüfen und behandeln.
- `/opsx:archive kwc2yszv-etb-neuentwurf` im selben Branch, dann der PR gegen `alpha`.
- Zunder: LLH-1843 bis LLH-1848, LLH-1865 und den ETB-Teil von LLH-1753 nach dem Merge schließen.
