import { expect } from "chai";
import { network } from "hardhat";

const { ethers, networkHelpers } = await network.create();
const { loadFixture, time } = networkHelpers;

const Role = Object.freeze({ None: 0n, Shipper: 1n, Carrier: 2n });
const Status = Object.freeze({
  Created: 0n,
  Accepted: 1n,
  Funded: 2n,
  PartiallyCompleted: 3n,
  Completed: 4n,
  Refunded: 5n,
  Cancelled: 6n,
});
const Milestone = Object.freeze({ Pickup: 0n, Delivery: 1n });

const ESCROW = ethers.parseEther("1");
const PICKUP_BPS = 3_000;
const PICKUP_HASH = ethers.id("pickup-secret");
const DELIVERY_HASH = ethers.id("delivery-secret");

async function deployFixture() {
  const [deployer, shipper, carrier, stranger, secondCarrier] = await ethers.getSigners();
  const contract = await ethers.deployContract("ProofRouteEscrow");
  await contract.waitForDeployment();

  return { contract, deployer, shipper, carrier, stranger, secondCarrier };
}

async function registerParties(contract, shipper, carrier) {
  await contract.connect(shipper).registerUser("Alice Shipper", Role.Shipper);
  await contract.connect(carrier).registerUser("Chris Carrier", Role.Carrier);
}

async function futureDeadline(seconds = 3_600) {
  return BigInt(await time.latest()) + BigInt(seconds);
}

async function createAgreement(contract, shipper, carrier, overrides = {}) {
  const deadline = overrides.deadline ?? (await futureDeadline());
  await contract.connect(shipper).createAgreement(
    overrides.carrier ?? carrier.address,
    overrides.cargo ?? "Medical supplies",
    overrides.origin ?? "Kuala Lumpur",
    overrides.destination ?? "Penang",
    overrides.escrow ?? ESCROW,
    deadline,
    overrides.pickupBps ?? PICKUP_BPS,
    overrides.pickupHash ?? PICKUP_HASH,
    overrides.deliveryHash ?? DELIVERY_HASH,
  );
  return deadline;
}

async function acceptedAgreementFixture() {
  const fixture = await deployFixture();
  await registerParties(fixture.contract, fixture.shipper, fixture.carrier);
  const deadline = await createAgreement(fixture.contract, fixture.shipper, fixture.carrier);
  await fixture.contract.connect(fixture.carrier).acceptAgreement(1);
  return { ...fixture, deadline };
}

async function fundedAgreementFixture() {
  const fixture = await acceptedAgreementFixture();
  await fixture.contract.connect(fixture.shipper).fundAgreement(1, { value: ESCROW });
  return fixture;
}

