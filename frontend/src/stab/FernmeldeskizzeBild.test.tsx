import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../api/client';
import { taktischeDtgVoll } from '../anzeige/format';
import type { SkizzenLage } from '../api/fernmeldeskizzeVertrag';
import {
  abschnitt,
  daten,
  einheit,
  fs,
  quellen,
  sg,
  stelle,
  verbindung,
} from '../test/fernmeldenetz';
import { renderMitProviders } from '../test/utils';
import { setzeViewportBreite, setzeZeigerGrob } from '../test/viewport';
import { baueFernmeldenetz, type Fernmeldenetz, type NetzRechte } from './fernmeldeskizze';
import {
  EINHEIT_BREITE,
  NAME_SCHRIFT,
  RASTER,
  layoutFernmeldenetz,
  schienenLinieY,
} from './fernmeldeskizzeLayout';
import FernmeldeskizzeBild from './FernmeldeskizzeBild';
import type { SkizzenAktionen } from './skizzenAktionen';
import { STRICH_HERVORGEHOBEN, schaetzeTextbreite } from './skizzenZeichen';
import { ZURUECK_DECKKRAFT } from './skizze/SkizzenElemente';

/**
 * Die Zeichenfläche als Ganzes (LFH-893, Spec-Szenarien aus `stab-fernmeldeskizze` und
 * `stab-fernmeldeskizze-bearbeitung`). Die Rechnungen dahinter prüfen die reinen Module in
 * `stab/skizze/*.test.ts`; hier geht es um das Zusammenspiel: Wahl, Tasten, Ziehen, Dialoge,
 * Rechte und Druck, gegen gefälschte `SkizzenAktionen` (die Fläche ruft nie selbst das API).
 */

const BN_BOS = sg(1, 'TMO', 'BN_BOS');
const F314 = sg(2, 'DMO', '314_F*');
const SL_AS = sg(3, 'TMO', 'SL AS');
/** Im Katalog, aber an keiner Stelle: steht nur in der Palette. */
const DMO505 = sg(4, 'DMO', '505');

const ALLE: NetzRechte = { einsatzabschnitte: true, einheiten: true, verwaltung: true, stab: true };

function netz(rechte: NetzRechte = ALLE, p: { ohneZug?: boolean } = {}): Fernmeldenetz {
  return baueFernmeldenetz({
    ...quellen({
      fuehrungsstelle: fs({ sprechgruppen: [BN_BOS] }),
      sprechgruppen: daten([BN_BOS, F314, SL_AS, DMO505]),
      abschnitte: daten([
        abschnitt(1, { name: 'EA 1', sprechgruppen: [BN_BOS] }),
        abschnitt(2, { name: 'EA 2', sprechgruppen: [BN_BOS] }),
      ]),
      einheiten: daten(
        p.ohneZug
          ? []
          : [einheit(10, { name: '1. Zug', abschnitt_id: 1, funkrufname: 'Florian 1/1' })],
      ),
      stellen: daten([
        stelle(5, 'leitstelle', { bezeichnung: 'ILS Musterhausen', kanaele: [[SL_AS, 'geplant']] }),
        stelle(6, 'sonstige', {
          bezeichnung: 'Einheit auf dem Marsch',
          kanaele: [[F314, 'bestehend']],
        }),
      ]),
      skizze: {
        verbindungen: [
          verbindung(
            8,
            { art: 'fuehrungsstelle', id: null },
            { art: 'stelle', id: 5 },
            {
              art: 'daten',
              medium: 'leitung',
              status: 'geplant',
            },
          ),
        ],
      },
    }),
    rechte,
  });
}

function aktionenAttrappe() {
  let version = 0;
  const a = {
    verschiebe: vi.fn(
      async (element: string, lage: { x: number; y: number }): Promise<SkizzenLage> => ({
        element,
        x: lage.x,
        y: lage.y,
        breite: null,
        version: ++version,
      }),
    ),
    entferneLage: vi.fn(async () => {}),
    neuAnordnen: vi.fn(async () => {}),
    ordneZu: vi.fn(async () => {}),
    loese: vi.fn(async () => {}),
    legeVerbindungAn: vi.fn(async (von, nach, felder) => ({
      id: 99,
      von,
      nach,
      verkehr: null,
      hinweis: null,
      ...felder,
    })),
    aendereVerbindung: vi.fn(),
    entferneVerbindung: vi.fn(async () => {}),
    legeKomponenteAn: vi.fn(),
    aendereKomponente: vi.fn(),
    entferneKomponente: vi.fn(),
    legeExterneStelleAn: vi.fn(),
    entferneExterneStelle: vi.fn(async () => {}),
    legeBereichAn: vi.fn(),
    aendereBereich: vi.fn(),
    entferneBereich: vi.fn(),
    setzeSchriftfeld: vi.fn(),
    setzeRufname: vi.fn(async () => {}),
    setzeKommunikationsmittel: vi.fn(async () => {}),
  } satisfies SkizzenAktionen;
  return a;
}

