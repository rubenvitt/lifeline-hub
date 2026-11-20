import { useId, useState } from 'react';
import { App, Button, Popconfirm, Slider, Switch, Upload } from 'antd';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  aenderePlan,
  einpassen,
  entfernePlan,
  hinterlegePlan,
  PLAN_BREITE,
  PLAN_VERSATZ_MAX,
  raste,
  uebernehmePlan,
  type PlanPatch,
  type UhsPlan,
} from '../../api/uhsPlan';
import { listeUhsAnhaenge } from '../../api/einsatzUhs';
import { einsatzKeys } from '../../api/queryKeys';
import { UPLOAD_MAX_GROESSE } from '../../api/upload';
import type { UhsDetail } from '../../api/types';
import { Select } from '../../components/Select';
import { SpeicherFehler } from '../../components/SpeicherHinweis';
import { FELD_KLASSE, Paneel, Stapel, Textstufe, useRollen } from '../../components/instrument';
import { IconHochladen } from '../../icons';
import { ZahlFeld } from '../../components/ZahlFeld';

/** Formate, die der Server als Plan annimmt (`src/uhs/plan.rs`, D3). HEIC bleibt draußen. */
export const PLAN_ACCEPT = '.png,.jpg,.jpeg,.webp';
const PLAN_MIME = new Set(['image/png', 'image/jpeg', 'image/webp']);

interface Props {
  einsatzId: number;
  uhs: Pick<UhsDetail, 'id' | 'plaetze' | 'plan'>;
}

/**
 * Bedienung des Plans unter dem Platz-Layout (LFH-999, design.md D8). Steht nur im
 * Bearbeiten-Modus der Plätze, als Expander über der Fläche (UI-Form-Leitlinie: mehr als vier
 * Felder sind kein Drawer). Zahlen und Regler schicken den PATCH beim Verlassen bzw. Loslassen,
 * nicht bei jedem Schritt: jeder PATCH verteilt ein `uhs`-Ereignis an alle offenen Grundrisse.
 */
export default function UhsPlanPaneel({ einsatzId, uhs }: Props) {
  const qc = useQueryClient();
  const { token } = useRollen();
  const { message } = App.useApp();
  const plan = uhs.plan ?? null;

  const anhaenge = useQuery({
    queryKey: einsatzKeys.uhsAnhaenge(einsatzId, uhs.id),
    queryFn: () => listeUhsAnhaenge(einsatzId, uhs.id),
  });
  const bilder = (anhaenge.data ?? []).filter((a) => PLAN_MIME.has(a.mime));
  const [auswahl, setAuswahl] = useState<number | null>(null);
  // Zu große Datei: eine Prüfung ohne Server, sie steht am Hochladen, nicht im Toast (LFH-1077).
  // Die nächste Wahl räumt sie.
  const [zuGross, setZuGross] = useState(false);

  function uebernimm(neu: UhsPlan | null) {
    qc.setQueryData<UhsDetail>(einsatzKeys.uhsDetail(einsatzId, uhs.id), (alt) =>
      alt ? { ...alt, plan: neu } : alt,
    );
    return qc.invalidateQueries({ queryKey: einsatzKeys.uhsDetail(einsatzId, uhs.id) });
  }

  const hochladen = useMutation({
    mutationFn: (datei: File) => hinterlegePlan(einsatzId, uhs.id, datei),
    onSuccess: async (neu) => {
      message.success(plan ? 'Plan ersetzt' : 'Plan hinterlegt');
      await uebernimm(neu);
    },
  });
  const uebernehmen = useMutation({
    mutationFn: (anhangId: number) => uebernehmePlan(einsatzId, uhs.id, anhangId),
    onSuccess: async (neu) => {
      message.success('Plan übernommen');
      setAuswahl(null);
      await uebernimm(neu);
    },
  });
  // Zählt abgeschlossene PATCHes: Felder und Regler setzen sich danach auf den Serverstand zurück,
  // auch wenn der sich nicht geändert hat (Fehlschlag, eingerastet gleich).
  const [abgeschlossen, setAbgeschlossen] = useState(0);
  const aendern = useMutation({
    mutationFn: (patch: PlanPatch) => aenderePlan(einsatzId, uhs.id, patch),
    onSuccess: (neu) => uebernimm(neu),
    onSettled: () => setAbgeschlossen((n) => n + 1),
  });
  const entfernen = useMutation({
    mutationFn: () => entfernePlan(einsatzId, uhs.id),
    onSuccess: async () => {
      message.success('Plan entfernt');
      await uebernimm(null);
    },
  });
  // Ein Fehler-Slot: der jüngste Fehlschlag. Jede Mutation räumt ihren beim nächsten Absenden.
  const fehler = hochladen.error ?? uebernehmen.error ?? aendern.error ?? entfernen.error;
  const laeuft =
    hochladen.isPending || uebernehmen.isPending || aendern.isPending || entfernen.isPending;

  return (
    <Paneel titel="Plan" ueberschrift="h4" koerperPolster style={{ marginBottom: token.marginSM }}>
      <Stapel abstand="md">
        {/* Datenschutz- und Protokollhinweis in einer Zeile (LFH-1078: erlaubt, kurz). */}
        <Textstufe ton="gedaempft">Keine Patientenfotos. Übernahme wird protokolliert.</Textstufe>
        <SpeicherFehler fehler={fehler} />
        <Stapel richtung="zeile" umbruch abstand="md" ausrichten="ende">
          <div data-lfh="plan-datei">
            <Stapel abstand="xs">
              <Upload
                accept={PLAN_ACCEPT}
                maxCount={1}
                showUploadList={false}
                disabled={laeuft}
                beforeUpload={(datei) => {
                  const gross = datei.size > UPLOAD_MAX_GROESSE;
                  setZuGross(gross);
                  if (!gross) hochladen.mutate(datei);
                  // Gesendet wird über `hinterlegePlan`, nie über antds eigenen Upload.
                  return false;
                }}
              >
                <Button
                  loading={hochladen.isPending}
                  icon={
                    <span aria-hidden="true">
                      <IconHochladen />
                    </span>
                  }
                >
                  {plan ? 'Plan ersetzen' : 'Plan hochladen'}
                </Button>
              </Upload>
              {zuGross && (
                <div role="alert">
                  <Textstufe ton="alarm">
                    {`Datei ist zu groß (${UPLOAD_MAX_GROESSE / 1024 / 1024} MiB erlaubt)`}
                  </Textstufe>
                </div>
              )}
            </Stapel>
          </div>
          <UebernahmeAuswahl
            optionen={bilder.map((a) => ({ value: a.id, label: a.dateiname }))}
            wert={auswahl}
            onWahl={setAuswahl}
            gesperrt={laeuft}
            onUebernehmen={() => auswahl != null && uebernehmen.mutate(auswahl)}
            laedt={uebernehmen.isPending}
          />
        </Stapel>
        {plan && (
          <PlanEinstellungen
            plan={plan}
            stand={abgeschlossen}
            gesperrt={laeuft}
            onAendern={(patch) => aendern.mutate(patch)}
            onEinpassen={() =>
              aendern.mutate(einpassen(uhs.plaetze, plan.bild_breite, plan.bild_hoehe))
            }
            onEntfernen={() => entfernen.mutate()}
          />
        )}
      </Stapel>
    </Paneel>
  );
}

