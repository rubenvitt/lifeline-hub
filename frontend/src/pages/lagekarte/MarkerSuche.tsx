import { IkoneLupe } from '../../ikonen';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { MutableRefObject, ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Input, Typography, theme } from 'antd';
import { Liste, ListenEintrag } from '../../components/Liste';
import { SeitenLeer } from '../../components/SeitenZustand';
import { monoStil } from '../../components/instrument';
import { useAnzeigeKonventionen } from '../../anzeige/AnzeigeKonventionenContext';
import { erkenneKoordinate } from '../../anzeige/koordinatenErkennung';
import { adressBegriff, type GefundenerOrt } from '../../anzeige/ortssuche';
import { einsatzKeys } from '../../api/queryKeys';
import { sucheOrt, type OrtSucheAntwort } from '../../api/karteOrtSuche';
/*
 * Wert-Import aus `./Sidebar`, die ihrerseits `MarkerSuche` importiert — ein bewusster Zyklus:
 * `bedienzielStil` ist das repo-weit zitierte Referenzmuster und bleibt an seinem Ort.
 * Laufzeitsicher, weil es eine gehobene `export function` ist, die erst beim Rendern läuft. Wer aus
 * `Sidebar` eine Konstante auf Modulebene ableitet, bricht das.
 */
import { bedienzielStil } from './Sidebar';
import type { KarteMarker } from './marker';
import { gruppiereTreffer } from './objektsuche';

/**
 * Suchfeld über die wählbaren verorteten Kartenobjekte — eine Liste, keine Tabelle (hier wird
 * gesucht und angesprungen, nicht verglichen).
 *
 * Leere Gruppen fallen weg, der Leerzustand steht einmal (`Liste` baute sonst je Gruppe einen).
 * Welche Objekte hier stehen, entscheidet der Aufrufer über `suchbareMarker` (`objektsuche.ts`),
 * dort sitzen die Modulsperren. Keine Entprellung: gefiltert wird lokal.
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
}

interface MarkerSucheProps {
  marker: KarteMarker[];
  onMarkerWaehlen: (schluessel: string) => void;
  /** Eine Lagebild-Quelle ist ausgefallen — dann steht „—" statt einer Zahl und keine Leere. */
  zaehlerUnbekannt?: boolean;
  /** Fehlt sie (kein Einsatz-Kontext), bleibt das Feld reine Objektsuche. */
  ortssuche?: Ortssuche;
}

/** Eine Enter-Suche: der Begriff und ihre laufende Nummer (je Enter eine neue). */
interface AdressAnfrage {
  begriff: string;
  nr: number;
}

/** Frische der Adresstreffer im Client: ein zweites Enter auf denselben Begriff fragt nicht. */
const ADRESSE_FRISCH_MS = 10 * 60_000;

/** Die eine Aussage der Gruppe „Adresse“, wenn sie keine Treffer zeigt. */
function adressAussage(
  begriff: string,
  antwort: OrtSucheAntwort | undefined,
  fehler: boolean,
): string | null {
  if (fehler || antwort?.zustand === 'nicht_erreichbar') {
    return 'Adresssuche nicht erreichbar — eine Koordinate lässt sich trotzdem anspringen.';
  }
  if (antwort?.zustand === 'ausgelastet') {
    return 'Adresssuche gerade ausgelastet — in einer Sekunde erneut Enter drücken.';
  }
  if (antwort?.zustand === 'ok' && antwort.treffer.length === 0) {
    return `Keine Adresse zu „${begriff}“ gefunden`;
  }
  return null;
}

