# Ort-Anzeige an allen Koordinaten + Langzeit-Cache — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]`.

**Goal:** Ort-Zeile (Peilung + Ortsname) an ALLEN Koordinaten-Eingaben und -Anzeigen über eine geteilte Komponente; Ortsnamen sehr lange cachen (Client: persistentes IndexedDB; Server: permanent + 90-Tage-Stale-while-revalidate); Peilung bleibt live.

**Architecture:** Frontend extrahiert die Ort-Zeile in `OrtZeile`, fügt eine Output-Komponente `KoordinatenAnzeige` und einen persistenten `ortCache` (idb) hinzu; `useOrtVorschau` trennt die Lebensdauern (Peilung live, Ortsname persistent + Fallback). Backend ergänzt eine lange SWR-Auffrischung im `geocoding`-Dienst. Danach werden alle Call-Sites verdrahtet.

**Tech Stack:** React/TS (antd, @tanstack/react-query v5, idb, vitest + fake-indexeddb), Rust (axum, sqlx-sqlite, tokio, reqwest).

## Global Constraints

- Nur der **Ortsname** wird lang gecacht (unveränderlich); die **Peilung** bleibt live (Marker bewegen sich). `useOrtVorschau.staleTime` ist kurz (30_000), NICHT Infinity.
- Gerundeter Schlüssel = 3 Nachkommastellen (~100 m), einheitlich über `ortCache`-Key, React-Query-Key und Server-`schluessel`.
- Cache-/idb-Fehler sind nie fatal: Lesen → null/Miss, Schreiben → no-op (geloggt). Eine Geocodierung darf nie an einem Cache-Schreibfehler scheitern.
- Server-Geocoder nie blockierend: SWR-Refresh läuft im Hintergrund (`tokio::spawn`), rate-limitiert (Token-Bucket ≤1/s), inflight-dedupliziert. Cache-Wert wird immer SOFORT ausgeliefert.
- Additiv & leer-degradierend; `KoordinatenAnzeige` ohne `einsatzId` zeigt nur die Koordinate (kein Hook → kein QueryClient-Zwang). Bestehende `KoordinatenEingabe`-Tests (bare render) bleiben grün.
- Deutsche Bezeichner/Kommentare/Testnamen. Gates: `cargo test`, `pnpm exec tsc --noEmit`, `pnpm exec vitest run --no-file-parallelism`.

---

### Task 1: Persistenter Ortsnamen-Store (`ortCache`, idb)

**Files:**
- Create: `frontend/src/anzeige/ortCache.ts`
- Test: `frontend/src/anzeige/ortCache.test.ts`

**Interfaces — Produces:**
- `export function ortKeyVon(lat: number, lon: number): string`
- `export async function holeOrt(key: string): Promise<string | null>`
- `export async function setzeOrt(key: string, name: string): Promise<void>`

- [ ] **Step 1: Failing test**

`frontend/src/anzeige/ortCache.test.ts` (fake-indexeddb ist bereits global via `src/test/setup.ts`):

```ts
import { describe, it, expect } from 'vitest';
import { ortKeyVon, holeOrt, setzeOrt } from './ortCache';

describe('ortCache', () => {
  it('rundet den Key auf 3 Nachkommastellen (~100 m)', () => {
    expect(ortKeyVon(51.16040, 10.45140)).toBe('51.160,10.451');
    expect(ortKeyVon(51.16042, 10.45138)).toBe(ortKeyVon(51.16040, 10.45140));
  });

  it('set→get-Roundtrip; Miss → null', async () => {
    const key = ortKeyVon(51.1604, 10.4514);
    expect(await holeOrt(key)).toBeNull();
    await setzeOrt(key, 'Hauptstr. 5, Musterstadt');
    expect(await holeOrt(key)).toBe('Hauptstr. 5, Musterstadt');
  });

  it('überschreibt vorhandenen Wert', async () => {
    const key = ortKeyVon(48.0, 11.0);
    await setzeOrt(key, 'Alt');
    await setzeOrt(key, 'Neu');
    expect(await holeOrt(key)).toBe('Neu');
  });
});
```

