# Frontend (React + Ant Design PWA) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eine installierbare React-PWA (Ant Design v5), die das bestehende lifeline-hub-Backend konsumiert — Login, Einsatzauswahl, ETB-Ansicht mit Live-Updates, Schnellerfassung, Berichtigungen, Such-/Filter, Offline-Puffer, Mitglieder- und Benutzerverwaltung.

**Architecture:** SPA unter `frontend/`, im Dev über Vite-Proxy (`/api` → `127.0.0.1:8080`) same-origin an das Axum-Backend gekoppelt (Session-Cookie ist `httpOnly`/`SameSite=Lax` ohne `Secure` → Proxy ist der einzig saubere Weg, CORS entfällt). Datenhaltung über TanStack Query; Live über `EventSource` (SSE); Offline-Puffer über IndexedDB (`idb`). Tests: Vitest + React Testing Library + MSW (gemockte API) + fake-indexeddb; ein Playwright-E2E für den Kernfluss.

**Tech Stack:** Vite 5, React 18, TypeScript 5, Ant Design v5, React Router v6, TanStack Query v5, `idb` 8, vite-plugin-pwa, Vitest 2, @testing-library/react 16, MSW 2, fake-indexeddb 6, Playwright 1.

> **Scope-Grenze zu Plan 6:** Plan 5 baut ausschließlich die SPA (Build-Output unter `frontend/dist/`). Das **Einbetten** des Frontends in die Rust-Binary (`tower-http ServeDir`/`include_dir`, Single-Binary-Build) ist **Plan 6** — in diesem Plan NICHT implementieren. Hier läuft das Frontend im Dev über `npm run dev` gegen ein separat gestartetes Backend (`cargo run`).

> **Ports nicht fest verdrahtet (Workspaces):** Frontend-Dev-Port und Backend-Proxy-Ziel kommen aus ENV/`.env.local` (`FRONTEND_PORT`, `LIFELINE_BACKEND_URL`), die `npm run setup` mit freien Ports befüllt (Task 1). Defaults (`5173` / `http://127.0.0.1:8080`) greifen nur, wenn nichts gesetzt ist. Der Browser-Code spricht ausschließlich relativ `/api` an — der Port taucht nirgends im Anwendungscode auf.

---

## Backend-Vertrag (Referenz — bereits implementiert, NICHT ändern)

Alle Antworten sind JSON. Fehler einheitlich `{ "error": "<Meldung>" }` mit Statuscode (400 Validation, 401 Unauthorized, 403 Forbidden, 404 NotFound, 409 Conflict, 500 intern). Authentifizierung über Session-Cookie `lifeline_sid` (wird vom Browser automatisch same-origin gesendet).

| Methode | Pfad | Body / Query | Antwort | Auth/Recht |
|---|---|---|---|---|
| POST | `/api/auth/login` | `{ benutzername, passwort }` | `BenutzerAnzeige` + setzt Cookie | — |
| POST | `/api/auth/logout` | — | `204` + löscht Cookie | — |
| GET | `/api/auth/me` | — | `BenutzerAnzeige` | angemeldet |
| GET | `/api/benutzer` | — | `BenutzerAnzeige[]` | Admin |
| POST | `/api/benutzer` | `{ anzeigename, benutzername, passwort, system_rolle?, org_rolle? }` | `201 BenutzerAnzeige` | Admin |
| POST | `/api/benutzer/{id}/deaktivieren` | — | `BenutzerAnzeige` | Admin |
| GET | `/api/einsaetze` | — | `EinsatzAnzeige[]` (mit `meine_rolle`) | angemeldet |
| POST | `/api/einsaetze` | `{ bezeichnung, stichwort? }` | `201 EinsatzAnzeige` | Admin oder org-Führungskraft |
| GET | `/api/einsaetze/{id}` | — | `EinsatzAnzeige` | Mitglied |
| POST | `/api/einsaetze/{id}/abschliessen` | — | `EinsatzAnzeige` | Einsatzleitung, nur wenn aktiv |
| GET | `/api/einsaetze/{id}/mitglieder` | — | `MitgliedAnzeige[]` | Mitglied |
| PUT | `/api/einsaetze/{id}/mitglieder/{benutzer_id}` | `{ einsatz_rolle }` | `MitgliedAnzeige[]` | Einsatzleitung, nur aktiv |
| DELETE | `/api/einsaetze/{id}/mitglieder/{benutzer_id}` | — | `MitgliedAnzeige[]` | Einsatzleitung, nur aktiv |
| POST | `/api/einsaetze/{id}/etb` | `NeuerEintrag` | `201 EtbEintragAnzeige` | Schreibrecht (Leitung/Führung), nur aktiv |
| GET | `/api/einsaetze/{id}/etb` | Query: `q, typ, von, bis, erfasser_id, before_lfd_nr, limit` | `EtbEintragAnzeige[]` (lfd_nr DESC) | Mitglied |
| GET | `/api/einsaetze/{id}/etb/stream` | — | SSE: Events `etb` (JSON eines Eintrags) und `lagged` (`"resync"`) | Mitglied |

**Wichtige Backend-Regeln, die die UI spiegeln muss:**
- **Append-only:** kein Edit/Delete von ETB-Einträgen. Korrektur = neuer Eintrag `typ="berichtigung"` mit `berichtigt_eintrag_id` (Pflicht); bei anderen Typen muss `berichtigt_eintrag_id` fehlen.
- **`typ="system"`** ist nicht client-erfassbar (400) — in Auswahllisten ausschließen.
- **Schreibrecht** nur `einsatz_rolle ∈ {einsatzleitung, fuehrungspersonal}` UND `status === "aktiv"` → Schnellerfassung sonst gar nicht anbieten.
- **Zeitmodell:** Client setzt `ereigniszeit` (Default jetzt, überschreibbar) und `erfasst_lokal_at` (jetzt, beim Absenden). Server vergibt `lfd_nr` + `received_at`.
- **SSE pusht nur NEUE Einträge**; Initial-Bestand kommt aus `GET …/etb`. Bei `lagged` → kompletter Refetch.
- **Pagination:** `limit` Default 100 / max 500; Cursor `before_lfd_nr` (nur Einträge mit kleinerer lfd_nr).

---

## File Structure

```
frontend/
  package.json              # Deps + Scripts (dev/build/test/typecheck/lint/e2e)
  tsconfig.json             # App-TS-Config
  tsconfig.node.json        # TS-Config für vite.config
  vite.config.ts            # Vite + Proxy + PWA + Vitest-Config
  index.html                # SPA-Einstieg
  eslint.config.js          # Minimales Flat-Config-Lint
  .prettierrc               # Format
  playwright.config.ts      # E2E-Config
  e2e/
    kernfluss.spec.ts       # E2E: Login → Einsatz → Eintrag live
  public/
    pwa-192.png  pwa-512.png  favicon.svg   # PWA-Icons
  src/
    main.tsx                # Bootstrap: Providers, PWA-Register
    App.tsx                 # Router-Definition
    vite-env.d.ts           # Vite + PWA-Client-Typen
    theme.ts                # antd Design-Tokens (Primärfarbe/Radius)
    api/
      client.ts             # fetch-Wrapper, ApiError, Fehlerformat-Parsing
      types.ts              # DTO-Typen (Spiegel der Backend-Anzeige-Structs)
      auth.ts               # login/logout/me
      einsaetze.ts          # Einsatz-CRUD + Mitglieder
      etb.ts                # ETB erfassen/listen + Query-Param-Bau
      benutzer.ts           # Admin-Benutzerverwaltung
    auth/
      AuthContext.tsx       # useAuth(): aktueller Benutzer + login/logout
    routes/
      RequireAuth.tsx       # Auth-Guard für geschützte Routen
    components/
      AppLayout.tsx         # Topbar (Nutzer/Rolle/Logout) + Outlet
    pages/
      LoginPage.tsx
      EinsaetzePage.tsx     # Liste + Anlegen
      EtbPage.tsx           # ETB-Ansicht (komponiert Tabelle/Filter/Erfassung/SSE/Offline/Mitglieder)
      BenutzerPage.tsx      # Admin
    etb/
      typFarben.ts          # Farbcode + Label je Eintragstyp; istNachgetragen()
      EtbTabelle.tsx        # Chronologische Tabelle inkl. ⧖ + Berichtigungs-Verknüpfung
      EtbFilterleiste.tsx   # q/typ/Zeitraum/Erfasser
      Schnellerfassung.tsx  # Pflicht typ+inhalt, ausklappbare Optionalfelder, Berichtigen
      MitgliederPanel.tsx   # Drawer: Mitglieder anzeigen/zuweisen/entfernen
      useEtbStream.ts       # SSE-Hook → invalidiert ['etb', id]
    offline/
      queue.ts              # IndexedDB-Queue (idb)
      useEtbErfassung.ts    # erfassen() mit Offline-Fallback + Flush bei 'online'
    test/
      setup.ts              # MSW + jest-dom + fake-indexeddb
      server.ts             # MSW-Server-Instanz
      utils.tsx             # renderMitProviders()
```

---

## Task 1: Projekt-Skelett + Vitest-Smoke-Test

**Files:**
- Create: `frontend/package.json`, `frontend/tsconfig.json`, `frontend/tsconfig.node.json`, `frontend/vite.config.ts`, `frontend/index.html`, `frontend/eslint.config.js`, `frontend/.prettierrc`, `frontend/src/main.tsx`, `frontend/src/App.tsx`, `frontend/src/vite-env.d.ts`, `frontend/src/theme.ts`, `frontend/src/test/setup.ts`, `frontend/src/test/server.ts`
- Test: `frontend/src/App.test.tsx`

- [ ] **Step 1: package.json anlegen**

`frontend/package.json`:

```json
{
  "name": "lifeline-hub-frontend",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "setup": "node scripts/setup-dev-env.mjs",
    "dev": "vite",
    "build": "tsc -b && vite build",
    "preview": "vite preview",
    "typecheck": "tsc -b --noEmit",
    "lint": "eslint .",
    "test": "vitest run",
    "test:watch": "vitest",
    "e2e": "playwright test"
  },
  "dependencies": {
    "@ant-design/icons": "^5.5.1",
    "@tanstack/react-query": "^5.59.0",
    "antd": "^5.21.0",
    "dayjs": "^1.11.13",
    "idb": "^8.0.0",
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "react-router-dom": "^6.26.2"
  },
  "devDependencies": {
    "@playwright/test": "^1.47.2",
    "@testing-library/jest-dom": "^6.5.0",
    "@testing-library/react": "^16.0.1",
    "@testing-library/user-event": "^14.5.2",
    "@types/react": "^18.3.10",
    "@types/react-dom": "^18.3.0",
    "@vitejs/plugin-react": "^4.3.2",
    "eslint": "^9.11.1",
    "eslint-plugin-react-hooks": "^5.1.0-rc.0",
    "fake-indexeddb": "^6.0.0",
    "jsdom": "^25.0.1",
    "msw": "^2.4.9",
    "prettier": "^3.3.3",
    "typescript": "^5.6.2",
    "typescript-eslint": "^8.8.0",
    "vite": "^5.4.8",
    "vite-plugin-pwa": "^0.20.5",
    "vitest": "^2.1.2"
  }
}
```

- [ ] **Step 2: TS- und Tooling-Konfiguration anlegen**

`frontend/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "useDefineForClassFields": true,
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "Bundler",
    "allowImportingTsExtensions": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "types": ["vite/client", "@testing-library/jest-dom"]
  },
  "include": ["src", "e2e"],
  "references": [{ "path": "./tsconfig.node.json" }]
}
```

`frontend/tsconfig.node.json`:

```json
{
  "compilerOptions": {
    "composite": true,
    "skipLibCheck": true,
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "allowSyntheticDefaultImports": true,
    "strict": true,
    "noEmit": true
  },
  "include": ["vite.config.ts"]
}
```

`frontend/.prettierrc`:

```json
{
  "singleQuote": true,
  "semi": true,
  "printWidth": 100,
  "trailingComma": "all"
}
```

`frontend/eslint.config.js`:

```js
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

export default tseslint.config(
  { ignores: ['dist', 'playwright-report', 'node_modules'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: { ...reactHooks.configs.recommended.rules },
  },
);
```

> Hinweis: `@eslint/js` wird transitiv von `typescript-eslint` mitgeliefert. Falls `npm run lint` einen fehlenden Import meldet, `npm i -D @eslint/js` ergänzen. `lint` ist kein blockierendes Gate — `typecheck`, `test`, `build` sind es.

- [ ] **Step 3: Vite-Config mit Proxy, PWA und Vitest anlegen**

`frontend/vite.config.ts`:

```ts
/// <reference types="vitest/config" />
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// Dev-Server und Proxy-Ziel werden NICHT fest verdrahtet (Workspaces vergeben Ports
// dynamisch). Quelle: .env.local (vom `npm run setup` geschrieben) + Shell-/CI-ENV,
// wobei process.env Vorrang hat. Defaults greifen für „einfach lokal".
export default defineConfig(({ mode }) => {
  const env = { ...loadEnv(mode, process.cwd(), ''), ...process.env };
  const backendUrl = env.LIFELINE_BACKEND_URL || 'http://127.0.0.1:8080';
  const frontendPort = env.FRONTEND_PORT ? Number(env.FRONTEND_PORT) : undefined;

  return {
    plugins: [
      react(),
      VitePWA({
        registerType: 'autoUpdate',
        includeAssets: ['favicon.svg'],
        manifest: {
          name: 'lifeline-hub',
          short_name: 'lifeline',
          description: 'Elektronisches Einsatztagebuch',
          theme_color: '#a8071a',
          background_color: '#ffffff',
          display: 'standalone',
          start_url: '/',
          icons: [
            { src: 'pwa-192.png', sizes: '192x192', type: 'image/png' },
            { src: 'pwa-512.png', sizes: '512x512', type: 'image/png' },
          ],
        },
      }),
    ],
    server: {
      port: frontendPort, // undefined → Vite-Default (5173) bzw. nächster freier Port
      strictPort: false,
      proxy: {
        '/api': { target: backendUrl, changeOrigin: true },
      },
    },
    test: {
      environment: 'jsdom',
      setupFiles: './src/test/setup.ts',
      css: false,
    },
  };
});
```

> Das Frontend (Browser) kennt den Backend-Port **nie** — alle Requests laufen relativ über `/api` und werden vom Dev-Proxy umgeleitet. Damit ist nur das Proxy-Ziel (Dev-Server-seitig, Node) zu konfigurieren; der ausgelieferte Build (Plan 6, eingebettet) braucht den Proxy gar nicht.

- [ ] **Step 4: HTML-Einstieg, Theme, vite-env, Bootstrap und App anlegen**

`frontend/index.html`:

```html
<!doctype html>
<html lang="de">
  <head>
    <meta charset="UTF-8" />
    <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>lifeline-hub</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

`frontend/src/vite-env.d.ts`:

```ts
/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />
```

`frontend/src/theme.ts`:

```ts
import type { ThemeConfig } from 'antd';

/** Dezentes Branding über antd Design-Tokens (Spec §13). */
export const theme: ThemeConfig = {
  token: {
    colorPrimary: '#a8071a',
    borderRadius: 4,
  },
};
```

`frontend/src/App.tsx` (Platzhalter; in Task 4 durch Router ersetzt):

```tsx
export default function App() {
  return <h1>lifeline-hub</h1>;
}
```

`frontend/src/main.tsx`:

```tsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import { ConfigProvider } from 'antd';
import deDE from 'antd/locale/de_DE';
import { registerSW } from 'virtual:pwa-register';
import App from './App';
import { theme } from './theme';

registerSW({ immediate: true });

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ConfigProvider locale={deDE} theme={theme}>
      <App />
    </ConfigProvider>
  </React.StrictMode>,
);
```

- [ ] **Step 5: Test-Setup (MSW + jest-dom + fake-indexeddb) anlegen**

`frontend/src/test/server.ts`:

```ts
import { setupServer } from 'msw/node';

/** Geteilte MSW-Server-Instanz; Handler werden pro Test via server.use() gesetzt. */
export const server = setupServer();
```

`frontend/src/test/setup.ts`:

```ts
import '@testing-library/jest-dom/vitest';
import 'fake-indexeddb/auto';
import { afterAll, afterEach, beforeAll } from 'vitest';
import { server } from './server';

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
```

- [ ] **Step 6: Smoke-Test schreiben**

`frontend/src/App.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import App from './App';

describe('App', () => {
  it('rendert den App-Titel', () => {
    render(<App />);
    expect(screen.getByRole('heading', { name: 'lifeline-hub' })).toBeInTheDocument();
  });
});
```

- [ ] **Step 7: Dependencies installieren, Test ausführen**

```bash
cd frontend && npm install
npm run test
```
Erwartet: 1 passed (App-Smoke-Test grün).

Zusätzlich `npm run typecheck` — erwartet: keine Fehler.

- [ ] **Step 8: PWA-Platzhalter-Icons anlegen**

Erzeuge minimale Platzhalter, damit der Build nicht an fehlenden Assets scheitert (echte Icons später):

```bash
cd frontend && mkdir -p public
printf '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" fill="%23a8071a"/></svg>' > public/favicon.svg
# 1x1-PNG-Platzhalter (transparent) für beide Größen
printf '\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x06\x00\x00\x00\x1f\x15\xc4\x89\x00\x00\x00\nIDATx\x9cc\x00\x01\x00\x00\x05\x00\x01\r\n\x2d\xb4\x00\x00\x00\x00IEND\xaeB`\x82' > public/pwa-192.png
cp public/pwa-192.png public/pwa-512.png
```

- [ ] **Step 9: Setup-Skript für dynamische Ports + .gitignore anlegen**

`frontend/.gitignore`:

```gitignore
node_modules/
dist/
dist-ssr/
playwright-report/
test-results/
.playwright/
.env
.env.local
.env.*.local
*.local
```

`frontend/scripts/setup-dev-env.mjs` — sucht freie Ports und schreibt `frontend/.env.local`. So bleibt nichts fest verdrahtet (wichtig für parallele Workspaces):

```js
#!/usr/bin/env node
import { createServer } from 'node:net';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const frontendDir = join(here, '..');

