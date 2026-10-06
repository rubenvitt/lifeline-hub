import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router';
import { renderMitProviders } from '../test/utils';
import { mitProzessZone } from '../test/prozessZone';
import { AnzeigeKonventionenProvider } from '../anzeige/AnzeigeKonventionenContext';
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

  it('jede Pressemitteilung ist eine Überschrift unter dem Paneel (h2 → h3, LFH-826)', async () => {
    setup();
    const paneel = await screen.findByRole('region', { name: 'Pressemitteilungen' });
    expect(
      await within(paneel).findByRole('heading', { level: 3, name: /Hochwasser Musterstadt/ }),
    ).toBeInTheDocument();
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
    expect(await screen.findByText('nur Einsatzleitung und Führungspersonal')).toBeInTheDocument();
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

/** LFH-692 (Spec `zeiteingabe`): Browser auf UTC, Einsatz auf Europe/Berlin. */
describe('PressePage — Eingang in der Anzeigezone (LFH-692)', () => {
  mitProzessZone('UTC');

  it('ein Eingang 13:00 Berliner Zeit geht als 11:00 UTC hinaus', async () => {
    renderMitProviders(
      <AnzeigeKonventionenProvider konventionen={{ zeitzone: 'Europe/Berlin' }}>
        <Routes>
          <Route path="/einsaetze/:id/stab/presse" element={<PressePage />} />
        </Routes>
      </AnzeigeKonventionenProvider>,
      { route: '/einsaetze/1/stab/presse' },
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Medienkontakt erfassen' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText('Medium'), 'dpa');
    await userEvent.type(within(dialog).getByLabelText('Thema'), 'Sperrung B 3');
    await userEvent.click(within(dialog).getByText('Ansprechperson und Uhrzeit'));
    const eingang = within(dialog).getByRole('textbox', { name: 'Eingang' });
    await userEvent.click(eingang);
    await userEvent.type(eingang, '30.09.2026 13:00');
    // Enter übernimmt die Zeit und sendet (Erfassungs-Norm).
    await userEvent.keyboard('{Enter}');
    await waitFor(() =>
      expect(legeMedienkontaktAn).toHaveBeenCalledWith(
        1,
        expect.objectContaining({ eingang_at: '2026-09-30 11:00:00' }),
      ),
    );
  });
});

describe('PressePage — Eingabegrenzen (LFH-937)', () => {
  it('Medienkontakt: Thema zählt ab 80 %, Überlänge sperrt, die Kurzfelder enden an der Grenze', async () => {
    setup();
    await userEvent.click(await screen.findByRole('button', { name: 'Medienkontakt erfassen' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByLabelText('Medium')).toHaveAttribute('maxlength', '200');
    const thema = within(dialog).getByLabelText('Thema');
    fireEvent.change(thema, { target: { value: 't'.repeat(399) } });
    expect(within(dialog).queryByText(/\/ 500/)).toBeNull();
    fireEvent.change(thema, { target: { value: 't'.repeat(400) } });
    expect(within(dialog).getByText('400 / 500')).toBeInTheDocument();
    await userEvent.type(within(dialog).getByLabelText('Medium'), 'dpa');
    fireEvent.change(thema, { target: { value: 't'.repeat(501) } });
    expect(thema).toHaveValue('t'.repeat(501));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Erfassen' }));
    expect(
      await within(dialog).findByText('Thema darf höchstens 500 Zeichen lang sein'),
    ).toBeInTheDocument();
    expect(legeMedienkontaktAn).not.toHaveBeenCalled();
    await userEvent.click(within(dialog).getByText('Ansprechperson und Uhrzeit'));
    expect(await within(dialog).findByLabelText('Ansprechperson')).toHaveAttribute(
      'maxlength',
      '200',
    );
    expect(within(dialog).getByLabelText('Erreichbarkeit')).toHaveAttribute('maxlength', '500');
  });

  it('Antwort: Zähler ab 6.400 von 8.000, Überlänge sperrt, die Freigabeangabe endet bei 200', async () => {
    setup();
    await userEvent.click(
      await screen.findByRole('button', { name: 'Anfrage von NDR 1 beantworten' }),
    );
    const dialog = await screen.findByRole('dialog', { name: /beantworten/ });
    expect(within(dialog).getByLabelText('Freigegeben durch')).toHaveAttribute('maxlength', '200');
    const antwort = within(dialog).getByLabelText('Gegebene Antwort');
    fireEvent.change(antwort, { target: { value: 'a'.repeat(6_400) } });
    expect(within(dialog).getByText('6.400 / 8.000')).toBeInTheDocument();
    fireEvent.change(antwort, { target: { value: 'a'.repeat(8_001) } });
    expect(antwort).toHaveValue('a'.repeat(8_001));
    await userEvent.click(
      within(dialog).getByRole('button', { name: 'Als beantwortet speichern' }),
    );
    expect(
      await within(dialog).findByText('Antwort darf höchstens 8.000 Zeichen lang sein'),
    ).toBeInTheDocument();
    expect(setzeMedienkontaktStatus).not.toHaveBeenCalled();
  });
});
