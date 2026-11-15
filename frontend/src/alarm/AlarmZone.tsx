import { Button } from 'antd';
import type { CSSProperties, ReactNode } from 'react';
import { schriftStil, useRollen } from '../components/instrument/rollenwerte';
import { RAHMEN_EBENE, RANG_ALARMZONE, useRahmenObenStapel } from '../components/rahmenOben';
import { useViewport } from '../components/useViewport';
import { IconChevronHoch, IconChevronRunter, IconKreuz } from '../icons';
import { schrift, type Farbrollen } from '../theme/tokens';
import { useAlarmZone, zoneAufklappen, type ZonenEintrag } from './alarmZoneSpeicher';

/**
 * Alarmzone (LLH-1735, Spec `benachrichtigungen`, „Alarmzone verdeckt nichts“, design.md D1–D3 in
 * `openspec/changes/zu9ptja2-alarmzone/`, Entwurf `docs/design/2026-11-15-alarmzone/`): Alarme,
 * Org-Hinweise und die Unwetterwarnung stehen hier statt als Toast oben rechts. Sie steht im Rahmen
 * direkt unter dem Kopf und einem Übungsband, klebt beim Rollen darunter (`RANG_ALARMZONE`) und
 * schiebt den Inhalt, statt ihn zu verdecken. Auf `RAHMEN_EBENE` liegt sie unter Drawer, Dialogen
 * und Menüs. Ohne Eintrag steht nichts.
 *
 * Ein Eintrag ist eine Zeile. Ab zwei bündelt sie: zu der jüngste mit „+ n weitere“, auf eine
 * Kopfzeile mit Zahl und je Art der Zahl, darunter je Eintrag eine Zeile. Ein ✕ blendet nur aus
 * (LLH-1736), „Gelesen“ und „Öffnen“ quittieren.
 *
 * `nurAbMd`: im Einsatz trägt unter `md` die Leiste am Handschirm die Alarme (LLH-1738, D5); im
 * Org-Rahmen gibt es keine Leiste, dort steht die Zone in jeder Breite.
 */
export default function AlarmZone({ nurAbMd = false }: { nurAbMd?: boolean }) {
  const { eintraege, aufgeklappt } = useAlarmZone();
  const { istSchmal } = useViewport();
  const { token, rollen } = useRollen();
  const sichtbar = eintraege.length > 0 && !(nurAbMd && istSchmal);
  const { ref, oben } = useRahmenObenStapel<HTMLElement>(sichtbar, RANG_ALARMZONE);
  if (!sichtbar) return null;

  const juengster = eintraege[eintraege.length - 1];
  const gebuendelt = eintraege.length >= 2;
  const alarm = eintraege.some((e) => e.stufe === 'alarm');
  const ton = farbeVon(rollen, alarm);

  const zeileStil: CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    flexWrap: 'wrap',
    columnGap: token.paddingSM,
    rowGap: token.paddingXXS,
    minHeight: token.controlHeight + 2 * token.paddingXXS,
    paddingBlock: token.paddingXXS,
    paddingInline: `var(--lfh-seiten-polsterung)`,
  };

  return (
    <section
      ref={ref}
      aria-label="Alarme"
      data-lfh="alarmzone"
      data-anzahl={eintraege.length}
      style={{
        position: 'sticky',
        top: oben,
        zIndex: RAHMEN_EBENE,
        flexShrink: 0,
        background: ton.flaeche,
        borderBlockEnd: `1px solid ${rollen.linieStark}`,
        // Die Kante trägt die Stufe; das Wort steht dazu (WCAG 1.4.1).
        boxShadow: `inset 4px 0 0 ${ton.kante}`,
        color: rollen.text,
        lineHeight: token.lineHeight,
      }}
    >
      {!gebuendelt || !aufgeklappt ? (
        <Zeile
          eintrag={juengster}
          stil={zeileStil}
          rollen={rollen}
          zusatz={
            gebuendelt ? (
              <Button
                type="link"
                onClick={() => zoneAufklappen(true)}
                icon={<IconChevronRunter />}
                iconPlacement="end"
              >
                {`+ ${eintraege.length - 1} weitere`}
              </Button>
            ) : null
          }
          zaehler={gebuendelt ? eintraege.length : undefined}
        />
      ) : (
        <>
          <div style={zeileStil}>
            <Wort stufe={alarm ? 'alarm' : 'hinweis'} rollen={rollen} />
            <span style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>
              {`${eintraege.length} ${alarm ? 'Alarme' : 'Hinweise'}`}
            </span>
            <span style={textStil(rollen)}>{zaehlung(eintraege)}</span>
            <Button
              type="link"
              onClick={() => zoneAufklappen(false)}
              icon={<IconChevronHoch />}
              iconPlacement="end"
            >
              Zuklappen
            </Button>
            <Button
              type="text"
              aria-label="Alle ausblenden, ohne zu quittieren"
              icon={<IconKreuz />}
              onClick={() => {
                for (const e of eintraege) e.ausblenden();
              }}
            />
          </div>
          {[...eintraege].reverse().map((e) => (
            <Zeile
              key={e.schluessel}
              eintrag={e}
              rollen={rollen}
              stil={{
                ...zeileStil,
                borderBlockStart: `1px solid ${rollen.linie}`,
                paddingInlineStart: `calc(var(--lfh-seiten-polsterung) + ${token.padding}px)`,
              }}
              mitWort={false}
            />
          ))}
        </>
      )}
    </section>
  );
}

