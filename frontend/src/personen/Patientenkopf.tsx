import { Button, Flex, Form, Input, Typography } from 'antd';
import { useMutation, type UseMutationResult } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import {
  revokeMassnahme,
  revokeVerletzung,
  type MassnahmeEingabe,
  type TransportEingabe,
  type VerbleibEingabe,
  type VerletzungEingabe,
} from '../api/einsatzPerson';
import { useAuthOptional } from '../auth/AuthContext';
import {
  useVorgemerktePersonEintraege,
  type VorgemerkterPersonEintrag,
} from '../offline/useVorgemerkteSchreibaktionen';
import type { PersonDetail } from '../api/types';
import ZeitAnzeige from '../anzeige/ZeitAnzeige';
import { formatVor } from '../anzeige/abstand';
import { ErfassungsFormular } from '../components/Erfassung';
import {
  Datenfeld,
  Datenraster,
  Schnellerfassungszeile,
  monoStil,
  useRollen,
} from '../components/instrument';
import { useViewport } from '../components/useViewport';
import { useOhneVerbindung } from '../offline/verbindung';
import { SpeicherFehler } from '../components/SpeicherHinweis';
import { useMinutenTakt } from '../components/useMinutenTakt';
import { sichtung as SK_DARSTELLUNG } from '../theme/statusFarben';
import { sichtungsKante, sichtungsflaechen } from '../theme/tokens';
import {
  MASSNAHME_WORT,
  SK_WORT,
  VERLETZUNG_ART_WORT,
  VERLETZUNG_SCHWERE_WORT,
  gueltig,
  kurzVerbleib,
  transportText,
} from './personMeta';
import { nummeriere, regionName } from './koerperschema/koerperschemaKern';
import Koerperschema, { KoerperschemaMini } from './koerperschema/Koerperschema';
import PatKennzeichen from './PatKennzeichen';
import { MassnahmePaneel, TransportPaneel } from './PatientenkopfPaneele';
import { istAngetroffen } from './personenBilanz';
import { ZustandSchreiben } from './personenSpalten';
import { SichtungFelder, useSaveSichtung, type SichtungWerte } from './SichtungDialog';
import { useSavePersonEintrag, vormerkungText } from './personEintragSpeichern';
import { useVerbleibFelder } from './VerbleibErfassung';
import { UebergabePaneel } from './UebergabeQuittieren';
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
  /**
   * Transport, Maßnahme und Verletzung (Change `y18v58dt-pat-kern`): am Gerät nur die UHS
   * (`geraetDarf('person-behandlung')`), an der Betreuungsstelle nicht.
   */
  darfBehandeln?: boolean;
  /** Handlungen am Aufenthalt (In UHS aufnehmen, Verlegen, Austragen) — die Seite besitzt sie. */
  aufenthaltAktionen?: ReactNode;
  /** Nach jedem erfolgreichen Schreiben (die Seite invalidiert Person, Liste und ETB). */
  onGeschrieben?: () => void;
}

