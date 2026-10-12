import { IconPlus } from '../icons';
import { Button, Form, Input } from 'antd';
import { Select } from '../components/Select';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { legeBefehlAn, listeBefehle, type NeuerBefehl } from '../api/befehle';
import { einsatzKeys } from '../api/queryKeys';
import type { BefehlKopf } from '../api/types';
import { NEW_SELECTABLE } from '../befehle/vorlagen';
import { befehlDetailPfad } from '../routing/deeplinks';
import { useQueryParamSelektion } from '../routing/useQueryParamSelektion';
import Bereichskopf from '../kommunikation/Bereichskopf';
import { ErfassungsModal } from '../components/Erfassung';
import { anzahl, segmentLabel } from '../anzeige/anzahl';
import ListeDetail from '../components/ListeDetail';
import { SeitenLeer } from '../components/SeitenZustand';
import { Segmentleiste, useRollen } from '../components/instrument';
import BefehlListenKarte from './BefehlListenKarte';
import BefehlDetail from './BefehlDetail';
import { befehlSchemaLabel } from './befehlTexte';

/**
 * Befehlsliste des Reiters „Einsatzbefehle“ im Muster „Liste + Detailpaneel“ (Spec
 * `auftraege-befehle`; design.md D5): gleich gebaut wie die Einzelaufträge — Bereichskopf,
 * Status-Segmente mit Zahl, Suche, Karten aus `KommKarte`, Detail neben bzw. unter der Karte.
 *
 * DIE V-NUMMER IST KEIN ZIERRAT: die Fortschreibung legt eine neue Zeile mit gleichem Titel an,
 * der Vorgänger bleibt freigegeben liegen. Die Segmente Entwürfe/Freigegeben zerschneiden die Kette
 * bewusst: nur der Entwurf ist bearbeitbar.
 *
 * Die Befehle kommen ungeblättert; die Suche über Titel und Schema läuft deshalb im Client. Der
 * Bereichskopf zählt den Bestand, die Segmente das Gefundene.
 */

/** Neueste Fassung zuerst: absteigend nach Zeitstand (UTC-Wirestring, lexikografisch korrekt). */
function compareZeitstand(a: BefehlKopf, b: BefehlKopf): number {
  return b.zeitstand.localeCompare(a.zeitstand);
}

function trifft(b: BefehlKopf, begriff: string): boolean {
  if (begriff === '') return true;
  const b2 = begriff.toLocaleLowerCase('de');
  return (
    b.titel.toLocaleLowerCase('de').includes(b2) ||
    befehlSchemaLabel(b.vorlage).toLocaleLowerCase('de').includes(b2)
  );
}

type BefehlStatus = BefehlKopf['status'];

const befehlSchluessel = (b: BefehlKopf) => b.id;

