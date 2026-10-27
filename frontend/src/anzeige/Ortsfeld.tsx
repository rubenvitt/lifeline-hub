import { useQuery, type QueryKey } from '@tanstack/react-query';
import { Button, Input, Space, type InputProps, type InputRef } from 'antd';
import {
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type KeyboardEvent,
  type Ref,
} from 'react';
import type { OrtSucheAntwort, OrtTreffer } from '../api/karteOrtSuche';
import { useRollen } from '../components/instrument';
import { useOnline } from '../offline/useOnline';
import { Kartenausschnitt } from './Kartenausschnitt';
import { KarteWaehlen } from './KarteWaehlen';
import type { LatLon } from './koordinaten';
import { erkenneKoordinate } from './koordinatenErkennung';
import { OrtZeile } from './OrtZeile';
import { adressAussage, adressBegriff, OFFLINE_KARTE_ZUSATZ } from './ortssuche';
import { useOrtVorschau } from './useOrtVorschau';

/**
 * Woher die Koordinate eines Ortsfelds kommt (LLH-1108). `adresse` (gewählter Treffer) und
 * `koordinate` (getippt) hängen am Text: ändert er sich, fällt die Koordinate weg bzw. wird neu
 * erkannt. `karte` (Nadel gesetzt oder gezogen, Ortsname übernommen) ist vom Text gelöst.
 */
export type OrtQuelle = 'adresse' | 'koordinate' | 'karte';

/**
 * Wert des Ortsfelds: der Text und eine Koordinate mit ihrer Herkunft (Spec `ortsfeld`, „Treffer
 * setzt Adresse und Koordinate“, „Koordinate im Feld“, „Nadel verschieben“). `quelle` steht nur
 * neben einer Koordinate; ein Wert ohne ist reiner Text.
 */
export interface OrtsfeldWert {
  text: string;
  koordinate: LatLon | null;
  quelle?: OrtQuelle;
}

/**
 * Wert nach einer Textänderung: eine getippte Koordinate wird ohne Server erkannt; ein auf der
 * Karte gesetzter Punkt bleibt; die Koordinate eines Treffers oder einer getippten Koordinate
 * fällt weg.
 */
export function nachTextaenderung(vorher: OrtsfeldWert, text: string): OrtsfeldWert {
  const getippt = erkenneKoordinate(text);
  if (getippt) return { text, koordinate: getippt, quelle: 'koordinate' };
  if (vorher.quelle === 'karte' && vorher.koordinate) {
    return { text, koordinate: vorher.koordinate, quelle: 'karte' };
  }
  return { text, koordinate: null };
}

/**
 * Kartenvorschau unter dem Feld (LLH-1108, Spec `ortsfeld`, „Kartenvorschau am Feld“).
 */
export interface OrtsfeldKarte {
  /** Wofür der Ort steht („Einsatzort“); Name der Nadel, der Karte und des Dialogs. */
  etikett: string;
  /**
   * Im Einsatz: Ort-Zeile (Ortsname, Peilung zum nächsten Marker) und „Als Adresse übernehmen“
   * über die Ort-Vorschau des Einsatzes. Ohne Einsatz (LLH-1376) fragt das Feld die Ort-Vorschau
   * der Organisation, und nur für einen Punkt, der nicht aus einem Treffer stammt: dann stehen
   * Ortsname und „Als Adresse übernehmen“ da, ohne Peilung. Diesen Einstieg darf nur, wer
   * Einsätze anlegen darf.
   */
  einsatzId?: number;
  /** `typ:id` der bearbeiteten Sache, damit die Peilung nicht auf sie selbst zeigt. */
  exclude?: string;
  /** Wo „Auf Karte wählen“ ohne Koordinate beginnt, meist der Einsatzort. */
  umgebung?: LatLon | null;
  /** Höhe der Vorschau in Pixeln. */
  hoehe?: number;
}

/** Vorgabehöhe der Vorschau unter dem Feld: klein, sie bestätigt den Ort. */
const VORSCHAU_HOEHE = 160;

