# Seitenkopf im Überblick: Platz für die Pegel-Notiz — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Das Eintreffen des Pegels verschiebt den Überblick in keiner Breite um mehr als 0,1 CLS.

**Architecture:** `kopfLage` in `UeberblickPage.tsx` zeigt einen unsichtbaren Platzhalter in der
Form der Pegel-Notiz, solange der Pegel lädt und der Einsatz einen Pegel trägt. Platzhalter und
Notiz sind zwei Knoten. Die Pegel-Spec misst zusätzlich den ungünstigen Fall.

**Tech Stack:** React 19, TanStack Query, Vitest + MSW, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-24-uxrnx692-seitenkopf-pegel-platzhalter-design.md`

## Global Constraints

- Nur `pages/fuehrung/UeberblickPage.tsx` ändert sich im Produktcode; `EinsatzSeite` bleibt unverändert.
- Platzhaltertext genau `Pegel 0,00 m steigend`, `visibility: hidden`, `aria-hidden="true"`, `data-lfh="kopf-pegel-platzhalter"`.
- Bedingung: `einsatz` geladen, `lagekennzahlen` enthält `'pegel'`, `pegelQ.isPending`, `pegelNotiz` ist `null`.
- CLS-Grenze 0,1 je Fall, gemessen mit `--font-render-hinting=full`.
- Neue Bezeichner: Fachwort deutsch, Technik englisch (`AGENTS.md`, LFH-1312).

## Review Focus

- Einsatz ohne Pegel: kein Platzhalter, keine Lücke (Unit-Test in Task 1).
- Pegel-Abruf scheitert: Der Platzhalter verschwindet, an seine Stelle tritt „Pegel: Stand unbekannt“ (die bestehenden Tests decken das ab, `isPending` wird dann false).
- Der Einsatz kommt nach dem Pegel: Es entsteht nie ein Platzhalter, die Notiz steht sofort. Das deckt die Bedingung ab und braucht keinen eigenen Test.
- Pegel veraltet: Die breitere Notiz darf nicht umbrechen (e2e-Fall „lange Meta“ in Task 2).
- Screenreader: Der Platzhalter wird nicht vorgelesen (`aria-hidden`, Unit-Test in Task 1).

---

### Task 1: Platzhalter in `kopfLage`

**Files:**
- Modify: `frontend/src/pages/fuehrung/UeberblickPage.tsx` (`pegelNotiz`, `kopfLage`, ~452–740)
- Test: `frontend/src/pages/fuehrung/UeberblickPage.test.tsx` (neben „Pegel im Seitenkopf“)

**Interfaces:** Produces `data-lfh="kopf-pegel-platzhalter"` (Task 2 nutzt es nicht, nur Tests).

- [ ] **Step 1: Failing tests**
  - `it('Pegel lädt: unsichtbarer Platzhalter „Pegel 0,00 m steigend“ hält die Stelle der Notiz (LLH-2085)')`:
    Einsatz mit `lagekennzahlen: ['pegel']` (Override `http.get('/api/einsaetze/1', …)`),
    `gauges` mit `await delay('infinite')`. Erwartung nach `koerperDa()`: `kopf-pegel-platzhalter`
    hat den Text `Pegel 0,00 m steigend`, `aria-hidden="true"` und `visibility: hidden`, und
    `kopf-pegel` fehlt.
  - `it('Einsatz ohne Pegel: kein Platzhalter im Kopf (LLH-2085)')`: `lagekennzahlen: []`, `gauges`
    unendlich verzögert, Erwartung nach `koerperDa()`: kein `kopf-pegel-platzhalter`.
- [ ] **Step 2:** `mise exec -- pnpm vitest run src/pages/fuehrung/UeberblickPage.test.tsx -t LLH-2085` → der erste Test schlägt fehl.
- [ ] **Step 3:** `pegelErwartet` berechnen (Bedingung aus Global Constraints). `kopfLage` entsteht auch dann, wenn nur `pegelErwartet` gilt. Die Notiz als `<span key="pegel" data-lfh="kopf-pegel">`, sonst der Platzhalter als `<span key="pegel-platzhalter" …>` an derselben Stelle. Die Konstante `PEGEL_PLATZHALTER = 'Pegel 0,00 m steigend'` steht mit Kommentar neben `pegelNotizKurz` in `pegel/pegelKennzahl.ts`.
- [ ] **Step 4:** Dieselbe Datei komplett: `mise exec -- pnpm vitest run src/pages/fuehrung/UeberblickPage.test.tsx` → grün.
- [ ] **Step 5:** Commit `fix(ueberblick): Platz für die Pegel-Notiz im Seitenkopf, solange der Pegel lädt (LLH-2085)`.

### Task 2: Pegel-Spec misst den ungünstigen Fall

**Files:**
- Modify: `frontend/e2e/pegel-pruefliste.spec.ts` (Abschnitt CLS, nach der Schleife über `ueberblick`/`lage-dashboard`)

**Interfaces:** Consumes die vorhandenen Helfer `anmelden`, `einsatzAnlegen`, `legePegelFest`, `verschiebungenAufzeichnen`, `zurueckhalten`, `wartenBisRuhig`, `beitragAb`, `pegelListe`.

- [ ] **Step 1: Test schreiben.** Zwei Fälle in einer Schleife, je ein `test(…)`:
  - `ueberblick, langer Einsatzname: der Pegel als erste Lage-Angabe trägt ≤ 0,1 zur CLS bei (LLH-2085)` mit Breite 1024 und Messung frisch (`pegelListe(10)`, Text `/Pegel 6,84 m steigend/`).
  - `ueberblick, langer Einsatzname, Warnstufe akut, unbestätigt und Pegel veraltet: ≤ 0,1 (LLH-2085)` mit Breiten 768 und 1024, drei Gefahrengebiete mit `warnstufe: 'akut'` und ohne Bestätigung (Zone `gefahrengebiet` anlegen, dann `PUT …/matrix/rating`), `pegelListe(120)`, Text `/veraltet/`.
  - Einsatzname `Hochwasser Elbe Dresden Abschnitt Nord-Süd ${Date.now()}`, Viewport-Höhe 844. Die Spec setzt per `test.use` nichts an der Schriftsetzung; die CI-Setzung kommt beim lokalen Lauf über die Startoption (Step 2).
- [ ] **Step 2: Mutationsprobe.** Den Platzhalter kurz ausschalten (Bedingung auf `false`) und lokal mit `--font-render-hinting=full` laufen lassen (vorinstalliertes Chromium). Beide neuen Fälle müssen rot sein. Danach zurücksetzen.
- [ ] **Step 3:** Mit Fix alle CLS-Tests der Spec laufen lassen (`-g CLS`) → grün. Ist „Pegel veraltet“ rot, nimmt der Platzhalter „· veraltet“ auf (Spec, „Dem Bauenden überlassen“), und es folgt erneut Step 1 von Task 1.
- [ ] **Step 4:** Commit `test(e2e): Pegel-Spec misst langen Einsatznamen und lange Meta im Überblick (LLH-2085)`.

### Task 3: Regel und Gates

- [ ] In `frontend/AGENTS.md`, „Seitenkopf“, einen Halbsatz ergänzen: Eine Meta, die aus mehreren späten Abrufen zusammenwächst, hält den Platz der späten Teile selbst; Beispiel Pegel im Überblick (LLH-2085).
- [ ] `./scripts/check-all.sh --geaendert --ohne-e2e` → grün.
- [ ] Commit `docs(frontend): Seitenkopf-Regel nennt den Platzhalter für späte Teile der Meta (LLH-2085)`.
