import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App as AntApp } from 'antd';
import { globalKeys } from '../api/queryKeys';
import type {
  StammdatenArtZaehlung,
  StammdatenErgebnis,
  StammdatenVorschau,
  StammdatenZeile,
} from '../api/types';
import { waehle } from '../test/auswahlListe';
import StammdatenEinlesen from './StammdatenEinlesen';

const vorschauApi = vi.fn();
const einlesenApi = vi.fn();
vi.mock('../api/stammdatenEingang', async (orig) => ({
  ...(await orig<typeof import('../api/stammdatenEingang')>()),
  stammdatenEinlesenVorschau: (...a: unknown[]) => vorschauApi(...a),
  stammdatenEinlesen: (...a: unknown[]) => einlesenApi(...a),
}));

const NULL: StammdatenArtZaehlung = {
  neu: 0,
  ergaenzt: 0,
  geaendert: 0,
  unveraendert: 0,
  ausgelassen: 0,
  offen: 0,
  fehler: 0,
};

const ZEILE: StammdatenZeile = {
  art: 'fahrzeug',
  zeile: 2,
  anzeige: 'Florian 1/10',
  ergebnis: 'gefunden',
  grund: 'funkrufname',
  hinweise: [],
  kandidaten: [{ id: 9, anzeige: 'Florian 1/10' }],
  aenderungen: [
    {
      feld: 'typ',
      art: 'weicht_ab',
      alt: 'LF 10',
      neu: 'HLF 20',
      erkennungsfeld: false,
      uebernommen: false,
    },
  ],
  wahl: null,
};

function vorschau(teil: Partial<StammdatenVorschau> = {}): StammdatenVorschau {
  return {
    herkunft_noetig: false,
    herkunft_vorschlag: null,
    meldungen: [],
    nicht_uebernommen: [],
    qualifikationen: [],
    uebernehmbar: true,
    zaehlung: {
      fahrzeuge: { ...NULL, geaendert: 1 },
      personal: NULL,
      qualifikationen: NULL,
    },
    zeilen: [ZEILE],
    ...teil,
  };
}

function zeichne() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const utils = render(
    <QueryClientProvider client={qc}>
      <AntApp>
        <StammdatenEinlesen />
      </AntApp>
    </QueryClientProvider>,
  );
  return { qc, ...utils };
}

async function oeffneUndWaehle(name = 'stamm.csv') {
  await userEvent.click(screen.getByRole('button', { name: /Stammdaten einlesen/ }));
  const dialog = await screen.findByRole('dialog');
  const eingabe = dialog.querySelector<HTMLInputElement>('input[type="file"]')!;
  const datei = new File(['funkrufname\n'], name, { type: 'text/csv' });
  await userEvent.upload(eingabe, datei);
  return { dialog, datei };
}

