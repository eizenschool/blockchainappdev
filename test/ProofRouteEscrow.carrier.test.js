import { expect } from "chai";
import { network } from "hardhat";

const { ethers, networkHelpers } = await network.create();
const { loadFixture, time } = networkHelpers;

const Role = Object.freeze({ Shipper: 1n, Carrier: 2n, Verifier: 3n });
const Status = Object.freeze({ Created: 0n, Accepted: 1n, Funded: 2n, PartiallyCompleted: 3n, Completed: 4n, Refunded: 5n });
const Milestone = Object.freeze({ Pickup: 0n, Delivery: 1n });

const PICKUP_CODE = "pickup-secret";
const DELIVERY_CODE = "delivery-secret";
const PICKUP_CID = "bafybeigdyrzt5sfp7udm7hu76uh7y26nf3nejbp2n44p36x6cp2t5q4m2u";
const REPLACEMENT_CID = "bafybeihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenxquvyku";
const DELIVERY_CID = "QmYwAPJzv5CZsnAzt8auVZRnGi2k3Cq1xJp5hB7mN9rT4s";
const ESCROW = ethers.parseEther("1");
const PICKUP_BPS = 3_000n;
const PICKUP_PAYOUT = (ESCROW * PICKUP_BPS) / 10_000n;
const DELIVERY_PAYOUT = ESCROW - PICKUP_PAYOUT;

async function futureDeadline(seconds = 3_600) {
  return BigInt(await time.latest()) + BigInt(seconds);
}

async function deployFixture() {
  const [deployer, shipper, carrier, verifier, unrelatedVerifier, stranger] = await ethers.getSigners();
  const contract = await ethers.deployContract("ProofRouteEscrow");
  await contract.waitForDeployment();
  await contract.connect(shipper).registerUser("Alice Shipper", Role.Shipper);
  await contract.connect(carrier).registerUser("Chris Carrier", Role.Carrier);
  await contract.connect(verifier).registerUser("Vera Verifier", Role.Verifier);
  await contract.connect(unrelatedVerifier).registerUser("Victor Verifier", Role.Verifier);
  return { contract, deployer, shipper, carrier, verifier, unrelatedVerifier, stranger };
}

async function createAgreement(contract, shipper, carrierAddress, verifierAddress, overrides = {}) {
  const deadline = overrides.deadline ?? (await futureDeadline());
  const escrow = overrides.escrow ?? ESCROW;
  const pickupBps = overrides.pickupBps ?? PICKUP_BPS;

  await contract.connect(shipper).createAgreement(
    carrierAddress,
    verifierAddress,
    "Medical supplies",
    "Kuala Lumpur",
    "Penang",
    escrow,
    deadline,
    pickupBps,
    ethers.id(PICKUP_CODE),
    ethers.id(DELIVERY_CODE),
  );
  return { deadline, escrow, pickupBps };
}

async function fundedAgreementFixture() {
  const fixture = await deployFixture();
  const values = await createAgreement(fixture.contract, fixture.shipper, fixture.carrier.address, fixture.verifier.address);
  await fixture.contract.connect(fixture.carrier).acceptAgreement(1);
  await fixture.contract.connect(fixture.shipper).fundAgreement(1, { value: ESCROW });
  return { ...fixture, ...values };
}

async function submitAndApprovePickup(contract, carrier, verifier) {
  await contract.connect(carrier).submitMilestoneEvidence(1, Milestone.Pickup, PICKUP_CID);
  return contract.connect(verifier).approveMilestone(1, Milestone.Pickup, PICKUP_CODE);
}

