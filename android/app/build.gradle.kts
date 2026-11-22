// App der Android-Hülle (LLH-1989): führt aus, was der Kern (`dev.rubeen.lifeline:kern`)
// entscheidet. Kotlin bringt das Android-Gradle-Plugin selbst mit (AGP 9), Compose über das
// Compiler-Plugin derselben Kotlin-Version.
plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.roborazzi)
}

// Version aus `[workspace.package]` über `scripts/android/version.sh` (Entwurf D4); ein lokaler
// Bau ohne die Umgebung heißt `0.0.0-dev` und prüft keine Updates.
val lifelineVersion: String = providers.environmentVariable("LIFELINE_VERSION").orElse("0.0.0-dev").get()
val lifelineVersionCode: Int = providers.environmentVariable("LIFELINE_VERSION_CODE").orElse("1").get().toInt()

android {
    namespace = "dev.rubeen.lifeline.android"
    // Übersetzt gegen 37.1, weil Compose ab BOM 2026.11 es verlangt (Robolectric 4.18 kennt 37);
    // das Laufzeitverhalten bleibt bei targetSdk 36, und Robolectric fährt die Bilder auf 36.
    compileSdk {
        version = release(37) { minorApiLevel = 1 }
    }

    defaultConfig {
        applicationId = "dev.rubeen.lifeline.android"
        minSdk = 29
        targetSdk = 36
        versionName = lifelineVersion
        versionCode = lifelineVersionCode
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    testOptions {
        // Robolectric braucht die Ressourcen der App (Thema, Texte, Symbol).
        unitTests.isIncludeAndroidResources = true
    }
}

kotlin {
    compilerOptions {
        jvmTarget = org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17
    }
}

// Bildlauf (Entwurf D10): jede native Seite als Bild unter `build/bilder/`, für die Bilder der
// Änderung. Die Tests schreiben immer (`roborazzi.test.record` in gradle.properties); verglichen
// wird nicht, im Repo liegen keine Sollbilder.
roborazzi {
    outputDir = layout.buildDirectory.dir("bilder")
}

dependencies {
    implementation("dev.rubeen.lifeline:kern")
    implementation(platform(libs.compose.bom))
    implementation(libs.compose.ui)
    implementation(libs.compose.foundation)
    implementation(libs.compose.material3)
    implementation(libs.activity.compose)
    implementation(libs.webkit)
    implementation(libs.browser)
    implementation(libs.camera.camera2)
    implementation(libs.camera.lifecycle)
    implementation(libs.camera.view)
    implementation(libs.camera.mlkit.vision)
    implementation(libs.mlkit.barcode)
    implementation(libs.work.runtime)

    testImplementation(libs.junit4)
    testImplementation(libs.robolectric)
    testImplementation(libs.roborazzi)
    testImplementation(libs.roborazzi.compose)
    testImplementation(libs.mockwebserver)
    testImplementation(libs.work.testing)
    testImplementation(platform(libs.compose.bom))
    testImplementation(libs.compose.ui.test.junit4)
    debugImplementation(libs.compose.ui.test.manifest)
}
