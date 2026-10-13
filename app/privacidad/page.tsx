import type { Metadata } from 'next';
import { CLIENT } from '../assistant';

// The notice is the client's legal text, so it lives in their folder.
const notice = () => import(`../../clients/${CLIENT}/privacidad.tsx`);

export async function generateMetadata(): Promise<Metadata> {
  return (await notice()).metadata;
}

export default async function PrivacidadPage() {
  const { default: Notice } = await notice();
  return <Notice />;
}
