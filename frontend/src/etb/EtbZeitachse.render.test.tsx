import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { EtbEintragAnzeige } from '../api/types';
import { renderMitProviders } from '../test/utils';
import { baueZeilen, type EtbZeile } from './etbZeile';
import EtbZeitachse from './EtbZeitachse';

/**
 * Gemerktes Rendern und Fensterung der Zeitachse (LFH-947, design.md D5/D6).
 *
 * Gezählt wird der Satz: `react-markdown` ist durch einen Zähler ersetzt, `Markdown` selbst
 * bleibt echt. Jeder Aufruf des Zählers stünde im Betrieb für einen unified-Parse.
 */
const geparst = vi.hoisted(() => ({ texte: [] as string[] }));

vi.mock('react-markdown', () => ({
  default: ({ children }: { children: string }) => {
    geparst.texte.push(children);
    return <p>{children}</p>;
  },
}));

function eintrag(n: number, stunde = 10): EtbEintragAnzeige {
  return {
    id: n,
    lfd_nr: n,
    typ: 'meldung',
    inhalt: `Eintrag ${n}`,
    von: 'ELW',
    an: 'Leitstelle',
    meldeweg: 'funk',
    veranlassung: null,
    erfasser_id: 1,
    erfasser_name: 'Max',
    ereigniszeit: `2026-05-23 ${String(stunde).padStart(2, '0')}:00:00`,
    received_at: `2026-05-23 ${String(stunde).padStart(2, '0')}:00:02`,
    erfasst_lokal_at: null,
    berichtigt_eintrag_id: null,
    lagebericht_id: null,
    auftrag_id: null,
    befehl_id: null,
    folgeauftraege: [],
    berichtigt_durch: [],
    anhaenge: [],
  };
}

function zeilen(eintraege: EtbEintragAnzeige[]): EtbZeile[] {
  return baueZeilen({ eintraege, ausstehend: [], abgelehnt: [] });
}

function bau(z: readonly EtbZeile[]) {
  // Ein frischer Handler je Bau: die Zeitachse fängt neue Identitäten über eine Ref ab.
  return <EtbZeitachse einsatzId={1} zeilen={z} onBerichtigen={() => {}} />;
}

beforeEach(() => {
  geparst.texte = [];
});

describe('EtbZeitachse – gemerktes Rendern (LFH-947)', () => {
  it('ein Rerender mit denselben Einträgen parst keinen Text neu', () => {
    const z = zeilen([eintrag(3), eintrag(2), eintrag(1)]);
    const { rerender } = renderMitProviders(bau(z));
    expect(geparst.texte).toHaveLength(3);

    geparst.texte = [];
    rerender(bau(z));
    // Auch neu gebaute Zeilen über denselben Einträgen (so baut `EtbPage` nach jedem Abruf).
    rerender(bau(zeilen([eintrag(3), eintrag(2), eintrag(1)])));
    expect(geparst.texte).toEqual([]);
  });

  it('ein neuer Eintrag parst nur seinen eigenen Text', () => {
    const alt = [eintrag(3), eintrag(2), eintrag(1)];
    const { rerender } = renderMitProviders(bau(zeilen(alt)));
    geparst.texte = [];

    rerender(bau(zeilen([eintrag(4), ...alt])));
    expect(geparst.texte).toEqual(['Eintrag 4']);
  });
});

describe('EtbZeitachse – Fensterung (LFH-947, D6)', () => {
  it('jede Stundengruppe trägt die Fensterklasse; Kopf, Marke und Zeilenklasse bleiben', () => {
    const { container } = renderMitProviders(
      bau(zeilen([eintrag(3, 12), eintrag(2, 11), eintrag(1, 10)])),
    );
    const gruppen = container.querySelectorAll('[role="group"]');
    expect(gruppen).toHaveLength(3);
    for (const g of gruppen) {
      expect(g).toHaveClass('etb-stundengruppe');
      expect(g.querySelector('h2')).not.toBeNull();
      const zeile = g.querySelector('[data-lfh="datensicht-karte"]');
      expect(zeile).not.toBeNull();
      expect(zeile!.getAttribute('data-zeile')).toMatch(/^eintrag-\d+$/);
    }
  });
});