- [ ] **Step 2: Run → FAIL** (`cd frontend && pnpm exec vitest run src/anzeige/ortCache.test.ts`) — Modul fehlt.

- [ ] **Step 3: Implementierung**

`frontend/src/anzeige/ortCache.ts`:

```ts
/**
 * Persistenter, quasi-permanenter Local-Cache für Reverse-Geocoding-Ergebnisse
 * (Koordinate → Ortsname) in IndexedDB. Schlüssel auf ~100 m gerundet, identisch zur
 * serverseitigen Rundung. Ortsnamen sind faktisch unveränderlich → kein Eviction.
 * Fehler sind nie fatal: Lesen → null, Schreiben → no-op (geloggt).
 */
import { openDB, type IDBPDatabase } from 'idb';

const DB_NAME = 'lifeline-ortcache';
const STORE = 'ortsnamen';
let dbPromise: Promise<IDBPDatabase> | null = null;

function db(): Promise<IDBPDatabase> {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, 1, {
      upgrade(d) {
        if (!d.objectStoreNames.contains(STORE)) d.createObjectStore(STORE);
      },
    });
  }
  return dbPromise;
}

/** Gerundeter Cache-Schlüssel (3 Nachkommastellen, ~100 m). */
export function ortKeyVon(lat: number, lon: number): string {
  const r = (n: number) => (Math.round(n * 1000) / 1000).toFixed(3);
  return `${r(lat)},${r(lon)}`;
}

export async function holeOrt(key: string): Promise<string | null> {
  try {
    return (await (await db()).get(STORE, key)) ?? null;
  } catch (e) {
    console.warn('ortCache: Lesefehler', e);
    return null;
  }
}

export async function setzeOrt(key: string, name: string): Promise<void> {
  try {
    await (await db()).put(STORE, name, key);
  } catch (e) {
    console.warn('ortCache: Schreibfehler', e);
  }
}
```

- [ ] **Step 4: Run → PASS.**
- [ ] **Step 5: Commit** `feat(koordinaten): persistenter idb-Ortsnamen-Store (ortCache)`

---

### Task 2: Ort-Zeile extrahieren (`OrtZeile`)

**Files:**
- Create: `frontend/src/anzeige/OrtZeile.tsx`
- Modify: `frontend/src/anzeige/KoordinatenEingabe.tsx` (nutzt die extrahierte Komponente)

**Interfaces:**
- Consumes: `useOrtVorschau` (Task 0/bestehend), `useAnzeigeKonventionen`.
- Produces: `export function OrtZeile({ einsatzId, koord, exclude, debounceMs }: { einsatzId: number; koord: LatLon; exclude?: string; debounceMs?: number })`

- [ ] **Step 1:** Lies `frontend/src/anzeige/KoordinatenEingabe.tsx`. Die heutige innere Komponente `OrtVorschauZeile` (rendert `«ortsname» · «distanz» «richtung» von «bezug»`, Lade-/Leer-Zustand) wird 1:1 nach `frontend/src/anzeige/OrtZeile.tsx` als **exportierte** Komponente `OrtZeile` verschoben. Ergänze einen optionalen `debounceMs?`-Prop, der an `useOrtVorschau(einsatzId, koord, exclude, debounceMs)` durchgereicht wird. Verhalten sonst identisch.

`frontend/src/anzeige/OrtZeile.tsx`:

