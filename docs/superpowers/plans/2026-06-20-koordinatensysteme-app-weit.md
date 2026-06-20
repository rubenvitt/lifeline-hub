# Koordinatensysteme app-weit — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Das gewählte Koordinatenformat (WGS84-dezimal, DMS, UTM, MGRS, Gauß-Krüger) app-weit für Anzeige **und** Eingabe wirksam machen, mit flüchtigem session-stickyem Umschalter und Live-Umrechnung; WGS84 bleibt Persistenz.

**Architecture:** Ein einziger Konvertierungs-Seam (`anzeige/koordinaten.ts`) mit `formatiere`/`parse` (proj4 + mgrs für UTM/MGRS/GK, handgerollt für WGS84/DMS). Anzeige läuft über den bestehenden `formatKoordinate`-Pfad; Eingabe über ein neues Form-Control `KoordinatenEingabe`. Ein globaler, localStorage-gestützter Override (`useKoordinatenSystemOverride`) übersteuert die effektive Konvention session-weit für Anzeige und Eingabe gleichzeitig.

**Tech Stack:** React 18 + TypeScript, antd, vitest, React-Query; neu: `proj4` (2.20.9) + `mgrs` (2.1.0); Rust-Backend (sqlx-sqlite) nur für die Format-Whitelist.

## Global Constraints

- **Persistenz bleibt WGS84-Dezimalgrad** (`lat`/`lon` `REAL`/`Option<f64>`). Keine DB-Migration an Koordinaten-Spalten, keine Backend-Konvertierung.
- **proj4-Achsenreihenfolge ist `[lon, lat]`** (x zuerst) bzw. `[Rechtswert/Easting, Hochwert/Northing]` — beim Übergeben an/von `{lat, lon}` IMMER tauschen.
- **GK-Defs zwingend mit `+towgs84=598.1,73.7,418.2,0.202,0.045,-2.455,6.7`** (EPSG:1777), sonst stiller ~136-m-Fehler. EPSG:31466–31469 sind in proj4js NICHT eingebaut; einmalig auf Modul-Top-Level registrieren (nicht pro Render).
- **WGS84-dezimal-Anzeige byte-exakt** zur Bestandsausgabe: `` `${lat.toFixed(5)}, ${lon.toFixed(5)}` `` (LFH-136-Tests müssen grün bleiben).
- **proj4/mgrs werfen** bei ungültigem Input (kein `null`) → `parse` kapselt in try/catch.
- **GK-Genauigkeit ~3 m** (Helmert, kein NTv2-Grid) — im `koordinaten.ts`-Header dokumentieren.
- Frontend ist via rust-embed ins Binary eingebettet → manuelle Prüfung erst nach `pnpm build` + Backend-Neustart.
- Volle Vitest-Suite unter Last flaky → Gesamt-Gate mit `pnpm vitest run --no-file-parallelism`.
- Test-Befehle ggf. mit `rtk proxy` ausführen, falls Exit-Codes für ein Pass/Fail-Gate gebraucht werden.

---

### Task 1: Backend — Koordinatenformat-Whitelist um `dms` + `gk` erweitern

**Files:**
- Modify: `src/einsatz/einstellungen.rs:26` (Konstante `KOORDINATENFORMATE`)
- Test: `src/einsatz/einstellungen.rs` (Modul-Tests am Dateiende)

**Interfaces:**
- Produces: `ist_gueltiges_koordinatenformat(s: &str) -> bool` akzeptiert nun zusätzlich `"dms"` und `"gk"`.

- [ ] **Step 1: Failing test** — Test im `#[cfg(test)] mod tests` von `src/einsatz/einstellungen.rs` ergänzen:

```rust
#[test]
fn koordinatenformat_dms_und_gk_sind_gueltig() {
    assert!(ist_gueltiges_koordinatenformat("dms"));
    assert!(ist_gueltiges_koordinatenformat("gk"));
    assert!(ist_gueltiges_koordinatenformat("wgs84"));
    assert!(!ist_gueltiges_koordinatenformat("xyz"));
}
```

- [ ] **Step 2: Run, verify fail**

Run: `cargo test --lib koordinatenformat_dms_und_gk_sind_gueltig`
Expected: FAIL (`"dms"`/`"gk"` nicht in Whitelist).

- [ ] **Step 3: Implement** — Konstante erweitern (Länge 3 → 5):

```rust
pub const KOORDINATENFORMATE: [&str; 5] = ["wgs84", "dms", "utm", "mgrs", "gk"];
```

- [ ] **Step 4: Run, verify pass**

Run: `cargo test --lib koordinatenformat_dms_und_gk_sind_gueltig`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/einsatz/einstellungen.rs
git commit -m "feat(koordinaten): Backend-Whitelist um dms/gk erweitern"
```

---

### Task 2: Frontend — Dependencies + proj4-GK-Bootstrap

**Files:**
- Modify: `frontend/package.json` (deps `proj4`, `mgrs`)
- Create: `frontend/src/anzeige/proj4Setup.ts`
- Test: `frontend/src/anzeige/proj4Setup.test.ts`

**Interfaces:**
- Produces: Seiteneffekt-Modul `proj4Setup.ts` — nach Import sind `EPSG:31466`–`EPSG:31469` in proj4 registriert. Kein Export.

- [ ] **Step 1: Install deps**

Run: `cd frontend && pnpm add proj4 mgrs`
Expected: beide in `dependencies` (proj4 ~2.20.x, mgrs ~2.1.x). Beide bringen eigene TS-Typen mit — KEIN `@types/proj4` nötig.

- [ ] **Step 2: Failing test** — `frontend/src/anzeige/proj4Setup.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import proj4 from 'proj4';
import './proj4Setup';

describe('proj4Setup', () => {
  it('registriert GK Zone 3 (EPSG:31467) und transformiert Stuttgart', () => {
    expect(proj4.defs('EPSG:31467')).toBeTruthy();
    // Stuttgart lon=9.177 lat=48.782 → GK3 ~[3513083.5, 5404959.5] (towgs84-Helmert)
    const [r, h] = proj4('EPSG:4326', 'EPSG:31467', [9.177, 48.782]);
    expect(r).toBeCloseTo(3513083.5, 0);
    expect(h).toBeCloseTo(5404959.5, 0);
  });

  it('registriert alle vier GK-Zonen', () => {
    for (const epsg of ['EPSG:31466', 'EPSG:31467', 'EPSG:31468', 'EPSG:31469']) {
      expect(proj4.defs(epsg)).toBeTruthy();
    }
  });
});
```

- [ ] **Step 3: Run, verify fail**

Run: `cd frontend && pnpm vitest run src/anzeige/proj4Setup.test.ts`
Expected: FAIL (Modul existiert nicht / Defs unregistriert).

- [ ] **Step 4: Implement** — `frontend/src/anzeige/proj4Setup.ts`:

```ts
/**
 * Registriert die Gauß-Krüger-Zonen (DHDN/Bessel, EPSG:31466–31469) in proj4 —
 * einmalig auf Modul-Top-Level. ZWINGEND mit +towgs84 (EPSG:1777, 7-Parameter-
 * Helmert), sonst liefert proj4 still ~136 m falsche Werte. Genauigkeit ~3 m
 * (kein NTv2-Grid) — für taktische Lagekarten ausreichend, nicht für Kataster.
 * Muster: Zone n → lon_0 = 3·n, x_0 = n·1_000_000 + 500_000.
 */
import proj4 from 'proj4';

