import type { AbrufZustand } from '../api/abrufZustand';
import type { ModulFreigaben, PegelAnzeige, WetterAnzeige, WetterWarnung } from '../api/types';
import { wetterAbfrage } from '../api/wetter';
import { gemeinsamerDatenstand } from '../components/Datenstand';
import { istKeyFreigegeben } from '../einsatz/modulRegistry';
import { baueLagebild, kennzahlReihe, type Lagebild } from '../pages/lage-dashboard/lagebild';
import { ladeLagebasis, type GeladeneLagebasis } from '../pages/lage-dashboard/useLagebild';
import { pegelZeile, wasserstandMeter } from '../pegel/pegelKennzahl';
import { ZUSTAND_GRUND, md } from '../stab/funkplan';
import { ausKennzahl, sichtungText, warnstufeAngabe } from '../stab/vorbereitung';
import { dwdWarnstufe } from '../theme/statusFarben';
import {
  messStand,
  teilStand,
  teileWarnungen,
  VERALTET,
  type TeilStand,
} from '../wetter/wetterStand';
import {
  stationText,
  temperaturText,
  titelSchreibung,
  warnZeitraum,
  wetterSymbolWort,
  windText,
  zahlText,
} from '../wetter/wetterText';
import { gesperrt, ladeListe, type Geladen, type UebernahmeQuelle } from './uebernahmeQuelle';

/** Welche Module die Teile lesen. Der Pegel hat keine Modulgrenze (wie im Dashboard). */
const MODUL = {
  personen: { key: 'personen', name: 'Personen' },
  schaeden: { key: 'schaeden', name: 'Schäden' },
  gefahrenzonen: { key: 'gefahrenzonen', name: 'Gefahrenzonen' },
  wetter: { key: 'wetter-pegel', name: 'Wetter & Pegel' },
} as const;

/** Die Kern-Reihe der Vorbereitung: ohne Lageplätze (Pegel, Evakuiert), siehe `VorbereitungPaneel`. */
const KERN_REIHE = kennzahlReihe([]);

const AUSFALL = '— (Ausfall)';

const frei = (m: keyof typeof MODUL, freigaben: ModulFreigaben) =>
  istKeyFreigegeben(MODUL[m].key, freigaben);

const grund = (zustand: Exclude<AbrufZustand, 'daten'>) => `— (${ZUSTAND_GRUND[zustand]})`;

function aufzaehlung(namen: string[]): string {
  return namen.length <= 1
    ? namen.join('')
    : `${namen.slice(0, -1).join(', ')} und ${namen[namen.length - 1]}`;
}

/** „- Titel: Wert (Notiz)“ — dieselben Werte wie die Zeilen der Vorbereitung. */
function zeile(titel: string, a: { wert: string; notiz: string | null }): string {
  return `- ${titel}: ${md(a.wert)}${a.notiz ? ` (${md(a.notiz)})` : ''}`;
}

/**
 * Die Zeilen eines Lagebild-Teils: ohne Daten je Zeile „— (Grund)“, nie 0. Ohne Einsatz trägt
 * jede Zeile dessen Zustand.
 */
function lagebildZeilen(
  lb: Lagebild | null,
  zustand: AbrufZustand,
  zeilen: Array<[string, (l: Lagebild) => { wert: string; notiz: string | null }]>,
): string[] {
  return zeilen.map(([titel, angabe]) =>
    lb && zustand === 'daten'
      ? zeile(titel, angabe(lb))
      : `- ${titel}: ${grund(zustand === 'daten' ? 'laden' : zustand)}`,
  );
}

/** „(Station Bremen, 4,2 km · Messung <DTG> · veraltet)“ — Herkunft, Stand und Alter wie im Paneel. */
function standKlammer(
  vorne: string | null,
  wort: 'Stand' | 'Messung',
  stand: TeilStand,
  zeitpunkt: string,
  dtg: (iso: string) => string,
): string {
  const teile = [
    ...(vorne ? [md(vorne)] : []),
    `${wort} ${dtg(zeitpunkt)}`,
    ...(stand.art === 'veraltet' ? [VERALTET] : []),
  ];
  return `(${teile.join(' · ')})`;
}

