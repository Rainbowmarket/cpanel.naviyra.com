import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const config = {
  plugins: {
    [require.resolve("@tailwindcss/postcss")]: {},
  },
};

export default config;
