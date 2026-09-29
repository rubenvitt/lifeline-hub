import { Button, Space } from 'antd';
import type { MessageInstance } from 'antd/es/message/interface';
import type { Lagebesprechung } from '../api/types';
import { etbPfad } from '../routing/deeplinks';

/** Fester Schlüssel: ein zweiter Abschluss ersetzt den stehenden Toast. */
const SCHLUESSEL = 'lfh-lagebesprechung-abgeschlossen';
/** Wie der Rückgängig-Toast: hier steht eine Entscheidung an (hinspringen oder nicht). */
const DAUER_S = 6;

/**
 * Erfolgs-Quittung des Abschlusses mit Deeplink auf den ETB-Beleg.
 * Auf `?eintrag=` nur, wenn die Antwort der eigenen Anfrage zugeordnet werden konnte; sonst auf
 * das ETB — ein fremder Beleg wäre schlimmer als keiner. `navigate` kommt vom Aufrufer:
 * `<AntApp>` liegt außerhalb des Routers, ein `<Link>` im Toast hätte keinen Kontext. Der
 * Fehlerfall steht IM Modal.
 */
export function zeigeAbschlussToast(
  api: MessageInstance,
  {
    einsatzId,
    eigene,
    navigate,
  }: { einsatzId: number; eigene: Lagebesprechung | undefined; navigate: (pfad: string) => void },
) {
  const ziel = eigene ? etbPfad(einsatzId, { eintrag: eigene.etb_eintrag_id }) : etbPfad(einsatzId);
  api.open({
    key: SCHLUESSEL,
    type: 'success',
    duration: DAUER_S,
    content: (
      <Space>
        <span>
          {eigene
            ? `Lagebesprechung Nr. ${eigene.lfd_nr} abgeschlossen`
            : 'Lagebesprechung abgeschlossen'}
        </span>
        <Button
          type="link"
          onClick={() => {
            api.destroy(SCHLUESSEL);
            navigate(ziel);
          }}
        >
          {eigene ? 'Zum ETB-Eintrag' : 'Zum ETB'}
        </Button>
      </Space>
    ),
  });
}
