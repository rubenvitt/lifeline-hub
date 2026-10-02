import {
  entferneTierAnhang,
  legeTierAnhangAb,
  listeTierAnhaenge,
  tierAnhangDownloadPfad,
  tierRegistrierAnzeige,
} from '../../api/einsatzTier';
import { einsatzKeys } from '../../api/queryKeys';
import type { Tier } from '../../api/types';
import ErfassungsAnhaenge from '../../components/erfassungsAnhaenge/ErfassungsAnhaenge';

interface Props {
  einsatzId: number;
  tier: Pick<Tier, 'id' | 'registrier_nr' | 'storniert_at'>;
  /** Schreibrecht im Einsatz (Rolle + aktiver Einsatz), wie die übrigen Aktionen der Seite. */
  darfSchreiben: boolean;
}

/**
 * Paneel „Fotos und Dateien“ auf der Tier-Detailseite (LFH-758, Spec `tier-anhaenge`): Foto
 * eines Fundtieres, Impfpass, Übergabeschein. Die Tier-Hülle um `ErfassungsAnhaenge`; der
 * Download zeigt auf die modul-gegatete Tier-Route. Kein Lese-Audit (wie Tiere insgesamt).
 */
export default function TierAnhaenge({ einsatzId, tier, darfSchreiben }: Props) {
  return (
    <ErfassungsAnhaenge
      einsatzId={einsatzId}
      bezug={`Tier ${tierRegistrierAnzeige(tier.registrier_nr)}`}
      darfSchreiben={darfSchreiben}
      gesperrt={!!tier.storniert_at}
      zeilenKennung="tier-anhang-zeile"
      quelle={{
        queryKey: einsatzKeys.tierAnhaenge(einsatzId, tier.id),
        liste: () => listeTierAnhaenge(einsatzId, tier.id),
        ablegen: (datei) => legeTierAnhangAb(einsatzId, tier.id, datei),
        entfernen: (id) => entferneTierAnhang(einsatzId, tier.id, id),
        downloadPfad: (id) => tierAnhangDownloadPfad(einsatzId, tier.id, id),
      }}
    />
  );
}
