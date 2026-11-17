import { App, Button, Collapse, Form, Input, Typography } from 'antd';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useId, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router';
import { heuteInZone } from '../../anzeige/zeitEingabe';
import { registrierNummer } from '../../anzeige/registrierNummer';
import { useZeitEingabe } from '../../anzeige/ZeitpunktEingabe';
import { loadRegistrierListe, sendBezugsperson } from '../../api/betreuungRegistrierung';
import { BETREUUNG_ABMELDUNG_ZIEL_MAX } from '../../api/eingabegrenzen';
import { einsatzKeys } from '../../api/queryKeys';
import type {
  AbmeldungEingabe,
  Betreuungsstelle,
  Haushalt,
  RegistriertePerson,
  RegistrierungEingabe,
} from '../../api/types';
import { useAuth } from '../../auth/AuthContext';
import { ErfassungsModal } from '../../components/Erfassung';
import { MenueAusloeser, type MenueEintrag } from '../../components/MenueAusloeser';
import { ZeilenFehler } from '../../components/SpeicherHinweis';
import { useZeilenFehler } from '../../components/useZeilenFehler';
import {
  Kennzahl,
  Kennzahlenband,
  Paneel,
  PaneelZustand,
  monoStil,
  useRollen,
} from '../../components/instrument';
import { zeichenGrenze, zeichenRegel } from '../../components/zeichenGrenze';
import { KEINE_BERECHTIGUNG } from '../../einsatz/modulRegistry';
import {
  saveAbmeldungOfflineCapable,
  saveRegistrierungOfflineCapable,
} from '../../offline/schreiben';
import { serverJetzt } from '../../offline/serveruhr';
import { useVorgemerkteSchreibaktionen } from '../../offline/useVorgemerkteSchreibaktionen';
import { OHNE_VERBINDUNG_NICHT_AENDERBAR, useOhneVerbindung } from '../../offline/verbindung';
import { useGeraetDarf } from '../../geraet/geraetSicht';
import { useEinsatzPfade } from '../../routing/EinsatzPfade';
import HaushaltAendernModal, { type HaushaltAendernPerson } from './HaushaltAendernModal';
import RegistrierMaske from './RegistrierMaske';
import {
  KOSTFORM_REIHE,
  KOSTFORM_WORT,
  alterText,
  haushaltKennung,
  kostformBand,
  personName,
} from './registrierKern';

/**
 * Abschnitt „Registrierung“ einer Betreuungsstelle (LLH-1612, Spec `betreuung-registrierung`,
 * design.md D7/D8): Kopfaktion „Registrieren“, Band „Kostformen“ und die Registrierliste, an der
 * Detailseite der Stelle und am Gerät „Betreuungsstelle“ derselbe Baustein.
 *
 * - **Personenbezogen:** die Liste kommt nur mit Zugriff auf Personen (`personenFrei`, dieselbe
 *   Lesart wie „davon namentlich“ der Übersicht); ohne steht ein Grund, „Registrieren“ fehlt, und
 *   nichts wird abgefragt. Eigener Query-Prefix, nicht auf der Platte (`api/queryKeys.ts`).
 * - **Band „Kostformen“** rechnet nur aus der geladenen Liste der Stelle (`kostformBand`), ohne
 *   die vorgemerkten Haushalte: der Server kennt sie noch nicht.
 * - **Haushalte aufklappbar** (Kopf „H-n · Bezugsperson · n Personen“), darin „Person hinzufügen“
 *   (Maske mit dem Haushalt) und „Abmelden“; je Person „Abmelden“. Abmelden fragt nach, das Ziel
 *   ist optional und geht nie ins ETB. Personen ohne Haushalt (über einen Verbleib aufgenommen)
 *   stehen als eigener Block.
 * - **Haushalte umbauen** (LLH-1615, Change `lm62ud0b-haushalt-umbauen`, design.md D4): neben
 *   „Abmelden“ je Person ein ⋮-Menü mit „Zur Bezugsperson machen“ (nur im Haushalt, nicht für die
 *   Bezugsperson) und „Haushalt ändern …“; die Bezugsperson trägt das Wort. Ohne Netz gesperrt mit
 *   Grund, nie vorgemerkt (D5).
 * - **Ohne Netz** merken Registrieren und Abmelden vor (`offline/schreiben.ts`); vorgemerkte
 *   Haushalte stehen oben als „vorgemerkt“, vorgemerkt abgemeldete Personen tragen das Wort statt
 *   des Knopfs.
 * - Gesperrt mit Grund: ohne Schreibrecht (`rechteGrund`) oder an einer geschlossenen Stelle.
 * - **„Registrierliste drucken“** (LLH-1616) führt auf die Druckansicht der Stelle, auch ohne
 *   Schreibrecht und an einer geschlossenen Stelle; am Gerät nur an der Betreuungsstelle. Eigene
 *   Zeile über dem Band, nicht im Kopf: bei 390 px liefe der Kopf sonst über (Gate 1).
 */

