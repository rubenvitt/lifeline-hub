// Android-Hülle (LLH-1989). Der Kern ist ein eigenständiger Build ohne Android-SDK
// (`android/kern`); die App kommt als Modul dazu, sobald sie gebaut wird.
rootProject.name = "lifeline-android"

includeBuild("kern")
