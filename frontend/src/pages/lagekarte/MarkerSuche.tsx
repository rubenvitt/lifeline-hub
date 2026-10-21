import { IconLupe } from '../../icons';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { CSSProperties, MutableRefObject, ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button, Input, Typography, theme } from 'antd';
import { Liste, ListenEintrag } from '../../components/Liste';
import { SeitenLeer } from '../../components/SeitenZustand';
import { monoStil, SegmentUmschalter, useRollen } from '../../components/instrument';
import { useAnzeigeKonventionen } from '../../anzeige/AnzeigeKonventionenContext';
import { erkenneKoordinate } from '../../anzeige/koordinatenErkennung';
import { adressAussage, adressBegriff, type GefundenerOrt } from '../../anzeige/ortssuche';
import { einsatzKeys } from '../../api/queryKeys';
import { sucheOrt } from '../../api/karteOrtSuche';
/*
 * Wert-Import aus `./Sidebar`, die ihrerseits `MarkerSuche` importiert — ein bewusster Zyklus:
 * `bedienzielStil` ist das repo-weit zitierte Referenzmuster und bleibt an seinem Ort.
 * Laufzeitsicher, weil es eine gehobene `export function` ist, die erst beim Rendern läuft. Wer aus
 * `Sidebar` eine Konstante auf Modulebene ableitet, bricht das.
 */
import { bedienzielStil } from './Sidebar';
import type { MarkerTyp } from './marker';
import { KlappPaneel } from './KlappPaneel';
import { OBJEKTART } from './leistenDaten';
import { ebenenZeileStil, FehlerSlot, type SektionFehler } from './leistenTeile';
import { useObjektKlapp } from './leistenWahl';
import {
  gruppiereObjekte,
  istWaehlbar,
  type ObjektEintrag,
  type ObjektGruppe,
} from './objektsuche';

/**
 * Ansicht „Objekte“ der Kartenleiste (LLH-1033, Spec `lagekarte-objektsuche`): EIN Suchfeld und
 * EINE Liste aller Objekte, verortet und nicht verortet — eine Liste, keine Tabelle (hier wird
 * gesucht und angesprungen, nicht verglichen; keine `unterEbene`, LFH-826).
 *
 * Welche Objekte hier stehen, entscheidet der Aufrufer über `objektEintraege` (`objektsuche.ts`),
 * dort sitzen die Modulsperren je Typ. Gruppiert wird rein (`gruppiereObjekte`): der Einsatzort
 * als erste Zeile, dann die Arten in fester Reihenfolge, ohne Suchbegriff und Filter zugeklappt
 * (je Gerät gemerkt, `useObjektKlapp`). Mit Begriff oder Filter stehen Gruppen mit Treffern offen,
 * ohne den gemerkten Zustand zu schreiben. Die Marke „Nicht verortet“ setzt den Filter. Keine
 * Entprellung: gefiltert wird lokal.
 *
 * ORTSSUCHE (LFH-638, Spec `lagekarte-ortssuche`, design.md D1/D2): mit `ortssuche` stehen über
 * den Objekten bis zu zwei Gruppen. „Koordinate“ entsteht beim Tippen aus der Form der Eingabe,
 * ohne Server. „Adresse“ entsteht NUR auf Enter (Nominatim-Regeln: kein Autovervollständigen)
 * und gilt für den gesuchten Begriff — wer weitertippt, sieht sie erst nach dem nächsten Enter
 * wieder. Liefert eine Suche genau einen Treffer, fliegt die Karte ohne Klick hin, einmal je Enter.
 */
interface Ortssuche {
  einsatzId: number;
  onOrtWaehlen: (ort: GefundenerOrt) => void;
  /**
   * Vorbelegung von außen (`?ort=`): Text ins Feld, Adresssuche auslösen. Die `nonce` macht
   * denselben Text ein zweites Mal wirksam.
   */
  vorbelegung?: { text: string; nonce: number } | null;
  /**
   * Die Vorbelegung mit dieser Nonce ist übernommen. Der Aufrufer räumt sie dann: sonst übernähme
   * eine neu eingehängte Suche sie ein zweites Mal und flöge erneut.
   */
  onVorbelegungVerbraucht?: (nonce: number) => void;
}

