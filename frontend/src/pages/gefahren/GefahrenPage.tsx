import { useEffect, useId, useMemo, useState, type ReactNode } from 'react';
import { KEINE_BERECHTIGUNG, modulName } from '../../einsatz/modulRegistry';
import { useSprungSperre } from '../../einsatz/useSprungSperre';
import { Link, useParams, useSearchParams } from 'react-router';
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Breadcrumb, Button, Input, Space, Spin, Typography, theme } from 'antd';
import type { BewertungEingabe } from '../../api/gefahren';
import { einsatzKeys } from '../../api/queryKeys';
import {
  benenneGefahrengebiet,
  bestaetigeBeurteilung,
  gefahrengebietName,
  ladeGefahrengebiete,
  setzeBewertung,
} from '../../api/gefahren';
import { ladeEinsatz } from '../../api/einsaetze';
import { darfImEinsatzSchreiben } from '../../einsatz/schreibrecht';
import { useViewport } from '../../components/useViewport';
import { lagekartePfad } from '../../routing/deeplinks';
import { useQueryParamSelektion } from '../../routing/useQueryParamSelektion';
import { warnstufeFlaeche, warnstufeKarte } from '../../theme/statusFarben';
import { gefahrenMatrixAbfrage } from './gefahrenMatrixAbfrage';
import StatusTag from '../../components/StatusTag';
import GefahrenMatrix, { zellSchluessel } from './GefahrenMatrix';
import GefahrenBeurteilung from './GefahrenBeurteilung';
import { beurteilungText, istBeurteilt } from './beurteilung';
import { gebietAussage } from './gebietAussage';
import { Liste, ListenEintrag } from '../../components/Liste';
import { SeitenLeer } from '../../components/SeitenZustand';
import { gemeinsamerDatenstand } from '../../components/Datenstand';
import EinsatzSeite, { type SeitenNebenwege } from '../../components/EinsatzSeite';
import { Paneel } from '../../components/instrument';
import { InlineAngabe } from '../../components/InlineAngabe';
import { KennungsLink } from '../../components/kennungsLink';
import { einsatzRechteGrund } from '../../components/nurAnsicht';
import { RechteHinweis, SpeicherFehler } from '../../components/SpeicherHinweis';
import Druckkopf from '../../components/druck/Druckkopf';
import { useDruckNebenwege } from '../../components/druck/useDruckNebenwege';
import { useAnzeigeKonventionen } from '../../anzeige/AnzeigeKonventionenContext';
import './gefahrenPrint.css';

/**
 * Trefflächenboden der Gebietszeile. Sie ist ein handgebautes Bedienziel (`ListenEintrag` legt
 * `onClick` auf ein nacktes `<div>`), ihre Höhe käme sonst nur aus der Polsterung der kleinen Liste
 * — im Handschuh-Betrieb grob 36 px statt 72. Deshalb zwei Angaben: `minHeight` aus `controlHeight`
 * plus Polsterung (ohne die klebte der Text an der Kante).
 *
 * Aufgelöste Tokens, nie `var(--lfh-*)` (Arbeitsteilung in `theme/rollen.css`). Schablone ist
 * `bedienzielStil` in `pages/lagekarte/Sidebar.tsx`, importiert wird bewusst nichts.
 * `display`/`alignItems` setzt `ListenEintrag` selbst. Rein und exportiert, damit die Zusicherung
 * ohne Render prüfbar ist.
 *
 * Nicht gelöst: Tastaturbedienbarkeit des `<div onClick>` (LFH-335).
 */
export function gebietszeileStil(token: {
  controlHeight: number;
  paddingSM: number;
  padding: number;
}) {
  return {
    cursor: 'pointer',
    minHeight: token.controlHeight,
    padding: `${token.paddingSM}px ${token.padding}px`,
  } as const;
}

