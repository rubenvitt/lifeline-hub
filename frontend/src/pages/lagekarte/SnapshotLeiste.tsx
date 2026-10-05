import {
  IconChevronRunter,
  IconKamera,
  IconPause,
  IconPlayKreis,
  IconUhrRueckwaerts,
} from '../../icons';
import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';
import { App, Button, Form, Input, Slider, theme, Tooltip } from 'antd';
import type { GlobalToken } from 'antd';
import { useQueryClient } from '@tanstack/react-query';
import { einsatzKeys } from '../../api/queryKeys';
import { ladeLageSnapshot } from '../../api/lageSnapshot';
import { formatZeitKurz } from '../../anzeige/format';
import { useLageSnapshots } from './useLageSnapshots';
import { bandStil } from './KartenFuss';
import { useViewport } from '../../components/useViewport';
import { Select } from '../../components/Select';
import { ErfassungsModal } from '../../components/Erfassung';

/** Feste Anzeigedauer je Stand im Replay. */
export const ANZEIGE_MS = 2500;

// Ein-/Ausklappen ist eine Anzeigevorliebe je Benutzer, keine Ansichts-Konfiguration: deshalb
// localStorage und nicht der Konfig-Bag von `useKartenAnsicht` — dort würde sie geteilt, und jede
// Klapp-Aktion machte die Ansicht schmutzig.
const SPEICHER_SCHLUESSEL = 'lfh:lagekarte:zeitachse-eingeklappt';

/** Gemerkte Wahl: `true`/`false`, oder `null`, wenn nie gewählt wurde. */
function gespeichertEingeklappt(): boolean | null {
  try {
    const wert = localStorage.getItem(SPEICHER_SCHLUESSEL);
    return wert === '1' ? true : wert === '0' ? false : null;
  } catch {
    return null;
  }
}

/**
 * Startzustand der Leiste. Eine gemerkte Wahl gewinnt immer (sonst drehte sich die Leiste beim
 * Neuladen zurück). Ohne Wahl startet sie eingeklappt, wo die Karte eng ist — unter `xl`:
 * ausgeklappt belegte sie bei 375 px ein Drittel der Kartenhöhe, bei 1024 px drei Zeilen. Rein und
 * exportiert.
 */
export function startEingeklappt(gemerkt: boolean | null, kartenEng: boolean): boolean {
  return gemerkt ?? kartenEng;
}

function merkeEingeklappt(wert: boolean): void {
  try {
    localStorage.setItem(SPEICHER_SCHLUESSEL, wert ? '1' : '0');
  } catch {
    /* localStorage nicht verfügbar → nicht persistierbar, kein harter Fehler */
  }
}

/** Die Werte der Dichte-Staffel, die das Band trägt (aufgelöste antd-Tokens). */
export type BandToken = Pick<GlobalToken, 'controlHeight' | 'margin' | 'marginSM' | 'paddingSM'>;

/** Mindestbreite des Schiebers und der Auswahl, bevor ihre Gruppe allein in eine Zeile geht. */
const SCHIEBER_BASIS = 120;
const AUSWAHL_BASIS = 160;

/**
 * Stile des Bands aus der Dichte-Staffel (LFH-899, D3/D4 in
 * `openspec/changes/archive/2026-10-04-lfh-899-zeitachse-band-flacher/design.md`). Zwei Gruppen,
 * die in sich nicht umbrechen: Wiedergabe (Ausblenden, Abspielen, Schieber) und Stand (Auswahl,
 * Sichern). Das Band bricht nur zwischen ihnen um und hat damit höchstens zwei Reihen; drei Reihen à 72 px rissen im Handschuh-Betrieb den Deckel der halben
 * Karte (`e2e/leisten-flaeche.spec.ts`).
 *
 * Die Basis einer Gruppe ist ihr Platzbedarf in einer Zeile: passen beide nebeneinander (Fükw),
 * steht das Band einzeilig, sonst geht die Stand-Gruppe in die zweite Zeile. Rein und exportiert.
 */
