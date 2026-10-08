import { http, HttpResponse, type HttpHandler } from 'msw';
import {
  passtZurSicht,
  schadenCursor,
  schadenRegistrierAnzeige,
  vergleicheSchaedenNach,
  type SchaedenFilter,
  type SchadenSortierung,
  type SchadenSortSpalte,
} from '../api/einsatzSchaden';
import type { Ausmass, Schaden, SchadenStatus, SchadenTyp } from '../api/types';

/**
 * Attrappe der Schaden-Leserouten für Seitentests (LFH-1075): Seiten, Kennzahlen, Auswahl und
 * Einzelabruf werden aus EINER Vollliste abgeleitet, so wie der Server sie aus der Tabelle liest.
 * Tests setzen weiter nur die Vollliste; `abrufe` hält die Query-Strings der Listenabrufe fest.
 */
export function schaedenAttrappe(einsatzId: number, quelle: () => readonly object[]) {
  const abrufe: URLSearchParams[] = [];
  const basis = `/api/einsaetze/${einsatzId}/schaeden`;
  const alle = () => quelle() as readonly Schaden[];

  const liste = (q: URLSearchParams): Schaden[] => {
    const werte = (k: string) => q.get(k)?.split(',').filter(Boolean);
    const filter: SchaedenFilter = {
      status: (q.get('status') ?? undefined) as SchadenStatus | undefined,
      typen: werte('typ') as SchadenTyp[] | undefined,
      ausmasse: werte('ausmass') as Ausmass[] | undefined,
      verortet: werte('verortet') as ('ja' | 'nein')[] | undefined,
    };
    const begriff = q.get('q')?.toLowerCase();
    return alle().filter((s) => {
      if (q.get('inkl_storniert') !== 'true' && s.storniert_at != null) return false;
      if (!passtZurSicht({ ...s, storniert_at: null }, filter)) return false;
      if (!begriff) return true;
      return [
        schadenRegistrierAnzeige(s.registrier_nr),
        s.ort,
        s.beschreibung,
        s.geschaedigt_personal_name ?? s.geschaedigt_organisation_name ?? s.geschaedigt_kontakt,
      ].some((t) => (t ?? '').toLowerCase().includes(begriff));
    });
  };

  const handler: HttpHandler[] = [
    http.get(`${basis}/kennzahlen`, ({ request }) => {
      const q = new URL(request.url).searchParams;
      q.delete('status');
      const treffer = liste(q);
      const zahl = (st: SchadenStatus) => treffer.filter((s) => s.status === st).length;
      return HttpResponse.json({
        gesamt: treffer.length,
        offen: zahl('offen'),
        uebergeben: zahl('uebergeben'),
        abgeschlossen: zahl('abgeschlossen'),
      });
    }),
    http.get(`${basis}/auswahl`, () =>
      HttpResponse.json(
        alle()
          .filter((s) => s.storniert_at == null)
          .sort((a, b) => b.registrier_nr - a.registrier_nr)
          .map((s) => ({
            id: s.id,
            registrier_nr: s.registrier_nr,
            status: s.status,
            typ: s.typ,
            ausmass: s.ausmass,
            ort: s.ort,
            frei:
              s.geschaedigt_person_id == null &&
              s.geschaedigt_personal_id == null &&
              s.geschaedigt_organisation_id == null &&
              s.geschaedigt_kontakt == null,
          })),
      ),
    ),
    http.get(basis, ({ request }) => {
      const q = new URL(request.url).searchParams;
      abrufe.push(q);
      const treffer = liste(q);
      const limit = q.get('limit');
      if (limit == null) {
        return HttpResponse.json(treffer.sort((a, b) => b.registrier_nr - a.registrier_nr));
      }
      const [spalte, richtung] = (q.get('sortierung') ?? 'nr_ab').split('_') as [
        SchadenSortSpalte,
        'ab' | 'auf',
      ];
      const sortierung: SchadenSortierung = { spalte, richtung };
      const vergleich = vergleicheSchaedenNach(sortierung);
      const sortiert = treffer.sort(vergleich);
      const vorNr = q.get('vor_nr');
      const ab =
        vorNr == null
          ? 0
          : sortiert.findIndex((s) => {
              const c = schadenCursor(s, spalte);
              return c.vor_nr === Number(vorNr) && (c.vor_wert ?? null) === q.get('vor_wert');
            }) + 1;
      return HttpResponse.json(sortiert.slice(ab, ab + Number(limit)));
    }),
    http.get(`${basis}/:schadenId`, ({ params }) => {
      const treffer = alle().find((s) => s.id === Number(params.schadenId));
      return treffer ? HttpResponse.json(treffer) : new HttpResponse(null, { status: 404 });
    }),
  ];

  return { handler, abrufe };
}
