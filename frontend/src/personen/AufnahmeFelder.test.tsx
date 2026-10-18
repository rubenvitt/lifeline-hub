import { Form } from 'antd';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { renderMitProviders } from '../test/utils';
import AufnahmeFelder, { aufnahmeZuEingabe, type AufnahmeModus } from './AufnahmeFelder';

/**
 * Die Feldgruppe der Personen-Aufnahme — geprüft wird, was in beiden Mounts gilt; die Wege durch
 * die Hülle prüfen die Aufrufer.
 */
function zeige(modus: AufnahmeModus = 'erfassen') {
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
    expect(flaechen.map((f) => f.getAttribute('data-sichtung'))).toEqual([
      'sk1',
      'sk2',
      'sk3',
      'sk4',
      'tot',
      'unverletzt',
    ]);
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
  it('fehlt im Vermisst-Modus und steht in der allgemeinen Maske', () => {
    const { unmount } = zeige('vermisst');
    expect(screen.queryByRole('radiogroup')).not.toBeInTheDocument();
    unmount();
    zeige('erfassen');
    expect(screen.getByRole('radiogroup')).toBeInTheDocument();
  });

  it('nutzt die Sichtungswahl mit Flächen statt Radio-Knöpfen mit Farbfeld (LLH-1083)', () => {
    zeige();
    const gruppe = screen.getByRole('radiogroup', { name: 'Sichtungskategorie' });
    expect(gruppe).toHaveAttribute('data-lfh', 'sichtungswahl');
    expect(gruppe.querySelectorAll('.ant-tag, .ant-radio-button-wrapper')).toHaveLength(0);
  });

  it('nimmt eine Wahl beim zweiten Tipp zurück — eine Erfassung ohne Sichtung bleibt erlaubt', async () => {
    zeige();
    const sk3 = screen.getByRole('radio', { name: /^SK III,/ });
    await userEvent.click(sk3);
    expect(sk3).toBeChecked();
    await userEvent.click(sk3);
    expect(sk3).not.toBeChecked();
  });
});

/**
 * EINE Maske (LFH-963, Entscheidung 9): sie sagt, was sie anlegt. Als Paar mit „Vermisst melden",
 * das einen eigenen Status hat — sonst wäre die Zeile auch grün, wenn sie in jedem Modus stünde.
 */
describe('AufnahmeFelder — Folgestatus (LFH-963)', () => {
  it('die allgemeine Maske nennt „erfasst" und „mit Sichtung → betroffen"', () => {
    const { container } = zeige('erfassen');
    const zeile = container.querySelector('[data-lfh="folgestatus"]');
    expect(zeile).toHaveTextContent('Status: erfasst · mit Sichtung → betroffen');
    // Text, kein Feld: das Budget zählt ihn nicht mit.
    expect(zeile?.closest('.ant-form-item')).toBeNull();
  });

  it('„Vermisst melden" trägt die Zeile nicht', () => {
    const { container } = zeige('vermisst');
    expect(container.querySelector('[data-lfh="folgestatus"]')).toBeNull();
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
    ['erfassen', 4],
    ['vermisst', 3],
  ])(
    '%s: sichtbares Budget unverändert (%i), die neuen Felder erst nach dem Aufklappen',
    async (modus, sichtbar) => {
      const { container } = zeige(modus);
      expect(feldZahl(container)).toBe(sichtbar);
      for (const label of ['Zustand / Verdacht', 'Koordinate', 'vermisst seit']) {
        expect(screen.queryByLabelText(label)).not.toBeInTheDocument();
      }
      await userEvent.click(screen.getByRole('button', { name: /Weitere Angaben/ }));
      await waitFor(() => expect(screen.getByLabelText('Notiz')).toBeInTheDocument());
      expect(feldZahl(container)).toBeGreaterThan(sichtbar);
      if (modus === 'vermisst') {
        // Eine vermisste Person ist nicht angetroffen: kein Zustand, kein Fundort.
        expect(screen.getByLabelText('vermisst seit')).toBeInTheDocument();
        expect(screen.queryByLabelText('Zustand / Verdacht')).not.toBeInTheDocument();
        expect(screen.queryByLabelText('Koordinate')).not.toBeInTheDocument();
      } else {
        // Ohne Status `vermisst` wäre „vermisst seit" ein 422.
        expect(screen.getByLabelText('Zustand / Verdacht')).toBeInTheDocument();
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

  it('schickt die Bestätigung am Gerät nur mit einer Erst-Sichtung (LFH-1046, sonst 422)', () => {
    expect(aufnahmeZuEingabe({ sichtung: 'sk1', bestaetigt_personal_id: 5 })).toEqual({
      sichtung: 'sk1',
      bestaetigt_personal_id: 5,
    });
    expect(aufnahmeZuEingabe({ bestaetigt_personal_id: 5 })).toEqual({});
  });

  it('macht aus einer zurückgenommenen Wahl eine Erfassung ohne Sichtung (LLH-1083)', () => {
    expect(aufnahmeZuEingabe({ sichtung: null, bestaetigt_personal_id: 5 })).toEqual({});
  });

  it('reicht „vermisst seit" als Wire-String durch', () => {
    expect(aufnahmeZuEingabe({ vermisst_seit: '2026-09-22 06:00:00' })).toEqual({
      vermisst_seit: '2026-09-22 06:00:00',
    });
  });
});
