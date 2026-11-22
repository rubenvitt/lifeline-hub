import { Button, Drawer, Popover, Switch, theme } from 'antd';
import { createContext, useContext, useEffect, useState } from 'react';
import { Link } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { einsatzKeys } from '../api/queryKeys';
import type { BenachrichtigungAnzeige, BenachrichtigungVerlauf } from '../api/types';
import ZeitAnzeige from '../anzeige/ZeitAnzeige';
import { useAuthOptional } from '../auth/AuthContext';
import Datenstand from '../components/Datenstand';
import { Augenbraue, MetaZeile, Stapel } from '../components/instrument';
import { useRollen } from '../components/instrument/rollenwerte';
import { useViewport } from '../components/useViewport';
import { useAlarmZone } from './alarmZoneSpeicher';
import { IconKreuz, IconPosteingang } from '../icons';
import { saveEingaengeGelesenOfflineCapable } from '../offline/schreiben';
import { useVorgemerkteSchreibaktionen } from '../offline/useVorgemerkteSchreibaktionen';
import { useOhneVerbindung } from '../offline/verbindung';
import { BENACHRICHTIGUNGEN_PFAD } from '../routing/deeplinks';
import { rahmenFarben, schrift } from '../theme/tokens';
import { verlaufInhalt, type VerlaufInhalt } from './benachrichtigungGedaechtnis';
import { BENACHRICHTIGUNG_ARTEN } from './benachrichtigungKatalog';
import { ladeErinnerungTitel } from './erinnerungInhalt';
import { ladeMeldungInhalt } from './meldungInhalt';
import { EINGAENGE_OEFFNEN_EVENT, eingaengeName, useKopfBuendelt } from './eingaenge';
import { EINGANG_ARTEN, setzeStumm, useStummeArten } from './eingaengeStumm';
import EingaengeZahl from './EingaengeZahl';
import { pushKanal } from './pushKanal';
import { useQuittiereNachNutzer } from './useBenachrichtigungen';
import {
  markVerlaufGelesen,
  useBenachrichtigungVerlauf,
  useVerlaufAbgleich,
} from './useBenachrichtigungVerlauf';

/** Ungelesen: unquittiert und nicht still. Ein offener Alarm steht unter „Neu“, zählt aber nicht. */
function istNeu(a: BenachrichtigungAnzeige): boolean {
  return !a.quittiert_at && a.stufe !== 'still';
}

/**
 * Was der Eintrag unter „Neu“ zeigt (LLH-1737, Spec `benachrichtigungen`, „Der Verlauf nennt den
 * Inhalt einer Meldung“): bei einer Meldung Absender und Wortlautanfang (`meldungInhalt.ts`), bei
 * einer fälligen Erinnerung ihr Titel (`erinnerungInhalt.ts`), wie Alarmzone und Eingangsband.
 * Nur für Neues: „Früher“ kann 200 Einträge lang sein, und dort ist alles schon gelesen.
 */
/**
 * Zählt das Öffnen von Klappfläche bzw. Blatt: bei jedem Öffnen holt der Verlauf fehlenden Inhalt
 * neu. Ein Zähler, kein Wahrheitswert: antd zeichnet die geschlossene Fläche nicht neu.
 */
const VerlaufOffen = createContext(0);

function useVerlaufInhalt(a: BenachrichtigungAnzeige): VerlaufInhalt {
  const qc = useQueryClient();
  const neu = istNeu(a);
  const oeffnung = useContext(VerlaufOffen);
  const [inhalt, setInhalt] = useState(() => verlaufInhalt.get(a.id) ?? null);
  useEffect(() => {
    if (!neu || verlaufInhalt.has(a.id)) return;
    let aktiv = true;
    void Promise.all([ladeMeldungInhalt(a), ladeErinnerungTitel(a, qc)]).then(([m, titel]) => {
      const wert: VerlaufInhalt | null = m
        ? { titel: m.titel ?? a.titel, detail: m.anfang ?? a.detail }
        : titel
          ? { titel: `${a.titel}: ${titel}`, detail: a.detail }
          : null;
      // Nur ein Inhalt wird gemerkt: lief die Frist ab oder fehlte das Netz, holt das nächste
      // Öffnen neu (Review vor dem PR). Eine Art ohne Inhalt fragt ohnehin nicht nach.
      if (wert) verlaufInhalt.set(a.id, wert);
      if (aktiv) setInhalt(wert);
    });
    return () => {
      aktiv = false;
    };
  }, [a, neu, oeffnung, qc]);
  return inhalt ?? { titel: a.titel, detail: a.detail };
}

