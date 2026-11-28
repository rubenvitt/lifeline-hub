import { Button, Checkbox, Modal, Typography } from 'antd';
import type { ComponentProps } from 'react';
import KopierbarerText from '../../components/KopierbarerText';
import { Stapel, monoStil, useRollen } from '../../components/instrument';
import { SpeicherFehler } from '../../components/SpeicherHinweis';
import { useAnzeigeKonventionen } from '../../anzeige/AnzeigeKonventionenContext';
import { zeitKurz } from '../../anzeige/zeitDarstellung';
import { AM_HUB_SCOPE, SCOPES, SCOPE_TEXT, scopeText } from '../../api/anbindungen';
import type { AnbindungAnzeige, AnbindungCode, Scope } from '../../api/types';

/** Rechte eines Zugangs: Klartext und daneben der Wire-Wert für den Abgleich mit dem Fremdsystem. */
export function RechteText({ scopes }: { scopes: readonly string[] }) {
  const { rollen } = useRollen();
  return (
    <span data-lfh="anbindung-rechte">
      {scopes.map((s, i) => (
        <span key={s}>
          {i > 0 && ' · '}
          {scopeText(s)}{' '}
          <span style={{ ...monoStil('monoFein', 500), color: rollen.schwach }}>{s}</span>
        </span>
      ))}
    </span>
  );
}

/**
 * Auswahl der Rechte für Anlegen und Bearbeiten (Form-Steuerelement: `value`/`onChange` gehen an
 * die Gruppe). Meldet sich die Instanz bei einem Hub (`amHubGrund`, der Grund vom Server), ist nur
 * „Meldungen einreichen“ wählbar (LLH-2112); ein Recht, das der Zugang schon hat (`behalten`),
 * lässt sich dort noch abwählen.
 */
export function RechteAuswahl({
  amHubGrund = null,
  behalten = [],
  ...gruppe
}: {
  amHubGrund?: string | null;
  behalten?: readonly Scope[];
} & ComponentProps<typeof Checkbox.Group<Scope>>) {
  const { rollen } = useRollen();
  const gesperrt = (s: Scope) => amHubGrund != null && s !== AM_HUB_SCOPE && !behalten.includes(s);
  return (
    <Stapel abstand="xs">
      <Checkbox.Group<Scope> {...gruppe}>
        <Stapel abstand="xxs">
          {SCOPES.map((s) => (
            <Checkbox key={s} value={s} disabled={gesperrt(s)}>
              {SCOPE_TEXT[s]}{' '}
              <span style={{ ...monoStil('monoFein', 500), color: rollen.schwach }}>{s}</span>
            </Checkbox>
          ))}
        </Stapel>
      </Checkbox.Group>
      {amHubGrund != null && (
        <Typography.Text type="secondary" data-lfh="anbindung-rechte-am-hub">
          {`${amHubGrund} Hier ist nur „${SCOPE_TEXT[AM_HUB_SCOPE]}“ wählbar.`}
        </Typography.Text>
      )}
    </Stapel>
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
  const { rollen } = useRollen();
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
        <div data-lfh="anbindung-code">
          <Stapel abstand="sm">
            <KopierbarerText text={code.code} bezeichnung="Code">
              <span data-lfh="anbindung-code-text" style={monoStil('datenwertKlein')}>
                {code.code}
              </span>
            </KopierbarerText>
            <span style={{ color: rollen.gedaempft }}>
              gilt bis {zeitKurz(code.laeuft_ab_at, konv)}, einmal einlösbar · nur jetzt sichtbar
            </span>
            <KopierbarerText text={kommando} bezeichnung="Kommando">
              <span
                data-schrift="kennung"
                style={{ ...monoStil('monoKlein', 500), wordBreak: 'break-all' }}
              >
                {kommando}
              </span>
            </KopierbarerText>
            <span style={{ color: rollen.gedaempft }}>
              Nach dem Einlösen steht der Fingerabdruck des Fremdsystems am Zugang. Das Kommando
              zeigt denselben.
            </span>
          </Stapel>
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
