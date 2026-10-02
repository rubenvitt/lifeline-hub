import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderMitProviders } from '../test/utils';
import { dichten } from '../theme/tokens';
import AnhangVorschau, { AnhangVorschauGruppe, vorschauKachelStil } from './AnhangVorschau';

// Der HEIC-Decoder (Worker + WASM) ist hier eine Attrappe; `geladen` zählt, ob das Modul
// überhaupt importiert wurde (es soll nur bei einem HEIC nachgeladen werden).
const heic = vi.hoisted(() => ({ geladen: 0, dekodiere: vi.fn() }));
vi.mock('../heic/dekodiereHeic', () => {
  heic.geladen += 1;
  return { dekodiereHeic: heic.dekodiere };
});

/**
 * Vorschaubild an Bild-Anhängen (LFH-759, Spec `anhang-vorschau`). Die Kantenlänge prüft die
 * reine Stilfunktion gegen die Dichtestufen (Muster `downloadAnkerStil`): `test/utils.tsx`
 * montiert ein nacktes `ConfigProvider`.
 */
describe('vorschauKachelStil (LFH-759)', () => {
  const tokenFuer = (stufe: keyof typeof dichten) => ({
    controlHeight: dichten[stufe].zeilenhoehe,
  });

  it('reserviert ein Quadrat in der Mindesthöhe der Dichte — 30 / 48 / 72 px', () => {
    for (const [stufe, kante] of [
      ['kompakt', 30],
      ['komfortabel', 48],
      ['handschuh', 72],
    ] as const) {
      const stil = vorschauKachelStil(tokenFuer(stufe));
      expect(stil.width).toBe(kante);
      expect(stil.height).toBe(kante);
      expect(stil.flexShrink).toBe(0);
    }
  });
});

const HREF = '/api/einsaetze/5/schaeden/3/anhaenge/9/datei';

