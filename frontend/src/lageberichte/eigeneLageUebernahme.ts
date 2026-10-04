import type { AbrufZustand } from '../api/abrufZustand';
import { listeAbschnitte } from '../api/einsatzabschnitte';
import { listeEinheiten } from '../api/einheiten';
import { listeEinsatzFahrzeuge } from '../api/einsatzFahrzeuge';
import { listeEinsatzMaterial } from '../api/einsatzMaterial';
import { listeEinsatzPersonal } from '../api/einsatzPersonal';
import { einsatzKeys } from '../api/queryKeys';
import { ladeStab } from '../api/stab';
import type { ModulFreigaben } from '../api/types';
import { gemeinsamerDatenstand } from '../components/Datenstand';
import { istKeyFreigegeben } from '../einsatz/modulRegistry';
import { baueKraeftebild, rendereMeldebildMarkdown } from '../kraefte/kraeftebild';
import {
  baueFuehrungsorganisation,
  rendereFuehrungsorganisationMarkdown,
} from '../pages/einsatzabschnitte/fuehrungsorganisation';
import { ZUSTAND_GRUND } from '../stab/funkplan';
import { gesperrt, ladeListe, type Geladen, type UebernahmeQuelle } from './uebernahmeQuelle';

/**
 * Die Listen der beiden Teile, mit dem Modul, das ihren Pfad freigibt (`PFAD_KEY`), und ob die
 * Führungsorganisation ohne sie nicht auskommt. Die Teilmengen werden hieraus gefiltert, nicht als
 * String-Arrays geschrieben: die hielte der Query-Key-Guard für Inline-Keys.
 */
const LISTE = {
  abschnitte: { modul: 'einsatzabschnitte', name: 'Abschnitte', organisation: true },
  einheiten: { modul: 'einheiten', name: 'Einheiten', organisation: false },
  personal: { modul: 'personal', name: 'Personal', organisation: false },
  fahrzeuge: { modul: 'fahrzeuge', name: 'Fahrzeuge', organisation: false },
  material: { modul: 'material', name: 'Material', organisation: false },
} as const;
type Liste = keyof typeof LISTE;

/**
 * Das Kräftemeldebild braucht alle fünf Listen (in der Reihenfolge von `LISTE`): sein Renderer rechnete eine fehlende als 0 und
 * bleibt unverändert („gleicher Text wie die Einzelübernahme“, design.md D3). Die
 * Führungsorganisation braucht nur die Abschnitte; fehlende Einheiten und den Stab führt ihr
 * Renderer selbst.
 */
const MELDEBILD = Object.keys(LISTE) as readonly Liste[];
const ORGANISATION = MELDEBILD.filter((l) => LISTE[l].organisation);

const nichtFrei = (listen: readonly Liste[], freigaben: ModulFreigaben) =>
  listen.filter((l) => !istKeyFreigegeben(LISTE[l].modul, freigaben)).map((l) => LISTE[l].name);

/** „— nicht freigegeben (Personal); nicht geladen (Material)“: je Grund die betroffenen Listen. */
function fehlt(zustaende: [Liste, AbrufZustand][]): string {
  const jeGrund = new Map<string, string[]>();
  for (const [liste, zustand] of zustaende) {
    if (zustand === 'daten') continue;
    const grund = ZUSTAND_GRUND[zustand];
    jeGrund.set(grund, [...(jeGrund.get(grund) ?? []), LISTE[liste].name]);
  }
  return `— ${[...jeGrund].map(([grund, namen]) => `${grund} (${namen.join(', ')})`).join('; ')}`;
}

const teilFehlt = (titel: string, zustaende: [Liste, AbrufZustand][]) =>
  `# ${titel}\n\n${fehlt(zustaende)}\n`;

/**
 * „Aus Meldebild und Führungsorganisation übernehmen“ im Abschnitt „Eigene Lage“ (LFH-870, Spec
 * `lagevortrag-uebernahme`). Beide Teile mit den Renderern der Einzelübernahmen, für den ganzen
 * Einsatz (ohne Filter), jeder mit dem Stand seiner ältesten Liste. Rechnet keine Zahl selbst.
 */
