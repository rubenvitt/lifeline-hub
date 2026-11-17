import { describe, expect, it } from 'vitest';
import { isValidElement, type ReactElement } from 'react';
import type { RouteObject } from 'react-router';
import { appRouten } from './App';
import AppLayout from './components/AppLayout';
import AdminLayout from './admin/AdminLayout';
import EinsatzLayout from './einsatz/EinsatzLayout';
import GeraeteLayout, { GeraetEinsatzRahmen } from './geraet/GeraeteLayout';
import Fehlergrenze, { type FehlergrenzeRahmen } from './components/Fehlergrenze';

/**
 * WÄCHTER (LLH-1822, Change `a12ms7g9-seitenzustaende` 2.2, D1; `frontend/AGENTS.md`, Rahmen,
 * „Jede Rahmenebene hat eine Fehlergrenze“): Unter jeder Rahmenroute liegt genau EINE pfadlose
 * Kindroute mit `errorElement`, und sie umschließt alle Seiten des Rahmens. Wirft eine Seite,
 * zeichnet der Router die Grenze im `<Outlet/>` des Rahmens, und der Rahmen bleibt stehen. An der
 * obersten Route hängt das letzte Netz. Ein neuer Rahmen kommt mit seiner Grenze in diese Liste.
 */

const RAHMEN: { name: string; layout: unknown; rahmen: FehlergrenzeRahmen }[] = [
  { name: 'EinsatzLayout', layout: EinsatzLayout, rahmen: 'einsatz' },
  { name: 'AppLayout', layout: AppLayout, rahmen: 'ebene1' },
  { name: 'AdminLayout', layout: AdminLayout, rahmen: 'verwaltung' },
  { name: 'GeraeteLayout', layout: GeraeteLayout, rahmen: 'geraet' },
  { name: 'GeraetEinsatzRahmen', layout: GeraetEinsatzRahmen, rahmen: 'geraet' },
];

function alleRouten(routen: RouteObject[]): RouteObject[] {
  return routen.flatMap((r) => [r, ...alleRouten(r.children ?? [])]);
}

function elementTyp(element: RouteObject['element']): unknown {
  return isValidElement(element) ? element.type : undefined;
}

/** Der Rahmen einer `Fehlergrenze` als `errorElement`, sonst `null`. */
function grenzeVon(route: RouteObject): FehlergrenzeRahmen | null {
  const e = route.errorElement;
  if (!isValidElement(e) || e.type !== Fehlergrenze) return null;
  return (e as ReactElement<{ rahmen: FehlergrenzeRahmen }>).props.rahmen;
}

describe('Fehlergrenze an jeder Rahmenroute (Wächter)', () => {
  const routen = alleRouten(appRouten);

  for (const { name, layout, rahmen } of RAHMEN) {
    it(`${name}: genau eine pfadlose Kindroute mit Grenze „${rahmen}“ umschließt alle Seiten`, () => {
      const treffer = routen.filter((r) => elementTyp(r.element) === layout);
      expect(treffer, `${name} steht genau einmal im Routenbaum`).toHaveLength(1);
      const [route] = treffer;
      expect(route.errorElement, `${name}: die Grenze gehört unter den Rahmen`).toBeUndefined();

      const kinder = route.children ?? [];
      expect(kinder, `${name}: alle Seiten unter der einen Grenze`).toHaveLength(1);
      const [grenze] = kinder;
      expect(grenze.path).toBeUndefined();
      expect(grenze.index).not.toBe(true);
      expect(grenze.element).toBeUndefined();
      expect(grenzeVon(grenze)).toBe(rahmen);
      expect(grenze.children?.length ?? 0).toBeGreaterThan(0);
    });
  }

  it('die oberste Route trägt das letzte Netz', () => {
    expect(appRouten).toHaveLength(1);
    expect(grenzeVon(appRouten[0])).toBe('wurzel');
  });

  it('außer diesen sechs trägt keine Route ein errorElement', () => {
    const mitGrenze = routen.filter((r) => r.errorElement != null);
    expect(mitGrenze).toHaveLength(RAHMEN.length + 1);
  });
});
