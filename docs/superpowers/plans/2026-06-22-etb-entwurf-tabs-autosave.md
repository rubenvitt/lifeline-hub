# ETB-Entwürfe: Tabs + lokales Autosave (LFH-142) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Beim Erfassen von ETB-Einträgen mehrere Entwürfe parallel als Tabs offen halten und lokal automatisch sichern (Autosave), sodass nichts bei Reload/Schließen verloren geht.

**Architecture:** Eine neue, eigene IndexedDB-Datenbank (`lifeline-etb-entwuerfe`, getrennt von der Offline-Sync-Queue `lifeline-offline`) persistiert *unfertige* Entwürfe pro Einsatz. Ein Hook `useEtbEntwuerfe` verwaltet die offene Tab-Liste + aktiven Tab; die bestehende `Schnellerfassung` wird minimal erweitert (Initialwerte rein, Wertänderungen raus), und ein neuer Container `EtbEntwurfsTabs` rendert die antd-`editable-card`-Tabs. Berichtigung bleibt ein separater, transienter Modus und wird in `EtbPage` per Conditional-Render aus den Tabs herausgehalten.

**Tech Stack:** React 18 + TypeScript, antd 5 (`Tabs`), `idb` 8 (IndexedDB), `@tanstack/react-query`, dayjs (utc), Vitest + Testing Library + `fake-indexeddb/auto`.

## Global Constraints

- **Reines Frontend.** Keine Backend-/API-/Migrations-Änderungen. Der Absende-Pfad bleibt `erfasseEtb` über den bestehenden `useEtbErfassung`-Hook.
- **pnpm via mise**, immer absolute `-C`-Pfade. Worktree-Root: `/Users/rubeen/dev/personal/lifeline-hub/.claude/worktrees/feat+lfh-142-etb-entwurf-tabs`. Frontend-Root: `<worktree>/frontend`.
  - Test (einzeln): `mise exec pnpm@11.0.9 -- pnpm -C <frontend-root> exec vitest run <pfad> -t '<name>'`
  - Test (Gate): `mise exec pnpm@11.0.9 -- pnpm -C <frontend-root> exec vitest run --no-file-parallelism`
  - Typecheck: `mise exec pnpm@11.0.9 -- pnpm -C <frontend-root> exec tsc --noEmit`
  - Lint: `mise exec pnpm@11.0.9 -- pnpm -C <frontend-root> exec eslint .`
