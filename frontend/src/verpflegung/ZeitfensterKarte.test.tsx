import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import { describe, expect, it, vi } from 'vitest';
import type { VerpflegungZeitfenster } from '../api/types';
import { EinsatzPfadeProvider, GERAET_PFADE } from '../routing/EinsatzPfade';
import { renderMitProviders } from '../test/utils';
import { setzeViewportBreite } from '../test/viewport';
import {
  ABSCHNITT_DEICH,
  DEICH,
  FELDKUECHE,
  GRUPPE_1,
  GRUPPE_2,
  KEINE_SONDERKOST,
  TURNHALLE,
  ausgabe,
  empfaenger,
  stelle,
  verpflegungMitStellen,
  zeitfenster,
} from '../test/verpflegungDaten';
import ZeitfensterKarte, { type ZeitfensterKarteProps } from './ZeitfensterKarte';
import { zeitfensterKennung } from './verpflegungText';

dayjs.extend(utc);

/** „Mittag" beginnt 10:00 UTC — absolute Zeitpunkte, unabhängig von der Zone der Maschine. */
const VORHER = dayjs('2026-09-24T08:00:00Z');
const LAUFEND = dayjs('2026-09-24T10:30:00Z');
const VORBEI = dayjs('2026-09-24T12:00:00Z');

const kennung = zeitfensterKennung(zeitfenster());

function zeige(
  zf: VerpflegungZeitfenster,
  over: Partial<ZeitfensterKarteProps> = {},
  geraet = false,
) {
  const props: ZeitfensterKarteProps = {
    zeitfenster: zf,
    jetzt: LAUFEND,
    darfSchreiben: true,
    nachforderungenFrei: true,
    onAusgabeNachtragen: vi.fn(),
    onBedarfSpeichern: vi.fn().mockResolvedValue(undefined),
    onNachfordern: vi.fn(),
    onLoeschen: vi.fn(),
    onZuruecknehmen: vi.fn(),
    ...over,
  };
  const karte = <ZeitfensterKarte {...props} />;
  renderMitProviders(
    geraet ? <EinsatzPfadeProvider pfade={GERAET_PFADE}>{karte}</EinsatzPfadeProvider> : karte,
  );
  return { props, karte: screen.getByRole('article') };
}

/** Das geöffnete Menü. */
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

describe('ZeitfensterKarte — ausstehende Ausgaben (LFH-688)', () => {
  const vorgemerkt = (menge: number, client_id: string) => ({
    id: 1,
    benutzer_id: 11,
    einsatz_id: 1,
    erstellt_at: '2026-09-24T09:40:00.000Z',
    aktion: {
      art: 'ausgabe' as const,
      zeitfenster_id: 1,
      bezeichnung: 'Mittag',
      daten: {
        menge,
        ort: 'Deich',
        sonderkost: { vegan: 2 },
        zeitpunkt_at: '2026-09-24 09:40:00',
        client_id,
      },
    },
  });

  it('steht als „ausstehend“ ohne Rücknahme da und zählt nicht in die Deckung', () => {
    // Bedarf 250, ausgegeben 100 (Server), vorgemerkt 120 → weiter Fehlmenge 150.
    const { karte } = zeige(
      zeitfenster({
        ausgegeben: { gesamt: 100, sonderkost: { ...KEINE_SONDERKOST, vegan: 3 } },
        fehlmenge: { gesamt: 150, sonderkost: KEINE_SONDERKOST },
        ausgaben: [ausgabe({ id: 11, menge: 100 })],
      }),
      { ausstehend: [vorgemerkt(120, 'a-1')] },
    );
    const zeile = karte.querySelector<HTMLElement>('[data-lfh="verpflegung-ausgabe-ausstehend"]');
    expect(zeile).not.toBeNull();
    expect(within(zeile!).getByText('ausstehend')).toBeInTheDocument();
    expect(within(zeile!).getByText('120 EP')).toBeInTheDocument();
    expect(zeile!.textContent).toContain('Deich');
    expect(zeile!.textContent).toContain('2 vegan');
    expect(within(zeile!).queryByRole('button')).toBeNull();
    expect(within(fehltWert(karte)).getByText('150')).toBeInTheDocument();
    expect(karte.querySelectorAll('[data-lfh="verpflegung-ausgabe"]')).toHaveLength(1);
  });

  it('zeigt die Liste auch, wenn bisher nur Ausstehendes da ist', () => {
    const { karte } = zeige(
      zeitfenster({
        ausgegeben: { gesamt: 0, sonderkost: KEINE_SONDERKOST },
        fehlmenge: { gesamt: 250, sonderkost: { ...KEINE_SONDERKOST, vegan: 3 } },
        ausgaben: [],
      }),
      { ausstehend: [vorgemerkt(40, 'a-2')] },
    );
    expect(within(karte).getByRole('list', { name: `Ausgaben zu ${kennung}` })).toBeInTheDocument();
    expect(karte.querySelectorAll('[data-lfh="verpflegung-ausgabe-ausstehend"]')).toHaveLength(1);
  });
});