interface Ziel {
  art: 'haushalt' | 'person';
  titel: string;
  anzahl: number;
  body: Pick<AbmeldungEingabe, 'haushalt_id' | 'person_ids'>;
}

type MaskeOffen = { haushalt?: { id: number; nummer: number; nachname?: string } } | null;

export interface RegistrierungPaneelProps {
  einsatzId: number;
  stelle: Pick<Betreuungsstelle, 'id' | 'bezeichnung' | 'status'>;
  /** Zugriff auf Personen (die Übersicht liefert `namentlich`). */
  personenFrei: boolean;
  darfSchreiben: boolean;
  /** Grund ohne Schreibrecht, wenige Wörter („Einsatz abgeschlossen“). */
  rechteGrund?: string;
}

const personenWort = (n: number) => `${n} ${n === 1 ? 'Person' : 'Personen'}`;

export default function RegistrierungPaneel({
  einsatzId,
  stelle,
  personenFrei,
  darfSchreiben,
  rechteGrund,
}: RegistrierungPaneelProps) {
  const { benutzer } = useAuth();
  const { message } = App.useApp();
  const qc = useQueryClient();
  const { token } = useRollen();
  const pfade = useEinsatzPfade();
  const navigate = useNavigate();
  const geraetDarfHier = useGeraetDarf();
  const { zone } = useZeitEingabe();
  const grundId = useId();
  const abmeldungGrundId = useId();
  const [maske, setMaske] = useState<MaskeOffen>(null);
  const [abmelden, setAbmelden] = useState<Ziel | null>(null);
  const [umhaengen, setUmhaengen] = useState<HaushaltAendernPerson | null>(null);
  const ohneNetz = useOhneVerbindung();
  const [zielForm] = Form.useForm<{ ziel?: string }>();

  const liste = useQuery({
    queryKey: einsatzKeys.registrierliste(einsatzId, stelle.id),
    queryFn: () => loadRegistrierListe(einsatzId, stelle.id),
    enabled: personenFrei,
  });
  const vorgemerkt = useVorgemerkteSchreibaktionen(benutzer?.id, einsatzId, [
    'registrierung',
    'abmeldung',
  ]).filter((z) => z.aktion.stelle_id === stelle.id);

  const ziel = { id: stelle.id, bezeichnung: stelle.bezeichnung };
  const invalidiere = () => {
    void qc.invalidateQueries({ queryKey: einsatzKeys.registrierliste(einsatzId, stelle.id) });
    void qc.invalidateQueries({ queryKey: einsatzKeys.betreuung(einsatzId) });
    void qc.invalidateQueries({ queryKey: einsatzKeys.personen(einsatzId) });
    void qc.invalidateQueries({ queryKey: einsatzKeys.personenAuswahl(einsatzId) });
    void qc.invalidateQueries({ queryKey: einsatzKeys.etb(einsatzId) });
  };

  const registrieren = useMutation({
    // Die Funktion merkt ohne Netz selbst vor (`frontend/src/offline/AGENTS.md`).
    networkMode: 'always',
    mutationFn: (body: RegistrierungEingabe) => {
      if (!benutzer) throw new Error('Nicht angemeldet');
      return saveRegistrierungOfflineCapable(benutzer.id, einsatzId, ziel, body);
    },
    onSuccess: (ergebnis, body) => {
      const n = personenWort(body.personen.length);
      if (ergebnis.zustand === 'vorgemerkt') {
        message.warning(`Offline vorgemerkt: Registrierung ${n}`);
        return;
      }
      // Am Spiegel (LLH-1492): ein Antrag an die führende Instanz, noch kein Haushalt.
      if (ergebnis.zustand === 'beantragt') {
        message.info(`Beantragt: Registrierung ${n}`);
        return;
      }
      invalidiere();
      message.success(`${haushaltKennung(ergebnis.daten.nummer)} registriert: ${n}`);
    },
  });
  const abmeldenMut = useMutation({
    networkMode: 'always',
    mutationFn: (body: AbmeldungEingabe) => {
      if (!benutzer) throw new Error('Nicht angemeldet');
      return saveAbmeldungOfflineCapable(benutzer.id, einsatzId, ziel, body);
    },
    onSuccess: (ergebnis) => {
      if (ergebnis.zustand === 'vorgemerkt') {
        message.warning(`Offline vorgemerkt: Abmeldung`);
        return;
      }
      if (ergebnis.zustand === 'beantragt') {
        message.info(`Beantragt: Abmeldung`);
        return;
      }
      invalidiere();
      message.success(`Abgemeldet: ${personenWort(ergebnis.daten.person_ids.length)}`);
    },
  });

  // Grund einer Ablehnung an der Personenzeile (LFH-1077), nicht als Toast.
  const zeilenFehler = useZeilenFehler<number>();
  const bezugsperson = useMutation({
    // Ohne Netz gesperrt; nie angehalten und still nachgeholt (kein client_id).
    networkMode: 'always',
    mutationFn: ({
      haushaltId,
      personId,
    }: {
      haushaltId: number;
      personId: number;
      titel: string;
    }) => sendBezugsperson(einsatzId, stelle.id, haushaltId, personId),
    onMutate: ({ personId }) => zeilenFehler.beginne(personId),
    onSuccess: (h, { titel }) => {
      invalidiere();
      message.success(`${titel} ist Bezugsperson von ${haushaltKennung(h.nummer)}`);
    },
    onError: (e, { personId }) => zeilenFehler.melde(personId, e, 'Bezugsperson nicht geändert'),
  });

  // Registrierliste drucken (LLH-1616): auch ohne Schreibrecht; am Gerät nur die Betreuungsstelle
  // (`geraetDarf`), sonst fehlt der Pfad (`EinsatzPfade.registrierlisteDruck`).
  const druckPfad =
    pfade.registrierlisteDruck && geraetDarfHier('registrierliste-druck')
      ? pfade.registrierlisteDruck(einsatzId, stelle.id)
      : null;
  const geschlossen = stelle.status === 'geschlossen';
  const sperrGrund = !darfSchreiben
    ? (rechteGrund ?? 'Nur Ansicht')
    : geschlossen
      ? 'Stelle geschlossen'
      : null;

  if (!personenFrei) {
    // Benannt statt stumm (M16): das Paneel fehlt, die Zeile sagt warum.
    return (
      <Typography.Text type="secondary" data-lfh="registrierung-ohne-recht">
        Registrierung · {KEINE_BERECHTIGUNG}
      </Typography.Text>
    );
  }

  // Vorgemerkt abgemeldet: Personen und Haushalte, die hier noch stehen, bis der Abgleich läuft.
  const abgemeldetVorgemerkt = new Set<number>();
  const haushaltVorgemerkt = new Set<number>();
  for (const z of vorgemerkt) {
    if (z.aktion.art !== 'abmeldung') continue;
    // Ein Antrag am Spiegel trägt Haushalt und Personen nur mit fremden Kennungen: er sperrt unten
    // jede weitere Abmeldung an dieser Stelle, bis die führende Instanz entschieden hat.
    if (z.antrag != null) continue;
    for (const id of z.aktion.daten.person_ids ?? []) abgemeldetVorgemerkt.add(id);
    if (z.aktion.daten.haushalt_id != null) haushaltVorgemerkt.add(z.aktion.daten.haushalt_id);
  }
  // Am Spiegel (LLH-1492): eine offene beantragte Abmeldung an dieser Stelle. Wen sie betrifft, ist
  // hier nicht zu erkennen; deshalb steht bis zur Entscheidung jedes Abmelden gesperrt, statt eine
  // zweite Abmeldung derselben Personen zu beantragen.
  const abmeldungBeantragt = vorgemerkt.some(
    (z) => z.antrag != null && z.aktion.art === 'abmeldung',
  );
  const vorgemerkteRegistrierungen = vorgemerkt.flatMap((z) =>
    z.aktion.art === 'registrierung'
      ? [
          {
            schluessel: z.antrag ? `antrag-${z.antrag.id}` : z.id,
            antrag: z.antrag != null,
            daten: z.aktion.daten,
          },
        ]
      : [],
  );

  const heute = heuteInZone(zone, serverJetzt());
  const daten = liste.data;
  const leer =
    daten != null &&
    daten.haushalte.length === 0 &&
    daten.ohne_haushalt.length === 0 &&
    vorgemerkteRegistrierungen.length === 0;
  const zustand =
    liste.isError && daten == null ? 'fehler' : liste.isPending ? 'laden' : leer ? 'leer' : 'daten';
  // Ohne Netz und ohne Cache bleibt die Abfrage pausiert (die Liste liegt bewusst nicht auf der
  // Platte): dann sagt das Paneel das, statt „wird abgerufen“ zu behaupten.
  const ohneNetzUngeladen = daten == null && liste.isPending && liste.fetchStatus === 'paused';

  function oeffneAbmelden(z: Ziel) {
    abmeldenMut.reset();
    setAbmelden(z);
  }

  const personZeile = (
    p: RegistriertePerson,
    haushalt: Haushalt | null,
    haushaltAbgemeldet: boolean,
  ) => {
    const kennung = registrierNummer('R', p.registrier_nr);
    const name = personName(p);
    const vorgemerktAb = haushaltAbgemeldet || abgemeldetVorgemerkt.has(p.id);
    const istBezugsperson = haushalt != null && haushalt.bezugsperson_id === p.id;
    const titel = `${kennung} ${name}`;
    const umbau: MenueEintrag<'bezugsperson' | 'haushalt'>[] = [
      ...(haushalt && !istBezugsperson
        ? [{ key: 'bezugsperson' as const, label: 'Zur Bezugsperson machen' }]
        : []),
      { key: 'haushalt', label: 'Haushalt ändern …' },
    ];
    return (
      <li
        key={p.id}
        data-lfh="registrierte-person"
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          columnGap: token.marginSM,
          rowGap: token.marginXXS,
          paddingBlock: token.paddingXS,
          borderTop: `1px solid ${token.colorBorderSecondary}`,
        }}
      >
        <Link to={pfade.personDetail(einsatzId, p.id)} style={monoStil(14)}>
          {kennung}
        </Link>
        <span style={{ fontWeight: 600 }}>{name}</span>
        {istBezugsperson && <Typography.Text type="secondary">Bezugsperson</Typography.Text>}
        {alterText(p, heute) && <span style={monoStil(14)}>{alterText(p, heute)}</span>}
        <Typography.Text type="secondary">
          {p.kostform ? KOSTFORM_WORT[p.kostform] : 'Kostform ohne Angabe'}
        </Typography.Text>
        <span
          style={{
            marginLeft: 'auto',
            display: 'inline-flex',
            alignItems: 'center',
            gap: token.marginXXS,
          }}
        >
          {vorgemerktAb ? (
            <Typography.Text type="secondary">Abmeldung vorgemerkt</Typography.Text>
          ) : (
            darfSchreiben && (
              <>
                <Button
                  aria-label={`${titel} abmelden`}
                  disabled={abmeldungBeantragt}
                  aria-describedby={abmeldungBeantragt ? abmeldungGrundId : undefined}
                  onClick={() =>
                    oeffneAbmelden({
                      art: 'person',
                      titel,
                      anzahl: 1,
                      body: { person_ids: [p.id] },
                    })
                  }
                >
                  Abmelden
                </Button>
                {/* Ohne Netz gesperrt (design.md D5): nie vorgemerkt, der Grund steht am Kopf. */}
                <MenueAusloeser
                  eintraege={umbau}
                  zugaenglicherName={`Weitere Aktionen zu ${titel}`}
                  gesperrt={ohneNetz || bezugsperson.isPending}
                  laeuft={bezugsperson.isPending && bezugsperson.variables?.personId === p.id}
                  onWahl={(key) => {
                    zeilenFehler.verwirf(p.id);
                    if (key === 'bezugsperson' && haushalt) {
                      bezugsperson.mutate({ haushaltId: haushalt.id, personId: p.id, titel });
                    } else {
                      setUmhaengen({
                        id: p.id,
                        titel,
                        haushaltId: haushalt?.id ?? null,
                        istBezugsperson,
                      });
                    }
                  }}
                />
              </>
            )
          )}
        </span>
        {zeilenFehler.grund(p.id) && (
          <span style={{ flexBasis: '100%' }}>
            <ZeilenFehler
              fehler={zeilenFehler.grund(p.id)?.fehler}
              fallback={zeilenFehler.grund(p.id)?.fallback}
            />
          </span>
        )}
      </li>
    );
  };

  const haushaltInhalt = (h: Haushalt): ReactNode => {
    const kennung = haushaltKennung(h.nummer);
    const abgemeldet = haushaltVorgemerkt.has(h.id);
    return (
      <>
        {darfSchreiben && !abgemeldet && (
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: token.marginSM,
              marginBottom: token.marginXS,
            }}
          >
            <Button
              disabled={sperrGrund != null}
              onClick={() => {
                registrieren.reset();
                setMaske({
                  haushalt: {
                    id: h.id,
                    nummer: h.nummer,
                    nachname: h.bezugsperson_name?.split(',')[0]?.trim() || undefined,
                  },
                });
              }}
            >
              Person hinzufügen
            </Button>
            <Button
              aria-label={`${kennung} abmelden`}
              disabled={abmeldungBeantragt}
              aria-describedby={abmeldungBeantragt ? abmeldungGrundId : undefined}
              onClick={() =>
                oeffneAbmelden({
                  art: 'haushalt',
                  titel: kennung,
                  anzahl: h.personen.length,
                  body: { haushalt_id: h.id },
                })
              }
            >
              Abmelden
            </Button>
          </div>
        )}
        <ul
          aria-label={`Personen in ${kennung}`}
          style={{ listStyle: 'none', margin: 0, padding: 0 }}
        >
          {h.personen.map((p) => personZeile(p, h, abgemeldet))}
        </ul>
      </>
    );
  };

  const band = daten ? kostformBand(daten) : null;

  return (
    <Paneel
      titel="Registrierung"
      meta={
        daten ? personenWort(band ? Object.values(band).reduce((a, b) => a + b, 0) : 0) : undefined
      }
      aktion={
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: token.marginXS }}>
          {sperrGrund && (
            <Typography.Text id={grundId} type="secondary">
              {sperrGrund}
            </Typography.Text>
          )}
          <Button
            disabled={sperrGrund != null}
            aria-describedby={sperrGrund ? grundId : undefined}
            onClick={() => {
              registrieren.reset();
              setMaske({});
            }}
          >
            Registrieren
          </Button>
        </span>
      }
    >
      {/* Eigene Zeile statt Kopf (LLH-1616): bei 390 px trägt der Kopf neben Grund und
          „Registrieren“ keinen dritten Knopf (Gate 1), und eine Aktion wird nie gekürzt. */}
      {druckPfad && (
        <div
          style={{
            display: 'flex',
            justifyContent: 'flex-end',
            marginBlockEnd: token.marginXS,
          }}
        >
          <Button
            href={druckPfad}
            onClick={(e) => {
              // Ein Link mit Knopfgestalt: Strg/⌘+Klick öffnet den neuen Tab wie jeder Link.
              if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
              e.preventDefault();
              navigate(druckPfad);
            }}
          >
            Registrierliste drucken
          </Button>
        </div>
      )}
      {/* Vorgemerkte stehen AUSSERHALB des Zustands (Review LLH-1612): ohne Netz lädt die Liste
          nicht (sie liegt bewusst nicht auf der Platte), die Vormerkungen sind trotzdem zu sehen. */}
      {abmeldungBeantragt && (
        <Typography.Text
          id={abmeldungGrundId}
          strong
          data-lfh="abmeldung-beantragt"
          style={{ display: 'block' }}
        >
          Abmeldung beantragt
        </Typography.Text>
      )}
      {vorgemerkteRegistrierungen.length > 0 && (
        <ul
          aria-label="Vorgemerkte Registrierungen"
          style={{ listStyle: 'none', margin: 0, padding: 0 }}
        >
          {vorgemerkteRegistrierungen.map((r) => (
            <li key={r.schluessel} data-lfh="registrierung-vorgemerkt">
              {/* Ein Antrag am Spiegel (LLH-1492) steht an derselben Stelle. */}
              <Typography.Text strong>{r.antrag ? 'beantragt' : 'vorgemerkt'}</Typography.Text>
              {' · '}
              {r.daten.personen.map((p) => personName(p)).join('; ')}
              {' · '}
              {personenWort(r.daten.personen.length)}
            </li>
          ))}
        </ul>
      )}
      {ohneNetzUngeladen ? (
        <Typography.Text
          type="secondary"
          data-lfh="registrierliste-offline"
          style={{ display: 'block', padding: token.padding }}
        >
          Registrierliste ohne Netz nicht geladen
        </Typography.Text>
      ) : (
        <PaneelZustand
          zustand={zustand}
          titel="Registrierung"
          leerText="Niemand registriert"
          onNeuladen={() => void liste.refetch()}
        >
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: token.margin,
              padding: token.padding,
            }}
          >
            {band && (
              <Kennzahlenband beschriftung="Kostformen">
                {KOSTFORM_REIHE.map((k) => (
                  <Kennzahl key={k} groesse="klein" titel={KOSTFORM_WORT[k]} wert={band[k]} />
                ))}
                <Kennzahl groesse="klein" titel="ohne Angabe" wert={band.ohne_angabe} />
              </Kennzahlenband>
            )}
            {/* Haushalte umbauen geht nur mit Verbindung (design.md D5): der Grund einmal statt
                je Zeile; die ⋮-Menüs der Zeilen sind gesperrt. */}
            {ohneNetz && darfSchreiben && (
              <Typography.Text type="secondary" data-lfh="haushalte-ohne-netz">
                Haushalte · {OHNE_VERBINDUNG_NICHT_AENDERBAR}
              </Typography.Text>
            )}
            {daten && daten.haushalte.length > 0 && (
              <Collapse
                items={daten.haushalte.map((h) => ({
                  key: h.id,
                  label: [
                    haushaltKennung(h.nummer),
                    h.bezugsperson_name,
                    personenWort(h.personen.length),
                  ]
                    .filter(Boolean)
                    .join(' · '),
                  children: haushaltInhalt(h),
                }))}
              />
            )}
            {daten && daten.ohne_haushalt.length > 0 && (
              <div>
                <Typography.Text type="secondary">Ohne Haushalt</Typography.Text>
                <ul
                  aria-label="Personen ohne Haushalt"
                  style={{ listStyle: 'none', margin: 0, padding: 0 }}
                >
                  {daten.ohne_haushalt.map((p) => personZeile(p, null, false))}
                </ul>
              </div>
            )}
          </div>
        </PaneelZustand>
      )}

      {maske && (
        <RegistrierMaske
          stelle={stelle}
          haushalt={maske.haushalt}
          laeuft={registrieren.isPending}
          speicherung={registrieren}
          onErfassen={(body) => registrieren.mutateAsync(body)}
          onSchliessen={() => setMaske(null)}
        />
      )}
      {umhaengen && (
        <HaushaltAendernModal
          einsatzId={einsatzId}
          stelleId={stelle.id}
          person={umhaengen}
          onGeschrieben={invalidiere}
          onSchliessen={() => setUmhaengen(null)}
        />
      )}
      {abmelden && (
        <ErfassungsModal<{ ziel?: string }>
          offen
          titel={`${abmelden.titel} abmelden?`}
          form={zielForm}
          erfassenText={abmelden.art === 'haushalt' ? 'Haushalt abmelden' : 'Person abmelden'}
          laeuft={abmeldenMut.isPending}
          speicherung={abmeldenMut}
          speicherFehlerTitel="Nicht abgemeldet"
          onErfassen={({ ziel: z }) => {
            const t = z?.trim();
            return abmeldenMut.mutateAsync({ ...abmelden.body, ...(t ? { ziel: t } : {}) });
          }}
          onFertig={() => setAbmelden(null)}
          onAbbrechen={() => setAbmelden(null)}
        >
          {/* Ein Satz zur Folge vor dem Schritt (LFH-1078). */}
          <Typography.Paragraph>
            {personenWort(abmelden.anzahl)} verlassen {stelle.bezeichnung}.
          </Typography.Paragraph>
          <Form.Item
            name="ziel"
            label="Ziel"
            rules={[zeichenRegel(BETREUUNG_ABMELDUNG_ZIEL_MAX, 'Ziel')]}
          >
            <Input
              placeholder="z. B. zu Verwandten"
              count={zeichenGrenze(BETREUUNG_ABMELDUNG_ZIEL_MAX)}
            />
          </Form.Item>
        </ErfassungsModal>
      )}
    </Paneel>
  );
}
