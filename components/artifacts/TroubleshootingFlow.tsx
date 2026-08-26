"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { TroubleshootingFlowArtifact } from "@/lib/agent/artifacts";
import { SourceVisual } from "./SourceVisual";

/** Reveal one new check at a time while keeping every previously revealed check visible. */
export function TroubleshootingFlow(props: TroubleshootingFlowArtifact) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [safetyPending, setSafetyPending] = useState(Boolean(props.stopCondition));
  const [exhausted, setExhausted] = useState(false);
  const [svg, setSvg] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const graphBaseId = `flow${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const stageIndex = exhausted ? props.branches.length : activeIndex;
  const mermaidSource = props.mermaidStages[stageIndex]!;
  const graphId = `${graphBaseId}stage${stageIndex}`;
  const selectedBranch = selectedIndex === null ? null : props.branches[selectedIndex]!;

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const mermaid = (await import("mermaid")).default;
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: "strict",
          theme: "base",
          fontFamily: "Figtree, system-ui, sans-serif",
          flowchart: { nodeSpacing: 28, rankSpacing: 34, padding: 12, curve: "basis" },
          themeVariables: {
            background: "#211e1a",
            lineColor: "#82796a",
            primaryColor: "#2c2620",
            primaryTextColor: "#f3ede3",
            primaryBorderColor: "#3a332b",
            tertiaryColor: "#211e1a",
          },
        });
        const { svg: rendered } = await mermaid.render(graphId, mermaidSource);
        if (!cancelled) {
          setSvg(rendered);
          setFailed(false);
        }
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [graphId, mermaidSource]);

  useEffect(() => {
    const root = containerRef.current;
    if (!root || !svg) return;
    const cleanups: Array<() => void> = [];

    for (const node of root.querySelectorAll<SVGGElement>("g.node")) {
      const safety = /-safety-\d+$/.test(node.id);
      const match = /-c(\d+)-\d+$/.exec(node.id);
      const index = match ? Number(match[1]) - 1 : null;
      const available = safety ? safetyPending : index !== null && !safetyPending && index <= activeIndex;

      node.classList.toggle("flow-node-complete", safety ? !safetyPending : index !== null && index < activeIndex);
      node.classList.toggle("flow-node-active", index === activeIndex && !safetyPending && !exhausted);
      node.classList.toggle("flow-node-selected", index === selectedIndex);
      if (!available) continue;

      node.style.cursor = "pointer";
      node.setAttribute("role", "button");
      node.setAttribute("tabindex", "0");
      const activate = () => {
        if (safety) {
          setSafetyPending(false);
          return;
        }
        if (index !== null) setSelectedIndex(index);
      };
      const onKeyDown = (event: Event) => {
        const key = (event as KeyboardEvent).key;
        if (key === "Enter" || key === " ") {
          event.preventDefault();
          activate();
        }
      };
      node.addEventListener("click", activate);
      node.addEventListener("keydown", onKeyDown);
      cleanups.push(() => {
        node.removeEventListener("click", activate);
        node.removeEventListener("keydown", onKeyDown);
      });
    }
    return () => cleanups.forEach((cleanup) => cleanup());
  }, [activeIndex, exhausted, safetyPending, selectedIndex, svg]);

  function nextCheck() {
    setSelectedIndex(null);
    if (activeIndex + 1 < props.branches.length) {
      setActiveIndex((index) => index + 1);
    } else {
      setExhausted(true);
    }
  }

  return (
    <div className="artifact troubleshooting-flow" aria-live="polite">
      {svg && !failed ? (
        <div
          className="flow-diagram"
          ref={containerRef}
          // Produced by Mermaid from host-generated, validated graph data.
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      ) : (
        <button
          type="button"
          className="troubleshooting-step"
          onClick={() => {
            if (safetyPending) setSafetyPending(false);
            else setSelectedIndex(activeIndex);
          }}
        >
          {safetyPending ? props.stopCondition : props.branches[activeIndex]!.check}
        </button>
      )}

      {selectedBranch && !exhausted && (
        <div className="troubleshooting-expansion">
          {selectedBranch.specifics?.length ? (
            selectedBranch.specifics.map((specific) => (
              <p className="troubleshooting-action" key={`${specific.text}-${specific.provenance.source}`}>
                {specific.text}
              </p>
            ))
          ) : (
            <p className="troubleshooting-action">{selectedBranch.remedy}</p>
          )}
          {selectedBranch.supportingVisual && <SourceVisual {...selectedBranch.supportingVisual} />}
        </div>
      )}

      {!exhausted && (
        <button
          type="button"
          className="troubleshooting-next"
          onClick={nextCheck}
          disabled={safetyPending}
        >
          Next check
        </button>
      )}

      {exhausted && <p className="troubleshooting-result">Checks exhausted.</p>}
    </div>
  );
}
