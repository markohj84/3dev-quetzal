import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getAssistantOr404 } from '../assistant';

// Optional per client: today only the platform's own folder has terms (the Meta app asks for them).
const terms = async () => {
  const { folder } = await getAssistantOr404();
  try {
    return await import(`../../clients/${folder}/terminos.tsx`);
  } catch {
    notFound();
  }
};

export async function generateMetadata(): Promise<Metadata> {
  return (await terms()).metadata;
}

export default async function TerminosPage() {
  const { default: Terms } = await terms();
  return <Terms />;
}
