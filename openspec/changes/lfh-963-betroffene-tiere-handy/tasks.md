## 1. Seitenkopf: Slot `weitere` (D1, D2)

- [ ] 1.1 Tests zuerst (`components/EinsatzSeite.test.tsx`): ab `md` je Nebenweg ein Knopf, kein Auslöser; unter `md` ein Auslöser mit dem Namen der Seite, Menü mit allen Einträgen, Wahl ruft `onWahl`; leere Liste ohne beides; `laeuft` am Auslöser.
- [ ] 1.2 `weitere` in `components/EinsatzSeite.tsx` bauen. Mutationsprobe: Weiche fest auf breit → 1.1 rot.
- [ ] 1.3 Betroffene, Tiere und Schäden auf `weitere` umstellen (Drucken, CSV, Listenzugriffe); bestehende Seitentests nachziehen.

## 2. Eine Personenmaske (D3, D4)

- [ ] 2.1 Tests zuerst (`personen/PersonErfassungModal.test.tsx`, `pages/PersonenPage.test.tsx`): Kopfknopf und `?neu=1` öffnen dieselbe Maske „Betroffene erfassen“, Folgestatus sichtbar, Anlage mit `erfasst`; Filter „Erfasst“, kein „Neu“; Summe „gesamt“.
- [ ] 2.2 `AufnahmeModus` auf `erfassen | vermisst`, Hinweiszeile in `AufnahmeFelder`, Kopfknopf primär, Filterwort, Summenwort. Mutationsproben: Hinweiszeile entfernt, Filter wieder „Neu“ → rot.

## 3. Betroffenenliste am Handy (D5, D6)

- [ ] 3.1 Tests zuerst: `personen/Sichtungszeile.test.tsx` (Zahlen aus `sichtungsbild`, Zahl vor Wort); `BetroffeneZeile` unter `md` mit „Kürzel anzeigen“ statt der Liste.
- [ ] 3.2 `Sichtungszeile` bauen und unter `xl` über den Statusfilter stellen; Kürzel-Hinweis einklappbar.

## 4. Tiere im Feldbudget (D7)

- [ ] 4.1 Tests zuerst (`pages/TierePage.test.tsx`): in beiden Modi höchstens vier sichtbare Felder, Aufklappen → mehr; Pflichtfeld sichtbar.
- [ ] 4.2 Felder umordnen, `Collapse` mit `forceRender`, „Tier erfassen“. Mutationsprobe: Rasse wieder sichtbar → rot.

## 5. Personen-Detail (D8)

- [ ] 5.1 Tests zuerst (`pages/PersonenDetailPage.test.tsx`): kein `Descriptions`, `Datenraster` vorhanden, leere Angaben in „Ohne Angabe: …“.
- [ ] 5.2 Stammdaten auf `Datenraster`/`Datenfeld`, `Col`-`order`.

## 6. e2e, Regeln, Abschluss

- [ ] 6.1 `e2e/betroffene-handy.spec.ts`: Liste bei 390 (Admin und Beobachter): erste Personenzeile und Sichtungszeile im Fenster, Nebenwege nur im Menü, eine Primäraktion; Detail bei 390 und 820 (Admin und Beobachter): medizinische Spalte über den Stammdaten; Gegenprobe bei 1180 (Knöpfe statt Menü). Mutationsprobe: Sichtungszeile entfernt → rot.
- [ ] 6.2 Bestehende e2e-Specs auf die neuen Namen ziehen („Betroffene erfassen“, „Tier erfassen“, Filter „Erfasst“).
- [ ] 6.3 Regeln: `frontend/AGENTS.md` (Aktionen: Nebenwege über `weitere`), `frontend/src/personen/AGENTS.md` (eine Maske, „erfasst“, „gesamt“).
- [ ] 6.4 Folgeticket für die übrigen Seiten mit Nebenwegen im Kopf anlegen.
- [ ] 6.5 Bündel `schnell`, volle Vitest-Suite, berührte e2e-Specs grün; `check-all.sh` belegt die CI des PRs.
