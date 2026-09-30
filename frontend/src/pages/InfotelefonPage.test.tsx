import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router';
import { renderMitProviders } from '../test/utils';
import { ladeEinsatz, ladeModulOverrides } from '../api/einsaetze';
import { erfasseAnruf, ladeAnrufe, setzeAnrufStatus } from '../api/infotelefon';
import { ApiError } from '../api/client';
import type { EinsatzAnzeige, InfotelefonAnruf } from '../api/types';
import InfotelefonPage from './InfotelefonPage';

vi.mock('../api/einsaetze', () => ({ ladeEinsatz: vi.fn(), ladeModulOverrides: vi.fn() }));
vi.mock('../api/infotelefon', () => ({
  ladeAnrufe: vi.fn(),
  erfasseAnruf: vi.fn(),
  setzeAnrufStatus: vi.fn(),
}));

const EINSATZ = {
  id: 1,
  bezeichnung: 'Hochwasser Nord',
  status: 'aktiv',
  meine_rolle: 'einsatzleitung',
} as EinsatzAnzeige;

function anruf(teil: Partial<InfotelefonAnruf>): InfotelefonAnruf {
  return {
    id: 1,
    einsatz_id: 1,
    anliegen: 'auskunft_lage',
    status: 'erledigt',
    eingang_at: '2026-09-30 10:00:00',
    angelegt_von_id: 1,
    angelegt_at: '2026-09-30 10:00:00',
    ...teil,
  };
}

const ANRUFE = [
  anruf({
    id: 2,
    anliegen: 'vermisstensuche',
    status: 'offen',
    rueckruf: '0171 000',
    anrufer_name: 'K. Meyer',
    notiz: 'sucht Vater',
  }),
  anruf({ id: 1, notiz: 'Sperrung B 3' }),
];

function setup(route = '/einsaetze/1/stab/infotelefon') {
  return renderMitProviders(
    <Routes>
      <Route path="/einsaetze/:id/stab/infotelefon" element={<InfotelefonPage />} />
    </Routes>,
    { route },
  );
}

const kennzahl = (titel: string) =>
  screen.getAllByText(titel)[0].closest('[data-lfh="kennzahl"], div') as HTMLElement;

beforeEach(() => {
  vi.mocked(ladeEinsatz).mockResolvedValue(EINSATZ);
  vi.mocked(ladeModulOverrides).mockResolvedValue({});
  vi.mocked(ladeAnrufe).mockResolvedValue(ANRUFE);
  vi.mocked(erfasseAnruf)
    .mockReset()
    .mockResolvedValue(anruf({ id: 3 }));
  vi.mocked(setzeAnrufStatus)
    .mockReset()
    .mockResolvedValue(anruf({ id: 2 }));
});

describe('InfotelefonPage (LFH-554)', () => {
  it('zählt Anrufe und offene Rückrufe aus derselben Liste wie die Zeitachse', async () => {
    setup();
    const liste = await screen.findByRole('list', { name: 'Anrufprotokoll' });
    await waitFor(() => expect(within(liste).getAllByRole('listitem')).toHaveLength(2));
    expect(within(kennzahl('Anrufe').parentElement!).getByText('2')).toBeInTheDocument();
    expect(within(kennzahl('offene Rückrufe').parentElement!).getByText('1')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Nach Anliegen' })).toHaveTextContent(
      /Vermisstensuche1Auskunft zur Lage1/,
    );
  });

  it('zeigt ohne geladene Liste keine Zahl', async () => {
    vi.mocked(ladeAnrufe).mockRejectedValue(new ApiError(500, 'kaputt'));
    setup();
    expect(await screen.findByText('Anrufe konnten nicht geladen werden')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Nach Anliegen' })).toBeNull();
    expect(screen.queryByText('2')).toBeNull();
  });

  it('filtert auf offene Rückrufe', async () => {
    setup();
    await screen.findByText('Sperrung B 3');
    await userEvent.click(screen.getByRole('radio', { name: 'offene Rückrufe' }));
    await waitFor(() => expect(screen.queryByText('Sperrung B 3')).toBeNull());
    expect(screen.getByText('sucht Vater')).toBeInTheDocument();
  });

  it('führt bei Vermisstensuche zu den Vermissten — nur mit Freigabe der Personen', async () => {
    const { unmount } = setup();
    expect(await screen.findByRole('link', { name: /Vermisste/ })).toHaveAttribute(
      'href',
      expect.stringContaining('filter=vermisst'),
    );
    unmount();
    vi.mocked(ladeModulOverrides).mockResolvedValue({
      personen: { sichtbar: false, einsatz_id: 1, modul_key: 'personen' },
    });
    setup();
    await screen.findByText('sucht Vater');
    expect(screen.queryByRole('link', { name: /Vermisste/ })).toBeNull();
  });

  it('erledigt einen offenen Rückruf über die Statusanzeige', async () => {
    setup();
    const eintrag = (await screen.findByText('sucht Vater')).closest('li') as HTMLElement;
    await userEvent.click(
      within(eintrag).getByRole('button', {
        name: /^Status von Anruf Vermisstensuche \d{6}[A-Z]{3}\d{4} ändern$/,
      }),
    );
    await userEvent.click(await screen.findByRole('menuitem', { name: /erledigt/ }));
    await waitFor(() => expect(setzeAnrufStatus).toHaveBeenCalledWith(1, 2, 'erledigt'));
  });

  it('Beobachtung liest, die Erfassung fehlt, und der Grund steht da', async () => {
    vi.mocked(ladeEinsatz).mockResolvedValue({ ...EINSATZ, meine_rolle: 'beobachter' });
    setup();
    expect(
      await screen.findByText(/Nur Einsatzleitung und Führungspersonal können Anrufe/),
    ).toBeInTheDocument();
    await screen.findByText('Sperrung B 3');
    expect(screen.queryByRole('button', { name: 'Erfassen' })).toBeNull();
  });
});
