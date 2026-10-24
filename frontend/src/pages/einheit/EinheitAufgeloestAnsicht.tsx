import { Breadcrumb } from 'antd';
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import type { Einheit, EinsatzAnzeige, LetztePerson, LetztesFahrzeug } from '../../api/types';
import { useAnzeigeKonventionen } from '../../anzeige/AnzeigeKonventionenContext';
import { kraefteText } from '../../anzeige/staerke';
import EinsatzSeite from '../../components/EinsatzSeite';
import {
  Augenbraue,
  Datenfeld,
  Datenraster,
  monoStil,
  Paneel,
  useRollen,
} from '../../components/instrument';
import { KennungsLink } from '../../components/kennungsLink';
import { funktionText } from '../../kraefte/einsatzfunktionKern';
import KraftZeitachse from '../../kraefte/KraftZeitachse';
import { einheitenPfad, einsatzkraftPfad, fahrzeugePfad } from '../../routing/deeplinks';
import { gliedereLetzteBesetzung, type EinheitRechte } from './einheitAnsichtKern';

/** Satz an Stelle der Kräfte, wenn die Einheit vor dem Festhalten aufgelöst wurde. */
export const BESETZUNG_NICHT_FESTGEHALTEN =
  'Letzte Besetzung nicht festgehalten: die Einheit wurde aufgelöst, bevor das System sie festhielt.';

interface EinheitAufgeloestAnsichtProps {
  einsatzId: number;
  einsatz: EinsatzAnzeige;
  /** Eine aufgelöste Einheit aus `GET …/einheiten?aufgeloeste=1` (`aufgeloest_at` gesetzt). */
  einheit: Einheit;
  /** Nur die Links zählen: `hasPersonalLink`, `hasFahrzeugLink`. */
  rechte: Pick<EinheitRechte, 'hasPersonalLink' | 'hasFahrzeugLink'>;
  /** `dataUpdatedAt` der Liste der aufgelösten Einheiten. */
  stand: number;
}

/**
 * Lesende Ansicht einer aufgelösten Einheit (LLH-1266, Change
 * `oq1yp0k5-aufgeloeste-einheit-lesend`, design.md D3, Spec `einheit-ansicht`, „Aufgelöste Einheit
 * nur lesend“): Kopf mit „aufgelöst“ und Zeitpunkt, Kopfdaten, die beim Auflösen festgehaltene
 * Besatzung nach Fahrzeugen, Material und Zeitachse. Kein Bedienelement außer Links, auch mit
 * Schreibrecht: der Server lehnt jeden Schreibweg an einer aufgelösten Einheit ab (409), und die
 * Kräfte gehören inzwischen anderswohin. Darum liest die Ansicht nur `letzte_besetzung`, nie die
 * Live-Listen von Personal und Fahrzeugen.
 */
