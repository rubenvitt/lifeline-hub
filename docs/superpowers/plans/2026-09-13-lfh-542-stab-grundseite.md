# LFH-542 · Stab ST4 — Frontend-Grundseite Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Das Modul „Stab" wird freigeschaltet: eine Vollseite `/einsaetze/:id/stab` mit sechs festen Sachgebietszeilen S1–S6, Besetzungszustand je Zeile, Werkzeug-Deeplinks und einer Maske „Besetzung ändern".

**Architecture:** Reine, exportierte Funktionen tragen die Logik (`stab/besetzung.ts`, `stab/werkzeuge.ts`, `stab/zeilenziel.ts`) und sind ohne Render geprüft; `pages/StabPage.tsx` setzt sie auf `EinsatzSeite` + `Liste` zusammen; die Maske `stab/BesetzungModal.tsx` nimmt `ErfassungsModal`. Die bestehende Ad-hoc-Personenmaske wird aus `PersonalPage` in ein geteiltes Bauteil gehoben, statt kopiert.

**Tech Stack:** React 19, antd 6, TanStack Query, react-router, Vitest + Testing Library + MSW.

**Spec:** `docs/superpowers/specs/2026-09-12-lfh-46-stab-s1-s6-design.md` (Abschnitte 4, 10, 11). Ticket: LFH-542. Scope-Befunde: Kommentare an LFH-543/544/545.

## Global Constraints

- `FE=/Users/rubeen/dev/personal/lifeline-hub/.claude/worktrees/clickup-forgejo-exe-9430ca/frontend` — pnpm immer als `mise exec pnpm@11.10.0 -- pnpm -C "$FE" …`, Exit-Codes über `rtk proxy` lesen (der rtk-Hook maskiert sie sonst).
- Branch `feat/lfh-46-stab-frontend`, Basis `origin/alpha`. Commits referenzieren `LFH-542`, enden mit `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.
- Keine Tabelle, kein `Datensicht`, kein Drawer (Spec Entscheidung 16). Kein `size="small"` auf Interaktivem, kein Emoji.
- Schreibrecht nur über `darfImEinsatzSchreiben(einsatz, benutzer)` (roher `meine_rolle`-Vergleich ist per Guard verboten).
- Farben nur über `StatusTag`/Tokens; kein `Record<…, StatusDarstellung>` außerhalb `theme/statusFarben.ts` (Guard `statusVertrag.guard.test.ts`). Alle Besetzungszustände sind `rolle: 'neutral'`, das Wort ist der zweite Kanal.
- Handgebaute Bedienziele (Links) tragen `minHeight: token.controlHeight` **plus** `padding` aus aufgelösten Tokens, nie `var(--lfh-*)`.
- Deeplinks nur über `routing/deeplinks.ts`; Query-Keys nur über `api/queryKeys.ts` (Inline-Arrays per Guard verboten).
- Backend-Vertrag (gemergt, `src/routes/stab.rs`): `PUT …/stab/besetzung/{s1..s6}` Body `{ besetzung_art, personal_id?, bezeichnung? }` → 200 `StabAnzeige`; `personal_id` ist `einsatz_personal.id` (= `EinsatzPersonal.id`), **nicht** `EinsatzPersonal.personal_id`. Überzählige Felder sind 422 (personal mit bezeichnung, extern mit personal_id, einsatzleitung mit einem von beiden). `DELETE` → 204 ohne Body, auch auf leerer Zeile; im abgeschlossenen Einsatz 409. Ein PUT mit unverändertem Wert schreibt `gesetzt_at` neu und feuert `stab` — deshalb der Wertgleichheits-Riegel im Frontend.
- `StabAnzeige.besetzung` enthält **nur belegte** Zeilen; die sechs Zeilen baut das Frontend. `name` fehlt bei `einsatzleitung`; `personal_noch_disponiert` ist nur bei `personal` aussagekräftig.
- Live: `EINSATZ_STREAM_EVENTS.stab` invalidiert `einsatz-stab` bereits (Bestand) — kein Handgriff nötig.

## Abweichungen vom Ticket (bewusst, mit Grund)

1. **Kopf-Slot „Lagebesprechung abschließen" samt `neueZeile` wandert nach ST5 (LFH-543).** Das Modal entsteht erst dort; in ST4 stünde eine Primäraktion ohne Ziel. Das Rechte-Paar dieses Tickets hängt deshalb an den Zeilenaktionen: mit Recht sechs „Besetzung ändern", ohne Recht keine plus `RechteHinweis` (CLAUDE.md, LFH-346 · C11: Zeilenaktionen entfallen, der Satz nennt den Grund).
2. **`stabZeilenzielStil` statt `zeilenzielStil`.** Der Name ist in `pages/einstellungen/Anmeldeverfahren.tsx:22` schon exportiert (dort `display: 'flex'`); zwei gleichnamige Exporte verwechselt der Auto-Import.
3. **Lücken-Definition nicht in `stab/sachgebiete.ts`.** Sie gehört mit ihrer Rechnung nach `stab/luecken.ts` (ST6); ein Feld ohne Konsument wäre hier YAGNI. Konsumenten von `stabZeilenzielStil` in ST4 sind nur die Werkzeug-Links; ETB-Link (ST5) und Kennzahlen (ST6) folgen.
4. **Sub-Key `lagebesprechungen` und die Lagebesprechungs-API entstehen in ST5.** Die übrigen Query-Keys (`EINSATZ_KEYS.stab`, Stream-Event, `einsatzKeys.stab`, Byte-Pin) liegen seit ST1 im Bestand.

## Dateistruktur

| Datei | Verantwortung |
|---|---|
| `frontend/src/api/types.ts` (Modify) | Re-Exporte `Stab`, `Stabsfunktion`, `Lagebesprechung`, `Sachgebiet`, `BesetzungArt`; FE-lokaler Body `BesetzungSetzen` |
| `frontend/src/api/stab.ts` (Create) | `ladeStab`, `setzeBesetzung`, `entferneBesetzung` |
| `frontend/src/routing/deeplinks.ts` (Modify) | `stabPfad(einsatzId, { neu? })` |
| `frontend/src/stab/sachgebiete.ts` (Create) | Konstante `SACHGEBIETE`: Kürzel, Label, Anlage-2-Kurztext, Seite, Werkzeug-Modulschlüssel |
| `frontend/src/stab/besetzung.ts` (Create) | reine Funktionen: Darstellung, Formvorbelegung, Aktion (Wertgleichheits-Riegel), Rechte-Text |
| `frontend/src/stab/werkzeuge.ts` (Create) | `werkzeugeFuer` — Registry-Einträge gefiltert über `istModulFreigegeben` |
| `frontend/src/stab/zeilenziel.ts` (Create) | `stabZeilenzielStil(token)` |
| `frontend/src/kraefte/AdhocPersonModal.tsx` (Create) | geteilte Ad-hoc-Personenmaske (vorher inline in `PersonalPage`) |
| `frontend/src/pages/PersonalPage.tsx` (Modify) | nutzt `AdhocPersonModal` |
| `frontend/src/stab/BesetzungModal.tsx` (Create) | Maske „Besetzung ändern" |
| `frontend/src/pages/StabPage.tsx` (Create) | Vollseite |
| `frontend/src/App.tsx`, `frontend/src/einsatz/modulRegistry.ts` (Modify) | `MODUL_ELEMENTE.stab`, Flip `wip → fertig` |

---

### Task 1: API-Client, Typen und `stabPfad`

**Files:**
- Modify: `frontend/src/api/types.ts` (neuer Block nach dem Befehlsgebung-Block, `S`-Alias ist dort schon in Gebrauch)
- Create: `frontend/src/api/stab.ts`
- Modify: `frontend/src/routing/deeplinks.ts` (direkt nach `schaedenPfad`)
- Test: `frontend/src/routing/deeplinks.test.ts`

**Interfaces:**
- Produces: `type Stab`, `type Stabsfunktion`, `type Lagebesprechung`, `type Sachgebiet`, `type BesetzungArt`, `interface BesetzungSetzen { besetzung_art: BesetzungArt; personal_id?: number; bezeichnung?: string }` aus `api/types`; `ladeStab(einsatzId: number): Promise<Stab>`, `setzeBesetzung(einsatzId: number, sachgebiet: Sachgebiet, daten: BesetzungSetzen): Promise<Stab>`, `entferneBesetzung(einsatzId: number, sachgebiet: Sachgebiet): Promise<void>` aus `api/stab`; `stabPfad(einsatzId: number, opts?: { neu?: boolean }): string` aus `routing/deeplinks`.

- [ ] **Step 1: Failing test für `stabPfad`**

In `frontend/src/routing/deeplinks.test.ts` den Import um `stabPfad` ergänzen (alphabetisch in die bestehende Importliste neben `schaedenPfad`) und neben den `schaedenPfad`-Tests einfügen:

```ts
  it('stabPfad ohne Optionen', () => {
    expect(stabPfad(E)).toBe('/einsaetze/5/stab');
  });

  it('stabPfad mit neu fokussiert den Abschluss (?neu=1)', () => {
    expect(stabPfad(E, { neu: true })).toBe('/einsaetze/5/stab?neu=1');
    expect(stabPfad(E, { neu: false })).toBe('/einsaetze/5/stab');
  });
```

- [ ] **Step 2: Test rot sehen**

Run: `rtk proxy mise exec pnpm@11.10.0 -- pnpm -C "$FE" exec vitest run src/routing/deeplinks.test.ts`
Expected: FAIL — `stabPfad` ist kein Export.

- [ ] **Step 3: `stabPfad` implementieren**

In `frontend/src/routing/deeplinks.ts` direkt nach `schaedenPfad`:

```ts
/**
 * Stab-Modul (LFH-46). `?neu=1` fokussiert den Abschluss der Lagebesprechung (ST5, LFH-543);
 * die Seite räumt den Parameter nach dem Lesen (apply-then-clean wie ETB/Schäden).
 */
export function stabPfad(einsatzId: number, opts: { neu?: boolean } = {}): string {
  return mitQuery(einsatzModulPfad(einsatzId, 'stab'), {
    neu: opts.neu ? 1 : undefined,
  });
}
```

- [ ] **Step 4: Typen und API-Client anlegen**

In `frontend/src/api/types.ts` nach dem Block `// ============================== LFH-64 Befehlsgebung ==============================` einfügen:

```ts
// ============================== LFH-46 Stab (S1–S6) ==============================
export type Stab = S['StabAnzeige'];
export type Stabsfunktion = S['StabsfunktionAnzeige'];
export type Lagebesprechung = S['LagebesprechungAnzeige'];
export type Sachgebiet = S['Sachgebiet'];
export type BesetzungArt = S['BesetzungArt'];

/**
 * LFH-120: kein Backend-Schema — Eingabe-Body von `PUT …/stab/besetzung/{sachgebiet}`, FE-lokal.
 * `personal_id` ist `einsatz_personal.id` (= `EinsatzPersonal.id`). Überzählige Felder sind 422
 * (`src/routes/stab.rs:80-118`) — Aufrufer schicken NUR das Feld, das die Art verlangt.
 */
export interface BesetzungSetzen {
  besetzung_art: BesetzungArt;
  personal_id?: number;
  bezeichnung?: string;
}
```

