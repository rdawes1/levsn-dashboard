/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Fully static output - the dashboard reads a prebuilt snapshot, so there is
  // no server runtime to host and nowhere for the Airtable token to live.
  output: 'export',
  images: { unoptimized: true },
  // Production builds write to their own directory so running `npm run build`
  // never clobbers the cache of a `npm run dev` server on the same machine.
  distDir: process.env.NEXT_DIST_DIR || '.next',
  // NOTE: embedding headers cannot be set from a static export. They are served
  // by Cloudflare instead - see public/_headers.
};
export default nextConfig;
