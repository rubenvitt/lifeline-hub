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
import ErfassungsAnhaenge, {
  type ErfassungsAnhangQuelle,
} from '../../components/erfassungsAnhaenge/ErfassungsAnhaenge';

interface Props {
  einsatzId: number;
  person: Pick<Person, 'id' | 'registrier_nr' | 'storniert_at'>;
  /** Schreibrecht im Einsatz (Rolle + aktiver Einsatz), wie die übrigen Aktionen der Seite. */
  darfSchreiben: boolean;
}

/**
 * „Fotos und Dateien“ an einer Person (LFH-757): die Personenrouten als Quelle des
 * modulneutralen Bausteins `ErfassungsAnhaenge` (LFH-758), ohne eigenes Paneel — er steht im
 * aufklappbaren Abschnitt der Detailseite und lädt erst mit ihm. Jeder Download schreibt
 * serverseitig eine Zeile ins Zugriffsprotokoll der Person; die Liste schreibt keine. An einer
 * stornierten Person bleibt die Liste nur lesbar.
 */
export default function PersonAnhaenge({ einsatzId, person, darfSchreiben }: Props) {
  const quelle = useMemo<ErfassungsAnhangQuelle>(
    () => ({
      queryKey: einsatzKeys.personAnhaenge(einsatzId, person.id),
      liste: () => listePersonAnhaenge(einsatzId, person.id),
      ablegen: (datei, onFortschritt) =>
        legePersonAnhangAb(einsatzId, person.id, datei, onFortschritt),
      entfernen: (id) => entfernePersonAnhang(einsatzId, person.id, id),
      downloadPfad: (id) => personAnhangDownloadPfad(einsatzId, person.id, id),
    }),
    [einsatzId, person.id],
  );
  return (
    <ErfassungsAnhaenge
      einsatzId={einsatzId}
      bezug={`Person ${registrierAnzeige(person.registrier_nr)}`}
      quelle={quelle}
      darfSchreiben={darfSchreiben}
      gesperrt={!!person.storniert_at}
      // Kein Vorschaubild: jeder Abruf hier ist ein protokollierter Zugriff (LFH-757), ein
      // Vorschaubild je Zeile schriebe schon beim Aufklappen eine Audit-Zeile je Foto.
      vorschau={false}
      zeilenKennung="person-anhang-zeile"
      huelle="abschnitt"
    />
  );
}
