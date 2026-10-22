import { useId } from "react";

const PETAL = "M0 0 C-7 -10 -6 -22 0 -26 C6 -22 7 -10 0 0Z";

function Blossom({ x, y, s, r, hue }: { x: number; y: number; s: number; r: number; hue: string }) {
  return (
    <g transform={`translate(${x} ${y}) rotate(${r}) scale(${s})`}>
      {[0, 72, 144, 216, 288].map((a) => <path key={a} d={PETAL} transform={`rotate(${a})`} fill={hue} />)}
      <circle r="5" fill="#ff9d1a" />
    </g>
  );
}

/** Nori, in a big yellow flower hat, holding a small flower. Wooden sign and a note come with the picture. */
export function NoriBuddy({ className = "", signText = ["Your", "growth", "starts", "here."], note = ["Takes about", "30 seconds."] }: { className?: string; signText?: string[]; note?: string[] }) {
  const id = useId().replace(/:/g, "");
  const g = (n: string) => `url(#${id}${n})`;
  return (
    <svg viewBox="0 0 560 480" role="img" aria-label="Nori, a little yellow character in a flower hat, holding a flower" className={className}>
      <defs>
        <linearGradient id={`${id}body`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#ffe970" /><stop offset="1" stopColor="#ffc928" /></linearGradient>
        <linearGradient id={`${id}hat`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#ffe45c" /><stop offset="1" stopColor="#f7ad0a" /></linearGradient>
        <linearGradient id={`${id}wood`} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#d9a063" /><stop offset="1" stopColor="#b8763a" /></linearGradient>
        <linearGradient id={`${id}leaf`} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#8fd25a" /><stop offset="1" stopColor="#4fa83e" /></linearGradient>
        <filter id={`${id}soft`} x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="9" /></filter>
        <filter id={`${id}drop`} x="-20%" y="-20%" width="140%" height="150%"><feDropShadow dx="0" dy="6" stdDeviation="6" floodColor="#7a4a00" floodOpacity="0.28" /></filter>
      </defs>

      <ellipse cx="270" cy="446" rx="150" ry="18" fill="#6b5200" opacity="0.22" filter={g("soft")} />
      {/* mossy rock */}
      <path d="M120 450 C130 420 190 412 270 414 C350 412 410 424 420 450Z" fill="#8c8a78" />
      <path d="M135 440 C170 424 240 420 300 424 C360 424 398 432 410 446 C380 456 170 458 135 440Z" fill="#9fc055" opacity="0.9" />

      {/* sign */}
      <g transform="translate(2 258) rotate(-13 70 90)">
        <rect x="58" y="120" width="16" height="110" rx="6" fill="#a8693a" />
        <rect x="0" y="12" width="150" height="120" rx="16" fill={g("wood")} filter={g("drop")} />
        <path d="M10 40 H140 M10 72 H140 M10 104 H140" stroke="#9a5f2e" strokeWidth="2" opacity="0.35" />
        {signText.map((t, i) => (
          <text key={t} x="75" y={44 + i * 24} textAnchor="middle" fontSize="21" fontStyle="italic" fontWeight="600" fill="#5a2e10" fontFamily="'Trebuchet MS', 'Segoe Script', cursive">{t}{i === signText.length - 1 ? " ♥" : ""}</text>
        ))}
      </g>

      {/* note */}
      <g transform="translate(396 176) rotate(9 70 70)">
        <rect x="0" y="0" width="150" height="150" rx="22" fill="#fffbe6" opacity="0.62" stroke="#fff" strokeOpacity="0.9" strokeWidth="2" filter={g("drop")} />
        {note.map((t, i) => (
          <text key={t} x="75" y={62 + i * 26} textAnchor="middle" fontSize="21" fontStyle="italic" fontWeight="600" fill="#5a3a10" fontFamily="'Trebuchet MS', 'Segoe Script', cursive">{t}</text>
        ))}
        <path transform="translate(0 22)" d="M75 112 c-12 -10 -22 -18 -14 -28 c6 -7 14 -3 14 4 c0 -7 8 -11 14 -4 c8 10 -2 18 -14 28Z" fill="none" stroke="#a5622f" strokeWidth="3" strokeLinejoin="round" />
        <g transform="translate(130 12)"><Blossom x={0} y={0} s={0.55} r={10} hue="#ffd23f" /></g>
      </g>

      {/* Nori */}
      <g className="mdw-bob" filter={g("drop")}>
        {/* body */}
        <path d="M150 424 C118 350 150 256 268 250 C382 256 414 350 384 424 C350 448 190 448 150 424Z" fill={g("body")} />
        <ellipse cx="186" cy="404" rx="24" ry="32" fill="#ffd940" transform="rotate(18 186 404)" />
        <ellipse cx="352" cy="404" rx="24" ry="32" fill="#ffd940" transform="rotate(-18 352 404)" />
        {/* face */}
        <ellipse cx="226" cy="350" rx="12" ry="17" fill="#3a1a0c" />
        <ellipse cx="312" cy="350" rx="12" ry="17" fill="#3a1a0c" />
        <circle cx="222" cy="343" r="4.4" fill="#fff" /><circle cx="308" cy="343" r="4.4" fill="#fff" />
        <path d="M252 372 Q269 388 286 372" fill="none" stroke="#6b3410" strokeWidth="4.5" strokeLinecap="round" />
        <ellipse cx="190" cy="374" rx="17" ry="11" fill="#ff8fa6" opacity="0.5" />
        <ellipse cx="348" cy="374" rx="17" ry="11" fill="#ff8fa6" opacity="0.5" />
        {/* flower in hands */}
        <path d="M200 440 C198 428 200 420 204 412" stroke="#4fa83e" strokeWidth="5" strokeLinecap="round" fill="none" />
        <g transform="translate(206 404) scale(0.8)">
          {[0, 72, 144, 216, 288].map((a) => <ellipse key={a} cx="0" cy="-17" rx="12" ry="18" fill="#ffe14d" stroke="#f2a900" strokeWidth="2" transform={`rotate(${a})`} />)}
          <circle r="9" fill="#ff9d1a" />
        </g>
        {/* hat */}
        <path d="M122 286 C118 186 182 142 268 142 C354 142 418 186 414 286 C398 318 364 304 340 318 C316 334 292 318 268 326 C244 318 220 334 196 318 C172 304 138 318 122 286Z" fill={g("hat")} />
        <path d="M150 232 C168 190 214 168 268 168" fill="none" stroke="#fff6b0" strokeWidth="9" strokeLinecap="round" opacity="0.6" />
        {/* flower on the hat */}
        <g transform="translate(212 156) rotate(-12)">
          {[0, 72, 144, 216, 288].map((a) => <ellipse key={a} cx="0" cy="-22" rx="15" ry="24" fill="#ffe66d" stroke="#f2a900" strokeWidth="2.5" transform={`rotate(${a})`} />)}
          <circle r="11" fill="#ffa21f" />
        </g>
        {/* sprout */}
        <path d="M278 144 C284 108 300 84 330 66" stroke="#55a640" strokeWidth="9" strokeLinecap="round" fill="none" />
        <path d="M330 66 C354 44 392 52 398 76 C372 92 342 88 330 66Z" fill={g("leaf")} />
        <path d="M338 68 C358 64 376 68 390 76" stroke="#3f8a2f" strokeWidth="2" fill="none" opacity="0.55" />
      </g>
      {/* sparkle strokes */}
      <g stroke="#f2a900" strokeWidth="5" strokeLinecap="round">
        <path d="M134 214 l-26 -10" /><path d="M146 190 l-16 -22" /><path d="M404 196 l22 -12" />
      </g>
    </svg>
  );
}
