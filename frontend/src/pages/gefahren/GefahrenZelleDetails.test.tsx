import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { renderMitProviders } from '../../test/utils';
import GefahrenZelleDetails, { type GefahrenZelleDetailsProps } from './GefahrenZelleDetails';
import type { GefahrBewertung } from '../../api/types';

const zelle = (over: Partial<GefahrBewertung>): GefahrBewertung => ({
  id: 1,
  gefahrengebiet_id: 7,
  gefahrentyp: 'brand',
  schutzobjekt: 'menschen',
  warnstufe: 'hoch',
  beschreibung: null,
  gemeldet_von: null,
  aktualisiert_von: 1,
  erstellt_at: '',
  geaendert_at: '',
  ...over,
});

const PFLICHT: GefahrenZelleDetailsProps = {
  offen: true,
  kennung: 'brand×menschen',
  zelle: null,
  titel: 'Brand × Menschen',
  laeuft: false,
  onSpeichern: async () => {},
  onSchliessen: () => {},
};

function dialog(over: Partial<GefahrenZelleDetailsProps> = {}) {
  return <GefahrenZelleDetails {...PFLICHT} {...over} />;
}

/**
 * Direkt geprüft, nicht über die Matrix: dort ist ein Zellwechsel nur mit Schließen dazwischen
 * erreichbar, und schon `offen` löst den Vorbeleg-Effekt aus. Hier: gleiche Öffnung, andere Zelle —
 * der Beleg, dass `kennung` in den Abhängigkeiten steht.
 */
describe('GefahrenZelleDetails', () => {
  it('belegt neu, wenn die Kennung wechselt, ohne dass der Dialog schliesst', async () => {
    const { rerender } = renderMitProviders(
      dialog({ zelle: zelle({ beschreibung: 'Dachstuhl', gemeldet_von: 'KdoW' }) }),
    );
    expect(await screen.findByLabelText('Beschreibung')).toHaveValue('Dachstuhl');

    rerender(
      dialog({
        kennung: 'brand×tiere',
        titel: 'Brand × Tiere',
        zelle: zelle({
          id: 2,
          schutzobjekt: 'tiere',
          beschreibung: 'Weidezaun',
          gemeldet_von: null,
        }),
      }),
    );
    expect(screen.getByLabelText('Beschreibung')).toHaveValue('Weidezaun');
    expect(screen.getByLabelText('Gemeldet von')).toHaveValue('');
  });

  /**
   * Gegenprobe: dieselbe Kennung mit frisch geladenem Inhalt lässt das Formular in Ruhe — sonst
   * wäre „hängt an der Kennung" von „hängt an den Daten" nicht zu unterscheiden.
   */
  it('belegt NICHT neu, wenn nur der Inhalt derselben Zelle nachlädt', () => {
    const { rerender } = renderMitProviders(
      dialog({ zelle: zelle({ beschreibung: 'Dachstuhl' }) }),
    );
    rerender(dialog({ zelle: zelle({ beschreibung: 'vom Server' }) }));
    expect(screen.getByLabelText('Beschreibung')).toHaveValue('Dachstuhl');
  });
});