const TOWGS84 = '+towgs84=598.1,73.7,418.2,0.202,0.045,-2.455,6.7';
const gk = (lon0: number, x0: number) =>
  `+proj=tmerc +lat_0=0 +lon_0=${lon0} +k=1 +x_0=${x0} +y_0=0 +ellps=bessel ${TOWGS84} +units=m +no_defs`;

proj4.defs([
  ['EPSG:31466', gk(6, 2_500_000)],
  ['EPSG:31467', gk(9, 3_500_000)],
  ['EPSG:31468', gk(12, 4_500_000)],
  ['EPSG:31469', gk(15, 5_500_000)],
]);
```

- [ ] **Step 5: Run, verify pass + commit**

Run: `cd frontend && pnpm vitest run src/anzeige/proj4Setup.test.ts`
Expected: PASS.

```bash
git add frontend/package.json frontend/pnpm-lock.yaml frontend/src/anzeige/proj4Setup.ts frontend/src/anzeige/proj4Setup.test.ts
git commit -m "feat(koordinaten): proj4 + mgrs Deps + GK-Bootstrap (EPSG:31466-31469)"
```

---

### Task 3: Konvertierungs-Kern — Typ, Fehlerklasse, `formatiere`/`parse` + WGS84-dezimal

Additiv: neue Funktionen NEBEN der bestehenden Eigenimpl. Die alten `wgs84ZuUtm`/`wgs84ZuMgrs`/`utmZone` bleiben unangetastet (entfernt erst in Task 9), damit `format.ts` grün bleibt.

**Files:**
- Modify: `frontend/src/api/types.ts:69` (Typ `Koordinatenformat`)
- Modify: `frontend/src/anzeige/koordinaten.ts` (neue Exports oben anfügen, alte behalten)
- Test: `frontend/src/anzeige/koordinaten.test.ts` (neuen `describe`-Block ergänzen)

**Interfaces:**
- Produces:
  - `type Koordinatenformat = 'wgs84' | 'dms' | 'utm' | 'mgrs' | 'gk'` (in `api/types.ts`)
  - `interface LatLon { lat: number; lon: number }`
  - `class KoordinatenParseFehler extends Error`
  - `function formatiere(lat: number, lon: number, system: Koordinatenformat): string`
  - `function parse(text: string, system: Koordinatenformat): LatLon` (wirft `KoordinatenParseFehler`)
  - `function pruefeBereich(lat: number, lon: number): void` (intern; wirft bei out-of-range)

- [ ] **Step 1: Typ erweitern** — `frontend/src/api/types.ts:69`:

```ts
export type Koordinatenformat = 'wgs84' | 'dms' | 'utm' | 'mgrs' | 'gk';
```

- [ ] **Step 2: Failing test** — neuen Block in `koordinaten.test.ts`:

```ts
import { formatiere, parse, KoordinatenParseFehler } from './koordinaten';

describe('formatiere/parse — WGS84 dezimal', () => {
  it('formatiert byte-exakt mit 5 Nachkommastellen', () => {
    expect(formatiere(51.5, 10.25, 'wgs84')).toBe('51.50000, 10.25000');
  });
  it('parst und ist round-trip-stabil', () => {
    const p = parse('51.50000, 10.25000', 'wgs84');
    expect(p.lat).toBeCloseTo(51.5, 5);
    expect(p.lon).toBeCloseTo(10.25, 5);
  });
  it('wirft KoordinatenParseFehler bei Müll', () => {
    expect(() => parse('kein wert', 'wgs84')).toThrow(KoordinatenParseFehler);
  });
  it('wirft bei out-of-range', () => {
    expect(() => parse('123, 10', 'wgs84')).toThrow(KoordinatenParseFehler);
  });
});
```

- [ ] **Step 3: Run, verify fail**

Run: `cd frontend && pnpm vitest run src/anzeige/koordinaten.test.ts -t "WGS84 dezimal"`
Expected: FAIL (`formatiere`/`parse` nicht exportiert).

- [ ] **Step 4: Implement** — am ANFANG von `koordinaten.ts` (nach den bestehenden Imports) einfügen. Datei-Header-Kommentar um die „bewusste Grenzen / GK ~3 m"-Notiz ergänzen.

```ts
import proj4 from 'proj4';
import { forward as mgrsForward, toPoint as mgrsToPoint } from 'mgrs';
import type { Koordinatenformat } from '../api/types';
import './proj4Setup';

export interface LatLon { lat: number; lon: number; }

export class KoordinatenParseFehler extends Error {
  constructor(text: string, system: Koordinatenformat) {
    super(`Ungültige ${system}-Koordinate: "${text}"`);
    this.name = 'KoordinatenParseFehler';
  }
}

function pruefeBereich(lat: number, lon: number): void {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) throw new Error('NaN');
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) throw new Error('Bereich');
}

