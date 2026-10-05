import { IconPersonPlus } from '../../icons';
import { Alert, App, Breadcrumb, Button, Popconfirm, Space, Spin } from 'antd';
import { Link, Navigate, useNavigate, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useId, useState } from 'react';
import { ladeEinsatz } from '../../api/einsaetze';
import { darfImEinsatzSchreiben, istEinsatzLeitung } from '../../einsatz/schreibrecht';
import { useAuth } from '../../auth/AuthContext';
import {
  einsaetzePfad,
  einsatzPfad,
  parseRouteId,
  unfallhilfsstellenListePfad,
} from '../../routing/deeplinks';
import { useEinsatzPfade } from '../../routing/EinsatzPfade';
import { useGeraetDarf } from '../../geraet/geraetSicht';
import { ladeUhs, setzeUhsStatus, storniereUhs } from '../../api/einsatzUhs';
import { einsatzKeys } from '../../api/queryKeys';
import type { UhsStatus } from '../../api/types';
import EinsatzSeite from '../../components/EinsatzSeite';
import StatusTag from '../../components/StatusTag';
import { Segmentleiste } from '../../components/instrument';
import { uhsStatus, uhsTyp } from '../../theme/statusFarben';
import UhsSwitcher from './UhsSwitcher';
import { merkeLetzteUhs } from './uhsAuswahl';
import Grundriss from './Grundriss';
import MaterialTab from './MaterialTab';
import BewegungenTab from './BewegungenTab';
import UhsAnhaenge from './UhsAnhaenge';
import { useFehlerMeldung } from '../../components/useFehlerMeldung';

const REITER_NAME = {
  material: 'Material',
  bewegungen: 'Bewegungen',
  dateien: 'Dateien',
} as const;
type Reiter = keyof typeof REITER_NAME;

/** „Material, Bewegungen und Dateien“: der Name der Reiterleiste nennt, was sie führt. */
function aufzaehlung(namen: string[]): string {
  return namen.length < 2
    ? (namen[0] ?? '')
    : `${namen.slice(0, -1).join(', ')} und ${namen[namen.length - 1]}`;
}

