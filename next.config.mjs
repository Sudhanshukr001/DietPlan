// Plain JS on purpose: a TypeScript config forces Next to run SWC at server
// start, and the native SWC binary crashes with SIGBUS on this machine.
const nextConfig = {
  reactStrictMode: true,
};

export default nextConfig;
