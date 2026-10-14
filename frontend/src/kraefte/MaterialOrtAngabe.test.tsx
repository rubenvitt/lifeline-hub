import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderMitProviders } from '../test/utils';
import { listeVon, oeffne, optionenVon, waehle } from '../test/auswahlListe';
import { ApiError } from '../api/client';
import type { Einheit, ModulFreigaben } from '../api/types';
import MaterialOrtAngabe, { type MaterialOrtKontext } from './MaterialOrtAngabe';
import { buildEinheitOptions } from './kraeftebaumKern';
import type { MaterialOrtRef } from './materialPosten';

const einheiten = [
  { id: 1, name: 'Staffel A', ueber_einheit_id: null, abschnitt_id: null },
  { id: 3, name: 'Rettungsstaffel', ueber_einheit_id: null, abschnitt_id: null },
] as Einheit[];

function kontext(freigaben?: ModulFreigaben, namen = true): MaterialOrtKontext {
  return {
    einsatzId: 1,
    namen: namen
      ? {
          einheit: (id) => einheiten.find((e) => e.id === id)?.name,
          fahrzeug: (id) => (id === 4 ? 'Florian 1/83-1' : undefined),
          uhs: (id) => ({ 7: 'Turnhalle', 9: 'Zelt Nord' })[id],
          bereitstellungsraum: (id) => (id === 6 ? 'BR Nord' : undefined),
        }
      : {},
    quellen: {
      einheiten: buildEinheitOptions(einheiten, []),
      fahrzeuge: [{ id: 4, funkrufname: 'Florian 1/83-1', beendet_at: null }],
      uhs: [
        { id: 7, bezeichnung: 'Turnhalle', status: 'aktiv', storniert_at: null },
        { id: 9, bezeichnung: 'Zelt Nord', status: 'aufgeloest', storniert_at: null },
      ],
      br: [{ id: 6, bezeichnung: 'BR Nord', status: 'geplant', storniert_at: null }],
      freigaben,
    },
  };
}

function zeige(
  p: {
    ort?: MaterialOrtRef | null;
    darfSchreiben?: boolean;
    kontext?: MaterialOrtKontext;
    onSpeichern?: (ziel: MaterialOrtRef | null) => Promise<unknown>;
  } = {},
) {
  const onSpeichern = p.onSpeichern ?? vi.fn().mockResolvedValue(undefined);
  renderMitProviders(
    <MaterialOrtAngabe
      kennung="Wolldecke"
      ort={p.ort ?? null}
      kontext={p.kontext ?? kontext()}
      darfSchreiben={p.darfSchreiben ?? true}
      onSpeichern={onSpeichern}
    />,
  );
  return { onSpeichern };
}

const NAME = 'Ort zu Wolldecke';

