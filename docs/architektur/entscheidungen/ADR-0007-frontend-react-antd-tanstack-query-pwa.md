---
id: ADR-0007
titel: Das Frontend ist eine React-PWA mit antd und TanStack Query
status: akzeptiert
datum: 2026-05-23
gilt_fuer:
  - frontend/package.json
  - frontend/vite.config.ts
  - frontend/src/main.tsx
  - frontend/src/api/queryClient.ts
herleitung:
  - docs/superpowers/specs/2026-05-23-fundament-etb-kern-design.md
  - docs/superpowers/plans/2026-05-23-frontend-react-antd-pwa.md
---

# ADR-0007: Das Frontend ist eine React-PWA mit antd und TanStack Query

## Regeln

- MUST: Oberflächen-Bausteine kommen aus antd; Gestaltung über Tokens und die Regeln in
  `frontend/AGENTS.md` („Gestaltungssprache“, „UI-Form-Leitlinie“).
- MUST: Serverzustand liegt in TanStack Query; Schlüssel nur aus der Registry
  (`frontend/AGENTS.md`, „Query-Key-Registry“).
- MUST NOT: keine zweite Komponentenbibliothek (MUI, Chakra, Mantine, Bootstrap) und keine
  zweite Bibliothek für Serverzustand oder HTTP (SWR, Redux, Apollo, axios).
- MUST: Die App ist eine installierbare PWA über `vite-plugin-pwa`; Seitenwechsel auf `/api/`
  beantwortet der Service Worker nie mit der App-Hülle (`navigateFallbackDenylist` in
  `frontend/vite.config.ts`).
- SHOULD: Browserspeicher nur über die Regeln in `frontend/AGENTS.md`, „Browserspeicher“.

## Prüfung

```sh
verlange '"react":' frontend/package.json
verlange '"antd":' frontend/package.json
verlange '"@tanstack/react-query":' frontend/package.json
verlange '"vite-plugin-pwa":' frontend/package.json
verbiete '"(@mui/[a-z-]+|@chakra-ui/[a-z-]+|@mantine/[a-z-]+|bootstrap|react-bootstrap|semantic-ui-react|swr|axios|redux|@reduxjs/toolkit|@apollo/client|vue|svelte|@angular/core)":' frontend/package.json
verlange 'navigateFallbackDenylist: \[/\^\\/api\\//' frontend/vite.config.ts
```

## Kontext

Die Einsatzführung braucht datendichte Tabellen und Formulare, bedienbar unter Stress auf
Laptop, Tablet und Handy. Das Fundament-Design wählte React mit Ant Design, weil diese Bausteine
fertig vorliegen, und eine PWA, damit die App ohne Store installierbar ist. TanStack Query
übernimmt Cache, Invalidierung nach Live-Ereignissen ([ADR-0003](ADR-0003-live-aktualisierung-ueber-sse-mit-liveevent-kontrakt.md))
und die Ablage für das Lagebild ohne Netz ([ADR-0008](ADR-0008-offline-lagebild-und-schreib-warteschlange.md)).

## Konsequenzen

Eine Bibliothek für Bausteine und eine für Serverzustand halten das Bundle und die Regeln
überschaubar; eigene Primitive bauen auf antd auf. Abweichungen vom antd-Standard kosten eigene
Gestaltungsregeln und Wächter (`frontend/src/**/*.guard.test.ts`). Die Desktop-Hülle lädt genau
diese Web-App ([ADR-0009](ADR-0009-desktop-huelle-tauri-ohne-anwendungslogik.md)).