function formatiereWgs84(lat: number, lon: number): string {
  return `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
}
function parseWgs84(text: string): LatLon {
  const teile = text.split(',').map((s) => Number(s.trim()));
  if (teile.length !== 2 || teile.some((n) => !Number.isFinite(n))) throw new Error('Format');
  const [lat, lon] = teile;
  pruefeBereich(lat, lon);
  return { lat, lon };
}

export function formatiere(lat: number, lon: number, system: Koordinatenformat): string {
  switch (system) {
    case 'wgs84':
    default:
      return formatiereWgs84(lat, lon);
  }
}

export function parse(text: string, system: Koordinatenformat): LatLon {
  try {
    switch (system) {
      case 'wgs84':
      default:
        return parseWgs84(text);
    }
  } catch {
    throw new KoordinatenParseFehler(text, system);
  }
}
```

- [ ] **Step 5: Run, verify pass + commit**

Run: `cd frontend && pnpm vitest run src/anzeige/koordinaten.test.ts`
Expected: PASS (neue + alte Blöcke grün).

```bash
git add frontend/src/api/types.ts frontend/src/anzeige/koordinaten.ts frontend/src/anzeige/koordinaten.test.ts
git commit -m "feat(koordinaten): formatiere/parse-Seam + WGS84-dezimal"
```

---

### Task 4: WGS84-DMS (Grad/Minute/Sekunde)

**Files:**
- Modify: `frontend/src/anzeige/koordinaten.ts`
- Test: `frontend/src/anzeige/koordinaten.test.ts`

**Interfaces:**
- Consumes: `formatiere`/`parse`/`pruefeBereich`/`LatLon` aus Task 3.
- Produces: `formatiere(..., 'dms')` / `parse(..., 'dms')` — Format `51°30'00"N 010°15'00"E` (Breite 2-stellig, Länge 3-stellig Grad, Suffix N/S/E/W statt Vorzeichen).

- [ ] **Step 1: Failing test**

```ts
describe('formatiere/parse — DMS', () => {
  it('formatiert mit Hemisphären-Suffix, 3-stelliger Länge', () => {
    expect(formatiere(51.5, 10.25, 'dms')).toBe('51°30\'00"N 010°15\'00"E');
  });
  it('formatiert Süd/West negativ als S/W', () => {
    expect(formatiere(-1.5, -0.25, 'dms')).toBe('01°30\'00"S 000°15\'00"W');
  });
  it('round-trip', () => {
    const p = parse('51°30\'00"N 010°15\'00"E', 'dms');
    expect(p.lat).toBeCloseTo(51.5, 4);
    expect(p.lon).toBeCloseTo(10.25, 4);
  });
  it('wirft bei Müll', () => {
    expect(() => parse('51 nord', 'dms')).toThrow(KoordinatenParseFehler);
  });
});
```

- [ ] **Step 2: Run, verify fail**

Run: `cd frontend && pnpm vitest run src/anzeige/koordinaten.test.ts -t "DMS"`
Expected: FAIL (`'dms'` fällt heute auf den WGS84-Default).

- [ ] **Step 3: Implement** — Funktionen in `koordinaten.ts` ergänzen und `'dms'`-cases in `formatiere`/`parse` eintragen:

```ts
function dmsTeil(wert: number, istBreite: boolean): string {
  const hemi = istBreite ? (wert >= 0 ? 'N' : 'S') : (wert >= 0 ? 'E' : 'W');
  const abs = Math.abs(wert);
  let grad = Math.floor(abs);
  const restMin = (abs - grad) * 60;
  let min = Math.floor(restMin);
  let sek = Math.round((restMin - min) * 60);
  if (sek === 60) { sek = 0; min += 1; }
  if (min === 60) { min = 0; grad += 1; }
  const g = String(grad).padStart(istBreite ? 2 : 3, '0');
  return `${g}°${String(min).padStart(2, '0')}'${String(sek).padStart(2, '0')}"${hemi}`;
}
function formatiereDms(lat: number, lon: number): string {
  return `${dmsTeil(lat, true)} ${dmsTeil(lon, false)}`;
}
const DMS_RE = /(\d+(?:\.\d+)?)°\s*(\d+(?:\.\d+)?)'\s*(\d+(?:\.\d+)?)"?\s*([NSEWnsew])/g;
function parseDms(text: string): LatLon {
  const treffer = [...text.matchAll(DMS_RE)];
  if (treffer.length !== 2) throw new Error('Format');
  let lat: number | null = null;
  let lon: number | null = null;
  for (const t of treffer) {
    const dez = Number(t[1]) + Number(t[2]) / 60 + Number(t[3]) / 3600;
    const hemi = t[4].toUpperCase();
    if (hemi === 'N' || hemi === 'S') lat = hemi === 'S' ? -dez : dez;
    else lon = hemi === 'W' ? -dez : dez;
  }
  if (lat === null || lon === null) throw new Error('Achse');
  pruefeBereich(lat, lon);
  return { lat, lon };
}
```

In `formatiere`-switch: `case 'dms': return formatiereDms(lat, lon);`
In `parse`-switch: `case 'dms': return parseDms(text);`

- [ ] **Step 4: Run, verify pass + commit**

Run: `cd frontend && pnpm vitest run src/anzeige/koordinaten.test.ts`
Expected: PASS.

```bash
git add frontend/src/anzeige/koordinaten.ts frontend/src/anzeige/koordinaten.test.ts
git commit -m "feat(koordinaten): WGS84-DMS formatiere/parse"
```

---

### Task 5: UTM (proj4, EPSG:326xx/327xx)

**Files:**
- Modify: `frontend/src/anzeige/koordinaten.ts`
- Test: `frontend/src/anzeige/koordinaten.test.ts`

**Interfaces:**
- Consumes: Task 3-Seam, proj4.
- Produces: `formatiere(..., 'utm')` → `"32U 512345 5667890"` (Zone + Breitenband + gerundeter Easting/Northing); `parse(..., 'utm')` invers.

- [ ] **Step 1: Failing test**

```ts
describe('formatiere/parse — UTM', () => {
  it('formatiert Zone+Band+Easting/Northing (Mitte DE = Zone 32 U)', () => {
    const s = formatiere(51.16, 10.45, 'utm');
    expect(s).toMatch(/^32U \d{6} \d{7}$/);
  });
  it('wählt Zone 33 für Berlin (lon 13.4)', () => {
    expect(formatiere(52.52, 13.4, 'utm')).toMatch(/^33U /);
  });
  it('round-trip (< 1 m ≈ 1e-4 Grad)', () => {
    const s = formatiere(51.16, 10.45, 'utm');
    const p = parse(s, 'utm');
    expect(p.lat).toBeCloseTo(51.16, 4);
    expect(p.lon).toBeCloseTo(10.45, 4);
  });
  it('wirft bei Müll', () => {
    expect(() => parse('garnix', 'utm')).toThrow(KoordinatenParseFehler);
  });
});
```

- [ ] **Step 2: Run, verify fail**

Run: `cd frontend && pnpm vitest run src/anzeige/koordinaten.test.ts -t "UTM"`
Expected: FAIL.

- [ ] **Step 3: Implement** — ergänzen + cases eintragen:

```ts
const UTM_BANDS = 'CDEFGHJKLMNPQRSTUVWX';
function utmZone(lon: number): number {
  return Math.floor(((lon + 180) % 360) / 6) + 1;
}
function breitenband(lat: number): string {
  const idx = Math.max(0, Math.min(UTM_BANDS.length - 1, Math.floor((lat + 80) / 8)));
  return UTM_BANDS[idx];
}
function formatiereUtm(lat: number, lon: number): string {
  const zone = utmZone(lon);
  const [e, n] = proj4('EPSG:4326', `EPSG:326${String(zone).padStart(2, '0')}`, [lon, lat]);
  return `${zone}${breitenband(lat)} ${Math.round(e)} ${Math.round(n)}`;
}
const UTM_RE = /^(\d{1,2})\s*([C-Xc-x])\s+(\d+)\s+(\d+)$/;
function parseUtm(text: string): LatLon {
  const m = UTM_RE.exec(text.trim());
  if (!m) throw new Error('Format');
  const zone = Number(m[1]);
  const nord = m[2].toUpperCase() >= 'N';
  const epsg = `EPSG:${nord ? '326' : '327'}${String(zone).padStart(2, '0')}`;
  const [lon, lat] = proj4(epsg, 'EPSG:4326', [Number(m[3]), Number(m[4])]);
  pruefeBereich(lat, lon);
  return { lat, lon };
}
```

In `formatiere`: `case 'utm': return formatiereUtm(lat, lon);`
In `parse`: `case 'utm': return parseUtm(text);`

- [ ] **Step 4: Run, verify pass + commit**

Run: `cd frontend && pnpm vitest run src/anzeige/koordinaten.test.ts`
Expected: PASS.

```bash
git add frontend/src/anzeige/koordinaten.ts frontend/src/anzeige/koordinaten.test.ts
git commit -m "feat(koordinaten): UTM via proj4 (beide Richtungen)"
```

---

### Task 6: MGRS (mgrs-Paket)

**Files:**
- Modify: `frontend/src/anzeige/koordinaten.ts`
- Test: `frontend/src/anzeige/koordinaten.test.ts`

**Interfaces:**
- Consumes: Task 3-Seam, `mgrsForward`/`mgrsToPoint`.
- Produces: `formatiere(..., 'mgrs')` → lesbar gruppiert `"32U NB 12345 67890"`; `parse(..., 'mgrs')` toleriert Leerzeichen (strippt vor `toPoint`).

- [ ] **Step 1: Failing test**

```ts
describe('formatiere/parse — MGRS', () => {
  it('formatiert lesbar gruppiert GZD + Quadrat + 5+5 Stellen', () => {
    expect(formatiere(51.16, 10.45, 'mgrs')).toMatch(/^\d{1,2}[C-X] [A-Z]{2} \d{5} \d{5}$/);
  });
  it('round-trip via Zellzentrum (< 1 m)', () => {
    const s = formatiere(51.16, 10.45, 'mgrs');
    const p = parse(s, 'mgrs');
    expect(p.lat).toBeCloseTo(51.16, 3);
    expect(p.lon).toBeCloseTo(10.45, 3);
  });
  it('parst auch ohne Leerzeichen', () => {
    const kompakt = formatiere(51.16, 10.45, 'mgrs').replace(/\s+/g, '');
    const p = parse(kompakt, 'mgrs');
    expect(p.lat).toBeCloseTo(51.16, 3);
  });
  it('wirft bei Müll', () => {
    expect(() => parse('XX', 'mgrs')).toThrow(KoordinatenParseFehler);
  });
});
```

- [ ] **Step 2: Run, verify fail**

Run: `cd frontend && pnpm vitest run src/anzeige/koordinaten.test.ts -t "MGRS"`
Expected: FAIL.

- [ ] **Step 3: Implement** — ergänzen + cases eintragen:

```ts
function formatiereMgrs(lat: number, lon: number): string {
  const s = mgrsForward([lon, lat], 5); // kompakt, z.B. "32UNB1234567890"
  const m = /^(\d{1,2}[C-X])([A-Z]{2})(\d{5})(\d{5})$/.exec(s);
  return m ? `${m[1]} ${m[2]} ${m[3]} ${m[4]}` : s;
}
function parseMgrs(text: string): LatLon {
  const [lon, lat] = mgrsToPoint(text.replace(/\s+/g, '').toUpperCase());
  pruefeBereich(lat, lon);
  return { lat, lon };
}
```

In `formatiere`: `case 'mgrs': return formatiereMgrs(lat, lon);`
In `parse`: `case 'mgrs': return parseMgrs(text);`

- [ ] **Step 4: Run, verify pass + commit**

Run: `cd frontend && pnpm vitest run src/anzeige/koordinaten.test.ts`
Expected: PASS.

```bash
git add frontend/src/anzeige/koordinaten.ts frontend/src/anzeige/koordinaten.test.ts
git commit -m "feat(koordinaten): MGRS via mgrs-Paket (beide Richtungen)"
```

---

### Task 7: Gauß-Krüger (proj4, EPSG:31466–31469)

**Files:**
- Modify: `frontend/src/anzeige/koordinaten.ts`
- Test: `frontend/src/anzeige/koordinaten.test.ts`

**Interfaces:**
- Consumes: Task 3-Seam, proj4 + `proj4Setup` (Defs registriert).
- Produces: `formatiere(..., 'gk')` → `"R 3513084  H 5404959"` (Zone aus `lon`); `parse(..., 'gk')` (Zone aus führender Rechtswert-Ziffer).

- [ ] **Step 1: Failing test**

```ts
describe('formatiere/parse — Gauß-Krüger', () => {
  it('formatiert Rechts-/Hochwert, Zone 3 für Stuttgart (lon 9.177)', () => {
    const s = formatiere(48.782, 9.177, 'gk');
    expect(s).toMatch(/^R 35\d{5}  H 5\d{6}$/); // Rechtswert beginnt mit 3 = Zone 3
  });
  it('round-trip (< 3 m ≈ 1e-4 Grad)', () => {
    const s = formatiere(48.782, 9.177, 'gk');
    const p = parse(s, 'gk');
    expect(p.lat).toBeCloseTo(48.782, 4);
    expect(p.lon).toBeCloseTo(9.177, 4);
  });
  it('wählt Zone 4 für Berlin (Rechtswert beginnt mit 4)', () => {
    expect(formatiere(52.52, 13.4, 'gk')).toMatch(/^R 4/);
  });
  it('wirft bei Müll', () => {
    expect(() => parse('R abc H def', 'gk')).toThrow(KoordinatenParseFehler);
  });
});
```

- [ ] **Step 2: Run, verify fail**

Run: `cd frontend && pnpm vitest run src/anzeige/koordinaten.test.ts -t "Gauß-Krüger"`
Expected: FAIL.

- [ ] **Step 3: Implement** — ergänzen + cases eintragen. EPSG-Code = `31464 + Zone` (Zone 2→31466 … 5→31469).

```ts
function gkZone(lon: number): number {
  return Math.round(lon / 3); // lon_0 = 3·Zone
}
function formatiereGk(lat: number, lon: number): string {
  const zone = gkZone(lon);
  const [r, h] = proj4('EPSG:4326', `EPSG:${31464 + zone}`, [lon, lat]);
  return `R ${Math.round(r)}  H ${Math.round(h)}`;
}
const GK_RE = /R?\s*(\d{7})\s+H?\s*(\d{7})/i;
function parseGk(text: string): LatLon {
  const m = GK_RE.exec(text.trim());
  if (!m) throw new Error('Format');
  const r = Number(m[1]);
  const zone = Math.floor(r / 1_000_000); // führende Ziffer = Zone
  if (zone < 2 || zone > 5) throw new Error('Zone');
  const [lon, lat] = proj4(`EPSG:${31464 + zone}`, 'EPSG:4326', [r, Number(m[2])]);
  pruefeBereich(lat, lon);
  return { lat, lon };
}
```

In `formatiere`: `case 'gk': return formatiereGk(lat, lon);`
In `parse`: `case 'gk': return parseGk(text);`

- [ ] **Step 4: Run, verify pass + commit**

Run: `cd frontend && pnpm vitest run src/anzeige/koordinaten.test.ts`
Expected: PASS.

```bash
git add frontend/src/anzeige/koordinaten.ts frontend/src/anzeige/koordinaten.test.ts
git commit -m "feat(koordinaten): Gauß-Krüger via proj4 (EPSG:31466-31469)"
```

---

### Task 8: `format.ts` auf den neuen Seam umstellen (+ dms/gk)

**Files:**
- Modify: `frontend/src/anzeige/format.ts:15,82-100`
- Test: `frontend/src/anzeige/format.test.ts`

**Interfaces:**
- Consumes: `formatiere` aus `koordinaten.ts`.
- Produces: `formatKoordinate(lat, lon, konv)` unverändert in Signatur; intern Delegation; deckt nun alle 5 Systeme ab. WGS84-Default byte-identisch.

- [ ] **Step 1: Failing test** — in `format.test.ts` ergänzen (Bestands-WGS84-Assertions UNVERÄNDERT lassen):

```ts
it('formatiert dms über die Konvention', () => {
  expect(formatKoordinate(51.5, 10.25, { koordinatenformat: 'dms' })).toBe('51°30\'00"N 010°15\'00"E');
});
it('formatiert gk über die Konvention', () => {
  expect(formatKoordinate(48.782, 9.177, { koordinatenformat: 'gk' })).toMatch(/^R 35\d{5}  H 5\d{6}$/);
});
it('WGS84-Default bleibt byte-exakt', () => {
  expect(formatKoordinate(51.16040, 10.45140)).toBe('51.16040, 10.45140');
});
```

- [ ] **Step 2: Run, verify fail**

Run: `cd frontend && pnpm vitest run src/anzeige/format.test.ts`
Expected: FAIL bei dms/gk (Default-Fall liefert WGS84).

- [ ] **Step 3: Implement** — in `format.ts`:
  - Import (Zeile 15) ersetzen: `import { formatiere } from './koordinaten';` (entfernt `wgs84ZuMgrs, wgs84ZuUtm`).
  - `formatKoordinate` (82-100) ersetzen:

```ts
/** WGS84-Koordinate → Anzeige-String je Koordinatenformat (Default: dezimal). */
export function formatKoordinate(
  lat: number,
  lon: number,
  konv: AnzeigeKonventionen = DEFAULT_KONVENTIONEN,
): string {
  return formatiere(lat, lon, konv.koordinatenformat ?? 'wgs84');
}
```

- [ ] **Step 4: Run, verify pass** — falls bestehende UTM/MGRS-Assertions in `format.test.ts` angepasst werden müssen: NICHT blind die Testlauf-Ausgabe einkopieren (das zementiert evtl. einen Fehler), sondern gegen einen bekannten Sollwert verankern — denselben Referenzpunkt mit unabhängig prüfbarem Erwartungswert (z.B. Berlin lon 13.40/lat 52.52 → UTM Zone 33, MGRS GZD `33U`; Stuttgart → GK Zone 3). Der Wert muss plausibel zur Referenz passen, nicht nur grün sein. WGS84-Assertions dürfen sich NICHT ändern.

Run: `cd frontend && pnpm vitest run src/anzeige/format.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/anzeige/format.ts frontend/src/anzeige/format.test.ts
git commit -m "feat(koordinaten): format.ts delegiert an Seam, deckt dms/gk ab"
```

---

### Task 9: Eigenimplementierung entfernen (Cleanup)

**Files:**
- Modify: `frontend/src/anzeige/koordinaten.ts` (alte Funktionen + `UtmKoordinate` + alte Konstanten löschen)
- Modify: `frontend/src/anzeige/koordinaten.test.ts` (alte `describe`-Blöcke für `utmZone`/`wgs84ZuUtm`/`wgs84ZuMgrs` löschen)

**Interfaces:**
- Removes: `utmZone(_lat, lon)` (alte Signatur), `wgs84ZuUtm`, `wgs84ZuMgrs`, `interface UtmKoordinate`, ungenutzte Konstanten (`BANDS`, `COL_SETS`, `ROW_LETTERS`, `A/F/K0/E2/EP2` etc.).
- (Die neue interne `utmZone(lon)` aus Task 5 bleibt erhalten — andere Signatur, ist genutzt.)

- [ ] **Step 1: Alte Test-Blöcke entfernen** — in `koordinaten.test.ts` die `describe('utmZone' …)`, `describe('wgs84ZuUtm' …)`, `describe('wgs84ZuMgrs' …)` und den zugehörigen Import `import { wgs84ZuUtm, wgs84ZuMgrs, utmZone } from './koordinaten';` löschen.

- [ ] **Step 2: Alte Impl entfernen** — in `koordinaten.ts` die exportierten `utmZone(_lat, lon)`/`wgs84ZuUtm`/`wgs84ZuMgrs`, `interface UtmKoordinate` und die nur dafür genutzten Modul-Konstanten löschen. Die in Task 5–7 hinzugefügten internen Helfer bleiben.

- [ ] **Step 3: Verify — Typecheck + Tests**

Run: `cd frontend && pnpm exec tsc --noEmit && pnpm vitest run src/anzeige/`
Expected: PASS, keine ungenutzten Exporte, kein Importeur bricht (nur `format.ts` nutzte sie, jetzt auf `formatiere` umgestellt).

- [ ] **Step 4: Commit**

```bash
git add frontend/src/anzeige/koordinaten.ts frontend/src/anzeige/koordinaten.test.ts
git commit -m "refactor(koordinaten): Vorwärts-Eigenimpl durch Single-Engine ersetzt"
```

---

### Task 10: `useKoordinatenSystemOverride` — globaler session-sticky Override

**Files:**
- Create: `frontend/src/anzeige/koordinatenSystemStore.ts`
- Test: `frontend/src/anzeige/koordinatenSystemStore.test.ts`

**Interfaces:**
- Produces:
  - `function setzeOverride(system: Koordinatenformat | null): void` (schreibt/löscht localStorage, benachrichtigt Listener)
  - `function useKoordinatenSystemOverride(): Koordinatenformat | null` (reaktiv via `useSyncExternalStore`)
  - localStorage-Key `'lifeline.koordinatensystem'`.

Hinweis: jsdom unter Node liefert kein localStorage von sich aus — Polyfill + `afterEach`-clear sind in `src/test/setup.ts` bereits vorhanden (LFH). Test darf localStorage direkt nutzen.

- [ ] **Step 1: Failing test** — `koordinatenSystemStore.test.ts`:

```ts
import { describe, it, expect, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useKoordinatenSystemOverride, setzeOverride } from './koordinatenSystemStore';

