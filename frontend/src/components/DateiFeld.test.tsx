import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Button, Form } from 'antd';
import { describe, expect, it, vi } from 'vitest';
import { renderMitProviders } from '../test/utils';
import { UPLOAD_MAX_GROESSE } from '../api/upload';
import DateiFeld from './DateiFeld';

/** Formular mit nur dem Dateifeld; `onFinish` belegt, ob abgesendet wurde. */
function Formular({ onFinish, onDateiWahl }: { onFinish: () => void; onDateiWahl?: () => void }) {
  return (
    <Form onFinish={onFinish}>
      <DateiFeld accept=".jpg,.pdf" onDateiWahl={onDateiWahl} />
      <Button htmlType="submit">Senden</Button>
    </Form>
  );
}

function mitGroesse(bytes: number) {
  const f = new File(['x'], 'gross.jpg', { type: 'image/jpeg' });
  Object.defineProperty(f, 'size', { value: bytes });
  return f;
}

describe('DateiFeld (LFH-21)', () => {
  it('setzt accept und nimmt höchstens eine Datei', () => {
    const { container } = renderMitProviders(<Formular onFinish={vi.fn()} />);
    const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
    expect(input).toHaveAttribute('accept', '.jpg,.pdf');
    expect(input).not.toHaveAttribute('multiple');
  });

  it('weist eine zu große Datei vor dem Absenden mit dem Server-Wortlaut ab', async () => {
    const onFinish = vi.fn();
    const { container } = renderMitProviders(<Formular onFinish={onFinish} />);
    const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
    await userEvent.upload(input, mitGroesse(UPLOAD_MAX_GROESSE + 1));
    await userEvent.click(screen.getByRole('button', { name: 'Senden' }));
    expect(await screen.findByText('Datei ist zu groß (25 MiB erlaubt)')).toBeInTheDocument();
    expect(onFinish).not.toHaveBeenCalled();
  });

  it('lässt genau 25 MiB durch (der Server prüft mit „>“)', async () => {
    const onFinish = vi.fn();
    const { container } = renderMitProviders(<Formular onFinish={onFinish} />);
    const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
    await userEvent.upload(input, mitGroesse(UPLOAD_MAX_GROESSE));
    await userEvent.click(screen.getByRole('button', { name: 'Senden' }));
    await vi.waitFor(() => expect(onFinish).toHaveBeenCalledTimes(1));
  });

  it('verlangt eine Datei', async () => {
    const onFinish = vi.fn();
    renderMitProviders(<Formular onFinish={onFinish} />);
    await userEvent.click(screen.getByRole('button', { name: 'Senden' }));
    expect(await screen.findByText('Bitte eine Datei wählen')).toBeInTheDocument();
    expect(onFinish).not.toHaveBeenCalled();
  });

  it('meldet eine Dateiwahl, das Entfernen aber nicht', async () => {
    const onDateiWahl = vi.fn();
    const { container } = renderMitProviders(
      <Formular onFinish={vi.fn()} onDateiWahl={onDateiWahl} />,
    );
    const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
    await userEvent.upload(input, new File(['x'], 'dach.jpg'));
    await vi.waitFor(() => expect(onDateiWahl).toHaveBeenCalledTimes(1));
    expect(onDateiWahl.mock.calls[0][0]).toMatchObject({ name: 'dach.jpg' });
    const liste = container.querySelector<HTMLElement>('.ant-upload-list')!;
    await userEvent.click(within(liste).getByRole('button', { name: /remove|entfernen/i }));
    expect(onDateiWahl).toHaveBeenCalledTimes(1);
  });

  it('fokussiert „Datei wählen“ beim Einhängen', async () => {
    renderMitProviders(<Formular onFinish={vi.fn()} />);
    const knopf = screen.getByRole('button', { name: /Datei wählen/ });
    await vi.waitFor(() => expect(document.activeElement).toBe(knopf));
  });
});
