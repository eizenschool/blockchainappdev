# ProofRoute

ProofRoute is a medical-supply logistics escrow dApp for the BMIS2003 blockchain assignment. A Shipper funds a delivery agreement with test ETH, a Carrier records pickup and delivery photo evidence using IPFS CIDs, and a separately nominated Verifier reviews that evidence before each progressive payout.

The contract stores CIDs, not image files. IPFS provides content addressing and integrity, but it does not prove that a photo is truthful. This is an educational local-network system and must never be used with real money or sensitive evidence.

## Stack

- Solidity 0.8.28 and OpenZeppelin Contracts 5
- Hardhat 3, Ethers.js 6, Mocha and Chai
- React 19 and Vite 8
- MetaMask and local Hardhat chain ID 31337

See [AGENTS.md](AGENTS.md) for project constraints and [docs/BUSINESS_RULES.md](docs/BUSINESS_RULES.md) for the lifecycle and module design.

## Install and quality checks

Requirements: Node.js 22.13 or newer, npm, Git, and MetaMask.

```bash
npm ci
npm test
npm run frontend:lint
npm run frontend:build
```

## Run locally

Use three terminals:

```bash
# terminal 1
npm run node

# terminal 2
npm run deploy:local

# terminal 3
npm run frontend:dev
```

In MetaMask, add RPC URL `http://127.0.0.1:8545` with chain ID `31337`. Import test accounts only from the currently running Hardhat node. Those development keys are public and must never hold real assets.

Redeploy whenever the contract changes or the local node restarts. Deployment regenerates `frontend/src/contracts/deployment.json`, including the address and ABI; refresh the interface afterward.

## Three-wallet demonstration

1. Import three local Hardhat accounts into MetaMask.
2. Register account 1 as Shipper, account 2 as Carrier, and account 3 as Verifier.
3. In the Shipper dashboard, create a medical-supply agreement using the Carrier and Verifier addresses. Temporarily record both one-time codes outside the app; the interface deliberately does not save them.
4. Switch to the Carrier, accept the agreement, then switch back to the Shipper and fund the exact test-ETH amount.
5. Upload a non-sensitive pickup photo to an external IPFS service and paste its CID in the Carrier dashboard. There is no Pinata token or built-in upload feature.
6. Switch to the nominated Verifier, open the gateway link, review the evidence, and enter the pickup code. Approval releases only the pickup allocation.
7. Repeat evidence submission and Verifier approval for delivery. The remaining escrow, including rounding remainder, is released and the agreement becomes Completed.
8. Review the chronological on-chain event history and the Carrier's raw milestone, completion, and funded-expiry counts.

Evidence and submitted proof codes become public blockchain data. Do not upload faces, patient records, addresses, or other private information. Use dummy medical-supply photos for the demonstration.

## Branch checkpoints

- `dev`: merged and verified original two-role implementation
- `baseline/two-role-v1`: safe fallback tag
- `feature/verifier-evidence`: tested enhanced monolithic checkpoint
- `module/01-registry`: users, agreements, participant indexes and getters
- `module/02-escrow-vault`: exact funding and Ether custody
- `module/03-evidence-settlement`: evidence, Verifier approval and payouts
- `module/04-expiry-reputation`: cancellation, refunds and factual counters
- `module/05-frontend-history`: complete modular integration, interface, history, deployment data and documentation

`main` remains unchanged. The Verifier ABI should be merged into `dev` only after the team or tutor accepts the scope change and the manual MetaMask demonstration passes.

## Assignment integrity

This repository is original project work. AI assistance, OpenZeppelin, Hardhat, Ethers, React, Vite, IPFS documentation, and all other sources used must be acknowledged in the written report. Both members should understand and be able to explain the code during evaluation.