function UebernahmeAuswahl(props: {
  optionen: { value: number; label: string }[];
  wert: number | null;
  onWahl: (id: number | null) => void;
  gesperrt: boolean;
  onUebernehmen: () => void;
  laedt: boolean;
}) {
  const id = useId();
  return (
    <Stapel richtung="zeile" umbruch abstand="xs" ausrichten="mitte">
      <Textstufe als="label" htmlFor={id}>
        Aus Dateien übernehmen
      </Textstufe>
      <div className={FELD_KLASSE} style={{ width: 'var(--lfh-feld-schmal)', maxWidth: '100%' }}>
        <Select<number>
          id={id}
          placeholder={props.optionen.length === 0 ? 'Keine Bilder abgelegt' : 'Bild wählen'}
          options={props.optionen}
          value={props.wert ?? undefined}
          onChange={(v) => props.onWahl(v ?? null)}
          disabled={props.gesperrt || props.optionen.length === 0}
        />
      </div>
      <Button
        onClick={props.onUebernehmen}
        disabled={props.gesperrt || props.wert == null}
        loading={props.laedt}
      >
        Übernehmen
      </Button>
    </Stapel>
  );
}

function PlanEinstellungen({
  plan,
  stand,
  gesperrt,
  onAendern,
  onEinpassen,
  onEntfernen,
}: {
  plan: UhsPlan;
  /** Zähler abgeschlossener PATCHes, Teil der `key`s. */
  stand: number;
  gesperrt: boolean;
  onAendern: (patch: PlanPatch) => void;
  onEinpassen: () => void;
  onEntfernen: () => void;
}) {
  const umkehrId = useId();
  return (
    <Stapel abstand="md">
      <Stapel richtung="zeile" umbruch abstand="md" ausrichten="ende">
        {/* `key` am Serverwert und am PATCH-Zähler: ein Live-Ereignis, Einpassen, ein Fehlschlag
            oder ein eingerastet gleicher Wert setzen das Feld neu auf. */}
        <PlanMassFeld
          key={`x-${plan.x}-${stand}`}
          label="Links"
          wert={plan.x}
          min={0}
          max={PLAN_VERSATZ_MAX}
          gesperrt={gesperrt}
          onFertig={(x) => onAendern({ x })}
        />
        <PlanMassFeld
          key={`y-${plan.y}-${stand}`}
          label="Oben"
          wert={plan.y}
          min={0}
          max={PLAN_VERSATZ_MAX}
          gesperrt={gesperrt}
          onFertig={(y) => onAendern({ y })}
        />
        <PlanMassFeld
          key={`b-${plan.breite}-${stand}`}
          label="Breite"
          wert={plan.breite}
          min={PLAN_BREITE.min}
          max={PLAN_BREITE.max}
          gesperrt={gesperrt}
          onFertig={(breite) => onAendern({ breite })}
        />
        <Button onClick={onEinpassen} disabled={gesperrt}>
          An Plätze einpassen
        </Button>
      </Stapel>
      <Regler
        key={`h-${plan.helligkeit}-${stand}`}
        label="Helligkeit"
        wert={plan.helligkeit}
        min={20}
        max={100}
        gesperrt={gesperrt}
        onFertig={(helligkeit) => onAendern({ helligkeit })}
      />
      <Regler
        key={`k-${plan.kontrast}-${stand}`}
        label="Kontrast"
        wert={plan.kontrast}
        min={50}
        max={150}
        gesperrt={gesperrt}
        onFertig={(kontrast) => onAendern({ kontrast })}
      />
      <Stapel richtung="zeile" abstand="md" ausrichten="mitte">
        <Switch
          id={umkehrId}
          checked={plan.nacht_umkehren}
          disabled={gesperrt}
          onChange={(nacht_umkehren) => onAendern({ nacht_umkehren })}
        />
        <label htmlFor={umkehrId}>Im Nachtbetrieb umkehren</label>
      </Stapel>
      {/* Eigener Block: der Stapel streckt seine Kinder, der Knopf bleibt so in seiner Größe. */}
      <div>
        <Popconfirm
          title="Plan entfernen?"
          description="Das Bild wird gelöscht; die Plätze bleiben."
          okText="Entfernen"
          cancelText="Abbrechen"
          okButtonProps={{ danger: true }}
          onConfirm={onEntfernen}
        >
          <Button danger disabled={gesperrt}>
            Plan entfernen
          </Button>
        </Popconfirm>
      </div>
    </Stapel>
  );
}