function farbeVon(rollen: Farbrollen, alarm: boolean): { flaeche: string; kante: string } {
  return alarm
    ? { flaeche: rollen.alarmFlaeche, kante: rollen.alarm }
    : { flaeche: rollen.bedienFlaeche, kante: rollen.bedien };
}

function textStil(rollen: Farbrollen): CSSProperties {
  return {
    flex: '1 1 12em',
    minWidth: 0,
    color: rollen.text2,
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  };
}

/** „2 × Auftrag überfällig · 1 × Bestätigung ausstehend“, in der Reihenfolge des ersten Auftretens. */
function zaehlung(eintraege: readonly ZonenEintrag[]): string {
  const zaehler = new Map<string, number>();
  for (const e of eintraege) zaehler.set(e.name, (zaehler.get(e.name) ?? 0) + 1);
  return [...zaehler].map(([name, n]) => `${n} × ${name}`).join(' · ');
}

function Wort({ stufe, rollen }: { stufe: 'alarm' | 'hinweis'; rollen: Farbrollen }) {
  return (
    <span
      style={{
        ...schriftStil('augenbraue'),
        fontWeight: 700,
        color: stufe === 'alarm' ? rollen.alarmText : rollen.bedienText,
        whiteSpace: 'nowrap',
      }}
    >
      {stufe === 'alarm' ? 'ALARM' : 'HINWEIS'}
    </span>
  );
}

function Zeile({
  eintrag,
  stil,
  rollen,
  zusatz,
  zaehler,
  mitWort = true,
}: {
  eintrag: ZonenEintrag;
  stil: CSSProperties;
  rollen: Farbrollen;
  zusatz?: ReactNode;
  zaehler?: number;
  mitWort?: boolean;
}) {
  return (
    <div data-lfh="alarm-eintrag" data-schluessel={eintrag.schluessel} style={stil}>
      {mitWort && <Wort stufe={eintrag.stufe === 'alarm' ? 'alarm' : 'hinweis'} rollen={rollen} />}
      {zaehler != null && (
        <span
          aria-label={`${zaehler} Alarme`}
          style={{
            fontFamily: schrift.zahl,
            fontVariantNumeric: 'tabular-nums',
            fontWeight: 700,
            paddingInline: 5,
            background: rollen.alarm,
            color: rollen.aufBedien,
          }}
        >
          {zaehler}
        </span>
      )}
      <span role="status" style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>
        {eintrag.titel}
      </span>
      {eintrag.beschreibung && (
        <span style={textStil(rollen)} title={eintrag.beschreibungVoll}>
          {eintrag.beschreibung}
        </span>
      )}
      <span style={{ display: 'inline-flex', gap: 8, marginInlineStart: 'auto', flexShrink: 0 }}>
        <Button type="primary" onClick={eintrag.oeffnen}>
          Öffnen
        </Button>
        {eintrag.gelesen && <Button onClick={eintrag.gelesen}>Gelesen</Button>}
        {zusatz}
        <Button
          type="text"
          aria-label="Ausblenden, ohne zu quittieren"
          icon={<IconKreuz />}
          onClick={eintrag.ausblenden}
        />
      </span>
    </div>
  );
}
