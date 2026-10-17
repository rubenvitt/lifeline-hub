import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { AnzeigeKonventionenProvider } from '../anzeige/AnzeigeKonventionenContext';
import type { Abloesung } from '../api/types';
import { mitProzessZone } from '../test/prozessZone';
import { renderMitProviders } from '../test/utils';
import {
  AbloeserDialog,
  RhythmusDialog,
  SchichtBeginnenDialog,
  VollzugDialog,
} from './AbloesungDialoge';

/**
 * LFH-692 (Spec `zeiteingabe`): Browser auf UTC, Organisation auf Europe/Berlin. Beide Zeitfelder
 * der Ablösung lesen die eingegebene Uhrzeit in der Anzeigezone.
 */
describe('Ablösung — Zeiten in der Anzeigezone (LFH-692)', () => {
  mitProzessZone('UTC');
  const BERLIN = { zeitzone: 'Europe/Berlin' };

  async function tippeZeit(feld: HTMLElement, text: string) {
    await userEvent.click(feld);
    await userEvent.type(feld, text);
    await userEvent.keyboard('{Enter}');
  }

  it('Vollzug: 13:00 Berliner Zeit geht als 11:00 UTC hinaus', async () => {
    const onErfassen = vi.fn().mockResolvedValue(undefined);
    renderMitProviders(
      <AnzeigeKonventionenProvider konventionen={BERLIN}>
        <VollzugDialog
          schicht={{ id: 3, einheit_name: 'Florian 1', abloeser: [] } as unknown as Abloesung}
          einheiten={[]}
          laeuft={false}
          fehler={null}
          onErfassen={onErfassen}
          onSchliessen={vi.fn()}
        />
      </AnzeigeKonventionenProvider>,
    );
    const dialog = await screen.findByRole('dialog');
    await tippeZeit(within(dialog).getByRole('textbox', { name: 'Zeitpunkt' }), '2026-09-24 13:00');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Vollziehen' }));
    await waitFor(() =>
      expect(onErfassen).toHaveBeenCalledWith(
        expect.objectContaining({ vollzogen_at: '2026-09-24 11:00:00' }),
      ),
    );
  });

  it('Schicht beginnen: „im Einsatz seit“ 06:30 Berliner Zeit geht als 04:30 UTC hinaus', async () => {
    const onErfassen = vi.fn().mockResolvedValue(undefined);
    renderMitProviders(
      <AnzeigeKonventionenProvider konventionen={BERLIN}>
        <SchichtBeginnenDialog
          offen
          einheiten={[{ value: 5, label: 'Florian 1' }]}
          vorgabeJeEinheit={new Map([[5, 360]])}
          laeuft={false}
          fehler={null}
          onErfassen={onErfassen}
          onSchliessen={vi.fn()}
        />
      </AnzeigeKonventionenProvider>,
    );
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('combobox', { name: 'Einheit' }));
    const option = await waitFor(() => {
      const k = document.querySelector<HTMLElement>(
        '.ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option[title="Florian 1"]',
      );
      expect(k).not.toBeNull();
      return k!;
    });
    await userEvent.click(option);
    await tippeZeit(
      within(dialog).getByRole('textbox', { name: 'Im Einsatz seit' }),
      '2026-09-24 06:30',
    );
    await userEvent.click(within(dialog).getByRole('button', { name: 'Schicht beginnen' }));
    await waitFor(() =>
      expect(onErfassen).toHaveBeenCalledWith(
        expect.objectContaining({ einheit_id: 5, beginn_at: '2026-09-24 04:30:00' }),
      ),
    );
  });
});

/**
 * LFH-948: vor der Wahl der Einheit sagt der Dialog nichts über die Vorgabe eines Abschnitts,
 * und der Rhythmus ist noch kein Pflichtfeld.
 */
describe('Schicht beginnen — Rhythmus-Vorgabe erst nach der Einheitenwahl (LFH-948)', () => {
  function oeffne(vorgabeJeEinheit: Map<number, number>) {
    renderMitProviders(
      <SchichtBeginnenDialog
        offen
        einheiten={[{ value: 5, label: 'Florian 1' }]}
        vorgabeJeEinheit={vorgabeJeEinheit}
        laeuft={false}
        fehler={null}
        onErfassen={vi.fn().mockResolvedValue(undefined)}
        onSchliessen={vi.fn()}
      />,
    );
  }

  async function waehleFlorian(dialog: HTMLElement) {
    await userEvent.click(within(dialog).getByRole('combobox', { name: 'Einheit' }));
    const option = await waitFor(() => {
      const k = document.querySelector<HTMLElement>(
        '.ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option[title="Florian 1"]',
      );
      expect(k).not.toBeNull();
      return k!;
    });
    await userEvent.click(option);
  }

  it('ohne Einheit kein Satz über die Vorgabe und kein Pflichtfeld', async () => {
    oeffne(new Map());
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).queryByText(/Vorgabe/)).not.toBeInTheDocument();
    expect(within(dialog).getByRole('textbox', { name: 'Rhythmus' })).not.toBeRequired();
  });

  it('mit Einheit ohne Vorgabe: Rhythmus wird Pflicht, ohne Satz dazu (LFH-1078)', async () => {
    oeffne(new Map());
    const dialog = await screen.findByRole('dialog');
    await waehleFlorian(dialog);
    const feld = within(dialog).getByRole('textbox', { name: 'Rhythmus' });
    await waitFor(() => expect(feld).toBeRequired());
    expect(feld).not.toHaveAttribute('placeholder');
    expect(within(dialog).queryByText(/Vorgabe/)).not.toBeInTheDocument();
  });

  it('mit Einheit mit Vorgabe: der wirksame Wert steht als Platzhalter (LFH-1078)', async () => {
    oeffne(new Map([[5, 360]]));
    const dialog = await screen.findByRole('dialog');
    await waehleFlorian(dialog);
    const feld = within(dialog).getByRole('textbox', { name: 'Rhythmus' });
    await waitFor(() => expect(feld).toHaveAttribute('placeholder', '6 h (Vorgabe Abschnitt)'));
    expect(feld).not.toBeRequired();
    expect(within(dialog).queryByText(/Leer/)).not.toBeInTheDocument();
  });
});

