import { Button } from 'antd';
import { useNavigate } from 'react-router';
import { IconSchloss } from '../icons';
import Paneel from '../components/instrument/Paneel';
import { schriftStil, useRollen } from '../components/instrument/rollenwerte';
import type { PlatzhalterRueckweg } from '../components/Platzhalter';
import { flaeche } from '../theme/tokens';
import { KEINE_BERECHTIGUNG, type ModulEintrag } from './modulRegistry';

interface Props {
  modul: ModulEintrag;
  /** Der Server meldet `sichtbar: false` — das Modul ist im Einsatz ausgeblendet. */
  ausgeblendet: boolean;
  /** Weg in ein freies Modul (`freiesRueckwegModul`); fehlt er, steht keine Aktion da. */
  rueckweg?: PlatzhalterRueckweg;
}

/**
 * Hinweis des Modulwächters (LFH-888, Spec `modul-freigabe`, design.md D2): steht im Einsatzrahmen
 * an der Stelle der Modulseite, wenn der Server für das Modul der Route `zugriff: false` meldet.
 * EINE Gestalt für jeden Weg hinein (Deeplink, Lesezeichen, Verweis in einer Datenzeile) statt
 * des 403-Zustands der jeweiligen Seite.
 *
 * Form wie `components/Platzhalter.tsx`: ein schmales Paneel, Info statt Rot (eine Sperre ist keine
 * Gefahr), der Rückweg als EINE Primäraktion. Anders als dort trägt der Modulname das `h1`: die
 * Modulseite, die sonst den Seitentitel stellt, wird nicht gerendert.
 */
export default function ModulGesperrt({ modul, ausgeblendet, rueckweg }: Props) {
  const navigate = useNavigate();
  const { token, rollen } = useRollen();
  return (
    <Paneel
      titel={KEINE_BERECHTIGUNG}
      style={{
        maxWidth: flaeche.seiteSchmal,
        marginInline: 'auto',
        marginBlockStart: token.marginLG,
      }}
      koerperPolster
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: token.marginSM }}>
        <h1
          style={{
            ...schriftStil('seitentitel'),
            margin: 0,
            color: rollen.text,
            display: 'flex',
            alignItems: 'center',
            gap: token.marginXS,
          }}
        >
          <IconSchloss aria-hidden />
          {modul.label}
        </h1>
        <p style={{ margin: 0, fontSize: 13, lineHeight: 1.5, color: rollen.text2 }}>
          {ausgeblendet
            ? `„${modul.label}“ ist in diesem Einsatz ausgeblendet.`
            : `„${modul.label}“ ist für deine Rolle in diesem Einsatz nicht freigegeben.`}
        </p>
        <p style={{ margin: 0, fontSize: 12, lineHeight: 1.5, color: rollen.gedaempft }}>
          Freigaben legt die Einsatzleitung unter Einstellungen › Module fest.
        </p>
        {rueckweg && (
          <div>
            <Button type="primary" onClick={() => void navigate(rueckweg.pfad)}>
              {rueckweg.label}
            </Button>
          </div>
        )}
      </div>
    </Paneel>
  );
}
