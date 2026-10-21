import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { Form } from 'antd';
import { renderMitProviders } from '../test/utils';
import UebernahmeStand, { AUS_DER_VORFASSUNG, STAND_DER_UEBERNAHME } from './UebernahmeStand';
import { UEBERNOMMEN_FIELD, standFeld } from './standFeld';

function Probe({ stand, grenze }: { stand?: string; grenze?: string }) {
  const [form] = Form.useForm();
  return (
    <Form form={form} initialValues={{ [UEBERNOMMEN_FIELD]: { eigene_lage: stand } }}>
      <Form.Item name={standFeld('eigene_lage')} noStyle>
        <UebernahmeStand grenze={grenze} />
      </Form.Item>
    </Form>
  );
}

const marke = () => document.querySelector('[data-lfh="uebernahme-stand"]');

describe('UebernahmeStand (LLH-1357)', () => {
  it('zeigt den Stand der Übernahme als DTG', () => {
    renderMitProviders(<Probe stand="2026-10-21 10:30:00" />);
    expect(marke()).toHaveTextContent(`${STAND_DER_UEBERNAHME} 211230OKT2026`);
    expect(marke()).not.toHaveTextContent(AUS_DER_VORFASSUNG);
    expect(marke()).not.toHaveAttribute('data-aus-vorfassung');
  });

  it('ohne Stand steht nichts', () => {
    renderMitProviders(<Probe />);
    expect(marke()).toBeNull();
    expect(screen.queryByText(new RegExp(STAND_DER_UEBERNAHME))).toBeNull();
  });

  it('ein Stand aus der Vorfassung ist auffällig, mit Wort neben der Farbe', () => {
    renderMitProviders(<Probe stand="2026-10-21 09:55:00" grenze="2026-10-21 11:50:00" />);
    expect(marke()).toHaveTextContent(
      `${STAND_DER_UEBERNAHME} 211155OKT2026 · ${AUS_DER_VORFASSUNG}`,
    );
    expect(marke()).toHaveAttribute('data-aus-vorfassung', 'true');
    // Das Zeichen ist Schmuck, die Wörter tragen die Aussage.
    expect(marke()?.querySelector('[aria-hidden]')).toHaveTextContent('⧖');
  });

  it('ein in dieser Fassung übernommener Stand ist nicht auffällig', () => {
    renderMitProviders(<Probe stand="2026-10-21 11:51:00" grenze="2026-10-21 11:50:00" />);
    expect(marke()).not.toHaveTextContent(AUS_DER_VORFASSUNG);
  });

  it('steht nicht auf Papier', () => {
    renderMitProviders(<Probe stand="2026-10-21 10:30:00" />);
    expect(marke()).toHaveClass('lagebericht-no-print');
  });
});
