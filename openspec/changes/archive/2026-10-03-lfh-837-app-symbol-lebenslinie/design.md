# Design

## Context

Warum die Änderung nötig ist, steht in `proposal.md`. Der heutige Stand:

- `frontend/public/favicon.svg` ist ein rotes 32er-Quadrat. `pwa-192.png` und `pwa-512.png` sind
  1×1 px groß. `src-tauri/icons/*` (17 Dateien, davon 5 in `tauri.conf.json` → `bundle.icon`)
  wurden per `cargo tauri icon` aus dem Favicon erzeugt.
- Das Manifest steht inline in `frontend/vite.config.ts`: `theme_color #a8071a`,
  `background_color #ffffff`, zwei Icon-Einträge ohne `purpose`. In `index.html` gibt es weder
  `apple-touch-icon` noch `theme-color`.
- Die Oberfläche kennt zwei Markenstellen. `Markenzelle` in `components/Kopfleiste.tsx` ist ein
  14-px-Quadrat in `rahmenFarben.marke`, `aria-hidden` und eingebunden in `AppLayout` und
  `EinsatzLayout`. `.login-marke__quadrat` in `pages/LoginPage.css` ist ein 14-px-Quadrat in
  `--lfh-marke`.
- Der Rahmen (Kopfleiste und Rail) ist in beiden Betriebsarten dunkel (`rahmenFarben`, LFH-434).
  Die Anmeldeseite folgt der Betriebsart: `--lfh-text` ist hell `#111418` und nachts `#e8ebee`.
- Werkzeug: `cargo tauri icon` ist installiert. Es liest SVG und schreibt mit `-p` beliebige
  PNG-Größen. ImageMagick hat nur den internen SVG-Renderer. Playwright-Chromium steht im
  Frontend bereit.

Der Entwurf wurde am 30.09.2026 an einem Kontaktbogen gewählt: Entwurf B in 160/64/32/16 px auf
hellem und dunklem Grund.

## Goals / Non-Goals

**Goals:**

- Eine Geometrie der Bildmarke. Jede Symboldatei und die Oberfläche folgen ihr, ein Test hält
  Abweichungen auf.
- Alle Symbole lassen sich mit einem Befehl aus den Quellen neu erzeugen, und das Ergebnis lässt
  sich wiederholen.

**Non-Goals:**

- Kein Wechsel von Theme-Farbe oder Favicon je Betriebsart zur Laufzeit. Der Rahmen ist in
  beiden Betriebsarten dunkel.
- Keine Android- oder iOS-App-Symbole der Hülle. Die Hülle wird dort nicht ausgeliefert.
- Das Logo der Organisation im Druckkopf bleibt unberührt (`org-branding`).
- Keine neue Wortmarke. `lifeline-hub` in Mono bleibt.

## Decisions

### D1 Geometrie als Konstante, Quell-SVGs werden dagegen geprüft

`frontend/src/marke/bildmarkeGeometrie.ts` exportiert Pfad und Strichstärke der Pulslinie, das
Quadrat und den engen `viewBox` der Marke. Das Suffix `…Geometrie` vermeidet die
case-insensitive Kollision mit `Bildmarke.tsx`. `Bildmarke.tsx` zeichnet daraus Inline-SVG. Die
Quell-SVGs in `scripts/marke/` binden die Marke über `<g transform>` ein. Der Guard-Test prüft,
dass jede Quelle (und das daraus kopierte `favicon.svg`) wörtlich denselben Pfad und dieselbe
Strichstärke enthält.

- *Alternative: SVG-Datei als einzige Quelle, in React per `?raw` eingebettet.* Verworfen. Die
  Linienfarbe muss in der Oberfläche von der Umgebung kommen (Rahmen dunkel, Anmeldeseite je
  Betriebsart), und das ginge nur über `dangerouslySetInnerHTML` und Textersetzung.
- *Alternative: Node-Skript erzeugt die SVGs aus dem TS-Modul.* Verworfen. Das wäre eine zweite
  Build-Kette für drei Dateien, die sich selten ändern. Der Guard-Test fängt dieselbe Drift.

Die Pulslinie ist ein offener Pfad mit `stroke-linejoin="miter"`, damit die Ecken hart sind
(Radius 0 der Gestaltungssprache). Die Spitze der Zacke ragt als Gehrung über den Pfadpunkt
hinaus. Der enge `viewBox` wird deshalb im Browser mit Strich gemessen (Pixelgrenzen eines
Renders), nicht aus den Pfadpunkten gerechnet.

