# Proposal

Zunder: LLH-1725 (https://zunder.rubeen.dev/#/aufgabe/wc3kzd54va0a97rxvv93uvn0)

## Why

Ein Einsatz mit der Einsatzart „Übung“ sieht überall aus wie ein Realeinsatz. Kopfleiste,
Tab-Titel, Wechsler, Gerätemodus und Druck werten das Feld `einsatzart` nicht aus, und in der
Einsatzliste steht „Übung“ als grauer Tag neben anderen Tags. Erkennbar ist eine Übung nur, wenn
jemand „ÜBUNG“ in den Namen getippt hat. So landen Übungsdaten im echten Einsatz oder umgekehrt
(UI/UX-Analyse vom 12.11.2026, Thema 1, als kritisch eingestuft).

## What Changes

- Neue Farbrolle **`uebung`** (Violett, Nacht und Tag). Erkennbar ist die Übung an Form und Wort, nicht am
  Farbton allein (Violett tragen auch ETB-Entscheidung und Abschnittsflächen der Lagekarte).
  Die Marke trägt immer das Wort „ÜBUNG“, im Band zusätzlich eine Schrägschraffur. Die Farbe ist
  nie der einzige Hinweis.
- **Einsatzrahmen:** ein durchgehendes Band „ÜBUNG“ über die volle Breite direkt unter der
  Kopfleiste, in jedem Modul. Es bleibt in jeder Breite beim Rollen stehen, auch am Handy, wo der
  Kopf selbst mitrollt. Ab `md` steht zusätzlich eine Marke vor dem Einsatznamen im Kopf.
- **Tab-Titel** einer Übung beginnt mit „ÜBUNG ·“.
- **Einsatzliste und Einsatzwechsler** zeigen dieselbe Marke. Der graue Tag entfällt für Übungen.
- **Gekoppeltes Gerät:** dasselbe Band unter dem Gerätekopf. Der **Lagemonitor** zeigt die Marke
  in der Statusleiste (≥ 28 px), ohne Band oben, damit die feste Kachelung bleibt.
- **Druck:** Der gemeinsame Druckkopf zeigt bei einer Übung „ÜBUNG“. In Chromium steht es
  zusätzlich am Rand jedes Blatts. Schichtplan, Lageplan und Planung reichen die Einsatzart dafür
  durch.
- **Regel** in `frontend/AGENTS.md`: Die Übung zu kennzeichnen ist Pflicht des Rahmens.
  Entschieden wird an genau einer Stelle (`isUebung`) und gezeigt mit genau einem Baustein.
- Unverändert bleiben die Namenskonvention „ÜBUNG – …“ der Demo-Daten, der Strg+P-Druck normaler
  Seiten und das Backend.

## Capabilities

### New Capabilities

- `uebungsmarke`: Wie eine Übung in Rahmen, Gerät, Liste und Wechsler erkennbar ist: Band, Marke,
  Stehenbleiben beim Rollen, eine Quelle für die Entscheidung.

### Modified Capabilities

- `seiten-orientierung`: Der Tab-Titel einer Übung beginnt mit „ÜBUNG ·“
  (Requirement „Tab-Titel nennt Seite und Einsatz“).
- `druck-dokumente`: Der gemeinsame Druckkopf nennt die Übung, in Chromium steht sie am Rand jedes
  Blatts (Requirement „Gemeinsamer Druckkopf“).

## Impact

- Nur Frontend: `theme/tokens.ts`, `theme/rollen.css` und Kontrasttests, ein neuer Baustein unter
  `components/instrument/` mit Karte im Design System (das Design System wird neu erzeugt),
  `einsatz/einsatzart.ts`, `einsatz/EinsatzLayout.tsx`, `einsatz/EinsatzSwitcher.tsx`,
  `pages/EinsaetzePage.tsx`, `geraet/GeraeteLayout.tsx`, `geraet/LagemonitorPage.tsx`,
  `components/druck/Druckkopf.tsx`, `druck/druck.css` und die Druckaufrufer Schichtplan, Lageplan
  und Planung.
- Keine API- oder Migrationsänderung: `einsatzart` steht schon als Pflichtfeld in
  `EinsatzAnzeige`, auch für gekoppelte Geräte.
- Anwenderdoku: Der Demo-Einsatz ist eine Übung, deshalb zeigen alle Bilder mit Einsatzrahmen
  künftig das Band. Das Kapitel „Einsatz-Oberfläche“ beschreibt die Marke.
