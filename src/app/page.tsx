import { AppStoreProvider } from '@/lib/app/store';
import { AppShell } from '@/components/app-shell';

/**
 * The provider and shell are client components because the app is local-first:
 * there is no server data to stream, only the device's own state.
 */
export default function Home(): React.ReactNode {
  return (
    <AppStoreProvider>
      <AppShell />
    </AppStoreProvider>
  );
}
