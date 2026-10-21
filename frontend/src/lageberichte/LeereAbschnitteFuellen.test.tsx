import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Form, Input, type FormInstance } from 'antd';
import { ladeModulFreigaben } from '../api/einsaetze';
import { freigabenFixture } from '../test/fixtures';
import { renderMitProviders } from '../test/utils';
import LeereAbschnitteFuellen, { LEERE_FUELLEN } from './LeereAbschnitteFuellen';
import type { UebernahmeQuelle } from './uebernahmeQuelle';
import { standFeld } from './standFeld';

vi.mock('../api/einsaetze', () => ({ ladeModulFreigaben: vi.fn() }));

const geaendert = vi.fn();

function probe(text: string): UebernahmeQuelle {
  return {
    knopf: `Aus ${text} übernehmen`,
    ersetzenTitel: `${text} ersetzen?`,
    ersetzenText: 'Vorhandener Text wird ersetzt.',
    verfuegbar: () => ({ frei: true }),
    erzeuge: vi.fn<UebernahmeQuelle['erzeuge']>().mockResolvedValue(`# ${text}`),
  };
}

let QUELLEN: Record<string, UebernahmeQuelle>;

/** Drei Abschnitte mit Quelle und einer ohne („auftrag“), wie im Lagevortrag zur Information. */
let formular: FormInstance;

function Probe({ start = {} }: { start?: Record<string, unknown> }) {
  const [form] = Form.useForm();
  formular = form;
  return (
    <Form form={form} initialValues={start}>
      <LeereAbschnitteFuellen quellen={QUELLEN} einsatzId={1} form={form} onGeaendert={geaendert} />
      {['auftrag', 'a', 'b', 'c'].map((s) => (
        <Form.Item key={s} name={s} label={s.toUpperCase()}>
          <Input.TextArea />
        </Form.Item>
      ))}
    </Form>
  );
}

const feld = (name: string) => screen.getByLabelText(name) as HTMLTextAreaElement;

beforeEach(() => {
  geaendert.mockReset();
  QUELLEN = { a: probe('A'), b: probe('B'), c: probe('C') };
  vi.mocked(ladeModulFreigaben).mockReset();
  vi.mocked(ladeModulFreigaben).mockResolvedValue(freigabenFixture());
});

describe('LeereAbschnitteFuellen (LLH-1081)', () => {
  it('füllt nur leere Abschnitte, ändert keinen gefüllten und fragt nicht nach', async () => {
    renderMitProviders(<Probe start={{ a: 'Eigener Text', c: '   ' }} />);
    await userEvent.click(await screen.findByRole('button', { name: LEERE_FUELLEN }));
    await waitFor(() => expect(feld('B').value).toBe('# B'));
    expect(feld('C').value).toBe('# C');
    expect(feld('A').value).toBe('Eigener Text');
    // Ein Abschnitt ohne Quelle bleibt, wie er ist.
    expect(feld('AUFTRAG').value).toBe('');
    // Der gefüllte wird gar nicht erst geladen.
    expect(QUELLEN.a.erzeuge).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
    // Einmal an den Verlustschutz, nicht je Abschnitt.
    expect(geaendert).toHaveBeenCalledTimes(1);
  });

  it('setzt den Stand der Übernahme nur an den gefüllten Abschnitten (LLH-1357)', async () => {
    renderMitProviders(
      <Probe start={{ a: 'Eigener Text', uebernommen_at: { a: '2026-10-20 08:00:00' } }} />,
    );
    await userEvent.click(await screen.findByRole('button', { name: LEERE_FUELLEN }));
    await waitFor(() => expect(feld('C').value).toBe('# C'));
    const stand = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;
    expect(formular.getFieldValue(standFeld('b'))).toMatch(stand);
    expect(formular.getFieldValue(standFeld('c'))).toMatch(stand);
    // Der gefüllte behält seinen, der ohne Quelle bekommt keinen.
    expect(formular.getFieldValue(standFeld('a'))).toBe('2026-10-20 08:00:00');
    expect(formular.getFieldValue(standFeld('auftrag'))).toBeUndefined();
  });

  it('lässt Text stehen, der während des Ladens geschrieben wurde', async () => {
    let gib: (text: string) => void = () => {};
    vi.mocked(QUELLEN.b.erzeuge).mockReturnValue(new Promise<string>((r) => (gib = r)));
    renderMitProviders(<Probe start={{ a: 'Eigener Text' }} />);
    await userEvent.click(await screen.findByRole('button', { name: LEERE_FUELLEN }));
    await userEvent.type(feld('B'), 'Getippt');
    gib('# B');
    await waitFor(() => expect(feld('C').value).toBe('# C'));
    expect(feld('B').value).toBe('Getippt');
    expect(geaendert).toHaveBeenCalledTimes(1);
  });

  it('fehlt, wenn jeder Abschnitt mit Quelle Text trägt, auch wenn einer ohne Quelle leer ist', async () => {
    renderMitProviders(<Probe start={{ a: 'x', b: 'y', c: 'z' }} />);
    await screen.findByLabelText('A');
    expect(screen.queryByRole('button', { name: LEERE_FUELLEN })).toBeNull();
  });

  it('meldet nichts an den Verlustschutz, wenn nichts mehr leer ist, wenn die Texte kommen', async () => {
    let gib: (text: string) => void = () => {};
    vi.mocked(QUELLEN.c.erzeuge).mockReturnValue(new Promise<string>((r) => (gib = r)));
    renderMitProviders(<Probe start={{ a: 'x', b: 'y' }} />);
    await userEvent.click(await screen.findByRole('button', { name: LEERE_FUELLEN }));
    await userEvent.type(feld('C'), 'Eigenes');
    gib('# C');
    await waitFor(() => expect(QUELLEN.c.erzeuge).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 0));
    expect(feld('C').value).toBe('Eigenes');
    expect(geaendert).not.toHaveBeenCalled();
  });
});
