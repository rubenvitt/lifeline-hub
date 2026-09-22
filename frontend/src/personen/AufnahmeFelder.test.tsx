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
 * Die Feldgruppe der Personen-Aufnahme (LFH-340 · C5, Befund H31).
 *
 * Sie ist ein Bauteil mit zwei Mounts — Schnellerfassungs-Modal und Aufnahme-Route. Geprüft
 * wird hier, was in beiden gilt; die Wege durch die Hülle (Enter, Serie, Fokus) prüfen die
 * Aufrufer, weil sie erst mit ihr entstehen.
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
    // ÜBER DEN NAMEN abgefragt, nicht blank: das `Form.Item`-Label allein benennt die Gruppe
    // NICHT — `label[for]` gilt nur für labelable elements, und eine `Radio.Group` ist ein
    // `div[role="radiogroup"]`. Ein blankes `getByRole('radiogroup')` wäre auch ohne
    // `aria-label` grün und beliebe die Zusicherung schuldig.
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
   * Nicht Kosmetik, sondern der API-Vertrag: `POST /personen` beantwortet die Kombination
   * `status: 'vermisst'` + `sichtung` mit 422. Ein Feld im Vermisst-Modus könnte also nur
   * einen Fehler erzeugen. Das Paar ist Pflicht — „im Vermisst-Modus fehlt es" allein wäre
   * auch grün, wenn es das Feld gar nicht mehr gäbe.
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
    // Die Farbe steht an einem `Tag` INNERHALB der Fläche — dieselbe Darstellung wie in
    // Liste und Detailseite. Ein eingefärbter Radio-Button wäre eine Textfläche in einer
    // Farbe, deren Kontrast niemand zugesichert hat.
    const gruppe = screen.getByRole('radiogroup');
    expect(gruppe.querySelectorAll('.ant-tag')).toHaveLength(6);
  });
});

describe('AufnahmeFelder — Feldbudget', () => {
  it('zeigt vier Felder, und der Name liegt unter „Weitere Angaben"', async () => {
    const { container } = zeige();
    expect(container.querySelectorAll('.ant-form-item')).toHaveLength(4);
    // Über die Rolle, nicht über das Label: das `Form.Item`-Label hängt an der GRUPPE, und
    // `getByLabelText` fände darüber alle sechs Radio-Eingaben.
    expect(screen.getByRole('radiogroup')).toBeInTheDocument();
    expect(screen.getByLabelText('Geschlecht')).toBeInTheDocument();
    expect(screen.getByLabelText('Geschätztes Alter (Jahre)')).toBeInTheDocument();
    expect(screen.getByLabelText('Antreffort')).toBeInTheDocument();
    // Bis C5 war der Name sichtbar; er hat der Sichtung Platz gemacht.
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
   * Rein gerufen, ohne Rendern: jsdom rechnet kein Layout, ein gemessenes Pixel gäbe es dort
   * nicht. Die Böden stehen als LITERALE da — aus dem Token zurückgelesen prüften sie den
   * Token gegen sich selbst.
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
