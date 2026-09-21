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
import { flaeche } from '../theme/tokens';
import EinsatzSeite, { seitenkopfStil } from './EinsatzSeite';

/**
 * Attrappe für die Palettenbefehle (LFH-391 · B5). Nötig, weil `src/test/setup.ts` MSW mit
 * `onUnhandledRequest: 'error'` fährt — das echte `useBefehle` fordert beim Öffnen
 * `/api/einsaetze` an und bräche den Lauf.
 *
 * Sie beschriftet mit der Id und wird über `#cmd-tastatur:<id>` gegriffen, nicht über den
 * Wortlaut: der kommt in der Produktion aus `TASTATUR_AKTIONEN` und ist dort gepinnt
 * (`befehle.test.ts`) — hier behauptet, belegte der Test die Beschriftung der Attrappe.
 * `modul:etb` steht fest darin, damit „die Option fehlt" von „die Palette ist gar nicht
 * offen" unterscheidbar bleibt.
 *
 * Dateiweit, wie `vi.mock` es ohnehin erzwingt: die übrigen Aussagen dieser Datei rendern
 * `EinsatzSeite` ohne Provider, wo `useTastaturEbene` ein No-op ist.
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
const spracheCss = readFileSync(join(hier, '..', 'theme', 'sprache.css'), 'utf-8');
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
    expect(heading.tagName).toBe('H4');
    expect(screen.getByText('Einsätze / Personen')).toBeInTheDocument();
    expect(screen.getByText('Betreute und vermisste Personen')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Anlegen' })).toBeInTheDocument();
    expect(screen.getByText('Nur lesend')).toBeInTheDocument();
    expect(screen.getByText('Seiteninhalt')).toBeInTheDocument();
    // Neuentwurf (21.09.2026): die Seitenkopfleiste trägt die Seite — der A0-Akzentstrich
    // über dem Titel ist entfallen, Titel und Aktionen stehen in EINER Leiste.
    expect(container.querySelector('.lfh-marke__strich')).toBeNull();
    const leiste = container.querySelector<HTMLElement>('[data-lfh="seitenkopf"]')!;
    expect(leiste).toContainElement(heading);
    expect(leiste).toContainElement(screen.getByRole('button', { name: 'Anlegen' }));
    // 14/600 — der Satz des Entwurfs, die Ebene bleibt h4.
    expect(heading).toHaveStyle({ fontSize: '14px', fontWeight: '600' });
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
    // Über die REINE Stilfunktion, nicht über das gerenderte `style`: cssstyle (jsdom)
    // verwirft logische Kurzschreibweisen mit `var()` — rot oder grün aus dem falschen Grund.
    const token = { margin: 11, marginLG: 18, paddingXS: 3 };
    const vollbreit = seitenkopfStil(token, { linie: '#LINIE' }, true);
    // Derselbe negative Rand wie die ETB-Erfassungsleiste — und der Innenrand nimmt die
    // Rinne wieder auf, sonst klebte der Titel am Rand.
    expect(vollbreit.marginInline).toBe('calc(-1 * var(--lfh-seiten-polsterung))');
    expect(vollbreit.marginTop).toBe('calc(-1 * var(--lfh-seiten-polsterung))');
    expect(vollbreit.paddingInline).toBe('var(--lfh-seiten-polsterung)');
    expect(vollbreit.minHeight).toBe(44);
    expect(vollbreit.borderBottom).toBe('1px solid #LINIE');
    // Gegenprobe: in einer Spalte (AdminPage) KEIN negativer Rand.
    expect(seitenkopfStil(token, { linie: '#LINIE' }, false).marginInline).toBeUndefined();
  });

  it('hält die Inhaltsbreite auf `flaeche.seiteSchmal` und lässt sie überschreiben', () => {
    // Seit dem Neuentwurf ist die WURZEL vollbreit (die Kopfleiste zieht bis an den Rand);
    // die Lesebreite trägt der Inhaltsbereich darunter.
    const wurzel = (c: HTMLElement) => c.querySelector<HTMLElement>('[data-lfh="seiten-inhalt"]')!;

    const { container, unmount } = renderMitProviders(
      <EinsatzSeite titel="Schmal">
        <div>x</div>
      </EinsatzSeite>,
    );
    expect(wurzel(container).style.maxWidth).toBe(`${flaeche.seiteSchmal}px`);
    unmount();

    const breit = renderMitProviders(
      <EinsatzSeite titel="Breit" breite={flaeche.seiteBreit}>
        <div>x</div>
      </EinsatzSeite>,
    );
    expect(wurzel(breit.container).style.maxWidth).toBe(`${flaeche.seiteBreit}px`);
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

  /**
   * SEIT DEM NEUENTWURF benutzt `EinsatzSeite` den Strich nicht mehr — einziger Konsument ist
   * das Lage-Dashboard (`pages/lage-dashboard/LageDashboardPage.tsx`). Der Pin bleibt hier,
   * bis er dorthin umzieht; er bewacht `sprache.css`, nicht dieses Primitiv.
   *
   * Der Akzentstrich lebt als CSS-Klasse, und `vite.config.ts` setzt für Vitest
   * `css: false` — die Klassen-Assertion oben belegt also NUR das Attribut, keine
   * Wirkung. Dieser Guard (Muster: `theme/rollen.guard.test.ts`) pinnt deshalb die
   * Geometrie in der Quelle. Er macht zugleich die bewusste Kopplung laut: die
   * Klasse ist BEM-Kind von `.lfh-marke`; wer sie dort umbaut, bricht hier einen
   * Test statt still ein Primitiv.
   */
  it('der Akzentstrich in sprache.css trägt 36 × 3 px aus den Markenrollen', () => {
    const regel = spracheCss.match(/\.lfh-marke__strich\s*\{([^}]*)\}/);
    expect(regel).not.toBeNull();
    const block = regel![1];
    expect(block).toMatch(/width:\s*36px/);
    expect(block).toMatch(/height:\s*3px/);
    expect(block).toMatch(/background:\s*var\(--lfh-marke\)/);
    expect(block).toMatch(/box-shadow:\s*var\(--lfh-marke-glut\)/);
  });

  /**
   * Die EINE Regel, die „Schäden › Schäden" verhindert: der letzte Pfadeintrag (der
   * Seitenname) wird ausgeblendet, weil der Titel ihn direkt danach trägt. Vitest fährt mit
   * `css: false` — die Wirkung ist hier nicht messbar, deshalb ein Quelltext-Pin (Muster
   * `theme/seitenrinne.guard.test.ts`). Der Trenner davor darf NICHT mit verschwinden: er ist
   * der Chevron vor dem Titel.
   */
  it('blendet im Ortspfad genau den letzten EINTRAG aus, nicht den Trenner davor', () => {
    const regel = seiteCss.match(/([^{}]+)\{\s*display:\s*none;\s*\}/);
    expect(regel, 'EinsatzSeite.css trägt die Ausblendregel').not.toBeNull();
    const selektor = regel![1].trim();
    expect(selektor).toContain('.lfh-seitenkopf__pfad');
    expect(selektor).toContain('li:last-child');
    expect(selektor).toContain(':not(.ant-breadcrumb-separator)');
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
 * Die ERSTE seitenweite Tastatur-Ebene des Repos (LFH-391 · B5) — die vier bisherigen
 * Registrierungen (Datensicht, Erfassung, EtbPage, KatalogTabelle) haben alle schmale
 * Wurzeln. Genau dafür ist die Kette aus B1 gebaut: eine flache Seitenebene über den
 * tiefen Werkzeugleisten.
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
    // Seitenebene. (Ohne Fokus im Baum trüge der Anzeige-Fallback aus B1 sie ebenfalls —
    // dann prüfte dieser Test aber den Fallback statt die Registrierung.)
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
   * Eine Werkzeugleiste tief IN der Seite — die Bauform, die es im Bestand vierfach gibt
   * (Datensicht, Erfassung, EtbPage, KatalogTabelle). Sie ist hier der Zeuge dafür, dass
   * die Seitenebene ohne `neueZeile` gar nicht erst entsteht.
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
   * Der `aktiv`-Riegel — und ausdrücklich NICHT über „die Option `neue-zeile` fehlt"
   * geprüft: das garantiert schon `verschmelzeAktionen` (ein `undefined`-Schlüssel ist
   * keine Belegung), weshalb die Mutation `aktiv: true` den Test darüber grün lässt.
   *
   * Sichtbar wird der Riegel am Anzeige-FALLBACK: die Seitenwurzel umspannt die ganze
   * Seite, eine registrierte Seitenebene enthält den Fokus also fast immer — und eine
   * nicht-leere Kette verdrängt den Fallback. Ohne Riegel bliebe die Gruppe „Aktionen"
   * auf jeder Detailseite ohne Anlegen-Aktion leer, obwohl die Werkzeugleiste darunter
   * etwas anzubieten hat.
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

    // Fokus IN der Seite, aber ausserhalb der Werkzeugzeile: genau die Lage, in der eine
    // (leere) Seitenebene die Kette belegen würde.
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

    // Positivhälfte: die Palette steht wirklich offen und rendert Optionen. Ohne sie wäre
    // das `null` unten nur der Beleg, dass gar nichts auf ist.
    await waitFor(() => expect(document.getElementById('cmd-modul:etb')).not.toBeNull());
    expect(document.getElementById('cmd-tastatur:neue-zeile')).toBeNull();
  });
});
