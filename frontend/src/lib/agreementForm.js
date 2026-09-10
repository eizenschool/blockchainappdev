export const MALAYSIA_LOCATIONS = Object.freeze({
  states: Object.freeze([
    "Johor",
    "Kedah",
    "Kelantan",
    "Melaka",
    "Negeri Sembilan",
    "Pahang",
    "Penang",
    "Perak",
    "Perlis",
    "Sabah",
    "Sarawak",
    "Selangor",
    "Terengganu",
  ]),
  federalTerritories: Object.freeze([
    "Kuala Lumpur",
    "Labuan",
    "Putrajaya",
  ]),
});

const SIX_DIGIT_RANGE = 900_000;
const UINT32_RANGE = 0x1_0000_0000;
const UNBIASED_LIMIT = Math.floor(UINT32_RANGE / SIX_DIGIT_RANGE) * SIX_DIGIT_RANGE;

export function generateSixDigitCode(cryptoSource = globalThis.crypto) {
  if (!cryptoSource?.getRandomValues) {
    throw new Error("Secure random-code generation is unavailable in this browser.");
  }

  const randomValues = new Uint32Array(1);
  do {
    cryptoSource.getRandomValues(randomValues);
  } while (randomValues[0] >= UNBIASED_LIMIT);

  return String(100_000 + (randomValues[0] % SIX_DIGIT_RANGE));
}

export function generateProofCodes(cryptoSource = globalThis.crypto) {
  const pickupCode = generateSixDigitCode(cryptoSource);
  let deliveryCode = generateSixDigitCode(cryptoSource);

  while (deliveryCode === pickupCode) {
    deliveryCode = generateSixDigitCode(cryptoSource);
  }

  return { pickupCode, deliveryCode };
}
