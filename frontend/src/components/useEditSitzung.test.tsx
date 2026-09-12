import { describe, expect, it } from 'vitest';
import { act, render } from '@testing-library/react';
import { Form, Input, type FormInstance } from 'antd';
import { useEditSitzung, type EditSitzungSteuerung } from './useEditSitzung';

interface Werte {
  name: string;
}

/** Die Probe rendert ein ECHTES `<Form form={form}>`. Das ist keine Zierde: eine
 *  `Form.useForm()`-Instanz ohne angehängtes Formularelement verwirft `setFieldsValue`
 *  still (rc-field-form warnt nur auf der Konsole, `getFieldsValue()` bleibt leer) —
 *  gegen eine losgelöste Instanz wäre die Zusicherung „das Formular ist befüllt" nicht
 *  widerlegbar, weil sie immer scheiterte. */
function probe() {
  const gelesen: { current: EditSitzungSteuerung<Werte> & { form: FormInstance<Werte> } } = {
    current: null as never,
  };

  function Probe({ datensatz }: { datensatz: { geaendert_at: string } }) {
    const [form] = Form.useForm<Werte>();
    const steuerung = useEditSitzung<Werte>(form);
    gelesen.current = { form, ...steuerung };
    return (
      <Form form={form}>
        {/* Der Datensatz steht im Baum, damit ein Prop-Wechsel wirklich rendert. */}
        <div data-testid="stand">{datensatz.geaendert_at}</div>
        <Form.Item name="name"><Input /></Form.Item>
      </Form>
    );
  }

  const ergebnis = render(<Probe datensatz={{ geaendert_at: 'alt' }} />);
  return {
    gelesen,
    zeigeStand: (geaendert_at: string) => ergebnis.rerender(<Probe datensatz={{ geaendert_at }} />),
    ...ergebnis,
  };
}

describe('useEditSitzung', () => {
  it('startet im Lesemodus', () => {
    const { gelesen } = probe();
    expect(gelesen.current.sitzung).toBeNull();
  });

  it('friert beim Starten Basis und Werte aus DEMSELBEN Datensatz ein', () => {
    const { gelesen } = probe();
    act(() => gelesen.current.starte({ geaendert_at: 'alt' }, { name: 'Rex' }));
    expect(gelesen.current.sitzung?.basis).toBe('alt');
    expect(gelesen.current.sitzung?.werte).toEqual({ name: 'Rex' });
    // Das Formular trägt die Werte desselben Snapshots — der Aufrufer muss (und soll)
    // `setFieldsValue` nicht selbst rufen; sonst könnten Werte und Basis auseinanderlaufen.
    expect(gelesen.current.form.getFieldsValue()).toEqual({ name: 'Rex' });
  });

  it('lässt die Basis von späteren Ständen unberührt (LFH-303)', () => {
    // Der Datensatz wechselt unter der offenen Sitzung — die Testform des
    // Hintergrund-Refetchs: die Detail-Query liefert einen fremden, neueren Stand,
    // während die Maske offen steht.
    const { gelesen, zeigeStand, getByTestId } = probe();
    act(() => gelesen.current.starte({ geaendert_at: 'alt' }, { name: 'Rex' }));
    act(() => zeigeStand('fremd-neuer'));
    expect(getByTestId('stand')).toHaveTextContent('fremd-neuer');
    expect(gelesen.current.sitzung?.basis).toBe('alt');
  });

  it('übernimmt einen neuen Stand erst beim erneuten Betreten', () => {
    const { gelesen } = probe();
    act(() => gelesen.current.starte({ geaendert_at: 'alt' }, { name: 'Rex' }));
    act(() => gelesen.current.beende());
    expect(gelesen.current.sitzung).toBeNull();
    act(() => gelesen.current.starte({ geaendert_at: 'neu' }, { name: 'Bella' }));
    expect(gelesen.current.sitzung?.basis).toBe('neu');
    expect(gelesen.current.form.getFieldsValue()).toEqual({ name: 'Bella' });
  });
});