export const EIGENE_LAGE_QUELLE: UebernahmeQuelle = {
  knopf: 'Aus Meldebild und Führungsorganisation übernehmen',
  unterzeile: 'Kräftemeldebild und Führungsorganisation des ganzen Einsatzes',
  ersetzenTitel: 'Eigene Lage ersetzen?',
  ersetzenText:
    'Der Abschnitt enthält schon Text. Er wird durch das aktuelle Kräftemeldebild und die Führungsorganisation ersetzt.',
  verfuegbar: (freigaben) => {
    const meldebild = nichtFrei(MELDEBILD, freigaben);
    const organisation = nichtFrei(ORGANISATION, freigaben);
    if (meldebild.length === 0 || organisation.length === 0) return { frei: true };
    return {
      frei: false,
      grund:
        `Kräftemeldebild nicht freigegeben (${meldebild.join(', ')}), ` +
        `Führungsorganisation nicht freigegeben (${organisation.join(', ')})`,
    };
  },
  erzeuge: async ({ qc, einsatzId, freigaben, dtg }) => {
    const frei = (l: Liste) => istKeyFreigegeben(LISTE[l].modul, freigaben);
    // Nur was frei ist, geht an den Server: ein Abruf auf Verdacht endete in 403 (Spec
    // `modul-freigabe`). Abschnitte und Einheiten teilen sich beide Teile.
    const lade = <T>(l: Liste, key: readonly unknown[], fn: () => Promise<T[]>) =>
      frei(l) ? ladeListe<T[]>(qc, key, fn, []) : Promise.resolve(gesperrt<T[]>([]));
    const stabFrei = istKeyFreigegeben('stab', freigaben);
    const [abschnitte, einheiten, personal, fahrzeuge, material, stab] = await Promise.all([
      lade('abschnitte', einsatzKeys.abschnitte(einsatzId), () => listeAbschnitte(einsatzId)),
      lade('einheiten', einsatzKeys.einheiten(einsatzId), () => listeEinheiten(einsatzId)),
      lade('personal', einsatzKeys.personal(einsatzId), () => listeEinsatzPersonal(einsatzId)),
      lade('fahrzeuge', einsatzKeys.fahrzeuge(einsatzId), () => listeEinsatzFahrzeuge(einsatzId)),
      lade('material', einsatzKeys.material(einsatzId), () => listeEinsatzMaterial(einsatzId)),
      stabFrei
        ? ladeListe(qc, einsatzKeys.stab(einsatzId), () => ladeStab(einsatzId), null)
        : Promise.resolve(null),
    ]);
    const listen: Record<Liste, Geladen<unknown[]>> = {
      abschnitte,
      einheiten,
      personal,
      fahrzeuge,
      material,
    };
    const zustaende = (teil: readonly Liste[]): [Liste, AbrufZustand][] =>
      teil.map((l) => [l, listen[l].zustand]);
    const stand = (...teil: Array<Geladen<unknown> | null>) =>
      dtg(
        new Date(gemeinsamerDatenstand(...teil.map((g) => g?.stand)) || Date.now()).toISOString(),
      );

    const meldebild = zustaende(MELDEBILD).every(([, z]) => z === 'daten')
      ? rendereMeldebildMarkdown(
          baueKraeftebild(
            abschnitte.daten,
            einheiten.daten,
            personal.daten,
            fahrzeuge.daten,
            material.daten,
          ),
          stand(abschnitte, einheiten, personal, fahrzeuge, material),
        )
      : teilFehlt('Kräftemeldebild', zustaende(MELDEBILD));

    const organisation =
      abschnitte.zustand === 'daten'
        ? rendereFuehrungsorganisationMarkdown(
            baueFuehrungsorganisation(
              abschnitte.daten,
              einheiten.zustand === 'daten' ? einheiten.daten : null,
            ),
            {
              stand: stand(abschnitte, einheiten.zustand === 'daten' ? einheiten : null, stab),
              // Wie im Organigramm: ohne Freigabe kein Wort, gescheitert „nicht geladen“.
              stab:
                stab == null || stab.zustand === 'gesperrt'
                  ? null
                  : stab.zustand === 'daten' && stab.daten != null
                    ? stab.daten.besetzung
                    : 'fehler',
              einheitenZustand: einheiten.zustand,
            },
          )
        : teilFehlt('Führungsorganisation', zustaende(ORGANISATION));

    return `${meldebild}\n${organisation}`;
  },
};
