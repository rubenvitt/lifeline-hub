import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { Button, Form } from 'antd';
import { server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import type { ExterneStelle } from '../api/types';
import {
  ExterneEmpfaenger,
  externeEmpfaengerRule,
  type ExternerEmpfaenger,
} from './ExterneEmpfaenger';

const KATALOG: ExterneStelle[] = [
  { id: 1, bezeichnung: 'ILS Musterstadt', art: 'leitstelle', aktiv: true, zustaendig: true },
  { id: 2, bezeichnung: 'Polizei Nord', art: 'polizei', aktiv: true, zustaendig: false },
];

beforeEach(() => {
  server.use(http.get('/api/externe-stellen', () => HttpResponse.json(KATALOG)));
});

/** Das Feld in einem Formular mit Regel und Absenden, wie auf der Entwurfsseite. */
function rendern(anfang: ExternerEmpfaenger[] = []) {
  const onFinish = vi.fn<(w: { extern: ExternerEmpfaenger[] }) => void>();
  const werte = vi.fn<(w: ExternerEmpfaenger[]) => void>();
  renderMitProviders(
    <Form
      initialValues={{ extern: anfang }}
      onFinish={onFinish}
      onValuesChange={(_, alle: { extern: ExternerEmpfaenger[] }) => werte(alle.extern)}
    >
      <Form.Item name="extern" label="Externe Stellen" rules={[externeEmpfaengerRule]}>
        <ExterneEmpfaenger />
      </Form.Item>
      <Button htmlType="submit">Speichern</Button>
    </Form>,
  );
  return { onFinish, werte };
}

const bezeichnung = (n: number) =>
  screen.getByRole('combobox', { name: `Bezeichnung externe Stelle ${n}` });

describe('ExterneEmpfaenger (kz5udbog D7)', () => {
  it('Zeile hinzufügen: eine leere Zeile mit Kategorie und Bezeichnung', async () => {
    const { werte } = rendern();
    expect(screen.queryByRole('combobox', { name: /externe Stelle 1/ })).toBeNull();

    await userEvent.click(screen.getByRole('button', { name: 'Externe Stelle hinzufügen' }));

    expect(screen.getByRole('combobox', { name: 'Kategorie externe Stelle 1' })).toBeVisible();
    expect(bezeichnung(1)).toHaveValue('');
    expect(werte).toHaveBeenLastCalledWith([{ bezeichnung: '' }]);
  });

  it('Vorschlag übernehmen: die Bezeichnung kommt aus dem Katalog, ohne „zuständig“', async () => {
    const { werte } = rendern([{ kategorie: 'leitstelle', bezeichnung: '' }]);
    await userEvent.click(bezeichnung(1));
    await userEvent.click(await screen.findByTitle('ILS Musterstadt · zuständig'));

    expect(bezeichnung(1)).toHaveValue('ILS Musterstadt');
    expect(werte).toHaveBeenLastCalledWith([
      { kategorie: 'leitstelle', bezeichnung: 'ILS Musterstadt' },
    ]);
  });

  it('Kategorie wählen', async () => {
    const { werte } = rendern([{ bezeichnung: 'ILS Musterstadt' }]);
    await userEvent.click(screen.getByRole('combobox', { name: 'Kategorie externe Stelle 1' }));
    await userEvent.click(await screen.findByTitle('Übergeordnete Führung'));
    expect(werte).toHaveBeenLastCalledWith([
      { kategorie: 'uebergeordnet', bezeichnung: 'ILS Musterstadt' },
    ]);
  });

  it('Überlänge sperrt: der Text bleibt ganz stehen, das Feld meldet sich, nichts geht hinaus', async () => {
    const { onFinish } = rendern([{ kategorie: 'leitstelle', bezeichnung: '' }]);
    fireEvent.change(bezeichnung(1), { target: { value: 'x'.repeat(201) } });

    expect(bezeichnung(1)).toHaveValue('x'.repeat(201));
    expect(bezeichnung(1)).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByText('201 / 200 · zu lang')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Speichern' }));
    expect(
      await screen.findByText(
        'Bezeichnung der externen Stelle darf höchstens 200 Zeichen lang sein',
      ),
    ).toBeInTheDocument();
    expect(onFinish).not.toHaveBeenCalled();
  });

  it('genau 200 Zeichen gehen durch, der Zähler steht ab 80 %', async () => {
    const { onFinish } = rendern([{ kategorie: 'leitstelle', bezeichnung: '' }]);
    fireEvent.change(bezeichnung(1), { target: { value: 'x'.repeat(159) } });
    expect(screen.queryByText(/ \/ 200/)).toBeNull();
    fireEvent.change(bezeichnung(1), { target: { value: 'x'.repeat(200) } });
    expect(screen.getByText('200 / 200')).toBeInTheDocument();
    expect(bezeichnung(1)).not.toHaveAttribute('aria-invalid', 'true');

    await userEvent.click(screen.getByRole('button', { name: 'Speichern' }));
    await waitFor(() => expect(onFinish).toHaveBeenCalledTimes(1));
  });

  it('eine Bezeichnung ohne Kategorie sperrt', async () => {
    const { onFinish } = rendern([{ bezeichnung: 'ILS Musterstadt' }]);
    await userEvent.click(screen.getByRole('button', { name: 'Speichern' }));
    expect(await screen.findByText('Kategorie der externen Stelle fehlt')).toBeInTheDocument();
    expect(onFinish).not.toHaveBeenCalled();
  });

  it('Zeile entfernen: nur die genannte Zeile fällt weg', async () => {
    const { werte } = rendern([
      { kategorie: 'leitstelle', bezeichnung: 'ILS Musterstadt' },
      { kategorie: 'andere_bos', bezeichnung: 'Polizei Nord' },
    ]);
    await userEvent.click(screen.getByRole('button', { name: 'Externe Stelle 1 entfernen' }));

    expect(werte).toHaveBeenLastCalledWith([
      { kategorie: 'andere_bos', bezeichnung: 'Polizei Nord' },
    ]);
    expect(bezeichnung(1)).toHaveValue('Polizei Nord');
    expect(screen.queryByRole('combobox', { name: 'Bezeichnung externe Stelle 2' })).toBeNull();
  });
});
