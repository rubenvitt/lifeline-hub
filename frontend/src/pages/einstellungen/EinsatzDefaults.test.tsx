import { screen, fireEvent, waitFor } from '@testing-library/react';
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
  meldung_bestaetigung_frist_min: 30,
  auftrag_quittierung_frist_min: 45,
  auto_etb_eintraege: 0,
  geocoder_url: 'https://geo.example',
  geaendert_at: null,
  geaendert_von: null,
};

function alsAdmin() {
  vi.mocked(useAuth).mockReturnValue({
    benutzer: {
      id: 1,
      system_rolle: 'admin',
      org_rolle: 'keine',
      anzeigename: 'Admin',
      benutzername: 'admin',
      aktiv: true,
      erstellt_at: '',
      totp_aktiviert: false,
    },
    laedt: false,
    login: vi.fn(),
    logout: vi.fn(),
    aktualisiere: vi.fn(),
  } as never);
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
        meldung_bestaetigung_frist_min: 30,
        auftrag_quittierung_frist_min: 45,
        auto_etb_eintraege: false,
      }),
    );
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

  it('speichert Modul-Rollen-Default sofort per PUT', async () => {
    vi.mocked(ladeOrgModulEinstellungen).mockResolvedValue({ etb: 'fuehrungskraft' } as never);

    renderMitProviders(<EinsatzDefaults />);

    const etbSelect = await screen.findByRole('combobox', { name: 'Benötigte Rolle: ETB' });
    fireEvent.mouseDown(etbSelect);
    fireEvent.click(await screen.findByText('Admin'));

    await waitFor(() => expect(setzeOrgModulEinstellung).toHaveBeenCalledWith('etb', 'admin'));
  });

  it('deaktiviert nicht-ausblendbare Modul-Selects auch als Admin', async () => {
    // 'einsatzdaten' und 'einsatz-einstellungen' sind NICHT_AUSBLENDBAR — der Rollen-Default-
    // Select bleibt für Admins deaktiviert; ein ausblendbares Modul (ETB) ist editierbar.
    renderMitProviders(<EinsatzDefaults />);

    expect(
      await screen.findByRole('combobox', { name: 'Benötigte Rolle: Einsatzdaten' }),
    ).toBeDisabled();
    expect(screen.getByRole('combobox', { name: 'Benötigte Rolle: Einstellungen' })).toBeDisabled();
    expect(screen.getByRole('combobox', { name: 'Benötigte Rolle: ETB' })).not.toBeDisabled();
  });

  // Der Knopf VERSCHWINDET seit LFH-345/C10 nicht mehr — er steht gesperrt da, und der
  // Grund steht daneben (M16). Ein fehlender Knopf ist von „diese Seite kann das nicht"
  // nicht zu unterscheiden.
  it('ist read-only für Nicht-Admins (fuehrungskraft): Speichern-Button gesperrt, Felder disabled', async () => {
    vi.mocked(useAuth).mockReturnValue({
      benutzer: {
        id: 2,
        system_rolle: 'keiner',
        org_rolle: 'fuehrungskraft',
        anzeigename: 'FK',
        benutzername: 'fk',
        aktiv: true,
        erstellt_at: '',
        totp_aktiviert: false,
      },
      laedt: false,
      login: vi.fn(),
      logout: vi.fn(),
      aktualisiere: vi.fn(),
    } as never);

    renderMitProviders(<EinsatzDefaults />);

    await screen.findByText('Aufbewahrung');
    expect(screen.getByRole('button', { name: 'Speichern' })).toBeDisabled();
    expect(screen.getByLabelText('Aufbewahrungs-Dauer (Tage)')).toBeDisabled();
  });
});

