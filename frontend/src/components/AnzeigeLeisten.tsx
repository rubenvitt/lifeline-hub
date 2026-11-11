import { useId, type KeyboardEvent, type ReactNode } from 'react';
import { theme } from 'antd';
import { Augenbraue, Segmentleiste, type SegmentOption } from './instrument';
import {
  useDichte,
  useHelligkeit,
  useThemeMode,
  type ThemeModus,
} from '../theme/ThemeModeProvider';
import type { Dichte } from '../theme/tokens';
import {
  DARSTELLUNG_OPTIONEN,
  DICHTE_OPTIONEN,
  HELLIGKEIT_OPTIONEN,
} from '../theme/darstellungOptionen';
import { HELLIGKEIT_BODEN_WARNUNG, type Helligkeit } from '../theme/helligkeit';

/** Kennzeichen der Gruppe im Menü: daran findet `BenutzerMenu` sie für Tab (LLH-1642 D2). */
export const ANZEIGE_GRUPPE = 'benutzermenue-anzeige';

/**
 * Tasten, die eine Leiste selbst bedient (Segmentleiste: Pfeile, Pos1, Ende; Knopf: Enter,
 * Leertaste). Sie gehen NICHT an das Menü weiter: `rc-menu` zöge sonst den Menüfokus mit, und
 * Enter auf dem Menü schlösse es.
 */
const EIGENE_TASTEN = new Set([
  'ArrowLeft',
  'ArrowRight',
  'ArrowUp',
  'ArrowDown',
  'Home',
  'End',
  'Enter',
  ' ',
]);

const DARSTELLUNG: SegmentOption<ThemeModus>[] = DARSTELLUNG_OPTIONEN.map((o) => ({
  wert: o.wert,
  label: o.titel,
}));
const DICHTE: SegmentOption<Dichte>[] = DICHTE_OPTIONEN.map((o) => ({
  wert: o.wert,
  label: o.titel,
}));

/**
 * Die Gruppe „Anzeige“ des Benutzermenüs (LLH-1642, Spec `benutzermenue`): Darstellung,
 * Bediendichte und Helligkeit als je eine Segmentleiste in voller Breite, statt elf Einträgen
 * unter drei Überschriften. Der gewählte Wert ist ausgewählt (`aria-checked`); eine Wahl wirkt
 * sofort, das Menü bleibt offen (die Gruppe ist Inhalt eines Gruppentitels, kein `menuitem`, und
 * löst kein `onClick` des Menüs aus).
 *
 * DIE SPERRE WIRD ERKLÄRT, NICHT STUMM WEGGESCHALTET (LFH-397, M16, Spec `bedien-helligkeit`):
 * mit aktiver Warnung nennt das Etikett Boden und Grund, die Stufen darunter sind gesperrt und
 * nennen den Grund, und liegt die Wahl darunter, sagt eine Zeile, was wirkt. Die Wahl selbst bleibt
 * stehen — endet die Warnung, gilt sie wieder.
 *
 * Angebunden über `useThemeMode`/`useDichte`/`useHelligkeit`, NICHT über die Kommandopalette.
 */
export default function AnzeigeLeisten() {
  const { token } = theme.useToken();
  const titelId = useId();
  const { modus, setModus } = useThemeMode();
  const { dichte, setDichte } = useDichte();
  const { helligkeit, setHelligkeit, wirksam, warnungAktiv } = useHelligkeit();

  const grund = `Warnung aktiv: mindestens ${HELLIGKEIT_BODEN_WARNUNG} %`;
  // Sichtbar steht die Zahl, der zugängliche Name nennt die Einheit („40 %“).
  const helligkeitOptionen: SegmentOption<Helligkeit>[] = HELLIGKEIT_OPTIONEN.map((o) => ({
    wert: o.wert,
    label: String(o.wert),
    name: o.titel,
    gesperrt: warnungAktiv && o.wert < HELLIGKEIT_BODEN_WARNUNG ? grund : undefined,
  }));

  const etikett = { display: 'block', fontSize: token.fontSizeSM, color: token.colorTextSecondary };

  // Das sichtbare Etikett steht über der Leiste; ihren zugänglichen Namen trägt die Leiste selbst
  // (`beschriftung`), damit er nicht mit dem Warnhinweis wechselt.
  function leiste(sichtbar: string, kind: ReactNode, hinweis?: string) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: token.marginXXS }}>
        <span style={etikett}>{sichtbar}</span>
        {kind}
        {hinweis && (
          <span data-lfh="helligkeit-wirkt" style={etikett}>
            {hinweis}
          </span>
        )}
      </div>
    );
  }

  function tasten(e: KeyboardEvent<HTMLDivElement>) {
    if (EIGENE_TASTEN.has(e.key)) e.stopPropagation();
  }

  return (
    <div
      role="group"
      aria-labelledby={titelId}
      data-lfh={ANZEIGE_GRUPPE}
      onKeyDown={tasten}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: token.marginXS,
        padding: `${token.paddingXXS}px 0`,
        color: token.colorText,
      }}
    >
      <Augenbraue id={titelId}>Anzeige</Augenbraue>
      {leiste(
        'Darstellung',
        <Segmentleiste
          optionen={DARSTELLUNG}
          wert={modus}
          onWechsel={setModus}
          beschriftung="Darstellung"
          hasFullWidth
        />,
      )}
      {leiste(
        'Bediendichte',
        <Segmentleiste
          optionen={DICHTE}
          wert={dichte}
          onWechsel={setDichte}
          beschriftung="Bediendichte"
          hasFullWidth
        />,
      )}
      {leiste(
        warnungAktiv
          ? `Helligkeit in % · mind. ${HELLIGKEIT_BODEN_WARNUNG} % (Warnung aktiv)`
          : 'Helligkeit in %',
        <Segmentleiste
          optionen={helligkeitOptionen}
          wert={helligkeit}
          onWechsel={setHelligkeit}
          beschriftung="Helligkeit in %"
          hasFullWidth
        />,
        wirksam !== helligkeit ? `Gewählt ${helligkeit} %, wirkt ${wirksam} %` : undefined,
      )}
    </div>
  );
}