Neue Datei `frontend/src/api/stab.ts`:

```ts
import { apiGet, apiSend } from './client';
import type { BesetzungSetzen, Sachgebiet, Stab } from './types';

/** Führungsorganisation eines Einsatzes (LFH-46). `besetzung` trägt nur belegte Zeilen. */
export function ladeStab(einsatzId: number): Promise<Stab> {
  return apiGet<Stab>(`/api/einsaetze/${einsatzId}/stab`);
}

export function setzeBesetzung(
  einsatzId: number,
  sachgebiet: Sachgebiet,
  daten: BesetzungSetzen,
): Promise<Stab> {
  return apiSend<Stab>(`/api/einsaetze/${einsatzId}/stab/besetzung/${sachgebiet}`, 'PUT', daten);
}

/** 204 ohne Body — auch auf einer leeren Zeile (idempotent, Spec 9.2). */
export function entferneBesetzung(einsatzId: number, sachgebiet: Sachgebiet): Promise<void> {
  return apiSend<void>(`/api/einsaetze/${einsatzId}/stab/besetzung/${sachgebiet}`, 'DELETE');
}
```

- [ ] **Step 5: Tests grün, Typen sauber**

Run: `rtk proxy mise exec pnpm@11.10.0 -- pnpm -C "$FE" exec vitest run src/routing/deeplinks.test.ts`
Expected: PASS.
Run: `rtk proxy mise exec pnpm@11.10.0 -- pnpm -C "$FE" typecheck`
Expected: keine Fehler.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/api/types.ts frontend/src/api/stab.ts frontend/src/routing/deeplinks.ts frontend/src/routing/deeplinks.test.ts
git commit -m "feat(stab): API-Client, Typen und stabPfad (LFH-542)"
```

---

### Task 2: Sachgebiete und Besetzungslogik (reine Funktionen)

**Files:**
- Create: `frontend/src/stab/sachgebiete.ts`, `frontend/src/stab/sachgebiete.test.ts`
- Create: `frontend/src/stab/besetzung.ts`, `frontend/src/stab/besetzung.test.ts`

**Interfaces:**
- Consumes: `Sachgebiet`, `Stab`, `Stabsfunktion`, `BesetzungArt`, `BesetzungSetzen` aus `api/types` (Task 1); `StatusDarstellung` aus `theme/statusFarben`; `modulRegistry` aus `einsatz/modulRegistry` (nur im Test).
- Produces:
  - `interface SachgebietEintrag { sachgebiet: Sachgebiet; kuerzel: string; label: string; aufgaben: string; seite: number; werkzeuge: readonly string[] }`, `const SACHGEBIETE: readonly SachgebietEintrag[]`
  - `type BesetzungWahl = BesetzungArt | 'nicht_vergeben'`
  - `interface BesetzungFormWerte { art: BesetzungWahl; personal_id?: number; bezeichnung?: string }`
  - `const BESETZUNG_OPTIONEN: readonly { value: BesetzungWahl; label: string }[]`
  - `zeileFuer(stab: Stab | undefined, sachgebiet: Sachgebiet): Stabsfunktion | undefined`
  - `besetzungDarstellung(zeile: Stabsfunktion | undefined): StatusDarstellung`
  - `besetzungFormWerte(zeile: Stabsfunktion | undefined): BesetzungFormWerte`
  - `type BesetzungAktion = { typ: 'keine' } | { typ: 'entfernen' } | { typ: 'setzen'; daten: BesetzungSetzen }`
  - `besetzungAktion(zeile: Stabsfunktion | undefined, werte: BesetzungFormWerte): BesetzungAktion`
  - `besetzungRechteText(einsatzStatus: string): string`

- [ ] **Step 1: Failing tests schreiben**

`frontend/src/stab/sachgebiete.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { modulRegistry } from '../einsatz/modulRegistry';
import { SACHGEBIETE } from './sachgebiete';

describe('SACHGEBIETE', () => {
  it('führt genau die sechs Sachgebiete in Anlage-2-Reihenfolge', () => {
    expect(SACHGEBIETE.map((s) => s.sachgebiet)).toEqual(['s1', 's2', 's3', 's4', 's5', 's6']);
    expect(SACHGEBIETE.map((s) => s.kuerzel)).toEqual(['S1', 'S2', 'S3', 'S4', 'S5', 'S6']);
  });

  /**
   * Die Labels sind DIESELBEN wie im System-ETB-Eintrag (`src/stab/mod.rs`, `Sachgebiet::label`):
   * die Zeile und der Führungsnachweis dürfen dasselbe Sachgebiet nicht verschieden benennen.
   * Literale, nicht aus dem Backend gelesen — sonst prüfte der Test die Quelle gegen sich selbst.
   */
  it('benennt die Sachgebiete wie der System-ETB-Eintrag', () => {
    expect(SACHGEBIETE.map((s) => s.label)).toEqual([
      'Personal',
      'Lage',
      'Einsatz',
      'Versorgung',
      'Presse- und Medienarbeit',
      'Information und Kommunikation',
    ]);
  });

  it('trägt je Zeile einen Aufgaben-Kurztext mit Seite aus Anlage 2 (S. 55–60)', () => {
    SACHGEBIETE.forEach((s, i) => {
      expect(s.aufgaben.length).toBeGreaterThan(0);
      expect(s.seite).toBe(55 + i);
    });
  });

  /** Ein vertippter Schlüssel fiele sonst still aus der Werkzeugzeile — ohne Fehlerbild. */
  it('verweist nur auf existierende Registry-Module', () => {
    const keys = new Set(modulRegistry.map((m) => m.key));
    for (const s of SACHGEBIETE) {
      for (const w of s.werkzeuge) expect(keys.has(w), `${s.kuerzel}: ${w}`).toBe(true);
    }
  });

  it('S5 hat im Bestand kein Werkzeug (Spec 2.2: 0 Treffer im Repo)', () => {
    expect(SACHGEBIETE.find((s) => s.sachgebiet === 's5')!.werkzeuge).toEqual([]);
  });
});
```

`frontend/src/stab/besetzung.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { Stabsfunktion } from '../api/types';
import {
  besetzungAktion,
  besetzungDarstellung,
  besetzungFormWerte,
  besetzungRechteText,
  zeileFuer,
} from './besetzung';

function zeile(over: Partial<Stabsfunktion> = {}): Stabsfunktion {
  return {
    sachgebiet: 's2',
    besetzung_art: 'personal',
    personal_id: 99,
    name: 'Müller',
    personal_noch_disponiert: true,
    gesetzt_at: '2026-09-13 10:00:00',
    gesetzt_von_id: 1,
    ...over,
  };
}

describe('zeileFuer', () => {
  it('findet die belegte Zeile und liefert undefined für eine nicht vergebene', () => {
    const stab = { anzahl_lagebesprechungen: 0, besetzung: [zeile()] };
    expect(zeileFuer(stab, 's2')?.name).toBe('Müller');
    expect(zeileFuer(stab, 's4')).toBeUndefined();
    expect(zeileFuer(undefined, 's2')).toBeUndefined();
  });
});

describe('besetzungDarstellung', () => {
  it('nennt jeden Zustand beim Wort und bleibt neutral', () => {
    expect(besetzungDarstellung(undefined)).toEqual({ rolle: 'neutral', label: 'nicht vergeben' });
    expect(besetzungDarstellung(zeile())).toEqual({ rolle: 'neutral', label: 'Müller' });
    expect(
      besetzungDarstellung(zeile({ besetzung_art: 'einsatzleitung', personal_id: undefined, name: undefined })),
    ).toEqual({ rolle: 'neutral', label: 'Einsatzleitung' });
    expect(
      besetzungDarstellung(zeile({ besetzung_art: 'extern', personal_id: undefined, name: 'Dr. Weber' })),
    ).toEqual({ rolle: 'neutral', label: 'Dr. Weber (extern)' });
    expect(
      besetzungDarstellung(zeile({ besetzung_art: 'rueckwaertig', personal_id: undefined, name: 'Leitstelle' })),
    ).toEqual({ rolle: 'neutral', label: 'Leitstelle (rückwärtig)' });
  });

  /** Nur bei `personal` ist das Flag aussagekräftig (bei den anderen Arten immer true). */
  it('hängt „nicht mehr disponiert" nur an eine Person, deren Disposition weg ist', () => {
    expect(
      besetzungDarstellung(zeile({ personal_id: undefined, personal_noch_disponiert: false })).label,
    ).toBe('Müller · nicht mehr disponiert');
  });
});

describe('besetzungFormWerte', () => {
  it('belegt die Maske mit dem aktuellen Zustand vor', () => {
    expect(besetzungFormWerte(undefined)).toEqual({ art: 'nicht_vergeben' });
    expect(besetzungFormWerte(zeile())).toEqual({ art: 'personal', personal_id: 99 });
    expect(
      besetzungFormWerte(zeile({ besetzung_art: 'einsatzleitung', personal_id: undefined, name: undefined })),
    ).toEqual({ art: 'einsatzleitung' });
    expect(
      besetzungFormWerte(zeile({ besetzung_art: 'rueckwaertig', personal_id: undefined, name: 'FEZ' })),
    ).toEqual({ art: 'rueckwaertig', bezeichnung: 'FEZ' });
  });
});

/**
 * Der Wertgleichheits-Riegel (Spec 10, Muster `BemerkungZelle`): ein unveränderter PUT schriebe
 * `gesetzt_at` neu und feuerte ein Live-Ereignis für nichts (`src/stab/repo.rs:474-498`).
 * Jede „keine"-Aussage steht neben einem Gegenfall, der sehr wohl sendet.
 */
