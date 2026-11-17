# Tasks

## 1. Backend: Basisstand am BR-PATCH (D5)

- [x] 1.1 Test in `src/bereitstellungsraum/repo.rs` (Muster `aktualisiere_optimistisches_lock_ueber_geaendert_at` der UHS) rot: `update_tx` mit veraltetem Basisstand → `AppError::Conflict`, Notiz unverändert; mit aktuellem Basisstand → gespeichert, neues `geaendert_at`; ohne Basisstand → gespeichert
- [x] 1.2 `PatchBody.basis_geaendert_at: Option<String>` in `src/routes/einsatz_bereitstellungsraum.rs`, weitergereicht an `br_repo::update_tx`; UPDATE mit `AND geaendert_at = ?` bei gesetzter Basis, keine Zeile → 409 „… zwischenzeitlich geändert“; Test 1.1 grün; Routen-Test in `tests/` (falls es für den BR-PATCH einen gibt) um den 409-Fall ergänzt
- [x] 1.3 `cargo test` für `bereitstellungsraum` und die BR-Routen-Tests grün; `scripts/check-typ-codegen.sh` bestätigt: keine Änderung an generierten Dateien

## 2. Baustein: Zusatzhandlungen im Paneelkopf (D6)

- [x] 2.1 Test in `components/instrument/BearbeitbaresPaneel.test.tsx` rot: `zusatz` steht im Lesezustand vor „Bearbeiten“, fehlt im Bearbeiten-Zustand und erscheint nach „Abbrechen“ wieder; ohne `zusatz` unverändert
- [x] 2.2 `zusatz?: ReactNode` in `BearbeitbaresPaneel` umsetzen, Dateikopf ergänzen; Test 2.1 grün
- [x] 2.3 Design System neu erzeugen (`mise exec -- pnpm -C frontend design-system`), Erzeugtes mitcommitten; `designSystem.guard.test.ts` grün

## 3. Client-API: Basisstand senden (D4)

- [x] 3.1 `basis_geaendert_at?: string` in `UhsPatch` (`api/einsatzUhs.ts`) und `BrPatch` (`api/einsatzBereitstellungsraum.ts`); `tsc` grün

## 4. Bereitstellungsraum: Paneel „Raumdaten“ (D3, D7)

- [x] 4.1 `pages/bereitstellungsraum/brPatch.ts`: `brRaumdatenWerte(br)` und `brPatch(vorher, nachher)` (Werte gegen Werte, leer = `null`, Koordinate als Paar); Tests aus `BrBearbeitenModal.test.ts` nach `brPatch.test.ts` umziehen und auf die neue Signatur bringen, rot→grün
- [x] 4.2 `BrDetailPage.tsx`: `SektionHeader` + `Datenraster` „Raumdaten“ durch `BearbeitbaresPaneel` (Bezeichnung, Standort, Notiz; Regeln aus dem Modal) ersetzen, `zusatz` = `AufKarteVerorten` nur bei `bearbeitbar`, `onSpeichern` mit `basis_geaendert_at`, `onNeuLaden` = Refetch, Invalidierung und Erfolgsmeldung wie bisher; `BrBearbeitenModal` und `bearbeitenOffen` entfernen
- [x] 4.3 `BrDetailPage.test.tsx` rot→grün: „Bearbeiten“ im Paneel „Raumdaten“ öffnet Eingaben an Ort und Stelle (kein Dialog), Speichern sendet nur die Notiz samt `basis_geaendert_at`, 409 → „Zwischenzeitlich geändert“, aufgelöster Raum ohne „Bearbeiten“, „Auf Karte verorten“ nur im Lesezustand
- [x] 4.4 `BrBearbeitenModal.tsx` und `BrBearbeitenModal.test.ts` löschen; `grep -rn BrBearbeitenModal` außerhalb von `openspec/changes/archive` und `docs/superpowers` leer (bis auf die Altstellenliste, Aufgabe 6.1)

## 5. UHS: Bereich „Angaben“ (D1–D3)

- [x] 5.1 `routing/deeplinks.ts`: `UhsBereich` um `angaben`; `deeplinks.test.ts` (`parseUhsBereich`, `uhsBereichSuche`) um `angaben` rot→grün
- [x] 5.2 `pages/uhs/uhsPatch.ts`: `uhsAngabenWerte(uhs)` und `uhsPatch(vorher, nachher)` (inkl. Soll-Anzahl und Qualifikationssoll wie `uhsPatchAus`); Tests aus `UhsBearbeitenModal.test.tsx` nach `uhsPatch.test.ts` umziehen und auf die neue Signatur bringen, rot→grün
- [x] 5.3 `pages/uhs/UhsAngaben.tsx`: Paneel „Angaben“ über `BearbeitbaresPaneel` (Felder aus D2, Lesewerte mit „—“ und `qualiSollText`), `onSpeichern` mit `basis_geaendert_at`, Invalidierung (`uhs`, `uhsDetail`, `lagemonitor`) und Erfolgsmeldung wie bisher; Tests in `UhsAngaben.test.tsx` rot→grün: Lesen mit „—“, nur geänderte Soll-Anzahl samt Basis, Notiz leeren → `null`, 409-Rückfrage, ohne Verwaltungsrecht und aufgelöst kein „Bearbeiten“
- [x] 5.4 `UhsDetailPage.tsx`: Bereich „Angaben“ in `BEREICH_NAME` und `bereichListe` (nicht am Gerät), Inhalt `UhsAngaben` mit `key={uhs.id}`; „Bearbeiten“ aus dem Kopf und `UhsBearbeitenModal`/`bearbeitenOffen` entfernen; `UhsDetailPage.test.tsx` rot→grün (Kopf ohne „Bearbeiten“ geplant und aktiv, `?bereich=angaben` zeigt das Paneel, Gerät fällt auf Belegung zurück)
- [x] 5.5 `UhsBearbeitenModal.tsx` und `UhsBearbeitenModal.test.tsx` löschen; `grep -rn UhsBearbeitenModal` wie 4.4 leer
- [x] 5.6 e2e: `uhs-hoehe.spec.ts` und `uhs-grundriss-menue-belegung.spec.ts` (Kopfknöpfe) einzeln grün; weitere Treffer von `grep -rln "Unfallhilfsstelle bearbeiten" frontend/e2e` nachziehen

