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

  it('steht vor den Aktionen — sonst bräche er bei 390 px in eine eigene Zeile', () => {
    setzeViewportBreite(390);
    const { container } = zeige([{ key: 'csv', label: 'CSV exportieren', onWahl: vi.fn() }]);
    const kopf = container.querySelector<HTMLElement>('[data-lfh="seitenkopf-aktionen"]')!;
    const knoepfe = within(kopf).getAllByRole('button');
    expect(knoepfe.map((k) => k.getAttribute('aria-label') ?? k.textContent)).toEqual([
      NAME,
      'Betroffene erfassen',
    ]);
  });

  it('sperrt bei einem laufenden Nebenweg nur dessen Eintrag, nicht den Auslöser', async () => {
    setzeViewportBreite(390);
    const druck = vi.fn();
    zeige([
      { key: 'druck', label: 'Drucken / als PDF', onWahl: druck },
      { key: 'csv', label: 'CSV exportieren', onWahl: vi.fn(), laeuft: true },
    ]);
    const ausloeser = screen.getByRole('button', { name: NAME });
    expect(ausloeser).not.toHaveClass('ant-btn-loading');
    await userEvent.click(ausloeser);
    await waitFor(() => expect(offenesMenue()).not.toBeNull());
    expect(
      within(offenesMenue()).getByRole('menuitem', { name: 'CSV exportieren (läuft …)' }),
    ).toHaveAttribute('aria-disabled', 'true');
    await userEvent.click(
      within(offenesMenue()).getByRole('menuitem', { name: 'Drucken / als PDF' }),
    );
    expect(druck).toHaveBeenCalledTimes(1);
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

describe('EinsatzSeite — gesperrter Nebenweg und Sprung (LFH-1079)', () => {
  const eintraege: readonly Nebenweg[] = [
    {
      key: 'etb',
      label: 'Zum ETB-Eintrag',
      ziel: '/einsaetze/1/etb?eintrag=42',
      sprung: true,
      onWahl: vi.fn(),
    },
    {
      key: 'druck',
      label: 'Drucken / als PDF (Organisation nicht geladen)',
      gesperrt: true,
      onWahl: vi.fn(),
    },
  ];

  it('ab md: der Sprung ist ein Link mit „↗“, der gesperrte Weg ein gesperrter Knopf', () => {
    setzeViewportBreite(1180);
    const { container } = zeige(eintraege);
    const kopf = container.querySelector<HTMLElement>('[data-lfh="seitenkopf-aktionen"]')!;
    const sprung = within(kopf).getByRole('link', { name: 'Zum ETB-Eintrag' });
    expect(sprung).toHaveTextContent('Zum ETB-Eintrag ↗');
    expect(sprung).toHaveAttribute('href', '/einsaetze/1/etb?eintrag=42');
    expect(
      within(kopf).getByRole('button', { name: 'Drucken / als PDF (Organisation nicht geladen)' }),
    ).toBeDisabled();
  });

  it('unter md: der gesperrte Weg ist ein gesperrter Eintrag, der Sprung ohne „↗“ im Namen', async () => {
    setzeViewportBreite(390);
    const druck = eintraege[1].onWahl as ReturnType<typeof vi.fn>;
    zeige(eintraege);
    await userEvent.click(screen.getByRole('button', { name: NAME }));
    await waitFor(() => expect(offenesMenue()).not.toBeNull());
    const menue = offenesMenue();
    expect(within(menue).getByRole('menuitem', { name: 'Zum ETB-Eintrag' })).toBeInTheDocument();
    const gesperrt = within(menue).getByRole('menuitem', {
      name: 'Drucken / als PDF (Organisation nicht geladen)',
    });
    expect(gesperrt).toHaveAttribute('aria-disabled', 'true');
    await userEvent.click(gesperrt);
    expect(druck).not.toHaveBeenCalled();
  });
});
