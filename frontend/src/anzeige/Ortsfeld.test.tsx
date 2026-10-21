import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { OrtSucheAntwort } from '../api/karteOrtSuche';
import { einsatzKeys } from '../api/queryKeys';
import { renderMitProviders, setzeOnline } from '../test/utils';
import { Ortsfeld, type OrtsfeldWert } from './Ortsfeld';

/**
 * Baustein Ortsfeld (LFH-1175, Spec `ortsfeld`). Die Suche wird als Funktion hineingereicht; der
 * Test prüft, wann sie gerufen wird und was die Wahl eines Treffers aus dem Wert macht.
 */

const TREFFER: OrtSucheAntwort = {
  zustand: 'ok',
  treffer: [
    {
      lat: 51.1,
      lon: 10.4,
      name: 'Bahnhofstraße 1, Musterstadt, Landkreis X, Niedersachsen, 12345, Deutschland',
      kurz: 'Bahnhofstraße 1, 12345 Musterstadt',
    },
    { lat: 48.1, lon: 11.5, name: 'Bahnhofstraße 1, Anderswo' },
  ],
};

function Aufbau({
  suchen,
  start = { text: '', koordinate: null },
  onSubmit,
}: {
  suchen: (b: string) => Promise<OrtSucheAntwort>;
  start?: OrtsfeldWert;
  onSubmit?: () => void;
}) {
  const [wert, setWert] = useState<OrtsfeldWert>(start);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit?.();
      }}
    >
      <Ortsfeld
        aria-label="Einsatzort"
        value={wert}
        onChange={setWert}
        suchen={suchen}
        suchSchluessel={(b) => einsatzKeys.einsatzortSuche(7, b)}
      />
      <output data-testid="wert">{JSON.stringify(wert)}</output>
    </form>
  );
}

function wert(): OrtsfeldWert {
  return JSON.parse(screen.getByTestId('wert').textContent!) as OrtsfeldWert;
}

afterEach(() => setzeOnline(true));

