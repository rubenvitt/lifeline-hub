/**
 * Die Quellen der Alarmzeile aus der Antwort des Lagemonitors (LLH-1743, design.md D5): dieselben
 * Eingaben wie im Browser (`useWasBrennt`), nur vom Server verdichtet. So zeigen Monitor,
 * Überblick und Lagebild dieselbe Folge und denselben Wortlaut. Den Ausfall zählt der Server nach
 * der Regel des Meldebilds (`einsatz::ausfall`, LLH-1929), in der Folge der Einheitenliste wie
 * `einheitenMitAusfall`. Fehlt das Feld (älterer Server), fehlt die Quelle (`null`), statt als
 * unvollständig zu gelten.
 */
import type { LagemonitorAnzeige } from '../api/types';
import type { WasBrenntQuellen } from './wasBrennt';

/**
 * `fehler`: der Abruf ist gescheitert (Review LLH-1743). Ohne Daten heißt das „Stand
 * unvollständig“, nicht „lädt“; eine Antwort ohne Block `alarm` (älterer Server) ebenso.
 */
export function alarmAusMonitor(
  lage: LagemonitorAnzeige | undefined,
  fehler = false,
): WasBrenntQuellen {
  const a = lage?.alarm;
  if (!lage || !a) {
    const ohne = { zustand: lage || fehler ? 'fehler' : 'laden' } as const;
    return {
      meldungen: ohne,
      auftraege: ohne,
      erinnerungen: ohne,
      nachforderungen: ohne,
      vermisst: lage ? { zustand: 'daten', wert: lage.betroffene.vermisst } : ohne,
      kritisch: ohne,
      rueckmeldung: ohne,
      ausfall: null,
    };
  }
  return {
    meldungen: {
      zustand: 'daten',
      wert: {
        sofort_offen: a.sofort_offen,
        sofort_aelteste_at: a.sofort_aelteste_at,
        dringend_offen: a.dringend_offen,
        bestaetigung_ueberfaellig: a.bestaetigung_ueberfaellig,
      },
    },
    auftraege: { zustand: 'daten', wert: { ueberfaellig: a.auftraege_ueberfaellig } },
    erinnerungen: { zustand: 'daten', wert: { faellig: a.erinnerungen_faellig } },
    nachforderungen: { zustand: 'daten', wert: { ueberfaellig: a.nachforderungen_ueberfaellig } },
    vermisst: { zustand: 'daten', wert: lage.betroffene.vermisst },
    kritisch: {
      zustand: 'daten',
      wert: a.abschnitte_kritisch.map((name) => ({ id: null, name })),
    },
    rueckmeldung: {
      zustand: 'daten',
      wert: a.rueckmeldung_ueberfaellig.map((r) => ({
        id: null,
        name: r.einheit,
        seitMin: r.seit_min,
      })),
    },
    ausfall: Array.isArray(a.ausfall)
      ? { zustand: 'daten', wert: a.ausfall.map((name) => ({ id: null, name })) }
      : null,
  };
}
