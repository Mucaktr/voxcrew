import clsx from "clsx";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { isSafeImgSrc } from "../lib/safeImg";

export function Markdown({ text, live, className }: { text: string; live?: boolean; className?: string }) {
  return (
    <div className={clsx("md", live && "caret", className)}>
      <ReactMarkdown remarkPlugins={[remarkGfm]}
        components={{
          a: ({ node: _n, ...p }) => <a {...p} target="_blank" rel="noreferrer noopener" />,
          // sayfada tek h1 kalsın: içerikteki "# Başlık" h2 olarak (h1 görünümüyle) basılır
          h1: ({ node: _n, ...p }) => <h2 {...p} className="md-h1" />,
          // AUDIT-FIX #15: uzak resim yüklenmez (sıfır tıklamalı veri sızdırma); yerine alt metni gösterilir
          img: ({ node: _n, src, alt, ...p }) => (isSafeImgSrc(src) ? <img {...p} src={src} alt={alt ?? ""} />
            : alt ? <span className="text-muted">[{alt}]</span> : null),
        }}>
        {text}
      </ReactMarkdown>
    </div>
  );
}
