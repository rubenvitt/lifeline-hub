import { act, fireEvent, screen } from '@testing-library/react';
import { Form, Input } from 'antd';
import { describe, expect, it } from 'vitest';
import { renderMitProviders } from '../test/utils';
import {
  AenderungsstandProvider,
  gleichFuerStand,
  useAenderungsanzahl,
  useAenderungsstandMerke,
  useFeldGeaendert,
} from './aenderungsstand';

let merkeVonAussen: ((werte: object) => void) | null = null;

function Anzeige() {
  const name = useFeldGeaendert('name');
  const ort = useFeldGeaendert('ort');
  const anzahl = useAenderungsanzahl();
  merkeVonAussen = useAenderungsstandMerke();
  return (
    <output data-testid="stand">
      {`name:${String(name)} ort:${String(ort)} anzahl:${String(anzahl)}`}
    </output>
  );
}

function Formular({
  ausgang = { name: 'A', ort: 'X' },
  mitProvider = true,
}: {
  ausgang?: Record<string, unknown>;
  mitProvider?: boolean;
}) {
  const felder = (
    <>
      <Form.Item name="name" label="Name">
        <Input />
      </Form.Item>
      <Form.Item name="ort" label="Ort">
        <Input />
      </Form.Item>
      <Anzeige />
    </>
  );
  return (
    <Form initialValues={ausgang}>
      {mitProvider ? (
        <AenderungsstandProvider ausgangswerte={ausgang}>{felder}</AenderungsstandProvider>
      ) : (
        felder
      )}
    </Form>
  );
}

function tippe(etikett: string, wert: string) {
  fireEvent.change(screen.getByLabelText(etikett), { target: { value: wert } });
}

const stand = () => screen.getByTestId('stand').textContent;

describe('aenderungsstand (LLH-1829)', () => {
  it('zeigt ein Feld als geändert, sobald der Wert vom Ausgangsstand abweicht', async () => {
    renderMitProviders(<Formular />);
    expect(stand()).toBe('name:false ort:false anzahl:0');
    tippe('Name', 'B');
    expect(await screen.findByText('name:true ort:false anzahl:1')).toBeInTheDocument();
  });

  it('nimmt die Markierung zurück, wenn der Wert zurückgeändert wird', async () => {
    renderMitProviders(<Formular />);
    tippe('Name', 'B');
    await screen.findByText('name:true ort:false anzahl:1');
    tippe('Name', 'A');
    expect(await screen.findByText('name:false ort:false anzahl:0')).toBeInTheDocument();
  });

  it('behandelt undefined, null und Leertext als gleich', async () => {
    expect(gleichFuerStand(undefined, '')).toBe(true);
    expect(gleichFuerStand(null, '')).toBe(true);
    expect(gleichFuerStand('a', '')).toBe(false);
    expect(gleichFuerStand(['a'], ['a'])).toBe(true);
    renderMitProviders(<Formular ausgang={{ name: 'A' }} />);
    tippe('Ort', 'Y');
    await screen.findByText('name:false ort:true anzahl:1');
    tippe('Ort', '');
    expect(await screen.findByText('name:false ort:false anzahl:0')).toBeInTheDocument();
  });

  it('merke übernimmt die gesendeten Werte als neuen Ausgangsstand', async () => {
    renderMitProviders(<Formular />);
    tippe('Name', 'B');
    await screen.findByText('name:true ort:false anzahl:1');
    act(() => merkeVonAussen!({ name: 'B', ort: 'X' }));
    expect(await screen.findByText('name:false ort:false anzahl:0')).toBeInTheDocument();
  });

  it('ein nach dem Absenden geändertes Feld bleibt geändert', async () => {
    renderMitProviders(<Formular />);
    tippe('Name', 'B');
    await screen.findByText('name:true ort:false anzahl:1');
    // Gesendet wurde {name: B, ort: X}; währenddessen tippt die Person im Ort weiter.
    tippe('Ort', 'Y');
    await screen.findByText('name:true ort:true anzahl:2');
    act(() => merkeVonAussen!({ name: 'B', ort: 'X' }));
    expect(await screen.findByText('name:false ort:true anzahl:1')).toBeInTheDocument();
  });

  it('ohne Provider meldet nichts', async () => {
    renderMitProviders(<Formular mitProvider={false} />);
    tippe('Name', 'B');
    expect(stand()).toBe('name:false ort:false anzahl:null');
  });
});
