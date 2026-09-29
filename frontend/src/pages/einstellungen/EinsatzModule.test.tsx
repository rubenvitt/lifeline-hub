import { screen, fireEvent, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { Route, Routes } from 'react-router';
import { renderMitProviders } from '../../test/utils';
import EinsatzModule from './EinsatzModule';

/** Sektion „Module": die Liste speichert je Zeile sofort und hat deshalb keine Speicher-Leiste. */

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
    // Switch-Test allein ändert nur die andere Spalte.
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
    // Führungspersonal darf die Einstellungen schreiben, die Modul-Sichtbarkeit aber nicht
    // (Backend-Gate einsatzleitung|admin). Die beiden Rechte-Achsen dürfen nicht verschmelzen.
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

  // Der Grund steht zusätzlich an jeder gesperrten Zeile — mit dem Wort der Ursache.
  it('nennt an der Zeile die Rolle als Sperrgrund, solange der Einsatz läuft', async () => {
    benutzerRolle.wert = 'benutzer';
    vi.mocked(ladeEinsatz).mockResolvedValue({
      id: 1,
      bezeichnung: 'Lage',
      status: 'aktiv',
      meine_rolle: 'fuehrungspersonal',
    } as never);

    rendern();

    const zeile = (await screen.findByText('ETB')).closest('[data-modul-zeile]') as HTMLElement;
    expect(within(zeile).getByText('nur Einsatzleitung')).toBeInTheDocument();
  });

  // `darfEinsatzLeiten` verlangt einen aktiven Einsatz; ein abgeschlossener sperrt auch die
  // Einsatzleitung. Ein Rollenwort widerspräche dort dem Seitenbanner.
  it('nennt im abgeschlossenen Einsatz den Abschluss, nicht die Rolle', async () => {
    vi.mocked(ladeEinsatz).mockResolvedValue({
      id: 1,
      bezeichnung: 'Lage',
      status: 'abgeschlossen',
      meine_rolle: 'einsatzleitung',
    } as never);

    rendern();

    const zeile = (await screen.findByText('ETB')).closest('[data-modul-zeile]') as HTMLElement;
    expect(within(zeile).getByText('Einsatz abgeschlossen')).toBeInTheDocument();
    expect(within(zeile).queryByText('nur Einsatzleitung')).toBeNull();
  });

  it('zeigt bei nicht ladbaren Overrides KEINE Liste — sonst loegen die Bestandswerte', async () => {
    // Ohne diesen Zweig zeigte `overrides ?? {}` alle Module als „sichtbar, keine Rolle", und der
    // nächste Schalterklick schickte das als Bestandswert in den Vollersatz-PUT.
    vi.mocked(ladeModulOverrides).mockRejectedValue(new ApiError(500, 'kaputt'));

    rendern();

    expect(await screen.findByText(/nicht ladbar/)).toBeInTheDocument();
    expect(screen.queryByRole('switch', { name: 'Sichtbar: ETB' })).toBeNull();
  });

  it('hinterlässt nach fünf Schaltvorgängen in Folge EINE Meldung, nicht fünf (LFH-478)', async () => {
    rendern();
    await screen.findByRole('switch', { name: 'Sichtbar: ETB' });
    const schalter = screen.getAllByRole('switch').filter((s) => !s.hasAttribute('disabled'));
    expect(schalter.length).toBeGreaterThanOrEqual(5);

    for (const [i, s] of schalter.slice(0, 5).entries()) {
      fireEvent.click(s);
      await waitFor(() => expect(setzeModulOverride).toHaveBeenCalledTimes(i + 1));
    }

    await waitFor(() => expect(document.querySelectorAll('.ant-message-notice')).toHaveLength(1));
    expect(screen.getByText('Modul-Einstellung gespeichert')).toBeInTheDocument();
  });

  it('nennt einen gescheiterten Zeilen-Schreibversuch dauerhaft auf der Seite (H14)', async () => {
    vi.mocked(setzeModulOverride).mockRejectedValue(new ApiError(409, 'Modul gesperrt'));

    rendern();
    fireEvent.click(await screen.findByRole('switch', { name: 'Sichtbar: ETB' }));

    // Die Abwesenheit des Message-Containers ist die Aussage: `renderMitProviders` hüllt in
    // `<AntApp>`, ein `message.error` fände `findByText` also genauso.
    const treffer = await screen.findByText('Modul gesperrt');
    expect(treffer.closest('.ant-message')).toBeNull();
  });
});

/**
 * Gruppierung und Filterfeld von `ModulEinstellungsListe` gelten hier genauso. Kein Verlassen-Guard
 * und keine Speicherleiste — es gibt keine Fassung, die verloren gehen kann.
 */
describe('EinsatzModule · Gruppierung und Filter (LFH-346)', () => {
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

  it('gruppiert und filtert die Modulzeilen', async () => {
    rendern();

    expect(await screen.findByRole('heading', { name: 'Kräfte & Mittel' })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Modul filtern'), { target: { value: 'chat' } });

    expect(screen.getByRole('switch', { name: 'Sichtbar: Chat' })).toBeInTheDocument();
    expect(screen.queryByRole('switch', { name: 'Sichtbar: ETB' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Kräfte & Mittel' })).toBeNull();
  });

  it('warnt NICHT beim Verlassen — jede Zeile ist bereits gespeichert', async () => {
    rendern();
    fireEvent.click(await screen.findByRole('switch', { name: 'Sichtbar: ETB' }));
    await waitFor(() => expect(setzeModulOverride).toHaveBeenCalled());

    const e = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(false);
  });
});