describe('StammdatenEinlesen', () => {
  beforeEach(() => {
    vorschauApi.mockReset();
    einlesenApi.mockReset();
  });

  it('bietet die Beispieldatei als CSV und Excel an', async () => {
    zeichne();
    await userEvent.click(screen.getByRole('button', { name: /Stammdaten einlesen/ }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('link', { name: 'CSV' })).toHaveAttribute(
      'href',
      '/beispiele/stammdaten-beispiel.csv',
    );
    expect(within(dialog).getByRole('link', { name: 'Excel' })).toHaveAttribute(
      'href',
      '/beispiele/stammdaten-beispiel.xlsx',
    );
  });

  it('zeigt_herkunft_feld_wenn_noetig', async () => {
    vorschauApi.mockResolvedValue(
      vorschau({ herkunft_noetig: true, herkunft_vorschlag: 'Leitstelle', uebernehmbar: false }),
    );
    zeichne();
    const { dialog, datei } = await oeffneUndWaehle();
    const feld = await within(dialog).findByRole('textbox', { name: 'Herkunft' });
    expect(feld).toHaveValue('Leitstelle');
    // Der Vorschlag wird gleich mit abgefragt, damit die Vorschau ihn kennt.
    await waitFor(() =>
      expect(vorschauApi).toHaveBeenLastCalledWith(datei, 'Leitstelle', {
        zeilen: [],
        qualifikationen: [],
      }),
    );
    expect(vorschauApi.mock.calls[0][1]).toBeUndefined();
  });

  it('wahl_schickt_entscheidungen_neu', async () => {
    vorschauApi.mockResolvedValue(vorschau());
    zeichne();
    const { dialog, datei } = await oeffneUndWaehle();
    await within(dialog).findByText('Florian 1/10');
    expect(vorschauApi).toHaveBeenCalledWith(datei, undefined, { zeilen: [], qualifikationen: [] });

    await waehle('Wahl für Florian 1/10', 'Datei übernehmen');
    await waitFor(() =>
      expect(vorschauApi).toHaveBeenLastCalledWith(datei, undefined, {
        zeilen: [{ art: 'fahrzeug', zeile: 2, wahl: { art: 'datei_uebernehmen' } }],
        qualifikationen: [],
      }),
    );
  });

  it('uebernehmen_gesperrt_bei_fehlern', async () => {
    vorschauApi.mockResolvedValue(
      vorschau({
        uebernehmbar: false,
        zaehlung: {
          fahrzeuge: { ...NULL, fehler: 1 },
          personal: NULL,
          qualifikationen: NULL,
        },
        meldungen: [{ stufe: 'fehler', zeile: 3, text: 'Funkrufname doppelt', art: 'fahrzeug' }],
      }),
    );
    zeichne();
    const { dialog } = await oeffneUndWaehle();
    await within(dialog).findByText('Zeile 3: Funkrufname doppelt');
    const knopf = within(dialog).getByRole('button', { name: 'Übernehmen' });
    expect(knopf).toBeDisabled();
    expect(knopf).toHaveAccessibleDescription('Fehler in der Datei');
  });

  it('ergebnis_zeigt_zaehlung', async () => {
    vorschauApi.mockResolvedValue(vorschau());
    const ergebnis: StammdatenErgebnis = {
      zaehlung: {
        fahrzeuge: { ...NULL, neu: 2, geaendert: 1 },
        personal: { ...NULL, ergaenzt: 3 },
        qualifikationen: NULL,
      },
    };
    einlesenApi.mockResolvedValue(ergebnis);
    const { qc } = zeichne();
    const invalidiere = vi.spyOn(qc, 'invalidateQueries');
    const { dialog, datei } = await oeffneUndWaehle();
    await within(dialog).findByText('Florian 1/10');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Übernehmen' }));
    await within(dialog).findByText('Übernommen');
    expect(einlesenApi).toHaveBeenCalledWith(datei, undefined, { zeilen: [], qualifikationen: [] });
    expect(within(dialog).getByText('2 Fahrzeuge neu')).toBeInTheDocument();
    expect(within(dialog).getByText('1 Fahrzeug geändert')).toBeInTheDocument();
    expect(within(dialog).getByText('3 Personen ergänzt')).toBeInTheDocument();
    const schluessel = invalidiere.mock.calls.map((c) => c[0]?.queryKey);
    expect(schluessel).toContainEqual(globalKeys.fahrzeuge());
    expect(schluessel).toContainEqual(globalKeys.personal());
    expect(schluessel).toContainEqual(globalKeys.qualifikationen());
  });

  it('nicht_uebernommen_wird_genannt', async () => {
    vorschauApi.mockResolvedValue(vorschau({ nicht_uebernommen: ['farbe', 'baujahr'] }));
    zeichne();
    const { dialog } = await oeffneUndWaehle();
    expect(await within(dialog).findByText(/Nicht übernommene Spalten/)).toHaveTextContent(
      'farbe, baujahr',
    );
  });

  it('prüft die Größe vorab und schickt dann nichts', async () => {
    zeichne();
    await userEvent.click(screen.getByRole('button', { name: /Stammdaten einlesen/ }));
    const dialog = await screen.findByRole('dialog');
    const eingabe = dialog.querySelector<HTMLInputElement>('input[type="file"]')!;
    const gross = new File(['x'], 'gross.csv', { type: 'text/csv' });
    Object.defineProperty(gross, 'size', { value: 2 * 1024 * 1024 + 1 });
    await userEvent.upload(eingabe, gross);
    expect(
      await within(dialog).findByText('Datei ist zu groß (2 MiB erlaubt)'),
    ).toBeInTheDocument();
    expect(vorschauApi).not.toHaveBeenCalled();
  });
});
