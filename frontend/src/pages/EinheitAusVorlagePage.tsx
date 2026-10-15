import { App, Breadcrumb, Button, Checkbox, Form, Input, Typography } from 'antd';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { ApiError } from '../api/client';
import { ladeEinsatz } from '../api/einsaetze';
import { listeAbschnitte } from '../api/einsatzabschnitte';
import { createEinheitAusVorlage, listeEinheiten, loadEinheitAusVorlage } from '../api/einheiten';
import { EINHEIT_NAME_MAX } from '../api/eingabegrenzen';
import { POSITION_LABELS } from '../api/personal';
import { einsatzKeys } from '../api/queryKeys';
import type {
  AusVorlageEingabe,
  VorlageVorschau,
  VorschauFahrzeug,
  VorschauKnoten,
  VorschauPersonal,
  ZeilenArt,
} from '../api/types';
import EinsatzSeite from '../components/EinsatzSeite';
import { ErfassungsFormular } from '../components/Erfassung';
import { Paneel, monoStil, useRollen, zielEinzug } from '../components/instrument';
import type { PaneelUeberschrift } from '../components/instrument/Paneel';
import { einsatzRechteGrund } from '../components/nurAnsicht';
import { Select } from '../components/Select';
import { SeitenFehler, SeitenSkeleton, nichtGefundenInhalt } from '../components/SeitenZustand';
import { RechteHinweis, ZeilenFehler } from '../components/SpeicherHinweis';
import { useZeilenFehler } from '../components/useZeilenFehler';
import {
  LEERE_WAHL,
  reconcileWahl,
  allePersonen,
  buildAnfrage,
  deckelGrund,
  gruendeJeZeile,
  isGesperrt,
  isNameVergeben,
  offersUmhaengen,
  ohneFahrzeug,
  setWahl,
  umhaengenText,
  verlaesstFahrzeug,
  showsUmhaengen,
  zeilenSchluessel,
  zusammenfassung,
  zustandWort,
  type Wahl,
} from '../einheit/ausVorlageKern';
import { modulName } from '../einsatz/modulRegistry';
import { darfImEinsatzSchreiben } from '../einsatz/schreibrecht';
import { useSprungSperre } from '../einsatz/useSprungSperre';
import {
  einheitDetailPfad,
  einheitenPfad,
  kraefteuebersichtPfad,
  parseRouteId,
} from '../routing/deeplinks';

/**
 * Einheit aus Vorlage bilden (LLH-1049, Spec `einheit-vorlagen`, „Seite zum Bilden aus der
 * Vorlage“ und „Rückmeldung der Seite“; Change `h997wi4l-einheit-aus-vorlage` D1, D4, D12, D14,
 * D15). Kopf: Name der obersten Einheit (vorbelegt, änderbar, Warnung bei gleichem Namen) und
 * Abschnitt. Darunter der Baum der Vorlage mit einem Häkchen je Fahrzeug (Vorgabe an) und je
 * Person (Vorgabe aus); jede Zeile nennt ihren Zustand als Wort. Ein Absenden bildet alles oder
 * nichts; Gründe einer Ablehnung stehen an der Zeile, nie im Toast. Danach öffnet das Meldebild
 * mit der neuen Einheit, ohne dessen Freigabe die Ansicht der Einheit.
 *
 * Die Logik steht im reinen Kern `einheit/ausVorlageKern.ts`; die Seite rendert und verdrahtet.
 * Online-only: die Vorschau liegt nicht im Lagebild ohne Netz (`frontend/src/offline/AGENTS.md`).
 */
export default function EinheitAusVorlagePage() {
  const { id, vorlageId } = useParams();
  const einsatzId = Number(id);
  const vorlage = parseRouteId(vorlageId);
  // Ein Wechsel von Einsatz oder Vorlage räumt Wahl und Gründe (`frontend/AGENTS.md`, „Rückwege
  // und Fehler“): eine neue Instanz statt Aufräumcode.
  return (
    <EinheitAusVorlage
      key={`${einsatzId}-${vorlage ?? ''}`}
      einsatzId={einsatzId}
      vorlageId={vorlage}
    />
  );
}

