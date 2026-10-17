/**
 * Kalender als Nebenweg der Zeiteingabe (Spec `zeiteingabe`, „Kalender als Nebenweg“;
 * `openspec/changes/ri685cfi-zeiteingabe-tippen-schnellwahl/design.md`, D5): ein Monatsblatt für
 * den Tag, darunter die Uhrzeit als Text und die Schnellwahl. Ein Tag-Klick wählt nur; übernommen
 * wird mit Enter im Uhrzeitfeld oder „Übernehmen“. Keine Scrollspalten, kein „OK“ je Feld.
 *
 * Gerechnet wird mit Kalendertagen `YYYY-MM-DD` der Anzeigezone; den Zeitpunkt bildet
 * `uhrzeitAmTag` (eine Sommerzeitregel für Feld und Kalender). antds `Calendar` sieht nur ein
 * browserlokales `Dayjs` dieses Tages, nie einen Zeitpunkt.
 */
import { Button, Calendar, Flex, Input, type InputRef } from 'antd';
import dayjs, { type Dayjs } from 'dayjs';
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { monoStil, useRollen } from '../components/instrument';
import { IconChevronRechts } from '../icons';
import './dayjsSprache';
import { ZeitSchnellwahl } from './ZeitSchnellwahl';
import { parseUhrzeit, uhrzeitAmTag } from './uhrzeit';
import type { ZeitArt } from './zeitParser';
import { GRUND } from './zeitParser';
import { heuteInZone, tagInZone, zuWanduhr } from './zeitEingabe';

const TAG = 'YYYY-MM-DD';

/** Klasse der Fußzeile; die Regel steht in `ZeitpunktEingabe.css`. */
export const ZEIT_FUSS = 'lfh-zeit-fuss';

export interface ZeitKalenderProps {
  /** Geltender Wert des Felds; ohne Wert öffnet der Kalender auf heute und der aktuellen Minute. */
  wert: Dayjs | null | undefined;
  zone: string | null;
  zonenHinweis: string | null;
  jetzt: () => Dayjs;
  art?: ZeitArt;
  keineZukunftstage?: boolean;
  nurTag?: boolean;
  /**
   * Das Uhrzeitfeld nimmt beim Öffnen den Fokus (Tastatur und Maus). Auf einem Touchgerät nicht:
   * die Bildschirmtastatur ginge auf und deckte das Blatt.
   */
  fokusUhrzeit?: boolean;
  /**
   * Feste Breite am Feld; ohne Angabe füllt der Kalender seinen Behälter (Blatt). antds
   * Mini-Kalender nimmt 100 % und dehnte ein Popover mit `width: max-content` sonst bis zur
   * Schirmbreite.
   */
  breite?: number;
  onUebernehmen: (zeitpunkt: Dayjs) => void;
  onAbbrechen: () => void;
}

export function ZeitKalender({
  wert,
  zone,
  zonenHinweis,
  jetzt,
  art,
  keineZukunftstage,
  nurTag,
  fokusUhrzeit = true,
  breite,
  onUebernehmen,
  onAbbrechen,
}: ZeitKalenderProps) {
  const { rollen } = useRollen();
  const start = wert ?? jetzt();
  const heute = heuteInZone(zone, jetzt());
  const [tag, setTag] = useState(() => tagInZone(start, zone));
  const [uhrzeit, setUhrzeit] = useState(() => zuWanduhr(start, zone).format('HHmm'));
  const [grund, setGrund] = useState<string | null>(null);
  const uhrRef = useRef<InputRef>(null);
  const grundId = useId();

  useEffect(() => {
    if (fokusUhrzeit) uhrRef.current?.focus({ preventScroll: true, cursor: 'all' });
  }, [fokusUhrzeit]);

  function uebernehmen(amTag = tag) {
    if (nurTag) {
      onUebernehmen(uhrzeitAmTag(amTag, '00:00', zone));
      return;
    }
    const hhmm = parseUhrzeit(uhrzeit);
    if (!hhmm) {
      setGrund(GRUND.uhrzeit);
      uhrRef.current?.focus();
      return;
    }
    onUebernehmen(uhrzeitAmTag(amTag, hhmm, zone));
  }

  function tasten(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.stopPropagation();
      onAbbrechen();
    }
  }

  const monat = dayjs(tag);
  const blaettern = (n: number) => setTag(monat.add(n, 'month').format(TAG));

  return (
    <div
      role="dialog"
      aria-label={nurTag ? 'Tag wählen' : 'Tag und Uhrzeit wählen'}
      onKeyDown={tasten}
      style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0, width: breite }}
    >
      <Calendar
        fullscreen={false}
        value={monat}
        disabledDate={keineZukunftstage ? (d: Dayjs) => d.format(TAG) > heute : undefined}
        onSelect={(d, info) => {
          const neu = d.format(TAG);
          setTag(neu);
          if (nurTag && info.source === 'date') uebernehmen(neu);
        }}
        headerRender={() => (
          <Flex align="center" justify="space-between" gap="small">
            <Button
              type="text"
              aria-label="Vormonat"
              icon={<IconChevronRechts style={{ transform: 'rotate(180deg)' }} />}
              onClick={() => blaettern(-1)}
            />
            <span style={{ fontWeight: 500 }}>{monat.locale('de').format('MMMM YYYY')}</span>
            <Button
              type="text"
              aria-label="Folgemonat"
              icon={<IconChevronRechts />}
              onClick={() => blaettern(1)}
            />
          </Flex>
        )}
      />
      {!nurTag && (
        <Flex gap="small" align="center" wrap>
          <Input
            ref={uhrRef}
            aria-label="Uhrzeit"
            inputMode="numeric"
            autoComplete="off"
            value={uhrzeit}
            status={grund ? 'error' : undefined}
            aria-invalid={grund ? true : undefined}
            aria-describedby={grund ? grundId : undefined}
            style={{ ...monoStil(16), width: '8ch', flex: '0 0 auto', boxSizing: 'content-box' }}
            onChange={(e) => {
              setUhrzeit(e.target.value);
              setGrund(null);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                uebernehmen();
              }
            }}
          />
          {grund && (
            <span id={grundId} style={{ color: rollen.alarmText }}>
              {grund}
            </span>
          )}
        </Flex>
      )}
      {zonenHinweis && (
        <span style={{ color: rollen.gedaempft }}>
          Zeiten in <span style={monoStil(12)}>{zonenHinweis}</span>
        </span>
      )}
      {/* Die Fußzeile klebt im Blatt unten, wenn der Inhalt rollt (`ZeitpunktEingabe.css`). */}
      <Flex className={ZEIT_FUSS} gap="small" align="center" justify="space-between" wrap>
        <ZeitSchnellwahl art={art} onWahl={onUebernehmen} />
        <Button type="primary" onClick={() => uebernehmen()}>
          Übernehmen
        </Button>
      </Flex>
    </div>
  );
}
