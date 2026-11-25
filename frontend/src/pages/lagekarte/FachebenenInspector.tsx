import {
  IconGewitterwolke,
  IconNebel,
  IconRegen,
  IconSchneeflocke,
  IconSonne,
  IconThermometer,
  IconWarndreieck,
  IconWind,
  type Icon,
} from '../../icons';
import { useState } from 'react';
import { App, Button, Descriptions, Typography, theme } from 'antd';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router';
import { useAnzeigeKonventionen } from '../../anzeige/AnzeigeKonventionenContext';
import { PEGEL_MAX, fuegePegelHinzu, pegelAbfrage, pegelSchreibScope } from '../../api/pegel';
import { einsatzKeys } from '../../api/queryKeys';
import { SpeicherFehler } from '../../components/SpeicherHinweis';
import { einsatzEinstellungenPfad } from '../../routing/deeplinks';
import type { EnergieAnlagenart, FachebeneQuelle } from '../../api/fachebenen';
import GeoKennzahlen from '../../components/GeoKennzahlen';
import { useMinutenTakt } from '../../components/useMinutenTakt';
import { useOnline } from '../../offline/useOnline';
import {
  capSchwereVon,
  dwdStufeAusSeverity,
  dwdWarnstufe,
  fachebeneFarbe,
  pegelZustandVon,
  rollenFarbe,
  type StatusDarstellung,
} from '../../theme/statusFarben';
import { istAngekuendigt } from './dwdGueltigkeit';
import { alsText as s, fachebeneTitel, pick } from './fachebeneTitel';
import { kategorieLabel } from './fachebenenLayer';
import { geoKennzahlen } from './geo';
import { isCopernicusAufnahmeAlt, copernicusDarstellung } from './copernicusStil';
import { hochwasserDarstellung } from './hochwasserStil';
import { luftqualitaetDarstellung } from './luftqualitaetStil';
import { odlDarstellung, odlGrundlage } from './odlStil';
import KartenDetailCard from './KartenDetailCard';
import FachebeneStand from './FachebeneStand';
import { drohnenFotoVorschauPfad } from '../../api/drohne';
import { zeitpunkt } from '../../anzeige/zeitDarstellung';
import { Status } from '../../components/instrument/Status';
import { Marke } from '../../components/instrument/Marke';
import { Stapel, Textstufe, schriftStil, useRollen } from '../../components/instrument';

interface FachebenenInspectorProps {
  quelle: FachebeneQuelle;
  properties: Record<string, unknown>;
  /** Volle (ungeclippte) Geometrie des angeklickten Features → Fläche/Umfang/Länge. */
  geometrie?: { type: string; coordinates: unknown } | null;
  onSchliessen: () => void;
  /**
   * Einsatzbezug für den Schnellweg „Als maßgeblichen Pegel festlegen" an einem PEGELONLINE-Punkt.
   * Als Prop statt Context: der Inspektor bleibt ohne Einsatz montierbar. `darfSchreiben` ist das
   * Einsatz-Schreibrecht der Lagekarte (im Snapshot-Modus `false`).
   */
  pegelBezug?: { einsatzId: number; darfSchreiben: boolean };
  /** Einsatz der Lagekarte; die Vorschau eines Drohnenfotos kommt über dessen Route (LLH-2108). */
  einsatzId?: number;
  /**
   * Abrufzeitpunkt der Ebene durch den Server (LFH-591). Steht neben den Zeitangaben der Quelle
   * am Objekt, ersetzt sie nicht: eine Meldeklasse kann frisch gemessen und trotzdem vor zwei
   * Tagen abgerufen sein.
   */
  abgerufen?: string;
}

/** Nur http(s) zulassen. Die Werte kommen aus fremden Quellen (OSM-Tags, Autobahn-API);
 *  ein `javascript:`-URI in `href`/`src` wäre XSS. */
function nurWeb(v: string | null): string | null {
  return v && /^https?:\/\//i.test(v) ? v : null;
}

/** ISO-Zeit als volle DTG in der Anzeigezone (LFH-913), Fallback auf Rohwert. */
function useFmtZeit(): (v: string | null) => string | null {
  const { konventionen } = useAnzeigeKonventionen();
  return (v) => {
    if (!v) return null;
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? v : zeitpunkt(v, konventionen);
  };
}

/**
 * Icon zum Wetter-Ereignis (DWD EC_GROUP / EVENT) aus dem Iconsatz (LFH-595; vorher Emojis,
 * die kein Iconsatz sind und je System anders aussehen). Unbekanntes Ereignis: Warndreieck.
 */
function wetterIcon(group: string | null, event: string | null): Icon {
  const t = `${group ?? ''} ${event ?? ''}`.toUpperCase();
  if (/GEWITTER|THUNDER/.test(t)) return IconGewitterwolke;
  if (/REGEN|RAIN/.test(t)) return IconRegen;
  if (/STURM|ORKAN|WIND|BÖ/.test(t)) return IconWind;
  if (/SCHNEE|SNOW|GLATT|GLÄTTE|EIS|GLAZE|ICE|FROST|TAUWETTER|THAW/.test(t))
    return IconSchneeflocke;
  if (/NEBEL|FOG/.test(t)) return IconNebel;
  if (/HITZE|HEAT/.test(t)) return IconThermometer;
  if (/UV/.test(t)) return IconSonne;
  return IconWarndreieck;
}

/**
 * Schwere einer Warnung aus dem Statusfarb-Vertrag (LFH-662): DWD mit der amtlichen Bezeichnung
 * (`dwdWarnstufe`, dieselbe wie im Wetter-Paneel), NINA mit dem CAP-Wort (`capSchwere`). Keine
 * Stufe ist Blau. Unbekannt → `null`, der Aufrufer zeigt dann den Rohwert ohne Rollenfarbe.
 */