describe('besetzungAktion', () => {
  it('leere Zeile, „nicht vergeben" bestätigt → keine Aktion', () => {
    expect(besetzungAktion(undefined, { art: 'nicht_vergeben' })).toEqual({ typ: 'keine' });
  });

  it('belegte Zeile, „nicht vergeben" → entfernen', () => {
    expect(besetzungAktion(zeile(), { art: 'nicht_vergeben' })).toEqual({ typ: 'entfernen' });
  });

  it('leere Zeile, Person gewählt → setzen mit NUR der personal_id', () => {
    expect(besetzungAktion(undefined, { art: 'personal', personal_id: 99, bezeichnung: 'Rest' })).toEqual({
      typ: 'setzen',
      daten: { besetzung_art: 'personal', personal_id: 99 },
    });
  });

  it('dieselbe Person erneut → keine Aktion; eine andere Person → setzen', () => {
    expect(besetzungAktion(zeile(), { art: 'personal', personal_id: 99 })).toEqual({ typ: 'keine' });
    expect(besetzungAktion(zeile(), { art: 'personal', personal_id: 7 })).toEqual({
      typ: 'setzen',
      daten: { besetzung_art: 'personal', personal_id: 7 },
    });
  });

  it('Einsatzleitung bleibt Einsatzleitung → keine Aktion; Wechsel dorthin → setzen ohne Zusatzfelder', () => {
    const el = zeile({ besetzung_art: 'einsatzleitung', personal_id: undefined, name: undefined });
    expect(besetzungAktion(el, { art: 'einsatzleitung' })).toEqual({ typ: 'keine' });
    expect(besetzungAktion(zeile(), { art: 'einsatzleitung', personal_id: 99 })).toEqual({
      typ: 'setzen',
      daten: { besetzung_art: 'einsatzleitung' },
    });
  });

  it('extern: getrimmte gleiche Bezeichnung → keine Aktion; andere → setzen mit NUR der Bezeichnung', () => {
    const ext = zeile({ besetzung_art: 'extern', personal_id: undefined, name: 'Dr. Weber' });
    expect(besetzungAktion(ext, { art: 'extern', bezeichnung: '  Dr. Weber ' })).toEqual({ typ: 'keine' });
    expect(besetzungAktion(ext, { art: 'extern', bezeichnung: 'Dr. Lang', personal_id: 99 })).toEqual({
      typ: 'setzen',
      daten: { besetzung_art: 'extern', bezeichnung: 'Dr. Lang' },
    });
  });

  it('Artwechsel bei gleicher Bezeichnung (extern → rückwärtig) ist eine Änderung', () => {
    const ext = zeile({ besetzung_art: 'extern', personal_id: undefined, name: 'Leitstelle' });
    expect(besetzungAktion(ext, { art: 'rueckwaertig', bezeichnung: 'Leitstelle' })).toEqual({
      typ: 'setzen',
      daten: { besetzung_art: 'rueckwaertig', bezeichnung: 'Leitstelle' },
    });
  });
});

describe('besetzungRechteText', () => {
  it('unterscheidet abgeschlossenen Einsatz und fehlende Rolle', () => {
    expect(besetzungRechteText('abgeschlossen')).toMatch(/abgeschlossen/);
    expect(besetzungRechteText('aktiv')).toMatch(/Einsatzleitung und Führungspersonal/);
  });
});
```

- [ ] **Step 2: Tests rot sehen**

Run: `rtk proxy mise exec pnpm@11.10.0 -- pnpm -C "$FE" exec vitest run src/stab`
Expected: FAIL — Module `./sachgebiete` und `./besetzung` fehlen.

- [ ] **Step 3: `stab/sachgebiete.ts` anlegen**

```ts
import type { Sachgebiet } from '../api/types';

/**
 * Die sechs Sachgebiete als feste Zeilen (Spec LFH-46, Entscheidung 2 und Abschnitt 2.2).
 *
 * S1–S6 sind im Produkt AUFGABENZUORDNUNGEN, keine Arbeitsplätze: eine Zeile je Sachgebiet,
 * ein Kurztext als Merkhilfe („Anregung, Erinnerung und Unterstützung", FwDV 100 Anlage 2,
 * S. 54) und Deeplinks in die Module, in denen gearbeitet wird.
 *
 * `label` ist wortgleich mit `Sachgebiet::label` in `src/stab/mod.rs` — der System-ETB-Eintrag
 * trägt dieselbe Bezeichnung, und Zeile und Führungsnachweis dürfen nicht auseinanderlaufen.
 * `aufgaben` ist gekürzt, nicht zitiert; die Seite verweist auf den Wortlaut.
 *
 * `werkzeuge` sind Registry-SCHLÜSSEL, nicht Pfade: die Freigabe (Status, Override, Rolle)
 * entscheidet `stab/werkzeuge.ts` zur Laufzeit. Höchstens drei je Zeile, damit die Zeile
 * im Fükw (≈ 1022 px Content) nicht umbricht.
 */
export interface SachgebietEintrag {
  sachgebiet: Sachgebiet;
  kuerzel: string;
  label: string;
  aufgaben: string;
  /** Seite in FwDV 100 Anlage 2. */
  seite: number;
  werkzeuge: readonly string[];
}

export const SACHGEBIETE: readonly SachgebietEintrag[] = [
  {
    sachgebiet: 's1',
    kuerzel: 'S1',
    label: 'Personal',
    aufgaben: 'Kräfte anfordern und nachalarmieren, Kräfteübersicht führen, Bereitstellungsräume einrichten',
    seite: 55,
    werkzeuge: ['personal', 'einheiten', 'bereitstellungsraeume'],
  },
  {
    sachgebiet: 's2',
    kuerzel: 'S2',
    label: 'Lage',
    aufgaben: 'Lage feststellen, Lagekarte und Einsatztagebuch führen, Lagebesprechungen vorbereiten',
    seite: 56,
    werkzeuge: ['lagekarte', 'lagemeldungen', 'etb'],
  },
  {
    sachgebiet: 's3',
    kuerzel: 'S3',
    label: 'Einsatz',
    aufgaben: 'Lage beurteilen, Abschnitte ordnen, Lagebesprechungen durchführen, Befehle erteilen',
    seite: 57,
    werkzeuge: ['einsatzabschnitte', 'auftraege', 'meldungen'],
  },
  {
    sachgebiet: 's4',
    kuerzel: 'S4',
    label: 'Versorgung',
    aufgaben: 'Einsatzmittel und Verbrauchsgüter anfordern, Verpflegung und Materialerhaltung',
    seite: 58,
    werkzeuge: ['nachforderungen', 'material', 'fahrzeuge'],
  },
  {
    sachgebiet: 's5',
    kuerzel: 'S5',
    label: 'Presse- und Medienarbeit',
    aufgaben: 'Presse- und Medienlage, Presseinformationen, Informationstelefone',
    seite: 59,
    werkzeuge: [],
  },
  {
    sachgebiet: 's6',
    kuerzel: 'S6',
    label: 'Information und Kommunikation',
    aufgaben: 'Fernmeldeorganisation mit S3 absprechen, Kanäle aufteilen, Funkplan führen',
    seite: 60,
    werkzeuge: ['einsatzabschnitte', 'chat'],
  },
];
```

- [ ] **Step 4: `stab/besetzung.ts` anlegen**

```ts
import type { BesetzungArt, BesetzungSetzen, Sachgebiet, Stab, Stabsfunktion } from '../api/types';
import type { StatusDarstellung } from '../theme/statusFarben';

/** „Nicht vergeben" ist KEIN Datensatz (keine Zeile vom Server), aber eine Wahl in der Maske. */
export type BesetzungWahl = BesetzungArt | 'nicht_vergeben';

export interface BesetzungFormWerte {
  art: BesetzungWahl;
  /** `EinsatzPersonal.id` (= `einsatz_personal.id`), nicht `EinsatzPersonal.personal_id`. */
  personal_id?: number;
  bezeichnung?: string;
}

/** Entscheidung 3 der Spec. „Nicht vergeben" steht auf ALLEN sechs Zeilen zur Wahl. */
export const BESETZUNG_OPTIONEN: readonly { value: BesetzungWahl; label: string }[] = [
  { value: 'nicht_vergeben', label: 'nicht vergeben' },
  { value: 'einsatzleitung', label: 'bei der Einsatzleitung' },
  { value: 'personal', label: 'disponierte Person' },
  { value: 'extern', label: 'extern (nicht disponiert)' },
  { value: 'rueckwaertig', label: 'rückwärtig (Leitstelle/FEZ)' },
];

export function zeileFuer(stab: Stab | undefined, sachgebiet: Sachgebiet): Stabsfunktion | undefined {
  return stab?.besetzung.find((z) => z.sachgebiet === sachgebiet);
}

/**
 * Besetzung als `StatusTag`-Darstellung. Durchweg `neutral`: „nicht vergeben" ist im Fükw der
 * Stufe B der Normalfall, keine Alarmfarbe (Entscheidung 3) — das Wort trägt die Aussage.
 */
export function besetzungDarstellung(zeile: Stabsfunktion | undefined): StatusDarstellung {
  if (!zeile) return { rolle: 'neutral', label: 'nicht vergeben' };
  switch (zeile.besetzung_art) {
    case 'einsatzleitung':
      return { rolle: 'neutral', label: 'Einsatzleitung' };
    case 'personal': {
      const name = zeile.name ?? 'Person';
      return {
        rolle: 'neutral',
        label: zeile.personal_noch_disponiert ? name : `${name} · nicht mehr disponiert`,
      };
    }
    case 'extern':
      return { rolle: 'neutral', label: `${zeile.name ?? ''} (extern)` };
    case 'rueckwaertig':
      return { rolle: 'neutral', label: `${zeile.name ?? ''} (rückwärtig)` };
  }
}

/** Vorbelegung der Maske mit dem AKTUELLEN Zustand (Spec 10). */
export function besetzungFormWerte(zeile: Stabsfunktion | undefined): BesetzungFormWerte {
  if (!zeile) return { art: 'nicht_vergeben' };
  switch (zeile.besetzung_art) {
    case 'einsatzleitung':
      return { art: 'einsatzleitung' };
    case 'personal':
      return zeile.personal_id != null
        ? { art: 'personal', personal_id: zeile.personal_id }
        : { art: 'personal' };
    case 'extern':
    case 'rueckwaertig':
      return { art: zeile.besetzung_art, bezeichnung: zeile.name ?? undefined };
  }
}

export type BesetzungAktion =
  | { typ: 'keine' }
  | { typ: 'entfernen' }
  | { typ: 'setzen'; daten: BesetzungSetzen };

/**
 * Was die Maske beim Übernehmen schickt — mit Wertgleichheits-Riegel.
 *
 * Unverändert → `keine` (kein Request): ein PUT mit gleichem Wert schriebe `gesetzt_at` neu
 * und feuerte ein Live-Ereignis, ein DELETE auf eine leere Zeile ist zwar 204, aber ein
 * Request für nichts. Geschickt wird NUR das Feld, das die Art verlangt — überzählige Felder
 * beantwortet das Backend mit 422, und die Maske lässt Werte eines vorher gewählten Zweigs im
 * Formularspeicher stehen.
 */
export function besetzungAktion(
  zeile: Stabsfunktion | undefined,
  werte: BesetzungFormWerte,
): BesetzungAktion {
  const vorher = besetzungFormWerte(zeile);
  const bezeichnung = werte.bezeichnung?.trim() || undefined;

  if (werte.art === 'nicht_vergeben') return zeile ? { typ: 'entfernen' } : { typ: 'keine' };

  if (werte.art === vorher.art) {
    if (werte.art === 'einsatzleitung') return { typ: 'keine' };
    if (werte.art === 'personal' && werte.personal_id === vorher.personal_id) return { typ: 'keine' };
    if (
      (werte.art === 'extern' || werte.art === 'rueckwaertig') &&
      bezeichnung === vorher.bezeichnung
    ) {
      return { typ: 'keine' };
    }
  }

  switch (werte.art) {
    case 'einsatzleitung':
      return { typ: 'setzen', daten: { besetzung_art: 'einsatzleitung' } };
    case 'personal':
      return { typ: 'setzen', daten: { besetzung_art: 'personal', personal_id: werte.personal_id } };
    case 'extern':
    case 'rueckwaertig':
      return { typ: 'setzen', daten: { besetzung_art: werte.art, bezeichnung } };
  }
}

