# Tasks

## 1. Raster im Theme

- [x] 1.1 Test zuerst: `theme/tokens.test.ts` erwartet das Raster aus design.md D1 (alle drei Stufen, `xxs`/`xl` neu) und die Spec-Eigenschaften (Vielfache von 4, Folge fällt nicht, keine Stufe in `komfortabel`/`handschuh` unter `kompakt`, `handschuh.sm` ≥ 16). Danach `Abstandsraster` und `dichten` in `theme/tokens.ts` umstellen, die Kommentare zur Herkunft aus A1 berichtigen und den Test grün sehen.
- [x] 1.2 `antdToken()` bildet alle Abstandstoken nach D2 ab, auch XXS, MD und XL. Ein Test in `tokens.test.ts` prüft, dass jeder `padding*`/`margin*`-Schlüssel von XXS bis XL im Token steht und in `handschuh` mindestens so groß ist wie in `kompakt`.
- [x] 1.3 `theme/rollen.css` spiegelt das Raster als `--lfh-luft-*` je `[data-dichte]`, einschließlich der neuen Stufen. `rollen.guard.test.ts` prüft die Deckungsgleichheit und ist grün.
- [x] 1.4 Den Export `abstand` entfernen. Die 8 Importeure (`etb/EtbFilterleiste`, `etb/WiedervorlageModal`, `kraefte/EntlassenBlock`, `pages/FahrzeugePage`, `pages/PersonalPage`, `pages/EinsaetzePage`, `pages/bereitstellungsraum/BrVerlauf`, `BrDetailPage`) stellen nach D3 auf das Token der aktiven Dichte um. Belegt durch `tsc` ohne Fehler und die Komponententests der Dateien.

## 2. Pins und bestehende Wächter nachziehen

- [x] 2.1 Die Wächter mit Stufenwerten laufen lassen (`aktionsabstand`, `aktionenSpace`, `dichte`, `kopfpolsterung`, `seitenrinne`, `rahmenOben`, `katalogTabelle`, `leistenAbstand`, `dichteQuelle`). Wo sie Zahlen statt Stufen pinnen, wird der Wert berichtigt, nicht die Prüfung gelockert. Erledigt, wenn `vitest run` für `src/theme` und `src/components` grün ist.
- [x] 2.2 Die e2e-Pins in `e2e/dialogfuss-dichte.spec.ts` (`titel`, `fuge`) und `e2e/katalogtabelle-kopf-dichte.spec.ts` auf die neuen Werte ziehen. Belegt durch einen Lauf genau dieser Specs gegen den lokal gebauten Stand. Erledigt: beide Specs liefen im e2e-Lauf vom 16.11.2026 grün.
- [x] 2.3 In `node_modules/antd` prüfen, ob `Space`, `Flex` oder `Form` einen Abstand aus `size*`-Tokens statt aus `padding*`/`margin*` lesen. Falls ja, die betroffenen `size*`-Tokens in `antdToken()` mit abbilden und einen Test ergänzen. Falls nein, das Ergebnis als Kommentar an `antdToken()` festhalten.

## 3. Wächter gegen neue Literale

- [x] 3.1 Test zuerst: `theme/abstandsraster.guard.test.ts` mit einer reinen Funktion `befunde(dateien, schuld, ausnahmen)`. Unit-Tests an Texten decken die Fälle aus D4 ab: Stilobjekt, px-String, `Space size`, `gap=`, `gutter`, CSS, Feinsatz ≤ 2 frei, Kommentar frei, Schuld überschritten, Schuld unterschritten, Ausnahme und `rollen.css` frei.
- [x] 3.2 Den Baum einlesen (`node:fs`, ohne Testdateien), die Schuld je Datei als `SCHULD` erfassen und `AUSNAHMEN` mit Grund eintragen (Lagemonitor, `hilfe/Hilfe.css`, `pages/LoginPage.css`, `druck/**`). Den Dateikopf mit Spec, bekannten Grenzen und Abbaubedingung schreiben. Der Wächter ist gegen den Baum grün.
- [x] 3.3 Mutationsprobe: ein Literal `padding: 8` in eine schuldfreie Datei setzen und einen Schuldwert um eins senken, beides färbt den Wächter rot. Danach zurücksetzen und das Ergebnis im PR unter „Geprüft“ nennen.

## 4. Erster Migrationsschnitt

- [x] 4.1 Die Literale unter `components/instrument/` nach D5 auf Token oder Rasterstufen stellen und die Schuld senken. Die Komponententests von `instrument/` sind grün.
- [x] 4.2 Die Literale in `components/*.tsx` (ohne Unterordner) genauso umstellen und die Schuld senken. Die betroffenen Komponententests sind grün.
- [x] 4.3 Die rund 20 Stellen `paddingTop: 80` auf `flaeche.zustandOben` stellen und die Schuld senken. `rg "paddingTop: 80"` findet danach nichts mehr.
- [x] 4.4 Die px-Abstände in `theme/sprache.css` und `pages/EinsaetzePage.css` auf `var(--lfh-luft-*)` stellen und die Schuld senken. Der Wächter ist grün.

## 5. Regel, Design System, ADR

- [x] 5.1 `frontend/AGENTS.md`, Gestaltungssprache: Spiegelstrich „Abstandsraster“ nach D6, die Zahlen unter „Aktionen“ nachziehen. `prettier --check` ist grün.
- [x] 5.2 `ABSTAND_ANTD` im Generator nach D2 anpassen, `mise exec -- pnpm -C frontend design-system` laufen lassen und das Erzeugte committen. `designSystem.guard.test.ts` ist grün.
- [x] 5.3 ADR „Abstände kommen aus einem Raster je Dichte auf Vielfachen von 4“ nach `docs/architektur/entscheidungen/VORLAGE.md` anlegen: nächste freie Nummer nach `git fetch origin alpha`, `herleitung` auf das Archiv-`design.md` dieser Change, Prüfung mit `verbiete` gegen den Export `abstand`. `scripts/check-adr-nummern.sh` und der ADR-Wächter sind grün.

## 6. Integration

- [x] 6.1 `./scripts/check-all.sh --geaendert --ohne-e2e` ist grün, dazu die e2e-Specs aus 2.2. Bilder der geänderten Bausteine (Nacht und Tag, `kompakt` und `handschuh`) liegen für den PR vor. Erledigt: Der Gate-Lauf lief nach zwei Neustarts des Containers geteilt: `--nur schnell` grün, die Frontend-Suite in vier Teilen grün (20 794 Tests). Die e2e-Specs aus 2.2 sind grün. Bilder: vorher/nachher hell in `kompakt` und `handschuh`, dazu nachher Nacht.
- [x] 6.2 Folgeaufgaben über `zunder-task-anlegen` anlegen und im PR verlinken: Seiten-Literale je Bereich (LLH-1937) und Anwenderdoku-Bilder (LLH-1938). Hilfe und Login sind feste Ausnahmen des Wächters (Spec „Feste Ausnahmen mit Grund“), eine eigene Folgeaufgabe brauchen sie nicht.

## Workflow follow-up

- Review vor dem PR über den ganzen Branch (Orchestrator, Phase 4).
- `/opsx:archive m113c8ln-abstandsraster` vor dem PR im selben Branch.
- Nach dem Merge das Design System neu veröffentlichen (`frontend/AGENTS.md`, „Größere UI-Entwürfe“).
