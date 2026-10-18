import { Button, Flex, Form, Input, Typography } from 'antd';
import { useMutation, type UseMutationResult } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { erfasseVerbleib, legeNotizAn, type VerbleibEingabe } from '../api/einsatzPerson';
import type { PersonDetail } from '../api/types';
import ZeitAnzeige from '../anzeige/ZeitAnzeige';
import { formatVor } from '../anzeige/abstand';
import { ErfassungsFormular } from '../components/Erfassung';
import {
  Datenfeld,
  Datenraster,
  Schnellerfassungszeile,
  useRollen,
} from '../components/instrument';
import { SpeicherFehler } from '../components/SpeicherHinweis';
import { useMinutenTakt } from '../components/useMinutenTakt';
import { sichtung as SK_DARSTELLUNG } from '../theme/statusFarben';
import { sichtungsKante, sichtungsflaechen } from '../theme/tokens';
import { SK_WORT, kurzVerbleib } from './personMeta';
import { istAngetroffen } from './personenBilanz';
import { ZustandSchreiben } from './personenSpalten';
import { SichtungFelder, saveSichtung, type SichtungWerte } from './SichtungDialog';
import { useVerbleibFelder } from './VerbleibErfassung';
import type { VerbleibFormWerte } from './verbleibErfassungKern';

export interface PatientenkopfProps {
  einsatzId: number;
  person: PersonDetail;
  /** `lesen`: nur Anzeige (Schnellansicht im Grundriss, Sprungpalette, LLH-1137). */
  modus?: 'bedienen' | 'lesen';
  /** Schreibrecht im Einsatz; an einer stornierten Person ohnehin aus. */
  darfSchreiben?: boolean;
  /** Darf hier gesichtet werden? An der Betreuungsstelle nicht (LFH-1041). */
  darfSichten?: boolean;
  /** Handlungen am Aufenthalt (In UHS aufnehmen, Verlegen, Austragen) — die Seite besitzt sie. */
  aufenthaltAktionen?: ReactNode;
  /** Nach jedem erfolgreichen Schreiben (die Seite invalidiert Person, Liste und ETB). */
  onGeschrieben?: () => void;
}

/**
 * Der Patientenkopf (LLH-1094, Spec `personen-detail`, „Patientenkopf beantwortet die
 * Patientenfragen“): Sichtung mit DTG und „vor n min“, Zustand / Verdacht, Aufenthalt bzw.
 * Verbleib, letzte Notiz — alles aus dem einen Detail-GET (`aufenthalt` liefert der Server mit,
 * LLH-1129). Sichten, Verbleib und Notiz gehen hier ohne Dialog: jede Handlung klappt ihr
 * eigenes Paneel auf, eine Ablehnung bleibt in ihm stehen. Solange Sichtung oder Verbleib
 * speichert, sperrt der Kopf den Wechsel (beide Auslöser `disabled`): hinge das Paneel mitten im
 * Speichern aus, hätte eine Ablehnung keinen Ort, und ein später Erfolg schlösse das neue Paneel.
 * Deshalb liegen beide Mutationen hier, und jedes Paneel schließt nur sich selbst.
 * Herleitung: `openspec/changes/archive/2026-10-18-y18v58dt-patientenkopf-bezuege/design.md`.
 */
