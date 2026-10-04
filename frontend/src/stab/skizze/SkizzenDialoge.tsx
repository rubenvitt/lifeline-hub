/**
 * Dialoge der Fernmeldeskizze (LFH-893, 6.3, 7.2, 7.3): Anlegen (externe Stelle, Komponente,
 * Bereich), „Verbinden mit …“ (Suche über Schienen und Stellen), Artwahl einer Verbindung (Liste
 * am Fükw, Radial am Tablet) und die Rückfrage vor Unumkehrbarem. Jede Maske wird nur montiert,
 * solange sie offen ist; gespeichert wird über die Handlungen der Fläche, ein Scheitern steht IN
 * der Maske.
 */
import { Button, Flex, Form, Input, Modal, Typography } from 'antd';
import { useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import type { Komponentenart, Verbindungsart } from '../../api/fernmeldeskizzeVertrag';
import { ErfassungsModal } from '../../components/Erfassung';
import { useRollen } from '../../components/instrument';
import { Select } from '../../components/Select';
import { SpeicherFehler } from '../../components/SpeicherHinweis';
import type { Fernmeldenetz } from '../fernmeldeskizze';
import { EXTERNE_STELLENARTEN, STELLENART_LABEL } from '../kommunikationsplan';
import type { ExterneStellenart } from '../skizzenAktionen';
import {
  KOMPONENTENARTEN,
  VERBINDUNGSARTEN,
  komponentenartWort,
  verbindungsartWort,
} from '../skizzenZeichen';
import { verbindenZiele, type VerbindenZiel } from './bedienung';

// ── Anlegen ──────────────────────────────────────────────────────────────────────────────────

export type AnlegenArt = 'extern' | 'komponente' | 'bereich';

/** Vorgabe der Bezeichnung eines neuen Bereichs (Spec „Bereich anlegen“). */
export const BEREICH_VORGABE = 'Rückwärtiger Bereich';

interface AnlegenWerte {
  stellenart?: ExterneStellenart;
  komponentenart?: Komponentenart;
  bezeichnung?: string;
}

const TITEL: Record<AnlegenArt, string> = {
  extern: 'Externe Stelle anlegen',
  komponente: 'Komponente anlegen',
  bereich: 'Bereich anlegen',
};

export function AnlegenDialog({
  art,
  onExtern,
  onKomponente,
  onBereich,
  onSchliessen,
}: {
  art: AnlegenArt;
  onExtern: (stellenart: ExterneStellenart, bezeichnung: string) => Promise<unknown>;
  onKomponente: (art: Komponentenart, bezeichnung: string | null) => Promise<unknown>;
  onBereich: (bezeichnung: string) => Promise<unknown>;
  onSchliessen: () => void;
}) {
  const [form] = Form.useForm<AnlegenWerte>();
  const [fehler, setFehler] = useState<unknown>(null);
  const [laeuft, setLaeuft] = useState(false);
  const initial: AnlegenWerte =
    art === 'extern'
      ? { stellenart: 'leitstelle' }
      : art === 'komponente'
        ? { komponentenart: 'repeater' }
        : { bezeichnung: BEREICH_VORGABE };
  return (
    <ErfassungsModal<AnlegenWerte>
      offen
      titel={TITEL[art]}
      form={form}
      initialValues={initial}
      erfassenText="Anlegen"
      laeuft={laeuft}
      onErfassen={async (w) => {
        setFehler(null);
        setLaeuft(true);
        try {
          const bezeichnung = w.bezeichnung?.trim() ?? '';
          if (art === 'extern') await onExtern(w.stellenart!, bezeichnung);
          else if (art === 'komponente') await onKomponente(w.komponentenart!, bezeichnung || null);
          else await onBereich(bezeichnung || BEREICH_VORGABE);
        } catch (e) {
          setFehler(e);
          throw e;
        } finally {
          setLaeuft(false);
        }
      }}
      onFertig={onSchliessen}
      onAbbrechen={onSchliessen}
    >
      {art === 'extern' ? (
        <Form.Item label="Art" name="stellenart" rules={[{ required: true }]}>
          <Select
            options={EXTERNE_STELLENARTEN.map((a) => ({ value: a, label: STELLENART_LABEL[a] }))}
          />
        </Form.Item>
      ) : null}
      {art === 'komponente' ? (
        <Form.Item label="Art" name="komponentenart" rules={[{ required: true }]}>
          <Select
            options={KOMPONENTENARTEN.map((a) => ({ value: a, label: komponentenartWort(a) }))}
          />
        </Form.Item>
      ) : null}
      <Form.Item
        label="Bezeichnung"
        name="bezeichnung"
        rules={[
          ...(art === 'extern'
            ? [{ required: true, whitespace: true, message: 'Bezeichnung fehlt' }]
            : []),
          { max: 100, message: 'Höchstens 100 Zeichen' },
        ]}
        extra={art === 'extern' ? 'Die Stelle steht danach auch im Kommunikationsplan.' : undefined}
      >
        <Input />
      </Form.Item>
      <SpeicherFehler fehler={fehler} />
    </ErfassungsModal>
  );
}

// ── Artwahl ──────────────────────────────────────────────────────────────────────────────────

/** Halbmesser des Radialmenüs je Knopfbreite: neun Knöpfe ohne Überlappung. */
function radialMasse(knopf: { breite: number; hoehe: number }) {
  const n = VERBINDUNGSARTEN.length;
  const halbmesser = Math.ceil((knopf.breite + 8) / (2 * Math.sin(Math.PI / n)));
  return {
    halbmesser,
    breite: 2 * halbmesser + knopf.breite,
    hoehe: 2 * halbmesser + knopf.hoehe,
  };
}

/** Lage eines Knopfes im Radial: im Uhrzeigersinn, der erste oben. */
export function radialPlatz(i: number, n: number, halbmesser: number): { x: number; y: number } {
  const winkel = -Math.PI / 2 + (2 * Math.PI * i) / n;
  return {
    x: Math.round(halbmesser * Math.cos(winkel)),
    y: Math.round(halbmesser * Math.sin(winkel)),
  };
}

/**
 * Die Art einer neuen Verbindung als Menü (D6): am Tablet radial um den Finger, am Fükw als
 * Liste. Medium und Status bekommen Vorgaben und stehen danach im Eigenschaftspaneel.
 */
export function ArtAuswahl({
  radial,
  onWahl,
  onAbbrechen,
}: {
  radial: boolean;
  onWahl: (art: Verbindungsart) => void;
  onAbbrechen: () => void;
}) {
  const { token } = useRollen();
  const taste = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      onAbbrechen();
    }
  };
  if (!radial) {
    return (
      <div role="menu" aria-label="Art der Verbindung" data-lfh="skizze-artwahl" onKeyDown={taste}>
        <Flex vertical gap={token.marginXXS}>
          {VERBINDUNGSARTEN.map((a, i) => (
            <Button
              key={a}
              role="menuitem"
              autoFocus={i === 0}
              style={{ justifyContent: 'flex-start' }}
              onClick={() => onWahl(a)}
            >
              {verbindungsartWort(a)}
            </Button>
          ))}
        </Flex>
      </div>
    );
  }
  const knopf = { breite: 7 * token.fontSize + 2 * token.paddingSM, hoehe: token.controlHeight };
  const m = radialMasse(knopf);
  return (
    <div
      role="menu"
      aria-label="Art der Verbindung"
      data-lfh="skizze-artwahl"
      data-radial="true"
      onKeyDown={taste}
      style={{ position: 'relative', width: m.breite, height: m.hoehe, marginInline: 'auto' }}
    >
      {VERBINDUNGSARTEN.map((a, i) => {
        const p = radialPlatz(i, VERBINDUNGSARTEN.length, m.halbmesser);
        return (
          <Button
            key={a}
            role="menuitem"
            autoFocus={i === 0}
            onClick={() => onWahl(a)}
            style={{
              position: 'absolute',
              left: m.breite / 2 + p.x - knopf.breite / 2,
              top: m.hoehe / 2 + p.y - knopf.hoehe / 2,
              width: knopf.breite,
              paddingInline: token.paddingXS,
            }}
          >
            {verbindungsartWort(a)}
          </Button>
        );
      })}
      <Button
        onClick={onAbbrechen}
        style={{
          position: 'absolute',
          left: m.breite / 2 - knopf.breite / 2,
          top: m.hoehe / 2 - knopf.hoehe / 2,
          width: knopf.breite,
        }}
      >
        Abbrechen
      </Button>
    </div>
  );
}

