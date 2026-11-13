// Marketing-Seite (LFH-1111): rein statisch, keine Integrationen, kein Adapter.
// Regeln: website/AGENTS.md.
import { defineConfig } from 'astro/config';

export default defineConfig({
  // Öffentliche Adresse; daraus baut `src/pages/sitemap.xml.ts` absolute URLs.
  site: 'https://lifeline-hub.de',
  output: 'static',
  trailingSlash: 'ignore',
  build: { format: 'directory' },
  devToolbar: { enabled: false },
});
