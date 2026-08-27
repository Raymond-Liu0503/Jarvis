"use client";

import type { ComponentPropsWithoutRef } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

function SafeLink({ href, children, ...props }: ComponentPropsWithoutRef<"a">) {
  if (!href || !/^https?:\/\//i.test(href)) return <span>{children}</span>;
  return <a href={href} target="_blank" rel="noreferrer" className="underline decoration-[#8ca55c] underline-offset-2" {...props}>{children}</a>;
}

export function ChatMarkdown({ content }: { content: string }) {
  return <div className="chat-markdown text-[15px] leading-6">
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={{
      h1: ({ children }) => <h3 className="serif mt-5 mb-2 text-xl first:mt-0">{children}</h3>,
      h2: ({ children }) => <h3 className="serif mt-5 mb-2 text-lg first:mt-0">{children}</h3>,
      h3: ({ children }) => <h4 className="serif mt-4 mb-1 text-base first:mt-0">{children}</h4>,
      p: ({ children }) => <p className="my-2">{children}</p>,
      ul: ({ children }) => <ul className="my-3 list-disc space-y-1 pl-5">{children}</ul>,
      ol: ({ children }) => <ol className="my-3 list-decimal space-y-1 pl-5">{children}</ol>,
      blockquote: ({ children }) => <blockquote className="my-3 border-l-2 border-[#b7f34b] pl-4 italic text-[#58645d]">{children}</blockquote>,
      table: ({ children }) => <div className="my-4 overflow-x-auto"><table className="min-w-full border-collapse text-left text-sm">{children}</table></div>,
      th: ({ children }) => <th className="border-b border-[#cfd6c8] px-3 py-2 font-semibold">{children}</th>,
      td: ({ children }) => <td className="border-b border-[#e1e5dd] px-3 py-2 align-top">{children}</td>,
      pre: ({ children }) => <pre className="my-3 overflow-x-auto rounded-lg bg-[#17211b] p-4 text-xs leading-5 text-[#e9f3df]">{children}</pre>,
      code: ({ children, className, ...props }) => <code className={className ? `${className} font-mono` : "rounded bg-[#e8ebe2] px-1.5 py-0.5 font-mono text-[.9em]"} {...props}>{children}</code>,
      a: SafeLink,
      hr: () => <hr className="my-4 border-[#d8ddd0]" />,
    }}>{content}</ReactMarkdown>
  </div>;
}
