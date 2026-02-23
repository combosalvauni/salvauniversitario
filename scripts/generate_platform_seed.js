import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function escapeSqlString(value) {
  return String(value ?? '').replace(/'/g, "''");
}

function main() {
  const workspaceRoot = path.join(__dirname, '..');
  const inputPath = path.join(workspaceRoot, 'facilitador.txt');
  const outputPath = path.join(workspaceRoot, 'seed_platforms_from_facilitador.sql');

  const input = fs.readFileSync(inputPath, 'utf8');

  const marker = '<div class="flex items-center justify-between p-4';
  const parts = input.split(marker).slice(1);

  const items = [];

  for (const part of parts) {
    const segment = marker + part;

    const srcMatch = segment.match(/<img\s+src="([^"]+)"/i);
    const altMatch = segment.match(/alt="([^"]+)"/i);
    const descMatch = segment.match(/<p class="text-sm text-gray-400 line-clamp-1">([^<]+)<\/p>/i);
    const statusMatches = [...segment.matchAll(/>(active|maintenance)</gi)];

    const imageUrl = srcMatch?.[1]?.trim();
    const name = altMatch?.[1]?.trim();
    const description = descMatch?.[1]?.trim();

    if (!name || !imageUrl || !description) continue;

    const statusRaw = (statusMatches.at(-1)?.[1] || 'active').toLowerCase();
    const status = statusRaw === 'maintenance' ? 'inactive' : 'active';

    items.push({ name, description, image_url: imageUrl, status });
  }

  // Deduplicate by name (keep first)
  const byName = new Map();
  for (const item of items) {
    if (!byName.has(item.name)) byName.set(item.name, item);
  }

  const uniqueItems = [...byName.values()];
  uniqueItems.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));

  const valuesLines = uniqueItems.map((p) =>
    `  ('${escapeSqlString(p.name)}', '${escapeSqlString(p.description)}', '${escapeSqlString(p.image_url)}', '${escapeSqlString(p.status)}')`
  );

  const sql = `-- Generated from facilitador.txt (bulk insert platforms)\n-- Status mapping: maintenance -> inactive, active -> active\n\ninsert into public.platforms (name, description, image_url, status)\nselect * from (\nvalues\n${valuesLines.join(',\n')}\n) as v(name, description, image_url, status)\nwhere not exists (\n  select 1 from public.platforms p where p.name = v.name\n);\n`;

  fs.writeFileSync(outputPath, sql, 'utf8');

  console.log(`✅ Generated: ${path.relative(workspaceRoot, outputPath)}`);
  console.log(`Platforms found: ${items.length}`);
  console.log(`Platforms unique: ${uniqueItems.length}`);
  console.log('Next: run the generated SQL in Supabase SQL Editor.');
}

main();
