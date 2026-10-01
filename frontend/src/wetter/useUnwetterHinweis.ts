import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { spieleAlarmTon } from '../alarm/alarmTon';
import { useAnzeigeKonventionen } from '../anzeige/AnzeigeKonventionenContext';
import type { BenutzerAnzeige, ModulOverrides } from '../api/types';
import { wetterAbfrage } from '../api/wetter';
import { darfZaehlerZeigen } from '../einsatz/useModulZaehler';
import { erkenneNeue, paarSchluessel, unwetterHinweisText, unwetterLage } from './unwetter';
import { ladeGedaechtnis, speichereGedaechtnis } from './unwetterGedaechtnis';

interface Args {
  einsatzId: number;
  benutzer: BenutzerAnzeige | null;
  overrides?: ModulOverrides;
}

/**
 * Erkennt im Einsatzrahmen eine NEUE Unwetterwarnung am Einsatzort und meldet sie der
 * AlarmZentrale (LFH-663, `openspec/changes/lfh-663-unwetterwarnung-alarmbudget/design.md`
 * D2/D6). Kein Live-Ereignis: die Quelle ist extern, der Rahmen fragt nach — dieselbe Abfrage wie
 * Modulseite und Modulzähler, also kein zusätzlicher Abruf.
 *
 * Ton (`dezent`, D1) und Fenster-Ereignis `lfh:unwetter-alarm` wie beim Live-Stream: Ton beim
 * Auslöser, Hinweis in der AlarmZentrale. „Neu" entscheidet `erkenneNeue` gegen das Gedächtnis
 * je Person und Einsatz; es wird im selben synchronen Zug gelesen und geschrieben, damit Tabs
 * desselben Browsers nicht doppelt melden.
 */
export function useUnwetterHinweis({ einsatzId, benutzer, overrides }: Args): void {
  const aktiv = benutzer != null && darfZaehlerZeigen('wetter-pegel', benutzer, overrides);
  const { data } = useQuery({ ...wetterAbfrage(einsatzId), enabled: aktiv });
  const { konventionen } = useAnzeigeKonventionen();
  const benutzerId = benutzer?.id;

  useEffect(() => {
    if (!aktiv || benutzerId == null || !data) return;
    const jetzt = Date.now();
    const lage = unwetterLage(data.warnungen, jetzt);
    // Ohne verwertbaren Stand bleibt auch das Gedächtnis unberührt: eine Lücke ist kein „weg".
    if (!lage) return;
    const ergebnis = erkenneNeue(
      ladeGedaechtnis(benutzerId, einsatzId),
      [...lage.giltJetzt, ...lage.angekuendigt],
      jetzt,
    );
    speichereGedaechtnis(benutzerId, einsatzId, ergebnis.gedaechtnis);
    if (!ergebnis.neu) return;
    spieleAlarmTon('dezent');
    window.dispatchEvent(
      new CustomEvent('lfh:unwetter-alarm', {
        detail: {
          schluessel: paarSchluessel(ergebnis.neu),
          ...unwetterHinweisText(ergebnis.neu, ergebnis.weitere, jetzt, konventionen),
        },
      }),
    );
    // Die Konventionen formen nur den Text; ein Wechsel ist kein neuer Stand.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aktiv, benutzerId, einsatzId, data]);
}