/** Grund der fehlenden Schreibberechtigung als ganzer Satz (CLAUDE.md, LFH-345 · C10/M16). */
export function besetzungRechteText(einsatzStatus: string): string {
  return einsatzStatus !== 'aktiv'
    ? 'Der Einsatz ist abgeschlossen — die Führungsorganisation ist nur noch lesbar.'
    : 'Nur Einsatzleitung und Führungspersonal können die Besetzung ändern.';
}
```

- [ ] **Step 5: Tests grün**

Run: `rtk proxy mise exec pnpm@11.10.0 -- pnpm -C "$FE" exec vitest run src/stab`
Expected: PASS (alle Tests in `sachgebiete.test.ts` und `besetzung.test.ts`).
Falls ein Registry-Schlüssel aus `werkzeuge` nicht existiert: Schlüssel gegen `grep -n "key: '" src/einsatz/modulRegistry.ts` korrigieren, nicht den Test lockern.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/stab/sachgebiete.ts frontend/src/stab/sachgebiete.test.ts frontend/src/stab/besetzung.ts frontend/src/stab/besetzung.test.ts
git commit -m "feat(stab): Sachgebiete und Besetzungslogik mit Wertgleichheits-Riegel (LFH-542)"
```

---

### Task 3: Werkzeug-Filter und Zeilenziel-Stil

**Files:**
- Create: `frontend/src/stab/werkzeuge.ts`, `frontend/src/stab/werkzeuge.test.ts`
- Create: `frontend/src/stab/zeilenziel.ts`, `frontend/src/stab/zeilenziel.test.ts`

**Interfaces:**
- Consumes: `istModulFreigegeben`, `modulRegistry`, `type ModulEintrag` aus `einsatz/modulRegistry`; `BenutzerAnzeige`, `ModulOverrides` aus `api/types`; `dichten` aus `theme/tokens` (Test).
- Produces: `werkzeugeFuer(keys: readonly string[], benutzer: BenutzerAnzeige | null, overrides?: ModulOverrides, register?: ModulEintrag[]): ModulEintrag[]`; `stabZeilenzielStil(token: { controlHeight: number; paddingSM: number; padding: number }): CSSProperties`.

- [ ] **Step 1: Failing tests schreiben**

`frontend/src/stab/werkzeuge.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { TbHome } from 'react-icons/tb';
import type { BenutzerAnzeige, ModulOverrides } from '../api/types';
import type { ModulEintrag } from '../einsatz/modulRegistry';
import { werkzeugeFuer } from './werkzeuge';

/**
 * Registry-STUB statt der echten Registry (Muster `befehle.modulstatus.test.ts`): nach dem Flip
 * gibt es kein `wip`-Modul mehr, an dem sich der Status-Zweig beobachten ließe.
 */
const stub = (over: Partial<ModulEintrag>): ModulEintrag => ({
  key: 'x',
  kategorie: 'fuehrung',
  label: 'X',
  icon: TbHome,
  route: 'x',
  status: 'fertig',
  ...over,
});
const REGISTER = [
  stub({ key: 'fertig-a', label: 'A', route: 'a' }),
  stub({ key: 'unfertig', label: 'U', route: 'u', status: 'wip' }),
  stub({ key: 'nur-admin', label: 'N', route: 'n', benoetigteRolle: 'admin' }),
  stub({ key: 'fertig-b', label: 'B', route: 'b' }),
];
const nutzer = {
  id: 1,
  anzeigename: 'N',
  system_rolle: 'keiner',
  org_rolle: 'fuehrungskraft',
} as BenutzerAnzeige;

describe('werkzeugeFuer', () => {
  it('liefert freigegebene Module in der Reihenfolge der Schlüssel', () => {
    expect(werkzeugeFuer(['fertig-b', 'fertig-a'], nutzer, undefined, REGISTER).map((m) => m.key)).toEqual([
      'fertig-b',
      'fertig-a',
    ]);
  });

  it('lässt unfertige, rollen-gesperrte und unbekannte Module weg', () => {
    expect(
      werkzeugeFuer(['unfertig', 'nur-admin', 'gibt-es-nicht', 'fertig-a'], nutzer, undefined, REGISTER).map(
        (m) => m.key,
      ),
    ).toEqual(['fertig-a']);
  });

  it('lässt per Override ausgeblendete Module weg', () => {
    const overrides = { 'fertig-a': { sichtbar: false } } as unknown as ModulOverrides;
    expect(werkzeugeFuer(['fertig-a', 'fertig-b'], nutzer, overrides, REGISTER).map((m) => m.key)).toEqual([
      'fertig-b',
    ]);
  });
});
```

`frontend/src/stab/zeilenziel.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { dichten } from '../theme/tokens';
import { stabZeilenzielStil } from './zeilenziel';

/**
 * Ein `<a>` erbt KEINE Steuerhöhe (LFH-396: 17 px in jeder Stufe gemessen). Geprüft wird der
 * Inline-Stil der reinen Funktion über die Dichtestufen — `test/utils.tsx` montiert ein nacktes
 * `ConfigProvider`, jsdom rechnet kein Layout. Die Böden stehen als LITERALE da; aus dem Token
 * zurückgelesen prüften sie den Token gegen sich selbst.
 */
describe('stabZeilenzielStil', () => {
  const tokenFuer = (stufe: keyof typeof dichten) => ({
    controlHeight: dichten[stufe].zeilenhoehe,
    paddingSM: dichten[stufe].abstand.sm,
    padding: dichten[stufe].abstand.md,
  });

  it('trägt den Boden aus controlHeight — 30 / 48 / 72 px', () => {
    expect(stabZeilenzielStil(tokenFuer('kompakt')).minHeight).toBe(30);
    expect(stabZeilenzielStil(tokenFuer('komfortabel')).minHeight).toBe(48);
    expect(stabZeilenzielStil(tokenFuer('handschuh')).minHeight).toBe(72);
  });

  it('wächst über die Dichtestufen, statt auf einer Stufe zu kleben', () => {
    const h = (['kompakt', 'komfortabel', 'handschuh'] as const).map(
      (s) => stabZeilenzielStil(tokenFuer(s)).minHeight as number,
    );
    expect(h[0]).toBeLessThan(h[1]);
    expect(h[1]).toBeLessThan(h[2]);
  });

  it('trägt die ZWEITE Angabe (Polsterung) dichteabhängig mit (LFH-365)', () => {
    expect(stabZeilenzielStil(tokenFuer('kompakt')).padding).toBe('7px 11px');
    expect(stabZeilenzielStil(tokenFuer('handschuh')).padding).toBe('16px 26px');
  });

  it('steht inline in der Textzeile', () => {
    expect(stabZeilenzielStil(tokenFuer('kompakt')).display).toBe('inline-flex');
  });
});
```

- [ ] **Step 2: Tests rot sehen**

Run: `rtk proxy mise exec pnpm@11.10.0 -- pnpm -C "$FE" exec vitest run src/stab/werkzeuge.test.ts src/stab/zeilenziel.test.ts`
Expected: FAIL — Module fehlen.

- [ ] **Step 3: Implementieren**

`frontend/src/stab/werkzeuge.ts`:

```ts
import type { BenutzerAnzeige, ModulOverrides } from '../api/types';
import { istModulFreigegeben, modulRegistry, type ModulEintrag } from '../einsatz/modulRegistry';

/**
 * Die Werkzeugzeile einer Sachgebietszeile: Registry-Einträge zu den Schlüsseln, gefiltert über
 * DIE eine Freigabe-Frage (`istModulFreigegeben`: fertig · sichtbar · nicht gesperrt).
 *
 * Das Modul-Gate des Stabs deckt den eigenen Pfad, nicht die Nachbarn (Spec 11): ohne den
 * Filter zeigte die Seite Wege in ausgeblendete, gesperrte oder unfertige Module.
 */
export function werkzeugeFuer(
  keys: readonly string[],
  benutzer: BenutzerAnzeige | null,
  overrides?: ModulOverrides,
  register: ModulEintrag[] = modulRegistry,
): ModulEintrag[] {
  return keys
    .map((key) => register.find((m) => m.key === key))
    .filter((m): m is ModulEintrag => m != null && istModulFreigegeben(m, benutzer, overrides));
}
```

`frontend/src/stab/zeilenziel.ts`:

```ts
import type { CSSProperties } from 'react';

/**
 * Trefffläche der handgebauten Bedienziele der Stab-Seite (Werkzeug-Links; in ST5/ST6 auch
 * ETB-Link und Kennzahl-Deeplinks). Schablone `bedienzielStil` (`pages/lagekarte/Sidebar.tsx`),
 * aber `inline-flex`: die Links stehen in einer Textzeile.
 *
 * ZWEI Angaben, nicht eine (LFH-365): die Polsterung allein trägt den Boden nicht. Aufgelöste
 * Tokens aus `theme.useToken()`, nie `var(--lfh-*)`. Eigener Name, weil `zeilenzielStil` in
 * `pages/einstellungen/Anmeldeverfahren.tsx` schon exportiert ist (dort `display: 'flex'`).
 */
export function stabZeilenzielStil(token: {
  controlHeight: number;
  paddingSM: number;
  padding: number;
}): CSSProperties {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    minHeight: token.controlHeight,
    padding: `${token.paddingSM}px ${token.padding}px`,
  };
}
```

- [ ] **Step 4: Tests grün**

Run: `rtk proxy mise exec pnpm@11.10.0 -- pnpm -C "$FE" exec vitest run src/stab`
Expected: PASS.

- [ ] **Step 5: Mutationsprobe (nicht committen)**

