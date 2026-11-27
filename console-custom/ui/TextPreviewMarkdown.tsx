// SPDX-License-Identifier: AGPL-3.0-or-later
import React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export default function TextPreviewMarkdown({ text }: { text: string }) {
  return (
    <article className="v2-text-markdown" aria-label="Markdown 渲染">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        skipHtml
        components={{
          img: ({ alt }) => <span>{alt}</span>,
          a: ({ href, children }) =>
            href && /^(https?:\/\/|mailto:)/i.test(href) ? (
              <a href={href} target="_blank" rel="noopener noreferrer">
                {children}
              </a>
            ) : (
              <span>{children}</span>
            ),
        }}
      >
        {text}
      </ReactMarkdown>
    </article>
  );
}
