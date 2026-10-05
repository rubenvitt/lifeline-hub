import { useRef } from 'react';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import userEvent from '@testing-library/user-event';
import { screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Button, Form, Input } from 'antd';
import {
  CommandPaletteProvider,
  useTastaturEbene,
} from '../command-palette/CommandPaletteProvider';
import type { TastaturAktionen } from '../command-palette/typen';
import { renderMitProviders } from '../test/utils';
import { dichten } from '../theme/tokens';
import EinsatzSeite, { ortspfadStil, seitenBreiteMax, seitenkopfStil } from './EinsatzSeite';

/**
 * Attrappe für die Palettenbefehle (LFH-391 · B5): `src/test/setup.ts` fährt MSW mit
 * `onUnhandledRequest: 'error'`, und das echte `useBefehle` forderte `/api/einsaetze` an.
 *
 * Gegriffen wird über `#cmd-tastatur:<id>`, nicht über den Wortlaut (der ist in
 * `befehle.test.ts` gepinnt). `modul:etb` steht fest darin, damit „die Option fehlt" von „die
 * Palette ist gar nicht offen" unterscheidbar bleibt.
 *
 * Dateiweit, wie `vi.mock` es erzwingt: die übrigen Aussagen rendern ohne Provider, wo
 * `useTastaturEbene` ein No-op ist.
 */
vi.mock('../command-palette/useBefehle', () => ({
  useBefehle: (aktionen: TastaturAktionen = {}) => [
    { id: 'modul:etb', gruppe: 'module', label: 'ETB', ausfuehren: vi.fn() },
    ...Object.entries(aktionen).map(([id, ausfuehren]) => ({
      id: `tastatur:${id}`,
      gruppe: 'aktionen',
      label: id,
      ausfuehren,
    })),
  ],
}));

const hier = dirname(fileURLToPath(import.meta.url));
const seiteCss = readFileSync(join(hier, 'EinsatzSeite.css'), 'utf-8');

afterEach(() => {
  vi.restoreAllMocks();
});

