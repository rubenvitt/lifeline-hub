import { Alert, App, Button, Descriptions, Flex, Space, Typography } from 'antd';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { BefehlAnzeige, BefehlKopf } from '../api/types';
import {
  gibBefehlFrei,
  ladeBefehl,
  nimmBefehlQuittungZurueck,
  quittiereBefehlEmpfang,
  schreibeBefehlFort,
} from '../api/befehle';
import { einsatzKeys } from '../api/queryKeys';
import { befehlDetailPfad } from '../routing/deeplinks';
import { vorlage } from '../befehle/vorlagen';
import { BEFEHL_STATUS, StatusBadge } from '../kommunikation';
import { Augenbraue, Paneel, useRollen } from '../components/instrument';
import { DetailSprung } from '../components/ListeDetail';
import { SeitenSkeleton } from '../components/SeitenZustand';
import { SpeicherFehler } from '../components/SpeicherHinweis';
import FreigabeDialog from '../entwurf/FreigabeDialog';
import ZeitAnzeige from '../anzeige/ZeitAnzeige';
import { useZeilenFehler } from '../components/useZeilenFehler';
import { zeigeRueckgaengig } from '../kommunikation/rueckgaengig';
import BefehlLesefassung from './BefehlLesefassung';
import EmpfaengerQuittung from './EmpfaengerQuittung';
import { befehlSchemaLabel } from './befehlTexte';

/**
 * Detail eines Einsatzbefehls im Muster „Liste + Detailpaneel“ (Spec `auftraege-befehle`,
 * „Einsatzbefehl im Detail“; design.md D5). Gelesen wird hier; geschrieben wird ein Entwurf weiter
 * auf der Vollseite („Entwurf bearbeiten“), die auch Druck und Deeplink-Ziel bleibt.
 *
 * Die Abschnitte kommen erst für den gewählten Befehl (`ladeBefehl`, live über das Ereignis
 * `befehl`); bis dahin stehen die Kopfdaten aus der Liste und ein Skelett.
 *
 * FREIGEBEN OHNE SPEICHERSCHRITT: anders als auf der Vollseite trägt das Detail keinen Editor,
 * `/freigeben` prüft den gespeicherten Stand. Ein leerer Entwurf wird abgelehnt; der Grund steht im
 * Dialog, der offen bleibt.
 */
