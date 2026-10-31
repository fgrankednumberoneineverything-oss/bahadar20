// داخل MainActivity.onCreate
// enableEdgeToEdge()
setContent {
    var showSplash by remember { mutableStateOf(true) }
    if (showSplash) SplashScreen { showSplash = false } else MainScreen()
}