/** Lässt das OS einen freien Port wählen (listen auf 0) und gibt ihn zurück. */
function freierPort() {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

const backendPort = Number(process.env.BACKEND_PORT) || (await freierPort());
const frontendPort = Number(process.env.FRONTEND_PORT) || (await freierPort());
const backendUrl = `http://127.0.0.1:${backendPort}`;

const inhalt =
  `# Generiert von 'npm run setup' — pro Workspace dynamisch, NICHT committen.\n` +
  `FRONTEND_PORT=${frontendPort}\n` +
  `LIFELINE_BACKEND_URL=${backendUrl}\n`;

writeFileSync(join(frontendDir, '.env.local'), inhalt);

console.log('frontend/.env.local geschrieben:');
console.log(`  Frontend (Vite):  http://localhost:${frontendPort}`);
console.log(`  Backend (Proxy):  ${backendUrl}`);
console.log('\nBackend passend starten (Repo-Root):');
console.log(`  cargo run -- --bind 127.0.0.1:${backendPort}`);
console.log('  (alternativ: LIFELINE_BIND=127.0.0.1:' + backendPort + ' cargo run)');
```

- [ ] **Step 10: Setup-Skript testen**

```bash
cd frontend && npm run setup && cat .env.local
```
Erwartet: `.env.local` mit `FRONTEND_PORT=…` und `LIFELINE_BACKEND_URL=http://127.0.0.1:…` (freie Ports). Danach `npm run dev` lauscht auf dem gewählten Frontend-Port und proxyt `/api` ans gewählte Backend.

- [ ] **Step 11: Commit**

```bash
cd frontend && git add package.json package-lock.json tsconfig.json tsconfig.node.json vite.config.ts index.html eslint.config.js .prettierrc .gitignore scripts public src
git commit -m "feat(frontend): Vite/React/antd-Skelett mit Vitest-Smoke-Test und dynamischen Dev-Ports

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: API-Client + DTO-Typen

**Files:**
- Create: `frontend/src/api/types.ts`, `frontend/src/api/client.ts`
- Test: `frontend/src/api/client.test.ts`

- [ ] **Step 1: DTO-Typen schreiben** (Spiegel der Backend-Anzeige-Structs)

`frontend/src/api/types.ts`:

```ts
export type SystemRolle = 'admin' | 'keiner';
export type OrgRolle = 'fuehrungskraft' | 'keine';

export interface BenutzerAnzeige {
  id: number;
  anzeigename: string;
  benutzername: string;
  system_rolle: SystemRolle;
  org_rolle: OrgRolle;
  aktiv: boolean;
  erstellt_at: string;
}

export type EinsatzStatus = 'aktiv' | 'abgeschlossen';
export type EinsatzRolle = 'einsatzleitung' | 'fuehrungspersonal' | 'beobachter';

export interface EinsatzAnzeige {
  id: number;
  bezeichnung: string;
  stichwort: string | null;
  status: EinsatzStatus;
  begonnen_at: string;
  abgeschlossen_at: string | null;
  abgeschlossen_von: number | null;
  /** Rolle des abfragenden Benutzers; null = kein Mitglied. */
  meine_rolle: EinsatzRolle | null;
}

export interface MitgliedAnzeige {
  benutzer_id: number;
  anzeigename: string;
  benutzername: string;
  einsatz_rolle: EinsatzRolle;
  zugewiesen_at: string;
}

/** 'system' wird vom Server automatisch erzeugt und ist nicht client-erfassbar. */
export type EtbTyp = 'meldung' | 'anordnung' | 'lage' | 'entscheidung' | 'system' | 'berichtigung';
export type MeldeWeg = 'funk' | 'telefon' | 'persoenlich' | 'sonstige';

export interface EtbEintragAnzeige {
  id: number;
  lfd_nr: number;
  typ: EtbTyp;
  inhalt: string;
  von: string | null;
  an: string | null;
  meldeweg: MeldeWeg | null;
  veranlassung: string | null;
  erfasser_id: number;
  erfasser_name: string;
  /** SQLite-Format 'YYYY-MM-DD HH:MM:SS' (UTC). */
  ereigniszeit: string;
  received_at: string;
  erfasst_lokal_at: string | null;
  berichtigt_eintrag_id: number | null;
}
```

- [ ] **Step 2: Test für den API-Client schreiben**

`frontend/src/api/client.test.ts`:

```ts
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { server } from '../test/server';
import { ApiError, apiGet, apiSend } from './client';

describe('apiGet', () => {
  it('liefert geparstes JSON bei 200', async () => {
    server.use(http.get('/api/ding', () => HttpResponse.json({ wert: 42 })));
    await expect(apiGet<{ wert: number }>('/api/ding')).resolves.toEqual({ wert: 42 });
  });

  it('wirft ApiError mit Server-Meldung bei Fehlerstatus', async () => {
    server.use(
      http.get('/api/ding', () => HttpResponse.json({ error: 'Nicht gefunden' }, { status: 404 })),
    );
    await expect(apiGet('/api/ding')).rejects.toMatchObject({
      name: 'ApiError',
      status: 404,
      message: 'Nicht gefunden',
    });
  });
});

describe('apiSend', () => {
  it('serialisiert den Body und liefert die Antwort', async () => {
    server.use(
      http.post('/api/ding', async ({ request }) => {
        const body = (await request.json()) as { name: string };
        return HttpResponse.json({ gruss: `Hallo ${body.name}` }, { status: 201 });
      }),
    );
    await expect(apiSend('/api/ding', 'POST', { name: 'Welt' })).resolves.toEqual({
      gruss: 'Hallo Welt',
    });
  });

  it('liefert undefined bei 204 ohne Body', async () => {
    server.use(http.post('/api/logout', () => new HttpResponse(null, { status: 204 })));
    await expect(apiSend('/api/logout', 'POST')).resolves.toBeUndefined();
  });

  it('wirft kein ApiError, sondern den nativen TypeError bei Netzwerkfehler', async () => {
    server.use(http.post('/api/ding', () => HttpResponse.error()));
    const fehler = await apiSend('/api/ding', 'POST', {}).catch((e) => e);
    expect(fehler).not.toBeInstanceOf(ApiError);
  });
});
```

- [ ] **Step 3: Test ausführen (muss fehlschlagen)**

```bash
cd frontend && npm run test -- src/api/client.test.ts
```
Erwartet: FAIL — `Cannot find module './client'`.

- [ ] **Step 4: API-Client implementieren**

`frontend/src/api/client.ts`:

```ts
/** Fehler einer API-Antwort mit Nicht-2xx-Status. Trägt den Statuscode und die
 *  Server-Meldung aus dem `{ error }`-Format. Netzwerkfehler werden NICHT hierin
 *  verpackt (sie bleiben native TypeErrors) — so kann der Offline-Puffer sie von
 *  echten fachlichen Ablehnungen unterscheiden. */
export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

async function fehlerWerfen(res: Response): Promise<never> {
  let message = `Serverfehler (${res.status})`;
  try {
    const body = (await res.json()) as { error?: unknown };
    if (typeof body.error === 'string') message = body.error;
  } catch {
    // keine JSON-Antwort — generische Meldung beibehalten
  }
  throw new ApiError(res.status, message);
}

export async function apiGet<T>(pfad: string): Promise<T> {
  const res = await fetch(pfad, { credentials: 'same-origin' });
  if (!res.ok) return fehlerWerfen(res);
  return (await res.json()) as T;
}

export async function apiSend<T>(pfad: string, methode: string, body?: unknown): Promise<T> {
  const res = await fetch(pfad, {
    method: methode,
    credentials: 'same-origin',
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) return fehlerWerfen(res);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}
```

- [ ] **Step 5: Test ausführen (muss bestehen)**

```bash
cd frontend && npm run test -- src/api/client.test.ts
```
Erwartet: PASS (4 Tests).

- [ ] **Step 6: Commit**

```bash
cd frontend && git add src/api/types.ts src/api/client.ts src/api/client.test.ts
git commit -m "feat(frontend): API-Client mit Fehlerformat-Parsing und DTO-Typen

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Auth-API + AuthContext

**Files:**
- Create: `frontend/src/api/auth.ts`, `frontend/src/auth/AuthContext.tsx`, `frontend/src/test/utils.tsx`
- Test: `frontend/src/auth/AuthContext.test.tsx`

- [ ] **Step 1: Auth-API-Funktionen schreiben**

`frontend/src/api/auth.ts`:

```ts
import type { BenutzerAnzeige } from './types';
import { apiGet, apiSend } from './client';

export function login(benutzername: string, passwort: string): Promise<BenutzerAnzeige> {
  return apiSend<BenutzerAnzeige>('/api/auth/login', 'POST', { benutzername, passwort });
}

export function logout(): Promise<void> {
  return apiSend<void>('/api/auth/logout', 'POST');
}

export function me(): Promise<BenutzerAnzeige> {
  return apiGet<BenutzerAnzeige>('/api/auth/me');
}
```

- [ ] **Step 2: Test-Render-Helper schreiben**

`frontend/src/test/utils.tsx`:

```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, type RenderOptions } from '@testing-library/react';
import { ConfigProvider } from 'antd';
import { MemoryRouter } from 'react-router-dom';
import type { ReactElement, ReactNode } from 'react';

/** Frischer QueryClient ohne Retries/Cache-Wiederverwendung — deterministische Tests. */
export function neuerQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
}

interface ProviderOptions extends Omit<RenderOptions, 'wrapper'> {
  route?: string;
  client?: QueryClient;
}

/** Rendert eine Komponente mit Query-, antd- und Router-Providern. */
export function renderMitProviders(ui: ReactElement, options: ProviderOptions = {}) {
  const client = options.client ?? neuerQueryClient();
  const route = options.route ?? '/';
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>
        <ConfigProvider>
          <MemoryRouter initialEntries={[route]}>{children}</MemoryRouter>
        </ConfigProvider>
      </QueryClientProvider>
    );
  }
  return { client, ...render(ui, { wrapper: Wrapper, ...options }) };
}
```

- [ ] **Step 3: Test für AuthContext schreiben**

`frontend/src/auth/AuthContext.test.tsx`:

```tsx
import { http, HttpResponse } from 'msw';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import { AuthProvider, useAuth } from './AuthContext';

function Anzeige() {
  const { benutzer, laedt, login, logout } = useAuth();
  if (laedt) return <div>lädt…</div>;
  return (
    <div>
      <span data-testid="name">{benutzer ? benutzer.anzeigename : 'anonym'}</span>
      <button onClick={() => login('admin', 'pw')}>login</button>
      <button onClick={() => logout()}>logout</button>
    </div>
  );
}

const adminBody = {
  id: 1,
  anzeigename: 'Admin',
  benutzername: 'admin',
  system_rolle: 'admin',
  org_rolle: 'keine',
  aktiv: true,
  erstellt_at: '2026-05-23 10:00:00',
};

describe('AuthContext', () => {
  it('zeigt anonym, wenn /me 401 liefert', async () => {
    server.use(http.get('/api/auth/me', () => HttpResponse.json({ error: 'x' }, { status: 401 })));
    renderMitProviders(
      <AuthProvider>
        <Anzeige />
      </AuthProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('name')).toHaveTextContent('anonym'));
  });

  it('übernimmt den Benutzer nach erfolgreichem Login', async () => {
    server.use(
      http.get('/api/auth/me', () => HttpResponse.json({ error: 'x' }, { status: 401 })),
      http.post('/api/auth/login', () => HttpResponse.json(adminBody)),
    );
    renderMitProviders(
      <AuthProvider>
        <Anzeige />
      </AuthProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('name')).toHaveTextContent('anonym'));
    await userEvent.click(screen.getByText('login'));
    await waitFor(() => expect(screen.getByTestId('name')).toHaveTextContent('Admin'));
  });
});
```

- [ ] **Step 4: Test ausführen (muss fehlschlagen)**

```bash
cd frontend && npm run test -- src/auth/AuthContext.test.tsx
```
Erwartet: FAIL — `Cannot find module './AuthContext'`.

- [ ] **Step 5: AuthContext implementieren**

`frontend/src/auth/AuthContext.tsx`:

```tsx
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { BenutzerAnzeige } from '../api/types';
import { ApiError } from '../api/client';
import * as authApi from '../api/auth';

interface AuthWert {
  benutzer: BenutzerAnzeige | null;
  laedt: boolean;
  login: (benutzername: string, passwort: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthWert | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [benutzer, setBenutzer] = useState<BenutzerAnzeige | null>(null);
  const [laedt, setLaedt] = useState(true);

  useEffect(() => {
    authApi
      .me()
      .then((b) => setBenutzer(b))
      .catch((e) => {
        // 401 = nicht angemeldet (erwartet); andere Fehler ebenfalls als „anonym" behandeln
        if (!(e instanceof ApiError)) console.error('Auth-Prüfung fehlgeschlagen', e);
        setBenutzer(null);
      })
      .finally(() => setLaedt(false));
  }, []);

  const login = useCallback(async (benutzername: string, passwort: string) => {
    const b = await authApi.login(benutzername, passwort);
    setBenutzer(b);
  }, []);

  const logout = useCallback(async () => {
    await authApi.logout();
    setBenutzer(null);
  }, []);

  const wert = useMemo<AuthWert>(
    () => ({ benutzer, laedt, login, logout }),
    [benutzer, laedt, login, logout],
  );

  return <AuthContext.Provider value={wert}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthWert {
  const wert = useContext(AuthContext);
  if (!wert) throw new Error('useAuth muss innerhalb von <AuthProvider> verwendet werden');
  return wert;
}
```

> **Achtung Tippfehler-Falle:** Der Import heißt `useCallback` (klein-c), nicht `useCallback` mit großem C — React exportiert `useCallback`. Falls der Test einen Import-Fehler zeigt, prüfe die Schreibweise der React-Hook-Importe (`useCallback`, `useContext`, `useEffect`, `useMemo`, `useState`).

- [ ] **Step 6: Test ausführen (muss bestehen)**

```bash
cd frontend && npm run test -- src/auth/AuthContext.test.tsx
```
Erwartet: PASS (2 Tests).

- [ ] **Step 7: Commit**

```bash
cd frontend && git add src/api/auth.ts src/auth/AuthContext.tsx src/test/utils.tsx src/auth/AuthContext.test.tsx
git commit -m "feat(frontend): AuthContext mit /me-Bootstrap, Login und Logout

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Routing, Login-Seite und Auth-Guard

**Files:**
- Create: `frontend/src/pages/LoginPage.tsx`, `frontend/src/routes/RequireAuth.tsx`
- Modify: `frontend/src/App.tsx` (Platzhalter ersetzen), `frontend/src/main.tsx` (Provider ergänzen)
- Test: `frontend/src/pages/LoginPage.test.tsx`

- [ ] **Step 1: Test für die Login-Seite schreiben**

`frontend/src/pages/LoginPage.test.tsx`:

```tsx
import { http, HttpResponse } from 'msw';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import { AuthProvider } from '../auth/AuthContext';
import LoginPage from './LoginPage';

function setup() {
  server.use(http.get('/api/auth/me', () => HttpResponse.json({ error: 'x' }, { status: 401 })));
  return renderMitProviders(
    <AuthProvider>
      <LoginPage />
    </AuthProvider>,
  );
}

describe('LoginPage', () => {
  it('zeigt eine Server-Fehlermeldung bei falschen Anmeldedaten', async () => {
    server.use(
      http.post('/api/auth/login', () =>
        HttpResponse.json({ error: 'Nicht angemeldet' }, { status: 401 }),
      ),
    );
    setup();
    await userEvent.type(screen.getByLabelText('Benutzername'), 'admin');
    await userEvent.type(screen.getByLabelText('Passwort'), 'falsch');
    await userEvent.click(screen.getByRole('button', { name: 'Anmelden' }));
    await waitFor(() => expect(screen.getByText('Nicht angemeldet')).toBeInTheDocument());
  });
});
```

- [ ] **Step 2: Test ausführen (muss fehlschlagen)**

```bash
cd frontend && npm run test -- src/pages/LoginPage.test.tsx
```
Erwartet: FAIL — `Cannot find module './LoginPage'`.

- [ ] **Step 3: Login-Seite implementieren**

`frontend/src/pages/LoginPage.tsx`:

```tsx
import { Alert, Button, Card, Form, Input, Typography } from 'antd';
import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ApiError } from '../api/client';
import { useAuth } from '../auth/AuthContext';

interface FormWerte {
  benutzername: string;
  passwort: string;
}

export default function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [fehler, setFehler] = useState<string | null>(null);
  const [laedt, setLaedt] = useState(false);

  const zielPfad = (location.state as { von?: string } | null)?.von ?? '/einsaetze';

  async function absenden(werte: FormWerte) {
    setFehler(null);
    setLaedt(true);
    try {
      await login(werte.benutzername, werte.passwort);
      navigate(zielPfad, { replace: true });
    } catch (e) {
      setFehler(e instanceof ApiError ? e.message : 'Verbindung zum Server fehlgeschlagen');
    } finally {
      setLaedt(false);
    }
  }

  return (
    <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 80 }}>
      <Card style={{ width: 360 }}>
        <Typography.Title level={3}>lifeline-hub</Typography.Title>
        {fehler && <Alert type="error" message={fehler} style={{ marginBottom: 16 }} showIcon />}
        <Form layout="vertical" onFinish={absenden} disabled={laedt}>
          <Form.Item
            label="Benutzername"
            name="benutzername"
            rules={[{ required: true, message: 'Bitte Benutzername eingeben' }]}
          >
            <Input autoFocus autoComplete="username" />
          </Form.Item>
          <Form.Item
            label="Passwort"
            name="passwort"
            rules={[{ required: true, message: 'Bitte Passwort eingeben' }]}
          >
            <Input.Password autoComplete="current-password" />
          </Form.Item>
          <Button type="primary" htmlType="submit" block loading={laedt}>
            Anmelden
          </Button>
        </Form>
      </Card>
    </div>
  );
}
```

> Hinweis: antd `Form.Item` mit `label` verknüpft das Label per `htmlFor` mit dem Feld → `getByLabelText('Benutzername')` funktioniert.

- [ ] **Step 4: Test ausführen (muss bestehen)**

```bash
cd frontend && npm run test -- src/pages/LoginPage.test.tsx
```
Erwartet: PASS (1 Test).

- [ ] **Step 5: Auth-Guard implementieren**

`frontend/src/routes/RequireAuth.tsx`:

```tsx
import { Spin } from 'antd';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';