export default function BefehlDetail({
  befehl: kopf,
  einsatzId,
  darfSchreiben,
  entfallen = false,
}: {
  befehl: BefehlKopf;
  einsatzId: number;
  darfSchreiben: boolean;
  entfallen?: boolean;
}) {
  const { token } = useRollen();
  const { message } = App.useApp();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const detailQuery = useQuery({
    queryKey: einsatzKeys.befehl(einsatzId, kopf.id),
    queryFn: () => ladeBefehl(einsatzId, kopf.id),
  });
  // Kopfdaten frisch aus dem Einzelabruf, sobald er da ist; vorher aus der Liste.
  const b: BefehlKopf | BefehlAnzeige = detailQuery.data ?? kopf;
  const v = vorlage(b.vorlage);
  // Der Verteiler kommt mit dem Kopf (LLH-1173), frischer aus dem Einzelabruf.
  const verteiler = b.verteiler ?? [];
  const isEntwurf = b.status === 'entwurf';
  const vollseite = befehlDetailPfad(einsatzId, b.id);

  const invalidieren = () => {
    void qc.invalidateQueries({ queryKey: einsatzKeys.befehl(einsatzId, b.id) });
    void qc.invalidateQueries({ queryKey: einsatzKeys.befehle(einsatzId) });
  };
  /*
   * Quittung je Verteiler-Empfänger (LLH-1173, Spec `befehl-quittung`): ein Klick ohne Rückfrage,
   * weil der Server einen Rückweg hat (`…/zuruecknehmen`); der Hinweis danach trägt „Rückgängig“
   * (LFH-343). Die Antwort setzt das Detail, die Liste zieht nach (Quittungsstand der Karte).
   * Der Grund einer Ablehnung steht am Verteiler (LFH-1077), je Befehl.
   */
  const quittungErrors = useZeilenFehler<number>();
  const applyQuittung = (stand: BefehlAnzeige) => {
    qc.setQueryData(einsatzKeys.befehl(einsatzId, stand.id), stand);
    void qc.invalidateQueries({ queryKey: einsatzKeys.befehle(einsatzId) });
  };
  const zuruecknehmenMutation = useMutation({
    mutationFn: ({ befehlId, eintragId }: { befehlId: number; eintragId: number }) =>
      nimmBefehlQuittungZurueck(einsatzId, befehlId, eintragId),
    onMutate: ({ befehlId }) => quittungErrors.beginne(befehlId),
    onSuccess: applyQuittung,
    onError: (e, { befehlId }) =>
      quittungErrors.melde(befehlId, e, 'Quittung nicht zurückgenommen'),
  });
  const quittierenMutation = useMutation({
    mutationFn: ({ befehlId, eintragId }: { befehlId: number; eintragId: number }) =>
      quittiereBefehlEmpfang(einsatzId, befehlId, eintragId),
    onMutate: ({ befehlId }) => quittungErrors.beginne(befehlId),
    onSuccess: (stand, ziel) => {
      applyQuittung(stand);
      zeigeRueckgaengig(message, 'Empfang quittiert', () => zuruecknehmenMutation.mutate(ziel));
    },
    onError: (e, { befehlId }) => quittungErrors.melde(befehlId, e, 'Quittung fehlgeschlagen'),
  });
  const isQuittungPending = quittierenMutation.isPending || zuruecknehmenMutation.isPending;

  const [freigabeOffen, setFreigabeOffen] = useState(false);
  // Kein `onError`: der Grund steht im Dialog, der bei Ablehnung offen bleibt.
  const freigebenMutation = useMutation({
    mutationFn: () => gibBefehlFrei(einsatzId, b.id),
    onSuccess: () => {
      invalidieren();
      setFreigabeOffen(false);
      message.success('Befehl freigegeben');
    },
  });
  // Kein `onError`: der Grund steht im Detail über den Handlungen (LFH-1077).
  const fortschreibenMutation = useMutation({
    mutationFn: () => schreibeBefehlFort(einsatzId, b.id),
    onSuccess: (neu: BefehlAnzeige) => {
      void qc.invalidateQueries({ queryKey: einsatzKeys.befehle(einsatzId) });
      navigate(befehlDetailPfad(einsatzId, neu.id));
    },
  });

  const handlungen = darfSchreiben && (
    <Space wrap size={token.marginSM} style={{ marginTop: token.marginSM }}>
      {isEntwurf ? (
        <>
          {/* Link in Knopfgestalt: Strg/⌘+Klick öffnet die Vollseite in einem Tab
              (`frontend/AGENTS.md`, Handgebautes Bedienziel). */}
          <Button
            type="primary"
            href={vollseite}
            onClick={(e) => {
              if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
              e.preventDefault();
              navigate(vollseite);
            }}
          >
            Entwurf bearbeiten
          </Button>
          <Button
            onClick={() => {
              // Ein frisch geöffneter Dialog zeigt keinen alten Grund.
              freigebenMutation.reset();
              setFreigabeOffen(true);
            }}
          >
            Freigeben
          </Button>
        </>
      ) : (
        <Button
          onClick={() => fortschreibenMutation.mutate()}
          loading={fortschreibenMutation.isPending}
        >
          Fortschreiben
        </Button>
      )}
    </Space>
  );

  const status = BEFEHL_STATUS[b.status];
  return (
    <Paneel
      titel={`Befehl v${b.version}`}
      // Unter dem Bereichskopf (h3) des Reiters, neben den Gruppenköpfen der Liste.
      ueberschrift="h4"
      meta={
        <>
          Stand <ZeitAnzeige wert={b.zeitstand} />
        </>
      }
      koerperPolster
    >
      {entfallen && (
        <Alert
          type="info"
          showIcon
          title="Nicht mehr in dieser Ansicht"
          style={{ marginBottom: token.marginSM }}
        />
      )}
      <Space size={6} wrap style={{ marginBottom: 6 }}>
        <StatusBadge phase={status.phase} label={status.label} />
      </Space>
      <Typography.Text strong style={{ fontSize: 15, lineHeight: 1.4, display: 'block' }}>
        {b.titel}
      </Typography.Text>
      {fortschreibenMutation.error != null && (
        <div style={{ marginTop: token.marginSM }}>
          <SpeicherFehler
            fehler={fortschreibenMutation.error}
            titel="Nicht fortgeschrieben"
            fallback="Fortschreiben fehlgeschlagen"
          />
        </div>
      )}
      {handlungen}

      <Descriptions size="small" column={1} bordered style={{ marginTop: token.marginLG }}>
        <Descriptions.Item label="Schema">{befehlSchemaLabel(b.vorlage)}</Descriptions.Item>
        <Descriptions.Item label="Zeitstand">
          <ZeitAnzeige wert={b.zeitstand} />
        </Descriptions.Item>
        <Descriptions.Item label="Ersteller">{b.ersteller_name}</Descriptions.Item>
        {b.freigegeben_at && (
          <Descriptions.Item label="Freigegeben">
            <ZeitAnzeige wert={b.freigegeben_at} />
            {b.freigegeben_von_name ? ` · ${b.freigegeben_von_name}` : ''}
          </Descriptions.Item>
        )}
      </Descriptions>

      {verteiler.length > 0 && (
        // An wen der Befehl geht (LLH-1172) und wer den Empfang bestätigt hat (LLH-1173): derselbe
        // Block wie die Empfänger eines Auftrags. Ein Entwurf nennt nur die Namen.
        <div style={{ marginTop: token.marginLG }} data-lfh="befehl-verteiler">
          <Augenbraue style={{ display: 'block', marginBottom: token.marginXS }}>
            Verteiler
          </Augenbraue>
          {isEntwurf ? (
            <Typography.Text>{verteiler.map((e) => e.snap_anzeige).join(', ')}</Typography.Text>
          ) : (
            <EmpfaengerQuittung
              zeilen={verteiler.map((e) => ({
                id: e.id,
                name: e.snap_anzeige,
                ariaName: e.snap_anzeige,
                quittiertAt: e.quittiert_at,
              }))}
              canQuittieren={darfSchreiben && b.is_quittierbar === true}
              isLocked={isQuittungPending}
              pendingId={
                quittierenMutation.isPending ? quittierenMutation.variables.eintragId : null
              }
              onQuittieren={(eintragId) => quittierenMutation.mutate({ befehlId: b.id, eintragId })}
              error={quittungErrors.grund(b.id)}
            />
          )}
        </div>
      )}

      <div style={{ marginTop: token.marginLG }}>
        {/* Etikett, keine Überschrift: die Abschnittsköpfe darunter sind selbst h5, ein h5
            „Befehlstext“ stünde neben statt über ihnen. */}
        <Augenbraue style={{ display: 'block', marginBottom: token.marginXS }}>
          Befehlstext
        </Augenbraue>
        {detailQuery.data ? (
          // h5 unter dem Paneel (h4); dieselbe Lesefassung wie die Vollseite.
          <BefehlLesefassung vorlage={v} abschnitte={detailQuery.data.abschnitte} ebene={5} />
        ) : (
          <SeitenSkeleton />
        )}
      </div>
      <Flex>
        <DetailSprung ziel={vollseite}>Vollansicht</DetailSprung>
      </Flex>

      <FreigabeDialog
        offen={freigabeOffen}
        titel="Befehl freigeben?"
        warnung="Endgültig: geht ins ETB, Korrektur nur per Fortschreibung."
        speicherFehler={null}
        freigabeFehler={freigebenMutation.error}
        laeuft={freigebenMutation.isPending}
        onAbbrechen={() => setFreigabeOffen(false)}
        onFreigeben={() => freigebenMutation.mutate()}
      />
    </Paneel>
  );
}