function warnungsZeile(
  art: string,
  w: WetterWarnung,
  jetzt: number,
  dtg: (iso: string) => string,
): string {
  return (
    `  - ${art}: ${dwdWarnstufe[w.stufe].label} · ${md(titelSchreibung(w.ereignis))} · ` +
    warnZeitraum(w.beginn, w.ende, jetzt, undefined, dtg)
  );
}

/**
 * Wetter am Einsatzort nach den Regeln der Modulseite „Wetter & Pegel“ (`WetterPaneele`):
 * `teileWarnungen` trennt geltende und angekündigte, abgelaufene fallen heraus; `teilStand` und
 * `messStand` entscheiden über Ausfall und Alter. Zeiten als DTG, weil der Vortrag ins ETB geht.
 * Beschreibung und Handlungsempfehlung des DWD bleiben draußen.
 */
function wetterZeilen(w: WetterAnzeige, jetzt: number, dtg: (iso: string) => string): string[] {
  const ws = teilStand(w.warnungen, 'warnungen', jetzt);
  const as = messStand(w.aktuell, jetzt);
  if (ws.art === 'kein_ort' && as.art === 'kein_ort') return ['- kein Einsatzort'];

  const ort = w.ort?.name?.trim() ? ` für ${md(w.ort.name.trim())}` : '';
  const warnungen = ((): string[] => {
    if (ws.art === 'kein_ort') return ['- Warnungen: kein Einsatzort'];
    if (ws.art === 'unbekannt' || !w.warnungen.abgerufen_at) return [`- Warnungen: ${AUSFALL}`];
    const klammer = standKlammer(null, 'Stand', ws, w.warnungen.abgerufen_at, dtg);
    const { giltJetzt, angekuendigt } = teileWarnungen(w.warnungen.daten ?? [], jetzt);
    if (giltJetzt.length + angekuendigt.length === 0) {
      return [`- Warnungen: keine gültigen${ort} ${klammer}`];
    }
    return [
      `- Warnungen${ort} ${klammer}`,
      ...giltJetzt.map((x) => warnungsZeile('gilt jetzt', x, jetzt, dtg)),
      ...angekuendigt.map((x) => warnungsZeile('angekündigt', x, jetzt, dtg)),
    ];
  })();

  const aktuell = ((): string => {
    if (as.art === 'kein_ort') return '- Aktuell: kein Einsatzort';
    const a = w.aktuell.daten;
    if (as.art === 'unbekannt' || !a) return `- Aktuell: ${AUSFALL}`;
    const werte = [
      temperaturText(a.temperatur_c),
      ...(a.symbol ? [wetterSymbolWort(a.symbol)] : []),
      `Wind ${windText(a.wind_kmh, a.boeen_kmh, a.windrichtung_grad)}`,
      ...(a.niederschlag_mm != null ? [`Niederschlag ${zahlText(a.niederschlag_mm, 1)} mm/h`] : []),
    ];
    const station = stationText(a.station.name, a.station.entfernung_m);
    return `- Aktuell: ${werte.join(' · ')} ${standKlammer(station, 'Messung', as, a.gemessen_at, dtg)}`;
  })();

  return [...warnungen, aktuell];
}

/**
 * Je maßgeblichem Pegel eine Zeile in der festgelegten Reihenfolge, nach `pegelZeile` (dieselben
 * Regeln wie Kennzahl und Modulseite). Messzeit und Prognose als DTG.
 */
function pegelZeilen(pegel: readonly PegelAnzeige[], jetzt: number, dtg: (iso: string) => string) {
  if (pegel.length === 0) return ['- keine maßgeblichen Pegel festgelegt'];
  return pegel.map((p) => {
    const z = pegelZeile(p, jetzt);
    const name = md(z.gewaesser ? `${z.name} · ${z.gewaesser}` : z.name);
    const prognose =
      z.prognose && p.prognose
        ? [
            `Prognose ${wasserstandMeter(p.prognose.hoechststand_cm)} m bis ${dtg(p.prognose.zeitpunkt)}`,
          ]
        : [];
    if (z.fall === 'ausfall' || !p.messung) {
      return `- ${name}: ${[z.wert, z.stand, ...prognose].join(' · ')}`;
    }
    return `- ${name}: ${[
      `${z.wert} m`,
      ...(z.trend ? [z.trend] : []),
      `Messung ${dtg(p.messung.zeitpunkt)}`,
      ...(z.veraltet ? [VERALTET] : []),
      ...prognose,
    ].join(' · ')}`;
  });
}

