import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Form, Input } from 'antd';
import { renderMitProviders } from '../test/utils';
import { ladeModulFreigaben } from '../api/einsaetze';
import { ladeMedienkontakte, ladePressemitteilungen } from '../api/presse';
import { ladeAnrufe } from '../api/infotelefon';
import { ApiError } from '../api/client';
import type { Medienkontakt } from '../api/types';
import MedienlageUebernahme from './MedienlageUebernahme';
import { freigabenFixture } from '../test/fixtures';

vi.mock('../api/einsaetze', () => ({ ladeModulFreigaben: vi.fn() }));
vi.mock('../api/presse', () => ({ ladeMedienkontakte: vi.fn(), ladePressemitteilungen: vi.fn() }));
vi.mock('../api/infotelefon', () => ({ ladeAnrufe: vi.fn() }));

const KONTAKT = {
  id: 1,
  einsatz_id: 1,
  art: 'anfrage',
  medium: 'NDR 1',
  thema: 'geheimes Thema',
  kontakt_name: 'Maria Beispiel',
  eingang_at: '2026-09-30 10:00:00',
  status: 'offen',
  angelegt_von_id: 1,
  angelegt_at: '2026-09-30 10:00:00',
} as Medienkontakt;

const geaendert = vi.fn();

function Probe({ start = '' }: { start?: string }) {
  const [form] = Form.useForm();
  return (
    <Form form={form} initialValues={{ medienlage: start }}>
      <MedienlageUebernahme einsatzId={1} form={form} feld="medienlage" onGeaendert={geaendert} />
      <Form.Item name="medienlage" label="Medienlage">
        <Input.TextArea />
      </Form.Item>
    </Form>
  );
}

const feld = () => screen.getByLabelText('Medienlage') as HTMLTextAreaElement;

beforeEach(() => {
  geaendert.mockReset();
  vi.mocked(ladeModulFreigaben).mockResolvedValue(freigabenFixture());
  vi.mocked(ladeMedienkontakte).mockResolvedValue([KONTAKT]);
  vi.mocked(ladePressemitteilungen).mockResolvedValue([]);
  vi.mocked(ladeAnrufe).mockResolvedValue([]);
});

describe('MedienlageUebernahme (LFH-554)', () => {
  it('setzt die Medienlage in einen leeren Abschnitt, ohne Personenbezug, und meldet die Änderung', async () => {
    renderMitProviders(<Probe />);
    await userEvent.click(await screen.findByRole('button', { name: 'Aus S5 übernehmen' }));
    await waitFor(() => expect(feld().value).toContain('1 gesamt, davon 1 offen'));
    expect(feld().value).not.toContain('Maria');
    expect(feld().value).not.toContain('geheimes Thema');
    expect(geaendert).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('ersetzt einen gefüllten Abschnitt erst nach Rückfrage', async () => {
    renderMitProviders(<Probe start="Eigener Text" />);
    await userEvent.click(await screen.findByRole('button', { name: 'Aus S5 übernehmen' }));
    const dialog = await screen.findByRole('dialog');
    expect(feld().value).toBe('Eigener Text');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Ersetzen' }));
    await waitFor(() => expect(feld().value).toContain('**Medienkontakte**'));
    expect(geaendert).toHaveBeenCalledTimes(1);
  });

  it('lässt den Text bei „Abbrechen“ stehen', async () => {
    renderMitProviders(<Probe start="Eigener Text" />);
    await userEvent.click(await screen.findByRole('button', { name: 'Aus S5 übernehmen' }));
    await userEvent.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Abbrechen' }),
    );
    expect(feld().value).toBe('Eigener Text');
    expect(geaendert).not.toHaveBeenCalled();
  });

  it('nennt eine gesperrte Quelle mit Grund statt 0', async () => {
    vi.mocked(ladeAnrufe).mockRejectedValue(new ApiError(403, 'verboten'));
    renderMitProviders(<Probe />);
    await userEvent.click(await screen.findByRole('button', { name: 'Aus S5 übernehmen' }));
    await waitFor(() =>
      expect(feld().value).toContain('**Informationstelefon**\n- — (nicht freigegeben)'),
    );
  });

  it('fehlt, wenn der Stab für die Person nicht freigegeben ist', async () => {
    vi.mocked(ladeModulFreigaben).mockResolvedValue(
      freigabenFixture({ stab: { sichtbar: false } }),
    );
    renderMitProviders(<Probe />);
    await waitFor(() => expect(ladeModulFreigaben).toHaveBeenCalled());
    await screen.findByLabelText('Medienlage');
    // Der Abruf muss abgeschlossen sein, sonst wäre die Abwesenheit trivial (Ladezustand).
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByRole('button', { name: 'Aus S5 übernehmen' })).toBeNull();
  });
});
