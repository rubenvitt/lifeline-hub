import { useRef, useState } from 'react';
import { Input } from 'antd';
import { ApiError } from '../../api/client';
import type { AbschnittPatch } from '../../api/einsatzabschnitte';
import { ABSCHNITT_RUFNAME_MAX } from '../../api/eingabegrenzen';
import { leerZuNull } from '../../api/patchTriState';
import type { AbschnittLagezustand, Einsatzabschnitt } from '../../api/types';
import StaerkeAnzeige from '../../anzeige/StaerkeAnzeige';
import { InlineAngabe } from '../../components/InlineAngabe';
import {
  Datenfeld,
  Datenraster,
  Segmentleiste,
  monoStil,
  useRollen,
  type SegmentOption,
} from '../../components/instrument';
import { mitBetriebsart, teileSprechgruppen } from '../../components/kommunikationsmittel';
import { Select } from '../../components/Select';
import { ZeilenFehler } from '../../components/SpeicherHinweis';
import SprechgruppenPicker from '../../components/SprechgruppenPicker';
import { VerbindungenAngabe } from '../../components/VerbindungenFeld';
import StatusTag from '../../components/StatusTag';
import { abschnittLagezustand, rollenFarbe } from '../../theme/statusFarben';
import type { AbschnittStaerken } from './abschnittStaerke';
import { findKurzbezeichnungConflict, kurzbezeichnungVergeben } from './kurzbezeichnung';

/**
 * Speichert EINE Angabe des Abschnitts (LFH-1208): `etikett` nennt sie in der Erfolgsmeldung, der
 * Patch trägt genau einen Schlüssel. Erfüllt erst, wenn der neue Stand im Cache steht; lehnt bei
 * Ablehnung ab, dann zeigt die Zeile den Grund.
 */
export type AbschnittPatchHandler = (etikett: string, patch: AbschnittPatch) => Promise<unknown>;

interface AbschnittDetailProps {
  abschnitt: Einsatzabschnitt;
  /** Alle Abschnitte des Einsatzes, für die Kurzbezeichnungs-Prüfung. */
  abschnitte: Einsatzabschnitt[];
  /** Disponierte Personen für den Abschnittsleiter. */
  personal: readonly { id: number; name: string }[];
  einsatzId: number;
  staerken: AbschnittStaerken;
  darfSchreiben: boolean;
  onPatch: AbschnittPatchHandler;
}

/** Leer ist ein Text, der nach dem Trimmen nichts übrig lässt — wie `leerZuNull` beim Senden. */
const isEmptyText = (w: string) => w.trim() === '';
const isSameText = (a: string, b: string) => a.trim() === b.trim();

function isSameIds(a: readonly number[], b: readonly number[]): boolean {
  if (a.length !== b.length) return false;
  const set = new Set(a);
  return b.every((id) => set.has(id));
}

/**
 * Das Detail eines Einsatzabschnitts zum Lesen UND Bearbeiten (LFH-1208, Spec
 * `einsatzabschnitt-bearbeitung`, Entscheidungen D1–D8 in
 * `openspec/changes/archive/2026-10-11-lfh-1208-abschnitt-bearbeiten-in-ansicht/design.md`):
 * jede Angabe an ihrem Wert, ein Speichern schickt genau ein Feld.
 * Kein Langformular — es überschrieb mit dem Stand vom Öffnen still, was ein anderer Arbeitsplatz
 * inzwischen geändert hatte.
 *
 * Bewusst ein eigenes Bauteil neben `AbschnittDaten` (design.md D1): Vorschau und
 * Funktionsansicht lesen nur und sollen weder Personal noch Mutationen kennen.
 *
 * Funk und Telefon stehen getrennt (LLH-1134): „Rufname“ (Funkrufname der Abschnittsleitung, vor
 * der Kurzbezeichnung im Funkplan) und „Sprechgruppen“ sind Funk; „Telefon und weitere
 * Verbindungen“ ist die typisierte Liste, als Ganzes ersetzt (`verbindungen`). Der Rufname ist
 * vorerst ein Freitext; das Vorschlagsfeld „aus Stammdaten oder frei“ hängt LLH-1144 hier ein.
 *
 * Den Über-Abschnitt ändert keine Zeile, sondern das Umhängen in der Gliederung (Ziehen oder
 * „Verschieben unter …“, LFH-1212); die Gliederung zeigt ihn.
 *
 * Alle Angaben nehmen `InlineAngabe`, auch die optionalen Freitexte: `BemerkungZelle` ist für
 * Listen gebaut und speichert beim Verlassen; hier gilt wie auf den Einsatzdaten EIN Vertrag
 * (Speichern/Abbrechen, Fehler an der Zeile).
 */
