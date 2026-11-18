import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Link, Outlet, Route, Routes, useLocation } from 'react-router';
import { afterEach, describe, expect, it } from 'vitest';
import { renderMitProviders } from '../test/utils';
import { modulAusPfad } from './modulRegistry';
import ModulWechselGerippe, { ModulGerippeSeite } from './ModulWechselGerippe';

/**
 * LLH-1838 (Spec `seiten-zustaende`, „Modulwechsel zeigt sofort Kopf und Gerippe“ und „Gerippe nur
 * beim Wechsel des Moduls“). Der Zwischenstand liegt in jsdom innerhalb eines `act`: das Gerippe
 * wird eingehängt und gleich wieder abgelöst. Deshalb zeichnet ein MutationObserver jedes
 * eingehängte Gerippe auf, statt den DOM danach abzufragen.
 */

let beobachter: MutationObserver | null = null;
afterEach(() => {
  beobachter?.disconnect();
  beobachter = null;
});

/** Zählt, wie oft ein Gerippe in `wurzel` eingehängt wurde, samt der Überschrift darin. */
function gerippeProtokoll(wurzel: HTMLElement) {
  const eingehaengt: string[] = [];
  beobachter = new MutationObserver((eintraege) => {
    for (const eintrag of eintraege) {
      eintrag.addedNodes.forEach((knoten) => {
        if (!(knoten instanceof HTMLElement)) return;
        const gerippe = knoten.matches('[data-testid="modul-gerippe"]')
          ? knoten
          : knoten.querySelector('[data-testid="modul-gerippe"]');
        if (gerippe) eingehaengt.push(gerippe.querySelector('h1')?.textContent ?? '');
      });
    }
  });
  beobachter.observe(wurzel, { childList: true, subtree: true });
  return eingehaengt;
}

function Rahmen() {
  const { pathname } = useLocation();
  return (
    <>
      <nav>
        <Link to="/einsaetze/7/ueberblick">zum Überblick</Link>
        <Link to="/einsaetze/7/personal">zu Personal</Link>
        <Link to="/einsaetze/7/personal/3">zur Einsatzkraft</Link>
        <Link to="/einsaetze/7/personal?filter=frei">Personal gefiltert</Link>
      </nav>
      <ModulWechselGerippe modul={modulAusPfad(pathname)}>
        <Outlet />
      </ModulWechselGerippe>
    </>
  );
}

function mitRahmen(route: string) {
  return renderMitProviders(
    <Routes>
      <Route path="/einsaetze/:id" element={<Rahmen />}>
        <Route path="ueberblick" element={<div>Überblick-Inhalt</div>} />
        <Route path="personal" element={<div>Personal-Liste</div>} />
        <Route path="personal/:epId" element={<div>Einsatzkraft-Seite</div>} />
      </Route>
    </Routes>,
    { route },
  );
}

describe('ModulWechselGerippe', () => {
  it('zeigt beim Wechsel in ein anderes Modul erst Kopf und Gerippe, dann die Seite', async () => {
    const { container } = mitRahmen('/einsaetze/7/ueberblick');
    expect(await screen.findByText('Überblick-Inhalt')).toBeInTheDocument();
    const protokoll = gerippeProtokoll(container);

    await userEvent.click(screen.getByRole('link', { name: 'zu Personal' }));

    expect(await screen.findByText('Personal-Liste')).toBeInTheDocument();
    expect(protokoll).toEqual(['Personal']);
    expect(screen.queryByTestId('modul-gerippe')).not.toBeInTheDocument();
    expect(screen.queryByText('Überblick-Inhalt')).not.toBeInTheDocument();
  });

  it('zeigt beim ersten Aufruf kein Gerippe vorab', async () => {
    const protokoll: string[] = [];
    const wurzel = document.body;
    beobachter = new MutationObserver((eintraege) => {
      for (const eintrag of eintraege) {
        eintrag.addedNodes.forEach((knoten) => {
          if (
            knoten instanceof HTMLElement &&
            (knoten.matches('[data-testid="modul-gerippe"]') ||
              knoten.querySelector('[data-testid="modul-gerippe"]'))
          )
            protokoll.push('gerippe');
        });
      }
    });
    beobachter.observe(wurzel, { childList: true, subtree: true });

    mitRahmen('/einsaetze/7/personal');

    expect(await screen.findByText('Personal-Liste')).toBeInTheDocument();
    expect(protokoll).toEqual([]);
  });

  it('zeigt bei einem Wechsel im selben Modul kein Gerippe', async () => {
    const { container } = mitRahmen('/einsaetze/7/personal');
    expect(await screen.findByText('Personal-Liste')).toBeInTheDocument();
    const protokoll = gerippeProtokoll(container);

    await userEvent.click(screen.getByRole('link', { name: 'zur Einsatzkraft' }));
    expect(await screen.findByText('Einsatzkraft-Seite')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('link', { name: 'Personal gefiltert' }));
    expect(await screen.findByText('Personal-Liste')).toBeInTheDocument();

    expect(protokoll).toEqual([]);
  });
});

describe('ModulGerippeSeite', () => {
  it('trägt den Modulnamen als h1 und ein verzögertes Gerippe', () => {
    const { container } = renderMitProviders(<ModulGerippeSeite modulKey="fahrzeuge" />);

    expect(screen.getByRole('heading', { level: 1, name: 'Fahrzeuge' })).toBeInTheDocument();
    expect(container.querySelector('.lfh-skelett--verzoegert')).not.toBeNull();
    expect(screen.queryByText(/wird geladen…/)).not.toBeInTheDocument();
  });
});
