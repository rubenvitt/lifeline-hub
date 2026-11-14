import { useQuery } from '@tanstack/react-query';
import { describe, vi } from 'vitest';
import { ladePlanung } from '../api/planungen';
import { globalKeys } from '../api/queryKeys';
import type { Planung, PlanungBlock } from '../api/types';
import {
  planEditorFaelle,
  type ApiMock,
  type PlanEditorHuelle,
} from '../abloesung/schichtplan/planEditor.cases';
import { renderMitProviders } from '../test/utils';
import PlanungSchichtplan from './PlanungSchichtplan';

/**
 * Plan einer Vorplanung als Hülle des Plan-Editors (Change `y106s29r-blockplan-kern`, 1.5): der
 * gemeinsame Testsatz `abloesung/schichtplan/planEditor.cases.tsx` gegen `PlanungSchichtplan`.
 */

const api = vi.hoisted(() => ({
  load: vi.fn() as ApiMock,
  create: vi.fn() as ApiMock,
  update: vi.fn() as ApiMock,
  delete: vi.fn() as ApiMock,
  erzeugen: vi.fn() as ApiMock,
}));
vi.mock('../api/planungen', async (orig) => ({
  ...(await orig<typeof import('../api/planungen')>()),
  ladePlanung: api.load,
  legePlanungBlockAn: api.create,
  aenderePlanungBlock: api.update,
  loeschePlanungBlock: api.delete,
  erzeugePlanungSchichten: api.erzeugen,
}));
vi.mock('../api/personal', async (orig) => ({
  ...(await orig<typeof import('../api/personal')>()),
  listePersonal: vi.fn(() => Promise.resolve([{ id: 60, name: 'Carl Coe' }])),
}));
vi.mock('../api/qualifikationen', async (orig) => ({
  ...(await orig<typeof import('../api/qualifikationen')>()),
  listeQualifikationen: vi.fn(() => Promise.resolve([])),
}));

const PLANUNG_ID = 5;
const ms = (wire: string) => Date.parse(`${wire.replace(' ', 'T')}Z`);
const STUNDE = 3_600_000;

const A = { id: 11, version: 3, von: ms('2027-06-12 08:00:00'), bis: ms('2027-06-12 10:00:00') };
const B = { id: 12, version: 5, von: ms('2027-06-12 11:00:00'), bis: ms('2027-06-12 13:00:00') };
const wire = (t: number) => new Date(t).toISOString().slice(0, 19).replace('T', ' ');

const ANNA = {
  art: 'stamm' as const,
  personal_id: 50,
  name: 'Anna Alt',
  befunde: [],
  im_einsatz: false,
  qualifikationen: [],
};

const block = (
  b: { id: number; version: number; von: number; bis: number },
  postenId: number,
  personen: PlanungBlock['personen'] = [],
): PlanungBlock => ({
  id: b.id,
  version: b.version,
  posten_id: postenId,
  von: wire(b.von),
  bis: wire(b.bis),
  befunde: [],
  offene_anforderungen: [],
  offene_plaetze: 2 - personen.length,
  personen,
  personen_anzahl: personen.length,
  soll_anzahl: 2,
});

function stand({ ohne = [], neu = 0 }: { ohne?: number[]; neu?: number } = {}): Planung {
  return {
    kopf: {
      id: PLANUNG_ID,
      version: 3,
      bezeichnung: 'Stadtfest',
      einsatzart: 'sanitaetsdienst',
      ort: 'Marktplatz',
      von: '2027-06-12 06:00:00',
      bis: '2027-06-12 20:00:00',
      grenzwerte: {
        max_dienst_minuten: 720,
        max_dienst_eigen: false,
        min_ruhe_minuten: 480,
        min_ruhe_eigen: false,
      },
      loeschung_at: '2027-09-10 20:00:00',
      angelegt_at: '2027-05-01 10:00:00',
    },
    posten: [
      {
        id: 1,
        bezeichnung: 'RTW 1',
        art: 'einheit',
        abschnitt: 'Nord',
        sortier: 10,
        nicht_verfuegbar: false,
        schichtlaenge_minuten: 240,
        soll_anzahl: 2,
      },
      {
        id: 2,
        bezeichnung: 'RTW 2',
        art: 'einheit',
        abschnitt: 'Nord',
        sortier: 20,
        nicht_verfuegbar: false,
        soll_anzahl: 2,
      },
    ],
    bloecke: [
      block(A, 1, [ANNA]),
      block(B, 2),
      ...Array.from({ length: neu }, (_, i) =>
        block(
          {
            id: 100 + i,
            version: 1,
            von: B.bis + (1 + 4 * i) * STUNDE,
            bis: B.bis + (5 + 4 * i) * STUNDE,
          },
          1,
        ),
      ),
    ].filter((b) => !ohne.includes(b.id)),
    helfer: [],
    programmpunkte: [],
    kennzahlen: { soll: 4, ist: 1, offen: 3, konflikte: 0 },
  };
}

/** Wie `PlanungPage`: die Planung kommt aus dem Cache, den jeder Schreibweg ersetzt. */
function PlanungAusCache() {
  const q = useQuery({
    queryKey: globalKeys.planung(PLANUNG_ID),
    queryFn: () => ladePlanung(PLANUNG_ID),
  });
  return q.data ? <PlanungSchichtplan planung={q.data} /> : null;
}

const huelle: PlanEditorHuelle = {
  beschriftung: 'Planung',
  fehlerTitel: 'Planung nicht geändert',
  planId: PLANUNG_ID,
  api,
  bloecke: { a: A, b: B },
  stand,
  postenRtw1: { posten_id: 1 },
  personenA: [{ art: 'stamm', personal_id: 50 }],
  zeige: () => {
    renderMitProviders(<PlanungAusCache />);
  },
  kopieVarianten: [{ titel: 'Vorplanung', mitPersonen: true }],
};

describe('PlanungSchichtplan als Hülle des Plan-Editors', () => {
  planEditorFaelle(huelle);
});
