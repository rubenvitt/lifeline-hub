import { Button, Space } from 'antd';
import { useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { gibFahrzeugFrei, gibPersonalFrei } from '../../api/einheiten';
import { gibBesatzungFrei, ordneBesatzungZu, updateDisposition } from '../../api/einsatzFahrzeuge';
import { listeFahrzeugStatus } from '../../api/fahrzeugStatus';
import { einsatzKeys, globalKeys } from '../../api/queryKeys';
import type { Einheit, EinsatzFahrzeug, EinsatzPersonal, StaerkePosition } from '../../api/types';
import { kraefteText } from '../../anzeige/staerke';
import {
  Augenbraue,
  monoStil,
  Paneel,
  PaneelZustand,
  useRollen,
} from '../../components/instrument';
import { KennungsLink } from '../../components/kennungsLink';
import { MenueAusloeser } from '../../components/MenueAusloeser';
import { RechteHinweis, ZeilenFehler } from '../../components/SpeicherHinweis';
import StatusTag from '../../components/StatusTag';
import StatusWahl from '../../components/StatusWahl';
import { useZeilenFehler, type ZeilenGrund } from '../../components/useZeilenFehler';
import { FahrzeugZeichen } from '../../kraefte/EinheitZeichen';
import { funktionText } from '../../kraefte/einsatzfunktionKern';
import { fmsStatusOptionen } from '../../kraefte/fmsTableauKern';
import {
  besatzungText,
  fremdText,
  mittelDerEinheit,
  needsOhneFahrzeugKnoten,
  type FahrzeugImBaum,
  type PersonImBaum,
} from '../../kraefte/kraeftebaumKern';
import { PositionsMarken } from '../../kraefte/KraeftebaumZelle';
import { fmsEtikett } from '../../kraefte/meldebildRaster';
import { fahrzeugStatusDarstellung } from '../../kraefte/mittelStatus';
import { einsatzkraftPfad, fahrzeugePfad } from '../../routing/deeplinks';
import { besatzungsUrteil, statusKategorie } from '../../theme/statusFarben';
import {
  besatzungGrund,
  buildPersonMenuItems,
  type EinheitRechte,
  type PersonMenuKey,
} from './einheitAnsichtKern';

/**
 * Paneel „Fahrzeuge und Besatzung“ der Einheit-Ansicht (LLH-1036 Teil II, design.md D5, D9, D10,
 * Spec `einheit-ansicht`). Ersetzt die Paneele „Personal“ und „Fahrzeuge“: je Fahrzeug Zeichen,
 * Funkrufname, Typ, FMS-Status, Besatzung Ist/Soll mit Wort und die Personen darauf, darunter
 * „Ohne Fahrzeug“. Die Rechnung ist die des Meldebilds (`mittelDerEinheit`, Regel „Eine
 * Baumlogik der Kräfte“, `frontend/AGENTS.md`); hier wird nichts gezählt.
 *
 * BESATZUNG NUR MIT FREIGABE PERSONAL UND FAHRZEUGE (Entscheidung 13.10.2026 Punkt 2): fehlt eine,
 * stehen Fahrzeuge und Mitglieder flach aus dem Einheit-DTO, mit „Ohne Besatzung · Modul …
 * gesperrt“, ohne Besatzungswege, ohne FMS-Wahl und ohne Link ins gesperrte Modul.
 *
 * Was bedienbar ist, sagt allein {@link EinheitRechte}. Lösen ist umkehrbar und wirkt ohne
 * Rückfrage (Regel „Destruktiv ist nicht gleich destruktiv“); jeder Grund steht an seiner Zeile
 * (`useZeilenFehler`, Schlüssel `ep_id` bzw. `ef_id`), kein Toast.
 */

interface FahrzeugeBesatzungProps {
  einsatzId: number;
  einheit: Einheit;
  einheiten: readonly Einheit[];
  /** Einsatzpersonal; nur mit `rechte.hasBesatzung` abgefragt, sonst `undefined`. */
  personal: readonly EinsatzPersonal[] | undefined;
  /** Einsatzfahrzeuge; ebenso. */
  fahrzeuge: readonly EinsatzFahrzeug[] | undefined;
  rechte: EinheitRechte;
  /**
   * Stand der beiden Listen, wenn die Besatzung erscheinen soll: solange sie laden, steht der
   * Ladezustand statt einer flachen Liste, die gleich darauf umbaute (Zeilen und Menüs sprängen
   * unter dem Zeiger); scheitert eine, stehen Fehler und die Mitglieder flach.
   */
  listState?: 'daten' | 'laden' | 'fehler';
  onReload?: () => void;
  /** „Als Einheitsführer“: derselbe Weg wie die Kopfzeile, genau `{ fuehrer_id }` (D1). */
  onSetFuehrer: (epId: number) => Promise<unknown>;
  /** Die Auswahlfelder „Person zuordnen …“ und „Fahrzeug zuordnen …“ am Ende (D2). */
  children?: ReactNode;
}

/** Eine Person, wie das Menü und die Zeile sie brauchen — aus dem Kern oder flach aus dem DTO. */
interface PersonRow {
  epId: number;
  name: string;
  position: StaerkePosition | null;
  isFuehrer: boolean;
  funktion: string | null;
  fahrzeugId: number | null;
  faehrtAuf: string | null;
}

const fromBaum = (x: PersonImBaum): PersonRow => ({
  epId: x.person.id,
  name: x.person.name,
  position: x.person.staerke_position ?? null,
  isFuehrer: x.isFuehrer,
  funktion: funktionText(x.person),
  fahrzeugId: x.person.fahrzeug_id ?? null,
  faehrtAuf: x.faehrtAuf,
});

const fromMitglied = (m: Einheit['personal_mitglieder'][number]): PersonRow => ({
  epId: m.ep_id,
  name: m.name,
  position: m.staerke_position ?? null,
  isFuehrer: m.ist_fuehrer,
  funktion: funktionText(m),
  fahrzeugId: null,
  faehrtAuf: null,
});

export default function FahrzeugeBesatzung({
  einsatzId,
  einheit,
  einheiten,
  personal,
  fahrzeuge,
  rechte,
  listState = 'daten',
  onReload = () => {},
  onSetFuehrer,
  children,
}: FahrzeugeBesatzungProps) {
  const qc = useQueryClient();
  const { token, rollen } = useRollen();
  const einheitId = einheit.id;
  const reason = besatzungGrund(rechte);
  /**
   * Die Besatzung steht erst, wenn beide Listen da sind. Solange sie laden, steht nur der
   * Ladezustand; fehlt eine (Fehler), stehen die Mitglieder flach aus dem DTO.
   */
  const mittel =
    rechte.hasBesatzung && personal && fahrzeuge
      ? mittelDerEinheit(einheitId, { personal, fahrzeuge, material: [], einheiten })
      : null;
  // Besatzungswege und FMS-Wahl nur, wo die Besatzung zu sehen ist (D5).
  const canBesatzung = rechte.canEditBesatzung && mittel != null;

  const katalogQuery = useQuery({
    queryKey: globalKeys.fahrzeugStatus(),
    queryFn: listeFahrzeugStatus,
    enabled: mittel != null && mittel.fahrzeuge.length > 0,
  });
  const katalog = katalogQuery.data ?? [];
  const ankerByStatus = new Map(katalog.map((s) => [s.id, s.fms_anker]));

  function invalidate() {
    for (const key of [
      einsatzKeys.einheiten(einsatzId),
      einsatzKeys.personal(einsatzId),
      einsatzKeys.fahrzeuge(einsatzId),
      einsatzKeys.etb(einsatzId),
    ])
      void qc.invalidateQueries({ queryKey: key });
  }

  const personErrors = useZeilenFehler<number>();
  const fahrzeugErrors = useZeilenFehler<number>();
  /*
   * Was je Zeile gerade läuft (`p<ep_id>`, `f<ef_id>`): die Rückmeldung steht am Auslöser vor der
   * Antwort, auch bei zwei Aktionen an zwei Zeilen zugleich (eine Mutation kennt nur ihre letzte).
   */
  const [pending, setPending] = useState<ReadonlySet<string>>(() => new Set());
  const markPending = (key: string, on: boolean) =>
    setPending((prev) => {
      const next = new Set(prev);
      if (on) next.add(key);
      else next.delete(key);
      return next;
    });
  const trackPerson = (epId: number) => ({
    start: () => {
      personErrors.beginne(epId);
      markPending(`p${epId}`, true);
    },
    end: () => markPending(`p${epId}`, false),
  });
  const trackFahrzeug = (efId: number) => ({
    start: () => {
      fahrzeugErrors.beginne(efId);
      markPending(`f${efId}`, true);
    },
    end: () => markPending(`f${efId}`, false),
  });

  const personalLoesen = useMutation({
    mutationFn: (epId: number) => gibPersonalFrei(einsatzId, einheitId, epId),
    onMutate: (epId) => trackPerson(epId).start(),
    onSuccess: invalidate,
    onError: (e, epId) => personErrors.melde(epId, e, 'Lösen fehlgeschlagen'),
    onSettled: (_d, _e, epId) => trackPerson(epId).end(),
  });
  const besatzungZuordnen = useMutation({
    mutationFn: (v: { efId: number; epId: number }) => ordneBesatzungZu(einsatzId, v.efId, v.epId),
    onMutate: (v) => trackPerson(v.epId).start(),
    onSuccess: invalidate,
    onError: (e, v) => personErrors.melde(v.epId, e, 'Nicht auf das Fahrzeug gesetzt'),
    onSettled: (_d, _e, v) => trackPerson(v.epId).end(),
  });
  const besatzungLoesen = useMutation({
    mutationFn: (v: { efId: number; epId: number }) => gibBesatzungFrei(einsatzId, v.efId, v.epId),
    onMutate: (v) => trackPerson(v.epId).start(),
    onSuccess: invalidate,
    onError: (e, v) => personErrors.melde(v.epId, e, 'Lösen fehlgeschlagen'),
    onSettled: (_d, _e, v) => trackPerson(v.epId).end(),
  });
  const fahrzeugLoesen = useMutation({
    mutationFn: (efId: number) => gibFahrzeugFrei(einsatzId, einheitId, efId),
    onMutate: (efId) => trackFahrzeug(efId).start(),
    onSuccess: invalidate,
    onError: (e, efId) => fahrzeugErrors.melde(efId, e, 'Lösen fehlgeschlagen'),
    onSettled: (_d, _e, efId) => trackFahrzeug(efId).end(),
  });
  const fmsStatus = useMutation({
    mutationFn: (v: { efId: number; statusId: number }) =>
      updateDisposition(einsatzId, v.efId, { status_id: v.statusId }),
    onMutate: (v) => trackFahrzeug(v.efId).start(),
    onSuccess: invalidate,
    onError: (e, v) => fahrzeugErrors.melde(v.efId, e, 'Status nicht geändert'),
    onSettled: (_d, _e, v) => trackFahrzeug(v.efId).end(),
  });

  function handleSelect(p: PersonRow, key: PersonMenuKey) {
    if (key === 'fuehrer') {
      const row = trackPerson(p.epId);
      row.start();
      onSetFuehrer(p.epId)
        .catch((e: unknown) => personErrors.melde(p.epId, e, 'Einheitsführer nicht gesetzt'))
        .finally(row.end);
    } else if (key === 'aus-einheit') {
      personalLoesen.mutate(p.epId);
    } else if (key === 'vom-fahrzeug') {
      if (p.fahrzeugId != null) besatzungLoesen.mutate({ efId: p.fahrzeugId, epId: p.epId });
    } else {
      besatzungZuordnen.mutate({ efId: Number(key.slice('auf:'.length)), epId: p.epId });
    }
  }

  // Die Fahrzeuge der Einheit als Ziele „Auf …“: dieselbe Folge wie im Paneel.
  const menuFahrzeuge = (mittel?.fahrzeuge ?? []).map((f) => ({
    id: f.fahrzeug.id,
    funkrufname: f.fahrzeug.funkrufname,
  }));

  /** Der Grund unter einer Zeile, über die ganze Breite. */
  const errorRow = (g: ZeilenGrund | null) =>
    g && (
      <div style={{ flexBasis: '100%' }}>
        <ZeilenFehler fehler={g.fehler} fallback={g.fallback} />
      </div>
    );

  /**
   * Bedienziel-Boden einer handgebauten Zeile (LFH-365): Steuerhöhe plus Polsterung. Zwei Zeilen
   * und die Teile einer umbrochenen Zeile stehen `marginSM` auseinander (7/11/16 px), damit Link
   * und Aktion untereinander den Aktionsabstand halten (Leitlinie ≥ 8 / ≥ 16).
   */
  const rowStyle = {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    columnGap: token.marginXS,
    rowGap: token.marginSM,
    minHeight: token.controlHeight,
    paddingBlock: token.marginSM / 2,
  } as const;
  const secondaryText = (parts: readonly (string | null | undefined)[]) => {
    const text = parts.filter(Boolean).join(' · ');
    return text ? <span style={{ fontSize: 12, color: rollen.gedaempft }}>{text}</span> : null;
  };

  const renderPersonRow = (p: PersonRow) => (
    <div key={p.epId} data-lfh="einheit-person" style={rowStyle}>
      <span style={{ display: 'inline-flex', gap: token.marginXXS }}>
        <PositionsMarken
          person={{ position: p.position, isFuehrer: p.isFuehrer, faehrtAuf: p.faehrtAuf }}
        />
      </span>
      <span data-lfh="einheit-person-name" style={{ minWidth: 0 }}>
        {rechte.hasPersonalLink ? (
          <KennungsLink to={einsatzkraftPfad(einsatzId, p.epId)}>{p.name}</KennungsLink>
        ) : (
          p.name
        )}
      </span>
      {secondaryText([p.funktion, p.faehrtAuf ? `fährt auf ${p.faehrtAuf}` : null])}
      <span style={{ marginInlineStart: 'auto' }}>
        <MenueAusloeser<PersonMenuKey>
          eintraege={buildPersonMenuItems(
            { isFuehrer: p.isFuehrer, fahrzeugId: p.fahrzeugId },
            menuFahrzeuge,
            { canEditEinheit: rechte.canEditEinheit, canEditBesatzung: canBesatzung },
          )}
          zugaenglicherName={`Aktionen zu Person ${p.name}`}
          laeuft={pending.has(`p${p.epId}`)}
          onWahl={(key) => handleSelect(p, key)}
        />
      </span>
      {errorRow(personErrors.grund(p.epId))}
    </div>
  );

  /** Name eines Fahrzeugs, als Sprung in die Fahrzeugzeile, wenn das Modul offen ist. */
  const renderFunkrufname = (efId: number, name: string) => (
    <span style={monoStil(13)}>
      {rechte.hasFahrzeugLink ? (
        <KennungsLink to={fahrzeugePfad(einsatzId, { fahrzeug: efId })}>{name}</KennungsLink>
      ) : (
        name
      )}
    </span>
  );

  /**
   * Rechts: Status und rot „Aus Einheit lösen“, abgesetzt (`size="middle"`). Im Baum ist der Status
   * die FMS-Wahl, flach aus dem DTO nur das Wort. Die Wahl steht im Quelltext in derselben Reihe
   * wie der rote Knopf, damit der Abstands-Wächter sie sieht
   * (`components/aktionsabstand.guard.test.ts`, LLH-1268).
   */
  const renderFahrzeugActions = (
    efId: number,
    status: { wahl: FahrzeugImBaum['fahrzeug'] } | { wort: ReactNode },
  ) => {
    // Gesperrt ist nur die eigene Zeile: eine Wahl an einem anderen Fahrzeug geht hinaus.
    const isPending = pending.has(`f${efId}`);
    return (
      <Space size="middle" wrap style={{ marginInlineStart: 'auto' }}>
        {'wahl' in status ? (
          <StatusWahl<number>
            darstellung={fahrzeugStatusDarstellung(
              status.wahl,
              status.wahl.status_id != null ? ankerByStatus.get(status.wahl.status_id) : null,
            )}
            farbe={status.wahl.status_farbe ?? null}
            aktuell={status.wahl.status_id ?? null}
            optionen={fmsStatusOptionen(katalog)}
            kennung={status.wahl.funkrufname}
            laeuft={isPending}
            darfSchreiben={canBesatzung}
            onWaehlen={(statusId) => {
              if (!isPending) fmsStatus.mutate({ efId, statusId });
            }}
          />
        ) : (
          status.wort
        )}
        {rechte.canEditEinheit && (
          <Button danger loading={isPending} onClick={() => fahrzeugLoesen.mutate(efId)}>
            Aus Einheit lösen
          </Button>
        )}
      </Space>
    );
  };

  const renderFahrzeugRow = (f: FahrzeugImBaum) => {
    const ef = f.fahrzeug;
    return (
      <div data-lfh="einheit-fahrzeug" style={rowStyle}>
        <FahrzeugZeichen
          tz={{
            fahrzeugtyp: ef.fahrzeugtyp ?? null,
            traegerorganisation: ef.traegerorganisation ?? null,
            opta: ef.opta ?? null,
            fachaufgabe: ef.tz_fachaufgabe ?? null,
            organisation: ef.tz_organisation ?? null,
          }}
        />
        {renderFunkrufname(ef.id, ef.funkrufname)}
        {secondaryText([ef.fahrzeugtyp])}
        <span
          data-lfh="einheit-besatzung"
          style={{
            display: 'inline-flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            gap: token.marginXS,
          }}
        >
          {(f.urteil === 'erfuellt' || f.urteil === 'unterbesetzt') && (
            <StatusTag darstellung={besatzungsUrteil[f.urteil]} />
          )}
          <span style={monoStil(12)}>{besatzungText(f)}</span>
          {secondaryText([fremdText(f)])}
        </span>
        {renderFahrzeugActions(ef.id, { wahl: ef })}
        {errorRow(fahrzeugErrors.grund(ef.id))}
      </div>
    );
  };

  /** Personen unter einem Fahrzeug bzw. unter „Ohne Fahrzeug“: eingerückt. */
  const indented = (personen: readonly PersonRow[]) =>
    personen.length > 0 && (
      <div style={{ paddingInlineStart: token.paddingLG }}>{personen.map(renderPersonRow)}</div>
    );

  let content: ReactNode;
  if (mittel) {
    const ohne = mittel.ohneFahrzeug.map(fromBaum);
    content = (
      <>
        {mittel.fahrzeuge.map((f) => (
          <div key={f.fahrzeug.id} role="group" aria-label={`Fahrzeug ${f.fahrzeug.funkrufname}`}>
            {renderFahrzeugRow(f)}
            {indented(f.besatzung.map(fromBaum))}
          </div>
        ))}
        {needsOhneFahrzeugKnoten(mittel) ? (
          <div role="group" aria-label="Ohne Fahrzeug">
            <div style={rowStyle}>
              <Augenbraue style={{ fontSize: 11 }}>Ohne Fahrzeug</Augenbraue>
              <span style={{ ...monoStil(11), color: rollen.gedaempft }}>
                · {kraefteText(ohne.length)}
              </span>
            </div>
            {indented(ohne)}
          </div>
        ) : (
          ohne.map(renderPersonRow)
        )}
      </>
    );
  } else {
    // Flach aus dem DTO (D5): Fahrzeuge mit Status als Wort, dann die Mitglieder.
    content = (
      <>
        {einheit.fahrzeug_mitglieder.map((m) => (
          <div key={m.ef_id} data-lfh="einheit-fahrzeug" style={rowStyle}>
            <FahrzeugZeichen
              tz={{
                fahrzeugtyp: m.fahrzeugtyp ?? null,
                traegerorganisation: null,
                opta: null,
                fachaufgabe: null,
                organisation: null,
              }}
            />
            {renderFunkrufname(m.ef_id, m.funkrufname)}
            {secondaryText([m.fahrzeugtyp])}
            {renderFahrzeugActions(m.ef_id, {
              wort: (
                <StatusTag
                  darstellung={
                    m.status
                      ? {
                          ...statusKategorie[m.status.kategorie],
                          label: fmsEtikett(m.status.label, m.status.fms_anker),
                        }
                      : { rolle: 'neutral', label: 'kein Status' }
                  }
                  farbe={m.status?.farbe ?? null}
                />
              ),
            })}
            {errorRow(fahrzeugErrors.grund(m.ef_id))}
          </div>
        ))}
        {einheit.personal_mitglieder.map((m) => renderPersonRow(fromMitglied(m)))}
      </>
    );
  }

  const isEmpty =
    einheit.fahrzeug_mitglieder.length === 0 && einheit.personal_mitglieder.length === 0;

  return (
    <Paneel
      titel="Fahrzeuge und Besatzung"
      meta={`${einheit.fahrzeug_mitglieder.length} Fzg. · ${kraefteText(einheit.personal_mitglieder.length)}`}
      koerperPolster
    >
      {reason && (
        <div style={{ marginBottom: token.marginSM }}>
          <RechteHinweis sichtbar marke="Ohne Besatzung" text={reason} />
        </div>
      )}
      {rechte.hasBesatzung && listState !== 'daten' && (
        <PaneelZustand
          zustand={listState}
          titel="Fahrzeuge und Besatzung"
          leerText=""
          onNeuladen={onReload}
        >
          {null}
        </PaneelZustand>
      )}
      {rechte.hasBesatzung && listState === 'laden' ? null : isEmpty ? (
        <span style={{ color: rollen.gedaempft }}>—</span>
      ) : (
        content
      )}
      {children}
    </Paneel>
  );
}
