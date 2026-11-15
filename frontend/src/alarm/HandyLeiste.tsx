import { Button, theme } from 'antd';
import { useRef } from 'react';
import { createPortal } from 'react-dom';
import { useRollen } from '../components/instrument/rollenwerte';
import { useBandAbstand } from '../components/untereLeiste';
import { useViewport } from '../components/useViewport';
import { IconChevronRechts, IconKreuz } from '../icons';
import { useAlarmZone, type ZonenEintrag } from './alarmZoneSpeicher';
import { bandUnten } from './Eingangsband';
import { oeffneEingaenge } from './eingaenge';
import { useFokusInEingabe } from './useFokusInEingabe';

/** Höhe der Leiste in px (Spec: höchstens 48). */
export const LEISTE_HOEHE = 48;

function alarmeText(n: number): string {
  return n === 1 ? '1 Alarm' : `${n} Alarme`;
}

function eingaengeText(n: number): string {
  return n === 1 ? '1 Eingang' : `${n} Eingänge`;
}

/**
 * Leiste am Handschirm (LLH-1738, Spec `benachrichtigungen`, „Eine Leiste am Handschirm“,
 * design.md D5 in `openspec/changes/zu9ptja2-alarmzone/`, Entwurf
 * `docs/design/2026-11-15-alarmzone/Handy-Leiste.dc.html`): unter `md` tragen Alarme und Eingänge
 * im Einsatz statt Alarmzone oben und Eingangsband unten diese eine Zeile von 48 px, „1 Alarm ·
 * 3 Eingänge ›“. Ein Tipp öffnet das Blatt „Alarme und Eingänge“ (`EingaengeKnopf.tsx`, über
 * {@link oeffneEingaenge}).
 *
 * Wie das Eingangsband ein Portal, fest über dem unteren Rand, und es weicht unteren Leisten aus
 * (`useBandAbstand`, etwa der Erfassung im ETB). Bei Fokus in einem Eingabefeld klappt es ein; steht
 * ein Alarm an, bleibt stattdessen eine Zeile mit dem jüngsten Alarm. ✕ blendet Eingänge aus, ohne
 * zu quittieren; einen Alarm nimmt nur das Blatt weg.
 */
export default function HandyLeiste({
  einsatzId,
  eingaenge,
  eingaengeAusblenden,
}: {
  einsatzId: number;
  /** Eingänge, die das Band ab `md` zeigte. */
  eingaenge: number;
  eingaengeAusblenden: () => void;
}) {
  const { istSchmal } = useViewport();
  const tippt = useFokusInEingabe();
  const { eintraege: alarme } = useAlarmZone();
  if (!istSchmal) return null;
  if (alarme.length === 0 && (eingaenge === 0 || tippt)) return null;
  // Eigene Komponente: `useBandAbstand` misst ab dem Einhängen der Leiste. Stünde der Hook hier,
  // läse er die Ref schon, solange die Leiste noch nichts zeigt, und rückte später nicht nach.
  return (
    <Leiste
      einsatzId={einsatzId}
      eingaenge={eingaenge}
      eingaengeAusblenden={eingaengeAusblenden}
      tippt={tippt}
      alarme={alarme}
    />
  );
}

function Leiste({
  einsatzId,
  eingaenge,
  eingaengeAusblenden,
  tippt,
  alarme,
}: {
  einsatzId: number;
  eingaenge: number;
  eingaengeAusblenden: () => void;
  tippt: boolean;
  alarme: readonly ZonenEintrag[];
}) {
  const { token } = theme.useToken();
  const { rollen } = useRollen();
  const ref = useRef<HTMLElement>(null);
  const rand = 0;
  const abstand = useBandAbstand(ref, rand);
  const alarm = alarme.length > 0;

  const juengster = alarme[alarme.length - 1];
  const text = tippt
    ? alarmeText(alarme.length)
    : [alarm ? alarmeText(alarme.length) : null, eingaenge > 0 ? eingaengeText(eingaenge) : null]
        .filter(Boolean)
        .join(' · ');

  return createPortal(
    <nav
      ref={ref}
      aria-label="Alarme und Eingänge"
      data-lfh="handy-leiste"
      data-abstand-unten={abstand}
      style={{
        position: 'fixed',
        insetInline: 0,
        bottom: bandUnten(rand, abstand),
        height: LEISTE_HOEHE,
        boxSizing: 'border-box',
        display: 'flex',
        alignItems: 'stretch',
        // Unter Dialogen und Klappflächen, über dem Inhalt (wie das Eingangsband).
        zIndex: token.zIndexPopupBase - 1,
        background: alarm ? rollen.alarmFlaeche : rollen.kopf,
        borderBlockStart: `1px solid ${rollen.linieStark}`,
        boxShadow: alarm ? `inset 4px 0 0 ${rollen.alarm}` : undefined,
        color: rollen.text,
      }}
    >
      <Button
        type="text"
        onClick={() => oeffneEingaenge(einsatzId)}
        style={{
          flex: 1,
          minWidth: 0,
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'flex-start',
          gap: token.paddingSM,
          paddingInline: token.padding,
          borderRadius: 0,
        }}
      >
        <span
          role="status"
          style={{
            fontWeight: 600,
            color: alarm ? rollen.alarmText : rollen.text,
            whiteSpace: 'nowrap',
          }}
        >
          {text}
        </span>
        {tippt && juengster ? (
          <span
            style={{
              minWidth: 0,
              color: rollen.text2,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {juengster.titel}
          </span>
        ) : null}
        <IconChevronRechts style={{ marginInlineStart: 'auto', color: rollen.gedaempft }} />
      </Button>
      {!alarm && (
        <Button
          type="text"
          aria-label="Ausblenden, ohne zu quittieren"
          icon={<IconKreuz />}
          onClick={eingaengeAusblenden}
          style={{ height: '100%', width: LEISTE_HOEHE, borderRadius: 0, flexShrink: 0 }}
        />
      )}
    </nav>,
    document.body,
  );
}