export interface OrtsfeldGemeinsam {
  /**
   * Das Eingabefeld (React 19: `ref` als Prop). `Form.Item` reicht ihn herein; antds
   * `scrollToFirstError={{ focus: true }}` fokussiert darüber (LLH-1121).
   */
  ref?: Ref<InputRef>;
  id?: string;
  'aria-label'?: string;
  /** Prüffehler am Feld, wie `InlineAngabe` sie hineinreicht. */
  'aria-invalid'?: true;
  'aria-describedby'?: string;
  autoFocus?: boolean;
  value?: OrtsfeldWert;
  onChange?: (wert: OrtsfeldWert) => void;
  /**
   * Meldet, ob die Trefferliste offen ist — wie das Popup einer Auswahl. `InlineAngabe` reicht es
   * über `popup` herein: dann schließt Escape zuerst die Liste und verwirft erst danach die Zeile.
   */
  onOpenChange?: (offen: boolean) => void;
  /**
   * Zeichengrenze des Textes (`zeichenGrenze(max)` aus `components/zeichenGrenze.tsx`); die
   * passende `zeichenRegel` prüft der Aufrufer am Text des Werts.
   */
  count?: InputProps['count'];
}

interface MitSuche {
  /** Die Suche des Einstiegs (im Einsatz oder in der Organisation). */
  suchen: (begriff: string) => Promise<OrtSucheAntwort>;
  /** Query-Key der Suche zu einem Begriff, aus `api/queryKeys.ts`. */
  suchSchluessel: (begriff: string) => QueryKey;
  /** Kartenvorschau mit ziehbarer Nadel und „Auf Karte wählen“; ohne nur das Feld. */
  karte?: OrtsfeldKarte;
  ohneSuche?: never;
}

interface OhneSuche {
  /**
   * Grund, warum nichts an den Geocoder geht (LLH-1108, Spec `ortsfeld`, „Ortsfeld ohne Suche“):
   * eine personenbezogene Adresse verlässt den Browser nie Richtung Geocoder. Das Feld ist dann
   * reiner Text, ohne Suche, Koordinatenerkennung und Karte.
   */
  ohneSuche: 'personenbezogen';
  suchen?: never;
  suchSchluessel?: never;
  karte?: never;
}

export type OrtsfeldProps = OrtsfeldGemeinsam & (MitSuche | OhneSuche);

/** Eine Suche: der Begriff und ihre laufende Nummer (je Enter oder Knopf eine neue). */
interface Anfrage {
  begriff: string;
  nr: number;
}

/**
 * Frische der Treffer im Client wie auf der Lagekarte: eine zweite Suche nach demselben Begriff
 * fragt nicht. Nur für `ok`; „ausgelastet“ und „nicht erreichbar“ verlangen einen neuen Versuch.
 */
const TREFFER_FRISCH_MS = 10 * 60_000;

/**
 * Ortsangabe mit Adresssuche (LFH-1175, Spec `ortsfeld`; Kern von LFH-1248). Gesucht wird nur auf
 * Enter oder „Ort suchen“, nie beim Tippen: der öffentliche Nominatim verbietet
 * Autovervollständigung, und der Takt des Servers gilt für alle (`pages/lagekarte/AGENTS.md`,
 * Ortssuche). Enter im Feld sucht und sendet das umgebende Formular NICHT ab; gespeichert wird
 * über dessen Knopf.
 *
 * Freitext bleibt erlaubt. Eine getippte Koordinate (jede Form der Sprungpalette) wird ohne Server
 * erkannt (LLH-1108). Mit `karte` stehen darunter die Vorschau mit ziehbarer Nadel, die Ort-Zeile
 * (Peilung nur im Einsatz) und „Auf Karte wählen“; mit `ohneSuche` ist das Feld reiner Text.
 */
