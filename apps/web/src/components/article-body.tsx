/**
 * Lightweight article body renderer. Plain paragraphs plus two markdown-ish
 * constructs used by generated content: `## heading` and `![alt](url)`.
 */
export function ArticleBody({ body }: { body: string }) {
  const blocks = body.split(/\n{2,}/);
  return (
    <div className="prose prose-sm max-w-none leading-7">
      {blocks.map((block, i) => {
        const img = block.trim().match(/^!\[(.*?)\]\((.+)\)$/s);
        if (img) {
          return (
            <figure key={i} className="my-4">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={img[2].trim()}
                alt={img[1]}
                loading="lazy"
                className="w-full rounded-lg object-cover aspect-[16/9]"
              />
            </figure>
          );
        }
        if (block.startsWith('## ')) {
          return (
            <h2 key={i} className="text-lg font-bold mt-6 mb-2">
              {block.slice(3).trim()}
            </h2>
          );
        }
        return (
          <p key={i} className="whitespace-pre-wrap mb-3">
            {block}
          </p>
        );
      })}
    </div>
  );
}
