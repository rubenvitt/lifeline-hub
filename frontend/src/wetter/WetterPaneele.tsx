/**
 * Paneele „Aktuelle Bedingungen" (LFH-864), „Warnungen (DWD)" und „Vorhersage 24 h" der
 * Modulseite „Wetter & Pegel".
 *
 * Jeder Teil trägt seinen Stand: `kein_ort` erklärt, was fehlt; `ausfall` (oder ein Stand über
 * der Obergrenze) zeigt „Stand unbekannt" und KEINE Liste; ein veralteter Stand bleibt sichtbar
 * mit Wort und Abrufzeit, bei den aktuellen Bedingungen mit der Messzeit. Die Einordnung steht
 * in `wetterStand.ts`.
 * Warnungen und Vorhersage sind Listen zum Lesen; Beschreibung und Handlungsempfehlung einer
 * Warnung stehen inline hinter einem Umschalter, nicht in einem Drawer.
 *
 * „Aktuelle Bedingungen" zeigt die jüngste MESSUNG naher DWD-Stationen, keinen Modellwert;
 * ihr Stand ist die Messzeit (`wetterStand.ts`). „Zahl führt": vier Kennzahlen ohne Ton — das
 * Paneel bewertet nichts (keine Einsatzgrenzen, kein Alarm, LFH-864 design.md). Ergänzt die
 * Quelle einen Wert aus einer anderen Station, steht diese als Text beim Wert, vorlesbar.
 */
import { Button } from 'antd';
import { useId, useState, type ReactNode } from 'react';
import type { WetterAktuell, WetterAnzeige, WetterOrt, WetterWarnung } from '../api/types';
import type { AnzeigeKonventionen } from '../anzeige/format';
import {
  Augenbraue,
  Datenfeld,
  Datenraster,
  Kennzahl,
  Kennzahlenband,
  Paneel,
  PaneelZustand,
  StatusChip,
  tonVonRolle,
  monoStil,
  useRollen,
  type PaneelDatenzustand,
} from '../components/instrument';
import { formatUhrzeit } from '../anzeige/format';
import { dwdWarnstufe } from '../theme/statusFarben';
import {
  STAND_UNBEKANNT,
  VERALTET,
  dreiStundenTakt,
  himmelsrichtung,
  messStand,
  teileWarnungen,
  teilStand,
  type TeilStand,
} from './wetterStand';
import { wetterSymbolIcon } from './wetterSymbol';
import {
  druckText,
  ergaenztVon,
  niederschlagText,
  prozentText,
  sichtText,
  stationText,
  temperaturText,
  titelSchreibung,
  warnZeitraum,
  wetterSymbolWort,
  windText,
  zahlText,
} from './wetterText';

const QUELLENVERMERK = 'Datenbasis: Deutscher Wetterdienst · über Bright Sky';
const KEIN_ORT_TEXT =
  'Warnungen und Vorhersage brauchen einen verorteten Einsatzort. Der Einsatz hat noch keine Koordinate.';
const KEIN_ORT_AKTUELL =
  'Die aktuellen Bedingungen brauchen einen verorteten Einsatzort. Der Einsatz hat noch keine Koordinate.';
const AUSFALL_TEXT =
  'Die Wetterquelle antwortet nicht, und es liegt kein verwertbarer Stand vor. Es werden keine Werte gezeigt.';
const VERALTET_GRUND = 'die Aktualisierung gelingt gerade nicht';
/** Bei den aktuellen Bedingungen ist der Stand die Messzeit: alt ist die Station, nicht der Abruf. */
const AUSFALL_AKTUELL =
  'Keine Messung aus den letzten drei Stunden — die Wetterquelle antwortet nicht, oder die Stationen melden nichts. Es werden keine Werte gezeigt.';
const VERALTET_AKTUELL = 'die Station hat seitdem keine neue Messung geliefert';

interface TeilProps {
  /** Zustand der HTTP-Abfrage — `daten`, sobald die Antwort da ist, egal welcher Teilzustand. */
  zustand: PaneelDatenzustand;
  wetter: WetterAnzeige | undefined;
  jetzt: number;
  konv: AnzeigeKonventionen;
  onNeuladen: () => void;
}