/** Zahl in Pixeln der Fläche, Schritt 10; gesendet beim Verlassen oder mit Enter. */
function PlanMassFeld(props: {
  label: string;
  wert: number;
  min: number;
  max: number;
  gesperrt: boolean;
  onFertig: (v: number) => void;
}) {
  const id = useId();
  const [entwurf, setEntwurf] = useState<number | null>(props.wert);
  const fertig = () => {
    // Eingerastet und begrenzt wie im Server: geschickt wird, was gespeichert wird.
    const ziel =
      entwurf == null ? props.wert : Math.min(Math.max(raste(entwurf), props.min), props.max);
    if (ziel === props.wert) {
      setEntwurf(props.wert);
      return;
    }
    props.onFertig(ziel);
  };
  return (
    <Stapel richtung="zeile" abstand="sm" ausrichten="mitte">
      <Textstufe als="label" htmlFor={id}>
        {props.label}
      </Textstufe>
      <div className={FELD_KLASSE} style={{ width: 'var(--lfh-feld-kurz)', maxWidth: '100%' }}>
        <ZahlFeld
          id={id}
          value={entwurf}
          min={props.min}
          max={props.max}
          ganz
          // Ohne Formular: ein Wert außerhalb bleibt stehen und geht nicht hinaus (LLH-1768).
          nurGueltig
          step={10}
          disabled={props.gesperrt}
          onChange={setEntwurf}
          onBlur={fertig}
          onPressEnter={fertig}
        />
      </div>
    </Stapel>
  );
}

/** Prozent-Regler; gesendet beim Loslassen (Zeiger hoch oder Taste los). */
function Regler(props: {
  label: string;
  wert: number;
  min: number;
  max: number;
  gesperrt: boolean;
  onFertig: (v: number) => void;
}) {
  const [stand, setStand] = useState(props.wert);
  return (
    <div>
      <Textstufe>
        {props.label} <span style={{ fontVariantNumeric: 'tabular-nums' }}>{stand} %</span>
      </Textstufe>
      <Slider
        min={props.min}
        max={props.max}
        step={5}
        value={stand}
        disabled={props.gesperrt}
        ariaLabelForHandle={props.label}
        tooltip={{ formatter: (v) => `${v} %` }}
        onChange={setStand}
        onChangeComplete={(v) => {
          if (v !== props.wert) props.onFertig(v);
        }}
        style={{ maxWidth: 360 }}
      />
    </div>
  );
}