function bild(
  n: Fernmeldenetz = netz(),
  aktionen: SkizzenAktionen | null = aktionenAttrappe(),
  extra = {},
) {
  const props = { netz: n, aktionen, einsatzbezeichnung: 'Großbrand Musterhausen', ...extra };
  const utils = renderMitProviders(<FernmeldeskizzeBild {...props} />);
  return {
    ...utils,
    aktionen,
    neu: (m: Fernmeldenetz) => utils.rerender(<FernmeldeskizzeBild {...props} netz={m} />),
  };
}

const element = (key: string) =>
  document.querySelector<SVGGElement>(`[data-lfh="skizze-element"][data-key="${key}"]`);
const svg = () => document.querySelector<SVGSVGElement>('[data-lfh="skizze-flaeche"] svg')!;
const zurueck = (key: string) =>
  element(key)?.getAttribute('opacity') === String(ZURUECK_DECKKRAFT);
const status = () => document.querySelector<HTMLElement>('[data-lfh="skizze-status"]')!;
const paneel = () => document.querySelector<HTMLElement>('[data-lfh="skizze-paneel"]')!;

/** Fokus über Tab bis zum Element, wie eine Person ohne Zeiger. */
async function tabBis(user: ReturnType<typeof userEvent.setup>, key: string) {
  act(() => element('fs')!.focus());
  for (let i = 0; i < 30 && document.activeElement !== element(key); i += 1) {
    await user.keyboard('{Tab}');
  }
  expect(document.activeElement).toBe(element(key));
}

// ── Zeiger in Skizzeneinheiten ───────────────────────────────────────────────────────────────

const FLAECHE = { left: 0, top: 0, right: 960, bottom: 540, width: 960, height: 540, x: 0, y: 0 };
let altesRechteck: PropertyDescriptor | undefined;
beforeEach(() => {
  altesRechteck = Object.getOwnPropertyDescriptor(SVGSVGElement.prototype, 'getBoundingClientRect');
  Object.defineProperty(SVGSVGElement.prototype, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({ ...FLAECHE, toJSON: () => FLAECHE }),
  });
});
afterEach(() => {
  if (altesRechteck)
    Object.defineProperty(SVGSVGElement.prototype, 'getBoundingClientRect', altesRechteck);
  else
    delete (SVGSVGElement.prototype as { getBoundingClientRect?: unknown }).getBoundingClientRect;
});

/** Skizzenpunkt → Bildschirmpunkt über die gezeigte `viewBox`. */
function amSchirm(p: { x: number; y: number }) {
  const [x, y, w] = svg().getAttribute('viewBox')!.split(' ').map(Number);
  const skala = FLAECHE.width / w;
  return { clientX: (p.x - x) * skala, clientY: (p.y - y) * skala };
}

const ZEIGER = { isPrimary: true, button: 0, pointerId: 1, pointerType: 'mouse' };

function ziehe(ziel: Element, von: { x: number; y: number }, nach: { x: number; y: number }) {
  fireEvent.pointerDown(ziel, { ...ZEIGER, ...amSchirm(von) });
  act(() => {
    fireEvent.pointerMove(document, { ...ZEIGER, ...amSchirm({ x: von.x + 20, y: von.y + 20 }) });
  });
  act(() => {
    fireEvent.pointerMove(document, { ...ZEIGER, ...amSchirm(nach) });
  });
  act(() => {
    fireEvent.pointerUp(document, { ...ZEIGER, ...amSchirm(nach) });
  });
}

function plaetze(n: Fernmeldenetz) {
  return layoutFernmeldenetz(n).plaetze;
}

// ── Darstellung ──────────────────────────────────────────────────────────────────────────────

