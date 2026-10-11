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
  wörtlich), `src/components/Bildmarke.astro` (aus `frontend/src/marke/bildmarkeGeometrie.ts`),
  `src/daten/gruppen.ts` (aus `frontend/src/hilfe/gruppen.ts`), `src/daten/bereiche.ts` (aus
  `frontend/src/hilfe/bereiche.ts`, Bereiche und Kurztext) und `public/schriften/` samt
  Lizenztexten (aus `frontend/src/assets/fonts/`). Wer dort eine Rolle, ein Modul, eine
  Lesergruppe, die Marke oder einen Schnitt ändert, zieht es hier nach.
- **Doku** (`src/pages/doku/`, LFH-1096): die Anwenderdokumentation aus
  `docs/anwender/kapitel/`, gelesen als Content-Collection (`src/content.config.ts`, Glob-Loader
  mit Basis außerhalb von `website/`), nie kopiert. Form und Regeln der Kapitel:
  `docs/anwender/AGENTS.md`. Links zwischen Kapiteln (`ohne-netz.md`) setzt die Kapitelseite am
  gerenderten HTML auf `/doku/<name>/`; Remark-Plugins bräuchten unter Astro 7 (Sätteri) ein
  weiteres Paket. Bilder (`../bilder/<kapitel>/<name>.png`, LFH-1128) gibt die Bildpipeline der
  Collection unverändert unter `/_astro/` aus; ihren Platzhalter im HTML ersetzt die
  Kapitelseite durch `<img>` mit Adresse und Maßen aus einem Glob über `docs/anwender/bilder/`
  (keine Kopie nach `public/`), je Bild die helle und die dunkle Fassung (`<name>.dunkel.png`);
  sichtbar ist die zum Modus passende, im Druck die helle. Ein fehlendes Bild bricht den Build.
  Ein Kapitel-PR ändert nur `docs/anwender/`, also stehen in den Build-Überwachungspfaden des
  Pages-Projekts `website/*` **und** `docs/anwender/*`.
- **Suche** (`src/components/DokuSuche.astro`, im `Grundriss` jeder Seite): Dialog über ⌘K /
  Strg+K, „/“ und den Suchknopf der Kopfleiste. Der Index `/doku/suche.json`
  (`src/pages/doku/suche.json.ts`) entsteht beim Bauen aus denselben Kapiteln, mit den
  Sprungmarken der gerenderten Überschriften, und lädt erst beim ersten Öffnen. Kein Suchdienst,
  keine Bibliothek.
- **Gestaltung wie die App** (`frontend/AGENTS.md`, Gestaltungssprache): Nachtbetrieb ist
  Vorgabe, Radius 0, Fugenraster, Rot bedient nichts, Zahlen in Mono. Schriften nur lokal,
  kein CDN.
- **Nichts versprechen, was das Produkt nicht kann.** Aussagen stützen sich auf `README.md`,
  die Bereichsdateien und `docs/betrieb/`. Beispieldaten (Einsatz, ETB, Meldebild) tragen
  sichtbar „Beispiel“; keine Kundenstimmen, Nutzerzahlen oder Preise ohne Quelle.