interface KopfWerte {
  name: string;
  abschnitt_id?: number | null;
}

function EinheitAusVorlage({
  einsatzId,
  vorlageId,
}: {
  einsatzId: number;
  vorlageId: number | null;
}) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { message } = App.useApp();
  const [form] = Form.useForm<KopfWerte>();
  const sprungGesperrt = useSprungSperre(einsatzId);
  const zeilen = useZeilenFehler<string>();
  /** Namen der zuletzt abgesendeten Zeilen: ein Grund nennt sie, auch wenn die Zeile wegfiel. */
  const [namen, setNamen] = useState<ReadonlyMap<string, string>>(new Map());
  const [rohWahl, setRohWahl] = useState<Wahl>(LEERE_WAHL);
  const nameWert = Form.useWatch('name', form);
  // Steht die Seite noch? Der Erfolg kommt auch, wenn sie inzwischen verlassen wurde; dann bleibt
  // der Bediener, wo er hingegangen ist (nur die Rückmeldung erscheint).
  const stehtRef = useRef(true);
  useEffect(() => {
    stehtRef.current = true;
    return () => {
      stehtRef.current = false;
    };
  }, []);

  const einsatzQuery = useQuery({
    queryKey: einsatzKeys.einsatz(einsatzId),
    queryFn: () => ladeEinsatz(einsatzId),
  });
  const vorschauQuery = useQuery({
    queryKey: einsatzKeys.einheitAusVorlage(einsatzId, vorlageId ?? 0),
    queryFn: () => loadEinheitAusVorlage(einsatzId, vorlageId ?? 0),
    enabled: vorlageId != null,
  });
  const einheitenQuery = useQuery({
    queryKey: einsatzKeys.einheiten(einsatzId),
    queryFn: () => listeEinheiten(einsatzId),
  });
  const abschnitteQuery = useQuery({
    queryKey: einsatzKeys.abschnitte(einsatzId),
    queryFn: () => listeAbschnitte(einsatzId),
  });

  const vorschau = vorschauQuery.data;
  // Wahl je Stamm-ID über Abgleiche hinweg (D14): eine neu erscheinende Zeile bekommt ihre
  // Vorgabe, eine getroffene Wahl bleibt. Der Effekt hält sie fest; gerendert wird schon vorher
  // mit dem Abgleich, damit eine neue Zeile nicht einen Takt lang ohne Vorgabe steht.
  useEffect(() => {
    if (vorschau) setRohWahl((w) => reconcileWahl(w, vorschau));
  }, [vorschau]);
  const wahl = useMemo(
    () => (vorschau ? reconcileWahl(rohWahl, vorschau) : rohWahl),
    [rohWahl, vorschau],
  );

  const bilden = useMutation({
    mutationFn: (eingabe: AusVorlageEingabe) => createEinheitAusVorlage(einsatzId, eingabe),
    onMutate: () => zeilen.leere(),
    onError: (fehler) => {
      for (const [schluessel, grund] of gruendeJeZeile(fehler)) {
        zeilen.melde(schluessel, new ApiError(422, grund));
      }
      // Nach einer Ablehnung gleicht die Seite die Vorschau ab (D14): der neue Zustand steht dann
      // neben dem Grund.
      if (fehler instanceof ApiError && fehler.status === 422 && vorlageId != null) {
        void qc.invalidateQueries({
          queryKey: einsatzKeys.einheitAusVorlage(einsatzId, vorlageId),
        });
      }
    },
    onSuccess: (ergebnis) => {
      for (const key of [
        einsatzKeys.einheiten(einsatzId),
        einsatzKeys.personal(einsatzId),
        einsatzKeys.fahrzeuge(einsatzId),
        einsatzKeys.etb(einsatzId),
        einsatzKeys.kraefteZeitachse(einsatzId),
      ])
        void qc.invalidateQueries({ queryKey: key });
      message.success('Einheit gebildet');
      if (!stehtRef.current) return;
      // Ins Meldebild mit der neuen Einheit (D12), ohne dessen Freigabe in ihre Ansicht.
      void navigate(
        sprungGesperrt('kraefteuebersicht')
          ? einheitDetailPfad(einsatzId, ergebnis.einheit_id)
          : kraefteuebersichtPfad(einsatzId, { einheit: ergebnis.einheit_id }),
      );
    },
  });

  if (einsatzQuery.isLoading || vorschauQuery.isLoading) return <SeitenSkeleton />;
  if (einsatzQuery.isError || !einsatzQuery.data) {
    return (
      <SeitenFehler
        text="Einsatz nicht gefunden oder kein Zugriff"
        ursache={einsatzQuery.error}
        onWiederholen={() => void einsatzQuery.refetch()}
      />
    );
  }
  const einsatz = einsatzQuery.data;
  const darfSchreiben = darfImEinsatzSchreiben(einsatz);
  const titel = 'Einheit aus Vorlage bilden';
  const breadcrumb = (
    <Breadcrumb
      items={[
        { title: <Link to="/einsaetze">Einsätze</Link> },
        { title: einsatz.bezeichnung },
        { title: <Link to={einheitenPfad(einsatzId)}>{modulName('einheiten')}</Link> },
        { title: 'Aus Vorlage' },
      ]}
    />
  );
  if (vorlageId == null || vorschauQuery.isError || !vorschau) {
    return (
      <EinsatzSeite breadcrumb={breadcrumb} titel={titel} breite="schmal">
        <SeitenFehler
          text="Vorlage nicht verfügbar"
          ursache={vorschauQuery.error}
          onWiederholen={vorlageId == null ? undefined : () => void vorschauQuery.refetch()}
        />
      </EinsatzSeite>
    );
  }

  const einheiten = einheitenQuery.data ?? [];
  const wurzelName = vorschau.knoten[0]?.name ?? '';
  const deckel = deckelGrund(vorschau, wahl);
  const zeilenSchluesselJetzt = new Set([
    ...vorschau.knoten.flatMap((k) =>
      k.fahrzeuge.map((f) => zeilenSchluessel('fahrzeug', f.fahrzeug_id)),
    ),
    ...allePersonen(vorschau).map((p) => zeilenSchluessel('personal', p.personal_id)),
  ]);
  // Gründe ohne Zeile (aus der Vorlage gefallen) stehen über der Aktion, mit Kennung.
  const verwaisteGruende = zeilen.gemeldet().filter((k) => !zeilenSchluesselJetzt.has(k));

  const absenden = (werte: KopfWerte) => {
    const eingabe = buildAnfrage({
      vorlageId,
      name: werte.name,
      abschnittId: werte.abschnitt_id,
      vorschau,
      wahl,
    });
    setNamen(zeilenNamen(vorschau));
    return bilden.mutateAsync(eingabe);
  };

  return (
    <EinsatzSeite
      breadcrumb={breadcrumb}
      titel={titel}
      meta={wurzelName}
      breite="schmal"
      hinweis={
        darfSchreiben ? undefined : (
          <RechteHinweis sichtbar text={einsatzRechteGrund(einsatz.status)} />
        )
      }
    >
      <ErfassungsFormular<KopfWerte>
        form={form}
        initialValues={{ name: wurzelName, abschnitt_id: null }}
        erfassenText="Einheit bilden"
        laeuft={bilden.isPending}
        gesperrt={!darfSchreiben || deckel != null}
        speicherung={bilden}
        speicherFehlerTitel="Einheit nicht gebildet"
        speicherFehlerFallback="Bilden fehlgeschlagen"
        onErfassen={absenden}
        // Der Sprung ins Meldebild hängt am Ergebnis und steht deshalb in `onSuccess`.
        onFertig={() => {}}
        onAbbrechen={() => void navigate(einheitenPfad(einsatzId))}
        zusammenfassung={
          <>
            {zusammenfassung(vorschau, wahl)}
            {deckel != null && (
              <Typography.Text type="danger" style={{ display: 'block' }}>
                {deckel}
              </Typography.Text>
            )}
          </>
        }
      >
        <KopfFelder
          einheiten={einheiten}
          abschnitteInhalt={nichtGefundenInhalt(abschnitteQuery, {
            kein403: 'Abschnitte nicht freigegeben',
            allgemein: 'Abschnitte konnten nicht geladen werden',
          })}
          abschnitte={(abschnitteQuery.data ?? []).map((a) => ({ value: a.id, label: a.name }))}
        />
        <Baum
          vorschau={vorschau}
          wahl={wahl}
          wurzelName={nameWert ?? wurzelName}
          einheiten={einheiten}
          gesperrt={!darfSchreiben}
          grund={(k) => zeilen.grund(k)?.fehler ?? null}
          onWahl={(art, zeile, an) =>
            setRohWahl((w) => setWahl(reconcileWahl(w, vorschau), art, zeile, an))
          }
        />
        {verwaisteGruende.map((k) => (
          <div key={k}>
            <ZeilenFehler fehler={zeilen.grund(k)?.fehler} kennung={namen.get(k) ?? k} />
          </div>
        ))}
      </ErfassungsFormular>
    </EinsatzSeite>
  );
}