/** Die Artwahl nach einem Zug vom Anschluss auf eine Stelle. */
export function ArtDialog({
  von,
  nach,
  radial,
  onWahl,
  onSchliessen,
}: {
  von: string;
  nach: string;
  radial: boolean;
  onWahl: (art: Verbindungsart) => Promise<unknown>;
  onSchliessen: () => void;
}) {
  const [fehler, setFehler] = useState<unknown>(null);
  return (
    <Modal
      open
      title={`Verbindung ${von} – ${nach}`}
      footer={null}
      onCancel={onSchliessen}
      destroyOnHidden
      width={radial ? 'auto' : undefined}
    >
      <ArtAuswahl
        radial={radial}
        onAbbrechen={onSchliessen}
        onWahl={(art) => {
          setFehler(null);
          onWahl(art).then(onSchliessen, setFehler);
        }}
      />
      <SpeicherFehler fehler={fehler} />
    </Modal>
  );
}

// ── „Verbinden mit …“ ───────────────────────────────────────────────────────────────────────

/**
 * Suche über Schienen (zuordnen) und Stellen (Punkt-zu-Punkt), ganz ohne Zeiger bedienbar
 * (Spec „Zuordnen mit der Tastatur“): Tippen filtert, Pfeile wählen, Enter bestätigt. Eine Stelle
 * führt zur Artwahl.
 */
