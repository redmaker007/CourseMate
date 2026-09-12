import type { ReactNode } from "react";

const WEB_URL = /(https?:\/\/[^\s<>]+)/gi;

function safeHttpUrl(candidate: string) {
  try {
    const url = new URL(candidate);
    return url.protocol === "http:" || url.protocol === "https:"
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

export function SafeMessageText({ text }: { text: string }) {
  const content: ReactNode[] = [];
  let offset = 0;
  for (const match of text.matchAll(WEB_URL)) {
    const index = match.index;
    if (index > offset) content.push(text.slice(offset, index));
    const label = match[0];
    const href = safeHttpUrl(label);
    content.push(
      href ? (
        <a
          className="break-all font-medium text-indigo-700 underline"
          href={href}
          key={`${index}:${label}`}
          rel="noopener noreferrer"
          target="_blank"
        >
          {label}
        </a>
      ) : (
        label
      ),
    );
    offset = index + label.length;
  }
  if (offset < text.length) content.push(text.slice(offset));

  return <span className="whitespace-pre-wrap break-words">{content}</span>;
}