export function bandStile(token: BandToken) {
  const wiedergabeBasis = 2 * token.controlHeight + 2 * token.marginSM + SCHIEBER_BASIS;
  const standBasis = AUSWAHL_BASIS + token.marginSM + token.controlHeight;
  const gruppe = {
    display: 'flex',
    alignItems: 'center',
    flexWrap: 'nowrap',
    gap: token.marginSM,
    minWidth: 0,
  } satisfies CSSProperties;
  return {
    wiedergabeBasis,
    standBasis,
    band: {
      display: 'flex',
      alignItems: 'center',
      flexWrap: 'wrap',
      gap: token.margin,
      padding: token.paddingSM,
    } satisfies CSSProperties,
    wiedergabe: { ...gruppe, flex: `1 1 ${wiedergabeBasis}px` } satisfies CSSProperties,
    stand: { ...gruppe, flex: `1 1 ${standBasis}px` } satisfies CSSProperties,
    /** Ausblenden, Abspielen, Sichern: als Flex-Kind fiel ein Symbolknopf sonst auf 16 px. */
    knopf: { flexShrink: 0 } satisfies CSSProperties,
    /**
     * Der Griff steht am Schienenende zur Hälfte über der Schiene (gemessen 11 px in `handschuh`).
     * Mit `marginXS` (7 px) lag er nur 12 px neben „Abspielen“; `marginSM` hält die 16 px.
     */
    schieber: {
      flex: '1 1 0',
      minWidth: 0,
      marginBlock: 0,
      marginInline: token.marginSM,
    } satisfies CSSProperties,
    auswahl: { flex: '1 1 0', minWidth: 0 } satisfies CSSProperties,
  };
}

/** Wert der Auswahl „Stand“ im Live-Modus. */
const LIVE = 'live';

interface SnapshotLeisteProps {
  einsatzId: number;
  /** „Stand sichern" nur im Live-Modus mit Schreibrecht. */
  darfSichern: boolean;
  /** Aktuell angezeigter Snapshot (`undefined` = Live-Modus). */
  aktiverSnapshotId?: number;
  /** Auswahl eines Standes (`null` = zurück in den Live-Modus). */
  onWaehle: (id: number | null) => void;
  /** Stabiler Fehler-Handler. */
  fehler: (e: unknown) => void;
}

function chipLabel(bezeichnung: string | null | undefined, standAt: string): string {
  // `formatZeitKurz` (dayjs.utc) statt `new Date()`: `stand_at` ist ein naiver UTC-Wire-String.
  return bezeichnung?.trim() || formatZeitKurz(standAt);
}

/**
 * Snapshot-/Zeitachsen-Band unter der Karte: „Stand sichern" (Dialog), die Auswahl „Stand" (Live
 * oder ein gesicherter Stand) und der Replay (Schieber + Play/Pause mit fester Anzeigedauer,
 * Vorladen des nächsten Dokuments gegen Flackern). Die Auswahl schaltet die Karte über
 * `?snapshot=` in den schreibgeschützten Historien-Modus; den Rückweg trägt auch das
 * Historien-Banner („Aktuell").
 *
 * Ein-/ausklappbar: das Band liegt über der Karte und ist ein Werkzeug auf Abruf; eingeklappt
 * bleibt ein kleiner Knopf unten links. Der Zustand ist je Benutzer gemerkt, nicht Teil der
 * geteilten Ansicht.
 *
 * Keine punktuellen Klein-Angaben: größere Knöpfe verdecken zwar Kartenfläche, aber die Leiste
 * klappt dafür ein — wer die Zeitachse bedient, braucht sie treffbar. Aufbau und Abstände:
 * {@link bandStile}.
 */
