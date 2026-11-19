import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { Button, Form, Input } from 'antd';
import { describe, expect, it } from 'vitest';
import { renderMitProviders } from '../../test/utils';
import { AenderungsstandProvider } from '../aenderungsstand';
import Feld, { FELD_GRENZE, FELD_KLASSE } from './Feld';

function formularItem(beschriftung: string): HTMLElement {
  return screen.getByLabelText(beschriftung).closest('.ant-form-item') as HTMLElement;
}

describe('Feld (Spec `feldbreiten`)', () => {
  it.each([
    ['kurz', '120px'],
    ['schmal', '200px'],
    ['mittel', '320px'],
  ] as const)('begrenzt die Breite `%s` auf %s und bleibt fluid', (breite, grenze) => {
    renderMitProviders(
      <Form>
        <Feld name="wert" label="Wert" breite={breite}>
          <Input />
        </Feld>
      </Form>,
    );
    const item = formularItem('Wert');
    // Die Grenze gilt dem Steuerelement, nicht der Beschriftung: sie bricht sonst unnötig um.
    expect(item.style.maxWidth).toBe('');
    expect(item.style.getPropertyValue(FELD_GRENZE)).toBe(grenze);
    expect(item.style.width).toBe('');
  });

  it('hat ohne Angabe die Breite `voll` ohne Obergrenze', () => {
    renderMitProviders(
      <Form>
        <Feld name="bemerkung" label="Bemerkung">
          <Input />
        </Feld>
      </Form>,
    );
    expect(formularItem('Bemerkung').style.getPropertyValue(FELD_GRENZE)).toBe('');
  });

  it('trägt die Klasse, mit der InputNumber und Datumsfelder die Breite füllen', () => {
    renderMitProviders(
      <Form>
        <Feld name="n" label="Sitzplätze" breite="kurz" className="eigen">
          <Input />
        </Feld>
      </Form>,
    );
    const item = formularItem('Sitzplätze');
    expect(item).toHaveClass(FELD_KLASSE);
    expect(item).toHaveClass('eigen');
    const css = readFileSync(join(process.cwd(), 'src', 'index.css'), 'utf-8');
    expect(css).toMatch(
      new RegExp(
        `\\.${FELD_KLASSE} \\.ant-form-item-control-input[^{]*\\{[^}]*max-width: var\\(${FELD_GRENZE}`,
      ),
    );
    for (const steuer of ['.ant-input-number', '.ant-picker', '.ant-select']) {
      expect(css).toMatch(
        new RegExp(`\\.${FELD_KLASSE} ${steuer.replace('.', '\\.')}[^{]*\\{[^}]*width: 100%`),
      );
    }
  });

  it('zeigt Pflichtfehler wie ein Formularfeld', async () => {
    renderMitProviders(
      <Form onFinish={() => {}}>
        <Feld name="funk" label="Funkrufname" rules={[{ required: true, message: 'Pflicht' }]}>
          <Input />
        </Feld>
        <Button htmlType="submit">Speichern</Button>
      </Form>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Speichern' }));
    await waitFor(() => expect(screen.getByText('Pflicht')).toBeInTheDocument());
  });

  it('reicht `noStyle` durch und setzt dann keine Hülle', () => {
    renderMitProviders(
      <Form>
        <Feld name="frei" noStyle>
          <Input aria-label="Frei" />
        </Feld>
      </Form>,
    );
    expect(screen.getByLabelText('Frei').closest('.ant-form-item')).toBeNull();
  });

  it('nimmt keine Pixelbreite an', () => {
    // @ts-expect-error — kein `style`: die Breite kommt nur aus der Stufe
    void (<Feld style={{ width: 280 }}>x</Feld>);
    // @ts-expect-error — eine Zahl ist keine Breitenstufe
    void (<Feld breite={280}>x</Feld>);
  });

  it('prüft mit Werttyp den Feldnamen gegen die Formularwerte', () => {
    interface Werte {
      beginn: string;
    }
    void (<Feld<Werte> name="beginn">x</Feld>);
    // @ts-expect-error — „begin“ ist kein Feld der Werte
    void (<Feld<Werte> name="begin">x</Feld>);
  });
});

describe('Feld: Punkt am geänderten Feld (LLH-1829)', () => {
  function Maske({ mitProvider = true }: { mitProvider?: boolean }) {
    const feld = (
      <Feld name="name" label="Name">
        <Input />
      </Feld>
    );
    return (
      <Form initialValues={{ name: 'A' }}>
        {mitProvider ? (
          <AenderungsstandProvider ausgangswerte={{ name: 'A' }}>{feld}</AenderungsstandProvider>
        ) : (
          feld
        )}
      </Form>
    );
  }

  it('trägt am Etikett einen Punkt, wenn das Feld geändert ist', async () => {
    renderMitProviders(<Maske />);
    expect(screen.queryByText('•')).toBeNull();
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'B' } });
    const punkt = await screen.findByText('•');
    expect(punkt).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByLabelText(/\(geändert\)/)).toHaveValue('B');
    fireEvent.change(screen.getByLabelText(/Name/), { target: { value: 'A' } });
    await waitFor(() => expect(screen.queryByText('•')).toBeNull());
    expect(screen.queryByLabelText(/\(geändert\)/)).toBeNull();
  });

  it('ohne Provider kein Punkt', () => {
    renderMitProviders(<Maske mitProvider={false} />);
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'B' } });
    expect(screen.queryByText('•')).toBeNull();
  });
});