- **Serialisierbarkeit:** In IndexedDB darf **kein** `dayjs`-Objekt landen (structured clone verliert die Methoden). `ereigniszeit` wird im Store als ISO-String gehalten und nur an der Grenze (`entwurfModell`) nach `dayjs` und zurück konvertiert.
- **Draft ≠ Offline-Queue:** Dieses Feature speichert *noch nicht abgesendete* Entwürfe. Die Offline-Queue (`src/offline/queue.ts`) speichert *bereits abgesendete*, auf Sync wartende Einträge. Getrennte DBs, getrennter Lifecycle. Sie treffen sich nur beim Absende-Handoff.
- **Draft-Löschung beim Absenden:** Ein Entwurf wird entfernt, **wenn `erfassen()` ohne Exception zurückkehrt** (= erfolgreich gesendet *oder* offline eingereiht), **nicht** erst bei Server-Ack. Bei fachlicher Ablehnung (Exception) bleibt der Entwurf erhalten.
- **Test-Isolation für idb:** `fake-indexeddb/auto` persistiert zwischen Tests im selben Lauf. Jede Test-Datei, die den Entwurf-Store berührt, ruft `entwuerfeLeerenFuerTests()` in `beforeEach` (analog `queueLeerenFuerTests`).
- **e2e nicht brechen** (`frontend/e2e/kernfluss.spec.ts`): Der Placeholder muss weiter mit `Inhalt …` beginnen, der `Erfassen`-Button erhalten bleiben, und beim Öffnen muss ein leerer Entwurf-Tab aktiv sein (Entscheidung „immer ein leerer Tab offen").

## File Structure

**Neu (`frontend/src/etb/entwuerfe/`):**
- `entwurfModell.ts` — Typen (`EtbEntwurf` serialisierbar, `EntwurfWerte` mit dayjs), Konvertierung `zuWerte`/`werteZuPatch`, `entwurfLabel`, `istLeer`. Reine Funktionen.
- `entwurfStore.ts` — IndexedDB-CRUD über `idb` (`entwuerfeLaden`, `entwurfSpeichern`, `entwurfEntfernen`, `entwuerfeLeerenFuerTests`).
- `useEtbEntwuerfe.ts` — Hook: lädt Entwürfe pro Einsatz, hält offene Tab-Liste + aktiven Tab, garantiert min. 1 Tab, persistiert Edits, löscht beim Schließen/Absenden.
- `EtbEntwurfsTabs.tsx` — antd `editable-card`-Tabs; rendert pro aktivem Tab eine `Schnellerfassung`; wrappt `erfassen` so, dass nach Erfolg geschlossen wird.
- Tests: `entwurfModell.test.ts`, `entwurfStore.test.ts`, `useEtbEntwuerfe.test.tsx`, `EtbEntwurfsTabs.test.tsx`.

**Modifiziert:**
- `frontend/src/etb/Schnellerfassung.tsx` (+ `Schnellerfassung.test.tsx`) — optionale Props `initialWerte` + `onWerteChange`.
- `frontend/src/pages/EtbPage.tsx` (+ `EtbPage.test.tsx`) — Conditional-Render Berichtigung vs. Tabs.

---

### Task 1: Entwurf-Modell (Typen + Konvertierung)

**Files:**
- Create: `frontend/src/etb/entwuerfe/entwurfModell.ts`
- Test: `frontend/src/etb/entwuerfe/entwurfModell.test.ts`

**Interfaces:**
- Consumes: `EtbTyp`, `MeldeWeg` aus `../../api/types`; `MetadatenWerte` aus `../schnellerfassungModell`.
- Produces:
  - `interface EtbEntwurf { id: string; einsatz_id: number; inhalt: string; typ: EtbTyp; von?: string; an?: string; meldeweg?: MeldeWeg; veranlassung?: string; ereigniszeit?: string; erstellt_at: string; geaendert_at: string; }` (serialisierbar; `ereigniszeit` als ISO-String)
  - `interface EntwurfWerte { inhalt: string; typ: EtbTyp; metadaten: MetadatenWerte }` (mit dayjs)
  - `zuWerte(e: EtbEntwurf): EntwurfWerte`
  - `werteZuPatch(w: EntwurfWerte): { inhalt: string; typ: EtbTyp; von?: string; an?: string; meldeweg?: MeldeWeg; veranlassung?: string; ereigniszeit?: string }` (serialisierbarer Teil)
  - `entwurfLabel(e: EtbEntwurf): string` (erste nicht-leere Zeile, gekürzt; sonst `'Neuer Eintrag'`)
  - `istLeer(w: EntwurfWerte): boolean` (kein Inhalt-Text und keine gesetzten Metadaten)

- [ ] **Step 1: Write the failing test**

```ts
// frontend/src/etb/entwuerfe/entwurfModell.test.ts
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import { describe, expect, it } from 'vitest';
import type { EtbEntwurf } from './entwurfModell';
import { entwurfLabel, istLeer, werteZuPatch, zuWerte } from './entwurfModell';

dayjs.extend(utc);

function entwurf(over: Partial<EtbEntwurf> = {}): EtbEntwurf {
  return {
    id: 'a', einsatz_id: 7, inhalt: '', typ: 'meldung',
    erstellt_at: '2026-06-22T10:00:00.000Z', geaendert_at: '2026-06-22T10:00:00.000Z', ...over,
  };
}

describe('zuWerte', () => {
  it('wandelt ereigniszeit (ISO) zurück in ein dayjs-Objekt', () => {
    const w = zuWerte(entwurf({ ereigniszeit: '2026-06-22T08:30:00.000Z', von: 'ELW 1', typ: 'lage', inhalt: 'X' }));
    expect(w.inhalt).toBe('X');
    expect(w.typ).toBe('lage');
    expect(w.metadaten.von).toBe('ELW 1');
    expect(dayjs.isDayjs(w.metadaten.ereigniszeit)).toBe(true);
    expect(w.metadaten.ereigniszeit!.toISOString()).toBe('2026-06-22T08:30:00.000Z');
  });
  it('lässt ereigniszeit weg, wenn nicht gesetzt', () => {
    expect(zuWerte(entwurf()).metadaten.ereigniszeit).toBeUndefined();
  });
});

describe('werteZuPatch', () => {
  it('serialisiert ein dayjs-ereigniszeit zu ISO und lässt leere Felder weg', () => {
    const patch = werteZuPatch({
      inhalt: 'Lage', typ: 'meldung',
      metadaten: { von: 'ELW 1', ereigniszeit: dayjs.utc('2026-06-22T08:30:00.000Z'), an: '' as unknown as string },
    });
    expect(patch).toMatchObject({ inhalt: 'Lage', typ: 'meldung', von: 'ELW 1', ereigniszeit: '2026-06-22T08:30:00.000Z' });
    expect(patch.an).toBeUndefined();
  });
});

describe('entwurfLabel', () => {
  it('nimmt die erste nicht-leere Zeile, gekürzt', () => {
    expect(entwurfLabel(entwurf({ inhalt: '  \nPumpe läuft\nZeile 2' }))).toBe('Pumpe läuft');
    expect(entwurfLabel(entwurf({ inhalt: 'x'.repeat(50) }))).toBe(`${'x'.repeat(30)} …`);
  });
  it('fällt auf „Neuer Eintrag" zurück, wenn leer', () => {
    expect(entwurfLabel(entwurf({ inhalt: '   ' }))).toBe('Neuer Eintrag');
  });
});

describe('istLeer', () => {
  it('true bei leerem Inhalt und ohne Metadaten', () => {
    expect(istLeer({ inhalt: '   ', typ: 'meldung', metadaten: {} })).toBe(true);
  });
  it('false sobald Inhalt oder ein Metadatenfeld gesetzt ist', () => {
    expect(istLeer({ inhalt: 'x', typ: 'meldung', metadaten: {} })).toBe(false);
    expect(istLeer({ inhalt: '', typ: 'meldung', metadaten: { von: 'ELW 1' } })).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `mise exec pnpm@11.0.9 -- pnpm -C <frontend-root> exec vitest run src/etb/entwuerfe/entwurfModell.test.ts`
Expected: FAIL — `Cannot find module './entwurfModell'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// frontend/src/etb/entwuerfe/entwurfModell.ts
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import type { EtbTyp, MeldeWeg } from '../../api/types';
import type { MetadatenWerte } from '../schnellerfassungModell';

dayjs.extend(utc);

/** Serialisierbarer Entwurf, wie er in IndexedDB liegt. `ereigniszeit` ist ISO-String. */
export interface EtbEntwurf {
  id: string;
  einsatz_id: number;
  inhalt: string;
  typ: EtbTyp;
  von?: string;
  an?: string;
  meldeweg?: MeldeWeg;
  veranlassung?: string;
  ereigniszeit?: string;
  erstellt_at: string;
  geaendert_at: string;
}

/** Compose-Werte, wie die Schnellerfassung sie intern hält (mit dayjs). */
export interface EntwurfWerte {
  inhalt: string;
  typ: EtbTyp;
  metadaten: MetadatenWerte;
}

export function zuWerte(e: EtbEntwurf): EntwurfWerte {
  return {
    inhalt: e.inhalt,
    typ: e.typ,
    metadaten: {
      von: e.von,
      an: e.an,
      meldeweg: e.meldeweg,
      veranlassung: e.veranlassung,
      ereigniszeit: e.ereigniszeit ? dayjs.utc(e.ereigniszeit) : undefined,
    },
  };
}

type EntwurfPatch = Pick<EtbEntwurf, 'inhalt' | 'typ' | 'von' | 'an' | 'meldeweg' | 'veranlassung' | 'ereigniszeit'>;

export function werteZuPatch(w: EntwurfWerte): EntwurfPatch {
  const m = w.metadaten;
  return {
    inhalt: w.inhalt,
    typ: w.typ,
    von: m.von || undefined,
    an: m.an || undefined,
    meldeweg: m.meldeweg || undefined,
    veranlassung: m.veranlassung || undefined,
    ereigniszeit: m.ereigniszeit ? m.ereigniszeit.utc().toISOString() : undefined,
  };
}

const LABEL_MAX = 30;

export function entwurfLabel(e: EtbEntwurf): string {
  const ersteZeile = e.inhalt.split('\n').map((z) => z.trim()).find((z) => z.length > 0);
  if (!ersteZeile) return 'Neuer Eintrag';
  return ersteZeile.length > LABEL_MAX ? `${ersteZeile.slice(0, LABEL_MAX)} …` : ersteZeile;
}

export function istLeer(w: EntwurfWerte): boolean {
  const m = w.metadaten;
  const hatMeta = Boolean(m.von || m.an || m.meldeweg || m.veranlassung || m.ereigniszeit);
  return w.inhalt.trim() === '' && !hatMeta;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `mise exec pnpm@11.0.9 -- pnpm -C <frontend-root> exec vitest run src/etb/entwuerfe/entwurfModell.test.ts`
Expected: PASS (alle Cases grün).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/etb/entwuerfe/entwurfModell.ts frontend/src/etb/entwuerfe/entwurfModell.test.ts
git commit -m "feat(etb): Entwurf-Modell + dayjs/ISO-Konvertierung (LFH-142)"
```

---

### Task 2: Entwurf-Store (IndexedDB-CRUD)

**Files:**
- Create: `frontend/src/etb/entwuerfe/entwurfStore.ts`
- Test: `frontend/src/etb/entwuerfe/entwurfStore.test.ts`

**Interfaces:**
- Consumes: `EtbEntwurf` aus `./entwurfModell`.
- Produces:
  - `entwuerfeLaden(einsatzId: number): Promise<EtbEntwurf[]>` (aufsteigend nach `erstellt_at`)
  - `entwurfSpeichern(entwurf: EtbEntwurf): Promise<void>` (put — insert *oder* update über `id`)
  - `entwurfEntfernen(id: string): Promise<void>`
  - `entwuerfeLeerenFuerTests(): Promise<void>`

Eigene DB `lifeline-etb-entwuerfe` v1 (NICHT die `lifeline-offline`-DB erweitern — zwei `openDB`-Aufrufe mit verschiedenen Versionen auf denselben Namen blockieren sich).

- [ ] **Step 1: Write the failing test**

```ts
// frontend/src/etb/entwuerfe/entwurfStore.test.ts
import { beforeEach, describe, expect, it } from 'vitest';
import type { EtbEntwurf } from './entwurfModell';
import { entwuerfeLaden, entwuerfeLeerenFuerTests, entwurfEntfernen, entwurfSpeichern } from './entwurfStore';

function entwurf(over: Partial<EtbEntwurf> = {}): EtbEntwurf {
  return {
    id: 'a', einsatz_id: 7, inhalt: 'X', typ: 'meldung',
    erstellt_at: '2026-06-22T10:00:00.000Z', geaendert_at: '2026-06-22T10:00:00.000Z', ...over,
  };
}

beforeEach(async () => {
  await entwuerfeLeerenFuerTests();
});

describe('entwurfStore', () => {
  it('speichert und lädt Entwürfe gescopet pro Einsatz, sortiert nach erstellt_at', async () => {
    await entwurfSpeichern(entwurf({ id: 'b', erstellt_at: '2026-06-22T11:00:00.000Z' }));
    await entwurfSpeichern(entwurf({ id: 'a', erstellt_at: '2026-06-22T10:00:00.000Z' }));
    await entwurfSpeichern(entwurf({ id: 'c', einsatz_id: 99 }));

    const liste = await entwuerfeLaden(7);
    expect(liste.map((e) => e.id)).toEqual(['a', 'b']); // c gehört zu Einsatz 99
  });

  it('put aktualisiert einen bestehenden Entwurf (gleiche id)', async () => {
    await entwurfSpeichern(entwurf({ id: 'a', inhalt: 'alt' }));
    await entwurfSpeichern(entwurf({ id: 'a', inhalt: 'neu' }));
    const liste = await entwuerfeLaden(7);
    expect(liste).toHaveLength(1);
    expect(liste[0].inhalt).toBe('neu');
  });

  it('entfernt einen Entwurf', async () => {
    await entwurfSpeichern(entwurf({ id: 'a' }));
    await entwurfEntfernen('a');
    expect(await entwuerfeLaden(7)).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `mise exec pnpm@11.0.9 -- pnpm -C <frontend-root> exec vitest run src/etb/entwuerfe/entwurfStore.test.ts`
Expected: FAIL — `Cannot find module './entwurfStore'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// frontend/src/etb/entwuerfe/entwurfStore.ts
import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { EtbEntwurf } from './entwurfModell';

interface EntwurfDB extends DBSchema {
  entwuerfe: {
    key: string;
    value: EtbEntwurf;
    indexes: { 'by-einsatz': number };
  };
}

let dbPromise: Promise<IDBPDatabase<EntwurfDB>> | null = null;

function db(): Promise<IDBPDatabase<EntwurfDB>> {
  if (!dbPromise) {
    dbPromise = openDB<EntwurfDB>('lifeline-etb-entwuerfe', 1, {
      upgrade(d) {
        const store = d.createObjectStore('entwuerfe', { keyPath: 'id' });
        store.createIndex('by-einsatz', 'einsatz_id');
      },
    });
  }
  return dbPromise;
}

/** Entwürfe eines Einsatzes, aufsteigend nach erstellt_at (älteste zuerst → stabile Tab-Reihenfolge). */
export async function entwuerfeLaden(einsatzId: number): Promise<EtbEntwurf[]> {
  const d = await db();
  const alle = await d.getAllFromIndex('entwuerfe', 'by-einsatz', einsatzId);
  return alle.sort((a, b) => a.erstellt_at.localeCompare(b.erstellt_at));
}

export async function entwurfSpeichern(entwurf: EtbEntwurf): Promise<void> {
  const d = await db();
  await d.put('entwuerfe', entwurf);
}

export async function entwurfEntfernen(id: string): Promise<void> {
  const d = await db();
  await d.delete('entwuerfe', id);
}

/** Nur für Tests: leert den Store (fake-indexeddb persistiert sonst zwischen Tests). */
export async function entwuerfeLeerenFuerTests(): Promise<void> {
  const d = await db();
  await d.clear('entwuerfe');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `mise exec pnpm@11.0.9 -- pnpm -C <frontend-root> exec vitest run src/etb/entwuerfe/entwurfStore.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/etb/entwuerfe/entwurfStore.ts frontend/src/etb/entwuerfe/entwurfStore.test.ts
git commit -m "feat(etb): IndexedDB-Store für ETB-Entwürfe (LFH-142)"
```

---

### Task 3: Schnellerfassung — Initialwerte rein, Wertänderungen raus

**Files:**
- Modify: `frontend/src/etb/Schnellerfassung.tsx`
- Test: `frontend/src/etb/Schnellerfassung.test.tsx` (neue Tests; bestehende müssen grün bleiben)

**Interfaces:**
- Consumes: `EntwurfWerte` aus `./entwuerfe/entwurfModell`.
- Produces (neue, optionale Props auf `Schnellerfassung`):
  - `initialWerte?: EntwurfWerte` — Startwerte für `inhalt`/`typ`/`metadaten`.
  - `onWerteChange?: (werte: EntwurfWerte) => void` — feuert bei *echten* Edits (nicht beim Mount).

Verhalten: `onWerteChange` darf **nicht** beim Mount feuern (skip-first-run-Guard), sonst entsteht pro Tab-Wechsel/Reload ein redundanter idb-Write. Der bisherige `useEffect([berichtigungZu])`, der den State leerte, entfällt — das Clearing übernimmt der `key`-basierte Remount im Container; nur Fokus-on-Mount bleibt.

- [ ] **Step 1: Write the failing tests** (an `Schnellerfassung.test.tsx` anhängen)

```ts
// ergänzende Imports oben in der Datei (falls noch nicht vorhanden):
// import type { EntwurfWerte } from './entwuerfe/entwurfModell';

describe('Schnellerfassung – Entwurf-Anbindung', () => {
  it('übernimmt initialWerte in das Eingabefeld', () => {
    const p = props({ initialWerte: { inhalt: 'Vorbefüllt', typ: 'meldung', metadaten: {} } });
    renderMitProviders(<Schnellerfassung {...p} />);
    expect(screen.getByPlaceholderText(/Inhalt/)).toHaveValue('Vorbefüllt');
  });

  it('feuert onWerteChange NICHT beim Mount', () => {
    const onWerteChange = vi.fn();
    const p = props({ initialWerte: { inhalt: 'Vorbefüllt', typ: 'meldung', metadaten: {} }, onWerteChange });
    renderMitProviders(<Schnellerfassung {...p} />);
    expect(onWerteChange).not.toHaveBeenCalled();
  });

  it('feuert onWerteChange bei echter Eingabe mit aktuellem Inhalt', async () => {
    const onWerteChange = vi.fn();
    const p = props({ onWerteChange });
    renderMitProviders(<Schnellerfassung {...p} />);
    await userEvent.type(screen.getByPlaceholderText(/Inhalt/), 'Hi');
    await waitFor(() => expect(onWerteChange).toHaveBeenCalled());
    const letzter = onWerteChange.mock.calls.at(-1)![0] as EntwurfWerte;
    expect(letzter.inhalt).toBe('Hi');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `mise exec pnpm@11.0.9 -- pnpm -C <frontend-root> exec vitest run src/etb/Schnellerfassung.test.ts -t 'Entwurf-Anbindung'`
Expected: FAIL — `initialWerte`/`onWerteChange` sind noch keine Props (TS-Fehler bzw. `toHaveValue('Vorbefüllt')` schlägt fehl).

- [ ] **Step 3: Implement**

In `frontend/src/etb/Schnellerfassung.tsx`:

a) Import ergänzen:
```ts
import type { EntwurfWerte } from './entwuerfe/entwurfModell';
```

b) `Props`-Interface erweitern:
```ts
interface Props {
  erfassen: (eintrag: NeuerEintrag) => Promise<void>;
  berichtigungZu: EtbEintragAnzeige | null;
  onBerichtigungAbbrechen: () => void;
  bausteine: EtbBaustein[];
  einsatz: EinsatzAnzeige;
  initialWerte?: EntwurfWerte;
  onWerteChange?: (werte: EntwurfWerte) => void;
}
```

c) Destructuring + State-Init aus `initialWerte`:
```ts
export default function Schnellerfassung({
  erfassen, berichtigungZu, onBerichtigungAbbrechen, bausteine, einsatz, initialWerte, onWerteChange,
}: Props) {
  // ...
  const [inhalt, setInhalt] = useState(initialWerte?.inhalt ?? '');
  const [typ, setTyp] = useState<EtbTyp>(initialWerte?.typ ?? 'meldung');
  const [metadaten, setMetadaten] = useState<MetadatenWerte>(initialWerte?.metadaten ?? {});
```

d) Den bisherigen Berichtigungs-Clear-Effekt
```ts
  useEffect(() => {
    setInhalt(''); setMetadaten({}); setEditFeld(null); setMenuOffen(false);
    textRef.current?.focus();
  }, [berichtigungZu]);
```
ersetzen durch reinen Fokus-on-Mount (Clearing erledigt der `key`-Remount im Container):
```ts
  // Fokus beim Mount. State-Reset bei Tab-/Modus-Wechsel erfolgt über key-basiertes
  // Remounting im Container (EtbEntwurfsTabs / EtbPage-Berichtigung).
  useEffect(() => {
    textRef.current?.focus();
  }, []);
```

e) Autosave-Trigger mit skip-first-run-Guard hinzufügen (nach den State-Deklarationen):
```ts
  // onWerteChange in einer Ref halten: Der Autosave-Effekt darf NUR auf echte
  // Wertänderungen (inhalt/typ/metadaten) feuern — nicht, wenn der Container bei
  // jedem Render eine neue Callback-Referenz liefert. Stünde onWerteChange in den
  // Effekt-Deps, triggerte jedes Container-Re-Render (das entwurfAktualisieren
  // auslöst) den Effekt erneut → Re-Trigger-/Endlosschleife.
  const onWerteChangeRef = useRef(onWerteChange);
  useEffect(() => {
    onWerteChangeRef.current = onWerteChange;
  }, [onWerteChange]);

  const ersterRender = useRef(true);
  useEffect(() => {
    if (ersterRender.current) {
      ersterRender.current = false;
      return; // kein Write beim Mount/initialem Laden
    }
    onWerteChangeRef.current?.({ inhalt, typ, metadaten });
  }, [inhalt, typ, metadaten]);
```

(`useRef` ist bereits importiert.)

- [ ] **Step 4: Run the new + existing Schnellerfassung tests**

Run: `mise exec pnpm@11.0.9 -- pnpm -C <frontend-root> exec vitest run src/etb/Schnellerfassung.test.ts`
Expected: PASS — neue Entwurf-Anbindung-Tests grün **und** alle bestehenden (Enter sendet, Berichtigungsmodus, Bausteine, …) weiter grün.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/etb/Schnellerfassung.tsx frontend/src/etb/Schnellerfassung.test.tsx
git commit -m "feat(etb): Schnellerfassung mit initialWerte + onWerteChange (LFH-142)"
```

---

### Task 4: Hook `useEtbEntwuerfe`

**Files:**
- Create: `frontend/src/etb/entwuerfe/useEtbEntwuerfe.ts`
- Test: `frontend/src/etb/entwuerfe/useEtbEntwuerfe.test.tsx`

**Interfaces:**
- Consumes: `entwuerfeLaden`, `entwurfSpeichern`, `entwurfEntfernen` aus `./entwurfStore`; `EtbEntwurf`, `EntwurfWerte`, `werteZuPatch`, `istLeer` aus `./entwurfModell`.
- Produces:
  - `useEtbEntwuerfe(einsatzId: number): { entwuerfe: EtbEntwurf[]; aktiverId: string | null; neuerEntwurf: () => void; entwurfSchliessen: (id: string) => Promise<void>; entwurfAktualisieren: (id: string, werte: EntwurfWerte) => void; aktivenSetzen: (id: string) => void; }`

Verhalten:
- Beim Mount: erst `entwuerfeLaden` awaiten, **dann** min-1-Garantie (leere Liste → ein neuer In-Memory-Entwurf). Double-Create-Guard, damit StrictMode/Re-Run keinen zweiten Leertab mintet.
- Aktiver Tab in `localStorage` unter `etb-entwurf-aktiv-${einsatzId}` (übersteht Reload); beim Laden gewählten Tab wiederherstellen, falls noch vorhanden, sonst ersten.
- `neuerEntwurf`: In-Memory-Entwurf (id via `crypto.randomUUID()`, leere Felder), aktivieren. **Kein** idb-Write (leere Entwürfe füllen die DB nicht).
- `entwurfAktualisieren`: In-Memory-Liste sofort aktualisieren (treibt Live-Tab-Label); persistiert direkt nach idb (kein Debounce — Datensicherheit bei Reload). `istLeer` → aus idb entfernen statt schreiben.
- `entwurfSchliessen`: aus idb entfernen + aus Liste; ist die Liste danach leer → neuen leeren In-Memory-Entwurf anlegen + aktivieren; sonst Nachbarn aktivieren. Deckt manuelles Schließen **und** Schließen nach erfolgreichem Absenden ab.

- [ ] **Step 1: Write the failing test**

```tsx
// frontend/src/etb/entwuerfe/useEtbEntwuerfe.test.tsx
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { entwuerfeLaden, entwuerfeLeerenFuerTests, entwurfSpeichern } from './entwurfStore';
import type { EtbEntwurf } from './entwurfModell';
import { useEtbEntwuerfe } from './useEtbEntwuerfe';

function entwurf(over: Partial<EtbEntwurf> = {}): EtbEntwurf {
  return {
    id: 'vorhanden', einsatz_id: 7, inhalt: 'Bestand', typ: 'meldung',
    erstellt_at: '2026-06-22T10:00:00.000Z', geaendert_at: '2026-06-22T10:00:00.000Z', ...over,
  };
}

beforeEach(async () => {
  await entwuerfeLeerenFuerTests();
  localStorage.clear();
});

describe('useEtbEntwuerfe', () => {
  it('garantiert nach dem Laden mindestens einen (leeren) Entwurf', async () => {
    const { result } = renderHook(() => useEtbEntwuerfe(7));
    await waitFor(() => expect(result.current.entwuerfe).toHaveLength(1));
    expect(result.current.entwuerfe[0].inhalt).toBe('');
    expect(result.current.aktiverId).toBe(result.current.entwuerfe[0].id);
  });

  it('lädt vorhandene Entwürfe statt einen neuen anzulegen', async () => {
    await entwurfSpeichern(entwurf());
    const { result } = renderHook(() => useEtbEntwuerfe(7));
    await waitFor(() => expect(result.current.entwuerfe).toHaveLength(1));
    expect(result.current.entwuerfe[0].inhalt).toBe('Bestand');
  });

  it('persistiert einen Entwurf erst bei nicht-leerer Aktualisierung', async () => {
    const { result } = renderHook(() => useEtbEntwuerfe(7));
    await waitFor(() => expect(result.current.entwuerfe).toHaveLength(1));
    const id = result.current.entwuerfe[0].id;

    // leerer Default-Tab ist NICHT in idb
    expect(await entwuerfeLaden(7)).toHaveLength(0);

    await act(async () => {
      result.current.entwurfAktualisieren(id, { inhalt: 'Pumpe', typ: 'meldung', metadaten: {} });
    });
    await waitFor(async () => expect(await entwuerfeLaden(7)).toHaveLength(1));
    expect((await entwuerfeLaden(7))[0].inhalt).toBe('Pumpe');
  });

  it('neuerEntwurf öffnet einen weiteren Tab und aktiviert ihn', async () => {
    const { result } = renderHook(() => useEtbEntwuerfe(7));
    await waitFor(() => expect(result.current.entwuerfe).toHaveLength(1));
    act(() => result.current.neuerEntwurf());
    expect(result.current.entwuerfe).toHaveLength(2);
    expect(result.current.aktiverId).toBe(result.current.entwuerfe[1].id);
  });

  it('entwurfSchliessen entfernt aus idb; beim letzten entsteht ein neuer leerer', async () => {
    await entwurfSpeichern(entwurf({ id: 'x', inhalt: 'A' }));
    const { result } = renderHook(() => useEtbEntwuerfe(7));
    await waitFor(() => expect(result.current.entwuerfe).toHaveLength(1));

    await act(async () => { await result.current.entwurfSchliessen('x'); });
    expect(await entwuerfeLaden(7)).toHaveLength(0);
    expect(result.current.entwuerfe).toHaveLength(1); // neuer leerer Tab
    expect(result.current.entwuerfe[0].inhalt).toBe('');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `mise exec pnpm@11.0.9 -- pnpm -C <frontend-root> exec vitest run src/etb/entwuerfe/useEtbEntwuerfe.test.tsx`
Expected: FAIL — `Cannot find module './useEtbEntwuerfe'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// frontend/src/etb/entwuerfe/useEtbEntwuerfe.ts
import { useCallback, useEffect, useRef, useState } from 'react';
import type { EntwurfWerte, EtbEntwurf } from './entwurfModell';
import { istLeer, werteZuPatch } from './entwurfModell';
import { entwuerfeLaden, entwurfEntfernen, entwurfSpeichern } from './entwurfStore';

function aktivKey(einsatzId: number): string {
  return `etb-entwurf-aktiv-${einsatzId}`;
}

function leererEntwurf(einsatzId: number): EtbEntwurf {
  const jetzt = new Date().toISOString();
  return { id: crypto.randomUUID(), einsatz_id: einsatzId, inhalt: '', typ: 'meldung', erstellt_at: jetzt, geaendert_at: jetzt };
}

export function useEtbEntwuerfe(einsatzId: number) {
  const [entwuerfe, setEntwuerfe] = useState<EtbEntwurf[]>([]);
  const [aktiverId, setAktiverId] = useState<string | null>(null);
  const initialisiert = useRef(false);

  useEffect(() => {
    let abgebrochen = false;
    initialisiert.current = false;
    void (async () => {
      const geladen = await entwuerfeLaden(einsatzId);
      if (abgebrochen || initialisiert.current) return;
      initialisiert.current = true;
      if (geladen.length === 0) {
        const leer = leererEntwurf(einsatzId);
        setEntwuerfe([leer]);
        setAktiverId(leer.id);
        return;
      }
      setEntwuerfe(geladen);
      const gemerkt = localStorage.getItem(aktivKey(einsatzId));
      const gueltig = gemerkt && geladen.some((e) => e.id === gemerkt);
      setAktiverId(gueltig ? gemerkt! : geladen[0].id);
    })();
    return () => { abgebrochen = true; };
  }, [einsatzId]);

  const aktivenSetzen = useCallback((id: string) => {
    setAktiverId(id);
    localStorage.setItem(aktivKey(einsatzId), id);
  }, [einsatzId]);

  const neuerEntwurf = useCallback(() => {
    const leer = leererEntwurf(einsatzId);
    setEntwuerfe((prev) => [...prev, leer]);
    aktivenSetzen(leer.id);
  }, [einsatzId, aktivenSetzen]);

  const entwurfAktualisieren = useCallback((id: string, werte: EntwurfWerte) => {
    const patch = werteZuPatch(werte);
    const geaendert_at = new Date().toISOString();
    let gespeichert: EtbEntwurf | null = null;
    setEntwuerfe((prev) =>
      prev.map((e) => {
        if (e.id !== id) return e;
        gespeichert = { ...e, ...patch, geaendert_at };
        return gespeichert;
      }),
    );
    // Persistenz: leere Entwürfe nicht in idb halten (verhindert Müll durch leere Tabs).
    if (istLeer(werte)) {
      void entwurfEntfernen(id);
    } else if (gespeichert) {
      void entwurfSpeichern(gespeichert);
    }
  }, []);

  const entwurfSchliessen = useCallback(async (id: string) => {
    await entwurfEntfernen(id);
    setEntwuerfe((prev) => {
      const rest = prev.filter((e) => e.id !== id);
      if (rest.length === 0) {
        const leer = leererEntwurf(einsatzId);
        setAktiverId(leer.id);
        localStorage.setItem(aktivKey(einsatzId), leer.id);
        return [leer];
      }
      setAktiverId((aktuell) => {
        if (aktuell !== id) return aktuell;
        const naechster = rest[rest.length - 1].id;
        localStorage.setItem(aktivKey(einsatzId), naechster);
        return naechster;
      });
      return rest;
    });
  }, [einsatzId]);

  return { entwuerfe, aktiverId, neuerEntwurf, entwurfSchliessen, entwurfAktualisieren, aktivenSetzen };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `mise exec pnpm@11.0.9 -- pnpm -C <frontend-root> exec vitest run src/etb/entwuerfe/useEtbEntwuerfe.test.tsx`
Expected: PASS (alle 5 Cases).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/etb/entwuerfe/useEtbEntwuerfe.ts frontend/src/etb/entwuerfe/useEtbEntwuerfe.test.tsx
git commit -m "feat(etb): useEtbEntwuerfe-Hook (Tab-Liste, Autosave, min-1) (LFH-142)"
```

---

### Task 5: Container `EtbEntwurfsTabs`

**Files:**
- Create: `frontend/src/etb/entwuerfe/EtbEntwurfsTabs.tsx`
- Test: `frontend/src/etb/entwuerfe/EtbEntwurfsTabs.test.tsx`

**Interfaces:**
- Consumes: `useEtbEntwuerfe` aus `./useEtbEntwuerfe`; `entwurfLabel`, `zuWerte` aus `./entwurfModell`; `Schnellerfassung` aus `../Schnellerfassung`; `NeuerEintrag` aus `../../api/etb`; `EinsatzAnzeige`, `EtbBaustein` aus `../../api/types`; `Tabs` aus `antd`.
- Produces:
  - `interface EtbEntwurfsTabsProps { einsatzId: number; erfassen: (e: NeuerEintrag) => Promise<void>; bausteine: EtbBaustein[]; einsatz: EinsatzAnzeige; }`
  - `export default function EtbEntwurfsTabs(props): JSX.Element`

Verhalten:
- antd `<Tabs type="editable-card" activeKey hideAdd={false}>`; `onChange` → `aktivenSetzen`; `onEdit(key,'add')` → `neuerEntwurf`, `onEdit(key,'remove')` → `entwurfSchliessen`.
- Nur der **aktive** Tab rendert eine `Schnellerfassung` (`children: id===aktiverId ? <…/> : null`) → keine N parallelen Funkrufnamen-Queries.
- `Schnellerfassung` mit `key={e.id}`, `initialWerte={zuWerte(e)}`, `onWerteChange={(w) => entwurfAktualisieren(e.id, w)}`, `berichtigungZu={null}`.
- `erfassenUndSchliessen`: `await erfassen(eintrag)` — bei Erfolg `await entwurfSchliessen(aktiverId)`; bei Reject propagiert die Exception (Schließen läuft NICHT → Entwurf bleibt).

- [ ] **Step 1: Write the failing test**

```tsx
// frontend/src/etb/entwuerfe/EtbEntwurfsTabs.test.tsx
import { http, HttpResponse } from 'msw';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NeuerEintrag } from '../../api/etb';
import type { EinsatzAnzeige, EtbBaustein } from '../../api/types';
import { server } from '../../test/server';
import { renderMitProviders } from '../../test/utils';
import { entwuerfeLaden, entwuerfeLeerenFuerTests } from './entwurfStore';
import EtbEntwurfsTabs from './EtbEntwurfsTabs';

const einsatz = { id: 7, bezeichnung: 'Test', stichwort: null, leitstellen_nr: null, einsatzort: null } as unknown as EinsatzAnzeige;

beforeEach(async () => {
  await entwuerfeLeerenFuerTests();
  localStorage.clear();
  server.use(
    http.get('/api/einsaetze/:id/fahrzeuge', () => HttpResponse.json([])),
    http.get('/api/einsaetze/:id/einheiten', () => HttpResponse.json([])),
  );
});

function props(over: Partial<React.ComponentProps<typeof EtbEntwurfsTabs>> = {}) {
  return {
    einsatzId: 7,
    erfassen: vi.fn<(e: NeuerEintrag) => Promise<void>>().mockResolvedValue(undefined),
    bausteine: [] as EtbBaustein[],
    einsatz,
    ...over,
  };
}

describe('EtbEntwurfsTabs', () => {
  it('öffnet mit einem leeren Entwurf-Tab und Eingabefeld', async () => {
    renderMitProviders(<EtbEntwurfsTabs {...props()} />);
    expect(await screen.findByPlaceholderText(/Inhalt/)).toBeInTheDocument();
  });

  it('autosaved Eingaben in IndexedDB', async () => {
    renderMitProviders(<EtbEntwurfsTabs {...props()} />);
    await userEvent.type(await screen.findByPlaceholderText(/Inhalt/), 'Lagemeldung');
    await waitFor(async () => {
      const liste = await entwuerfeLaden(7);
      expect(liste.at(0)?.inhalt).toBe('Lagemeldung');
    });
  });

  it('entfernt den Entwurf nach erfolgreichem Absenden', async () => {
    const p = props();
    renderMitProviders(<EtbEntwurfsTabs {...p} />);
    await userEvent.type(await screen.findByPlaceholderText(/Inhalt/), 'Fertig{Enter}');
    await waitFor(() => expect(p.erfassen).toHaveBeenCalledTimes(1));
    await waitFor(async () => expect(await entwuerfeLaden(7)).toHaveLength(0));
  });

  it('behält den Entwurf, wenn das Absenden fachlich abgelehnt wird', async () => {
    const p = props({ erfassen: vi.fn<(e: NeuerEintrag) => Promise<void>>().mockRejectedValue(new Error('abgelehnt')) });
    renderMitProviders(<EtbEntwurfsTabs {...p} />);
    await userEvent.type(await screen.findByPlaceholderText(/Inhalt/), 'Bleibt{Enter}');
    await waitFor(() => expect(p.erfassen).toHaveBeenCalledTimes(1));
    // Entwurf wurde durch das Tippen persistiert und bleibt nach Reject erhalten.
    await waitFor(async () => {
      const liste = await entwuerfeLaden(7);
      expect(liste.at(0)?.inhalt).toBe('Bleibt');
    });
  });

  it('öffnet über den +-Button einen zweiten Tab', async () => {
    renderMitProviders(<EtbEntwurfsTabs {...props()} />);
    await screen.findByPlaceholderText(/Inhalt/);
    await userEvent.click(screen.getByRole('button', { name: /add|hinzu/i }));
    await waitFor(() => expect(screen.getAllByRole('tab')).toHaveLength(2));
  });
});
```

> Hinweis: Der antd-Add-Button trägt `aria-label="add"`. Falls der Name-Matcher nicht greift, stattdessen `screen.getByLabelText('add')` verwenden.

- [ ] **Step 2: Run test to verify it fails**

Run: `mise exec pnpm@11.0.9 -- pnpm -C <frontend-root> exec vitest run src/etb/entwuerfe/EtbEntwurfsTabs.test.tsx`
Expected: FAIL — `Cannot find module './EtbEntwurfsTabs'`.

- [ ] **Step 3: Write minimal implementation**

```tsx
// frontend/src/etb/entwuerfe/EtbEntwurfsTabs.tsx
import { Tabs } from 'antd';
import { useCallback } from 'react';
import type { NeuerEintrag } from '../../api/etb';
import type { EinsatzAnzeige, EtbBaustein } from '../../api/types';
import Schnellerfassung from '../Schnellerfassung';
import { entwurfLabel, zuWerte } from './entwurfModell';
import { useEtbEntwuerfe } from './useEtbEntwuerfe';

export interface EtbEntwurfsTabsProps {
  einsatzId: number;
  erfassen: (e: NeuerEintrag) => Promise<void>;
  bausteine: EtbBaustein[];
  einsatz: EinsatzAnzeige;
}

export default function EtbEntwurfsTabs({ einsatzId, erfassen, bausteine, einsatz }: EtbEntwurfsTabsProps) {
  const { entwuerfe, aktiverId, neuerEntwurf, entwurfSchliessen, entwurfAktualisieren, aktivenSetzen } =
    useEtbEntwuerfe(einsatzId);

  const erfassenUndSchliessen = useCallback(
    async (eintrag: NeuerEintrag) => {
      await erfassen(eintrag); // wirft bei fachlicher Ablehnung → Entwurf bleibt
      if (aktiverId) await entwurfSchliessen(aktiverId);
    },
    [erfassen, aktiverId, entwurfSchliessen],
  );

  const onEdit = useCallback(
    (targetKey: React.MouseEvent | React.KeyboardEvent | string, action: 'add' | 'remove') => {
      if (action === 'add') neuerEntwurf();
      else if (typeof targetKey === 'string') void entwurfSchliessen(targetKey);
    },
    [neuerEntwurf, entwurfSchliessen],
  );

  const items = entwuerfe.map((e) => ({
    key: e.id,
    label: entwurfLabel(e),
    closable: true,
    children:
      e.id === aktiverId ? (
        <Schnellerfassung
          key={e.id}
          erfassen={erfassenUndSchliessen}
          berichtigungZu={null}
          onBerichtigungAbbrechen={() => {}}
          bausteine={bausteine}
          einsatz={einsatz}
          initialWerte={zuWerte(e)}
          onWerteChange={(w) => entwurfAktualisieren(e.id, w)}
        />
      ) : null,
  }));

  return (
    <Tabs
      type="editable-card"
      activeKey={aktiverId ?? undefined}
      onChange={aktivenSetzen}
      onEdit={onEdit}
      items={items}
    />
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `mise exec pnpm@11.0.9 -- pnpm -C <frontend-root> exec vitest run src/etb/entwuerfe/EtbEntwurfsTabs.test.tsx`
Expected: PASS (alle 5 Cases). Bei Bedarf den Add-Button-Matcher laut Hinweis anpassen.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/etb/entwuerfe/EtbEntwurfsTabs.tsx frontend/src/etb/entwuerfe/EtbEntwurfsTabs.test.tsx
git commit -m "feat(etb): EtbEntwurfsTabs-Container (parallele Entwürfe als Tabs) (LFH-142)"
```

---

### Task 6: EtbPage-Integration

**Files:**
- Modify: `frontend/src/pages/EtbPage.tsx:152-162`
- Test: `frontend/src/pages/EtbPage.test.tsx` (Isolation + ein neuer Integrationstest)

**Interfaces:**
- Consumes: `EtbEntwurfsTabs` aus `../etb/entwuerfe/EtbEntwurfsTabs`. `Schnellerfassung`-Import bleibt (Berichtigungsmodus). `erfassenMitMeldung` bleibt unverändert.

Verhalten: Bei aktiver Berichtigung (`berichtigungZu != null`) wird wie bisher eine transiente `Schnellerfassung` gerendert (eigener `key`, kein Autosave) — die Entwurf-Tabs erscheinen nur, wenn keine Berichtigung läuft, und bleiben dabei unangetastet.

- [ ] **Step 1: Add idb-isolation + integration test to `EtbPage.test.tsx`**

a) Imports + `beforeEach` ergänzen (oben in der Datei):
```ts
import { beforeEach } from 'vitest';
import { entwuerfeLeerenFuerTests } from '../etb/entwuerfe/entwurfStore';

beforeEach(async () => {
  await entwuerfeLeerenFuerTests();
  localStorage.clear();
});
```

b) Neuen Test im `describe('EtbPage', …)` ergänzen:
```ts
  it('erfasst einen neuen Eintrag über den Entwurf-Tab (POST an /etb)', async () => {
    let body: Record<string, unknown> | null = null;
    server.use(
      http.post('/api/einsaetze/7/etb', async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ ...eintrag, id: 2, lfd_nr: 2, inhalt: 'Neuer Eintrag X' }, { status: 201 });
      }),
    );
    setup();
    const user = userEvent.setup();
    const feld = await screen.findByPlaceholderText(/Inhalt/);
    await user.type(feld, 'Neuer Eintrag X{Enter}');
    await waitFor(() => expect(body).not.toBeNull());
    expect(body!.inhalt).toBe('Neuer Eintrag X');
  });
```

- [ ] **Step 2: Run test to verify current state**

Run: `mise exec pnpm@11.0.9 -- pnpm -C <frontend-root> exec vitest run src/pages/EtbPage.test.tsx`
Expected: Task 6 ist **primär eine Verdrahtung** (kein neues Verhalten, sondern Umbau von Single-`Schnellerfassung` auf Entwurf-Tabs/Berichtigungs-Conditional). Der neue Test ist deshalb ein **Integrations-/Regressionstest**, kein klassischer TDD-RED: Er kann mit der alten Variante bereits grün sein, weil auch sie auf `{Enter}` POSTet. Sein Zweck ist, nach Step 3 zu sichern, dass die Erfassung über den Tab-Pfad weiterhin POSTet. Vor Step 3 außerdem verifizieren, dass die Datei sauber kompiliert (`entwuerfeLeerenFuerTests` aus Task 2 importierbar). Die drei Bestands-Tests müssen unverändert grün bleiben.

- [ ] **Step 3: Implement the integration**

In `frontend/src/pages/EtbPage.tsx`:

a) Import ergänzen (neben dem bestehenden `Schnellerfassung`-Import):
```ts
import EtbEntwurfsTabs from '../etb/entwuerfe/EtbEntwurfsTabs';
```

b) Block Zeile 152–162 ersetzen:
```tsx
      {darfSchreiben && (
        <div className="etb-erfassung-sticky">
          {berichtigungZu ? (
            <Schnellerfassung
              key="berichtigung"
              erfassen={erfassenMitMeldung}
              berichtigungZu={berichtigungZu}
              onBerichtigungAbbrechen={() => setBerichtigungZu(null)}
              bausteine={bausteineQuery.data ?? []}
              einsatz={einsatz}
            />
          ) : (
            <EtbEntwurfsTabs
              einsatzId={einsatzId}
              erfassen={erfassenMitMeldung}
              bausteine={bausteineQuery.data ?? []}
              einsatz={einsatz}
            />
          )}
        </div>
      )}
```

- [ ] **Step 4: Run EtbPage tests (and confirm baseline preserved)**

Run: `mise exec pnpm@11.0.9 -- pnpm -C <frontend-root> exec vitest run src/pages/EtbPage.test.tsx`
Expected: PASS — alle 3 Bestands-Tests + der neue Erfassungstest grün.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/EtbPage.tsx frontend/src/pages/EtbPage.test.tsx
git commit -m "feat(etb): EtbPage rendert Entwurf-Tabs (Berichtigung getrennt) (LFH-142)"
```

---

### Task 7: Verifikations-Gate (Full-Suite, Typecheck, Lint)

**Files:** keine — reines Verifikations-Gate.

- [ ] **Step 1: Typecheck**

Run: `mise exec pnpm@11.0.9 -- pnpm -C <frontend-root> exec tsc --noEmit`
Expected: keine Fehler.

- [ ] **Step 2: Lint**

Run: `mise exec pnpm@11.0.9 -- pnpm -C <frontend-root> exec eslint .`
Expected: keine Fehler.

- [ ] **Step 3: Volle Testsuite (stabiles Gate)**

Run: `mise exec pnpm@11.0.9 -- pnpm -C <frontend-root> exec vitest run --no-file-parallelism`
Expected: ≥ 768 Tests grün (Baseline 768 + neue), 0 Failures.

- [ ] **Step 4: Commit (nur falls Fixes nötig waren)**

```bash
git add -A && git commit -m "chore(etb): Typecheck/Lint/Test-Gate grün (LFH-142)"
```

---

## Self-Review

**Spec coverage (Akzeptanzkriterien):**
- „Mehrere Entwürfe gleichzeitig offen, einzeln weiterbearbeitbar" → Task 4 (`neuerEntwurf`, Tab-Liste) + Task 5 (Tabs-UI).
- „Angefangener Entwurf bleibt nach Reload / Schließen erhalten" → Task 2 (idb) + Task 4 (Autosave bei Edit, aktiver Tab in localStorage) + Task 3 (`onWerteChange`).
- „Nach Absenden bzw. Verwerfen wird der lokale Entwurf entfernt" → Task 5 (`erfassenUndSchliessen`) + Task 4 (`entwurfSchliessen`, auch via Tab-`remove`).
- Klärpunkte: Scope pro Einsatz → `by-einsatz`-Index + `einsatzId`-Parameter überall. Absenden → Tab schließt + Draft weg; letzter Tab → neuer leerer (Entscheidung „immer ein leerer Tab").

**Placeholder scan:** Kein TBD/TODO; jeder Code-Step enthält vollständigen Code.

**Type consistency:** `EtbEntwurf`/`EntwurfWerte` (Task 1) werden in Tasks 2/4/5 unverändert verwendet; `werteZuPatch`/`zuWerte`/`istLeer`/`entwurfLabel` Namen konsistent; Store-Signaturen (`entwuerfeLaden`/`entwurfSpeichern`/`entwurfEntfernen`/`entwuerfeLeerenFuerTests`) durchgängig gleich; Hook-Rückgabe (`entwuerfe`/`aktiverId`/`neuerEntwurf`/`entwurfSchliessen`/`entwurfAktualisieren`/`aktivenSetzen`) in Task 5 deckungsgleich konsumiert.

**Risiken/Notizen:**
- `crypto.randomUUID()` ist in jsdom/Node (vitest) und im Browser verfügbar.
- antd-`Tabs`-Add-Button-Selektor in Task 5 ggf. via `getByLabelText('add')` statt Name-Regex.
- e2e (`kernfluss.spec.ts`) läuft nicht im Unit-Gate (eigenes Backend nötig), bleibt aber durch den leeren Default-Tab + erhaltenen Placeholder/`Erfassen`-Button kompatibel.