```tsx
import { Typography } from 'antd';
import type { LatLon } from './koordinaten';
import { useAnzeigeKonventionen } from './AnzeigeKonventionenContext';
import { useOrtVorschau } from './useOrtVorschau';

/** Sekundäre Ort-Zeile: «ortsname» · «distanz» «richtung» von «bezug». Additiv, degradiert leer.
 *  Nur rendern, wo eine einsatzId vorhanden ist (Hook → QueryClient nötig). */
export function OrtZeile({
  einsatzId,
  koord,
  exclude,
  debounceMs,
}: {
  einsatzId: number;
  koord: LatLon;
  exclude?: string;
  debounceMs?: number;
}) {
  const { formatDistanz } = useAnzeigeKonventionen();
  const { data, isFetching } = useOrtVorschau(einsatzId, koord, exclude, debounceMs);

  if (!data) {
    return isFetching ? (
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        Ort wird ermittelt …
      </Typography.Text>
    ) : null;
  }

  const teile: string[] = [];
  if (data.ortsname) teile.push(data.ortsname);
  if (data.peilung) {
    teile.push(`${formatDistanz(data.peilung.distanz_m)} ${data.peilung.richtung} von ${data.peilung.bezug_label}`);
  }
  if (teile.length === 0) return null;

  return (
    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
      {teile.join(' · ')}
    </Typography.Text>
  );
}
```

- [ ] **Step 2:** In `KoordinatenEingabe.tsx`: die innere `OrtVorschauZeile`-Funktion entfernen, stattdessen `import { OrtZeile } from './OrtZeile';` und im JSX `<OrtZeile einsatzId={einsatzId} koord={value} exclude={exclude} />` rendern (gleiche Render-Bedingung `{!fehler && value && einsatzId != null && (...)}`). Nicht mehr benötigte Imports (`useOrtVorschau` in KoordinatenEingabe, falls nur dort genutzt) bereinigen.

- [ ] **Step 3:** Run `cd frontend && pnpm exec vitest run src/anzeige/KoordinatenEingabe.test.tsx && pnpm exec tsc --noEmit` → bestehende 12 Tests bleiben grün (verhaltensneutrale Extraktion), tsc clean.
- [ ] **Step 4: Commit** `refactor(koordinaten): OrtZeile aus KoordinatenEingabe extrahieren`

---

### Task 3: `useOrtVorschau` — Lebensdauer-Trennung + Persistenz

**Files:**
- Modify: `frontend/src/anzeige/useOrtVorschau.ts`
- Test: `frontend/src/anzeige/useOrtVorschau.test.tsx` (ergänzen)

**Interfaces:** Signatur unverändert; `staleTime` kurz; queryFn persistiert/fällt zurück.

- [ ] **Step 1: Failing tests ergänzen** in `useOrtVorschau.test.tsx`:

```tsx
import { holeOrt, ortKeyVon } from './ortCache';

it('persistiert den Ortsnamen im Local-Store bei Erfolg', async () => {
  server.use(
    http.get('/api/einsaetze/1/ort-vorschau', () =>
      HttpResponse.json({ peilung: null, ortsname: 'Hauptstr. 5, Musterstadt' }),
    ),
  );
  const { result } = renderHook(
    () => useOrtVorschau(1, { lat: 51.5, lon: 10.25 }, undefined, 0),
    { wrapper: wrapper() },
  );
  await waitFor(() => expect(result.current.data?.ortsname).toBe('Hauptstr. 5, Musterstadt'));
  await waitFor(async () =>
    expect(await holeOrt(ortKeyVon(51.5, 10.25))).toBe('Hauptstr. 5, Musterstadt'),
  );
});

it('fällt auf den persistierten Ortsnamen zurück, wenn die Live-Antwort ortsname=null hat', async () => {
  await import('./ortCache').then((m) => m.setzeOrt(ortKeyVon(48.1, 11.6), 'Aus Local-Store'));
  server.use(
    http.get('/api/einsaetze/1/ort-vorschau', () =>
      HttpResponse.json({ peilung: { distanz_m: 100, richtung: 'N', bezug_label: 'X' }, ortsname: null }),
    ),
  );
  const { result } = renderHook(
    () => useOrtVorschau(1, { lat: 48.1, lon: 11.6 }, undefined, 0),
    { wrapper: wrapper() },
  );
  await waitFor(() => expect(result.current.data?.ortsname).toBe('Aus Local-Store'));
  expect(result.current.data?.peilung?.richtung).toBe('N');
});
```

- [ ] **Step 2: Run → FAIL** (Fallback/Persistenz noch nicht da).

- [ ] **Step 3: Implementierung** — `useOrtVorschau.ts`: `staleTime` auf `30_000`; queryFn merged:

