# ProofRoute

ProofRoute is a logistics escrow dApp built for the BMIS2003 blockchain assignment. A Shipper creates and funds a delivery agreement with test ETH; a Carrier later proves pickup and delivery to unlock progressive payouts. Member A's foundation implements wallet registration, agreement creation and acceptance, exact escrow funding, pre-funding cancellation, and deterministic expiry refunds.

## Stack

- Solidity 0.8.28 and OpenZeppelin Contracts 5
- Hardhat 3, Ethers.js 6, Mocha and Chai
- React 19 and Vite 8
- MetaMask and local Hardhat chain ID 31337

See [AGENTS.md](AGENTS.md) for project constraints and [docs/BUSINESS_RULES.md](docs/BUSINESS_RULES.md) for the lifecycle and architecture.

## Install

Requirements: Node.js 22.13 or newer, npm, Git, and the MetaMask browser extension.

```bash
npm install
```

The committed lockfile should be used by other group members with `npm ci` after the first install.

## Test and build

```bash
npm test
npm run frontend:lint
npm run frontend:build
```

## Run locally

Start the local blockchain in terminal 1:

```bash
npm run node
```

Deploy and synchronize the ABI/address in terminal 2:

```bash
npm run deploy:local
```

Start the interface in terminal 3:

```bash
npm run frontend:dev
```

Open the URL shown by Vite. In MetaMask, add a local network using RPC URL `http://127.0.0.1:8545` and chain ID `31337`. Import test accounts only from the currently running Hardhat node. Never use those public development keys for real assets.

## Member workflow

- Member A branch: `feature/shipper-escrow`
- Member B branch after foundation review: `feature/carrier-milestones`
- Changes to shared enums, structures, events, or public function signatures require both members to coordinate because they change the frontend ABI.

## Assignment integrity

This repository is original work. AI assistance, libraries, documentation, and any other sources should be acknowledged in the written report. Both members must understand and be able to explain their own code during evaluation.
