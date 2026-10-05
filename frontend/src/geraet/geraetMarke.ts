/**
 * Merkt sich, dass dieser Browser als gekoppeltes Gerät läuft (LFH-892, Spec
 * `feldgeraet-bedienung`, „Kopplung beendet statt Anmeldung“). Nach einem Widerruf kennt der
 * Server die Sitzung nicht mehr, und `/api/auth/me` sagt nur noch 401; ohne diese Marke zeigte
 * das Tablet dann die Anmeldung für Personen.
 *
 * Kein Personenbezug, keine Kennung: nur „war Gerät". Gesetzt und gelöscht allein über
 * {@link merkeGeraet} aus dem `AuthProvider`, wenn der Server einen Benutzer bestätigt. Steht in
 * `GERAETESPEICHER` (`offline/geraetRaeumung.ts`).
 */
const SCHLUESSEL = 'lifeline-hub.geraet-gekoppelt';

/** Setzt oder löscht die Marke. Wirft nie (gesperrter Speicher im privaten Modus). */
export function merkeGeraet(istGeraet: boolean): void {
  try {
    if (istGeraet) localStorage.setItem(SCHLUESSEL, '1');
    else localStorage.removeItem(SCHLUESSEL);
  } catch {
    // Ohne Speicher zeigt ein beendetes Gerät die Anmeldung; die Schranke bleibt beim Server.
  }
}

/** Lief dieser Browser zuletzt als gekoppeltes Gerät? */
export function warGeraet(): boolean {
  try {
    return localStorage.getItem(SCHLUESSEL) === '1';
  } catch {
    return false;
  }
}
