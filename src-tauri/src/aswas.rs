//! `ASWebAuthenticationSession` für „Im Browser anmelden“ (LFH-818, nur macOS).
//!
//! Gemessen am 30.09.2026 (`openspec/changes/lfh-818-anmeldung-im-systembrowser/belege/`):
//! die Sitzung gibt an den Standardbrowser ab, dort tragen Passkeys für Lifeline und den IdP,
//! und der Rücksprung erreicht nur den Completion-Handler, nicht Launch Services.
//!
//! Alles hier läuft auf dem Hauptthread (AppKit). Die laufende Sitzung hält ein Thread-Local,
//! damit ein neuer Start die alte abbrechen kann. Der Anker (Präsentationskontext) ist eine
//! schwache Eigenschaft der Sitzung und liegt deshalb mit ihr im Thread-Local. Jede Sitzung trägt
//! eine Generation (`anmeldung::Lauf`): der Handler einer ersetzten Sitzung beendet nie die neue.

use std::cell::RefCell;

use block2::RcBlock;
use objc2::rc::Retained;
use objc2::runtime::{NSObject, NSObjectProtocol, ProtocolObject};
use objc2::{
    define_class, msg_send, AllocAnyThread, DefinedClass, MainThreadMarker, MainThreadOnly,
};
use objc2_authentication_services::{
    ASPresentationAnchor, ASWebAuthenticationPresentationContextProviding,
    ASWebAuthenticationSession,
};
use objc2_foundation::{NSError, NSString, NSURL};

use crate::anmeldung::Lauf;

/// `ASWebAuthenticationSessionErrorCodeCanceledLogin`: die Person hat das Fenster geschlossen.
pub const ABGEBROCHEN: isize = 1;

pub struct AnkerIvars {
    fenster: Retained<NSObject>,
}

define_class!(
    #[unsafe(super(NSObject))]
    #[thread_kind = MainThreadOnly]
    #[name = "LifelineAnmeldeAnker"]
    #[ivars = AnkerIvars]
    struct Anker;

    unsafe impl NSObjectProtocol for Anker {}

    unsafe impl ASWebAuthenticationPresentationContextProviding for Anker {
        #[unsafe(method_id(presentationAnchorForWebAuthenticationSession:))]
        fn anker(&self, _sitzung: &ASWebAuthenticationSession) -> Retained<ASPresentationAnchor> {
            self.ivars().fenster.clone()
        }
    }
);

impl Anker {
    fn neu(mtm: MainThreadMarker, fenster: Retained<NSObject>) -> Retained<Self> {
        let this = Self::alloc(mtm).set_ivars(AnkerIvars { fenster });
        unsafe { msg_send![super(this), init] }
    }
}

type Sitzung = (Retained<ASWebAuthenticationSession>, Retained<Anker>);

thread_local! {
    static LAUFEND: RefCell<Lauf<Sitzung>> = RefCell::new(Lauf::default());
}

/// Ergebnis einer Sitzung: die Rücksprung-URL oder (Fehlercode, Text).
pub type Ergebnis = Result<String, (isize, String)>;

/// Startet eine Sitzung für `adresse` mit Rücksprung-Schema `schema`, verankert an `ns_window`.
/// Eine laufende Sitzung wird vorher abgebrochen. `fertig` läuft auf dem Hauptthread.
pub fn starten(
    ns_window: *mut std::ffi::c_void,
    adresse: &str,
    schema: &str,
    ephemer: bool,
    fertig: impl Fn(Ergebnis) + 'static,
) -> Result<(), String> {
    let mtm = MainThreadMarker::new().ok_or("nicht auf dem Hauptthread")?;
    let fenster: Retained<NSObject> =
        unsafe { Retained::retain(ns_window.cast::<NSObject>()) }.ok_or("kein Fenster")?;
    let url = NSURL::URLWithString(&NSString::from_str(adresse)).ok_or("Adresse ungültig")?;

    abbrechen();
    let generation = LAUFEND.with(|l| l.borrow_mut().naechste());

    let block = RcBlock::new(move |ruecksprung: *mut NSURL, fehler: *mut NSError| {
        debug_assert!(
            MainThreadMarker::new().is_some(),
            "Handler der Anmeldesitzung außerhalb des Hauptthreads"
        );
        let ergebnis = if let Some(url) = unsafe { ruecksprung.as_ref() } {
            Ok(url
                .absoluteString()
                .map(|s| s.to_string())
                .unwrap_or_default())
        } else if let Some(fehler) = unsafe { fehler.as_ref() } {
            Err((fehler.code(), fehler.localizedDescription().to_string()))
        } else {
            Err((0, "Sitzung ohne Ergebnis beendet".to_string()))
        };
        // Nur die eigene Sitzung beenden, und erst nach `fertig` freigeben: sie hält den Block,
        // der gerade läuft.
        let beendet = LAUFEND.with(|l| l.borrow_mut().beende(generation));
        fertig(ergebnis);
        drop(beendet);
    });
    // Der Initialisierer kopiert den Block; `block` darf danach fallen.
    #[allow(deprecated)]
    let sitzung = unsafe {
        ASWebAuthenticationSession::initWithURL_callbackURLScheme_completionHandler(
            ASWebAuthenticationSession::alloc(),
            &url,
            Some(&NSString::from_str(schema)),
            RcBlock::as_ptr(&block),
        )
    };
    let anker = Anker::neu(mtm, fenster);
    unsafe {
        sitzung.setPresentationContextProvider(Some(ProtocolObject::from_ref(&*anker)));
        sitzung.setPrefersEphemeralWebBrowserSession(ephemer);
    }
    if !unsafe { sitzung.start() } {
        return Err("Die Anmeldung im Browser ließ sich nicht starten.".to_string());
    }
    LAUFEND.with(|l| l.borrow_mut().merke(generation, (sitzung, anker)));
    Ok(())
}

/// Bricht eine laufende Sitzung ab (deren Handler meldet dann den Abbruch).
pub fn abbrechen() {
    // Außerhalb der Borrow-Klammer abbrechen: meldet `cancel` den Abbruch synchron, greift der
    // Handler selbst auf `LAUFEND` zu.
    let laufend = LAUFEND.with(|l| l.borrow_mut().nimm());
    if let Some((sitzung, _anker)) = laufend {
        unsafe { sitzung.cancel() };
    }
}