function schwereDarstellung(ebene: 'nina' | 'dwd', schwere: string): StatusDarstellung | null {
  if (ebene === 'nina') return capSchwereVon(schwere);
  const stufe = dwdStufeAusSeverity(schwere);
  return stufe ? dwdWarnstufe[stufe] : null;
}

const DRINGLICHKEIT: Record<string, string> = {
  Immediate: 'Sofort',
  Expected: 'Erwartet',
  Future: 'Zukünftig',
  Past: 'Vergangen',
  Unknown: 'Unbekannt',
};

// Rückfall für „Quelle“, wenn `SENDERNAME` fehlt oder leer ist (LFH-882): je Ebene die amtliche
// Stelle, die sie liefert. Im DWD-WFS ist `SENDERNAME` optional und nillable.
const WARNQUELLE_RUECKFALL: Record<'nina' | 'dwd', string> = {
  nina: 'BBK / MoWaS',
  dwd: 'Deutscher Wetterdienst',
};

/**
 * Vollmeldung einer NINA-Warnung bei warnung.bund.de (LLH-2103). Die Ebene trägt nur einen Auszug;
 * Echtheit, Beschreibung und Handlungsanweisung stehen dort (MoWaS-Auflage,
 * `docs/fachebenen-quellen.md`). `/meldungen/<id>/` ist die Form, die die NINA-Seite selbst
 * verlinkt. Der Link geht ans Internet, nicht an den Server: ohne Netz gesperrt mit Grund.
 */
function ninaVollmeldungUrl(id: string): string {
  return `https://warnung.bund.de/meldungen/${encodeURIComponent(id)}/`;
}

function NinaVollmeldung({ id }: { id: string }) {
  const { token } = theme.useToken();
  const online = useOnline();
  return (
    <div style={{ marginTop: token.marginSM }}>
      {online ? (
        <Button
          type="link"
          href={ninaVollmeldungUrl(id)}
          target="_blank"
          rel="noreferrer noopener"
          style={{ paddingInline: 0 }}
        >
          Vollmeldung bei warnung.bund.de
        </Button>
      ) : (
        <>
          <Button type="link" disabled style={{ paddingInline: 0 }}>
            Vollmeldung bei warnung.bund.de
          </Button>
          <Textstufe als="p" stufe="textKlein" ton="gedaempft">
            Ohne Netz nicht abrufbar
          </Textstufe>
        </>
      )}
    </div>
  );
}

function WarnungInhalt({ p, ebene }: { p: Record<string, unknown>; ebene: 'nina' | 'dwd' }) {
  const fmtZeit = useFmtZeit();
  const { token } = theme.useToken();
  const jetzt = useMinutenTakt();
  const headline = pick(p, 'HEADLINE', 'titel', 'headline');
  const schwere = pick(p, 'SEVERITY', 'schwere', 'severity');
  const sev = schwere ? schwereDarstellung(ebene, schwere) : null;
  const dring = pick(p, 'URGENCY', 'dringlichkeit', 'urgency');
  // Angekündigt (LFH-662): aus `ONSET` gegen die laufende Uhr, mit derselben Funktion wie die Karte
  // (`dwdGueltigkeit`). Nicht aus der Property `angekuendigt`: `p` ist die Momentaufnahme vom Klick
  // und behielte die Markierung, nachdem die Warnung begonnen hat. NINA kennt keine Ankündigung.
  const angekuendigt = ebene === 'dwd' && istAngekuendigt(p, jetzt);
  const beginn = fmtZeit(pick(p, 'ONSET'));
  const von = fmtZeit(pick(p, 'ONSET', 'EFFECTIVE', 'beginn'));
  const bis = fmtZeit(pick(p, 'EXPIRES'));
  const quelle = pick(p, 'SENDERNAME') ?? WARNQUELLE_RUECKFALL[ebene];
  const beschreibung = pick(p, 'DESCRIPTION', 'description');
  const hinweis = pick(p, 'INSTRUCTION', 'instruction');
  const ninaId = ebene === 'nina' ? s(p.id) : null;

  return (
    <>
      {headline && (
        <Typography.Paragraph strong style={{ marginBottom: token.marginSM }}>
          {headline}
        </Typography.Paragraph>
      )}
      {sev ? (
        <span style={{ display: 'inline-block', marginBottom: token.marginSM }}>
          <Status darstellung={sev} />
        </span>
      ) : schwere ? (
        <Marke style={{ marginBottom: token.marginSM }}>{schwere}</Marke>
      ) : null}
      <Descriptions column={1}>
        {angekuendigt && (
          <Descriptions.Item label="Status">
            {beginn ? `angekündigt · ab ${beginn}` : 'angekündigt'}
          </Descriptions.Item>
        )}
        {dring && (
          <Descriptions.Item label="Dringlichkeit">
            {DRINGLICHKEIT[dring] ?? dring}
          </Descriptions.Item>
        )}
        {(von || bis) && (
          <Descriptions.Item label="Gültig">
            {von ?? '?'}
            {bis ? ` – ${bis}` : ''}
          </Descriptions.Item>
        )}
        <Descriptions.Item label="Quelle">{quelle}</Descriptions.Item>
      </Descriptions>
      {(beschreibung || hinweis) && (
        <div style={{ marginTop: token.marginSM }}>
          <Stapel abstand="sm">
            {beschreibung && (
              <Textstufe als="p" stufe="textKlein">
                {beschreibung}
              </Textstufe>
            )}
            {hinweis && (
              <Stapel abstand="xs">
                <Textstufe stufe="textKlein">
                  <strong>Handlungsempfehlung</strong>
                </Textstufe>
                <Textstufe als="p" stufe="textKlein">
                  {hinweis}
                </Textstufe>
              </Stapel>
            )}
          </Stapel>
        </div>
      )}
      {ninaId && <NinaVollmeldung id={ninaId} />}
    </>
  );
}

