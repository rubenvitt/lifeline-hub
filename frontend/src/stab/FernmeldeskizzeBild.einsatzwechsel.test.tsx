import { act, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SkizzenLage } from '../api/fernmeldeskizzeVertrag';
import { abschnitt, daten, quellen } from '../test/fernmeldenetz';
import { renderMitProviders } from '../test/utils';
import { baueFernmeldenetz, type Fernmeldenetz, type NetzRechte } from './fernmeldeskizze';
import { RASTER, layoutFernmeldenetz } from './fernmeldeskizzeLayout';
import FernmeldeskizzeBild from './FernmeldeskizzeBild';
import type { SkizzenAktionen } from './skizzenAktionen';

/**
 * Einsatzwechsel bei stehender Seite (Review O6): die Route `stab/funkplan` hängt unter
 * `/einsaetze/:id` an einem Outlet ohne Schlüssel, die Seite bleibt beim Wechsel montiert. Was die
 * Fläche für EINEN Einsatz hält (eigene Lagen über dem Netz, bestätigte Versionen, Status, eigener
 * Befehlsstapel, Wahl), darf im nächsten nicht weiterleben.
 */

const ALLE: NetzRechte = { einsatzabschnitte: true, einheiten: true, verwaltung: true, stab: true };

function netz(einsatzId: number): Fernmeldenetz {
  return baueFernmeldenetz({
    ...quellen({ einsatzId, abschnitte: daten([abschnitt(1, { name: 'EA 1' })]) }),
    rechte: ALLE,
  });
}

function aktionenAttrappe() {
  return {
    // Die Antwort bleibt aus: die eigene Lage steht offen über dem Netz.
    verschiebe: vi.fn(() => new Promise<SkizzenLage>(() => {})),
    entferneLage: vi.fn(async () => {}),
    neuAnordnen: vi.fn(async () => {}),
    ordneZu: vi.fn(async () => {}),
    loese: vi.fn(async () => {}),
    legeVerbindungAn: vi.fn(),
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
}

const element = (key: string) =>
  document.querySelector<SVGGElement>(`[data-lfh="skizze-element"][data-key="${key}"]`);
const status = () => document.querySelector<HTMLElement>('[data-lfh="skizze-status"]')!;

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

describe('Fernmeldeskizze — Einsatzwechsel (Review O6)', () => {
  it('eine offene eigene Lage, Status und Rückgängig des alten Einsatzes stehen im neuen nicht', async () => {
    const user = userEvent.setup();
    const alt = netz(7);
    const x = layoutFernmeldenetz(alt).plaetze.get('ab-1')!.x;
    const aktionen = aktionenAttrappe();
    const props = { aktionen, einsatzbezeichnung: 'Großbrand Musterhausen' };
    const { rerender } = renderMitProviders(<FernmeldeskizzeBild {...props} netz={alt} />);
    act(() => element('ab-1')!.focus());
    await user.keyboard('{ArrowRight}');
    expect(aktionen.verschiebe).toHaveBeenCalledTimes(1);
    expect(element('ab-1')!.querySelector('rect')!.getAttribute('x')).toBe(String(x + RASTER));
    expect(status()).toHaveTextContent('Verschieben von EA 1 …');

    // Derselbe Schlüssel `ab-1` im anderen Einsatz: ein anderer Abschnitt.
    rerender(<FernmeldeskizzeBild {...props} netz={netz(8)} />);
    expect(element('ab-1')!.querySelector('rect')!.getAttribute('x')).toBe(String(x));
    expect(status()).not.toHaveTextContent('Verschieben');
    expect(screen.getByRole('button', { name: /Rückgängig/ })).toBeDisabled();
  });
});