afterEach(() => localStorage.clear());

describe('koordinatenSystemStore', () => {
  it('liefert null ohne gesetzten Override', () => {
    const { result } = renderHook(() => useKoordinatenSystemOverride());
    expect(result.current).toBeNull();
  });
  it('setzen aktualisiert reaktiv und persistiert', () => {
    const { result } = renderHook(() => useKoordinatenSystemOverride());
    act(() => setzeOverride('mgrs'));
    expect(result.current).toBe('mgrs');
    expect(localStorage.getItem('lifeline.koordinatensystem')).toBe('mgrs');
  });
  it('null löscht den Override', () => {
    const { result } = renderHook(() => useKoordinatenSystemOverride());
    act(() => setzeOverride('utm'));
    act(() => setzeOverride(null));
    expect(result.current).toBeNull();
  });
  it('ignoriert unbekannte gespeicherte Werte', () => {
    localStorage.setItem('lifeline.koordinatensystem', 'quatsch');
    const { result } = renderHook(() => useKoordinatenSystemOverride());
    expect(result.current).toBeNull();
  });
});
```

- [ ] **Step 2: Run, verify fail**

Run: `cd frontend && pnpm vitest run src/anzeige/koordinatenSystemStore.test.ts`
Expected: FAIL (Modul fehlt).

- [ ] **Step 3: Implement** — `koordinatenSystemStore.ts`:

```ts
/**
 * Globaler Koordinatensystem-Override (localStorage). Übersteuert die effektive
 * Anzeige-/Eingabe-Konvention app-weit — Anwender wählt das System einmal, nicht je
 * Feld. Reaktiv über useSyncExternalStore.
 *
 * Semantik: localStorage ist PERSISTENT (überlebt Browser-Neustarts, nicht nur die
 * Session). Ein einmal gesetzter Override übersteuert damit dauerhaft einen später
 * geänderten Org-Default, bis der Anwender ihn wieder auf den Org-Wert zurückstellt.
 * Bewusst so gewählt (User-Entscheidung). Für „nur bis Tab-Ende" wäre sessionStorage
 * der Tausch.
 */
