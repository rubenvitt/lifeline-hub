# Tasks

## 1. Messwerkzeug und Ist-Messung

- [x] 1.1 Verschiebeprobe unter `werkzeug/` dieser Change: rendert die echte `Bloecke`-Komponente über den Vite-Dev-Server mit Testdaten (Anlage Personal 40 Köpfe, ETB 30 Entscheidungen) samt `druck.css`, schiebt den Bericht in Schritten über das Seitenende, druckt über Puppeteer in Firefox und Chromium, wertet je Titel per `pdftotext -bbox` aus (`ok` / `NUR-KOPF` / `TITEL-ALLEIN`, Rest vor dem Titel, jede Zeile genau einmal). Nachweis: Lauf auf `alpha`-Stand zeigt die bekannten Treffer in Firefox, Chromium ohne Treffer.
- [x] 1.2 Ist-Messung beider Browser in `werkzeug/messung.md` festhalten (Firefox-Version, Lagen, Treffer, Chromium-PDF-Text als Vergleichsbasis).

## 2. Deckel im Einsatzbericht

- [x] 2.1 `Bloecke.tsx`: Zellinhalt in einer Hülle; lange Tabelle mit Titeln bekommt Deckel (`titelblock-deckel`) mit Titeln und Deckeltabelle (`aria-hidden`, Kopf, erste Zeile, Maßzeilen 2…n), echte Tabelle mit `deckel-erste-zeile` und `--druck-kopfhoehe`; kurze Tabellen und Tabellen ohne Titel unverändert. Nachweis: neue Vitest-Fälle in `Bloecke.test.tsx` (zuerst rot) für Struktur, Reihenfolge, `aria-hidden`, Zeilenzahl und die unveränderten Fälle.
- [x] 2.2 `druck.css`: Regeln unter `@media print` + `@supports (-moz-appearance: none)` (Deckel nicht brechend, über der Tabelle, weißer Grund mit `print-color-adjust: exact`; echte Tabelle hochgezogen; Maßzeilen ohne Höhe; Kopf ohne Umbruch) und außerhalb davon Deckeltabelle `display: none`. Nachweis: Fälle in `druck/druck.test.ts` (zuerst rot) für jede Regel und ihren Ort in der Weiche.
- [x] 2.3 Dateikopf und Kommentare in `Bloecke.tsx`/`druck.css` nachziehen; Regel „Abschnittstitel stehen im Titelblock“ in `frontend/src/druck/AGENTS.md` fortschreiben (Deckel, Maßzeilen, Weiche, Verweis auf diese Change). Nachweis: Prettier über `frontend/` grün, Verweise per Grep geprüft.

## 3. Nachweis im Browser

- [x] 3.1 `e2e/einsatzbericht-druck.spec.ts`: Fall mit Anlage Personal über `KURZE_TABELLE`, im Firefox-Projekt unter Druckmedium und ausgelöstem `beforeprint`: Kopf der echten Tabelle verdeckt innerhalb des Deckels, Zeile 2 direkt unter Zeile 1 des Deckels (±0,5 px), Deckelgrund weiß; in Chromium Deckeltabelle nicht sichtbar. Nachweis: Spec grün in Chromium und Firefox.
- [x] 3.2 Nachher-Messung mit der Verschiebeprobe: Firefox ohne `NUR-KOPF`/`TITEL-ALLEIN`, kein Rest über Titel + Kopf + erste Zeile, jede Zeile genau einmal; Chromium-Text der PDFs gleich der Ist-Messung. Ergebnis in `werkzeug/messung.md`.

## 4. Abschluss

- [ ] 4.1 Gates: `tsc`, Lint, Prettier, Vitest komplett, `./scripts/check-all.sh --nur schnell` grün (volle Suite über die CI des PRs).

## Workflow follow-up

- Review (`superpowers:requesting-code-review`), dann `/opsx:archive` im selben Branch, danach PR gegen `alpha`.
