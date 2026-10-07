import { Button, Flex, Modal, theme } from 'antd';
import { useAuth } from './AuthContext';
import { seiteNeuLaden } from './seiteNeuLaden';

/**
 * Benutzerkonflikt (LFH-387): in einem anderen Tab dieses Browsers hat sich jemand anderes
 * angemeldet, die originweite Sitzung gehört nicht mehr dem Benutzer, den dieser Tab zeigt.
 *
 * Der Dialog blockiert — kein Kreuz, kein Escape, kein Klick auf die Maske —, weil es aus
 * diesem Zustand nur einen sinnvollen Weg gibt: Schreibanfragen dieses Tabs tragen weiter den
 * bisherigen Benutzer und scheitern am Server mit 412, bis die Person den neuen übernimmt.
 * Genau EINE Aktion: „Als <neu> weiterarbeiten“ lädt die Startseite neu. Bewusst KEIN Umstellen
 * im laufenden Baum: die Seite des bisherigen Benutzers bliebe dabei montiert, ihr
 * Navigationsschutz hielte den Seitenwechsel an, und Autosave oder „Speichern und weiter“
 * schrieben ihren Entwurf mit der Kennung des NEUEN Benutzers. Beim Neuladen trägt alles, was
 * die alte Seite noch absenden will, weiter die Kennung des bisherigen — der Server lehnt es mit
 * 412 ab. Query-Cache und Seitenzustand gehen mit dem Neuladen, der frische Tab lädt den neuen
 * Benutzer über `GET /api/auth/me`.
 *
 * Kein Erfassungsformular, deshalb nicht `components/Erfassung.tsx`. Gehört ins
 * Sitzungs-Layout neben die Sitzungswache (`App.tsx`), innerhalb von Router und QueryClient.
 */
export default function BenutzerKonfliktDialog() {
  const { konflikt } = useAuth();
  const { token } = theme.useToken();

  if (!konflikt) return null;
  const { bisher, jetzt } = konflikt;

  return (
    <Modal
      open
      title="Anderer Benutzer angemeldet"
      closable={false}
      keyboard={false}
      mask={{ closable: false }}
      footer={
        <Flex justify="end">
          <Button type="primary" onClick={() => seiteNeuLaden('/einsaetze')}>
            {`Als ${jetzt.anzeigename} weiterarbeiten`}
          </Button>
        </Flex>
      }
    >
      <Flex vertical gap={token.marginSM}>
        <span>
          In einem anderen Tab ist jetzt <strong>{jetzt.anzeigename}</strong> angemeldet, dieser Tab
          gehörte <strong>{bisher.anzeigename}</strong>.
        </span>
        <span>
          Unter {bisher.anzeigename} wird hier nichts mehr gespeichert. Vorgemerkte Einträge bleiben
          für {bisher.anzeigename} liegen.
        </span>
        <span>Ungesicherte Eingaben gehen verloren.</span>
      </Flex>
    </Modal>
  );
}