import { useSyncExternalStore } from 'react';
import type { Koordinatenformat } from '../api/types';

const KEY = 'lifeline.koordinatensystem';
const GUELTIG: readonly Koordinatenformat[] = ['wgs84', 'dms', 'utm', 'mgrs', 'gk'];
const listeners = new Set<() => void>();

function lies(): Koordinatenformat | null {
  const v = localStorage.getItem(KEY);
  return v && (GUELTIG as readonly string[]).includes(v) ? (v as Koordinatenformat) : null;
}
function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}
export function setzeOverride(system: Koordinatenformat | null): void {
  if (system == null) localStorage.removeItem(KEY);
  else localStorage.setItem(KEY, system);
  listeners.forEach((l) => l());
}
export function useKoordinatenSystemOverride(): Koordinatenformat | null {
  return useSyncExternalStore(subscribe, lies, () => null);
}
```

- [ ] **Step 4: Run, verify pass + commit**

Run: `cd frontend && pnpm vitest run src/anzeige/koordinatenSystemStore.test.ts`
Expected: PASS.

```bash
git add frontend/src/anzeige/koordinatenSystemStore.ts frontend/src/anzeige/koordinatenSystemStore.test.ts
git commit -m "feat(koordinaten): globaler session-sticky System-Override"
```

---

### Task 11: Anzeige-Konvention um den Override erweitern

**Files:**
- Modify: `frontend/src/anzeige/AnzeigeKonventionenContext.tsx`
- Test: `frontend/src/anzeige/AnzeigeKonventionenContext.test.tsx`

**Interfaces:**
- Consumes: `useKoordinatenSystemOverride` (Task 10).
- Produces: `EinsatzAnzeigeProvider` bindet `formatKoordinate` an `koordinatenformat = override ?? data.koordinatenformat ?? null`. Umschalten via `setzeOverride` aktualisiert alle Anzeigen im Provider live.

- [ ] **Step 1: Failing test** — in `AnzeigeKonventionenContext.test.tsx` ergänzen:

```ts
import { setzeOverride } from './koordinatenSystemStore';
// ... afterEach(() => localStorage.clear()); falls noch nicht vorhanden

