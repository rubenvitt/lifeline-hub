# Design

## Context

Die Motivation steht in `proposal.md` unter „Why“. Stand am 16.11.2026 (34be1aab):

**Umschalten**
- `<Tabs` steht an 5 Stellen: `pages/AuftraegePage.tsx`, `planung/PlanungPage.tsx` (`destroyOnHidden`), `fernmeldewesen/FernmeldewesenReiter.tsx` (navigiert je Reiter, LLH-1180 D5), `pages/uhs/Grundriss.tsx` (reicht die Resthöhe über `styles.body/content` weiter) und `etb/entwuerfe/EtbEntwurfsTabs.tsx` (`editable-card`).
- `Segmentleiste rolle="tablist"` steht an 11 Stellen. Das Muster für die Reiterfläche ist ein `div role="tabpanel"` mit `id`, das die Option über `steuert` (`aria-controls`) erreicht, siehe `geraet/GeraetStellePage.tsx` und `pages/EinsatzEinstellungenPage.tsx`.
- `Radio.Group optionType="button"` kommt 7-mal in 6 Dateien vor. Eine Segmentleiste als Formularfeld gibt es bisher nur als lokalen Adapter (`ArtFeld` in `stammdaten/MaterialFormModal.tsx` und `kraefte/MaterialAdhocDialog.tsx`).
- Auf der Aufträge-Seite stehen im Reiter „Einzelaufträge“ über der Liste: die Segmentleiste „Ansicht“, die Suche, die Segmentleiste „Richtung“ (alle/intern/extern) und das Select `EmpfaengerFilter`.

**Bearbeiten**
- Die Regeln stehen in `frontend/AGENTS.md`: Form nach Umfang (LFH-19), Bearbeiten in der Ansicht (LLH-1139, 7 Punkte), Ort von Bearbeiten (LLH-1722 D8) und Popconfirm (Abschnitt Aktionen).

**e2e**
- `.ant-tabs-tab` wird gemessen in `trefflaeche-pruefflaechen.spec.ts`, `gate3-trefflaeche.spec.ts` (2×), `planung-kontrast.spec.ts` und `etb-entwurf-tabs.spec.ts`. Die ETB-Stellen bleiben.

## Goals / Non-Goals

**Goals:**
- Eine Tabelle „wann was“ für Umschalten und Bearbeiten an einer Stelle.
- Jede Umschaltaufgabe hat genau eine Form.
- Die Ausreißer werden angeglichen.

**Non-Goals:**
- Die Altstellen von UHS und Bereitstellungsraum (Bearbeiten im Modal, Anlegen im Drawer). Für sie gibt es schon die Folgeaufgaben LLH-1920 und LLH-1921.
- Die lokalen `ArtFeld`-Adapter. Sie sind keine Ausreißer und dürfen beim nächsten Anfassen auf `SegmentFeld` wechseln.
- Ein Wächter.

## Decisions

**D1: Tabelle in der Bausteinwahl.** Gruppe **Umschalten**:

| Bedarf | Baustein |
|---|---|
| Fläche oder Bereich darunter umschalten | `Segmentleiste rolle="tablist"` mit Reiterfläche |
| Dokumentreiter mit Anlegen und Schließen | antd `Tabs` `editable-card` |
| Sicht oder Status derselben Liste, bis etwa 5 Werte | `Segmentleiste` (`radiogroup`), eine je Ebene |
| Weitere Einschränkung derselben Liste | `Select` oder Suche in der Werkzeugzeile |
| Kurze Wahl im Formular | `SegmentFeld` |
| Wahl mit erklärenden Optionen | senkrechte `Radio.Group` |
| Viele Werte oder Wahl aus Stammdaten | `Select` |
| Zweizustand neben einer Leiste | `SegmentUmschalter` |
| antd `Segmented` | nie |

Gruppe **Bearbeiten**: Einzelwert → `InlineAngabe`/`BemerkungZelle` · zusammengehörige Werte → `BearbeitbaresPaneel` `paneel` · ganze Ansicht → `BearbeitbaresPaneel` `ansicht` · Anlegen → `ErfassungsModal` · Serienerfassung → `Schnellerfassungszeile` · kurze blockierende Aktion → Modal · Unumkehrbares → rote `Popconfirm`, aus einem Zeilenmenü ein Modal · nur ansehen → Drawer · Datensatz ohne eigene Ansicht → kurzes Modal (D5). Jede Bearbeiten-Zeile verweist auf ihren Abschnitt und wiederholt dessen Wortlaut nicht.

Verworfen wurde eine eigene Karte „Wann was“ mit gerenderten Bausteinen (Variante D). Sie wäre eine zweite Darstellung derselben Regel, und die Karten der genannten Bausteine gibt es ohnehin.

