import type { AbrufZustand } from '../api/abrufZustand';
import { listeAuftraege } from '../api/auftraege';
import { ladeFuehrungsstelle } from '../api/einsaetze';
import { listeAbschnitte } from '../api/einsatzabschnitte';
import { listeEinheiten } from '../api/einheiten';
import { listeMeldungen } from '../api/meldungen';
import { ladeModulZaehler } from '../api/modulZaehler';
import { einsatzKeys } from '../api/queryKeys';
import { listeEinsatzSprechgruppen } from '../api/sprechgruppen';
import type { Auftrag, Meldung, ModulFreigaben } from '../api/types';
import { gemeinsamerDatenstand } from '../components/Datenstand';
import { istKeyFreigegeben } from '../einsatz/modulRegistry';
import { MELDUNGSART_LABEL, istAlarmiert } from '../meldungen/meldungKennzahlen';
import { istOffen } from '../pages/fuehrung/ueberblickDaten';
import { auftraegeNotiz } from '../pages/lage-dashboard/fuehrungsZahlen';
import { ZUSTAND_GRUND, funkplanLuecken, funkplanLueckenZeilen } from '../stab/funkplan';
import type { Quelle } from '../stab/luecken';
import { gesperrt, ladeListe, type Geladen, type UebernahmeQuelle } from './uebernahmeQuelle';

/** Höchstens so viele Einzelzeilen je Liste; der Rest als „und n weitere“. */
const LISTE_MAX = 20;

/** Welche Module die Teile lesen; der Funkplan ist eine Stab-Unterseite (LFH-548). */
const MODUL = {
  auftraege: { key: 'auftraege', name: 'Aufträge' },
  meldungen: { key: 'meldungen', name: 'Meldungen' },
  stab: { key: 'stab', name: 'Stab' },
} as const;

const frei = (m: keyof typeof MODUL, freigaben: ModulFreigaben) =>
  istKeyFreigegeben(MODUL[m].key, freigaben);

const fehlt = (zustand: Exclude<AbrufZustand, 'daten'>) => `- — (${ZUSTAND_GRUND[zustand]})`;

function aufzaehlung(namen: string[]): string {
  return namen.length <= 1
    ? namen.join('')
    : `${namen.slice(0, -1).join(', ')} und ${namen[namen.length - 1]}`;
}

function begrenzt(zeilen: string[]): string[] {
  return zeilen.length > LISTE_MAX
    ? [...zeilen.slice(0, LISTE_MAX), `  - und ${zeilen.length - LISTE_MAX} weitere`]
    : zeilen;
}

/** Älteste Frist zuerst, ohne Frist ans Ende, bei Gleichstand nach Nummer. */
function nachFrist<T>(frist: (x: T) => string | null | undefined, nr: (x: T) => number) {
  return (a: T, b: T) => {
    const fa = frist(a) ?? '';
    const fb = frist(b) ?? '';
    if (fa !== fb) return fa === '' ? 1 : fb === '' ? -1 : fa.localeCompare(fb);
    return nr(a) - nr(b);
  };
}

/**
 * Überfällige offene Aufträge: dieselbe Menge wie der Modulzähler des Servers (`ist_offen` und
 * `ist_ueberfaellig`, gemeinsames Fixture `tests/fixtures/verdichtung/regeln.json`). Nur Nummer
 * und Frist: Auftragstext, Lage und Ort sind Freitext und können Dritte nennen (LFH-869 D3).
 */
function auftragsZeilen(auftraege: readonly Auftrag[], dtg: (iso: string) => string): string[] {
  return begrenzt(
    auftraege
      .filter((a) => istOffen(a) && a.ist_ueberfaellig)
      .sort(
        nachFrist(
          (a) => a.frist_at,
          (a) => a.lfd_nr ?? 0,
        ),
      )
      .map((a) => `  - Nr. ${a.lfd_nr ?? '—'}${a.frist_at ? ` · Frist ${dtg(a.frist_at)}` : ''}`),
  );
}

/** Meldungen mit überfälliger Bestätigung (`istAlarmiert`, wie der Zähler). Ohne Inhalt/Absender. */
function meldungsZeilen(meldungen: readonly Meldung[], dtg: (iso: string) => string): string[] {
  return begrenzt(
    meldungen
      .filter(istAlarmiert)
      .sort(
        nachFrist(
          (m) => m.bestaetigung_frist_at,
          (m) => m.lfd_nr,
        ),
      )
      .map(
        (m) =>
          `  - Nr. ${m.lfd_nr} · ${MELDUNGSART_LABEL[m.meldungsart] ?? m.meldungsart}` +
          (m.bestaetigung_frist_at ? ` · Frist ${dtg(m.bestaetigung_frist_at)}` : ''),
      ),
  );
}

const alsQuelle = <T>(g: Geladen<T[]>): Quelle<T> => ({ zustand: g.zustand, daten: g.daten });

/**
 * „Aus dem Führungsstand übernehmen“ im Abschnitt „Besondere (Führungs-)Probleme“ (LFH-871, Spec
 * `lagevortrag-uebernahme`). Zahlen aus dem Modulzähler wie Dashboard und Vorbereitung, Listen nach
 * derselben Regel, Funkplan-Lücken im Wortlaut des Funkplans. Rechnet keine eigene Zahl.
 */
