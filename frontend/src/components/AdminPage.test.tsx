import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Button, Form, Input } from 'antd';
import { renderMitProviders } from '../test/utils';
import AdminPage from './AdminPage';

describe('AdminPage', () => {
  it('rendert Titel (level 4), Beschreibung, Aktionen, Hinweis und Children', () => {
    renderMitProviders(
      <AdminPage
        titel="Einstellungen"
        beschreibung="Org-weite Defaults"
        aktionen={<Button>Speichern</Button>}
        hinweis={<div>Nur lesend</div>}
      >
        <div>Seiteninhalt</div>
      </AdminPage>,
    );
    const heading = screen.getByRole('heading', { name: 'Einstellungen' });
    expect(heading.tagName).toBe('H1');
    expect(screen.getByText('Org-weite Defaults')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Speichern' })).toBeInTheDocument();
    expect(screen.getByText('Nur lesend')).toBeInTheDocument();
    expect(screen.getByText('Seiteninhalt')).toBeInTheDocument();
  });

  it('löst über einen Header-Button (außerhalb des Form) das Speichern via form.submit() aus', async () => {
    const onFinish = vi.fn();
    function Harness() {
      const [form] = Form.useForm();
      return (
        <AdminPage
          titel="Titel"
          aktionen={<Button onClick={() => form.submit()}>Speichern</Button>}
        >
          <Form form={form} onFinish={onFinish}>
            <Form.Item name="feld" initialValue="wert">
              <Input aria-label="feld" />
            </Form.Item>
          </Form>
        </AdminPage>
      );
    }
    renderMitProviders(<Harness />);
    await userEvent.click(screen.getByRole('button', { name: 'Speichern' }));
    expect(onFinish).toHaveBeenCalledWith({ feld: 'wert' });
  });

  it('füllt ohne Angabe die Spalte; schmal (`flaeche.seiteSchmal`) nur ausdrücklich', () => {
    // Wie in `EinsatzSeite.test.tsx`: `renderMitProviders` legt eine `.ant-app`-Hülle um den Baum,
    // die Wurzel des Primitivs ist deren erstes Kind. ACHTUNG: ein zusätzlicher Wrapper-DIV in
    // `AdminPage` ließe den Selektor still auf ihn zeigen.
    const wurzel = (c: HTMLElement) => c.querySelector<HTMLElement>('.ant-app > div')!;

    // Vorgabe `voll` wie an `EinsatzSeite`: Tabellen füllen die Spalte neben der Seitenleiste.
    const voll = renderMitProviders(
      <AdminPage titel="Voll">
        <div>x</div>
      </AdminPage>,
    );
    expect(wurzel(voll.container).style.maxWidth).toBe('');
    voll.unmount();

    const { container } = renderMitProviders(
      <AdminPage titel="Schmal" breite="schmal">
        <div>x</div>
      </AdminPage>,
    );
    // HANDGESCHRIEBENE LITERALE, nicht `${flaeche.seiteSchmal}px`: die Komponente liest dasselbe
    // Token, beide Seiten bewegten sich sonst gemeinsam. Dass die Zahl zum Token passt, sichert der
    // Byte-Pin in `theme/tokens.test.ts`; erst beide zusammen belegen die Verdrahtung.
    expect(wurzel(container).style.maxWidth).toBe('900px');
  });
});