export default function BefehlListe({
  einsatzId,
  darfSchreiben,
}: {
  einsatzId: number;
  darfSchreiben: boolean;
}) {
  const qc = useQueryClient();
  const [anlegenOffen, setAnlegenOffen] = useState(false);
  const [form] = Form.useForm<NeuerBefehl>();

  const befehleQuery = useQuery({
    queryKey: einsatzKeys.befehle(einsatzId),
    queryFn: () => listeBefehle(einsatzId),
  });
  const invalidate = () => qc.invalidateQueries({ queryKey: einsatzKeys.befehle(einsatzId) });

  const navigate = useNavigate();
  // Schliessen und Leeren besorgt die Erfassungshülle (`onFertig`), den Grund einer Ablehnung zeigt
  // sie über `speicherung` im Dialog; kein Toast (`frontend/AGENTS.md`, „Rückwege und Fehler“).
  const anlegenMutation = useMutation({
    mutationFn: (daten: NeuerBefehl) => legeBefehlAn(einsatzId, daten),
    onSuccess: invalidate,
  });
  /*
   * Angelegt ist nur ein ENTWURF; bearbeitet und freigegeben wird er auf der Detailseite (LFH-972).
   * Die Kennung wartet hier bis `onFertig`: erst dann hat die Hülle Abbruchprüfung und Reset
   * hinter sich, ein Sprung schon in `onSuccess` liefe einem Abbruch während der Mutation davon.
   */
  const neuerEntwurf = useRef<number | null>(null);
  // Wer die Seite während des Anlegens verlassen hat (Zurück, Hardware-Taste), wird nicht
  // zurückgeholt: `navigate` liefe auch nach dem Abhängen noch.
  const eingehaengt = useRef(true);
  useEffect(() => {
    eingehaengt.current = true;
    return () => {
      eingehaengt.current = false;
    };
  }, []);

  const befehle = useMemo(
    () => [...(befehleQuery.data ?? [])].sort(compareZeitstand),
    [befehleQuery.data],
  );
  const entwuerfe = befehle.filter((b) => b.status === 'entwurf').length;
  const freigegebene = befehle.length - entwuerfe;

  const [suche, setSuche] = useState('');
  const gefunden = useMemo(() => befehle.filter((b) => trifft(b, suche.trim())), [befehle, suche]);
  /*
   * Vorgabe des Segments (design.md D5): „Entwürfe“, wenn es beim ersten Datenstand einen gibt,
   * sonst „Freigegeben“. Danach schaltet nur die Person um.
   */
  const [segment, setSegment] = useState<BefehlStatus | null>(null);
  useEffect(() => {
    if (segment === null && befehleQuery.isSuccess) {
      setSegment(befehleQuery.data.some((b) => b.status === 'entwurf') ? 'entwurf' : 'freigegeben');
    }
  }, [segment, befehleQuery.isSuccess, befehleQuery.data]);
  const aktivesSegment: BefehlStatus = segment ?? 'entwurf';
  const eintraege = useMemo(
    () => gefunden.filter((b) => b.status === aktivesSegment),
    [gefunden, aktivesSegment],
  );

  // Wahl und Sprung wie bei den Aufträgen; `?befehl=` wählt aus dem Ortspfad der Vollseite (D6).
  const [gewaehlt, setGewaehlt] = useState<number | null>(null);
  const [sprung, setSprung] = useState<{ id: number; nr: number } | null>(null);
  const sprungNr = useRef(0);
  useQueryParamSelektion('befehl', befehleQuery.isSuccess, (id) => {
    const ziel = (befehleQuery.data ?? []).find((b) => b.id === id);
    if (!ziel) return;
    setSuche('');
    setSegment(ziel.status);
    setGewaehlt(id);
    sprungNr.current += 1;
    setSprung({ id, nr: sprungNr.current });
  });
  const select = useCallback((id: number | null) => {
    setGewaehlt(id);
    setSprung(null);
  }, []);
  const changeSegment = (neu: BefehlStatus) => {
    setSegment(neu);
    select(null);
  };
  const { token } = useRollen();

  return (
    <div>
      <Bereichskopf
        titel="Befehle"
        meta={
          // Vor der ersten Lieferung keine Menge (wie bei den Aufträgen).
          befehleQuery.isSuccess
            ? `${anzahl(entwuerfe, 'Entwurf', 'Entwürfe')} · ${freigegebene} freigegeben`
            : undefined
        }
        dataUpdatedAt={befehleQuery.dataUpdatedAt}
        aktion={
          darfSchreiben && (
            // `aria-label` ist PFLICHT: antds Icon schiebt `aria-label="plus"` in den berechneten Namen,
            // sonst hieße der Knopf „plus Befehl entwerfen". „Entwerfen", nicht „erteilen": der
            // Knopf legt einen Entwurf an, erteilt ist der Befehl erst mit der Freigabe (LFH-972).
            <Button
              type="primary"
              icon={<IconPlus />}
              aria-label="Befehl entwerfen"
              onClick={() => setAnlegenOffen(true)}
            >
              Befehl entwerfen
            </Button>
          )
        }
      />
      <div
        data-lfh="befehle-filter"
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: token.marginSM,
          marginBottom: token.margin,
          alignItems: 'center',
        }}
      >
        <Segmentleiste
          beschriftung="Status"
          wert={aktivesSegment}
          onWechsel={changeSegment}
          optionen={[
            {
              wert: 'entwurf',
              label: segmentLabel(
                'Entwürfe',
                befehleQuery.isSuccess
                  ? gefunden.filter((b) => b.status === 'entwurf').length
                  : null,
              ),
            },
            {
              wert: 'freigegeben',
              label: segmentLabel(
                'Freigegeben',
                befehleQuery.isSuccess
                  ? gefunden.filter((b) => b.status === 'freigegeben').length
                  : null,
              ),
            },
          ]}
        />
        <Input
          allowClear
          aria-label="Befehle durchsuchen"
          placeholder="Titel oder Schema"
          style={{ width: 260, maxWidth: '100%' }}
          value={suche}
          onChange={(e) => setSuche(e.target.value)}
        />
      </div>

      <ListeDetail<BefehlKopf>
        bezeichnung={aktivesSegment === 'entwurf' ? 'Befehlsentwürfe' : 'Freigegebene Befehle'}
        eintraege={eintraege}
        schluessel={befehlSchluessel}
        gewaehlt={gewaehlt}
        onWahl={select}
        sprung={sprung}
        ladend={befehleQuery.isPending}
        fehler={
          befehleQuery.isError
            ? {
                text: 'Befehle konnten nicht geladen werden',
                ursache: befehleQuery.error,
                onWiederholen: () => void befehleQuery.refetch(),
              }
            : null
        }
        leer={
          <SeitenLeer
            titel={
              befehle.length === 0
                ? 'Noch keine Befehle'
                : aktivesSegment === 'entwurf'
                  ? 'Keine Entwürfe'
                  : 'Keine freigegebenen Befehle'
            }
            aktion={
              darfSchreiben
                ? { label: 'Befehl entwerfen', onClick: () => setAnlegenOffen(true) }
                : undefined
            }
          />
        }
        karte={(b, z) => (
          <BefehlListenKarte
            befehl={b}
            gewaehlt={z.gewaehlt}
            hervorgehoben={z.hervorgehoben}
            auswahl={z.auswahl}
          />
        )}
        detail={(b, { entfallen }) => (
          <BefehlDetail
            befehl={b}
            einsatzId={einsatzId}
            darfSchreiben={darfSchreiben}
            entfallen={entfallen}
          />
        )}
      />

      {/* Erfassungshülle (`frontend/AGENTS.md`, Erfassungs-Norm): sie setzt auf JEDEM Weg hinaus
          zurück. Ein handgebautes `onCancel` ohne Reset liess Titel und Schema eines verworfenen
          Befehls im Formularspeicher stehen, der nächste Befehl wurde damit angelegt (LFH-796). */}
      <ErfassungsModal<NeuerBefehl>
        offen={anlegenOffen}
        titel="Neuer Befehlsentwurf"
        form={form}
        erfassenText="Entwurf anlegen"
        laeuft={anlegenMutation.isPending}
        speicherung={anlegenMutation}
        speicherFehlerTitel="Entwurf nicht angelegt"
        speicherFehlerFallback="Anlegen fehlgeschlagen"
        initialValues={{ vorlage: 'befehl_lad' }}
        onErfassen={async (w) => {
          neuerEntwurf.current = (await anlegenMutation.mutateAsync(w)).id;
        }}
        onFertig={() => {
          setAnlegenOffen(false);
          const id = neuerEntwurf.current;
          neuerEntwurf.current = null;
          if (id != null && eingehaengt.current) navigate(befehlDetailPfad(einsatzId, id));
        }}
        onAbbrechen={() => setAnlegenOffen(false)}
      >
        <Form.Item label="Schema" name="vorlage" rules={[{ required: true }]}>
          {/* Nur Vorlagen für neue Befehle; der Bestand liest weiter `VORLAGEN` (LLH-1091). */}
          <Select options={NEW_SELECTABLE.map((v) => ({ value: v.schluessel, label: v.label }))} />
        </Form.Item>
        <Form.Item
          label="Titel"
          name="titel"
          rules={[{ required: true, message: 'Titel erforderlich' }]}
        >
          <Input placeholder="z. B. Befehl an 2. Zug 10:30" />
        </Form.Item>
      </ErfassungsModal>
    </div>
  );
}