**D2: Reiterform ist die Segmentleiste.** So entschieden am 16.11.2026. Die Segmentleiste ist der hauseigene Baustein, trägt die Dichte-Staffel und die Rollen `tablist`/`tab` schon, und 11 Stellen nutzen sie bereits. Umgestellt werden vier Stellen nach dem bestehenden Muster: Segmentleiste plus `div role="tabpanel"` mit `id` und `aria-labelledby`/`aria-label`; jede Option erhält `steuert`.
- Planung rendert nur die aktive Fläche, wie bisher mit `destroyOnHidden`.
- Grundriss reicht die Resthöhe über einen Flex-Behälter weiter.
- Fernmeldewesen behält seine Navigation je Reiter.
- Aufträge behält den Reiter in der URL, wie bisher `reiterWechseln`.

Verworfen wurden ein neuer Baustein `Reiterleiste`, denn das Muster ist zwei Zeilen und schon elfmal so gebaut, sowie `Tabs` statt der Segmentleiste: 11 Umstellungen statt 4, und LLH-1065 wäre umgekehrt.

**D3: `SegmentFeld` als Formularvariante der Segmentleiste.** In `components/instrument/Segmentleiste.tsx` kommt ein Export `SegmentFeld<W>({ value, onChange, optionen, beschriftung, … })` dazu, der die Formularschnittstelle von antd (`value`/`onChange`) auf `wert`/`onWechsel` abbildet. Ohne `value` ist nichts gewählt, wie in LLH-1612. Er ist eine Variante, kein neuer Baustein: Die Karte „Segmentleiste“ zeigt ihn als zusätzlichen Zustand im `Form`. Die 7 Knopfgruppen stellen auf `<Form.Item><SegmentFeld …/></Form.Item>` um; wo die `Radio.Group` ohne `Form.Item` steht (Ebenenbaum), auf `Segmentleiste`. Mit LLH-1810 (`Feld`) kann `SegmentFeld` später in den Feld-Baustein aufgehen.

**D4: Aufträge.** Die Segmentleiste „Richtung“ wird ein `Select` (`aria-label` „Richtung“, mit dem Wert „Alle Richtungen“ als Vorgabe) in derselben Werkzeugzeile wie `EmpfaengerFilter`. Query-Key und Filterlogik bleiben unverändert (`richtungsKey`). Über der Liste steht dann nur noch „Ansicht“.

**D5: Ausnahme vom Bearbeiten in der Ansicht.** Punkt 1 von „Bearbeiten in der Ansicht“ bekommt einen Satz dazu: Ein Datensatz, der keine eigene Ansicht hat (eine Chat-Nachricht, die Metadaten eines Dokuments), darf in einem kurzen Modal mit höchstens etwa 3 Feldern bearbeitet werden. Damit sind `chat/BearbeitenModal.tsx` und `dokumente/DokumentBearbeitenModal.tsx` Regel statt Ausreißer.

**D6: ADR.** Eine neue ADR „Eine Fläche schaltet die Segmentleiste um; antd-Tabs nur für Dokumentreiter“ mit `gilt_fuer` `frontend/src/**/*.tsx`. Ihre Prüfung nutzt `verbiete '<Tabs'` mit einer Ausnahme für `etb/entwuerfe/` und `verbiete 'optionType="button"'`. Das ist kein Vitest-Wächter, sondern die Prüfung der ADR, wie bei jeder ADR. Ist in den ADRs schon eine Regel zu LLH-1180 D5 festgehalten, wird sie dort ersetzt.

## Risks / Trade-offs

- [antd-Tabs bringen Wischen, Überlaufmenü und Animation mit, die Segmentleiste nicht] → Die vier Stellen haben 2 bis 4 Reiter, also keinen Überlauf. Fernmeldewesen hat 4 Reiter, die auf schmalen Breiten umbrechen dürfen; das prüft das e2e-Szenario „ohne waagerechten Überlauf“ der Spec `fernmeldewesen`.
- [e2e-Pins auf `.ant-tabs-tab` brechen] → Sie werden auf `getByRole('tab')` umgestellt, im selben Commit wie die jeweilige Stelle.
- [Die Höhenkette im Grundriss bricht] → Ein Komponententest prüft, dass die Reiterfläche die Resthöhe trägt, dazu ein Bild im Handschuh-Betrieb.
- [Fernmeldewesen kehrt eine bewusste Entscheidung um (LLH-1180 D5)] → Die Umkehr ist abgestimmt und steht in der ADR mit Verweis.
- [Konflikt mit `v127ps65` in `frontend/AGENTS.md` und `readme.ts`] → Diese Change setzt im Branch auf v127ps65 auf und hängt nur Zeilen an.

## Migration Plan

Reine Frontend-Änderung ohne Daten. Bei einem Fehler wird die jeweilige Stelle zurückgesetzt; die Stellen sind voneinander unabhängig.
