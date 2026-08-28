# LFH-348 · C13 Lagebericht — Abschnittsnavigation, Verlustschutz, Ketten, Lagemeldungen

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Die Lagebericht-Detailseite bekommt Abschnittsnavigation und Verlustschutz nach dem
C7-Muster, die Berichtsliste zeigt Fortschreibungsketten als eine Karte je Kette, das
Anlege-Modal läuft auf der Erfassungs-Hülle mit Zeitstand, und die Lagemeldungen bekommen
Zeit, Rückweg, Tagesgruppen und Filter.

**Architecture:** Der Verlustschutz wird **aus `BefehlDetailPage` in einen Hook gehoben**
(`entwurf/useEntwurfVerlustschutz.ts`) und von beiden Zwillingsseiten konsumiert — kein
zweiter Mechanismus daneben. Die Abschnittsnavigation ist ein antd `Anchor` in einer eigenen
Komponente, die aus `Form.useWatch` liest. Ketten werden in einer reinen Funktion
(`lageberichte/ketten.ts`) gebildet; die Liste zeigt nur Kettenköpfe. Lagemeldungen werden
auf das `Datensicht`-Primitiv (`form="karte"`) gehoben, das Gruppen, Sortierung und Filter
schon trägt.

**Tech Stack:** React 19, antd 6 (`Anchor`, `DatePicker`, `Segmented`), TanStack Query,
Vitest + RTL + MSW, Playwright, dayjs (`utc`).

**Spec:** ClickUp LFH-348 (Task-Beschreibung, oben in der Session geladen). Ergänzend die
Präzedenzen in CLAUDE.md: C7-Absatz „Ein Entwurf, der Minuten Schreibarbeit kostet …",
Erfassungs-Norm B4, Bedien-Leitlinie (Prüfliste).

## Global Constraints

- `pnpm lint` mit `--max-warnings 0`; kein `eslint-disable` im Effekt-Umbau.
- Kein neues punktuelles `size="small"` auf interaktiven Elementen (`dichte.guard.test.ts`).
- Kein Inline-Query-Key; Pfade nur über `routing/deeplinks.ts` (`meldungenPfad`,
  `lageberichtDetailPfad`); `grep -rn 'einsaetze/\${' LagemeldungenPage.tsx` = 0.
- Kein Emoji als Ikone — `@ant-design/icons` in `aria-hidden`-Hülle.
- Statusfarbe nie als Textfläche; jede Farbaussage mit zweitem Kanal (Text).
- Erfassungs-Norm: Anlege-Modal über `ErfassungsModal`, `onErfassen` = `mutateAsync`.
- Neue `Datensicht`-Konsumenten tragen `spaltenFuer` und stehen in `KONSUMENTEN`
  (`components/datensicht.guard.test.ts`).
- **Abweichungen vom Ticket (bewusst, in der Prüfliste festgehalten):**
  1. Riegel = eigener `ungespeichert`-State, **nicht** `form.isFieldsTouched()` (CLAUDE.md C7:
     antd setzt das Flag beim Speichern nicht zurück → Autosave-PATCH alle 30 s für nichts).
  2. Autosave geht **auf den Server** (Blur + 30 s, C7-Muster) statt in ein lokales
     `useEntwurf`/IndexedDB. Zwei Wahrheiten (lokaler Entwurf gegen Serverstand nach Reload)
     wären ein Konfliktfall ohne Auflösung; der Serverstand ist nach Blur höchstens 30 s alt.
     Sichtbar: „zuletzt gespeichert HH:MM" — Wortlaut wie C7, nicht „Entwurf gesichert".
  3. M86 (Druck) bleibt bei **LFH-350 (F2)**. Hier wird der Druck nicht angefasst.
- Alle Tests laufen mit `mise exec pnpm@11.10.0 -- pnpm -C <abs-frontend-pfad> exec vitest run <datei>`
  (Worktree: `/Users/rubeen/dev/personal/lifeline-hub/.claude/worktrees/feat-lfh-348-lagebericht-abschnittsnavigation/frontend`).
- Commits referenzieren `LFH-348`.

---

## Dateiplan

| Datei | Verantwortung |
| --- | --- |
| `frontend/src/entwurf/useEntwurfVerlustschutz.ts` (**neu**) | Riegel gegen Fremd-Refetch, Autosave (30 s + Blur), `beforeunload`, Zeitstempel — gehoben aus `BefehlDetailPage` |
| `frontend/src/entwurf/useEntwurfVerlustschutz.test.tsx` (**neu**) | Hook-Test der reinen Zusicherungen (Riegel, Gegenaussage, Warner) |
| `frontend/src/pages/BefehlDetailPage.tsx` | konsumiert den Hook, Verhalten unverändert (9 Tests bleiben grün) |
| `frontend/src/pages/LageberichtDetailPage.tsx` | Hook, Zeitstand-Feld, Abschnittsnavigation, Toggle/Split-Umschalter |
| `frontend/src/lageberichte/AbschnittsNavigation.tsx` (**neu**) | `Anchor` mit Befüllt-/Leer-Marke je Abschnitt |
| `frontend/src/lageberichte/AbschnittsNavigation.test.tsx` (**neu**) | 8 Einträge, leere markiert, Klartext-Kanal |
| `frontend/src/lageberichte/ketten.ts` + `.test.ts` (**neu**) | `kettenKoepfe()` über `vorgaenger_id` |
| `frontend/src/pages/LageberichtePage.tsx` | Kettenköpfe + Vorgänger-Links; Anlege-Modal auf `ErfassungsModal` mit Titel-Default und Zeitstand |
| `frontend/src/pages/LageberichtePage.test.tsx` | Kettentest umgeschrieben, Modal-Tests neu |
| `frontend/src/pages/LagemeldungenPage.tsx` | `Datensicht form="karte"`, Tagesgruppen, Filter, `ZeitAnzeige`, `meldungenPfad` |
| `frontend/src/pages/LagemeldungenPage.test.tsx` | Rückweg, Zeit, Gruppen, Filter |
| `frontend/src/components/datensicht.guard.test.ts` | `KONSUMENTEN` + `NUR_KARTE` um `LagemeldungenPage.tsx` |
| `frontend/e2e/lagebericht-schmal.spec.ts` (**neu**) | Seitenhöhe 1366 px, kein waagerechter Überlauf bei 390 px |
| `docs/superpowers/specs/2026-08-28-lfh-348-pruefliste.md` (**neu**) | Prüfliste Einsatztauglichkeit, 3 Flächen |
| `CLAUDE.md` | ein Absatz: Verlustschutz-Hook ist der Träger; Ketten; Datensicht-Konsumentin 12 |

---

### Task 0: e2e-Messung des Bestands (Zahl VOR dem Umbau)

**Files:**
- Create: `frontend/e2e/lagebericht-schmal.spec.ts`

**Interfaces:**
- Produces: die gemessene Bestandshöhe als Annotation im Testlauf; die Schwelle `MAX_HOEHE`
  wird in Task 8 auf ≤ Hälfte davon gesetzt.

- [ ] **Step 1: Spec schreiben (misst, behauptet noch nichts über die Höhe)**

