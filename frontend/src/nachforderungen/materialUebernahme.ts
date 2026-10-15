import type { DisponierEingabe, MaterialAdhocEingabe } from '../api/einsatzMaterial';
import type { EinsatzMaterial, MaterialArt, Nachforderung } from '../api/types';
import { OHNE_ORT_WERT, ortPostFeld } from '../kraefte/materialPosten';

/**
 * Übernahme einer eingetroffenen Nachforderung als Materialposten (LLH-1226, design.md D3, D5),
 * rein: was der Dialog vorbelegt, was schon übernommen ist und was auf den Draht geht. Die
 * Nachforderung kennt kein Material, nur Text; die Ableitung steht im Client, damit die Person vor
 * dem Absenden sieht, was entsteht. Der Server prüft nur den Bezug.
 */

type NachforderungBezug = Pick<Nachforderung, 'id' | 'art' | 'anzahl' | 'material_ids'>;
type Posten = Pick<EinsatzMaterial, 'id' | 'menge'>;

/** Was der Dialog trägt: drei Felder (Feldbudget Modal), die Bezeichnung steht im Titel. */
export interface UebernahmeWerte {
  art: MaterialArt;
  menge: number;
  /** Ort-Auswahlwert (`toOrtValue`), „ohne Ort“ als {@link OHNE_ORT_WERT}. */
  ort: string;
}

/**
 * Die verknüpften, nicht stornierten Posten, soweit `material` sie kennt, in der Folge der
 * Kennungen. Ein Posten, den die Liste (noch) nicht hat, fehlt.
 */
export function uebernommenePosten<P extends Posten>(
  n: Pick<Nachforderung, 'material_ids'>,
  material: readonly P[],
): P[] {
  const jeId = new Map(material.map((p) => [p.id, p]));
  return n.material_ids.flatMap((id) => {
    const p = jeId.get(id);
    return p ? [p] : [];
  });
}

/** Summe der Mengen der übernommenen Posten, die `material` kennt („übernommen 1200 von 2000“). */
export function uebernommeneMenge(
  n: Pick<Nachforderung, 'material_ids'>,
  material: readonly Posten[],
): number {
  return uebernommenePosten(n, material).reduce((summe, p) => summe + p.menge, 0);
}

/** Ein weiterer Posten wird nur bewusst übernommen (D3): sobald schon einer verknüpft ist. */
export function isErgaenzen(n: Pick<Nachforderung, 'material_ids'>): boolean {
  return n.material_ids.length > 0;
}

/** Die Bezeichnung des Postens ist die Art der Nachforderung („Tauchpumpe“), nicht ihr Bedarf. */
export function uebernahmeBezeichnung(n: Pick<Nachforderung, 'art'>): string {
  return n.art.trim();
}

/** Vorgabe der Art wie am Server (LLH-1224 D1): Menge über 1 → Verbrauchsgut, sonst Gerät. */
function artVorgabe(menge: number): MaterialArt {
  return menge > 1 ? 'verbrauchsgut' : 'geraet';
}

/**
 * Vorbelegung des Dialogs (D5, Spec „Vorbelegte Übernahme“): Menge = Anzahl abzüglich des schon
 * Übernommenen, mindestens 1, ohne Anzahl 1; Art aus der Menge; „ohne Ort“, weil die
 * Nachforderung keinen Ort kennt.
 */
export function uebernahmeVorbelegung(
  n: NachforderungBezug,
  material: readonly Posten[],
): UebernahmeWerte & { bezeichnung: string } {
  const rest = n.anzahl != null ? n.anzahl - uebernommeneMenge(n, material) : 1;
  const menge = Math.max(1, rest);
  return {
    bezeichnung: uebernahmeBezeichnung(n),
    menge,
    art: artVorgabe(menge),
    ort: OHNE_ORT_WERT,
  };
}

/**
 * Der Aufruf von `disponiereAdhoc` (D1): ein Ad-hoc-Posten mit Bezug, ein Gerät mit Menge 1, der
 * Ort als Feld des POST. `ergaenzen` ist die Absicht, die der Dialog zeigt („Weiteren Posten
 * übernehmen“), festgehalten beim Öffnen bzw. nach einer 409 — nicht der Stand, den ein
 * Live-Abgleich währenddessen bringt: sonst ergänzte ein Klick still, was ein anderer Platz gerade
 * übernommen hat (D3).
 */
export function uebernahmeKoerper(
  n: NachforderungBezug,
  w: UebernahmeWerte,
  ergaenzen: boolean,
): {
  adhoc: MaterialAdhocEingabe;
  menge: number;
  optionen: DisponierEingabe & { art: MaterialArt };
} {
  return {
    adhoc: { bezeichnung: uebernahmeBezeichnung(n) },
    menge: w.art === 'geraet' ? 1 : w.menge,
    optionen: {
      art: w.art,
      ort: ortPostFeld(w.ort),
      nachforderungId: n.id,
      ergaenzen,
    },
  };
}