/** Schützt verschachtelte Routen: leitet nicht angemeldete Nutzer nach /login um. */
export default function RequireAuth() {
  const { benutzer, laedt } = useAuth();
  const location = useLocation();

  if (laedt) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 120 }}>
        <Spin size="large" />
      </div>
    );
  }
  if (!benutzer) {
    return <Navigate to="/login" replace state={{ von: location.pathname }} />;
  }
  return <Outlet />;
}
```

- [ ] **Step 6: App-Router und Provider verdrahten**

`frontend/src/App.tsx` (ersetzt den Platzhalter vollständig):

```tsx
import { Navigate, Route, Routes } from 'react-router-dom';
import RequireAuth from './routes/RequireAuth';
import AppLayout from './components/AppLayout';
import LoginPage from './pages/LoginPage';
import EinsaetzePage from './pages/EinsaetzePage';
import EtbPage from './pages/EtbPage';
import BenutzerPage from './pages/BenutzerPage';

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<RequireAuth />}>
        <Route element={<AppLayout />}>
          <Route path="/einsaetze" element={<EinsaetzePage />} />
          <Route path="/einsaetze/:id/etb" element={<EtbPage />} />
          <Route path="/benutzer" element={<BenutzerPage />} />
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/einsaetze" replace />} />
    </Routes>
  );
}
```

> **Wichtig:** Dieser Router referenziert `AppLayout` (Task 5), `EinsaetzePage` (Task 6), `EtbPage` (Task 7+), `BenutzerPage` (Task 16). Damit das Projekt zwischen den Tasks kompiliert, leg beim Implementieren dieses Schritts **minimale Platzhalter-Dateien** für die noch nicht gebauten Seiten an (jeweils `export default function X(){ return <div/>; }`), die in den Folge-Tasks ersetzt werden. Lege an: `src/components/AppLayout.tsx`, `src/pages/EinsaetzePage.tsx`, `src/pages/EtbPage.tsx`, `src/pages/BenutzerPage.tsx`.

`frontend/src/main.tsx` (Provider ergänzen — ersetzt die bisherige Render-Struktur):

```tsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import { ConfigProvider, App as AntApp } from 'antd';
import deDE from 'antd/locale/de_DE';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router-dom';
import { registerSW } from 'virtual:pwa-register';
import App from './App';
import { theme } from './theme';
import { AuthProvider } from './auth/AuthContext';

registerSW({ immediate: true });

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false, staleTime: 10_000 } },
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <ConfigProvider locale={deDE} theme={theme}>
        <AntApp>
          <BrowserRouter>
            <AuthProvider>
              <App />
            </AuthProvider>
          </BrowserRouter>
        </AntApp>
      </ConfigProvider>
    </QueryClientProvider>
  </React.StrictMode>,
);
```

> `AntApp` (antd `App`-Wrapper) stellt `message`/`notification` mit Theme-Kontext bereit — wird ab Task 6 für `message.error` genutzt.

- [ ] **Step 7: Test + Typecheck ausführen**

```bash
cd frontend && npm run test && npm run typecheck
```
Erwartet: alle Tests grün; Typecheck ohne Fehler (Platzhalter-Seiten kompilieren).

- [ ] **Step 8: Commit**

```bash
cd frontend && git add src/App.tsx src/main.tsx src/pages/LoginPage.tsx src/pages/LoginPage.test.tsx src/routes/RequireAuth.tsx src/components/AppLayout.tsx src/pages/EinsaetzePage.tsx src/pages/EtbPage.tsx src/pages/BenutzerPage.tsx
git commit -m "feat(frontend): Routing, Login-Seite und Auth-Guard

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: AppLayout mit Topbar

**Files:**
- Modify: `frontend/src/components/AppLayout.tsx` (Platzhalter aus Task 4 ersetzen)
- Test: `frontend/src/components/AppLayout.test.tsx`

- [ ] **Step 1: Test für AppLayout schreiben**

`frontend/src/components/AppLayout.test.tsx`:

```tsx
import { http, HttpResponse } from 'msw';
import { screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Route, Routes } from 'react-router-dom';
import { server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import { AuthProvider } from '../auth/AuthContext';
import AppLayout from './AppLayout';

const admin = {
  id: 1,
  anzeigename: 'Chef',
  benutzername: 'chef',
  system_rolle: 'admin',
  org_rolle: 'keine',
  aktiv: true,
  erstellt_at: '2026-05-23 10:00:00',
};

describe('AppLayout', () => {
  it('zeigt den Namen des angemeldeten Nutzers und den Admin-Link', async () => {
    server.use(http.get('/api/auth/me', () => HttpResponse.json(admin)));
    renderMitProviders(
      <AuthProvider>
        <Routes>
          <Route element={<AppLayout />}>
            <Route path="/" element={<div>Inhalt</div>} />
          </Route>
        </Routes>
      </AuthProvider>,
    );
    await waitFor(() => expect(screen.getByText('Chef')).toBeInTheDocument());
    expect(screen.getByRole('link', { name: 'Benutzer' })).toBeInTheDocument();
    expect(screen.getByText('Inhalt')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Test ausführen (muss fehlschlagen)**

```bash
cd frontend && npm run test -- src/components/AppLayout.test.tsx
```
Erwartet: FAIL — Platzhalter zeigt weder „Chef" noch den Benutzer-Link.

- [ ] **Step 3: AppLayout implementieren**

`frontend/src/components/AppLayout.tsx`:

```tsx
import { Button, Layout, Space, Tag, Typography } from 'antd';
import { Link, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';

const { Header, Content } = Layout;

export default function AppLayout() {
  const { benutzer, logout } = useAuth();
  const navigate = useNavigate();

  async function abmelden() {
    await logout();
    navigate('/login', { replace: true });
  }

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Header style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        <Link to="/einsaetze" style={{ color: '#fff', fontWeight: 600, fontSize: 18 }}>
          lifeline-hub
        </Link>
        <Link to="/einsaetze" style={{ color: '#fff' }}>
          Einsätze
        </Link>
        {benutzer?.system_rolle === 'admin' && (
          <Link to="/benutzer" style={{ color: '#fff' }}>
            Benutzer
          </Link>
        )}
        <Space style={{ marginLeft: 'auto' }}>
          <Typography.Text style={{ color: '#fff' }}>{benutzer?.anzeigename}</Typography.Text>
          {benutzer?.system_rolle === 'admin' && <Tag color="gold">Admin</Tag>}
          <Button size="small" onClick={abmelden}>
            Abmelden
          </Button>
        </Space>
      </Header>
      <Content style={{ padding: 24 }}>
        <Outlet />
      </Content>
    </Layout>
  );
}
```

- [ ] **Step 4: Test ausführen (muss bestehen)**

```bash
cd frontend && npm run test -- src/components/AppLayout.test.tsx
```
Erwartet: PASS (1 Test).

- [ ] **Step 5: Commit**

```bash
cd frontend && git add src/components/AppLayout.tsx src/components/AppLayout.test.tsx
git commit -m "feat(frontend): AppLayout mit Topbar (Nutzer, Rolle, Logout)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Einsatz-API + Einsatzauswahl-Seite (Liste + Anlegen)

**Files:**
- Create: `frontend/src/api/einsaetze.ts`
- Modify: `frontend/src/pages/EinsaetzePage.tsx` (Platzhalter ersetzen)
- Test: `frontend/src/pages/EinsaetzePage.test.tsx`

- [ ] **Step 1: Einsatz-API-Modul schreiben** (komplett — wird auch in Tasks 15/16 genutzt)

`frontend/src/api/einsaetze.ts`:

```ts
import type { EinsatzAnzeige, EinsatzRolle, MitgliedAnzeige } from './types';
import { apiGet, apiSend } from './client';

export function listeEinsaetze(): Promise<EinsatzAnzeige[]> {
  return apiGet<EinsatzAnzeige[]>('/api/einsaetze');
}

export function ladeEinsatz(id: number): Promise<EinsatzAnzeige> {
  return apiGet<EinsatzAnzeige>(`/api/einsaetze/${id}`);
}

export function legeEinsatzAn(bezeichnung: string, stichwort?: string): Promise<EinsatzAnzeige> {
  return apiSend<EinsatzAnzeige>('/api/einsaetze', 'POST', { bezeichnung, stichwort });
}

export function schliesseEinsatzAb(id: number): Promise<EinsatzAnzeige> {
  return apiSend<EinsatzAnzeige>(`/api/einsaetze/${id}/abschliessen`, 'POST');
}

export function ladeMitglieder(id: number): Promise<MitgliedAnzeige[]> {
  return apiGet<MitgliedAnzeige[]>(`/api/einsaetze/${id}/mitglieder`);
}

export function setzeMitglied(
  id: number,
  benutzerId: number,
  rolle: EinsatzRolle,
): Promise<MitgliedAnzeige[]> {
  return apiSend<MitgliedAnzeige[]>(`/api/einsaetze/${id}/mitglieder/${benutzerId}`, 'PUT', {
    einsatz_rolle: rolle,
  });
}

export function entferneMitglied(id: number, benutzerId: number): Promise<MitgliedAnzeige[]> {
  return apiSend<MitgliedAnzeige[]>(`/api/einsaetze/${id}/mitglieder/${benutzerId}`, 'DELETE');
}
```

- [ ] **Step 2: Test für die Einsatzauswahl-Seite schreiben**

`frontend/src/pages/EinsaetzePage.test.tsx`:

```tsx
import { http, HttpResponse } from 'msw';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import { AuthProvider } from '../auth/AuthContext';
import EinsaetzePage from './EinsaetzePage';

const admin = {
  id: 1,
  anzeigename: 'Admin',
  benutzername: 'admin',
  system_rolle: 'admin',
  org_rolle: 'keine',
  aktiv: true,
  erstellt_at: '2026-05-23 10:00:00',
};

function einsatz(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: 7,
    bezeichnung: 'Hochwasser Nord',
    stichwort: 'THW',
    status: 'aktiv',
    begonnen_at: '2026-05-23 09:00:00',
    abgeschlossen_at: null,
    abgeschlossen_von: null,
    meine_rolle: 'einsatzleitung',
    ...over,
  };
}

function setup() {
  server.use(http.get('/api/auth/me', () => HttpResponse.json(admin)));
  return renderMitProviders(
    <AuthProvider>
      <EinsaetzePage />
    </AuthProvider>,
  );
}

describe('EinsaetzePage', () => {
  it('listet Einsätze mit Bezeichnung und eigener Rolle', async () => {
    server.use(http.get('/api/einsaetze', () => HttpResponse.json([einsatz()])));
    setup();
    await waitFor(() => expect(screen.getByText('Hochwasser Nord')).toBeInTheDocument());
    expect(screen.getByText('einsatzleitung')).toBeInTheDocument();
  });

  it('legt einen neuen Einsatz an und zeigt ihn danach in der Liste', async () => {
    let angelegt = false;
    server.use(
      http.get('/api/einsaetze', () =>
        HttpResponse.json(angelegt ? [einsatz({ bezeichnung: 'Sturm Süd' })] : []),
      ),
      http.post('/api/einsaetze', async () => {
        angelegt = true;
        return HttpResponse.json(einsatz({ bezeichnung: 'Sturm Süd' }), { status: 201 });
      }),
    );
    setup();
    await userEvent.click(await screen.findByRole('button', { name: 'Einsatz anlegen' }));
    await userEvent.type(screen.getByLabelText('Bezeichnung'), 'Sturm Süd');
    await userEvent.click(screen.getByRole('button', { name: 'Anlegen' }));
    await waitFor(() => expect(screen.getByText('Sturm Süd')).toBeInTheDocument());
  });
});
```

- [ ] **Step 3: Test ausführen (muss fehlschlagen)**

```bash
cd frontend && npm run test -- src/pages/EinsaetzePage.test.tsx
```
Erwartet: FAIL — Platzhalter rendert keine Liste.

- [ ] **Step 4: Einsatzauswahl-Seite implementieren**

`frontend/src/pages/EinsaetzePage.tsx`:

```tsx
import { App, Button, Form, Input, List, Modal, Space, Tag, Typography } from 'antd';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { EinsatzAnzeige } from '../api/types';
import { ApiError } from '../api/client';
import { legeEinsatzAn, listeEinsaetze } from '../api/einsaetze';
import { useAuth } from '../auth/AuthContext';

const STATUS_FARBE: Record<string, string> = { aktiv: 'green', abgeschlossen: 'default' };

export default function EinsaetzePage() {
  const navigate = useNavigate();
  const { benutzer } = useAuth();
  const { message } = App.useApp();
  const qc = useQueryClient();
  const [dialogOffen, setDialogOffen] = useState(false);
  const [form] = Form.useForm<{ bezeichnung: string; stichwort?: string }>();

  const darfAnlegen = benutzer?.system_rolle === 'admin' || benutzer?.org_rolle === 'fuehrungskraft';

  const { data: einsaetze = [], isLoading } = useQuery({
    queryKey: ['einsaetze'],
    queryFn: listeEinsaetze,
  });

  const anlegen = useMutation({
    mutationFn: (werte: { bezeichnung: string; stichwort?: string }) =>
      legeEinsatzAn(werte.bezeichnung, werte.stichwort),
    onSuccess: () => {
      setDialogOffen(false);
      form.resetFields();
      qc.invalidateQueries({ queryKey: ['einsaetze'] });
    },
    onError: (e) =>
      message.error(e instanceof ApiError ? e.message : 'Einsatz konnte nicht angelegt werden'),
  });

  return (
    <div style={{ maxWidth: 800, margin: '0 auto' }}>
      <Space style={{ width: '100%', justifyContent: 'space-between', marginBottom: 16 }}>
        <Typography.Title level={3} style={{ margin: 0 }}>
          Einsätze
        </Typography.Title>
        {darfAnlegen && (
          <Button type="primary" onClick={() => setDialogOffen(true)}>
            Einsatz anlegen
          </Button>
        )}
      </Space>

      <List
        loading={isLoading}
        bordered
        dataSource={einsaetze}
        locale={{ emptyText: 'Keine Einsätze' }}
        renderItem={(e: EinsatzAnzeige) => (
          <List.Item
            actions={[
              <Button key="oeffnen" type="link" onClick={() => navigate(`/einsaetze/${e.id}/etb`)}>
                Öffnen
              </Button>,
            ]}
          >
            <List.Item.Meta
              title={e.bezeichnung}
              description={
                <Space>
                  <Tag color={STATUS_FARBE[e.status]}>{e.status}</Tag>
                  {e.stichwort && <span>{e.stichwort}</span>}
                  {e.meine_rolle && <Tag>{e.meine_rolle}</Tag>}
                </Space>
              }
            />
          </List.Item>
        )}
      />

      <Modal
        title="Neuen Einsatz anlegen"
        open={dialogOffen}
        onCancel={() => setDialogOffen(false)}
        onOk={() => form.submit()}
        okText="Anlegen"
        confirmLoading={anlegen.isPending}
      >
        <Form form={form} layout="vertical" onFinish={(w) => anlegen.mutate(w)}>
          <Form.Item
            label="Bezeichnung"
            name="bezeichnung"
            rules={[{ required: true, message: 'Bitte Bezeichnung eingeben' }]}
          >
            <Input autoFocus />
          </Form.Item>
          <Form.Item label="Stichwort" name="stichwort">
            <Input placeholder="optional, z.B. THW / RD" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
```

> Da die Seite `App.useApp()` nutzt, muss sie unter dem antd-`App`-Wrapper laufen. Ergänze in `src/test/utils.tsx` den Wrapper: importiere `App as AntApp` aus `antd` und umschließe `children` in `<AntApp>…</AntApp>` innerhalb des `ConfigProvider`. (Einmalige Anpassung; danach gilt sie für alle Tests.)

- [ ] **Step 5: test/utils.tsx um den antd-App-Wrapper ergänzen**

Bearbeite `frontend/src/test/utils.tsx` — Import und Wrapper:

```tsx
import { App as AntApp, ConfigProvider } from 'antd';
```
und im `Wrapper` den `ConfigProvider`-Inhalt umschließen:

