package dev.rubeen.lifeline.android

import android.Manifest
import android.app.Activity
import android.content.ClipData
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.webkit.GeolocationPermissions
import android.webkit.MimeTypeMap
import android.webkit.PermissionRequest
import android.webkit.WebChromeClient
import android.webkit.WebView
import androidx.activity.ComponentActivity
import androidx.test.core.app.ApplicationProvider
import dev.rubeen.lifeline.android.dienste.Activityzugriffe
import dev.rubeen.lifeline.android.web.HuellenChromeClient
import dev.rubeen.lifeline.android.web.Webzugriffe
import dev.rubeen.lifeline.android.web.dateiwahlErgebnis
import dev.rubeen.lifeline.kern.Seitenzugriff
import dev.rubeen.lifeline.kern.ServerAdresse
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config

/**
 * Dateiwahl und Kamera der Oberfläche (Review W4): `<input type="file">` öffnet den Systemdialog,
 * `getUserMedia` bekommt die Kamera nur für den aktiven Server und nur mit dem Recht `CAMERA`.
 * Den Standort (`navigator.geolocation`, LLH-2071) bekommt ebenso nur der aktive Server, und nur
 * mit dem Recht der App, fein oder grob.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [36])
class SeitenzugriffeTest {
    private val context: Context = ApplicationProvider.getApplicationContext()
    private val elw = ServerAdresse.parse("https://elw.local:8443")
    private var aktiverServer: ServerAdresse? = elw

    /** Merkt sich den Dialog; die Kamera erlaubt oder verweigert [kameraErlaubt]. */
    private val zugriffe = object : Webzugriffe {
        var intent: Intent? = null
        var fertig: ((Array<Uri>?) -> Unit)? = null
        var kameraErlaubt = true
        var kameraGefragt = 0
        var standortErlaubt = true
        var standortGefragt = 0

        /** Läuft vor der Antwort auf die Rückfrage nach dem Standort (Serverwechsel währenddessen). */
        var waehrendStandortfrage: () -> Unit = {}

        override fun waehleDateien(intent: Intent, fertig: (Array<Uri>?) -> Unit): Boolean {
            this.intent = intent
            this.fertig = fertig
            return true
        }

        override fun kamera(fertig: (Boolean) -> Unit) {
            kameraGefragt += 1
            fertig(kameraErlaubt)
        }

        override fun standort(fertig: (Boolean) -> Unit) {
            standortGefragt += 1
            waehrendStandortfrage()
            fertig(standortErlaubt)
        }
    }

    /** Merkt sich die Antwort des Rückrufs an den WebView. */
    private class Standortantwort : GeolocationPermissions.Callback {
        val antworten = mutableListOf<Triple<String?, Boolean, Boolean>>()

        override fun invoke(origin: String?, allow: Boolean, retain: Boolean) {
            antworten += Triple(origin, allow, retain)
        }
    }

    private fun fragStandort(origin: String, client: HuellenChromeClient = chrome): Standortantwort =
        Standortantwort().also { client.onGeolocationPermissionsShowPrompt(origin, it) }
    private val chrome = HuellenChromeClient({ _, _ -> }, aktiverServer = { aktiverServer }, zugriffe = zugriffe)
    private val webView = WebView(context)

    private class Params(private val accept: Array<String>, private val modus: Int) : WebChromeClient.FileChooserParams() {
        override fun getMode(): Int = modus

        override fun getAcceptTypes(): Array<String> = accept

        override fun isCaptureEnabled(): Boolean = false

        override fun getTitle(): CharSequence? = null

        override fun getFilenameHint(): String? = null

        override fun createIntent(): Intent = Intent(Intent.ACTION_GET_CONTENT).setType(accept.firstOrNull() ?: "*/*")
    }

    private class Anfrage(private val origin: String, private val ressourcen: Array<String>) : PermissionRequest() {
        var erlaubt: List<String>? = null
        var abgelehnt = false

        override fun getOrigin(): Uri = Uri.parse(origin)

        override fun getResources(): Array<String> = ressourcen

        override fun grant(resources: Array<String>) {
            erlaubt = resources.toList()
        }

        override fun deny() {
            abgelehnt = true
        }
    }

    @Suppress("DEPRECATION") // Robolectric kennt sonst keine Endungen.
    @Test
    fun `die Dateiwahl nennt die Typen aus accept und erlaubt mehrere Dateien`() {
        shadowOf(MimeTypeMap.getSingleton()).addExtensionMimeTypeMapping("pdf", "application/pdf")
        shadowOf(MimeTypeMap.getSingleton()).addExtensionMimeTypeMapping("png", "image/png")
        var gewaehlt: Array<Uri>? = arrayOf()

        val offen = chrome.onShowFileChooser(webView, { gewaehlt = it }, Params(arrayOf(".pdf,.png"), WebChromeClient.FileChooserParams.MODE_OPEN_MULTIPLE))

        assertTrue(offen)
        val intent = zugriffe.intent!!
        assertEquals(Intent.ACTION_GET_CONTENT, intent.action)
        assertTrue(intent.hasCategory(Intent.CATEGORY_OPENABLE))
        assertEquals("*/*", intent.type)
        assertArrayEquals(arrayOf("application/pdf", "image/png"), intent.getStringArrayExtra(Intent.EXTRA_MIME_TYPES))
        assertTrue(intent.getBooleanExtra(Intent.EXTRA_ALLOW_MULTIPLE, false))

        val a = Uri.parse("content://dokumente/1")
        val b = Uri.parse("content://dokumente/2")
        val daten = Intent().apply { clipData = ClipData.newRawUri("", a).apply { addItem(ClipData.Item(b)) } }
        zugriffe.fertig!!(dateiwahlErgebnis(Activity.RESULT_OK, daten))
        assertArrayEquals(arrayOf(a, b), gewaehlt)
    }

    @Test
    fun `eine Datei mit einem Typ, abbrechen meldet nichts gewählt`() {
        var gewaehlt: Array<Uri>? = arrayOf()

        chrome.onShowFileChooser(webView, { gewaehlt = it }, Params(arrayOf("image/png"), WebChromeClient.FileChooserParams.MODE_OPEN))

        val intent = zugriffe.intent!!
        assertEquals("image/png", intent.type)
        assertFalse(intent.hasExtra(Intent.EXTRA_MIME_TYPES))
        assertFalse(intent.getBooleanExtra(Intent.EXTRA_ALLOW_MULTIPLE, false))
        zugriffe.fertig!!(dateiwahlErgebnis(Activity.RESULT_CANCELED, null))
        assertNull(gewaehlt)
    }

    @Test
    fun `ohne Zugriffe lehnt der WebView die Dateiwahl selbst ab`() {
        val ohne = HuellenChromeClient({ _, _ -> })
        assertFalse(ohne.onShowFileChooser(webView, {}, Params(arrayOf(), WebChromeClient.FileChooserParams.MODE_OPEN)))
    }

    @Test
    fun `die Seite des aktiven Servers bekommt nur die Kamera`() {
        assertEquals(PermissionRequest.RESOURCE_VIDEO_CAPTURE, Seitenzugriff.VIDEO_CAPTURE)
        val anfrage = Anfrage("https://elw.local:8443/", arrayOf(PermissionRequest.RESOURCE_VIDEO_CAPTURE, PermissionRequest.RESOURCE_AUDIO_CAPTURE))

        chrome.onPermissionRequest(anfrage)

        assertEquals(listOf(PermissionRequest.RESOURCE_VIDEO_CAPTURE), anfrage.erlaubt)
        assertFalse(anfrage.abgelehnt)
    }

    @Test
    fun `fremde Origins, Mikrofon allein und eine verweigerte Kamera werden abgelehnt`() {
        for (anfrage in listOf(
            Anfrage("https://idp.example/", arrayOf(PermissionRequest.RESOURCE_VIDEO_CAPTURE)),
            Anfrage("https://elw.local:8443/", arrayOf(PermissionRequest.RESOURCE_AUDIO_CAPTURE)),
        )) {
            chrome.onPermissionRequest(anfrage)
            assertTrue(anfrage.abgelehnt)
            assertNull(anfrage.erlaubt)
        }
        assertEquals("ohne Freigabe fragt die App nicht nach dem Recht", 0, zugriffe.kameraGefragt)

        zugriffe.kameraErlaubt = false
        val verweigert = Anfrage("https://elw.local:8443/", arrayOf(PermissionRequest.RESOURCE_VIDEO_CAPTURE))
        chrome.onPermissionRequest(verweigert)
        assertTrue(verweigert.abgelehnt)
        assertNull(verweigert.erlaubt)
    }

    @Test
    fun `ohne aktiven Server bekommt keine Seite die Kamera`() {
        aktiverServer = null
        val anfrage = Anfrage("https://elw.local:8443/", arrayOf(PermissionRequest.RESOURCE_VIDEO_CAPTURE))

        chrome.onPermissionRequest(anfrage)

        assertTrue(anfrage.abgelehnt)
    }

    @Test
    fun `die Activity öffnet den Dialog und meldet das Ergebnis`() {
        val steuerung = Robolectric.buildActivity(ComponentActivity::class.java)
        val zugriffe = Activityzugriffe(steuerung.get())
        val activity = steuerung.setup().get()
        var gewaehlt: Array<Uri>? = null
        val datei = Uri.parse("content://dokumente/7")

        assertTrue(zugriffe.waehleDateien(Intent(Intent.ACTION_GET_CONTENT).setType("*/*")) { gewaehlt = it })
        val gestartet = shadowOf(activity).nextStartedActivityForResult
        assertEquals(Intent.ACTION_GET_CONTENT, gestartet.intent.action)
        shadowOf(activity).receiveResult(gestartet.intent, Activity.RESULT_OK, Intent().setData(datei))

        assertArrayEquals(arrayOf(datei), gewaehlt)
    }

    @Suppress("DEPRECATION") // Die Antwort des Systems kommt über diesen Rückruf.
    @Test
    fun `mit dem Recht CAMERA fragt die Activity nicht, ohne fragt sie`() {
        val steuerung = Robolectric.buildActivity(ComponentActivity::class.java)
        val zugriffe = Activityzugriffe(steuerung.get())
        val activity = steuerung.setup().get()
        var ergebnis: Boolean? = null

        zugriffe.kamera { ergebnis = it }
        val frage = shadowOf(activity).lastRequestedPermission
        assertArrayEquals(arrayOf(Manifest.permission.CAMERA), frage.requestedPermissions)
        activity.onRequestPermissionsResult(frage.requestCode, frage.requestedPermissions, intArrayOf(PackageManager.PERMISSION_DENIED))
        assertEquals(false, ergebnis)

        shadowOf(activity).grantPermissions(Manifest.permission.CAMERA)
        zugriffe.kamera { ergebnis = it }
        assertEquals(true, ergebnis)
    }

    @Test
    fun `der aktive Server bekommt den Standort, wenn die App das Recht hat`() {
        val antwort = fragStandort("https://elw.local:8443")

        assertEquals(listOf(Triple("https://elw.local:8443", true, false)), antwort.antworten)
        assertEquals(1, zugriffe.standortGefragt)
    }

    @Test
    fun `ohne Recht der App bleibt der Standort zu`() {
        zugriffe.standortErlaubt = false

        val antwort = fragStandort("https://elw.local:8443")

        assertEquals(listOf(Triple("https://elw.local:8443", false, false)), antwort.antworten)
    }

    @Test
    fun `eine fremde Origin bekommt keinen Standort und die App fragt nicht`() {
        for (origin in listOf("https://idp.example", "http://elw.local:8443", "https://elw.local", "null")) {
            val antwort = fragStandort(origin)
            assertEquals(listOf(Triple(origin, false, false)), antwort.antworten)
        }
        assertEquals(0, zugriffe.standortGefragt)
    }

    @Test
    fun `wechselt der Server während der Rückfrage, bleibt der Standort zu`() {
        zugriffe.waehrendStandortfrage = { aktiverServer = null }

        val antwort = fragStandort("https://elw.local:8443")

        assertEquals(listOf(Triple("https://elw.local:8443", false, false)), antwort.antworten)
    }

    @Test
    fun `ohne Zugriffe lehnt der WebView den Standort ab`() {
        val ohne = HuellenChromeClient({ _, _ -> }, aktiverServer = { elw })

        val antwort = fragStandort("https://elw.local:8443", ohne)

        assertEquals(listOf(Triple("https://elw.local:8443", false, false)), antwort.antworten)
    }

    @Suppress("DEPRECATION") // Die Antwort des Systems kommt über diesen Rückruf.
    @Test
    fun `die Activity meldet den Standort erlaubt, wenn fein oder grob gewährt ist`() {
        val steuerung = Robolectric.buildActivity(ComponentActivity::class.java)
        val zugriffe = Activityzugriffe(steuerung.get())
        val activity = steuerung.setup().get()
        var ergebnis: Boolean? = null

        zugriffe.standort { ergebnis = it }
        val frage = shadowOf(activity).lastRequestedPermission
        assertArrayEquals(
            arrayOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION),
            frage.requestedPermissions,
        )
        // Android 12+: die Person wählt „ungefähr“, nur das grobe Recht kommt.
        activity.onRequestPermissionsResult(
            frage.requestCode,
            frage.requestedPermissions,
            intArrayOf(PackageManager.PERMISSION_DENIED, PackageManager.PERMISSION_GRANTED),
        )
        assertEquals(true, ergebnis)

        val ohne = Robolectric.buildActivity(ComponentActivity::class.java)
        val ohneZugriffe = Activityzugriffe(ohne.get())
        val ohneActivity = ohne.setup().get()
        ohneZugriffe.standort { ergebnis = it }
        val zweite = shadowOf(ohneActivity).lastRequestedPermission
        ohneActivity.onRequestPermissionsResult(
            zweite.requestCode,
            zweite.requestedPermissions,
            intArrayOf(PackageManager.PERMISSION_DENIED, PackageManager.PERMISSION_DENIED),
        )
        assertEquals(false, ergebnis)

        shadowOf(ohneActivity).grantPermissions(Manifest.permission.ACCESS_COARSE_LOCATION)
        ergebnis = null
        ohneZugriffe.standort { ergebnis = it }
        assertEquals("mit dem groben Recht fragt die App nicht mehr", true, ergebnis)
    }
}
