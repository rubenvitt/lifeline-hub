import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Form } from 'antd';
import type { ReactNode } from 'react';
import DokumentEntwurf, { type AbschnittAktion } from './DokumentEntwurf';
import type { DokumentAbschnitt } from './dokumentEntwurfKern';
import { vorlage } from '../lageberichte/vorlagen';

const acht = vorlage('lagebeurteilung')!.abschnitte;
const [erster, zweiter] = acht;

/** Mit Hilfetext wie die SKK-Unterpunkte des Befehls. Modulkonstante: identitätsstabil. */
const MIT_HILFE: readonly DokumentAbschnitt[] = [
  { schluessel: 'lage', label: 'Lage', hilfetext: 'a. Allgemeine Lage' },
  { schluessel: 'auftrag', label: 'Auftrag' },
];

interface PrueflingProps {
  abschnitte?: readonly DokumentAbschnitt[];
  start?: Record<string, string>;
  aktion?: AbschnittAktion;
  kopf?: ReactNode;
  gliederungKopf?: ReactNode;
  einstieg?: string;
}

/** Der Baustein steht wie auf der Seite IN einem `<Form>` mit dessen Instanz. */
function Pruefling({
  abschnitte = acht,
  start,
  aktion,
  kopf,
  gliederungKopf,
  einstieg,
}: PrueflingProps) {
  const [form] = Form.useForm();
  return (
    <Form form={form} layout="vertical" initialValues={start}>
      <DokumentEntwurf
        form={form}
        abschnitte={abschnitte}
        aktion={aktion}
        kopf={kopf}
        gliederungKopf={gliederungKopf}
        einstieg={einstieg}
      />
    </Form>
  );
}

function gliederung() {
  return screen.getByRole('navigation', { name: 'Gliederung' });
}

const scrollIntoView = vi.fn();
beforeEach(() => {
  scrollIntoView.mockClear();
  Element.prototype.scrollIntoView = scrollIntoView;
});
afterEach(() => {
  // jsdom kennt es nicht; der Baustein ruft es optional.
  delete (Element.prototype as Partial<Element>).scrollIntoView;
});

describe('DokumentEntwurf — Gliederung und Abschnitte', () => {
  it('listet jeden Abschnitt in der Gliederung und markiert leere mit dem Wort „leer“', async () => {
    render(<Pruefling start={{ [erster.schluessel]: 'Text' }} />);
    const sprung = within(gliederung()).getAllByRole('button');
    expect(sprung).toHaveLength(8);
    // Zweiter Kanal (WCAG 1.4.1): das Wort, nicht nur Farbe oder Zeichen.
    await waitFor(() =>
      expect(within(gliederung()).getByRole('button', { name: erster.label })).toBeVisible(),
    );
    expect(
      within(gliederung()).getByRole('button', { name: `${zweiter.label} leer` }),
    ).toBeVisible();
    // Die Zeichen sind dekorativ.
    for (const b of sprung) expect(within(b).queryAllByRole('img')).toHaveLength(0);
  });

  it('nennt den Füllstand im Paneelkopf', async () => {
    render(<Pruefling start={{ [erster.schluessel]: 'Text', [zweiter.schluessel]: '  ' }} />);
    await waitFor(() => expect(screen.getByText('1/8 Abschnitte')).toBeVisible());
  });

  it('zeigt alle Abschnitte offen untereinander, je mit Kopf (h3) und Textfeld', () => {
    render(<Pruefling />);
    const bearbeiten = screen.getByRole('tabpanel', { name: 'Bearbeiten' });
    expect(within(bearbeiten).getAllByRole('textbox')).toHaveLength(8);
    for (const a of acht) {
      expect(within(bearbeiten).getByRole('heading', { level: 3, name: a.label })).toBeVisible();
      expect(within(bearbeiten).getByRole('textbox', { name: a.label })).toBeVisible();
    }
    // Kein Akkordeon, keine Vorschau-Spalte.
    expect(screen.queryByRole('tab', { name: /leer/ })).toBeNull();
    expect(screen.queryByRole('checkbox')).toBeNull();
  });

  it('verknüpft den Hilfetext als Beschreibung des Textfelds', () => {
    render(<Pruefling abschnitte={MIT_HILFE} />);
    expect(screen.getByRole('textbox', { name: 'Lage' })).toHaveAccessibleDescription(
      'a. Allgemeine Lage',
    );
    expect(screen.getByRole('textbox', { name: 'Auftrag' })).not.toHaveAttribute(
      'aria-describedby',
    );
  });

  it('setzt die Aktion der Seite in den Kopf des Abschnitts', () => {
    const aktion: AbschnittAktion = (a) =>
      a.schluessel === zweiter.schluessel ? <button type="button">Übernehmen</button> : null;
    render(<Pruefling aktion={aktion} />);
    const knoepfe = screen.getAllByRole('button', { name: 'Übernehmen' });
    expect(knoepfe).toHaveLength(1);
    const abschnitt = knoepfe[0].closest('[data-lfh="entwurf-abschnitt"]') as HTMLElement;
    expect(within(abschnitt).getByRole('heading', { level: 3 })).toHaveTextContent(zweiter.label);
    expect(knoepfe[0].closest('[data-lfh="abschnitt-kopf"]')).not.toBeNull();
  });

  it('stellt den Kopfblock der Seite über die Abschnitte', () => {
    render(<Pruefling kopf={<label>Titel</label>} />);
    const kopf = document.querySelector('[data-lfh="entwurf-kopf"]');
    expect(kopf).toHaveTextContent('Titel');
  });
});