describe('Fernmeldeskizze — Darstellung (2.5, 4.2)', () => {
  it('Schriftfeld ohne Angaben: Titel, kein VS-Vermerk, „—“ bei Gültig ab und gez.', () => {
    bild();
    const sf = element('schriftfeld')!;
    const text = sf.textContent ?? '';
    expect(text.replace(/\s+/g, '')).toContain(
      'TaktischeFernmeldeskizzefürdenEinsatz‚GroßbrandMusterhausen‘',
    );
    expect(text).not.toContain('VS');
    expect(text).toMatch(/Gültig ab\s*—/);
    expect(text).toMatch(/gez\.\s*—/);
  });

  it('Gültig ab setzen: das Schriftfeld zeigt die DTG am Bildschirm wie im Druck', () => {
    const mitGueltig = () => {
      const n = netz();
      return { ...n, schriftfeld: { ...n.schriftfeld!, gueltig_ab: '2026-10-04T16:00:00Z' } };
    };
    const erwartet = taktischeDtgVoll('2026-10-04T16:00:00Z');
    const { unmount } = bild(mitGueltig());
    expect(element('schriftfeld')!.textContent).toContain(erwartet);
    unmount();
    bild(mitGueltig(), aktionenAttrappe(), { druckt: true });
    expect(document.querySelector('[data-teil="schriftfeld"]')!.textContent).toContain(erwartet);
  });

  it('Schriftfeld im Paneel: Herausgeber ändern schreibt nur dieses Feld', async () => {
    const user = userEvent.setup();
    const aktionen = aktionenAttrappe();
    aktionen.setzeSchriftfeld.mockResolvedValue({ ...netz().schriftfeld!, herausgeber: 'S6' });
    bild(netz(), aktionen);
    await user.click(element('schriftfeld')!);
    expect(within(paneel()).getByText('Vorgabe: Großbrand Musterhausen')).toBeInTheDocument();
    await user.click(within(paneel()).getByRole('button', { name: 'Herausgeber eintragen' }));
    await user.type(within(paneel()).getByRole('textbox', { name: 'Herausgeber' }), 'S6{Enter}');
    await waitFor(() =>
      expect(aktionen.setzeSchriftfeld).toHaveBeenCalledWith({ herausgeber: 'S6' }),
    );
  });

  it('Rufname im Paneel: im Datensatz der Stelle gespeichert', async () => {
    const user = userEvent.setup();
    const { aktionen } = bild();
    await user.click(element('eh-10')!);
    await user.click(within(paneel()).getByRole('button', { name: 'Rufname bearbeiten' }));
    const feld = within(paneel()).getByRole('textbox', { name: 'Rufname' });
    await user.clear(feld);
    await user.type(feld, 'Florian Musterstadt 1/1{Enter}');
    await waitFor(() =>
      expect(aktionen!.setzeRufname).toHaveBeenCalledWith('eh-10', 'Florian Musterstadt 1/1'),
    );
  });

  it('Geplante Datenverbindung: glatt, gestrichelt, mit Zeichen für Daten und dem Wort „geplant“', () => {
    bild();
    const vb = element('vb-8')!;
    const linie = vb.querySelector('[data-teil="linie"]')!;
    expect(linie.getAttribute('stroke-dasharray')).toBeTruthy();
    expect(vb.querySelector('[data-teil="funk"]')).toBeNull();
    expect(vb.querySelector('[data-teil="art"]')).not.toBeNull();
    expect(within(vb as unknown as HTMLElement).getAllByText('geplant').length).toBeGreaterThan(0);
  });

  it('Langer Rufname bricht im Platz der Einheit um und wird nicht gekürzt (Messung 1.1)', () => {
    const lang = 'Florian Musterstadt-Nord 12/34';
    const n = netz();
    bild({
      ...n,
      stellen: n.stellen.map((s) => (s.key === 'eh-10' ? { ...s, rufname: lang } : s)),
    });
    const ruf = [...element('eh-10')!.querySelectorAll('text')].find(
      (t) => t.textContent?.replace(/\s+/g, '') === lang.replace(/\s+/g, ''),
    );
    expect(ruf, 'Rufname-Text').toBeDefined();
    const zeilen = [...ruf!.querySelectorAll('tspan')].map((t) => t.textContent ?? '');
    expect(zeilen.length).toBeGreaterThan(1);
    expect(zeilen.join(' ')).toBe(lang);
    for (const z of zeilen)
      expect(schaetzeTextbreite(z, NAME_SCHRIFT)).toBeLessThanOrEqual(EINHEIT_BREITE);
  });

  // Prüfliste Kriterium 5 (e2e `fernmeldeskizze.spec.ts`): zurückgenommen (Deckkraft 0,6) hielt
  // „kein Rufname“ in `gedaempft` nur 3,35 : 1. Das Wort trägt die Unterscheidung, die Farbe ist
  // die des Textes, der mit der Deckkraft den Boden 4,5 : 1 hält (`zurueckKontrast.test.ts`).
  it('„kein Rufname“ steht in Textfarbe, damit es zurückgenommen lesbar bleibt', () => {
    const n = netz();
    bild({
      ...n,
      stellen: n.stellen.map((s) => (s.key === 'eh-10' ? { ...s, rufname: null } : s)),
    });
    const ohne = [...element('eh-10')!.querySelectorAll('text')].find(
      (t) => t.textContent === 'kein Rufname',
    );
    expect(ohne, '„kein Rufname“ steht da').toBeDefined();
    expect(ohne!.getAttribute('fill')).toBe('currentColor');
  });

  it('Lücke am Element als Wort: die Einheit ohne Sprechgruppe trägt „keine Sprechgruppe“', () => {
    bild();
    expect(element('eh-10')!.textContent).toContain('keine Sprechgruppe');
    expect(element('eh-10')!.getAttribute('aria-label')).toContain('keine Sprechgruppe');
  });

  it('Wer hört mit? Ein Klick auf die Schiene hebt sie und ihre Teilnehmer hervor, der Rest tritt zurück', async () => {
    const user = userEvent.setup();
    bild();
    await user.click(element('sg-1')!);
    expect(element('sg-1')!.getAttribute('aria-pressed')).toBe('true');
    expect(zurueck('sg-1')).toBe(false);
    expect(zurueck('ab-1')).toBe(false);
    expect(zurueck('fs')).toBe(false);
    expect(zurueck('eh-10')).toBe(true);
    expect(zurueck('ks-6')).toBe(true);
    // Hervorgehoben über die Strichstärke, nicht nur über Farbe.
    const linie = element('sg-1')!.querySelector('[data-teil="schiene"]')!;
    expect(Number(linie.getAttribute('stroke-width'))).toBe(STRICH_HERVORGEHOBEN);
  });

  it('Nur Lücken: Elemente mit Lücke voll, die übrigen zurückgenommen', async () => {
    const user = userEvent.setup();
    bild();
    await user.click(screen.getByRole('radio', { name: 'Nur Lücken' }));
    expect(zurueck('eh-10')).toBe(false);
    // „DMO 314_F*“ hat nur einen Teilnehmer: Schiene und Stelle bleiben voll.
    expect(zurueck('sg-2')).toBe(false);
    expect(zurueck('ks-6')).toBe(false);
    expect(zurueck('ab-2')).toBe(true);
    expect(zurueck('schriftfeld')).toBe(false);
  });

  it('Zoomen ohne Ziehen: zweimal „+“ vergrößert, „Einpassen“ passt wieder ein', async () => {
    const user = userEvent.setup();
    bild();
    const breite = () => Number(svg().getAttribute('viewBox')!.split(' ')[2]);
    const eingepasst = breite();
    await user.click(screen.getByRole('button', { name: 'Vergrößern' }));
    await user.click(screen.getByRole('button', { name: 'Vergrößern' }));
    expect(breite()).toBeCloseTo(eingepasst / 1.25 ** 2, 1);
    await user.click(screen.getByRole('button', { name: /Einpassen/ }));
    expect(breite()).toBeCloseTo(eingepasst, 5);
  });

  it('Fokus nie verdeckt: gezoomt holt der Fokus das Element in den sichtbaren Ausschnitt', async () => {
    const user = userEvent.setup();
    bild();
    for (let i = 0; i < 4; i += 1) {
      await user.click(screen.getByRole('button', { name: 'Vergrößern' }));
    }
    const vorher = svg().getAttribute('viewBox');
    act(() => element('schriftfeld')!.focus());
    expect(svg().getAttribute('viewBox')).not.toBe(vorher);
  });

  it('Trefferflächen: dünne Linien und Schienen treffen am Schirm mindestens 24 px breit', () => {
    bild();
    // Die viewBox ist auf zwei Stellen gerundet: 24 px kommen als 23,99996 an.
    const [, , w] = svg().getAttribute('viewBox')!.split(' ').map(Number);
    const skala = FLAECHE.width / w;
    const vb = element('vb-8')!.querySelector('line[stroke="transparent"]')!;
    const stich = element('sg-2~ks-6')!.querySelector('polyline[stroke="transparent"]')!;
    const schiene = element('sg-1')!.querySelector('rect[fill="transparent"]')!;
    expect(Number(vb.getAttribute('stroke-width')) * skala).toBeGreaterThan(23.99);
    expect(Number(stich.getAttribute('stroke-width')) * skala).toBeGreaterThan(23.99);
    expect(Number(schiene.getAttribute('height')) * skala).toBeGreaterThan(23.99);
  });

  it('Wahl von außen (Klick im Lücken-Paneel) wählt das Element in der Skizze', () => {
    bild(netz(), aktionenAttrappe(), { gewaehlt: 'eh-10' });
    expect(element('eh-10')!.getAttribute('aria-pressed')).toBe('true');
    expect(element('eh-10')!.getAttribute('tabindex')).toBe('0');
    expect(within(paneel()).getByRole('heading', { name: '1. Zug' })).toBeInTheDocument();
  });

  it('Druck: ohne Bedienung, Hervorhebung und Filter; die viewBox umfasst die ganze Skizze', () => {
    bild(netz(), aktionenAttrappe(), { druckt: true, gewaehlt: 'sg-1' });
    expect(document.querySelector('[data-lfh="skizze-werkzeugleiste"]')).toBeNull();
    expect(document.querySelector('[data-lfh="skizze-paneel"]')).toBeNull();
    expect(svg().getAttribute('viewBox')).toMatch(/^0 0 \d+(\.\d+)? \d+(\.\d+)?$/);
    expect(document.querySelectorAll('[opacity]').length).toBe(0);
    expect(document.querySelectorAll('[data-lfh="skizze-element"]').length).toBe(0);
  });

  it('ohne Abschnitte keine Fläche, nur der Grund', () => {
    const n = baueFernmeldenetz({
      ...quellen({ abschnitte: { zustand: 'gesperrt', daten: [] } }),
      rechte: ALLE,
    });
    bild(n);
    expect(
      screen.getByText(/Keine Skizze darstellbar — Abschnitte: nicht freigegeben/),
    ).toBeInTheDocument();
    expect(document.querySelector('[data-lfh="skizze-flaeche"]')).toBeNull();
  });
});

