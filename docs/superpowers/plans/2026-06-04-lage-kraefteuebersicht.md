# Kräfteübersicht — Meldebild Implementation Plan (LFH-49)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ein lesendes, druckbares Meldebild der eingesetzten Kräfte — reine Frontend-Aggregation der vorhandenen K&M-Daten, gegliedert nach Abschnitt → Einheit → Einzelmittel, mit Verdichtungskopf, Live, Filter und Lagebericht-Übernahme.

**Architecture:** Eine pure, unit-getestete Aggregationsfunktion (`frontend/src/kraefte/kraeftebild.ts`) verschachtelt fünf bestehende Listen-Reads (Abschnitte, Einheiten, Personal, Fahrzeuge, Material) zu einem Baum mit blatt-genauen Summen. Die Seite (`KraefteuebersichtPage.tsx`) rendert das als antd-`Table` mit `expandable` rows plus KPI-Kopf. Kein Backend-Stamm, kein neuer Endpunkt; Live über den bestehenden `useEinsatzLiveStream` (additiv um Personal/Material ergänzt).

**Tech Stack:** React + TypeScript, Ant Design (`Table`, `Card`, `Tag`, `Space`), TanStack Query, Vitest. Spec: `docs/superpowers/specs/2026-06-04-lage-kraefteuebersicht-design.md`.

**Invariante (zentraler Akzeptanztest, gilt für alle Aggregations-Tests):** Der Verdichtungskopf zählt jede eingesetzte Kraft genau einmal — `verdichtung.anzahlPersonal === personal.length`, `anzahlFahrzeuge === fahrzeuge.length`, `anzahlMaterialPositionen === material.length`, `staerke.gesamt === personal.length`.

**Hinweis Embedding:** Frontend ist ins Binary eingebettet (rust-embed). Reine Vitest-Tasks brauchen kein Backend; zum manuellen Sichten am Ende `pnpm build` + Backend-Neustart. Volle Suite ggf. mit `--no-file-parallelism` (Suite ist unter Last flaky). Für ehrliche Exit-Codes Gates über `rtk proxy <cmd>` laufen lassen.

---

## File Structure

- **Create** `frontend/src/kraefte/kraeftebild.ts` — pure Aggregation + Markdown-Render + Typen. Keine React-Abhängigkeit.
- **Create** `frontend/src/kraefte/kraeftebild.test.ts` — Invariante, Verschachtelung, Verdichtung, Markdown.
- **Create** `frontend/src/pages/KraefteuebersichtPage.tsx` — Seite: Queries, KPI-Kopf, Tree-Table, Filter, Live, Druck-/Lagebericht-Aktionen.
- **Create** `frontend/src/pages/KraefteuebersichtPage.test.tsx` — Render-/Filter-/Aktions-Tests.
- **Create** `frontend/src/pages/kraefteuebersichtPrint.css` — Print-CSS (visibility-Toggle, Muster aus `lageberichtPrint.css`).
- **Modify** `frontend/src/einsatz/modulRegistry.ts:67` — `kraefteuebersicht` `status: 'geplant'` → `'fertig'`.
- **Modify** `frontend/src/App.tsx:21-52` — Import + `MODUL_ELEMENTE['kraefteuebersicht']` (lazy, Suspense wie Lagekarte).
- **Modify** `frontend/src/etb/useEinsatzLiveStream.ts:30-44` — additive Invalidierung `einsatz-personal` / `einsatz-material` bei `einheit`/`person`-Events (Lückenschluss für das Meldebild).

---

## Task 1: Pure Aggregation `kraeftebild.ts` (Kern, TDD)

**Files:**
- Create: `frontend/src/kraefte/kraeftebild.ts`
- Test: `frontend/src/kraefte/kraeftebild.test.ts`

Diese Datei ist der kritische Kern — sie trägt die Stärkenachweis-Invariante. Alles UI baut darauf auf.

### Typen & Signatur (oben in `kraeftebild.ts`)

```typescript
import type {
  Einheit, EinsatzPersonal, EinsatzFahrzeug, EinsatzMaterial, Einsatzabschnitt,
  Staerke, StatusKategorie, StaerkePosition, MaterialStatus,
} from '../api/types';

export interface StaerkeSumme { fuehrer: number; unterfuehrer: number; mannschaft: number; gesamt: number; }
export interface StatusVerteilung { verfuegbar: number; gebunden: number; nicht_verfuegbar: number; ohne: number; }
export type ZeilenArt = 'abschnitt' | 'einheit' | 'mittel';
export type MittelArt = 'fahrzeug' | 'person' | 'material';

/** Eine Zeile im Meldebild-Baum (antd-Table `children`-fähig). */
export interface MeldebildZeile {
  key: string;                       // stabiler Row-Key, z.B. 'ab-3','eh-7','fz-12'
  art: ZeilenArt;
  mittelArt: MittelArt | null;       // nur bei art==='mittel'
  bezeichnung: string;
  detail: string | null;             // Typ-Label / Führer / Funktion / Fahrzeugtyp / Menge-Text
  staerke: StaerkeSumme;             // abschnitt/einheit: kumuliert; person-mittel: die 1 Position; sonst 0
  soll: StaerkeSumme | null;         // nur einheit (aus Einheit.soll)
  statusKategorie: StatusKategorie | null;  // nur mittel (Person/Fahrzeug)
  statusLabel: string | null;        // Fahrzeug: enthält FMS-Text, z.B. "4 – Am Einsatzort"
  menge: number | null;              // nur Material-Mittel
  personalVerteilung: StatusVerteilung | null;   // abschnitt/einheit
  fahrzeugVerteilung: StatusVerteilung | null;    // abschnitt/einheit
  children?: MeldebildZeile[];
}

export interface Verdichtung {
  staerke: StaerkeSumme;
  soll: StaerkeSumme | null;         // Summe aller Einheit.soll (null wenn nirgends definiert)
  personalStatus: StatusVerteilung;
  fahrzeugStatus: StatusVerteilung;
  materialStatus: Record<MaterialStatus, number>;
  anzahlPersonal: number;
  anzahlFahrzeuge: number;
  anzahlMaterialPositionen: number;
}

export interface Kraeftebild { baum: MeldebildZeile[]; verdichtung: Verdichtung; }

export const OHNE_ABSCHNITT_KEY = 'ab-ohne';
export const OHNE_EINHEIT_KEY_PREFIX = 'eh-ohne';

export function baueKraeftebild(
  abschnitte: Einsatzabschnitt[],
  einheiten: Einheit[],
  personal: EinsatzPersonal[],
  fahrzeuge: EinsatzFahrzeug[],
  material: EinsatzMaterial[],
): Kraeftebild { /* … */ }
```