export default function AbschnittDetail({
  abschnitt: a,
  abschnitte,
  personal,
  einsatzId,
  staerken,
  darfSchreiben,
  onPatch,
}: AbschnittDetailProps) {
  const textRow = (
    etikett: string,
    feld: 'abschnittsauftrag' | 'rufname' | 'bemerkung',
    mehrzeilig: boolean,
    placeholder?: string,
    maxLength?: number,
  ) => (
    <InlineAngabe<string>
      etikett={etikett}
      wert={a[feld] ?? ''}
      anzeige={
        <span style={feld === 'rufname' ? monoStil(13) : { whiteSpace: 'pre-wrap' }}>
          {a[feld]}
        </span>
      }
      leer={isEmptyText}
      gleich={isSameText}
      darfSchreiben={darfSchreiben}
      mehrzeilig={mehrzeilig}
      onSpeichern={(w) => onPatch(etikett, { [feld]: leerZuNull(w) })}
      eingabe={({ feld: f, value, onChange }) =>
        mehrzeilig ? (
          <Input.TextArea
            {...f}
            autoSize={{ minRows: 2 }}
            value={value}
            onChange={(e) => onChange(e.target.value)}
          />
        ) : (
          <Input
            {...f}
            placeholder={placeholder}
            maxLength={maxLength}
            value={value}
            onChange={(e) => onChange(e.target.value)}
          />
        )
      }
    />
  );

  const { tmo, dmo } = teileSprechgruppen(a.sprechgruppen);
  const sprechgruppenText = [
    tmo.length > 0 ? mitBetriebsart('TMO', tmo.map((s) => s.bezeichnung).join(', ')) : null,
    dmo.length > 0 ? mitBetriebsart('DMO', dmo.map((s) => s.bezeichnung).join(', ')) : null,
  ]
    .filter((t): t is string => t != null)
    .join(' · ');

  return (
    <Datenraster spalten={2} beschriftung="Abschnittsdaten">
      <Datenfeld label="Name">
        <InlineAngabe<string>
          etikett="Name"
          wert={a.name}
          anzeige={a.name}
          leer={isEmptyText}
          gleich={isSameText}
          darfSchreiben={darfSchreiben}
          pflicht
          onSpeichern={(w) => onPatch('Name', { name: w.trim() })}
          eingabe={({ feld, value, onChange }) => (
            <Input {...feld} value={value} onChange={(e) => onChange(e.target.value)} />
          )}
        />
      </Datenfeld>
      <Datenfeld label="Kurzbezeichnung">
        <InlineAngabe<string>
          etikett="Kurzbezeichnung"
          wert={a.kurzbezeichnung ?? ''}
          anzeige={<span style={monoStil(13)}>{a.kurzbezeichnung}</span>}
          leer={isEmptyText}
          gleich={isSameText}
          darfSchreiben={darfSchreiben}
          onSpeichern={(w) => {
            const conflict = findKurzbezeichnungConflict(abschnitte, w, a.id);
            // Dieselbe Ablehnung, die der Index des Servers mit 409 gäbe — nur ohne Anfrage.
            if (conflict)
              return Promise.reject(new ApiError(409, kurzbezeichnungVergeben(conflict)));
            return onPatch('Kurzbezeichnung', { kurzbezeichnung: leerZuNull(w) });
          }}
          eingabe={({ feld, value, onChange }) => (
            <Input
              {...feld}
              maxLength={20}
              placeholder="z. B. EA-N"
              value={value}
              onChange={(e) => onChange(e.target.value)}
            />
          )}
        />
      </Datenfeld>
      {/* Breit: nach Name und Kurzbezeichnung bliebe sonst eine leere Zelle (die Zeile
          „Über-Abschnitt“ entfiel mit dem Umhängen, LFH-1212). */}
      <Datenfeld label="Abschnittsleiter" breit>
        <InlineAngabe<number | null>
          etikett="Abschnittsleiter"
          wert={a.leiter_id ?? null}
          anzeige={a.leiter_name}
          leer={(w) => w == null}
          darfSchreiben={darfSchreiben}
          onSpeichern={(w) => onPatch('Abschnittsleiter', { leiter_id: w })}
          eingabe={({ feld, popup, value, onChange }) => (
            <Select<number>
              {...feld}
              {...popup}
              allowClear
              placeholder="Disponierte Person"
              options={personal.map((p) => ({ value: p.id, label: p.name }))}
              value={value ?? undefined}
              onChange={(w) => onChange(w ?? null)}
            />
          )}
        />
      </Datenfeld>
      <Datenfeld label="Lagezustand" breit>
        <LagezustandSelect
          value={a.lagezustand ?? null}
          darfSchreiben={darfSchreiben}
          onPatch={onPatch}
        />
      </Datenfeld>
      <Datenfeld label="Abschnittsauftrag" breit>
        {textRow('Abschnittsauftrag', 'abschnittsauftrag', true)}
      </Datenfeld>
      <Datenfeld label="Rufname" mono>
        {textRow(
          'Rufname',
          'rufname',
          false,
          'z. B. Rotkreuz Musterstadt 1/10-1',
          ABSCHNITT_RUFNAME_MAX,
        )}
      </Datenfeld>
      <Datenfeld label="Sprechgruppen">
        <InlineAngabe<number[]>
          etikett="Sprechgruppen"
          wert={(a.sprechgruppen ?? []).map((s) => s.id)}
          anzeige={<span style={monoStil(13)}>{sprechgruppenText}</span>}
          leer={(ids) => ids.length === 0}
          gleich={isSameIds}
          darfSchreiben={darfSchreiben}
          onSpeichern={(ids) => onPatch('Sprechgruppen', { sprechgruppe_ids: ids })}
          eingabe={({ feld, popup, value, onChange }) => (
            <SprechgruppenPicker
              einsatzId={einsatzId}
              value={value}
              onChange={onChange}
              auswahl={{ ...feld, ...popup }}
            />
          )}
        />
      </Datenfeld>
      <Datenfeld label="Telefon und weitere Verbindungen" breit>
        <VerbindungenAngabe
          etikett="Telefon und weitere Verbindungen"
          verbindungen={a.verbindungen}
          darfSchreiben={darfSchreiben}
          onSpeichern={(liste) =>
            onPatch('Telefon und weitere Verbindungen', { verbindungen: liste })
          }
        />
      </Datenfeld>
      <Datenfeld label="Bemerkung">{textRow('Bemerkung', 'bemerkung', true)}</Datenfeld>
      <Datenfeld label="Stärke (F/UF/M//Σ)" mono>
        <StaerkeAnzeige wert={staerken.eigene} />
      </Datenfeld>
      <Datenfeld label="Stärke inkl. Unterabschnitte (F/UF/M//Σ)" mono>
        <StaerkeAnzeige wert={staerken.inklUnter} />
      </Datenfeld>
    </Datenraster>
  );
}

