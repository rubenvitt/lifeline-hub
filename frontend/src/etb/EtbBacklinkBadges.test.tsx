import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import type { EtbEintragAnzeige } from '../api/types';
import EtbBacklinkBadges from './EtbBacklinkBadges';

function eintrag(over: Partial<EtbEintragAnzeige>): EtbEintragAnzeige {
  return {
    id: 1, lfd_nr: 1, typ: 'anordnung', inhalt: 'x', von: null, an: null, meldeweg: null,
    veranlassung: null, erfasser_id: 1, erfasser_name: 'M', ereigniszeit: '2026-06-23 10:00:00',
    received_at: '2026-06-23 10:00:00', erfasst_lokal_at: null, berichtigt_eintrag_id: null,
    lagebericht_id: null, auftrag_id: null, befehl_id: null, ...over,
  };
}

function renderBadges(e: EtbEintragAnzeige) {
  return render(
    <MemoryRouter>
      <EtbBacklinkBadges eintrag={e} einsatzId={3} />
    </MemoryRouter>,
  );
}

describe('EtbBacklinkBadges (LFH-25)', () => {
  it('verlinkt befehl_id auf die Befehl-Detailroute', () => {
    renderBadges(eintrag({ befehl_id: 42 }));
    expect(screen.getByRole('link', { name: /Befehl/ })).toHaveAttribute(
      'href', '/einsaetze/3/auftraege/befehle/42',
    );
  });

  it('verlinkt lagebericht_id auf die Lagebericht-Detailroute', () => {
    renderBadges(eintrag({ lagebericht_id: 7 }));
    expect(screen.getByRole('link', { name: /Lagebericht/ })).toHaveAttribute(
      'href', '/einsaetze/3/lageberichte/7',
    );
  });

  it('verlinkt auftrag_id auf die Auftrags-Liste (Query-Param-Selektion)', () => {
    renderBadges(eintrag({ auftrag_id: 9 }));
    expect(screen.getByRole('link', { name: /Auftrag/ })).toHaveAttribute(
      'href', '/einsaetze/3/auftraege?auftrag=9',
    );
  });

  it('rendert nichts, wenn kein Backlink gesetzt ist', () => {
    const { container } = renderBadges(eintrag({}));
    expect(container).toBeEmptyDOMElement();
  });
});
