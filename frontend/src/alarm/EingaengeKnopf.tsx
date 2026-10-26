import { Button, Drawer, Popover, theme } from 'antd';
import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { einsatzKeys } from '../api/queryKeys';
import type { BenachrichtigungAnzeige, BenachrichtigungVerlauf } from '../api/types';
import ZeitAnzeige from '../anzeige/ZeitAnzeige';
import { useAuthOptional } from '../auth/AuthContext';
import Datenstand from '../components/Datenstand';
import { Augenbraue } from '../components/instrument';
import { IconPosteingang } from '../icons';
import { saveEingaengeGelesenOfflineCapable } from '../offline/schreiben';
import { useVorgemerkteSchreibaktionen } from '../offline/useVorgemerkteSchreibaktionen';
import { useOhneVerbindung } from '../offline/verbindung';
import { rahmenFarben, schrift } from '../theme/tokens';
import { BENACHRICHTIGUNG_ARTEN } from './benachrichtigungKatalog';
import { EINGAENGE_OEFFNEN_EVENT, eingaengeName, useKopfBuendelt } from './eingaenge';
import EingaengeZahl from './EingaengeZahl';
import { quittiereNachNutzer } from './useBenachrichtigungen';
import {
  markVerlaufGelesen,
  useBenachrichtigungVerlauf,
  useVerlaufAbgleich,
} from './useBenachrichtigungVerlauf';

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
          <ZeitAnzeige wert={a.erstellt_at} rolle="kurz" />
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
 * Der Verlauf (design.md D6): Kopf mit „Alle gelesen“, Gruppen „Neu“ und „Früher“. Ohne Netz
 * (LLH-1422) lesbar aus dem Speicher, auch nach einem Neuladen (`LAGEBILD_OFFLINE`), mit „Stand …
 * · offline“; „Alle gelesen“ wird dann vorgemerkt (`frontend/src/offline/AGENTS.md`, „Schreiben
 * ohne Netz“), die Zahl fällt sofort.
 */
function VerlaufPaneel({ einsatzId, schliessen }: { einsatzId: number; schliessen: () => void }) {
  const { token } = theme.useToken();
  const qc = useQueryClient();
  const { data, dataUpdatedAt, isPending, isError } = useBenachrichtigungVerlauf(einsatzId);
  const benutzerId = useAuthOptional()?.benutzer?.id;
  const ohneVerbindung = useOhneVerbindung();
  const vorgemerkt =
    useVorgemerkteSchreibaktionen(benutzerId, einsatzId, 'eingaenge_gelesen').length > 0;
  const [laeuft, setLaeuft] = useState(false);
  const [fehler, setFehler] = useState(false);
  const eintraege = data?.eintraege ?? [];
  const neu = eintraege.filter(istNeu);
  const frueher = eintraege.filter((a) => !istNeu(a));
  const ungelesen = data?.ungelesen ?? 0;

  const alleGelesen = () => {
    const bis = Math.max(...eintraege.map((a) => a.id));
    if (!Number.isFinite(bis) || benutzerId == null) return;
    const key = einsatzKeys.benachrichtigungVerlauf(einsatzId);
    setLaeuft(true);
    setFehler(false);
    saveEingaengeGelesenOfflineCapable(benutzerId, einsatzId, bis)
      .then(
        (zustand) => {
          if (zustand === 'gesendet') return qc.invalidateQueries({ queryKey: key });
          qc.setQueryData<BenachrichtigungVerlauf>(key, (alt) =>
            alt ? markVerlaufGelesen(alt, bis) : alt,
          );
        },
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
        {ohneVerbindung && <Datenstand dataUpdatedAt={dataUpdatedAt} />}
        <Button onClick={alleGelesen} disabled={ungelesen === 0 || laeuft} loading={laeuft}>
          Alle gelesen
        </Button>
      </div>
      {vorgemerkt && (
        <div
          data-lfh="eingaenge-vorgemerkt"
          style={{ fontSize: token.fontSizeSM, color: token.colorTextSecondary }}
        >
          Offline vorgemerkt
        </div>
      )}
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
 * (die Glocke trägt schon Ton und Erinnerungen) mit der Zahl der ungelesenen Eingänge als
 * Plakette ({@link EingaengeZahl}, nimmt keine Breite). Ab `md` öffnet er eine Klappfläche.
 *
 * Bündelt der Kopf die Alarmzentrale ({@link useKopfBuendelt}: Handschirm, Tablet mit Finger),
 * steht kein eigener Knopf: Zahl und Eintrag „Eingänge“ trägt dann die gebündelte Alarmzentrale,
 * und der Verlauf öffnet sich hier als Blatt von unten ({@link EINGAENGE_OEFFNEN_EVENT}). Ein
 * eigener Knopf brach den Kopf bei 820 px in zwei Zeilen.
 *
 * Gleicht den Verlauf für den ganzen Rahmen ab ({@link useVerlaufAbgleich}); Tab-Titel und
 * App-Badge lesen denselben Key.
 */
export default function EingaengeKnopf({ einsatzId }: { einsatzId: number }) {
  const { token } = theme.useToken();
  const buendelt = useKopfBuendelt();
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

  if (buendelt) {
    return (
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
      <Button
        type="text"
        data-lfh="kopf-eingaenge"
        aria-label={eingaengeName(ungelesen)}
        aria-expanded={offen}
        aria-haspopup="dialog"
        icon={
          <EingaengeZahl zahl={ungelesen}>
            <IconPosteingang />
          </EingaengeZahl>
        }
        style={{
          color: ungelesen > 0 ? rahmenFarben.text : rahmenFarben.gedaempft,
          minWidth: token.controlHeight,
          flexShrink: 0,
        }}
      />
    </Popover>
  );
}
