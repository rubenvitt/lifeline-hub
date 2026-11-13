/**
 * Sitemap (`/sitemap.xml`) für Suchmaschinen: Startseite, Anwenderdokumentation und
 * Architekturdokumentation, gebaut aus denselben Collections wie die Seiten selbst, also ohne
 * zweite Liste. Kein `@astrojs/sitemap`: die Seite kommt ohne Integrationen aus
 * (`website/AGENTS.md`, „Sitemap“). Die Adresse der Seite steht als `site` in `astro.config.mjs`;
 * `public/robots.txt` verweist hierher.
 */
import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';

const escaped = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export const GET: APIRoute = async ({ site }) => {
  if (!site) throw new Error('sitemap.xml braucht `site` in astro.config.mjs');

  const kapitel = await getCollection('kapitel');
  const architektur = await getCollection('architektur', (k) => k.id !== 'README');
  const entscheidungen = await getCollection('entscheidungen');

  const pfade = [
    '/',
    '/doku/',
    ...kapitel.sort((a, b) => a.data.reihenfolge - b.data.reihenfolge).map((k) => `/doku/${k.id}/`),
    '/architektur/',
    ...architektur.map((k) => `/architektur/${k.id}/`).sort(),
    ...entscheidungen
      .sort((a, b) => a.data.id.localeCompare(b.data.id))
      .map((e) => `/architektur/entscheidungen/${e.id}/`),
  ];

  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...pfade.map((pfad) => `  <url><loc>${escaped(new URL(pfad, site).href)}</loc></url>`),
    '</urlset>',
    '',
  ].join('\n');

  return new Response(xml, { headers: { 'Content-Type': 'application/xml; charset=utf-8' } });
};
