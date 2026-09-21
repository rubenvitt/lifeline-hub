import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderMitProviders } from '../../test/utils';
import { dichten } from '../../theme/tokens';
import Segmentleiste, { naechsterIndex, segmentStil, type SegmentOption } from './Segmentleiste';

const OPTIONEN: SegmentOption<string>[] = [
  { wert: 'alle', label: 'Alle' },
  { wert: 'meldung', label: 'Meldung', punkt: 'rgb(22, 119, 255)' },
  { wert: 'lage', label: 'Lage' },
];

function Gesteuert({ rolle }: { rolle?: 'radiogroup' | 'tablist' }) {
  const [wert, setWert] = useState('alle');
  return (
    <Segmentleiste
      optionen={OPTIONEN}
      wert={wert}
      onWechsel={setWert}
      beschriftung="Einträge nach Typ"
      rolle={rolle}
    />
  );
}

describe('Segmentleiste', () => {
  it('ist eine benannte Radiogruppe mit genau einem gewählten Segment', () => {
    renderMitProviders(<Gesteuert />);
    expect(screen.getByRole('radiogroup', { name: 'Einträge nach Typ' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Alle' })).toBeChecked();
    expect(screen.getAllByRole('radio', { checked: true })).toHaveLength(1);
  });

  it('wählt per Klick', async () => {
    const onWechsel = vi.fn();
    renderMitProviders(
      <Segmentleiste optionen={OPTIONEN} wert="alle" onWechsel={onWechsel} beschriftung="x" />,
    );
    await userEvent.click(screen.getByRole('radio', { name: 'Lage' }));
    expect(onWechsel).toHaveBeenCalledWith('lage');
  });

  it('Pfeiltasten wandern und wählen, Fokus folgt; nur das gewählte Segment liegt im Tab-Weg', async () => {
    renderMitProviders(<Gesteuert />);
    const alle = screen.getByRole('radio', { name: 'Alle' });
    expect(alle).toHaveAttribute('tabindex', '0');
    expect(screen.getByRole('radio', { name: 'Lage' })).toHaveAttribute('tabindex', '-1');
    alle.focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(screen.getByRole('radio', { name: 'Meldung' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Meldung' })).toHaveFocus();
    await userEvent.keyboard('{ArrowLeft}{ArrowLeft}');
    expect(screen.getByRole('radio', { name: 'Lage' })).toBeChecked();
  });

  it('als Tabliste trägt es Tabs mit aria-selected', () => {
    renderMitProviders(<Gesteuert rolle="tablist" />);
    expect(screen.getByRole('tablist')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Alle' })).toHaveAttribute('aria-selected', 'true');
  });

  it('der Farbpunkt ist Dekoration — der Name bleibt der Wortlaut', () => {
    renderMitProviders(<Gesteuert />);
    const meldung = screen.getByRole('radio', { name: 'Meldung' });
    const punkt = meldung.querySelector('[data-lfh="segment-punkt"]');
    expect(punkt).toHaveAttribute('aria-hidden', 'true');
  });

  it('naechsterIndex läuft im Kreis und kennt Pos1/Ende', () => {
    expect(naechsterIndex('ArrowRight', 2, 3)).toBe(0);
    expect(naechsterIndex('ArrowLeft', 0, 3)).toBe(2);
    expect(naechsterIndex('Home', 2, 3)).toBe(0);
    expect(naechsterIndex('End', 0, 3)).toBe(2);
    expect(naechsterIndex('a', 0, 3)).toBeNull();
  });

  /** Gate 3: ZWEI Angaben an einem handgebauten Bedienziel, Böden als Literale. */
  it('Bedienziel: Boden 30 / 48 / 72 aus controlHeight, plus Polsterung, die mitwächst', () => {
    const t = (s: keyof typeof dichten) => ({
      controlHeight: dichten[s].zeilenhoehe,
      paddingSM: dichten[s].abstand.sm,
      marginXS: dichten[s].abstand.xs,
    });
    expect(segmentStil(t('kompakt')).minHeight).toBe(30);
    expect(segmentStil(t('komfortabel')).minHeight).toBe(48);
    expect(segmentStil(t('handschuh')).minHeight).toBe(72);
    expect(segmentStil(t('kompakt')).paddingInline).not.toBe(
      segmentStil(t('handschuh')).paddingInline,
    );
  });
});
