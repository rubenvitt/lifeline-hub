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
import { abschnitte, type SuchKapitel } from '../../daten/suche';

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
