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
          schicht={{ id: 3, einheit_name: 'Florian 1' } as Abloesung}
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
    expect(
      within(dialog).getByRole('spinbutton', { name: 'Rhythmus (Stunden)' }),
    ).not.toBeRequired();
  });

  it('mit Einheit ohne Vorgabe: Rhythmus wird Pflicht, ohne Satz dazu (LFH-1078)', async () => {
    oeffne(new Map());
    const dialog = await screen.findByRole('dialog');
    await waehleFlorian(dialog);
    const feld = within(dialog).getByRole('spinbutton', { name: 'Rhythmus (Stunden)' });
    await waitFor(() => expect(feld).toBeRequired());
    expect(feld).not.toHaveAttribute('placeholder');
    expect(within(dialog).queryByText(/Vorgabe/)).not.toBeInTheDocument();
  });

  it('mit Einheit mit Vorgabe: der wirksame Wert steht als Platzhalter (LFH-1078)', async () => {
    oeffne(new Map([[5, 360]]));
    const dialog = await screen.findByRole('dialog');
    await waehleFlorian(dialog);
    const feld = within(dialog).getByRole('spinbutton', { name: 'Rhythmus (Stunden)' });
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
        schicht={{ id: 3, einheit_name: 'Florian 1' } as Abloesung}
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
        schicht={{ id: 3, einheit_name: 'Florian 1' } as Abloesung}
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
    const feld = within(dialog).getByRole('spinbutton', { name: 'Rhythmus (Stunden)' });
    expect(feld).toHaveAttribute('placeholder', 'keine Vorgabe');
    expect(feld).not.toBeRequired();
  });
});
