# Proposal

Zunder: https://zunder.rubeen.dev/#/aufgabe/gyidpaticmbkp9is51y89zt0 (LLH-1808, Teil von LLH-1724)

## Why

Für dieselbe Aufgabe „umschalten“ stehen heute vier Formen nebeneinander:

- **antd `Tabs`** an 5 Stellen;
- **Segmentleiste als Reiter** an 11 Stellen;
- **`Radio.Group` als Knopfgruppe** an 7 Stellen;
- **`Segmented`** an 1 Stelle.

Keine Regel sagt, wann welche Form gilt. Die Aufträge-Seite zeigt deshalb Reiter, zwei Segmentleisten, Suche und Select übereinander. Für das Bearbeiten gibt es die Regeln schon, sie sind aber über vier Stellen in `frontend/AGENTS.md` verteilt. Wer eine Seite baut, braucht eine kurze Tabelle „wann was“ und eine Oberfläche, die sich daran hält.

## What Changes

- Die Bausteinwahl in `frontend/AGENTS.md` (angelegt von `v127ps65-design-system-nachschlagewerk`) bekommt die Gruppen **Umschalten** und **Bearbeiten**. Die Umschalten-Zeilen sind neue Regel. Die Bearbeiten-Zeilen verweisen auf die bestehenden Regeln (UI-Form-Leitlinie, „Bearbeiten in der Ansicht“, „Ort von Bearbeiten“, Rückfrage) und wiederholen sie nicht. Die Tabelle gelangt über den Generator ins Design System.
- **Fläche umschalten heißt Segmentleiste als Reiter**, entschieden am 16.11.2026. Die antd-`Tabs` auf Aufträge, Planung, Fernmeldewesen (bisher bewusst `Tabs`, LLH-1180 D5) und UHS-Grundriss werden zur Segmentleiste mit `rolle="tablist"` und Reiterfläche. Die ETB-Entwurfsreiter bleiben `Tabs`, weil sie Reiter anlegen und schließen.
- **Kurze Wahl im Formular heißt Segmentleiste als Feld**: Die 7 Knopfgruppen `Radio.Group optionType="button"` (Führung, Betreuung ×2, Ablösung ×2, Ebenenbaum, Archiv einspielen) werden umgestellt.
- **Aufträge:** Der Filter „Richtung“ wird ein Select neben „Empfänger“. Über der Liste steht dann nur noch eine Segmentleiste („Ansicht“).
- **Ausnahme Bearbeiten:** Ein Datensatz ohne eigene Ansicht (Chat-Nachricht, Dokument-Metadaten) darf in einem kurzen Modal mit höchstens etwa 3 Feldern bearbeitet werden. Die Regel „Bearbeiten in der Ansicht“ bekommt diese Ausnahme ausdrücklich.
- Kein neuer Wächter, so abgestimmt am 16.11.2026.

## Capabilities

### New Capabilities

- `bedien-umschalten`: Welche Form eine Wahl oder ein Umschalten bekommt, je nach Zweck: Fläche umschalten, Sicht oder Filter, kurze Formularwahl, lange Optionen, viele Werte, Dokumentreiter.

### Modified Capabilities

(keine; die Bearbeiten-Regeln stehen in `frontend/AGENTS.md`, die Spec `formularseiten` ändert sich nicht)

## Impact

- **Regeln:** `frontend/AGENTS.md` (Bausteinwahl, Punkt 1 von „Bearbeiten in der Ansicht“, Segmentleisten-Strich), `frontend/src/fernmeldewesen/AGENTS.md`, falls dort `Tabs` als Regel steht.
- **Code:** `pages/AuftraegePage.tsx`, `auftraege/AuftraegeListe.tsx`, `planung/PlanungPage.tsx`, `fernmeldewesen/FernmeldewesenReiter.tsx`, `pages/uhs/Grundriss.tsx`, `instanz/FuehrungPaneel.tsx`, `betreuung/BetreuungDialoge.tsx`, `abloesung/AbloesungDialoge.tsx`, `pages/lagekarte/Ebenenbaum.tsx`, `aufbewahrung/ArchivEinspielen.tsx`, dazu ihre Tests.
- **e2e:** `trefflaeche-pruefflaechen.spec.ts`, `gate3-trefflaeche.spec.ts`, `planung-kontrast.spec.ts` und `betreuung-pruefliste.spec.ts` messen bisher `.ant-tabs-tab` bzw. Radio-Knöpfe.
- **Design System:** neu erzeugen (README). Neue ADR, die LLH-1180 D5 für die Reiterform ablöst.
- **Anwenderdoku:** Bilder der vier Seiten ändern sich. Sie werden mit der Folgeaufgabe zur Anwenderdoku aus `m113c8ln` neu aufgenommen.
