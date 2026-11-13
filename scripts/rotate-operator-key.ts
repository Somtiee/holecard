/** Rotate the arena operator's full-access key without ever printing a private key.
 *   add:    node --import tsx scripts/rotate-operator-key.ts add <new-key-file>
 *           signs with ARENA_OPERATOR_PRIVATE_KEY, adds a fresh key, writes it (mode 600) to <new-key-file>
 *   remove: node --import tsx scripts/rotate-operator-key.ts remove <old-public-key>
 *           run with ARENA_OPERATOR_PRIVATE_KEY already set to the NEW key, once the server uses it */
import '../src/server/env';
import { writeFileSync } from 'node:fs';
import { Account, KeyPair, type KeyPairString } from 'near-api-js';
import { provider } from '../src/server/near/chain';

const [mode, arg] = process.argv.slice(2);
const id = process.env.ARENA_OPERATOR_ID!;
const current = process.env.ARENA_OPERATOR_PRIVATE_KEY as KeyPairString;
const account = new Account(id, provider, current);
if (mode === 'add' && arg) {
  const next = KeyPair.fromRandom('ed25519');
  await account.addFullAccessKey(next.getPublicKey().toString());
  writeFileSync(arg, next.toString(), { mode: 0o600 });
  console.log(`added ${next.getPublicKey()} to ${id}; old key ${KeyPair.fromString(current).getPublicKey()}`);
} else if (mode === 'remove' && arg) {
  if (KeyPair.fromString(current).getPublicKey().toString() === arg)
    throw new Error('Refusing to delete the key in use');
  await account.deleteKey(arg);
  console.log(`removed ${arg} from ${id}`);
} else throw new Error('usage: rotate-operator-key.ts add <file> | remove <old-public-key>');
