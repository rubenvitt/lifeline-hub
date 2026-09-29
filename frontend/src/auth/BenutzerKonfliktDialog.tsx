import { Button, Flex, Modal, theme } from 'antd';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import { useAuth } from './AuthContext';

/**
 * Benutzerkonflikt (LFH-387): in einem anderen Tab dieses Browsers hat sich jemand anderes
 * angemeldet, die originweite Sitzung gehört nicht mehr dem Benutzer, den dieser Tab zeigt.
 *
 * Der Dialog blockiert — kein Kreuz, kein Escape, kein Klick auf die Maske —, weil es aus
 * diesem Zustand nur einen sinnvollen Weg gibt: Schreibanfragen dieses Tabs tragen weiter den
 * bisherigen Benutzer und scheitern am Server mit 412, bis die Person den neuen übernimmt.
 * Genau EINE Aktion: „Als <neu> weiterarbeiten“ räumt den Query-Cache (dort liegen Daten, die
 * unter dem bisherigen Benutzer geladen wurden), übernimmt den neuen Benutzer und führt zur
 * Startseite — der Deeplink des bisherigen Benutzers ist nicht der Ort des neuen.
 *
 * Kein Erfassungsformular, deshalb nicht `components/Erfassung.tsx`. Gehört ins
 * Sitzungs-Layout neben die Sitzungswache (`App.tsx`), innerhalb von Router und QueryClient.
 */
export default function BenutzerKonfliktDialog() {
  const { konflikt, weiterAls } = useAuth();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { token } = theme.useToken();

  if (!konflikt) return null;
  const { bisher, jetzt } = konflikt;

  function weiter() {
    queryClient.clear();
    weiterAls();
    navigate('/einsaetze', { replace: true });
  }

  return (
    <Modal
      open
      title="Anderer Benutzer angemeldet"
      closable={false}
      keyboard={false}
      mask={{ closable: false }}
      footer={
        <Flex justify="end">
          <Button type="primary" onClick={weiter}>
            {`Als ${jetzt.anzeigename} weiterarbeiten`}
          </Button>
        </Flex>
      }
    >
      <Flex vertical gap={token.marginSM}>
        <span>
          In einem anderen Tab dieses Browsers hat sich <strong>{jetzt.anzeigename}</strong>{' '}
          angemeldet. Dieser Tab war für <strong>{bisher.anzeigename}</strong> geöffnet.
        </span>
        <span>
          Aus diesem Tab wird nichts mehr unter {bisher.anzeigename} gespeichert. Ungesicherte
          Eingaben gehen beim Weiterarbeiten verloren.
        </span>
      </Flex>
    </Modal>
  );
}