### Aggregationsregeln (verbindlich)

1. **Stärke nur aus Personen.** Jede `EinsatzPersonal`-Zeile zählt als 1 Kopf; Position aus `staerke_position`, `null` → `mannschaft`. Fahrzeuge/Material tragen **nicht** zur Stärke bei.
2. **Blatt-Aggregation.** Summen aus den atomaren Listen, nie durch Addieren von `Einheit.ist_kumuliert`. (Backend-`ist_kumuliert` wird nicht für Summen verwendet — Konsistenz Tabelle↔Kopf.)
3. **Zuordnungspfad:** Mittel → `einheit_id` → Einheit → `abschnitt_id` → Abschnitt (Abschnitts-Baum via `ueber_abschnitt_id`, Einheiten-Baum via `ueber_einheit_id`). Einheit-Knoten zeigt kumulierte Stärke (eigene Mittel + Kind-Einheiten).
4. **Catch-all:** Einheit ohne Abschnitt → Pseudo-Abschnitt `OHNE_ABSCHNITT_KEY` ("Ohne Abschnitt"). Mittel ohne Einheit → Pseudo-Einheit "Ohne Einheit" unter „Ohne Abschnitt". Beide ans Baum-Ende.
5. **Verteilung:** `StatusVerteilung` zählt Mittel je `status_kategorie`; fehlende Kategorie → `ohne`. `personalVerteilung` über Personen, `fahrzeugVerteilung` über Fahrzeuge.

### Steps

- [ ] **Step 1: Failing test — Invariante & Grundfall**

```typescript
// frontend/src/kraefte/kraeftebild.test.ts
import { describe, it, expect } from 'vitest';
import { baueKraeftebild } from './kraeftebild';
import type { Einheit, EinsatzPersonal, EinsatzFahrzeug, EinsatzMaterial, Einsatzabschnitt } from '../api/types';

// Minimal-Factories (nur belegte Felder; Rest as-cast für Testkürze).
const ab = (id: number, ueber: number | null = null, name = `A${id}`): Einsatzabschnitt =>
  ({ id, einsatz_id: 1, ueber_abschnitt_id: ueber, name, leiter_id: null, leiter_name: null,
     bemerkung: null, sortier: id, flaeche_geojson: null, tz_fachaufgabe: null, tz_organisation: null });
const eh = (id: number, abschnitt_id: number | null, ueber_einheit_id: number | null = null): Einheit =>
  ({ id, einsatz_id: 1, abschnitt_id, abschnitt_name: null, ueber_einheit_id, typ_id: null,
     typ_label: 'Gruppe', name: `E${id}`, fuehrer_id: null, fuehrer_name: null, bemerkung: null,
     sortier: id, soll: null, ist: { fuehrer: 0, unterfuehrer: 0, mannschaft: 0 },
     ist_kumuliert: { fuehrer: 0, unterfuehrer: 0, mannschaft: 0 },
     personal_mitglieder: [], fahrzeug_mitglieder: [], material_mitglieder: [],
     lat: null, lon: null, tz_fachaufgabe: null, tz_organisation: null });
const p = (id: number, einheit_id: number | null, pos: EinsatzPersonal['staerke_position'],
           kat: EinsatzPersonal['status_kategorie'] = 'gebunden'): EinsatzPersonal =>
  ({ id, einsatz_id: 1, personal_id: null, einheit_id, ist_adhoc: false, name: `P${id}`,
     funktion: null, traegerorganisation: null, staerke_position: pos, status_id: null,
     status_label: null, status_kategorie: kat, status_farbe: null, disponiert_at: '', disponiert_von: null });
const fz = (id: number, einheit_id: number | null, kat: EinsatzFahrzeug['status_kategorie'] = 'verfuegbar',
            fms: number | null = 2): EinsatzFahrzeug =>
  ({ id, einsatz_id: 1, fahrzeug_id: null, einheit_id, ist_adhoc: false, funkrufname: `F${id}`,
     kennzeichen: null, fahrzeugtyp: 'LF', opta: null, traegerorganisation: null, status_id: null,
     status_label: `${fms}`, status_kategorie: kat, status_farbe: null, bemerkung: null,
     disponiert_at: '', disponiert_von: null, lat: null, lon: null, tz_fachaufgabe: null, tz_organisation: null });

it('Invariante: Kopf zählt jede Kraft genau einmal', () => {
  const personal = [p(1, 10, 'fuehrer'), p(2, 10, 'mannschaft'), p(3, null, 'mannschaft')];
  const fahrzeuge = [fz(1, 10), fz(2, null)];
  const material: EinsatzMaterial[] = [];
  const bild = baueKraeftebild([ab(1)], [eh(10, 1)], personal, fahrzeuge, material);
  expect(bild.verdichtung.anzahlPersonal).toBe(3);
  expect(bild.verdichtung.anzahlFahrzeuge).toBe(2);
  expect(bild.verdichtung.staerke.gesamt).toBe(3);
  expect(bild.verdichtung.staerke.fuehrer).toBe(1);
  expect(bild.verdichtung.staerke.mannschaft).toBe(2);
});
```

- [ ] **Step 2: Run, verify fail**

Run: `cd frontend && npx vitest run src/kraefte/kraeftebild.test.ts`
Expected: FAIL — `baueKraeftebild is not a function` / Modul fehlt.

- [ ] **Step 3: Implement `baueKraeftebild`**

Implementiere gemäß den Aggregationsregeln oben. Skelett:

```typescript
const POS_NULL_FALLBACK: StaerkePosition = 'mannschaft';
const leereStaerke = (): StaerkeSumme => ({ fuehrer: 0, unterfuehrer: 0, mannschaft: 0, gesamt: 0 });
const leereVert = (): StatusVerteilung => ({ verfuegbar: 0, gebunden: 0, nicht_verfuegbar: 0, ohne: 0 });

function addPosition(s: StaerkeSumme, pos: StaerkePosition | null): void {
  const p = pos ?? POS_NULL_FALLBACK;
  s[p] += 1; s.gesamt += 1;
}
function addStaerke(ziel: StaerkeSumme, q: StaerkeSumme): void {
  ziel.fuehrer += q.fuehrer; ziel.unterfuehrer += q.unterfuehrer;
  ziel.mannschaft += q.mannschaft; ziel.gesamt += q.gesamt;
}
function addKategorie(v: StatusVerteilung, k: StatusKategorie | null): void {
  if (k === 'verfuegbar') v.verfuegbar += 1;
  else if (k === 'gebunden') v.gebunden += 1;
  else if (k === 'nicht_verfuegbar') v.nicht_verfuegbar += 1;
  else v.ohne += 1;
}
function staerkeAusBackend(s: Staerke): StaerkeSumme {
  return { fuehrer: s.fuehrer, unterfuehrer: s.unterfuehrer, mannschaft: s.mannschaft,
           gesamt: s.fuehrer + s.unterfuehrer + s.mannschaft };
}
```

Vorgehen in `baueKraeftebild`:
1. Personen/Fahrzeuge/Material nach `einheit_id` gruppieren (`Map<number|null, …[]>`).
2. Einheiten-Knoten rekursiv bauen (über `ueber_einheit_id`-Kinder), Mittel-Zeilen aus den Gruppen anhängen, Stärke = Σ direkter Personen + Σ Kinder-Stärke. `personalVerteilung`/`fahrzeugVerteilung` kumuliert.
3. Abschnitts-Knoten rekursiv bauen (über `ueber_abschnitt_id`), Top-Einheiten (`ueber_einheit_id===null`) je `abschnitt_id` einhängen, Stärke/Verteilung hochrollen.
4. Einheiten mit `abschnitt_id===null` → unter „Ohne Abschnitt".
5. Mittel mit `einheit_id===null` → Pseudo-Einheit „Ohne Einheit" unter „Ohne Abschnitt".
6. Verdichtung aus den Rohlisten direkt (nicht aus dem Baum) zählen — garantiert die Invariante: iteriere `personal`/`fahrzeuge`/`material` je einmal.

- [ ] **Step 4: Run, verify pass**

Run: `cd frontend && npx vitest run src/kraefte/kraeftebild.test.ts`
Expected: PASS.

- [ ] **Step 5: Failing tests — Verschachtelung & Catch-all**

```typescript
it('verschachtelte Einheiten: keine Doppelzählung', () => {
  // E20 ist Untereinheit von E10, beide im Abschnitt 1
  const personal = [p(1, 10, 'fuehrer'), p(2, 20, 'mannschaft'), p(3, 20, 'mannschaft')];
  const bild = baueKraeftebild([ab(1)], [eh(10, 1), eh(20, 1, 10)], personal, [], []);
  expect(bild.verdichtung.staerke.gesamt).toBe(3); // genau einmal
  const a1 = bild.baum.find((z) => z.key === 'ab-1')!;
  expect(a1.staerke.gesamt).toBe(3);              // Abschnitt rollt hoch
  const e10 = a1.children!.find((z) => z.key === 'eh-10')!;
  expect(e10.staerke.gesamt).toBe(3);             // E10 kumuliert (inkl. E20)
});

it('verschachtelte Abschnitte rollen hoch', () => {
  // A2 ist Unterabschnitt von A1; Einheit in A2
  const bild = baueKraeftebild([ab(1), ab(2, 1)], [eh(10, 2)], [p(1, 10, 'mannschaft')], [], []);
  const a1 = bild.baum.find((z) => z.key === 'ab-1')!;
  expect(a1.staerke.gesamt).toBe(1);
});

it('Catch-all: Kräfte ohne Zuordnung erscheinen und zählen', () => {
  const bild = baueKraeftebild([ab(1)], [eh(10, null)], [p(1, null, 'mannschaft')], [fz(9, null)], []);
  expect(bild.verdichtung.anzahlPersonal).toBe(1);
  expect(bild.verdichtung.anzahlFahrzeuge).toBe(1);
  const ohne = bild.baum.find((z) => z.key === OHNE_ABSCHNITT_KEY);
  expect(ohne).toBeDefined();
  expect(ohne!.staerke.gesamt).toBe(1);
});

it('leerer Einsatz: alles 0, kein Crash', () => {
  const bild = baueKraeftebild([], [], [], [], []);
  expect(bild.verdichtung.staerke.gesamt).toBe(0);
  expect(bild.baum).toEqual([]);
});
```

Import `OHNE_ABSCHNITT_KEY` oben im Test ergänzen.

- [ ] **Step 6: Run → fix bis grün**

Run: `cd frontend && npx vitest run src/kraefte/kraeftebild.test.ts`
Expected: alle PASS. Falls Catch-all/Roll-up fehlt, in `baueKraeftebild` nachziehen.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/kraefte/kraeftebild.ts frontend/src/kraefte/kraeftebild.test.ts
git commit -m "feat(fe): pure Kräftebild-Aggregation mit Stärkenachweis-Invariante (LFH-49)"
```

---

## Task 2: Modul aktivieren + Seiten-Skelett mit KPI-Daten

**Files:**
- Modify: `frontend/src/einsatz/modulRegistry.ts:67`
- Modify: `frontend/src/App.tsx`
- Create: `frontend/src/pages/KraefteuebersichtPage.tsx`
- Test: `frontend/src/pages/KraefteuebersichtPage.test.tsx`

- [ ] **Step 1: Registry & Routing**

`modulRegistry.ts` Zeile 67: `status: 'geplant'` → `status: 'fertig'`.

`App.tsx`: nach Zeile 31 ergänzen:
```typescript
const KraefteuebersichtPage = lazy(() => import('./pages/KraefteuebersichtPage'));
```
In `MODUL_ELEMENTE` ergänzen:
```typescript
  kraefteuebersicht: (
    <Suspense fallback={<div style={{ padding: 24 }}>Meldebild wird geladen…</div>}>
      <KraefteuebersichtPage />
    </Suspense>
  ),