describe('DokumentEntwurf — Sprung und Einstieg', () => {
  it('springt aus der Gliederung zum Abschnitt und fokussiert sein Feld', async () => {
    render(<Pruefling />);
    await userEvent.click(
      within(gliederung()).getByRole('button', { name: `${acht[5].label} leer` }),
    );
    const feld = screen.getByRole('textbox', { name: acht[5].label });
    expect(feld).toHaveFocus();
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(feld.closest('section')).toBe(scrollIntoView.mock.instances[0]);
  });

  it('fokussiert beim Einhängen den Einstiegs-Abschnitt', async () => {
    render(<Pruefling einstieg={zweiter.schluessel} />);
    await waitFor(() => expect(screen.getByRole('textbox', { name: zweiter.label })).toHaveFocus());
  });
});

describe('DokumentEntwurf — Lesefassung', () => {
  it('schaltet das ganze Dokument auf die Lesefassung, die Editoren bleiben eingehängt', async () => {
    render(<Pruefling start={{ [erster.schluessel]: 'Lage **ruhig**' }} />);
    await userEvent.click(screen.getByRole('tab', { name: 'Lesefassung' }));
    const lesen = screen.getByRole('tabpanel', { name: 'Lesefassung' });
    expect(within(lesen).getByRole('heading', { level: 3, name: erster.label })).toBeVisible();
    expect(within(lesen).getByText('ruhig').tagName).toBe('STRONG');
    // Leere Abschnitte stehen mit Strich, nicht weggelassen.
    expect(within(lesen).getAllByText('—')).toHaveLength(7);
    // Sonst schickte ein Speichern die Abschnitte leer: rc-field-form liefert nur eingehängte
    // Felder.
    const bearbeiten = document.querySelector<HTMLElement>('[data-lfh="entwurf-abschnitte"]')!;
    expect(bearbeiten).not.toBeVisible();
    expect(within(bearbeiten).getAllByRole('textbox', { hidden: true })).toHaveLength(8);
    // Zurück: das Bearbeiten steht wieder.
    await userEvent.click(screen.getByRole('tab', { name: 'Bearbeiten' }));
    expect(screen.getAllByRole('textbox')).toHaveLength(8);
  });

  it('liest die ungespeicherten Werte des Formulars, nicht den Serverstand', async () => {
    render(<Pruefling />);
    fireEvent.change(screen.getByRole('textbox', { name: zweiter.label }), {
      target: { value: 'eben getippt' },
    });
    await userEvent.click(screen.getByRole('tab', { name: 'Lesefassung' }));
    expect(
      within(screen.getByRole('tabpanel', { name: 'Lesefassung' })).getByText('eben getippt'),
    ).toBeVisible();
  });

  it('springt in der Lesefassung zum Abschnitt der Lesefassung, ohne Fokus ins Feld', async () => {
    render(<Pruefling />);
    await userEvent.click(screen.getByRole('tab', { name: 'Lesefassung' }));
    await userEvent.click(
      within(gliederung()).getByRole('button', { name: `${acht[3].label} leer` }),
    );
    const ziel = scrollIntoView.mock.instances[0] as unknown as HTMLElement;
    expect(screen.getByRole('tabpanel', { name: 'Lesefassung' })).toContainElement(ziel);
    expect(ziel).toHaveTextContent(acht[3].label);
  });
});