interface MarkerSucheProps {
  /** `objektEintraege` — verortet und nicht verortet, ohne Namen aus Modulen ohne Recht. */
  eintraege: ObjektEintrag[];
  /** Eine wählbare Zeile ist getippt (`istWaehlbar`): Schlüssel im Schema der Marker. */
  onMarkerWaehlen: (schluessel: string) => void;
  /**
   * Eine Lagebild-Quelle ist ausgefallen: der Fehler steht über der Liste, Gruppenköpfe und Marke
   * tragen „—“, und keine Leere wird behauptet.
   */
  fehler?: SektionFehler;
  /**
   * Eine Quelle der Liste ist ausgefallen, auch die Personenliste: die Gruppenköpfe tragen „—“ (die
   * Liste ist unvollständig), und eine leere Liste sagt das. Die Marke „Nicht verortet“ hängt nur an
   * `fehler` — Personen zählen dort nicht mit.
   */
  zaehlerUnbekannt?: boolean;
  /** Fehlt sie (kein Einsatz-Kontext), bleibt das Feld reine Objektsuche. */
  ortssuche?: Ortssuche;
  /** Schlüssel des laufenden Platzierungsziels — seine Zeile bleibt bei jedem Filter stehen. */
  angeheftet?: string | null;
  /**
   * Was rechts in einer Zeile steht (Platzieren, Fläche zeichnen, Verschieben, „wird platziert“)
   * — die Leiste kennt Rechte und Modus. `null`: nichts; eine nicht verortete Zeile sagt dann
   * „nicht verortet“.
   */
  zeilenAktion?: (eintrag: ObjektEintrag) => ReactNode;
}

/** Eine Enter-Suche: der Begriff und ihre laufende Nummer (je Enter eine neue). */
interface AdressAnfrage {
  begriff: string;
  nr: number;
}

/**
 * Frische der Adresstreffer im Client: ein zweites Enter auf denselben Begriff fragt nicht. Nur für
 * `ok` — „ausgelastet“ und „nicht erreichbar“ verlangen ausdrücklich einen neuen Versuch.
 */
const ADRESSE_FRISCH_MS = 10 * 60_000;

/**
 * Stil der Auswahlzeile — ein handgebautes Bedienziel (`<button>`): `minHeight` aus
 * `controlHeight` plus Polsterung, die ganze Zeilenbreite (`ebenenZeileStil`). Grund, Hover und
 * Fokusring trägt die Klasse `lfh-objektzeile` (`lagekarte.css`).
 */
export function objektZeileStil(token: {
  controlHeight: number;
  paddingSM: number;
  padding: number;
  marginSM: number;
}): CSSProperties {
  return { ...ebenenZeileStil(token), color: 'inherit', font: 'inherit' };
}

