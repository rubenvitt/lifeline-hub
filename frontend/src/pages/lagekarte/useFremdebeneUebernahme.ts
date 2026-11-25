import { useCallback, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { legeZoneAn } from '../../api/lagezonen';
import { legeFreiesZeichenAn } from '../../api/freieZeichen';
import { einsatzKeys } from '../../api/queryKeys';
import type { Fremdebene } from '../../api/fremdebenen';
import type { FreiesZeichenUpdate, ZoneTyp } from '../../api/types';
import { uebernahmeLabel, uebernahmeNotiz, type UebernahmeTeil } from './fremdebeneUebernahme';
import type { BeginneKartenHandlung } from './useKartenFehler';
import { FREIE_SKIZZE_VORGABEFARBE } from './zonenStil';

export interface UebernahmeAuftrag {
  ebene: Fremdebene;
  teile: UebernahmeTeil[];
  name: string | null;
  beschreibung: string | null;
  /** Für Flächen und Linien. */
  zonenTyp?: ZoneTyp;
  /** Für Punkte: das Zeichen aus dem `ZeichenWahlDialog`. */
  spec?: FreiesZeichenUpdate;
}

/**
 * Legt die Teile eines Fremdebenen-Objekts nacheinander als eigene Zonen bzw. freie Zeichen an
 * (LLH-2129). `fremdebene_id` lässt den Server die Herkunft ins ETB schreiben. Der erste Fehler
 * bricht ab; die Meldung nennt, wie viele Teile schon angelegt sind (sie bleiben, wie jedes
 * gezeichnete Objekt).
 */
export function useFremdebeneUebernahme({
  einsatzId,
  ansichtId,
  beginneHandlung,
  erfolg,
}: {
  einsatzId: number;
  ansichtId: number | null;
  beginneHandlung: BeginneKartenHandlung;
  erfolg: (text: string) => void;
}) {
  const qc = useQueryClient();
  const [laeuft, setLaeuft] = useState(false);
  // Ein doppelter Tipp darf nicht alles doppelt anlegen; der State käme dafür zu spät.
  const laeuftRef = useRef(false);

  const uebernehme = useCallback(
    async (a: UebernahmeAuftrag): Promise<boolean> => {
      if (laeuftRef.current) return false;
      laeuftRef.current = true;
      const n = a.teile.length;
      let angelegt = 0;
      setLaeuft(true);
      try {
        for (const [i, teil] of a.teile.entries()) {
          const label = uebernahmeLabel(a.name, a.ebene.name, i, n);
          if (teil.art === 'punkt') {
            const [lon, lat] = teil.geometrie.coordinates;
            await legeFreiesZeichenAn(einsatzId, {
              lat,
              lon,
              ...a.spec!,
              label,
              ansicht_id: ansichtId,
              fremdebene_id: a.ebene.id,
            });
          } else {
            const typ = a.zonenTyp!;
            await legeZoneAn(einsatzId, {
              typ,
              geometrie_typ: teil.geometrie.type,
              geometrie: JSON.stringify(teil.geometrie),
              label,
              notiz: uebernahmeNotiz(a.ebene.name, a.beschreibung),
              farbe: typ === 'freie_skizze' ? FREIE_SKIZZE_VORGABEFARBE : null,
              ansicht_id: ansichtId,
              fremdebene_id: a.ebene.id,
            });
          }
          angelegt += 1;
        }
        erfolg(n === 1 ? 'Objekt übernommen' : `${n} Objekte übernommen`);
        return true;
      } catch (e) {
        beginneHandlung(
          'fremdebene-uebernehmen',
          `Übernahme abgebrochen (${angelegt} von ${n} übernommen)`,
          'Übernehmen fehlgeschlagen',
        )(e);
        return false;
      } finally {
        // Auch nach einem Abbruch: angelegte Teile sollen sofort auf der Karte stehen.
        if (angelegt > 0) {
          if (a.teile[0].art === 'punkt') {
            void qc.invalidateQueries({ queryKey: einsatzKeys.freieZeichen(einsatzId) });
          } else {
            // Ein Gefahrengebiet legt serverseitig eine Gruppe an (wie `useKartenInteraktion`).
            void qc.invalidateQueries({ queryKey: einsatzKeys.zonen(einsatzId) });
            void qc.invalidateQueries({ queryKey: einsatzKeys.gefahrengebiete(einsatzId) });
          }
        }
        laeuftRef.current = false;
        setLaeuft(false);
      }
    },
    [einsatzId, ansichtId, beginneHandlung, erfolg, qc],
  );

  return { uebernehme, laeuft };
}
