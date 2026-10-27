import type { CSSProperties, ReactNode } from 'react';
import { Link } from 'react-router';
import dayjs from 'dayjs';
import type { Abloesung, Auftrag, Erinnerung, Meldung, Nachforderung } from '../../api/types';
import { formatVor } from '../../anzeige/abstand';
import { leereUhrzeit, zeitKurz } from '../../anzeige/zeitDarstellung';
import { useAnzeigeKonventionen } from '../../anzeige/AnzeigeKonventionenContext';
import { einstufungOf } from '../../abloesung/einstufung';
import { berechneAbloesungZaehler } from '../../einsatz/useModulZaehler';
import {
  DashboardPaneel,
  ListenAbschnitt,
  Segmentleiste,
  listenZeileStil,
  monoStil,
  useRollen,
  type DashboardZustand,
  type ListenAbschnittZustand,
} from '../../components/instrument';
import { MELDUNG_STATUS } from '../../kommunikation';
import { istAlarmiert } from '../../meldungen/meldungKennzahlen';
import { istUeberfaellig, stufeWort } from '../../nachforderungen/nachforderungStufen';
import { adressatText, nachforderungName } from '../../nachforderungen/nachforderungName';
import {
  abloesungPfad,
  auftraegePfad,
  erinnerungenPfad,
  meldungenPfad,
  nachforderungenPfad,
} from '../../routing/deeplinks';
import {
  auftragsStand,
  erinnerungsStand,
  lagemeldungsStand,
  meldungsStand,
  nachforderungsStand,
  type ZaehlerAbfrage,
  type Zaehlstand,
} from '../lage-dashboard/fuehrungsZahlen';
import { empfaengerText } from './ueberblickDaten';
import {
  VORGAENGE_JE_ABSCHNITT,
  auftragFuerMich,
  erinnerungFuerMich,
  listenStand,
  meldungFuerMich,
  nachSicht,
  nachforderungFuerMich,
  vorgangsAbloesungen,
  vorgangsAuftraege,
  vorgangsErinnerungen,
  vorgangsMeldungen,
  vorgangsNachforderungen,
  type ListenAbfrage,
  type MeineStelle,
  type VorgangsSicht,
} from './offeneVorgaenge';

/** Eine Listenquelle eines Abschnitts: Freigabe des Moduls und die Abfrage. */
export interface VorgangsQuelle<T> {
  frei: boolean;
  q: ListenAbfrage & { data: T[] | undefined; refetch: () => unknown };
}

const SICHTEN = [
  { wert: 'alle' as const, label: 'alle' },
  { wert: 'meine' as const, label: 'meine Stelle' },
];

/** Grund eines gesperrten Abschnitts (LFH-888-Muster, „—“ als Zahl). */
const NICHT_FREIGEGEBEN = 'nicht freigegeben';

/**
 * Paneel „Offene Vorgänge“ im Führungsüberblick (LLH-1145, Spec `ueberblick-offene-vorgaenge`,
 * Herleitung `/mnt/project-files/llh-1022/llh-1145/design.md`): fünf Abschnitte in fester Folge —
 * Meldungen, Aufträge, Nachforderungen, Erinnerungen, Ablösungen —, je mit der Zahl aus dem
 * Modulzähler (Ablösung: derselbe Browser-Zähler wie die Rail), den drei dringendsten Einträgen
 * und „alle ↗“ ins Modul. Welche Einträge und in welcher Folge, steht in `offeneVorgaenge.ts`.
 *
 * - Ein Eintrag springt per Deeplink auf sein Objekt, das das Ziel hervorhebt (Spec
 *   `deeplink-hervorhebung`), eine Erinnerung per `?erinnerung=` (LLH-1429).
 * - Ein Eintrag mit Alarm (Bestätigung überfällig, Auftrag oder Ablösung überfällig) trägt die
 *   Alarmkante links UND das Wort; eine überfällige Nachforderung tönt nur `achtung` (Board-Regel,
 *   LLH-1097 D7: kein Alarm).
 * - „meine Stelle“ (Segmentleiste im Kopf, Vorgabe „alle“) filtert nur die Einträge; die Zahl
 *   bleibt die des Einsatzes und heißt dann „im Einsatz“. Ablösungen haben keinen Stellenbezug.
 * - Gesperrtes Modul: der Abschnitt bleibt stehen, Zahl „—“, Grund „nicht freigegeben“.
 */
