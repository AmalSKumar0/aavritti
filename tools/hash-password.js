const bcrypt = require('bcryptjs');
const readline = require('readline');

const argPass = process.argv.slice(2).find((arg) => !arg.startsWith('-'));

if (argPass) {
  const hash = bcrypt.hashSync(argPass, 12);
  console.log('\nGenerated Bcrypt Hash (rounds=12):');
  console.log(hash);
  console.log('\nCopy into your .env or Vercel Environment Variables:');
  console.log(`ADMIN_PASSWORD_HASH='${hash}'\n`);
  process.exit(0);
}

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

rl.question('Enter password to hash: ', (password) => {
  if (!password || !password.trim()) {
    console.error('Password cannot be empty.');
    process.exit(1);
  }
  const hash = bcrypt.hashSync(password.trim(), 12);
  console.log('\nGenerated Bcrypt Hash (rounds=12):');
  console.log(hash);
  console.log('\nCopy into your .env or Vercel Environment Variables:');
  console.log(`ADMIN_PASSWORD_HASH='${hash}'\n`);
  rl.close();
});
