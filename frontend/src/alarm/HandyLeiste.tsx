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

function zahlText(n: number, eins: string, mehr: string): string {
  return n === 1 ? `1 ${eins}` : `${n} ${mehr}`;
}

/**
 * Leiste am Handschirm (LLH-1738, Spec `benachrichtigungen`, „Eine Leiste am Handschirm“,
 * design.md D5 in `openspec/changes/zu9ptja2-alarmzone/`, Entwurf
 * `docs/design/2026-11-15-alarmzone/Handy-Leiste.dc.html`): unter `md` tragen Alarme und Eingänge
 * im Einsatz statt Alarmzone oben und Eingangsband unten diese eine Zeile von 48 px, „1 Alarm ·
 * 3 Eingänge ›“. Sie erscheint, sobald etwas neu eingeht oder in der Zone steht, und nennt bei den
 * Eingängen die eine Zahl des Verlaufs wie Kopf und Tab-Titel (`frontend/AGENTS.md`, „Eine Zahl für
 * Eingänge“, Entscheidung Ruben 15.11.2026). Hinweise der Organisation zählt sie als „Hinweis“,
 * nicht als Alarm (Review vor dem PR). Ein Tipp öffnet das Blatt „Alarme und Eingänge“ (`EingaengeKnopf.tsx`, über
 * {@link oeffneEingaenge}).
 *
 * Wie das Eingangsband ein Portal, fest über dem unteren Rand, und es weicht unteren Leisten aus
 * (`useBandAbstand`, etwa der Erfassung im ETB). Bei Fokus in einem Eingabefeld klappt es ein; steht
 * ein Alarm an, bleibt stattdessen eine Zeile mit dem jüngsten Alarm. ✕ blendet Eingänge und
 * Hinweise aus, ohne zu quittieren; einen Alarm nimmt nur das Blatt weg.
 */
export default function HandyLeiste({
  einsatzId,
  eingaenge,
  ungelesen,
  eingaengeAusblenden,
}: {
  einsatzId: number;
  /** Eingänge, die das Band ab `md` zeigte: neu eingegangen, nicht ausgeblendet. */
  eingaenge: number;
  /** Ungelesene Eingänge des Verlaufs, die Zahl am Knopf „Eingänge“; ohne Angabe `eingaenge`. */
  ungelesen?: number;
  eingaengeAusblenden: () => void;
}) {
  const { istSchmal } = useViewport();
  const tippt = useFokusInEingabe();
  const { eintraege } = useAlarmZone();
  if (!istSchmal) return null;
  const alarme = eintraege.filter((e) => e.stufe === 'alarm');
  const hinweise = eintraege.filter((e) => e.stufe !== 'alarm');
  // Beim Tippen hält nur ein Alarm die Leiste; sonst braucht sie Neues.
  if (tippt ? alarme.length === 0 : eintraege.length === 0 && eingaenge === 0) return null;
  // Eigene Komponente: `useBandAbstand` misst ab dem Einhängen der Leiste. Stünde der Hook hier,
  // läse er die Ref schon, solange die Leiste noch nichts zeigt, und rückte später nicht nach.
  return (
    <Leiste
      einsatzId={einsatzId}
      eingaenge={eingaenge > 0 ? Math.max(ungelesen ?? eingaenge, eingaenge) : 0}
      eingaengeAusblenden={() => {
        eingaengeAusblenden();
        for (const h of hinweise) h.ausblenden();
      }}
      tippt={tippt}
      alarme={alarme}
      hinweise={hinweise.length}
    />
  );
}

function Leiste({
  einsatzId,
  eingaenge,
  eingaengeAusblenden,
  tippt,
  alarme,
  hinweise,
}: {
  einsatzId: number;
  eingaenge: number;
  eingaengeAusblenden: () => void;
  tippt: boolean;
  alarme: readonly ZonenEintrag[];
  hinweise: number;
}) {
  const { token } = theme.useToken();
  const { rollen } = useRollen();
  const ref = useRef<HTMLElement>(null);
  const rand = 0;
  const abstand = useBandAbstand(ref, rand);
  const alarm = alarme.length > 0;

  const juengster = alarme[alarme.length - 1];
  const text = tippt
    ? zahlText(alarme.length, 'Alarm', 'Alarme')
    : [
        alarm ? zahlText(alarme.length, 'Alarm', 'Alarme') : null,
        hinweise > 0 ? zahlText(hinweise, 'Hinweis', 'Hinweise') : null,
        eingaenge > 0 ? zahlText(eingaenge, 'Eingang', 'Eingänge') : null,
      ]
        .filter(Boolean)
        .join(' · ');
  return createPortal(
    <nav
      ref={ref}
      aria-label="Alarme und Eingänge"
      data-lfh="handy-leiste"
      data-alarm={alarm ? 'ja' : 'nein'}
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
        background: alarm ? rollen.alarmFlaeche : hinweise > 0 ? rollen.bedienFlaeche : rollen.kopf,
        borderBlockStart: `1px solid ${rollen.linieStark}`,
        boxShadow: alarm
          ? `inset 4px 0 0 ${rollen.alarm}`
          : hinweise > 0
            ? `inset 4px 0 0 ${rollen.bedien}`
            : undefined,
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
