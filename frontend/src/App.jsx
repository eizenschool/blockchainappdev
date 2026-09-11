import { useCallback, useEffect, useMemo, useState } from "react";
import { getAddress, id, isAddress, parseEther } from "ethers";
import AppNavigation from "./components/AppNavigation.jsx";
import AgreementDetailsDrawer from "./components/AgreementDetailsDrawer.jsx";
import AgreementTable from "./components/AgreementTable.jsx";
import CarrierDashboard from "./components/CarrierDashboard.jsx";
import { Guide } from "./components/EducationViews.jsx";
import OverviewDashboard from "./components/OverviewDashboard.jsx";
import VerifierDashboard from "./components/VerifierDashboard.jsx";
import { MALAYSIA_LOCATIONS, generateProofCodes } from "./lib/agreementForm.js";
import { loadAgreementHistory } from "./lib/history.js";
import {
  LOCAL_CHAIN_ID,
  createContract,
  explainWalletError,
  hasDeployment,
  hasWallet,
  readWalletState,
  switchToLocalNetwork,
} from "./lib/web3.js";

const ROLES = Object.freeze({ NONE: 0, SHIPPER: 1, CARRIER: 2, VERIFIER: 3 });
const SUPPLY_CATEGORIES = [
  "Vaccines",
  "Temperature-controlled medicines",
  "General medicines",
  "Blood and plasma products",
  "Personal protective equipment",
  "Surgical equipment",
  "Diagnostic test kits",
  "Medical oxygen supplies",
];
const PUBLIC_TABS = [
  { id: "overview", label: "Overview" },
  { id: "guide", label: "Guide" },
];

const ROLE_TABS = {
  [ROLES.SHIPPER]: [
    { id: "overview", label: "Overview" },
    { id: "create", label: "Create" },
    { id: "agreements", label: "Agreements" },
    { id: "guide", label: "Guide" },
  ],
  [ROLES.CARRIER]: [
    { id: "overview", label: "Overview" },
    { id: "deliveries", label: "Deliveries" },
    { id: "agreements", label: "Agreements" },
    { id: "guide", label: "Guide" },
  ],
  [ROLES.VERIFIER]: [
    { id: "overview", label: "Overview" },
    { id: "approvals", label: "Approvals" },
    { id: "agreements", label: "Agreements" },
    { id: "guide", label: "Guide" },
  ],
};

const emptyAgreementForm = () => ({
  carrier: "",
  verifier: "",
  cargo: "",
  origin: "",
  destination: "",
  escrowEth: "1",
  deadline: "",
  pickupPercent: "30",
  pickupCode: "",
  deliveryCode: "",
});

function shortAddress(address) {
  return address ? `${address.slice(0, 6)}…${address.slice(-4)}` : "Not connected";
}

function MalaysiaLocationOptions({ placeholder }) {
  return (
    <>
      <option value="" disabled>{placeholder}</option>
      <optgroup label="States">
        {MALAYSIA_LOCATIONS.states.map((location) => <option key={location} value={location}>{location}</option>)}
      </optgroup>
      <optgroup label="Federal territories">
        {MALAYSIA_LOCATIONS.federalTerritories.map((location) => <option key={location} value={location}>{location}</option>)}
      </optgroup>
    </>
  );
}

