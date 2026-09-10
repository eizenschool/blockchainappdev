import { formatEther } from "ethers";
import { useMemo, useState } from "react";

const STATUS_LABELS = ["Created", "Accepted", "Funded", "Pickup verified", "Completed", "Refunded", "Cancelled"];

function shortAddress(address) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function formatDate(timestamp) {
  return new Intl.DateTimeFormat("en-MY", { dateStyle: "medium", timeStyle: "short" })
    .format(new Date(Number(timestamp) * 1000));
}

function approvalKey(agreementId, milestone) {
  return `${agreementId.toString()}-${milestone}`;
}

function gatewayUrl(cid) {
  return `https://ipfs.io/ipfs/${encodeURIComponent(cid)}`;
}

export default function VerifierDashboard({ user, agreements, chainTimestamp, busy, onRefresh, onApprove, onRefund }) {
  const [proofCodes, setProofCodes] = useState({});
  const [proofErrors, setProofErrors] = useState({});

  const summary = useMemo(
    () => ({
      assigned: agreements.length,
      pending: agreements.filter(({ agreement, pickup, delivery }) => {
        const status = Number(agreement.status);
        return (status === 2 && pickup.evidenceCid) || (status === 3 && delivery.evidenceCid);
      }).length,
      completed: agreements.filter(({ agreement }) => Number(agreement.status) === 4).length,
    }),
    [agreements],
  );

  const approve = async (event, agreement, milestone) => {
    event.preventDefault();
    const key = approvalKey(agreement.id, milestone);
    const proofCode = proofCodes[key] ?? "";
    if (!proofCode) {
      setProofErrors((current) => ({ ...current, [key]: "Enter the one-time code supplied by the Shipper." }));
      return;
    }

    const succeeded = await onApprove(agreement, milestone, proofCode);
    if (succeeded) {
      setProofCodes((current) => ({ ...current, [key]: "" }));
      setProofErrors((current) => ({ ...current, [key]: "" }));
    }
  };

  return (
    <div className="dashboard verifier-dashboard">
      <section className="dashboard-heading">
        <div><p className="eyebrow">Verifier · Receiving inspector</p><h2>Welcome back, {user.displayName}</h2></div>
        <button className="button button-secondary" onClick={onRefresh}>Refresh blockchain data</button>
      </section>

      <section className="stats-grid" aria-label="Verifier agreement summary">
        <article><span>Assigned</span><strong>{summary.assigned}</strong></article>
        <article><span>Evidence waiting</span><strong>{summary.pending}</strong></article>
        <article><span>Completed</span><strong>{summary.completed}</strong></article>
      </section>

      <section className="agreement-section">
        <div className="section-title">
          <div><p className="eyebrow">Hospital delivery checks</p><h3>Evidence approval queue</h3></div>
          <span className="count-pill">{agreements.length}</span>
        </div>

        {agreements.length === 0 ? (
          <div className="panel empty-state small-empty"><h4>No assigned deliveries</h4><p>A hospital supply coordinator must nominate this Verifier wallet when creating an agreement.</p></div>
        ) : (
          <div className="carrier-agreement-grid">
            {agreements.map(({ agreement, pickup, delivery }) => {
              const status = Number(agreement.status);
              const expired = chainTimestamp > Number(agreement.deadline);
              const activeMilestone = status === 2 ? 0 : 1;
              const activeRecord = activeMilestone === 0 ? pickup : delivery;
              const key = approvalKey(agreement.id, activeMilestone);
              const canReview = [2, 3].includes(status) && !expired;

              return (
                <article className="agreement-card carrier-card" key={agreement.id.toString()}>
                  <div className="agreement-card-head">
                    <div><span className="agreement-id">Agreement #{agreement.id.toString()}</span><h4>{agreement.cargo}</h4></div>
                    <span className={`status status-${status}`}>{STATUS_LABELS[status]}</span>
                  </div>
                  <div className="route"><span>{agreement.origin}</span><i>→</i><span>{agreement.destination}</span></div>
                  <dl className="agreement-details carrier-details">
                    <div><dt>Shipper</dt><dd title={agreement.shipper}>{shortAddress(agreement.shipper)}</dd></div>
                    <div><dt>Carrier</dt><dd title={agreement.carrier}>{shortAddress(agreement.carrier)}</dd></div>
                    <div><dt>Escrow</dt><dd>{formatEther(agreement.requiredEscrow)} ETH</dd></div>
                    <div><dt>Deadline</dt><dd>{formatDate(agreement.deadline)}</dd></div>
                  </dl>

                  <div className="card-actions carrier-actions">
                    {[0, 1].includes(status) && <span className="action-hint">Waiting for Carrier acceptance and Shipper funding.</span>}
                    {canReview && !activeRecord.evidenceCid && <span className="action-hint">Waiting for the Carrier to submit {activeMilestone === 0 ? "pickup" : "delivery"} evidence.</span>}
                    {canReview && activeRecord.evidenceCid && (
                      <form className="proof-form" onSubmit={(event) => approve(event, agreement, activeMilestone)}>
                        <div className="proof-heading">
                          <div><strong>Review {activeMilestone === 0 ? "pickup" : "delivery"}</strong><span>Approval immediately releases this milestone payout</span></div>
                          <span className="step-pill">Verifier only</span>
                        </div>
                        <a className="ipfs-link" href={gatewayUrl(activeRecord.evidenceCid)} target="_blank" rel="noreferrer">Open submitted IPFS evidence ↗</a>
                        <p className="cid-value" title={activeRecord.evidenceCid}>{activeRecord.evidenceCid}</p>
                        <label>One-time proof code<input type="password" autoComplete="off" value={proofCodes[key] ?? ""} onChange={(event) => { setProofCodes((current) => ({ ...current, [key]: event.target.value })); setProofErrors((current) => ({ ...current, [key]: "" })); }} placeholder="Code received from Shipper" /></label>
                        <p className="proof-disclosure">Confirm the evidence matches the milestone before approving. The submitted code becomes public transaction data and is not saved by this interface.</p>
                        {proofErrors[key] && <p className="proof-error" role="alert">{proofErrors[key]}</p>}
                        <button className="button button-primary" disabled={busy === `approve-${agreement.id}-${activeMilestone}`}>{busy === `approve-${agreement.id}-${activeMilestone}` ? "Approving and paying…" : `Approve ${activeMilestone === 0 ? "pickup" : "delivery"} and release payout`}</button>
                      </form>
                    )}
                    {[2, 3].includes(status) && expired && (
                      <><span className="action-hint">Approval is blocked after expiry. Any wallet may trigger the remaining refund.</span><button className="button button-secondary button-small" disabled={busy === `refund-${agreement.id}`} onClick={() => onRefund(agreement)}>{busy === `refund-${agreement.id}` ? "Refunding…" : "Trigger remaining refund"}</button></>
                    )}
                    {status === 4 && <span className="action-hint">Both milestones were approved and the escrow is fully released.</span>}
                    {status === 5 && <span className="action-hint">The agreement expired and unreleased escrow was refunded.</span>}
                    {status === 6 && <span className="action-hint">The Shipper cancelled this agreement before funding.</span>}
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
