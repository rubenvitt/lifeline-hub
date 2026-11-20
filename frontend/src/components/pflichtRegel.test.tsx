import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Button, Form, Input } from 'antd';
import { describe, expect, it } from 'vitest';
import { ThemeModeProvider } from '../theme/ThemeModeProvider';
import { pflicht } from './pflichtRegel';

// Regel: `frontend/AGENTS.md`, „Erfassungs-Norm“, Pflichtfehler „‹Feld› fehlt“ (LLH-1766).
describe('pflicht()', () => {
  it('liefert eine Pflichtregel mit dem Text „‹Feld› fehlt“', () => {
    expect(pflicht('Absender')).toEqual({ required: true, message: 'Absender fehlt' });
  });

  it('übernimmt whitespace als Option', () => {
    expect(pflicht('Name', { whitespace: true })).toEqual({
      required: true,
      whitespace: true,
      message: 'Name fehlt',
    });
  });

  it('hängt einen Zusatz nach einem Gedankenstrich an', () => {
    expect(pflicht('Anzahl', { zusatz: '0, wenn niemand' }).message).toBe(
      'Anzahl fehlt — 0, wenn niemand',
    );
  });

  it('lehnt mit whitespace eine Eingabe aus Leerzeichen ab', async () => {
    render(
      <Form>
        <Form.Item label="Ort" name="ort" rules={[pflicht('Ort', { whitespace: true })]}>
          <Input />
        </Form.Item>
        <Button htmlType="submit">Erfassen</Button>
      </Form>,
    );
    await userEvent.type(screen.getByLabelText('Ort'), '   ');
    await userEvent.click(screen.getByRole('button', { name: 'Erfassen' }));
    expect(await screen.findByText('Ort fehlt')).toBeInTheDocument();
  });
});

describe('Standardtext einer Pflichtregel ohne eigenen Text', () => {
  it('zeigt „‹Label› fehlt“ statt der Sie-Form von antd', async () => {
    render(
      <ThemeModeProvider>
        <Form>
          <Form.Item label="Titel" name="titel" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Button htmlType="submit">Erfassen</Button>
        </Form>
      </ThemeModeProvider>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Erfassen' }));
    expect(await screen.findByText('Titel fehlt')).toBeInTheDocument();
    expect(screen.queryByText(/Bitte geben Sie/)).not.toBeInTheDocument();
  });
});
