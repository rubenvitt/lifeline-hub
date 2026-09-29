import { QueryClient } from '@tanstack/react-query';
import { screen, fireEvent, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderMitProviders } from '../../test/utils';
import { ApiError } from '../../api/client';
import EinsatzDefaults from './EinsatzDefaults';

vi.mock('../../auth/AuthContext', () => ({
  useAuth: vi.fn(),
  AuthProvider: ({ children }: { children?: unknown }) => children,
}));
vi.mock('../../api/orgEinstellungen', () => ({
  ladeOrgEinstellungen: vi.fn(),
  speichereOrgEinstellungen: vi.fn(),
  ladeOrgModulEinstellungen: vi.fn(),
  setzeOrgModulEinstellung: vi.fn(),
}));

import { useAuth } from '../../auth/AuthContext';
import {
  ladeOrgEinstellungen,
  speichereOrgEinstellungen,
  ladeOrgModulEinstellungen,
  setzeOrgModulEinstellung,
} from '../../api/orgEinstellungen';
import { adminFixture, authWertFixture, benutzerFixture } from '../../test/fixtures';

const VOLL = {
  org_id: 1,
  zeitzone: 'Europe/Berlin',
  zeitformat: '12h',
  einheiten: 'imperial',
  koordinatenformat: 'mgrs',
  retention_dauer_tage: 90,
  etb_nummer_praefix: 'EB-',
  meldung_nummer_praefix: 'M-',
  auftrag_nummer_praefix: 'A-',
  einsatz_nummer_praefix: 'WF-',
  meldung_bestaetigung_frist_min: 30,
  auftrag_quittierung_frist_min: 45,
  rueckmeldung_frist_min: 25,
  auto_etb_eintraege: 0,
  geocoder_url: 'https://geo.example',
  geaendert_at: null,
  geaendert_von: null,
};

function alsAdmin() {
  vi.mocked(useAuth).mockReturnValue(authWertFixture(adminFixture()));
}