export function VerbindenDialog({
  netz,
  quelle,
  radial,
  onZuordnen,
  onVerbinden,
  onSchliessen,
}: {
  netz: Fernmeldenetz;
  quelle: string;
  radial: boolean;
  onZuordnen: (sprechgruppeId: number) => Promise<unknown>;
  onVerbinden: (nach: string, art: Verbindungsart) => Promise<unknown>;
  onSchliessen: () => void;
}) {
  const { token, rollen } = useRollen();
  const listeId = useId();
  const [suche, setSuche] = useState('');
  const [aktiv, setAktiv] = useState(0);
  const [ziel, setZiel] = useState<VerbindenZiel | null>(null);
  const [fehler, setFehler] = useState<unknown>(null);
  const [laeuft, setLaeuft] = useState(false);
  const liste = useRef<HTMLUListElement | null>(null);
  const ziele = useMemo(() => verbindenZiele(netz, quelle, suche), [netz, quelle, suche]);
  const index = Math.min(aktiv, Math.max(0, ziele.length - 1));
  const name = netz.stellen.find((s) => s.key === quelle)?.bezeichnung ?? quelle;

  const ausfuehren = (p: Promise<unknown>) => {
    setFehler(null);
    setLaeuft(true);
    p.then(onSchliessen, setFehler).finally(() => setLaeuft(false));
  };
  const waehle = (z: VerbindenZiel | undefined) => {
    if (!z || laeuft) return;
    if (z.art === 'schiene' && z.sprechgruppeId != null) ausfuehren(onZuordnen(z.sprechgruppeId));
    else setZiel(z);
  };
  const taste = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const n = ziele.length;
      if (n === 0) return;
      const neu = (index + (e.key === 'ArrowDown' ? 1 : -1) + n) % n;
      setAktiv(neu);
      liste.current?.children[neu]?.scrollIntoView?.({ block: 'nearest' });
    } else if (e.key === 'Enter') {
      e.preventDefault();
      waehle(ziele[index]);
    }
  };
  const optionId = (i: number) => `${listeId}-${i}`;

  return (
    <Modal
      open
      title={ziel ? `Verbindung ${name} – ${ziel.label}` : `Verbinden mit … (${name})`}
      footer={null}
      onCancel={onSchliessen}
      destroyOnHidden
      width={ziel && radial ? 'auto' : undefined}
    >
      <div data-lfh="skizze-verbinden-dialog">
        {ziel ? (
          <ArtAuswahl
            radial={radial}
            onAbbrechen={() => setZiel(null)}
            onWahl={(art) => ausfuehren(onVerbinden(ziel.key, art))}
          />
        ) : (
          <>
            <Input
              autoFocus
              role="combobox"
              aria-label="Sprechgruppe oder Stelle suchen"
              aria-expanded
              aria-controls={listeId}
              aria-autocomplete="list"
              aria-activedescendant={ziele.length > 0 ? optionId(index) : undefined}
              placeholder="Sprechgruppe oder Stelle suchen"
              value={suche}
              onChange={(e) => {
                setSuche(e.target.value);
                setAktiv(0);
              }}
              onKeyDown={taste}
            />
            <ul
              ref={liste}
              id={listeId}
              role="listbox"
              aria-label="Ziele"
              style={{
                listStyle: 'none',
                margin: 0,
                marginBlockStart: token.marginSM,
                padding: 0,
                maxHeight: '50vh',
                overflowY: 'auto',
              }}
            >
              {ziele.map((z, i) => (
                <li
                  key={z.key}
                  id={optionId(i)}
                  role="option"
                  aria-selected={i === index}
                  data-lfh="skizze-verbinden-ziel"
                  onClick={() => waehle(z)}
                  onMouseMove={() => setAktiv(i)}
                  style={{
                    minHeight: token.controlHeight,
                    display: 'flex',
                    alignItems: 'center',
                    gap: token.marginSM,
                    paddingInline: token.paddingSM,
                    cursor: 'pointer',
                    borderInlineStart: `3px solid ${i === index ? rollen.bedien : 'transparent'}`,
                    fontWeight: i === index ? 600 : undefined,
                  }}
                >
                  <span style={{ color: rollen.gedaempft, minWidth: '5em' }}>
                    {z.art === 'schiene' ? 'Zuordnen' : 'Verbindung'}
                  </span>
                  <span
                    style={z.art === 'schiene' ? { fontFamily: token.fontFamilyCode } : undefined}
                  >
                    {z.label}
                  </span>
                  {z.zusatz ? <span style={{ color: rollen.gedaempft }}>{z.zusatz}</span> : null}
                </li>
              ))}
            </ul>
            {ziele.length === 0 ? (
              <Typography.Paragraph style={{ color: rollen.gedaempft, margin: 0 }}>
                Kein Ziel gefunden.
              </Typography.Paragraph>
            ) : null}
          </>
        )}
        <SpeicherFehler fehler={fehler} />
      </div>
    </Modal>
  );
}

// ── Rückfrage ────────────────────────────────────────────────────────────────────────────────

/** Rückfrage vor einer Handlung, die nicht nur zurückgenommen wird (Leitlinie Datensatz-Aktionen). */
export function Rueckfrage({
  titel,
  text,
  okText,
  onOk,
  onSchliessen,
}: {
  titel: string;
  text: string;
  okText: string;
  onOk: () => Promise<unknown>;
  onSchliessen: () => void;
}) {
  const [fehler, setFehler] = useState<unknown>(null);
  const [laeuft, setLaeuft] = useState(false);
  return (
    <Modal
      open
      title={titel}
      okText={okText}
      cancelText="Abbrechen"
      okButtonProps={{ danger: true, loading: laeuft }}
      onOk={() => {
        setFehler(null);
        setLaeuft(true);
        onOk()
          .then(onSchliessen, setFehler)
          .finally(() => setLaeuft(false));
      }}
      onCancel={onSchliessen}
      destroyOnHidden
    >
      <Typography.Paragraph>{text}</Typography.Paragraph>
      <SpeicherFehler fehler={fehler} />
    </Modal>
  );
}