export default function MarkerSuche({
  eintraege,
  onMarkerWaehlen,
  fehler,
  zaehlerUnbekannt,
  ortssuche,
  angeheftet = null,
  zeilenAktion,
}: MarkerSucheProps) {
  const { token, rollen } = useRollen();
  const [suche, setSuche] = useState('');
  const [nurNichtVerortet, setNurNichtVerortet] = useState(false);
  const [anfrage, setAnfrage] = useState<AdressAnfrage | null>(null);
  const begriff = suche.trim();
  const liste = useMemo(
    () => gruppiereObjekte(eintraege, { suche, nurNichtVerortet, angeheftet }),
    [eintraege, suche, nurNichtVerortet, angeheftet],
  );
  const zahl = (n: number, unbekannt = fehler != null) => (unbekannt ? '—' : String(n));
  // Ist nichts mehr nicht verortet, steht statt der Marke „Alles verortet“ — ein gesetzter Filter
  // fiele sonst ohne Ausweg auf eine leere Liste. Zurückgesetzt im Render (React verwirft den
  // Durchlauf vor dem Commit).
  const allesVerortet = fehler == null && liste.nichtVerortet === 0;
  if (allesVerortet && nurNichtVerortet) setNurNichtVerortet(false);

  // Klappzustand: gemerkt je Gerät, solange weder Begriff noch Filter gelten. Mit Begriff, Filter
  // oder laufendem Ziel gilt ein vorläufiger Zustand bis zum nächsten Begriff — er schreibt nichts.
  const klapp = useObjektKlapp();
  const kontext = `${begriff.toLocaleLowerCase()}|${nurNichtVerortet}|${angeheftet ?? ''}`;
  const [vorlaeufig, setVorlaeufig] = useState<{
    kontext: string;
    offen: Partial<Record<MarkerTyp, boolean>>;
  }>({ kontext, offen: {} });
  if (vorlaeufig.kontext !== kontext) setVorlaeufig({ kontext, offen: {} });
  const suchModus = begriff !== '' || nurNichtVerortet;
  const istOffen = (g: ObjektGruppe) =>
    vorlaeufig.offen[g.typ] ?? (suchModus || g.angeheftet ? true : (klapp.offen[g.typ] ?? false));
  const umschalten = (g: ObjektGruppe) => {
    const neu = !istOffen(g);
    if (suchModus || g.angeheftet)
      setVorlaeufig((v) => ({ kontext: v.kontext, offen: { ...v.offen, [g.typ]: neu } }));
    else klapp.setze(g.typ, neu);
  };

  // Vorbelegung von außen, im Render statt per Effekt (React: State bei Prop-Wechsel anpassen).
  const vorbelegung = ortssuche?.vorbelegung ?? null;
  const [vorbelegungNonce, setVorbelegungNonce] = useState<number | null>(null);
  if (vorbelegung && vorbelegung.nonce !== vorbelegungNonce) {
    setVorbelegungNonce(vorbelegung.nonce);
    setSuche(vorbelegung.text);
    const b = adressBegriff(vorbelegung.text);
    if (b) setAnfrage((a) => ({ begriff: b, nr: (a?.nr ?? 0) + 1 }));
  }

  // Beschriftet im eingestellten Format (Einsatz, Org, Anwender-Override), wie überall auf der Karte.
  const { formatKoordinate } = useAnzeigeKonventionen();
  const mitOrtssuche = ortssuche != null;
  const onVorbelegungVerbraucht = ortssuche?.onVorbelegungVerbraucht;
  useEffect(() => {
    if (vorbelegungNonce != null) onVorbelegungVerbraucht?.(vorbelegungNonce);
  }, [vorbelegungNonce, onVorbelegungVerbraucht]);

  const koordinate = useMemo<GefundenerOrt | null>(() => {
    if (!mitOrtssuche) return null;
    const punkt = erkenneKoordinate(suche);
    if (!punkt) return null;
    return {
      ...punkt,
      beschriftung: formatKoordinate(punkt.lat, punkt.lon),
      art: 'koordinate',
    };
  }, [mitOrtssuche, suche, formatKoordinate]);

  const adresseSichtbar = ortssuche != null && anfrage != null && anfrage.begriff === begriff;
  // Lebt hier, nicht in `AdressGruppe`: Weitertippen und Zurücktippen hängt die Gruppe ab und wieder
  // an, und dieselbe Anfrage flöge sonst ein zweites Mal.
  const erledigtRef = useRef<number | null>(null);

  const sucheAdresse = () => {
    if (!ortssuche) return;
    const b = adressBegriff(suche);
    if (b) setAnfrage((a) => ({ begriff: b, nr: (a?.nr ?? 0) + 1 }));
  };

  const ortsGruppen = koordinate != null || adresseSichtbar;
  const ortEintrag = (ort: GefundenerOrt) => (
    <ListenEintrag style={bedienzielStil(token)} onClick={() => ortssuche?.onOrtWaehlen(ort)}>
      {ort.art === 'koordinate' ? (
        <span style={monoStil(token.fontSize)}>{ort.beschriftung}</span>
      ) : (
        ort.beschriftung
      )}
    </ListenEintrag>
  );

  // Fehlt eine Quelle (auch die Personenliste), behauptet kein Gruppenkopf eine Zahl.
  const gruppenZahl = (g: ObjektGruppe) => {
    const unbekannt = fehler != null || zaehlerUnbekannt === true;
    return g.nurVerortet
      ? zahl(g.gesamt, unbekannt)
      : `${zahl(g.verortet, unbekannt)}/${zahl(g.gesamt, unbekannt)}`;
  };
  const zeile = (e: ObjektEintrag) => (
    <ObjektZeile eintrag={e} aktion={zeilenAktion?.(e) ?? null} onWaehlen={onMarkerWaehlen} />
  );
  const leer = liste.einsatzort == null && liste.gruppen.length === 0;
  const markeBeschreibungId = useId();

  return (
    <div>
      <div data-lfh="objekte-kopf" style={{ padding: token.padding }}>
        <Input
          // Eigener Name: `allowClear` hängt einen zweiten Knopf in denselben Wrapper, eine Abfrage
          // über den Platzhalter wäre mehrdeutig.
          aria-label="Kartenobjekte suchen"
          placeholder="Kartenobjekte suchen"
          allowClear
          value={suche}
          onChange={(e) => setSuche(e.target.value)}
          onPressEnter={sucheAdresse}
          // Die Hülle nimmt dem Icon sein englisches `aria-label` („search").
          prefix={
            <span aria-hidden="true">
              <IconLupe />
            </span>
          }
        />
        <div data-lfh="objekte-marke" style={{ marginBlockStart: token.marginXS }}>
          {allesVerortet ? (
            <span style={{ color: rollen.gedaempft }}>Alles verortet</span>
          ) : (
            <>
              {/* Fester Name, die Zahl als Beschreibung: ein wechselnder Name würde bei jeder
                  Änderung neu angesagt. */}
              <SegmentUmschalter
                an={nurNichtVerortet}
                onWechsel={setNurNichtVerortet}
                zugaenglicherName="Nicht verortet"
                label="Nicht verortet"
                zahl={zahl(liste.nichtVerortet)}
                beschreibungId={markeBeschreibungId}
                style={{ display: 'inline-flex' }}
              />
              <span id={markeBeschreibungId} hidden>
                {zahl(liste.nichtVerortet)}
              </span>
            </>
          )}
        </div>
      </div>

      {/* Der Fehler steht über der Liste, nie an ihrer Stelle: die geladenen Zeilen — die
          Bedienung zum Verorten — bleiben bedienbar, und er nennt, dass Objekte fehlen können. */}
      <FehlerSlot fehler={fehler} />

      {koordinate && (
        <Liste
          size="small"
          kopf={{ inhalt: 'Koordinate', unterEbene: 1 }}
          dataSource={[koordinate]}
          rowKey={(o) => `${o.lat},${o.lon}`}
          renderItem={ortEintrag}
        />
      )}

      {adresseSichtbar && (
        <AdressGruppe
          einsatzId={ortssuche.einsatzId}
          anfrage={anfrage}
          onOrtWaehlen={ortssuche.onOrtWaehlen}
          erledigtRef={erledigtRef}
          eintrag={ortEintrag}
        />
      )}

      {liste.einsatzort && (
        <section data-paneel="objekte-einsatzort" aria-label="Einsatzort">
          <Liste
            size="small"
            dataSource={[liste.einsatzort]}
            rowKey={(e) => e.schluessel}
            renderItem={zeile}
          />
        </section>
      )}

      {liste.gruppen.map((g) => (
        <KlappPaneel
          key={g.typ}
          titel={g.label}
          kennung={`objekte-${g.typ}`}
          meta={gruppenZahl(g)}
          offen={istOffen(g)}
          onUmschalten={() => umschalten(g)}
          polster={false}
        >
          <Liste
            size="small"
            dataSource={g.eintraege}
            rowKey={(e) => e.schluessel}
            renderItem={zeile}
          />
        </KlappPaneel>
      ))}

      {/* Genau ein Leerzustand für die ganze Fläche. Der Fehlerzweig steht vorn: ist eine Quelle
          ausgefallen, sagt der Fehler oben genug, und „Alles verortet“ wäre eine Lagebeurteilung,
          die niemand geprüft hat. */}
      {leer &&
        fehler == null &&
        (ortsGruppen ? (
          // Über den Objekten steht schon ein Ort: nur der knappe Hinweis.
          <Typography.Text type="secondary" style={{ display: 'block', padding: token.paddingXS }}>
            {zaehlerUnbekannt
              ? 'Objekte konnten nicht vollständig geladen werden'
              : `Kein Kartenobjekt zu „${begriff}“`}
          </Typography.Text>
        ) : (
          <SeitenLeer
            titel={
              zaehlerUnbekannt
                ? 'Objekte konnten nicht vollständig geladen werden'
                : begriff !== ''
                  ? `Kein Kartenobjekt zu „${begriff}“`
                  : nurNichtVerortet
                    ? 'Alles verortet'
                    : 'Keine Kartenobjekte'
            }
          />
        ))}
    </div>
  );
}

