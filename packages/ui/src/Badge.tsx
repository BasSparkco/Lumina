type Variant = 'online' | 'offline' | 'processing' | 'ready' | 'error';

const variantClass: Record<Variant, string> = {
  online: 'bg-green-100 text-green-800',
  offline: 'bg-gray-100 text-gray-600',
  processing: 'bg-yellow-100 text-yellow-800',
  ready: 'bg-green-100 text-green-800',
  error: 'bg-red-100 text-red-800',
};

interface BadgeProps {
  variant: Variant;
  children: React.ReactNode;
}

export function Badge({ variant, children }: BadgeProps) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${variantClass[variant]}`}
    >
      {children}
    </span>
  );
}
