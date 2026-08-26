import type { SourceVisualArtifact } from "@/lib/agent/artifacts";

export function SourceVisual(props: SourceVisualArtifact) {
  const page = "page" in props.provenance ? props.provenance.page : undefined;
  const label = page ? `${props.provenance.source}, p. ${page}` : props.provenance.source;
  return <figure className="source-visual"><img src={props.imageUrl} alt={props.caption} loading="lazy" /><figcaption><span>{props.caption}</span><small>{label} · Tier {props.provenance.tier} manual source</small></figcaption></figure>;
}
