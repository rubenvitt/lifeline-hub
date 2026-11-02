import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AnzeigeKonventionenProvider } from '../anzeige/AnzeigeKonventionenContext';
import type { Abloesung } from '../api/types';
import { mitProzessZone } from '../test/prozessZone';
import { renderMitProviders } from '../test/utils';
import { optionenVon, oeffne as oeffneListe, waehle } from '../test/auswahlListe';
import { tippeZeit } from '../test/zeitEingabe';
import {
  AbloeserDialog,
  RhythmusDialog,
  SchichtBeginnenDialog,
  VollzugDialog,
} from './AbloesungDialoge';

/**
 * LFH-692 (Spec `zeiteingabe`): Browser auf UTC, Organisation auf Europe/Berlin. Beide Zeitfelder
 * der Ablösung lesen die eingegebene Uhrzeit in der Anzeigezone. Getippt wird taktisch und mit
 * Enter übernommen (LLH-1077); es ist 14:00 Berliner Zeit.
 */
describe('Ablösung — Zeiten in der Anzeigezone (LFH-692)', () => {
  mitProzessZone('UTC');
  const BERLIN = { zeitzone: 'Europe/Berlin' };
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'], shouldAdvanceTime: true });
    vi.setSystemTime(new Date('2026-09-24T12:00:00Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('Vollzug: „1300“ + Enter (Berliner Zeit) geht als 11:00 UTC hinaus', async () => {
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
    await tippeZeit(
      userEvent.setup(),
      within(dialog).getByRole('textbox', { name: 'Zeitpunkt' }),
      '1300',
    );
    await userEvent.click(within(dialog).getByRole('button', { name: 'Vollziehen' }));
    await waitFor(() =>
      expect(onErfassen).toHaveBeenCalledWith(
        expect.objectContaining({ vollzogen_at: '2026-09-24 11:00:00' }),
      ),
    );
  });

  it('Schicht beginnen: „0630“ + Enter in „im Einsatz seit“ geht als 04:30 UTC hinaus', async () => {
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
      userEvent.setup(),
      within(dialog).getByRole('textbox', { name: 'Im Einsatz seit' }),
      '0630',
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
      expect(beginn(dialog).getAttribute('placeholder')).toMatch(/^Eintreffen (\d{2})?0630$/),
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

/** LLH-1132: Ablöser als Liste, „Abschnitt übergeben“ vorbelegt bzw. gesperrt mit Grund. */
describe('Ablösung — Vollzug mit Liste und Abschnittsübergabe (LLH-1132)', () => {
  const schicht = {
    id: 3,
    einheit_name: 'Florian 1',
    abloeser: [
      { einheit_id: 13, einheit_name: 'Florian 3' },
      { einheit_id: 12, einheit_name: 'Florian 2' },
    ],
  } as unknown as Abloesung;
  const einheiten = [
    { value: 12, label: 'Florian 2' },
    { value: 13, label: 'Florian 3' },
  ];

  it('vorbelegt mit der Planung und „Abschnitt übergeben“; beides geht hinaus', async () => {
    const onErfassen = vi.fn().mockResolvedValue(undefined);
    renderMitProviders(
      <VollzugDialog
        schicht={schicht}
        einheiten={einheiten}
        abschnittName="Deichwache Nord"
        laeuft={false}
        fehler={null}
        onErfassen={onErfassen}
        onSchliessen={vi.fn()}
      />,
    );
    const dialog = await screen.findByRole('dialog');
    const option = within(dialog).getByRole('checkbox', {
      name: 'Abschnitt übergeben (Deichwache Nord)',
    });
    expect(option).toBeChecked();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Vollziehen' }));
    await waitFor(() =>
      expect(onErfassen).toHaveBeenCalledWith({
        vollzogen_at: undefined,
        abloeser_ids: [13, 12],
        abschnitt_uebergeben: true,
      }),
    );
  });

  it('ohne Freigabe des Moduls Einheiten gesperrt mit Grund, und nichts wird übergeben', async () => {
    const onErfassen = vi.fn().mockResolvedValue(undefined);
    renderMitProviders(
      <VollzugDialog
        schicht={schicht}
        einheiten={einheiten}
        abschnittName="Deichwache Nord"
        uebergabeGesperrt="Modul Einheiten gesperrt"
        laeuft={false}
        fehler={null}
        onErfassen={onErfassen}
        onSchliessen={vi.fn()}
      />,
    );
    const dialog = await screen.findByRole('dialog');
    const option = within(dialog).getByRole('checkbox', { name: /^Abschnitt übergeben/ });
    expect(option).toBeDisabled();
    expect(option).not.toBeChecked();
    expect(option).toHaveAccessibleDescription('Modul Einheiten gesperrt');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Vollziehen' }));
    await waitFor(() =>
      expect(onErfassen).toHaveBeenCalledWith(
        expect.objectContaining({ abschnitt_uebergeben: false }),
      ),
    );
  });

  it('ohne Abschnitt der abgelösten Einheit keine Option', async () => {
    renderMitProviders(
      <VollzugDialog
        schicht={schicht}
        einheiten={einheiten}
        abschnittName={null}
        laeuft={false}
        fehler={null}
        onErfassen={vi.fn()}
        onSchliessen={vi.fn()}
      />,
    );
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).queryByRole('checkbox')).toBeNull();
  });
});

/**
 * LLH-1150: Besatzungswechsel. Die Art wählt zwischen ganzer Einheit und Besatzungswechsel; der
 * Wechsel zeigt die bisherige Besatzung vorbelegt und nimmt statt der Ablöser die neue Besatzung
 * (Pflicht). Ohne Freigabe steht er gesperrt mit Grund. Feldbudget: drei Felder.
 */
describe('Ablösung — Vollzug als Besatzungswechsel (LLH-1150)', () => {
  const schicht = {
    id: 3,
    einheit_name: 'Florian 1',
    abloeser: [{ einheit_id: 12, einheit_name: 'Florian 2' }],
  } as unknown as Abloesung;
  const einheiten = [{ value: 12, label: 'Florian 2' }];
  const personen = [
    { value: 21, label: 'Cora Neu', name: 'Cora Neu' },
    { value: 22, label: 'Fritz · führt Florian 2', name: 'Fritz', disabled: true },
  ];

  function oeffne(onErfassen = vi.fn().mockResolvedValue(undefined), gesperrt?: string) {
    renderMitProviders(
      <VollzugDialog
        schicht={schicht}
        einheiten={einheiten}
        abschnittName="Deichwache Nord"
        bisherigeBesatzung={['Anna Alt', 'Bernd Alt']}
        personen={personen}
        besatzungGesperrt={gesperrt}
        laeuft={false}
        fehler={null}
        onErfassen={onErfassen}
        onSchliessen={vi.fn()}
      />,
    );
    return onErfassen;
  }

  /** Sichtbare Felder über ihre Label (`frontend/AGENTS.md`, „Feldbudget“). */
  const felder = (dialog: HTMLElement) =>
    Array.from(dialog.querySelectorAll('.ant-form-item-label label')).map((l) => l.textContent);

  it('wechselt die Felder: bisherige Besatzung sichtbar, neue Besatzung statt der Ablöser', async () => {
    const onErfassen = oeffne();
    const dialog = await screen.findByRole('dialog');
    // „Danach“ (LLH-1308) nur bei der ganzen Einheit, vorbelegt mit „In Ruhe“.
    expect(felder(dialog)).toEqual(['Art', 'Ablösende Einheiten', 'Zeitpunkt', 'Danach']);
    // Der Knopf der Radiogruppe trägt den Klick am Label, das Eingabefeld liegt darunter.
    await userEvent.click(
      within(dialog).getByRole('radio', { name: 'Besatzungswechsel' }).closest('label')!,
    );
    await waitFor(() => expect(felder(dialog)).toEqual(['Art', 'Neue Besatzung', 'Zeitpunkt']));
    expect(within(dialog).queryByRole('checkbox')).toBeNull();
    expect(dialog.querySelector('[data-lfh="vollzug-bisherige-besatzung"]')).toHaveTextContent(
      'Bisherige Besatzung: Anna Alt, Bernd Alt',
    );

    // Pflicht: ohne neue Besatzung geht nichts hinaus.
    await userEvent.click(within(dialog).getByRole('button', { name: 'Vollziehen' }));
    expect(
      await within(dialog).findByText('Bitte die neue Besatzung auswählen'),
    ).toBeInTheDocument();
    expect(onErfassen).not.toHaveBeenCalled();

    await userEvent.click(within(dialog).getByRole('combobox', { name: 'Neue Besatzung' }));
    const option = await waitFor(() => {
      const k = document.querySelector<HTMLElement>(
        '.ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option[title="Cora Neu"]',
      );
      expect(k).not.toBeNull();
      return k!;
    });
    expect(
      document.querySelector(
        '.ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option-disabled[title="Fritz · führt Florian 2"]',
      ),
    ).not.toBeNull();
    await userEvent.click(option);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Vollziehen' }));
    await waitFor(() =>
      expect(onErfassen).toHaveBeenCalledWith({
        vollzogen_at: undefined,
        art: 'besatzung',
        besatzung: [{ personal_id: 21 }],
      }),
    );
  });

  it('ohne Freigabe gesperrt mit Grund; die ganze Einheit bleibt wählbar', async () => {
    const onErfassen = oeffne(undefined, 'Modul Personal gesperrt');
    const dialog = await screen.findByRole('dialog');
    const wechsel = within(dialog).getByRole('radio', { name: 'Besatzungswechsel' });
    expect(wechsel).toBeDisabled();
    expect(within(dialog).getByRole('radiogroup')).toHaveAccessibleDescription(
      'Modul Personal gesperrt',
    );
    await userEvent.click(within(dialog).getByRole('button', { name: 'Vollziehen' }));
    await waitFor(() =>
      expect(onErfassen).toHaveBeenCalledWith(expect.objectContaining({ abloeser_ids: [12] })),
    );
  });
});

/**
 * LLH-1319: Verteilen und Planen. Das Klappteil „Verteilen“ bietet je gewählter Person die
 * Einheit samt Erben und deren Fahrzeuge an; sein Kopf nennt die Abweichung. Ein geplanter
 * Besatzungswechsel belegt Art, Personen und Verteilung vor, auch wenn das Personal erst nach
 * dem Öffnen lädt. „Ablösung planen“ trägt dieselbe Art-Wahl und sendet beide Listen.
 */
describe('Ablösung — Besatzungswechsel verteilen und planen (LLH-1319)', () => {
  const schicht = {
    id: 3,
    einheit_id: 1,
    einheit_name: 'Florian 1',
    erbende_einheiten: [{ einheit_id: 2, einheit_name: 'Gruppe 1' }],
    abloeser: [],
    besatzung_plan: [],
  } as unknown as Abloesung;
  const geplant = {
    ...schicht,
    besatzung_plan: [
      {
        personal_id: 21,
        name: 'Cora Neu',
        einheit_id: 2,
        einheit_name: 'Gruppe 1',
        fahrzeug_id: 44,
        funkrufname: 'Florian 1-44',
      },
      { personal_id: 23, name: 'Erik Entlassen' },
    ],
  } as unknown as Abloesung;
  const personen = [
    { value: 21, label: 'Cora Neu', name: 'Cora Neu' },
    { value: 24, label: 'Dirk Neu', name: 'Dirk Neu' },
  ];
  const verteilung = {
    einheiten: [
      { value: 1, label: 'Florian 1' },
      { value: 2, label: 'Gruppe 1' },
    ],
    fahrzeuge: [{ value: 44, label: 'Florian 1-44' }],
  };
  const kopf = (dialog: HTMLElement) =>
    dialog.querySelector('[data-lfh="besatzung-verteilen"] .ant-collapse-header');

  function vollzug(props: Partial<Parameters<typeof VollzugDialog>[0]> = {}) {
    const onErfassen = vi.fn().mockResolvedValue(undefined);
    const ui = (p: Partial<Parameters<typeof VollzugDialog>[0]>) => (
      <VollzugDialog
        schicht={schicht}
        einheiten={[]}
        bisherigeBesatzung={['Anna Alt']}
        personen={personen}
        verteilung={verteilung}
        laeuft={false}
        fehler={null}
        onErfassen={onErfassen}
        onSchliessen={vi.fn()}
        {...p}
      />
    );
    const r = renderMitProviders(ui(props));
    return {
      onErfassen,
      neu: (p: Partial<Parameters<typeof VollzugDialog>[0]>) => r.rerender(ui(p)),
    };
  }

  it('verteilt im Klappteil auf Gruppe und Fahrzeug; der Kopf nennt die Abweichung', async () => {
    const { onErfassen } = vollzug();
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(
      within(dialog).getByRole('radio', { name: 'Besatzungswechsel' }).closest('label')!,
    );
    // Ohne gewählte Person gibt es nichts zu verteilen.
    expect(kopf(dialog)).toBeNull();
    await waehle('Neue Besatzung', 'Cora Neu', 'Dirk Neu');
    await waitFor(() => expect(kopf(dialog)).toHaveTextContent('Verteilen · alle in Florian 1'));
    await userEvent.click(kopf(dialog)!);
    await waehle('Einheit für Cora Neu', 'Gruppe 1');
    await waehle('Fahrzeug für Cora Neu', 'Florian 1-44');
    await waitFor(() => expect(kopf(dialog)).toHaveTextContent('Verteilen · 1 verteilt'));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Vollziehen' }));
    await waitFor(() =>
      expect(onErfassen).toHaveBeenCalledWith({
        vollzogen_at: undefined,
        art: 'besatzung',
        besatzung: [{ personal_id: 21, einheit_id: 2, fahrzeug_id: 44 }, { personal_id: 24 }],
      }),
    );
  });

  it('ohne Erben und Fahrzeuge kein Klappteil', async () => {
    vollzug({ verteilung: null });
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(
      within(dialog).getByRole('radio', { name: 'Besatzungswechsel' }).closest('label')!,
    );
    await waehle('Neue Besatzung', 'Cora Neu');
    expect(kopf(dialog)).toBeNull();
  });

  it('belegt aus der Planung vor, sobald das Personal da ist; Entlassene fehlen', async () => {
    const { onErfassen, neu } = vollzug({ schicht: geplant, personen: null });
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('radio', { name: 'Besatzungswechsel' })).toBeChecked();
    expect(kopf(dialog)).toBeNull();
    neu({ schicht: geplant, personen });
    await waitFor(() => expect(kopf(dialog)).toHaveTextContent('Verteilen · 1 verteilt'));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Vollziehen' }));
    await waitFor(() =>
      expect(onErfassen).toHaveBeenCalledWith({
        vollzogen_at: undefined,
        art: 'besatzung',
        besatzung: [{ personal_id: 21, einheit_id: 2, fahrzeug_id: 44 }],
      }),
    );
  });

  it('belegt auch vor, wenn die Art vor dem Laden hin- und zurückgewechselt wurde', async () => {
    const { neu } = vollzug({ schicht: geplant, personen: null });
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(
      within(dialog).getByRole('radio', { name: 'Ganze Einheit' }).closest('label')!,
    );
    await userEvent.click(
      within(dialog).getByRole('radio', { name: 'Besatzungswechsel' }).closest('label')!,
    );
    neu({ schicht: geplant, personen });
    await waitFor(() => expect(kopf(dialog)).toHaveTextContent('Verteilen · 1 verteilt'));
  });

  it('eine eigene Auswahl übersteht den Art-Wechsel, bis die Einheiten da sind', async () => {
    const { onErfassen, neu } = vollzug({ schicht: geplant, verteilung: undefined });
    const dialog = await screen.findByRole('dialog');
    await waehle('Neue Besatzung', 'Dirk Neu');
    await userEvent.click(
      within(dialog).getByRole('radio', { name: 'Ganze Einheit' }).closest('label')!,
    );
    neu({ schicht: geplant, verteilung });
    await userEvent.click(
      within(dialog).getByRole('radio', { name: 'Besatzungswechsel' }).closest('label')!,
    );
    await userEvent.click(within(dialog).getByRole('button', { name: 'Vollziehen' }));
    await waitFor(() =>
      expect(onErfassen).toHaveBeenCalledWith({
        vollzogen_at: undefined,
        art: 'besatzung',
        besatzung: [{ personal_id: 24 }],
      }),
    );
  });

  it('gesperrt: keine Vorbelegung, die ganze Einheit bleibt', async () => {
    vollzug({ schicht: geplant, besatzungGesperrt: 'Modul Personal gesperrt' });
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('radio', { name: 'Ganze Einheit' })).toBeChecked();
  });

  function planung(props: Partial<Parameters<typeof AbloeserDialog>[0]> = {}) {
    const onErfassen = vi.fn().mockResolvedValue(undefined);
    renderMitProviders(
      <AbloeserDialog
        schicht={schicht}
        einheiten={[{ value: 12, label: 'Florian 2' }]}
        bisherigeBesatzung={['Anna Alt']}
        personen={personen}
        verteilung={verteilung}
        laeuft={false}
        fehler={null}
        onErfassen={onErfassen}
        onSchliessen={vi.fn()}
        {...props}
      />,
    );
    return onErfassen;
  }

  it('Planen: Besatzungswechsel mit Verteilung; nur der Plan geht hinaus', async () => {
    const onErfassen = planung();
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('radio', { name: 'Ganze Einheit' })).toBeChecked();
    await userEvent.click(
      within(dialog).getByRole('radio', { name: 'Besatzungswechsel' }).closest('label')!,
    );
    expect(within(dialog).queryByText('Zeitpunkt')).toBeNull();
    await waehle('Neue Besatzung', 'Dirk Neu');
    await userEvent.click(kopf(dialog)!);
    await waehle('Fahrzeug für Dirk Neu', 'Florian 1-44');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Speichern' }));
    await waitFor(() =>
      expect(onErfassen).toHaveBeenCalledWith({
        besatzung_plan: [{ personal_id: 24, fahrzeug_id: 44 }],
      }),
    );
  });

  // Auch die Vorbelegung ohne die inzwischen Entlassene ist keine Änderung: Speichern räumt sie
  // nicht still aus der Planung.
  it('Planen unverändert: kein Aufruf, eine inzwischen überholte Planung bleibt stehen', async () => {
    const onSchliessen = vi.fn();
    const onErfassen = planung({ schicht: geplant, onSchliessen });
    const dialog = await screen.findByRole('dialog');
    await waitFor(() => expect(kopf(dialog)).toHaveTextContent('Verteilen · 1 verteilt'));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Speichern' }));
    await waitFor(() => expect(onSchliessen).toHaveBeenCalled());
    expect(onErfassen).not.toHaveBeenCalled();
  });

  it('Planen: Ablöser heben einen geplanten Wechsel auf; die Vorbelegung zeigt ihn', async () => {
    const onErfassen = planung({ schicht: geplant });
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('radio', { name: 'Besatzungswechsel' })).toBeChecked();
    await waitFor(() => expect(kopf(dialog)).toHaveTextContent('Verteilen · 1 verteilt'));
    await userEvent.click(
      within(dialog).getByRole('radio', { name: 'Ganze Einheit' }).closest('label')!,
    );
    await waehle('Ablösende Einheiten', 'Florian 2');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Speichern' }));
    await waitFor(() =>
      expect(onErfassen).toHaveBeenCalledWith({ abloeser_ids: [12], besatzung_plan: [] }),
    );
  });

  it('Planen: ist keine geplante Person mehr wählbar, heben Ablöser den Wechsel trotzdem auf', async () => {
    const nurEntlassene = {
      ...schicht,
      besatzung_plan: [{ personal_id: 23, name: 'Erik Entlassen' }],
    } as unknown as Abloesung;
    const onErfassen = planung({ schicht: nurEntlassene });
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('radio', { name: 'Besatzungswechsel' })).toBeChecked();
    await userEvent.click(
      within(dialog).getByRole('radio', { name: 'Ganze Einheit' }).closest('label')!,
    );
    await waehle('Ablösende Einheiten', 'Florian 2');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Speichern' }));
    await waitFor(() =>
      expect(onErfassen).toHaveBeenCalledWith({ abloeser_ids: [12], besatzung_plan: [] }),
    );
  });

  it('Planen nach der Vorbelegung geändert: der Plan geht ohne die Entlassene hinaus', async () => {
    const onErfassen = planung({ schicht: geplant });
    const dialog = await screen.findByRole('dialog');
    await waitFor(() => expect(kopf(dialog)).toHaveTextContent('Verteilen · 1 verteilt'));
    await waehle('Neue Besatzung', 'Dirk Neu');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Speichern' }));
    await waitFor(() =>
      expect(onErfassen).toHaveBeenCalledWith({
        besatzung_plan: [{ personal_id: 21, einheit_id: 2, fahrzeug_id: 44 }, { personal_id: 24 }],
      }),
    );
  });

  it('Planen ohne geladenes Personal: der geplante Wechsel bleibt unberührt', async () => {
    const onSchliessen = vi.fn();
    const onErfassen = planung({ schicht: geplant, personen: null, onSchliessen });
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('radio', { name: 'Besatzungswechsel' })).toBeChecked();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Speichern' }));
    await waitFor(() => expect(onSchliessen).toHaveBeenCalled());
    expect(onErfassen).not.toHaveBeenCalled();
  });

  it('Planen ohne geladene Einheiten: der geplante Wechsel bleibt mit seinen Zielen stehen', async () => {
    const onSchliessen = vi.fn();
    const onErfassen = planung({ schicht: geplant, verteilung: undefined, onSchliessen });
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('radio', { name: 'Besatzungswechsel' })).toBeChecked();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Speichern' }));
    await waitFor(() => expect(onSchliessen).toHaveBeenCalled());
    expect(onErfassen).not.toHaveBeenCalled();
  });

  it('Planen gesperrt: nur die Ablöser gehen hinaus, die Planung bleibt unberührt', async () => {
    const onErfassen = planung({ besatzungGesperrt: 'Modul Personal gesperrt' });
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('radio', { name: 'Besatzungswechsel' })).toBeDisabled();
    expect(within(dialog).getByRole('radiogroup')).toHaveAccessibleDescription(
      'Modul Personal gesperrt',
    );
    await waehle('Ablösende Einheiten', 'Florian 2');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Speichern' }));
    await waitFor(() => expect(onErfassen).toHaveBeenCalledWith({ abloeser_ids: [12] }));
  });
});

