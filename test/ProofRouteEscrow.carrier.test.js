import { expect } from "chai";
import { network } from "hardhat";

const { ethers, networkHelpers } = await network.create();
const { loadFixture, time } = networkHelpers;

const Role = Object.freeze({ Shipper: 1n, Carrier: 2n });
const Status = Object.freeze({
  Created: 0n,
  Accepted: 1n,
  Funded: 2n,
  PartiallyCompleted: 3n,
  Completed: 4n,
  Refunded: 5n,
});
const Milestone = Object.freeze({ Pickup: 0n, Delivery: 1n });

const PICKUP_CODE = "pickup-secret";
const DELIVERY_CODE = "delivery-secret";
const ESCROW = ethers.parseEther("1");
const PICKUP_BPS = 3_000n;
const PICKUP_PAYOUT = (ESCROW * PICKUP_BPS) / 10_000n;
const DELIVERY_PAYOUT = ESCROW - PICKUP_PAYOUT;

async function futureDeadline(seconds = 3_600) {
  return BigInt(await time.latest()) + BigInt(seconds);
}

async function deployFixture() {
  const [deployer, shipper, carrier, stranger] = await ethers.getSigners();
  const contract = await ethers.deployContract("ProofRouteEscrow");
  await contract.waitForDeployment();
  await contract.connect(shipper).registerUser("Alice Shipper", Role.Shipper);
  await contract.connect(carrier).registerUser("Chris Carrier", Role.Carrier);
  return { contract, deployer, shipper, carrier, stranger };
}

