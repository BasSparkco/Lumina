import { useEffect, useState } from 'react';

interface Props {
  timezone?: string;
  hour12?: boolean;
  showSeconds?: boolean;
  lang?: 'en' | 'ar';
}

export default function TimeWidget({ timezone, hour12 = true, showSeconds = false, lang = 'en' }: Props) {
  const [now, setNow] = useState(() => new Date());
  const isRtl = lang === 'ar';

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const time = now.toLocaleTimeString(isRtl ? 'ar' : 'en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: showSeconds ? '2-digit' : undefined,
    hour12,
    timeZone: timezone,
  });

  return (
    <div style={containerStyle(isRtl)} dir={isRtl ? 'rtl' : 'ltr'}>
      <div style={{ fontSize: 'clamp(2.5rem, 12vw, 7rem)', fontWeight: 700, letterSpacing: '0.02em', fontVariantNumeric: 'tabular-nums' }}>
        {time}
      </div>
    </div>
  );
}

function containerStyle(isRtl: boolean): React.CSSProperties {
  return {
    width: '100%',
    height: '100%',
    background: 'linear-gradient(135deg, #1e1b4b 0%, #312e81 100%)',
    color: '#fff',
    fontFamily: isRtl ? "'Amiri', 'Noto Sans Arabic', sans-serif" : "'Inter', system-ui, sans-serif",
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    textAlign: 'center',
    boxSizing: 'border-box',
  };
}
