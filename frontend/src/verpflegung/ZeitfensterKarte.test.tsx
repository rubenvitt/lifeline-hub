import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import { describe, expect, it, vi } from 'vitest';
import type { VerpflegungZeitfenster } from '../api/types';
import { renderMitProviders } from '../test/utils';
import { KEINE_SONDERKOST, ausgabe, zeitfenster } from '../test/verpflegungDaten';
import ZeitfensterKarte, { type ZeitfensterKarteProps } from './ZeitfensterKarte';
import { zeitfensterKennung } from './verpflegungText';

dayjs.extend(utc);

/** „Mittag" beginnt 10:00 UTC — absolute Zeitpunkte, unabhängig von der Zone der Maschine. */
const VORHER = dayjs('2026-09-24T08:00:00Z');
const LAUFEND = dayjs('2026-09-24T10:30:00Z');

const kennung = zeitfensterKennung(zeitfenster());

function zeige(zf: VerpflegungZeitfenster, over: Partial<ZeitfensterKarteProps> = {}) {
  const props: ZeitfensterKarteProps = {
    zeitfenster: zf,
    jetzt: LAUFEND,
    darfSchreiben: true,
    nachforderungenFrei: true,
    onAusgabeErfassen: vi.fn(),
    onBearbeiten: vi.fn(),
    onNachfordern: vi.fn(),
    onLoeschen: vi.fn(),
    onZuruecknehmen: vi.fn(),
    ...over,
  };
  renderMitProviders(<ZeitfensterKarte {...props} />);
  return { props, karte: screen.getByRole('article') };
}

/** Das geöffnete Menü — Konvention aus CLAUDE.md (LFH-365). */
async function oeffneMenue() {
  await userEvent.click(screen.getByRole('button', { name: `Aktionen zu Zeitfenster ${kennung}` }));
  return waitFor(() => {
    const menue = document.querySelector<HTMLElement>(
      '.ant-dropdown:not(.ant-dropdown-hidden) [role="menu"]',
    );
    expect(menue).not.toBeNull();
    return menue!;
  });
}

const fehltWert = (karte: HTMLElement) =>
  [...karte.querySelectorAll<HTMLElement>('[data-lfh="kennzahl"]')].find((k) =>
    k.textContent?.startsWith('fehlt'),
  )!;