/**
 * Schnellweg „Als maßgeblichen Pegel festlegen".
 *
 * Ist die Station schon maßgeblich, steht das als Marke statt des Knopfs, auch ohne Schreibrecht.
 * Der Knopf braucht Schreibrecht und eine `uuid`; ohne `uuid` entfällt der Block.
 *
 * Bei fünf festgelegten Pegeln steht der Knopf gesperrt mit Grund und Weg in die Einstellungen,
 * statt zu verschwinden (der Server lehnte einen sechsten mit 422 ab). Gespeichert wird per POST
 * (hinten anfügen, idempotent); die Antwort ist die volle Liste und landet per `setQueryData` im
 * gemeinsamen Cache von Dashboard, Überblick und Einstellungen.
 */
function PegelFestlegen({
  einsatzId,
  darfSchreiben,
  uuid,
  name,
  gewaesser,
}: {
  einsatzId: number;
  darfSchreiben: boolean;
  uuid: string;
  name: string;
  gewaesser: string | null;
}) {
  const { token } = theme.useToken();
  const { message } = App.useApp();
  const qc = useQueryClient();
  const pegelQ = useQuery(pegelAbfrage(einsatzId));
  // Kein `onError`-Toast: der Fehler bleibt im Panel stehen.
  const festlegen = useMutation({
    // Derselbe Scope wie die Einstellungssektion: Schreibwege auf die Liste laufen nacheinander.
    scope: pegelSchreibScope(einsatzId),
    mutationFn: () => fuegePegelHinzu(einsatzId, { station_uuid: uuid, name, gewaesser }),
    onSuccess: (liste) => {
      qc.setQueryData(einsatzKeys.pegel(einsatzId), liste);
      // Auslöser der Lagekennzahl am Einsatz — siehe `EinsatzPegel`.
      void qc.invalidateQueries({ queryKey: einsatzKeys.einsatz(einsatzId) });
      message.success('Als maßgeblicher Pegel festgelegt');
    },
  });

  const liste = pegelQ.data;
  const index = liste?.findIndex((e) => e.station_uuid.toLowerCase() === uuid) ?? -1;
  const abstand = { marginTop: token.marginSM };

  if (index >= 0) {
    return (
      <div style={abstand} data-lfh="pegel-massgeblich">
        <Marke>{index === 0 ? 'maßgeblicher Pegel · Leitpegel' : 'maßgeblicher Pegel'}</Marke>
      </div>
    );
  }
  if (!darfSchreiben) return null;

  const voll = (liste?.length ?? 0) >= PEGEL_MAX;
  return (
    <div style={abstand}>
      <Stapel abstand="xs">
        <SpeicherFehler fehler={festlegen.error} />
        <Button
          // Solange die Liste lädt, ist weder „schon maßgeblich" noch „voll" bekannt.
          disabled={pegelQ.isLoading || voll}
          loading={festlegen.isPending}
          onClick={() => festlegen.mutate()}
        >
          Als maßgeblichen Pegel festlegen
        </Button>
        {voll && (
          <Typography.Text type="secondary" data-lfh="pegel-grenze">
            {`Höchstens ${PEGEL_MAX} Pegel · `}
            <Link to={einsatzEinstellungenPfad(einsatzId, 'pegel')}>Pegel verwalten</Link>
          </Typography.Text>
        )}
      </Stapel>
    </div>
  );
}

function PegelInhalt({
  p,
  pegelBezug,
}: {
  p: Record<string, unknown>;
  pegelBezug?: FachebenenInspectorProps['pegelBezug'];
}) {
  const fmtZeit = useFmtZeit();
  const { token } = theme.useToken();
  const wert = s(p.wert);
  const einheit = s(p.einheit);
  // PEGELONLINE `stateMnwMhw`; nur aussagekräftige Werte werden ein Tag (Vertrag `pegelZustand`).
  const zust = pegelZustandVon(s(p.zustand));
  const km = s(p.km);
  return (
    <>
      {wert ? (
        // Keine Überschrift, sondern ein Messwert („320 cm" + Zustand): ein `<h3>` wäre eine
        // Gliederungsebene, die es nicht gibt. Das visuelle Gewicht kommt aus `fontSizeHeading3`.
        <Typography.Text
          strong
          style={{
            display: 'block',
            fontSize: token.fontSizeHeading3,
            marginBottom: token.marginXS,
          }}
        >
          {wert}
          {einheit ? ` ${einheit}` : ''} {zust ? <Status darstellung={zust} /> : null}
        </Typography.Text>
      ) : (
        <Typography.Paragraph type="secondary" style={{ marginBottom: token.marginSM }}>
          Kein aktueller Messwert
        </Typography.Paragraph>
      )}
      <Descriptions column={1}>
        {s(p.gewaesser) && <Descriptions.Item label="Gewässer">{s(p.gewaesser)}</Descriptions.Item>}
        {km && <Descriptions.Item label="Stations-km">{km}</Descriptions.Item>}
        {fmtZeit(s(p.zeitpunkt)) && (
          <Descriptions.Item label="Stand">{fmtZeit(s(p.zeitpunkt))}</Descriptions.Item>
        )}
      </Descriptions>
      {pegelBezug && s(p.uuid) && (
        <PegelFestlegen
          // `key` aus der Station: ein anderer Punkt hängt einen frischen Block ein, sonst trüge
          // Station B Fehler und Ladezustand der Mutation von A.
          key={s(p.uuid)!.toLowerCase()}
          einsatzId={pegelBezug.einsatzId}
          darfSchreiben={pegelBezug.darfSchreiben}
          uuid={s(p.uuid)!.toLowerCase()}
          name={pick(p, 'titel', 'name') ?? 'Pegel'}
          gewaesser={s(p.gewaesser)}
        />
      )}
    </>
  );
}

