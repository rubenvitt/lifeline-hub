# Tasks

## 1. Reine Schleusen-Logik (`components/organigramm/baumSchleuse.ts`)

- [x] 1.1 Test zuerst in `components/organigramm/baumSchleuse.test.ts`: Bei `gehalten = null` ist `gezeigt` der frische Baum, nichts wartet. Ein neuer Knoten (auch ein Kind) zählt als `neu` und fehlt in `gezeigt`. Ein Knoten unter anderem Elternschlüssel zählt als `umgehaengt` und steht am gehaltenen Ort. Ein fehlender Schlüssel zählt als `entfallen` und steht mit letztem Inhalt und Marke in `gezeigt`, seine noch vorhandenen Kinder stehen weiter unter ihm. Geänderter Inhalt fließt, die Folge bleibt die gehaltene, auch wenn die frische umsortiert ist. Der Sammelknoten wird gehalten wie jeder Knoten. `wartendText` nennt nur Teile über 0 in fester Folge („2 neu · 1 umgehängt · 1 entfallen“), ohne Wartendes `null`. Rot sehen, dann nach D1/D3 umsetzen. `mise exec -- pnpm -C frontend vitest run src/components/organigramm/baumSchleuse.test.ts` ist grün

## 2. Schleuse im Gerüst (`components/organigramm/HaengenderBaum.tsx`)

- [x] 2.1 Test zuerst in `HaengenderBaum.test.tsx`: Ohne Zeiger und Fokus geht der frische Baum sofort durch, die Standzeile sagt „Live“. `pointerenter` (mouse) schließt: ein Zugang fehlt, der Banner nennt „1 neu“ mit `role="status"`, geänderter Inhalt kommt durch, die Standzeile sagt ohne Wartendes „Live pausiert“. `pointerenter` mit `touch` schließt nicht; die erste `pointermove` holt ein verpasstes Betreten nach. Fokus im Bereich hält, `focusout` nach außen öffnet, ein Wechsel innerhalb nicht. „anzeigen“ übernimmt den frischen Stand und lässt den Fokus auf der Standzeile. Ein entfallener Knoten steht als Text ohne Link mit „entfallen“. Der Kopf steht still, bis die Schleuse öffnet. `beforeprint` zeigt Baum und Kopf frisch. Ein leerer Baum schließt nicht. Verschwindet der fokussierte Knoten ohne `focusout`, öffnet das Sicherheitsnetz. Rot sehen, dann Bereich, Zustand, Standzeile fester Höhe (Bannertext einzeilig mit „…“), Platzhalter und Druckweiche nach D2–D5 umsetzen. Die Tests in `HaengenderBaum.test.tsx`, `Organigramm.test.tsx`, `OrganigrammOhneZeichen.test.tsx`, `FernmeldeskizzeBild.test.tsx` und `FunkplanPage`-Tests sind grün
- [x] 2.2 `haengenderBaumPrint.css`: die Standzeile im Druck aus; `haengenderBaumPrint.test.ts` um die Regel ergänzen (Test zuerst)
- [x] 2.3 Dateikopf von `HaengenderBaum.tsx` um die Schleuse ergänzen (Bereich, Bedingungen, Entfallenes bleibt, Kopf still, Druck frisch, Verweis auf die Change); Regel im Organigramm-Absatz von `frontend/AGENTS.md` nachtragen. Prettier ist grün

## 3. Browser-Nachweis (e2e)

- [x] 3.1 `e2e/fuehrungsorganisation.spec.ts` „Fokus: ein live angelegter Abschnitt springt nicht unter den fokussierten Link“: Fokus per Tastatur auf einen Namenslink, Abschnitt per `page.request` anlegen. Rechteck des Links Δ 0 px, Banner „1 neu“, der neue Abschnitt fehlt; „anzeigen“ → er steht da. Mutationsprobe: Schleuse fest offen → rot
- [x] 3.2 Ebenda „Zeiger: ein umgehängter Unterabschnitt springt nicht unter dem Zeiger“: Maus auf einen Namenslink, Unterabschnitt per API umhängen. Rechteck Δ 0 px, Banner „1 umgehängt“; Maus aus dem Bereich → am neuen Ort, kein Banner. Mutationsprobe wie 3.1. Der bestehende Live-Test (ohne Zeiger und Fokus) bleibt grün
- [x] 3.3 Ebenda „Banner verschiebt den Baum nicht“ bei 390 × 844 und 1366 × 768: Oberkante der ersten Ebene Δ 0 px beim Erscheinen und Verschwinden des Banners
- [x] 3.4 Ebenda „Druck mit wartendem Abschnitt“: wartender Abschnitt, `beforeprint` ausgelöst, Druckmedium → der Abschnitt steht im Druckbild, die Standzeile nicht
- [x] 3.5 `e2e/funkplan.spec.ts`, Skizze: Maus auf einem Namenslink, Einheit per API einem Abschnitt zuordnen → Rechteck Δ 0 px, Banner „1 umgehängt“; Maus raus → unter dem Abschnitt

## 4. Prüflisten und Abschluss

- [x] 4.1 Kriterium 12 in `openspec/changes/archive/2026-10-01-lfh-626-fuehrungsorganisation-skizze/pruefliste.md` und `…/2026-10-01-lfh-625-fernmeldeskizze/pruefliste.md` auf **erfüllt** mit Testnamen, Zielticket räumen, Bilanz nachziehen. In `…/2026-10-04-lfh-848-kommunikationsplan/pruefliste.md` beide Tabellen (Datensicht-Bäume) auf das Folgeticket LFH-1020 (D6) umschreiben
- [ ] 4.2 `./scripts/check-all.sh` ist grün (lokal oder belegt durch die CI des PRs); Vitest der berührten Dateien und die e2e-Specs `fuehrungsorganisation`, `funkplan`, `gate1-ueberlauf`, `gate3-trefflaeche` grün