// ── Bearbeiten ───────────────────────────────────────────────────────────────────────────────

describe('Fernmeldeskizze — Bearbeiten ohne Zeiger (5.3, 6.3, 6.4)', () => {
  it('Zuordnen mit der Tastatur: Tab bis „1. Zug“, V, „314“ suchen, Enter', async () => {
    const user = userEvent.setup();
    const { aktionen } = bild();
    await tabBis(user, 'eh-10');
    await user.keyboard('v');
    const suche = await screen.findByRole('combobox', { name: 'Sprechgruppe oder Stelle suchen' });
    await user.type(suche, '314');
    expect(screen.getByRole('option', { selected: true })).toHaveTextContent('DMO 314_F*');
    await user.keyboard('{Enter}');
    await waitFor(() => expect(aktionen!.ordneZu).toHaveBeenCalledWith('eh-10', 2, undefined));
  });

  it('Verschieben mit Pfeiltasten: zweimal Pfeil rechts, zwei Rasterfelder, mit der Version der ersten Antwort', async () => {
    const user = userEvent.setup();
    const n = netz();
    const p = plaetze(n).get('ab-1')!;
    const { aktionen } = bild(n);
    act(() => element('ab-1')!.focus());
    await user.keyboard('{ArrowRight}{ArrowRight}');
    await waitFor(() => expect(aktionen!.verschiebe).toHaveBeenCalledTimes(2));
    expect(aktionen!.verschiebe).toHaveBeenNthCalledWith(
      1,
      'ab-1',
      { x: p.x + RASTER, y: p.y },
      null,
    );
    expect(aktionen!.verschiebe).toHaveBeenNthCalledWith(
      2,
      'ab-1',
      { x: p.x + 2 * RASTER, y: p.y },
      1,
    );
    expect(document.activeElement).toBe(element('ab-1'));
  });

  it('ein zweiter Pfeil wartet auf die Antwort des ersten, statt mit altem Stand ein 409 zu holen', async () => {
    const user = userEvent.setup();
    const n = netz();
    const p = plaetze(n).get('ab-1')!;
    const aktionen = aktionenAttrappe();
    let antworte: (l: SkizzenLage) => void = () => {};
    aktionen.verschiebe.mockImplementationOnce(
      () => new Promise<SkizzenLage>((r) => (antworte = r)),
    );
    bild(n, aktionen);
    act(() => element('ab-1')!.focus());
    await user.keyboard('{ArrowRight}{ArrowRight}');
    expect(aktionen.verschiebe).toHaveBeenCalledTimes(1);
    expect(status()).toHaveTextContent('Verschieben von EA 1 …');
    // Die neue Lage steht schon im Bild, bevor der Server antwortet.
    expect(element('ab-1')!.querySelector('rect')!.getAttribute('x')).toBe(
      String(p.x + 2 * RASTER),
    );
    await act(async () =>
      antworte({ element: 'ab-1', x: p.x + RASTER, y: p.y, breite: null, version: 7 }),
    );
    await waitFor(() => expect(aktionen.verschiebe).toHaveBeenCalledTimes(2));
    expect(aktionen.verschiebe).toHaveBeenLastCalledWith(
      'ab-1',
      { x: p.x + 2 * RASTER, y: p.y },
      7,
    );
  });

  it('Enter öffnet das Eigenschaftspaneel des Elements, mit „zum Datensatz“', async () => {
    const user = userEvent.setup();
    bild();
    act(() => element('ab-1')!.focus());
    await user.keyboard('{Enter}');
    const titel = within(paneel()).getByRole('heading', { name: 'EA 1' });
    await waitFor(() => expect(document.activeElement).toBe(titel));
    expect(within(paneel()).getByRole('link', { name: /zum Datensatz/ })).toHaveAttribute(
      'data-lfh',
      'inspector-sprung',
    );
  });

  it('„zum Datensatz“ trägt die Trefffläche der Stab-Ziele (Gate 3: sonst 15 px hoch)', async () => {
    const user = userEvent.setup();
    bild();
    act(() => element('ab-1')!.focus());
    await user.keyboard('{Enter}');
    const sprung = within(paneel()).getByRole('link', { name: /zum Datensatz/ });
    expect(sprung.style.display).toBe('inline-flex');
    expect(parseFloat(sprung.style.minHeight)).toBeGreaterThanOrEqual(24);
  });

  it('Zuordnung zurücknehmen: Strg+Z löst die eben gesetzte Zuordnung, Strg+Y setzt sie wieder', async () => {
    const user = userEvent.setup();
    const { aktionen } = bild();
    await tabBis(user, 'eh-10');
    await user.keyboard('v');
    await user.type(await screen.findByRole('combobox'), '314{Enter}');
    await waitFor(() => expect(aktionen!.ordneZu).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(document.activeElement).toBe(element('eh-10')));
    await user.keyboard('{Control>}z{/Control}');
    await waitFor(() => expect(aktionen!.loese).toHaveBeenCalledWith('eh-10', 2));
    await user.keyboard('{Control>}y{/Control}');
    await waitFor(() => expect(aktionen!.ordneZu).toHaveBeenCalledTimes(2));
  });

  it('Datensatz inzwischen gelöscht: Rückgängig meldet, dass er nicht mehr besteht', async () => {
    const user = userEvent.setup();
    const { aktionen, neu } = bild();
    await tabBis(user, 'eh-10');
    await user.keyboard('v');
    await user.type(await screen.findByRole('combobox'), '314{Enter}');
    await waitFor(() => expect(aktionen!.ordneZu).toHaveBeenCalledTimes(1));
    (aktionen!.loese as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new ApiError(404, 'weg'));
    neu(netz(ALLE, { ohneZug: true }));
    await user.click(screen.getByRole('button', { name: /Rückgängig/ }));
    await waitFor(() =>
      expect(status()).toHaveTextContent(
        'Rückgängig nicht möglich: Zuordnung DMO 314_F* an 1. Zug — besteht nicht mehr',
      ),
    );
    expect(aktionen!.ordneZu).toHaveBeenCalledTimes(1);
  });

  it('Stichleitung lösen: Entf an der gewählten Stichleitung löst ohne Rückfrage', async () => {
    const user = userEvent.setup();
    const { aktionen } = bild();
    act(() => element('sg-2~ks-6')!.focus());
    await user.keyboard('{Delete}');
    await waitFor(() => expect(aktionen!.loese).toHaveBeenCalledWith('ks-6', 2));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('Melder als Übergang über „Verbinden mit …“: EA 2 → „Einheit auf dem Marsch“, Art Melder', async () => {
    const user = userEvent.setup();
    const { aktionen } = bild();
    await user.click(element('ab-2')!);
    await user.click(within(paneel()).getByRole('button', { name: /Verbinden mit/ }));
    await user.type(await screen.findByRole('combobox'), 'Marsch{Enter}');
    await user.click(await screen.findByRole('menuitem', { name: 'Melder' }));
    await waitFor(() =>
      expect(aktionen!.legeVerbindungAn).toHaveBeenCalledWith(
        { art: 'abschnitt', id: 2 },
        { art: 'stelle', id: 6 },
        { art: 'melder', medium: 'leitung', status: 'bestehend' },
      ),
    );
  });

  it('Kontextmenü über die rechte Maustaste bzw. Langdruck: „Verbinden mit …“ und „zum Datensatz“', async () => {
    bild();
    fireEvent.contextMenu(element('eh-10')!, { clientX: 100, clientY: 100 });
    expect(await screen.findByRole('menuitem', { name: /Verbinden mit/ })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /zum Datensatz/ })).toBeInTheDocument();
  });

  it('Langdruck am Tablet öffnet das Kontextmenü', async () => {
    vi.useFakeTimers();
    try {
      bild();
      fireEvent.pointerDown(element('eh-10')!, {
        ...ZEIGER,
        pointerType: 'touch',
        clientX: 50,
        clientY: 50,
      });
      act(() => {
        vi.advanceTimersByTime(600);
      });
      fireEvent.pointerUp(element('eh-10')!, { ...ZEIGER, pointerType: 'touch' });
    } finally {
      vi.useRealTimers();
    }
    expect(await screen.findByRole('menuitem', { name: /Verbinden mit/ })).toBeInTheDocument();
  });
});

