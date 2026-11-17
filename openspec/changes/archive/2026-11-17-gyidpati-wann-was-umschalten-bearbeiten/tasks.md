# Tasks

## 1. Regel und Design System

- [x] 1.1 Die Gruppen Umschalten und Bearbeiten in der Bausteinwahl von `frontend/AGENTS.md` nach design.md D1 eintragen. Der Segmentleisten-Strich in der Gestaltungssprache verweist auf die Tabelle, statt sie zu wiederholen. Punkt 1 von „Bearbeiten in der Ansicht“ bekommt die Ausnahme aus D5. `prettier --check` ist grün, und der Abdeckungswächter aus v127ps65 ist grün (die Tabelle nennt nur Karten, die es gibt).
- [x] 1.2 `frontend/src/fernmeldewesen/AGENTS.md` und die ADRs (`scripts/adr-fuer.sh frontend/src/fernmeldewesen/FernmeldewesenReiter.tsx`) auf eine Regel zu `Tabs` prüfen. Wo eine steht, wird sie auf die neue Regel umgestellt bzw. per neuer ADR ersetzt. Das Ergebnis steht im Commit.

## 2. SegmentFeld

- [x] 2.1 Test zuerst: `SegmentFeld` in `components/instrument/Segmentleiste.test.tsx` deckt ab: in einem antd-`Form` mit `Form.Item` wird der gewählte Wert übermittelt; ohne `value` ist nichts gewählt; eine Pflichtregel zeigt die Fehlerzeile. Danach `SegmentFeld` nach D3 umsetzen und über `instrument/index.ts` exportieren, bis die Tests grün sind.
- [x] 2.2 Die Karte „Segmentleiste“ in `previews.tsx` um den Zustand `SegmentFeld` im `Form` ergänzen, die Höhe neu messen und die Karte neu erzeugen. `designSystem.guard.test.ts` ist grün.

## 3. Knopfgruppen angleichen

- [x] 3.1 `instanz/FuehrungPaneel.tsx`: `Radio.Group optionType="button"` → `SegmentFeld`. Der Komponententest der Stelle wählt über `getByRole('radio')` und prüft den gespeicherten Wert, grün.
- [x] 3.2 `betreuung/BetreuungDialoge.tsx` (2 Stellen): wie 3.1. Die e2e-Erwartung in `e2e/betreuung-pruefliste.spec.ts` wird nachgezogen, die Komponententests sind grün.
- [x] 3.3 `abloesung/AbloesungDialoge.tsx` (2 Stellen): wie 3.1, die Komponententests sind grün.
- [x] 3.4 `pages/lagekarte/Ebenenbaum.tsx`: auf `Segmentleiste`, der Komponententest ist grün.
- [x] 3.5 `aufbewahrung/ArchivEinspielen.tsx`: auf `SegmentFeld`, der Komponententest ist grün. Danach findet `rg 'optionType="button"' frontend/src` keinen Treffer mehr.

## 4. Reiter auf die Segmentleiste

- [x] 4.1 `pages/AuftraegePage.tsx`: `Tabs` → Segmentleiste `tablist` mit Reiterfläche (D2), der Reiter in der URL bleibt. Ein Test prüft die Rollen `tablist`/`tab`/`tabpanel`, `aria-controls`, Pfeiltasten und den Wechsel der Fläche.
- [x] 4.2 `auftraege/AuftraegeListe.tsx`: „Richtung“ als `Select` neben `EmpfaengerFilter` (D4). Ein Test prüft, dass über der Liste nur noch eine Segmentleiste steht und dass der Richtungsfilter die Abfrage wie bisher setzt.
- [x] 4.3 `planung/PlanungPage.tsx`: `Tabs` → Segmentleiste. Nur die aktive Fläche wird gerendert, die Zahlen im Reiterwortlaut bleiben. Der Test der Seite ist grün, und `e2e/planung-kontrast.spec.ts` ist auf `getByRole('tab')` umgestellt.
- [x] 4.4 `fernmeldewesen/FernmeldewesenReiter.tsx`: `Tabs` → Segmentleiste, die Navigation je Reiter bleibt. Die Tests unter `fernmeldewesen/` sind grün, das Spec-Szenario „ohne waagerechten Überlauf“ ist im e2e grün.
- [x] 4.5 `pages/uhs/Grundriss.tsx`: `Tabs` → Segmentleiste mit Reiterfläche, die die Resthöhe trägt. Ein Komponententest prüft die Höhenkette.
- [x] 4.6 Die e2e-Pins auf `.ant-tabs-tab` außerhalb des ETB (`trefflaeche-pruefflaechen.spec.ts`, `gate3-trefflaeche.spec.ts`) auf `getByRole('tab')` stellen. Ein Lauf dieser Specs gegen den lokalen Stand ist grün. Danach findet `rg '<Tabs' frontend/src --glob '!**/etb/entwuerfe/**'` keinen Treffer. Erledigt: Der Lauf ist grün. Übrig bleiben die ETB-Entwurfsreiter, also die Ausnahme, und ein Prüfstring in `components/datensicht.guard.test.ts`.

## 5. ADR und Integration

- [x] 5.1 ADR nach D6 anlegen (nächste freie Nummer nach den ADRs von m113c8ln und v127ps65), `herleitung` auf das Archiv-`design.md` dieser Change. Ihre Prüfung läuft lokal grün, und der ADR-Wächter ist grün.
- [x] 5.2 Design System neu erzeugen (README mit der Tabelle, Karte Segmentleiste). `./scripts/check-all.sh --geaendert --ohne-e2e` ist grün, die e2e-Specs aus 3.2, 4.3, 4.4 und 4.6 sind grün. Vorher-nachher-Bilder von Aufträgen, Planung, Fernmeldewesen und Grundriss sowie von einer umgestellten Knopfgruppe liegen für den PR vor. Erledigt: Der Gate-Lauf lief nach zwei Neustarts des Containers geteilt: `--nur schnell` grün, die Frontend-Suite in vier Teilen grün (20 794 Tests). Die e2e-Specs sind grün, ausgenommen C10 in `trefflaeche-pruefflaechen.spec.ts`, das auch auf `alpha` rot ist (LLH-1943). Die Bilder liegen vor.

## Workflow follow-up

- Review vor dem PR über den ganzen Branch (Orchestrator, Phase 4).
- `/opsx:archive gyidpati-wann-was-umschalten-bearbeiten` vor dem PR im selben Branch.
