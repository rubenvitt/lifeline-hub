import { App, AutoComplete, Breadcrumb, Button, Input, InputNumber, Popconfirm } from 'antd';
import { ZeitpunktEingabe } from '../anzeige/ZeitpunktEingabe';
import { alsBackendZeit, alsZeitpunkt } from '../anzeige/zeitEingabe';
import ZeitAnzeige from '../anzeige/ZeitAnzeige';
import { Select } from '../components/Select';
import EinsatzSeite, { type Nebenweg } from '../components/EinsatzSeite';
import {
  Augenbraue,
  Paneel,
  kennzahlenbandStil,
  monoStil,
  paneelZeileStil,
  useRollen,
} from '../components/instrument';
import { SeitenFehler, SeitenSkeleton } from '../components/SeitenZustand';
import KoordinatenAnzeige from '../anzeige/KoordinatenAnzeige';
import KoordinatenEingabe from '../anzeige/KoordinatenEingabe';
import { istLatLon, type KoordinatenWert } from '../anzeige/koordinatenWert';
import { Link, useNavigate, useParams } from 'react-router';
import { einsatzberichtPfad, einsatzEinstellungenPfad } from '../routing/deeplinks';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import dayjs, { type Dayjs } from 'dayjs';
import utc from 'dayjs/plugin/utc';
import {
  ladeEinsatz,
  ladeFuehrungsstelle,
  ladeMitglieder,
  ladeModulFreigaben,
  patcheEinsatz,
  patcheFuehrungsstelle,
  schliesseEinsatzAb,
  type KopfdatenPatch,
} from '../api/einsaetze';
import { listeStichwortVorschlaege } from '../api/stichwortVorschlaege';
import { einsatzKeys, globalKeys } from '../api/queryKeys';
import { RechteHinweis, SpeicherFehler } from '../components/SpeicherHinweis';
import { NUR_LEITUNG_FUEHRUNG_ORG_ADMIN } from '../components/nurAnsicht';
import { InlineAngabe } from '../components/InlineAngabe';
import { useViewport } from '../components/useViewport';
import { useAuth } from '../auth/AuthContext';
import { darfEinsatzLeiten, darfEinsatzVerwalten } from '../einsatz/schreibrecht';
import type {
  EinsatzAnzeige,
  Einsatzart,
  EinsatzFahrzeug,
  Fuehrungsstelle,
  FuehrungsstellePatch,
} from '../api/types';
import { listeEinsatzFahrzeuge } from '../api/einsatzFahrzeuge';
import { abrufZustand, type AbrufZustand } from '../api/abrufZustand';
import { ZUSTAND_GRUND } from '../stab/funkplan';
import PaneelZustand from '../components/instrument/PaneelZustand';
import SprechgruppenPicker from '../components/SprechgruppenPicker';
import {
  KOMMUNIKATIONSMITTEL_OPTIONEN,
  kommunikationsmittelLabel,
  mitBetriebsart,
  teileSprechgruppen,
} from '../components/kommunikationsmittel';
import { leerZuNull } from '../api/patchTriState';
import { EINSATZART_LABELS, EINSATZART_OPTIONEN } from '../einsatz/einsatzart';
import { istKeyFreigegeben, modulName } from '../einsatz/modulRegistry';

// Idempotent (mehrfaches extend ist unschädlich) — robust bei isoliertem Import.
dayjs.extend(utc);

/**
 * Zeitpunkte gleich, wenn derselbe Instant (LFH-472, D5) — nicht dasselbe Objekt: jeder Render
 * baut über `alsZeitpunkt` ein frisches Dayjs, und ein Neuabruf zwischen Öffnen und Speichern
 * machte sonst aus „unverändert" einen PATCH.
 */
export function gleicherZeitpunkt(a: Dayjs | null, b: Dayjs | null): boolean {
  return a === null || b === null ? a === b : a.valueOf() === b.valueOf();
}

/** Leer ist ein Text, der nach dem Trimmen nichts übrig lässt — wie `leerZuNull` beim Senden. */
function leererText(w: string): boolean {
  return w.trim() === '';
}

/**
 * Speichert EIN Feld der Kopfdaten (LFH-472). `etikett` nennt die Angabe in der Erfolgsmeldung;
 * der Patch trägt genau einen Schlüssel.
 */
type FeldSpeichern = (etikett: string, patch: KopfdatenPatch) => Promise<EinsatzAnzeige>;

