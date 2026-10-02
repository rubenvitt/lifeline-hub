import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderMitProviders } from '../test/utils';
import KopierbarerText from './KopierbarerText';

/**
 * LFH-763: Die Kopieraktion ist ein echter antd-`Button` und erbt damit `controlHeight` der
 * Dichte-Staffel; antds `Typography copyable` maß in jeder Stufe 15 × 13 px. Die gemessene
 * Höhe je Stufe belegt `e2e/gate3-trefflaeche.spec.ts` (jsdom rechnet kein Layout).
 */
describe('KopierbarerText (LFH-763)', () => {
  const schreibe = vi.fn<(text: string) => Promise<void>>();

  function mitZwischenablage() {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: schreibe },
    });
  }

  afterEach(() => {
    schreibe.mockReset();
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined });
  });

  it('nennt im zugänglichen Namen, WAS kopiert wird', () => {
    mitZwischenablage();
    renderMitProviders(
      <KopierbarerText text="JBSWY3DP" bezeichnung="TOTP-Geheimnis">
        Secret: <code>JBSWY3DP</code>
      </KopierbarerText>,
    );
    expect(screen.getByRole('button', { name: 'TOTP-Geheimnis kopieren' })).toBeInTheDocument();
    expect(screen.getByText('JBSWY3DP')).toBeInTheDocument();
  });

  it('ist ein antd-Knopf ohne eigene Größe: die Höhe kommt aus controlHeight', () => {
    mitZwischenablage();
    renderMitProviders(<KopierbarerText text="x" bezeichnung="Adresse" />);
    const knopf = screen.getByRole('button', { name: 'Adresse kopieren' });
    expect(knopf).toHaveClass('ant-btn');
    expect(knopf).not.toHaveClass('ant-btn-sm');
    expect(knopf.querySelector('[data-lfh-icon="kopieren"]')).not.toBeNull();
  });

  it('kopiert den Text und meldet den Erfolg mit der Bezeichnung', async () => {
    mitZwischenablage();
    schreibe.mockResolvedValue(undefined);
    renderMitProviders(<KopierbarerText text="JBSWY3DP" bezeichnung="TOTP-Geheimnis" />);
    await userEvent.click(screen.getByRole('button', { name: 'TOTP-Geheimnis kopieren' }));
    expect(schreibe).toHaveBeenCalledWith('JBSWY3DP');
    expect(await screen.findByText('TOTP-Geheimnis kopiert')).toBeInTheDocument();
  });

  it('meldet ein abgelehntes Kopieren, statt still nichts zu tun', async () => {
    mitZwischenablage();
    schreibe.mockRejectedValue(new DOMException('verweigert', 'NotAllowedError'));
    renderMitProviders(<KopierbarerText text="JBSWY3DP" bezeichnung="TOTP-Geheimnis" />);
    await userEvent.click(screen.getByRole('button', { name: 'TOTP-Geheimnis kopieren' }));
    await waitFor(() => expect(screen.getByText(/Kopieren fehlgeschlagen/)).toBeInTheDocument());
  });

  it('zeigt ohne Zwischenablage (kein Secure Context) keinen Knopf, der nichts tut', () => {
    renderMitProviders(
      <KopierbarerText text="JBSWY3DP" bezeichnung="TOTP-Geheimnis">
        <code>JBSWY3DP</code>
      </KopierbarerText>,
    );
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByText('JBSWY3DP')).toBeInTheDocument();
  });
});
