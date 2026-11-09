import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App as AntApp } from 'antd';
import { einsatzKeys } from '../../api/queryKeys';
import type {
  SchichtplanImportErgebnis,
  SchichtplanImportVorschau,
  SchichtplanImportZaehlung,
} from '../../api/types';
import { waehle } from '../../test/auswahlListe';
import SchichtplanEinlesen, { zaehlungMarken } from './SchichtplanEinlesen';

const vorschauApi = vi.fn();
const einlesenApi = vi.fn();
vi.mock('../../api/schichtplan', () => ({
  schichtplanEinlesenVorschau: (...a: unknown[]) => vorschauApi(...a),
  schichtplanEinlesen: (...a: unknown[]) => einlesenApi(...a),
}));

const NULL: SchichtplanImportZaehlung = {
  einheiten_neu: 0,
  uhs_neu: 0,
  bloecke_neu: 0,
  bloecke_ergaenzt: 0,
  bloecke_unveraendert: 0,
  helfer_neu: 0,
  einteilungen_neu: 0,
  grenzwerte_neu: 0,
  aenderungen: 0,
};

function vorschau(teil: Partial<SchichtplanImportVorschau> = {}): SchichtplanImportVorschau {
  return {
    posten: [
      {
        schluessel: 'p1',
        art: 'einheit',
        name: 'Streife 3',
        abschnitt: 'Eingang',
        abschnitt_id: 2,
        ziel: { art: 'neu' },
        treffer: 'neu',
        kandidaten: [],
        zeilen: [2],
        bloecke: 1,
      },
    ],
    personen: [
      {
        schluessel: 'm1',
        name: 'Jonas Fiktiv',
        kennung: '10231',
        herkunft: 'Helferplanung',
        ziel: { art: 'neu' },
        treffer: 'neu',
        kandidaten: [],
        zeilen: [2],
        bloecke: 1,
      },
    ],
    bloecke: [],
    meldungen: [],
    zaehlung: {
      ...NULL,
      bloecke_neu: 1,
      einheiten_neu: 1,
      helfer_neu: 1,
      einteilungen_neu: 1,
      aenderungen: 4,
    },
    auswahl: {
      einheiten: [{ id: 30, bezeichnung: 'Streife 1', abschnitt_id: 3 }],
      uhs: [],
      vorlagen: [{ id: 5, bezeichnung: 'Fußstreife' }],
      abschnitte: [],
    },
    uebernehmbar: true,
    ...teil,
  };
}

function zeichne() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const utils = render(
    <QueryClientProvider client={qc}>
      <AntApp>
        <SchichtplanEinlesen einsatzId={7} />
      </AntApp>
    </QueryClientProvider>,
  );
  return { qc, ...utils };
}

async function oeffneUndWaehle(name = 'plan.csv') {
  await userEvent.click(screen.getByRole('button', { name: /Schichtplan einlesen/ }));
  const dialog = await screen.findByRole('dialog');
  const eingabe = dialog.querySelector<HTMLInputElement>('input[type="file"]')!;
  const datei = new File(['Posten;Beginn;Ende\n'], name, { type: 'text/csv' });
  await userEvent.upload(eingabe, datei);
  return { dialog, datei };
}

