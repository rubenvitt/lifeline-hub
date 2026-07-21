# LFH-268 / F24: Zentrale 401-Behandlung Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ein abgelaufenes Session-Cookie führt überall in der App zu genau einem sauberen
Re-Login mit korrekter Rückkehr-URL — statt heute nur im Einsatz-Workspace, und statt im
ETB-Puffer zu einem stillen Endlos-Retry.

**Architecture:** Ein geteilter QueryClient-Bauplan (`erzeugeQueryClient`) trägt `QueryCache`-
und `MutationCache`-`onError`. Diese Callbacks entstehen außerhalb des React-Baums (der
`QueryClientProvider` sitzt in `main.tsx` über `AntApp` und `BrowserRouter`) und können
`message`/`navigate` deshalb strukturell nicht lesen. Die Brücke ist ein window-CustomEvent
`lfh:sitzung-abgelaufen` — dasselbe Muster wie die bestehenden `lfh:*`-Events. Ein Listener auf
App-Ebene (innerhalb `AntApp`, `BrowserRouter`, `AuthProvider`) macht daraus `logout()` +
`navigate('/login')`. Die bestehende SSE-401-Brücke und die Offline-ETB-Queue speisen denselben
Kanal, statt je eigene Mechanik zu haben.

**Tech Stack:** React 19, TanStack Query 5.101.2, react-router-dom, antd 6, Vitest 4 + MSW 2.

## Global Constraints

- **Der globale Handler behandelt NUR 401 und schweigt sonst.** In TanStack Query v5 feuert
  `MutationCache.onError` **zusätzlich** zum mutationseigenen `onError` (verifiziert in
  `query-core/build/modern/mutation.js:148` vs. `:159`, getrennte try/catch). Ein generischer
  Fallback-Toast würde deshalb neben jeden der 98 lokalen Handler einen zweiten Toast setzen.
  `QueryCache.onError` ist noch schärfer: es feuert unbedingt bei **jedem** Query-Fehler
  inklusive stiller Hintergrund-Refetches (`query.js:323-331`, ohne Bedingung).
- **Keine Änderung an den 98 lokalen `instanceof ApiError`-Handlern.** Der Dedup-Sweep ist
  bewusst nicht Teil dieses Tasks.
- **Kein statisches `message.*`/`Modal.*`.** Projektregel: `App.useApp()` — statische antd-APIs
  rendern außerhalb des RTL-Baums und machen Folgetests flaky. Im gesamten Nicht-Test-Code
  gibt es dafür heute 0 Verstöße; das bleibt so.
- **Lint läuft mit `--max-warnings 0`.** `react-hooks/exhaustive-deps` strukturell lösen, nicht
  per Disable erschlagen.
- **Vitest-Gate:** `pnpm test --run --no-file-parallelism` (die volle Suite ist unter Last
  parallel flaky). pnpm immer über `mise exec pnpm@11.10.0 -- pnpm -C <absoluter-pfad>`.
- **Commits referenzieren `LFH-268`.**

---

### Task 1: Sitzungs-Event mit Wiederhol-Sperre

Der Kanal zwischen den React-freien Cache-Callbacks und dem React-Baum. Die Sperre ist
notwendig, weil bei Session-Ablauf typischerweise mehrere Queries gleichzeitig in 401 laufen —
ohne sie gäbe es N Events und N Navigations-Versuche.

**Files:**
- Create: `frontend/src/auth/sitzungsEvent.ts`
- Test: `frontend/src/auth/sitzungsEvent.test.ts`

**Interfaces:**
- Consumes: nichts
- Produces:
  - `export const SITZUNG_ABGELAUFEN = 'lfh:sitzung-abgelaufen'`
  - `export function meldeSitzungAbgelaufen(): void`
  - `export function sitzungsMeldungZuruecksetzen(): void`

- [ ] **Step 1: Write the failing test**

```ts
// frontend/src/auth/sitzungsEvent.test.ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  SITZUNG_ABGELAUFEN,
  meldeSitzungAbgelaufen,
  sitzungsMeldungZuruecksetzen,
} from './sitzungsEvent';

afterEach(() => sitzungsMeldungZuruecksetzen());

describe('sitzungsEvent', () => {
  it('meldet einen Sitzungsablauf als window-Event', () => {
    const horcher = vi.fn();
    window.addEventListener(SITZUNG_ABGELAUFEN, horcher);
    meldeSitzungAbgelaufen();
    window.removeEventListener(SITZUNG_ABGELAUFEN, horcher);
    expect(horcher).toHaveBeenCalledTimes(1);
  });

  it('meldet nur EINMAL, auch wenn mehrere Anfragen gleichzeitig 401 liefern', () => {
    const horcher = vi.fn();
    window.addEventListener(SITZUNG_ABGELAUFEN, horcher);
    meldeSitzungAbgelaufen();
    meldeSitzungAbgelaufen();
    meldeSitzungAbgelaufen();
    window.removeEventListener(SITZUNG_ABGELAUFEN, horcher);
    expect(horcher).toHaveBeenCalledTimes(1);
  });

  it('meldet nach einem erfolgreichen Re-Login wieder', () => {
    const horcher = vi.fn();
    window.addEventListener(SITZUNG_ABGELAUFEN, horcher);
    meldeSitzungAbgelaufen();
    sitzungsMeldungZuruecksetzen();
    meldeSitzungAbgelaufen();
    window.removeEventListener(SITZUNG_ABGELAUFEN, horcher);
    expect(horcher).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `mise exec pnpm@11.10.0 -- pnpm -C /Users/rubeen/dev/personal/lifeline-hub/.claude/worktrees/lfh-268-zentrales-fehler-handling/frontend test --run src/auth/sitzungsEvent.test.ts`
Expected: FAIL — `Failed to resolve import "./sitzungsEvent"`

- [ ] **Step 3: Write minimal implementation**

```ts
// frontend/src/auth/sitzungsEvent.ts
/** Kanal zwischen den React-freien react-query-Cache-Callbacks und dem React-Baum (LFH-268/F24).
 *  Der QueryClient entsteht in `main.tsx` auf Modulebene und liegt in der Provider-Hierarchie
 *  ÜBER `AntApp` und `BrowserRouter` — seine `onError`-Closures können `message` und `navigate`
 *  deshalb strukturell nicht lesen. Ein window-CustomEvent ist im Projekt das etablierte Mittel
 *  dafür (vgl. `lfh:live-status`, `lfh:sofortmeldung`, `lfh:erinnerung-alarm`). */
