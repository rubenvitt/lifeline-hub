import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Form } from 'antd';
import type { FormInstance } from 'antd';
import { describe, expect, it, vi } from 'vitest';
import { renderMitProviders } from '../test/utils';
import type { EtbBaustein, EinsatzAnzeige } from '../api/types';
import BausteinPicker from './BausteinPicker';

const einsatz = {
  bezeichnung: 'Hochwasser', stichwort: 'THL', leitstellen_nr: 'LS-1', einsatzort: 'Markt',
} as unknown as EinsatzAnzeige;

function b(p: Partial<EtbBaustein>): EtbBaustein {
  return { id: 1, label: 'B', typ: 'meldung', inhalt: '', meldeweg: null, veranlassung: null, sortier: 0, ...p };
}

function Harness({ bausteine, onForm }: { bausteine: EtbBaustein[]; onForm: (f: FormInstance) => void }) {
  const [form] = Form.useForm();
  onForm(form);
  return (
    <Form form={form}>
      <BausteinPicker form={form} bausteine={bausteine} einsatz={einsatz} />
    </Form>
  );
}

/**
 * Rendert den Picker und spioniert EINMAL auf setFieldsValue (echter Aufruf bleibt erhalten).
 * onForm liefert dieselbe Form-Instanz über Re-Renders; der Spy wird nur beim ersten Mal gesetzt.
 */
function rendere(bausteine: EtbBaustein[]) {
  let form: FormInstance | undefined;
  let spy: ReturnType<typeof vi.spyOn> | undefined;
  renderMitProviders(
    <Harness
      bausteine={bausteine}
      onForm={(f) => {
        form = f;
        if (!spy) spy = vi.spyOn(f, 'setFieldsValue');
      }}
    />,
  );
  return { form: form!, setFieldsValue: spy! };
}

/** antd-Dropdown-Option im Portal anhand des Labels treffen */
async function waehleOption(label: string) {
  const option = (await screen.findAllByText(label)).find((el) => el.closest('.ant-select-item-option'));
  expect(option).toBeTruthy();
  await userEvent.click(option!);
}

describe('BausteinPicker', () => {
  it('setzt Felder sofort, wenn keine manuellen Platzhalter', async () => {
    const { setFieldsValue } = rendere([b({ id: 1, label: 'Lage', inhalt: 'Lage in {einsatzort}.' })]);
    await userEvent.click(screen.getByRole('combobox'));
    await waehleOption('Lage');
    await waitFor(() =>
      expect(setFieldsValue).toHaveBeenCalledWith(expect.objectContaining({ inhalt: 'Lage in Markt.' })),
    );
  });

  it('öffnet Dialog bei manuellen Platzhaltern und setzt nach Eingabe', async () => {
    const { setFieldsValue } = rendere([b({ id: 2, label: 'Eintreffen', inhalt: '{einheit} eingetroffen.' })]);
    await userEvent.click(screen.getByRole('combobox'));
    await waehleOption('Eintreffen');
    const eingabe = await screen.findByRole('textbox');
    await userEvent.type(eingabe, '1. Zug');
    await userEvent.click(screen.getByRole('button', { name: 'Einsetzen' }));
    await waitFor(() =>
      expect(setFieldsValue).toHaveBeenCalledWith(expect.objectContaining({ inhalt: '1. Zug eingetroffen.' })),
    );
  });

  it('verlangt bei gefülltem Inhalt eine Replace-Bestätigung, bevor gesetzt wird', async () => {
    const { form, setFieldsValue } = rendere([b({ id: 3, label: 'Lage', inhalt: 'Lage in {einsatzort}.' })]);
    form.setFieldsValue({ inhalt: 'Alt' });
    setFieldsValue.mockClear();

    await userEvent.click(screen.getByRole('combobox'));
    await waehleOption('Lage');

    // Dialog erscheint trotz fehlender manueller Platzhalter, weil inhalt gefüllt ist.
    await userEvent.click(await screen.findByRole('button', { name: 'Einsetzen' }));
    // Noch nicht gesetzt — erst der Popconfirm muss bestätigt werden.
    expect(setFieldsValue).not.toHaveBeenCalled();

    const popup = await screen.findByRole('tooltip');
    await userEvent.click(within(popup).getByRole('button', { name: 'OK' }));
    await waitFor(() =>
      expect(setFieldsValue).toHaveBeenCalledWith(expect.objectContaining({ inhalt: 'Lage in Markt.' })),
    );
  });
});