function App() {
  const [activeTab, setActiveTab] = useState("overview");
  const [account, setAccount] = useState("");
  const [chainId, setChainId] = useState(null);
  const [contract, setContract] = useState(null);
  const [user, setUser] = useState(null);
  const [agreements, setAgreements] = useState([]);
  const [history, setHistory] = useState([]);
  const [carrierStats, setCarrierStats] = useState({
    verifiedMilestones: 0n,
    completedAgreements: 0n,
    expiredFundedAgreements: 0n,
  });
  const [chainTimestamp, setChainTimestamp] = useState(0);
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState(null);
  const [proofCodeFeedback, setProofCodeFeedback] = useState(null);
  const [registration, setRegistration] = useState({ displayName: "", role: ROLES.SHIPPER });
  const [agreementForm, setAgreementForm] = useState(emptyAgreementForm);
  const [agreementFilter, setAgreementFilter] = useState("current");
  const [visibleAgreementCount, setVisibleAgreementCount] = useState(10);
  const [selectedAgreementId, setSelectedAgreementId] = useState(null);
  const [drawerReturnFocus, setDrawerReturnFocus] = useState(null);
  const closeAgreementDrawer = useCallback(() => setSelectedAgreementId(null), []);

  const walletInstalled = hasWallet();
  const deploymentReady = hasDeployment();
  const correctNetwork = chainId === LOCAL_CHAIN_ID;
  const role = Number(user?.role ?? 0);
  const navigationTabs = ROLE_TABS[role] ?? PUBLIC_TABS;

  useEffect(() => {
    if (!navigationTabs.some(({ id: tabId }) => tabId === activeTab)) {
      setActiveTab("overview");
    }
    setSelectedAgreementId(null);
  }, [account, activeTab, navigationTabs]);

  useEffect(() => {
    setAgreementFilter("current");
    setVisibleAgreementCount(10);
  }, [account]);

  const loadContractData = useCallback(async (activeContract, activeAccount) => {
    const latestBlock = await activeContract.runner.provider.getBlock("latest");
    setChainTimestamp(Number(latestBlock.timestamp));
    const nextUser = await activeContract.getUser(activeAccount);
    setUser(nextUser);

    if (Number(nextUser.role) === ROLES.NONE) {
      setAgreements([]);
      setHistory([]);
      setCarrierStats({ verifiedMilestones: 0n, completedAgreements: 0n, expiredFundedAgreements: 0n });
      return;
    }

    const agreementIds = await activeContract.getAgreementIds(activeAccount);
    const records = await Promise.all(
      [...agreementIds].reverse().map(async (agreementId) => {
        const [agreement, pickup, delivery] = await Promise.all([
          activeContract.getAgreement(agreementId),
          activeContract.getMilestone(agreementId, 0),
          activeContract.getMilestone(agreementId, 1),
        ]);
        return { agreement, pickup, delivery };
      }),
    );
    setAgreements(records);
    setHistory(await loadAgreementHistory(activeContract, agreementIds));
    if (Number(nextUser.role) === ROLES.CARRIER) {
      setCarrierStats(await activeContract.getCarrierStats(activeAccount));
    } else {
      setCarrierStats({ verifiedMilestones: 0n, completedAgreements: 0n, expiredFundedAgreements: 0n });
    }
  }, []);

  const syncWallet = useCallback(
    async ({ requestAccounts = false } = {}) => {
      try {
        const wallet = await readWalletState({ requestAccounts });
        setAccount(wallet.account);
        setChainId(wallet.chainId);

        if (!wallet.account || wallet.chainId !== LOCAL_CHAIN_ID || !deploymentReady) {
          setContract(null);
          setUser(null);
          setAgreements([]);
          setHistory([]);
          setChainTimestamp(0);
          setCarrierStats({ verifiedMilestones: 0n, completedAgreements: 0n, expiredFundedAgreements: 0n });
          return;
        }

        const nextContract = await createContract(wallet.provider, wallet.account);
        setContract(nextContract);
        await loadContractData(nextContract, wallet.account);
      } catch (error) {
        setNotice({ type: "error", text: explainWalletError(error) });
      }
    },
    [deploymentReady, loadContractData],
  );

  useEffect(() => {
    if (!walletInstalled) return undefined;

    syncWallet();
    const handleChange = () => syncWallet();
    window.ethereum.on("accountsChanged", handleChange);
    window.ethereum.on("chainChanged", handleChange);

    return () => {
      window.ethereum.removeListener("accountsChanged", handleChange);
      window.ethereum.removeListener("chainChanged", handleChange);
    };
  }, [syncWallet, walletInstalled]);

  const runTransaction = async (label, action, successMessage) => {
    setBusy(label);
    setNotice(null);
    try {
      const transaction = await action();
      setNotice({ type: "pending", text: "Transaction submitted. Waiting for confirmation…" });
      await transaction.wait();
      await loadContractData(contract, account);
      setNotice({ type: "success", text: successMessage });
      return true;
    } catch (error) {
      setNotice({ type: "error", text: explainWalletError(error) });
      return false;
    } finally {
      setBusy("");
    }
  };

  const handleRegister = async (event) => {
    event.preventDefault();
    const displayName = registration.displayName.trim();
    if (displayName.length < 3 || displayName.length > 32) {
      setNotice({ type: "error", text: "Display name must contain 3 to 32 characters." });
      return;
    }

    await runTransaction(
      "register",
      () => contract.registerUser(displayName, registration.role),
      "Wallet registered successfully.",
    );
  };

  const validateAgreementForm = () => {
    if (!isAddress(agreementForm.carrier)) return "Enter a valid Ethereum carrier address.";
    if (!isAddress(agreementForm.verifier)) return "Enter a valid Ethereum verifier address.";
    if (getAddress(agreementForm.carrier) === getAddress(account)) {
      return "The shipper and carrier must use different wallets.";
    }
    if (getAddress(agreementForm.verifier) === getAddress(account)) {
      return "The shipper and Verifier must use different wallets.";
    }
    if (getAddress(agreementForm.verifier) === getAddress(agreementForm.carrier)) {
      return "The Carrier and Verifier must use different wallets.";
    }
    if (!agreementForm.cargo.trim() || !agreementForm.origin.trim() || !agreementForm.destination.trim()) {
      return "Medical supplies, origin, and hospital destination are required.";
    }
    if (agreementForm.cargo.trim().length > 120) return "Medical-supply description must be 120 characters or fewer.";
    if (agreementForm.origin.trim().length > 80 || agreementForm.destination.trim().length > 80) {
      return "Origin and destination must each be 80 characters or fewer.";
    }
    if (agreementForm.origin === agreementForm.destination) {
      return "Origin and destination must be different.";
    }
    if (
      !agreementForm.deadline
      || Math.floor(new Date(agreementForm.deadline).getTime() / 1000) <= chainTimestamp
    ) {
      return "Choose a deadline in the future.";
    }
    const pickupPercent = Number(agreementForm.pickupPercent);
    if (!Number.isFinite(pickupPercent) || pickupPercent <= 0 || pickupPercent >= 100) {
      return "Pickup payout must be greater than 0% and less than 100%.";
    }
    if (!agreementForm.pickupCode || !agreementForm.deliveryCode) return "Both proof codes are required.";
    if (agreementForm.pickupCode === agreementForm.deliveryCode) return "Pickup and delivery codes must be different.";
    try {
      if (parseEther(agreementForm.escrowEth) <= 0n) return "Escrow must be greater than zero.";
    } catch {
      return "Enter a valid escrow amount in ETH.";
    }
    return "";
  };

  const handleCreateAgreement = async (event) => {
    event.preventDefault();
    const validationError = validateAgreementForm();
    if (validationError) {
      setNotice({ type: "error", text: validationError });
      return;
    }

    const deadline = Math.floor(new Date(agreementForm.deadline).getTime() / 1000);
    const pickupBps = Math.round(Number(agreementForm.pickupPercent) * 100);
    const succeeded = await runTransaction(
      "create",
      () =>
        contract.createAgreement(
          getAddress(agreementForm.carrier),
          getAddress(agreementForm.verifier),
          agreementForm.cargo.trim(),
          agreementForm.origin.trim(),
          agreementForm.destination.trim(),
          parseEther(agreementForm.escrowEth),
          deadline,
          pickupBps,
          id(agreementForm.pickupCode),
          id(agreementForm.deliveryCode),
        ),
      "Agreement created. Give both one-time codes only to the nominated Verifier.",
    );

    if (succeeded) {
      setAgreementForm(emptyAgreementForm());
      setProofCodeFeedback(null);
    }
  };

  const handleGenerateProofCodes = () => {
    try {
      const codes = generateProofCodes();
      setAgreementForm((current) => ({ ...current, ...codes }));
      setProofCodeFeedback({ type: "success", text: "Two new proof codes were generated locally. Record both before creating the agreement." });
    } catch (error) {
      setProofCodeFeedback({ type: "error", text: error.message });
    }
  };

  const copyProofCode = async (label, code) => {
    if (!code) {
      setProofCodeFeedback({ type: "error", text: "Generate the proof codes before copying them." });
      return;
    }
    if (!navigator.clipboard?.writeText) {
      setProofCodeFeedback({ type: "error", text: "Clipboard access is unavailable. Use a browser that supports secure clipboard copying." });
      return;
    }

    try {
      await navigator.clipboard.writeText(code);
      setProofCodeFeedback({ type: "success", text: `${label} proof code copied. Paste it somewhere safe before continuing.` });
    } catch {
      setProofCodeFeedback({ type: "error", text: "The browser blocked clipboard access. Allow clipboard access and try again." });
    }
  };

  const fundAgreement = (agreement) =>
    runTransaction(
      `fund-${agreement.id}`,
      () => contract.fundAgreement(agreement.id, { value: agreement.requiredEscrow }),
      `Agreement #${agreement.id} funded with test ETH.`,
    );

  const acceptAgreement = (agreement) =>
    runTransaction(
      `accept-${agreement.id}`,
      () => contract.acceptAgreement(agreement.id),
      `Agreement #${agreement.id} accepted. The Shipper can now fund the escrow.`,
    );

  const submitMilestoneEvidence = (agreement, milestone, evidenceCid) =>
    runTransaction(
      `evidence-${agreement.id}-${milestone}`,
      () => contract.submitMilestoneEvidence(agreement.id, milestone, evidenceCid),
      `${milestone === 0 ? "Pickup" : "Delivery"} evidence saved for agreement #${agreement.id}.`,
    );

  const approveMilestone = (agreement, milestone, proofCode) =>
    runTransaction(
      `approve-${agreement.id}-${milestone}`,
      () => contract.approveMilestone(agreement.id, milestone, proofCode),
      `${milestone === 0 ? "Pickup" : "Delivery"} approved and payout released for agreement #${agreement.id}.`,
    );

  const cancelAgreement = (agreement) =>
    runTransaction(
      `cancel-${agreement.id}`,
      () => contract.cancelAgreement(agreement.id),
      `Agreement #${agreement.id} cancelled.`,
    );

  const refundAgreement = (agreement) =>
    runTransaction(
      `refund-${agreement.id}`,
      () => contract.processExpiredAgreement(agreement.id),
      `Unreleased escrow for agreement #${agreement.id} was refunded.`,
    );

  const selectedAgreement = useMemo(
    () => agreements.find(({ agreement }) => agreement.id.toString() === selectedAgreementId) ?? null,
    [agreements, selectedAgreementId],
  );

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="#top" aria-label="ProofRoute home" onClick={() => setActiveTab("overview")}>
          <span className="brand-mark" aria-hidden="true">PR</span>
          <span>ProofRoute</span>
        </a>
        <div className="wallet-area">
          {account && <span className={`network-dot ${correctNetwork ? "online" : "offline"}`} aria-hidden="true" />}
          <span className="wallet-address">{shortAddress(account)}</span>
          {!account && walletInstalled && (
            <button className="button button-primary button-small" onClick={() => syncWallet({ requestAccounts: true })}>
              Connect MetaMask
            </button>
          )}
        </div>
      </header>

      <AppNavigation activeTab={activeTab} onChange={setActiveTab} tabs={navigationTabs} />

      <main id="top">
        {notice && activeTab !== "overview" && <div className={`notice notice-${notice.type} global-notice`} role="status">{notice.text}</div>}
        <section
          id="panel-overview"
          className="tab-panel"
          role="tabpanel"
          aria-labelledby="tab-overview"
          hidden={activeTab !== "overview"}
        >
          <header className="page-intro dashboard-intro">
            <div>
            <p className="eyebrow">Hospital supply escrow</p>
              <h1>Verified delivery. Controlled payment.</h1>
              <p>Coordinate medical-supply deliveries, protect test ETH in escrow, and record every handoff on-chain.</p>
            </div>
          </header>

        {!walletInstalled && (
          <section className="panel empty-state">
            <h2>MetaMask is required</h2>
            <p>Install the MetaMask browser extension, then reload this page to connect a development wallet.</p>
          </section>
        )}

        {walletInstalled && !deploymentReady && (
          <section className="panel empty-state">
            <h2>Deploy the local contract first</h2>
            <p>Run <code>npm run node</code>, then <code>npm run deploy:local</code>, and restart this frontend.</p>
          </section>
        )}

        {account && !correctNetwork && (
          <section className="network-warning" role="alert">
            <div><strong>Wrong network</strong><span>ProofRoute uses the local Hardhat chain (31337).</span></div>
            <button className="button button-light" onClick={async () => { await switchToLocalNetwork(); await syncWallet(); }}>
              Switch network
            </button>
          </section>
        )}

        {notice && <div className={`notice notice-${notice.type}`} role="status">{notice.text}</div>}

        {contract && user && role === ROLES.NONE && (
          <section className="panel registration-panel">
            <div>
              <p className="eyebrow">First-time setup</p>
              <h2>Register this wallet</h2>
              <p>Your wallet address is your identity. Choose carefully: the role cannot be changed later.</p>
            </div>
            <form onSubmit={handleRegister} className="form-grid compact-form">
              <label>
                Display name
                <input
                  value={registration.displayName}
                  maxLength="32"
                  onChange={(event) => setRegistration({ ...registration, displayName: event.target.value })}
                  placeholder="e.g. Aisha Logistics"
                />
              </label>
              <label>
                Role
                <select
                  value={registration.role}
                  onChange={(event) => setRegistration({ ...registration, role: Number(event.target.value) })}
                >
                  <option value={ROLES.SHIPPER}>Shipper — coordinates and funds hospital deliveries</option>
                  <option value={ROLES.CARRIER}>Carrier — transports medical supplies</option>
                  <option value={ROLES.VERIFIER}>Verifier — reviews hospital delivery evidence</option>
                </select>
              </label>
              <button className="button button-primary" disabled={busy === "register"}>
                {busy === "register" ? "Registering…" : "Register wallet"}
              </button>
            </form>
          </section>
        )}

        {contract && user && role !== ROLES.NONE && (
          <OverviewDashboard
            user={user}
            role={role}
            agreements={agreements}
            carrierStats={carrierStats}
            chainTimestamp={chainTimestamp}
            onRefresh={() => loadContractData(contract, account)}
            onNavigate={setActiveTab}
          />
        )}
        </section>

        {contract && role === ROLES.CARRIER && (
          <section id="panel-deliveries" className="tab-panel" role="tabpanel" aria-labelledby="tab-deliveries" hidden={activeTab !== "deliveries"}>
          <CarrierDashboard
            agreements={agreements}
            chainTimestamp={chainTimestamp}
            busy={busy}
            onRefresh={() => loadContractData(contract, account)}
            onAccept={acceptAgreement}
            onSubmitEvidence={submitMilestoneEvidence}
            onRefund={refundAgreement}
          />
          </section>
        )}

        {contract && role === ROLES.VERIFIER && (
          <section id="panel-approvals" className="tab-panel" role="tabpanel" aria-labelledby="tab-approvals" hidden={activeTab !== "approvals"}>
          <VerifierDashboard
            agreements={agreements}
            chainTimestamp={chainTimestamp}
            busy={busy}
            onRefresh={() => loadContractData(contract, account)}
            onApprove={approveMilestone}
            onRefund={refundAgreement}
          />
          </section>
        )}

        {contract && role === ROLES.SHIPPER && (
          <section id="panel-create" className="tab-panel" role="tabpanel" aria-labelledby="tab-create" hidden={activeTab !== "create"}>
          <div className="dashboard create-page">
            <header className="action-page-heading">
              <p className="eyebrow">Shipper workspace</p>
              <h1>Create agreement</h1>
              <p>Define the route, participants, escrow, deadline, payout split, and demonstration proof codes.</p>
            </header>
            <section className="create-tab-layout">
              <article className="panel create-panel">
                <div className="section-title">
                  <div><p className="eyebrow">New medical delivery</p><h3>Create a supply agreement</h3></div>
                  <span className="step-pill">Step 1 of 3</span>
                </div>
                <form className="form-grid" onSubmit={handleCreateAgreement}>
                  <label className="field-full">
                    Carrier wallet address
                    <input value={agreementForm.carrier} onChange={(event) => setAgreementForm({ ...agreementForm, carrier: event.target.value })} placeholder="0x…" />
                  </label>
                  <label className="field-full">
                    Verifier wallet address
                    <input value={agreementForm.verifier} onChange={(event) => setAgreementForm({ ...agreementForm, verifier: event.target.value })} placeholder="0x…" />
                  </label>
                  <label className="field-full">
                    Medical supplies
                    <select
                      required
                      value={agreementForm.cargo}
                      onChange={(event) => setAgreementForm({ ...agreementForm, cargo: event.target.value })}
                    >
                      <option value="" disabled>Select a medical-supply category</option>
                      {SUPPLY_CATEGORIES.map((category) => <option key={category} value={category}>{category}</option>)}
                    </select>
                  </label>
                  <label>
                    Origin
                    <select required value={agreementForm.origin} onChange={(event) => setAgreementForm({ ...agreementForm, origin: event.target.value })}>
                      <MalaysiaLocationOptions placeholder="Select an origin" />
                    </select>
                  </label>
                  <label>
                    Destination
                    <select required value={agreementForm.destination} onChange={(event) => setAgreementForm({ ...agreementForm, destination: event.target.value })}>
                      <MalaysiaLocationOptions placeholder="Select a destination" />
                    </select>
                  </label>
                  <label>
                    Escrow (test ETH)
                    <input type="number" min="0" step="0.001" value={agreementForm.escrowEth} onChange={(event) => setAgreementForm({ ...agreementForm, escrowEth: event.target.value })} />
                  </label>
                  <label>
                    Deadline
                    <input type="datetime-local" value={agreementForm.deadline} onChange={(event) => setAgreementForm({ ...agreementForm, deadline: event.target.value })} />
                  </label>
                  <label>
                    Pickup payout (%)
                    <input type="number" min="0.01" max="99.99" step="0.01" value={agreementForm.pickupPercent} onChange={(event) => setAgreementForm({ ...agreementForm, pickupPercent: event.target.value })} />
                  </label>
                  <div className="payout-preview">
                    <span>Delivery payout</span>
                    <strong>{100 - (Number(agreementForm.pickupPercent) || 0)}%</strong>
                  </div>
                  <div className="proof-code-toolbar field-full">
                    <div><strong>Milestone proof codes</strong><span>Generate two distinct demonstration OTPs.</span></div>
                    <button className="button button-secondary button-small" type="button" onClick={handleGenerateProofCodes}>
                      {agreementForm.pickupCode ? "Regenerate proof codes" : "Generate proof codes"}
                    </button>
                  </div>
                  <label>
                    Pickup proof code
                    <div className="input-action">
                      <input type="password" inputMode="numeric" autoComplete="off" readOnly value={agreementForm.pickupCode} placeholder="Generate first" aria-describedby="proof-code-guidance" />
                      <button type="button" disabled={!agreementForm.pickupCode} onClick={() => copyProofCode("Pickup", agreementForm.pickupCode)}>Copy</button>
                    </div>
                  </label>
                  <label>
                    Delivery proof code
                    <div className="input-action">
                      <input type="password" inputMode="numeric" autoComplete="off" readOnly value={agreementForm.deliveryCode} placeholder="Generate first" aria-describedby="proof-code-guidance" />
                      <button type="button" disabled={!agreementForm.deliveryCode} onClick={() => copyProofCode("Delivery", agreementForm.deliveryCode)}>Copy</button>
                    </div>
                  </label>
                  {proofCodeFeedback && <p className={`proof-code-feedback ${proofCodeFeedback.type}`} role="status" aria-live="polite">{proofCodeFeedback.text}</p>}
                  <p id="proof-code-guidance" className="security-note field-full">Record both six-digit codes before creating the agreement and give them only to the nominated Verifier. The app saves only their hashes during creation and clears the plaintext codes after confirmation.</p>
                  <button className="button button-primary field-full" disabled={busy === "create"}>
                    {busy === "create" ? "Creating agreement…" : "Create agreement"}
                  </button>
                </form>
              </article>

            </section>
          </div>
          </section>
        )}

        <section
          id="panel-agreements"
          className="tab-panel"
          role="tabpanel"
          aria-labelledby="tab-agreements"
          hidden={activeTab !== "agreements"}
        >
          {contract && role !== ROLES.NONE && (
            <AgreementTable
              agreements={agreements}
              filter={agreementFilter}
              visibleCount={visibleAgreementCount}
              onFilterChange={(nextFilter) => { setAgreementFilter(nextFilter); setVisibleAgreementCount(10); }}
              onLoadMore={() => setVisibleAgreementCount((current) => current + 10)}
              onView={(record, trigger) => { setSelectedAgreementId(record.agreement.id.toString()); setDrawerReturnFocus(trigger); }}
            />
          )}
        </section>

        <section
          id="panel-guide"
          className="tab-panel"
          role="tabpanel"
          aria-labelledby="tab-guide"
          hidden={activeTab !== "guide"}
        >
          <Guide />
        </section>
      </main>

      <AgreementDetailsDrawer
        record={selectedAgreement}
        history={history}
        role={role}
        chainTimestamp={chainTimestamp}
        busy={busy}
        notice={notice}
        returnFocus={drawerReturnFocus}
        onClose={closeAgreementDrawer}
        onFund={fundAgreement}
        onCancel={cancelAgreement}
        onRefund={refundAgreement}
      />

      <footer>
        <span>ProofRoute · BMIS2003</span>
        <span>Local test network only · No real funds</span>
      </footer>
    </div>
  );
}

export default App;
