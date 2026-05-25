// One-off icon generator for PWA / iOS Web Push.
// Renders client/public/smartee.svg into PNGs at the sizes iOS + Android need.
//
// The original SVG is a stroke-only lightning bolt on a transparent
// background. iOS clips the home-screen icon to a rounded rectangle and
// fills the background black if it's transparent, which makes the bolt
// disappear into the dark theme. We solve this two ways:
//   * `icon-*.png`        — opaque dark navy background (matches theme)
//   * `icon-maskable.png` — same look, but with 10% safe-zone padding so
//                            Android's adaptive icon crop doesn't clip
//
// Run: cd client && node scripts/generate-icons.js

const fs = require('fs');
const path = require('path');
const { Resvg } = require('@resvg/resvg-js');

const PUBLIC_DIR = path.resolve(__dirname, '../public');
const SVG_PATH = path.join(PUBLIC_DIR, 'smartee.svg');

// All sizes iOS, Android and the manifest standard need.
// 180 = apple-touch-icon (iOS home screen, mandatory for iOS PWA)
// 192 = manifest minimum recommended
// 512 = manifest splash screen + app store quality
const SIZES = [180, 192, 512];

// Wrap the stroke-only icon in a square with the brand background so the
// rendered PNG is opaque and high-contrast on iOS / Android home screens.
function wrapSvgForIcon(svg, padPct = 0) {
    // Scale the bolt down by `padPct` so masking systems don't clip it.
    const scale = 1 - padPct * 2;
    const offset = padPct * 100;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <rect width="100" height="100" fill="#0f172a"/>
  <g transform="translate(${offset} ${offset}) scale(${scale})">
    ${svg.replace(/<\?xml[^?]*\?>/, '').replace(/<svg[^>]*>/, '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="100" height="100" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none" stroke="url(#grad1)">')}
  </g>
</svg>`;
}

function render(svgString, sizePx) {
    const resvg = new Resvg(svgString, {
        fitTo: { mode: 'width', value: sizePx },
        background: '#0f172a',
    });
    return resvg.render().asPng();
}

function main() {
    const rawSvg = fs.readFileSync(SVG_PATH, 'utf-8');

    // Standard icons — opaque background, full-bleed bolt.
    const standardSvg = wrapSvgForIcon(rawSvg, 0);
    for (const size of SIZES) {
        const out = path.join(PUBLIC_DIR, `icon-${size}.png`);
        fs.writeFileSync(out, render(standardSvg, size));
        console.log(`wrote ${out} (${size}x${size})`);
    }

    // Maskable icon — bolt inset 10% so Android's circle/squircle crop
    // doesn't slice it. Spec calls this the "safe zone".
    const maskableSvg = wrapSvgForIcon(rawSvg, 0.10);
    const maskableOut = path.join(PUBLIC_DIR, 'icon-maskable.png');
    fs.writeFileSync(maskableOut, render(maskableSvg, 512));
    console.log(`wrote ${maskableOut} (512x512, maskable)`);
}

main();
