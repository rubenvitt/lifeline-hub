import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { vorlage } from '../befehle/vorlagen';
import BefehlLesefassung from './BefehlLesefassung';

describe('BefehlLesefassung (oxgob5gk D5)', () => {
  it('zeigt jeden Abschnitt des Schemas, einen leeren mit „—“', () => {
    const v = vorlage('befehl_lad')!;
    const [erster, zweiter] = v.abschnitte;
    render(
      <BefehlLesefassung
        vorlage={v}
        abschnitte={[{ schluessel: erster.schluessel, text: 'Brand im Lager' }]}
        ebene={5}
      />,
    );
    expect(screen.getByRole('heading', { level: 5, name: erster.label })).toBeInTheDocument();
    expect(screen.getByText('Brand im Lager')).toBeInTheDocument();
    const leer = screen.getByRole('heading', { level: 5, name: zweiter.label }).parentElement!;
    expect(leer).toHaveTextContent('—');
    expect(screen.getAllByRole('heading', { level: 5 })).toHaveLength(v.abschnitte.length);
  });
});
