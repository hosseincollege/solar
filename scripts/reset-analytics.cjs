const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline/promises');
const { Client } = require('pg');

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL دریافت نشد.');

  const connection = new URL(connectionString);
  if (!['postgres:', 'postgresql:'].includes(connection.protocol)) {
    throw new Error('آدرس باید یک اتصال PostgreSQL باشد.');
  }
  if (!connection.username || !connection.password) {
    throw new Error('آدرس اتصال نام کاربری یا رمز عبور ندارد؛ آدرس مستقیم را کامل وارد کن.');
  }

  const client = new Client({ connectionString });
  await client.connect();
  try {
    const { rows } = await client.query('SELECT current_database() AS database');
    const databaseName = rows[0]?.database ?? connection.pathname.slice(1);
    process.stdout.write(`مقصد اتصال: ${connection.hostname}:${connection.port || '5432'}/${databaseName}\n`);
    process.stdout.write('این عملیات فقط جدول‌های آمار بازدید Solar را پاک و دوباره ایجاد می‌کند.\n');
    const terminal = readline.createInterface({ input: process.stdin, output: process.stdout });
    let confirmation;
    try {
      confirmation = await terminal.question('برای تأیید دقیقاً RESET SOLAR ANALYTICS را وارد کن: ');
    } finally {
      terminal.close();
    }
    if (confirmation !== 'RESET SOLAR ANALYTICS') {
      process.stdout.write('عملیات لغو شد؛ دیتابیس تغییری نکرد.\n');
      return;
    }

    await client.query('BEGIN');
    for (const table of [
      'solar_presence',
      'solar_visits',
      'solar_unique_presence',
      'solar_unique_visits',
    ]) {
      await client.query(`DROP TABLE IF EXISTS ${table}`);
    }
    const schemaPath = path.join(process.cwd(), 'database', 'analytics.sql');
    await client.query(fs.readFileSync(schemaPath, 'utf8'));
    await client.query('COMMIT');
    process.stdout.write('انجام شد؛ جدول‌های آمار بازدید Solar از نو ساخته شدند.\n');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  process.stderr.write(`ریست ناموفق بود: ${error.message}\n`);
  process.exitCode = 1;
});
