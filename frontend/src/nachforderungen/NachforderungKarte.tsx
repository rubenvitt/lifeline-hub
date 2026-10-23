import { Button, Flex, Space, Typography, theme } from 'antd';
import { memo, useId, type ReactNode } from 'react';
import { Link } from 'react-router';
import type {
  Einheit,
  EinsatzMaterial,
  Nachforderung,
  NachforderungStatus,
  NachforderungZusageEingabe,
  PatchNachforderung,
} from '../api/types';
import {
  NACHFORDERUNG_HANDLUNG,
  NACHFORDERUNG_STATUS,
  PrioBadge,
  StatusBadge,
} from '../kommunikation';
import KommKarte from '../kommunikation/KommKarte';
import { MenueAusloeser, type MenueEintrag } from '../components/MenueAusloeser';
import { StatusChip } from '../components/instrument';
import type { Speicherung } from '../components/Erfassung';
import { formatVor } from '../anzeige/abstand';
import { useAnzeigeKonventionen } from '../anzeige/AnzeigeKonventionenContext';
import { monoStil, useRollen } from '../components/instrument';
import { ZeilenFehler } from '../components/SpeicherHinweis';
import type { ZeilenGrund } from '../components/useZeilenFehler';
import { KennungsLink } from '../components/kennungsLink';
import { KEINE_BERECHTIGUNG } from '../einsatz/modulRegistry';
import { useMaterialOrtKontext } from '../kraefte/MaterialOrtAngabe';
import { mengeText, ortText, ortVon } from '../kraefte/materialPosten';
import { einheitDetailPfad, materialPfad } from '../routing/deeplinks';
import {
  isWeitereEinheit,
  kannEinheitUebernehmen,
  uebernommeneEinheiten,
} from './einheitUebernahme';
import { EINHEITEN_SCHRIFT, einheitenSprungAufbau } from './einheitenSprung';
import { isErgaenzen, uebernommenePosten, uebernommeneMenge } from './materialUebernahme';
import { istUeberfaellig, kartenZeiten } from './nachforderungStufen';
import { nachforderungName } from './nachforderungName';
import { zielZeile, type ZielAbschnitt, type ZielNamen, type ZielRaum } from './zielVorschlaege';
import { zusageZeilen } from './zusage';
import ZusageFormular from './ZusageFormular';
import BearbeitenFormular from './BearbeitenFormular';

const { Text } = Typography;

/** Adressat-Kategorie → Anzeigelabel (modul-spezifisch, bleibt lokal). */
const ADRESSAT_LABEL: Record<string, string> = {
  leitstelle: 'Leitstelle',
  nachbar_ea: 'Nachbar-EA',
  uebergeordnet: 'Übergeordnete Führung',
  andere_bos: 'Andere BOS',
};
/** Nächster linearer Status (für die Weiterschalten-Aktion). */
const NAECHSTER: Partial<Record<NachforderungStatus, NachforderungStatus>> = {
  angefordert: 'zugesagt',
  zugesagt: 'unterwegs',
  unterwegs: 'eingetroffen',
};

/** Ein übernommener Posten, wie die Karte ihn aus der Material-Query liest (LLH-1226 D10). */
export type UebernahmePosten = Pick<
  EinsatzMaterial,
  | 'id'
  | 'bezeichnung'
  | 'art'
  | 'menge'
  | 'ausgegeben'
  | 'einheit_id'
  | 'einsatz_fahrzeug_id'
  | 'uhs_id'
  | 'br_id'
  | 'beendet_at'
>;

/** Eine übernommene Einheit, wie die Karte sie aus der Einheiten-Query liest (LLH-1383 D9). */
export type UebernahmeEinheit = Pick<Einheit, 'id' | 'name' | 'funkrufname'>;

/** Eine Betreuungsstelle, wie die Karte ihren Bezug zeigt (LLH-1082): Name und Sprung dorthin. */
export interface StellenVerweis {
  name: string;
  pfad: string;
}

/** Das Formular, das an einer Karte offen ist (LLH-1097 D10): höchstens eines je Seite. */
export type KartenFormular = 'zusage' | 'bearbeiten';

