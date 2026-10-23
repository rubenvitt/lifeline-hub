import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
  EintreffenEingabe,
  EintreffenErgebnis,
} from '../../api/types';
import { queueLeerenFuerTests, schreibaktionenLaden } from '../../offline/queue';
import { setzeOnline } from '../../test/utils';
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

/** Gesendete Körper ohne `client_id`; die Schlüssel stehen getrennt in `clientIds` (Teil III). */
let koerper: unknown[];
let clientIds: unknown[];

function antwortMit(antwort: () => Response | Promise<Response>) {
  server.use(
    http.post('/api/einsaetze/1/bereitstellungsraeume/1/eintreffen', async ({ request }) => {
      const { client_id, ...rest } = (await request.json()) as Record<string, unknown>;
      clientIds.push(client_id);
      koerper.push(rest);
      return antwort();
    }),
  );
}

afterEach(() => {
  setzeOnline(true);
});

beforeEach(async () => {
  await queueLeerenFuerTests();
  koerper = [];
  clientIds = [];
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
  vorgemerkt = [],
}: {
  einheiten?: Einheit[];
  fahrzeuge?: EinsatzFahrzeug[];
  vorgemerkt?: EintreffenEingabe[];
} = {}) {
  const onClose = vi.fn();
  const onGebucht = vi.fn();
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const baum = (offen: boolean) => (
    <QueryClientProvider client={qc}>
      <AntApp>
        <EintreffenDialog
          einsatzId={1}
          benutzerId={11}
          br={{ id: 1, bezeichnung: 'BR Sportplatz', einheiten: [], fahrzeuge: [] }}
          einheiten={einheiten}
          fahrzeuge={fahrzeuge}
          vorgemerkt={vorgemerkt}
          offen={offen}
          onClose={onClose}
          onGebucht={onGebucht}
        />
      </AntApp>
    </QueryClientProvider>
  );
  const { rerender } = render(baum(true));
  /** Wie die Seite: nach `onClose` zu, danach wieder auf. */
  const wiederOeffnen = () => {
    rerender(baum(false));
    rerender(baum(true));
  };
  return { onClose, onGebucht, wiederOeffnen };
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

describe('EintreffenDialog — Aus Nachforderungen (LLH-1387, design.md D6)', () => {
  function erwartetMit(antwort: () => Response) {
    server.use(http.get('/api/einsaetze/1/bereitstellungsraeume/1/erwartet', antwort));
  }
  const NACHFORDERUNG = {
    nachforderung_id: 4,
    art: 'RTW',
    anzahl: 2,
    status: 'unterwegs',
    rufnamen: ['83-1', '83-2'],
    offen: 2,
  };

  it('nennt die offenen Rufnamen vor „Erwartet“ und bucht eine gleichnamige Einheit mit Verweis', async () => {
    erwartetMit(() => HttpResponse.json([NACHFORDERUNG]));
    const { onClose } = zeige({ einheiten: [...EINHEITEN, einheit(32, '83-1')] });
    const gruppe = await screen.findByRole('region', { name: 'Aus Nachforderungen' });
    expect(within(gruppe).getByText('83-2')).toBeInTheDocument();
    expect(within(gruppe).getAllByText(/Nachforderung 2× RTW/)).toHaveLength(2);
    const text = dialog().textContent ?? '';
    expect(text.indexOf('Aus Nachforderungen')).toBeLessThan(text.indexOf('Erwartet'));
    // Die gleichnamige Einheit steht nur einmal, unter der Nachforderung.
    expect(screen.getAllByRole('button', { name: 'Eintreffen 83-1' })).toHaveLength(1);
    await userEvent.click(within(gruppe).getByRole('button', { name: 'Eintreffen 83-1' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(koerper).toEqual([
      { kraft: { objekt_typ: 'einheit', objekt_id: 32 }, nachforderung_id: 4 },
    ]);
  });

  it('ohne gleichnamige Kraft führt die Zeile vorbelegt zu Schritt 2 und bucht mit Verweis', async () => {
    erwartetMit(() => HttpResponse.json([NACHFORDERUNG]));
    const { onClose } = zeige();
    await userEvent.click(await screen.findByRole('button', { name: 'Eintreffen 83-2' }));
    expect(await screen.findByRole('textbox', { name: 'Funkrufname' })).toHaveValue('83-2');
    expect(screen.getByRole('textbox', { name: 'Fahrzeugtyp' })).toHaveValue('RTW');
    expect(within(dialog()).getByText('Aus Nachforderung 2× RTW')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Eintreffen buchen' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(koerper).toEqual([
      {
        unangemeldet: { fahrzeuge: [{ funkrufname: '83-2', fahrzeugtyp: 'RTW' }] },
        nachforderung_id: 4,
      },
    ]);
  });

  it('„Zurück zur Suche“ löst den Bezug: „Nicht in der Liste“ bucht ohne Verweis', async () => {
    erwartetMit(() => HttpResponse.json([NACHFORDERUNG]));
    zeige();
    await userEvent.click(await screen.findByRole('button', { name: 'Eintreffen 83-2' }));
    await screen.findByText('Aus Nachforderung 2× RTW');
    await userEvent.click(screen.getByRole('button', { name: 'Zurück zur Suche' }));
    await zuSchrittZwei('Florian 3');
    expect(screen.queryByText('Aus Nachforderung 2× RTW')).toBeNull();
    expect(screen.getByRole('button', { name: 'Unangemeldet buchen' })).toBeInTheDocument();
  });

  it('„Diese buchen“ nach der Doppelbuchungs-Warnung behält den Verweis (LLH-1396)', async () => {
    erwartetMit(() => HttpResponse.json([NACHFORDERUNG]));
    const { onClose } = zeige();
    await userEvent.click(await screen.findByRole('button', { name: 'Eintreffen 83-2' }));
    const feld = await screen.findByRole('textbox', { name: 'Funkrufname' });
    await userEvent.clear(feld);
    await userEvent.type(feld, 'fl-mus 1-44-1');
    expect(await screen.findByText('Schon im Einsatz: FL-MUS 1-44-1')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Diese buchen' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(koerper).toEqual([
      { kraft: { objekt_typ: 'einheit', objekt_id: 30 }, nachforderung_id: 4 },
    ]);
  });

  it('ein Fahrzeug ohne Einheit bucht „Diese buchen“ ohne Verweis und sagt es (LLH-1396)', async () => {
    erwartetMit(() => HttpResponse.json([{ ...NACHFORDERUNG, rufnamen: ['RTW 2'], offen: 1 }]));
    const { onClose } = zeige();
    const gruppe = await screen.findByRole('region', { name: 'Aus Nachforderungen' });
    await userEvent.click(within(gruppe).getByRole('button', { name: 'Eintreffen RTW 2' }));
    expect(await screen.findByText('Schon im Einsatz: RTW 2')).toBeInTheDocument();
    expect(
      within(dialog()).getByText(/Fahrzeug ohne Einheit: ohne Verweis auf die Nachforderung/),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Diese buchen' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(koerper).toEqual([{ kraft: { objekt_typ: 'fahrzeug', objekt_id: 6 } }]);
  });

  it('ohne Freigabe Nachforderungen (403) fehlt die Gruppe still', async () => {
    erwartetMit(() => HttpResponse.json({ error: 'Kein Zugriff' }, { status: 403 }));
    zeige();
    expect(
      await screen.findByRole('button', { name: 'Eintreffen HLF 20 FF Musterstadt' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Aus Nachforderungen' })).toBeNull();
    expect(within(dialog()).queryByText('Kein Zugriff')).toBeNull();
  });
});

describe('EintreffenDialog — Schritt 2: unangemeldet', () => {
  it('übernimmt den Suchtext als Funkrufname', async () => {
    zeige();
    const funkrufname = await zuSchrittZwei('Florian Nachbar 3');
    expect(funkrufname).toHaveValue('Florian Nachbar 3');
  });

  it('„Zurück zur Suche“ und neuer Suchtext: Schritt 2 beginnt leer mit dem neuen Text', async () => {
    zeige();
    await zuSchrittZwei('Florian 3');
    await userEvent.type(screen.getByRole('textbox', { name: 'Trägerorganisation' }), 'FF Alt');
    await userEvent.click(screen.getByRole('button', { name: 'Zurück zur Suche' }));
    const feld = await screen.findByRole('searchbox', { name: 'Suche' });
    await userEvent.clear(feld);
    const funkrufname = await zuSchrittZwei('Florian 4');
    expect(funkrufname).toHaveValue('Florian 4');
    expect(screen.getByRole('textbox', { name: 'Trägerorganisation' })).toHaveValue('');
  });

  it('nach Abbrechen und erneutem Öffnen gilt der neue Suchtext', async () => {
    const { onClose, wiederOeffnen } = zeige();
    await zuSchrittZwei('Florian 3');
    await userEvent.click(screen.getByRole('button', { name: 'Abbrechen' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    wiederOeffnen();
    const funkrufname = await zuSchrittZwei('Florian 4');
    expect(funkrufname).toHaveValue('Florian 4');
  });

  it('nach Zurück und Buchung eines Treffers beginnt Schritt 2 beim nächsten Mal leer', async () => {
    const { onClose, wiederOeffnen } = zeige();
    await zuSchrittZwei('Florian 3');
    await userEvent.click(screen.getByRole('button', { name: 'Zurück zur Suche' }));
    const feld = await screen.findByRole('searchbox', { name: 'Suche' });
    await userEvent.clear(feld);
    await userEvent.click(screen.getByRole('button', { name: 'Eintreffen Zug Nord' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    wiederOeffnen();
    const funkrufname = await zuSchrittZwei('Florian 4');
    expect(funkrufname).toHaveValue('Florian 4');
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

  it('ein weiteres Fahrzeug mit Typ ohne Funkrufname sendet nichts', async () => {
    zeige();
    await zuSchrittZwei('Florian Nachbar 3');
    await userEvent.click(screen.getByRole('button', { name: /^Weiteres Fahrzeug/ }));
    await userEvent.click(await screen.findByRole('button', { name: 'Fahrzeug hinzufügen' }));
    await userEvent.type(
      await screen.findByRole('textbox', { name: 'Fahrzeugtyp weiteres Fahrzeug 1' }),
      'MTW',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Unangemeldet buchen' }));
    expect(await within(dialog()).findByText('Funkrufname angeben')).toBeInTheDocument();
    expect(koerper).toEqual([]);
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

describe('EintreffenDialog — ohne Netz (LLH-1075 Teil III)', () => {
  it('online trägt jede Buchung eine eigene client_id', async () => {
    const { wiederOeffnen } = zeige();
    await userEvent.click(await screen.findByRole('button', { name: 'Eintreffen RTW 2' }));
    await waitFor(() => expect(clientIds).toHaveLength(1));
    wiederOeffnen();
    await userEvent.click(await screen.findByRole('button', { name: 'Eintreffen RTW 2' }));
    await waitFor(() => expect(clientIds).toHaveLength(2));
    expect(clientIds[0]).toEqual(expect.any(String));
    expect(clientIds[1]).not.toBe(clientIds[0]);
  });

  it('unangemeldet ohne Netz: vorgemerkt, nichts gesendet, der Dialog schließt', async () => {
    const { onClose, onGebucht } = zeige();
    const funkrufname = await zuSchrittZwei('Florian Nachbar 3');
    expect(funkrufname).toHaveValue('Florian Nachbar 3');
    setzeOnline(false);
    await userEvent.click(screen.getByRole('button', { name: 'Unangemeldet buchen' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(
      await screen.findByText('Offline vorgemerkt: Eintreffen Florian Nachbar 3'),
    ).toBeInTheDocument();
    expect(koerper).toEqual([]);
    expect(onGebucht).not.toHaveBeenCalled();
    const [zeile] = await schreibaktionenLaden(11, 1);
    expect(zeile.aktion).toMatchObject({
      art: 'eintreffen',
      br_id: 1,
      bezeichnung: 'BR Sportplatz',
      name: 'Florian Nachbar 3',
      daten: { unangemeldet: { fahrzeuge: [{ funkrufname: 'Florian Nachbar 3' }] } },
    });
  });

  it('eine vorgemerkte Kraft: kein „Diese buchen“, der Treffer ist gesperrt', async () => {
    zeige({
      vorgemerkt: [
        { kraft: { objekt_typ: 'fahrzeug', objekt_id: 6 }, zeitpunkt_at: '2026-10-16 12:12:00' },
      ],
    });
    expect(await screen.findByRole('button', { name: 'Eintreffen RTW 2' })).toBeDisabled();
    expect(within(dialog()).getByText(/^vorgemerkt /)).toBeInTheDocument();
    await zuSchrittZwei('rtw 2');
    expect(await screen.findByText('Schon vorgemerkt: RTW 2')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Diese buchen' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Trotzdem neu anlegen' })).toBeInTheDocument();
  });

  it('eine vorgemerkte unangemeldete Kraft gleichen Namens: nur die Neuanlage', async () => {
    zeige({
      vorgemerkt: [
        {
          unangemeldet: { fahrzeuge: [{ funkrufname: 'Florian Nachbar 3' }] },
          zeitpunkt_at: '2026-10-16 12:12:00',
        },
      ],
    });
    await zuSchrittZwei('florian nachbar 3');
    expect(await screen.findByText('Schon vorgemerkt: Florian Nachbar 3')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Unangemeldet buchen' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Diese buchen' })).toBeNull();
  });

  it('ohne Kräfte des Einsatzes (nicht geladen) erfindet der Dialog keine Doppelbuchung', async () => {
    zeige({ einheiten: [], fahrzeuge: [] });
    await zuSchrittZwei('HLF 20 FF Musterstadt');
    expect(screen.queryByText(/^Schon /)).toBeNull();
    expect(screen.getByRole('button', { name: 'Unangemeldet buchen' })).toBeEnabled();
  });
});
