import {
  IconChevronRunter,
  IconKamera,
  IconPause,
  IconPlayKreis,
  IconUhrRueckwaerts,
} from '../../icons';
import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';
import { App, Button, Input, Slider, Space, theme, Tooltip } from 'antd';
import { useQueryClient } from '@tanstack/react-query';
import { einsatzKeys } from '../../api/queryKeys';
import { ladeLageSnapshot } from '../../api/lageSnapshot';
import { formatZeitKurz } from '../../anzeige/format';
import { useLageSnapshots } from './useLageSnapshots';
import { bandStil } from './KartenFuss';
import { useViewport } from '../../components/useViewport';

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

/**
 * Die Abstände des Bands bleiben fest und wachsen NICHT mit der Dichte-Staffel (LFH-703,
 * Entscheidung 01.10.2026). Das Band steht schon so im Handschuh-Betrieb am Handschirm bei 49 % der
 * Karte (Deckel 50 %, `e2e/leisten-flaeche.spec.ts`); mit Lücke und Polsterung aus der Staffel
 * wuchs es auf 314–362 px und riss den Deckel bei 390 und 1024 px. Der Umbau, nach dem das Band
 * mitwachsen darf, ist LFH-899. Benannt, damit der Guard
 * `leistenAbstand.guard.test.ts` jede neue Zahl im Band weiter findet.
 */
const BAND_LUECKE = 12;
const BAND_POLSTER = '8px 12px';
const STAND_LUECKE = 6;
const ZEITLEISTE_LUECKE = 8;
const SCHIEBER_RAND = '0 8px';

/**
 * Die Reihe der gesicherten Stände teilt sich die Zeile mit Sichern und Zeitleiste. Ohne
 * `flex`-Basis und `minWidth: 0` nahm sie ihre volle Inhaltsbreite an, brach in eine zweite Zeile
 * um und verdoppelte die Höhe der Leiste. Jetzt schrumpft sie auf den Rest und rollt waagerecht;
 * erst unter 120 px Rest bricht sie um. Rein und exportiert.
 *
 * 120 statt 160: unter Linux-Schriften sind Feld und „Stand sichern" breiter als unter macOS, bei
 * 1440 px rutschte der Einklapp-Pfeil sonst in eine dritte Reihe.
 */
export const standLeisteStil: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: STAND_LUECKE,
  flex: '1 1 120px',
  minWidth: 0,
  overflowX: 'auto',
};

/**
 * Das Bezeichnungsfeld neben „Stand sichern": bevorzugt 180 px, schrumpfbar. Fest 180 px ragte das
 * nicht umbrechbare `Space.Compact` bei 390 px im Handschuh-Betrieb über den Bandrand und fing
 * Klicks auf die Kartenknöpfe ab.
 */
export const sichernFeldStil: CSSProperties = { flex: '0 1 180px', minWidth: 0 };

/**
 * Der Zeitleisten-Block (Aktuell · Abspielen · Schieber · Stand) darf umbrechen: seine
 * Mindestbreite lag sonst über der Bandbreite.
 */
export const zeitleisteStil: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  flexWrap: 'wrap',
  gap: ZEITLEISTE_LUECKE,
  flex: '1 1 260px',
  minWidth: 0,
};

