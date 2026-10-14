import { Button, Space, Typography, theme } from 'antd';
import { useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import DemoMarke from '../components/DemoMarke';
import { Paneel, PaneelZeile, StatusChip, monoStil } from '../components/instrument';
import { KennungsLink } from '../components/kennungsLink';
import { Select } from '../components/Select';
import { SpeicherFehler } from '../components/SpeicherHinweis';
import { mitVorgabe } from '../components/vorgabeText';
import { replaceVorlageFahrzeuge, replaceVorlagePersonal } from '../api/einheitVorlagen';
import { listeFahrzeuge } from '../api/fahrzeuge';
import { POSITION_LABELS, POSITION_OPTIONEN, listePersonal } from '../api/personal';
import { globalKeys } from '../api/queryKeys';
import type {
  EinheitVorlage,
  EinheitVorlagePersonal,
  EinheitVorlagePersonalEingabe,
  StaerkePosition,
} from '../api/types';
import { demoGroupedOptions } from './demoAuswahl';
import {
  einheitVorlageDetailPath,
  fahrzeugDetailPfad,
  personalDetailPfad,
} from './stammdatenDetail';
import { treeIds } from './einheitVorlagenBaum';
import EinheitVorlageFormModal from './EinheitVorlageFormModal';

/**
 * Die drei Listen der Vorlagen-Detailseite (LLH-1042): Untereinheiten, Fahrzeuge,
 * Stammbesetzung. Jeder Handgriff speichert sofort die ganze Liste (PUT, Spec `einheit-vorlagen`,
 * „Fahrzeuge und Stammbesetzung der Vorlage“); der Grund einer Ablehnung steht im Paneel, bis zum
 * nächsten Versuch (LFH-1077). Warnungen stehen als Wort am Eintrag („außer Dienst“, „auch in …“),
 * nie nur als Farbe.
 */

interface SectionProps {
  vorlage: EinheitVorlage;
  vorlagen: readonly EinheitVorlage[];
  isAdmin: boolean;
}

/** Breite der Auswahlfelder in einer Zeile. */
const SELECT_STYLE = { minWidth: 180 };

/**
 * Eine Zeile: links Kennung und Marken, rechts Bedienung; bricht schmal um. Die Abstände folgen
 * der Dichte (Handschuh: Zeilenabstand 16 px, Leitlinie Kriterium 2), damit Kennungs-Link,
 * Auswahl und Knopf nie bündig aneinanderstoßen.
 */
function Row({ children, actions }: { children: ReactNode; actions?: ReactNode }) {
  const { token } = theme.useToken();
  return (
    <PaneelZeile
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        columnGap: token.margin,
        rowGap: token.marginSM,
      }}
    >
      <Space size={8} wrap style={{ flex: '1 1 240px', minWidth: 0 }}>
        {children}
      </Space>
      {actions != null && (
        <Space size="middle" wrap>
          {actions}
        </Space>
      )}
    </PaneelZeile>
  );
}

/** „außer Dienst“ und „auch in …“ als Wort (Spec `einheit-vorlagen`, „Pflege in der Verwaltung“). */
function Warnings({
  dienststatus,
  auchIn,
  names,
}: {
  dienststatus: string;
  auchIn: number[];
  names: Map<number, string>;
}) {
  return (
    <>
      {dienststatus === 'ausser_dienst' && <StatusChip ton="achtung" wort="außer Dienst" />}
      {auchIn.length > 0 && (
        <Typography.Text type="secondary">
          auch in {auchIn.map((id) => names.get(id) ?? `Vorlage ${id}`).join(', ')}
        </Typography.Text>
      )}
    </>
  );
}

function useNames(vorlagen: readonly EinheitVorlage[]): Map<number, string> {
  return new Map(vorlagen.map((v) => [v.id, v.name]));
}

// ── Untereinheiten ───────────────────────────────────────────────────────────────────────────

export function UntereinheitenSection({
  vorlage,
  vorlagen,
  isAdmin,
  onCreated,
}: SectionProps & { onCreated: (v: EinheitVorlage) => void }) {
  const [modalOpen, setModalOpen] = useState(false);
  const children = vorlagen.filter((v) => v.ueber_vorlage_id === vorlage.id);
  return (
    <Paneel
      titel="Untereinheiten"
      meta={children.length}
      aktion={
        <Button disabled={!isAdmin} onClick={() => setModalOpen(true)}>
          Untereinheit anlegen
        </Button>
      }
      style={{ marginBlockStart: 16 }}
    >
      {children.length === 0 ? (
        <PaneelZeile>Keine Untereinheiten</PaneelZeile>
      ) : (
        children.map((c) => (
          <Row key={c.id}>
            <KennungsLink to={einheitVorlageDetailPath(c.id)}>{c.name}</KennungsLink>
            <span>{c.typ_label}</span>
            {c.ist_demo && <DemoMarke />}
            {!c.aktiv && <StatusChip ton="neutral" wort="Inaktiv" />}
          </Row>
        ))
      )}
      <EinheitVorlageFormModal
        open={modalOpen}
        vorlagen={vorlagen}
        parentId={vorlage.id}
        onClose={() => setModalOpen(false)}
        onCreated={onCreated}
      />
    </Paneel>
  );
}