export default function GefahrenPage() {
  const { id } = useParams();
  const einsatzId = Number(id);
  // Sprünge auf die Lagekarte nur, wenn sie frei ist (LFH-888, design.md D4).
  const karteGesperrt = useSprungSperre(einsatzId)('lagekarte');
  const qc = useQueryClient();

  const { token } = theme.useToken();
  const [gewaehlt, setGewaehlt] = useState<number | null>(null);
  const titelId = useId();
  const [searchParams] = useSearchParams();
  const { abBreite } = useViewport();
  const breit = abBreite('lg');
  // Druck des gewählten Gebiets (LLH-1364): „Drucken / als PDF“ als Nebenweg des Seitenkopfs.
  const druckWege = useDruckNebenwege();
  const { formatZeit } = useAnzeigeKonventionen();

  const einsatzQuery = useQuery({
    queryKey: einsatzKeys.einsatz(einsatzId),
    queryFn: () => ladeEinsatz(einsatzId),
  });
  const gebieteQuery = useQuery({
    queryKey: einsatzKeys.gefahrengebiete(einsatzId),
    queryFn: () => ladeGefahrengebiete(einsatzId),
  });

  // Stabile Referenz → der Auswahl-Effekt läuft nicht bei jedem Render neu.
  const gebiete = useMemo(() => gebieteQuery.data ?? [], [gebieteQuery.data]);
  // Das Deeplink-Ziel `?gefahrengebiet=<id>` wird EINMAL angewandt und geräumt (apply-then-clean).
  // Eigener Effekt, getaktet nur über die Adresse: hinge er an `gewaehlt`, wendete ein Klick das
  // Ziel erneut an, solange der Data Router das Räumen noch nicht übernommen hat — die Auswahl
  // sprang zurück (LFH-1153).
  useQueryParamSelektion('gefahrengebiet', gebieteQuery.isSuccess, (ziel) => {
    if (gebiete.some((g) => g.id === ziel)) setGewaehlt(ziel);
  });
  // Default aufs erste Gebiet bzw. korrigieren, wenn das gewählte verschwindet. Solange die Adresse
  // ein Ziel trägt, entscheidet der Deeplink (StrictMode-fest, LFH-150).
  const zielInAdresse = searchParams.has('gefahrengebiet');
  useEffect(() => {
    if (!gebieteQuery.isSuccess) return;
    if (gebiete.length === 0) {
      setGewaehlt(null);
      return;
    }
    if (zielInAdresse) return;
    if (gewaehlt == null || !gebiete.some((g) => g.id === gewaehlt)) setGewaehlt(gebiete[0].id);
  }, [gebieteQuery.isSuccess, gebiete, gewaehlt, zielInAdresse]);

  const matrixQuery = useQuery({
    // Dieselben Optionen wie die Gefahrengebiet-Vorschau der Sprungpalette.
    ...gefahrenMatrixAbfrage(einsatzId, gewaehlt),
    enabled: gewaehlt != null,
  });
  // Die Matrix jedes beurteilten Gebiets für den Zusatz der Gebietszeile („3 Gefahren · hoch“,
  // LLH-1102). Derselbe Schlüssel wie Lagebild und Matrix oben: Cache geteilt, das Live-Ereignis
  // `gefahr` invalidiert alle. Ein nicht beurteiltes Gebiet heißt „nicht beurteilt“ und braucht
  // keinen Abruf.
  const gebietsMatrizen = useQueries({
    queries: gebiete.map((g) => ({
      ...gefahrenMatrixAbfrage(einsatzId, g.id),
      enabled: istBeurteilt(g),
    })),
  });

  // Kein `onError`-Toast (LFH-966, „Speicherfehler an die Seite“): ein abgelehnter Stufenwechsel
  // steht als Hinweis über der Matrix, ein abgelehntes Detail-Speichern im Dialog. Zwei
  // Mutationen, damit jeder Fehler an SEINEM Ort steht und der eine den anderen nicht räumt.
  const bewertungGespeichert = () => {
    qc.invalidateQueries({ queryKey: einsatzKeys.gefahrenmatrix(einsatzId, gewaehlt) });
    qc.invalidateQueries({ queryKey: einsatzKeys.gefahrengebiete(einsatzId) });
  };
  const setzen = useMutation({
    mutationFn: (d: BewertungEingabe) => setzeBewertung(einsatzId, gewaehlt as number, d),
    onSuccess: bewertungGespeichert,
  });
  const detailsSetzen = useMutation({
    mutationFn: (d: BewertungEingabe) => setzeBewertung(einsatzId, gewaehlt as number, d),
    onSuccess: bewertungGespeichert,
  });
  const laufend = setzen.isPending ? setzen : detailsSetzen.isPending ? detailsSetzen : null;
  // Kein `onError`-Toast: `InlineAngabe` zeigt die Ablehnung an der Zeile (`mutateAsync` lehnt
  // ab). `onSuccess` gibt die Invalidierung zurück, damit `mutateAsync` erst mit dem neuen Namen
  // im Cache erfüllt.
  // Bestätigen der Beurteilung (LLH-1090): Antwort ist das Gebiet, die Liste lädt nach.
  const beurteilen = useMutation({
    mutationFn: (gebietId: number) => bestaetigeBeurteilung(einsatzId, gebietId),
    onSuccess: () => qc.invalidateQueries({ queryKey: einsatzKeys.gefahrengebiete(einsatzId) }),
  });
  // Ein Fehler gehört zu seinem Gebiet: beim Wechsel steht er nicht am nächsten.
  const beurteilenFehler =
    beurteilen.isError && beurteilen.variables === gewaehlt ? beurteilen.error : null;
  const umbenennen = useMutation({
    mutationFn: (label: string) => benenneGefahrengebiet(einsatzId, gewaehlt as number, label),
    onSuccess: () => qc.invalidateQueries({ queryKey: einsatzKeys.gefahrengebiete(einsatzId) }),
  });

  if (einsatzQuery.isLoading)
    return (
      <div style={{ textAlign: 'center', paddingTop: 80 }}>
        <Spin size="large" />
      </div>
    );
  if (einsatzQuery.isError || !einsatzQuery.data)
    return <Alert type="error" title="Einsatz nicht gefunden oder kein Zugriff" showIcon />;

  const einsatz = einsatzQuery.data;
  const darfSchreiben = darfImEinsatzSchreiben(einsatz);

  // Seitenkopf für alle Zweige unterhalb des Einsatzes (Laden, Fehler, leer, Matrix).
  const seite = (inhalt: ReactNode, dataUpdatedAt?: number, weitere?: SeitenNebenwege) => (
    <EinsatzSeite
      titel={modulName('gefahrenzonen')}
      weitere={weitere}

      meta={gebieteQuery.isSuccess ? `${gebiete.length} Gefahrengebiete` : undefined}
      dataUpdatedAt={dataUpdatedAt}
      breadcrumb={
        <Breadcrumb
          items={[
            { title: <Link to="/einsaetze">Einsätze</Link> },
            { title: einsatz.bezeichnung },
            { title: modulName('gefahrenzonen') },
          ]}
        />
      }
    >
      {inhalt}
    </EinsatzSeite>
  );

  if (gebieteQuery.isLoading)
    return seite(
      <div style={{ textAlign: 'center', paddingTop: 80 }}>
        <Spin size="large" />
      </div>,
    );
  if (gebieteQuery.isError)
    return seite(
      <Alert type="error" title="Gefahrengebiete konnten nicht geladen werden" showIcon />,
    );

  if (gebiete.length === 0) {
    /**
     * Ein Gefahrengebiet entsteht durch Zeichnen auf der Lagekarte — deshalb trägt dieser
     * Leerzustand die Primäraktion dorthin, als Zeichen-Auftrag (LFH-825, `routing/deeplinks.ts`):
     * die Karte beginnt sofort zu zeichnen. Der Knopf zeigt den Weg, kein Satz (LFH-1078). Ohne
     * Schreibrecht zeichnet die Karte nicht; dann steht kein Knopf, der es verspräche.
     */
    return seite(
      <div style={{ marginTop: 64, textAlign: 'center' }}>
        <SeitenLeer
          titel="Noch keine Gefahrengebiete"
          aktion={
            karteGesperrt || !darfSchreiben
              ? undefined
              : {
                  label: 'Gefahrengebiet zeichnen',
                  pfad: lagekartePfad(einsatzId, { zeichnen: { typ: 'gefahrengebiet' } }),
                }
          }
        />
      </div>,
      gebieteQuery.dataUpdatedAt,
    );
  }

  const aktuell = gebiete.find((g) => g.id === gewaehlt);
  // Zusatz je Gebietszeile, in der Reihenfolge von `gebiete` wie `gebietsMatrizen`.
  const aussagen = gebiete.map((g, i) => gebietAussage(g, gebietsMatrizen[i]?.data));
  // Gedruckt wird nur ein Gebiet mit geladener Matrix: vorher stünde eine Matrix ohne Aussage auf
  // dem Blatt (LLH-1364). Lesen genügt, wie bei jedem Druck.
  const druckbar = aktuell != null && matrixQuery.data !== undefined;

  const blatt = seite(
    <div
      data-gefahren-rahmen
      style={{
        display: 'flex',
        // Unter `lg` stapeln — dieselbe Schwelle wie die Drawer-Navigation in `EinsatzLayout.tsx`.
        // Die Matrix bleibt auch schmal eine Tabelle mit waagerechtem Bildlauf: Karten je
        // Gefahrentyp zerstörten den Überblick über beide Achsen. Begründung: Prüfliste Kriterium
        // 14 (`docs/superpowers/specs/2026-07-30-gefahrenmatrix-pruefliste.md`).
        flexDirection: breit ? 'row' : 'column',
        gap: token.margin,
        alignItems: breit ? 'flex-start' : 'stretch',
      }}
    >
      <Paneel
        titel="Gefahrengebiete"
        meta={String(gebiete.length)}
        className="gefahren-no-print"
        style={breit ? { width: 240, flexShrink: 0 } : { width: '100%' }}
      >
        <Liste
          size="small"
          dataSource={gebiete}
          renderItem={(g, i) => (
            <ListenEintrag
              onClick={() => setGewaehlt(g.id)}
              style={{
                // Trefflächenboden zuerst, die Färbung danach — `ListenEintrag` spreizt `style`
                // zuletzt, damit `padding` gegen die Längsformen der Liste gewinnt.
                ...gebietszeileStil(token),
                // `colorPrimaryBg` ist die Rolle `auswahlFlaeche` (LFH-984, `antdToken`): Text und
                // Beschreibung halten darauf den Textboden beider Modi.
                background: g.id === gewaehlt ? token.colorPrimaryBg : undefined,
              }}
            >
              {/* `wrap`: in der 240-px-Spalte bricht die Zeile zwischen den Angaben um, nicht in
                  einem Wort. */}
              <Space wrap>
                {/* Etikett über `StatusTag`, nicht `color`-Prop: für einen Nicht-Preset rechnet
                    antd ein statisches Farbpaar, der Modus erreichte es nicht. */}
                <StatusTag darstellung={warnstufeKarte[g.hoechste_warnstufe]} />
                <span>{gefahrengebietName(g.label, g.id)}</span>
                {/* Was im Gebiet los ist (LLH-1102): „3 Gefahren · hoch“, offen „nicht beurteilt“
                    (LLH-1090) — hier wählt man, was zu tun ist. Die Zonenzahl steht am Sprung zur
                    Karte. Ohne geladene Matrix kein Zusatz statt einer erfundenen Zahl. */}
                {aussagen[i] != null && (
                  <Typography.Text type="secondary" style={{ whiteSpace: 'nowrap' }}>
                    {aussagen[i]}
                  </Typography.Text>
                )}
              </Space>
            </ListenEintrag>
          )}
        />
      </Paneel>
      <Paneel
        titel="Bewertung"
        koerperPolster
        style={{ flex: 1, minWidth: 0, width: breit ? undefined : '100%' }}
      >
        {aktuell && (
          <div
            data-lfh="gefahrengebiet-kopf"
            className="gefahren-no-print"
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: `${token.marginXS}px ${token.margin}px`,
              marginBottom: token.marginXS,
            }}
          >
            {/* h3 unter dem Paneel „Bewertung" (h2); Satz bleibt der von h5. Reiner Text: das
                Umbenennen hat einen eigenen Auslöser (LFH-969) statt antds 13-px-Stift. */}
            <Typography.Title
              level={3}
              id={titelId}
              style={{ margin: 0, fontSize: token.fontSizeHeading5, minWidth: 0 }}
            >
              {gefahrengebietName(aktuell.label, aktuell.id)}
            </Typography.Title>
            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                alignItems: 'center',
                // `marginSM` (7/11/16): zwei Bedienziele halten den Zielabstand der Stufe.
                gap: token.marginSM,
              }}
            >
              {/* Pflichtangabe (frontend/AGENTS.md, „Inline-Bearbeitung und Status"): leer sendet
                  nichts. Früher setzte ein leerer Name still auf „Gefahrengebiet #<id>" zurück.
                  `key` je Gebiet: ein offener Entwurf wandert nicht ins nächste Gebiet. */}
              {/* Eigene Spalte: der Pflicht-Hinweis steht UNTER dem Knopf und schiebt den Sprung
                  nicht weg; das offene Formular bekommt eine lesbare Breite. */}
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: token.marginXXS,
                  minWidth: 0,
                }}
              >
                <InlineAngabe<string>
                  key={aktuell.id}
                  etikett="Bezeichnung"
                  wert={aktuell.label ?? ''}
                  anzeige={null}
                  leer={(w) => w.trim() === ''}
                  gleich={(a, b) => a.trim() === b.trim()}
                  darfSchreiben={darfSchreiben}
                  pflicht
                  eingabe={({ feld, value, onChange }) => (
                    <Input
                      {...feld}
                      value={value}
                      onChange={(e) => onChange(e.target.value)}
                      style={{ minWidth: 'min(16rem, 100%)' }}
                    />
                  )}
                  // Keine Größen-Prop: die Trefffläche kommt vom ConfigProvider (`controlHeight`).
                  ausloeser={({ ref, onClick }) => (
                    // Der Name ist die Handlung; die Überschrift nennt das Gebiet als Beschreibung.
                    <Button ref={ref} onClick={onClick} aria-describedby={titelId}>
                      Umbenennen
                    </Button>
                  )}
                  onSpeichern={(w) => umbenennen.mutateAsync(w.trim())}
                />
              </div>
              {/* Reverse-Deeplink zur Lagekarte (LFH-155): selektiert das Gebiet + fliegt es an.
                  Ein Sprung ist keine Handlung (LFH-616): EIN Link mit „↗", kein Knopf darin
                  (LFH-969). `KennungsLink` trägt den Boden, ein `<a>` erbt keine Steuerhöhe. */}
              {/* Die Zonenzahl steht beim Sprung (LLH-1102), außerhalb des Links: sein Name bleibt
                  die Handlung. Zahl vor Wort, mit Einheit (LFH-971). */}
              <span
                data-lfh="karte-zonen"
                style={{ display: 'inline-flex', alignItems: 'center', gap: token.marginXXS }}
              >
                {karteGesperrt ? (
                  <Button disabled title={KEINE_BERECHTIGUNG}>
                    Auf Karte zeigen
                  </Button>
                ) : (
                  <KennungsLink to={lagekartePfad(einsatzId, { gefahrengebiet: aktuell.id })}>
                    Auf Karte zeigen <span aria-hidden="true">↗</span>
                  </KennungsLink>
                )}
                <Typography.Text type="secondary" style={{ whiteSpace: 'nowrap' }}>
                  {`· ${aktuell.zonen_ids.length === 1 ? '1 Zone' : `${aktuell.zonen_ids.length} Zonen`}`}
                </Typography.Text>
              </span>
            </div>
          </div>
        )}
        {aktuell && (
          <GefahrenBeurteilung
            // Je Gebiet ein eigener Zustand: nichts wandert ins nächste.
            key={aktuell.id}
            // Auf Papier steht die Beurteilung im Druckkopf (`gefahrenPrint.css`).
            className="gefahren-no-print"
            gebiet={aktuell}
            darfSchreiben={darfSchreiben}
            matrixLaedt={matrixQuery.isPending}
            laeuft={beurteilen.isPending && beurteilen.variables === aktuell.id}
            fehler={beurteilenFehler}
            onBestaetigen={() => beurteilen.mutate(aktuell.id)}
          />
        )}
        {!darfSchreiben && (
          <div className="gefahren-no-print" style={{ marginBottom: 12 }}>
            <RechteHinweis sichtbar text={einsatzRechteGrund(einsatz.status)} />
          </div>
        )}
        {setzen.isError && (
          <div data-fehler className="gefahren-no-print" style={{ marginBottom: 12 }}>
            <SpeicherFehler fehler={setzen.error} titel="Bewertung nicht gespeichert" />
          </div>
        )}
        {matrixQuery.isError ? (
          <Alert type="error" title="Matrix konnte nicht geladen werden" showIcon />
        ) : (
          <GefahrenMatrix
            matrix={matrixQuery.data ?? []}
            // Ohne Daten zeigte jede Zelle „keine“ — eine Aussage, die niemand geprüft hat.
            laedt={matrixQuery.isPending}
            darfSchreiben={darfSchreiben}
            // Nur die Zelle des laufenden PUT sperren; `variables` ist genau die Eingabe der
            // laufenden Mutation, kein Parallel-State.
            laufendeZelle={
              laufend?.variables
                ? zellSchluessel(laufend.variables.gefahrentyp, laufend.variables.schutzobjekt)
                : null
            }
            onSetzen={(d) => setzen.mutate(d)}
            // `mutateAsync`: der Detail-Dialog braucht die Ablehnung, sonst leert die Hülle den
            // Wortlaut trotz 422. Den Grund zeigt der Dialog, die Ablehnung fängt `abschicken` in
            // der Hülle.
            onDetailsSpeichern={(d) => detailsSetzen.mutateAsync(d)}
            detailsFehler={detailsSetzen.error}
            onDetailsSchliessen={() => detailsSetzen.reset()}
          />
        )}
      </Paneel>
    </div>,
    gemeinsamerDatenstand(gebieteQuery.dataUpdatedAt, matrixQuery.dataUpdatedAt),
    { name: 'Weitere Aktionen zu den Gefahren', eintraege: druckbar ? druckWege : [] },
  );

  // Druckwurzel (LLH-1364): Mechanik in `druck/druck.css`, Eigenheiten in `gefahrenPrint.css`.
  // Gedruckt wird das gewählte Gebiet: Legende, Matrix und Liste „Erläuterungen“.
  return (
    <div className="gefahren-print-root" data-lfh="druckwurzel">
      {/* Nur auf Papier: Gebiet, Warnstufe und Beurteilung stehen am Schirm in Gebietsliste und
          Gebietskopf, die auf Papier wegfallen. */}
      {aktuell && (
        <Druckkopf
          dokumentart="Gefahrenbewertung"
          titel={gefahrengebietName(aktuell.label, aktuell.id)}
          einsatz={einsatz}
          sichtbarkeit="druck"
          zeilen={[
            { etikett: 'Warnstufe', wert: warnstufeFlaeche[aktuell.hoechste_warnstufe].label },
            { etikett: 'Beurteilung', wert: beurteilungText(aktuell, formatZeit) },
          ]}
        />
      )}
      {blatt}
    </div>
  );
}
