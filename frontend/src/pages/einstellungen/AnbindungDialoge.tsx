import { Button, Modal } from 'antd';
import KopierbarerText from '../../components/KopierbarerText';
import { monoStil, useRollen } from '../../components/instrument';
import { SpeicherFehler } from '../../components/SpeicherHinweis';
import { useAnzeigeKonventionen } from '../../anzeige/AnzeigeKonventionenContext';
import { zeitKurz } from '../../anzeige/zeitDarstellung';
import { scopeText } from '../../api/anbindungen';
import type { AnbindungAnzeige, AnbindungCode } from '../../api/types';

/** Rechte eines Zugangs: Klartext und daneben der Wire-Wert für den Abgleich mit dem Fremdsystem. */
export function RechteText({ scopes }: { scopes: readonly string[] }) {
  const { rollen } = useRollen();
  return (
    <span data-lfh="anbindung-rechte">
      {scopes.map((s, i) => (
        <span key={s}>
          {i > 0 && ' · '}
          {scopeText(s)} <span style={{ ...monoStil(11, 500), color: rollen.schwach }}>{s}</span>
        </span>
      ))}
    </span>
  );
}

/**
 * Der Einmal-Code, genau einmal sichtbar. Schließen nur über „Fertig“: ein Escape oder ein Klick
 * neben den Dialog verlöre den Code, bevor er abgeschrieben ist.
 */
export function CodeDialog({
  code,
  onFertig,
}: {
  code: AnbindungCode | null;
  onFertig: () => void;
}) {
  const { token, rollen } = useRollen();
  const { konventionen: konv } = useAnzeigeKonventionen();
  const kommando = code ? `lifeline-hub zugang redeem ${window.location.origin} ${code.code}` : '';
  return (
    <Modal
      open={code != null}
      title={code ? `Code für ${code.zugang.name}` : 'Code'}
      closable={false}
      maskClosable={false}
      keyboard={false}
      footer={
        <Button type="primary" onClick={onFertig}>
          Fertig
        </Button>
      }
      destroyOnHidden
    >
      {code && (
        <div
          data-lfh="anbindung-code"
          style={{ display: 'flex', flexDirection: 'column', gap: token.marginSM }}
        >
          <KopierbarerText text={code.code} bezeichnung="Code">
            <span data-lfh="anbindung-code-text" style={monoStil(22, 500)}>
              {code.code}
            </span>
          </KopierbarerText>
          <span style={{ color: rollen.gedaempft }}>
            gilt bis {zeitKurz(code.laeuft_ab_at, konv)}, einmal einlösbar · nur jetzt sichtbar
          </span>
          <KopierbarerText text={kommando} bezeichnung="Kommando">
            <span style={{ ...monoStil(12, 500), wordBreak: 'break-all' }}>{kommando}</span>
          </KopierbarerText>
          <span style={{ color: rollen.gedaempft }}>
            Nach dem Einlösen steht der Fingerabdruck des Fremdsystems am Zugang. Das Kommando zeigt
            denselben.
          </span>
        </div>
      )}
    </Modal>
  );
}

/** Rückfrage vor dem Widerruf; solange er läuft, lässt sich der Dialog nicht schließen. */
export function WiderrufDialog({
  zugang,
  laeuft,
  fehler,
  onWiderrufen,
  onAbbrechen,
}: {
  zugang: AnbindungAnzeige | null;
  laeuft: boolean;
  fehler: unknown;
  onWiderrufen: (z: AnbindungAnzeige) => void;
  onAbbrechen: () => void;
}) {
  return (
    <Modal
      open={zugang != null}
      title={zugang ? `${zugang.name} widerrufen?` : 'Widerrufen?'}
      okText="Widerrufen"
      cancelText="Abbrechen"
      okButtonProps={{ danger: true, loading: laeuft }}
      cancelButtonProps={{ disabled: laeuft }}
      closable={!laeuft}
      maskClosable={!laeuft}
      keyboard={!laeuft}
      onOk={() => zugang && onWiderrufen(zugang)}
      onCancel={() => {
        if (!laeuft) onAbbrechen();
      }}
      destroyOnHidden
    >
      <p>
        Das Fremdsystem kommt ab sofort nicht mehr herein. Andere Anbindungen und gekoppelte
        Instanzen bleiben unberührt.
      </p>
      <SpeicherFehler fehler={fehler} titel="Nicht widerrufen" />
    </Modal>
  );
}
