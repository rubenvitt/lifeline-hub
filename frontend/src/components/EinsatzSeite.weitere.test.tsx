import userEvent from '@testing-library/user-event';
import { screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Button } from 'antd';
import { renderMitProviders } from '../test/utils';
import { setzeViewportBreite, setzeViewportZurueck } from '../test/viewport';
import EinsatzSeite, { type Nebenweg } from './EinsatzSeite';

/**
 * Nebenwege im Seitenkopf (LFH-963, design.md D1): ab `md` je Nebenweg ein sekundärer Knopf,
 * unter `md` EIN Auslöser „Weitere“ mit allen Einträgen. Die Breiten stehen als Literale da
 * (390 = Handschirm, 1180 = Tablet quer); aus `useViewport` zurückgelesen prüfte die Weiche sich
 * selbst.
 *
 * `setzeViewportBreite` läuft VOR dem Render: antds Beobachter liest beim Abonnieren.
 */

afterEach(() => setzeViewportZurueck());

const NAME = 'Weitere Aktionen zu den Betroffenen';

function zeige(eintraege: readonly Nebenweg[]) {
  return renderMitProviders(
    <EinsatzSeite
      titel="Betroffene"
      aktionen={<Button type="primary">Betroffene erfassen</Button>}
      weitere={{ name: NAME, eintraege }}
    >
      <div>Inhalt</div>
    </EinsatzSeite>,
  );
}

function offenesMenue() {
  return document.querySelector<HTMLElement>(
    '.ant-dropdown:not(.ant-dropdown-hidden) [role="menu"]',
  )!;
}

describe('EinsatzSeite — Nebenwege ab md', () => {
  it('stehen als eigene Knöpfe im Kopf, ohne Auslöser „Weitere“', async () => {
    setzeViewportBreite(1180);
    const druck = vi.fn();
    const csv = vi.fn();
    const { container } = zeige([
      { key: 'druck', label: 'Drucken / als PDF', onWahl: druck, ziel: '/einsaetze/1/druck' },
      { key: 'csv', label: 'CSV exportieren', onWahl: csv },
    ]);
    const kopf = container.querySelector<HTMLElement>('[data-lfh="seitenkopf-aktionen"]')!;
    const druckKnopf = within(kopf).getByRole('link', { name: 'Drucken / als PDF' });
    // Link mit Knopfgestalt: Strg/⌘+Klick öffnet einen Tab, das Ziel steht als Adresse da.
    expect(druckKnopf).toHaveAttribute('href', '/einsaetze/1/druck');
    await userEvent.click(within(kopf).getByRole('button', { name: 'CSV exportieren' }));
    expect(csv).toHaveBeenCalledTimes(1);
    await userEvent.click(druckKnopf);
    expect(druck).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: NAME })).not.toBeInTheDocument();
    // Sekundär: die eine Primäraktion bleibt die der Seite.
    expect(kopf.querySelectorAll('.ant-btn-primary')).toHaveLength(1);
  });
});

describe('EinsatzSeite — Nebenwege unter md', () => {
  it('bündeln sich hinter EINEM Auslöser mit dem Namen der Seite', async () => {
    setzeViewportBreite(390);
    const druck = vi.fn();
    const csv = vi.fn();
    const { container } = zeige([
      { key: 'druck', label: 'Drucken / als PDF', onWahl: druck, ziel: '/einsaetze/1/druck' },
      { key: 'csv', label: 'CSV exportieren', onWahl: csv },
    ]);
    const kopf = container.querySelector<HTMLElement>('[data-lfh="seitenkopf-aktionen"]')!;
    // Die Erfassung bleibt sichtbar, die Nebenwege nicht.
    expect(within(kopf).getByRole('button', { name: 'Betroffene erfassen' })).toBeInTheDocument();
    expect(within(kopf).queryByText('Drucken / als PDF')).not.toBeInTheDocument();
    expect(within(kopf).queryByText('CSV exportieren')).not.toBeInTheDocument();

    const ausloeser = within(kopf).getByRole('button', { name: NAME });
    await userEvent.click(ausloeser);
    await waitFor(() => expect(offenesMenue()).not.toBeNull());
    const menue = offenesMenue();
    expect(within(menue).getByRole('menuitem', { name: 'Drucken / als PDF' })).toBeInTheDocument();
    await userEvent.click(within(menue).getByRole('menuitem', { name: 'CSV exportieren' }));
    expect(csv).toHaveBeenCalledTimes(1);
    expect(druck).not.toHaveBeenCalled();
  });

  it('zeigt einen laufenden Nebenweg am Auslöser', () => {
    setzeViewportBreite(390);
    zeige([{ key: 'csv', label: 'CSV exportieren', onWahl: vi.fn(), laeuft: true }]);
    expect(screen.getByRole('button', { name: NAME })).toHaveClass('ant-btn-loading');
  });
});

describe.each([
  ['ab md', 1180],
  ['unter md', 390],
])('EinsatzSeite — ohne Nebenweg, %s', (_lage, breite) => {
  it('kein Auslöser und kein Nebenwegknopf', () => {
    setzeViewportBreite(breite);
    const { container } = zeige([]);
    const kopf = container.querySelector<HTMLElement>('[data-lfh="seitenkopf-aktionen"]')!;
    expect(within(kopf).getAllByRole('button')).toHaveLength(1);
    expect(screen.queryByRole('button', { name: NAME })).not.toBeInTheDocument();
  });
});
