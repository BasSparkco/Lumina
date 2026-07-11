import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { usePlayerStore } from '../store/playerStore';

export default function PairingPage() {
  const [code, setCode] = useState<string>('');
  const [error, setError] = useState<string>('');
  const navigate = useNavigate();
  const { screenId, token, setScreenId, setToken } = usePlayerStore();
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // If already paired, go straight to player
  useEffect(() => {
    if (token && screenId) { void navigate('/play'); return; }

    async function start() {
      try {
        const res = await api.init();
        setCode(res.pairingCode);
        setScreenId(res.screenId);
        startPolling(res.screenId);
      } catch {
        setError('Cannot reach server. Retrying…');
        setTimeout(start, 5000);
      }
    }

    void start();
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function startPolling(sid: string) {
    pollRef.current = setInterval(async () => {
      try {
        const res = await api.checkPairing(sid);
        if (res.paired) {
          clearInterval(pollRef.current!);
          setToken(res.token);
          void navigate('/play');
        }
      } catch { /* network hiccup, keep polling */ }
    }, 3000);
  }

  return (
    <div style={styles.container}>
      <div style={styles.card}>
        <p style={styles.label}>Enter this code in your Lumina dashboard</p>
        <p style={styles.code}>{code || '——————'}</p>
        {error && <p style={styles.error}>{error}</p>}
        <p style={styles.hint}>Waiting for pairing…</p>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: { display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: '#111', color: '#fff', fontFamily: 'system-ui, sans-serif' },
  card: { textAlign: 'center', padding: '3rem', background: '#1c1c1c', borderRadius: '1rem', minWidth: '320px' },
  label: { color: '#aaa', fontSize: '1rem', marginBottom: '1.5rem' },
  code: { fontSize: '3.5rem', fontWeight: 700, letterSpacing: '0.6rem', color: '#fff', margin: '0 0 1rem' },
  hint: { color: '#555', fontSize: '0.875rem', marginTop: '1.5rem' },
  error: { color: '#f87171', fontSize: '0.875rem' },
};
