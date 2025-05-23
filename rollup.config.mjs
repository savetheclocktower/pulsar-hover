import commonjs from '@rollup/plugin-commonjs';
import resolve from '@rollup/plugin-node-resolve';
import json from '@rollup/plugin-json';
import typescript from '@rollup/plugin-typescript';

export default {
  input: 'src/index.ts',
  output: {
    file: 'lib/index.js',
    format: 'cjs',
    exports: 'auto',
    interop: 'auto',
    sourcemap: true
  },
  plugins: [
    resolve({
      extensions: ['.js', '.ts', '.json'],
      preferBuiltins: true,
      mainFields: ['module'],
      // Enforces that only ES modules are found; CommonJS modules are treated
      // as external. This saves us from having to transpile them or needlessly
      // include them in the bundle.
      modulesOnly: true
    }),
    commonjs({
      include: /node_modules/,
      // Enable transformations of ES modules in `node_modules`.
      transformMixedEsModules: true,
      // Handle requiring JSON files.
      ignoreDynamicRequires: false
    }),
    typescript({
      tsconfig: './tsconfig.json',
      sourceMap: true
    }),
    json()
  ],
  // Mark certain packages as external; this tells Rollup not to try to
  // transpile or bundle this package's code. CommonJS modules should
  // automatically be treated as external, but you can manually specify any
  // further package you want to make external if you know what you're doing.
  external: [
    'atom',
  ]
};
