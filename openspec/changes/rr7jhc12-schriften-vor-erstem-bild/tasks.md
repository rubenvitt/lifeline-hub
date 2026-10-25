# Tasks

## 1. Wartefunktion in `theme/schriften.ts`

- [ ] 1.1 `SCHRIFTSCHNITTE` kennzeichnet je Eintrag die Bildschirm-Schnitte (Archivo 400/500/600, Archivo Narrow 600, JetBrains Mono 400/500), D2; Test in `theme/schriften.test.ts`: genau diese sechs sind gekennzeichnet (rot, bevor die Kennzeichnung existiert)
- [ ] 1.2 `registerSchriften` lädt die Bildschirm-Schnitte sofort und gibt ein Promise zurück, das sich nach ihnen oder nach der Frist (Konstante 300 ms, D4) erfüllt; ein gescheiterter Schnitt zählt als fertig; Uhr injizierbar. Tests mit gestubbtem `FontFace` und Fake-Timern: erfüllt sich nach den sechs Ladevorgängen, erfüllt sich bei hängendem Schnitt genau nach 300 ms und nicht davor, erfüllt sich bei einem abgelehnten Schnitt sofort; der bestehende Test „lädt alle, sobald der Browser Luft hat“ bleibt grün
- [ ] 1.3 Dateikopf von `schriften.ts` nennt die Frist und LLH-1272 neben der `swap`-Abwägung aus LFH-352; prüfen mit `pnpm exec eslint` und `prettier --check` auf der Datei

## 2. Rendern nach den Schriften (`main.tsx`)

- [ ] 2.1 `main.tsx` rendert erst im `then` von `registerSchriften()` (D1), Service-Worker-Registrierung und `QueryClient` bleiben davor; prüfen mit `tsc --noEmit` (über `scripts/check-typ-codegen.sh` bzw. Typecheck) und einem Start im Browser (die App erscheint)

## 3. Nachweis im Browser (`e2e/rahmen-cls-dichte.spec.ts`)

- [ ] 3.1 Neuer Fall „Schriften kommen verzögert“: Init-Skript notiert beim ersten Knoten in `#root` `document.fonts.check` für die sechs Bildschirm-Schnitte, Schriftabrufe per `page.route` um 150 ms verzögert, Erwartung alle geladen (D5); Mutationsprobe: ohne das Warten in `main.tsx` rot
- [ ] 3.2 Neuer Fall „Schriften kommen nicht“: Schriftabrufe hängen, Erwartung die App rendert (Seitenkopf sichtbar) und das erste Bild entsteht ohne Schrift
- [ ] 3.3 Dateikopf des Specs nennt die zweite Ursache (Schriftwechsel, CI-Befund 0,58–0,60) neben der ersten; die Kantenfälle laufen lokal grün, Nachweis in der CI-Ausführung von PR #1006 (e2e-Anteil mit `rahmen-cls-dichte`)

## 4. Mitziehen

- [ ] 4.1 Design System neu erzeugen (`mise exec -- pnpm -C frontend design-system`, `frontend/AGENTS.md`), Erzeugtes mitcommitten oder festhalten, dass sich nichts ändert; Wächter `designSystem.guard.test.ts` grün
- [ ] 4.2 `./scripts/check-all.sh --nur schnell` grün bis auf bekannte Fremdbefunde (Advisories), Vitest für `theme/` grün

## Workflow follow-up

- `/opsx:archive rr7jhc12-schriften-vor-erstem-bild` im selben Branch vor dem Merge, Spec-Sync nach `openspec/specs/einsatztauglichkeit-layout/spec.md`
- PR #1006 aktualisieren (Beschreibung um die zweite Ursache ergänzen), Board-Status von `blocked` zurück auf `review`