## 6. Regeln, Doku, Bilder

- [x] 6.1 `frontend/AGENTS.md`: In „Ort von ‚Bearbeiten‘ und Form des Anlegens“ die Altstellen auf die Anlegen-Drawer kürzen (LLH-1921); in „Bearbeiten in der Ansicht“ „Bereitstellungsraum“ aus der Liste der umzustellenden Seiten streichen; `BearbeitbaresPaneel` im Bausteinkatalog um den Zusatzplatz ergänzen; Prettier grün
- [x] 6.2 `docs/anwender/kapitel/unfallhilfsstellen.md`: Abschnitt zum Bearbeiten auf den Bereich „Angaben“ umschreiben, `quellen` (`UhsBearbeitenModal.tsx` → `UhsAngaben.tsx`, `uhsPatch.ts`); `docs/anwender/kapitel/bereitstellungsraeume.md`: Schritte auf das Paneel „Raumdaten“, `quellen` nachziehen; Wächter von `docs/anwender/AGENTS.md` grün
- [x] 6.3 `e2e/doku-bilder/bereitstellungsraeume.bilder.ts`: „Dialog … bearbeiten“ → offenes Paneel „Raumdaten“; Bild `bereitstellungsraeume/bearbeiten.png` im Bildlauf neu aufnehmen (gebautes Backend); geht das nicht, Text angepasst lassen und Nachzug als Aufgabe anlegen
- [x] 6.4 Mitänderungsregel `docs/architektur/AGENTS.md` prüfen (Kapitel zu Bausteinen/Querschnitt); `scripts/adr-fuer.sh` für die geänderten Pfade gelesen und eingehalten

## 7. Prüfen

- [ ] 7.1 `./scripts/check-all.sh --geaendert --ohne-e2e` grün
- [x] 7.2 Bilder der Änderung (UHS-Bereich „Angaben“ lesen und offen, BR-Paneel „Raumdaten“ lesen und offen) per Wegwerf-Spec aufgenommen

## 8. Befunde des Reviews vor dem PR

- [x] 8.1 Sperrkonflikt ausgezeichnet (D9): `AppError::Veraltet` (409, `grund: "veraltet"`), UHS- und BR-Repo, `isVeraltet` im Client, `isSperrkonflikt` am Baustein; Tests: `error::tests::veraltet_ist_409_mit_grund`, Repo-Tests, Routen-Test mit `grund`, Paneel-Tests, BR/UHS „doppelte Bezeichnung“ rot→grün; Mutationsprobe (ohne `isSperrkonflikt` rot); Statuscode-Konvention in `src/AGENTS.md`
- [x] 8.2 Merker der UHS-Seite (D10): Bereichswechsel mit geänderter Bearbeitung fragt nach; `UhsDetailPage.test.tsx` „geänderte Angaben: ein Bereichswechsel fragt erst nach“ und „… auch die Kopfzahl des Materials fragt erst nach“ rot→grün (Kopfzahl über `handleLinkKlick`)
- [x] 8.3 Stand nach dem Speichern (D11): PATCH-Antwort in den Detail-Cache; Tests „gleich wieder geöffnet“ (BR) und „legt die Antwort … in den Cache“ (UHS) rot→grün
- [x] 8.4 Gerätefall „Gerät ohne Angaben“ getestet (`UhsDetailPage.test.tsx`, Mutationsprobe rot); `design.md` D6/D7 an den Code angeglichen
- [x] 8.5 Nachprüfung der Fix-Commits: zehn leere Dateien unter `src/` entfernt (im Plattenengpass entstanden, mitcommittet); neue Bezeichner nach LFH-1312 (`isVeraltet`, `isSperrkonflikt`); Doc-Kommentare, `frontend/AGENTS.md` Punkt 4, D8, UHS-Spec (Sperrkonflikt ausgezeichnet) nachgezogen; Sprungpalette auf dieselbe UHS als Grenze in D10 vermerkt; Neuabruf-Fehler als LLH-1947, Aufgelöstes als LLH-1948

## Workflow follow-up

- Review vor dem PR (Phase 4 von `dev-zunder-orchestrieren`), bestätigte Befunde behandeln.
- `/opsx:archive rs0zs9ei-uhs-br-bearbeiten-in-ansicht` im selben Branch, Verweise nachziehen.
- PR gegen `alpha` mit Bildern und Abschnitt „Review“.