```ts
import { expect, test, type Page } from '@playwright/test';

/**
 * Lagebericht am Fükw-Maß und am schmalen Schirm (LFH-348 · C13).
 *
 * WARUM HIER: jsdom rechnet kein Layout. Die Seitenhöhe der Detailseite und der
 * waagerechte Überlauf der beiden Listen sind reine Layoutaussagen.
 *
 * DIE SCHWELLE `MAX_HOEHE` IST EINE GEMESSENE ZAHL, keine Setzung: der Bestand vor C13
 * (Split-Editoren à 8 Zeilen, keine Navigation) ist mit genau diesem Test gemessen worden
 * — der Wert steht in der Prüfliste (`docs/superpowers/specs/2026-08-28-lfh-348-pruefliste.md`)
 * — und das Ticket verlangt mindestens die Halbierung.
 */

const ADMIN = 'admin';
const PW = process.env.E2E_ADMIN_PW ?? 'e2e-admin-pw';
/** Halbe Bestandshöhe, gerundet — wird in Task 8 aus der Messung gesetzt. */
const MAX_HOEHE = Number.POSITIVE_INFINITY;

async function anmelden(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Benutzername').fill(ADMIN);
  await page.getByLabel('Passwort').fill(PW);
  await page.getByRole('button', { name: 'Anmelden', exact: true }).click();
  await expect(page).toHaveURL(/\/einsaetze/);
}

async function einsatzAnlegen(page: Page, name: string): Promise<string> {
  await page.getByRole('button', { name: 'Neuer Einsatz' }).click();
  await page.getByLabel('Bezeichnung').fill(name);
  await page.getByRole('button', { name: 'Anlegen', exact: true }).click();
  await expect(page).toHaveURL(/\/einsaetze\/\d+/);
  return page.url().match(/\/einsaetze\/(\d+)/)![1];
}

/** Seeding per `page.request` — teilt den Cookie-Jar des Kontexts (siehe datensicht-schmal.spec.ts). */
async function lageberichtAnlegen(page: Page, einsatzId: string): Promise<number> {
  const antwort = await page.request.post(`/api/einsaetze/${einsatzId}/lageberichte`, {
    data: { vorlage: 'lagebeurteilung', titel: 'Lagevortrag zur Entscheidung 1000' },
  });
  expect(antwort.ok()).toBe(true);
  return (await antwort.json()).id as number;
}

async function lagemeldungAnlegen(page: Page, einsatzId: string) {
  const m = await page.request.post(`/api/einsaetze/${einsatzId}/meldungen`, {
    data: { text: 'Brücke Nord gesperrt, Umleitung über B12', absender: 'Florian Nord 1', typ: 'meldung' },
  });
  expect(m.ok()).toBe(true);
  const meldung = await m.json();
  const l = await page.request.post(`/api/einsaetze/${einsatzId}/meldungen/${meldung.id}/lagerelevant`, {
    data: {},
  });
  expect(l.ok()).toBe(true);
}

let einsatzId: string | null = null;
let berichtId: number | null = null;

async function vorbereiten(page: Page) {
  await anmelden(page);
  einsatzId ??= await einsatzAnlegen(page, `E2E Lagebericht ${Date.now()}`);
  berichtId ??= await lageberichtAnlegen(page, einsatzId);
}

test('Detailseite „Lagevortrag zur Entscheidung" bleibt bei 1366 px unter der halben Bestandshöhe', async ({ page }) => {
  await vorbereiten(page);
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto(`/einsaetze/${einsatzId}/lageberichte/${berichtId}`);
  await expect(page.getByLabel('Auftrag')).toBeVisible();

  const hoehe = await page.evaluate(() => document.body.scrollHeight);
  test.info().annotations.push({ type: 'gemessen', description: `body.scrollHeight = ${hoehe} px bei 1366×768` });
  expect(hoehe).toBeLessThanOrEqual(MAX_HOEHE);
});

for (const pfad of ['lageberichte', 'lagemeldungen'] as const) {
  test(`/${pfad}: kein waagerechter Überlauf bei 390 px`, async ({ page }) => {
    await vorbereiten(page);
    if (pfad === 'lagemeldungen') await lagemeldungAnlegen(page, einsatzId!);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/einsaetze/${einsatzId}/${pfad}`);
    await expect(page.getByRole('heading', { level: 3 })).toBeVisible();
    const mass = await page.evaluate(() => ({
      scroll: document.documentElement.scrollWidth,
      klient: document.documentElement.clientWidth,
    }));
    expect(mass.scroll, `${pfad}: Body breiter als der Viewport`).toBeLessThanOrEqual(mass.klient + 1);
  });
}
```

Prüfe VOR dem Schreiben die Felder des Meldungs-POST: `grep -n "pub struct NeueMeldung\|pub struct AnlegenBody" -A12 src/routes/meldung.rs` und den Body von `lagerelevant`. Passe `data` an die Pflichtfelder an.

- [ ] **Step 2: Laufen lassen, Zahl notieren**

Run: `cd frontend && mise exec pnpm@11.10.0 -- pnpm exec playwright test e2e/lagebericht-schmal.spec.ts --reporter=list`
(Voraussetzung: `target/debug/lifeline-hub` existiert — `cargo build` im Repo-Root.)
Expected: alle 3 grün (Höhe ohne Schwelle); Annotation „body.scrollHeight = N px". **N in die Prüfliste (Task 8) übernehmen.** Falls die 390-px-Tests im Bestand rot sind, ist das ein gemessener Befund — notieren, nicht reparieren; Task 5/7 beheben ihn.

- [ ] **Step 3: Commit**

```bash
git add frontend/e2e/lagebericht-schmal.spec.ts
git commit -m "test(lfh-348): e2e misst Bestandshöhe der Lagebericht-Detailseite und Überlauf bei 390 px"
```

---

### Task 1: Verlustschutz als Hook aus `BefehlDetailPage` heben

**Files:**
- Create: `frontend/src/entwurf/useEntwurfVerlustschutz.ts`
- Create: `frontend/src/entwurf/useEntwurfVerlustschutz.test.tsx`
- Modify: `frontend/src/pages/BefehlDetailPage.tsx:45-170`

**Interfaces:**
- Produces:
```ts
export const AUTOSAVE_MS = 30_000;
export interface VerlustschutzArgs<D, W extends object> {
  daten: D | undefined;             // Serverstand (Query-Data)
  istEntwurf: boolean;              // nur dann Autosave-Uhr
  form: FormInstance<W>;
  werteAus: (daten: D) => W;        // Serverstand → Formularwerte
  speichern: (werte: W) => Promise<unknown>;  // stiller Autosave (kein Erfolgs-Toast)
  onFehler: (e: unknown) => void;
  onGespeichert?: () => void;       // Invalidierung
}
export interface Verlustschutz {
  ungespeichert: boolean;
  zuletztGespeichert: string | null;   // 'HH:mm'
  markiereGeaendert: () => void;       // Form onValuesChange
  autosaveJetzt: () => void;           // Form onBlur
  quittiereGespeichert: () => void;    // nach explizitem Speichern (setzt Merker + Uhrzeit)
  autosaveLaeuft: boolean;
}
export function useEntwurfVerlustschutz<D, W extends object>(a: VerlustschutzArgs<D, W>): Verlustschutz
```

- [ ] **Step 1: Hook-Test schreiben (fällt, Modul fehlt)**

```tsx
import { describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Form, Input } from 'antd';
import { useState } from 'react';
import { useEntwurfVerlustschutz } from './useEntwurfVerlustschutz';

interface Daten { titel: string }

/** Minimaler Träger: ein Feld, ein Serverstand, den der Test von aussen nachschiebt. */
function Traeger({ daten, speichern }: { daten: Daten; speichern: (w: Daten) => Promise<unknown> }) {
  const [form] = Form.useForm<Daten>();
  const schutz = useEntwurfVerlustschutz<Daten, Daten>({
    daten, istEntwurf: true, form,
    werteAus: (d) => ({ titel: d.titel }),
    speichern, onFehler: () => {},
  });
  return (
    <Form form={form} onValuesChange={schutz.markiereGeaendert} onBlur={schutz.autosaveJetzt}>
      <Form.Item label="Titel" name="titel"><Input /></Form.Item>
      <output>{schutz.ungespeichert ? 'offen' : 'sauber'}</output>
    </Form>
  );
}

function Huelle({ speichern = () => Promise.resolve() }: { speichern?: (w: Daten) => Promise<unknown> }) {
  const [daten, setDaten] = useState<Daten>({ titel: 'Server 1' });
  return (
    <>
      <Traeger daten={daten} speichern={speichern} />
      <button type="button" onClick={() => setDaten({ titel: 'Server 2' })}>fremd</button>
    </>
  );
}

