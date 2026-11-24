import { useRef, useState } from 'react';
import { Button, Input, Modal, Switch } from 'antd';
import { ZahlFeld } from '../../components/ZahlFeld';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router';
import AdminPage from '../../components/AdminPage';
import Geheimfeld from '../../components/Geheimfeld';
import {
  BearbeitbaresPaneel,
  Datenfeld,
  Datenraster,
  Knopfreihe,
  Paneel,
  PaneelZeile,
  Stapel,
  Status,
  monoStil,
  useRollen,
  type BearbeitbaresFeld,
  schriftStil,
} from '../../components/instrument';
import { SeitenFehler, SeitenLeer, SeitenSkeleton } from '../../components/SeitenZustand';
import { RechteHinweis, SeitenHinweise, SpeicherFehler } from '../../components/SpeicherHinweis';
import { NUR_ADMIN } from '../../components/nurAnsicht';
import { ListenRueckweg } from '../../components/ListenRueckweg';
import { pflicht } from '../../components/pflichtRegel';
import { useAuth } from '../../auth/AuthContext';
import { useAnzeigeKonventionen } from '../../anzeige/AnzeigeKonventionenContext';
import { zeitKurz } from '../../anzeige/zeitDarstellung';
import { ApiError, isVeraltet } from '../../api/client';
import {
  SOFORT_ODER_NIE,
  adapterFehlerText,
  adapterVersuchText,
  checkAdapter,
  deleteAdapter,
  deleteGeheimnis,
  haltAdapter,
  loadAdapterListe,
  loadAdapterVersuche,
  resumeAdapter,
  setGeheimnis,
  updateAdapter,
  type AdapterPatch,
} from '../../api/adapter';
import { ADAPTER_GEHEIMNIS_MAX, ADAPTER_NAME_MAX } from '../../api/eingabegrenzen';
import { globalKeys } from '../../api/queryKeys';
import type { AdapterAnzeige, AdapterArtAnzeige, AdapterPruefErgebnis } from '../../api/types';
import { ANBINDUNGEN_ABRUF_MS, anbindungenPath } from './anbindungAnzeige';
import {
  adapterZustandAnzeige,
  einstellungenVon,
  einstellungenVonAdapter,
  einstellungsRegeln,
  entferneAdapter,
  hostWechsel,
  speicherHinweisText,
  uebernimmAdapter,
  type HostWechsel,
} from './adapterAnzeige';
import { ADAPTER_LAN_WARNUNG, INTERVALL_MAX_S } from './AdapterPaneel';

/** Formularwerte: Name, Intervall und je Einstellungsfeld `e_<name>` (flach für das Paneel). */
type Werte = Record<string, unknown> & { name: string; intervall_s: number };

const feldName = (name: string) => `e_${name}`;

function werteVon(a: AdapterAnzeige, art: AdapterArtAnzeige | undefined): Werte {
  const e = einstellungenVonAdapter(a);
  const werte: Werte = { name: a.name, intervall_s: a.intervall_s };
  for (const f of art?.felder ?? []) werte[feldName(f.name)] = e[f.name] ?? null;
  return werte;
}

/**
 * Nur Geändertes: Name getrimmt, Intervall, und die Einstellungen als Ganzes, sobald sich eine
 * ändert (der Server ersetzt sie gemeinsam). Rein und exportiert für den Test.
 */
export function adapterPatch(
  art: AdapterArtAnzeige | undefined,
  vorher: Werte,
  nachher: Werte,
): AdapterPatch {
  const patch: AdapterPatch = {};
  const name = String(nachher.name ?? '').trim();
  if (name !== vorher.name) patch.name = name;
  if (nachher.intervall_s !== vorher.intervall_s) patch.intervall_s = nachher.intervall_s;
  if (art) {
    const von = (w: Werte) =>
      einstellungenVon(
        art.felder,
        Object.fromEntries(art.felder.map((f) => [f.name, w[feldName(f.name)]])),
      );
    const alt = von(vorher);
    const neu = von(nachher);
    if (JSON.stringify(alt) !== JSON.stringify(neu)) patch.einstellungen = neu;
  }
  return patch;
}