export default function EinheitAufgeloestAnsicht({
  einsatzId,
  einsatz,
  einheit,
  rechte,
  stand,
}: EinheitAufgeloestAnsichtProps) {
  const { token, rollen } = useRollen();
  const { zeitKurz } = useAnzeigeKonventionen();
  const aufgeloest = einheit.aufgeloest_at ? zeitKurz(einheit.aufgeloest_at) : '—';
  const besetzung = einheit.letzte_besetzung;

  const zeile = {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    columnGap: token.marginXS,
    minHeight: token.controlHeight,
  } as const;
  const nebentext = (text: string | null | undefined) =>
    text ? <span style={{ fontSize: 12, color: rollen.gedaempft }}>{text}</span> : null;
  const leer = (text: string) => (
    <span style={{ color: rollen.gedaempft, fontSize: 12 }}>{text}</span>
  );

  const person = (p: LetztePerson) => (
    <li key={p.ep_id} data-lfh="aufgeloest-person" style={zeile}>
      <span>
        {rechte.hasPersonalLink ? (
          <KennungsLink to={einsatzkraftPfad(einsatzId, p.ep_id)}>{p.name}</KennungsLink>
        ) : (
          p.name
        )}
      </span>
      {p.ist_fuehrer && (
        <span style={{ ...monoStil(11), color: rollen.text2 }} title="Einheitsführer">
          EF
        </span>
      )}
      {nebentext(funktionText(p))}
    </li>
  );
  const personen = (liste: readonly LetztePerson[]) =>
    liste.length > 0 && (
      <ul style={{ listStyle: 'none', margin: 0, padding: 0, paddingInlineStart: token.paddingLG }}>
        {liste.map(person)}
      </ul>
    );
  const fahrzeug = (f: LetztesFahrzeug) => (
    <span style={monoStil(13)}>
      {rechte.hasFahrzeugLink ? (
        <KennungsLink to={fahrzeugePfad(einsatzId, { fahrzeug: f.ef_id })}>
          {f.funkrufname}
        </KennungsLink>
      ) : (
        f.funkrufname
      )}
    </span>
  );

  let kraefte: ReactNode;
  if (!besetzung) {
    kraefte = (
      <Paneel titel="Letzte Besatzung" koerperPolster>
        {leer(BESETZUNG_NICHT_FESTGEHALTEN)}
      </Paneel>
    );
  } else {
    const { fahrzeuge, ohneFahrzeug } = gliedereLetzteBesetzung(besetzung);
    kraefte = (
      <>
        <Paneel
          titel="Letzte Besatzung"
          meta={`${besetzung.fahrzeuge.length} Fzg. · ${kraefteText(besetzung.personal.length)}`}
          koerperPolster
        >
          {fahrzeuge.length === 0 && ohneFahrzeug.length === 0 && leer('Keine Kräfte')}
          {fahrzeuge.map(({ fahrzeug: f, besatzung }) => (
            <div key={f.ef_id} role="group" aria-label={`Fahrzeug ${f.funkrufname}`}>
              <div data-lfh="aufgeloest-fahrzeug" style={zeile}>
                {fahrzeug(f)}
                {nebentext(f.fahrzeugtyp)}
              </div>
              {personen(besatzung)}
            </div>
          ))}
          {ohneFahrzeug.length > 0 && (
            <div role="group" aria-label="Ohne Fahrzeug">
              {fahrzeuge.length > 0 && (
                <div style={zeile}>
                  <Augenbraue style={{ fontSize: 11 }}>Ohne Fahrzeug</Augenbraue>
                </div>
              )}
              {personen(ohneFahrzeug)}
            </div>
          )}
        </Paneel>
        <Paneel titel="Material" meta={`${besetzung.material.length} Posten`} koerperPolster>
          {besetzung.material.length === 0 ? (
            leer('Kein Material')
          ) : (
            <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
              {besetzung.material.map((m) => (
                <li key={m.em_id} data-lfh="aufgeloest-material" style={zeile}>
                  {m.bezeichnung}
                  <span style={monoStil(13)}>×{m.menge}</span>
                </li>
              ))}
            </ul>
          )}
        </Paneel>
      </>
    );
  }

  return (
    <EinsatzSeite
      breadcrumb={
        <Breadcrumb
          items={[
            { title: <Link to="/einsaetze">Einsätze</Link> },
            { title: einsatz.bezeichnung },
            { title: <Link to={einheitenPfad(einsatzId)}>Einheiten</Link> },
            { title: einheit.name },
          ]}
        />
      }
      titel={einheit.name}
      meta={
        <>
          {einheit.typ_label && <>{einheit.typ_label} · </>}
          aufgelöst {aufgeloest}
        </>
      }
      dataUpdatedAt={stand}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: token.margin }}>
        <Paneel titel="Kopfdaten">
          <Datenraster beschriftung="Kopfdaten">
            <Datenfeld label="Aufgelöst" mono>
              {aufgeloest}
            </Datenfeld>
            <Datenfeld label="Typ">{einheit.typ_label ?? '—'}</Datenfeld>
            <Datenfeld label="Abschnitt">{einheit.abschnitt_name ?? '—'}</Datenfeld>
            <Datenfeld label="Funkrufname" mono>
              {einheit.funkrufname ?? '—'}
            </Datenfeld>
            <Datenfeld label="Bemerkung" breit>
              {einheit.bemerkung ?? '—'}
            </Datenfeld>
          </Datenraster>
        </Paneel>

        {kraefte}

        {/* Eintreffen und Entlassung bleiben an der Einheit (Spec `kraefte-entlassung`). */}
        <Paneel titel="Zeitachse" koerperPolster>
          <KraftZeitachse
            einsatzId={einsatzId}
            art="einheit"
            id={einheit.id}
            kennung={einheit.name}
            darfSchreiben={false}
            lesend
          />
        </Paneel>
      </div>
    </EinsatzSeite>
  );
}
