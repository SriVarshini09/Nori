import { type CSSProperties } from "react";

const GRAD = [[110, 240, 179], [255, 210, 122], [255, 156, 122]];

/** Colour at position t (0..1) along the jade, sun, coral gradient. */
export function gradAt(t: number): string {
  const k = Math.min(1, Math.max(0, t)) * (GRAD.length - 1);
  const i = Math.min(GRAD.length - 2, Math.floor(k));
  const f = k - i;
  const c = GRAD[i].map((v, j) => Math.round(v + (GRAD[i + 1][j] - v) * f));
  return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
}

/** Headline that rises letter by letter; `grad` tints each letter along the brand gradient. Words never break mid-way. */
export function Letters({ text, grad, from = 0 }: { text: string; grad?: boolean; from?: number }) {
  const total = [...text].length;
  let n = 0;
  return (
    <span aria-hidden="true">
      {text.split(" ").map((word, wi, words) => (
        <span key={wi}>
          <span className="inline-block whitespace-nowrap">
            {[...word].map((ch) => {
              const i = n++;
              return (
                <span key={i} className="ob-letter" style={{ ["--i" as string]: i + from, color: grad ? gradAt(i / Math.max(1, total - 1)) : undefined } as CSSProperties}>
                  {ch}
                </span>
              );
            })}
          </span>
          {wi < words.length - 1 && (n++, " ")}
        </span>
      ))}
    </span>
  );
}