/** Namen aller Zeilen beim Absenden (Funkrufname bzw. Name). */
function zeilenNamen(v: VorlageVorschau): Map<string, string> {
  const m = new Map<string, string>();
  for (const k of v.knoten) {
    for (const f of k.fahrzeuge) m.set(zeilenSchluessel('fahrzeug', f.fahrzeug_id), f.funkrufname);
    for (const p of k.personal) m.set(zeilenSchluessel('personal', p.personal_id), p.name);
  }
  return m;
}

/** Name der obersten Einheit und Abschnitt (D1: der Abschnitt steht hier, nicht im Dialog). */
function KopfFelder({
  einheiten,
  abschnitte,
  abschnitteInhalt,
}: {
  einheiten: Parameters<typeof isNameVergeben>[1];
  abschnitte: { value: number; label: string }[];
  abschnitteInhalt: string | undefined;
}) {
  const name =
    (Form.useWatch('name', Form.useFormInstance<KopfWerte>()) as string | undefined) ?? '';
  const vergeben = isNameVergeben(name, einheiten);
  return (
    <>
      <Form.Item
        label="Name"
        name="name"
        rules={[{ required: true, whitespace: true, message: 'Name darf nicht leer sein' }]}
        // Warnung, keine Sperre (D15): zwei Züge derselben Vorlage sind legitim.
        validateStatus={vergeben ? 'warning' : undefined}
        help={vergeben ? 'Name schon vergeben' : undefined}
      >
        <Input maxLength={EINHEIT_NAME_MAX} />
      </Form.Item>
      <Form.Item label="Abschnitt" name="abschnitt_id">
        <Select<number>
          allowClear
          placeholder="ohne Abschnitt"
          options={abschnitte}
          notFoundContent={abschnitteInhalt}
        />
      </Form.Item>
    </>
  );
}