describe('ZeitfensterKarte — Aktionen (LFH-365)', () => {
  it('ohne Schreibrecht keine Aktionen, auch keine Rücknahme und kein Sprung zur Ausgabe', () => {
    const { karte } = zeige(zeitfenster(), { darfSchreiben: false });
    expect(within(karte).queryByRole('button')).toBeNull();
    expect(within(karte).queryByRole('link')).toBeNull();
    expect(karte.querySelector('[data-lfh="verpflegung-aktionen"]')).toBeNull();
  });

  it('laufend: Sprung „Ausgabe öffnen" als Link mit Steuerhöhe, „Ausgabe nachtragen" als Aktion (LLH-1032, D8)', async () => {
    const zf = zeitfenster();
    const { props } = zeige(zf);
    const sprung = screen.getByRole('link', { name: `Ausgabe öffnen zu ${kennung}` });
    expect(sprung).toHaveAttribute('href', '/einsaetze/1/verpflegung/1/ausgabe');
    // Bedienziel-Boden: ein `<a>` erbt keine Steuerhöhe, der Sprung ist ein antd-Knopf mit href.
    expect(sprung).toHaveClass('ant-btn');
    const menue = await oeffneMenue();
    await userEvent.click(within(menue).getByText('Ausgabe nachtragen'));
    expect(props.onAusgabeNachtragen).toHaveBeenCalledWith(zf);
  });

  it('anstehend: der Sprung steht auch vor Beginn', () => {
    zeige(zeitfenster(), { jetzt: VORHER });
    expect(screen.getByRole('link', { name: `Ausgabe öffnen zu ${kennung}` })).toBeInTheDocument();
  });

  it('vergangen: kein Sprung, nur „Ausgabe nachtragen"', async () => {
    const zf = zeitfenster({
      ausgegeben: { gesamt: 250, sonderkost: { ...KEINE_SONDERKOST, vegan: 3 } },
      fehlmenge: { gesamt: 0, sonderkost: KEINE_SONDERKOST },
    });
    const { props } = zeige(zf, { jetzt: VORBEI, onBedarfSpeichern: undefined });
    expect(screen.queryByRole('link', { name: /^Ausgabe öffnen/ })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: `Ausgabe nachtragen zu ${kennung}` }));
    expect(props.onAusgabeNachtragen).toHaveBeenCalledWith(zf);
  });

  it('Stab mit drei Aktionen: alle im Menü, daneben nur der Sprung; Nachfordern meldet sich', async () => {
    const zf = zeitfenster();
    const { props, karte } = zeige(zf);
    const zeile = karte.querySelector<HTMLElement>('[data-lfh="verpflegung-aktionen"]')!;
    // Neben dem Menü steht nur der Sprung, kein Knopf „Ausgabe nachtragen".
    expect(within(zeile).queryByRole('button', { name: /^Ausgabe nachtragen/ })).toBeNull();
    expect(within(zeile).getAllByRole('button')).toHaveLength(1);
    expect(within(zeile).getAllByRole('link')).toHaveLength(1);
    const menue = await oeffneMenue();
    expect(within(menue).getByText('Ausgabe nachtragen')).toBeInTheDocument();
    expect(within(menue).getByText('Bedarf bearbeiten')).toBeInTheDocument();
    // Löschen nur ohne gültige Ausgabe — hier gibt es eine.
    expect(within(menue).queryByText('Löschen')).toBeNull();
    await userEvent.click(within(menue).getByText('Nachfordern'));
    expect(props.onNachfordern).toHaveBeenCalledWith(zf);
  });

  it('Stab mit vier Aktionen: alle vier im Menü', async () => {
    zeige(
      zeitfenster({
        ausgaben: [ausgabe({ id: 11, zurueckgenommen_at: '2026-09-24 09:50:00' })],
      }),
    );
    expect(screen.queryByRole('button', { name: /^Ausgabe nachtragen/ })).toBeNull();
    const menue = await oeffneMenue();
    expect(
      [...menue.querySelectorAll('[role="menuitem"]')].map((e) => e.textContent?.trim()),
    ).toEqual(['Ausgabe nachtragen', 'Bedarf bearbeiten', 'Nachfordern', 'Löschen']);
  });

  it('Gerät mit zwei Aktionen: Sprung auf den Gerätepfad, beide Aktionen als Knöpfe, kein Menü', () => {
    zeige(
      zeitfenster(),
      {
        nachforderungenFrei: false,
        nachschub: 'melden',
        onBedarfSpeichern: undefined,
        onLoeschen: undefined,
      },
      true,
    );
    expect(screen.getByRole('link', { name: `Ausgabe öffnen zu ${kennung}` })).toHaveAttribute(
      'href',
      '/geraet/1/verpflegung/1/ausgabe',
    );
    expect(
      screen.getByRole('button', { name: `Ausgabe nachtragen zu ${kennung}` }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: `Fehlmenge melden zu ${kennung}` }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Aktionen zu/ })).toBeNull();
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
      screen.getByRole('button', { name: `Ausgabe nachtragen zu ${kennung}` }),
    ).toBeInTheDocument();
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

  it('Fehlmenge nur in einer Kostform bietet Nachfordern an (Spec: Fehlmenge je Kostform)', async () => {
    const zf = zeitfenster({
      ausgegeben: { gesamt: 250, sonderkost: KEINE_SONDERKOST },
      fehlmenge: { gesamt: 0, sonderkost: { ...KEINE_SONDERKOST, vegan: 3 } },
    });
    const { props } = zeige(zf);
    const menue = await oeffneMenue();
    await userEvent.click(within(menue).getByText('Nachfordern'));
    expect(props.onNachfordern).toHaveBeenCalledWith(zf);
  });

  it('Verpflegungsgerät: „Fehlmenge melden" ohne Modul Nachforderungen, ohne Planen (LFH-1044)', async () => {
    const zf = zeitfenster();
    const onNachfordern = vi.fn();
    zeige(zf, {
      nachforderungenFrei: false,
      nachschub: 'melden',
      onBedarfSpeichern: undefined,
      onLoeschen: undefined,
      onNachfordern,
    });
    expect(screen.queryByText('Nachfordern')).toBeNull();
    expect(screen.queryByRole('button', { name: /^Bedarf bearbeiten/ })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: `Fehlmenge melden zu ${kennung}` }));
    expect(onNachfordern).toHaveBeenCalledWith(zf);
  });

  it('Verpflegungsgerät: gedeckt, nichts zu melden', () => {
    zeige(
      zeitfenster({
        ausgegeben: { gesamt: 250, sonderkost: KEINE_SONDERKOST },
        fehlmenge: { gesamt: 0, sonderkost: KEINE_SONDERKOST },
      }),
      {
        nachforderungenFrei: false,
        nachschub: 'melden',
        onBedarfSpeichern: undefined,
        onLoeschen: undefined,
      },
    );
    expect(screen.queryByRole('button', { name: /Fehlmenge melden/ })).toBeNull();
  });
});

