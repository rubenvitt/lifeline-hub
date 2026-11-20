import { Button, Form } from 'antd';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import {
  PERSON_ANGABE_MAX,
  PERSON_NAME_MAX,
  PERSON_NOTIZ_MAX,
  PERSON_ZUSTAND_MAX,
} from '../api/eingabegrenzen';
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

  it('steht ganz oben — vor Geschlecht, Alter und Fundort', () => {
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
    expect(screen.getByLabelText('Fundort')).toBeInTheDocument();
    // Der Name hat der Sichtung im sichtbaren Budget Platz gemacht.
    expect(screen.queryByLabelText('Name')).not.toBeInTheDocument();
  });
});

describe('AufnahmeFelder — Zustand, Koordinate, vermisst seit (LFH-613)', () => {
  const feldZahl = (c: HTMLElement) => c.querySelectorAll('.ant-form-item').length;

  it.each<[AufnahmeModus, number]>([
    ['erfassen', 4],
    ['vermisst', 4],
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

describe('AufnahmeFelder — Anlass der Hilfeleistung (LLH-1566)', () => {
  it('liegt unter „Weitere Angaben“ als Flächenwahl des festen Katalogs', async () => {
    zeige();
    expect(screen.queryByRole('radiogroup', { name: 'Anlass' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Weitere Angaben/ }));
    const gruppe = await screen.findByRole('radiogroup', { name: 'Anlass' });
    expect(
      within(gruppe)
        .getAllByRole('radio')
        .map((r) => r.textContent),
    ).toEqual([
      'Verletzung',
      'Internistisch',
      'Neurologisch',
      'Intoxikation',
      'Hitze / Kälte',
      'Allergie / Insektenstich',
      'Psychisch',
      'Sonstiges',
    ]);
  });

  it('fehlt bei einer vermissten Person', async () => {
    zeige('vermisst');
    await userEvent.click(screen.getByRole('button', { name: /Weitere Angaben/ }));
    await waitFor(() => expect(screen.getByLabelText('Notiz')).toBeInTheDocument());
    expect(screen.queryByRole('radiogroup', { name: 'Anlass' })).not.toBeInTheDocument();
  });
});

describe('aufnahmeZuEingabe', () => {
  it('nimmt Text und Koordinate aus dem Ortsfeld des Fundorts (LLH-1407)', () => {
    expect(
      aufnahmeZuEingabe({
        antreff_ort: {
          text: ' Deichweg 3 ',
          koordinate: { lat: 52.2691, lon: 9.1342 },
          quelle: 'adresse',
        },
      }),
    ).toEqual({ antreff_ort: 'Deichweg 3', antreff_lat: 52.2691, antreff_lon: 9.1342 });
  });

  it('zerlegt die Koordinate in antreff_lat/antreff_lon und lässt den Text weg', () => {
    expect(aufnahmeZuEingabe({ zustand: 'gehfähig', koordinate: '52,2691/9,1342' })).toEqual({
      zustand: 'gehfähig',
      antreff_lat: 52.2691,
      antreff_lon: 9.1342,
    });
  });

  it('schickt ohne Angabe weder Koordinate noch „vermisst seit" — auch nicht als null', () => {
    const e = aufnahmeZuEingabe({
      antreff_ort: { text: 'Brücke', koordinate: null },
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

  it('schickt den Anlass mit, einen zurückgenommenen nicht (LLH-1566)', () => {
    expect(aufnahmeZuEingabe({ anlass: 'intoxikation' })).toEqual({ anlass: 'intoxikation' });
    expect(aufnahmeZuEingabe({ anlass: null })).toEqual({});
  });

  it('reicht „vermisst seit" als Wire-String durch', () => {
    expect(aufnahmeZuEingabe({ vermisst_seit: '2026-09-22 06:00:00' })).toEqual({
      vermisst_seit: '2026-09-22 06:00:00',
    });
  });
});

/**
 * Grenzen der Personen-Freitexte (LLH-1329, Spec `eingabegrenzen`): jedes Freitextfeld der Maske
 * zählt ab 80 % wie der Server, kürzt nie und sperrt das Absenden mit dessen Wortlaut. Je Feld
 * als Paar: genau an der Grenze geht ab, ein Zeichen mehr nicht. Mutationsprobe: `zeichenRegel`
 * an einem Feld entfernt → dessen „ein Zeichen mehr“ sendet und wird rot; `count` entfernt → der
 * Zähler fehlt.
 */
describe('AufnahmeFelder — Grenzen der Freitexte (LLH-1329)', () => {
  function mitAbsenden(modus: AufnahmeModus) {
    const onFinish = vi.fn();
    renderMitProviders(
      <Form onFinish={onFinish}>
        <AufnahmeFelder modus={modus} />
        <Button htmlType="submit">Absenden</Button>
      </Form>,
    );
    return { onFinish };
  }

  const zahl = (n: number) => n.toLocaleString('de-DE');

  it.each<[AufnahmeModus, string, number]>([
    ['erfassen', 'Name', PERSON_NAME_MAX],
    ['erfassen', 'Vorname', PERSON_NAME_MAX],
    ['erfassen', 'Fundort', PERSON_ANGABE_MAX],
    ['erfassen', 'Zustand / Verdacht', PERSON_ZUSTAND_MAX],
    ['erfassen', 'Notiz', PERSON_NOTIZ_MAX],
    ['vermisst', 'Melder / Kontakt', PERSON_ANGABE_MAX],
  ])(
    '%s · %s: Zähler, Sperre mit dem Wortlaut des Servers, nie gekürzt',
    async (modus, label, max) => {
      const { onFinish } = mitAbsenden(modus);
      if (label !== 'Fundort') {
        await userEvent.click(screen.getByRole('button', { name: /Weitere Angaben/ }));
      }
      const feld = await screen.findByLabelText(label);

      fireEvent.change(feld, { target: { value: 'x'.repeat(max + 1) } });
      expect(feld).toHaveValue('x'.repeat(max + 1));
      expect(screen.getByText(`${zahl(max + 1)} / ${zahl(max)} · zu lang`)).toBeInTheDocument();
      await userEvent.click(screen.getByRole('button', { name: 'Absenden' }));
      expect(
        await screen.findByText(`${label} darf höchstens ${zahl(max)} Zeichen lang sein`),
      ).toBeInTheDocument();
      expect(onFinish).not.toHaveBeenCalled();
      expect(feld).toHaveValue('x'.repeat(max + 1));

      fireEvent.change(feld, { target: { value: 'x'.repeat(max) } });
      expect(screen.getByText(`${zahl(max)} / ${zahl(max)}`)).toBeInTheDocument();
      await userEvent.click(screen.getByRole('button', { name: 'Absenden' }));
      await waitFor(() => expect(onFinish).toHaveBeenCalledTimes(1));
    },
  );
});

/**
 * LLH-1765: „Vermisst melden“ ohne jede Angabe legte einen Geisterdatensatz an, und der Name lag
 * eingeklappt. Bei Vermissten ist der Name das Erste, wonach gesucht wird.
 */
describe('AufnahmeFelder — Vermisst melden (LLH-1765)', () => {
  function mitAbsenden(modus: AufnahmeModus) {
    const onFinish = vi.fn();
    renderMitProviders(
      <Form onFinish={onFinish}>
        <AufnahmeFelder modus={modus} />
        <Button htmlType="submit">Absenden</Button>
      </Form>,
    );
    return { onFinish };
  }

  const HINWEIS = 'Mindestens eine Angabe zur vermissten Person';

  it('zeigt Name, Vorname, Geschlecht und Fundort oben; das Alter liegt unter „Weitere Angaben“', async () => {
    const { container } = zeige('vermisst');
    const beschriftungen = [...container.querySelectorAll('.ant-form-item label')].map(
      (l) => l.textContent,
    );
    expect(beschriftungen).toEqual(['Name', 'Vorname', 'Geschlecht', 'Fundort']);
    await userEvent.click(screen.getByRole('button', { name: /Weitere Angaben/ }));
    expect(await screen.findByLabelText('Geschätztes Alter (Jahre)')).toBeInTheDocument();
    // Name und Vorname stehen nur einmal, nicht zusätzlich eingeklappt.
    expect(screen.getAllByLabelText('Name')).toHaveLength(1);
    expect(screen.getAllByLabelText('Vorname')).toHaveLength(1);
  });

  it('die allgemeine Maske behält Alter oben und Name eingeklappt', () => {
    const { container } = zeige('erfassen');
    const beschriftungen = [...container.querySelectorAll('.ant-form-item label')].map(
      (l) => l.textContent,
    );
    expect(beschriftungen).toEqual([
      'Sichtungskategorie',
      'Geschlecht',
      'Geschätztes Alter (Jahre)',
      'Fundort',
    ]);
  });

  it('ohne jede Angabe hält die Maske an und nennt den Grund', async () => {
    const { onFinish } = mitAbsenden('vermisst');
    await userEvent.click(screen.getByRole('button', { name: 'Absenden' }));
    expect(await screen.findByText(HINWEIS)).toBeInTheDocument();
    expect(onFinish).not.toHaveBeenCalled();
  });

  it('nur Leerzeichen im Namen zählen nicht als Angabe', async () => {
    const { onFinish } = mitAbsenden('vermisst');
    await userEvent.type(screen.getByLabelText('Name'), '   ');
    await userEvent.click(screen.getByRole('button', { name: 'Absenden' }));
    expect(await screen.findByText(HINWEIS)).toBeInTheDocument();
    expect(onFinish).not.toHaveBeenCalled();
  });

  it('„unbekannt“ als Geschlecht zählt nicht als Angabe', async () => {
    const { onFinish } = mitAbsenden('vermisst');
    await userEvent.click(screen.getByRole('combobox', { name: 'Geschlecht' }));
    const option = (await screen.findAllByText('unbekannt')).find((el) =>
      el.closest('.ant-select-item-option'),
    );
    await userEvent.click(option!);
    await userEvent.click(screen.getByRole('button', { name: 'Absenden' }));
    expect(await screen.findByText(HINWEIS)).toBeInTheDocument();
    expect(onFinish).not.toHaveBeenCalled();
  });

  it.each([
    ['Name', 'Müller'],
    ['Vorname', 'Anna'],
    ['Fundort', 'Bahnhof'],
  ])('eine Angabe im Feld „%s“ genügt', async (label, wert) => {
    const { onFinish } = mitAbsenden('vermisst');
    await userEvent.type(screen.getByLabelText(label), wert);
    await userEvent.click(screen.getByRole('button', { name: 'Absenden' }));
    await waitFor(() => expect(onFinish).toHaveBeenCalledTimes(1));
    expect(screen.queryByText(HINWEIS)).not.toBeInTheDocument();
  });

  it.each([
    ['Melder / Kontakt', 'Tochter, 0170 1234567'],
    ['Notiz', 'rote Jacke'],
    ['Geschätztes Alter (Jahre)', '80'],
  ])('auch eine eingeklappte Angabe („%s“) genügt', async (label, wert) => {
    const { onFinish } = mitAbsenden('vermisst');
    await userEvent.click(screen.getByRole('button', { name: /Weitere Angaben/ }));
    await userEvent.type(await screen.findByLabelText(label), wert);
    await userEvent.click(screen.getByRole('button', { name: 'Absenden' }));
    await waitFor(() => expect(onFinish).toHaveBeenCalledTimes(1));
  });

  it('der Grund verschwindet, sobald eine Angabe dasteht', async () => {
    mitAbsenden('vermisst');
    await userEvent.click(screen.getByRole('button', { name: 'Absenden' }));
    expect(await screen.findByText(HINWEIS)).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Vorname'), 'Anna');
    await waitFor(() => expect(screen.queryByText(HINWEIS)).not.toBeInTheDocument());
  });

  it('die allgemeine Maske verlangt keine Angabe: eine unbekannte Person darf leer entstehen', async () => {
    const { onFinish } = mitAbsenden('erfassen');
    await userEvent.click(screen.getByRole('button', { name: 'Absenden' }));
    await waitFor(() => expect(onFinish).toHaveBeenCalledTimes(1));
  });
});