export function Ortsfeld(props: OrtsfeldProps) {
  if (props.ohneSuche !== undefined) {
    const {
      ref,
      id,
      'aria-label': ariaLabel,
      'aria-invalid': ariaInvalid,
      'aria-describedby': ariaDescribedby,
      autoFocus,
      value,
      onChange,
      count,
    } = props;
    // Nur Text: kein Knopf, Enter wie in jedem Feld, keine Erkennung, keine Karte.
    return (
      <Input
        ref={ref}
        id={id}
        aria-label={ariaLabel}
        aria-invalid={ariaInvalid}
        aria-describedby={ariaDescribedby}
        autoFocus={autoFocus}
        value={value?.text ?? ''}
        count={count}
        onChange={(e) => onChange?.({ text: e.target.value, koordinate: null })}
      />
    );
  }
  return <OrtsfeldMitSuche {...props} />;
}

function OrtsfeldMitSuche({
  ref,
  id,
  'aria-label': ariaLabel,
  'aria-invalid': ariaInvalid,
  'aria-describedby': ariaDescribedby,
  autoFocus,
  value = { text: '', koordinate: null },
  onChange,
  suchen,
  suchSchluessel,
  karte,
  onOpenChange,
  count,
}: OrtsfeldGemeinsam & MitSuche) {
  const { token, rollen } = useRollen();
  const online = useOnline();
  const [anfrage, setAnfrage] = useState<Anfrage | null>(null);
  const nrRef = useRef(0);
  const feldRef = useRef<InputRef>(null);
  // Der eigene `ref` bleibt für die Fokusrückgabe; der hereingereichte zeigt auf dasselbe Feld.
  useImperativeHandle(ref, () => feldRef.current as InputRef, []);
  const begriff = adressBegriff(value.text);
  const listeOffen = online && anfrage !== null;

  // Offen/zu nur beim Wechsel melden; der Anfangszustand „zu“ ist keine Meldung.
  const gemeldetRef = useRef(false);
  useEffect(() => {
    if (gemeldetRef.current === listeOffen) return;
    gemeldetRef.current = listeOffen;
    onOpenChange?.(listeOffen);
  }, [listeOffen, onOpenChange]);

  function sucheStarten() {
    if (!online || begriff === null) return;
    nrRef.current += 1;
    setAnfrage({ begriff, nr: nrRef.current });
  }

  function tasten(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key !== 'Enter' || e.nativeEvent.isComposing) return;
    // Strg/⌘ + Enter gehört der Erfassungshülle („speichern und nächste“, LLH-1407), sucht nicht.
    if (e.metaKey || e.ctrlKey) return;
    // Kein implizites Absenden des umgebenden Formulars: Enter sucht.
    e.preventDefault();
    sucheStarten();
  }

  /**
   * Escape am ganzen Feld (Eingabe, „Ort suchen“, Treffer): eine offene Liste schließt zuerst
   * allein; erst das nächste Escape gehört dem Formular (Zeile verwerfen, Dialog schließen).
   */
  function escape(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key !== 'Escape' || !listeOffen) return;
    e.preventDefault();
    setAnfrage(null);
    fokusInsFeld();
  }

  /** Der Fokus fällt nicht auf `<body>`, wenn die Liste mit dem fokussierten Knopf aushängt. */
  function fokusInsFeld() {
    feldRef.current?.focus();
  }

  function waehlen(t: OrtTreffer) {
    onChange?.({
      text: t.kurz ?? t.name,
      koordinate: { lat: t.lat, lon: t.lon },
      quelle: 'adresse',
    });
    setAnfrage(null);
    fokusInsFeld();
  }

  return (
    <div
      onKeyDown={escape}
      style={{ display: 'flex', flexDirection: 'column', gap: token.marginXS, minWidth: 0 }}
    >
      {/* `minWidth: 0` am Feld: antds Eingabe bringt eine Mindestbreite mit und weitete am Handy
          das Raster der Zeile über 390 px (e2e `einsatzort-ortssuche.spec.ts`). */}
      <Space.Compact style={{ width: '100%', display: 'flex' }}>
        <Input
          ref={feldRef}
          style={{ flex: '1 1 auto', minWidth: 0 }}
          id={id}
          aria-label={ariaLabel}
          aria-invalid={ariaInvalid}
          aria-describedby={ariaDescribedby}
          autoFocus={autoFocus}
          value={value.text}
          count={count}
          onChange={(e) => {
            onChange?.(nachTextaenderung(value, e.target.value));
            setAnfrage(null);
          }}
          onKeyDown={tasten}
        />
        <Button disabled={!online || begriff === null} onClick={sucheStarten}>
          Ort suchen
        </Button>
      </Space.Compact>
      {!online ? (
        <div role="status" style={{ color: rollen.text2 }}>
          Adresssuche ohne Netz nicht verfügbar
        </div>
      ) : (
        anfrage && (
          <OrtsfeldTreffer
            anfrage={anfrage}
            suchen={suchen}
            suchSchluessel={suchSchluessel}
            onWaehlen={waehlen}
            onNeuerVersuch={fokusInsFeld}
          />
        )
      )}
      {karte && <OrtsfeldVorschau karte={karte} value={value} onChange={onChange} />}
    </div>
  );
}

