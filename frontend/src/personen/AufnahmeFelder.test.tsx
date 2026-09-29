import { Form } from 'antd';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { renderMitProviders } from '../test/utils';
import AufnahmeFelder, {
  aufnahmeZuEingabe,
  skFlaechenStil,
  type AufnahmeModus,
} from './AufnahmeFelder';

/**
 * Die Feldgruppe der Personen-Aufnahme — geprüft wird, was in beiden Mounts gilt; die Wege durch
 * die Hülle prüfen die Aufrufer.
 */
function zeige(modus: AufnahmeModus = 'schnell') {
  return renderMitProviders(
    <Form>
      <AufnahmeFelder modus={modus} />
    </Form>,
  );
}

describe('AufnahmeFelder — Sichtungskategorie', () => {
  it('stellt die sechs Kategorien als benannte Auswahlflächen bereit', () => {
    zeige();
    // ÜBER DEN NAMEN abgefragt: `label[for]` benennt eine `Radio.Group` nicht, ein blankes
    // `getByRole('radiogroup')` wäre auch ohne `aria-label` grün.
    const gruppe = screen.getByRole('radiogroup', { name: 'Sichtungskategorie' });
    const flaechen = within(gruppe).getAllByRole('radio');
    expect(flaechen).toHaveLength(6);
    // Die Reihenfolge ist die Dringlichkeit, nicht die Aufzählung des Enums.
    expect(gruppe.textContent).toBe('SK ISK IISK IIISK IVtotunverletzt');
  });

  it('steht ganz oben — vor Geschlecht, Alter und Antreffort', () => {
    const { container } = zeige();
    const beschriftungen = [...container.querySelectorAll('.ant-form-item label')].map(
      (l) => l.textContent,
    );
    expect(beschriftungen[0]).toBe('Sichtungskategorie');
  });

  /**
   * Der API-Vertrag: `status: 'vermisst'` + `sichtung` ist 422. Als Paar, sonst wäre „fehlt im
   * Vermisst-Modus" auch grün, wenn es das Feld gar nicht gäbe.
   */
  it('fehlt im Vermisst-Modus und steht im Betroffen-Modus', () => {
    const { unmount } = zeige('vermisst');
    expect(screen.queryByRole('radiogroup')).not.toBeInTheDocument();
    unmount();
    zeige('betroffen');
    expect(screen.getByRole('radiogroup')).toBeInTheDocument();
  });

  it('trägt die Farbe im Etikett, nicht als Fläche', () => {
    zeige();
    // Die Farbe steht an einem `Tag` INNERHALB der Fläche; ein eingefärbter Radio-Button wäre
    // Text in einer Farbe mit unzugesichertem Kontrast.
    const gruppe = screen.getByRole('radiogroup');
    expect(gruppe.querySelectorAll('.ant-tag')).toHaveLength(6);
  });
});

describe('AufnahmeFelder — Feldbudget', () => {
  it('zeigt vier Felder, und der Name liegt unter „Weitere Angaben"', async () => {
    const { container } = zeige();
    expect(container.querySelectorAll('.ant-form-item')).toHaveLength(4);
    // Über die Rolle: das `Form.Item`-Label hängt an der GRUPPE, `getByLabelText` fände alle sechs
    // Radio-Eingaben.
    expect(screen.getByRole('radiogroup')).toBeInTheDocument();
    expect(screen.getByLabelText('Geschlecht')).toBeInTheDocument();
    expect(screen.getByLabelText('Geschätztes Alter (Jahre)')).toBeInTheDocument();
    expect(screen.getByLabelText('Antreffort')).toBeInTheDocument();
    // Der Name hat der Sichtung im sichtbaren Budget Platz gemacht.
    expect(screen.queryByLabelText('Name')).not.toBeInTheDocument();
  });
});

describe('AufnahmeFelder — Zustand, Koordinate, vermisst seit (LFH-613)', () => {
  const feldZahl = (c: HTMLElement) => c.querySelectorAll('.ant-form-item').length;

  it.each<[AufnahmeModus, number]>([
    ['schnell', 4],
    ['betroffen', 4],
    ['vermisst', 3],
  ])(
    '%s: sichtbares Budget unverändert (%i), die neuen Felder erst nach dem Aufklappen',
    async (modus, sichtbar) => {
      const { container } = zeige(modus);
      expect(feldZahl(container)).toBe(sichtbar);
      for (const label of ['Zustand', 'Koordinate', 'vermisst seit']) {
        expect(screen.queryByLabelText(label)).not.toBeInTheDocument();
      }
      await userEvent.click(screen.getByRole('button', { name: /Weitere Angaben/ }));
      await waitFor(() => expect(screen.getByLabelText('Notiz')).toBeInTheDocument());
      expect(feldZahl(container)).toBeGreaterThan(sichtbar);
      if (modus === 'vermisst') {
        // Eine vermisste Person ist nicht angetroffen: kein Zustand, kein Fundort.
        expect(screen.getByLabelText('vermisst seit')).toBeInTheDocument();
        expect(screen.queryByLabelText('Zustand')).not.toBeInTheDocument();
        expect(screen.queryByLabelText('Koordinate')).not.toBeInTheDocument();
      } else {
        // Ohne Status `vermisst` wäre „vermisst seit" ein 422.
        expect(screen.getByLabelText('Zustand')).toBeInTheDocument();
        expect(screen.getByLabelText('Koordinate')).toBeInTheDocument();
        expect(screen.queryByLabelText('vermisst seit')).not.toBeInTheDocument();
      }
    },
  );
});

describe('aufnahmeZuEingabe', () => {
  it('zerlegt die Koordinate in antreff_lat/antreff_lon und lässt den Text weg', () => {
    expect(aufnahmeZuEingabe({ zustand: 'gehfähig', koordinate: '52,2691/9,1342' })).toEqual({
      zustand: 'gehfähig',
      antreff_lat: 52.2691,
      antreff_lon: 9.1342,
    });
  });

  it('schickt ohne Angabe weder Koordinate noch „vermisst seit" — auch nicht als null', () => {
    const e = aufnahmeZuEingabe({
      antreff_ort: 'Brücke',
      koordinate: '  ',
      vermisst_seit: undefined,
    });
    expect(e).toEqual({ antreff_ort: 'Brücke' });
    expect(e).not.toHaveProperty('vermisst_seit');
    expect(e).not.toHaveProperty('antreff_lat');
  });

  it('reicht „vermisst seit" als Wire-String durch', () => {
    expect(aufnahmeZuEingabe({ vermisst_seit: '2026-09-22 06:00:00' })).toEqual({
      vermisst_seit: '2026-09-22 06:00:00',
    });
  });
});

describe('skFlaechenStil()', () => {
  /**
   * Rein gerufen (jsdom rechnet kein Layout). Die Böden stehen als LITERALE da, sonst prüften sie
   * den Token gegen sich selbst.
   */
  it('hält 64 px als Boden und folgt darüber der Dichtestufe', () => {
    expect(skFlaechenStil({ controlHeight: 30 }).minHeight).toBe(64); // kompakt
    expect(skFlaechenStil({ controlHeight: 48 }).minHeight).toBe(64); // komfortabel
    expect(skFlaechenStil({ controlHeight: 72 }).minHeight).toBe(72); // Handschuh
  });

  it('wächst über zwei Dichtestufen — ein Festwert fiele hier durch', () => {
    expect(skFlaechenStil({ controlHeight: 72 }).minHeight).toBeGreaterThan(
      Number(skFlaechenStil({ controlHeight: 30 }).minHeight),
    );
  });
});