function KritisInhalt({ p }: { p: Record<string, unknown> }) {
  const { token } = theme.useToken();
  const kategorie = s(p.kategorie);
  const telefon = s(p.telefon);
  const websiteRoh = s(p.website);
  const website = nurWeb(websiteRoh);
  const notaufnahme = s(p.notaufnahme);
  return (
    <>
      {kategorie && (
        <Marke style={{ marginBottom: token.marginSM }}>{kategorieLabel(kategorie)}</Marke>
      )}
      <Descriptions column={1}>
        {s(p.adresse) && <Descriptions.Item label="Adresse">{s(p.adresse)}</Descriptions.Item>}
        {s(p.betreiber) && (
          <Descriptions.Item label="Betreiber">{s(p.betreiber)}</Descriptions.Item>
        )}
        {telefon && (
          <Descriptions.Item label="Telefon">
            <a href={`tel:${telefon.replace(/\s/g, '')}`}>{telefon}</a>
          </Descriptions.Item>
        )}
        {websiteRoh && (
          <Descriptions.Item label="Web">
            {website ? (
              <a href={website} target="_blank" rel="noreferrer noopener">
                {website}
              </a>
            ) : (
              websiteRoh
            )}
          </Descriptions.Item>
        )}
        {notaufnahme && <Descriptions.Item label="Notaufnahme">{notaufnahme}</Descriptions.Item>}
      </Descriptions>
    </>
  );
}

/**
 * LHP-Pegel: Name, Nummer und Meldeklasse, wie `get_lagepegel.php` sie liefert. Der Wasserstand
 * fehlt bewusst — er käme aus einem Token-gesicherten Einzelabruf je Pegel
 * (`docs/fachebenen-quellen.md`); dafür gibt es die PEGELONLINE-Ebene.
 */
function HochwasserInhalt({ p }: { p: Record<string, unknown> }) {
  const { token } = theme.useToken();
  return (
    <>
      <div style={{ marginBottom: token.marginSM }}>
        <Status darstellung={hochwasserDarstellung(p.klasse)} />
      </div>
      <Descriptions column={1}>
        {s(p.pgnr) && <Descriptions.Item label="Pegelnummer">{s(p.pgnr)}</Descriptions.Item>}
      </Descriptions>
    </>
  );
}

/** Drei Nachkommastellen im deutschen Format — so führt auch ODL-Info die Werte. */
const ODL_ZAHL = new Intl.NumberFormat('de-DE', {
  minimumFractionDigits: 3,
  maximumFractionDigits: 3,
});

/**
 * Faktor mit zwei Nachkommastellen: mit einer stünde „1,5 ×" neben „unauffällig" (1,48) wie neben
 * „erhöht" (1,52).
 */