export function SnapshotLeiste({
  einsatzId,
  darfSichern,
  aktiverSnapshotId,
  onWaehle,
  fehler,
}: SnapshotLeisteProps) {
  const { message } = App.useApp();
  const { token } = theme.useToken();
  const qc = useQueryClient();
  const { snapshots, sichern, sichertGerade } = useLageSnapshots(einsatzId);
  const [sichernOffen, setSichernOffen] = useState(false);
  const [sichernForm] = Form.useForm<{ bezeichnung?: string }>();
  const [spielt, setSpielt] = useState(false);
  const { abBreite } = useViewport();
  // Abgeleitet statt einmalig gesetzt: die Breitenstufe steht im ersten Render noch nicht fest
  // (antds Breakpoint-Beobachter meldet sich erst nach dem Einhängen).
  const [wahl, setWahl] = useState<boolean | null>(gespeichertEingeklappt);
  const eingeklappt = startEingeklappt(wahl, !abBreite('xl'));

  // Chronologisch (alt → neu) für die Zeitleiste; das Backend liefert neueste zuerst.
  const chrono = useMemo(
    () => [...snapshots].sort((a, b) => a.stand_at.localeCompare(b.stand_at)),
    [snapshots],
  );
  const aktiverIndex =
    aktiverSnapshotId != null ? chrono.findIndex((s) => s.id === aktiverSnapshotId) : -1;

  const prefetch = useCallback(
    (id: number) => {
      void qc.prefetchQuery({
        queryKey: einsatzKeys.lageSnapshotDokument(einsatzId, id),
        queryFn: () => ladeLageSnapshot(einsatzId, id),
      });
    },
    [qc, einsatzId],
  );

  // Replay: nach fester Anzeigedauer einen Schritt weiter. Jeder Schritt ändert ?snapshot=, dieser
  // Effekt läuft dann neu. Am Ende stoppen.
  useEffect(() => {
    if (!spielt) return;
    const next = aktiverIndex + 1;
    if (next >= chrono.length) {
      setSpielt(false);
      return;
    }
    prefetch(chrono[next].id); // Vorladen → kein Flackern beim Schritt
    const t = setTimeout(() => onWaehle(chrono[next].id), ANZEIGE_MS);
    return () => clearTimeout(t);
  }, [spielt, aktiverIndex, chrono, onWaehle, prefetch]);

  // Bei Ablehnung bricht die Zusage, damit `ErfassungsModal` Dialog und Wortlaut stehen lässt.
  const aufSichern = async ({ bezeichnung }: { bezeichnung?: string }) => {
    try {
      await sichern(bezeichnung);
    } catch (e) {
      fehler(e);
      throw e;
    }
  };

  const aufPlayPause = () => {
    if (spielt) {
      setSpielt(false);
      return;
    }
    if (chrono.length === 0) return;
    // Aus dem Live-Modus oder vom letzten Stand am Anfang der Zeitleiste starten.
    if (aktiverIndex < 0 || aktiverIndex >= chrono.length - 1) onWaehle(chrono[0].id);
    setSpielt(true);
  };

  // Eine Wahl hält die Wiedergabe an, wie früher ein Stand-Knopf und „Aktuell“.
  const waehle = (wert: number | typeof LIVE) => {
    setSpielt(false);
    onWaehle(wert === LIVE ? null : wert);
  };

  const klappeUm = (zu: boolean) => {
    setWahl(zu);
    merkeEingeklappt(zu);
    // Einklappen stoppt eine laufende Wiedergabe: ein Replay mit unsichtbarer Pause-Taste wäre eine
    // Falle. Der Historien-Modus bleibt — der Rückweg steht im HistorienBanner.
    if (zu) setSpielt(false);
  };

  // Nichts anzeigen, wenn es weder etwas zu sichern noch etwas zu betrachten gibt.
  if (!darfSichern && snapshots.length === 0) return null;

  if (eingeklappt) {
    return (
      <Tooltip title="Zeitachse einblenden">
        <Button
          icon={<IconUhrRueckwaerts />}
          aria-label="Zeitachse einblenden"
          onClick={() => klappeUm(false)}
          style={{
            // Eingeklappt bleibt der Knopf unten links, als linksbündiges Band im `KartenFuss`.
            ...bandStil('links'),
            background: token.colorBgElevated,
            boxShadow: token.boxShadow,
          }}
        />
      </Tooltip>
    );
  }

  const marks = Object.fromEntries(chrono.map((_, i) => [i, '']));
  const stile = bandStile(token);
  // „Live“ ist der jüngste Stand und steht oben, darunter die Stände neueste zuerst.
  const optionen = [
    { value: LIVE, label: 'Live', title: 'Live' },
    ...[...chrono].reverse().map((s) => {
      const label = chipLabel(s.bezeichnung, s.stand_at);
      return { value: s.id, label, title: s.notiz ? `${label} · ${s.notiz}` : label };
    }),
  ];

  return (
    <div
      // Stabiler Griff für `e2e/lagekarte-smoke.spec.ts` — die Klassen dieser Leiste sind
      // antd-Interna.
      data-lfh="zeitachse"
      style={{
        // Volle Kartenbreite im Fuß-Rahmen: als Flow-Band stapelt es sich mit der
        // ZeichnenSteuerung, statt sie zu verdecken. Nachgiebig: passt der Fuß nicht in die Karte,
        // wird dieses Band niedriger und rollt in sich.
        ...bandStil('voll', true),
        ...stile.band,
        borderRadius: token.borderRadiusLG,
        background: token.colorBgElevated,
        boxShadow: token.boxShadow,
      }}
    >
      <div data-lfh="zeitachse-wiedergabe" style={stile.wiedergabe}>
        {/* Links: eingeklappt steht „Zeitachse einblenden“ ebenfalls unten links. */}
        <Tooltip title="Zeitachse ausblenden">
          <Button
            type="text"
            icon={<IconChevronRunter />}
            aria-label="Zeitachse ausblenden"
            onClick={() => klappeUm(true)}
            style={stile.knopf}
          />
        </Tooltip>
        {chrono.length > 0 && (
          <>
            <Tooltip title={spielt ? 'Pause' : 'Replay abspielen'}>
              <Button
                icon={spielt ? <IconPause /> : <IconPlayKreis />}
                onClick={aufPlayPause}
                disabled={chrono.length < 2}
                aria-label={spielt ? 'Pause' : 'Abspielen'}
                style={stile.knopf}
              />
            </Tooltip>
            <Slider
              style={stile.schieber}
              min={0}
              max={Math.max(0, chrono.length - 1)}
              value={aktiverIndex >= 0 ? aktiverIndex : 0}
              marks={marks}
              tooltip={{
                formatter: (i) =>
                  i != null && chrono[i]
                    ? chipLabel(chrono[i].bezeichnung, chrono[i].stand_at)
                    : '',
              }}
              onChange={(i) => {
                setSpielt(false);
                onWaehle(chrono[i].id);
              }}
              disabled={chrono.length < 2}
              aria-label="Zeitleiste"
            />
          </>
        )}
      </div>

      {(chrono.length > 0 || darfSichern) && (
        <div data-lfh="zeitachse-stand" style={stile.stand}>
          {chrono.length > 0 && (
            <Select<number | typeof LIVE>
              aria-label="Stand"
              // Ein Stand außerhalb der Liste (gelöscht, alter Link) zeigte sonst seine nackte Id;
              // wie die frühere Beschriftung steht dann „Live“.
              value={aktiverIndex >= 0 ? chrono[aktiverIndex].id : LIVE}
              options={optionen}
              onChange={waehle}
              // Ohne Suche: am Handschirm öffnete das Tippen sonst die Bildschirmtastatur über der
              // Karte, und eine Handvoll Stände braucht keinen Filter.
              showSearch={false}
              style={stile.auswahl}
            />
          )}
          {darfSichern && (
            <Tooltip title="Stand sichern">
              <Button
                type="primary"
                // Hülle `aria-hidden`: das Symbol brächte sonst „camera" in den zugänglichen Namen.
                icon={
                  <span aria-hidden="true" style={{ display: 'inline-flex' }}>
                    <IconKamera />
                  </span>
                }
                aria-label="Stand sichern"
                loading={sichertGerade}
                onClick={() => setSichernOffen(true)}
                style={stile.knopf}
              />
            </Tooltip>
          )}
        </div>
      )}

      {/* Das Feld steht nicht dauerhaft im Band (LFH-899, D2): es nahm am Handschirm eine eigene
          Reihe ein. Kurze blockierende Aktion mit einem Feld → Erfassungs-Dialog. */}
      <ErfassungsModal<{ bezeichnung?: string }>
        offen={sichernOffen}
        titel="Stand sichern"
        form={sichernForm}
        erfassenText="Sichern"
        laeuft={sichertGerade}
        onErfassen={aufSichern}
        onErfasst={() => {
          message.success('Stand gesichert');
        }}
        onFertig={() => setSichernOffen(false)}
        onAbbrechen={() => setSichernOffen(false)}
      >
        <Form.Item label="Bezeichnung (optional)" name="bezeichnung">
          <Input placeholder="z. B. Lage 08:00" aria-label="Snapshot-Bezeichnung" />
        </Form.Item>
      </ErfassungsModal>
    </div>
  );
}
