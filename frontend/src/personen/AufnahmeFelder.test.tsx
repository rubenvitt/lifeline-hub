import { Form } from 'antd';
import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderMitProviders } from '../test/utils';
import AufnahmeFelder, { skFlaechenStil, type AufnahmeModus } from './AufnahmeFelder';

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
    const beschriftungen = [...container.querySelectorAll('.ant-form-item label')]
      .map((l) => l.textContent);
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