```

- [ ] **Step 2: Failing test — Seite rendert Kopf-Zahlen**

```typescript
// KraefteuebersichtPage.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { App as AntApp } from 'antd';
import KraefteuebersichtPage from './KraefteuebersichtPage';

vi.mock('../api/einheiten', () => ({ listeEinheiten: vi.fn(() => Promise.resolve([])) }));
vi.mock('../api/einsatzPersonal', () => ({ listeEinsatzPersonal: vi.fn(() => Promise.resolve([
  { id: 1, einsatz_id: 1, personal_id: null, einheit_id: null, ist_adhoc: false, name: 'P1',
    funktion: null, traegerorganisation: null, staerke_position: 'mannschaft', status_id: null,
    status_label: null, status_kategorie: 'gebunden', status_farbe: null, disponiert_at: '', disponiert_von: null },
])) }));
vi.mock('../api/einsatzFahrzeuge', () => ({ listeEinsatzFahrzeuge: vi.fn(() => Promise.resolve([])) }));
vi.mock('../api/einsatzMaterial', () => ({ listeEinsatzMaterial: vi.fn(() => Promise.resolve([])) }));
vi.mock('../api/einsatzabschnitte', () => ({ listeAbschnitte: vi.fn(() => Promise.resolve([])) }));
vi.mock('../etb/useEinsatzLiveStream', () => ({ useEinsatzLiveStream: vi.fn() }));

function setup() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <AntApp>
        <MemoryRouter initialEntries={['/einsaetze/1/kraefteuebersicht']}>
          <Routes><Route path="/einsaetze/:id/kraefteuebersicht" element={<KraefteuebersichtPage />} /></Routes>
        </MemoryRouter>
      </AntApp>
    </QueryClientProvider>,
  );
}

it('zeigt die Gesamt-Personalstärke im Kopf', async () => {
  setup();
  expect(await screen.findByText('Kräfteübersicht')).toBeInTheDocument();
  // 1 Person (Mannschaft) → Gesamtstärke 1
  expect(await screen.findByText(/Gesamtstärke/i)).toBeInTheDocument();
  expect(await screen.findByText('1')).toBeInTheDocument();
});
```

- [ ] **Step 3: Run, verify fail**

Run: `cd frontend && npx vitest run src/pages/KraefteuebersichtPage.test.tsx`
Expected: FAIL — Modul/Datei fehlt.

- [ ] **Step 4: Implement Seiten-Skelett**

```typescript
// KraefteuebersichtPage.tsx
import { Alert, Breadcrumb, Card, Space, Spin, Statistic, Typography } from 'antd';
import { Link, useParams } from 'react-router-dom';
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ladeEinsatz } from '../api/einsaetze';
import { listeEinheiten } from '../api/einheiten';
import { listeEinsatzPersonal } from '../api/einsatzPersonal';
import { listeEinsatzFahrzeuge } from '../api/einsatzFahrzeuge';
import { listeEinsatzMaterial } from '../api/einsatzMaterial';
import { listeAbschnitte } from '../api/einsatzabschnitte';
import { useEinsatzLiveStream } from '../etb/useEinsatzLiveStream';
import { baueKraeftebild, type StaerkeSumme } from '../kraefte/kraeftebild';

export function staerkeText(s: StaerkeSumme): string {
  return `${s.fuehrer}/${s.unterfuehrer}/${s.mannschaft}/${s.gesamt}`;
}

export default function KraefteuebersichtPage() {
  const { id } = useParams();
  const einsatzId = Number(id);
  useEinsatzLiveStream(einsatzId);

  const einsatzQuery = useQuery({ queryKey: ['einsatz', einsatzId], queryFn: () => ladeEinsatz(einsatzId) });
  // Query-Keys identisch zu den vom Live-Hook invalidierten Keys (s. Task 5).
  const einheitenQuery = useQuery({ queryKey: ['einsatz-einheiten', einsatzId], queryFn: () => listeEinheiten(einsatzId) });
  const personalQuery = useQuery({ queryKey: ['einsatz-personal', einsatzId], queryFn: () => listeEinsatzPersonal(einsatzId) });
  const fahrzeugeQuery = useQuery({ queryKey: ['einsatz-fahrzeuge', einsatzId], queryFn: () => listeEinsatzFahrzeuge(einsatzId) });
  const materialQuery = useQuery({ queryKey: ['einsatz-material', einsatzId], queryFn: () => listeEinsatzMaterial(einsatzId) });
  const abschnitteQuery = useQuery({ queryKey: ['einsatz-abschnitte', einsatzId], queryFn: () => listeAbschnitte(einsatzId) });

  const bild = useMemo(() => baueKraeftebild(
    abschnitteQuery.data ?? [], einheitenQuery.data ?? [], personalQuery.data ?? [],
    fahrzeugeQuery.data ?? [], materialQuery.data ?? [],
  ), [abschnitteQuery.data, einheitenQuery.data, personalQuery.data, fahrzeugeQuery.data, materialQuery.data]);

  if (einsatzQuery.isLoading) return <div style={{ textAlign: 'center', paddingTop: 80 }}><Spin size="large" /></div>;
  if (einsatzQuery.isError || !einsatzQuery.data) return <Alert type="error" message="Einsatz nicht gefunden oder kein Zugriff" showIcon />;
  const einsatz = einsatzQuery.data;
  const v = bild.verdichtung;

  return (
    <div>
      <Breadcrumb style={{ marginBottom: 12 }}
        items={[{ title: <Link to="/einsaetze">Einsätze</Link> }, { title: einsatz.bezeichnung }, { title: 'Kräfteübersicht' }]} />
      <Typography.Title level={3} style={{ marginTop: 0 }}>Kräfteübersicht</Typography.Title>
      <Card size="small" style={{ marginBottom: 16 }}>
        <Space size="large" wrap>
          <Statistic title="Gesamtstärke (F/UF/M)" value={staerkeText(v.staerke)} />
          <Statistic title="Personal" value={v.anzahlPersonal} />
          <Statistic title="Fahrzeuge" value={v.anzahlFahrzeuge} />
          <Statistic title="Material" value={v.anzahlMaterialPositionen} />
        </Space>
      </Card>
      {/* Tabelle folgt in Task 3 */}
    </div>
  );
}
```

- [ ] **Step 5: Run, verify pass**

Run: `cd frontend && npx vitest run src/pages/KraefteuebersichtPage.test.tsx`
Expected: PASS. (Hinweis: `Statistic` mit String-Wert rendert „Gesamtstärke (F/UF/M)" — Test sucht `/Gesamtstärke/i`.)

- [ ] **Step 6: Commit**

```bash
git add frontend/src/einsatz/modulRegistry.ts frontend/src/App.tsx frontend/src/pages/KraefteuebersichtPage.tsx frontend/src/pages/KraefteuebersichtPage.test.tsx
git commit -m "feat(fe): Kräfteübersicht-Modul aktiviert mit Verdichtungskopf (LFH-49)"
```

---

## Task 3: Tree-Table (Abschnitt → Einheit → Einzelmittel)

**Files:**
- Modify: `frontend/src/pages/KraefteuebersichtPage.tsx`
- Modify: `frontend/src/pages/KraefteuebersichtPage.test.tsx`

- [ ] **Step 1: Failing test — Baumzeilen sichtbar**

Mock erweitern: ein Abschnitt + eine Einheit + ein Fahrzeug. Dann:
```typescript
it('rendert Abschnitt, Einheit und Einzelmittel als aufklappbare Zeilen', async () => {
  // (Mocks so anpassen, dass listeAbschnitte [A1], listeEinheiten [E10 in A1],
  //  listeEinsatzFahrzeuge [F1 in E10] liefern.)
  setup();
  expect(await screen.findByText('A1')).toBeInTheDocument();
  expect(await screen.findByText('E10')).toBeInTheDocument();
});
```

- [ ] **Step 2: Run, verify fail** — `cd frontend && npx vitest run src/pages/KraefteuebersichtPage.test.tsx` → FAIL (E10 nicht gefunden).

- [ ] **Step 3: Implement Tabelle**

In `KraefteuebersichtPage.tsx` `Table` ergänzen (Import `Table, Tag` aus antd; `ColumnsType`). Status-Tag-Helfer:
```typescript
import { Table, Tag } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import type { MeldebildZeile, StatusVerteilung } from '../kraefte/kraeftebild';

