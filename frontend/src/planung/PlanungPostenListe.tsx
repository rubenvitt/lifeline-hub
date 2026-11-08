import { Button, Modal, Space } from 'antd';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import {
  aenderePlanungPosten,
  legePlanungPostenAn,
  loeschePlanungPosten,
  setzePlanungPostenReihenfolge,
} from '../api/planungen';
import { globalKeys } from '../api/queryKeys';
import type { Planung, PlanungPosten } from '../api/types';
import { formatDauer } from '../abloesung/dauer';
import { monoStil, StatusChip } from '../components/instrument';
import KatalogTabelle, { type KatalogSpalte } from '../components/KatalogTabelle';
import { MenueAusloeser } from '../components/MenueAusloeser';
import { SeitenHinweise, SpeicherFehler } from '../components/SpeicherHinweis';
import { qualiSollText } from '../kraefte/qualiSoll';
import PlanungPostenDialog, { herkunftText, type PostenSpeichern } from './PlanungPostenDialog';
import { uebernimmPlanung } from './planungCache';

type Aktion = 'bearbeiten' | 'hoch' | 'runter' | 'loeschen';

/** Die Reihenfolge mit dem Posten an `index` um eins verschoben. */
export function verschobeneFolge(
  ids: readonly number[],
  index: number,
  richtung: -1 | 1,
): number[] {
  const ziel = index + richtung;
  if (ziel < 0 || ziel >= ids.length) return [...ids];
  const neu = [...ids];
  [neu[index], neu[ziel]] = [neu[ziel], neu[index]];
  return neu;
}

/**
 * Reiter „Posten“ einer Planung (LLH-1586): die Zeilen des Rasters in ihrer Reihenfolge. Die Folge
 * ist die Aussage, deshalb sortiert die Tabelle nicht; verschoben wird über „Nach oben“ und „Nach
 * unten“ (Abstimmung 08.11.2026). Bearbeiten und Anlegen im Dialog, Löschen mit Rückfrage; trägt
 * ein Posten Blöcke mit Personen, nennt die Rückfrage sie und löscht sie mit.
 */
