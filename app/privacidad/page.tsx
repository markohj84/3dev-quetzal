import type { Metadata } from 'next';
import { getAssistantOr404 } from '../assistant';

// The notice is the client's legal text, so it lives in their folder.
const notice = async () => import(`../../clients/${(await getAssistantOr404()).folder}/privacidad.tsx`);

export async function generateMetadata(): Promise<Metadata> {
  return (await notice()).metadata;
}

export default async function PrivacidadPage() {
  const { default: Notice } = await notice();
  return <Notice />;
}
