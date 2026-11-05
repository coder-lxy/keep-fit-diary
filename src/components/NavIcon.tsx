export type NavIconName = 'today' | 'workout' | 'trends' | 'me';

export default function NavIcon({ name }: { name: NavIconName }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {name === 'today' && <><rect x="4" y="5" width="16" height="16" rx="4" /><path d="M8 3v4m8-4v4M4 10h16m-12 5 3 3 5-5" /></>}
      {name === 'workout' && <><path d="m7 7 10 10M5 9l4-4m6 14 4-4M3 7l4-4m10 18 4-4" /><path d="m3 7 4 4 4-4-4-4zm10 10 4 4 4-4-4-4z" /></>}
      {name === 'trends' && <><path d="M4 4v16h16M7 14l4-4 4 3 5-7" /></>}
      {name === 'me' && <><circle cx="12" cy="8" r="4" /><path d="M4.5 21v-2a7.5 7.5 0 0 1 15 0v2" /></>}
    </svg>
  );
}