export default function OffeneVorgaengePaneel({
  einsatzId,
  jetzt,
  zustand,
  zaehler,
  meldungen,
  auftraege,
  nachforderungen,
  erinnerungen,
  abloesungen,
  stelle,
  sicht,
  onSicht,
  onNeuladen,
}: {
  einsatzId: number;
  /** Uhr der Seite (ms). */
  jetzt: number;
  /** Zustand des Paneels selbst: die Freigaben (laden, fehler) — die Abschnitte tragen ihre. */
  zustand: Exclude<DashboardZustand, 'leer' | 'gesperrt'>;
  zaehler: ZaehlerAbfrage & { refetch: () => unknown };
  meldungen: VorgangsQuelle<Meldung>;
  auftraege: VorgangsQuelle<Auftrag>;
  nachforderungen: VorgangsQuelle<Nachforderung>;
  erinnerungen: VorgangsQuelle<Erinnerung>;
  abloesungen: VorgangsQuelle<Abloesung>;
  stelle: MeineStelle;
  sicht: VorgangsSicht;
  onSicht: (sicht: VorgangsSicht) => void;
  onNeuladen: () => void;
}) {
  const { token, rollen } = useRollen();
  const { konventionen } = useAnzeigeKonventionen();
  const zeile = listenZeileStil(rollen, token);
  const kurz = (s: string | null | undefined) =>
    zeitKurz(s, konventionen) || leereUhrzeit(konventionen);
  const meine = sicht === 'meine';
  const zahlWort = meine ? 'im Einsatz' : undefined;
  const leerText = meine ? 'keine für meine Stelle' : 'keine';

  /** Zustand eines Abschnitts: gesperrt, wenn Modul oder Zähler es sagen, sonst die Liste. */
  const stand = (quelle: VorgangsQuelle<unknown>, zahl?: Zaehlstand<unknown>) =>
    zahl?.zustand === 'gesperrt' ? 'gesperrt' : listenStand(quelle.frei, quelle.q);
  const zahlVon = <T,>(s: Zaehlstand<T>, wert: (z: T) => number) =>
    s.zustand === 'daten' ? wert(s.zahl) : null;
  const neuladen = (quelle: VorgangsQuelle<unknown>) => () => {
    void quelle.q.refetch();
    void zaehler.refetch();
  };
  const daten = <T,>(quelle: VorgangsQuelle<T>) => (quelle.frei ? (quelle.q.data ?? []) : []);

  // ── Zahlen: eine Heimat je Zahl (LFH-550) ──
  const zMeldungen = meldungsStand(zaehler);
  const zLage = lagemeldungsStand(zaehler);
  const zAuftraege = auftragsStand(zaehler);
  const zNachforderungen = nachforderungsStand(zaehler);
  const zErinnerungen = erinnerungsStand(zaehler);
  const abloesungDaten = abloesungen.frei ? abloesungen.q.data : undefined;
  const abloesungZahl =
    abloesungDaten != null ? berechneAbloesungZaehler(abloesungDaten, dayjs(jetzt)).wert : null;

  // ── Listen ──
  const mListe = nachSicht(vorgangsMeldungen(daten(meldungen)), sicht, (m) =>
    meldungFuerMich(m, stelle),
  );
  const aListe = nachSicht(vorgangsAuftraege(daten(auftraege)), sicht, (a) =>
    auftragFuerMich(a, stelle),
  );
  const nListe = nachSicht(vorgangsNachforderungen(daten(nachforderungen), jetzt), sicht, (n) =>
    nachforderungFuerMich(n, stelle),
  );
  const eListe = nachSicht(vorgangsErinnerungen(daten(erinnerungen), jetzt), sicht, (e) =>
    erinnerungFuerMich(e, stelle),
  );
  const abListe = vorgangsAbloesungen(abloesungDaten ?? [], jetzt);

  // ── Platzhalter beim Laden (LLH-1430): so viele Zeilen, wie der Zähler Einträge erwarten lässt.
  // Nur in „alle“: für „meine Stelle“ zählt der Zähler nicht. Erinnerungen: der Zähler kennt nur
  // die fälligen, die Liste nimmt die bald fälligen dazu — eine Untergrenze. Ablösungen haben keinen
  // Serverzähler (die Rail lädt dieselbe Liste, sie liegt meist schon vor).
  const erwartet = <T,>(s: Zaehlstand<T>, wert: (z: T) => number) =>
    meine ? null : zahlVon(s, wert);

  const ton = (t: 'alarm' | 'achtung' | null) =>
    t === 'alarm' ? rollen.alarmText : t === 'achtung' ? rollen.achtungText : rollen.gedaempft;
  /** Alarmkante links, das Wort steht immer daneben (nie nur Farbe). */
  const mitKante = (alarm: boolean): CSSProperties =>
    alarm ? { ...zeile, boxShadow: `inset 3px 0 0 ${rollen.alarm}` } : zeile;

  const zeit = (text: string) => (
    <span style={{ ...monoStil(11), color: rollen.gedaempft, flex: '0 0 auto', minWidth: 48 }}>
      {text}
    </span>
  );
  const text = (haupt: ReactNode, unter: ReactNode) => (
    <span
      style={{ flex: '1 1 auto', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}
    >
      <span
        style={{ fontSize: 12, lineHeight: 1.45, color: rollen.text2, overflowWrap: 'anywhere' }}
      >
        {haupt}
      </span>
      {unter && <span style={{ ...monoStil(10), color: rollen.schwach }}>{unter}</span>}
    </span>
  );
  const wort = (w: string, t: 'alarm' | 'achtung' | null) => (
    <span
      data-lfh="vorgang-wort"
      style={{ ...monoStil(10), letterSpacing: '0.06em', color: ton(t), flex: '0 0 auto' }}
    >
      {w}
    </span>
  );

  const notiz = (teile: { text: string; ton?: 'alarm' | 'achtung' }[]) => (
    <>
      {teile.map((t, i) => (
        <span key={t.text} style={t.ton ? { color: ton(t.ton) } : undefined}>
          {i > 0 ? ' · ' : ''}
          {t.text}
        </span>
      ))}
    </>
  );

  const abschnitt = <T,>(p: {
    titel: string;
    kennung: string;
    zahl: number | null;
    zustand: ListenAbschnittZustand;
    /** Erwartete Einträge beim Laden, aus dem Zähler; `null`: unbekannt. */
    ladeZeilen: number | null;
    notiz?: ReactNode;
    zahlWort?: string;
    leer?: string;
    eintraege: readonly T[];
    schluessel: (e: T) => number;
    zeile: (e: T) => ReactNode;
    sprung: { ziel: string; name: string };
    onNeuladen: () => void;
  }) => (
    <ListenAbschnitt
      titel={p.titel}
      kennung={p.kennung}
      zahl={p.zahl}
      zahlWort={p.zahlWort ?? zahlWort}
      notiz={p.notiz}
      zustand={p.zustand}
      eintraege={p.eintraege}
      max={VORGAENGE_JE_ABSCHNITT}
      ladeZeilen={p.ladeZeilen}
      schluessel={p.schluessel}
      zeile={p.zeile}
      sprung={p.sprung}
      leerText={p.leer ?? leerText}
      gesperrtText={NICHT_FREIGEGEBEN}
      onNeuladen={p.onNeuladen}
    />
  );

  return (
    <DashboardPaneel
      titel="Offene Vorgänge"
      zustand={zustand}
      meta={
        <Segmentleiste
          beschriftung="Offene Vorgänge zeigen für"
          optionen={SICHTEN}
          wert={sicht}
          onWechsel={onSicht}
        />
      }
      leerText=""
      gesperrtText={NICHT_FREIGEGEBEN}
      onNeuladen={onNeuladen}
    >
      <div data-lfh="offene-vorgaenge">
        {abschnitt({
          titel: 'Meldungen',
          kennung: 'vorgaenge-meldungen',
          zahl: zahlVon(zMeldungen, (z) => z.offen),
          zustand: stand(meldungen, zMeldungen),
          ladeZeilen: erwartet(zMeldungen, (z) => z.offen),
          notiz:
            zMeldungen.zustand === 'daten'
              ? notiz([
                  { text: `${zMeldungen.zahl.ungesehen} neu` },
                  ...(zMeldungen.zahl.bestaetigung_ueberfaellig > 0
                    ? [
                        {
                          text: `${zMeldungen.zahl.bestaetigung_ueberfaellig} Bestätigung überfällig`,
                          ton: 'alarm' as const,
                        },
                      ]
                    : []),
                  ...(zLage.zustand === 'daten' && zLage.zahl.neu > 0
                    ? [{ text: `${zLage.zahl.neu} Lagemeldungen neu` }]
                    : []),
                ])
              : undefined,
          eintraege: mListe,
          schluessel: (m) => m.id,
          sprung: { ziel: meldungenPfad(einsatzId), name: 'Meldungen' },
          onNeuladen: neuladen(meldungen),
          zeile: (m) => {
            const alarm = istAlarmiert(m);
            return (
              <Link
                to={meldungenPfad(einsatzId, { meldung: m.id })}
                data-lfh="vorgang-meldung"
                data-alarm={alarm || undefined}
                style={mitKante(alarm)}
              >
                {zeit(kurz(m.eingang_at))}
                {text(
                  m.inhalt,
                  [m.absender && `von ${m.absender}`, m.empfaenger && `an ${m.empfaenger}`]
                    .filter(Boolean)
                    .join(' · '),
                )}
                {alarm
                  ? wort('Bestätigung überfällig', 'alarm')
                  : wort(
                      (MELDUNG_STATUS[m.status]?.label ?? m.status).toLowerCase(),
                      m.status === 'neu' ? 'achtung' : null,
                    )}
              </Link>
            );
          },
        })}
        {abschnitt({
          titel: 'Aufträge',
          kennung: 'vorgaenge-auftraege',
          zahl: zahlVon(zAuftraege, (z) => z.offen),
          zustand: stand(auftraege, zAuftraege),
          ladeZeilen: erwartet(zAuftraege, (z) => z.offen),
          notiz:
            zAuftraege.zustand === 'daten'
              ? notiz([
                  zAuftraege.zahl.ueberfaellig > 0
                    ? { text: `${zAuftraege.zahl.ueberfaellig} überfällig`, ton: 'alarm' }
                    : { text: 'keiner überfällig' },
                  { text: `${zAuftraege.zahl.in_arbeit} in Arbeit` },
                ])
              : undefined,
          eintraege: aListe,
          schluessel: (a) => a.id,
          sprung: { ziel: auftraegePfad(einsatzId), name: 'Aufträge' },
          onNeuladen: neuladen(auftraege),
          zeile: (a) => (
            <Link
              to={auftraegePfad(einsatzId, { auftrag: a.id })}
              data-lfh="vorgang-auftrag"
              data-alarm={a.ist_ueberfaellig || undefined}
              style={mitKante(a.ist_ueberfaellig)}
            >
              {zeit(kurz(a.erteilt_at))}
              {text(
                a.auftrag_text,
                [
                  empfaengerText(a) ? `an ${empfaengerText(a)}` : 'ohne Empfänger',
                  a.frist_at ? `Frist ${kurz(a.frist_at)}` : 'ohne Frist',
                ].join(' · '),
              )}
              {a.ist_ueberfaellig
                ? wort('überfällig', 'alarm')
                : wort(a.bearbeitungsstatus === 'in_arbeit' ? 'in Arbeit' : 'offen', null)}
            </Link>
          ),
        })}
        {abschnitt({
          titel: 'Nachforderungen',
          kennung: 'vorgaenge-nachforderungen',
          zahl: zahlVon(zNachforderungen, (z) => z.offen),
          zustand: stand(nachforderungen, zNachforderungen),
          ladeZeilen: erwartet(zNachforderungen, (z) => z.offen),
          notiz:
            zNachforderungen.zustand === 'daten'
              ? notiz([
                  ...(zNachforderungen.zahl.ueberfaellig > 0
                    ? [
                        {
                          text: `${zNachforderungen.zahl.ueberfaellig} überfällig`,
                          ton: 'achtung' as const,
                        },
                      ]
                    : []),
                  { text: `${zNachforderungen.zahl.unterwegs} unterwegs` },
                ])
              : undefined,
          eintraege: nListe,
          schluessel: (n) => n.id,
          sprung: { ziel: nachforderungenPfad(einsatzId), name: 'Nachforderungen' },
          onNeuladen: neuladen(nachforderungen),
          zeile: (n) => {
            const ueberfaellig = istUeberfaellig(n, jetzt);
            return (
              <Link
                to={nachforderungenPfad(einsatzId, { nachforderung: n.id })}
                data-lfh="vorgang-nachforderung"
                style={zeile}
              >
                {zeit(formatVor(n.angefordert_at, jetzt))}
                {text(
                  nachforderungName(n),
                  [`an ${adressatText(n)}`, n.benoetigt_bis ? `bis ${kurz(n.benoetigt_bis)}` : null]
                    .filter(Boolean)
                    .join(' · '),
                )}
                {ueberfaellig
                  ? wort('überfällig', 'achtung')
                  : wort(stufeWort(n.status).toLowerCase(), null)}
              </Link>
            );
          },
        })}
        {abschnitt({
          titel: 'Erinnerungen',
          kennung: 'vorgaenge-erinnerungen',
          zahl: zahlVon(zErinnerungen, (z) => z.faellig),
          zustand: stand(erinnerungen, zErinnerungen),
          ladeZeilen: erwartet(zErinnerungen, (z) => z.faellig),
          notiz: zErinnerungen.zustand === 'daten' ? 'fällig' : undefined,
          eintraege: eListe,
          schluessel: (e) => e.id,
          sprung: { ziel: erinnerungenPfad(einsatzId), name: 'Erinnerungen' },
          onNeuladen: neuladen(erinnerungen),
          zeile: (e) => (
            <Link
              to={erinnerungenPfad(einsatzId, { erinnerung: e.id })}
              data-lfh="vorgang-erinnerung"
              style={zeile}
            >
              {zeit(kurz(e.faellig_at))}
              {text(e.titel, e.empfaenger_anzeige ? `an ${e.empfaenger_anzeige}` : null)}
              {e.ist_faellig ? wort('fällig', 'achtung') : wort('bald', null)}
            </Link>
          ),
        })}
        {abschnitt({
          titel: 'Ablösungen',
          kennung: 'vorgaenge-abloesungen',
          zahl: abloesungZahl,
          zustand: stand(abloesungen),
          ladeZeilen: null,
          notiz: meine ? 'alle Stellen' : 'fällig oder bald',
          zahlWort: undefined,
          leer: 'keine',
          eintraege: abListe,
          schluessel: (a) => a.id,
          sprung: { ziel: abloesungPfad(einsatzId), name: 'Ablösungen' },
          onNeuladen: () => void abloesungen.q.refetch(),
          zeile: (a) => {
            const ueberfaellig = einstufungOf(a, dayjs(jetzt)) === 'ueberfaellig';
            return (
              <Link
                to={abloesungPfad(einsatzId, { schicht: a.id })}
                data-lfh="vorgang-abloesung"
                data-alarm={ueberfaellig || undefined}
                style={mitKante(ueberfaellig)}
              >
                {zeit(kurz(a.faellig_at))}
                {text(a.einheit_name, a.abschnitt_name ?? null)}
                {ueberfaellig ? wort('überfällig', 'alarm') : wort('bald fällig', 'achtung')}
              </Link>
            );
          },
        })}
      </div>
    </DashboardPaneel>
  );
}
