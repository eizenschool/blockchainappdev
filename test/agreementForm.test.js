import { expect } from "chai";
import {
  MALAYSIA_LOCATIONS,
  generateProofCodes,
  generateSixDigitCode,
} from "../frontend/src/lib/agreementForm.js";

describe("ProofRoute agreement form helpers", function () {
  it("provides every Malaysian state and federal territory exactly once", function () {
    const locations = [
      ...MALAYSIA_LOCATIONS.states,
      ...MALAYSIA_LOCATIONS.federalTerritories,
    ];

    expect(MALAYSIA_LOCATIONS.states).to.have.length(13);
    expect(MALAYSIA_LOCATIONS.federalTerritories).to.have.length(3);
    expect(new Set(locations).size).to.equal(16);
  });

  it("generates a six-digit code with secure randomness", function () {
    const cryptoSource = {
      getRandomValues(values) {
        values[0] = 42;
        return values;
      },
    };

    expect(generateSixDigitCode(cryptoSource)).to.equal("100042");
  });

  it("generates distinct pickup and delivery codes", function () {
    const values = [7, 7, 8];
    const cryptoSource = {
      getRandomValues(target) {
        target[0] = values.shift();
        return target;
      },
    };

    expect(generateProofCodes(cryptoSource)).to.deep.equal({
      pickupCode: "100007",
      deliveryCode: "100008",
    });
  });

  it("refuses to use an insecure fallback", function () {
    expect(() => generateSixDigitCode({})).to.throw("Secure random-code generation is unavailable");
  });
});
