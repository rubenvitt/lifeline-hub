import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import { App as AntApp } from 'antd';
import { server } from '../../test/server';
import type {
  Einheit,
  EinheitPerioden,
  EinsatzFahrzeug,
  EintreffenErgebnis,
} from '../../api/types';
import { EINHEIT_BEMERKUNG_MAX } from '../../api/eingabegrenzen';
import EintreffenDialog from './EintreffenDialog';

const einheit = (id: number, name: string, mehr: Partial<Einheit> = {}): Einheit =>
  ({
    id,
    einsatz_id: 1,
    name,
    abschnitt_id: null,
    abschnitt_name: null,
    ueber_einheit_id: null,
    aktueller_br_id: null,
    funkrufname: null,
    typ_label: null,
    fahrzeug_mitglieder: [],
    unangemeldet: false,
    ...mehr,
  }) as unknown as Einheit;

const fahrzeug = (id: number, funkrufname: string, mehr: Partial<EinsatzFahrzeug> = {}) =>
  ({
    id,
    funkrufname,
    einheit_id: null,
    aktueller_br_id: null,
    fahrzeugtyp: null,
    ...mehr,
  }) as unknown as EinsatzFahrzeug;

const ERGEBNIS: EintreffenErgebnis = {
  belegung: {
    id: 1,
    einsatz_id: 1,
    br_id: 1,
    objekt_typ: 'einheit',
    objekt_id: 30,
    art: 'eintritt',
    notiz: null,
    zeitpunkt_at: '2026-10-16T12:00:00Z',
    erfasst_von: 1,
  },
  einheit_id: 30,
  fahrzeug_ids: [],
  unangemeldet: false,
  zeitachse: 'geschrieben',
} as unknown as EintreffenErgebnis;

const EINHEITEN = [
  einheit(30, 'HLF 20 FF Musterstadt', {
    fahrzeug_mitglieder: [
      { ef_id: 5, funkrufname: 'FL-MUS 1-44-1' } as Einheit['fahrzeug_mitglieder'][number],
    ],
  }),
  einheit(31, 'Zug Nord', { abschnitt_id: 3, abschnitt_name: 'Nord' }),
];
const FAHRZEUGE = [fahrzeug(5, 'FL-MUS 1-44-1', { einheit_id: 30 }), fahrzeug(6, 'RTW 2')];

let koerper: unknown[];

function antwortMit(antwort: () => Response | Promise<Response>) {
  server.use(
    http.post('/api/einsaetze/1/bereitstellungsraeume/1/eintreffen', async ({ request }) => {
      koerper.push(await request.json());
      return antwort();
    }),
  );
}

beforeEach(() => {
  koerper = [];
  server.use(
    http.get('/api/einsaetze/1/einheiten/zeitachse', () =>
      HttpResponse.json<EinheitPerioden[]>([]),
    ),
  );
  antwortMit(() => HttpResponse.json(ERGEBNIS, { status: 201 }));
});

function zeige({
  einheiten = EINHEITEN,
  fahrzeuge = FAHRZEUGE,
}: { einheiten?: Einheit[]; fahrzeuge?: EinsatzFahrzeug[] } = {}) {
  const onClose = vi.fn();
  const onGebucht = vi.fn();
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  render(
    <QueryClientProvider client={qc}>
      <AntApp>
        <EintreffenDialog
          einsatzId={1}
          br={{ id: 1, einheiten: [], fahrzeuge: [] }}
          einheiten={einheiten}
          fahrzeuge={fahrzeuge}
          offen
          onClose={onClose}
          onGebucht={onGebucht}
        />
      </AntApp>
    </QueryClientProvider>,
  );
  return { onClose, onGebucht };
}

const dialog = () => screen.getByRole('dialog');

async function zuSchrittZwei(suche = '') {
  const feld = await screen.findByRole('searchbox', { name: 'Suche' });
  if (suche) await userEvent.type(feld, suche);
  await userEvent.click(screen.getByRole('button', { name: 'Nicht in der Liste' }));
  return screen.findByRole('textbox', { name: 'Funkrufname' });
}

