import { useEffect, useRef } from 'react';
import {
  ladeBenachrichtigung,
  ladeOffeneBenachrichtigungen,
  quittiereBenachrichtigung,
} from '../api/benachrichtigungen';
import { ApiError } from '../api/client';
import type { BenachrichtigungAnzeige, BenachrichtigungEreignis } from '../api/types';
import { useAnzeigeKonventionen } from '../anzeige/AnzeigeKonventionenContext';
import { alsZeitpunkt, zuWanduhr } from '../anzeige/zeitEingabe';
import {
  BENACHRICHTIGUNG_WINDOW_EVENT,
  NACHREICHEN_WINDOW_EVENT,
} from '../live/benachrichtigungListener';
import { spieleAlarmTon } from './alarmTon';
import {
  BENACHRICHTIGUNG_ARTEN,
  ersatzPfad,
  istOrgArt,
  sammelGruppeVon,
  toastSchluessel,
  zielVon,
} from './benachrichtigungKatalog';
import { gezeigt, inArbeit, quittiert } from './benachrichtigungGedaechtnis';
import type { AlarmToastEintrag, AlarmToasts } from './useAlarmToasts';
import { schliessePushMeldungen } from './webPush';

/**
 * Quittiert auf dem Server; der Server meldet es allen Verbindungen des Nutzers (Spec
 * „Quittieren gilt für alle Verbindungen“). Scheitert der Aufruf, darf das Nachreichen sie
 * wieder zeigen: verloren ist dann nur ein Klick, nicht die Benachrichtigung.
 */
export function quittiereNachNutzer(id: number): void {
  if (quittiert.has(id)) return;
  quittiert.add(id);
  void schliessePushMeldungen(id);
  quittiereBenachrichtigung(id).catch(() => quittiert.delete(id));
}

type Bezug = Pick<BenachrichtigungEreignis, 'art' | 'einsatz_id'>;

/** Gehört die Benachrichtigung in diese Zentrale? Org-Arten überall, sonst nur im Einsatz. */
function passt(e: Bezug, einsatzId: number | null): boolean {
  return istOrgArt(e.art) || (einsatzId != null && e.einsatz_id === einsatzId);
}

/**
 * Ersatz, wenn der Text nicht zu holen war (Netz, Server): Name der Art und Sprung ins Modul. Ein
 * Alarm darf an einem langsamen Server nicht hängen bleiben.
 */
function ersatzAnzeige(e: BenachrichtigungEreignis): BenachrichtigungAnzeige {
  return {
    id: e.benachrichtigung_id,
    einsatz_id: e.einsatz_id,
    art: e.art,
    stufe: e.stufe,
    bezug_typ: e.bezug_typ,
    bezug_id: e.bezug_id,
    erstellt_at: '',
    titel: BENACHRICHTIGUNG_ARTEN[e.art]?.name ?? 'Benachrichtigung',
    pfad: ersatzPfad(e),
  };
}

function eintragVon(
  a: BenachrichtigungAnzeige,
  opts: { uhrzeit: string | null; desktop: boolean },
): AlarmToastEintrag {
  const schluessel = toastSchluessel({ ...a, benachrichtigung_id: a.id });
  const beschreibung = [a.detail, opts.uhrzeit].filter(Boolean).join(' · ') || undefined;
  return {
    schluessel,
    art: a.stufe === 'alarm' ? 'warning' : 'info',
    titel: a.titel,
    beschreibung,
    pfad: a.pfad,
    ziel: zielVon(a),
    gruppe: sammelGruppeVon(a.art),
    name: BENACHRICHTIGUNG_ARTEN[a.art]?.name ?? a.titel,
    stufe: a.stufe,
    benachrichtigungId: a.id,
    // `tag` `<einsatz>-<schlüssel>`: dieselbe Benachrichtigung ersetzt ihre OS-Meldung.
    desktop: opts.desktop ? { tag: `${a.einsatz_id}-${schluessel}` } : undefined,
  };
}

/**
 * Benachrichtigungen in einer Zentrale (design.md D5). Hört auf das Live-Ereignis (über
 * `live/benachrichtigungListener.ts`), holt den Text (`GET /api/benachrichtigungen/{id}`), zeigt
 * den Toast im gemeinsamen Budget und spielt den Ton der Stufe; das Quittier-Ereignis nimmt ihn
 * weg. Eine fremde oder aufgeräumte Benachrichtigung (4xx) bleibt still.
 *
 * Nachreichen beim Mount (Öffnen eines Einsatzes, Org-Layout) und auf Bitte des Stroms (`lagged`,
 * Neuaufbau): die offene Liste, älteste zuerst, damit die jüngste einzeln stehen bleibt; mit
 * Uhrzeit, und für alles zusammen höchstens EIN dezenter Ton. Eine OS-Meldung nur für Alarme.
 *
 * `einsatzId` `null` ist die Org-Zentrale: nur Org-Arten.
 */
