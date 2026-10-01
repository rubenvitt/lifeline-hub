import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router';
import { renderMitProviders } from '../test/utils';
import { ladeEinsatz, ladeModulFreigaben } from '../api/einsaetze';
import {
  ladeMedienkontakte,
  ladePressemitteilungen,
  legeMedienkontaktAn,
  setzeMedienkontaktStatus,
} from '../api/presse';
import { ladeAnrufe } from '../api/infotelefon';
import type { EinsatzAnzeige, Medienkontakt, Pressemitteilung } from '../api/types';
import PressePage, { statusOptionen } from './PressePage';
import { freigabenFixture } from '../test/fixtures';

vi.mock('../api/einsaetze', () => ({ ladeEinsatz: vi.fn(), ladeModulFreigaben: vi.fn() }));
vi.mock('../api/presse', () => ({
  ladeMedienkontakte: vi.fn(),
  ladePressemitteilungen: vi.fn(),
  legeMedienkontaktAn: vi.fn(),
  legePressemitteilungAn: vi.fn(),
  setzeMedienkontaktStatus: vi.fn(),
}));
vi.mock('../api/infotelefon', () => ({ ladeAnrufe: vi.fn() }));

const EINSATZ = {
  id: 1,
  bezeichnung: 'Hochwasser Nord',
  status: 'aktiv',
  meine_rolle: 'einsatzleitung',
} as EinsatzAnzeige;

function kontakt(teil: Partial<Medienkontakt>): Medienkontakt {
  return {
    id: 1,
    einsatz_id: 1,
    art: 'anfrage',
    medium: 'NDR 1',
    thema: 'Evakuierte',
    kontakt_name: 'Maria Beispiel',
    eingang_at: '2026-09-30 10:00:00',
    status: 'offen',
    angelegt_von_id: 1,
    angelegt_at: '2026-09-30 10:00:00',
    ...teil,
  };
}

const PM = {
  id: 4,
  einsatz_id: 1,
  vorlage: 'erstinformation',
  titel: 'Hochwasser Musterstadt',
  zeitstand: '2026-09-30 12:00:00',
  status: 'freigegeben',
  abschnitte: [],
  version: 1,
  ersteller_id: 1,
  ersteller_name: 'Anna',
  erstellt_at: '2026-09-30 12:00:00',
  aktualisiert_at: '2026-09-30 12:00:00',
  freigegeben_at: '2026-09-30 13:00:00',
} as Pressemitteilung;

function setup(route = '/einsaetze/1/stab/presse') {
  return renderMitProviders(
    <Routes>
      <Route path="/einsaetze/:id/stab/presse" element={<PressePage />} />
    </Routes>,
    { route },
  );
}

beforeEach(() => {
  vi.mocked(ladeEinsatz).mockResolvedValue(EINSATZ);
  vi.mocked(ladeModulFreigaben).mockResolvedValue(freigabenFixture());
  vi.mocked(ladeMedienkontakte).mockResolvedValue([
    kontakt({}),
    kontakt({ id: 2, art: 'termin', medium: 'RTL', thema: 'Dreh', status: 'erledigt' }),
  ]);
  vi.mocked(ladePressemitteilungen).mockResolvedValue([PM]);
  vi.mocked(ladeAnrufe).mockResolvedValue([]);
  vi.mocked(legeMedienkontaktAn)
    .mockReset()
    .mockResolvedValue(kontakt({ id: 3 }));
  vi.mocked(setzeMedienkontaktStatus).mockReset().mockResolvedValue(kontakt({}));
});

describe('statusOptionen', () => {
  it('bietet von „offen“ die Ziele der Art an, sonst nur den Rückweg', () => {
    expect(statusOptionen({ art: 'anfrage', status: 'offen' })).toEqual([
      'offen',
      'beantwortet',
      'abgelehnt',
    ]);
    expect(statusOptionen({ art: 'termin', status: 'offen' })).toEqual(['offen', 'erledigt']);
    expect(statusOptionen({ art: 'anfrage', status: 'abgelehnt' })).toEqual(['abgelehnt', 'offen']);
  });
});

