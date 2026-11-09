# Tasks

Zunder: https://zunder.rubeen.dev/#/aufgabe/amp1au76496lxigr9gaux4rn (LLH-1601)

## 1. Einträge im Kern (D1)

- [x] 1.1 `abschnittEintraege` und `gliederungEintraege` in `entwurf/dokumentEntwurfKern.ts` per
  TDD: Reihenfolge, „Text kopieren“ gesperrt bei leer oder ohne Zwischenablage, „In der
  Lesefassung zeigen“ fehlt in der Lesefassung, „Abschnitt leeren“ als Gefahr; belegt durch
  `dokumentEntwurfKern.test.ts`

## 2. ⋮ im Abschnittskopf mit Kopieren, Lesefassung, Leeren (D2, D4, D5, D6, D7)

- [x] 2.1 Feldhülle `AbschnittFeld` mit Ref-Durchreichung und Leeren-Tabelle; Test in
  `DokumentEntwurf.test.tsx`: Sprung fokussiert weiter das Feld, `Einstiegsfokus.test.tsx` grün
- [x] 2.2 ⋮ „Aktionen zu Abschnitt <Name>“ im Kopf (`MenueAusloeser`, nicht im Druck); Test:
  Einträge, Trenner, Gefahr rot, Fokus im Menü
- [x] 2.3 „Text kopieren“ mit Meldung; Test mit gestellter Zwischenablage (Erfolg, Fehlschlag,
  gesperrt bei leer und ohne `navigator.clipboard`)
- [x] 2.4 „In der Lesefassung zeigen“: Ansicht, Rollen, Fokus auf dem Abschnitt der Lesefassung;
  Test prüft `scrollIntoView` am Ziel und `document.activeElement`
- [x] 2.5 „Abschnitt leeren“ mit `<Modal>`-Rückfrage; Test: Abbrechen lässt den Text, Bestätigen
  leert, Leer-Marke und Füllstand folgen, `onValuesChange` des `<Form>` feuert mit `{schluessel: ''}`
- [x] 2.6 Render-Zähler-Gate erweitern: Seite rendert neu mit ⋮ im Kopf, kein Abschnitt läuft mit;
  Tippen rendert nur den kippenden Abschnitt

## 3. Kontextmenü an Gliederung und Kopf (D3)

- [x] 3.1 Ein `useKontextMenue` im Baustein, Handler am Gliederungseintrag und an der Kopfhülle,
  ein `KontextMenue`; Test: Rechtsklick in der Gliederung zeigt „Zum Abschnitt springen“ und die
  Abschnittseinträge, am Kopf die Einträge des ⋮, im Textfeld kein eigenes Menü
- [x] 3.2 Wahl im Kontextmenü führt dieselbe Aktion aus wie das ⋮ (Springen, Kopieren,
  Lesefassung, Leeren mit Rückfrage); Umschalt+F10 auf dem Gliederungseintrag öffnet, Escape gibt
  den Fokus zurück; Test in `DokumentEntwurf.test.tsx`
- [x] 3.3 In der Lesefassung: Kontextmenü der Gliederung ohne „In der Lesefassung zeigen“,
  „Zum Abschnitt springen“ rollt zur Lesefassung; Test

## 4. Seiten, Regeln, Doku, Browser

- [x] 4.1 Lagebericht: Leeren eines übernommenen Abschnitts verwirft den Stand der Übernahme, der
  Verlustschutz merkt die Änderung; Test an `LageberichtDetailPage` (bestehende Testdatei) oder
  e2e
- [x] 4.2 e2e im Browser (`frontend/e2e/`): Rechtsklick auf einen Gliederungseintrag im
  Lagebericht-Entwurf, „Abschnitt leeren“ bestätigen, Feld leer und Rückfrage beim Verlassen;
  Befehl: ⋮ im Kopf öffnet dieselben Einträge
- [x] 4.3 Regel in `frontend/src/entwurf/AGENTS.md` („Gegliederte Dokumente“) um ⋮ und
  Kontextmenü ergänzen (eine Quelle im Kern, Leeren über das Feld); Prettier grün
- [x] 4.4 Anwenderkapitel `docs/anwender/kapitel/lageberichte.md` und `auftraege-befehle.md`
  um das Menü des Abschnitts ergänzen (Mitänderungsregel); Wächter der Anwenderdoku grün
- [ ] 4.5 `./scripts/check-all.sh` (Bündel des Frontends) grün; Lint, Typen, Vitest

## Workflow follow-up

- Code-Review (`superpowers:requesting-code-review`), Bilder der Änderung für PR und Meldung.
- `/opsx:archive amp1au76-gliederung-kontextmenue` im selben Branch vor dem PR, dann PR gegen
  `alpha`.