export default function MarkerSuche({
  marker,
  onMarkerWaehlen,
  zaehlerUnbekannt,
  ortssuche,
}: MarkerSucheProps) {
  const { token } = theme.useToken();
  const [suche, setSuche] = useState('');
  const [anfrage, setAnfrage] = useState<AdressAnfrage | null>(null);
  const gruppen = useMemo(() => gruppiereTreffer(marker, suche), [marker, suche]);
  const begriff = suche.trim();
  const zaehler = (n: number) => (zaehlerUnbekannt ? '—' : String(n));

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
  const koordinate = useMemo<GefundenerOrt | null>(() => {
    if (!mitOrtssuche) return null;
    const punkt = erkenneKoordinate(suche);
    if (!punkt) return null;
    return { ...punkt, beschriftung: formatKoordinate(punkt.lat, punkt.lon) };
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
  const ortEintrag = (ort: GefundenerOrt, mono: boolean) => (
    <ListenEintrag style={bedienzielStil(token)} onClick={() => ortssuche?.onOrtWaehlen(ort)}>
      {mono ? <span style={monoStil(token.fontSize)}>{ort.beschriftung}</span> : ort.beschriftung}
    </ListenEintrag>
  );

  return (
    <div>
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
            <IkoneLupe />
          </span>
        }
        style={{ marginBottom: token.marginXS }}
      />

      {koordinate && (
        <Liste
          size="small"
          kopf={{ inhalt: 'Koordinate', unterEbene: 2 }}
          dataSource={[koordinate]}
          rowKey={(o) => `${o.lat},${o.lon}`}
          style={{ marginBottom: token.marginXS }}
          renderItem={(o) => ortEintrag(o, true)}
        />
      )}

      {adresseSichtbar && (
        <AdressGruppe
          einsatzId={ortssuche.einsatzId}
          anfrage={anfrage}
          onOrtWaehlen={ortssuche.onOrtWaehlen}
          erledigtRef={erledigtRef}
          eintrag={(o) => ortEintrag(o, false)}
        />
      )}

      {gruppen.length === 0 && ortsGruppen ? (
        // Über den Objekten steht schon ein Ort: kein Leerzustand der ganzen Fläche, nur der knappe
        // Hinweis (MODIFIED `lagekarte-objektsuche`). Im Fehlerfall sagt er, dass die Liste
        // unvollständig ist, statt Leere zu behaupten.
        <Typography.Text type="secondary" style={{ display: 'block', padding: token.paddingXS }}>
          {zaehlerUnbekannt
            ? 'Verortete Objekte konnten nicht vollständig geladen werden'
            : `Kein Kartenobjekt zu „${begriff}“`}
        </Typography.Text>
      ) : gruppen.length === 0 ? (
        // Der Fehlerzweig steht vorn: „Nichts verortet" wäre eine Aussage über die Lage, die im
        // Fehlerfall niemand geprüft hat.
        <SeitenLeer
          titel={
            zaehlerUnbekannt
              ? 'Verortete Objekte konnten nicht vollständig geladen werden'
              : begriff !== ''
                ? `Kein Kartenobjekt zu „${begriff}“`
                : 'Nichts verortet'
          }
          hinweis={
            zaehlerUnbekannt
              ? 'Was hier steht, ist unvollständig — die Karte zeigt womöglich mehr.'
              : begriff !== ''
                ? 'Suchbegriff kürzen oder Schreibweise prüfen.'
                : 'Objekte erscheinen hier, sobald sie auf der Karte platziert sind.'
          }
        />
      ) : (
        gruppen.map((g) => (
          <Liste
            key={g.typ}
            size="small"
            kopf={{
              // Template-Literal, damit die Zeile EIN Textknoten bleibt.
              inhalt: `${g.label} (${zaehler(g.treffer.length)})`,
              // Einziger Einbauort ist das Paneel „Verortet" in `Sidebar`, dessen Kopf ein `<h2>`
              // ist (`KlappPaneel`).
              unterEbene: 2,
            }}
            dataSource={g.treffer}
            rowKey={(m) => m.schluessel}
            style={{ marginBottom: token.marginXS }}
            renderItem={(m) => (
              <ListenEintrag
                style={bedienzielStil(token)}
                onClick={() => onMarkerWaehlen(m.schluessel)}
              >
                {m.label}
              </ListenEintrag>
            )}
          />
        ))
      )}
    </div>
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
    staleTime: ADRESSE_FRISCH_MS,
    retry: false,
  });
  const orte = useMemo<GefundenerOrt[]>(
    () =>
      adresse.data?.zustand === 'ok'
        ? adresse.data.treffer.map((t) => ({ lat: t.lat, lon: t.lon, beschriftung: t.name }))
        : [],
    [adresse.data],
  );

  // Genau ein Treffer fliegt ohne Klick hin — einmal je Enter, auch aus dem Cache. Ein Nachladen
  // derselben Antwort fliegt nicht noch einmal.
  useEffect(() => {
    if (!adresse.data || erledigtRef.current === anfrage.nr) return;
    erledigtRef.current = anfrage.nr;
    if (orte.length === 1) onOrtWaehlen(orte[0]);
  }, [adresse.data, anfrage.nr, erledigtRef, orte, onOrtWaehlen]);

  return (
    <Liste
      size="small"
      kopf={{ inhalt: 'Adresse', unterEbene: 2 }}
      dataSource={orte}
      rowKey={(o, i) => `${i}:${o.lat},${o.lon}`}
      loading={adresse.isPending}
      emptyText={adressAussage(anfrage.begriff, adresse.data, adresse.isError)}
      style={{ marginBottom: token.marginXS }}
      renderItem={(o) => eintrag(o)}
    />
  );
}
