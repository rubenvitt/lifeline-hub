/**
 * Die Quellen der Alarmzeile aus der Antwort des Lagemonitors (LLH-1743, design.md D5): dieselben
 * Eingaben wie im Browser (`useWasBrennt`), nur vom Server verdichtet. So zeigen Monitor,
 * Überblick und Lagebild dieselbe Folge und denselben Wortlaut. Den Ausfall trägt der Monitor
 * nicht (D6): die Quelle fehlt (`null`), statt als unvollständig zu gelten.
 */
import type { LagemonitorAnzeige } from '../api/types';
import type { WasBrenntQuellen } from './wasBrennt';

export function alarmAusMonitor(lage: LagemonitorAnzeige | undefined): WasBrenntQuellen {
  const a = lage?.alarm;
  if (!lage || !a) {
    const laden = { zustand: 'laden' } as const;
    return {
      meldungen: laden,
      auftraege: laden,
      erinnerungen: laden,
      nachforderungen: laden,
      vermisst: laden,
      kritisch: laden,
      rueckmeldung: laden,
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
    ausfall: null,
  };
}
