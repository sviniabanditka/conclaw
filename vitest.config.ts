import path from 'path';

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: [
      'src/**/*.test.ts',
      'setup/**/*.test.ts',
      // The front end has logic worth testing too — a cron expression read
      // back in words goes in front of someone deciding whether to delete a
      // task, so a wrong reading is not cosmetic.
      'miniapp-ui/src/**/*.test.ts',
    ],
  },
  resolve: {
    alias: { '@': path.join(import.meta.dirname, 'miniapp-ui/src') },
  },
});
