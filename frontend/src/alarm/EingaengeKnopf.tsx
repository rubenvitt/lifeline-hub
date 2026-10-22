import { Button, Drawer, Popover, theme } from 'antd';
import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { markiereBenachrichtigungenGelesen } from '../api/benachrichtigungen';
import { einsatzKeys } from '../api/queryKeys';
import type { BenachrichtigungAnzeige } from '../api/types';
import ZeitAnzeige from '../anzeige/ZeitAnzeige';
import { Augenbraue } from '../components/instrument';
import { WortPlatz } from '../components/Kopfleiste';
import { useViewport } from '../components/useViewport';
import { IconPosteingang } from '../icons';
import { rahmenFarben, schrift } from '../theme/tokens';
import { BENACHRICHTIGUNG_ARTEN } from './benachrichtigungKatalog';
import { quittiereNachNutzer } from './useBenachrichtigungen';
import { useBenachrichtigungVerlauf, useVerlaufAbgleich } from './useBenachrichtigungVerlauf';

/**
 * window-Ereignis, mit dem das Eingangsband den Verlauf öffnet (`detail.einsatzId`). Ein Ereignis
 * statt eines geteilten Zustands: Band und Knopf hängen an verschiedenen Stellen des Rahmens.
 */
export const EINGAENGE_OEFFNEN_EVENT = 'lfh:eingaenge-oeffnen';

/** Bittet den Knopf „Eingänge“ dieses Einsatzes, seinen Verlauf zu öffnen. */
export function oeffneEingaenge(einsatzId: number): void {
  window.dispatchEvent(new CustomEvent(EINGAENGE_OEFFNEN_EVENT, { detail: { einsatzId } }));
}

/** Die sichtbare Zahl: leer bei 0, ab 100 „99+“. Rein und exportiert. */
export function zahlText(zahl: number): string {
  if (zahl <= 0) return '';
  return zahl > 99 ? '99+' : String(zahl);
}

/** Der zugängliche Name: Zahl und Wort, nie die Zahl allein (Vorleser, WCAG 1.1.1). */
export function knopfName(zahl: number): string {
  return zahl > 0 ? `Eingänge, ${zahl} ungelesen` : 'Eingänge, keine ungelesen';
}

/** Ungelesen: unquittiert und nicht still. Ein offener Alarm steht unter „Neu“, zählt aber nicht. */
function istNeu(a: BenachrichtigungAnzeige): boolean {
  return !a.quittiert_at && a.stufe !== 'still';
}

function Eintrag({ a, beiSprung }: { a: BenachrichtigungAnzeige; beiSprung: () => void }) {
  const { token } = theme.useToken();
  const art = BENACHRICHTIGUNG_ARTEN[a.art]?.name;
  return (
    <li style={{ listStyle: 'none' }}>
      <Link
        to={a.pfad}
        onClick={() => {
          if (!a.quittiert_at) quittiereNachNutzer(a.id);
          beiSprung();
        }}
        style={{
          display: 'grid',
          gridTemplateColumns: 'auto 1fr auto',
          alignItems: 'baseline',
          gap: token.paddingXS,
          minHeight: token.controlHeight,
          padding: `${token.paddingXXS}px ${token.paddingXS}px`,
          color: token.colorText,
          // Ein Alarm trägt sein Wort, nie nur die Farbe; Rot bleibt dem Alarm vorbehalten.
          borderInlineStart: `3px solid ${a.stufe === 'alarm' ? token.colorError : 'transparent'}`,
        }}
      >
        <span
          style={{
            fontFamily: schrift.zahl,
            fontVariantNumeric: 'tabular-nums',
            color: token.colorTextSecondary,
          }}
        >
          <ZeitAnzeige wert={a.erstellt_at} format="kurz" />
        </span>
        <span style={{ minWidth: 0 }}>
          <span style={{ display: 'block', fontWeight: istNeu(a) ? 600 : 400 }}>
            {a.stufe === 'alarm' ? 'Alarm: ' : null}
            {a.titel}
          </span>
          <span
            style={{
              display: 'block',
              fontSize: token.fontSizeSM,
              color: token.colorTextSecondary,
            }}
          >
            {[art !== a.titel ? art : undefined, a.detail].filter(Boolean).join(' · ')}
          </span>
        </span>
        <span aria-hidden="true">↗</span>
      </Link>
    </li>
  );
}

function Gruppe({
  name,
  eintraege,
  beiSprung,
}: {
  name: string;
  eintraege: BenachrichtigungAnzeige[];
  beiSprung: () => void;
}) {
  if (eintraege.length === 0) return null;
  return (
    <>
      <Augenbraue als="h3" style={{ marginBlockStart: 8 }}>
        {name}
      </Augenbraue>
      <ul aria-label={name} style={{ margin: 0, padding: 0 }}>
        {eintraege.map((a) => (
          <Eintrag key={a.id} a={a} beiSprung={beiSprung} />
        ))}
      </ul>
    </>
  );
}

/**
 * Der Verlauf (design.md D6): Kopf mit „Alle gelesen“, Gruppen „Neu“ und „Früher“. Lesbar auch
 * ohne Netz, solange der Verlauf im Speicher liegt; „Alle gelesen“ braucht den Server.
 */