const KAT_FARBE: Record<string, string> = { verfuegbar: 'green', gebunden: 'gold', nicht_verfuegbar: 'red' };

function verteilungTags(v: StatusVerteilung | null) {
  if (!v) return null;
  return (
    <Space size={4}>
      {v.verfuegbar > 0 && <Tag color="green">{v.verfuegbar} frei</Tag>}
      {v.gebunden > 0 && <Tag color="gold">{v.gebunden} geb.</Tag>}
      {v.nicht_verfuegbar > 0 && <Tag color="red">{v.nicht_verfuegbar} n.v.</Tag>}
      {v.ohne > 0 && <Tag>{v.ohne} o.A.</Tag>}
    </Space>
  );
}

const spalten: ColumnsType<MeldebildZeile> = [
  { title: 'Bezeichnung', dataIndex: 'bezeichnung', key: 'bez',
    render: (_t, z) => <span style={{ fontWeight: z.art === 'abschnitt' ? 600 : 400 }}>{z.bezeichnung}</span> },
  { title: 'Typ / Rolle', dataIndex: 'detail', key: 'detail', responsive: ['md'] },
  { title: 'Stärke', key: 'staerke', width: 130,
    render: (_t, z) => (z.art === 'mittel' && z.mittelArt !== 'person') ? null : staerkeText(z.staerke) },
  { title: 'Status', key: 'status', width: 220,
    render: (_t, z) => {
      if (z.art === 'mittel') {
        if (z.mittelArt === 'material') return <Tag>{z.statusLabel}{z.menge != null ? ` ·${z.menge}` : ''}</Tag>;
        const farbe = z.statusKategorie ? KAT_FARBE[z.statusKategorie] : undefined;
        return <Tag color={farbe}>{z.statusLabel ?? z.statusKategorie ?? '—'}</Tag>;
      }
      return <Space size={8}><span>👤</span>{verteilungTags(z.personalVerteilung)}<span>🚒</span>{verteilungTags(z.fahrzeugVerteilung)}</Space>;
    } },
];
```
Im JSX statt des Tabellen-Kommentars:
```typescript
<Table<MeldebildZeile>
  size="small" columns={spalten} dataSource={bild.baum} pagination={false}
  rowKey="key" expandable={{ defaultExpandAllRows: false, childrenColumnName: 'children' }}
  locale={{ emptyText: 'Keine Kräfte im Einsatz disponiert' }} />
```
`bezeichnung`/`detail` in `kraeftebild.ts` füllen: Einheit `detail = [typ_label, fuehrer_name].filter(Boolean).join(' · ')`; Fahrzeug `detail = fahrzeugtyp`; Person `detail = funktion`; Material `detail = null`.

- [ ] **Step 4: Run, verify pass** — `cd frontend && npx vitest run src/pages/KraefteuebersichtPage.test.tsx` → PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/KraefteuebersichtPage.tsx frontend/src/pages/KraefteuebersichtPage.test.tsx
git commit -m "feat(fe): Tree-Table-Meldebild Abschnitt/Einheit/Mittel (LFH-49)"
```

---

## Task 4: Verdichtungskopf — Status-/FMS-/Material-Achsen

**Files:**
- Modify: `frontend/src/pages/KraefteuebersichtPage.tsx`
- Modify: `frontend/src/kraefte/kraeftebild.test.ts` (Verteilungs-Asserts)

- [ ] **Step 1: Failing test (Aggregation) — Verteilungen**

```typescript
it('verdichtet Fahrzeug-Status und Material-Status getrennt', () => {
  const fahrzeuge = [fz(1, null, 'verfuegbar', 2), fz(2, null, 'gebunden', 4), fz(3, null, 'nicht_verfuegbar', 6)];
  const bild = baueKraeftebild([], [], [], fahrzeuge, []);
  expect(bild.verdichtung.fahrzeugStatus.verfuegbar).toBe(1);
  expect(bild.verdichtung.fahrzeugStatus.gebunden).toBe(1);
  expect(bild.verdichtung.fahrzeugStatus.nicht_verfuegbar).toBe(1);
});
```
(Material-Status analog mit einer `EinsatzMaterial`-Factory `mat(id, status)` ergänzen; `materialStatus[status]` prüfen.)

