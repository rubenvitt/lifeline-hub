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
  listenZustand?: 'daten' | 'laden' | 'fehler';
  onNeuladen?: () => void;
  /** „Als Einheitsführer“: derselbe Weg wie die Kopfzeile, genau `{ fuehrer_id }` (D1). */
  onSetFuehrer: (epId: number) => Promise<unknown>;
  /** Die Auswahlfelder „Person zuordnen …“ und „Fahrzeug zuordnen …“ am Ende (D2). */
  children?: ReactNode;
}

/** Eine Person, wie das Menü und die Zeile sie brauchen — aus dem Kern oder flach aus dem DTO. */
interface PersonZeileDaten {
  epId: number;
  name: string;
  position: StaerkePosition | null;
  isFuehrer: boolean;
  funktion: string | null;
  fahrzeugId: number | null;
  faehrtAuf: string | null;
}

const ausBaum = (x: PersonImBaum): PersonZeileDaten => ({
  epId: x.person.id,
  name: x.person.name,
  position: x.person.staerke_position ?? null,
  isFuehrer: x.isFuehrer,
  funktion: funktionText(x.person),
  fahrzeugId: x.person.fahrzeug_id ?? null,
  faehrtAuf: x.faehrtAuf,
});

const ausMitglied = (m: Einheit['personal_mitglieder'][number]): PersonZeileDaten => ({
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
  listenZustand = 'daten',
  onNeuladen = () => {},
  onSetFuehrer,
  children,
}: FahrzeugeBesatzungProps) {
  const qc = useQueryClient();
  const { token, rollen } = useRollen();
  const einheitId = einheit.id;
  const grund = besatzungGrund(rechte);
  /** Die Besatzung steht erst, wenn beide Listen da sind; bis dahin flach, ohne Hinweis. */
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
  const ankerJeStatus = new Map(katalog.map((s) => [s.id, s.fms_anker]));

  function invalidate() {
    for (const key of [
      einsatzKeys.einheiten(einsatzId),
      einsatzKeys.personal(einsatzId),
      einsatzKeys.fahrzeuge(einsatzId),
      einsatzKeys.etb(einsatzId),
    ])
      void qc.invalidateQueries({ queryKey: key });
  }

  const personZeilen = useZeilenFehler<number>();
  const fahrzeugZeilen = useZeilenFehler<number>();
  /*
   * Was je Zeile gerade läuft (`p<ep_id>`, `f<ef_id>`): die Rückmeldung steht am Auslöser vor der
   * Antwort, auch bei zwei Aktionen an zwei Zeilen zugleich (eine Mutation kennt nur ihre letzte).
   */
  const [laufend, setLaufend] = useState<ReadonlySet<string>>(() => new Set());
  const markiere = (key: string, an: boolean) =>
    setLaufend((alt) => {
      const neu = new Set(alt);
      if (an) neu.add(key);
      else neu.delete(key);
      return neu;
    });
  const personLauf = (epId: number) => ({
    beginne: () => {
      personZeilen.beginne(epId);
      markiere(`p${epId}`, true);
    },
    ende: () => markiere(`p${epId}`, false),
  });
  const fahrzeugLauf = (efId: number) => ({
    beginne: () => {
      fahrzeugZeilen.beginne(efId);
      markiere(`f${efId}`, true);
    },
    ende: () => markiere(`f${efId}`, false),
  });

  const personalFrei = useMutation({
    mutationFn: (epId: number) => gibPersonalFrei(einsatzId, einheitId, epId),
    onMutate: (epId) => personLauf(epId).beginne(),
    onSuccess: invalidate,
    onError: (e, epId) => personZeilen.melde(epId, e, 'Lösen fehlgeschlagen'),
    onSettled: (_d, _e, epId) => personLauf(epId).ende(),
  });
  const besatzungZu = useMutation({
    mutationFn: (v: { efId: number; epId: number }) => ordneBesatzungZu(einsatzId, v.efId, v.epId),
    onMutate: (v) => personLauf(v.epId).beginne(),
    onSuccess: invalidate,
    onError: (e, v) => personZeilen.melde(v.epId, e, 'Nicht auf das Fahrzeug gesetzt'),
    onSettled: (_d, _e, v) => personLauf(v.epId).ende(),
  });
  const besatzungFrei = useMutation({
    mutationFn: (v: { efId: number; epId: number }) => gibBesatzungFrei(einsatzId, v.efId, v.epId),
    onMutate: (v) => personLauf(v.epId).beginne(),
    onSuccess: invalidate,
    onError: (e, v) => personZeilen.melde(v.epId, e, 'Lösen fehlgeschlagen'),
    onSettled: (_d, _e, v) => personLauf(v.epId).ende(),
  });
  const fahrzeugFrei = useMutation({
    mutationFn: (efId: number) => gibFahrzeugFrei(einsatzId, einheitId, efId),
    onMutate: (efId) => fahrzeugLauf(efId).beginne(),
    onSuccess: invalidate,
    onError: (e, efId) => fahrzeugZeilen.melde(efId, e, 'Lösen fehlgeschlagen'),
    onSettled: (_d, _e, efId) => fahrzeugLauf(efId).ende(),
  });
  const fmsStatus = useMutation({
    mutationFn: (v: { efId: number; statusId: number }) =>
      updateDisposition(einsatzId, v.efId, { status_id: v.statusId }),
    onMutate: (v) => fahrzeugZeilen.beginne(v.efId),
    onSuccess: invalidate,
    onError: (e, v) => fahrzeugZeilen.melde(v.efId, e, 'Status nicht geändert'),
  });

  function waehle(p: PersonZeileDaten, key: PersonMenuKey) {
    if (key === 'fuehrer') {
      const zeile = personLauf(p.epId);
      zeile.beginne();
      onSetFuehrer(p.epId)
        .catch((e: unknown) => personZeilen.melde(p.epId, e, 'Einheitsführer nicht gesetzt'))
        .finally(zeile.ende);
    } else if (key === 'aus-einheit') {
      personalFrei.mutate(p.epId);
    } else if (key === 'vom-fahrzeug') {
      if (p.fahrzeugId != null) besatzungFrei.mutate({ efId: p.fahrzeugId, epId: p.epId });
    } else {
      besatzungZu.mutate({ efId: Number(key.slice('auf:'.length)), epId: p.epId });
    }
  }

  // Die Fahrzeuge der Einheit als Ziele „Auf …“: dieselbe Folge wie im Paneel.
  const menueFahrzeuge = (mittel?.fahrzeuge ?? []).map((f) => ({
    id: f.fahrzeug.id,
    funkrufname: f.fahrzeug.funkrufname,
  }));

  /** Der Grund unter einer Zeile, über die ganze Breite. */
  const fehlerZeile = (g: ZeilenGrund | null) =>
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
  const zeilenStil = {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    columnGap: token.marginXS,
    rowGap: token.marginSM,
    minHeight: token.controlHeight,
    paddingBlock: token.marginSM / 2,
  } as const;
  const nebentext = (teile: readonly (string | null | undefined)[]) => {
    const text = teile.filter(Boolean).join(' · ');
    return text ? <span style={{ fontSize: 12, color: rollen.gedaempft }}>{text}</span> : null;
  };

  const personZeile = (p: PersonZeileDaten) => (
    <div key={p.epId} data-lfh="einheit-person" style={zeilenStil}>
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
      {nebentext([p.funktion, p.faehrtAuf ? `fährt auf ${p.faehrtAuf}` : null])}
      <span style={{ marginInlineStart: 'auto' }}>
        <MenueAusloeser<PersonMenuKey>
          eintraege={buildPersonMenuItems(
            { isFuehrer: p.isFuehrer, fahrzeugId: p.fahrzeugId },
            menueFahrzeuge,
            { canEditEinheit: rechte.canEditEinheit, canEditBesatzung: canBesatzung },
          )}
          zugaenglicherName={`Aktionen zu Person ${p.name}`}
          laeuft={laufend.has(`p${p.epId}`)}
          onWahl={(key) => waehle(p, key)}
        />
      </span>
      {fehlerZeile(personZeilen.grund(p.epId))}
    </div>
  );

  /** Name eines Fahrzeugs, als Sprung in die Fahrzeugzeile, wenn das Modul offen ist. */
  const funkrufname = (efId: number, name: string) => (
    <span style={monoStil(13)}>
      {rechte.hasFahrzeugLink ? (
        <KennungsLink to={fahrzeugePfad(einsatzId, { fahrzeug: efId })}>{name}</KennungsLink>
      ) : (
        name
      )}
    </span>
  );

  /** Rechts: Status (bei Recht die Wahl) und rot „Aus Einheit lösen“, abgesetzt (`size="middle"`). */
  const fahrzeugAktionen = (efId: number, status: ReactNode) => (
    <Space size="middle" wrap style={{ marginInlineStart: 'auto' }}>
      {status}
      {rechte.canEditEinheit && (
        <Button danger loading={laufend.has(`f${efId}`)} onClick={() => fahrzeugFrei.mutate(efId)}>
          Aus Einheit lösen
        </Button>
      )}
    </Space>
  );

  const fahrzeugZeile = (f: FahrzeugImBaum) => {
    const ef = f.fahrzeug;
    const laeuft = fmsStatus.isPending && fmsStatus.variables?.efId === ef.id;
    return (
      <div data-lfh="einheit-fahrzeug" style={zeilenStil}>
        <FahrzeugZeichen
          tz={{
            fahrzeugtyp: ef.fahrzeugtyp ?? null,
            traegerorganisation: ef.traegerorganisation ?? null,
            opta: ef.opta ?? null,
            fachaufgabe: ef.tz_fachaufgabe ?? null,
            organisation: ef.tz_organisation ?? null,
          }}
        />
        {funkrufname(ef.id, ef.funkrufname)}
        {nebentext([ef.fahrzeugtyp])}
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
          {nebentext([fremdText(f)])}
        </span>
        {fahrzeugAktionen(
          ef.id,
          <StatusWahl<number>
            darstellung={fahrzeugStatusDarstellung(
              ef,
              ef.status_id != null ? ankerJeStatus.get(ef.status_id) : null,
            )}
            farbe={ef.status_farbe ?? null}
            aktuell={ef.status_id ?? null}
            optionen={fmsStatusOptionen(katalog)}
            kennung={ef.funkrufname}
            laeuft={laeuft}
            darfSchreiben={canBesatzung}
            onWaehlen={(statusId) => {
              if (fmsStatus.isPending) return;
              fmsStatus.mutate({ efId: ef.id, statusId });
            }}
          />,
        )}
        {fehlerZeile(fahrzeugZeilen.grund(ef.id))}
      </div>
    );
  };

  /** Personen unter einem Fahrzeug bzw. unter „Ohne Fahrzeug“: eingerückt. */
  const eingerueckt = (personen: readonly PersonZeileDaten[]) =>
    personen.length > 0 && (
      <div style={{ paddingInlineStart: token.paddingLG }}>{personen.map(personZeile)}</div>
    );

  let inhalt: ReactNode;
  if (mittel) {
    const ohne = mittel.ohneFahrzeug.map(ausBaum);
    inhalt = (
      <>
        {mittel.fahrzeuge.map((f) => (
          <div key={f.fahrzeug.id} role="group" aria-label={`Fahrzeug ${f.fahrzeug.funkrufname}`}>
            {fahrzeugZeile(f)}
            {eingerueckt(f.besatzung.map(ausBaum))}
          </div>
        ))}
        {needsOhneFahrzeugKnoten(mittel) ? (
          <div role="group" aria-label="Ohne Fahrzeug">
            <div style={zeilenStil}>
              <Augenbraue style={{ fontSize: 11 }}>Ohne Fahrzeug</Augenbraue>
              <span style={{ ...monoStil(11), color: rollen.gedaempft }}>
                · {kraefteText(ohne.length)}
              </span>
            </div>
            {eingerueckt(ohne)}
          </div>
        ) : (
          ohne.map(personZeile)
        )}
      </>
    );
  } else {
    // Flach aus dem DTO (D5): Fahrzeuge mit Status als Wort, dann die Mitglieder.
    inhalt = (
      <>
        {einheit.fahrzeug_mitglieder.map((m) => (
          <div key={m.ef_id} data-lfh="einheit-fahrzeug" style={zeilenStil}>
            <FahrzeugZeichen
              tz={{
                fahrzeugtyp: m.fahrzeugtyp ?? null,
                traegerorganisation: null,
                opta: null,
                fachaufgabe: null,
                organisation: null,
              }}
            />
            {funkrufname(m.ef_id, m.funkrufname)}
            {nebentext([m.fahrzeugtyp])}
            {fahrzeugAktionen(
              m.ef_id,
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
              />,
            )}
            {fehlerZeile(fahrzeugZeilen.grund(m.ef_id))}
          </div>
        ))}
        {einheit.personal_mitglieder.map((m) => personZeile(ausMitglied(m)))}
      </>
    );
  }

  const leer = einheit.fahrzeug_mitglieder.length === 0 && einheit.personal_mitglieder.length === 0;

  return (
    <Paneel
      titel="Fahrzeuge und Besatzung"
      meta={`${einheit.fahrzeug_mitglieder.length} Fzg. · ${kraefteText(einheit.personal_mitglieder.length)}`}
      koerperPolster
    >
      {grund && (
        <div style={{ marginBottom: token.marginSM }}>
          <RechteHinweis sichtbar marke="Ohne Besatzung" text={grund} />
        </div>
      )}
      {rechte.hasBesatzung && listenZustand !== 'daten' && (
        <PaneelZustand
          zustand={listenZustand}
          titel="Fahrzeuge und Besatzung"
          leerText=""
          onNeuladen={onNeuladen}
        >
          {null}
        </PaneelZustand>
      )}
      {rechte.hasBesatzung && listenZustand === 'laden' ? null : leer ? (
        <span style={{ color: rollen.gedaempft }}>—</span>
      ) : (
        inhalt
      )}
      {children}
    </Paneel>
  );
}
