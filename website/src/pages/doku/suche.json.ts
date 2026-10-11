/**
 * Suchindex der Anwenderdokumentation (`/doku/suche.json`), gebaut aus denselben Kapiteln wie die
 * Seiten (`docs/anwender/kapitel/`). Je Kapitel ein Eintrag mit Titel, Bereich, Kurztext und den
 * Abschnitten (`##`/`###`) samt ihrer Sprungmarke und ihrem Klartext. Die Sprungmarken stammen aus
 * dem gerenderten HTML, also genau die IDs, die die Kapitelseite trägt.
 *
 * Geladen erst, wenn jemand die Suche öffnet (`components/DokuSuche.astro`).
 */
import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';
import { bereichVon, kurztext } from '../../daten/bereiche';

export interface SuchAbschnitt {
  /** Sprungmarke der Überschrift. */
  id: string;
  /** Text der Überschrift. */
  t: string;
  /** 2 = `##`, 3 = `###`. */
  e: 2 | 3;
  /** Klartext bis zur nächsten Überschrift. */
  x: string;
}

export interface SuchKapitel {
  k: string;
  t: string;
  b: string;
  kurz: string;
  a: SuchAbschnitt[];
}

const ENTITAETEN: Record<string, string> = {
  '&quot;': '"',
  '&#39;': "'",
  '&lt;': '<',
  '&gt;': '>',
  '&amp;': '&',
};

function klartext(html: string): string {
  return html
    .replace(/<img[^>]*>/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&(quot|#39|lt|gt|amp);/g, (m) => ENTITAETEN[m] ?? m)
    .replace(/\s+/g, ' ')
    .trim();
}

function abschnitte(html: string): SuchAbschnitt[] {
  const teile = html.split(/(?=<h[23] id=")/);
  const aus: SuchAbschnitt[] = [];
  for (const teil of teile) {
    const m = /^<h([23]) id="([^"]+)"[^>]*>([\s\S]*?)<\/h\1>([\s\S]*)$/.exec(teil);
    if (!m) continue;
    aus.push({
      id: m[2],
      t: klartext(m[3]),
      e: Number(m[1]) as 2 | 3,
      x: klartext(m[4]),
    });
  }
  return aus;
}

export const GET: APIRoute = async () => {
  const kapitel = (await getCollection('kapitel')).sort(
    (a, b) => a.data.reihenfolge - b.data.reihenfolge,
  );
  const index: SuchKapitel[] = kapitel.map((k) => ({
    k: k.id,
    t: k.data.titel,
    b: bereichVon(k.data.reihenfolge),
    kurz: kurztext(k.body ?? ''),
    a: abschnitte(k.rendered?.html ?? ''),
  }));
  return new Response(JSON.stringify(index), {
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
};