describe('Fernmeldeskizze — Ziehen (5.2, 6.2, 7.3)', () => {
  it('Einheit auf die Schiene: Ziehen von „1. Zug“ auf „DMO 314_F*“ ordnet zu', async () => {
    const n = netz();
    const pl = plaetze(n);
    const { aktionen } = bild(n);
    const zug = pl.get('eh-10')!;
    const schiene = pl.get('sg-2')!;
    ziehe(
      element('eh-10')!,
      { x: zug.x + 10, y: zug.y + 10 },
      { x: schiene.x + schiene.breite / 2, y: schienenLinieY(schiene) },
    );
    await waitFor(() => expect(aktionen!.ordneZu).toHaveBeenCalledWith('eh-10', 2, undefined));
    expect(aktionen!.verschiebe).not.toHaveBeenCalled();
  });

  it('frei abgelegt: verschoben auf das Raster', async () => {
    const n = netz();
    const p = plaetze(n).get('ab-1')!;
    const { aktionen } = bild(n);
    ziehe(
      element('ab-1')!,
      { x: p.x + 4, y: p.y + 4 },
      { x: p.x + 4 + 3 * RASTER + 1, y: p.y + 4 },
    );
    await waitFor(() =>
      expect(aktionen!.verschiebe).toHaveBeenCalledWith(
        'ab-1',
        { x: p.x + 3 * RASTER, y: p.y },
        null,
      ),
    );
  });

  it('Melder als Übergang per Ziehen: vom Anschluss von EA 2 auf die Stelle, Art aus dem Menü', async () => {
    const user = userEvent.setup();
    const n = netz();
    const pl = plaetze(n);
    const { aktionen } = bild(n);
    await user.click(element('ab-2')!);
    const griff = document.querySelector('[data-lfh="skizze-griff"][data-griff="kreis"] > g')!;
    const ab = pl.get('ab-2')!;
    const ziel = pl.get('ks-6')!;
    ziehe(griff, { x: ab.x + ab.breite / 2, y: ab.y + ab.hoehe }, { x: ziel.x + 8, y: ziel.y + 8 });
    await user.click(await screen.findByRole('menuitem', { name: 'Melder' }));
    await waitFor(() =>
      expect(aktionen!.legeVerbindungAn).toHaveBeenCalledWith(
        { art: 'abschnitt', id: 2 },
        { art: 'stelle', id: 6 },
        { art: 'melder', medium: 'leitung', status: 'bestehend' },
      ),
    );
  });
});

