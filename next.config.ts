import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // The dev server is reached through the sandbox's preview proxy, so the
  // browser sends the preview hostname rather than localhost. Next rejects
  // untrusted Host headers during development unless they're listed here.
  allowedDevOrigins: ['pv-b7915a1b468d-958ea0ba-bf87-43f4-ad33-f330a3409377.style.dev'],

  // The chess engine ships as a static asset in /public/engine and is loaded
  // as a Web Worker by same-origin URL. Keeping it out of the bundler avoids
  // Next trying to parse the emscripten glue code.
  serverExternalPackages: [],
};

export default nextConfig;
