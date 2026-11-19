import { Button } from 'antd';
import type { ButtonProps } from 'antd';
import { forwardRef } from 'react';
import type { ReactNode } from 'react';
import type { StatusDarstellung } from '../../theme/statusFarben';
import { schriftskala } from '../../theme/tokens';
import { monoStil, useRollen } from './rollenwerte';
import { formVonTon } from './Status';
import { statusFlaeche, tonVonRolle, type StatusTon } from './statusFlaeche';

/** Höhe des großen Statusblocks im FMS-Tableau (LLH-1782, Change `eon26eat-status-und-bedienung`, D9). */
export const STATUSBLOCK_MINDESTHOEHE = 88;

export type StatusVariante = 'normal' | 'gross';

interface StatusKnopfProps extends Omit<ButtonProps, 'type' | 'children' | 'size'> {
  darstellung: StatusDarstellung | null;
  /** Code vor dem Wort (FMS „S2“); in der Variante `gross` die große Ziffer. */
  code?: ReactNode;
  /** Mandantenfarbe des Status: Punkt, nie Fläche (LFH-446). */
  farbe?: string | null;
  variante?: StatusVariante;
  /** Ohne Status gesetzt: was statt des Wortes steht. */
  leer?: string;
}

/**
 * Der bedienbare Status (LLH-1780, Spec `status-darstellung`, „Der bedienbare Status ist ein
 * Knopf“). RAHMEN HEISST BEDIENBAR: getönte Fläche der Rolle, Rahmen in der Kante der Rolle,
 * Formzeichen, Wort in 14 px und Pfeil ▾. Ein antd-`Button`, damit die Höhe aus dem
 * `ConfigProvider` kommt (LFH-365): sichtbar so hoch wie antippbar, 30/48/72 px je Dichte.
 *
 * Der Rahmen ist die tragende Kante (≥ 3 : 1 gegen Zeile und Knopffläche), nachgewiesen in
 * `theme/statusKnopfKontrast.test.ts` und im Browser in `e2e/kraefte-kontrast.spec.ts`.
 *
 * `gross` ist der Statusblock einer Tableau-Kachel: die Ziffer in 40 px, das Wort darunter, so
 * breit wie die Kachel.
 */
export const StatusKnopf = forwardRef<HTMLButtonElement, StatusKnopfProps>(function StatusKnopf(
  { darstellung, code, farbe, variante = 'normal', leer = '—', style, ...knopf },
  ref,
) {
  const { token, rollen } = useRollen();
  const ton: StatusTon = darstellung ? (tonVonRolle(darstellung.rolle) ?? 'neutral') : 'neutral';
  const f = statusFlaeche(rollen, ton);
  const form = darstellung?.form ?? formVonTon(ton);
  const mandantenfarbe = farbe?.trim();
  // Das Formzeichen zeichnet `.lfh-form::before` (`theme/sprache.css`), nicht der Text.
  const zeichen = form ? (
    <span className="lfh-form" data-form={form} data-lfh="formzeichen" />
  ) : null;
  const punkt = mandantenfarbe ? (
    <span
      aria-hidden="true"
      data-lfh="mandantenfarbe"
      style={{
        display: 'inline-block',
        width: '0.5em',
        height: '0.5em',
        borderRadius: 0,
        backgroundColor: mandantenfarbe,
      }}
    />
  ) : null;
  const pfeil = (
    <span aria-hidden="true" data-lfh="status-pfeil" style={{ marginInlineStart: 'auto' }}>
      ▾
    </span>
  );
  const wort = darstellung?.label ?? leer;
  const grundstil = {
    background: f.grund,
    color: f.text,
    borderColor: f.kante,
    borderWidth: 1,
    borderStyle: 'solid' as const,
    borderRadius: 0,
    boxShadow: 'none',
  };

  if (variante === 'gross') {
    return (
      <Button
        ref={ref}
        type="default"
        data-lfh="status-knopf"
        data-ton={ton}
        data-variante="gross"
        {...knopf}
        style={{
          ...grundstil,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'stretch',
          justifyContent: 'center',
          gap: token.marginXXS,
          width: '100%',
          height: 'auto',
          minHeight: `max(${STATUSBLOCK_MINDESTHOEHE}px, var(--ant-control-height, 0px))`,
          paddingBlock: token.paddingXS,
          paddingInline: token.paddingSM,
          textAlign: 'start',
          whiteSpace: 'normal',
          ...style,
        }}
      >
        <span style={{ ...monoStil(40, 500), letterSpacing: '-0.02em', lineHeight: 1 }}>
          {code ?? '—'}
        </span>
        <span
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: token.marginXXS,
            fontSize: schriftskala.textKlein.groesse,
          }}
        >
          {zeichen}
          {punkt}
          <span>{wort}</span>
          {pfeil}
        </span>
      </Button>
    );
  }

  return (
    <Button
      ref={ref}
      type="default"
      data-lfh="status-knopf"
      data-ton={ton}
      data-variante="normal"
      {...knopf}
      style={{
        ...grundstil,
        display: 'inline-flex',
        alignItems: 'center',
        gap: token.marginXXS,
        paddingInline: token.paddingSM,
        fontSize: schriftskala.text.groesse,
        ...style,
      }}
    >
      {zeichen}
      {punkt}
      {code != null && <span style={monoStil(14, 500)}>{code}</span>}
      <span>{wort}</span>
      {pfeil}
    </Button>
  );
});

/**
 * Der große Statusblock OHNE Schreibrecht (Spec `fms-tableau`): dieselbe Fläche und Größe wie
 * {@link StatusKnopf} `gross`, aber ohne Rahmen und ohne Pfeil — ein Rahmen hieße bedienbar.
 */
export function StatusBlock({
  darstellung,
  code,
  farbe,
}: {
  darstellung: StatusDarstellung | null;
  code?: ReactNode;
  farbe?: string | null;
}) {
  const { token, rollen } = useRollen();
  const ton: StatusTon = darstellung ? (tonVonRolle(darstellung.rolle) ?? 'neutral') : 'neutral';
  const f = statusFlaeche(rollen, ton);
  const form = darstellung?.form ?? formVonTon(ton);
  const mandantenfarbe = farbe?.trim();
  return (
    <div
      data-lfh="status-block"
      data-ton={ton}
      style={{
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        gap: token.marginXXS,
        minHeight: STATUSBLOCK_MINDESTHOEHE,
        paddingBlock: token.paddingXS,
        paddingInline: token.paddingSM,
        background: f.grund,
        color: f.text,
        boxSizing: 'border-box',
      }}
    >
      <span style={{ ...monoStil(40, 500), letterSpacing: '-0.02em', lineHeight: 1 }}>
        {code ?? '—'}
      </span>
      <span
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: token.marginXXS,
          fontSize: schriftskala.textKlein.groesse,
        }}
      >
        {form && <span className="lfh-form" data-form={form} data-lfh="formzeichen" />}
        {mandantenfarbe && (
          <span
            aria-hidden="true"
            data-lfh="mandantenfarbe"
            style={{
              display: 'inline-block',
              width: '0.5em',
              height: '0.5em',
              backgroundColor: mandantenfarbe,
            }}
          />
        )}
        <span>{darstellung?.label ?? '—'}</span>
      </span>
    </div>
  );
}
