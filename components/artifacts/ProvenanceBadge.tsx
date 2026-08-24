import type { Provenance } from "@/lib/agent/provenance";

const LABEL: Record<Provenance["tier"], string> = {
  1: "MANUAL",
  2: "WEB",
  3: "INFERRED",
};

/**
 * The three tiers must never be blurred into one confident voice (CLAUDE.md). Colour and
 * label both carry the tier, so it survives greyscale and colour-blindness.
 */
export function ProvenanceBadge({ provenance }: { provenance: Provenance }) {
  return (
    <div className="provenance">
      <span className={`badge badge-${provenance.tier}`}>
        <span className="badge-dot" />
        TIER {provenance.tier} · {LABEL[provenance.tier]}
      </span>
      <span>
        {provenance.source}
        {provenance.tier === 1 && provenance.page ? `, p.${provenance.page}` : ""}
        {provenance.tier === 1 && provenance.figure ? ` (${provenance.figure})` : ""}
        {provenance.tier === 2 ? ` — ${provenance.url}` : ""}
        {provenance.tier === 3 ? ` — ${provenance.basis}` : ""}
      </span>
    </div>
  );
}