```ts
import { ortKeyVon, holeOrt, setzeOrt } from './ortCache';
// ...
  return useQuery<OrtVorschau>({
    queryKey: [
      'ort-vorschau', einsatzId,
      debounced ? runde(debounced.lat) : null,
      debounced ? runde(debounced.lon) : null,
      exclude ?? null,
    ],
    queryFn: async () => {
      const key = ortKeyVon(debounced!.lat, debounced!.lon);
      try {
        const live = await ladeOrtVorschau(einsatzId, debounced!.lat, debounced!.lon, exclude);
        if (live.ortsname) {
          await setzeOrt(key, live.ortsname); // Ortsname (unveränderlich) lang persistieren
          return live;
        }
        // Live ohne Ortsname (offline/Rate-Limit) → persistierten Ort als Fallback zeigen
        return { peilung: live.peilung, ortsname: await holeOrt(key) };
      } catch (e) {
        // Server nicht erreichbar → Peilung fehlt, aber persistierter Ort kann existieren
        const persisted = await holeOrt(key);
        if (persisted) return { peilung: null, ortsname: persisted };
        throw e;
      }
    },
    enabled: Number.isFinite(einsatzId) && debounced != null,
    // Peilung bleibt live (Marker ändern sich) — KEIN Infinity. Der Ortsname ist über den
    // persistenten Local-Store ohnehin dauerhaft.
    staleTime: 30_000,
  });
```

- [ ] **Step 4: Run → PASS** (`cd frontend && pnpm exec vitest run src/anzeige/useOrtVorschau.test.tsx`). Die bestehenden Debounce-Tests bleiben grün.
- [ ] **Step 5: Commit** `feat(koordinaten): useOrtVorschau persistiert Ortsname + Peilung bleibt live`

---

### Task 4: Output-Komponente `KoordinatenAnzeige`

**Files:**
- Create: `frontend/src/anzeige/KoordinatenAnzeige.tsx`
- Test: `frontend/src/anzeige/KoordinatenAnzeige.test.tsx`

**Interfaces — Produces:**
- `export default function KoordinatenAnzeige({ lat, lon, einsatzId, exclude }: { lat: number; lon: number; einsatzId?: number; exclude?: string })`

- [ ] **Step 1: Failing tests** `KoordinatenAnzeige.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '../test/server';
import { render } from '@testing-library/react';
import { renderMitProviders } from '../test/utils';
import KoordinatenAnzeige from './KoordinatenAnzeige';

describe('KoordinatenAnzeige', () => {
  it('zeigt ohne einsatzId nur die Koordinate (kein Provider nötig)', () => {
    render(<KoordinatenAnzeige lat={51.5} lon={10.25} />);
    expect(screen.getByText('51.50000, 10.25000')).toBeInTheDocument();
    expect(screen.queryByText(/von|·|ermittelt/)).not.toBeInTheDocument();
  });

  it('zeigt mit einsatzId Koordinate + Ort-Zeile', async () => {
    server.use(
      http.get('/api/einsaetze/1/ort-vorschau', () =>
        HttpResponse.json({
          peilung: { distanz_m: 1200, richtung: 'NO', bezug_label: 'Einsatzort' },
          ortsname: 'Hauptstr. 5, Musterstadt',
        }),
      ),
    );
    renderMitProviders(<KoordinatenAnzeige lat={51.5} lon={10.25} einsatzId={1} />);
    expect(screen.getByText('51.50000, 10.25000')).toBeInTheDocument();
    expect(await screen.findByText(/Hauptstr\. 5, Musterstadt · 1[.,]20 km NO von Einsatzort/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implementierung** `KoordinatenAnzeige.tsx`:

```tsx
import { Space, Typography } from 'antd';
import { useAnzeigeKonventionen } from './AnzeigeKonventionenContext';
import { OrtZeile } from './OrtZeile';

/** Read-only-Anzeige einer Koordinate (formatbewusst) + additive Ort-Zeile (Peilung + Ortsname).
 *  Ohne `einsatzId` nur die Koordinate (kein Hook → kein QueryClient-Zwang). Für statische
 *  Werte feuert die Ort-Zeile sofort (debounceMs=0). */
