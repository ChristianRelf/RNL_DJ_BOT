/**
 * Entry point. The real server is loaded dynamically so that configuration
 * errors — which are thrown while the config module is first evaluated — are
 * reported as a readable message instead of a stack trace.
 */
async function boot(): Promise<void> {
  try {
    const { start } = await import('./server');
    await start();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`\n  Could not start the DJ bot:\n  ${message}\n`);
    if (process.env.LOG_LEVEL === 'debug' && err instanceof Error) console.error(err.stack);
    process.exit(1);
  }
}

void boot();