```tsx
    return (
      <QueryClientProvider client={client}>
        <ConfigProvider>
          <AntApp>
            <MemoryRouter initialEntries={[route]}>{children}</MemoryRouter>
          </AntApp>
        </ConfigProvider>
      </QueryClientProvider>
    );
```

- [ ] **Step 6: Test ausführen (muss bestehen)**

```bash
cd frontend && npm run test -- src/pages/EinsaetzePage.test.tsx
```
Erwartet: PASS (2 Tests).

- [ ] **Step 7: Commit**

```bash
cd frontend && git add src/api/einsaetze.ts src/pages/EinsaetzePage.tsx src/pages/EinsaetzePage.test.tsx src/test/utils.tsx
git commit -m "feat(frontend): Einsatz-API und Einsatzauswahl-Seite mit Anlegen

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: ETB-API, Tabelle (Typ-Farben + ⧖) und EtbPage mit Pagination

**Files:**
- Create: `frontend/src/api/etb.ts`, `frontend/src/etb/typFarben.ts`, `frontend/src/etb/EtbTabelle.tsx`
- Modify: `frontend/src/pages/EtbPage.tsx` (Platzhalter ersetzen)
- Test: `frontend/src/etb/typFarben.test.ts`, `frontend/src/etb/EtbTabelle.test.tsx`, `frontend/src/pages/EtbPage.test.tsx`

- [ ] **Step 1: ETB-API-Modul schreiben** (Liste/Erfassen + Query-Param-Bau; `erfasseEtb`/`NeuerEintrag` werden ab Task 10 genutzt)

`frontend/src/api/etb.ts`:

```ts
import type { EtbEintragAnzeige, EtbTyp, MeldeWeg } from './types';
import { apiGet, apiSend } from './client';

export const SEITENGROESSE = 100;

export interface EtbFilterWerte {
  q?: string;
  typ?: EtbTyp;
  von?: string;
  bis?: string;
  erfasser_id?: number;
}

export interface EtbAbfrage extends EtbFilterWerte {
  before_lfd_nr?: number;
  limit?: number;
}

export function listeEtb(einsatzId: number, params: EtbAbfrage = {}): Promise<EtbEintragAnzeige[]> {
  const qs = new URLSearchParams();
  if (params.q) qs.set('q', params.q);
  if (params.typ) qs.set('typ', params.typ);
  if (params.von) qs.set('von', params.von);
  if (params.bis) qs.set('bis', params.bis);
  if (params.erfasser_id != null) qs.set('erfasser_id', String(params.erfasser_id));
  if (params.before_lfd_nr != null) qs.set('before_lfd_nr', String(params.before_lfd_nr));
  qs.set('limit', String(params.limit ?? SEITENGROESSE));
  return apiGet<EtbEintragAnzeige[]>(`/api/einsaetze/${einsatzId}/etb?${qs.toString()}`);
}

export interface NeuerEintrag {
  typ: EtbTyp;
  inhalt: string;
  von?: string;
  an?: string;
  meldeweg?: MeldeWeg;
  veranlassung?: string;
  ereigniszeit?: string;
  erfasst_lokal_at?: string;
  berichtigt_eintrag_id?: number;
}

export function erfasseEtb(einsatzId: number, eintrag: NeuerEintrag): Promise<EtbEintragAnzeige> {
  return apiSend<EtbEintragAnzeige>(`/api/einsaetze/${einsatzId}/etb`, 'POST', eintrag);
}
```

- [ ] **Step 2: Test für typFarben/istNachgetragen schreiben**

`frontend/src/etb/typFarben.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { ERFASSBARE_TYPEN, TYP_FARBE, TYP_LABEL, istNachgetragen } from './typFarben';

describe('typFarben', () => {
  it('hat Label und Farbe für jeden erfassbaren Typ', () => {
    expect(TYP_LABEL.meldung).toBe('Meldung');
    expect(TYP_FARBE.berichtigung).toBeTruthy();
  });

  it('schließt system aus den erfassbaren Typen aus', () => {
    expect(ERFASSBARE_TYPEN).not.toContain('system');
    expect(ERFASSBARE_TYPEN).toContain('meldung');
  });
});

describe('istNachgetragen', () => {
  it('false bei kleiner Latenz (< 60 s)', () => {
    expect(istNachgetragen('2026-05-23 10:00:00', '2026-05-23 10:00:03')).toBe(false);
  });

  it('true bei spürbarer Abweichung (>= 60 s)', () => {
    expect(istNachgetragen('2026-05-23 09:30:00', '2026-05-23 10:00:00')).toBe(true);
  });
});
```

- [ ] **Step 3: typFarben implementieren**

`frontend/src/etb/typFarben.ts`:

```ts
import type { EtbTyp } from '../api/types';

export const TYP_LABEL: Record<EtbTyp, string> = {
  meldung: 'Meldung',
  anordnung: 'Anordnung',
  lage: 'Lage',
  entscheidung: 'Entscheidung',
  system: 'System',
  berichtigung: 'Berichtigung',
};

export const TYP_FARBE: Record<EtbTyp, string> = {
  meldung: 'blue',
  anordnung: 'orange',
  lage: 'cyan',
  entscheidung: 'purple',
  system: 'default',
  berichtigung: 'red',
};

/** Vom Client manuell erfassbare Typen (Backend lehnt 'system' und Reihenfolge ab). */
export const ERFASSBARE_TYPEN: EtbTyp[] = ['meldung', 'anordnung', 'lage', 'entscheidung'];

/** UTC-SQLite-String 'YYYY-MM-DD HH:MM:SS' → Millisekunden seit Epoch. */
function alsMillis(zeit: string): number {
  return Date.parse(zeit.replace(' ', 'T') + 'Z');
}

/** Schwelle, ab der ereigniszeit als „nachgetragen/gepuffert" gilt. */
export const NACHTRAG_SCHWELLE_MS = 60_000;

/** Ob ereigniszeit spürbar (>= 60 s) vom Server-Empfang abweicht. Schwelle, damit
 *  normale Live-Latenz nicht jeden Eintrag mit ⧖ markiert (Spec §11). */
export function istNachgetragen(ereigniszeit: string, receivedAt: string): boolean {
  const diff = Math.abs(alsMillis(receivedAt) - alsMillis(ereigniszeit));
  return Number.isFinite(diff) && diff >= NACHTRAG_SCHWELLE_MS;
}
```

- [ ] **Step 4: typFarben-Test ausführen (rot → grün)**

```bash
cd frontend && npm run test -- src/etb/typFarben.test.ts
```
Erwartet: zuerst FAIL (Modul fehlt), nach Step 3 PASS (4 Tests).

- [ ] **Step 5: Test für EtbTabelle schreiben**

`frontend/src/etb/EtbTabelle.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { EtbEintragAnzeige } from '../api/types';
import EtbTabelle from './EtbTabelle';

function eintrag(over: Partial<EtbEintragAnzeige> = {}): EtbEintragAnzeige {
  return {
    id: 1,
    lfd_nr: 1,
    typ: 'meldung',
    inhalt: 'Lage erkundet',
    von: 'ELW',
    an: 'Leitstelle',
    meldeweg: 'funk',
    veranlassung: null,
    erfasser_id: 1,
    erfasser_name: 'Max',
    ereigniszeit: '2026-05-23 10:00:00',
    received_at: '2026-05-23 10:00:02',
    erfasst_lokal_at: null,
    berichtigt_eintrag_id: null,
    ...over,
  };
}