- [ ] **Step 2: Run, verify fail** — falls `fahrzeugFms`/Verteilung noch unvollständig → FAIL.

- [ ] **Step 3: Implement** — in `baueKraeftebild` Verdichtung vervollständigen (Fahrzeug-Kategorie + `fms_anker`-Histogramm aus `status_label`? Nein: FMS sicher nur falls vorhanden — Fahrzeug trägt `status_kategorie`; den FMS-Anker am Einzel-Fahrzeug gibt es nur über den Status-Katalog. **Festlegung:** `fahrzeugFms` aus `EinsatzFahrzeug` ist nicht direkt verfügbar — nutze stattdessen die Kategorie-Verteilung im Kopf und zeige FMS nur an der Mittel-Zeile, wo `status_label` die FMS-Nummer trägt. Test entsprechend auf `fahrzeugStatus`-Kategorien beschränken, `fahrzeugFms` entfällt.)

> **Korrektur für Task 1 & 4:** `EinsatzFahrzeug` hat **kein** `fms_anker`-Feld (nur `FahrzeugStatus` im Katalog hat es). `Verdichtung.fahrzeugFms` und `MeldebildZeile.fmsAnker` daher **streichen**; FMS wird über `status_label` (z. B. „4 – Am Einsatzort") an der Fahrzeug-Zeile sichtbar. Kopf verdichtet Fahrzeuge nur nach `status_kategorie`.

Kopf-JSX um zwei `Card`-Blöcke ergänzen (Fahrzeuge nach Kategorie, Material nach Status):
```typescript
<Statistic title="Fzg verfügbar" value={v.fahrzeugStatus.verfuegbar} />
<Statistic title="Fzg gebunden" value={v.fahrzeugStatus.gebunden} />
<Statistic title="Fzg n. einsatzbereit" value={v.fahrzeugStatus.nicht_verfuegbar} />
```

- [ ] **Step 4: Run, verify pass** — beide Testdateien grün:
`cd frontend && npx vitest run src/kraefte/kraeftebild.test.ts src/pages/KraefteuebersichtPage.test.tsx`

- [ ] **Step 5: Commit**

```bash
git add frontend/src/kraefte/ frontend/src/pages/KraefteuebersichtPage.tsx
git commit -m "feat(fe): Verdichtungskopf mit getrennten Status-Achsen (LFH-49)"
```

---

## Task 5: Live-Anbindung vervollständigen

**Files:**
- Modify: `frontend/src/etb/useEinsatzLiveStream.ts`
- Test: `frontend/src/etb/useEinsatzLiveStream.test.ts` (neu, falls nicht vorhanden)

Der Hook invalidiert bei `einheit`/`person` bisher nicht `einsatz-personal`/`einsatz-material`. Das Meldebild braucht diese live. Additive Ergänzung (mehr Invalidierung ist nie schädlich).

- [ ] **Step 1: Failing test — Personal/Material werden invalidiert**

```typescript
// useEinsatzLiveStream.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement } from 'react';
import { useEinsatzLiveStream } from './useEinsatzLiveStream';

class FakeES { listeners: Record<string, (e: unknown) => void> = {};
  constructor(public url: string) { (FakeES as any).last = this; }
  addEventListener(n: string, cb: (e: unknown) => void) { this.listeners[n] = cb; }
  removeEventListener(n: string) { delete this.listeners[n]; }
  close() {} emit(n: string) { this.listeners[n]?.({}); } }

beforeEach(() => { (globalThis as any).EventSource = FakeES; });
afterEach(() => { vi.restoreAllMocks(); });

it('invalidiert einsatz-personal & einsatz-material bei einheit-Event', () => {
  const qc = new QueryClient();
  const spy = vi.spyOn(qc, 'invalidateQueries');
  renderHook(() => useEinsatzLiveStream(1), {
    wrapper: ({ children }) => createElement(QueryClientProvider, { client: qc }, children),
  });
  (FakeES as any).last.emit('einheit');
  const keys = spy.mock.calls.map((c) => (c[0] as any).queryKey[0]);
  expect(keys).toContain('einsatz-personal');
  expect(keys).toContain('einsatz-material');
});
```

- [ ] **Step 2: Run, verify fail** — `cd frontend && npx vitest run src/etb/useEinsatzLiveStream.test.ts` → FAIL.

- [ ] **Step 3: Implement** — in `useEinsatzLiveStream.ts` `onEinheit` und `onPerson` erweitern:
```typescript
    const onEinheit = () => {
      inval('einsatz-einheiten');
      inval('einsatz-fuehrungskraefte');
      inval('einsatz-personal');
      inval('einsatz-fahrzeuge');
      inval('einsatz-material');
    };
```
und in `onPerson` zusätzlich `inval('einsatz-personal');`. In `onLag` (lagged) ebenfalls `inval('einsatz-personal'); inval('einsatz-material');` ergänzen.

- [ ] **Step 4: Run, verify pass** — FAIL→PASS. Außerdem Regression: `cd frontend && npx vitest run src/pages/LageberichtePage.test.tsx` muss weiter grün sein.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/etb/useEinsatzLiveStream.ts frontend/src/etb/useEinsatzLiveStream.test.ts
git commit -m "feat(fe): Live-Stream invalidiert Personal/Material fürs Meldebild (LFH-49)"
```

---

## Task 6: Filterleiste (Abschnitt / Trägerorganisation / Status / Suche)

**Files:**
- Modify: `frontend/src/kraefte/kraeftebild.ts` (Filter-Vorstufe, pur)
- Modify: `frontend/src/kraefte/kraeftebild.test.ts`
- Modify: `frontend/src/pages/KraefteuebersichtPage.tsx`

Filter wirkt auf die **Blattmenge** vor der Aggregation — Summen ziehen mit (Spec-Festlegung).

- [ ] **Step 1: Failing test — Filterfunktion**

```typescript
import { filtereKraefte } from './kraeftebild';

it('filtert Personal nach Trägerorganisation und Summe zieht mit', () => {
  const personal = [
    { ...p(1, null, 'mannschaft'), traegerorganisation: 'THW' },
    { ...p(2, null, 'mannschaft'), traegerorganisation: 'FW' },
  ];
  const ge = filtereKraefte({ abschnitte: [], einheiten: [], personal, fahrzeuge: [], material: [] },
    { traeger: 'THW', abschnittId: null, kategorie: null, suche: '' });
  const bild = baueKraeftebild(ge.abschnitte, ge.einheiten, ge.personal, ge.fahrzeuge, ge.material);
  expect(bild.verdichtung.anzahlPersonal).toBe(1);
});
```

- [ ] **Step 2: Run, verify fail.**

- [ ] **Step 3: Implement `filtereKraefte`** in `kraeftebild.ts`:
```typescript
export interface Rohdaten {
  abschnitte: Einsatzabschnitt[]; einheiten: Einheit[]; personal: EinsatzPersonal[];
  fahrzeuge: EinsatzFahrzeug[]; material: EinsatzMaterial[];
}
export interface FilterWerte { abschnittId: number | null; traeger: string | null; kategorie: StatusKategorie | null; suche: string; }

export function filtereKraefte(roh: Rohdaten, f: FilterWerte): Rohdaten {
  const s = f.suche.trim().toLowerCase();
  const treffer = (txt: (string | null)[]) => !s || txt.some((t) => t?.toLowerCase().includes(s));
  // Abschnittsfilter: erlaubte Einheiten-IDs = Einheiten im Abschnitt (inkl. Unterabschnitte ist v2 — v1: direkter Abschnitt)
  const einheitErlaubt = (e: Einheit) => f.abschnittId == null || e.abschnitt_id === f.abschnittId;
  const erlaubteEinheiten = new Set(roh.einheiten.filter(einheitErlaubt).map((e) => e.id));
  const passt = (einheit_id: number | null, traeger: string | null, kat: StatusKategorie | null, txt: (string|null)[]) =>
    (f.abschnittId == null || (einheit_id != null && erlaubteEinheiten.has(einheit_id))) &&
    (!f.traeger || traeger === f.traeger) &&
    (!f.kategorie || kat === f.kategorie) && treffer(txt);
  return {
    abschnitte: roh.abschnitte,
    einheiten: roh.einheiten.filter(einheitErlaubt),
    personal: roh.personal.filter((x) => passt(x.einheit_id, x.traegerorganisation, x.status_kategorie, [x.name, x.funktion])),
    fahrzeuge: roh.fahrzeuge.filter((x) => passt(x.einheit_id, x.traegerorganisation, x.status_kategorie, [x.funkrufname, x.fahrzeugtyp])),
    material: roh.material.filter((x) => passt(x.einheit_id, x.traegerorganisation, null, [x.bezeichnung])),
  };
}
```

- [ ] **Step 4: Run, verify pass.**

- [ ] **Step 5: Filter-UI in der Seite** — `useState<FilterWerte>`; eine `Space` mit `Select` (Abschnitt aus `abschnitteQuery.data`, Trägerorganisation aus distinct der Listen, Kategorie fest) + `Input.Search`. `bild` aus `baueKraeftebild(...filtereKraefte(roh, filter))`. Trägeroptionen:
```typescript
const traeger = useMemo(() => [...new Set([
  ...(personalQuery.data ?? []).map((x) => x.traegerorganisation),
  ...(fahrzeugeQuery.data ?? []).map((x) => x.traegerorganisation),
].filter((t): t is string => !!t))].sort(), [personalQuery.data, fahrzeugeQuery.data]);
```
Smoke-Test in `KraefteuebersichtPage.test.tsx`: Filter-Select „Trägerorganisation" ist im DOM.

- [ ] **Step 6: Run gesamte Datei grün, dann Commit**

```bash
git add frontend/src/kraefte/ frontend/src/pages/KraefteuebersichtPage.tsx frontend/src/pages/KraefteuebersichtPage.test.tsx
git commit -m "feat(fe): Filter (Abschnitt/TO/Status/Suche) fürs Meldebild (LFH-49)"
```

---

## Task 7: Druck-/PDF-Ansicht

**Files:**
- Create: `frontend/src/pages/kraefteuebersichtPrint.css`
- Modify: `frontend/src/pages/KraefteuebersichtPage.tsx`

- [ ] **Step 1: Print-CSS** (Muster aus `lageberichtPrint.css`):
```css
@media print {
  body * { visibility: hidden; }
  .kraefte-print-root, .kraefte-print-root * { visibility: visible; }
  .kraefte-print-root { position: absolute; left: 0; top: 0; width: 100%; padding: 0; }
  .kraefte-no-print { display: none !important; }
}
```

- [ ] **Step 2: Failing test — Druck-Button vorhanden & Print-Root-Klasse**

```typescript
it('zeigt einen Druck-Button', async () => {
  setup();
  expect(await screen.findByRole('button', { name: /Drucken/i })).toBeInTheDocument();
});
```

- [ ] **Step 3: Implement** — `import './kraefteuebersichtPrint.css';`. Äußeres `div` Klasse `kraefte-print-root`; Breadcrumb/Filter in einen `kraefte-no-print`-Wrapper. Button:
```typescript
<Button className="kraefte-no-print" onClick={() => window.print()}>Drucken / als PDF</Button>
```
Beim Drucken alle Knoten zeigen: `expandedRowKeys` im Druckfall auf alle Keys setzen — v1-Vereinfachung: `expandable={{ defaultExpandAllRows: false, expandedRowKeys, onExpandedRowsChange }}` und vor `window.print()` `setExpandedRowKeys(alleKeys(bild.baum))`. Helfer `alleKeys` (rekursiv über `children`) in der Seite.

- [ ] **Step 4: Run, verify pass.**

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/kraefteuebersichtPrint.css frontend/src/pages/KraefteuebersichtPage.tsx frontend/src/pages/KraefteuebersichtPage.test.tsx
git commit -m "feat(fe): Druck-/PDF-Ansicht fürs Meldebild (LFH-49)"
```

---

## Task 8: Lagebericht-Übernahme

**Files:**
- Modify: `frontend/src/kraefte/kraeftebild.ts` (Markdown-Render, pur)
- Modify: `frontend/src/kraefte/kraeftebild.test.ts`
- Modify: `frontend/src/pages/KraefteuebersichtPage.tsx`

- [ ] **Step 1: Failing test — Markdown-Render deterministisch**

```typescript
import { rendereMeldebildMarkdown } from './kraeftebild';

it('rendert das Meldebild als Markdown mit Kopfzeile und Abschnitten', () => {
  const bild = baueKraeftebild([ab(1)], [eh(10, 1)], [p(1, 10, 'fuehrer')], [], []);
  const md = rendereMeldebildMarkdown(bild, 'Stand 12:00');
  expect(md).toContain('# Kräftemeldebild');
  expect(md).toContain('Stand 12:00');
  expect(md).toContain('Gesamtstärke');
  expect(md).toContain('A1');
});
```

- [ ] **Step 2: Run, verify fail.**

- [ ] **Step 3: Implement `rendereMeldebildMarkdown(bild, stand)`** — deterministisch: Titelzeile, Verdichtung (F/UF/M, Fahrzeug-Kategorien, Material-Anzahl), dann Baum rekursiv mit Einrückung (Abschnitt `## `, Einheit `- `, Mittel `  - `). Pure Funktion, keine Date-Aufrufe (Stand wird übergeben).

- [ ] **Step 4: Run, verify pass.**

- [ ] **Step 5: Button + Aktion in der Seite**

```typescript
import { legeLageberichtAn, aktualisiereLagebericht } from '../api/lageberichte';
import { useNavigate } from 'react-router-dom';
import { App as AntApp } from 'antd';
// …
const navigate = useNavigate();
const { message } = AntApp.useApp();
const uebernehmen = useMutation({
  mutationFn: async () => {
    const stand = new Date().toLocaleString('de-DE');
    const md = rendereMeldebildMarkdown(bild, stand);
    const lb = await legeLageberichtAn(einsatzId, { vorlage: 'freitext', titel: `Kräftemeldebild ${stand}` });
    await aktualisiereLagebericht(einsatzId, lb.id, { abschnitte: [{ schluessel: 'text', text: md }] });
    return lb.id;
  },
  onSuccess: (lbId) => navigate(`/einsaetze/${einsatzId}/lageberichte/${lbId}`),
  onError: () => message.error('Übernahme fehlgeschlagen'),
});
```
Button (nur wenn Schreibrecht — `einsatz.status === 'aktiv'` und Führungsrolle, analog `EinsatzabschnittePage` `darfSchreiben`):
```typescript
<Button className="kraefte-no-print" loading={uebernehmen.isPending} onClick={() => uebernehmen.mutate()}>In Lagebericht übernehmen</Button>
```

> **Hinweis:** Den `freitext`-Abschnitts-Schlüssel (`'text'`) gegen die Lagebericht-Vorlagen-Registry verifizieren (Backend `src/lagebericht/mod.rs` / FE-Vorlagendefinition); falls anders, dort ablesen und einsetzen. Test der Aktion mit gemockten `legeLageberichtAn`/`aktualisiereLagebericht`.

- [ ] **Step 6: Run, verify pass** — Aggregations- und Seiten-Tests grün.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/kraefte/ frontend/src/pages/KraefteuebersichtPage.tsx
git commit -m "feat(fe): Meldebild als Lagebericht übernehmen (LFH-49)"
```

---

## Task 9: Verifikation & Abschluss

- [ ] **Step 1: Volle Frontend-Suite** (Gate, ehrlicher Exit-Code):
Run: `cd frontend && rtk proxy npx vitest run --no-file-parallelism`
Expected: alle grün (inkl. bestehender Tests, keine Regression).

- [ ] **Step 2: Typecheck & Lint:**
Run: `cd frontend && rtk proxy npx tsc --noEmit` und `rtk proxy pnpm lint` (falls Lint-Script vorhanden).
Expected: keine Fehler.

- [ ] **Step 3: Manuelles Sichten** (optional, da Embedding): `pnpm build` im frontend + Backend neu starten; Modul „Kräfteübersicht" unter einem aktiven Einsatz öffnen, Auf-/Zuklappen, Filter, Druckvorschau prüfen.

- [ ] **Step 4: Code-Review** über `superpowers:requesting-code-review`, dann Board-Status `in review`.

- [ ] **Step 5: Integration** über `superpowers:finishing-a-development-branch`.

---

## Self-Review (gegen Spec)

- **Reine FE-Aggregation, kein Backend** → Tasks 1–8 fassen nur Frontend an. ✓
- **Layout A Tree-Table** → Task 3. ✓
- **Volle Hierarchie, Blatt-Aggregation, Catch-all** → Task 1 (Tests für Verschachtelung Abschnitt+Einheit + „Ohne Zuordnung"). ✓
- **Zwei getrennte Achsen (Personal-Stärke / Fahrzeug-Status / Material)** → Task 4. ✓
- **Invariante als Akzeptanztest** → Task 1 Step 1/5. ✓
- **Live (SSE)** → Task 5 (additive Hook-Ergänzung, da Personal/Material-Lücke). ✓
- **Filter** → Task 6 (wirkt auf Blattmenge, Summen ziehen mit). ✓
- **Druck/PDF** → Task 7. ✓
- **Lagebericht-Verknüpfung ohne Backend-Change** → Task 8 (`POST` freitext + `PATCH` abschnitte). ✓
- **Korrektur eingearbeitet:** `EinsatzFahrzeug` hat kein `fms_anker` → `fahrzeugFms`/`fmsAnker` gestrichen, FMS via `status_label`. (In Task 1-Typen `fmsAnker` weglassen bzw. aus `status_label` ableiten.)
- **Berechtigungen:** Lesen für alle; „In Lagebericht übernehmen" nur mit Schreibrecht (Task 8). ✓
- **Bekannte Einschränkung:** Material-Live nur bei `einheit`-Event (kein eigenes Material-SSE-Event) — dokumentiert, akzeptabel für v1.
