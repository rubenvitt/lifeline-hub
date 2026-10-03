import { http, HttpResponse } from 'msw';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ArchivAkte, PersonTreffer, Schwaerzungsantrag } from '../api/types';
import { formatZeit } from '../anzeige/format';
import { server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import Loeschersuchen, { antragswege } from './Loeschersuchen';
import PersonensucheDialog from './PersonensucheDialog';
import SchwaerzungsantragDialog, {
  type AntragZielWahl,
  antragBody,
  kennungPasst,
  vollzugAb,
} from './SchwaerzungsantragDialog';

/** Löschersuchen nach Art. 17 (LFH-751): Rückfrage, Personensuche, Paneel der Akte. */

const BASIS = '/api/aufbewahrung/einsaetze/7';
let gesendet: Record<string, unknown>[];

beforeEach(() => {
  gesendet = [];
});

// ---------- Rückfrage ----------

function DialogHarness({ ziel }: { ziel: AntragZielWahl }) {
  const [offen, setOffen] = useState(true);
  return offen ? (
    <SchwaerzungsantragDialog einsatzId={7} ziel={ziel} onSchliessen={() => setOffen(false)} />
  ) : (
    <output aria-label="zu">zu</output>
  );
}

const PERSON: AntragZielWahl = { art: 'betroffene', id: 11, kennung: 'R-042' };

describe('SchwaerzungsantragDialog', () => {
  it('Kennung „R-04“ für R-042 → Absenden gesperrt; erst die passende Kennung gibt frei', async () => {
    server.use(
      http.post(`${BASIS}/schwaerzungsantraege`, async ({ request }) => {
        gesendet.push((await request.json()) as Record<string, unknown>);
        return HttpResponse.json({}, { status: 201 });
      }),
    );
    const { client } = renderMitProviders(<DialogHarness ziel={PERSON} />);
    const invalidiert = vi.spyOn(client, 'invalidateQueries');
    const dialog = await screen.findByRole('dialog', {
      name: 'Löschersuchen: Betroffene Person R-042',
    });
    expect(dialog.querySelector('[data-lfh="antrag-faellig"]')).not.toBeNull();
    const knopf = within(dialog).getByRole('button', { name: 'Person schwärzen lassen' });
    expect(knopf).toBeDisabled();
    expect(knopf).toHaveClass('ant-btn-dangerous');
    const u = userEvent.setup();
    const [az, kennung] = within(dialog).getAllByRole('textbox');
    await u.type(az!, 'DS-2026-014');
    await u.type(kennung!, 'R-04');
    expect(knopf).toBeDisabled();
    await u.type(kennung!, '2');
    expect(knopf).toBeEnabled();
    await u.click(knopf);
    await waitFor(() => expect(gesendet).toHaveLength(1));
    expect(gesendet[0]).toEqual({
      ziel: { art: 'betroffene', id: 11 },
      aktenzeichen: 'DS-2026-014',
      bestaetigung: 'R-042',
    });
    expect(await screen.findByLabelText('zu')).toBeInTheDocument();
    // Präfix: Übersicht, Akte und Antragsliste in einem Zug.
    expect(invalidiert).toHaveBeenCalledWith({ queryKey: ['aufbewahrung'] });
  });

  it('nennt die Freitext-Erwähnungen nur beim Personen-Antrag', async () => {
    const { unmount } = renderMitProviders(<DialogHarness ziel={PERSON} />);
    const dialog = await screen.findByRole('dialog');
    expect(dialog.querySelector('[data-lfh="antrag-freitext-hinweis"]')).not.toBeNull();
    unmount();
    renderMitProviders(<DialogHarness ziel={{ art: 'einsatz', kennung: 'E-2026-0007' }} />);
    const einsatz = await screen.findByRole('dialog', {
      name: 'Löschersuchen: Einsatz E-2026-0007',
    });
    expect(einsatz.querySelector('[data-lfh="antrag-freitext-hinweis"]')).toBeNull();
    expect(
      within(einsatz).getByRole('button', { name: 'Einsatz schwärzen lassen' }),
    ).toBeDisabled();
  });

  it('zeigt die Ablehnung des Servers im Dialog und lässt die Felder stehen', async () => {
    server.use(
      http.post(`${BASIS}/schwaerzungsantraege`, () =>
        HttpResponse.json(
          { error: 'Für R-042 besteht bereits ein offener Antrag' },
          { status: 409 },
        ),
      ),
    );
    renderMitProviders(<DialogHarness ziel={PERSON} />);
    const dialog = await screen.findByRole('dialog');
    const u = userEvent.setup();
    const [az, kennung] = within(dialog).getAllByRole('textbox');
    await u.type(az!, 'DS-1');
    await u.type(kennung!, 'R-042');
    await u.click(within(dialog).getByRole('button', { name: 'Person schwärzen lassen' }));
    expect(await within(dialog).findByText(/bereits ein offener Antrag/)).toBeInTheDocument();
    expect(az).toHaveValue('DS-1');
  });

  it('Body, Kennungsvergleich und Fälligkeit sind rein', () => {
    expect(vollzugAb(new Date('2026-10-02T08:00:00Z'))).toBe('2026-10-03 08:00:00');
    expect(kennungPasst(' R-042 ', 'R-042')).toBe(true);
    expect(kennungPasst('r-042', 'R-042')).toBe(false);
    expect(kennungPasst(undefined, 'R-042')).toBe(false);
    expect(
      antragBody({ art: 'einsatz', kennung: 'E-1' }, { aktenzeichen: ' A ', bestaetigung: 'E-1 ' }),
    ).toEqual({
      ziel: { art: 'einsatz' },
      aktenzeichen: 'A',
      bestaetigung: 'E-1',
    });
  });
});

// ---------- Personensuche ----------

const TREFFER: PersonTreffer[] = [
  {
    art: 'betroffene',
    id: 11,
    kennung: 'R-042',
    erfasst_at: '2026-05-01 09:00:00',
    person_status: 'betroffen',
  },
  {
    art: 'infotelefon_anruf',
    id: 5,
    kennung: 'IT-5',
    erfasst_at: '2026-05-01 10:00:00',
    antrag: 'offen',
  },
];

describe('PersonensucheDialog', () => {
  it('sucht per POST, zeigt nur Kennungen und bietet den Antrag nur ohne bestehenden an', async () => {
    server.use(
      http.post(`${BASIS}/personensuche`, async ({ request }) => {
        gesendet.push((await request.json()) as Record<string, unknown>);
        return HttpResponse.json(TREFFER);
      }),
    );
    let gewaehlt: PersonTreffer | null = null;
    renderMitProviders(
      <PersonensucheDialog
        einsatzId={7}
        onWaehlen={(t) => (gewaehlt = t)}
        onSchliessen={() => {}}
      />,
    );
    const dialog = await screen.findByRole('dialog', { name: 'Person suchen' });
    const u = userEvent.setup();
    const feld = within(dialog).getByRole('textbox');
    await u.type(feld, 'ab{Enter}');
    expect(await within(dialog).findByText('Mindestens 3 Zeichen')).toBeInTheDocument();
    expect(gesendet).toHaveLength(0);
    await u.clear(feld);
    await u.type(feld, 'Erika Mustermann{Enter}');
    await waitFor(() => expect(gesendet).toEqual([{ suchtext: 'Erika Mustermann' }]));
    const treffer = await within(dialog).findByText('2 Treffer');
    expect(treffer).toBeInTheDocument();
    expect(within(dialog).getByText('R-042')).toBeInTheDocument();
    expect(within(dialog).getByText('Anruf am Informationstelefon')).toBeInTheDocument();
    // Nur der Treffer ohne Antrag bekommt die Aktion.
    const knoepfe = within(dialog).getAllByRole('button', { name: /Antrag stellen für/ });
    expect(knoepfe.map((k) => k.getAttribute('aria-label'))).toEqual(['Antrag stellen für R-042']);
    await u.click(knoepfe[0]!);
    expect(gewaehlt).toEqual(TREFFER[0]);
  });
});

// ---------- Paneel der Akte ----------

function antrag(over: Partial<Schwaerzungsantrag> = {}): Schwaerzungsantrag {
  return {
    id: 1,
    ziel_art: 'betroffene',
    ziel_id: 11,
    ziel_kennung: 'R-042',
    aktenzeichen: 'DS-2026-014',
    beantragt_von_name: 'Admin',
    beantragt_at: '2026-10-02 08:00:00',
    faellig_at: '2026-10-03 08:00:00',
    stand: 'offen',
    zuruecknehmbar: true,
    ...over,
  };
}

function akte(zustand: ArchivAkte['zustand']): ArchivAkte {
  return {
    kopf: {
      id: 7,
      bezeichnung: 'Hochwasser Nord',
      einsatzart: 'realeinsatz',
      einsatznummer_intern: 'E-2026-0007',
      begonnen_at: '2026-05-01 08:00:00',
    },
    zustand,
    kategorien: [],
    personen: [],
    tiere: [],
    schaeden: [],
  };
}

describe('Loeschersuchen', () => {
  it('Offener Antrag: Fälligkeit und „Zurücknehmen“; nach der Rücknahme lädt die Liste neu', async () => {
    let zurueck = 0;
    let stand: Schwaerzungsantrag[] = [
      antrag(),
      antrag({
        id: 2,
        ziel_kennung: 'IT-5',
        ziel_art: 'infotelefon_anruf',
        stand: 'vollzogen',
        zuruecknehmbar: false,
        vollzogen_at: '2026-10-01 08:00:00',
      }),
    ];
    server.use(
      http.get(`${BASIS}/schwaerzungsantraege`, () => HttpResponse.json(stand)),
      http.post(`${BASIS}/schwaerzungsantraege/1/zuruecknehmen`, () => {
        zurueck += 1;
        stand = [
          antrag({
            stand: 'zurueckgenommen',
            zuruecknehmbar: false,
            zurueckgenommen_at: '2026-10-02 09:00:00',
            zurueckgenommen_von_name: 'Admin Zwei',
          }),
        ];
        return HttpResponse.json(stand);
      }),
    );
    renderMitProviders(<Loeschersuchen einsatzId={7} akte={akte('frist_laeuft')} />);
    const knopf = await screen.findByRole('button', { name: 'Antrag für R-042 zurücknehmen' });
    expect(screen.queryByRole('button', { name: 'Antrag für IT-5 zurücknehmen' })).toBeNull();
    expect(screen.getAllByText('DS-2026-014')).toHaveLength(2);
    // „Vollzug ab“ beider Zeilen (gleiche Fälligkeit im Fixture).
    expect(screen.getAllByText(formatZeit('2026-10-03 08:00:00'))).toHaveLength(2);
    await userEvent.setup().click(knopf);
    await waitFor(() => expect(zurueck).toBe(1));
    expect(screen.queryByRole('dialog')).toBeNull();
    // Neu geladen: kein Knopf mehr, die zurücknehmende Person steht da.
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Antrag für R-042 zurücknehmen' })).toBeNull(),
    );
    expect(screen.getByText('Admin Zwei', { exact: false })).toBeInTheDocument();
  });

  it('Rücknahme zu spät (409): Fehler am Paneel, Liste lädt neu', async () => {
    let gets = 0;
    server.use(
      http.get(`${BASIS}/schwaerzungsantraege`, () => {
        gets += 1;
        return HttpResponse.json([antrag()]);
      }),
      http.post(`${BASIS}/schwaerzungsantraege/1/zuruecknehmen`, () =>
        HttpResponse.json(
          {
            error:
              'Die 24 Stunden sind abgelaufen — der Antrag wird im nächsten Purge-Lauf vollzogen',
          },
          { status: 409 },
        ),
      ),
    );
    renderMitProviders(<Loeschersuchen einsatzId={7} akte={akte('frist_laeuft')} />);
    const knopf = await screen.findByRole('button', { name: 'Antrag für R-042 zurücknehmen' });
    await userEvent.setup().click(knopf);
    expect(await screen.findByText(/24 Stunden sind abgelaufen/)).toBeInTheDocument();
    await waitFor(() => expect(gets).toBeGreaterThanOrEqual(2));
  });

  it('Geschwärzter Einsatz: keine Antragsaktion', async () => {
    server.use(http.get(`${BASIS}/schwaerzungsantraege`, () => HttpResponse.json([])));
    renderMitProviders(<Loeschersuchen einsatzId={7} akte={akte('geschwaerzt')} />);
    expect(await screen.findByText('Kein Löschersuchen gestellt')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Person suchen und schwärzen' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Einsatz sofort schwärzen' })).toBeNull();
  });

  it('„Einsatz sofort schwärzen“ öffnet die Rückfrage mit der Einsatznummer', async () => {
    server.use(http.get(`${BASIS}/schwaerzungsantraege`, () => HttpResponse.json([])));
    renderMitProviders(<Loeschersuchen einsatzId={7} akte={akte('frist_laeuft')} />);
    const knopf = await screen.findByRole('button', { name: 'Einsatz sofort schwärzen' });
    expect(knopf).toHaveClass('ant-btn-dangerous');
    await userEvent.setup().click(knopf);
    expect(
      await screen.findByRole('dialog', { name: 'Löschersuchen: Einsatz E-2026-0007' }),
    ).toBeInTheDocument();
  });

  it('Antragswege je Zustand', () => {
    expect(antragswege({ zustand: 'frist_laeuft' })).toEqual({ person: true, einsatz: true });
    expect(antragswege({ zustand: 'vorgemerkt' })).toEqual({ person: true, einsatz: true });
    expect(antragswege({ zustand: 'schwaerzung_beantragt' })).toEqual({
      person: true,
      einsatz: false,
    });
    expect(antragswege({ zustand: 'geschwaerzt' })).toEqual({ person: false, einsatz: false });
  });
});
