import { useEffect, useState } from 'react';
import { Layout, Space, Spin } from 'antd';
import { Outlet, useLocation, useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ladeEinsatz } from '../api/einsaetze';
import { useAuth } from '../auth/AuthContext';
import {
  kategorien, modulRegistry, moduleNachKategorie,
  type KategorieKey, type ModulEintrag,
} from './modulRegistry';
import EinsatzSwitcher from './EinsatzSwitcher';
import IconRail from './IconRail';
import ModulPanel from './ModulPanel';
import ThemeToggle from '../components/ThemeToggle';
import BenutzerMenu from '../components/BenutzerMenu';

const { Header, Content } = Layout;

/** Ebene 2: Einsatz-Workspace mit Switcher-Header, Icon-Rail und Modul-Panel. */
export default function EinsatzLayout() {
  const { id } = useParams();
  const einsatzId = Number(id);
  const { benutzer } = useAuth();
  const navigate = useNavigate();
  const { pathname } = useLocation();

  // Modul-Segment ist der Pfad-Teil direkt nach der Einsatz-ID
  // (…/einsaetze/:id/<route>/…) — nicht das letzte Segment, sonst verliert das
  // Menü auf Sub-Routen (Detail, Liste) die Hervorhebung.
  const aktuellesSegment = pathname.split('/').filter(Boolean)[2];
  const aktuellesModul = modulRegistry.find((m) => m.route === aktuellesSegment);
  const aktiveKategorie: KategorieKey | null = aktuellesModul?.kategorie ?? null;

  const [offeneKategorie, setOffeneKategorie] = useState<KategorieKey | null>(aktiveKategorie);

  // Panel an die aktuelle Modul-Kategorie angleichen (auch nach Default-Redirect, der kein Remount auslöst).
  useEffect(() => {
    setOffeneKategorie(aktiveKategorie);
  }, [aktiveKategorie]);

  const { data: einsatz, isLoading } = useQuery({
    queryKey: ['einsatz', einsatzId],
    queryFn: () => ladeEinsatz(einsatzId),
  });

  function onKategorieKlick(key: KategorieKey) {
    setOffeneKategorie((aktuell) => (aktuell === key ? null : key));
  }

  function onModulKlick(modul: ModulEintrag) {
    navigate(`/einsaetze/${einsatzId}/${modul.route}`);
  }

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Header style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        {isLoading ? (
          <Spin />
        ) : (
          <EinsatzSwitcher aktuellName={einsatz?.bezeichnung ?? 'Einsatz'} />
        )}
        <Space style={{ marginLeft: 'auto' }} size="middle">
          <ThemeToggle />
          <BenutzerMenu />
        </Space>
      </Header>
      <Layout hasSider>
        <IconRail
          kategorien={kategorien}
          aktiveKategorie={offeneKategorie ?? aktiveKategorie}
          onKategorieKlick={onKategorieKlick}
        />
        {offeneKategorie && (
          <ModulPanel
            titel={kategorien.find((k) => k.key === offeneKategorie)!.label}
            module={moduleNachKategorie(offeneKategorie)}
            benutzer={benutzer}
            aktiverModulKey={aktuellesModul?.key ?? null}
            onModulKlick={onModulKlick}
          />
        )}
        <Content style={{ padding: 24 }}>
          <Outlet />
        </Content>
      </Layout>
    </Layout>
  );
}