function VerlaufPaneel({ einsatzId, schliessen }: { einsatzId: number; schliessen: () => void }) {
  const { token } = theme.useToken();
  const qc = useQueryClient();
  const { data, isPending, isError } = useBenachrichtigungVerlauf(einsatzId);
  const [laeuft, setLaeuft] = useState(false);
  const [fehler, setFehler] = useState(false);
  const eintraege = data?.eintraege ?? [];
  const neu = eintraege.filter(istNeu);
  const frueher = eintraege.filter((a) => !istNeu(a));
  const ungelesen = data?.ungelesen ?? 0;

  const alleGelesen = () => {
    const bis = Math.max(...eintraege.map((a) => a.id));
    if (!Number.isFinite(bis)) return;
    setLaeuft(true);
    setFehler(false);
    markiereBenachrichtigungenGelesen(einsatzId, bis)
      .then(
        () => qc.invalidateQueries({ queryKey: einsatzKeys.benachrichtigungVerlauf(einsatzId) }),
        () => setFehler(true),
      )
      .finally(() => setLaeuft(false));
  };

  return (
    <section
      aria-label="Eingänge"
      style={{ width: 'min(420px, calc(100vw - 32px))', maxHeight: '70dvh', overflowY: 'auto' }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: token.paddingXS,
        }}
      >
        <Augenbraue als="h2">Eingänge</Augenbraue>
        <Button onClick={alleGelesen} disabled={ungelesen === 0 || laeuft} loading={laeuft}>
          Alle gelesen
        </Button>
      </div>
      {fehler && (
        <div role="alert" style={{ color: token.colorWarningText, marginBlockStart: 4 }}>
          Nicht gespeichert, bitte noch einmal.
        </div>
      )}
      {isPending ? (
        <p style={{ color: token.colorTextSecondary }}>Wird geladen …</p>
      ) : isError && !data ? (
        <p style={{ color: token.colorTextSecondary }}>Verlauf nicht geladen.</p>
      ) : eintraege.length === 0 ? (
        <p style={{ color: token.colorTextSecondary }}>Keine Eingänge.</p>
      ) : (
        <>
          <Gruppe name="Neu" eintraege={neu} beiSprung={schliessen} />
          <Gruppe name="Früher" eintraege={frueher} beiSprung={schliessen} />
        </>
      )}
    </section>
  );
}

/**
 * Knopf „Eingänge“ in der Kommandoleiste (LLH-1143, design.md D6): das Zeichen des Posteingangs
 * (die Glocke trägt schon Ton und Erinnerungen) und die Zahl der ungelesenen Eingänge, Mono. Die
 * Zahl hält die Breite von „99+“ ({@link WortPlatz}): eine eintreffende Meldung darf den Kopf nicht
 * umbrechen lassen (LLH-1158). Farben aus `rahmenFarben` (Rahmen dauerdunkel, ≥ 7 : 1, LFH-434),
 * Trefffläche aus der Dichte-Staffel. Ab `md` Klappfläche, darunter ein Blatt von unten.
 *
 * Gleicht den Verlauf für den ganzen Rahmen ab ({@link useVerlaufAbgleich}); Tab-Titel und
 * App-Badge lesen denselben Key.
 */
export default function EingaengeKnopf({ einsatzId }: { einsatzId: number }) {
  const { token } = theme.useToken();
  const { istSchmal } = useViewport();
  const [offen, setOffen] = useState(false);
  useVerlaufAbgleich(einsatzId);
  const ungelesen = useBenachrichtigungVerlauf(einsatzId).data?.ungelesen ?? 0;

  useEffect(() => {
    const oeffnen = (ev: Event) => {
      if ((ev as CustomEvent<{ einsatzId?: number }>).detail?.einsatzId === einsatzId) {
        setOffen(true);
      }
    };
    window.addEventListener(EINGAENGE_OEFFNEN_EVENT, oeffnen);
    return () => window.removeEventListener(EINGAENGE_OEFFNEN_EVENT, oeffnen);
  }, [einsatzId]);

  const schliessen = () => setOffen(false);
  const paneel = <VerlaufPaneel einsatzId={einsatzId} schliessen={schliessen} />;
  const knopf = (
    <Button
      type="text"
      data-lfh="kopf-eingaenge"
      aria-label={knopfName(ungelesen)}
      aria-expanded={offen}
      aria-haspopup="dialog"
      icon={<IconPosteingang />}
      onClick={istSchmal ? () => setOffen(true) : undefined}
      style={{
        color: ungelesen > 0 ? rahmenFarben.text : rahmenFarben.gedaempft,
        minWidth: token.controlHeight,
        fontSize: 12,
        flexShrink: 0,
      }}
    >
      <WortPlatz
        platz="99+"
        style={{ fontFamily: schrift.zahl, fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}
      >
        {zahlText(ungelesen)}
      </WortPlatz>
    </Button>
  );

  if (istSchmal) {
    return (
      <>
        {knopf}
        <Drawer
          open={offen}
          onClose={schliessen}
          placement="bottom"
          size="auto"
          title={null}
          closable
          styles={{ body: { paddingBlock: token.paddingSM } }}
        >
          {paneel}
        </Drawer>
      </>
    );
  }
  return (
    <Popover
      trigger="click"
      placement="bottomRight"
      open={offen}
      onOpenChange={setOffen}
      content={paneel}
      arrow={false}
    >
      {knopf}
    </Popover>
  );
}
