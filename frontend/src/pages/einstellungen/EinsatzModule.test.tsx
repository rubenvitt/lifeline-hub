import { screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { Route, Routes } from 'react-router';
import { renderMitProviders } from '../../test/utils';
import EinsatzModule from './EinsatzModule';

/**
 * Sektion „Module" (LFH-345 · C10, Befund H15). Die fachlichen Aussagen stammen aus dem
 * Bestandstest von `EinsatzEinstellungenPage` (LFH-132, Task 15) und sind unverändert gültig.
 *
 * Der Befund selbst ist die Trennung: die Liste speichert je Zeile SOFORT und stand bis dahin
 * unter einem Speichern-Knopf, der sie gar nicht betraf — zweierlei Bedienlogik unter einer
 * Überschrift. Diese Sektion hat deshalb bewusst KEINE Speicher-Leiste.
 */

const { benutzerRolle } = vi.hoisted(() => ({ benutzerRolle: { wert: 'admin' } }));

vi.mock('../../auth/AuthContext', () => ({
  useAuth: () => ({ benutzer: { id: 1, system_rolle: benutzerRolle.wert } }),
  AuthProvider: ({ children }: { children?: unknown }) => children,
}));

vi.mock('../../api/einsaetze', () => ({
  ladeEinsatz: vi.fn(),
  ladeEinstellungen: vi.fn(),
  ladeModulOverrides: vi.fn(),
  setzeModulOverride: vi.fn(),
}));

vi.mock('../../api/orgEinstellungen', () => ({
  ladeOrgModulEinstellungen: vi.fn(),
}));

import {
  ladeEinsatz,
  ladeEinstellungen,
  ladeModulOverrides,
  setzeModulOverride,
} from '../../api/einsaetze';
import { ladeOrgModulEinstellungen } from '../../api/orgEinstellungen';
import { ApiError } from '../../api/client';

const EINSTELLUNGEN = { einsatz_id: 1, org_defaults: { org_id: 1 } };

function rendern() {
  return renderMitProviders(
    <Routes>
      <Route path="/einsaetze/:id/einstellungen/module" element={<EinsatzModule />} />
    </Routes>,
    { route: '/einsaetze/1/einstellungen/module' },
  );
}

describe('EinsatzModule', () => {
  beforeEach(() => {
    vi.mocked(ladeEinsatz).mockResolvedValue({
      id: 1,
      bezeichnung: 'Lage',
      status: 'aktiv',
      meine_rolle: 'einsatzleitung',
    } as never);
    vi.mocked(ladeEinstellungen).mockResolvedValue(EINSTELLUNGEN as never);
    vi.mocked(ladeModulOverrides).mockResolvedValue({});
    vi.mocked(setzeModulOverride).mockResolvedValue({} as never);
    vi.mocked(ladeOrgModulEinstellungen).mockResolvedValue({});
    benutzerRolle.wert = 'admin';
  });

  it('zeigt die Modul-Sichtbarkeits-Sektion; nicht-ausblendbare Module sind gesperrt (LFH-132)', async () => {
    rendern();

    expect(await screen.findByText('Modul-Sichtbarkeit & Berechtigungen')).toBeInTheDocument();
    // Einsatzdaten lassen sich nicht ausblenden → Switch UND Rollen-Select deaktiviert.
    expect(screen.getByRole('switch', { name: 'Sichtbar: Einsatzdaten' })).toBeDisabled();
    expect(screen.getByRole('combobox', { name: 'Benötigte Rolle: Einsatzdaten' })).toBeDisabled();
    // ETB ist ausblendbar → Switch aktiv und (Default) eingeschaltet.
    const etbSwitch = screen.getByRole('switch', { name: 'Sichtbar: ETB' });
    expect(etbSwitch).toBeEnabled();
    expect(etbSwitch).toBeChecked();
  });

  it('speichert das Ausblenden eines Moduls sofort per PUT (LFH-132)', async () => {
    rendern();

    fireEvent.click(await screen.findByRole('switch', { name: 'Sichtbar: ETB' }));

    await waitFor(() =>
      expect(setzeModulOverride).toHaveBeenCalledWith(1, 'etb', {
        sichtbar: false,
        benoetigte_rolle: null,
      }),
    );
  });

  it('laesst beim Aendern der Rolle die Sichtbarkeit als Bestandswert mitfahren (Vollersatz-PUT)', async () => {
    // Ohne den Bestandswert würde eine reine Rollen-Änderung das Ausblenden nullen — der
    // Switch-Test allein deckt das nicht ab (er ändert nur die andere Spalte).
    vi.mocked(ladeModulOverrides).mockResolvedValue({
      etb: { sichtbar: false, benoetigte_rolle: null },
    } as never);

    rendern();

    fireEvent.mouseDown(await screen.findByRole('combobox', { name: 'Benötigte Rolle: ETB' }));
    fireEvent.click(await screen.findByText('Admin'));

    await waitFor(() =>
      expect(setzeModulOverride).toHaveBeenCalledWith(1, 'etb', {
        sichtbar: false,
        benoetigte_rolle: 'admin',
      }),
    );
  });

  it('zeigt den Org-Rollen-Hinweis im Modul-Override', async () => {
    vi.mocked(ladeOrgModulEinstellungen).mockResolvedValue({ etb: 'fuehrungskraft' });

    rendern();

    expect(await screen.findByText('Org: Führungskraft')).toBeInTheDocument();
  });

  it('traegt KEINE Speicher-Leiste — jede Zeile speichert sofort (H15)', async () => {
    rendern();

    await screen.findByText('Modul-Sichtbarkeit & Berechtigungen');
    // Die Gegenaussage zu den drei Formular-Sektionen: hier gibt es nichts einzureichen.
    expect(screen.queryByRole('button', { name: 'Speichern' })).toBeNull();
  });

  it('erklaert das strengere Recht — Modul-Overrides darf nur die Einsatzleitung (M16)', async () => {
    // Führungspersonal darf die Einstellungen schreiben, die Modul-Sichtbarkeit aber NICHT
    // (Backend-Gate einsatzleitung|admin). Die beiden Rechte-Achsen dürfen beim Aufteilen
    // der Seite nicht verschmelzen.
    benutzerRolle.wert = 'benutzer';
    vi.mocked(ladeEinsatz).mockResolvedValue({
      id: 1,
      bezeichnung: 'Lage',
      status: 'aktiv',
      meine_rolle: 'fuehrungspersonal',
    } as never);

    rendern();

    expect(await screen.findByText(/Nur die Einsatzleitung/)).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Sichtbar: ETB' })).toBeDisabled();
  });

  it('zeigt bei nicht ladbaren Overrides KEINE Liste — sonst loegen die Bestandswerte', async () => {
    // Ohne diesen Zweig zeigte `overrides ?? {}` alle Module als „sichtbar, keine Rolle" —
    // und der naechste Schalterklick schickte genau das als Bestandswert in den
    // Vollersatz-PUT. Eine gepflegte Rollenschranke waere weg, ohne jede Fehlermeldung.
    vi.mocked(ladeModulOverrides).mockRejectedValue(new ApiError(500, 'kaputt'));

    rendern();

    expect(await screen.findByText(/nicht ladbar/)).toBeInTheDocument();
    expect(screen.queryByRole('switch', { name: 'Sichtbar: ETB' })).toBeNull();
  });

  it('nennt einen gescheiterten Zeilen-Schreibversuch dauerhaft auf der Seite (H14)', async () => {
    vi.mocked(setzeModulOverride).mockRejectedValue(new ApiError(409, 'Modul gesperrt'));

    rendern();
    fireEvent.click(await screen.findByRole('switch', { name: 'Sichtbar: ETB' }));

    // Die Abwesenheit des Message-Containers IST die Aussage — ohne sie waere der Test eine
    // Attrappe: `renderMitProviders` huellt in `<AntApp>` (`test/utils.tsx`), ein
    // `message.error` rendert also INNERHALB des RTL-Containers und `findByText` faende es
    // genauso. Mit zurueckgedrehtem `onError`-Toast bliebe der Test dann gruen und koennte
    // den Befund, fuer den er existiert, nicht widerlegen.
    const treffer = await screen.findByText('Modul gesperrt');
    expect(treffer.closest('.ant-message')).toBeNull();
  });
});