const ODL_FAKTOR = new Intl.NumberFormat('de-DE', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/**
 * Die Stufen sind eine Einteilung des Lifeline Hub (Faktor 3 nennt das BfS als Anlass zur
 * Besorgnis), keine amtliche Grenze; Regen hebt die Werte kurzzeitig bis zum Dreifachen.
 */
const ODL_VORBEHALT = 'Kein amtlicher Schwellenwert · Regen kann kurzzeitig bis 3 × anheben';

/**
 * ODL-Sonde des BfS: Stufe als Wort, Messwert, Messende, Betriebsstatus — und der Maßstab der
 * Stufe: der Standort-Grundpegel der Sonde (Faktor-Schwellen 1,5 × / 3 ×) oder, ohne ihn, die
 * absoluten Bänder am natürlichen Bereich. Die Stufen-Labels nennen keinen Maßstab, deshalb steht
 * er hier.
 *
 * Der Vorbehalt ist Pflicht: das BfS veröffentlicht keinen Schwellenwert für „erhöht", ohne ihn
 * läse sich die Stufe wie eine amtliche Bewertung. Ohne Messwert „kein Messwert" und kein Messende.
 * Das Messende steht auch bei aktuellen Werten, weil manche Sonden Stunden hinterher hängen und es
 * keine Stufe „veraltet" gibt.
 */
function OdlInhalt({ p }: { p: Record<string, unknown> }) {
  const fmtZeit = useFmtZeit();
  const { token } = theme.useToken();
  const wert = typeof p.wert === 'number' && Number.isFinite(p.wert) ? p.wert : null;
  const messende = fmtZeit(s(p.messende));
  const grundlage = odlGrundlage(p);
  const hinweisStil = { marginTop: token.marginXS };
  return (
    <>
      <div style={{ marginBottom: token.marginSM }}>
        <Status darstellung={odlDarstellung(p.stufe)} />
      </div>
      <Descriptions column={1}>
        <Descriptions.Item label="Ortsdosisleistung">
          {wert === null ? 'kein Messwert' : `${ODL_ZAHL.format(wert)} ${s(p.einheit) ?? 'µSv/h'}`}
        </Descriptions.Item>
        {messende && <Descriptions.Item label="Messende">{messende}</Descriptions.Item>}
        {grundlage.art === 'standort' && (
          <>
            <Descriptions.Item label="Grundpegel">
              {`${ODL_ZAHL.format(grundlage.grundpegel)} µSv/h`}
              {grundlage.stand && ` (Stand ${fmtZeit(grundlage.stand)})`}
            </Descriptions.Item>
            <Descriptions.Item label="Faktor">{`${ODL_FAKTOR.format(grundlage.faktor)} ×`}</Descriptions.Item>
          </>
        )}
        {s(p.betrieb) && <Descriptions.Item label="Sonde">{s(p.betrieb)}</Descriptions.Item>}
        {/* Ortsnamen sind nicht eindeutig; die Kennung ist der Schlüssel für ODL-Info. */}
        {s(p.kennung) && <Descriptions.Item label="Kennung">{s(p.kennung)}</Descriptions.Item>}
      </Descriptions>
      {grundlage.art === 'standort' ? (
        <div style={hinweisStil}>
          <Textstufe als="p" stufe="textKlein" ton="gedaempft">
            Stufen nach Grundpegel: über 1,5 × erhöht, über 3 × stark erhöht
            <br />
            {ODL_VORBEHALT}
          </Textstufe>
        </div>
      ) : (
        <div style={hinweisStil}>
          <Textstufe als="p" stufe="textKlein" ton="gedaempft">
            {/* Nur mit Messwert in µSv/h — unter fremder Einheit wird nicht bewertet. */}
            {wert !== null && (s(p.einheit) ?? 'µSv/h') === 'µSv/h' && 'Kein Grundpegel · '}
            Stufen nach natürlichem Bereich (0,05–0,2 µSv/h, BfS)
            <br />
            {ODL_VORBEHALT}
          </Textstufe>
        </div>
      )}
    </>
  );
}

/**
 * Komponenten der Luftqualitätsebene in Anzeigereihenfolge. Die Schlüssel stammen aus dem
 * Normalisierer (`karte::luftqualitaet::komponenten_etikett`, Property `wert_<schluessel>`);
 * unbekannte Komponenten kommen dort als `wert_k<id>` und werden unten angehängt.
 */
const LUFT_KOMPONENTEN: [string, string][] = [
  ['no2', 'NO₂'],
  ['o3', 'O₃'],
  ['pm10', 'PM10'],
  ['pm25', 'PM2,5'],
  ['so2', 'SO₂'],
  ['co', 'CO'],
];

/**
 * UBA-Luftmessstation. Die Stufe steht als Wort (zweiter Kanal), der Messzeitpunkt immer — die
 * Quelle hinkt rund zwei Stunden hinterher. Die unvollständige Datenbasis ist ein Hinweis, keine
 * Farbe: der Index bleibt die amtliche Einstufung.
 */
function LuftqualitaetInhalt({ p }: { p: Record<string, unknown> }) {
  const fmtZeit = useFmtZeit();
  const { token } = theme.useToken();
  const unbekannt = Object.keys(p)
    .filter((k) => /^wert_k\d+$/.test(k))
    .sort()
    .map((k): [string, string] => [k.slice(5), `Komponente ${k.slice(6)}`]);
  const werte = [...LUFT_KOMPONENTEN, ...unbekannt]
    .map(([schluessel, name]) => {
      const wert = s(p[`wert_${schluessel}`]);
      const einheit = s(p[`einheit_${schluessel}`]);
      return wert ? { name, text: einheit ? `${wert} ${einheit}` : wert } : null;
    })
    .filter((w): w is { name: string; text: string } => w !== null);
  const art = [s(p.stationstyp), s(p.umgebung)].filter(Boolean).join(' · ');
  return (
    <>
      <div style={{ marginBottom: token.marginSM }}>
        <Status darstellung={luftqualitaetDarstellung(p.klasse)} />
      </div>
      <Descriptions column={1}>
        {s(p.leitschadstoff) && (
          <Descriptions.Item label="Leitschadstoff">{s(p.leitschadstoff)}</Descriptions.Item>
        )}
        {werte.map((w) => (
          <Descriptions.Item key={w.name} label={w.name}>
            {w.text}
          </Descriptions.Item>
        ))}
        {fmtZeit(s(p.zeitpunkt)) && (
          <Descriptions.Item label="Messzeitpunkt">{fmtZeit(s(p.zeitpunkt))}</Descriptions.Item>
        )}
        {s(p.ort) && <Descriptions.Item label="Ort">{s(p.ort)}</Descriptions.Item>}
        {art && <Descriptions.Item label="Station">{art}</Descriptions.Item>}
        {s(p.code) && <Descriptions.Item label="Stationscode">{s(p.code)}</Descriptions.Item>}
      </Descriptions>
      {p.unvollstaendig === true && (
        <Typography.Text type="secondary">Unvollständige Datenbasis</Typography.Text>
      )}
    </>
  );
}

/**
 * Standbild einer BAB-Webcam. Eigene Komponente, damit der Aufrufer sie per `key={bild}`
 * zurücksetzt: der Fehlerzustand gehört zu genau diesem Bild — auch auf dem Weg A → B → A beginnt
 * jeder Wechsel mit einem frischen Versuch.
 *
 * Das Bild kommt direkt vom Betreiber, nicht über den Backend-Proxy, und lädt ohne Internet am
 * Gerät nicht. Statt eines kaputten Bildsymbols steht dann der Grund.
 */
function WebcamStandbild({ bild, titel }: { bild: string; titel: string | null }) {
  const { token } = theme.useToken();
  const [fehler, setFehler] = useState(false);
  if (fehler) {
    return (
      <div style={{ marginBottom: token.marginSM }}>
        <Textstufe als="p" stufe="textKlein" ton="gedaempft">
          Standbild nicht abrufbar
        </Textstufe>
      </div>
    );
  }
  return (
    /* Ohne feste Höhe — die Betreiber liefern verschiedene Seitenverhältnisse. */
    <img
      src={bild}
      alt={titel ? `Webcam-Standbild: ${titel}` : 'Webcam-Standbild'}
      onError={() => setFehler(true)}
      style={{
        width: '100%',
        display: 'block',
        marginBottom: token.marginXS,
        borderRadius: token.borderRadius,
      }}
    />
  );
}

const LINSE: Record<string, string> = {
  thermal: 'Wärmebild',
  wide: 'Weitwinkel',
  zoom: 'Zoom',
  visible: 'Sichtbild',
};

/**
 * Vorschau eines Drohnenfotos vom Backend-Proxy, nach `WebcamStandbild`: ohne Fehlerzustand ein
 * nacktes `<img>`, bei einem Fehler der Grund statt eines kaputten Bildsymbols.
 */
function DrohnenFotoVorschau({ src }: { src: string }) {
  const { token } = theme.useToken();
  const [fehler, setFehler] = useState(false);
  if (fehler) {
    return (
      <div style={{ marginBottom: token.marginSM }}>
        <Textstufe als="p" stufe="textKlein" ton="gedaempft">
          Vorschau nicht abrufbar
        </Textstufe>
      </div>
    );
  }
  return (
    <img
      src={src}
      alt="Drohnenfoto"
      onError={() => setFehler(true)}
      style={{
        width: '100%',
        display: 'block',
        marginBottom: token.marginXS,
        borderRadius: token.borderRadius,
      }}
    />
  );
}

function DrohnenFotoInhalt({ p, einsatzId }: { p: Record<string, unknown>; einsatzId?: number }) {
  const fmtZeit = useFmtZeit();
  const key = s(p.key);
  const src = key && einsatzId != null ? drohnenFotoVorschauPfad(einsatzId, key) : null;
  const linse = LINSE[s(p.lens) ?? ''] ?? 'unbekannte Linse';
  const aufnahme =
    typeof p.taken_at_ms === 'number' ? fmtZeit(new Date(p.taken_at_ms).toISOString()) : null;
  const blick = typeof p.heading_deg === 'number' ? `${Math.round(p.heading_deg)}°` : null;
  return (
    <>
      {/* Der `key` bindet den Fehlerzustand an die URL — jedes andere Foto beginnt frisch. */}
      {src && <DrohnenFotoVorschau key={src} src={src} />}
      <Descriptions column={1}>
        <Descriptions.Item label="Linse">{linse}</Descriptions.Item>
        {aufnahme && <Descriptions.Item label="Aufnahme">{aufnahme}</Descriptions.Item>}
        {blick && <Descriptions.Item label="Blickrichtung">{blick}</Descriptions.Item>}
      </Descriptions>
    </>
  );
}

const ANLAGENART: Record<EnergieAnlagenart, string> = {
  kohle: 'Kohle',
  gas: 'Gas',
  oel: 'Öl',
  kern: 'Kernenergie',
  abfall: 'Abfall',
  wasser: 'Wasser',
  wind: 'Wind',
  solar: 'Solar',
  biomasse: 'Biomasse',
  speicher: 'Speicher',
  sonstige: 'Sonstige',
};

const HERKUNFT: Record<string, string> = {
  osm: 'OpenStreetMap',
  mastr: 'Marktstammdatenregister',
  'osm+mastr': 'OpenStreetMap + Marktstammdatenregister',
};

const MW = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 1 });

