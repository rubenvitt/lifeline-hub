import { useEffect, useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, App, Button, Space, Spin, Tag, Typography, theme } from 'antd';
import type { BewertungEingabe } from '../../api/gefahren';
import { ApiError } from '../../api/client';
import { einsatzKeys } from '../../api/queryKeys';
import { benenneGefahrengebiet, gefahrengebietName, ladeGefahrengebiete, ladeMatrix, setzeBewertung } from '../../api/gefahren';
import { ladeEinsatz } from '../../api/einsaetze';
import { darfImEinsatzSchreiben } from '../../einsatz/schreibrecht';
import { useAuth } from '../../auth/AuthContext';
import { lagekartePfad, parseRouteId } from '../../routing/deeplinks';
import { rollenFarbe, warnstufeKarte } from '../../theme/statusFarben';
import GefahrenMatrix from './GefahrenMatrix';
import { Liste, ListenEintrag } from '../../components/Liste';
import { SeitenLeer } from '../../components/SeitenZustand';

export default function GefahrenPage() {
  const { id } = useParams();
  const einsatzId = Number(id);
  const { benutzer } = useAuth();
  const qc = useQueryClient();
  const { message } = App.useApp();
  const { token } = theme.useToken();
  const [gewaehlt, setGewaehlt] = useState<number | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();

  const einsatzQuery = useQuery({ queryKey: einsatzKeys.einsatz(einsatzId), queryFn: () => ladeEinsatz(einsatzId) });
  const gebieteQuery = useQuery({ queryKey: einsatzKeys.gefahrengebiete(einsatzId), queryFn: () => ladeGefahrengebiete(einsatzId) });

  // Stabile Referenz → der Auswahl-Effekt läuft nicht bei jedem Render neu.
  const gebiete = useMemo(() => gebieteQuery.data ?? [], [gebieteQuery.data]);
  // Auswahl in EINEM Effekt (kein Race → StrictMode-fest, LFH-150): das Deeplink-Ziel
  // ?gefahrengebiet=<id> (z. B. von der Lagekarte) hat Vorrang vor dem Default aufs erste
  // Gebiet; nach dem Anwenden wird der Param geräumt (apply-then-clean), damit eine spätere
  // manuelle Auswahl nicht wieder überschrieben wird. Sonst: erstes Gebiet defaulten bzw.
  // korrigieren, wenn das gewählte verschwindet.
  useEffect(() => {
    if (!gebieteQuery.isSuccess) return;
    if (gebiete.length === 0) { setGewaehlt(null); return; }
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

  const fehler = (e: unknown) => message.error(e instanceof ApiError ? e.message : 'Aktion fehlgeschlagen');
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

  if (einsatzQuery.isLoading) return <div style={{ textAlign: 'center', paddingTop: 80 }}><Spin size="large" /></div>;
  if (einsatzQuery.isError || !einsatzQuery.data) return <Alert type="error" title="Einsatz nicht gefunden oder kein Zugriff" showIcon />;

  const einsatz = einsatzQuery.data;
  const darfSchreiben = darfImEinsatzSchreiben(einsatz, benutzer);

  if (gebieteQuery.isLoading) return <div style={{ textAlign: 'center', paddingTop: 80 }}><Spin size="large" /></div>;
  if (gebieteQuery.isError) return <Alert type="error" title="Gefahrengebiete konnten nicht geladen werden" showIcon />;

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
      <div style={{ marginTop: 64 }}>
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
    <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
      <Liste
        style={{ width: 240, flexShrink: 0 }}
        size="small"
        bordered
        header={<Typography.Text strong>Gefahrengebiete</Typography.Text>}
        dataSource={gebiete}
        renderItem={(g) => (
          <ListenEintrag
            onClick={() => setGewaehlt(g.id)}
            style={{
              cursor: 'pointer',
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
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 }}>
            <Typography.Title
              level={5}
              style={{ marginTop: 0 }}
              editable={darfSchreiben ? { onChange: (v) => { const t = v.trim(); if (t !== (aktuell.label ?? '')) umbenennen.mutate(t); } } : false}
            >
              {gefahrengebietName(aktuell.label, aktuell.id)}
            </Typography.Title>
            {/* Reverse-Deeplink zur Lagekarte (LFH-155): selektiert das Gebiet + fliegt es an. */}
            <Link to={lagekartePfad(einsatzId, { gefahrengebiet: aktuell.id })}>
              <Button size="small">Auf Karte zeigen</Button>
            </Link>
          </div>
        )}
        {!darfSchreiben && (
          <Alert type="info" showIcon title="Nur Lesezugriff – Bewertungen können nicht geändert werden." style={{ marginBottom: 12 }} />
        )}
        {matrixQuery.isError ? (
          <Alert type="error" title="Matrix konnte nicht geladen werden" showIcon />
        ) : (
          <GefahrenMatrix
            matrix={matrixQuery.data ?? []}
            darfSchreiben={darfSchreiben}
            pending={setzen.isPending}
            onSetzen={(d) => setzen.mutate(d)}
          />
        )}
      </div>
    </div>
  );
}
