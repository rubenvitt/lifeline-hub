## 1. Rückfrage-Guard (D5)

- [x] 1.1 Test zuerst: `components/rueckfrage.guard.test.ts` mit Popconfirm-Scanner (Kopfende per Klammertiefe), Schuldliste der Altstellen, tote-Ausnahme-Prüfung, Selbstbeweise (kein `okText`, „Ja“, `okText={'OK'}`, Pfeil im Kopf, benannter Text grün). Rot auf `EtbPage`, `UhsDetailPage`, `BrDetailPage`.

## 2. UHS und BR (D4)

- [x] 2.1 Tests zuerst: `UhsDetailPage.test.tsx` und `BrDetailPage.test.tsx` prüfen die Bestätigungsknöpfe „Unfallhilfsstelle auflösen“, „Unfallhilfsstelle stornieren“, „BR auflösen“, „BR stornieren“, je im passenden Zustand (geplant, aktiv).
- [x] 2.2 `okText` an den vier Rückfragen; BR-Kopf `<Space wrap size="middle">`; `pages/bereitstellungsraum/BrDetailPage.tsx` in `MIT_NACHBARSCHAFT`. Mutationsprobe: ohne `size="middle"` wird der Abstands-Guard rot.
- [x] 2.3 Weitere Detail-Köpfe mit `<Button danger>` sichten (`rg "Button danger" frontend/src/pages`) und Befund im Guard-Kommentar oder als Folgeticket festhalten. Befund: nur `pages/lagekarte/ZonenInspector.tsx` (senkrechte Reihe mit „Zone aufheben“ ohne `size="middle"`), im Folgeticket LFH-1090.

## 3. Einsatzabschluss auf den Einsatzdaten (D1, D2)

- [x] 3.1 Tests zuerst: `EinsatzdatenPage.test.tsx` – Abschnitt „Einsatzabschluss“ nur für die Einsatzleitung eines aktiven Einsatzes, fehlt für Führungspersonal, Beobachter und einen abgeschlossenen Einsatz; Rückfrage mit „Einsatz endgültig abschließen“ schließt erst nach Bestätigung ab.
- [x] 3.2 Paneel, Mutation und Rückfrage in `pages/EinsatzdatenPage.tsx`.

## 4. ETB ohne Abschluss (D3)

- [x] 4.1 Tests zuerst: `EtbPage.abschliessen.test.tsx` umschreiben (kein „Einsatz abschließen“ im Kopf, auch nicht für die Einsatzleitung), `EtbPage.test.tsx` (Menü „Weitere“ ohne Abschluss).
- [x] 4.2 Kopf-Popconfirm, Menüeintrag, Modal und Mutation aus `pages/EtbPage.tsx` entfernen.

## 5. e2e

- [x] 5.1 Layout-Gate `e2e/einsatzabschluss.spec.ts`: bei 390, 820, 1180, 1440 kein „Einsatz abschließen“ im ETB (Kopf und Menü), auf den Einsatzdaten als Wort sichtbar, innerhalb der Seite, ohne waagerechten Überhang; als Führungspersonal über `e2e/rollen-kern.ts` (schreibt, leitet nicht) fehlt der Abschnitt. Der Abschluss selbst einmal über die Rückfrage.

## 6. Regel und Abschluss

- [x] 6.1 `frontend/AGENTS.md`, „Destruktiv ist nicht gleich destruktiv“: Unumkehrbares für den ganzen Einsatz nicht im Kopf oder Menü einer Arbeitsseite; Verweis auf den Rückfrage-Guard bei „Knöpfe nennen die Handlung“.
- [x] 6.2 Folgeticket für die Schuldliste anlegen (`clickup-task-anlegen`): LFH-1090.
- [x] 6.3 Lint, Typecheck, Vitest der berührten Dateien, Mutationsproben, `./scripts/check-all.sh --nur schnell`, e2e der berührten Specs.