/**
 * „Aus dem Lagebild übernehmen“ im Abschnitt „Gefahren-/Schadenlage“ (LFH-872, Spec
 * `lagevortrag-uebernahme`). Betroffene, Sichtung, Schäden und Warnstufe aus `baueLagebild` über
 * `ladeLagebasis` (dieselbe Zusammenstellung wie Dashboard und Vorbereitung), im Wortlaut der
 * Vorbereitung. Keine Personen- oder Schadensfelder, nur Zahlen.
 */
export const SCHADENLAGE_QUELLE: UebernahmeQuelle = {
  knopf: 'Aus dem Lagebild übernehmen',
  unterzeile: 'Betroffene, Schäden, Warnstufe, Wetter und Pegel, nur Zahlen',
  ersetzenTitel: 'Gefahren-/Schadenlage ersetzen?',
  ersetzenText:
    'Der Abschnitt enthält schon Text. Er wird durch die aktuellen Zahlen aus Lagebild, Wetter und Pegeln ersetzt.',
  verfuegbar: (freigaben) => {
    const gesperrteModule = (Object.keys(MODUL) as (keyof typeof MODUL)[]).filter(
      (m) => !frei(m, freigaben),
    );
    return gesperrteModule.length < Object.keys(MODUL).length
      ? { frei: true }
      : {
          frei: false,
          grund: `${aufzaehlung(gesperrteModule.map((m) => MODUL[m].name))} nicht freigegeben`,
        };
  },
  erzeuge: async ({ qc, einsatzId, freigaben, dtg }) => {
    const wetterFrei = frei('wetter', freigaben);
    const abfrage = wetterAbfrage(einsatzId);
    const [lage, wetter]: [GeladeneLagebasis, Geladen<WetterAnzeige | null>] = await Promise.all([
      ladeLagebasis(qc, einsatzId, freigaben, {
        quellen: ['personen', 'schaeden', 'gefahren'],
        mitPegel: true,
      }),
      wetterFrei
        ? ladeListe<WetterAnzeige | null>(qc, abfrage.queryKey, abfrage.queryFn, null)
        : Promise.resolve(gesperrt<WetterAnzeige | null>(null)),
    ]);
    const jetzt = Date.now();
    const lb = lage.basis
      ? baueLagebild(
          { ...lage.basis, evakuierung: { zustand: 'laden' } },
          jetzt,
          undefined,
          KERN_REIHE,
        )
      : null;
    const zustand = (q: 'personen' | 'schaeden' | 'gefahren' | 'pegel'): AbrufZustand =>
      lage.basis ? (lage.zustand[q] ?? 'laden') : lage.zustand.einsatz;

    const betroffene = lagebildZeilen(lb, zustand('personen'), [
      ['Betroffene', (l) => ausKennzahl(l, 'Betroffene')],
      ['Vermisste', (l) => ausKennzahl(l, 'Vermisste')],
      ['Sichtung', (l) => ({ wert: sichtungText(l.sk), notiz: null })],
    ]);
    const schaeden = [
      ...lagebildZeilen(lb, zustand('schaeden'), [
        ['Schäden offen', (l) => ausKennzahl(l, 'Schäden offen')],
      ]),
      ...lagebildZeilen(lb, zustand('gefahren'), [['Höchste Warnstufe', warnstufeAngabe]]),
    ];
    const wetterTeil =
      wetter.zustand === 'daten' && wetter.daten
        ? wetterZeilen(wetter.daten, jetzt, dtg)
        : [`- ${grund(wetter.zustand === 'daten' ? 'fehler' : wetter.zustand)}`];
    const pegelZustand = zustand('pegel');
    const pegelTeil =
      pegelZustand === 'daten' && lage.basis
        ? pegelZeilen(lage.basis.pegel, jetzt, dtg)
        : [`- ${grund(pegelZustand === 'daten' ? 'laden' : pegelZustand)}`];

    const stand = gemeinsamerDatenstand(lage.stand ?? 0, wetter.stand ?? 0) || jetzt;

    return [
      `**Stand:** ${dtg(new Date(stand).toISOString())}`,
      '',
      '**Betroffene**',
      ...betroffene,
      '',
      '**Schäden und Gefahren**',
      ...schaeden,
      '',
      '**Wetter**',
      ...wetterTeil,
      '',
      '**Pegel**',
      ...pegelTeil,
      '',
    ].join('\n');
  },
};
