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
import EinsatzSeite from './EinsatzSeite';

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
    // Signatur-Element 1 aus A0: der Akzentstrich steht über dem Titel.
    expect(container.querySelector('.lfh-marke__strich')).not.toBeNull();
  });

  it('hält die Container-Breite auf `flaeche.seiteSchmal` und lässt sie überschreiben', () => {
    // `renderMitProviders` legt eine `.ant-app`-Hülle um den Baum — die Wurzel des
    // Primitivs ist deren erstes Kind, nicht `container.firstElementChild`.
    const wurzel = (c: HTMLElement) => c.querySelector<HTMLElement>('.ant-app > div')!;

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
