import { describe, expect, it } from 'vitest';
import { theme } from 'antd';
import { buildTierMarker, tierKartenLabel, type TierKartenEintrag } from './tierMarker';
import { rollenFarbe } from '../../theme/statusFarben';
import { markerZeichen } from './markerIcons';

const token = theme.getDesignToken();

function tier(teil: Partial<TierKartenEintrag> = {}): TierKartenEintrag {
  return {
    id: 7,
    registrier_nr: 7,
    status: 'aktiv',
    spezies: 'hund',
    rufname: 'Bello',
    antreff_ort: 'Garten',
    ...teil,
  };
}

describe('buildTierMarker (LLH-1123)', () => {
  it('ein verortetes offenes Tier trägt Bedienrolle und Trefferzone, kein Kurzzeichen (LLH-1343)', () => {
    const { verortet, nichtVerortet } = buildTierMarker(
      [tier({ antreff_lat: 51.93, antreff_lon: 8.87 })],
      token,
    );
    expect(nichtVerortet).toEqual([]);
    expect(verortet).toEqual([
      {
        schluessel: 'tier-7',
        typ: 'tier',
        id: 7,
        lat: 51.93,
        lon: 8.87,
        label: 'T-007 (Hund)',
        farbe: rollenFarbe('bedien', token),
        trefferDurchmesser: token.controlHeight,
      },
    ]);
  });

  it('ein vermisstes Tier trägt Achtung und das Wort „vermisst“ als zweiten Kanal', () => {
    const { verortet } = buildTierMarker(
      [tier({ status: 'vermisst', antreff_lat: 1, antreff_lon: 2 })],
      token,
    );
    expect(verortet[0].farbe).toBe(rollenFarbe('achtung', token));
    expect(verortet[0].beschriftungZusatz).toBe('vermisst');
    // Unter dem Mindestzoom der Beschriftung: die Achtung-Scheibe hinter dem Zeichen (LLH-1343).
    expect(verortet[0].statusFarbe).toBe(rollenFarbe('achtung', token));
    expect(verortet[0].label).toBe('T-007 (Hund)');
  });

  it('ohne Koordinate steht das Tier in „Nicht verortet“', () => {
    const { verortet, nichtVerortet } = buildTierMarker([tier({ spezies: 'katze' })], token);
    expect(verortet).toEqual([]);
    expect(nichtVerortet).toEqual([{ typ: 'tier', id: 7, label: 'T-007 (Katze)' }]);
  });

  it('abgeschlossene und stornierte Tiere fehlen auf der Karte und in „Nicht verortet“', () => {
    const { verortet, nichtVerortet } = buildTierMarker(
      [
        tier({ id: 1, status: 'abgeschlossen', antreff_lat: 1, antreff_lon: 2 }),
        tier({ id: 2, status: 'abgeschlossen' }),
        tier({ id: 3, storniert_at: '2026-10-01 10:00:00', antreff_lat: 1, antreff_lon: 2 }),
      ],
      token,
    );
    expect(verortet).toEqual([]);
    expect(nichtVerortet).toEqual([]);
  });

  it('ein offenes Tier hat keine Scheibe hinter dem Zeichen', () => {
    const { verortet } = buildTierMarker([tier({ antreff_lat: 1, antreff_lon: 2 })], token);
    expect(verortet[0].statusFarbe).toBeUndefined();
  });

  it('das Zeichen ist das Tier ohne Zustand aus @einsatzzeichen, für offene und vermisste dasselbe', () => {
    const { verortet } = buildTierMarker(
      [
        tier({ id: 1, antreff_lat: 1, antreff_lon: 2 }),
        tier({ id: 2, status: 'vermisst', antreff_lat: 1, antreff_lon: 2 }),
      ],
      token,
    );
    const [offen, vermisst] = verortet.map((mk) => markerZeichen(mk));
    expect(offen?.schluessel).toBe('ez|{"v":1,"freestanding":{"kind":"animal-state"}}');
    expect(vermisst?.schluessel).toBe(offen?.schluessel);
  });

  it('der Rufname steht nicht auf der Karte', () => {
    expect(tierKartenLabel({ registrier_nr: 42, spezies: 'grosstier' })).toBe('T-042 (Großtier)');
  });
});