export default function PlanungPostenListe({ planung }: { planung: Planung }) {
  const planungId = planung.kopf.id;
  const qc = useQueryClient();
  const [dialog, setDialog] = useState<{ posten: PlanungPosten | null } | null>(null);
  const [zuLoeschen, setZuLoeschen] = useState<PlanungPosten | null>(null);
  const posten = [...planung.posten].sort((a, b) => a.sortier - b.sortier);

  const setzePlanung = (p: Planung) => uebernimmPlanung(qc, p);
  const speichernMut = useMutation({
    mutationFn: (s: PostenSpeichern) =>
      s.art === 'anlegen'
        ? legePlanungPostenAn(planungId, s.body)
        : aenderePlanungPosten(planungId, s.postenId, s.body),
    onSuccess: setzePlanung,
  });
  const folgeMut = useMutation({
    mutationFn: (ids: number[]) => setzePlanungPostenReihenfolge(planungId, ids),
    onSuccess: setzePlanung,
  });
  const loeschenMut = useMutation({
    mutationFn: (v: { postenId: number; mitBloecken: boolean }) =>
      loeschePlanungPosten(planungId, v.postenId, v.mitBloecken),
    onSuccess: () => {
      setZuLoeschen(null);
      void qc.invalidateQueries({ queryKey: globalKeys.planung(planungId) });
    },
  });

  const bloeckeVon = (p: PlanungPosten) => planung.bloecke.filter((b) => b.posten_id === p.id);
  const loeschBloecke = zuLoeschen ? bloeckeVon(zuLoeschen) : [];
  const mitPersonen = loeschBloecke.some((b) => b.personen_anzahl > 0);

  const handle = (aktion: Aktion, p: PlanungPosten, index: number) => {
    if (aktion === 'bearbeiten') {
      speichernMut.reset();
      setDialog({ posten: p });
    } else if (aktion === 'loeschen') {
      loeschenMut.reset();
      setZuLoeschen(p);
    } else {
      folgeMut.mutate(
        verschobeneFolge(
          posten.map((x) => x.id),
          index,
          aktion === 'hoch' ? -1 : 1,
        ),
      );
    }
  };

  const spalten: KatalogSpalte<PlanungPosten>[] = [
    {
      title: 'Posten',
      dataIndex: 'bezeichnung',
      key: 'bezeichnung',
      render: (_, p) => (
        <Space size={4} wrap>
          <span style={{ overflowWrap: 'anywhere' }}>{p.bezeichnung}</span>
          {p.nicht_verfuegbar && <StatusChip ton="achtung" wort="nicht verfügbar" />}
        </Space>
      ),
    },
    {
      title: 'Abschnitt',
      key: 'abschnitt',
      suchText: (p) => p.abschnitt,
      render: (_, p) => p.abschnitt ?? '—',
    },
    {
      title: 'Herkunft',
      key: 'herkunft',
      abBreite: 'lg',
      suchText: herkunftText,
      render: (_, p) => herkunftText(p),
    },
    {
      title: 'Schichtlänge',
      key: 'schichtlaenge',
      render: (_, p) => (
        <span style={monoStil(12)}>
          {p.schichtlaenge_minuten != null ? formatDauer(p.schichtlaenge_minuten) : '—'}
        </span>
      ),
    },
    {
      title: 'Soll',
      key: 'soll',
      render: (_, p) => {
        const quali = qualiSollText(p.quali_soll);
        return (
          <>
            <span style={monoStil(12)}>{p.soll_anzahl ?? '—'}</span>
            {quali ? ` · ${quali}` : null}
          </>
        );
      },
    },
    {
      title: 'Aktionen',
      key: 'aktionen',
      immerSichtbar: true,
      render: (_, p) => {
        const index = posten.findIndex((x) => x.id === p.id);
        return (
          <MenueAusloeser<Aktion>
            gesperrt={folgeMut.isPending}
            eintraege={[
              { key: 'bearbeiten', label: 'Bearbeiten' },
              { key: 'hoch', label: 'Nach oben', ...(index === 0 ? { gesperrt: true } : {}) },
              {
                key: 'runter',
                label: 'Nach unten',
                ...(index === posten.length - 1 ? { gesperrt: true } : {}),
              },
              { key: 'loeschen', label: 'Löschen', gefahr: true },
            ]}
            zugaenglicherName={`Aktionen zu ${p.bezeichnung}`}
            onWahl={(a) => handle(a, p, index)}
          />
        );
      },
    },
  ];

  // Reiter einer Detailseite: Sortierung und Filter ohne Gedächtnis, die Adresse meint die Planung.
  return (
    <div data-lfh="planung-posten">
      <Space style={{ marginBottom: 12 }}>
        <Button
          onClick={() => {
            speichernMut.reset();
            setDialog({ posten: null });
          }}
        >
          Posten anlegen
        </Button>
      </Space>
      <SeitenHinweise fehler={folgeMut.error} fehlerTitel="Reihenfolge nicht geändert" />
      <KatalogTabelle
        rowKey="id"
        dataSource={posten}
        columns={spalten}
        spaltenSchalter={{ bezeichnung: 'Posten' }}
        mehrzahl="Posten"
        locale={{ emptyText: 'Noch keine Posten' }}
      />
      {dialog && (
        <PlanungPostenDialog
          key={dialog.posten?.id ?? 'neu'}
          posten={dialog.posten}
          laeuft={speichernMut.isPending}
          speicherung={speichernMut}
          onSpeichern={(s) => speichernMut.mutateAsync(s)}
          onSchliessen={() => setDialog(null)}
        />
      )}
      <Modal
        open={zuLoeschen != null}
        title={zuLoeschen ? `${zuLoeschen.bezeichnung} löschen?` : 'Posten löschen?'}
        okText="Posten löschen"
        cancelText="Abbrechen"
        okButtonProps={{ danger: true, loading: loeschenMut.isPending }}
        onOk={() =>
          zuLoeschen && loeschenMut.mutate({ postenId: zuLoeschen.id, mitBloecken: mitPersonen })
        }
        onCancel={() => setZuLoeschen(null)}
        destroyOnHidden
      >
        {loeschBloecke.length > 0 && (
          <p data-lfh="posten-loeschen-bloecke" style={{ margin: 0 }}>
            {loeschBloecke.length === 1
              ? 'Sein Block wird mitgelöscht.'
              : `Seine ${loeschBloecke.length} Blöcke werden mitgelöscht.`}
          </p>
        )}
        {loeschenMut.error != null && (
          <SpeicherFehler fehler={loeschenMut.error} titel="Posten nicht gelöscht" />
        )}
      </Modal>
    </div>
  );
}