In `zeilenziel.ts` `minHeight: token.controlHeight` durch `minHeight: 30` ersetzen → `zeilenziel.test.ts` muss in „30 / 48 / 72" und „wächst" rot werden. Zurückdrehen, Tests wieder grün.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/stab/werkzeuge.ts frontend/src/stab/werkzeuge.test.ts frontend/src/stab/zeilenziel.ts frontend/src/stab/zeilenziel.test.ts
git commit -m "feat(stab): Werkzeug-Filter und Trefffläche der Zeilenziele (LFH-542)"
```

---

### Task 4: Ad-hoc-Personenmaske als geteiltes Bauteil

**Files:**
- Create: `frontend/src/kraefte/AdhocPersonModal.tsx`, `frontend/src/kraefte/AdhocPersonModal.test.tsx`
- Modify: `frontend/src/pages/PersonalPage.tsx` (Zeilen ~91-93 `adhocOffen`/`form`, ~147-153 `adhocMutation`, ~602-644 Modal-Block)

**Interfaces:**
- Consumes: `ErfassungsModal` (`components/Erfassung`), `disponiereAdhoc`, `type AdhocEingabe` (`api/einsatzPersonal`), `POSITION_OPTIONEN` (`api/personal`), `Select` (`components/Select`), `einsatzKeys` (`api/queryKeys`), `ApiError` (`api/client`), `EinsatzPersonal` (`api/types`).
- Produces: `default function AdhocPersonModal(props: { offen: boolean; einsatzId: number; serie?: boolean; onSchliessen: () => void; onAngelegt?: (ep: EinsatzPersonal) => void })`.

Begründung: CLAUDE.md „Eine Erfassungsmaske ist ein Bauteil, kein Ort" (LFH-340 · C5) — zwei Kopien wären zwei Feldbudgets und zwei Stellen, an denen ein Feld fehlen kann.

- [ ] **Step 1: Failing test schreiben**

`frontend/src/kraefte/AdhocPersonModal.test.tsx`:

```tsx
import { http, HttpResponse } from 'msw';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import AdhocPersonModal from './AdhocPersonModal';