describe('useEntwurfVerlustschutz', () => {
  it('überschreibt ein berührtes Formular NICHT mit einem fremden Serverstand', async () => {
    render(<Huelle />);
    const feld = screen.getByLabelText('Titel');
    expect(feld).toHaveValue('Server 1');
    await userEvent.clear(feld);
    await userEvent.type(feld, 'Meine Fassung');
    await userEvent.click(screen.getByText('fremd'));
    expect(screen.getByLabelText('Titel')).toHaveValue('Meine Fassung');
    expect(screen.getByText('offen')).toBeInTheDocument();
  });

  it('übernimmt den Serverstand, solange nichts berührt wurde (Gegenaussage)', async () => {
    render(<Huelle />);
    await userEvent.click(screen.getByText('fremd'));
    expect(screen.getByLabelText('Titel')).toHaveValue('Server 2');
    expect(screen.getByText('sauber')).toBeInTheDocument();
  });

  it('speichert beim Verlassen eines Feldes und räumt den Merker', async () => {
    const speichern = vi.fn().mockResolvedValue(undefined);
    render(<Huelle speichern={speichern} />);
    await userEvent.type(screen.getByLabelText('Titel'), 'x');
    await userEvent.tab();
    await act(async () => {});
    expect(speichern).toHaveBeenCalledTimes(1);
    expect(await screen.findByText('sauber')).toBeInTheDocument();
  });

  it('warnt beim Reload nur mit offener Fassung', async () => {
    render(<Huelle />);
    let ereignis = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(ereignis);
    expect(ereignis.defaultPrevented).toBe(false);
    await userEvent.type(screen.getByLabelText('Titel'), 'x');
    ereignis = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(ereignis);
    expect(ereignis.defaultPrevented).toBe(true);
  });
});
```

- [ ] **Step 2: Test laufen lassen → rot** (`Cannot find module './useEntwurfVerlustschutz'`)

- [ ] **Step 3: Hook schreiben — Logik 1:1 aus `BefehlDetailPage.tsx:45-170`, Kommentare mitnehmen**

```ts
import type { FormInstance } from 'antd';
import dayjs from 'dayjs';
import { useCallback, useEffect, useRef, useState } from 'react';

/** Frist des stillen Autosave. 30 s ist die Vorgabe aus dem Befund N18 (LFH-342 · C7). */
export const AUTOSAVE_MS = 30_000;

export interface VerlustschutzArgs<D, W extends object> {
  daten: D | undefined;
  istEntwurf: boolean;
  form: FormInstance<W>;
  werteAus: (daten: D) => W;
  speichern: (werte: W) => Promise<unknown>;
  onFehler: (e: unknown) => void;
  onGespeichert?: () => void;
}

export interface Verlustschutz {
  ungespeichert: boolean;
  zuletztGespeichert: string | null;
  markiereGeaendert: () => void;
  autosaveJetzt: () => void;
  quittiereGespeichert: () => void;
  autosaveLaeuft: boolean;
}

/**
 * Verlustschutz für Entwurfsformulare (gehoben aus `BefehlDetailPage`, LFH-342 · C7 →
 * LFH-348 · C13). Drei Teile mit je einer Falle — siehe CLAUDE.md „Ein Entwurf, der Minuten
 * Schreibarbeit kostet":
 *  1. Der Sync-Effekt Serverstand → Formular hat einen RIEGEL: solange eine eigene Fassung
 *     offen ist, wird nicht überschrieben. Die Umkehrung (ohne Fassung wird übernommen)
 *     ist die eigentliche Zusicherung.
 *  2. Der Merker ist EIGENER State, nicht `form.isFieldsTouched()` — antd setzt das Flag
 *     beim Speichern nicht zurück, ein Autosave darauf schriebe alle 30 s ein PATCH.
 *  3. Autosave ist STILL (kein Erfolgs-Toast, EEMUA 191); sichtbar ist `zuletztGespeichert`.
 *     Der Fehlerfall meldet sich über `onFehler`.
 * `useBlocker` steht nicht zur Verfügung (BrowserRouter, gemessen in C7); den In-App-Wechsel
 * trägt der Blur-Autosave, Reload/Tab-Schluss ein `beforeunload`.
 */
export function useEntwurfVerlustschutz<D, W extends object>({
  daten, istEntwurf, form, werteAus, speichern, onFehler, onGespeichert,
}: VerlustschutzArgs<D, W>): Verlustschutz {
  const [ungespeichert, setUngespeichert] = useState(false);
  const [zuletztGespeichert, setZuletztGespeichert] = useState<string | null>(null);
  const [autosaveLaeuft, setAutosaveLaeuft] = useState(false);

  // Callbacks in Refs: der Sync-Effekt hängt nur an `daten` und `ungespeichert`, nicht an
  // der Identität von `werteAus` — sonst liefe er bei jedem Render der Seite neu.
  const werteAusRef = useRef(werteAus);
  werteAusRef.current = werteAus;

  useEffect(() => {
    if (!daten) return;
    if (ungespeichert) return; // DER RIEGEL
    form.setFieldsValue(werteAusRef.current(daten) as Parameters<typeof form.setFieldsValue>[0]);
  }, [daten, form, ungespeichert]);

  const quittiereGespeichert = useCallback(() => {
    setUngespeichert(false);
    setZuletztGespeichert(dayjs().format('HH:mm'));
  }, []);

  const autosaveRef = useRef<() => void>(() => {});
  autosaveRef.current = () => {
    if (!ungespeichert || autosaveLaeuft) return;
    setAutosaveLaeuft(true);
    speichern(form.getFieldsValue())
      .then(() => {
        quittiereGespeichert();
        onGespeichert?.();
      })
      .catch(onFehler)
      .finally(() => setAutosaveLaeuft(false));
  };

  useEffect(() => {
    if (!istEntwurf) return;
    const uhr = setInterval(() => autosaveRef.current(), AUTOSAVE_MS);
    return () => clearInterval(uhr);
  }, [istEntwurf]);

  useEffect(() => {
    if (!ungespeichert) return;
    const warnen = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = ''; // ältere Browser werten allein `returnValue`
    };
    window.addEventListener('beforeunload', warnen);
    return () => window.removeEventListener('beforeunload', warnen);
  }, [ungespeichert]);

  return {
    ungespeichert,
    zuletztGespeichert,
    markiereGeaendert: useCallback(() => setUngespeichert(true), []),
    autosaveJetzt: useCallback(() => autosaveRef.current(), []),
    quittiereGespeichert,
    autosaveLaeuft,
  };
}
```

- [ ] **Step 4: Hook-Test grün**

- [ ] **Step 5: `BefehlDetailPage` auf den Hook umstellen** — entfernen: `AUTOSAVE_MS`, die States `ungespeichert`/`zuletztGespeichert`, den Sync-Effekt, `autosaveMutation`, `autosaveRef`, den Intervall-Effekt und den `beforeunload`-Effekt (Zeilen 45–170). Einsetzen:

```tsx
const schutz = useEntwurfVerlustschutz<BefehlAnzeige, Record<string, string>>({
  daten: befehlQuery.data,
  istEntwurf: befehlQuery.data?.status === 'entwurf',
  form,
  werteAus: (b) => {
    const werte: Record<string, string> = { titel: b.titel };
    for (const a of b.abschnitte) werte[a.schluessel] = a.text;
    return werte;
  },
  speichern,
  onFehler: fehler,
  onGespeichert: invalidate,
});
```
`speichernMutation.onSuccess`: `schutz.quittiereGespeichert(); invalidate(); message.success(…)`.
Im JSX: `schutz.ungespeichert`, `schutz.zuletztGespeichert`, `onValuesChange={schutz.markiereGeaendert}`, `onBlur={schutz.autosaveJetzt}`. Die langen Doc-Kommentare der Seite auf einen Verweis „siehe `entwurf/useEntwurfVerlustschutz.ts`" kürzen. `speichern` muss VOR dem Hook-Aufruf definiert sein (Hoisting: `const` → Reihenfolge beachten).

- [ ] **Step 6: Befehl-Tests grün** — Run: `… exec vitest run src/pages/BefehlDetailPage.test.tsx src/entwurf` → alle grün, insbesondere die 7 des Verlustschutz-Blocks.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/entwurf frontend/src/pages/BefehlDetailPage.tsx
git commit -m "refactor(lfh-348): hebt den Verlustschutz aus BefehlDetailPage in useEntwurfVerlustschutz"
```

