import { ladeAnrufe } from '../api/infotelefon';
import { ladeMedienkontakte, ladePressemitteilungen } from '../api/presse';
import { einsatzKeys } from '../api/queryKeys';
import { istKeyFreigegeben } from '../einsatz/modulRegistry';
import { ladeListe, type UebernahmeQuelle } from '../lageberichte/uebernahmeQuelle';
import { baueMedienlage, rendereMedienlageMarkdown } from './medienlage';

/**
 * „Aus S5 übernehmen“ im Abschnitt „Medienlage“ (LFH-554, Spec `stab-medienlage`, D7; seit
 * LFH-870 eine Quelle des Übernahme-Bausteins). Frei nur mit Freigabe des Stabs; die drei Listen
 * kommen über dieselben Keys wie die Presseseite. Scheitert eine, trägt der Text „—“ mit Grund.
 */
export const MEDIENLAGE_QUELLE: UebernahmeQuelle = {
  knopf: 'Aus S5 übernehmen',
  unterzeile: 'Presse-Log, Pressemitteilungen und Informationstelefon, ohne Personenbezug',
  ersetzenTitel: 'Medienlage ersetzen?',
  ersetzenText:
    'Der Abschnitt enthält schon Text. Er wird durch die aktuelle Medienlage aus S5 ersetzt.',
  verfuegbar: (freigaben) =>
    istKeyFreigegeben('stab', freigaben)
      ? { frei: true }
      : { frei: false, grund: 'Modul Stab ist in diesem Einsatz nicht freigegeben' },
  erzeuge: async ({ qc, einsatzId, dtg }) => {
    const [kontakte, mitteilungen, anrufe] = await Promise.all([
      ladeListe(qc, einsatzKeys.medienkontakte(einsatzId), () => ladeMedienkontakte(einsatzId), []),
      ladeListe(
        qc,
        einsatzKeys.pressemitteilungen(einsatzId),
        () => ladePressemitteilungen(einsatzId),
        [],
      ),
      ladeListe(qc, einsatzKeys.infotelefon(einsatzId), () => ladeAnrufe(einsatzId), []),
    ]);
    return rendereMedienlageMarkdown(baueMedienlage({ kontakte, mitteilungen, anrufe }), dtg);
  },
};
