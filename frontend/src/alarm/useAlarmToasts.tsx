import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router';
import type { BenachrichtigungStufe } from '../api/types';
import { blendeAus } from './benachrichtigungGedaechtnis';
import { zoneRaeumen, zoneSetzen, type ZonenEintrag } from './alarmZoneSpeicher';
import {
  type DesktopMeldung,
  schliesseAlleDesktopAlarme,
  schliesseDesktopMeldung,
  zeigeDesktopAlarm,
} from './desktopAlarm';

/** Ein Eintrag der Alarmzone, wie ihn eine Benachrichtigung oder der Unwetterhinweis meldet. */
export type AlarmToastEintrag = {
  /** Fachlicher Schlüssel ohne Präfix, etwa `b-40` oder `unwetter-…`. Gleicher Schlüssel, ein Eintrag. */
  schluessel: string;
  art: 'warning' | 'info';
  titel: string;
  beschreibung?: string;
  /**
   * Ganzer Text hinter einer gekürzten Beschreibung, im `title` der Beschreibung (der Wortlaut
   * einer Meldung, LLH-1052). Die OS-Meldung trägt nur die Beschreibung.
   */
  beschreibungVoll?: string;
  /** Ziel von „Öffnen“ und vom Klick auf die OS-Meldung. */
  pfad: string;
  /** Kurzer Name für die Zählung der gebündelten Zone. */
  name: string;
  stufe: BenachrichtigungStufe;
  /** Server-Benachrichtigung hinter dem Eintrag: „Öffnen“ und „Gelesen“ quittieren sie. */
  benachrichtigungId?: number;
  /**
   * OS-Meldung bei verdecktem Tab (`desktopAlarm.ts`, dort auch der Weg der Desktop-App). `tag`
   * nur mit fachlichem Schlüssel; `koerper` fällt auf die Beschreibung zurück.
   */
  desktop?: { tag?: string; koerper?: string };
};

/**
 * `neu`: der Eintrag steht neu da, der Aufrufer darf einen Ton spielen. `vorhanden`: derselbe
 * Schlüssel stand schon (Replay, Nachreichen), kein zweiter Ton.
 */
export type MeldeErgebnis = 'neu' | 'vorhanden' | 'inaktiv';

/**
 * Wie ein Eintrag geht (LLH-1736, design.md D4): `gelesen` quittiert seine Benachrichtigungen
 * („Öffnen“, „Gelesen“), `ausgeblendet` merkt sie sich für diesen Tab und quittiert nicht (✕),
 * `weg` räumt ohne beides (Quittier-Ereignis, Ersatz des Unwetterhinweises).
 */
type Abgang = 'gelesen' | 'ausgeblendet' | 'weg';

type Eintrag = AlarmToastEintrag & { ids: Set<number> };

type Scope = {
  besitzer: symbol;
  aktiv: boolean;
  /** Alle Einträge, älteste zuerst (Einfügereihenfolge der Map). */
  eintraege: Map<string, Eintrag>;
  /** OS-Meldung je Schlüssel: das Gehen eines Eintrags schließt sie mit (LFH-951). */
  desktop: Map<string, DesktopMeldung>;
};

export interface AlarmToasts {
  melde: (eintrag: AlarmToastEintrag) => MeldeErgebnis;
  /** Nimmt einen Eintrag ohne Quittung weg (ein neuerer Unwetterhinweis ersetzt den älteren). */
  entferne: (schluessel: string) => void;
  /** Das Quittier-Ereignis: Eintrag und OS-Meldung gehen. */
  entferneBenachrichtigung: (id: number) => void;
  istSichtbar: (schluessel: string) => boolean;
  zeigt: (id: number) => boolean;
}

/**
 * Die Einträge der Alarmzone einer Zentrale (LLH-1735/LLH-1736, design.md D1 in
 * `openspec/changes/archive/2026-11-15-zu9ptja2-alarmzone/`): Benachrichtigungen und Unwetterhinweise teilen die eine
 * Zone, ein Schlüssel ist ein Eintrag. Gezeichnet wird nicht hier, sondern in `AlarmZone` (oben)
 * und in der Leiste am Handschirm; beide lesen `alarmZoneSpeicher`.
 *
 * Quittiert wird nur, was der Nutzer öffnet oder als gelesen markiert. ✕ blendet aus
 * (`blendeAus`, sessionStorage), und was beim Verlassen des Layouts oder beim Einsatzwechsel geht,
 * bleibt offen und kommt beim nächsten Nachreichen wieder. `einsatzId` `null` ist die
 * Org-Zentrale.
 */
