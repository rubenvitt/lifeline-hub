import { App, Button } from 'antd';
import { useCallback, useEffect, useId, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router';
import type { BenachrichtigungStufe } from '../api/types';
import {
  sammelTitel,
  sammelZeilen,
  ZIEL_SPRUENGE,
  zielPfad,
  type AlarmZiel,
  type SammelGruppe,
} from './benachrichtigungKatalog';
import {
  type DesktopMeldung,
  schliesseAlleDesktopAlarme,
  schliesseDesktopMeldung,
  zeigeDesktopAlarm,
} from './desktopAlarm';

/** Höchstens so viele einzelne Toasts; ab dem nächsten bündelt der Sammeltoast die älteren. */
export const MAX_SICHTBARE_TOASTS = 3;

/** Ein Toast, wie ihn eine Benachrichtigung oder der Unwetterhinweis meldet. */
export type AlarmToastEintrag = {
  /** Fachlicher Schlüssel ohne Präfix, etwa `b-40` oder `unwetter-…`. Gleicher Schlüssel, ein Toast. */
  schluessel: string;
  art: 'warning' | 'info';
  titel: string;
  beschreibung?: string;
  /** Ziel von „Öffnen“ und vom Klick auf die OS-Meldung. */
  pfad: string;
  /** Sprung im Sammeltoast. */
  ziel: AlarmZiel;
  /** Gruppe für den Titel des Sammeltoasts. */
  gruppe: SammelGruppe;
  /** Kurzer Name für die Zählzeilen des Sammeltoasts. */
  name: string;
  stufe: BenachrichtigungStufe;
  /** Server-Benachrichtigung hinter dem Toast: Schließen und Öffnen quittieren sie. */
  benachrichtigungId?: number;
  /**
   * OS-Meldung bei verdecktem Tab (`desktopAlarm.ts`, dort auch der spätere Weg der
   * Desktop-App). `tag` nur mit fachlichem Schlüssel; `koerper` fällt auf die Beschreibung zurück.
   */
  desktop?: { tag?: string; koerper?: string };
};

/**
 * `neu`: der Toast steht neu da, der Aufrufer darf einen Ton spielen. `vorhanden`: derselbe
 * Schlüssel stand schon (Replay, Nachreichen), kein zweiter Ton.
 */
export type MeldeErgebnis = 'neu' | 'vorhanden' | 'inaktiv';

type Eintrag = AlarmToastEintrag & { key: string; ids: Set<number> };

type Scope = {
  keyPrefix: string;
  sammelKey: string;
  aktiv: boolean;
  sammelOffen: boolean;
  /** Alle Toasts des Scopes, einzeln oder gebündelt, nach fachlichem Schlüssel. */
  eintraege: Map<string, Eintrag>;
  /** Einzeln sichtbare Schlüssel, älteste zuerst. */
  einzeln: string[];
  /** Gebündelte Schlüssel in der Reihenfolge des Verdrängens. */
  gebuendelt: Set<string>;
  /** OS-Meldung je Schlüssel: das Quittieren im Toast schließt sie mit (LFH-951). */
  desktop: Map<string, DesktopMeldung>;
};

export interface AlarmToasts {
  melde: (eintrag: AlarmToastEintrag) => MeldeErgebnis;
  /** Nimmt einen Toast ohne Quittung weg (ein neuerer Unwetterhinweis ersetzt den älteren). */
  entferne: (schluessel: string) => void;
  /** Das Quittier-Ereignis: Toast und OS-Meldung gehen, auch aus dem Sammeltoast. */
  entferneBenachrichtigung: (id: number) => void;
  istEinzeln: (schluessel: string) => boolean;
  zeigt: (id: number) => boolean;
}

/**
 * Das gemeinsame Toast-Budget der Zentralen (LFH-663, design.md D5): höchstens drei einzelne
 * Toasts; beim vierten wandern die drei vorherigen in einen Sammeltoast, der neueste bleibt
 * einzeln, danach wandert je neuem Toast der bisher neueste hinein. Benachrichtigungen und
 * Unwetterhinweise teilen dieses eine Budget; ein Schlüssel ist ein Toast.
 *
 * Quittiert wird nur, was der Nutzer wegnimmt: ✕, „Öffnen“, ✕ am Sammeltoast und dessen Sprung.
 * Was beim Verlassen des Layouts oder beim Einsatzwechsel geht, bleibt offen und kommt beim
 * nächsten Nachreichen wieder. `einsatzId` `null` ist die Org-Zentrale.
 *
 * Toasts über `App.useApp().notification` (kein statischer Import, sonst Kontext-Leak in Tests).
 * `notification.destroy` ruft kein `onClose`.
 */
export function useAlarmToasts(
  einsatzId: number | null,
  quittiere?: (id: number) => void,
): AlarmToasts {
  const { notification } = App.useApp();
  const navigate = useNavigate();
  const instanzId = useId();
  // Über eine Ref: ein neuer Rückruf darf den Scope nicht abräumen (der Cleanup hängt an ihm).
  const quittiereRef = useRef(quittiere);
  quittiereRef.current = quittiere;
  // Ebenso der Sprung: `useNavigate` liefert je Adresse eine neue Funktion, und ein neues
  // `AlarmToasts` ließe die Zentrale bei jedem Seitenwechsel neu abonnieren und nachreichen.
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;
  // Je Instanz und Einsatz ein eigener Scope: beim Einsatzwechsel werden genau dessen Toasts
  // abgeräumt, ohne fremde Notifications anzutasten.
  const scope = useMemo<Scope>(() => {
    const keyPrefix = `alarm-${einsatzId ?? 'org'}-${instanzId}`;
    return {
      keyPrefix,
      sammelKey: `${keyPrefix}-zusammenfassung`,
      aktiv: true,
      sammelOffen: false,
      eintraege: new Map(),
      einzeln: [],
      gebuendelt: new Set(),
      desktop: new Map(),
    };
  }, [einsatzId, instanzId]);

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

  /** Buchführung eines erledigten Toasts; `durchNutzer` quittiert seine Benachrichtigungen. */
  const erledigt = useCallback(
    (schluessel: string, durchNutzer: boolean) => {
      const eintrag = scope.eintraege.get(schluessel);
      desktopSchliessen(schluessel);
      scope.eintraege.delete(schluessel);
      scope.einzeln = scope.einzeln.filter((s) => s !== schluessel);
      scope.gebuendelt.delete(schluessel);
      if (durchNutzer && eintrag) for (const id of eintrag.ids) quittiereRef.current?.(id);
    },
    [desktopSchliessen, scope],
  );

  const alleSchliessen = useCallback(
    (durchNutzer: boolean) => {
      for (const schluessel of scope.einzeln) {
        const eintrag = scope.eintraege.get(schluessel);
        if (eintrag) notification.destroy(eintrag.key);
      }
      if (scope.sammelOffen) notification.destroy(scope.sammelKey);
      scope.sammelOffen = false;
      const eintraege = [...scope.eintraege.values()];
      scope.eintraege.clear();
      scope.einzeln = [];
      scope.gebuendelt.clear();
      scope.desktop.clear();
      // Mit den Toasts gehen die OS-Meldungen: Einsatzwechsel, Unmount und „Zu …“ (LFH-951).
      schliesseAlleDesktopAlarme();
      if (durchNutzer)
        for (const e of eintraege) for (const id of e.ids) quittiereRef.current?.(id);
    },
    [notification, scope],
  );

  const zeigeZusammenfassung = useCallback(() => {
    if (!scope.aktiv) return;
    const eintraege = [...scope.gebuendelt]
      .map((s) => scope.eintraege.get(s))
      .filter((e): e is Eintrag => e != null);
    if (eintraege.length === 0) {
      if (scope.sammelOffen) notification.destroy(scope.sammelKey);
      scope.sammelOffen = false;
      return;
    }
    const ziele = new Set(eintraege.map((e) => e.ziel));
    const zeilen = sammelZeilen(eintraege);
    scope.sammelOffen = true;
    // Zahl und Art im Titel, je Art eine Zählzeile, das Ziel am Knopf (LFH-1078).
    notification.warning({
      key: scope.sammelKey,
      title: sammelTitel(eintraege),
      description:
        zeilen.length > 0 ? (
          <>
            {zeilen.map((z) => (
              <div key={z}>{z}</div>
            ))}
          </>
        ) : undefined,
      duration: 0,
      actions: (
        <>
          {ZIEL_SPRUENGE.filter(({ ziel }) => ziele.has(ziel)).map(({ ziel, text }, index) => (
            <Button
              key={ziel}
              type={index === 0 ? 'primary' : 'default'}
              onClick={() => {
                if (!scope.aktiv) return;
                navigateRef.current(zielPfad(ziel, einsatzId));
                alleSchliessen(true);
              }}
            >
              {text}
            </Button>
          ))}
        </>
      ),
      onClose: () => {
        scope.sammelOffen = false;
        // Mit der Zusammenfassung sind ihre Toasts quittiert, auch die OS-Meldungen dazu.
        for (const schluessel of [...scope.gebuendelt]) erledigt(schluessel, true);
      },
    });
  }, [alleSchliessen, einsatzId, erledigt, notification, scope]);

  const zeigeEinzeln = useCallback(
    (eintrag: Eintrag) => {
      const oeffnen = () => {
        if (!scope.aktiv) return;
        navigateRef.current(eintrag.pfad);
        notification.destroy(eintrag.key);
        erledigt(eintrag.schluessel, true);
      };
      notification[eintrag.art]({
        key: eintrag.key,
        title: eintrag.titel,
        description: eintrag.beschreibung,
        duration: 0,
        actions: (
          <Button type="primary" onClick={oeffnen}>
            Öffnen
          </Button>
        ),
        onClose: () => erledigt(eintrag.schluessel, true),
      });
    },
    [erledigt, notification, scope],
  );

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
      const id = neu.benachrichtigungId;
      // Dieselbe Benachrichtigung noch einmal (Replay, Nachreichen): nichts.
      if (scope.eintraege.has(neu.schluessel)) return 'vorhanden';

      if (scope.gebuendelt.size > 0 || scope.einzeln.length >= MAX_SICHTBARE_TOASTS) {
        for (const verdraengt of scope.einzeln) {
          const e = scope.eintraege.get(verdraengt);
          if (e) notification.destroy(e.key);
          scope.gebuendelt.add(verdraengt);
        }
        scope.einzeln = [];
        zeigeZusammenfassung();
      }

      const eintrag: Eintrag = {
        ...neu,
        key: `${scope.keyPrefix}-${neu.schluessel}`,
        ids: new Set(id != null ? [id] : []),
      };
      scope.eintraege.set(neu.schluessel, eintrag);
      scope.einzeln.push(neu.schluessel);
      zeigeEinzeln(eintrag);
      zeigeDesktop(eintrag);
      return 'neu';
    },
    [notification, scope, zeigeDesktop, zeigeEinzeln, zeigeZusammenfassung],
  );

  const entferne = useCallback(
    (schluessel: string) => {
      const eintrag = scope.eintraege.get(schluessel);
      if (!eintrag) return;
      const warEinzeln = scope.einzeln.includes(schluessel);
      if (warEinzeln) notification.destroy(eintrag.key);
      erledigt(schluessel, false);
      if (!warEinzeln) zeigeZusammenfassung();
    },
    [erledigt, notification, scope, zeigeZusammenfassung],
  );

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

  const istEinzeln = useCallback(
    (schluessel: string) => scope.einzeln.includes(schluessel),
    [scope],
  );

  const zeigt = useCallback(
    (id: number) => [...scope.eintraege.values()].some((e) => e.ids.has(id)),
    [scope],
  );

  // `duration: 0`-Notices überleben sonst ihre Komponente. Bei Logout, Unmount und vor dem
  // nächsten Einsatz werden deshalb nur die Toasts dieses Scopes zerstört, ohne Quittung.
  useEffect(() => {
    // StrictMode führt Setup → Cleanup → Setup aus; der zweite Setup gibt den Scope wieder frei.
    scope.aktiv = true;
    return () => {
      scope.aktiv = false;
      alleSchliessen(false);
    };
  }, [alleSchliessen, scope]);

  return useMemo(
    () => ({ melde, entferne, entferneBenachrichtigung, istEinzeln, zeigt }),
    [entferne, entferneBenachrichtigung, istEinzeln, melde, zeigt],
  );
}
