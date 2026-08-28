import { BAKEOFF_KS, runBakeoff } from './index.js';

/** CLI: `pnpm --filter @falcon/evals recall`. Needs VOYAGE_API_KEY. Prints mean recall@k per model
 *  so we can settle the embedding choice on evidence, not vibes (research D6). */
async function main(): Promise<void> {
  const apiKey = process.env.VOYAGE_API_KEY;
  if (!apiKey) {
    console.error('VOYAGE_API_KEY is required to run the recall@k bake-off.');
    process.exit(1);
    return;
  }
  const res = await runBakeoff(apiKey);
  console.log('recall@k bake-off (higher is better; tiny fixture — replace before trusting):');
  for (const [model, ks] of Object.entries(res)) {
    const cols = BAKEOFF_KS.map((k) => `R@${k}=${ks[k]!.toFixed(3)}`).join('  ');
    console.log(`  ${model.padEnd(18)} ${cols}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