describe('MaterialOrtAngabe (LLH-1225 D3)', () => {
  it('ohne Schreibrecht: der Name führt in sein Modul, je Ortsart', () => {
    const faelle: [MaterialOrtRef, string, string][] = [
      [{ art: 'einheit', id: 3 }, 'Rettungsstaffel', '/einsaetze/1/einheiten/3'],
      [{ art: 'fahrzeug', id: 4 }, 'Florian 1/83-1', '/einsaetze/1/fahrzeuge?fahrzeug=4'],
      [{ art: 'uhs', id: 7 }, 'UHS Turnhalle', '/einsaetze/1/unfallhilfsstellen/7'],
      [{ art: 'bereitstellungsraum', id: 6 }, 'BR Nord', '/einsaetze/1/bereitstellungsraeume/6'],
    ];
    for (const [ort, name, href] of faelle) {
      const { unmount } = renderMitProviders(
        <MaterialOrtAngabe
          kennung="Wolldecke"
          ort={ort}
          kontext={kontext()}
          darfSchreiben={false}
          onSpeichern={vi.fn()}
        />,
      );
      expect(screen.getByRole('link', { name })).toHaveAttribute('href', href);
      unmount();
    }
  });

  it('ohne Leserecht „zugeordnet“, ohne Ort „ohne Ort“, nie ein Strich', () => {
    zeige({
      ort: { art: 'einheit', id: 3 },
      darfSchreiben: false,
      kontext: kontext(undefined, false),
    });
    expect(screen.getByTestId('material-ort')).toHaveTextContent(/^zugeordnet$/);
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('ohne Ort und ohne Schreibrecht: „ohne Ort“', () => {
    zeige({ darfSchreiben: false });
    expect(screen.getByTestId('material-ort')).toHaveTextContent(/^ohne Ort$/);
  });

  it('EINE Angabe: der Auslöser nennt den Ort, auch „ohne Ort“', () => {
    zeige({ ort: { art: 'uhs', id: 7 } });
    expect(screen.getAllByRole('button')).toHaveLength(1);
    expect(screen.getByRole('button', { name: `${NAME} bearbeiten` })).toHaveTextContent(
      'UHS Turnhalle',
    );
  });

  it('Verlassen ohne Speichern sendet nichts; „Speichern“ sendet das Ziel', async () => {
    const { onSpeichern } = zeige({ ort: { art: 'einheit', id: 1 } });
    await userEvent.click(screen.getByRole('button', { name: `${NAME} bearbeiten` }));
    await waehle(NAME, 'UHS Turnhalle');
    fireEvent.blur(screen.getByRole('combobox', { name: NAME }));
    await userEvent.click(document.body);
    expect(onSpeichern).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: `${NAME} speichern` }));
    await waitFor(() => expect(onSpeichern).toHaveBeenCalledWith({ art: 'uhs', id: 7 }));
  });

  it('Enter sendet; „ohne Ort“ löst', async () => {
    const { onSpeichern } = zeige({ ort: { art: 'bereitstellungsraum', id: 6 } });
    await userEvent.click(screen.getByRole('button', { name: `${NAME} bearbeiten` }));
    await waehle(NAME, 'ohne Ort');
    fireEvent.submit(screen.getByRole('combobox', { name: NAME }).closest('form')!);
    await waitFor(() => expect(onSpeichern).toHaveBeenCalledWith(null));
  });

  it('bietet je Ortsart eine Gruppe; ohne Leserecht auf ein Modul fehlt seine', async () => {
    zeige({
      kontext: kontext({ bereitstellungsraeume: { zugriff: false } } as unknown as ModulFreigaben),
    });
    await userEvent.click(screen.getByRole('button', { name: `${NAME} bearbeiten` }));
    await oeffne(NAME);
    const gruppen = listeVon(NAME)!.querySelectorAll('.ant-select-item-group');
    expect([...gruppen].map((g) => g.textContent)).toEqual([
      'Einheiten',
      'Fahrzeuge',
      'Unfallhilfsstellen',
    ]);
    expect(optionenVon(NAME)).toEqual([
      'ohne Ort',
      'Staffel A',
      'Rettungsstaffel',
      'Florian 1/83-1',
      'UHS Turnhalle',
    ]);
  });

  it('ein aufgelöster aktueller Ort steht gesperrt mit Namen in der Auswahl', async () => {
    zeige({ ort: { art: 'uhs', id: 9 } });
    await userEvent.click(screen.getByRole('button', { name: `${NAME} bearbeiten` }));
    await oeffne(NAME);
    expect(optionenVon(NAME, '-disabled')).toEqual(['UHS Zelt Nord']);
  });

  it('eine Ablehnung steht an der Angabe', async () => {
    const onSpeichern = vi.fn().mockRejectedValue(new ApiError(422, 'UHS ist aufgelöst'));
    zeige({ onSpeichern });
    await userEvent.click(screen.getByRole('button', { name: `${NAME} bearbeiten` }));
    await waehle(NAME, 'UHS Turnhalle');
    await userEvent.click(screen.getByRole('button', { name: `${NAME} speichern` }));
    expect(await screen.findByText(/UHS ist aufgelöst/)).toBeInTheDocument();
  });
});
