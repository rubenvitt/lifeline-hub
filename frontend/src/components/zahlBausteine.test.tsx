import { fireEvent, screen, waitFor } from '@testing-library/react';
import { Button, Form } from 'antd';
import type { ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import StaerkeEingabe from '../anzeige/StaerkeEingabe';
import { renderMitProviders } from '../test/utils';
import { DezimalFeld } from './DezimalFeld';
import Feld from './instrument/Feld';
import { MengenFeld } from './MengenFeld';
import RadiusEingabe from './RadiusEingabe';
import { ZahlFeld } from './ZahlFeld';

/** Zahl-Bausteine kappen und runden nie (LLH-1768): sie melden den Grund und sperren das Senden. */
function imFormular(kind: ReactElement, onFinish: (w: unknown) => void) {
  return renderMitProviders(
    <Form onFinish={onFinish}>
      <Feld name="x" label="X">
        {kind}
      </Feld>
      <Button htmlType="submit">Senden</Button>
    </Form>,
  );
}

function tippe(name: string, text: string) {
  const feld = screen.getByRole('spinbutton', { name });
  fireEvent.change(feld, { target: { value: text } });
  fireEvent.blur(feld);
  return feld;
}

describe('MengenFeld prüft statt zu kappen', () => {
  it.each([
    ['0', 'Mindestens 1'],
    ['2.5', 'Nur ganze Zahlen'],
  ])('„%s“ bleibt stehen, nennt „%s“ und sendet nicht', async (text, grund) => {
    const onFinish = vi.fn();
    imFormular(<MengenFeld beschriftung="Menge" />, onFinish);
    const feld = tippe('Menge', text);
    fireEvent.click(screen.getByRole('button', { name: 'Senden' }));
    expect(await screen.findByText(grund)).toBeInTheDocument();
    expect(feld).toHaveValue(text);
    expect(onFinish).not.toHaveBeenCalled();
  });

  it('eine gültige Menge sendet', async () => {
    const onFinish = vi.fn();
    imFormular(<MengenFeld beschriftung="Menge" />, onFinish);
    tippe('Menge', '3');
    fireEvent.click(screen.getByRole('button', { name: 'Senden' }));
    await waitFor(() => expect(onFinish).toHaveBeenCalledWith({ x: 3 }));
  });
});

describe('DezimalFeld rundet nicht', () => {
  it('„7,123“ bei zwei Stellen bleibt stehen und sperrt', async () => {
    const onFinish = vi.fn();
    imFormular(<DezimalFeld beschriftung="Höchststand" stellen={2} />, onFinish);
    const feld = tippe('Höchststand', '7,123');
    fireEvent.click(screen.getByRole('button', { name: 'Senden' }));
    expect(await screen.findByText('Höchstens 2 Nachkommastellen')).toBeInTheDocument();
    expect(feld).toHaveValue('7,123');
    expect(onFinish).not.toHaveBeenCalled();
  });

  it('„7,1“ zeigt nach dem Verlassen „7,10“', () => {
    imFormular(<DezimalFeld beschriftung="Höchststand" stellen={2} />, vi.fn());
    expect(tippe('Höchststand', '7,1')).toHaveValue('7,10');
  });
});

describe('RadiusEingabe ohne Formular', () => {
  it('meldet einen zu großen Radius nicht weiter und zeigt den Fehler', () => {
    const onChange = vi.fn();
    renderMitProviders(<RadiusEingabe value={100} onChange={onChange} />);
    const feld = tippe('Radius in Metern', '9999999');
    expect(onChange).not.toHaveBeenCalledWith(9999999);
    expect(feld).toHaveAttribute('aria-invalid', 'true');
    expect(feld).toHaveValue('9999999');
  });
});

describe('StaerkeEingabe', () => {
  it('meldet keinen negativen Teil weiter und sperrt im Formular', async () => {
    const onFinish = vi.fn();
    imFormular(<StaerkeEingabe />, onFinish);
    tippe('Führer', '-1');
    fireEvent.click(screen.getByRole('button', { name: 'Senden' }));
    expect(await screen.findByText('Mindestens 0')).toBeInTheDocument();
    expect(onFinish).not.toHaveBeenCalled();
  });
});

describe('ZahlFeld (Ersatz für InputNumber mit Grenzen, LLH-1768)', () => {
  it('Alter 250 bleibt stehen, nennt die Grenze und sendet nicht', async () => {
    const onFinish = vi.fn();
    imFormular(<ZahlFeld aria-label="Alter" min={0} max={120} ganz einheit="Jahre" />, onFinish);
    const feld = tippe('Alter', '250');
    fireEvent.click(screen.getByRole('button', { name: 'Senden' }));
    expect(await screen.findByText('Höchstens 120 Jahre')).toBeInTheDocument();
    expect(feld).toHaveValue('250');
    expect(onFinish).not.toHaveBeenCalled();
  });

  it('`nurGueltig`: ohne Formular geht ein Wert außerhalb nicht hinaus und bleibt sichtbar', () => {
    const onChange = vi.fn();
    const onGrund = vi.fn();
    renderMitProviders(
      <ZahlFeld
        aria-label="Menge"
        min={1}
        max={50}
        value={3}
        onChange={onChange}
        onGrund={onGrund}
        nurGueltig
      />,
    );
    const feld = tippe('Menge', '80');
    expect(onChange).not.toHaveBeenCalledWith(80);
    expect(onGrund).toHaveBeenLastCalledWith('Höchstens 50');
    expect(feld).toHaveValue('80');
  });
});

describe('Review LLH-1768', () => {
  it('MengenFeld ohne Formular reicht einen Wert außerhalb nicht weiter und lässt ihn stehen', () => {
    const onChange = vi.fn();
    renderMitProviders(<MengenFeld beschriftung="Anzahl" max={10} value={2} onChange={onChange} />);
    const feld = tippe('Anzahl', '0');
    expect(onChange).not.toHaveBeenCalledWith(0);
    expect(feld).toHaveValue('0');
    expect(feld).toHaveAttribute('aria-invalid', 'true');
  });

  it('ein von außen gesetzter gültiger Wert räumt den Grund ab', async () => {
    const onFinish = vi.fn();
    function Mit() {
      const [form] = Form.useForm();
      return (
        <Form form={form} onFinish={onFinish}>
          <Feld name="x" label="X">
            <ZahlFeld aria-label="Zahl" min={1} />
          </Feld>
          <Button onClick={() => form.setFieldsValue({ x: 5 })}>Setzen</Button>
          <Button htmlType="submit">Senden</Button>
        </Form>
      );
    }
    renderMitProviders(<Mit />);
    tippe('Zahl', '0');
    fireEvent.click(screen.getByRole('button', { name: 'Setzen' }));
    fireEvent.click(screen.getByRole('button', { name: 'Senden' }));
    await waitFor(() => expect(onFinish).toHaveBeenCalledWith({ x: 5 }));
  });
});
