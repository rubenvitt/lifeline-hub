# LFH-145 — Gefahrengebiet-Zeichnen: Abschluss-UX + Speicher-Bestätigung

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Beim Zeichnen einer Zone (Gefahrengebiet etc.) auf der Lagekarte ist unmissverständlich, dass gerade gezeichnet wird; der Abschluss ist explizit (Button + native Geste), und vor dem Speichern erscheint eine Bestätigung mit sichtbarer Entwurfsgeometrie.

**Architecture:** Der Root Cause (empirisch reproduziert, siehe Kontext unten) ist **nicht** das Editieren einer gespeicherten Zone (das ist unmöglich: terra-draw `editable=false`, gespeicherte Zonen liegen nie im terra-draw-Store), sondern das terra-draw-**Rubber-Band eines noch nicht abgeschlossenen Polygons** ohne sichtbare Abschluss-/Abbrechen-Affordance. Fix in drei Schichten: (1) `zeichnen.ts` verzögert das Aufräumen bis zum Ende und bietet `abschliessen()`; (2) ein neues, präsentationsfreies Overlay `ZeichnenSteuerung` zeigt Zeichen-Status + Aktionen; (3) `LagekartePage` fährt eine Zwei-Phasen-Steuerung (zeichnen → bestätigen) und persistiert Zonen erst nach Bestätigung. Die Entwurfsgeometrie bleibt während der Bestätigung sichtbar (terra-draw rendert den abgeschlossenen Entwurf weiter, da das Cleanup aufgeschoben ist).

**Tech Stack:** React 19, TypeScript, antd 6, terra-draw 1.31.2 + maplibre-gl 5, Vitest 4 + RTL, msw.

## Global Constraints

- `pnpm lint` läuft mit `--max-warnings 0` — Warnings = Fehler; an der Wurzel beheben (CLAUDE.md, LFH-168).
- pnpm via mise: `mise exec pnpm@11.10.0 -- pnpm -C <abs-pfad>/frontend <cmd>`.
- Sauberes Test-Gate: `… vitest run --no-file-parallelism` (Suite sonst flaky unter Last).
- antd: **keine** statischen `Modal.*`/`message.*` — `App.useApp()` nutzen (Test-Leakage). LagekartePage nutzt bereits `const { message } = App.useApp()`.
- Terminologie: BOS-/Führungs-Fachbegriffe, deutsche UI-Texte.
- **Verifikations-Ehrlichkeit:** jsdom fährt weder maplibre noch terra-draw. Die tatsächliche Zeichen-Interaktion (Abschließen/Abbrechen/Entwurf-Sichtbarkeit) ist **nur** im Browser-Smoke verifizierbar (lokaler Stack, siehe Task 5), nicht in Vitest. Vitest-grün ≠ Interaktion funktioniert.

## Kontext / Root Cause (bereits reproduziert)

Browser-Repro auf `/einsaetze/2/lagekarte` (blind-basemap) bestätigt:
- Ein **persistiertes** Gefahrengebiet ist gegen weitere Klicks immun (Koordinaten vor/nach neuem Klick identisch; ein neuer Klick startet ein separates terra-draw-Polygon).
- Während des Zeichnens fügt jeder Klick einen Vertex hinzu; der letzte (Rubber-Band-)Punkt folgt der Maus. Ein optisch fertiges, aber nicht abgeschlossenes Polygon (Abschluss = Startpunkt klicken / Doppelklick / **Enter**) schluckt den nächsten Klick → „letzter Punkt wandert mit".
- Persistenz + Cleanup passieren im `finish`-Handler in `zeichnen.ts` (`draw.on('finish', … ctx.action==='draw')`), danach `setZoneEntwurf(null)`.
- terra-draw hat **kein** öffentliches `finish()`/`cancel()`. Öffentlich: `clear()`, `getSnapshot()`, `setMode()`. Default-Keys: `cancel='Escape'`, `finish='Enter'` (Listener auf `map.getCanvas()`).

---

## File Structure

