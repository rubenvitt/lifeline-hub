import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../api/client';
import type { OrtSucheAntwort } from '../api/karteOrtSuche';
import type {
  Verpflegungsstelle,
  VerpflegungsstelleEingabe,
  VerpflegungsstellePatch,
} from '../api/types';
import { waehle } from '../test/auswahlListe';
import { renderMitProviders } from '../test/utils';
import { FELDKUECHE, stelle } from '../test/verpflegungDaten';

/**
 * Maske der Verpflegungsstelle (LLH-1040, tasks.md 9.3, design.md D13 Punkt 3): drei sichtbare
 * Felder, Standort über das Ortsfeld, Abschnitt eingeklappt; Bearbeiten schickt nur Geändertes.
 */

const ort = vi.hoisted(() => ({
  suche: vi.fn<(einsatzId: number, begriff: string) => Promise<OrtSucheAntwort>>(),
}));
vi.mock('../api/ortSuche', () => ({ sucheOrtImEinsatz: ort.suche }));

const { StelleDialog, createStelleBody, stellePatch } = await import('./StelleDialog');

const TREFFER: OrtSucheAntwort = {
  zustand: 'ok',
  treffer: [
    {
      lat: 52.52,
      lon: 13.41,
      name: 'Sportplatz am Deich, Musterstadt, Deutschland',
      kurz: 'Sportplatz am Deich, Musterstadt',
    },
  ],
};

const ABSCHNITTE = [
  { value: 4, label: 'EA Nord' },
  { value: 5, label: 'EA Süd' },
];

beforeEach(() => {
  ort.suche.mockReset();
  ort.suche.mockResolvedValue(TREFFER);
});

function zeigeAnlegen({
  abschnitte = ABSCHNITTE as readonly { value: number; label: string }[] | null,
  fehler = null as unknown,
} = {}) {
  const onErfassen = vi
    .fn<(body: VerpflegungsstelleEingabe) => Promise<unknown>>()
    .mockResolvedValue(undefined);
  const onSchliessen = vi.fn();
  renderMitProviders(
    <StelleDialog
      modus={{ art: 'anlegen', onErfassen }}
      einsatzId={7}
      abschnitte={abschnitte}
      laeuft={false}
      fehler={fehler}
      onSchliessen={onSchliessen}
    />,
  );
  return {
    onErfassen,
    onSchliessen,
    dialog: screen.getByRole('dialog', { name: 'Stelle anlegen' }),
  };
}

function zeigeBearbeiten(vorher: Verpflegungsstelle) {
  const onErfassen = vi
    .fn<(patch: VerpflegungsstellePatch) => Promise<unknown>>()
    .mockResolvedValue(undefined);
  const onSchliessen = vi.fn();
  renderMitProviders(
    <StelleDialog
      modus={{ art: 'bearbeiten', stelle: vorher, onErfassen }}
      einsatzId={7}
      abschnitte={ABSCHNITTE}
      laeuft={false}
      fehler={null}
      onSchliessen={onSchliessen}
    />,
  );
  return {
    onErfassen,
    onSchliessen,
    dialog: screen.getByRole('dialog', { name: `Stelle bearbeiten: ${vorher.bezeichnung}` }),
  };
}

/** Zählt die bedienbaren Felder (wie `VerpflegungDialoge.test.tsx`). */
function sichtbareFelder(dialog: HTMLElement): number {
  const felder = new Set<Element>();
  for (const rolle of ['textbox', 'spinbutton', 'combobox'] as const) {
    for (const el of within(dialog).queryAllByRole(rolle)) {
      const item = el.closest('.ant-form-item');
      if (item) felder.add(item);
    }
  }
  return felder.size;
}