export const FUEHRUNGSPROBLEME_QUELLE: UebernahmeQuelle = {
  knopf: 'Aus dem Führungsstand übernehmen',
  unterzeile: 'Überfällige Aufträge, unbestätigte Meldungen und Funkplan-Lücken, ohne Freitext',
  ersetzenTitel: 'Führungsprobleme ersetzen?',
  ersetzenText:
    'Der Abschnitt enthält schon Text. Er wird durch die aktuellen überfälligen Aufträge, Meldungen und Funkplan-Lücken ersetzt.',
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
    const auftraegeFrei = frei('auftraege', freigaben);
    const meldungenFrei = frei('meldungen', freigaben);
    // Wie die Funkplan-Seite: erst der Stab, dann das Modul der Liste (LFH-669).
    const stabFrei = frei('stab', freigaben);
    const funkFrei = (key: string) => stabFrei && istKeyFreigegeben(key, freigaben);
    const lade = <T>(
      offen: boolean,
      key: readonly unknown[],
      fn: () => Promise<T[]>,
    ): Promise<Geladen<T[]>> =>
      offen ? ladeListe<T[]>(qc, key, fn, []) : Promise.resolve(gesperrt<T[]>([]));

    const [zaehler, auftraege, meldungen, abschnitte, einheiten, sprechgruppen, fs] =
      await Promise.all([
        auftraegeFrei || meldungenFrei
          ? ladeListe(
              qc,
              einsatzKeys.modulZaehler(einsatzId),
              () => ladeModulZaehler(einsatzId),
              null,
            )
          : Promise.resolve(gesperrt(null)),
        lade(auftraegeFrei, einsatzKeys.auftraege(einsatzId), () => listeAuftraege(einsatzId)),
        lade(meldungenFrei, einsatzKeys.meldungen(einsatzId), () => listeMeldungen(einsatzId)),
        lade(funkFrei('einsatzabschnitte'), einsatzKeys.abschnitte(einsatzId), () =>
          listeAbschnitte(einsatzId),
        ),
        lade(funkFrei('einheiten'), einsatzKeys.einheiten(einsatzId), () =>
          listeEinheiten(einsatzId),
        ),
        lade(stabFrei, einsatzKeys.sprechgruppen(einsatzId), () =>
          listeEinsatzSprechgruppen(einsatzId),
        ),
        stabFrei
          ? ladeListe(
              qc,
              einsatzKeys.fuehrungsstelle(einsatzId),
              () => ladeFuehrungsstelle(einsatzId),
              null,
            )
          : Promise.resolve(gesperrt(null)),
      ]);

    // Fehlt das Feld im Zähler, ist das Modul für die Person nicht frei (`fuehrungsZahlen.ts`).
    const auftragsZahl = auftraegeFrei ? zaehler.daten?.auftraege : undefined;
    const meldungsZahl = meldungenFrei ? zaehler.daten?.meldungen : undefined;
    const zaehlerFehlt = (offen: boolean): Exclude<AbrufZustand, 'daten'> =>
      !offen ? 'gesperrt' : zaehler.zustand === 'daten' ? 'gesperrt' : zaehler.zustand;

    const auftragsTeil =
      auftragsZahl == null
        ? [fehlt(zaehlerFehlt(auftraegeFrei))]
        : [
            `- ${auftraegeNotiz(auftragsZahl)}`,
            ...(auftraege.zustand === 'daten'
              ? auftragsZeilen(auftraege.daten, dtg)
              : auftragsZahl.ueberfaellig > 0
                ? [`  - Liste ${ZUSTAND_GRUND[auftraege.zustand]}`]
                : []),
          ];

    const meldungsTeil =
      meldungsZahl == null
        ? [fehlt(zaehlerFehlt(meldungenFrei))]
        : [
            meldungsZahl.bestaetigung_ueberfaellig > 0
              ? `- ${meldungsZahl.bestaetigung_ueberfaellig} mit überfälliger Bestätigung`
              : '- keine mit überfälliger Bestätigung',
            ...(meldungen.zustand === 'daten'
              ? meldungsZeilen(meldungen.daten, dtg)
              : meldungsZahl.bestaetigung_ueberfaellig > 0
                ? [`  - Liste ${ZUSTAND_GRUND[meldungen.zustand]}`]
                : []),
            meldungsZahl.ungesehen > 0
              ? `- ${meldungsZahl.ungesehen} neu, noch nicht gesichtet`
              : '- keine neu, noch nicht gesichtet',
          ];

    const funkQuellen = {
      abschnitte: alsQuelle(abschnitte),
      einheiten: alsQuelle(einheiten),
      sprechgruppen: alsQuelle(sprechgruppen),
      fuehrungsstelle: { zustand: fs.zustand, daten: fs.daten },
    };
    const lueckenZeilen = funkplanLueckenZeilen(funkplanLuecken(funkQuellen), funkQuellen, {
      nurBefund: true,
    });
    const funkTeil = !stabFrei
      ? [fehlt('gesperrt')]
      : lueckenZeilen.length > 0
        ? lueckenZeilen
        : ['- keine Lücken'];

    const gelesen = [zaehler, auftraege, meldungen, abschnitte, einheiten, sprechgruppen, fs];
    const stand = gemeinsamerDatenstand(...gelesen.map((g) => g.stand)) || Date.now();

    return [
      `**Stand:** ${dtg(new Date(stand).toISOString())}`,
      '',
      '**Aufträge**',
      ...auftragsTeil,
      '',
      '**Meldungen**',
      ...meldungsTeil,
      '',
      '**Funkplan**',
      ...funkTeil,
      '',
    ].join('\n');
  },
};
