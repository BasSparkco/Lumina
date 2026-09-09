'use client';
import { AppShell } from '@/components/shell/AppShell';
import { EditorDirtyProvider } from '@/context/EditorDirtyContext';
import './signal.css';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <EditorDirtyProvider>
      <AppShell>{children}</AppShell>
    </EditorDirtyProvider>
  );
}