async function createAgreement(contract, shipper, carrierAddress, overrides = {}) {
  const deadline = overrides.deadline ?? (await futureDeadline());
  const escrow = overrides.escrow ?? ESCROW;
  const pickupBps = overrides.pickupBps ?? PICKUP_BPS;

  await contract.connect(shipper).createAgreement(
    carrierAddress,
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
  const values = await createAgreement(fixture.contract, fixture.shipper, fixture.carrier.address);
  await fixture.contract.connect(fixture.carrier).acceptAgreement(1);
  await fixture.contract.connect(fixture.shipper).fundAgreement(1, { value: ESCROW });
  return { ...fixture, ...values };
}

describe("ProofRouteEscrow: Member B carrier and milestone module", function () {
  describe("milestone verification and payouts", function () {
    it("verifies pickup and releases the configured progressive payout", async function () {
      const { contract, carrier } = await loadFixture(fundedAgreementFixture);
      const contractAddress = await contract.getAddress();
      const carrierBalanceBefore = await ethers.provider.getBalance(carrier.address);

      const transaction = await contract
        .connect(carrier)
        .submitMilestoneProof(1, Milestone.Pickup, PICKUP_CODE);
      const receipt = await transaction.wait();
      const verificationBlock = await ethers.provider.getBlock(receipt.blockNumber);

      await expect(transaction)
        .to.emit(contract, "MilestoneVerified")
        .withArgs(1, Milestone.Pickup, carrier.address, verificationBlock.timestamp)
        .and.to.emit(contract, "EscrowReleased")
        .withArgs(1, Milestone.Pickup, carrier.address, PICKUP_PAYOUT);
      const carrierBalanceAfter = await ethers.provider.getBalance(carrier.address);
      const transactionFee = receipt.gasUsed * receipt.gasPrice;
      expect(carrierBalanceAfter + transactionFee - carrierBalanceBefore).to.equal(PICKUP_PAYOUT);

      const agreement = await contract.getAgreement(1);
      const pickup = await contract.getMilestone(1, Milestone.Pickup);
      expect(agreement.status).to.equal(Status.PartiallyCompleted);
      expect(agreement.releasedAmount).to.equal(PICKUP_PAYOUT);
      expect(pickup.completed).to.equal(true);
      expect(pickup.completedAt).to.be.greaterThan(0n);
      expect(await ethers.provider.getBalance(contractAddress)).to.equal(DELIVERY_PAYOUT);
    });

    it("verifies delivery, pays every remaining wei, and completes the agreement", async function () {
      const { contract, carrier } = await loadFixture(fundedAgreementFixture);
      await contract.connect(carrier).submitMilestoneProof(1, Milestone.Pickup, PICKUP_CODE);
      const contractAddress = await contract.getAddress();
      const carrierBalanceBefore = await ethers.provider.getBalance(carrier.address);

      const transaction = await contract
        .connect(carrier)
        .submitMilestoneProof(1, Milestone.Delivery, DELIVERY_CODE);

      await expect(transaction)
        .to.emit(contract, "EscrowReleased")
        .withArgs(1, Milestone.Delivery, carrier.address, DELIVERY_PAYOUT)
        .and.to.emit(contract, "AgreementCompleted");
      const receipt = await transaction.wait();
      const carrierBalanceAfter = await ethers.provider.getBalance(carrier.address);
      const transactionFee = receipt.gasUsed * receipt.gasPrice;
      expect(carrierBalanceAfter + transactionFee - carrierBalanceBefore).to.equal(DELIVERY_PAYOUT);

      const agreement = await contract.getAgreement(1);
      const delivery = await contract.getMilestone(1, Milestone.Delivery);
      expect(agreement.status).to.equal(Status.Completed);
      expect(agreement.releasedAmount).to.equal(ESCROW);
      expect(delivery.completed).to.equal(true);
      expect(await ethers.provider.getBalance(contractAddress)).to.equal(0n);
    });

    it("assigns integer-division remainder to delivery so no dust is stranded", async function () {
      const { contract, shipper, carrier } = await loadFixture(deployFixture);
      await createAgreement(contract, shipper, carrier.address, { escrow: 10n, pickupBps: 3_333n });
      await contract.connect(carrier).acceptAgreement(1);
      await contract.connect(shipper).fundAgreement(1, { value: 10n });

      await expect(contract.connect(carrier).submitMilestoneProof(1, Milestone.Pickup, PICKUP_CODE))
        .to.emit(contract, "EscrowReleased")
        .withArgs(1, Milestone.Pickup, carrier.address, 3n);
      await expect(contract.connect(carrier).submitMilestoneProof(1, Milestone.Delivery, DELIVERY_CODE))
        .to.emit(contract, "EscrowReleased")
        .withArgs(1, Milestone.Delivery, carrier.address, 7n);

      expect((await contract.getAgreement(1)).releasedAmount).to.equal(10n);
      expect(await ethers.provider.getBalance(await contract.getAddress())).to.equal(0n);
    });
  });

  describe("authorization, ordering and expiry", function () {
    it("rejects an unauthorized wallet and an incorrect proof", async function () {
      const { contract, carrier, stranger } = await loadFixture(fundedAgreementFixture);

      await expect(contract.connect(stranger).submitMilestoneProof(1, Milestone.Pickup, PICKUP_CODE))
        .to.be.revertedWithCustomError(contract, "Unauthorized")
        .withArgs(stranger.address);
      await expect(contract.connect(carrier).submitMilestoneProof(1, Milestone.Pickup, "wrong-code"))
        .to.be.revertedWithCustomError(contract, "InvalidMilestoneProof")
        .withArgs(1, Milestone.Pickup);
    });

    it("rejects delivery before pickup and pickup before funding", async function () {
      const { contract, shipper, carrier } = await loadFixture(deployFixture);
      await createAgreement(contract, shipper, carrier.address);
      await contract.connect(carrier).acceptAgreement(1);

      await expect(contract.connect(carrier).submitMilestoneProof(1, Milestone.Pickup, PICKUP_CODE))
        .to.be.revertedWithCustomError(contract, "InvalidMilestoneOrder")
        .withArgs(Milestone.Pickup, Status.Accepted);

      await contract.connect(shipper).fundAgreement(1, { value: ESCROW });
      await expect(contract.connect(carrier).submitMilestoneProof(1, Milestone.Delivery, DELIVERY_CODE))
        .to.be.revertedWithCustomError(contract, "InvalidMilestoneOrder")
        .withArgs(Milestone.Delivery, Status.Funded);
    });

    it("rejects repeated milestones", async function () {
      const { contract, carrier } = await loadFixture(fundedAgreementFixture);
      await contract.connect(carrier).submitMilestoneProof(1, Milestone.Pickup, PICKUP_CODE);

      await expect(contract.connect(carrier).submitMilestoneProof(1, Milestone.Pickup, PICKUP_CODE))
        .to.be.revertedWithCustomError(contract, "MilestoneAlreadyCompleted")
        .withArgs(1, Milestone.Pickup);
    });

    it("rejects proofs after the agreement deadline", async function () {
      const { contract, carrier, deadline } = await loadFixture(fundedAgreementFixture);
      await time.increaseTo(deadline + 1n);

      await expect(contract.connect(carrier).submitMilestoneProof(1, Milestone.Pickup, PICKUP_CODE))
        .to.be.revertedWithCustomError(contract, "DeadlinePassed");
    });

    it("refunds only unreleased escrow when expiry occurs after pickup", async function () {
      const { contract, shipper, carrier, stranger, deadline } = await loadFixture(fundedAgreementFixture);
      await contract.connect(carrier).submitMilestoneProof(1, Milestone.Pickup, PICKUP_CODE);
      await time.increaseTo(deadline + 1n);

      await expect(contract.connect(stranger).processExpiredAgreement(1))
        .to.emit(contract, "AgreementRefunded")
        .withArgs(1, shipper.address, DELIVERY_PAYOUT);

      expect((await contract.getAgreement(1)).status).to.equal(Status.Refunded);
      expect(await ethers.provider.getBalance(await contract.getAddress())).to.equal(0n);
    });
  });

  describe("payout transfer safety", function () {
    async function harnessFixture() {
      const fixture = await deployFixture();
      const harness = await ethers.deployContract("PayoutReceiverHarness", [await fixture.contract.getAddress()]);
      await harness.waitForDeployment();
      await harness.registerAsCarrier();
      await createAgreement(fixture.contract, fixture.shipper, await harness.getAddress());
      await harness.accept(1);
      await fixture.contract.connect(fixture.shipper).fundAgreement(1, { value: ESCROW });
      return { ...fixture, harness };
    }

    it("rolls back milestone state when the carrier rejects its payout", async function () {
      const { contract, harness } = await loadFixture(harnessFixture);
      await harness.configureReceiver(true, false);

      await expect(harness.submit(Milestone.Pickup, PICKUP_CODE))
        .to.be.revertedWithCustomError(contract, "EtherTransferFailed");

      expect((await contract.getAgreement(1)).status).to.equal(Status.Funded);
      expect((await contract.getAgreement(1)).releasedAmount).to.equal(0n);
      expect((await contract.getMilestone(1, Milestone.Pickup)).completed).to.equal(false);
      expect(await ethers.provider.getBalance(await contract.getAddress())).to.equal(ESCROW);
    });

    it("blocks reentrant proof submission while completing the original payout", async function () {
      const { contract, harness } = await loadFixture(harnessFixture);
      await harness.configureReceiver(false, true);

      await harness.submit(Milestone.Pickup, PICKUP_CODE);

      expect(await harness.reentryBlocked()).to.equal(true);
      expect((await contract.getAgreement(1)).status).to.equal(Status.PartiallyCompleted);
      expect((await contract.getAgreement(1)).releasedAmount).to.equal(PICKUP_PAYOUT);
      expect(await ethers.provider.getBalance(await contract.getAddress())).to.equal(DELIVERY_PAYOUT);
    });
  });
});