describe('AnhangVorschau', () => {
  it('zeigt bei einem Foto das Vorschaubild vom Server', () => {
    renderMitProviders(
      <AnhangVorschau href={HREF} mime="image/jpeg" dateiname="dach.jpg" kennung="Schaden S-003" />,
    );
    const knopf = screen.getByRole('button', { name: 'Vorschau: dach.jpg, Schaden S-003' });
    const img = knopf.querySelector('img');
    expect(img).toHaveAttribute('src', `${HREF}?fassung=vorschau`);
    expect(img).toHaveAttribute('loading', 'lazy');
    expect(img).toHaveAttribute('alt', '');
  });

  it('zeigt bei einem PDF nichts', () => {
    renderMitProviders(
      <AnhangVorschau href={HREF} mime="application/pdf" dateiname="gutachten.pdf" />,
    );
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(document.querySelector('[data-lfh^="anhang-vorschau"]')).toBeNull();
  });

  it('zeigt bei einem Ladefehler einen Platzhalter gleicher Größe und bleibt still', () => {
    renderMitProviders(<AnhangVorschau href={HREF} mime="image/jpeg" dateiname="dach.jpg" />);
    const knopf = screen.getByRole('button', { name: /^Vorschau: dach\.jpg/ });
    const vorher = { breite: knopf.style.width, hoehe: knopf.style.height };
    expect(vorher.breite).toMatch(/^\d+px$/);
    fireEvent.error(knopf.querySelector('img')!);
    expect(screen.queryByRole('button', { name: /^Vorschau/ })).not.toBeInTheDocument();
    const platzhalter = screen.getByRole('img', { name: 'Keine Vorschau: dach.jpg' });
    expect(platzhalter).toHaveTextContent('JPG');
    expect({ breite: platzhalter.style.width, hoehe: platzhalter.style.height }).toEqual(vorher);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('öffnet die Großansicht in der App und gibt den Fokus zurück', async () => {
    const user = userEvent.setup();
    renderMitProviders(<AnhangVorschau href={HREF} mime="image/png" dateiname="plan.png" />);
    const knopf = screen.getByRole('button', { name: /^Vorschau: plan\.png/ });
    knopf.focus();
    await user.keyboard('{Enter}');
    const dialog = await screen.findByRole('dialog');
    const gross = within(dialog)
      .getAllByRole('img')
      .find((i) => i.getAttribute('src')?.includes('fassung=grossansicht'));
    expect(gross).toHaveAttribute('src', `${HREF}?fassung=grossansicht`);
    // Im Browser zieht die Fokusfalle den Fokus in die Überlagerung; jsdom tut das nicht.
    const schliessen = dialog.querySelector<HTMLElement>('.ant-image-preview-close');
    expect(schliessen).not.toBeNull();
    schliessen!.focus();
    expect(knopf).not.toHaveFocus();
    await user.keyboard('{Escape}');
    // jsdom beendet die Ausblend-Animation nie: geschlossen heißt hier „blendet aus“.
    await waitFor(() => expect(dialog.className).toMatch(/-leave/));
    await waitFor(() => expect(knopf).toHaveFocus());
  });

  it('blättert in einer Gruppe zwischen den Bildern', async () => {
    const user = userEvent.setup();
    renderMitProviders(
      <AnhangVorschauGruppe>
        <AnhangVorschau href="/a/1" mime="image/jpeg" dateiname="eins.jpg" />
        <AnhangVorschau href="/a/2" mime="application/pdf" dateiname="zwei.pdf" />
        <AnhangVorschau href="/a/3" mime="image/jpeg" dateiname="drei.jpg" />
      </AnhangVorschauGruppe>,
    );
    await user.click(screen.getByRole('button', { name: /^Vorschau: eins\.jpg/ }));
    const dialog = await screen.findByRole('dialog');
    const bildMit = (teil: string) =>
      within(dialog)
        .queryAllByRole('img')
        .some((i) => i.getAttribute('src') === teil);
    expect(bildMit('/a/1?fassung=grossansicht')).toBe(true);
    // rc-image liest `keyCode`, das user-event nicht setzt; ein Browser setzt es.
    fireEvent.keyDown(window, { key: 'ArrowRight', keyCode: 39 });
    await waitFor(() => expect(bildMit('/a/3?fassung=grossansicht')).toBe(true));
  });

  it('blättert in der Reihenfolge der Anzeige, auch wenn ein Bild später dazukommt', async () => {
    const user = userEvent.setup();
    const bilder = (namen: string[]) => (
      <AnhangVorschauGruppe>
        {namen.map((n) => (
          <AnhangVorschau key={n} href={`/a/${n}`} mime="image/jpeg" dateiname={`${n}.jpg`} />
        ))}
      </AnhangVorschauGruppe>
    );
    const { rerender } = renderMitProviders(bilder(['zwei', 'drei']));
    // Ein neues Bild erscheint oben (neueste zuerst), meldet sich aber als letztes an.
    rerender(bilder(['eins', 'zwei', 'drei']));
    await user.click(screen.getByRole('button', { name: /^Vorschau: zwei\.jpg/ }));
    const dialog = await screen.findByRole('dialog');
    const zeigt = (src: string) =>
      within(dialog)
        .queryAllByRole('img')
        .some((i) => i.getAttribute('src') === src);
    expect(zeigt('/a/zwei?fassung=grossansicht')).toBe(true);
    fireEvent.keyDown(window, { key: 'ArrowLeft', keyCode: 37 });
    await waitFor(() => expect(zeigt('/a/eins?fassung=grossansicht')).toBe(true));
  });

  it('trägt den Fokusring der Bedienfarbe über seine Klasse', () => {
    renderMitProviders(<AnhangVorschau href={HREF} mime="image/png" dateiname="plan.png" />);
    expect(screen.getByRole('button', { name: /^Vorschau: plan\.png/ })).toHaveClass(
      'lfh-anhang-vorschau',
    );
    const css = readFileSync(join(process.cwd(), 'src/theme/sprache.css'), 'utf8');
    expect(css).toMatch(
      /\.lfh-anhang-vorschau:focus-visible \{\s*outline: 2px solid var\(--lfh-bedien\)/,
    );
  });

  it('zeigt ohne Großansicht nur das Bild, ohne Bedienziel', () => {
    renderMitProviders(
      <AnhangVorschau href={HREF} mime="image/jpeg" dateiname="dach.jpg" grossansicht={false} />,
    );
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    const bild = screen.getByRole('img', { name: 'Vorschau: dach.jpg' });
    expect(bild.querySelector('img')).toHaveAttribute('src', `${HREF}?fassung=vorschau`);
  });

  it('fordert nie das Original an', () => {
    const { container } = renderMitProviders(
      <AnhangVorschau href={HREF} mime="image/webp" dateiname="foto.webp" />,
    );
    expect(container.innerHTML).not.toContain('fassung=original');
  });
});

describe('AnhangVorschau — HEIC auf dem Gerät (LFH-759)', () => {
  let beobachtet: Element[] = [];
  beforeEach(() => {
    beobachtet = [];
    // jsdom kennt keinen IntersectionObserver: dieser meldet jedes Element sofort als sichtbar.
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        constructor(private rueckruf: IntersectionObserverCallback) {}
        observe(el: Element) {
          beobachtet.push(el);
          this.rueckruf(
            [{ isIntersecting: true, target: el } as IntersectionObserverEntry],
            this as unknown as IntersectionObserver,
          );
        }
        disconnect() {}
        unobserve() {}
      },
    );
    let n = 0;
    vi.spyOn(URL, 'createObjectURL').mockImplementation(() => `blob:vorschau-${++n}`);
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    heic.dekodiere.mockReset();
  });

  const ETB = '/api/einsaetze/5/etb/40/anhaenge/9';

  it('dekodiert die bereinigte Fassung und zeigt das Ergebnis', async () => {
    heic.dekodiere.mockResolvedValue({ klein: new Blob(['k']), gross: new Blob(['g']) });
    renderMitProviders(
      <AnhangVorschau href={ETB} mime="image/heic" dateiname="IMG_0412.HEIC" kennung="Nr. 4" />,
    );
    const knopf = await screen.findByRole('button', { name: 'Vorschau: IMG_0412.HEIC, Nr. 4' });
    expect(knopf.querySelector('img')).toHaveAttribute('src', 'blob:vorschau-1');
    expect(heic.dekodiere).toHaveBeenCalledWith(ETB);
    expect(heic.dekodiere.mock.calls.flat().join()).not.toContain('fassung=original');
  });

  it('zeigt bei einem Decoder-Fehler still den Platzhalter', async () => {
    heic.dekodiere.mockRejectedValue(new Error('HEIC nicht dekodierbar'));
    renderMitProviders(<AnhangVorschau href={ETB} mime="image/heif" dateiname="scan.heif" />);
    expect(await screen.findByRole('img', { name: 'Keine Vorschau: scan.heif' })).toHaveTextContent(
      'HEIF',
    );
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('reserviert den Platz, solange dekodiert wird', () => {
    heic.dekodiere.mockReturnValue(new Promise(() => {}));
    renderMitProviders(<AnhangVorschau href={ETB} mime="image/heic" dateiname="IMG_1.HEIC" />);
    const platz = document.querySelector<HTMLElement>('[data-lfh="anhang-vorschau-laedt"]');
    expect(platz).not.toBeNull();
    expect(platz!.style.width).toBe(platz!.style.height);
  });

  it('dekodiert ein HEIC erst, wenn seine Kachel sichtbar wird', async () => {
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        observe() {}
        disconnect() {}
        unobserve() {}
      },
    );
    heic.dekodiere.mockResolvedValue({ klein: new Blob(['k']), gross: new Blob(['g']) });
    renderMitProviders(<AnhangVorschau href={ETB} mime="image/heic" dateiname="IMG_2.HEIC" />);
    // Der Decoder käme über `import()`, also asynchron: erst warten, dann prüfen.
    await new Promise((r) => setTimeout(r, 50));
    expect(document.querySelector('[data-lfh="anhang-vorschau-laedt"]')).not.toBeNull();
    expect(heic.dekodiere).not.toHaveBeenCalled();
  });

  it('bindet den Decoder nur über import() ein, nie statisch', () => {
    // Ein statischer Import zöge Worker-Glue und WASM-Verweis in jedes Bündel mit der Kachel.
    const quelle = readFileSync(join(process.cwd(), 'src/components/AnhangVorschau.tsx'), 'utf8');
    expect(quelle).toContain("import('../heic/dekodiereHeic')");
    expect(quelle).not.toMatch(/from '\.\.\/heic\//);
  });

  it('lädt den Decoder nicht, solange kein HEIC zu sehen ist', async () => {
    const vorher = heic.geladen;
    renderMitProviders(
      <AnhangVorschauGruppe>
        <AnhangVorschau href="/a/1" mime="image/jpeg" dateiname="dach.jpg" />
        <AnhangVorschau href="/a/2" mime="application/pdf" dateiname="plan.pdf" />
      </AnhangVorschauGruppe>,
    );
    await new Promise((r) => setTimeout(r, 50));
    expect(heic.geladen).toBe(vorher);
    expect(heic.dekodiere).not.toHaveBeenCalled();
  });
});
