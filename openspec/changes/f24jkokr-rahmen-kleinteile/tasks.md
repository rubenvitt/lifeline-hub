# Tasks

Jede Aufgabe per TDD: erst der Test, der ohne die Änderung rot ist, dann der Code.

## 1. Rail-Gedächtnis (D1)

- [x] 1.1 `einsatz/kategorieModul.ts` anlegen (merken je Person, Einsatz und Kategorie, 12-h-Frist,
      fremder Inhalt gilt als nichts gemerkt, nur über `sichererSpeicher`); Unit-Tests in
      `kategorieModul.test.ts` für Frist, Trennung nach Person und Einsatz und kaputten Inhalt sind
      grün.
- [x] 1.2 Reine Funktion `rueckkehrModul` (gemerkt, sonst erstes freigegebenes; gesperrt,
      ausgeblendet, fremde Kategorie oder unbekannter Schlüssel → erstes); Unit-Tests für jeden
      Zweig sind grün.
- [x] 1.3 `EinsatzLayout.tsx`: Ankunft unter `merkbar` merken, `onKategorieKlick` springt über
      `rueckkehrModul`; Test in `EinsatzLayout.test.tsx` „Kräfte → Ablösung → Erfassung → Kräfte
      landet in Ablösung“ grün, und „Zuletzt besucht“ bleibt nach dem Rail-Sprung unverändert
      (bestehender Test grün).
- [x] 1.4 Eintrag `lfh:nav:kategorie-modul:<benutzer>:<einsatz>` in `GERAETESPEICHER`
      (`offline/geraetRaeumung.ts`, `bleibt`); `geraetRaeumung.guard.test.ts` grün.

## 2. Panel-Wahl hält beim Rail-Sprung (D2)

- [x] 2.1 `sprungOffen` in `onKategorieKlick` nur ohne gemerkte Wahl; Test in
      `EinsatzLayout.test.tsx`: gemerkte Wahl „zu“, Fremdklick → Panel bleibt zu; ohne Wahl am
      Tablet quer öffnet es (bestehender Test grün).

## 3. Rail-Fuß im Fenster (D3)

- [ ] 3.1 `IconRail.tsx`: Vorlauf messen und von der Spaltenhöhe abziehen, Kommentar zur Spalte
      nachziehen; e2e-Fall in `e2e/rahmen-stehen-bleiben.spec.ts`: 1366 × 768, offline geschaltet,
      Rollstand 0 → Unterkante von „Einst.“ ≤ Fensterhöhe; ohne Änderung rot.

## 4. Beschreibungen und Drawer (D4, D5)

- [ ] 4.1 `modulBeschreibungStil` auf zwei Zeilen mit Auslassung; Unit-Test in
      `ModulPanel.test.tsx` prüft Zeilenbegrenzung 2 und `whiteSpace: 'normal'`.
- [ ] 4.2 `navDrawerBreite` als `min(360px, calc(100vw - 48px))` (über `size` oder
      `styles.wrapper`, je nach antd-Typ); e2e-Maß bei 390 × 844 ergibt 342 px, und bei 1440 px
      steht unter „Lagebesprechung“ die Beschreibung ohne Auslassung (`scrollHeight ≤
      clientHeight`), in `e2e/modulnamen.spec.ts` oder einer benachbarten Spec.

## 5. Kopplungsende als Restzeit (D6)

- [ ] 5.1 Reine Funktion `kopplungRestText` in `geraet/GeraeteKopf.tsx`; Unit-Tests für 5 h 40 →
      „noch 5 h“, 60 min → „noch 1 h“, 40 min → „noch 40 min“, 30 s → „noch 1 min“, abgelaufen →
      „endet“.
- [ ] 5.2 `KopplungsEnde` zeigt „Kopplung noch …“, `title`/`aria-label` „Kopplung bis
      <zeitpunkt>“; `GeraeteHuelle.test.tsx` und die e2e-Specs, die `kopf-kopplungsende` lesen,
      angepasst und grün.

## 6. Doku und Abschluss

- [ ] 6.1 `docs/anwender/kapitel/einsatz-oberflaeche.md` („Ein Modul öffnen“: zuletzt besuchtes
      Modul, Panel bleibt zu) und `geraet-bedienen.md` („Kopfzeile lesen“: „Kopplung noch …“)
      nachziehen, dazu `geraete-koppeln.md` falls nötig; Bilder beider Kapitel neu erzeugen
      (`pnpm doku:bilder e2e/doku-bilder/<kapitel>.bilder.ts`), Wächter
      `src/hilfe/anwenderdoku.guard.test.ts` grün.
- [ ] 6.2 `./scripts/check-all.sh --geaendert --ohne-e2e` grün, dazu die berührten e2e-Specs
      (`rahmen-stehen-bleiben`, `modulnamen`, `rail-etikett`, `geraet-kopplung`) einzeln grün.

## Workflow follow-up

- Review vor dem PR (Agent mit frischem Kontext), bestätigte Befunde beheben.
- `/opsx:archive f24jkokr-rahmen-kleinteile` im selben Branch, dann PR gegen `alpha`.
