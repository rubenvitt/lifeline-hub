import { App, Button, Space, Typography } from 'antd';
import { useLayoutEffect, useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '../../api/client';
import {
  gibFahrzeugFrei,
  gibPersonalFrei,
  ordneFahrzeugZu,
  ordnePersonalZu,
} from '../../api/einheiten';
import {
  gibBesatzungFrei,
  ordneBesatzungZu,
  updateDisposition,
  zuordnenBesatzungMenge,
} from '../../api/einsatzFahrzeuge';
import { listeFahrzeugStatus } from '../../api/fahrzeugStatus';
import { einsatzKeys, globalKeys } from '../../api/queryKeys';
import type { Einheit, EinsatzFahrzeug, EinsatzPersonal, StaerkePosition } from '../../api/types';
import { kraefteText } from '../../anzeige/staerke';
import {
  Augenbraue,
  Paneel,
  PaneelZustand,
  useRollen,
  schriftGroesse,
  schriftStil,
  zahlStil,
} from '../../components/instrument';
import { KennungsLink } from '../../components/kennungsLink';
import type { WeitereAktionen } from '../../components/Datensicht';
import { ZeilenMenueAusloeser } from '../../components/ZeilenMenueAusloeser';
import { useZeilenMenueKontext } from '../../components/useDatensatzKontextMenue';
import { useHoldGeloest } from '../../components/useHoldGeloest';
import { RechteHinweis, ZeilenFehler } from '../../components/SpeicherHinweis';
import StatusTag from '../../components/StatusTag';
import StatusWahl from '../../components/StatusWahl';
import type { ZeilenGrund } from '../../components/useZeilenFehler';
import BesatzungUebernehmenDialog from '../../kraefte/BesatzungUebernehmenDialog';
import { besatzungKandidaten, besatzungVorschlag } from '../../kraefte/besatzungVorschlag';
import { FahrzeugZeichen } from '../../kraefte/EinheitZeichen';
import { funktionText } from '../../kraefte/einsatzfunktionKern';
import { zeigeRueckgaengig } from '../../kommunikation/rueckgaengig';
import { fmsStatusOptionen } from '../../kraefte/fmsTableauKern';
import {
  besatzungText,
  fremdText,
  needsOhneFahrzeugKnoten,
  type FahrzeugImBaum,
  type MittelDerEinheit,
  type PersonImBaum,
} from '../../kraefte/kraeftebaumKern';
import { PositionsMarken } from '../../kraefte/KraeftebaumZelle';
import { fmsEtikett } from '../../kraefte/meldebildRaster';
import { fahrzeugStatusDarstellung } from '../../kraefte/mittelStatus';
import { gruendeJeKraft } from '../../kraefte/sammelDisposition';
import { einsatzkraftPfad, fahrzeugePfad } from '../../routing/deeplinks';
import { besatzungsUrteil, statusKategorie } from '../../theme/statusFarben';
import {
  besatzungGrund,
  buildFahrzeugMenuItems,
  buildPersonMenuItems,
  hasNoMitglieder,
  type EinheitRechte,
  type FahrzeugMenuKey,
  type PersonMenuKey,
} from './einheitAnsichtKern';
import type { BesatzungErrors } from './useBesatzungErrors';

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
 * Rückfrage, mit einem Rückgängig-Hinweis (LLH-1722, `frontend/AGENTS.md`, „Beenden: Verb, Ort und
 * Sicherung je Art“): „Aus Einheit lösen“ eines Fahrzeugs steht in seinem ⋮, die gelöste Zeile hält
 * ihre Stelle als „Gelöst · Rückgängig“ samt gedämpfter Besatzung (`useHoldGeloest`), und das
 * Rückgängig nimmt das Fahrzeug keiner anderen Einheit still weg (`nur_wenn_frei`). Personen lösen
 * über ihr ⋮; ihr Rückgängig steht im Hinweis, beim Einheitsführer samt Führung. Jeder Grund steht an seiner Zeile
 * (`useZeilenFehler`, Schlüssel `ep_id` bzw. `ef_id`), kein Toast. Die Gründe hält die Seite
 * (`errors`, `useBesatzungErrors`): ist die Zeile nach der Antwort weg, steht ihr Grund im
 * Seitenhinweis (LLH-1269).
 *
 * SAMMELROUTE (LLH-1267): „Auf <Funkrufname>“ ordnet über dieselbe Route zu wie „Personal der
 * Einheit übernehmen“ (`zuordnenBesatzungMenge`, LLH-1073 D12), mit genau einer Kraft; je
 * Fahrzeug öffnet der Knopf den Dialog der Fahrzeugliste mit dem Vorschlag bis zum Soll. Lösen
 * vom Fahrzeug bleibt auf der Einzelroute, eine Sammelroute dafür gibt es nicht.
 */

interface FahrzeugeBesatzungProps {
  einsatzId: number;
  einheit: Einheit;
  /**
   * Die Besatzung aus `buildBesatzungMittel`: erst mit Freigabe Personal und Fahrzeuge und beiden
   * Listen, sonst `null` (Mitglieder flach aus dem DTO). Die Seite rechnet sie einmal, denn gegen
   * dieselben Zeilen prüft sie, ob ein Grund seinen Ort verloren hat (`visibleBesatzungRows`).
   */
  mittel: MittelDerEinheit | null;
  /**
   * Einsatzpersonal für „Personal der Einheit übernehmen“ (LLH-1267); nur mit
   * `rechte.hasBesatzung` abgefragt, sonst `undefined`.
   */
  personal: readonly EinsatzPersonal[] | undefined;
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
  /** Gründe abgelehnter Aktionen je Zeile; die Seite hält sie (`useBesatzungErrors`). */
  errors: BesatzungErrors;
  /**
   * Meldet die gelösten Fahrzeuge, deren Zeile das Paneel gerade hält (`ef_id` → Funkrufname):
   * ihr Grund steht an der gehaltenen Zeile, die Seite zählt sie zu den sichtbaren (LLH-1722).
   */
  onGehalten?: (fahrzeuge: ReadonlyMap<number, string>) => void;
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

/**
 * Ein Fahrzeug der Einheit, aus dem Kern (mit Besatzung) oder flach aus dem DTO. Der Halte-
 * Baustein merkt sich den ganzen Eintrag, damit die gehaltene Zeile auch ohne Quelle zeichnet.
 */
interface FahrzeugEintrag {
  id: number;
  funkrufname: string;
  baum: FahrzeugImBaum | null;
  flach: Einheit['fahrzeug_mitglieder'][number] | null;
}

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
  mittel,
  personal,
  rechte,
  listState = 'daten',
  onReload = () => {},
  onSetFuehrer,
  errors,
  onGehalten,
  children,
}: FahrzeugeBesatzungProps) {
  const qc = useQueryClient();
  const { message } = App.useApp();
  const { token, rollen } = useRollen();
  const einheitId = einheit.id;
  const reason = besatzungGrund(rechte);
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

  const { person: personErrors, fahrzeug: fahrzeugErrors } = errors;
  /*
   * Was je Zeile gerade läuft (`p<ep_id>`, `f<ef_id>`): die Rückmeldung steht am Auslöser vor der
   * Antwort, auch bei zwei Aktionen an zwei Zeilen zugleich (eine Mutation kennt nur ihre letzte).
   */
  const [pending, setPending] = useState<ReadonlySet<string>>(() => new Set());
  /** Offener Dialog „Personal der Einheit übernehmen“ samt Vorwahl beim Öffnen (LLH-1073 D12). */
  const [uebernehmenFuer, setUebernehmenFuer] = useState<{
    fahrzeug: EinsatzFahrzeug;
    vorgewaehlt: number[];
  } | null>(null);
  // Fällt die Besatzung weg (Freigabe entzogen), schließt der Dialog und öffnet nicht von selbst
  // wieder, wenn sie zurückkommt.
  if (!canBesatzung && uebernehmenFuer) setUebernehmenFuer(null);
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

  /*
   * Rückwege (LLH-1722): jede Rücknahme hat ihren Grund an der Zeile, an der sie gelöst wurde; ist
   * die Zeile weg, trägt ihn die Seite in den Seitenhinweis (`useBesatzungErrors`).
   */
  const personZurueck = useMutation({
    mutationFn: (p: PersonRow) =>
      ordnePersonalZu(einsatzId, einheitId, p.epId, {
        nurWennFrei: true,
        alsFuehrer: p.isFuehrer,
      }),
    onMutate: (p) => trackPerson(p.epId).start(),
    onSuccess: invalidate,
    onError: (e, p) => personErrors.melde(p.epId, e, 'Nicht zurückgenommen'),
    onSettled: (_d, _e, p) => trackPerson(p.epId).end(),
  });
  const personalLoesen = useMutation({
    mutationFn: (p: PersonRow) => gibPersonalFrei(einsatzId, einheitId, p.epId),
    onMutate: (p) => trackPerson(p.epId).start(),
    onSuccess: (_d, p) => {
      invalidate();
      zeigeRueckgaengig(message, `${p.name} aus Einheit gelöst`, () => personZurueck.mutate(p));
    },
    onError: (e, p) => personErrors.melde(p.epId, e, 'Lösen fehlgeschlagen'),
    onSettled: (_d, _e, p) => trackPerson(p.epId).end(),
  });
  const besatzungZuordnen = useMutation({
    mutationFn: (v: { efId: number; epId: number }) =>
      zuordnenBesatzungMenge(einsatzId, v.efId, [v.epId]),
    onMutate: (v) => trackPerson(v.epId).start(),
    onSuccess: invalidate,
    onError: (e, v) => {
      // Die Sammelroute nennt den Grund je Person (`zeilen`), die Meldung spricht von allen.
      const grund = gruendeJeKraft(e, 'personal').get(v.epId);
      const fehler =
        grund != null && e instanceof ApiError
          ? new ApiError(e.status, `Nicht auf das Fahrzeug gesetzt: ${grund}`)
          : e;
      personErrors.melde(v.epId, fehler, 'Nicht auf das Fahrzeug gesetzt');
    },
    onSettled: (_d, _e, v) => trackPerson(v.epId).end(),
  });
  const besatzungZurueck = useMutation({
    mutationFn: (v: { efId: number; epId: number }) => ordneBesatzungZu(einsatzId, v.efId, v.epId),
    onMutate: (v) => trackPerson(v.epId).start(),
    onSuccess: invalidate,
    onError: (e, v) => personErrors.melde(v.epId, e, 'Nicht zurückgenommen'),
    onSettled: (_d, _e, v) => trackPerson(v.epId).end(),
  });
  const besatzungLoesen = useMutation({
    mutationFn: (v: { efId: number; epId: number; name: string }) =>
      gibBesatzungFrei(einsatzId, v.efId, v.epId),
    onMutate: (v) => trackPerson(v.epId).start(),
    onSuccess: (_d, v) => {
      invalidate();
      zeigeRueckgaengig(message, `${v.name} vom Fahrzeug gelöst`, () =>
        besatzungZurueck.mutate({ efId: v.efId, epId: v.epId }),
      );
    },
    onError: (e, v) => personErrors.melde(v.epId, e, 'Lösen fehlgeschlagen'),
    onSettled: (_d, _e, v) => trackPerson(v.epId).end(),
  });
  const fahrzeugZurueck = useMutation({
    mutationFn: (f: FahrzeugEintrag) =>
      ordneFahrzeugZu(einsatzId, einheitId, f.id, { nurWennFrei: true }),
    onMutate: (f) => trackFahrzeug(f.id).start(),
    onSuccess: (_d, f) => {
      halten.release(f.id);
      invalidate();
    },
    onError: (e, f) => fahrzeugErrors.melde(f.id, e, 'Nicht zurückgenommen'),
    onSettled: (_d, _e, f) => trackFahrzeug(f.id).end(),
  });
  const fahrzeugLoesen = useMutation({
    mutationFn: (f: FahrzeugEintrag) => gibFahrzeugFrei(einsatzId, einheitId, f.id),
    onMutate: (f) => trackFahrzeug(f.id).start(),
    onSuccess: (_d, f) => {
      halten.add(f);
      invalidate();
      zeigeRueckgaengig(message, `${f.funkrufname} aus Einheit gelöst`, () =>
        fahrzeugZurueck.mutate(f),
      );
    },
    onError: (e, f) => fahrzeugErrors.melde(f.id, e, 'Lösen fehlgeschlagen'),
    onSettled: (_d, _e, f) => trackFahrzeug(f.id).end(),
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
      personalLoesen.mutate(p);
    } else if (key === 'vom-fahrzeug') {
      if (p.fahrzeugId != null) {
        besatzungLoesen.mutate({ efId: p.fahrzeugId, epId: p.epId, name: p.name });
      }
    } else {
      besatzungZuordnen.mutate({ efId: Number(key.slice('auf:'.length)), epId: p.epId });
    }
  }

  // Die Fahrzeuge der Einheit als Ziele „Auf …“: dieselbe Folge wie im Paneel.
  const menuFahrzeuge = (mittel?.fahrzeuge ?? []).map((f) => ({
    id: f.fahrzeug.id,
    funkrufname: f.fahrzeug.funkrufname,
  }));

  /**
   * Aktionen einer Person, EINE Quelle für ⋮ und Kontextmenü (LLH-1599, design.md D3). Ohne
   * Einträge (Rechte, Zustand) kein ⋮, und das Browsermenü bleibt.
   */
  const personMenue: WeitereAktionen<PersonRow> = {
    eintraege: (p) =>
      buildPersonMenuItems({ isFuehrer: p.isFuehrer, fahrzeugId: p.fahrzeugId }, menuFahrzeuge, {
        canEditEinheit: rechte.canEditEinheit,
        canEditBesatzung: canBesatzung,
      }),
    zugaenglicherName: (p) => `Aktionen zu Person ${p.name}`,
    laeuft: (p) => pending.has(`p${p.epId}`),
    onWahl: (key, p) => handleSelect(p, key as PersonMenuKey),
  };
  const allePersonen: readonly PersonRow[] = mittel
    ? [
        ...mittel.fahrzeuge.flatMap((f) => f.besatzung.map(fromBaum)),
        ...mittel.ohneFahrzeug.map(fromBaum),
      ]
    : einheit.personal_mitglieder.map(fromMitglied);
  const kontext = useZeilenMenueKontext(personMenue, {
    finde: (k) => allePersonen.find((p) => p.epId === k),
    schluessel: (p) => p.epId,
  });

  // Die Fahrzeuge der Einheit, wie die Quelle sie zeigt; die gelösten hält `useHoldGeloest` an
  // ihrer Stelle (LLH-1722, Spec `bedien-muster`, „Eine gelöste Zeile hält ihre Stelle“).
  const fahrzeugEintraege: FahrzeugEintrag[] = mittel
    ? mittel.fahrzeuge.map((f) => ({
        id: f.fahrzeug.id,
        funkrufname: f.fahrzeug.funkrufname,
        baum: f,
        flach: null,
      }))
    : einheit.fahrzeug_mitglieder.map((m) => ({
        id: m.ef_id,
        funkrufname: m.funkrufname,
        baum: null,
        flach: m,
      }));
  const halten = useHoldGeloest(fahrzeugEintraege, `${einsatzId}:${einheitId}`);
  const gehaltenNamen = halten.rows
    .filter((r) => r.isGeloest)
    .map((r): [number, string] => [r.p.id, r.p.funkrufname]);
  const gehaltenIds = new Set(gehaltenNamen.map(([id]) => id));
  // Nur wenn sich die Menge ändert: der Schlüssel trägt sie als Text.
  const gehaltenSchluessel = JSON.stringify(gehaltenNamen);
  useLayoutEffect(() => {
    onGehalten?.(new Map(JSON.parse(gehaltenSchluessel) as [number, string][]));
  }, [gehaltenSchluessel, onGehalten]);

  /** Aktionen eines Fahrzeugs, EINE Quelle für ⋮ und Kontextmenü (LLH-1722). */
  const fahrzeugMenue: WeitereAktionen<FahrzeugEintrag> = {
    eintraege: () => buildFahrzeugMenuItems({ canEditEinheit: rechte.canEditEinheit }),
    zugaenglicherName: (f) => `Aktionen zu Fahrzeug ${f.funkrufname}`,
    laeuft: (f) => pending.has(`f${f.id}`),
    onWahl: (key, f) => {
      if ((key as FahrzeugMenuKey) === 'aus-einheit') fahrzeugLoesen.mutate(f);
    },
  };
  const kontextFahrzeug = useZeilenMenueKontext(fahrzeugMenue, {
    finde: (k) => fahrzeugEintraege.find((f) => f.id === k),
    schluessel: (f) => f.id,
  });

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
    return text ? (
      <span style={{ fontSize: schriftGroesse('klein'), color: rollen.gedaempft }}>{text}</span>
    ) : null;
  };

  /** `gedaempft`: unter einer gehaltenen Fahrzeugzeile, ohne Bedienung (LLH-1722). */
  const renderPersonRow = (p: PersonRow, gedaempft = false) => (
    <div
      key={p.epId}
      data-lfh="einheit-person"
      style={gedaempft ? { ...rowStyle, color: rollen.gedaempft } : rowStyle}
      {...(gedaempft ? {} : kontext.ausloeser(p))}
    >
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
      {!gedaempft && (
        <span style={{ marginInlineStart: 'auto' }}>
          <ZeilenMenueAusloeser menue={personMenue} zeile={p} />
        </span>
      )}
      {!gedaempft && errorRow(personErrors.grund(p.epId))}
    </div>
  );

  /** Name eines Fahrzeugs, als Sprung in die Fahrzeugzeile, wenn das Modul offen ist. */
  const renderFunkrufname = (efId: number, name: string) => (
    <span data-schrift="kennung" style={zahlStil('text')}>
      {rechte.hasFahrzeugLink ? (
        <KennungsLink to={fahrzeugePfad(einsatzId, { fahrzeug: efId })}>{name}</KennungsLink>
      ) : (
        name
      )}
    </span>
  );

  /**
   * „Personal der Einheit übernehmen“ (LLH-1267): nur wo die Besatzung steht und geschrieben
   * werden darf; ohne freie Kräfte gesperrt, der Grund sichtbar daneben (LLH-1073 D12).
   */
  const renderUebernehmen = (ef: EinsatzFahrzeug) => {
    if (!canBesatzung || !personal) return null;
    const kandidaten = besatzungKandidaten(personal, ef);
    return (
      <Space size="small" wrap>
        <Button
          disabled={kandidaten.length === 0}
          onClick={() =>
            setUebernehmenFuer({
              fahrzeug: ef,
              vorgewaehlt: besatzungVorschlag({
                kandidaten,
                crew: personal.filter((p) => p.fahrzeug_id === ef.id),
                soll: ef.soll_besatzung ?? null,
                fuehrerId: einheit.fuehrer_id ?? null,
              }).vorgewaehlt,
            })
          }
        >
          Personal der Einheit übernehmen
        </Button>
        {kandidaten.length === 0 && (
          <Typography.Text type="secondary">keine freien Kräfte der Einheit</Typography.Text>
        )}
      </Space>
    );
  };

  /**
   * Rechts: Status, „Personal der Einheit übernehmen“ und das ⋮ mit „Aus Einheit lösen“ (LLH-1722).
   * Im Baum ist der Status die FMS-Wahl, flach aus dem DTO nur das Wort.
   *
   * Gelöst (`geloest`) bleibt jedes Teil unsichtbar an seinem Platz, wie in `MaterialAmOrt`: fielen
   * sie weg, passte eine umgebrochene Zeile wieder in eine, und alles darunter rückte hoch.
   * „Rückgängig“ teilt das Gitterfeld der Statuswahl, „Gelöst“ steht träge in dem des ⋮; ein
   * zweiter Tipp an die Stelle des ⋮ trifft die Marke, nie das nächste Fahrzeug.
   */
  const renderFahrzeugActions = (
    f: FahrzeugEintrag,
    status: { wahl: FahrzeugImBaum['fahrzeug'] } | { wort: ReactNode },
    uebernehmen: ReactNode,
    geloest: boolean,
  ) => {
    const efId = f.id;
    // Gesperrt ist nur die eigene Zeile: eine Wahl an einem anderen Fahrzeug geht hinaus.
    const isPending = pending.has(`f${efId}`);
    const nurPlatz = geloest ? ({ visibility: 'hidden' } as const) : undefined;
    return (
      <Space size="middle" wrap style={{ marginInlineStart: 'auto' }}>
        <span style={{ display: 'inline-grid' }}>
          <span style={{ gridArea: '1 / 1', ...nurPlatz }}>
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
                gesperrt={geloest}
                onWaehlen={(statusId) => {
                  if (!isPending && !geloest) fmsStatus.mutate({ efId, statusId });
                }}
              />
            ) : (
              status.wort
            )}
          </span>
          {geloest && rechte.canEditEinheit && (
            <span style={{ gridArea: '1 / 1' }}>
              <Button
                aria-label={`Rückgängig: ${f.funkrufname} zurück in die Einheit`}
                loading={isPending}
                onClick={() => {
                  if (!fahrzeugZurueck.isPending) fahrzeugZurueck.mutate(f);
                }}
              >
                Rückgängig
              </Button>
            </span>
          )}
        </span>
        {uebernehmen != null && <span style={nurPlatz}>{uebernehmen}</span>}
        <span style={{ display: 'inline-grid', justifyItems: 'end' }}>
          <span style={{ gridArea: '1 / 1', ...nurPlatz }}>
            <ZeilenMenueAusloeser menue={fahrzeugMenue} zeile={f} />
          </span>
          {geloest && (
            <span style={{ gridArea: '1 / 1' }}>
              <Button
                type="text"
                aria-label={`${f.funkrufname} gelöst`}
                aria-disabled
                style={{ color: rollen.gedaempft, cursor: 'default' }}
              >
                Gelöst
              </Button>
            </span>
          )}
        </span>
      </Space>
    );
  };

  /** Das taktische Zeichen eines Fahrzeugs, aus dem Kern oder flach aus dem DTO. */
  const renderZeichen = (f: FahrzeugEintrag) => {
    const ef = f.baum?.fahrzeug;
    return (
      <FahrzeugZeichen
        tz={{
          fahrzeugtyp: ef?.fahrzeugtyp ?? f.flach?.fahrzeugtyp ?? null,
          traegerorganisation: ef?.traegerorganisation ?? null,
          opta: ef?.opta ?? null,
          fachaufgabe: ef?.tz_fachaufgabe ?? null,
          organisation: ef?.tz_organisation ?? null,
        }}
      />
    );
  };

  /** Name eines Fahrzeugs: gelöst ohne Link und ohne Kontextmenü, in derselben Breite. */
  const renderFahrzeugName = (eintrag: FahrzeugEintrag, geloest: boolean) =>
    geloest ? (
      <span data-schrift="kennung" style={zahlStil('text')}>
        {eintrag.funkrufname}
      </span>
    ) : (
      // Eine Zeile mit Reglern trägt das Kontextmenü nur an ihrer Bezeichnung (Spec
      // `datensatz-aktionsmenue`).
      <span {...kontextFahrzeug.ausloeser(eintrag)}>
        {renderFunkrufname(eintrag.id, eintrag.funkrufname)}
      </span>
    );

  /** Zeilenstil, gelöst gedämpft (LLH-1722). */
  const fahrzeugRowStyle = (geloest: boolean) =>
    geloest ? { ...rowStyle, color: rollen.gedaempft } : rowStyle;

  /**
   * Notbehelf, wenn eine gehaltene Zeile ihre Quelle verloren hat (Wechsel zwischen Baum und
   * flacher Liste): nur Name, „Rückgängig“ und „Gelöst“.
   */
  const renderGehaltenesFahrzeug = (f: FahrzeugEintrag, alsGruppe: boolean) => (
    <div
      key={f.id}
      {...(alsGruppe ? { role: 'group', 'aria-label': `Fahrzeug ${f.funkrufname}` } : {})}
      data-geloest
    >
      <div data-lfh="einheit-fahrzeug" style={fahrzeugRowStyle(true)}>
        {renderZeichen(f)}
        {renderFahrzeugName(f, true)}
        {renderFahrzeugActions(f, { wort: null }, null, true)}
        {errorRow(fahrzeugErrors.grund(f.id))}
      </div>
    </div>
  );

  const renderFahrzeugRow = (eintrag: FahrzeugEintrag, f: FahrzeugImBaum, geloest: boolean) => {
    const ef = f.fahrzeug;
    return (
      <div data-lfh="einheit-fahrzeug" style={fahrzeugRowStyle(geloest)}>
        {renderZeichen(eintrag)}
        {renderFahrzeugName(eintrag, geloest)}
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
          {/* „Ist 1/0/3//4 · Soll …“ trägt Wörter: Textschrift (LLH-1777). */}
          <span style={schriftStil('meta')}>{besatzungText(f)}</span>
          {secondaryText([fremdText(f)])}
        </span>
        {renderFahrzeugActions(eintrag, { wahl: ef }, renderUebernehmen(ef), geloest)}
        {errorRow(fahrzeugErrors.grund(ef.id))}
      </div>
    );
  };

  /** Personen unter einem Fahrzeug bzw. unter „Ohne Fahrzeug“: eingerückt. */
  const indented = (personen: readonly PersonRow[]) =>
    personen.length > 0 && (
      <div style={{ paddingInlineStart: token.paddingLG }}>
        {personen.map((p) => renderPersonRow(p))}
      </div>
    );

  let content: ReactNode;
  if (mittel) {
    // Wer auf einem gehaltenen Fahrzeug sitzt, steht gedämpft unter ihm, nicht unter „Ohne Fahrzeug“.
    const ohne = mittel.ohneFahrzeug
      .filter((x) => x.person.fahrzeug_id == null || !gehaltenIds.has(x.person.fahrzeug_id))
      .map(fromBaum);
    content = (
      <>
        {halten.rows.map(({ p: eintrag, isGeloest }) =>
          eintrag.baum == null ? (
            renderGehaltenesFahrzeug(eintrag, true)
          ) : (
            <div
              key={eintrag.id}
              role="group"
              aria-label={`Fahrzeug ${eintrag.funkrufname}`}
              data-geloest={isGeloest || undefined}
            >
              {renderFahrzeugRow(eintrag, eintrag.baum, isGeloest)}
              {/* Gelöst bleibt die Besatzung gedämpft darunter, ohne Bedienung: sonst wanderte
                  sie nach „Ohne Fahrzeug“, und die Höhe spränge trotzdem. */}
              {isGeloest
                ? eintrag.baum.besatzung.length > 0 && (
                    <div style={{ paddingInlineStart: token.paddingLG }}>
                      {eintrag.baum.besatzung.map((x) => renderPersonRow(fromBaum(x), true))}
                    </div>
                  )
                : indented(eintrag.baum.besatzung.map(fromBaum))}
            </div>
          ),
        )}
        {needsOhneFahrzeugKnoten(mittel) ? (
          <div role="group" aria-label="Ohne Fahrzeug">
            <div style={rowStyle}>
              <Augenbraue style={{ fontSize: schriftGroesse('fein') }}>Ohne Fahrzeug</Augenbraue>
              <span
                style={{
                  ...schriftStil('meta'),
                  fontSize: schriftGroesse('fein'),
                  color: rollen.gedaempft,
                }}
              >
                · {kraefteText(ohne.length)}
              </span>
            </div>
            {indented(ohne)}
          </div>
        ) : (
          ohne.map((p) => renderPersonRow(p))
        )}
      </>
    );
  } else {
    // Flach aus dem DTO (D5): Fahrzeuge mit Status als Wort, dann die Mitglieder.
    content = (
      <>
        {halten.rows.map(({ p: eintrag, isGeloest }) => {
          const m = eintrag.flach;
          if (m == null) return renderGehaltenesFahrzeug(eintrag, false);
          return (
            <div
              key={m.ef_id}
              data-lfh="einheit-fahrzeug"
              data-geloest={isGeloest || undefined}
              style={fahrzeugRowStyle(isGeloest)}
            >
              {renderZeichen(eintrag)}
              {renderFahrzeugName(eintrag, isGeloest)}
              {secondaryText([m.fahrzeugtyp])}
              {renderFahrzeugActions(
                eintrag,
                {
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
                },
                null,
                isGeloest,
              )}
              {errorRow(fahrzeugErrors.grund(m.ef_id))}
            </div>
          );
        })}
        {einheit.personal_mitglieder.map((m) => renderPersonRow(fromMitglied(m)))}
      </>
    );
  }

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
      {rechte.hasBesatzung && listState === 'laden' ? null : hasNoMitglieder(einheit) &&
        halten.rows.length === 0 ? (
        <span style={{ color: rollen.gedaempft }}>—</span>
      ) : (
        <div {...halten.rootProps}>{content}</div>
      )}
      {kontext.menue}
      {kontextFahrzeug.menue}
      {children}
      {canBesatzung && personal && (
        <BesatzungUebernehmenDialog
          einsatzId={einsatzId}
          auftrag={uebernehmenFuer}
          personal={personal}
          fuehrerId={einheit.fuehrer_id ?? null}
          // Ein alter Grund an einer Person gilt bis zum nächsten Absenden, auch über den Dialog.
          onUebernommen={(epIds) => {
            for (const epId of epIds) personErrors.beginne(epId);
          }}
          onSchliessen={() => setUebernehmenFuer(null)}
        />
      )}
    </Paneel>
  );
}
