import { QueryClient } from '@tanstack/react-query';
import { screen, fireEvent, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { Route, Routes } from 'react-router';
import { renderMitProviders } from '../../test/utils';
import EinsatzModule from './EinsatzModule';

/** Sektion „Module": die Liste speichert je Zeile sofort und hat deshalb keine Speicher-Leiste. */

const { benutzerRolle, benutzerOrg } = vi.hoisted(() => ({
  benutzerRolle: { wert: 'admin' },
  benutzerOrg: { wert: 1 },
}));

vi.mock('../../auth/AuthContext', () => ({
  useAuth: () => ({
    benutzer: { id: 1, system_rolle: benutzerRolle.wert, org_id: benutzerOrg.wert },
  }),
  AuthProvider: ({ children }: { children?: unknown }) => children,
}));

vi.mock('../../api/einsaetze', () => ({
  ladeEinsatz: vi.fn(),
  ladeEinstellungen: vi.fn(),
  ladeModulOverrides: vi.fn(),
  ladeModulFreigaben: vi.fn(),
  ladeModulVorgaben: vi.fn(),
  setzeModulOverride: vi.fn(),
}));

// Der Org-Endpunkt bleibt einer Einsatzleitung ohne Org-Rolle verschlossen; der Editor fragt ihn
// nicht mehr (LLH-1183).
vi.mock('../../api/orgEinstellungen', () => ({
  ladeOrgModulEinstellungen: vi.fn(),
}));

import {
  ladeEinsatz,
  ladeEinstellungen,
  ladeModulFreigaben,
  ladeModulOverrides,
  ladeModulVorgaben,
  setzeModulOverride,
} from '../../api/einsaetze';
import { ladeOrgModulEinstellungen } from '../../api/orgEinstellungen';
import { ApiError } from '../../api/client';

const EINSTELLUNGEN = { einsatz_id: 1, org_defaults: { org_id: 1 } };

function rendern(client?: QueryClient) {
  return renderMitProviders(
    <Routes>
      <Route path="/einsaetze/:id/einstellungen/module" element={<EinsatzModule />} />
    </Routes>,
    { route: '/einsaetze/1/einstellungen/module', client },
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
    vi.mocked(ladeModulVorgaben).mockResolvedValue({});
    vi.mocked(ladeModulFreigaben).mockResolvedValue({});
    benutzerRolle.wert = 'admin';
    benutzerOrg.wert = 1;
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

  it('invalidiert nach dem Speichern die Modulfreigaben dieses Einsatzes (LFH-669)', async () => {
    // `new QueryClient()`: `neuerQueryClient()` räumte unbeobachtete Einträge beim ersten await.
    const client = new QueryClient();
    // Literale Keys, nicht die Factory. Die Freigaben dieses Einsatzes beobachtet der Editor selbst
    // (LLH-1179): invalidiert heißt dort „neu geladen“.
    client.setQueryData(['einsatz-modul-freigaben', 2], {});
    rendern(client);

    const schalter = await screen.findByRole('switch', { name: 'Sichtbar: ETB' });
    await waitFor(() => expect(ladeModulFreigaben).toHaveBeenCalledTimes(1));
    fireEvent.click(schalter);

    await waitFor(() => expect(ladeModulFreigaben).toHaveBeenCalledTimes(2));
    expect(ladeModulFreigaben).toHaveBeenLastCalledWith(1);
    expect(client.getQueryState(['einsatz-modul-freigaben', 2])?.isInvalidated).toBe(false);
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
    vi.mocked(ladeModulVorgaben).mockResolvedValue({
      etb: { benoetigte_rolle: 'fuehrungskraft', sichtbar: true },
    });

    rendern();

    expect(
      await screen.findByText('Vorgabe der Organisation: Führungskraft der Organisation'),
    ).toBeInTheDocument();
  });

  it('nennt eine Org-Vorgabe „Führung im Einsatz“ mit diesem Namen (LFH-1150)', async () => {
    vi.mocked(ladeModulVorgaben).mockResolvedValue({
      etb: { benoetigte_rolle: 'einsatzfuehrung', sichtbar: true },
    });

    rendern();

    expect(
      await screen.findByText('Vorgabe der Organisation: Führung im Einsatz'),
    ).toBeInTheDocument();
  });

  it('speichert die Stufe „Führung im Einsatz“ als einsatzfuehrung (LFH-1150)', async () => {
    rendern();

    fireEvent.mouseDown(await screen.findByRole('combobox', { name: 'Benötigte Rolle: ETB' }));
    fireEvent.click(await screen.findByText('Führung im Einsatz'));

    await waitFor(() =>
      // Ohne eigenen Wert bleibt die Sichtbarkeit geerbt (LLH-1179).
      expect(setzeModulOverride).toHaveBeenCalledWith(1, 'etb', {
        sichtbar: null,
        benoetigte_rolle: 'einsatzfuehrung',
      }),
    );
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

    await waitFor(() =>
      expect(document.querySelector('[data-lfh="rechte-hinweis"]')?.textContent).toBe(
        'Nur Ansicht nur Einsatzleitung oder Org-Admin',
      ),
    );
    expect(screen.getByRole('switch', { name: 'Sichtbar: ETB' })).toBeDisabled();
  });

  // LFH-995: wie der Server — der Admin trägt nur in der Org des Einsatzes.
  it('laesst den Admin der Einsatz-Org ohne Mitgliedschaft verwalten', async () => {
    vi.mocked(ladeEinsatz).mockResolvedValue({
      id: 1,
      org_id: 1,
      bezeichnung: 'Lage',
      status: 'aktiv',
      meine_rolle: null,
    } as never);

    rendern();

    expect(await screen.findByRole('switch', { name: 'Sichtbar: ETB' })).toBeEnabled();
    expect(screen.queryByText('nur Einsatzleitung oder Org-Admin')).toBeNull();
  });

  it('sperrt den Admin einer fremden Org ohne Mitgliedschaft', async () => {
    benutzerOrg.wert = 2;
    vi.mocked(ladeEinsatz).mockResolvedValue({
      id: 1,
      org_id: 1,
      bezeichnung: 'Lage',
      status: 'aktiv',
      meine_rolle: null,
    } as never);

    rendern();

    await waitFor(() =>
      expect(document.querySelector('[data-lfh="rechte-hinweis"]')?.textContent).toBe(
        'Nur Ansicht nur Einsatzleitung oder Org-Admin',
      ),
    );
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
    expect(within(zeile).getByText('nur Einsatzleitung oder Org-Admin')).toBeInTheDocument();
  });

  // `darfEinsatzLeiten` verlangt einen aktiven Einsatz; ein abgeschlossener sperrt auch die
  // Einsatzleitung. Ein Rollenwort widerspräche dort dem Seitenkopf.
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
    expect(within(zeile).queryByText('nur Einsatzleitung oder Org-Admin')).toBeNull();
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
    vi.mocked(ladeModulVorgaben).mockResolvedValue({});
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

/** Sichtbarkeits-Vorgabe der Organisation im Editor (LLH-1179). */
describe('EinsatzModule · Herkunft der Sichtbarkeit (LLH-1179)', () => {
  const ORG_BLENDET_STAB_AUS = { stab: { benoetigte_rolle: null, sichtbar: false } };
  const FREIGABE_STAB_AUS = { stab: { sichtbar: false, zugriff: true } };

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
    vi.mocked(ladeModulVorgaben).mockResolvedValue(ORG_BLENDET_STAB_AUS);
    vi.mocked(ladeModulFreigaben).mockResolvedValue(FREIGABE_STAB_AUS);
    benutzerRolle.wert = 'admin';
    benutzerOrg.wert = 1;
  });

  function stabZeile() {
    return screen
      .getByRole('switch', { name: 'Sichtbar: Stab' })
      .closest('[data-modul-zeile]') as HTMLElement;
  }

  it('zeigt eine geerbte Ausblendung als aus, mit Herkunft und ohne „Vorgabe übernehmen“', async () => {
    rendern();

    await waitFor(() =>
      expect(screen.getByRole('switch', { name: 'Sichtbar: Stab' })).not.toBeChecked(),
    );
    expect(
      within(stabZeile()).getByText('Vorgabe der Organisation: ausgeblendet'),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Vorgabe übernehmen: Stab' }),
    ).not.toBeInTheDocument();
    // Ein Modul ohne Vorgabe trägt keinen Hinweis.
    const etb = screen
      .getByRole('switch', { name: 'Sichtbar: ETB' })
      .closest('[data-modul-zeile]') as HTMLElement;
    expect(within(etb).queryByText(/Vorgabe der Organisation/)).not.toBeInTheDocument();
  });

  it('überstimmt die Vorgabe mit einem eigenen Wert', async () => {
    rendern();

    const schalter = await screen.findByRole('switch', { name: 'Sichtbar: Stab' });
    await waitFor(() => expect(schalter).not.toBeChecked());
    fireEvent.click(schalter);

    await waitFor(() =>
      expect(setzeModulOverride).toHaveBeenCalledWith(1, 'stab', {
        sichtbar: true,
        benoetigte_rolle: null,
      }),
    );
  });

  it('bietet bei eigenem Wert „Vorgabe übernehmen“ an, das ihn zurücknimmt und die Rolle lässt', async () => {
    vi.mocked(ladeModulOverrides).mockResolvedValue({
      stab: { sichtbar: true, benoetigte_rolle: 'fuehrungskraft' },
    } as never);
    vi.mocked(ladeModulFreigaben).mockResolvedValue({ stab: { sichtbar: true, zugriff: true } });
    rendern();

    const knopf = await screen.findByRole('button', { name: 'Vorgabe übernehmen: Stab' });
    expect(screen.getByRole('switch', { name: 'Sichtbar: Stab' })).toBeChecked();
    expect(
      within(stabZeile()).getByText('Vorgabe der Organisation: ausgeblendet'),
    ).toBeInTheDocument();
    fireEvent.click(knopf);

    await waitFor(() =>
      expect(setzeModulOverride).toHaveBeenCalledWith(1, 'stab', {
        sichtbar: null,
        benoetigte_rolle: 'fuehrungskraft',
      }),
    );
    // Der Knopf schaltet nicht nebenbei den Schalter.
    expect(setzeModulOverride).toHaveBeenCalledTimes(1);
  });

  it('bietet „Vorgabe übernehmen“ auch bei eigenem Wert ohne Org-Vorgabe an', async () => {
    vi.mocked(ladeModulVorgaben).mockResolvedValue({});
    vi.mocked(ladeModulFreigaben).mockResolvedValue({ etb: { sichtbar: false, zugriff: true } });
    vi.mocked(ladeModulOverrides).mockResolvedValue({
      etb: { sichtbar: false, benoetigte_rolle: null },
    } as never);
    rendern();

    expect(
      await screen.findByRole('button', { name: 'Vorgabe übernehmen: ETB' }),
    ).toBeInTheDocument();
    expect(screen.queryByText('Vorgabe der Organisation: ausgeblendet')).not.toBeInTheDocument();
  });

  it('lässt eine geerbte Ausblendung beim Rollenwechsel geerbt', async () => {
    vi.mocked(ladeModulOverrides).mockResolvedValue({
      stab: { sichtbar: null, benoetigte_rolle: null },
    } as never);
    rendern();

    await waitFor(() =>
      expect(screen.getByRole('switch', { name: 'Sichtbar: Stab' })).not.toBeChecked(),
    );
    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Benötigte Rolle: Stab' }));
    const optionen = await screen.findAllByText('Admin');
    fireEvent.click(optionen[optionen.length - 1]);

    await waitFor(() =>
      expect(setzeModulOverride).toHaveBeenCalledWith(1, 'stab', {
        sichtbar: null,
        benoetigte_rolle: 'admin',
      }),
    );
  });

  it('leitet die Herkunft aus den Freigaben her, wenn die Vorgaben nicht ladbar sind', async () => {
    // Rückfall für einen gescheiterten Abruf der Vorgaben; die Freigaben stehen.
    vi.mocked(ladeModulVorgaben).mockRejectedValue(new ApiError(500, 'kaputt'));
    rendern();

    await waitFor(() =>
      expect(screen.getByRole('switch', { name: 'Sichtbar: Stab' })).not.toBeChecked(),
    );
    // Ohne eigenen Wert kann nur die Organisation ausgeblendet haben.
    expect(
      within(stabZeile()).getByText('Vorgabe der Organisation: ausgeblendet'),
    ).toBeInTheDocument();
  });

  it('hält die Zeile gesperrt, bis Overrides und Freigaben neu geladen sind', async () => {
    vi.mocked(ladeModulVorgaben).mockResolvedValue({});
    vi.mocked(ladeModulFreigaben).mockResolvedValue({});
    vi.mocked(ladeModulOverrides).mockResolvedValueOnce({});
    let neuLaden!: (v: unknown) => void;
    vi.mocked(ladeModulOverrides).mockReturnValueOnce(new Promise((r) => (neuLaden = r)) as never);
    rendern();

    fireEvent.click(await screen.findByRole('switch', { name: 'Sichtbar: Stab' }));
    await waitFor(() => expect(ladeModulOverrides).toHaveBeenCalledTimes(2));
    // Der eigene Wert ist gespeichert, der Bestand noch alt: ein Rollenwechsel schickte sonst
    // `sichtbar: null` und nähme ihn still zurück.
    expect(screen.getByRole('combobox', { name: 'Benötigte Rolle: Stab' })).toBeDisabled();

    neuLaden({ stab: { sichtbar: false, benoetigte_rolle: null } });
    await waitFor(() =>
      expect(screen.getByRole('combobox', { name: 'Benötigte Rolle: Stab' })).not.toBeDisabled(),
    );
  });

  it('zeigt den Schalter erst, wenn die Freigaben feststehen', async () => {
    let freigabenDa!: (v: unknown) => void;
    vi.mocked(ladeModulFreigaben).mockReturnValue(new Promise((r) => (freigabenDa = r)) as never);
    vi.mocked(ladeModulVorgaben).mockRejectedValue(new ApiError(500, 'kaputt'));
    rendern();

    await waitFor(() => expect(ladeModulFreigaben).toHaveBeenCalled());
    await waitFor(() => expect(ladeModulOverrides).toHaveBeenCalled());
    // Overrides und Einsatz sind da; ohne Warten auf die Freigaben stünde der Schalter jetzt „an“.
    await new Promise((r) => setTimeout(r, 100));
    expect(screen.queryByRole('switch', { name: 'Sichtbar: Stab' })).not.toBeInTheDocument();
    freigabenDa(FREIGABE_STAB_AUS);
    await waitFor(() =>
      expect(screen.getByRole('switch', { name: 'Sichtbar: Stab' })).not.toBeChecked(),
    );
  });

  it('nimmt ohne Freigaben die Org-Vorgabe für den Schalter', async () => {
    vi.mocked(ladeModulFreigaben).mockRejectedValue(new ApiError(500, 'kaputt'));
    rendern();

    await waitFor(() =>
      expect(screen.getByRole('switch', { name: 'Sichtbar: Stab' })).not.toBeChecked(),
    );
    expect(screen.getByRole('switch', { name: 'Sichtbar: ETB' })).toBeChecked();
  });
});

describe('EinsatzModule · Einsatzleitung ohne Org-Rolle (LLH-1183)', () => {
  beforeEach(() => {
    vi.mocked(ladeEinsatz).mockResolvedValue({
      id: 1,
      bezeichnung: 'Lage',
      status: 'aktiv',
      meine_rolle: 'einsatzleitung',
    } as never);
    vi.mocked(ladeEinstellungen).mockResolvedValue(EINSTELLUNGEN as never);
    vi.mocked(setzeModulOverride).mockResolvedValue({} as never);
    // Der Org-Endpunkt antwortet ihr mit 403; der Einsatz liefert die Vorgaben.
    vi.mocked(ladeOrgModulEinstellungen).mockRejectedValue(new ApiError(403, 'Keine Berechtigung'));
    vi.mocked(ladeModulVorgaben).mockResolvedValue({
      stab: { benoetigte_rolle: null, sichtbar: false },
      lagemeldungen: { benoetigte_rolle: 'einsatzfuehrung', sichtbar: true },
    });
    // Der Einsatz blendet `stab` mit eigenem Wert ein: aus den Freigaben allein wäre die
    // Org-Ausblendung nicht mehr zu erkennen.
    vi.mocked(ladeModulOverrides).mockResolvedValue({
      stab: { sichtbar: true, benoetigte_rolle: null },
    } as never);
    vi.mocked(ladeModulFreigaben).mockResolvedValue({ stab: { sichtbar: true, zugriff: true } });
    benutzerRolle.wert = 'keiner';
    benutzerOrg.wert = 1;
  });

  function zeile(name: string) {
    return screen
      .getByRole('switch', { name: `Sichtbar: ${name}` })
      .closest('[data-modul-zeile]') as HTMLElement;
  }

  it('zeigt bei eigenem Wert die Ausblendung der Organisation und „Vorgabe übernehmen“', async () => {
    rendern();

    expect(
      await screen.findByRole('button', { name: 'Vorgabe übernehmen: Stab' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Sichtbar: Stab' })).toBeChecked();
    await waitFor(() =>
      expect(
        within(zeile('Stab')).getByText('Vorgabe der Organisation: ausgeblendet'),
      ).toBeInTheDocument(),
    );
  });

  it('zeigt den Rollen-Hinweis der Organisation wie bei einem System-Admin', async () => {
    rendern();

    await waitFor(() =>
      expect(
        within(zeile('Lagemeldungen')).getByText('Vorgabe der Organisation: Führung im Einsatz'),
      ).toBeInTheDocument(),
    );
  });

  it('liest die Vorgaben am Einsatz, nicht am Org-Endpunkt', async () => {
    rendern();

    await screen.findByRole('switch', { name: 'Sichtbar: Stab' });
    await waitFor(() => expect(ladeModulVorgaben).toHaveBeenCalledWith(1));
    expect(ladeOrgModulEinstellungen).not.toHaveBeenCalled();
  });
});
