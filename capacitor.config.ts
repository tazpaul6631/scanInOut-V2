import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'com.scaninoutv2.app',
  appName: 'scanInOutV2',
  webDir: 'dist',
  server: {
    // HTTP page so the WebView can call an HTTP API (https://localhost + http://API = mixed content).
    androidScheme: 'http',
    cleartext: true,
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 1200,
      backgroundColor: '#0f172a',
    },
    CapacitorSQLite: {
      iosDatabaseLocation: 'Library/CapacitorDatabase',
      iosIsEncryption: false,
      androidIsEncryption: false,
      electronIsEncryption: false,
      electronWindowsLocation: 'C:\\ProgramData\\scanInOutV2\\Databases',
      electronMacLocation: 'Databases',
      electronLinuxLocation: 'Databases',
    },
  },
}

export default config