/**
 * Persistenter Speicherfehler und erklärte Berechtigung (LFH-345 · C10, Befunde H14/M16).
 *
 * ── Warum hier KEIN Fake-Timer-Vorlauf steht (gemessen 24.08.2026) ──────────────
 * Das AK verlangt „nach Vorlauf der Toast-Dauer (Fake-Timer) noch im DOM". Diese Aussage
 * ist in dieser Umgebung NICHT prüfbar, und zwar in beiden Bauformen:
 *
 *  1. Fake-Timer NACH dem Klick aktiviert — antds Message-Timer läuft dann längst mit
 *     echten Timern, `advanceTimersByTime` erreicht ihn nicht. Alle drei Seiten waren so
 *     grün, bevor eine Zeile Produktivcode existierte.
 *  2. Fake-Timer ab dem Rendern, mit `shouldAdvanceTime` (ohne das bleibt die Seite im
 *     Ladeskelett stehen und der Knopf existiert nie) — auch dann bleibt der Toast beim
 *     Vorlauf einfach stehen. Per Mutationsprobe belegt: mit zurückgedrehtem
 *     `message.error` statt des Alerts blieb genau dieser Test GRÜN, während die beiden
 *     Aussagen unten rot wurden.
 *
 * Ein Test, der nicht rot werden kann, behauptet eine Deckung, die er nicht hat. Die
 * Zusicherung tragen deshalb zwei andere: die Meldung steht außerhalb von antds
 * Message-Container (also ist sie kein Toast und hat keine Queue-Lebensdauer), und sie
 * verschwindet erst beim nächsten Absenden. Beide sind mutationsgeprüft.
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

  // Die zweite Haelfte: ein Alert, der NIE geht, ist so falsch wie einer, der zu frueh geht.
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
    vi.mocked(useAuth).mockReturnValue({
      benutzer: {
        id: 2,
        system_rolle: 'keiner',
        org_rolle: 'fuehrungskraft',
        anzeigename: 'FK',
        benutzername: 'fk',
        aktiv: true,
        erstellt_at: '',
        totp_aktiviert: false,
      },
      laedt: false,
      login: vi.fn(),
      logout: vi.fn(),
      aktualisiere: vi.fn(),
    } as never);

    renderMitProviders(<EinsatzDefaults />);

    expect(await screen.findByText(/Nur Benutzer mit der Systemrolle/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Speichern' })).toBeDisabled();
  });

  /**
   * Zwei Vorgänge, zwei Orte — der Seitenkopf trägt den Formular-Fehler, die Liste ihren
   * eigenen.
   *
   * Vorher waren beide mit `??` im Kopf verkettet. Erreichbarer Zustand: das Formular
   * scheitert, danach scheitert eine Modulzeile — dann trug die Zeile ihren roten Rand,
   * während der Text im Kopf einen ANDEREN Vorgang beschrieb und bis zum nächsten
   * Formular-Absenden stehenblieb. Der zweite Kanal zeigte damit auf die falsche Sache.
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

    // BEIDE stehen — und zwar nebeneinander, nicht einer statt des anderen.
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
 * Speicherleiste im Fuß und Verlassen-Guard (LFH-346 · A9, Befund M49).
 *
 * Der Speichern-Knopf lag im Kopf-Slot von `AdminPage` — also als DOM-Geschwister
 * AUSSERHALB des `<form>`, wo er nichts übermitteln kann (Erfassungs-Norm B4/LFH-332).
 * Und eine Seite mit sechs ausgefüllten Feldern liess sich verlassen, ohne dass irgendetwas
 * darauf hinwies.
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
    // Nur im `<form>` traegt er `htmlType="submit"`, und nur dann sendet Enter. Geprueft
    // wird die STRUKTUR, aus der die Zusicherung folgt — ein Tastendruck ist bei einer
    // Maske mit `Select`/`InputNumber` kein belastbarer Beleg (LFH-378).
    expect(knopf.closest('form')).not.toBeNull();
    expect(knopf).toHaveAttribute('type', 'submit');
  });

  /**
   * Das Verhalten, nicht ein `addEventListener`-Spy: der haenge sonst daran, dass sonst
   * niemand im Baum je dasselbe Ereignis registriert — eine Zusicherung ueber fremden Code,
   * die beim naechsten Hook still bricht.
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
   * Die dritte Aussage ist die, die den eigenen `useState` von `form.isFieldsTouched()`
   * unterscheidet: antd setzt sein Flag beim Speichern NICHT zurueck (gemessen in
   * LFH-342/C7). Ohne diese Zeile waere ein Merker, der einmal auf `true` faellt und dort
   * bleibt, ebenfalls gruen — und die Seite warnte nach dem Speichern weiter vor einer
   * Fassung, die es nicht mehr gibt.
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

    // Ueber Rollen abgefragt, nicht ueber `getByText('Einstellungen')`: „Einstellungen" ist
    // zugleich Kategorie-Label UND Modul-Label (`einsatz-einstellungen`).
    expect(await screen.findByRole('heading', { name: 'Kommunikation' })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Modul filtern'), { target: { value: 'chat' } });

    expect(screen.getByRole('combobox', { name: 'Benötigte Rolle: Chat' })).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'Benötigte Rolle: ETB' })).toBeNull();
  });
});
