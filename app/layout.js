import { redirect } from 'next/navigation';
import { currentUser } from '../../lib/auth.js';
import { dataMode } from '../../lib/db.js';
import { permsOf } from '../../lib/roles.js';
import Shell from '../../components/Shell.js';

export const dynamic = 'force-dynamic';
export default async function AppLayout({ children }) {
  const user = await currentUser();
  if (!user) redirect('/login');
  return <Shell user={user} perms={permsOf(user.role)} mock={dataMode() === 'mock'}>{children}</Shell>;
}
