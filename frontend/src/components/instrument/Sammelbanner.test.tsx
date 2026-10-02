import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { renderMitProviders } from '../../test/utils';
import { farbenHell } from '../../theme/tokens';
import Sammelbanner, { sammelbannerKurz } from './Sammelbanner';

describe('Sammelbanner', () => {
  it('meldet höflich (role=status) und trägt die eine Aktion', async () => {
    const onKlick = vi.fn();
    renderMitProviders(
      <Sammelbanner aktion={{ label: 'anzeigen', onKlick }}>14 neue Einträge</Sammelbanner>,
    );
    const banner = screen.getByRole('status');
    expect(banner).toHaveTextContent('14 neue Einträge');
    await userEvent.click(within(banner).getByRole('button', { name: 'anzeigen' }));
    expect(onKlick).toHaveBeenCalledTimes(1);
  });

  it('Blau, nicht Rot: Grund bannerGrund, Kante bannerLinie, Text bedienText', () => {
    renderMitProviders(<Sammelbanner>3 neue Meldungen</Sammelbanner>);
    const banner = screen.getByRole('status');
    expect(banner).toHaveStyle({
      background: farbenHell.bannerGrund,
      border: `1px solid ${farbenHell.bannerLinie}`,
    });
    expect(screen.getByText('3 neue Meldungen')).toHaveStyle({ color: farbenHell.bedienText });
  });

  it('das Icon ist kein eigenes Vorleseziel', () => {
    renderMitProviders(<Sammelbanner>1 neue Meldung</Sammelbanner>);
    // antds Icon bringt role="img" mit englischem Namen — die Hülle blendet es aus.
    expect(screen.queryByRole('img')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
  });

  describe('Kurzform für den Handschirm (LFH-694)', () => {
    it('sammelbannerKurz: die Zahl der wartenden Einträge, sonst „umgeordnet“', () => {
      expect(sammelbannerKurz(1, false)).toBe('1 neu');
      expect(sammelbannerKurz(12, false)).toBe('12 neu');
      expect(sammelbannerKurz(0, true)).toBe('umgeordnet');
      // Warten Einträge UND ist umgeordnet, gewinnt die Zahl — die Umordnung steht im Satz.
      expect(sammelbannerKurz(3, true)).toBe('3 neu');
    });

    it('ist EIN Knopf: Kurzform sichtbar, Name mit „anzeigen“, Klick gibt frei', async () => {
      const onKlick = vi.fn();
      renderMitProviders(
        <Sammelbanner kurz="1 neu" aktion={{ label: 'anzeigen', onKlick }}>
          1 neues Zeitfenster, davon 1 mit Unterdeckung
        </Sammelbanner>,
      );
      const banner = screen.getByRole('status');
      const knoepfe = within(banner).getAllByRole('button');
      expect(knoepfe).toHaveLength(1);
      expect(knoepfe[0]).toHaveAccessibleName('1 neu anzeigen');
      expect(knoepfe[0]).toHaveTextContent(/^1 neu$/);
      await userEvent.click(knoepfe[0]);
      expect(onKlick).toHaveBeenCalledTimes(1);
    });

    it('der volle Satz bleibt im Statusbereich, für Hilfstechnik', () => {
      renderMitProviders(
        <Sammelbanner kurz="1 neu" aktion={{ label: 'anzeigen', onKlick: vi.fn() }}>
          1 neues Zeitfenster, davon 1 mit Unterdeckung
        </Sammelbanner>,
      );
      const satz = within(screen.getByRole('status')).getByText(
        '1 neues Zeitfenster, davon 1 mit Unterdeckung',
      );
      // Visuell verborgen (Clip-Bauform), nicht `display: none` — sonst hörte ihn niemand.
      expect(satz).toHaveStyle({ position: 'absolute', overflow: 'hidden' });
      expect(satz.closest('button')).toBeNull();
    });

    it('Grund, Kante und Icon wie die lange Form', () => {
      renderMitProviders(
        <Sammelbanner kurz="umgeordnet" aktion={{ label: 'anzeigen', onKlick: vi.fn() }}>
          Reihenfolge geändert
        </Sammelbanner>,
      );
      const knopf = screen.getByRole('button');
      expect(knopf).toHaveStyle({
        background: farbenHell.bannerGrund,
        border: `1px solid ${farbenHell.bannerLinie}`,
      });
      expect(screen.queryByRole('img')).toBeNull();
    });

    it('ohne Aktion bleibt die lange Form — eine Kurzform ohne Freigabe hätte kein Ziel', () => {
      renderMitProviders(<Sammelbanner kurz="1 neu">1 neue Meldung</Sammelbanner>);
      expect(screen.queryByRole('button')).toBeNull();
      expect(screen.getByRole('status')).toHaveTextContent('1 neue Meldung');
    });
  });
});