describe('ZeitfensterKarte — Stellen (LLH-1040, D13 Punkt 4)', () => {
  const v = verpflegungMitStellen();
  const mittagMitStellen = v.zeitfenster[0];
  const jeStelle = (karte: HTMLElement) =>
    karte.querySelector<HTMLElement>('[data-lfh="verpflegung-je-stelle"]');
  const zeilen = (karte: HTMLElement) =>
    [...(jeStelle(karte)?.querySelectorAll<HTMLElement>('li') ?? [])].map((li) =>
      li.querySelector('[data-lfh="je-stelle-text"]')!.textContent!.trim(),
    );

  it('Fixture 200/100/80: Ist je Stelle unter „ausgegeben“, Marke der Art', () => {
    const { karte } = zeige(mittagMitStellen, { stellen: v.stellen });
    expect(zeilen(karte)).toEqual([
      'Ausgabe Turnhalle Nord · 80 EP',
      'Feldküche BR Sportplatz · 100 EP',
    ]);
    expect(within(karte).getByText('warm')).toHaveAttribute('data-lfh', 'verpflegungsart');
    // Kein Soll je Stelle: das Gesamt-„fehlt“ bleibt die einzige Fehlmenge.
    expect(within(fehltWert(karte)).getByText('20')).toBeInTheDocument();
  });

  it('Bestand ohne Stelle rendert wie vorher: keine Aufstellung, keine Marke', () => {
    const { karte } = zeige(zeitfenster(), { stellen: v.stellen });
    expect(jeStelle(karte)).toBeNull();
    expect(karte.querySelector('[data-lfh="verpflegungsart"]')).toBeNull();
    expect(screen.queryByRole('link', { name: /^Ausgabe öffnen an/ })).toBeNull();
  });

  it('kennzeichnet aufgelöste und nicht zugeordnete Stellen, „ohne Stelle“ zuletzt', () => {
    const stellen = [
      stelle({ id: FELDKUECHE, bezeichnung: 'Feldküche', status: 'aufgeloest' }),
      stelle({ id: DEICH, bezeichnung: 'Zuführung Deich', art: 'zufuehrung' }),
    ];
    const zf = zeitfenster({
      stelle_ids: [FELDKUECHE],
      je_stelle: [
        { stelle_id: null, ausgegeben: { gesamt: 30, sonderkost: KEINE_SONDERKOST } },
        { stelle_id: FELDKUECHE, ausgegeben: { gesamt: 100, sonderkost: KEINE_SONDERKOST } },
        { stelle_id: DEICH, ausgegeben: { gesamt: 20, sonderkost: KEINE_SONDERKOST } },
      ],
    });
    const { karte } = zeige(zf, { stellen });
    expect(zeilen(karte)).toEqual([
      'Feldküche · aufgelöst · 100 EP',
      'Zuführung Deich · nicht zugeordnet · 20 EP',
      'ohne Stelle · 30 EP',
    ]);
    // Sprung nur zu einer Stelle, an der noch gebucht werden kann.
    expect(screen.getAllByRole('link', { name: /^Ausgabe öffnen an/ })).toHaveLength(1);
    expect(
      screen.getByRole('link', { name: `Ausgabe öffnen an Zuführung Deich zu ${kennung}` }),
    ).toHaveAttribute('href', `/einsaetze/1/verpflegung/1/ausgabe?stelle=${DEICH}`);
  });

  it('Sprung je Stelle mit `?stelle=`, am Gerät auf dem Gerätepfad', () => {
    zeige(mittagMitStellen, { stellen: v.stellen }, true);
    expect(
      screen.getByRole('link', {
        name: `Ausgabe öffnen an Feldküche BR Sportplatz zu ${zeitfensterKennung(mittagMitStellen)}`,
      }),
    ).toHaveAttribute('href', `/geraet/1/verpflegung/1/ausgabe?stelle=${FELDKUECHE}`);
  });

  it('kein Sprung je Stelle ohne Schreibrecht, nach dem Ende und bei 390 px; die Zeilen bleiben', () => {
    const { karte } = zeige(mittagMitStellen, { stellen: v.stellen, darfSchreiben: false });
    expect(zeilen(karte)).toHaveLength(2);
    expect(screen.queryByRole('link', { name: /^Ausgabe öffnen an/ })).toBeNull();
  });

  it('nach dem Ende kein Sprung je Stelle', () => {
    zeige(mittagMitStellen, { stellen: v.stellen, jetzt: VORBEI });
    expect(screen.queryByRole('link', { name: /^Ausgabe öffnen an/ })).toBeNull();
  });

  it('bei 390 px nur die Zeilen', () => {
    setzeViewportBreite(390);
    const { karte } = zeige(mittagMitStellen, { stellen: v.stellen });
    expect(zeilen(karte)).toHaveLength(2);
    expect(screen.queryByRole('link', { name: /^Ausgabe öffnen an/ })).toBeNull();
  });

  it('eine Ausgabe an einer Stelle nennt die Stelle statt des Orts', () => {
    const zf = zeitfenster({
      ausgaben: [
        ausgabe({ id: 11, menge: 100, verpflegungsstelle_id: TURNHALLE, ort: null }),
        ausgabe({ id: 12, menge: 30, ort: 'Deich km 3' }),
      ],
    });
    const { karte } = zeige(zf, { stellen: v.stellen });
    const eintraege = karte.querySelectorAll<HTMLElement>('[data-lfh="verpflegung-ausgabe"]');
    expect(eintraege[0].textContent).toContain('100 EP · Ausgabe Turnhalle Nord');
    expect(eintraege[1].textContent).toContain('30 EP · Deich km 3');
  });

  it('eine ausstehende Ausgabe nennt ihre Stelle', () => {
    const { karte } = zeige(zeitfenster(), {
      stellen: v.stellen,
      ausstehend: [
        {
          id: 2,
          benutzer_id: 11,
          einsatz_id: 1,
          erstellt_at: '2026-09-24T09:40:00.000Z',
          aktion: {
            art: 'ausgabe',
            zeitfenster_id: 1,
            bezeichnung: 'Mittag',
            daten: { menge: 15, verpflegungsstelle_id: FELDKUECHE, client_id: 'a-3' },
          },
        },
      ],
    });
    const zeile = karte.querySelector<HTMLElement>('[data-lfh="verpflegung-ausgabe-ausstehend"]')!;
    expect(zeile.textContent).toContain('15 EP · Feldküche BR Sportplatz');
  });
});

