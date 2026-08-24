import { formatEther } from "ethers";
import { useMemo, useState } from "react";

const STATUS_LABELS = [
  "Created",
  "Accepted",
  "Funded",
  "Pickup verified",
  "Completed",
  "Refunded",
  "Cancelled",
];

function shortAddress(address) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function formatDate(timestamp) {
  return new Intl.DateTimeFormat("en-MY", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(Number(timestamp) * 1000));
}

function proofKey(agreementId, milestone) {
  return `${agreementId.toString()}-${milestone}`;
}

function milestonePayout(agreement, pickup, milestone) {
  if (milestone === 0) {
    return (agreement.requiredEscrow * pickup.payoutBps) / 10_000n;
  }
  return agreement.requiredEscrow - agreement.releasedAmount;
}

export default function CarrierDashboard({
  user,
  agreements,
  busy,
  onRefresh,
  onAccept,
  onSubmitProof,
  onRefund,
}) {
  const [proofCodes, setProofCodes] = useState({});
  const [proofErrors, setProofErrors] = useState({});

  const summary = useMemo(
    () => ({
      total: agreements.length,
      acceptance: agreements.filter(({ agreement }) => Number(agreement.status) === 0).length,
      actionable: agreements.filter(
        ({ agreement }) =>
          [2, 3].includes(Number(agreement.status)) &&
          Date.now() / 1000 <= Number(agreement.deadline),
      ).length,
      completed: agreements.filter(({ agreement }) => Number(agreement.status) === 4).length,
    }),
    [agreements],
  );

  const updateProof = (key, value) => {
    setProofCodes((current) => ({ ...current, [key]: value }));
    setProofErrors((current) => ({ ...current, [key]: "" }));
  };

  const submitProof = async (event, agreement, milestone) => {
    event.preventDefault();
    const key = proofKey(agreement.id, milestone);
    const code = proofCodes[key] ?? "";
    if (!code) {
      setProofErrors((current) => ({ ...current, [key]: "Enter the one-time proof code." }));
      return;
    }

    const succeeded = await onSubmitProof(agreement, milestone, code);
    if (succeeded) {
      setProofCodes((current) => {
        const next = { ...current };
        delete next[key];
        return next;
      });
    }
  };

  return (
    <div className="dashboard carrier-dashboard">
      <section className="dashboard-heading">
        <div>
          <p className="eyebrow">Carrier dashboard</p>
          <h2>Welcome back, {user.displayName}</h2>
        </div>
        <button className="button button-secondary" onClick={onRefresh}>Refresh blockchain data</button>
      </section>

      <section className="stats-grid stats-grid-four" aria-label="Carrier agreement summary">
        <article><span>Assigned</span><strong>{summary.total}</strong></article>
        <article><span>Awaiting acceptance</span><strong>{summary.acceptance}</strong></article>
        <article><span>Proof ready</span><strong>{summary.actionable}</strong></article>
        <article><span>Completed</span><strong>{summary.completed}</strong></article>
      </section>

      <section className="agreement-section">
        <div className="section-title">
          <div><p className="eyebrow">Assigned shipments</p><h3>Carrier workflow</h3></div>
          <span className="count-pill">{agreements.length}</span>
        </div>

        {agreements.length === 0 ? (
          <div className="panel empty-state small-empty">
            <h4>No assigned agreements</h4>
            <p>A Shipper must create an agreement using this Carrier wallet address.</p>
          </div>
        ) : (
          <div className="carrier-agreement-grid">
            {agreements.map(({ agreement, pickup, delivery }) => {
              const status = Number(agreement.status);
              const expired = Date.now() / 1000 > Number(agreement.deadline);
              const activeMilestone = status === 2 ? 0 : 1;
              const key = proofKey(agreement.id, activeMilestone);
              const payout = milestonePayout(agreement, pickup, activeMilestone);

              return (
                <article className="agreement-card carrier-card" key={agreement.id.toString()}>
                  <div className="agreement-card-head">
                    <div><span className="agreement-id">Agreement #{agreement.id.toString()}</span><h4>{agreement.cargo}</h4></div>
                    <span className={`status status-${status}`}>{STATUS_LABELS[status]}</span>
                  </div>
                  <div className="route"><span>{agreement.origin}</span><i>→</i><span>{agreement.destination}</span></div>
                  <dl className="agreement-details carrier-details">
                    <div><dt>Shipper</dt><dd title={agreement.shipper}>{shortAddress(agreement.shipper)}</dd></div>
                    <div><dt>Escrow</dt><dd>{formatEther(agreement.requiredEscrow)} ETH</dd></div>
                    <div><dt>Released</dt><dd>{formatEther(agreement.releasedAmount)} ETH</dd></div>
                    <div><dt>Deadline</dt><dd>{formatDate(agreement.deadline)}</dd></div>
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

                  <div className="card-actions carrier-actions">
                    {status === 0 && !expired && (
                      <>
                        <span className="action-hint">Review the route, escrow, and deadline before accepting.</span>
                        <button className="button button-primary button-small" disabled={busy === `accept-${agreement.id}`} onClick={() => onAccept(agreement)}>
                          {busy === `accept-${agreement.id}` ? "Accepting…" : "Accept agreement"}
                        </button>
                      </>
                    )}
                    {status === 0 && expired && <span className="action-hint">This assignment expired before acceptance.</span>}
                    {status === 1 && !expired && <span className="action-hint">Accepted. Waiting for the Shipper to fund the exact escrow.</span>}
                    {status === 1 && expired && <span className="action-hint">The deadline passed before funding. The Shipper can cancel this agreement.</span>}
                    {[2, 3].includes(status) && expired && (
                      <>
                        <span className="action-hint">The deadline passed. Only unreleased escrow will return to the Shipper.</span>
                        <button className="button button-secondary button-small" disabled={busy === `refund-${agreement.id}`} onClick={() => onRefund(agreement)}>
                          {busy === `refund-${agreement.id}` ? "Refunding…" : "Trigger remaining refund"}
                        </button>
                      </>
                    )}
                    {[2, 3].includes(status) && !expired && (
                      <form className="proof-form" onSubmit={(event) => submitProof(event, agreement, activeMilestone)}>
                        <div className="proof-heading">
                          <div>
                            <strong>{activeMilestone === 0 ? "Verify pickup" : "Verify delivery"}</strong>
                            <span>Payout: {formatEther(payout)} ETH</span>
                          </div>
                          <span className="step-pill">{activeMilestone === 0 ? "Checkpoint 1" : "Checkpoint 2"}</span>
                        </div>
                        <label>
                          One-time proof code
                          <input
                            type="password"
                            autoComplete="off"
                            value={proofCodes[key] ?? ""}
                            onChange={(event) => updateProof(key, event.target.value)}
                            placeholder={activeMilestone === 0 ? "Enter pickup code" : "Enter delivery code"}
                          />
                        </label>
                        <p className="proof-disclosure">Submitting reveals this code in public transaction data. It is never saved by this interface.</p>
                        {proofErrors[key] && <p className="proof-error" role="alert">{proofErrors[key]}</p>}
                        <button className="button button-primary" disabled={busy === `proof-${agreement.id}-${activeMilestone}`}>
                          {busy === `proof-${agreement.id}-${activeMilestone}` ? "Verifying and paying…" : `Verify ${activeMilestone === 0 ? "pickup" : "delivery"} and release payout`}
                        </button>
                      </form>
                    )}
                    {status === 4 && <span className="action-hint">Delivery complete. The full escrow has been released.</span>}
                    {status === 5 && <span className="action-hint">Expired. Unreleased escrow was refunded to the Shipper.</span>}
                    {status === 6 && <span className="action-hint">This agreement was cancelled before funding.</span>}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
