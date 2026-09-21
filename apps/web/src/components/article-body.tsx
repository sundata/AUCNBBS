/**
 * Lightweight article body renderer. Parses line-by-line so `## heading`
 * and `![alt](url)` work anywhere — even mid-paragraph. Bare URLs inside
 * paragraphs become clickable links.
 */
type Block =
  | { type: 'img'; src: string; alt: string }
  | { type: 'h2'; text: string }
  | { type: 'p'; text: string };

function parse(body: string): Block[] {
  const blocks: Block[] = [];
  let para: string[] = [];
  const flush = () => {
    if (para.length) blocks.push({ type: 'p', text: para.join('\n') });
    para = [];
  };
  for (const raw of body.split('\n')) {
    const line = raw.trim();
    const img = line.match(/^!\[(.*?)\]\((.+)\)$/);
    if (img) {
      flush();
      blocks.push({ type: 'img', src: img[2].trim(), alt: img[1] });
    } else if (line.startsWith('## ')) {
      flush();
      blocks.push({ type: 'h2', text: line.slice(3).trim() });
    } else if (!line) {
      flush();
    } else {
      para.push(line);
    }
  }
  flush();
  return blocks;
}

function LinkedText({ text }: { text: string }) {
  const parts = text.split(/(https?:\/\/[^\s)<>]+)/g);
  return (
    <>
      {parts.map((part, i) =>
        /^https?:\/\//.test(part) ? (
          <a
            key={i}
            href={part}
            target="_blank"
            rel="noopener noreferrer"
            className="text-brand underline break-all"
          >
            {part}
          </a>
        ) : (
          part
        ),
      )}
    </>
  );
}

export function ArticleBody({ body }: { body: string }) {
  return (
    <div className="prose prose-sm max-w-none leading-7">
      {parse(body).map((block, i) => {
        if (block.type === 'img') {
          return (
            <figure key={i} className="my-4">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={block.src}
                alt={block.alt}
                loading="lazy"
                className="w-full rounded-lg object-cover aspect-[16/9]"
              />
            </figure>
          );
        }
        if (block.type === 'h2') {
          return (
            <h2 key={i} className="text-lg font-bold mt-6 mb-2">
              {block.text}
            </h2>
          );
        }
        return (
          <p key={i} className="whitespace-pre-wrap mb-3">
            <LinkedText text={block.text} />
          </p>
        );
      })}
    </div>
  );
}
