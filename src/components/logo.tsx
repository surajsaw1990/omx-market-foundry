export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <div className="relative flex items-center gap-2.5">
      <div className="relative grid size-8 place-items-center rounded-lg bg-gradient-to-br from-accent to-[#4c2fd6] shadow-[0_6px_20px_-6px_#8b6cffaa]">
        <svg viewBox="0 0 24 24" className="size-[18px] text-white" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 17l5-5 4 4 7-8" />
          <path d="M15 8h5v5" />
        </svg>
      </div>
      {!compact && (
        <div className="leading-tight">
          <div className="text-sm font-semibold tracking-tight">Market Foundry</div>
          <div className="text-[11px] text-muted">OmniMarketX · internal</div>
        </div>
      )}
    </div>
  );
}