describe('Ortsfeld', () => {
  it('fragt beim Tippen nicht', async () => {
    const suchen = vi.fn().mockResolvedValue(TREFFER);
    renderMitProviders(<Aufbau suchen={suchen} />);
    await userEvent.type(screen.getByRole('textbox', { name: 'Einsatzort' }), 'Hauptstraße 12');
    expect(suchen).not.toHaveBeenCalled();
    expect(screen.queryByRole('list', { name: 'Treffer' })).not.toBeInTheDocument();
    expect(wert()).toEqual({ text: 'Hauptstraße 12', koordinate: null });
  });

  it('sucht auf Enter, ohne das Formular abzusenden', async () => {
    const suchen = vi.fn().mockResolvedValue(TREFFER);
    const onSubmit = vi.fn();
    renderMitProviders(<Aufbau suchen={suchen} onSubmit={onSubmit} />);
    await userEvent.type(
      screen.getByRole('textbox', { name: 'Einsatzort' }),
      'Bahnhofstraße 1{Enter}',
    );
    expect(suchen).toHaveBeenCalledWith('Bahnhofstraße 1');
    const liste = await screen.findByRole('list', { name: 'Treffer' });
    expect(within(liste).getAllByRole('button')).toHaveLength(2);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('sucht über den Knopf „Ort suchen“', async () => {
    const suchen = vi.fn().mockResolvedValue(TREFFER);
    renderMitProviders(
      <Aufbau suchen={suchen} start={{ text: 'Bahnhofstraße 1', koordinate: null }} />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Ort suchen' }));
    expect(suchen).toHaveBeenCalledWith('Bahnhofstraße 1');
    expect(await screen.findByRole('list', { name: 'Treffer' })).toBeInTheDocument();
  });

  it('fragt unter drei Zeichen nicht, „Ort suchen“ ist dann gesperrt', async () => {
    const suchen = vi.fn().mockResolvedValue(TREFFER);
    renderMitProviders(<Aufbau suchen={suchen} />);
    expect(screen.getByRole('button', { name: 'Ort suchen' })).toBeDisabled();
    await userEvent.type(screen.getByRole('textbox', { name: 'Einsatzort' }), 'Ha{Enter}');
    expect(screen.getByRole('button', { name: 'Ort suchen' })).toBeDisabled();
    expect(suchen).not.toHaveBeenCalled();
    await userEvent.type(screen.getByRole('textbox', { name: 'Einsatzort' }), 'u');
    expect(screen.getByRole('button', { name: 'Ort suchen' })).toBeEnabled();
  });

  it('gibt den Fokus nach der Wahl eines Treffers ans Feld zurück', async () => {
    const suchen = vi.fn().mockResolvedValue(TREFFER);
    renderMitProviders(<Aufbau suchen={suchen} />);
    const feld = screen.getByRole('textbox', { name: 'Einsatzort' });
    await userEvent.type(feld, 'Bahnhofstraße 1{Enter}');
    const liste = await screen.findByRole('list', { name: 'Treffer' });
    within(liste).getAllByRole('button')[0].focus();
    await userEvent.keyboard('{Enter}');
    expect(screen.queryByRole('list', { name: 'Treffer' })).not.toBeInTheDocument();
    expect(feld).toHaveFocus();
  });

  it('Escape schließt zuerst nur die Trefferliste und meldet sie als Popup', async () => {
    const suchen = vi.fn().mockResolvedValue(TREFFER);
    const offen: boolean[] = [];
    function MitPopup() {
      const [wert, setWert] = useState<OrtsfeldWert>({ text: '', koordinate: null });
      return (
        <div
          onKeyDown={(e) => {
            // Wie der Fenster-Handler des Erfassungsdialogs: ein behandeltes Escape bleibt liegen.
            if (e.key === 'Escape' && !e.defaultPrevented) offen.push(false);
          }}
        >
          <Ortsfeld
            aria-label="Einsatzort"
            value={wert}
            onChange={setWert}
            onOpenChange={(o) => offen.push(o)}
            suchen={suchen}
            suchSchluessel={(b) => einsatzKeys.einsatzortSuche(7, b)}
          />
        </div>
      );
    }
    renderMitProviders(<MitPopup />);
    const feld = screen.getByRole('textbox', { name: 'Einsatzort' });
    await userEvent.type(feld, 'Bahnhofstraße 1{Enter}');
    await screen.findByRole('list', { name: 'Treffer' });
    expect(offen).toEqual([true]);
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('list', { name: 'Treffer' })).not.toBeInTheDocument();
    // Gemeldet „zu“, und das Escape ist behandelt: kein zweites `false` vom äußeren Handler.
    expect(offen).toEqual([true, false]);
    expect(feld).toHaveValue('Bahnhofstraße 1');
  });

  it('setzt mit dem Treffer Kurzadresse und Koordinate, ohne Kurzadresse den Namen', async () => {
    const suchen = vi.fn().mockResolvedValue(TREFFER);
    renderMitProviders(<Aufbau suchen={suchen} />);
    await userEvent.type(
      screen.getByRole('textbox', { name: 'Einsatzort' }),
      'Bahnhofstraße 1{Enter}',
    );
    const liste = await screen.findByRole('list', { name: 'Treffer' });
    await userEvent.click(
      within(liste).getByRole('button', { name: /Bahnhofstraße 1, 12345 Musterstadt/ }),
    );
    expect(wert()).toEqual({
      text: 'Bahnhofstraße 1, 12345 Musterstadt',
      koordinate: { lat: 51.1, lon: 10.4 },
      quelle: 'adresse',
    });
    expect(screen.queryByRole('list', { name: 'Treffer' })).not.toBeInTheDocument();

    // Zweite Suche, Treffer ohne Kurzadresse: der Name des Geocoders wird der Text.
    await userEvent.click(screen.getByRole('button', { name: 'Ort suchen' }));
    const liste2 = await screen.findByRole('list', { name: 'Treffer' });
    await userEvent.click(within(liste2).getByRole('button', { name: /Anderswo/ }));
    expect(wert()).toEqual({
      text: 'Bahnhofstraße 1, Anderswo',
      koordinate: { lat: 48.1, lon: 11.5 },
      quelle: 'adresse',
    });
  });

  it('verwirft Koordinate und Treffer, sobald der Text sich ändert', async () => {
    const suchen = vi.fn().mockResolvedValue(TREFFER);
    renderMitProviders(<Aufbau suchen={suchen} />);
    const feld = screen.getByRole('textbox', { name: 'Einsatzort' });
    await userEvent.type(feld, 'Bahnhofstraße 1{Enter}');
    const liste = await screen.findByRole('list', { name: 'Treffer' });
    await userEvent.click(within(liste).getAllByRole('button')[0]);
    await userEvent.type(feld, ' (Hinterhof)');
    expect(wert()).toEqual({
      text: 'Bahnhofstraße 1, 12345 Musterstadt (Hinterhof)',
      koordinate: null,
    });

    // Offene Treffer verschwinden beim Weitertippen.
    await userEvent.type(feld, '{Enter}');
    expect(await screen.findByRole('list', { name: 'Treffer' })).toBeInTheDocument();
    await userEvent.type(feld, 'x');
    expect(screen.queryByRole('list', { name: 'Treffer' })).not.toBeInTheDocument();
  });

  it.each([
    ['ausgelastet', 'Adresssuche ausgelastet'],
    ['nicht_erreichbar', 'Adresssuche nicht erreichbar'],
  ] as const)('sagt am Feld „%s“ und bietet „Erneut suchen“', async (zustand, text) => {
    const suchen = vi
      .fn()
      .mockResolvedValueOnce({ zustand, treffer: [] })
      .mockResolvedValueOnce(TREFFER);
    renderMitProviders(<Aufbau suchen={suchen} />);
    await userEvent.type(
      screen.getByRole('textbox', { name: 'Einsatzort' }),
      'Bahnhofstraße 1{Enter}',
    );
    expect(await screen.findByText(text)).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Treffer' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Erneut suchen' }));
    expect(await screen.findByRole('list', { name: 'Treffer' })).toBeInTheDocument();
    expect(suchen).toHaveBeenCalledTimes(2);
  });

  it('sagt „Adresssuche nicht erreichbar“ auch bei einem Fehler der Anfrage', async () => {
    const suchen = vi.fn().mockRejectedValue(new Error('500'));
    renderMitProviders(<Aufbau suchen={suchen} />);
    await userEvent.type(
      screen.getByRole('textbox', { name: 'Einsatzort' }),
      'Bahnhofstraße 1{Enter}',
    );
    expect(await screen.findByText('Adresssuche nicht erreichbar')).toBeInTheDocument();
  });

  it('nennt eine leere Antwort beim Namen', async () => {
    const suchen = vi.fn().mockResolvedValue({ zustand: 'ok', treffer: [] });
    renderMitProviders(<Aufbau suchen={suchen} />);
    await userEvent.type(
      screen.getByRole('textbox', { name: 'Einsatzort' }),
      'Hauptstraße 999{Enter}',
    );
    expect(
      await screen.findByText('Keine Adresse zu „Hauptstraße 999“ gefunden'),
    ).toBeInTheDocument();
  });

  it('sperrt die Suche ohne Netz und lässt Freitext zu', async () => {
    const suchen = vi.fn().mockResolvedValue(TREFFER);
    renderMitProviders(<Aufbau suchen={suchen} />);
    act(() => setzeOnline(false));
    const feld = screen.getByRole('textbox', { name: 'Einsatzort' });
    await userEvent.type(feld, 'Hauptstraße 12{Enter}');
    expect(screen.getByRole('button', { name: 'Ort suchen' })).toBeDisabled();
    expect(screen.getByText('Adresssuche ohne Netz nicht verfügbar')).toBeInTheDocument();
    expect(suchen).not.toHaveBeenCalled();
    expect(wert()).toEqual({ text: 'Hauptstraße 12', koordinate: null });
  });

  it('zeigt während der Suche einen Ladezustand', async () => {
    let erfuellen: (a: OrtSucheAntwort) => void = () => {};
    const suchen = vi.fn(
      () =>
        new Promise<OrtSucheAntwort>((r) => {
          erfuellen = r;
        }),
    );
    renderMitProviders(<Aufbau suchen={suchen} />);
    fireEvent.change(screen.getByRole('textbox', { name: 'Einsatzort' }), {
      target: { value: 'Bahnhofstraße 1' },
    });
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Einsatzort' }), { key: 'Enter' });
    expect(await screen.findByText('Sucht …')).toBeInTheDocument();
    act(() => erfuellen(TREFFER));
    await waitFor(() => expect(screen.queryByText('Sucht …')).not.toBeInTheDocument());
  });
});