export default function Patientenkopf({
  einsatzId,
  person,
  modus = 'bedienen',
  darfSchreiben = false,
  darfSichten = true,
  aufenthaltAktionen,
  onGeschrieben,
}: PatientenkopfProps) {
  const { token } = useRollen();
  const jetzt = useMinutenTakt();
  const bedienbar = modus === 'bedienen' && darfSchreiben && !person.storniert_at;
  const angetroffen = istAngetroffen(person);
  const [offen, setOffen] = useState<Paneel | null>(null);
  const toggle = (paneel: Paneel) => setOffen((o) => (o === paneel ? null : paneel));
  const close = (paneel: Paneel) => () => setOffen((o) => (o === paneel ? null : o));

  const sichtungMutation = useMutation({
    mutationFn: (v: SichtungWerte) => saveSichtung(einsatzId, person.id, v),
    onSuccess: () => onGeschrieben?.(),
  });
  const verbleibMutation = useMutation({
    mutationFn: (eingabe: VerbleibEingabe) => erfasseVerbleib(einsatzId, person.id, eingabe),
    onSuccess: () => onGeschrieben?.(),
  });
  const isSpeichernd = sichtungMutation.isPending || verbleibMutation.isPending;

  const letzteSichtung = person.sichtungen?.[0];
  const letzteNotiz = person.notizen?.[0];
  const letzterVerbleib = person.verbleib?.[0];

  return (
    <section
      data-lfh="patientenkopf"
      aria-label="Patientenkopf"
      style={{ display: 'flex', flexDirection: 'column', gap: token.marginSM }}
    >
      <Datenraster spalten={2} beschriftung="Patientenangaben">
        <Datenfeld label="Sichtung">
          <Flex vertical gap={token.marginXXS}>
            <SichtungsAnzeige
              person={person}
              bedienbar={bedienbar && darfSichten && angetroffen}
              offen={offen === 'sichtung'}
              gesperrt={isSpeichernd}
              onUmschalten={() => toggle('sichtung')}
            />
            {person.aktuelle_sichtung_at && (
              <Typography.Text type="secondary" data-lfh="sichtung-zeit">
                gesichtet <ZeitAnzeige wert={person.aktuelle_sichtung_at} format="dtg" /> ·{' '}
                {formatVor(person.aktuelle_sichtung_at, jetzt)}
                {letzteSichtung?.bestaetigt_name &&
                  ` · bestätigt: ${letzteSichtung.bestaetigt_name}`}
              </Typography.Text>
            )}
          </Flex>
        </Datenfeld>

        <Datenfeld label="Zustand / Verdacht">
          {bedienbar && angetroffen ? (
            <ZustandSchreiben p={person} einsatzId={einsatzId} />
          ) : (
            <span data-lfh="zustand">{person.zustand || '—'}</span>
          )}
        </Datenfeld>

        <Datenfeld label={person.aufenthalt || !letzterVerbleib ? 'Aufenthalt' : 'Verbleib'}>
          <Flex vertical gap={token.marginXS}>
            <span data-lfh="aufenthalt">
              {person.aufenthalt ? (
                <>
                  {person.aufenthalt.uhs_bezeichnung} ·{' '}
                  {person.aufenthalt.platz_bezeichnung ?? 'Wartebereich'}
                  {person.aufenthalt.seit && (
                    <>
                      {' '}
                      · seit <ZeitAnzeige wert={person.aufenthalt.seit} format="dtg" />
                    </>
                  )}
                </>
              ) : letzterVerbleib ? (
                <>
                  {kurzVerbleib(letzterVerbleib)} ·{' '}
                  <ZeitAnzeige wert={letzterVerbleib.zeitpunkt_at} format="dtg" />
                </>
              ) : (
                <Typography.Text type="secondary">ohne Aufenthalt</Typography.Text>
              )}
            </span>
            {modus === 'bedienen' && (
              <Flex gap={token.marginSM} wrap>
                {aufenthaltAktionen}
                {bedienbar && angetroffen && (
                  <Button
                    aria-expanded={offen === 'verbleib'}
                    disabled={isSpeichernd}
                    onClick={() => toggle('verbleib')}
                  >
                    Verbleib erfassen
                  </Button>
                )}
              </Flex>
            )}
          </Flex>
        </Datenfeld>

        <Datenfeld label="Letzte Notiz">
          {letzteNotiz ? (
            <span data-lfh="letzte-notiz">
              {letzteNotiz.text}{' '}
              <Typography.Text type="secondary">
                · <ZeitAnzeige wert={letzteNotiz.erfasst_at} format="dtg" />
              </Typography.Text>
            </span>
          ) : (
            <Typography.Text type="secondary">keine</Typography.Text>
          )}
        </Datenfeld>
      </Datenraster>

      {offen === 'sichtung' && (
        <SichtungPaneel
          einsatzId={einsatzId}
          mutation={sichtungMutation}
          onSchliessen={close('sichtung')}
        />
      )}
      {offen === 'verbleib' && (
        <VerbleibPaneel
          einsatzId={einsatzId}
          mutation={verbleibMutation}
          onSchliessen={close('verbleib')}
        />
      )}
      {bedienbar && (
        <NotizZeile einsatzId={einsatzId} personId={person.id} onGeschrieben={onGeschrieben} />
      )}
    </section>
  );
}

/**
 * Die aktuelle Sichtung als Fläche aus der Flächenpalette (dieselben Töne wie die Wahl,
 * LLH-1083). Bedienbar ist sie der Auslöser der Nachsichtung, sonst nur Anzeige.
 */
function SichtungsAnzeige({
  person,
  bedienbar,
  offen,
  gesperrt,
  onUmschalten,
}: {
  person: PersonDetail;
  bedienbar: boolean;
  offen: boolean;
  /** Ein Paneel des Kopfs speichert gerade: kein Wechsel. */
  gesperrt: boolean;
  onUmschalten: () => void;
}) {
  const { token, rollen } = useRollen();
  const k = person.aktuelle_sichtung;
  const farbe = k ? SK_DARSTELLUNG[k].farbe : null;
  const voll = farbe ? sichtungsflaechen[farbe] : null;
  const text = k ? `${SK_DARSTELLUNG[k].label} · ${SK_WORT[k]}` : 'ungesichtet';
  const stil = {
    display: 'inline-flex',
    alignItems: 'center',
    minHeight: Math.max(48, token.controlHeight),
    padding: `0 ${token.paddingSM}px`,
    fontSize: token.fontSizeLG,
    fontWeight: 700,
    borderRadius: 0,
    background: voll ? voll.flaeche : rollen.flaeche,
    color: voll ? voll.schrift : rollen.text,
    border: `1px solid ${sichtungsKante(rollen)}`,
  } as const;
  if (!bedienbar) {
    return (
      <span data-lfh="sichtung" data-sichtung={k ?? 'ohne'} style={stil}>
        {text}
      </span>
    );
  }
  return (
    <button
      type="button"
      className="lfh-sichtungswahl__flaeche"
      data-lfh="sichtung"
      data-sichtung={k ?? 'ohne'}
      aria-expanded={offen}
      aria-label={k ? `Nachsichten, aktuell ${text}` : 'Sichten, bisher ungesichtet'}
      disabled={gesperrt}
      onClick={onUmschalten}
      style={{
        ...stil,
        cursor: gesperrt ? 'not-allowed' : 'pointer',
        font: 'inherit',
        fontWeight: 700,
      }}
    >
      {text}
    </button>
  );
}