/** Kopf-Meta eines Teils: „Stadt Bremen · Stand 14:25 · veraltet". */
function standMeta(stand: TeilStand, vorne?: string | null): string | undefined {
  const teile = [vorne, stand.stand, stand.art === 'veraltet' ? VERALTET : null].filter(
    (t): t is string => !!t,
  );
  return teile.length ? teile.join(' · ') : undefined;
}

/** Hinweis im Körper für die Zustände ohne Inhalt bzw. mit veraltetem Inhalt. */
function StandHinweis({
  stand,
  onEinsatzdaten,
  keinOrtText = KEIN_ORT_TEXT,
  ausfallText = AUSFALL_TEXT,
  veraltetGrund = VERALTET_GRUND,
}: {
  stand: TeilStand;
  onEinsatzdaten?: () => void;
  keinOrtText?: string;
  ausfallText?: string;
  veraltetGrund?: string;
}) {
  const { token, rollen } = useRollen();
  const polster = { paddingBlock: token.paddingSM, paddingInline: token.padding } as const;
  if (stand.art === 'kein_ort') {
    return (
      <div data-lfh="wetter-kein-ort" style={{ ...polster, display: 'grid', gap: token.marginXS }}>
        <span style={{ color: rollen.text2, fontSize: 12 }}>{keinOrtText}</span>
        {onEinsatzdaten && (
          <span>
            <Button onClick={onEinsatzdaten}>Einsatzort in den Einsatzdaten verorten</Button>
          </span>
        )}
      </div>
    );
  }
  if (stand.art === 'unbekannt') {
    return (
      <div
        role="status"
        data-lfh="wetter-stand-unbekannt"
        style={{
          ...polster,
          display: 'grid',
          gap: token.marginXXS,
          boxShadow: `inset 3px 0 0 ${rollen.achtung}`,
        }}
      >
        <b style={{ color: rollen.achtungText, fontSize: 13 }}>{STAND_UNBEKANNT}</b>
        <span style={{ color: rollen.text2, fontSize: 12 }}>{ausfallText}</span>
      </div>
    );
  }
  if (stand.art === 'veraltet') {
    return (
      <div
        data-lfh="wetter-veraltet"
        style={{ ...polster, color: rollen.achtungText, fontSize: 12, fontWeight: 600 }}
      >
        {stand.stand} · {VERALTET} — {veraltetGrund}
      </div>
    );
  }
  return null;
}

function WarnungEintrag({
  w,
  jetzt,
  konv,
}: {
  w: WetterWarnung;
  jetzt: number;
  konv: AnzeigeKonventionen;
}) {
  const { token, rollen } = useRollen();
  const [offen, setOffen] = useState(false);
  const textId = useId();
  const d = dwdWarnstufe[w.stufe];
  const hatText = !!(w.beschreibung?.trim() || w.handlungsempfehlung?.trim());
  return (
    <li
      data-lfh="wetter-warnung"
      data-stufe={w.stufe}
      style={{
        display: 'grid',
        gap: token.marginXXS,
        paddingBlock: token.paddingSM,
        paddingInline: token.padding,
        borderBlockEnd: `1px solid ${rollen.flaeche3}`,
      }}
    >
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: token.marginXS }}>
        <StatusChip ton={tonVonRolle(d.rolle) ?? 'achtung'} wort={d.label} />
        <b style={{ color: rollen.text, fontSize: 13 }}>{titelSchreibung(w.ereignis)}</b>
      </div>
      <span style={{ ...monoStil(12), color: rollen.text2 }}>
        {warnZeitraum(w.beginn, w.ende, jetzt, konv)}
      </span>
      <span style={{ color: rollen.text2, fontSize: 12 }}>{w.ueberschrift}</span>
      {hatText && (
        <span>
          <Button
            type="link"
            // Die Zeilenkennung gehört in den zugänglichen Namen, sonst n gleichnamige Umschalter.
            aria-label={`${offen ? 'Beschreibung ausblenden' : 'Beschreibung und Handlungsempfehlung'} zu ${titelSchreibung(w.ereignis)}`}
            aria-expanded={offen}
            aria-controls={textId}
            onClick={() => setOffen((o) => !o)}
            style={{ paddingInline: 0 }}
          >
            {offen ? 'Beschreibung ausblenden' : 'Beschreibung und Handlungsempfehlung'}
          </Button>
        </span>
      )}
      {hatText && offen && (
        <div id={textId} style={{ display: 'grid', gap: token.marginXS, fontSize: 12 }}>
          {w.beschreibung?.trim() && <p style={{ margin: 0 }}>{w.beschreibung}</p>}
          {w.handlungsempfehlung?.trim() && (
            <p style={{ margin: 0 }}>
              <Augenbraue>Handlungsempfehlung</Augenbraue>
              <br />
              {w.handlungsempfehlung}
            </p>
          )}
        </div>
      )}
    </li>
  );
}

