# Proposal

## Why

Die Prüfliste der Dokumentenablage (LFH-632, Fläche Dialog, Kriterium 2 „Handschuh-Modus“)
hat zwei Befunde, die in keinem Modul, sondern in gemeinsamen Teilen stecken. Gemessen in
`e2e/dokumente.spec.ts` („Dichte-Staffel …“):

- Der **Klappkopf** von antds `Collapse` („Weitere Angaben“, „Bezug (optional)“) misst
  36 / 45 / 55 px. Die Staffel verlangt 30 / 48 / 72. antd rechnet den Kopf aus Schrift und
  `paddingSM`, nicht aus `controlHeight`, deshalb verfehlt er in `komfortabel` und `handschuh`
  den Boden.
- Die **Fuge** zwischen „Abbrechen“ und dem Primärknopf im Fuß der Erfassungs-Hülle misst
  3 / 5 / 7 px (`abstand.xs`). Die Leitlinie verlangt ≥ 16 px im Handschuh-Betrieb
  (MIL-STD-1472F Fig. 24) und ≥ 8 px in `komfortabel` (Präzedenz LFH-630).

Ein Nachtrag aus der Prüfliste zu LFH-690 erweitert den Umfang: **jede Rückfrage der App**
hat dieselbe 3 / 5 / 7-px-Fuge, weil antd die Knöpfe seiner eigenen Füße mit `marginXS`
trennt und `marginXS` bei uns `abstand.xs` ist. Das betrifft den Standardfuß von `<Modal>`,
`modal.confirm` und die Bestätigungsblase `Popconfirm`. Dort steht fast immer ein roter
Knopf neben „Abbrechen“; mit Handschuh trifft man leicht den falschen.

## What Changes

- **Klappkopf folgt der Staffel:** Jeder Klappkopf eines `Collapse` erreicht mindestens die
  Steuerhöhe der Stufe (30 / 48 / 72 px), app-weit über den Kontext und nicht je Stelle. Die
  Beschriftung steht dabei senkrecht mittig. In `kompakt` bleibt der Kopf wie heute (36 px,
  über dem Boden).
- **Fuß der Erfassungs-Hülle:** Die Knöpfe stehen mit dem Abstand `padding` auseinander
  (11 / 18 / 26 px), derselbe Abstand, den die Regel „Rot steht nicht bündig neben
  Neutralem“ schon für Aktionsreihen verlangt. Die Hülle kommt in den Abstands-Guard.
- **Füße, die antd selbst baut:** Modal-Fuß, `modal.confirm` und `Popconfirm` trennen ihre
  Knöpfe mit demselben Abstand 11 / 18 / 26 px, über eine globale Stilregel, die antds eigenes
  Abstands-Token liest. Titel, Warnsymbol und übrige Abstände bleiben wie heute.
- **Nachweis:** Playwright misst Klappkopf, Erfassungsfuß und die Bestätigungsblase in allen
  drei Stufen mit Böden als Literalen. Unit-Tests pinnen die reine Funktion des Klappkopfs, die
  Verdrahtung im Kontext und die Stilregel der antd-Füße. Dazu kommt die Mutationsprobe „Stufe
  festgenagelt → rot“.
- **Regeln und Doku:** `frontend/AGENTS.md` nennt den Klappkopf-Boden und die Fußfuge. Die
  Prüfliste LFH-632 vermerkt Zeile 2 · 2 als eingelöst.

## Nicht-Ziele

- Keine neue Kompaktgröße für den Klappkopf. `kompakt` behält seine 36 px, der Kopf wird nur
  angehoben, nie gekürzt.
- Keine allgemeine Abstandsregel für jede Knopfnachbarschaft der App. Die Änderung deckt die
  Dialogfüße (Erfassungs-Hülle und antds eigene Füße). Freie Aktionsreihen bleiben beim
  bestehenden Abstands-Guard.
- Kein Umbau der Erfassungsmasken auf einen gemeinsamen „Weitere Angaben“-Baustein.

## Capabilities

### New Capabilities

_Keine._

### Modified Capabilities

- `einsatztauglichkeit-layout`: zwei neue Anforderungen. „Klappkopf folgt der Dichtestufe“:
  jeder Klappkopf erreicht die Steuerhöhe der Stufe. „Abstand zwischen den Knöpfen eines
  Dialogfußes“: in Erfassungs- und Rückfragefüßen halten benachbarte Knöpfe ≥ 8 px in
  `komfortabel` und ≥ 16 px in `handschuh`.

## Impact

- **Frontend:** `frontend/src/theme/tokens.ts` (neue reine Funktion für den Klappkopf),
  `frontend/src/theme/ThemeModeProvider.tsx` (Klappkopf-Stil am `ConfigProvider`),
  `frontend/src/index.css` (Fußfuge der antd-Füße), `frontend/src/components/Erfassung.tsx`
  (Fußabstand).
- **Tests:** `frontend/src/theme/tokens.test.ts` (Klappkopf, Stilregel der Füße),
  `frontend/src/theme/ThemeModeProvider.test.tsx` (Verdrahtung des Klappkopfs),
  `frontend/src/components/aktionsabstand.guard.test.ts` (Hülle aufgenommen),
  `frontend/e2e/dokumente.spec.ts` (aus „nur gemessen“ wird zugesichert, Rückfrage gemessen).
- **Verbraucher ohne Änderung im Quelltext:** rund 25 `Collapse`-Stellen, rund 30
  `Popconfirm`-Stellen, alle `<Modal>` mit Standardfuß und die drei `modal.confirm`-Aufrufe.
- **Regeln und Doku:** `frontend/AGENTS.md`,
  `docs/superpowers/specs/2026-09-22-lfh-632-pruefliste.md`.
- Kein Backend, keine API, keine Migration.