/**
 * Kartenvorschau, Ort-Zeile und „Auf Karte wählen“ unter dem Feld (LLH-1108). Jeder Punkt aus der
 * Karte kommt mit `quelle: 'karte'` und lässt den Text stehen; einen Ortsnamen gibt es nur als
 * Vorschlag zum Übernehmen.
 */
function OrtsfeldVorschau({
  karte,
  value,
  onChange,
}: {
  karte: OrtsfeldKarte;
  value: OrtsfeldWert;
  onChange?: (wert: OrtsfeldWert) => void;
}) {
  const { token, rollen } = useRollen();
  const [waehlen, setWaehlen] = useState(false);
  const punkt = value.koordinate;
  const ausKarte = (p: LatLon) => onChange?.({ text: value.text, koordinate: p, quelle: 'karte' });

  return (
    <>
      {punkt && (
        <Kartenausschnitt
          punkt={punkt}
          etikett={karte.etikett}
          hoehe={karte.hoehe ?? VORSCHAU_HOEHE}
          onVerschieben={ausKarte}
        />
      )}
      {punkt && (karte.einsatzId != null || value.quelle !== 'adresse') && (
        <OrtVorschlag
          einsatzId={karte.einsatzId ?? null}
          exclude={karte.exclude}
          wert={{ ...value, koordinate: punkt }}
          onUebernehmen={(ortsname) =>
            onChange?.({ text: ortsname, koordinate: punkt, quelle: 'karte' })
          }
        />
      )}
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: token.marginXS }}>
        {!punkt && <span style={{ color: rollen.text2 }}>Nicht verortet</span>}
        <Button onClick={() => setWaehlen(true)}>Auf Karte wählen</Button>
      </div>
      <KarteWaehlen
        offen={waehlen}
        etikett={karte.etikett}
        punkt={punkt}
        umgebung={karte.umgebung}
        onUebernehmen={(p) => {
          ausKarte(p);
          setWaehlen(false);
        }}
        onAbbrechen={() => setWaehlen(false)}
      />
    </>
  );
}

/**
 * Ort-Zeile (Ortsname, im Einsatz mit Peilung) und, wenn der Punkt nicht aus einem Treffer stammt,
 * der Ortsname als Vorschlag für den Text. Übernommen wird nur auf Knopfdruck; der getippte Text bleibt sonst.
 */
function OrtVorschlag({
  einsatzId,
  exclude,
  wert,
  onUebernehmen,
}: {
  /** `null`: ohne Einsatz, Ort-Vorschau der Organisation (nur der Ortsname). */
  einsatzId: number | null;
  exclude?: string;
  wert: OrtsfeldWert & { koordinate: LatLon };
  onUebernehmen: (ortsname: string) => void;
}) {
  const { data } = useOrtVorschau(einsatzId, wert.koordinate, exclude);
  const ortsname = data?.ortsname?.trim();
  const vorschlagen =
    (wert.quelle === 'karte' || wert.quelle === 'koordinate') &&
    !!ortsname &&
    ortsname !== wert.text.trim();
  return (
    <div
      style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', minWidth: 0 }}
    >
      <OrtZeile einsatzId={einsatzId} koord={wert.koordinate} exclude={exclude} />
      {vorschlagen && (
        <Button type="link" style={{ paddingInline: 0 }} onClick={() => onUebernehmen(ortsname)}>
          Als Adresse übernehmen
        </Button>
      )}
    </div>
  );
}