/** Die Einträge des ⋮-Menüs einer offenen Karte (D10). */
type MenueAktion = 'bearbeiten' | 'zurueckziehen' | 'ablehnen';

/** Zustand eines aus dem Einsatz genommenen Postens, Wortlaut der Materialliste (LLH-1093). */
const AUS_DEM_EINSATZ = 'aus dem Einsatz genommen';

/**
 * Die übernommenen Posten mit Bezeichnung, Menge und Ort (D10), darunter „übernommen 1200 von
 * 2000“ und der Sprung in die Materialliste. Eigene Komponente, damit die Orte (Einheiten, UHS …)
 * nur geladen werden, wenn eine Karte Posten zeigt; die Abrufe teilen die Schlüssel der
 * Materialliste.
 */
function UebernommenePosten({
  nachforderung: n,
  posten,
}: {
  nachforderung: Pick<Nachforderung, 'einsatz_id' | 'anzahl' | 'material_ids'>;
  posten: readonly UebernahmePosten[];
}) {
  const { kontext } = useMaterialOrtKontext(n.einsatz_id, false, posten);
  return (
    <div data-lfh="nachforderung-posten">
      {posten.map((p) => (
        <Text key={p.id} style={{ display: 'block', fontSize: 13 }}>
          {[
            p.bezeichnung,
            mengeText(p),
            p.beendet_at ? AUS_DEM_EINSATZ : ortText(ortVon(p), kontext.namen),
          ].join(' · ')}
        </Text>
      ))}
      {n.anzahl != null && (
        <Text type="secondary" style={{ display: 'block', fontSize: 13 }}>
          übernommen {uebernommeneMenge(n, posten)} von {n.anzahl}
        </Text>
      )}
      {/* Ein Sprung ist keine Handlung (LFH-616): eine Zeile, abgesetzt von den Knöpfen. */}
      <div data-lfh="inspector-sprung">
        <KennungsLink to={materialPfad(n.einsatz_id)}>
          Material <span aria-hidden="true">↗</span>
        </KennungsLink>
      </div>
    </div>
  );
}

/**
 * Die übernommenen Einheiten (LLH-1383 D9): „Als Einheit übernommen: 83-1 ↗, 83-2 ↗“, je Einheit
 * der Sprung in ihr Detail. Kennt die Seite keine davon (Modul nicht freigegeben, Liste noch nicht
 * da), steht nur die Zahl; eine unbekannte (aufgelöste) zählt als „weitere“.
 */
function UebernommeneEinheiten({
  nachforderung: n,
  einheitenJeId,
}: {
  nachforderung: Pick<Nachforderung, 'einsatz_id' | 'einheit_ids'>;
  einheitenJeId: ReadonlyMap<number, UebernahmeEinheit> | null | undefined;
}) {
  const { token } = theme.useToken();
  const bekannt = einheitenJeId ? uebernommeneEinheiten(n, einheitenJeId) : [];
  if (bekannt.length === 0) {
    return (
      <Text
        type="secondary"
        style={{ fontSize: EINHEITEN_SCHRIFT }}
        data-lfh="nachforderung-einheiten"
      >
        {n.einheit_ids.length === 1 ? '1 Einheit' : `${n.einheit_ids.length} Einheiten`} übernommen
      </Text>
    );
  }
  // Eine aufgelöste Einheit kennt die Liste der aktiven nicht: sie zählt mit.
  const weitere = n.einheit_ids.length - bekannt.length;
  // Fließend im Satz (kompakt) oder gereiht mit vollem Boden (Tablet, Handschuh), LLH-1410.
  const aufbau = einheitenSprungAufbau(token);
  const gereiht = aufbau.art === 'gereiht';
  return (
    <Text
      style={
        gereiht
          ? {
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'center',
              columnGap: token.marginXXS,
              fontSize: EINHEITEN_SCHRIFT,
            }
          : { display: 'block', fontSize: EINHEITEN_SCHRIFT }
      }
      data-lfh="nachforderung-einheiten"
    >
      Als Einheit übernommen:{' '}
      {bekannt.map((e, i) => {
        const ziel = einheitDetailPfad(n.einsatz_id, e.id);
        const inhalt = (
          <>
            {e.funkrufname?.trim() || e.name} <span aria-hidden="true">↗</span>
          </>
        );
        // Das Komma hängt am Link, damit es nie allein eine Zeile beginnt.
        const komma = i < bekannt.length - 1 || weitere > 0 ? ',' : null;
        return (
          <span key={e.id}>
            {i > 0 && ' '}
            {aufbau.art === 'fliessend' ? (
              <Link to={ziel} style={aufbau.link}>
                {inhalt}
              </Link>
            ) : (
              <KennungsLink to={ziel}>{inhalt}</KennungsLink>
            )}
            {komma}
          </span>
        );
      })}
      {weitere > 0 && ` ${weitere} weitere`}
    </Text>
  );
}

