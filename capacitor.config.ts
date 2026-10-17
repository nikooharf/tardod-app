import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'ir.local.tardod',
  appName: 'دفتر تردد',
  webDir: 'www',
  backgroundColor: '#AE3A2E',
  android: {
    backgroundColor: '#AE3A2E'
  },
  ios: {
    backgroundColor: '#AE3A2E'
  },
  // Enabled only so the optional "sync to Mizito" feature (phase 7) can make a
  // native HTTP request that isn't subject to browser CORS restrictions.
  // Every other feature in the app remains fully offline and never touches this.
  plugins: {
    CapacitorHttp: {
      enabled: true
    },
    LocalNotifications: {
      iconColor: '#AE3A2E'
    }
  }
};

export default config;