export const SITZUNG_ABGELAUFEN = 'lfh:sitzung-abgelaufen';

/** Wiederhol-Sperre: bei Session-Ablauf laufen typischerweise mehrere Queries gleichzeitig in
 *  401. Ohne die Sperre gäbe es N Events und damit N `logout()`/`navigate()`-Versuche. */
let bereitsGemeldet = false;

/** Meldet einen erkannten Sitzungsablauf genau einmal — bis
 *  {@link sitzungsMeldungZuruecksetzen} die Sperre löst. */
export function meldeSitzungAbgelaufen(): void {
  if (bereitsGemeldet) return;
  bereitsGemeldet = true;
  window.dispatchEvent(new CustomEvent(SITZUNG_ABGELAUFEN));
}

/** Löst die Sperre — aufzurufen, sobald wieder eine gültige Sitzung besteht (Login,
 *  `aktualisiere`). Sonst bliebe ein zweiter Ablauf in derselben Browser-Sitzung stumm. */
export function sitzungsMeldungZuruecksetzen(): void {
  bereitsGemeldet = false;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `mise exec pnpm@11.10.0 -- pnpm -C /Users/rubeen/dev/personal/lifeline-hub/.claude/worktrees/lfh-268-zentrales-fehler-handling/frontend test --run src/auth/sitzungsEvent.test.ts`
Expected: PASS (3 Tests)

- [ ] **Step 5: Commit**

```bash
git add frontend/src/auth/sitzungsEvent.ts frontend/src/auth/sitzungsEvent.test.ts
git commit -m "feat(lfh-268): Sitzungsablauf-Event mit Wiederhol-Sperre (F24)"
```

---

### Task 2: Geteilte QueryClient-Fabrik mit 401-Erkennung

Heute existieren drei getrennte QueryClient-Konstruktionen: `main.tsx:20`, `test/utils.tsx:9`
und 17 inline in 15 Testdateien. Ein nur in `main.tsx` ergänztes `onError` wäre in **keinem**
Test sichtbar — der Handler wäre unbeweisbar. Deshalb zuerst die Fabrik.

**Files:**
- Create: `frontend/src/api/queryClient.ts`
- Test: `frontend/src/api/queryClient.test.ts`

**Interfaces:**
- Consumes: `SITZUNG_ABGELAUFEN`, `meldeSitzungAbgelaufen`, `sitzungsMeldungZuruecksetzen` (Task 1); `ApiError` aus `./client`
- Produces: `export function erzeugeQueryClient(defaultOptions?: DefaultOptions): QueryClient`

- [ ] **Step 1: Write the failing test**

```tsx
// frontend/src/api/queryClient.test.ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from './client';
import { erzeugeQueryClient } from './queryClient';
import { SITZUNG_ABGELAUFEN, sitzungsMeldungZuruecksetzen } from '../auth/sitzungsEvent';

afterEach(() => sitzungsMeldungZuruecksetzen());

/** Führt eine Mutation aus, die mit `fehler` scheitert, und wartet ihr Ende ab. */
async function mutationScheitert(fehler: unknown) {
  const client = erzeugeQueryClient({ mutations: { retry: false } });
  await client
    .getMutationCache()
    .build(client, { mutationFn: () => Promise.reject(fehler) })
    .execute(undefined)
    .catch(() => {});
}

/** Führt eine Query aus, die mit `fehler` scheitert, und wartet ihr Ende ab. */
async function queryScheitert(fehler: unknown) {
  const client = erzeugeQueryClient({ queries: { retry: false } });
  await client
    .fetchQuery({ queryKey: ['test-401'], queryFn: () => Promise.reject(fehler) })
    .catch(() => {});
}

describe('erzeugeQueryClient — globale 401-Erkennung', () => {
  it('meldet den Sitzungsablauf, wenn eine Mutation 401 liefert', async () => {
    const horcher = vi.fn();
    window.addEventListener(SITZUNG_ABGELAUFEN, horcher);
    await mutationScheitert(new ApiError(401, 'Nicht angemeldet'));
    window.removeEventListener(SITZUNG_ABGELAUFEN, horcher);
    expect(horcher).toHaveBeenCalledTimes(1);
  });

  it('meldet den Sitzungsablauf, wenn eine Query 401 liefert', async () => {
    const horcher = vi.fn();
    window.addEventListener(SITZUNG_ABGELAUFEN, horcher);
    await queryScheitert(new ApiError(401, 'Nicht angemeldet'));
    window.removeEventListener(SITZUNG_ABGELAUFEN, horcher);
    expect(horcher).toHaveBeenCalledTimes(1);
  });

  it('schweigt bei jedem anderen ApiError — die lokalen onError-Handler melden ihn', async () => {
    const horcher = vi.fn();
    const konsole = vi.spyOn(console, 'error').mockImplementation(() => {});
    window.addEventListener(SITZUNG_ABGELAUFEN, horcher);
    await mutationScheitert(new ApiError(422, 'Ort darf nicht leer sein'));
    await mutationScheitert(new ApiError(409, 'Stornierter Schaden'));
    await queryScheitert(new ApiError(500, 'kaputt'));
    window.removeEventListener(SITZUNG_ABGELAUFEN, horcher);
    expect(horcher).not.toHaveBeenCalled();
    expect(konsole).not.toHaveBeenCalled();
    konsole.mockRestore();
  });

  it('protokolliert unerwartete Nicht-ApiError-Fehler, meldet aber keinen Sitzungsablauf', async () => {
    const horcher = vi.fn();
    const konsole = vi.spyOn(console, 'error').mockImplementation(() => {});
    window.addEventListener(SITZUNG_ABGELAUFEN, horcher);
    await mutationScheitert(new TypeError('Failed to fetch'));
    window.removeEventListener(SITZUNG_ABGELAUFEN, horcher);
    expect(horcher).not.toHaveBeenCalled();
    expect(konsole).toHaveBeenCalledTimes(1);
    konsole.mockRestore();
  });

  it('übernimmt die übergebenen defaultOptions', () => {
    const client = erzeugeQueryClient({ queries: { retry: false, gcTime: 0 } });
    expect(client.getDefaultOptions().queries?.gcTime).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `mise exec pnpm@11.10.0 -- pnpm -C /Users/rubeen/dev/personal/lifeline-hub/.claude/worktrees/lfh-268-zentrales-fehler-handling/frontend test --run src/api/queryClient.test.ts`
Expected: FAIL — `Failed to resolve import "./queryClient"`

- [ ] **Step 3: Write minimal implementation**

```ts
// frontend/src/api/queryClient.ts
import { MutationCache, QueryCache, QueryClient, type DefaultOptions } from '@tanstack/react-query';
import { ApiError } from './client';
import { meldeSitzungAbgelaufen } from '../auth/sitzungsEvent';

/** Globaler Fehler-Seam für Queries UND Mutationen (LFH-268/F24).
 *
 *  Behandelt bewusst **nur 401** und schweigt sonst. Grund: in react-query v5 feuert
 *  `MutationCache.onError` ZUSÄTZLICH zum mutationseigenen `onError` (query-core
 *  `mutation.js:148` vor `:159`, getrennte try/catch), und `QueryCache.onError` feuert
 *  unbedingt bei jedem Query-Fehler inklusive stiller Hintergrund-Refetches
 *  (`query.js:323-331`). Ein generischer Toast an dieser Stelle stünde also neben jeder der
 *  98 lokalen Fehlermeldungen — und bei Refetches ohne jeden Nutzeranlass.
 *
 *  Ein `ApiError` ≠ 401 ist eine vom Server verstandene fachliche Ablehnung; für die ist der
 *  lokale Handler zuständig, der den Kontext kennt (Formularfeld, Überschreiben-Dialog,
 *  Offline-Queue). Alles, was KEIN `ApiError` ist, ist dagegen unerwartet (Netzfehler,
 *  Programmierfehler) und wird protokolliert. */
function behandleFehler(fehler: unknown): void {
  if (fehler instanceof ApiError) {
    if (fehler.status === 401) meldeSitzungAbgelaufen();
    return;
  }
  console.error('Unerwarteter Fehler in einer Query/Mutation', fehler);
}

/** Einziger Bauplan für den QueryClient — von `main.tsx` UND `test/utils.tsx` genutzt.
 *  Ohne diese geteilte Fabrik wäre der globale Handler in keinem Test sichtbar (der
 *  Produktions-Client aus `main.tsx` wird von 0 Testdateien importiert). */
export function erzeugeQueryClient(defaultOptions?: DefaultOptions): QueryClient {
  return new QueryClient({
    defaultOptions,
    queryCache: new QueryCache({ onError: behandleFehler }),
    mutationCache: new MutationCache({ onError: behandleFehler }),
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `mise exec pnpm@11.10.0 -- pnpm -C /Users/rubeen/dev/personal/lifeline-hub/.claude/worktrees/lfh-268-zentrales-fehler-handling/frontend test --run src/api/queryClient.test.ts`
Expected: PASS (5 Tests)

- [ ] **Step 5: Commit**

```bash
git add frontend/src/api/queryClient.ts frontend/src/api/queryClient.test.ts
git commit -m "feat(lfh-268): geteilte QueryClient-Fabrik mit globaler 401-Erkennung (F24)"
```

---

### Task 3: Fabrik in Produktion und Tests verdrahten

Ohne diesen Schritt existiert die Fabrik, wird aber von niemandem benutzt.

**Files:**
- Modify: `frontend/src/main.tsx:5,20-22`
- Modify: `frontend/src/test/utils.tsx:1,9-16`

**Interfaces:**
- Consumes: `erzeugeQueryClient` (Task 2)
- Produces: nichts Neues — `neuerQueryClient()` behält Signatur und Verhalten

- [ ] **Step 1: main.tsx auf die Fabrik umstellen**

In `frontend/src/main.tsx` den Import in Zeile 5 ändern und die Konstruktion ersetzen:

```tsx
// Zeile 5 — QueryClient wird nicht mehr direkt konstruiert
import { QueryClientProvider } from '@tanstack/react-query';
// … neuer Import bei den übrigen lokalen Imports
import { erzeugeQueryClient } from './api/queryClient';

// Zeilen 20-22 ersetzen durch:
const queryClient = erzeugeQueryClient({ queries: { retry: false, staleTime: 10_000 } });
```

- [ ] **Step 2: test/utils.tsx auf die Fabrik umstellen**

In `frontend/src/test/utils.tsx` Zeile 1 und die Funktion `neuerQueryClient` ersetzen:

```tsx
// Zeile 1
import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
// … neuer Import
import { erzeugeQueryClient } from '../api/queryClient';

/** Frischer QueryClient ohne Retries/Cache-Wiederverwendung — deterministische Tests.
 *  Nutzt bewusst dieselbe Fabrik wie `main.tsx`, damit der globale 401-Seam (LFH-268)
 *  in Tests dieselbe Wirkung hat wie in Produktion. */
export function neuerQueryClient(): QueryClient {
  return erzeugeQueryClient({
    queries: { retry: false, gcTime: 0 },
    mutations: { retry: false },
  });
}
```

- [ ] **Step 3: Typecheck und volle Suite fahren**

Run: `mise exec pnpm@11.10.0 -- pnpm -C /Users/rubeen/dev/personal/lifeline-hub/.claude/worktrees/lfh-268-zentrales-fehler-handling/frontend exec tsc --noEmit`
Expected: keine Ausgabe (Exit 0)

Run: `mise exec pnpm@11.10.0 -- pnpm -C /Users/rubeen/dev/personal/lifeline-hub/.claude/worktrees/lfh-268-zentrales-fehler-handling/frontend test --run --no-file-parallelism`
Expected: PASS — 192 Dateien, 1441 Tests, 1 übersprungen. **Erwartung explizit: keine neuen
Fehlschläge.** Der Handler ist bei Nicht-401 stumm, deshalb entstehen keine Doppel-Toasts; die
im Scope vermuteten Brüche in `SchaedenDetailPage.test.tsx:154` und `TiereDetailPage.test.tsx:156`
setzen einen zusätzlichen Toast voraus, den es hier nicht gibt. Bricht dennoch etwas, ist das
ein echter Befund — nicht wegkonfigurieren, sondern verstehen.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/main.tsx frontend/src/test/utils.tsx
git commit -m "feat(lfh-268): QueryClient-Fabrik in main.tsx und Test-Providern verdrahten (F24)"
```

---

### Task 4: Sitzungswache auf App-Ebene

Der Listener, der aus dem Event den Re-Login macht. `App` ist die erste Komponente, die
innerhalb von `AntApp`, `BrowserRouter` und `AuthProvider` liegt (`main.tsx:26-35`) — also die
oberste Stelle mit Zugriff auf `navigate` und `logout`. `EinsatzLayout` ist genau die zu enge
Stelle, die heute `/admin`, `/profil`, Stammdaten und die Einsatzliste ungedeckt lässt.

**Files:**
- Create: `frontend/src/auth/useSitzungsWache.ts`
- Create: `frontend/src/auth/useSitzungsWache.test.tsx`
- Modify: `frontend/src/App.tsx` (Aufruf im Komponenten-Rumpf)

**Interfaces:**
- Consumes: `SITZUNG_ABGELAUFEN` (Task 1), `useAuth` aus `./AuthContext`
- Produces: `export function useSitzungsWache(): void`

- [ ] **Step 1: Write the failing test**

```tsx
// frontend/src/auth/useSitzungsWache.test.tsx
import { describe, expect, it, vi, afterEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { useSitzungsWache } from './useSitzungsWache';
import { SITZUNG_ABGELAUFEN, sitzungsMeldungZuruecksetzen } from './sitzungsEvent';

const logout = vi.fn(() => Promise.resolve());

vi.mock('./AuthContext', async (echt) => ({
  ...(await echt<typeof import('./AuthContext')>()),
  useAuth: () => ({ benutzer: null, laedt: false, login: vi.fn(), logout, aktualisiere: vi.fn() }),
}));

afterEach(() => {
  sitzungsMeldungZuruecksetzen();
  logout.mockClear();
});

/** Rendert die Wache unter `route` und macht Pfad + Rückkehr-URL sichtbar. */
function Sonde() {
  useSitzungsWache();
  const ort = useLocation();
  const von = (ort.state as { von?: string } | null)?.von ?? '';
  return <div data-testid="ort">{`${ort.pathname}|${von}`}</div>;
}

function renderWache(route: string) {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <Routes>
        <Route path="*" element={<Sonde />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('useSitzungsWache', () => {
  it('meldet ab und leitet zum Login, wenn die Sitzung abläuft', async () => {
    const { getByTestId } = renderWache('/admin/benutzer');
    window.dispatchEvent(new CustomEvent(SITZUNG_ABGELAUFEN));
    await waitFor(() => expect(getByTestId('ort').textContent).toMatch(/^\/login\|/));
    expect(logout).toHaveBeenCalledTimes(1);
  });

  it('nimmt Query-String und Hash in die Rückkehr-URL auf', async () => {
    const { getByTestId } = renderWache('/einsaetze/7/etb?eintrag=42#unten');
    window.dispatchEvent(new CustomEvent(SITZUNG_ABGELAUFEN));
    await waitFor(() =>
      expect(getByTestId('ort').textContent).toBe('/login|/einsaetze/7/etb?eintrag=42#unten'),
    );
  });

  it('leitet auf der Login-Seite nicht erneut um (keine Schleife)', async () => {
    const { getByTestId } = renderWache('/login');
    window.dispatchEvent(new CustomEvent(SITZUNG_ABGELAUFEN));
    await new Promise((r) => setTimeout(r, 20));
    expect(getByTestId('ort').textContent).toBe('/login|');
    expect(logout).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `mise exec pnpm@11.10.0 -- pnpm -C /Users/rubeen/dev/personal/lifeline-hub/.claude/worktrees/lfh-268-zentrales-fehler-handling/frontend test --run src/auth/useSitzungsWache.test.tsx`
Expected: FAIL — `Failed to resolve import "./useSitzungsWache"`

- [ ] **Step 3: Write minimal implementation**

```ts
// frontend/src/auth/useSitzungsWache.ts
import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from './AuthContext';
import { SITZUNG_ABGELAUFEN } from './sitzungsEvent';

/** Einziger Empfänger von {@link SITZUNG_ABGELAUFEN} (LFH-268/F24). Gehört in `App`, weil das
 *  die oberste Komponente innerhalb von `AntApp`, `BrowserRouter` und `AuthProvider` ist — die
 *  Vorgänger-Brücke saß in `EinsatzLayout` und ließ damit `/admin`, `/profil`, die Stammdaten
 *  und die Einsatzliste ohne jede 401-Behandlung. */
export function useSitzungsWache(): void {
  const { logout } = useAuth();
  const navigate = useNavigate();
  const { pathname, search, hash } = useLocation();

  useEffect(() => {
    // Auf der Login-Seite selbst gäbe es nichts umzuleiten — und der Rückkehr-Pfad wäre
    // `/login`, was nach dem Anmelden auf sich selbst zeigte.
    if (pathname === '/login') return;

    const beiAblauf = () => {
      // Vollständige Rückkehr-URL: `pathname` allein verliert die Deeplink-Selektion des
      // Query-Param-Musters (`?einheit=`, `?meldung=`, ETB `?eintrag=` — s. CLAUDE.md).
      const von = `${pathname}${search}${hash}`;
      void logout().finally(() => navigate('/login', { replace: true, state: { von } }));
    };
    window.addEventListener(SITZUNG_ABGELAUFEN, beiAblauf);
    return () => window.removeEventListener(SITZUNG_ABGELAUFEN, beiAblauf);
  }, [logout, navigate, pathname, search, hash]);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `mise exec pnpm@11.10.0 -- pnpm -C /Users/rubeen/dev/personal/lifeline-hub/.claude/worktrees/lfh-268-zentrales-fehler-handling/frontend test --run src/auth/useSitzungsWache.test.tsx`
Expected: PASS (3 Tests)

- [ ] **Step 5: In App.tsx aufrufen**

In `frontend/src/App.tsx` den Import ergänzen und den Hook als erste Zeile des
Komponenten-Rumpfs von `App` aufrufen:

```tsx
import { useSitzungsWache } from './auth/useSitzungsWache';

// im Rumpf von `export default function App()` als erste Anweisung:
  useSitzungsWache();
```

- [ ] **Step 6: App-Tests und Typecheck**

Run: `mise exec pnpm@11.10.0 -- pnpm -C /Users/rubeen/dev/personal/lifeline-hub/.claude/worktrees/lfh-268-zentrales-fehler-handling/frontend test --run src/App.test.tsx`
Expected: PASS

Run: `mise exec pnpm@11.10.0 -- pnpm -C /Users/rubeen/dev/personal/lifeline-hub/.claude/worktrees/lfh-268-zentrales-fehler-handling/frontend exec tsc --noEmit`
Expected: keine Ausgabe

- [ ] **Step 7: Commit**

```bash
git add frontend/src/auth/useSitzungsWache.ts frontend/src/auth/useSitzungsWache.test.tsx frontend/src/App.tsx
git commit -m "feat(lfh-268): Sitzungswache auf App-Ebene mit vollständiger Rückkehr-URL (F24)"
```

---

### Task 5: Sperre beim Re-Login lösen

Ohne diesen Schritt meldet ein **zweiter** Sitzungsablauf in derselben Browser-Sitzung nichts
mehr — die Sperre aus Task 1 bliebe für immer gesetzt.

**Files:**
- Modify: `frontend/src/auth/AuthContext.tsx:63,76`
- Test: `frontend/src/auth/AuthContext.test.tsx` (bestehende Datei erweitern)

**Interfaces:**
- Consumes: `sitzungsMeldungZuruecksetzen` (Task 1)
- Produces: nichts Neues

- [ ] **Step 1: Write the failing test**

An `frontend/src/auth/AuthContext.test.tsx` anhängen (Importe oben ergänzen: `SITZUNG_ABGELAUFEN`,
`meldeSitzungAbgelaufen`, `sitzungsMeldungZuruecksetzen` aus `./sitzungsEvent`):

```tsx
it('löst die Sitzungs-Meldesperre nach erfolgreichem Login', async () => {
  sitzungsMeldungZuruecksetzen();
  server.use(
    http.post('/api/auth/login', () =>
      HttpResponse.json({ id: 1, benutzername: 'leiter', system_rolle: 'benutzer' }),
    ),
  );
  meldeSitzungAbgelaufen(); // Sperre setzen — wie nach einem echten Ablauf

  const { result } = renderHook(() => useAuth(), { wrapper: AuthWrapper });
  await waitFor(() => expect(result.current.laedt).toBe(false));
  await act(async () => {
    await result.current.login('leiter', 'geheim');
  });

  const horcher = vi.fn();
  window.addEventListener(SITZUNG_ABGELAUFEN, horcher);
  meldeSitzungAbgelaufen();
  window.removeEventListener(SITZUNG_ABGELAUFEN, horcher);
  expect(horcher).toHaveBeenCalledTimes(1);
});
```

Hinweis für den Umsetzenden: `AuthWrapper`, `renderHook`, `server`/`http`/`HttpResponse` und
`act` gibt es in dieser Testdatei bereits — die vorhandenen Hilfsnamen übernehmen statt neue
einzuführen. Weicht ein Name ab, den bestehenden verwenden.

- [ ] **Step 2: Run test to verify it fails**

Run: `mise exec pnpm@11.10.0 -- pnpm -C /Users/rubeen/dev/personal/lifeline-hub/.claude/worktrees/lfh-268-zentrales-fehler-handling/frontend test --run src/auth/AuthContext.test.tsx`
Expected: FAIL — `expected "spy" to be called 1 times, but got 0 times` (Sperre wird nie gelöst)

- [ ] **Step 3: Write minimal implementation**

In `frontend/src/auth/AuthContext.tsx` den Import ergänzen und in beiden Erfolgspfaden die
Sperre lösen:

```tsx
import { sitzungsMeldungZuruecksetzen } from './sitzungsEvent';

// in `login`, direkt nach `setBenutzer(antwort);` (heute Zeile 63):
      // Neue gültige Sitzung → die Melde-Sperre aus `meldeSitzungAbgelaufen` lösen, damit ein
      // SPÄTERER Ablauf in derselben Browser-Sitzung wieder gemeldet wird (LFH-268).
      sitzungsMeldungZuruecksetzen();

// in `aktualisiere`, direkt nach `setBenutzer(b);` (heute Zeile 76):
      sitzungsMeldungZuruecksetzen();
```

- [ ] **Step 4: Run test to verify it passes**

Run: `mise exec pnpm@11.10.0 -- pnpm -C /Users/rubeen/dev/personal/lifeline-hub/.claude/worktrees/lfh-268-zentrales-fehler-handling/frontend test --run src/auth/AuthContext.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/src/auth/AuthContext.tsx frontend/src/auth/AuthContext.test.tsx
git commit -m "feat(lfh-268): Melde-Sperre nach erfolgreichem Login lösen (F24)"
```

---

### Task 6: SSE-401-Brücke auf den gemeinsamen Kanal konsolidieren

Heute gibt es zwei Mechanismen für dieselbe Sache: `lfh:live-auth-verloren` (SSE →
`EinsatzLayout`) und ab Task 4 `lfh:sitzung-abgelaufen` (HTTP → `App`). Zwei Kanäle bedeuten
zwei `logout()`/`navigate()`-Wege, die bei gleichzeitigem SSE- und Query-401 gegeneinander
laufen. Der SSE-Pfad verliert zudem die Rückkehr-URL (`navigate('/login')` ohne `state`).

**Files:**
- Modify: `frontend/src/live/useEinsatzLiveStream.ts:131-134`
- Modify: `frontend/src/einsatz/EinsatzLayout.tsx:28,37-47` (Effekt entfernen, `logout` aus der Destrukturierung)
- Modify: `frontend/src/live/useEinsatzLiveStream.test.tsx` (Event-Name in der bestehenden Assertion)

**Interfaces:**
- Consumes: `meldeSitzungAbgelaufen`, `SITZUNG_ABGELAUFEN` (Task 1)
- Produces: `lfh:live-auth-verloren` existiert danach **nicht mehr**

- [ ] **Step 1: Bestehenden SSE-Test auf den neuen Kanal umstellen**

In `frontend/src/live/useEinsatzLiveStream.test.tsx` die Assertion auf
`'lfh:live-auth-verloren'` suchen und auf den gemeinsamen Kanal umstellen:

```tsx
import { SITZUNG_ABGELAUFEN, sitzungsMeldungZuruecksetzen } from '../auth/sitzungsEvent';

// im passenden afterEach der Datei ergänzen (sonst blockiert die Sperre den zweiten Testlauf):
  sitzungsMeldungZuruecksetzen();

// die bestehende addEventListener/dispatch-Assertion auf 'lfh:live-auth-verloren'
// durch SITZUNG_ABGELAUFEN ersetzen — Testaufbau ansonsten unverändert lassen.
```

- [ ] **Step 2: Run test to verify it fails**

Run: `mise exec pnpm@11.10.0 -- pnpm -C /Users/rubeen/dev/personal/lifeline-hub/.claude/worktrees/lfh-268-zentrales-fehler-handling/frontend test --run src/live/useEinsatzLiveStream.test.tsx`
Expected: FAIL — der Horcher auf `lfh:sitzung-abgelaufen` wird nicht gerufen (der Hook feuert
noch `lfh:live-auth-verloren`)

- [ ] **Step 3: Hook auf den gemeinsamen Kanal umstellen**

In `frontend/src/live/useEinsatzLiveStream.ts` den Import ergänzen und Zeilen 131-134 ersetzen:

```ts
import { meldeSitzungAbgelaufen } from '../auth/sitzungsEvent';

      if (!sessionGueltig) {
        // Session abgelaufen → der Browser reconnectet nicht selbst; die Sitzungswache auf
        // App-Ebene übernimmt (LFH-268: EIN 401-Pfad für SSE und HTTP, mit Rückkehr-URL).
        meldeSitzungAbgelaufen();
        return;
      }
```

- [ ] **Step 4: Lokale Brücke aus EinsatzLayout entfernen**

In `frontend/src/einsatz/EinsatzLayout.tsx` den kompletten Kommentarblock und Effekt der
Zeilen 37-47 löschen und Zeile 28 anpassen — `logout` wird dort danach nicht mehr gebraucht
(`navigate` bleibt, es wird in Zeile 80 weiter verwendet):

```tsx
  const { benutzer } = useAuth();
```

Den nun ungenutzten `useEffect`-Import NICHT entfernen — er wird in der Datei weiter verwendet
(Zeile 59).

- [ ] **Step 5: Tests und Lint**

Run: `mise exec pnpm@11.10.0 -- pnpm -C /Users/rubeen/dev/personal/lifeline-hub/.claude/worktrees/lfh-268-zentrales-fehler-handling/frontend test --run src/live/useEinsatzLiveStream.test.tsx src/einsatz`
Expected: PASS

Run: `mise exec pnpm@11.10.0 -- pnpm -C /Users/rubeen/dev/personal/lifeline-hub/.claude/worktrees/lfh-268-zentrales-fehler-handling/frontend lint`
Expected: keine Fehler, keine Warnungen (`--max-warnings 0`)

Gegenprobe, dass der alte Kanal restlos weg ist:

Run: `grep -rn "lfh:live-auth-verloren" /Users/rubeen/dev/personal/lifeline-hub/.claude/worktrees/lfh-268-zentrales-fehler-handling/frontend/src`
Expected: keine Treffer

- [ ] **Step 6: Commit**

```bash
git add frontend/src/live/useEinsatzLiveStream.ts frontend/src/live/useEinsatzLiveStream.test.tsx frontend/src/einsatz/EinsatzLayout.tsx
git commit -m "refactor(lfh-268): SSE-401-Brücke auf die zentrale Sitzungswache konsolidieren (F24)"
```

---

### Task 7: Totes Re-Login-Signal in der Offline-ETB-Queue beheben

Der beim Scope gefundene Bug. `useEtbErfassung` setzt bei 401 `setReLoginNoetig(true)` und gibt
das Flag zurück — aber der einzige Aufrufer `EtbPage.tsx:61` destrukturiert es nicht, und es gibt
keinen weiteren Konsumenten. Gleichzeitig gilt 401 als transient, wird also mit 30s-Backoff
endlos wiederholt. Im Feld: abgelaufene Session bei der ETB-Erfassung, der Nutzer sieht nichts,
die Einträge gehen nie raus. Für ein beweissicherndes Tagebuch ist das der teure Fehlermodus.

**Files:**
- Modify: `frontend/src/offline/useEtbErfassung.ts:41,73,166,186`
- Modify: `frontend/src/offline/useEtbErfassung.test.tsx:134`

**Interfaces:**
- Consumes: `meldeSitzungAbgelaufen`, `SITZUNG_ABGELAUFEN` (Task 1)
- Produces: Rückgabeobjekt von `useEtbErfassung` **ohne** `reLoginNoetig`

- [ ] **Step 1: Bestehenden Test auf das Event umstellen**

In `frontend/src/offline/useEtbErfassung.test.tsx` die Assertion in Zeile 134
(`await waitFor(() => expect(result.current.reLoginNoetig).toBe(true));`) ersetzen. Der
umgebende Testaufbau (401-Mock, `renderHook`) bleibt unverändert:

```tsx
import { SITZUNG_ABGELAUFEN, sitzungsMeldungZuruecksetzen } from '../auth/sitzungsEvent';

// im afterEach der Datei ergänzen:
  sitzungsMeldungZuruecksetzen();

// vor dem auslösenden Aufruf im 401-Test:
  const horcher = vi.fn();
  window.addEventListener(SITZUNG_ABGELAUFEN, horcher);

// statt der reLoginNoetig-Assertion:
  await waitFor(() => expect(horcher).toHaveBeenCalledTimes(1));
  window.removeEventListener(SITZUNG_ABGELAUFEN, horcher);
```

Zusätzlich im selben Test sicherstellen, dass die Queue erhalten bleibt (der Eintrag darf nicht
als fachlich abgelehnt weggeräumt werden) — falls die Datei das noch nicht prüft:

```tsx
  await waitFor(() => expect(result.current.ausstehend).toHaveLength(1));
  expect(result.current.abgelehnt).toHaveLength(0);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `mise exec pnpm@11.10.0 -- pnpm -C /Users/rubeen/dev/personal/lifeline-hub/.claude/worktrees/lfh-268-zentrales-fehler-handling/frontend test --run src/offline/useEtbErfassung.test.tsx`
Expected: FAIL — der Horcher wird nie gerufen (der Hook setzt nur den toten State)

- [ ] **Step 3: Hook auf das Event umstellen**

In `frontend/src/offline/useEtbErfassung.ts`:

Import ergänzen:
```ts
import { meldeSitzungAbgelaufen } from '../auth/sitzungsEvent';
```

Zeile 41 (`const [reLoginNoetig, setReLoginNoetig] = useState(false);`) **ersatzlos löschen**.

Zeile 73 im `flush`-Pfad ersetzen:
```ts
            // 401: Session abgelaufen → zentrale Sitzungswache (LFH-268) übernimmt den
            // Re-Login. Die Queue wird NICHT geleert: die Einträge sind beweissicherndes
            // Tagebuch und gehen nach dem Anmelden raus.
            if (e instanceof ApiError && e.status === 401) meldeSitzungAbgelaufen();
```

Zeile 166 im `erfassen`-Pfad ersetzen:
```ts
          if (e instanceof ApiError && e.status === 401) meldeSitzungAbgelaufen();
```

Zeile 186 (Rückgabe) — `reLoginNoetig` streichen:
```ts
  return { erfassen, ausstehend, flush, abgelehnt, abgelehntVerwerfen };
```

`useState` bleibt importiert (wird für `ausstehend`/`abgelehnt` weiter gebraucht).

- [ ] **Step 4: Run test to verify it passes**

Run: `mise exec pnpm@11.10.0 -- pnpm -C /Users/rubeen/dev/personal/lifeline-hub/.claude/worktrees/lfh-268-zentrales-fehler-handling/frontend test --run src/offline/useEtbErfassung.test.tsx src/pages/EtbPage.test.tsx`
Expected: PASS

Gegenprobe, dass das tote Signal restlos weg ist:

Run: `grep -rn "reLoginNoetig" /Users/rubeen/dev/personal/lifeline-hub/.claude/worktrees/lfh-268-zentrales-fehler-handling/frontend/src`
Expected: keine Treffer

- [ ] **Step 5: Commit**

```bash
git add frontend/src/offline/useEtbErfassung.ts frontend/src/offline/useEtbErfassung.test.tsx
git commit -m "fix(lfh-268): totes Re-Login-Signal der ETB-Queue an die Sitzungswache hängen (F24)"
```

---

### Task 8: Rückkehr-URL in RequireAuth vervollständigen

`RequireAuth` trägt heute nur `location.pathname`. Query-String und Hash gehen verloren — und
genau darauf beruht das Deeplink-Muster des Projekts (`?einheit=`, `?fahrzeug=`, `?meldung=`,
ETB `?eintrag=`, s. CLAUDE.md). Nach dem Re-Login landet man auf der Liste statt beim Objekt.

**Files:**
- Modify: `frontend/src/routes/RequireAuth.tsx:8,18`
- Create: `frontend/src/routes/RequireAuth.test.tsx`

**Interfaces:**
- Consumes: nichts Neues
- Produces: nichts Neues

- [ ] **Step 1: Write the failing test**

```tsx
// frontend/src/routes/RequireAuth.test.tsx
import { describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import RequireAuth from './RequireAuth';

vi.mock('../auth/AuthContext', async (echt) => ({
  ...(await echt<typeof import('../auth/AuthContext')>()),
  useAuth: () => ({
    benutzer: null,
    laedt: false,
    login: vi.fn(),
    logout: vi.fn(),
    aktualisiere: vi.fn(),
  }),
}));

function LoginSonde() {
  const von = (useLocation().state as { von?: string } | null)?.von ?? '';
  return <div data-testid="von">{von}</div>;
}

describe('RequireAuth', () => {
  it('merkt sich Pfad, Query-String und Hash als Rückkehr-URL', () => {
    const { getByTestId } = render(
      <MemoryRouter initialEntries={['/einsaetze/7/etb?eintrag=42#unten']}>
        <Routes>
          <Route path="/login" element={<LoginSonde />} />
          <Route element={<RequireAuth />}>
            <Route path="/einsaetze/:id/etb" element={<div>ETB</div>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );
    expect(getByTestId('von').textContent).toBe('/einsaetze/7/etb?eintrag=42#unten');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `mise exec pnpm@11.10.0 -- pnpm -C /Users/rubeen/dev/personal/lifeline-hub/.claude/worktrees/lfh-268-zentrales-fehler-handling/frontend test --run src/routes/RequireAuth.test.tsx`
Expected: FAIL — `expected '/einsaetze/7/etb' to be '/einsaetze/7/etb?eintrag=42#unten'`

- [ ] **Step 3: Write minimal implementation**

In `frontend/src/routes/RequireAuth.tsx` Zeile 18 ersetzen:

```tsx
  if (!benutzer) {
    // Vollständige URL: `pathname` allein verliert die Deeplink-Selektion des
    // Query-Param-Musters (`?einheit=`, `?meldung=`, ETB `?eintrag=` — s. CLAUDE.md).
    const von = `${location.pathname}${location.search}${location.hash}`;
    return <Navigate to="/login" replace state={{ von }} />;
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `mise exec pnpm@11.10.0 -- pnpm -C /Users/rubeen/dev/personal/lifeline-hub/.claude/worktrees/lfh-268-zentrales-fehler-handling/frontend test --run src/routes/RequireAuth.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/src/routes/RequireAuth.tsx frontend/src/routes/RequireAuth.test.tsx
git commit -m "fix(lfh-268): Rückkehr-URL trägt Query-String und Hash (F24)"
```

---

### Task 9: Gesamtabnahme

**Files:** keine Änderungen — reine Verifikation.

- [ ] **Step 1: Volle Frontend-Gates**

Run: `mise exec pnpm@11.10.0 -- pnpm -C /Users/rubeen/dev/personal/lifeline-hub/.claude/worktrees/lfh-268-zentrales-fehler-handling/frontend lint`
Expected: Exit 0, keine Warnungen

Run: `mise exec pnpm@11.10.0 -- pnpm -C /Users/rubeen/dev/personal/lifeline-hub/.claude/worktrees/lfh-268-zentrales-fehler-handling/frontend exec tsc --noEmit`
Expected: keine Ausgabe

Run: `mise exec pnpm@11.10.0 -- pnpm -C /Users/rubeen/dev/personal/lifeline-hub/.claude/worktrees/lfh-268-zentrales-fehler-handling/frontend test --run --no-file-parallelism`
Expected: PASS — mindestens 1441 bestandene Tests (Baseline) plus die neuen; 0 Fehlschläge

- [ ] **Step 2: Sammel-Gate**

Run: `cd /Users/rubeen/dev/personal/lifeline-hub/.claude/worktrees/lfh-268-zentrales-fehler-handling && ./scripts/check-all.sh`
Expected: Exit 0. **Kein `| tail`** — das maskiert den Exit-Code (CLAUDE.md).

- [ ] **Step 3: Manuelle Gegenprobe der Kernaussage**

Run: `grep -rn "queryCache\|mutationCache" /Users/rubeen/dev/personal/lifeline-hub/.claude/worktrees/lfh-268-zentrales-fehler-handling/frontend/src --include=*.ts --include=*.tsx`
Expected: genau die Treffer in `api/queryClient.ts` — der Seam existiert an genau einer Stelle.
