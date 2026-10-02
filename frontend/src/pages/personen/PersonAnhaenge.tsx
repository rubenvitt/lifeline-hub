import { useMemo } from 'react';
import {
  entfernePersonAnhang,
  legePersonAnhangAb,
  listePersonAnhaenge,
  personAnhangDownloadPfad,
  registrierAnzeige,
} from '../../api/einsatzPerson';
import { einsatzKeys } from '../../api/queryKeys';
import type { Person } from '../../api/types';
import ObjektAnhaenge, { type AnhangQuelle } from '../../components/anhaenge/ObjektAnhaenge';

interface Props {
  einsatzId: number;
  person: Pick<Person, 'id' | 'registrier_nr' | 'storniert_at'>;
  /** Schreibrecht im Einsatz (Rolle + aktiver Einsatz), wie die übrigen Aktionen der Seite. */
  darfSchreiben: boolean;
}

/**
 * „Fotos und Dateien“ an einer Person (LFH-757): die Personenrouten als Quelle des geteilten
 * Blocks, ohne eigenes Paneel — er steht im aufklappbaren Abschnitt der Detailseite und lädt erst
 * mit ihm. Jeder Download schreibt serverseitig eine Zeile ins Zugriffsprotokoll der Person; die
 * Liste schreibt keine. An einer stornierten Person bleibt die Liste nur lesbar.
 */
export default function PersonAnhaenge({ einsatzId, person, darfSchreiben }: Props) {
  const quelle = useMemo<AnhangQuelle>(
    () => ({
      queryKey: einsatzKeys.personAnhaenge(einsatzId, person.id),
      liste: () => listePersonAnhaenge(einsatzId, person.id),
      ablegen: (datei) => legePersonAnhangAb(einsatzId, person.id, datei),
      entfernen: (id) => entfernePersonAnhang(einsatzId, person.id, id),
      downloadPfad: (id) => personAnhangDownloadPfad(einsatzId, person.id, id),
      kennung: `Person ${registrierAnzeige(person.registrier_nr)}`,
    }),
    [einsatzId, person.id, person.registrier_nr],
  );
  return (
    <ObjektAnhaenge
      einsatzId={einsatzId}
      quelle={quelle}
      darfSchreiben={darfSchreiben && !person.storniert_at}
      huelle="abschnitt"
    />
  );
}