// ── Fahrzeuge ────────────────────────────────────────────────────────────────────────────────

export function FahrzeugeSection({ vorlage, vorlagen, isAdmin }: SectionProps) {
  const qc = useQueryClient();
  const names = useNames(vorlagen);
  const [selected, setSelected] = useState<number | undefined>();
  const fahrzeugeQuery = useQuery({
    queryKey: globalKeys.fahrzeugeListe('alle'),
    queryFn: () => listeFahrzeuge(false),
    enabled: isAdmin,
  });
  const replace = useMutation({
    mutationFn: (ids: number[]) => replaceVorlageFahrzeuge(vorlage.id, ids),
    onSuccess: () => qc.invalidateQueries({ queryKey: globalKeys.einheitVorlagen() }),
  });

  const current = vorlage.fahrzeuge.map((f) => f.fahrzeug_id);
  // Zur Wahl steht, was in Dienst ist und noch nirgends im selben Vorlagen-Baum steht.
  const tree = treeIds(vorlagen, vorlage.id);
  const inTree = new Set(
    vorlagen.filter((v) => tree.has(v.id)).flatMap((v) => v.fahrzeuge.map((f) => f.fahrzeug_id)),
  );
  const candidates = (fahrzeugeQuery.data ?? []).filter(
    (f) => f.dienststatus === 'in_dienst' && !inTree.has(f.id),
  );

  return (
    <Paneel titel="Fahrzeuge" meta={vorlage.fahrzeuge.length} style={{ marginBlockStart: 16 }}>
      <SpeicherFehler fehler={replace.error} />
      {vorlage.fahrzeuge.length === 0 ? (
        <PaneelZeile>Keine Fahrzeuge</PaneelZeile>
      ) : (
        vorlage.fahrzeuge.map((f) => (
          <Row
            key={f.fahrzeug_id}
            actions={
              isAdmin && (
                <Button
                  danger
                  disabled={replace.isPending}
                  aria-label={`${f.funkrufname} aus der Vorlage entfernen`}
                  onClick={() => replace.mutate(current.filter((id) => id !== f.fahrzeug_id))}
                >
                  Entfernen
                </Button>
              )
            }
          >
            <KennungsLink to={fahrzeugDetailPfad(f.fahrzeug_id)} style={monoStil(13)}>
              {f.funkrufname}
            </KennungsLink>
            {f.fahrzeugtyp && <span>{f.fahrzeugtyp}</span>}
            {f.ist_demo && <DemoMarke />}
            <Warnings dienststatus={f.dienststatus} auchIn={f.auch_in} names={names} />
          </Row>
        ))
      )}
      {isAdmin && (
        <Row
          actions={
            <Button
              disabled={selected == null}
              loading={replace.isPending}
              onClick={() => {
                if (selected == null) return;
                replace.mutate([...current, selected], {
                  onSuccess: () => setSelected(undefined),
                });
              }}
            >
              Fahrzeug hinzufügen
            </Button>
          }
        >
          <Select<number>
            aria-label="Fahrzeug wählen"
            placeholder="Fahrzeug wählen"
            style={SELECT_STYLE}
            value={selected}
            onChange={setSelected}
            loading={fahrzeugeQuery.isLoading}
            options={demoGroupedOptions(
              candidates,
              (f) => `${f.funkrufname}${f.fahrzeugtyp ? ` (${f.fahrzeugtyp})` : ''}`,
            )}
          />
        </Row>
      )}
    </Paneel>
  );
}

// ── Stammbesetzung ───────────────────────────────────────────────────────────────────────────

/** Die Liste in PUT-Form, mit einer geänderten oder ohne eine Person. */
function toInput(
  personal: readonly EinheitVorlagePersonal[],
  change?: { personalId: number; patch: Partial<EinheitVorlagePersonalEingabe> | null },
): EinheitVorlagePersonalEingabe[] {
  return personal.flatMap((p) => {
    const row: EinheitVorlagePersonalEingabe = {
      personal_id: p.personal_id,
      fahrzeug_id: p.fahrzeug_id ?? null,
      staerke_position: p.staerke_position ?? null,
    };
    if (change?.personalId !== p.personal_id) return [row];
    return change.patch === null ? [] : [{ ...row, ...change.patch }];
  });
}