export default function KoordinatenAnzeige({
  lat,
  lon,
  einsatzId,
  exclude,
}: {
  lat: number;
  lon: number;
  einsatzId?: number;
  exclude?: string;
}) {
  const { formatKoordinate } = useAnzeigeKonventionen();
  return (
    <Space direction="vertical" size={0}>
      <Typography.Text>{formatKoordinate(lat, lon)}</Typography.Text>
      {einsatzId != null && (
        <OrtZeile einsatzId={einsatzId} koord={{ lat, lon }} exclude={exclude} debounceMs={0} />
      )}
    </Space>
  );
}
```

- [ ] **Step 4: Run → PASS** + `pnpm exec tsc --noEmit`.
- [ ] **Step 5: Commit** `feat(koordinaten): KoordinatenAnzeige (Output-Komponente mit Ort-Zeile)`

---

### Task 5: Eingaben verdrahten (Sidebar + Lagerelevant-Modal)

**Files:**
- Modify: `frontend/src/pages/lagekarte/Sidebar.tsx` (KoordinatenEingabe um `einsatzId` + `exclude`)
- Modify: Parent von Sidebar (z. B. `frontend/src/pages/LagekartePage.tsx`) — `einsatzId` an Sidebar durchreichen
- Modify: `frontend/src/meldungen/LagerelevantModal.tsx` (KoordinatenEingabe um `einsatzId`)

- [ ] **Step 1: Sidebar.** Lies `Sidebar.tsx`. Ergänze `einsatzId: number` in `SidebarProps`. An `<KoordinatenEingabe value={koord} onChange={setKoord} />` (Zeile ~141) übergib `einsatzId={props.einsatzId}` und `exclude={ortVorschauExclude(props.platzierungZiel)}`, mit Mapping-Helper im File:

```tsx
/** Platzierungsziel → exclude-Tag (typ:id) für die Ort-Vorschau (Selbst-Ausschluss). */
function ortVorschauExclude(ziel: SidebarProps['platzierungZiel']): string | undefined {
  if (!ziel) return undefined;
  // Sidebar-Typen → Backend-Marker-Typ-Tags. 'fuehrung' = Personal-Führung → 'personal'.
  const map: Record<string, string> = {
    uhs: 'uhs', schaden: 'schaden', einheit: 'einheit',
    fahrzeug: 'fahrzeug', fuehrung: 'personal', einsatzort: 'einsatzort',
  };
  const typ = map[ziel.typ];
  return typ ? `${typ}:${ziel.id}` : undefined;
}
```

- [ ] **Step 2: Parent.** Finde, wer `<Sidebar .../>` rendert (`grep -rn "<Sidebar" frontend/src`). Dort ist `einsatzId` via `useParams`/Props vorhanden — reiche `einsatzId={einsatzId}` an Sidebar durch.

- [ ] **Step 3: Lagerelevant-Modal.** Lies `LagerelevantModal.tsx`. Stelle fest, woher `einsatzId` kommt (Props/`useParams`/Context — falls nicht vorhanden, als Prop ergänzen und vom Aufrufer durchreichen). An `<KoordinatenEingabe />` (Zeile ~63) `einsatzId={einsatzId}` übergeben (kein `exclude` — die Lagemeldung existiert noch nicht).

- [ ] **Step 4:** `cd frontend && pnpm exec tsc --noEmit` + die betroffenen Tests (`pnpm exec vitest run src/pages/lagekarte src/meldungen`) → grün. Falls ein Test die neue Pflicht-Prop `einsatzId` an Sidebar braucht, ergänzen.
- [ ] **Step 5: Commit** `feat(koordinaten): Ort-Vorschau in Lagekarte-Sidebar + Lagerelevant-Modal`

---

### Task 6: Ausgaben verdrahten (Detail + Inspector + Lagemeldungen-Liste)

**Files:**
- Modify: `frontend/src/pages/EinsatzdatenPage.tsx` (Detail-Koordinate → `KoordinatenAnzeige`)
- Modify: `frontend/src/pages/lagekarte/Inspector.tsx` (Marker-Koordinate → `KoordinatenAnzeige`)
- Modify: `frontend/src/pages/LagemeldungenPage.tsx` (Listen-Koordinate → `KoordinatenAnzeige`)

- [ ] **Step 1: EinsatzdatenPage-Detail.** Lies um Zeile 234 (Descriptions-Item „Koordinate", read-only, nutzt `formatKoordinate`). Ersetze die `formatKoordinate(...)`-Anzeige durch `<KoordinatenAnzeige lat={...} lon={...} einsatzId={einsatzId} exclude={`einsatzort:${einsatzId}`} />`. `einsatzId` ist via `useParams` (Zeile 48) vorhanden.

- [ ] **Step 2: Inspector.** Lies `Inspector.tsx` (Marker-Klick-Panel; `einsatzId` via Props Zeile 8). Um Zeile 79 zeigt es die Marker-Koordinate via `formatKoordinate`. Ersetze durch `<KoordinatenAnzeige lat={...} lon={...} einsatzId={einsatzId} exclude={inspectorExclude(marker)} />`. Bestimme das Marker-Typ-Tag aus dem Inspector-Marker (lies, welche `typ`-Werte der Marker trägt — z. B. `KarteMarker.typ`) und mappe auf die Backend-Tags (`einsatzort|uhs|schaden|einheit|fahrzeug|personal|lagemeldung`); `exclude = `${typ}:${markerId}``. Falls kein eindeutiges Mapping → `exclude` weglassen (akzeptabel).

- [ ] **Step 3: LagemeldungenPage-Liste.** Lies um Zeile 55 (List-Item-Meta, `formatKoordinate` je Meldung). Ersetze durch `<KoordinatenAnzeige lat={m.lat} lon={m.lon} einsatzId={einsatzId} exclude={`lagemeldung:${m.id}`} />` (`einsatzId` via `useParams` Zeile 10; Feldnamen an die tatsächliche Meldungs-Struktur anpassen).

- [ ] **Step 4:** `cd frontend && pnpm exec tsc --noEmit` + betroffene Tests (`pnpm exec vitest run src/pages/EinsatzdatenPage src/pages/lagekarte src/pages/LagemeldungenPage` bzw. existierende). Bestehende Anzeige-Tests anpassen, wo der reine `formatKoordinate`-Text jetzt in `KoordinatenAnzeige` steckt (die Koordinate steht weiterhin als Text da). MSW: die Tests dieser Seiten brauchen ggf. einen Handler für `GET /api/einsaetze/:id/ort-vorschau` (Default `{peilung:null,ortsname:null}`), sonst „unhandled request"-Fehler — ergänzen.
- [ ] **Step 5: Commit** `feat(koordinaten): Ort-Anzeige in EinsatzdatenPage-Detail, Inspector, Lagemeldungen-Liste`

---

### Task 7: Server — 90-Tage Stale-while-revalidate für Ortsnamen

**Files:**
- Modify: `src/geocoding/cache.rs` (`lese_mit_alter`)
- Modify: `src/geocoding/mod.rs` (Statics: `bucket`/`inflight` als `Arc<Mutex<…>>`; `reverse_mit` → SWR; `geocode_und_schreibe`)

**Interfaces:**
- `cache::lese_mit_alter(pool, lat_key, lon_key) -> Option<(String, i64)>` (Ortsname + Alter in Sekunden).
- `reverse`/`reverse_mit` behalten ihre öffentliche Bedeutung; intern SWR.

- [ ] **Step 1:** `cache.rs` — `lese_mit_alter` ergänzen:

```rust
/// Cache-Treffer samt Alter in Sekunden (für Stale-while-revalidate), sonst None.
pub async fn lese_mit_alter(pool: &SqlitePool, lat_key: i64, lon_key: i64) -> Option<(String, i64)> {
    sqlx::query_as::<_, (String, i64)>(
        "SELECT ortsname, unixepoch() - unixepoch(erstellt_at) \
         FROM geocoding_cache WHERE lat_key = ? AND lon_key = ?",
    )
    .bind(lat_key)
    .bind(lon_key)
    .fetch_optional(pool)
    .await
    .unwrap_or_else(|e| {
        tracing::warn!("Geocoding-Cache: Lesefehler (alter): {e}");
        None
    })
}
```

- [ ] **Step 2:** `mod.rs` — Statics auf `Arc<Mutex<…>>` umstellen, Inflight-Set ergänzen, SWR einbauen. `Statics { client, bucket: Arc<Mutex<TokenBucket>>, inflight: Arc<Mutex<HashSet<String>>> }`. Konstante `const CACHE_TTL_SEKUNDEN: i64 = 90 * 24 * 3600;`.

Faktorisiere den Fetch-Kern heraus (nimmt `&reqwest::Client`, `&Mutex<TokenBucket>`):

```rust
/// Rate-limitierter Geocode + Cache-Write (keine Cache-Lesung). None bei Limit/Offline/leer.
async fn geocode_und_schreibe(
    client: &reqwest::Client, bucket: &Mutex<TokenBucket>, pool: &SqlitePool,
    base_url: &str, lat: f64, lon: f64,
) -> Option<String> {
    { // Lock NICHT über das await halten (Send)
        let mut g = bucket.lock().unwrap_or_else(|e| e.into_inner());
        if !g.try_take() { return None; }
    }
    let (lat_key, lon_key) = cache::schluessel(lat, lon);
    let url = format!("{}/reverse?lat={lat}&lon={lon}&format=jsonv2&zoom=18&accept-language=de",
        base_url.trim_end_matches('/'));
    let name = match client.get(&url).send().await {
        Ok(r) if r.status().is_success() => match r.json::<serde_json::Value>().await {
            Ok(v) => v.get("display_name").and_then(|n| n.as_str()).map(String::from),
            Err(e) => { tracing::debug!("Geocoder-JSON-Parse: {e}"); None }
        },
        Ok(r) => { tracing::debug!("Geocoder HTTP {}", r.status()); None }
        Err(e) => { tracing::debug!("Geocoder-Fetch: {e}"); None }
    };
    if let Some(n) = &name { if !n.is_empty() { cache::schreibe(pool, lat_key, lon_key, n).await; } }
    name.filter(|n| !n.is_empty())
}
```

`reverse_mit` wird SWR-fähig (injizierbar, nimmt jetzt auch `inflight`):

```rust
pub async fn reverse_mit(
    client: &reqwest::Client, bucket: &Arc<Mutex<TokenBucket>>,
    inflight: &Arc<Mutex<HashSet<String>>>, pool: &SqlitePool,
    base_url: &str, lat: f64, lon: f64,
) -> Option<String> {
    let (lat_key, lon_key) = cache::schluessel(lat, lon);
    if let Some((name, alter)) = cache::lese_mit_alter(pool, lat_key, lon_key).await {
        if alter > CACHE_TTL_SEKUNDEN {
            // Stale → alten Wert SOFORT liefern, im Hintergrund auffrischen (1× pro Key).
            let key = format!("{lat_key}:{lon_key}");
            let claimed = inflight.lock().unwrap_or_else(|e| e.into_inner()).insert(key.clone());
            if claimed {
                let (client, bucket, inflight, pool, base) =
                    (client.clone(), bucket.clone(), inflight.clone(), pool.clone(), base_url.to_string());
                tokio::spawn(async move {
                    geocode_und_schreibe(&client, &bucket, &pool, &base, lat, lon).await;
                    inflight.lock().unwrap_or_else(|e| e.into_inner()).remove(&key);
                });
            }
        }
        return Some(name);
    }
    // Kalt → foreground holen.
    geocode_und_schreibe(client, bucket, pool, base_url, lat, lon).await
}
```

`reverse` (prod) reicht die `Arc`-Statics durch: `reverse_mit(&s.client, &s.bucket, &s.inflight, pool, base_url, lat, lon).await`. Statics-Init: `bucket: Arc::new(Mutex::new(TokenBucket::neu(1.0,1.0)))`, `inflight: Arc::new(Mutex::new(HashSet::new()))`. `use std::sync::Arc; use std::collections::HashSet;`.

- [ ] **Step 3:** Bestehende `geocoding::tests` an die neue Signatur anpassen (Bucket/Inflight als `Arc<Mutex<…>>`, `reverse_mit(..., &inflight, ...)`), und **SWR-Tests** ergänzen:

```rust
fn arc_bucket(drain: bool) -> Arc<Mutex<TokenBucket>> {
    let mut b = TokenBucket::neu(1.0, 1.0);
    if drain { b.try_take(); }
    Arc::new(Mutex::new(b))
}
fn arc_inflight() -> Arc<Mutex<HashSet<String>>> { Arc::new(Mutex::new(HashSet::new())) }

