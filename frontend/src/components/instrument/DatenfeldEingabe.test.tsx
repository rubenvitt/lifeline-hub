import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Button, Form, Input, InputNumber } from 'antd';
import { describe, expect, it, vi } from 'vitest';
import { renderMitProviders } from '../../test/utils';
import { Select } from '../Select';
import Datenraster from './Datenraster';
import DatenfeldEingabe from './DatenfeldEingabe';

function Maske({ onFinish = () => {} }: { onFinish?: (werte: unknown) => void }) {
  return (
    <Form onFinish={onFinish} scrollToFirstError={{ focus: true }}>
      <Datenraster beschriftung="Daten">
        <DatenfeldEingabe
          label="Typ"
          name="typ"
          rules={[{ required: true, message: 'Typ ist Pflicht' }]}
        >
          <Select options={[{ value: 'a', label: 'A' }]} />
        </DatenfeldEingabe>
        <DatenfeldEingabe
          label="Ort"
          name="ort"
          rules={[{ required: true, message: 'Ort ist Pflicht' }]}
        >
          <Input />
        </DatenfeldEingabe>
        <DatenfeldEingabe
          label="Alter"
          name="alter"
          rules={[{ type: 'number', max: 120, message: 'Höchstens 120 Jahre' }]}
        >
          <InputNumber />
        </DatenfeldEingabe>
        <DatenfeldEingabe label="Notiz" name="notiz" breit>
          <Input.TextArea />
        </DatenfeldEingabe>
      </Datenraster>
      <Button htmlType="submit">Speichern</Button>
    </Form>
  );
}

describe('DatenfeldEingabe', () => {
  it('benennt jede Eingabe über ihr Etikett im Begriff', () => {
    renderMitProviders(<Maske />);
    // Mutationsprobe: ohne `htmlFor` am Etikett (oder ohne die Kennung an der Eingabe) findet
    // `getByLabelText` keine Eingabe, der Test wird rot.
    expect(screen.getByLabelText('Ort')).toBe(screen.getByRole('textbox', { name: 'Ort' }));
    expect(screen.getByLabelText('Typ')).toBe(screen.getByRole('combobox', { name: 'Typ' }));
    expect(screen.getByLabelText('Alter')).toBe(screen.getByRole('spinbutton', { name: 'Alter' }));
    expect(screen.getByLabelText('Notiz').tagName).toBe('TEXTAREA');
    // Das Etikett steht im Begriff des Datenrasters: dieselbe Optik wie in der Anzeige.
    expect(screen.getByText('Ort').closest('dt')).not.toBeNull();
  });

  it('zeigt den Prüffehler sichtbar unter der Eingabe derselben Zelle', async () => {
    const onFinish = vi.fn();
    renderMitProviders(<Maske onFinish={onFinish} />);
    await userEvent.click(screen.getByRole('button', { name: 'Speichern' }));

    // Mutationsprobe: mit `noStyle` am `Form.Item` (der alte Weg) rendert antd keine Meldung, der
    // Test wird rot.
    const meldung = await screen.findByText('Ort ist Pflicht');
    const ort = screen.getByLabelText('Ort');
    expect(meldung.closest('[data-lfh="datenfeld"]')).toBe(ort.closest('[data-lfh="datenfeld"]'));
    expect(ort).toHaveAttribute('aria-invalid', 'true');
    expect(ort).toHaveAccessibleDescription('Ort ist Pflicht');
    expect(onFinish).not.toHaveBeenCalled();
  });

  it('nach gescheiterter Prüfung steht der Fokus im ersten fehlerhaften Feld', async () => {
    renderMitProviders(<Maske />);
    await userEvent.type(screen.getByLabelText('Ort'), 'Hauptstr.');
    await userEvent.click(screen.getByRole('button', { name: 'Speichern' }));
    // Typ ist das erste Feld mit Fehler (Ort ist gefüllt).
    await waitFor(() => expect(screen.getByLabelText('Typ')).toHaveFocus());
  });

  it('zieht ein breites Feld über alle Spalten', () => {
    renderMitProviders(<Maske />);
    const zelle = screen.getByLabelText('Notiz').closest<HTMLElement>('[data-lfh="datenfeld"]')!;
    expect(zelle.style.gridColumn).toBe('1 / -1');
    const schmal = screen.getByLabelText('Ort').closest<HTMLElement>('[data-lfh="datenfeld"]')!;
    expect(schmal.style.gridColumn).toBe('');
  });
});
