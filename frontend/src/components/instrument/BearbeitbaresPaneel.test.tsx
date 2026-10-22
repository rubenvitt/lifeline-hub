import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Button, Input, InputNumber } from 'antd';
import { useRef, useState } from 'react';
import { Link, Route, Routes } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../api/client';
import { renderMitProviders } from '../../test/utils';
import { OffeneBearbeitungProvider } from '../offeneBearbeitung';
import BearbeitbaresPaneel, {
  bearbeitetePatch,
  type BearbeitbaresFeld,
  type BearbeitbaresPaneelProps,
} from './BearbeitbaresPaneel';

/**
 * Baustein „Bearbeiten in der Ansicht“ (LLH-1139, `frontend/AGENTS.md`, „Bearbeiten in der
 * Ansicht“; Spec `formularseiten`, „Eine offene Bearbeitung je Ansicht“).
 *
 * Mutationsproben (von Hand, je rot gesehen, dann zurückgedreht):
 * - Patch aus allen Feldern statt nur den geänderten: rot in „schickt nur geänderte Felder“.
 * - Basis aus dem aktuellen `datensatz` statt aus der Sitzung: rot in „Basis bleibt eingefroren“.
 * - 409 wie jeder Fehler behandelt: rot in „Konflikt fragt nach“.
 * - `melde('offen')` beim Öffnen entfernt: rot in „zweites Paneel gesperrt, mit Grund“.
 * - Escape-Zweig entfernt: rot in „Escape bricht ab“.
 * - Fokusrückgabe entfernt: rot in „Umschalten“ (Fokus zurück auf „Bearbeiten“).
 */

interface Funk {
  rufname: string;
  kanal: number | null;
}

const FUNK: Funk = { rufname: 'Florian 1', kanal: 41 };

function funkFelder(w: Funk): BearbeitbaresFeld<Funk>[] {
  return [
    {
      name: 'rufname',
      label: 'Rufname',
      anzeige: w.rufname,
      eingabe: <Input />,
      regeln: [{ required: true, whitespace: true, message: 'Bitte einen Rufnamen angeben' }],
    },
    {
      name: 'kanal',
      label: 'Kanal',
      anzeige: w.kanal ?? '—',
      eingabe: <InputNumber />,
      mono: true,
    },
  ];
}

type FunkProps = Partial<BearbeitbaresPaneelProps<Funk>>;

function FunkPaneel(props: FunkProps) {
  const werte = props.werte ?? FUNK;
  return (
    <BearbeitbaresPaneel<Funk>
      titel="Funk"
      datensatz={{ geaendert_at: '2026-10-22T10:00:00' }}
      werte={werte}
      felder={funkFelder(werte)}
      onSpeichern={async () => undefined}
      darfSchreiben
      {...props}
    />
  );
}

function TelefonPaneel() {
  return (
    <BearbeitbaresPaneel<{ nummer: string }>
      titel="Telefon"
      datensatz={{ geaendert_at: '2026-10-22T10:00:00' }}
      werte={{ nummer: '0511 1' }}
      felder={[{ name: 'nummer', label: 'Nummer', anzeige: '0511 1', eingabe: <Input /> }]}
      onSpeichern={async () => undefined}
      darfSchreiben
    />
  );
}

function rendern(ui: React.ReactElement) {
  return renderMitProviders(ui, { datenRouter: true });
}

