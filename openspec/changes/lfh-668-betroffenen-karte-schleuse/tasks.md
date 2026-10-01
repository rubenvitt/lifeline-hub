# Tasks

## 1. Reine Schleusen-Logik (`personen/kartenSchleuse.ts`)

- [x] 1.1 Test zuerst in `personen/kartenSchleuse.test.ts`: Bei `gehalten = null` ist `gezeigt` der frische Stand (dasselbe Array), nichts wartet. Ein Zugang zählt als `neu` und fehlt in `gezeigt`. Eine andere Koordinate zählt als `verlegt`, und `gezeigt` behält die gehaltene Lage. Ein Wegfall zählt als `entfallen` und steht mit letztem Inhalt in `gezeigt`. Eine Sichtungsänderung fließt (Farbe, Kurzzeichen, Beschriftung frisch, Lage gehalten), und die Folge bleibt die gehaltene, auch wenn die frische umsortiert ist. Rot sehen, dann `schleuse(…)` nach D1/D3 umsetzen. `mise exec -- pnpm -C frontend vitest run src/personen/kartenSchleuse.test.ts` ist grün
- [x] 1.2 Test zuerst in `BetroffeneKarte.test.ts` bzw. am Fundort von `ohneKoordinateText`: Mit `anzahl 0`, `verortet > 0` und `wartendNeu > 0` lautet der Text „Keine Person ohne Koordinate“, ohne wartende Zugänge bleibt der bisherige Wortlaut (D6). Umsetzen, der Test ist grün

## 2. Spider bei reiner Inhaltsänderung (`pages/lagekarte`)

- [x] 2.1 Test zuerst: `nurInhaltGeaendert(alt, neu)` ist `true` bei gleichen Schlüsseln in gleicher Folge und gleichen Koordinaten mit anderen Eigenschaften, `false` bei Zugang, Wegfall, anderer Folge oder anderer Koordinate. `aktualisiereSpiderBlaetter(blaetter, neu)` behält die Geometrie jedes Blatts und übernimmt die Eigenschaften des neuen Features gleichen Schlüssels, ein Blatt ohne Gegenstück behält seine. Beides rein in `spiderfy.ts` (oder `markerLayer.ts`) umsetzen, die Tests sind grün
- [x] 2.2 `Kartenflaeche.tsx`: Im Marker-Effekt bei offenem Spider und `nurInhaltGeaendert` nicht zuklappen, sondern die Blätter per `aktualisiereSpiderBlaetter` neu schreiben. Im `render`-Abgleich die Hülle eines neu gebauten Donuts sofort durchlässig setzen, wenn seine Kennung die des offenen Spiders ist. Neue optionale Prop `onSpiderOffen(offen)` beim Öffnen (nach `setzeSpiderDaten`) und beim Zuklappen (nur wenn offen war) melden. `mise exec -- pnpm -C frontend tsc -b` und die bestehenden Tests unter `src/pages/lagekarte/` sind grün
- [x] 2.3 Regel in `frontend/src/pages/lagekarte/AGENTS.md` ergänzen: Der Spider überlebt eine reine Inhaltsänderung, mit Verweis auf diese Change (nach dem Archivieren auf den Archivpfad). `mise exec -- pnpm -C frontend prettier --check AGENTS.md` (im Frontend) ist grün

## 3. Schleuse in der Betroffenen-Karte (`personen/BetroffeneKarte.tsx`)

- [x] 3.1 Test zuerst (gemockte `Kartenflaeche`, die `markers` und `onSpiderOffen` offenlegt): Ohne Zeiger, Fokus und Spider gehen frische Marker sofort durch, und die Standzeile sagt „Live“, bei geschlossener Schleuse ohne Wartendes „Live pausiert“. `pointerenter` (mouse) schließt die Schleuse: Ein Zugang erscheint nicht in `markers`, der Banner nennt „1 neu“ mit `role="status"`, eine Sichtungsänderung kommt durch. `pointerenter` mit `pointerType touch` schließt nicht. `onSpiderOffen(true)` schließt auch ohne Zeiger. „anzeigen“ übernimmt den frischen Stand, und der Banner verschwindet. `pointerleave` ohne Spider öffnet. Fokus im Bereich hält, `focusout` nach außen öffnet. Rot sehen, dann Bereich, State `gehalten`, Standzeile fester Höhe und Sammelbanner nach D2/D4 umsetzen, die Tests und `PersonenPage.test.tsx` sind grün
- [x] 3.2 Den Dateikopf von `BetroffeneKarte.tsx` um die Schleuse ergänzen (Bereich, drei Bedingungen, Entfallene bleiben, Verweis auf die Change) und die Regel in `frontend/src/personen/AGENTS.md` eintragen. Prettier ist grün

## 4. Browser-Nachweis (e2e)

- [ ] 4.1 e2e „Karte: ein Live-Zugang neben dem Marker unter dem Zeiger verschmilzt nicht“: Person A verortet, Maus auf A, Person B per `page.request` wenige Meter daneben verorten. Am Zeiger steht weiter A als Einzelmarker (kein `cluster-treffer` am Punkt), der Banner nennt „1 neu“, ein Klick öffnet A. Nach dem Verlassen steht ein Donut. Mutationsprobe: Schleuse fest offen, der Test wird rot, dann zurücksetzen
- [ ] 4.2 e2e „Karte: ein aufgefächertes Bündel bleibt bei einer Sichtungsänderung offen“: zwei nahe Personen, Bündel auffächern, die Sichtung eines Blatts per `page.request` ändern. Die Spider-Blätter bleiben, das Blatt zeigt das neue Kurzzeichen, ein Tipp darauf öffnet die Person. Mutationsprobe ohne D5 (immer zuklappen) rot, dann zurücksetzen
- [ ] 4.3 e2e Layout: Der Banner erscheint und verschwindet bei 390 × 844 und 1366 × 768. Die Oberkante der Karte bleibt gleich (Δ 0 px), und der CLS-Beitrag nach dem Live-Ereignis ist 0 (Muster `e2e/betroffene-layout.spec.ts`). Die bestehenden Tests in `betroffene-layout.spec.ts`, `betroffene-karte.spec.ts`, `gate3-trefflaeche.spec.ts` (Betroffene Karte) und `fokus-verdeckung.spec.ts` (Personenkarte) bleiben grün

## 5. Prüfliste und Abschluss

- [ ] 5.1 `docs/superpowers/specs/2026-09-22-lfh-613-pruefliste.md`, Tabelle 4, Nr. 12: Teil (b) mit Entscheidung, Messwerten und Testnamen nachtragen, Verdikt nach Beleg (Rest Touch ohne Auffächerung benennen), Zielticket räumen, die Verdikt-Bilanz der Tabelle nachziehen
- [ ] 5.2 `./scripts/check-all.sh` ist grün (lokal oder belegt durch die CI des PRs)