describe('EinsatzSeite', () => {
  it('rendert Breadcrumb, Titel (level 4), Beschreibung, Aktionen, Hinweis und Children', () => {
    const { container } = renderMitProviders(
      <EinsatzSeite
        breadcrumb={<nav>Einsätze / Personen</nav>}
        titel="Personen"
        beschreibung="Betreute und vermisste Personen"
        aktionen={<Button type="primary">Anlegen</Button>}
        hinweis={<div>Nur lesend</div>}
      >
        <div>Seiteninhalt</div>
      </EinsatzSeite>,
    );
    const heading = screen.getByRole('heading', { name: 'Personen' });
    // Gleiche Ebene wie `AdminPage` — eine Seite ist eine Seite (Spec §3.1).
    expect(heading.tagName).toBe('H1');
    expect(screen.getByText('Einsätze / Personen')).toBeInTheDocument();
    expect(screen.getByText('Betreute und vermisste Personen')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Anlegen' })).toBeInTheDocument();
    expect(screen.getByText('Nur lesend')).toBeInTheDocument();
    expect(screen.getByText('Seiteninhalt')).toBeInTheDocument();
    // Die Seitenkopfleiste trägt Titel und Aktionen in EINER Leiste.
    const leiste = container.querySelector<HTMLElement>('[data-lfh="seitenkopf"]')!;
    expect(leiste).toContainElement(heading);
    expect(leiste).toContainElement(screen.getByRole('button', { name: 'Anlegen' }));
    // 14/600 — der Satz des Entwurfs, die Ebene bleibt h1.
    expect(heading).toHaveStyle({ fontSize: '14px', fontWeight: '600' });
    // Ein Haken für den Druck (LFH-893): eine Druckwurzel kann die Bildschirmhilfe ausblenden.
    expect(container.querySelector('[data-lfh="seiten-beschreibung"]')).toHaveTextContent(
      'Betreute und vermisste Personen',
    );
  });

  it('zeigt ein optionales Mono-Meta neben dem Titel', () => {
    const { container } = renderMitProviders(
      <EinsatzSeite titel="Lagebericht" meta="Nr. 12">
        <div>x</div>
      </EinsatzSeite>,
    );
    const leiste = container.querySelector<HTMLElement>('[data-lfh="seitenkopf"]')!;
    const meta = screen.getByText('Nr. 12');
    expect(leiste).toContainElement(meta);
    expect(meta.style.fontFamily).toContain('Mono');
  });

  it('zieht die Kopfleiste über die Seitenrinne, die Lesebreite gilt dem Inhalt', () => {
    // Über die REINE Stilfunktion: cssstyle (jsdom) verwirft logische Kurzschreibweisen mit `var()`.
    const token = { margin: 11, marginLG: 18, paddingXS: 3 };
    const vollbreit = seitenkopfStil(token, { linie: '#LINIE' }, true);
    // Derselbe negative Rand wie die ETB-Erfassungsleiste; der Innenrand nimmt die Rinne wieder auf.
    expect(vollbreit.marginInline).toBe('calc(-1 * var(--lfh-seiten-polsterung))');
    expect(vollbreit.marginTop).toBe('calc(-1 * var(--lfh-seiten-polsterung))');
    expect(vollbreit.paddingInline).toBe('var(--lfh-seiten-polsterung)');
    expect(vollbreit.minHeight).toBe(44);
    expect(vollbreit.borderBottom).toBe('1px solid #LINIE');
    // Gegenprobe: in einer Spalte (AdminPage) KEIN negativer Rand.
    expect(seitenkopfStil(token, { linie: '#LINIE' }, false).marginInline).toBeUndefined();
  });

  it('füllt ohne Angabe die volle Inhaltsbreite; schmal nur ausdrücklich', () => {
    // Vollbreit ist die Vorgabe. Die WURZEL ist ohnehin vollbreit; eine Grenze trägt der
    // Inhaltsbereich. Pixel als LITERALE — aus `flaeche` gelesen prüfte der Test den Token gegen
    // sich selbst.
    const inhalt = (c: HTMLElement) => c.querySelector<HTMLElement>('[data-lfh="seiten-inhalt"]')!;

    const voll = renderMitProviders(
      <EinsatzSeite titel="Voll">
        <div>x</div>
      </EinsatzSeite>,
    );
    expect(inhalt(voll.container).style.maxWidth).toBe('');
    voll.unmount();

    const schmal = renderMitProviders(
      <EinsatzSeite titel="Schmal" breite="schmal">
        <div>x</div>
      </EinsatzSeite>,
    );
    expect(inhalt(schmal.container).style.maxWidth).toBe('900px');
  });

  it('löst die Breite rein auf — voll ist keine Grenze, nicht 100 %', () => {
    expect(seitenBreiteMax('voll')).toBeUndefined();
    expect(seitenBreiteMax('schmal')).toBe(900);
  });

  it('zeigt den Query-Datenstand im Seitenkopf', () => {
    const zeit = new Date(2026, 5, 10, 14, 7).getTime();
    renderMitProviders(
      <EinsatzSeite titel="Liste" dataUpdatedAt={zeit}>
        <div>Inhalt</div>
      </EinsatzSeite>,
    );
    expect(screen.getByText('Stand 14:07')).toBeInTheDocument();
  });

  // LFH-723: die Kennzeichnung „offline" folgt dem Online-Zustand des Browsers; keine Seite
  // reicht dafür etwas durch.
  it('kennzeichnet den Datenstand, solange der Browser offline ist', async () => {
    const zeit = new Date(2026, 5, 10, 14, 32).getTime();
    renderMitProviders(
      <EinsatzSeite titel="Liste" dataUpdatedAt={zeit}>
        <div>Inhalt</div>
      </EinsatzSeite>,
    );
    expect(screen.getByText('Stand 14:32')).toBeInTheDocument();
    const onLine = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    window.dispatchEvent(new Event('offline'));
    expect(await screen.findByText('Stand 14:32 · offline')).toBeInTheDocument();
    onLine.mockReturnValue(true);
    window.dispatchEvent(new Event('online'));
    expect(await screen.findByText('Stand 14:32')).toBeInTheDocument();
    onLine.mockRestore();
  });

  // LFH-373: eine Seite mit Datenstand reicht vor dem ersten Abruf `0` durch, dann steht der
  // Platzhalter; eine Seite ohne Datenstand bekommt keinen. Meta und Stand sind EINE Gruppe mit
  // eigener Zeile unter `md`: die hält der Platzhalter, und eine spät eintreffende Meta wächst
  // darin, statt etwas umzubrechen.
  it('fasst Meta und Datenstand zu einer Gruppe, die unter md eine eigene Zeile hat', () => {
    const { container } = renderMitProviders(
      <EinsatzSeite titel="Liste" meta="8 Einträge" dataUpdatedAt={0}>
        <div>Inhalt</div>
      </EinsatzSeite>,
    );
    const gruppe = container.querySelector('.lfh-seitenkopf__meta') as HTMLElement;
    expect(gruppe).not.toBeNull();
    expect(gruppe).toHaveTextContent('8 Einträge');
    expect(gruppe.querySelector('[data-lfh="datenstand-platzhalter"]')).not.toBeNull();
    // Die Gruppe selbst DARF umbrechen, nur ihre Teile nicht: eine lange Meta liefe bei 390 px
    // sonst quer über die Seite.
    expect(gruppe.style.flexWrap).toBe('wrap');
    expect(gruppe.style.minWidth).toBe('0px');
    for (const teil of Array.from(gruppe.children) as HTMLElement[]) {
      expect(teil.style.whiteSpace).toBe('nowrap');
    }
    // Vitest fährt mit `css: false` — die Regel wird am Quelltext gepinnt.
    const regel = seiteCss.match(/@media\s*\(max-width:\s*767\.98px\)\s*\{([^}]*\{[^}]*\})/);
    expect(regel, 'EinsatzSeite.css trägt die Schmal-Regel').not.toBeNull();
    expect(regel![1]).toContain('.lfh-seitenkopf__meta');
    expect(regel![1]).toMatch(/flex-basis:\s*100%/);
  });

  // LFH-373 (`einsatzauswahl-cls.spec.ts`): ab `md` steht die Gruppe in der Titelzeile, und die
  // spät eintreffende Meta schöbe den Platzhalter nach rechts (CLS). Der Platzhalter gilt deshalb
  // nur unter `md`.
  it('blendet den Datenstand-Platzhalter ab md aus', () => {
    const regel = seiteCss.match(/@media\s*\(min-width:\s*768px\)\s*\{([^}]*\{[^}]*\})/);
    expect(regel, 'EinsatzSeite.css trägt die Breit-Regel').not.toBeNull();
    expect(regel![1]).toContain('datenstand-platzhalter');
    expect(regel![1]).toMatch(/display:\s*none/);
  });

  it('rendert ohne Meta und ohne Datenstand keine leere Gruppe', () => {
    const { container } = renderMitProviders(
      <EinsatzSeite titel="Liste">
        <div>Inhalt</div>
      </EinsatzSeite>,
    );
    expect(container.querySelector('.lfh-seitenkopf__meta')).toBeNull();
  });

  it('hält den Platz für den Datenstand frei, solange die Seite noch lädt', () => {
    const { container, unmount } = renderMitProviders(
      <EinsatzSeite titel="Liste" dataUpdatedAt={0}>
        <div>Inhalt</div>
      </EinsatzSeite>,
    );
    expect(container.querySelector('[data-lfh="datenstand-platzhalter"]')).not.toBeNull();
    unmount();
    const ohne = renderMitProviders(
      <EinsatzSeite titel="Liste">
        <div>Inhalt</div>
      </EinsatzSeite>,
    );
    expect(ohne.container.querySelector('[data-lfh="datenstand-platzhalter"]')).toBeNull();
  });

  /**
   * Die Regel gegen „Schäden › Schäden": der letzte Pfadeintrag wird ausgeblendet, weil der Titel
   * ihn trägt. Vitest fährt mit `css: false`, deshalb ein Quelltext-Pin. Der Trenner davor darf
   * NICHT mit verschwinden: er ist der Chevron vor dem Titel.
   */
  it('blendet im Ortspfad genau den letzten EINTRAG aus, nicht den Trenner davor', () => {
    const regel = seiteCss.match(/([^{}]+)\{\s*display:\s*none;\s*\}/);
    expect(regel, 'EinsatzSeite.css trägt die Ausblendregel').not.toBeNull();
    const selektor = regel![1].trim();
    expect(selektor).toContain('.lfh-seitenkopf__pfad');
    expect(selektor).toContain('li:last-child');
    expect(selektor).toContain(':not(.ant-breadcrumb-separator)');
  });

  /**
   * LFH-909: jeder Pfad-Link hält die Dichte-Staffel. Die Stilfunktion liefert den Boden als
   * aufgelösten Pixelwert; die Böden stehen als LITERALE, aus `dichten` gelesen prüfte der Test
   * den Token gegen sich selbst. Ob der Link die Höhe im Layout erreicht, misst Gate 3.
   */
  it('gibt dem Ortspfad den Boden der Stufe als Variable (30 / 48 / 72 px)', () => {
    const tokenFuer = (s: keyof typeof dichten) => ({ controlHeight: dichten[s].zeilenhoehe });
    const ziel = (s: keyof typeof dichten) =>
      (ortspfadStil(tokenFuer(s)) as Record<string, unknown>)['--lfh-ortspfad-ziel'];
    expect(ziel('kompakt')).toBe('30px');
    expect(ziel('komfortabel')).toBe('48px');
    expect(ziel('handschuh')).toBe('72px');
  });

  it('setzt den Boden am Wrapper des Ortspfads', () => {
    const { container } = renderMitProviders(
      <EinsatzSeite titel="Befehl" breadcrumb={<nav>Einsätze</nav>}>
        <div>x</div>
      </EinsatzSeite>,
    );
    const pfad = container.querySelector<HTMLElement>('.lfh-seitenkopf__pfad')!;
    expect(pfad.style.getPropertyValue('--lfh-ortspfad-ziel')).toMatch(/^\d+px$/);
  });

  /**
   * Quelltext-Pin der Pfad-Link-Regel (Vitest fährt mit `css: false`): antd setzt den Link auf
   * `height: fontHeight` (20 px bei 12-px-Schrift). Die Regel hebt das auf, liest den Boden aus der
   * Variable und hält die Hover-Fläche auf der Textzeile. `:root` macht sie unabhängig von der
   * Reihenfolge der Stile.
   */
  it('hebt den Pfad-Link auf den Boden, ohne die Schrift anzufassen', () => {
    const regel = seiteCss.match(
      /:root \.lfh-seitenkopf__pfad \.ant-breadcrumb-item a\s*\{([^}]*)\}/,
    );
    expect(regel, 'EinsatzSeite.css trägt die Pfad-Link-Regel').not.toBeNull();
    const koerper = regel![1];
    expect(koerper).toMatch(/height:\s*auto/);
    expect(koerper).toMatch(/min-height:\s*var\(--lfh-ortspfad-ziel\)/);
    // Durchsichtiger Rand statt Polster: die Hinterlegung behält antds seitliches Polster.
    expect(koerper).toMatch(/border-block:[^;]*transparent/);
    expect(koerper).toMatch(/background-clip:\s*padding-box/);
    expect(koerper).not.toMatch(/padding-block/);
    expect(koerper).not.toMatch(/font-size/);
    const liste = seiteCss.match(/:root \.lfh-seitenkopf__pfad \.ant-breadcrumb ol\s*\{([^}]*)\}/);
    expect(liste, 'EinsatzSeite.css mittet die Pfadliste').not.toBeNull();
    expect(liste![1]).toMatch(/align-items:\s*center/);
  });

  it('löst über einen Header-Button (außerhalb des Form) das Speichern via form.submit() aus', async () => {
    const onFinish = vi.fn();
    function Harness() {
      const [form] = Form.useForm();
      return (
        <EinsatzSeite
          titel="Titel"
          aktionen={
            <Button type="primary" onClick={() => form.submit()}>
              Speichern
            </Button>
          }
        >
          <Form form={form} onFinish={onFinish}>
            <Form.Item name="feld" initialValue="wert">
              <Input aria-label="feld" />
            </Form.Item>
          </Form>
        </EinsatzSeite>
      );
    }
    renderMitProviders(<Harness />);
    await userEvent.click(screen.getByRole('button', { name: 'Speichern' }));
    expect(onFinish).toHaveBeenCalledWith({ feld: 'wert' });
  });

  it('warnt in Dev, wenn der Aktionen-Slot mehr als eine Primäraktion trägt', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    renderMitProviders(
      <EinsatzSeite
        titel="Personen"
        aktionen={
          <>
            <Button type="primary">Anlegen</Button>
            <Button type="primary">Importieren</Button>
          </>
        }
      >
        <div>x</div>
      </EinsatzSeite>,
    );
    expect(warn).toHaveBeenCalled();
    expect(warn.mock.calls[0][0]).toMatch(/Primäraktion/);
  });

  it('schweigt bei genau einer Primäraktion neben Nebenaktionen', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    renderMitProviders(
      <EinsatzSeite
        titel="Personen"
        aktionen={
          <>
            <Button>Exportieren</Button>
            <Button type="primary">Anlegen</Button>
          </>
        }
      >
        {/* Ein Primär-Button IM Inhalt ist erlaubt — die Regel gilt nur für den Kopf. */}
        <Button type="primary">Speichern</Button>
      </EinsatzSeite>,
    );
    expect(warn).not.toHaveBeenCalled();
  });
});

