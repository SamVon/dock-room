import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // `npm run share` builds into its own folder, so a normal build or dev server
  // can never replace the files of a copy that friends are using.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  devIndicators: false,
  // Do not advertise the framework in response headers.
  poweredByHeader: false,
};

export default nextConfig;
