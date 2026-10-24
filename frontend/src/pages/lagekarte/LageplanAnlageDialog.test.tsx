import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AnzeigeKonventionenProvider } from '../../anzeige/AnzeigeKonventionenContext';
import type { AnzeigeKonventionen } from '../../anzeige/format';
import { ApiError } from '../../api/client';
import * as anlagenApi from '../../api/dokumentAnlagen';
import * as befehleApi from '../../api/befehle';
import * as berichteApi from '../../api/lageberichte';
import type { BefehlKopf, LageberichtKopf } from '../../api/types';
import { renderMitProviders } from '../../test/utils';
import LageplanAnlageDialog, { anlageSperrGrund } from './LageplanAnlageDialog';
import { KARTE_NICHT_DARSTELLBAR } from './kartenGrafik';
import { KARTENBILD_FEHLT, KeinKartenbild, type LageplanAnlage } from './useLageplan';

vi.mock('../../api/dokumentAnlagen', async (original) => ({
  ...(await original<typeof import('../../api/dokumentAnlagen')>()),
  legeDokumentAnlageAb: vi.fn(),
}));
vi.mock('../../api/lageberichte', async (original) => ({
  ...(await original<typeof import('../../api/lageberichte')>()),
  listeLageberichte: vi.fn(),
  legeLageberichtAn: vi.fn(),
}));
vi.mock('../../api/befehle', async (original) => ({
  ...(await original<typeof import('../../api/befehle')>()),
  listeBefehle: vi.fn(),
}));

const BILD = new Blob(['png'], { type: 'image/png' });
const STAND = '2026-10-20T12:15:00.000Z';

const bericht = (id: number, titel: string, status: 'entwurf' | 'freigegeben') =>
  ({ id, titel, status }) as LageberichtKopf;
const befehl = (id: number, titel: string, status: 'entwurf' | 'freigegeben') =>
  ({ id, titel, status }) as BefehlKopf;

function Ort() {
  return <div data-testid="ort">{useLocation().pathname}</div>;
}

function zeige({
  lageberichteFrei = true,
  befehleFrei = true,
  erstelleAnlage = vi.fn((): Promise<LageplanAnlage> =>
    Promise.resolve({ datei: BILD, standAt: STAND }),
  ),
  onSchliessen = vi.fn(),
  konventionen = {} as AnzeigeKonventionen,
} = {}) {
  renderMitProviders(
    <AnzeigeKonventionenProvider konventionen={konventionen}>
      <LageplanAnlageDialog
        offen
        einsatzId={3}
        lageberichteFrei={lageberichteFrei}
        befehleFrei={befehleFrei}
        erstelleAnlage={erstelleAnlage}
        onSchliessen={onSchliessen}
      />
      <Ort />
    </AnzeigeKonventionenProvider>,
    { route: '/einsaetze/3/lagekarte' },
  );
  return { erstelleAnlage, onSchliessen };
}

beforeEach(() => {
  vi.mocked(berichteApi.listeLageberichte).mockResolvedValue([
    bericht(5, 'Lageüberblick 1100', 'entwurf'),
    bericht(6, 'Lageüberblick 0900', 'freigegeben'),
  ]);
  vi.mocked(befehleApi.listeBefehle).mockResolvedValue([
    befehl(8, 'Befehl Abschnitt Nord', 'entwurf'),
    befehl(9, 'Alter Befehl', 'freigegeben'),
  ]);
  vi.mocked(berichteApi.legeLageberichtAn).mockReset();
  vi.mocked(anlagenApi.legeDokumentAnlageAb).mockReset();
  vi.mocked(anlagenApi.legeDokumentAnlageAb).mockResolvedValue({} as never);
});