/** Ein gesperrter Übernahme-Knopf mit dem Grund sichtbar daneben (M16, LFH-1078). */
function GesperrterKnopf({ etikett, grundId }: { etikett: string; grundId: string }) {
  return (
    <Space size={8} wrap>
      <Button disabled title={KEINE_BERECHTIGUNG} aria-describedby={grundId}>
        {etikett}
      </Button>
      <Text type="secondary" id={grundId}>
        {KEINE_BERECHTIGUNG}
      </Text>
    </Space>
  );
}

interface NachforderungKarteProps {
  nachforderung: Nachforderung;
  /**
   * Die Stufe der Spalte, in der die Karte steht (LLH-1078). Weicht der Status ab, weil die
   * Zuflussschleuse die Karte an ihrem Ort hält, nennt die Karte ihren Status selbst.
   */
  spaltenStufe?: NachforderungStatus;
  /** Takt der Seite in ms für das Alter „vor 42 min“ (primitiv, `memo` bleibt wirksam). */
  jetzt?: number;
  darfSchreiben?: boolean;
  onStatus?: (id: number, status: NachforderungStatus) => void;
  onAblehnen?: (id: number) => void;
  /** Öffnet den Dialog „Zurückziehen“ der Seite (LLH-1097 D8). */
  onZurueckziehen?: (id: number) => void;
  /**
   * Das an dieser Karte offene Formular (LLH-1097 D10), `null` ohne. Den Zustand hält die Seite:
   * offen ist höchstens eines, und solange hält das Board still.
   */
  formular?: KartenFormular | null;
  /** Öffnet (`art`) oder schließt (`null`) das Formular dieser Karte. */
  onFormular?: (id: number, art: KartenFormular | null) => void;
  /** Zusage senden; **muss bei Ablehnung ablehnen** (`mutateAsync`). */
  onZusage?: (id: number, zusage: NachforderungZusageEingabe) => Promise<unknown>;
  /** Änderung senden; **muss bei Ablehnung ablehnen** (`mutateAsync`). */
  onBearbeiten?: (id: number, aenderung: PatchNachforderung) => Promise<unknown>;
  /** Die Mutation des offenen Formulars: ihr Fehler steht im Formular. Nur an dessen Karte. */
  formularSpeicherung?: Speicherung;
  /** Räume und Abschnitte für „Wohin“ beim Bearbeiten; nur an der Karte mit offenem Formular. */
  raeume?: readonly ZielRaum[];
  abschnitte?: readonly ZielAbschnitt[];
  /** Grund der zuletzt abgelehnten Fortschaltung, aus `components/useZeilenFehler.ts`. */
  fehlerGrund?: ZeilenGrund | null;
  /**
   * Bekannte Posten der Materialliste je Kennung (LLH-1226 D8/D10), stabil über den Datenstand
   * der Seite. `null`/fehlend: Modul Material nicht freigegeben oder Liste nicht da — dann nur
   * die Zahl der übernommenen Posten.
   */
  materialJeId?: ReadonlyMap<number, UebernahmePosten> | null;
  /** Modul Material nicht bedienbar (`istKeyFreigegeben`): „Als Material übernehmen“ steht gesperrt. */
  materialGesperrt?: boolean;
  /** Öffnet den Dialog „Als Material übernehmen“ (an eingetroffenen Karten). */
  onMaterialUebernehmen?: (id: number) => void;
  /**
   * Öffnet den Dialog „Erfassten Posten zuordnen …“ (LLH-1259 D5): ein schon erfasster Posten
   * bekommt den Bezug, statt dass die Übernahme einen zweiten anlegt.
   */
  onPostenZuordnen?: (id: number) => void;
  /**
   * Bekannte Einheiten je Kennung (LLH-1383 D9), stabil über den Datenstand der Seite.
   * `null`/fehlend: Modul Einheiten nicht freigegeben oder Liste nicht da — dann nur die Zahl.
   */
  einheitenJeId?: ReadonlyMap<number, UebernahmeEinheit> | null;
  /** Modul Einheiten nicht bedienbar: „Als Einheit übernehmen“ steht gesperrt. */
  einheitGesperrt?: boolean;
  /** Öffnet den Dialog „Als Einheit übernehmen“ (an eingetroffenen Karten). */
  onEinheitUebernehmen?: (id: number) => void;
  /** Vorschläge für „Wer“ an Zusage und Bearbeiten (D10), stabil über den Datenstand. */
  werVorschlaege?: readonly string[];
  /** Deeplink-Hervorhebung `?nachforderung=` (LLH-1226 D10, Spec `deeplink-hervorhebung`). */
  hervorgehoben?: boolean;
  /** Die Fortschaltung dieser Karte läuft: der Knopf zeigt es sofort (Kriterium 3). */
  laeuft?: boolean;
  /**
   * Bekannte Betreuungsstellen je Kennung (LLH-1082, design.md D7), stabil über den Datenstand
   * der Seite. `null`/fehlend: Modul Betreuung nicht freigegeben oder Übersicht nicht da — dann
   * „Für eine Betreuungsstelle“ ohne Namen und Sprung.
   */
  stellenJeId?: ReadonlyMap<number, StellenVerweis> | null;
  /**
   * Namen der Ziele (LLH-1089, design.md D10), stabil über den Datenstand der Seite. Ohne Namen
   * steht „→ Bereitstellungsraum“ bzw. „→ Einsatzabschnitt“.
   */
  zielNamen?: ZielNamen | null;
}