export function useBenachrichtigungen(einsatzId: number | null, toasts: AlarmToasts): void {
  // Über eine Ref: lädt die Anzeigezone nach, soll das nicht noch einmal nachreichen.
  const zoneRef = useRef<string | null>(null);
  zoneRef.current = useAnzeigeKonventionen().konventionen.zeitzone ?? null;

  useEffect(() => {
    let aktiv = true;

    const uhrzeitVon = (a: BenachrichtigungAnzeige): string | null => {
      const t = alsZeitpunkt(a.erstellt_at);
      return t ? zuWanduhr(t, zoneRef.current).format('HH:mm') : null;
    };

    const unbekannt = (id: number) => !quittiert.has(id) && !inArbeit.has(id) && !toasts.zeigt(id);

    const beiEreignis = async (ev: Event) => {
      const e = (ev as CustomEvent<BenachrichtigungEreignis>).detail;
      if (!e) return;
      // Die Push-Meldung (LLH-1223) steht unabhängig davon, welche Zentrale sie zeigen würde.
      if (e.quittiert) void schliessePushMeldungen(e.benachrichtigung_id);
      if (!passt(e, einsatzId)) return;
      const id = e.benachrichtigung_id;
      if (e.quittiert) {
        quittiert.add(id);
        toasts.entferneBenachrichtigung(id);
        return;
      }
      if (!unbekannt(id)) return;
      inArbeit.add(id);
      let anzeige: BenachrichtigungAnzeige;
      try {
        anzeige = await ladeBenachrichtigung(id);
      } catch (fehler) {
        if (fehler instanceof ApiError && fehler.status < 500) return;
        anzeige = ersatzAnzeige(e);
      } finally {
        inArbeit.delete(id);
      }
      if (!aktiv || quittiert.has(id) || anzeige.quittiert_at) return;
      const ergebnis = toasts.melde(eintragVon(anzeige, { uhrzeit: null, desktop: true }));
      if (ergebnis === 'inaktiv') return;
      gezeigt.add(id);
      if (ergebnis === 'neu') spieleAlarmTon(e.stufe === 'alarm' ? 'alarm' : 'dezent');
    };

    // Ein Abruf zur Zeit; eine Bitte währenddessen holt danach noch einmal.
    let laeuft = false;
    let nochmal = false;
    const nachreichen = async () => {
      if (laeuft) {
        nochmal = true;
        return;
      }
      laeuft = true;
      try {
        do {
          nochmal = false;
          let liste: BenachrichtigungAnzeige[];
          try {
            liste = await ladeOffeneBenachrichtigungen();
          } catch {
            return;
          }
          if (!aktiv) return;
          let ton = false;
          // Der Server liefert jüngste zuerst.
          for (const a of [...liste].reverse()) {
            if (a.quittiert_at || !passt(a, einsatzId) || !unbekannt(a.id)) continue;
            const wiederholt = gezeigt.has(a.id);
            const ergebnis = toasts.melde(
              eintragVon(a, {
                uhrzeit: uhrzeitVon(a),
                desktop: !wiederholt && a.stufe === 'alarm',
              }),
            );
            if (ergebnis === 'inaktiv') return;
            gezeigt.add(a.id);
            if (ergebnis === 'neu' && !wiederholt) ton = true;
          }
          if (ton) spieleAlarmTon('dezent');
        } while (nochmal && aktiv);
      } finally {
        laeuft = false;
      }
    };

    const beiNachreichen = () => void nachreichen();
    window.addEventListener(BENACHRICHTIGUNG_WINDOW_EVENT, beiEreignis);
    window.addEventListener(NACHREICHEN_WINDOW_EVENT, beiNachreichen);
    void nachreichen();
    return () => {
      aktiv = false;
      window.removeEventListener(BENACHRICHTIGUNG_WINDOW_EVENT, beiEreignis);
      window.removeEventListener(NACHREICHEN_WINDOW_EVENT, beiNachreichen);
    };
  }, [einsatzId, toasts]);
}
