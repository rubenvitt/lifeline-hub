import { Button } from 'antd';
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { setzeMeldungStatus } from '../api/meldungen';
import type { BenachrichtigungArt, BenachrichtigungBezugTyp } from '../api/types';
import { einsatzModulPfad, meldungenPfad } from '../routing/deeplinks';
import { spieleAlarmTon } from './alarmTon';
import { type AlarmZiel, ZIEL_SPRUENGE, zielPfad } from './benachrichtigungKatalog';
import { type DesktopMeldung, schliesseDesktopMeldung, zeigeDesktopAlarm } from './desktopAlarm';
import { oeffneEingaenge } from './eingaenge';
import { istStumm } from './eingaengeStumm';
import Eingangsband from './Eingangsband';

/**
 * Eingangshinweis (LLH-1062, Spec `benachrichtigungen`, „Eingangshinweis“, design.md E7): EIN
 * gebündelter, stehender Hinweis für alle Eingänge eines Einsatzes (Stufe `hinweis`, seit
 * LLH-1143; vorher nur die Art `meldung`). Er steht im Eingangsband unten (`Eingangsband.tsx`,
 * LLH-1143 D7), getrennt von den drei Toastplätzen der Zentrale (`useAlarmToasts.tsx`), und
 * verbraucht deren Budget nicht: ein Eingang ist Information, kein Alarm (`frontend/AGENTS.md`,
 * Layout und Live).
 *
 * - Ton `dezent` höchstens alle {@link EINGANG_TON_ABSTAND_MS}, ohne Zeitgeber.
 * - Steht der Fokus in einem Eingabefeld, wartet er bis zum Verlassen des Feldes.
 * - Auf der eigenen Seite (Meldungen bzw. Lagemeldungen) zeigt er deren Einträge nicht; dort
 *   trägt das Sammelbanner die Neuen.
 * - ✕ und der Sprung quittieren für den Nutzer, „Sichten“ setzt die Meldung auf Gesichtet; dann
 *   räumt der Server den Hinweis bei allen Empfängern (Quittier-Ereignis).
 * - Sammelt er Eingänge verschiedener Module, öffnet „Ansehen“ den Verlauf am Knopf „Eingänge“
 *   (`EingaengeKnopf.tsx`) und quittiert nichts: gelesen ist erst, was jemand öffnet.
 * - „Alle gelesen“ auf einem anderen Gerät (`entferneBis`) räumt alles bis zur gemeldeten Kennung.
 * - Eine Art, die auf diesem Gerät stumm ist (`eingaengeStumm.ts`, LLH-1421 D6), kommt nicht ins
 *   Band: kein Ton, keine OS-Meldung. Zahl und Verlauf zeigen sie weiter als ungelesen.
 */

/** Höchstens ein Ton je zwei Minuten, gleich wie viele Meldungen eingehen. */
export const EINGANG_TON_ABSTAND_MS = 2 * 60 * 1000;

/** So viele Einträge nennt der Hinweis mit Absender und Wortlaut; der Rest steht als Zahl. */
export const EINGANG_ZEILEN = 2;