/**
 * LLH-1308: „Danach“ — was nach dem Vollzug mit der abgelösten Einheit geschieht. Vorgabe „In
 * Ruhe“ (geht nicht hinaus), je aktivem Raum eine Option, „Entlassen“; ohne Freigabe des Moduls
 * Bereitstellungsräume fehlen die Räume und der Grund steht unter dem Feld.
 */
describe('Ablösung — Vollzug mit Verbleib (LLH-1308)', () => {
  const schicht = {
    id: 3,
    einheit_name: 'Florian 1',
    abloeser: [{ einheit_id: 12, einheit_name: 'Florian 2' }],
  } as unknown as Abloesung;
  const einheiten = [{ value: 12, label: 'Florian 2' }];
  const raeume = [
    { id: 7, bezeichnung: 'Schule' },
    { id: 8, bezeichnung: 'Sportplatz' },
  ];

  function zeige(raumGesperrt?: string) {
    const onErfassen = vi.fn().mockResolvedValue(undefined);
    renderMitProviders(
      <VollzugDialog
        schicht={schicht}
        einheiten={einheiten}
        raeume={raeume}
        raumGesperrt={raumGesperrt}
        laeuft={false}
        fehler={null}
        onErfassen={onErfassen}
        onSchliessen={vi.fn()}
      />,
    );
    return onErfassen;
  }

  it('wählt einen Raum; Raum und Art gehen hinaus', async () => {
    const onErfassen = zeige();
    const dialog = await screen.findByRole('dialog');
    await oeffneListe('Danach');
    expect(optionenVon('Danach')).toEqual([
      'In Ruhe',
      'Bereitstellungsraum «Schule»',
      'Bereitstellungsraum «Sportplatz»',
      'Entlassen',
    ]);
    await waehle('Danach', 'Bereitstellungsraum «Schule»');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Vollziehen' }));
    await waitFor(() =>
      expect(onErfassen).toHaveBeenCalledWith({
        vollzogen_at: undefined,
        abloeser_ids: [12],
        abschnitt_uebergeben: false,
        verbleib: 'bereitstellungsraum',
        verbleib_br_id: 7,
      }),
    );
  });

  it('In Ruhe ist die Vorgabe und geht nicht hinaus', async () => {
    const onErfassen = zeige();
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByTitle('In Ruhe')).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Vollziehen' }));
    await waitFor(() => expect(onErfassen).toHaveBeenCalled());
    expect(onErfassen.mock.calls[0][0]).not.toHaveProperty('verbleib');
  });

  it('ohne Freigabe der Bereitstellungsräume keine Räume, der Grund unter dem Feld', async () => {
    const onErfassen = zeige('Modul Bereitstellungsräume gesperrt');
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('combobox', { name: 'Danach' })).toHaveAccessibleDescription(
      'Modul Bereitstellungsräume gesperrt',
    );
    await oeffneListe('Danach');
    expect(optionenVon('Danach')).toEqual(['In Ruhe', 'Entlassen']);
    await waehle('Danach', 'Entlassen');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Vollziehen' }));
    await waitFor(() =>
      expect(onErfassen).toHaveBeenCalledWith(expect.objectContaining({ verbleib: 'entlassen' })),
    );
    expect(onErfassen.mock.calls[0][0]).not.toHaveProperty('verbleib_br_id');
  });
});
