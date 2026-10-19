import { useCallback } from 'react';
import { registrierAnzeige } from '../api/einsatzPerson';
import type { Person } from '../api/types';
import { useAuthOptional } from '../auth/AuthContext';
import { neueClientId } from '../offline/clientId';
import {
  sendPersonEintrag,
  type PersonEintragAktion,
  type PersonEintragAntwort,
  type PersonEintragArt,
  type PersonEintragDaten,
} from '../offline/personEintrag';
import { savePersonEintragOfflineCapable, type OfflineSchreibErgebnis } from '../offline/schreiben';
import {
  MASSNAHME_WORT,
  SK_META,
  VERLETZUNG_ART_WORT,
  kurzVerbleib,
  transportText,
} from './personMeta';
import { regionName } from './koerperschema/koerperschemaKern';

/** Die Person, an der ein Eintrag entsteht; die Registriernummer nennt sie in der Queue. */
export type PersonZiel = Pick<Person, 'id' | 'registrier_nr'>;

export type SavePersonEintrag = <A extends PersonEintragArt>(
  einsatzId: number,
  person: PersonZiel,
  art: A,
  eingabe: PersonEintragDaten[A],
) => Promise<OfflineSchreibErgebnis<PersonEintragAntwort[A]>>;

/**
 * Der eine Schreibweg der medizinischen Einträge an jeder Ansatzstelle (LLH-1138, design.md D8):
 * Patientenkopf, Zeilen-Sichtung, Sichtungsdialog, Verbleib-Dialog und Grundriss. Ohne Netz merkt
 * er vor (`savePersonEintragOfflineCapable`); die Mutation dazu läuft mit `networkMode: 'always'`
 * (`frontend/src/offline/AGENTS.md`, „Schreiben ohne Netz“).
 *
 * Ohne angemeldeten Benutzer gibt es keinen Besitzer der Warteschlange: dann wird nur gesendet,
 * mit derselben `client_id` im Body.
 */
export function useSavePersonEintrag(): SavePersonEintrag {
  const benutzerId = useAuthOptional()?.benutzer?.id;
  return useCallback(
    <A extends PersonEintragArt>(
      einsatzId: number,
      person: PersonZiel,
      art: A,
      eingabe: PersonEintragDaten[A],
    ): Promise<OfflineSchreibErgebnis<PersonEintragAntwort[A]>> => {
      const ziel = { id: person.id, bezeichnung: registrierAnzeige(person.registrier_nr) };
      if (benutzerId != null) {
        return savePersonEintragOfflineCapable(benutzerId, einsatzId, ziel, art, eingabe);
      }
      const aktion = {
        art,
        person_id: person.id,
        bezeichnung: ziel.bezeichnung,
        daten: { ...eingabe, client_id: eingabe.client_id ?? neueClientId() },
      } as PersonEintragAktion;
      return sendPersonEintrag(einsatzId, aktion, {}).then((daten) => ({
        zustand: 'gesendet' as const,
        daten: daten as PersonEintragAntwort[A],
      }));
    },
    [benutzerId],
  );
}

/** Ein vorgemerkter Eintrag in einer Zeile: „Sichtung SK I“, „Maßnahme Zugang“ (D8, Anzeige). */
export function vormerkungText(aktion: PersonEintragAktion): string {
  switch (aktion.art) {
    case 'sichtung':
      return `Sichtung ${SK_META[aktion.daten.kategorie].label}`;
    case 'verbleib':
      return `Verbleib ${kurzVerbleib({
        art: aktion.daten.art,
        ziel: aktion.daten.ziel ?? null,
        transportmittel: aktion.daten.transportmittel ?? null,
        status: aktion.daten.status ?? null,
        transport_durch: aktion.daten.transport_durch ?? null,
      })}`;
    case 'transport':
      return `Transport ${
        transportText({
          transport_prioritaet: aktion.daten.prioritaet,
          transport_art: aktion.daten.art,
          transport_fachrichtung: aktion.daten.fachrichtung,
        }) ?? 'aufgehoben'
      }`;
    case 'massnahme':
      return `Maßnahme ${MASSNAHME_WORT[aktion.daten.art]}`;
    case 'verletzung':
      return `Verletzung ${regionName(aktion.daten.ansicht, aktion.daten.region)} · ${
        VERLETZUNG_ART_WORT[aktion.daten.art]
      }`;
    case 'notiz':
      return `Notiz „${aktion.daten.text}“`;
    default: {
      const nie: never = aktion;
      return String(nie);
    }
  }
}