describe('DokumentEntwurf — Kopf der Gliederung (LLH-1081)', () => {
  it('setzt die Aktion der Seite über die Sprungleiste, außerhalb der Navigation', () => {
    render(<Pruefling gliederungKopf={<button type="button">Füllen</button>} />);
    const knopf = screen.getByRole('button', { name: 'Füllen' });
    const kopf = knopf.closest('[data-lfh="gliederung-kopf"]');
    expect(kopf).not.toBeNull();
    // Keine Aktion IN der Landmarke „Gliederung“: die trägt nur Sprünge.
    expect(within(gliederung()).queryByRole('button', { name: 'Füllen' })).toBeNull();
    // In derselben Spalte, davor (ab `xl` klebt beides gemeinsam).
    expect(kopf!.parentElement).toBe(gliederung().parentElement);
    expect(kopf!.compareDocumentPosition(gliederung()) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
  });

  it('lässt den Kopf ohne Aktion weg', () => {
    const { container } = render(<Pruefling />);
    expect(container.querySelector('[data-lfh="gliederung-kopf"]')).toBeNull();
  });
});

describe('DokumentEntwurf — Druck-Struktur (LFH-1008, M86)', () => {
  it('trägt je Abschnitt Toggle-Editor mit Druckfassung und Papiertitel', () => {
    const { container } = render(<Pruefling start={{ [erster.schluessel]: 'Text' }} />);
    expect(container.querySelectorAll('.markdown-editor--toggle')).toHaveLength(8);
    const titel = [
      ...container.querySelectorAll('.markdown-editor__druck .markdown-editor__titel'),
    ];
    expect(titel.map((t) => t.textContent)).toEqual(acht.map((a) => a.label));
    // Was im Druck weicht, ist markiert (`dokumentEntwurf.css`).
    expect(container.querySelector('[data-lfh="gliederung"]')).not.toBeNull();
    expect(container.querySelectorAll('[data-lfh="abschnitt-kopf"]')).toHaveLength(8);
  });
});

/**
 * Render-Zähler-Gate (LLH-1074, vorher LFH-495 am Akkordeon): die Seite rendert bei Kopffeldern
 * und Speicherstand neu; die Abschnitte dürfen dabei nicht mitlaufen (acht Editoren samt
 * `autoSize`-Nachmessung je Anschlag). Hardwareunabhängig gezählt über die `aktion`-Render-Prop:
 * ein Aufruf je Render eines Abschnitts.
 */
describe('DokumentEntwurf — Memoisierung', () => {
  function zaehlend() {
    const aufrufe = { n: 0, je: new Map<string, number>() };
    const aktion: AbschnittAktion = (a) => {
      aufrufe.n += 1;
      aufrufe.je.set(a.schluessel, (aufrufe.je.get(a.schluessel) ?? 0) + 1);
      return null;
    };
    return { aufrufe, aktion };
  }

  it('rendert keinen Abschnitt neu, wenn die Seite mit neuem Kopf rendert', async () => {
    const { aufrufe, aktion } = zaehlend();
    // JE RENDER EIN NEUES ELEMENT: mit demselben Element-Objekt übersprünge React den Teilbaum
    // selbst, und der Test wäre auch ohne `memo` grün.
    const { rerender } = render(<Pruefling aktion={aktion} kopf={<span>Kopf 1</span>} />);
    await waitFor(() => expect(aufrufe.n).toBeGreaterThanOrEqual(8));
    const vorher = aufrufe.n;
    rerender(<Pruefling aktion={aktion} kopf={<span>Kopf 2</span>} />);
    expect(screen.getByText('Kopf 2')).toBeVisible();
    expect(aufrufe.n).toBe(vorher);
  });

  it('rendert beim Tippen nur den Abschnitt, der zwischen leer und befüllt kippt', async () => {
    const { aufrufe, aktion } = zaehlend();
    render(<Pruefling aktion={aktion} />);
    await waitFor(() => expect(aufrufe.n).toBeGreaterThanOrEqual(8));
    const feld = screen.getByRole('textbox', { name: zweiter.label });

    aufrufe.n = 0;
    aufrufe.je.clear();
    fireEvent.change(feld, { target: { value: 'L' } });
    await waitFor(() =>
      expect(within(gliederung()).getByRole('button', { name: zweiter.label })).toBeInTheDocument(),
    );
    // Gegenaussage: eine echte Änderung kommt durch, aber nur an EINEM Abschnitt.
    expect([...aufrufe.je]).toEqual([[zweiter.schluessel, 1]]);

    aufrufe.n = 0;
    fireEvent.change(feld, { target: { value: 'La' } });
    fireEvent.change(feld, { target: { value: 'Lag' } });
    // Weiterer Text kippt nichts: kein Abschnitt rendert.
    await new Promise((r) => setTimeout(r, 0));
    expect(aufrufe.n).toBe(0);
  });
});
