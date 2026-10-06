## 1. Handlungskarten und Guard (D1, D4)

- [ ] 1.1 Tests zuerst (`kommunikation/wortlaut.guard.test.ts`): Gleichheitsprüfung Handlung ↔ Statuswort für Meldung, Auftrag, Nachforderung, Dienststatus; Quelltext-Scan „kein `<Button>` mit `…_STATUS[…].label`“; kein „Quittier…“ in `erinnerung/` und `pages/ErinnerungenPage.tsx`; Selbstbeweise.
- [ ] 1.2 `MELDUNG_HANDLUNG`, `AUFTRAG_HANDLUNG`, `NACHFORDERUNG_HANDLUNG`, `ERINNERUNG_HANDLUNG` in `kommunikation/phase.ts`, Export über `kommunikation/index.ts`. Mutationsprobe: ein Handlungstext gleich dem Statuswort → 1.1 rot.

## 2. Fortschaltknöpfe (D1)

- [ ] 2.1 Tests zuerst: `MeldungKarte.test.tsx`, `MeldungenPage.test.tsx`, `AuftraegePage.test.tsx`, `AuftragVorschau.test.tsx`, `NachforderungKarte`-/Seitentest, `FahrzeugeTab.test.tsx`, `PersonalTab.test.tsx`, `MaterialTab.test.tsx` auf die neuen Namen.
- [ ] 2.2 `MeldungKarte` (Knopf und ⋮-Menü), `AuftragKarte` („Bearbeitung beginnen“, „Quittieren“ groß), `NachforderungKarte`, `stammdaten/dienststatus.tsx` lesen die Karten. `e2e/palette-oeffnung.spec.ts` nachziehen.

## 3. Erinnerungen (D2, D3)

- [ ] 3.1 Tests zuerst (`ErinnerungKarte`/`ErinnerungenPage.test.tsx`, `ErinnerungListe.test.tsx`): Knöpfe „Erübrigt (zur Kenntnis)“ und „Erledigt (durchgeführt)“, kein Tooltip an den Knöpfen, Statuswort „Erübrigt“, „Erübrigt: ‹Zeit›“, kein `QuittungIndikator`, Toast „Erinnerung erübrigt“.
- [ ] 3.2 `ErinnerungKarte.tsx`, `ERINNERUNG_STATUS`, `pages/ErinnerungenPage.tsx` umsetzen. Mutationsprobe: Tooltip zurück und Knopf „Quittieren“ → 3.1 und 1.1 rot.

## 4. Meldungen: Bestätigung überfällig (D5)

- [ ] 4.1 Tests zuerst: `meldungKennzahlen.test.ts` (Feld `bestaetigungUeberfaellig`), `MeldungenPage.test.tsx` (Kennzahl „Bestätigung überfällig“, kein „Alarmiert“), `MeldungKarte.test.tsx` (kein „Alarm“, Uhr im Chip).
- [ ] 4.2 `meldungKennzahlen.ts`, `MeldungenPage.tsx`, `MeldungKarte.tsx` umsetzen.

## 5. e2e

- [ ] 5.1 Layout-Gate (`e2e/knopf-wortlaut.spec.ts`): Erinnerungen, Meldungen, Aufträge, Nachforderungen bei 390, 820, 1180 und 1440 ohne waagerechten Überhang der Aktionszeilen; Erinnerungsknöpfe als Wort sichtbar; als Beobachter über `e2e/rollen-kern.ts` mit der Vorbedingung, dass die Knöpfe fehlen.

## 6. Regel und Abschluss

- [ ] 6.1 `frontend/AGENTS.md`, Bedien-Leitlinie „Aktionen“: die Regel aus `specs/bedien-wortlaut` mit Verweis auf den Guard.
- [ ] 6.2 Lint, Typecheck, Vitest der berührten Dateien, Mutationsproben.
- [ ] 6.3 `./scripts/check-all.sh` (Bündel `schnell`, Vitest; e2e der berührten Specs).