describe('PressePage (LFH-554)', () => {
  it('zeigt Medienlage, Pressemitteilungen und Presse-Log, die Medienlage ohne Personenbezug', async () => {
    setup();
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Pressearbeit' }),
    ).toBeInTheDocument();
    const lage = await screen.findByRole('region', { name: 'Medienlage' });
    await waitFor(() =>
      expect(within(lage).getByText(/2 gesamt, davon 1 offen/)).toBeInTheDocument(),
    );
    expect(within(lage).queryByText(/Maria/)).toBeNull();
    expect(await screen.findByRole('link', { name: 'Hochwasser Musterstadt' })).toHaveAttribute(
      'href',
      '/einsaetze/1/stab/presse/mitteilungen/4',
    );
    expect(await screen.findByText('NDR 1 · Evakuierte')).toBeInTheDocument();
  });

  it('filtert per Segmentleiste auf offene Kontakte', async () => {
    setup();
    await screen.findByText('RTL · Dreh');
    await userEvent.click(screen.getByRole('radio', { name: 'offen' }));
    await waitFor(() => expect(screen.queryByText('RTL · Dreh')).toBeNull());
    expect(screen.getByText('NDR 1 · Evakuierte')).toBeInTheDocument();
  });

  it('erfasst einen Medienkontakt per Enter', async () => {
    setup();
    await userEvent.click(await screen.findByRole('button', { name: 'Medienkontakt erfassen' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText('Medium'), 'dpa');
    await userEvent.type(within(dialog).getByLabelText('Thema'), 'Sperrung B 3{Enter}');
    await waitFor(() =>
      expect(legeMedienkontaktAn).toHaveBeenCalledWith(1, {
        art: 'anfrage',
        medium: 'dpa',
        thema: 'Sperrung B 3',
        kontakt_name: undefined,
        kontakt_erreichbarkeit: undefined,
      }),
    );
  });

  it('hält das Feldbudget: drei sichtbare Felder, der Rest eingeklappt (Gegenprobe: Aufklappen)', async () => {
    setup();
    await userEvent.click(await screen.findByRole('button', { name: 'Medienkontakt erfassen' }));
    const dialog = await screen.findByRole('dialog');
    const felder = () => dialog.querySelectorAll('.ant-form-item').length;
    expect(felder()).toBe(3);
    await userEvent.click(within(dialog).getByText('Ansprechperson und Uhrzeit'));
    await waitFor(() => expect(felder()).toBe(6));
  });

  it('eine Ablehnung ist ohne Rückfrage und per Toast rückgängig zu machen', async () => {
    setup();
    await userEvent.click(
      await screen.findByRole('button', { name: 'Status von NDR 1 · Evakuierte ändern' }),
    );
    await userEvent.click(await screen.findByRole('menuitem', { name: /abgelehnt/ }));
    await waitFor(() =>
      expect(setzeMedienkontaktStatus).toHaveBeenCalledWith(1, 1, { status: 'abgelehnt' }),
    );
    expect(screen.queryByRole('dialog')).toBeNull();
    await userEvent.click(await screen.findByRole('button', { name: 'Rückgängig' }));
    await waitFor(() =>
      expect(setzeMedienkontaktStatus).toHaveBeenLastCalledWith(1, 1, { status: 'offen' }),
    );
  });

  it('„Beantworten“ verlangt die Antwort und sendet sie mit der Freigabeangabe', async () => {
    setup();
    await userEvent.click(
      await screen.findByRole('button', { name: 'Anfrage von NDR 1 beantworten' }),
    );
    const dialog = await screen.findByRole('dialog', { name: /beantworten/ });
    await userEvent.click(
      within(dialog).getByRole('button', { name: 'Als beantwortet speichern' }),
    );
    expect(await within(dialog).findByText('Antwort erforderlich')).toBeInTheDocument();
    expect(setzeMedienkontaktStatus).not.toHaveBeenCalled();
    await userEvent.type(within(dialog).getByLabelText('Gegebene Antwort'), '240 Personen');
    await userEvent.type(within(dialog).getByLabelText('Freigegeben durch'), 'EL');
    await userEvent.click(
      within(dialog).getByRole('button', { name: 'Als beantwortet speichern' }),
    );
    await waitFor(() =>
      expect(setzeMedienkontaktStatus).toHaveBeenCalledWith(1, 1, {
        status: 'beantwortet',
        antwort: '240 Personen',
        freigabe_durch: 'EL',
        pressemitteilung_id: undefined,
      }),
    );
  });

  it('hebt den per ?kontakt= angesteuerten Kontakt hervor', async () => {
    const { container } = setup('/einsaetze/1/stab/presse?kontakt=2');
    await screen.findByText('RTL · Dreh');
    await waitFor(() =>
      expect(container.querySelector('.zeile-hervorgehoben')?.textContent).toContain('RTL'),
    );
  });

  it('Beobachtung: Aktionen gesperrt sichtbar, der Grund steht da', async () => {
    vi.mocked(ladeEinsatz).mockResolvedValue({ ...EINSATZ, meine_rolle: 'beobachter' });
    setup();
    expect(
      await screen.findByText(/Nur Einsatzleitung und Führungspersonal können Medienkontakte/),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Medienkontakt erfassen' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Neue Pressemitteilung' })).toBeDisabled();
    await screen.findByText('NDR 1 · Evakuierte');
    expect(screen.queryByRole('button', { name: 'Anfrage von NDR 1 beantworten' })).toBeNull();
  });

  it('ist bei gesperrtem Stab nicht erreichbar und lädt nichts', async () => {
    vi.mocked(ladeMedienkontakte).mockClear();
    vi.mocked(ladeModulFreigaben).mockResolvedValue(
      freigabenFixture({ stab: { sichtbar: false } }),
    );
    setup();
    expect(await screen.findByText('Pressearbeit nicht verfügbar')).toBeInTheDocument();
    expect(ladeMedienkontakte).not.toHaveBeenCalled();
  });
});