/** Eine freie Textangabe als Zeile (Stichwort ausgenommen: es hat Vorschläge). */
function TextAngabe({
  etikett,
  wert,
  darfSchreiben,
  mono,
  mehrzeilig,
  pflicht,
  speichern,
  zuPatch,
}: {
  etikett: string;
  wert: string | null | undefined;
  darfSchreiben: boolean;
  mono?: boolean;
  mehrzeilig?: boolean;
  /** Leer abgelehnt: kein Senden, alter Wert, Hinweis an der Zeile (Bezeichnung, LFH-1170). */
  pflicht?: boolean;
  speichern: FeldSpeichern;
  zuPatch: (w: string | null) => KopfdatenPatch;
}) {
  const text = wert ?? '';
  return (
    <InlineAngabe<string>
      etikett={etikett}
      wert={text}
      anzeige={mono ? <span style={monoStil(13)}>{text}</span> : text}
      leer={leererText}
      gleich={(a, b) => a.trim() === b.trim()}
      darfSchreiben={darfSchreiben}
      mehrzeilig={mehrzeilig}
      pflicht={pflicht}
      onSpeichern={(w) => speichern(etikett, zuPatch(leerZuNull(w)))}
      eingabe={({ feld, value, onChange }) =>
        mehrzeilig ? (
          <Input.TextArea
            {...feld}
            rows={3}
            value={value}
            onChange={(e) => onChange(e.target.value)}
          />
        ) : (
          <Input {...feld} value={value} onChange={(e) => onChange(e.target.value)} />
        )
      }
    />
  );
}

/**
 * Ein Zeitpunkt als Zeile. Hin über `alsZeitpunkt`, zurück über `alsBackendZeit`; das Feld zeigt
 * und liest die Anzeigezone, in der auch `ZeitAnzeige` daneben steht (LFH-692).
 */
function ZeitpunktAngabe({
  etikett,
  wire,
  pflicht,
  darfSchreiben,
  speichern,
  zuPatch,
}: {
  etikett: string;
  wire: string | null | undefined;
  pflicht?: boolean;
  darfSchreiben: boolean;
  speichern: FeldSpeichern;
  zuPatch: (wire: string | null) => KopfdatenPatch;
}) {
  return (
    <InlineAngabe<Dayjs | null>
      etikett={etikett}
      wert={alsZeitpunkt(wire) ?? null}
      anzeige={wire ? <ZeitAnzeige wert={wire} format="dtgVoll" /> : null}
      leer={(d) => d === null}
      gleich={gleicherZeitpunkt}
      pflicht={pflicht}
      darfSchreiben={darfSchreiben}
      onSpeichern={(d) => speichern(etikett, zuPatch(d ? alsBackendZeit(d) : null))}
      eingabe={({ feld, popup, value, onChange }) => (
        <ZeitpunktEingabe
          {...feld}
          {...popup}
          format="YYYY-MM-DD HH:mm:ss"
          style={{ width: '100%' }}
          value={value}
          onChange={(d) => onChange(d ?? null)}
        />
      )}
    />
  );
}

/** Gleiche Koordinate: dasselbe Paar; eine unlesbare Eingabe ist nie gleich (sie soll prüfen). */
function gleicheKoordinate(a: KoordinatenWert, b: KoordinatenWert): boolean {
  if (a === null || b === null) return a === b;
  return istLatLon(a) && istLatLon(b) && a.lat === b.lat && a.lon === b.lon;
}

/**
 * Die Koordinate als Zeile (LFH-1170, design.md D3): Übergang bis zur Ortssuche (LFH-1175), die
 * Adresse und Koordinate gemeinsam erfasst. Das Paar geht in EINEM PATCH hinaus, geleert als
 * zweimal `null`.
 *
 * Keine `KoordinatenFeld`-Hülle: die Zeile ist kein `Form.Item`. Die Eingabe meldet unlesbaren Text
 * als `ungueltig` und nennt den Grund selbst unter dem Feld; `gueltig` sperrt damit das Senden
 * (Koordinaten-Guard, bewertete Stelle), die Zeile bleibt offen.
 */
function KoordinatenAngabe({
  einsatzId,
  lat,
  lon,
  darfSchreiben,
  speichern,
}: {
  einsatzId: number;
  lat: number | null | undefined;
  lon: number | null | undefined;
  darfSchreiben: boolean;
  speichern: FeldSpeichern;
}) {
  const wert: KoordinatenWert = lat != null && lon != null ? { lat, lon } : null;
  return (
    <InlineAngabe<KoordinatenWert>
      etikett="Koordinate"
      wert={wert}
      anzeige={
        wert && istLatLon(wert) ? (
          <KoordinatenAnzeige
            lat={wert.lat}
            lon={wert.lon}
            einsatzId={einsatzId}
            exclude={`einsatzort:${einsatzId}`}
          />
        ) : null
      }
      leer={(w) => w === null}
      gleich={gleicheKoordinate}
      darfSchreiben={darfSchreiben}
      gueltig={(w) => w === null || istLatLon(w)}
      onSpeichern={(w) =>
        speichern('Koordinate', {
          einsatzort_lat: istLatLon(w) ? w.lat : null,
          einsatzort_lon: istLatLon(w) ? w.lon : null,
        })
      }
      eingabe={({ feld, value, onChange }) => (
        <KoordinatenEingabe
          {...feld}
          einsatzId={einsatzId}
          exclude={`einsatzort:${einsatzId}`}
          value={value}
          onChange={onChange}
        />
      )}
    />
  );
}