function WarnGruppe({
  titel,
  liste,
  jetzt,
  konv,
}: {
  titel: string;
  liste: readonly WetterWarnung[];
  jetzt: number;
  konv: AnzeigeKonventionen;
}) {
  const { token } = useRollen();
  if (liste.length === 0) return null;
  return (
    <section aria-label={titel}>
      <Augenbraue
        als="h3"
        style={{ paddingInline: token.padding, paddingBlockStart: token.paddingSM }}
      >
        {titel} ({liste.length})
      </Augenbraue>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {warnungsSchluessel(liste).map(([schluessel, w]) => (
          <WarnungEintrag key={schluessel} w={w} jetzt={jetzt} konv={konv} />
        ))}
      </ul>
    </section>
  );
}

/**
 * Stabiler Schlüssel je Warnung aus ihrem INHALT, nicht aus dem Listenplatz: sonst klappte beim
 * Nachladen eine aufgeklappte Beschreibung zu oder sprang auf die Nachbarwarnung. Dubletten
 * bekommen einen Zähler. Rein.
 */
function warnungsSchluessel(liste: readonly WetterWarnung[]): Array<[string, WetterWarnung]> {
  const gesehen = new Map<string, number>();
  return liste.map((w) => {
    const grund = [w.stufe, w.ereignis, w.beginn ?? '', w.ende ?? '', w.ueberschrift].join('|');
    const n = gesehen.get(grund) ?? 0;
    gesehen.set(grund, n + 1);
    return [n === 0 ? grund : `${grund}#${n}`, w];
  });
}

function ortName(ort: WetterOrt | null | undefined): string | null {
  return ort?.name?.trim() || null;
}

export function WarnungenPaneel({
  zustand,
  wetter,
  jetzt,
  konv,
  onNeuladen,
  onEinsatzdaten,
}: TeilProps & { onEinsatzdaten: () => void }) {
  const { token, rollen } = useRollen();
  const teil = wetter?.warnungen;
  const stand = teil ? teilStand(teil, 'warnungen', jetzt, konv) : null;
  const ort = ortName(wetter?.ort);
  const { giltJetzt, angekuendigt } = teileWarnungen(
    teil?.zustand === 'ok' ? (teil.daten ?? []) : [],
    jetzt,
  );
  const anzahl = giltJetzt.length + angekuendigt.length;
  const mitInhalt = stand && (stand.art === 'aktuell' || stand.art === 'veraltet');
  return (
    <Paneel
      titel="Warnungen (DWD)"
      meta={stand ? standMeta(stand, ort) : undefined}
      fuss={<span style={{ color: rollen.gedaempft, fontSize: 11 }}>{QUELLENVERMERK}</span>}
    >
      <PaneelZustand
        zustand={zustand}
        titel="Warnungen"
        leerText=""
        leerAktion=""
        onLeerAktion={onNeuladen}
        onNeuladen={onNeuladen}
      >
        {stand && <StandHinweis stand={stand} onEinsatzdaten={onEinsatzdaten} />}
        {mitInhalt &&
          (anzahl === 0 ? (
            <div
              data-lfh="wetter-keine-warnung"
              style={{ paddingBlock: token.paddingSM, paddingInline: token.padding, fontSize: 12 }}
            >
              Keine gültigen Warnungen{ort ? ` für ${ort}` : ''}.
            </div>
          ) : (
            <>
              <WarnGruppe titel="Gilt jetzt" liste={giltJetzt} jetzt={jetzt} konv={konv} />
              <WarnGruppe titel="Angekündigt" liste={angekuendigt} jetzt={jetzt} konv={konv} />
            </>
          ))}
      </PaneelZustand>
    </Paneel>
  );
}