- `frontend/src/pages/lagekarte/zeichnen.ts` — MODIFY: Cleanup aufschieben, `stoppen()` räumt auf, neues `abschliessen()`. (Interaktion: Browser-Smoke.)
- `frontend/src/pages/lagekarte/ZeichnenSteuerung.tsx` — CREATE: präsentationsfreies Overlay (Props + Buttons, zwei Phasen). (Unit-testbar.)
- `frontend/src/pages/lagekarte/ZeichnenSteuerung.test.tsx` — CREATE: Unit-Tests des Overlays.
- `frontend/src/pages/lagekarte/Kartenflaeche.tsx` — MODIFY: `KartenHandle` um `zoneAbschliessen()` + `abschnittAbschliessen()` erweitern; an `zeichnen.ts.abschliessen()` delegieren. (Interaktion: Browser-Smoke.)
- `frontend/src/pages/LagekartePage.tsx` — MODIFY: Zwei-Phasen-State (`zoneBestaetigung`), Overlay einbinden, Persistenz erst nach Bestätigung; Abschnitt-Zeichnen bekommt Abschließen/Abbrechen (ohne Confirm). (State/Flow: jsdom via Kartenflaeche-Stub.)
- `frontend/src/pages/LagekartePage.test.tsx` — MODIFY: Confirm-Flow-Tests über den vorhandenen Stub.

---

### Task 1: `ZeichnenSteuerung`-Overlay (präsentationsfrei)

**Files:**
- Create: `frontend/src/pages/lagekarte/ZeichnenSteuerung.tsx`
- Test: `frontend/src/pages/lagekarte/ZeichnenSteuerung.test.tsx`

**Interfaces:**
- Produces:
  ```ts
  export type ZeichnenPhase = 'zeichnen' | 'bestaetigen';
  export interface ZeichnenSteuerungProps {
    aktiv: boolean;
    /** z. B. "Gefahrengebiet · Fläche" oder "Abschnitt". */
    titel: string;
    phase: ZeichnenPhase;
    /** true, wenn in Phase 'bestaetigen' ein Speichern-Request läuft. */
    speichernLaeuft?: boolean;
    onAbschliessen: () => void;
    onAbbrechen: () => void;
    onSpeichern: () => void;
    onVerwerfen: () => void;
  }
  export default function ZeichnenSteuerung(props: ZeichnenSteuerungProps): JSX.Element | null;
  ```

- [ ] **Step 1: Write the failing tests**

```tsx
// frontend/src/pages/lagekarte/ZeichnenSteuerung.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from 'antd';
import ZeichnenSteuerung from './ZeichnenSteuerung';

function setup(overrides = {}) {
  const props = {
    aktiv: true,
    titel: 'Gefahrengebiet · Fläche',
    phase: 'zeichnen' as const,
    onAbschliessen: vi.fn(),
    onAbbrechen: vi.fn(),
    onSpeichern: vi.fn(),
    onVerwerfen: vi.fn(),
    ...overrides,
  };
  render(
    <App>
      <ZeichnenSteuerung {...props} />
    </App>,
  );
  return props;
}

describe('ZeichnenSteuerung', () => {
  it('rendert nichts, wenn inaktiv', () => {
    const { container } = render(
      <App>
        <ZeichnenSteuerung aktiv={false} titel="x" phase="zeichnen"
          onAbschliessen={vi.fn()} onAbbrechen={vi.fn()} onSpeichern={vi.fn()} onVerwerfen={vi.fn()} />
      </App>,
    );
    expect(container.textContent).not.toContain('Abschließen');
  });

  it('Phase zeichnen: zeigt Titel + Hinweis + Abschließen/Abbrechen', async () => {
    const p = setup();
    expect(screen.getByText('Gefahrengebiet · Fläche')).toBeInTheDocument();
    expect(screen.getByText(/Startpunkt|Doppelklick|Abschließen/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Abschließen' }));
    expect(p.onAbschliessen).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole('button', { name: 'Abbrechen' }));
    expect(p.onAbbrechen).toHaveBeenCalledTimes(1);
  });

  it('Phase bestaetigen: zeigt Speichern/Verwerfen', async () => {
    const p = setup({ phase: 'bestaetigen' });
    await userEvent.click(screen.getByRole('button', { name: 'Speichern' }));
    expect(p.onSpeichern).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole('button', { name: 'Verwerfen' }));
    expect(p.onVerwerfen).toHaveBeenCalledTimes(1);
  });

  it('Phase bestaetigen mit speichernLaeuft: Speichern zeigt Loading', () => {
    setup({ phase: 'bestaetigen', speichernLaeuft: true });
    // antd Button loading rendert eine Spinner-Struktur; Button bleibt im DOM.
    expect(screen.getByRole('button', { name: 'Speichern' })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `mise exec pnpm@11.10.0 -- pnpm -C <abs>/frontend exec vitest run src/pages/lagekarte/ZeichnenSteuerung.test.tsx --no-file-parallelism`
Expected: FAIL — `Cannot find module './ZeichnenSteuerung'`.

- [ ] **Step 3: Implement `ZeichnenSteuerung.tsx`**

```tsx
// frontend/src/pages/lagekarte/ZeichnenSteuerung.tsx
import { Button, Card, Space, Typography, theme } from 'antd';

