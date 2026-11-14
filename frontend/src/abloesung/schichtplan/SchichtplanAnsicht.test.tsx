import { describe, vi } from 'vitest';
import type { AbloesungVorgabe, ModulFreigaben } from '../../api/types';
import { freigabenFixture } from '../../test/fixtures';
import { renderMitProviders } from '../../test/utils';
import { planEditorFaelle, type ApiMock, type PlanEditorHuelle } from './planEditor.cases';
import SchichtplanAnsicht from './SchichtplanAnsicht';

/**
 * Schichtplan im Einsatz als Hülle des Plan-Editors (Change `y106s29r-blockplan-kern`, 1.5): der
 * gemeinsame Testsatz `planEditor.cases.tsx` gegen `SchichtplanAnsicht`.
 */

const api = vi.hoisted(() => ({
  load: vi.fn() as ApiMock,
  create: vi.fn() as ApiMock,
  update: vi.fn() as ApiMock,
  delete: vi.fn() as ApiMock,
  erzeugen: vi.fn() as ApiMock,
}));
vi.mock('../../api/schichtplan', async (orig) => ({
  ...(await orig<typeof import('../../api/schichtplan')>()),
  fetchSchichtplan: api.load,
  createSchichtplanBlock: api.create,
  updateSchichtplanBlock: api.update,
  deleteSchichtplanBlock: api.delete,
  erzeugeSchichten: api.erzeugen,
}));

const freigaben = vi.hoisted(() => ({ wert: undefined as ModulFreigaben | undefined }));
vi.mock('../../api/einsaetze', async (orig) => ({
  ...(await orig<typeof import('../../api/einsaetze')>()),
  ladeModulFreigaben: vi.fn(() => Promise.resolve(freigaben.wert)),
}));
vi.mock('../../api/einheiten', async (orig) => ({
  ...(await orig<typeof import('../../api/einheiten')>()),
  listeEinheiten: vi.fn(() =>
    Promise.resolve([
      { id: 11, name: 'RTW 1', abschnitt_id: 7 },
      { id: 12, name: 'RTW 2', abschnitt_id: 7 },
    ]),
  ),
}));
vi.mock('../../api/einsatzUhs', async (orig) => ({
  ...(await orig<typeof import('../../api/einsatzUhs')>()),
  listeUhs: vi.fn(() => Promise.resolve([])),
}));
vi.mock('../../api/einsatzPersonal', async (orig) => ({
  ...(await orig<typeof import('../../api/einsatzPersonal')>()),
  listeEinsatzPersonal: vi.fn(() => Promise.resolve([])),
}));
vi.mock('../../api/personal', async (orig) => ({
  ...(await orig<typeof import('../../api/personal')>()),
  listePersonal: vi.fn(() => Promise.resolve([{ id: 60, name: 'Carl Coe' }])),
}));
vi.mock('../../api/qualifikationen', async (orig) => ({
  ...(await orig<typeof import('../../api/qualifikationen')>()),
  listeQualifikationen: vi.fn(() => Promise.resolve([])),
}));
vi.mock('../../api/abloesungen', async (orig) => ({
  ...(await orig<typeof import('../../api/abloesungen')>()),
  fetchEinsatzSchichtmodell: vi.fn(() =>
    Promise.resolve({ vorwarnung_minuten: 30, laufende_schichten: 0 }),
  ),
}));

const EINSATZ_ID = 1;
const STUNDE = 3_600_000;
/** Volle Stunde vor jetzt: die Blöcke stehen in der Spanne „12 h“ (ab zwei Stunden davor). */
const STUNDE_NULL = Math.floor(Date.now() / STUNDE) * STUNDE;
const wire = (ms: number) => new Date(ms).toISOString().slice(0, 19).replace('T', ' ');

const A = { id: 1, version: 3, von: STUNDE_NULL - STUNDE, bis: STUNDE_NULL + STUNDE };
const B = { id: 2, version: 5, von: STUNDE_NULL + 2 * STUNDE, bis: STUNDE_NULL + 4 * STUNDE };

const posten = (einheitId: number, bezeichnung: string) => ({
  art: 'einheit',
  einheit_id: einheitId,
  bezeichnung,
  aufgeloest: false,
});

const block = (
  b: { id: number; version: number; von: number; bis: number },
  p: ReturnType<typeof posten>,
  personen: unknown[] = [],
) => ({
  id: b.id,
  version: b.version,
  von: wire(b.von),
  bis: wire(b.bis),
  posten: p,
  befunde: [],
  offene_anforderungen: [],
  offene_plaetze: 2 - personen.length,
  personen,
  personen_anzahl: personen.length,
  soll_anzahl: 2,
});

const ANNA = {
  art: 'stamm',
  personal_id: 50,
  name: 'Anna Alt',
  befunde: [],
  im_einsatz: true,
  qualifikationen: [],
};

function stand({ ohne = [], neu = 0 }: { ohne?: number[]; neu?: number } = {}) {
  const bloecke = [
    block(A, posten(11, 'RTW 1'), [ANNA]),
    block(B, posten(12, 'RTW 2')),
    ...Array.from({ length: neu }, (_, i) =>
      block(
        {
          id: 100 + i,
          version: 1,
          von: STUNDE_NULL + (6 + 4 * i) * STUNDE,
          bis: STUNDE_NULL + (10 + 4 * i) * STUNDE,
        },
        posten(11, 'RTW 1'),
      ),
    ),
  ].filter((b) => !ohne.includes(b.id));
  return {
    bloecke,
    grenzwerte: {
      max_dienst_eigen: false,
      max_dienst_minuten: 720,
      min_ruhe_eigen: false,
      min_ruhe_minuten: 600,
    },
    helfer: [],
    wechsel: [],
  };
}

const ABSCHNITTE = [
  { abschnitt_id: 7, abschnitt_name: 'Nord', rhythmus_minuten: 360 },
] as unknown as AbloesungVorgabe[];

const huelle: PlanEditorHuelle = {
  beschriftung: 'Schichtplan',
  fehlerTitel: 'Schichtplan nicht geändert',
  planId: EINSATZ_ID,
  api,
  bloecke: { a: A, b: B },
  stand,
  postenRtw1: { posten: { art: 'einheit', einheit_id: 11 } },
  personenA: [{ art: 'stamm', personal_id: 50 }],
  zeige: ({ personalGesperrt = false } = {}) => {
    freigaben.wert = freigabenFixture(personalGesperrt ? { personal: { zugriff: false } } : {});
    renderMitProviders(
      <SchichtplanAnsicht
        einsatzId={EINSATZ_ID}
        einsatzBeginn={wire(STUNDE_NULL - 3 * STUNDE)}
        darfSchreiben
        abschnitte={ABSCHNITTE}
      />,
    );
  },
  kopieVarianten: [
    { titel: 'mit Freigabe Personal', mitPersonen: true },
    { titel: 'ohne Freigabe Personal', personalGesperrt: true, mitPersonen: false },
  ],
};

describe('SchichtplanAnsicht als Hülle des Plan-Editors', () => {
  planEditorFaelle(huelle);
});
