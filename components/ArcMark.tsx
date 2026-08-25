/** The Arc spark — a four-axis burst standing in for an arc strike. Sizes are passed
 *  through so the same mark serves the sidebar lockup, the empty state and every
 *  assistant turn without three near-identical SVGs drifting apart. */
export function ArcMark({ size = 20, strokeWidth = 2.2 }: { size?: number; strokeWidth?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" className="arc-mark">
      <g stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round">
        <line x1="12" y1="3" x2="12" y2="21" />
        <line x1="3" y1="12" x2="21" y2="12" />
        <line x1="5.6" y1="5.6" x2="18.4" y2="18.4" />
        <line x1="18.4" y1="5.6" x2="5.6" y2="18.4" />
      </g>
    </svg>
  );
}