/**
 * Eine Zeile der Objektliste. Wählbar (`istWaehlbar`): der Name ist ein `<button>` über die ganze
 * Zeile (Tab, Enter, Leertaste), daneben höchstens eine Zeilenaktion — nie ein Knopf im Knopf.
 * Nicht wählbar: Name und rechts die Aktion bzw. „nicht verortet“.
 */
function ObjektZeile({
  eintrag,
  aktion,
  onWaehlen,
}: {
  eintrag: ObjektEintrag;
  aktion: ReactNode;
  onWaehlen: (schluessel: string) => void;
}) {
  const { token, rollen } = useRollen();
  const istEinsatzort = eintrag.typ === 'einsatzort';
  const name = (
    <span style={{ minWidth: 0, overflowWrap: 'anywhere' }}>
      {istEinsatzort ? (
        <>
          {OBJEKTART.einsatzort}
          {eintrag.verortet && eintrag.label !== OBJEKTART.einsatzort && (
            <span style={{ display: 'block', fontSize: token.fontSizeSM, color: rollen.text2 }}>
              {eintrag.label}
            </span>
          )}
        </>
      ) : eintrag.typ === 'fahrzeug' ? (
        // Funkrufnamen immer Mono (Gestaltungssprache).
        <span style={monoStil(token.fontSize)}>{eintrag.label}</span>
      ) : (
        eintrag.label
      )}
    </span>
  );
  const rechts =
    aktion ??
    (eintrag.verortet ? null : (
      <span style={{ color: rollen.gedaempft, whiteSpace: 'nowrap' }}>nicht verortet</span>
    ));
  return (
    <ListenEintrag
      actions={rechts != null ? [rechts] : []}
      style={{
        paddingBlock: 0,
        paddingInlineStart: 0,
        paddingInlineEnd: rechts != null ? token.padding : 0,
      }}
    >
      {istWaehlbar(eintrag) ? (
        <button
          type="button"
          className="lfh-objektzeile"
          style={objektZeileStil(token)}
          onClick={() => onWaehlen(eintrag.schluessel)}
        >
          {name}
        </button>
      ) : (
        <div style={{ ...objektZeileStil(token), cursor: 'default' }}>{name}</div>
      )}
    </ListenEintrag>
  );
}

