import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Button, Form, Input } from 'antd';
import { renderMitProviders } from '../test/utils';
import { flaeche } from '../theme/tokens';
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
    expect(heading.tagName).toBe('H4');
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
        <AdminPage titel="Titel" aktionen={<Button onClick={() => form.submit()}>Speichern</Button>}>
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

  it('hält die Container-Breite auf `flaeche.seiteSchmal` und lässt sie überschreiben', () => {
    // Wörtlich nach dem Muster des Schwester-Primitivs `EinsatzSeite.test.tsx`:
    // `renderMitProviders` legt eine `.ant-app`-Hülle um den Baum — die Wurzel
    // des Primitivs ist deren erstes Kind, nicht `container.firstElementChild`.
    // ACHTUNG: kein zusätzlicher Wrapper-DIV in `AdminPage` — der Selektor
    // zeigte sonst still auf ihn und der Test wäre aussagelos.
    //
    // Der Test ist am Bestand GRÜN, weil das hartkodierte Maß zufällig
    // `flaeche.seiteSchmal` ist. Sein Rotnachweis läuft als Mutationsprobe
    // (`seiteSchmal` in `tokens.ts` verstellen → dieser Test rot); ohne sie
    // belegte er nur die Zahl, nicht deren Quelle.
    const wurzel = (c: HTMLElement) => c.querySelector<HTMLElement>('.ant-app > div')!;

    const { container, unmount } = renderMitProviders(
      <AdminPage titel="Schmal">
        <div>x</div>
      </AdminPage>,
    );
    expect(wurzel(container).style.maxWidth).toBe(`${flaeche.seiteSchmal}px`);
    unmount();

    const breit = renderMitProviders(
      <AdminPage titel="Breit" breite={flaeche.seiteBreit}>
        <div>x</div>
      </AdminPage>,
    );
    expect(wurzel(breit.container).style.maxWidth).toBe(`${flaeche.seiteBreit}px`);
  });
});
