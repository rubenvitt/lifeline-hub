import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Form, Input } from 'antd';
import FormularEingehaengt from '../components/FormularEingehaengt';
import { useEntwurfVerlustschutz } from './useEntwurfVerlustschutz';

/**
 * LFH-627: „Instance created by `useForm` is not connected to any Form element". Befehl,
 * Lagebericht und Pressemitteilung rendern ihr `<Form>` nur im bearbeitbaren Entwurf; freigegeben
 * oder ohne Schreibrecht schrieb der Verlustschutz den Serverstand trotzdem per `setFieldsValue`
 * in die Instanz.
 *
 * **Eigene Datei, und das ist Absicht:** `@rc-component/util` gibt dieselbe Warnung je
 * Modulinstanz nur EINMAL aus (`warningOnce`). Vitest isoliert die Module je Testdatei.
 */

interface Daten {
  titel: string;
}

function Traeger({ mitFormular }: { mitFormular: boolean }) {
  const [form] = Form.useForm<Daten>();
  const schutz = useEntwurfVerlustschutz<Daten, Daten>({
    daten: { titel: 'Server 1' },
    istEntwurf: true,
    form,
    werteAus: (d) => ({ titel: d.titel }),
    speichern: () => Promise.resolve(),
  });
  if (!mitFormular) return <p>nur lesen</p>;
  return (
    <Form form={form} onValuesChange={schutz.markiereGeaendert}>
      <Form.Item label="Titel" name="titel">
        <Input />
      </Form.Item>
      <FormularEingehaengt onWechsel={schutz.formularEingehaengt} />
    </Form>
  );
}

/** Die Prüfung von rc-field-form läuft in einem `setTimeout(…, 0)` nach dem Aufruf. */
const naechsterMakrotask = () => new Promise((r) => setTimeout(r, 0));

function unverbundenWarnungen(spy: ReturnType<typeof vi.spyOn>) {
  return spy.mock.calls.filter((c: unknown[]) => String(c[0]).includes('is not connected'));
}

afterEach(() => vi.restoreAllMocks());

describe('useEntwurfVerlustschutz · Formularbindung (LFH-627)', () => {
  it('ohne gerendertes Formular schreibt der Riegel-Effekt nichts', async () => {
    const spy = vi.spyOn(console, 'error');
    const { rerender } = render(<Traeger mitFormular={false} />);
    await naechsterMakrotask();
    expect(unverbundenWarnungen(spy)).toEqual([]);

    // Kommt das Formular später (Schreibrecht, Entwurf), holt der Effekt den Serverstand nach.
    rerender(<Traeger mitFormular />);
    expect(await screen.findByLabelText('Titel')).toHaveValue('Server 1');
  });
});
