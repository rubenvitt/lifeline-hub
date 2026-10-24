import { Button, InputNumber, Space, Typography, theme } from 'antd';
import { useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import DemoMarke from '../components/DemoMarke';
import { Paneel, PaneelZeile, StatusChip, monoStil } from '../components/instrument';
import { KennungsLink } from '../components/kennungsLink';
import { Select } from '../components/Select';
import { SpeicherFehler } from '../components/SpeicherHinweis';
import { mitVorgabe } from '../components/vorgabeText';
import {
  replaceVorlageFahrzeuge,
  replaceVorlageMaterial,
  replaceVorlagePersonal,
} from '../api/einheitVorlagen';
import { listeFahrzeuge } from '../api/fahrzeuge';
import { listeMaterial } from '../api/material';
import { POSITION_LABELS, POSITION_OPTIONEN, listePersonal } from '../api/personal';
import { globalKeys } from '../api/queryKeys';
import type {
  EinheitVorlage,
  EinheitVorlageMaterial,
  EinheitVorlageMaterialEingabe,
  EinheitVorlagePersonal,
  EinheitVorlagePersonalEingabe,
  StaerkePosition,
} from '../api/types';
import { ART_LABEL } from '../kraefte/materialPosten';
import { demoGroupedOptions } from './demoAuswahl';
import {
  einheitVorlageDetailPath,
  fahrzeugDetailPfad,
  personalDetailPfad,
} from './stammdatenDetail';
import { treeIds } from './einheitVorlagenBaum';
import EinheitVorlageFormModal from './EinheitVorlageFormModal';

/**
 * Die Listen der Vorlagen-Detailseite (LLH-1042): Untereinheiten, Fahrzeuge, Stammbesetzung und
 * Material (LLH-1261). Jeder Handgriff speichert sofort die ganze Liste (PUT, Spec
 * `einheit-vorlagen`, „Fahrzeuge und Stammbesetzung der Vorlage“, „Material der Vorlage“); der Grund einer Ablehnung steht im Paneel, bis zum
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

// ── Material (LLH-1261) ──────────────────────────────────────────────────────────────────────

/** Höchstmenge eines Geräts je Position (`GERAET_JE_POSITION_MAX` im Server, design.md D2). */
export const GERAET_JE_POSITION_MAX = 10;

/** Ein bestimmtes Stück: Gerät mit Bestandsnummer, Menge fest 1 und einmal im Baum. */
function isStueck(m: Pick<EinheitVorlageMaterial, 'art' | 'bestandsnummer'>): boolean {
  return m.art === 'geraet' && m.bestandsnummer != null;
}

/** Die Liste in PUT-Form, mit einer geänderten oder ohne eine Position. */
function toMaterialInput(
  material: readonly EinheitVorlageMaterial[],
  change?: { id: number; patch: Partial<EinheitVorlageMaterialEingabe> | null },
): EinheitVorlageMaterialEingabe[] {
  return material.flatMap((m) => {
    const row: EinheitVorlageMaterialEingabe = {
      material_id: m.material_id,
      menge: m.menge,
      fahrzeug_id: m.fahrzeug_id ?? null,
    };
    if (change?.id !== m.id) return [row];
    return change.patch === null ? [] : [{ ...row, ...change.patch }];
  });
}

/**
 * Menge einer Position: gespeichert wird beim Verlassen des Felds oder mit Enter, nicht je
 * Tastendruck; ein leeres oder gleiches Feld schickt nichts, und derselbe Wert geht nicht zweimal
 * hinaus (Enter, dann Verlassen), bis der Server eine neue Menge liefert.
 */
function MengeFeld({
  bezeichnung,
  menge,
  max,
  disabled,
  onCommit,
}: {
  bezeichnung: string;
  menge: number;
  max?: number;
  disabled: boolean;
  onCommit: (menge: number) => void;
}) {
  const [wert, setWert] = useState<number | null>(menge);
  const [gespeichert, setGespeichert] = useState(menge);
  const [gesendet, setGesendet] = useState<number | null>(null);
  if (gespeichert !== menge) {
    // Der Server hat eine neue Menge geliefert: das Feld folgt ihr.
    setGespeichert(menge);
    setWert(menge);
    setGesendet(null);
  }
  const commit = () => {
    if (wert == null || wert < 1 || wert === menge) {
      setWert(menge);
      return;
    }
    if (wert === gesendet) return;
    setGesendet(wert);
    onCommit(wert);
  };
  return (
    <InputNumber
      aria-label={`Menge ${bezeichnung}`}
      min={1}
      max={max}
      precision={0}
      disabled={disabled}
      style={{ width: 96 }}
      value={wert}
      onChange={setWert}
      onBlur={commit}
      onPressEnter={commit}
    />
  );
}

export function MaterialSection({ vorlage, vorlagen, isAdmin }: SectionProps) {
  const qc = useQueryClient();
  const [selected, setSelected] = useState<number | undefined>();
  const materialQuery = useQuery({
    queryKey: globalKeys.materialListe('alle'),
    queryFn: () => listeMaterial(false),
    enabled: isAdmin,
  });
  const replace = useMutation({
    mutationFn: (material: EinheitVorlageMaterialEingabe[]) =>
      replaceVorlageMaterial(vorlage.id, material),
    onSuccess: () => qc.invalidateQueries({ queryKey: globalKeys.einheitVorlagen() }),
  });

  // Zur Wahl steht, was in Dienst ist; ein Stück (Gerät mit Bestandsnummer) nur, solange es
  // nirgends im selben Vorlagen-Baum steht. Verbrauchsgut darf mehrfach stehen.
  const tree = treeIds(vorlagen, vorlage.id);
  const stueckeImBaum = new Set(
    vorlagen
      .filter((v) => tree.has(v.id))
      .flatMap((v) => v.material.filter(isStueck).map((m) => m.material_id)),
  );
  const candidates = (materialQuery.data ?? []).filter(
    (m) => m.dienststatus === 'in_dienst' && !(isStueck(m) && stueckeImBaum.has(m.id)),
  );
  const fahrzeugOptions = vorlage.fahrzeuge.map((f) => ({
    value: f.fahrzeug_id,
    label: f.funkrufname,
  }));

  return (
    <Paneel titel="Material" meta={vorlage.material.length} style={{ marginBlockStart: 16 }}>
      <SpeicherFehler fehler={replace.error} />
      {vorlage.material.length === 0 ? (
        <PaneelZeile>Kein Material</PaneelZeile>
      ) : (
        vorlage.material.map((m) => {
          const update = (patch: Partial<EinheitVorlageMaterialEingabe> | null) =>
            replace.mutate(toMaterialInput(vorlage.material, { id: m.id, patch }));
          return (
            <Row
              key={m.id}
              actions={
                <>
                  <MengeFeld
                    bezeichnung={m.bezeichnung}
                    menge={m.menge}
                    max={m.art === 'geraet' ? GERAET_JE_POSITION_MAX : undefined}
                    disabled={!isAdmin || replace.isPending || isStueck(m)}
                    onCommit={(menge) => update({ menge })}
                  />
                  <Select<number>
                    aria-label={`Ort ${m.bezeichnung}`}
                    allowClear
                    disabled={!isAdmin || replace.isPending || fahrzeugOptions.length === 0}
                    style={SELECT_STYLE}
                    placeholder="an der Einheit"
                    value={m.fahrzeug_id ?? undefined}
                    options={fahrzeugOptions}
                    onChange={(value) => update({ fahrzeug_id: value ?? null })}
                  />
                  {isAdmin && (
                    <Button
                      danger
                      disabled={replace.isPending}
                      aria-label={`${m.bezeichnung} aus der Vorlage entfernen`}
                      onClick={() => update(null)}
                    >
                      Entfernen
                    </Button>
                  )}
                </>
              }
            >
              <span>{m.bezeichnung}</span>
              {m.bestandsnummer && <span style={monoStil(13)}>{m.bestandsnummer}</span>}
              <Typography.Text type="secondary">{ART_LABEL[m.art]}</Typography.Text>
              {m.ist_demo && <DemoMarke />}
              {m.dienststatus === 'ausser_dienst' && (
                <StatusChip ton="achtung" wort="außer Dienst" />
              )}
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
                replace.mutate(
                  [...toMaterialInput(vorlage.material), { material_id: selected, menge: 1 }],
                  { onSuccess: () => setSelected(undefined) },
                );
              }}
            >
              Material hinzufügen
            </Button>
          }
        >
          <Select<number>
            aria-label="Material wählen"
            placeholder="Material wählen"
            style={SELECT_STYLE}
            value={selected}
            onChange={setSelected}
            loading={materialQuery.isLoading}
            options={demoGroupedOptions(
              candidates,
              (m) => `${m.bezeichnung}${m.bestandsnummer ? ` (${m.bestandsnummer})` : ''}`,
            )}
          />
        </Row>
      )}
    </Paneel>
  );
}