function Eintrag({
  a,
  quittiere,
  beiSprung,
}: {
  a: BenachrichtigungAnzeige;
  quittiere: (id: number) => void;
  beiSprung: () => void;
}) {
  const { token } = theme.useToken();
  const art = BENACHRICHTIGUNG_ARTEN[a.art]?.name;
  const { titel, detail } = useVerlaufInhalt(a);
  return (
    <li style={{ listStyle: 'none' }}>
      <Link
        to={a.pfad}
        onClick={() => {
          if (!a.quittiert_at) quittiere(a.id);
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
        <div style={{ minWidth: 0 }}>
          <span style={{ display: 'block', fontWeight: istNeu(a) ? 600 : 400 }}>
            {a.stufe === 'alarm' ? 'Alarm: ' : null}
            {titel}
          </span>
          <MetaZeile>
            <MetaZeile.Teil>{art !== a.titel ? art : null}</MetaZeile.Teil>
            <MetaZeile.Teil>{detail}</MetaZeile.Teil>
          </MetaZeile>
        </div>
        <span aria-hidden="true">↗</span>
      </Link>
    </li>
  );
}

function Gruppe({
  name,
  eintraege,
  quittiere,
  beiSprung,
}: {
  name: string;
  eintraege: BenachrichtigungAnzeige[];
  quittiere: (id: number) => void;
  beiSprung: () => void;
}) {
  const { token } = theme.useToken();
  if (eintraege.length === 0) return null;
  return (
    <>
      <Augenbraue als="h3" style={{ marginBlockStart: token.marginSM }}>
        {name}
      </Augenbraue>
      <ul aria-label={name} style={{ margin: 0, padding: 0 }}>
        {eintraege.map((a) => (
          <Eintrag key={a.id} a={a} quittiere={quittiere} beiSprung={beiSprung} />
        ))}
      </ul>
    </>
  );
}

/**
 * „Stumm auf diesem Gerät“ (LLH-1421, design.md D6): je Eingangsart ein Schalter. Wirkt nur auf
 * Ton, Eingangsband und OS-Meldung dieses Geräts (`eingaengeStumm.ts`); Alarme stehen nicht da.
 * Ist hier Push an, meldet das Umschalten die Liste auch dem Server (LLH-1482, `pushKanal.ts`).
 */
function StummListe() {
  const { token } = theme.useToken();
  const stumm = useStummeArten();
  const benutzerId = useAuthOptional()?.benutzer?.id;
  const umschalten = (art: (typeof EINGANG_ARTEN)[number], an: boolean) => {
    setzeStumm(art, an);
    if (benutzerId != null) void pushKanal().abgleichen(benutzerId);
  };
  return (
    <section aria-label="Stumm auf diesem Gerät" style={{ marginBlockStart: token.marginXS }}>
      <Augenbraue als="h3">Stumm auf diesem Gerät</Augenbraue>
      <ul style={{ margin: 0, padding: 0 }}>
        {EINGANG_ARTEN.map((art) => {
          const name = BENACHRICHTIGUNG_ARTEN[art].name;
          const feldId = `eingang-stumm-${art}`;
          return (
            <li
              key={art}
              style={{
                listStyle: 'none',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: token.paddingXS,
                minHeight: token.controlHeight,
                paddingInline: token.paddingXS,
              }}
            >
              <label htmlFor={feldId} style={{ minWidth: 0 }}>
                {name}
              </label>
              <Switch
                id={feldId}
                aria-label={`Stumm: ${name}`}
                checked={stumm.includes(art)}
                onChange={(an) => umschalten(art, an)}
              />
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/**
 * Der Verlauf (design.md D6): Kopf mit „Stumm“ und „Alle gelesen“, Gruppen „Neu“ und „Früher“.
 * Ohne Netz (LLH-1422) lesbar aus dem Speicher, auch nach einem Neuladen (`LAGEBILD_OFFLINE`), mit
 * „Stand … · offline“; „Alle gelesen“ wird dann vorgemerkt (`frontend/src/offline/AGENTS.md`,
 * „Schreiben ohne Netz“), die Zahl fällt sofort. „Stumm“ klappt die Schalter für dieses Gerät auf
 * ({@link StummListe}, LLH-1421).
 */
function VerlaufPaneel({ einsatzId, schliessen }: { einsatzId: number; schliessen: () => void }) {
  const { token } = theme.useToken();
  const qc = useQueryClient();
  const { data, dataUpdatedAt, isPending, isError } = useBenachrichtigungVerlauf(einsatzId);
  const benutzerId = useAuthOptional()?.benutzer?.id;
  const ohneVerbindung = useOhneVerbindung();
  const vorgemerkt =
    useVorgemerkteSchreibaktionen(benutzerId, einsatzId, 'eingaenge_gelesen').length > 0;
  // Der Sprung aus einem Eintrag merkt ohne Netz vor (LLH-1477): die Zahl fällt sofort; das
  // Paneel schließt danach, ein „Offline vorgemerkt“ hätte hier keinen Ort.
  const quittiere = useQuittiereNachNutzer(einsatzId);
  const [laeuft, setLaeuft] = useState(false);
  const [fehler, setFehler] = useState(false);
  const [stummOffen, setStummOffen] = useState(false);
  const stummZahl = useStummeArten().length;
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
      <Stapel richtung="zeile" ausrichten="mitte" verteilen="between" abstand="xs">
        <Augenbraue als="h2">Eingänge</Augenbraue>
        {ohneVerbindung && <Datenstand dataUpdatedAt={dataUpdatedAt} />}
        <Stapel als="span" richtung="zeile" abstand="xs">
          <Button aria-expanded={stummOffen} onClick={() => setStummOffen((o) => !o)}>
            {stummZahl > 0 ? `Stumm · ${stummZahl}` : 'Stumm'}
          </Button>
          <Button onClick={alleGelesen} disabled={ungelesen === 0 || laeuft} loading={laeuft}>
            Alle gelesen
          </Button>
        </Stapel>
      </Stapel>
      {vorgemerkt && (
        <div
          data-lfh="eingaenge-vorgemerkt"
          style={{ fontSize: token.fontSizeSM, color: token.colorTextSecondary }}
        >
          Offline vorgemerkt
        </div>
      )}
      {stummOffen && <StummListe />}
      {fehler && (
        <div
          role="alert"
          style={{ color: token.colorWarningText, marginBlockStart: token.marginXS }}
        >
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
          <Gruppe name="Neu" eintraege={neu} quittiere={quittiere} beiSprung={schliessen} />
          <Gruppe name="Früher" eintraege={frueher} quittiere={quittiere} beiSprung={schliessen} />
        </>
      )}
      {/* Zweiter Weg zu den eigenen Einstellungen (LLH-1642, Spec `benutzermenue`): der erste
          bleibt im Benutzermenü, das es auch außerhalb des Einsatzes gibt. Der Fuß klebt unten in
          der rollenden Fläche, sonst läge er bei langem Verlauf (bis 200 Einträge) außer Sicht. */}
      <div
        data-lfh="eingaenge-einstellungen"
        style={{
          position: 'sticky',
          bottom: 0,
          display: 'flex',
          justifyContent: 'flex-end',
          marginBlockStart: token.marginXS,
          borderTop: `1px solid ${token.colorBorderSecondary}`,
          background: token.colorBgElevated,
        }}
      >
        <Link
          to={BENACHRICHTIGUNGEN_PFAD}
          onClick={schliessen}
          style={{ display: 'inline-flex', alignItems: 'center', minHeight: token.controlHeight }}
        >
          Benachrichtigungen einstellen →
        </Link>
      </div>
    </section>
  );
}

/**
 * Alarme im Blatt am Handschirm (LLH-1738, Spec `benachrichtigungen`, „Eine Leiste am
 * Handschirm“, Entwurf `docs/design/2026-11-15-alarmzone/Handy-Blatt.dc.html`): unter `md` steht
 * keine Alarmzone, das Blatt nennt die Alarme deshalb über den Eingängen, jeder mit „Öffnen“,
 * „Gelesen“ und ✕ wie in der Zone. Ohne Alarm steht nichts.
 */
function AlarmAbschnitt({ schliessen }: { schliessen: () => void }) {
  const { token } = theme.useToken();
  const { rollen } = useRollen();
  const { eintraege } = useAlarmZone();
  // Ab `md` steht die Alarmzone oben; das Blatt (Tablet mit Finger) wiederholt sie nicht.
  const { istSchmal } = useViewport();
  if (!istSchmal || eintraege.length === 0) return null;
  // Hinweise der Organisation sind keine Alarme (Review vor dem PR): eigenes Wort, eigene Farbe.
  const alarme = eintraege.filter((e) => e.stufe === 'alarm').length;
  const hinweise = eintraege.length - alarme;
  return (
    <section aria-label="Alarme" style={{ marginBlockEnd: token.marginSM }}>
      <Augenbraue als="h2" style={{ color: alarme > 0 ? rollen.alarmText : rollen.bedienText }}>
        {[
          alarme > 0 ? (alarme === 1 ? 'Alarm' : `${alarme} Alarme`) : null,
          hinweise > 0 ? (hinweise === 1 ? 'Hinweis' : `${hinweise} Hinweise`) : null,
        ]
          .filter(Boolean)
          .join(' · ')}
      </Augenbraue>
      {[...eintraege].reverse().map((e) => (
        <div
          key={e.schluessel}
          data-lfh="alarm-eintrag"
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: token.paddingXXS,
            marginBlockStart: token.paddingXS,
            padding: `${token.paddingXS}px ${token.paddingSM}px`,
            background: e.stufe === 'alarm' ? rollen.alarmFlaeche : rollen.bedienFlaeche,
            boxShadow: `inset 4px 0 0 ${e.stufe === 'alarm' ? rollen.alarm : rollen.bedien}`,
          }}
        >
          <span style={{ fontWeight: 600 }}>{e.titel}</span>
          {e.beschreibung && (
            <span title={e.beschreibungVoll} style={{ color: rollen.text2 }}>
              {e.beschreibung}
            </span>
          )}
          <Stapel als="span" richtung="zeile" abstand="xs">
            <Button
              type="primary"
              onClick={() => {
                schliessen();
                e.oeffnen();
              }}
            >
              Öffnen
            </Button>
            {e.gelesen && <Button onClick={e.gelesen}>Gelesen</Button>}
            <Button
              type="text"
              aria-label="Ausblenden, ohne zu quittieren"
              icon={<IconKreuz />}
              onClick={e.ausblenden}
              style={{ marginInlineStart: 'auto' }}
            />
          </Stapel>
        </div>
      ))}
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
  const { istSchmal } = useViewport();
  const [offen, setOffen] = useState(false);
  const [oeffnung, setOeffnung] = useState(0);
  useEffect(() => {
    if (offen) setOeffnung((n) => n + 1);
  }, [offen]);
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
  const paneel = (
    <VerlaufOffen.Provider value={oeffnung}>
      <VerlaufPaneel einsatzId={einsatzId} schliessen={schliessen} />
    </VerlaufOffen.Provider>
  );

  if (buendelt) {
    return (
      <Drawer
        open={offen}
        onClose={schliessen}
        placement="bottom"
        size="auto"
        // Am Handschirm trägt das Blatt auch die Alarme (LLH-1738): sein Name sagt es.
        title={istSchmal ? 'Alarme und Eingänge' : null}
        closable
        styles={{ body: { paddingBlock: token.paddingSM } }}
      >
        <AlarmAbschnitt schliessen={schliessen} />
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
