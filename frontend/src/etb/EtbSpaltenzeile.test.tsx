import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConfigProvider } from 'antd';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ComponentProps, ReactElement } from 'react';
import type { EtbEintragAnzeige } from '../api/types';
import type { AbgelehnterEintrag, AusstehenderEintrag } from '../offline/queue';
import { renderMitProviders } from '../test/utils';
import { setzeViewportBreite } from '../test/viewport';
import { baueZeilen, type EtbZeile } from './etbZeile';
import EtbZeitachse from './EtbZeitachse';
import { passendeVermerke } from './EtbVermerke';
import { ETB_SPALTEN_RASTER } from './etbSpalten';

/**
 * Leseansicht des ETB (Change `kwc2yszv-etb-neuentwurf`, Spec `etb-zeitachse-darstellung`):
 * Spaltenzeile in kompakter Dichte ab `lg`, Vermerkspalte, „Vermerk <Stelle>“, eingeklappte lange
 * Einträge und die Handschirm-Zeile unter `md`. Höhe und Breite misst der Browser
 * (`e2e/etb-zeilenhoehe.spec.ts`, `e2e/etb-chronologie.spec.ts`); hier steht der Aufbau.
 */

type ZeitachsenProps = ComponentProps<typeof EtbZeitachse>;

function renderZeitachse(
  props: Omit<Partial<ZeitachsenProps>, 'zeilen'> & {
    eintraege?: EtbEintragAnzeige[];
    zeilen?: readonly EtbZeile[];
    hoehe?: number;
  },
) {
  const { eintraege, zeilen, hoehe, ...rest } = props;
  let ui: ReactElement = (
    <EtbZeitachse
      einsatzId={1}
      zeilen={zeilen ?? baueZeilen({ eintraege: eintraege ?? [], ausstehend: [], abgelehnt: [] })}
      {...rest}
    />
  );
  // Dichte über die Bedienhöhe, wie `zeitachsenAufbau` sie liest (48 = komfortabel).
  if (hoehe != null)
    ui = <ConfigProvider theme={{ token: { controlHeight: hoehe } }}>{ui}</ConfigProvider>;
  return renderMitProviders(ui);
}

function eintrag(over: Partial<EtbEintragAnzeige> = {}): EtbEintragAnzeige {
  return {
    id: 1,
    lfd_nr: 1,
    typ: 'meldung',
    inhalt: 'Einsatzleitwagen am Marktplatz',
    von: 'Sanitätszug Musterstadt',
    an: 'EL',
    meldeweg: 'funk',
    veranlassung: null,
    erfasser_id: 1,
    erfasser_name: 'Max',
    erfasser_funktion: 'S2',
    ereigniszeit: '2026-05-23 10:00:00',
    received_at: '2026-05-23 10:00:02',
    erfasst_lokal_at: null,
    berichtigt_eintrag_id: null,
    lagebericht_id: null,
    auftrag_id: null,
    befehl_id: null,
    folgeauftraege: [],
    berichtigt_durch: [],
    einheiten: [],
    anhaenge: [],
    ...over,
  };
}

function ausstehend(over: Partial<AusstehenderEintrag> = {}): AusstehenderEintrag {
  return {
    id: 1,
    benutzer_id: 1,
    einsatz_id: 1,
    eintrag: { typ: 'meldung', inhalt: 'Noch nicht gesendet', von: 'ELW', an: 'EL' },
    erstellt_at: '2026-05-23 10:05:00',
    ...over,
  };
}

function abgelehnt(over: Partial<AbgelehnterEintrag> = {}): AbgelehnterEintrag {
  return {
    ...ausstehend(),
    grund: 'Einsatz abgeschlossen',
    abgelehnt_at: '2026-05-23 10:06:00',
    ...over,
  };
}

function zeileVon(container: HTMLElement, schluessel: string): HTMLElement {
  const z = container.querySelector<HTMLElement>(`[data-zeile="${schluessel}"]`);
  if (!z) throw new Error(`Zeile ${schluessel} fehlt`);
  return z;
}

