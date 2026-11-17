import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Button } from 'antd';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../api/client';
import type { FeldVermerk } from '../api/types';
import { renderMitProviders } from '../test/utils';
import { OFFEN_LASSEN } from './InlineAngabe';
import { useFeldKonflikt, VERWORFEN } from './useFeldKonflikt';

/**
 * Der gemeinsame Ablauf „Zwischenzeitlich geändert“ (LLH-1831, Change
 * `nvhnqynd-konflikt-und-aenderungsvermerk`, design.md D6, Spec `formularseiten`, „Einheitlicher
 * Dialog“ und „409 ohne fremde Änderung steht an der Angabe“).
 */
interface Stand {
  bemerkung: string | null;
  vermerke?: Record<string, FeldVermerk>;
}

function Probe(p: {
  speichern: (erwartet: string | null | undefined) => Promise<void>;
  frisch: Stand | undefined;
  onErgebnis: (e: unknown) => void;
  ladeFehler?: Error;
}) {
  const konflikt = useFeldKonflikt();
  const [lauf, setLauf] = useState(0);
  return (
    <Button
      onClick={() => {
        setLauf(lauf + 1);
        konflikt({
          etikett: 'Bemerkung',
          erwartet: 'Tor 1' as string | null,
          speichern: p.speichern,
          ladeFrisch: () =>
            p.ladeFehler ? Promise.reject(p.ladeFehler) : Promise.resolve(p.frisch),
          aktuell: (s: Stand | undefined) =>
            s && { wert: s.bemerkung, vermerk: s.vermerke?.bemerkung },
          text: (w) => w ?? '',
        }).then(p.onErgebnis, p.onErgebnis);
      }}
    >
      Speichern
    </Button>
  );
}

const konflikt409 = () => new ApiError(409, 'Das Feld wurde zwischenzeitlich geändert.');

describe('useFeldKonflikt', () => {
  it('ohne Konflikt: speichert mit Altwert, keine Rückfrage', async () => {
    const speichern = vi.fn().mockResolvedValue(undefined);
    const onErgebnis = vi.fn();
    renderMitProviders(
      <Probe speichern={speichern} frisch={{ bemerkung: 'Tor 1' }} onErgebnis={onErgebnis} />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Speichern' }));
    await waitFor(() => expect(onErgebnis).toHaveBeenCalledWith(undefined));
    expect(speichern).toHaveBeenCalledWith('Tor 1');
    expect(screen.queryByText('Zwischenzeitlich geändert')).not.toBeInTheDocument();
  });

  it('fremde Änderung: Rückfrage nennt Wert, Wer und Wann', async () => {
    const speichern = vi.fn().mockRejectedValueOnce(konflikt409());
    renderMitProviders(
      <Probe
        speichern={speichern}
        frisch={{
          bemerkung: 'Tor 3',
          vermerke: { bemerkung: { at: '2020-01-01 13:05:00', von: 'Anna' } },
        }}
        onErgebnis={vi.fn()}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Speichern' }));
    expect(await screen.findByRole('dialog')).toHaveTextContent('Zwischenzeitlich geändert');
    expect(screen.getByText(/Bemerkung inzwischen: „Tor 3“ \(Anna, .+\)/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Meine Änderung übernehmen' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Verwerfen und neu laden' })).toBeInTheDocument();
  });

  it('„Meine Änderung übernehmen“ speichert ohne Altwert', async () => {
    const speichern = vi.fn().mockRejectedValueOnce(konflikt409()).mockResolvedValueOnce(undefined);
    const onErgebnis = vi.fn();
    renderMitProviders(
      <Probe speichern={speichern} frisch={{ bemerkung: 'Tor 3' }} onErgebnis={onErgebnis} />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Speichern' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Meine Änderung übernehmen' }));
    await waitFor(() => expect(onErgebnis).toHaveBeenCalledWith(undefined));
    expect(speichern).toHaveBeenNthCalledWith(2, undefined);
  });

  it('„Verwerfen und neu laden“ speichert nichts und schließt', async () => {
    const speichern = vi.fn().mockRejectedValueOnce(konflikt409());
    const onErgebnis = vi.fn();
    renderMitProviders(
      <Probe speichern={speichern} frisch={{ bemerkung: 'Tor 3' }} onErgebnis={onErgebnis} />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Speichern' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Verwerfen und neu laden' }));
    // Unterscheidbar vom Erfolg: der Aufrufer meldet nichts als gespeichert.
    await waitFor(() => expect(onErgebnis).toHaveBeenCalledWith(VERWORFEN));
    expect(speichern).toHaveBeenCalledTimes(1);
  });

  it('Escape entscheidet nichts: die Eingabe bleibt offen', async () => {
    const speichern = vi.fn().mockRejectedValueOnce(konflikt409());
    const onErgebnis = vi.fn();
    renderMitProviders(
      <Probe speichern={speichern} frisch={{ bemerkung: 'Tor 3' }} onErgebnis={onErgebnis} />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Speichern' }));
    await screen.findByRole('dialog');
    await act(async () => {
      await userEvent.keyboard('{Escape}');
    });
    await waitFor(() => expect(onErgebnis).toHaveBeenCalledWith(OFFEN_LASSEN));
    expect(speichern).toHaveBeenCalledTimes(1);
  });

  it('409 ohne fremde Änderung: keine Rückfrage, der Fehler geht an die Angabe', async () => {
    const fehler = new ApiError(409, 'Einsatz ist abgeschlossen');
    const speichern = vi.fn().mockRejectedValueOnce(fehler);
    const onErgebnis = vi.fn();
    renderMitProviders(
      <Probe speichern={speichern} frisch={{ bemerkung: 'Tor 1' }} onErgebnis={onErgebnis} />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Speichern' }));
    await waitFor(() => expect(onErgebnis).toHaveBeenCalledWith(fehler));
    expect(screen.queryByText('Zwischenzeitlich geändert')).not.toBeInTheDocument();
  });

  it('scheitert das Neuladen, bleibt der 409 der Grund an der Angabe', async () => {
    const fehler = konflikt409();
    const speichern = vi.fn().mockRejectedValueOnce(fehler);
    const onErgebnis = vi.fn();
    renderMitProviders(
      <Probe
        speichern={speichern}
        frisch={{ bemerkung: 'Tor 3' }}
        ladeFehler={new Error('Netz weg')}
        onErgebnis={onErgebnis}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Speichern' }));
    await waitFor(() => expect(onErgebnis).toHaveBeenCalledWith(fehler));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('gibt es den Datensatz nicht mehr, ist es kein Feldkonflikt', async () => {
    const fehler = konflikt409();
    const speichern = vi.fn().mockRejectedValueOnce(fehler);
    const onErgebnis = vi.fn();
    renderMitProviders(<Probe speichern={speichern} frisch={undefined} onErgebnis={onErgebnis} />);
    await userEvent.click(screen.getByRole('button', { name: 'Speichern' }));
    await waitFor(() => expect(onErgebnis).toHaveBeenCalledWith(fehler));
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
