/** Upload a file to FastFS (NEAR on-chain file hosting) the way outlayer-cli does: a `__fastdata_fastfs`
 * function call whose Borsh args carry the file. It is sent with 1 gas so it fails by design; the FastFS
 * indexer reads the data from the transaction arguments. Signs with the operator key from .env.
 * Usage: node --import tsx scripts/fastfs-upload.ts <file> [receiver=outlayer.testnet]
 * Prints the https URL to use as an OutLayer `WasmUrl` source. Files up to 1 MB. */
import '../src/server/env';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { extname } from 'node:path';
import { Account, actions, type KeyPairString } from 'near-api-js';
import { NEAR_NETWORK, provider } from '../src/server/near/chain';

const file = process.argv[2];
if (!file) throw new Error('usage: fastfs-upload.ts <file> [receiver]');
const receiver = process.argv[3] || (NEAR_NETWORK === 'mainnet' ? 'outlayer.near' : 'outlayer.testnet');
const content = readFileSync(file);
if (content.length > 1 << 20) throw new Error('Files over 1 MB need chunked upload; use outlayer-cli');
const hash = createHash('sha256').update(content).digest('hex');
const ext = extname(file).slice(1) || 'bin';
const mime = ext === 'wasm' ? 'application/wasm' : 'application/octet-stream';
const relativePath = `${hash}.${ext}`;

const u32 = (n: number) => {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n);
  return b;
};
const str = (s: string) => {
  const b = Buffer.from(s, 'utf8');
  return Buffer.concat([u32(b.length), b]);
};
// FastfsData::Simple(SimpleFastfs { relative_path, content: Some(FastfsFileContent { mime_type, content }) })
const payload = Buffer.concat([
  Buffer.from([0]),
  str(relativePath),
  Buffer.from([1]),
  str(mime),
  u32(content.length),
  content,
]);

const sender = process.env.ARENA_OPERATOR_ID!;
const account = new Account(sender, provider, process.env.ARENA_OPERATOR_PRIVATE_KEY as KeyPairString);
const outcome = await account.signAndSendTransaction({
  receiverId: receiver,
  actions: [actions.functionCall('__fastdata_fastfs', payload, 1n, 0n)],
  waitUntil: 'INCLUDED_FINAL',
  throwOnFailure: false,
});
const host = NEAR_NETWORK === 'mainnet' ? 'main.fastfs.io' : 'test.fastfs.io';
console.log(
  JSON.stringify({
    tx: outcome.transaction?.hash ?? (outcome as { transaction_outcome?: { id: string } }).transaction_outcome?.id,
    sha256: hash,
    size: content.length,
    url: `https://${host}/${sender}/${receiver}/${relativePath}`,
  }),
);
