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
  // Workspace sources use NodeNext-style `.js` import specifiers that resolve to `.ts`
  // files (tsx/tsc honor this; webpack does not by default). Map `.js` → `.ts`/`.tsx`
  // so transpiled packages resolve in both `next dev` and `next build`.
  webpack: (config) => {
    config.resolve.extensionAlias = {
      ...(config.resolve.extensionAlias ?? {}),
      '.js': ['.ts', '.tsx', '.js'],
      '.mjs': ['.mts', '.mjs'],
    };
    return config;
  },
};
export default nextConfig;
