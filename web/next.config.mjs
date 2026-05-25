const backendOrigin = process.env.BACKEND_ORIGIN || "http://localhost:8000";
const isDesktopExport = process.env.NEXT_OUTPUT_MODE === "export";

/** @type {import('next').NextConfig} */
const nextConfig = isDesktopExport
  ? {
      output: "export",
      assetPrefix: "./",
    }
  : {
      async rewrites() {
        return [
          {
            source: "/api/:path*",
            destination: `${backendOrigin}/api/:path*`,
          },
        ];
      },
    };

export default nextConfig;
