import { defineConfig } from 'vite';

// Relative base so the build works from GitHub Pages or any folder on a booth PC.
export default defineConfig({
  base: './',
  test: { environment: 'node' },
});
