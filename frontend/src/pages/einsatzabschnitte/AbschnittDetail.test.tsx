import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '../../test/server';
import { renderMitProviders } from '../../test/utils';
import { ApiError } from '../../api/client';
import type { Einsatzabschnitt } from '../../api/types';
import AbschnittDetail, { type AbschnittPatchHandler } from './AbschnittDetail';
import AbschnittDaten from './AbschnittDaten';

const sprechgruppe = (id: number, bezeichnung: string, betriebsart: 'TMO' | 'DMO') => ({
  id,
  einsatz_id: 1,
  einsatz_lokal: false,
  bezeichnung,
  betriebsart,
  hinweis: null,
  aktiv: true,
  sortier: id,
});

const nord = (o: Partial<Einsatzabschnitt> = {}): Einsatzabschnitt =>
  ({
    id: 5,
    einsatz_id: 1,
    ueber_abschnitt_id: null,
    name: 'Nord',
    kurzbezeichnung: 'EA N',
    leiter_id: null,
    leiter_name: null,
    lagezustand: 'planmaessig',
    abschnittsauftrag: null,
    fortschritt: 72,
    bemerkung: null,
    sprechgruppen: [],
    kommunikationsmittel: null,
    erreichbarkeit: null,
    sortier: 0,
    ...o,
  }) as Einsatzabschnitt;

const sued = nord({ id: 6, name: 'Süd', kurzbezeichnung: 'EA S', lagezustand: null });

const personal = [
  { id: 3, name: 'Carla Christ' },
  { id: 4, name: 'Dora Dreher' },
];

function renderDetail(
  abschnitt: Einsatzabschnitt,
  {
    darfSchreiben = true,
    onPatch = vi.fn<AbschnittPatchHandler>().mockResolvedValue(undefined),
    abschnitte = [abschnitt, ...(abschnitt.id === sued.id ? [] : [sued])],
  }: {
    darfSchreiben?: boolean;
    onPatch?: ReturnType<typeof vi.fn<AbschnittPatchHandler>>;
    abschnitte?: Einsatzabschnitt[];
  } = {},
) {
  const ansicht = renderMitProviders(
    <AbschnittDetail
      abschnitt={abschnitt}
      abschnitte={abschnitte}
      personal={personal}
      einsatzId={1}
      staerken={{ eigene: null, inklUnter: null }}
      darfSchreiben={darfSchreiben}
      onPatch={onPatch}
    />,
  );
  return { onPatch, ansicht };
}

const labelsOf = (wurzel: HTMLElement) =>
  Array.from(wurzel.querySelectorAll('[data-lfh="datenfeld"] dt')).map((e) => e.textContent);

