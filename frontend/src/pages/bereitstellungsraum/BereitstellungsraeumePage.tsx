import {
  App, Breadcrumb, Button, Drawer, Form, Input,
  type TableColumnsType,
} from 'antd';
import { Link, useNavigate, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import { bereitstellungsraumDetailPfad } from '../../routing/deeplinks';
import { ladeEinsatz } from '../../api/einsaetze';
import { darfImEinsatzSchreiben } from '../../einsatz/schreibrecht';
import { useAuth } from '../../auth/AuthContext';
import { listeBr, legeBrAn, type BrEingabe } from '../../api/einsatzBereitstellungsraum';
import { ApiError } from '../../api/client';
import { einsatzKeys } from '../../api/queryKeys';
import type { Bereitstellungsraum, BrStatus } from '../../api/types';
import EinsatzSeite from '../../components/EinsatzSeite';
import StatusTag from '../../components/StatusTag';
import { SeitenFehler, SeitenSkeleton, SeitenStandVeraltet } from '../../components/SeitenZustand';
import { brStatus } from '../../theme/statusFarben';
import { flaeche } from '../../theme/tokens';
import KatalogTabelle from '../../components/KatalogTabelle';
import {
  ErfassungsFormular,
  type ErfassungsFormularSteuerung,
} from '../../components/Erfassung';

interface BrAnlegenAuftrag {
  einsatzId: number;
  daten: BrEingabe;
}

interface AngelegterBr {
  einsatzId: number;
  brId: number;
}

export default function BereitstellungsraeumePage() {
  const { id } = useParams();
  const einsatzId = Number(id);
  const { benutzer } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { message } = App.useApp();

  const einsatzQuery = useQuery({
    queryKey: einsatzKeys.einsatz(einsatzId),
    queryFn: () => ladeEinsatz(einsatzId),
  });
  const brQuery = useQuery({
    queryKey: einsatzKeys.br(einsatzId),
    queryFn: () => listeBr(einsatzId),
  });

  const [anlegen, setAnlegen] = useState(false);
  const [form] = Form.useForm<BrEingabe>();
  const angelegterBr = useRef<AngelegterBr | null>(null);
  const formularSteuerung = useRef<ErfassungsFormularSteuerung>(null);
  const abbruchGeneration = useRef(0);
  const formularEinsatzId = useRef(einsatzId);

  useEffect(() => {
    if (formularEinsatzId.current === einsatzId) return;
    formularEinsatzId.current = einsatzId;
    form.resetFields();
  }, [einsatzId, form]);

  const schreibgeschuetzt = !darfImEinsatzSchreiben(einsatzQuery.data, benutzer);

  const anlegenMut = useMutation({
    mutationFn: (auftrag: BrAnlegenAuftrag) => legeBrAn(auftrag.einsatzId, auftrag.daten),
    onSuccess: (_br, auftrag) => {
      message.success('Bereitstellungsraum angelegt');
      qc.invalidateQueries({ queryKey: einsatzKeys.br(auftrag.einsatzId) });
      qc.invalidateQueries({ queryKey: einsatzKeys.etb(auftrag.einsatzId) });
    },
    onError: (e: unknown) =>
      message.error(e instanceof ApiError ? e.message : 'Aktion fehlgeschlagen'),
  });

  const anlegenAbbrechen = useCallback(() => {
    abbruchGeneration.current += 1;
    angelegterBr.current = null;
    setAnlegen(false);
  }, []);

  const drawerSchliessen = () => {
    if (formularSteuerung.current) formularSteuerung.current.abbrechen();
    else anlegenAbbrechen();
  };

  const spalten: TableColumnsType<Bereitstellungsraum> = [
    {
      title: 'Bezeichnung',
      dataIndex: 'bezeichnung',
      render: (b: string, br) => (
        <Link to={bereitstellungsraumDetailPfad(einsatzId, br.id)}>{b}</Link>
      ),
    },
    {
      title: 'Status',
      dataIndex: 'status',
      render: (s: BrStatus) => <StatusTag darstellung={brStatus[s]} />,
    },
    { title: 'Standort', dataIndex: 'standort', render: (s: string | null) => s ?? '—' },
  ];

  // ZWEI EBENEN, getrennt gehalten (LFH-331 · B3, D3):
  //
  // SEITENZUSTAND — nur `einsatzQuery`. Breadcrumb und Schreibrecht hängen an ihr, ohne sie
  // gibt es keinen Rahmen; nur sie rechtfertigt einen Frühausstieg.
  //
  // LISTENZUSTAND — `brQuery`. Sie entschied hier früher mit über die ganze Seite: bis ihre
  // Antwort da war, stand alles im Ladebild, und scheiterte sie, blieb es dabei — ohne jede
  // Aussage, was los ist. Ihr Zustand gehört an die Stelle der Liste (unten).
  if (einsatzQuery.isLoading) return <SeitenSkeleton />;
  if (einsatzQuery.error) {
    return (
      <SeitenFehler
        text="Einsatz konnte nicht geladen werden"
        ursache={einsatzQuery.error}
        onWiederholen={() => void einsatzQuery.refetch()}
      />
    );
  }

  const alle = brQuery.data ?? [];
  const sichtbar = alle.filter((br) => !br.storniert_at);

  /**
   * ZWEI LAGEN, ZWEI ANTWORTEN (D3) — der Fehler allein reicht als Bedingung NICHT.
   *
   * Ohne Zeilen im Zwischenspeicher tritt der Fehler an die Stelle der Tabelle, sonst
   * behauptet „Noch keine Bereitstellungsräume erfasst" eine leere Lage, wo bloß der Abruf
   * scheiterte. MIT Zeilen bleiben sie stehen und bekommen ein Banner: sie sind echt, nur
   * womöglich alt. Ein Fehler, der die Zeilen wegräumt, nähme der Einsatzkraft Daten, die
   * sie eben noch hatte.
   *
   * Gemessen an `alle`, NICHT an `sichtbar` — dieselbe Achse wie in `TierePage`/`SchaedenPage`.
   * Die Begründung trägt hier allerdings anders und das soll nicht unbenannt bleiben:
   * `storniert_at` ist kein vom Bediener gesetzter Filter, der Fall „Filter eng, Cache voll"
   * tritt hier also nicht laufend auf. Gewählt ist die ungefilterte Achse trotzdem, weil eine
   * zweite Messgrundlage für dieselbe Weiche genau der Befund wäre, den B3 behebt.
   * BENANNTE FOLGE: sind ALLE Räume storniert und scheitert die Aktualisierung, steht das
   * Banner über einer Tabelle, die „Noch keine … erfasst" zeigt. Das ist die ehrlichere der
   * beiden Aussagen — der Bestand ist tatsächlich leer, nur eben womöglich veraltet leer.
   */
  const listeGescheitert = brQuery.isError && alle.length === 0;
  const standVeraltet = brQuery.isError && alle.length > 0;

  return (
    <EinsatzSeite
      titel="Bereitstellungsräume"
      dataUpdatedAt={brQuery.dataUpdatedAt}
      breite={flaeche.seiteBreit}
      breadcrumb={
        <Breadcrumb items={[
          { title: <Link to="/einsaetze">Einsätze</Link> },
          { title: <Link to={`/einsaetze/${einsatzId}`}>{einsatzQuery.data?.bezeichnung}</Link> },
          { title: 'Bereitstellungsräume' },
        ]} />
      }
      aktionen={
        <Button type="primary" disabled={schreibgeschuetzt} onClick={() => setAnlegen(true)}>
          Neu
        </Button>
      }
    >
      {/* Der Fehler TAUSCHT die Tabelle aus, statt durch sie hindurchgereicht zu werden
          (D3): `Datensicht` führt den Kartenzweig an `Liste`, und deren Vertrag kennt
          keinen Fehlerbegriff — ein Prop am Tabellen-Primitiv wirkte nur in einer der
          beiden Formen. Ohne diese Weiche behauptet „Noch keine Bereitstellungsräume
          erfasst" auch dann eine leere Lage, wenn bloß die Verbindung abgerissen ist. */}
      {listeGescheitert ? (
        <SeitenFehler
          text="Bereitstellungsräume konnten nicht geladen werden"
          ursache={brQuery.error}
          onWiederholen={() => void brQuery.refetch()}
        />
      ) : (
        <>
          {standVeraltet && <SeitenStandVeraltet onWiederholen={() => void brQuery.refetch()} />}
          <KatalogTabelle<Bereitstellungsraum>
            rowKey="id"
            loading={brQuery.isLoading}
            dataSource={sichtbar}
            columns={spalten}
            size="middle"
            pagination={false}
            locale={{ emptyText: 'Noch keine Bereitstellungsräume erfasst' }}
          />
        </>
      )}

      <Drawer
        title="Bereitstellungsraum anlegen"
        open={anlegen}
        keyboard={false}
        onClose={drawerSchliessen}
        size={420}
        destroyOnHidden
      >
        <ErfassungsFormular<BrEingabe>
          form={form}
          steuerungRef={formularSteuerung}
          onErfassen={async (daten) => {
            const auftrag: BrAnlegenAuftrag = { einsatzId, daten };
            const generation = abbruchGeneration.current;
            const br = await anlegenMut.mutateAsync(auftrag);
            if (abbruchGeneration.current === generation) {
              angelegterBr.current = { einsatzId: auftrag.einsatzId, brId: br.id };
            }
          }}
          onFertig={() => {
            const ergebnis = angelegterBr.current;
            angelegterBr.current = null;
            setAnlegen(false);
            if (ergebnis) {
              navigate(bereitstellungsraumDetailPfad(ergebnis.einsatzId, ergebnis.brId));
            }
          }}
          onAbbrechen={anlegenAbbrechen}
          laeuft={anlegenMut.isPending}
          erfassenText="Anlegen"
        >
          <Form.Item
            label="Bezeichnung"
            name="bezeichnung"
            rules={[{ required: true, message: 'Bezeichnung erforderlich' }]}
          >
            <Input placeholder="z. B. BR Ost" />
          </Form.Item>
          <Form.Item label="Standort (optional)" name="standort">
            <Input placeholder="Adresse / Hinweis" />
          </Form.Item>
          <Form.Item label="Notiz (optional)" name="notiz">
            <Input.TextArea rows={3} />
          </Form.Item>
        </ErfassungsFormular>
      </Drawer>
    </EinsatzSeite>
  );
}
