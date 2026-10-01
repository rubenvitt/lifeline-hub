# Tasks

Jede Aufgabe entsteht per `superpowers:test-driven-development`: erst der rote Test, dann der
Code. Vor jedem „fertig“ stehen `superpowers:verification-before-completion` und
`superpowers:requesting-code-review` (Wurzel-`AGENTS.md`, LFH-588).

## 1. Protokollart `druck` (Backend)

- [x] 1.1 `migrations/0131_person_zugriff_audit_druck.sql` als CHECK-Rebuild nach D2. Vorher prüfen, dass keine Migration `person_zugriff_audit` referenziert. Nachweis: neuer Test in `src/db.rs` (Muster `bis(version)`): legt bis 0130 Zeilen `detail` und `export` an, spielt 0131 ein und findet sie samt ids danach unverändert; `druck` wird angenommen, `foo` scheitert am CHECK; `sqlite_sequence` vergibt danach keine alte id neu
- [x] 1.2 `ZugriffArt::Druck` in `src/person/audit_repo.rs`, Doc-Kommentare auf 0131; Wire-Kontrakt in `tests/enum_wire_kontrakt.rs`. Nachweis: `cargo test --test enum_wire_kontrakt` und Repo-Test `druck_eintrag_ohne_person`
- [x] 1.3 Handler `einsatz_person::druck` und Route `GET /api/einsaetze/{id}/personen/druck` in `src/app.rs` (D1). Nachweis in `tests/einsatz_person.rs`: `druck_schreibt_genau_einen_druck_audit_und_liefert_liste` (gleiche Menge wie die Liste, `person_id` NULL, Benutzer), `druck_ohne_modulzugriff_ist_403_ohne_audit`, `druck_als_beobachter_erlaubt`, `liste_bleibt_unprotokolliert` (bestehender Test deckt es, sonst ergänzen) und ein Test, dass ein fehlgeschlagenes Protokoll keine Daten ausliefert (z. B. Trigger, der den INSERT abweist → 500, kein Body mit Personen)
- [x] 1.4 Codegen: `scripts/check-typ-codegen.sh`, beide generierten Dateien mitcommitten. Nachweis: `ZugriffArt: "detail" | "export" | "druck"` in `types.generated.ts`, Skript grün
- [x] 1.5 `scripts/check-migrationen.sh` gegen `origin/alpha` (vorher `git fetch`). Nachweis: grün

## 2. Gemeinsame Bausteine (Frontend)

- [x] 2.1 Query-Keys `personenDruck`, `tiereDruck`, `schaedenDruck` in `api/queryKeys.ts` (eigene Präfixe, `NICHT_LIVE_KEYS` mit Begründung, außerhalb `LAGEBILD_OFFLINE`). Nachweis: `api/queryKeys.test.ts`, `queryKeys.guard.test.ts`, `api/lagebildOffline.guard.test.ts` grün
- [x] 2.2 `ladePersonenDruck(einsatzId)` in `api/einsatzPerson.ts` mit Kommentar zur Protokollwirkung. Nachweis: Vitest gegen MSW, ruft genau `GET /api/einsaetze/1/personen/druck`
- [x] 2.3 Pfadbauer und Parser `personenDruckPfad`/`parsePersonenDruckAuswahl`, `tiereDruckPfad`/`parseTiereDruckAuswahl`, `schaedenDruckPfad`/`parseSchaedenDruckAuswahl` in `routing/deeplinks.ts` (D5). Nachweis: `routing/deeplinks.test.ts` mit Rundlauf über `URLSearchParams`, Verwerfen unbekannter Werte, fehlender Wert = `alle`; `inlinePfade.guard.test.ts` grün
- [x] 2.4 Seitenrahmen `druck/ListenDruckSeite.tsx` (D3). Nachweis: `druck/ListenDruckSeite.test.tsx`: genau eine Druckwurzel, Drucken gesperrt beim Laden und nach Fehler, 403 → „Kein Zugriff“ ohne Druckknopf, Fehler → „Erneut laden“, leere Auswahl → Leermeldung und druckbar, Hinweiszeile erscheint nur, wenn gesetzt
- [x] 2.5 Sichten-Labels der Schadensliste nach `pages/schaeden/schadenHelfer.tsx` verschieben, `SchaedenPage` nutzt sie von dort. Nachweis: `SchaedenPage`-Tests unverändert grün

## 3. Personen-Druck

