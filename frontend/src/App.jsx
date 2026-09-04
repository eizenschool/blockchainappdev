import { useCallback, useEffect, useMemo, useState } from "react";
import { formatEther, getAddress, id, isAddress, parseEther } from "ethers";
import CarrierDashboard from "./components/CarrierDashboard.jsx";
import EventHistory from "./components/EventHistory.jsx";
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

const ROLES = Object.freeze({ NONE: 0, SHIPPER: 1, CARRIER: 2 });
const STATUS_LABELS = [
  "Created",
  "Accepted",
  "Funded",
  "Pickup verified",
  "Completed",
  "Refunded",
  "Cancelled",
];

const emptyAgreementForm = () => ({
  carrier: "",
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

function formatDate(timestamp) {
  return new Intl.DateTimeFormat("en-MY", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(Number(timestamp) * 1000));
}

function App() {
  const [account, setAccount] = useState("");
  const [chainId, setChainId] = useState(null);
  const [contract, setContract] = useState(null);
  const [user, setUser] = useState(null);
  const [agreements, setAgreements] = useState([]);
  const [history, setHistory] = useState([]);
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState(null);
  const [registration, setRegistration] = useState({ displayName: "", role: ROLES.SHIPPER });
  const [agreementForm, setAgreementForm] = useState(emptyAgreementForm);

  const walletInstalled = hasWallet();
  const deploymentReady = hasDeployment();
  const correctNetwork = chainId === LOCAL_CHAIN_ID;
  const role = Number(user?.role ?? 0);

  const loadContractData = useCallback(async (activeContract, activeAccount) => {
    const nextUser = await activeContract.getUser(activeAccount);
    setUser(nextUser);

    if (Number(nextUser.role) === ROLES.NONE) {
      setAgreements([]);
      setHistory([]);
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
    if (getAddress(agreementForm.carrier) === getAddress(account)) {
      return "The shipper and carrier must use different wallets.";
    }
    if (!agreementForm.cargo.trim() || !agreementForm.origin.trim() || !agreementForm.destination.trim()) {
      return "Cargo, origin, and destination are required.";
    }
    if (agreementForm.cargo.trim().length > 120) return "Cargo description must be 120 characters or fewer.";
    if (agreementForm.origin.trim().length > 80 || agreementForm.destination.trim().length > 80) {
      return "Origin and destination must each be 80 characters or fewer.";
    }
    if (!agreementForm.deadline || new Date(agreementForm.deadline).getTime() <= Date.now()) {
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
          agreementForm.cargo.trim(),
          agreementForm.origin.trim(),
          agreementForm.destination.trim(),
          parseEther(agreementForm.escrowEth),
          deadline,
          pickupBps,
          id(agreementForm.pickupCode),
          id(agreementForm.deliveryCode),
        ),
      "Agreement created. Give each one-time code only to the trusted person who verifies that checkpoint.",
    );

    if (succeeded) setAgreementForm(emptyAgreementForm());
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

  const submitMilestoneProof = (agreement, milestone, proofCode) =>
    runTransaction(
      `proof-${agreement.id}-${milestone}`,
      () => contract.submitMilestoneProof(agreement.id, milestone, proofCode),
      `${milestone === 0 ? "Pickup" : "Delivery"} proof verified and payout released for agreement #${agreement.id}.`,
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

  const summary = useMemo(
    () => ({
      total: agreements.length,
      awaiting: agreements.filter(({ agreement }) => Number(agreement.status) < 2).length,
      funded: agreements.filter(({ agreement }) => [2, 3].includes(Number(agreement.status))).length,
    }),
    [agreements],
  );

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="#top" aria-label="ProofRoute home">
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

      <main id="top">
        <section className="hero">
          <div>
            <p className="eyebrow">Ethereum logistics escrow</p>
            <h1>Move cargo with <span>proof, not promises.</span></h1>
            <p className="hero-copy">
              Create delivery agreements, lock test ETH safely, and keep every state change visible on-chain.
            </p>
          </div>
          <div className="hero-flow" aria-label="Agreement flow">
            <span>Create</span><i>→</i><span>Accept</span><i>→</i><span>Fund</span><i>→</i><span>Pickup</span><i>→</i><span>Deliver</span>
          </div>
        </section>

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
                  <option value={ROLES.SHIPPER}>Shipper — creates and funds jobs</option>
                  <option value={ROLES.CARRIER}>Carrier — transports cargo</option>
                </select>
              </label>
              <button className="button button-primary" disabled={busy === "register"}>
                {busy === "register" ? "Registering…" : "Register wallet"}
              </button>
            </form>
          </section>
        )}

        {contract && role === ROLES.CARRIER && (
          <CarrierDashboard
            user={user}
            agreements={agreements}
            busy={busy}
            onRefresh={() => loadContractData(contract, account)}
            onAccept={acceptAgreement}
            onSubmitProof={submitMilestoneProof}
            onRefund={refundAgreement}
          />
        )}

        {contract && role === ROLES.SHIPPER && (
          <div className="dashboard">
            <section className="dashboard-heading">
              <div>
                <p className="eyebrow">Shipper dashboard</p>
                <h2>Welcome back, {user.displayName}</h2>
              </div>
              <button className="button button-secondary" onClick={() => loadContractData(contract, account)}>
                Refresh blockchain data
              </button>
            </section>

            <section className="stats-grid" aria-label="Agreement summary">
              <article><span>Total agreements</span><strong>{summary.total}</strong></article>
              <article><span>Awaiting funding</span><strong>{summary.awaiting}</strong></article>
              <article><span>Escrow active</span><strong>{summary.funded}</strong></article>
            </section>

            <section className="content-grid">
              <article className="panel create-panel">
                <div className="section-title">
                  <div><p className="eyebrow">New shipment</p><h3>Create an agreement</h3></div>
                  <span className="step-pill">Step 1 of 3</span>
                </div>
                <form className="form-grid" onSubmit={handleCreateAgreement}>
                  <label className="field-full">
                    Carrier wallet address
                    <input value={agreementForm.carrier} onChange={(event) => setAgreementForm({ ...agreementForm, carrier: event.target.value })} placeholder="0x…" />
                  </label>
                  <label className="field-full">
                    Cargo description
                    <input maxLength="120" value={agreementForm.cargo} onChange={(event) => setAgreementForm({ ...agreementForm, cargo: event.target.value })} placeholder="e.g. Temperature-controlled medicine" />
                  </label>
                  <label>
                    Origin
                    <input maxLength="80" value={agreementForm.origin} onChange={(event) => setAgreementForm({ ...agreementForm, origin: event.target.value })} placeholder="Kuala Lumpur" />
                  </label>
                  <label>
                    Destination
                    <input maxLength="80" value={agreementForm.destination} onChange={(event) => setAgreementForm({ ...agreementForm, destination: event.target.value })} placeholder="Penang" />
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
                  <label>
                    Pickup proof code
                    <input type="password" autoComplete="off" value={agreementForm.pickupCode} onChange={(event) => setAgreementForm({ ...agreementForm, pickupCode: event.target.value })} placeholder="One-time secret" />
                  </label>
                  <label>
                    Delivery proof code
                    <input type="password" autoComplete="off" value={agreementForm.deliveryCode} onChange={(event) => setAgreementForm({ ...agreementForm, deliveryCode: event.target.value })} placeholder="Different one-time secret" />
                  </label>
                  <p className="security-note field-full">Only each code's hash is saved during creation. Proof codes are cleared from this page after confirmation and cannot be recovered.</p>
                  <button className="button button-primary field-full" disabled={busy === "create"}>
                    {busy === "create" ? "Creating agreement…" : "Create agreement"}
                  </button>
                </form>
              </article>

              <section className="agreement-section">
                <div className="section-title">
                  <div><p className="eyebrow">On-chain records</p><h3>Your agreements</h3></div>
                  <span className="count-pill">{agreements.length}</span>
                </div>
                {agreements.length === 0 ? (
                  <div className="panel empty-state small-empty"><h4>No agreements yet</h4><p>Create your first shipment agreement using the form.</p></div>
                ) : (
                  <div className="agreement-list">
                    {agreements.map(({ agreement, pickup, delivery }) => {
                      const status = Number(agreement.status);
                      const expired = Date.now() / 1000 > Number(agreement.deadline);
                      return (
                        <article className="agreement-card" key={agreement.id.toString()}>
                          <div className="agreement-card-head">
                            <div><span className="agreement-id">Agreement #{agreement.id.toString()}</span><h4>{agreement.cargo}</h4></div>
                            <span className={`status status-${status}`}>{STATUS_LABELS[status]}</span>
                          </div>
                          <div className="route"><span>{agreement.origin}</span><i>→</i><span>{agreement.destination}</span></div>
                          <dl className="agreement-details">
                            <div><dt>Carrier</dt><dd title={agreement.carrier}>{shortAddress(agreement.carrier)}</dd></div>
                            <div><dt>Escrow</dt><dd>{formatEther(agreement.requiredEscrow)} ETH</dd></div>
                            <div><dt>Released</dt><dd>{formatEther(agreement.releasedAmount)} ETH</dd></div>
                            <div><dt>Deadline</dt><dd>{formatDate(agreement.deadline)}</dd></div>
                            <div><dt>Split</dt><dd>{Number(pickup.payoutBps) / 100}% / {Number(delivery.payoutBps) / 100}%</dd></div>
                          </dl>
                          <div className="milestone-progress" aria-label="Milestone progress">
                            <span className={status >= 1 && status <= 5 ? "complete" : ""}>Accepted</span>
                            <i>→</i>
                            <span className={status >= 2 && status <= 5 ? "complete" : ""}>Funded</span>
                            <i>→</i>
                            <span className={pickup.completed ? "complete" : ""}>Pickup</span>
                            <i>→</i>
                            <span className={delivery.completed ? "complete" : ""}>Delivery</span>
                          </div>
                          <div className="card-actions">
                            {status === 0 && <span className="action-hint">Waiting for carrier acceptance</span>}
                            {status === 1 && !expired && (
                              <button className="button button-primary button-small" disabled={busy === `fund-${agreement.id}`} onClick={() => fundAgreement(agreement)}>
                                {busy === `fund-${agreement.id}` ? "Funding…" : "Fund exact escrow"}
                              </button>
                            )}
                            {[0, 1].includes(status) && (
                              <button className="button button-danger button-small" disabled={busy === `cancel-${agreement.id}`} onClick={() => cancelAgreement(agreement)}>
                                Cancel
                              </button>
                            )}
                            {[2, 3].includes(status) && !expired && <span className="action-hint">Escrow locked until proof or expiry</span>}
                            {[2, 3].includes(status) && expired && (
                              <button className="button button-primary button-small" disabled={busy === `refund-${agreement.id}`} onClick={() => refundAgreement(agreement)}>
                                {busy === `refund-${agreement.id}` ? "Refunding…" : "Process expired refund"}
                              </button>
                            )}
                          </div>
                        </article>
                      );
                    })}
                  </div>
                )}
              </section>
            </section>
          </div>
        )}

        {contract && role !== ROLES.NONE && <EventHistory entries={history} />}
      </main>

      <footer>
        <span>ProofRoute · BMIS2003</span>
        <span>Local test network only · No real funds</span>
      </footer>
    </div>
  );
}

export default App;
