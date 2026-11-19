import { fireEvent, screen } from '@testing-library/react';
import { Form, Input } from 'antd';
import { describe, expect, it } from 'vitest';
import { renderMitProviders } from '../test/utils';
import { AenderungsstandProvider } from './aenderungsstand';
import SpeicherKnopf, { aenderungsText } from './SpeicherKnopf';

function Maske({ mitProvider = true, disabled = false }) {
  const inhalt = (
    <>
      <Form.Item name="name" label="Name">
        <Input />
      </Form.Item>
      <SpeicherKnopf disabled={disabled} />
    </>
  );
  return (
    <Form initialValues={{ name: 'A' }} disabled={disabled}>
      {mitProvider ? (
        <AenderungsstandProvider ausgangswerte={{ name: 'A' }}>{inhalt}</AenderungsstandProvider>
      ) : (
        inhalt
      )}
    </Form>
  );
}

const knopf = () => screen.getByRole('button', { name: /Speichern/ });

describe('SpeicherKnopf (LLH-1829)', () => {
  it('nennt den Stand in Worten', () => {
    expect(aenderungsText(0)).toBe('Keine Änderungen');
    expect(aenderungsText(1)).toBe('1 Änderung');
    expect(aenderungsText(3)).toBe('3 Änderungen');
  });

  it('ohne Änderung gesperrt mit sichtbarem Grund', () => {
    renderMitProviders(<Maske />);
    expect(knopf()).toBeDisabled();
    const grund = screen.getByText('Keine Änderungen');
    expect(knopf()).toHaveAttribute('aria-describedby', grund.id);
  });

  it('mit Änderung aktiv', async () => {
    renderMitProviders(<Maske />);
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'B' } });
    expect(await screen.findByText('1 Änderung')).toBeInTheDocument();
    expect(knopf()).toBeEnabled();
  });

  it('ohne Provider aktiv und ohne Stand', () => {
    renderMitProviders(<Maske mitProvider={false} />);
    expect(knopf()).toBeEnabled();
    expect(screen.queryByText('Keine Änderungen')).toBeNull();
  });

  it('gesperrt (kein Schreibrecht): kein Stand', () => {
    renderMitProviders(<Maske disabled />);
    expect(knopf()).toBeDisabled();
    expect(screen.queryByText('Keine Änderungen')).toBeNull();
  });
});
