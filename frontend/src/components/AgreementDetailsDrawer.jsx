import { formatEther } from "ethers";
import { useEffect, useRef } from "react";
import EventHistory from "./EventHistory.jsx";

const STATUS_LABELS = ["Created", "Accepted", "Funded", "Pickup verified", "Completed", "Refunded", "Cancelled"];

function shortAddress(address) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function formatDate(timestamp) {
  return new Intl.DateTimeFormat("en-MY", { dateStyle: "medium", timeStyle: "short" })
    .format(new Date(Number(timestamp) * 1000));
}

function gatewayUrl(cid) {
  return `https://ipfs.io/ipfs/${encodeURIComponent(cid)}`;
}

export default function AgreementDetailsDrawer({
  record,
  history,
  role,
  chainTimestamp,
  busy,
  notice,
  returnFocus,
  onClose,
  onFund,
  onCancel,
  onRefund,
}) {
  const closeButton = useRef(null);
  const drawerPanel = useRef(null);
  const recordId = record?.agreement.id.toString();

  useEffect(() => {
    if (!recordId) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeButton.current?.focus();
    const handleKeyDown = (event) => {
      if (event.key === "Escape") onClose();
      if (event.key !== "Tab") return;
      const focusable = [...(drawerPanel.current?.querySelectorAll("button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex='-1'])") ?? [])];
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
      returnFocus?.focus();
    };
  }, [onClose, recordId, returnFocus]);

  if (!record) return null;

  const { agreement, pickup, delivery } = record;
  const status = Number(agreement.status);
  const expired = chainTimestamp > Number(agreement.deadline);
  const agreementHistory = history.filter((entry) => entry.agreementId.toString() === agreement.id.toString());

  return (
    <div className="drawer-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <aside ref={drawerPanel} className="agreement-drawer" role="dialog" aria-modal="true" aria-labelledby="drawer-title">
        <header className="drawer-header">
          <div><span className="agreement-id">Agreement #{agreement.id.toString()}</span><h2 id="drawer-title">{agreement.cargo}</h2></div>
          <button ref={closeButton} className="drawer-close" type="button" onClick={onClose} aria-label="Close agreement details">×</button>
        </header>

        <div className="drawer-scroll">
          {notice && <div className={`notice notice-${notice.type} drawer-notice`} role="status">{notice.text}</div>}
          <div className="drawer-summary">
            <span className={`status status-${status}`}>{STATUS_LABELS[status]}</span>
            <div className="route"><span>{agreement.origin}</span><i>→</i><span>{agreement.destination}</span></div>
          </div>

          <dl className="drawer-details">
            <div><dt>Shipper</dt><dd title={agreement.shipper}>{shortAddress(agreement.shipper)}</dd></div>
            <div><dt>Carrier</dt><dd title={agreement.carrier}>{shortAddress(agreement.carrier)}</dd></div>
            <div><dt>Verifier</dt><dd title={agreement.verifier}>{shortAddress(agreement.verifier)}</dd></div>
            <div><dt>Deadline</dt><dd>{formatDate(agreement.deadline)}</dd></div>
            <div><dt>Required escrow</dt><dd>{formatEther(agreement.requiredEscrow)} ETH</dd></div>
            <div><dt>Released</dt><dd>{formatEther(agreement.releasedAmount)} ETH</dd></div>
            <div><dt>Payout split</dt><dd>{Number(pickup.payoutBps) / 100}% pickup / {Number(delivery.payoutBps) / 100}% delivery</dd></div>
          </dl>

          <section className="drawer-milestones" aria-labelledby="milestone-title">
            <h3 id="milestone-title">Milestones</h3>
            {[{ label: "Pickup", record: pickup }, { label: "Delivery", record: delivery }].map(({ label, record: milestone }) => (
              <article key={label}>
                <div><strong>{label}</strong><span>{milestone.completed ? "Verified" : milestone.evidenceCid ? "Evidence submitted" : "Waiting"}</span></div>
                {milestone.evidenceCid && <a href={gatewayUrl(milestone.evidenceCid)} target="_blank" rel="noreferrer">Open IPFS evidence ↗</a>}
              </article>
            ))}
          </section>

          {role === 1 && (
            <section className="drawer-actions" aria-labelledby="shipper-actions-title">
              <h3 id="shipper-actions-title">Shipper actions</h3>
              <div>
                {status === 1 && !expired && <button className="button button-primary" disabled={busy === `fund-${agreement.id}`} onClick={() => onFund(agreement)}>{busy === `fund-${agreement.id}` ? "Funding…" : "Fund exact escrow"}</button>}
                {[0, 1].includes(status) && <button className="button button-danger" disabled={busy === `cancel-${agreement.id}`} onClick={() => onCancel(agreement)}>{busy === `cancel-${agreement.id}` ? "Cancelling…" : "Cancel agreement"}</button>}
                {[2, 3].includes(status) && expired && <button className="button button-primary" disabled={busy === `refund-${agreement.id}`} onClick={() => onRefund(agreement)}>{busy === `refund-${agreement.id}` ? "Refunding…" : "Process expired refund"}</button>}
                {status === 0 && <p>Waiting for Carrier acceptance. Cancellation remains available before funding.</p>}
                {[2, 3].includes(status) && !expired && <p>Escrow remains locked until Verifier approval or expiry.</p>}
                {status >= 4 && <p>This agreement has reached a closed state.</p>}
              </div>
            </section>
          )}

          <div className="drawer-history"><EventHistory entries={agreementHistory} /></div>
        </div>
      </aside>
    </div>
  );
}
