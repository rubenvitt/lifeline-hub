# Tasks

## 1. nufmon70 (LLH-1828): Sprunglink

- [x] 1.1 `components/SprungZumInhalt.tsx` und Klasse `.lfh-sprung-inhalt` in `theme/sprache.css`
  (D2, D4). Vitest: Klick setzt den Fokus auf das letzte Element mit
  `data-lfh="sprungziel-inhalt"`, die Adresse bleibt ohne Hash, ohne Ziel kein Wurf.
- [x] 1.2 Sprungziele markieren: `main` in `EinsatzLayout` und `AppLayout`, Inhalt der Verwaltung
  als `div` statt verschachteltem `Content` (D3), `main` der Hilfe. Den Link in `BetriebsLayout`
  vor `LiveStatusBanner` einhängen, die Hilfe bindet ihn selbst ein. Belegt durch einen Vitest
  über `createMemoryRouter(appRouten)`: erster Tab-Halt ist der Link, in der Verwaltung gibt es
  genau ein `<main>`, jeder Rahmen trägt ein Ziel (Wächter).
- [x] 1.3 `index.css`: Ausnahme von den `scroll-padding`-Regeln für den Link. e2e
  `frontend/e2e/sprung-zum-inhalt.spec.ts`: Überblick, Betroffene und Verwaltung, je Tab und
  Enter und Tab, der Fokus liegt im Inhalt, der Link ist sichtbar und nicht verdeckt, ohne
  Layoutsprung (Rahmenposition vor und nach dem Fokus gleich). Der Lauf der Spec und von
  `fokus-verdeckung` ist grün.
- [x] 1.4 `frontend/AGENTS.md`, Abschnitt zum Rahmen: „Sprunglink zum Inhalt einmal in
  `BetriebsLayout`; jeder Rahmen markiert sein Ziel“. Das Anwenderkapitel
  `einsatz-oberflaeche.md` bekommt einen Satz zur Tastaturbedienung, wo es sie beschreibt.
  Prettier und der Wächter der Anwenderdoku sind grün.

## 2. Integration

- [ ] 2.1 `./scripts/check-all.sh --geaendert --ohne-e2e` grün (gemeinsam mit
  `a12ms7g9-seitenzustaende` im selben Branch).

## Workflow follow-up

- `/opsx:archive nufmon70-sprunglink-zum-inhalt` im selben Branch vor dem PR.
- Bild der Änderung: der fokussierte Link über dem Einsatzkopf.