describe('EintreffenDialog — Schritt 1 (LLH-1075, design.md D14)', () => {
  it('Suche hat den Fokus, Gruppen „Erwartet“ vor „Im Einsatz“', async () => {
    zeige();
    const feld = await screen.findByRole('searchbox', { name: 'Suche' });
    await waitFor(() => expect(feld).toHaveFocus());
    const text = dialog().textContent ?? '';
    expect(text.indexOf('Erwartet')).toBeGreaterThanOrEqual(0);
    expect(text.indexOf('Erwartet')).toBeLessThan(text.indexOf('Im Einsatz'));
    expect(within(dialog()).getByText('Nord')).toBeInTheDocument();
  });

  it('ein Tipp bucht (Körper `kraft`) und schließt mit Hinweis', async () => {
    const { onClose, onGebucht } = zeige();
    await userEvent.click(
      await screen.findByRole('button', { name: 'Eintreffen HLF 20 FF Musterstadt' }),
    );
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(koerper).toEqual([{ kraft: { objekt_typ: 'einheit', objekt_id: 30 } }]);
    expect(onGebucht).toHaveBeenCalledWith(expect.objectContaining({ einheit_id: 30 }));
    expect(await screen.findByText('HLF 20 FF Musterstadt gebucht')).toBeInTheDocument();
  });

  it('der Funkrufname eines Fahrzeugs findet seine Einheit', async () => {
    zeige();
    await userEvent.type(await screen.findByRole('searchbox', { name: 'Suche' }), 'fl-mus 1-44');
    expect(
      screen.getByRole('button', { name: 'Eintreffen HLF 20 FF Musterstadt' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Eintreffen RTW 2' })).toBeNull();
  });

  it('eine Ablehnung bleibt im Dialog, ohne Toast', async () => {
    antwortMit(() =>
      HttpResponse.json({ error: 'Einheit ist schon im Bereitstellungsraum' }, { status: 409 }),
    );
    const { onClose } = zeige();
    await userEvent.click(await screen.findByRole('button', { name: 'Eintreffen RTW 2' }));
    expect(
      await within(dialog()).findByText('Einheit ist schon im Bereitstellungsraum'),
    ).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    expect(document.querySelectorAll('.ant-message-notice')).toHaveLength(0);
  });
});

describe('EintreffenDialog — Schritt 2: unangemeldet', () => {
  it('übernimmt den Suchtext als Funkrufname', async () => {
    zeige();
    const funkrufname = await zuSchrittZwei('Florian Nachbar 3');
    expect(funkrufname).toHaveValue('Florian Nachbar 3');
  });

  it('vier Felder sichtbar, Bemerkung erst nach Aufklappen', async () => {
    zeige();
    await zuSchrittZwei();
    expect(screen.getByRole('textbox', { name: 'Funkrufname' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Trägerorganisation' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Fahrzeugtyp' })).toBeInTheDocument();
    expect(screen.getByRole('spinbutton', { name: 'Führer' })).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Bemerkung' })).toBeNull();
    expect(screen.queryByRole('textbox', { name: 'Kennzeichen' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: /^Bemerkung/ }));
    expect(await screen.findByRole('textbox', { name: 'Bemerkung' })).toBeInTheDocument();
  });

  it('Funkrufname leer sendet nichts', async () => {
    zeige();
    await zuSchrittZwei();
    await userEvent.click(screen.getByRole('button', { name: 'Unangemeldet buchen' }));
    await waitFor(() =>
      expect(dialog().querySelector('.ant-form-item-explain-error')).not.toBeNull(),
    );
    expect(koerper).toEqual([]);
  });

  it('sendet den Körper `unangemeldet` und meldet die Einsatzleitung', async () => {
    antwortMit(() =>
      HttpResponse.json({ ...ERGEBNIS, unangemeldet: true, meldung_id: 7 }, { status: 201 }),
    );
    const { onClose } = zeige();
    await zuSchrittZwei('Florian Nachbar 3');
    await userEvent.type(
      screen.getByRole('textbox', { name: 'Trägerorganisation' }),
      'FF Nachbarstadt',
    );
    await userEvent.type(screen.getByRole('textbox', { name: 'Fahrzeugtyp' }), 'LF 10');
    await userEvent.click(screen.getByRole('button', { name: 'Unangemeldet buchen' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(koerper).toEqual([
      {
        unangemeldet: {
          fahrzeuge: [
            {
              funkrufname: 'Florian Nachbar 3',
              fahrzeugtyp: 'LF 10',
              traegerorganisation: 'FF Nachbarstadt',
            },
          ],
        },
      },
    ]);
    expect(
      await screen.findByText('Florian Nachbar 3 unangemeldet gebucht, Einsatzleitung informiert'),
    ).toBeInTheDocument();
  });

  it('nimmt ein weiteres Fahrzeug mit', async () => {
    const { onClose } = zeige();
    await zuSchrittZwei('Florian Nachbar 3');
    await userEvent.click(screen.getByRole('button', { name: /^Weiteres Fahrzeug/ }));
    await userEvent.click(await screen.findByRole('button', { name: 'Fahrzeug hinzufügen' }));
    await userEvent.type(
      await screen.findByRole('textbox', { name: 'Funkrufname weiteres Fahrzeug 1' }),
      'Florian Nachbar 4',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Unangemeldet buchen' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(koerper).toEqual([
      {
        unangemeldet: {
          fahrzeuge: [{ funkrufname: 'Florian Nachbar 3' }, { funkrufname: 'Florian Nachbar 4' }],
        },
      },
    ]);
  });

  it('Bemerkung über der Grenze sperrt das Senden ohne Kürzen', async () => {
    zeige();
    await zuSchrittZwei('Florian Nachbar 3');
    await userEvent.click(screen.getByRole('button', { name: /^Bemerkung/ }));
    const lang = 'x'.repeat(EINHEIT_BEMERKUNG_MAX + 5);
    const feld = await screen.findByRole('textbox', { name: 'Bemerkung' });
    fireEvent.change(feld, { target: { value: lang } });
    await userEvent.click(screen.getByRole('button', { name: 'Unangemeldet buchen' }));
    expect(
      await screen.findByText(/Bemerkung darf höchstens .* Zeichen lang sein/),
    ).toBeInTheDocument();
    expect(feld).toHaveValue(lang);
    expect(koerper).toEqual([]);
  });

  it('422 bleibt im Dialog ohne Toast', async () => {
    antwortMit(() =>
      HttpResponse.json({ error: 'Bereitstellungsraum ist nicht aktiv' }, { status: 422 }),
    );
    const { onClose } = zeige();
    await zuSchrittZwei('Florian Nachbar 3');
    await userEvent.click(screen.getByRole('button', { name: 'Unangemeldet buchen' }));
    expect(
      await within(dialog()).findByText('Bereitstellungsraum ist nicht aktiv'),
    ).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('textbox', { name: 'Funkrufname' })).toHaveValue('Florian Nachbar 3');
    expect(document.querySelectorAll('.ant-message-notice')).toHaveLength(0);
  });
});

describe('EintreffenDialog — Doppelbuchung (D9)', () => {
  it('nennt die Kraft und bucht sie mit „Diese buchen“', async () => {
    const { onClose } = zeige();
    await zuSchrittZwei('fl-mus 1-44-1');
    expect(await screen.findByText('Schon im Einsatz: FL-MUS 1-44-1')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Unangemeldet buchen' })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'Diese buchen' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(koerper).toEqual([{ kraft: { objekt_typ: 'einheit', objekt_id: 30 } }]);
  });

  it('„Trotzdem neu anlegen“ bestätigt die Neuanlage', async () => {
    const { onClose } = zeige();
    await zuSchrittZwei('RTW 2');
    await userEvent.click(await screen.findByRole('button', { name: 'Trotzdem neu anlegen' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(koerper).toEqual([
      { unangemeldet: { fahrzeuge: [{ funkrufname: 'RTW 2' }], trotzdem_anlegen: true } },
    ]);
  });

  it('eine Kraft in einem Raum bietet nur die Neuanlage', async () => {
    zeige({ einheiten: [einheit(40, 'Zug Süd', { aktueller_br_id: 9 })], fahrzeuge: [] });
    await zuSchrittZwei('Zug Süd');
    expect(await screen.findByText('Schon im Einsatz: Zug Süd')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Diese buchen' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Trotzdem neu anlegen' })).toBeInTheDocument();
  });

  it('meldet der Server die Doppelbuchung, bietet der Dialog die Neuanlage an', async () => {
    let n = 0;
    antwortMit(() =>
      ++n === 1
        ? HttpResponse.json(
            { error: 'Florian Nachbar 3 ist schon im Einsatz (Einheit «Florian Nachbar 3»)' },
            { status: 422 },
          )
        : HttpResponse.json({ ...ERGEBNIS, unangemeldet: true }, { status: 201 }),
    );
    const { onClose } = zeige();
    await zuSchrittZwei('Florian Nachbar 3');
    await userEvent.click(screen.getByRole('button', { name: 'Unangemeldet buchen' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Trotzdem neu anlegen' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(koerper[koerper.length - 1]).toMatchObject({ unangemeldet: { trotzdem_anlegen: true } });
  });
});
