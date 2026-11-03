import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { GEFAHR_BESCHREIBUNG_MAX, GEFAHR_GEMELDET_VON_MAX } from '../../api/eingabegrenzen';
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
    expect(await screen.findByLabelText('Erläuterung')).toHaveValue('Dachstuhl');

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
    expect(screen.getByLabelText('Erläuterung')).toHaveValue('Weidezaun');
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
    expect(screen.getByLabelText('Erläuterung')).toHaveValue('Dachstuhl');
  });

  /**
   * Grenzen wie beim Server (LLH-1366): „Gemeldet von“ trägt sie als `maxLength`, die Erläuterung
   * den Zähler. Eine schon zu lange Erläuterung wird nicht gekürzt, nennt die Überlänge und sperrt
   * das Speichern. Mutationsprobe: ohne `maxLength` fällt die erste Prüfung, ohne `zeichenRegel`
   * die zweite.
   */
  it('Grenzen: „Gemeldet von“ mit maxLength wie der Server', async () => {
    renderMitProviders(dialog());
    expect(await screen.findByLabelText('Gemeldet von')).toHaveAttribute(
      'maxlength',
      String(GEFAHR_GEMELDET_VON_MAX),
    );
  });

  it('Grenzen: eine zu lange Erläuterung nennt die Überlänge, kürzt nicht und speichert nicht', async () => {
    const onSpeichern = vi.fn(async () => {});
    const nutzer = userEvent.setup();
    const zuLang = 'x'.repeat(GEFAHR_BESCHREIBUNG_MAX + 1);
    renderMitProviders(dialog({ zelle: zelle({ beschreibung: zuLang }), onSpeichern }));
    const feld = await screen.findByLabelText('Erläuterung');
    expect(feld).toHaveValue(zuLang);

    await nutzer.click(screen.getByRole('button', { name: 'Speichern' }));

    expect(
      await screen.findByText('Erläuterung darf höchstens 2.000 Zeichen lang sein'),
    ).toBeInTheDocument();
    expect(screen.getByText(/2\.001 \/ 2\.000 · zu lang/)).toBeInTheDocument();
    expect(feld).toHaveValue(zuLang);
    expect(onSpeichern).not.toHaveBeenCalled();
  });
});