describe('LageplanAnlageDialog', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('der Titel des neuen Lagevortrags folgt der Darstellung „Datum und Uhrzeit“ (LLH-1437)', async () => {
    vi.useFakeTimers({ toFake: ['Date'], shouldAdvanceTime: true });
    // 12:30 UTC = 14:30 Sommerzeit in Berlin.
    vi.setSystemTime(new Date('2026-10-10T12:30:00Z'));
    vi.mocked(berichteApi.legeLageberichtAn).mockResolvedValue({
      id: 12,
      titel: 'Lageüberblick 14:30',
    } as never);
    zeige({ konventionen: { zeitzone: 'Europe/Berlin', zeitdarstellung: 'datum_uhrzeit' } });
    await userEvent.click(await screen.findByRole('radio', { name: 'Neuer Lagevortrag' }));
    await userEvent.click(screen.getByRole('button', { name: 'Anfügen' }));
    await waitFor(() => expect(berichteApi.legeLageberichtAn).toHaveBeenCalled());
    expect(berichteApi.legeLageberichtAn).toHaveBeenCalledWith(3, {
      vorlage: 'lagebericht',
      titel: 'Lageüberblick 14:30',
    });
  });

  it('bietet offene Entwürfe beider Dokumente und einen neuen Lagevortrag, nie Freigegebenes', async () => {
    zeige();
    expect(
      await screen.findByRole('radio', { name: 'Lagebericht · Lageüberblick 1100' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('radio', { name: 'Befehl · Befehl Abschnitt Nord' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Neuer Lagevortrag' })).toBeInTheDocument();
    expect(screen.queryByRole('radio', { name: /0900|Alter Befehl/ })).toBeNull();
    // Ohne Wahl kein Anfügen.
    expect(screen.getByRole('button', { name: 'Anfügen' })).toBeDisabled();
  });

  it('ohne Freigabe der Aufträge keine Befehle, ohne Lageberichte kein neuer Lagevortrag', async () => {
    zeige({ befehleFrei: false });
    await screen.findByRole('radio', { name: 'Neuer Lagevortrag' });
    expect(screen.queryByRole('radio', { name: /^Befehl/ })).toBeNull();
    expect(befehleApi.listeBefehle).not.toHaveBeenCalled();
  });

  it('nur Befehle frei: ohne Lagevortrag, der einzige Entwurf ist gewählt', async () => {
    zeige({ lageberichteFrei: false });
    const radio = await screen.findByRole('radio', { name: 'Befehl · Befehl Abschnitt Nord' });
    expect(radio).toBeChecked();
    expect(screen.queryByRole('radio', { name: 'Neuer Lagevortrag' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Anfügen' })).toBeEnabled();
  });

  it('legt an einen bestehenden Entwurf ab, schließt und bleibt auf der Karte', async () => {
    const { erstelleAnlage, onSchliessen } = zeige();
    await userEvent.click(
      await screen.findByRole('radio', { name: 'Befehl · Befehl Abschnitt Nord' }),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Anfügen' }));
    await waitFor(() => expect(onSchliessen).toHaveBeenCalled());
    expect(erstelleAnlage).toHaveBeenCalledTimes(1);
    expect(anlagenApi.legeDokumentAnlageAb).toHaveBeenCalledWith('befehle', 3, 8, {
      art: 'lageplan',
      titel: 'Lageplan',
      standAt: STAND,
      datei: BILD,
      dateiname: 'lageplan.png',
    });
    expect(
      await screen.findByText('Lageplan an „Befehl · Befehl Abschnitt Nord“ angefügt'),
    ).toBeInTheDocument();
    expect(screen.getByTestId('ort')).toHaveTextContent('/einsaetze/3/lagekarte');
  });

  it('legt einen neuen Lagevortrag an, hängt den Lageplan an und öffnet ihn', async () => {
    vi.mocked(berichteApi.legeLageberichtAn).mockResolvedValue({
      id: 12,
      titel: 'Lageüberblick 1415',
    } as never);
    zeige();
    await userEvent.click(await screen.findByRole('radio', { name: 'Neuer Lagevortrag' }));
    await userEvent.click(screen.getByRole('button', { name: 'Anfügen' }));
    await waitFor(() =>
      expect(screen.getByTestId('ort')).toHaveTextContent('/einsaetze/3/lageberichte/12'),
    );
    expect(berichteApi.legeLageberichtAn).toHaveBeenCalledWith(3, {
      vorlage: 'lagebericht',
      titel: expect.stringMatching(/^Lageüberblick \d{4}$/),
    });
    expect(anlagenApi.legeDokumentAnlageAb).toHaveBeenCalledWith(
      'lageberichte',
      3,
      12,
      expect.objectContaining({ art: 'lageplan' }),
    );
  });

  it('nennt die Ablehnung im Dialog, der offen bleibt', async () => {
    vi.mocked(anlagenApi.legeDokumentAnlageAb).mockRejectedValue(
      new ApiError(409, 'Höchstens 10 Anlagen je Dokument'),
    );
    const { onSchliessen } = zeige();
    await userEvent.click(
      await screen.findByRole('radio', { name: 'Lagebericht · Lageüberblick 1100' }),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Anfügen' }));
    expect(await screen.findByText('Lageplan nicht angefügt')).toBeInTheDocument();
    expect(screen.getByText('Höchstens 10 Anlagen je Dokument')).toBeInTheDocument();
    expect(onSchliessen).not.toHaveBeenCalled();
  });

  it.each([KARTENBILD_FEHLT, KARTE_NICHT_DARSTELLBAR])(
    'ohne Kartenbild: Grund „%s“ im Dialog, nichts abgelegt',
    async (grund) => {
      zeige({ erstelleAnlage: vi.fn(() => Promise.reject(new KeinKartenbild(grund))) });
      await userEvent.click(
        await screen.findByRole('radio', { name: 'Lagebericht · Lageüberblick 1100' }),
      );
      await userEvent.click(screen.getByRole('button', { name: 'Anfügen' }));
      expect(await screen.findByText('Lageplan nicht angefügt')).toBeInTheDocument();
      expect(screen.getByText(grund)).toBeInTheDocument();
      expect(anlagenApi.legeDokumentAnlageAb).not.toHaveBeenCalled();
    },
  );

  it('sperrt Abbrechen, solange abgelegt wird', async () => {
    let fertig: () => void = () => {};
    vi.mocked(anlagenApi.legeDokumentAnlageAb).mockReturnValue(
      new Promise((r) => {
        fertig = () => r({} as never);
      }),
    );
    zeige();
    await userEvent.click(
      await screen.findByRole('radio', { name: 'Lagebericht · Lageüberblick 1100' }),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Anfügen' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Abbrechen' })).toBeDisabled());
    fertig();
  });
});

describe('anlageSperrGrund', () => {
  const aktiv = { status: 'aktiv' as const };
  const basis = {
    einsatz: aktiv,
    darfSchreiben: true,
    ohneVerbindung: false,
    lageberichte: 'frei' as const,
    befehle: 'frei' as const,
  };

  it('nennt den ersten fehlenden Grund', () => {
    expect(anlageSperrGrund(basis)).toBeNull();
    expect(anlageSperrGrund({ ...basis, darfSchreiben: false })).toBe(
      'nur Einsatzleitung und Führungspersonal',
    );
    expect(
      anlageSperrGrund({ ...basis, darfSchreiben: false, einsatz: { status: 'abgeschlossen' } }),
    ).toBe('Einsatz abgeschlossen');
    expect(anlageSperrGrund({ ...basis, ohneVerbindung: true })).toBe('ohne Verbindung');
    expect(anlageSperrGrund({ ...basis, lageberichte: 'gesperrt' })).toBeNull();
    expect(anlageSperrGrund({ ...basis, lageberichte: 'gesperrt', befehle: 'gesperrt' })).toBe(
      'Lageberichte und Befehle gesperrt',
    );
    expect(anlageSperrGrund({ ...basis, lageberichte: 'offen', befehle: 'gesperrt' })).toBe(
      'Freigaben nicht geladen',
    );
  });
});
