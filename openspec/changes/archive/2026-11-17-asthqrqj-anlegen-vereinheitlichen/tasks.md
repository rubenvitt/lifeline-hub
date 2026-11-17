# Tasks

## 1. Anlegen-Dialog für UHS und Bereitstellungsraum (D1, D2)

- [x] 1.1 `components/AnlegenModal.tsx` auf `ErfassungsModal` bauen (Props und Einsatzbindung aus `AnlegenDrawer`, Slot-Typ `AnlegenModalSlot`); `AnlegenDrawer.test.tsx` als `AnlegenModal.test.tsx` übernehmen, auf den Dialog umstellen (Ablehnung im Dialog, Einsatzwechsel, Abbruch während des Speicherns, Kreuz/Escape setzen zurück) und grün sehen; `AnlegenDrawer.tsx` und sein Test fallen
- [x] 1.2 `BrAnlegenDrawer` → `BrAnlegenModal` auf `AnlegenModal`, Aufrufer `BereitstellungsraeumePage`, `BereitstellungsraeumeDefault`, `BrSwitcher` umstellen; Tests der Aufrufer (`BereitstellungsraeumeDefault.test.tsx`, `BereitstellungsraeumePage.test.tsx`) prüfen den Dialog statt der Seitenleiste und laufen grün
- [x] 1.3 `UhsAnlegenDrawer` → `UhsAnlegenModal` auf `AnlegenModal`, Notiz unter „Weitere Angaben“ (`forceRender`, Kopf nennt „Notiz“, wenn gefüllt); Test: drei sichtbare Felder, Aufklappen → vier, gefüllte Notiz steht im Kopf und geht in den POST (Mutationsprobe: Kopfzusatz entfernen → rot); `UhsAnlegenDrawer.test.tsx` (Ortsfeld) als `UhsAnlegenModal.test.tsx` grün
- [x] 1.4 Aufrufer `UnfallhilfsstellenPage`, `UnfallhilfsstellenDefault`, `UhsSwitcher` umstellen; `UhsSwitcher.test.tsx`, `UnfallhilfsstellenDefault.test.tsx`, `UnfallhilfsstellenPage.test.tsx` grün; `grep -rn "AnlegenDrawer\|ant-drawer" frontend/src frontend/e2e` trifft nur noch Verweise in Bilder-Specs, die Gruppe 5 nachzieht (`e2e/uhs-hoehe.spec.ts` Escape bei offenem Drawer prüfen und anpassen)

## 2. UHS-Liste springt in die neue UHS (D3)

- [x] 2.1 `UnfallhilfsstellenPage` reicht `onAngelegt` mit Sprung auf `uhsDetailPfad`; Test in `UnfallhilfsstellenPage.test.tsx`: nach „Anlegen“ steht die Adresse der neuen UHS (rot ohne den Sprung)

## 3. Lagemeldung im Dialog (D4)

- [x] 3.1 `MeldungFormular` Prop `dialog` rendert `ErfassungsModal` mit denselben Formular-Props; Test in `MeldungFormular.test.tsx`: Dialog mit Titel, Abbrechen und Kreuz leeren das Formular, Prüffehler unter „Weitere Angaben“ klappt auch im Dialog auf
- [x] 3.2 `LagemeldungenPage`: Paneel → Dialog „Lagemeldung erfassen“, Kopf-Knopf ohne „Formular schließen“, Leerzustand und `?neu=1` öffnen den Dialog; `LagemeldungenPage.test.tsx` prüft Dialog statt `region`, Schließen nach dem Erfassen, `?neu=1` und Nur-Ansicht, grün
- [x] 3.3 `e2e/lagemeldungen.spec.ts` sucht den Dialog statt der `region`; `frontend/src/etb/AGENTS.md` (Lagemeldungen) beschreibt den Dialog; Prettier über die geänderten Dateien grün

## 4. Regeln (D5, D6)

- [x] 4.1 `frontend/AGENTS.md`: „Form nach Umfang“ (Drawer nur Quick-View), „Bearbeiten in der Ansicht“ Punkt 1 und die Altstellenliste unter „Ort von ‚Bearbeiten‘ und Form des Anlegens“ (nur noch LLH-1920; Nachforderung, Meldungen, Erinnerungen als geprüfte Serienerfassung) nachziehen; `grep -rn "UhsAnlegenDrawer\|BrAnlegenDrawer\|AnlegenDrawer" frontend/AGENTS.md frontend/src` leer; Prettier grün
- [x] 4.2 Purpose von `openspec/specs/bedien-muster/spec.md` um das Anlegen ergänzen; `mise exec -- openspec validate asthqrqj-anlegen-vereinheitlichen --strict` grün

## 5. Anwenderdoku und Bilder

- [x] 5.1 Kapitel `unfallhilfsstellen.md`, `bereitstellungsraeume.md`, `lagemeldungen.md`: „Seitenleiste“/„Paneel“ beim Anlegen → Dialog, UHS-Notiz unter „Weitere Angaben“, Sprung in die neue UHS; `quellen:` auf die neuen Dateinamen; Wächter `src/hilfe/anwenderdoku.guard.test.ts` grün
- [x] 5.2 Bilder-Specs `e2e/doku-bilder/{unfallhilfsstellen,bereitstellungsraeume,lagemeldungen}.bilder.ts` auf den Dialog und die neuen Dateinamen umstellen; nach `cargo build` die drei Kapitel mit `pnpm doku:bilder e2e/doku-bilder/<kapitel>.bilder.ts` neu erzeugen und die Bilder (hell und dunkel, ≤ 300 KB) committen

## 6. Integration

- [x] 6.1 `./scripts/check-all.sh --geaendert --ohne-e2e` grün; e2e `lagemeldungen.spec.ts` einzeln grün

## Workflow follow-up

- Review vor dem PR über den ganzen Branch (`dev-zunder-ausfuehren`, „Review vor dem PR“).
- `/opsx:archive asthqrqj-anlegen-vereinheitlichen` im selben Branch vor dem PR.
- Bilder der Änderung in PR und Meldung.
