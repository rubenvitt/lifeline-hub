import { describe, expect, it, onTestFinished } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { delay, http, HttpResponse } from 'msw';
import { server } from '../../test/server';
import { renderMitProviders } from '../../test/utils';
import { freigabenFixture } from '../../test/fixtures';
import type { EinsatzFahrzeug, EinsatzPersonal, ModulFreigaben } from '../../api/types';
import { buildEinheitRechte } from './einheitAnsichtKern';
import ZuordnenAuswahl from './ZuordnenAuswahl';

/**
 * „Person zuordnen …“ und „Fahrzeug zuordnen …“ (LLH-1036 Teil II, design.md D7, D8): ein
 * Einsatz-Eintrag geht über den Zuordnungsweg der Einheit, ein Stamm-Eintrag über die
 * Sammel-Disposition aus LLH-1100 mit genau einer Kraft und der Einheit. Der Grund einer
 * Ablehnung steht unter der Auswahl, kein Toast.
 */

const stammPerson = (id: number, name: string, teil: Record<string, unknown> = {}) => ({
  id,
  name,
  ist_demo: false,
  personalnummer: null,
  traegerorganisation: null,
  qualifikationen: [],
  dienststatus: 'im_dienst',
  ...teil,
});
const stammFahrzeug = (id: number, funkrufname: string, teil: Record<string, unknown> = {}) => ({
  id,
  funkrufname,
  ist_demo: false,
  fahrzeugtyp: null,
  dienststatus: 'im_dienst',
  ...teil,
});

const EINSATZ_PERSONAL = [
  { id: 5, name: 'Erika Frei', einheit_id: null, personal_id: 50 },
  { id: 6, name: 'Gebunden', einheit_id: 3, personal_id: 51 },
] as unknown as EinsatzPersonal[];
const EINSATZ_FAHRZEUGE = [
  { id: 30, funkrufname: '83-1', einheit_id: null, fahrzeug_id: 70 },
] as unknown as EinsatzFahrzeug[];

function stammHandler() {
  return [
    http.get('/api/personal', () =>
      HttpResponse.json([
        stammPerson(50, 'Erika Frei'),
        stammPerson(51, 'Gebunden'),
        stammPerson(52, 'Erika Muster', { personalnummer: 'P-7' }),
        stammPerson(53, 'Demo Dora', { ist_demo: true }),
      ]),
    ),
    http.get('/api/fahrzeuge', () =>
      HttpResponse.json([
        stammFahrzeug(70, '83-1'),
        stammFahrzeug(71, 'Florian 2', { fahrzeugtyp: 'RTW' }),
      ]),
    ),
    // Die Entlassenen (`?entlassene=1`): keine.
    http.get('/api/einsaetze/1/personal', () => HttpResponse.json([])),
    http.get('/api/einsaetze/1/fahrzeuge', () => HttpResponse.json([])),
  ];
}

function zeige(
  art: 'personal' | 'fahrzeug',
  {
    freigaben = freigabenFixture(),
    darfSchreiben = true,
  }: { freigaben?: ModulFreigaben; darfSchreiben?: boolean } = {},
) {
  server.use(...stammHandler());
  const rechte = buildEinheitRechte(darfSchreiben, freigaben);
  return renderMitProviders(
    art === 'personal' ? (
      <ZuordnenAuswahl
        art="personal"
        einsatzId={1}
        einheitId={10}
        rechte={rechte}
        einsatzList={{ data: EINSATZ_PERSONAL, isError: false, error: null }}
      />
    ) : (
      <ZuordnenAuswahl
        art="fahrzeug"
        einsatzId={1}
        einheitId={10}
        rechte={rechte}
        einsatzList={{ data: EINSATZ_FAHRZEUGE, isError: false, error: null }}
      />
    ),
  );
}

/**
 * Beide Auswahlfelder zugleich, mit einem Mitschnitt aller Abrufe: das freigegebene Feld ist der
 * Inhaltsanker. Ist seine Stammliste abgerufen, wäre es die des gesperrten auch, denn beide
 * Abfragen starten beim Einhängen.
 */