describe('ZeitfensterKarte — Einstufung (Spec „Deckung und Unterdeckung")', () => {
  it('Unterdeckung im laufenden Zeitfenster: Fehlmenge 20, Wort, Alarmrand und data-Marke, ohne Animation', () => {
    const { karte } = zeige(zeitfenster());
    expect(karte).toHaveAttribute('data-einstufung', 'unterdeckung');
    expect(karte).toHaveAttribute('data-alarm', 'true');
    expect(within(karte).getByText('Unterdeckung')).toBeInTheDocument();
    const fehlt = fehltWert(karte);
    expect(fehlt).toHaveAttribute('data-ton', 'alarm');
    expect(within(fehlt).getByText('20')).toBeInTheDocument();
    // Kein Blinken — weder an der Karte noch am Etikett.
    expect(karte.style.animation).toBe('');
    expect(within(karte).getByText('Unterdeckung').closest('.ant-tag')).toHaveAttribute(
      'data-rolle',
      'alarm',
    );
    expect(
      (within(karte).getByText('Unterdeckung').closest('.ant-tag') as HTMLElement).style.animation,
    ).toBe('');
  });

  it('vor Beginn „offen" ohne Alarm — die Fehlmenge steht trotzdem als Zahl da', () => {
    const { karte } = zeige(zeitfenster(), { jetzt: VORHER });
    expect(karte).toHaveAttribute('data-einstufung', 'offen');
    expect(karte).not.toHaveAttribute('data-alarm');
    expect(within(karte).getByText('offen').closest('.ant-tag')).toHaveAttribute(
      'data-rolle',
      'neutral',
    );
    const fehlt = fehltWert(karte);
    expect(fehlt).toHaveAttribute('data-ton', 'neutral');
    expect(within(fehlt).getByText('20')).toBeInTheDocument();
  });

  it('Überdeckung ist gedeckt: Fehlmenge 0', () => {
    const { karte } = zeige(
      zeitfenster({
        ausgegeben: { gesamt: 270, sonderkost: { ...KEINE_SONDERKOST, vegan: 3 } },
        fehlmenge: { gesamt: 0, sonderkost: KEINE_SONDERKOST },
      }),
    );
    expect(karte).toHaveAttribute('data-einstufung', 'gedeckt');
    expect(within(karte).getByText('gedeckt', { selector: '.ant-tag' })).toBeInTheDocument();
    expect(within(fehltWert(karte)).getByText('0')).toBeInTheDocument();
  });

  it('Sonderkost fehlt trotz Gesamtdeckung: die Kostform wird genannt, Einstufung Unterdeckung', () => {
    const { karte } = zeige(
      zeitfenster({
        ausgegeben: { gesamt: 250, sonderkost: KEINE_SONDERKOST },
        fehlmenge: { gesamt: 0, sonderkost: { ...KEINE_SONDERKOST, vegan: 3 } },
      }),
    );
    expect(karte).toHaveAttribute('data-einstufung', 'unterdeckung');
    const zeile = karte.querySelector('[data-kostform="vegan"]') as HTMLElement;
    expect(within(zeile).getByText('fehlt 3 vegan')).toBeInTheDocument();
    expect(within(zeile).getByText('Bedarf 3 · ausgegeben 0')).toBeInTheDocument();
    // Nur belegte Kostformen stehen da.
    expect(karte.querySelectorAll('[data-kostform]')).toHaveLength(1);
  });

  it('zeigt Zeitraum und Aufteilung des Bedarfs', () => {
    const { karte } = zeige(zeitfenster());
    const von = dayjs.utc('2026-09-24 10:00:00').local().format('DD.MM. HH:mm');
    const bis = dayjs.utc('2026-09-24 11:30:00').local().format('HH:mm');
    expect(karte.querySelector('[data-lfh="verpflegung-zeitraum"]')).toHaveTextContent(
      `${von}–${bis}`,
    );
    expect(
      within(karte).getByRole('img', {
        name: 'Bedarf nach Personengruppe: Kräfte 180, Betreute 70, weitere 0',
      }),
    ).toBeInTheDocument();
  });
});

describe('ZeitfensterKarte — Ausgaben', () => {
  it('eine zurückgenommene Ausgabe steht mit dem Wort und ohne Rücknahme-Knopf da', () => {
    const { karte } = zeige(
      zeitfenster({
        ausgaben: [
          ausgabe({ id: 11, menge: 120 }),
          ausgabe({ id: 12, menge: 60, zurueckgenommen_at: '2026-09-24 09:50:00' }),
        ],
      }),
    );
    const zeilen = karte.querySelectorAll<HTMLElement>('[data-lfh="verpflegung-ausgabe"]');
    expect(zeilen).toHaveLength(2);
    expect(zeilen[1]).toHaveAttribute('data-zurueckgenommen', 'true');
    expect(within(zeilen[1]).getByText('zurückgenommen')).toBeInTheDocument();
    expect(within(zeilen[1]).queryByRole('button')).toBeNull();
    expect(within(zeilen[0]).getByText('Ausgabe')).toBeInTheDocument();
    expect(
      within(zeilen[0]).getByRole('button', { name: /^Zurücknehmen: Ausgabe 120 EP um/ }),
    ).toBeInTheDocument();
  });

  it('Zurücknehmen meldet die Ausgabe an die Seite (die fragt zurück)', async () => {
    const zf = zeitfenster();
    const { props } = zeige(zf);
    await userEvent.click(screen.getByRole('button', { name: /^Zurücknehmen: Ausgabe 230 EP/ }));
    expect(props.onZuruecknehmen).toHaveBeenCalledWith(zf.ausgaben[0], zf);
  });

  it('mit Modul Nachforderungen steht der aufgelöste Name', () => {
    zeige(zeitfenster({ ausgaben: [ausgabe({ id: 11, nachforderung_id: 4 })] }), {
      nachforderungName: (id) => (id === 4 ? 'Feldküche' : undefined),
    });
    expect(screen.getByText('Nachforderung: Feldküche')).toBeInTheDocument();
  });
});

