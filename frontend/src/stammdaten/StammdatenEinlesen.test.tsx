import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App as AntApp } from 'antd';
import { ApiError } from '../api/client';
import { globalKeys } from '../api/queryKeys';
import type {
  Qualifikation,
  StammdatenArtZaehlung,
  StammdatenErgebnis,
  StammdatenQualiZeile,
  StammdatenVorschau,
  StammdatenZeile,
} from '../api/types';
import { oeffne, optionenVon, waehle } from '../test/auswahlListe';
import StammdatenEinlesen from './StammdatenEinlesen';

const vorschauApi = vi.fn();
const einlesenApi = vi.fn();
vi.mock('../api/stammdatenEingang', async (orig) => ({
  ...(await orig<typeof import('../api/stammdatenEingang')>()),
  stammdatenEinlesenVorschau: (...a: unknown[]) => vorschauApi(...a),
  stammdatenEinlesen: (...a: unknown[]) => einlesenApi(...a),
}));
const katalogApi = vi.fn();
vi.mock('../api/qualifikationen', async (orig) => ({
  ...(await orig<typeof import('../api/qualifikationen')>()),
  listeQualifikationen: (...a: unknown[]) => katalogApi(...a),
}));

const KATALOG: Qualifikation[] = [
  { id: 5, label: 'Sanitäter', sortier: 10 },
  { id: 6, label: 'Fahrer', sortier: 20 },
];