---

### Task 2: Verlustschutz am Lagebericht (H63) + Regressionstests

**Files:**
- Modify: `frontend/src/pages/LageberichtDetailPage.tsx:44-77,180-206`
- Modify: `frontend/src/pages/LageberichtePage.test.tsx` (neuer `describe`-Block)

- [ ] **Step 1: Tests schreiben** (in `LageberichtePage.test.tsx`, unter dem bestehenden `describe('LageberichtDetailPage')`):

```tsx
describe('LageberichtDetailPage — Verlustschutz (LFH-348 · C13, Befund H63)', () => {
  /** Serverstand nachschiebbar: der Handler liest aus einer Variablen. */
  function setupLebend(start: LageberichtAnzeige) {
    let stand = start;
    const patches: unknown[] = [];
    server.use(
      http.get('/api/auth/me', () => HttpResponse.json(admin)),
      http.get('/api/einsaetze/7', () => HttpResponse.json(einsatz)),
      http.get(`/api/einsaetze/7/lageberichte/${start.id}`, () => HttpResponse.json(stand)),
      http.patch(`/api/einsaetze/7/lageberichte/${start.id}`, async ({ request }) => {
        patches.push(await request.json());
        return HttpResponse.json(stand);
      }),
    );
    const r = renderMitProviders(
      <AuthProvider>
        <Routes>
          <Route path="/einsaetze/:id/lageberichte/:lbId" element={<LageberichtDetailPage />} />
        </Routes>
      </AuthProvider>,
      { route: `/einsaetze/7/lageberichte/${start.id}` },
    );
    return {
      patches,
      /** Fremde Änderung: neuer Serverstand + Invalidierung wie über den Live-Stream. */
      fremdeAenderung: async (neu: LageberichtAnzeige) => {
        stand = neu;
        await act(async () => {
          await r.client.invalidateQueries({ queryKey: einsatzKeys.lagebericht(7, start.id) });
        });
      },
    };
  }

  it('überschreibt getippten Text NICHT, wenn der Bericht serverseitig geändert wurde', async () => {
    const { fremdeAenderung } = setupLebend(lagebericht7Abschnitte);
    const auftrag = await screen.findByLabelText('Auftrag');
    await userEvent.type(auftrag, 'Meine Fassung');
    await fremdeAenderung({ ...lagebericht7Abschnitte, titel: 'Fremde Fassung', aktualisiert_at: '2026-06-02 12:00:00' });
    // Unabhängiger Zeuge: die Überschrift kommt aus der Query, nicht aus dem Formular.
    await screen.findByRole('heading', { name: 'Fremde Fassung' });
    expect(screen.getByLabelText('Auftrag')).toHaveValue('Meine Fassung');
  });

  it('übernimmt eine fremde Änderung in ein unberührtes Formular', async () => {
    const { fremdeAenderung } = setupLebend(lagebericht7Abschnitte);
    await screen.findByLabelText('Auftrag');
    await fremdeAenderung({ ...lagebericht7Abschnitte, titel: 'Neu vom Server', aktualisiert_at: '2026-06-02 12:00:00',
      abschnitte: [{ schluessel: 'auftrag', text: 'Fremder Text' }, ...lagebericht7Abschnitte.abschnitte.slice(1)] });
    await screen.findByRole('heading', { name: 'Neu vom Server' });
    expect(screen.getByLabelText('Auftrag')).toHaveValue('Fremder Text');
  });

  it('lädt beim Wechsel der Bericht-ID korrekt neu', async () => {
    const zweiter = { ...lagebericht7Abschnitte, id: 13, titel: 'Zweiter Bericht',
      abschnitte: [{ schluessel: 'auftrag', text: 'Text 13' }, ...lagebericht7Abschnitte.abschnitte.slice(1)] };
    server.use(
      http.get('/api/auth/me', () => HttpResponse.json(admin)),
      http.get('/api/einsaetze/7', () => HttpResponse.json(einsatz)),
      http.get('/api/einsaetze/7/lageberichte/12', () => HttpResponse.json(lagebericht7Abschnitte)),
      http.get('/api/einsaetze/7/lageberichte/13', () => HttpResponse.json(zweiter)),
    );
    renderMitProviders(
      <AuthProvider>
        <Routes>
          <Route path="/einsaetze/:id/lageberichte/:lbId" element={<LageberichtDetailPage />} />
          <Route path="/weiter" element={<Link to="/einsaetze/7/lageberichte/13">weiter</Link>} />
        </Routes>
      </AuthProvider>,
      { route: '/einsaetze/7/lageberichte/12' },
    );
    await screen.findByLabelText('Auftrag');
    // Über die Brotkrume geht es nur zur Liste; der ID-Wechsel wird über die Fortschreibung
    // im Betrieb erreicht. Hier: Navigations-Link im Test-Router.
    // (Link-Import aus 'react-router' oben ergänzen.)
    ...
  });
```
Der dritte Test ist im Ticket verlangt („Wechsel der Bericht-ID lädt neu"). Baue ihn als: erst `/12` rendern, Formular berührt (`type 'x'`), dann per `navigate` (eigene kleine Komponente mit `useNavigate`, die beim Mount einen Knopf rendert) auf `/13` wechseln und `findByRole('heading', { name: 'Zweiter Bericht' })` + `getByLabelText('Auftrag')` mit Wert `Text 13` erwarten. **Wichtig:** die Seite hängt am selben Komponentenbaum (gleiche Route, andere Params) — der Hook-State `ungespeichert` überlebt den Param-Wechsel. Deshalb muss die Seite **`key={berichtId}`** auf dem Hook-Träger setzen oder der Hook `ungespeichert` beim Wechsel der `daten`-Identität einer **anderen** Entität zurücksetzen. Lösung: `LageberichtDetailPage` exportiert die Seite als dünne Hülle, die `<LageberichtDetail key={berichtId} />` rendert (Remount je Bericht — dasselbe Muster gilt für `BefehlDetailPage`, dort in Task 1 mit umsetzen, damit beide gleich sind).

Plus die drei Autosave-/Warner-Tests nach dem Muster `BefehlDetailPage.test.tsx:156-226` (Fake-Timer 31 s → PATCH + „zuletzt gespeichert HH:MM"; Blur → PATCH; `beforeunload` Paar).

- [ ] **Step 2: rot laufen lassen**

- [ ] **Step 3: Seite umbauen** — Hook wie in Task 1 Step 5 einsetzen; `Form` bekommt `onValuesChange={schutz.markiereGeaendert}` und `onBlur={schutz.autosaveJetzt}`; im Kopf der Text `ungespeicherte Änderungen` / `zuletzt gespeichert HH:MM`; Hülle mit `key={berichtId}`:

```tsx
export default function LageberichtDetailPage() {
  const { lbId } = useParams();
  // Remount je Bericht: der Verlustschutz-Merker gehört zu EINEM Bericht. Ohne den Key
  // trüge ein Wechsel der ID (Fortschreiben → neue Route) den Riegel des alten mit.
  return <LageberichtDetail key={lbId} />;
}

function LageberichtDetail() { …bisheriger Inhalt… }
```

- [ ] **Step 4: grün** — `… exec vitest run src/pages/LageberichtePage.test.tsx src/pages/LageberichtDetailPage.test.tsx`

- [ ] **Step 5: Mutationsprobe** — `if (ungespeichert) return;` im Hook auskommentieren → erster Test rot; zurückdrehen.

- [ ] **Step 6: Commit** `fix(lfh-348): Fremd-Refetch überschreibt keine offene Lagebericht-Fassung mehr; Autosave + Reload-Warner (H63)`

---

### Task 3: Zeitstand im Entwurf editierbar

**Files:**
- Modify: `frontend/src/pages/LageberichtDetailPage.tsx` (Formularwerte, `speichern`, Feld)
- Modify: `frontend/src/pages/LageberichtePage.test.tsx`

**Interfaces:**
- Consumes: `alsOrtszeit(s)` / `alsBackendZeit(d)` aus `frontend/src/etb/filterZeit.ts`.
- Produces: Formularwerte-Typ `LageberichtFormWerte = { titel: string; zeitstand?: Dayjs } & Record<string, string | Dayjs | undefined>` — wird in Task 4 weiterbenutzt.

- [ ] **Step 1: Test**

```tsx
it('macht den Zeitstand im Entwurf editierbar und schickt ihn als UTC-Wirestring', async () => {
  const { patches } = setupLebend(lagebericht7Abschnitte); // aus Task 2
  const feld = await screen.findByLabelText('Zeitstand');
  expect(feld).toHaveValue(alsOrtszeit('2026-06-02 10:00:00')!.format('DD.MM.YYYY HH:mm'));
  await userEvent.click(screen.getByRole('button', { name: 'Entwurf speichern' }));
  await waitFor(() => expect(patches).toHaveLength(1));
  expect(patches[0]).toMatchObject({ zeitstand: '2026-06-02 10:00:00' });
});
```

- [ ] **Step 2: rot** (kein Feld „Zeitstand")

- [ ] **Step 3: Implementieren**
  - `werteAus`: `{ titel, zeitstand: alsOrtszeit(b.zeitstand), …abschnitte }`.
  - `speichern(werte)`: `zeitstand: werte.zeitstand ? alsBackendZeit(werte.zeitstand) : undefined`.
  - Feld direkt unter dem Titel: `<Form.Item label="Zeitstand" name="zeitstand"><DatePicker showTime format="DD.MM.YYYY HH:mm" style={{ width: '100%' }} /></Form.Item>` (Muster `EinsaetzePage.tsx:342`).
  - Der read-only-Absatz `Zeitstand: {bericht.zeitstand}` bleibt roh (F2/LFH-350 formatiert ihn).

- [ ] **Step 4: grün**, **Step 5: Commit** `feat(lfh-348): Zeitstand im Lagebericht-Entwurf editierbar (N23)`

---

### Task 4: Abschnittsnavigation + Toggle/Split (H62)

**Files:**
- Create: `frontend/src/lageberichte/AbschnittsNavigation.tsx`, `.test.tsx`
- Modify: `frontend/src/pages/LageberichtDetailPage.tsx` (Formularbereich)
- Modify: `frontend/src/pages/LageberichtePage.test.tsx` (Test „layout=split" anpassen)

**Interfaces:**
```ts
export interface AbschnittsNavigationProps {
  abschnitte: readonly { schluessel: string; label: string }[];
  /** Welche Abschnitte Text tragen — aus `Form.useWatch` der Seite. */
  befuellt: ReadonlySet<string>;
  /** `vertical` ab lg (links neben dem Formular), `horizontal` darunter. */
  richtung: 'vertical' | 'horizontal';
}
export function abschnittAnkerId(schluessel: string): string  // `abschnitt-<schluessel>`
export function befuellteAbschnitte(werte: Record<string, unknown> | undefined, abschnitte): Set<string>  // rein
```

- [ ] **Step 1: Komponententest**

```tsx
import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { AbschnittsNavigation, befuellteAbschnitte } from './AbschnittsNavigation';
import { vorlage } from './vorlagen';

const acht = vorlage('lagebeurteilung')!.abschnitte;

describe('AbschnittsNavigation', () => {
  it('listet alle acht Abschnitte des Lagevortrags zur Entscheidung als Sprungziele', () => {
    render(<AbschnittsNavigation abschnitte={acht} befuellt={new Set()} richtung="vertical" />);
    const nav = screen.getByRole('navigation', { name: 'Abschnitte' });
    expect(within(nav).getAllByRole('link')).toHaveLength(8);
    expect(within(nav).getByRole('link', { name: /Auftrag/ })).toHaveAttribute('href', '#abschnitt-auftrag');
  });

  it('markiert leere Abschnitte im Klartext, nicht nur farbig (WCAG 1.4.1)', () => {
    render(<AbschnittsNavigation abschnitte={acht} befuellt={new Set(['auftrag'])} richtung="vertical" />);
    const nav = screen.getByRole('navigation', { name: 'Abschnitte' });
    expect(within(nav).getByRole('link', { name: 'Auftrag' })).toBeInTheDocument();
    expect(within(nav).getByRole('link', { name: 'Anlass des Lagevortrags (leer)' })).toBeInTheDocument();
    // Ikonen sind dekorativ — kein eigenes Vorleseziel je Zeile.
    expect(within(nav).queryByRole('img')).toBeNull();
  });

  it('zählt nur Text mit Inhalt als befüllt', () => {
    expect(befuellteAbschnitte({ auftrag: '  ', anlass: 'x' }, acht)).toEqual(new Set(['anlass']));
    expect(befuellteAbschnitte(undefined, acht)).toEqual(new Set());
  });
});
```

- [ ] **Step 2: rot**, **Step 3: Komponente**

```tsx
import { Anchor, theme } from 'antd';
import { CheckCircleOutlined, MinusCircleOutlined } from '@ant-design/icons';

export function abschnittAnkerId(schluessel: string) { return `abschnitt-${schluessel}`; }

export function befuellteAbschnitte(
  werte: Record<string, unknown> | undefined,
  abschnitte: readonly { schluessel: string }[],
): Set<string> {
  const s = new Set<string>();
  for (const a of abschnitte) {
    const t = werte?.[a.schluessel];
    if (typeof t === 'string' && t.trim()) s.add(a.schluessel);
  }
  return s;
}

/**
 * Sprungnavigation über die Abschnitte eines Lageberichts (LFH-348 · C13, Befund H62).
 * `Anchor` statt `Steps`: die Vorlagen haben keine Reihenfolge-Logik, jeder Abschnitt ist
 * jederzeit erreichbar. Die Leer-Marke trägt ZWEI Kanäle — Ikone (aria-hidden) und das
 * Wort „(leer)" im Linktext.
 */
export function AbschnittsNavigation({ abschnitte, befuellt, richtung }: AbschnittsNavigationProps) {
  const { token } = theme.useToken();
  return (
    <nav aria-label="Abschnitte">
      <Anchor
        affix={richtung === 'vertical'}
        offsetTop={token.marginLG}
        direction={richtung}
        items={abschnitte.map((a) => {
          const voll = befuellt.has(a.schluessel);
          return {
            key: a.schluessel,
            href: `#${abschnittAnkerId(a.schluessel)}`,
            title: (
              <span style={{ color: voll ? undefined : token.colorTextSecondary }}>
                <span aria-hidden style={{ marginInlineEnd: token.marginXXS }}>
                  {voll ? <CheckCircleOutlined /> : <MinusCircleOutlined />}
                </span>
                {a.label}{voll ? '' : ' (leer)'}
              </span>
            ),
          };
        })}
      />
    </nav>
  );
}
```
Prüfe im Test, dass `getByRole('link', { name: 'Auftrag' })` exakt matcht — antd-Icons tragen `role="img" aria-label="check-circle"`, die `aria-hidden`-Hülle nimmt sie aus dem Namen (gemessen in CLAUDE.md „Ein Emoji ist keine Ikone"). Sollte `queryByRole('img')` trotzdem treffen, `aria-hidden` direkt auf die Icon-Komponente legen (`<CheckCircleOutlined aria-hidden />`).

- [ ] **Step 4: Seite umbauen** (Formularbereich):

```tsx
const werte = Form.useWatch([], form);   // alle Werte, für die Befüllt-Marke
const befuellt = useMemo(() => befuellteAbschnitte(werte, v?.abschnitte ?? []), [werte, v]);
const { abBreite } = useViewport();
const breit = abBreite('lg');
const [vorschauNeben, setVorschauNeben] = useState(false);
```
JSX (nur Entwurfszweig):
```tsx
<Form …>
  <Form.Item label="Titel" …/>
  <Form.Item label="Zeitstand" …/>
  {/* Einstellung, keine Aktion: eigene Zeile über dem Text (Memory „Schalter nicht in die Aktionsreihe") */}
  <Checkbox checked={vorschauNeben} onChange={(e) => setVorschauNeben(e.target.checked)} style={{ marginBottom: token.margin }}>
    Vorschau neben dem Text
  </Checkbox>
  <div style={{ display: 'flex', flexDirection: breit ? 'row' : 'column', gap: token.marginLG, alignItems: 'flex-start' }}>
    <div style={{ flex: breit ? '0 0 240px' : '1 1 auto', width: breit ? undefined : '100%' }}>
      <AbschnittsNavigation abschnitte={v?.abschnitte ?? []} befuellt={befuellt} richtung={breit ? 'vertical' : 'horizontal'} />
    </div>
    <div style={{ flex: '1 1 0', minWidth: 0 }}>
      {v?.abschnitte.map((a) => (
        <section key={a.schluessel} id={abschnittAnkerId(a.schluessel)}>
          <Form.Item label={a.label} name={a.schluessel}>
            <MarkdownEditor layout={vorschauNeben ? 'split' : 'toggle'} variante="dokument" autoSize={{ minRows: 4 }} />
          </Form.Item>
        </section>
      ))}
    </div>
  </div>
