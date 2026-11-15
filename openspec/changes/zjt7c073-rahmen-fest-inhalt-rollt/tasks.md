# Tasks

Arbeitsweise je Aufgabe: `superpowers:test-driven-development` (Test zuerst rot), Pfade relativ zu
`frontend/src/`.

## 1. Zwei Höhen im Rahmen (D2)

- [x] 1.1 `components/rahmenOben.ts`: Quellen mit Ebene `kopf` | `seitenkopf`, `--lfh-kopf-oben` und `useKopfOben()` für die Ebene `kopf`, `--lfh-rahmen-oben` und `useRahmenOben()` als Summe beider; bestehende Aufrufer melden sich als `kopf`. Nachweis: neuer Unit-Test (`rahmenOben.test.ts`) prüft beide Summen beim An- und Abmelden, `pnpm test rahmenOben` grün
- [x] 1.2 Guard `components/rahmenOben.guard.test.ts`: `--lfh-kopf-oben` nur in der festen Liste (Rail, Modulpanel, Verwaltungsmenü, Seitenkopf) zulässig, sonst weiter `--lfh-rahmen-oben` Pflicht. Nachweis: Guard grün; eine Probe mit `--lfh-kopf-oben` in einer fremden Datei macht ihn rot (Mutationsprobe, nicht committet)
- [x] 1.3 Rail-Spalte (`einsatz/IconRail.tsx`) und Verwaltungsmenü (`admin/AdminLayout.tsx`, `seitenleistenStil`) auf `--lfh-kopf-oben`. Nachweis: bestehende Tests von `IconRail` und `AdminLayout` grün, angepasster Erwartungswert in `AdminLayout.test.tsx`

## 2. Modulpanel als klebende Spalte (D4)

- [x] 2.1 `einsatz/ModulPanel.tsx`: innere Spalte `sticky`, `top: var(--lfh-kopf-oben)`, Höhe bis Fensterende; Kopf fest, Liste rollt in sich, Fuß „Einsatzdauer“ fest am Ende. Nachweis: Unit-Test prüft Stil der Spalte und dass die Liste der einzige rollende Bereich ist; `ModulPanel.test.tsx` grün
- [x] 2.2 `einsatz/fussFokusabstand.ts` und die Regel `modul-panel … scroll-padding-block-end` in `index.css` entfernen, Verweise greppen (`rahmenOben.ts`-Kommentar). Nachweis: `grep -rn fussFokusabstand frontend/src` leer, Lint und Typprüfung grün

## 3. Seitenkopf klebt (D3, D6)

- [x] 3.1 Hook für die Entscheidung (ab `md`, nur im Dokument-Bildlauf, Drittel-Regel) samt reiner Funktion; `KLEBEN_HOECHSTENS` an einen gemeinsamen Ort ziehen. Nachweis: Unit-Tests der reinen Funktion (Grenze genau ein Drittel, darüber, unter `md`, eigener Scrollbereich)
- [x] 3.2 `components/EinsatzSeite.tsx`: Seitenkopfleiste klebt nach dem Hook oder nach `kopfKlebt` von außen, `top: var(--lfh-kopf-oben)`, meldet sich als Quelle der Ebene `seitenkopf`. Nachweis: Unit-Test „klebt ab md“, „klebt nicht mit `kopfKlebt={false}`“; `EinsatzSeite.test.tsx` grün
- [x] 3.3 `components/AdminPage.tsx`: derselbe Hook für die Seitenkopfleiste. Nachweis: Unit-Test in `AdminPage.test.tsx` (bzw. neu)
- [x] 3.4 `index.css`: Fokus im Seitenkopf setzt `scroll-padding-block-start` auf `var(--lfh-kopf-oben)`; ETB-Ausnahme ebenso. Nachweis: e2e-Szenario „Fokus unter dem klebenden Seitenkopf“ (Gruppe 5)

## 4. ETB auf der allgemeinen Mechanik (D5)

- [x] 4.1 `etb/etbKopfKleben.ts`, `pages/EtbPage.tsx`, `etb/EtbSpaltenzeile.tsx`, `etb/nachOben.ts`, `index.css`: `--lfh-etb-seitenkopf-hoehe` entfällt, Filterleiste unter `--lfh-rahmen-oben`, Unterkante `rahmen-oben + filterleiste`, „Nach oben“ ohne Doppelzählung. Nachweis: `etbKopfKleben.test.ts`, `nachOben`-Tests und ETB-Seitentests grün
- [x] 4.2 `frontend/src/etb/AGENTS.md` Abschnitt „Kleben“ nachziehen. Nachweis: Prettier grün, Verweise stimmen (`grep -rn "lfh-etb-seitenkopf-hoehe"` leer)

## 5. Nachweis im Browser

- [x] 5.1 `e2e/rahmen-stehen-bleiben.spec.ts` um die Szenarien der Delta-Spec erweitern (Modulpanel im ETB bei 1440 × 900, Panel in 1366 × 520 handschuh, Seitenkopf in ETB/Personal/Einstellungen/Verwaltung, niedriges Fenster, Tabellenkopf unter dem Seitenkopf, Fokus rückwärts). Nachweis: Spec läuft grün gegen den Stand des Branches
- [x] 5.2 Bestehende Rahmen- und Fokus-Specs laufen grün: `rahmen-stehen-bleiben`, `fokus-verdeckung`, `etb-filterleiste`, `alarm-verdeckung`, `rahmen-cls-dichte`, `gate3-trefflaeche`, `kraefte-seitenkopf`, eine Druck-Spec (`etb-druck`). Nachweis: Lauf mit Ergebnis im PR unter „Geprüft“

## 6. Regeln und Design System

- [x] 6.1 `frontend/AGENTS.md` Abschnitt Rahmen („Stehenbleiben, gestuft“, „Wer oben klebt“, Seitenkopf-Spiegelstrich bei den Bausteinen) auf zwei Höhen, klebendes Modulpanel und klebenden Seitenkopf umstellen. Nachweis: Prettier grün
- [x] 6.2 `mise exec -- pnpm -C frontend design-system` laufen lassen (README trägt den Rahmen-Abschnitt), Erzeugtes mitcommitten. Nachweis: Wächter `designSystem.guard.test.ts` grün

## 7. Gates

- [ ] 7.1 `./scripts/check-all.sh --geaendert --ohne-e2e` grün. Nachweis: Ausgabe im PR unter „Geprüft“

## Workflow follow-up

- Review vor dem PR (frischer Agent, Prüfliste, Gegenprüfung), Verbleib im PR unter „Review“.
- Bilder der Änderung (ETB gerollt mit Panel und Seitenkopf, vorher/nachher; Verwaltung gerollt).
- `/opsx:archive zjt7c073-rahmen-fest-inhalt-rollt` im selben Branch, dann PR gegen `alpha`.