/** Abbruch der Rückfrage „Neues Ziel“: das Paneel bleibt offen und nennt den Grund. */
const ZIEL_NICHT_BESTAETIGT = 'Nicht gespeichert: das neue Ziel ist nicht bestätigt.';

/**
 * Ansicht eines Adapters `/admin/einstellungen/anbindungen/adapter/:adapterId` (LLH-2018, Entwurf
 * `docs/design/2026-11-22-adapter/Main.dc.html`). Kopf mit „Verbindung prüfen“,
 * „Anhalten“/„Fortsetzen“ und „Löschen …“; Paneele Zustand, Einstellungen
 * (`BearbeitbaresPaneel`, CAS über `geaendert_at`), Geheimnisse (`Geheimfeld` je Platz), Netz
 * (LAN-Ausnahme mit Rückfrage) und Letzte Versuche. Den Datensatz liefert die Liste der Seite
 * davor (ein Abruf, ein Cache-Fach), alle 30 s frisch. Trägt eine Änderung ein neues Ziel ein,
 * fragt die Seite vorher: der Server entfernt dann die Geheimnisse. Schreiben nur der
 * System-Admin, nie am gekoppelten ELW.
 */
export default function AdapterAnsicht() {
  const { adapterId } = useParams();
  const { benutzer } = useAuth();
  const isAdmin = benutzer?.system_rolle === 'admin';
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { token, rollen } = useRollen();
  const { konventionen: konv } = useAnzeigeKonventionen();
  /** Ergebnis von „Verbindung prüfen“ samt Stand, für den es galt; ein neuer Stand verwirft es. */
  const [pruefung, setPruefung] = useState<{
    ergebnis: AdapterPruefErgebnis;
    stand: string;
  } | null>(null);
  const [lanFrage, setLanFrage] = useState(false);
  const [loeschFrage, setLoeschFrage] = useState(false);
  const [zielFrage, setZielFrage] = useState<HostWechsel[] | null>(null);
  const zielAntwort = useRef<((ja: boolean) => void) | null>(null);

  const listeQ = useQuery({
    queryKey: globalKeys.adapter(),
    queryFn: loadAdapterListe,
    refetchInterval: ANBINDUNGEN_ABRUF_MS,
  });
  const versucheQ = useQuery({
    queryKey: globalKeys.adapterVersuche(adapterId ?? ''),
    queryFn: () => loadAdapterVersuche(adapterId ?? ''),
    refetchInterval: ANBINDUNGEN_ABRUF_MS,
    enabled: adapterId != null && listeQ.data?.adapter.some((a) => a.id === adapterId) === true,
  });
  const versucheNeu = () =>
    void qc.invalidateQueries({ queryKey: globalKeys.adapterVersuche(adapterId ?? '') });

  const pruefen = useMutation({
    ...SOFORT_ODER_NIE,
    mutationFn: ({ id }: { id: string; stand: string }) => checkAdapter(id),
    onSuccess: (ergebnis, { stand }) => {
      setPruefung({ ergebnis, stand });
      versucheNeu();
    },
  });
  const zustandWechsel = useMutation({
    ...SOFORT_ODER_NIE,
    mutationFn: ({ id, anhalten }: { id: string; anhalten: boolean }) =>
      anhalten ? haltAdapter(id) : resumeAdapter(id),
    onSuccess: (a) => uebernimmAdapter(qc, a),
  });
  const lan = useMutation({
    ...SOFORT_ODER_NIE,
    mutationFn: ({ a, an }: { a: AdapterAnzeige; an: boolean }) =>
      updateAdapter(a.id, { lan_erlaubt: an, basis_geaendert_at: a.geaendert_at }),
    onSuccess: (a) => {
      uebernimmAdapter(qc, a);
      setLanFrage(false);
    },
  });
  const loeschen = useMutation({
    ...SOFORT_ODER_NIE,
    mutationFn: (id: string) => deleteAdapter(id),
    onSuccess: (_, id) => {
      entferneAdapter(qc, id);
      void navigate(anbindungenPath());
    },
  });

  const liste = listeQ.data;
  const adapter = liste?.adapter.find((a) => a.id === adapterId);

  if (!liste) {
    if (listeQ.fetchStatus === 'paused') {
      return (
        <AdminPage titel="Adapter">
          <SeitenLeer
            titel="Ohne Verbindung nicht geladen"
            hinweis="Die Adapter lädt die Seite, sobald der Server wieder erreichbar ist."
          />
        </AdminPage>
      );
    }
    return listeQ.isError ? (
      <AdminPage titel="Adapter">
        <SeitenFehler
          text="Adapter nicht ladbar"
          ursache={listeQ.error}
          onWiederholen={() => void listeQ.refetch()}
          laedt={listeQ.isFetching}
        />
      </AdminPage>
    ) : (
      <SeitenSkeleton />
    );
  }
  if (!adapter) {
    return (
      <AdminPage titel="Adapter">
        <SeitenLeer
          titel="Adapter nicht gefunden"
          hinweis="Die Kennung gehört zu keinem Adapter dieser Organisation."
          aktion={{ label: 'Zu den Anbindungen', pfad: anbindungenPath() }}
        />
      </AdminPage>
    );
  }

  const art = liste.arten.find((x) => x.code === adapter.art);
  const gesperrt = liste.gesperrt_grund ?? null;
  const darfSchreiben = isAdmin && gesperrt == null;
  const grund = !isAdmin ? NUR_ADMIN : gesperrt != null ? 'am Hub anbinden' : undefined;
  const zeit = (w: string) => zeitKurz(w, konv);
  const zustand = adapterZustandAnzeige(adapter);
  // „Art unbekannt“ überdeckt „angehalten“ im Zustand; der Zeitpunkt sagt es trotzdem.
  const angehalten =
    adapter.angehalten_at != null ||
    adapter.zustand === 'aus' ||
    adapter.zustand === 'braucht_eingriff';
  const pruefErgebnis = pruefung?.stand === adapter.geaendert_at ? pruefung.ergebnis : null;
  const speicherText = speicherHinweisText(liste.speicher);
  const geheimnisseGesperrt =
    liste.speicher === 'fehlt' ? 'Geheimnisspeicher ohne Schlüssel' : undefined;
  const einstellungen = einstellungenVonAdapter(adapter);
  const zeigtEinstellungen = adapter.einstellungen != null;

  const fragZiel = (wechsel: HostWechsel[]) =>
    new Promise<boolean>((resolve) => {
      zielAntwort.current = resolve;
      setZielFrage(wechsel);
    });
  const beantworteZiel = (ja: boolean) => {
    zielAntwort.current?.(ja);
    zielAntwort.current = null;
    setZielFrage(null);
  };

  const speichern = async (patch: AdapterPatch, basis: string | undefined) => {
    if (patch.einstellungen && art) {
      // Gegen den Stand des Servers, nicht den Cache: nach einem Konflikt oder einem eben gesetzten
      // Geheimnis wäre der bis zu 30 s alt, und die Rückfrage fehlte, wo der Server löscht.
      const frisch = await qc.fetchQuery({
        queryKey: globalKeys.adapter(),
        queryFn: loadAdapterListe,
        staleTime: 0,
      });
      const jetzt = frisch.adapter.find((a) => a.id === adapter.id) ?? adapter;
      const wechsel = jetzt.geheimnisse.some((g) => g.is_gesetzt)
        ? hostWechsel(art.felder, einstellungenVonAdapter(jetzt), patch.einstellungen)
        : [];
      if (wechsel.length > 0 && !(await fragZiel(wechsel))) {
        throw new ApiError(0, ZIEL_NICHT_BESTAETIGT);
      }
    }
    const a = await updateAdapter(adapter.id, {
      ...patch,
      ...(basis !== undefined ? { basis_geaendert_at: basis } : {}),
    });
    uebernimmAdapter(qc, a);
  };

  const felder: BearbeitbaresFeld<Werte>[] = [
    {
      name: 'name',
      label: 'Name',
      anzeige: adapter.name,
      eingabe: <Input maxLength={ADAPTER_NAME_MAX} autoComplete="off" />,
      regeln: [
        pflicht('Name', { whitespace: true }),
        { max: ADAPTER_NAME_MAX, message: `Höchstens ${ADAPTER_NAME_MAX} Zeichen` },
      ],
    },
    {
      name: 'intervall_s',
      label: 'Intervall',
      anzeige: <span style={monoStil('mono')}>{`${adapter.intervall_s} s`}</span>,
      eingabe: <ZahlFeld min={art?.intervall_min_s ?? 1} max={INTERVALL_MAX_S} ganz einheit="s" />,
      regeln: [pflicht('Intervall')],
    },
    ...(zeigtEinstellungen && art
      ? art.felder.map((f): BearbeitbaresFeld<Werte> => ({
          name: feldName(f.name),
          label: f.bezeichnung,
          breit: f.typ === 'url' || f.typ === 'host',
          mono: f.typ !== 'text',
          anzeige: einstellungen[f.name] != null ? String(einstellungen[f.name]) : '—',
          eingabe:
            f.typ === 'zahl' ? (
              <ZahlFeld />
            ) : (
              <Input maxLength={f.max > 0 ? f.max : undefined} autoComplete="off" />
            ),
          regeln: einstellungsRegeln(f),
        }))
      : []),
  ];

  const nebenFehler = pruefen.error ?? zustandWechsel.error ?? lan.error;

  return (
    <AdminPage
      pfad={[
        { title: <ListenRueckweg to={anbindungenPath()}>Anbindungen</ListenRueckweg> },
        { title: adapter.name },
      ]}
      titel={
        <span
          style={{ display: 'inline-flex', gap: token.marginXS, alignItems: 'center' }}
          data-lfh="adapter-titel"
        >
          {adapter.name}
          <Status groesse="klein" ton={zustand.ton} wort={zustand.wort} />
        </span>
      }
      aktionen={
        isAdmin && (
          <Knopfreihe>
            <Button
              disabled={gesperrt != null || art == null}
              loading={pruefen.isPending}
              onClick={() => pruefen.mutate({ id: adapter.id, stand: adapter.geaendert_at })}
            >
              Verbindung prüfen
            </Button>
            <Button
              disabled={gesperrt != null}
              loading={zustandWechsel.isPending}
              onClick={() => zustandWechsel.mutate({ id: adapter.id, anhalten: !angehalten })}
            >
              {angehalten ? 'Fortsetzen' : 'Anhalten'}
            </Button>
            <Button
              danger
              disabled={gesperrt != null}
              onClick={() => {
                loeschen.reset();
                setLoeschFrage(true);
              }}
            >
              Löschen …
            </Button>
          </Knopfreihe>
        )
      }
      hinweis={
        <SeitenHinweise
          rechteFehlt={!isAdmin}
          rechteText={NUR_ADMIN}
          fehler={nebenFehler}
          fehlerTitel="Nicht ausgeführt"
        />
      }
    >
      {gesperrt && (
        <div style={{ marginBlockEnd: token.margin }}>
          <RechteHinweis sichtbar marke="Am Hub anbinden" text={gesperrt} />
        </div>
      )}
      {listeQ.isError && (
        <div style={{ marginBlockEnd: token.margin }}>
          <SeitenFehler
            text="Stand nicht aktuell: neu laden gescheitert"
            ursache={listeQ.error}
            onWiederholen={() => void listeQ.refetch()}
            laedt={listeQ.isFetching}
          />
        </div>
      )}
      <Stapel abstand="md">
        <Paneel
          titel="Zustand"
          fuss={
            pruefErgebnis && (
              <div data-lfh="adapter-pruefung" role="status">
                <Stapel richtung="zeile" umbruch abstand="sm" ausrichten="mitte">
                  <Status
                    groesse="klein"
                    ton={pruefErgebnis.erfolg ? 'normal' : 'achtung'}
                    wort={`Verbindung prüfen: ${adapterVersuchText({ ...pruefErgebnis, probe: false }).replace(/^abgerufen/, 'erreichbar')}`}
                  />
                  <span style={{ ...schriftStil('textKlein'), color: rollen.gedaempft }}>
                    <span style={monoStil('monoKlein')}>{`${pruefErgebnis.dauer_ms} ms`}</span>
                    {' · nichts übernommen'}
                  </span>
                </Stapel>
              </div>
            )
          }
        >
          <Datenraster spalten={4} beschriftung="Zustand">
            <Datenfeld label="Zustand">
              <Stapel abstand="xxs" ausrichten="start">
                <Status groesse="klein" ton={zustand.ton} wort={zustand.wort} />
                <span style={{ color: rollen.gedaempft }}>
                  {adapter.zustand === 'braucht_eingriff' && adapter.angehalten_grund
                    ? `angehalten: ${adapterFehlerText(adapter.angehalten_grund, adapter.letzter_fehler?.status)}`
                    : adapter.fehler_seit
                      ? `seit ${zeit(adapter.fehler_seit)}, ${adapter.fehlversuche} Fehlversuche`
                      : adapter.angehalten_at
                        ? `angehalten ${zeit(adapter.angehalten_at)}`
                        : null}
                </span>
              </Stapel>
            </Datenfeld>
            <Datenfeld label="Zuletzt erfolgreich">
              {adapter.letzter_erfolg_at ? (
                <Stapel abstand="xxs">
                  <span style={monoStil('mono')}>{zeit(adapter.letzter_erfolg_at)}</span>
                  {adapter.letzte_anzahl != null && (
                    <span style={{ color: rollen.gedaempft }}>
                      {adapter.letzte_anzahl === 1
                        ? '1 Eintrag'
                        : `${adapter.letzte_anzahl} Einträge`}
                    </span>
                  )}
                </Stapel>
              ) : (
                'noch nie'
              )}
            </Datenfeld>
            <Datenfeld label="Letzter Fehler">
              {adapter.letzter_fehler ? (
                <Stapel abstand="xxs">
                  <span>
                    {adapterFehlerText(adapter.letzter_fehler.art, adapter.letzter_fehler.status)}
                  </span>
                  <span style={{ ...monoStil('monoKlein'), color: rollen.gedaempft }}>
                    {zeit(adapter.letzter_fehler.at)}
                  </span>
                </Stapel>
              ) : (
                'keiner'
              )}
            </Datenfeld>
            <Datenfeld label="Nächster Versuch">
              {art == null ? (
                'ruft nicht ab'
              ) : angehalten ? (
                'angehalten'
              ) : adapter.naechster_abruf_at ? (
                <span style={monoStil('mono')}>{zeit(adapter.naechster_abruf_at)}</span>
              ) : (
                'sofort'
              )}
            </Datenfeld>
            <Datenfeld label="Art">
              {adapter.art_bezeichnung ?? adapter.art}{' '}
              <span style={{ ...monoStil('monoFein', 500), color: rollen.schwach }}>
                {adapter.art}
              </span>
            </Datenfeld>
            <Datenfeld label="Angelegt">{zeit(adapter.angelegt_at)}</Datenfeld>
          </Datenraster>
        </Paneel>

        <BearbeitbaresPaneel<Werte, AdapterPatch>
          key={adapter.id}
          titel="Einstellungen"
          datensatz={adapter}
          werte={werteVon(adapter, art)}
          felder={felder}
          patch={(vorher, nachher) => adapterPatch(art, vorher, nachher)}
          onSpeichern={speichern}
          onNeuLaden={() => void listeQ.refetch()}
          darfSchreiben={darfSchreiben && art != null}
          grund={grund ?? (art == null ? 'Art unbekannt' : undefined)}
          isSperrkonflikt={isVeraltet}
          modus="paneel"
          spalten={2}
        />

        <Paneel
          titel="Geheimnisse"
          meta={
            liste.speicher_fingerabdruck ? (
              <span>
                Schlüssel <span style={monoStil('monoKlein')}>{liste.speicher_fingerabdruck}</span>
              </span>
            ) : undefined
          }
          koerperPolster
        >
          <Stapel abstand="xs">
            {speicherText && (
              <div data-lfh="adapter-speicher">
                <RechteHinweis sichtbar marke="Geheimnisspeicher" text={speicherText} />
              </div>
            )}
            {adapter.geheimnisse.length === 0 ? (
              <span style={{ color: rollen.gedaempft }}>
                {art == null
                  ? 'Die Art kennt dieser Server nicht; ihre Plätze sind unbekannt.'
                  : 'Diese Art braucht keine Geheimnisse.'}
              </span>
            ) : (
              adapter.geheimnisse.map((platz) => (
                <Geheimfeld
                  key={platz.name}
                  platz={platz}
                  darfSchreiben={darfSchreiben}
                  gesperrt={geheimnisseGesperrt}
                  maxLaenge={ADAPTER_GEHEIMNIS_MAX}
                  onSetzen={async (wert) => {
                    await setGeheimnis(adapter.id, platz.name, wert);
                    void qc.invalidateQueries({ queryKey: globalKeys.adapter() });
                  }}
                  onEntfernen={async () => {
                    await deleteGeheimnis(adapter.id, platz.name);
                    void qc.invalidateQueries({ queryKey: globalKeys.adapter() });
                  }}
                />
              ))
            )}
          </Stapel>
        </Paneel>

        <Paneel titel="Netz" koerperPolster>
          <Stapel richtung="zeile" abstand="sm" ausrichten="start">
            <Switch
              id="adapter-lan"
              checked={adapter.lan_erlaubt}
              disabled={!darfSchreiben || art == null}
              loading={lan.isPending}
              aria-label="Ziel im eigenen Netz erlauben"
              onChange={(an) => {
                lan.reset();
                if (an) setLanFrage(true);
                else lan.mutate({ a: adapter, an: false });
              }}
            />
            <Stapel abstand="xxs">
              <label htmlFor="adapter-lan">Ziel im eigenen Netz erlauben</label>
              <span style={{ color: rollen.gedaempft }}>{ADAPTER_LAN_WARNUNG}</span>
            </Stapel>
          </Stapel>
        </Paneel>

        <Verlauf versuche={versucheQ} zeit={zeit} />
      </Stapel>

      <Modal
        open={zielFrage != null}
        title="Neues Ziel: Geheimnisse werden entfernt"
        okText="Speichern und entfernen"
        cancelText="Abbrechen"
        onOk={() => beantworteZiel(true)}
        onCancel={() => beantworteZiel(false)}
        destroyOnHidden
      >
        {zielFrage && (
          <Stapel abstand="sm">
            <Datenraster spalten={2} beschriftung="Ziel">
              {zielFrage.map((w) => (
                <Datenfeld key={w.feld} label={w.feld} mono breit>
                  {`${w.bisher ?? 'bisher keins'} → ${w.neu}`}
                </Datenfeld>
              ))}
            </Datenraster>
            <span>
              Die gespeicherten Geheimnisse gingen sonst an einen anderen Server. Nach dem Speichern
              sind sie entfernt und müssen neu gesetzt werden:{' '}
              {adapter.geheimnisse
                .filter((g) => g.is_gesetzt)
                .map((g) => g.bezeichnung)
                .join(', ')}
              .
            </span>
          </Stapel>
        )}
      </Modal>

      <Modal
        open={lanFrage}
        title="Ziel im eigenen Netz erlauben?"
        okText="Erlauben"
        cancelText="Abbrechen"
        okButtonProps={{ loading: lan.isPending }}
        onOk={() => lan.mutate({ a: adapter, an: true })}
        onCancel={() => setLanFrage(false)}
        destroyOnHidden
      >
        <p>
          Der Adapter darf dann auch Adressen im lokalen Netz abrufen, etwa einen Server der Wache.
          Loopback und Link-Local bleiben gesperrt. Nur einschalten, wenn das Ziel wirklich dort
          steht.
        </p>
        <SpeicherFehler fehler={lan.error} titel="Nicht geändert" />
      </Modal>

      <Modal
        open={loeschFrage}
        title={`${adapter.name} löschen?`}
        okText="Löschen"
        cancelText="Abbrechen"
        okButtonProps={{ danger: true, loading: loeschen.isPending }}
        cancelButtonProps={{ disabled: loeschen.isPending }}
        onOk={() => loeschen.mutate(adapter.id)}
        onCancel={() => {
          if (!loeschen.isPending) setLoeschFrage(false);
        }}
        destroyOnHidden
      >
        <p>
          Der Adapter ruft danach nichts mehr ab. Seine Geheimnisse und sein Verlauf werden mit
          gelöscht.
        </p>
        <SpeicherFehler fehler={loeschen.error} titel="Nicht gelöscht" />
      </Modal>
    </AdminPage>
  );
}

