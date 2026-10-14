import { useState } from 'react';
import { Button, Popconfirm } from 'antd';
import { Paneel, useRollen } from '../../components/instrument';
import { SpeicherFehler } from '../../components/SpeicherHinweis';

/**
 * „Einheit auflösen“ als letzter Abschnitt der Seite (LLH-1036, design.md D12), abgesetzt von den
 * Angaben, nach dem Muster des Einsatzabschlusses (LFH-960). Unumkehrbar: eine aufgelöste Einheit
 * wird nicht reaktiviert (LLH-1079), deshalb die Rückfrage mit benanntem `okText` und rotem Knopf
 * (`components/rueckfrage.guard.test.ts`). Die Beschreibung ist der eine Satz zur Folge aus
 * LLH-1079. Eine Ablehnung steht im Paneel, kein Toast.
 *
 * Nur mit Schreibrecht und Freigabe Einheiten eingehängt; der Aufrufer entscheidet.
 */
export default function EinheitAufloesen({
  onAufloesen,
}: {
  /** Löst auf; lehnt bei Ablehnung ab. Nach Erfolg führt der Aufrufer zur Gliederung. */
  onAufloesen: () => Promise<unknown>;
}) {
  const { token } = useRollen();
  const [laeuft, setLaeuft] = useState(false);
  const [fehler, setFehler] = useState<unknown>(null);

  function aufloesen() {
    setLaeuft(true);
    setFehler(null);
    onAufloesen()
      .catch((e: unknown) => setFehler(e))
      .finally(() => setLaeuft(false));
  }

  return (
    <Paneel titel="Einheit auflösen" koerperPolster>
      {fehler != null && (
        <div style={{ marginBottom: token.marginSM }}>
          <SpeicherFehler
            fehler={fehler}
            titel="Nicht aufgelöst"
            fallback="Auflösen fehlgeschlagen"
          />
        </div>
      )}
      <Popconfirm
        title="Einheit auflösen?"
        description="Mitglieder werden frei, Unter-Einheiten rücken eine Ebene hoch."
        okText="Einheit auflösen"
        okButtonProps={{ danger: true }}
        onConfirm={aufloesen}
      >
        <Button danger loading={laeuft}>
          Einheit auflösen
        </Button>
      </Popconfirm>
    </Paneel>
  );
}