/** Zeile „Für Betreuungsstelle …“ einer Nachforderung mit Stellenbezug (LLH-1082). */
function StellenBezug({ verweis }: { verweis: StellenVerweis | undefined }) {
  if (!verweis) {
    return (
      <Text type="secondary" style={{ fontSize: 13 }} data-lfh="nachforderung-stelle">
        Für eine Betreuungsstelle
      </Text>
    );
  }
  return (
    <Text type="secondary" style={{ fontSize: 13 }} data-lfh="nachforderung-stelle">
      Für Betreuungsstelle{' '}
      <KennungsLink to={verweis.pfad}>
        {verweis.name} <span aria-hidden="true">↗</span>
      </KennungsLink>
    </Text>
  );
}

/**
 * Karte einer Nachforderung im Board (LLH-1078, Spec `nachforderungen-board`): kompakt —
 * Priorität und Alter seit der Anforderung, „Menge × Art“, Adressat, Bedarf, Zusage (Wer,
 * Teilung, LLH-1097 D11), Zeitzeilen (`kartenZeiten`, mit dem erwarteten Eintreffen),
 * übernommenes Material, Grund einer Ablehnung oder des Zurückziehens. Genau eine Primäraktion:
 * die Fortschaltung um eine Stufe; „Zusage erfassen“ öffnet dafür das Formular an der Karte.
 * Bearbeiten, Zurückziehen und Ablehnen stehen im ⋮-Menü (D10).
 */
export default memo(NachforderungKarte);