/** Der Abspielknopf schrumpft nicht: als Flex-Kind fiel er auf 16 px Breite. */
export const abspielenStil: CSSProperties = { flexShrink: 0 };

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
 * Snapshot-/Zeitachsen-Band unter der Karte: „Stand sichern" (Live), die Auswahl gespeicherter
 * Stände und der Replay (Schieber + Play/Pause mit fester Anzeigedauer, Vorladen des nächsten
 * Dokuments gegen Flackern). Die Auswahl schaltet die Karte über `?snapshot=` in den
 * schreibgeschützten Historien-Modus.
 *
 * Ein-/ausklappbar: das Band liegt über der Karte und ist ein Werkzeug auf Abruf; eingeklappt
 * bleibt ein kleiner Knopf unten links. Der Zustand ist je Benutzer gemerkt, nicht Teil der
 * geteilten Ansicht.
 *
 * Keine punktuellen Klein-Angaben: größere Knöpfe verdecken zwar Kartenfläche, aber die Leiste
 * klappt dafür ein — wer die Zeitachse bedient, braucht sie treffbar. Der Rahmen trägt `flexWrap:
 * 'wrap'`, auf höheren Dichtestufen wird die Leiste höher statt breiter.
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
  const [bezeichnung, setBezeichnung] = useState('');
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

  const aufSichern = async () => {
    try {
      await sichern(bezeichnung);
      setBezeichnung('');
      message.success('Stand gesichert');
    } catch (e) {
      fehler(e);
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

  const zurueckAktuell = () => {
    setSpielt(false);
    onWaehle(null);
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
        display: 'flex',
        alignItems: 'center',
        gap: BAND_LUECKE,
        flexWrap: 'wrap',
        padding: BAND_POLSTER,
        borderRadius: token.borderRadiusLG,
        background: token.colorBgElevated,
        boxShadow: token.boxShadow,
      }}
    >
      {darfSichern && (
        <Space.Compact style={{ minWidth: 0 }}>
          <Input
            placeholder="Bezeichnung (optional)"
            value={bezeichnung}
            onChange={(e) => setBezeichnung(e.target.value)}
            onPressEnter={aufSichern}
            style={sichernFeldStil}
            aria-label="Snapshot-Bezeichnung"
          />
          <Button
            type="primary"
            // Hülle `aria-hidden`: das Symbol brächte sonst „camera" in den zugänglichen Namen.
            icon={
              <span aria-hidden="true" style={{ display: 'inline-flex' }}>
                <IconKamera />
              </span>
            }
            loading={sichertGerade}
            onClick={aufSichern}
          >
            Stand sichern
          </Button>
        </Space.Compact>
      )}

      {chrono.length > 0 && (
        <div style={zeitleisteStil}>
          <Button type={aktiverSnapshotId == null ? 'primary' : 'default'} onClick={zurueckAktuell}>
            Aktuell
          </Button>
          <Tooltip title={spielt ? 'Pause' : 'Replay abspielen'}>
            <Button
              icon={spielt ? <IconPause /> : <IconPlayKreis />}
              onClick={aufPlayPause}
              disabled={chrono.length < 2}
              aria-label={spielt ? 'Pause' : 'Abspielen'}
              style={abspielenStil}
            />
          </Tooltip>
          <Slider
            style={{ flex: 1, margin: SCHIEBER_RAND, minWidth: 120 }}
            min={0}
            max={Math.max(0, chrono.length - 1)}
            value={aktiverIndex >= 0 ? aktiverIndex : 0}
            marks={marks}
            tooltip={{
              formatter: (i) =>
                i != null && chrono[i] ? chipLabel(chrono[i].bezeichnung, chrono[i].stand_at) : '',
            }}
            onChange={(i) => {
              setSpielt(false);
              onWaehle(chrono[i].id);
            }}
            disabled={chrono.length < 2}
            aria-label="Zeitleiste"
          />
          <span style={{ minWidth: 96, fontSize: 12, color: token.colorTextSecondary }}>
            {aktiverIndex >= 0
              ? chipLabel(chrono[aktiverIndex].bezeichnung, chrono[aktiverIndex].stand_at)
              : 'Live'}
          </span>
        </div>
      )}

      {chrono.length > 0 && (
        <div data-lfh="zeitachse-staende" style={standLeisteStil}>
          {chrono.map((s) => (
            <Tooltip key={s.id} title={s.notiz ?? undefined}>
              <Button
                type={s.id === aktiverSnapshotId ? 'primary' : 'default'}
                onClick={() => {
                  setSpielt(false);
                  onWaehle(s.id);
                }}
              >
                {chipLabel(s.bezeichnung, s.stand_at)}
              </Button>
            </Tooltip>
          ))}
        </div>
      )}

      {/* Ganz rechts; `marginLeft: auto` trägt auch ohne den Zeitleisten-Block (Schreibrecht,
          aber noch keine Stände). */}
      <Tooltip title="Zeitachse ausblenden">
        <Button
          type="text"
          icon={<IconChevronRunter />}
          aria-label="Zeitachse ausblenden"
          onClick={() => klappeUm(true)}
          style={{ marginLeft: 'auto' }}
        />
      </Tooltip>
    </div>
  );
}
