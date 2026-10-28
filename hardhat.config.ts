import { defineConfig } from 'hardhat/config';

export default defineConfig({
  paths: {
    sources: './contracts',
    tests: { solidity: './contracts' },
    cache: './cache',
    artifacts: './artifacts',
  },
  solidity: {
    version: '0.8.28',
    settings: {
      evmVersion: 'paris',
      optimizer: { enabled: true, runs: 200 },
    },
  },
  test: {
    solidity: {
      isolate: true,
      fuzz: { runs: 128 },
    },
  },
});
