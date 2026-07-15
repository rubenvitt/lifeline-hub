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
});