/** Die Rasterzellen einer Spaltenzeile ohne die Typkante, in Spaltenfolge. */
function zellen(z: HTMLElement): HTMLElement[] {
  return [...z.children].filter((k) => k.getAttribute('data-lfh') !== 'typkante') as HTMLElement[];
}

async function oeffneMenue(nr: number): Promise<HTMLElement> {
  await userEvent.click(screen.getByRole('button', { name: `Aktionen zu Eintrag ${nr}` }));
  return waitFor(() => {
    const m = document.querySelector<HTMLElement>(
      '.ant-dropdown:not(.ant-dropdown-hidden) [role="menu"]',
    );
    if (!m) throw new Error('Menü nicht offen');
    return m;
  });
}

const punkte = (menue: HTMLElement) =>
  within(menue)
    .getAllByRole('menuitem')
    .map((m) => m.textContent);

/** Breite der Fläche — 1440 px ist der Fükw, Vorgabe `kompakt` (antd: Bedienhöhe 32). */
beforeEach(() => setzeViewportBreite(1440));

describe('Spaltenzeile in kompakter Dichte', () => {
  it('Einzeiliger Eintrag im Fükw: feste Spalten, Von → An in 13 px Textschrift, nichts unter 12 px', () => {
    const { container } = renderZeitachse({ eintraege: [eintrag()] });
    const z = zeileVon(container, 'eintrag-1');
    expect(z).toHaveAttribute('data-lfh-form', 'spalten');
    expect(z.style.gridTemplateColumns).toBe(ETB_SPALTEN_RASTER);
    const [zeit, nr, typ, vonAn, inhalt, vermerk, menue] = zellen(z);
    expect(zeit).toHaveAttribute('data-lfh', 'zeitachse-zeit');
    expect(nr).toHaveTextContent('Nr. 1');
    expect(typ).toHaveTextContent('Meldung');
    expect(vonAn).toHaveTextContent('Sanitätszug Musterstadt → EL · Funk');
    expect(vonAn.style.fontSize).toBe('13px');
    // Textschrift, nicht Mono: keine Schriftfamilie der Zahlen an der Zelle.
    expect(vonAn.style.fontFamily).toBe('');
    expect(inhalt).toHaveTextContent('Einsatzleitwagen am Marktplatz');
    expect(vermerk).toHaveAttribute('data-lfh', 'etb-vermerk');
    expect(within(menue).getByRole('button', { name: 'Aktionen zu Eintrag 1' })).toBeVisible();
    // Kein Text der Zeile unter 12 px.
    for (const el of [z, ...z.querySelectorAll<HTMLElement>('*')]) {
      const groesse = Number.parseFloat(el.style.fontSize);
      if (Number.isFinite(groesse))
        expect(groesse, el.outerHTML.slice(0, 80)).toBeGreaterThanOrEqual(12);
    }
  });

  it('Spalten fluchten: Kopf und Zeilen teilen Spuren und Einzug, der Inhalt ist die fünfte Spalte', () => {
    const { container } = renderZeitachse({
      eintraege: [
        eintrag({ id: 2, lfd_nr: 2, von: 'Leitstelle Musterstadt-Nord' }),
        eintrag({ id: 1, lfd_nr: 1, von: 'ELW' }),
      ],
    });
    const kopf = container.querySelector<HTMLElement>('[data-lfh="etb-spaltenkopf"]')!;
    expect(kopf).not.toBeNull();
    expect([...kopf.children].map((k) => k.textContent)).toEqual([
      'Zeit',
      'Nr.',
      'Typ',
      'Von → An',
      'Inhalt',
      'Vermerk',
      '',
    ]);
    for (const s of ['eintrag-1', 'eintrag-2']) {
      const z = zeileVon(container, s);
      expect(z.style.gridTemplateColumns).toBe(kopf.style.gridTemplateColumns);
      expect(z.style.columnGap).toBe(kopf.style.columnGap);
      expect(z.style.paddingInlineStart).toBe(kopf.style.paddingInlineStart);
      expect(zellen(z)[4]).toHaveAttribute('data-lfh', 'etb-inhalt');
    }
  });

  it('der Spaltenkopf klebt unter dem Kopf der Seite, sonst unter dem Rahmen', () => {
    const { container } = renderZeitachse({ eintraege: [eintrag()] });
    const kopf = container.querySelector<HTMLElement>('[data-lfh="etb-spaltenkopf"]')!;
    expect(kopf.style.position).toBe('sticky');
    expect(kopf.style.top).toBe('var(--etb-kopf-unterkante, var(--lfh-rahmen-oben, 0px))');
  });

  it('Langer Absender: Auslassung, voller Text im Titel', () => {
    const { container } = renderZeitachse({
      eintraege: [eintrag({ von: 'Sanitätszug Musterstadt-Nord, 2. Bereitschaft' })],
    });
    const vonAn = zellen(zeileVon(container, 'eintrag-1'))[3];
    expect(vonAn).toHaveAttribute(
      'title',
      'Sanitätszug Musterstadt-Nord, 2. Bereitschaft → EL · Funk',
    );
    expect(vonAn.style.whiteSpace).toBe('nowrap');
    expect(vonAn.style.textOverflow).toBe('ellipsis');
    expect(vonAn.style.overflow).toBe('hidden');
  });

  it('Langer Verfasser: im Titel der Zeile und im Zeilenmenü, keine eigene Spalte', async () => {
    const { container } = renderZeitachse({
      eintraege: [
        eintrag({ erfasser_name: 'Maximiliane Musterfrau-Langenberg', erfasser_funktion: 'S2' }),
      ],
      onBerichtigen: vi.fn(),
    });
    const z = zeileVon(container, 'eintrag-1');
    expect(z).toHaveAttribute('title', 'Verfasser: Maximiliane Musterfrau-Langenberg ·\u00A0S2');
    expect(z.querySelector('[data-lfh="verfasser"]')).toBeNull();
    expect(zellen(z)).toHaveLength(7);
    const menue = await oeffneMenue(1);
    expect(punkte(menue)).toEqual([
      'Berichtigen',
      'Verfasser: Maximiliane Musterfrau-Langenberg ·\u00A0S2',
    ]);
    // Eine Angabe, keine Handlung.
    expect(within(menue).getByRole('menuitem', { name: /^Verfasser/ })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
  });

  it('Bedienbarer Verfasser: auch Lesende haben das ⋮ mit dem Verfasser, das Browsermenü bleibt', async () => {
    const { container } = renderZeitachse({ eintraege: [eintrag()] });
    const z = zeileVon(container, 'eintrag-1');
    // Ohne Handlung kein Kontextmenü (Browsermenü, LLH-1597).
    expect(fireEvent.contextMenu(z, { button: 2 })).toBe(true);
    expect(punkte(await oeffneMenue(1))).toEqual(['Verfasser: Max ·\u00A0S2']);
  });

  it('Rechtsklick zeigt dieselbe Liste wie das ⋮, mit Vermerken und Verfasser', async () => {
    const onBerichtigen = vi.fn();
    const { container } = renderZeitachse({
      eintraege: [eintrag({ id: 4, lfd_nr: 12, meldung_id: 9, meldung_lfd_nr: 5 })],
      onBerichtigen,
    });
    const z = zeileVon(container, 'eintrag-4');
    expect(
      fireEvent.contextMenu(within(z).getByText('Einsatzleitwagen am Marktplatz'), { button: 2 }),
    ).toBe(false);
    const kontext = await waitFor(() => {
      const m = document.querySelector<HTMLElement>(
        '.ant-dropdown:not(.ant-dropdown-hidden) [role="menu"][aria-label="Aktionen zu Eintrag 12"]',
      );
      if (!m) throw new Error('Kontextmenü nicht offen');
      return m;
    });
    expect(punkte(kontext)).toEqual([
      'Berichtigen',
      'Meldung #5 öffnen',
      'Verfasser: Max ·\u00A0S2',
    ]);
    await userEvent.click(within(kontext).getByRole('menuitem', { name: 'Berichtigen' }));
    expect(onBerichtigen).toHaveBeenCalledTimes(1);
  });

  it('komfortabel und Handschuh behalten den Zeitachseneintrag, ohne Spaltenkopf', () => {
    const { container } = renderZeitachse({ eintraege: [eintrag()], hoehe: 48 });
    const z = zeileVon(container, 'eintrag-1');
    expect(z).not.toHaveAttribute('data-lfh-form');
    expect(z.querySelector('[data-lfh="verfasser"]')).toHaveTextContent('Max · S2');
    expect(container.querySelector('[data-lfh="etb-spaltenkopf"]')).toBeNull();
  });

  it('kompakt unter `lg` behält den Zeitachseneintrag', () => {
    setzeViewportBreite(900);
    const { container } = renderZeitachse({ eintraege: [eintrag()] });
    expect(zeileVon(container, 'eintrag-1')).not.toHaveAttribute('data-lfh-form');
    expect(container.querySelector('[data-lfh="etb-spaltenkopf"]')).toBeNull();
  });

  it('eine Bündelzeile fluchtet mit den Spalten', () => {
    const sys = (id: number) =>
      eintrag({
        id,
        lfd_nr: id,
        typ: 'system',
        von: 'System',
        an: 'System',
        inhalt: `Status ${id}`,
      });
    const { container } = renderZeitachse({ eintraege: [sys(3), sys(2), sys(1)] });
    const b = container.querySelector<HTMLElement>('[data-testid="etb-buendelzeile"]')!;
    expect(b).toHaveAttribute('data-lfh-form', 'spalten');
    expect(b.style.gridTemplateColumns).toBe(ETB_SPALTEN_RASTER);
    expect(within(b).getByRole('button', { name: /^3 Systemeinträge/ })).toBeInTheDocument();
  });
});

describe('Vermerke in eigener Spalte', () => {
  it('Meldung mit Verweis: „Meldung #5 ↗“ in der Spalte Vermerk derselben Zeile, keine Zeile darunter', () => {
    const { container } = renderZeitachse({
      eintraege: [eintrag({ meldung_id: 9, meldung_lfd_nr: 5 })],
    });
    const z = zeileVon(container, 'eintrag-1');
    const spalte = z.querySelector<HTMLElement>('[data-lfh="etb-vermerk"]')!;
    expect(within(spalte).getByRole('link', { name: 'Meldung #5' })).toHaveAttribute(
      'href',
      '/einsaetze/1/meldungen?meldung=9',
    );
    expect(z.querySelector('[data-lfh="etb-unterzeile"]')).toBeNull();
  });

  it('Berichtigt: Nr. 230 durchgestrichen mit „berichtigt durch Nr. 231“, Nr. 231 nennt „berichtigt Nr. 230“', () => {
    const grund = eintrag({
      id: 230,
      lfd_nr: 230,
      inhalt: 'RTW 83-2 wieder einsatzbereit',
      berichtigt_durch: [{ id: 231, lfd_nr: 231 }],
    });
    const korrektur = eintrag({
      id: 231,
      lfd_nr: 231,
      typ: 'berichtigung',
      berichtigt_eintrag_id: 230,
      inhalt: 'Zu Nr. 230: RTW 83-1',
    });
    const { container } = renderZeitachse({ eintraege: [korrektur, grund] });
    const alt = zeileVon(container, 'eintrag-230');
    expect(
      within(alt).getByText('RTW 83-2 wieder einsatzbereit').closest('.etb-inhalt--berichtigt'),
    ).not.toBeNull();
    expect(
      within(alt.querySelector<HTMLElement>('[data-lfh="etb-vermerk"]')!).getByRole('link', {
        name: 'berichtigt durch Nr. 231',
      }),
    ).toHaveAttribute('href', '/einsaetze/1/etb?eintrag=231');
    const neu = zeileVon(container, 'eintrag-231');
    expect(neu.querySelector('.etb-inhalt--berichtigt')).toBeNull();
    expect(within(neu).getByRole('link', { name: 'berichtigt Nr. 230' })).toHaveAttribute(
      'href',
      '/einsaetze/1/etb?eintrag=230',
    );
  });

  it('Nachtrag: „Nachtrag · erfasst HHMM“ steht als Vermerk', () => {
    const { container } = renderZeitachse({
      eintraege: [
        eintrag({ ereigniszeit: '2026-05-23 09:00:00', received_at: '2026-05-23 10:00:00' }),
      ],
    });
    expect(
      zeileVon(container, 'eintrag-1').querySelector('[data-lfh="etb-vermerk"]'),
    ).toHaveTextContent(/Nachtrag · erfasst \d{4}/);
  });

  it('Anhang: der Verweis lädt über die ETB-Route, mit Nummer im Namen', () => {
    const { container } = renderZeitachse({
      eintraege: [
        eintrag({
          id: 3,
          lfd_nr: 7,
          anhaenge: [
            { id: 11, dateiname: 'Lagefoto.jpg', mime: 'image/jpeg', groesse: 2048 },
          ] as EtbEintragAnzeige['anhaenge'],
        }),
      ],
    });
    const spalte = zeileVon(container, 'eintrag-3').querySelector<HTMLElement>(
      '[data-lfh="etb-vermerk"]',
    )!;
    expect(
      within(spalte).getByRole('link', {
        name: /^Lagefoto\.jpg, .+, Anhang zu Nr\. 7 herunterladen$/,
      }),
    ).toHaveAttribute('href', '/api/einsaetze/1/etb/3/anhaenge/11');
  });

  describe('Überlauf', () => {
    // Auf `HTMLElement.prototype` überdeckt, nach dem Fall wieder entfernt: die echten Werte
    // stehen auf `Element.prototype`.
    beforeEach(() => {
      // Die Spalte ist 100 px breit, jeder Vermerk 60 px: einer passt, zwei nicht.
      Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
        configurable: true,
        get(this: HTMLElement) {
          return this.classList.contains('etb-vermerk-spalte') ? 100 : 0;
        },
      });
      Object.defineProperty(HTMLElement.prototype, 'scrollWidth', {
        configurable: true,
        get(this: HTMLElement) {
          return this.hasAttribute('data-vermerk') ? 60 : 0;
        },
      });
    });
    afterEach(() => {
      delete (HTMLElement.prototype as { clientWidth?: number }).clientWidth;
      delete (HTMLElement.prototype as { scrollWidth?: number }).scrollWidth;
    });

    it('endet mit „+n“, nennt alle im Titel und im Zeilenmenü, „+n“ klappt sie unter dem Text auf', async () => {
      const { container } = renderZeitachse({
        eintraege: [eintrag({ meldung_id: 9, meldung_lfd_nr: 5, befehl_id: 2, lagebericht_id: 3 })],
      });
      const z = zeileVon(container, 'eintrag-1');
      const spalte = z.querySelector<HTMLElement>('[data-lfh="etb-vermerk"]')!;
      const plus = await within(spalte).findByRole('button', { name: '2 weitere Vermerke zeigen' });
      expect(plus).toHaveTextContent('+2');
      expect(spalte).toHaveAttribute('title', 'Befehl · Lagebericht · Meldung #5');
      // Sichtbar und bedienbar ist nur der erste; die übrigen sind verborgen, nicht entfernt.
      expect(within(spalte).getAllByRole('link')).toHaveLength(1);
      expect(punkte(await oeffneMenue(1))).toEqual([
        'Befehl öffnen',
        'Lagebericht öffnen',
        'Meldung #5 öffnen',
        'Verfasser: Max ·\u00A0S2',
      ]);
      await userEvent.keyboard('{Escape}');
      await userEvent.click(plus);
      const unter = z.querySelector<HTMLElement>('[data-lfh="etb-unterzeile"]')!;
      expect(
        within(unter)
          .getAllByRole('link')
          .map((l) => l.textContent),
      ).toEqual(['Befehl\u00A0↗', 'Lagebericht\u00A0↗', 'Meldung #5\u00A0↗']);
      expect(within(spalte).getByRole('button', { name: 'Vermerke zuklappen' })).toHaveAttribute(
        'aria-expanded',
        'true',
      );
    });
  });

  it('passendeVermerke: so viele, wie samt „+n“ passen, mindestens einer', () => {
    expect(passendeVermerke([60, 60, 60], 0)).toBe(3);
    expect(passendeVermerke([60, 60, 60], 100)).toBe(1);
    expect(passendeVermerke([40, 40], 100)).toBe(2);
    expect(passendeVermerke([40, 40, 40], 130)).toBe(2);
    expect(passendeVermerke([300], 100)).toBe(1);
  });
});