it('Override übersteuert das geladene Koordinatenformat in formatKoordinate', async () => {
  // Provider mit data.koordinatenformat = 'wgs84' rendern (Query-Mock wie in den Bestandstests)
  // ... Setup analog vorhandener Tests ...
  act(() => setzeOverride('dms'));
  // formatKoordinate(51.5, 10.25) muss jetzt DMS liefern:
  expect(screen.getByTestId('koord').textContent).toBe('51°30\'00"N 010°15\'00"E');
});
```

(Setup an die in dieser Datei bereits etablierte Render-/Mock-Struktur angleichen — Query liefert `koordinatenformat: 'wgs84'`, eine Testkomponente rendert `useAnzeigeKonventionen().formatKoordinate(51.5, 10.25)` in ein `data-testid="koord"`.)

- [ ] **Step 2: Run, verify fail**

Run: `cd frontend && pnpm vitest run src/anzeige/AnzeigeKonventionenContext.test.tsx`
Expected: FAIL (Override wird nicht einbezogen).

- [ ] **Step 3: Implement** — in `EinsatzAnzeigeProvider`:
  - Import ergänzen: `import { useKoordinatenSystemOverride } from './koordinatenSystemStore';`
  - Im Provider: `const override = useKoordinatenSystemOverride();`
  - In der `useMemo`-Konventionsbildung: `koordinatenformat: override ?? data?.koordinatenformat ?? null,`
  - `override` zur `useMemo`-Dependency-Liste hinzufügen.

- [ ] **Step 4: Run, verify pass + commit**

Run: `cd frontend && pnpm vitest run src/anzeige/AnzeigeKonventionenContext.test.tsx`
Expected: PASS.

```bash
git add frontend/src/anzeige/AnzeigeKonventionenContext.tsx frontend/src/anzeige/AnzeigeKonventionenContext.test.tsx
git commit -m "feat(koordinaten): Anzeige-Konvention bezieht System-Override ein"
```

---

### Task 12: `KoordinatenEingabe` — Form-Control (Textfeld + Umschalter)

**Files:**
- Create: `frontend/src/anzeige/KoordinatenEingabe.tsx`
- Test: `frontend/src/anzeige/KoordinatenEingabe.test.tsx`

**Interfaces:**
- Consumes: `formatiere`/`parse`/`LatLon`/`KoordinatenParseFehler`; `useKoordinatenSystemOverride` + `setzeOverride`; `useAnzeigeKonventionen` (für Fallback-System).
- Produces: Default-Export `KoordinatenEingabe`:

```ts
interface KoordinatenEingabeProps {
  value?: LatLon | null;
  onChange?: (wert: LatLon | null) => void;
  status?: 'error' | 'warning';
}
```

Round-Trip-Schutz: Das Widget hält den letzten gültigen `LatLon` als Wahrheit (über `value`). Bloßes Umschalten reformatiert aus `value` (kein parse→reformat). Editieren parst; Erfolg → `onChange(LatLon)`, Fehler → Invalid-State + `onChange(null)`. Leeres Feld → `onChange(null)`.

- [ ] **Step 1: Failing test** — `KoordinatenEingabe.test.tsx`:

```ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import KoordinatenEingabe from './KoordinatenEingabe';
import { setzeOverride } from './koordinatenSystemStore';

afterEach(() => localStorage.clear());

describe('KoordinatenEingabe', () => {
  it('zeigt den value im aktuellen System (WGS84 default)', () => {
    render(<KoordinatenEingabe value={{ lat: 51.5, lon: 10.25 }} onChange={() => {}} />);
    expect(screen.getByRole('textbox')).toHaveValue('51.50000, 10.25000');
  });

  it('parst Eingabe und meldet LatLon', () => {
    const onChange = vi.fn();
    render(<KoordinatenEingabe value={null} onChange={onChange} />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '51.5, 10.25' } });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ lat: 51.5, lon: 10.25 }));
  });

  it('Umschalten reformatiert aus value ohne Drift', () => {
    setzeOverride('dms');
    render(<KoordinatenEingabe value={{ lat: 51.5, lon: 10.25 }} onChange={() => {}} />);
    expect(screen.getByRole('textbox')).toHaveValue('51°30\'00"N 010°15\'00"E');
  });

  it('Invalid-State + onChange(null) bei Müll', () => {
    const onChange = vi.fn();
    render(<KoordinatenEingabe value={null} onChange={onChange} />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'quatsch' } });
    expect(onChange).toHaveBeenLastCalledWith(null);
    expect(screen.getByText(/ungültig/i)).toBeInTheDocument();
  });

  it('leeres Feld → onChange(null)', () => {
    const onChange = vi.fn();
    render(<KoordinatenEingabe value={{ lat: 51.5, lon: 10.25 }} onChange={onChange} />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '' } });
    expect(onChange).toHaveBeenLastCalledWith(null);
  });

  // Diskriminierender Test: in einer Form wird das onChange-Ergebnis als neues value
  // zurückgespeist. Ohne Fokus-Guard würde der useEffect die laufende Eingabe überschreiben.
  it('überschreibt die laufende Eingabe nicht, wenn value zurückgespeist wird (Form-Loop)', () => {
    function Wrapper() {
      const [v, setV] = useState<LatLon | null>(null);
      return <KoordinatenEingabe value={v} onChange={setV} />;
    }
    render(<Wrapper />);
    const input = screen.getByRole('textbox');
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '51.5, 10.2' } });
    expect(input).toHaveValue('51.5, 10.2'); // NICHT '51.50000, 10.20000'
  });
});
```

(Imports der Testdatei: zusätzlich `import { useState } from 'react';` und `import type { LatLon } from './koordinaten';`.)

- [ ] **Step 2: Run, verify fail**

Run: `cd frontend && pnpm vitest run src/anzeige/KoordinatenEingabe.test.tsx`
Expected: FAIL (Komponente fehlt).

- [ ] **Step 3: Implement** — `KoordinatenEingabe.tsx`:

```tsx
import { Input, Select, Space, Typography } from 'antd';
import { useEffect, useState } from 'react';
import type { Koordinatenformat } from '../api/types';
import { formatiere, parse, type LatLon } from './koordinaten';
import { useAnzeigeKonventionen } from './AnzeigeKonventionenContext';
import { setzeOverride, useKoordinatenSystemOverride } from './koordinatenSystemStore';

const OPTIONEN: { value: Koordinatenformat; label: string }[] = [
  { value: 'wgs84', label: 'WGS84 dezimal' },
  { value: 'dms', label: 'Grad/Min/Sek' },
  { value: 'utm', label: 'UTM' },
  { value: 'mgrs', label: 'MGRS' },
  { value: 'gk', label: 'Gauß-Krüger' },
];