describe('SchichtplanEinlesen', () => {
  beforeEach(() => {
    vorschauApi.mockReset();
    einlesenApi.mockReset();
  });

  it('zeigt die Vorschau, fragt sie mit der Wahl neu ab und übernimmt', async () => {
    vorschauApi.mockResolvedValue(vorschau());
    const plan = { grenzwerte: {}, bloecke: [], helfer: [] };
    const ergebnis: SchichtplanImportErgebnis = {
      zaehlung: vorschau().zaehlung,
      plan: plan as unknown as SchichtplanImportErgebnis['plan'],
    };
    einlesenApi.mockResolvedValue(ergebnis);
    const { qc } = zeichne();
    const { dialog, datei } = await oeffneUndWaehle();

    await within(dialog).findByText('1 Schicht neu');
    expect(vorschauApi).toHaveBeenCalledWith(7, datei, { posten: {}, personen: {} });
    expect(within(dialog).getByText('Streife 3')).toBeInTheDocument();
    expect(within(dialog).getByText('Jonas Fiktiv')).toBeInTheDocument();
    expect(within(dialog).getByText(/Helferplanung 10231/)).toBeInTheDocument();
    expect(within(dialog).getByText('plan.csv')).toBeInTheDocument();

    await waehle('Ziel für Streife 3', 'Streife 1');
    await waitFor(() =>
      expect(vorschauApi).toHaveBeenLastCalledWith(7, datei, {
        posten: { p1: { art: 'einheit', einheit_id: 30 } },
        personen: {},
      }),
    );

    await userEvent.click(within(dialog).getByRole('button', { name: 'Übernehmen' }));
    await within(dialog).findByText('Übernommen');
    expect(einlesenApi).toHaveBeenCalledWith(7, datei, {
      posten: { p1: { art: 'einheit', einheit_id: 30 } },
      personen: {},
    });
    expect(qc.getQueryData(einsatzKeys.schichtplan(7))).toBe(plan);
  });

  it('nennt eine Einsatzkraft als Ziel und schickt ihre Wahl zurück', async () => {
    const person = vorschau().personen[0];
    vorschauApi.mockResolvedValue(
      vorschau({
        personen: [
          {
            ...person,
            herkunft: 'Lifeline Hub',
            kennung: 'einsatzkraft-12',
            ziel: { art: 'neu' },
            treffer: 'unsicher',
            kandidaten: [{ art: 'einsatz', einsatz_personal_id: 12, name: 'Jonas Fiktiv' }],
          },
        ],
      }),
    );
    zeichne();
    const { dialog, datei } = await oeffneUndWaehle();
    await within(dialog).findByText('Jonas Fiktiv');
    await waehle('Person für Jonas Fiktiv', 'Jonas Fiktiv (Einsatzkraft)');
    await waitFor(() =>
      expect(vorschauApi).toHaveBeenLastCalledWith(7, datei, {
        posten: {},
        personen: { m1: { art: 'einsatz', einsatz_personal_id: 12 } },
      }),
    );
  });

  it('sperrt Übernehmen bei Fehlern und ohne Änderung, mit Grund', async () => {
    vorschauApi.mockResolvedValueOnce(
      vorschau({
        uebernehmbar: false,
        meldungen: [{ stufe: 'fehler', zeile: 3, text: 'Überschneidet sich mit Zeile 2' }],
      }),
    );
    zeichne();
    const { dialog } = await oeffneUndWaehle();
    await within(dialog).findByText('Zeile 3: Überschneidet sich mit Zeile 2');
    const knopf = within(dialog).getByRole('button', { name: 'Übernehmen' });
    expect(knopf).toBeDisabled();
    expect(knopf).toHaveAccessibleDescription('Fehler in der Datei');

    vorschauApi.mockResolvedValueOnce(vorschau({ zaehlung: NULL }));
    const eingabe = dialog.querySelector<HTMLInputElement>('input[type="file"]')!;
    await userEvent.upload(eingabe, new File(['x'], 'zwei.csv', { type: 'text/csv' }));
    await within(dialog).findByText('Keine Änderungen', { selector: '.ant-tag' });
    expect(within(dialog).getByRole('button', { name: 'Übernehmen' })).toHaveAccessibleDescription(
      'Keine Änderungen',
    );
  });

  it('prüft die Größe vorab und schickt dann nichts', async () => {
    zeichne();
    await userEvent.click(screen.getByRole('button', { name: /Schichtplan einlesen/ }));
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

  it('bietet die Beispieldatei als CSV und Excel an', async () => {
    zeichne();
    await userEvent.click(screen.getByRole('button', { name: /Schichtplan einlesen/ }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('link', { name: 'CSV' })).toHaveAttribute(
      'href',
      '/beispiele/schichtplan-stadtfest.csv',
    );
    expect(within(dialog).getByRole('link', { name: 'Excel' })).toHaveAttribute(
      'href',
      '/beispiele/schichtplan-stadtfest.xlsx',
    );
  });

  it('fasst die Zählung in kurze Marken', () => {
    expect(zaehlungMarken(NULL)).toEqual(['Keine Änderungen']);
    expect(
      zaehlungMarken({
        ...NULL,
        bloecke_neu: 10,
        bloecke_ergaenzt: 1,
        helfer_neu: 7,
        einheiten_neu: 1,
        einteilungen_neu: 20,
        aenderungen: 39,
      }),
    ).toEqual([
      '10 Schichten neu',
      '1 Schicht ergänzt',
      '20 Einteilungen',
      '7 Helfer neu',
      '1 Einheit neu',
    ]);
  });
});