describe('EinsatzDefaults', () => {
  beforeEach(() => {
    alsAdmin();
    vi.mocked(ladeOrgEinstellungen).mockResolvedValue({ ...VOLL } as never);
    vi.mocked(speichereOrgEinstellungen).mockResolvedValue({ ...VOLL } as never);
    vi.mocked(ladeOrgModulEinstellungen).mockResolvedValue({} as never);
    vi.mocked(setzeOrgModulEinstellung).mockResolvedValue(undefined as never);
  });

  it('sendet beim Speichern den VOLLEN Payload — Anzeige-Felder bleiben erhalten (Vollersatz)', async () => {
    renderMitProviders(<EinsatzDefaults />);

    fireEvent.click(await screen.findByRole('button', { name: 'Speichern' }));

    await waitFor(() =>
      expect(speichereOrgEinstellungen).toHaveBeenCalledWith({
        // Anzeige-Spalten NICHT genullt (aus geladenen Daten gemerged):
        zeitzone: 'Europe/Berlin',
        zeitformat: '12h',
        einheiten: 'imperial',
        koordinatenformat: 'mgrs',
        geocoder_url: 'https://geo.example',
        retention_dauer_tage: 90,
        etb_nummer_praefix: 'EB-',
        meldung_nummer_praefix: 'M-',
        auftrag_nummer_praefix: 'A-',
        einsatz_nummer_praefix: 'WF-',
        meldung_bestaetigung_frist_min: 30,
        auftrag_quittierung_frist_min: 45,
        rueckmeldung_frist_min: 25,
        auto_etb_eintraege: false,
      }),
    );
  });

  it('invalidiert nach dem Speichern die Rückmeldungen aller Einsätze, sonst nichts (LFH-610)', async () => {
    // `new QueryClient()` statt `neuerQueryClient()`: dessen gcTime 0 räumte die unbeobachteten
    // Einträge beim ersten await weg.
    const client = new QueryClient();
    // Literale Keys, nicht die Factory — sonst prüfte der Test die Factory gegen sich selbst.
    client.setQueryData(['einsatz-meldungen', 7, 'rueckmeldungen'], { frist_min: 60 });
    client.setQueryData(['einsatz-meldungen', 8, 'rueckmeldungen'], { frist_min: 60 });
    client.setQueryData(['einsatz-meldungen', 7, 'intern'], []);
    renderMitProviders(<EinsatzDefaults />, { client });

    fireEvent.click(await screen.findByRole('button', { name: 'Speichern' }));

    await waitFor(() =>
      expect(client.getQueryState(['einsatz-meldungen', 7, 'rueckmeldungen'])?.isInvalidated).toBe(
        true,
      ),
    );
    expect(client.getQueryState(['einsatz-meldungen', 8, 'rueckmeldungen'])?.isInvalidated).toBe(
      true,
    );
    expect(client.getQueryState(['einsatz-meldungen', 7, 'intern'])?.isInvalidated).toBe(false);
  });

  it('geleertes Präfix-Feld geht als null raus (nicht "") — trim/leer→null-Semantik', async () => {
    renderMitProviders(<EinsatzDefaults />);

    const etb = await screen.findByLabelText('Präfix ETB');
    await userEvent.clear(etb);
    fireEvent.click(await screen.findByRole('button', { name: 'Speichern' }));

    await waitFor(() =>
      expect(speichereOrgEinstellungen).toHaveBeenCalledWith(
        expect.objectContaining({ etb_nummer_praefix: null }),
      ),
    );
  });

  it('LFH-617: das Einsatznummer-Präfix ist editierbar und geht in den PUT', async () => {
    renderMitProviders(<EinsatzDefaults />);

    const feld = await screen.findByLabelText('Präfix Einsatznummer');
    expect(feld).toHaveValue('WF-');
    expect(feld).toHaveAttribute('placeholder', 'E-');
    await userEvent.clear(feld);
    await userEvent.type(feld, 'OV-');
    fireEvent.click(await screen.findByRole('button', { name: 'Speichern' }));

    await waitFor(() =>
      expect(speichereOrgEinstellungen).toHaveBeenCalledWith(
        expect.objectContaining({ einsatz_nummer_praefix: 'OV-' }),
      ),
    );
  });

  it('speichert Modul-Rollen-Default sofort per PUT', async () => {
    vi.mocked(ladeOrgModulEinstellungen).mockResolvedValue({ etb: 'fuehrungskraft' } as never);

    renderMitProviders(<EinsatzDefaults />);

    const etbSelect = await screen.findByRole('combobox', { name: 'Benötigte Rolle: ETB' });
    fireEvent.mouseDown(etbSelect);
    fireEvent.click(await screen.findByText('Admin'));

    await waitFor(() => expect(setzeOrgModulEinstellung).toHaveBeenCalledWith('etb', 'admin'));
  });

  it('stapelt die Quittung beim Serienschalten nicht (LFH-478)', async () => {
    renderMitProviders(<EinsatzDefaults />);

    for (const [i, modul] of ['ETB', 'Chat'].entries()) {
      fireEvent.mouseDown(
        await screen.findByRole('combobox', { name: `Benötigte Rolle: ${modul}` }),
      );
      const optionen = await screen.findAllByText('Admin');
      fireEvent.click(optionen[optionen.length - 1]);
      await waitFor(() => expect(setzeOrgModulEinstellung).toHaveBeenCalledTimes(i + 1));
    }

    await waitFor(() => expect(document.querySelectorAll('.ant-message-notice')).toHaveLength(1));
  });

  it('deaktiviert nicht-ausblendbare Modul-Selects auch als Admin', async () => {
    // 'einsatzdaten' und 'einsatz-einstellungen' sind NICHT_AUSBLENDBAR — ihr Rollen-Select bleibt
    // gesperrt; ein ausblendbares Modul (ETB) ist editierbar.
    renderMitProviders(<EinsatzDefaults />);

    expect(
      await screen.findByRole('combobox', { name: 'Benötigte Rolle: Einsatzdaten' }),
    ).toBeDisabled();
    expect(screen.getByRole('combobox', { name: 'Benötigte Rolle: Einstellungen' })).toBeDisabled();
    expect(screen.getByRole('combobox', { name: 'Benötigte Rolle: ETB' })).not.toBeDisabled();
  });

  // Der Knopf steht gesperrt da, mit Grund daneben — ein fehlender Knopf ist von „diese Seite kann
  // das nicht" nicht zu unterscheiden.
  it('ist read-only für Nicht-Admins (fuehrungskraft): Speichern-Button gesperrt, Felder disabled', async () => {
    vi.mocked(useAuth).mockReturnValue(
      authWertFixture(benutzerFixture({ id: 2, org_rolle: 'fuehrungskraft', anzeigename: 'FK' })),
    );

    renderMitProviders(<EinsatzDefaults />);

    await screen.findByText('Aufbewahrung');
    expect(screen.getByRole('button', { name: 'Speichern' })).toBeDisabled();
    expect(screen.getByLabelText('Aufbewahrungs-Dauer (Tage)')).toBeDisabled();
    // Die gesperrte Modulzeile nennt ihren Grund selbst, nicht nur der Seitenkopf.
    const zeile = screen
      .getByRole('combobox', { name: 'Benötigte Rolle: ETB' })
      .closest('[data-modul-zeile]') as HTMLElement;
    expect(within(zeile).getByText('nur Admins')).toBeInTheDocument();
  });
});

