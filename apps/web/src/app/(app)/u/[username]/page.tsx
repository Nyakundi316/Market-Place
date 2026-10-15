import type { PublicProfileDto } from '@markethub/shared';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { JsonLd } from '@/components/json-ld';
import { profileJsonLd } from '@/lib/seo';
import { serverGet } from '@/lib/server-api';
import { ProfileView } from './profile-view';

type Props = { params: { username: string } };

const load = (username: string) =>
  serverGet<PublicProfileDto>(`/users/${encodeURIComponent(username)}`, 60);

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const p = await load(params.username);
  if (!p) return { title: 'Profile not found' };
  return {
    title: `${p.displayName} (@${p.username})`,
    description: p.bio ?? `${p.displayName} buys and sells on MarketHub.`,
    alternates: { canonical: `/u/${p.username}` },
    openGraph: { type: 'profile', images: p.avatarUrl ? [{ url: p.avatarUrl }] : undefined },
  };
}

export default async function ProfilePage({ params }: Props) {
  const initial = await load(params.username);
  if (!initial) notFound();
  return (
    <>
      <JsonLd data={profileJsonLd(initial)} />
      <ProfileView initial={initial} />
    </>
  );
}