#[tokio::test]
async fn frischer_cache_kein_refresh() {
    let pool = crate::db::test_pool().await;
    let (la, lo) = cache::schluessel(51.0, 10.0);
    cache::schreibe(&pool, la, lo, "Frisch").await; // erstellt_at = jetzt
    let name = reverse_mit(&test_client(), &arc_bucket(false), &arc_inflight(),
        &pool, &geschlossener_port(), 51.0, 10.0).await;
    assert_eq!(name.as_deref(), Some("Frisch")); // sofort aus Cache, kein Block trotz toter URL
}

#[tokio::test]
async fn stale_liefert_alten_wert_und_stoesst_refresh_an() {
    let pool = crate::db::test_pool().await;
    let (la, lo) = cache::schluessel(52.0, 13.0);
    // Eintrag künstlich altern: erstellt_at weit in der Vergangenheit.
    sqlx::query("INSERT INTO geocoding_cache (lat_key, lon_key, ortsname, erstellt_at) \
                 VALUES (?, ?, 'Alt', datetime('now','-200 days'))")
        .bind(la).bind(lo).execute(&pool).await.unwrap();
    let (base, _h) = stub(serde_json::json!({ "display_name": "Neu" })).await;
    let inflight = arc_inflight();
    let name = reverse_mit(&test_client(), &arc_bucket(false), &inflight, &pool, &base, 52.0, 13.0).await;
    assert_eq!(name.as_deref(), Some("Alt")); // alter Wert SOFORT
    // Hintergrund-Refresh aktualisiert den Cache auf "Neu" (kurz pollen).
    let mut aktualisiert = false;
    for _ in 0..50 {
        if cache::lese(&pool, la, lo).await.as_deref() == Some("Neu") { aktualisiert = true; break; }
        tokio::time::sleep(std::time::Duration::from_millis(20)).await;
    }
    assert!(aktualisiert, "Hintergrund-Refresh hätte den Cache aktualisieren müssen");
}
```

(Behalte die bestehenden Erfolg/Cache-Hit/Offline/Rate-Limit-Tests, angepasst an die Arc-Signatur.)

- [ ] **Step 4:** `cargo test --lib geocoding` → grün; `cargo test --test ort_vorschau` → weiterhin grün (Route nutzt `reverse` unverändert).
- [ ] **Step 5: Commit** `feat(geocoding): 90-Tage Stale-while-revalidate für Ortsnamen (Server)`

---

## Abschluss-Gates
- [ ] `cargo test` (rtk proxy) → EXIT 0.
- [ ] `cd frontend && pnpm exec tsc --noEmit && pnpm exec vitest run --no-file-parallelism` → grün.

## Self-Review (gegen die Spec)
- Geteilte `OrtZeile` + `KoordinatenAnzeige` → Tasks 2/4. Persistenter Client-Cache → Task 1/3. Peilung-live/Ortsname-lang getrennt → Task 3. Server-SWR 90 Tage → Task 7. Alle Inputs (Sidebar, Modal) → Task 5. Alle Outputs (Detail, Inspector, Liste) → Task 6. Gerundeter Key einheitlich → Task 1 (`ortKeyVon`) ↔ Server `schluessel`. ✓
