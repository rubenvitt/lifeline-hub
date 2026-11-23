import { Button } from 'antd';
import { useQueries } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import { ladeLagebericht } from '../api/lageberichte';
import { einsatzKeys } from '../api/queryKeys';
import type { LageberichtAnzeige, LageberichtKopf } from '../api/types';
import ZeitAnzeige from '../anzeige/ZeitAnzeige';
import Markdown from '../components/Markdown';
import { KennungsLink } from '../components/kennungsLink';
import { useViewport } from '../components/useViewport';
import {
  Balken,
  Datenfeld,
  Datenraster,
  Feldetikett,
  Paneel,
  PaneelLink,
  PaneelZustand,
  Stapel,
  Textstufe,
  monoStil,
  schriftStil,
  useRollen,
} from '../components/instrument';
import { lageberichtDetailPfad } from '../routing/deeplinks';
import { VORLAGEN } from './vorlagen';
import { abschnittsFuellstand, kernAbschnitt, textAuszug, type Uebersicht } from './uebersicht';

/**
 * Die drei Paneele der Lageberichte-Übersicht (LLH-1064) in der Paneelsprache des Lagebild-Dashboards
 * (`pages/lage-dashboard/LagePaneele.tsx`): Augenbraue-Kopf mit Meta und Sprung „… ↗“.
 *
 * - **Aktueller Lagevortrag**: die jüngste Freigabe; ohne Freigabe entfällt das Paneel.
 * - **In Arbeit**: die Entwürfe mit „zuletzt gespeichert“ und Füllstand.
 * - **Verlauf**: die übrigen Freigaben als Zeitliste; ohne sie entfällt das Paneel.
 *
 * Text, Füllstand und „zuletzt gespeichert“ stehen nicht in der Liste (Spec `listen-projektion`,
 * LFH-931: Kopfdaten ohne Abschnitte und ohne `aktualisiert_at`). Sie kommen aus dem Einzelabruf
 * desselben Keys wie die Entwurfsseite, der live über `nur_inhalt` nachzieht. Was nicht geladen
 * ist, steht als „—“, nie als 0.
 */

function vorlageLabel(schluessel: string): string {
  return VORLAGEN.find((v) => v.schluessel === schluessel)?.label ?? schluessel;
}

interface Props {
  einsatzId: number;
  uebersicht: Uebersicht;
  /** Fortschreiben am aktuellen Stand: nur mit Schreibrecht und ohne Nachfolger, sonst `null`. */
  fortschreiben: { onKlick: () => void; laeuft: boolean } | null;
}

export default function LageberichtUebersicht({ einsatzId, uebersicht, fortschreiben }: Props) {
  const { token } = useRollen();
  const { abBreite } = useViewport();
  const { aktuell, inArbeit, verlauf } = uebersicht;

  const ids = [...(aktuell ? [aktuell.id] : []), ...inArbeit.map((b) => b.id)];
  const details = useQueries({
    queries: ids.map((id) => ({
      queryKey: einsatzKeys.lagebericht(einsatzId, id),
      queryFn: () => ladeLagebericht(einsatzId, id),
    })),
  });
  const detailVon = new Map<number, LageberichtAnzeige | undefined>(
    ids.map((id, i) => [id, details[i]?.data]),
  );

  const breit = abBreite('lg');
  return (
    <div
      data-lfh="lageberichte-uebersicht"
      style={{
        display: 'grid',
        gridTemplateColumns:
          breit && aktuell ? 'minmax(0, 1.2fr) minmax(0, 1fr)' : 'minmax(0, 1fr)',
        gap: token.margin,
        alignItems: 'start',
      }}
    >
      {aktuell && (
        <AktuellPaneel
          einsatzId={einsatzId}
          bericht={aktuell}
          detail={detailVon.get(aktuell.id)}
          fortschreiben={fortschreiben}
        />
      )}
      <InArbeitPaneel einsatzId={einsatzId} entwuerfe={inArbeit} detailVon={detailVon} />
      {verlauf.length > 0 && (
        <div style={{ gridColumn: '1 / -1' }}>
          <VerlaufPaneel einsatzId={einsatzId} berichte={verlauf} />
        </div>
      )}
    </div>
  );
}

