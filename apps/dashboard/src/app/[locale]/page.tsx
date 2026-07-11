import { redirect } from 'next/navigation';

export default function RootPage({ params }: { params: { locale: string } }) {
  const { locale } = params;
  redirect(`/${locale}/screens`);
}
