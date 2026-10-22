import type { Einheit, EinsatzMaterial } from '../../api/types';
import { Paneel } from '../../components/instrument';
import MaterialAmOrt from '../../kraefte/MaterialAmOrt';
import { materialKopfzahl } from '../../kraefte/materialVerdichtungKern';
import type { EinheitRechte } from './einheitAnsichtKern';

/**
 * Paneel „Material“ der Einheit-Ansicht (LLH-1036 Teil II, design.md D11): der Baustein für
 * Material am Ort (`kraefte/MaterialAmOrt.tsx`, LLH-1225 D8/D10) mit Ort Einheit. Die Posten
 * kommen aus dem Einheit-DTO (`material_mitglieder`, auch ohne Materialrecht), das Angebot der
 * Auswahl aus der Materialliste (nur mit Freigabe Material).
 *
 * Zuordnen, Lösen und Ausgeben laufen über den einen Schreibweg des Materials und verlangen
 * Schreiben + Freigabe Material (LLH-1225 D9), nicht das Einheitenrecht: der Ort gehört dem
 * Material. Ohne Freigabe steht die Auswahl gesperrt mit Grund.
 */

interface EinheitMaterialProps {
  einsatzId: number;
  einheit: Einheit;
  rechte: EinheitRechte;
  /** Material des Einsatzes; nur mit `rechte.hasMaterialListe` abgefragt. */
  materialList: {
    data: readonly EinsatzMaterial[] | undefined;
    isError: boolean;
    error: unknown;
  };
}

export default function EinheitMaterial({
  einsatzId,
  einheit,
  rechte,
  materialList,
}: EinheitMaterialProps) {
  // Das Einheit-DTO nennt die Zeile `em_id` und trägt keine Kategorie; die steht in der
  // Materialliste, sofern sie abgefragt ist.
  const kategorie = new Map((materialList.data ?? []).map((em) => [em.id, em.kategorie]));
  const posten = einheit.material_mitglieder.map((m) => ({
    ...m,
    id: m.em_id,
    kategorie: kategorie.get(m.em_id) ?? null,
  }));
  // Leer sagt der Baustein „Kein Material“; „0 Posten“ daneben wäre doppelt (LLH-1255).
  return (
    <Paneel
      titel="Material"
      meta={posten.length > 0 ? materialKopfzahl(posten) : undefined}
      koerperPolster
    >
      <MaterialAmOrt
        einsatzId={einsatzId}
        ort={{ art: 'einheit', id: einheit.id }}
        posten={posten}
        angebot={rechte.hasMaterialListe ? materialList : undefined}
        darfSchreiben={rechte.showMaterialAuswahl}
        materialFrei={rechte.hasMaterialListe}
        loesenText="Aus Einheit lösen"
        sperrgrund={einheit.aufgeloest_at ? 'Einheit aufgelöst' : null}
        kopfzahl={false}
      />
    </Paneel>
  );
}