interface BaumProps {
  vorschau: VorlageVorschau;
  wahl: Wahl;
  wurzelName: string;
  einheiten: Parameters<typeof isNameVergeben>[1];
  gesperrt: boolean;
  grund: (schluessel: string) => unknown;
  onWahl: (art: ZeilenArt, zeile: VorschauFahrzeug | VorschauPersonal, an: boolean) => void;
}

/** Tiefe eines Knotens im Baum der Vorlage (Wurzel 0). */
function tiefen(knoten: readonly VorschauKnoten[]): Map<number, number> {
  const t = new Map<number, number>();
  for (const k of knoten) {
    t.set(k.vorlage_id, k.ueber_vorlage_id != null ? (t.get(k.ueber_vorlage_id) ?? 0) + 1 : 0);
  }
  return t;
}

const UEBERSCHRIFTEN: PaneelUeberschrift[] = ['h2', 'h3', 'h4', 'h5', 'h6'];

/** Der Baum der Vorlage: je Einheit ein Paneel, Fahrzeuge mit ihrer Besatzung, dann der Rest. */
function Baum({ vorschau, wahl, wurzelName, einheiten, gesperrt, grund, onWahl }: BaumProps) {
  const { token } = useRollen();
  const tiefe = tiefen(vorschau.knoten);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: token.marginSM }}>
      {(vorschau.fahrzeuge_gesperrt || vorschau.personal_gesperrt) && (
        <Typography.Text type="secondary" data-lfh="vorlage-gesperrt">
          {[
            vorschau.fahrzeuge_gesperrt ? 'Fahrzeuge gesperrt' : null,
            vorschau.personal_gesperrt ? 'Personal gesperrt' : null,
          ]
            .filter(Boolean)
            .join(' · ')}
        </Typography.Text>
      )}
      {vorschau.knoten.map((k, i) => {
        const t = tiefe.get(k.vorlage_id) ?? 0;
        const name = i === 0 ? wurzelName.trim() || k.name : k.name;
        const fahrzeugIds = new Set(k.fahrzeuge.map((f) => f.fahrzeug_id));
        const ohne = k.personal.filter(
          (p) => p.fahrzeug_id == null || !fahrzeugIds.has(p.fahrzeug_id),
        );
        return (
          <Paneel
            key={k.vorlage_id}
            titel={name}
            ueberschrift={UEBERSCHRIFTEN[Math.min(t, UEBERSCHRIFTEN.length - 1)]}
            meta={
              <span>
                {k.typ_label}
                {k.funkrufname && <span style={monoStil(12)}> · {k.funkrufname}</span>}
              </span>
            }
            koerperPolster
            style={{ marginInlineStart: t * token.margin }}
          >
            {i > 0 && isNameVergeben(k.name, einheiten) && (
              <Typography.Text type="warning" style={{ display: 'block' }}>
                Name schon vergeben
              </Typography.Text>
            )}
            {k.fahrzeuge.map((f) => (
              <div key={f.fahrzeug_id}>
                <KraftZeile
                  art="fahrzeug"
                  zeile={f}
                  wahl={wahl}
                  gesperrt={gesperrt}
                  grund={grund(zeilenSchluessel('fahrzeug', f.fahrzeug_id))}
                  onWahl={onWahl}
                  beschriftung={
                    <>
                      <span style={monoStil(14)}>{f.funkrufname}</span>
                      {f.fahrzeugtyp && (
                        <Typography.Text type="secondary"> {f.fahrzeugtyp}</Typography.Text>
                      )}
                    </>
                  }
                />
                <div style={{ marginInlineStart: token.marginLG }}>
                  {k.personal
                    .filter((p) => p.fahrzeug_id === f.fahrzeug_id)
                    .map((p) => (
                      <PersonZeile
                        key={p.personal_id}
                        person={p}
                        vorschau={vorschau}
                        wahl={wahl}
                        gesperrt={gesperrt}
                        grund={grund(zeilenSchluessel('personal', p.personal_id))}
                        onWahl={onWahl}
                      />
                    ))}
                </div>
              </div>
            ))}
            {ohne.length > 0 && (
              <div>
                {k.fahrzeuge.length > 0 && (
                  <Typography.Text type="secondary">Ohne Fahrzeug</Typography.Text>
                )}
                {ohne.map((p) => (
                  <PersonZeile
                    key={p.personal_id}
                    person={p}
                    vorschau={vorschau}
                    wahl={wahl}
                    gesperrt={gesperrt}
                    grund={grund(zeilenSchluessel('personal', p.personal_id))}
                    onWahl={onWahl}
                  />
                ))}
              </div>
            )}
          </Paneel>
        );
      })}
    </div>
  );
}

