import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, App, Breadcrumb, Button, Space, Spin, Typography, theme } from 'antd';
import type { BewertungEingabe } from '../../api/gefahren';
import { ApiError } from '../../api/client';
import { einsatzKeys } from '../../api/queryKeys';
import {
  benenneGefahrengebiet,
  gefahrengebietName,
  ladeGefahrengebiete,
  setzeBewertung,
} from '../../api/gefahren';
import { ladeEinsatz } from '../../api/einsaetze';
import { darfImEinsatzSchreiben } from '../../einsatz/schreibrecht';
import { useAuth } from '../../auth/AuthContext';
import { useViewport } from '../../components/useViewport';
import { lagekartePfad, parseRouteId } from '../../routing/deeplinks';
import { warnstufeKarte } from '../../theme/statusFarben';
import { gefahrenMatrixAbfrage } from './gefahrenMatrixAbfrage';
import StatusTag from '../../components/StatusTag';
import GefahrenMatrix, { zellSchluessel } from './GefahrenMatrix';
import { Liste, ListenEintrag } from '../../components/Liste';
import { SeitenLeer } from '../../components/SeitenZustand';
import { gemeinsamerDatenstand } from '../../components/Datenstand';
import EinsatzSeite from '../../components/EinsatzSeite';
import { Paneel } from '../../components/instrument';

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
  const { benutzer } = useAuth();
  const qc = useQueryClient();
  const { message } = App.useApp();
  const { token } = theme.useToken();
  const [gewaehlt, setGewaehlt] = useState<number | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const { abBreite } = useViewport();
  const breit = abBreite('lg');

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
  // Auswahl in einem Effekt, damit StrictMode-fest: das Deeplink-Ziel `?gefahrengebiet=<id>` hat
  // Vorrang vor dem Default aufs erste Gebiet und wird danach geräumt (apply-then-clean). Sonst
  // erstes Gebiet defaulten bzw. korrigieren, wenn das gewählte verschwindet.
  useEffect(() => {
    if (!gebieteQuery.isSuccess) return;
    if (gebiete.length === 0) {
      setGewaehlt(null);
      return;
    }
    const ziel = parseRouteId(searchParams.get('gefahrengebiet') ?? undefined);
    if (ziel != null && gebiete.some((g) => g.id === ziel)) {
      setGewaehlt(ziel);
      // searchParams nicht in-place mutieren — sonst sähe der zweite StrictMode-Durchlauf das Ziel
      // nicht mehr.
      const naechste = new URLSearchParams(searchParams);
      naechste.delete('gefahrengebiet');
      setSearchParams(naechste, { replace: true });
      return;
    }
    if (gewaehlt == null || !gebiete.some((g) => g.id === gewaehlt)) setGewaehlt(gebiete[0].id);
  }, [gebieteQuery.isSuccess, gebiete, gewaehlt, searchParams, setSearchParams]);

  const matrixQuery = useQuery({
    // Dieselben Optionen wie die Gefahrengebiet-Vorschau der Sprungpalette.
    ...gefahrenMatrixAbfrage(einsatzId, gewaehlt),
    enabled: gewaehlt != null,
  });

  const fehler = (e: unknown) =>
    message.error(e instanceof ApiError ? e.message : 'Aktion fehlgeschlagen');
  const setzen = useMutation({
    mutationFn: (d: BewertungEingabe) => setzeBewertung(einsatzId, gewaehlt as number, d),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: einsatzKeys.gefahrenmatrix(einsatzId, gewaehlt) });
      qc.invalidateQueries({ queryKey: einsatzKeys.gefahrengebiete(einsatzId) });
    },
    onError: fehler,
  });
  const umbenennen = useMutation({
    mutationFn: (label: string) => benenneGefahrengebiet(einsatzId, gewaehlt as number, label),
    onSuccess: () => qc.invalidateQueries({ queryKey: einsatzKeys.gefahrengebiete(einsatzId) }),
    onError: fehler,
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
  const darfSchreiben = darfImEinsatzSchreiben(einsatz, benutzer);

  // Seitenkopf für alle Zweige unterhalb des Einsatzes (Laden, Fehler, leer, Matrix).
  const seite = (inhalt: ReactNode, dataUpdatedAt?: number) => (
    <EinsatzSeite
      titel="Gefahrenmatrix"

      meta={gebieteQuery.isSuccess ? `${gebiete.length} Gefahrengebiete` : undefined}
      dataUpdatedAt={dataUpdatedAt}
      breadcrumb={
        <Breadcrumb
          items={[
            { title: <Link to="/einsaetze">Einsätze</Link> },
            { title: einsatz.bezeichnung },
            { title: 'Gefahrenmatrix' },
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
     * Leerzustand eine Primäraktion dorthin (Ziel aus `routing/deeplinks.ts`).
     */
    return seite(
      <div style={{ marginTop: 64, textAlign: 'center' }}>
        <SeitenLeer
          titel="Noch keine Gefahrengebiete"
          hinweis="Auf der Lagekarte ein Gefahrengebiet zeichnen."
          aktion={{ label: 'Zur Lagekarte', pfad: lagekartePfad(einsatzId) }}
        />
      </div>,
      gebieteQuery.dataUpdatedAt,
    );
  }

  const aktuell = gebiete.find((g) => g.id === gewaehlt);

  return seite(
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
        style={breit ? { width: 240, flexShrink: 0 } : { width: '100%' }}
      >
        <Liste
          size="small"
          dataSource={gebiete}
          renderItem={(g) => (
            <ListenEintrag
              onClick={() => setGewaehlt(g.id)}
              style={{
                // Trefflächenboden zuerst, die Färbung danach — `ListenEintrag` spreizt `style`
                // zuletzt, damit `padding` gegen die Längsformen der Liste gewinnt.
                ...gebietszeileStil(token),
                // `colorPrimaryBg` leitet antd aus unserer Rolle `colorPrimary` ab — hält in beiden
                // Modi.
                background: g.id === gewaehlt ? token.colorPrimaryBg : undefined,
              }}
            >
              <Space>
                {/* Etikett über `StatusTag`, nicht `color`-Prop: für einen Nicht-Preset rechnet
                    antd ein statisches Farbpaar, der Modus erreichte es nicht. */}
                <StatusTag darstellung={warnstufeKarte[g.hoechste_warnstufe]} />
                <span>{gefahrengebietName(g.label, g.id)}</span>
                <Typography.Text type="secondary">({g.zonen_ids.length})</Typography.Text>
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
            style={{
              display: 'flex',
              alignItems: 'baseline',
              justifyContent: 'space-between',
              gap: 12,
            }}
          >
            <Typography.Title
              // h3 unter dem Paneel „Bewertung" (h2); Satz bleibt der von h5.
              level={3}
              style={{ marginTop: 0, fontSize: token.fontSizeHeading5 }}
              editable={
                darfSchreiben
                  ? {
                      onChange: (v) => {
                        const t = v.trim();
                        if (t !== (aktuell.label ?? '')) umbenennen.mutate(t);
                      },
                    }
                  : false
              }
            >
              {gefahrengebietName(aktuell.label, aktuell.id)}
            </Typography.Title>
            {/* Reverse-Deeplink zur Lagekarte (LFH-155): selektiert das Gebiet + fliegt es an. */}
            {/* Keine Größen-Prop: die Trefffläche kommt vom ConfigProvider. */}
            <Link to={lagekartePfad(einsatzId, { gefahrengebiet: aktuell.id })}>
              <Button>Auf Karte zeigen</Button>
            </Link>
          </div>
        )}
        {!darfSchreiben && (
          <Alert
            type="info"
            showIcon
            title="Nur Lesezugriff – Bewertungen können nicht geändert werden."
            style={{ marginBottom: 12 }}
          />
        )}
        {matrixQuery.isError ? (
          <Alert type="error" title="Matrix konnte nicht geladen werden" showIcon />
        ) : (
          <GefahrenMatrix
            matrix={matrixQuery.data ?? []}
            darfSchreiben={darfSchreiben}
            // Nur die Zelle des laufenden PUT sperren; `variables` ist genau die Eingabe der
            // laufenden Mutation, kein Parallel-State.
            laufendeZelle={
              setzen.isPending && setzen.variables
                ? zellSchluessel(setzen.variables.gefahrentyp, setzen.variables.schutzobjekt)
                : null
            }
            onSetzen={(d) => setzen.mutate(d)}
            // `mutateAsync`: der Detail-Dialog braucht die Ablehnung, sonst leert die Hülle den
            // Wortlaut trotz 422. Den Toast macht `onError`, die Ablehnung fängt `abschicken` in
            // der Hülle.
            onDetailsSpeichern={(d) => setzen.mutateAsync(d)}
          />
        )}
      </Paneel>
    </div>,
    gemeinsamerDatenstand(gebieteQuery.dataUpdatedAt, matrixQuery.dataUpdatedAt),
  );
}
