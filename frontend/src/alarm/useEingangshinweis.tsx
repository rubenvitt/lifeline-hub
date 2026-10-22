import { App, Button } from 'antd';
import { useCallback, useEffect, useId, useMemo, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { setzeMeldungStatus } from '../api/meldungen';
import { einsatzModulPfad, meldungenPfad } from '../routing/deeplinks';
import { spieleAlarmTon } from './alarmTon';
import { type DesktopMeldung, schliesseDesktopMeldung, zeigeDesktopAlarm } from './desktopAlarm';

/**
 * Eingangshinweis (LLH-1062, Spec `benachrichtigungen`, „Eingangshinweis“, design.md E7): EIN
 * gebündelter, stehender Hinweis für alle Benachrichtigungen der Art `meldung` (Eingang einer
 * Meldung, Übernahme in die Lage). Er hat einen eigenen Platz neben den drei Toastplätzen der
 * Zentrale (`useAlarmToasts.tsx`) und verbraucht deren Budget nicht: ein Eingang ist Information,
 * kein Alarm (`frontend/AGENTS.md`, Layout und Live).
 *
 * - Ton `dezent` höchstens alle {@link EINGANG_TON_ABSTAND_MS}, ohne Zeitgeber.
 * - Steht der Fokus in einem Eingabefeld, wartet er bis zum Verlassen des Feldes.
 * - Auf der eigenen Seite (Meldungen bzw. Lagemeldungen) zeigt er deren Einträge nicht; dort
 *   trägt das Sammelbanner die Neuen.
 * - ✕ und der Sprung quittieren für den Nutzer, „Sichten“ setzt die Meldung auf Gesichtet; dann
 *   räumt der Server den Hinweis bei allen Empfängern (Quittier-Ereignis).
 *
 * Gebaut mit dem Muster der Toasts (antd-Notification mit eigenem Schlüssel). Der Querschnitt-
 * Baustein „Eingangshinweis“ (LLH-1022) fehlt noch; später auf ihn umstellen.
 */

/** Höchstens ein Ton je zwei Minuten, gleich wie viele Meldungen eingehen. */
export const EINGANG_TON_ABSTAND_MS = 2 * 60 * 1000;

/** So viele Einträge nennt der Hinweis mit Absender und Wortlaut; der Rest steht als Zahl. */
export const EINGANG_ZEILEN = 2;

/** Ein Eintrag: eine Benachrichtigung der Art `meldung`. */
export type EingangEintrag = {
  benachrichtigungId: number;
  einsatzId: number;
  /** Eingang einer Meldung oder ihre Übernahme in die Lage. */
  bezug: 'meldung' | 'lage_uebernahme';
  meldungId: number;
  /** Titel für einen einzelnen Eintrag, etwa „Neue Meldung · UHS Nord“. */
  titel: string;
  /** Kopf der Zeile im Bündel: Absender, sonst die Kennung des Servers („Meldung #12“). */
  zeile: string;
  /** Anfang des Wortlauts; der ganze im `title`. */
  anfang?: string;
  wortlaut?: string;
  /** Uhrzeit beim Nachreichen. */
  uhrzeit?: string;
  pfad: string;
  /** Status Neu: „Sichten“ steht bereit. */
  neu: boolean;
};

export type EingangErgebnis = 'neu' | 'vorhanden' | 'inaktiv';

export interface Eingangshinweis {
  /** `ton`: ein neuer Eintrag darf den (gedrosselten) Ton spielen; `desktop`: OS-Meldung. */
  melde: (eintrag: EingangEintrag, opts: { ton: boolean; desktop: boolean }) => EingangErgebnis;
  /** Das Quittier-Ereignis: der Eintrag geht, ohne erneute Quittung. */
  entferneBenachrichtigung: (id: number) => void;
  zeigt: (id: number) => boolean;
}

// ── Ton: einer je zwei Minuten, über alle Zentralen dieses Tabs ──────────────────────────

let letzterTon = Number.NEGATIVE_INFINITY;

/** Spielt den dezenten Ton, wenn der letzte mindestens {@link EINGANG_TON_ABSTAND_MS} her ist. */
export function eingangTon(): boolean {
  const jetzt = Date.now();
  if (jetzt - letzterTon < EINGANG_TON_ABSTAND_MS) return false;
  letzterTon = jetzt;
  spieleAlarmTon('dezent');
  return true;
}

/** Ein anderer Weg hat gerade dezent getönt (Nachreichen): der Eingang zählt ihn mit. */
export function merkeEingangTon(): void {
  letzterTon = Date.now();
}

/** Nur für Tests: die Drossel zurücksetzen. */
export function setzeEingangTonZurueck(): void {
  letzterTon = Number.NEGATIVE_INFINITY;
}

/** Ob gerade eine Eingabe läuft: Fokus in einem Feld, das Text oder eine Auswahl annimmt. */
export function istEingabefeld(el: Element | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  if (el.isContentEditable) return true;
  if (el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) return true;
  if (el instanceof HTMLInputElement) {
    return !['button', 'checkbox', 'radio', 'submit', 'reset', 'image', 'range', 'color'].includes(
      el.type,
    );
  }
  return el.getAttribute('role') === 'combobox';
}

/** Titel des Bündels: ein Eintrag nennt sich selbst, mehrere ihre Zahl. */
export function eingangTitel(eintraege: readonly Pick<EingangEintrag, 'titel'>[]): string {
  return eintraege.length === 1 ? eintraege[0].titel : `${eintraege.length} neue Meldungen`;
}

type Zustand = {
  aktiv: boolean;
  offen: boolean;
  /** Einträge in Eingangsreihenfolge, älteste zuerst. */
  eintraege: Map<number, EingangEintrag>;
  /** Einträge, deren „Sichten“ der Server abgelehnt hat: der Grund steht in ihrer Zeile. */
  fehlgeschlagen: Set<number>;
  /** Während einer Eingabe eingegangen: erscheinen erst, wenn der Fokus das Feld verlässt. */
  zurueck: Set<number>;
  /** Ein neuer Eintrag wartet auf seinen Ton. */
  tonAusstehend: boolean;
  desktopAusstehend: EingangEintrag | null;
  desktop: DesktopMeldung | null;
};

/**
 * Der Eingangshinweis einer Einsatz-Zentrale. `quittiere` quittiert eine Benachrichtigung für
 * den Nutzer (`quittiereNachNutzer`), `darfSichten` ist das Schreibrecht im Einsatz.
 */
export function useEingangshinweis(
  einsatzId: number,
  quittiere: (id: number) => void,
  darfSichten: boolean,
): Eingangshinweis {
  const { notification } = App.useApp();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const instanzId = useId();
  const quittiereRef = useRef(quittiere);
  quittiereRef.current = quittiere;
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;
  const darfSichtenRef = useRef(darfSichten);
  darfSichtenRef.current = darfSichten;
  const pfadRef = useRef(pathname);
  pfadRef.current = pathname;

  const schluessel = `eingang-${einsatzId}-${instanzId}`;
  const zustand = useMemo<Zustand>(
    () => ({
      aktiv: true,
      offen: false,
      eintraege: new Map(),
      zurueck: new Set(),
      fehlgeschlagen: new Set(),
      tonAusstehend: false,
      desktopAusstehend: null,
      desktop: null,
    }),
    // Je Einsatz ein eigener Zustand (wie der Scope der Toasts).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [einsatzId, instanzId],
  );

  /** Ob ein Eintrag auf der gerade offenen Seite schon im Sammelbanner steht. */
  const aufEigenerSeite = useCallback(
    (e: EingangEintrag) => {
      const seite =
        e.bezug === 'meldung'
          ? meldungenPfad(einsatzId)
          : einsatzModulPfad(einsatzId, 'lagemeldungen');
      const p = pfadRef.current;
      return p === seite || p.startsWith(`${seite}/`);
    },
    [einsatzId],
  );

  const desktopSchliessen = useCallback(() => {
    if (zustand.desktop) schliesseDesktopMeldung(zustand.desktop);
    zustand.desktop = null;
  }, [zustand]);

  const schliessen = useCallback(() => {
    if (zustand.offen) notification.destroy(schluessel);
    zustand.offen = false;
  }, [notification, schluessel, zustand]);

  /** Alles weg; `durchNutzer` quittiert jeden Eintrag für ihn. */
  const allesErledigt = useCallback(
    (durchNutzer: boolean) => {
      const ids = [...zustand.eintraege.keys()];
      zustand.eintraege.clear();
      zustand.zurueck.clear();
      zustand.tonAusstehend = false;
      zustand.desktopAusstehend = null;
      desktopSchliessen();
      if (durchNutzer) for (const id of ids) quittiereRef.current(id);
    },
    [desktopSchliessen, zustand],
  );

  const zeichnen = useCallback(() => {
    if (!zustand.aktiv) return;
    const sichtbar = [...zustand.eintraege.values()].filter(
      (e) => !aufEigenerSeite(e) && !zustand.zurueck.has(e.benachrichtigungId),
    );
    if (sichtbar.length === 0) {
      schliessen();
      return;
    }

    // Jüngste zuerst: der neue Eingang steht oben.
    const zeilen = [...sichtbar].reverse();
    const einzeln = zeilen.length === 1 ? zeilen[0] : null;
    const nurLage = zeilen.every((e) => e.bezug === 'lage_uebernahme');
    const sprung = einzeln
      ? { pfad: einzeln.pfad, text: 'Öffnen' }
      : nurLage
        ? { pfad: einsatzModulPfad(einsatzId, 'lagemeldungen'), text: 'Zu Lagemeldungen' }
        : { pfad: meldungenPfad(einsatzId), text: 'Zu Meldungen' };

    const sichten = async (e: EingangEintrag) => {
      zustand.fehlgeschlagen.delete(e.benachrichtigungId);
      try {
        await setzeMeldungStatus(e.einsatzId, e.meldungId, 'gesichtet');
      } catch {
        // Der Grund steht am Ort der Handlung, in der Zeile, nicht als Toast (LFH-1077).
        if (zustand.eintraege.has(e.benachrichtigungId)) {
          zustand.fehlgeschlagen.add(e.benachrichtigungId);
          zeichnen();
        }
        return;
      }
      // Der Server räumt bei allen; hier gleich, ohne auf das Ereignis zu warten.
      if (zustand.eintraege.delete(e.benachrichtigungId)) zeichnen();
    };

    const zeile = (e: EingangEintrag) => (
      <div
        key={e.benachrichtigungId}
        data-eingang-meldung={e.meldungId}
        style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBlockStart: 4 }}
      >
        <span style={{ flex: 1, minWidth: 0 }}>
          {einzeln ? null : (
            <>
              <strong>{e.zeile}</strong>
              {e.bezug === 'lage_uebernahme' ? ' · in die Lage übernommen' : null}
              {e.anfang ? ': ' : null}
            </>
          )}
          {e.anfang ? <span title={e.wortlaut}>{e.anfang}</span> : einzeln ? e.zeile : null}
          {e.uhrzeit ? ` · ${e.uhrzeit}` : null}
          {zustand.fehlgeschlagen.has(e.benachrichtigungId) ? (
            <span role="alert"> · Sichten fehlgeschlagen</span>
          ) : null}
        </span>
        {darfSichtenRef.current && e.neu && e.bezug === 'meldung' ? (
          <Button aria-label={`Sichten: ${e.zeile}`} onClick={() => void sichten(e)}>
            Sichten
          </Button>
        ) : null}
      </div>
    );

    const weitere = zeilen.length - EINGANG_ZEILEN;
    zustand.offen = true;
    notification.info({
      key: schluessel,
      title: eingangTitel(zeilen),
      description: (
        <>
          {zeilen.slice(0, EINGANG_ZEILEN).map(zeile)}
          {weitere > 0 ? (
            <div style={{ marginBlockStart: 4 }}>
              {weitere === 1 ? '+ 1 weitere' : `+ ${weitere} weitere`}
            </div>
          ) : null}
        </>
      ),
      duration: 0,
      actions: (
        <Button
          type="primary"
          onClick={() => {
            if (!zustand.aktiv) return;
            navigateRef.current(sprung.pfad);
            schliessen();
            allesErledigt(true);
          }}
        >
          {sprung.text}
        </Button>
      ),
      onClose: () => {
        zustand.offen = false;
        allesErledigt(true);
      },
    });

    // Ton und OS-Meldung erst, wenn auch die zurückgehaltenen Einträge stehen.
    if (zustand.zurueck.size > 0) return;
    if (zustand.tonAusstehend) {
      zustand.tonAusstehend = false;
      eingangTon();
    }
    const fuerDesktop = zustand.desktopAusstehend;
    zustand.desktopAusstehend = null;
    if (fuerDesktop) {
      desktopSchliessen();
      zustand.desktop = zeigeDesktopAlarm(eingangTitel(zeilen), {
        koerper: einzeln?.anfang ?? fuerDesktop.anfang ?? fuerDesktop.zeile,
        tag: `${einsatzId}-eingang`,
        ziel: sprung.pfad,
        beiKlick: () => {
          if (zustand.aktiv) navigateRef.current(sprung.pfad);
        },
      });
    }
  }, [
    allesErledigt,
    aufEigenerSeite,
    desktopSchliessen,
    einsatzId,
    notification,
    schliessen,
    schluessel,
    zustand,
  ]);

  // Läuft eine Eingabe, wartet der Hinweis bis der Fokus ein Feld verlässt und in keines geht.
  useEffect(() => {
    const beimVerlassen = (ev: FocusEvent) => {
      if (zustand.zurueck.size === 0) return;
      if (istEingabefeld(ev.relatedTarget as Element | null)) return;
      zustand.zurueck.clear();
      zeichnen();
    };
    document.addEventListener('focusout', beimVerlassen);
    return () => document.removeEventListener('focusout', beimVerlassen);
  }, [zeichnen, zustand]);

  // Seitenwechsel: auf die eigene Seite verschwinden ihre Einträge, beim Verlassen kommen die
  // noch offenen wieder, ohne neuen Ton.
  useEffect(() => {
    if (zustand.eintraege.size > 0) zeichnen();
  }, [pathname, zeichnen, zustand]);

  // Abbau und Einsatzwechsel: weg ohne Quittung, das Nachreichen zeigt sie wieder.
  useEffect(() => {
    zustand.aktiv = true;
    return () => {
      zustand.aktiv = false;
      schliessen();
      allesErledigt(false);
    };
  }, [allesErledigt, schliessen, zustand]);

  const melde = useCallback(
    (eintrag: EingangEintrag, opts: { ton: boolean; desktop: boolean }): EingangErgebnis => {
      if (!zustand.aktiv) return 'inaktiv';
      if (zustand.eintraege.has(eintrag.benachrichtigungId)) return 'vorhanden';
      zustand.eintraege.set(eintrag.benachrichtigungId, eintrag);
      if (istEingabefeld(document.activeElement)) zustand.zurueck.add(eintrag.benachrichtigungId);
      if (!aufEigenerSeite(eintrag)) {
        if (opts.ton) zustand.tonAusstehend = true;
        if (opts.desktop) zustand.desktopAusstehend = eintrag;
      }
      zeichnen();
      return 'neu';
    },
    [aufEigenerSeite, zeichnen, zustand],
  );

  const entferneBenachrichtigung = useCallback(
    (id: number) => {
      if (!zustand.eintraege.delete(id)) return;
      zustand.zurueck.delete(id);
      if (zustand.eintraege.size === 0) desktopSchliessen();
      zeichnen();
    },
    [desktopSchliessen, zeichnen, zustand],
  );

  const zeigt = useCallback((id: number) => zustand.eintraege.has(id), [zustand]);

  return useMemo(
    () => ({ melde, entferneBenachrichtigung, zeigt }),
    [entferneBenachrichtigung, melde, zeigt],
  );
}