function zeigeBeideMitMitschnitt(freigaben: ModulFreigaben) {
  const abgerufen: string[] = [];
  const mitschnitt = ({ request }: { request: Request }) => {
    const url = new URL(request.url);
    abgerufen.push(`${url.pathname}${url.search}`);
  };
  server.events.on('request:start', mitschnitt);
  onTestFinished(() => server.events.removeListener('request:start', mitschnitt));
  server.use(...stammHandler());
  const rechte = buildEinheitRechte(true, freigaben);
  renderMitProviders(
    <>
      <ZuordnenAuswahl
        art="personal"
        einsatzId={1}
        einheitId={10}
        rechte={rechte}
        einsatzList={{ data: EINSATZ_PERSONAL, isError: false, error: null }}
      />
      <ZuordnenAuswahl
        art="fahrzeug"
        einsatzId={1}
        einheitId={10}
        rechte={rechte}
        einsatzList={{ data: EINSATZ_FAHRZEUGE, isError: false, error: null }}
      />
    </>,
  );
  return abgerufen;
}

async function oeffne(platzhalter: string) {
  const feld = [...document.querySelectorAll<HTMLElement>('.ant-select')].find((s) =>
    s.textContent?.includes(platzhalter),
  );
  expect(feld, `Auswahlfeld „${platzhalter}“ nicht gefunden`).toBeTruthy();
  await userEvent.click(within(feld!).getByRole('combobox'));
}

/** Die Gruppen der offenen Liste mit ihren Einträgen, in Folge. */
async function gruppenDerListe() {
  await screen.findByText('Aus dem Stamm', { selector: '.ant-select-item-group' });
  const zeilen = [
    ...document.querySelectorAll<HTMLElement>(
      '.ant-select-item-group, .ant-select-item-option-content',
    ),
  ];
  return zeilen.map((z) => z.textContent);
}

async function waehle(platzhalter: string, eintrag: string) {
  await oeffne(platzhalter);
  await userEvent.click(
    await screen.findByText(
      (_, el) =>
        typeof el?.className === 'string' &&
        el.className.includes('ant-select-item-option-content') &&
        el.textContent === eintrag,
    ),
  );
}

describe('ZuordnenAuswahl · Person (D7)', () => {
  it('Gruppen: frei im Einsatz, Stamm ohne aktiv Disponierte, Demo hinten', async () => {
    zeige('personal');
    await oeffne('Person zuordnen …');
    expect(await gruppenDerListe()).toEqual([
      'Im Einsatz frei',
      'Erika Frei',
      'Aus dem Stamm',
      'Erika Muster (P-7)',
      'Demo-Daten',
      'Demo DoraDemo',
    ]);
  });

  it('Einsatz-Eintrag: ordnet über die Einheit zu', async () => {
    const aufrufe: string[] = [];
    server.use(
      http.put('/api/einsaetze/1/einheiten/10/personal/:epId', ({ params }) => {
        aufrufe.push(String(params.epId));
        return new HttpResponse(null, { status: 204 });
      }),
    );
    zeige('personal');
    await waehle('Person zuordnen …', 'Erika Frei');
    await waitFor(() => expect(aufrufe).toEqual(['5']));
  });

  it('Stamm-Eintrag: Sammel-Disposition mit genau dieser Person und der Einheit, ohne Fahrzeug', async () => {
    const bodies: unknown[] = [];
    server.use(
      http.post('/api/einsaetze/1/personal/sammel', async ({ request }) => {
        bodies.push(await request.json());
        return HttpResponse.json([]);
      }),
    );
    zeige('personal');
    await waehle('Person zuordnen …', 'Erika Muster (P-7)');
    await waitFor(() =>
      expect(bodies).toEqual([{ personal_ids: [52], einheit_id: 10, fahrzeug_id: null }]),
    );
  });

  it('abgelehnt mit Grund der Zeile: „Nicht zugeordnet“ mit „außer Dienst“ unter der Auswahl, kein Toast', async () => {
    server.use(
      http.post('/api/einsaetze/1/personal/sammel', () =>
        HttpResponse.json(
          {
            error: 'Nicht disponiert',
            zeilen: [{ art: 'personal', id: 52, grund: 'außer Dienst' }],
          },
          { status: 422 },
        ),
      ),
    );
    zeige('personal');
    await waehle('Person zuordnen …', 'Erika Muster (P-7)');
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Nicht zugeordnet');
    expect(alert).toHaveTextContent('außer Dienst');
    expect(alert).not.toHaveTextContent('Nicht disponiert');
    expect(document.querySelectorAll('.ant-message-notice')).toHaveLength(0);
  });

  it('ohne Freigabe Personal: gesperrt mit Kurzgrund, keine Stammliste abgefragt', async () => {
    const abgerufen = zeigeBeideMitMitschnitt(freigabenFixture({ personal: { zugriff: false } }));
    const feld = screen.getByRole('combobox', { name: 'Person zuordnen' });
    expect(feld).toBeDisabled();
    expect(feld).toHaveAccessibleDescription('Modul Personal gesperrt');
    // Anker: die Fahrzeug-Seite hat ihre Stammliste und ihre Entlassenen abgerufen.
    await waitFor(() =>
      expect(abgerufen).toEqual(
        expect.arrayContaining([
          '/api/fahrzeuge?nur_im_dienst=true',
          '/api/einsaetze/1/fahrzeuge?entlassene=1',
        ]),
      ),
    );
    expect(abgerufen.filter((a) => /^\/api\/(personal|einsaetze\/1\/personal)/.test(a))).toEqual(
      [],
    );
  });

  it('Rückmeldung vor der Antwort: die Auswahl lädt, bis der Server antwortet', async () => {
    server.use(
      http.post('/api/einsaetze/1/personal/sammel', async () => {
        await delay('infinite');
        return HttpResponse.json([]);
      }),
    );
    zeige('personal');
    await waehle('Person zuordnen …', 'Erika Muster (P-7)');
    await waitFor(() =>
      expect(document.querySelector('.ant-select .anticon-loading')).not.toBeNull(),
    );
  });

  it('ohne Schreibrecht: keine Auswahl', () => {
    zeige('personal', { darfSchreiben: false });
    expect(screen.queryByRole('combobox')).toBeNull();
  });
});

