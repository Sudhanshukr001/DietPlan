/** The app mark: a steel thali seen from above. Pure SVG, no client JS. */
export function BrandMark({ size = 28 }: { readonly size?: number }): React.ReactNode {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      role="img"
      aria-label="Aaj Ka Khana"
    >
      <defs>
        <linearGradient id="akk-plate" x1="4" y1="4" x2="28" y2="28" gradientUnits="userSpaceOnUse">
          <stop stopColor="#12906f" />
          <stop offset="0.55" stopColor="#0b6249" />
          <stop offset="1" stopColor="#0a5440" />
        </linearGradient>
        <linearGradient id="akk-bowl" x1="10" y1="10" x2="22" y2="22" gradientUnits="userSpaceOnUse">
          <stop stopColor="#ffffff" stopOpacity="0.95" />
          <stop offset="1" stopColor="#ffffff" stopOpacity="0.7" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="9" fill="url(#akk-plate)" />
      <circle cx="16" cy="16" r="9.5" stroke="url(#akk-bowl)" strokeWidth="1.6" />
      <circle cx="16" cy="16" r="5" fill="url(#akk-bowl)" fillOpacity="0.9" />
      <circle cx="16" cy="16" r="2.1" fill="#0b6249" />
      <path d="M16 3.5v3M16 25.5v3M3.5 16h3M25.5 16h3" stroke="#ffffff" strokeOpacity="0.65" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}
