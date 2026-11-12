/** @type {import('next').NextConfig} */
const nextConfig = {
  outputFileTracingRoot: __dirname,
  // The client folder is picked at runtime (CLIENT), so the tracer cannot
  // see which voice.md and knowledge/ the functions read: ship them all.
  outputFileTracingIncludes: { '/**': ['./clients/**/*'] },
  // The panel and the admin act on a signed-in session: framed inside another
  // site, a click there could be steered. The widget is not listed, because
  // being framed in the client's site is how it works.
  async headers() {
    const noFrame = [{ key: 'X-Frame-Options', value: 'DENY' }];
    return [
      { source: '/panel/:path*', headers: noFrame },
      { source: '/admin/:path*', headers: noFrame },
      // Which commit a domain serves: a push to main has not always triggered a deploy
      // (scripts/check-prod.mjs compares it with origin/main). The repo is public.
      { source: '/:path*', headers: [{ key: 'X-Commit', value: (process.env.VERCEL_GIT_COMMIT_SHA ?? 'local').slice(0, 7) }] },
    ];
  },
};

module.exports = nextConfig;
