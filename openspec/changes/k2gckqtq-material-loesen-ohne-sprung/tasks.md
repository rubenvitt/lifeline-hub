# Tasks

Zunder LLH-1254 (`k2gckqtq`). Jede Aufgabe entsteht per TDD. Geprüft wird mit
`mise exec -- pnpm -C frontend exec vitest run <Datei>` bzw. mit der genannten e2e-Spec.

## 1. Platzhalter nach dem Lösen

- [x] 1.1 Nach erfolgreichem Lösen bleibt die Zeile an ihrer Stelle als Platzhalter stehen: gedämpft, mit Bezeichnung und Menge, ohne Status und „Ausgeben“, und die Marke „Gelöst“ ist ein träger Knopf (`aria-disabled`, Name „Trage gelöst“) in der Breite des Lösen-Knopfs (D1, D2). Vitest in `kraefte/MaterialAmOrt.test.tsx`: Posten fällt aus `posten`, Zeile mit „Gelöst“ steht an Index 0, ein zweiter Klick schickt keinen zweiten PATCH, und die Kopfzahl zählt nur echte Posten.
- [x] 1.2 Phasen `wartet`/`weg` (D4): Solange die Quelle den Posten noch zeigt, steht trotzdem der Platzhalter. Kehrt der Posten nach `weg` zurück, gewinnt die echte Zeile. Mehrere Platzhalter behalten ihre Plätze. Vitest mit `rerender` in diesen drei Fällen.
- [x] 1.3 Halten (D3): Platzhalter fallen zusammen, sobald kein Maus- oder Stiftzeiger und kein Fokus im Baustein sind und `HALTEN_MS` seit dem letzten `pointerdown` vergangen ist. Touch-Zeiger halten nur über die Zeit, ein Wechsel von `ort` oder `einsatzId` leert. Vitest mit Fake-Timern für Zeiger drin/draußen, Fokus drin, Touch und Ortwechsel. (Mutationsproben: Zeiger, Fokus, Touch, Sortierung, Wächter am Knopf und Freigabe nach Rückgängig machen je einen Test rot. Die Marke wechselt nicht `type`: antd hängt den Knopf dann neu ein, und der Fokus fiele auf `body`.)

## 2. Rückgängig

- [x] 2.1 `onSuccess` zeigt `zeigeRueckgaengig` mit „<Bezeichnung> gelöst“. „Rückgängig“ ordnet über `setOrt(posten, ort)` wieder zu, der Platzhalter weicht der echten Zeile, und eine Ablehnung steht an der Zeile bzw. am Zuordnen-Fehler (D5). Vitest: PATCH mit dem Ort-Feld, Ablehnung sichtbar, kein Fehler-Toast. Danach `kraefte/materialSchreibweg.test.tsx` und `pages/einheit/EinheitMaterial.test.tsx` grün.

## 3. Nachweise und Doku

- [ ] 3.1 e2e in `frontend/e2e/material-am-ort.spec.ts`: Zwei schnelle Klicks (`dblclick` bzw. zwei `click` ohne Warten) auf den Lösen-Knopf der ersten von zwei Zeilen lösen nur diesen Posten (Prüfung über die API: der zweite liegt weiter am Ort), und „Gelöst“ steht an der Stelle. Der bestehende Test „Bereitstellungsraum: … lösen“ läuft angepasst auf den neuen Hinweistext weiter.
- [x] 3.2 Kapitel `docs/anwender/kapitel/einheiten.md`, Abschnitt „Material zuordnen, lösen und ausgeben“: Die gelöste Zeile bleibt kurz als „Gelöst“ stehen, „Rückgängig“ steht im Hinweis. Kurzer Verweis im Material-Absatz von `frontend/AGENTS.md`. Wächter der Anwenderdoku (`hilfe/anwenderdoku.guard.test.ts`) und Prettier grün. (Derselbe Satz auch in `unfallhilfsstellen.md`, `fahrzeuge.md` und `bereitstellungsraeume.md`: alle drei nennen `MaterialAmOrt.tsx` unter `quellen:` und beschreiben das Lösen.)
- [ ] 3.3 `./scripts/check-all.sh` (Bündel `schnell` lokal, voll in der CI des PRs) grün.

## Workflow follow-up

- `/opsx:archive k2gckqtq-material-loesen-ohne-sprung` im selben Branch vor dem PR.
- PR gegen `alpha` mit Zeile `Zunder: https://zunder.rubeen.dev/#/aufgabe/k2gckqtqj91u0dx5yv8ycxyb`.
