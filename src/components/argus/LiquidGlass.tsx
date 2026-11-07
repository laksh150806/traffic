/**
 * Liquid glass: an SVG displacement filter that bends whatever is behind a surface like a thick
 * lens, used through `backdrop-filter: url(#liquid-glass)` on the few surfaces that float over the
 * map (command line, eye readout). Chromium honours it; other browsers fall back to plain blur.
 */
export function LiquidGlassDefs() {
  return (
    <svg width="0" height="0" className="absolute" aria-hidden focusable="false">
      <filter
        id="liquid-glass"
        x="0"
        y="0"
        width="100%"
        height="100%"
        colorInterpolationFilters="sRGB"
      >
        <feTurbulence
          type="fractalNoise"
          baseFrequency="0.008 0.02"
          numOctaves="2"
          seed="7"
          result="noise"
        />
        <feGaussianBlur in="noise" stdDeviation="2" result="soft" />
        <feDisplacementMap
          in="SourceGraphic"
          in2="soft"
          scale="38"
          xChannelSelector="R"
          yChannelSelector="G"
          result="bent"
        />
        <feGaussianBlur in="bent" stdDeviation="1.4" />
      </filter>
    </svg>
  );
}
