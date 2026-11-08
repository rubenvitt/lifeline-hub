import { describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderMitProviders } from '../test/utils';
import { KontextMenue, type KontextMenueOffen } from './KontextMenue';
import type { MenueEintrag } from './MenueAusloeser';
import {
  PRIMAER_SCHLUESSEL,
  fuehreKontextWahlAus,
  kontextEintraege,
  kontextName,
} from './datensichtKontext';
import type { PrimaerAktion, WeitereAktionen } from './Datensicht';

const offenesMenue = () =>
  document.querySelector<HTMLElement>('.ant-dropdown:not(.ant-dropdown-hidden) [role="menu"]');

const EINTRAEGE: MenueEintrag[] = [
  { key: 'menge', label: 'Menge ändern …' },
  { key: 'stornieren', label: 'Stornieren', gefahr: true },
  { key: 'aufteilen', label: 'Aufteilen · Rest 1', gesperrt: true },
];

function MitZustand(props: { onWahl: (k: string) => void; ursprung: HTMLElement }) {
  const [offen, setOffen] = useState<KontextMenueOffen | null>({
    anker: { x: 30, y: 40 },
    vorherFokus: props.ursprung,
  });
  return (
    <div onClick={() => props.onWahl('UMGEBUNG')}>
      <KontextMenue
        offen={offen}
        eintraege={EINTRAEGE}
        zugaenglicherName="Aktionen zu Stromerzeuger"
        onWahl={props.onWahl}
        onSchliessen={() => setOffen(null)}
      />
    </div>
  );
}

function aufbau() {
  const ursprung = document.createElement('a');
  ursprung.href = '/x';
  ursprung.textContent = 'Titel';
  document.body.appendChild(ursprung);
  ursprung.focus();
  const onWahl = vi.fn();
  renderMitProviders(<MitZustand onWahl={onWahl} ursprung={ursprung} />);
  return { onWahl, ursprung };
}

describe('KontextMenue (LLH-1596, D6)', () => {
  it('zeigt die Einträge wie das ⋮-Menü: Gefahr hinter einem Trenner, gesperrt deaktiviert, Fokus im Menü', async () => {
    aufbau();
    await waitFor(() => expect(offenesMenue()).not.toBeNull());
    const menue = offenesMenue()!;
    expect(menue).toHaveAttribute('aria-label', 'Aktionen zu Stromerzeuger');
    const eintraege = within(menue).getAllByRole('menuitem');
    expect(eintraege.map((e) => e.textContent)).toEqual([
      'Menge ändern …',
      'Aufteilen · Rest 1',
      'Stornieren',
    ]);
    expect(menue.querySelectorAll('.ant-dropdown-menu-item-divider')).toHaveLength(1);
    expect(eintraege[2]).toHaveClass('ant-dropdown-menu-item-danger');
    expect(eintraege[1]).toHaveAttribute('aria-disabled', 'true');
    await waitFor(() => expect(menue.contains(document.activeElement)).toBe(true));
  });

  it('löst genau die gewählte Aktion aus, nicht die Umgebung, und gibt den Fokus zurück', async () => {
    const { onWahl, ursprung } = aufbau();
    await waitFor(() => expect(offenesMenue()).not.toBeNull());
    await userEvent.click(
      within(offenesMenue()!).getByRole('menuitem', { name: 'Menge ändern …' }),
    );
    expect(onWahl).toHaveBeenCalledTimes(1);
    expect(onWahl).toHaveBeenCalledWith('menge');
    await waitFor(() => expect(document.activeElement).toBe(ursprung));
  });

  it('Escape schließt ohne Wahl und gibt den Fokus an das Ursprungselement', async () => {
    const { onWahl, ursprung } = aufbau();
    await waitFor(() => expect(offenesMenue()?.contains(document.activeElement)).toBe(true));
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(offenesMenue()).toBeNull());
    expect(onWahl).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(ursprung);
  });

  it('zeigt ohne Einträge kein Menü', () => {
    renderMitProviders(
      <KontextMenue
        offen={{ anker: { x: 1, y: 1 }, vorherFokus: null }}
        eintraege={[]}
        zugaenglicherName="x"
        onWahl={vi.fn()}
        onSchliessen={vi.fn()}
      />,
    );
    expect(document.querySelector('[data-lfh="datensatz-kontextmenue-anker"]')).toBeNull();
  });
});

interface Zeile {
  id: number;
  name: string;
  schreibbar: boolean;
}
const ZEILE: Zeile = { id: 1, name: 'Stromerzeuger', schreibbar: true };