describe("ProofRouteEscrow: Member A shipper and escrow module", function () {
  describe("registration", function () {
    it("registers shipper and carrier wallets and emits an audit event", async function () {
      const { contract, shipper, carrier } = await loadFixture(deployFixture);

      await expect(contract.connect(shipper).registerUser("Alice Shipper", Role.Shipper))
        .to.emit(contract, "UserRegistered");
      await contract.connect(carrier).registerUser("Chris Carrier", Role.Carrier);

      expect((await contract.getUser(shipper.address)).role).to.equal(Role.Shipper);
      expect((await contract.getUser(carrier.address)).role).to.equal(Role.Carrier);
    });

    it("rejects duplicate registration", async function () {
      const { contract, shipper } = await loadFixture(deployFixture);
      await contract.connect(shipper).registerUser("Alice Shipper", Role.Shipper);

      await expect(contract.connect(shipper).registerUser("Alice Again", Role.Shipper))
        .to.be.revertedWithCustomError(contract, "AlreadyRegistered")
        .withArgs(shipper.address);
    });

    it("rejects invalid roles and display names", async function () {
      const { contract, shipper, carrier } = await loadFixture(deployFixture);

      await expect(contract.connect(shipper).registerUser("Alice Shipper", Role.None))
        .to.be.revertedWithCustomError(contract, "InvalidRole");
      await expect(contract.connect(carrier).registerUser("Al", Role.Carrier))
        .to.be.revertedWithCustomError(contract, "InvalidDisplayName");
    });
  });

  describe("agreement creation", function () {
    it("stores agreement, milestone allocation, and both users' indexes", async function () {
      const { contract, shipper, carrier } = await loadFixture(deployFixture);
      await registerParties(contract, shipper, carrier);
      const deadline = await futureDeadline();

      await expect(
        contract.connect(shipper).createAgreement(
          carrier.address,
          "Medical supplies",
          "Kuala Lumpur",
          "Penang",
          ESCROW,
          deadline,
          PICKUP_BPS,
          PICKUP_HASH,
          DELIVERY_HASH,
        ),
      )
        .to.emit(contract, "AgreementCreated")
        .withArgs(1, shipper.address, carrier.address, ESCROW, deadline, PICKUP_BPS);

      const agreement = await contract.getAgreement(1);
      const pickup = await contract.getMilestone(1, Milestone.Pickup);
      const delivery = await contract.getMilestone(1, Milestone.Delivery);

      expect(agreement.shipper).to.equal(shipper.address);
      expect(agreement.carrier).to.equal(carrier.address);
      expect(agreement.status).to.equal(Status.Created);
      expect(agreement.requiredEscrow).to.equal(ESCROW);
      expect(pickup.proofHash).to.equal(PICKUP_HASH);
      expect(pickup.payoutBps).to.equal(3_000n);
      expect(delivery.proofHash).to.equal(DELIVERY_HASH);
      expect(delivery.payoutBps).to.equal(7_000n);
      expect(await contract.getAgreementIds(shipper.address)).to.deep.equal([1n]);
      expect(await contract.getAgreementIds(carrier.address)).to.deep.equal([1n]);
    });

    it("requires a registered shipper and a registered carrier", async function () {
      const { contract, shipper, carrier, stranger } = await loadFixture(deployFixture);
      await contract.connect(carrier).registerUser("Chris Carrier", Role.Carrier);

      await expect(createAgreement(contract, stranger, carrier))
        .to.be.revertedWithCustomError(contract, "NotRegistered")
        .withArgs(stranger.address);

      await contract.connect(shipper).registerUser("Alice Shipper", Role.Shipper);
      await expect(createAgreement(contract, shipper, stranger))
        .to.be.revertedWithCustomError(contract, "InvalidCarrier")
        .withArgs(stranger.address);
    });

    it("rejects self-assignment and invalid financial or deadline values", async function () {
      const { contract, shipper, carrier } = await loadFixture(deployFixture);
      await registerParties(contract, shipper, carrier);

      await expect(createAgreement(contract, shipper, carrier, { carrier: shipper.address }))
        .to.be.revertedWithCustomError(contract, "SelfAssignment");
      await expect(createAgreement(contract, shipper, carrier, { escrow: 0n }))
        .to.be.revertedWithCustomError(contract, "InvalidEscrowAmount");
      await expect(createAgreement(contract, shipper, carrier, { deadline: await time.latest() }))
        .to.be.revertedWithCustomError(contract, "InvalidDeadline");
      await expect(createAgreement(contract, shipper, carrier, { pickupBps: 0 }))
        .to.be.revertedWithCustomError(contract, "InvalidPickupBps");
      await expect(createAgreement(contract, shipper, carrier, { pickupBps: 10_000 }))
        .to.be.revertedWithCustomError(contract, "InvalidPickupBps");
    });

    it("rejects missing, duplicate, and invalid text data", async function () {
      const { contract, shipper, carrier } = await loadFixture(deployFixture);
      await registerParties(contract, shipper, carrier);

      await expect(createAgreement(contract, shipper, carrier, { pickupHash: ethers.ZeroHash }))
        .to.be.revertedWithCustomError(contract, "InvalidProofHash");
      await expect(createAgreement(contract, shipper, carrier, { deliveryHash: PICKUP_HASH }))
        .to.be.revertedWithCustomError(contract, "DuplicateProofHash");
      await expect(createAgreement(contract, shipper, carrier, { cargo: "" }))
        .to.be.revertedWithCustomError(contract, "InvalidTextLength");
      await expect(createAgreement(contract, shipper, carrier, { origin: "x".repeat(81) }))
        .to.be.revertedWithCustomError(contract, "InvalidTextLength");
    });

    it("rejects unknown agreement IDs", async function () {
      const { contract } = await loadFixture(deployFixture);
      await expect(contract.getAgreement(1))
        .to.be.revertedWithCustomError(contract, "AgreementNotFound")
        .withArgs(1);
    });
  });

  describe("acceptance and funding", function () {
    it("allows only the designated carrier to accept", async function () {
      const { contract, shipper, carrier, stranger } = await loadFixture(deployFixture);
      await registerParties(contract, shipper, carrier);
      await createAgreement(contract, shipper, carrier);

      await expect(contract.connect(stranger).acceptAgreement(1))
        .to.be.revertedWithCustomError(contract, "Unauthorized")
        .withArgs(stranger.address);

      await expect(contract.connect(carrier).acceptAgreement(1))
        .to.emit(contract, "AgreementAccepted");
      expect((await contract.getAgreement(1)).status).to.equal(Status.Accepted);
    });

    it("accepts exact escrow once and holds it in the contract", async function () {
      const { contract, shipper } = await loadFixture(acceptedAgreementFixture);

      await expect(contract.connect(shipper).fundAgreement(1, { value: ESCROW }))
        .to.emit(contract, "AgreementFunded");

      expect((await contract.getAgreement(1)).status).to.equal(Status.Funded);
      expect(await ethers.provider.getBalance(await contract.getAddress())).to.equal(ESCROW);
    });

    it("rejects unauthorized, incorrect, early-state, repeated, and late funding", async function () {
      const { contract, shipper, carrier, stranger, deadline } = await loadFixture(acceptedAgreementFixture);

      await expect(contract.connect(stranger).fundAgreement(1, { value: ESCROW }))
        .to.be.revertedWithCustomError(contract, "Unauthorized");
      await expect(contract.connect(shipper).fundAgreement(1, { value: ESCROW - 1n }))
        .to.be.revertedWithCustomError(contract, "IncorrectEscrowAmount")
        .withArgs(ESCROW, ESCROW - 1n);

      await contract.connect(shipper).fundAgreement(1, { value: ESCROW });
      await expect(contract.connect(shipper).fundAgreement(1, { value: ESCROW }))
        .to.be.revertedWithCustomError(contract, "InvalidAgreementStatus");

      const secondDeadline = await futureDeadline();
      await createAgreement(contract, shipper, carrier, { deadline: secondDeadline });
      await contract.connect(carrier).acceptAgreement(2);
      await time.increaseTo(secondDeadline + 1n);
      await expect(contract.connect(shipper).fundAgreement(2, { value: ESCROW }))
        .to.be.revertedWithCustomError(contract, "DeadlinePassed");

      expect(deadline).to.be.lessThan(secondDeadline);
    });

    it("rejects direct Ether transfers", async function () {
      const { contract, shipper } = await loadFixture(deployFixture);

      await expect(shipper.sendTransaction({ to: await contract.getAddress(), value: 1n }))
        .to.be.revertedWithCustomError(contract, "DirectPaymentNotAllowed");
    });
  });

  describe("cancellation and expiry refunds", function () {
    it("lets the shipper cancel only before funding", async function () {
      const { contract, shipper, carrier, stranger } = await loadFixture(deployFixture);
      await registerParties(contract, shipper, carrier);
      await createAgreement(contract, shipper, carrier);

      await expect(contract.connect(stranger).cancelAgreement(1))
        .to.be.revertedWithCustomError(contract, "Unauthorized");
      await expect(contract.connect(shipper).cancelAgreement(1))
        .to.emit(contract, "AgreementCancelled")
        .withArgs(1, shipper.address);
      expect((await contract.getAgreement(1)).status).to.equal(Status.Cancelled);

      await expect(contract.connect(shipper).cancelAgreement(1))
        .to.be.revertedWithCustomError(contract, "InvalidAgreementStatus");
    });

    it("rejects cancellation after escrow is funded", async function () {
      const { contract, shipper } = await loadFixture(fundedAgreementFixture);

      await expect(contract.connect(shipper).cancelAgreement(1))
        .to.be.revertedWithCustomError(contract, "InvalidAgreementStatus")
        .withArgs(Status.Funded);
    });

    it("allows anyone to trigger an exact shipper refund after expiry", async function () {
      const { contract, shipper, stranger, deadline } = await loadFixture(fundedAgreementFixture);
      await time.increaseTo(deadline + 1n);

      const contractAddress = await contract.getAddress();
      const shipperBalanceBefore = await ethers.provider.getBalance(shipper.address);

      await expect(contract.connect(stranger).processExpiredAgreement(1))
        .to.emit(contract, "AgreementRefunded")
        .withArgs(1, shipper.address, ESCROW);

      const shipperBalanceAfter = await ethers.provider.getBalance(shipper.address);
      expect(shipperBalanceAfter - shipperBalanceBefore).to.equal(ESCROW);
      expect(await ethers.provider.getBalance(contractAddress)).to.equal(0n);
      expect((await contract.getAgreement(1)).status).to.equal(Status.Refunded);
    });

    it("rejects early and repeated refunds", async function () {
      const { contract, stranger, deadline } = await loadFixture(fundedAgreementFixture);

      await expect(contract.connect(stranger).processExpiredAgreement(1))
        .to.be.revertedWithCustomError(contract, "DeadlineNotPassed");

      await time.increaseTo(deadline + 1n);
      await contract.connect(stranger).processExpiredAgreement(1);
      await expect(contract.connect(stranger).processExpiredAgreement(1))
        .to.be.revertedWithCustomError(contract, "InvalidAgreementStatus")
        .withArgs(Status.Refunded);
    });

    it("rolls state back atomically when a shipper rejects the refund", async function () {
      const { contract, carrier, stranger } = await loadFixture(deployFixture);
      await contract.connect(carrier).registerUser("Chris Carrier", Role.Carrier);

      const harness = await ethers.deployContract("RefundReceiverHarness", [await contract.getAddress()]);
      await harness.waitForDeployment();
      await harness.registerAsShipper();
      const deadline = await futureDeadline();
      await harness.create(carrier.address, ESCROW, deadline, PICKUP_HASH, DELIVERY_HASH);
      await contract.connect(carrier).acceptAgreement(1);
      await harness.fund({ value: ESCROW });
      await harness.configureReceiver(true, false);
      await time.increaseTo(deadline + 1n);

      await expect(contract.connect(stranger).processExpiredAgreement(1))
        .to.be.revertedWithCustomError(contract, "EtherTransferFailed");
      expect((await contract.getAgreement(1)).status).to.equal(Status.Funded);
      expect(await ethers.provider.getBalance(await contract.getAddress())).to.equal(ESCROW);
    });

    it("blocks a receiver's reentrant refund attempt while completing the original refund", async function () {
      const { contract, carrier, stranger } = await loadFixture(deployFixture);
      await contract.connect(carrier).registerUser("Chris Carrier", Role.Carrier);

      const harness = await ethers.deployContract("RefundReceiverHarness", [await contract.getAddress()]);
      await harness.waitForDeployment();
      await harness.registerAsShipper();
      const deadline = await futureDeadline();
      await harness.create(carrier.address, ESCROW, deadline, PICKUP_HASH, DELIVERY_HASH);
      await contract.connect(carrier).acceptAgreement(1);
      await harness.fund({ value: ESCROW });
      await harness.configureReceiver(false, true);
      await time.increaseTo(deadline + 1n);

      await contract.connect(stranger).processExpiredAgreement(1);

      expect(await harness.reentryBlocked()).to.equal(true);
      expect((await contract.getAgreement(1)).status).to.equal(Status.Refunded);
      expect(await ethers.provider.getBalance(await contract.getAddress())).to.equal(0n);
    });
  });
});
