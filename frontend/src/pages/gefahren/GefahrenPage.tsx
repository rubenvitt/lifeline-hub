import { useEffect, useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, App, Button, Space, Spin, Tag, Typography, theme } from 'antd';
import type { BewertungEingabe } from '../../api/gefahren';
import { ApiError } from '../../api/client';
import { einsatzKeys } from '../../api/queryKeys';
import {
  benenneGefahrengebiet,
  gefahrengebietName,
  ladeGefahrengebiete,
  ladeMatrix,
  setzeBewertung,
} from '../../api/gefahren';
import { ladeEinsatz } from '../../api/einsaetze';
import { darfImEinsatzSchreiben } from '../../einsatz/schreibrecht';
import { useAuth } from '../../auth/AuthContext';
import { useViewport } from '../../components/useViewport';
import { lagekartePfad, parseRouteId } from '../../routing/deeplinks';
import { rollenFarbe, warnstufeKarte } from '../../theme/statusFarben';
import GefahrenMatrix, { zellSchluessel } from './GefahrenMatrix';
import { Liste, ListenEintrag } from '../../components/Liste';
import { SeitenLeer } from '../../components/SeitenZustand';
import Datenstand, { gemeinsamerDatenstand } from '../../components/Datenstand';

/**
 * Trefflächenboden der Gebietszeile (Abschluss-Review zu LFH-368 · B5h, Konvention aus
 * LFH-365).
 *
 * Die Zeile ist ein HANDGEBAUTES Bedienziel: `ListenEintrag` legt sein `onClick` auf ein
 * nacktes `<div>` (`components/Liste.tsx:160-180`), und dessen Höhe entstand hier allein aus
 * der Polsterung der `<Liste size="small">` — `paddingBlock = token.paddingXS`, also 3 / 5 / 7 px.
 * Gerechnet kommt die Zeile damit im Handschuh-Betrieb auf grob 36 px gegen die geforderten 72.
 * Deshalb ZWEI Angaben und nicht eine: `minHeight` aus `controlHeight` (30 / 48 / 72) PLUS die
 * Polsterung. Die Polsterung allein trüge den Boden ebenfalls nicht (grob 54 px), sie muss aber
 * da sein, sonst klebt der Text an der Kante.
 *
 * Aufgelöste Tokens, nie `var(--lfh-*)`: die Arbeitsteilung steht in `theme/rollen.css`
 * („ZWEI QUELLEN, EINE WAHRHEIT") — handgeschriebenes CSS liest die Custom Properties, TSX liest
 * `theme.useToken()`.
 *
 * Schablone ist `bedienzielStil` in `pages/lagekarte/Sidebar.tsx`; **importiert wird von dort
 * nichts** — ein `pages/gefahren` → `pages/lagekarte`-Import wäre schlimmer als diese drei
 * Zeilen. `display`/`alignItems` stehen anders als dort nicht drin: `ListenEintrag` setzt beide
 * selbst, und eine Wiederholung sähe aus wie eine Absicht, die sie nicht ist.
 *
 * Rein und exportiert, damit die Zusicherung über zwei Dichtestufen prüfbar ist, OHNE zu rendern:
 * `test/utils.tsx` montiert ein nacktes `ConfigProvider` ohne unser Theme, ein gerenderter Wert
 * belegte also antd-Vorgaben statt der Staffel — und jsdom rechnet ohnehin kein Layout.
 *
 * **Was hier NICHT gelöst wird:** die Tastaturbedienbarkeit. Das `<div onClick>` hat weder `role`
 * noch `tabIndex` noch `onKeyDown`; die klickbare Zeile als Ganzes ist B7 (LFH-335) zugeordnet.
 * Der Boden hier ist die Trefffläche, nicht der ganze Zugang.
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
  // Auswahl in EINEM Effekt (kein Race → StrictMode-fest, LFH-150): das Deeplink-Ziel
  // ?gefahrengebiet=<id> (z. B. von der Lagekarte) hat Vorrang vor dem Default aufs erste
  // Gebiet; nach dem Anwenden wird der Param geräumt (apply-then-clean), damit eine spätere
  // manuelle Auswahl nicht wieder überschrieben wird. Sonst: erstes Gebiet defaulten bzw.
  // korrigieren, wenn das gewählte verschwindet.
  useEffect(() => {
    if (!gebieteQuery.isSuccess) return;
    if (gebiete.length === 0) {
      setGewaehlt(null);
      return;
    }
    const ziel = parseRouteId(searchParams.get('gefahrengebiet') ?? undefined);
    if (ziel != null && gebiete.some((g) => g.id === ziel)) {
      setGewaehlt(ziel);
      // searchParams NICHT in-place mutieren (.delete) — sonst sähe der zweite
      // StrictMode-Durchlauf das Ziel nicht mehr und defaultete aufs erste Gebiet.
      const naechste = new URLSearchParams(searchParams);
      naechste.delete('gefahrengebiet');
      setSearchParams(naechste, { replace: true });
      return;
    }
    if (gewaehlt == null || !gebiete.some((g) => g.id === gewaehlt)) setGewaehlt(gebiete[0].id);
  }, [gebieteQuery.isSuccess, gebiete, gewaehlt, searchParams, setSearchParams]);

  const matrixQuery = useQuery({
    queryKey: einsatzKeys.gefahrenmatrix(einsatzId, gewaehlt),
    queryFn: () => ladeMatrix(einsatzId, gewaehlt as number),
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

  if (gebieteQuery.isLoading)
    return (
      <div style={{ textAlign: 'center', paddingTop: 80 }}>
        <Spin size="large" />
      </div>
    );
  if (gebieteQuery.isError)
    return <Alert type="error" title="Gefahrengebiete konnten nicht geladen werden" showIcon />;

  if (gebiete.length === 0) {
    /**
     * Der Ort der Handlung liegt woanders (LFH-331 · B3): ein Gefahrengebiet entsteht
     * durch Zeichnen auf der Lagekarte, nicht auf dieser Seite. Deshalb trägt dieser
     * Leerzustand — anders als die reinen Kartenlisten — eine Primäraktion, und ihr Ziel
     * kommt aus `routing/deeplinks.ts`, nicht als Vorlagentext von Hand.
     *
     * Der Wortlaut ist derselbe wie vorher, nur auf Aussage und Hinweis aufgeteilt; die
     * Aufforderung „zeichnen" gehört jetzt an den Knopf, der auch dorthin führt.
     */
    return (
      <div style={{ marginTop: 64, textAlign: 'center' }}>
        <Datenstand dataUpdatedAt={gebieteQuery.dataUpdatedAt} />
        <SeitenLeer
          titel="Noch keine Gefahrengebiete"
          hinweis="Auf der Lagekarte ein Gefahrengebiet zeichnen."
          aktion={{ label: 'Zur Lagekarte', pfad: lagekartePfad(einsatzId) }}
        />
      </div>
    );
  }

  const aktuell = gebiete.find((g) => g.id === gewaehlt);

  return (
    <div
      data-gefahren-rahmen
      style={{
        display: 'flex',
        // Unter `lg` stapeln — dieselbe Schwelle, an der der Einsatzrahmen seine
        // Navigation in den Drawer legt (`EinsatzLayout.tsx`). KEIN zweites Layout für
        // die Matrix selbst: sie bleibt eine Tabelle und trägt auf schmalem Schirm
        // waagerechten Bildlauf (`scroll={{ x: 'max-content' }}`), statt in Karten je
        // Gefahrentyp aufgelöst zu werden — das zerstörte genau die Eigenschaft, für die
        // es die Matrix gibt (Muster über beide Achsen auf einen Blick), und ein
        // Collapse je Gefahrentyp wäre eine zweite Bedienform für dieselbe Sache.
        // Hier stand einmal eine Breite („~380 px"); sie war falsch gerechnet und ist
        // ersatzlos weg — die Entscheidung hängt nicht an ihr. Sie steht unabhängig
        // begründet in der Prüfliste, Kriterium **14** („Tabellenseite vollständig"):
        // `docs/superpowers/specs/2026-07-30-gefahrenmatrix-pruefliste.md`.
        flexDirection: breit ? 'row' : 'column',
        gap: 16,
        alignItems: breit ? 'flex-start' : 'stretch',
      }}
    >
      <Liste
        style={breit ? { width: 240, flexShrink: 0 } : { width: '100%' }}
        size="small"
        bordered
        header={
          <Space style={{ width: '100%', justifyContent: 'space-between' }}>
            <Typography.Text strong>Gefahrengebiete</Typography.Text>
            <Datenstand
              dataUpdatedAt={gemeinsamerDatenstand(
                gebieteQuery.dataUpdatedAt,
                matrixQuery.dataUpdatedAt,
              )}
            />
          </Space>
        }
        dataSource={gebiete}
        renderItem={(g) => (
          <ListenEintrag
            onClick={() => setGewaehlt(g.id)}
            style={{
              // Trefflächenboden ZUERST, die Färbung danach — beides landet über EIN `style`
              // im Aufrufer, und `ListenEintrag` spreizt es bewusst zuletzt
              // (`Liste.tsx:171-175`), damit die Kurzform `padding` gegen die Längsformen der
              // Liste gewinnt. Zöge jemand den Spread dort nach vorn, fiele genau die
              // Polsterungshälfte der „ZWEI Angaben"-Konvention still weg.
              ...gebietszeileStil(token),
              // Die Rolle `bedien`, nicht antds Default-Blau: `rgba(22,119,255,0.08)`
              // stand hier hartkodiert und blieb im Nachtmodus derselbe helle Schleier
              // auf dunklem Grund (LFH-368). `colorPrimaryBg` leitet antd aus
              // `colorPrimary` ab — also aus unserer Rolle, in beiden Modi.
              background: g.id === gewaehlt ? token.colorPrimaryBg : undefined,
            }}
          >
            <Space>
              {/* Etikett, nicht Fläche: `warnstufeKarte` liefert die Rolle, `rollenFarbe`
                  den Wert des aktiven Modus. Vorher stand hier `warnstufeFarbe` — dieselbe
                  Sortenverwechslung, die LFH-328 in `ZonenInspector.tsx` behoben hat. */}
              <Tag color={rollenFarbe(warnstufeKarte[g.hoechste_warnstufe].rolle, token)}>
                {warnstufeKarte[g.hoechste_warnstufe].label}
              </Tag>
              <span>{gefahrengebietName(g.label, g.id)}</span>
              <Typography.Text type="secondary">({g.zonen_ids.length})</Typography.Text>
            </Space>
          </ListenEintrag>
        )}
      />
      <div style={{ flex: 1, minWidth: 0 }}>
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
              level={5}
              style={{ marginTop: 0 }}
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
            {/* Keine Größen-Prop: die Trefffläche kommt vom ConfigProvider (30/48/72,
                LFH-362). Ein `size="small"` nagelte sie hier auf die kompakte Stufe
                fest — auch im Handschuh-Betrieb, wo derselbe Knopf 72 px braucht. */}
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
            // Nur die Zelle des laufenden PUT sperren. `variables` kommt von TanStack
            // Query und ist genau die Eingabe der laufenden Mutation — kein
            // Parallel-State, der auseinanderlaufen kann.
            laufendeZelle={
              setzen.isPending && setzen.variables
                ? zellSchluessel(setzen.variables.gefahrentyp, setzen.variables.schutzobjekt)
                : null
            }
            onSetzen={(d) => setzen.mutate(d)}
            // `mutateAsync`: der Detail-Dialog braucht die Ablehnung, sonst leert die
            // Erfassungshülle den getippten Wortlaut trotz 422. Den Toast macht weiterhin
            // `onError: fehler`; die abgelehnte Zusage fängt `abschicken` in der Hülle
            // (`Erfassung.tsx`, `catch {}`) — also keine unbehandelte Ablehnung.
            onDetailsSpeichern={(d) => setzen.mutateAsync(d)}
          />
        )}
      </div>
    </div>
  );
}