/**
 * Energieanlage. Die Properties tragen `null` für Unbekanntes, MapLibre liefert sie beim Klick aber
 * als fehlend — beide Fälle laufen denselben Weg.
 */
function EnergieInhalt({ p }: { p: Record<string, unknown> }) {
  const artRoh = s(p.anlagenart);
  const art = artRoh ? (ANLAGENART[artRoh as EnergieAnlagenart] ?? artRoh) : null;
  // Nur eine echte Zahl ist ein Messwert; sonst ist „unbekannt" die ehrliche Antwort.
  const mw =
    typeof p.leistung_mw === 'number' && Number.isFinite(p.leistung_mw) ? p.leistung_mw : null;
  const herkunftRoh = s(p.herkunft);
  const herkunft = herkunftRoh ? (HERKUNFT[herkunftRoh] ?? herkunftRoh) : null;
  const ausMastr = herkunftRoh === 'mastr' || herkunftRoh === 'osm+mastr';
  const mastrNummer = ausMastr ? s(p.mastr_nummer) : null;
  // Die ID geht in einen URL-Pfad — nur eine positive Ganzzahl wird ein Link.
  const mastrId =
    typeof p.mastr_id === 'number' && Number.isInteger(p.mastr_id) && p.mastr_id > 0
      ? p.mastr_id
      : null;
  const einheiten =
    ausMastr && typeof p.mastr_einheiten === 'number' && p.mastr_einheiten > 1
      ? p.mastr_einheiten
      : null;
  return (
    <Descriptions column={1}>
      {art && <Descriptions.Item label="Anlagenart">{art}</Descriptions.Item>}
      <Descriptions.Item label="Leistung">
        {mw != null ? `${MW.format(mw)} MW` : 'unbekannt'}
      </Descriptions.Item>
      {s(p.betreiber) && <Descriptions.Item label="Betreiber">{s(p.betreiber)}</Descriptions.Item>}
      {s(p.betriebsstatus) && (
        <Descriptions.Item label="Betriebsstatus">{s(p.betriebsstatus)}</Descriptions.Item>
      )}
      {herkunft && <Descriptions.Item label="Herkunft">{herkunft}</Descriptions.Item>}
      {mastrNummer && (
        <Descriptions.Item label="MaStR-Nummer">
          {mastrId != null ? (
            <a
              href={`https://www.marktstammdatenregister.de/MaStR/Einheit/Detail/IndexOeffentlich/${mastrId}`}
              target="_blank"
              rel="noreferrer noopener"
            >
              {mastrNummer}
            </a>
          ) : (
            mastrNummer
          )}
        </Descriptions.Item>
      )}
      {/* Mehrere Einheiten summieren ihre Leistung; die Nummer ist die der größten Einheit. Die
          Zahl sagt, dass Leistung und Nummer nicht dieselbe Einheit beschreiben. */}
      {einheiten != null && (
        <Descriptions.Item label="MaStR-Einheiten">{einheiten}</Descriptions.Item>
      )}
      {/* Die Lizenz verlangt die Nennung samt Verweis auf den Lizenztext; die Attributionszeile
          der Karte kann keinen Link tragen. */}
      {ausMastr && (
        <Descriptions.Item label="Lizenz">
          <a href="https://www.govdata.de/dl-de/by-2-0" target="_blank" rel="noopener noreferrer">
            Datenlizenz Deutschland – Namensnennung – Version 2.0
          </a>
        </Descriptions.Item>
      )}
    </Descriptions>
  );
}