describe('ZuordnenAuswahl · Fahrzeug (D8)', () => {
  it('Gruppen wie bei Personen; der Stamm-Eintrag geht über die Sammel-Disposition', async () => {
    const bodies: unknown[] = [];
    server.use(
      http.post('/api/einsaetze/1/fahrzeuge/sammel', async ({ request }) => {
        bodies.push(await request.json());
        return HttpResponse.json([]);
      }),
    );
    zeige('fahrzeug');
    await oeffne('Fahrzeug zuordnen …');
    expect(await gruppenDerListe()).toEqual([
      'Im Einsatz frei',
      '83-1',
      'Aus dem Stamm',
      'Florian 2 (RTW)',
    ]);
    await userEvent.click(screen.getByText('Florian 2 (RTW)'));
    await waitFor(() => expect(bodies).toEqual([{ fahrzeug_ids: [71], einheit_id: 10 }]));
  });

  it('Einsatz-Eintrag: ordnet über die Einheit zu', async () => {
    const aufrufe: string[] = [];
    server.use(
      http.put('/api/einsaetze/1/einheiten/10/fahrzeug/:efId', ({ params }) => {
        aufrufe.push(String(params.efId));
        return new HttpResponse(null, { status: 204 });
      }),
    );
    zeige('fahrzeug');
    await waehle('Fahrzeug zuordnen …', '83-1');
    await waitFor(() => expect(aufrufe).toEqual(['30']));
  });

  it('ohne Freigabe Fahrzeuge: gesperrt mit Kurzgrund, keine Stammliste abgefragt', async () => {
    const abgerufen = zeigeBeideMitMitschnitt(freigabenFixture({ fahrzeuge: { zugriff: false } }));
    expect(screen.getByRole('combobox', { name: 'Fahrzeug zuordnen' })).toHaveAccessibleDescription(
      'Modul Fahrzeuge gesperrt',
    );
    await waitFor(() =>
      expect(abgerufen).toEqual(
        expect.arrayContaining([
          '/api/personal?nur_im_dienst=true',
          '/api/einsaetze/1/personal?entlassene=1',
        ]),
      ),
    );
    expect(abgerufen.filter((a) => /^\/api\/(fahrzeuge|einsaetze\/1\/fahrzeuge)/.test(a))).toEqual(
      [],
    );
  });

  it('Stamm-Fahrzeug abgelehnt: „Nicht zugeordnet“ mit dem Grund der Zeile unter dem Feld', async () => {
    server.use(
      http.post('/api/einsaetze/1/fahrzeuge/sammel', () =>
        HttpResponse.json(
          {
            error: 'Nicht disponiert',
            zeilen: [{ art: 'fahrzeug', id: 71, grund: 'außer Dienst' }],
          },
          { status: 422 },
        ),
      ),
    );
    zeige('fahrzeug');
    await waehle('Fahrzeug zuordnen …', 'Florian 2 (RTW)');
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Nicht zugeordnet');
    expect(alert).toHaveTextContent('außer Dienst');
    expect(alert).not.toHaveTextContent('Nicht disponiert');
    expect(document.querySelectorAll('.ant-message-notice')).toHaveLength(0);
  });
});
