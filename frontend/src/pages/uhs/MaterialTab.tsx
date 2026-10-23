import { useQuery } from '@tanstack/react-query';
import { ladeModulFreigaben } from '../../api/einsaetze';
import { listEinsatzMaterial } from '../../api/einsatzMaterial';
import { einsatzKeys } from '../../api/queryKeys';
import type { UhsDetail } from '../../api/types';
import { useAuthOptional } from '../../auth/AuthContext';
import { istKeyFreigegeben, istSprungGesperrt } from '../../einsatz/modulRegistry';
import { SprungKnopf } from '../../components/Sprung';
import { useRollen } from '../../components/instrument';
import MaterialAmOrt from '../../kraefte/MaterialAmOrt';
import { nachforderungenPfad } from '../../routing/deeplinks';

interface Props {
  einsatzId: number;
  uhs: UhsDetail;
  schreibgeschuetzt: boolean;
}

/**
 * Reiter „Material“ der UHS (LLH-1225, design.md D12): eine Hülle um den Baustein für Material am
 * Ort. Die Posten kommen aus dem UHS-Detail (`uhs.material`), das auch Leser ohne Materialrecht
 * bekommen (LLH-1182) und das die Live-Meldung `material` nachlädt. Das Angebot von „Material
 * zuordnen …“ kommt aus der Materialliste: nur mit Schreibrecht und Freigabe Material abgefragt,
 * nie am Gerät.
 *
 * Ein Gerät (UHS-Laptop) liest nur das Material seiner UHS: die Einsatzliste ist ihm verwehrt
 * (403), Zuordnen und Lösen ebenso (LFH-892). Bis `/me` sagt, ob ein Gerät angemeldet ist, bleibt
 * der Reiter deshalb lesend und fragt nichts ab.
 *
 * Eine aufgelöste oder stornierte UHS nimmt kein Material mehr an (LLH-1093 D14, Server 422): der
 * Grund steht an der Auswahl, Ausgeben fehlt; Lösen bleibt (LLH-1224 D13).
 *
 * „Fehlmenge melden“ (LLH-1133 D5) steht nur hier, an der UHS: ein Sprung in die Erfassung einer
 * Nachforderung, vorbelegt mit der Art Material und der UHS in der Begründung. Bezeichnung und
 * Anzahl trägt die Person ein. Ohne Schreibrecht oder Freigabe Nachforderungen fehlt er (nicht
 * gesperrt: die Erfassung dort ließe sich ohnehin nicht öffnen).
 *
 * Ohne Sortieren und Filtern (LLH-1096, Ausnahme mit Grund): `MaterialAmOrt` ist keine
 * Vergleichsliste, sondern der eine Baustein für Material an einem Ort (Einheit, Fahrzeug, UHS,
 * Bereitstellungsraum) mit Bedienung je Zeile. Eine gelöste Zeile hält ihre Stelle, bis die
 * Bedienung den Baustein verlässt (LLH-1254); eine Sortierung oder ein Filter verschöbe oder
 * verschluckte sie. Vergleichen über alle Orte geht in der Materialliste.
 */
/**
 * Begründung der Fehlmenge (LLH-1133 D5): „Fehlmenge UHS «Turnhalle»“. Trägt die Bezeichnung das
 * „UHS“ schon („UHS Nord“), steht es nicht doppelt: „Fehlmenge «UHS Nord»“.
 */
export function fehlmengeBegruendung(bezeichnung: string): string {
  return /^UHS\b/i.test(bezeichnung)
    ? `Fehlmenge «${bezeichnung}»`
    : `Fehlmenge UHS «${bezeichnung}»`;
}

export default function MaterialTab({ einsatzId, uhs, schreibgeschuetzt }: Props) {
  const auth = useAuthOptional();
  const { token } = useRollen();
  const nurLesen = auth != null && (auth.laedt || auth.geraet != null);
  const darfSchreiben = !schreibgeschuetzt && !nurLesen;

  // Derselbe Schlüssel wie `useModulFreigaben`; der Abruf hier sagt zusätzlich, ob sie feststehen.
  const freigabenQuery = useQuery({
    queryKey: einsatzKeys.modulFreigaben(einsatzId),
    queryFn: () => ladeModulFreigaben(einsatzId),
    enabled: darfSchreiben,
  });
  // Unbekannt heißt offen (wie `istSprungGesperrt`); abgefragt wird erst, wenn sie feststehen.
  const materialFrei = !istSprungGesperrt('material', freigabenQuery.data);
  const freigabenFest = freigabenQuery.isSuccess || freigabenQuery.isError;
  const materialQuery = useQuery({
    queryKey: einsatzKeys.material(einsatzId),
    queryFn: () => listEinsatzMaterial(einsatzId),
    enabled: darfSchreiben && freigabenFest && materialFrei,
  });

  // Bekannt freigegeben, nicht „unbekannt heißt offen“: der Sprung erschiene sonst und fiele weg.
  const fehlmengeMelden =
    darfSchreiben && istKeyFreigegeben('nachforderungen', freigabenQuery.data);

  return (
    <>
      <MaterialAmOrt
        einsatzId={einsatzId}
        ort={{ art: 'uhs', id: uhs.id }}
        posten={uhs.material}
        angebot={darfSchreiben && materialFrei ? materialQuery : undefined}
        darfSchreiben={darfSchreiben}
        materialFrei={materialFrei}
        loesenText="Lösen"
        sperrgrund={
          uhs.storniert_at ? 'UHS storniert' : uhs.status === 'aufgeloest' ? 'UHS aufgelöst' : null
        }
      />
      {fehlmengeMelden && (
        <div style={{ marginTop: token.marginSM }}>
          <SprungKnopf
            to={nachforderungenPfad(einsatzId, {
              vorbelegung: { art: 'Material', begruendung: fehlmengeBegruendung(uhs.bezeichnung) },
            })}
          >
            Fehlmenge melden
          </SprungKnopf>
        </div>
      )}
    </>
  );
}
