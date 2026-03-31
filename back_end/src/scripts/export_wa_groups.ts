import path from 'path';
import fs from 'fs/promises';
import dotenv from 'dotenv';
import { Client, LocalAuth } from 'whatsapp-web.js';
import qrcode from 'qrcode-terminal';

const resolveEnvFile = () => {
  const explicit = String(process.env.ENV_FILE || '').trim();
  if (explicit) return path.resolve(process.cwd(), explicit);
  return path.resolve(process.cwd(), '.env');
};

dotenv.config({ path: resolveEnvFile() });

const timestamp = () => {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
};

const sessionPathRaw = String(process.env.WA_SESSION_PATH || './.wwebjs_auth').trim();
const sessionPath = path.resolve(process.cwd(), sessionPathRaw);
const outDir = path.resolve(process.cwd(), 'testing');

const client = new Client({
  authStrategy: new LocalAuth({ dataPath: sessionPath }),
  puppeteer: {
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--no-zygote', '--no-first-run'],
  },
});

client.on('qr', (qr) => {
  console.log('[WA] QR received (scan this if not logged in yet)');
  qrcode.generate(qr, { small: true });
});

client.on('ready', async () => {
  try {
    const chats = await client.getChats();
    const groups = chats.filter((c: any) => c?.isGroup);

    const payload = groups.map((g: any) => ({
      id: g?.id?._serialized ?? null,
      name: String(g?.name ?? ''),
      participants_count: Array.isArray(g?.participants) ? g.participants.length : null,
      participants: Array.isArray(g?.participants)
        ? g.participants.map((p: any) => ({
            id: p?.id?._serialized ?? null,
            is_admin: !!p?.isAdmin,
            is_super_admin: !!p?.isSuperAdmin,
          }))
        : null,
    }));

    await fs.mkdir(outDir, { recursive: true });
    const outPath = path.join(outDir, `wa_groups_${timestamp()}.json`);
    await fs.writeFile(outPath, JSON.stringify(payload, null, 2), 'utf8');

    console.log(`\nFound ${payload.length} group(s):`);
    for (const g of payload) console.log(`- ${g.name || '(no name)'} (${g.id})`);
    console.log(`\nSaved: ${outPath}`);

    await client.destroy();
    process.exit(0);
  } catch (err) {
    console.error('Export failed:', err);
    try {
      await client.destroy();
    } catch {}
    process.exit(1);
  }
});

client
  .initialize()
  .catch((err) => {
    console.error('WhatsApp initialize failed:', err);
    process.exit(1);
  });

