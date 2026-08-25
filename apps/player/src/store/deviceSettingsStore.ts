import { create } from 'zustand';

// Local, per-device kiosk settings — how *this physical browser/screen* behaves, as opposed to
// playerStore's pairing identity or the org-configured PlayerState from the API. Deliberately
// never synced to the backend: these describe how the device is mounted/booted, which is a
// property of the hardware in front of you, not something a remote dashboard should be able to
// silently change out from under an installer standing at the screen. (Orientation used to live
// here too, but is now dashboard-controlled — see Screen.orientation / PlayerState.orientation.)
interface DeviceSettings {
  // Whether playback begins automatically as soon as the browser/tab opens, vs. waiting for a
  // tap on the "Tap to start" gate (see PlayerPage). Off is useful for kiosks an installer wants
  // to confirm are pointed at the right content before it goes live.
  autoStart: boolean;
  muted: boolean;
  setAutoStart: (autoStart: boolean) => void;
  setMuted: (muted: boolean) => void;
}

export const useDeviceSettingsStore = create<DeviceSettings>(set => ({
  autoStart: localStorage.getItem('device_auto_start') !== 'false',
  muted: localStorage.getItem('device_muted') === 'true',

  setAutoStart(autoStart) {
    localStorage.setItem('device_auto_start', String(autoStart));
    set({ autoStart });
  },
  setMuted(muted) {
    localStorage.setItem('device_muted', String(muted));
    set({ muted });
  },
}));
