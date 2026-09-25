# Tasks

## 1. Geteiltes Modul für Zählung und Schalter

- [x] 1.1 `components/SpaltenSchalter.tsx` anlegen mit dem Typ `SchaltbareSpalte` und den dorthin verschobenen Funktionen `sichtbareSpalten`, `waehlbareSpalten`, `hatWaehlbareSpalten`, `etikettVon` sowie der Komponente `SpaltenSchalter` (D1). `Datensicht.tsx` importiert von dort und exportiert weiter, das Warn-Präfix von `etikettVon` wird neutral. Vorher greppen, dass kein Test das Präfix pinnt. Belegen mit unverändert grünen Tests `Datensicht.test.tsx` und `Datensicht.tastaturaktionen.test.tsx`, dazu `tsc` ohne Zyklus.
- [x] 1.2 D9 per TDD umsetzen. Tests zuerst: (a) In `SpaltenSchalter.test.tsx` gilt für `sichtbareSpalten` mit `eingeblendet`: Breite plus `eingeblendet` ergibt sichtbar, und `verborgen` gewinnt über `eingeblendet`. (b) In `Datensicht.test.tsx` steht eine Spalte bei unterschrittener Breite im Menü ohne Häkchen, ein Klick holt sie zurück, und der Zähler sinkt. Rot belegen, dann `sichtbareSpalten`, `SpaltenSchalter` (Häkchen aus der wirklichen Sichtbarkeit, `an`/`onAn`) und `Datensicht` (eigener Zustand `an`) umsetzen.

## 2. Opt-in an KatalogTabelle

- [x] 2.1 TDD, Tests zuerst in `KatalogTabelle.spaltenschalter.test.tsx` (eigene Datei wegen `vi.mock` der Palette), jeweils als Paar. (a) Ohne `spaltenSchalter` gibt es keinen Schalter, und alle Spalten stehen. (b) Mit `spaltenSchalter` steht „Spalten“ in der Werkzeugzeile außerhalb von `.ant-table`, der zugängliche Name nennt die Bezeichnung. (c) Handauswahl blendet aus und zählt, `abBreite` unter der Schwelle blendet aus und zählt, beide zusammen ergeben einen Zähler, doppelt verborgen zählt einmal. Die Breite kommt über `setzeViewportBreite` durch den echten Hook. (d) Spalte 0 und `immerSichtbar` sind im Menü nicht wählbar, die Fixierung bleibt an Spalte 0. (e) `abBreite` ohne Opt-in bleibt wirkungslos und warnt in DEV. (f) Eine Spalte ohne String-`key` bei gesetztem Opt-in warnt und gilt als `immerSichtbar`. Rot vor der Umsetzung belegen.
- [x] 2.2 `KatalogSpalte` um `etikett`, `immerSichtbar` und `abBreite` erweitern, `responsive`/`hidden` distributiv sperren (D4). `spaltenSchalter` umsetzen: Zustand, `sichtbareSpalten` vor Fixierung und `fliessBreite`, Herauslösen der drei Felder vor antd, Werkzeugzeile als umbrechende Flex-Zeile (D2, D6). Belegen mit den Tests aus 2.1 und `tsc`.
- [x] 2.3 Tastaturebene: `spalten` nur bei `hatWaehlbareSpalten`, kontrollierte Offen-Achse, die zurückgesetzt wird, wenn der Schalter verschwindet (D6). Belegen mit einem Test nach dem Muster `Datensicht.tastaturaktionen.test.tsx`: die gemeldeten Aktionen mit und ohne Opt-in, und die Aktion öffnet das Menü.
- [x] 2.4 Dateikopf von `KatalogTabelle.tsx` neu fassen: Der Absatz „Kein Spaltenschalter … nicht anwendbar“ wird durch die Opt-in-Regel samt Ausnahme ohne Opt-in ersetzt. Belegen mit einem Diff-Review.

