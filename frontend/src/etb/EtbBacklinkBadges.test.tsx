import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MemoryRouter } from 'react-router';
import type { EtbEintragAnzeige } from '../api/types';
import EtbBacklinkBadges from './EtbBacklinkBadges';

function eintrag(over: Partial<EtbEintragAnzeige>): EtbEintragAnzeige {
  return {
    id: 1,
    lfd_nr: 1,
    typ: 'anordnung',
    inhalt: 'x',
    von: null,
    an: null,
    meldeweg: null,
    veranlassung: null,
    erfasser_id: 1,
    erfasser_name: 'M',
    ereigniszeit: '2026-06-23 10:00:00',
    received_at: '2026-06-23 10:00:00',
    erfasst_lokal_at: null,
    berichtigt_eintrag_id: null,
    lagebericht_id: null,
    auftrag_id: null,
    befehl_id: null,
    folgeauftraege: [],
    ...over,
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
      'href',
      '/einsaetze/3/auftraege/befehle/42',
    );
  });

  it('verlinkt lagebericht_id auf die Lagebericht-Detailroute', () => {
    renderBadges(eintrag({ lagebericht_id: 7 }));
    expect(screen.getByRole('link', { name: /Lagebericht/ })).toHaveAttribute(
      'href',
      '/einsaetze/3/lageberichte/7',
    );
  });

  it('verlinkt auftrag_id auf die Auftrags-Liste (Query-Param-Selektion)', () => {
    renderBadges(eintrag({ auftrag_id: 9 }));
    expect(screen.getByRole('link', { name: /Auftrag/ })).toHaveAttribute(
      'href',
      '/einsaetze/3/auftraege?auftrag=9',
    );
  });

  it('rendert nichts, wenn kein Backlink gesetzt ist', () => {
    const { container } = renderBadges(eintrag({}));
    expect(container).toBeEmptyDOMElement();
  });
});

describe('EtbBacklinkBadges — Folgeaufträge (LFH-636)', () => {
  it('verlinkt einen Folgeauftrag mit seiner Nummer auf die Auftragsliste', () => {
    renderBadges(eintrag({ typ: 'entscheidung', folgeauftraege: [{ id: 31, lfd_nr: 12 }] }));
    const link = screen.getByRole('link', { name: 'Folgeauftrag Nr. 12' });
    expect(link).toHaveAttribute('href', '/einsaetze/3/auftraege?auftrag=31');
    // Das ↗ steht sichtbar da, gehört aber nicht zum zugänglichen Namen (exakter Name oben).
    expect(link.textContent).toContain('↗');
  });

  it('gibt jedem von mehreren Folgeaufträgen einen eigenen Namen', () => {
    renderBadges(
      eintrag({
        folgeauftraege: [
          { id: 31, lfd_nr: 12 },
          { id: 32, lfd_nr: 13 },
          { id: 40, lfd_nr: 21 },
        ],
      }),
    );
    for (const [name, id] of [
      ['Folgeauftrag Nr. 12', 31],
      ['Folgeauftrag Nr. 13', 32],
      ['Folgeauftrag Nr. 21', 40],
    ] as const) {
      expect(screen.getByRole('link', { name })).toHaveAttribute(
        'href',
        `/einsaetze/3/auftraege?auftrag=${id}`,
      );
    }
    expect(screen.getAllByRole('link')).toHaveLength(3);
  });

  it('heißt ohne Nummer (Altbestand) nur „Folgeauftrag"', () => {
    renderBadges(eintrag({ folgeauftraege: [{ id: 5 }] }));
    expect(screen.getByRole('link', { name: 'Folgeauftrag' })).toHaveAttribute(
      'href',
      '/einsaetze/3/auftraege?auftrag=5',
    );
  });

  it('unterscheidet den Rückverweis „Auftrag" vom Folgeauftrag', () => {
    renderBadges(eintrag({ auftrag_id: 9, folgeauftraege: [{ id: 31, lfd_nr: 12 }] }));
    expect(screen.getByRole('link', { name: 'Auftrag' })).toHaveAttribute(
      'href',
      '/einsaetze/3/auftraege?auftrag=9',
    );
    expect(screen.getByRole('link', { name: 'Folgeauftrag Nr. 12' })).toHaveAttribute(
      'href',
      '/einsaetze/3/auftraege?auftrag=31',
    );
  });

  it('zeigt ohne Folgeauftrag keinen Folgeauftrag-Verweis', () => {
    renderBadges(eintrag({ befehl_id: 42, folgeauftraege: [] }));
    expect(screen.queryByRole('link', { name: /Folgeauftrag/ })).toBeNull();
  });
});
