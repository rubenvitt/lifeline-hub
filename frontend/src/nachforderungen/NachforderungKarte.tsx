import { Button, Flex, Space, Typography } from 'antd';
import { memo, useId, type ReactNode } from 'react';
import type { EinsatzMaterial, Nachforderung, NachforderungStatus } from '../api/types';
import {
  NACHFORDERUNG_HANDLUNG,
  NACHFORDERUNG_STATUS,
  PrioBadge,
  StatusBadge,
} from '../kommunikation';
import KommKarte from '../kommunikation/KommKarte';
import ZeitAnzeige from '../anzeige/ZeitAnzeige';
import { useAnzeigeKonventionen } from '../anzeige/AnzeigeKonventionenContext';
import { ZeilenFehler } from '../components/SpeicherHinweis';
import type { ZeilenGrund } from '../components/useZeilenFehler';
import { KennungsLink } from '../components/kennungsLink';
import { KEINE_BERECHTIGUNG } from '../einsatz/modulRegistry';
import { useMaterialOrtKontext } from '../kraefte/MaterialOrtAngabe';
import { mengeText, ortText, ortVon } from '../kraefte/materialPosten';
import { materialPfad } from '../routing/deeplinks';
import { isErgaenzen, uebernommenePosten, uebernommeneMenge } from './materialUebernahme';

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

/** Eine Betreuungsstelle, wie die Karte ihren Bezug zeigt (LLH-1082): Name und Sprung dorthin. */
export interface StellenVerweis {
  name: string;
  pfad: string;
}

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