function primaer(extra: Partial<PrimaerAktion<Zeile>> = {}): PrimaerAktion<Zeile> {
  return { etikett: 'Aus dem Einsatz nehmen', onKlick: vi.fn(), ...extra };
}
function weitere(extra: Partial<WeitereAktionen<Zeile>> = {}): WeitereAktionen<Zeile> {
  return {
    eintraege: () => EINTRAEGE.slice(0, 2),
    zugaenglicherName: (z) => `Weitere Aktionen zu ${z.name}`,
    onWahl: vi.fn(),
    ...extra,
  };
}

describe('kontextEintraege (D6)', () => {
  it('Primäraktion vor den ⋮-Einträgen', () => {
    expect(kontextEintraege({ aktion: primaer(), weitere: weitere() }, ZEILE)).toEqual([
      { key: PRIMAER_SCHLUESSEL, label: 'Aus dem Einsatz nehmen' },
      { key: 'menge', label: 'Menge ändern …' },
      { key: 'stornieren', label: 'Stornieren', gefahr: true },
    ]);
  });

  it('ohne sichtbare Primäraktion nur die ⋮-Einträge', () => {
    const aktion = primaer({ sichtbar: (z) => !z.schreibbar });
    expect(kontextEintraege({ aktion, weitere: weitere() }, ZEILE).map((e) => e.key)).toEqual([
      'menge',
      'stornieren',
    ]);
  });

  it('nur Primäraktion ergibt einen Eintrag', () => {
    expect(kontextEintraege({ aktion: primaer() }, ZEILE)).toHaveLength(1);
  });

  it('läuft eine Aktion, stehen die ⋮-Einträge gesperrt, die Primäraktion bleibt frei', () => {
    const e = kontextEintraege(
      { aktion: primaer(), weitere: weitere({ laeuft: () => true }) },
      ZEILE,
    );
    expect(e[0].gesperrt).toBeUndefined();
    expect(e.slice(1).every((x) => x.gesperrt)).toBe(true);
  });

  it('ohne Aktionen eine leere Liste', () => {
    expect(kontextEintraege({}, ZEILE)).toEqual([]);
    expect(kontextEintraege({ weitere: weitere({ eintraege: () => [] }) }, ZEILE)).toEqual([]);
  });

  it('der Name kommt vom ⋮-Auslöser', () => {
    expect(kontextName({ weitere: weitere() }, ZEILE)).toBe('Weitere Aktionen zu Stromerzeuger');
    expect(kontextName({ aktion: primaer() }, ZEILE)).toBe('Aktionen');
  });
});

describe('fuehreKontextWahlAus (D6)', () => {
  it('Primäraktion ohne Rückfrage löst sofort aus', () => {
    const aktion = primaer();
    const modal = { confirm: vi.fn() };
    fuehreKontextWahlAus({ aktion }, ZEILE, PRIMAER_SCHLUESSEL, modal);
    expect(aktion.onKlick).toHaveBeenCalledWith(ZEILE);
    expect(modal.confirm).not.toHaveBeenCalled();
  });

  it('Primäraktion mit Rückfrage fragt im Dialog mit Titel, Knopf und Gefahrfarbe, erst OK löst aus', () => {
    const aktion = primaer({
      bestaetigung: 'Stromerzeuger aus dem Einsatz nehmen?',
      bestaetigungKnopf: 'Aus Einsatz nehmen',
      bestaetigungGefahr: true,
    });
    const modal = { confirm: vi.fn() };
    fuehreKontextWahlAus({ aktion }, ZEILE, PRIMAER_SCHLUESSEL, modal);
    expect(aktion.onKlick).not.toHaveBeenCalled();
    expect(modal.confirm).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Stromerzeuger aus dem Einsatz nehmen?',
        okText: 'Aus Einsatz nehmen',
        okButtonProps: { danger: true },
      }),
    );
    modal.confirm.mock.calls[0][0].onOk();
    expect(aktion.onKlick).toHaveBeenCalledWith(ZEILE);
  });

  it('ohne eigenen Knopftext nennt der Bestätigungsknopf das Etikett, ohne Gefahr nicht rot', () => {
    const aktion = primaer({ bestaetigung: 'Wirklich?' });
    const modal = { confirm: vi.fn() };
    fuehreKontextWahlAus({ aktion }, ZEILE, PRIMAER_SCHLUESSEL, modal);
    const config = modal.confirm.mock.calls[0][0];
    expect(config.okText).toBe('Aus dem Einsatz nehmen');
    expect(config.okButtonProps).toBeUndefined();
  });

  it('andere Schlüssel gehen an `weitere.onWahl`', () => {
    const w = weitere();
    fuehreKontextWahlAus({ aktion: primaer(), weitere: w }, ZEILE, 'stornieren', {
      confirm: vi.fn(),
    });
    expect(w.onWahl).toHaveBeenCalledWith('stornieren', ZEILE);
  });
});
