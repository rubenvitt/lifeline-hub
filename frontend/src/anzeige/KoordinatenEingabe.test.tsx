import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { useState } from 'react';
import { http, HttpResponse } from 'msw';
import { server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import KoordinatenEingabe from './KoordinatenEingabe';
import { setzeOverride } from './koordinatenSystemStore';
import type { LatLon } from './koordinaten';

afterEach(() => localStorage.clear());

describe('KoordinatenEingabe', () => {
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

  it('Invalid-State + onChange(null) bei Müll', () => {
    const onChange = vi.fn();
    render(<KoordinatenEingabe value={null} onChange={onChange} />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'quatsch' } });
    expect(onChange).toHaveBeenLastCalledWith(null);
    expect(screen.getByText(/ungültig/i)).toBeInTheDocument();
  });

  it('leeres Feld → onChange(null)', () => {
    const onChange = vi.fn();
    render(<KoordinatenEingabe value={{ lat: 51.5, lon: 10.25 }} onChange={onChange} />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '' } });
    expect(onChange).toHaveBeenLastCalledWith(null);
  });

  // Diskriminierender Test: in einer Form wird das onChange-Ergebnis als neues value
  // zurückgespeist. Ohne Fokus-Guard würde der useEffect die laufende Eingabe überschreiben.
  it('überschreibt die laufende Eingabe nicht, wenn value zurückgespeist wird (Form-Loop)', () => {
    function Wrapper() {
      const [v, setV] = useState<LatLon | null>(null);
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
    const { container } = render(
      <KoordinatenEingabe value={null} onChange={() => {}} />,
    );
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
    expect(await screen.findByText(/Hauptstr\. 5, Musterstadt · 1[.,]20 km NO von Einsatzort/)).toBeInTheDocument();
  });
});
