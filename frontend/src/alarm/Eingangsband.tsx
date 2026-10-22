import { Button, theme } from 'antd';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useViewport } from '../components/useViewport';
import { IconKreuz } from '../icons';

/**
 * Eingangsband (LLH-1143, design.md D7): der eine Platz für Eingänge, **unten** — mittig über die
 * Breite, ab `md` rechts —, über der sicheren Fläche. Kein antd-Notification: so nimmt es nie
 * einen der drei Alarmplätze oben rechts, kann von `maxCount` nicht verdrängt werden und liegt
 * unter Dialogen und Alarmen („Alarm hat Vorrang“). Rein darstellend; Inhalt, Regeln und Ton
 * trägt `useEingangshinweis.tsx`.
 *
 * Als Portal an `document.body`: der Kopf, in dem die Zentrale montiert ist, vererbte sonst seine
 * Zeilenhöhe und Farben.
 */
export default function Eingangsband({
  titel,
  children,
  aktion,
  beiSchliessen,
}: {
  titel: string;
  children: ReactNode;
  aktion: { text: string; beiKlick: () => void };
  beiSchliessen: () => void;
}) {
  const { token } = theme.useToken();
  const { istSchmal } = useViewport();
  const rand = token.margin;
  return createPortal(
    <section
      aria-label="Neue Eingänge"
      data-lfh="eingangsband"
      style={{
        position: 'fixed',
        insetInlineEnd: rand,
        insetInlineStart: istSchmal ? rand : 'auto',
        bottom: `calc(${rand}px + env(safe-area-inset-bottom, 0px))`,
        width: istSchmal ? 'auto' : `min(400px, calc(100vw - ${2 * rand}px))`,
        // Unter Dialogen und Klappflächen (`zIndexPopupBase` 1000), über dem Inhalt.
        zIndex: token.zIndexPopupBase - 1,
        background: token.colorBgElevated,
        color: token.colorText,
        border: `1px solid ${token.colorBorderSecondary}`,
        borderInlineStart: `4px solid ${token.colorInfo}`,
        borderRadius: token.borderRadiusLG,
        boxShadow: token.boxShadowSecondary,
        padding: `${token.paddingSM}px ${token.padding}px`,
        lineHeight: token.lineHeight,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: token.paddingXS }}>
        {/* Nur der Titel wird angesagt, nicht die Bedienelemente des Bands. */}
        <div role="status" style={{ flex: 1, minWidth: 0, fontWeight: 600 }}>
          {titel}
        </div>
        <Button
          type="text"
          aria-label="Schließen"
          icon={<IconKreuz />}
          onClick={beiSchliessen}
          style={{ flexShrink: 0 }}
        />
      </div>
      <div>{children}</div>
      <div
        style={{ display: 'flex', justifyContent: 'flex-end', marginBlockStart: token.paddingXS }}
      >
        <Button type="primary" onClick={aktion.beiKlick}>
          {aktion.text}
        </Button>
      </div>
    </section>,
    document.body,
  );
}
