# Marketing-Seite — Regeln

Gilt für `website/`, zusätzlich zur `AGENTS.md` der Wurzel. Eigenständiges Astro-Projekt
(LFH-1111), rein statisch, nicht Teil der Anwendung und nicht im Binary.

- **Bauen:** `mise exec -- pnpm -C website install` und `… build` (Ergebnis `website/dist/`).
  Eigenes `package.json`, Lockfile und `pnpm-workspace.yaml`; nichts aus `frontend/` wird
  importiert, damit die Seite ohne die App baut. Kein Schritt in `scripts/check-all.sh`.
- **Bereitstellung:** Cloudflare Pages, Projekt `lifeline-hub` (https://lifeline-hub.pages.dev),
  verbunden mit dem Repo, Produktions-Branch `alpha`. Stammverzeichnis `website`, Build-Befehl
  `pnpm build`, Ausgabe `dist`; Cloudflare installiert selbst aus dem Lockfile. Node und pnpm
  setzen dort die Umgebungsvariablen `NODE_VERSION` und `PNPM_VERSION`: wer `engines` oder
  `packageManager` in `website/package.json` hebt, zieht beide im Pages-Projekt nach.
- **CI:** `website/` löst keine schwere Suite aus; ein PR, der nur hier ändert, fährt nur die
  Schnellprüfungen (Bereichs-Erkennung, `scripts/AGENTS.md`).
- **Kopien statt zweiter Quelle:** `src/styles/rollen.css` (aus `frontend/src/theme/rollen.css`),
  `src/daten/module.ts` (aus `frontend/src/einsatz/modulRegistry.ts`, Name und Beschreibung
  wörtlich), `src/components/Bildmarke.astro` (aus `frontend/src/marke/bildmarkeGeometrie.ts`)
  und `public/schriften/` samt Lizenztexten (aus `frontend/src/assets/fonts/`). Wer dort eine
  Rolle, ein Modul, die Marke oder einen Schnitt ändert, zieht es hier nach.
- **Gestaltung wie die App** (`frontend/AGENTS.md`, Gestaltungssprache): Nachtbetrieb ist
  Vorgabe, Radius 0, Fugenraster, Rot bedient nichts, Zahlen in Mono. Schriften nur lokal,
  kein CDN.
- **Nichts versprechen, was das Produkt nicht kann.** Aussagen stützen sich auf `README.md`,
  die Bereichsdateien und `docs/betrieb/`. Beispieldaten (Einsatz, ETB, Meldebild) tragen
  sichtbar „Beispiel“; keine Kundenstimmen, Nutzerzahlen oder Preise ohne Quelle.
