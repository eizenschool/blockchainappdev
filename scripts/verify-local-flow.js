import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { network } from "hardhat";

const { ethers } = await network.create();
const deployment = JSON.parse(
  await readFile(path.resolve("frontend/src/contracts/deployment.json"), "utf8"),
);
const [shipper, carrier, verifier] = await ethers.getSigners();
const contract = await ethers.getContractAt("ProofRouteEscrow", deployment.address);

const pickupCode = ethers.hexlify(ethers.randomBytes(16));
const deliveryCode = ethers.hexlify(ethers.randomBytes(16));
const escrow = ethers.parseEther("0.1");
const latestBlock = await ethers.provider.getBlock("latest");
const deadline = BigInt(latestBlock.timestamp + 3_600);

await (await contract.connect(shipper).registerUser("Demo Shipper", 1)).wait();
await (await contract.connect(carrier).registerUser("Demo Carrier", 2)).wait();
await (await contract.connect(verifier).registerUser("Demo Verifier", 3)).wait();
await (
  await contract.connect(shipper).createAgreement(
    carrier.address,
    verifier.address,
    "Demonstration medical supplies",
    "Kuala Lumpur",
    "Penang",
    escrow,
    deadline,
    3_000,
    ethers.id(pickupCode),
    ethers.id(deliveryCode),
  )
).wait();

const agreementId = await contract.agreementCount();
await (await contract.connect(carrier).acceptAgreement(agreementId)).wait();
await (await contract.connect(shipper).fundAgreement(agreementId, { value: escrow })).wait();
await (await contract.connect(carrier).submitMilestoneEvidence(agreementId, 0, "bafybeigdyrzt5sfp7udm7hu76uh7y26nf3nejbp2n44p36x6cp2t5q4m2u")).wait();
await (await contract.connect(verifier).approveMilestone(agreementId, 0, pickupCode)).wait();
await (await contract.connect(carrier).submitMilestoneEvidence(agreementId, 1, "bafybeihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenxquvyku")).wait();
await (await contract.connect(verifier).approveMilestone(agreementId, 1, deliveryCode)).wait();

const agreement = await contract.getAgreement(agreementId);
const stats = await contract.getCarrierStats(carrier.address);
assert.equal(agreement.status, 4n, "agreement did not reach Completed");
assert.equal(agreement.releasedAmount, escrow, "full escrow was not released");
assert.equal(stats.verifiedMilestones, 2n, "milestone reputation count is incorrect");
assert.equal(stats.completedAgreements, 1n, "completion reputation count is incorrect");

console.log(`Three-wallet flow passed for agreement #${agreementId}.`);
console.log(`Shipper ${shipper.address}`);
console.log(`Carrier ${carrier.address}`);
console.log(`Verifier ${verifier.address}`);