interface NachforderungKarteProps {
  nachforderung: Nachforderung;
  /** Steuert die Übergangs-Zeitstempel/Grund-Zeilen in der Abgeschlossen-Ansicht. */
  ansicht?: 'offen' | 'abgeschlossen';
  darfSchreiben?: boolean;
  onStatus?: (id: number, status: NachforderungStatus) => void;
  onAblehnen?: (id: number) => void;
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
  /** Deeplink-Hervorhebung `?nachforderung=` (LLH-1226 D10, Spec `deeplink-hervorhebung`). */
  hervorgehoben?: boolean;
  /**
   * Bekannte Betreuungsstellen je Kennung (LLH-1082, design.md D7), stabil über den Datenstand
   * der Seite. `null`/fehlend: Modul Betreuung nicht freigegeben oder Übersicht nicht da — dann
   * „Für eine Betreuungsstelle“ ohne Namen und Sprung.
   */
  stellenJeId?: ReadonlyMap<number, StellenVerweis> | null;
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
 * Nachforderungs-Karte: Kopf mit Prio + Status, Titel „Anzahl× Art → Adressat",
 * Bezeichnung/Begründung, Übergangs-Timeline.
 */
export default memo(NachforderungKarte);

/** `memo` (LFH-949, D7): ein Live-Ereignis mit einer geänderten Nachforderung rendert eine Karte. */
function NachforderungKarte({
  nachforderung: n,
  ansicht = 'offen',
  darfSchreiben,
  onStatus,
  onAblehnen,
  fehlerGrund,
  materialJeId,
  materialGesperrt = false,
  onMaterialUebernehmen,
  hervorgehoben = false,
  stellenJeId,
}: NachforderungKarteProps) {
  const { formatZeit } = useAnzeigeKonventionen();
  const sperrgrundId = useId();
  const status = NACHFORDERUNG_STATUS[n.status] ?? NACHFORDERUNG_STATUS.angefordert;
  const next = NAECHSTER[n.status];
  const istAbg = ansicht === 'abgeschlossen';
  const abgelehnt = n.status === 'abgelehnt';
  const menge = n.anzahl != null ? `${n.anzahl}× ` : '';
  const adressat = `${ADRESSAT_LABEL[n.adressat_kategorie] ?? n.adressat_kategorie}${n.adressat_bezeichnung ? ` (${n.adressat_bezeichnung})` : ''}`;

  const aktionen: ReactNode[] =
    darfSchreiben && n.ist_offen
      ? [
          // Fortschaltung mit EINEM Klick; der Rückweg steht im Rückgängig-Toast, und
          // `uebergang_erlaubt` nimmt die Rücknahme um genau eine Stufe an. Der Knopf nennt die
          // Handlung („Zusage erfassen"), nicht den Zielstatus (LFH-959).
          next && onStatus ? (
            <Button key="next" onClick={() => onStatus(n.id, next)}>
              {NACHFORDERUNG_HANDLUNG[next]}
            </Button>
          ) : null,
          // „Ablehnen" öffnet das Modal (= eigene Bestätigung mit Grund) → keine Rückfrage.
          onAblehnen ? (
            <Button key="ab" danger onClick={() => onAblehnen(n.id)}>
              Ablehnen
            </Button>
          ) : null,
        ].filter(Boolean)
      : [];
  /*
   * Übernahme an der eingetroffenen Karte (D10): der Knopf nennt die Handlung, „Weiteren Posten
   * übernehmen“, sobald schon einer verknüpft ist (LFH-959). Ohne Freigabe für Material steht er
   * gesperrt mit dem Grund sichtbar daneben, nicht nur im Tooltip (M16, LFH-1078).
   */
  if (darfSchreiben && n.status === 'eingetroffen' && onMaterialUebernehmen) {
    const etikett = isErgaenzen(n) ? 'Weiteren Posten übernehmen' : 'Als Material übernehmen';
    aktionen.push(
      materialGesperrt ? (
        <Space key="material" size={8}>
          <Button disabled title={KEINE_BERECHTIGUNG} aria-describedby={sperrgrundId}>
            {etikett}
          </Button>
          <Text type="secondary" id={sperrgrundId}>
            {KEINE_BERECHTIGUNG}
          </Text>
        </Space>
      ) : (
        <Button key="material" onClick={() => onMaterialUebernehmen(n.id)}>
          {etikett}
        </Button>
      ),
    );
  }
  const posten = materialJeId ? uebernommenePosten(n, [...materialJeId.values()]) : [];

  return (
    // Die Anforderungszeit führt links in Mono; abgelehnt trägt den Alarmrand.
    <KommKarte
      alarm={abgelehnt}
      hervorgehoben={hervorgehoben}
      data-nachforderung-id={n.id}
      zeit={<ZeitAnzeige wert={n.angefordert_at} format="uhrzeit" />}
    >
      <Flex justify="space-between" align="center" style={{ marginBottom: 6 }} gap={8} wrap>
        <Space size={6} wrap>
          <PrioBadge prio={n.prioritaet} />
          <StatusBadge phase={status.phase} label={status.label} />
        </Space>
      </Flex>

      <Text strong style={{ fontSize: 15, lineHeight: 1.4, display: 'block', marginBottom: 4 }}>
        {menge}
        {n.art}{' '}
        <Text type="secondary" style={{ fontWeight: 400 }}>
          → {adressat}
        </Text>
      </Text>

      <Space orientation="vertical" size={2} style={{ width: '100%', marginBottom: 8 }}>
        <Text>{n.bezeichnung}</Text>
        {n.betreuungsstelle_id != null && (
          <StellenBezug verweis={stellenJeId?.get(n.betreuungsstelle_id)} />
        )}
        {n.begruendung && <Text type="secondary">{n.begruendung}</Text>}
        <Text type="secondary" style={{ fontSize: 13 }}>
          Angefordert: {formatZeit(n.angefordert_at)}
          {n.erstellt_von_name ? ` · ${n.erstellt_von_name}` : ''}
        </Text>
        {/* Übergangs-Zeitstempel: in der Abgeschlossen-Ansicht vollständig,
            in der Offen-Ansicht ab „unterwegs" (Zwischenstände sichtbar machen). */}
        {(istAbg || n.status === 'unterwegs') && (
          <Space orientation="vertical" size={0}>
            {n.zugesagt_at && (
              <Text type="secondary" style={{ fontSize: 13 }}>
                Zugesagt: {formatZeit(n.zugesagt_at)}
              </Text>
            )}
            {n.unterwegs_at && (
              <Text type="secondary" style={{ fontSize: 13 }}>
                Unterwegs: {formatZeit(n.unterwegs_at)}
              </Text>
            )}
            {n.eingetroffen_at && (
              <Text type="secondary" style={{ fontSize: 13 }}>
                Eingetroffen: {formatZeit(n.eingetroffen_at)}
              </Text>
            )}
          </Space>
        )}
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
        {abgelehnt && (
          <Text type="danger">
            Abgelehnt{n.abgelehnt_at ? ` (${formatZeit(n.abgelehnt_at)})` : ''}
            {n.abgelehnt_grund ? `: ${n.abgelehnt_grund}` : ''}
          </Text>
        )}
      </Space>

      {/* Grund einer abgelehnten Fortschaltung über den Knöpfen, bis zur nächsten an dieser Karte
         (LFH-1077). */}
      {fehlerGrund && (
        <div style={{ marginTop: 8 }}>
          <ZeilenFehler fehler={fehlerGrund.fehler} fallback={fehlerGrund.fallback} />
        </div>
      )}
      {/* `<Space size="middle">`: „Ablehnen" ist `danger` und braucht Abstand zur Fortschaltung
         (gepinnt in `components/aktionsabstand.guard.test.ts`). */}
      {aktionen.length > 0 && (
        <Space
          size="middle"
          wrap
          style={{ marginTop: 8, width: '100%', justifyContent: 'flex-end' }}
        >
          {aktionen}
        </Space>
      )}
    </KommKarte>
  );
}