describe('Eigener Vermerk statt Von → An', () => {
  it('Entscheidung der Einsatzleitung: „Vermerk EL“ in der Spaltenzeile', () => {
    const { container } = renderZeitachse({
      eintraege: [eintrag({ typ: 'entscheidung', von: 'EL', an: 'EL', meldeweg: null })],
    });
    expect(zellen(zeileVon(container, 'eintrag-1'))[3]).toHaveTextContent(/^Vermerk EL$/);
  });

  it('auch im Zeitachseneintrag und auf dem Handschirm', () => {
    for (const breite of [900, 390]) {
      setzeViewportBreite(breite);
      const { container, unmount } = renderZeitachse({
        eintraege: [eintrag({ typ: 'lage', von: 'EL', an: 'EL', meldeweg: null })],
      });
      const z = zeileVon(container, 'eintrag-1');
      expect(z, `${breite}`).toHaveTextContent('Vermerk EL');
      expect(z, `${breite}`).not.toHaveTextContent('EL → EL');
      unmount();
    }
  });
});

describe('Lange Einträge eingeklappt', () => {
  const LAGEBERICHT = Array.from(
    { length: 8 },
    (_, i) => `## Abschnitt ${i + 1}\n\nLage ruhig.`,
  ).join('\n\n');
  beforeEach(() => {
    // Der Lagebericht belegt 16 Zeilen à 20 px, alles andere eine.
    Object.defineProperty(HTMLElement.prototype, 'scrollHeight', {
      configurable: true,
      get(this: HTMLElement) {
        if (this.getAttribute('data-lfh') !== 'etb-inhalt') return 0;
        return this.textContent?.includes('Abschnitt 8') ? 320 : 20;
      },
    });
  });
  afterEach(() => {
    delete (HTMLElement.prototype as { scrollHeight?: number }).scrollHeight;
  });

  it('Lagebericht im Strom: höchstens drei Zeilen mit „mehr“, „mehr“ zeigt ihn ganz, „weniger“ klappt zu', async () => {
    const { container } = renderZeitachse({
      eintraege: [
        eintrag({ id: 2, lfd_nr: 2, typ: 'lage', inhalt: LAGEBERICHT }),
        eintrag({ id: 1, lfd_nr: 1 }),
      ],
    });
    const lang = zeileVon(container, 'eintrag-2');
    const huelle = lang.querySelector<HTMLElement>('[data-lfh="etb-inhalt"]')!;
    expect(huelle).toHaveAttribute('data-eingeklappt', 'true');
    expect(huelle).toHaveClass('etb-inhalt--zu');
    // Der ganze Text bleibt im DOM.
    expect(huelle).toHaveTextContent('Abschnitt 8');
    // „mehr“ steht fest in der Spalte Vermerk.
    const mehr = within(lang.querySelector<HTMLElement>('[data-lfh="etb-vermerk"]')!).getByRole(
      'button',
      { name: 'mehr' },
    );
    expect(mehr).toHaveAttribute('aria-expanded', 'false');
    expect(mehr).toHaveAttribute('aria-controls', huelle.id);
    await userEvent.click(mehr);
    expect(huelle).not.toHaveAttribute('data-eingeklappt');
    const weniger = within(lang).getByRole('button', { name: 'weniger' });
    expect(weniger).toHaveAttribute('aria-expanded', 'true');
    await userEvent.click(weniger);
    expect(huelle).toHaveAttribute('data-eingeklappt', 'true');
    // Ein kurzer Eintrag hat keinen Knopf.
    expect(
      within(zeileVon(container, 'eintrag-1')).queryByRole('button', { name: 'mehr' }),
    ).toBeNull();
  });

  it('ein Sprung per `?eintrag=` zeigt ihn aufgeklappt', () => {
    const { container } = renderZeitachse({
      eintraege: [eintrag({ id: 2, lfd_nr: 2, typ: 'lage', inhalt: LAGEBERICHT })],
      highlightId: 2,
    });
    const z = zeileVon(container, 'eintrag-2');
    expect(z.querySelector('[data-lfh="etb-inhalt"]')).not.toHaveAttribute('data-eingeklappt');
    expect(within(z).queryByRole('button', { name: 'mehr' })).toBeNull();
  });

  it('eine Volltextsuche mit Treffer im Inhalt zeigt ihn aufgeklappt', () => {
    const { container } = renderZeitachse({
      eintraege: [eintrag({ id: 2, lfd_nr: 2, typ: 'lage', inhalt: LAGEBERICHT })],
      fundstellen: 'Abschnitt 8',
    });
    expect(
      zeileVon(container, 'eintrag-2').querySelector('[data-lfh="etb-inhalt"]'),
    ).not.toHaveAttribute('data-eingeklappt');
  });

  it('klappt auch im Zeitachseneintrag und auf dem Handschirm ein', () => {
    for (const breite of [900, 390]) {
      setzeViewportBreite(breite);
      const { container, unmount } = renderZeitachse({
        eintraege: [eintrag({ id: 2, lfd_nr: 2, typ: 'lage', inhalt: LAGEBERICHT })],
      });
      const z = zeileVon(container, 'eintrag-2');
      // Im Zeitachseneintrag erbt die Hülle die Zeilenhöhe; jsdom rechnet sie nicht aus.
      if (breite === 390) {
        expect(z.querySelector('[data-lfh="etb-inhalt"]'), `${breite}`).toHaveAttribute(
          'data-eingeklappt',
          'true',
        );
        expect(within(z).getByRole('button', { name: 'mehr' })).toBeInTheDocument();
      } else {
        expect(z.querySelector('[data-lfh="etb-inhalt"]'), `${breite}`).not.toBeNull();
      }
      unmount();
    }
  });

  it('im Druck klappt nichts ein (`@media print`)', () => {
    const css = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), 'etbSpaltenzeile.css'),
      'utf8',
    );
    const druck = css.slice(css.indexOf('@media print'));
    expect(druck).toMatch(/\.etb-inhalt--zu\s*\{[^}]*-webkit-line-clamp:\s*unset/);
    expect(druck).toMatch(/\.etb-inhalt--zu\s*\{[^}]*max-height:\s*none/);
    expect(druck).toMatch(/\.etb-inhalt-umschalter\s*\{[^}]*display:\s*none/);
  });
});

