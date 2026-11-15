import { expect, type Page } from '@playwright/test';
import { ladeInDichte } from './trefflaeche-kern';

/**
 * Messhelfer der Schrift-Specs (LLH-1719, Change `i1o47voj-schrift-lesbarkeit`):
 * `schrift-skala.spec.ts` (Größen) und `schrift-mono-grenze.spec.ts` (Mono nur für Kennungen).
 * Gemessen wird, was der Browser rendert: berechnete Größe und Familie je sichtbarem Textknoten.
 */

/** Die sechs Stufen in `kompakt` (`groessenstufen` in `theme/tokens.ts`), als Literal. */
export const STUFEN_PX = [11, 12, 14, 16, 22, 32] as const;
/** Die Stufen, die mit der Dichte wachsen (bis `titel`). */
const WACHSEND = new Set<number>([11, 12, 14, 16]);
/** Faktor je Dichte, als Literal (`dichteFaktor`). */
export const FAKTOR: Record<string, number> = { kompakt: 1, komfortabel: 1.15, handschuh: 1.25 };

/** Die erlaubten Größen einer Dichte, auf zwei Stellen. */
export function erlaubteGroessen(dichte: string): number[] {
  return STUFEN_PX.map((px) =>
    WACHSEND.has(px) ? Math.round(px * FAKTOR[dichte] * 100) / 100 : px,
  );
}

export interface Textprobe {
  text: string;
  groesse: number;
  familie: string;
  zeichen: number;
  kennung: boolean;
}

/**
 * Alle sichtbaren Textknoten unter `wurzel` mit Größe, erster Familie und Zeichenzahl. Nicht Teil
 * der App: die Devtools von TanStack Query; Zeichnungen mit eigenem Maßstab: SVG, Kartenleinwand.
 */
export async function textproben(page: Page, wurzel = 'body'): Promise<Textprobe[]> {
  return page.evaluate((wurzel) => {
    const FREMD = 'script, style, noscript, svg, canvas, .tsqd-parent-container, [class*="tsqd-"]';
    const start = document.querySelector(wurzel);
    if (!start) return [];
    const proben: Textprobe[] = [];
    const gang = document.createTreeWalker(start, NodeFilter.SHOW_TEXT);
    for (let knoten = gang.nextNode(); knoten; knoten = gang.nextNode()) {
      const text = knoten.textContent?.replace(/\s+/g, ' ').trim();
      const el = knoten.parentElement;
      if (!text || !el || el.closest(FREMD)) continue;
      const k = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      if (k.width === 0 || k.height === 0 || s.visibility === 'hidden' || s.display === 'none') {
        continue;
      }
      // Nur für Vorleser (Status-Wort hinter dem Chip u. ä.): nicht gesehen, nicht gemessen.
      if (k.width <= 1 && k.height <= 1) continue;
      proben.push({
        text: text.slice(0, 60),
        groesse: Math.round(parseFloat(s.fontSize) * 100) / 100,
        familie: s.fontFamily
          .split(',')[0]
          .trim()
          .replace(/^["']|["']$/g, ''),
        zeichen: text.length,
        kennung: el.closest('[data-schrift="kennung"]') != null,
      });
    }
    return proben;
  }, wurzel);
}

/** Lädt eine Seite in einer Dichte (`ladeInDichte`, eine Ladung) und wartet auf den Anker. */
export async function ladeSeite(page: Page, pfad: string, dichte: string, anker: string) {
  await ladeInDichte(page, pfad, dichte);
  await expect(page.locator(anker).first()).toBeVisible();
}

/** Ein Einsatz mit ETB-Einträgen, deren Metazeile Wörter trägt („von … an …“). */
export async function einsatzMitEtb(page: Page, name: string): Promise<string> {
  const angelegt = await page.request.post('/api/einsaetze', { data: { bezeichnung: name } });
  expect(angelegt.ok(), `POST /api/einsaetze: ${angelegt.status()}`).toBe(true);
  const id = String(((await angelegt.json()) as { id: number }).id);
  for (const [i, inhalt] of [
    'Pegel am Deichtor 2,40 m, steigend.',
    'Sandsäcke an der Ostseite angefordert.',
    'Abschnitt Nord meldet Lage stabil.',
  ].entries()) {
    const r = await page.request.post(`/api/einsaetze/${id}/etb`, {
      data: { typ: 'meldung', inhalt, von: 'Leitstelle Musterstadt', an: `Einsatzleitung ${i}` },
    });
    expect(r.ok(), `ETB ${i}: ${r.status()}`).toBe(true);
  }
  return id;
}
