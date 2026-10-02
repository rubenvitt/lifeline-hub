import {
  entferneSchadenAnhang,
  legeSchadenAnhangAb,
  listeSchadenAnhaenge,
  schadenAnhangDownloadPfad,
  schadenRegistrierAnzeige,
} from '../../api/einsatzSchaden';
import { einsatzKeys } from '../../api/queryKeys';
import type { Schaden } from '../../api/types';
import ErfassungsAnhaenge from '../../components/erfassungsAnhaenge/ErfassungsAnhaenge';

interface Props {
  einsatzId: number;
  schaden: Pick<Schaden, 'id' | 'registrier_nr' | 'storniert_at'>;
  /** Schreibrecht im Einsatz (Rolle + aktiver Einsatz), wie die übrigen Aktionen der Seite. */
  darfSchreiben: boolean;
}

/**
 * Paneel „Fotos und Dateien“ auf der Schaden-Detailseite (LFH-21) — die Schaden-Hülle um den
 * modulneutralen Baustein `ErfassungsAnhaenge` (LFH-758). Der Download zeigt auf die
 * modul-gegatete Schadensroute, nie auf `/anhaenge/{aid}` des Einsatzes.
 */
export default function SchadenAnhaenge({ einsatzId, schaden, darfSchreiben }: Props) {
  return (
    <ErfassungsAnhaenge
      einsatzId={einsatzId}
      bezug={`Schaden ${schadenRegistrierAnzeige(schaden.registrier_nr)}`}
      darfSchreiben={darfSchreiben}
      gesperrt={!!schaden.storniert_at}
      zeilenKennung="schaden-anhang-zeile"
      quelle={{
        queryKey: einsatzKeys.schadenAnhaenge(einsatzId, schaden.id),
        liste: () => listeSchadenAnhaenge(einsatzId, schaden.id),
        ablegen: (datei) => legeSchadenAnhangAb(einsatzId, schaden.id, datei),
        entfernen: (id) => entferneSchadenAnhang(einsatzId, schaden.id, id),
        downloadPfad: (id) => schadenAnhangDownloadPfad(einsatzId, schaden.id, id),
      }}
    />
  );
}