export function VorhersagePaneel({ zustand, wetter, jetzt, konv, onNeuladen }: TeilProps) {
  const { token, rollen } = useRollen();
  const teil = wetter?.vorhersage;
  const stand = teil ? teilStand(teil, 'vorhersage', jetzt, konv) : null;
  const daten = teil?.zustand === 'ok' ? teil.daten : null;
  const stunden = daten ? dreiStundenTakt(daten.stunden, jetzt) : [];
  const mitInhalt = stand && (stand.art === 'aktuell' || stand.art === 'veraltet');
  const station = daten ? stationText(daten.station, daten.entfernung_m) : null;
  return (
    <Paneel
      titel="Vorhersage 24 h"
      meta={stand ? standMeta(stand) : undefined}
      fuss={
        <span style={{ color: rollen.gedaempft, fontSize: 11 }}>
          {[station, 'MOSMIX', QUELLENVERMERK].filter(Boolean).join(' · ')}
        </span>
      }
    >
      <PaneelZustand
        zustand={zustand}
        titel="Vorhersage"
        leerText=""
        leerAktion=""
        onLeerAktion={onNeuladen}
        onNeuladen={onNeuladen}
      >
        {/* Den Weg zu den Einsatzdaten trägt das Warnpaneel, nicht zwei gleichnamige Knöpfe. */}
        {stand && <StandHinweis stand={stand} />}
        {mitInhalt &&
          (stunden.length === 0 ? (
            <div
              style={{ paddingBlock: token.paddingSM, paddingInline: token.padding, fontSize: 12 }}
            >
              Keine Vorhersagewerte für die nächsten 24 Stunden.
            </div>
          ) : (
            <>
              <Augenbraue
                als="div"
                style={{ paddingInline: token.padding, paddingBlockStart: token.paddingSM }}
              >
                Zeit · Temperatur · Niederschlag, Wahrscheinlichkeit · Wind, Böen
              </Augenbraue>
              <ul
                aria-label="Vorhersage je drei Stunden"
                style={{ listStyle: 'none', margin: 0, padding: 0 }}
              >
                {stunden.map((s) => (
                  <li
                    key={s.zeitpunkt}
                    data-lfh="wetter-stunde"
                    style={{
                      display: 'flex',
                      flexWrap: 'wrap',
                      columnGap: token.marginSM,
                      rowGap: 2,
                      paddingBlock: token.paddingXS,
                      paddingInline: token.padding,
                      borderBlockEnd: `1px solid ${rollen.flaeche3}`,
                      ...monoStil(12),
                      color: rollen.text2,
                    }}
                  >
                    <time dateTime={s.zeitpunkt} style={{ color: rollen.text, minWidth: 40 }}>
                      {formatUhrzeit(s.zeitpunkt, konv)}
                    </time>
                    <span style={{ minWidth: 64 }}>{temperaturText(s.temperatur_c)}</span>
                    <span style={{ minWidth: 96 }}>
                      {niederschlagText(s.niederschlag_mm, s.niederschlag_wahrscheinlichkeit)}
                    </span>
                    <span>{windText(s.wind_kmh, s.boeen_kmh, s.windrichtung_grad)}</span>
                  </li>
                ))}
              </ul>
            </>
          ))}
      </PaneelZustand>
    </Paneel>
  );
}

const FEHLT = '—';

/** Notiz einer Kennzahl: Zusatz und, bei einem ergänzten Wert, dessen Station. */
function notiz(...teile: Array<string | null | undefined>): string | undefined {
  const t = teile.filter((x): x is string => !!x);
  return t.length ? t.join(' · ') : undefined;
}

/** Einheit nur hinter einem Wert — „— °C" läse sich wie ein Messwert. */
function einheit(v: number | null | undefined, e: string): string | undefined {
  return v != null && Number.isFinite(v) ? e : undefined;
}