describe('ZeitfensterKarte — Aktionen (LFH-365)', () => {
  it('ohne Schreibrecht keine Aktionen, auch keine Rücknahme', () => {
    const { karte } = zeige(zeitfenster(), { darfSchreiben: false });
    expect(within(karte).queryByRole('button')).toBeNull();
    expect(karte.querySelector('[data-lfh="verpflegung-aktionen"]')).toBeNull();
  });

  it('drei Aktionen: „Ausgabe erfassen" sichtbar, der Rest im Menü; Nachfordern meldet sich', async () => {
    const zf = zeitfenster();
    const { props } = zeige(zf);
    expect(
      screen.getByRole('button', { name: `Ausgabe erfassen zu ${kennung}` }),
    ).toBeInTheDocument();
    const menue = await oeffneMenue();
    expect(within(menue).getByText('Bedarf bearbeiten')).toBeInTheDocument();
    // Löschen nur ohne gültige Ausgabe — hier gibt es eine.
    expect(within(menue).queryByText('Löschen')).toBeNull();
    await userEvent.click(within(menue).getByText('Nachfordern'));
    expect(props.onNachfordern).toHaveBeenCalledWith(zf);
  });

  it('ohne gültige Ausgabe: Löschen rot hinter dem Trenner', async () => {
    zeige(
      zeitfenster({
        ausgaben: [ausgabe({ id: 11, zurueckgenommen_at: '2026-09-24 09:50:00' })],
      }),
    );
    const menue = await oeffneMenue();
    const loeschen = within(menue).getByText('Löschen').closest('[role="menuitem"]');
    expect(loeschen).toHaveClass('ant-dropdown-menu-item-danger');
    expect(menue.querySelector('.ant-dropdown-menu-item-divider')).not.toBeNull();
  });

  it('zwei Aktionen bleiben zwei Knöpfe — gebündelt wird erst ab drei', () => {
    zeige(
      zeitfenster({
        ausgegeben: { gesamt: 250, sonderkost: { ...KEINE_SONDERKOST, vegan: 3 } },
        fehlmenge: { gesamt: 0, sonderkost: KEINE_SONDERKOST },
      }),
    );
    expect(screen.queryByRole('button', { name: /^Aktionen zu/ })).toBeNull();
    expect(
      screen.getByRole('button', { name: `Bedarf bearbeiten zu ${kennung}` }),
    ).toBeInTheDocument();
  });

  it('ohne Modul Nachforderungen: kein „Nachfordern" und „Nachforderung #n" statt Name', () => {
    const nachforderungName = vi.fn(() => 'Feldküche');
    zeige(zeitfenster({ ausgaben: [ausgabe({ id: 11, nachforderung_id: 4 })] }), {
      nachforderungenFrei: false,
      nachforderungName,
    });
    expect(screen.getByText('Nachforderung #4')).toBeInTheDocument();
    expect(screen.queryByText(/Feldküche/)).toBeNull();
    expect(nachforderungName).not.toHaveBeenCalled();
    // Mit „Bedarf bearbeiten" allein sind es zwei Aktionen — kein Menü, kein Nachfordern.
    expect(screen.queryByRole('button', { name: /Nachfordern/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Aktionen zu/ })).toBeNull();
  });

  it('Fehlmenge nur in einer Kostform bietet kein Nachfordern an (Anzahl 0 wäre unbrauchbar)', () => {
    zeige(
      zeitfenster({
        ausgegeben: { gesamt: 250, sonderkost: KEINE_SONDERKOST },
        fehlmenge: { gesamt: 0, sonderkost: { ...KEINE_SONDERKOST, vegan: 3 } },
      }),
    );
    expect(screen.queryByRole('button', { name: /Nachfordern/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Aktionen zu/ })).toBeNull();
  });
});