describe('BearbeitbaresPaneel · Umschalten', () => {
  it('zeigt die Werte, schaltet nur dieses Paneel auf Eingaben und zurück, Fokus hin und zurück', async () => {
    const user = userEvent.setup();
    rendern(<FunkPaneel />);
    const paneel = screen.getByRole('region', { name: 'Funk' });
    expect(within(paneel).getByText('Florian 1')).toBeInTheDocument();
    expect(within(paneel).queryByRole('textbox')).toBeNull();

    const bearbeiten = within(paneel).getByRole('button', { name: 'Funk bearbeiten' });
    await user.click(bearbeiten);
    const rufname = await screen.findByRole('textbox', { name: 'Rufname' });
    expect(rufname).toHaveValue('Florian 1');
    expect(screen.getByRole('spinbutton', { name: 'Kanal' })).toHaveValue('41');
    // Die Etiketten bleiben die Begriffe des Rasters.
    expect(screen.getByText('Rufname').closest('dt')).not.toBeNull();
    await waitFor(() => expect(rufname).toHaveFocus());
    expect(screen.queryByRole('button', { name: 'Funk bearbeiten' })).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Abbrechen' }));
    expect(screen.queryByRole('textbox', { name: 'Rufname' })).toBeNull();
    expect(screen.getByText('Florian 1')).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Funk bearbeiten' })).toHaveFocus(),
    );
  });

  it('Abbrechen verwirft die Eingabe: beim nächsten Öffnen steht wieder der gespeicherte Wert', async () => {
    const user = userEvent.setup();
    rendern(<FunkPaneel />);
    await user.click(screen.getByRole('button', { name: 'Funk bearbeiten' }));
    const rufname = await screen.findByRole('textbox', { name: 'Rufname' });
    await user.clear(rufname);
    await user.type(rufname, 'Florian 9');
    await user.click(screen.getByRole('button', { name: 'Abbrechen' }));
    await user.click(screen.getByRole('button', { name: 'Funk bearbeiten' }));
    expect(await screen.findByRole('textbox', { name: 'Rufname' })).toHaveValue('Florian 1');
  });
});

describe('BearbeitbaresPaneel · Speichern', () => {
  it('schickt nur geänderte Felder mit der Basis der Sitzung und schließt', async () => {
    const user = userEvent.setup();
    const onSpeichern = vi.fn(async () => undefined);
    rendern(<FunkPaneel onSpeichern={onSpeichern} />);
    await user.click(screen.getByRole('button', { name: 'Funk bearbeiten' }));
    const kanal = await screen.findByRole('spinbutton', { name: 'Kanal' });
    await user.clear(kanal);
    await user.type(kanal, '42');
    await user.click(screen.getByRole('button', { name: 'Speichern' }));
    await waitFor(() => expect(onSpeichern).toHaveBeenCalledTimes(1));
    expect(onSpeichern).toHaveBeenCalledWith({ kanal: 42 }, '2026-10-22T10:00:00');
    await waitFor(() => expect(screen.queryByRole('spinbutton')).toBeNull());
  });

  it('ohne Änderung kein Aufruf, das Paneel schließt', async () => {
    const user = userEvent.setup();
    const onSpeichern = vi.fn(async () => undefined);
    rendern(<FunkPaneel onSpeichern={onSpeichern} />);
    await user.click(screen.getByRole('button', { name: 'Funk bearbeiten' }));
    await user.click(await screen.findByRole('button', { name: 'Speichern' }));
    await waitFor(() => expect(screen.queryByRole('textbox')).toBeNull());
    expect(onSpeichern).not.toHaveBeenCalled();
  });

  it('Basis bleibt eingefroren, auch wenn der Datensatz im Hintergrund neuer wird', async () => {
    const user = userEvent.setup();
    const onSpeichern = vi.fn(async () => undefined);
    const { rerender } = rendern(<FunkPaneel onSpeichern={onSpeichern} />);
    await user.click(screen.getByRole('button', { name: 'Funk bearbeiten' }));
    const rufname = await screen.findByRole('textbox', { name: 'Rufname' });
    rerender(
      <FunkPaneel
        onSpeichern={onSpeichern}
        datensatz={{ geaendert_at: '2026-10-22T10:05:00' }}
        werte={{ rufname: 'Florian 2', kanal: 41 }}
      />,
    );
    // Die Eingabe bleibt die der Sitzung, kein Nachziehen unter der Hand.
    expect(rufname).toHaveValue('Florian 1');
    await user.clear(rufname);
    await user.type(rufname, 'Florian 3');
    await user.click(screen.getByRole('button', { name: 'Speichern' }));
    await waitFor(() =>
      expect(onSpeichern).toHaveBeenCalledWith({ rufname: 'Florian 3' }, '2026-10-22T10:00:00'),
    );
  });

  it('zeigt den Prüffehler sichtbar unter der Zelle und sendet nicht', async () => {
    const user = userEvent.setup();
    const onSpeichern = vi.fn(async () => undefined);
    rendern(<FunkPaneel onSpeichern={onSpeichern} />);
    await user.click(screen.getByRole('button', { name: 'Funk bearbeiten' }));
    await user.clear(await screen.findByRole('textbox', { name: 'Rufname' }));
    await user.click(screen.getByRole('button', { name: 'Speichern' }));
    const meldung = await screen.findByText('Bitte einen Rufnamen angeben');
    expect(meldung).toBeVisible();
    expect(meldung.closest('[data-lfh="datenfeld"]')).toBe(
      screen.getByText('Rufname').closest('[data-lfh="datenfeld"]'),
    );
    expect(screen.getByRole('textbox', { name: 'Rufname' })).toHaveAttribute(
      'aria-invalid',
      'true',
    );
    expect(onSpeichern).not.toHaveBeenCalled();
  });

  it('eine Ablehnung steht am Paneel, die Eingabe bleibt offen', async () => {
    const user = userEvent.setup();
    const onSpeichern = vi.fn(async () => {
      throw new ApiError(422, 'Kanal unbekannt');
    });
    rendern(<FunkPaneel onSpeichern={onSpeichern} />);
    await user.click(screen.getByRole('button', { name: 'Funk bearbeiten' }));
    const kanal = await screen.findByRole('spinbutton', { name: 'Kanal' });
    await user.clear(kanal);
    await user.type(kanal, '99');
    await user.click(screen.getByRole('button', { name: 'Speichern' }));
    expect(await screen.findByText('Kanal unbekannt')).toBeVisible();
    expect(screen.getByRole('spinbutton', { name: 'Kanal' })).toHaveValue('99');
  });
});

