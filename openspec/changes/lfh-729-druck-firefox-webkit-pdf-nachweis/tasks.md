# Tasks

## 1. Abhängigkeit und Werkzeug

- [ ] 1.1 `pdfjs-dist` (aktuelle 5.x, exakt gepinnt) als devDependency in `frontend/package.json`
      aufnehmen, Lockfile mit `mise exec -- pnpm -C frontend install` erzeugen. Prüfen:
      `./scripts/check-deps.sh` grün, und `grep -r pdfjs frontend/dist` nach dem Prod-Build ist
      leer, das Paket liegt also nicht im Bundle.
- [ ] 1.2 Firefox und WebKit für Playwright in dieser Umgebung installieren
      (`pnpm -C frontend exec playwright install firefox webkit`, Chromium bleibt aus
      `/opt/pw-browsers`). Prüfen: `firefox.executablePath()` und `webkit.executablePath()`
      zeigen auf vorhandene Dateien. Scheitert das, den Grund in `pruefliste.md` festhalten
      und die Firefox/WebKit-Belege der CI des PRs überlassen.

## 2. PDF-Auszug `e2e/pdf-kern.ts` (TDD)

- [ ] 2.1 Selbsttest zuerst (rot): `page.setContent` mit zwei erzwungenen Seiten
      (`break-before: page`), bekanntem Text je Seite und einem eingebetteten PNG mit
      bekannten Abmessungen auf Seite 1. Erwartet werden Text je Seite, Seitenzahl 2 und das
      Bild nur auf Seite 1. Prüfen: Der Test scheitert, solange `pdf-kern.ts` fehlt.
- [ ] 2.2 `pdf-kern.ts` umsetzen (D4: Legacy-Build, Text je Seite normalisiert, Bilder je Seite
      mit Breite und Höhe). Prüfen: Selbsttest grün in Chromium. Mutationsprobe: Seiten im Auszug
      vertauscht → rot.

## 3. Druck-Specs in drei Engines (TDD)

- [ ] 3.1 `playwright.config.ts`: Projekte `firefox` und `webkit` mit EINER
      `testMatch`-Konstante für `druck-fluss` und `etb-druck` samt Begründungskommentar (D3).
      Prüfen: `playwright test --list --project=firefox` nennt nur Fälle aus diesen beiden
      Dateien.
- [ ] 3.2 `druck-fluss.spec.ts`: PDF-Schritte nur bei `browserName === 'chromium'`, sonst
      Annotation `nur-chromium`. Zähler-Selbsttest außerhalb von Chromium mit Grund
      überspringen. Kopfkommentar „NICHT BEWIESEN“ auf den neuen Stand bringen. Prüfen: Alle
      Fälle in `chromium`, `firefox` und `webkit` grün (oder nach 1.2 nur Chromium lokal).
- [ ] 3.3 `etb-druck.spec.ts` in Firefox und WebKit laufen lassen. Prüfen: grün. Abweichende
      Maße als Messwert in `pruefliste.md` festhalten, ohne Toleranz je Engine einzuführen.
- [ ] 3.4 Mutationsprobe Engine-Kaskade: Die Ausblende-Regel in `druck/druck.css` testweise
      auf `visibility: hidden` stellen. Prüfen: rot in jedem lokal verfügbaren Projekt,
      Ergebnis in `pruefliste.md`. Danach zurücksetzen.

## 4. Seitenzählung und Logo im PDF (TDD)

- [ ] 4.1 Seitenzählung: In `pruefeDruckImFluss` (Chromium) je Seite i den Text
      `Seite i von m` zusichern, mit m gleich der pdf.js-Seitenzahl und gleich der Rohtextzählung.
      Die Endmarke steht auf einer Seite nach Seite 1, und danach trägt keine Seite mehr als die
      Zählung. Dieselbe Zusicherung im ETB-Druck über `page.pdf()`. Prüfen: grün.
      Mutationsprobe: `@bottom-right` in `druck.css` entfernt → rot mit Seitennummer.
