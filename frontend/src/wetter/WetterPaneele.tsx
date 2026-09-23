/**
 * Paneele „Warnungen (DWD)" und „Vorhersage 24 h" der Modulseite „Wetter & Pegel" (LFH-633).
 *
 * JEDER TEIL TRÄGT SEINEN STAND (Spec „Datenstand und Quellausfall"): `kein_ort` erklärt,
 * was fehlt, und verweist auf die Einsatzdaten; `ausfall` (oder ein Stand über der Obergrenze,
 * die das Backend prüft) zeigt „Stand unbekannt" und KEINE Liste; ein Stand über der
 * Veraltet-Schwelle bleibt sichtbar, trägt aber Wort und Abrufzeit. Die Einordnung ist rein
 * und steht in `wetterStand.ts`.
 *
 * FORM: beide sind Listen, die man liest — „was gilt?", „was kommt?" —, keine Vergleiche.
 * Beschreibung und Handlungsempfehlung einer Warnung stehen INLINE hinter einem Umschalter
 * (LFH-19: Zusatzinhalt im Kontext), nicht in einem Drawer.
 */
import { Button } from 'antd';
import { useId, useState } from 'react';
import type { WetterAnzeige, WetterOrt, WetterWarnung } from '../api/types';
import type { AnzeigeKonventionen } from '../anzeige/format';
import {
  Augenbraue,
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
  teileWarnungen,
  teilStand,
  type TeilStand,
} from './wetterStand';
import {
  niederschlagText,
  stationText,
  temperaturText,
  titelSchreibung,
  warnZeitraum,
  windText,
} from './wetterText';

export const QUELLENVERMERK = 'Datenbasis: Deutscher Wetterdienst · über Bright Sky';
export const KEIN_ORT_TEXT =
  'Warnungen und Vorhersage brauchen einen verorteten Einsatzort. Der Einsatz hat noch keine Koordinate.';
export const AUSFALL_TEXT =
  'Die Wetterquelle antwortet nicht, und es liegt kein verwertbarer Stand vor. Es werden keine Werte gezeigt.';

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
}: {
  stand: TeilStand;
  onEinsatzdaten?: () => void;
}) {
  const { token, rollen } = useRollen();
  const polster = { paddingBlock: token.paddingSM, paddingInline: token.padding } as const;
  if (stand.art === 'kein_ort') {
    return (
      <div data-lfh="wetter-kein-ort" style={{ ...polster, display: 'grid', gap: token.marginXS }}>
        <span style={{ color: rollen.text2, fontSize: 12 }}>{KEIN_ORT_TEXT}</span>
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
        <span style={{ color: rollen.text2, fontSize: 12 }}>{AUSFALL_TEXT}</span>
      </div>
    );
  }
  if (stand.art === 'veraltet') {
    return (
      <div
        data-lfh="wetter-veraltet"
        style={{ ...polster, color: rollen.achtungText, fontSize: 12, fontWeight: 600 }}
      >
        {stand.stand} · {VERALTET} — die Aktualisierung gelingt gerade nicht
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
            // Die Zeilenkennung gehört in den zugänglichen Namen: n Warnungen ergäben sonst n
            // gleichnamige Umschalter (Regel wie bei der Aktionsbündelung, LFH-365).
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
 * Stabiler Schlüssel je Warnung aus ihrem INHALT, nicht aus dem Listenplatz: beim Nachladen
 * kann vorne eine Warnung dazukommen oder wegfallen, und ein Index-Schlüssel hängte dann alle
 * folgenden Einträge neu ein (eine aufgeklappte Beschreibung klappte zu oder sprang auf die
 * Nachbarwarnung). Echte Dubletten bekommen einen Zähler je gleichem Grundschlüssel. Rein.
 */
export function warnungsSchluessel(
  liste: readonly WetterWarnung[],
): Array<[string, WetterWarnung]> {
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
        {/* Den Weg zu den Einsatzdaten trägt das Warnpaneel — zwei gleichnamige Knöpfe
            auf einer Seite sagten nicht, welcher wohin führt. */}
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
