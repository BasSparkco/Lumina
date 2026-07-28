export default function Splash({ text }: { text: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', width: '100%', background: '#000', color: '#444', fontFamily: 'system-ui, sans-serif', fontSize: '1.25rem' }}>
      {text}
    </div>
  );
}
