import { Keypair } from '@solana/web3.js';

function measureKeysPerSecond() {
  let count = 0;
  const startTime = Date.now();
  const endTime = startTime + 5000;
  while (Date.now() < endTime) {
    Keypair.generate();
    count++;
  }
  return count / 5;
}

console.log(`Single-thread APS: ${measureKeysPerSecond()}`);