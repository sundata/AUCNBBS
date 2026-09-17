import { setRequestLocale } from 'next-intl/server';
import { OnboardingForm } from '@/components/onboarding-form';

export default async function OnboardingPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <OnboardingForm />;
}
