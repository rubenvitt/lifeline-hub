import { Button, Space } from 'antd';
import type { MessageInstance } from 'antd/es/message/interface';
import type { Lagebesprechung } from '../api/types';
import { etbPfad } from '../routing/deeplinks';

/** Fester Schlüssel: ein zweiter Abschluss ersetzt den stehenden Toast (Bauform `rueckgaengig.tsx`). */
const SCHLUESSEL = 'lfh-lagebesprechung-abgeschlossen';
/** Wie der Rückgängig-Toast: hier steht eine Entscheidung an (hinspringen oder nicht). */
const DAUER_S = 6;

/**
 * Erfolgs-Quittung des Abschlusses mit Deeplink auf den ETB-Beleg (Spec 10).
 *
 * Der Link zeigt nur dann auf `?eintrag=`, wenn die Antwort der eigenen Anfrage zugeordnet
 * werden konnte (`eigeneLagebesprechung`); sonst auf das ETB — ein fremder Beleg wäre schlimmer
 * als keiner. `navigate` kommt vom Aufrufer: `<AntApp>` liegt außerhalb des Routers
 * (`main.tsx`), ein `<Link>` im Toast hätte keinen Router-Kontext.
 *
 * Der Fehlerfall hat hier nichts verloren — er steht IM Modal (LFH-535).
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