interface Props {
  value?: LatLon | null;
  onChange?: (wert: LatLon | null) => void;
  status?: 'error' | 'warning';
}

export default function KoordinatenEingabe({ value, onChange, status }: Props) {
  const override = useKoordinatenSystemOverride();
  const { konventionen } = useAnzeigeKonventionen();
  const system: Koordinatenformat = override ?? konventionen.koordinatenformat ?? 'wgs84';

  const [text, setText] = useState('');
  const [fehler, setFehler] = useState(false);
  const [fokus, setFokus] = useState(false);

  // Aus der Wahrheit reformatieren bei EXTERNER Änderung (Laden, Kartenklick, Systemwechsel).
  // NICHT während aktivem Tippen — sonst überschreibt der Effekt die laufende Eingabe und der
  // Cursor springt (das passiert nur in der Form, wo onChange→value zurückgespeist wird).
  useEffect(() => {
    if (fokus) return;
    setText(value ? formatiere(value.lat, value.lon, system) : '');
    setFehler(false);
  }, [value, system, fokus]);

  function bearbeiten(roh: string) {
    setText(roh);
    if (roh.trim() === '') {
      setFehler(false);
      onChange?.(null);
      return;
    }
    try {
      onChange?.(parse(roh, system));
      setFehler(false);
    } catch {
      setFehler(true);
      onChange?.(null);
    }
  }

  return (
    <Space direction="vertical" size={2} style={{ width: '100%' }}>
      <Space.Compact style={{ width: '100%' }}>
        <Input
          value={text}
          onChange={(e) => bearbeiten(e.target.value)}
          onFocus={() => setFokus(true)}
          onBlur={() => setFokus(false)}
          status={fehler || status === 'error' ? 'error' : undefined}
          placeholder="Koordinate eingeben"
        />
        <Select<Koordinatenformat>
          value={system}
          onChange={setzeOverride}
          options={OPTIONEN}
          style={{ width: 150 }}
        />
      </Space.Compact>
      {fehler ? (
        <Typography.Text type="danger">Ungültige {system}-Koordinate</Typography.Text>
      ) : value ? (
        <Typography.Text type="secondary">
          entspricht {formatiere(value.lat, value.lon, 'wgs84')}
        </Typography.Text>
      ) : null}
    </Space>
  );
}
```

- [ ] **Step 4: Run, verify pass + commit**

Run: `cd frontend && pnpm vitest run src/anzeige/KoordinatenEingabe.test.tsx`
Expected: PASS.

```bash
git add frontend/src/anzeige/KoordinatenEingabe.tsx frontend/src/anzeige/KoordinatenEingabe.test.tsx
git commit -m "feat(koordinaten): KoordinatenEingabe-Widget (Textfeld + Umschalter)"
```

---

### Task 13: Pilot — EinsatzdatenPage (Anzeige + Eingabe)

**Files:**
- Modify: `frontend/src/pages/EinsatzdatenPage.tsx` (Anzeige 232-236, Form 192-199, `FormWerte`, `bearbeitenStarten` 112-113, `speichern` 130-131)

**Interfaces:**
- Consumes: `useAnzeigeKonventionen().formatKoordinate`; `KoordinatenEingabe`.
- Form-Feld `einsatzort_lat`/`einsatzort_lon` → ein virtuelles Feld `einsatzort_koord: LatLon | null`.

- [ ] **Step 1: Anzeige umstellen (232-236)** — `formatKoordinate` aus dem Hook nutzen:

```tsx
// oben in der Komponente:
const { formatKoordinate } = useAnzeigeKonventionen();
// Descriptions.Item "Koordinate":
<Descriptions.Item label="Koordinate">
  {einsatz.einsatzort_lat != null && einsatz.einsatzort_lon != null
    ? formatKoordinate(einsatz.einsatzort_lat, einsatz.einsatzort_lon)
    : '—'}
</Descriptions.Item>
```

(Import: `import { useAnzeigeKonventionen } from '../anzeige/AnzeigeKonventionenContext';`. Voraussetzung verifizieren: Die Einsatz-Route liegt unter `EinsatzAnzeigeProvider` — sonst greifen Defaults. Falls nicht, Provider in der Routen-Hierarchie ergänzen.)

- [ ] **Step 2: Eingabe umstellen (Form 192-199)** — die zwei `InputNumber`-`Form.Item` durch ein Widget-Feld ersetzen:

```tsx
<Form.Item label="Koordinate" name="einsatzort_koord">
  <KoordinatenEingabe />
</Form.Item>
```

(Import: `import KoordinatenEingabe from '../anzeige/KoordinatenEingabe';`. `<Space>`-Wrapper der zwei alten Items entfernen.)

- [ ] **Step 3: FormWerte + Mapping anpassen**
  - `FormWerte`: `einsatzort_lat`/`einsatzort_lon` entfernen, `einsatzort_koord?: LatLon | null` ergänzen (Import `LatLon` aus `../anzeige/koordinaten`).
  - `bearbeitenStarten` (112-113): statt der zwei Felder:

```ts
einsatzort_koord:
  einsatz.einsatzort_lat != null && einsatz.einsatzort_lon != null
    ? { lat: einsatz.einsatzort_lat, lon: einsatz.einsatzort_lon }
    : null,
```

  - `speichern` (130-131): statt der zwei Felder:

```ts
einsatzort_lat: werte.einsatzort_koord?.lat ?? null,
einsatzort_lon: werte.einsatzort_koord?.lon ?? null,
```

- [ ] **Step 4: Verify** — Typecheck + bestehende Tests + manuelle Sicht.

Run: `cd frontend && pnpm exec tsc --noEmit && pnpm vitest run src/pages/EinsatzdatenPage`
Expected: PASS (bzw. keine Tests betroffen → tsc grün genügt). Manuell nach `pnpm build` + Neustart: Einsatzort anzeigen/bearbeiten, System umschalten, speichern.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/EinsatzdatenPage.tsx
git commit -m "feat(koordinaten): EinsatzdatenPage Anzeige+Eingabe formatbewusst (Pilot)"
```

---

### Task 14: LagemeldungenPage — Anzeige umstellen

**Files:**
- Modify: `frontend/src/pages/LagemeldungenPage.tsx:52-54`

- [ ] **Step 1: Implement** — `toFixed(5)`-Inline durch den Hook-Formatter ersetzen:

```tsx
// oben: const { formatKoordinate } = useAnzeigeKonventionen();
// Stelle 52-54:
{l.lat != null && l.lon != null ? <>Geo: {formatKoordinate(l.lat, l.lon)}</> : null}
```

(Import `useAnzeigeKonventionen`. Provider-Verfügbarkeit verifizieren wie in Task 13.)

- [ ] **Step 2: Verify**

Run: `cd frontend && pnpm exec tsc --noEmit`
Expected: PASS. Manuell: Lagemeldung mit Geo, System umschalten → Anzeige folgt.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/pages/LagemeldungenPage.tsx
git commit -m "feat(koordinaten): LagemeldungenPage-Anzeige formatbewusst"
```

---

### Task 15: LagerelevantModal — Eingabe umstellen

**Files:**
- Modify: `frontend/src/meldungen/LagerelevantModal.tsx` (Form 68-90, `FormWerte` 19-23, `absenden` 40-49, `setFieldsValue` 37)

- [ ] **Step 1: Implement**
  - `FormWerte`: `lat`/`lon` → `koord?: LatLon | null` (Import `LatLon` aus `../anzeige/koordinaten`).
  - `setFieldsValue` (37): `form.setFieldsValue({ text: meldung?.inhalt ?? '', koord: null });`
  - Den `<Space>`-Block (68-90) inkl. Paar-Validator durch ein Feld ersetzen:

```tsx
<Form.Item name="koord" label="Verortung (optional)">
  <KoordinatenEingabe />