## 3. Guards

- [x] 3.1 In `katalogTabelle.guard.test.ts`: kein `responsive:`/`hidden:` in den 18 Konsumentendateien (ohne Kommentare), mit Selbstbeweis an einem gebauten Fall. Außerdem trägt `Datensicht.tsx` kein `spaltenSchalter` (D5). Per Mutationsprobe belegen: ein eingesetztes `responsive: ['md']` in einer Konsumentendatei färbt den Guard rot.
- [x] 3.2 Ein Test prüft, dass eine `Datensicht` mit `form="tabelle"` genau einen Spaltenschalter zeigt. Belegen mit einem grünen Test und einer Mutationsprobe, bei der `spaltenSchalter` in `Datensicht` gesetzt wird und der Test rot wird.

## 4. Kartenverwaltungen

- [ ] 4.1 `OnlineQuellenVerwaltung.tsx`: `spaltenSchalter={{ bezeichnung: 'Online-Quellen' }}`, URL und Attribution `abBreite: 'lg'`, Aktionen `immerSichtbar` (D7). Tests zuerst: Schalter vorhanden, bei 1024 px „Spalten“ mit allen Spalten, unter `lg` „Spalten · 2 ausgeblendet“, zusammen mit abgewählter „Sortierung“ „· 3 ausgeblendet“, Name und Aktionen nicht im Menü. Bestandstests (Sortierung, Aktiv-Filter, Suche) bleiben unverändert grün.
- [ ] 4.2 `OfflineKartenVerwaltung.tsx`: `spaltenSchalter={{ bezeichnung: 'Offline-Karten' }}`, Attribution `abBreite: 'lg'`, Aktionen `immerSichtbar`. Tests zuerst: „Größe“ abwählen ergibt „· 1 ausgeblendet“ und die Spalte ist weg. Unter `lg` lässt sich „Attribution“ von Hand zurückholen, der Zähler sinkt. Bestandstests (Größen-Sortierung, Status-Filter, Suche, Polling) bleiben unverändert grün.
- [ ] 4.3 e2e: `/admin/karten/online` und `/admin/karten/offline` bei 390 px zeigen eine Tabelle (keine Karten), die Seite hat keinen waagerechten Überlauf, der Schalter zeigt einen Zähler > 0, und ein Klick darauf öffnet das Menü. Die Spec wird an `katalogtabelle-schmal.spec.ts` angehängt oder in einer eigenen Spec gleicher Bauform abgelegt. Belegen mit `pnpm e2e` für die Spec.

## 5. Doku, Prüfliste, Gates

- [ ] 5.1 `pruefliste.md` in diesem Change-Ordner mit 15 Zeilen für beide Kartenverwaltungen, jede mit Verdikt. Zeile 14 bekommt „erfüllt“ mit Testverweisen. Belegen, indem keine Zeile ohne Verdikt bleibt und jede offene Zeile ein Zielticket nennt.
- [ ] 5.2 Zeile 14 der Alt-Prüflisten mit Vorwärtsverweis ergänzen: `2026-07-30-lagekarte-karten-pruefliste.md` bekommt „→ eingelöst durch LFH-374, siehe `openspec/changes/lfh-374-…/pruefliste.md`“, `2026-07-30-etb-pruefliste.md` bekommt „→ eingelöst durch LFH-342, seit dem Neuentwurf (Zeitachse) gegenstandslos“, jeweils in der Kriterienzeile und in der Tabelle der offenen Punkte. CLAUDE.md, Absatz „Tabelle nur, wenn verglichen wird“: `KatalogTabelle` als zweiter Träger mit Opt-in, eine Zählwahrheit in `SpaltenSchalter.tsx`. Belegen mit einem Diff-Review.
- [ ] 5.3 `./scripts/check-all.sh` grün (Ausgabe festhalten), dazu `openspec validate lfh-374-spaltenschalter-katalogtabelle --strict`.
