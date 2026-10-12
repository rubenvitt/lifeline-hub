# Tasks

## 1. Stab-Marken im Modulmenü

- [ ] 1.1 `Sprungmarke.schlagworte` ergänzen und die vier Bestandsmarken mit Schlagworten versehen (D5); `sprungmarken.test.ts` pinnt die Felder; Vitest grün
- [ ] 1.2 Test zuerst (rot): `sprungmarken.test.ts` erwartet hinter `stab` die Kette Pressearbeit, Informationstelefon, Funkplan, Fernmeldeskizze, Kommunikationsplan (`navZeilen` über die Registry-Kategorie `fuehrung`), Pfade gleich `unterseitenFuer('s5'|'s6')` bzw. `funkplanPfad(id, { ansicht: 'skizze' })`, und jede Stab-Unterseite hat genau eine Marke gleichen Namens (D2); dann die Marken aus `stab/unterseiten.ts` ableiten (D1/D2); Vitest grün
- [ ] 1.3 `ModulPanel.test.tsx`/`ModulAkkordeon.test.tsx`: Stab sichtbar → fünf Marken hinter „Stab“ mit Ziel im zugänglichen Namen, ohne `aria-current`; Stab gesperrt → Marken gesperrt mit Schloss, Klick springt nicht; Stab ausgeblendet → keine Marke (D3); Vitest grün
- [ ] 1.4 Regeln: LFH-620-Absatz in `frontend/AGENTS.md` und Einstiegsangaben in `frontend/src/stab/AGENTS.md` nachziehen (D8); `prettier --check` über `frontend/` grün

## 2. Ansichten in der Sprungpalette

- [ ] 2.1 Test zuerst (rot) in `befehle.test.ts`: Gruppe `ansichten` mit allen freien Marken (Id `ansicht:<key>`, Kontext und Icon des Zielmoduls, `sprungZu`-Ziel = Markenpfad), keine Zeile bei gesperrtem oder ausgeblendetem Zielmodul, `oeffnung` reicht bis `navigate` (bestehender Guard); dann Gruppe in `typen.ts` (`GRUPPEN_REIHENFOLGE` hinter `module`, `GRUPPEN_LABEL` „Ansichten“, `GRUPPE_MERKBAR` true) und Schleife in `baueBefehle` (D4); `typen.test.ts` und Vitest grün
- [ ] 2.2 Rangtest: „Funk“ → erster Treffer „Funkplan“, „bürgertelefon“ → „Informationstelefon“, „entscheid“ → „Entscheidungen“ (`CommandPalette.test.tsx` bzw. `fuzzy.test.ts`); Strg/⌘+↵ auf „Funkplan“ öffnet im neuen Tab (`CommandPalette.oeffnung.test.tsx`); Startansicht: „Ansichten“ unter „Module“, gemerkte Marke fehlt dort (`kernId`); Vitest grün
- [ ] 2.3 e2e `command-palette.spec.ts`: „Funk“ tippen, ↵ → Funkplan-Seite (Chromium) grün
- [ ] 2.4 Regeln: Abschnitt „Ansichten“ in `frontend/src/command-palette/AGENTS.md` (D8); `prettier --check` grün

## 3. Schnellaktion „Anruf erfassen“

- [ ] 3.1 Guard zuerst (rot): `schnellaktionen.guard.test.ts` ordnet Stab-Unterseiten-Dateien `stab` zu und verlangt bei Zielen unter `…/stab/<unterseite>` einen Leser in genau dieser Datei (D7), Selbstbeweis mit synthetischem Fall; dann `infotelefonPfad` um `neu` erweitern und die Zeile ans Ende von `SCHNELLAKTIONEN` (D6); Pins in `befehle.test.ts`/`befehle.modulstatus.test.ts` nachziehen
- [ ] 3.2 `InfotelefonPage.test.tsx` (rot): `?neu=1` fokussiert „Anliegen“ der Erfassung, sobald die Stab-Freigabe frei ist, und räumt den Parameter; ohne Freigabe kein Fokus; dann Leser in `InfotelefonPage.tsx` und Fokus-Griff an `AnrufErfassung`; Guard und Vitest grün
- [ ] 3.3 Regeln: Satz zur Unterseiten-Zuordnung im Schnellaktionen-Absatz von `command-palette/AGENTS.md`; `prettier --check` grün

## 4. Anwenderdoku

- [ ] 4.1 Kapitel `stab.md` (Einstiege über Menü und Palette, „Anruf erfassen“) und `einsatz-oberflaeche.md` (Sprungmarken, Gruppe „Ansichten“) nachziehen; jedes weitere Kapitel, dessen `quellen:` einen berührten Pfad nennt, prüfen; `anwenderdoku.guard.test.ts` grün
- [ ] 4.2 Bilder der Kapitel neu erzeugen, deren Ansicht sich ändert (Modulpanel „Führung“, Startansicht der Palette): `pnpm doku:bilder --grep <kapitel>` und committen; ist der Bildlauf in der Umgebung nicht lauffähig, im PR vermerken

## 5. Abschluss

- [ ] 5.1 `./scripts/check-all.sh` grün (Bündel inkl. Vitest, Lint, Typcheck, Prettier); betroffene e2e-Specs (`command-palette.spec.ts`, `stab-schmal.spec.ts`) grün
- [ ] 5.2 Review (`requesting-code-review`) und Bildbeleg Menü (Fükw, Drawer) im PR

## Workflow follow-up

- `/opsx:archive gw8jul0f-stab-sprungmarken-palette` im selben Branch vor dem PR.
- PR gegen `alpha`, Zunder-Status `review` samt `pr_url`.
