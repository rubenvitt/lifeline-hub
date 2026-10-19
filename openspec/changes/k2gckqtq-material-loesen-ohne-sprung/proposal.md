# Proposal

## Why

Nach „Lösen“ im Baustein Material am Ort (`kraefte/MaterialAmOrt.tsx`) verschwindet die Zeile, und
der Lösen-Knopf der nächsten Zeile rückt unter Finger oder Zeiger. Ein schneller zweiter Tipp löst
dann den falschen Posten, ohne Rückfrage. Die Prüfliste LLH-1225 (Teil II, Kriterium 12: kein Sprung
unter dem Cursor) ist damit nur teilweise erfüllt. Der Fehler trifft jeden Ort, weil UHS-Reiter,
Einheit, Fahrzeug und Bereitstellungsraum denselben Baustein zeigen (Zunder LLH-1254).

## What Changes

- Ein selbst gelöster Posten verschwindet nicht sofort. Seine Zeile bleibt an ihrer Stelle in
  gleicher Höhe stehen, gedämpft mit der Marke „Gelöst“. Die Marke steht dort, wo der Lösen-Knopf
  stand, und ist mindestens so breit wie er. Ein zweiter Tipp auf dieselbe Stelle bewirkt nichts.
- Die Zeile fällt erst weg, wenn Zeiger und Fokus den Baustein verlassen haben und seit dem letzten
  Tipp darin einige Sekunden vergangen sind. Erst dann rücken die Zeilen nach.
- Statt der Erfolgsmeldung „… gelöst“ steht der Rückgängig-Hinweis des Hauses
  (`kommunikation/rueckgaengig.tsx`). „Rückgängig“ ordnet den Posten über den einen Schreibweg
  wieder diesem Ort zu.
- Ein e2e-Test belegt: zwei schnelle Klicks auf dieselbe Stelle lösen nur einen Posten.
- Die Anwenderdoku (Kapitel Einheiten) beschreibt das Verhalten.

## Capabilities

### New Capabilities

Keine.

### Modified Capabilities

- `material-am-ort`: Die Anforderung „Material am Ort lösen“ verlangt zusätzlich, dass die gelöste
  Zeile an ihrer Stelle stehen bleibt, bis die Bedienung den Baustein verlassen hat. Außerdem
  bietet sie einen Rückgängig-Weg.

## Impact

- Frontend: `kraefte/MaterialAmOrt.tsx` (Zeilen, Platzhalter, Halten), `kraefte/MaterialAmOrt.test.tsx`,
  `frontend/e2e/material-am-ort.spec.ts`. Alle Aufrufer bekommen das Verhalten ohne Änderung:
  `pages/uhs/MaterialTab.tsx`, `pages/einheit/EinheitMaterial.tsx`, `pages/FahrzeugePage.tsx`,
  `pages/bereitstellungsraum/BrDetailPage.tsx`.
- Kein Backend, keine API, keine Migration. Der Rückweg nutzt den bestehenden PATCH der Disposition.
- Doku: `docs/anwender/kapitel/einheiten.md` (Abschnitt „Material zuordnen, lösen und ausgeben“).
