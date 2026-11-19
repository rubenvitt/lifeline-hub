import { describe, expect, it, vi } from 'vitest';
import type { Person } from '../api/types';
import { renderMitProviders } from '../test/utils';
import { farbenHell } from '../theme/tokens';
import ZeilenSichtung from './ZeilenSichtung';

const rueckmeldung = { beginne: vi.fn(), melde: vi.fn(), hold: vi.fn() };

function person(kategorie: string | null) {
  return { id: 5, name: 'Anna', aktuelle_sichtung: kategorie } as unknown as Person;
}

describe('ZeilenSichtung — Rahmen heißt bedienbar (LLH-1780, D6)', () => {
  it('eine gesetzte Sichtung ist ein Knopf mit Rahmen und Pfeil um das BBK-Feld', () => {
    renderMitProviders(
      <ZeilenSichtung p={person('sk2')} einsatzId={7} rueckmeldung={rueckmeldung} />,
    );
    const knopf = document.querySelector<HTMLElement>('[data-lfh="sichtung-ausloeser"]')!;
    expect(knopf).toHaveStyle({ borderColor: farbenHell.steuerRahmen });
    expect(knopf.querySelector('[data-lfh="status-pfeil"]')).toHaveTextContent('▾');
  });

  it('ohne Sichtung bleibt es der Link „Sichten“, ohne Rahmen', () => {
    renderMitProviders(
      <ZeilenSichtung p={person(null)} einsatzId={7} rueckmeldung={rueckmeldung} />,
    );
    expect(document.querySelector('[data-lfh="sichtung-ausloeser"]')).toHaveTextContent('Sichten');
    expect(document.querySelector('[data-lfh="status-pfeil"]')).toBeNull();
  });
});