describe('createStelleBody / stellePatch (rein)', () => {
  it('schickt beim Anlegen nur Gesetztes, Koordinate nur mit Treffer', () => {
    expect(
      createStelleBody({
        bezeichnung: '  Feldküche  ',
        art: 'feldkueche',
        standort: { text: ' ', koordinate: null },
      }),
    ).toEqual({ bezeichnung: 'Feldküche', art: 'feldkueche' });
    expect(
      createStelleBody({
        bezeichnung: 'Feldküche',
        art: 'feldkueche',
        standort: { text: 'Sportplatz', koordinate: { lat: 52.5, lon: 13.4 } },
        abschnitt_id: 4,
      }),
    ).toEqual({
      bezeichnung: 'Feldküche',
      art: 'feldkueche',
      standort: 'Sportplatz',
      lat: 52.5,
      lon: 13.4,
      abschnitt_id: 4,
    });
  });

  it('PATCH: nur Geändertes; geänderter Text ohne Treffer leert die Koordinate', () => {
    const vorher = stelle({
      id: FELDKUECHE,
      bezeichnung: 'Feldküche',
      standort: 'Sportplatz',
      lat: 52.5,
      lon: 13.4,
      abschnitt_id: 4,
    });
    const gleich = {
      bezeichnung: 'Feldküche',
      art: vorher.art,
      standort: { text: 'Sportplatz', koordinate: { lat: 52.5, lon: 13.4 } },
      abschnitt_id: 4,
    };
    expect(stellePatch(vorher, gleich)).toEqual({});
    expect(
      stellePatch(vorher, { ...gleich, standort: { text: 'Sportplatz Ost', koordinate: null } }),
    ).toEqual({ standort: 'Sportplatz Ost', lat: null, lon: null });
    expect(stellePatch(vorher, { ...gleich, standort: { text: '', koordinate: null } })).toEqual({
      standort: null,
      lat: null,
      lon: null,
    });
    expect(stellePatch(vorher, { ...gleich, abschnitt_id: undefined })).toEqual({
      abschnitt_id: null,
    });
  });
});

describe('StelleDialog anlegen', () => {
  it('zeigt drei Felder, der Abschnitt liegt eingeklappt', async () => {
    const { dialog } = zeigeAnlegen();
    expect(sichtbareFelder(dialog)).toBe(3);
    expect(within(dialog).getByRole('textbox', { name: 'Bezeichnung' })).toBeInTheDocument();
    expect(within(dialog).getByRole('combobox', { name: 'Art' })).toBeInTheDocument();
    expect(within(dialog).getByRole('textbox', { name: 'Standort' })).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: /Weitere Angaben/ }));
    await waitFor(() => expect(sichtbareFelder(dialog)).toBe(4));
  });

  it('ohne Abschnitte im Einsatz gibt es keinen Klappteil', () => {
    const { dialog } = zeigeAnlegen({ abschnitte: [] });
    expect(within(dialog).queryByRole('button', { name: /Weitere Angaben/ })).toBeNull();
  });

  it('Body beim Anlegen: Treffer setzt Standort und Koordinate, Abschnitt aus dem Klappteil', async () => {
    const { onErfassen, onSchliessen, dialog } = zeigeAnlegen();
    await userEvent.type(
      within(dialog).getByRole('textbox', { name: 'Bezeichnung' }),
      'Feldküche BR Sportplatz',
    );
    await waehle('Art', 'Feldküche');
    await userEvent.type(
      within(dialog).getByRole('textbox', { name: 'Standort' }),
      'Sportplatz{Enter}',
    );
    expect(ort.suche).toHaveBeenCalledWith(7, 'Sportplatz');
    const liste = await within(dialog).findByRole('list', { name: 'Treffer' });
    await userEvent.click(within(liste).getAllByRole('button')[0]);
    expect(within(dialog).getByRole('textbox', { name: 'Standort' })).toHaveValue(
      'Sportplatz am Deich, Musterstadt',
    );
    await userEvent.click(within(dialog).getByRole('button', { name: /Weitere Angaben/ }));
    await waehle('Einsatzabschnitt', 'EA Nord');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Anlegen' }));
    await waitFor(() =>
      expect(onErfassen).toHaveBeenCalledWith({
        bezeichnung: 'Feldküche BR Sportplatz',
        art: 'feldkueche',
        standort: 'Sportplatz am Deich, Musterstadt',
        lat: 52.52,
        lon: 13.41,
        abschnitt_id: 4,
      }),
    );
    await waitFor(() => expect(onSchliessen).toHaveBeenCalled());
  });

  it('Freitext ohne Treffer geht ohne Koordinate hinaus', async () => {
    const { onErfassen, dialog } = zeigeAnlegen();
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'Bezeichnung' }), 'Zuführung');
    await waehle('Art', 'Zuführung');
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'Standort' }), 'Deich km 3');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Anlegen' }));
    await waitFor(() =>
      expect(onErfassen).toHaveBeenCalledWith({
        bezeichnung: 'Zuführung',
        art: 'zufuehrung',
        standort: 'Deich km 3',
      }),
    );
    expect(ort.suche).not.toHaveBeenCalled();
  });

  it('verlangt Bezeichnung und Art', async () => {
    const { onErfassen, dialog } = zeigeAnlegen();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Anlegen' }));
    expect(await within(dialog).findByText('Bitte eine Bezeichnung angeben')).toBeInTheDocument();
    expect(within(dialog).getByText('Bitte eine Art wählen')).toBeInTheDocument();
    expect(onErfassen).not.toHaveBeenCalled();
  });

  it('Grenze: 200 Zeichen gehen, 201 nicht; Standort über 500 ebenso', async () => {
    const { onErfassen, dialog } = zeigeAnlegen();
    const bez = within(dialog).getByRole('textbox', { name: 'Bezeichnung' });
    await userEvent.click(bez);
    await userEvent.paste('x'.repeat(201));
    await waehle('Art', 'Ausgabestelle');
    await userEvent.click(within(dialog).getByRole('textbox', { name: 'Standort' }));
    await userEvent.paste('s'.repeat(501));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Anlegen' }));
    expect(
      await within(dialog).findByText('Bezeichnung darf höchstens 200 Zeichen lang sein'),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText('Standort darf höchstens 500 Zeichen lang sein'),
    ).toBeInTheDocument();
    expect(onErfassen).not.toHaveBeenCalled();

    await userEvent.type(bez, '{Backspace}');
    const standort = within(dialog).getByRole('textbox', { name: 'Standort' });
    await userEvent.type(standort, '{Backspace}');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Anlegen' }));
    await waitFor(() => expect(onErfassen).toHaveBeenCalledTimes(1));
    expect(onErfassen.mock.calls[0][0].bezeichnung).toHaveLength(200);
    expect(onErfassen.mock.calls[0][0].standort).toHaveLength(500);
  });

  it('409 doppelte Bezeichnung steht im Dialog, der offen bleibt', async () => {
    let scheitere: (e: unknown) => void = () => {};
    const onSchliessen = vi.fn();
    function Aufrufer() {
      const [offen, setOffen] = useState(true);
      const mut = useMutation({
        mutationFn: (body: VerpflegungsstelleEingabe) =>
          new Promise((_, nein) => {
            void body;
            scheitere = nein;
          }),
      });
      return offen ? (
        <StelleDialog
          modus={{ art: 'anlegen', onErfassen: (b) => mut.mutateAsync(b) }}
          einsatzId={7}
          abschnitte={null}
          laeuft={mut.isPending}
          fehler={mut.error}
          onSchliessen={() => {
            onSchliessen();
            setOffen(false);
          }}
        />
      ) : null;
    }
    renderMitProviders(<Aufrufer />);
    const dialog = screen.getByRole('dialog', { name: 'Stelle anlegen' });
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'Bezeichnung' }), 'Feldküche');
    await waehle('Art', 'Feldküche');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Anlegen' }));
    await waitFor(() => expect(scheitere).not.toBe(undefined));
    scheitere(new ApiError(409, 'Bezeichnung „Feldküche“ ist im Einsatz schon vergeben'));
    expect(
      await within(dialog).findByText('Bezeichnung „Feldküche“ ist im Einsatz schon vergeben'),
    ).toBeInTheDocument();
    expect(onSchliessen).not.toHaveBeenCalled();
    expect(document.querySelector('.ant-message-notice')).toBeNull();
  });
});