export function useAlarmToasts(
  einsatzId: number | null,
  quittiere?: (id: number) => void,
): AlarmToasts {
  const navigate = useNavigate();
  // Über eine Ref: ein neuer Rückruf darf den Scope nicht abräumen (der Cleanup hängt an ihm).
  const quittiereRef = useRef(quittiere);
  quittiereRef.current = quittiere;
  // Ebenso der Sprung: `useNavigate` liefert je Adresse eine neue Funktion, und ein neues
  // `AlarmToasts` ließe die Zentrale bei jedem Seitenwechsel neu abonnieren und nachreichen.
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;
  // Je Einsatz ein eigener Scope: beim Einsatzwechsel gehen genau dessen Einträge.
  const scope = useMemo<Scope>(
    () => ({
      besitzer: Symbol(`alarm-${einsatzId ?? 'org'}`),
      aktiv: true,
      eintraege: new Map(),
      desktop: new Map(),
    }),
    [einsatzId],
  );

  /**
   * Schließt die OS-Meldung zum Schlüssel. Über das Objekt, nicht den `tag`: zum selben Bezug kann
   * inzwischen eine neuere Meldung stehen, die niemand quittiert hat.
   */
  const desktopSchliessen = useCallback(
    (schluessel: string) => {
      const meldung = scope.desktop.get(schluessel);
      if (!meldung) return;
      scope.desktop.delete(schluessel);
      schliesseDesktopMeldung(meldung);
    },
    [scope],
  );

  // Rückrufe der Zone über eine Ref: `veroeffentlichen` baut sie je Eintrag neu.
  const abgangRef = useRef<(schluessel: string, abgang: Abgang) => void>(() => {});

  const veroeffentlichen = useCallback(() => {
    if (!scope.aktiv) return;
    const eintraege: ZonenEintrag[] = [...scope.eintraege.values()].map((e) => ({
      schluessel: e.schluessel,
      stufe: e.stufe,
      titel: e.titel,
      beschreibung: e.beschreibung,
      beschreibungVoll: e.beschreibungVoll,
      name: e.name,
      oeffnen: () => {
        if (!scope.aktiv) return;
        navigateRef.current(e.pfad);
        abgangRef.current(e.schluessel, 'gelesen');
      },
      gelesen: e.ids.size > 0 ? () => abgangRef.current(e.schluessel, 'gelesen') : undefined,
      ausblenden: () => abgangRef.current(e.schluessel, 'ausgeblendet'),
    }));
    zoneSetzen(scope.besitzer, eintraege);
  }, [scope]);

  /** Buchführung eines gehenden Eintrags samt Quittung oder Ausblenden. */
  const abgang = useCallback(
    (schluessel: string, wie: Abgang) => {
      const eintrag = scope.eintraege.get(schluessel);
      desktopSchliessen(schluessel);
      if (!eintrag) return;
      scope.eintraege.delete(schluessel);
      if (wie === 'gelesen') for (const id of eintrag.ids) quittiereRef.current?.(id);
      if (wie === 'ausgeblendet') for (const id of eintrag.ids) blendeAus(id);
      veroeffentlichen();
    },
    [desktopSchliessen, scope, veroeffentlichen],
  );
  abgangRef.current = abgang;

  const zeigeDesktop = useCallback(
    (eintrag: Eintrag) => {
      if (!eintrag.desktop) return;
      const meldung = zeigeDesktopAlarm(eintrag.titel, {
        koerper: eintrag.desktop.koerper ?? eintrag.beschreibung,
        tag: eintrag.desktop.tag,
        ziel: eintrag.pfad,
        beiKlick: () => {
          if (scope.aktiv) navigateRef.current(eintrag.pfad);
        },
      });
      if (meldung) scope.desktop.set(eintrag.schluessel, meldung);
    },
    [scope],
  );

  const melde = useCallback(
    (neu: AlarmToastEintrag): MeldeErgebnis => {
      if (!scope.aktiv) return 'inaktiv';
      // Dieselbe Benachrichtigung noch einmal (Replay, Nachreichen): nichts.
      if (scope.eintraege.has(neu.schluessel)) return 'vorhanden';
      const id = neu.benachrichtigungId;
      const eintrag: Eintrag = { ...neu, ids: new Set(id != null ? [id] : []) };
      scope.eintraege.set(neu.schluessel, eintrag);
      veroeffentlichen();
      zeigeDesktop(eintrag);
      return 'neu';
    },
    [scope, veroeffentlichen, zeigeDesktop],
  );

  const entferne = useCallback((schluessel: string) => abgang(schluessel, 'weg'), [abgang]);

  const entferneBenachrichtigung = useCallback(
    (id: number) => {
      for (const eintrag of scope.eintraege.values()) {
        if (!eintrag.ids.delete(id)) continue;
        if (eintrag.ids.size === 0) entferne(eintrag.schluessel);
        return;
      }
    },
    [entferne, scope],
  );

  const istSichtbar = useCallback((schluessel: string) => scope.eintraege.has(schluessel), [scope]);

  const zeigt = useCallback(
    (id: number) => [...scope.eintraege.values()].some((e) => e.ids.has(id)),
    [scope],
  );

  // Bei Logout, Unmount und vor dem nächsten Einsatz gehen nur die Einträge dieses Scopes, ohne
  // Quittung; mit ihnen die OS-Meldungen (LFH-951).
  useEffect(() => {
    // StrictMode führt Setup → Cleanup → Setup aus; der zweite Setup gibt den Scope wieder frei.
    scope.aktiv = true;
    return () => {
      scope.aktiv = false;
      scope.eintraege.clear();
      scope.desktop.clear();
      schliesseAlleDesktopAlarme();
      zoneRaeumen(scope.besitzer);
    };
  }, [scope]);

  return useMemo(
    () => ({ melde, entferne, entferneBenachrichtigung, istSichtbar, zeigt }),
    [entferne, entferneBenachrichtigung, istSichtbar, melde, zeigt],
  );
}