describe('EtbTabelle', () => {
  it('zeigt Inhalt, Typ-Label und Von→An', () => {
    render(<EtbTabelle eintraege={[eintrag()]} />);
    expect(screen.getByText('Lage erkundet')).toBeInTheDocument();
    expect(screen.getByText('Meldung')).toBeInTheDocument();
    expect(screen.getByText(/ELW/)).toBeInTheDocument();
  });

  it('markiert nachgetragene Einträge mit ⧖', () => {
    render(
      <EtbTabelle
        eintraege={[eintrag({ ereigniszeit: '2026-05-23 09:00:00', received_at: '2026-05-23 10:00:00' })]}
      />,
    );
    expect(screen.getByText('⧖')).toBeInTheDocument();
  });

  it('zeigt KEIN ⧖ bei normaler Latenz', () => {
    render(<EtbTabelle eintraege={[eintrag()]} />);
    expect(screen.queryByText('⧖')).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 6: EtbTabelle implementieren**

`frontend/src/etb/EtbTabelle.tsx`:

```tsx
import { Button, Space, Table, Tag, Tooltip } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import type { EtbEintragAnzeige } from '../api/types';
import { TYP_FARBE, TYP_LABEL, istNachgetragen } from './typFarben';

interface Props {
  eintraege: EtbEintragAnzeige[];
  /** Wenn gesetzt, erscheint je Eintrag eine „Berichtigen"-Aktion. */
  onBerichtigen?: (eintrag: EtbEintragAnzeige) => void;
}

export default function EtbTabelle({ eintraege, onBerichtigen }: Props) {
  // Map id → lfd_nr, um Berichtigungs-Ziele auf ihre laufende Nummer aufzulösen (Task 8).
  const lfdNrVonId = new Map(eintraege.map((e) => [e.id, e.lfd_nr]));

  const spalten: ColumnsType<EtbEintragAnzeige> = [
    { title: 'Nr.', dataIndex: 'lfd_nr', width: 64 },
    {
      title: 'Ereigniszeit',
      key: 'ereigniszeit',
      width: 180,
      render: (_, e) => (
        <Space size={4}>
          <span>{e.ereigniszeit}</span>
          {istNachgetragen(e.ereigniszeit, e.received_at) && (
            <Tooltip title={`Nachgetragen — Server-Empfang: ${e.received_at}`}>
              <span aria-label="nachgetragen">⧖</span>
            </Tooltip>
          )}
        </Space>
      ),
    },
    {
      title: 'Typ',
      dataIndex: 'typ',
      width: 130,
      render: (_, e) => <Tag color={TYP_FARBE[e.typ]}>{TYP_LABEL[e.typ]}</Tag>,
    },
    {
      title: 'Von → An',
      key: 'vonan',
      width: 160,
      render: (_, e) => (e.von || e.an ? `${e.von ?? '—'} → ${e.an ?? '—'}` : '—'),
    },
    {
      title: 'Inhalt',
      dataIndex: 'inhalt',
      render: (_, e) => (
        <span>
          {e.typ === 'berichtigung' && e.berichtigt_eintrag_id != null && (
            <Tag color="red">berichtigt #{lfdNrVonId.get(e.berichtigt_eintrag_id) ?? '?'}</Tag>
          )}
          {e.inhalt}
        </span>
      ),
    },
    { title: 'Erfasser', dataIndex: 'erfasser_name', width: 120 },
  ];

  if (onBerichtigen) {
    spalten.push({
      title: '',
      key: 'aktion',
      width: 110,
      render: (_, e) =>
        e.typ === 'berichtigung' ? null : (
          <Button type="link" size="small" onClick={() => onBerichtigen(e)}>
            Berichtigen
          </Button>
        ),
    });
  }

  return (
    <Table
      rowKey="id"
      size="small"
      columns={spalten}
      dataSource={eintraege}
      pagination={false}
      rowClassName={(e) => (e.typ === 'berichtigung' ? 'etb-berichtigung' : '')}
    />
  );
}
```

> Die optische Hervorhebung über `rowClassName="etb-berichtigung"` wird in Task 8 mit CSS hinterlegt; die Verknüpfungs-Tags (`berichtigt #N` / `berichtigt durch #N`) ebenfalls dort vervollständigt. Hier bereits enthalten ist die Richtung „Berichtigung → Original".

- [ ] **Step 7: EtbTabelle-Test ausführen (rot → grün)**

```bash
cd frontend && npm run test -- src/etb/EtbTabelle.test.tsx
```
Erwartet: PASS (3 Tests).

- [ ] **Step 8: Test für EtbPage schreiben**

`frontend/src/pages/EtbPage.test.tsx`:

```tsx
import { http, HttpResponse } from 'msw';
import { screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Route, Routes } from 'react-router-dom';
import { server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import { AuthProvider } from '../auth/AuthContext';
import EtbPage from './EtbPage';

const admin = {
  id: 1, anzeigename: 'Admin', benutzername: 'admin', system_rolle: 'admin',
  org_rolle: 'keine', aktiv: true, erstellt_at: '2026-05-23 10:00:00',
};
const einsatz = {
  id: 7, bezeichnung: 'Hochwasser Nord', stichwort: 'THW', status: 'aktiv',
  begonnen_at: '2026-05-23 09:00:00', abgeschlossen_at: null, abgeschlossen_von: null,
  meine_rolle: 'einsatzleitung',
};
const eintrag = {
  id: 1, lfd_nr: 1, typ: 'meldung', inhalt: 'Erste Meldung', von: null, an: null,
  meldeweg: null, veranlassung: null, erfasser_id: 1, erfasser_name: 'Admin',
  ereigniszeit: '2026-05-23 10:00:00', received_at: '2026-05-23 10:00:01',
  erfasst_lokal_at: null, berichtigt_eintrag_id: null,
};

function setup() {
  server.use(
    http.get('/api/auth/me', () => HttpResponse.json(admin)),
    http.get('/api/einsaetze/7', () => HttpResponse.json(einsatz)),
    http.get('/api/einsaetze/7/etb', () => HttpResponse.json([eintrag])),
  );
  return renderMitProviders(
    <AuthProvider>
      <Routes>
        <Route path="/einsaetze/:id/etb" element={<EtbPage />} />
      </Routes>
    </AuthProvider>,
    { route: '/einsaetze/7/etb' },
  );
}

describe('EtbPage', () => {
  it('zeigt Einsatz-Bezeichnung und ETB-Einträge', async () => {
    setup();
    await waitFor(() => expect(screen.getByText('Hochwasser Nord')).toBeInTheDocument());
    expect(await screen.findByText('Erste Meldung')).toBeInTheDocument();
  });
});
```

- [ ] **Step 9: EtbPage implementieren** (Infinite-Query + „Ältere laden")

`frontend/src/pages/EtbPage.tsx`:

```tsx
import { Alert, Button, Space, Spin, Tag, Typography } from 'antd';
import { Link, useParams } from 'react-router-dom';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { ladeEinsatz } from '../api/einsaetze';
import { SEITENGROESSE, listeEtb, type EtbFilterWerte } from '../api/etb';
import { useState } from 'react';
import EtbTabelle from '../etb/EtbTabelle';

export default function EtbPage() {
  const { id } = useParams();
  const einsatzId = Number(id);
  const [filter] = useState<EtbFilterWerte>({});

  const einsatzQuery = useQuery({
    queryKey: ['einsatz', einsatzId],
    queryFn: () => ladeEinsatz(einsatzId),
  });

  const etbQuery = useInfiniteQuery({
    queryKey: ['etb', einsatzId, filter],
    queryFn: ({ pageParam }) => listeEtb(einsatzId, { ...filter, before_lfd_nr: pageParam }),
    initialPageParam: undefined as number | undefined,
    getNextPageParam: (letzteSeite) =>
      letzteSeite.length === SEITENGROESSE
        ? letzteSeite[letzteSeite.length - 1].lfd_nr
        : undefined,
  });

  const eintraege = etbQuery.data?.pages.flat() ?? [];

  if (einsatzQuery.isLoading) {
    return (
      <div style={{ textAlign: 'center', paddingTop: 80 }}>
        <Spin size="large" />
      </div>
    );
  }
  if (einsatzQuery.isError || !einsatzQuery.data) {
    return <Alert type="error" message="Einsatz nicht gefunden oder kein Zugriff" showIcon />;
  }
  const einsatz = einsatzQuery.data;

  return (
    <div>
      <Space style={{ width: '100%', justifyContent: 'space-between', marginBottom: 16 }}>
        <Space>
          <Link to="/einsaetze">← Einsätze</Link>
          <Typography.Title level={3} style={{ margin: 0 }}>
            {einsatz.bezeichnung}
          </Typography.Title>
          <Tag color={einsatz.status === 'aktiv' ? 'green' : 'default'}>{einsatz.status}</Tag>
        </Space>
      </Space>

      <EtbTabelle eintraege={eintraege} />

      {etbQuery.hasNextPage && (
        <div style={{ textAlign: 'center', marginTop: 12 }}>
          <Button onClick={() => etbQuery.fetchNextPage()} loading={etbQuery.isFetchingNextPage}>
            Ältere laden
          </Button>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 10: EtbPage-Test ausführen + Gesamtsuite**

```bash
cd frontend && npm run test
```
Erwartet: alle Tests grün (inkl. neuer EtbPage-Test).

- [ ] **Step 11: Commit**

```bash
cd frontend && git add src/api/etb.ts src/etb/typFarben.ts src/etb/typFarben.test.ts src/etb/EtbTabelle.tsx src/etb/EtbTabelle.test.tsx src/pages/EtbPage.tsx src/pages/EtbPage.test.tsx
git commit -m "feat(frontend): ETB-Tabelle mit Typ-Farben/⧖ und paginierter EtbPage

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: Berichtigungs-Verknüpfung (beidseitig sichtbar + Hervorhebung)

**Files:**
- Modify: `frontend/src/etb/EtbTabelle.tsx` (Rückverweis „berichtigt durch #N" ergänzen)
- Create: `frontend/src/index.css`
- Modify: `frontend/src/main.tsx` (CSS importieren)
- Test: `frontend/src/etb/EtbTabelle.test.tsx` (Fall ergänzen)

- [ ] **Step 1: Failing-Test für den Rückverweis ergänzen**

Ergänze in `frontend/src/etb/EtbTabelle.test.tsx` einen weiteren Fall (innerhalb des `describe('EtbTabelle', …)`-Blocks):

```tsx
  it('verknüpft Original und Berichtigung in beide Richtungen', () => {
    const original = eintrag({ id: 1, lfd_nr: 1, inhalt: 'Falsche Lage' });
    const korrektur = eintrag({
      id: 2,
      lfd_nr: 2,
      typ: 'berichtigung',
      inhalt: 'Korrektur',
      berichtigt_eintrag_id: 1,
    });
    render(<EtbTabelle eintraege={[korrektur, original]} />);
    expect(screen.getByText('berichtigt #1')).toBeInTheDocument();
    expect(screen.getByText('berichtigt durch #2')).toBeInTheDocument();
  });
```

- [ ] **Step 2: Test ausführen (muss fehlschlagen)**

```bash
cd frontend && npm run test -- src/etb/EtbTabelle.test.tsx
```
Erwartet: FAIL — „berichtigt durch #2" fehlt noch.

- [ ] **Step 3: Rückverweis in EtbTabelle implementieren**

Ergänze in `frontend/src/etb/EtbTabelle.tsx` direkt nach der Zeile mit `lfdNrVonId` eine Rückwärts-Map (Original-id → lfd_nr der Berichtigung):

```tsx
  // Map Original-id → lfd_nr der Berichtigung, für den Rückverweis am Originaleintrag.
  const berichtigtDurch = new Map<number, number>();
  for (const e of eintraege) {
    if (e.typ === 'berichtigung' && e.berichtigt_eintrag_id != null) {
      berichtigtDurch.set(e.berichtigt_eintrag_id, e.lfd_nr);
    }
  }
```

Erweitere die `Inhalt`-Spalte (`render`) so, dass am Originaleintrag der Rückverweis erscheint:

```tsx
    {
      title: 'Inhalt',
      dataIndex: 'inhalt',
      render: (_, e) => (
        <span>
          {e.typ === 'berichtigung' && e.berichtigt_eintrag_id != null && (
            <Tag color="red">berichtigt #{lfdNrVonId.get(e.berichtigt_eintrag_id) ?? '?'}</Tag>
          )}
          {berichtigtDurch.has(e.id) && (
            <Tag color="gold">berichtigt durch #{berichtigtDurch.get(e.id)}</Tag>
          )}
          {e.inhalt}
        </span>
      ),
    },
```

- [ ] **Step 4: Optische Hervorhebung (CSS) anlegen und einbinden**

`frontend/src/index.css`:

```css
.etb-berichtigung > td {
  background-color: #fff1f0;
}
```

In `frontend/src/main.tsx` als ersten Import ergänzen:

```tsx
import './index.css';
```

- [ ] **Step 5: Test ausführen (muss bestehen)**

```bash
cd frontend && npm run test -- src/etb/EtbTabelle.test.tsx
```
Erwartet: PASS (jetzt 4 Tests).

- [ ] **Step 6: Commit**

```bash
cd frontend && git add src/etb/EtbTabelle.tsx src/etb/EtbTabelle.test.tsx src/index.css src/main.tsx
git commit -m "feat(frontend): Berichtigungen beidseitig verknüpft und hervorgehoben

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: Such- und Filterleiste

**Files:**
- Create: `frontend/src/etb/EtbFilterleiste.tsx`
- Modify: `frontend/src/pages/EtbPage.tsx` (Filter-State an die Query koppeln)
- Test: `frontend/src/etb/EtbFilterleiste.test.tsx`

- [ ] **Step 1: Test für die Filterleiste schreiben**

`frontend/src/etb/EtbFilterleiste.test.tsx`:

```tsx
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { EtbFilterWerte } from '../api/etb';
import EtbFilterleiste from './EtbFilterleiste';

describe('EtbFilterleiste', () => {
  it('meldet einen Suchbegriff an onChange', async () => {
    const onChange = vi.fn<(w: EtbFilterWerte) => void>();
    render(<EtbFilterleiste onChange={onChange} />);
    await userEvent.type(screen.getByPlaceholderText('Volltextsuche'), 'pumpe');
    await waitFor(() => expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ q: 'pumpe' })));
  });
});
```

- [ ] **Step 2: Test ausführen (muss fehlschlagen)**

```bash
cd frontend && npm run test -- src/etb/EtbFilterleiste.test.tsx
```
Erwartet: FAIL — `Cannot find module './EtbFilterleiste'`.

- [ ] **Step 3: Filterleiste implementieren**

`frontend/src/etb/EtbFilterleiste.tsx`:

```tsx
import { DatePicker, Input, Select, Space } from 'antd';
import dayjs from 'dayjs';
import { useState } from 'react';
import type { EtbFilterWerte } from '../api/etb';
import type { EtbTyp } from '../api/types';
import { TYP_LABEL } from './typFarben';

interface Props {
  onChange: (werte: EtbFilterWerte) => void;
}

const TYP_OPTIONEN = (Object.keys(TYP_LABEL) as EtbTyp[]).map((t) => ({
  value: t,
  label: TYP_LABEL[t],
}));

/** Wandelt einen dayjs-Zeitpunkt ins SQLite-/Backend-Format (UTC). */
function alsBackendZeit(d: dayjs.Dayjs): string {
  return d.utc().format('YYYY-MM-DD HH:mm:ss');
}

export default function EtbFilterleiste({ onChange }: Props) {
  const [werte, setWerte] = useState<EtbFilterWerte>({});

  function aktualisiere(teil: Partial<EtbFilterWerte>) {
    const neu = { ...werte, ...teil };
    // Leere Strings/undefined entfernen, damit keine leeren Query-Parameter entstehen.
    (Object.keys(neu) as (keyof EtbFilterWerte)[]).forEach((k) => {
      if (neu[k] === undefined || neu[k] === '') delete neu[k];
    });
    setWerte(neu);
    onChange(neu);
  }

  return (
    <Space wrap style={{ marginBottom: 16 }}>
      <Input.Search
        placeholder="Volltextsuche"
        allowClear
        style={{ width: 220 }}
        onChange={(e) => aktualisiere({ q: e.target.value })}
      />
      <Select
        placeholder="Typ"
        allowClear
        style={{ width: 150 }}
        options={TYP_OPTIONEN}
        onChange={(v?: EtbTyp) => aktualisiere({ typ: v })}
      />
      <DatePicker
        showTime
        placeholder="von"
        onChange={(d) => aktualisiere({ von: d ? alsBackendZeit(d) : undefined })}
      />
      <DatePicker
        showTime
        placeholder="bis"
        onChange={(d) => aktualisiere({ bis: d ? alsBackendZeit(d) : undefined })}
      />
    </Space>
  );
}
```

> **Setup-Hinweis (einmalig):** `dayjs.utc()` benötigt das UTC-Plugin. Ergänze in `frontend/src/main.tsx` (vor dem Render) folgende beiden Zeilen und aktiviere das Plugin:
> ```tsx
> import dayjs from 'dayjs';
> import utc from 'dayjs/plugin/utc';
> dayjs.extend(utc);
> ```
> Damit der Vitest-Lauf der Filterleiste das Plugin ebenfalls geladen hat, füge dieselbe Aktivierung am Ende von `frontend/src/test/setup.ts` hinzu:
> ```ts
> import dayjs from 'dayjs';
> import utc from 'dayjs/plugin/utc';
> dayjs.extend(utc);
> ```

- [ ] **Step 4: Test ausführen (muss bestehen)**

```bash
cd frontend && npm run test -- src/etb/EtbFilterleiste.test.tsx
```
Erwartet: PASS (1 Test).

- [ ] **Step 5: Filterleiste in EtbPage einbinden**

Ersetze in `frontend/src/pages/EtbPage.tsx` die State-Zeile und ergänze das Rendering:

State (statt `const [filter] = useState…`):

```tsx
  const [filter, setFilter] = useState<EtbFilterWerte>({});
```

Import ergänzen:

```tsx
import EtbFilterleiste from '../etb/EtbFilterleiste';
```

Und vor `<EtbTabelle …>` einsetzen:

```tsx
      <EtbFilterleiste onChange={setFilter} />
```

> Die `queryKey: ['etb', einsatzId, filter]` enthält bereits `filter` — eine Filteränderung löst automatisch eine neue Abfrage aus. Pagination-Cursor wird durch den neuen Key zurückgesetzt (korrekt: neue Filterung beginnt bei der neuesten Seite).

- [ ] **Step 6: Gesamtsuite + Typecheck**

```bash
cd frontend && npm run test && npm run typecheck
```
Erwartet: alles grün.

- [ ] **Step 7: Commit**

```bash
cd frontend && git add src/etb/EtbFilterleiste.tsx src/etb/EtbFilterleiste.test.tsx src/pages/EtbPage.tsx src/main.tsx src/test/setup.ts
git commit -m "feat(frontend): ETB-Such-/Filterleiste (Volltext, Typ, Zeitraum)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 10: Schnellerfassung (inkl. Berichtigung, rollen-gegated)

**Files:**
- Create: `frontend/src/etb/Schnellerfassung.tsx`
- Modify: `frontend/src/pages/EtbPage.tsx` (Erfassung + Schreibrecht-Gating + Berichtigen-Aktion)
- Test: `frontend/src/etb/Schnellerfassung.test.tsx`

- [ ] **Step 1: Test für die Schnellerfassung schreiben**

`frontend/src/etb/Schnellerfassung.test.tsx`:

```tsx
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { NeuerEintrag } from '../api/etb';
import type { EtbEintragAnzeige } from '../api/types';
import { renderMitProviders } from '../test/utils';
import Schnellerfassung from './Schnellerfassung';

function original(): EtbEintragAnzeige {
  return {
    id: 5, lfd_nr: 5, typ: 'meldung', inhalt: 'Original', von: null, an: null,
    meldeweg: null, veranlassung: null, erfasser_id: 1, erfasser_name: 'Max',
    ereigniszeit: '2026-05-23 10:00:00', received_at: '2026-05-23 10:00:01',
    erfasst_lokal_at: null, berichtigt_eintrag_id: null,
  };
}

describe('Schnellerfassung', () => {
  it('sendet typ=meldung mit Inhalt und erfasst_lokal_at', async () => {
    const erfassen = vi.fn<(e: NeuerEintrag) => Promise<void>>().mockResolvedValue();
    renderMitProviders(
      <Schnellerfassung erfassen={erfassen} berichtigungZu={null} onBerichtigungAbbrechen={vi.fn()} />,
    );
    await userEvent.type(screen.getByPlaceholderText('Inhalt …'), 'Pumpe läuft');
    await userEvent.click(screen.getByRole('button', { name: 'Erfassen' }));
    await waitFor(() => expect(erfassen).toHaveBeenCalledTimes(1));
    const arg = erfassen.mock.calls[0][0];
    expect(arg.typ).toBe('meldung');
    expect(arg.inhalt).toBe('Pumpe läuft');
    expect(arg.erfasst_lokal_at).toBeTruthy();
    expect(arg.berichtigt_eintrag_id).toBeUndefined();
  });

  it('sendet im Berichtigungsmodus typ=berichtigung mit berichtigt_eintrag_id', async () => {
    const erfassen = vi.fn<(e: NeuerEintrag) => Promise<void>>().mockResolvedValue();
    renderMitProviders(
      <Schnellerfassung
        erfassen={erfassen}
        berichtigungZu={original()}
        onBerichtigungAbbrechen={vi.fn()}
      />,
    );
    expect(screen.getByText(/Berichtigung zu #5/)).toBeInTheDocument();
    await userEvent.type(screen.getByPlaceholderText('Inhalt …'), 'Korrektur');
    await userEvent.click(screen.getByRole('button', { name: 'Erfassen' }));
    await waitFor(() => expect(erfassen).toHaveBeenCalledTimes(1));
    const arg = erfassen.mock.calls[0][0];
    expect(arg.typ).toBe('berichtigung');
    expect(arg.berichtigt_eintrag_id).toBe(5);
  });
});
```

- [ ] **Step 2: Test ausführen (muss fehlschlagen)**

```bash
cd frontend && npm run test -- src/etb/Schnellerfassung.test.tsx
```
Erwartet: FAIL — `Cannot find module './Schnellerfassung'`.

- [ ] **Step 3: Schnellerfassung implementieren**

`frontend/src/etb/Schnellerfassung.tsx`:

```tsx
import { Alert, Button, Card, Collapse, DatePicker, Form, Input, Select, Space } from 'antd';
import dayjs from 'dayjs';
import { useEffect, useState } from 'react';
import type { NeuerEintrag } from '../api/etb';
import type { EtbEintragAnzeige, EtbTyp, MeldeWeg } from '../api/types';
import { ERFASSBARE_TYPEN, TYP_LABEL } from './typFarben';

interface Props {
  erfassen: (eintrag: NeuerEintrag) => Promise<void>;
  /** Gesetzt = Berichtigungsmodus für diesen Originaleintrag. */
  berichtigungZu: EtbEintragAnzeige | null;
  onBerichtigungAbbrechen: () => void;
}

interface FormWerte {
  typ: EtbTyp;
  inhalt: string;
  von?: string;
  an?: string;
  meldeweg?: MeldeWeg;
  veranlassung?: string;
  ereigniszeit?: dayjs.Dayjs;
}

const TYP_OPTIONEN = ERFASSBARE_TYPEN.map((t) => ({ value: t, label: TYP_LABEL[t] }));
const MELDEWEG_OPTIONEN: { value: MeldeWeg; label: string }[] = [
  { value: 'funk', label: 'Funk' },
  { value: 'telefon', label: 'Telefon' },
  { value: 'persoenlich', label: 'Persönlich' },
  { value: 'sonstige', label: 'Sonstige' },
];

export default function Schnellerfassung({ erfassen, berichtigungZu, onBerichtigungAbbrechen }: Props) {
  const [form] = Form.useForm<FormWerte>();
  const [sendet, setSendet] = useState(false);

  // Im Berichtigungsmodus fokussiert das Inhaltsfeld; bei Moduswechsel Felder zurücksetzen.
  useEffect(() => {
    if (berichtigungZu) form.resetFields();
  }, [berichtigungZu, form]);

  async function absenden(werte: FormWerte) {
    setSendet(true);
    try {
      const jetztIso = new Date().toISOString();
      const eintrag: NeuerEintrag = {
        typ: berichtigungZu ? 'berichtigung' : werte.typ,
        inhalt: werte.inhalt,
        von: werte.von || undefined,
        an: werte.an || undefined,
        meldeweg: werte.meldeweg || undefined,
        veranlassung: werte.veranlassung || undefined,
        // ereigniszeit clientseitig setzen (Default jetzt), damit gepufferte Einträge
        // ihre tatsächliche Ereigniszeit behalten (Spec §11).
        ereigniszeit: werte.ereigniszeit
          ? werte.ereigniszeit.utc().format('YYYY-MM-DD HH:mm:ss')
          : jetztIso,
        erfasst_lokal_at: jetztIso,
        berichtigt_eintrag_id: berichtigungZu ? berichtigungZu.id : undefined,
      };
      await erfassen(eintrag);
      form.resetFields();
      if (berichtigungZu) onBerichtigungAbbrechen();
    } finally {
      setSendet(false);
    }
  }

  return (
    <Card size="small" style={{ marginTop: 16 }}>
      {berichtigungZu && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 12 }}
          message={`Berichtigung zu #${berichtigungZu.lfd_nr}`}
          action={
            <Button size="small" onClick={onBerichtigungAbbrechen}>
              Abbrechen
            </Button>
          }
        />
      )}
      <Form
        form={form}
        layout="vertical"
        initialValues={{ typ: 'meldung' }}
        onFinish={absenden}
        disabled={sendet}
      >
        <Space align="start" style={{ width: '100%' }}>
          {!berichtigungZu && (
            <Form.Item name="typ" style={{ marginBottom: 8, minWidth: 150 }}>
              <Select options={TYP_OPTIONEN} />
            </Form.Item>
          )}
          <Form.Item
            name="inhalt"
            style={{ flex: 1, marginBottom: 8, width: '100%' }}
            rules={[{ required: true, message: 'Inhalt ist Pflicht' }]}
          >
            <Input.TextArea placeholder="Inhalt …" autoSize={{ minRows: 1, maxRows: 4 }} />
          </Form.Item>
          <Button type="primary" htmlType="submit" loading={sendet}>
            Erfassen
          </Button>
        </Space>

        <Collapse
          ghost
          items={[
            {
              key: 'optional',
              label: 'Weitere Angaben',
              children: (
                <Space wrap>
                  <Form.Item name="von" label="Von" style={{ marginBottom: 0 }}>
                    <Input />
                  </Form.Item>
                  <Form.Item name="an" label="An" style={{ marginBottom: 0 }}>
                    <Input />
                  </Form.Item>
                  <Form.Item name="meldeweg" label="Meldeweg" style={{ marginBottom: 0 }}>
                    <Select allowClear style={{ width: 140 }} options={MELDEWEG_OPTIONEN} />
                  </Form.Item>
                  <Form.Item name="veranlassung" label="Veranlassung" style={{ marginBottom: 0 }}>
                    <Input />
                  </Form.Item>
                  <Form.Item name="ereigniszeit" label="Ereigniszeit" style={{ marginBottom: 0 }}>
                    <DatePicker showTime placeholder="abweichend …" />
                  </Form.Item>
                </Space>
              ),
            },
          ]}
        />
      </Form>
    </Card>
  );
}
```

- [ ] **Step 4: Test ausführen (muss bestehen)**

```bash
cd frontend && npm run test -- src/etb/Schnellerfassung.test.tsx
```
Erwartet: PASS (2 Tests).

- [ ] **Step 5: EtbPage um Erfassung, Gating und Berichtigen-Aktion erweitern**

Ergänze in `frontend/src/pages/EtbPage.tsx` die Imports:

```tsx
import { App } from 'antd';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '../api/client';
import { erfasseEtb, type NeuerEintrag } from '../api/etb';
import type { EtbEintragAnzeige } from '../api/types';
import Schnellerfassung from '../etb/Schnellerfassung';
```

Innerhalb der Komponente (nach den Querys) ergänzen:

```tsx
  const qc = useQueryClient();
  const { message } = App.useApp();
  const [berichtigungZu, setBerichtigungZu] = useState<EtbEintragAnzeige | null>(null);

  const erfassungMutation = useMutation({
    mutationFn: (e: NeuerEintrag) => erfasseEtb(einsatzId, e),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['etb', einsatzId] }),
  });

  async function erfassen(e: NeuerEintrag) {
    try {
      await erfassungMutation.mutateAsync(e);
    } catch (err) {
      message.error(err instanceof ApiError ? err.message : 'Senden fehlgeschlagen');
      throw err;
    }
  }