export type ZeichnenPhase = 'zeichnen' | 'bestaetigen';

export interface ZeichnenSteuerungProps {
  aktiv: boolean;
  /** z. B. "Gefahrengebiet · Fläche" oder "Abschnitt". */
  titel: string;
  phase: ZeichnenPhase;
  /** true, wenn in Phase 'bestaetigen' ein Speichern-Request läuft. */
  speichernLaeuft?: boolean;
  onAbschliessen: () => void;
  onAbbrechen: () => void;
  onSpeichern: () => void;
  onVerwerfen: () => void;
}

/**
 * Overlay über der Karte, das den aktiven Zeichen-Zustand sichtbar macht und den
 * Abschluss explizit steuert (LFH-145). Zwei Phasen:
 *  - 'zeichnen'    → Hinweis + „Abschließen" / „Abbrechen"
 *  - 'bestaetigen' → „Speichern" / „Verwerfen" (Entwurf bleibt auf der Karte sichtbar)
 * Präsentationsfrei: keine Karten-/terra-draw-Kenntnis, nur Props + Callbacks.
 */
export default function ZeichnenSteuerung(props: ZeichnenSteuerungProps) {
  const { token } = theme.useToken();
  if (!props.aktiv) return null;
  const bestaetigen = props.phase === 'bestaetigen';
  return (
    <Card
      size="small"
      style={{
        position: 'absolute',
        left: '50%',
        bottom: 16,
        transform: 'translateX(-50%)',
        zIndex: 5,
        boxShadow: token.boxShadowSecondary,
        minWidth: 320,
      }}
    >
      <Space orientation="vertical" size={8} style={{ width: '100%' }}>
        <Typography.Text strong>{props.titel}</Typography.Text>
        {bestaetigen ? (
          <>
            <Typography.Text type="secondary">
              Entwurf prüfen und speichern.
            </Typography.Text>
            <Space>
              <Button type="primary" loading={props.speichernLaeuft} onClick={props.onSpeichern}>
                Speichern
              </Button>
              <Button onClick={props.onVerwerfen}>Verwerfen</Button>
            </Space>
          </>
        ) : (
          <>
            <Typography.Text type="secondary">
              Punkte per Klick setzen. Startpunkt klicken, doppelklicken oder „Abschließen".
            </Typography.Text>
            <Space>
              <Button type="primary" onClick={props.onAbschliessen}>
                Abschließen
              </Button>
              <Button onClick={props.onAbbrechen}>Abbrechen</Button>
            </Space>
          </>
        )}
      </Space>
    </Card>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `… vitest run src/pages/lagekarte/ZeichnenSteuerung.test.tsx --no-file-parallelism`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/lagekarte/ZeichnenSteuerung.tsx frontend/src/pages/lagekarte/ZeichnenSteuerung.test.tsx
git commit -m "feat(lfh-145): ZeichnenSteuerung-Overlay (Abschließen/Abbrechen, Speichern/Verwerfen)"
```

---

### Task 2: `zeichnen.ts` — Cleanup aufschieben + `abschliessen()`

**Files:**
- Modify: `frontend/src/pages/lagekarte/zeichnen.ts`

**Interfaces:**
- Produces (erweitertes `Zeichnung`):
  ```ts
  export interface Zeichnung {
    starten: (modus: ZeichenModus) => void;
    stoppen: () => void;
    zerstoeren: () => void;
    /** Native terra-draw-Finish-Geste (Enter) auslösen. terra-draw ignoriert zu wenige Punkte selbst. */
    abschliessen: () => void;
  }
  ```
- Consumes: `map.getCanvas()` (maplibre) für die synthetische Finish-Taste.

**Verifikation:** jsdom fährt terra-draw nicht → Verhaltensnachweis erst im Browser-Smoke (Task 5). Hier nur: Datei kompiliert, Typen/`stoppen`-Semantik.

- [ ] **Step 1: Cleanup aufschieben — `removeFeatures` aus dem finish-Handler entfernen**

In `frontend/src/pages/lagekarte/zeichnen.ts`, im `draw.on('finish', …)`-Callback den gesamten `draw.removeFeatures(…)`-Block ersetzen durch einen Kommentar:

```ts
  draw.on('finish', (id, ctx) => {
    if (ctx.action !== 'draw') return;
    const f = draw.getSnapshot().find((x) => x.id === id);
    if (f && f.geometry.type === 'Polygon') {
      onFertig({ type: 'Polygon', coordinates: f.geometry.coordinates as number[][][] });
    } else if (f && f.geometry.type === 'LineString') {
      onFertig({ type: 'LineString', coordinates: f.geometry.coordinates as number[][] });
    }
    // Kein sofortiges removeFeatures mehr: der abgeschlossene Entwurf bleibt sichtbar, bis
    // die App das Zeichnen beendet (`stoppen()` räumt via `draw.clear()` auf) — nötig, damit
    // die Speicher-Bestätigung die Geometrie zeigt (LFH-145).
  });
```

- [ ] **Step 2: `stoppen()` räumt auf; `abschliessen()` ergänzen**

Das `return { … }`-Objekt in `createZeichnung` ersetzen durch:

```ts
  return {
    starten: (modus) => {
      if (!draw.enabled) draw.start();
      draw.setMode(MODUS_NAME[modus]);
    },
    stoppen: () => {
      if (draw.enabled) {
        // Entwurf (in-progress ODER abgeschlossen-aber-unbestätigt) verwerfen, dann stoppen.
        draw.clear();
        draw.stop();
      }
    },
    zerstoeren: () => {
      if (draw.enabled) draw.stop();
    },
    abschliessen: () => {
      // terra-draw hat keine öffentliche finish()-API. Der native Abschluss läuft über die
      // Finish-Taste (default 'Enter'); terra-draw registriert seine Key-Listener auf
      // map.getCanvas(). Wir feuern die Geste synthetisch. Zu wenige Punkte ignoriert
      // terra-draw selbst (kein finish-Event) — dann bleibt der Nutzer im Zeichnen-Modus.
      const el = map.getCanvas();
      el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      el.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', bubbles: true }));
    },
  };
```

Und das `Zeichnung`-Interface um `abschliessen: () => void;` erweitern (siehe Interfaces oben).

- [ ] **Step 3: Typecheck + Lint der Datei**

Run: `… pnpm -C <abs>/frontend exec tsc --noEmit` → Expected: keine Fehler.
Run: `… pnpm -C <abs>/frontend exec eslint src/pages/lagekarte/zeichnen.ts --max-warnings 0` → Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pages/lagekarte/zeichnen.ts
git commit -m "feat(lfh-145): zeichnen.ts – Cleanup bis Ende aufschieben, abschliessen() (native Enter-Finish)"
```

---

### Task 3: `Kartenflaeche` — imperative `zoneAbschliessen()` / `abschnittAbschliessen()`

**Files:**
- Modify: `frontend/src/pages/lagekarte/Kartenflaeche.tsx`

**Interfaces:**
- Consumes: `Zeichnung.abschliessen()` (Task 2).
- Produces (erweitertes `KartenHandle`):
  ```ts
  export interface KartenHandle {
    initialeEckenFuerBild(ar: number): Ecken | null;
    zentriereAufEcken(ecken: Ecken): void;
    /** Aktives Zonen-Zeichnen abschließen (native Finish-Geste). No-op, wenn nicht aktiv. */
    zoneAbschliessen(): void;
    /** Aktives Abschnitt-Zeichnen abschließen. No-op, wenn nicht aktiv. */
    abschnittAbschliessen(): void;
  }
  ```

**Verifikation:** Map-only → Browser-Smoke (Task 5). Hier: Typecheck.

- [ ] **Step 1: `KartenHandle` erweitern**

Interface `KartenHandle` (bei `initialeEckenFuerBild`/`zentriereAufEcken`) um die zwei Methoden aus den Interfaces oben ergänzen.

- [ ] **Step 2: `useImperativeHandle` erweitern**

Im `useImperativeHandle(ref, () => ({ … }))` zwei Methoden ergänzen:

```ts
    zoneAbschliessen() {
      zoneDrawRef.current?.abschliessen();
    },
    abschnittAbschliessen() {
      drawRef.current?.abschliessen();
    },
```

Falls der `useImperativeHandle`-Callback ein Dependency-Array hat, das leer/`[]` ist: unverändert lassen (die Refs sind stabil). Falls `mapRef`/andere gelistet sind, im gleichen Stil belassen.

- [ ] **Step 3: Typecheck**

Run: `… exec tsc --noEmit` → Expected: keine Fehler. (Der Stub-Mock in `LagekartePage.test.tsx` implementiert `KartenHandle` nicht via ref → dort kein Typbruch, da als Funktionskomponente gemockt.)

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pages/lagekarte/Kartenflaeche.tsx
git commit -m "feat(lfh-145): KartenHandle.zoneAbschliessen/abschnittAbschliessen (delegiert an zeichnen)"
```

---

### Task 4: `LagekartePage` — Zwei-Phasen-Steuerung + Speicher-Bestätigung

**Files:**
- Modify: `frontend/src/pages/LagekartePage.tsx`
- Modify: `frontend/src/pages/LagekartePage.test.tsx`

**Interfaces:**
- Consumes: `ZeichnenSteuerung` (Task 1), `KartenHandle.zoneAbschliessen/abschnittAbschliessen` (Task 3), vorhandenes `legeZoneAn`, `zeichneAbschnitt`, `ZONE_TYPEN`.
- Produces: neuer State `zoneBestaetigung: { typ: ZoneTyp; modus: ZeichenModus; farbe?: string; geometrie: GeoJsonGeometry } | null`.

- [ ] **Step 1: Failing-Tests im vorhandenen Test (Stub-Flow)**

In `frontend/src/pages/LagekartePage.test.tsx` eine `describe`-Gruppe ergänzen. Nutzt den vorhandenen Kartenflaeche-Stub (Button `zone-fertig` feuert `onZoneGezeichnet`). Muster für Rendern/Login/msw wie in bestehenden Tests der Datei übernehmen (gleiche Helfer/`renderLagekarte`-Äquivalent verwenden, das dort schon existiert).

```tsx
// innerhalb LagekartePage.test.tsx – nutzt vorhandene Test-Helfer der Datei
describe('LFH-145: Zeichnen-Abschluss + Bestätigung', () => {
  it('Zone zeichnen → Overlay „zeichnen" sichtbar', async () => {
    await renderLagekartePage(); // vorhandener Helfer der Datei
    await userEvent.click(await screen.findByRole('button', { name: 'Gefahrengebiet zeichnen' }));
    expect(await screen.findByText('Gefahrengebiet · Fläche')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Abschließen' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Abbrechen' })).toBeInTheDocument();
  });

  it('nach Abschluss (Stub) → Phase „bestaetigen", noch NICHT persistiert', async () => {
    const legeZoneAnSpy = spyLegeZoneAn(); // msw-Handler zählt POSTs; Muster s. bestehende Tests
    await renderLagekartePage();
    await userEvent.click(await screen.findByRole('button', { name: 'Gefahrengebiet zeichnen' }));
    await userEvent.click(await screen.findByRole('button', { name: 'zone-fertig' })); // Stub = Finish
    expect(await screen.findByRole('button', { name: 'Speichern' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Verwerfen' })).toBeInTheDocument();
    expect(legeZoneAnSpy.count()).toBe(0);
  });

  it('Speichern → POST /zonen mit der Geometrie', async () => {
    const legeZoneAnSpy = spyLegeZoneAn();
    await renderLagekartePage();
    await userEvent.click(await screen.findByRole('button', { name: 'Gefahrengebiet zeichnen' }));
    await userEvent.click(await screen.findByRole('button', { name: 'zone-fertig' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Speichern' }));
    await waitFor(() => expect(legeZoneAnSpy.count()).toBe(1));
    expect(legeZoneAnSpy.lastBody().typ).toBe('gefahrengebiet');
  });

  it('Verwerfen → kein POST, Overlay weg', async () => {
    const legeZoneAnSpy = spyLegeZoneAn();
    await renderLagekartePage();
    await userEvent.click(await screen.findByRole('button', { name: 'Gefahrengebiet zeichnen' }));
    await userEvent.click(await screen.findByRole('button', { name: 'zone-fertig' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Verwerfen' }));
    expect(legeZoneAnSpy.count()).toBe(0);
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Speichern' })).not.toBeInTheDocument());
  });

  it('Abbrechen in Phase zeichnen → kein POST, Overlay weg', async () => {
    const legeZoneAnSpy = spyLegeZoneAn();
    await renderLagekartePage();
    await userEvent.click(await screen.findByRole('button', { name: 'Gefahrengebiet zeichnen' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Abbrechen' }));
    expect(legeZoneAnSpy.count()).toBe(0);
    await waitFor(() => expect(screen.queryByText('Gefahrengebiet · Fläche')).not.toBeInTheDocument());
  });
});
```

> Hinweis für Umsetzer: `renderLagekartePage`/`spyLegeZoneAn` sind Platzhalter für die in dieser Datei bereits etablierten Muster (Render-Helfer + msw). Datei zuerst lesen und die vorhandenen Helfer/Handler wiederverwenden, statt neue zu erfinden. Der Stub-Button heißt exakt `zone-fertig` (Zeile ~52–64).

- [ ] **Step 2: Run tests to verify they fail**

Run: `… vitest run src/pages/LagekartePage.test.tsx --no-file-parallelism`
Expected: FAIL — Overlay-Texte/Buttons existieren noch nicht.

- [ ] **Step 3: State + Overlay + Persistenz in `LagekartePage.tsx`**

3a) Import ergänzen:
```ts
import ZeichnenSteuerung from './lagekarte/ZeichnenSteuerung';
```
(`ZeichenModus` ist bereits importiert; `ZONE_TYPEN` aus `./lagekarte/zonenStil` importieren, falls nicht vorhanden.)

3b) State ergänzen (bei `zoneEntwurf`):
```ts
const [zoneBestaetigung, setZoneBestaetigung] = useState<
  { typ: ZoneTyp; modus: ZeichenModus; farbe?: string; geometrie: GeoJsonGeometry } | null
>(null);
```

3c) `onZoneGezeichnet` (im `<Kartenflaeche … onZoneGezeichnet={…}>`) auf reine Übernahme-in-Bestätigung umstellen (statt direkt persistieren):
```tsx
onZoneGezeichnet={(g) => {
  if (!zoneEntwurf) return;
  // Nicht sofort persistieren: erst Bestätigung (Entwurf bleibt sichtbar). LFH-145.
  setZoneBestaetigung({ ...zoneEntwurf, geometrie: g });
}}
```

3d) Persistenz-Handler ergänzen (nahe der übrigen Handler):
```ts
const [zoneSpeichern, setZoneSpeichern] = useState(false);
const bestaetigungSpeichern = () => {
  if (!zoneBestaetigung) return;
  setZoneSpeichern(true);
  legeZoneAn(einsatzId, {
    typ: zoneBestaetigung.typ,
    geometrie_typ: zoneBestaetigung.geometrie.type,
    geometrie: JSON.stringify(zoneBestaetigung.geometrie),
    farbe: zoneBestaetigung.typ === 'freie_skizze' ? zoneBestaetigung.farbe ?? null : null,
  })
    .then(() => qc.invalidateQueries({ queryKey: ['einsatz-zonen', einsatzId] }))
    .catch(fehler)
    .finally(() => {
      setZoneSpeichern(false);
      setZoneBestaetigung(null);
      setZoneEntwurf(null); // beendet Zeichnen → Kartenflaeche-Effekt ruft stoppen() → clear()
    });
};
const bestaetigungVerwerfen = () => {
  setZoneBestaetigung(null);
  setZoneEntwurf(null); // verwirft den Entwurf (stoppen() → clear())
};
```

3e) Overlay im `position:relative`-Container (der `<div style={{ flex: 1, position: 'relative' }}>`, der `<Kartenflaeche>` umschließt), NACH `</Kartenflaeche>` bzw. neben dem `aktiverMarker`-Panel einfügen:
```tsx
<ZeichnenSteuerung
  aktiv={zoneEntwurf != null || zoneBestaetigung != null || zeichneAbschnittId != null}
  titel={
    zeichneAbschnittId != null
      ? 'Abschnitt'
      : `${ZONE_TYPEN.find((t) => t.typ === (zoneBestaetigung?.typ ?? zoneEntwurf?.typ))?.label ?? 'Zone'} · ${
          (zoneBestaetigung?.modus ?? zoneEntwurf?.modus) === 'linie' ? 'Linie' : 'Fläche'
        }`
  }
  phase={zoneBestaetigung != null ? 'bestaetigen' : 'zeichnen'}
  speichernLaeuft={zoneSpeichern}
  onAbschliessen={() =>
    zeichneAbschnittId != null
      ? kartenRef.current?.abschnittAbschliessen()
      : kartenRef.current?.zoneAbschliessen()
  }
  onAbbrechen={() => {
    setZoneEntwurf(null);
    setZeichneAbschnittId(null);
  }}
  onSpeichern={bestaetigungSpeichern}
  onVerwerfen={bestaetigungVerwerfen}
/>
```

3f) Sicherstellen, dass beim Start eines anderen Modus / Platzierens (`onZoneZeichnenStart`, `onAbschnittZeichnenStart`, `onPlatzierenStart`, `onBildPlatzieren`, `onEinsatzortPlatzieren`) auch `setZoneBestaetigung(null)` gesetzt wird — dort, wo bereits `setZoneEntwurf(null)` steht, jeweils `setZoneBestaetigung(null)` daneben ergänzen (verhindert ein hängendes Bestätigungs-Overlay beim Moduswechsel).

- [ ] **Step 4: Run tests to verify they pass**

Run: `… vitest run src/pages/LagekartePage.test.tsx --no-file-parallelism`
Expected: PASS (neue + bestehende Tests der Datei).

- [ ] **Step 5: Typecheck + Lint**

Run: `… exec tsc --noEmit` → keine Fehler.
Run: `… exec eslint src/pages/LagekartePage.tsx src/pages/lagekarte/ZeichnenSteuerung.tsx --max-warnings 0` → clean (bes. `react-hooks/exhaustive-deps`).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/pages/LagekartePage.tsx frontend/src/pages/LagekartePage.test.tsx
git commit -m "feat(lfh-145): Zonen-Zeichnen mit Abschluss-Overlay + Speicher-Bestätigung (Persistenz erst nach Bestätigung)"
```

---

### Task 5: Browser-Smoke (eigenes Gate — nicht jsdom)

**Files:** keine (Verifikation).

Lokaler Stack (vorbereitet): `target/debug/lifeline-hub` (dev-seeds) auf `127.0.0.1:8099`, Login `leitung`/`dev`, Einsatz 2, `/einsaetze/2/lagekarte`, Basemap „Blind". **Wichtig:** Nach den Frontend-Änderungen `pnpm build` + Backend-Neustart (rust-embed embeddet `frontend/dist`) — sonst zeigt der Server das alte Bundle.

- [ ] **Step 1: Frontend bauen + Backend mit neuem Bundle starten**

```bash
mise exec pnpm@11.10.0 -- pnpm -C <abs>/frontend build
# Backend (Worktree) mit dev-seeds neu starten, Port 8099, Temp-DB.
```

- [ ] **Step 2: Verifizieren (Chrome-DevTools-MCP oder manuell)**
  - Gefahrengebiet zeichnen aktivieren → Overlay „Gefahrengebiet · Fläche" + Hinweis + Abschließen/Abbrechen erscheint.
  - Drei Punkte setzen, „Abschließen" → Overlay wechselt zu Speichern/Verwerfen; **Entwurf bleibt sichtbar**.
  - „Speichern" → `POST /api/einsaetze/2/zonen`, Zone erscheint als gespeicherte Zone, Overlay weg.
  - Wiederholen, „Verwerfen" → kein POST, Entwurf verschwindet.
  - Wiederholen, nativer Abschluss per **Doppelklick** → ebenfalls Bestätigungs-Phase.
  - „Abbrechen" in Zeichnen-Phase → Entwurf verworfen, kein POST.
  - Absperrgrenze (Linie) zeichnen → analog (Linie).
  - Regression: eine **gespeicherte** Zone bleibt bei neuem Zeichnen unverändert (Repro-Kernaussage).

- [ ] **Step 3: Notieren** (ehrlich): welche Punkte visuell/Netzwerk bestätigt wurden.

---

### Task 6: Volles Gate + Abschluss

- [ ] **Step 1:** `… vitest run --no-file-parallelism` (volle Suite) → grün.
- [ ] **Step 2:** `… exec tsc --noEmit` → keine Fehler.
- [ ] **Step 3:** `… exec eslint . --max-warnings 0` → clean.
- [ ] **Step 4:** `superpowers:requesting-code-review` → Board-Status `in review`.
- [ ] **Step 5:** `superpowers:finishing-a-development-branch` → Merge → Board-Status `shipped`/`done`.

---

## Self-Review

**Spec coverage:**
- AC „bestehendes Gefahrengebiet nicht ohne Bestätigung verändert" → bereits erfüllt (gespeicherte Zonen sind immun; Repro belegt) + Task 4 macht das Speichern eines neuen Gebiets bestätigungspflichtig.
- AC „abgeschlossenes Gebiet bleibt unangetastet, solange nicht bewusst ausgewählt" → erfüllt (kein Editier-Pfad; Regression in Task 5 Step 2).
- AC „Bestätigungsdialog bevor der letzte Punkt übernommen/verschoben wird" → interpretiert als Bestätigung vor dem Speichern der Fläche (Task 4) + explizite Abschluss-UX gegen das versehentliche „Wandern" (Task 1–4). Abweichung zur wörtlichen (mechanisch nicht existenten) Formulierung ist mit Ruben abgestimmt („beides kombinieren").

**Placeholder-Scan:** `renderLagekartePage`/`spyLegeZoneAn` in Task 4 sind bewusst als „vorhandene Muster wiederverwenden" markiert (die Datei hat eigene Helfer/msw-Handler); der Umsetzer liest die Datei und nutzt sie. Alle Produktionscode-Schritte tragen vollständigen Code.

**Typkonsistenz:** `abschliessen` (zeichnen.ts) ↔ `zoneAbschliessen`/`abschnittAbschliessen` (KartenHandle) ↔ Overlay-`onAbschliessen`. `zoneBestaetigung`-Shape konsistent zwischen `onZoneGezeichnet`, `bestaetigungSpeichern`, Overlay-`titel`/`phase`.