describe('Zeile auf dem Handschirm', () => {
  beforeEach(() => setzeViewportBreite(390));

  it('390 px: Kopfzeile mit Zeit, Typwort und Von → An, darunter der Inhalt in voller Breite, Vermerke darunter', () => {
    const { container } = renderZeitachse({
      eintraege: [eintrag({ meldung_id: 9, meldung_lfd_nr: 5 })],
      onBerichtigen: vi.fn(),
    });
    const z = zeileVon(container, 'eintrag-1');
    expect(z).toHaveAttribute('data-lfh-form', 'handschirm');
    const kopf = z.querySelector<HTMLElement>('[data-lfh="etb-kopfzeile"]')!;
    expect(kopf.querySelector('[data-lfh="zeitachse-zeit"]')).not.toBeNull();
    expect(kopf.querySelector('[data-lfh="typwort"]')).toHaveTextContent('Meldung');
    expect(kopf.querySelector('[data-lfh="etb-vonan"]')).toHaveTextContent(
      'Sanitätszug Musterstadt → EL · Funk',
    );
    // Das ⋮ steht in der Kopfzeile, nicht neben dem Inhalt.
    expect(within(kopf).getByRole('button', { name: 'Aktionen zu Eintrag 1' })).toBeInTheDocument();
    // Der Inhalt ist ein Geschwister der Kopfzeile, ohne Spalte daneben.
    const huelle = z.querySelector<HTMLElement>('[data-lfh="etb-inhalt"]')!;
    expect(kopf.contains(huelle)).toBe(false);
    expect(z.querySelector('[data-lfh="metaspalte"]')).toBeNull();
    expect(z.querySelector('[data-lfh="verfasser"]')).toBeNull();
    expect(z).toHaveAttribute('title', 'Verfasser: Max ·\u00A0S2');
    // Vermerke darunter.
    const vermerke = z.querySelector<HTMLElement>('[data-lfh="etb-vermerke"]')!;
    expect(
      huelle.compareDocumentPosition(vermerke) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(within(vermerke).getByRole('link', { name: 'Meldung #5' })).toBeInTheDocument();
    expect(container.querySelector('[data-lfh="etb-spaltenkopf"]')).toBeNull();
  });

  it('auch komfortabel und im Handschuh-Betrieb', () => {
    const { container } = renderZeitachse({ eintraege: [eintrag()], hoehe: 72 });
    expect(zeileVon(container, 'eintrag-1')).toHaveAttribute('data-lfh-form', 'handschirm');
  });

  it('das Menü öffnet an der Handschirm-Zeile per Rechtsklick (Kontextmenü)', async () => {
    const { container } = renderZeitachse({
      eintraege: [eintrag({ id: 4, lfd_nr: 12 })],
      onWiedervorlage: vi.fn(),
    });
    const z = zeileVon(container, 'eintrag-4');
    expect(fireEvent.contextMenu(z, { button: 2 })).toBe(false);
    const menue = await waitFor(() => {
      const m = document.querySelector<HTMLElement>(
        '.ant-dropdown:not(.ant-dropdown-hidden) [role="menu"][aria-label="Aktionen zu Eintrag 12"]',
      );
      if (!m) throw new Error('nicht offen');
      return m;
    });
    expect(punkte(menue)).toEqual(['Wiedervorlage', 'Verfasser: Max ·\u00A0S2']);
  });
});

describe('gepufferte Zeilen', () => {
  it('Spaltenzeile: vorgemerkt ohne Nummer und ohne Menü, der Zustand steht in der Spalte Vermerk', () => {
    const { container } = renderZeitachse({
      zeilen: baueZeilen({ eintraege: [], ausstehend: [ausstehend()], abgelehnt: [] }),
      onBerichtigen: vi.fn(),
    });
    const z = zeileVon(container, 'ausstehend-1');
    expect(z).toHaveAttribute('data-lfh-form', 'spalten');
    expect(zellen(z)[1]).toHaveTextContent('');
    expect(
      within(z.querySelector<HTMLElement>('[data-lfh="etb-vermerk"]')!).getByText('vorgemerkt'),
    ).toBeInTheDocument();
    expect(within(z).queryByRole('button', { name: /Aktionen/ })).toBeNull();
  });

  it('Spaltenzeile: abgelehnt nennt den Grund und bietet beide Auswege unter dem Inhalt an', async () => {
    const onErneutSenden = vi.fn();
    const { container } = renderZeitachse({
      zeilen: baueZeilen({ eintraege: [], ausstehend: [], abgelehnt: [abgelehnt()] }),
      onErneutSenden,
      onVerwerfen: vi.fn(),
    });
    const z = zeileVon(container, 'abgelehnt-1');
    expect(z).toHaveAttribute('data-toenung', 'problem');
    const unter = z.querySelector<HTMLElement>('[data-lfh="etb-unterzeile"]')!;
    expect(unter).toHaveTextContent('Vom Server abgelehnt: Einsatz abgeschlossen');
    await userEvent.click(within(unter).getByRole('button', { name: 'Erneut senden' }));
    expect(onErneutSenden).toHaveBeenCalledTimes(1);
    expect(within(unter).getByRole('button', { name: 'Verwerfen' })).toBeInTheDocument();
  });

  it('Handschirm: der Zustand steht in der Kopfzeile, die Entscheidung darunter', () => {
    setzeViewportBreite(390);
    const { container } = renderZeitachse({
      zeilen: baueZeilen({ eintraege: [], ausstehend: [], abgelehnt: [abgelehnt()] }),
      onErneutSenden: vi.fn(),
      onVerwerfen: vi.fn(),
    });
    const z = zeileVon(container, 'abgelehnt-1');
    expect(
      within(z.querySelector<HTMLElement>('[data-lfh="etb-kopfzeile"]')!).getByText('abgelehnt'),
    ).toBeInTheDocument();
    expect(within(z).getByRole('button', { name: 'Erneut senden' })).toBeInTheDocument();
  });
});