/** Ein Eintrag: ein Eingang (Benachrichtigung der Stufe `hinweis`). */
export type EingangEintrag = {
  benachrichtigungId: number;
  einsatzId: number;
  /** Art der Benachrichtigung; eine auf diesem Gerät stumme Art bleibt draußen. */
  art: BenachrichtigungArt;
  /** Bezug des Servers; `meldung` und `lage_uebernahme` haben eigene Regeln (Sichten, Seite). */
  bezug: BenachrichtigungBezugTyp;
  /** Kennung des Bezugs (bei `meldung` die Meldung, die „Sichten“ setzt). */
  bezugId: number;
  /** Modul des Bezugs: stehen nur Eingänge eines Moduls im Band, springt es dorthin. */
  ziel: AlarmZiel;
  /** Titel für einen einzelnen Eintrag, etwa „Neue Meldung · UHS Nord“. */
  titel: string;
  /**
   * Kopf der Zeile im Bündel: bei einer Meldung der Absender, sonst die Kennung des Servers
   * („Meldung #12“); bei anderen Eingängen ihr Titel („Neuer Auftrag“).
   */
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

/** `stumm`: die Art ist auf diesem Gerät stumm, der Eintrag bleibt draußen (LLH-1421 D6). */
export type EingangErgebnis = 'neu' | 'vorhanden' | 'inaktiv' | 'stumm';

export interface Eingangshinweis {
  /** `ton`: ein neuer Eintrag darf den (gedrosselten) Ton spielen; `desktop`: OS-Meldung. */
  melde: (eintrag: EingangEintrag, opts: { ton: boolean; desktop: boolean }) => EingangErgebnis;
  /** Das Quittier-Ereignis: der Eintrag geht, ohne erneute Quittung. */
  entferneBenachrichtigung: (id: number) => void;
  /** „Alle gelesen“ (`gelesen_bis`): alle Einträge bis einschließlich `bis` gehen. */
  entferneBis: (bis: number) => void;
  zeigt: (id: number) => boolean;
}

/** Ob ein Eintrag eine Meldung betrifft (Eingang oder Übernahme in die Lage). */
function istMeldungsbezug(e: Pick<EingangEintrag, 'bezug'>): boolean {
  return e.bezug === 'meldung' || e.bezug === 'lage_uebernahme';
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

/**
 * Titel des Bündels: ein Eintrag nennt sich selbst, mehrere ihre Zahl — „neue Meldungen“, wenn
 * alle Meldungen betreffen, sonst „neue Eingänge“.
 */
export function eingangTitel(
  eintraege: readonly Pick<EingangEintrag, 'titel' | 'bezug'>[],
): string {
  if (eintraege.length === 1) return eintraege[0].titel;
  return eintraege.every(istMeldungsbezug)
    ? `${eintraege.length} neue Meldungen`
    : `${eintraege.length} neue Eingänge`;
}

/** Was das Band gerade zeigt; `null`: kein Band. */
type BandAnsicht = {
  titel: string;
  inhalt: ReactNode;
  aktion: { text: string; beiKlick: () => void };
  beiSchliessen: () => void;
};

type Zustand = {
  aktiv: boolean;
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
 * den Nutzer (`quittiereNachNutzer`), `darfSichten` ist das Schreibrecht im Einsatz. `band` setzt
 * die Zentrale in ihr Markup (ein Portal, `null` ohne Eingänge).
 */
export function useEingangshinweis(
  einsatzId: number,
  quittiere: (id: number) => void,
  darfSichten: boolean,
): { hinweis: Eingangshinweis; band: ReactNode } {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [ansicht, setAnsicht] = useState<BandAnsicht | null>(null);
  const quittiereRef = useRef(quittiere);
  quittiereRef.current = quittiere;
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;
  const darfSichtenRef = useRef(darfSichten);
  darfSichtenRef.current = darfSichten;
  const pfadRef = useRef(pathname);
  pfadRef.current = pathname;

  const zustand = useMemo<Zustand>(
    () => ({
      aktiv: true,
      eintraege: new Map(),
      zurueck: new Set(),
      fehlgeschlagen: new Set(),
      tonAusstehend: false,
      desktopAusstehend: null,
      desktop: null,
    }),
    // Je Einsatz ein eigener Zustand (wie der Scope der Toasts).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [einsatzId],
  );

  /** Ob ein Eintrag auf der gerade offenen Seite schon im Sammelbanner steht. */
  const aufEigenerSeite = useCallback(
    (e: EingangEintrag) => {
      // Ein Sammelbanner haben nur die Meldungsseiten; andere Eingänge stehen überall.
      if (!istMeldungsbezug(e)) return false;
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

  const schliessen = useCallback(() => setAnsicht(null), []);

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

    // Jüngste zuerst: der neue Eingang steht oben. Nach der Kennung des Servers, nicht nach der
    // Reihenfolge des Eintragens: der Wortlaut einer Meldung kommt mit einem eigenen Abruf, und
    // die Antworten mehrerer Eingänge kommen nicht zwingend in ihrer Reihenfolge an.
    const zeilen = [...sichtbar].sort((a, b) => b.benachrichtigungId - a.benachrichtigungId);
    const einzeln = zeilen.length === 1 ? zeilen[0] : null;
    const ziele = new Set(zeilen.map((e) => e.ziel));
    const einZiel = ziele.size === 1 ? [...ziele][0] : null;
    // `pfad` null: Eingänge aus mehreren Modulen, „Ansehen“ öffnet den Verlauf.
    const sprung: { pfad: string | null; text: string } = einzeln
      ? { pfad: einzeln.pfad, text: 'Öffnen' }
      : einZiel
        ? {
            pfad: zielPfad(einZiel, einsatzId),
            text: ZIEL_SPRUENGE.find((z) => z.ziel === einZiel)?.text ?? 'Öffnen',
          }
        : zeilen.every(istMeldungsbezug)
          ? { pfad: meldungenPfad(einsatzId), text: 'Zu Meldungen' }
          : { pfad: null, text: 'Ansehen' };

    const sichten = async (e: EingangEintrag) => {
      zustand.fehlgeschlagen.delete(e.benachrichtigungId);
      try {
        await setzeMeldungStatus(e.einsatzId, e.bezugId, 'gesichtet');
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

    const zeile = (e: EingangEintrag) => {
      // Einzeln trägt der Titel schon die Zeile; sie wiederholt sich nicht.
      const einzelText = einzeln && !e.anfang && e.zeile !== e.titel ? e.zeile : null;
      const davor = !einzeln || !!e.anfang || einzelText != null;
      return (
        <div
          key={e.benachrichtigungId}
          data-eingang-meldung={e.bezug === 'meldung' ? e.bezugId : undefined}
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
            {e.anfang ? <span title={e.wortlaut}>{e.anfang}</span> : einzelText}
            {e.uhrzeit ? `${davor ? ' · ' : ''}${e.uhrzeit}` : null}
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
    };

    const weitere = zeilen.length - EINGANG_ZEILEN;
    setAnsicht({
      titel: eingangTitel(zeilen),
      inhalt: (
        <>
          {zeilen.slice(0, EINGANG_ZEILEN).map(zeile)}
          {weitere > 0 ? (
            <div style={{ marginBlockStart: 4 }}>
              {weitere === 1 ? '+ 1 weitere' : `+ ${weitere} weitere`}
            </div>
          ) : null}
        </>
      ),
      aktion: {
        text: sprung.text,
        beiKlick: () => {
          if (!zustand.aktiv) return;
          schliessen();
          if (sprung.pfad == null) {
            // Der Verlauf zeigt sie unter „Neu“; gelesen ist erst, was jemand öffnet.
            oeffneEingaenge(einsatzId);
            allesErledigt(false);
            return;
          }
          navigateRef.current(sprung.pfad);
          allesErledigt(true);
        },
      },
      beiSchliessen: () => {
        schliessen();
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
      const titel = eingangTitel(zeilen);
      const koerper = einzeln?.anfang ?? fuerDesktop.anfang ?? fuerDesktop.zeile;
      zustand.desktop = zeigeDesktopAlarm(titel, {
        // Der Titel sagt schon alles (LFH-1078): kein Körper, der ihn wiederholt.
        koerper: koerper !== titel ? koerper : undefined,
        tag: `${einsatzId}-eingang`,
        ziel: sprung.pfad ?? undefined,
        beiKlick: () => {
          if (!zustand.aktiv) return;
          if (sprung.pfad == null) oeffneEingaenge(einsatzId);
          else navigateRef.current(sprung.pfad);
        },
      });
    }
  }, [allesErledigt, aufEigenerSeite, desktopSchliessen, einsatzId, schliessen, zustand]);

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
      if (istStumm(eintrag.art)) return 'stumm';
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

  const entferneBis = useCallback(
    (bis: number) => {
      let weg = false;
      for (const id of [...zustand.eintraege.keys()]) {
        if (id > bis) continue;
        zustand.eintraege.delete(id);
        zustand.zurueck.delete(id);
        weg = true;
      }
      if (!weg) return;
      if (zustand.eintraege.size === 0) desktopSchliessen();
      zeichnen();
    },
    [desktopSchliessen, zeichnen, zustand],
  );

  const zeigt = useCallback((id: number) => zustand.eintraege.has(id), [zustand]);

  const hinweis = useMemo(
    () => ({ melde, entferneBenachrichtigung, entferneBis, zeigt }),
    [entferneBenachrichtigung, entferneBis, melde, zeigt],
  );
  const band = ansicht ? (
    <Eingangsband
      titel={ansicht.titel}
      aktion={ansicht.aktion}
      beiSchliessen={ansicht.beiSchliessen}
    >
      {ansicht.inhalt}
    </Eingangsband>
  ) : null;
  return { hinweis, band };
}
