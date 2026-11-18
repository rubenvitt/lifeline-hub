import { Button, Space } from 'antd';
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
  /**
   * Pfad zu Einstellungen › Module, nur wenn die Person die Freigaben verwaltet (`darfModuleVerwalten`).
   * Ohne ihn steht nur die Sperrzeile da (LFH-1078: zeigen statt erklären).
   */
  freigabenPfad?: string;
}

/**
 * Hinweis des Modulwächters (LFH-888, Spec `modul-freigabe`, design.md D2): steht im Einsatzrahmen
 * an der Stelle der Modulseite, wenn der Server für das Modul der Route `zugriff: false` meldet.
 * EINE Gestalt für jeden Weg hinein (Deeplink, Lesezeichen, Verweis in einer Datenzeile) statt
 * des 403-Zustands der jeweiligen Seite.
 *
 * Form wie `components/Platzhalter.tsx`: ein schmales Paneel, Info statt Rot (eine Sperre ist keine
 * Gefahr), der Rückweg als EINE Primäraktion; wer die Freigaben verwaltet, bekommt daneben den Weg
 * in Einstellungen › Module. Anders als dort trägt der Modulname das `h1`, über dem Paneel: die
 * Modulseite, die sonst den Seitentitel stellt, wird nicht gerendert.
 */
export default function ModulGesperrt({ modul, ausgeblendet, rueckweg, freigabenPfad }: Props) {
  const navigate = useNavigate();
  const { token, rollen } = useRollen();
  return (
    <div
      style={{
        maxWidth: flaeche.seiteSchmal,
        marginInline: 'auto',
        marginBlockStart: token.marginLG,
        display: 'flex',
        flexDirection: 'column',
        gap: token.marginSM,
      }}
    >
      {/* Das h1 steht vor dem Paneel: dessen Überschrift ist ein h2, die Gliederung beginnt oben. */}
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
      <Paneel titel={KEINE_BERECHTIGUNG} koerperPolster>
        <div style={{ display: 'flex', flexDirection: 'column', gap: token.marginSM }}>
          {/* Eine Sperrzeile (LFH-1078, Spec `modul-freigabe`): Modul und Grund stehen schon in h1 und
             Paneeltitel. Wo die Freigaben liegen, zeigt der Knopf statt eines Satzes. */}
          <p style={{ margin: 0, fontSize: 13, lineHeight: 1.5, color: rollen.text2 }}>
            {ausgeblendet ? 'In diesem Einsatz ausgeblendet' : 'Für deine Rolle nicht freigegeben'}
          </p>
          {(rueckweg || freigabenPfad) && (
            <Space wrap>
              {rueckweg && (
                <Button type="primary" onClick={() => void navigate(rueckweg.pfad)}>
                  {rueckweg.label}
                </Button>
              )}
              {freigabenPfad && (
                <Button onClick={() => void navigate(freigabenPfad)}>Modulfreigaben öffnen</Button>
              )}
            </Space>
          )}
        </div>
      </Paneel>
    </div>
  );
}
