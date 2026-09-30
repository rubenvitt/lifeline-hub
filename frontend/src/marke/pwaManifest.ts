import type { ManifestOptions } from 'vite-plugin-pwa';

/**
 * PWA-Manifest (LFH-837). Eigene Datei, damit `marke.guard.test.ts` die Einträge lesen kann,
 * ohne die Vite-Konfiguration zu laden. `vite.config.ts` importiert von hier, deshalb nur Daten,
 * keine Browser-Importe.
 *
 * Farben: Kopf-Schwarz für Titelleiste und Startbildschirm, im Tag- wie im Nachtbetrieb. Der
 * Rahmen der App ist in beiden dunkel (LFH-434), Rot ist Akzent, keine Fläche. Der Wert steht
 * als Literal, weil `vite.config.ts` keine Theme-Module lädt. Der Guard vergleicht ihn mit
 * `farbenDunkel.kopf`.
 *
 * Symbole: 192/512 für „any“, ein eigenes für „maskable“. Ein gemeinsames „any maskable“
 * bediente beide Formen schlecht. Erzeugt von `scripts/marke/erzeuge-symbole.sh`.
 */
export const pwaManifest: Partial<ManifestOptions> = {
  name: 'lifeline-hub',
  short_name: 'lifeline',
  description: 'Elektronisches Einsatztagebuch',
  theme_color: '#0c0e11',
  background_color: '#0c0e11',
  display: 'standalone',
  start_url: '/',
  icons: [
    { src: 'pwa-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
    { src: 'pwa-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
    { src: 'pwa-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
  ],
};