### D2 Drei Quellen für drei Formfaktoren

In `scripts/marke/` liegen drei Quellen. Alle haben einen Grund in Kopf-Schwarz `#0c0e11`, eine
Linie in `#e8ebee` (`farbenDunkel.text`) und ein Quadrat in `#a8071a`.

| Quelle | Form | Ziel |
|---|---|---|
| `symbol.svg` | vollflächig, eckig (Radius 0), 512er Raster | `favicon.svg`, `pwa-192/512`, `apple-touch-icon` (iOS rundet selbst), Windows/Linux-Symbole der Hülle |
| `symbol-macos.svg` | 1024er Raster, Grundform 824 × 824 mit Eckradius ≈ 185, Rand transparent | nur `icon.icns` |
| `symbol-maskable.svg` | vollflächig, Marke auf den sicheren Kreis verkleinert (≤ 80 % Durchmesser) | `pwa-maskable-512.png` |

Das macOS-Symbol weicht bewusst von Radius 0 ab. Die Konvention der Plattform geht hier vor,
denn sonst wirkt das Symbol im Dock größer und eckiger als alle anderen. Die Abweichung wird in
`umsetzung.md` als Ausnahme vermerkt.

### D3 Erzeugung über `cargo tauri icon`, ein Skript

`scripts/marke/erzeuge-symbole.sh` rendert alle Rastergrafiken mit `cargo tauri icon`. Das ist
ein einziger Renderer (resvg), und er ist ohnehin für die Hülle nötig.

1. Mit `symbol.svg` in ein Wegwerf-Verzeichnis rendern. Übernommen werden nur die Dateien, die
   in `src-tauri/icons/` schon versioniert sind (die Liste kommt aus `git ls-files`). Die
   Standardausgabe `android/` und `ios/` fällt so weg.
2. Mit `symbol-macos.svg` in ein Wegwerf-Verzeichnis rendern und nur `icon.icns` übernehmen.
3. Mit `-p 192 -p 512 -p 180` aus `symbol.svg` die Dateien `pwa-192.png`, `pwa-512.png` und
   `apple-touch-icon.png` erzeugen, mit `-p 512` aus `symbol-maskable.svg` die Datei
   `pwa-maskable-512.png`.
4. `symbol.svg` nach `frontend/public/favicon.svg` kopieren.
5. Einen Stempel `scripts/marke/quellen.sha256` mit den Prüfsummen der drei Quellen schreiben.
   Der Guard vergleicht ihn mit den Quellen und merkt so, wenn eine Quelle nach dem letzten Lauf
   geändert wurde (Befund aus dem Review).

Das Skript verlangt `tauri-cli 2.12.0`, dieselbe Version wie `artefakte.yml`. `icon.icns`
ordnet seine Einträge nicht stabil; bei gleichen Bildern (Vergleich per `iconutil`) bleibt die
vorhandene Datei stehen, damit ein zweiter Lauf keinen Diff erzeugt.

Das Skript ist nicht Teil von `check-all.sh`. Die Ergebnisse werden eingecheckt, und der
Guard-Test prüft sie.

- *Alternative: ImageMagick.* Verworfen, weil der interne SVG-Renderer Gehrungen und Striche
  unzuverlässig zeichnet.
- *Alternative: Playwright-Screenshots.* Verworfen, das wäre ein zweiter Renderer für dieselbe
  Arbeit.

### D4 Manifest in eine eigene Datei

Das Manifest-Objekt wandert nach `frontend/src/marke/pwaManifest.json`. `vite.config.ts` liest es
per `readFileSync` (wie schon die `package.json`), der Guard-Test ebenso. So prüft Vitest die
Einträge, ohne die Vite-Konfiguration zu laden.

- *Alternative: TS-Modul `pwaManifest.ts`, von `vite.config.ts` importiert.* Beim Umsetzen
  verworfen: Die Datei gehörte dann zum Projekt `tsconfig.node.json`, und `tsc -b` legte ihre
  `.js`-Ausgabe daneben. Vite löst `.js` vor `.ts` auf, also läse ein Test nach einer Änderung
  eine veraltete Kopie.

