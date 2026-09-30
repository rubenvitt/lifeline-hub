import { describe, it, expect, vi, afterEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { Button, Form } from 'antd';
import { renderMitProviders } from '../test/utils';
import KoordinatenFeld from './KoordinatenFeld';
import { alsLatLon, type KoordinatenWert } from './koordinatenWert';

afterEach(() => localStorage.clear());

interface Werte {
  koord?: KoordinatenWert;
}

function Formular({ onFinish, start }: { onFinish: (w: Werte) => void; start?: KoordinatenWert }) {
  return (
    <Form<Werte> initialValues={{ koord: start ?? null }} onFinish={onFinish}>
      <KoordinatenFeld name="koord" label="Koordinate" />
      <Button htmlType="submit">Speichern</Button>
    </Form>
  );
}

function tippe(wert: string) {
  const input = screen.getByRole('textbox', { name: 'Koordinate' });
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value: wert } });
  fireEvent.blur(input);
}

describe('KoordinatenFeld (LFH-517)', () => {
  it('ungültige Koordinate sendet nicht und zeigt den Fehler genau einmal', async () => {
    const onFinish = vi.fn();
    renderMitProviders(<Formular onFinish={onFinish} />);
    tippe('quatsch');
    fireEvent.click(screen.getByRole('button', { name: 'Speichern' }));
    // Erst die Fehlerzeile des Form.Item abwarten — die Eingabe allein zeigte den Text sofort.
    await waitFor(() =>
      expect(document.querySelector('.ant-form-item-explain-error')).toHaveTextContent(
        'Ungültige Koordinate im Format WGS84 dezimal',
      ),
    );
    expect(screen.getAllByText('Ungültige Koordinate im Format WGS84 dezimal')).toHaveLength(1);
    expect(onFinish).not.toHaveBeenCalled();
    expect(screen.getByRole('textbox', { name: 'Koordinate' })).toHaveValue('quatsch');
  });

  it('nach der Korrektur geht das richtige lat/lon-Paar hinaus', async () => {
    const onFinish = vi.fn();
    renderMitProviders(<Formular onFinish={onFinish} />);
    tippe('quatsch');
    fireEvent.click(screen.getByRole('button', { name: 'Speichern' }));
    await screen.findByText(/Ungültige Koordinate/);
    tippe('50.1, 8.6');
    fireEvent.click(screen.getByRole('button', { name: 'Speichern' }));
    await waitFor(() => expect(onFinish).toHaveBeenCalledTimes(1));
    expect(alsLatLon(onFinish.mock.calls[0][0].koord)).toEqual({ lat: 50.1, lon: 8.6 });
  });

  it('Gegenprobe: leer bleibt speicherbar', async () => {
    const onFinish = vi.fn();
    renderMitProviders(<Formular onFinish={onFinish} />);
    fireEvent.click(screen.getByRole('button', { name: 'Speichern' }));
    await waitFor(() => expect(onFinish).toHaveBeenCalledTimes(1));
    expect(alsLatLon(onFinish.mock.calls[0][0].koord)).toBeNull();
  });

  it('Gegenprobe: eine bestehende Koordinate lässt sich bewusst leeren', async () => {
    const onFinish = vi.fn();
    renderMitProviders(<Formular onFinish={onFinish} start={{ lat: 51.5, lon: 10.25 }} />);
    tippe('');
    fireEvent.click(screen.getByRole('button', { name: 'Speichern' }));
    await waitFor(() => expect(onFinish).toHaveBeenCalledTimes(1));
    expect(alsLatLon(onFinish.mock.calls[0][0].koord)).toBeNull();
  });
});

describe('alsLatLon', () => {
  it('reicht LatLon und leer durch', () => {
    expect(alsLatLon({ lat: 1, lon: 2 })).toEqual({ lat: 1, lon: 2 });
    expect(alsLatLon(null)).toBeNull();
    expect(alsLatLon(undefined)).toBeNull();
  });

  // Fail-closed: fehlt einem Formular die Regel, darf eine ungültige Eingabe die gespeicherte
  // Koordinate nicht still löschen.
  it('wirft bei einer ungültigen Koordinate, statt sie als leer zu senden', () => {
    expect(() => alsLatLon({ ungueltig: true, text: 'quatsch', format: 'wgs84' })).toThrow();
  });
});