</Form>
```
`minRows: 4` statt 8 — `autoSize` wächst mit dem Inhalt; die 8 Mindestzeilen waren die Hälfte der Scrollstrecke. Der Bestandstest „stellt die Abschnitts-Felder mit autoSize dar" prüft `overflowY: hidden` und `rows != 4` — bleibt grün (autoSize setzt kein `rows`-Attribut).

- [ ] **Step 5: Bestandstest „spiegelt Markdown live (layout=split)" anpassen**: der Vorschau-Zweig ist jetzt eingeklappt. Test umschreiben: tippen → Vorschau-Knopf „Vorschau" im Abschnitt klicken (`within(section).getByRole('button', { name: 'Vorschau' })`) → Heading sichtbar; plus zweiter Test: Checkbox „Vorschau neben dem Text" → Heading ohne Knopfklick sichtbar. Neuer Test: Navigation listet 8 Einträge in der Detailseite (`lagebeurteilung`-Fixture mit 8 Abschnitten anlegen) und genau EINE Textarea je Abschnitt (`getAllByRole('textbox')` = 1 Titel + 8 Abschnitte + kein Zweiteditor; DatePicker ist ein `<input>` mit `role=textbox`? — prüfen; bei Bedarf über `container.querySelectorAll('textarea')` = 8 zählen).

- [ ] **Step 6: grün, lint** (`useMemo`-Deps: `werte`, `v` — `v` ist aus `vorlage()` stabil je Render? Nein: `vorlage()` sucht im Array, gibt dasselbe Objekt zurück → stabil.)

- [ ] **Step 7: Commit** `feat(lfh-348): Abschnittsnavigation mit Leer-Marke, Vorschau einklappbar (H62)`

---

### Task 5: Fortschreibungsketten in der Liste (N23)

**Files:**
- Create: `frontend/src/lageberichte/ketten.ts`, `ketten.test.ts`
- Modify: `frontend/src/pages/LageberichtePage.tsx:35-90,160-185`
- Modify: `frontend/src/pages/LageberichtePage.test.tsx` (Kettentest)

**Interfaces:**
```ts
export interface KettenKopf { kopf: LageberichtAnzeige; vorgaenger: LageberichtAnzeige[] /* jüngster zuerst */ }
export function kettenKoepfe(berichte: readonly LageberichtAnzeige[]): KettenKopf[]
```

- [ ] **Step 1: Test**

```ts
import { describe, expect, it } from 'vitest';
import { kettenKoepfe } from './ketten';
import type { LageberichtAnzeige } from '../api/types';

