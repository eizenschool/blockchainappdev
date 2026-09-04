import { formatEther } from "ethers";
import { useMemo, useState } from "react";

const STATUS_LABELS = ["Created", "Accepted", "Funded", "Pickup verified", "Completed", "Refunded", "Cancelled"];
const CID_PATTERN = /^(Qm[1-9A-HJ-NP-Za-km-z]{44}|b[a-z2-7]{20,})$/;

function shortAddress(address) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function formatDate(timestamp) {
  return new Intl.DateTimeFormat("en-MY", { dateStyle: "medium", timeStyle: "short" })
    .format(new Date(Number(timestamp) * 1000));
}

function evidenceKey(agreementId, milestone) {
  return `${agreementId.toString()}-${milestone}`;
}

function normalizeCid(value) {
  return value.trim().replace(/^ipfs:\/\//i, "");
}

function validateCid(value) {
  const cid = normalizeCid(value);
  if (!cid) return "Paste the IPFS CID for the milestone photo.";
  if (cid.length > 128) return "The CID must be 128 characters or fewer.";
  if (!CID_PATTERN.test(cid)) return "Enter a CIDv0 (Qm…) or CIDv1 base32 (b…) value.";
  return "";
}

function gatewayUrl(cid) {
  return `https://ipfs.io/ipfs/${encodeURIComponent(cid)}`;
}

export default function CarrierDashboard({
  user,
  agreements,
  stats,
  busy,
  onRefresh,
  onAccept,
  onSubmitEvidence,
  onRefund,
}) {
  const [evidenceCids, setEvidenceCids] = useState({});
  const [evidenceErrors, setEvidenceErrors] = useState({});

  const summary = useMemo(
    () => ({
      total: agreements.length,
      acceptance: agreements.filter(({ agreement }) => Number(agreement.status) === 0).length,
      completed: agreements.filter(({ agreement }) => Number(agreement.status) === 4).length,
    }),
    [agreements],
  );

  const submitEvidence = async (event, agreement, milestone) => {
    event.preventDefault();
    const key = evidenceKey(agreement.id, milestone);
    const value = evidenceCids[key] ?? "";
    const error = validateCid(value);
    if (error) {
      setEvidenceErrors((current) => ({ ...current, [key]: error }));
      return;
    }

    const succeeded = await onSubmitEvidence(agreement, milestone, normalizeCid(value));
    if (succeeded) {
      setEvidenceCids((current) => ({ ...current, [key]: "" }));
      setEvidenceErrors((current) => ({ ...current, [key]: "" }));
    }
  };

  return (
    <div className="dashboard carrier-dashboard">
      <section className="dashboard-heading">
        <div><p className="eyebrow">Carrier dashboard</p><h2>Welcome back, {user.displayName}</h2></div>
        <button className="button button-secondary" onClick={onRefresh}>Refresh blockchain data</button>
      </section>

      <section className="stats-grid stats-grid-four" aria-label="Carrier factual reputation">
        <article><span>Assigned</span><strong>{summary.total}</strong></article>
        <article><span>Milestones verified</span><strong>{stats.verifiedMilestones.toString()}</strong></article>
        <article><span>Agreements completed</span><strong>{stats.completedAgreements.toString()}</strong></article>
        <article><span>Funded expiries</span><strong>{stats.expiredFundedAgreements.toString()}</strong></article>
      </section>

      <section className="agreement-section">
        <div className="section-title">
          <div><p className="eyebrow">Assigned shipments</p><h3>Carrier workflow</h3></div>
          <span className="count-pill">{agreements.length}</span>
        </div>

        {agreements.length === 0 ? (
          <div className="panel empty-state small-empty"><h4>No assigned agreements</h4><p>A Shipper must create an agreement using this Carrier wallet address.</p></div>
        ) : (
          <div className="carrier-agreement-grid">
            {agreements.map(({ agreement, pickup, delivery }) => {
              const status = Number(agreement.status);
              const expired = Date.now() / 1000 > Number(agreement.deadline);
              const activeMilestone = status === 2 ? 0 : 1;
              const activeRecord = activeMilestone === 0 ? pickup : delivery;
              const key = evidenceKey(agreement.id, activeMilestone);
              const hasEvidence = Boolean(activeRecord.evidenceCid);

              return (
                <article className="agreement-card carrier-card" key={agreement.id.toString()}>
                  <div className="agreement-card-head">
                    <div><span className="agreement-id">Agreement #{agreement.id.toString()}</span><h4>{agreement.cargo}</h4></div>
                    <span className={`status status-${status}`}>{STATUS_LABELS[status]}</span>
                  </div>
                  <div className="route"><span>{agreement.origin}</span><i>→</i><span>{agreement.destination}</span></div>
                  <dl className="agreement-details carrier-details">
                    <div><dt>Shipper</dt><dd title={agreement.shipper}>{shortAddress(agreement.shipper)}</dd></div>
                    <div><dt>Verifier</dt><dd title={agreement.verifier}>{shortAddress(agreement.verifier)}</dd></div>
                    <div><dt>Escrow</dt><dd>{formatEther(agreement.requiredEscrow)} ETH</dd></div>
                    <div><dt>Deadline</dt><dd>{formatDate(agreement.deadline)}</dd></div>
                  </dl>

                  <div className="milestone-progress" aria-label="Milestone progress">
                    <span className={status >= 1 && status <= 5 ? "complete" : ""}>Accepted</span><i>→</i>
                    <span className={status >= 2 && status <= 5 ? "complete" : ""}>Funded</span><i>→</i>
                    <span className={pickup.completed ? "complete" : ""}>Pickup</span><i>→</i>
                    <span className={delivery.completed ? "complete" : ""}>Delivery</span>
                  </div>

                  <div className="card-actions carrier-actions">
                    {status === 0 && !expired && (
                      <><span className="action-hint">Review the route, escrow, and deadline before accepting.</span><button className="button button-primary button-small" disabled={busy === `accept-${agreement.id}`} onClick={() => onAccept(agreement)}>{busy === `accept-${agreement.id}` ? "Accepting…" : "Accept agreement"}</button></>
                    )}
                    {status === 0 && expired && <span className="action-hint">This assignment expired before acceptance.</span>}
                    {status === 1 && !expired && <span className="action-hint">Accepted. Waiting for the Shipper to fund the exact escrow.</span>}
                    {status === 1 && expired && <span className="action-hint">The deadline passed before funding.</span>}
                    {[2, 3].includes(status) && expired && (
                      <><span className="action-hint">The deadline passed. Unreleased escrow can return to the Shipper.</span><button className="button button-secondary button-small" disabled={busy === `refund-${agreement.id}`} onClick={() => onRefund(agreement)}>{busy === `refund-${agreement.id}` ? "Refunding…" : "Trigger remaining refund"}</button></>
                    )}
                    {[2, 3].includes(status) && !expired && (
                      <form className="proof-form" onSubmit={(event) => submitEvidence(event, agreement, activeMilestone)}>
                        <div className="proof-heading">
                          <div><strong>{activeMilestone === 0 ? "Pickup evidence" : "Delivery evidence"}</strong><span>{hasEvidence ? "Evidence submitted — replacement allowed until approval" : "Waiting for CID submission"}</span></div>
                          <span className="step-pill">{activeMilestone === 0 ? "Checkpoint 1" : "Checkpoint 2"}</span>
                        </div>
                        {hasEvidence && <a className="ipfs-link" href={gatewayUrl(activeRecord.evidenceCid)} target="_blank" rel="noreferrer">Open current IPFS evidence ↗</a>}
                        <label>IPFS CID<input autoComplete="off" maxLength="135" value={evidenceCids[key] ?? ""} onChange={(event) => { setEvidenceCids((current) => ({ ...current, [key]: event.target.value })); setEvidenceErrors((current) => ({ ...current, [key]: "" })); }} placeholder="bafy… or Qm…" /></label>
                        <p className="proof-disclosure">Evidence is public. Do not upload faces, patient records, addresses, or other sensitive information.</p>
                        {evidenceErrors[key] && <p className="proof-error" role="alert">{evidenceErrors[key]}</p>}
                        <button className="button button-primary" disabled={busy === `evidence-${agreement.id}-${activeMilestone}`}>{busy === `evidence-${agreement.id}-${activeMilestone}` ? "Saving evidence…" : hasEvidence ? "Replace evidence CID" : "Submit evidence CID"}</button>
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
