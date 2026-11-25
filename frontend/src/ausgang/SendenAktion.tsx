import { Button } from 'antd';
import { useState, type ComponentProps } from 'react';
import SendenDialog from './SendenDialog';

/**
 * Der Knopf „Senden“ im Kopf eines freigegebenen Dokuments samt Dialog (LLH-2093). Der Aufrufer
 * zeigt ihn nur mit Schreibrecht und nur bei `freigegeben`; ohne Netz sperrt der Dialog selbst.
 */
export default function SendenAktion(
  props: Omit<ComponentProps<typeof SendenDialog>, 'offen' | 'onClose'>,
) {
  const [offen, setOffen] = useState(false);
  return (
    <>
      <Button onClick={() => setOffen(true)}>Senden</Button>
      {/* Der Dialog hängt nur offen: ein geschlossener lädt keine Adressen. */}
      {offen && <SendenDialog {...props} offen onClose={() => setOffen(false)} />}
    </>
  );
}