</Form.Item>
```

  - `absenden` (40-49):

```ts
function absenden(w: FormWerte) {
  const text = w.text?.trim() ? w.text.trim() : undefined;
  onUebergeben({ text, lat: w.koord?.lat, lon: w.koord?.lon });
}
```

  (Import `KoordinatenEingabe`. `InputNumber` aus dem antd-Import entfernen, falls sonst ungenutzt.)

- [ ] **Step 2: Verify**

Run: `cd frontend && pnpm exec tsc --noEmit`
Expected: PASS. Der Paar-Validator entfällt bewusst — ein Feld liefert immer `lat`+`lon` gemeinsam oder `null`.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/meldungen/LagerelevantModal.tsx
git commit -m "feat(koordinaten): LagerelevantModal-Verortung formatbewusst"
```

---

### Task 16: Lagekarte-Sidebar — manuelle Eingabe + Kartenklick-Echo

**Files:**
- Modify: `frontend/src/pages/lagekarte/Sidebar.tsx` (manuelle Eingabe, State `manuellLat`/`manuellLon` 69-70, UI 140-164)

- [ ] **Step 1: Implement** — die zwei `InputNumber` (manuellLat/manuellLon) + „Übernehmen" auf das Widget umstellen:
  - State: `const [koord, setKoord] = useState<LatLon | null>(null);` (Import `LatLon` aus `../../anzeige/koordinaten`).
  - UI (140-164): die zwei `InputNumber` durch `<KoordinatenEingabe value={koord} onChange={setKoord} />` ersetzen; „Übernehmen"-Button `disabled={!koord}`, `onClick={() => koord && props.onKoordinateEingeben(koord.lat, koord.lon)}`.
  - (Import `KoordinatenEingabe` aus `../../anzeige/KoordinatenEingabe`.)

- [ ] **Step 2: Kartenklick-Echo** — der Kartenklick liefert WGS84 (`LagekartePage.onKarteKlick`). Damit das Sidebar-Feld den Klick im aktuellen Format spiegelt: den geklickten Punkt an die Sidebar durchreichen und dort in `koord` setzen (Prop `geklickteKoordinate?: LatLon | null` → `useEffect` setzt `koord`). Minimal halten: falls die Verdrahtung zu groß wird, dieses Echo als eigenen Folge-Schritt belassen und nur die manuelle Eingabe umstellen — im Commit vermerken.

- [ ] **Step 3: Verify**

Run: `cd frontend && pnpm exec tsc --noEmit`
Expected: PASS. Manuell: Platzierungsmodus, Koordinate im gewählten System tippen → Übernehmen platziert korrekt; Kartenklick füllt das Feld (falls Echo umgesetzt).

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pages/lagekarte/Sidebar.tsx frontend/src/pages/lagekarte/LagekartePage.tsx
git commit -m "feat(koordinaten): Lagekarte-Sidebar formatbewusste Eingabe"
```

---

### Task 17: Konfig-Seiten — neue Systeme als Auswahl

**Files:**
- Modify: `frontend/src/pages/GlobalEinstellungenPage.tsx:29-32`
- Modify: `frontend/src/pages/EinsatzEinstellungenPage.tsx:54-57`

**Interfaces:**
- Consumes: erweiterter `Koordinatenformat`-Typ (Task 3).

- [ ] **Step 1: Implement** — beide `KOORDINATEN_OPTIONEN` um zwei Einträge erweitern (identisch in beiden Dateien):

```ts
const KOORDINATEN_OPTIONEN: { value: Koordinatenformat; label: string }[] = [
  { value: 'wgs84', label: 'WGS84 dezimal' },
  { value: 'dms', label: 'WGS84 (Grad/Min/Sek)' },
  { value: 'utm', label: 'UTM' },
  { value: 'mgrs', label: 'MGRS' },
  { value: 'gk', label: 'Gauß-Krüger' },
];
```

- [ ] **Step 2: Verify**

Run: `cd frontend && pnpm exec tsc --noEmit`
Expected: PASS. Manuell: in Org- und Einsatz-Einstellungen sind „WGS84 (Grad/Min/Sek)" und „Gauß-Krüger" wählbar und speicherbar (Backend-Whitelist aus Task 1 akzeptiert sie).

- [ ] **Step 3: Commit**

```bash
git add frontend/src/pages/GlobalEinstellungenPage.tsx frontend/src/pages/EinsatzEinstellungenPage.tsx
git commit -m "feat(koordinaten): dms/gk in Org- und Einsatz-Einstellungen wählbar"
```

---

### Task 18: Gesamt-Gate

**Files:** keine

- [ ] **Step 1: Volle Suite + Typecheck**

Run: `cd frontend && pnpm exec tsc --noEmit && pnpm vitest run --no-file-parallelism`
Expected: PASS (alle Frontend-Tests, ohne Parallel-Flakiness).

- [ ] **Step 2: Backend-Tests**

Run: `cargo test --lib einstellungen`
Expected: PASS.

- [ ] **Step 3: Build + manuelle End-to-End-Sicht**

Run: `cd frontend && pnpm build` → Backend neu starten (rust-embed) → im Browser: Org-Default auf MGRS stellen; Einsatzort anzeigen (MGRS), per Umschalter auf Gauß-Krüger wechseln (Anzeige + Eingabefeld folgen live); Ort per GK eintippen, speichern, Karte prüft Position; DMS und UTM stichprobenartig.

- [ ] **Step 4: Commit (falls Anpassungen nötig waren)** — sonst entfällt.

---

## Self-Review

**Spec-Abdeckung:**
- 5 Systeme (Tasks 3–7) ✓ · Anzeige app-weit / 2 Bypässe (Tasks 8, 13, 14) ✓ · Eingabe-Widget (Task 12) + Ausrollen (13, 15, 16) ✓ · session-sticky Umschalter (Tasks 10, 11, 12) ✓ · Konfig dms/gk (Tasks 1, 17) ✓ · WGS84-Persistenz unangetastet (kein Backend-/DB-Task außer Whitelist) ✓ · GK ~3 m + Fallstricke dokumentiert (Task 2 Header + Global Constraints) ✓ · Round-Trip-Schutz (Task 12) ✓.
- Außerhalb Scope (Spec): Stammdaten/Verwaltung, terra-draw, Cursor-Readout, Backend-Validierungs-Asymmetrie — bewusst keine Tasks.

**Platzhalter:** keine „TBD/TODO"; jeder Code-Step zeigt vollständigen Code. Einzige bewusste Bedingung: Task 16 Step 2 (Kartenklick-Echo) darf bei zu großer Verdrahtung als Folge-Schritt zurückgestellt werden — explizit markiert, kein stiller Cut.

**Typkonsistenz:** `LatLon`, `Koordinatenformat`, `formatiere`/`parse`, `setzeOverride`/`useKoordinatenSystemOverride`, `KoordinatenEingabe` (Props `value`/`onChange`/`status`) durchgängig identisch verwendet. EPSG-Schema `31464 + Zone` und `326${zone}` in Format- und Parse-Richtung konsistent.

**Offene Verifikation während Umsetzung:** `EinsatzAnzeigeProvider`-Verfügbarkeit über EinsatzdatenPage/LagemeldungenPage (Tasks 13/14) — falls nicht umschlossen, Provider in der Routen-Hierarchie ergänzen.