```

Berechne nach `const einsatz = einsatzQuery.data;` das Schreibrecht:

```tsx
  const darfSchreiben =
    einsatz.status === 'aktiv' &&
    (einsatz.meine_rolle === 'einsatzleitung' || einsatz.meine_rolle === 'fuehrungspersonal');
```

Übergib `onBerichtigen` nur bei Schreibrecht an die Tabelle und rendere die Schnellerfassung darunter:

```tsx
      <EtbTabelle
        eintraege={eintraege}
        onBerichtigen={darfSchreiben ? (e) => setBerichtigungZu(e) : undefined}
      />

      {etbQuery.hasNextPage && (
        <div style={{ textAlign: 'center', marginTop: 12 }}>
          <Button onClick={() => etbQuery.fetchNextPage()} loading={etbQuery.isFetchingNextPage}>
            Ältere laden
          </Button>
        </div>
      )}

      {darfSchreiben && (
        <Schnellerfassung
          erfassen={erfassen}
          berichtigungZu={berichtigungZu}
          onBerichtigungAbbrechen={() => setBerichtigungZu(null)}
        />
      )}
```

> Beobachter (`meine_rolle === 'beobachter'`) und abgeschlossene Einsätze sehen weder „Berichtigen" noch die Schnellerfassung — das Backend würde sonst mit 403 ablehnen.

- [ ] **Step 6: Gesamtsuite + Typecheck**

```bash
cd frontend && npm run test && npm run typecheck
```
Erwartet: alles grün.

- [ ] **Step 7: Commit**

```bash
cd frontend && git add src/etb/Schnellerfassung.tsx src/etb/Schnellerfassung.test.tsx src/pages/EtbPage.tsx
git commit -m "feat(frontend): Schnellerfassung mit Optionalfeldern und Berichtigung

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 11: SSE-Live-Hook

**Files:**
- Create: `frontend/src/etb/useEtbStream.ts`
- Modify: `frontend/src/pages/EtbPage.tsx` (Hook aktivieren)
- Test: `frontend/src/etb/useEtbStream.test.tsx`

- [ ] **Step 1: Test für den SSE-Hook schreiben** (mit gestubbter EventSource)

`frontend/src/etb/useEtbStream.test.tsx`:

```tsx
import { render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { QueryClientProvider } from '@tanstack/react-query';
import { neuerQueryClient } from '../test/utils';
import { useEtbStream } from './useEtbStream';

class FakeEventSource {
  static letzte: FakeEventSource | null = null;
  url: string;
  closed = false;
  private listeners: Record<string, ((e: MessageEvent) => void)[]> = {};
  constructor(url: string) {
    this.url = url;
    FakeEventSource.letzte = this;
  }
  addEventListener(typ: string, cb: (e: MessageEvent) => void) {
    (this.listeners[typ] ??= []).push(cb);
  }
  close() {
    this.closed = true;
  }
  emit(typ: string, data = '') {
    (this.listeners[typ] ?? []).forEach((cb) => cb(new MessageEvent(typ, { data })));
  }
}

afterEach(() => vi.unstubAllGlobals());

function Probe({ id }: { id: number }) {
  useEtbStream(id);
  return <div>aktiv</div>;
}

describe('useEtbStream', () => {
  it('invalidiert die ETB-Query bei einem etb-Event', async () => {
    vi.stubGlobal('EventSource', FakeEventSource);
    const client = neuerQueryClient();
    const spy = vi.spyOn(client, 'invalidateQueries');
    render(
      <QueryClientProvider client={client}>
        <Probe id={7} />
      </QueryClientProvider>,
    );
    expect(FakeEventSource.letzte?.url).toBe('/api/einsaetze/7/etb/stream');
    FakeEventSource.letzte?.emit('etb', '{"id":1}');
    await waitFor(() =>
      expect(spy).toHaveBeenCalledWith({ queryKey: ['etb', 7] }),
    );
  });

  it('schließt die Verbindung beim Unmount', () => {
    vi.stubGlobal('EventSource', FakeEventSource);
    const client = neuerQueryClient();
    const { unmount } = render(
      <QueryClientProvider client={client}>
        <Probe id={3} />
      </QueryClientProvider>,
    );
    const es = FakeEventSource.letzte!;
    unmount();
    expect(es.closed).toBe(true);
  });
});
```

- [ ] **Step 2: Test ausführen (muss fehlschlagen)**

```bash
cd frontend && npm run test -- src/etb/useEtbStream.test.tsx
```
Erwartet: FAIL — `Cannot find module './useEtbStream'`.

- [ ] **Step 3: SSE-Hook implementieren**

`frontend/src/etb/useEtbStream.ts`:

```ts
import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

/** Abonniert den SSE-Stream eines Einsatzes. Bei jedem `etb`- oder `lagged`-Event
 *  wird die ETB-Query invalidiert → React Query holt die aktuell sichtbaren Seiten
 *  neu (respektiert Filter/Pagination). Das ist der vom Backend dokumentierte
 *  Resync-Weg (auch für `lagged`/Pufferüberlauf). */
export function useEtbStream(einsatzId: number): void {
  const qc = useQueryClient();
  useEffect(() => {
    if (!Number.isFinite(einsatzId)) return;
    const quelle = new EventSource(`/api/einsaetze/${einsatzId}/etb/stream`);
    const resync = () => qc.invalidateQueries({ queryKey: ['etb', einsatzId] });
    quelle.addEventListener('etb', resync);
    quelle.addEventListener('lagged', resync);
    return () => quelle.close();
  }, [einsatzId, qc]);
}
```

- [ ] **Step 4: Test ausführen (muss bestehen)**

```bash
cd frontend && npm run test -- src/etb/useEtbStream.test.tsx
```
Erwartet: PASS (2 Tests).

- [ ] **Step 5: Hook in EtbPage aktivieren**

Ergänze in `frontend/src/pages/EtbPage.tsx` den Import und rufe den Hook **vor** den frühen Returns auf (Hook-Regeln):

```tsx
import { useEtbStream } from '../etb/useEtbStream';
```

Direkt nach `const einsatzId = Number(id);` (bzw. bei den übrigen Hooks, vor `if (einsatzQuery.isLoading)`):

```tsx
  useEtbStream(einsatzId);
```

> jsdom (Vitest) kennt keine echte `EventSource`; im EtbPage-Test ist das unkritisch, weil der Hook nur einen Konstruktor aufruft, der dort nicht getriggert wird — falls ein Test fehlschlägt, weil `EventSource is not defined`, ergänze in `src/test/setup.ts` einen No-op-Stub: `vi.stubGlobal('EventSource', class { addEventListener(){} close(){} })`. (Nur falls nötig.)

- [ ] **Step 6: Gesamtsuite ausführen**

```bash
cd frontend && npm run test
```
Erwartet: alle Tests grün. Falls der EtbPage-Test an fehlender `EventSource` scheitert, den No-op-Stub aus Step 5 ergänzen und erneut laufen lassen.

- [ ] **Step 7: Commit**

```bash
cd frontend && git add src/etb/useEtbStream.ts src/etb/useEtbStream.test.tsx src/pages/EtbPage.tsx src/test/setup.ts
git commit -m "feat(frontend): SSE-Live-Hook invalidiert ETB bei neuen Einträgen

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 12: Offline-Queue (IndexedDB) + Flush bei Reconnect

**Files:**
- Create: `frontend/src/offline/queue.ts`, `frontend/src/offline/useEtbErfassung.ts`
- Modify: `frontend/src/pages/EtbPage.tsx` (Erfassung über den Offline-Hook + Anzeige ausstehender Einträge)
- Test: `frontend/src/offline/useEtbErfassung.test.tsx`

- [ ] **Step 1: IndexedDB-Queue implementieren**

`frontend/src/offline/queue.ts`:

```ts
import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { NeuerEintrag } from '../api/etb';

export interface AusstehenderEintrag {
  id?: number;
  einsatz_id: number;
  eintrag: NeuerEintrag;
  erstellt_at: string;
}

interface OfflineDB extends DBSchema {
  ausstehend: {
    key: number;
    value: AusstehenderEintrag;
    indexes: { 'by-einsatz': number };
  };
}

let dbPromise: Promise<IDBPDatabase<OfflineDB>> | null = null;

function db(): Promise<IDBPDatabase<OfflineDB>> {
  if (!dbPromise) {
    dbPromise = openDB<OfflineDB>('lifeline-offline', 1, {
      upgrade(d) {
        const store = d.createObjectStore('ausstehend', { keyPath: 'id', autoIncrement: true });
        store.createIndex('by-einsatz', 'einsatz_id');
      },
    });
  }
  return dbPromise;
}

export async function queueEinreihen(einsatzId: number, eintrag: NeuerEintrag): Promise<void> {
  const d = await db();
  await d.add('ausstehend', {
    einsatz_id: einsatzId,
    eintrag,
    erstellt_at: new Date().toISOString(),
  });
}

/** Ausstehende Einträge eines Einsatzes in Einreihungs-Reihenfolge (aufsteigende id). */
export async function queueLaden(einsatzId: number): Promise<AusstehenderEintrag[]> {
  const d = await db();
  const alle = await d.getAllFromIndex('ausstehend', 'by-einsatz', einsatzId);
  return alle.sort((a, b) => (a.id ?? 0) - (b.id ?? 0));
}

export async function queueEntfernen(id: number): Promise<void> {
  const d = await db();
  await d.delete('ausstehend', id);
}

/** Nur für Tests: leert den Store (gleiche Verbindung, kein Reconnect nötig). */
export async function queueLeerenFuerTests(): Promise<void> {
  const d = await db();
  await d.clear('ausstehend');
}
```

- [ ] **Step 2: Test für useEtbErfassung schreiben** (Offline-Einreihen + Flush)

`frontend/src/offline/useEtbErfassung.test.tsx`:

```tsx
import { http, HttpResponse } from 'msw';
import { renderHook, waitFor } from '@testing-library/react';
import { act } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it } from 'vitest';
import type { ReactNode } from 'react';
import { server } from '../test/server';
import { neuerQueryClient } from '../test/utils';
import type { NeuerEintrag } from '../api/etb';
import { queueLeerenFuerTests } from './queue';
import { useEtbErfassung } from './useEtbErfassung';

const eintrag: NeuerEintrag = { typ: 'meldung', inhalt: 'x', erfasst_lokal_at: '2026-05-23T10:00:00Z' };

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={neuerQueryClient()}>{children}</QueryClientProvider>;
}

beforeEach(async () => {
  await queueLeerenFuerTests();
});

describe('useEtbErfassung', () => {
  it('reiht bei Netzwerkfehler ein und sendet beim Flush nach', async () => {
    let versuch = 0;
    server.use(
      http.post('/api/einsaetze/9/etb', () => {
        versuch += 1;
        return versuch === 1
          ? HttpResponse.error()
          : HttpResponse.json({ id: 1, lfd_nr: 1 }, { status: 201 });
      }),
    );

    const { result } = renderHook(() => useEtbErfassung(9), { wrapper });

    await act(async () => {
      await result.current.erfassen(eintrag);
    });
    await waitFor(() => expect(result.current.ausstehend).toHaveLength(1));

    await act(async () => {
      await result.current.flush();
    });
    await waitFor(() => expect(result.current.ausstehend).toHaveLength(0));
    expect(versuch).toBe(2);
  });

  it('reicht fachliche Ablehnung (ApiError) an den Aufrufer durch', async () => {
    server.use(
      http.post('/api/einsaetze/9/etb', () =>
        HttpResponse.json({ error: 'Keine Berechtigung' }, { status: 403 }),
      ),
    );
    const { result } = renderHook(() => useEtbErfassung(9), { wrapper });
    await expect(result.current.erfassen(eintrag)).rejects.toMatchObject({ status: 403 });
    expect(result.current.ausstehend).toHaveLength(0);
  });
});
```

- [ ] **Step 3: Test ausführen (muss fehlschlagen)**

```bash
cd frontend && npm run test -- src/offline/useEtbErfassung.test.tsx
```
Erwartet: FAIL — `Cannot find module './useEtbErfassung'`.

- [ ] **Step 4: useEtbErfassung implementieren**

`frontend/src/offline/useEtbErfassung.ts`:

```ts
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useState } from 'react';
import { ApiError } from '../api/client';
import { erfasseEtb, type NeuerEintrag } from '../api/etb';
import {
  queueEinreihen,
  queueEntfernen,
  queueLaden,
  type AusstehenderEintrag,
} from './queue';

/** Netzwerkfehler (offline) sind keine ApiError-Instanzen — fetch wirft TypeError.
 *  So lässt sich „kein Netz" von einer fachlichen Server-Ablehnung trennen. */
function istNetzwerkfehler(e: unknown): boolean {
  return !(e instanceof ApiError);
}

export function useEtbErfassung(einsatzId: number) {
  const qc = useQueryClient();
  const [ausstehend, setAusstehend] = useState<AusstehenderEintrag[]>([]);

  const ladeAusstehend = useCallback(async () => {
    setAusstehend(await queueLaden(einsatzId));
  }, [einsatzId]);

  useEffect(() => {
    void ladeAusstehend();
  }, [ladeAusstehend]);

  const flush = useCallback(async () => {
    const liste = await queueLaden(einsatzId);
    for (const a of liste) {
      try {
        await erfasseEtb(einsatzId, a.eintrag);
        await queueEntfernen(a.id!);
      } catch (e) {
        if (istNetzwerkfehler(e)) break; // weiterhin offline → später erneut versuchen
        await queueEntfernen(a.id!); // fachlich abgelehnt → verwerfen, sonst Dauerschleife
      }
    }
    await ladeAusstehend();
    qc.invalidateQueries({ queryKey: ['etb', einsatzId] });
  }, [einsatzId, qc, ladeAusstehend]);

  useEffect(() => {
    window.addEventListener('online', flush);
    return () => window.removeEventListener('online', flush);
  }, [flush]);

  const erfassen = useCallback(
    async (eintrag: NeuerEintrag) => {
      try {
        await erfasseEtb(einsatzId, eintrag);
        qc.invalidateQueries({ queryKey: ['etb', einsatzId] });
      } catch (e) {
        if (istNetzwerkfehler(e)) {
          await queueEinreihen(einsatzId, eintrag);
          await ladeAusstehend();
        } else {
          throw e; // fachliche Ablehnung an den Aufrufer reichen
        }
      }
    },
    [einsatzId, qc, ladeAusstehend],
  );

  return { erfassen, ausstehend, flush };
}
```

- [ ] **Step 5: Test ausführen (muss bestehen)**

```bash
cd frontend && npm run test -- src/offline/useEtbErfassung.test.tsx
```
Erwartet: PASS (2 Tests).

- [ ] **Step 6: EtbPage auf den Offline-Hook umstellen + ausstehende Einträge anzeigen**

In `frontend/src/pages/EtbPage.tsx`:

1. Entferne die in Task 10 ergänzte `erfassungMutation` samt der `erfassen`-Funktion und den nun ungenutzten Import `useMutation` (falls sonst nirgends genutzt) sowie `erfasseEtb`.
2. Ergänze den Import:

```tsx
import { useEtbErfassung } from '../offline/useEtbErfassung';
```

3. Rufe den Hook bei den übrigen Hooks auf (vor den frühen Returns):

```tsx
  const { erfassen, ausstehend } = useEtbErfassung(einsatzId);
```

4. Definiere die Meldungs-Hülle (zeigt fachliche Ablehnungen an, hält den Berichtigungs-/Reset-Fluss korrekt):

```tsx
  async function erfassenMitMeldung(e: NeuerEintrag) {
    try {
      await erfassen(e);
    } catch (err) {
      message.error(err instanceof ApiError ? err.message : 'Senden fehlgeschlagen');
      throw err;
    }
  }
```

5. Übergib `erfassenMitMeldung` (statt des alten `erfassen`) an die `Schnellerfassung`.
6. Rendere oberhalb der Tabelle die ausstehenden (gepufferten) Einträge:

```tsx
      {ausstehend.length > 0 && (
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 12 }}
          message={`${ausstehend.length} Eintrag/Einträge werden gesendet, sobald wieder Verbindung besteht`}
          description={
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              {ausstehend.map((a) => (
                <li key={a.id}>{a.eintrag.inhalt}</li>
              ))}
            </ul>
          }
        />
      )}
