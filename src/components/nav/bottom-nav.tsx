'use client';

import { Home, CalendarDays, UserRound } from 'lucide-react';

export type TabId = 'today' | 'week' | 'you';

interface BottomNavProps {
  readonly value: TabId;
  readonly onChange: (tab: TabId) => void;
}

function NavItem({
  label,
  icon,
  active,
  onClick,
}: {
  readonly id: TabId;
  readonly label: string;
  readonly icon: React.ReactNode;
  readonly active: boolean;
  readonly onClick: () => void;
}): React.ReactNode {
  return (
    <button
      type="button"
      aria-current={active ? 'page' : undefined}
      onClick={onClick}
      className="group flex flex-1 flex-col items-center justify-center gap-0.5 px-1 pb-[calc(env(safe-area-inset-bottom,0px)+4px)] pt-1"
    >
      <span
        className={`flex h-9 w-9 items-center justify-center rounded-full transition-colors ${
          active
            ? 'bg-accent text-accent-ink shadow-soft'
            : 'text-ink-3 group-hover:bg-surface-2'
        }`}
      >
        {icon}
      </span>
      <span className={`text-[11px] font-medium ${active ? 'text-ink' : 'text-ink-3'}`}>{label}</span>
    </button>
  );
}

export function BottomNav({ value, onChange }: BottomNavProps): React.ReactNode {
  return (
    <nav
      aria-label="Main navigation"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface-glass backdrop-blur-xl supports-[backdrop-filter]:bg-surface-glass"
    >
      <div className="mx-auto flex max-w-2xl items-center justify-between px-3 pt-1">
        <NavItem
          id="today"
          label="Today"
          icon={<Home size={20} />}
          active={value === 'today'}
          onClick={() => onChange('today')}
        />
        <NavItem
          id="week"
          label="Week"
          icon={<CalendarDays size={20} />}
          active={value === 'week'}
          onClick={() => onChange('week')}
        />
        <NavItem
          id="you"
          label="You"
          icon={<UserRound size={20} />}
          active={value === 'you'}
          onClick={() => onChange('you')}
        />
      </div>
    </nav>
  );
}