/** Wert der Segmentleiste für „nicht beurteilt“ — die Leiste kennt kein `null`. */
const NICHT_BEURTEILT = 'nicht_beurteilt';
type LagezustandValue = AbschnittLagezustand | typeof NICHT_BEURTEILT;
const LAGE_STUFEN = ['planmaessig', 'angespannt', 'kritisch'] as const;

/**
 * Lagezustand mit einem Klick (design.md D4): jede Wahl der Segmentleiste speichert sofort, auch
 * mit den Pfeiltasten — der Wechsel IST die Handlung, und der Server schreibt je Wechsel einen
 * ETB-Eintrag. Bis zur Antwort steht die gewählte Stufe; eine Ablehnung springt auf den Serverstand
 * zurück und nennt den Grund an der Zeile.
 *
 * Immer nur EINE Anfrage unterwegs, sonst könnte eine ältere Antwort eine jüngere Wahl überholen.
 * Eine Wahl währenddessen geht nicht verloren: die Leiste zeigt sie (Fokus und Häkchen stimmen
 * überein), und nach der Antwort geht die jeweils letzte hinaus, wenn sie vom Gesendeten abweicht.
 */
function LagezustandSelect({
  value,
  darfSchreiben,
  onPatch,
}: {
  value: AbschnittLagezustand | null;
  darfSchreiben: boolean;
  onPatch: AbschnittPatchHandler;
}) {
  const { token, rollen } = useRollen();
  const [pending, setPending] = useState<LagezustandValue | null>(null);
  const [error, setError] = useState<unknown>(null);
  const isSendingRef = useRef(false);
  const nextRef = useRef<LagezustandValue | null>(null);

  if (!darfSchreiben) {
    // Fehlende Beurteilung als Wort, nicht als leere Zelle (LFH-608).
    return value ? (
      <StatusTag darstellung={abschnittLagezustand[value]} darstellungsart="rand" />
    ) : (
      <span style={{ color: rollen.gedaempft }}>nicht beurteilt</span>
    );
  }

  const options: SegmentOption<LagezustandValue>[] = [
    { wert: NICHT_BEURTEILT, label: 'nicht beurteilt' },
    ...LAGE_STUFEN.map((l) => ({
      wert: l,
      label: abschnittLagezustand[l].label,
      punkt: rollenFarbe(abschnittLagezustand[l].rolle, token),
    })),
  ];
  const saved: LagezustandValue = value ?? NICHT_BEURTEILT;

  async function select(choice: LagezustandValue) {
    if (isSendingRef.current) {
      nextRef.current = choice;
      setPending(choice);
      return;
    }
    if (choice === saved) return;
    isSendingRef.current = true;
    setPending(choice);
    setError(null);
    let current = choice;
    try {
      for (;;) {
        await onPatch('Lagezustand', {
          lagezustand: current === NICHT_BEURTEILT ? null : current,
        });
        const next = nextRef.current;
        nextRef.current = null;
        if (next == null || next === current) break;
        current = next;
      }
    } catch (e) {
      nextRef.current = null;
      setError(e);
    } finally {
      isSendingRef.current = false;
      setPending(null);
    }
  }

  return (
    // `flex-start`: gestreckt zöge die Leiste (`inline-flex`) ihren Fugengrund über die ganze Zeile.
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'flex-start',
        gap: token.marginXS,
      }}
    >
      <Segmentleiste<LagezustandValue>
        beschriftung="Lagezustand"
        optionen={options}
        wert={pending ?? saved}
        onWechsel={(w) => void select(w)}
      />
      <ZeilenFehler fehler={error} />
    </div>
  );
}