describe("ProofRouteEscrow: carrier evidence and verifier settlement", function () {
  describe("evidence submission, verification and payouts", function () {
    it("lets the carrier submit and replace pickup evidence before approval", async function () {
      const { contract, carrier } = await loadFixture(fundedAgreementFixture);
      await expect(contract.connect(carrier).submitMilestoneEvidence(1, Milestone.Pickup, PICKUP_CID))
        .to.emit(contract, "MilestoneEvidenceSubmitted");
      const firstSubmission = await contract.getMilestone(1, Milestone.Pickup);
      expect(firstSubmission.evidenceCid).to.equal(PICKUP_CID);
      expect(firstSubmission.submittedAt).to.be.greaterThan(0n);

      await contract.connect(carrier).submitMilestoneEvidence(1, Milestone.Pickup, REPLACEMENT_CID);
      expect((await contract.getMilestone(1, Milestone.Pickup)).evidenceCid).to.equal(REPLACEMENT_CID);
    });

    it("lets only the nominated verifier approve pickup and releases its payout", async function () {
      const { contract, carrier, verifier } = await loadFixture(fundedAgreementFixture);
      const contractAddress = await contract.getAddress();
      await contract.connect(carrier).submitMilestoneEvidence(1, Milestone.Pickup, PICKUP_CID);
      const carrierBalanceBefore = await ethers.provider.getBalance(carrier.address);

      const transaction = await contract.connect(verifier).approveMilestone(1, Milestone.Pickup, PICKUP_CODE);
      const receipt = await transaction.wait();
      const verificationBlock = await ethers.provider.getBlock(receipt.blockNumber);
      await expect(transaction)
        .to.emit(contract, "MilestoneVerified")
        .withArgs(1, Milestone.Pickup, verifier.address, carrier.address, verificationBlock.timestamp)
        .and.to.emit(contract, "EscrowReleased")
        .withArgs(1, Milestone.Pickup, carrier.address, PICKUP_PAYOUT);

      expect((await contract.getAgreement(1)).status).to.equal(Status.PartiallyCompleted);
      expect((await contract.getAgreement(1)).releasedAmount).to.equal(PICKUP_PAYOUT);
      expect((await contract.getMilestone(1, Milestone.Pickup)).completed).to.equal(true);
      expect(await ethers.provider.getBalance(contractAddress)).to.equal(DELIVERY_PAYOUT);
      expect(await ethers.provider.getBalance(carrier.address) - carrierBalanceBefore).to.equal(PICKUP_PAYOUT);

      const stats = await contract.getCarrierStats(carrier.address);
      expect(stats.verifiedMilestones).to.equal(1n);
      expect(stats.completedAgreements).to.equal(0n);
      expect(stats.expiredFundedAgreements).to.equal(0n);
    });

    it("approves delivery, pays every remaining wei, and completes the agreement", async function () {
      const { contract, carrier, verifier } = await loadFixture(fundedAgreementFixture);
      await submitAndApprovePickup(contract, carrier, verifier);
      await contract.connect(carrier).submitMilestoneEvidence(1, Milestone.Delivery, DELIVERY_CID);

      await expect(contract.connect(verifier).approveMilestone(1, Milestone.Delivery, DELIVERY_CODE))
        .to.emit(contract, "EscrowReleased")
        .withArgs(1, Milestone.Delivery, carrier.address, DELIVERY_PAYOUT)
        .and.to.emit(contract, "AgreementCompleted");
      expect((await contract.getAgreement(1)).status).to.equal(Status.Completed);
      expect((await contract.getAgreement(1)).releasedAmount).to.equal(ESCROW);
      expect((await contract.getMilestone(1, Milestone.Delivery)).completed).to.equal(true);
      expect(await ethers.provider.getBalance(await contract.getAddress())).to.equal(0n);

      const stats = await contract.getCarrierStats(carrier.address);
      expect(stats.verifiedMilestones).to.equal(2n);
      expect(stats.completedAgreements).to.equal(1n);
      expect(stats.expiredFundedAgreements).to.equal(0n);
    });

    it("assigns integer-division remainder to delivery so no dust is stranded", async function () {
      const { contract, shipper, carrier, verifier } = await loadFixture(deployFixture);
      await createAgreement(contract, shipper, carrier.address, verifier.address, { escrow: 10n, pickupBps: 3_333n });
      await contract.connect(carrier).acceptAgreement(1);
      await contract.connect(shipper).fundAgreement(1, { value: 10n });

      await contract.connect(carrier).submitMilestoneEvidence(1, Milestone.Pickup, PICKUP_CID);
      await expect(contract.connect(verifier).approveMilestone(1, Milestone.Pickup, PICKUP_CODE))
        .to.emit(contract, "EscrowReleased").withArgs(1, Milestone.Pickup, carrier.address, 3n);
      await contract.connect(carrier).submitMilestoneEvidence(1, Milestone.Delivery, DELIVERY_CID);
      await expect(contract.connect(verifier).approveMilestone(1, Milestone.Delivery, DELIVERY_CODE))
        .to.emit(contract, "EscrowReleased").withArgs(1, Milestone.Delivery, carrier.address, 7n);
      expect((await contract.getAgreement(1)).releasedAmount).to.equal(10n);
      expect(await ethers.provider.getBalance(await contract.getAddress())).to.equal(0n);
    });
  });

  describe("authorization, validation, ordering and expiry", function () {
    it("rejects evidence from anyone except the designated carrier", async function () {
      const { contract, verifier, stranger } = await loadFixture(fundedAgreementFixture);
      await expect(contract.connect(verifier).submitMilestoneEvidence(1, Milestone.Pickup, PICKUP_CID))
        .to.be.revertedWith("Only the assigned Carrier can submit evidence");
      await expect(contract.connect(stranger).submitMilestoneEvidence(1, Milestone.Pickup, PICKUP_CID))
        .to.be.revertedWith("Only the assigned Carrier can submit evidence");
    });

    it("rejects empty and oversized evidence CIDs", async function () {
      const { contract, carrier } = await loadFixture(fundedAgreementFixture);
      await expect(contract.connect(carrier).submitMilestoneEvidence(1, Milestone.Pickup, ""))
        .to.be.revertedWith("Evidence CID must be 1 to 128 characters");
      await expect(contract.connect(carrier).submitMilestoneEvidence(1, Milestone.Pickup, "x".repeat(129)))
        .to.be.revertedWith("Evidence CID must be 1 to 128 characters");
    });

    it("rejects self-approval, unrelated verifiers, approval without evidence, and bad codes", async function () {
      const { contract, carrier, verifier, unrelatedVerifier } = await loadFixture(fundedAgreementFixture);
      await expect(contract.connect(verifier).approveMilestone(1, Milestone.Pickup, PICKUP_CODE))
        .to.be.revertedWith("Evidence must be submitted before approval");
      await contract.connect(carrier).submitMilestoneEvidence(1, Milestone.Pickup, PICKUP_CID);
      await expect(contract.connect(carrier).approveMilestone(1, Milestone.Pickup, PICKUP_CODE))
        .to.be.revertedWith("Only the nominated Verifier can approve");
      await expect(contract.connect(unrelatedVerifier).approveMilestone(1, Milestone.Pickup, PICKUP_CODE))
        .to.be.revertedWith("Only the nominated Verifier can approve");
      await expect(contract.connect(verifier).approveMilestone(1, Milestone.Pickup, "wrong-code"))
        .to.be.revertedWith("Proof code is incorrect");
      expect((await contract.getCarrierStats(carrier.address)).verifiedMilestones).to.equal(0n);
    });

    it("rejects milestone actions before funding and delivery before pickup", async function () {
      const { contract, shipper, carrier, verifier } = await loadFixture(deployFixture);
      await createAgreement(contract, shipper, carrier.address, verifier.address);
      await contract.connect(carrier).acceptAgreement(1);
      await expect(contract.connect(carrier).submitMilestoneEvidence(1, Milestone.Pickup, PICKUP_CID))
        .to.be.revertedWith("Pickup requires a funded agreement");

      await contract.connect(shipper).fundAgreement(1, { value: ESCROW });
      await expect(contract.connect(carrier).submitMilestoneEvidence(1, Milestone.Delivery, DELIVERY_CID))
        .to.be.revertedWith("Delivery requires approved pickup");
      await expect(contract.connect(verifier).approveMilestone(1, Milestone.Delivery, DELIVERY_CODE))
        .to.be.revertedWith("Delivery requires approved pickup");
    });

    it("rejects repeated approval and post-approval evidence replacement", async function () {
      const { contract, carrier, verifier } = await loadFixture(fundedAgreementFixture);
      await submitAndApprovePickup(contract, carrier, verifier);
      await expect(contract.connect(verifier).approveMilestone(1, Milestone.Pickup, PICKUP_CODE))
        .to.be.revertedWith("Milestone is already completed");
      await expect(contract.connect(carrier).submitMilestoneEvidence(1, Milestone.Pickup, REPLACEMENT_CID))
        .to.be.revertedWith("Milestone is already completed");
      expect((await contract.getCarrierStats(carrier.address)).verifiedMilestones).to.equal(1n);
    });

    it("rejects evidence and approval after the agreement deadline", async function () {
      const { contract, carrier, verifier, deadline } = await loadFixture(fundedAgreementFixture);
      await contract.connect(carrier).submitMilestoneEvidence(1, Milestone.Pickup, PICKUP_CID);
      await time.increaseTo(deadline + 1n);
      await expect(contract.connect(carrier).submitMilestoneEvidence(1, Milestone.Pickup, REPLACEMENT_CID))
        .to.be.revertedWith("Agreement deadline has passed");
      await expect(contract.connect(verifier).approveMilestone(1, Milestone.Pickup, PICKUP_CODE))
        .to.be.revertedWith("Agreement deadline has passed");
    });

    it("refunds only unreleased escrow and records a factual expiry", async function () {
      const { contract, shipper, carrier, verifier, stranger, deadline } = await loadFixture(fundedAgreementFixture);
      await submitAndApprovePickup(contract, carrier, verifier);
      await time.increaseTo(deadline + 1n);
      await expect(contract.connect(stranger).processExpiredAgreement(1))
        .to.emit(contract, "AgreementRefunded").withArgs(1, shipper.address, DELIVERY_PAYOUT);
      expect((await contract.getAgreement(1)).status).to.equal(Status.Refunded);
      expect(await ethers.provider.getBalance(await contract.getAddress())).to.equal(0n);
      const stats = await contract.getCarrierStats(carrier.address);
      expect(stats.verifiedMilestones).to.equal(1n);
      expect(stats.completedAgreements).to.equal(0n);
      expect(stats.expiredFundedAgreements).to.equal(1n);
    });
  });

  describe("payout transfer safety", function () {
    async function harnessFixture() {
      const fixture = await deployFixture();
      const harness = await ethers.deployContract("PayoutReceiverHarness", [await fixture.contract.getAddress()]);
      await harness.waitForDeployment();
      await harness.registerAsCarrier();
      await createAgreement(fixture.contract, fixture.shipper, await harness.getAddress(), fixture.verifier.address);
      await harness.accept(1);
      await fixture.contract.connect(fixture.shipper).fundAgreement(1, { value: ESCROW });
      await harness.submitEvidence(Milestone.Pickup, PICKUP_CID);
      return { ...fixture, harness };
    }

    it("rolls back milestone and reputation state when the carrier rejects payout", async function () {
      const { contract, verifier, harness } = await loadFixture(harnessFixture);
      await harness.configureReceiver(true, false);
      await expect(contract.connect(verifier).approveMilestone(1, Milestone.Pickup, PICKUP_CODE))
        .to.be.revertedWith("Ether transfer failed");
      expect((await contract.getAgreement(1)).status).to.equal(Status.Funded);
      expect((await contract.getAgreement(1)).releasedAmount).to.equal(0n);
      expect((await contract.getMilestone(1, Milestone.Pickup)).completed).to.equal(false);
      expect((await contract.getCarrierStats(await harness.getAddress())).verifiedMilestones).to.equal(0n);
      expect(await ethers.provider.getBalance(await contract.getAddress())).to.equal(ESCROW);
    });

    it("blocks reentrant evidence submission while completing the original payout", async function () {
      const { contract, verifier, harness } = await loadFixture(harnessFixture);
      await harness.configureReceiver(false, true);
      await contract.connect(verifier).approveMilestone(1, Milestone.Pickup, PICKUP_CODE);
      expect(await harness.reentryBlocked()).to.equal(true);
      expect((await contract.getAgreement(1)).status).to.equal(Status.PartiallyCompleted);
      expect((await contract.getAgreement(1)).releasedAmount).to.equal(PICKUP_PAYOUT);
      expect(await ethers.provider.getBalance(await contract.getAddress())).to.equal(DELIVERY_PAYOUT);
    });
  });
});
