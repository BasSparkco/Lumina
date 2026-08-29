import { useState, useSyncExternalStore } from 'react';
import { useNavigate } from 'react-router-dom';
import { clearLocalPlayerData } from '../lib/local-player-data';
import {
  getMediaStorageDiagnostic,
  subscribeMediaStorageDiagnostic,
} from '../lib/media-storage';
import {
  getConnectivityDiagnostic,
  subscribeConnectivity,
} from '../lib/connectivity';
import { disconnectSocket } from '../lib/socket';
import { usePlayerStore } from '../store/playerStore';
import { useDeviceSettingsStore } from '../store/deviceSettingsStore';

// Best-effort tab close — window.close() is only honored by the browser for tabs the page
// itself opened via script; a kiosk browser running in --app/kiosk mode generally allows it
// regardless, but a plain tab a person opened by hand may just silently ignore the call, which
// is the best any web page can do here (there's no way to detect or force it further).
function closeTab() {
  window.open('', '_self');
  window.close();
}

export default function PlayerControlPanel() {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const { forget } = usePlayerStore();
  const { autoStart, muted, setAutoStart, setMuted } = useDeviceSettingsStore();
  const storage = useSyncExternalStore(
    subscribeMediaStorageDiagnostic,
    getMediaStorageDiagnostic,
    getMediaStorageDiagnostic,
  );
  const connectivity = useSyncExternalStore(
    subscribeConnectivity,
    getConnectivityDiagnostic,
    getConnectivityDiagnostic,
  );

  async function handleUnpair() {
    if (!window.confirm('Unpair this device? It will need a new pairing code to reconnect.')) return;
    disconnectSocket();
    await clearLocalPlayerData();
    forget();
    void navigate('/');
  }

  return (
    <>
      <button
        aria-label="Player settings"
        onClick={() => setOpen(true)}
        style={styles.trigger}
      >
        <GearIcon />
      </button>

      {open && (
        <>
          <div style={styles.backdrop} onClick={() => setOpen(false)} />
          <div style={styles.panel}>
            <div style={styles.header}>
              <span style={styles.title}>Player Controls</span>
              <button aria-label="Close" onClick={() => setOpen(false)} style={styles.closeButton}>×</button>
            </div>

            <Section title="Auto start">
              <ToggleRow
                label={autoStart ? 'On — plays as soon as the browser opens' : 'Off — waits for a tap to start'}
                checked={autoStart}
                onChange={setAutoStart}
              />
            </Section>

            <Section title="Sound">
              <ToggleRow label={muted ? 'Muted' : 'Unmuted'} checked={!muted} onChange={v => setMuted(!v)} />
            </Section>

            <Section title="Connectivity">
              <div style={styles.storageRow}>
                <span style={{
                  ...styles.storageState,
                  color: connectivity.state === 'ONLINE'
                    ? '#4ade80'
                    : connectivity.state === 'CHECKING'
                      ? '#facc15'
                      : connectivity.state === 'DEGRADED'
                        ? '#fb923c'
                        : '#93c5fd',
                }}>
                  {connectivity.state}
                </span>
                <span style={styles.storageUsage}>
                  Browser {connectivity.browserOnline ? 'online' : 'offline'}
                </span>
              </div>
              <div style={styles.storageMessage}>{connectivity.message}</div>
              {connectivity.lastSuccessAt !== null && (
                <div style={styles.storageQuota}>
                  Last server contact: {new Date(connectivity.lastSuccessAt).toLocaleString()}
                </div>
              )}
            </Section>

            <Section title="Persistent media storage">
              <div style={styles.storageRow}>
                <span style={{
                  ...styles.storageState,
                  color: storage.state === 'READY' ? '#4ade80' : storage.state === 'INITIALIZING' ? '#facc15' : '#fb7185',
                }}>
                  {storage.state}
                </span>
                <span style={styles.storageUsage}>{formatBytes(storage.mediaBytes)}</span>
              </div>
              <div style={styles.storageMessage}>{storage.message}</div>
              {storage.quotaBytes !== null && (
                <div style={styles.storageQuota}>Origin quota: {formatBytes(storage.quotaBytes)}</div>
              )}
            </Section>

            <Section title="Device">
              <button style={styles.actionButton} onClick={() => window.location.reload()}>
                Refresh
              </button>
              <button style={styles.actionButton} onClick={() => { void handleUnpair(); }}>
                Unpair
              </button>
              <button style={{ ...styles.actionButton, ...styles.dangerButton }} onClick={closeTab}>
                Exit
              </button>
            </Section>
          </div>
        </>
      )}
    </>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={styles.section}>
      <div style={styles.sectionTitle}>{title}</div>
      {children}
    </div>
  );
}

function ToggleRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!checked)}
      style={styles.toggleRow}
    >
      <span style={styles.toggleLabel}>{label}</span>
      <span style={{ ...styles.switchTrack, ...(checked ? styles.switchTrackOn : {}) }}>
        <span style={{ ...styles.switchThumb, ...(checked ? styles.switchThumbOn : {}) }} />
      </span>
    </button>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = -1;
  do {
    value /= 1024;
    unit += 1;
  } while (value >= 1024 && unit < units.length - 1);
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unit]}`;
}

function GearIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

const styles: Record<string, React.CSSProperties> = {
  trigger: {
    position: 'absolute', top: 16, right: 16, zIndex: 10000,
    width: 40, height: 40, borderRadius: '50%', border: 'none',
    background: 'rgba(0,0,0,0.45)', color: 'rgba(255,255,255,0.7)',
    display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
  },
  backdrop: {
    position: 'absolute', inset: 0, zIndex: 10001, background: 'rgba(0,0,0,0.5)',
  },
  panel: {
    position: 'absolute', top: 0, right: 0, bottom: 0, zIndex: 10002,
    width: 320, maxWidth: '85%', background: '#161616', color: '#fff',
    fontFamily: 'system-ui, sans-serif', boxShadow: '-8px 0 24px rgba(0,0,0,0.4)',
    display: 'flex', flexDirection: 'column', overflowY: 'auto',
  },
  header: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '20px 20px 12px',
  },
  title: { fontSize: '1.1rem', fontWeight: 600 },
  closeButton: {
    background: 'none', border: 'none', color: '#aaa', fontSize: '1.75rem',
    lineHeight: 1, cursor: 'pointer', padding: 4,
  },
  section: { padding: '12px 20px', borderTop: '1px solid #262626' },
  sectionTitle: { fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: '#888', marginBottom: 10 },
  storageRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 },
  storageState: { fontSize: '0.8rem', fontWeight: 700, letterSpacing: '0.04em' },
  storageUsage: { fontSize: '0.8rem', color: '#aaa' },
  storageMessage: { marginTop: 7, fontSize: '0.78rem', lineHeight: 1.4, color: '#bbb' },
  storageQuota: { marginTop: 4, fontSize: '0.72rem', color: '#777' },
  toggleRow: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%',
    background: 'none', border: 'none', color: '#eee', padding: '6px 0', cursor: 'pointer', textAlign: 'left', gap: 12,
  },
  toggleLabel: { fontSize: '0.9rem', color: '#ccc' },
  switchTrack: {
    flexShrink: 0, width: 42, height: 24, borderRadius: 12, background: '#333',
    position: 'relative', transition: 'background 0.15s',
  },
  switchTrackOn: { background: '#3b82f6' },
  switchThumb: {
    position: 'absolute', top: 3, left: 3, width: 18, height: 18, borderRadius: '50%',
    background: '#fff', transition: 'transform 0.15s',
  },
  switchThumbOn: { transform: 'translateX(18px)' },
  actionButton: {
    display: 'block', width: '100%', padding: '10px 14px', marginBottom: 8, borderRadius: 8,
    borderWidth: 1, borderStyle: 'solid', borderColor: '#333', background: '#1f1f1f', color: '#eee',
    fontSize: '0.9rem', cursor: 'pointer', textAlign: 'left',
  },
  dangerButton: { borderColor: '#5c2323', color: '#f87171' },
};
