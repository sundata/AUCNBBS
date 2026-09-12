import { setRequestLocale } from 'next-intl/server';
import { MessagesPanel } from '@/components/messages-panel';
export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  setRequestLocale((await params).locale);
  return <MessagesPanel />;
}
