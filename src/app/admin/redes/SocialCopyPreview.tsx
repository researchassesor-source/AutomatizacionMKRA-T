import { Fragment, type ReactNode } from "react";
import { parseSocialCopy, type SocialCopySegment } from "@/lib/social/caption-formatting";

const URL = /(https?:\/\/[^\s<>"')\]]+)/g;

function linkify(segment: SocialCopySegment, initialOffset: number): ReactNode[] {
  const nodes: ReactNode[] = [];
  let offset = initialOffset;
  for (const part of segment.text.split(URL)) {
    const key = `${offset}:${part}`;
    if (/^https?:\/\//i.test(part)) {
      nodes.push(<a href={part} target="_blank" rel="noreferrer" key={key}>{part}</a>);
    } else {
      nodes.push(<Fragment key={key}>{part}</Fragment>);
    }
    offset += part.length;
  }
  return nodes;
}

export function SocialCopyPreview({ text }: { text: string }) {
  const nodes: ReactNode[] = [];
  let offset = 0;
  for (const segment of parseSocialCopy(text)) {
    const key = `${offset}:${segment.style}`;
    const content = linkify(segment, offset);
    if (segment.style === "bold") nodes.push(<strong key={key}>{content}</strong>);
    else if (segment.style === "italic") nodes.push(<em key={key}>{content}</em>);
    else nodes.push(<Fragment key={key}>{content}</Fragment>);
    offset += segment.text.length;
  }
  return (
    <span className="social-copy-preview">
      {nodes}
    </span>
  );
}