const b = (id: number, vorgaenger_id: number | null, version: number): LageberichtAnzeige => ({
  id, vorgaenger_id, version, einsatz_id: 7, vorlage: 'freitext', titel: 'L', zeitstand: '', status: 'entwurf',
  abschnitte: [], ersteller_id: 1, ersteller_name: 'A', erstellt_at: '', aktualisiert_at: '',
  freigegeben_von_id: null, freigegeben_von_name: null, freigegeben_at: null, etb_eintrag_id: null,
});

describe('kettenKoepfe', () => {
  it('liefert je Kette den Kopf ohne Nachfolger, die Vorgänger jüngster zuerst', () => {
    const k = kettenKoepfe([b(11, null, 1), b(13, 11, 2), b(15, 13, 3), b(14, null, 1)]);
    expect(k.map((x) => x.kopf.id)).toEqual([15, 14]);
    expect(k[0].vorgaenger.map((x) => x.id)).toEqual([13, 11]);
    expect(k[1].vorgaenger).toEqual([]);
  });
  it('behandelt einen Vorgänger, der nicht in der Liste ist, als Kettenanfang', () => {
    const k = kettenKoepfe([b(13, 99, 2)]);
    expect(k.map((x) => x.kopf.id)).toEqual([13]);
    expect(k[0].vorgaenger).toEqual([]);
  });
});
```

- [ ] **Step 2: rot**, **Step 3: Implementieren**

```ts
export function kettenKoepfe(berichte: readonly LageberichtAnzeige[]): KettenKopf[] {
  const nachId = new Map(berichte.map((x) => [x.id, x]));
  const hatNachfolger = new Set(berichte.map((x) => x.vorgaenger_id).filter((x): x is number => x != null));
  return berichte
    .filter((x) => !hatNachfolger.has(x.id))
    .map((kopf) => {
      const vorgaenger: LageberichtAnzeige[] = [];
      const gesehen = new Set<number>([kopf.id]);   // Zyklusschutz
      let v = kopf.vorgaenger_id == null ? undefined : nachId.get(kopf.vorgaenger_id);
      while (v && !gesehen.has(v.id)) { vorgaenger.push(v); gesehen.add(v.id); v = v.vorgaenger_id == null ? undefined : nachId.get(v.vorgaenger_id); }
      return { kopf, vorgaenger };
    });
}
```

- [ ] **Step 4: Seite** — `Datensicht` bekommt `daten={koepfe}` (Typ `KettenKopf`), Spalten über `spaltenFuer<KettenKopf>()`, `zeilenSchluessel={(k) => k.kopf.id}`, `gruppen.schluessel = (k) => k.kopf.status`, `titel.ziel = (k) => lageberichtDetailPfad(einsatzId, k.kopf.id)`. Spalte `fassung` render:

```tsx
render: (_t, k) => (
  <>
    {`v${k.kopf.version} · ${k.kopf.zeitstand} · ${k.kopf.ersteller_name}`}
    {k.vorgaenger.length > 0 && (
      <span style={{ display: 'block' }}>
        Vorgänger:{' '}
        {k.vorgaenger.map((v, i) => (
          <span key={v.id}>{i > 0 && ', '}<Link to={lageberichtDetailPfad(einsatzId, v.id)}>v{v.version}</Link></span>
        ))}
      </span>
    )}
  </>
),
```
`einsatzId` steht nicht in der Modulkonstante → Spalten in ein `useMemo(() => spaltenFuer<KettenKopf>()([...]), [einsatzId])` **innerhalb** der Komponente ziehen (die Guard-Marke `spaltenFuer` bleibt in der Datei). Kopfzeile: `{berichte.length} Berichte in {koepfe.length} Ketten · {entwuerfe} im Entwurf`.

- [ ] **Step 5: Kettentest umschreiben** — mit `KETTE` (14; 11 → 13): Links = `[13, 14]` (Kopf 13 im Entwurf zuerst, dann 14 freigegeben), `Freigegeben · 1`, `Entwürfe · 1`, und in der Karte von 13 ein Link `v1` auf `/einsaetze/7/lageberichte/11`. Der Suchtest bleibt (Suche über Kopf-Titel/Vorlage). Kennzahlentest: `3 Berichte in 2 Ketten · 1 im Entwurf`.

- [ ] **Step 6: grün**, **Step 7: Commit** `feat(lfh-348): Lageberichte-Liste zeigt je Fortschreibungskette eine Karte (N23)`

---

### Task 6: Anlege-Modal auf die Erfassungs-Hülle (N23)

**Files:**
- Modify: `frontend/src/pages/LageberichtePage.tsx:95-115,190-225`
- Modify: `frontend/src/pages/LageberichtePage.test.tsx`

- [ ] **Step 1: Tests**

```tsx
it('öffnet das Anlege-Modal mit Fokus im Titel und vorbelegtem Titel aus der Uhrzeit', async () => {
  setup();
  await userEvent.click(await screen.findByRole('button', { name: /Neuer Bericht/i }));
  const titel = await screen.findByLabelText('Titel');
  await waitFor(() => expect(titel).toHaveFocus());
  expect(titel).toHaveValue(expect.stringMatching(/^Lageüberblick \d{4}$/));
  // Der Absende-Knopf liegt IM Formular — Enter sendet (Erfassungs-Norm B4).
  const knopf = screen.getByRole('button', { name: 'Anlegen' });
  expect(knopf.closest('form')).not.toBeNull();
  expect(document.querySelector('.ant-modal-footer')).toBeNull();
});

