/** @type {import('next').NextConfig} */
const nextConfig = {
  // Workspace packages ship TypeScript source (exports → ./src/index.ts); transpile them.
  transpilePackages: [
    '@falcon/db',
    '@falcon/core',
    '@falcon/queue',
    '@falcon/secrets',
    '@falcon/config',
    '@falcon/integrations',
    '@falcon/llm',
  ],
};
export default nextConfig;