function quali(teil: Partial<StammdatenQualiZeile> = {}): StammdatenQualiZeile {
  return {
    herkunft: 'mv',
    text: 'Atemschutz',
    zeilen: [],
    ergebnis: 'neu',
    kandidaten: [],
    hinweise: [],
    wahl: { art: 'neu' },
    ...teil,
  };
}

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
    katalogApi.mockReset();
    katalogApi.mockResolvedValue(KATALOG);
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
  it('bietet für eine unbekannte Qualifikation den ganzen Katalog zum Zuordnen an', async () => {
    vorschauApi.mockResolvedValue(vorschau({ qualifikationen: [quali()] }));
    zeichne();
    const { datei } = await oeffneUndWaehle();
    const feld = 'Wahl für Qualifikation Atemschutz';
    await oeffne(feld);
    await waitFor(() =>
      expect(optionenVon(feld)).toEqual([
        'Neu anlegen',
        'Zuordnen zu Sanitäter',
        'Zuordnen zu Fahrer',
        'Auslassen',
      ]),
    );
    await waehle(feld, 'Zuordnen zu Fahrer');
    await waitFor(() =>
      expect(vorschauApi).toHaveBeenLastCalledWith(datei, undefined, {
        zeilen: [],
        qualifikationen: [{ text: 'Atemschutz', wahl: { art: 'zuordnen', qualifikation_id: 6 } }],
      }),
    );
  });

  it('nennt Kandidaten zuerst und bietet bei einer mehrdeutigen kein Neu anlegen', async () => {
    vorschauApi.mockResolvedValue(
      vorschau({
        qualifikationen: [
          quali({
            text: 'Taucher',
            ergebnis: 'mehrdeutig',
            wahl: null,
            kandidaten: [
              { id: 7, anzeige: 'Taucher' },
              { id: 5, anzeige: 'Sanitäter' },
            ],
          }),
        ],
      }),
    );
    zeichne();
    await oeffneUndWaehle();
    const feld = 'Wahl für Qualifikation Taucher';
    await oeffne(feld);
    await waitFor(() =>
      expect(optionenVon(feld)).toEqual([
        'Zuordnen zu Taucher',
        'Zuordnen zu Sanitäter',
        'Zuordnen zu Fahrer',
        'Auslassen',
      ]),
    );
  });

  it('zeigt die Vorgabe neu als „Neu anlegen“, nicht als Rohwert', async () => {
    vorschauApi.mockResolvedValue(
      vorschau({
        zeilen: [
          {
            ...ZEILE,
            ergebnis: 'neu',
            grund: null,
            kandidaten: [],
            aenderungen: [],
            wahl: { art: 'neu' },
          },
        ],
        qualifikationen: [quali()],
      }),
    );
    zeichne();
    const { dialog } = await oeffneUndWaehle();
    await within(dialog).findByText('Florian 1/10');
    for (const feld of ['Wahl für Florian 1/10', 'Wahl für Qualifikation Atemschutz']) {
      const auswahl = screen
        .getByRole('combobox', { name: feld })
        .closest<HTMLElement>('.ant-select')!;
      expect(auswahl).toHaveTextContent('Neu anlegen');
      expect(auswahl).not.toHaveTextContent(/^neu$/);
    }
  });

  it('zeigt dieselbe Qualifikation unter zwei Herkünften zweimal, ohne doppelten Schlüssel', async () => {
    const fehler = vi.spyOn(console, 'error').mockImplementation(() => {});
    vorschauApi.mockResolvedValue(
      vorschau({ qualifikationen: [quali({ herkunft: 'mv' }), quali({ herkunft: 'fv' })] }),
    );
    zeichne();
    const { dialog } = await oeffneUndWaehle();
    await waitFor(() =>
      expect(
        within(dialog).getAllByRole('combobox', { name: 'Wahl für Qualifikation Atemschutz' }),
      ).toHaveLength(2),
    );
    expect(within(dialog).getByText(/Herkunft mv/)).toBeInTheDocument();
    expect(within(dialog).getByText(/Herkunft fv/)).toBeInTheDocument();
    const schluessel = fehler.mock.calls.filter((c) => String(c[0]).includes('same key'));
    fehler.mockRestore();
    expect(schluessel).toEqual([]);
  });

  it('behält die Vorschau bei einem Fehler und nimmt die letzte Wahl zurück', async () => {
    vorschauApi.mockResolvedValueOnce(vorschau());
    vorschauApi.mockRejectedValueOnce(
      new ApiError(400, 'Fahrzeug Zeile 2: Die Wahl passt nicht zu dieser Zeile', {
        vomAnwendungsserver: true,
      }),
    );
    zeichne();
    const { dialog, datei } = await oeffneUndWaehle();
    await within(dialog).findByText('Florian 1/10');
    await waehle('Wahl für Florian 1/10', 'Datei übernehmen');
    expect(
      await within(dialog).findByText('Fahrzeug Zeile 2: Die Wahl passt nicht zu dieser Zeile'),
    ).toBeInTheDocument();
    // Die Vorschau steht noch, die Wahl ist wieder der Vorschlag.
    expect(within(dialog).getByText('Florian 1/10')).toBeInTheDocument();
    const auswahl = screen
      .getByRole('combobox', { name: 'Wahl für Florian 1/10' })
      .closest<HTMLElement>('.ant-select')!;
    expect(auswahl).toHaveTextContent('Lücken füllen, Bestand behalten');
    // Übernehmen schickt die zuletzt gültigen Entscheidungen.
    einlesenApi.mockResolvedValue({ zaehlung: vorschau().zaehlung });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Übernehmen' }));
    await waitFor(() =>
      expect(einlesenApi).toHaveBeenCalledWith(datei, undefined, {
        zeilen: [],
        qualifikationen: [],
      }),
    );
  });

  it('nennt bei einem 422 die Zeilen und fragt die Vorschau neu', async () => {
    vorschauApi.mockResolvedValue(vorschau());
    einlesenApi.mockRejectedValue(
      new ApiError(
        422,
        'Die Stammdaten haben Fehler oder offene Entscheidungen; nichts übernommen',
        {
          vomAnwendungsserver: true,
          zeilen: [
            {
              art: 'dateizeile',
              id: 2,
              grund: 'Fahrzeug: Der Funkrufname „Florian 1/10“ ist schon vergeben',
            },
          ],
        },
      ),
    );
    zeichne();
    const { dialog } = await oeffneUndWaehle();
    await within(dialog).findByText('Florian 1/10');
    expect(vorschauApi).toHaveBeenCalledTimes(1);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Übernehmen' }));
    expect(
      await within(dialog).findByText(
        'Zeile 2: Fahrzeug: Der Funkrufname „Florian 1/10“ ist schon vergeben',
      ),
    ).toBeInTheDocument();
    await waitFor(() => expect(vorschauApi).toHaveBeenCalledTimes(2));
  });
});
