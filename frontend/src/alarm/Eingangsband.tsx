import { Button, theme } from 'antd';
import { useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useBandAbstand } from '../components/untereLeiste';
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
 *
 * **Es weicht unteren Leisten aus** (LLH-1424): schnitte es eine angemeldete Fußleiste
 * (ETB-Erfassung, Aktionsleiste des Befehlsentwurfs, Speicherleiste …), steht es über deren
 * Oberkante (`components/untereLeiste.ts`), schmal wie breit. Vorher lag es über „Erfassen“ und
 * „Freigeben“, bis man es schloss. Nachweis `e2e/eingangsband-ausweichen.spec.ts`.
 */
export function bandUnten(rand: number, abstand: number) {
  // Am Rand gilt weiter die sichere Fläche; über einer Leiste ist sie in deren Lage schon drin.
  return `max(${abstand}px, calc(${rand}px + env(safe-area-inset-bottom, 0px)))`;
}

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
  const ref = useRef<HTMLElement>(null);
  const abstand = useBandAbstand(ref, rand);
  return createPortal(
    <section
      ref={ref}
      aria-label="Neue Eingänge"
      data-lfh="eingangsband"
      data-abstand-unten={abstand}
      style={{
        position: 'fixed',
        insetInlineEnd: rand,
        insetInlineStart: istSchmal ? rand : 'auto',
        bottom: bandUnten(rand, abstand),
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
