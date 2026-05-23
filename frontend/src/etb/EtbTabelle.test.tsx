import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { EtbEintragAnzeige } from '../api/types';
import EtbTabelle from './EtbTabelle';

function eintrag(over: Partial<EtbEintragAnzeige> = {}): EtbEintragAnzeige {
  return {
    id: 1,
    lfd_nr: 1,
    typ: 'meldung',
    inhalt: 'Lage erkundet',
    von: 'ELW',
    an: 'Leitstelle',
    meldeweg: 'funk',
    veranlassung: null,
    erfasser_id: 1,
    erfasser_name: 'Max',
    ereigniszeit: '2026-05-23 10:00:00',
    received_at: '2026-05-23 10:00:02',
    erfasst_lokal_at: null,
    berichtigt_eintrag_id: null,
    ...over,
  };
}

describe('EtbTabelle', () => {
  it('zeigt Inhalt, Typ-Label und Von→An', () => {
    render(<EtbTabelle eintraege={[eintrag()]} />);
    expect(screen.getByText('Lage erkundet')).toBeInTheDocument();
    expect(screen.getByText('Meldung')).toBeInTheDocument();
    expect(screen.getByText(/ELW/)).toBeInTheDocument();
  });

  it('markiert nachgetragene Einträge mit ⧖', () => {
    render(
      <EtbTabelle
        eintraege={[eintrag({ ereigniszeit: '2026-05-23 09:00:00', received_at: '2026-05-23 10:00:00' })]}
      />,
    );
    expect(screen.getByText('⧖')).toBeInTheDocument();
  });

  it('zeigt KEIN ⧖ bei normaler Latenz', () => {
    render(<EtbTabelle eintraege={[eintrag()]} />);
    expect(screen.queryByText('⧖')).not.toBeInTheDocument();
  });

  it('verknüpft Original und Berichtigung in beide Richtungen', () => {
    const original = eintrag({ id: 1, lfd_nr: 1, inhalt: 'Falsche Lage' });
    const korrektur = eintrag({
      id: 2,
      lfd_nr: 2,
      typ: 'berichtigung',
      inhalt: 'Korrektur',
      berichtigt_eintrag_id: 1,
    });
    render(<EtbTabelle eintraege={[korrektur, original]} />);
    expect(screen.getByText('berichtigt #1')).toBeInTheDocument();
    expect(screen.getByText('berichtigt durch #2')).toBeInTheDocument();
  });
});