describe('ZeitfensterKarte — Empfänger (LLH-1055 Teil II)', () => {
  const mitEmpfaengern = () =>
    zeitfenster({
      ausgaben: [
        ausgabe({ id: 11, menge: 9, ort: null, einheit_id: GRUPPE_1 }),
        ausgabe({ id: 12, menge: 40, ort: null, abschnitt_id: ABSCHNITT_DEICH }),
      ],
    });

  it('jede Ausgabe nennt ihren Empfänger', () => {
    const { karte } = zeige(mitEmpfaengern(), { empfaenger: empfaenger() });
    const zeilen = [...karte.querySelectorAll<HTMLElement>('[data-lfh="verpflegung-ausgabe"]')].map(
      (z) => z.textContent,
    );
    expect(zeilen[0]).toContain('9 EP · an 1. Gruppe');
    expect(zeilen[1]).toContain('40 EP · Zuführung Deich');
  });

  it('eine vorgemerkte Ausgabe nennt ihren Empfänger', () => {
    const { karte } = zeige(zeitfenster({ ausgaben: [] }), {
      empfaenger: empfaenger(),
      ausstehend: [
        {
          id: 1,
          benutzer_id: 11,
          einsatz_id: 1,
          erstellt_at: '2026-09-24T09:40:00.000Z',
          aktion: {
            art: 'ausgabe',
            zeitfenster_id: 1,
            bezeichnung: 'Mittag',
            daten: {
              menge: 9,
              einheit_id: GRUPPE_2,
              client_id: 'a',
              zeitpunkt_at: '2026-09-24 09:40:00',
            },
          },
        },
      ],
    });
    expect(karte.querySelector('[data-lfh="verpflegung-ausgabe-ausstehend"]')).toHaveTextContent(
      '9 EP · an 2. Gruppe',
    );
  });

  it('Klappe „Einheiten“ nennt die Zahlen; aufgeklappt „Noch nicht verpflegt“ und „Verpflegt“', async () => {
    const { karte } = zeige(mitEmpfaengern(), { empfaenger: empfaenger() });
    const klappe = within(karte).getByRole('button', {
      name: 'Einheiten · 2 noch nicht verpflegt · 1 ohne Eintreffen · 1 verpflegt',
    });
    expect(karte.querySelector('[data-lfh="verpflegung-stand"]')).toBeNull();
    await userEvent.click(klappe);
    const stand = await waitFor(() => {
      const el = karte.querySelector<HTMLElement>('[data-lfh="verpflegung-stand"]');
      expect(el).not.toBeNull();
      return el!;
    });
    // Sichtbarkeit misst jsdom in der Klappanimation nicht; die Rolle genügt.
    expect(
      within(stand).getByRole('heading', { name: 'Noch nicht verpflegt · 2', hidden: true }),
    ).toBeInTheDocument();
    // An der Karte wählt niemand einen Empfänger: keine Knöpfe.
    expect(within(stand).queryAllByRole('button')).toEqual([]);
  });

  it('ohne Einheiten im Einsatz keine Klappe', () => {
    const { karte } = zeige(mitEmpfaengern(), { empfaenger: { einheiten: [], abschnitte: [] } });
    expect(within(karte).queryByRole('button', { name: /^Einheiten/ })).toBeNull();
  });
});
