// frontend/src/command-palette/Vorschau.tsx
import PersonVorschau from '../personen/PersonVorschau';
import EtbEintragVorschau from '../etb/EtbEintragVorschau';
import MeldungVorschau from '../meldungen/MeldungVorschau';
import AuftragVorschau from '../auftraege/AuftragVorschau';
import FahrzeugVorschau from '../kraefte/FahrzeugVorschau';
import PersonalVorschau from '../kraefte/PersonalVorschau';
import EinheitVorschau from '../kraefte/EinheitVorschau';
import SchadenVorschau from '../pages/schaeden/SchadenVorschau';
import UhsVorschau from '../pages/uhs/UhsVorschau';
import LageberichtVorschau from '../lageberichte/LageberichtVorschau';
import GefahrengebietVorschau from '../pages/gefahren/GefahrengebietVorschau';
import AbschnittVorschau from '../pages/einsatzabschnitte/AbschnittVorschau';
import type { VorschauZiel } from './typen';

/**
 * Der Inhalt der Palettenvorschau (LFH-645, Taste →; alle Datensatzsorten seit LFH-664) — je
 * Sorte das Lese-Bauteil, das auch außerhalb der Palette steht oder dessen Inhalt mit der
 * Fachseite geteilt ist. Die Palette selbst kennt keine Sorte; sie rendert, was hier
 * herauskommt, in ihrer Vorschau-Region.
 *
 * EXHAUSTIV über `art`: der `never`-Zweig bricht den Typcheck, sobald `VorschauZiel` eine
 * Sorte bekommt, die hier keinen Zweig hat. Ohne ihn fiele eine neue Sorte still auf
 * `undefined` — die Palette zeigte eine leere Vorschau, und kein Test sähe es.
 */
export function Vorschau({ ziel }: { ziel: VorschauZiel }) {
  const { einsatzId, id } = ziel;
  switch (ziel.art) {
    case 'person':
      return <PersonVorschau einsatzId={einsatzId} personId={id} />;
    case 'etb':
      return <EtbEintragVorschau einsatzId={einsatzId} id={id} lfdNr={ziel.lfdNr} />;
    case 'meldung':
      return <MeldungVorschau einsatzId={einsatzId} id={id} />;
    case 'auftrag':
      return <AuftragVorschau einsatzId={einsatzId} id={id} />;
    case 'fahrzeug':
      return <FahrzeugVorschau einsatzId={einsatzId} id={id} />;
    case 'personal':
      return <PersonalVorschau einsatzId={einsatzId} id={id} />;
    case 'einheit':
      return <EinheitVorschau einsatzId={einsatzId} id={id} />;
    case 'schaden':
      return <SchadenVorschau einsatzId={einsatzId} id={id} />;
    case 'uhs':
      return <UhsVorschau einsatzId={einsatzId} id={id} />;
    case 'lagebericht':
      return <LageberichtVorschau einsatzId={einsatzId} id={id} />;
    case 'gefahrengebiet':
      return <GefahrengebietVorschau einsatzId={einsatzId} id={id} />;
    case 'abschnitt':
      return <AbschnittVorschau einsatzId={einsatzId} id={id} />;
    default: {
      const unbekannt: never = ziel;
      return unbekannt;
    }
  }
}
