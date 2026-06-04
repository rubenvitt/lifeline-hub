import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { renderMitProviders } from '../test/utils';
import ModulPanel from './ModulPanel';
import type { ModulEintrag } from './modulRegistry';
import type { BenutzerAnzeige } from '../api/types';

const ohne: BenutzerAnzeige = {
  id: 1, anzeigename: 'E', benutzername: 'e', system_rolle: 'keiner',
  org_rolle: 'keine', aktiv: true, erstellt_at: '2026-05-23 10:00:00',
};

const basis = (over: Partial<ModulEintrag>): ModulEintrag => ({
  key: 'k', kategorie: 'erfassung', label: 'L', icon: () => null, route: 'k', status: 'geplant', ...over,
});

const module: ModulEintrag[] = [
  basis({ key: 'etb', label: 'ETB', route: 'etb', status: 'fertig' }),
  basis({ key: 'sach', label: 'Sachschäden', route: 'sach', status: 'wip' }),
  basis({ key: 'geheim', label: 'Geheim', route: 'geheim', benoetigteRolle: 'admin' }),
];

describe('ModulPanel', () => {
  it('listet Module, markiert WIP, sperrt rollengeschuetzte', () => {
    renderMitProviders(
      <ModulPanel
        titel="Erfassung" module={module} benutzer={ohne}
        aktiverModulKey="etb" onModulKlick={() => {}}
      />,
    );
    expect(screen.getByText('Erfassung')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /ETB/ })).toBeEnabled();
    expect(screen.getByRole('button', { name: /Sachschäden/ })).toBeEnabled();
    expect(screen.getByText(/🚧/)).toBeInTheDocument();
    const geheim = screen.getByRole('button', { name: /Geheim/ });
    expect(geheim).toBeDisabled();
    expect(screen.getByText(/🔒/)).toBeInTheDocument();
  });

  it('markiert ein Deep-Link-Modul mit Hinweis-Symbol', () => {
    renderMitProviders(
      <ModulPanel
        titel="Lage"
        module={[basis({ key: 'gefahrenzonen', label: 'Gefahren-/Absperrzonen', route: 'gefahrenzonen', status: 'fertig', verweistAuf: 'lagekarte' })]}
        benutzer={ohne}
        aktiverModulKey={null}
        onModulKlick={() => {}}
      />,
    );
    expect(screen.getByTitle('Öffnet in der Lagekarte')).toBeInTheDocument();
  });

  it('meldet Klick auf ein freies Modul', async () => {
    const onKlick = vi.fn();
    renderMitProviders(
      <ModulPanel
        titel="Erfassung" module={module} benutzer={ohne}
        aktiverModulKey={null} onModulKlick={onKlick}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: /ETB/ }));
    expect(onKlick).toHaveBeenCalledWith(expect.objectContaining({ key: 'etb' }));
  });
});