/** LFH-1078: „Im Einsatz seit“ zeigt, was der Server ohne Eingabe nimmt. */
describe('Schicht beginnen — Beginn als Platzhalter (LFH-1078)', () => {
  mitProzessZone('UTC');

  function oeffne(eintreffenJeEinheit: Map<number, string> | null) {
    renderMitProviders(
      <AnzeigeKonventionenProvider konventionen={{ zeitzone: 'Europe/Berlin' }}>
        <SchichtBeginnenDialog
          offen
          einheiten={[{ value: 5, label: 'Florian 1' }]}
          vorgabeJeEinheit={new Map()}
          eintreffenJeEinheit={eintreffenJeEinheit}
          laeuft={false}
          fehler={null}
          onErfassen={vi.fn()}
          onSchliessen={vi.fn()}
        />
      </AnzeigeKonventionenProvider>,
    );
  }
  async function waehleFlorian(dialog: HTMLElement) {
    await userEvent.click(within(dialog).getByRole('combobox', { name: 'Einheit' }));
    const option = await waitFor(() => {
      const k = document.querySelector<HTMLElement>(
        '.ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option[title="Florian 1"]',
      );
      expect(k).not.toBeNull();
      return k!;
    });
    await userEvent.click(option);
  }
  const beginn = (dialog: HTMLElement) =>
    within(dialog).getByRole('textbox', { name: 'Im Einsatz seit' });

  it('mit Eintreffen: dessen Uhrzeit in der Anzeigezone', async () => {
    oeffne(new Map([[5, '2026-09-24 04:30:00']]));
    const dialog = await screen.findByRole('dialog');
    // Vor der Wahl der Einheit gibt es keinen wirksamen Wert, also keinen.
    expect(beginn(dialog).getAttribute('placeholder') ?? '').not.toMatch(/Eintreffen|jetzt/);
    await waehleFlorian(dialog);
    await waitFor(() =>
      expect(beginn(dialog).getAttribute('placeholder')).toMatch(/^Eintreffen (\d{2}\. )?06:30$/),
    );
  });

  it('ohne Eintreffen: „jetzt“', async () => {
    oeffne(new Map());
    const dialog = await screen.findByRole('dialog');
    await waehleFlorian(dialog);
    await waitFor(() => expect(beginn(dialog)).toHaveAttribute('placeholder', 'jetzt'));
  });

  it('Perioden unbekannt: kein Platzhalter, der etwas Falsches verspräche', async () => {
    oeffne(null);
    const dialog = await screen.findByRole('dialog');
    await waehleFlorian(dialog);
    expect(beginn(dialog).getAttribute('placeholder') ?? '').not.toMatch(/Eintreffen|jetzt/);
    expect(within(dialog).queryByText(/Leer/)).not.toBeInTheDocument();
  });
});

/** LFH-1078: der wirksame Wert steht im Feld, kein „Leer: …“-Satz darunter. */
describe('Ablösung — Platzhalter statt Feldhilfe (LFH-1078)', () => {
  it('Vollzug: Zeitpunkt zeigt „jetzt“, kein Erklärsatz', async () => {
    renderMitProviders(
      <VollzugDialog
        schicht={{ id: 3, einheit_name: 'Florian 1', abloeser: [] } as unknown as Abloesung}
        einheiten={[]}
        laeuft={false}
        fehler={null}
        onErfassen={vi.fn()}
        onSchliessen={vi.fn()}
      />,
    );
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('textbox', { name: 'Zeitpunkt' })).toHaveAttribute(
      'placeholder',
      'jetzt',
    );
    expect(within(dialog).queryByText(/Leer|Folgeschicht/)).not.toBeInTheDocument();
  });

  it('Ablöser planen: kein Erklärsatz, der Platzhalter sagt „keine geplant“', async () => {
    renderMitProviders(
      <AbloeserDialog
        schicht={{ id: 3, einheit_name: 'Florian 1', abloeser: [] } as unknown as Abloesung}
        einheiten={[]}
        laeuft={false}
        fehler={null}
        onErfassen={vi.fn()}
        onSchliessen={vi.fn()}
      />,
    );
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('keine geplant')).toBeInTheDocument();
    expect(within(dialog).queryByText(/Leer/)).not.toBeInTheDocument();
  });

  it('Rhythmus: Platzhalter aus dem Aufrufer, ohne Pflicht wenn erlaubt', async () => {
    renderMitProviders(
      <RhythmusDialog
        offen
        titel="Rhythmus-Vorgabe Nord"
        minuten={null}
        platzhalter="keine Vorgabe"
        leerErlaubt
        laeuft={false}
        fehler={null}
        onErfassen={vi.fn()}
        onSchliessen={vi.fn()}
      />,
    );
    const dialog = await screen.findByRole('dialog');
    const feld = within(dialog).getByRole('textbox', { name: 'Rhythmus' });
    expect(feld).toHaveAttribute('placeholder', 'keine Vorgabe');
    expect(feld).not.toBeRequired();
  });
});