function PersonZeile({
  person,
  vorschau,
  wahl,
  gesperrt,
  grund,
  onWahl,
}: {
  person: VorschauPersonal;
  vorschau: VorlageVorschau;
  wahl: Wahl;
  gesperrt: boolean;
  grund: unknown;
  onWahl: BaumProps['onWahl'];
}) {
  const verlaesst = verlaesstFahrzeug(person, vorschau, wahl);
  const gewaehlt = wahl.personal.get(person.personal_id)?.an === true;
  const hinweise = [
    // Nur an einer gewählten Person: wer nicht mitkommt, braucht den Hinweis nicht.
    gewaehlt && ohneFahrzeug(person, vorschau, wahl) ? 'ohne Fahrzeug' : null,
    verlaesst != null ? `verlässt «${verlaesst}»` : null,
  ].filter((h): h is string => h != null);
  return (
    <KraftZeile
      art="personal"
      zeile={person}
      wahl={wahl}
      gesperrt={gesperrt}
      grund={grund}
      onWahl={onWahl}
      hinweise={hinweise}
      beschriftung={
        <>
          {person.name}
          {person.staerke_position && (
            <Typography.Text type="secondary">
              {' '}
              {POSITION_LABELS[person.staerke_position]}
            </Typography.Text>
          )}
        </>
      }
    />
  );
}

