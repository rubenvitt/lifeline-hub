import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderMitProviders } from '../../test/utils';
import type { AlarmEintrag, WasBrennt } from '../../lage/wasBrennt';
import AlarmZeile, { ALARMZEILE_SCHRIFT, alarmEintragHoehe } from './AlarmZeile';

const e = (art: AlarmEintrag['art'], rolle: AlarmEintrag['rolle'], text: string): AlarmEintrag => ({
  art,
  rolle,
  text,
  voll: `${text} (voll)`,
  bezug: [],
});

const ACHT: AlarmEintrag[] = [
  e('sofort', 'alarm', '1 Sofortmeldung'),
  e('bestaetigung', 'alarm', '1 Bestätigung überfällig'),
  e('vermisst', 'alarm', '1 vermisst'),
  e('kritisch', 'alarm', 'kritisch: UHS'),
  e('rueckmeldung', 'alarm', 'Rückmeldung überfällig: A'),
  e('auftrag', 'alarm', '1 Auftrag überfällig'),
  e('dringend', 'achtung', '1 dringend'),
  e('erinnerung', 'achtung', '1 Erinnerung fällig'),
];

const daten = (eintraege: AlarmEintrag[], stand: WasBrennt['stand'] = 'vollstaendig') => ({
  eintraege,
  stand,
  fehlend: stand === 'unvollstaendig' ? ['Rückmeldungen'] : [],
});

const zeile = (c: HTMLElement) => c.querySelector<HTMLElement>('[data-lfh="alarm-zeile"]')!;
const sichtbare = (c: HTMLElement) =>
  Array.from(zeile(c).querySelectorAll<HTMLElement>('[data-lfh="alarm-eintrag"]'));

afterEach(() => vi.restoreAllMocks());

describe('AlarmZeile (Spec lage-alarmzeile)', () => {
  it('feste Höhe, unabhängig von 0, 1 oder 8 Einträgen', () => {
    const hoehen = new Set<string>();
    for (const liste of [[], ACHT.slice(0, 1), ACHT]) {
      const { container, unmount } = renderMitProviders(<AlarmZeile daten={daten(liste)} />);
      hoehen.add(zeile(container).style.height);
      expect(zeile(container).style.fontSize).toBe(`${ALARMZEILE_SCHRIFT.normal}px`);
      unmount();
    }
    expect(hoehen.size).toBe(1);
    expect(ALARMZEILE_SCHRIFT.normal).toBeGreaterThanOrEqual(16);
  });

  it('Treffläche folgt der Dichtestufe: Einträge in Steuerhöhe 30 / 48 / 72 px', () => {
    expect([30, 48, 72].map((h) => alarmEintragHoehe('normal', h))).toEqual([30, 48, 72]);
    expect(alarmEintragHoehe('normal', 20)).toBe(28);
    expect(alarmEintragHoehe('gross', 72)).toBe(40);
  });

  it('Rolle als Fläche und Wort, Links nur mit Ziel, role=status statt alert', () => {
    const { container } = renderMitProviders(
      <AlarmZeile
        daten={daten([ACHT[2], ACHT[6]])}
        ziel={(x) => (x.art === 'vermisst' ? '/einsaetze/1/personen?filter=vermisst' : undefined)}
      />,
    );
    expect(screen.getByRole('status', { name: 'Was brennt' })).toBe(zeile(container));
    expect(sichtbare(container).map((x) => [x.textContent, x.dataset.ton])).toEqual([
      ['1 vermisst', 'alarm'],
      ['1 dringend', 'achtung'],
    ]);
    const link = screen.getByRole('link', { name: '1 vermisst (voll)' });
    expect(link).toHaveAttribute('href', '/einsaetze/1/personen?filter=vermisst');
    expect(screen.queryByRole('link', { name: /dringend/ })).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('Ruhe nur bei vollständigem Stand', () => {
    const { container, rerender } = renderMitProviders(<AlarmZeile daten={daten([])} />);
    expect(zeile(container)).toHaveTextContent('Nichts brennt');
    rerender(<AlarmZeile daten={daten([], 'unvollstaendig')} />);
    expect(zeile(container)).not.toHaveTextContent('Nichts brennt');
    expect(zeile(container)).toHaveTextContent('Stand unvollständig: Rückmeldungen nicht geladen');
    rerender(<AlarmZeile daten={daten([], 'laedt')} />);
    expect(zeile(container)).not.toHaveTextContent('Nichts brennt');
    expect(zeile(container)).toHaveTextContent('—');
  });

  it('zu schmal: drei Einträge und „+5“, der Knopf zeigt alle acht', async () => {
    // jsdom misst nichts: Breite der Reihe 400 px, jeder Eintrag 100 px, „+n“ 40 px.
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(400);
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(function (
      this: HTMLElement,
    ) {
      return this.textContent?.startsWith('+') ? 40 : 100;
    });
    const { container } = renderMitProviders(<AlarmZeile daten={daten(ACHT)} />);
    expect(sichtbare(container)).toHaveLength(3);
    const knopf = screen.getByRole('button', { name: 'Alle 8 zeigen' });
    expect(knopf).toHaveTextContent('+5');
    await userEvent.click(knopf);
    const liste = await screen.findByRole('list');
    expect(within(liste).getAllByRole('listitem')).toHaveLength(8);
    expect(liste).toHaveTextContent('1 Erinnerung fällig (voll)');
  });

  it('gross (Lagemonitor): 28 px, ohne Links und ohne Knopf', () => {
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(400);
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(100);
    const { container } = renderMitProviders(
      <AlarmZeile daten={daten(ACHT)} groesse="gross" ziel={() => '/x'} />,
    );
    expect(zeile(container).style.fontSize).toBe('28px');
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
    // Sichtbar „+n“ außerhalb der Messreihe: 400 px fassen „+n“ (100 + 12) und zwei Einträge.
    expect(sichtbare(container)).toHaveLength(2);
    expect(zeile(container).querySelector('[data-lfh="alarm-mehr"]')).toHaveTextContent('+6');
  });

  it('unvollständiger Stand neben Einträgen: der Hinweis behält seinen Platz (Review)', async () => {
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(400);
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(function (
      this: HTMLElement,
    ) {
      const t = this.textContent ?? '';
      return t.startsWith('Stand') ? 150 : t.startsWith('+') ? 40 : 100;
    });
    const { container } = renderMitProviders(
      <AlarmZeile daten={daten(ACHT.slice(0, 3), 'unvollstaendig')} />,
    );
    // 400 px: Hinweis (150 + 6) und „+n“ (40 + 6) gehen vor, es bleibt Platz für einen Eintrag.
    expect(sichtbare(container)).toHaveLength(1);
    expect(zeile(container).querySelector('[data-lfh="alarm-mehr"]')).toHaveTextContent('+2');
    expect(zeile(container).querySelector('[data-lfh="alarm-hinweis"]')).toHaveTextContent(
      'Stand unvollständig: Rückmeldungen nicht geladen',
    );
    // Die Liste hinter „+n“ nennt den Stand auch, in mindestens 16 px.
    await userEvent.click(screen.getByRole('button', { name: 'Alle 3 zeigen' }));
    const liste = await screen.findByRole('list');
    expect(liste).toHaveTextContent('Stand unvollständig: Rückmeldungen nicht geladen');
    for (const e of within(liste).getAllByRole('listitem')) {
      const groesse =
        (e.firstElementChild as HTMLElement | null)?.style.fontSize || e.style.fontSize;
      expect(parseFloat(groesse)).toBeGreaterThanOrEqual(16);
    }
  });
});
