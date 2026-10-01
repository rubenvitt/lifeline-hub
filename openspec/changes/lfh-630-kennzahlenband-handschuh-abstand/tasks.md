# Tasks

Jede Aufgabe entsteht test-first (`superpowers:test-driven-development`): erst der rote
Test, dann der Code. Vorher `grep -rn 'data-lfh="kennzahl"\|lfh-kennzahl' frontend/` und die
Treffer durchsehen (design.md, Risiken).

## 1. Baustein: Einzug und Zellaufbau

- [x] 1.1 `components/instrument/Kennzahl.tsx`: reine Funktion `kennzahlZielEinzug(token)` nach design.md D2 (Literale 0 / 4 / 8 aus `controlHeight`). Verifiziert durch neue Tests in `Kennzahl.test.tsx` mit `tokenFuer(stufe)`: kompakt 0, komfortabel 4, handschuh 8, dazu `2e + 1 ≥ 8` (komfortabel) und `≥ 16` (handschuh) als Literale
- [x] 1.2 `Kennzahl.tsx`: reine Stilfunktion für die klickbare Zelle nach design.md D3 (Zelle: `padding: e`, Eskalationskante; Link: `kennzahlStil` mit `padding − e` / `paddingLG − e`, `minHeight` unverändert). `kennzahlStil` für Zellen ohne Ziel bleibt gleich. Verifiziert durch Tests: Restpolsterung + Einzug = Polsterung ohne Ziel je Stufe; Link-`minHeight` 30 / 48 / 72; Kante (`inset 3px`/`6px`) an der Zelle, nicht am Link; Bestandstests von `kennzahlStil` unverändert grün
- [x] 1.3 `Kennzahl.tsx`: Render mit `ziel` als `<div class="lfh-kennzahl" data-lfh="kennzahl-zelle">` um `<Link class="lfh-kennzahl__ziel" data-lfh="kennzahl" data-ton aria-label>`; `style` an das Element mit `kennzahlStil`; ohne `ziel` unverändert ein `div`. Dateikopf („KLICKBAR“ und „Das Band setzt …“) um Einzug und Grund (LFH-630, Bedien-Leitlinie Kriterium 2) ergänzen. Verifiziert durch Render-Tests: Link ist Kind der Zelle, trägt `href`, `data-ton`, zugänglichen Namen; Zustand `laden` mit Ziel bleibt Link; ohne Ziel kein Link und kein `kennzahl-zelle`; dazu `pnpm vitest run src/components/instrument src/pages/lage-dashboard src/pages/fuehrung src/kraefte src/verpflegung src/pages/MeldungenPage.test.tsx` grün
- [x] 1.4 `theme/sprache.css`: Hover (`flaeche-3`), Fokus (2 px `bedien`, Versatz −2 px) und `cursor` von `.lfh-kennzahl--ziel` auf `.lfh-kennzahl__ziel` (design.md D4); verwaiste Klasse `lfh-kennzahl--ziel` entfernen. Verifiziert durch `grep -rn 'lfh-kennzahl--ziel' frontend/` ohne Treffer und den Browserblick in 4.2

## 2. Nachweis Gate 3

- [x] 2.1 `e2e/gate3-trefflaeche.spec.ts`, Block „Lage-Dashboard: Kennzahl-Zellen …“: je Stufe kleinster Abstand jedes der sechs Links über `abstandZuNachbarn` (Bereich: Band), Soll-Literale `handschuh` ≥ 16, `komfortabel` ≥ 8 (abzüglich `SUBPIXEL`), `kompakt` nur annotiert; im Handschuh zusätzlich `columnGap` des Bands = `1px`. Testtitel und Annotation nennen den Abstand. Verifiziert durch den grünen Block im e2e-Lauf und eine **Mutationsprobe**: Einzug testweise 0 → Block rot (Messwert notieren), danach zurück. Gemessen: kompakt 1 px, komfortabel 9 px, handschuh 17 px; Probe Einzug 0 → rot in komfortabel (1 px), Probe Handschuh-Einzug 4 → rot (9 px)

## 3. Regel und Prüfliste

- [x] 3.1 `frontend/AGENTS.md`, Bausteinregel „Kennzahlenband“: ein Satz zum Einzug (klickbare Zelle: Trefffläche innen, Einzug 0 / 4 / 8 px je Stufe, Fuge bleibt 1 px, Verweis auf diese Change). Verifiziert durch `prettier --check frontend/AGENTS.md` (Teil von `check-all.sh`)
- [x] 3.2 `docs/superpowers/specs/2026-09-22-lfh-606-pruefliste.md`: O4 und Verdikt „2 · A“ als eingelöst durch LFH-630 vermerken (Muster „O2, eingelöst“), sonst unverändert. Verifiziert durch `grep -n 'O4' docs/superpowers/specs/2026-09-22-lfh-606-pruefliste.md`
- [x] 3.3 Nachzug für `Segmentleiste` und die Kartenknöpfe im Fugenraster (gleiche 1-px-Fuge zwischen Bedienzielen) per `clickup-task-anlegen` auf dem Entwicklungsboard anlegen. Verifiziert durch die Ticketnummer im PR-Text (angelegt: LFH-865)

## 4. Verifikation

- [ ] 4.1 `./scripts/check-all.sh` grün (Format, Lint `--max-warnings 0`, Vitest, e2e inkl. Kontrast-Specs, `lage-dashboard-schmal`, `pegel-pruefliste`, OpenSpec-Archivwächter nach `/opsx:archive`). Verifiziert durch den Exit-Code des Skripts bzw. die CI des PRs
- [x] 4.2 Im Browser gegen den Dev-Stack, Lage-Dashboard in `kompakt` und `handschuh`: Zahl, Augenbraue und Notiz stehen an derselben Stelle, Zellhöhe gleich, Fuge 1 px; in `handschuh` tönt der Hover nur die eingerückte Trefffläche. Verifiziert durch je einen Screenshot beider Stufen (Lauf gegen den e2e-Stack: Bandmaße und alle sechs Zahlpositionen in `kompakt` und `handschuh` pixelgleich zum Bestand, Hover im Handschuh tönt nur die eingerückte Trefffläche)
