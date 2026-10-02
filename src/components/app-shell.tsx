'use client';

import { useAppStore, type AppStore } from '@/lib/app/store';
import { BrandMark } from './brand';
import { Onboarding, type OnboardingResult } from './onboarding';
import { Today } from './today';
import { Week } from './week';
import { You } from './you';
import { BottomNav, type TabId } from './nav/bottom-nav';
import { useState } from 'react';

/**
 * Decides between onboarding and today. Nothing is rendered until the store has
 * hydrated from localStorage, otherwise the first paint would flash onboarding at
 * a returning user.
 */
export function AppShell(): React.ReactNode {
  const store: AppStore = useAppStore();
  const [tab, setTab] = useState<TabId>('today');

  if (!store.ready) {
    return (
      <main id="main" className="mx-auto flex w-full max-w-2xl flex-1 flex-col px-4 pb-16 pt-6">
        <div className="mb-6 flex items-center gap-2.5">
          <BrandMark size={30} />
          <p className="text-sm font-semibold tracking-tight text-ink">Aaj Ka Khana</p>
        </div>
        <div className="space-y-4" aria-live="polite" aria-busy="true">
          <div className="skeleton h-8 w-2/3 rounded-lg" />
          <div className="skeleton h-40 w-full rounded-xl" />
          <div className="skeleton h-24 w-full rounded-xl" />
          <div className="skeleton h-24 w-full rounded-xl" />
          <span className="sr-only">Loading your day…</span>
        </div>
      </main>
    );
  }

  if (!store.profile) {
    return (
      <main id="main" className="flex-1">
        <Onboarding onDone={(result: OnboardingResult) => store.completeOnboarding(result)} />
      </main>
    );
  }

  return (
    <>
      <main id="main" className="flex-1">
        {tab === 'today' && <Today />}
        {tab === 'week' && <Week upcoming={store.upcoming} today={store.today} />}
        {tab === 'you' && <You store={store} />}
      </main>
      <BottomNav value={tab} onChange={setTab} />
    </>
  );
}