describe('BearbeitbaresPaneel · Konflikt', () => {
  it('Konflikt fragt nach: „Meine Änderung übernehmen“ sendet ohne Basis', async () => {
    const user = userEvent.setup();
    const onSpeichern = vi
      .fn<(patch: Partial<Funk>, basis: string | undefined) => Promise<unknown>>()
      .mockRejectedValueOnce(new ApiError(409, 'geändert'))
      .mockResolvedValueOnce(undefined);
    rendern(<FunkPaneel onSpeichern={onSpeichern} />);
    await user.click(screen.getByRole('button', { name: 'Funk bearbeiten' }));
    const kanal = await screen.findByRole('spinbutton', { name: 'Kanal' });
    await user.clear(kanal);
    await user.type(kanal, '43');
    await user.click(screen.getByRole('button', { name: 'Speichern' }));
    const dialog = await screen.findByRole('dialog', { name: 'Zwischenzeitlich geändert' });
    await user.click(within(dialog).getByRole('button', { name: 'Meine Änderung übernehmen' }));
    await waitFor(() => expect(onSpeichern).toHaveBeenCalledTimes(2));
    expect(onSpeichern).toHaveBeenLastCalledWith({ kanal: 43 }, undefined);
    await waitFor(() => expect(screen.queryByRole('spinbutton')).toBeNull());
  });

  it('„Verwerfen und neu laden“ schließt und lädt neu', async () => {
    const user = userEvent.setup();
    const onNeuLaden = vi.fn();
    rendern(
      <FunkPaneel
        onSpeichern={async () => {
          throw new ApiError(409, 'geändert');
        }}
        onNeuLaden={onNeuLaden}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Funk bearbeiten' }));
    const kanal = await screen.findByRole('spinbutton', { name: 'Kanal' });
    await user.clear(kanal);
    await user.type(kanal, '43');
    await user.click(screen.getByRole('button', { name: 'Speichern' }));
    const dialog = await screen.findByRole('dialog', { name: 'Zwischenzeitlich geändert' });
    await user.click(within(dialog).getByRole('button', { name: 'Verwerfen und neu laden' }));
    expect(onNeuLaden).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByRole('spinbutton')).toBeNull());
  });
});