- [x] 3.1 `personen/druckAuswahl.ts:personenDruckAuswahl` (Kopfzeile aus `FILTER_OPTIONEN`, „nur offene Felder“, „alle Personen“). Nachweis: Unit-Test je Kombination
- [x] 3.2 `personen/PersonenDruckTabelle.tsx` (D6, Sichtung in Worten ohne Farbe, aufsteigend nach Registriernummer). Nachweis: Test mit Reihenfolge 3,1,2 → 1,2,3, Sichtung als Wort, Verbleib mit UHS-Name und ohne
- [x] 3.3 `pages/PersonenDruckPage.tsx` mit Route `personen/druck` in `App.tsx`; Abruf nur über `ladePersonenDruck`, `retry: false`, `refetchOnMount: 'always'`, Filter per `filterPersonen`, Protokoll-Hinweis am Bildschirm. Nachweis: `pages/PersonenDruckPage.test.tsx`: genau ein Druck-Abruf je Öffnung, „Neu laden“ ein weiterer, kein Abruf von `GET …/personen`, kein Retry nach 500, Auswahl aus der Adresse im Kopf
- [x] 3.4 Einstieg „Drucken / als PDF“ in `PersonenPage` mit aktivem `filter`/`nurLuecken`. Nachweis: Test in `PersonenPage.test.tsx` analog „verlinkt im Kopf auf die Druckansicht mit dem aktiven Filter“

## 4. Tiere-Druck

- [ ] 4.1 `pages/tiere/druckAuswahl.ts:tiereDruckAuswahl` (Labels aus `TIER_STATUS`, `SPEZIES_META`). Nachweis: Unit-Test
- [ ] 4.2 `pages/tiere/TiereDruckTabelle.tsx` (D6). Nachweis: Test zu Reihenfolge und Halterangabe (Registriernummer bzw. Kontakt)
- [ ] 4.3 `pages/TiereDruckPage.tsx` mit Route `tiere/druck`; Abruf `listeTiere(einsatzId, {})` unter `tiereDruck`, Filter per `filterTiere`. Nachweis: Seitentest (Auswahl aus Adresse, fehlende Sicht = alle, kein Live-Nachschub nach SSE-Invalidierung von `tiere`)
- [ ] 4.4 Einstieg in `TierePage` mit `sicht` (immer ausdrücklich) und `spezies`. Nachweis: Seitentest des Links

## 5. Schäden-Druck

- [ ] 5.1 `pages/schaeden/druckAuswahl.ts:schaedenDruckAuswahl`. Nachweis: Unit-Test
- [ ] 5.2 `pages/schaeden/SchaedenDruckTabelle.tsx` (D6, Geschädigt als Text). Nachweis: Test zu Reihenfolge, „übergeben an“, Geschädigt ohne Link
- [ ] 5.3 `pages/SchaedenDruckPage.tsx` mit Route `schaeden/druck`; Abruf `listeSchaeden(einsatzId, {})` unter `schaedenDruck`, Filter per `filterSchaeden`. Nachweis: Seitentest
- [ ] 5.4 Einstieg in `SchaedenPage` mit `sicht`. Nachweis: Seitentest des Links

## 6. Regeln, e2e und Abschluss

- [ ] 6.1 Block „Modul-Listen-Druck (LFH-727)“ in `frontend/src/druck/AGENTS.md` (D8). Nachweis: Prettier über `frontend/` grün, Verweis auf diese Change bzw. ihr Archiv
- [ ] 6.2 e2e `frontend/e2e/modul-listen-druck.spec.ts` (Regeln `frontend/e2e/AGENTS.md`): Personen mit Filter „Betroffen“ aus der Liste öffnen, Kopf nennt die Auswahl, ausgelöstes `beforeprint` zeigt nur die Druckwurzel, Tabellenkopf als `table-header-group`; Tiere- und Schäden-Druckansicht öffnen und Zeilenzahl prüfen. Nachweis: Spec grün
- [ ] 6.3 Folge-Task „Einsicht in listenweite Zugriffe (`export`, `druck`)“ über `clickup-task-anlegen` erfassen. Nachweis: Task-ID in der PR-Beschreibung
- [ ] 6.4 `./scripts/check-all.sh` grün (Nachweis: Lauf dieses Branches bzw. die CI des PRs)
- [ ] 6.5 Prüfliste für die Handprüfung in die PR-Beschreibung: Druckvorschau der drei Listen in Firefox und Safari (Kopf auf Seite 1, Kopfwiederholung, kein App-Rahmen); Chromium belegt 6.2. Die Prüfung selbst macht der Mensch (Cloud-Sitzung ohne Firefox/Safari, vgl. LFH-729). Nachweis: Prüfliste steht im PR
