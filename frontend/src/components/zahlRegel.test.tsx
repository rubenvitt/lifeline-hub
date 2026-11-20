import { fireEvent, screen, waitFor } from '@testing-library/react';
import { Button, Form, InputNumber } from 'antd';
import { describe, expect, it, vi } from 'vitest';
import { renderMitProviders } from '../test/utils';
import Feld from './instrument/Feld';
import { pruefeZahl, zahlRegel } from './zahlRegel';

describe('pruefeZahl (LLH-1768: prüfen statt kappen)', () => {
  it('nennt die Obergrenze mit Einheit', () => {
    expect(pruefeZahl(250, { max: 120, einheit: 'Jahre' })).toBe('Höchstens 120 Jahre');
  });

  it('nennt die Untergrenze', () => {
    expect(pruefeZahl(-1, { min: 0 })).toBe('Mindestens 0');
  });

  it('lehnt Brüche ab, wo nur ganze Zahlen gelten', () => {
    expect(pruefeZahl(2.5, { ganz: true })).toBe('Nur ganze Zahlen');
  });

  it('lehnt zu viele Nachkommastellen ab', () => {
    expect(pruefeZahl(7.123, { stellen: 2 })).toBe('Höchstens 2 Nachkommastellen');
    expect(pruefeZahl(7.1, { stellen: 2 })).toBeNull();
    expect(pruefeZahl(1e-7, { stellen: 2 })).toBe('Höchstens 2 Nachkommastellen');
  });

  it('lässt leere Werte durch', () => {
    expect(pruefeZahl(null, { min: 1 })).toBeNull();
    expect(pruefeZahl(undefined, { min: 1 })).toBeNull();
  });
});

function Alter({ onFinish, alter }: { onFinish: (w: unknown) => void; alter?: number }) {
  return (
    <Form onFinish={onFinish} initialValues={{ alter }}>
      <Feld name="alter" label="Alter" rules={[zahlRegel({ max: 120, einheit: 'Jahre' })]}>
        <InputNumber />
      </Feld>
      <Button htmlType="submit">Senden</Button>
    </Form>
  );
}

describe('zahlRegel im Formular', () => {
  it('250 bleibt stehen, nennt die Grenze und sendet nicht', async () => {
    const onFinish = vi.fn();
    renderMitProviders(<Alter onFinish={onFinish} />);
    const feld = screen.getByLabelText('Alter');
    fireEvent.change(feld, { target: { value: '250' } });
    fireEvent.blur(feld);
    fireEvent.click(screen.getByRole('button', { name: 'Senden' }));
    expect(await screen.findByText('Höchstens 120 Jahre')).toBeInTheDocument();
    expect(feld).toHaveValue('250');
    expect(onFinish).not.toHaveBeenCalled();
  });

  it('ein unberührter Altwert außerhalb der Grenze sperrt nicht', async () => {
    const onFinish = vi.fn();
    renderMitProviders(<Alter onFinish={onFinish} alter={130} />);
    fireEvent.click(screen.getByRole('button', { name: 'Senden' }));
    await waitFor(() => expect(onFinish).toHaveBeenCalledWith({ alter: 130 }));
  });
});
