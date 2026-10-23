/**
 * Suchindex der Architekturdokumentation (`/architektur/suche.json`, LLH-1435): die zwölf
 * arc42-Kapitel und die Entscheidungen, je mit Adresse (`u`) und ihren Abschnitten. Gebaut aus
 * demselben aufbereiteten HTML wie die Seiten, also mit genau deren Sprungmarken. Diagramme
 * zählen nicht als Text.
 *
 * Geladen erst, wenn jemand auf einer Seite unter `/architektur/` die Suche öffnet
 * (`components/DokuSuche.astro`).
 */
import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';
import { STATUS_NAME, aufbereiten, klartext, kopfVon } from '../../daten/architektur';
import { abschnitte, type SuchKapitel } from '../../daten/suche';

const ohneDiagramme = (html: string) => html.replace(/<figure class="arch-diagramm"[\s\S]*?<\/figure>/g, '');
const ersterAbsatz = (html: string) => klartext(/<p>([\s\S]*?)<\/p>/.exec(html)?.[1] ?? '');

export const GET: APIRoute = async () => {
  const kapitel = (await getCollection('architektur', (k) => k.id !== 'README'))
    .map((k) => {
      const kopf = kopfVon(k.body ?? '');
      const html = ohneDiagramme(
        aufbereiten(k.rendered?.html ?? '', `docs/architektur/${k.id}.md`),
      );
      return { kopf, eintrag: {
        k: k.id,
        u: `/architektur/${k.id}/`,
        t: `${kopf.nummer}. ${kopf.titel}`,
        b: 'arc42',
        kurz: ersterAbsatz(html),
        a: abschnitte(html),
      } satisfies SuchKapitel };
    })
    .sort((a, b) => a.kopf.nummer - b.kopf.nummer)
    .map((k) => k.eintrag);

  const entscheidungen = (await getCollection('entscheidungen'))
    .sort((a, b) => a.data.id.localeCompare(b.data.id))
    .map((e): SuchKapitel => {
      const html = aufbereiten(
        e.rendered?.html ?? '',
        `docs/architektur/entscheidungen/${e.id}.md`,
      );
      return {
        k: e.id,
        u: `/architektur/entscheidungen/${e.id}/`,
        t: `${e.data.id}: ${e.data.titel}`,
        b: STATUS_NAME[e.data.status],
        kurz: ersterAbsatz(html),
        a: abschnitte(html),
      };
    });

  return new Response(JSON.stringify([...kapitel, ...entscheidungen]), {
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
};
