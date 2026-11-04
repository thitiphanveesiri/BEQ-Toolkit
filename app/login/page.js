import { redirect } from 'next/navigation';
import { currentUser } from '../../lib/auth.js';
import { dataMode } from '../../lib/db.js';
import LoginForm from './LoginForm.js';

export const dynamic = 'force-dynamic';
export default async function LoginPage() {
  if (await currentUser()) redirect('/dashboard');
  return <LoginForm mock={dataMode() === 'mock'} />;
}
