import { useMemo } from 'react';
import {
  entferneSchadenAnhang,
  legeSchadenAnhangAb,
  listeSchadenAnhaenge,
  schadenAnhangDownloadPfad,
  schadenRegistrierAnzeige,
} from '../../api/einsatzSchaden';
import { einsatzKeys } from '../../api/queryKeys';
import type { Schaden } from '../../api/types';
import ObjektAnhaenge, { type AnhangQuelle } from '../../components/anhaenge/ObjektAnhaenge';

interface Props {
  einsatzId: number;
  schaden: Pick<Schaden, 'id' | 'registrier_nr' | 'storniert_at'>;
  /** Schreibrecht im Einsatz (Rolle + aktiver Einsatz), wie die übrigen Aktionen der Seite. */
  darfSchreiben: boolean;
}

/**
 * Paneel „Fotos und Dateien“ auf der Schaden-Detailseite (LFH-21): die Schadensrouten als Quelle
 * des geteilten Blocks `components/anhaenge/ObjektAnhaenge` (LFH-757), mit Vorschaubild (LFH-759)
 * und Sammelbanner für fremden Zufluss (LFH-760). Am stornierten Schaden bleibt die Liste nur lesbar.
 */
export default function SchadenAnhaenge({ einsatzId, schaden, darfSchreiben }: Props) {
  const quelle = useMemo<AnhangQuelle>(
    () => ({
      queryKey: einsatzKeys.schadenAnhaenge(einsatzId, schaden.id),
      liste: () => listeSchadenAnhaenge(einsatzId, schaden.id),
      ablegen: (datei) => legeSchadenAnhangAb(einsatzId, schaden.id, datei),
      entfernen: (id) => entferneSchadenAnhang(einsatzId, schaden.id, id),
      downloadPfad: (id) => schadenAnhangDownloadPfad(einsatzId, schaden.id, id),
      kennung: `Schaden ${schadenRegistrierAnzeige(schaden.registrier_nr)}`,
      vorschau: true,
    }),
    [einsatzId, schaden.id, schaden.registrier_nr],
  );
  return (
    <ObjektAnhaenge
      einsatzId={einsatzId}
      quelle={quelle}
      darfSchreiben={darfSchreiben && !schaden.storniert_at}
    />
  );
}