/** LLH-1122: Rhythmus als Dauer „8 h“ / „7:30 h“, nie „8.0“; die Einsatzvorgabe als Platzhalter. */
describe('Ablösung — Rhythmus als Dauer (LLH-1122)', () => {
  function rhythmus(props: Partial<Parameters<typeof RhythmusDialog>[0]> = {}) {
    const onErfassen = vi.fn().mockResolvedValue(undefined);
    renderMitProviders(
      <RhythmusDialog
        offen
        titel="Rhythmus Florian 1"
        minuten={480}
        leerErlaubt={false}
        laeuft={false}
        fehler={null}
        onErfassen={onErfassen}
        onSchliessen={vi.fn()}
        {...props}
      />,
    );
    return onErfassen;
  }

  it('belegt mit „8 h“ vor, nicht mit „8.0“', async () => {
    rhythmus();
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('textbox', { name: 'Rhythmus' })).toHaveValue('8 h');
  });

  it('liest „7:30“ als 450 Minuten', async () => {
    const onErfassen = rhythmus({ minuten: null });
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'Rhythmus' }), '7:30');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Speichern' }));
    await waitFor(() => expect(onErfassen).toHaveBeenCalledWith(450));
  });

  it('lehnt Unlesbares am Feld ab und sendet nicht', async () => {
    const onErfassen = rhythmus({ minuten: null });
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'Rhythmus' }), 'acht');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Speichern' }));
    expect(await within(dialog).findByText(/Dauer wie „8 h“/)).toBeInTheDocument();
    expect(onErfassen).not.toHaveBeenCalled();
  });

  it('Schicht beginnen: die Einsatzvorgabe steht als Platzhalter, wenn der Abschnitt keine hat', async () => {
    renderMitProviders(
      <SchichtBeginnenDialog
        offen
        einheiten={[{ value: 5, label: 'Florian 1' }]}
        vorgabeJeEinheit={new Map()}
        einsatzVorgabe="12 h"
        laeuft={false}
        fehler={null}
        onErfassen={vi.fn()}
        onSchliessen={vi.fn()}
      />,
    );
    const dialog = await screen.findByRole('dialog');
    const feld = within(dialog).getByRole('textbox', { name: 'Rhythmus' });
    // Vor der Wahl der Einheit nichts (LFH-948).
    expect(feld).not.toHaveAttribute('placeholder');
    await userEvent.click(within(dialog).getByRole('combobox', { name: 'Einheit' }));
    const option = await waitFor(() => {
      const k = document.querySelector<HTMLElement>(
        '.ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option[title="Florian 1"]',
      );
      expect(k).not.toBeNull();
      return k!;
    });
    await userEvent.click(option);
    await waitFor(() => expect(feld).toHaveAttribute('placeholder', '12 h (Vorgabe Einsatz)'));
    expect(feld).not.toBeRequired();
  });

  it('Schicht beginnen: vorbelegte Einheit (LLH-1128) — Vorgabe greift, Absenden ohne Wahl', async () => {
    const onErfassen = vi.fn().mockResolvedValue(undefined);
    renderMitProviders(
      <SchichtBeginnenDialog
        offen
        einheiten={[
          { value: 5, label: 'Florian 1' },
          { value: 6, label: 'Florian 2' },
        ]}
        vorbelegt={6}
        vorgabeJeEinheit={new Map([[6, 360]])}
        laeuft={false}
        fehler={null}
        onErfassen={onErfassen}
        onSchliessen={vi.fn()}
      />,
    );
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByTitle('Florian 2')).toBeInTheDocument();
    await waitFor(() =>
      expect(within(dialog).getByRole('textbox', { name: 'Rhythmus' })).toHaveAttribute(
        'placeholder',
        '6 h (Vorgabe Abschnitt)',
      ),
    );
    await userEvent.click(within(dialog).getByRole('button', { name: 'Schicht beginnen' }));
    await waitFor(() =>
      expect(onErfassen).toHaveBeenCalledWith(expect.objectContaining({ einheit_id: 6 })),
    );
  });
});
