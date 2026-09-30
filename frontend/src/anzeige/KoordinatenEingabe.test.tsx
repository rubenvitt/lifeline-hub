import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { useState } from 'react';
import { Form } from 'antd';
import { http, HttpResponse } from 'msw';
import { server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import KoordinatenEingabe from './KoordinatenEingabe';
import { setzeOverride } from './koordinatenSystemStore';
import type { KoordinatenWert } from './koordinatenWert';

afterEach(() => localStorage.clear());

describe('KoordinatenEingabe', () => {
  it('verbindet das Form-Label mit dem Koordinatenfeld', () => {
    renderMitProviders(
      <Form>
        <Form.Item name="koordinaten" label="Koordinate">
          <KoordinatenEingabe />
        </Form.Item>
      </Form>,
    );
    expect(screen.getByRole('textbox', { name: 'Koordinate' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Koordinatenformat' })).toBeInTheDocument();
  });

  it('zeigt den value im aktuellen System (WGS84 default)', () => {
    render(<KoordinatenEingabe value={{ lat: 51.5, lon: 10.25 }} onChange={() => {}} />);
    expect(screen.getByRole('textbox')).toHaveValue('51.50000, 10.25000');
  });

  it('parst Eingabe und meldet LatLon', () => {
    const onChange = vi.fn();
    render(<KoordinatenEingabe value={null} onChange={onChange} />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '51.5, 10.25' } });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ lat: 51.5, lon: 10.25 }));
  });

  it('Umschalten reformatiert aus value ohne Drift', () => {
    setzeOverride('dms');
    render(<KoordinatenEingabe value={{ lat: 51.5, lon: 10.25 }} onChange={() => {}} />);
    expect(screen.getByRole('textbox')).toHaveValue('51°30\'00"N 010°15\'00"E');
  });

  // LFH-517: Müll ist nicht „leer“ — der Aufrufer erfährt Wortlaut und Format, um das Speichern
  // zu verhindern, statt eine bestehende Koordinate still zu löschen.
  it('Invalid-State + onChange(ungültig) bei Müll', () => {
    const onChange = vi.fn();
    render(<KoordinatenEingabe value={null} onChange={onChange} />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'quatsch' } });
    expect(onChange).toHaveBeenLastCalledWith({
      ungueltig: true,
      text: 'quatsch',
      format: 'wgs84',
    });
    expect(screen.getByText('Ungültige Koordinate im Format WGS84 dezimal')).toBeInTheDocument();
  });

  function Kontrolliert({ start = null }: { start?: KoordinatenWert }) {
    const [v, setV] = useState<KoordinatenWert>(start);
    return (
      <>
        <KoordinatenEingabe value={v} onChange={setV} />
        <button type="button" onClick={() => setV(null)}>
          zurücksetzen
        </button>
        <output data-testid="wert">{JSON.stringify(v)}</output>
      </>
    );
  }

  it('ungültiger Text bleibt nach Fokusverlust stehen, der Feldfehler auch (LFH-517)', () => {
    render(<Kontrolliert start={{ lat: 51.5, lon: 10.25 }} />);
    const input = screen.getByRole('textbox');
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '51.5; 10.25' } });
    fireEvent.blur(input);
    expect(input).toHaveValue('51.5; 10.25');
    expect(screen.getByText(/Ungültige Koordinate/)).toBeInTheDocument();
    expect(screen.queryByText(/entspricht/)).not.toBeInTheDocument();
  });

  it('bewusstes Leeren nach ungültiger Eingabe meldet null und nimmt den Fehler zurück', () => {
    render(<Kontrolliert />);
    const input = screen.getByRole('textbox');
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'quatsch' } });
    fireEvent.change(input, { target: { value: '  ' } });
    fireEvent.blur(input);
    expect(screen.getByTestId('wert')).toHaveTextContent('null');
    expect(input).toHaveValue('');
    expect(screen.queryByText(/Ungültige Koordinate/)).not.toBeInTheDocument();
  });

  it('ein Reset von außen räumt ungültigen Text und Fehler (Formular-Reset)', () => {
    render(<Kontrolliert />);
    const input = screen.getByRole('textbox');
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'quatsch' } });
    fireEvent.blur(input);
    fireEvent.click(screen.getByRole('button', { name: 'zurücksetzen' }));
    expect(input).toHaveValue('');
    expect(screen.queryByText(/Ungültige Koordinate/)).not.toBeInTheDocument();
  });

  it('Systemwechsel liest ungültigen Text im neuen Format neu (LFH-517)', () => {
    render(<Kontrolliert />);
    const input = screen.getByRole('textbox');
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '51°30\'00"N 010°15\'00"E' } });
    fireEvent.blur(input);
    expect(screen.getByText(/Ungültige Koordinate/)).toBeInTheDocument();
    act(() => setzeOverride('dms'));
    expect(JSON.parse(screen.getByTestId('wert').textContent ?? '')).toEqual({
      lat: 51.5,
      lon: 10.25,
    });
    expect(input).toHaveValue('51°30\'00"N 010°15\'00"E');
    expect(screen.queryByText(/Ungültige Koordinate/)).not.toBeInTheDocument();
  });

  it('Systemwechsel mit weiterhin ungültigem Text behält Wortlaut und nennt das neue Format', () => {
    render(<Kontrolliert />);
    const input = screen.getByRole('textbox');
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'quatsch' } });
    fireEvent.blur(input);
    act(() => setzeOverride('utm'));
    expect(input).toHaveValue('quatsch');
    expect(screen.getByText('Ungültige Koordinate im Format UTM')).toBeInTheDocument();
    expect(JSON.parse(screen.getByTestId('wert').textContent ?? '')).toEqual({
      ungueltig: true,
      text: 'quatsch',
      format: 'utm',
    });
  });

  it('leeres Feld → onChange(null)', () => {
    const onChange = vi.fn();
    render(<KoordinatenEingabe value={{ lat: 51.5, lon: 10.25 }} onChange={onChange} />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '' } });
    expect(onChange).toHaveBeenLastCalledWith(null);
  });

  // In einer Form wird das onChange-Ergebnis als value zurückgespeist; ohne Fokus-Guard
  // überschriebe der useEffect die laufende Eingabe.
  it('überschreibt die laufende Eingabe nicht, wenn value zurückgespeist wird (Form-Loop)', () => {
    function Wrapper() {
      const [v, setV] = useState<KoordinatenWert>(null);
      return <KoordinatenEingabe value={v} onChange={setV} />;
    }
    render(<Wrapper />);
    const input = screen.getByRole('textbox');
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '51.5, 10.2' } });
    expect(input).toHaveValue('51.5, 10.2'); // NICHT '51.50000, 10.20000'
  });

  it('reicht status=warning an den Input durch', () => {
    const { container } = render(
      <KoordinatenEingabe value={{ lat: 51.5, lon: 10.25 }} onChange={() => {}} status="warning" />,
    );
    expect(container.querySelector('.ant-input-status-warning')).not.toBeNull();
  });

  it('interner Fehler überschreibt externen status (error hat Vorrang vor warning)', () => {
    const { container } = render(<KoordinatenEingabe value={null} onChange={() => {}} />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'quatsch' } });
    expect(container.querySelector('.ant-input-status-error')).not.toBeNull();
  });

  it('Live-Switch: Systemwechsel via setzeOverride reformatiert den angezeigten Wert', () => {
    render(<KoordinatenEingabe value={{ lat: 51.5, lon: 10.25 }} onChange={() => {}} />);
    expect(screen.getByRole('textbox')).toHaveValue('51.50000, 10.25000');
    act(() => setzeOverride('dms'));
    expect(screen.getByRole('textbox')).toHaveValue('51°30\'00"N 010°15\'00"E');
  });

  it('ohne einsatzId rendert keine Ort-Zeile (keine Provider nötig)', () => {
    // Bewusst bare render ohne QueryClient — darf NICHT werfen.
    render(<KoordinatenEingabe value={{ lat: 51.5, lon: 10.25 }} onChange={() => {}} />);
    expect(screen.queryByText(/vom|·|ermittelt/)).not.toBeInTheDocument();
  });

  it('rendert die Peilungs-Zeile (ortsname null)', async () => {
    server.use(
      http.get('/api/einsaetze/1/ort-vorschau', () =>
        HttpResponse.json({
          peilung: { distanz_m: 1200, richtung: 'NO', bezug_label: 'Einsatzort' },
          ortsname: null,
        }),
      ),
    );
    renderMitProviders(
      <KoordinatenEingabe value={{ lat: 51.5, lon: 10.25 }} onChange={() => {}} einsatzId={1} />,
    );
    expect(await screen.findByText(/NO von Einsatzort/)).toBeInTheDocument();
  });

  it('rendert Ortsname und Peilung verkettet', async () => {
    server.use(
      http.get('/api/einsaetze/1/ort-vorschau', () =>
        HttpResponse.json({
          peilung: { distanz_m: 1200, richtung: 'NO', bezug_label: 'Einsatzort' },
          ortsname: 'Hauptstr. 5, Musterstadt',
        }),
      ),
    );
    renderMitProviders(
      <KoordinatenEingabe value={{ lat: 51.5, lon: 10.25 }} onChange={() => {}} einsatzId={1} />,
    );
    expect(
      await screen.findByText(/Hauptstr\. 5, Musterstadt · 1[.,]20 km NO von Einsatzort/),
    ).toBeInTheDocument();
  });
});