it('schickt Vorlage, Titel und optionalen Zeitstand als UTC-Wirestring', async () => {
  const posts: unknown[] = [];
  server.use(http.post('/api/einsaetze/7/lageberichte', async ({ request }) => {
    posts.push(await request.json());
    return HttpResponse.json(bericht, { status: 201 });
  }));
  setup();
  await userEvent.click(await screen.findByRole('button', { name: /Neuer Bericht/i }));
  const titel = await screen.findByLabelText('Titel');
  await userEvent.clear(titel);
  await userEvent.type(titel, 'Lage 1200{Enter}');
  await waitFor(() => expect(posts).toHaveLength(1));
  expect(posts[0]).toEqual({ vorlage: 'lagebericht', titel: 'Lage 1200' }); // zeitstand fehlt, wenn leer
});
```

- [ ] **Step 2: rot**, **Step 3: Umbauen**

```tsx
import { ErfassungsModal } from '../components/Erfassung';
import { DatePicker } from 'antd';
import type { Dayjs } from 'dayjs';
import { alsBackendZeit } from '../etb/filterZeit';

interface AnlegenWerte { titel: string; vorlage: LageberichtVorlageKey; zeitstand?: Dayjs }
export function titelVorschlag(jetzt: Dayjs): string { return `Lageüberblick ${jetzt.format('HHmm')}`; }
…
const [form] = Form.useForm<AnlegenWerte>();
const anlegenMutation = useMutation({
  mutationFn: (w: AnlegenWerte) => legeLageberichtAn(einsatzId, {
    vorlage: w.vorlage, titel: w.titel, ...(w.zeitstand ? { zeitstand: alsBackendZeit(w.zeitstand) } : {}),
  }),
  onSuccess: invalidate,
  onError: fehler,
});
…
<ErfassungsModal<AnlegenWerte>
  offen={anlegenOffen}
  titel="Neuer Lagebericht"
  form={form}
  erfassenText="Anlegen"
  laeuft={anlegenMutation.isPending}
  initialValues={{ vorlage: 'lagebericht', titel: titelVorschlag(dayjs()) }}
  onErfassen={(w) => anlegenMutation.mutateAsync(w)}
  onFertig={() => setAnlegenOffen(false)}
  onAbbrechen={() => setAnlegenOffen(false)}
>
  <Form.Item label="Titel" name="titel" rules={[{ required: true, message: 'Titel erforderlich' }]}>
    <Input placeholder="z. B. Lageüberblick 1030" />
  </Form.Item>
  <Form.Item label="Vorlage" name="vorlage" rules={[{ required: true }]}>
    <Select options={VORLAGEN.map((v) => ({ value: v.schluessel, label: v.label }))} />
  </Form.Item>
  <Form.Item label="Zeitstand" name="zeitstand" extra="Leer = jetzt">
    <DatePicker showTime format="DD.MM.YYYY HH:mm" style={{ width: '100%' }} />
  </Form.Item>
</ErfassungsModal>
```
`initialValues` wird von der Hülle bei jedem Reset erneut wirksam — der Titelvorschlag muss **beim Öffnen** entstehen: `initialValues` aus einem `useMemo(() => …, [anlegenOffen])` bilden, sonst trüge ein zweites Öffnen die Uhrzeit des ersten. Titel steht als **erstes** Feld, damit die Hülle ihn fokussiert (Ticket: `autoFocus` auf den Titel). Alte `Modal`-Importe und `form.resetFields()` in `onSuccess` entfernen (die Hülle setzt zurück).

- [ ] **Step 4: grün** (auch Bestandstest „zeigt für Schreibberechtigte den Anlegen-Button"), **Step 5: Commit** `feat(lfh-348): Anlege-Modal auf ErfassungsModal, Titelvorschlag aus Uhrzeit, Zeitstand optional (N23)`

---

### Task 7: Lagemeldungen — Zeit, Rückweg, Tagesgruppen, Filter (M85)

**Files:**
- Modify: `frontend/src/pages/LagemeldungenPage.tsx` (Neuaufbau des Listenteils)
- Modify: `frontend/src/pages/LagemeldungenPage.test.tsx`
- Modify: `frontend/src/components/datensicht.guard.test.ts:200,273` (`NUR_KARTE` + `KONSUMENTEN` um `/src/pages/LagemeldungenPage.tsx`)

**Interfaces:**
- Consumes: `meldungenPfad(einsatzId, { meldung })`, `ZeitAnzeige`, `Datensicht`/`spaltenFuer`, `alsOrtszeit`.
- Produces (rein, exportiert): `tagesSchluessel(erstellt_at: string): string` (lokales `YYYY-MM-DD`), `tagesEtikett(schluessel: string, heute = dayjs()): string` („Heute" / „Gestern" / `DD.MM.YYYY`), `imZeitfenster(erstellt_at, fenster: 'stunde' | 'vierStunden' | 'heute' | 'alle', jetzt = dayjs()): boolean`.

- [ ] **Step 1: Tests** (Bestandstest „Herkunft"-Text wird auf Regex/Teilstring umgestellt, weil ein Link darin liegt):

```tsx
it('zeigt die Zeit führend und verlinkt die Quellmeldung über meldungenPfad', async () => {
  renderPage();
  expect(await screen.findByText('Brücke gesperrt')).toBeInTheDocument();
  const link = screen.getByRole('link', { name: 'Meldung #5' });
  expect(link).toHaveAttribute('href', '/einsaetze/1/meldungen?meldung=3');
  // Zeit taktisch (`kurz`): 2026-06-12 09:00 UTC ist nicht heute → „DDHHmm" in Ortszeit.
  expect(screen.getByText(alsOrtszeit('2026-06-12 09:00:00')!.format('DDHHmm'))).toBeInTheDocument();
});

it('gruppiert nach Tag, jüngste zuerst', async () => {
  listeLageMeldungen.mockResolvedValue([
    lage({ id: 1, erstellt_at: '2026-06-12 09:00:00', text: 'Alt' }),
    lage({ id: 2, erstellt_at: '2026-06-13 07:00:00', text: 'Neu' }),
  ]);
  renderPage();
  const sicht = await screen.findByRole('region', { name: 'Lagemeldungen' });
  const text = sicht.textContent ?? '';
  expect(text.indexOf('Neu')).toBeLessThan(text.indexOf('Alt'));
  expect(text.indexOf('13.06.2026')).toBeLessThan(text.indexOf('12.06.2026'));
});