describe('BearbeitbaresPaneel · eine offene Bearbeitung je Seite', () => {
  it('zweites Paneel gesperrt, mit Grund; nach dem Abbrechen wieder frei', async () => {
    const user = userEvent.setup();
    rendern(
      <OffeneBearbeitungProvider>
        <FunkPaneel />
        <TelefonPaneel />
      </OffeneBearbeitungProvider>,
    );
    await user.click(screen.getByRole('button', { name: 'Funk bearbeiten' }));
    const telefon = screen.getByRole('button', { name: 'Telefon bearbeiten' });
    expect(telefon).toBeDisabled();
    expect(telefon).toHaveAccessibleDescription('Erst „Funk“ speichern oder abbrechen');
    expect(screen.getByText('Erst „Funk“ speichern oder abbrechen')).toBeVisible();

    await user.click(screen.getByRole('button', { name: 'Abbrechen' }));
    expect(screen.getByRole('button', { name: 'Telefon bearbeiten' })).toBeEnabled();
    expect(screen.queryByText('Erst „Funk“ speichern oder abbrechen')).toBeNull();
  });

  it('ohne Schreibrecht gesperrt mit Grund; ohne Grund kein Knopf', () => {
    const { unmount } = rendern(<FunkPaneel darfSchreiben={false} grund="Einsatz abgeschlossen" />);
    const knopf = screen.getByRole('button', { name: 'Funk bearbeiten' });
    expect(knopf).toBeDisabled();
    expect(knopf).toHaveAccessibleDescription('Einsatz abgeschlossen');
    unmount();
    rendern(<FunkPaneel darfSchreiben={false} />);
    expect(screen.queryByRole('button', { name: 'Funk bearbeiten' })).toBeNull();
  });
});