type Paneel = 'sichtung' | 'verbleib';

/** Nachsichtung in der Ansicht: dieselben Felder wie der Dialog; die Mutation hält der Kopf. */
function SichtungPaneel({
  einsatzId,
  mutation,
  onSchliessen,
}: {
  einsatzId: number;
  mutation: UseMutationResult<unknown, Error, SichtungWerte>;
  onSchliessen: () => void;
}) {
  const [form] = Form.useForm<SichtungWerte>();
  return (
    <section aria-label="Sichtung erfassen" data-lfh="sichtung-paneel">
      <ErfassungsFormular<SichtungWerte>
        form={form}
        erfassenText="Übernehmen"
        laeuft={mutation.isPending}
        speicherung={mutation}
        speicherFehlerTitel="Sichtung nicht gespeichert"
        onErfassen={(v) => mutation.mutateAsync(v)}
        onFertig={onSchliessen}
        onAbbrechen={onSchliessen}
      >
        <SichtungFelder einsatzId={einsatzId} />
      </ErfassungsFormular>
    </section>
  );
}

/** Verbleib in der Ansicht: dieselben Felder wie der Dialog (`useVerbleibFelder`). */
function VerbleibPaneel({
  einsatzId,
  mutation,
  onSchliessen,
}: {
  einsatzId: number;
  mutation: UseMutationResult<unknown, Error, VerbleibEingabe>;
  onSchliessen: () => void;
}) {
  const [form] = Form.useForm<VerbleibFormWerte>();
  const { elemente, body } = useVerbleibFelder(einsatzId, form);
  return (
    <section aria-label="Verbleib erfassen" data-lfh="verbleib-paneel">
      <ErfassungsFormular<VerbleibFormWerte>
        form={form}
        erfassenText="Verbleib erfassen"
        laeuft={mutation.isPending}
        speicherung={mutation}
        speicherFehlerTitel="Verbleib nicht erfasst"
        onErfassen={(werte) => mutation.mutateAsync(body(werte))}
        onFertig={onSchliessen}
        onAbbrechen={onSchliessen}
      >
        {elemente}
      </ErfassungsFormular>
    </section>
  );
}

/**
 * Eine Verlaufsnotiz als Eingabezeile. Die Folge („nicht änderbar, nicht im ETB“) steht als
 * Hinweis an der Zeile, nicht als Überschrift (LFH-1078: Text erklärt nie die Bedienung).
 */
function NotizZeile({
  einsatzId,
  personId,
  onGeschrieben,
}: {
  einsatzId: number;
  personId: number;
  onGeschrieben?: () => void;
}) {
  const { token } = useRollen();
  const [form] = Form.useForm<{ text: string }>();
  const mutation = useMutation({
    mutationFn: (v: { text: string }) => legeNotizAn(einsatzId, personId, v.text),
    onSuccess: () => {
      form.resetFields();
      onGeschrieben?.();
    },
  });
  return (
    <Form form={form} onFinish={(v) => mutation.mutate(v)} data-lfh="notiz-zeile">
      <Schnellerfassungszeile
        praefix="Notiz"
        hinweiszeile={<span id={`notiz-folge-${personId}`}>nicht änderbar · nicht im ETB</span>}
      >
        <Flex gap={token.marginXS} style={{ width: '100%' }}>
          <Form.Item
            name="text"
            noStyle
            rules={[{ required: true, whitespace: true, message: 'Bitte Text eingeben' }]}
          >
            <Input
              aria-label="Verlaufsnotiz"
              aria-describedby={`notiz-folge-${personId}`}
              placeholder="Verlaufsnotiz"
              disabled={mutation.isPending}
            />
          </Form.Item>
          <Button type="primary" htmlType="submit" loading={mutation.isPending}>
            Notiz anlegen
          </Button>
        </Flex>
      </Schnellerfassungszeile>
      {mutation.error != null && (
        <div style={{ marginTop: token.marginXS }}>
          <SpeicherFehler fehler={mutation.error} titel="Notiz nicht angelegt" />
        </div>
      )}
    </Form>
  );
}
