# Tasks

Jede Aufgabe entsteht test-first (`superpowers:test-driven-development`): erst der rote
Test, dann der Code. Vorbild für jeden Schritt ist der Pegel-Auslöser aus LFH-640
(`git log origin/alpha --grep 'LFH-640' --name-only`).

## 1. Backend: Auslöser `evakuiert`

- [x] 1.1 `src/einsatz/lagekennzahl.rs`: Variante `Evakuiert` (Wire `evakuiert`, `as_str`) und `ableiten(pegel_festgelegt, evakuierung_angeordnet)`. Die Reihenfolge der Ausgabe ist die Enum-Reihenfolge. Dateikopf ohne „LFH-607 ergänzt“. Verifiziert durch die Unit-Tests dort: keiner → `[]`, nur Evakuierung → `[Evakuiert]`, beide → `[Pegel, Evakuiert]`
- [x] 1.2 `tests/enum_wire_kontrakt.rs`: Pin `Lagekennzahl { Pegel, Evakuiert }` nachziehen. Verifiziert durch `cargo test --test enum_wire_kontrakt`
- [x] 1.3 `src/einsatz/mod.rs` + `src/einsatz/repo.rs`: Feld `evakuierung_angeordnet: bool` am `Einsatz` und an der `Row` von `liste_fuer`. In beiden SQL-Literalen steht die `EXISTS`-Spalte aus design.md D1, mit Querverweis-Kommentar auf `istAktiverBezirk`. Test-Literale in `berechtigung.rs` und `mod.rs` ergänzen (vorher `grep -rn 'pegel_festgelegt:'`). Verifiziert durch `cargo test --lib einsatz`
- [x] 1.4 Integrationstest (in `tests/betreuung.rs`, Muster `pegel_festlegen_schaltet_die_lagekennzahl_am_einsatz`): ohne Bezirk kein `evakuiert` → anlegen → `evakuiert` → Stand melden und zurücknehmen → unverändert → `geraeumt` → bleibt → aufheben → weg → zweiten Bezirk anlegen und stornieren → weg. Dazu: mit Pegel `["pegel","evakuiert"]`, anderer Einsatz unberührt. Jeweils Detail **und** Liste, Vorhandensein per `contains_key`. Verifiziert durch `cargo test --test betreuung`
- [x] 1.5 Codegen: `scripts/check-typ-codegen.sh` laufen lassen, `openapi.json` und `types.generated.ts` mitcommitten. Verifiziert durch das grüne Skript (Drift-Gate + `tsc`)

## 2. Frontend: Formatierung und Lagebild

