/**
 * Tradeplex mark: one leader bar multiplexed to three follower ticks that hang
 * beneath it at different lengths (each follower has its own sizing). Together
 * they read as a "T" and as tick marks on a price ladder. Built on a 32-unit
 * grid; see docs/BRAND.md for construction and usage rules.
 */
export function BrandMark({ size = 24, title }: { size?: number; title?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      role={title ? 'img' : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
      className="brand-mark"
    >
      <rect x="6" y="7" width="20" height="4" rx="1" className="brand-mark__leader" />
      <rect x="6" y="13" width="4" height="6" rx="1" className="brand-mark__follower" />
      <rect x="14" y="13" width="4" height="13" rx="1" className="brand-mark__follower" />
      <rect x="22" y="13" width="4" height="9" rx="1" className="brand-mark__follower" />
    </svg>
  );
}

export function BrandLockup() {
  return (
    <span className="brand-lockup">
      <BrandMark size={26} />
      <span className="brand-lockup__word">Tradeplex</span>
    </span>
  );
}