/**
 * Eine Kraft: beschriftetes Kästchen (Name, an einer gebundenen Kraft „umhängen aus «X»“),
 * daneben der Zustand als Wort, darunter Hinweise und der Grund einer Ablehnung. Gesperrt
 * (außer Dienst) nur, solange nicht angehakt: ein vorher gesetztes Häkchen lässt sich lösen.
 * Wurde die Kraft erst nach dem Anhaken gebunden, steht darunter der Griff „umhängen aus «X»“
 * (LLH-1237): ein Klick übernimmt sie, statt das Häkchen zu lösen und neu zu setzen.
 */
function KraftZeile({
  art,
  zeile,
  wahl,
  gesperrt,
  grund,
  onWahl,
  beschriftung,
  hinweise = [],
}: {
  art: ZeilenArt;
  zeile: VorschauFahrzeug | VorschauPersonal;
  wahl: Wahl;
  gesperrt: boolean;
  grund: unknown;
  onWahl: BaumProps['onWahl'];
  beschriftung: ReactNode;
  hinweise?: string[];
}) {
  const { token } = useRollen();
  const id =
    art === 'fahrzeug'
      ? (zeile as VorschauFahrzeug).fahrzeug_id
      : (zeile as VorschauPersonal).personal_id;
  const eintrag = (art === 'fahrzeug' ? wahl.fahrzeuge : wahl.personal).get(id);
  const an = eintrag?.an === true;
  const umhaengen = showsUmhaengen(zeile, eintrag) ? umhaengenText(art, zeile) : null;
  const griff = !gesperrt && offersUmhaengen(zeile, eintrag) ? umhaengenText(art, zeile) : null;
  const kennung =
    art === 'fahrzeug' ? (zeile as VorschauFahrzeug).funkrufname : (zeile as VorschauPersonal).name;
  const zustandGesperrt = isGesperrt(art, zeile.zustand);
  return (
    <div
      data-lfh="vorlage-zeile"
      data-zeile={zeilenSchluessel(art, id)}
      // Zielabstand (Bedien-Leitlinie Kriterium 2): zwei Kästchen untereinander stehen
      // 0 / 8 / 16 px auseinander, je Zeile der halbe Abstand oben und unten (`zielEinzug`).
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        columnGap: token.marginSM,
        paddingBlock: zielEinzug(token),
      }}
    >
      <Checkbox
        checked={an}
        disabled={gesperrt || (zustandGesperrt && !an)}
        onChange={(e) => onWahl(art, zeile, e.target.checked)}
        style={{ flex: '1 1 auto', minWidth: 0 }}
      >
        {beschriftung}
        {umhaengen && <span> · {umhaengen}</span>}
      </Checkbox>
      <Typography.Text type="secondary" data-lfh="vorlage-zustand" style={{ whiteSpace: 'nowrap' }}>
        {zustandWort(art, zeile)}
      </Typography.Text>
      {(hinweise.length > 0 || grund != null || griff != null) && (
        <div style={{ flexBasis: '100%', paddingInlineStart: token.marginLG }}>
          {hinweise.length > 0 && (
            <Typography.Text type="secondary" style={{ display: 'block' }}>
              {hinweise.join(' · ')}
            </Typography.Text>
          )}
          <ZeilenFehler fehler={grund} />
          {griff != null && (
            <div>
              <Button
                type="link"
                aria-label={`${griff} – ${kennung}`}
                onClick={() => onWahl(art, zeile, true)}
                style={{ paddingInline: 0 }}
              >
                {griff}
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