export default function UhsDetailPage() {
  const { id, uhsId: uhsIdParam } = useParams();
  const einsatzId = Number(id);
  const navigate = useNavigate();
  // Ein gekoppeltes Gerät sieht nur, was seine Ansicht bedient (LFH-892, Scope-Matrix); für eine
  // Person ist alles frei. Die Wege führen in die Oberfläche, aus der man kommt.
  const darf = useGeraetDarf();
  const pfade = useEinsatzPfade();
  // Am Gerät stehen Material und Dateien im Bereich „UHS“ des Laptops (`geraet/GeraetStellePage`),
  // nicht unter dem Grundriss; hier bleibt dort nur der Verlauf.
  const { benutzer, geraet } = useAuth();
  const reiterListe: Reiter[] = [
    ...(!geraet && darf('uhs-material') ? (['material'] as const) : []),
    'bewegungen',
    // LFH-758: Fotos, Unterlagen und der Plan (Grundriss als Datei) der UHS.
    ...(!geraet && darf('uhs-anhaenge') ? (['dateien'] as const) : []),
  ];
  // Material/Bewegungen als Segmentleiste; nur das aktive Feld ist gebaut.
  const [reiter, setReiter] = useState<Reiter>(reiterListe[0]);
  const reiterFeld = useId();
  const uhsId = Number(uhsIdParam);
  const idGueltig = parseRouteId(uhsIdParam) != null;
  const listenPfad = unfallhilfsstellenListePfad(einsatzId);

  const qc = useQueryClient();
  const { message } = App.useApp();

  const einsatzQuery = useQuery({
    queryKey: einsatzKeys.einsatz(einsatzId),
    queryFn: () => ladeEinsatz(einsatzId),
  });
  const detailQuery = useQuery({
    queryKey: einsatzKeys.uhsDetail(einsatzId, uhsId),
    queryFn: () => ladeUhs(einsatzId, uhsId),
    enabled: idGueltig,
  });

  // Diese UHS als „zuletzt ausgewählt" merken — der Default-Einstieg landet wieder hier.
  // Ein Gerät kennt nur seine eine UHS und merkt sich nichts.
  const merkeUhs = darf('uhs-verwalten');
  useEffect(() => {
    if (merkeUhs && detailQuery.isSuccess) merkeLetzteUhs(einsatzId, uhsId);
  }, [einsatzId, uhsId, detailQuery.isSuccess, merkeUhs]);

  function invalidate() {
    qc.invalidateQueries({ queryKey: einsatzKeys.uhs(einsatzId) });
    qc.invalidateQueries({ queryKey: einsatzKeys.uhsDetail(einsatzId, uhsId) });
    qc.invalidateQueries({ queryKey: einsatzKeys.etb(einsatzId) });
  }
  const fehler = useFehlerMeldung();

  const statusMut = useMutation({
    mutationFn: (status: UhsStatus) => setzeUhsStatus(einsatzId, uhsId, status),
    onSuccess: () => {
      message.success('Status gewechselt');
      invalidate();
    },
    onError: fehler,
  });
  const stornoMut = useMutation({
    mutationFn: () => storniereUhs(einsatzId, uhsId),
    onSuccess: () => {
      message.success('UHS storniert');
      invalidate();
    },
    onError: fehler,
  });

  // Ungültige UHS-ID → zurück zur Liste (nach allen Hooks).
  if (!idGueltig) {
    return <Navigate to={listenPfad} replace />;
  }
  if (einsatzQuery.isLoading || detailQuery.isLoading) {
    return (
      <div style={{ textAlign: 'center', paddingTop: 80 }}>
        <Spin size="large" />
      </div>
    );
  }
  if (einsatzQuery.error || !einsatzQuery.data) {
    return <Alert type="error" title="Einsatz nicht gefunden oder kein Zugriff" showIcon />;
  }
  if (detailQuery.error || !detailQuery.data) {
    return <Alert type="error" title="UHS konnte nicht geladen werden" showIcon />;
  }

  const einsatz = einsatzQuery.data;
  const uhs = detailQuery.data;
  const schreibgeschuetzt = !darfImEinsatzSchreiben(einsatz, benutzer);
  const verwalten = !schreibgeschuetzt && darf('uhs-verwalten');

  // Typ und Standort sind Kopf-Meta; der Typ ist eine Kategorie (im Vertrag `neutral`), es zählt
  // nur seine Beschriftung aus `uhsTyp`. Die Notiz ist Freitext und bleibt Beschreibungszeile.
  const meta = [uhsTyp[uhs.typ].label, uhs.standort ?? 'ohne Standort'].join(' · ');

  return (
    <EinsatzSeite
      /* Der Titel trägt den Umschalter: hier wird zwischen Hilfsstellen gewechselt. */
      titel={
        // `wrap`: bei langem Namen rutscht der Status unter den Namen, statt auf 390 px
        // über den Rand zu ragen (gemessen 11 px, LFH-435).
        <Space wrap>
          {darf('uhs-verwalten') ? (
            <UhsSwitcher einsatzId={einsatzId} aktuelleUhs={uhs} />
          ) : (
            uhs.bezeichnung
          )}
          <StatusTag darstellung={uhsStatus[uhs.status]} />
        </Space>
      }
      meta={meta}
      beschreibung={uhs.notiz ? `Notiz: ${uhs.notiz}` : undefined}
      /* Datenstand im Kopf über das Primitiv — der Grundriss läuft live mit. */
      dataUpdatedAt={detailQuery.dataUpdatedAt}
      breadcrumb={
        darf('fremde-module') && (
          <Breadcrumb
            items={[
              { title: <Link to={einsaetzePfad()}>Einsätze</Link> },
              { title: <Link to={einsatzPfad(einsatzId)}>{einsatz.bezeichnung}</Link> },
              { title: <Link to={listenPfad}>Unfallhilfsstellen</Link> },
              { title: uhs.bezeichnung },
            ]}
          />
        )
      }
      aktionen={
        <Space wrap size="middle">
          {/* Die Zustände schließen sich aus; die Dev-Warnung des Primitivs zählt die
              Primäraktionen, der Test prüft beide Zustände. */}
          {!schreibgeschuetzt && uhs.status === 'aktiv' && (
            /* Aufnahme ohne Modulwechsel, nur im Betrieb: eine geplante UHS nimmt niemanden auf,
               dort steht „In Betrieb nehmen" als Primäraktion. */
            <Button
              type="primary"
              icon={<IconPersonPlus />}
              onClick={() => navigate(pfade.aufnahme(einsatzId, { uhs: uhs.id }))}
            >
              Patient aufnehmen
            </Button>
          )}
          {verwalten && uhs.status === 'geplant' && (
            <>
              <Button
                type="primary"
                onClick={() => statusMut.mutate('aktiv')}
                loading={statusMut.isPending}
              >
                In Betrieb nehmen
              </Button>
              <Popconfirm
                title="UHS stornieren?"
                onConfirm={() => stornoMut.mutate()}
                okButtonProps={{ danger: true }}
              >
                <Button danger>Stornieren</Button>
              </Popconfirm>
            </>
          )}
          {verwalten && uhs.status === 'aktiv' && (
            <Popconfirm
              title="UHS auflösen?"
              description="Nur möglich, wenn keine Person mehr belegt ist."
              onConfirm={() => statusMut.mutate('aufgeloest')}
              okButtonProps={{ danger: true }}
            >
              <Button danger>Auflösen</Button>
            </Popconfirm>
          )}
        </Space>
      }
      fensterInhalt={{
        // Mindest-Arbeitsfläche: unter einem langen Kopf scrollt die Seite, statt Grundriss und
        // Reiter zu überlagern. 380 px beschreiben die Fläche, keine Kopfhöhe.
        mindestHoehe: 380,
        inhalt: (
          <Grundriss
            einsatzId={einsatzId}
            uhs={uhs}
            schreibgeschuetzt={schreibgeschuetzt}
            platzBearbeitbar={darf('grundriss-bearbeiten')}
          />
        ),
      }}
    >
      {/* Der Seitenkopf teilt die Resthöhe mit dem Grundriss; Material/Bewegungen/Dateien folgen
          im Seitenfluss. */}
      {/* Ein einzelner Reiter ist keine Wahl: dann steht nur das Feld (UHS-Tablet). */}
      {reiterListe.length > 1 && (
        <Segmentleiste
          rolle="tablist"
          beschriftung={aufzaehlung(reiterListe.map((r) => REITER_NAME[r]))}
          wert={reiter}
          onWechsel={setReiter}
          optionen={reiterListe.map((r) => ({
            wert: r,
            label: REITER_NAME[r],
            steuert: reiterFeld,
          }))}
          style={{ marginTop: 16, marginBottom: 12 }}
        />
      )}
      {/* Ohne Leiste kein Reiterfeld: dann benennt sich die Liste darin selbst. */}
      <div
        {...(reiterListe.length > 1
          ? { role: 'tabpanel', id: reiterFeld, 'aria-label': REITER_NAME[reiter] }
          : { style: { marginTop: 16 } })}
      >
        {reiter === 'material' ? (
          <MaterialTab einsatzId={einsatzId} uhs={uhs} schreibgeschuetzt={schreibgeschuetzt} />
        ) : reiter === 'bewegungen' ? (
          <BewegungenTab uhs={uhs} dataUpdatedAt={detailQuery.dataUpdatedAt} />
        ) : (
          <UhsAnhaenge
            einsatzId={einsatzId}
            uhs={uhs}
            darfSchreiben={!schreibgeschuetzt}
            zeigeZugriffe={istEinsatzLeitung(einsatz)}
          />
        )}
      </div>
    </EinsatzSeite>
  );
}
