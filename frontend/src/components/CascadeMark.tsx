// The Cascade mark: three waves on a light tile, the same drawing as the dashboard's logo
// (src/components/panels/TopBar.tsx) and docs/brand/cascade-mark.svg.
export default function CascadeMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true">
      <rect width="32" height="32" rx="9" fill="#f2f2f2" />
      <path d="M7 12.5c2.2 0 2.2-2 4.5-2s2.3 2 4.5 2 2.3-2 4.5-2 2.3 2 4.5 2" stroke="#050505" strokeWidth="2" fill="none" strokeLinecap="round" />
      <path d="M7 17c2.2 0 2.2-2 4.5-2s2.3 2 4.5 2 2.3-2 4.5-2 2.3 2 4.5 2" stroke="#050505" strokeOpacity="0.72" strokeWidth="2" fill="none" strokeLinecap="round" />
      <path d="M7 21.5c2.2 0 2.2-2 4.5-2s2.3 2 4.5 2 2.3-2 4.5-2 2.3 2 4.5 2" stroke="#050505" strokeOpacity="0.44" strokeWidth="2" fill="none" strokeLinecap="round" />
    </svg>
  );
}
