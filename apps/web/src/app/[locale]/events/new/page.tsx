import { setRequestLocale } from 'next-intl/server';
import { EventForm } from '@/components/event-form';

export default async function NewEventPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <EventForm />;
}