// ── Rechte und Geräte ────────────────────────────────────────────────────────────────────────

describe('Fernmeldeskizze — Rechte und Geräte (6.5)', () => {
  it('Nur Leserecht: nichts verschieben, zuordnen oder anlegen, aber hervorheben und zoomen', async () => {
    const user = userEvent.setup();
    bild(netz(), null);
    expect(screen.queryByRole('button', { name: /Rückgängig/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Palette' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Neu anordnen' })).toBeNull();
    await user.click(element('ab-1')!);
    expect(document.querySelector('[data-lfh="skizze-griff"]')).toBeNull();
    expect(within(paneel()).getByText('Kein Schreibrecht im Einsatz')).toBeInTheDocument();
    expect(within(paneel()).queryByRole('button', { name: /Verbinden mit/ })).toBeNull();
    await user.keyboard('{ArrowRight}');
    expect(status()).toHaveTextContent('Kein Schreibrecht im Einsatz');
    // Hervorheben und Zoom gehen weiter.
    await user.click(element('sg-1')!);
    expect(zurueck('eh-10')).toBe(true);
    const vorher = svg().getAttribute('viewBox');
    await user.click(screen.getByRole('button', { name: 'Vergrößern' }));
    expect(svg().getAttribute('viewBox')).not.toBe(vorher);
  });

  it('Recht auf Stab, nicht auf Einheiten: „1. Zug“ ohne Griff, das Paneel nennt den Grund', async () => {
    const user = userEvent.setup();
    bild(netz({ stab: true, einsatzabschnitte: true, verwaltung: true }));
    await user.click(element('eh-10')!);
    expect(document.querySelector('[data-lfh="skizze-griff"]')).toBeNull();
    expect(within(paneel()).getByText('Einheiten: kein Schreibrecht')).toBeInTheDocument();
    await user.click(element('ab-1')!);
    expect(document.querySelector('[data-lfh="skizze-griff"]')).not.toBeNull();
  });

  it('Mobil: keine Griffe, keine Palette, kein Rückgängig; Zoom und Hervorheben bleiben', async () => {
    setzeViewportBreite(390);
    const user = userEvent.setup();
    bild();
    expect(screen.queryByRole('button', { name: 'Palette' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Rückgängig/ })).toBeNull();
    await user.click(element('ab-1')!);
    expect(document.querySelector('[data-lfh="skizze-griff"]')).toBeNull();
    expect(within(paneel()).getByText('Am schmalen Bildschirm nur lesen')).toBeInTheDocument();
    expect(zurueck('eh-10')).toBe(true);
    expect(screen.getByRole('button', { name: 'Vergrößern' })).toBeInTheDocument();
  });

  it('Palette mit Recht auf den Stab: Schiene per Knopf auf die Fläche, ohne Zeiger', async () => {
    const user = userEvent.setup();
    const { aktionen } = bild();
    await user.click(screen.getByRole('button', { name: 'Palette' }));
    const palette = screen.getByRole('navigation', { name: 'Palette' });
    expect(within(palette).getByRole('button', { name: 'TMO BN_BOS zeigen' })).toBeInTheDocument();
    await user.click(within(palette).getByRole('button', { name: 'DMO 505 auf die Fläche' }));
    await waitFor(() =>
      expect(aktionen!.verschiebe).toHaveBeenCalledWith(
        'sg-4',
        { x: expect.any(Number), y: expect.any(Number) },
        null,
      ),
    );
  });

  it('Leitstelle anlegen: über die Palette, als Stelle des Kommunikationsplans', async () => {
    const user = userEvent.setup();
    const aktionen = aktionenAttrappe();
    aktionen.legeExterneStelleAn.mockResolvedValue({
      id: 9,
      stellenart: 'leitstelle',
      bezeichnung: 'ILS Nord',
      verbindungen: [],
      sprechgruppen: [],
    });
    bild(netz(), aktionen);
    await user.click(screen.getByRole('button', { name: 'Palette' }));
    await user.click(screen.getByRole('button', { name: 'Externe Stelle' }));
    const dialog = await screen.findByRole('dialog', { name: 'Externe Stelle anlegen' });
    await user.type(within(dialog).getByRole('textbox', { name: 'Bezeichnung' }), 'ILS Nord');
    await user.click(within(dialog).getByRole('button', { name: 'Anlegen' }));
    await waitFor(() =>
      expect(aktionen.legeExterneStelleAn).toHaveBeenCalledWith('leitstelle', 'ILS Nord'),
    );
    expect(aktionen.legeKomponenteAn).not.toHaveBeenCalled();
  });

  it('Bereich anlegen: Vorgabe „Rückwärtiger Bereich“, im sichtbaren Ausschnitt', async () => {
    const user = userEvent.setup();
    const aktionen = aktionenAttrappe();
    aktionen.legeBereichAn.mockImplementation(async (f) => ({
      id: 4,
      version: 1,
      bezeichnung: 'x',
      ...f,
    }));
    bild(netz(), aktionen);
    await user.click(screen.getByRole('button', { name: 'Palette' }));
    await user.click(screen.getByRole('button', { name: 'Bereich' }));
    const dialog = await screen.findByRole('dialog', { name: 'Bereich anlegen' });
    expect(within(dialog).getByRole('textbox', { name: 'Bezeichnung' })).toHaveValue(
      'Rückwärtiger Bereich',
    );
    await user.click(within(dialog).getByRole('button', { name: 'Anlegen' }));
    await waitFor(() =>
      expect(aktionen.legeBereichAn).toHaveBeenCalledWith(
        expect.objectContaining({ bezeichnung: 'Rückwärtiger Bereich', breite: 320, hoehe: 192 }),
      ),
    );
    const { x, y } = aktionen.legeBereichAn.mock.calls[0][0];
    expect(x % RASTER).toBe(0);
    expect(y % RASTER).toBe(0);
  });

  it('Bereich aufziehen: die Ecke ziehen ändert die Größe mit der Version', async () => {
    const user = userEvent.setup();
    const n = netz();
    const mitBereich: Fernmeldenetz = {
      ...n,
      bereiche: [
        {
          key: 'be-4',
          id: 4,
          bezeichnung: 'Rückwärtiger Bereich',
          x: 64,
          y: 64,
          breite: 160,
          hoehe: 96,
          version: 3,
        },
      ],
    };
    const aktionen = aktionenAttrappe();
    aktionen.aendereBereich.mockImplementation(async (id, f, version) => ({
      id,
      bezeichnung: 'Rückwärtiger Bereich',
      x: 64,
      y: 64,
      breite: 160,
      hoehe: 96,
      ...f,
      version: version + 1,
    }));
    bild(mitBereich, aktionen);
    await user.click(screen.getByRole('button', { name: 'Bereich Rückwärtiger Bereich' }));
    const ecke = document.querySelector('[data-lfh="skizze-griff"][data-griff="ecke"] > g')!;
    ziehe(ecke, { x: 224, y: 160 }, { x: 224 + 80, y: 160 + 40 });
    await waitFor(() =>
      expect(aktionen.aendereBereich).toHaveBeenCalledWith(4, { breite: 240, hoehe: 136 }, 3),
    );
  });

  it('Artwahl am Tablet radial', async () => {
    setzeZeigerGrob(true);
    const user = userEvent.setup();
    bild();
    await user.click(element('ab-2')!);
    await user.click(within(paneel()).getByRole('button', { name: /Verbinden mit/ }));
    await user.type(await screen.findByRole('combobox'), 'Marsch{Enter}');
    const menue = await screen.findByRole('menu', { name: 'Art der Verbindung' });
    expect(menue).toHaveAttribute('data-radial', 'true');
  });
});