function AktuellPaneel({
  einsatzId,
  bericht,
  detail,
  fortschreiben,
}: {
  einsatzId: number;
  bericht: LageberichtKopf;
  detail: LageberichtAnzeige | undefined;
  fortschreiben: Props['fortschreiben'];
}) {
  const { token } = useRollen();
  const navigate = useNavigate();
  const kern = kernAbschnitt(bericht.vorlage);
  const kernText = kern && detail?.abschnitte.find((a) => a.schluessel === kern.schluessel)?.text;
  const auszug = kernText ? textAuszug(kernText) : null;
  return (
    <Paneel
      titel="Aktueller Lagevortrag"
      meta={`${vorlageLabel(bericht.vorlage)} · v${bericht.version}`}
      aktion={
        <PaneelLink
          label="Öffnen"
          onKlick={() => void navigate(lageberichtDetailPfad(einsatzId, bericht.id))}
        />
      }
      koerperPolster
    >
      <div data-lfh="lagebericht-aktuell">
        <Stapel abstand="sm">
          <Textstufe als="h3" stufe="kartentitel">
            {bericht.titel}
          </Textstufe>
          <Datenraster spalten={2}>
            <Datenfeld label="Zeitstand" mono>
              <ZeitAnzeige wert={bericht.zeitstand} />
            </Datenfeld>
            <Datenfeld label="Freigegeben" mono>
              {bericht.freigegeben_von_name ?? '—'}
              {bericht.freigegeben_at && (
                <>
                  {' · '}
                  <ZeitAnzeige wert={bericht.freigegeben_at} />
                </>
              )}
            </Datenfeld>
          </Datenraster>
          {kern && auszug && (
            <div data-lfh="lagebericht-auszug">
              <div style={{ marginBlockEnd: token.marginXXS }}>
                <Feldetikett als="div">{kern.label}</Feldetikett>
              </div>
              {/* Unter dem Titel (h3) — `#` im Text wird h4. */}
              <Markdown variante="kompakt" unterEbene={3}>
                {auszug.gekuerzt ? `${auszug.text} …` : auszug.text}
              </Markdown>
            </div>
          )}
          {fortschreiben && (
            <span>
              <Button onClick={fortschreiben.onKlick} loading={fortschreiben.laeuft}>
                Fortschreiben
              </Button>
            </span>
          )}
        </Stapel>
      </div>
    </Paneel>
  );
}

function InArbeitPaneel({
  einsatzId,
  entwuerfe,
  detailVon,
}: {
  einsatzId: number;
  entwuerfe: LageberichtKopf[];
  detailVon: Map<number, LageberichtAnzeige | undefined>;
}) {
  const { token, rollen } = useRollen();
  return (
    <Paneel
      titel="In Arbeit"
      meta={`${entwuerfe.length} ${entwuerfe.length === 1 ? 'Entwurf' : 'Entwürfe'}`}
    >
      <PaneelZustand
        zustand={entwuerfe.length === 0 ? 'leer' : 'daten'}
        titel="In Arbeit"
        leerText="Kein Entwurf in Arbeit"
        onNeuladen={() => {}}
      >
        <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {entwuerfe.map((b) => {
            const detail = detailVon.get(b.id);
            const stand = detail ? abschnittsFuellstand(b.vorlage, detail.abschnitte) : null;
            return (
              <li
                key={b.id}
                data-lfh="lagebericht-entwurf"
                style={{
                  paddingBlock: token.paddingXS,
                  paddingInline: token.padding,
                  borderBlockEnd: `1px solid ${rollen.flaeche3}`,
                }}
              >
                <KennungsLink
                  to={lageberichtDetailPfad(einsatzId, b.id)}
                  style={{ fontWeight: 600 }}
                >
                  {b.titel}
                </KennungsLink>
                <div style={{ ...schriftStil('meta'), color: rollen.gedaempft }}>
                  {`${vorlageLabel(b.vorlage)} · v${b.version} · `}
                  <ZeitAnzeige wert={b.zeitstand} />
                  {` · ${b.ersteller_name}`}
                </div>
                <div
                  style={{
                    display: 'flex',
                    flexWrap: 'wrap',
                    alignItems: 'center',
                    columnGap: token.marginSM,
                    ...schriftStil('meta'),
                    color: rollen.text2,
                  }}
                >
                  <span data-lfh="zuletzt-gespeichert">
                    {'zuletzt gespeichert '}
                    {detail ? <ZeitAnzeige wert={detail.aktualisiert_at} rolle="kurz" /> : '—'}
                  </span>
                  <span data-lfh="abschnitte-gefuellt">
                    {stand ? `${stand.gefuellt}/${stand.gesamt} Abschnitte` : '— Abschnitte'}
                  </span>
                  {stand && (
                    // Die Zahl führt; der Balken ergänzt nur und liest sich nicht noch einmal vor.
                    <span aria-hidden="true" style={{ flex: '0 1 80px', minWidth: 40 }}>
                      <Balken
                        wert={stand.gefuellt}
                        max={stand.gesamt}
                        farbe={rollen.gedaempft}
                        beschriftung={`${stand.gefuellt} von ${stand.gesamt} Abschnitten`}
                      />
                    </span>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </PaneelZustand>
    </Paneel>
  );
}

function VerlaufPaneel({
  einsatzId,
  berichte,
}: {
  einsatzId: number;
  berichte: LageberichtKopf[];
}) {
  const { token, rollen } = useRollen();
  return (
    <Paneel
      titel="Verlauf"
      meta={`${berichte.length} ${berichte.length === 1 ? 'frühere Freigabe' : 'frühere Freigaben'}`}
    >
      <ol style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {berichte.map((b) => (
          <li
            key={b.id}
            data-lfh="lagebericht-verlauf"
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'center',
              columnGap: token.marginSM,
              paddingInline: token.padding,
              borderBlockEnd: `1px solid ${rollen.flaeche3}`,
            }}
          >
            <span style={{ ...monoStil('monoKlein', 500), color: rollen.text2 }}>
              <ZeitAnzeige wert={b.zeitstand} />
            </span>
            <span style={{ flex: '1 1 12em', minWidth: 0 }}>
              <KennungsLink to={lageberichtDetailPfad(einsatzId, b.id)}>{b.titel}</KennungsLink>
            </span>
            <span style={{ ...monoStil('monoFein'), color: rollen.gedaempft }}>v{b.version}</span>
          </li>
        ))}
      </ol>
    </Paneel>
  );
}
