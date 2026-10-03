## Why

Auf der Lagekarte gibt es kein Kontextmenü, weder per Rechtsklick noch per langem Druck. Wer am
Führungs-Tablet (Primärkontext, oft mit Handschuh, Bedien-Leitlinie LFH-327) „hier“ etwas tun
will — eine Koordinate durchgeben, ein Zeichen setzen, eine Strecke messen —, muss erst in die
Leiste, dort den Weg suchen und dann zurück auf die Karte tippen. Seit maplibre-gl 6.11 (auf
`alpha` seit PR rubenvitt/lifeline-hub#198) meldet die Karte einen langen Druck selbst als
`contextmenu`. Damit kann ein Kontextmenü mit einem einzigen Ereignis für Maus und Touch entstehen.

## What Changes

- Neues **Kontextmenü an der Kartenstelle**: Rechtsklick (Fükw) und langer Druck (Tablet, 500 ms,
  ein Finger, ohne Bewegung) öffnen es am Druckpunkt. Ausgelöst wird beides über das
  maplibre-Ereignis `contextmenu`.
- Einträge im ersten Schnitt (entschieden am Scope-Checkpoint, 03.10.2026):
  - **„Koordinate kopieren“**: kopiert die Druckstelle im aktiven Koordinatensystem und zeigt
    sie im Eintrag schon an. Nur lesend, also auch ohne Schreibrecht und im Snapshot.
  - **„Messen ab hier“**: startet das Messwerkzeug (Strecke) mit der Druckstelle als erstem
    Punkt. Nur lesend.
  - **„Hier Zeichen setzen“**: öffnet die Zeichenwahl in einem Dialog, „Setzen“ legt das gewählte
    Zeichen an der Druckstelle an. Nur mit Schreibrecht.
- Das Menü öffnet nur auf freier Karte oder auf einer Fläche, **nicht** auf einem Punktziel oder
  einer Trefferzone (Marker, Personen-Cluster, Fachebenen-Punkt). Es öffnet auch nicht in einem
  exklusiven Kartenmodus (Zeichnen, Messen, Platzieren, Bild).
- Der lange Druck kippt und verschiebt die Karte nicht (`touchPitch: false`, `maxPitch: 0`
  bleiben). Das Loslassen des Fingers schließt das Menü nicht und löst keinen Tipp auf die Karte
  aus.
- Das Menü-Bauteil des Flächen-Auswahlmenüs (LFH-812) wird zu einem geteilten Punktanker-Menü:
  ein Bauteil, zwei Menüs.
- Nicht im Schnitt: „Einsatzort/Abschnitt hier anlegen“ (Abschnitte sind Flächen, „hier“ trägt
  keinen Sinn; Einsatzort nicht gewählt) und das Öffnen per Tastatur (Kontextmenü-Taste,
  Shift+F10).

## Capabilities

### New Capabilities

- `lagekarte-kontextmenue`: Kontextmenü an einer Stelle der Lagekarte. Regelt die Auslöser
  (Rechtsklick, langer Druck), wann es öffnet und wann nicht, die Einträge samt Rechten, die
  Bedienung (Trefferhöhe, Tastatur im offenen Menü, Fokus, Schließen) und die Wirkung jedes
  Eintrags.

### Modified Capabilities

(keine — die Rangfolge der Klickziele in `lagekarte-klickziele` gilt unverändert; das
Kontextmenü stützt sich auf sie, ändert sie aber nicht)

## Impact

- Frontend, nur `frontend/src/pages/lagekarte/` und `pages/LagekartePage.tsx`:
  - `Kartenflaeche.tsx`: `contextmenu`-Hörer, Riegel gegen den Nachklick, Menü-Zustand und
    Startpunkt fürs Messen
  - `FlaechenwahlMenue.tsx`: Schale herausgelöst
  - neues Kontextmenü-Bauteil, reine Ableitung der Einträge
  - `messZeichnung.ts`: Startpunkt
  - `useKartenInteraktion.ts`: Zeichen an einem Punkt anlegen
  - Dialog „Zeichen hier setzen“
- e2e: `frontend/e2e/lagekarte-touch.spec.ts` (langer Druck per CDP) und ein Mausfall.
- Regeln: eine Zeile in `frontend/src/pages/lagekarte/AGENTS.md`. Neue Spec
  `openspec/specs/lagekarte-kontextmenue/`.
- Kein Backend, keine API, keine Migration, keine neue Abhängigkeit.