/**
 * Mindestbreite einer Kopfangabe, dasselbe Maß wie `flaeche.kachelMinKlein` (220). Lokal statt als
 * weiterer Schlüssel in `flaeche`: das ist als geschlossene Menge gepinnt, und eine Kopfleiste ist
 * kein Nebenraster.
 *
 * `auto-fit` legt bei ~900 px Lesebreite vier Spalten nebeneinander (Fükw), auf dem Handschirm
 * eine.
 */
const KOPF_MIN_BREITE = 220;

/**
 * Eine Angabe der Kopfleiste: gedämpftes Etikett, darunter der Wert mit Gewicht. Vier Angaben sind
 * herausgestellt, weil sie im Fükw zuerst gebraucht werden — Stichwort, Alarmzeit, Einsatzort,
 * Einsatzleitung.
 *
 * Ein leerer Wert lässt den Platz stehen und zeigt „—": eine Kopfleiste mit wechselnder Spaltenzahl
 * wäre bei jedem Einsatz anders zu lesen.
 *
 * Nichts hier ist bedienbar, die Zwei-Angaben-Regel für handgebaute Bedienziele gilt nicht.
 */
/**
 * Eine Angabe als Zelle im Fugenraster (Augenbraue über dem Wert). Kein `Kennzahl`-Baustein: die
 * Werte sind Wörter — ein Stichwort in Datenwert-Mono läse sich wie ein Messwert.
 */
function KopfAngabe({ etikett, wert, mono }: { etikett: string; wert: ReactNode; mono?: boolean }) {
  const { token, rollen } = useRollen();
  return (
    <div
      style={{
        background: rollen.flaeche,
        paddingBlock: token.paddingSM,
        paddingInline: token.padding,
        minWidth: 0,
      }}
    >
      <Augenbraue style={{ display: 'block', marginBottom: token.marginXXS }}>{etikett}</Augenbraue>
      <div
        style={{
          ...(mono ? monoStil(15, 500) : { fontSize: 15, fontWeight: 500 }),
          color: rollen.text,
          overflowWrap: 'anywhere',
        }}
      >
        {wert}
      </div>
    </div>
  );
}

/**
 * Beschriftete Angaben als Zeilen (`dl`) statt umrandeter `Descriptions`-Tabelle: Augenbraue links,
 * Wert rechts, Trenner `flaeche3`. Unter `md` steht die Augenbraue ÜBER dem Wert (Muster
 * `ModulEinstellungsListe`): die 140 px der Etikettspalte ließen dem Wert am Handy zu wenig, und
 * die Seite lief über (LFH-964).
 */
