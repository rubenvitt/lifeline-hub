import { useState } from 'react';
import { Button, Popconfirm, Space } from 'antd';
import { Paneel, useRollen } from '../../components/instrument';
import { SpeicherFehler } from '../../components/SpeicherHinweis';

type Art = 'aufloesen' | 'stornieren';

/**
 * „Einheit auflösen oder stornieren“ als letzter Abschnitt der Seite (LLH-1036, design.md D12),
 * abgesetzt von den Angaben, nach dem Muster des Einsatzabschlusses (LFH-960). Beide Wege sind
 * unumkehrbar: eine aufgelöste Einheit wird nicht reaktiviert (LLH-1079), eine stornierte ist
 * gelöscht. Deshalb je eine Rückfrage mit benanntem `okText` und rotem Knopf
 * (`components/rueckfrage.guard.test.ts`) und dem einen Satz zur Folge.
 *
 * Stornieren (LLH-1881) nimmt eine Fehlanlage zurück und gelingt nur ohne jede Spur; ob eine
 * Einheit Spuren hat, weiß nur der Server. Der Knopf steht deshalb immer da wie bei Fahrzeug,
 * Personal und Material, und der Server nennt den Grund einer Ablehnung. Eine Ablehnung steht im
 * Paneel, kein Toast; ein neuer Versuch räumt sie weg.
 *
 * Nur mit Schreibrecht und Freigabe Einheiten eingehängt; der Aufrufer entscheidet.
 */
export default function EinheitAufloesen({
  onAufloesen,
  onStornieren,
}: {
  /** Löst auf; lehnt bei Ablehnung ab. Nach Erfolg führt der Aufrufer zur Gliederung. */
  onAufloesen: () => Promise<unknown>;
  /** Storniert die Fehlanlage; lehnt bei Ablehnung ab. Nach Erfolg wie `onAufloesen`. */
  onStornieren: () => Promise<unknown>;
}) {
  const { token } = useRollen();
  const [laeuft, setLaeuft] = useState<Art | null>(null);
  const [fehler, setFehler] = useState<{ art: Art; fehler: unknown } | null>(null);

  function fuehreAus(art: Art) {
    setLaeuft(art);
    setFehler(null);
    (art === 'aufloesen' ? onAufloesen() : onStornieren())
      .catch((e: unknown) => setFehler({ art, fehler: e }))
      .finally(() => setLaeuft(null));
  }

  return (
    <Paneel titel="Einheit auflösen oder stornieren" koerperPolster>
      {fehler != null && (
        <div style={{ marginBottom: token.marginSM }}>
          {fehler.art === 'aufloesen' ? (
            <SpeicherFehler
              fehler={fehler.fehler}
              titel="Nicht aufgelöst"
              fallback="Auflösen fehlgeschlagen"
            />
          ) : (
            <SpeicherFehler
              fehler={fehler.fehler}
              titel="Nicht storniert"
              fallback="Stornieren fehlgeschlagen"
            />
          )}
        </div>
      )}
      <Space size="middle" wrap>
        <Popconfirm
          title="Einheit auflösen?"
          description="Mitglieder werden frei, Unter-Einheiten rücken eine Ebene hoch, gekoppelte Geräte enden."
          okText="Einheit auflösen"
          okButtonProps={{ danger: true }}
          onConfirm={() => fuehreAus('aufloesen')}
        >
          <Button danger loading={laeuft === 'aufloesen'} disabled={laeuft === 'stornieren'}>
            Einheit auflösen
          </Button>
        </Popconfirm>
        <Popconfirm
          title="Einheit stornieren?"
          description="Die Einheit erscheint danach in keiner Liste und keinem Nachweis."
          okText="Einheit stornieren"
          okButtonProps={{ danger: true }}
          onConfirm={() => fuehreAus('stornieren')}
        >
          <Button danger loading={laeuft === 'stornieren'} disabled={laeuft === 'aufloesen'}>
            Einheit stornieren
          </Button>
        </Popconfirm>
      </Space>
    </Paneel>
  );
}
