import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useEffect } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../api/client';
import * as anlagenApi from '../api/dokumentAnlagen';
import type { DokumentAnlage } from '../api/types';
import type { StabFreigabe } from '../stab/useStabFreigabe';
import { renderMitProviders } from '../test/utils';
import DokumentAnlagen, { MAX_ANLAGEN } from './DokumentAnlagen';

vi.mock('../api/dokumentAnlagen', async (original) => ({
  ...(await original<typeof import('../api/dokumentAnlagen')>()),
  listeDokumentAnlagen: vi.fn(),
  legeDokumentAnlageAb: vi.fn(),
  entferneDokumentAnlage: vi.fn(),
}));

let stab: StabFreigabe = { zustand: 'frei', freigaben: {} as never };
vi.mock('../stab/useStabFreigabe', () => ({ useStabFreigabe: () => stab }));
let ohneNetz = false;
vi.mock('../offline/verbindung', async (original) => ({
  ...(await original<typeof import('../offline/verbindung')>()),
  useOhneVerbindung: () => ohneNetz,
}));

/** Was die Aufnahme meldet; die echte zeichnet im Browser (e2e). */
let aufnahme: { art: 'bild' } | { art: 'fehler'; fehler: unknown } = { art: 'bild' };
const BILD = new Blob(['png'], { type: 'image/png' });
vi.mock('../stab/SkizzenAufnahme', () => ({
  default: function Attrappe({
    onBild,
    onFehler,
  }: {
    onBild: (b: { datei: Blob; standAt: string }) => void;
    onFehler: (e: unknown) => void;
  }) {
    useEffect(() => {
      if (aufnahme.art === 'bild') onBild({ datei: BILD, standAt: '2026-10-08T12:15:00.000Z' });
      else onFehler(aufnahme.fehler);
      // Einmal je Einhängen, wie die echte Aufnahme.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    return null;
  },
}));

const anlage = (nummer: number): DokumentAnlage => ({
  id: 40 + nummer,
  dokument_id: 7,
  nummer,
  art: 'fernmeldeskizze',
  titel: 'Fernmeldeskizze',
  stand_at: '2026-10-08 12:15:00',
  dateiname: 'fernmeldeskizze.png',
  mime: 'image/png',
  groesse: 2048,
  abgelegt_von_id: 1,
  abgelegt_von_name: 'Admin',
  abgelegt_at: '2026-10-08 12:15:01',
});

function zeige(schreibt: boolean) {
  return renderMitProviders(
    <DokumentAnlagen
      dokument="befehle"
      einsatzId={3}
      dokumentId={7}
      einsatzbezeichnung="Hochwasser"
      schreibt={schreibt}
      ohneDruckKlasse="befehl-no-print"
    />,
  );
}

beforeEach(() => {
  stab = { zustand: 'frei', freigaben: {} as never };
  ohneNetz = false;
  aufnahme = { art: 'bild' };
});
afterEach(() => vi.clearAllMocks());

describe('DokumentAnlagen (LFH-1028)', () => {
  it('fügt die Fernmeldeskizze als PNG mit dem Stand der Aufnahme an', async () => {
    vi.mocked(anlagenApi.listeDokumentAnlagen).mockResolvedValue([]);
    vi.mocked(anlagenApi.legeDokumentAnlageAb).mockResolvedValue(anlage(1));
    zeige(true);
    await userEvent.click(await screen.findByRole('button', { name: 'Fernmeldeskizze anfügen' }));
    await waitFor(() => expect(anlagenApi.legeDokumentAnlageAb).toHaveBeenCalledTimes(1));
    expect(anlagenApi.legeDokumentAnlageAb).toHaveBeenCalledWith('befehle', 3, 7, {
      art: 'fernmeldeskizze',
      titel: 'Fernmeldeskizze',
      standAt: '2026-10-08T12:15:00.000Z',
      datei: BILD,
      dateiname: 'fernmeldeskizze.png',
    });
    // Danach holt die Liste neu.
    await waitFor(() => expect(anlagenApi.listeDokumentAnlagen).toHaveBeenCalledTimes(2));
  });

  it('nennt den Grund, wenn die Skizze sich nicht zeichnen lässt, und legt nichts ab', async () => {
    vi.mocked(anlagenApi.listeDokumentAnlagen).mockResolvedValue([]);
    aufnahme = { art: 'fehler', fehler: 'Abschnitte nicht geladen' };
    zeige(true);
    await userEvent.click(await screen.findByRole('button', { name: 'Fernmeldeskizze anfügen' }));
    const alarm = (await screen.findByText('Abschnitte nicht geladen')).closest('[role="alert"]');
    expect(alarm).toHaveTextContent('Fernmeldeskizze nicht angefügt');
    expect(anlagenApi.legeDokumentAnlageAb).not.toHaveBeenCalled();
  });

  it.each([
    ['ohne Schreibrecht oder nach der Freigabe', () => {}, false],
    ['ohne Stab', () => (stab = { zustand: 'gesperrt', freigaben: {} as never }), true],
    ['ohne Verbindung', () => (ohneNetz = true), true],
  ])('ohne Anlage steht %s nichts', async (_, vorher, schreibt) => {
    vorher();
    vi.mocked(anlagenApi.listeDokumentAnlagen).mockResolvedValue([]);
    zeige(schreibt);
    await waitFor(() => expect(anlagenApi.listeDokumentAnlagen).toHaveBeenCalled());
    expect(screen.queryByRole('button', { name: 'Fernmeldeskizze anfügen' })).toBeNull();
    expect(screen.queryByText('Anlagen')).toBeNull();
  });

  it('zeigt eine eingefrorene Anlage nur lesbar und druckt sie auf eigenem Blatt', async () => {
    vi.mocked(anlagenApi.listeDokumentAnlagen).mockResolvedValue([anlage(1)]);
    const { container } = zeige(false);
    expect(
      await screen.findByRole('link', { name: 'Anlage 1: Fernmeldeskizze herunterladen' }),
    ).toHaveAttribute('href', '/api/einsaetze/3/befehle/7/anlagen/41/datei');
    expect(screen.queryByRole('button', { name: /entfernen/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Fernmeldeskizze anfügen' })).toBeNull();

    const blatt = container.querySelector('.dokument-anlagen-druck [data-lfh="druck-anlage"]');
    expect(blatt).not.toBeNull();
    expect(within(blatt as HTMLElement).getByRole('heading', { level: 2 })).toHaveTextContent(
      /^Anlage 1: Fernmeldeskizze, Stand /,
    );
    expect(blatt!.querySelector('img')).toHaveAttribute(
      'src',
      '/api/einsaetze/3/befehle/7/anlagen/41/datei',
    );
    // Das Paneel ist Bedienung, nicht Papier.
    expect(
      container.querySelector('.befehl-no-print [data-lfh="dokument-anlage-zeile"]'),
    ).not.toBeNull();
  });

  it('entfernt im Entwurf erst nach der Rückfrage', async () => {
    vi.mocked(anlagenApi.listeDokumentAnlagen).mockResolvedValue([anlage(1)]);
    vi.mocked(anlagenApi.entferneDokumentAnlage).mockResolvedValue(undefined);
    zeige(true);
    await userEvent.click(
      await screen.findByRole('button', { name: 'Anlage 1: Fernmeldeskizze entfernen' }),
    );
    expect(anlagenApi.entferneDokumentAnlage).not.toHaveBeenCalled();
    await userEvent.click(await screen.findByRole('button', { name: 'Entfernen' }));
    await waitFor(() =>
      expect(anlagenApi.entferneDokumentAnlage).toHaveBeenCalledWith('befehle', 3, 7, 41),
    );
  });

  it('sperrt das Anfügen bei der Höchstzahl', async () => {
    vi.mocked(anlagenApi.listeDokumentAnlagen).mockResolvedValue(
      Array.from({ length: MAX_ANLAGEN }, (_, i) => anlage(i + 1)),
    );
    zeige(true);
    await screen.findByRole('link', { name: 'Anlage 10: Fernmeldeskizze herunterladen' });
    expect(screen.getByRole('button', { name: 'Fernmeldeskizze anfügen' })).toBeDisabled();
  });
});

/**
 * Speicherfehler an den Ort (LFH-1077, `frontend/AGENTS.md`, „Rückwege und Fehler“): der Grund
 * eines gescheiterten Anfügens steht beim Knopf — im Paneel „Anlagen“ oder, ohne Anlage, in der
 * Zeile mit dem Knopf —, nicht im Toast, und geht mit dem nächsten Anfügen. Ein Anfügen, ein Alert,
 * gleich ob die Skizze sich nicht zeichnen ließ oder der Server ablehnte.
 */
describe('DokumentAnlagen — gescheitertes Anfügen (LFH-1077)', () => {
  /** Erst die geladene Liste: vorher stünde der Knopf in der Zeile ohne Anlage. */
  async function geladen(mitAnlage: boolean) {
    if (mitAnlage) await screen.findByRole('region', { name: 'Anlagen' });
    else await waitFor(() => expect(anlagenApi.listeDokumentAnlagen).toHaveBeenCalled());
    await screen.findByRole('button', { name: 'Fernmeldeskizze anfügen' });
  }

  /** Der Block, in dem der Grund stehen muss: das Paneel oder die Zeile mit dem Knopf. */
  function ort(mitAnlage: boolean): HTMLElement {
    // Per Kennung: antd hängt beim Ausblenden der Ladeanzeige noch „loading“ in den Namen.
    const knopf = document.querySelector('[data-lfh="anlage-skizze-anfuegen"]') as HTMLElement;
    if (mitAnlage) return screen.getByRole('region', { name: 'Anlagen' });
    expect(screen.queryByRole('region', { name: 'Anlagen' })).toBeNull();
    return knopf.closest('.befehl-no-print') as HTMLElement;
  }

  it.each([
    ['ohne Anlage', false],
    ['mit Anlage', true],
  ])('%s: der Server lehnt ab — der Grund steht beim Knopf, ohne Toast', async (_, mitAnlage) => {
    vi.mocked(anlagenApi.listeDokumentAnlagen).mockResolvedValue(mitAnlage ? [anlage(1)] : []);
    // Die Suite fährt ohne `mockReset`: offene Einmal-Antworten eines roten Tests wanderten weiter.
    vi.mocked(anlagenApi.legeDokumentAnlageAb)
      .mockReset()
      .mockRejectedValueOnce(new ApiError(409, 'Dokument ist freigegeben'))
      .mockImplementationOnce(() => new Promise(() => {}));
    zeige(true);
    await geladen(mitAnlage);
    await userEvent.click(screen.getByRole('button', { name: 'Fernmeldeskizze anfügen' }));

    const treffer = await screen.findByText('Dokument ist freigegeben');
    expect(treffer.closest('.ant-message')).toBeNull();
    const alarm = treffer.closest('[role="alert"]') as HTMLElement;
    expect(alarm).toHaveTextContent('Fernmeldeskizze nicht angefügt');
    expect(ort(mitAnlage)).toContainElement(alarm);
    // Eine Handlung, ein Alert.
    expect(screen.getAllByRole('alert')).toHaveLength(1);
    expect(document.querySelectorAll('.ant-message-notice')).toHaveLength(0);

    await userEvent.click(screen.getByRole('button', { name: /Fernmeldeskizze anfügen/ }));
    await waitFor(() => expect(screen.queryByText('Dokument ist freigegeben')).toBeNull());
    expect(anlagenApi.legeDokumentAnlageAb).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['ohne Anlage', false],
    ['mit Anlage', true],
  ])(
    '%s: die Skizze zeichnet nicht — der Grund steht beim Knopf, ohne Toast',
    async (_, mitAnlage) => {
      vi.mocked(anlagenApi.listeDokumentAnlagen).mockResolvedValue(mitAnlage ? [anlage(1)] : []);
      vi.mocked(anlagenApi.legeDokumentAnlageAb)
        .mockReset()
        .mockImplementation(() => new Promise(() => {}));
      // Ein Programmfehler beim Zeichnen nennt keinen Wortlaut für Menschen.
      aufnahme = { art: 'fehler', fehler: new Error('canvas tainted') };
      zeige(true);
      await geladen(mitAnlage);
      await userEvent.click(screen.getByRole('button', { name: 'Fernmeldeskizze anfügen' }));

      const alarm = (await screen.findByText('Fernmeldeskizze nicht angefügt')).closest(
        '[role="alert"]',
      ) as HTMLElement;
      expect(alarm.closest('.ant-message')).toBeNull();
      expect(alarm).toHaveTextContent('Skizze nicht gezeichnet');
      expect(ort(mitAnlage)).toContainElement(alarm);
      expect(screen.getAllByRole('alert')).toHaveLength(1);
      expect(document.querySelectorAll('.ant-message-notice')).toHaveLength(0);

      // Der nächste Versuch zeichnet und sendet: der alte Grund ist weg.
      aufnahme = { art: 'bild' };
      await userEvent.click(screen.getByRole('button', { name: /Fernmeldeskizze anfügen/ }));
      await waitFor(() => expect(anlagenApi.legeDokumentAnlageAb).toHaveBeenCalledTimes(1));
      expect(screen.queryByText('Fernmeldeskizze nicht angefügt')).toBeNull();
    },
  );

  /**
   * Ohne Anlage und ohne Knopf (offline, Freigabe weg) stünde sonst nichts mehr da: der Grund
   * „nicht abgeschickt“ verschwände mit dem Knopf.
   */
  it('ohne Anlage: fällt danach das Netz weg, bleibt der Grund stehen', async () => {
    vi.mocked(anlagenApi.listeDokumentAnlagen).mockResolvedValue([]);
    vi.mocked(anlagenApi.legeDokumentAnlageAb)
      .mockReset()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'));
    const { rerender } = zeige(true);
    await geladen(false);
    await userEvent.click(screen.getByRole('button', { name: 'Fernmeldeskizze anfügen' }));
    const alarm = (await screen.findByText('Fernmeldeskizze nicht angefügt')).closest(
      '[role="alert"]',
    ) as HTMLElement;
    const text = alarm.textContent;

    ohneNetz = true;
    rerender(
      <DokumentAnlagen
        dokument="befehle"
        einsatzId={3}
        dokumentId={7}
        einsatzbezeichnung="Hochwasser"
        schreibt
        ohneDruckKlasse="befehl-no-print"
      />,
    );
    expect(screen.queryByRole('button', { name: /Fernmeldeskizze anfügen/ })).toBeNull();
    expect(screen.getByRole('alert')).toHaveTextContent(text ?? '');
  });
});