- [ ] 4.2 Logo-Fall (D5): PNG mit 97 × 41 px im Test erzeugen und hochladen, freigegebenen
      Lagebericht drucken. In allen Engines: geladenes `img` im Druckkopf mit diesen
      Abmessungen und einer Fläche. In Chromium: Bild 97 × 41 auf Seite 1, keines auf den
      Folgeseiten. Prüfen: grün. Mutationsproben: Logo im Druckkopf unter `@media print`
      ausgeblendet → rot, und `img` aus `Druckkopf.tsx` entfernt → rot.
- [ ] 4.3 Suche belegt, dass kein anderer e2e-Spec die Abwesenheit des Logos zusichert, und der
      Kommentar am Logo-Fall nennt die globale Organisation (D5). Prüfen:
      `grep -rn -i "logo" frontend/e2e` zeigt nur den neuen Fall und die Kopfzeilen-Treffläche.

## 5. Gate und CI

- [ ] 5.1 `scripts/check-all.sh` Schritt 7: `PW_PROJEKTE` (kommagetrennt, Vorgabe alle) als
      `--project=` weiterreichen und die Browser vorher prüfen, mit klarer Abbruchmeldung (D2).
      Kopf des Skripts und `scripts/AGENTS.md` nennen die Variable. Prüfen:
      `PW_PROJEKTE=chromium ./scripts/check-all.sh --nur e2e` grün. Mit absichtlich falschem
      Browserpfad bricht der Schritt mit der Installationsanweisung ab.
- [ ] 5.2 `.github/workflows/ci.yml`: Shards mit `PW_PROJEKTE: chromium`. Neuer Job
      `e2e Druck Firefox/WebKit` (`needs: binaer`, Installation `firefox webkit --with-deps`,
      eigener Playwright-Cache-Schlüssel, Blob `playwright-blob-druck-browser`). `berichte`
      lädt fünf Blobs und zählt sie, und `release.needs` nennt den Job. Shard-Zahl und
      Shard-Namen bleiben unverändert. Prüfen: YAML lädt (`python3 -c 'import yaml…'`), der
      Diff zeigt keine geänderten `name:`-Zeilen der Shards.

## 6. Regeln und Prüfliste

- [ ] 6.1 `frontend/src/druck/AGENTS.md`: „Firefox/Safari per Hand“ ersetzen durch das, was
      Firefox und WebKit automatisch belegen (Mechanik unter Druckmedium) und was nur das Blatt
      zeigt (Umbruch in Firefox und Safari). Seitenzählung und Logo als PDF-belegt nennen.
      Prüfen: Prettier über `frontend/` grün.
- [ ] 6.2 `pruefliste.md` in dieser Change anlegen: Verdikt je Druckstück und Browser,
      Messwerte, Mutationsproben aus 2.2, 3.4, 4.1 und 4.2. Das Browser-Verdikt in
      `docs/superpowers/specs/2026-09-25-lfh-22-pruefliste.md` umschreiben (D6) und den
      Kommentar in `pages/kraefteuebersichtPrint.css` nachziehen. Prüfen: `grep -rn "LFH-729"`
      zeigt keine Zelle mehr mit „automatisiert in LFH-729“ als offenem Verweis.
- [ ] 6.3 Ruleset-Handgriff festhalten: ClickUp-Task (Skill `clickup-task-anlegen`) „Check
      `e2e Druck Firefox/WebKit` im Ruleset 17017911 als Required Check eintragen“, zugewiesen an
      den Menschen. Prüfen: Die Task-ID steht in `pruefliste.md` und im PR.

## 7. Abschluss

- [ ] 7.1 `./scripts/check-all.sh` lokal grün (ohne `| tail`). Fehlen Firefox und WebKit lokal
      (1.2), dann mit `PW_PROJEKTE=chromium`, und das wird im PR gesagt. Die CI des PRs
      ist grün, einschließlich `e2e Druck Firefox/WebKit`, auf diesen Lauf verweisen.
- [ ] 7.2 Review: `superpowers:requesting-code-review` und
      `superpowers:verification-before-completion`. Bestätigte Findings sind behoben.