/** `memo` (LFH-949, D7): ein Live-Ereignis mit einer geänderten Nachforderung rendert eine Karte. */
function NachforderungKarte({
  nachforderung: n,
  spaltenStufe,
  jetzt,
  darfSchreiben,
  onStatus,
  onAblehnen,
  onZurueckziehen,
  formular = null,
  onFormular,
  onZusage,
  onBearbeiten,
  formularSpeicherung,
  raeume,
  abschnitte,
  fehlerGrund,
  materialJeId,
  materialGesperrt = false,
  onMaterialUebernehmen,
  onPostenZuordnen,
  einheitenJeId,
  einheitGesperrt = false,
  onEinheitUebernehmen,
  werVorschlaege,
  hervorgehoben = false,
  laeuft = false,
  stellenJeId,
  zielNamen,
}: NachforderungKarteProps) {
  const { formatZeit } = useAnzeigeKonventionen();
  const { token, rollen } = useRollen();
  const sperrgrundId = useId();
  const einheitSperrgrundId = useId();
  const status = NACHFORDERUNG_STATUS[n.status] ?? NACHFORDERUNG_STATUS.angefordert;
  const next = NAECHSTER[n.status];
  const abgelehnt = n.status === 'abgelehnt';
  const zurueckgezogen = n.status === 'zurueckgezogen';
  const ueberfaellig = jetzt != null && istUeberfaellig(n, jetzt);
  const name = nachforderungName(n);
  const menge = n.anzahl != null ? `${n.anzahl}× ` : '';
  const adressat = `${ADRESSAT_LABEL[n.adressat_kategorie] ?? n.adressat_kategorie}${n.adressat_bezeichnung ? ` (${n.adressat_bezeichnung})` : ''}`;
  // Im Board nennt die Stufe der Spaltenkopf bzw. das gewählte Segment; eine gehaltene Karte, die
  // inzwischen weiter ist, trägt ihre neue Stufe selbst. Ohne Spalte steht sie immer.
  const statusZeigen = spaltenStufe !== n.status;
  const zeiten = kartenZeiten(n, formatZeit, jetzt);
  const ziel = zielZeile(n, zielNamen);
  const zusage = zusageZeilen(n);
  // Die Zusage geht über das Formular an der Karte, sobald die Seite es führt (LLH-1097 D10).
  const zusageAlsFormular = next === 'zugesagt' && onFormular != null && onZusage != null;
  const offenesFormular = darfSchreiben && n.ist_offen ? formular : null;

  /*
   * Bearbeiten, Zurückziehen und Ablehnen gebündelt (D10, ab drei Aktionen): beide Abschlüsse sind
   * unumkehrbar und stehen rot hinter dem Trenner; jeder fragt im Dialog der Seite mit Grund.
   */
  const menue: MenueEintrag<MenueAktion>[] =
    darfSchreiben && n.ist_offen
      ? [
          ...(onFormular && onBearbeiten
            ? [{ key: 'bearbeiten' as const, label: 'Bearbeiten' }]
            : []),
          ...(onZurueckziehen
            ? [{ key: 'zurueckziehen' as const, label: 'Zurückziehen', gefahr: true as const }]
            : []),
          ...(onAblehnen
            ? [{ key: 'ablehnen' as const, label: 'Ablehnen', gefahr: true as const }]
            : []),
        ]
      : [];
  const waehle = (key: MenueAktion) => {
    if (key === 'bearbeiten') onFormular?.(n.id, 'bearbeiten');
    else if (key === 'zurueckziehen') onZurueckziehen?.(n.id);
    else onAblehnen?.(n.id);
  };

  // Solange ein Formular an der Karte offen ist, stehen seine Knöpfe allein: der Öffner ist weg.
  const aktionen: ReactNode[] =
    darfSchreiben && n.ist_offen && offenesFormular == null
      ? [
          // Fortschaltung mit EINEM Klick; der Rückweg steht im Rückgängig-Toast, und
          // `uebergang_erlaubt` nimmt die Rücknahme um genau eine Stufe an. Der Knopf nennt die
          // Handlung („Zusage erfassen"), nicht den Zielstatus (LFH-959). Umrandet, nicht gefüllt:
          // gefüllt ist nur die Primäraktion im Seitenkopf, sonst stünde das Board voller Blau.
          zusageAlsFormular ? (
            <Button key="next" loading={laeuft} onClick={() => onFormular(n.id, 'zusage')}>
              {NACHFORDERUNG_HANDLUNG.zugesagt}
            </Button>
          ) : next && onStatus ? (
            <Button key="next" loading={laeuft} onClick={() => onStatus(n.id, next)}>
              {NACHFORDERUNG_HANDLUNG[next]}
            </Button>
          ) : null,
          menue.length > 0 ? (
            <MenueAusloeser<MenueAktion>
              key="menue"
              eintraege={menue}
              zugaenglicherName={`Aktionen zu Nachforderung ${name}`}
              onWahl={waehle}
            />
          ) : null,
        ].filter(Boolean)
      : [];
  /*
   * Übernahme an der eingetroffenen Karte (LLH-1226 D10, LLH-1383 D9): der Knopf nennt die
   * Handlung, „Weiteren Posten übernehmen“ bzw. „Weitere Einheit übernehmen“, sobald schon etwas
   * verknüpft ist (LFH-959). Material und Einheit schließen sich aus: wer eines übernommen hat,
   * sieht den anderen Knopf nicht mehr. Ohne Freigabe steht der Knopf gesperrt mit dem Grund
   * sichtbar daneben, nicht nur im Tooltip (M16, LFH-1078).
   */
  if (darfSchreiben && n.status === 'eingetroffen') {
    if (onEinheitUebernehmen && kannEinheitUebernehmen(n)) {
      const etikett = isWeitereEinheit(n) ? 'Weitere Einheit übernehmen' : 'Als Einheit übernehmen';
      aktionen.push(
        einheitGesperrt ? (
          <GesperrterKnopf key="einheit" etikett={etikett} grundId={einheitSperrgrundId} />
        ) : (
          <Button key="einheit" onClick={() => onEinheitUebernehmen(n.id)}>
            {etikett}
          </Button>
        ),
      );
    }
    if (onMaterialUebernehmen && n.einheit_ids.length === 0) {
      const etikett = isErgaenzen(n) ? 'Weiteren Posten übernehmen' : 'Als Material übernehmen';
      aktionen.push(
        materialGesperrt ? (
          <GesperrterKnopf key="material" etikett={etikett} grundId={sperrgrundId} />
        ) : (
          <Button key="material" onClick={() => onMaterialUebernehmen(n.id)}>
            {etikett}
          </Button>
        ),
      );
    }
    // Der zweite Weg (LLH-1259 D5); gesperrt nennt „Als Material übernehmen“ schon den Grund.
    if (onPostenZuordnen && n.einheit_ids.length === 0 && !materialGesperrt) {
      aktionen.push(
        <Button key="zuordnen" onClick={() => onPostenZuordnen(n.id)}>
          Erfassten Posten zuordnen …
        </Button>,
      );
    }
  }
  const posten = materialJeId ? uebernommenePosten(n, [...materialJeId.values()]) : [];

  return (
    // Abgelehnt trägt den Alarmrand. Ziel des Fokus, wenn die eigene Fortschaltung die Karte in
    // eine andere Spalte trägt (`tabIndex -1`, nicht in der Tab-Folge).
    <KommKarte
      alarm={abgelehnt}
      hervorgehoben={hervorgehoben}
      data-nachforderung-id={n.id}
      data-status={n.status}
      tabIndex={-1}
    >
      <Flex justify="space-between" align="center" style={{ marginBottom: 4 }} gap={8} wrap>
        <Space size={6} wrap>
          <PrioBadge prio={n.prioritaet} />
          {statusZeigen && (
            <StatusBadge phase={status.phase} label={status.label} ton={status.ton} />
          )}
          {/* Das Wort ist der zweite Kanal neben dem Ton (LLH-1097 D7); kein Alarm. */}
          {ueberfaellig && <StatusChip ton="achtung" wort="überfällig" />}
        </Space>
        {jetzt != null && (
          <span
            data-lfh="nachforderung-alter"
            style={{ ...monoStil(token.fontSizeSM), color: rollen.gedaempft }}
          >
            {formatVor(n.angefordert_at, jetzt)}
          </span>
        )}
      </Flex>

      <Text strong style={{ fontSize: 15, lineHeight: 1.4, display: 'block' }}>
        {menge}
        {n.art}
      </Text>
      {ziel && (
        <Text
          data-lfh="nachforderung-ziel"
          style={{ display: 'block', fontSize: 13, overflowWrap: 'anywhere' }}
        >
          {ziel}
        </Text>
      )}
      <Text type="secondary" style={{ display: 'block', fontSize: 13, marginBottom: 4 }}>
        an {adressat}
      </Text>

      <Space orientation="vertical" size={2} style={{ width: '100%', marginBottom: 4 }}>
        {n.bezeichnung && <Text style={{ overflowWrap: 'anywhere' }}>{n.bezeichnung}</Text>}
        {n.betreuungsstelle_id != null && (
          <StellenBezug verweis={stellenJeId?.get(n.betreuungsstelle_id)} />
        )}
        {n.begruendung && <Text type="secondary">{n.begruendung}</Text>}
        {zusage.length > 0 && (
          <Space orientation="vertical" size={0} data-lfh="nachforderung-zusage-angaben">
            {zusage.map((z) => (
              <Text key={z} style={{ fontSize: 13, overflowWrap: 'anywhere' }}>
                {z}
              </Text>
            ))}
          </Space>
        )}
        <Space orientation="vertical" size={0} data-lfh="nachforderung-zeiten">
          {zeiten.map((z) => (
            <Text
              key={z.schluessel}
              type={z.ton === 'achtung' ? 'warning' : 'secondary'}
              style={{ fontSize: 13 }}
            >
              {z.text}
            </Text>
          ))}
        </Space>
        {/* Übernommenes Material (D10): mit Freigabe je Posten, sonst nur die Zahl. */}
        {posten.length > 0 ? (
          <UebernommenePosten nachforderung={n} posten={posten} />
        ) : (
          n.material_ids.length > 0 && (
            <Text type="secondary" style={{ fontSize: 13 }}>
              {n.material_ids.length} Posten übernommen
            </Text>
          )
        )}
        {n.einheit_ids.length > 0 && (
          <UebernommeneEinheiten nachforderung={n} einheitenJeId={einheitenJeId} />
        )}
        {abgelehnt && (
          <Text type="danger">
            Abgelehnt{n.abgelehnt_at ? ` (${formatZeit(n.abgelehnt_at)})` : ''}
            {n.abgelehnt_grund ? `: ${n.abgelehnt_grund}` : ''}
          </Text>
        )}
        {zurueckgezogen && (
          <Text type="secondary" style={{ overflowWrap: 'anywhere' }}>
            Zurückgezogen{n.zurueckgezogen_at ? ` (${formatZeit(n.zurueckgezogen_at)})` : ''}
            {n.zurueckgezogen_grund ? `: ${n.zurueckgezogen_grund}` : ''}
          </Text>
        )}
      </Space>

      {offenesFormular === 'zusage' && onFormular && onZusage && (
        <div style={{ marginTop: 8 }}>
          <ZusageFormular
            nachforderung={n}
            werVorschlaege={werVorschlaege}
            onSenden={(z) => onZusage(n.id, z)}
            onSchliessen={() => onFormular(n.id, null)}
            speicherung={formularSpeicherung}
          />
        </div>
      )}
      {offenesFormular === 'bearbeiten' && onFormular && onBearbeiten && (
        <div style={{ marginTop: 8 }}>
          <BearbeitenFormular
            nachforderung={n}
            zielNamen={zielNamen}
            raeume={raeume}
            abschnitte={abschnitte}
            werVorschlaege={werVorschlaege}
            onSpeichern={(a) => onBearbeiten(n.id, a)}
            onSchliessen={() => onFormular(n.id, null)}
            speicherung={formularSpeicherung}
          />
        </div>
      )}

      {/* Grund einer abgelehnten Fortschaltung über den Knöpfen, bis zur nächsten an dieser Karte
         (LFH-1077). */}
      {fehlerGrund && (
        <div style={{ marginTop: 8 }}>
          <ZeilenFehler fehler={fehlerGrund.fehler} fallback={fehlerGrund.fallback} />
        </div>
      )}
      {/* Fortschaltung und ⋮-Menü; „Zurückziehen“ und „Ablehnen“ stehen rot hinter dem Trenner des
         Menüs (LLH-1097 D10), nicht in der Reihe. */}
      {aktionen.length > 0 && (
        <Space size="middle" wrap style={{ marginTop: 8, width: '100%' }}>
          {aktionen}
        </Space>
      )}
    </KommKarte>
  );
}
