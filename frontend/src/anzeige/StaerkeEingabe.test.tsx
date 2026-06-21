import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { useState } from 'react';
import type { Staerke } from '../api/types';
import StaerkeEingabe from './StaerkeEingabe';

describe('StaerkeEingabe', () => {
  it('value=null → drei leere Felder, Gesamt —', () => {
    render(<StaerkeEingabe value={null} onChange={() => {}} />);
    const felder = screen.getAllByRole('spinbutton');
    expect(felder).toHaveLength(3);
    felder.forEach((f) => expect(f).toHaveValue(''));
    expect(screen.getByText('= —')).toBeInTheDocument();
  });

  it('value gefüllt → Felder + Live-Gesamt', () => {
    render(<StaerkeEingabe value={{ fuehrer: 1, unterfuehrer: 3, mannschaft: 18 }} onChange={() => {}} />);
    expect(screen.getByLabelText('Führer')).toHaveValue('1');
    expect(screen.getByLabelText('Unterführer')).toHaveValue('3');
    expect(screen.getByLabelText('Mannschaft')).toHaveValue('18');
    expect(screen.getByText('= 22')).toBeInTheDocument();
  });

  it('ein Feld setzen koerziert leere zu 0 (alle drei oder keiner)', () => {
    const onChange = vi.fn();
    render(<StaerkeEingabe value={null} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText('Führer'), { target: { value: '2' } });
    expect(onChange).toHaveBeenLastCalledWith({ fuehrer: 2, unterfuehrer: 0, mannschaft: 0 });
  });

  it('ein Feld von dreien leeren bleibt vollständige Stärke (leeres zählt als 0)', () => {
    const onChange = vi.fn();
    render(<StaerkeEingabe value={{ fuehrer: 1, unterfuehrer: 2, mannschaft: 3 }} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText('Führer'), { target: { value: '' } });
    expect(onChange).toHaveBeenLastCalledWith({ fuehrer: 0, unterfuehrer: 2, mannschaft: 3 });
  });

  it('erst wenn alle drei Felder leer sind → onChange(null)', () => {
    let zuletzt: Staerke | null = { fuehrer: 9, unterfuehrer: 9, mannschaft: 9 };
    function Wrapper() {
      const [v, setV] = useState<Staerke | null>({ fuehrer: 1, unterfuehrer: 2, mannschaft: 3 });
      return <StaerkeEingabe value={v} onChange={(w) => { zuletzt = w; setV(w); }} />;
    }
    render(<Wrapper />);
    fireEvent.change(screen.getByLabelText('Führer'), { target: { value: '' } });
    fireEvent.change(screen.getByLabelText('Unterführer'), { target: { value: '' } });
    expect(zuletzt).not.toBeNull(); // m noch gesetzt
    fireEvent.change(screen.getByLabelText('Mannschaft'), { target: { value: '' } });
    expect(zuletzt).toBeNull();
  });

  it('disabled deaktiviert alle Felder', () => {
    render(<StaerkeEingabe value={null} onChange={() => {}} disabled />);
    screen.getAllByRole('spinbutton').forEach((f) => expect(f).toBeDisabled());
  });

  // Bearbeiten-Pfad: antd füllt value erst NACH dem Mount via setFieldsValue. Der
  // Spiegel-Zweig des Echo-Guards muss den externen value-Wechsel in die Felder übernehmen,
  // sonst käme die Eingabemaske leer hoch und überschriebe die Soll-Stärke beim Speichern.
  it('externer value-Wechsel nach Mount spiegelt in die Felder', () => {
    const { rerender } = render(<StaerkeEingabe value={null} onChange={() => {}} />);
    expect(screen.getByLabelText('Führer')).toHaveValue('');
    rerender(<StaerkeEingabe value={{ fuehrer: 4, unterfuehrer: 5, mannschaft: 6 }} onChange={() => {}} />);
    expect(screen.getByLabelText('Führer')).toHaveValue('4');
    expect(screen.getByLabelText('Unterführer')).toHaveValue('5');
    expect(screen.getByLabelText('Mannschaft')).toHaveValue('6');
    expect(screen.getByText('= 15')).toBeInTheDocument();
  });

  // Form-Loop: onChange→value wird zurückgespeist. Das Echo darf die noch leeren Felder
  // NICHT auf 0 ziehen, sonst kann der Nutzer nie nur ein Feld vorbelegen.
  it('Form-Loop: andere Felder bleiben nach dem ersten Eintrag leer', () => {
    function Wrapper() {
      const [v, setV] = useState<Staerke | null>(null);
      return <StaerkeEingabe value={v} onChange={setV} />;
    }
    render(<Wrapper />);
    fireEvent.change(screen.getByLabelText('Führer'), { target: { value: '1' } });
    expect(screen.getByLabelText('Unterführer')).toHaveValue('');
    expect(screen.getByLabelText('Mannschaft')).toHaveValue('');
    expect(screen.getByText('= 1')).toBeInTheDocument();
  });
});
