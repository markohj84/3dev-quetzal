/** @type {import('next').NextConfig} */
const nextConfig = {
  outputFileTracingRoot: __dirname,
  // The client folder is picked at runtime (CLIENT), so the tracer cannot
  // see which voice.md and knowledge/ the functions read: ship them all.
  outputFileTracingIncludes: { '/**': ['./clients/**/*'] },
};

module.exports = nextConfig;
