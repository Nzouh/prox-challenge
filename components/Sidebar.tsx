"use client";

import { useMemo } from "react";
import Image from "next/image";
import arcLogo from "@/public/arc-logo.png";
import { groupConversations, type Conversation } from "@/lib/conversation";

export const USER = { name: "Nabil", context: "Garage workshop" };

export function Sidebar({
  conversations,
  activeId,
  query,
  onQuery,
  onSelect,
  onNew,
}: {
  conversations: Conversation[];
  activeId: string | null;
  query: string;
  onQuery: (value: string) => void;
  onSelect: (id: string) => void;
  onNew: () => void;
}) {
  const groups = useMemo(() => {
    const needle = query.trim().toLowerCase();
    // An unnamed conversation has no text to match, so search hides it rather than
    // showing an untitled row that cannot possibly be what was searched for.
    const matches = needle
      ? conversations.filter((c) => (c.title ?? "").toLowerCase().includes(needle))
      : conversations;
    return groupConversations(matches);
  }, [conversations, query]);

  return (
    <aside className="sidebar">
      <div className="sidebar-lockup">
        <Image className="brand-logo" src={arcLogo} alt="" width={28} height={28} priority />
        <div>
          <span className="sidebar-wordmark">Arc</span>
          <span className="sidebar-tagline">OmniPro 220 agent</span>
        </div>
      </div>

      <div className="sidebar-block">
        <button type="button" className="pill-button" onClick={onNew}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.75" strokeLinecap="round" aria-hidden="true">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          New conversation
        </button>
      </div>

      <div className="sidebar-block">
        <div className="search-pill">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.75" strokeLinecap="round" aria-hidden="true">
            <circle cx="11" cy="11" r="7" />
            <line x1="16.5" y1="16.5" x2="21" y2="21" />
          </svg>
          <label className="sr-only" htmlFor="conversation-search">
            Search conversations
          </label>
          <input
            id="conversation-search"
            type="search"
            value={query}
            onChange={(event) => onQuery(event.target.value)}
            placeholder="Search conversations"
          />
        </div>
      </div>

      <nav className="sidebar-list scroll-slim" aria-label="Conversations">
        {groups.map((group) => (
          <div key={group.label} className="sidebar-group">
            <div className="sidebar-group-label">{group.label}</div>
            {group.items.map((conversation) => (
              <button
                key={conversation.id}
                type="button"
                className={`sidebar-item${conversation.id === activeId ? " is-active" : ""}`}
                aria-current={conversation.id === activeId ? "true" : undefined}
                onClick={() => onSelect(conversation.id)}
              >
                <span>{conversation.title ?? "New conversation"}</span>
              </button>
            ))}
          </div>
        ))}
        {groups.length === 0 && (
          <p className="sidebar-empty">
            {query.trim() ? "No conversations match that." : "No conversations yet."}
          </p>
        )}
      </nav>

      <div className="sidebar-user">
        <div className="sidebar-avatar" aria-hidden="true">
          {USER.name.slice(0, 1)}
        </div>
        <div className="sidebar-user-text">
          <div className="sidebar-user-name">{USER.name}</div>
          <div className="sidebar-user-context">{USER.context}</div>
        </div>
      </div>
    </aside>
  );
}
