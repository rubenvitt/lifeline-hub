# Proposal

## Why

Lifeline Hub hat kein Zeichen, an dem man die App wiedererkennt (LFH-837). Das Desktop-Symbol
ist ein rotes Quadrat, das aus dem Favicon-Platzhalter erzeugt wurde. Die PWA-Symbole sind
1×1-Pixel-Platzhalter. Im Dock, in der Taskleiste und auf dem Tablet-Startbildschirm ist die App
deshalb nicht zu finden. Die Oberfläche selbst trägt als Marke nur ein 14-px-Quadrat in `marke`.
Am 30.09.2026 wurde entschieden: Entwurf B „Lebenslinie“ wird das **generelle Logo der App**,
nicht nur das Symbol der Hülle.

## What Changes

- Neue **Bildmarke „Lebenslinie“**: eine helle Pulslinie, die in einem Quadrat in `marke`
  (#a8071a) endet. Rot bleibt Akzent, die Linie trägt das Zeichen.
- **Oberfläche:** Die Markenzelle der Kopfleiste und der Markenbereich der Anmeldeseite zeigen
  die Bildmarke statt des 14-px-Quadrats. Die Wortmarke `lifeline-hub` bleibt daneben stehen.
- **Browser und PWA:** Das Favicon wird die Bildmarke auf Kopf-Schwarz. Die PWA-Symbole werden in
  Nenngröße erzeugt (192/512 px). Neu kommen ein maskierbares Symbol und ein Symbol für den
  Startbildschirm von iPad/iPhone (180 px) hinzu.
- **Desktop-Hülle:** `src-tauri/icons/*` werden aus derselben Quelle neu erzeugt. Für macOS
  entsteht ein Symbol nach dem Raster der Plattform (abgerundete Grundform mit Rand).
- **Manifest:** `theme_color` und `background_color` wechseln von Rot/Weiß auf Kopf-Schwarz
  `#0c0e11`. Der Rahmen ist in Tag und Nacht dunkel (LFH-434), also passt eine Farbe für beide
  Betriebsarten.
- Ein **Erzeugungsskript** baut alle Symbole aus den Quell-SVGs neu. Ein Guard-Test hält
  Geometrie, Nenngrößen und Manifest-Einträge fest.
- Die Gestaltungsvorgabe (`umsetzung.md`, CLAUDE.md) nennt die Bildmarke statt „Logo-Quadrat“.
  Der Punkt „App-Symbol ist Platzhalter“ entfällt aus den Grenzen in `docs/betrieb/desktop-app.md`.

## Capabilities

### New Capabilities

- `app-marke`: das Zeichen der App. Es beschreibt, wo die Bildmarke erscheint (Oberfläche,
  Browser, installierte PWA, Desktop-App), in welcher Form es dort erscheint (Größen, maskierbar,
  Farben von Titelleiste und Startbildschirm) und dass Rot darin nur Akzent ist.

### Modified Capabilities

(keine: `desktop-huelle` und `desktop-auslieferung` stellen keine Anforderung an das Symbol,
`org-branding` betrifft das Logo der Organisation im Druck, nicht das Zeichen der App.)

## Impact

- **Frontend:** neue Bildmarke unter `src/marke/`. Angepasst werden `components/Kopfleiste.tsx`
  (`Markenzelle`), `pages/LoginPage.tsx` und `.css`, `index.html` (apple-touch-icon,
  theme-color) sowie `vite.config.ts`, dessen Manifest in eine eigene Datei wandert.
  `public/` bekommt ein neues `favicon.svg`, `pwa-192.png`, `pwa-512.png`,
  `pwa-maskable-512.png` und `apple-touch-icon.png`.
- **Desktop-Hülle:** `src-tauri/icons/*` werden neu erzeugt. Die Dateiliste und
  `tauri.conf.json` bleiben unverändert.
- **Werkzeug:** `scripts/marke/` (Quell-SVGs und Erzeugungsskript, nutzt `cargo tauri icon`).
  Kein neues Paket.
- **Service Worker:** `includeAssets` und das Manifest ändern den Precache. Nachweis über
  `e2e/lagekarte-offline-precache.spec.ts`.
- **Keine** Änderung an Backend, API oder Org-Branding (`Druckkopf` behält das Org-Logo).
