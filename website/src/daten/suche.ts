/**
 * Bausteine der Suchindizes (`/doku/suche.json`, `/architektur/suche.json`): Abschnitte einer
 * gerenderten Seite samt Sprungmarke und Klartext. Gelesen von `components/DokuSuche.astro`.
 */

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
  /** Adresse der Seite, wenn sie nicht `/doku/<k>/` ist (Architektur). */
  u?: string;
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

export function abschnitte(html: string): SuchAbschnitt[] {
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