describe('StelleDialog bearbeiten', () => {
  const vorher = stelle({
    id: FELDKUECHE,
    bezeichnung: 'Feldküche BR Sportplatz',
    art: 'feldkueche',
    standort: 'Sportplatz',
    lat: 52.5,
    lon: 13.4,
    abschnitt_id: 4,
  });

  it('belegt vor und schickt nur die geänderte Bezeichnung', async () => {
    const { onErfassen, dialog } = zeigeBearbeiten(vorher);
    const bez = within(dialog).getByRole('textbox', { name: 'Bezeichnung' });
    expect(bez).toHaveValue('Feldküche BR Sportplatz');
    expect(within(dialog).getByRole('textbox', { name: 'Standort' })).toHaveValue('Sportplatz');
    await userEvent.clear(bez);
    await userEvent.type(bez, 'Feldküche Sportplatz');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Speichern' }));
    await waitFor(() =>
      expect(onErfassen).toHaveBeenCalledWith({ bezeichnung: 'Feldküche Sportplatz' }),
    );
  });

  it('ein geleerter Standort leert auch die Koordinate', async () => {
    const { onErfassen, dialog } = zeigeBearbeiten(vorher);
    await userEvent.clear(within(dialog).getByRole('textbox', { name: 'Standort' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Speichern' }));
    await waitFor(() =>
      expect(onErfassen).toHaveBeenCalledWith({ standort: null, lat: null, lon: null }),
    );
  });

  it('ohne Änderung wird nichts gesendet und der Dialog schließt', async () => {
    const { onErfassen, onSchliessen, dialog } = zeigeBearbeiten(vorher);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Speichern' }));
    await waitFor(() => expect(onSchliessen).toHaveBeenCalled());
    expect(onErfassen).not.toHaveBeenCalled();
  });
});