```

> Gepufferte Einträge haben bewusst **keine** `lfd_nr` (die vergibt erst der Server beim Empfang) — sie werden separat als „wird gesendet" gezeigt, nicht in der nummerierten Tabelle. Nach erfolgreichem Flush erscheinen sie regulär mit echter `lfd_nr`.

- [ ] **Step 7: Gesamtsuite + Typecheck**

```bash
cd frontend && npm run test && npm run typecheck
```
Erwartet: alles grün.

- [ ] **Step 8: Commit**

```bash
cd frontend && git add src/offline/queue.ts src/offline/useEtbErfassung.ts src/offline/useEtbErfassung.test.tsx src/pages/EtbPage.tsx
git commit -m "feat(frontend): Offline-Puffer (IndexedDB) mit Flush bei Reconnect

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 13: PWA-Build verifizieren

Das PWA-Plugin wurde bereits in Task 1 (`vite.config.ts`) konfiguriert. Dieser Task stellt sicher, dass der Produktions-Build einen Service-Worker und ein Web-Manifest erzeugt (App-Shell-Offline + Installierbarkeit).

**Files:**
- Modify: `frontend/package.json` (Verifikations-Skript ergänzen)

- [ ] **Step 1: Produktions-Build ausführen**

```bash
cd frontend && npm run build
```
Erwartet: Build erfolgreich; im `dist/` entstehen u.a. `sw.js`, `manifest.webmanifest`, `registerSW.js` sowie die Icons (`pwa-192.png`, `pwa-512.png`).

- [ ] **Step 2: PWA-Artefakte prüfen**

```bash
cd frontend && test -f dist/sw.js && test -f dist/manifest.webmanifest && echo "PWA-OK"
```
Erwartet: Ausgabe `PWA-OK`. Schlägt der Test fehl, prüfe die `VitePWA`-Konfiguration in `vite.config.ts` (Task 1, Step 3) und ob die Icons unter `public/` liegen (Task 1, Step 8).

- [ ] **Step 3: Manifest-Inhalt grob prüfen**

```bash
cd frontend && grep -q '"name":"lifeline-hub"' dist/manifest.webmanifest && echo "MANIFEST-OK"
```
Erwartet: `MANIFEST-OK`.

- [ ] **Step 4: Commit** (nur falls etwas an der Konfiguration angepasst wurde)

```bash
cd frontend && git add vite.config.ts package.json
git commit -m "chore(frontend): PWA-Build (Service-Worker + Manifest) verifiziert

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

> Falls in diesem Task nichts geändert wurde (Build lief auf Anhieb), entfällt der Commit.

---

## Task 14: Einsatz abschließen

**Files:**
- Modify: `frontend/src/pages/EtbPage.tsx` (Abschließen-Button für Einsatzleitung bei aktivem Einsatz)
- Test: `frontend/src/pages/EtbPage.abschliessen.test.tsx`

- [ ] **Step 1: Test für das Abschließen schreiben**

`frontend/src/pages/EtbPage.abschliessen.test.tsx`:

```tsx
import { http, HttpResponse } from 'msw';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { Route, Routes } from 'react-router-dom';
import { server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import { AuthProvider } from '../auth/AuthContext';
import EtbPage from './EtbPage';

const admin = {
  id: 1, anzeigename: 'Admin', benutzername: 'admin', system_rolle: 'admin',
  org_rolle: 'keine', aktiv: true, erstellt_at: '2026-05-23 10:00:00',
};
function einsatz(status: string) {
  return {
    id: 7, bezeichnung: 'Hochwasser', stichwort: null, status,
    begonnen_at: '2026-05-23 09:00:00', abgeschlossen_at: null, abgeschlossen_von: null,
    meine_rolle: 'einsatzleitung',
  };
}

describe('EtbPage – Abschließen', () => {
  it('schließt einen aktiven Einsatz als Einsatzleitung ab', async () => {
    let abgeschlossen = false;
    server.use(
      http.get('/api/auth/me', () => HttpResponse.json(admin)),
      http.get('/api/einsaetze/7', () =>
        HttpResponse.json(einsatz(abgeschlossen ? 'abgeschlossen' : 'aktiv')),
      ),
      http.get('/api/einsaetze/7/etb', () => HttpResponse.json([])),
      http.post('/api/einsaetze/7/abschliessen', () => {
        abgeschlossen = true;
        return HttpResponse.json(einsatz('abgeschlossen'));
      }),
    );
    renderMitProviders(
      <AuthProvider>
        <Routes>
          <Route path="/einsaetze/:id/etb" element={<EtbPage />} />
        </Routes>
      </AuthProvider>,
      { route: '/einsaetze/7/etb' },
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Einsatz abschließen' }));
    // Popconfirm bestätigen
    await userEvent.click(await screen.findByRole('button', { name: 'Ja' }));
    await waitFor(() => expect(screen.getByText('abgeschlossen')).toBeInTheDocument());
  });
});
```

- [ ] **Step 2: Test ausführen (muss fehlschlagen)**

```bash
cd frontend && npm run test -- src/pages/EtbPage.abschliessen.test.tsx
```
Erwartet: FAIL — der Abschließen-Button existiert noch nicht.

- [ ] **Step 3: Abschließen-Button in EtbPage implementieren**

Ergänze in `frontend/src/pages/EtbPage.tsx` die Imports:

```tsx
import { Popconfirm } from 'antd';
import { schliesseEinsatzAb } from '../api/einsaetze';
```

Ergänze die Mutation (bei den übrigen Hooks, vor den frühen Returns):

```tsx
  const abschliessenMutation = useMutation({
    mutationFn: () => schliesseEinsatzAb(einsatzId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['einsatz', einsatzId] });
      qc.invalidateQueries({ queryKey: ['einsaetze'] });
      message.success('Einsatz abgeschlossen');
    },
    onError: (e) =>
      message.error(e instanceof ApiError ? e.message : 'Abschließen fehlgeschlagen'),
  });
