/**
 * Exports donated research samples as JSON Lines for model evaluation.
 *
 *   npm run research:export                      -> ../ml-service/data/research/samples.jsonl
 *   npm run research:export -- --out path.jsonl
 *
 * Samples are pseudonymous (see src/services/research.js): no names, emails,
 * user ids or media. Then evaluate with:
 *   python ml-service/scripts/evaluate_research_data.py
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mongoose from 'mongoose';
import env from '../src/config/env.js';
import ResearchSample from '../src/models/ResearchSample.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const outIdx = process.argv.indexOf('--out');
const out = outIdx > -1
  ? path.resolve(process.argv[outIdx + 1])
  : path.resolve(here, '../../ml-service/data/research/samples.jsonl');

await mongoose.connect(env.mongoUri);
const rows = await ResearchSample.find({}, { _id: 0 }).lean();
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, rows.map((r) => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : ''));

const people = new Set(rows.map((r) => r.participantId));
const byDx = {};
for (const r of rows) byDx[r.diagnosis] = (byDx[r.diagnosis] || 0) + 1;
console.log(`[research] ${rows.length} samples from ${people.size} participants -> ${out}`);
console.log('[research] samples by self-reported diagnosis:', byDx);
await mongoose.disconnect();