/**
 * Die Gruppe „Adresse“ einer Enter-Suche. Eigene Komponente, weil nur sie den Server fragt: ohne
 * Ortssuche braucht `MarkerSuche` keinen `QueryClientProvider`.
 */
function AdressGruppe({
  einsatzId,
  anfrage,
  onOrtWaehlen,
  erledigtRef,
  eintrag,
}: {
  einsatzId: number;
  anfrage: AdressAnfrage;
  onOrtWaehlen: (ort: GefundenerOrt) => void;
  /** Nummer der zuletzt erledigten Anfrage (Direktflug höchstens einmal je Enter). */
  erledigtRef: MutableRefObject<number | null>;
  eintrag: (ort: GefundenerOrt) => ReactNode;
}) {
  const { token } = theme.useToken();
  const adresse = useQuery({
    queryKey: einsatzKeys.ortSuche(einsatzId, anfrage.begriff),
    queryFn: () => sucheOrt(einsatzId, anfrage.begriff),
    // Ein Fehlzustand ist sofort veraltet: beim nächsten Einhängen fragt die Gruppe neu.
    staleTime: (q) => (q.state.data?.zustand === 'ok' ? ADRESSE_FRISCH_MS : 0),
    retry: false,
  });
  const { refetch, isError, data } = adresse;

  // Ein neues Enter auf denselben Begriff (gleicher Key, Gruppe bleibt eingehängt) fragt nach einem
  // Fehlzustand neu, wie „Erneut suchen“. Treffer kommen aus dem Cache.
  const gefragtFuerRef = useRef(anfrage.nr);
  useEffect(() => {
    if (gefragtFuerRef.current === anfrage.nr) return;
    gefragtFuerRef.current = anfrage.nr;
    if (isError || (data != null && data.zustand !== 'ok')) void refetch();
  }, [anfrage.nr, isError, data, refetch]);
  const orte = useMemo<GefundenerOrt[]>(
    () =>
      adresse.data?.zustand === 'ok'
        ? adresse.data.treffer.map((t) => ({
            lat: t.lat,
            lon: t.lon,
            beschriftung: t.name,
            art: 'adresse' as const,
          }))
        : [],
    [adresse.data],
  );

  // Genau ein Treffer fliegt ohne Klick hin — einmal je Enter, auch aus dem Cache. Ein Nachladen
  // derselben Antwort fliegt nicht noch einmal. Ein Fehlzustand verbraucht das Enter nicht: kommt
  // nach dem neuen Versuch ein Treffer, fliegt die Karte.
  useEffect(() => {
    if (data?.zustand !== 'ok' || erledigtRef.current === anfrage.nr) return;
    erledigtRef.current = anfrage.nr;
    if (orte.length === 1) onOrtWaehlen(orte[0]);
  }, [data, anfrage.nr, erledigtRef, orte, onOrtWaehlen]);

  const aussage = adressAussage(anfrage.begriff, adresse.data, adresse.isError);
  const nochmal = isError || (data != null && data.zustand !== 'ok');

  return (
    <Liste
      size="small"
      kopf={{ inhalt: 'Adresse', unterEbene: 1 }}
      dataSource={orte}
      rowKey={(o, i) => `${i}:${o.lat},${o.lon}`}
      loading={adresse.isPending}
      emptyText={
        aussage && (
          <span
            style={{
              display: 'inline-flex',
              flexWrap: 'wrap',
              alignItems: 'center',
              gap: token.marginXS,
            }}
          >
            {aussage}
            {/* Ein Fehlzustand nennt den Ausweg als Knopf statt als Satz (LFH-1083). */}
            {nochmal && (
              <Button loading={adresse.isFetching} onClick={() => void refetch()}>
                Erneut suchen
              </Button>
            )}
          </span>
        )
      }
      style={{ marginBottom: token.marginXS }}
      renderItem={(o) => eintrag(o)}
    />
  );
}