/**
 * Persistenter Speicherfehler und erklärte Berechtigung.
 *
 * Warum hier kein Fake-Timer-Vorlauf steht: „nach Vorlauf der Toast-Dauer noch im DOM" ist in
 * dieser Umgebung nicht prüfbar. Nach dem Klick aktivierte Fake-Timer erreichen antds laufenden
 * Message-Timer nicht; mit `shouldAdvanceTime` ab dem Rendern bleibt der Toast beim Vorlauf
 * trotzdem stehen — ein zurückgedrehtes `message.error` bliebe grün. Die Zusicherung tragen deshalb
 * zwei andere Aussagen: die Meldung steht außerhalb von antds Message-Container, und sie
 * verschwindet erst beim nächsten Absenden.
 */
describe('EinsatzDefaults · Speicherfehler und Berechtigung (LFH-345)', () => {
  beforeEach(() => {
    alsAdmin();
    vi.mocked(ladeOrgEinstellungen).mockResolvedValue({ ...VOLL } as never);
    vi.mocked(ladeOrgModulEinstellungen).mockResolvedValue({} as never);
    vi.mocked(setzeOrgModulEinstellung).mockResolvedValue(undefined as never);
  });

  it('meldet den Fehler an der Seite, NICHT als Toast', async () => {
    vi.mocked(speichereOrgEinstellungen).mockRejectedValue(new ApiError(422, 'Startwert zu groß'));
    renderMitProviders(<EinsatzDefaults />);

    fireEvent.click(await screen.findByRole('button', { name: 'Speichern' }));
    const treffer = await screen.findByText('Startwert zu groß');
    expect(treffer.closest('.ant-message')).toBeNull();
  });

  // Ein Alert, der nie geht, ist so falsch wie einer, der zu früh geht.
  it('raeumt den Fehler beim naechsten Absenden weg', async () => {
    vi.mocked(speichereOrgEinstellungen)
      .mockRejectedValueOnce(new ApiError(422, 'Startwert zu groß'))
      .mockResolvedValue({ ...VOLL } as never);
    renderMitProviders(<EinsatzDefaults />);

    fireEvent.click(await screen.findByRole('button', { name: 'Speichern' }));
    await screen.findByText('Startwert zu groß');

    fireEvent.click(screen.getByRole('button', { name: 'Speichern' }));
    await waitFor(() => expect(screen.queryByText('Startwert zu groß')).not.toBeInTheDocument());
  });

  it('erklaert der Fuehrungskraft den Grund UND laesst den Knopf stehen', async () => {
    vi.mocked(speichereOrgEinstellungen).mockResolvedValue({ ...VOLL } as never);
    vi.mocked(useAuth).mockReturnValue(
      authWertFixture(benutzerFixture({ id: 2, org_rolle: 'fuehrungskraft', anzeigename: 'FK' })),
    );

    renderMitProviders(<EinsatzDefaults />);

    expect(await screen.findByText(/Nur Benutzer mit der Systemrolle/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Speichern' })).toBeDisabled();
  });

  /**
   * Zwei Vorgänge, zwei Orte: der Seitenkopf trägt den Formular-Fehler, die Liste ihren eigenen.
   * Mit `??` verkettet beschriebe der Kopftext sonst einen anderen Vorgang als die rot markierte
   * Zeile.
   */
  it('haelt Formular- und Modulfehler auseinander', async () => {
    vi.mocked(speichereOrgEinstellungen).mockRejectedValue(new ApiError(422, 'Startwert zu groß'));
    vi.mocked(setzeOrgModulEinstellung).mockRejectedValue(new ApiError(409, 'Modul gesperrt'));
    renderMitProviders(<EinsatzDefaults />);

    fireEvent.click(await screen.findByRole('button', { name: 'Speichern' }));
    await screen.findByText('Startwert zu groß');

    const etb = screen.getByRole('combobox', { name: 'Benötigte Rolle: ETB' });
    fireEvent.mouseDown(etb);
    fireEvent.click(await screen.findByText('Admin'));

    // Beide stehen, nebeneinander.
    expect(await screen.findByText('Modul gesperrt')).toBeInTheDocument();
    expect(screen.getByText('Startwert zu groß')).toBeInTheDocument();
  });

  it('schweigt ueber Berechtigungen, wenn welche da sind', async () => {
    vi.mocked(speichereOrgEinstellungen).mockResolvedValue({ ...VOLL } as never);
    renderMitProviders(<EinsatzDefaults />);

    await screen.findByText('Aufbewahrung');
    expect(screen.queryByText(/Nur Benutzer mit der Systemrolle/)).not.toBeInTheDocument();
  });
});

/**
 * Speicherleiste im Fuß und Verlassen-Guard: der Knopf liegt im `<form>` (im Kopf-Slot könnte er
 * nichts übermitteln), und eine ausgefüllte, ungespeicherte Seite warnt beim Verlassen.
 */
describe('EinsatzDefaults · Speicherleiste und Verlassen-Guard (LFH-346)', () => {
  beforeEach(() => {
    alsAdmin();
    vi.mocked(ladeOrgEinstellungen).mockResolvedValue({ ...VOLL } as never);
    vi.mocked(speichereOrgEinstellungen).mockResolvedValue({ ...VOLL } as never);
    vi.mocked(ladeOrgModulEinstellungen).mockResolvedValue({} as never);
    vi.mocked(setzeOrgModulEinstellung).mockResolvedValue(undefined as never);
  });

  it('traegt den Speichern-Knopf IM Formular, nicht im Kopf-Slot', async () => {
    renderMitProviders(<EinsatzDefaults />);

    const knopf = await screen.findByRole('button', { name: 'Speichern' });
    // Nur im `<form>` sendet Enter. Geprüft wird die Struktur — ein Tastendruck ist bei
    // `Select`/`InputNumber` kein belastbarer Beleg.
    expect(knopf.closest('form')).not.toBeNull();
    expect(knopf).toHaveAttribute('type', 'submit');
  });

  /**
   * Geprüft wird das Verhalten, kein `addEventListener`-Spy — der hinge an fremdem Code im Baum.
   */
  function beforeUnloadGefeuert(): boolean {
    const e = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(e);
    return e.defaultPrevented;
  }

  it('warnt beim Verlassen nur mit ungespeicherter Fassung', async () => {
    renderMitProviders(<EinsatzDefaults />);
    const feld = await screen.findByLabelText('Präfix ETB');

    // Gegenaussage zuerst: ohne offene Fassung schweigt der Guard.
    expect(beforeUnloadGefeuert()).toBe(false);

    fireEvent.change(feld, { target: { value: 'EB2-' } });
    await waitFor(() => expect(beforeUnloadGefeuert()).toBe(true));
  });

  /**
   * Unterscheidet den eigenen `useState` von `form.isFieldsTouched()`: antd setzt sein Flag beim
   * Speichern nicht zurück, die Seite warnte sonst weiter vor einer Fassung, die es nicht mehr
   * gibt.
   */
  it('schweigt wieder, sobald gespeichert ist', async () => {
    renderMitProviders(<EinsatzDefaults />);
    const feld = await screen.findByLabelText('Präfix ETB');

    fireEvent.change(feld, { target: { value: 'EB2-' } });
    await waitFor(() => expect(beforeUnloadGefeuert()).toBe(true));

    fireEvent.click(screen.getByRole('button', { name: 'Speichern' }));
    await waitFor(() => expect(speichereOrgEinstellungen).toHaveBeenCalled());
    await waitFor(() => expect(beforeUnloadGefeuert()).toBe(false));
  });

  it('gruppiert die Modul-Rollen-Defaults und filtert sie (M48, Durchgriff der Liste)', async () => {
    renderMitProviders(<EinsatzDefaults />);

    // Über Rollen abgefragt: „Einstellungen" ist zugleich Kategorie- und Modul-Label.
    expect(await screen.findByRole('heading', { name: 'Kommunikation' })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Modul filtern'), { target: { value: 'chat' } });

    expect(screen.getByRole('combobox', { name: 'Benötigte Rolle: Chat' })).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'Benötigte Rolle: ETB' })).toBeNull();
  });
});