function AutobahnInhalt({ p }: { p: Record<string, unknown> }) {
  const fmtZeit = useFmtZeit();
  const { token } = theme.useToken();
  const kategorie = s(p.kategorie);
  const bild = nurWeb(s(p.bild));
  const link = nurWeb(s(p.link));
  const beschreibung = s(p.beschreibung);
  const titel = s(p.titel);
  return (
    <>
      {kategorie && (
        <Marke style={{ marginBottom: token.marginSM }}>{kategorieLabel(kategorie)}</Marke>
      )}
      {/* Der `key` bindet den Fehlerzustand an die URL — jeder Kamerawechsel beginnt frisch. */}
      {bild && <WebcamStandbild key={bild} bild={bild} titel={titel} />}
      <Descriptions column={1}>
        {s(p.strasse) && <Descriptions.Item label="Autobahn">{s(p.strasse)}</Descriptions.Item>}
        {s(p.richtung) && <Descriptions.Item label="Richtung">{s(p.richtung)}</Descriptions.Item>}
        {fmtZeit(s(p.beginn)) && (
          <Descriptions.Item label="Beginn">{fmtZeit(s(p.beginn))}</Descriptions.Item>
        )}
        {s(p.betreiber) && (
          <Descriptions.Item label="Betreiber">{s(p.betreiber)}</Descriptions.Item>
        )}
      </Descriptions>
      {/* Der Normalisierer fügt die Zeilen von `description` mit \n zusammen; `pre-line` hält
          die Gliederung. */}
      {beschreibung && (
        <Typography.Paragraph
          style={{
            marginTop: token.marginSM,
            marginBottom: 0,
            ...schriftStil('textKlein'),
            whiteSpace: 'pre-line',
          }}
        >
          {beschreibung}
        </Typography.Paragraph>
      )}
      {/* Eigenständige Aktion und damit Bedienziel: ein antd-`Button type="link"` erbt
          `controlHeight`, ein nackter `<a>` nicht. Die `telefon`/`website`-Anker im KRITIS-Zweig
          bleiben nackt — sie stehen als Wert in einer `Descriptions`-Zeile. */}
      {link && (
        <div style={{ marginTop: token.marginSM }}>
          <Button
            type="link"
            href={link}
            target="_blank"
            rel="noreferrer noopener"
            style={{ paddingInline: 0 }}
          >
            Livebild beim Betreiber öffnen
          </Button>
        </div>
      )}
    </>
  );
}

/** Produktarten von Copernicus Rapid Mapping. */
const COPERNICUS_PRODUKT: Record<string, string> = {
  DEL: 'Abgrenzung',
  GRA: 'Schadensklassen',
  FEP: 'Erste Abschätzung',
};

/** Ebenenarten (Wire-Wort `art`, `karte::copernicus::EbenenArt`). */
const COPERNICUS_EBENE: Record<string, string> = {
  gebiet: 'Auswertungsgebiet',
  beobachtet: 'Betroffene Fläche',
  max_ausdehnung: 'Größte Ausdehnung',
  wassertiefe: 'Wassertiefe',
  nicht_ausgewertet: 'Nicht ausgewertet',
  schaden_gebaeude: 'Gebäude',
  schaden_verkehr: 'Verkehrsweg',
};

/**
 * Copernicus EMS (LLH-1200): Klasse als Wort, Herkunft (Aktivierung, Gebiet, Produkt, Version),
 * Aufnahme mit Sensor und Lieferung. Eine Aufnahme über 24 h steht als Warnung oben: das Bild ist
 * der Stand, nicht der Abruf. Die Beschreibung der Quelle bleibt englisch und unverändert.
 */