function Messwerte({ a }: { a: WetterAktuell }) {
  const { token, rollen } = useRollen();
  const von = (g: Parameters<typeof ergaenztVon>[1]) => ergaenztVon(a.ergaenzt, g);
  const richtung = himmelsrichtung(a.windrichtung_grad);
  const SymbolIcon = wetterSymbolIcon(a.symbol);
  /** Wert eines Datenfelds, bei Ergänzung mit der Station darunter. */
  const wert = (text: ReactNode, herkunft: string | null) => (
    <span style={{ display: 'grid', gap: 2 }}>
      <span>{text}</span>
      {herkunft && <span style={{ fontSize: 11, color: rollen.gedaempft }}>{herkunft}</span>}
    </span>
  );
  return (
    <div style={{ display: 'grid', gap: token.marginSM, padding: token.padding }}>
      {/* Fest 2 × 2: im Raster nach Breite stünden vier Werte 3 + 1 mit leerer Zelle. */}
      <Kennzahlenband beschriftung="Messwerte" spalten={2}>
        <Kennzahl
          titel="Temperatur"
          wert={zahlText(a.temperatur_c, 1)}
          einheit={einheit(a.temperatur_c, '°C')}
          notiz={notiz(von('temperatur'))}
        />
        <Kennzahl
          titel="Wind"
          wert={zahlText(a.wind_kmh, 0)}
          einheit={einheit(a.wind_kmh, 'km/h')}
          notiz={notiz(`aus ${richtung ?? FEHLT}`, von('wind'))}
        />
        <Kennzahl
          titel="Böen"
          wert={zahlText(a.boeen_kmh, 0)}
          einheit={einheit(a.boeen_kmh, 'km/h')}
          notiz={notiz('stärkste der letzten Stunde', von('boeen'))}
        />
        <Kennzahl
          titel="Niederschlag"
          wert={zahlText(a.niederschlag_mm, 1)}
          einheit={einheit(a.niederschlag_mm, 'mm')}
          notiz={notiz('letzte Stunde', von('niederschlag'))}
        />
      </Kennzahlenband>
      <Datenraster beschriftung="Weitere Messwerte">
        <Datenfeld label="Wetterlage">
          {wert(
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: token.marginXS }}>
              {SymbolIcon && <SymbolIcon />}
              {wetterSymbolWort(a.symbol)}
            </span>,
            von('wetterlage'),
          )}
        </Datenfeld>
        <Datenfeld label="Sicht" mono>
          {wert(sichtText(a.sicht_m), von('sicht'))}
        </Datenfeld>
        <Datenfeld label="Bewölkung" mono>
          {wert(prozentText(a.bewoelkung_prozent), von('bewoelkung'))}
        </Datenfeld>
        <Datenfeld label="Luftfeuchte" mono>
          {wert(prozentText(a.luftfeuchte_prozent), von('luftfeuchte'))}
        </Datenfeld>
        <Datenfeld label="Taupunkt" mono>
          {wert(temperaturText(a.taupunkt_c), von('taupunkt'))}
        </Datenfeld>
        <Datenfeld label="Luftdruck" mono>
          {wert(druckText(a.luftdruck_hpa), von('luftdruck'))}
        </Datenfeld>
      </Datenraster>
    </div>
  );
}

export function AktuellPaneel({ zustand, wetter, jetzt, konv, onNeuladen }: TeilProps) {
  const { rollen } = useRollen();
  const teil = wetter?.aktuell;
  const stand = teil ? messStand(teil, jetzt, konv) : null;
  const daten = teil?.zustand === 'ok' ? teil.daten : null;
  const mitInhalt = daten && stand && (stand.art === 'aktuell' || stand.art === 'veraltet');
  const station = daten ? stationText(daten.station.name, daten.station.entfernung_m) : null;
  return (
    <div data-lfh="wetter-aktuell">
      <Paneel
        titel="Aktuelle Bedingungen"
        meta={stand ? standMeta(stand, mitInhalt ? station : null) : undefined}
        fuss={
          <span style={{ color: rollen.gedaempft, fontSize: 11 }}>
            {['Messung', 'SYNOP', QUELLENVERMERK].join(' · ')}
          </span>
        }
      >
        <PaneelZustand
          zustand={zustand}
          titel="Aktuelle Bedingungen"
          leerText=""
          leerAktion=""
          onLeerAktion={onNeuladen}
          onNeuladen={onNeuladen}
        >
          {/* Den Weg zu den Einsatzdaten trägt das Warnpaneel, nicht drei gleichnamige Knöpfe. */}
          {stand && (
            <StandHinweis
              stand={stand}
              keinOrtText={KEIN_ORT_AKTUELL}
              ausfallText={AUSFALL_AKTUELL}
              veraltetGrund={VERALTET_AKTUELL}
            />
          )}
          {mitInhalt && <Messwerte a={daten} />}
        </PaneelZustand>
      </Paneel>
    </div>
  );
}