describe('AdhocPersonModal', () => {
  it('meldet die angelegte Disposition zurück und schliesst', async () => {
    let body: unknown;
    server.use(
      http.post('/api/einsaetze/1/personal', async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ id: 77, einsatz_id: 1, name: 'Dr. Schmidt' }, { status: 201 });
      }),
    );
    const onAngelegt = vi.fn();
    const onSchliessen = vi.fn();
    renderMitProviders(
      <AdhocPersonModal offen einsatzId={1} onSchliessen={onSchliessen} onAngelegt={onAngelegt} />,
    );

    await userEvent.type(await screen.findByLabelText('Name'), 'Dr. Schmidt');
    await userEvent.click(screen.getByRole('button', { name: 'Disponieren' }));

    await waitFor(() => expect(onAngelegt).toHaveBeenCalledWith(expect.objectContaining({ id: 77 })));
    expect(onSchliessen).toHaveBeenCalled();
    expect(body).toEqual({ adhoc: expect.objectContaining({ name: 'Dr. Schmidt' }) });
  });

  it('bietet „Speichern und nächste" nur im Serienmodus an', async () => {
    const { unmount } = renderMitProviders(
      <AdhocPersonModal offen einsatzId={1} onSchliessen={() => {}} />,
    );
    await screen.findByLabelText('Name');
    expect(screen.queryByRole('button', { name: 'Speichern und nächste' })).toBeNull();
    unmount();

    renderMitProviders(<AdhocPersonModal offen serie einsatzId={1} onSchliessen={() => {}} />);
    expect(await screen.findByRole('button', { name: 'Speichern und nächste' })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Test rot sehen**

Run: `rtk proxy mise exec pnpm@11.10.0 -- pnpm -C "$FE" exec vitest run src/kraefte/AdhocPersonModal.test.tsx`
Expected: FAIL — Modul fehlt.

- [ ] **Step 3: Bauteil anlegen**

`frontend/src/kraefte/AdhocPersonModal.tsx` (Felder und Kommentar wörtlich aus `PersonalPage.tsx` übernommen):

```tsx
import { App, Form, Input } from 'antd';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRef } from 'react';
import { ApiError } from '../api/client';
import { disponiereAdhoc, type AdhocEingabe } from '../api/einsatzPersonal';
import { POSITION_OPTIONEN } from '../api/personal';
import { einsatzKeys } from '../api/queryKeys';
import type { EinsatzPersonal } from '../api/types';
import { ErfassungsModal } from '../components/Erfassung';
import { Select } from '../components/Select';

interface AdhocPersonModalProps {
  offen: boolean;
  einsatzId: number;
  /** Serienmodus wie in der Personal-Liste; aus dem Stab heraus eine Einzelanlage. */
  serie?: boolean;
  onSchliessen: () => void;
  /** Die neu angelegte Disposition — z. B. zur Vorauswahl in einer aufrufenden Maske. */
  onAngelegt?: (ep: EinsatzPersonal) => void;
}

/**
 * Ad-hoc-Person disponieren — EIN Bauteil für zwei Orte (Personal-Liste, Stab-Besetzung).
 *
 * FELDBUDGET: vier Felder (Name, Funktion, Trägerorganisation, Stärke-Position), im Rahmen der
 * Modal-/Schnellerfassungs-Leitlinie (LFH-19: ≤ ~4). Name ist Pflicht, die anderen drei
 * unterscheiden eine ad-hoc erfasste Person von einer namenlosen Zeile.
 *
 * `onFertig` der Hülle gibt kein Ergebnis weiter; die angelegte Disposition wandert deshalb über
 * `onSuccess` in einen Ref und wird in `onErfasst` gemeldet — das läuft erst nach bestandener
 * Abbruchprüfung der Hülle.
 */
export default function AdhocPersonModal({
  offen,
  einsatzId,
  serie = false,
  onSchliessen,
  onAngelegt,
}: AdhocPersonModalProps) {
  const qc = useQueryClient();
  const { message } = App.useApp();
  const [form] = Form.useForm<AdhocEingabe>();
  const angelegtRef = useRef<EinsatzPersonal | null>(null);

  const mutation = useMutation({
    mutationFn: (daten: AdhocEingabe) => disponiereAdhoc(einsatzId, daten),
    onSuccess: (ep) => {
      angelegtRef.current = ep;
      void qc.invalidateQueries({ queryKey: einsatzKeys.personal(einsatzId) });
      void qc.invalidateQueries({ queryKey: einsatzKeys.etb(einsatzId) });
    },
    onError: (e: unknown) =>
      message.error(e instanceof ApiError ? e.message : 'Aktion fehlgeschlagen'),
  });

  return (
    <ErfassungsModal<AdhocEingabe>
      offen={offen}
      titel="Ad-hoc-Person disponieren"
      form={form}
      erfassenText="Disponieren"
      laeuft={mutation.isPending}
      serie={serie}
      uebernahme={serie ? ['traegerorganisation', 'staerke_position'] : undefined}
      onErfassen={(w) => mutation.mutateAsync(w)}
      onErfasst={() => {
        if (angelegtRef.current) onAngelegt?.(angelegtRef.current);
      }}
      onFertig={onSchliessen}
      onAbbrechen={onSchliessen}
    >
      <Form.Item label="Name" name="name" rules={[{ required: true, whitespace: true }]}>
        <Input placeholder="z. B. Dr. Schmidt" />
      </Form.Item>
      <Form.Item label="Funktion" name="funktion">
        <Input placeholder="z. B. Notarzt" />
      </Form.Item>
      <Form.Item label="Trägerorganisation" name="traegerorganisation">
        <Input placeholder="z. B. KV Musterstadt" />
      </Form.Item>
      <Form.Item label="Stärke-Position" name="staerke_position">
        <Select allowClear placeholder="optional" options={POSITION_OPTIONEN} />
      </Form.Item>
    </ErfassungsModal>
  );
}
```

- [ ] **Step 4: `PersonalPage` umstellen**

In `frontend/src/pages/PersonalPage.tsx`:
1. `const [form] = Form.useForm<AdhocEingabe>();` entfernen.
2. Den Block `const adhocMutation = useMutation({ … });` entfernen.
3. Den gesamten Block ab dem Kommentar über `<ErfassungsModal<AdhocEingabe>` bis einschließlich `</ErfassungsModal>` ersetzen durch:

```tsx
      <AdhocPersonModal
        offen={adhocOffen}
        einsatzId={einsatzId}
        serie
        onSchliessen={() => setAdhocOffen(false)}
      />
```

4. Import ergänzen: `import AdhocPersonModal from '../kraefte/AdhocPersonModal';`
5. Nun unbenutzte Importe entfernen, die `pnpm lint` meldet (erwartet: `ErfassungsModal`, `disponiereAdhoc`, `type AdhocEingabe`, ggf. `Form`/`Input` — nur entfernen, was der Linter wirklich als unbenutzt meldet; `POSITION_OPTIONEN` wird bei ~Zeile 413 weiter gebraucht).

- [ ] **Step 5: Tests grün, Bestand grün, Lint sauber**

Run: `rtk proxy mise exec pnpm@11.10.0 -- pnpm -C "$FE" exec vitest run src/kraefte/AdhocPersonModal.test.tsx src/pages/PersonalPage.test.tsx`
Expected: PASS (Bestandstests der Personal-Liste unverändert grün — sie belegen, dass Serienmodus und Übernahme erhalten sind).
Run: `rtk proxy mise exec pnpm@11.10.0 -- pnpm -C "$FE" lint`
Expected: 0 Warnungen, 0 Fehler.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/kraefte/AdhocPersonModal.tsx frontend/src/kraefte/AdhocPersonModal.test.tsx frontend/src/pages/PersonalPage.tsx
git commit -m "refactor(personal): Ad-hoc-Personenmaske als geteiltes Bauteil (LFH-542)"
```

---

### Task 5: Maske „Besetzung ändern"

**Files:**
- Create: `frontend/src/stab/BesetzungModal.tsx`, `frontend/src/stab/BesetzungModal.test.tsx`

**Interfaces:**
- Consumes: `SachgebietEintrag` (Task 2), `besetzungAktion`, `besetzungFormWerte`, `BESETZUNG_OPTIONEN`, `type BesetzungFormWerte`, `type BesetzungAktion` (Task 2), `setzeBesetzung`, `entferneBesetzung` (Task 1), `AdhocPersonModal` (Task 4), `listeEinsatzPersonal` (`api/einsatzPersonal`), `einsatzKeys` (`api/queryKeys`), `ErfassungsModal`, `Select`.
- Produces: `default function BesetzungModal(props: { einsatzId: number; eintrag: SachgebietEintrag; zeile: Stabsfunktion | undefined; onSchliessen: () => void })`. Die Seite montiert es **nur solange offen** und mit `key={eintrag.sachgebiet}` — damit ist jede Öffnung ein frischer Formularspeicher (CLAUDE.md, Erfassungs-Norm: der rc-field-form-Store überlebt `destroyOnHidden` und schlüge `initialValues`).

- [ ] **Step 1: Failing tests schreiben**

`frontend/src/stab/BesetzungModal.test.tsx`:

```tsx
import { http, HttpResponse } from 'msw';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Stabsfunktion } from '../api/types';
import { server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import BesetzungModal from './BesetzungModal';
import { SACHGEBIETE } from './sachgebiete';

const S2 = SACHGEBIETE[1];
const personal = [
  { id: 99, einsatz_id: 1, name: 'Schulz', funktion: 'Sanitäter' },
  { id: 7, einsatz_id: 1, name: 'Müller', funktion: 'Zugführer' },
];

let puts: unknown[];
let deletes: number;
beforeEach(() => {
  puts = [];
  deletes = 0;
  server.use(
    http.get('/api/einsaetze/1/personal', () => HttpResponse.json(personal)),
    http.put('/api/einsaetze/1/stab/besetzung/s2', async ({ request }) => {
      puts.push(await request.json());
      return HttpResponse.json({ anzahl_lagebesprechungen: 0, besetzung: [] });
    }),
    http.delete('/api/einsaetze/1/stab/besetzung/s2', () => {
      deletes += 1;
      return new HttpResponse(null, { status: 204 });
    }),
  );
});

function rendere(zeile: Stabsfunktion | undefined, onSchliessen = vi.fn()) {
  renderMitProviders(
    <BesetzungModal einsatzId={1} eintrag={S2} zeile={zeile} onSchliessen={onSchliessen} />,
  );
  return onSchliessen;
}

/** Offene Liste greifen, nicht die Portale geschlossener Dropdowns (antd lässt sie stehen). */
async function waehle(feld: string, option: string) {
  await userEvent.click(screen.getByRole('combobox', { name: feld }));
  const knoten = await waitFor(() => {
    const k = document.querySelector<HTMLElement>(
      `.ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option[title="${option}"]`,
    );
    expect(k).not.toBeNull();
    return k!;
  });
  await userEvent.click(knoten);
}

describe('BesetzungModal', () => {
  /**
   * Das erste Feld ist ein Select — „Enter sendet" ist für diese Maske nicht belegbar
   * (rc-select verschluckt Enter). Geprüft wird die Struktur, aus der die Zusicherung folgt.
   */
  it('trägt die Erfassungs-Norm: keine Modal-Fusszeile, Knopf im <form>', async () => {
    rendere(undefined);
    const knopf = await screen.findByRole('button', { name: 'Übernehmen' });
    expect(document.querySelector('.ant-modal-footer')).toBeNull();
    expect(knopf.closest('form')).not.toBeNull();
    expect(screen.getByRole('dialog', { name: 'Besetzung S2 · Lage' })).toBeInTheDocument();
  });

  it('leere Zeile, „nicht vergeben" bestätigt → 0 Requests, kein Fehler, Maske schliesst', async () => {
    const onSchliessen = rendere(undefined);
    await userEvent.click(await screen.findByRole('button', { name: 'Übernehmen' }));
    await waitFor(() => expect(onSchliessen).toHaveBeenCalled());
    expect(puts).toEqual([]);
    expect(deletes).toBe(0);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('leere Zeile, Person gewählt → genau ein PUT mit der Dispositions-ID', async () => {
    const onSchliessen = rendere(undefined);
    await screen.findByRole('button', { name: 'Übernehmen' });
    await waehle('Besetzung', 'disponierte Person');
    await waehle('Person', 'Schulz');
    await userEvent.click(screen.getByRole('button', { name: 'Übernehmen' }));
    await waitFor(() => expect(onSchliessen).toHaveBeenCalled());
    expect(puts).toEqual([{ besetzung_art: 'personal', personal_id: 99 }]);
    expect(deletes).toBe(0);
  });

  it('belegte Zeile, „nicht vergeben" → genau ein DELETE', async () => {
    const zeile: Stabsfunktion = {
      sachgebiet: 's2',
      besetzung_art: 'personal',
      personal_id: 7,
      name: 'Müller',
      personal_noch_disponiert: true,
      gesetzt_at: '2026-09-13 10:00:00',
      gesetzt_von_id: 1,
    };
    const onSchliessen = rendere(zeile);
    await screen.findByRole('button', { name: 'Übernehmen' });
    await waehle('Besetzung', 'nicht vergeben');
    await userEvent.click(screen.getByRole('button', { name: 'Übernehmen' }));
    await waitFor(() => expect(onSchliessen).toHaveBeenCalled());
    expect(deletes).toBe(1);
    expect(puts).toEqual([]);
  });

  it('extern verlangt eine Bezeichnung und schickt nur sie', async () => {
    const onSchliessen = rendere(undefined);
    await screen.findByRole('button', { name: 'Übernehmen' });
    await waehle('Besetzung', 'extern (nicht disponiert)');
    await userEvent.type(screen.getByLabelText('Bezeichnung'), 'Dr. Weber');
    await userEvent.click(screen.getByRole('button', { name: 'Übernehmen' }));
    await waitFor(() => expect(onSchliessen).toHaveBeenCalled());
    expect(puts).toEqual([{ besetzung_art: 'extern', bezeichnung: 'Dr. Weber' }]);
  });

  it('bietet die Ad-hoc-Anlage als letzten Eintrag der Personenwahl an', async () => {
    rendere(undefined);
    await screen.findByRole('button', { name: 'Übernehmen' });
    await waehle('Besetzung', 'disponierte Person');
    await waehle('Person', 'Ad-hoc-Person anlegen …');
    expect(await screen.findByRole('dialog', { name: 'Ad-hoc-Person disponieren' })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Tests rot sehen**

Run: `rtk proxy mise exec pnpm@11.10.0 -- pnpm -C "$FE" exec vitest run src/stab/BesetzungModal.test.tsx`
Expected: FAIL — Modul fehlt.

- [ ] **Step 3: Maske implementieren**

`frontend/src/stab/BesetzungModal.tsx`:

```tsx
import { Form, Input } from 'antd';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { listeEinsatzPersonal } from '../api/einsatzPersonal';
import { einsatzKeys } from '../api/queryKeys';
import { entferneBesetzung, setzeBesetzung } from '../api/stab';
import type { EinsatzPersonal, Stabsfunktion } from '../api/types';
import { ErfassungsModal } from '../components/Erfassung';
import { Select } from '../components/Select';
import { SpeicherFehler } from '../components/SpeicherHinweis';
import AdhocPersonModal from '../kraefte/AdhocPersonModal';
import {
  BESETZUNG_OPTIONEN,
  besetzungAktion,
  besetzungFormWerte,
  type BesetzungAktion,
  type BesetzungFormWerte,
} from './besetzung';
import type { SachgebietEintrag } from './sachgebiete';

/** Wert des letzten Personen-Eintrags; keine gültige `einsatz_personal.id` (positiv). */
const ADHOC = -1;

interface BesetzungModalProps {
  einsatzId: number;
  eintrag: SachgebietEintrag;
  zeile: Stabsfunktion | undefined;
  onSchliessen: () => void;
}

/**
 * „Besetzung ändern" — zwei Felder: Art und je nach Art Person oder Bezeichnung (Spec 10).
 *
 * Die Seite montiert die Maske nur, solange sie offen ist, mit `key={sachgebiet}`: jede Öffnung
 * bekommt einen frischen Formularspeicher, `initialValues` ist also wirklich der aktuelle
 * Zustand (der rc-field-form-Store überlebte sonst das Schliessen, Erfassungs-Norm B4).
 *
 * Umkehrbar (erneut setzen) → keine Rückfrage. Kein Serienmodus — Einzelvorgang.
 */
export default function BesetzungModal({ einsatzId, eintrag, zeile, onSchliessen }: BesetzungModalProps) {
  const qc = useQueryClient();
  const [form] = Form.useForm<BesetzungFormWerte>();
  const art = Form.useWatch('art', form);
  const [adhocOffen, setAdhocOffen] = useState(false);
  // Bis die Invalidierung die Personalliste nachlädt, stünde im Select sonst die rohe ID.
  const [angelegt, setAngelegt] = useState<EinsatzPersonal | null>(null);

  const personalQuery = useQuery({
    queryKey: einsatzKeys.personal(einsatzId),
    queryFn: () => listeEinsatzPersonal(einsatzId),
  });

  const personenOptionen = useMemo(() => {
    const liste = personalQuery.data ?? [];
    const mitAngelegt =
      angelegt && !liste.some((p) => p.id === angelegt.id) ? [...liste, angelegt] : liste;
    return [
      ...mitAngelegt.map((p) => ({ value: p.id, label: p.name })),
      { value: ADHOC, label: 'Ad-hoc-Person anlegen …' },
    ];
  }, [personalQuery.data, angelegt]);

  const mutation = useMutation({
    mutationFn: async (aktion: BesetzungAktion) => {
      if (aktion.typ === 'entfernen') await entferneBesetzung(einsatzId, eintrag.sachgebiet);
      if (aktion.typ === 'setzen') await setzeBesetzung(einsatzId, eintrag.sachgebiet, aktion.daten);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: einsatzKeys.stab(einsatzId) }),
  });

  return (
    <>
      <ErfassungsModal<BesetzungFormWerte>
        offen
        titel={`Besetzung ${eintrag.kuerzel} · ${eintrag.label}`}
        form={form}
        initialValues={besetzungFormWerte(zeile)}
        erfassenText="Übernehmen"
        laeuft={mutation.isPending}
        onErfassen={async (werte) => {
          const aktion = besetzungAktion(zeile, werte);
          if (aktion.typ !== 'keine') await mutation.mutateAsync(aktion);
        }}
        onFertig={onSchliessen}
        onAbbrechen={onSchliessen}
      >
        <Form.Item label="Besetzung" name="art" rules={[{ required: true }]}>
          <Select options={[...BESETZUNG_OPTIONEN]} />
        </Form.Item>
        {art === 'personal' && (
          <Form.Item label="Person" name="personal_id" rules={[{ required: true, message: 'Person wählen' }]}>
            <Select
              placeholder="disponierte Person"
              options={personenOptionen}
              loading={personalQuery.isLoading}
              onChange={(wert) => {
                if (wert === ADHOC) {
                  form.setFieldValue('personal_id', undefined);
                  setAdhocOffen(true);
                }
              }}
            />
          </Form.Item>
        )}
        {(art === 'extern' || art === 'rueckwaertig') && (
          <Form.Item
            label="Bezeichnung"
            name="bezeichnung"
            rules={[
              { required: true, whitespace: true, message: 'Bezeichnung angeben' },
              { max: 200, message: 'Höchstens 200 Zeichen' },
            ]}
          >
            <Input placeholder={art === 'extern' ? 'Name' : 'z. B. Leitstelle'} />
          </Form.Item>
        )}
        {/* Ein abgelehnter PUT/DELETE (409 abgeschlossen, 422) steht IN der Maske, nicht nur
            im Toast; die Hülle lässt die Felder stehen, weil `mutateAsync` ablehnt. Ohne
            Fehler rendert das Primitiv nichts. */}
        <SpeicherFehler fehler={mutation.error} />
      </ErfassungsModal>
      <AdhocPersonModal
        offen={adhocOffen}
        einsatzId={einsatzId}
        onSchliessen={() => setAdhocOffen(false)}
        onAngelegt={(ep) => {
          setAngelegt(ep);
          form.setFieldValue('personal_id', ep.id);
        }}
      />
    </>
  );
}
```

- [ ] **Step 4: Tests grün**

Run: `rtk proxy mise exec pnpm@11.10.0 -- pnpm -C "$FE" exec vitest run src/stab/BesetzungModal.test.tsx`
Expected: PASS.
Falls `getByRole('dialog', { name })` den Titel nicht als Namen findet: auf `within(document.querySelector('.ant-modal')!)` + `getByText('Besetzung S2 · Lage')` umstellen — die Aussage (richtiger Titel) bleibt, nur der Griff ändert sich.

- [ ] **Step 5: Mutationsprobe Riegel (nicht committen)**

In `onErfassen` die Bedingung `if (aktion.typ !== 'keine')` entfernen und stattdessen immer `setzeBesetzung(einsatzId, eintrag.sachgebiet, { besetzung_art: 'einsatzleitung' })` schicken → der Test „0 Requests" muss rot werden. Zurückdrehen.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/stab/BesetzungModal.tsx frontend/src/stab/BesetzungModal.test.tsx
git commit -m "feat(stab): Maske „Besetzung ändern“ mit Ad-hoc-Anlage (LFH-542)"
```

---

### Task 6: Stab-Seite, Route und Freischaltung

**Files:**
- Create: `frontend/src/pages/StabPage.tsx`, `frontend/src/pages/StabPage.test.tsx`
- Modify: `frontend/src/App.tsx` (Import neben `SchaedenPage`, Eintrag in `MODUL_ELEMENTE`)
- Modify: `frontend/src/einsatz/modulRegistry.ts:96-104`

**Interfaces:**
- Consumes: alles aus Task 1–5; `EinsatzSeite`, `SektionHeader`, `Liste`/`ListenEintrag`/`ListenEintragMeta`, `StatusTag`, `RechteHinweis`, `SeitenFehler`/`SeitenSkeleton`/`SeitenStandVeraltet`; `ladeEinsatz`, `ladeModulOverrides` (`api/einsaetze`); `einsatzModulPfad` (`routing/deeplinks`); `modulZielRoute` (`einsatz/modulRegistry`); `einsatzStatus` (`theme/statusFarben`).
- Produces: `default function StabPage()`; Markierungen, auf die ST5/ST6/ST9 bauen: `<section aria-label="Besetzung S1–S6">`, Aktionsknopf-Name `Besetzung ändern – <Kürzel> <Label>`, Werkzeug-Gruppe `aria-label="Werkzeuge <Kürzel>"`.

- [ ] **Step 1: Failing tests schreiben**

`frontend/src/pages/StabPage.test.tsx`:

```tsx
import { http, HttpResponse } from 'msw';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Route, Routes } from 'react-router';
import { server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import { modulRegistry } from '../einsatz/modulRegistry';
import StabPage from './StabPage';

class FakeEventSource {
  addEventListener() {}
  removeEventListener() {}
  close() {}
}
beforeEach(() => vi.stubGlobal('EventSource', FakeEventSource));
afterEach(() => vi.unstubAllGlobals());

const nutzer = { id: 1, anzeigename: 'Nutzer', system_rolle: 'keiner', org_rolle: 'fuehrungskraft' };
const einsatz = (over: object = {}) => ({
  id: 1,
  bezeichnung: 'Lage',
  status: 'aktiv',
  meine_rolle: 'einsatzleitung',
  meine_sachgebiete: [],
  org_id: 5,
  ...over,
});
const leererStab = { anzahl_lagebesprechungen: 0, besetzung: [] };
const label = (key: string) => modulRegistry.find((m) => m.key === key)!.label;

function rendere({
  einsatzObj = einsatz(),
  stab = leererStab as object,
  stabStatus = 200,
  overrides = {} as object,
} = {}) {
  server.use(
    http.get('/api/auth/me', () => HttpResponse.json(nutzer)),
    http.get('/api/einsaetze/1', () => HttpResponse.json(einsatzObj)),
    http.get('/api/einsaetze/1/stab', () =>
      stabStatus === 200
        ? HttpResponse.json(stab)
        : HttpResponse.json({ error: 'kaputt' }, { status: stabStatus }),
    ),
    http.get('/api/einsaetze/1/modul-overrides', () => HttpResponse.json(overrides)),
    http.get('/api/einsaetze/1/personal', () => HttpResponse.json([])),
  );
  return renderMitProviders(
    <Routes>
      <Route path="/einsaetze/:id/stab" element={<StabPage />} />
    </Routes>,
    { route: '/einsaetze/1/stab' },
  );
}

async function besetzungsSektion() {
  return screen.findByRole('region', { name: 'Besetzung S1–S6' });
}

describe('StabPage', () => {
  it('zeigt sechs feste Zeilen auch ohne jede Besetzung', async () => {
    rendere();
    const sektion = await besetzungsSektion();
    await waitFor(() =>
      expect(within(sektion).getAllByRole('heading', { level: 4 }).map((h) => h.textContent)).toEqual([
        expect.stringContaining('S1 · Personal'),
        expect.stringContaining('S2 · Lage'),
        expect.stringContaining('S3 · Einsatz'),
        expect.stringContaining('S4 · Versorgung'),
        expect.stringContaining('S5 · Presse- und Medienarbeit'),
        expect.stringContaining('S6 · Information und Kommunikation'),
      ]),
    );
    expect(within(sektion).getAllByText('nicht vergeben')).toHaveLength(6);
  });

  it('nennt die Besetzung beim Wort', async () => {
    rendere({
      stab: {
        anzahl_lagebesprechungen: 0,
        besetzung: [
          {
            sachgebiet: 's2',
            besetzung_art: 'personal',
            personal_id: 99,
            name: 'Müller',
            personal_noch_disponiert: true,
            gesetzt_at: '2026-09-13 10:00:00',
            gesetzt_von_id: 1,
          },
        ],
      },
    });
    const sektion = await besetzungsSektion();
    expect(await within(sektion).findByText('Müller')).toBeInTheDocument();
    expect(within(sektion).getAllByText('nicht vergeben')).toHaveLength(5);
  });

  describe('Rechte-Paar', () => {
    it('mit Schreibrecht: je Zeile „Besetzung ändern", kein Rechte-Hinweis', async () => {
      rendere();
      const sektion = await besetzungsSektion();
      await waitFor(() =>
        expect(within(sektion).getAllByRole('button', { name: /^Besetzung ändern – S\d/ })).toHaveLength(6),
      );
      expect(screen.queryByText(/können die Besetzung ändern/)).toBeNull();
    });

    it('als Beobachter: keine Zeilenaktion, der Grund steht auf der Seite', async () => {
      rendere({ einsatzObj: einsatz({ meine_rolle: 'beobachter' }) });
      const sektion = await besetzungsSektion();
      expect(await screen.findByText(/Nur Einsatzleitung und Führungspersonal/)).toBeInTheDocument();
      expect(within(sektion).queryAllByRole('button', { name: /^Besetzung ändern/ })).toHaveLength(0);
    });

    it('im abgeschlossenen Einsatz: keine Zeilenaktion, Hinweis nennt den Abschluss', async () => {
      rendere({ einsatzObj: einsatz({ status: 'abgeschlossen' }) });
      await besetzungsSektion();
      expect(await screen.findByText(/Der Einsatz ist abgeschlossen/)).toBeInTheDocument();
      expect(screen.queryAllByRole('button', { name: /^Besetzung ändern/ })).toHaveLength(0);
    });
  });

  it('behauptet während des Ladens keine Besetzung', async () => {
    server.use(
      http.get('/api/auth/me', () => HttpResponse.json(nutzer)),
      http.get('/api/einsaetze/1', () => HttpResponse.json(einsatz())),
      // Antwort bleibt aus: der Abruf steht dauerhaft auf „lädt".
      http.get('/api/einsaetze/1/stab', () => new Promise<never>(() => {})),
      http.get('/api/einsaetze/1/modul-overrides', () => HttpResponse.json({})),
    );
    renderMitProviders(
      <Routes>
        <Route path="/einsaetze/:id/stab" element={<StabPage />} />
      </Routes>,
      { route: '/einsaetze/1/stab' },
    );
    const sektion = await besetzungsSektion();
    expect(within(sektion).getAllByRole('heading', { level: 4 })).toHaveLength(6);
    expect(within(sektion).queryByText('nicht vergeben')).toBeNull();
  });

  it('Fehler ist nicht leer: ein gescheiterter Abruf behauptet keine sechs leeren Zeilen', async () => {
    rendere({ stabStatus: 500 });
    expect(await screen.findByText('Führungsorganisation konnte nicht geladen werden')).toBeInTheDocument();
    expect(screen.queryByText('nicht vergeben')).toBeNull();
  });

  it('Werkzeug-Links zeigen nur freigegebene Module', async () => {
    rendere({ overrides: { chat: { sichtbar: false } } });
    await besetzungsSektion();
    const s4 = await screen.findByRole('group', { name: 'Werkzeuge S4' });
    expect(within(s4).getByRole('link', { name: label('nachforderungen') })).toHaveAttribute(
      'href',
      '/einsaetze/1/nachforderungen',
    );
    const s6 = screen.getByRole('group', { name: 'Werkzeuge S6' });
    expect(within(s6).queryByRole('link', { name: label('chat') })).toBeNull();
    expect(within(s6).getByRole('link', { name: label('einsatzabschnitte') })).toBeInTheDocument();
  });

  it('„Besetzung ändern" öffnet die Maske der Zeile', async () => {
    rendere();
    const sektion = await besetzungsSektion();
    const knopf = await within(sektion).findByRole('button', { name: 'Besetzung ändern – S4 Versorgung' });
    await userEvent.click(knopf);
    expect(await screen.findByText('Besetzung S4 · Versorgung')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Tests rot sehen**

Run: `rtk proxy mise exec pnpm@11.10.0 -- pnpm -C "$FE" exec vitest run src/pages/StabPage.test.tsx`
Expected: FAIL — Modul `./StabPage` fehlt.

- [ ] **Step 3: Seite implementieren**

`frontend/src/pages/StabPage.tsx`:

```tsx
import { Breadcrumb, Button, Flex, Space, Typography, theme } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { ladeEinsatz, ladeModulOverrides } from '../api/einsaetze';
import { einsatzKeys } from '../api/queryKeys';
import { ladeStab } from '../api/stab';
import type { Sachgebiet } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import EinsatzSeite from '../components/EinsatzSeite';
import { Liste, ListenEintrag, ListenEintragMeta } from '../components/Liste';
import SektionHeader from '../components/SektionHeader';
import { RechteHinweis } from '../components/SpeicherHinweis';
import { SeitenFehler, SeitenSkeleton, SeitenStandVeraltet } from '../components/SeitenZustand';
import StatusTag from '../components/StatusTag';
import { modulZielRoute } from '../einsatz/modulRegistry';
import { darfImEinsatzSchreiben } from '../einsatz/schreibrecht';
import { einsatzModulPfad } from '../routing/deeplinks';
import BesetzungModal from '../stab/BesetzungModal';
import { besetzungDarstellung, besetzungRechteText, zeileFuer } from '../stab/besetzung';
import { SACHGEBIETE } from '../stab/sachgebiete';
import { werkzeugeFuer } from '../stab/werkzeuge';
import { stabZeilenzielStil } from '../stab/zeilenziel';
import { einsatzStatus } from '../theme/statusFarben';

/**
 * Modul „Stab" (LFH-46): Führungsorganisation S1–S6 als sechs feste Zeilen.
 *
 * UI-Form (Spec Entscheidung 16): eine Vollseite, eine `Liste` — hier wird nichts verglichen,
 * sortiert oder gefiltert (LFH-330/B2), also keine Tabelle. Die Zeile selbst ist kein Klickziel;
 * genau eine Aktion „Besetzung ändern" je Zeile, ohne Schreibrecht entfällt sie und ein Satz
 * nennt den Grund (LFH-346 · C11). Die Kopfaktion „Lagebesprechung abschließen" und die
 * Lagebesprechungs-Sektion folgen in ST5 (LFH-543), die Lücken-Kennzahlen in ST6 (LFH-544).
 *
 * Live: das `stab`-Ereignis invalidiert `einsatz-stab` über den Einsatz-Stream (Bestand).
 */
export default function StabPage() {
  const { id } = useParams();
  const einsatzId = Number(id);
  const { benutzer } = useAuth();
  const { token } = theme.useToken();
  const [offenFuer, setOffenFuer] = useState<Sachgebiet | null>(null);

  const einsatzQuery = useQuery({
    queryKey: einsatzKeys.einsatz(einsatzId),
    queryFn: () => ladeEinsatz(einsatzId),
  });
  const stabQuery = useQuery({
    queryKey: einsatzKeys.stab(einsatzId),
    queryFn: () => ladeStab(einsatzId),
  });
  const overridesQuery = useQuery({
    queryKey: einsatzKeys.modulOverrides(einsatzId),
    queryFn: () => ladeModulOverrides(einsatzId),
  });

  if (einsatzQuery.isLoading) return <SeitenSkeleton />;
  if (einsatzQuery.isError || !einsatzQuery.data) {
    return (
      <SeitenFehler
        text="Einsatz nicht gefunden oder kein Zugriff"
        ursache={einsatzQuery.error}
        onWiederholen={() => void einsatzQuery.refetch()}
      />
    );
  }
  const einsatz = einsatzQuery.data;
  const darfSchreiben = darfImEinsatzSchreiben(einsatz, benutzer);

  // Fehler ≠ leer (LFH-331 · B3): ohne Daten tritt der Fehler an die Stelle der Liste — sechs
  // „nicht vergeben" wären sonst eine Aussage über eine Menge, die nie ankam.
  const stabGescheitert = stabQuery.isError && !stabQuery.data;
  const standVeraltet = stabQuery.isError && stabQuery.data != null;
  const offenerEintrag = SACHGEBIETE.find((s) => s.sachgebiet === offenFuer);

  return (
    <EinsatzSeite
      dataUpdatedAt={stabQuery.dataUpdatedAt}
      titel={
        <Space>
          Stab
          <StatusTag darstellung={einsatzStatus[einsatz.status]} />
        </Space>
      }
      beschreibung="Führungsorganisation (S1–S6) und Lagebesprechungen der Einsatzleitung"
      breadcrumb={
        <Breadcrumb
          items={[
            { title: <Link to="/einsaetze">Einsätze</Link> },
            { title: einsatz.bezeichnung },
            { title: 'Stab' },
          ]}
        />
      }
      // Bedingt übergeben, nicht über `sichtbar` allein: `EinsatzSeite` rendert den Slot, sobald
      // er truthy ist — ein JSX-Element ist das immer, auch wenn es `null` zurückgibt, und
      // hinterliesse mit Schreibrecht ein leeres `div` mit Aussenabstand (Muster `SchaedenPage`).
      hinweis={
        !darfSchreiben && <RechteHinweis sichtbar text={besetzungRechteText(einsatz.status)} />
      }
    >
      <SektionHeader titel="Besetzung S1–S6" />
      <section aria-label="Besetzung S1–S6">
        {stabGescheitert ? (
          <SeitenFehler
            text="Führungsorganisation konnte nicht geladen werden"
            ursache={stabQuery.error}
            onWiederholen={() => void stabQuery.refetch()}
          />
        ) : (
          <>
            {standVeraltet && <SeitenStandVeraltet onWiederholen={() => void stabQuery.refetch()} />}
            <Liste
              dataSource={SACHGEBIETE}
              rowKey={(s) => s.sachgebiet}
              loading={stabQuery.isLoading}
              renderItem={(s) => {
                const zeile = zeileFuer(stabQuery.data, s.sachgebiet);
                const werkzeuge = werkzeugeFuer(s.werkzeuge, benutzer, overridesQuery.data);
                return (
                  <ListenEintrag
                    actions={
                      darfSchreiben
                        ? [
                            <Button
                              key="aendern"
                              aria-label={`Besetzung ändern – ${s.kuerzel} ${s.label}`}
                              onClick={() => setOffenFuer(s.sachgebiet)}
                            >
                              Besetzung ändern
                            </Button>,
                          ]
                        : undefined
                    }
                  >
                    <ListenEintragMeta
                      title={
                        <Space wrap>
                          {`${s.kuerzel} · ${s.label}`}
                          {/* Solange nichts angekommen ist, wird nichts über die Besetzung
                              behauptet (LFH-331 · B3/D4) — „nicht vergeben" vor dem Laden wäre
                              eine Aussage über eine Menge, die noch gar nicht da ist. */}
                          {stabQuery.data && <StatusTag darstellung={besetzungDarstellung(zeile)} />}
                        </Space>
                      }
                      description={
                        <Flex vertical gap={token.marginXXS}>
                          <span>
                            {s.aufgaben}{' '}
                            <Typography.Text type="secondary">
                              (FwDV 100 Anl. 2, S. {s.seite})
                            </Typography.Text>
                          </span>
                          {werkzeuge.length > 0 && (
                            <Flex wrap role="group" aria-label={`Werkzeuge ${s.kuerzel}`}>
                              {werkzeuge.map((m) => (
                                <Link
                                  key={m.key}
                                  to={einsatzModulPfad(einsatzId, modulZielRoute(m))}
                                  style={stabZeilenzielStil(token)}
                                >
                                  {m.label}
                                </Link>
                              ))}
                            </Flex>
                          )}
                        </Flex>
                      }
                    />
                  </ListenEintrag>
                );
              }}
            />
          </>
        )}
      </section>
      {offenerEintrag && darfSchreiben && (
        <BesetzungModal
          key={offenerEintrag.sachgebiet}
          einsatzId={einsatzId}
          eintrag={offenerEintrag}
          zeile={zeileFuer(stabQuery.data, offenerEintrag.sachgebiet)}
          onSchliessen={() => setOffenFuer(null)}
        />
      )}
    </EinsatzSeite>
  );
}
```

- [ ] **Step 4: Tests grün**

Run: `rtk proxy mise exec pnpm@11.10.0 -- pnpm -C "$FE" exec vitest run src/pages/StabPage.test.tsx`
Expected: PASS.
Hinweis: `SektionHeader` rendert eine `level 5`-Überschrift **außerhalb** der `section`, die `EinsatzSeite`-Überschrift ist `level 4` ebenfalls außerhalb — deshalb zählt der Test die `level 4`-Überschriften **innerhalb** der Region. Wenn `SektionHeader` doch `h4` rendert, bleibt die Zählung trotzdem korrekt, weil sie außerhalb steht.

- [ ] **Step 5: Route und Freischaltung**

`frontend/src/App.tsx`: neben `import SchaedenPage from './pages/SchaedenPage';` einfügen `import StabPage from './pages/StabPage';` und in `MODUL_ELEMENTE` nach `einsatzabschnitte: <EinsatzabschnittePage />,` einfügen `stab: <StabPage />,`.

`frontend/src/einsatz/modulRegistry.ts`, Eintrag `stab`:

```ts
  {
    key: 'stab',
    kategorie: 'fuehrung',
    label: 'Stab',
    icon: TbBuildingCommunity,
    route: 'stab',
    status: 'fertig',
    beschreibung: 'Führungsorganisation (S1–S6) und Lagebesprechungen der Einsatzleitung',
  },
```

- [ ] **Step 6: Volle Frontend-Gates**

Run: `rtk proxy mise exec pnpm@11.10.0 -- pnpm -C "$FE" lint`
Expected: 0 Warnungen, 0 Fehler.
Run: `rtk proxy mise exec pnpm@11.10.0 -- pnpm -C "$FE" exec vitest run`
Expected: alle grün, insbesondere `App.test.tsx`, `ModulStub.test.tsx`, `modulRegistry.test.ts` (ST3 hat sie vom `stab`-Eintrag gelöst), `dichte.guard.test.ts`, `statusVertrag.guard.test.ts`, `queryKeys.guard.test.ts`, `dateinamen.guard.test.ts`, `schreibrecht.guard.test.ts`.
Run: `rtk proxy ./scripts/check-typ-codegen.sh` (vom Repo-Root; enthält `tsc`)
Expected: kein Drift, `tsc` sauber.
Run: `rtk proxy mise exec pnpm@11.10.0 -- pnpm -C "$FE" exec prettier --check src`
Expected: sauber (sonst `--write` zweimal laufen lassen, Prettier ist nicht idempotent).

- [ ] **Step 7: Commit**

```bash
git add frontend/src/pages/StabPage.tsx frontend/src/pages/StabPage.test.tsx frontend/src/App.tsx frontend/src/einsatz/modulRegistry.ts
git commit -m "feat(stab): Stab-Seite mit Besetzung S1–S6, Modul freigeschaltet (LFH-542)"
```

---

## Self-Review (erledigt beim Schreiben)

- **AK-Abdeckung LFH-542:** Strukturtest der Maske → Task 5 · Rechte-Paar → Task 6 (Zeilenaktion, Abweichung 1) · sechs Zeilen ohne Daten → Task 6 · Deeplink-Filter gegen gesperrte/unfertige Module → Task 3 (Registry-Stub) + Task 6 (Override) · Fehler ≠ leer → Task 6 · Riegel-Paar 0 Requests / genau ein PUT → Task 5 · `zeilenzielStil` über Dichtestufen mit Literal-Böden → Task 3 · kein `size="small"`/Emoji/Drawer → Global Constraints, Guard in Task 6 Step 6.
- **Nicht in ST4:** Kopf-Slot + `neueZeile` + Lagebesprechungs-Sektion + Sub-Key (ST5), Kennzahlen (ST6), Vorschläge (ST7), Prüfliste/e2e/Gate-3 (ST9).
- **Typkonsistenz:** `besetzungAktion` → `{ typ }` in Task 2 und Task 5 identisch; `stabZeilenzielStil` in Task 3 und Task 6 identisch; `SachgebietEintrag.werkzeuge` → `werkzeugeFuer(keys, …)`.
