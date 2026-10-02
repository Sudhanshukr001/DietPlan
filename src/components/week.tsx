'use client';

import type { DayResult } from '@/lib/domain/pipeline';
import type { CalendarDay } from '@/lib/domain/types/index';
import { Card, SectionTitle, Stat } from './ui';
import { dayOfWeekFor } from '@/lib/domain/time';
import { useMemo } from 'react';

interface WeekProps {
  readonly upcoming: readonly DayResult[];
  readonly today: CalendarDay;
}

function formatDay(date: CalendarDay): string {
  const parts = date.split('-').map((x) => Number(x));
  const y = parts[0] ?? 1970;
  const m = parts[1] ?? 1;
  const d = parts[2] ?? 1;
  const dt = new Date(y, m - 1, d);
  return new Intl.DateTimeFormat('en-IN', { weekday: 'short', day: 'numeric', month: 'short' }).format(dt);
}

export function Week({ upcoming, today }: WeekProps): React.ReactNode {
  const dow = useMemo(() => dayOfWeekFor(new Date(), 'Asia/Kolkata'), []);

  return (
    <div className="mx-auto w-full max-w-2xl space-y-5 px-4 pb-[calc(4rem+env(safe-area-inset-bottom,0px))] pt-5">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight text-ink">This week</h1>
        <p className="text-sm text-ink-3">
          Same clean plan, re-derived every day — nothing guessed.
        </p>
      </header>

      <Card>
        <div className="flex items-center justify-between">
          <SectionTitle title="Week at a glance" />
          <span className="text-xs text-ink-3">Start of week: {String(dow).slice(0, 3)}</span>
        </div>
        <div className="grid gap-2.5 sm:grid-cols-2">
          {upcoming.map((d) => {
            const isToday = d.date === today;
            return (
              <div
                key={d.date}
                className={`rounded-2xl border px-3 py-2.5 transition-shadow ${
                  isToday ? 'border-accent-line bg-accent-soft shadow-soft' : 'border-line bg-surface-2'
                }`}
              >
                <div className="flex items-center justify-between">
                  <p className="text-sm font-semibold text-ink">{formatDay(d.date)}</p>
                  {isToday && (
                    <span className="rounded-full bg-accent px-1.5 py-0.5 text-[10px] font-semibold uppercase text-accent-ink">
                      Today
                    </span>
                  )}
                </div>
                <div className="mt-2 grid grid-cols-3 gap-2">
                  <Stat value={d.targets.calories.value.toString()} label="kcal" />
                  <Stat value={`${d.completed.done?.size ?? 0} done`} label="done" />
                  <Stat value={`${Math.round(d.consumedMl / 1000 * 10) / 10}L`} label="water" />
                </div>
              </div>
            );
          })}
        </div>
      </Card>
    </div>
  );
}
