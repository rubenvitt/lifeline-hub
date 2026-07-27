import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MemoryRouter } from 'react-router';
import type { ComponentProps } from 'react';
import type { EtbEintragAnzeige } from '../api/types';
import EtbTabelle from './EtbTabelle';

/** EtbTabelle ist seit den Backlink-Badges router-abhängig → in MemoryRouter rendern. */
function renderTabelle(props: Omit<ComponentProps<typeof EtbTabelle>, 'einsatzId'> & { einsatzId?: number }) {
  return render(
    <MemoryRouter>
      <EtbTabelle einsatzId={1} {...props} />
    </MemoryRouter>,
  );
}

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
    lagebericht_id: null,
    auftrag_id: null,
    befehl_id: null,
    ...over,
  };
}

describe('EtbTabelle', () => {
  it('zeigt Inhalt, Typ-Label und Von→An', () => {
    renderTabelle({ eintraege: [eintrag()] });
    expect(screen.getByText('Lage erkundet')).toBeInTheDocument();
    expect(screen.getByText('Meldung')).toBeInTheDocument();
    expect(screen.getByText(/ELW/)).toBeInTheDocument();
  });

  it('markiert nachgetragene Einträge mit ⧖', () => {
    renderTabelle({
      eintraege: [eintrag({ ereigniszeit: '2026-05-23 09:00:00', received_at: '2026-05-23 10:00:00' })],
    });
    expect(screen.getByText('⧖')).toBeInTheDocument();
  });

  it('zeigt KEIN ⧖ bei normaler Latenz', () => {
    renderTabelle({ eintraege: [eintrag()] });
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
    renderTabelle({ eintraege: [korrektur, original] });
    expect(screen.getByText('berichtigt #1')).toBeInTheDocument();
    expect(screen.getByText('berichtigt durch #2')).toBeInTheDocument();
  });

  it('rendert Markdown-Inhalt mit Fettschrift (kein Rohtext mit **)', () => {
    const { container } = renderTabelle({ eintraege: [eintrag({ inhalt: '**Lage** erkundet' })] });
    // Nach der Markdown-Umwandlung muss ein <strong>-Element vorhanden sein.
    expect(container.querySelector('strong')).toBeInTheDocument();
    // Die rohen Sternchen dürfen NICHT als Plaintext erscheinen.
    expect(screen.queryByText('**Lage** erkundet')).not.toBeInTheDocument();
  });

  it('rendert Markdown-Listen als Listenelemente (kein Rohtext mit #/-)', () => {
    const { container } = renderTabelle({ eintraege: [eintrag({ inhalt: '# Titel\n- a\n- b' })] });
    // Liste aus zwei Einträgen muss als <li>-Elemente erscheinen.
    const liElemente = container.querySelectorAll('li');
    expect(liElemente.length).toBeGreaterThanOrEqual(2);
  });

  it('zeigt einen Deeplink-Badge auf den gekoppelten Befehl (LFH-25)', () => {
    renderTabelle({ eintraege: [eintrag({ id: 5, befehl_id: 42 })] });
    expect(screen.getByRole('link', { name: /Befehl/ })).toHaveAttribute(
      'href', '/einsaetze/1/auftraege/befehle/42',
    );
  });

  it('hebt den per highlightId adressierten Eintrag hervor (LFH-25 ?eintrag=)', () => {
    const { container } = renderTabelle({ eintraege: [eintrag({ id: 9 })], highlightId: 9 });
    expect(container.querySelector('[data-row-key="9"]')).toHaveClass('zeile-hervorgehoben');
  });
});
