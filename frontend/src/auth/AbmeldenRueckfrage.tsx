import { Modal } from 'antd';
import { useId, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { useAuth } from './AuthContext';

export interface AbmeldenRueckfrage {
  /** Öffnet die Rückfrage; die Sitzung endet erst mit „Abmelden“. */
  open: () => void;
  /** Der Dialog, beim Aufrufer einzuhängen. */
  dialog: ReactNode;
}

/**
 * Rückfrage vor dem Abmelden (LLH-1730, Spec `benutzermenue`, „Abmelden fragt zurück“). Ein
 * Fehlgriff auf „Abmelden“ beendete im Einsatz sonst die Sitzung.
 *
 * ZWEIMAL EINGEHÄNGT, KEIN APP-WEITER PROVIDER (design.md D2 der Change
 * `drftcjks-benutzermenue-abmelden-anzeige`): im Benutzermenü über {@link useAbmeldenRueckfrage}
 * und im stets eingehängten `CommandPaletteProvider`. Ein `Modal`, kein `Popconfirm`: das Dropdown
 * schließt beim Klick, und die Palette hat keinen Anker.
 *
 * DER FOKUS STEHT AUF „ABBRECHEN“ (D3): aus der Palette kommt die Rückfrage per ↵; stünde der
 * Fokus auf „Abmelden“, beendete ein zweites ↵ die Sitzung doch.
 *
 * LÄUFT DIE ABMELDUNG, IST NICHTS MEHR ZURÜCKZUNEHMEN (Review vor dem PR): `logout()` gibt die
 * Sitzung schon vor der Serverantwort auf und meldet danach lokal ab, auch ohne Antwort. „Abbrechen“,
 * Escape, Schließknopf und Maske sind deshalb gesperrt, solange sie läuft; ein Schließen täuschte
 * eine zurückgenommene Abmeldung vor.
 *
 * `logout()` liefert `false`, wenn die Sitzung inzwischen einem anderen Benutzer gehört (412,
 * LFH-387): dann bleibt der Tab stehen und zeigt den Benutzerkonflikt.
 */
export function AbmeldenRueckfrageDialog({
  isOpen,
  onClose,
}: {
  isOpen: boolean;
  onClose: () => void;
}) {
  const { logout } = useAuth();
  const navigate = useNavigate();
  const [isLaeuft, setLaeuft] = useState(false);
  const abbrechenId = useId();

  async function handleBestaetigen() {
    setLaeuft(true);
    try {
      if (await logout()) navigate('/login', { replace: true });
    } finally {
      setLaeuft(false);
      onClose();
    }
  }

  return (
    <Modal
      open={isOpen}
      title="Abmelden?"
      okText="Abmelden"
      cancelText="Abbrechen"
      okButtonProps={{ danger: true, loading: isLaeuft }}
      cancelButtonProps={{ id: abbrechenId, disabled: isLaeuft }}
      closable={!isLaeuft}
      keyboard={!isLaeuft}
      mask={{ closable: !isLaeuft }}
      // Nach dem Öffnen, nicht per `autoFocus`: rc-dialog zieht den Fokus beim Öffnen auf seine
      // Fläche, ohne Animation auch nach einem `autoFocus` am Knopf.
      afterOpenChange={(isNowOpen) => {
        if (isNowOpen) document.getElementById(abbrechenId)?.focus();
      }}
      onOk={() => void handleBestaetigen()}
      onCancel={onClose}
      destroyOnHidden
    >
      <p>Die Sitzung auf diesem Gerät endet.</p>
    </Modal>
  );
}

/** Rückfrage samt Zustand für einen Aufrufer, der den Dialog selbst einhängt (Benutzermenü). */
export function useAbmeldenRueckfrage(): AbmeldenRueckfrage {
  const [isOpen, setOpen] = useState(false);
  return {
    open: () => setOpen(true),
    dialog: <AbmeldenRueckfrageDialog isOpen={isOpen} onClose={() => setOpen(false)} />,
  };
}