export function StammbesetzungSection({ vorlage, vorlagen, isAdmin }: SectionProps) {
  const qc = useQueryClient();
  const names = useNames(vorlagen);
  const [selected, setSelected] = useState<number | undefined>();
  const personalQuery = useQuery({
    queryKey: globalKeys.personalListe('alle'),
    queryFn: () => listePersonal(false),
  });
  const replace = useMutation({
    mutationFn: (personal: EinheitVorlagePersonalEingabe[]) =>
      replaceVorlagePersonal(vorlage.id, personal),
    onSuccess: () => qc.invalidateQueries({ queryKey: globalKeys.einheitVorlagen() }),
  });

  const stammPosition = new Map(
    (personalQuery.data ?? []).map((p) => [p.id, p.staerke_position ?? null]),
  );
  const tree = treeIds(vorlagen, vorlage.id);
  const inTree = new Set(
    vorlagen.filter((v) => tree.has(v.id)).flatMap((v) => v.personal.map((p) => p.personal_id)),
  );
  const candidates = (personalQuery.data ?? []).filter(
    (p) => p.dienststatus === 'in_dienst' && !inTree.has(p.id),
  );
  const fahrzeugOptions = vorlage.fahrzeuge.map((f) => ({
    value: f.fahrzeug_id,
    label: f.funkrufname,
  }));

  return (
    <Paneel titel="Stammbesetzung" meta={vorlage.personal.length} style={{ marginBlockStart: 16 }}>
      <SpeicherFehler fehler={replace.error} />
      {vorlage.personal.length === 0 ? (
        <PaneelZeile>Keine Stammbesetzung</PaneelZeile>
      ) : (
        vorlage.personal.map((p) => {
          const stamm = stammPosition.get(p.personal_id);
          const update = (patch: Partial<EinheitVorlagePersonalEingabe> | null) =>
            replace.mutate(toInput(vorlage.personal, { personalId: p.personal_id, patch }));
          return (
            <Row
              key={p.personal_id}
              actions={
                <>
                  <Select<StaerkePosition>
                    aria-label={`Position ${p.name}`}
                    allowClear
                    disabled={!isAdmin || replace.isPending}
                    style={SELECT_STYLE}
                    // Leer gilt die Position aus dem Personalstamm.
                    placeholder={stamm ? mitVorgabe(POSITION_LABELS[stamm]) : 'Position'}
                    value={p.staerke_position ?? undefined}
                    options={POSITION_OPTIONEN}
                    onChange={(value) => update({ staerke_position: value ?? null })}
                  />
                  <Select<number>
                    aria-label={`Fahrzeug ${p.name}`}
                    allowClear
                    disabled={!isAdmin || replace.isPending || fahrzeugOptions.length === 0}
                    style={SELECT_STYLE}
                    placeholder="kein Fahrzeug"
                    value={p.fahrzeug_id ?? undefined}
                    options={fahrzeugOptions}
                    onChange={(value) => update({ fahrzeug_id: value ?? null })}
                  />
                  {isAdmin && (
                    <Button
                      danger
                      disabled={replace.isPending}
                      aria-label={`${p.name} aus der Stammbesetzung entfernen`}
                      onClick={() => update(null)}
                    >
                      Entfernen
                    </Button>
                  )}
                </>
              }
            >
              <KennungsLink to={personalDetailPfad(p.personal_id)}>{p.name}</KennungsLink>
              {p.ist_demo && <DemoMarke />}
              <Warnings dienststatus={p.dienststatus} auchIn={p.auch_in} names={names} />
            </Row>
          );
        })
      )}
      {isAdmin && (
        <Row
          actions={
            <Button
              disabled={selected == null}
              loading={replace.isPending}
              onClick={() => {
                if (selected == null) return;
                replace.mutate([...toInput(vorlage.personal), { personal_id: selected }], {
                  onSuccess: () => setSelected(undefined),
                });
              }}
            >
              Person hinzufügen
            </Button>
          }
        >
          <Select<number>
            aria-label="Person wählen"
            placeholder="Person wählen"
            style={SELECT_STYLE}
            value={selected}
            onChange={setSelected}
            loading={personalQuery.isLoading}
            options={demoGroupedOptions(candidates, (p) => p.name)}
          />
        </Row>
      )}
    </Paneel>
  );
}
