import { describe, expect, it } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderMitProviders } from '../test/utils';
import { dichten } from '../theme/tokens';
import AnhangVorschau, { AnhangVorschauGruppe, vorschauKachelStil } from './AnhangVorschau';

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
    const img = screen.getByRole('button', { name: /^Vorschau: dach\.jpg/ }).querySelector('img')!;
    fireEvent.error(img);
    expect(screen.queryByRole('button', { name: /^Vorschau/ })).not.toBeInTheDocument();
    const platzhalter = screen.getByRole('img', { name: 'Keine Vorschau: dach.jpg' });
    expect(platzhalter).toHaveTextContent('JPG');
    expect(platzhalter.style.width).toBe(platzhalter.style.height);
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

  it('fordert nie das Original an', () => {
    const { container } = renderMitProviders(
      <AnhangVorschau href={HREF} mime="image/webp" dateiname="foto.webp" />,
    );
    expect(container.innerHTML).not.toContain('fassung=original');
  });
});