Das Manifest bekommt die Einträge 192/512 mit `purpose: 'any'` und
`pwa-maskable-512.png` mit `purpose: 'maskable'`. Ein gemeinsamer Wert `'any maskable'`
schiede aus, weil dann ein Symbol beide Formen schlecht bedient. `theme_color` und
`background_color` werden `#0c0e11`. `includeAssets` bekommt `apple-touch-icon.png` dazu,
`index.html` bekommt `<link rel="apple-touch-icon">` und `<meta name="theme-color">` mit
demselben Schwarz.

### D5 Oberfläche: `Bildmarke` mit Farbe von außen

`<Bildmarke hoehe linienFarbe />` rendert ein `<svg aria-hidden="true" focusable="false"
data-lfh="bildmarke">`. Das Quadrat hat immer die Farbe `marke`.

- `Markenzelle`: Die Bildmarke steht mit 22 px Höhe (etwa 1,6 × das alte Quadrat) in
  `rahmenFarben.text`, mittig in der Zelle. Die Zelle behält Breite und Haarlinie.
- Anmeldeseite: Das `<span class="login-marke__quadrat">` wird zur `Bildmarke` mit 20 px Höhe
  und der Linienfarbe `var(--lfh-text)`. Damit trägt die Linie im Tag- wie im Nachtbetrieb die
  Textfarbe.

Die Farbe der Bildmarke gilt nicht als Textfarbe im Rahmen, der Kontrastnachweis aus LFH-434
greift also nicht. Sie ist trotzdem `rahmenFarben.text` (16:1). Das Rot hat als reiner Akzent
keinen eigenen Kontrastanspruch. Die Form trägt, Rot ist der zweite Kanal.

### D6 Guard-Test `src/marke/marke.guard.test.ts`

- Liest die IHDR-Breite und -Höhe jeder PNG in `public/` und `src-tauri/icons/`. Jede Datei
  muss die Nenngröße aus ihrem Namen bzw. Manifest-Eintrag haben: `pwa-192` ist 192,
  `128x128@2x` ist 256, `Square44x44Logo` ist 44 usw.
- Das Manifest hat die Einträge any/maskable, und seine Farben sind `#0c0e11`.
- `favicon.svg` und die Quellen enthalten Pfad, Strichstärke, Eckform und Gehrungsgrenze aus
  `bildmarkeGeometrie.ts`; der Stempel passt zu den Quellen.
- `MARKE_RAHMEN` wird analytisch aus Pfad und Strich nachgerechnet (±1), jede Ecke bleibt unter
  der Gehrungsgrenze.
- Maskierbar: Das umschließende Rechteck der Marke (aus Geometrie und Transformation der Quelle)
  liegt mit allen Ecken im Kreis mit Radius 0,4 · Kante.

Die Komponententests für Kopfleiste und Anmeldeseite prüfen, dass die Bildmarke `aria-hidden`
ist und das alte Quadrat fehlt. Sie lesen den Pfad aus derselben Konstante.

## Risks / Trade-offs

- [Bei 16 px (Browser-Tab) ist die Zacke nur noch angedeutet] → Das Kriterium verlangt 32 px.
  Auch bei 16 px bleiben helle Zacke und rotes Quadrat auf Schwarz unterscheidbar
  (Kontaktbogen). Ein eigenes vereinfachtes 16er-Favicon bringt dafür zu wenig.
- [macOS 26 könnte nicht konforme Symbole in eine graue Grundform setzen] → `symbol-macos.svg`
  folgt dem Raster (Grundform mit Rand). Nachweis per Hand im gebauten `.dmg`, keine
  Automatisierung.
- [Neue Precache-Einträge im Service Worker] → Gezielt `e2e/lagekarte-offline-precache.spec.ts`
  und `check-all.sh` laufen lassen.
- [Pfadgleichheit ist textuell] → Die Konstante ist die Quelle. Wer die Geometrie ändert, ändert
  sie dort und lässt das Skript laufen. Der Test nennt beide Schritte in seiner Meldung.

## Migration Plan

Keine Daten- und keine API-Änderung. Installierte PWAs übernehmen die neuen Symbole beim
nächsten Manifest-Abgleich des Browsers. Desktop-Nutzer bekommen das neue Symbol mit dem nächsten
stabilen Release über den Updater. Rückweg: Revert des Commits.
