import { useState } from 'react';
import { Button, Popconfirm } from 'antd';
import { Paneel, useRollen } from '../../components/instrument';
import { SpeicherFehler } from '../../components/SpeicherHinweis';

/**
 * „Übernahme stornieren“ an einer Einheit aus einer Nachforderung (LLH-1388, design.md D7): nimmt
 * eine Fehlübernahme zurück — der Verweis entfällt, eine dabei angelegte Einheit verlässt den Raum
 * und wird aufgelöst, eine verknüpfte bleibt. Danach lässt sich „Eingetroffen“ an der Nachforderung
 * wieder zurücknehmen. Unumkehrbar wie das Auflösen, deshalb die Rückfrage mit benanntem `okText`
 * und rotem Knopf (`components/rueckfrage.guard.test.ts`). Eine Ablehnung steht im Paneel, kein
 * Toast.
 *
 * Nur mit Schreibrecht Einheiten und Freigabe Nachforderungen eingehängt; der Aufrufer entscheidet.
 */
export default function EinheitUebernahmeStorno({
  nachforderungId,
  onStornieren,
}: {
  nachforderungId: number;
  /** Storniert; lehnt bei Ablehnung ab. Nach Erfolg führt der Aufrufer zur Nachforderung. */
  onStornieren: () => Promise<unknown>;
}) {
  const { token } = useRollen();
  const [laeuft, setLaeuft] = useState(false);
  const [fehler, setFehler] = useState<unknown>(null);

  function stornieren() {
    setLaeuft(true);
    setFehler(null);
    onStornieren()
      .catch((e: unknown) => setFehler(e))
      .finally(() => setLaeuft(false));
  }

  return (
    <Paneel titel="Übernahme stornieren" koerperPolster>
      {fehler != null && (
        <div style={{ marginBottom: token.marginSM }}>
          <SpeicherFehler
            fehler={fehler}
            titel="Nicht storniert"
            fallback="Storno fehlgeschlagen"
          />
        </div>
      )}
      <Popconfirm
        title={`Übernahme aus Nachforderung #${nachforderungId} stornieren?`}
        description="Eine dabei angelegte Einheit verlässt den Raum und wird aufgelöst, eine verknüpfte bleibt."
        okText="Übernahme stornieren"
        okButtonProps={{ danger: true }}
        onConfirm={stornieren}
      >
        <Button danger loading={laeuft}>
          Übernahme stornieren
        </Button>
      </Popconfirm>
    </Paneel>
  );
}
