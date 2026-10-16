// Metro for the pnpm monorepo. Workspace packages are used as TypeScript source (the
// `@vetlink/source` export condition), and their NodeNext imports say `./x.js` for `./x.ts`.
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

config.resolver.unstable_conditionNames = [
  '@vetlink/source',
  ...(config.resolver.unstable_conditionNames ?? []),
];

const upstream = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  const resolve = upstream ?? context.resolveRequest;
  const fromWorkspace =
    context.originModulePath.includes('/packages/') &&
    !context.originModulePath.includes('/node_modules/');
  if (fromWorkspace && moduleName.startsWith('.') && moduleName.endsWith('.js')) {
    try {
      return resolve(context, moduleName.slice(0, -3), platform);
    } catch {
      // not a TypeScript source file: fall through
    }
  }
  return resolve(context, moduleName, platform);
};

module.exports = config;