describe('AbschnittDetail (LFH-1208)', () => {
  it('jede Angabe steht an ihrem Wert, kein Knopf „Bearbeiten“ und kein Fortschritt', () => {
    const { ansicht } = renderDetail(nord());
    expect(labelsOf(ansicht.container)).toEqual([
      'Name',
      'Kurzbezeichnung',
      'Abschnittsleiter',
      'Lagezustand',
      'Abschnittsauftrag',
      'Sprechgruppen',
      'Kommunikationsmittel',
      'Erreichbarkeit / Nummer',
      'Bemerkung',
      'Stärke (F/UF/M//Σ)',
      'Stärke inkl. Unterabschnitte (F/UF/M//Σ)',
    ]);
    expect(screen.queryByRole('button', { name: 'Bearbeiten' })).toBeNull();
    expect(screen.queryByText(/Fortschritt|72 %/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Name bearbeiten' })).toHaveAccessibleDescription(
      'Nord',
    );
    for (const leer of [
      'Abschnittsleiter',
      'Abschnittsauftrag',
      'Sprechgruppen',
      'Kommunikationsmittel',
      'Erreichbarkeit / Nummer',
      'Bemerkung',
    ]) {
      expect(screen.getByRole('button', { name: `${leer} eintragen` })).toBeInTheDocument();
    }
  });

  it('die Lese-Ansicht (`AbschnittDaten`) zeigt ebenfalls keinen Fortschritt', () => {
    const { container } = renderMitProviders(
      <AbschnittDaten abschnitt={nord()} staerken={{ eigene: null, inklUnter: null }} />,
    );
    expect(labelsOf(container)).not.toContain('Fortschritt');
  });

  it('Abschnittsleiter: genau `leiter_id` geht hinaus', async () => {
    const user = userEvent.setup();
    const { onPatch } = renderDetail(nord());
    await user.click(screen.getByRole('button', { name: 'Abschnittsleiter eintragen' }));
    await user.click(screen.getByRole('combobox', { name: 'Abschnittsleiter' }));
    await user.click(await screen.findByText('Dora Dreher'));
    await user.click(screen.getByRole('button', { name: 'Abschnittsleiter speichern' }));
    await waitFor(() => expect(onPatch).toHaveBeenCalledWith('Abschnittsleiter', { leiter_id: 4 }));
    expect(onPatch).toHaveBeenCalledTimes(1);
  });

  // Die Gegenprobe gegen einen geänderten Serverstand steht in `EinsatzabschnittePage.test.tsx`.
  it('zwei Zeilen nacheinander schicken je nur ihr Feld', async () => {
    const user = userEvent.setup();
    const { onPatch } = renderDetail(nord({ lagezustand: 'planmaessig' }));
    await user.click(screen.getByRole('button', { name: 'Bemerkung eintragen' }));
    await user.type(screen.getByRole('textbox', { name: 'Bemerkung' }), 'Zufahrt Nord');
    await user.click(screen.getByRole('button', { name: 'Bemerkung speichern' }));
    await user.click(screen.getByRole('button', { name: 'Abschnittsauftrag eintragen' }));
    await user.type(screen.getByRole('textbox', { name: 'Abschnittsauftrag' }), 'Deich halten');
    await user.click(screen.getByRole('button', { name: 'Abschnittsauftrag speichern' }));
    await waitFor(() => expect(onPatch).toHaveBeenCalledTimes(2));
    expect(onPatch.mock.calls).toEqual([
      ['Bemerkung', { bemerkung: 'Zufahrt Nord' }],
      ['Abschnittsauftrag', { abschnittsauftrag: 'Deich halten' }],
    ]);
  });

  it('unverändert gespeichert: keine Anfrage', async () => {
    const user = userEvent.setup();
    const { onPatch } = renderDetail(nord());
    await user.click(screen.getByRole('button', { name: 'Name bearbeiten' }));
    await user.click(screen.getByRole('button', { name: 'Name speichern' }));
    expect(await screen.findByRole('button', { name: 'Name bearbeiten' })).toBeInTheDocument();
    expect(onPatch).not.toHaveBeenCalled();
  });

  it('eine geleerte optionale Angabe geht als `null`', async () => {
    const user = userEvent.setup();
    const { onPatch } = renderDetail(nord({ erreichbarkeit: '0151 23456' }));
    await user.click(screen.getByRole('button', { name: 'Erreichbarkeit / Nummer bearbeiten' }));
    await user.clear(screen.getByRole('textbox', { name: 'Erreichbarkeit / Nummer' }));
    await user.click(screen.getByRole('button', { name: 'Erreichbarkeit / Nummer speichern' }));
    await waitFor(() =>
      expect(onPatch).toHaveBeenCalledWith('Erreichbarkeit / Nummer', { erreichbarkeit: null }),
    );
  });

  it('Name ist Pflicht: leer gespeichert heißt keine Anfrage und ein Hinweis an der Zeile', async () => {
    const user = userEvent.setup();
    const { onPatch } = renderDetail(nord());
    await user.click(screen.getByRole('button', { name: 'Name bearbeiten' }));
    await user.clear(screen.getByRole('textbox', { name: 'Name' }));
    await user.click(screen.getByRole('button', { name: 'Name speichern' }));
    expect(await screen.findByText(/Name ist eine Pflichtangabe/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Name bearbeiten' })).toHaveAccessibleDescription(
      'Nord',
    );
    expect(onPatch).not.toHaveBeenCalled();
  });

  it('Kurzbezeichnung: vergeben (ohne Groß-/Kleinschreibung) heißt keine Anfrage, Grund am Feld', async () => {
    const user = userEvent.setup();
    const { onPatch } = renderDetail(nord());
    await user.click(screen.getByRole('button', { name: 'Kurzbezeichnung bearbeiten' }));
    const feld = screen.getByRole('textbox', { name: 'Kurzbezeichnung' });
    await user.clear(feld);
    await user.type(feld, 'ea s{Enter}');
    expect(await screen.findByText('Schon vergeben (Süd)')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Kurzbezeichnung' })).toHaveValue('ea s');
    expect(onPatch).not.toHaveBeenCalled();
  });

  it('Ablehnung einer Sprechgruppen-Änderung: Auswahl bleibt offen, Grund darunter', async () => {
    server.use(
      http.get('/api/einsaetze/1/sprechgruppen', () =>
        HttpResponse.json([sprechgruppe(7, '412_F_DRK', 'TMO'), sprechgruppe(8, 'DMO 31', 'DMO')]),
      ),
    );
    const user = userEvent.setup();
    const onPatch = vi
      .fn<AbschnittPatchHandler>()
      .mockRejectedValue(new ApiError(400, 'Sprechgruppe gehört nicht zum Einsatz'));
    renderDetail(nord(), { onPatch });
    await user.click(screen.getByRole('button', { name: 'Sprechgruppen eintragen' }));
    await user.click(screen.getByRole('combobox', { name: 'Sprechgruppen' }));
    await user.click(await screen.findByText('DMO 31'));
    await user.click(screen.getByRole('button', { name: 'Sprechgruppen speichern' }));
    expect(await screen.findByText('Sprechgruppe gehört nicht zum Einsatz')).toBeInTheDocument();
    expect(onPatch).toHaveBeenCalledWith('Sprechgruppen', { sprechgruppe_ids: [8] });
    expect(screen.getByRole('button', { name: 'Sprechgruppen speichern' })).toBeInTheDocument();
  });

  describe('Lagezustand mit einem Klick', () => {
    const bar = () => screen.getByRole('radiogroup', { name: 'Lagezustand' });
    const level = (name: string) => within(bar()).getByRole('radio', { name });

    it('vier Stufen, die gespeicherte gewählt', () => {
      renderDetail(nord({ lagezustand: 'angespannt' }));
      expect(
        within(bar())
          .getAllByRole('radio')
          .map((r) => r.textContent),
      ).toEqual(['nicht beurteilt', 'planmäßig', 'angespannt', 'kritisch']);
      expect(level('angespannt')).toHaveAttribute('aria-checked', 'true');
      // Nicht gestreckt: sonst füllte der Fugengrund der Leiste die ganze Zeile grau.
      expect(bar().parentElement).toHaveStyle({ alignItems: 'flex-start' });
    });

    it('ein Klick speichert genau `lagezustand`', async () => {
      const user = userEvent.setup();
      const { onPatch } = renderDetail(nord({ lagezustand: 'angespannt' }));
      await user.click(level('kritisch'));
      await waitFor(() =>
        expect(onPatch).toHaveBeenCalledWith('Lagezustand', { lagezustand: 'kritisch' }),
      );
      expect(onPatch).toHaveBeenCalledTimes(1);
    });

    it('„nicht beurteilt“ leert das Feld', async () => {
      const user = userEvent.setup();
      const { onPatch } = renderDetail(nord({ lagezustand: 'kritisch' }));
      await user.click(level('nicht beurteilt'));
      await waitFor(() =>
        expect(onPatch).toHaveBeenCalledWith('Lagezustand', { lagezustand: null }),
      );
    });

    it('die gewählte Stufe noch einmal: keine Anfrage', async () => {
      const user = userEvent.setup();
      const { onPatch } = renderDetail(nord({ lagezustand: 'angespannt' }));
      await user.click(level('angespannt'));
      expect(onPatch).not.toHaveBeenCalled();
    });

    it('Pfeiltaste wählt und speichert die nächste Stufe', async () => {
      const user = userEvent.setup();
      const { onPatch } = renderDetail(nord({ lagezustand: 'angespannt' }));
      level('angespannt').focus();
      await user.keyboard('{ArrowRight}');
      await waitFor(() =>
        expect(onPatch).toHaveBeenCalledWith('Lagezustand', { lagezustand: 'kritisch' }),
      );
    });

    it('Ablehnung: die vorige Stufe steht wieder, der Grund an der Zeile', async () => {
      const user = userEvent.setup();
      const onPatch = vi
        .fn<AbschnittPatchHandler>()
        .mockRejectedValue(new ApiError(403, 'Einsatz abgeschlossen'));
      renderDetail(nord({ lagezustand: 'angespannt' }), { onPatch });
      await user.click(level('kritisch'));
      expect(await screen.findByText('Einsatz abgeschlossen')).toHaveAttribute(
        'data-fehler',
        'true',
      );
      expect(level('angespannt')).toHaveAttribute('aria-checked', 'true');
      expect(level('kritisch')).toHaveAttribute('aria-checked', 'false');
    });

    it('zwei schnelle Pfeilschritte: eine Anfrage zur Zeit, die letzte Wahl geht danach hinaus', async () => {
      // Vorher ging der zweite Schritt im Riegel verloren, während der Fokus schon auf ihm stand
      // (Review LFH-1208).
      const user = userEvent.setup();
      const zusagen: (() => void)[] = [];
      const onPatch = vi.fn<AbschnittPatchHandler>().mockImplementation(
        () =>
          new Promise<void>((r) => {
            zusagen.push(r);
          }),
      );
      renderDetail(nord({ lagezustand: 'kritisch' }), { onPatch });
      level('kritisch').focus();
      await user.keyboard('{ArrowLeft}');
      await user.keyboard('{ArrowLeft}');
      // Eine Anfrage unterwegs; Häkchen und Fokus stehen auf der letzten Wahl.
      expect(onPatch.mock.calls).toEqual([['Lagezustand', { lagezustand: 'angespannt' }]]);
      expect(level('planmäßig')).toHaveAttribute('aria-checked', 'true');
      expect(level('planmäßig')).toHaveFocus();

      zusagen[0]();
      await waitFor(() => expect(onPatch).toHaveBeenCalledTimes(2));
      expect(onPatch.mock.calls[1]).toEqual(['Lagezustand', { lagezustand: 'planmaessig' }]);
      zusagen[1]();
      await waitFor(() => expect(level('planmäßig')).toHaveAttribute('aria-checked', 'true'));
      expect(onPatch).toHaveBeenCalledTimes(2);
    });

    it('zurück zur gesendeten Stufe, solange sie unterwegs ist: keine zweite Anfrage', async () => {
      const user = userEvent.setup();
      let erfuelle: () => void = () => {};
      const onPatch = vi.fn<AbschnittPatchHandler>().mockImplementation(
        () =>
          new Promise<void>((r) => {
            erfuelle = r;
          }),
      );
      renderDetail(nord({ lagezustand: 'planmaessig' }), { onPatch });
      await user.click(level('kritisch'));
      await user.click(level('angespannt'));
      await user.click(level('kritisch'));
      erfuelle();
      await waitFor(() => expect(level('kritisch')).toHaveAttribute('aria-checked', 'true'));
      expect(onPatch).toHaveBeenCalledTimes(1);
    });
  });

  it('ohne Schreibrecht: kein Stift, keine Stufenwahl, leer als „—“', () => {
    renderDetail(nord({ lagezustand: null }), { darfSchreiben: false });
    expect(screen.queryAllByRole('button')).toHaveLength(0);
    expect(screen.queryByRole('radiogroup')).toBeNull();
    expect(screen.getByText('nicht beurteilt')).toBeInTheDocument();
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(6);
  });

  it('ohne Schreibrecht steht ein beurteilter Lagezustand als Wort', () => {
    renderDetail(nord({ lagezustand: 'kritisch' }), { darfSchreiben: false });
    expect(screen.getByText('kritisch')).toBeInTheDocument();
    expect(screen.queryByRole('radiogroup')).toBeNull();
  });
});