it('filtert auf Einträge mit Koordinaten', async () => {
  listeLageMeldungen.mockResolvedValue([lage({ id: 1, text: 'Ohne' }), lage({ id: 2, text: 'Mit', lat: 50, lon: 8 })]);
  renderPage();
  await screen.findByText('Ohne');
  // Spaltenfilter des Primitivs — Bedienweg wie in Datensicht.test.tsx (Filterknopf → Wert).
  …
  expect(screen.queryByText('Ohne')).toBeNull();
  expect(screen.getByText('Mit')).toBeInTheDocument();
});
```
Für den Filter-Bedienweg `grep -n "filter" frontend/src/components/Datensicht.test.tsx | head` lesen und das dortige Muster übernehmen. Zusätzlich reine Tests für `imZeitfenster` (Grenzen: 59 min drin, 61 min draußen bei `stunde`; „heute" in Ortszeit) und `tagesEtikett`.

`renderPage()` braucht den `EinsatzAnzeigeProvider`? Nein — `ZeitAnzeige` fällt auf `DEFAULT_KONVENTIONEN` zurück. `renderPage` braucht aber `ConfigProvider`? Das Primitiv nutzt `theme.useToken()` — antd liefert Default-Token ohne Provider. OK.

- [ ] **Step 2: rot**, **Step 3: Seite**

```tsx
const lagemeldungSpalten = spaltenFuer<LageMeldung>()([
  { key: 'text', title: 'Meldung', immerSichtbar: true, suchText: (l) => l.text, render: (_t, l) => l.text },
  { key: 'zeit', title: 'Zeit', sortWert: (l) => l.erstellt_at,
    filter: { werte: [{ text: 'Letzte Stunde', value: 'stunde' }, { text: 'Letzte 4 Stunden', value: 'vierStunden' }, { text: 'Heute', value: 'heute' }],
              trifft: (l, w) => imZeitfenster(l.erstellt_at, w as Zeitfenster) },
    render: (_t, l) => <ZeitAnzeige wert={l.erstellt_at} format="kurz" /> },
  { key: 'herkunft', title: 'Herkunft', suchText: (l) => `${l.meldung_lfd_nr} ${l.meldung_absender}`,
    render: (_t, l) => <>Herkunft: <Link to={meldungenPfad(l.einsatz_id, { meldung: l.meldung_id })}>Meldung #{l.meldung_lfd_nr}</Link> von {l.meldung_absender}</> },
  { key: 'ort', title: 'Ort',
    filter: { werte: [{ text: 'Mit Koordinaten', value: 'mit' }, { text: 'Ohne Koordinaten', value: 'ohne' }],
              trifft: (l, w) => (l.lat != null && l.lon != null) === (w === 'mit') },
    render: (_t, l) => l.lat != null && l.lon != null
      ? <KoordinatenAnzeige lat={l.lat} lon={l.lon} einsatzId={l.einsatz_id} exclude={`lagemeldung:${l.id}`} />
      : null },
]);
…
<Datensicht
  bezeichnung="Lagemeldungen"
  form="karte"
  spalten={lagemeldungSpalten}
  daten={eintraege}
  zeilenSchluessel="id"
  ladend={lageQuery.isLoading}
  leerText="Noch keine lagerelevanten Meldungen übergeben"
  suche={{ platzhalter: 'Meldungstext oder Absender' }}
  standardSortierung={{ spalte: 'zeit', richtung: 'ab' }}
  gruppen={{ schluessel: (l) => tagesSchluessel(l.erstellt_at), etikett: (s) => tagesEtikett(s) }}
  karte={{ art: 'plan', titel: { spalte: 'text' }, sekundaer: ['zeit', 'herkunft', 'ort'] }}
/>
```
Gruppenreihenfolge: `Gruppierung.reihenfolge` fehlt → „Antreffreihenfolge" nach Sortierung (jüngste zuerst) — prüfen, ob `gruppiere()` die Reihenfolge aus den sortierten Daten nimmt (`Datensicht.tsx:513`); falls es alphabetisch sortiert, `reihenfolge` aus den sortierten Schlüsseln absteigend berechnen. `SeitenLeer` bleibt für den Leerfall wie bisher (Leerzustand-Test „kein .ant-empty" bleibt grün, weil `leerText` gesetzt ist — beide Wege prüfen). `Tag color="gold"` entfällt (Farbfläche ohne Aussage; die Seite heisst schon „Lagerelevante Meldungen").

- [ ] **Step 4: Guard-Listen ergänzen**, `… exec vitest run src/components/datensicht.guard.test.ts src/pages/LagemeldungenPage.test.tsx` grün.

- [ ] **Step 5: `grep -rn 'einsaetze/\${' frontend/src/pages/LagemeldungenPage.tsx` → 0 Treffer.**

- [ ] **Step 6: Commit** `feat(lfh-348): Lagemeldungen mit Zeit, Rückweg zur Meldung, Tagesgruppen und Filter (M85)`

---

### Task 8: e2e-Schwelle, Prüfliste, CLAUDE.md, Gate

**Files:**
- Modify: `frontend/e2e/lagebericht-schmal.spec.ts` (`MAX_HOEHE`)
- Create: `docs/superpowers/specs/2026-08-28-lfh-348-pruefliste.md`
- Modify: `CLAUDE.md` (ein Absatz im Bedien-Leitlinien-Block, nach dem C12-Absatz)

- [ ] **Step 1: `MAX_HOEHE = Math.round(N / 2)`** mit N aus Task 0; Spec laufen lassen → grün; gemessene neue Höhe in die Prüfliste.

- [ ] **Step 2: Prüfliste** nach dem Muster `2026-08-28-lfh-347-pruefliste.md`: drei Flächen (Detailseite · Berichtsliste · Lagemeldungen), je 15 Zeilen mit Verdikt; Abschnitt „Die gemessenen Zahlen" (Bestandshöhe N, neue Höhe, Schwelle); Abschnitt „Abweichungen vom Ticket" (die drei aus Global Constraints, mit Begründung); Abschnitt „AK-Korrekturen": `useBlocker/beforeunload repo-weit 0` war zum Ticketzeitpunkt richtig, seit C7 falsch.

- [ ] **Step 3: CLAUDE.md-Absatz** (kurz, im Stil der Nachbarn):

> - **Der Verlustschutz eines Entwurfs ist ein Hook, keine Seitenlogik** (LFH-348 · C13). `entwurf/useEntwurfVerlustschutz.ts` trägt Riegel, Autosave (30 s + Blur), `beforeunload` und den Zeitstempel; `BefehlDetailPage` und `LageberichtDetailPage` konsumieren ihn — und beide rendern ihren Inhalt mit `key={<id>}`, weil der Merker zu EINEM Datensatz gehört und ein Routenwechsel auf dieselbe Komponente ihn sonst mitnähme. Das Ticket verlangte `form.isFieldsTouched()` und ein lokales `useEntwurf`; beides ist bewusst nicht gebaut (C7-Begründung; ein lokaler Entwurf neben dem Server-Autosave wäre eine zweite Wahrheit). Die Lageberichte-Liste zeigt **Kettenköpfe** (`lageberichte/ketten.ts`), die Lagemeldungen sind die **zwölfte** `Datensicht`-Konsumentin.

- [ ] **Step 4: Gate**: `./scripts/check-all.sh` (mit `rtk proxy` für ehrlichen Exit-Code). Flakes unter Last gemäß Memory einzeln nachfahren.

- [ ] **Step 5: Commit** `docs(lfh-348): Prüfliste Einsatztauglichkeit, e2e-Schwelle, CLAUDE.md`

---

## Self-Review

- **Spec-Abdeckung:** H62 → Task 4 (+0/8 Messung); H63 → Task 1/2; Autosave/Verlassen → Task 1/2 (Server-Variante, Abweichung benannt); M86 → LFH-350, nicht hier; N23 Ketten → Task 5; Modal/Zeitstand → Task 3/6; M85 → Task 7; AK 390 px + grep → Task 0/7/8; AK check-all → Task 8; Prüfliste → Task 8.
- **Platzhalter:** Task 2 Step 1 (dritter Test) und Task 7 Step 1 (Filter-Bedienweg) verweisen auf ein im Repo zu lesendes Muster — der Ausführende schreibt den Test nach dem gelesenen Muster fertig, das ist kein TBD am Produktivcode.
- **Typkonsistenz:** `useEntwurfVerlustschutz<D, W>` Signatur in Task 1 = Nutzung in Task 1 Step 5 und Task 2 Step 3; `abschnittAnkerId`/`befuellteAbschnitte` in Task 4 durchgängig; `KettenKopf` in Task 5; `alsOrtszeit`/`alsBackendZeit` aus `etb/filterZeit` in Task 3/6/7.