describe('BearbeitbaresPaneel · Verlassen-Schutz', () => {
  function Seite() {
    return (
      <Routes>
        <Route
          path="/"
          element={
            <>
              <FunkPaneel />
              <Link to="/anderswo">Anderswo</Link>
            </>
          }
        />
        <Route path="/anderswo" element={<div>ANDERSWO</div>} />
      </Routes>
    );
  }

  it('fragt mit geänderter Eingabe, auch ohne Merker der Seite', async () => {
    const user = userEvent.setup();
    rendern(<Seite />);
    await user.click(screen.getByRole('button', { name: 'Funk bearbeiten' }));
    await user.type(await screen.findByRole('textbox', { name: 'Rufname' }), 'x');
    await user.click(screen.getByRole('link', { name: 'Anderswo' }));
    await screen.findByRole('dialog', { name: 'Ungespeicherte Änderungen' });
    await user.click(screen.getByRole('button', { name: 'Bleiben' }));
    expect(screen.getByRole('textbox', { name: 'Rufname' })).toHaveValue('Florian 1x');
  });

  it('offen ohne Änderung fragt nicht', async () => {
    const user = userEvent.setup();
    rendern(<Seite />);
    await user.click(screen.getByRole('button', { name: 'Funk bearbeiten' }));
    await screen.findByRole('textbox', { name: 'Rufname' });
    await user.click(screen.getByRole('link', { name: 'Anderswo' }));
    expect(await screen.findByText('ANDERSWO')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('nach dem Speichern frei', async () => {
    const user = userEvent.setup();
    rendern(<Seite />);
    await user.click(screen.getByRole('button', { name: 'Funk bearbeiten' }));
    await user.type(await screen.findByRole('textbox', { name: 'Rufname' }), 'x');
    await user.click(screen.getByRole('button', { name: 'Speichern' }));
    await screen.findByRole('button', { name: 'Funk bearbeiten' });
    await user.click(screen.getByRole('link', { name: 'Anderswo' }));
    expect(await screen.findByText('ANDERSWO')).toBeInTheDocument();
  });
});

describe('BearbeitbaresPaneel · Tastaturweg', () => {
  it('Enter speichert', async () => {
    const user = userEvent.setup();
    const onSpeichern = vi.fn(async () => undefined);
    rendern(<FunkPaneel onSpeichern={onSpeichern} />);
    await user.click(screen.getByRole('button', { name: 'Funk bearbeiten' }));
    const rufname = await screen.findByRole('textbox', { name: 'Rufname' });
    await user.type(rufname, 'x{Enter}');
    await waitFor(() =>
      expect(onSpeichern).toHaveBeenCalledWith({ rufname: 'Florian 1x' }, '2026-10-22T10:00:00'),
    );
  });

  it('Escape bricht ab und sendet nichts', async () => {
    const user = userEvent.setup();
    const onSpeichern = vi.fn(async () => undefined);
    rendern(<FunkPaneel onSpeichern={onSpeichern} />);
    await user.click(screen.getByRole('button', { name: 'Funk bearbeiten' }));
    const rufname = await screen.findByRole('textbox', { name: 'Rufname' });
    await user.type(rufname, 'x');
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('textbox', { name: 'Rufname' })).toBeNull();
    expect(onSpeichern).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Funk bearbeiten' })).toHaveFocus(),
    );
  });
});

describe('BearbeitbaresPaneel · Modus „ansicht“', () => {
  function Ansicht({ onSpeichern }: { onSpeichern: (p: Partial<Funk>) => Promise<unknown> }) {
    const [offen, setOffen] = useState(false);
    const knopf = useRef<HTMLButtonElement>(null);
    return (
      <>
        {!offen && (
          <>
            <p>Lesefassung Florian 1</p>
            <Button ref={knopf} onClick={() => setOffen(true)}>
              Ändern
            </Button>
          </>
        )}
        <FunkPaneel
          modus="ansicht"
          offen={offen}
          onOffenAenderung={setOffen}
          ausloeserRef={knopf}
          onSpeichern={onSpeichern}
        />
      </>
    );
  }

  it('der Aufrufer öffnet, die Leiste klebt unten, Speichern schließt und gibt den Fokus zurück', async () => {
    const user = userEvent.setup();
    const onSpeichern = vi.fn(async () => undefined);
    rendern(<Ansicht onSpeichern={onSpeichern} />);
    expect(screen.queryByRole('region', { name: 'Funk' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Ändern' }));
    const rufname = await screen.findByRole('textbox', { name: 'Rufname' });
    await waitFor(() => expect(rufname).toHaveFocus());
    const leiste = screen.getByRole('button', { name: 'Speichern' }).parentElement!;
    expect(leiste).toHaveAttribute('data-lfh', 'speicherleiste');
    await user.type(rufname, 'x');
    await user.click(screen.getByRole('button', { name: 'Speichern' }));
    await waitFor(() =>
      expect(onSpeichern).toHaveBeenCalledWith({ rufname: 'Florian 1x' }, '2026-10-22T10:00:00'),
    );
    expect(await screen.findByText('Lesefassung Florian 1')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Ändern' })).toHaveFocus());
  });
});

describe('bearbeitetePatch', () => {
  it('nimmt nur geänderte Schlüssel, Werte gleich nach Inhalt', () => {
    expect(
      bearbeitetePatch({ a: 1, b: 'x', c: { d: 1 } }, { a: 1, b: 'y', c: { d: 1 } }, [
        'a',
        'b',
        'c',
      ]),
    ).toEqual({ b: 'y' });
    expect(bearbeitetePatch({ a: 1 }, { a: 1 }, ['a'])).toEqual({});
  });
});
