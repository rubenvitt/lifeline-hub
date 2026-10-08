import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router';
import { renderMitProviders } from '../test/utils';
import { ladeEinsatz, ladeModulFreigaben } from '../api/einsaetze';
import {
  ladeErledigteMedienkontakte,
  ladeMedienkontakt,
  ladeMedienkontakte,
  ladePressemitteilungen,
} from '../api/presse';
import { ladeAnrufe } from '../api/infotelefon';
import type { EinsatzAnzeige, Medienkontakt } from '../api/types';
import PressePage from './PressePage';
import { freigabenFixture } from '../test/fixtures';

/**
 * Presse-Log mit vielen erledigten Kontakten (LFH-1075, Spec `stab-presse-log`): offene
 * vollständig, erledigte seitenweise, Zahlen und Medienlage über den ganzen Bestand.
 */

vi.mock('../api/einsaetze', () => ({ ladeEinsatz: vi.fn(), ladeModulFreigaben: vi.fn() }));
vi.mock('../api/presse', async (orig) => {
  const echt = await orig<typeof import('../api/presse')>();
  const { presseLeseAttrappe } = await import('../test/presseAttrappe');
  const ladeMedienkontakte = vi.fn();
  const attrappe = presseLeseAttrappe((e) => ladeMedienkontakte(e));
  return {
    MEDIENKONTAKTE_SEITE: echt.MEDIENKONTAKTE_SEITE,
    eingangCursor: echt.eingangCursor,
    ladeMedienkontakte,
    ...attrappe,
    // Beobachtbar: welche Seiten und Einzelabrufe die Seite holt.
    ladeErledigteMedienkontakte: vi.fn(attrappe.ladeErledigteMedienkontakte),
    ladeMedienkontakt: vi.fn(attrappe.ladeMedienkontakt),
    ladePressemitteilungen: vi.fn(),
    legeMedienkontaktAn: vi.fn(),
    legePressemitteilungAn: vi.fn(),
    setzeMedienkontaktStatus: vi.fn(),
  };
});
vi.mock('../api/infotelefon', () => ({ ladeAnrufe: vi.fn() }));

const EINSATZ = {
  id: 1,
  bezeichnung: 'Hochwasser Nord',
  status: 'aktiv',
  meine_rolle: 'einsatzleitung',
} as EinsatzAnzeige;

const zweistellig = (n: number) => String(n).padStart(2, '0');

/** Zwei offene Anfragen und 150 erledigte Termine, der älteste zuerst erfasst. */
const BESTAND: Medienkontakt[] = [
  ...Array.from({ length: 150 }, (_, i) => ({
    id: i + 1,
    einsatz_id: 1,
    art: 'termin' as const,
    medium: i % 2 ? 'RTL' : 'dpa',
    thema: `Termin ${i + 1}`,
    eingang_at: `2026-09-${zweistellig(1 + Math.floor(i / 24))} ${zweistellig(i % 24)}:00:00`,
    status: 'erledigt' as const,
    angelegt_von_id: 1,
    angelegt_at: '2026-09-01 00:00:00',
  })),
  ...[1, 2].map((n) => ({
    id: 200 + n,
    einsatz_id: 1,
    art: 'anfrage' as const,
    medium: 'NDR 1',
    thema: `Anfrage ${n}`,
    kontakt_name: 'Maria Beispiel',
    eingang_at: `2026-09-30 1${n}:00:00`,
    status: 'offen' as const,
    angelegt_von_id: 1,
    angelegt_at: '2026-09-30 10:00:00',
  })),
];

function setup(route = '/einsaetze/1/stab/presse') {
  return renderMitProviders(
    <Routes>
      <Route path="/einsaetze/:id/stab/presse" element={<PressePage />} />
    </Routes>,
    { route },
  );
}

const karten = () => document.querySelectorAll('[data-lfh="datensicht-karte"]');

beforeEach(() => {
  vi.mocked(ladeEinsatz).mockResolvedValue(EINSATZ);
  vi.mocked(ladeModulFreigaben).mockResolvedValue(freigabenFixture());
  vi.mocked(ladeMedienkontakte).mockResolvedValue(BESTAND);
  vi.mocked(ladePressemitteilungen).mockResolvedValue([]);
  vi.mocked(ladeAnrufe).mockResolvedValue([]);
  vi.mocked(ladeErledigteMedienkontakte).mockClear();
  vi.mocked(ladeMedienkontakt).mockClear();
});

describe('PressePage · Blättern (LFH-1075)', () => {
  it('lädt die offenen ganz und die erledigten seitenweise, Zahlen über den Bestand', async () => {
    setup();
    expect(await screen.findByText('102 von 152 geladen')).toBeInTheDocument();
    expect(karten()).toHaveLength(102);
    expect(screen.getByText(/^152 Medienkontakte/)).toBeInTheDocument();
    // Offene zuerst, dann der jüngste erledigte.
    expect(karten()[0]).toHaveTextContent('NDR 1 · Anfrage 2');
    expect(karten()[2]).toHaveTextContent('Termin 150');

    await userEvent.click(screen.getByRole('button', { name: 'Ältere laden' }));
    await waitFor(() => expect(karten()).toHaveLength(152));
    expect(screen.queryByRole('button', { name: 'Ältere laden' })).toBeNull();
    expect(vi.mocked(ladeErledigteMedienkontakte).mock.calls[1][1]).toEqual({
      zeit: BESTAND[50].eingang_at,
      id: 51,
    });
  });

  it('die Medienlage zählt den ganzen Bestand, ohne Personenbezug', async () => {
    setup();
    const lage = await screen.findByRole('region', { name: 'Medienlage' });
    await waitFor(() =>
      expect(
        within(lage).getByText(/152 gesamt, davon 2 offen \(Anfrage 2, Termin 150\)/),
      ).toBeInTheDocument(),
    );
    expect(within(lage).getByText(/Medien: NDR 1, RTL, dpa/)).toBeInTheDocument();
    expect(within(lage).queryByText(/Maria/)).toBeNull();
  });

  it('offene Anfragen und die Sicht „offen“ kommen ohne erledigte aus', async () => {
    setup();
    await screen.findByText('102 von 152 geladen');
    await userEvent.click(screen.getByRole('radio', { name: 'offen' }));
    await waitFor(() => expect(karten()).toHaveLength(2));
    expect(screen.queryByRole('button', { name: 'Ältere laden' })).toBeNull();
  });

  it('ein Deeplink auf einen älteren erledigten Kontakt holt ihn einzeln und hebt ihn hervor', async () => {
    const { container } = setup('/einsaetze/1/stab/presse?kontakt=3');
    await waitFor(() =>
      expect(container.querySelector('.zeile-hervorgehoben')?.textContent).toContain('Termin 3'),
    );
    expect(ladeMedienkontakt).toHaveBeenCalledWith(1, 3);
    // Er steht hinter den geladenen, die Seiten selbst blieben bei einer.
    expect(karten()).toHaveLength(103);
    expect(ladeErledigteMedienkontakte).toHaveBeenCalledTimes(1);
  });
});