/** Paneel „Letzte Versuche“: Abrufe und Prüfungen, neueste zuerst, ohne Rumpf der Antwort. */
function Verlauf({
  versuche: q,
  zeit,
}: {
  versuche: ReturnType<typeof useQuery<Awaited<ReturnType<typeof loadAdapterVersuche>>>>;
  zeit: (w: string) => string;
}) {
  const { rollen } = useRollen();
  const versuche = q.data ?? [];
  return (
    <Paneel
      titel="Letzte Versuche"
      meta={q.data ? `${versuche.length} von höchstens 50` : undefined}
    >
      {q.isError && (
        <PaneelZeile>
          <SeitenFehler
            text={q.data ? 'Stand nicht aktuell: neu laden gescheitert' : 'Verlauf nicht ladbar'}
            ursache={q.error}
            onWiederholen={() => void q.refetch()}
            laedt={q.isFetching}
          />
        </PaneelZeile>
      )}
      {!q.data ? (
        !q.isError && (
          <PaneelZeile>
            <span style={{ color: rollen.gedaempft }}>
              {q.fetchStatus === 'paused'
                ? 'Ohne Verbindung nicht geladen.'
                : 'Verlauf wird geladen …'}
            </span>
          </PaneelZeile>
        )
      ) : versuche.length === 0 ? (
        <PaneelZeile>
          <span style={{ color: rollen.gedaempft }}>Noch kein Abruf.</span>
        </PaneelZeile>
      ) : (
        versuche.map((v, i) => (
          <PaneelZeile key={`${v.at}-${i}`}>
            <div data-lfh="adapter-versuch">
              <Stapel richtung="zeile" umbruch abstand="md" ausrichten="baseline">
                <span style={monoStil('monoKlein')}>{zeit(v.at)}</span>
                <span style={{ color: v.erfolg ? rollen.text : rollen.achtungText }}>
                  {adapterVersuchText(v)}
                </span>
                <span
                  style={{ ...monoStil('monoKlein'), color: rollen.gedaempft }}
                >{`${v.dauer_ms} ms`}</span>
              </Stapel>
            </div>
          </PaneelZeile>
        ))
      )}
    </Paneel>
  );
}