/**
 * Der Patientenkopf (LLH-1094, Spec `personen-detail`, „Patientenkopf beantwortet die
 * Patientenfragen“): Sichtung mit DTG und „vor n min“, Zustand / Verdacht, Aufenthalt bzw.
 * Verbleib, Transport, Maßnahmen, Verletzungen und letzte Notiz, dazu in der Kopfzeile PAT-Nummer
 * und „kontaminiert“ (voller PAT-Kern, Change `y18v58dt-pat-kern` D14) — alles aus dem einen
 * Detail-GET (`aufenthalt` liefert der Server mit, LLH-1129). Ab `lg` zwei Spalten, Maßnahmen und
 * Verletzungen gekürzt auf drei mit „+ n weitere“, damit der Kopf bei 1280 × 800 ohne Bildlauf
 * steht. Sichten, Verbleib und Notiz gehen hier ohne Dialog: jede Handlung klappt ihr
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
  darfBehandeln = true,
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

  // Je Schreibweg EINE Mutation, hier im Kopf (Wechselsperre). Ohne Netz merkt der Schreibweg vor
  // (LLH-1138, design.md D8): deshalb `networkMode: 'always'`, sonst hielte TanStack die Mutation
  // an (`frontend/src/offline/AGENTS.md`, „Schreiben ohne Netz“). Vorgemerkt gibt es keinen neuen
  // Serverstand; die Quittung steht unten im Kopf.
  const saveSichtung = useSaveSichtung();
  const save = useSavePersonEintrag();
  const nachSpeichern = (ergebnis: { zustand: 'gesendet' | 'vorgemerkt' }) => {
    if (ergebnis.zustand === 'gesendet') onGeschrieben?.();
  };
  const sichtungMutation = useMutation({
    networkMode: 'always',
    mutationFn: (v: SichtungWerte) => saveSichtung(einsatzId, person, v),
    onSuccess: nachSpeichern,
  });
  const verbleibMutation = useMutation({
    networkMode: 'always',
    mutationFn: (eingabe: VerbleibEingabe) => save(einsatzId, person, 'verbleib', eingabe),
    onSuccess: nachSpeichern,
  });
  const transportMutation = useMutation({
    networkMode: 'always',
    mutationFn: (eingabe: TransportEingabe) => save(einsatzId, person, 'transport', eingabe),
    onSuccess: nachSpeichern,
  });
  const massnahmeMutation = useMutation({
    networkMode: 'always',
    mutationFn: (eingabe: MassnahmeEingabe) => save(einsatzId, person, 'massnahme', eingabe),
    onSuccess: nachSpeichern,
  });
  // Aufheben bleibt online: die Route kennt weder `client_id` noch Erfassungszeit, ein Replay
  // endete in 409, und das Aufheben stünde zur Zeit der Übertragung im Verlauf.
  const massnahmeAufhebenMutation = useMutation({
    mutationFn: (massnahmeId: number) => revokeMassnahme(einsatzId, person.id, massnahmeId),
    onSuccess: () => onGeschrieben?.(),
  });
  const verletzungMutation = useMutation({
    networkMode: 'always',
    mutationFn: (eingabe: VerletzungEingabe) => save(einsatzId, person, 'verletzung', eingabe),
    onSuccess: nachSpeichern,
  });
  const verletzungAufhebenMutation = useMutation({
    mutationFn: (verletzungId: number) => revokeVerletzung(einsatzId, person.id, verletzungId),
    onSuccess: () => onGeschrieben?.(),
  });
  const isSpeichernd =
    sichtungMutation.isPending ||
    verbleibMutation.isPending ||
    transportMutation.isPending ||
    massnahmeMutation.isPending ||
    massnahmeAufhebenMutation.isPending ||
    verletzungMutation.isPending ||
    verletzungAufhebenMutation.isPending;
  const behandelbar = bedienbar && darfBehandeln && angetroffen;

  const letzteSichtung = person.sichtungen?.[0];
  const letzteNotiz = person.notizen?.[0];
  const letzterVerbleib = person.verbleib?.[0];
  const letzterTransport = person.transporte?.[0];
  const transport = transportText(person);
  const massnahmen = gueltig(person.massnahmen ?? []);
  const verletzungen = nummeriere(person.verletzungen ?? []).filter(
    (n) => n.verletzung.aufgehoben_at == null,
  );
  // Die Liste im Kopf zeigt die jüngsten zuerst, wie die Maßnahmen (Durchführung absteigend);
  // die Nummer bleibt die feste der Figur.
  const juengsteVerletzungen = [...verletzungen].sort(
    (a, b) =>
      b.verletzung.zeitpunkt_at.localeCompare(a.verletzung.zeitpunkt_at) ||
      b.verletzung.id - a.verletzung.id,
  );
  const viewport = useViewport();
  const zweiSpalten = viewport.abBreite('lg');
  const mitFigur = viewport.abBreite('md') && verletzungen.length > 0;
  // Ohne Verbindung heißt: Browser offline ODER der Server antwortet nicht (WLAN ohne Server,
  // `frontend/src/offline/AGENTS.md`); `navigator.onLine` allein böte das Aufheben dort an.
  const aufhebenGesperrt = useOhneVerbindung() ? AUFHEBEN_OHNE_NETZ : undefined;
  // Vorgemerkt an dieser Person, getrennt vom Serverstand (`frontend/src/offline/AGENTS.md`, „Was
  // vorgemerkt ist, kennt der Server noch nicht“); die Notizen quittiert die Notizzeile.
  const benutzerId = useAuthOptional()?.benutzer?.id;
  const vorgemerkt = useVorgemerktePersonEintraege(benutzerId, einsatzId).filter(
    (v) => v.aktion.person_id === person.id,
  );
  const vorgemerkteNotizen = vorgemerkt.filter((v) => v.aktion.art === 'notiz');

  return (
    <section
      data-lfh="patientenkopf"
      aria-label="Patientenkopf"
      style={{ display: 'flex', flexDirection: 'column', gap: token.marginSM }}
    >
      <PatKennzeichen
        einsatzId={einsatzId}
        person={person}
        bedienbar={bedienbar}
        onGeschrieben={onGeschrieben}
      />

      {/* Zwei Spalten ab lg (design.md D14): links die Lage des Patienten, rechts was an ihm
          getan und gefunden ist. Darunter gestapelt, die Lage zuerst (Spec, 390 × 844). */}
      <div
        data-lfh="patientenkopf-raster"
        style={{
          display: 'grid',
          gridTemplateColumns: zweiSpalten ? 'repeat(2, minmax(0, 1fr))' : 'minmax(0, 1fr)',
          gap: token.marginSM,
        }}
      >
        <Datenraster spalten={1} beschriftung="Patientenangaben">
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
                  {/* Ein Eigentransport endet mit der quittierten Übergabe (LLH-1332). */}
                  {bedienbar && angetroffen && person.versorgung === 'unterwegs' && (
                    <Button
                      type="primary"
                      aria-expanded={offen === 'uebergabe'}
                      disabled={isSpeichernd}
                      onClick={() => toggle('uebergabe')}
                    >
                      Übergabe quittieren
                    </Button>
                  )}
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

          <Datenfeld label="Transport">
            <span data-lfh="transport">
              {transport ? (
                <>
                  {transport}
                  {person.transport_at && (
                    <Typography.Text type="secondary">
                      {' '}
                      · <ZeitAnzeige wert={person.transport_at} format="dtg" />
                      {letzterTransport?.bestaetigt_name &&
                        ` · bestätigt: ${letzterTransport.bestaetigt_name}`}
                    </Typography.Text>
                  )}
                </>
              ) : (
                <Typography.Text type="secondary">kein Transport</Typography.Text>
              )}
            </span>
            {behandelbar && (
              <PaneelKnopf
                offen={offen === 'transport'}
                gesperrt={isSpeichernd}
                onClick={() => toggle('transport')}
              >
                Transport festlegen
              </PaneelKnopf>
            )}
          </Datenfeld>
        </Datenraster>

        <Datenraster spalten={1} beschriftung="Behandlung">
          <Datenfeld label="Maßnahmen">
            <div data-lfh="massnahmen">
              <GekuerzteListe
                beschriftung="Maßnahmen"
                eintraege={massnahmen.map((m) => ({
                  key: m.id,
                  inhalt: (
                    <>
                      {MASSNAHME_WORT[m.art]} ·{' '}
                      <ZeitAnzeige wert={m.zeitpunkt_at} format="uhrzeit" />
                    </>
                  ),
                }))}
              />
            </div>
            {behandelbar && (
              <PaneelKnopf
                offen={offen === 'massnahme'}
                gesperrt={isSpeichernd}
                onClick={() => toggle('massnahme')}
              >
                Maßnahme erfassen
              </PaneelKnopf>
            )}
          </Datenfeld>
          <Datenfeld label="Verletzungen">
            <div
              data-lfh="verletzungen"
              style={{ display: 'flex', gap: token.marginSM, alignItems: 'flex-start' }}
            >
              {/* Ab md die kleine Figur (design.md D13); den Text trägt die Liste daneben. */}
              {mitFigur && (
                <KoerperschemaMini
                  verletzungen={person.verletzungen ?? []}
                  geschlecht={person.geschlecht}
                />
              )}
              <div style={{ minWidth: 0 }}>
                <GekuerzteListe
                  beschriftung="Verletzungen"
                  eintraege={juengsteVerletzungen.map(({ nummer, verletzung: v }) => ({
                    key: v.id,
                    inhalt: (
                      <>
                        <span style={monoStil(13)}>{nummer}</span> {regionName(v.ansicht, v.region)}{' '}
                        · {VERLETZUNG_ART_WORT[v.art]}
                        {v.schwere && ` · ${VERLETZUNG_SCHWERE_WORT[v.schwere]}`} ·{' '}
                        <ZeitAnzeige wert={v.zeitpunkt_at} format="uhrzeit" />
                      </>
                    ),
                  }))}
                />
              </div>
            </div>
            {behandelbar && (
              <PaneelKnopf
                offen={offen === 'verletzung'}
                gesperrt={isSpeichernd}
                onClick={() => toggle('verletzung')}
              >
                Verletzung markieren
              </PaneelKnopf>
            )}
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
      </div>

      {modus === 'bedienen' && (
        <VorgemerktBlock eintraege={vorgemerkt.filter((v) => v.aktion.art !== 'notiz')} />
      )}
      {offen === 'sichtung' && (
        <SichtungPaneel
          einsatzId={einsatzId}
          mutation={sichtungMutation}
          onSchliessen={close('sichtung')}
        />
      )}
      {offen === 'uebergabe' && (
        <UebergabePaneel
          person={person}
          mutation={verbleibMutation}
          onSchliessen={close('uebergabe')}
        />
      )}
      {offen === 'verbleib' && (
        <VerbleibPaneel
          einsatzId={einsatzId}
          mutation={verbleibMutation}
          onSchliessen={close('verbleib')}
        />
      )}
      {offen === 'transport' && (
        <TransportPaneel
          einsatzId={einsatzId}
          person={person}
          mutation={transportMutation}
          onSchliessen={close('transport')}
        />
      )}
      {offen === 'verletzung' && (
        <section aria-label="Verletzung markieren" data-lfh="verletzung-paneel">
          <Flex vertical gap={token.marginSM}>
            <Koerperschema
              einsatzId={einsatzId}
              verletzungen={person.verletzungen ?? []}
              geschlecht={person.geschlecht}
              modus="markieren"
              // Markieren merkt ohne Netz vor (D8); Aufheben bleibt online.
              aufhebenGesperrt={aufhebenGesperrt}
              markierung={verletzungMutation}
              aufhebung={verletzungAufhebenMutation}
            />
            <div>
              <Button disabled={isSpeichernd} onClick={close('verletzung')}>
                Schließen
              </Button>
            </div>
          </Flex>
        </section>
      )}
      {offen === 'massnahme' && (
        <MassnahmePaneel
          einsatzId={einsatzId}
          person={person}
          mutation={massnahmeMutation}
          aufheben={massnahmeAufhebenMutation}
          aufhebenGesperrt={aufhebenGesperrt}
          onSchliessen={close('massnahme')}
        />
      )}
      {bedienbar && (
        <NotizZeile
          einsatzId={einsatzId}
          person={person}
          vorgemerkt={vorgemerkteNotizen}
          onGeschrieben={onGeschrieben}
        />
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

/** Grund, warum ohne Netz nicht aufgehoben wird (LFH-966: wenige Wörter). */
export const AUFHEBEN_OHNE_NETZ = 'Aufheben ohne Netz nicht möglich';

/**
 * Quittung „Offline vorgemerkt“ im Kopf (LLH-1138, Spec `personen-detail`, „Nachsichtung am
 * Tablet ohne Netz“): was an dieser Person in der Warteschlange liegt, mit Erfassungszeit. Es
 * verschwindet, sobald der Abgleich den Eintrag gesendet und das Detail neu geladen hat; eine
 * Ablehnung steht dann im Wiederherstellungsbereich.
 */
function VorgemerktBlock({ eintraege }: { eintraege: readonly VorgemerkterPersonEintrag[] }) {
  const { token, rollen } = useRollen();
  if (eintraege.length === 0) return null;
  return (
    <section
      aria-label="Offline vorgemerkt"
      data-lfh="vorgemerkt"
      style={{
        borderInlineStart: `3px solid ${token.colorWarning}`,
        paddingInlineStart: token.paddingSM,
        color: rollen.text2,
      }}
    >
      <Typography.Text strong>Offline vorgemerkt</Typography.Text>
      <VorgemerktListe eintraege={eintraege} />
    </section>
  );
}

function VorgemerktListe({ eintraege }: { eintraege: readonly VorgemerkterPersonEintrag[] }) {
  return (
    <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
      {eintraege.map((v) => (
        <li key={v.id ?? v.aktion.daten.client_id}>
          {vormerkungText(v.aktion)}
          {v.aktion.daten.zeitpunkt_at && (
            <>
              {' · '}
              <ZeitAnzeige wert={v.aktion.daten.zeitpunkt_at} format="uhrzeit" />
            </>
          )}
        </li>
      ))}
    </ul>
  );
}

/** Wie viele Einträge einer Liste der Kopf zeigt, bevor er kürzt (design.md D14). */
export const KOPF_LISTE_MAX = 3;

/**
 * Eine Liste im Kopf, gekürzt auf {@link KOPF_LISTE_MAX} Einträge; die übrigen nennt eine Zahl
 * („+ 2 weitere“), damit der Kopf bei 1280 × 800 ohne Bildlauf steht. Leer steht „keine“.
 */
function GekuerzteListe({
  beschriftung,
  eintraege,
}: {
  beschriftung: string;
  eintraege: { key: number; inhalt: ReactNode }[];
}) {
  const { token } = useRollen();
  if (eintraege.length === 0) return <Typography.Text type="secondary">keine</Typography.Text>;
  const rest = eintraege.length - KOPF_LISTE_MAX;
  return (
    <>
      <ul
        aria-label={beschriftung}
        style={{
          listStyle: 'none',
          margin: 0,
          padding: 0,
          display: 'flex',
          flexDirection: 'column',
          gap: token.marginXXS,
        }}
      >
        {eintraege.slice(0, KOPF_LISTE_MAX).map((e) => (
          <li key={e.key}>{e.inhalt}</li>
        ))}
      </ul>
      {rest > 0 && <Typography.Text type="secondary">{`+ ${rest} weitere`}</Typography.Text>}
    </>
  );
}

type Paneel = 'sichtung' | 'verbleib' | 'uebergabe' | 'transport' | 'massnahme' | 'verletzung';

/** Auslöser eines Paneels im Datenfeld; solange ein Paneel speichert, wechselt keiner. */
function PaneelKnopf({
  offen,
  gesperrt,
  onClick,
  children,
}: {
  offen: boolean;
  gesperrt: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <div>
      <Button aria-expanded={offen} disabled={gesperrt} onClick={onClick}>
        {children}
      </Button>
    </div>
  );
}

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
  person,
  vorgemerkt,
  onGeschrieben,
}: {
  einsatzId: number;
  person: PersonDetail;
  /** Ohne Netz vorgemerkte Notizen dieser Person (LLH-1138): die Zeile quittiert sie. */
  vorgemerkt: readonly VorgemerkterPersonEintrag[];
  onGeschrieben?: () => void;
}) {
  const { token, rollen } = useRollen();
  const [form] = Form.useForm<{ text: string }>();
  const save = useSavePersonEintrag();
  const personId = person.id;
  const mutation = useMutation({
    // Merkt ohne Netz vor (design.md D8); der Text liegt dann in der Warteschlange.
    networkMode: 'always',
    mutationFn: (v: { text: string }) => save(einsatzId, person, 'notiz', { text: v.text }),
    onSuccess: (ergebnis) => {
      form.resetFields();
      if (ergebnis.zustand === 'gesendet') onGeschrieben?.();
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
      {vorgemerkt.length > 0 && (
        <div data-lfh="notiz-vorgemerkt" style={{ marginTop: token.marginXS, color: rollen.text2 }}>
          <Typography.Text strong>Offline vorgemerkt</Typography.Text>
          <VorgemerktListe eintraege={vorgemerkt} />
        </div>
      )}
      {mutation.error != null && (
        <div style={{ marginTop: token.marginXS }}>
          <SpeicherFehler fehler={mutation.error} titel="Notiz nicht angelegt" />
        </div>
      )}
    </Form>
  );
}