```

> Falls `useMutation` in Task 12 aus den Importen entfernt wurde, hier wieder ergänzen: `import { useMutation, useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';`

Berechne nach `const einsatz = einsatzQuery.data;`:

```tsx
  const darfAbschliessen = einsatz.status === 'aktiv' && einsatz.meine_rolle === 'einsatzleitung';
```

Ergänze im Header-`Space` (rechtsbündig, als zweites Element der äußeren `Space`) den Button:

```tsx
        {darfAbschliessen && (
          <Popconfirm
            title="Einsatz abschließen?"
            description="Danach sind keine neuen Einträge oder Berichtigungen mehr möglich."
            okText="Ja"
            cancelText="Abbrechen"
            onConfirm={() => abschliessenMutation.mutate()}
          >
            <Button danger loading={abschliessenMutation.isPending}>
              Einsatz abschließen
            </Button>
          </Popconfirm>
        )}
```

> Sobald der Status auf `abgeschlossen` wechselt, wird `darfSchreiben` (Task 10) `false` → Schnellerfassung und „Berichtigen" verschwinden automatisch (read-only).

- [ ] **Step 4: Test ausführen (muss bestehen)**

```bash
cd frontend && npm run test -- src/pages/EtbPage.abschliessen.test.tsx
```
Erwartet: PASS (1 Test).

- [ ] **Step 5: Commit**

```bash
cd frontend && git add src/pages/EtbPage.tsx src/pages/EtbPage.abschliessen.test.tsx
git commit -m "feat(frontend): Einsatz abschließen (Einsatzleitung) macht ETB read-only

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 15: Mitglieder-Verwaltung (Drawer)

**Files:**
- Create: `frontend/src/api/benutzer.ts` (komplett — auch für Task 16), `frontend/src/etb/MitgliederPanel.tsx`
- Modify: `frontend/src/pages/EtbPage.tsx` (Mitglieder-Button + Drawer für Einsatzleitung)
- Test: `frontend/src/etb/MitgliederPanel.test.tsx`

> **Backend-Hinweis:** `GET /api/benutzer` (für die „Benutzer hinzufügen"-Auswahl) ist **Admin-only**. Eine Einsatzleitung ohne Admin-Rolle erhält dort 403 → die Auswahlliste bleibt leer mit Hinweis „Benutzerliste nur für Admins". Ein nicht-Admin-Endpoint zum Auflisten von Benutzern ist ein **Backend-Folgethema** (außerhalb Plan 5). Mitglieder-Rollen ändern/entfernen funktioniert für jede Einsatzleitung.

- [ ] **Step 1: Benutzer-API-Modul schreiben**

`frontend/src/api/benutzer.ts`:

```ts
import type { BenutzerAnzeige, OrgRolle, SystemRolle } from './types';
import { apiGet, apiSend } from './client';

export function listeBenutzer(): Promise<BenutzerAnzeige[]> {
  return apiGet<BenutzerAnzeige[]>('/api/benutzer');
}

export interface NeuerBenutzer {
  anzeigename: string;
  benutzername: string;
  passwort: string;
  system_rolle?: SystemRolle;
  org_rolle?: OrgRolle;
}

export function legeBenutzerAn(b: NeuerBenutzer): Promise<BenutzerAnzeige> {
  return apiSend<BenutzerAnzeige>('/api/benutzer', 'POST', b);
}

export function deaktiviereBenutzer(id: number): Promise<BenutzerAnzeige> {
  return apiSend<BenutzerAnzeige>(`/api/benutzer/${id}/deaktivieren`, 'POST');
}
```

- [ ] **Step 2: Test für MitgliederPanel schreiben**

`frontend/src/etb/MitgliederPanel.test.tsx`:

```tsx
import { http, HttpResponse } from 'msw';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import MitgliederPanel from './MitgliederPanel';

function mitglied(over: Partial<Record<string, unknown>> = {}) {
  return {
    benutzer_id: 2,
    anzeigename: 'Eva Einsatz',
    benutzername: 'eva',
    einsatz_rolle: 'fuehrungspersonal',
    zugewiesen_at: '2026-05-23 10:00:00',
    ...over,
  };
}

describe('MitgliederPanel', () => {
  it('zeigt vorhandene Mitglieder', async () => {
    server.use(
      http.get('/api/einsaetze/7/mitglieder', () => HttpResponse.json([mitglied()])),
      http.get('/api/benutzer', () => HttpResponse.json([])),
    );
    renderMitProviders(
      <MitgliederPanel einsatzId={7} istAktiv offen onClose={() => {}} />,
    );
    expect(await screen.findByText('Eva Einsatz')).toBeInTheDocument();
  });

  it('entfernt ein Mitglied', async () => {
    let entfernt = false;
    server.use(
      http.get('/api/einsaetze/7/mitglieder', () =>
        HttpResponse.json(entfernt ? [] : [mitglied()]),
      ),
      http.get('/api/benutzer', () => HttpResponse.json([])),
      http.delete('/api/einsaetze/7/mitglieder/2', () => {
        entfernt = true;
        return HttpResponse.json([]);
      }),
    );
    renderMitProviders(
      <MitgliederPanel einsatzId={7} istAktiv offen onClose={() => {}} />,
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Entfernen' }));
    const popup = await screen.findByRole('tooltip');
    await userEvent.click(within(popup).getByRole('button', { name: 'Ja' }));
    await waitFor(() => expect(screen.queryByText('Eva Einsatz')).not.toBeInTheDocument());
  });
});
```

- [ ] **Step 3: Test ausführen (muss fehlschlagen)**

```bash
cd frontend && npm run test -- src/etb/MitgliederPanel.test.tsx
```
Erwartet: FAIL — `Cannot find module './MitgliederPanel'`.

- [ ] **Step 4: MitgliederPanel implementieren**

`frontend/src/etb/MitgliederPanel.tsx`:

```tsx
import { App, Button, Drawer, Popconfirm, Select, Space, Table } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { EinsatzRolle, MitgliedAnzeige } from '../api/types';
import { ApiError } from '../api/client';
import { entferneMitglied, ladeMitglieder, setzeMitglied } from '../api/einsaetze';
import { listeBenutzer } from '../api/benutzer';

const ROLLEN: { value: EinsatzRolle; label: string }[] = [
  { value: 'einsatzleitung', label: 'Einsatzleitung' },
  { value: 'fuehrungspersonal', label: 'Führungspersonal' },
  { value: 'beobachter', label: 'Beobachter' },
];

interface Props {
  einsatzId: number;
  istAktiv: boolean;
  offen: boolean;
  onClose: () => void;
}

export default function MitgliederPanel({ einsatzId, istAktiv, offen, onClose }: Props) {
  const qc = useQueryClient();
  const { message } = App.useApp();
  const [neuerBenutzer, setNeuerBenutzer] = useState<number | undefined>();
  const [neueRolle, setNeueRolle] = useState<EinsatzRolle>('fuehrungspersonal');

  const mitgliederQuery = useQuery({
    queryKey: ['mitglieder', einsatzId],
    queryFn: () => ladeMitglieder(einsatzId),
    enabled: offen,
  });
  const benutzerQuery = useQuery({
    queryKey: ['benutzer'],
    queryFn: listeBenutzer,
    enabled: offen && istAktiv,
  });

  const setzen = useMutation({
    mutationFn: (v: { benutzerId: number; rolle: EinsatzRolle }) =>
      setzeMitglied(einsatzId, v.benutzerId, v.rolle),
    onSuccess: (liste) => {
      qc.setQueryData(['mitglieder', einsatzId], liste);
      setNeuerBenutzer(undefined);
    },
    onError: (e) => message.error(e instanceof ApiError ? e.message : 'Aktion fehlgeschlagen'),
  });
  const entfernen = useMutation({
    mutationFn: (benutzerId: number) => entferneMitglied(einsatzId, benutzerId),
    onSuccess: (liste) => qc.setQueryData(['mitglieder', einsatzId], liste),
    onError: (e) => message.error(e instanceof ApiError ? e.message : 'Aktion fehlgeschlagen'),
  });

  const mitglieder = mitgliederQuery.data ?? [];
  const mitgliedIds = new Set(mitglieder.map((m) => m.benutzer_id));
  const verfuegbar = (benutzerQuery.data ?? []).filter((b) => b.aktiv && !mitgliedIds.has(b.id));

  const spalten: ColumnsType<MitgliedAnzeige> = [
    { title: 'Name', dataIndex: 'anzeigename' },
    {
      title: 'Rolle',
      key: 'rolle',
      render: (_, m) => (
        <Select
          value={m.einsatz_rolle}
          disabled={!istAktiv}
          style={{ width: 170 }}
          options={ROLLEN}
          onChange={(rolle) => setzen.mutate({ benutzerId: m.benutzer_id, rolle })}
        />
      ),
    },
    {
      title: '',
      key: 'aktion',
      render: (_, m) =>
        istAktiv ? (
          <Popconfirm
            title="Mitglied entfernen?"
            okText="Ja"
            cancelText="Abbrechen"
            onConfirm={() => entfernen.mutate(m.benutzer_id)}
          >
            <Button type="link" danger size="small">
              Entfernen
            </Button>
          </Popconfirm>
        ) : null,
    },
  ];

  return (
    <Drawer title="Mitglieder" open={offen} onClose={onClose} width={480}>
      {istAktiv && (
        <Space style={{ marginBottom: 16 }} wrap>
          <Select
            showSearch
            placeholder="Benutzer …"
            style={{ width: 200 }}
            value={neuerBenutzer}
            options={verfuegbar.map((b) => ({ value: b.id, label: b.anzeigename }))}
            optionFilterProp="label"
            onChange={(v) => setNeuerBenutzer(v)}
            notFoundContent={benutzerQuery.isError ? 'Benutzerliste nur für Admins' : undefined}
          />
          <Select value={neueRolle} style={{ width: 170 }} options={ROLLEN} onChange={setNeueRolle} />
          <Button
            type="primary"
            disabled={neuerBenutzer == null}
            loading={setzen.isPending}
            onClick={() =>
              neuerBenutzer != null && setzen.mutate({ benutzerId: neuerBenutzer, rolle: neueRolle })
            }
          >
            Hinzufügen
          </Button>
        </Space>
      )}
      <Table
        rowKey="benutzer_id"
        size="small"
        pagination={false}
        loading={mitgliederQuery.isLoading}
        columns={spalten}
        dataSource={mitglieder}
      />
    </Drawer>
  );
}
```

- [ ] **Step 5: Test ausführen (muss bestehen)**

```bash
cd frontend && npm run test -- src/etb/MitgliederPanel.test.tsx
```
Erwartet: PASS (2 Tests).

- [ ] **Step 6: Mitglieder-Drawer in EtbPage einbinden**

Ergänze in `frontend/src/pages/EtbPage.tsx`:

```tsx
import MitgliederPanel from '../etb/MitgliederPanel';
```

State (bei den übrigen `useState`):

```tsx
  const [mitgliederOffen, setMitgliederOffen] = useState(false);
```

Nach `const einsatz = einsatzQuery.data;`:

```tsx
  const istEinsatzleitung = einsatz.meine_rolle === 'einsatzleitung';
```

Im Header-`Space` (rechts) einen Button ergänzen:

```tsx
        {istEinsatzleitung && (
          <Button onClick={() => setMitgliederOffen(true)}>Mitglieder</Button>
        )}
```

Und am Ende des äußeren `<div>` (nach der Schnellerfassung) den Drawer:

```tsx
      {istEinsatzleitung && (
        <MitgliederPanel
          einsatzId={einsatzId}
          istAktiv={einsatz.status === 'aktiv'}
          offen={mitgliederOffen}
          onClose={() => setMitgliederOffen(false)}
        />
      )}
```

- [ ] **Step 7: Gesamtsuite + Typecheck**

```bash
cd frontend && npm run test && npm run typecheck
```
Erwartet: alles grün.

- [ ] **Step 8: Commit**

```bash
cd frontend && git add src/api/benutzer.ts src/etb/MitgliederPanel.tsx src/etb/MitgliederPanel.test.tsx src/pages/EtbPage.tsx
git commit -m "feat(frontend): Mitglieder-Verwaltung im Einsatz (Drawer)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 16: Benutzerverwaltung (Admin)

**Files:**
- Modify: `frontend/src/pages/BenutzerPage.tsx` (Platzhalter ersetzen)
- Test: `frontend/src/pages/BenutzerPage.test.tsx`

> Die Route `/benutzer` und der Topbar-Link existieren bereits (Tasks 4/5, Admin-only). Das API-Modul stammt aus Task 15.

- [ ] **Step 1: Test für die Benutzerverwaltung schreiben**

`frontend/src/pages/BenutzerPage.test.tsx`:

```tsx
import { http, HttpResponse } from 'msw';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import BenutzerPage from './BenutzerPage';

function benutzer(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: 1, anzeigename: 'Admin', benutzername: 'admin', system_rolle: 'admin',
    org_rolle: 'keine', aktiv: true, erstellt_at: '2026-05-23 10:00:00', ...over,
  };
}

describe('BenutzerPage', () => {
  it('listet Benutzer', async () => {
    server.use(http.get('/api/benutzer', () => HttpResponse.json([benutzer()])));
    renderMitProviders(<BenutzerPage />);
    expect(await screen.findByText('Admin')).toBeInTheDocument();
  });

  it('legt einen neuen Benutzer an', async () => {
    let angelegt = false;
    server.use(
      http.get('/api/benutzer', () =>
        HttpResponse.json(angelegt ? [benutzer(), benutzer({ id: 2, anzeigename: 'Eva', benutzername: 'eva', system_rolle: 'keiner' })] : [benutzer()]),
      ),
      http.post('/api/benutzer', () => {
        angelegt = true;
        return HttpResponse.json(benutzer({ id: 2, anzeigename: 'Eva', benutzername: 'eva' }), {
          status: 201,
        });
      }),
    );
    renderMitProviders(<BenutzerPage />);
    await userEvent.click(await screen.findByRole('button', { name: 'Benutzer anlegen' }));
    await userEvent.type(screen.getByLabelText('Anzeigename'), 'Eva');
    await userEvent.type(screen.getByLabelText('Benutzername'), 'eva');
    await userEvent.type(screen.getByLabelText('Passwort'), 'geheim123');
    await userEvent.click(screen.getByRole('button', { name: 'Anlegen' }));
    await waitFor(() => expect(screen.getByText('Eva')).toBeInTheDocument());
  });
});
```

- [ ] **Step 2: Test ausführen (muss fehlschlagen)**

```bash
cd frontend && npm run test -- src/pages/BenutzerPage.test.tsx
```
Erwartet: FAIL — Platzhalter rendert keine Liste.

- [ ] **Step 3: BenutzerPage implementieren**

`frontend/src/pages/BenutzerPage.tsx`:

```tsx
import { App, Button, Form, Input, List, Modal, Popconfirm, Select, Space, Tag, Typography } from 'antd';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { BenutzerAnzeige } from '../api/types';
import { ApiError } from '../api/client';
import { deaktiviereBenutzer, legeBenutzerAn, listeBenutzer, type NeuerBenutzer } from '../api/benutzer';

const SYSTEM_ROLLEN = [
  { value: 'keiner', label: 'Benutzer' },
  { value: 'admin', label: 'Admin' },
];
const ORG_ROLLEN = [
  { value: 'keine', label: 'Keine' },
  { value: 'fuehrungskraft', label: 'Führungskraft (darf Einsätze anlegen)' },
];

export default function BenutzerPage() {
  const qc = useQueryClient();
  const { message } = App.useApp();
  const [offen, setOffen] = useState(false);
  const [form] = Form.useForm<NeuerBenutzer>();

  const { data: benutzer = [], isLoading } = useQuery({
    queryKey: ['benutzer'],
    queryFn: listeBenutzer,
  });

  const anlegen = useMutation({
    mutationFn: (b: NeuerBenutzer) => legeBenutzerAn(b),
    onSuccess: () => {
      setOffen(false);
      form.resetFields();
      qc.invalidateQueries({ queryKey: ['benutzer'] });
    },
    onError: (e) => message.error(e instanceof ApiError ? e.message : 'Anlegen fehlgeschlagen'),
  });

  const deaktivieren = useMutation({
    mutationFn: (id: number) => deaktiviereBenutzer(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['benutzer'] }),
    onError: (e) => message.error(e instanceof ApiError ? e.message : 'Deaktivieren fehlgeschlagen'),
  });

  return (
    <div style={{ maxWidth: 800, margin: '0 auto' }}>
      <Space style={{ width: '100%', justifyContent: 'space-between', marginBottom: 16 }}>
        <Typography.Title level={3} style={{ margin: 0 }}>
          Benutzer
        </Typography.Title>
        <Button type="primary" onClick={() => setOffen(true)}>
          Benutzer anlegen
        </Button>
      </Space>

      <List
        loading={isLoading}
        bordered
        dataSource={benutzer}
        renderItem={(b: BenutzerAnzeige) => (
          <List.Item
            actions={
              b.aktiv
                ? [
                    <Popconfirm
                      key="deaktivieren"
                      title="Benutzer deaktivieren?"
                      okText="Ja"
                      cancelText="Abbrechen"
                      onConfirm={() => deaktivieren.mutate(b.id)}
                    >
                      <Button type="link" danger size="small">
                        Deaktivieren
                      </Button>
                    </Popconfirm>,
                  ]
                : []
            }
          >
            <List.Item.Meta
              title={b.anzeigename}
              description={
                <Space>
                  <span>@{b.benutzername}</span>
                  {b.system_rolle === 'admin' && <Tag color="gold">Admin</Tag>}
                  {b.org_rolle === 'fuehrungskraft' && <Tag color="blue">Führungskraft</Tag>}
                  {!b.aktiv && <Tag>deaktiviert</Tag>}
                </Space>
              }
            />
          </List.Item>
        )}
      />

      <Modal
        title="Neuen Benutzer anlegen"
        open={offen}
        onCancel={() => setOffen(false)}
        onOk={() => form.submit()}
        okText="Anlegen"
        confirmLoading={anlegen.isPending}
      >
        <Form
          form={form}
          layout="vertical"
          initialValues={{ system_rolle: 'keiner', org_rolle: 'keine' }}
          onFinish={(w) => anlegen.mutate(w)}
        >
          <Form.Item
            label="Anzeigename"
            name="anzeigename"
            rules={[{ required: true, message: 'Bitte Anzeigename eingeben' }]}
          >
            <Input autoFocus />
          </Form.Item>
          <Form.Item
            label="Benutzername"
            name="benutzername"
            rules={[{ required: true, message: 'Bitte Benutzername eingeben' }]}
          >
            <Input autoComplete="off" />
          </Form.Item>
          <Form.Item
            label="Passwort"
            name="passwort"
            rules={[{ required: true, min: 8, message: 'Mindestens 8 Zeichen' }]}
          >
            <Input.Password autoComplete="new-password" />
          </Form.Item>
          <Form.Item label="System-Rolle" name="system_rolle">
            <Select options={SYSTEM_ROLLEN} />
          </Form.Item>
          <Form.Item label="Org-Rolle" name="org_rolle">
            <Select options={ORG_ROLLEN} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
```

- [ ] **Step 4: Test ausführen (muss bestehen)**

```bash
cd frontend && npm run test -- src/pages/BenutzerPage.test.tsx
```
Erwartet: PASS (2 Tests).

- [ ] **Step 5: Commit**

```bash
cd frontend && git add src/pages/BenutzerPage.tsx src/pages/BenutzerPage.test.tsx
git commit -m "feat(frontend): Benutzerverwaltung (Admin) – Liste, Anlegen, Deaktivieren

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 17: Playwright-E2E (Kernfluss inkl. Live-SSE)

End-to-End gegen ein real laufendes Backend: Login → Einsatz anlegen → ETB öffnen → Eintrag erfassen → Eintrag erscheint **live** (über SSE) in einem zweiten Client.

**Files:**
- Create: `frontend/playwright.config.ts`, `frontend/e2e/kernfluss.spec.ts`

> Die `frontend/.gitignore` (inkl. `playwright-report/`, `test-results/`) wurde bereits in Task 1 angelegt.

- [ ] **Step 1: Playwright-Browser installieren**

```bash
cd frontend && npx playwright install chromium
```

- [ ] **Step 2: Playwright-Config anlegen** (Ports aus ENV, nicht fest)

`frontend/playwright.config.ts`:

```ts
import { defineConfig, devices } from '@playwright/test';

// Dev-Port wie in vite.config aus ENV (von `npm run setup` gesetzt), Default 5173.
const frontendPort = process.env.FRONTEND_PORT || '5173';
const baseURL = process.env.FRONTEND_URL || `http://localhost:${frontendPort}`;

/** Startet automatisch den Vite-Dev-Server (erbt ENV → liest FRONTEND_PORT/
 *  LIFELINE_BACKEND_URL). Das Backend muss separat auf dem konfigurierten Port
 *  laufen (siehe Step 5). */
export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  expect: { timeout: 10_000 },
  use: { baseURL, trace: 'on-first-retry' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npm run dev',
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
```

- [ ] **Step 3: E2E-Test schreiben**

`frontend/e2e/kernfluss.spec.ts`:

```ts
import { expect, test, type Page } from '@playwright/test';

const ADMIN = 'admin';
const PW = process.env.E2E_ADMIN_PW ?? 'e2e-admin-pw';

async function anmelden(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Benutzername').fill(ADMIN);
  await page.getByLabel('Passwort').fill(PW);
  await page.getByRole('button', { name: 'Anmelden' }).click();
  await expect(page).toHaveURL(/\/einsaetze/);
}

async function einsatzOeffnen(page: Page, name: string) {
  await page
    .getByRole('listitem')
    .filter({ hasText: name })
    .getByRole('button', { name: 'Öffnen' })
    .click();
  await expect(page.getByRole('heading', { name })).toBeVisible();
}

test('Login → Einsatz → Eintrag live in zweitem Client', async ({ browser }) => {
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const a = await ctxA.newPage();
  const b = await ctxB.newPage();

  await anmelden(a);

  // Einsatz anlegen (eindeutige Bezeichnung pro Lauf)
  const name = `E2E Einsatz ${Date.now()}`;
  await a.getByRole('button', { name: 'Einsatz anlegen' }).click();
  await a.getByLabel('Bezeichnung').fill(name);
  await a.getByRole('button', { name: 'Anlegen' }).click();
  await expect(a.getByText(name)).toBeVisible();

  await einsatzOeffnen(a, name);

  // Zweiter Client öffnet denselben Einsatz und wartet auf Live-Eintrag
  await anmelden(b);
  await einsatzOeffnen(b, name);

  // A erfasst einen Eintrag
  const inhalt = `Live-Test ${Date.now()}`;
  await a.getByPlaceholder('Inhalt …').fill(inhalt);
  await a.getByRole('button', { name: 'Erfassen' }).click();
  await expect(a.getByText(inhalt)).toBeVisible();

  // B sieht den Eintrag ohne manuelles Neuladen (SSE-Live)
  await expect(b.getByText(inhalt)).toBeVisible();

  await ctxA.close();
  await ctxB.close();
});
```

- [ ] **Step 4: Dev-Umgebung einrichten + Backend mit frischer DB starten**

Zuerst freie Ports vergeben (schreibt `frontend/.env.local`):

```bash
cd frontend && npm run setup
```
Notiere den ausgegebenen **Backend-Port** (Variable `<BACKEND_PORT>`) und starte das Backend passend (separates Terminal, aus dem Repo-Root, frische DB):

```bash
rm -f /tmp/lifeline-e2e.db
cargo run -- --db-path /tmp/lifeline-e2e.db --admin-user admin --admin-password e2e-admin-pw --bind 127.0.0.1:<BACKEND_PORT>
```
Erwartet: Log „Server lauscht auf 127.0.0.1:<BACKEND_PORT>" und „Admin-Konto 'admin' angelegt". Der Vite-Dev-Server (von Playwright gestartet) liest `LIFELINE_BACKEND_URL`/`FRONTEND_PORT` aus `.env.local` und proxyt dorthin.

- [ ] **Step 5: E2E ausführen**

```bash
cd frontend && E2E_ADMIN_PW=e2e-admin-pw npm run e2e
```
Erwartet: 1 passed. Der zweite Client zeigt den Eintrag, der nur per SSE (ohne Reload) ankommt → bestätigt den Live-Pfad end-to-end.

> Schlägt der Live-Schritt (B sieht den Eintrag) fehl, prüfe, ob der Vite-Proxy SSE durchreicht (sollte er; `http-proxy` streamt). Notfalls in `vite.config.ts` für `/api` `configure` mit deaktivierter Pufferung ergänzen. Schlägt bereits der Login fehl, prüfe, dass das Backend mit genau diesem Passwort frisch gebootstrappt wurde (bestehende DB löschen) und auf dem in `.env.local` hinterlegten Port läuft.

- [ ] **Step 6: Backend stoppen** (Ctrl+C im Backend-Terminal) **und committen**

```bash
cd frontend && git add playwright.config.ts e2e/kernfluss.spec.ts
git commit -m "test(frontend): Playwright-E2E für Kernfluss inkl. Live-SSE

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 18: Gesamt-Verifikation + Roadmap aktualisieren

**Files:**
- Modify: `docs/superpowers/PROGRESS.md`

- [ ] **Step 1: Alle Gates grün**

```bash
cd frontend && npm run test && npm run typecheck && npm run lint && npm run build
```
Erwartet: alle Vitest-Tests grün, kein Typfehler, Lint sauber (oder nur unkritische Warnungen), Build erfolgreich inkl. PWA-Artefakte.

- [ ] **Step 2: Manueller Smoke-Test gegen das Backend**

`cd frontend && npm run setup` (vergibt freie Ports), Backend aus dem Repo-Root mit dem ausgegebenen `--bind …`-Port starten, dann `npm run dev` und die ausgegebene Frontend-URL im Browser öffnen. Durchklicken: anmelden → Einsatz anlegen → öffnen → Eintrag erfassen (erscheint live) → optionale Felder/Berichtigung → Filter → Mitglieder-Drawer → (als Admin) Benutzerverwaltung → Einsatz abschließen (Schnellerfassung verschwindet).

- [ ] **Step 3: PROGRESS.md aktualisieren**

In `docs/superpowers/PROGRESS.md` die Plan-5-Zeile auf erledigt setzen (Status-Spalte), z.B.:

```markdown
| 5 | **Frontend (React + Ant Design PWA)** — Login, Einsatzauswahl, ETB-Ansicht, Schnellerfassung, SSE-Client, Offline-Queue (IndexedDB), Mitglieder-/Benutzerverwaltung | ✅ **DONE** — Branch `worktree-feat+einsatz-rollen`, Frontend unter `frontend/` |
```

Im Abschnitt „Dateien" ergänzen:

```markdown
- Plan 5 (DONE): `docs/superpowers/plans/2026-05-23-frontend-react-antd-pwa.md`
```

Und den Schluss-Absatz „So startest du einen neuen Chat" auf den nächsten Schritt setzen: **Plan 6 (Backup/Restore + Packaging, inkl. Frontend-Embedding in die Binary)**.

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/PROGRESS.md
git commit -m "docs: Plan 5 (Frontend) abgeschlossen, Roadmap aktualisiert

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Selbst-Review (Spec-Abdeckung)

| Spec-Anforderung (T1, Frontend-relevant) | Task |
|---|---|
| Login / lokale Konten | 3, 4 |
| Einsatzauswahl + Anlegen | 6 |
| ETB-Ansicht: Tabelle, Typ farbcodiert, Von→An, Erfasser | 7 |
| ⧖-Markierung bei `ereigniszeit` ≠ `received_at` (Spec §11) | 7 |
| Berichtigungen optisch hervorgehoben + verknüpft (Spec §13) | 8 |
| Such-/Filterleiste (Volltext, Typ, Zeitraum) (Spec §12) | 9 |
| Pagination (`before_lfd_nr`) | 7 |
| Schnellerfassung (Pflicht typ+inhalt, ausklappbare Optionalfelder) (Spec §10) | 10 |
| Drei-Zeitstempel: `ereigniszeit`/`erfasst_lokal_at` clientseitig (Spec §11) | 10 |
| Live-Updates via SSE (Spec §11) | 11 |
| `lagged` → Resync | 11 |
| Offline-Puffer (IndexedDB), Flush bei Reconnect (Spec §11) | 12 |
| PWA installierbar / App-Shell offline (Spec §13) | 1, 13 |
| Rollen-Gating (Beobachter read-only, Schreibrecht nur Leitung/Führung) | 10 |
| Einsatz-Lebenszyklus: abschließen → read-only (Spec §9) | 14 |
| Rollen pro Einsatz zuweisen (Spec §7) | 15 |
| Benutzerverwaltung durch Admin (Spec §4/§7) | 16 |
| Theming über antd Design-Tokens (Spec §13) | 1 |
| E2E Kernfluss (Spec §16) | 17 |

**Bewusst NICHT in diesem Plan (dokumentiert):**
- Frontend-Embedding in die Rust-Binary / Single-Binary-Build → **Plan 6**.
- Nicht-Admin-Endpoint zum Auflisten von Benutzern (für Mitglieder-Auswahl durch Nicht-Admin-Einsatzleitung) → **Backend-Folgethema**.
- PDF-/Druck-Export, Schnellbausteine, Server-Discovery → laut Spec out of scope T1.
