import LifelineKern
import SwiftUI

/// Wurzel der Hülle: zeigt die Seite, die `Ablauf` festlegt, und die nativen Blätter
/// (Serverliste, Onboarding für einen weiteren Server, Einstellungen).
struct RootView: View {
    @Environment(AppModell.self) private var modell
    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        @Bindable var modell = modell
        ZStack {
            Color("Kopfschwarz").ignoresSafeArea()
            inhalt
        }
        .sheet(isPresented: $modell.zeigtServerliste) {
            ServerlisteView()
        }
        .sheet(isPresented: $modell.zeigtOnboarding) {
            NavigationStack {
                OnboardingView(alsBlatt: true)
            }
        }
        .sheet(isPresented: $modell.zeigtEinstellungen) {
            NavigationStack {
                EinstellungenView()
                    .toolbar {
                        ToolbarItem(placement: .confirmationAction) {
                            Button("Fertig") { modell.zeigtEinstellungen = false }
                        }
                    }
            }
        }
        .confirmationDialog(
            "Server wechseln?",
            isPresented: Binding(
                get: { modell.wechselRueckfrage != nil },
                set: { if !$0 { modell.wechselRueckfrage = nil } }),
            titleVisibility: .visible,
            presenting: modell.wechselRueckfrage
        ) { eintrag in
            Button("Zu „\(eintrag.name)“ wechseln") { modell.wechseln(eintrag) }
            Button("Abbrechen", role: .cancel) {}
        } message: { eintrag in
            Text("Ein Link möchte die App mit \(eintrag.adresse.text) verbinden.")
        }
        .onOpenURL { modell.open($0) }
        .onChange(of: scenePhase) { _, phase in modell.scenePhase(phase) }
        .task { modell.start() }
    }

    @ViewBuilder
    private var inhalt: some View {
        switch modell.seite {
        case .onboarding:
            OnboardingView(alsBlatt: false)
        case .pruefung(let eintrag):
            VStack(spacing: 16) {
                ProgressView().tint(.white)
                Text("Verbinde mit „\(modell.aktuell(eintrag).name)“ …")
                    .foregroundStyle(Color(white: 0.91))
            }
            .accessibilityElement(children: .contain)
            .accessibilityIdentifier("pruefung")
            .overlay(alignment: .leading) { Randknopf() }
        case .web:
            if let webView = modell.webView {
                WebviewHost(webView: webView)
                    .id(ObjectIdentifier(webView))
                    .overlay(alignment: .leading) { Randknopf() }
                    .overlay(alignment: .top) {
                        if modell.zeigtZurOberflaeche { ZurOberflaecheHinweis() }
                    }
                    .animation(.easeOut(duration: 0.2), value: modell.zeigtZurOberflaeche)
            }
        case .status(let eintrag, let status):
            StatusView(eintrag: modell.aktuell(eintrag), status: status)
        }
    }
}

/// Kleiner Knopf am linken Rand zur Serverliste; schmal, damit er die Oberfläche nicht verdeckt
/// (Entwurf D2).
struct Randknopf: View {
    @Environment(AppModell.self) private var modell

    var body: some View {
        Button {
            modell.zeigtServerliste = true
        } label: {
            Image(systemName: "server.rack")
                .font(.system(size: 11, weight: .semibold))
                .frame(width: 18, height: 44)
                .background(.ultraThinMaterial, in: UnevenRoundedRectangle(
                    bottomTrailingRadius: 9, topTrailingRadius: 9))
        }
        .buttonStyle(.plain)
        .foregroundStyle(.secondary)
        .opacity(0.8)
        .accessibilityLabel("Serverliste")
        .accessibilityIdentifier("serverliste-knopf")
    }
}

/// Hinweis über dem Webview, wenn er nach der Rückkehr auf einer fremden Seite steht (`Ablauf`,
/// `.showZurOberflaeche`). Kein Zwang: die Seite bleibt, bis die Person „Zur Oberfläche“ wählt.
struct ZurOberflaecheHinweis: View {
    @Environment(AppModell.self) private var modell

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: "globe")
                .foregroundStyle(.secondary)
                .accessibilityHidden(true)
            Text("Fremde Seite")
                .font(.subheadline)
                .lineLimit(1)
            Spacer(minLength: 4)
            Button("Zur Oberfläche") { modell.zurOberflaeche() }
                .font(.subheadline.weight(.semibold))
                .buttonStyle(.borderedProminent)
                .controlSize(.small)
                .accessibilityIdentifier("hinweis-zur-oberflaeche")
            Button {
                modell.verwerfeZurOberflaeche()
            } label: {
                Image(systemName: "xmark")
                    .font(.footnote.weight(.semibold))
                    .frame(width: 28, height: 28)
            }
            .buttonStyle(.plain)
            .foregroundStyle(.secondary)
            .accessibilityLabel("Hinweis schließen")
            .accessibilityIdentifier("hinweis-schliessen")
        }
        .padding(.leading, 14)
        .padding(.trailing, 6)
        .padding(.vertical, 6)
        .background(.regularMaterial, in: Capsule())
        .padding(.horizontal, 16)
        .padding(.top, 8)
        .transition(.move(edge: .top).combined(with: .opacity))
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("hinweis-fremde-seite")
    }
}