- [x] 2.1 `betreuung/betreuungText.ts`: `kennzahlTeile(k)` nach design.md D4. `kennzahlText` wird darauf zurückgeführt, Ausgabe unverändert. Verifiziert durch neue Tests auf `kennzahlTeile` (gezählt, ohne Meldung, geschätzt mit und ohne N, k ohne Meldung) und die unveränderten Bestandstests von `kennzahlText`
- [x] 2.2 `pages/lage-dashboard/lagebild.ts`: Etikett `'Evakuiert'` in `KENNZAHL_ETIKETTEN`, `LAGEKENNZAHL.evakuiert = { etikett: 'Evakuiert', platz: 'B', rang: 0 }`, `Rohdaten.evakuierung` (`EvakuierungStand` aus `useEvakuierungKennzahl`, der Hook bekommt `bereit` für „Freigaben bekannt“, design.md D3), Zelle im `alle`-Record nach design.md D3–D5 (Wert, Notiz, kein Ton, Route `betreuung`, ohne Ziel bei fehlendem Zugriff). Verifiziert durch `lagebild.test.ts` mit **Literalen**: `kennzahlReihe(['evakuiert'])`, `(['pegel','evakuiert'])` = `(['evakuiert','pegel'])` = Reihe aus S3. Dazu für jede Teilmenge: Länge 6, Kern auf 1/3/4/5, das Hinzufügen von `evakuiert` ändert genau Index 2. Zelltests: Wert/Notiz für „zwei Bezirke“, „ohne Meldung → —“, „≈“, „keine geplante Evakuierung“, „kein Zugriff → ohne Ziel“
- [x] 2.3 `pages/lage-dashboard/LageDashboardPage.tsx`: `useEvakuierungKennzahl` einbinden, `kennzahlZustand['Evakuiert']` aus dem Hook-Zustand (`aus` vor geladenen Overrides → `laden`), Ziel nur bei vorhandenem Zugriff. Dateikopf („Noch nicht im Band: Evakuiert“) abräumen. Verifiziert durch `LageDashboardPage.test.tsx` mit MSW-Handler für `…/betreuung`: Einsatz mit `['pegel','evakuiert']` zeigt die Reihe aus S3 samt „1 320“ / „von 1 850 geplant“ und Link auf Betreuung. Betreuungsabruf 500 → Zelle „Stand unbekannt“, Nachbarn lesbar. Refetch mit zusätzlich `evakuiert` → Banner „Evakuiert statt Schäden offen“, Platz 3 bleibt bis „übernehmen“
- [x] 2.4 `pages/BetreuungPage.tsx`: Bezirks-Mutationen (anlegen, ändern, stornieren) invalidieren zusätzlich `einsatzKeys.einsatz(einsatzId)`, Stellen- und Meldungs-Mutationen nicht. Verifiziert durch `BetreuungPage.test.tsx` (Spion auf `invalidateQueries` bzw. beobachteter Refetch des Einsatz-Keys, Muster `EinsatzPegel.test.tsx`)

## 3. Doku

- [x] 3.1 Lückenvermerke abräumen: Dateiköpfe `evakuierungKennzahl.ts` / `useEvakuierungKennzahl.ts` („künftige Dashboard-Zelle“), `lagebild.ts` (Kommentar an `LAGEKENNZAHL`), `docs/design/2026-09-21-neuentwurf/umsetzung.md` Punkt 4, CLAUDE.md-Absatz „Keine erfundenen Daten“ (Evakuiert eingelöst, mit Verweis auf diesen Change). Die LFH-640-Spec unter `docs/superpowers/specs/` bleibt unverändert. Verifiziert durch `grep -rn "Einbau LFH-607\|eingetragen wird sie mit LFH-607\|künftige Dashboard-Zelle"`, das keinen Treffer mehr liefert

## 4. Verifikation

- [ ] 4.1 Gates: `./scripts/check-all.sh` grün (Formatierung, Lint mit `--max-warnings 0`, Codegen, `cargo test --workspace`, Vitest, e2e). Verifiziert durch den Exit-Code des Skripts
- [ ] 4.2 Im Browser gegen den Dev-Stack: Einsatz ohne Bezirk → Platz 3 „Schäden offen“. Bezirk anlegen, zurück zum Dashboard → „Evakuiert“ ohne Banner, Wert „—“. Stand melden → Zahl erscheint ohne Platzwechsel. Bezirk aufheben → zurück zu „Schäden offen“. Verifiziert durch Screenshots je Schritt

## 5. Prüfliste Einsatztauglichkeit (Kennzahlenband, Platz 3)

- [x] 5.1 Prüfliste mit Verdikt je Zeile ausfüllen und im PR mitführen, abgelegt in `pruefliste.md` (1 Treffläche · 2 Handschuh · 3 Rückmeldung · 4 kritische Aktion · 5 Kontrast · 6 zweiter Kanal · 7 eine Farbe eine Bedeutung · 8 Helligkeit · 9 feste Stelle · 10 Alarmbudget · 11 Warnverhalten · 12 kein Sprung · 13 Fokus · 14 Tabelle · 15 Erfassungsmaske). Kriterium 9 belegt über die Tests aus 2.2 und 2.3, Kriterium 12 über die unveränderte Platzzahl vor dem Einsatz-Abruf. Verifiziert durch die ausgefüllte Tabelle ohne „nicht geprüft“