/**
 * Seitenweite Tastatur-Ebene (LFH-391 · B5): eine flache Seitenebene über den tiefen
 * Werkzeugleisten der Ebenenkette.
 */
describe('EinsatzSeite · Seitenebene der Kommandopalette', () => {
  function oeffnen(neueZeile?: () => void) {
    return renderMitProviders(
      <CommandPaletteProvider>
        <EinsatzSeite titel="Schäden" neueZeile={neueZeile}>
          <button type="button">Inhalt</button>
        </EinsatzSeite>
      </CommandPaletteProvider>,
    );
  }

  it('reicht `neueZeile` als Aktion der Seitenebene durch', async () => {
    const u = userEvent.setup();
    const neueZeile = vi.fn();
    oeffnen(neueZeile);

    // Der Fokus muss VOR Strg+K in der Seite liegen: nur dann enthält die Ebenenkette die
    // Seitenebene. Ohne Fokus trüge sie der Anzeige-Fallback, und der Test prüfte diesen.
    await u.click(screen.getByRole('button', { name: 'Inhalt' }));
    await u.keyboard('{Control>}k{/Control}');

    const option = await waitFor(() => {
      const o = document.getElementById('cmd-tastatur:neue-zeile');
      expect(o).not.toBeNull();
      return o!;
    });
    await u.click(option);
    expect(neueZeile).toHaveBeenCalledTimes(1);
  });

  /**
   * Eine Werkzeugleiste tief IN der Seite — Zeuge dafür, dass die Seitenebene ohne `neueZeile`
   * gar nicht erst entsteht.
   */
  function Werkzeugzeile({ zuruecksetzen }: { zuruecksetzen: () => void }) {
    const wurzel = useRef<HTMLDivElement>(null);
    useTastaturEbene({
      name: 'Werkzeugzeile',
      wurzel,
      aktionen: { 'filter-zuruecksetzen': zuruecksetzen },
    });
    return (
      <div ref={wurzel}>
        <button type="button">Werkzeug</button>
      </div>
    );
  }

  /**
   * Der `aktiv`-Riegel — NICHT über „die Option `neue-zeile` fehlt" geprüft, das garantiert schon
   * `verschmelzeAktionen`.
   *
   * Sichtbar wird er am Anzeige-FALLBACK: eine registrierte Seitenebene enthält den Fokus fast
   * immer und verdrängt den Fallback. Ohne Riegel bliebe die Gruppe „Aktionen" auf jeder
   * Detailseite ohne Anlegen-Aktion leer, obwohl die Werkzeugleiste darunter etwas anbietet.
   */
  it('lässt ohne `neueZeile` die Aktion einer inneren Ebene im Fallback stehen', async () => {
    const u = userEvent.setup();
    renderMitProviders(
      <CommandPaletteProvider>
        <EinsatzSeite titel="Schäden">
          <Werkzeugzeile zuruecksetzen={vi.fn()} />
          <button type="button">Inhalt</button>
        </EinsatzSeite>
      </CommandPaletteProvider>,
    );

    // Fokus IN der Seite, aber außerhalb der Werkzeugzeile: dort belegte eine (leere) Seitenebene
    // die Kette.
    await u.click(screen.getByRole('button', { name: 'Inhalt' }));
    await u.keyboard('{Control>}k{/Control}');

    await waitFor(() => expect(document.getElementById('cmd-modul:etb')).not.toBeNull());
    expect(document.getElementById('cmd-tastatur:filter-zuruecksetzen')).not.toBeNull();
  });

  it('registriert ohne die Prop keine Ebene', async () => {
    const u = userEvent.setup();
    oeffnen(undefined);

    await u.click(screen.getByRole('button', { name: 'Inhalt' }));
    await u.keyboard('{Control>}k{/Control}');

    // Positivhälfte: die Palette steht offen und rendert Optionen, sonst belegte das `null` unten
    // nur, dass nichts auf ist.
    await waitFor(() => expect(document.getElementById('cmd-modul:etb')).not.toBeNull());
    expect(document.getElementById('cmd-tastatur:neue-zeile')).toBeNull();
  });

  /**
   * LFH-373: ein angepinnter Seitenfuß steht als LETZTES Kind der Seitenwurzel, nach dem Inhalt.
   * Ein `position: sticky; bottom: 0` steigt nie über die Oberkante seines Elternblocks; als Kind
   * der Wurzel beginnt dieser mit dem Seitenkopf.
   */
  it('stellt einen Fuß als letztes Kind der Wurzel hinter den Inhalt', () => {
    const { container } = renderMitProviders(
      <EinsatzSeite titel="ETB" fuss={<div data-testid="fuss">Erfassung</div>}>
        <p>Inhalt</p>
      </EinsatzSeite>,
    );
    const fuss = screen.getByTestId('fuss');
    const inhalt = container.querySelector('[data-lfh="seiten-inhalt"]')!;
    expect(inhalt.contains(fuss)).toBe(false);
    expect(fuss.parentElement).toBe(inhalt.parentElement);
    expect(inhalt.parentElement!.lastElementChild).toBe(fuss);
  });
});
