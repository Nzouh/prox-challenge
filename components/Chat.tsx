"use client";

import Image from "next/image";
import { FormEvent, KeyboardEvent, useEffect, useLayoutEffect, useRef, useState } from "react";
import frontImage from "@/assets/reference-images/product-views/product-front.webp";
import { ArcMark } from "./ArcMark";
import arcLogo from "@/public/arc-logo.png";
import { ArtifactView } from "./artifacts";
import { USER } from "./Sidebar";
import { stageLabel, type Conversation } from "@/lib/conversation";

const SUGGESTED_GROUPS: Array<{ label: string; items: string[] }> = [
  {
    label: "Setup",
    items: [
      "What polarity setup do I need for TIG welding?",
      "MIG setup checklist for mild steel",
    ],
  },
  {
    label: "Specs",
    items: [
      "Duty cycle for MIG at 200A on 240V?",
      "What input power options are supported?",
    ],
  },
  {
    label: "Troubleshooting",
    items: [
      "Porosity in flux-cored welds — what first?",
      "What does an unknown warning indicator mean?",
    ],
  },
];

export function Chat({
  conversation,
  streaming,
  onAsk,
  onCancel,
  onOpenExplorer,
}: {
  conversation: Conversation | null;
  streaming: boolean;
  onAsk: (text: string) => void;
  onCancel: () => void;
  onOpenExplorer: () => void;
}) {
  const [draft, setDraft] = useState("");
  const [greeting, setGreeting] = useState("Welcome");
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const turns = conversation?.turns ?? [];
  const isEmpty = turns.length === 0;
  const lastAnswerLength = turns.at(-1)?.answer.length ?? 0;

  // Clock-dependent, so it cannot be part of the server render without a hydration
  // mismatch. It resolves on mount instead.
  useEffect(() => {
    const hour = new Date().getHours();
    setGreeting(hour < 12 ? "Morning" : hour < 18 ? "Afternoon" : "Evening");
  }, []);

  // Follow the stream. Layout effect so the jump lands in the same frame as the text.
  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [turns.length, lastAnswerLength, conversation?.id]);

  // Grow the composer with the draft rather than reserving three empty rows.
  useLayoutEffect(() => {
    const element = inputRef.current;
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${Math.min(element.scrollHeight, 168)}px`;
  }, [draft]);

  function send() {
    const text = draft.trim();
    if (!text || streaming) return;
    setDraft("");
    onAsk(text);
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    send();
  }

  function onComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      send();
    }
  }

  function pick(question: string) {
    setDraft(question);
    inputRef.current?.focus();
  }

  return (
    <main className="chat">
      <div className="chat-topbar">
        <button type="button" className="explorer-card" onClick={onOpenExplorer}>
          <span className="explorer-card-frame">
            <Image src={frontImage} alt="" sizes="196px" priority />
          </span>
          <span className="explorer-card-foot">
            <span className="explorer-card-title">View components</span>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <line x1="5" y1="12" x2="18" y2="12" />
              <polyline points="12,6 18,12 12,18" />
            </svg>
          </span>
        </button>
      </div>

      <div className="chat-scroll scroll-slim" ref={scrollRef}>
        <div className="chat-column">
          {isEmpty ? (
            <div className="chat-empty">
              <div className="chat-empty-lockup">
                <Image className="brand-logo" src={arcLogo} alt="" width={44} height={44} priority />
                <span className="chat-greeting">
                  {greeting}, {USER.name}
                </span>
              </div>
              <p className="chat-empty-sub">
                Ask anything about your OmniPro 220 — settings, duty cycles, polarity, or what
                went wrong with that last bead.
              </p>
              <div className="starters">
                {SUGGESTED_GROUPS.map((group) => (
                  <div key={group.label} className="starter-group">
                    <div className="starter-label">{group.label}</div>
                    <div className="starter-row">
                      {group.items.map((item) => (
                        <button key={item} type="button" className="starter" onClick={() => pick(item)}>
                          {item}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="thread" aria-live="polite">
              {turns.map((turn, index) => {
                const isLive = streaming && index === turns.length - 1;
                return (
                  <div key={turn.id} className="turn">
                    <div className="user-row">
                      <div className="user-bubble">{turn.question}</div>
                    </div>

                    <div className="assistant-row">
                      <div className="assistant-mark">
                        <ArcMark size={18} strokeWidth={2.4} />
                      </div>
                      <div className="assistant-body">
                        {turn.status && (
                          <div className="trace-line">
                            <span className="spinner" aria-hidden="true" />
                            <span>{turn.status || stageLabel(turn.stage)}</span>
                          </div>
                        )}

                        {turn.artifacts.map((artifact, artifactIndex) => (
                          <ArtifactView key={`${artifact.type}-${artifactIndex}`} artifact={artifact} />
                        ))}

                        {turn.answer && (
                          <div className="answer">
                            {turn.answer}
                            {isLive && <span className="caret">▍</span>}
                          </div>
                        )}

                        {turn.error && <div className="error">{turn.error}</div>}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <div className="composer-dock">
        <form className="composer" onSubmit={submit}>
          <label htmlFor="chat-input" className="sr-only">
            Ask about the Vulcan OmniPro 220
          </label>
          <textarea
            id="chat-input"
            ref={inputRef}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={onComposerKeyDown}
            placeholder="Ask about your OmniPro 220…"
            rows={1}
          />
          {streaming ? (
            <button type="button" className="send is-stop" onClick={onCancel} aria-label="Stop">
              <svg width="15" height="15" viewBox="0 0 24 24" aria-hidden="true">
                <rect x="6" y="6" width="12" height="12" rx="2.5" fill="currentColor" />
              </svg>
            </button>
          ) : (
            <button type="submit" className="send" disabled={!draft.trim()} aria-label="Send">
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <line x1="12" y1="19" x2="12" y2="5" />
                <polyline points="6,11 12,5 18,11" />
              </svg>
            </button>
          )}
        </form>
        <p className="composer-note">
          Answers are grounded in the OmniPro 220 owner&rsquo;s manual, quick-start guide and
          selection chart. Enter sends, Shift+Enter adds a line. Check the placards before you weld.
        </p>
      </div>
    </main>
  );
}