function Angaben({ zeilen }: { zeilen: { etikett: string; wert: ReactNode }[] }) {
  const { token, rollen } = useRollen();
  const { istSchmal } = useViewport();
  return (
    <dl style={{ margin: 0 }}>
      {zeilen.map(({ etikett, wert }) => (
        <div
          key={etikett}
          style={{
            ...paneelZeileStil(rollen, token),
            display: 'grid',
            gridTemplateColumns: istSchmal ? '1fr' : 'minmax(140px, 1fr) minmax(0, 2fr)',
            gap: istSchmal ? token.marginXXS : token.margin,
            alignItems: 'baseline',
          }}
        >
          <Augenbraue als="dt">{etikett}</Augenbraue>
          <dd style={{ margin: 0, color: rollen.text2, overflowWrap: 'anywhere' }}>{wert}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Sprechgruppen als eine Zeile: „TMO 311, 312 · DMO 505“ — dieselbe Teilung wie der Funkplan. */
function sprechgruppenText(fs: Pick<Fuehrungsstelle, 'sprechgruppen'>): string {
  const { tmo, dmo } = teileSprechgruppen(fs.sprechgruppen);
  return [
    tmo.length > 0 ? mitBetriebsart('TMO', tmo.map((s) => s.bezeichnung).join(', ')) : null,
    dmo.length > 0 ? mitBetriebsart('DMO', dmo.map((s) => s.bezeichnung).join(', ')) : null,
  ]
    .filter((t): t is string => t != null)
    .join(' · ');
}

/** Gleiche Auswahl (Sprechgruppen, Fahrzeuge) unabhängig von der Reihenfolge („unverändert → kein Senden“). */
function gleicheIds(a: readonly number[], b: readonly number[]): boolean {
  if (a.length !== b.length) return false;
  const menge = new Set(a);
  return b.every((id) => menge.has(id));
}

/** Ein Fahrzeug, wie die Zeile „Fahrzeuge“ es nennt: „Florian 10/1 (ELW 2)“. */
function fahrzeugText(f: EinsatzFahrzeug): string {
  const typ = f.fahrzeugtyp?.trim();
  return typ ? `${f.funkrufname} (${typ})` : f.funkrufname;
}

/**
 * Die disponierten Fahrzeuge für die Zeile „Fahrzeuge“ (LFH-1106). Die Führungsstelle liefert nur
 * IDs; Namen kommen aus dem Modul Fahrzeuge, abgerufen nur mit dessen Freigabe.
 */
function useFahrzeugeQuelle(einsatzId: number): {
  zustand: AbrufZustand;
  fahrzeuge: EinsatzFahrzeug[];
} {
  const freigabenQuery = useQuery({
    queryKey: einsatzKeys.modulFreigaben(einsatzId),
    queryFn: () => ladeModulFreigaben(einsatzId),
  });
  const frei = freigabenQuery.data != null && istKeyFreigegeben('fahrzeuge', freigabenQuery.data);
  const fahrzeugeQuery = useQuery({
    queryKey: einsatzKeys.fahrzeuge(einsatzId),
    queryFn: () => listeEinsatzFahrzeuge(einsatzId),
    enabled: frei,
  });
  const zustand: AbrufZustand = freigabenQuery.isError
    ? 'fehler'
    : freigabenQuery.data == null
      ? 'laden'
      : !frei
        ? 'gesperrt'
        : abrufZustand(fahrzeugeQuery);
  const fahrzeuge = zustand === 'daten' ? (fahrzeugeQuery.data ?? []) : [];
  return {
    zustand,
    fahrzeuge: [...fahrzeuge].sort((a, b) =>
      a.funkrufname.localeCompare(b.funkrufname, 'de', { numeric: true }),
    ),
  };
}

/**
 * Eigene Führungsstelle des Einsatzes (LFH-849, Spec `einsatz-fuehrungsstelle`): die Gegenstelle
 * des Funkplans. Fünf Zeilen, jede schickt nur ihr Feld an `…/fuehrungsstelle`, mit dem
 * Schreibrecht der Kopfdaten. Der Funkplan verweist hierher und bearbeitet selbst nichts.
 */
function FuehrungsstellePaneel({
  einsatzId,
  darfSchreiben,
}: {
  einsatzId: number;
  darfSchreiben: boolean;
}) {
  const qc = useQueryClient();
  const { message } = App.useApp();
  const query = useQuery({
    queryKey: einsatzKeys.fuehrungsstelle(einsatzId),
    queryFn: () => ladeFuehrungsstelle(einsatzId),
  });
  // Wie `feldMutation`: erst in den Cache, dann erfüllen — die Zeile schließt mit dem neuen Wert,
  // und die Fokusrückgabe trifft den frischen Wertknopf. Der Fehler steht an der Zeile.
  const mutation = useMutation({
    mutationFn: ({ patch }: { etikett: string; patch: FuehrungsstellePatch }) =>
      patcheFuehrungsstelle(einsatzId, patch),
    onSuccess: (neu, { etikett }) => {
      qc.setQueryData(einsatzKeys.fuehrungsstelle(einsatzId), neu);
      message.success(`${etikett} gespeichert`);
    },
  });
  const speichern = (etikett: string, patch: FuehrungsstellePatch) =>
    mutation.mutateAsync({ etikett, patch });
  const fahrzeugQuelle = useFahrzeugeQuelle(einsatzId);

  const fs = query.data;
  const text = (
    etikett: string,
    wert: string | null | undefined,
    mono: boolean,
    schluessel: 'rufname' | 'erreichbarkeit',
  ) => (
    <InlineAngabe<string>
      etikett={etikett}
      wert={wert ?? ''}
      anzeige={mono ? <span style={monoStil(13)}>{wert}</span> : wert}
      leer={leererText}
      gleich={(a, b) => a.trim() === b.trim()}
      darfSchreiben={darfSchreiben}
      onSpeichern={(w) => speichern(etikett, { [schluessel]: leerZuNull(w) })}
      eingabe={({ feld, value, onChange }) => (
        <Input {...feld} value={value} onChange={(e) => onChange(e.target.value)} />
      )}
    />
  );

  return (
    // Kein Außenabstand: der Abstand kommt aus dem Paneel-Raster der Seite (LFH-1170).
    <Paneel titel="Eigene Führungsstelle">
      <PaneelZustand
        zustand={query.isPending ? 'laden' : query.isError ? 'fehler' : 'daten'}
        titel="Eigene Führungsstelle"
        leerText=""
        onNeuladen={() => void query.refetch()}
      >
        {fs && (
          <Angaben
            zeilen={[
              { etikett: 'Rufname', wert: text('Rufname', fs.rufname, true, 'rufname') },
              {
                etikett: 'Sprechgruppen',
                wert: (
                  <InlineAngabe<number[]>
                    etikett="Sprechgruppen"
                    wert={fs.sprechgruppen.map((s) => s.id)}
                    anzeige={<span style={monoStil(13)}>{sprechgruppenText(fs)}</span>}
                    leer={(ids) => ids.length === 0}
                    gleich={gleicheIds}
                    darfSchreiben={darfSchreiben}
                    onSpeichern={(ids) => speichern('Sprechgruppen', { sprechgruppe_ids: ids })}
                    eingabe={({ feld, popup, value, onChange }) => (
                      <SprechgruppenPicker
                        einsatzId={einsatzId}
                        value={value}
                        onChange={onChange}
                        auswahl={{ ...feld, ...popup }}
                      />
                    )}
                  />
                ),
              },
              {
                etikett: 'Kommunikationsmittel',
                wert: (
                  <InlineAngabe<string | null>
                    etikett="Kommunikationsmittel"
                    wert={fs.kommunikationsmittel ?? null}
                    anzeige={kommunikationsmittelLabel(fs.kommunikationsmittel)}
                    leer={(w) => w === null}
                    darfSchreiben={darfSchreiben}
                    onSpeichern={(w) =>
                      speichern('Kommunikationsmittel', { kommunikationsmittel: w })
                    }
                    eingabe={({ feld, popup, value, onChange }) => (
                      <Select<string>
                        {...feld}
                        {...popup}
                        allowClear
                        options={KOMMUNIKATIONSMITTEL_OPTIONEN}
                        value={value ?? undefined}
                        onChange={(w) => onChange(w ?? null)}
                      />
                    )}
                  />
                ),
              },
              {
                etikett: 'Erreichbarkeit',
                wert: text('Erreichbarkeit', fs.erreichbarkeit, false, 'erreichbarkeit'),
              },
              {
                etikett: 'Fahrzeuge',
                wert: (
                  <FahrzeugeAngabe
                    ids={fs.fahrzeug_ids}
                    quelle={fahrzeugQuelle}
                    darfSchreiben={darfSchreiben}
                    onSpeichern={(ids) => speichern('Fahrzeuge', { fahrzeug_ids: ids })}
                  />
                ),
              },
            ]}
          />
        )}
      </PaneelZustand>
    </Paneel>
  );
}

/**
 * Zeile „Fahrzeuge“ der Führungsstelle (LFH-1106): welche disponierten Fahrzeuge sie tragen.
 * Ohne Freigabe für Fahrzeuge gesperrt, mit dem Grund statt eines leeren Werts.
 */
function FahrzeugeAngabe({
  ids,
  quelle,
  darfSchreiben,
  onSpeichern,
}: {
  ids: readonly number[];
  quelle: ReturnType<typeof useFahrzeugeQuelle>;
  darfSchreiben: boolean;
  onSpeichern: (ids: number[]) => Promise<unknown>;
}) {
  if (quelle.zustand !== 'daten') return <>{ZUSTAND_GRUND[quelle.zustand]}</>;
  // Eine ID ohne disponiertes Fahrzeug (inzwischen entlassen) fällt still weg.
  const gewaehlt = quelle.fahrzeuge.filter((f) => ids.includes(f.id));
  return (
    <InlineAngabe<number[]>
      etikett="Fahrzeuge"
      wert={gewaehlt.map((f) => f.id)}
      anzeige={gewaehlt.map(fahrzeugText).join(', ')}
      leer={(w) => w.length === 0}
      gleich={gleicheIds}
      darfSchreiben={darfSchreiben}
      onSpeichern={onSpeichern}
      eingabe={({ feld, popup, value, onChange }) => (
        <Select<number[]>
          {...feld}
          {...popup}
          mode="multiple"
          allowClear
          options={quelle.fahrzeuge.map((f) => ({ value: f.id, label: fahrzeugText(f) }))}
          value={value}
          onChange={(w) => onChange(w ?? [])}
          style={{ width: '100%' }}
        />
      )}
    />
  );
}

/**
 * Kennungen des Seitenkopfs (LFH-1170): Einsatznummer · Leitstellen-Nr., ohne Leere. Die
 * Aktenzeichen, mit denen Leitstelle, Rückfragen und Einsatzbericht arbeiten, stehen damit ohne
 * Aufklappen da. `null`, wenn der Einsatz keine trägt: dann kein Meta.
 */
export function einsatzKennungen(
  einsatz: Pick<EinsatzAnzeige, 'einsatznummer_intern' | 'leitstellen_nr'>,
): string | null {
  const teile = [einsatz.einsatznummer_intern, einsatz.leitstellen_nr]
    .map((k) => k?.trim())
    .filter((k): k is string => !!k);
  return teile.length > 0 ? teile.join(' · ') : null;
}

export default function EinsatzdatenPage() {
  const { id } = useParams();
  const einsatzId = Number(id);
  const navigate = useNavigate();
  const { benutzer } = useAuth();
  const qc = useQueryClient();
  const { message } = App.useApp();
  const { token, rollen } = useRollen();
  const { abBreite } = useViewport();

  const einsatzQuery = useQuery({
    queryKey: einsatzKeys.einsatz(einsatzId),
    queryFn: () => ladeEinsatz(einsatzId),
  });
  const mitgliederQuery = useQuery({
    queryKey: einsatzKeys.mitglieder(einsatzId),
    queryFn: () => ladeMitglieder(einsatzId),
  });
  const vorschlaegeQuery = useQuery({
    queryKey: globalKeys.stichwortVorschlaege(),
    queryFn: listeStichwortVorschlaege,
  });

  // Der einzige Bearbeitungsweg (LFH-472, LFH-1170): EIN Feld je PATCH, die Koordinate als Paar.
  // Der Fehler geht an die Zeile (`mutateAsync` lehnt ab, `InlineAngabe` zeigt ihn), deshalb kein
  // `onError`-Toast.
  const feldMutation = useMutation({
    mutationFn: ({ patch }: { etikett: string; patch: KopfdatenPatch }) =>
      patcheEinsatz(einsatzId, patch),
    onSuccess: (aktualisiert, { etikett }) => {
      // Erst in den Cache, dann erfüllen: die Zeile zeigt den neuen Wert in derselben Runde, in der
      // sie die Eingabe schließt, und die Fokusrückgabe trifft den frischen Wertknopf.
      qc.setQueryData(einsatzKeys.einsatz(einsatzId), aktualisiert);
      qc.invalidateQueries({ queryKey: einsatzKeys.einsatz(einsatzId) });
      qc.invalidateQueries({ queryKey: globalKeys.einsaetze() });
      message.success(`${etikett} gespeichert`);
    },
  });
  const feldSpeichern: FeldSpeichern = (etikett, patch) =>
    feldMutation.mutateAsync({ etikett, patch });

  if (einsatzQuery.isLoading) {
    return <SeitenSkeleton />;
  }
  if (einsatzQuery.isError || !einsatzQuery.data) {
    return (
      <SeitenFehler
        text="Einsatz nicht gefunden oder kein Zugriff"
        onWiederholen={() => void einsatzQuery.refetch()}
      />
    );
  }
  const einsatz = einsatzQuery.data;

  // Kopfdaten und Führungsstelle laufen über die Verwaltungsrouten: der Admin nur der Einsatz-Org
  // (LFH-1066, wie der Server).
  const darfBearbeiten = darfEinsatzVerwalten(einsatz, benutzer);

  const leitung = (mitgliederQuery.data ?? [])
    .filter((m) => m.einsatz_rolle === 'einsatzleitung')
    .map((m) => m.anzeigename)
    .join(', ');

  // Aktiver Einsatz und Einsatzleitung, ohne Admin-Zweig (wie der Server): Abschluss und Zugriff.
  const darfLeiten = darfEinsatzLeiten(einsatz);

  const stichwortOptionen = (vorschlaegeQuery.data ?? []).map((v) => ({ value: v.text }));
  const kennungen = einsatzKennungen(einsatz);

  // Nebenwege im Kopf (LFH-963, LFH-1170): nichts davon muss am Handy ohne Menü sichtbar sein.
  // Der Einsatzbericht auch für Beobachter (die Rechte prüft der Bericht je Quelle), der Sprung zum
  // Zugriff nur für die, die ihn dort bedienen.
  const berichtZiel = einsatzberichtPfad(einsatzId);
  const zugriffZiel = einsatzEinstellungenPfad(einsatzId, 'zugriff');
  const nebenwege: Nebenweg[] = [
    {
      key: 'einsatzbericht',
      label: 'Einsatzbericht drucken',
      ziel: berichtZiel,
      onWahl: () => navigate(berichtZiel),
    },
    ...(darfLeiten
      ? [
          {
            key: 'zugriff',
            label: 'Zugriff verwalten',
            ziel: zugriffZiel,
            sprung: true as const,
            onWahl: () => navigate(zugriffZiel),
          },
        ]
      : []),
  ];

  // Ab `xl` zwei Spalten (Fükw), darunter eine; der Fluss läuft zeilenweise, DOM- und
  // Lesereihenfolge bleiben Einsatz → Einsatzort → Erstmeldung → Eigene Führungsstelle.
  const zweispaltig = abBreite('xl');

  return (
    <EinsatzSeite
      // Volle Breite wie die übrigen Führungsseiten (LFH-1170); die schmale Lesebreite trug das
      // entfallene Formular.
      breite="voll"
      // Die Seite nennt sich (LFH-954): der Einsatzname steht im Pfad, der Status im Seitenkopf.
      titel={modulName('einsatzdaten')}
      meta={kennungen ? <span data-lfh="einsatz-kennungen">{kennungen}</span> : undefined}
      breadcrumb={
        <Breadcrumb
          items={[
            { title: <Link to="/einsaetze">Einsätze</Link> },
            { title: einsatz.bezeichnung },
            { title: modulName('einsatzdaten') },
          ]}
        />
      }
      dataUpdatedAt={einsatzQuery.dataUpdatedAt}
      weitere={{ name: 'Weitere Aktionen zu den Einsatzdaten', eintraege: nebenwege }}
      // Am aktiven Einsatz ohne Verwaltungsrecht der Grund; bedingt übergeben, sonst bliebe ein
      // leerer Slot mit Außenabstand (wie `StabPage`).
      hinweis={
        einsatz.status === 'aktiv' &&
        !darfBearbeiten && <RechteHinweis sichtbar text={NUR_LEITUNG_FUEHRUNG_ORG_ADMIN} />
      }
    >
      {/* Kopfleiste — die vier Angaben, die im Fükw zuerst gebraucht werden. Sie stehen
          nicht zusätzlich in einem Paneel darunter (jede Angabe genau einmal). */}
      <div
        data-fugenraster=""
        style={{
          ...kennzahlenbandStil(rollen),
          gridTemplateColumns: `repeat(auto-fit, minmax(min(${KOPF_MIN_BREITE}px, 100%), 1fr))`,
          marginBottom: token.margin,
        }}
      >
        <KopfAngabe
          etikett="Einsatzstichwort"
          wert={
            <InlineAngabe<string>
              etikett="Einsatzstichwort"
              wert={einsatz.stichwort ?? ''}
              anzeige={einsatz.stichwort}
              leer={leererText}
              gleich={(a, b) => a.trim() === b.trim()}
              darfSchreiben={darfBearbeiten}
              onSpeichern={(w) => feldSpeichern('Einsatzstichwort', { stichwort: leerZuNull(w) })}
              eingabe={({ feld, popup, value, onChange }) => (
                <AutoComplete
                  {...feld}
                  {...popup}
                  options={stichwortOptionen}
                  allowClear
                  placeholder="z. B. H1, MANV …"
                  value={value}
                  onChange={(v?: string) => onChange(v ?? '')}
                />
              )}
            />
          }
        />
        <KopfAngabe
          etikett="Alarmzeit"
          mono
          wert={
            <ZeitpunktAngabe
              etikett="Alarmzeit"
              wire={einsatz.begonnen_at}
              pflicht
              darfSchreiben={darfBearbeiten}
              speichern={feldSpeichern}
              // Pflicht: `null` erreicht `zuPatch` nie, `InlineAngabe` lehnt leer vorher ab.
              zuPatch={(wire) => ({ begonnen_at: wire ?? einsatz.begonnen_at })}
            />
          }
        />
        <KopfAngabe
          etikett="Einsatzort"
          wert={
            <TextAngabe
              etikett="Einsatzort"
              wert={einsatz.einsatzort}
              darfSchreiben={darfBearbeiten}
              speichern={feldSpeichern}
              zuPatch={(w) => ({ einsatzort: w })}
            />
          }
        />
        <KopfAngabe etikett="Einsatzleitung" wert={leitung || '—'} />
      </div>

      <div
        data-lfh="einsatzdaten-paneele"
        style={{
          display: 'grid',
          gridTemplateColumns: zweispaltig ? 'repeat(2, minmax(0, 1fr))' : 'minmax(0, 1fr)',
          gap: token.margin,
          alignItems: 'start',
        }}
      >
        <Paneel titel="Einsatz">
          <Angaben
            zeilen={[
              {
                etikett: 'Bezeichnung',
                wert: (
                  <TextAngabe
                    etikett="Bezeichnung"
                    wert={einsatz.bezeichnung}
                    pflicht
                    darfSchreiben={darfBearbeiten}
                    speichern={feldSpeichern}
                    // Pflicht: `null` erreicht `zuPatch` nie, `InlineAngabe` lehnt leer vorher ab.
                    zuPatch={(w) => ({ bezeichnung: w ?? einsatz.bezeichnung })}
                  />
                ),
              },
              {
                etikett: 'Einsatzart',
                wert: (
                  <InlineAngabe<Einsatzart>
                    etikett="Einsatzart"
                    wert={einsatz.einsatzart}
                    anzeige={EINSATZART_LABELS[einsatz.einsatzart]}
                    // Pflicht, aber ein `Select` ohne `allowClear` kann nicht leer werden.
                    leer={() => false}
                    darfSchreiben={darfBearbeiten}
                    onSpeichern={(art) => feldSpeichern('Einsatzart', { einsatzart: art })}
                    eingabe={({ feld, popup, value, onChange }) => (
                      <Select<Einsatzart>
                        {...feld}
                        {...popup}
                        options={EINSATZART_OPTIONEN}
                        value={value}
                        onChange={onChange}
                      />
                    )}
                  />
                ),
              },
              {
                etikett: 'Einsatznummer',
                wert: <span style={monoStil(13)}>{einsatz.einsatznummer_intern ?? '—'}</span>,
              },
              {
                etikett: 'Leitstellen-Nr.',
                wert: (
                  <TextAngabe
                    etikett="Leitstellen-Nr."
                    wert={einsatz.leitstellen_nr}
                    mono
                    darfSchreiben={darfBearbeiten}
                    speichern={feldSpeichern}
                    zuPatch={(w) => ({ leitstellen_nr: w })}
                  />
                ),
              },
              {
                etikett: 'Angelegt',
                wert: (
                  <span style={monoStil(13)}>
                    <ZeitAnzeige wert={einsatz.angelegt_at} format="dtgVoll" />
                  </span>
                ),
              },
              {
                // Bis die Lagebesprechung eine eigene Verwaltung hat (LFH-1251).
                etikett: 'Nächste Lagebesprechung',
                wert: (
                  <span style={monoStil(13)}>
                    <ZeitpunktAngabe
                      etikett="Nächste Lagebesprechung"
                      wire={einsatz.naechste_lagebesprechung_at}
                      darfSchreiben={darfBearbeiten}
                      speichern={feldSpeichern}
                      zuPatch={(wire) => ({ naechste_lagebesprechung_at: wire })}
                    />
                  </span>
                ),
              },
            ]}
          />
        </Paneel>

        {/* Bis zur Ortssuche (LFH-1175) nur die Koordinate: die Adresse steht in der Kopfleiste. */}
        <Paneel titel="Einsatzort">
          <Angaben
            zeilen={[
              {
                etikett: 'Koordinate',
                wert: (
                  <KoordinatenAngabe
                    einsatzId={einsatzId}
                    lat={einsatz.einsatzort_lat}
                    lon={einsatz.einsatzort_lon}
                    darfSchreiben={darfBearbeiten}
                    speichern={feldSpeichern}
                  />
                ),
              },
            ]}
          />
        </Paneel>

        <Paneel titel="Erstmeldung">
          <Angaben
            zeilen={[
              {
                etikett: 'Meldende Stelle',
                wert: (
                  <TextAngabe
                    etikett="Meldende Stelle"
                    wert={einsatz.meldende_stelle}
                    darfSchreiben={darfBearbeiten}
                    speichern={feldSpeichern}
                    zuPatch={(w) => ({ meldende_stelle: w })}
                  />
                ),
              },
              {
                etikett: 'Sachverhalt / Meldebild',
                wert: (
                  <TextAngabe
                    etikett="Sachverhalt / Meldebild"
                    wert={einsatz.sachverhalt}
                    mehrzeilig
                    darfSchreiben={darfBearbeiten}
                    speichern={feldSpeichern}
                    zuPatch={(w) => ({ sachverhalt: w })}
                  />
                ),
              },
              {
                etikett: 'Anzahl Betroffene (initial)',
                wert: (
                  <InlineAngabe<number | null>
                    etikett="Anzahl Betroffene (initial)"
                    wert={einsatz.anzahl_betroffene_initial ?? null}
                    anzeige={<span style={monoStil(13)}>{einsatz.anzahl_betroffene_initial}</span>}
                    leer={(n) => n === null}
                    darfSchreiben={darfBearbeiten}
                    onSpeichern={(n) =>
                      feldSpeichern('Anzahl Betroffene (initial)', {
                        anzahl_betroffene_initial: n,
                      })
                    }
                    eingabe={({ feld, value, onChange }) => (
                      <InputNumber<number>
                        {...feld}
                        min={0}
                        precision={0}
                        style={{ width: 180 }}
                        value={value}
                        onChange={(n) => onChange(n ?? null)}
                      />
                    )}
                  />
                ),
              },
            ]}
          />
        </Paneel>

        <FuehrungsstellePaneel einsatzId={einsatzId} darfSchreiben={darfBearbeiten} />
      </div>

      {/* Zuletzt und nicht im Kopf (LFH-960): Unumkehrbares für den ganzen Einsatz steht nicht im
          Kopf einer Arbeitsseite (`frontend/AGENTS.md`, „Destruktiv ist nicht gleich destruktiv“). */}
      {/* `key`: ein Einsatzwechsel räumt den Grund, eine spätere Antwort meldet nicht hier. */}
      {darfLeiten && <EinsatzAbschluss key={einsatzId} einsatzId={einsatzId} />}
    </EinsatzSeite>
  );
}

/** Folge des Abschlusses — steht in der Rückfrage, nicht als Satz neben dem Knopf. */
const ABSCHLIESSEN_FOLGE = 'Danach sind keine neuen Einträge oder Berichtigungen mehr möglich.';

/**
 * Einsatzabschluss (LFH-960, Spec `bedien-wortlaut`): aktiv → abgeschlossen, ohne Rückweg im
 * Frontend. Rückfrage als `Popconfirm`, deren roter Knopf die Handlung nennt. Eine Ablehnung steht
 * am Paneel bis zum nächsten Abschließen, kein Toast (LFH-1077).
 */
function EinsatzAbschluss({ einsatzId }: { einsatzId: number }) {
  const { token } = useRollen();
  const { message } = App.useApp();
  const qc = useQueryClient();
  const mutation = useMutation({
    mutationFn: () => schliesseEinsatzAb(einsatzId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: einsatzKeys.einsatz(einsatzId) });
      qc.invalidateQueries({ queryKey: globalKeys.einsaetze() });
      message.success('Einsatz abgeschlossen');
    },
  });
  return (
    <Paneel titel="Einsatzabschluss" koerperPolster style={{ marginTop: token.marginLG }}>
      <Popconfirm
        title="Einsatz abschließen?"
        description={ABSCHLIESSEN_FOLGE}
        okText="Einsatz endgültig abschließen"
        cancelText="Abbrechen"
        okButtonProps={{ danger: true }}
        onConfirm={() => mutation.mutate()}
      >
        <Button danger loading={mutation.isPending}>
          Einsatz abschließen
        </Button>
      </Popconfirm>
      {mutation.error != null && (
        <div style={{ marginTop: token.marginSM }}>
          <SpeicherFehler
            fehler={mutation.error}
            titel="Nicht abgeschlossen"
            fallback="Abschließen fehlgeschlagen"
          />
        </div>
      )}
    </Paneel>
  );
}
