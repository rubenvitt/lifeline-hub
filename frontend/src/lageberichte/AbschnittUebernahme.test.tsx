import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Form, Input } from 'antd';
import { renderMitProviders } from '../test/utils';
import { ladeModulFreigaben } from '../api/einsaetze';
import { freigabenFixture } from '../test/fixtures';
import AbschnittUebernahme from './AbschnittUebernahme';
import type { UebernahmeQuelle } from './uebernahmeQuelle';
import { EIGENE_LAGE_QUELLE } from './eigeneLageUebernahme';

vi.mock('../api/einsaetze', () => ({ ladeModulFreigaben: vi.fn() }));

const erzeuge = vi.fn<UebernahmeQuelle['erzeuge']>();
const geaendert = vi.fn();

/** Eine Quelle, die am Modul `etb` hängt — der Baustein kennt keine Fachlichkeit. */
const PROBE_QUELLE: UebernahmeQuelle = {
  knopf: 'Aus Probe übernehmen',
  unterzeile: 'Probedaten',
  ersetzenTitel: 'Probe ersetzen?',
  ersetzenText: 'Der Abschnitt enthält schon Text.',
  verfuegbar: (freigaben) =>
    freigaben.etb?.zugriff ? { frei: true } : { frei: false, grund: 'ETB nicht freigegeben' },
  erzeuge,
};

function Probe({
  start = '',
  quelle = PROBE_QUELLE,
}: {
  start?: string;
  quelle?: UebernahmeQuelle;
}) {
  const [form] = Form.useForm();
  return (
    <Form form={form} initialValues={{ probe: start }}>
      <AbschnittUebernahme
        quelle={quelle}
        einsatzId={1}
        form={form}
        feld="probe"
        onGeaendert={geaendert}
      />
      <Form.Item name="probe" label="Probe">
        <Input.TextArea />
      </Form.Item>
    </Form>
  );
}

const feld = () => screen.getByLabelText('Probe') as HTMLTextAreaElement;

beforeEach(() => {
  geaendert.mockReset();
  erzeuge.mockReset();
  erzeuge.mockResolvedValue('# Übernommen');
  vi.mocked(ladeModulFreigaben).mockReset();
  vi.mocked(ladeModulFreigaben).mockResolvedValue(freigabenFixture());
});

describe('AbschnittUebernahme (LFH-870)', () => {
  it('lädt erst beim Klick und füllt einen leeren Abschnitt ohne Rückfrage', async () => {
    renderMitProviders(<Probe />);
    const knopf = await screen.findByRole('button', { name: 'Aus Probe übernehmen' });
    expect(erzeuge).not.toHaveBeenCalled();
    expect(screen.getByText('Probedaten')).toBeInTheDocument();
    await userEvent.click(knopf);
    await waitFor(() => expect(feld().value).toBe('# Übernommen'));
    expect(erzeuge).toHaveBeenCalledWith(
      expect.objectContaining({ einsatzId: 1, freigaben: freigabenFixture() }),
    );
    expect(geaendert).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('ersetzt einen gefüllten Abschnitt erst nach Rückfrage', async () => {
    renderMitProviders(<Probe start="Eigener Text" />);
    await userEvent.click(await screen.findByRole('button', { name: 'Aus Probe übernehmen' }));
    const dialog = await screen.findByRole('dialog', { name: 'Probe ersetzen?' });
    expect(feld().value).toBe('Eigener Text');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Ersetzen' }));
    await waitFor(() => expect(feld().value).toBe('# Übernommen'));
    expect(geaendert).toHaveBeenCalledTimes(1);
  });

  it('lässt den Text bei „Abbrechen“ stehen', async () => {
    renderMitProviders(<Probe start="Eigener Text" />);
    await userEvent.click(await screen.findByRole('button', { name: 'Aus Probe übernehmen' }));
    await userEvent.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Abbrechen' }),
    );
    expect(feld().value).toBe('Eigener Text');
    expect(geaendert).not.toHaveBeenCalled();
  });

  it('zeigt bei gesperrter Quelle einen Hinweis mit Grund statt des Knopfes', async () => {
    vi.mocked(ladeModulFreigaben).mockResolvedValue(freigabenFixture({ etb: { zugriff: false } }));
    renderMitProviders(<Probe />);
    expect(
      await screen.findByText('Aus Probe übernehmen nicht verfügbar: ETB nicht freigegeben'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Aus Probe übernehmen' })).toBeNull();
  });

  it('sagt es, wenn die Freigaben nicht ermittelbar sind', async () => {
    vi.mocked(ladeModulFreigaben).mockRejectedValue(new Error('Netz weg'));
    renderMitProviders(<Probe />);
    expect(
      await screen.findByText(
        'Aus Probe übernehmen nicht verfügbar: Freigaben nicht ermittelbar',
        {},
        { timeout: 5000 },
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Aus Probe übernehmen' })).toBeNull();
  });

  it('zeigt weder Knopf noch Hinweis, solange die Freigaben laden', async () => {
    vi.mocked(ladeModulFreigaben).mockReturnValue(new Promise(() => {}));
    renderMitProviders(<Probe />);
    await screen.findByLabelText('Probe');
    expect(screen.queryByRole('button', { name: 'Aus Probe übernehmen' })).toBeNull();
    expect(screen.queryByText(/nicht verfügbar/)).toBeNull();
  });

  it('erklärt im Abschnitt „Eigene Lage“, welche Freigaben fehlen, wenn kein Teil frei ist', async () => {
    vi.mocked(ladeModulFreigaben).mockResolvedValue(
      freigabenFixture({ einsatzabschnitte: { zugriff: false } }),
    );
    renderMitProviders(<Probe quelle={EIGENE_LAGE_QUELLE} />);
    expect(
      await screen.findByText(
        'Aus Meldebild und Führungsorganisation übernehmen nicht verfügbar: ' +
          'Kräftemeldebild nicht freigegeben (Abschnitte), ' +
          'Führungsorganisation nicht freigegeben (Abschnitte)',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
  });
});
