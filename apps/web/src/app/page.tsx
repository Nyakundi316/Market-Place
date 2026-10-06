import { redirect } from 'next/navigation';

// The marketing landing page arrives with the auth pages (1.13); until then, go straight to the app.
export default function Home() {
  redirect('/feed');
}