function CopernicusInhalt({ p }: { p: Record<string, unknown> }) {
  const fmtZeit = useFmtZeit();
  const jetzt = useMinutenTakt();
  const { token } = theme.useToken();
  const { rollen } = useRollen();
  const emsr = s(p.emsr);
  const aufnahme = s(p.aufnahme);
  const sensor = s(p.sensor);
  const produkt = s(p.produkt);
  const monitoring = typeof p.monitoring === 'number' ? p.monitoring : 0;
  const version = typeof p.version === 'number' ? p.version : null;
  const produktText = produkt
    ? [
        COPERNICUS_PRODUKT[produkt] ?? produkt,
        monitoring > 0 ? `Monitoring ${monitoring}` : null,
        version !== null ? `Version ${version}` : null,
      ]
        .filter(Boolean)
        .join(' · ')
    : null;
  const ebene = s(p.art);
  return (
    <>
      <div style={{ marginBottom: token.marginSM }}>
        <Status darstellung={copernicusDarstellung(p.klasse)} />
      </div>
      {isCopernicusAufnahmeAlt(aufnahme ?? s(p.geliefert), jetzt) && (
        <div
          data-lfh="copernicus-aufnahme-alt"
          style={{ marginBottom: token.marginSM, color: rollen.achtungText }}
        >
          {/* Altbestand (LLH-2022): ohne Aufnahmezeit zählt die Lieferung. */}
          <span aria-hidden="true">⧖ </span>
          {aufnahme ? 'Aufnahme' : 'Lieferung'} älter als 24 h
        </div>
      )}
      <Descriptions column={1}>
        {emsr && (
          <Descriptions.Item label="Aktivierung">
            {[emsr, s(p.aktivierung)].filter(Boolean).join(' · ')}
          </Descriptions.Item>
        )}
        {s(p.gebiet) && <Descriptions.Item label="Gebiet">{s(p.gebiet)}</Descriptions.Item>}
        {ebene && (
          <Descriptions.Item label="Ebene">{COPERNICUS_EBENE[ebene] ?? ebene}</Descriptions.Item>
        )}
        {produktText && <Descriptions.Item label="Produkt">{produktText}</Descriptions.Item>}
        {aufnahme && (
          <Descriptions.Item label="Aufnahme">
            {[fmtZeit(aufnahme), sensor].filter(Boolean).join(' · ')}
          </Descriptions.Item>
        )}
        {s(p.geliefert) && (
          <Descriptions.Item label="Geliefert">{fmtZeit(s(p.geliefert))}</Descriptions.Item>
        )}
        {s(p.beschreibung) && (
          <Descriptions.Item label="Angabe der Quelle">{s(p.beschreibung)}</Descriptions.Item>
        )}
      </Descriptions>
      {emsr && (
        <div style={{ marginTop: token.marginSM }}>
          <Button
            type="link"
            href={`https://mapping.emergency.copernicus.eu/activations/${encodeURIComponent(emsr)}/`}
            target="_blank"
            rel="noreferrer noopener"
            style={{ paddingInline: 0 }}
          >
            Aktivierung bei Copernicus öffnen
          </Button>
        </div>
      )}
    </>
  );
}

/** Detailpanel für ein angeklicktes Fachebenen-Objekt (read-only externe Daten). */
export default function FachebenenInspector({
  quelle,
  properties,
  geometrie,
  onSchliessen,
  pegelBezug,
  einsatzId,
  abgerufen,
}: FachebenenInspectorProps) {
  const { token } = theme.useToken();
  const p = properties;
  const istWarnung = quelle === 'nina' || quelle === 'dwd';
  // Fläche/Umfang/Länge rein clientseitig aus der (auch Multi-*) Geometrie.
  const kennzahlen = geometrie ? geoKennzahlen(geometrie) : null;

  // Der Text kommt aus `fachebeneTitel` (auch für das Flächen-Auswahlmenü); nur hier ein Icon.
  const titelText = fachebeneTitel(quelle, p);
  const TitelIcon =
    quelle === 'dwd'
      ? wetterIcon(pick(p, 'EC_GROUP'), pick(p, 'EVENT', 'event'))
      : quelle === 'nina'
        ? IconWarndreieck
        : null;
  const titel = TitelIcon ? (
    <Stapel als="span" richtung="zeile" abstand="xs" ausrichten="mitte">
      <TitelIcon />
      {titelText}
    </Stapel>
  ) : (
    titelText
  );

  return (
    <KartenDetailCard
      titel={titel}
      akzentFarbe={
        // Die Luftqualitätsebene färbt je Station nach Stufe; der Akzent folgt dem, sonst hätte
        // eine Farbe zwei Bedeutungen.
        quelle === 'luftqualitaet'
          ? rollenFarbe(luftqualitaetDarstellung(p.klasse).rolle, token)
          : quelle === 'copernicus'
            ? rollenFarbe(copernicusDarstellung(p.klasse).rolle, token)
            : fachebeneFarbe(quelle, token)
      }
      onSchliessen={onSchliessen}
    >
      {istWarnung ? (
        <WarnungInhalt p={p} ebene={quelle} />
      ) : quelle === 'pegelonline' ? (
        <PegelInhalt p={p} pegelBezug={pegelBezug} />
      ) : quelle === 'hochwasser' ? (
        <HochwasserInhalt p={p} />
      ) : quelle === 'odl' ? (
        <OdlInhalt p={p} />
      ) : quelle === 'autobahn' ? (
        <AutobahnInhalt p={p} />
      ) : quelle === 'luftqualitaet' ? (
        <LuftqualitaetInhalt p={p} />
      ) : quelle === 'copernicus' ? (
        <CopernicusInhalt p={p} />
      ) : quelle === 'drohne' ? (
        <DrohnenFotoInhalt p={p} einsatzId={einsatzId} />
      ) : quelle === 'energie' ? (
        // Vor dem Rückfall: jede unbekannte Quelle fiele sonst still in den KRITIS-Inhalt.
        <EnergieInhalt p={p} />
      ) : (
        <KritisInhalt p={p} />
      )}
      {/* Abstand am Aufrufer: `GeoKennzahlen` rendert ohne Kennzahlen nichts, ein Wrapper mit
          `marginTop` hinterließe eine Lücke. */}
      {kennzahlen && (
        <div style={{ marginTop: token.marginSM }}>
          <GeoKennzahlen kennzahlen={kennzahlen} />
        </div>
      )}
      {abgerufen && (
        <div style={{ marginTop: token.marginSM }}>
          <FachebeneStand
            quelle={quelle}
            abgerufen={abgerufen}
            form="voll"
            praefix="Ebene abgerufen"
          />
        </div>
      )}
    </KartenDetailCard>
  );
}
