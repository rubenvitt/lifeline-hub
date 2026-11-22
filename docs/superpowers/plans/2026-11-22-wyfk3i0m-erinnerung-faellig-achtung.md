# Fällige Erinnerung in Achtung — Umsetzungsplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eine fällige Erinnerung trägt im Modul dasselbe Wort und dieselbe Rolle wie im Überblick („fällig“, `achtung`), ohne Alarmkante und Alarmfläche; ihre Gruppe heißt „Fällig“.

**Architecture:** `ERINNERUNG_FAELLIG` in `erinnerung/erinnerungZustand.ts` bleibt die eine Stelle für Wort und Ton und bekommt das Gruppenetikett dazu. Die Karte liest beides, `KommKarte` und `kartenKante` bleiben unverändert.

**Tech Stack:** React, antd, Vitest, Testing Library.

**Spec:** `docs/superpowers/specs/2026-11-22-wyfk3i0m-erinnerung-faellig-achtung-design.md`

**Zunder:** LLH-1911, `https://zunder.rubeen.dev/#/aufgabe/wyfk3i0mw59mymnv1kvewg30`

## Global Constraints

- Nichts unter `openspec/` ändern (ADR-0069).
- `kommunikation/kartenKante.ts`, `KommKarte.tsx` und `gruppierung.ts` unverändert.
- Neue Bezeichner nach LFH-1312 (Fachwort deutsch, Technik englisch).
- Commit-Body mit `Zunder: https://zunder.rubeen.dev/#/aufgabe/wyfk3i0mw59mymnv1kvewg30`.

## Review Focus

- Eine fällige Karte trägt noch `data-alarm` → Test in `ErinnerungKarte.test.tsx` (Task 2).
- „Überfällig“ steht weiter über Aufträgen → `AuftraegeListe` liest `GRUPPE_LABEL` unverändert (Task 1).

---

### Task 1: Gruppenetikett „Fällig“ für Erinnerungen

**Files:**
- Modify: `frontend/src/erinnerung/erinnerungZustand.ts`, `erinnerungZustand.test.ts`
- Modify: `frontend/src/pages/ErinnerungenPage.tsx`, `ErinnerungenPage.test.tsx`

- [x] Test: `ERINNERUNG_GRUPPE_LABEL.ueberfaellig === 'Fällig'`, die übrigen Schlüssel gleich `GRUPPE_LABEL`; rot.
- [x] `ERINNERUNG_GRUPPE_LABEL` anlegen; grün.
- [x] Seitentest: die fällige Erinnerung steht unter „Fällig (1)“, „Überfällig“ fehlt; rot.
- [x] Seite liest `ERINNERUNG_GRUPPE_LABEL`; grün.

### Task 2: Karte in Achtung

**Files:**
- Modify: `frontend/src/erinnerung/ErinnerungKarte.tsx`, `ErinnerungKarte.test.tsx`

- [x] Test umdrehen: fällig und angesprungen → `data-hervorgehoben`, kein `data-alarm`. Neu: fällig → Chip `data-ton="achtung"` mit „fällig“, kein `data-alarm`, Fälligkeitszeile in `achtungText`; rot.
- [x] Karte ohne `alarm`, Chip aus `ERINNERUNG_FAELLIG`, Zeile in `rollen.achtungText`; grün.

### Task 3: Regel und Doku

**Files:**
- Modify: `frontend/AGENTS.md` („Linker Kartenrand“), `docs/anwender/kapitel/erinnerungen.md`

- [x] Regelsatz in `frontend/AGENTS.md`; Prettier.
- [x] Doku: Gruppen „Fällig“, „Heute fällig“, „Später“; Karte trägt „fällig“ in Gelb; Bildregeln aus `docs/anwender/AGENTS.md` geprüft.

### Task 4: Verifikation

- [x] `./scripts/check-all.sh --geaendert --ohne-e2e` grün.
- [x] Bilder vorher/nachher für den PR.
