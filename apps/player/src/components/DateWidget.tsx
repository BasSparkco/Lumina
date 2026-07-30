import { useEffect, useState } from 'react';

interface Props {
  timezone?: string;
  format?: 'short' | 'long';
  lang?: 'en' | 'ar';
}

export default function DateWidget({ timezone, format = 'long', lang = 'en' }: Props) {
  const [now, setNow] = useState(() => new Date());
  const isRtl = lang === 'ar';

  useEffect(() => {
    // The date only flips at midnight, but polling once a minute means a long-lived screen never
    // shows a stale date without needing a full reload to notice the day changed.
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);

  const date = now.toLocaleDateString(isRtl ? 'ar' : 'en-US', {
    weekday: format === 'long' ? 'long' : undefined,
    year: 'numeric',
    month: format === 'long' ? 'long' : '2-digit',
    day: '2-digit',
    timeZone: timezone,
  });

  return (
    <div style={containerStyle(isRtl)} dir={isRtl ? 'rtl' : 'ltr'}>
      <div style={{ fontSize: 'clamp(1.5rem, 6vw, 3.5rem)', fontWeight: 700, lineHeight: 1.2 }}>
        {date}
      </div>
    </div>
  );
}

function containerStyle(isRtl: boolean): React.CSSProperties {
  return {
    width: '100%',
    height: '100%',
    background: 'linear-gradient(135deg, #052e2b 0%, #0f3d3a 100%)',
    color: '#fff',
    fontFamily: isRtl ? "'Amiri', 'Noto Sans Arabic', sans-serif" : "'Inter', system-ui, sans-serif",
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    textAlign: 'center',
    padding: '8%',
    boxSizing: 'border-box',
  };
}