/**
 * Treffer einer Suche. Eigene Komponente, weil nur sie den Server fragt: der Query-Key hängt am
 * Begriff, ohne Anfrage gibt es keinen.
 */
function OrtsfeldTreffer({
  anfrage,
  suchen,
  suchSchluessel,
  onWaehlen,
  onNeuerVersuch,
}: {
  anfrage: Anfrage;
  suchen: (begriff: string) => Promise<OrtSucheAntwort>;
  suchSchluessel: (begriff: string) => QueryKey;
  onWaehlen: (t: OrtTreffer) => void;
  /** Vor „Erneut suchen“: der Knopf hängt mit der Antwort aus, der Fokus geht ins Feld. */
  onNeuerVersuch: () => void;
}) {
  const { token, rollen } = useRollen();
  const abfrage = useQuery({
    queryKey: suchSchluessel(anfrage.begriff),
    queryFn: () => suchen(anfrage.begriff),
    staleTime: (q) => (q.state.data?.zustand === 'ok' ? TREFFER_FRISCH_MS : 0),
    retry: false,
  });
  const { refetch, isError, data } = abfrage;

  // Eine neue Suche nach demselben Begriff fragt nach einem Fehlzustand neu, wie „Erneut suchen“.
  const gefragtFuerRef = useRef(anfrage.nr);
  useEffect(() => {
    if (gefragtFuerRef.current === anfrage.nr) return;
    gefragtFuerRef.current = anfrage.nr;
    if (isError || (data != null && data.zustand !== 'ok')) void refetch();
  }, [anfrage.nr, isError, data, refetch]);

  if (abfrage.isPending) {
    return (
      <div role="status" style={{ color: rollen.text2 }}>
        Sucht …
      </div>
    );
  }

  const aussage = adressAussage(anfrage.begriff, data, isError);
  if (aussage) {
    const nochmal = isError || data?.zustand !== 'ok';
    return (
      <div
        role="status"
        style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: token.marginXS }}
      >
        {aussage}
        {nochmal && (
          <Button
            loading={abfrage.isFetching}
            onClick={() => {
              onNeuerVersuch();
              void refetch();
            }}
          >
            Erneut suchen
          </Button>
        )}
      </div>
    );
  }

  return (
    <ul
      aria-label="Treffer"
      style={{
        listStyle: 'none',
        margin: 0,
        padding: 0,
        display: 'flex',
        flexDirection: 'column',
        border: `1px solid ${rollen.linie}`,
      }}
    >
      {(data?.treffer ?? []).map((t, i) => (
        <li key={`${i}:${t.lat},${t.lon}`} style={{ minWidth: 0 }}>
          <Button
            type="text"
            block
            onClick={() => onWaehlen(t)}
            style={{
              height: 'auto',
              minWidth: 0,
              maxWidth: '100%',
              minHeight: token.controlHeight,
              paddingBlock: token.paddingXXS,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'flex-start',
              justifyContent: 'center',
              textAlign: 'start',
              whiteSpace: 'normal',
            }}
          >
            <span style={{ overflowWrap: 'anywhere' }}>{t.kurz ?? t.name}</span>
            {t.quelle === 'offline_karte' && (
              <span style={{ color: rollen.text2, fontSize: token.fontSizeSM }}>
                {OFFLINE_KARTE_ZUSATZ}
              </span>
            )}
            {t.kurz && (
              <span
                // Umbrechen statt abschneiden: eine Zeile ohne Umbruch ginge mit voller Breite in die
                // Mindestbreite des Rasters ein und weitete die Seite am Handy.
                style={{
                  color: rollen.text2,
                  fontSize: token.fontSizeSM,
                  overflowWrap: 'anywhere',
                }}
              >
                {t.name}
              </span>
            )}
          </Button>
        </li>
      ))}
    </ul>
  );
}
